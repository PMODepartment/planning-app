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
  // ---- L1 grouping = TYPE OF DRAWING, not a phase --------------------------
  // ⚠️ This level is the drawing TYPE (the workbook's own "Coding Reference"
  // sheet calls it "TYPE OF DRAWING": DRC / ECD / SD1 / SD2 / FCD / ABD, and the
  // module's own TYPES map lists the same vocabulary). It is NOT a schedule
  // phase: For Construction, Temporary Works and Individual Services drawings
  // are produced CONCURRENTLY, so labelling the roll-up "by Phase" implied a
  // sequence that doesn't exist. The stored column is still `phase` — renaming
  // it would need a migration across every register for no functional gain —
  // but every user-facing label says "drawing type".
  // This list only supplies the DISPLAY ORDER and the default dropdown options;
  // any value actually present in a project is picked up dynamically, so a
  // register using its own names (GPR101's "For Construction Drawings (FCD)")
  // still orders by first appearance via phaseOrderKey().
  var PHASES = ['Concept Design','Schematic Design','For Construction Drawing',
                'Temporary Works Drawing','Individual Services Drawing',
                'Combined Services Drawing','As-Built Drawing'];
  // ⚠️ 'Ongoing' and 'Pending' were added because the real OPS registers use them and the inline
  // grid Status cell is a <select> built from THIS list — a value outside it silently displays as
  // the first option while the row actually holds something else (the same trap the Overview's
  // status filter hit). Order = lifecycle: being drawn → submitted → reviewed → approved.
  // Neither counts as approved (see isApprovedStatus), so both stay in the Backlog.
  var STATUSES = ['Ongoing','Pending','For Review','Revise & Resubmit','Approved w/ comments',
                  'Approved','Superseded'];
  var NODE_LABELS = { phase:'Drawing Type', discipline:'Discipline', category:'Category', drawing:'Drawing' };

  // selection ordering (display order of drawing ids) for shift-click + arrows
  var visibleIds = [];
  var lastClickedId = null;
  var _dragId = null;    // drawing row being drag-reordered (within its own group)

  // Drag-reorder mirrors Project Schedule's: only meaningful when the visible
  // order IS the stored order, so it's off while a filter/search narrows the list
  // (you'd be reordering against rows you can't see).
  // ⚠️ Drag-to-reorder is armed only in the register's NATURAL order. A filter
  // hides rows (so a drop lands between rows you can't see) and a column sort
  // detaches the display order from `sort_order` (so re-dealing sort_order to
  // match the drop would scramble the real order). `regSort.col` is therefore
  // part of this guard, exactly like anyFilter().
  function reorderEnabled(){ return canWrite && !anyFilter() && !regSort.col; }

  // ---- Registry column sort [UI review #3] ---------------------------------
  // ⚠️ Sorting happens INSIDE each leaf group (phase → discipline → category),
  // never across the whole register — the tree is the point of this view, and a
  // flat sort would destroy it. buildModel() applies this to each leaf list as
  // it emits it, so group membership, roll-ups and collapse state are untouched.
  // `col:null` = natural sort_order order (the default, and what drag-reorder
  // maintains). Clicking cycles asc → desc → natural, so there is always an
  // explicit way back to the manual order that re-arms dragging.
  var regSort = { col:null, dir:1 };
  var REG_SORTABLE = {
    code:'Code', title:'Sheet Title / Description', revision:'Rev', status:'Status',
    sheets:'Sh', appr:'Appr', latest_sub:'Latest Sub.', approval:'Approval',
    needby:'Need-by', responsible:'Resp.'
  };
  function regSortVal(r, col){
    switch (col){
      case 'code':        return drawCode(r).toLowerCase();
      case 'title':       return (r.title||'').toLowerCase();
      case 'revision':    return String(r.revision==null?'':r.revision).toLowerCase();
      case 'status':      return r.status||'';
      case 'sheets':      return num(r.no_of_sheets)||0;
      case 'appr':        return num(r.approved_sheets)||0;
      case 'latest_sub':  return latestSub(r,'actual') || latestSub(r,'planned') || '';
      case 'approval':    return r.actual_approval || r.planned_approval || '';
      case 'needby':      return requiredApprovalOf(r) || '';
      case 'responsible': return (r.responsible||'').toLowerCase();
      default:            return 0;
    }
  }
  // Blanks always sort LAST regardless of direction — an empty date or status is
  // "unknown", not "earliest", and burying them under a descending sort is what
  // you actually want when hunting for the populated extremes.
  function regSortList(list){
    if (!regSort.col) return list;
    var col = regSort.col, dir = regSort.dir;
    return list.slice().sort(function (a, b){
      var va = regSortVal(a, col), vb = regSortVal(b, col);
      var ea = (va === '' || va == null), eb = (vb === '' || vb == null);
      if (ea && eb) return 0;
      if (ea) return 1;
      if (eb) return -1;
      var cmp = va < vb ? -1 : (va > vb ? 1 : 0);
      return cmp * dir;
    });
  }
  function regSetSort(col){
    if (!REG_SORTABLE[col]) return;
    if (regSort.col !== col) { regSort.col = col; regSort.dir = 1; }
    else if (regSort.dir === 1) { regSort.dir = -1; }
    else { regSort.col = null; regSort.dir = 1; }   // third click → natural order
    saveUI(); render();
  }

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
  // Inline SVG for dynamically-rendered markup. Icons.hydrate() only runs on
  // DOMContentLoaded, so grid rows (re-rendered constantly) must embed the SVG
  // directly rather than rely on a data-ico attribute being hydrated later.
  function ico(name, size){
    return (window.Icons && Icons.svg) ? Icons.svg(name, size || 15) : '';
  }

  function num(v){ v = parseFloat(v); return isFinite(v) ? v : 0; }

  // ---- per-project UI persistence (view + collapse state) [feature 3] ------
  function uiKey(k){ return 'dr_' + k + '_' + pid; }
  function saveUI(){
    try {
      localStorage.setItem(uiKey('view'), view);
      localStorage.setItem(uiKey('collapsed'), JSON.stringify(collapsed));
      localStorage.setItem(uiKey('regsort'), JSON.stringify(regSort));
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
      // Restore the column sort, but VALIDATE the column against REG_SORTABLE —
      // a stale key from a renamed/removed column would otherwise sort by a
      // value regSortVal() doesn't know, silently producing arbitrary order.
      var s = localStorage.getItem(uiKey('regsort'));
      if (s){
        var so = JSON.parse(s);
        if (so && REG_SORTABLE[so.col]) regSort = { col:so.col, dir:(so.dir===-1?-1:1) };
        else regSort = { col:null, dir:1 };
      }
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
        // Registry and Backlog are different lists with different `visibleIds`;
        // a selection carried between them would leave the bulk bar counting rows
        // you can no longer see. Drop it on any tab change.
        if (view !== b.dataset.view) selected = {};
        view = b.dataset.view;
        syncTabs(); saveUI(); render();
      };
    });
    // Selects apply instantly; the SEARCH BOX IS DEBOUNCED (160ms, same as the
    // Material Submittal log). ⚠️ Do not fold search back in with the selects:
    // every keystroke ran computeDups() + buildModel() + a full innerHTML rebuild
    // over every row, which is visible typing lag on a 1,000+ drawing register.
    function readFilters() {
      filters.phase      = document.getElementById('dr-f-phase').value;
      filters.discipline = document.getElementById('dr-f-discipline').value;
      filters.status     = document.getElementById('dr-f-status').value;
      filters.search     = document.getElementById('dr-f-search').value.toLowerCase().trim();
      syncClearFilt();
    }
    ['dr-f-phase','dr-f-discipline','dr-f-status'].forEach(function (id) {
      document.getElementById(id).onchange = function () { readFilters(); render(); };
    });
    var sEl = document.getElementById('dr-f-search'), sT = null;
    sEl.oninput = function () {
      clearTimeout(sT);
      sT = setTimeout(function () { readFilters(); render(); }, 160);
    };
    var cf = document.getElementById('dr-f-clear');
    if (cf) cf.onclick = function () {
      clearTimeout(sT);
      filters.dupsOnly = false;
      ['dr-f-phase','dr-f-discipline','dr-f-status','dr-f-search'].forEach(function (id) {
        document.getElementById(id).value = '';
      });
      readFilters(); render();
    };
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
             '<button class="dr-view-del" data-vd="'+i+'" title="Delete view">'+ico('x',13)+'</button></div>';
    }).join('') || '<div class="dr-view-empty">No saved views yet.</div>';
    html += '<div class="dr-view-sep"></div><button class="dr-view-save" id="dr-view-save">'+ico('plus',13)+' Save current filters…</button>';
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
    // Only on a FRESH view (project switch / init / import / clear). A bare
    // load() is a refresh after an edit — flashing a skeleton there would make
    // every save look like a full reload.
    if (opts.reset) {
      var vh = document.getElementById('dr-view');
      if (vh) vh.innerHTML = skeletonHTML();
    }
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
      bkAging = '';        // a drill-through aging filter must not leak across projects
      bkShowAll = false;
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
  // ⚠️ ALL-UTC, deliberately. The previous version built a LOCAL date
  // (`new Date(iso+'T00:00:00')` + `setDate`) and then read it back with
  // `toISOString()`, which is UTC — so east of Greenwich local midnight is the
  // *previous* UTC day and every result came out ONE DAY EARLY. In Manila
  // (UTC+8) `minusDays('2026-03-31', 0)` returned `2026-03-30`; subtracting
  // zero days must be the identity, which is what makes this unambiguous.
  // That one-day error propagated into every schedule-linked deadline: the
  // Need-by column, the float chip's colour, agingDays(), the aging bar and the
  // Backlog urgency sort. Mixing local constructors with UTC getters is the
  // exact trap documented for the material-submittal importer — don't reopen it.
  function minusDays(iso, n){
    var p = String(iso).slice(0, 10).split('-');
    if (p.length !== 3) return null;
    var t = Date.UTC(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(t)) return null;
    var d = new Date(t - n * 86400000);
    return d.toISOString().slice(0, 10);
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
  // ---- Schedule-activity picker (searchable) -------------------------------
  // ⚠️ A native <datalist> can NOT do this: browsers filter datalist options by
  // the option's `value`, which has to be the activity_id we store — so typing
  // part of an activity NAME matched nothing. This is a real dropdown that
  // searches both the ID and the name.
  var SCHED_PICK_MAX = 60;              // rendered rows per query; schedules run to 40k activities
  function schedMatches(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return schedActs.slice(0, SCHED_PICK_MAX);
    var terms = q.split(/\s+/), out = [];
    for (var i = 0; i < schedActs.length && out.length < SCHED_PICK_MAX; i++) {
      var a = schedActs[i];
      var hay = ((a.activity_id || '') + ' ' + (a.activity_name || '')).toLowerCase();
      var ok = true;
      for (var t = 0; t < terms.length; t++) { if (hay.indexOf(terms[t]) === -1) { ok = false; break; } }
      if (ok) out.push(a);
    }
    return out;
  }
  function schedPickerHTML(value) {
    return '<div class="dr-actpick" id="f-actpick">' +
      '<input class="pd-input" id="f-sact-q" autocomplete="off" placeholder="Search activity ID or name…" value="">' +
      '<input type="hidden" id="f-sact" value="' + Fmt.esc(value) + '">' +
      '<div class="dr-actpick-sel" id="f-sact-sel"></div>' +
      '<div class="dr-actpick-menu" id="f-sact-menu" hidden></div>' +
    '</div>';
  }
  // Wires the picker inside `root`; onPick() fires whenever the value changes.
  function wireSchedPicker(root, onPick) {
    var q = root.querySelector('#f-sact-q'), hid = root.querySelector('#f-sact');
    var menu = root.querySelector('#f-sact-menu'), sel = root.querySelector('#f-sact-sel');
    function renderSel() {
      var v = hid.value.trim();
      if (!v) { sel.innerHTML = ''; return; }
      var a = schedById[v];
      sel.innerHTML = '<span class="dr-actpick-chip">' +
        '<b>' + Fmt.esc(v) + '</b>' + (a && a.activity_name ? ' — ' + Fmt.esc(a.activity_name) : '') +
        '<button type="button" class="dr-actpick-x" title="Clear">&times;</button></span>' +
        (a ? '' : '<span class="dr-warn-t" style="margin-left:8px;">not in this project’s schedule</span>');
      sel.querySelector('.dr-actpick-x').onclick = function () {
        hid.value = ''; renderSel(); onPick(); q.focus();
      };
    }
    function renderMenu() {
      var list = schedMatches(q.value);
      if (!schedActs.length) {
        menu.innerHTML = '<div class="dr-actpick-empty">' +
          (schedPid === pid ? 'This project has no schedule activities yet.' : 'Loading the schedule…') + '</div>';
      } else if (!list.length) {
        menu.innerHTML = '<div class="dr-actpick-empty">No activity matches “' + Fmt.esc(q.value) + '”.</div>';
      } else {
        menu.innerHTML = list.map(function (a) {
          return '<button type="button" class="dr-actpick-item" data-aid="' + Fmt.esc(a.activity_id) + '">' +
            '<b>' + Fmt.esc(a.activity_id) + '</b><span>' + Fmt.esc(a.activity_name || '') + '</span>' +
            (a.start_date ? '<i>' + Fmt.date(a.start_date) + '</i>' : '') + '</button>';
        }).join('') + (list.length >= SCHED_PICK_MAX
          ? '<div class="dr-actpick-empty">Showing the first ' + SCHED_PICK_MAX + ' — keep typing to narrow.</div>' : '');
        menu.querySelectorAll('.dr-actpick-item').forEach(function (b) {
          b.onclick = function () {
            hid.value = b.dataset.aid; q.value = ''; menu.hidden = true; renderSel(); onPick();
          };
        });
      }
      menu.hidden = false;
    }
    q.oninput = renderMenu;
    q.onfocus = renderMenu;
    q.onkeydown = function (e) {
      if (e.key === 'Escape') { menu.hidden = true; }
      else if (e.key === 'Enter') {                    // Enter picks the first match
        e.preventDefault();
        var first = menu.querySelector('.dr-actpick-item');
        if (first && !menu.hidden) first.click();
      }
    };
    document.addEventListener('mousedown', function (e) {
      if (!root.contains(e.target)) menu.hidden = true;
    });
    renderSel();
    return { refreshSel: renderSel };
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
    if (s === 'Ongoing') return 'dr-wip';
    return 'dr-review';
  }

  // The ghost "Clear" button is shown only when something is actually filtered
  // (including the duplicates-only toggle, which anyFilter() counts).
  function syncClearFilt() {
    var b = document.getElementById('dr-f-clear');
    if (b) b.hidden = !anyFilter();
  }

  // Shown while a fresh register loads (project switch / import / clear). load()
  // keyset-paginates 1000 rows per round-trip, so without this the grid sat on
  // the PREVIOUS project's rows and then swapped — reading as a glitch.
  var SK_W = ['15%','38%','12%','16%','10%'];
  function skeletonHTML() {
    var rows_ = '', i, j;
    for (i = 0; i < 9; i++) {
      var cells = '';
      for (j = 0; j < SK_W.length; j++) cells += '<span class="dr-sk" style="width:'+SK_W[j]+'"></span>';
      rows_ += '<div class="dr-sk-row">' + cells + '</div>';
    }
    return '<div class="pd-card dr-skcard" aria-busy="true">' +
      '<div class="dr-sk-head"><span class="dr-sk-spin"></span>Loading register…</div>' +
      rows_ + '</div>';
  }

  function render() {
    syncTabs();
    syncClearFilt();
    // the filter bar applies to Registry AND Backlog (both are drawing-level lists);
    // Overview is an aggregate dashboard, so it hides the filters.
    var fb = document.querySelector('.dr-filters');
    if (fb) fb.style.display = (view === 'overview') ? 'none' : '';
    // Registry only: turn the shell into a viewport-height flex column so the
    // grid card fills the leftover space rather than trusting a hardcoded
    // chrome height (see `body.dr-fit` in module.css). Overview and Backlog are
    // multi-card documents and keep normal page scrolling.
    document.body.classList.toggle('dr-fit', view === 'registry');
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
  // `bkAging` is a Backlog-ONLY filter set by clicking a segment of the
  // Overview's aging bar (UI review #7). It deliberately does not live in the
  // shared filter bar: aging is derived from the schedule link, is meaningful
  // only for open items, and the Registry has no aging column to filter on.
  var bkAging = '';
  function backlogRows(){
    return drawingRows().filter(function (r){
      if (!matchesFilters(r, { skipDups:true })) return false;
      if (!(!isApprovedStatus(r.status) || r.status === 'Revise & Resubmit')) return false;
      if (bkAging && agingBucketOf(r) !== bkAging) return false;
      return true;
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
    { col:'phase',      label:'Drawing Type' },
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

    // "Revise & Resubmit" is a status → a real filter. Open items / late / tight
    // are already what this view shows, so they only clear back to the full
    // backlog rather than pretending to be their own filters.
    var kpis = kpiSection('Backlog Overview',
      kpi(list.length, 'Open items', '', bkAging ? { view:'backlog', patch:{}, tip:'Clear the aging filter and show every open item' } : null) +
      kpi(late, 'Late vs need-by', late>0?'warn':'') +
      kpi(tight, 'Due ≤3 days', tight>0?'warn':'') +
      kpi(revise, 'Revise & Resubmit', '', { view:'backlog', patch:{ status:'Revise & Resubmit' }, tip:'Filter the Backlog to Revise & Resubmit' }));

    var shown = (bkShowAll || list.length<=BK_PAGE) ? list : list.slice(0, BK_PAGE);
    // Bulk actions operate on `selected` filtered by `visibleIds` (shared with
    // the Registry via refreshSel/setStatusSelected), so the Backlog must
    // publish what IS visible here — otherwise a selection made in the Backlog
    // would be filtered out as "not visible" and the bulk bar would read 0.
    // ⚠️ Only the PAINTED slice, not the whole filtered list: "Select all shown"
    // must never silently act on rows behind the 200-row page cap.
    visibleIds = shown.map(function (r){ return String(r.id); });

    var CB = canWrite;
    var body = shown.map(function (r){
      var a = agingDays(r);
      return '<tr class="dr-bk-row'+(selected[r.id]?' dr-selrow':'')+'" data-id="'+r.id+'">' +
        (CB ? '<td class="dr-cb"><input type="checkbox" data-sel="'+r.id+'"'+(selected[r.id]?' checked':'')+'></td>' : '') +
        '<td class="dr-code">'+Fmt.esc(drawCode(r))+'</td>' +
        '<td>'+Fmt.esc(r.title||'')+'</td>' +
        '<td>'+Fmt.esc(r.phase||'')+'</td>' +
        '<td>'+Fmt.esc(disciplineName(r.discipline))+'</td>' +
        '<td>'+(r.status ? '<span class="dr-pill '+statusCls(r.status)+'">'+Fmt.esc(r.status)+'</span>' : '<span class="dr-mut">—</span>')+'</td>' +
        '<td class="dr-nowrap dr-c-needby">'+needByCellHtml(r)+'</td>' +
        '<td class="dr-r dr-nowrap'+(a!=null&&a>0?' dr-aging-late':'')+'">'+(a==null?'<span class="dr-mut">—</span>':(a>0?'+':'')+a+'d')+'</td>' +
        // Doc column — the Backlog is where you chase an open submission, so the
        // approved file needs to be reachable without opening the full editor.
        '<td class="dr-bk-doc">'+(r.file_url
          ? '<button class="dr-iconbtn" data-view="'+Fmt.esc(r.file_url)+'" title="View approved file">'+ico('eye',15)+'</button>'
          : '<span class="dr-mut dr-mini">—</span>')+'</td>' +
      '</tr>';
    }).join('');

    var head = (CB ? '<th class="dr-cb"><input type="checkbox" id="dr-selall" title="Select all shown"></th>' : '') +
      BK_COLS.map(function (c){
        var active = bkSort.col===c.col;
        return '<th class="dr-sortable" data-col="'+c.col+'">'+c.label+
          (active ? ' <span class="dr-sortind">'+(bkSort.dir===1?'▲':'▼')+'</span>' : '')+'</th>';
      }).join('') +
      '<th class="dr-bk-doc">Doc</th>';

    // Same selection bar as the Registry (same ids, so wireBacklogSel reuses the
    // shared handlers) — bulk status is the whole point on a backlog screen.
    var selbar = CB ? '<div class="dr-selbar dr-bk-selbar" id="dr-selbar" hidden>' +
        '<span id="dr-selcount"></span>' +
        '<select class="pd-select pd-btn-sm dr-selstatus" id="dr-selstatus" title="Set status for selected">' +
          '<option value="">Set status…</option>' +
          STATUSES.map(function(s){ return '<option>'+s+'</option>'; }).join('') +
        '</select>' +
        '<button class="pd-btn pd-btn-sm" id="dr-selclear">Clear</button>' +
        '<button class="pd-btn pd-btn-sm pd-btn-danger" id="dr-seldel">Delete selected</button>' +
      '</div>' : '';

    var moreBar = (list.length > BK_PAGE) ?
      '<div class="dr-bk-more">' +
        (bkShowAll
          ? 'Showing all '+list.length+' — <button class="dr-linklike" id="dr-bk-collapse">collapse to first '+BK_PAGE+'</button>'
          : 'Showing '+BK_PAGE+' of '+list.length+' — <button class="dr-linklike" id="dr-bk-showall">show all</button>') +
      '</div>' : '';

    // The aging filter arrives by drill-through from the Overview, so it must be
    // visible and removable here — it is not in the shared filter bar.
    var agChip = bkAging ?
      '<button class="dr-sortchip dr-agchip" id="dr-agclear" title="Clear the aging filter">' +
        Fmt.esc(bkAging) + ' ' + ico('x',12) + '</button>' : '';

    host.innerHTML = kpis +
      '<div class="pd-card"><h3 class="dr-h3">Open items' +
      '<span class="dr-mut" style="font-weight:400;font-size:12.5px;margin-left:8px;">'+
      (anyFilter() || bkAging ? 'Showing '+list.length+' filtered' : list.length+' total')+'</span>' +
      agChip + '</h3>' + selbar +
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
    // ⚠️ The Doc button lives inside a row whose click opens the editor, so it
    // MUST stopPropagation — otherwise viewing a file also pops the modal.
    host.querySelectorAll('.dr-bk-doc button[data-view]').forEach(function (b){
      b.onclick = function (e){ e.stopPropagation(); viewFile(b.dataset.view); };
    });
    // Bulk selection — reuses the Registry's shared handlers/ids verbatim.
    host.querySelectorAll('input[data-sel]').forEach(function (cb){
      cb.onclick = function (e){ e.stopPropagation(); };
      cb.onchange = function (){
        if (cb.checked) selected[cb.dataset.sel] = true; else delete selected[cb.dataset.sel];
        refreshSelBacklog(host);
      };
    });
    var all = host.querySelector('#dr-selall');
    if (all) {
      all.onclick = function (e){ e.stopPropagation(); };
      all.onchange = function (){
        visibleIds.forEach(function (id){ if (all.checked) selected[id] = true; else delete selected[id]; });
        renderBacklog();
      };
    }
    var clr = host.querySelector('#dr-selclear'); if (clr) clr.onclick = function (){ selected = {}; renderBacklog(); };
    var sd  = host.querySelector('#dr-seldel');   if (sd)  sd.onclick  = deleteSelected;
    var ss  = host.querySelector('#dr-selstatus'); if (ss) ss.onchange = function (){ if (ss.value) setStatusSelected(ss.value); };
    refreshSelBacklog(host);

    var agc = document.getElementById('dr-agclear');
    if (agc) agc.onclick = function (){ bkAging = ''; render(); };
    wireDrills(host);   // the Backlog KPI cards
  }

  // Backlog rows are `.dr-bk-row`, not `.dr-drow`, so the shared refreshSel()
  // row-highlight loop doesn't match them. Same bar/count logic, right rows.
  function refreshSelBacklog(host) {
    host = host || document;
    var ids = Object.keys(selected).filter(function (id){ return visibleIds.indexOf(id)!==-1; });
    var bar = host.querySelector('#dr-selbar');
    if (bar) { bar.hidden = ids.length===0; var c=host.querySelector('#dr-selcount'); if (c) c.textContent = ids.length + ' selected'; }
    var all = host.querySelector('#dr-selall');
    if (all) all.checked = visibleIds.length>0 && ids.length===visibleIds.length;
    host.querySelectorAll('tr.dr-bk-row').forEach(function (tr){
      tr.classList.toggle('dr-selrow', !!selected[tr.dataset.id]);
      var cb = tr.querySelector('input[data-sel]'); if (cb) cb.checked = !!selected[tr.dataset.id];
    });
  }

  function populateFilterSelects() {
    var ph = document.getElementById('dr-f-phase');
    var phSet = {}; rows.forEach(function (r){ if (r.phase) phSet[r.phase]=1; });
    var phList = PHASES.filter(function (p){ return phSet[p]; })
      .concat(Object.keys(phSet).filter(function (p){ return PHASES.indexOf(p)===-1; }));
    ph.innerHTML = '<option value="">All drawing types</option>' + phList.map(function (p){
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

  // ⚠️ DATA-LOSS GUARD. The Add/Edit form's drawing-type <select> used to be
  // built from PHASES alone, so a drawing whose type wasn't in that hardcoded
  // list had NO matching option — the select fell back to the blank "—" and
  // saving wrote '' straight over the type, silently moving the drawing to
  // "Ungrouped". Almost every BAU101 drawing hit this (For Construction /
  // Temporary Works / Individual Services Drawing were all absent). The options
  // are now the canonical list ∪ the types actually present in this project ∪
  // the row's own current value, so the value on screen can always round-trip.
  function phaseOptions(cur){
    var seen = {}, list = [];
    PHASES.concat(phaseNames()).forEach(function (p){
      if (p && !seen[p]) { seen[p] = 1; list.push(p); }
    });
    if (cur && !seen[cur]) list.push(cur);
    return list;
  }
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
        regSortList(D.nocat).forEach(function(r){ disp.push({type:'drawing',level:3,row:r}); visibleIds.push(r.id); });

        var catSet={}; Object.keys(cNode).forEach(function(k){var p=k.split(SEP); if(p[0]===ph&&p[1]===d)catSet[p[2]]=1;});
        (D.order||[]).forEach(function(c){catSet[c]=1;});
        Object.keys(catSet).forEach(function (c) {
          var list=D.cat[c]||[];
          if (filt && !list.length) return;
          var ckey='C:'+ph+'|'+d+'|'+c;
          disp.push({type:'cat',level:3,key:ckey,label:c,code:nodeCode(cNode[ph+SEP+d+SEP+c]),ctx:{phase:ph,discipline:d,category:c},nodeId:node_(cNode[ph+SEP+d+SEP+c]),list:list});
          if (collapsed[ckey]) return;
          regSortList(list).forEach(function(r){ disp.push({type:'drawing',level:4,row:r}); visibleIds.push(r.id); });
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
      '<select class="pd-select pd-btn-sm dr-jump" id="dr-jump" title="Jump to a drawing type">' +
        '<option value="">Jump to drawing type…</option>' +
        phaseItems.map(function(p){ return '<option value="'+Fmt.esc(p.key)+'">'+Fmt.esc(p.label)+'</option>'; }).join('') +
      '</select>' : '';
    var nDup = Object.keys(dupSet).length;
    var dupLegend = nDup ?
      '<button class="dr-duplegend'+(filters.dupsOnly?' dr-on':'')+'" id="dr-duplegend" ' +
        'title="A drawing code that appears more than once within the same drawing type. Click to '+(filters.dupsOnly?'show all':'show only duplicates')+'.">' +
        '<span class="dr-dupmark">⚠</span> '+nDup+' duplicate code'+(nDup>1?'s':'')+'</button>' : '';
    // When a column sort is active, say so and offer one click back — otherwise
    // "why can't I drag rows any more?" is a mystery (reorderEnabled() is off).
    var sortChip = regSort.col ?
      '<button class="dr-sortchip" id="dr-sortclear" title="Back to manual (drag) order">' +
        'Sorted by ' + Fmt.esc(REG_SORTABLE[regSort.col]) + ' ' + (regSort.dir===1?'▲':'▼') +
        ' ' + ico('x',12) + '</button>' : '';
    var toolbar = '<div class="dr-listbar">' +
      '<button class="dr-rowbtn dr-xall" id="dr-xall">' + (anyOpen ? 'Collapse all' : 'Expand all') + '</button>' +
      jump +
      dupLegend +
      sortChip +
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

    // Sortable headers. `sh(col, label, cls, extraTitle)` emits the click target
    // + direction indicator; sorting is applied per leaf group in buildModel().
    function sh(col, cls, extra){
      var active = regSort.col === col;
      var tip = (extra ? extra + ' · ' : '') +
        (active ? (regSort.dir===1 ? 'Sorted ascending — click for descending' : 'Sorted descending — click to restore manual order')
                : 'Click to sort by this column');
      return '<th class="'+cls+' dr-sortable'+(active?' dr-sorted':'')+'" data-scol="'+col+'" title="'+Fmt.esc(tip)+'">' +
        Fmt.esc(REG_SORTABLE[col]) +
        (active ? ' <span class="dr-sortind">'+(regSort.dir===1?'▲':'▼')+'</span>' : '') + '</th>';
    }
    var head = '<tr>' +
      (CB ? '<th class="dr-cb dr-freeze dr-freeze-cb"><input type="checkbox" id="dr-selall" title="Select all shown"></th>' : '') +
      sh('code',  'dr-c-code dr-freeze dr-freeze-code') +
      sh('title', 'dr-c-title dr-freeze dr-freeze-title') +
      sh('revision', 'dr-c-rev') + sh('status', 'dr-c-status') +
      sh('sheets', 'dr-r dr-c-sh') + sh('appr', 'dr-r dr-c-ap') +
      sh('latest_sub', 'dr-c-date') + sh('approval', 'dr-c-date') +
      sh('needby', 'dr-c-date dr-c-needby', 'Required approval = linked activity start − lead days') +
      sh('responsible', 'dr-c-resp') +
      '<th class="dr-actcol"></th></tr>';

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
    var caret = '<span class="dr-caret'+(isCol?' dr-caret-col':'')+'">'+ico('chevronDown',12)+'</span>';
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
      '<td class="dr-nowrap dr-actcol">'+(canWrite?'<button class="dr-lvldel" title="Delete this level and everything under it">'+ico('trash',15)+'</button>':'')+'</td></tr>';
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
    var dupMark = isDup ? ' <span class="dr-dupmark" title="Duplicate code within this drawing type — reconcile">⚠</span>' : '';
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
      '<td class="dr-nowrap dr-actcol">'+(r.file_url?'<button class="dr-iconbtn" data-view="'+Fmt.esc(r.file_url)+'" title="View approved file">'+ico('eye',15)+'</button>':'')+
        '<button class="dr-iconbtn" data-edit="'+r.id+'" title="Full editor">'+ico('pencil',15)+'</button>' +
        '<button class="dr-iconbtn dr-rowbtn-del" data-del="'+r.id+'" title="Delete">'+ico('trash',15)+'</button></td>' +
    '</tr>';
  }

  function emptyMsg(msg) {
    return '<div class="pd-card dr-empty">'+Fmt.esc(msg)+'</div>';
  }

  // ------------------------------------------------------------- wiring ------
  function wireRegister(host, disp) {
    // Column sort [UI review #3] — click a header to cycle asc → desc → manual.
    host.querySelectorAll('th.dr-sortable[data-scol]').forEach(function (th){
      th.onclick = function (){ regSetSort(th.dataset.scol); };
    });
    var sc = host.querySelector('#dr-sortclear');
    if (sc) sc.onclick = function (){ regSort.col = null; regSort.dir = 1; saveUI(); render(); };

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
      UI.toast('Drawings can only be reordered within their own drawing type / discipline / category.', 'warn');
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

    // Only "Drawings" is a row set — the rest count SHEETS, so drilling them
    // would land on a list whose row count doesn't match the number clicked.
    var kpis = kpiSection('Register Overview',
      kpi(draws.length, 'Drawings', '', { view:'registry', patch:{}, tip:'Show all drawings in the Registry' }) +
      kpi(totSheets, 'Total sheets') +
      kpi(subSheets, 'Submitted') +
      kpi(apSheets, 'Approved') +
      kpi((totSheets?Math.round(apSheets/totSheets*100):0)+'%', 'Approved %', 'ok') +
      kpi(balance, 'Balance', balance>0?'warn':''));

    // by phase
    var byPhase = groupAgg('phase');
    var byDisc  = groupAgg('discipline');
    var host2 = '<div class="dr-dash-grid">' +
      progTable('Progress by Drawing Type', byPhase, PHASES, 'phase') +
      progTable('Progress by Trade', byDisc, Object.keys(DISCIPLINES).map(disciplineName), 'discipline') +
    '</div>';

    var drawPeriod = function () {
      renderPeriodChart(document.getElementById('dr-period-chart'),
        periodScaled(periodBuckets(periodMode), periodValueMode, draws.length), periodValueMode);
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
        // ONE button that switches, not two mutually-exclusive buttons — it
        // shows the mode you'd switch TO, matching the user's "switchable toggle".
        '<button class="dr-seg dr-segswitch" id="dr-pervalmode" type="button" ' +
          'title="Switch between counts and % of all drawings">#</button>' +
        '</h3>' +
        '<div id="dr-period-chart" class="dr-pc-wrap"></div>' +
      '</div>' +
      host2;

    drawPeriod();
    wireDrills(host);   // KPI card, donut legend, aging bar + legend, prog tables
    var pm = document.getElementById('dr-permode');
    if (pm) pm.querySelectorAll('.dr-seg-btn').forEach(function (b){
      b.onclick = function (){
        periodMode = b.dataset.mode;
        pm.querySelectorAll('.dr-seg-btn').forEach(function (x){ x.classList.toggle('active', x===b); });
        drawPeriod();
      };
    });
    var pvm = document.getElementById('dr-pervalmode');
    if (pvm) {
      pvm.textContent = periodValueMode === 'pct' ? '%' : '#';
      pvm.onclick = function (){
        periodValueMode = (periodValueMode === 'count') ? 'pct' : 'count';
        pvm.textContent = periodValueMode === 'pct' ? '%' : '#';
        drawPeriod();
      };
    }
  }

  // ---- Open Items by Aging (WPM "Work Package by Aging" pattern) -----------
  // Unfiltered — this is an aggregate for the whole project, independent of
  // whatever the Registry/Backlog filter bar currently has selected.
  var AGING_ORDER = ['>60d overdue', '30-60d overdue', '0-30d (current)', 'Future', 'No due date'];
  var AGING_COLOR = { '>60d overdue':'#EE3124', '30-60d overdue':'#d97706',
    '0-30d (current)':'#8a8f98', 'Future':'#DCDBDB', 'No due date':'#c8c8c8' };
  // Single source of truth for which bucket a row falls in — used both to build
  // the chart and to filter the Backlog when a segment is clicked (UI review #7),
  // so the drill-through can never disagree with the bar it came from.
  function agingBucketOf(r) {
    var a = agingDays(r);
    if (a == null) return 'No due date';
    if (a > 60)    return '>60d overdue';
    if (a > 30)    return '30-60d overdue';
    if (a >= 0)    return '0-30d (current)';
    return 'Future';
  }
  function agingBuckets() {
    var b = {}; AGING_ORDER.forEach(function (k){ b[k]=0; });
    drawingRows().forEach(function (r){
      if (!(!isApprovedStatus(r.status) || r.status==='Revise & Resubmit')) return;
      b[agingBucketOf(r)]++;
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
    // Segments + legend drill into the Backlog filtered to that bucket (#7).
    var bars = AGING_DATED.filter(function (k){ return buckets[k]>0; }).map(function (k){
      var pct = buckets[k]/datedTotal*100;
      return '<div class="dr-agseg" style="width:'+pct+'%;background:'+AGING_COLOR[k]+';"' +
        drillAttr('backlog', { aging:k }) +
        ' title="'+k+': '+buckets[k]+' — click to list them in the Backlog">' +
        (pct>6?buckets[k]:'') + '</div>';
    }).join('');
    var legend = AGING_DATED.filter(function (k){ return buckets[k]>0; }).map(function (k){
      return '<span class="dr-aglegend"'+drillAttr('backlog', { aging:k })+
        ' title="Show these '+buckets[k]+' item'+(buckets[k]===1?'':'s')+' in the Backlog">' +
        '<span style="width:10px;height:10px;background:'+AGING_COLOR[k]+';display:inline-block;border-radius:2px;"></span>' +
        k+' ('+buckets[k]+')</span>';
    }).join('');
    return '<div style="height:36px;border-radius:6px;overflow:hidden;display:flex;">'+bars+'</div>' +
      '<div style="margin-top:8px;">'+legend+'</div>' +
      (noDate ? '<p class="dr-mut" style="font-size:12px;margin:8px 0 0;">+ ' +
        '<button class="dr-linklike"'+drillAttr('backlog', { aging:'No due date' })+
        ' title="List the unlinked open items in the Backlog">'+noDate+' open item'+(noDate===1?'':'s')+'</button>' +
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

  // Period chart — Chart.js (same stack as the Procurement dashboard) so sizing,
  // hover tooltips and data labels behave identically there and here. Replaces an
  // earlier hand-rolled SVG whose fixed viewBox had to be stretched to fill the
  // card, which distorted text and point markers.
  var _periodChart = null;
  function renderPeriodChart(container, data, mode) {
    if (_periodChart) { _periodChart.destroy(); _periodChart = null; }
    if (!data.length) { container.innerHTML = '<p class="dr-mut">No planned/actual approval dates recorded yet.</p>'; return; }
    container.innerHTML = '<canvas id="dr-pc-canvas"></canvas>';
    var pct = mode === 'pct';
    var dark = document.documentElement.classList.contains('pd-dark');
    var ink = dark ? '#F0EFEF' : '#231F20';
    var gridC = dark ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.06)';
    var plannedBar = dark ? '#8A8F98' : '#282C28';
    var fmt = function (v) { return v == null ? '' : (pct ? (Math.round(v*10)/10)+'%' : Math.round(v)); };
    _periodChart = new Chart(container.querySelector('canvas').getContext('2d'), {
      type: 'bar',
      data: {
        labels: data.map(function (d){ return d.label; }),
        datasets: [
          { label:'Planned this period', data:data.map(function(d){return d.planned;}), backgroundColor:plannedBar, borderRadius:3, order:2 },
          { label:'Actual this period',  data:data.map(function(d){return d.actual;}),  backgroundColor:'#EE3124', borderRadius:3, order:2 },
          { label:'Cumulative planned',  data:data.map(function(d){return d.cumPlanned;}), type:'line', borderColor:plannedBar, borderWidth:2, pointRadius:2, fill:false, tension:.15, order:1 },
          { label:'Cumulative approved', data:data.map(function(d){return d.cumActual;}),  type:'line', borderColor:'#EE3124', borderWidth:2, pointRadius:2, fill:false, tension:.15, order:1 }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        plugins:{
          legend:{ position:'bottom', labels:{ usePointStyle:true, boxWidth:12, padding:10, color:ink, font:{size:11} } },
          tooltip:{ callbacks:{ label:function(c){ return c.dataset.label+': '+fmt(c.parsed.y); } } },
          datalabels:{ display:function(c){ return c.dataset.type!=='line' && data.length<=20 && c.dataset.data[c.dataIndex]>0; },
            anchor:'end', align:'end', offset:2, font:{size:9}, color:ink, formatter:fmt }
        },
        scales:{
          x:{ grid:{display:false}, ticks:{ color:ink, font:{size:9}, maxRotation:45, autoSkip:true, maxTicksLimit:24 } },
          y:{ beginAtZero:true, max: pct ? 100 : undefined, grid:{color:gridC},
              ticks:{ color:ink, font:{size:9}, callback:function(v){ return fmt(v); } },
              title:{ display:true, text: pct ? '% of drawings' : 'No. of drawings', color:ink, font:{size:10} } }
        }
      }
    });
  }

  // Status colors mirror the Registry's own pill colors (statusCls) so the chart
  // and the grid pills read as one system.
  var STATUS_COLOR = { 'Ongoing':'#6366f1', 'Pending':'#d97706', 'For Review':'#d97706',
    'Revise & Resubmit':'#dc2626',
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
    // Legend rows drill into the Registry filtered to that status (UI review #7).
    var legend = segs.map(function (s){
      var pct = total ? Math.round(s.count/total*100) : 0;
      return '<div class="dr-legendrow"'+drillAttr('registry', { status:s.label })+
        ' title="Show the '+s.count+' '+Fmt.esc(s.label)+' drawing'+(s.count===1?'':'s')+' in the Registry">' +
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

  // `drillKey` is the filter field this table groups by ('phase' | 'discipline'),
  // so each row can jump to the Registry showing exactly its own drawings (#7).
  function progTable(title, m, order, drillKey) {
    var keys = Object.keys(m).sort(function (a,b){
      var ia=order.indexOf(a), ib=order.indexOf(b);
      if (ia===-1) ia=99; if (ib===-1) ib=99; return ia-ib || a.localeCompare(b);
    });
    var body = keys.map(function (k){
      var g=m[k]; var bal=g.sheets-g.approved;
      var pct=g.sheets?Math.round(g.approved/g.sheets*100):0;
      // '—' is the placeholder for rows with no value in this field; there is no
      // filter value that selects them, so those rows stay non-clickable.
      var patch = {}; var canDrill = drillKey && k !== '—';
      if (canDrill) patch[drillKey] = k;
      return '<tr'+(canDrill ? ' class="dr-drillrow"'+drillAttr('registry', patch) +
          ' title="Show these '+g.dwg+' drawing'+(g.dwg===1?'':'s')+' in the Registry"' : '')+'>' +
        '<td>'+Fmt.esc(g.label)+'</td>' +
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

  // ---- Overview drill-through [UI review #7] --------------------------------
  // The Overview used to be a dead end: you could see that 212 drawings are
  // "Revise & Resubmit" but had to go re-create that filter by hand. Every
  // aggregate that corresponds to a real ROW SET is now a link into the list
  // that produced it.
  // ⚠️ Deliberately NOT everything is clickable. Most Overview KPIs (Total
  // sheets / Submitted / Approved / Approved % / Balance) are SHEET aggregates,
  // not sets of drawings — wiring them to a row filter would take you somewhere
  // that doesn't match the number you clicked. Only genuine row sets drill.
  function drillTo(targetView, patch) {
    patch = patch || {};
    filters.phase      = patch.phase      || '';
    filters.discipline = patch.discipline || '';
    filters.status     = patch.status     || '';
    filters.search     = '';
    filters.dupsOnly   = !!patch.dupsOnly;
    bkAging            = patch.aging      || '';
    // Reflect it in the actual controls, or the bar would lie about the view.
    // ⚠️ A <select> silently ignores a value with no matching <option> — and a
    // legacy status like "Approved w/o comments" can exist in the data (and so
    // appear on the donut) without being in the status list. Add the option
    // rather than let the filter apply while the control reads "All statuses".
    var set = function (id, v){
      var el = document.getElementById(id); if (!el) return;
      v = v || '';
      if (v && el.tagName === 'SELECT' && !Array.prototype.some.call(el.options, function (o){ return o.value === v || o.text === v; })) {
        el.add(new Option(v, v));
      }
      el.value = v;
    };
    set('dr-f-phase', filters.phase); set('dr-f-discipline', filters.discipline);
    set('dr-f-status', filters.status); set('dr-f-search', '');
    // A filtered Registry with everything collapsed shows group headers and no
    // rows, which reads as "the drill found nothing". Open the tree.
    if (targetView === 'registry') collapsed = {};
    view = targetView; saveUI(); render();
    var host = document.getElementById('dr-view');
    if (host && host.scrollIntoView) host.scrollIntoView({ block:'start' });
  }
  // Encodes a drill target onto any element; wireDrills() binds them after render.
  function drillAttr(targetView, patch) {
    return ' data-drill="'+targetView+'" data-dpatch="'+Fmt.esc(JSON.stringify(patch||{}))+'"' +
           ' role="button" tabindex="0"';
  }
  function wireDrills(host) {
    host.querySelectorAll('[data-drill]').forEach(function (el){
      var go = function (e){
        e.preventDefault(); e.stopPropagation();
        var p = {}; try { p = JSON.parse(el.dataset.dpatch || '{}'); } catch (err) {}
        drillTo(el.dataset.drill, p);
      };
      el.onclick = go;
      el.onkeydown = function (e){ if (e.key==='Enter' || e.key===' ') go(e); };
    });
  }

  function kpi(val, label, cls, drill) {
    return '<div class="dr-kpi '+(cls?'dr-'+cls:'')+(drill?' dr-kpi-drill':'')+'"' +
           (drill ? drillAttr(drill.view, drill.patch) + ' title="'+Fmt.esc(drill.tip||('Show these in the '+drill.view))+'"' : '') +
           '><div class="dr-kpi-val">'+val+'</div>' +
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
  function fileLabel(path) {
    if (!path) return '';
    return String(path).split('/').pop().replace(/^\d{10,}_/, '');   // strip the timestamp prefix
  }
  // Best-effort: a failed object delete must never block the row write that
  // already succeeded, or the user is stuck unable to save over a storage hiccup.
  async function removeFiles(paths) {
    var list = (paths || []).filter(Boolean);
    if (!list.length) return;
    try { await sb().storage.from(BUCKET).remove(list); } catch (e) {}
  }
  // Every revision's own file + the approved file, for cleanup on row delete.
  function allFilesOf(r) {
    var out = r.file_url ? [r.file_url] : [];
    (Array.isArray(r.submissions) ? r.submissions : []).forEach(function (s){ if (s && s.file_url) out.push(s.file_url); });
    return out;
  }

  // --------------------------------------------------------- add/edit form ---
  function openForm(r) {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    var isNew = !r; r = r || {};
    // shallow-clone each submission (not just the array) so editing file_url in
    // the form doesn't mutate the row still shown in the grid until Save.
    var subs = Array.isArray(r.submissions) ? r.submissions.map(function (s){ return Object.assign({}, s); }) : [];
    if (!subs.length) subs = [{ rev:0, planned:'', actual:'' }];
    // Storage objects queued for deletion — only removed AFTER the row write
    // succeeds, so cancelling the form or a failed save can never delete a file
    // that's still referenced (matches the module's existing single-file rule).
    var pendingRemoveFiles = [];

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
        field('Drawing type','<select class="pd-select" id="f-phase">'+opt(phaseOptions(r.phase), r.phase, true)+'</select>') +
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
      '<div class="dr-grid-sched">' +
        field('Activity (need-by)', schedPickerHTML(r.schedule_activity_id)) +
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
        // Each revision carries its OWN drawing file: a register needs the actual
        // superseded sheet for every submission, not just a note that a revision
        // happened. `s.file_url` holds that revision's storage path.
        var fileBit = s.file_url
          ? '<span class="dr-subfile"><button class="dr-iconbtn" type="button" data-subview="'+i+'" title="View this revision’s file">'+ico('eye',15)+'</button>' +
            '<span class="dr-subfname" title="'+Fmt.esc(s.file_url)+'">'+Fmt.esc(fileLabel(s.file_url))+'</span>' +
            '<button class="dr-iconbtn dr-rowbtn-del" type="button" data-subrmfile="'+i+'" title="Remove this file (applied on Save)">'+ico('x',14)+'</button></span>'
          : '<input class="pd-input dr-subfileinput" type="file" data-subfile="'+i+'" accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg">';
        return '<div class="dr-subrow">' +
          '<span class="dr-subrev">Rev '+(s.rev!=null?s.rev:i)+'</span>' +
          '<label>Planned<input class="pd-input" type="date" data-sub="'+i+'" data-k="planned" value="'+(s.planned||'')+'"></label>' +
          '<label>Actual<input class="pd-input" type="date" data-sub="'+i+'" data-k="actual" value="'+(s.actual||'')+'"></label>' +
          '<label class="dr-subfilelbl">Drawing file'+fileBit+'</label>' +
          (subs.length>1?'<button class="pd-btn pd-btn-sm dr-rmsub" type="button" data-rmsub="'+i+'" title="Remove this revision">'+ico('x',14)+'</button>':'') +
        '</div>';
      }).join('');
      host.querySelectorAll('[data-sub]').forEach(function (el){
        el.onchange = function(){ subs[+el.dataset.sub][el.dataset.k] = el.value || ''; };
      });
      host.querySelectorAll('[data-subview]').forEach(function (b){
        b.onclick = function(){ viewFile(subs[+b.dataset.subview].file_url); };
      });
      host.querySelectorAll('[data-subrmfile]').forEach(function (b){
        b.onclick = function(){
          var i = +b.dataset.subrmfile;
          if (subs[i].file_url) pendingRemoveFiles.push(subs[i].file_url);
          subs[i].file_url = null; renderSubs();
        };
      });
      host.querySelectorAll('[data-rmsub]').forEach(function (b){
        b.onclick = function(){
          var i = +b.dataset.rmsub;
          if (subs[i].file_url) pendingRemoveFiles.push(subs[i].file_url);
          subs.splice(i,1); renderSubs();
        };
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
    // #f-sact is a hidden input driven by the searchable picker (not typed into),
    // so its change comes from the picker's callback rather than an input event.
    var actPicker = wireSchedPicker(m.el.querySelector('#f-actpick'), refreshSched);
    var leadEl = m.el.querySelector('#f-lead'); leadEl.oninput = leadEl.onchange = refreshSched;
    refreshSched();
    // The schedule loads lazily; if it lands while this form is open, re-render
    // the chosen activity's name and re-derive the date instead of leaving a
    // stale "not in this project's schedule" warning.
    // Capped so it can't poll forever if the modal is dismissed some other way
    // (backdrop click / Esc) before the schedule resolves.
    var schedTries = 0;
    var schedWait = setInterval(function () {
      if (schedPid === pid) { clearInterval(schedWait); actPicker.refreshSel(); refreshSched(); }
      else if (++schedTries > 60) clearInterval(schedWait);
    }, 500);
    var _origClose = m.close;
    m.close = function () { clearInterval(schedWait); _origClose(); };

    m.el.querySelector('#f-cancel').onclick = m.close;
    m.el.querySelector('#f-save').onclick = async function () {
      var btn = m.el.querySelector('#f-save');
      var discCode = m.el.querySelector('#f-disc').value;
      // Read the per-revision file inputs by their CURRENT index, before the
      // filter below reindexes `subs` — otherwise an unfilled early revision
      // would shift the array and attach each upload to the wrong revision.
      var pendingSubUploads = [];
      m.el.querySelectorAll('[data-subfile]').forEach(function (inp){
        var i = +inp.dataset.subfile;
        if (inp.files && inp.files[0] && subs[i]) pendingSubUploads.push({ sub: subs[i], file: inp.files[0] });
      });
      // A revision with only a file (dates not filled in yet) is still a real
      // submission — keep it, or uploading the sheet first would silently drop it.
      // Objects are kept by reference so a pending upload lands on the right one.
      subs = subs.filter(function (s){ return s.planned || s.actual || s.file_url ||
                                              pendingSubUploads.some(function (u){ return u.sub === s; }); });
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
        // submissions / issue_date / due_date are set after the uploads below,
        // once each revision knows its final file path.
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

      if (!data.title && !data.dwg_number) { UI.toast('Sheet title or drawing no. required', 'warn'); return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      // Objects uploaded during THIS save — rolled back if the row write fails,
      // so a DB error can't orphan files in the bucket.
      var uploadedNow = [];
      try {
        // Uploads run BEFORE the row write: a failed upload must never leave a
        // row pointing at a missing object.
        var fileEl = m.el.querySelector('#f-file');
        if (fileEl.files && fileEl.files[0]) {
          btn.textContent='Uploading…';
          var newApproved = await uploadFile(fileEl.files[0]);
          uploadedNow.push(newApproved);
          if (r.file_url) pendingRemoveFiles.push(r.file_url);   // replace: drop the old one after the write
          data.file_url = newApproved;
        }
        for (var ui = 0; ui < pendingSubUploads.length; ui++) {
          btn.textContent = 'Uploading revision '+(ui+1)+'/'+pendingSubUploads.length+'…';
          var up = pendingSubUploads[ui];
          var p = await uploadFile(up.file);
          uploadedNow.push(p);
          if (up.sub.file_url) pendingRemoveFiles.push(up.sub.file_url);
          up.sub.file_url = p;
        }
        // Normalize AFTER uploads so each revision carries its final file path.
        data.submissions = subs.map(function (s,i){
          return { rev:(s.rev!=null?s.rev:i), planned:s.planned||null, actual:s.actual||null, file_url:s.file_url||null };
        });
        data.issue_date = (data.submissions[0] && data.submissions[0].actual) || null;
        data.due_date   = (data.submissions[0] && data.submissions[0].planned) || null;
        btn.textContent = 'Saving…';

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
        // Superseded/removed objects are deleted only AFTER the row successfully
        // points away from them.
        await removeFiles(pendingRemoveFiles);
        UI.toast(warned ? 'Saved — but the schedule link wasn’t stored; run the 2026-07-25 migration.'
                        : 'Saved', warned ? 'warn' : 'ok');
        m.close(); load();
      } catch (e) {
        await removeFiles(uploadedNow);   // roll back this save's uploads
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
    await removeFiles(allFilesOf(r));   // approved file + every revision's own file
    var res = await sb().from(TABLE).delete().eq('id', r.id);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    UI.toast('Deleted', 'ok'); load();
  }

  // ---- Bulk delete the currently selected drawings -------------------------
  async function deleteSelected() {
    // ⚠️ Scoped to the VISIBLE selection, matching the "N selected" count in the
    // bar and setStatusSelected(). It used to take every key in `selected`, which
    // could exceed what the bar reported — a selection made under one filter (or,
    // now that the Backlog has bulk actions too, on the other tab) stays in
    // `selected` while `visibleIds` changes. Deleting more rows than the UI says
    // it will is not a risk worth carrying on an irreversible action.
    var ids = Object.keys(selected).filter(function (id){ return visibleIds.indexOf(id)!==-1; });
    if (!ids.length) return;
    if (!confirm('Delete ' + ids.length + ' selected drawing(s)? This cannot be undone.')) return;
    // Capture every file path BEFORE the rows leave `rows` — afterwards they're unrecoverable.
    // ⚠️ Keyed off `ids` (the visible selection actually being deleted), NOT
    // `selected` — an out-of-view selected row is NOT deleted, so removing its
    // files would orphan a surviving row from its drawing.
    var kill = {}; ids.forEach(function (id){ kill[id] = true; });
    var files = [];
    rows.forEach(function (r){ if (kill[r.id]) files = files.concat(allFilesOf(r)); });
    await removeFiles(files);
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
      var files = [];
      rows.forEach(function (r){ files = files.concat(allFilesOf(r)); });
      await removeFiles(files);
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
      'Drawing type / discipline / category are inferred from the sheet-title indentation (or read from an ' +
      'explicit "Row Level" column when the workbook has one); each sheet row becomes a drawing.</p>' +
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
            // ⚠️ Show the sheet CHOICE rather than silently guessing. These workbooks hold several
            // registry-ish sheets (BAU101 has six, some stale templates), and picking the wrong one
            // is invisible after the fact — you just get the wrong register.
            var cands = candidateSheets(wb);
            if (!cands.length) { prev.textContent = 'No drawing rows found in the workbook.'; return; }
            function showSheet(i) {
              var c = cands[i]; parsed = c.recs;
              var nDraw = c.drawings, nNode = c.recs.length - nDraw;
              var phases = [];
              c.recs.forEach(function (p){ if (p.node_kind==='phase' && p.phase && phases.indexOf(p.phase)===-1) phases.push(p.phase); });
              m.el.querySelector('#dr-imp-info').innerHTML =
                '<strong>'+nDraw+'</strong> drawings' + (nNode?' + '+nNode+' level rows':'') + ' found.' +
                (phases.length ? '<br>Drawing types (L1): '+Fmt.esc(phases.join(' · ')) : '<br>No top-level drawing-type rows detected.') +
                '<br>Sample:<br>' +
                c.recs.filter(function(p){return (p.node_kind||'drawing')==='drawing';}).slice(0,6).map(function (d){
                  return '• '+Fmt.esc((d.phase||'')+' / '+(d.discipline||'')+' — '+(d.drawing_no||d.title));
                }).join('<br>');
              m.el.querySelector('#dr-imp-go').disabled = !nDraw;
            }
            prev.innerHTML = (cands.length>1
                ? '<label class="dr-mut" style="display:block;margin-bottom:6px;">Sheet to import '+
                  '<select class="pd-select" id="dr-imp-sheet" style="max-width:340px;">' +
                  cands.map(function (c,i){ return '<option value="'+i+'">'+Fmt.esc(c.name)+' — '+c.drawings+' drawings</option>'; }).join('') +
                  '</select></label>'
                : '') +
              '<div id="dr-imp-info"></div>';
            var sel = m.el.querySelector('#dr-imp-sheet');
            if (sel) sel.onchange = function (){ showSheet(+sel.value); };
            showSheet(0);
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
  // Returns every candidate sheet with its parsed records, best first, so the import modal can
  // show the choice instead of guessing silently.
  // ⚠️ Ranked by DRAWING count, not record count. These workbooks carry half a dozen registry-ish
  // sheets, several of them stale templates: BAU101's "Dwg Register (Vert)1" parses to 950 records
  // of which **0 are drawings** (it's all group rows), so "most records wins" picked it over the
  // live sheet's 371 drawings — the import then contained no drawings and no top-level blocks at all.
  function candidateSheets(wb) {
    var names = wb.SheetNames.filter(function (n){ return /regist/i.test(n); });
    if (!names.length) names = wb.SheetNames.slice();
    var out = [];
    names.forEach(function (n) {
      var g = gridOf(wb.Sheets[n]);
      var hdr = findHeader(g);
      if (hdr < 0) return;
      var recs = parseGrid(g, hdr);
      var nd = recs.filter(function (p){ return (p.node_kind||'drawing')==='drawing'; }).length;
      if (recs.length) out.push({ name:n, recs:recs, drawings:nd });
    });
    out.sort(function (a,b){ return b.drawings - a.drawings || b.recs.length - a.recs.length; });
    return out;
  }

  function parseWorkbook(wb) {
    var c = candidateSheets(wb);
    return c.length ? c[0].recs : [];
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
      // OPTIONAL explicit row-kind column ("phase" | "discipline" | "category" |
      // "drawing"). When a workbook supplies it, it WINS over the heuristics
      // below; when it's absent everything behaves exactly as before, so the
      // GPR101-style files that rely on the heuristics are unaffected.
      // ⚠️ Why it exists: the heuristics infer "category" from *the absence of*
      // a date and a description — but a real drawing can legitimately have
      // neither (BAU101's Temporary Works and Individual Services sheets are
      // titled and counted, with no date and no description). Those rows were
      // being silently turned into empty category groups. Indentation can't
      // rescue it either: the title is read as "first non-empty column in the
      // title range", which discards which column it came from.
      // ⚠️ Header must be "Row Level", NOT "Level" — `col()` matches on
      // substring and would otherwise collide with "Floor Levels".
      level:       col('row level'),
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
      // ⚠️ "Approval Date (BL0)" is the OPS registers' actual header for the PLANNED approval date
      // (BL0 = the original baseline). It matched none of the old patterns, so every planned
      // approval date in BAU101/GPR101 was silently dropped on import. Kept the older spellings.
      papp:        col('approval date (bl','approval date (plan','planned approval','approval date (base'),
      aapp:        col('approval date (actual','actual approval'),
      rem:         col('remarks')
    };
    // submission revision columns (planned/actual pairs), in header order.
    // ⚠️ `bl` (from a "(BL0)".."(BL4)" header) is a RE-BASELINE of the planned date for the SAME
    // drawing revision — it is NOT a drawing revision. Without capturing it, BL0..BL4 all resolved
    // to rev 0 planned and overwrote each other (BAU101: 119 drawings carry a BL1, 10 carry BL1-BL4),
    // so only the last baseline column survived and the original baseline was lost.
    var subCols = [];
    for (var c=0;c<H.length;c++){
      var h=H[c];
      if (/subm\.? *date/.test(h) || /submission date/.test(h)) {
        var revM = h.match(/rev *(\d+)/);
        var rev = revM ? parseInt(revM[1],10) : 0;
        var kind = /actual/.test(h) ? 'actual' : 'planned';
        var blM = h.match(/\bbl *(\d+)/);
        subCols.push({ c:c, rev:rev, kind:kind, bl: blM ? parseInt(blM[1],10) : null });
      }
    }
    // the title spans several indent columns → treat any column between title and category as title-indent
    var titleStart = ci.title, titleEnd = (ci.category>ci.title?ci.category:ci.title+4);

    function cell(row, c){ return (c>=0 && c<row.length) ? row[c] : ''; }
    // ⚠️ TIMEZONE — this was a REAL BUG and the fix is not cosmetic.
    // The old body did `v.toISOString().slice(0,10)` on a Date. With
    // `cellDates:true`, SheetJS returns the cell displaying 30-Sep-2024 as
    // `2024-09-29T15:59:17Z` (its Excel-serial epoch is ~43s short of midnight),
    // so slicing the ISO string yielded **2024-09-29 — every imported date was a
    // day early**, and local getters are no better (that instant is 23:59 on the
    // 29th in Manila). Neither UTC nor local reads are safe.
    // Fix = ROUND the instant to the nearest whole UTC day, the same approach
    // material-submittal's parseDate() already uses. Strings are parsed with
    // integer maths and never handed to `new Date` when their shape is known.
    var MON_ = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    function p2(n){ return String(n).padStart(2,'0'); }
    function p4(n){ return String(n).padStart(4,'0'); }
    function dateOf(v){
      if (v == null || v === '') return null;
      // Duck-typed, not `instanceof Date`: a Date from another realm (a harness
      // running this module in a vm context) fails instanceof and would fall
      // through to the string branch, shifting the day.
      if (v && typeof v.getTime === 'function' && !isNaN(v.getTime()))
        return new Date(Math.round(v.getTime()/86400000)*86400000).toISOString().slice(0,10);
      if (typeof v === 'number' && isFinite(v))            // Excel serial (1900 system)
        return new Date(Date.UTC(1899,11,30) + Math.round(v)*86400000).toISOString().slice(0,10);
      var s = String(v).trim();
      if (!s || /^0*:?0*:?0*$/.test(s) || /^[-–—]+$/.test(s)) return null;
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);            // already ISO
      var m = /^(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{2,4})$/.exec(s); // 18-Mar-24
      if (m) {
        var mo = MON_[m[2].slice(0,3).toLowerCase()];
        if (mo == null) return null;
        var y = +m[3]; if (y < 100) y += 2000;
        return p4(y)+'-'+p2(mo+1)+'-'+p2(+m[1]);
      }
      var m2 = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);              // dd/mm/yyyy
      if (m2) { var y2=+m2[3]; if (y2<100) y2+=2000; return p4(y2)+'-'+p2(+m2[2])+'-'+p2(+m2[1]); }
      // Last resort: a locale string parses to LOCAL time, so read it back with
      // local getters — toISOString() would shift it a day west of UTC.
      var d2 = new Date(s);
      return isNaN(d2.getTime()) ? null : p4(d2.getFullYear())+'-'+p2(d2.getMonth()+1)+'-'+p2(d2.getDate());
    }
    function intOf(v){ var n=parseInt(String(v).replace(/[^\d.-]/g,''),10); return isFinite(n)?n:0; }

    var recs = [];
    var cur = { phase:'', discipline:'', category:'', building:'', responsible:'' };
    // Anchored so only genuine phase-block titles match — NOT category/sheet
    // titles that merely contain "schematic"/"construction" (e.g. "Schematic
    // Diagrams", "Construction Notes", "Neighbor's As-Built and Crack Mapping").
    // ⚠️ DELIBERATELY NOT WIDENED. Adding `temporary works` / `individual
    // services` / a digit-less `schematic design` here was tried and REVERTED:
    // GPR101 carries "Temporary Works Drawings (TWD)" and "Individual Services
    // Drawings (ISD)" as sub-groups under a phase, so promoting them to phases
    // reset `cur.discipline` and left **25 of its drawings with no discipline**
    // (verified by diffing this parser against the previous version on the real
    // GPR101 workbook). A register that needs those blocks to be phases must
    // declare them in the explicit "Row Level" column instead, which is
    // per-file and cannot regress anyone else.
    var PHASE_RE = /^\s*(concept design|schematic design\s*\d|design development|design analysis|detailed design|contract document|for\s+construction|construction drawing|as[- ]?built drawing|as[- ]?built\s*$|pre[- ]?engineering|tender)\b/i;
    var DISC_RE  = /^(architectural|structural|civil|electrical|auxil|plumbing|mechanical|fire|site develop|landscape)/i;

    // ⚠️ ATTEMPTED AND REVERTED (second time now, by a different route): recognising the OPS
    // template's other top-level blocks — "TEMPORARY WORKS DWG (TWG)" / "INDIVIDUAL SERVICES DWG
    // (ISD)" — from a RAW sheet. Widening PHASE_RE by text was reverted on 2026-08-04; promoting any
    // title sitting in the same indent column as the PHASE_RE-matched phase was tried on 2026-08-04
    // and reverted too. Both fail the same way, and the reason is structural, not cosmetic:
    // BAU101's TWG/ISD blocks contain discipline headers, GPR101's contain drawings DIRECTLY — so
    // promoting them there resets `cur.discipline` and strands **25 GPR101 drawings with no
    // discipline** (measured: blank discipline 1 → 25, categories 245 → 243). There is no
    // text-or-indent signal that separates the two cases.
    // ⇒ A register whose top-level blocks aren't classic design phases must declare them in the
    //   explicit "Row Level" column (per-file, cannot regress anyone else). That is exactly what the
    //   prepared BAU101 import file does, and it yields all five L1s.
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

      // ---- explicit row kind, when the workbook declares one ---------------
      // Deterministic path: no guessing from dates/descriptions at all.
      var lvl = norm(cell(row, ci.level));
      if (lvl) {
        if (lvl === 'phase') {
          cur.phase = cleanPhase(indentText); cur.discipline=''; cur.category='';
          recs.push(nodeRec('phase', noCode, indentText)); continue;
        }
        if (lvl === 'discipline') {
          cur.discipline = disciplineHeader(indentText) || mapDiscipline(indentText); cur.category='';
          var rpL = String(cell(row, ci.resp)).trim(); if (rpL) cur.responsible = rpL;
          recs.push(nodeRec('discipline', noCode, indentText)); continue;
        }
        if (lvl === 'category') {
          cur.category = indentText;
          recs.push(nodeRec('category', noCode, indentText)); continue;
        }
        // 'drawing' → fall through to the sheet branch below, skipping the
        // header heuristics entirely.
      }

      // ---- classify the row by its title/code, NOT by whether it has dates
      // (discipline group rows carry roll-up dates yet are still headers).
      // Header rows are emitted as STRUCTURAL NODES carrying their code (A-100,
      // AR-000, …) so the tree skeleton + codes survive import. ---------------
      // PHASE header (top of the outline): keep the *exact* block name so design
      // iterations (Schematic Design 1/2/3/4, FCD, Scheme 1/2…) stay distinct.
      if (!lvl && indentText && PHASE_RE.test(indentText) && !desc && !dwgno) {
        cur.phase = cleanPhase(indentText); cur.discipline=''; cur.category='';
        recs.push(nodeRec('phase', noCode, indentText)); continue;
      }
      // DISCIPLINE header: the title *is* a discipline name (exact-ish match)
      var discHead = !lvl ? disciplineHeader(indentText) : null;
      if (discHead && !desc) {
        cur.discipline = discHead; cur.category='';
        var rp = String(cell(row, ci.resp)).trim(); if (rp) cur.responsible = rp;
        recs.push(nodeRec('discipline', noCode, indentText)); continue;
      }
      // BUILDING / TOWER header (kept on `cur`, not a render level)
      if (!lvl && indentText && /^(tower|podium|basement|building|amenity)\b/i.test(indentText) && !desc && !dwgno) {
        cur.building = indentText; continue;
      }
      // CATEGORY header: a sub-group label with no dates and no description
      if (!lvl && indentText && !hasDates && !desc) {
        cur.category = indentText;
        recs.push(nodeRec('category', noCode, indentText)); continue;
      }

      // ---- otherwise it's a drawing sheet ----------------------------------
      var title = indentText || desc;
      if (!title && !dwgno) continue;
      // ⚠️ The "no substance" guard exists to skip spacer/decoration rows the
      // heuristics can't otherwise reject. A row the workbook has EXPLICITLY
      // declared a drawing must never be dropped by it — BAU101 has titled
      // sheets carrying no date, no description and no sheet count.
      if (!lvl && !hasDates && !sheets && !desc && !dwgno) continue;

      var subs = [], blByRev = {};
      subCols.forEach(function (s){
        var d = dateOf(cell(row,s.c)); if (!d) return;
        if (s.kind === 'planned' && s.bl != null) { (blByRev[s.rev] = blByRev[s.rev] || {})[s.bl] = d; }
        else push(subs, s.rev, s.kind, d);
      });
      // The LATEST non-empty baseline is the current planned submission date (that's the point of a
      // re-baseline); the whole BL0..BLn series is kept on the entry as `bl` so the original
      // baseline — and therefore the slip between them — is never lost. `submissions` is jsonb,
      // so this needs no migration.
      Object.keys(blByRev).forEach(function (rv){
        var m = blByRev[rv], ks = Object.keys(m).map(Number).sort(function(a,b){return a-b;});
        push(subs, +rv, 'planned', m[ks[ks.length-1]]);
        var e = subs.find(function(x){ return x.rev === +rv; });
        if (e) e.bl = m;
      });
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
    // ⚠️ `w/ comments` (the OPS registers' own spelling) used to fall through to the bare
    // /approved/ test below and be silently downgraded to plain "Approved" — 16 BAU101 drawings
    // lost the "with comments" distinction. The (w/o|without) test still wins for "w/o comments"
    // because `w\/ *comment` can't match "w/o comments" ('o' follows the slash).
    if (/with *comment|w\/ *comment/.test(t)) return 'Approved w/ comments';
    if (/(w\/o|without) *comment/.test(t)) return 'Approved';   // merged: redundant with "Approved"
    if (/superseded/.test(t)) return 'Superseded';
    if (/approved/.test(t)) return 'Approved';
    if (/ongoing|in *progress|wip/.test(t)) return 'Ongoing';   // being drawn, not yet submitted
    if (/pending/.test(t)) return 'Pending';                    // submitted, awaiting review
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
  // Title-case a block name, but keep the template's acronyms upper — otherwise a raw import reads
  // "Temporary Works Dwg (Twg)" / "Individual Services Dwg (Isd)".
  var PHASE_ACRONYMS = ['FCD','TWG','TWD','ISD','DED','BIM','CBW','SD','AB'];
  function cleanPhase(s) {
    var out = String(s||'').replace(/\s+/g,' ').trim()
      .toLowerCase().replace(/\b([a-z])/g, function(m,c){ return c.toUpperCase(); });
    PHASE_ACRONYMS.forEach(function (a){ out = out.replace(new RegExp('\\b'+a+'\\b','ig'), a); });
    return out.replace(/\bDwg\b/g,'Dwg');
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
    // ⚠️ "Type of Drawing" — the workbook's own Coding Reference wording — NOT
    // "Drawing Type". The importer probes `col('drawing type')` for the separate
    // per-drawing code part, and that probe matches on substring: a header of
    // "Drawing Type" would make a re-import of our own export load this column
    // into `drawing_type`. "Type of Drawing" does not contain "drawing type",
    // so the export stays round-trippable. (The old header, "Phase", matched no
    // probe at all — this preserves that property.)
    var aoa = [['Drawing Code','Type of Drawing','Discipline','Category','Sheet Title','Description',
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
