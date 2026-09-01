// ============================================================================
// Risk Register — the EPC Risk and Control Matrix (RCM)
// ----------------------------------------------------------------------------
// Faithful to "SLN101. OPS. Risk Register. 2025 07 01.xlsx". The sheet is not a
// risk LIST; it is a matrix with six bands read left to right, and the module is
// built the same way:
//
//   RISK IDENTIFICATION | RISK APPETITE | RISK ASSESSMENT | RISK RESPONSE
//   | RESIDUAL RISK ASSESSMENT | AUDIT PLAN
//
// Four views: Register (grouped by 5-PMLC activity, with the bands as
// show/hide column groups — the closest honest equivalent of scrolling the
// sheet sideways), Heat Map (the workbook's own 5×5 priority grid, plus the
// residual band split), Risk Universe (the category › sub-category taxonomy with
// this project's counts against it), and Criteria (the controlled document's
// rating tables, so nobody has to open the file to score a risk).
//
// SHARED REFERENCE DATA lives in assets/js/epc-rcm.js (EPCRCM) because the
// Stakeholder Register runs on the identical activity list, taxonomy, criteria
// and grids — see that file's header for why it is not duplicated here.
//
// ⚠️ DERIVED, NEVER STORED: IMPORTANCE (impact × probability), PRIORITY / LEVEL
// (a 5×5 lookup, NOT a band on the product — see EPCRCM.RISK_GRID), the residual
// score and its band. Persisting any of them would only let it drift away from
// the numbers it is made of.
//
// ⚠️ COLUMN REUSE — do not rename these, the dashboard tile counts them
// (config.js → risk-register.dash.metrics):
//   title=Risk Event, category=Risk Category, likelihood=Probability,
//   impact=Impact, rating=IMPORTANCE, response=Control Category (treatment),
//   mitigation=Control Description, owner=Risk Owner, status=Status.
// Everything else arrives with migrations/2026-09-01-risk-register-rcm.sql.
// ============================================================================

