// ============================================================================
// Drawing Register & Tracker — full-fidelity module
// ----------------------------------------------------------------------------
// Mirrors the Megawide "Drawing Register & Tracker" workbook (GPR101. TEC.):
//   • Structured drawing code built from the Coding Reference tables
//     <proj>-<building>-<company>-<type>-<discipline>-<floor>-<number>-<rev>
//   • Phase → discipline grouping with progress roll-ups
//   • Multi-revision submission tracking (planned/actual per revision)
//   • Approval status + planned/actual approval dates
//   • Sheet counts + approved % ; progress dashboard
//   • Excel import of the workbook's flat "Dwg Registry" layout (SheetJS)
//   • Optional file upload to the private `drawing-register` storage bucket
// ============================================================================

window.DrawingRegister = (function () {
  var TABLE  = 'drawing_register';
  var BUCKET = 'drawing-register';
  var profile = null, uid = null, pid = null, projName = '';
  var rows = [];
  var view = 'overview';                       // overview | backlog | registry
  var filters = { phase: '', discipline: '', status: '', search: '', dupsOnly: false };
  var selected = {};                           // id -> true (bulk select)
  var collapsed = {};                          // group key -> true (collapsed)
  var dupSet = {};                             // phasecode -> count (>1) for duplicate-code flagging
  var canWrite = false;                        // planner+ / admin / super_admin

  // ---- Project Schedule link -----------------------------------------------
  // A drawing is a prerequisite for construction work: the linked activity's
  // start is the "need-by" date; (start − lead_days) is the required approval
  // date. See migrations/2026-07-25-schedule-document-links.sql.
  var schedActs = [];        // [{id, activity_id, activity_name, start_date, actual_start}]
  var schedById = {};        // activity_id -> activity
  var schedPid  = null;      // project the schedule cache was loaded for
  var LEAD_DEFAULT = 30;     // drawings approved ~30 days before the work they enable

  // ---- Coding Reference (from the workbook "Coding Reference" sheet) --------
  var BUILDINGS = ['GEN','TW1','TW2','TW3','TW4','TW5','TW6','TW7','TW8','TW9'];
  var COMPANIES = ['MCC'];
  var TYPES = {
    DRC:'Drawing Review Checklist', ECD:'Engineering Concept Design',
    SD1:'Schematic Design 1', SD2:'Schematic Design 2',
    FCD:'For Construction Drawing', CSD:'Combined Services Model',
    ISD:'Individual Services Drawings'
  };
  var DISCIPLINES = {
    AR:'Architectural', ST:'Structural', CV:'Civil', EL:'Electrical',
    AU:'Auxiliary', PL:'Plumbing', ME:'Mechanical', FP:'Fire Protection',
    SD:'Site Development', LA:'Landscape',
    TF:'Temporary Facilities', SP:'Safety Protection', CE:'Construction Equipment',
    OS:'Other Specialties', MC:'MEPF Combined'
  };
  var FLOORS = ['GEN','FD','GF','2F','3F','4F','5F','6F','7F','8F','9F','10F',
                '11F','12F','13F','14F','15F','RDF','RORD'];
  // Design phases, in workbook order
  var PHASES = ['Concept Design','Schematic Design 1','Schematic Design 2',
                'For Construction','As-Built'];
  var STATUSES = ['For Review','Revise & Resubmit','Approved w/ comments',
                  'Approved','Superseded'];
  var NODE_LABELS = { phase:'Phase', discipline:'Discipline', category:'Category', drawing:'Drawing' };

  // selection ordering (display order of drawing ids) for shift-click + arrows
  var visibleIds = [];
  var lastClickedId = null;
  var _dragId = null;    // drawing row being drag-reordered (within its own group)

  // Drag-reorder mirrors Project Schedule's: only meaningful when the visible
  // order IS the stored order, so it's off while a filter/search narrows the list
  // (you'd be reordering against rows you can't see).
  function reorderEnabled(){ return canWrite && !anyFilter(); }

  // A drawing's group = the phase → discipline → category bucket it renders in
  // (same keys buildModel() groups by). Reordering never crosses a group.
  function groupKeyOf(r){
    return (r.phase||'Ungrouped') + '|' + (r.discipline||'—') + '|' + ((r.category||'').trim());
  }

  // buildModel() walks `rows` in ARRAY order, which is only the sort_order order
  // because load() fetches with .order('sort_order'). After changing sort_order
  // in memory we must re-sort the array too, or the new order won't show until a
  // reload. Mirrors Postgres ASC: NULLs last.
  function sortRows(){
    rows.sort(function (a, b){
      var x = a.sort_order == null ? null : +a.sort_order;
      var y = b.sort_order == null ? null : +b.sort_order;
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return x - y;
    });
  }

  function sb() { return AppAuth.getSB(); }

  // ================= live collaboration (presence + cell cursors) ============
  // Google-Sheets-style co-editing via the shared PDCollab layer (Supabase
  // Realtime): topbar avatars of who's here, colored outlines of the cell each
  // person is editing, and live row updates when someone else saves.
  var collab = null;        // PDCollab channel handle for the current project
  var remoteSel = {};       // userId -> { name, color, sel:{rowId,field,editing} }
  var _deferredRemote = []; // remote row changes queued while I have an editor open

  function selfName() { return (profile && (profile.name || profile.email)) || 'Someone'; }

  function joinCollab() {
    if (!window.PDCollab) return;
    if (collab) { collab.leave(); collab = null; }
    remoteSel = {};
    if (!pid) { renderPresence([]); return; }
    collab = PDCollab.join({
      key: 'drawing_register:' + pid,
      table: TABLE, projectId: pid,
      self: { id: uid, name: selfName() },
      onPresence: function (members) {
        renderPresence(members);
        // reseed cursors from presence so a late joiner sees existing selections
        remoteSel = {};
        members.forEach(function (m) { if (!m.self && m.sel) remoteSel[m.id] = { id: m.id, name: m.name, color: m.color, sel: m.sel }; });
        paintRemote();
      },
      onSelection: function (d) {
        if (d.sel) remoteSel[d.id] = { id: d.id, name: d.name, color: d.color, sel: d.sel };
        else delete remoteSel[d.id];
        paintRemote();
      },
      onRemoteChange: applyRemoteChange
    });
  }

  function renderPresence(members) {
    var el = document.getElementById('dr-presence'); if (!el) return;
    el.innerHTML = window.PDCollab ? PDCollab.avatarsHTML(members || []) : '';
  }

  // Broadcast MY selection (row + field). Debounced inside PDCollab.
  function broadcastSel(rowId, field, editing) {
    if (collab) collab.setSelection(rowId ? { rowId: rowId, field: field || null, editing: !!editing } : null);
  }

  // Paint every remote user's active cell (colored outline + initials flag).
  function paintRemote() {
    if (!window.PDCollab) return;
    PDCollab.clearCells(document);
    if (view !== 'register') return;
    Object.keys(remoteSel).forEach(function (k) {
      var m = remoteSel[k]; if (!m || !m.sel || !m.sel.rowId) return;
      var rid = (window.CSS && CSS.escape) ? CSS.escape(m.sel.rowId) : m.sel.rowId;
      var tr = document.querySelector('tr.dr-drow[data-id="' + rid + '"]'); if (!tr) return;
      var td = m.sel.field ? tr.querySelector('td[data-f="' + m.sel.field + '"]') : tr.querySelector('td[data-f]');
      if (td) PDCollab.paintCell(td, m);
    });
  }

  // A remote user saved/inserted/deleted a row: patch the local model + re-render.
  // Deferred while I have an inline editor open so it can't wipe my input mid-edit.
  function _applyRemoteOne(payload) {
    var evt = payload.eventType || payload.event;
    var rec = payload['new'] || payload.record || null;
    var old = payload['old'] || payload.old_record || null;
    if (evt === 'DELETE') {
      var did = old && old.id; if (did == null) return;
      var i = rows.findIndex(function (x) { return x.id === did; });
      if (i !== -1) rows.splice(i, 1);
    } else if (rec) {
      var j = rows.findIndex(function (x) { return x.id === rec.id; });
      if (j === -1) rows.push(rec); else rows[j] = rec;
    }
  }
  function applyRemoteChange(payload) {
    if (document.querySelector('.dr-editing')) { _deferredRemote.push(payload); return; }
    _applyRemoteOne(payload); render();
  }
  function flushDeferredRemote() {
    if (!_deferredRemote.length) return;
    var q = _deferredRemote; _deferredRemote = [];
    q.forEach(_applyRemoteOne); render();
  }
  function num(v){ v = parseFloat(v); return isFinite(v) ? v : 0; }

  // ---- per-project UI persistence (view + collapse state) [feature 3] ------
  function uiKey(k){ return 'dr_' + k + '_' + pid; }
  function saveUI(){
    try {
      localStorage.setItem(uiKey('view'), view);
      localStorage.setItem(uiKey('collapsed'), JSON.stringify(collapsed));
    } catch (e) {}
  }
  function restoreUI(){
    var ok=false;
    try {
      var v = localStorage.getItem(uiKey('view'));
      if (v==='overview'||v==='backlog'||v==='registry') view=v;
      else if (v==='register') view='registry';   // legacy value migration
      else if (v==='progress') view='overview';    // legacy value migration
      var c = localStorage.getItem(uiKey('collapsed'));
      if (c){ var o=JSON.parse(c); if (o && typeof o==='object'){ collapsed=o; ok=true; } }
    } catch (e) {}
    return ok;
  }
  function syncTabs(){
    document.querySelectorAll('.dr-tab').forEach(function (b){ b.classList.toggle('active', b.dataset.view===view); });
  }
  function disciplineName(code){ return DISCIPLINES[code] || code || ''; }

  // ---------------------------------------------------------------- init -----
  async function init(user, prof) {
    profile = prof; uid = (user && user.id) || (prof && prof.id);
    var role = (prof && prof.role) || window.__role || '';
    canWrite = ['super_admin','admin','planner'].indexOf(role) !== -1;
    await loadProjects();

    document.getElementById('dr-add').onclick = function () { addDrawing(); };
    document.getElementById('dr-import').onclick = function () { openImport(); };
    document.getElementById('dr-export').onclick = function () { exportExcel(); };
    var clearBtn = document.getElementById('dr-clear');
    if (clearBtn) { clearBtn.style.display = canWrite ? '' : 'none'; clearBtn.onclick = clearAll; }
    // "+ Level" menu: build the phase/discipline/category skeleton
    var lvlBtn = document.getElementById('dr-addlevel'), lvlMenu = document.getElementById('dr-addlevel-menu');
    if (lvlBtn) {
      lvlBtn.style.display = canWrite ? '' : 'none';
      if (!canWrite && document.getElementById('dr-add')) document.getElementById('dr-add').style.display='none';
      lvlBtn.onclick = function (e){ e.stopPropagation(); lvlMenu.hidden = !lvlMenu.hidden; };
      document.addEventListener('click', function(){ if (lvlMenu) lvlMenu.hidden = true; });
      lvlMenu.querySelectorAll('[data-add]').forEach(function (b){
        b.onclick = function(){ lvlMenu.hidden = true; addLevel(b.dataset.add); };
      });
    }
    document.getElementById('dr-project').onchange = function (e) {
      pid = e.target.value; sessionStorage.setItem('pd_project', pid);
      var p = e.target.selectedOptions[0]; projName = p ? p.textContent : '';
      load({ reset:true });
      joinCollab();
    };
    // Broadcast my active cell to other viewers (click / keyboard focus).
    document.addEventListener('click', function (e) {
      var td = e.target.closest && e.target.closest('tr.dr-drow td[data-f]');
      if (!td) return; var tr = td.closest('tr.dr-drow'); if (!tr) return;
      broadcastSel(tr.dataset.id, td.dataset.f, false);
    });
    document.querySelectorAll('.dr-tab').forEach(function (b) {
      b.onclick = function () {
        view = b.dataset.view;
        syncTabs(); saveUI(); render();
      };
    });
    ['dr-f-phase','dr-f-discipline','dr-f-status','dr-f-search'].forEach(function (id) {
      var el = document.getElementById(id);
      el.oninput = el.onchange = function () {
        filters.phase      = document.getElementById('dr-f-phase').value;
        filters.discipline = document.getElementById('dr-f-discipline').value;
        filters.status     = document.getElementById('dr-f-status').value;
        filters.search     = document.getElementById('dr-f-search').value.toLowerCase().trim();
        render();
      };
    });
    // Saved filter views [feature 5]
    var vBtn = document.getElementById('dr-viewsbtn'), vMenu = document.getElementById('dr-views-menu');
    if (vBtn) {
      vBtn.onclick = function (e){ e.stopPropagation(); if (vMenu.hidden) renderViewsMenu(); vMenu.hidden = !vMenu.hidden; };
      document.addEventListener('click', function(){ if (vMenu) vMenu.hidden = true; });
    }
    if (pid) load({ reset:true });
    joinCollab();
  }

  // ---- saved filter views [feature 5] --------------------------------------
  function viewsKey(){ return 'dr_views_' + pid; }
  function getViews(){ try { return JSON.parse(localStorage.getItem(viewsKey())||'[]') || []; } catch(e){ return []; } }
  function setViews(v){ try { localStorage.setItem(viewsKey(), JSON.stringify(v)); } catch(e){} }
  function applyFilterValues(f){
    document.getElementById('dr-f-phase').value = f.phase||'';
    document.getElementById('dr-f-discipline').value = f.discipline||'';
    document.getElementById('dr-f-status').value = f.status||'';
    document.getElementById('dr-f-search').value = f.search||'';
    filters.phase=f.phase||''; filters.discipline=f.discipline||''; filters.status=f.status||''; filters.search=(f.search||'').toLowerCase().trim();
    render();
  }
  function renderViewsMenu(){
    var menu = document.getElementById('dr-views-menu'); if (!menu) return;
    var views = getViews();
    var html = views.map(function (v, i){
      return '<div class="dr-view-item"><button class="dr-view-apply" data-vi="'+i+'">'+Fmt.esc(v.name)+'</button>' +
             '<button class="dr-view-del" data-vd="'+i+'" title="Delete view">✕</button></div>';
    }).join('') || '<div class="dr-view-empty">No saved views yet.</div>';
    html += '<div class="dr-view-sep"></div><button class="dr-view-save" id="dr-view-save">＋ Save current filters…</button>';
    menu.innerHTML = html;
    menu.querySelectorAll('[data-vi]').forEach(function (b){ b.onclick=function(){ applyFilterValues(getViews()[+b.dataset.vi].f||{}); menu.hidden=true; }; });
    menu.querySelectorAll('[data-vd]').forEach(function (b){ b.onclick=function(e){ e.stopPropagation(); var v=getViews(); v.splice(+b.dataset.vd,1); setViews(v); renderViewsMenu(); }; });
    var save = menu.querySelector('#dr-view-save');
    if (save) save.onclick = function(){
      var name = (prompt('Name this view:', '')||'').trim(); if (!name) return;
      var v = getViews(); v.push({ name:name, f:{ phase:filters.phase, discipline:filters.discipline, status:filters.status, search:document.getElementById('dr-f-search').value } });
      setViews(v); renderViewsMenu();
    };
  }

  async function loadProjects() {
    var projects = await PDb.getProjects();
    var sel = document.getElementById('dr-project');
    pid = sessionStorage.getItem('pd_project') || (projects[0] && projects[0].id) || null;
    sel.innerHTML = '<option value="">Select project…</option>' +
      projects.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === pid ? ' selected' : '') + '>' + Fmt.esc(p.name) + '</option>';
      }).join('');
    UI.enhanceProjectSelect(sel);   // shared searchable project picker
    var cur = projects.find(function (p){ return p.id === pid; });
    projName = cur ? cur.name : '';
  }

  async function load(opts) {
    opts = opts || {};
    if (!pid) { rows = []; render(); return; }
    // Keyset-paginate (a single select caps at 1000; a large register already exceeds it —
    // the GPR101 workbook alone is 1032 drawings), then restore the sort_order / drawing_no
    // ordering the grid + roll-ups rely on.
    var all = [], last = null, fromCache = false;
    while (true) {
      var q = sb().from(TABLE).select('*').eq('project_id', pid).order('id', { ascending: true }).limit(1000);
      if (last) q = q.gt('id', last);
      var res = await q;
      if (res.error) {
        // Offline / network failure: open from the last cached copy so the register still works
        // (edits made now queue via PDSync and sync on reconnect).
        if (window.PDSync) { var c = await PDSync.cacheGet('dr:' + pid); if (c && c.rows) { all = c.rows.slice(); fromCache = true; break; } }
        UI.toast(res.error.message, 'error'); return;
      }
      var batch = res.data || []; all = all.concat(batch);
      if (batch.length < 1000) break; last = batch[batch.length - 1].id;
    }
    all.sort(function (a, b) {
      var sa = a.sort_order, sb2 = b.sort_order;      // sort_order ASC, NULLS LAST
      if (sa == null && sb2 == null) {} else if (sa == null) return 1; else if (sb2 == null) return -1; else if (sa !== sb2) return sa - sb2;
      return String(a.drawing_no || '').localeCompare(String(b.drawing_no || ''));
    });
    rows = all;
    if (!fromCache && window.PDSync) PDSync.cachePut('dr:' + pid, all);   // refresh the offline cache
    if (opts.reset) {
      // fresh view (project switch / import / clear): reset selection; restore
      // the saved per-project view + collapse state, else default to phases collapsed
      selected = {}; lastClickedId = null; selCtx = { phase:'', discipline:'', category:'', level:0 };
      collapsed = {};
      if (!restoreUI()) rows.forEach(function (r){ collapsed['P:' + (r.phase || 'Ungrouped')] = true; });
    }
    render();
    ensureSchedule();   // lazy — re-renders the Need-by column when it resolves
  }

  // ---- Project Schedule cache (for the Need-by column + Add/Edit picker) ----
  function ensureSchedule(){
    if (schedPid === pid) return Promise.resolve();
    return loadSchedule().then(function(){ schedPid = pid; if (view === 'register') render(); });
  }
  async function loadSchedule(){
    schedActs = []; schedById = {};
    if (!pid) return;
    var all = [], last = null;
    while (true) {
      var q = sb().from('project_schedule')
        .select('id,activity_id,activity_name,start_date,actual_start,activity_type,wbs')
        .eq('project_id', pid).order('id', { ascending:true }).limit(1000);
      if (last) q = q.gt('id', last);
      var res = await q;
      if (res.error) return;   // schedule link is optional — degrade quietly
      var batch = res.data || []; all = all.concat(batch);
      if (batch.length < 1000) break; last = batch[batch.length - 1].id;
    }
    all.forEach(function (a){
      if (!a.activity_id || a.activity_type === 'WBS Summary') return;  // leaf activities only
      if (!schedById[a.activity_id]) { schedById[a.activity_id] = a; schedActs.push(a); }
    });
  }

  // ---- schedule-link derivations -------------------------------------------
  function leadOf(r){ var l = r.lead_days; return (l == null || l === '') ? LEAD_DEFAULT : num(l); }
  function needByOf(r){                          // the activity start = need-on-site date
    var a = r.schedule_activity_id && schedById[r.schedule_activity_id];
    return a ? (a.start_date || a.actual_start || null) : null;
  }
  function minusDays(iso, n){
    var d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return null;
    d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
  }
  function requiredApprovalOf(r){                // deadline = need-by − lead
    var nb = needByOf(r); return nb ? minusDays(nb, leadOf(r)) : null;
  }
  // Aging in days, WPM-Backlog style: +N = N days past its deadline, −N = N days
  // still to go. Prefers the schedule need-by deadline; falls back to the plain
  // planned-approval date for drawings with no schedule link yet.
  function agingDays(r){
    var ref = requiredApprovalOf(r) || r.planned_approval;
    if (!ref) return null;
    var refYear = +String(ref).slice(0,4);
    if (refYear < 2015 || refYear > 2100) return null;   // sentinel/placeholder date, not real
    var today = new Date(); today.setHours(0,0,0,0);
    return Math.round((today - new Date(ref + 'T00:00:00')) / 86400000);
  }
  function docFloatOf(r){                         // +slack / −late, days vs the deadline
    var req = requiredApprovalOf(r); if (!req) return null;
    var have = r.actual_approval || r.planned_approval; if (!have) return null;
    return Math.round((new Date(req + 'T00:00:00') - new Date(have + 'T00:00:00')) / 86400000);
  }
  // Need-by cell: the required-approval deadline + a float chip (green slack /
  // amber tight / red late). Blank when the drawing isn't linked to an activity.
  function needByCellHtml(r){
    if (!r.schedule_activity_id) return '<span class="dr-mut">—</span>';
    var req = requiredApprovalOf(r);
    if (!req) {   // linked, but the activity is missing / has no start date yet
      return '<span class="dr-needby-unl" title="Linked activity '+Fmt.esc(r.schedule_activity_id)+
             ' — no start date in the schedule yet">'+Fmt.esc(r.schedule_activity_id)+'</span>';
    }
    var fl = docFloatOf(r), chip = '';
    if (fl != null) {
      var cls = fl < 0 ? 'dr-fl-late' : (fl <= 3 ? 'dr-fl-tight' : 'dr-fl-ok');
      chip = ' <span class="dr-flchip '+cls+'" title="Float of the approval date vs the required-by deadline">'+
             (fl > 0 ? '+' : '')+fl+'d</span>';
    }
    return '<span class="dr-needby" title="Required approval for activity '+Fmt.esc(r.schedule_activity_id)+
           '">'+Fmt.date(req)+'</span>'+chip;
  }
  // datalist options for the Add/Edit activity picker (capped for huge schedules)
  function schedOptions(){
    return schedActs.slice(0, 3000).map(function (a){
      return '<option value="'+Fmt.esc(a.activity_id)+'">'+
             Fmt.esc((a.activity_id || '') + ' — ' + (a.activity_name || '')) + '</option>';
    }).join('');
  }

  // ---------------------------------------------------------- derivations ----
  function composeCode(r) {
    var parts = [r.proj_code, r.building_ref, r.company, r.drawing_type,
                 r.discipline_code || r.discipline, r.floor_level,
                 r.dwg_number, r.revision];
    parts = parts.filter(function (x){ return x != null && String(x).trim() !== ''; });
    return parts.join('-');
  }
  function pctApproved(r) {
    var tot = num(r.no_of_sheets) || 0, ap = num(r.approved_sheets) || 0;
    if (r.approved_pct != null && r.approved_pct !== '') return num(r.approved_pct);
    return tot ? ap / tot : 0;
  }
  function isApprovedStatus(s) {
    return s === 'Approved' || s === 'Approved w/o comments' || s === 'Approved w/ comments';
  }
  function latestSub(r, which) {
    var subs = Array.isArray(r.submissions) ? r.submissions : [];
    for (var i = subs.length - 1; i >= 0; i--) {
      if (subs[i] && subs[i][which]) return subs[i][which];
    }
    return which === 'actual' ? r.issue_date : (r.due_date || null);
  }

  function isNode(r){ return r.node_kind && r.node_kind !== 'drawing'; }
  function drawingRows(){ return rows.filter(function (r){ return !isNode(r); }); }
  function structuralNodes(){ return rows.filter(isNode); }
  function anyFilter(){ return !!(filters.phase || filters.discipline || filters.status || filters.search || filters.dupsOnly); }

  // Shared by the Registry filter bar AND the Backlog tab (dupsOnly is Registry-only).
  function matchesFilters(r, opts) {
    opts = opts || {};
    if (!opts.skipDups && filters.dupsOnly && !dupSet[dupKey(r)]) return false;
    if (filters.phase && r.phase !== filters.phase) return false;
    if (filters.discipline &&
        r.discipline !== filters.discipline &&
        disciplineName(r.discipline) !== filters.discipline) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.search) {
      var hay = [r.drawing_no, r.drawing_code, r.title, r.description, r.discipline,
                 r.category, r.phase, r.responsible, r.revision, r.remarks].join(' ').toLowerCase();
      if (hay.indexOf(filters.search) === -1) return false;
    }
    return true;
  }

  function filtered() {
    return drawingRows().filter(function (r) {
      if (!matchesFilters(r)) return false;
      return true;
    });
  }

  // ------------------------------------------------------------- rendering ---
  function statusCls(s) {
    if (s === 'Approved' || s === 'Approved w/o comments') return 'dr-ok';
    if (s === 'Approved w/ comments') return 'dr-okc';
    if (s === 'Revise & Resubmit') return 'dr-rr';
    if (s === 'Superseded') return 'dr-old';
    return 'dr-review';
  }

  function render() {
    syncTabs();
    // the filter bar applies to Registry AND Backlog (both are drawing-level lists);
    // Overview is an aggregate dashboard, so it hides the filters.
    var fb = document.querySelector('.dr-filters');
    if (fb) fb.style.display = (view === 'overview') ? 'none' : '';
    populateFilterSelects();
    if (view === 'overview') { renderProgress(); }
    else if (view === 'backlog') { renderBacklog(); }
    else { renderRegister(); }
    paintRemote();
  }

  // ---- Backlog: drawings needing action, most urgent first -----------------
  // "Needing action" = not yet approved (For Review / Revise & Resubmit /
  // Approved w/ comments still carries an open loop) OR overdue against its
  // linked schedule need-by deadline. Sorted so the worst-off rows lead.
  function backlogRows(){
    return drawingRows().filter(function (r){
      if (!matchesFilters(r, { skipDups:true })) return false;
      return !isApprovedStatus(r.status) || r.status === 'Revise & Resubmit';
    });
  }
  function backlogUrgency(r){
    var fl = docFloatOf(r);
    if (fl != null) return fl;                 // negative = late, smaller = worse
    return r.status === 'Revise & Resubmit' ? 500 : 1000; // no schedule link: rank by status
  }

  // Sortable columns (WPM Backlog pattern: click a header to sort by it, click
  // again to flip direction). Defaults to "most overdue first" like `dr-bk-defcol`.
  var bkSort = { col:'urgency', dir:1 };
  var BK_COLS = [
    { col:'code',       label:'Code' },
    { col:'title',      label:'Title' },
    { col:'phase',      label:'Phase' },
    { col:'discipline', label:'Discipline' },
    { col:'status',     label:'Status' },
    { col:'needby',     label:'Need-by' },
    { col:'aging',      label:'Aging (d)' }
  ];
  function bkSortVal(r, col){
    switch (col){
      case 'code':       return drawCode(r).toLowerCase();
      case 'title':      return (r.title||'').toLowerCase();
      case 'phase':       return r.phase||'';
      case 'discipline': return disciplineName(r.discipline);
      case 'status':      return r.status||'';
      case 'needby':      return requiredApprovalOf(r) || '';
      case 'aging':       { var a=agingDays(r); return a==null ? -1e9 : a; }
      default:            return backlogUrgency(r);
    }
  }
  function bkSetSort(col){
    if (bkSort.col === col) bkSort.dir = -bkSort.dir;
    else { bkSort.col = col; bkSort.dir = (col==='aging') ? -1 : 1; }
    renderBacklog();
  }

  // A backlog can run into the thousands (e.g. a fresh import with no statuses
  // set yet) — rendering + scrolling all of them as one page-length table is the
  // "vastness" the user hit on Bauhinia. Two mitigations: the table scrolls
  // inside its own capped-height card (KPIs/header stay put), and only the first
  // BK_PAGE rows paint until "Show all" is clicked (DOM stays light; sorting/
  // filtering always re-slices from the full, already-sorted list).
  var BK_PAGE = 200;
  var bkShowAll = false;

  function renderBacklog(){
    var host = document.getElementById('dr-view');
    var list = backlogRows();
    if (!list.length) {
      host.innerHTML = emptyMsg(anyFilter() ? 'No open items match these filters.' : 'No open items — every drawing is approved.');
      return;
    }
    list = list.slice().sort(function (a,b){
      var va=bkSortVal(a,bkSort.col), vb=bkSortVal(b,bkSort.col);
      var cmp = va<vb ? -1 : (va>vb ? 1 : 0);
      return cmp * bkSort.dir;
    });

    var late = list.filter(function (r){ var f=docFloatOf(r); return f!=null && f<0; }).length;
    var tight = list.filter(function (r){ var f=docFloatOf(r); return f!=null && f>=0 && f<=3; }).length;
    var revise = list.filter(function (r){ return r.status==='Revise & Resubmit'; }).length;

    var kpis = kpiSection('Backlog Overview',
      kpi(list.length, 'Open items') +
      kpi(late, 'Late vs need-by', late>0?'warn':'') +
      kpi(tight, 'Due ≤3 days', tight>0?'warn':'') +
      kpi(revise, 'Revise & Resubmit'));

    var shown = (bkShowAll || list.length<=BK_PAGE) ? list : list.slice(0, BK_PAGE);

    var body = shown.map(function (r){
      var a = agingDays(r);
      return '<tr class="dr-bk-row" data-id="'+r.id+'">' +
        '<td class="dr-code">'+Fmt.esc(drawCode(r))+'</td>' +
        '<td>'+Fmt.esc(r.title||'')+'</td>' +
        '<td>'+Fmt.esc(r.phase||'')+'</td>' +
        '<td>'+Fmt.esc(disciplineName(r.discipline))+'</td>' +
        '<td>'+(r.status ? '<span class="dr-pill '+statusCls(r.status)+'">'+Fmt.esc(r.status)+'</span>' : '<span class="dr-mut">—</span>')+'</td>' +
        '<td class="dr-nowrap dr-c-needby">'+needByCellHtml(r)+'</td>' +
        '<td class="dr-r dr-nowrap'+(a!=null&&a>0?' dr-aging-late':'')+'">'+(a==null?'<span class="dr-mut">—</span>':(a>0?'+':'')+a+'d')+'</td>' +
      '</tr>';
    }).join('');

    var head = BK_COLS.map(function (c){
      var active = bkSort.col===c.col;
      return '<th class="dr-sortable" data-col="'+c.col+'">'+c.label+
        (active ? ' <span class="dr-sortind">'+(bkSort.dir===1?'▲':'▼')+'</span>' : '')+'</th>';
    }).join('');

    var moreBar = (list.length > BK_PAGE) ?
      '<div class="dr-bk-more">' +
        (bkShowAll
          ? 'Showing all '+list.length+' — <button class="dr-linklike" id="dr-bk-collapse">collapse to first '+BK_PAGE+'</button>'
          : 'Showing '+BK_PAGE+' of '+list.length+' — <button class="dr-linklike" id="dr-bk-showall">show all</button>') +
      '</div>' : '';

    host.innerHTML = kpis +
      '<div class="pd-card"><h3 class="dr-h3">Open items' +
      '<span class="dr-mut" style="font-weight:400;font-size:12.5px;margin-left:8px;">'+
      (anyFilter() ? 'Showing '+list.length+' filtered' : list.length+' total')+'</span></h3>' +
      '<div class="dr-bk-scroll"><table class="pd-table dr-table dr-bk-table"><thead><tr>'+head+'</tr></thead>' +
      '<tbody>'+body+'</tbody></table></div>' + moreBar + '</div>';

    var showAllBtn = document.getElementById('dr-bk-showall');
    if (showAllBtn) showAllBtn.onclick = function (){ bkShowAll = true; renderBacklog(); };
    var collapseBtn = document.getElementById('dr-bk-collapse');
    if (collapseBtn) collapseBtn.onclick = function (){ bkShowAll = false; renderBacklog(); };

    host.querySelectorAll('.dr-bk-table th.dr-sortable').forEach(function (th){
      th.onclick = function (){ bkSetSort(th.dataset.col); };
    });
    host.querySelectorAll('.dr-bk-row').forEach(function (tr){
      tr.onclick = function (){
        var r = rows.find(function (x){ return String(x.id)===tr.dataset.id; });
        if (r) openForm(r);
      };
    });
  }

  function populateFilterSelects() {
    var ph = document.getElementById('dr-f-phase');
    var phSet = {}; rows.forEach(function (r){ if (r.phase) phSet[r.phase]=1; });
    var phList = PHASES.filter(function (p){ return phSet[p]; })
      .concat(Object.keys(phSet).filter(function (p){ return PHASES.indexOf(p)===-1; }));
    ph.innerHTML = '<option value="">All phases</option>' + phList.map(function (p){
      return '<option'+(filters.phase===p?' selected':'')+'>'+Fmt.esc(p)+'</option>'; }).join('');

    var dc = document.getElementById('dr-f-discipline');
    var dSet = {}; rows.forEach(function (r){ if (r.discipline) dSet[r.discipline]=1; });
    var dList = Object.keys(dSet).sort();
    dc.innerHTML = '<option value="">All disciplines</option>' + dList.map(function (d){
      return '<option'+(filters.discipline===d?' selected':'')+'>'+Fmt.esc(d)+'</option>'; }).join('');
  }

  // ---- duplicate-code detection [feature 2] --------------------------------
  // A drawing code should be unique within its phase; the workbook has genuine
  // repeats (e.g. two M-100 in one phase) worth surfacing so planners reconcile.
  function drawCode(r){ return String(r.drawing_code||r.drawing_no||r.dwg_number||'').trim(); }
  function dupKey(r){ return (r.phase||'') + SEP + drawCode(r).toLowerCase(); }
  function computeDups(){
    var count={}, out={};
    drawingRows().forEach(function (r){ var c=drawCode(r); if (!c) return; var k=dupKey(r); count[k]=(count[k]||0)+1; });
    Object.keys(count).forEach(function (k){ if (count[k]>1) out[k]=count[k]; });
    return out;
  }

  function phaseRank(p){ var i = PHASES.indexOf(p); return i === -1 ? 99 : i; }
  var SEP = '';

  // First-appearance order (by sort_order) so imported design iterations read
  // in workbook order instead of being force-sorted into a fixed vocabulary.
  function phaseOrderKey(ph){
    var min = Infinity;
    rows.forEach(function(r){ if((r.phase||'Ungrouped')===ph){ var s=r.sort_order||0; if(s<min) min=s; } });
    return min===Infinity ? 1e9 : min;
  }
  function nodeCode(n){ return n && n.dwg_number ? n.dwg_number : ''; }

  // Build an ordered flat display model that merges explicit structural node
  // rows (node_kind phase/discipline/category) with groups derived from the
  // drawings' phase/discipline/category text. Also fills `visibleIds`.
  function buildModel() {
    var draws = filtered();
    var nodes = structuralNodes();
    var pNode={}, dNode={}, cNode={};
    nodes.forEach(function (n){
      if (n.node_kind==='phase')       pNode[n.phase||n.title||'(unnamed)'] = n;
      else if (n.node_kind==='discipline') dNode[(n.phase||'')+SEP+(n.discipline||'')] = n;
      else if (n.node_kind==='category')   cNode[(n.phase||'')+SEP+(n.discipline||'')+SEP+(n.category||'')] = n;
    });

    // group drawings
    var byP = {};
    draws.forEach(function (r) {
      var ph=r.phase||'Ungrouped', d=r.discipline||'—', c=(r.category||'').trim();
      var P=(byP[ph]=byP[ph]||{disc:{},order:[]});
      var D=P.disc[d]; if(!D){ D=P.disc[d]={cat:{},order:[],nocat:[]}; P.order.push(d); }
      if(c){ if(!D.cat[c]){ D.cat[c]=[]; D.order.push(c); } D.cat[c].push(r); } else D.nocat.push(r);
    });

    var filt = anyFilter();
    var phaseSet={}; Object.keys(pNode).forEach(function(p){phaseSet[p]=1;}); Object.keys(byP).forEach(function(p){phaseSet[p]=1;});
    var phases=Object.keys(phaseSet).sort(function(a,b){return phaseOrderKey(a)-phaseOrderKey(b) || phaseRank(a)-phaseRank(b) || a.localeCompare(b);});

    var disp=[]; visibleIds=[];
    phases.forEach(function (ph) {
      var P=byP[ph]||{disc:{},order:[]};
      var pDraws=collectDraws(P);
      if (filt && !pDraws.length) return;
      var pkey='P:'+ph;
      disp.push({type:'phase',level:1,key:pkey,label:ph,code:nodeCode(pNode[ph]),ctx:{phase:ph},nodeId:node_(pNode[ph]),list:pDraws});
      if (collapsed[pkey]) return;

      var discSet={}; Object.keys(dNode).forEach(function(k){var p=k.split(SEP); if(p[0]===ph)discSet[p[1]]=1;});
      (P.order||[]).forEach(function(d){discSet[d]=1;});
      Object.keys(discSet).sort().forEach(function (d) {
        var D=P.disc[d]||{cat:{},order:[],nocat:[]};
        var dDraws=collectDisc(D);
        if (filt && !dDraws.length) return;
        var dkey='D:'+ph+'|'+d;
        var dlabel=DISCIPLINES[d]?DISCIPLINES[d]+' ('+d+')':disciplineName(d);
        disp.push({type:'disc',level:2,key:dkey,label:dlabel,code:nodeCode(dNode[ph+SEP+d]),ctx:{phase:ph,discipline:d},nodeId:node_(dNode[ph+SEP+d]),list:dDraws});
        if (collapsed[dkey]) return;

        // no-category drawings sit directly under the discipline (level 3)
        D.nocat.forEach(function(r){ disp.push({type:'drawing',level:3,row:r}); visibleIds.push(r.id); });

        var catSet={}; Object.keys(cNode).forEach(function(k){var p=k.split(SEP); if(p[0]===ph&&p[1]===d)catSet[p[2]]=1;});
        (D.order||[]).forEach(function(c){catSet[c]=1;});
        Object.keys(catSet).forEach(function (c) {
          var list=D.cat[c]||[];
          if (filt && !list.length) return;
          var ckey='C:'+ph+'|'+d+'|'+c;
          disp.push({type:'cat',level:3,key:ckey,label:c,code:nodeCode(cNode[ph+SEP+d+SEP+c]),ctx:{phase:ph,discipline:d,category:c},nodeId:node_(cNode[ph+SEP+d+SEP+c]),list:list});
          if (collapsed[ckey]) return;
          list.forEach(function(r){ disp.push({type:'drawing',level:4,row:r}); visibleIds.push(r.id); });
        });
      });
    });
    return disp;

    function node_(n){ return n ? n.id : null; }
    function collectDraws(P){ var a=[]; Object.keys(P.disc).forEach(function(d){ a=a.concat(collectDisc(P.disc[d])); }); return a; }
    function collectDisc(D){ var a=D.nocat.slice(); D.order.forEach(function(c){ a=a.concat(D.cat[c]); }); return a; }
  }

  function renderRegister() {
    var host = document.getElementById('dr-view');
    var draws = drawingRows();
    dupSet = computeDups();
    var disp = buildModel();
    var shown = disp.filter(function(x){return x.type==='drawing';}).length;

    var CB = canWrite;
    var anyOpen = disp.some(function (x){ return x.type==='phase' && !collapsed[x.key]; });
    var phaseItems = disp.filter(function(x){ return x.type==='phase'; });
    var jump = phaseItems.length > 1 ?
      '<select class="pd-select pd-btn-sm dr-jump" id="dr-jump" title="Jump to a phase">' +
        '<option value="">Jump to phase…</option>' +
        phaseItems.map(function(p){ return '<option value="'+Fmt.esc(p.key)+'">'+Fmt.esc(p.label)+'</option>'; }).join('') +
      '</select>' : '';
    var nDup = Object.keys(dupSet).length;
    var dupLegend = nDup ?
      '<button class="dr-duplegend'+(filters.dupsOnly?' dr-on':'')+'" id="dr-duplegend" ' +
        'title="A drawing code that appears more than once within the same phase. Click to '+(filters.dupsOnly?'show all':'show only duplicates')+'.">' +
        '<span class="dr-dupmark">⚠</span> '+nDup+' duplicate code'+(nDup>1?'s':'')+'</button>' : '';
    var toolbar = '<div class="dr-listbar">' +
      '<button class="dr-rowbtn dr-xall" id="dr-xall">' + (anyOpen ? 'Collapse all' : 'Expand all') + '</button>' +
      jump +
      dupLegend +
      '<div class="dr-listcount">Showing <strong>'+shown+'</strong> of '+draws.length+' drawings</div>' +
      '<div class="dr-selbar" id="dr-selbar" hidden>' +
        '<span id="dr-selcount"></span>' +
        '<select class="pd-select pd-btn-sm dr-selstatus" id="dr-selstatus" title="Set status for selected">' +
          '<option value="">Set status…</option>' +
          STATUSES.map(function(s){ return '<option>'+s+'</option>'; }).join('') +
        '</select>' +
        '<button class="pd-btn pd-btn-sm" id="dr-selclear">Clear</button>' +
        '<button class="pd-btn pd-btn-sm pd-btn-danger" id="dr-seldel">Delete selected</button>' +
      '</div>' +
      (canWrite ? '<div class="dr-hint">Click to select · Shift-click range · double-click a cell to edit · Enter=add · Del=delete</div>' : '') +
    '</div>';

    if (!draws.length && !structuralNodes().length) {
      host.innerHTML = toolbar + emptyMsg('No drawings yet. Build levels with “+ Level”, add rows with “+ Add drawing”, or “Import Excel”.');
      return;
    }
    if (!disp.length) { host.innerHTML = toolbar + emptyMsg('Nothing matches the filters.'); return; }

    var head = '<tr>' +
      (CB ? '<th class="dr-cb dr-freeze dr-freeze-cb"><input type="checkbox" id="dr-selall" title="Select all shown"></th>' : '') +
      '<th class="dr-c-code dr-freeze dr-freeze-code">Code</th>' +
      '<th class="dr-c-title dr-freeze dr-freeze-title">Sheet Title / Description</th>' +
      '<th class="dr-c-rev">Rev</th><th class="dr-c-status">Status</th>' +
      '<th class="dr-r dr-c-sh">Sh</th><th class="dr-r dr-c-ap">Appr</th>' +
      '<th class="dr-c-date">Latest Sub.</th><th class="dr-c-date">Approval</th>' +
      '<th class="dr-c-date dr-c-needby" title="Required approval = linked activity start − lead days">Need-by</th>' +
      '<th class="dr-c-resp">Resp.</th><th class="dr-actcol"></th></tr>';

    var html = toolbar + '<div class="pd-card dr-tablecard"><table class="pd-table dr-table dr-grid'+(CB?' dr-has-cb':'')+'" style="--cbw:'+(CB?'34px':'0px')+'" tabindex="0"><thead>'+head+'</thead><tbody>';
    disp.forEach(function (item) {
      html += item.type==='drawing' ? drawRowHTML(item, CB) : groupRowHTML(item, CB);
    });
    html += '</tbody></table></div>';
    host.innerHTML = html;
    wireRegister(host, disp);
  }

  var COLSPAN_LABEL = 2;   // Code + Title under a group label (frozen block)
  function groupRowHTML(item, CB) {
    var tot=0, ap=0;
    item.list.forEach(function (r){ tot += num(r.no_of_sheets)||0; ap += num(r.approved_sheets)||0; });
    var pct = tot ? Math.round(ap/tot*100) : 0;
    var ids = item.list.map(function(r){return r.id;}).join(',');
    var grpCb = CB ? '<td class="dr-cb dr-freeze dr-freeze-cb"><input type="checkbox" data-selgrp="'+ids+'" title="Select group"></td>' : '';
    var isCol = !!collapsed[item.key];
    var caret = '<span class="dr-caret'+(isCol?' dr-caret-col':'')+'">▾</span>';
    return '<tr class="dr-grp dr-grp-'+item.type+' dr-lvl-'+item.level+(isCol?' dr-collapsed':'')+
        (item.key===activeGrpKey?' dr-grpactive':'')+'"'+
        ' data-grp="'+Fmt.esc(item.key)+'" data-kind="'+item.type+'" data-nodeid="'+(item.nodeId||'')+'"'+
        ' data-phase="'+Fmt.esc(item.ctx.phase||'')+'" data-disc="'+Fmt.esc(item.ctx.discipline||'')+'" data-cat="'+Fmt.esc(item.ctx.category||'')+'">' + grpCb +
      '<td colspan="'+COLSPAN_LABEL+'" class="dr-indent dr-freeze dr-freeze-grp"><span class="dr-grplabel">'+caret+
        (item.code?'<span class="dr-gcode">'+Fmt.esc(item.code)+'</span> ':'')+
        '<strong class="dr-glabel">'+Fmt.esc(item.label)+'</strong> <span class="dr-count">'+item.list.length+' dwg</span></span></td>' +
      '<td class="dr-c-rev"></td>' +  // Rev
      '<td></td>' +                   // Status col
      '<td class="dr-r">'+tot+'</td>' +
      '<td class="dr-r">'+ap+'</td>' +
      '<td colspan="2">'+progressBar(pct)+'</td>' +
      '<td></td>' +   // Need-by
      '<td></td>' +   // Resp.
      '<td class="dr-nowrap dr-actcol">'+(canWrite?'<button class="dr-lvldel" title="Delete this level and everything under it">✕</button>':'')+'</td></tr>';
  }

  function progressBar(pct) {
    return '<div class="dr-prog"><div class="dr-prog-fill" style="width:'+pct+'%;"></div>' +
           '<span class="dr-prog-txt">'+pct+'%</span></div>';
  }

  function statusSelect(r) {
    return '<select class="dr-stsel dr-st-'+statusCls(r.status)+'" data-stat="'+r.id+'">' +
      '<option value=""'+(!r.status?' selected':'')+'>—</option>' +
      STATUSES.map(function(s){ return '<option'+(r.status===s?' selected':'')+'>'+s+'</option>'; }).join('') +
    '</select>';
  }

  function drawRowHTML(item, CB) {
    var r = item.row;
    var code = r.drawing_code || r.drawing_no || '';
    var tot = num(r.no_of_sheets)||0, ap = num(r.approved_sheets)||0;
    var pct = Math.round(pctApproved(r)*100);
    var sub = latestSub(r,'actual') || latestSub(r,'planned');
    var appr = r.actual_approval || r.planned_approval;
    var cb = CB ? '<td class="dr-cb dr-freeze dr-freeze-cb"><input type="checkbox" data-sel="'+r.id+'"'+(selected[r.id]?' checked':'')+'></td>' : '';
    var ed = CB ? ' dr-ed' : '';
    var isDup = !!dupSet[dupKey(r)];
    var dupMark = isDup ? ' <span class="dr-dupmark" title="Duplicate code within this phase — reconcile">⚠</span>' : '';
    return '<tr class="dr-drow dr-lvl-'+(item.level||4)+(selected[r.id]?' dr-selrow':'')+(isDup?' dr-dup':'')+'" data-id="'+r.id+'"'+(reorderEnabled()?' draggable="true"':'')+'>' + cb +
      '<td class="dr-indent dr-freeze dr-freeze-code'+ed+'" data-f="code" data-t="text"><span class="dr-code">'+Fmt.esc(code)+'</span>'+dupMark+'</td>' +
      '<td class="dr-c-title dr-freeze dr-freeze-title'+ed+'" data-f="title" data-t="text">'+Fmt.esc(r.title)+(r.description?'<div class="dr-sub">'+Fmt.esc(r.description)+'</div>':'')+'</td>' +
      '<td class="dr-c-rev'+ed+'" data-f="revision" data-t="text">'+Fmt.esc(r.revision)+'</td>' +
      '<td class="dr-c-status">'+(CB?statusSelect(r):'<span class="dr-pill '+statusCls(r.status)+'">'+Fmt.esc(r.status||'—')+'</span>')+'</td>' +
      '<td class="dr-r dr-c-sh'+ed+'" data-f="no_of_sheets" data-t="num">'+tot+'</td>' +
      '<td class="dr-r dr-c-ap'+ed+'" data-f="approved_sheets" data-t="num">'+ap+' <span class="dr-mini">'+pct+'%</span></td>' +
      '<td class="dr-nowrap dr-c-date'+ed+'" data-f="latest_sub" data-t="date">'+(sub?Fmt.date(sub):'—')+'</td>' +
      '<td class="dr-nowrap dr-c-date'+ed+'" data-f="actual_approval" data-t="date">'+(appr?Fmt.date(appr):'—')+'</td>' +
      '<td class="dr-nowrap dr-c-date dr-c-needby">'+needByCellHtml(r)+'</td>' +
      '<td class="dr-c-resp'+ed+'" data-f="responsible" data-t="text">'+Fmt.esc(r.responsible)+'</td>' +
      '<td class="dr-nowrap dr-actcol">'+(r.file_url?'<button class="dr-iconbtn" data-view="'+Fmt.esc(r.file_url)+'" title="View file">▤</button>':'')+
        '<button class="dr-iconbtn" data-edit="'+r.id+'" title="Full editor">✎</button>' +
        '<button class="dr-iconbtn dr-rowbtn-del" data-del="'+r.id+'" title="Delete">✕</button></td>' +
    '</tr>';
  }

  function emptyMsg(msg) {
    return '<div class="pd-card dr-empty">'+Fmt.esc(msg)+'</div>';
  }

  // ------------------------------------------------------------- wiring ------
  function wireRegister(host, disp) {
    var xall = host.querySelector('#dr-xall');
    if (xall) xall.onclick = function(){
      var pkeys = disp.filter(function(x){return x.type==='phase';}).map(function(x){return x.key;});
      var anyOpen = pkeys.some(function (k){ return !collapsed[k]; });
      if (anyOpen) pkeys.forEach(function (k){ collapsed[k] = true; });
      else collapsed = {};
      saveUI(); render();
    };
    // duplicate-code legend: click to toggle "show only duplicates"
    var dupleg = host.querySelector('#dr-duplegend');
    if (dupleg) dupleg.onclick = function(){ filters.dupsOnly = !filters.dupsOnly; render(); };
    // jump to a phase [feature 6]
    var jump = host.querySelector('#dr-jump');
    if (jump) jump.onchange = function(){
      var key = jump.value; if (!key) return;
      delete collapsed[key]; saveUI(); render();
      var tr = document.querySelector('tr.dr-grp[data-grp="'+key.replace(/"/g,'\\"')+'"]');
      if (tr) tr.scrollIntoView({ block:'start', behavior:'smooth' });
    };
    // Group rows: click ANYWHERE on the row to collapse/expand (Project Schedule's
    // Excel-style behaviour). Previously only the small label span toggled, so
    // clicking the rest of the row appeared to do nothing.
    host.querySelectorAll('tr.dr-grp').forEach(function (tr){
      var glabel = tr.querySelector('.dr-glabel');
      tr.addEventListener('click', function (e){
        setContextFromRow(tr);
        markActiveGroup(host, tr);
        // The label is the rename target (dblclick) and buttons/checkboxes own
        // their own clicks — everything else on the row toggles.
        if (e.target === glabel || e.target.closest('button,input,select,.dr-editin')) return;
        var key = tr.dataset.grp;
        if (collapsed[key]) delete collapsed[key]; else collapsed[key] = true;
        saveUI(); render();
      });
      if (glabel && canWrite) glabel.ondblclick = function(e){ e.stopPropagation(); beginRenameGroup(tr, glabel); };
      var dl = tr.querySelector('.dr-lvldel');
      if (dl) dl.onclick = function(e){ e.stopPropagation(); deleteLevel(tr.dataset); };
    });

    host.querySelectorAll('[data-view]').forEach(function (b){ b.onclick=function(e){ e.stopPropagation(); viewFile(b.dataset.view); }; });
    host.querySelectorAll('[data-edit]').forEach(function (b){ b.onclick=function(e){ e.stopPropagation(); openForm(rows.find(function(x){return x.id===b.dataset.edit;})); }; });
    host.querySelectorAll('[data-del]').forEach(function (b){ b.onclick=function(e){ e.stopPropagation(); del(rows.find(function(x){return x.id===b.dataset.del;})); }; });
    if (!canWrite) { return; }

    // status dropdowns (always visible)
    host.querySelectorAll('select[data-stat]').forEach(function (sel){
      sel.onclick = function(e){ e.stopPropagation(); };
      sel.onchange = async function(){
        var r = rows.find(function(x){return x.id===sel.dataset.stat;}); if(!r) return;
        await persistCell(r, { status: sel.value });
        sel.className = 'dr-stsel dr-st-'+statusCls(sel.value);
      };
    });

    // inline edit (double-click a cell)
    host.querySelectorAll('td.dr-ed').forEach(function (td){
      td.ondblclick = function(e){ e.stopPropagation(); beginEdit(td); };
    });

    // row selection (single click)
    host.querySelectorAll('tr.dr-drow').forEach(function (tr){
      tr.addEventListener('click', function(e){
        if (e.target.closest('.dr-ed') && e.detail>1) return;  // ignore the dblclick-to-edit
        if (e.target.closest('button,select,input,.dr-editing')) return;
        // Selecting a drawing also makes ITS group the add target, so "+ Add
        // drawing" / Enter inserts a sibling next to what you just clicked
        // (Project Schedule's behaviour). Previously selCtx only followed group
        // rows, so adding after clicking a drawing filed it under whatever group
        // was last touched — or ungrouped.
        setContextFromRow(tr);
        markActiveGroup(host, null);
        clickSelect(tr.dataset.id, e);
      });
    });

    // drag-to-reorder within a group (Project Schedule's row drag)
    var pane = host.querySelector('.dr-grid');
    if (pane) pane.classList.toggle('dr-reorder', reorderEnabled());
    if (reorderEnabled()) host.querySelectorAll('tr.dr-drow[draggable]').forEach(function (tr){
      tr.addEventListener('dragstart', function (e){
        // Don't start a drag out of a cell that's being edited.
        if (e.target.closest && e.target.closest('.dr-editing')) { e.preventDefault(); return; }
        _dragId = tr.dataset.id;
        try { e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', _dragId); } catch(err){}
        tr.classList.add('dr-rowdragging');
      });
      tr.addEventListener('dragover', function (e){
        if (!_dragId || _dragId===tr.dataset.id) return;
        var d = rows.find(function(x){return x.id===_dragId;});
        var t = rows.find(function(x){return x.id===tr.dataset.id;});
        if (!d || !t || groupKeyOf(d)!==groupKeyOf(t)) return;   // only within the same group
        e.preventDefault(); e.dataTransfer.dropEffect='move';
        var b = tr.getBoundingClientRect();
        var below = (e.clientY - b.top) > b.height/2;
        tr.classList.toggle('dr-drop-below', below);
        tr.classList.toggle('dr-drop-above', !below);
      });
      tr.addEventListener('dragleave', function(){ tr.classList.remove('dr-drop-above','dr-drop-below'); });
      tr.addEventListener('drop', function (e){
        e.preventDefault();
        var below = tr.classList.contains('dr-drop-below');
        tr.classList.remove('dr-drop-above','dr-drop-below');
        if (_dragId && _dragId!==tr.dataset.id) reorderDrop(_dragId, tr.dataset.id, !below);
        _dragId = null;
      });
      tr.addEventListener('dragend', function (){
        tr.classList.remove('dr-rowdragging');
        document.querySelectorAll('.dr-drop-above,.dr-drop-below').forEach(function(x){
          x.classList.remove('dr-drop-above','dr-drop-below'); });
        _dragId = null;
      });
    });

    // checkboxes
    host.querySelectorAll('input[data-sel]').forEach(function (cb){
      cb.onclick = function(e){ e.stopPropagation(); };
      cb.onchange = function(){ if (cb.checked) selected[cb.dataset.sel]=true; else delete selected[cb.dataset.sel]; lastClickedId=cb.dataset.sel; refreshSel(host); };
    });
    host.querySelectorAll('input[data-selgrp]').forEach(function (cb){
      cb.onclick = function(e){ e.stopPropagation(); };
      cb.onchange = function(){
        cb.dataset.selgrp.split(',').forEach(function (id){ if(!id) return; if (cb.checked) selected[id]=true; else delete selected[id]; });
        refreshSel(host);
      };
    });
    var all = host.querySelector('#dr-selall');
    if (all) all.onclick=function(e){e.stopPropagation();}, all.onchange = function(){ visibleIds.forEach(function (id){ if(all.checked) selected[id]=true; else delete selected[id]; }); render(); };
    var clr = host.querySelector('#dr-selclear'); if (clr) clr.onclick = function(){ selected={}; render(); };
    var sd  = host.querySelector('#dr-seldel');   if (sd)  sd.onclick  = deleteSelected;
    var ss  = host.querySelector('#dr-selstatus'); if (ss) ss.onchange = function(){ if (ss.value) setStatusSelected(ss.value); };

    // keyboard shortcuts (grid focused)
    var grid = host.querySelector('.dr-grid');
    if (grid) grid.onkeydown = onGridKey;

    refreshSel(host);
  }

  function refreshSel(host) {
    host = host || document;
    var ids = Object.keys(selected).filter(function (id){ return visibleIds.indexOf(id)!==-1; });
    var bar = host.querySelector('#dr-selbar');
    if (bar) { bar.hidden = ids.length===0; var c=host.querySelector('#dr-selcount'); if(c) c.textContent = ids.length + ' selected'; }
    var all = host.querySelector('#dr-selall'); if (all) all.checked = visibleIds.length>0 && ids.length===visibleIds.length;
    // reflect row highlight without full re-render
    host.querySelectorAll('tr.dr-drow').forEach(function (tr){
      tr.classList.toggle('dr-selrow', !!selected[tr.dataset.id]);
      var cb = tr.querySelector('input[data-sel]'); if (cb) cb.checked = !!selected[tr.dataset.id];
    });
  }

  // --------------------------------------------------------- drag reorder ----
  // Reorder a drawing within its own group (Project Schedule's row drag).
  //
  // Phase order is derived from each phase's MINIMUM sort_order (phaseOrderKey),
  // so renumbering rows freely would silently reshuffle the phases. Instead we
  // take the group's OWN existing sort_order values as a pool and re-deal them in
  // the new order: the multiset of values per phase is unchanged, so the phase
  // min — and therefore the phase order — cannot move. `rows` arrives ordered by
  // sort_order (NULLs last), so the pool is already in display order and a NULL
  // simply re-deals to whichever row should sort last.
  async function reorderDrop(draggedId, targetId, before){
    if (!reorderEnabled()) return;
    var dr = rows.find(function(x){ return x.id===draggedId; });
    var tg = rows.find(function(x){ return x.id===targetId; });
    if (!dr || !tg || dr.id===tg.id) return;
    if (groupKeyOf(dr) !== groupKeyOf(tg)) {
      UI.toast('Drawings can only be reordered within their own phase / discipline / category.', 'warn');
      return;
    }
    var key = groupKeyOf(dr);
    var members = rows.filter(function(x){ return !isNode(x) && groupKeyOf(x)===key; });
    if (members.length < 2) return;

    var pool = members.map(function(x){ return x.sort_order == null ? null : +x.sort_order; });
    var ids  = members.map(function(x){ return x.id; });
    var from = ids.indexOf(draggedId); if (from < 0) return;
    ids.splice(from, 1);
    var ti = ids.indexOf(targetId); if (ti < 0) ti = ids.length - 1;
    ids.splice(before ? ti : ti + 1, 0, draggedId);

    var changes = [];
    ids.forEach(function (id, i) {
      var r = rows.find(function(x){ return x.id===id; });
      var v = pool[i];
      var old = r.sort_order == null ? null : +r.sort_order;
      if (old !== v) { r.sort_order = v; changes.push({ id:id, val:v }); }
    });
    if (!changes.length) return;

    sortRows();
    render();   // optimistic: the local rows already carry the new order
    var res = await Promise.all(changes.map(function (c) {
      return sb().from(TABLE).update({ sort_order:c.val, updated_at:new Date().toISOString() }).eq('id', c.id);
    }));
    var bad = null;
    for (var i=0;i<res.length;i++){ if (res[i] && res[i].error) { bad = res[i].error; break; } }
    if (bad) { UI.toast(bad.message, 'error'); await load(); return; }
    UI.toast('Reordered.', 'ok');
  }

  // ------------------------------------------------- context / selection ----
  var selCtx = { phase:'', discipline:'', category:'', level:0 };
  // The group row that "+ Add drawing" will insert into. It had no visual state
  // at all before, so the add target was invisible (Project Schedule highlights
  // the selected WBS row); this keeps it marked across re-renders.
  var activeGrpKey = null;

  function markActiveGroup(host, tr){
    activeGrpKey = tr ? tr.dataset.grp : null;
    (host || document).querySelectorAll('tr.dr-grp').forEach(function (x){
      x.classList.toggle('dr-grpactive', !!activeGrpKey && x.dataset.grp === activeGrpKey);
    });
  }

  function setContextFromRow(tr){
    if (tr.classList.contains('dr-drow')) {
      var r = rows.find(function(x){return x.id===tr.dataset.id;});
      if (r) selCtx = { phase:r.phase||'', discipline:r.discipline||'', category:(r.category||'').trim(), level:4 };
    } else {
      selCtx = { phase:tr.dataset.phase||'', discipline:tr.dataset.disc||'', category:tr.dataset.cat||'',
                 level: tr.dataset.kind==='phase'?1 : tr.dataset.kind==='disc'?2 : 3 };
    }
  }

  function clickSelect(id, e){
    if (e.shiftKey && lastClickedId) {
      var a=visibleIds.indexOf(lastClickedId), b=visibleIds.indexOf(id);
      if (a>-1 && b>-1) {
        if (!(e.ctrlKey||e.metaKey)) selected = {};
        var lo=Math.min(a,b), hi=Math.max(a,b);
        for (var i=lo;i<=hi;i++) selected[visibleIds[i]] = true;
      }
    } else if (e.ctrlKey||e.metaKey) {
      if (selected[id]) delete selected[id]; else selected[id]=true; lastClickedId=id;
    } else {
      selected = {}; selected[id]=true; lastClickedId=id;
    }
    refreshSel(document);
  }

  function onGridKey(e){
    if (!canWrite) return;
    var tag=(e.target.tagName||'').toLowerCase();
    if (tag==='input'||tag==='select'||tag==='textarea'||e.target.isContentEditable) return;
    if (e.key==='Escape'){ selected={}; lastClickedId=null; refreshSel(document); return; }
    if ((e.ctrlKey||e.metaKey) && (e.key==='a'||e.key==='A')){ e.preventDefault(); visibleIds.forEach(function(id){selected[id]=true;}); refreshSel(document); return; }
    if (e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();
      var idx = lastClickedId ? visibleIds.indexOf(lastClickedId) : -1;
      idx += (e.key==='ArrowDown'?1:-1);
      if (idx<0) idx=0; if (idx>=visibleIds.length) idx=visibleIds.length-1;
      var id=visibleIds[idx]; if(!id) return;
      if (e.shiftKey && lastClickedId) selected[id]=true; else { selected={}; selected[id]=true; }
      lastClickedId=id; refreshSel(document);
      var tr=document.querySelector('tr.dr-drow[data-id="'+id+'"]'); if(tr) tr.scrollIntoView({block:'nearest'});
      return;
    }
    if (e.key==='Delete'||e.key==='Backspace'){ if(Object.keys(selected).length){ e.preventDefault(); deleteSelected(); } return; }
    if (e.key==='Enter'){ e.preventDefault(); addDrawing(); return; }
  }

  // ------------------------------------------------------- inline editing ----
  async function persistCell(r, patch){
    if ('no_of_sheets' in patch || 'approved_sheets' in patch) {
      var ns = ('no_of_sheets' in patch) ? num(patch.no_of_sheets) : num(r.no_of_sheets);
      var as = ('approved_sheets' in patch) ? num(patch.approved_sheets) : num(r.approved_sheets);
      patch.approved_pct = ns ? as/ns : 0;
    }
    patch.updated_at = new Date().toISOString();
    Object.assign(r, patch);   // optimistic — applies whether online or queued offline
    if (window.PDSync) {
      var w = await PDSync.write({ table: TABLE, op: 'update', id: r.id, patch: patch });
      if (!w.ok) { UI.toast((w.error && w.error.message) || 'Save failed', 'error'); return false; }
      PDSync.cachePut('dr:' + pid, rows);   // keep the offline read-cache in step so a reload shows the pending edit
      return true;   // queued offline writes still count as saved-locally
    }
    var res = await sb().from(TABLE).update(patch).eq('id', r.id);
    if (res.error) { UI.toast(res.error.message, 'error'); return false; }
    return true;
  }

  function beginEdit(td){
    if (!canWrite || td.classList.contains('dr-editing')) return;
    var tr=td.closest('tr.dr-drow'); if(!tr) return;
    var r=rows.find(function(x){return x.id===tr.dataset.id;}); if(!r) return;
    var f=td.dataset.f, t=td.dataset.t;
    var cur = f==='code' ? (r.drawing_code||r.drawing_no||'')
            : f==='latest_sub' ? (latestSub(r,'actual')||'')
            : (r[f]!=null?r[f]:'');
    td.classList.add('dr-editing');
    broadcastSel(r.id, f, true);
    var input=document.createElement('input');
    input.className='dr-editin'; input.type = (t==='num'?'number':t==='date'?'date':'text'); input.value=cur;
    td.innerHTML=''; td.appendChild(input); input.focus(); if (t!=='date') input.select();
    var done=false;
    function commit(save){
      if (done) return; done=true;
      td.classList.remove('dr-editing');
      broadcastSel(r.id, f, false);
      if (!save) { render(); flushDeferredRemote(); return; }
      var val=input.value.trim(), patch={};
      if (f==='code'){ patch.dwg_number=val; patch.drawing_no=val; patch.drawing_code=val; }
      else if (f==='latest_sub'){
        // update the latest revision's actual submission date (create one if none)
        var subs = Array.isArray(r.submissions) ? r.submissions.slice() : [];
        if (subs.length){ subs[subs.length-1] = Object.assign({}, subs[subs.length-1], { actual: val||null }); }
        else subs = [{ rev:0, planned:null, actual: val||null }];
        patch.submissions = subs; patch.issue_date = val||null;
      }
      else if (t==='num'){ patch[f]=num(val); }
      else if (t==='date'){ patch[f]=val||null; }
      else patch[f]=val;
      persistCell(r, patch).then(function(){ render(); flushDeferredRemote(); });
    }
    input.onkeydown=function(e){ if(e.key==='Enter'){e.preventDefault();commit(true);} else if(e.key==='Escape'){e.preventDefault();commit(false);} };
    input.onblur=function(){ commit(true); };
  }

  function editRowField(id, f){
    var td=document.querySelector('tr.dr-drow[data-id="'+id+'"] td[data-f="'+f+'"]');
    if (td){ td.scrollIntoView({block:'nearest'}); beginEdit(td); }
  }

  // ----------------------------------------------- rename a structural level --
  function beginRenameGroup(tr, glabel){
    var kind=tr.dataset.kind;
    var oldLabel = kind==='phase'?tr.dataset.phase : kind==='disc'?tr.dataset.disc : tr.dataset.cat;
    var input=document.createElement('input'); input.className='dr-editin'; input.value=oldLabel||'';
    glabel.replaceWith(input); input.focus(); input.select();
    var done=false;
    function commit(save){
      if (done) return; done=true;
      var v=input.value.trim();
      if (!save || !v || v===oldLabel){ render(); return; }
      renameGroup(tr.dataset, kind, oldLabel, v).then(function(){ load(); });
    }
    input.onkeydown=function(e){ if(e.key==='Enter'){e.preventDefault();commit(true);} else if(e.key==='Escape'){e.preventDefault();commit(false);} };
    input.onblur=function(){ commit(true); };
  }

  async function renameGroup(ds, kind, oldVal, newVal){
    var patch = kind==='phase'?{phase:newVal} : kind==='disc'?{discipline:newVal} : {category:newVal};
    var q = sb().from(TABLE).update(patch).eq('project_id', pid);
    if (kind==='phase') q=q.eq('phase', oldVal);
    else if (kind==='disc') q=q.eq('phase', ds.phase).eq('discipline', oldVal);
    else q=q.eq('phase', ds.phase).eq('discipline', ds.disc).eq('category', oldVal);
    var res=await q; if (res.error) UI.toast(res.error.message,'error');
    // keep collapse state under the renamed key
    if (kind==='phase'){ if(collapsed['P:'+oldVal]){ collapsed['P:'+newVal]=true; delete collapsed['P:'+oldVal]; } }
  }

  // Delete a whole level (phase / discipline / category) and everything under it.
  async function deleteLevel(ds){
    var kind=ds.kind, label = kind==='phase'?ds.phase : kind==='disc'?ds.disc : ds.cat;
    // count affected drawings for the confirm message
    var n = drawingRows().filter(function(r){
      if (kind==='phase') return (r.phase||'')===ds.phase;
      if (kind==='disc')  return (r.phase||'')===ds.phase && (r.discipline||'')===ds.disc;
      return (r.phase||'')===ds.phase && (r.discipline||'')===ds.disc && ((r.category||'').trim())===ds.cat;
    }).length;
    if (!confirm('Delete "'+label+'" and everything under it'+(n?' ('+n+' drawing'+(n>1?'s':'')+')':'')+'? This cannot be undone.')) return;
    var q = sb().from(TABLE).delete().eq('project_id', pid);
    if (kind==='phase') q=q.eq('phase', ds.phase);
    else if (kind==='disc') q=q.eq('phase', ds.phase).eq('discipline', ds.disc);
    else q=q.eq('phase', ds.phase).eq('discipline', ds.disc).eq('category', ds.cat);
    var res=await q; if (res.error){ UI.toast(res.error.message,'error'); return; }
    UI.toast('Deleted', 'ok'); load();
  }

  // ------------------------------------------------ add levels / drawings -----
  function nextOrder(){ return (rows.length ? Math.max.apply(null, rows.map(function(x){return x.sort_order||0;})) : 0) + 1; }
  function phaseNames(){ var s={}; rows.forEach(function(r){ if(r.phase)s[r.phase]=1; }); return Object.keys(s); }
  function discNames(ph){ var s={}; rows.forEach(function(r){ if((r.phase||'')===ph && r.discipline)s[r.discipline]=1; }); return Object.keys(s); }
  function catNames(ph,d){ var s={}; rows.forEach(function(r){ if((r.phase||'')===ph&&(r.discipline||'')===d&&r.category)s[r.category]=1; }); return Object.keys(s); }
  function uniqueName(base, taken){ var n=base, i=2; while(taken.indexOf(n)!==-1){ n=base+' '+(i++); } return n; }

  async function addLevel(kind){
    if (!pid){ UI.toast('Select a project first','warn'); return; }
    var ctx=selCtx||{};
    var data={ project_id:pid, created_by:uid, node_kind:kind, no_of_sheets:0, approved_sheets:0, sort_order:nextOrder() };
    if (kind==='phase'){ data.phase=uniqueName('New Phase', phaseNames()); }
    else if (kind==='discipline'){ if(!ctx.phase){ UI.toast('Select a phase first','warn'); return; } data.phase=ctx.phase; data.discipline=uniqueName('New Discipline', discNames(ctx.phase)); }
    else if (kind==='category'){ if(!ctx.phase||!ctx.discipline){ UI.toast('Select a discipline first','warn'); return; } data.phase=ctx.phase; data.discipline=ctx.discipline; data.category=uniqueName('New Category', catNames(ctx.phase,ctx.discipline)); }
    data.title = data.category||data.discipline||data.phase;
    var res=await sb().from(TABLE).insert(data); if(res.error){ UI.toast(res.error.message,'error'); return; }
    if (kind!=='phase') delete collapsed['P:'+ctx.phase];
    if (kind==='category') delete collapsed['D:'+ctx.phase+'|'+ctx.discipline];
    await load();
    UI.toast(NODE_LABELS[kind]+' added — double-click its name to rename', 'ok');
  }

  function autoNumber(group, ctx){
    var nums=group.map(function(r){ var m=String(r.dwg_number||r.drawing_no||'').match(/(\d+)\s*$/); return m?parseInt(m[1],10):null; }).filter(function(x){return x!=null;});
    var next=(nums.length?Math.max.apply(null,nums):0)+1;
    var proto=group.find(function(r){ return /\d/.test(String(r.dwg_number||r.drawing_no||'')); });
    if (proto){ var pm=String(proto.dwg_number||proto.drawing_no).match(/^(.*?)(\d+)\s*$/); if(pm){ return pm[1]+String(next).padStart(pm[2].length,'0'); } }
    var dc=discCodeOf(ctx.discipline); var letter=dc?dc[0]:(ctx.discipline?ctx.discipline[0].toUpperCase():'D');
    return letter+'-'+String(next).padStart(3,'0');
  }

  async function addDrawing(){
    if (!pid){ UI.toast('Select a project first','warn'); return; }
    var ctx=selCtx||{phase:'',discipline:'',category:''};
    // No target selected → open the full Add form so the planner sets the
    // phase/discipline/category explicitly (matches Project Schedule) instead of
    // silently creating a confusing ungrouped orphan row.
    if (!ctx.phase){ UI.toast('Pick where it goes — or select a phase/discipline first to quick-add', 'warn'); openForm(null); return; }
    var sameGroup=function(r){
      return (r.phase||'')===(ctx.phase||'') && (r.discipline||'')===(ctx.discipline||'') && ((r.category||'').trim())===((ctx.category||''));
    };
    var group=drawingRows().filter(sameGroup);
    var code=autoNumber(group, ctx);
    var data={ project_id:pid, created_by:uid, node_kind:'drawing',
      phase:ctx.phase||'', discipline:ctx.discipline||'', category:ctx.category||'',
      title:'', status:'For Review', no_of_sheets:1, approved_sheets:0, approved_pct:0,
      submissions:[], dwg_number:code, drawing_no:code, drawing_code:code, sort_order:nextOrder() };
    var res=await sb().from(TABLE).insert(data); if(res.error){ UI.toast(res.error.message,'error'); return; }
    // expand the target group so the new row is visible (buildModel keys the
    // phase by phase-text OR 'Ungrouped' — mirror that, else the row is hidden)
    var ph=ctx.phase||'Ungrouped', d=ctx.discipline||'—';
    delete collapsed['P:'+ph];
    delete collapsed['D:'+ph+'|'+d];
    if (ctx.category) delete collapsed['C:'+ph+'|'+d+'|'+ctx.category];
    await load();
    // focus the newly-added row's title for immediate typing
    var added=drawingRows().filter(function(r){ return sameGroup(r) && r.dwg_number===code && !r.title; }).pop();
    if (added){ lastClickedId=added.id; var tr=document.querySelector('tr.dr-drow[data-id="'+added.id+'"]'); if(tr) tr.scrollIntoView({block:'center'}); editRowField(added.id, 'title'); }
  }

  // ----------------------------------------------------- progress dashboard --
  function renderProgress() {
    var host = document.getElementById('dr-view');
    var draws = drawingRows();
    if (!draws.length) { host.innerHTML = emptyMsg('No drawings to summarise yet.'); return; }

    var totSheets=0, subSheets=0, apSheets=0;
    draws.forEach(function (r){
      var t=num(r.no_of_sheets)||0, a=num(r.approved_sheets)||0;
      totSheets+=t; apSheets+=a;
      if (latestSub(r,'actual')) subSheets+=t;
    });
    var balance = totSheets - apSheets;

    var kpis = kpiSection('Register Overview',
      kpi(draws.length, 'Drawings') +
      kpi(totSheets, 'Total sheets') +
      kpi(subSheets, 'Submitted') +
      kpi(apSheets, 'Approved') +
      kpi((totSheets?Math.round(apSheets/totSheets*100):0)+'%', 'Approved %', 'ok') +
      kpi(balance, 'Balance', balance>0?'warn':''));

    // by phase
    var byPhase = groupAgg('phase');
    var byDisc  = groupAgg('discipline');
    var host2 = '<div class="dr-dash-grid">' +
      progTable('Progress by Phase', byPhase, PHASES) +
      progTable('Progress by Trade', byDisc, Object.keys(DISCIPLINES).map(disciplineName)) +
    '</div>';

    var renderPeriodChart = function () {
      var chart = document.getElementById('dr-period-chart');
      var data = periodScaled(periodBuckets(periodMode), periodValueMode, draws.length);
      chart.innerHTML = periodChartSVG(data, periodValueMode);
      wirePeriodHover(chart, data, periodValueMode);
    };

    host.innerHTML = kpis +
      '<div class="dr-dash-grid">' +
        '<div class="pd-card"><h3 class="dr-h3">Drawings by Status</h3>' + donutSVG(statusCounts()) + '</div>' +
        '<div class="pd-card"><h3 class="dr-h3">Open Items by Aging</h3>' + agingBarSVG(agingBuckets()) + '</div>' +
      '</div>' +
      '<div class="pd-card"><h3 class="dr-h3">Drawings by Period — Planned vs Actual Approval' +
        '<span class="dr-seg" id="dr-permode">' +
          '<button class="dr-seg-btn active" data-mode="month">Monthly</button>' +
          '<button class="dr-seg-btn" data-mode="quarter">Quarterly</button>' +
        '</span>' +
        '<span class="dr-seg" id="dr-pervalmode">' +
          '<button class="dr-seg-btn active" data-mode="count">#</button>' +
          '<button class="dr-seg-btn" data-mode="pct">%</button>' +
        '</span></h3>' +
        '<div id="dr-period-chart" class="dr-pc-wrap"></div>' +
      '</div>' +
      host2;

    renderPeriodChart();
    var pm = document.getElementById('dr-permode');
    if (pm) pm.querySelectorAll('.dr-seg-btn').forEach(function (b){
      b.onclick = function (){
        periodMode = b.dataset.mode;
        pm.querySelectorAll('.dr-seg-btn').forEach(function (x){ x.classList.toggle('active', x===b); });
        renderPeriodChart();
      };
    });
    var pvm = document.getElementById('dr-pervalmode');
    if (pvm) pvm.querySelectorAll('.dr-seg-btn').forEach(function (b){
      b.onclick = function (){
        periodValueMode = b.dataset.mode;
        pvm.querySelectorAll('.dr-seg-btn').forEach(function (x){ x.classList.toggle('active', x===b); });
        renderPeriodChart();
      };
    });
  }

  // ---- Open Items by Aging (WPM "Work Package by Aging" pattern) -----------
  // Unfiltered — this is an aggregate for the whole project, independent of
  // whatever the Registry/Backlog filter bar currently has selected.
  var AGING_ORDER = ['>60d overdue', '30-60d overdue', '0-30d (current)', 'Future', 'No due date'];
  var AGING_COLOR = { '>60d overdue':'#EE3124', '30-60d overdue':'#d97706',
    '0-30d (current)':'#8a8f98', 'Future':'#DCDBDB', 'No due date':'#c8c8c8' };
  function agingBuckets() {
    var b = {}; AGING_ORDER.forEach(function (k){ b[k]=0; });
    drawingRows().forEach(function (r){
      if (!(!isApprovedStatus(r.status) || r.status==='Revise & Resubmit')) return;
      var a = agingDays(r);
      if (a==null) b['No due date']++;
      else if (a>60) b['>60d overdue']++;
      else if (a>30) b['30-60d overdue']++;
      else if (a>=0) b['0-30d (current)']++;
      else b['Future']++;
    });
    return b;
  }
  // The bar itself is built only from items that HAVE a due date — most
  // projects link only some drawings to the schedule, and letting "No due
  // date" compete for bar space let it swamp the whole chart into one giant
  // grey blob with the genuinely urgent buckets reduced to a sliver. The
  // undated count is still reported, just as a separate line, not a bar segment.
  var AGING_DATED = ['>60d overdue', '30-60d overdue', '0-30d (current)', 'Future'];
  function agingBarSVG(buckets) {
    var noDate = buckets['No due date'] || 0;
    var datedTotal = AGING_DATED.reduce(function (s,k){ return s+buckets[k]; }, 0);
    if (!datedTotal) {
      return '<p class="dr-mut">'+(noDate
        ? 'None of the '+noDate+' open item'+(noDate===1?'':'s')+' are linked to a schedule activity yet — link one from its edit form to see aging here.'
        : 'No open items.') + '</p>';
    }
    var bars = AGING_DATED.filter(function (k){ return buckets[k]>0; }).map(function (k){
      var pct = buckets[k]/datedTotal*100;
      return '<div style="width:'+pct+'%;background:'+AGING_COLOR[k]+';height:100%;display:flex;' +
        'align-items:center;justify-content:center;color:#fff;font-size:11.5px;font-weight:700;" title="'+k+': '+buckets[k]+'">' +
        (pct>6?buckets[k]:'') + '</div>';
    }).join('');
    var legend = AGING_DATED.filter(function (k){ return buckets[k]>0; }).map(function (k){
      return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;margin:4px 14px 0 0;">' +
        '<span style="width:10px;height:10px;background:'+AGING_COLOR[k]+';display:inline-block;border-radius:2px;"></span>' +
        k+' ('+buckets[k]+')</span>';
    }).join('');
    return '<div style="height:36px;border-radius:6px;overflow:hidden;display:flex;">'+bars+'</div>' +
      '<div style="margin-top:8px;">'+legend+'</div>' +
      (noDate ? '<p class="dr-mut" style="font-size:12px;margin:8px 0 0;">+ '+noDate+' open item'+(noDate===1?'':'s')+
        ' not yet linked to a schedule activity (excluded above, no due date to measure against).</p>' : '');
  }

  // ---- Drawings by Period — Planned vs Actual (WPM "Work Package by Period") ---
  var periodMode = 'month';   // 'month' | 'quarter'
  var MNAME3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // Some legacy imports stamp a sentinel/placeholder date (seen live: many rows
  // carrying "2000-01-06" as actual_approval, clearly not a real approval date)
  // rather than leaving the field blank. A single such row would otherwise blow
  // the whole chart's x-axis out to a 25-year range. Treat anything outside a
  // sane project-planning window as "no date" instead of plotting it.
  function periodKeyOf(dateStr, mode) {
    var d = new Date(dateStr + 'T00:00:00'); if (isNaN(d)) return null;
    var y = d.getFullYear(), m = d.getMonth();
    if (y < 2015 || y > 2100) return null;
    if (mode === 'quarter') return y + '-Q' + (Math.floor(m/3)+1);
    return y + '-' + String(m+1).padStart(2,'0');
  }
  function periodLabelOf(key, mode) {
    if (mode === 'quarter') { var p = key.split('-Q'); return 'Q'+p[1]+" '"+p[0].slice(2); }
    var p = key.split('-'); return MNAME3[+p[1]-1] + " '" + p[0].slice(2);
  }
  function periodBuckets(mode) {
    var pMap = {}, aMap = {};
    drawingRows().forEach(function (r) {
      if (r.planned_approval) { var k = periodKeyOf(r.planned_approval, mode); if (k) pMap[k] = (pMap[k]||0)+1; }
      if (r.actual_approval)  { var k2 = periodKeyOf(r.actual_approval, mode); if (k2) aMap[k2] = (aMap[k2]||0)+1; }
    });
    var keys = Object.keys(pMap).concat(Object.keys(aMap)).filter(function (v,i,a){ return a.indexOf(v)===i; }).sort();
    var cumP = 0, cumA = 0;
    return keys.map(function (k) {
      cumP += pMap[k]||0; cumA += aMap[k]||0;
      return { key:k, label:periodLabelOf(k, mode), planned:pMap[k]||0, actual:aMap[k]||0, cumPlanned:cumP, cumActual:cumA };
    });
  }
  function niceCeil(v) {
    if (v<=0) return 1;
    var pow = Math.pow(10, Math.floor(Math.log10(v))), f = v/pow;
    return (f<=1?1:f<=2?2:f<=5?5:10) * pow;
  }
  // '#' shows raw counts; '%' shows every value as a % of all drawings in the
  // project — the conventional S-curve reading (curves climb toward 100%).
  var periodValueMode = 'count';   // 'count' | 'pct'
  function periodScaled(data, mode, total) {
    if (mode !== 'pct' || !total) return data;
    return data.map(function (d) {
      return { key:d.key, label:d.label, planned:d.planned/total*100, actual:d.actual/total*100,
        cumPlanned:d.cumPlanned/total*100, cumActual:d.cumActual/total*100 };
    });
  }
  function periodFmt(v, mode) { return mode==='pct' ? (Math.round(v*10)/10)+'%' : Math.round(v); }

  function periodChartSVG(data, mode) {
    if (!data.length) return '<p class="dr-mut">No planned/actual approval dates recorded yet.</p>';
    var w=960, h=310, padL=44, padR=16, padT=26, padB=38;
    var innerW=w-padL-padR, innerH=h-padT-padB, n=data.length;
    var maxY = mode==='pct' ? 100 :
      niceCeil(Math.max.apply(null, data.map(function (d){ return Math.max(d.planned, d.actual, d.cumPlanned, d.cumActual); }).concat([1])));
    var xStep = innerW/n;
    var groupW = Math.min(xStep*0.62, 46), barW = groupW/2 - 2;
    function X(i){ return padL + i*xStep + xStep/2; }
    function Y(v){ return padT + innerH - (Math.min(v,maxY)/maxY)*innerH; }
    var uid = 'drpc'+Math.random().toString(36).slice(2,8);
    var showLabels = n<=20;

    var bars = data.map(function (d,i){
      var xP = X(i)-groupW/2+barW/2, xA = X(i)+groupW/2-barW/2;
      var bhP = Math.max((Math.min(d.planned,maxY)/maxY)*innerH, d.planned>0?2:0);
      var bhA = Math.max((Math.min(d.actual,maxY)/maxY)*innerH, d.actual>0?2:0);
      var lblP = (showLabels && d.planned>0) ? '<text x="'+xP+'" y="'+(padT+innerH-bhP-4)+'" font-size="8.5" text-anchor="middle" fill="currentColor" opacity="0.65">'+periodFmt(d.planned,mode)+'</text>' : '';
      var lblA = (showLabels && d.actual>0) ? '<text x="'+xA+'" y="'+(padT+innerH-bhA-4)+'" font-size="8.5" text-anchor="middle" fill="#EE3124" opacity="0.85">'+periodFmt(d.actual,mode)+'</text>' : '';
      return '<rect x="'+(xP-barW/2)+'" y="'+(padT+innerH-bhP)+'" width="'+barW+'" height="'+bhP+'" rx="2" fill="var(--pd-line,#DCDBDB)"/>' +
        '<rect x="'+(xA-barW/2)+'" y="'+(padT+innerH-bhA)+'" width="'+barW+'" height="'+bhA+'" rx="2" fill="rgba(238,49,36,.5)"/>' +
        lblP + lblA;
    }).join('');
    function linePts(key){ return data.map(function (d,i){ return X(i)+','+Y(d[key]); }).join(' '); }
    function dots(key,color){ return data.map(function (d,i){ return '<circle cx="'+X(i)+'" cy="'+Y(d[key])+'" r="2.75" fill="'+color+'"/>'; }).join(''); }
    // Area fill under the Planned cumulative line — reads as the "target band"
    // the red Actual line is tracking against, the classic S-curve look.
    var areaPts = 'M'+X(0)+','+Y(0)+' '+data.map(function (d,i){ return 'L'+X(i)+','+Y(d.cumPlanned); }).join(' ') +
      ' L'+X(n-1)+','+(padT+innerH)+' L'+X(0)+','+(padT+innerH)+' Z';
    var gridN = 4, grid = '';
    for (var g=0; g<=gridN; g++) {
      var v = maxY/gridN*g, y = Y(v);
      grid += '<line x1="'+padL+'" y1="'+y+'" x2="'+(w-padR)+'" y2="'+y+'" stroke="var(--pd-line,#e5e5e5)" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>' +
        '<text x="'+(padL-8)+'" y="'+(y+3)+'" font-size="10" text-anchor="end" fill="currentColor" opacity="0.55">'+periodFmt(v,mode)+'</text>';
    }
    var xlabels = data.map(function (d,i){
      if (n>16 && i % Math.ceil(n/16) !== 0) return '';
      return '<text x="'+X(i)+'" y="'+(h-10)+'" font-size="9.5" text-anchor="middle" fill="currentColor" opacity="0.6">'+Fmt.esc(d.label)+'</text>';
    }).join('');
    // Transparent per-period hit zones (drawn last = on top) + a hidden guide
    // line — wired up for hover by wirePeriodHover() right after this is inserted.
    var hits = data.map(function (d,i){
      return '<rect class="dr-pc-hit" data-i="'+i+'" x="'+(X(i)-xStep/2)+'" y="'+padT+'" width="'+xStep+'" height="'+innerH+'" fill="transparent"/>';
    }).join('');
    return '<svg class="dr-pc-svg" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" style="width:100%;height:'+h+'px;display:block;">' +
      '<defs><linearGradient id="'+uid+'" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="var(--pd-ink,#2B2C2B)" stop-opacity="0.16"/>' +
        '<stop offset="100%" stop-color="var(--pd-ink,#2B2C2B)" stop-opacity="0.02"/>' +
      '</linearGradient></defs>' +
      grid + '<path d="'+areaPts+'" fill="url(#'+uid+')" stroke="none"/>' + bars +
      '<polyline fill="none" stroke="var(--pd-ink,#2B2C2B)" stroke-width="2.25" stroke-linejoin="round" points="'+linePts('cumPlanned')+'"/>' +
      '<polyline fill="none" stroke="#EE3124" stroke-width="2.25" stroke-linejoin="round" points="'+linePts('cumActual')+'"/>' +
      dots('cumPlanned','var(--pd-ink,#2B2C2B)') + dots('cumActual','#EE3124') +
      xlabels +
      '<line class="dr-pc-guide" x1="-99" y1="'+padT+'" x2="-99" y2="'+(padT+innerH)+'" stroke="var(--pd-muted,#8A8F98)" stroke-width="1" stroke-dasharray="2 2" opacity="0"/>' +
      hits +
      '</svg>' +
      '<div class="dr-pc-legend">' +
      '<span><i style="display:inline-block;width:11px;height:11px;border-radius:2px;background:var(--pd-line,#DCDBDB);margin-right:5px;vertical-align:middle;"></i>Planned this period</span>' +
      '<span><i style="display:inline-block;width:11px;height:11px;border-radius:2px;background:rgba(238,49,36,.5);margin-right:5px;vertical-align:middle;"></i>Actual this period</span>' +
      '<span><i style="display:inline-block;width:16px;height:2.5px;background:var(--pd-ink,#2B2C2B);margin-right:5px;vertical-align:middle;"></i>Cumulative planned</span>' +
      '<span><i style="display:inline-block;width:16px;height:2.5px;background:#EE3124;margin-right:5px;vertical-align:middle;"></i>Cumulative approved</span>' +
      '</div>';
  }

  // PowerBI-style hover: a floating tooltip + vertical guide line, wired onto the
  // transparent per-period hit zones the SVG above draws on top of everything.
  function wirePeriodHover(container, data, mode) {
    var guide = container.querySelector('.dr-pc-guide');
    var tip = container.querySelector('.dr-pc-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'dr-pc-tip'; container.appendChild(tip); }
    container.querySelectorAll('.dr-pc-hit').forEach(function (hit) {
      var d = data[+hit.dataset.i];
      var cx = (+hit.getAttribute('x')) + (+hit.getAttribute('width'))/2;
      var show = function (e) {
        if (guide) { guide.setAttribute('x1', cx); guide.setAttribute('x2', cx); guide.style.opacity = 1; }
        tip.innerHTML = '<b>'+Fmt.esc(d.label)+'</b>' +
          '<div>Planned this period <b>'+periodFmt(d.planned,mode)+'</b></div>' +
          '<div>Actual this period <b>'+periodFmt(d.actual,mode)+'</b></div>' +
          '<div>Cumulative planned <b>'+periodFmt(d.cumPlanned,mode)+'</b></div>' +
          '<div>Cumulative approved <b>'+periodFmt(d.cumActual,mode)+'</b></div>';
        tip.style.display = 'block';
        var r = container.getBoundingClientRect();
        var x = e.clientX - r.left, y = e.clientY - r.top;
        tip.style.left = Math.max(0, Math.min(x+12, r.width-190)) + 'px';
        tip.style.top = Math.max(0, y-8) + 'px';
      };
      hit.onmouseenter = show; hit.onmousemove = show;
      hit.onmouseleave = function () { tip.style.display='none'; if (guide) guide.style.opacity=0; };
    });
  }

  // Status colors mirror the Registry's own pill colors (statusCls) so the chart
  // and the grid pills read as one system.
  var STATUS_COLOR = { 'For Review':'#d97706', 'Revise & Resubmit':'#dc2626',
    'Approved w/ comments':'#0891b2', 'Approved':'#16a34a', 'Superseded':'#6b7280' };
  function statusCounts() {
    var m = {}; STATUSES.forEach(function (s){ m[s]=0; });
    drawingRows().forEach(function (r){
      var s = r.status && m.hasOwnProperty(r.status) ? r.status : (r.status || 'For Review');
      m[s] = (m[s]||0) + 1;
    });
    return Object.keys(m).filter(function (s){ return m[s]>0; }).map(function (s){
      return { label:s, count:m[s], color: STATUS_COLOR[s] || '#8a8f98' };
    });
  }

  // Generic donut chart + legend (WPM "Work Package by Status" pattern). Pure SVG,
  // no dependency; `currentColor` keeps the center total readable in dark mode.
  function donutSVG(segs) {
    var total = segs.reduce(function (s,x){ return s+x.count; }, 0);
    var r=70, cx=100, cy=100, sw=26, circ=2*Math.PI*r, offset=0;
    var arcs = segs.filter(function (s){ return s.count>0; }).map(function (s){
      var len = total ? (s.count/total)*circ : 0;
      var el = '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="'+s.color+'" stroke-width="'+sw+
        '" stroke-dasharray="'+len+' '+(circ-len)+'" stroke-dashoffset="'+(-offset)+
        '" transform="rotate(-90 '+cx+' '+cy+')"></circle>';
      offset += len; return el;
    }).join('');
    var legend = segs.map(function (s){
      var pct = total ? Math.round(s.count/total*100) : 0;
      return '<div style="display:flex;align-items:center;gap:7px;font-size:12.5px;margin:4px 0;">' +
        '<span style="width:10px;height:10px;border-radius:2px;background:'+s.color+';flex:none;"></span>' +
        '<span style="flex:1;">'+Fmt.esc(s.label)+'</span><b>'+s.count+'</b>' +
        '<span class="dr-mut" style="width:40px;text-align:right;">'+pct+'%</span></div>';
    }).join('') || '<span class="dr-mut">No data</span>';
    return '<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">' +
      '<svg viewBox="0 0 200 200" width="160" height="160" style="flex:none;">'+arcs+
      '<text x="100" y="96" text-anchor="middle" font-size="28" font-weight="700" fill="currentColor">'+total+'</text>' +
      '<text x="100" y="116" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.6">DRAWINGS</text>' +
      '</svg><div style="min-width:200px;flex:1;">'+legend+'</div></div>';
  }

  function groupAgg(key) {
    var m = {};
    drawingRows().forEach(function (r) {
      var k = r[key] || '—';
      var g = m[k] || (m[k]={label:k, dwg:0, sheets:0, submitted:0, approved:0});
      var t=num(r.no_of_sheets)||0, a=num(r.approved_sheets)||0;
      g.dwg++; g.sheets+=t; g.approved+=a;
      if (latestSub(r,'actual')) g.submitted+=t;
    });
    return m;
  }

  function progTable(title, m, order) {
    var keys = Object.keys(m).sort(function (a,b){
      var ia=order.indexOf(a), ib=order.indexOf(b);
      if (ia===-1) ia=99; if (ib===-1) ib=99; return ia-ib || a.localeCompare(b);
    });
    var body = keys.map(function (k){
      var g=m[k]; var bal=g.sheets-g.approved;
      var pct=g.sheets?Math.round(g.approved/g.sheets*100):0;
      return '<tr><td>'+Fmt.esc(g.label)+'</td>' +
        '<td class="dr-r">'+g.dwg+'</td><td class="dr-r">'+g.sheets+'</td>' +
        '<td class="dr-r">'+g.submitted+'</td><td class="dr-r">'+g.approved+'</td>' +
        '<td class="dr-r">'+bal+'</td><td style="min-width:120px;">'+progressBar(pct)+'</td></tr>';
    }).join('') || '<tr><td colspan="7" class="dr-mut">No data</td></tr>';
    return '<div class="pd-card"><h3 class="dr-h3">'+title+'</h3>' +
      '<table class="pd-table dr-table"><thead><tr><th>Group</th>' +
      '<th class="dr-r">Dwg</th><th class="dr-r">Sheets</th><th class="dr-r">Sub.</th>' +
      '<th class="dr-r">Appr.</th><th class="dr-r">Bal.</th><th>Approved %</th></tr></thead>' +
      '<tbody>'+body+'</tbody></table></div>';
  }

  function kpi(val, label, cls) {
    return '<div class="dr-kpi '+(cls?'dr-'+cls:'')+'"><div class="dr-kpi-val">'+val+'</div>' +
           '<div class="dr-kpi-label">'+label+'</div></div>';
  }
  // Groups a KPI row under a small uppercase eyebrow label (WPM "Cost Overview" /
  // "Work Package Status" pattern) so a page with more than one KPI row reads as
  // separate sections instead of one long undifferentiated strip.
  function kpiSection(label, cardsHtml) {
    return '<div class="dr-kpi-section"><div class="dr-kpi-seclabel">'+Fmt.esc(label)+'</div>' +
           '<div class="dr-kpis">'+cardsHtml+'</div></div>';
  }

  // ------------------------------------------------------------ file view ----
  async function viewFile(path) {
    var res = await sb().storage.from(BUCKET).createSignedUrl(path, 60);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    window.open(res.data.signedUrl, '_blank');
  }
  async function uploadFile(file) {
    var safe = file.name.replace(/[^\w.\-]+/g, '_');
    var path = pid + '/' + Date.now() + '_' + safe;
    var res = await sb().storage.from(BUCKET).upload(path, file, { upsert:false });
    if (res.error) throw res.error;
    return path;
  }

  // --------------------------------------------------------- add/edit form ---
  function openForm(r) {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    var isNew = !r; r = r || {};
    var subs = Array.isArray(r.submissions) ? r.submissions.slice() : [];
    if (!subs.length) subs = [{ rev:0, planned:'', actual:'' }];

    function opt(list, val, blank){
      return (blank?'<option value="">—</option>':'') + list.map(function (o){
        return '<option'+(val===o?' selected':'')+'>'+o+'</option>'; }).join('');
    }
    function optMap(map, val){
      return '<option value="">—</option>' + Object.keys(map).map(function (k){
        return '<option value="'+k+'"'+(val===k?' selected':'')+'>'+k+' — '+Fmt.esc(map[k])+'</option>'; }).join('');
    }

    var m = UI.modal(
      '<h2 style="margin-top:0;">'+(isNew?'Add drawing':'Edit drawing')+'</h2>' +
      '<div class="dr-form-sec">Drawing code</div>' +
      '<div class="dr-grid4">' +
        field('Project code','<input class="pd-input" id="f-proj" value="'+Fmt.esc(r.proj_code||projCodeGuess())+'">') +
        field('Building ref','<select class="pd-select" id="f-bld">'+opt(BUILDINGS, r.building_ref, true)+'</select>') +
        field('Company','<select class="pd-select" id="f-co">'+opt(COMPANIES, r.company||'MCC', true)+'</select>') +
        field('Drawing type','<select class="pd-select" id="f-type">'+optMap(TYPES, r.drawing_type)+'</select>') +
      '</div>' +
      '<div class="dr-grid4">' +
        field('Discipline','<select class="pd-select" id="f-disc">'+optMap(DISCIPLINES, r.discipline_code||discCodeOf(r.discipline))+'</select>') +
        field('Floor level','<select class="pd-select" id="f-floor">'+opt(FLOORS, r.floor_level, true)+'</select>') +
        field('Drawing no.','<input class="pd-input" id="f-num" value="'+Fmt.esc(r.dwg_number)+'" placeholder="A-101 / 4750">') +
        field('Revision','<input class="pd-input" id="f-rev" value="'+Fmt.esc(r.revision)+'" placeholder="00">') +
      '</div>' +
      '<div class="dr-code-preview">Code: <span id="f-codeprev"></span></div>' +

      '<div class="dr-form-sec">Sheet</div>' +
      '<div class="dr-grid2">' +
        field('Phase','<select class="pd-select" id="f-phase">'+opt(PHASES, r.phase, true)+'</select>') +
        field('Category','<input class="pd-input" id="f-cat" value="'+Fmt.esc(r.category)+'" placeholder="Floor Plan">') +
      '</div>' +
      field('Sheet title','<input class="pd-input" id="f-title" value="'+Fmt.esc(r.title)+'">') +
      field('Description','<textarea class="pd-textarea" id="f-desc" rows="2">'+Fmt.esc(r.description)+'</textarea>') +
      '<div class="dr-grid3">' +
        field('No. of sheets','<input class="pd-input" type="number" min="0" id="f-sheets" value="'+(r.no_of_sheets!=null?r.no_of_sheets:1)+'">') +
        field('Approved sheets','<input class="pd-input" type="number" min="0" id="f-apsheets" value="'+(r.approved_sheets!=null?r.approved_sheets:0)+'">') +
        field('Responsible','<input class="pd-input" id="f-resp" value="'+Fmt.esc(r.responsible)+'" placeholder="ECTA / In-House">') +
      '</div>' +

      '<div class="dr-form-sec">Submissions <button class="pd-btn pd-btn-sm" id="f-addsub" type="button">+ revision</button></div>' +
      '<div id="f-subs"></div>' +

      '<div class="dr-form-sec">Approval</div>' +
      '<div class="dr-grid3">' +
        field('Status','<select class="pd-select" id="f-status">'+opt(STATUSES, r.status||'For Review', false)+'</select>') +
        field('Planned approval','<input class="pd-input" type="date" id="f-papp" value="'+(r.planned_approval||'')+'">') +
        field('Actual approval','<input class="pd-input" type="date" id="f-aapp" value="'+(r.actual_approval||'')+'">') +
      '</div>' +

      '<div class="dr-form-sec">Schedule link <span class="dr-mut" style="font-weight:400;">— the activity this drawing must be approved for</span></div>' +
      '<div class="dr-grid3">' +
        field('Activity (need-by)','<input class="pd-input" id="f-sact" list="f-sactlist" value="'+Fmt.esc(r.schedule_activity_id)+'" placeholder="e.g. A1010"><datalist id="f-sactlist">'+schedOptions()+'</datalist>') +
        field('Lead days','<input class="pd-input" type="number" min="0" id="f-lead" value="'+(r.lead_days!=null?r.lead_days:'')+'" placeholder="'+LEAD_DEFAULT+'">') +
        field('Required approval','<input class="pd-input" id="f-req" readonly placeholder="—">') +
      '</div>' +
      '<div class="dr-schedhint dr-mut" id="f-schedhint"></div>' +

      field('Remarks','<textarea class="pd-textarea" id="f-rem" rows="2">'+Fmt.esc(r.remarks)+'</textarea>') +
      field('Drawing file (PDF/DWG/image)'+(r.file_url?' — attached; choosing a new one replaces it':''),
            '<input class="pd-input" type="file" id="f-file" accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg">') +
      '<div style="text-align:right;margin-top:10px;"><button class="pd-btn" id="f-cancel" type="button">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="f-save" type="button">Save</button></div>',
      { wide:true }
    );

    function renderSubs() {
      var host = m.el.querySelector('#f-subs');
      host.innerHTML = subs.map(function (s, i){
        return '<div class="dr-subrow">' +
          '<span class="dr-subrev">Rev '+(s.rev!=null?s.rev:i)+'</span>' +
          '<label>Planned<input class="pd-input" type="date" data-sub="'+i+'" data-k="planned" value="'+(s.planned||'')+'"></label>' +
          '<label>Actual<input class="pd-input" type="date" data-sub="'+i+'" data-k="actual" value="'+(s.actual||'')+'"></label>' +
          (subs.length>1?'<button class="pd-btn pd-btn-sm" type="button" data-rmsub="'+i+'">✕</button>':'') +
        '</div>';
      }).join('');
      host.querySelectorAll('[data-sub]').forEach(function (el){
        el.onchange = function(){ subs[+el.dataset.sub][el.dataset.k] = el.value || ''; };
      });
      host.querySelectorAll('[data-rmsub]').forEach(function (b){
        b.onclick = function(){ subs.splice(+b.dataset.rmsub,1); renderSubs(); };
      });
    }
    renderSubs();
    m.el.querySelector('#f-addsub').onclick = function(){
      subs.push({ rev: subs.length, planned:'', actual:'' }); renderSubs();
    };

    function refreshCode(){
      m.el.querySelector('#f-codeprev').textContent = composeCode({
        proj_code:m.el.querySelector('#f-proj').value.trim(),
        building_ref:m.el.querySelector('#f-bld').value,
        company:m.el.querySelector('#f-co').value,
        drawing_type:m.el.querySelector('#f-type').value,
        discipline:m.el.querySelector('#f-disc').value,
        floor_level:m.el.querySelector('#f-floor').value,
        dwg_number:m.el.querySelector('#f-num').value.trim(),
        revision:m.el.querySelector('#f-rev').value.trim()
      }) || '—';
    }
    ['f-proj','f-bld','f-co','f-type','f-disc','f-floor','f-num','f-rev'].forEach(function (id){
      var el=m.el.querySelector('#'+id); el.oninput=el.onchange=refreshCode;
    });
    refreshCode();

    // ---- schedule link: live "required approval" preview + auto-fill --------
    var computedReq = null;   // last derived required-approval date (ISO)
    function refreshSched(){
      var aid  = m.el.querySelector('#f-sact').value.trim();
      var lead = m.el.querySelector('#f-lead').value.trim();
      var reqEl = m.el.querySelector('#f-req'), hint = m.el.querySelector('#f-schedhint');
      computedReq = null; reqEl.value = '';
      if (!aid){ hint.innerHTML = 'Link a schedule activity to auto-derive the required approval date.'; return; }
      var a = schedById[aid];
      if (!a){
        hint.innerHTML = '<span class="dr-warn-t">Activity “'+Fmt.esc(aid)+'” isn’t in this project’s schedule'+
                         (schedPid!==pid?' (schedule still loading…)':'')+'.</span>'; return;
      }
      var nb = a.start_date || a.actual_start;
      if (!nb){ hint.innerHTML = 'Activity <strong>'+Fmt.esc(aid)+'</strong> has no start date in the schedule yet.'; return; }
      var L = lead === '' ? LEAD_DEFAULT : num(lead);
      computedReq = minusDays(nb, L);
      reqEl.value = computedReq ? Fmt.date(computedReq) : '';
      hint.innerHTML = 'Need-by (activity start) <strong>'+Fmt.date(nb)+'</strong> · required approval <strong>'+
        Fmt.date(computedReq)+'</strong> ('+L+'d lead). '+
        '<label style="margin-left:6px;white-space:nowrap;"><input type="checkbox" id="f-usereq"'+
        (r.planned_approval?'':' checked')+'> set as Planned approval</label>';
    }
    ['f-sact','f-lead'].forEach(function (id){ var el=m.el.querySelector('#'+id); el.oninput=el.onchange=refreshSched; });
    refreshSched();

    m.el.querySelector('#f-cancel').onclick = m.close;
    m.el.querySelector('#f-save').onclick = async function () {
      var btn = m.el.querySelector('#f-save');
      var discCode = m.el.querySelector('#f-disc').value;
      subs = subs.filter(function (s){ return s.planned || s.actual; })
                 .map(function (s,i){ return { rev:(s.rev!=null?s.rev:i), planned:s.planned||null, actual:s.actual||null }; });
      var sheets = num(m.el.querySelector('#f-sheets').value);
      var apSheets = num(m.el.querySelector('#f-apsheets').value);
      var data = {
        project_id: pid,
        node_kind: 'drawing',
        proj_code:    m.el.querySelector('#f-proj').value.trim(),
        building_ref: m.el.querySelector('#f-bld').value,
        company:      m.el.querySelector('#f-co').value,
        drawing_type: m.el.querySelector('#f-type').value,
        discipline:   discCode ? disciplineName(discCode) : '',
        floor_level:  m.el.querySelector('#f-floor').value,
        dwg_number:   m.el.querySelector('#f-num').value.trim(),
        phase:        m.el.querySelector('#f-phase').value,
        category:     m.el.querySelector('#f-cat').value.trim(),
        title:        m.el.querySelector('#f-title').value.trim(),
        description:  m.el.querySelector('#f-desc').value.trim(),
        no_of_sheets: sheets,
        approved_sheets: apSheets,
        approved_pct: sheets ? apSheets/sheets : 0,
        responsible:  m.el.querySelector('#f-resp').value.trim(),
        revision:     m.el.querySelector('#f-rev').value.trim(),
        submissions:  subs,
        status:       m.el.querySelector('#f-status').value,
        planned_approval: m.el.querySelector('#f-papp').value || null,
        actual_approval:  m.el.querySelector('#f-aapp').value || null,
        schedule_activity_id: m.el.querySelector('#f-sact').value.trim() || null,
        lead_days:    (m.el.querySelector('#f-lead').value.trim() === '' ? null : num(m.el.querySelector('#f-lead').value)),
        remarks:      m.el.querySelector('#f-rem').value.trim(),
        updated_at:   new Date().toISOString()
      };
      // auto-fill Planned approval from the derived required-approval deadline
      // when the planner opted in (checkbox in the schedule-link preview).
      var useReq = m.el.querySelector('#f-usereq');
      if (useReq && useReq.checked && computedReq) data.planned_approval = computedReq;
      // build the composed code with the discipline *code* (not the long name)
      data.drawing_code = composeCode({
        proj_code:data.proj_code, building_ref:data.building_ref, company:data.company,
        drawing_type:data.drawing_type, discipline:discCode, floor_level:data.floor_level,
        dwg_number:data.dwg_number, revision:data.revision
      });
      data.drawing_no = data.drawing_code || data.dwg_number;
      // keep first submission as issue/due for backward-compat filters
      data.issue_date = (subs[0] && subs[0].actual) || null;
      data.due_date   = (subs[0] && subs[0].planned) || null;

      if (!data.title && !data.dwg_number) { UI.toast('Sheet title or drawing no. required', 'warn'); return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        var fileEl = m.el.querySelector('#f-file');
        if (fileEl.files && fileEl.files[0]) { btn.textContent='Uploading…'; data.file_url = await uploadFile(fileEl.files[0]); }
        if (isNew) {
          data.created_by = uid;
          data.sort_order = (rows.length ? Math.max.apply(null, rows.map(function(x){return x.sort_order||0;})) : 0) + 1;
        }
        // Tolerant write: if the schedule-link migration hasn't been run yet, a
        // missing-column error strips those fields and retries so the save still
        // lands (matches the material-submittal tolerant-write pattern).
        var warned = false;
        async function writeRow(){
          var res = isNew ? await sb().from(TABLE).insert(data)
                          : await sb().from(TABLE).update(data).eq('id', r.id);
          if (res.error && /schedule_activity_id|lead_days|column/i.test(res.error.message||'')
              && ('schedule_activity_id' in data)) {
            delete data.schedule_activity_id; delete data.lead_days; warned = true;
            res = isNew ? await sb().from(TABLE).insert(data)
                        : await sb().from(TABLE).update(data).eq('id', r.id);
          }
          return res;
        }
        var wr = await writeRow(); if (wr.error) throw wr.error;
        UI.toast(warned ? 'Saved — but the schedule link wasn’t stored; run the 2026-07-25 migration.'
                        : 'Saved', warned ? 'warn' : 'ok');
        m.close(); load();
      } catch (e) {
        UI.toast(e.message, 'error'); btn.disabled=false; btn.textContent='Save';
      }
    };
  }

  function field(label, ctrl){ return '<div class="pd-field"><label>'+label+'</label>'+ctrl+'</div>'; }
  function projCodeGuess(){ return (pid||'').toUpperCase(); }
  function discCodeOf(name){
    if (!name) return '';
    var k = Object.keys(DISCIPLINES).find(function (c){ return DISCIPLINES[c]===name || c===name; });
    return k || '';
  }

  async function del(r) {
    if (!confirm('Delete drawing "' + (r.drawing_code || r.drawing_no || r.title) + '"?')) return;
    if (r.file_url) { try { await sb().storage.from(BUCKET).remove([r.file_url]); } catch (e) {} }
    var res = await sb().from(TABLE).delete().eq('id', r.id);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    UI.toast('Deleted', 'ok'); load();
  }

  // ---- Bulk delete the currently selected drawings -------------------------
  async function deleteSelected() {
    var ids = Object.keys(selected);
    if (!ids.length) return;
    if (!confirm('Delete ' + ids.length + ' selected drawing(s)? This cannot be undone.')) return;
    var files = rows.filter(function (r){ return selected[r.id] && r.file_url; }).map(function (r){ return r.file_url; });
    if (files.length) { try { await sb().storage.from(BUCKET).remove(files); } catch (e) {} }
    // delete in chunks to keep the URL length sane
    for (var i=0; i<ids.length; i+=100) {
      var res = await sb().from(TABLE).delete().in('id', ids.slice(i, i+100));
      if (res.error) { UI.toast(res.error.message, 'error'); return; }
    }
    UI.toast('Deleted ' + ids.length + ' drawing(s)', 'ok'); selected = {}; load();
  }

  // ---- Set status on all selected drawings ---------------------------------
  async function setStatusSelected(status) {
    var ids = Object.keys(selected).filter(function (id){ return visibleIds.indexOf(id)!==-1; });
    if (!ids.length) return;
    var n = 0;
    for (var i=0; i<ids.length; i++) {
      var r = rows.find(function (x){ return x.id===ids[i]; });
      if (r && !isNode(r)) { var ok = await persistCell(r, { status: status }); if (ok) n++; }
    }
    UI.toast('Set status on ' + n + ' drawing(s)', 'ok'); render();
  }

  // ---- Clear ALL drawings for this project (type-to-confirm) ---------------
  function clearAll() {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    if (!rows.length) { UI.toast('Nothing to clear', 'warn'); return; }
    var m = UI.modal(
      '<h2 style="margin-top:0;">Clear all drawings</h2>' +
      '<p>This permanently deletes <strong>all ' + rows.length + ' drawings</strong> for ' +
      '<strong>' + Fmt.esc(projName || pid) + '</strong>. Useful when a register was imported to the ' +
      'wrong project. This cannot be undone.</p>' +
      '<p class="dr-mut">Type the project id <code>' + Fmt.esc(pid) + '</code> to confirm:</p>' +
      '<input class="pd-input" id="dr-clr-confirm" placeholder="' + Fmt.esc(pid) + '">' +
      '<div style="text-align:right;margin-top:12px;">' +
        '<button class="pd-btn" id="dr-clr-cancel" type="button">Cancel</button> ' +
        '<button class="pd-btn pd-btn-danger" id="dr-clr-go" type="button" disabled>Delete all</button></div>'
    );
    var inp = m.el.querySelector('#dr-clr-confirm'), go = m.el.querySelector('#dr-clr-go');
    inp.oninput = function(){ go.disabled = inp.value.trim() !== pid; };
    m.el.querySelector('#dr-clr-cancel').onclick = m.close;
    go.onclick = async function(){
      go.disabled = true; go.textContent = 'Deleting…';
      var files = rows.filter(function (r){ return r.file_url; }).map(function (r){ return r.file_url; });
      if (files.length) { try { await sb().storage.from(BUCKET).remove(files); } catch (e) {} }
      var res = await sb().from(TABLE).delete().eq('project_id', pid);
      if (res.error) { UI.toast(res.error.message, 'error'); go.disabled=false; go.textContent='Delete all'; return; }
      UI.toast('All drawings cleared', 'ok'); m.close(); load({ reset:true });
    };
  }

  // =============================================================== IMPORT =====
  function openImport() {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    var m = UI.modal(
      '<h2 style="margin-top:0;">Import drawings from Excel</h2>' +
      '<p class="dr-mut">Reads a "Drawing Registry" sheet from the Megawide Drawing Register &amp; Tracker workbook. ' +
      'Phase / discipline / category are inferred from the sheet-title indentation; each sheet row becomes a drawing.</p>' +
      field('Workbook (.xlsx)','<input class="pd-input" type="file" id="dr-imp-file" accept=".xlsx,.xls">') +
      field('<label><input type="checkbox" id="dr-imp-replace"> Replace existing drawings for this project</label>','') +
      '<div id="dr-imp-preview" class="dr-mut" style="margin-top:8px;"></div>' +
      '<div style="text-align:right;margin-top:10px;"><button class="pd-btn" id="dr-imp-cancel" type="button">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="dr-imp-go" type="button" disabled>Import</button></div>',
      { wide:true }
    );
    var parsed = null;
    m.el.querySelector('#dr-imp-cancel').onclick = m.close;
    m.el.querySelector('#dr-imp-file').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      var prev = m.el.querySelector('#dr-imp-preview');
      prev.innerHTML = '<span class="dr-spin"></span> Reading workbook…';
      var reader = new FileReader();
      reader.onload = function (ev) {
        // defer the (synchronous) parse one tick so the "Reading…" state paints
        setTimeout(function () {
          try {
            // sheetRows caps how many rows SheetJS materialises per sheet — a
            // second guard against oversized sheets.
            var wb = XLSX.read(new Uint8Array(ev.target.result), { type:'array', cellDates:true, sheetRows:8000 });
            parsed = parseWorkbook(wb);
            if (!parsed.length) { prev.textContent = 'No drawing rows found in the workbook.'; return; }
            var nDraw = parsed.filter(function(p){ return (p.node_kind||'drawing')==='drawing'; }).length;
            var nNode = parsed.length - nDraw;
            prev.innerHTML = '<strong>'+nDraw+'</strong> drawings' + (nNode?' + '+nNode+' level rows':'') + ' found. Sample:<br>' +
              parsed.filter(function(p){return (p.node_kind||'drawing')==='drawing';}).slice(0,6).map(function (d){
                return '• '+Fmt.esc((d.phase||'')+' / '+(d.discipline||'')+' — '+(d.drawing_no||d.title));
              }).join('<br>');
            m.el.querySelector('#dr-imp-go').disabled = false;
          } catch (err) { prev.textContent = 'Parse error: ' + err.message; }
        }, 30);
      };
      reader.readAsArrayBuffer(f);
    };
    m.el.querySelector('#dr-imp-go').onclick = async function () {
      if (!parsed || !parsed.length) return;
      var go = m.el.querySelector('#dr-imp-go'); go.disabled = true; go.textContent = 'Importing…';
      try {
        if (m.el.querySelector('#dr-imp-replace').checked) {
          var d = await sb().from(TABLE).delete().eq('project_id', pid); if (d.error) throw d.error;
        }
        var order = 0;
        var recs = parsed.map(function (p) {
          order++;
          var subs = p.submissions || [];
          return {
            project_id: pid, created_by: uid, sort_order: order,
            node_kind: p.node_kind || 'drawing',
            proj_code: p.proj_code||projCodeGuess(), building_ref:p.building_ref, company:p.company,
            drawing_type:p.drawing_type, discipline:p.discipline, floor_level:p.floor_level,
            dwg_number:p.dwg_number, drawing_code:p.drawing_no, drawing_no:p.drawing_no,
            phase:p.phase, category:p.category, title:p.title, description:p.description,
            responsible:p.responsible, no_of_sheets:p.no_of_sheets, approved_sheets:p.approved_sheets,
            approved_pct:(p.no_of_sheets?p.approved_sheets/p.no_of_sheets:0),
            revision:p.revision, submissions:subs, status:p.status,
            planned_approval:p.planned_approval, actual_approval:p.actual_approval,
            issue_date:(subs[0]&&subs[0].actual)||null,
            due_date:(subs[0]&&subs[0].planned)||null,
            remarks:p.remarks
          };
        });
        // chunked insert; yield to the event loop between chunks so the
        // progress text repaints and the tab never looks frozen
        for (var i=0; i<recs.length; i+=200) {
          var chunk = recs.slice(i, i+200);
          var ins = await sb().from(TABLE).insert(chunk); if (ins.error) throw ins.error;
          go.textContent = 'Importing '+Math.min(i+200,recs.length)+' / '+recs.length+'…';
          await new Promise(function (r){ setTimeout(r, 0); });
        }
        var dc = recs.filter(function(x){return (x.node_kind||'drawing')==='drawing';}).length;
        UI.toast('Imported '+dc+' drawings', 'ok'); m.close(); load({ reset:true });
      } catch (e) { UI.toast(e.message, 'error'); go.disabled=false; go.textContent='Import'; }
    };
  }

  // ---- Parse the workbook's flat "Dwg Registry" layout ---------------------
  function parseWorkbook(wb) {
    // pick the best sheet: prefer one named like a registry with data
    var names = wb.SheetNames.filter(function (n){ return /regist/i.test(n); });
    if (!names.length) names = wb.SheetNames.slice();
    var best = null;
    names.forEach(function (n) {
      var g = gridOf(wb.Sheets[n]);
      var hdr = findHeader(g);
      if (hdr >= 0) {
        var recs = parseGrid(g, hdr);
        if (!best || recs.length > best.recs.length) best = { recs:recs };
      }
    });
    return best ? best.recs : [];
  }

  // Read a BOUNDED window of the sheet via direct cell refs. These workbooks
  // carry a bloated `!ref` (one sheet claims 16,383 columns) — sheet_to_json
  // over that allocates ~100M empty cells and hangs the browser. We cap columns
  // to MAXC (real registers use ~32) and only walk the real row range.
  function gridOf(ws) {
    if (!ws || !ws['!ref']) return [];
    var MAXC = 60;
    var rng = XLSX.utils.decode_range(ws['!ref']);
    var c0 = rng.s.c, c1 = Math.min(rng.e.c, c0 + MAXC);
    var r0 = rng.s.r, r1 = rng.e.r;
    var g = [];
    for (var R = r0; R <= r1; R++) {
      var row = [];
      for (var C = c0; C <= c1; C++) {
        var cell = ws[XLSX.utils.encode_cell({ r:R, c:C })];
        row.push(cell ? (cell.w != null ? cell.w : cell.v) : '');
      }
      g.push(row);
    }
    return g;
  }

  function norm(s){ return String(s==null?'':s).replace(/\s+/g,' ').trim().toLowerCase(); }

  // find the header row: has a "DWG" number col and a "Sheet Title" col
  function findHeader(g) {
    for (var i=0; i<Math.min(g.length,30); i++) {
      var joined = g[i].map(norm).join('|');
      if (joined.indexOf('sheet title') !== -1 &&
          (joined.indexOf('dwg') !== -1 || joined.indexOf('drawing') !== -1)) return i;
    }
    return -1;
  }

  function parseGrid(g, hdr) {
    var H = g[hdr].map(norm);
    function col(){ // first header col matching any of the given substrings
      var subs = Array.prototype.slice.call(arguments);
      for (var c=0;c<H.length;c++){ for (var s=0;s<subs.length;s++){ if (H[c].indexOf(subs[s])!==-1) return c; } }
      return -1;
    }
    var ci = {
      no:          col('no'),        // first "no" — the outline code col
      projectName: col('project name'),
      building:    col('building ref'),
      company:     col('company'),
      type:        col('drawing type'),
      disc:        col('discipline'),
      floor:       col('floor level'),
      dwgno:       col('dwg','drawing      no','drawing no'),
      title:       col('sheet title'),
      category:    col('category'),
      desc:        col('description'),
      resp:        col('reponsible','responsible'),
      sheets:      col('no   of   sheets','no of sheets','of   sheets','of sheets'),
      approvedSh:  col('approved sheets'),
      approvedPct: col('approved %'),
      status:      col('status','approval status'),
      papp:        col('approval date (plan','planned approval'),
      aapp:        col('approval date (actual','actual approval'),
      rem:         col('remarks')
    };
    // submission revision columns (planned/actual pairs), in header order
    var subCols = [];
    for (var c=0;c<H.length;c++){
      var h=H[c];
      if (/subm\.? *date/.test(h) || /submission date/.test(h)) {
        var revM = h.match(/rev *(\d+)/);
        var rev = revM ? parseInt(revM[1],10) : 0;
        var kind = /actual/.test(h) ? 'actual' : 'planned';
        subCols.push({ c:c, rev:rev, kind:kind });
      }
    }
    // the title spans several indent columns → treat any column between title and category as title-indent
    var titleStart = ci.title, titleEnd = (ci.category>ci.title?ci.category:ci.title+4);

    function cell(row, c){ return (c>=0 && c<row.length) ? row[c] : ''; }
    function dateOf(v){
      if (!v) return null;
      if (v instanceof Date) return v.toISOString().slice(0,10);
      var s=String(v).trim(); if (!s || /^0*:?0*:?0*$/.test(s)) return null;
      var d=new Date(s); return isNaN(d) ? null : d.toISOString().slice(0,10);
    }
    function intOf(v){ var n=parseInt(String(v).replace(/[^\d.-]/g,''),10); return isFinite(n)?n:0; }

    var recs = [];
    var cur = { phase:'', discipline:'', category:'', building:'', responsible:'' };
    // Anchored so only genuine phase-block titles match — NOT category/sheet
    // titles that merely contain "schematic"/"construction" (e.g. "Schematic
    // Diagrams", "Construction Notes", "Neighbor's As-Built and Crack Mapping").
    var PHASE_RE = /^\s*(concept design|schematic design\s*\d|design development|design analysis|detailed design|contract document|for\s+construction|construction drawing|as[- ]?built drawing|as[- ]?built\s*$|pre[- ]?engineering|tender)\b/i;
    var DISC_RE  = /^(architectural|structural|civil|electrical|auxil|plumbing|mechanical|fire|site develop|landscape)/i;

    for (var r=hdr+1; r<g.length; r++) {
      var row = g[r]; if (!row || !row.join('').trim()) continue;
      // find which indent column holds the title text
      var indentText = '', indentCol = -1;
      for (var tc=titleStart; tc<=titleEnd && tc<row.length; tc++) {
        if (String(row[tc]).trim()) { indentText = String(row[tc]).trim(); indentCol = tc; break; }
      }
      var noCode = String(cell(row, ci.no)).trim();
      var sheets = intOf(cell(row, ci.sheets));
      var hasDates = subCols.some(function (s){ return dateOf(cell(row,s.c)); });
      var desc = String(cell(row, ci.desc)).trim();
      var dwgno = String(cell(row, ci.dwgno)).trim();
      // The "DWG No" column sometimes holds a submitted FILE reference (e.g.
      // "2.3 4PH JAB RES SDP v 2.0 02-27-26.pdf") rather than a code — never use
      // that as the drawing code; keep it as a file note instead. The real code
      // is the outline "No" column (A).
      var fileRef = /\.(pdf|dwg|dxf|docx?|xlsx?|pptx?|png|jpe?g|zip|rar)\b/i.test(dwgno) ? dwgno : '';
      var cleanDwgno = fileRef ? '' : dwgno;

      // ---- classify the row by its title/code, NOT by whether it has dates
      // (discipline group rows carry roll-up dates yet are still headers).
      // Header rows are emitted as STRUCTURAL NODES carrying their code (A-100,
      // AR-000, …) so the tree skeleton + codes survive import. ---------------
      // PHASE header (top of the outline): keep the *exact* block name so design
      // iterations (Schematic Design 1/2/3/4, FCD, Scheme 1/2…) stay distinct.
      if (indentText && PHASE_RE.test(indentText) && !desc && !dwgno) {
        cur.phase = cleanPhase(indentText); cur.discipline=''; cur.category='';
        recs.push(nodeRec('phase', noCode, indentText)); continue;
      }
      // DISCIPLINE header: the title *is* a discipline name (exact-ish match)
      var discHead = disciplineHeader(indentText);
      if (discHead && !desc) {
        cur.discipline = discHead; cur.category='';
        var rp = String(cell(row, ci.resp)).trim(); if (rp) cur.responsible = rp;
        recs.push(nodeRec('discipline', noCode, indentText)); continue;
      }
      // BUILDING / TOWER header (kept on `cur`, not a render level)
      if (indentText && /^(tower|podium|basement|building|amenity)\b/i.test(indentText) && !desc && !dwgno) {
        cur.building = indentText; continue;
      }
      // CATEGORY header: a sub-group label with no dates and no description
      if (indentText && !hasDates && !desc) {
        cur.category = indentText;
        recs.push(nodeRec('category', noCode, indentText)); continue;
      }

      // ---- otherwise it's a drawing sheet ----------------------------------
      var title = indentText || desc;
      if (!title && !dwgno) continue;
      if (!hasDates && !sheets && !desc && !dwgno) continue;

      var subs = [];
      subCols.forEach(function (s){ var d=dateOf(cell(row,s.c)); if (d) push(subs,s.rev,s.kind,d); });
      subs.sort(function(a,b){ return a.rev-b.rev; });

      recs.push({
        node_kind: 'drawing',
        proj_code: String(cell(row, ci.projectName)).trim() || undefined,
        building_ref: String(cell(row, ci.building)).trim() || cur.building,
        company: String(cell(row, ci.company)).trim() || undefined,
        drawing_type: String(cell(row, ci.type)).trim() || undefined,
        discipline: canonDiscipline(mapDiscipline(String(cell(row, ci.disc)).trim())) || cur.discipline || disciplineFromCode(noCode||cleanDwgno),
        floor_level: String(cell(row, ci.floor)).trim() || undefined,
        dwg_number: noCode || cleanDwgno,
        drawing_no: noCode || cleanDwgno || title.slice(0,40),
        phase: cur.phase, category: cur.category,
        title: title,
        description: desc && desc!==title ? desc : '',
        responsible: String(cell(row, ci.resp)).trim() || cur.responsible,
        no_of_sheets: sheets || 1,
        approved_sheets: intOf(cell(row, ci.approvedSh)),
        revision: subs.length ? String(subs[subs.length-1].rev).padStart(2,'0') : '',
        submissions: subs,
        status: normalizeStatus(String(cell(row, ci.status)).trim()),
        planned_approval: dateOf(cell(row, ci.papp)),
        actual_approval: dateOf(cell(row, ci.aapp)),
        remarks: [String(cell(row, ci.rem)).trim(), fileRef ? ('File: '+fileRef) : ''].filter(Boolean).join(' · ')
      });
    }
    return recs;

    // A structural node (phase/discipline/category) carrying its code + rollup.
    function nodeRec(kind, code, label){
      return { node_kind:kind,
        phase: cur.phase,
        discipline: kind==='phase' ? '' : cur.discipline,
        category: kind==='category' ? cur.category : '',
        dwg_number: code||'', drawing_no: code||'', drawing_code: code||'',
        title: label||'',
        no_of_sheets: 0, approved_sheets: 0, submissions: [], status: '' };
    }

    function push(arr, rev, kind, val){
      var e = arr.find(function(x){return x.rev===rev;}); if (!e){ e={rev:rev, planned:null, actual:null}; arr.push(e); } e[kind]=val;
    }
  }

  // Accept a discipline value only if it's one of the canonical names, else ''
  // (guards against a stray code like "A-013" leaking in from a mis-detected column).
  function canonDiscipline(v) {
    if (!v) return '';
    for (var k in DISCIPLINES) { if (DISCIPLINES[k] === v) return v; }
    return '';
  }

  // Infer discipline from the sheet-code prefix (A-101 → Architectural) when
  // no discipline group header was picked up.
  function disciplineFromCode(code) {
    var m = String(code||'').trim().toUpperCase().match(/^([A-Z]{1,2})[\s\-]/);
    if (!m) return '';
    var P = { A:'Architectural', S:'Structural', C:'Civil', M:'Mechanical',
              E:'Electrical', P:'Plumbing', F:'Fire Protection', L:'Landscape',
              SD:'Site Development', AU:'Auxiliary', SW:'Site Development' };
    return P[m[1]] || '';
  }

  // Normalise workbook approval-status text to the module's canonical values.
  function normalizeStatus(s) {
    var t = norm(s); if (!t) return '';
    if (/revise|resubmit/.test(t)) return 'Revise & Resubmit';
    if (/with *comment/.test(t)) return 'Approved w/ comments';
    if (/(w\/o|without) *comment/.test(t)) return 'Approved';   // merged: redundant with "Approved"
    if (/superseded/.test(t)) return 'Superseded';
    if (/approved/.test(t)) return 'Approved';
    if (/review|submitted|for review/.test(t)) return 'For Review';
    return s;
  }

  // Recognise a row whose title *is* a discipline group header (exact-ish),
  // so we don't misread a sheet like "Fire Detection And Alarm System" as one.
  function disciplineHeader(s) {
    var t = norm(s).replace(/s$/,'');
    var MAP = {
      'architectural':'Architectural', 'structural':'Structural', 'civil':'Civil',
      'electrical':'Electrical', 'auxiliary':'Auxiliary', 'auxillary':'Auxiliary',
      'plumbing':'Plumbing', 'plumbing & sanitary':'Plumbing', 'sanitary':'Plumbing',
      'mechanical':'Mechanical', 'fire protection':'Fire Protection',
      'site development':'Site Development', 'landscape':'Landscape',
      'temporary facilitie':'Temporary Facilities', 'temporary work':'Temporary Facilities',
      'safety protection':'Safety Protection', 'construction equipment':'Construction Equipment',
      'other specialtie':'Other Specialties',
      'mepf combined services drawing':'MEPF Combined', 'mepf combined service drawing':'MEPF Combined'
    };
    return MAP[t] || null;
  }

  function mapDiscipline(s) {
    if (!s) return '';
    var t = norm(s);
    var found = Object.keys(DISCIPLINES).find(function (c){
      return t === c.toLowerCase() || t.indexOf(DISCIPLINES[c].toLowerCase().slice(0,6))===0;
    });
    if (found) return DISCIPLINES[found];
    // caps header like "ARCHITECTURAL"
    var byName = Object.keys(DISCIPLINES).find(function (c){ return norm(DISCIPLINES[c])===t; });
    return byName ? DISCIPLINES[byName] : s.replace(/\b\w/g,function(m){return m.toUpperCase();});
  }
  // Keep the workbook's exact phase-block name (title-cased) so design
  // iterations stay distinct — do NOT normalise 3/4 down to 1.
  function cleanPhase(s) {
    return String(s||'').replace(/\s+/g,' ').trim()
      .toLowerCase().replace(/\b([a-z])/g, function(m,c){ return c.toUpperCase(); })
      .replace(/\bFcd\b/i,'FCD');
  }

  function mapPhase(s) {
    var t = norm(s);
    if (/concept/.test(t)) return 'Concept Design';
    if (/schematic.*2|scheme *2|sd2/.test(t)) return 'Schematic Design 2';
    if (/schematic|scheme *1|sd1/.test(t)) return 'Schematic Design 1';
    if (/construction|fcd|for const/.test(t)) return 'For Construction';
    if (/as.?built/.test(t)) return 'As-Built';
    if (/contract/.test(t)) return 'For Construction';
    return s.replace(/\b\w/g,function(m){return m.toUpperCase();});
  }

  // =============================================================== EXPORT =====
  function exportExcel() {
    if (!rows.length) { UI.toast('Nothing to export', 'warn'); return; }
    var aoa = [['Drawing Code','Phase','Discipline','Category','Sheet Title','Description',
      'Rev','Status','No. of Sheets','Approved Sheets','Approved %',
      'Latest Planned Sub.','Latest Actual Sub.','Planned Approval','Actual Approval','Responsible','Remarks']];
    filtered().forEach(function (r) {
      aoa.push([r.drawing_code||r.drawing_no, r.phase, r.discipline, r.category, r.title, r.description,
        r.revision, r.status, num(r.no_of_sheets), num(r.approved_sheets),
        Math.round(pctApproved(r)*100)+'%',
        latestSub(r,'planned')||'', latestSub(r,'actual')||'',
        r.planned_approval||'', r.actual_approval||'', r.responsible, r.remarks]);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Drawing Register');
    XLSX.writeFile(wb, 'Drawing Register - ' + (projName||pid) + '.xlsx');
  }

  return { init: init, _parseWorkbook: parseWorkbook };
})();