window.RiskRegister = (function () {
  var TABLE = 'risk_register';
  var profile = null;
  var pid = null;            // current project id (shared key 'pd_project')
  var rows = [];             // current project's risks (raw from DB)
  var filters = { activity: '', category: '', sub: '', priority: '', status: '', search: '', cell: null };
  var curView = 'list';      // list | heat | universe | criteria
  var histView = null;       // UI.bindHistoryState() handle
  var collapsed = {};        // activity_no -> true when its group is folded
  var bands = { id: true, as: true, rs: true, res: false, au: false };

  var STATUSES = ['Open', 'In Progress', 'Closed'];

  // Legacy category values written before the RCM taxonomy existed. Offered in
  // the picker BELOW the real taxonomy so an old row can be edited without its
  // category silently resetting to blank — and so the person editing it can see
  // the value is off-taxonomy and pick a proper one.
  var LEGACY_CATEGORIES = ['Schedule', 'Safety', 'Environmental', 'Financial', 'Resource', 'External'];

  // Owner / champion / control-owner are ROLES in this register ("Contracts
  // Manager", "Project Manager"), not app accounts, so they are free text with
  // the sheet's own vocabulary offered as suggestions plus whatever this project
  // already uses (collected in load()).
  var ROLE_SUGGESTIONS = ['Project Manager', 'Site Manager', 'Contracts Manager', 'Commercial Manager',
    'Procurement Manager', 'Engineering Head', 'Design Manager', 'PMO Head', 'Planning Engineer',
    'QAQC Engineer', 'HSE Manager', 'Safety Officer', 'Warehouse Supervisor', 'Finance Head',
    'Project Comptroller', 'Bids Department', 'Operations Head', 'COO'];

  function sb() { return AppAuth.getSB(); }
  function $(id) { return document.getElementById(id); }
  function E() { return window.EPCRCM; }

  // ===== live collaboration (presence + who's-editing row cursor) + offline =====
  var _collab = null, _remoteSel = {}, _collabSelf = {}, PKEY = 'risk_register', PID_PFX = 'rr';
  function joinCollab() {
    if (!window.PDCollab) return;
    if (_collab) { _collab.leave(); _collab = null; }
    _remoteSel = {};
    if (!pid) { renderPresence([]); return; }
    _collab = PDCollab.join({
      key: PKEY + ':' + pid, table: TABLE, projectId: pid, self: _collabSelf,
      onPresence: function (ms) { renderPresence(ms); _remoteSel = {}; ms.forEach(function (m) { if (!m.self && m.sel) _remoteSel[m.id] = { id: m.id, name: m.name, color: m.color, sel: m.sel }; }); paintRemote(); },
      onSelection: function (d) { if (d.sel) _remoteSel[d.id] = { id: d.id, name: d.name, color: d.color, sel: d.sel }; else delete _remoteSel[d.id]; paintRemote(); },
      onRemoteChange: applyRemoteChange
    });
  }
  function renderPresence(ms) { var el = $(PID_PFX + '-presence'); if (el) el.innerHTML = window.PDCollab ? PDCollab.avatarsHTML(ms || []) : ''; }
  function broadcastCollabSel(id, editing) { if (_collab) _collab.setSelection(id ? { rowId: id, editing: !!editing } : null); }
  function _collabRow(id) { var rid = (window.CSS && CSS.escape) ? CSS.escape(String(id)) : id; return document.querySelector('tr[data-id="' + rid + '"]') || (function () { var b = document.querySelector('[data-edit="' + rid + '"]'); return b ? b.closest('tr') : null; })(); }
  function paintRemote() { if (!window.PDCollab) return; PDCollab.clearCells(document); Object.keys(_remoteSel).forEach(function (k) { var m = _remoteSel[k]; if (!m || !m.sel || !m.sel.rowId) return; var tr = _collabRow(m.sel.rowId); if (!tr) return; var td = tr.querySelector('td'); if (td) PDCollab.paintCell(td, m); }); }
  function applyRemoteChange(payload) {
    var evt = payload.eventType || payload.event, rec = payload['new'] || payload.record || null, old = payload['old'] || payload.old_record || null;
    if (evt === 'DELETE') { var did = old && old.id; if (did == null) return; rows = rows.filter(function (x) { return String(x.id) !== String(did); }); }
    else if (rec) { var j = -1; for (var i = 0; i < rows.length; i++) { if (String(rows[i].id) === String(rec.id)) { j = i; break; } } if (j < 0) rows.push(rec); else rows[j] = rec; }
    else return;
    render();
  }
  function wireModalCursor(m, r) {
    if (!r || !r.id) return;
    var oc = m.close; m.close = function () { broadcastCollabSel(null); oc(); };
    broadcastCollabSel(r.id, true);
    m.el.addEventListener('click', function (e) { if (e.target === m.el) broadcastCollabSel(null); });
  }

  // ---- derivations (all pure, none stored) --------------------------------
  function importanceOf(r) {
    var i = +r.impact || 0, p = +r.likelihood || 0;
    return (i && p) ? i * p : null;
  }
  function priorityOf(r) { return E().riskPriority(r.impact, r.likelihood); }
  function residualOf(r) { return E().residualScore(r.res_impact, r.res_possibility, r.res_detectability); }

  // ========================================================================
  async function init(user, prof) {
    profile = prof;
    _collabSelf = { id: (user && user.id) || (prof && prof.id), name: (prof && (prof.name || prof.email)) || 'Someone' };
    try { collapsed = JSON.parse(localStorage.getItem('rr_collapsed') || '{}') || {}; } catch (e) { collapsed = {}; }
    try { bands = Object.assign(bands, JSON.parse(localStorage.getItem('rr_bands') || '{}')); } catch (e) {}

    await loadProjects();
    renderCriteria();
    renderBandToggles();

    $('rr-add').onclick = function () { openForm(null); };
    $('rr-export').onclick = exportCsv;
    $('rr-project').onchange = function (e) {
      pid = e.target.value; sessionStorage.setItem('pd_project', pid); load(); joinCollab();
    };
    ['rr-f-activity', 'rr-f-category', 'rr-f-sub', 'rr-f-priority', 'rr-f-status', 'rr-f-search'].forEach(function (id) {
      var el = $(id);
      el.oninput = el.onchange = function () {
        // The sub-category list only means anything under a chosen category, so
        // it is repopulated (and reset) whenever the category changes.
        if (id === 'rr-f-category') { filters.sub = ''; fillSubFilter(); }
        readFilters(); render();
      };
    });
    $('rr-clear').onclick = function () {
      filters = { activity: '', category: '', sub: '', priority: '', status: '', search: '', cell: null };
      ['rr-f-activity', 'rr-f-category', 'rr-f-sub', 'rr-f-priority', 'rr-f-status', 'rr-f-search']
        .forEach(function (id) { $(id).value = ''; });
      fillSubFilter(); render();
    };
    document.querySelectorAll('.rr-tabs [data-view]').forEach(function (a) {
      a.onclick = function (e) { e.preventDefault(); switchView(a.dataset.view, a); histView.push(); };
    });

    // Browser-history integration (see UI.bindHistoryState in ui.js): without
    // this, switching views never touches the URL, so the browser's native Back
    // button has nothing to step through — it jumps straight past every view to
    // the module launcher.
    histView = UI.bindHistoryState({
      key: 'rr_view',
      get: function () { return { view: curView }; },
      apply: function (s) { switchView(s.view, document.querySelector('.rr-tabs [data-view="' + s.view + '"]')); }
    });

    if (pid) load();
    joinCollab();
  }

  function readFilters() {
    filters.activity = $('rr-f-activity').value;
    filters.category = $('rr-f-category').value;
    filters.sub      = $('rr-f-sub').value;
    filters.priority = $('rr-f-priority').value;
    filters.status   = $('rr-f-status').value;
    filters.search   = $('rr-f-search').value.toLowerCase().trim();
  }

  async function loadProjects() {
    var projects = await PDb.getProjects();
    var sel = $('rr-project');
    pid = sessionStorage.getItem('pd_project') || (projects[0] && projects[0].id) || null;
    sel.innerHTML = '<option value="">Select project…</option>' +
      projects.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === pid ? ' selected' : '') + '>' + Fmt.esc(p.name) + '</option>';
      }).join('');
    UI.enhanceProjectSelect(sel);
    if (!projects.length) {
      $('rr-table').innerHTML = '<tr><td style="padding:24px;color:var(--pd-muted);">No projects yet. Ask an admin to create one.</td></tr>';
    }
    // The activity filter is the workbook's own 20-item list, not whatever the
    // data happens to contain — a planner filtering to "PROCUREMENT" before any
    // procurement risk exists should get an empty register, not a missing option.
    $('rr-f-activity').innerHTML = '<option value="">All activities</option>' +
      E().ACTIVITIES.map(function (a) { return '<option value="' + a.no + '">' + a.no + '. ' + Fmt.esc(a.name) + '</option>'; }).join('') +
      '<option value="0">— Unassigned —</option>';
    $('rr-f-category').innerHTML = '<option value="">All categories</option>' +
      E().CATEGORY_NAMES.map(function (c) { return '<option>' + Fmt.esc(c) + '</option>'; }).join('');
    fillSubFilter();
  }

  function fillSubFilter() {
    var subs = filters.category ? E().subNamesOf(filters.category) : [];
    var sel = $('rr-f-sub');
    sel.disabled = !subs.length;
    sel.innerHTML = '<option value="">' + (subs.length ? 'All sub-categories' : 'Sub-category') + '</option>' +
      subs.map(function (s) { return '<option' + (filters.sub === s ? ' selected' : '') + '>' + Fmt.esc(s) + '</option>'; }).join('');
  }

  async function load() {
    if (!pid) return;
    // ⚠️ Keyset-paginated via PDb.selectAll: a plain .select() is capped at 1000 rows
    // SERVER-side and truncates silently — a register past that would under-report every
    // KPI with no error. Shaped as {data}/{error} so the offline-cache fallback is untouched.
    var res;
    try { res = { data: await PDb.selectAll(TABLE, function (q) { return q.eq('project_id', pid); }) }; }
    catch (err) { res = { error: err }; }
    if (res.error) {
      if (window.PDSync) { var c = await PDSync.cacheGet(PID_PFX + ':' + pid); if (c && c.rows) { rows = c.rows.slice(); render(); return; } }
      UI.toast(migrationHint(res.error), 'error'); return;
    }
    rows = res.data || [];
    sortRows();
    if (window.PDSync) PDSync.cachePut(PID_PFX + ':' + pid, rows);
    render();
  }

  // The sheet's order: activity, then hand-arranged order within it, then the
  // worst risk first. ⚠️ NOT rating-desc overall — that shuffles a register
  // every time a score is edited, and the controlled document's rows do not move
  // when a number changes.
  function sortRows() {
    rows.sort(function (a, b) {
      var an = a.activity_no == null ? 9999 : a.activity_no, bn = b.activity_no == null ? 9999 : b.activity_no;
      if (an !== bn) return an - bn;
      var as = a.sort_order || 0, bs = b.sort_order || 0;
      if (as !== bs) return as - bs;
      var ap = E().priorityRank(priorityOf(a)), bp = E().priorityRank(priorityOf(b));
      if (ap !== bp) return ap - bp;
      return (importanceOf(b) || 0) - (importanceOf(a) || 0);
    });
  }

  function migrationHint(e) {
    return /column .* does not exist|schema cache/i.test((e && e.message) || '')
      ? 'Run migrations/2026-09-01-risk-register-rcm.sql first.' : (e && e.message) || 'Request failed';
  }

  // ---- filtering ----------------------------------------------------------
  function filtered() {
    return rows.filter(function (r) {
      if (filters.activity) {
        var want = +filters.activity;
        var have = r.activity_no == null ? 0 : +r.activity_no;
        if (have !== want) return false;
      }
      if (filters.category && String(r.category || '').replace(/\s+/g, '').toLowerCase() !== filters.category.replace(/\s+/g, '').toLowerCase()) return false;
      if (filters.sub && r.sub_category !== filters.sub) return false;
      if (filters.priority && priorityOf(r) !== filters.priority) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.cell && (+r.likelihood !== filters.cell.p || +r.impact !== filters.cell.i)) return false;
      if (filters.search) {
        var hay = [r.risk_code, r.title, r.description, r.category, r.sub_category, r.activity, r.sub_process,
                   r.owner, r.risk_champion, r.response, r.mitigation, r.control_owner, r.control_type,
                   r.audit_procedures, r.required_documents, r.audit_contact].join(' ').toLowerCase();
        if (hay.indexOf(filters.search) === -1) return false;
      }
      return true;
    });
  }
  function anyFilter() {
    return !!(filters.activity || filters.category || filters.sub || filters.priority ||
              filters.status || filters.search || filters.cell);
  }

  function render() {
    renderKpis();
    renderTable();
    renderHeat();
    renderUniverse();
    $('rr-clear').classList.toggle('show', anyFilter());
    paintRemote();
  }

  // ---- KPIs --------------------------------------------------------------
  function renderKpis() {
    var open = rows.filter(function (r) { return r.status !== 'Closed'; });
    var counts = priorityCounts(open);
    var resHigh = open.filter(function (r) { var s = residualOf(r); return s != null && s >= 65; }).length;
    var cost = rows.reduce(function (a, r) { return a + (+r.response_cost || 0); }, 0);
    $('rr-kpis').innerHTML =
      kpi('Risk events', rows.length, '', 'total on the register') +
      kpi('Open', open.length, '', 'not yet closed') +
      kpi('1st Priority', counts['1st Priority'] || 0, 'rcm-p1', 'of the open risks') +
      kpi('2nd Priority', counts['2nd Priority'] || 0, 'rcm-p2', 'of the open risks') +
      kpi('Residual High', resHigh, 'rcm-res-high', 'score ≥ 65 after controls') +
      kpi('Response cost', Fmt.moneyShort(cost), '', 'planned, all rows');
  }
  function priorityCounts(list) {
    var c = {};
    E().PRIORITIES.forEach(function (p) { c[p] = 0; });
    (list || rows).forEach(function (r) { var p = priorityOf(r); if (p) c[p]++; });
    return c;
  }
  function kpi(label, val, cls, sub) {
    return '<div class="rr-kpi ' + cls + '"><div class="rr-kpi-val">' + val + '</div>' +
      '<div class="rr-kpi-label">' + label + '</div>' +
      (sub ? '<div class="rr-kpi-sub">' + sub + '</div>' : '') + '</div>';
  }

  // ---- band (column-group) toggles ---------------------------------------
  var BANDS = [
    { key: 'id',  label: 'Identification' },
    { key: 'as',  label: 'Assessment' },
    { key: 'rs',  label: 'Response' },
    { key: 'res', label: 'Residual' },
    { key: 'au',  label: 'Audit plan' }
  ];
  function renderBandToggles() {
    $('rr-bands').innerHTML = '<span class="rr-bands-lab">Bands</span>' + BANDS.map(function (b) {
      return '<button class="rr-band' + (bands[b.key] ? ' on' : '') + '" data-band="' + b.key + '">' + b.label + '</button>';
    }).join('');
    $('rr-bands').querySelectorAll('[data-band]').forEach(function (btn) {
      btn.onclick = function () {
        bands[btn.dataset.band] = !bands[btn.dataset.band];
        try { localStorage.setItem('rr_bands', JSON.stringify(bands)); } catch (e) {}
        renderBandToggles(); renderTable(); paintRemote();
      };
    });
  }

  // ---- the register table ------------------------------------------------
  // Column descriptors, tagged with the RCM band they belong to. Building the
  // table from a list rather than a literal is what lets the band toggles hide
  // whole groups AND lets exportCsv() emit every column regardless of what is
  // currently on screen (an export that mirrors the visible columns is a
  // partial register, which is the one thing a controlled document must not be).
  // ⚠️ A control description is a 3-sentence procedure, and a <td> that simply
  // wraps it makes EVERY cell in that row as tall as the tallest text — measured
  // at 209px per row on a real fixture, i.e. one risk per screen. Clamped to
  // three lines here (the full text is in the edit modal and the CSV) so the
  // register stays scannable. Clamping needs a block child: applying
  // -webkit-line-clamp to the <td> itself would change its display and break
  // the table layout.
  function clamp(txt) {
    txt = (txt == null ? '' : String(txt)).trim();
    if (!txt) return '';
    return '<div class="rr-clamp" title="' + Fmt.esc(txt) + '">' + Fmt.esc(txt) + '</div>';
  }

  function columns() {
    var cols = [
      { band: '_', label: 'Code', cls: 'rr-c-code', v: function (r) { return Fmt.esc(r.risk_code); } },
      { band: '_', label: 'Risk event', cls: 'rr-c-title', v: function (r) {
          return '<strong>' + Fmt.esc(r.title) + '</strong>' +
            (r.description ? '<div class="rr-sub">' + Fmt.esc(r.description) + '</div>' : '');
        } },
      { band: 'id', label: 'Sub-process', v: function (r) { return Fmt.esc(r.sub_process); } },
      { band: 'id', label: 'Category', v: function (r) {
          if (!r.category && !r.sub_category) return '—';
          return '<span class="rr-cat">' + Fmt.esc(r.category) + '</span>' +
            (r.sub_category ? '<div class="rr-sub">' + Fmt.esc(r.sub_category) + '</div>' : '');
        } },
      { band: 'id', label: 'Risk owner', v: function (r) { return Fmt.esc(r.owner); } },
      { band: 'id', label: 'Champion', v: function (r) { return Fmt.esc(r.risk_champion); } },
      { band: 'id', label: 'Appetite', v: function (r) { return Fmt.esc(r.risk_appetite); } },
      { band: 'as', label: 'I', cls: 'rr-num', v: function (r) { return r.impact || '—'; } },
      { band: 'as', label: 'P', cls: 'rr-num', v: function (r) { return r.likelihood || '—'; } },
      { band: 'as', label: 'Imp.', cls: 'rr-num', v: function (r) { return importanceOf(r) || '—'; } },
      { band: 'as', label: 'Priority', v: function (r) {
          var p = priorityOf(r);
          return p ? '<span class="rcm-pill ' + E().priorityClass(p) + '">' + E().priorityShort(p) + '</span>' : '—';
        } },
      { band: 'rs', label: 'Response', v: function (r) { return Fmt.esc(r.response); } },
      { band: 'rs', label: 'Control type', v: function (r) { return Fmt.esc(r.control_type); } },
      { band: 'rs', label: 'Control description', cls: 'rr-c-ctrl', v: function (r) { return clamp(r.mitigation); } },
      { band: 'rs', label: 'Control owner', v: function (r) { return Fmt.esc(r.control_owner); } },
      { band: 'rs', label: 'Response cost', cls: 'rr-num', v: function (r) { return r.response_cost == null ? '—' : Fmt.moneyShort(r.response_cost); } },
      { band: 'res', label: 'rI', cls: 'rr-num', v: function (r) { return r.res_impact || '—'; } },
      { band: 'res', label: 'rP', cls: 'rr-num', v: function (r) { return r.res_possibility || '—'; } },
      { band: 'res', label: 'rC', cls: 'rr-num', v: function (r) { return r.res_detectability || '—'; } },
      { band: 'res', label: 'Residual', v: function (r) {
          var s = residualOf(r); if (s == null) return '—';
          var b = E().residualBand(s);
          return '<span class="rcm-pill ' + b.cls + '">' + s + ' · ' + b.label + '</span>';
        } },
      { band: 'au', label: 'Audit procedures', cls: 'rr-c-wide', v: function (r) { return clamp(r.audit_procedures); } },
      { band: 'au', label: 'Required documents', cls: 'rr-c-wide', v: function (r) { return clamp(r.required_documents); } },
      { band: 'au', label: 'Point person', v: function (r) { return Fmt.esc(r.audit_contact); } },
      { band: 'au', label: 'Timing', v: function (r) { return Fmt.esc(r.audit_timing); } },
      { band: '_', label: 'Status', v: function (r) {
          var s = r.status || 'Open';
          return '<span class="rr-st rr-st-' + s.replace(/\s+/g, '').toLowerCase() + '">' + Fmt.esc(s) + '</span>';
        } },
      { band: '_', label: 'Review', v: function (r) { return r.review_date ? Fmt.date(r.review_date) : '—'; } }
    ];
    return cols;
  }
  function visibleColumns() {
    return columns().filter(function (c) { return c.band === '_' || bands[c.band]; });
  }

  function renderTable() {
    var t = $('rr-table');
    if (!rows.length) {
      t.innerHTML = '<tr><td style="padding:24px;color:var(--pd-muted);">No risk events yet for this project. Click “Add risk event”.</td></tr>';
      return;
    }
    var data = filtered();
    var cols = visibleColumns();

    // Two header rows: the RCM band names on top (so the register reads like the
    // sheet), the column names below.
    var bandRow = '', run = null, span = 0;
    cols.forEach(function (c) {
      var name = c.band === '_' ? '' : (BANDS.filter(function (b) { return b.key === c.band; })[0] || {}).label;
      if (name === run) { span++; return; }
      if (span) bandRow += '<th class="rr-bandhead' + (run ? '' : ' rr-bandhead-x') + '" colspan="' + span + '">' + (run || '') + '</th>';
      run = name; span = 1;
    });
    if (span) bandRow += '<th class="rr-bandhead' + (run ? '' : ' rr-bandhead-x') + '" colspan="' + span + '">' + (run || '') + '</th>';
    bandRow += '<th class="rr-bandhead rr-bandhead-x"></th>';

    var head = '<thead><tr class="rr-bands-row">' + bandRow + '</tr><tr>' +
      cols.map(function (c) { return '<th>' + c.label + '</th>'; }).join('') + '<th></th></tr></thead>';

    // Grouped by activity, exactly as the sheet is. A group header carries the
    // process objective, which is the thing that makes a risk event legible —
    // "Missed-out scope and quantities" means nothing until you know the block
    // it sits in is Bid Preparation.
    var groups = [], byNo = {};
    data.forEach(function (r) {
      var no = r.activity_no == null ? 0 : +r.activity_no;
      if (!byNo[no]) { byNo[no] = { no: no, rows: [] }; groups.push(byNo[no]); }
      byNo[no].rows.push(r);
    });
    groups.sort(function (a, b) { return (a.no || 9999) - (b.no || 9999); });

    var body = groups.map(function (g) {
      var act = g.no ? E().activityByNo(g.no) : null;
      var name = act ? act.name : (g.rows[0].activity || 'Unassigned activity');
      var isCol = !!collapsed[g.no];
      var gp = priorityCounts(g.rows);
      var hdr = '<tr class="rr-grow" data-group="' + g.no + '">' +
        '<td colspan="' + (cols.length + 1) + '">' +
          '<span class="rr-gcar' + (isCol ? ' col' : '') + '">▾</span>' +
          '<span class="rr-gno">' + (g.no || '—') + '</span>' +
          '<span class="rr-gname">' + Fmt.esc(name) + '</span>' +
          '<span class="rr-gcount">' + g.rows.length + ' risk' + (g.rows.length === 1 ? '' : 's') + '</span>' +
          E().PRIORITIES.filter(function (p) { return gp[p]; }).map(function (p) {
            return '<span class="rcm-pill-o ' + E().priorityClass(p) + '">' + gp[p] + ' × ' + E().priorityShort(p) + '</span>';
          }).join('') +
          (act ? '<div class="rr-gobj">' + Fmt.esc(act.objective) + '</div>' : '') +
        '</td></tr>';
      if (isCol) return hdr;
      return hdr + g.rows.map(function (r) {
        return '<tr data-id="' + r.id + '">' + cols.map(function (c) {
          // data-l = the column heading. Unused on desktop (the <thead> supplies
          // it); below 900px module.css hides the head and stacks each row into a
          // card, where every value needs its own inline label.
          return '<td' + (c.cls ? ' class="' + c.cls + '"' : '') + ' data-l="' + c.label + '">' + c.v(r) + '</td>';
        }).join('') +
        '<td class="rr-rowacts"><button class="pd-btn" data-edit="' + r.id + '">Edit</button> ' +
        '<button class="pd-btn" data-del="' + r.id + '">Delete</button></td></tr>';
      }).join('');
    }).join('');

    t.innerHTML = head + '<tbody>' + (body ||
      '<tr><td colspan="' + (cols.length + 1) + '" style="padding:24px;color:var(--pd-muted);">No risk events match the current filters.</td></tr>') + '</tbody>';

    t.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () { openForm(rows.filter(function (x) { return x.id === b.dataset.edit; })[0]); };
    });
    t.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { del(b.dataset.del); }; });
    t.querySelectorAll('.rr-grow').forEach(function (tr) {
      tr.onclick = function (e) {
        if (e.target.closest('button')) return;
        var no = tr.dataset.group;
        if (collapsed[no]) delete collapsed[no]; else collapsed[no] = true;
        try { localStorage.setItem('rr_collapsed', JSON.stringify(collapsed)); } catch (err) {}
        renderTable(); paintRemote();
      };
    });
  }

  // ---- Heat Map view -----------------------------------------------------
  function renderHeat() {
    var open = rows.filter(function (r) { return r.status !== 'Closed'; });
    var buckets = {};
    open.forEach(function (r) {
      var i = +r.impact, p = +r.likelihood;
      if (i >= 1 && i <= 5 && p >= 1 && p <= 5) (buckets[p + '|' + i] = buckets[p + '|' + i] || []).push(r);
    });
    var html = E().gridHTML({
      xMax: 5, yMax: 5, xLabel: 'Impact →', yLabel: 'Probability →',
      cls: function (x, y) {
        var p = E().RISK_GRID[y][x];
        var active = filters.cell && filters.cell.p === y && filters.cell.i === x;
        return E().priorityClass(p) + (active ? ' rcm-cell-active' : '');
      },
      title: function (x, y) {
        return 'Impact ' + x + ' × Probability ' + y + ' = ' + (x * y) + ' · ' + E().RISK_GRID[y][x];
      },
      cell: function (x, y) {
        var list = buckets[y + '|' + x] || [];
        var chips = list.slice(0, 2).map(function (r) {
          return '<span class="rcm-gchip" title="' + Fmt.esc(r.title) + '">' + Fmt.esc(r.title) + '</span>';
        }).join('');
        if (list.length > 2) chips += '<span class="rcm-gchip">+' + (list.length - 2) + '</span>';
        return '<span class="rcm-gcell-lab">' + E().priorityShort(E().RISK_GRID[y][x]) + '</span>' +
          (list.length ? '<span class="rcm-gcell-count">' + list.length + '</span>' + '<span class="rcm-gchips">' + chips + '</span>'
                       : '<span class="rcm-gcell-empty">·</span>');
      }
    });
    $('rr-heat').innerHTML = html;
    $('rr-heat').querySelectorAll('.rcm-gcell').forEach(function (cell) {
      cell.onclick = function () {
        var i = +cell.dataset.x, p = +cell.dataset.y;
        if (filters.cell && filters.cell.p === p && filters.cell.i === i) filters.cell = null;
        else filters.cell = { p: p, i: i };
        switchView('list', document.querySelector('.rr-tabs [data-view="list"]'));
        render();
        if (histView) histView.push();
      };
    });
    $('rr-heat-legend').innerHTML = E().priorityLegendHTML(priorityCounts(open));

    // Residual split. The residual band is a THREE-factor score, so it has no
    // 5×5 grid of its own in the workbook — the honest presentation is the band
    // count, beside how many rows have not been re-assessed at all.
    var bandsCount = { Low: 0, Moderate: 0, High: 0 }, unscored = 0;
    open.forEach(function (r) {
      var s = residualOf(r);
      if (s == null) { unscored++; return; }
      bandsCount[E().residualBand(s).label]++;
    });
    $('rr-res-summary').innerHTML =
      '<div class="rr-resrow">' +
        resCard('Low', bandsCount.Low, 'rcm-res-low', '1 – 27') +
        resCard('Moderate', bandsCount.Moderate, 'rcm-res-mod', '28 – 64') +
        resCard('High', bandsCount.High, 'rcm-res-high', '65 – 125') +
        resCard('Not re-assessed', unscored, '', 'residual band left blank') +
      '</div>';
  }
  function resCard(label, val, cls, sub) {
    return '<div class="rr-rescard ' + cls + '"><div class="rr-kpi-val">' + val + '</div>' +
      '<div class="rr-kpi-label">' + label + '</div><div class="rr-kpi-sub">' + sub + '</div></div>';
  }

  // ---- Risk Universe view ------------------------------------------------
  // The taxonomy with THIS project's counts against it. The value is the empty
  // rows: a category with zero risks is either genuinely not a risk on this job
  // or a blind spot, and the register cannot raise that question by itself.
  function renderUniverse() {
    var byCat = {}, bySub = {};
    rows.forEach(function (r) {
      var c = String(r.category || '').replace(/\s+/g, '').toLowerCase();
      byCat[c] = (byCat[c] || 0) + 1;
      bySub[c + '|' + String(r.sub_category || '').toLowerCase()] = (bySub[c + '|' + String(r.sub_category || '').toLowerCase()] || 0) + 1;
    });
    var html = '<table class="rcm-tbl rr-uni"><thead><tr><th>Category</th><th>Sub-category</th><th>Description</th><th class="rr-num">Risks</th></tr></thead><tbody>';
    E().CATEGORIES.forEach(function (c, ci) {
      var ck = c.name.replace(/\s+/g, '').toLowerCase();
      html += '<tr class="rr-unicat"><td colspan="3"><strong>' + (ci + 1) + '. ' + Fmt.esc(c.name) + '</strong></td>' +
              '<td class="rr-num"><strong>' + (byCat[ck] || 0) + '</strong></td></tr>';
      c.subs.forEach(function (s) {
        var n = bySub[ck + '|' + s.name.toLowerCase()] || 0;
        html += '<tr' + (n ? '' : ' class="rr-unizero"') + '><td></td><td>' + Fmt.esc(s.name) + '</td>' +
          '<td class="rcm-muted">' + Fmt.esc(s.desc) + '</td><td class="rr-num">' + (n || '—') + '</td></tr>';
      });
    });
    // Off-taxonomy values (pre-RCM rows) are surfaced, not hidden: they are the
    // rows whose category has to be corrected before the counts above mean anything.
    var off = {};
    rows.forEach(function (r) {
      var c = String(r.category || '').replace(/\s+/g, '').toLowerCase();
      if (!c) { off['(blank)'] = (off['(blank)'] || 0) + 1; return; }
      if (!E().subsOf(r.category).length) off[r.category] = (off[r.category] || 0) + 1;
    });
    var offKeys = Object.keys(off);
    if (offKeys.length) {
      html += '<tr class="rr-unicat"><td colspan="3"><strong>Off-taxonomy</strong> <span class="rcm-muted">— rows written before the EPC Risk Universe; re-categorise them</span></td>' +
        '<td class="rr-num"><strong>' + offKeys.reduce(function (a, k) { return a + off[k]; }, 0) + '</strong></td></tr>';
      offKeys.sort().forEach(function (k) {
        html += '<tr><td></td><td>' + Fmt.esc(k) + '</td><td class="rcm-muted">not in the taxonomy</td><td class="rr-num">' + off[k] + '</td></tr>';
      });
    }
    $('rr-universe').innerHTML = html + '</tbody></table>';
  }

  // ---- Criteria view (static reference; rendered once) --------------------
  function renderCriteria() {
    var e = E();
    $('rr-criteria').innerHTML =
      '<div class="pd-card"><h2 style="margin-top:0;">Risk rating criteria</h2>' +
      '<p class="rr-help">Transcribed from “Criteria for Risk Assessment” in <em>SLN101. OPS. Risk Register</em>. Score every risk event against these tables so two planners on two projects mean the same thing by a 4.</p>' +
      e.probabilityTableHTML() + e.impactTableHTML() + e.treatmentTableHTML() +
      '</div>' +
      '<div class="pd-card"><h2 style="margin-top:0;">Priority heat map (reference)</h2>' +
      '<p class="rr-help">Priority / Level is a lookup of Impact × Probability into this grid — <strong>not</strong> a band on the product. Impact 5 × Probability 1 and Impact 1 × Probability 5 both score 5, and land on different priorities.</p>' +
      '<div class="rr-refgrid">' + e.gridHTML({
        xMax: 5, yMax: 5, xLabel: 'Impact →', yLabel: 'Probability →',
        cls: function (x, y) { return e.priorityClass(e.RISK_GRID[y][x]); },
        title: function (x, y) { return 'Impact ' + x + ' × Probability ' + y; },
        cell: function (x, y) { return '<span class="rcm-gcell-lab">' + e.priorityShort(e.RISK_GRID[y][x]) + '</span>'; }
      }) + '</div>' + e.priorityLegendHTML(null) +
      '</div>' +
      '<div class="pd-card"><h2 style="margin-top:0;">Residual risk assessment</h2>' +
      '<p class="rr-help">After the control is in place, re-score the event: <strong>severity × occurrence × degree of control</strong> (1–125). This is the number a control is supposed to move; leaving it blank means the register can only ever show inherent risk.</p>' +
      e.controlTableHTML() + e.residualBandTableHTML() +
      '</div>' +
      '<div class="pd-card"><h2 style="margin-top:0;">Control masterlist</h2>' + e.controlMasterlistHTML() + '</div>';
  }

  var VIEWS = ['list', 'heat', 'universe', 'criteria'];

  function switchView(view, link) {
    // ⚠️ Normalise before anything reads `view`. The 5x5 grid used to be called
    // 'matrix'; a bookmark or a Back press carrying `#rr_view=matrix` would
    // otherwise match no view, hide all four, and render a blank page with no
    // error. Anything unrecognised falls back to the register rather than to
    // nothing — an unknown view is a stale link, not a reason to show a void.
    if (view === 'matrix') view = 'heat';
    if (VIEWS.indexOf(view) === -1) view = 'list';
    if (!link) link = document.querySelector('.rr-tabs [data-view="' + view + '"]');
    curView = view;
    VIEWS.forEach(function (v) {
      var el = $('rr-view-' + v); if (el) el.style.display = view === v ? '' : 'none';
    });
    // The filter bar and the band toggles only apply to the register itself.
    $('rr-filters').style.display = view === 'list' ? '' : 'none';
    $('rr-bands').style.display = view === 'list' ? '' : 'none';
    if (link) {
      document.querySelectorAll('.rr-tabs [data-view]').forEach(function (a) { a.classList.remove('active'); });
      link.classList.add('active');
    }
  }

  // ========================================================================
  // Add / Edit — one modal, sectioned by the six RCM bands
  // ========================================================================
  function openForm(r) {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    var isNew = !r; r = r || {};
    var e = E();

    function opts(list, val, blank) {
      return (blank ? '<option value="">—</option>' : '') +
        list.map(function (o) { return '<option' + (val === o ? ' selected' : '') + '>' + Fmt.esc(o) + '</option>'; }).join('');
    }
    // 1–5 rating select carrying the criteria table's own descriptors, so the
    // scale is on screen at the moment of scoring rather than in another tab.
    function rate(val, scale, extra) {
      var s = '<option value="">—</option>';
      for (var i = scale.length - 1; i >= 0; i--) {
        var x = scale[i];
        s += '<option value="' + x.rating + '"' + (+val === x.rating ? ' selected' : '') + '>' +
             x.rating + ' — ' + x.label + (extra ? ' (' + extra(x) + ')' : '') + '</option>';
      }
      return s;
    }
    function dl(id, list) {
      return '<datalist id="' + id + '">' + list.map(function (o) { return '<option value="' + Fmt.esc(o) + '">'; }).join('') + '</datalist>';
    }

    var roles = uniqueSorted(ROLE_SUGGESTIONS.concat(
      rows.map(function (x) { return x.owner; }),
      rows.map(function (x) { return x.risk_champion; }),
      rows.map(function (x) { return x.control_owner; })));

    var actOpts = '<option value="">— not assigned —</option>' + e.ACTIVITIES.map(function (a) {
      return '<option value="' + a.no + '"' + (+r.activity_no === a.no ? ' selected' : '') + '>' + a.no + '. ' + Fmt.esc(a.name) + '</option>';
    }).join('');

    var m = UI.modal(
      '<h2 style="margin-top:0;">' + (isNew ? 'Add risk event' : 'Edit risk event') + '</h2>' +

      '<div class="rr-fsec">1 · Risk identification</div>' +
      '<div class="rr-frow">' +
        '<div class="pd-field" style="flex:2;"><label>Activity / business process (5-PMLC)</label><select class="pd-select" id="f-act">' + actOpts + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Sub-process</label><input class="pd-input" id="f-sub" list="dl-subproc" value="' + Fmt.esc(r.sub_process) + '">' + '</div>' +
        '<div class="pd-field" style="flex:0 0 120px;"><label>Risk code</label><input class="pd-input" id="f-code" value="' + Fmt.esc(r.risk_code) + '" placeholder="R-001"></div>' +
      '</div>' +
      '<div class="rr-actinfo" id="f-actinfo"></div>' +
      '<div class="rr-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Risk category</label><select class="pd-select" id="f-cat">' +
          '<option value="">—</option>' + opts(e.CATEGORY_NAMES, r.category, false) +
          '<optgroup label="Legacy (off-taxonomy)">' + opts(LEGACY_CATEGORIES, r.category, false) + '</optgroup>' +
          (r.category && e.CATEGORY_NAMES.indexOf(r.category) === -1 && LEGACY_CATEGORIES.indexOf(r.category) === -1
            ? '<option selected>' + Fmt.esc(r.category) + '</option>' : '') +
        '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Risk sub-category</label><select class="pd-select" id="f-subcat"></select></div>' +
      '</div>' +
      '<div class="pd-field"><label>Risk event</label><input class="pd-input" id="f-title" value="' + Fmt.esc(r.title) + '" placeholder="what could go wrong"></div>' +
      '<div class="pd-field"><label>Description / cause</label><textarea class="pd-textarea" id="f-desc" rows="2">' + Fmt.esc(r.description) + '</textarea></div>' +
      '<div class="rr-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Risk owner</label><input class="pd-input" id="f-owner" list="dl-roles" value="' + Fmt.esc(r.owner) + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Risk champion</label><input class="pd-input" id="f-champ" list="dl-roles" value="' + Fmt.esc(r.risk_champion) + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Risk appetite</label><input class="pd-input" id="f-appetite" value="' + Fmt.esc(r.risk_appetite) + '" placeholder="e.g. Low / Tolerant"></div>' +
      '</div>' +

      '<div class="rr-fsec">2 · Risk assessment <span class="rr-fsec-hint">inherent — before controls</span></div>' +
      '<div class="rr-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Impact (1–5)</label><select class="pd-select" id="f-imp">' + rate(r.impact, e.IMPACT, function (x) { return 'cost ' + x.cost; }) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Probability (1–5)</label><select class="pd-select" id="f-like">' + rate(r.likelihood, e.PROBABILITY, function (x) { return x.rate; }) + '</select></div>' +
      '</div>' +
      '<div class="rcm-derived" id="f-out-inh"></div>' +

      '<div class="rr-fsec">3 · Risk response</div>' +
      '<div class="rr-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Response (treatment)</label><select class="pd-select" id="f-resp">' +
          '<option value="">—</option>' + opts(e.RESPONSES, r.response, false) +
          (r.response && e.RESPONSES.indexOf(r.response) === -1 ? '<option selected>' + Fmt.esc(r.response) + '</option>' : '') +
        '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Control category</label><select class="pd-select" id="f-ctype"><option value="">—</option>' + opts(e.CONTROL_TYPE_NAMES, r.control_type, false) + '</select></div>' +
      '</div>' +
      '<div class="pd-field"><label>Control description <span class="rr-lbl-hint" id="f-ctrl-hint"></span></label>' +
        '<textarea class="pd-textarea" id="f-mit" rows="3" placeholder="who does what, how often, and by when">' + Fmt.esc(r.mitigation) + '</textarea>' +
        '<div class="rr-suggest" id="f-ctrl-sug"></div></div>' +
      '<div class="rr-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Control owner</label><input class="pd-input" id="f-cowner" list="dl-roles" value="' + Fmt.esc(r.control_owner) + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Response cost (PHP)</label><input class="pd-input" type="number" step="0.01" id="f-rcost" value="' + (r.response_cost == null ? '' : r.response_cost) + '"></div>' +
      '</div>' +

      '<div class="rr-fsec">4 · Residual risk assessment <span class="rr-fsec-hint">after the control is in place</span></div>' +
      '<div class="rr-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Severity (1–5)</label><select class="pd-select" id="f-ri">' + rate(r.res_impact, e.IMPACT, null) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Occurrence (1–5)</label><select class="pd-select" id="f-rp">' + rate(r.res_possibility, e.PROBABILITY, null) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Degree of control (1–5)</label><select class="pd-select" id="f-rd">' + rate(r.res_detectability, e.CONTROL, null) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Residual response cost</label><input class="pd-input" type="number" step="0.01" id="f-rrcost" value="' + (r.res_response_cost == null ? '' : r.res_response_cost) + '"></div>' +
      '</div>' +
      '<div class="rcm-derived" id="f-out-res"></div>' +

      '<div class="rr-fsec">5 · Audit plan</div>' +
      '<div class="pd-field"><label>Audit procedures</label><textarea class="pd-textarea" id="f-audp" rows="2">' + Fmt.esc(r.audit_procedures) + '</textarea></div>' +
      '<div class="pd-field"><label>Required documents</label><textarea class="pd-textarea" id="f-audd" rows="2">' + Fmt.esc(r.required_documents) + '</textarea></div>' +
      '<div class="rr-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Contact / point person</label><input class="pd-input" id="f-audc" list="dl-roles" value="' + Fmt.esc(r.audit_contact) + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Timing</label><input class="pd-input" id="f-audt" value="' + Fmt.esc(r.audit_timing) + '" placeholder="e.g. Monthly / Per milestone"></div>' +
      '</div>' +

      '<div class="rr-fsec">6 · Tracking</div>' +
      '<div class="rr-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Status</label><select class="pd-select" id="f-status">' + opts(STATUSES, r.status || 'Open', false) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Identified</label><input class="pd-input" type="date" id="f-idate" value="' + (r.identified_date || '') + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Target close</label><input class="pd-input" type="date" id="f-tdate" value="' + (r.target_date || '') + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Next review</label><input class="pd-input" type="date" id="f-review" value="' + (r.review_date || '') + '"></div>' +
      '</div>' +

      dl('dl-roles', roles) + '<datalist id="dl-subproc"></datalist>' +
      '<div style="text-align:right;margin-top:10px;"><button class="pd-btn" id="f-cancel">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="f-save">Save</button></div>'
    );

    function q(sel) { return m.el.querySelector(sel); }

    // -- activity → objective/description + sub-process suggestions ---------
    function paintActivity() {
      var no = +q('#f-act').value;
      var a = no ? e.activityByNo(no) : null;
      q('#f-actinfo').innerHTML = a
        ? '<div class="rr-actinfo-t">Process objective</div><div>' + Fmt.esc(a.objective) + '</div>' +
          '<div class="rr-actinfo-t">Process description</div><div>' + Fmt.esc(a.description) + '</div>'
        : '<span class="rcm-muted">Pick an activity and its process objective and description appear here — they are what make a risk event legible in the register.</span>';
      q('#dl-subproc').innerHTML = (a ? a.subs : []).map(function (s) { return '<option value="' + Fmt.esc(s) + '">'; }).join('');
      // Only auto-fill a BLANK sub-process. Overwriting one the planner typed
      // (or one an older row already carries) would lose real data on every edit.
      if (a && a.subs.length === 1 && !q('#f-sub').value.trim()) q('#f-sub').value = a.subs[0];
    }
    q('#f-act').onchange = paintActivity; paintActivity();

    // -- category → sub-category cascade ------------------------------------
    // ⚠️ `curSub` is a LOCAL, not `r.sub_category`. Changing the category has to
    // clear the sub-category picker (the old value belongs to a different
    // branch of the taxonomy), but writing that clear onto `r` would edit the
    // in-memory register row even if the planner then cancels the modal.
    var curSub = r.sub_category || '';
    function paintSubcat() {
      var subs = e.subNamesOf(q('#f-cat').value);
      q('#f-subcat').disabled = !subs.length;
      q('#f-subcat').innerHTML = '<option value="">' + (subs.length ? '—' : 'no sub-categories') + '</option>' +
        subs.map(function (s) { return '<option' + (curSub === s ? ' selected' : '') + '>' + Fmt.esc(s) + '</option>'; }).join('') +
        (curSub && subs.indexOf(curSub) === -1 ? '<option selected>' + Fmt.esc(curSub) + '</option>' : '');
    }
    q('#f-cat').onchange = function () { curSub = ''; paintSubcat(); }; paintSubcat();

    // -- control category → key-control suggestions ------------------------
    function paintCtrlSug() {
      var t = q('#f-ctype').value;
      var list = e.controlsOf(t);
      q('#f-ctrl-hint').textContent = t ? '(' + list.length + ' key control' + (list.length === 1 ? '' : 's') + ' in the masterlist)' : '';
      q('#f-ctrl-sug').innerHTML = list.length
        ? '<span class="rr-sug-lab">Masterlist:</span>' + list.map(function (c, i) {
            return '<button type="button" class="rr-sug" data-sug="' + i + '">' + Fmt.esc(c) + '</button>';
          }).join('')
        : '';
      q('#f-ctrl-sug').querySelectorAll('[data-sug]').forEach(function (btn) {
        btn.onclick = function () {
          // Appends, never replaces — a real control description is usually two
          // or three of these plus the site's own specifics.
          var ta = q('#f-mit'), add = list[+btn.dataset.sug];
          ta.value = ta.value.trim() ? ta.value.replace(/\s*$/, '') + '\n' + add : add;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.focus();
        };
      });
    }
    q('#f-ctype').onchange = paintCtrlSug; paintCtrlSug();

    // -- live derivations ---------------------------------------------------
    function paintOut() {
      var i = +q('#f-imp').value || 0, p = +q('#f-like').value || 0;
      var imp = (i && p) ? i * p : null;
      var pri = e.riskPriority(i, p);
      q('#f-out-inh').innerHTML = imp
        ? '<span class="rcm-d-k">Importance</span><span class="rcm-d-v">' + imp + '</span>' +
          '<span class="rcm-d-k">Priority / level</span><span class="rcm-d-v"><span class="rcm-pill ' + e.priorityClass(pri) + '">' + pri + '</span></span>' +
          '<span class="rcm-muted">derived from the 5×5 heat map — never stored</span>'
        : '<span class="rcm-muted">Set Impact and Probability to derive Importance and Priority / Level.</span>';

      var s = e.residualScore(q('#f-ri').value, q('#f-rp').value, q('#f-rd').value);
      var b = e.residualBand(s);
      q('#f-out-res').innerHTML = s != null
        ? '<span class="rcm-d-k">Residual score</span><span class="rcm-d-v">' + s + ' / 125</span>' +
          '<span class="rcm-d-k">Band</span><span class="rcm-d-v"><span class="rcm-pill ' + b.cls + '">' + b.label + '</span></span>' +
          '<span class="rcm-muted">' + Fmt.esc(b.action) + '</span>'
        : '<span class="rcm-muted">Set all three to derive the residual band (severity × occurrence × degree of control).</span>';
    }
    ['#f-imp', '#f-like', '#f-ri', '#f-rp', '#f-rd'].forEach(function (s) { q(s).onchange = paintOut; });
    paintOut();

    wireModalCursor(m, isNew ? null : r);
    q('#f-cancel').onclick = m.close;
    q('#f-save').onclick = async function () {
      var no = +q('#f-act').value || null;
      var act = no ? e.activityByNo(no) : null;
      var i = +q('#f-imp').value || null, p = +q('#f-like').value || null;
      var data = {
        project_id: pid,
        activity_no:         no,
        // Denormalised on purpose: the activity NAME is stored so a row still
        // says what process it belongs to when it is exported, or read by a
        // dashboard that does not load EPCRCM.
        activity:            act ? act.name : (q('#f-act').value ? r.activity : null),
        sub_process:         q('#f-sub').value.trim(),
        process_objectives:  act ? act.objective : null,
        process_description: act ? act.description : null,
        risk_code:    q('#f-code').value.trim(),
        category:     q('#f-cat').value,
        sub_category: q('#f-subcat').value,
        title:        q('#f-title').value.trim(),
        description:  q('#f-desc').value.trim(),
        owner:         q('#f-owner').value.trim(),
        risk_champion: q('#f-champ').value.trim(),
        risk_appetite: q('#f-appetite').value.trim(),
        impact:     i,
        likelihood: p,
        rating:     (i && p) ? i * p : null,     // IMPORTANCE — derived, kept for the dashboard tile
        response:      q('#f-resp').value,
        control_type:  q('#f-ctype').value,
        mitigation:    q('#f-mit').value.trim(),
        control_owner: q('#f-cowner').value.trim(),
        response_cost: numOrNull(q('#f-rcost').value),
        res_impact:        +q('#f-ri').value || null,
        res_possibility:   +q('#f-rp').value || null,
        res_detectability: +q('#f-rd').value || null,
        res_response_cost: numOrNull(q('#f-rrcost').value),
        audit_procedures:   q('#f-audp').value.trim(),
        required_documents: q('#f-audd').value.trim(),
        audit_contact:      q('#f-audc').value.trim(),
        audit_timing:       q('#f-audt').value.trim(),
        status:          q('#f-status').value,
        identified_date: q('#f-idate').value || null,
        target_date:     q('#f-tdate').value || null,
        review_date:     q('#f-review').value || null,
        updated_at: new Date().toISOString(),
      };
      if (!data.title) { UI.toast('Risk event is required', 'warn'); return; }
      try {
        if (isNew) {
          data.created_by = profile.id;              // REQUIRED for RLS
          // New rows land at the end of their activity block, not the top: the
          // sheet appends.
          data.sort_order = 10 + rows.filter(function (x) { return (x.activity_no || 0) === (no || 0); }).length * 10;
          var ins = await sb().from(TABLE).insert(data);
          if (ins.error) throw ins.error;
          UI.toast('Saved', 'ok'); m.close(); load();
        } else {
          Object.assign(r, data);   // optimistic — applies whether online or queued offline
          if (window.PDSync) {
            var w = await PDSync.write({ table: TABLE, op: 'update', id: r.id, patch: data });
            if (!w.ok) throw (w.error || new Error('Save failed'));
            PDSync.cachePut(PID_PFX + ':' + pid, rows);
          } else {
            var upd = await sb().from(TABLE).update(data).eq('id', r.id);
            if (upd.error) throw upd.error;
          }
          UI.toast('Saved', 'ok'); m.close(); sortRows(); render();
        }
      } catch (err) { UI.toast(migrationHint(err), 'error'); }
    };

    // Autosave (edit only): debounced re-use of the Save button's own handler.
    if (!isNew && window.Autosave) {
      var asInd = document.createElement('span');
      asInd.className = 'pd-autosave pd-autosave-idle';
      asInd.textContent = 'Autosave on';
      var h2 = m.el.querySelector('h2');
      if (h2) { h2.style.display = 'flex'; h2.style.alignItems = 'center'; h2.style.gap = '10px'; h2.appendChild(asInd); }
      var as = Autosave.wire({ root: m.el, modal: m, saveBtn: q('#f-save'), indicator: asInd });
      var _rrClose = m.close;
      m.close = function () { as.cancel(); _rrClose(); };
    }
  }

  function numOrNull(v) { v = String(v == null ? '' : v).trim(); if (!v) return null; var x = Number(v); return isNaN(x) ? null : x; }
  function uniqueSorted() {
    var seen = {}, out = [];
    Array.prototype.slice.call(arguments).forEach(function (list) {
      (list || []).forEach(function (v) {
        v = (v == null ? '' : String(v)).trim();
        if (!v || seen[v.toLowerCase()]) return;
        seen[v.toLowerCase()] = 1; out.push(v);
      });
    });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }

  // ---- Export ------------------------------------------------------------
  // ⚠️ EVERY column, in RCM order, regardless of which bands are on screen and
  // regardless of the active filters' effect on the *columns*. Row filters ARE
  // respected (you asked for this slice), but a band toggle is a viewing
  // convenience and an export that dropped those columns would be a silently
  // partial copy of a controlled document.
  function exportCsv() {
    if (!rows.length) { UI.toast('Nothing to export', 'warn'); return; }
    var e = E();
    var head = ['Activity No.', 'Activity / Business Process', 'Sub-process', 'Process Objectives',
      'Risk Code', 'Risk Category', 'Risk Sub-Category', 'Risk Event', 'Description',
      'Risk Owner', 'Risk Champion', 'Risk Appetite',
      'Impact', 'Probability', 'IMPORTANCE', 'PRIORITY / LEVEL',
      'Response', 'Control Category', 'Control Description', 'Control Owner', 'Response Cost (PHP)',
      'Residual Severity', 'Residual Occurrence', 'Degree of Control', 'Residual IMPORTANCE', 'Residual Band', 'Residual Response Cost',
      'Audit Procedures', 'Required Documents', 'Contact / Point Person', 'Timing',
      'Status', 'Identified', 'Target Close', 'Next Review'];
    var body = filtered().map(function (r) {
      var s = residualOf(r);
      return [r.activity_no, r.activity, r.sub_process, r.process_objectives,
        r.risk_code, r.category, r.sub_category, r.title, r.description,
        r.owner, r.risk_champion, r.risk_appetite,
        r.impact, r.likelihood, importanceOf(r), priorityOf(r),
        r.response, r.control_type, r.mitigation, r.control_owner, r.response_cost,
        r.res_impact, r.res_possibility, r.res_detectability, s, s == null ? '' : e.residualBand(s).label, r.res_response_cost,
        r.audit_procedures, r.required_documents, r.audit_contact, r.audit_timing,
        r.status, r.identified_date, r.target_date, r.review_date];
    });
    downloadCsv('risk-register', head, body);
  }

  function downloadCsv(base, head, body) {
    function cell(v) {
      if (v == null) return '';
      var s = String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var csv = [head].concat(body).map(function (r) { return r.map(cell).join(','); }).join('\r\n');
    // ⚠️ BOM. Without it Excel on Windows opens a UTF-8 CSV as ANSI and every
    // ₱, × and en-dash in this register becomes mojibake.
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var pname = (sessionStorage.getItem('pd_project_name') || pid || 'project').replace(/[^\w.\- ]+/g, '');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = base + ' — ' + pname + ' — ' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    UI.toast('Exported ' + body.length + ' row' + (body.length === 1 ? '' : 's'), 'ok');
  }

  async function del(id) {
    if (!confirm('Delete this risk event? This cannot be undone.')) return;
    var res = await sb().from(TABLE).delete().eq('id', id);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    UI.toast('Deleted', 'ok'); load();
  }

  return { init: init };
})();
