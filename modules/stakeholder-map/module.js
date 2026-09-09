// ============================================================================
// Stakeholder Map — the EPC Stakeholder Register (with photos)
// ----------------------------------------------------------------------------
// Faithful to "CSF101. OPS. Stakeholder Register. 2026 02 13.xlsx", which is the
// Risk and Control Matrix with one band swapped: a stakeholder is registered
// AGAINST a 5-PMLC activity, assessed Impact × Influence, given a response and a
// relationship owner, costed, re-assessed for residual risk, audited, and handed
// an engagement plan with a named Megawide counterpart.
//
//   STAKEHOLDER IDENTIFICATION | RISK APPETITE | STAKEHOLDER ASSESSMENT
//   | STAKEHOLDER RESPONSE | RESIDUAL RISK ASSESSMENT | AUDIT PLAN
//   | STAKEHOLDER ENGAGEMENT
//
// Four views: Register (activity-grouped, RCM bands as show/hide column groups),
// Cards (the faces — the reason photos exist), Impact / Influence (the
// workbook's 4×4 priority grid AND its Mendelow map, side by side, because the
// sheet computes two different answers from the same two numbers and shows
// both), and Criteria.
//
// PHOTOS. Private bucket `stakeholder-photos`; the row stores the object PATH and
// the module signs short-lived URLs on demand — a stored signed URL expires and
// is then a broken face forever. A real, separate ~200px JPEG is generated
// client-side at upload so the Cards view does not depend on Supabase's
// image-transform add-on being enabled on the plan.
//
// SHARED REFERENCE DATA is in assets/js/mcc-rcm.js (MCCRCM) — the activity list,
// the EPC taxonomy, the criteria tables and every grid are identical to the Risk
// Register's, and duplicating them is how the two would drift apart.
//
// ⚠️ DERIVED, NEVER STORED: Importance (Impact × Influence), Priority Level (a
// 4×4 lookup), Response Category (a lookup of Priority), the Mendelow approach,
// the residual score and band, and the BD map's Strategy/Frequency chain.
//
// ⚠️ COLUMN REUSE — do not rename, the dashboard tile plots them
// (config.js → stakeholder-map.dash.metrics):
//   influence = Impact 1–4   (the register's col M)
//   interest  = Influence 1–4 (col N — the BD map called this axis "Interest")
//   category  = Sector (Government / Private), from the BD map; the OPS
//               register's own Stakeholder Category is `stk_category`.
// Everything else arrives with migrations/2026-09-01-stakeholder-register-ops.sql.
// ============================================================================

window.StakeholderMap = (function () {
  var TABLE = 'stakeholder_map';
  var BUCKET = 'stakeholder-photos';
  var SIGN_TTL = 3600;                  // 1h — long enough for a working session
  var profile = null;
  var pid = null;
  var rows = [];
  var urlCache = {};                    // object path -> signed URL
  var filters = { activity: '', category: '', sub: '', priority: '', approach: '', flag: '', search: '', cell: null };
  var curView = 'list';                 // list | cards | grid | criteria
  var histView = null;
  var collapsed = {};
  var bands = { id: true, as: true, en: true, rs: false, res: false, au: false };
  var filterToggle = null;   // UI.wireFilterToggle() handle for #sm-filters

  // ==========================================================================
  // THE STAKEHOLDER DIRECTORY -- a person is global, an engagement is per project
  // --------------------------------------------------------------------------
  // migrations/2026-09-08-stakeholder-directory.sql. Owner, 2026-09-08: "it would
  // be very tedious to fill this out for every stakeholder ... if there is an
  // existing stakeholder it should be able to add it in the stakeholder map of
  // the project."
  //
  // PERSON_FIELDS is the whole contract, in one place, and BOTH directions read
  // it -- the overlay on load and the split on save. Two hand-maintained lists is
  // how a field ends up global in one direction and project-local in the other,
  // which presents as "my correction saved and then came back wrong".
  //
  // ⚠️ WHAT IS *NOT* HERE IS THE POINT. `relationship_champion`, `relationship_owner`,
  //    `primary_responsible`, `alternate`, `megawide_counterpart` and
  //    `engagement_plan` all name a PERSON but are PROJECT facts: who owns the
  //    relationship on THIS job. The same mayor can be owned by two different
  //    Megawide people on two projects, and that is not a conflict to reconcile.
  //    Nor is `stk_category` here -- the risk-taxonomy classification is a
  //    judgement about this project's exposure, while `category` (Sector) is a
  //    fact about the institution.
  var DIR = 'stakeholders';
  var PERSON_FIELDS = ['name', 'title', 'nickname', 'role_title', 'organization',
                       'category', 'stakeholder_group', 'email', 'contact',
                       'birthday', 'gift_tier', 'photo_path', 'photo_thumb_path'];
  var people = {};        // stakeholder id -> directory row (the ones this project links)
  var dirAll = null;      // the whole directory, lazily loaded for the picker; null = not yet
  var dirUsage = {};      // stakeholder id -> project_id[]  (for "already on N projects")
  var dirOff = false;     // true once we know the table is not there yet

  function personOf(row) { return row && row.stakeholder_id ? people[row.stakeholder_id] : null; }

  // ⚠️ Overlay, not merge-with-preference-for-the-row. Where a person is linked
  //    the DIRECTORY WINS on every person field, including blanking one the
  //    project row still has a stale value for -- otherwise "I removed his old
  //    e-mail" would appear to work on the directory and keep showing the old
  //    address on the register that reads the mirror.
  //    Unlinked (pre-migration, or blank-named) rows are left completely alone.
  function overlayPeople() {
    rows.forEach(function (row) {
      var p = personOf(row);
      if (!p) return;
      PERSON_FIELDS.forEach(function (f) { row[f] = p[f] == null ? null : p[f]; });
    });
  }

  function dirMissing(err) {
    return /relation .*stakeholders.* does not exist|could not find the table|schema cache/i
      .test((err && (err.message || err.hint)) || '');
  }

  // Load only the people THIS project links, plus their cross-project usage.
  // ⚠️ Two narrow queries, not one join. `PDb.selectAll` keyset-paginates and the
  //    module's whole read path is built on plain table selects; a PostgREST
  //    embedded select would also silently return null for a row whose person was
  //    deleted, which is indistinguishable from "not linked".
  async function loadPeople() {
    people = {}; dirUsage = {};
    var ids = {};
    rows.forEach(function (r) { if (r.stakeholder_id) ids[r.stakeholder_id] = 1; });
    var list = Object.keys(ids);
    if (!list.length) return;
    try {
      // ⚠️ Chunked at 200. An `in.()` filter travels in the URL and a long list
      //    trips the server's URL cap -- the same limit the schedule module hit.
      for (var i = 0; i < list.length; i += 200) {
        var res = await sb().from(DIR).select('*').in('id', list.slice(i, i + 200));
        if (res.error) throw res.error;
        (res.data || []).forEach(function (p) { people[p.id] = p; });
      }
      // ⚠️ CHUNKED TOO. This read the first 200 ids only while the loop above
      //    chunked correctly, so on a register with more than 200 distinct people
      //    the "registered on N projects" line in the form would quietly under-
      //    report -- a wrong number presented as a fact, which is worse than no
      //    number. Same 200 as above, same reason: `in.()` travels in the URL.
      for (var j = 0; j < list.length; j += 200) {
        var use = await sb().from(TABLE).select('stakeholder_id,project_id').in('stakeholder_id', list.slice(j, j + 200));
        if (use.error) continue;
        (use.data || []).forEach(function (u) {
          if (!u.stakeholder_id) return;
          var a = dirUsage[u.stakeholder_id] || (dirUsage[u.stakeholder_id] = []);
          if (a.indexOf(u.project_id) === -1) a.push(u.project_id);
        });
      }
    } catch (err) {
      // ⚠️ NOT fatal, and it must not be. Until the owner runs the migration the
      //    table is absent; every row is then simply unlinked and the module
      //    behaves exactly as it did before this feature existed.
      if (dirMissing(err)) { dirOff = true; return; }
      UI.toast('Stakeholder directory unavailable: ' + ((err && err.message) || 'request failed'), 'warn');
    }
  }

  // Create-or-find a directory entry for a person, and return its id.
  // ⚠️ Find-then-insert, and the INSERT still has to cope with losing a race:
  //    two planners registering the same new mayor on two projects at the same
  //    moment both find nothing and both insert, and the second hits
  //    `stakeholders_name_org_uidx`. That is not an error to report -- the other
  //    insert produced exactly the row this one wanted, so the 23505 is caught
  //    and turned into a second lookup. Postgres's own unique index is what makes
  //    the outcome correct; this function only has to not panic about it.
  // ⚠️ Matching is on (name, organization) case-insensitively, folding a blank
  //    organisation to '' -- the SAME key as the unique index, or a "find" that
  //    misses would insert a duplicate the index then refuses, and the save would
  //    fail with a constraint error the planner cannot act on.
  async function findOrCreatePerson(fields) {
    var name = String(fields.name || '').trim();
    var org  = String(fields.organization || '').trim();
    if (!name) return null;

    async function find() {
      var res = await sb().from(DIR).select('*').ilike('name', name).limit(50);
      if (res.error) throw res.error;
      var hit = (res.data || []).filter(function (x) {
        return String(x.name || '').trim().toLowerCase() === name.toLowerCase() &&
               String(x.organization || '').trim().toLowerCase() === org.toLowerCase();
      })[0];
      return hit || null;
    }

    var found = await find();
    if (found) return found;

    var row = {};
    PERSON_FIELDS.forEach(function (f) {
      if (fields[f] !== undefined) row[f] = fields[f] === '' ? null : fields[f];
    });
    row.name = name;
    row.organization = org || null;
    row.created_by = profile.id;                 // REQUIRED for RLS (stakeholders_ins)
    row.updated_at = new Date().toISOString();
    var ins = await sb().from(DIR).insert(row).select('*');
    if (ins.error) {
      // 23505 = unique_violation: somebody else inserted this person first.
      if (String(ins.error.code) === '23505' || /duplicate key|already exists/i.test(ins.error.message || '')) {
        var again = await find();
        if (again) return again;
      }
      throw ins.error;
    }
    return (ins.data || [])[0] || null;
  }

  // Write person fields back to the directory. This is the ONLY path that
  // changes a person, and it is reached from one place -- the "Edit person"
  // dialog. A project's Save never touches it.
  async function updatePerson(id, fields) {
    var patch = {};
    PERSON_FIELDS.forEach(function (f) {
      if (fields[f] !== undefined) patch[f] = fields[f] === '' ? null : fields[f];
    });
    patch.updated_at = new Date().toISOString();
    var res = await sb().from(DIR).update(patch).eq('id', id).select('id');
    if (res.error) throw res.error;
    // ⚠️ .select('id') and a length check, not a bare await. An RLS refusal on
    //    UPDATE matches zero rows and returns NO error -- this app has been bitten
    //    by exactly that shape before (progress-photos' deletes, 2026-09-xx), and
    //    reporting "Saved" over a write that never happened is the worst outcome
    //    available.
    if (!res.data || !res.data.length) {
      throw new Error('The directory refused the change (viewers cannot edit people).');
    }

    // ---- refresh the MIRROR on every project row that links this person ----
    // ⚠️ WHY THIS IS NEEDED AT ALL, given overlayPeople() already makes this
    //    module's own screens correct: `modules/portfolio-overview/index.html`
    //    reads `stakeholder_map` DIRECTLY (line ~2010) and renders `r.name`,
    //    `r.organization` and `r.category` from it, with no directory join. So
    //    without this, correcting a mayor's title here fixed the register and
    //    left the cross-project Stakeholders tab showing the old one until
    //    somebody happened to re-save that project's row. Measured, not assumed:
    //    that page's own `shRender()` was read before writing this.
    // ⚠️ ONE statement across every linked row, and it is ALLOWED to come back
    //    short. `stakeholder_map`'s UPDATE policy is owner-or-admin, so a planner
    //    cannot rewrite a row another project's planner created -- PostgREST
    //    filters those out and reports success for the rest. That is why the
    //    count is returned rather than swallowed: a partial refresh is a real
    //    outcome the caller has to be able to describe honestly.
    // ⚠️ BEST EFFORT, never fatal. The person IS updated at this point (the
    //    directory is the source of truth), so throwing here would report a
    //    successful change as a failure -- the worse of the two errors.
    var mirrored = 0, mirrorErr = null;
    try {
      var mir = {};
      PERSON_FIELDS.forEach(function (f) { if (patch[f] !== undefined) mir[f] = patch[f]; });
      mir.updated_at = patch.updated_at;
      var mres = await sb().from(TABLE).update(mir).eq('stakeholder_id', id).select('id');
      if (mres.error) mirrorErr = mres.error;
      else mirrored = (mres.data || []).length;
    } catch (e) { mirrorErr = e; }
    return { mirrored: mirrored, mirrorErr: mirrorErr };
  }

  // The full directory, for the picker. Cached for the session -- it is a master
  // list of a few hundred people, not project data that changes under you.
  async function loadDirAll(force) {
    if (dirAll && !force) return dirAll;
    try {
      dirAll = await PDb.selectAll(DIR, function (q) { return q.order('name'); });
    } catch (err) {
      if (dirMissing(err)) { dirOff = true; dirAll = []; return dirAll; }
      throw err;
    }
    return dirAll;
  }

  // ---- BD-map vocabulary, kept because live rows carry it -----------------
  // The corporate BD/TCD map this module was first built from classifies a
  // stakeholder by Sector and Group. The OPS register does not, but ~every
  // existing row has these filled in and they are genuinely useful (an LGU
  // contact and a consultant are not engaged the same way), so both vocabularies
  // are offered rather than one being thrown away.
  var SECTORS = ['Government', 'Private'];
  var GROUPS  = ['LGU', 'NGA', 'GOCC', 'National', 'Legislative', 'State University',
                 'Partners', 'Consultants', 'Client', 'External Stakeholders', 'Other'];

  // ---- Assessment scales (stakeholder register, 1–4) ----------------------
  // Table 1A / 1B of "Criteria for Assessment". ⚠️ The workbook fills in the
  // Impact descriptors and leaves the Influence ones BLANK — so the influence
  // wording below is the parallel phrasing, marked as such in the Criteria tab
  // rather than passed off as a transcription.
  var STK_IMPACT = [
    { rating: 1, label: 'No impact',     desc: 'The project can proceed without this party.' },
    { rating: 2, label: 'Low impact',    desc: 'Limited or indirect effect on delivery.' },
    { rating: 3, label: 'Medium impact', desc: 'Material effect on cost, time or quality.' },
    { rating: 4, label: 'High impact',   desc: 'Can stop or reshape the works.' }
  ];
  var STK_INFLUENCE = [
    { rating: 1, label: 'No influence',     desc: 'No say in decisions affecting the project.' },
    { rating: 2, label: 'Low influence',    desc: 'Consulted, rarely decisive.' },
    { rating: 3, label: 'Medium influence', desc: 'Shapes decisions within their remit.' },
    { rating: 4, label: 'High influence',   desc: 'Decides, approves or can veto.' }
  ];
  var REL_L = { 4: 'Good friend', 3: 'Acquaintance', 2: 'Formal only', 1: 'No relationship' };

  var ENGAGEMENT_FREQ = ['Daily Updates', 'Weekly Regular Updates', 'Fortnightly Updates',
                         'Monthly Regular Updates', 'Quarterly Updates', 'Ad hoc / on request'];

  function sb() { return AppAuth.getSB(); }
  function $(id) { return document.getElementById(id); }
  function E() { return window.MCCRCM; }

  // ===== live collaboration (presence + who's-editing row cursor) + offline =====
  var _collab = null, _remoteSel = {}, _collabSelf = {}, PKEY = 'stakeholder_map', PID_PFX = 'sm';
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
  async function applyRemoteChange(payload) {
    var evt = payload.eventType || payload.event, rec = payload['new'] || payload.record || null, old = payload['old'] || payload.old_record || null;
    if (evt === 'DELETE') { var did = old && old.id; if (did == null) return; rows = rows.filter(function (x) { return String(x.id) !== String(did); }); }
    else if (rec) {
      var j = -1; for (var i = 0; i < rows.length; i++) { if (String(rows[i].id) === String(rec.id)) { j = i; break; } }
      if (j < 0) rows.push(rec); else rows[j] = rec;
      // A face someone else just uploaded has no signed URL here yet.
      await signPaths([rec.photo_thumb_path, rec.photo_path].filter(function (p) { return p && !urlCache[p]; }));
    } else return;
    sortRows(); render();
  }
  function wireModalCursor(m, r) {
    if (!r || !r.id) return;
    var oc = m.close; m.close = function () { broadcastCollabSel(null); oc(); };
    broadcastCollabSel(r.id, true);
    m.el.addEventListener('click', function (e) { if (e.target === m.el) broadcastCollabSel(null); });
  }

  // ---- derivations (all pure, none stored) --------------------------------
  function n4(v) { var x = parseInt(v, 10); return (x >= 1 && x <= 4) ? x : null; }
  function impactOf(r)    { return n4(r.influence); }   // see the column-reuse note above
  function influenceOf(r) { return n4(r.interest); }
  function importanceOf(r) { var i = impactOf(r), f = influenceOf(r); return (i && f) ? i * f : null; }
  function priorityOf(r)  { return E().stkPriority(impactOf(r), influenceOf(r)); }
  // Stored value wins — it is an explicit override — else the workbook's lookup.
  function responseOf(r)  { return r.response_category || E().stkResponseCategory(priorityOf(r)); }
  function approachOf(r)  { return r.mgmt_approach || E().stkApproach(impactOf(r), influenceOf(r)); }
  function residualOf(r)  { return E().residualScore(r.res_impact, r.res_possibility, r.res_detectability); }

  // The BD map's second chain, kept: gap = target − current relationship.
  function gapOf(r) {
    var c = n4(r.current_rel), t = n4(r.target_rel);
    return (c == null || t == null) ? null : t - c;
  }
  function strategyOf(gap) {
    if (gap == null) return '';
    if (gap >= 2) return 'Catch up';
    if (gap === 1) return 'Enhance';
    if (gap === 0) return 'Maintain';
    return 'N/A';
  }
  // ⚠️ The BD workbook contradicts itself here: its Guide sheet says
  // Maintain=Semi-annually / Enhance=Quarterly, its LIVE cell formula (column S,
  // which the data actually reflects) says what is below. The live formula is the
  // source of truth; the Guide sheet is stale.
  function freqOf(s) { return { 'Catch up': 'Monthly', 'Enhance': 'Every two months', 'Maintain': 'Quarterly' }[s] || ''; }

  function approachClass(a) {
    return { 'Manage Closely': 'sm-a-manage', 'Keep Satisfied': 'sm-a-satisfy',
             'Keep Informed': 'sm-a-inform', 'Monitor (Minimum Effort)': 'sm-a-monitor' }[a] || '';
  }

  // ========================================================================
  async function init(user, prof) {
    profile = prof;
    _collabSelf = { id: (user && user.id) || (prof && prof.id), name: (prof && (prof.name || prof.email)) || 'Someone' };
    try { collapsed = JSON.parse(localStorage.getItem('sm_collapsed') || '{}') || {}; } catch (e) { collapsed = {}; }
    try { bands = Object.assign(bands, JSON.parse(localStorage.getItem('sm_bands') || '{}')); } catch (e) {}

    await loadProjects();
    renderCriteria();
    renderBandToggles();

    // ⚠️ The picker, not the blank form. See openAddPicker's own note: reusing an
    // existing person is the DEFAULT path now, and "Add a new person" is the
    // fallback inside it. openAddPicker falls through to openForm(null) by itself
    // when the directory migration has not been run yet.
    $('sm-add').onclick = function () { openAddPicker(); };
    $('sm-export').onclick = exportCsv;
    $('sm-project').onchange = function (e) {
      pid = e.target.value; sessionStorage.setItem('pd_project', pid); load(); joinCollab();
    };
    ['sm-f-activity', 'sm-f-category', 'sm-f-sub', 'sm-f-priority', 'sm-f-approach', 'sm-f-flag', 'sm-f-search']
      .forEach(function (id) {
        var el = $(id);
        el.oninput = el.onchange = function () {
          if (id === 'sm-f-category') { filters.sub = ''; fillSubFilter(); }
          readFilters(); render();
        };
      });
    $('sm-clear').onclick = function () {
      filters = { activity: '', category: '', sub: '', priority: '', approach: '', flag: '', search: '', cell: null };
      ['sm-f-activity', 'sm-f-category', 'sm-f-sub', 'sm-f-priority', 'sm-f-approach', 'sm-f-flag', 'sm-f-search']
        .forEach(function (id) { $(id).value = ''; });
      fillSubFilter(); render();
      if (filterToggle) filterToggle.sync(); // fields reset programmatically — no native change event
    };
    // The whole filter bar hides behind one funnel toggle instead of sitting
    // permanently open (see the "Filter bar" comment in module.css) — the dot
    // stays in sync with the panel's own controls automatically.
    filterToggle = UI.wireFilterToggle($('sm-filttoggle'), $('sm-filters'));
    document.querySelectorAll('.sm-tabs [data-view]').forEach(function (a) {
      a.onclick = function (e) { e.preventDefault(); switchView(a.dataset.view, a); histView.push(); };
    });

    // Browser-history integration — see UI.bindHistoryState in ui.js. Without
    // this, switching views never touches the URL, so the browser's native Back
    // button jumps straight past every view to the module launcher.
    histView = UI.bindHistoryState({
      key: 'sm_view',
      get: function () { return { view: curView }; },
      apply: function (s) { switchView(s.view, document.querySelector('.sm-tabs [data-view="' + s.view + '"]')); }
    });

    if (pid) load();
    joinCollab();
  }

  function readFilters() {
    filters.activity = $('sm-f-activity').value;
    filters.category = $('sm-f-category').value;
    filters.sub      = $('sm-f-sub').value;
    filters.priority = $('sm-f-priority').value;
    filters.approach = $('sm-f-approach').value;
    filters.flag     = $('sm-f-flag').value;
    filters.search   = $('sm-f-search').value.toLowerCase().trim();
  }

  async function loadProjects() {
    var projects = await PDb.getProjects();
    var sel = $('sm-project');
    pid = sessionStorage.getItem('pd_project') || (projects[0] && projects[0].id) || null;
    sel.innerHTML = '<option value="">Select project…</option>' +
      projects.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === pid ? ' selected' : '') + '>' + Fmt.esc(p.name) + '</option>';
      }).join('');
    UI.enhanceProjectSelect(sel);
    if (!projects.length) {
      $('sm-table').innerHTML = '<tr><td style="padding:24px;color:var(--pd-muted);">No projects yet. Ask an admin to create one.</td></tr>';
    }
    $('sm-f-activity').innerHTML = '<option value="">All activities</option>' +
      E().ACTIVITIES.map(function (a) { return '<option value="' + a.no + '">' + a.no + '. ' + Fmt.esc(a.name) + '</option>'; }).join('') +
      '<option value="0">— Unassigned —</option>';
    $('sm-f-category').innerHTML = '<option value="">All categories</option>' +
      E().CATEGORY_NAMES.map(function (c) { return '<option>' + Fmt.esc(c) + '</option>'; }).join('');
    $('sm-f-approach').innerHTML = '<option value="">All approaches</option>' +
      E().APPROACHES.map(function (a) { return '<option>' + Fmt.esc(a) + '</option>'; }).join('');
    fillSubFilter();
  }

  function fillSubFilter() {
    var subs = filters.category ? E().subNamesOf(filters.category) : [];
    var sel = $('sm-f-sub');
    sel.disabled = !subs.length;
    sel.innerHTML = '<option value="">' + (subs.length ? 'All sub-categories' : 'Sub-category') + '</option>' +
      subs.map(function (s) { return '<option' + (filters.sub === s ? ' selected' : '') + '>' + Fmt.esc(s) + '</option>'; }).join('');
  }

  async function load() {
    if (!pid) return;
    // ⚠️ Keyset-paginated (PDb.selectAll) — a plain .select() truncates at 1000 rows
    // server-side with no error. Shaped as {data}/{error} so the offline-cache and
    // migration-hint branches below are untouched.
    var res;
    try { res = { data: await PDb.selectAll(TABLE, function (q) { return q.eq('project_id', pid); }) }; }
    catch (err) { res = { error: err }; }
    if (res.error) {
      if (window.PDSync) { var c = await PDSync.cacheGet(PID_PFX + ':' + pid); if (c && c.rows) { rows = c.rows.slice(); render(); return; } }
      UI.toast(migrationHint(res.error), 'error'); return;
    }
    rows = res.data || [];

    // ⚠️ BEFORE sortRows() and BEFORE the cache write, both deliberately.
    //    sortRows() orders by `name`, which for a linked row is the DIRECTORY's
    //    name -- sorting first and overlaying after would order the register by
    //    whatever stale mirror the project row happened to hold. And the offline
    //    cache must hold what the user actually saw, so it is written from the
    //    overlaid rows, not the raw ones.
    await loadPeople();
    overlayPeople();

    sortRows();
    if (window.PDSync) PDSync.cachePut(PID_PFX + ':' + pid, rows);

    // ⚠️ Two renders on purpose. The first paints the register straight away with
    // initials avatars; signing 85 photo URLs is a network round trip and making
    // the whole view wait on it means an empty screen for as long as it takes.
    render();                          // paint immediately with initials avatars…
    await signAll();                   // …then swap in the faces when they arrive
    render();
  }

  function sortRows() {
    rows.sort(function (a, b) {
      var an = a.activity_no == null ? 9999 : a.activity_no, bn = b.activity_no == null ? 9999 : b.activity_no;
      if (an !== bn) return an - bn;
      var as = a.sort_order || 0, bs = b.sort_order || 0;
      if (as !== bs) return as - bs;
      var ap = E().priorityRank(priorityOf(a)), bp = E().priorityRank(priorityOf(b));
      if (ap !== bp) return ap - bp;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  function migrationHint(e) {
    return /column .* does not exist|schema cache/i.test((e && e.message) || '')
      ? 'Run migrations/2026-09-01-stakeholder-register-ops.sql first.' : (e && e.message) || 'Request failed';
  }

  // ---- photo URLs --------------------------------------------------------
  // ⚠️ Batched. 85 stakeholders is 85 signed-URL round trips one at a time;
  // createSignedUrls takes the whole list. Thumbnails first (that is what the
  // register and the cards actually render), full-size only for rows that
  // somehow have no thumbnail.
  async function signAll() {
    var want = [];
    rows.forEach(function (r) {
      var p = r.photo_thumb_path || r.photo_path;
      if (p && !urlCache[p]) want.push(p);
      if (r.photo_path && r.photo_path !== p && !urlCache[r.photo_path]) want.push(r.photo_path);
    });
    await signPaths(want);
  }
  async function signPaths(paths) {
    paths = (paths || []).filter(Boolean);
    if (!paths.length) return;
    try {
      var res = await sb().storage.from(BUCKET).createSignedUrls(paths, SIGN_TTL);
      (res && res.data ? res.data : []).forEach(function (d) {
        if (d && d.signedUrl && d.path) urlCache[d.path] = d.signedUrl;
      });
    } catch (e) {
      // Offline, or the bucket has not been created yet. The initials avatar is
      // a complete fallback, so this is a degraded look, never a broken view.
    }
  }
  function photoUrl(r) {
    var p = r.photo_thumb_path || r.photo_path;
    return p ? (urlCache[p] || '') : '';
  }
  function fullPhotoUrl(r) {
    return (r.photo_path && urlCache[r.photo_path]) || photoUrl(r);
  }
  // Deterministic initials avatar, so a row with no photo still reads as a
  // person and the register does not go ragged while the URLs are signing.
  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function avatarHue(name) {
    var h = 0, s = String(name || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }
  function avatarHTML(r, size) {
    var u = photoUrl(r), cls = 'sm-av sm-av-' + (size || 'sm');
    if (u) return '<span class="' + cls + '"><img src="' + Fmt.esc(u) + '" alt="' + Fmt.esc(r.name) + '" loading="lazy"></span>';
    return '<span class="' + cls + ' sm-av-i" style="--sm-hue:' + avatarHue(r.name) + ';">' + Fmt.esc(initials(r.name)) + '</span>';
  }

  // ---- filtering ---------------------------------------------------------
  function filtered() {
    return rows.filter(function (r) {
      if (filters.activity) {
        var want = +filters.activity, have = r.activity_no == null ? 0 : +r.activity_no;
        if (have !== want) return false;
      }
      if (filters.category && String(r.stk_category || '').replace(/\s+/g, '').toLowerCase() !== filters.category.replace(/\s+/g, '').toLowerCase()) return false;
      if (filters.sub && r.stk_sub_category !== filters.sub) return false;
      if (filters.priority && priorityOf(r) !== filters.priority) return false;
      if (filters.approach && approachOf(r) !== filters.approach) return false;
      if (filters.flag === 'nophoto' && r.photo_path) return false;
      if (filters.flag === 'noplan' && String(r.engagement_plan || '').trim()) return false;
      if (filters.flag === 'unrated' && impactOf(r) && influenceOf(r)) return false;
      if (filters.cell && (impactOf(r) !== filters.cell.i || influenceOf(r) !== filters.cell.f)) return false;
      if (filters.search) {
        var hay = [r.name, r.nickname, r.role_title, r.organization, r.title, r.activity, r.sub_process,
                   r.stk_category, r.stk_sub_category, r.category, r.stakeholder_group,
                   r.relationship_champion, r.relationship_owner, r.megawide_counterpart,
                   r.engagement_plan, r.response_description, r.email, r.contact,
                   r.primary_responsible, r.engagement].join(' ').toLowerCase();
        if (hay.indexOf(filters.search) === -1) return false;
      }
      return true;
    });
  }
  function anyFilter() {
    return !!(filters.activity || filters.category || filters.sub || filters.priority ||
              filters.approach || filters.flag || filters.search || filters.cell);
  }

  function render() {
    renderKpis();
    renderTable();
    renderCards();
    renderGrid();
    $('sm-clear').classList.toggle('show', anyFilter());
    paintRemote();
  }

  // ---- KPIs -------------------------------------------------------------
  function renderKpis() {
    var counts = {}; E().PRIORITIES.forEach(function (p) { counts[p] = 0; });
    var ap = {}; E().APPROACHES.forEach(function (a) { ap[a] = 0; });
    var catchup = 0;
    rows.forEach(function (r) {
      var p = priorityOf(r); if (p) counts[p]++;
      var a = approachOf(r); if (a && ap[a] != null) ap[a]++;
      if (strategyOf(gapOf(r)) === 'Catch up') catchup++;
    });
    /* ⚠️ FOUR CARDS, AND THE THREE THAT WENT ARE THE ONES THAT ANSWERED NOTHING.
       Owner, 2026-09-08: *"The kpi warnings in the stakeholder map isn't necessary let's
       remove the total number of stakeholders, no photo, and no engagement plan. Let's fit
       the other 4 kpi cards in a single level row."*
       — 'Stakeholders' restated the register's own row count, which the table header
         already prints;
       — 'No photo' and 'No engagement plan' are data-entry chores, not stakeholder
         standing. They read as warnings about the project when they are warnings about
         the form, and on a young register they are simply the row count again.
       What survives is the four that rank ATTENTION: who matters, how to handle them,
       and who is drifting.
       ⚠️ NEITHER SIGNAL IS LOST, which is what makes the removal safe rather than a
          trade: 'no photo' is still a filter (filters.flag === 'nophoto') and a missing
          plan still prints on the stakeholder's own card (.sm-card-plan-none). They stop
          competing for the eye at the top of the screen; they do not stop being visible.
       ⚠️ NO COLUMN COUNT IS DECLARED HERE, deliberately. The shared `.pd-kpis` is
          `repeat(auto-fit, minmax(170px, 1fr))`, and MEASURED against the shipped CSS the
          four cards are ONE row from 860px to 1850px — including 918px, which is the
          width the owner's own screenshot was taken at (7 cards → 2 rows there, cards
          209 CSS px). Below 760px they go to 2 rows, which is correct on a tablet. A
          hardcoded 4-column rule is exactly what UI.kpis' own comment records removing
          from five modules, because each copy's breakpoints left a ragged empty cell at
          some window width. */
    $('sm-kpis').innerHTML =
      kpi('1st Priority', counts['1st Priority'], 'rcm-p1', 'high impact × high influence') +
      kpi('Manage Closely', ap['Manage Closely'], 'sm-k-manage', 'per the Impact / Influence map') +
      kpi('Keep Satisfied', ap['Keep Satisfied'], 'sm-k-satisfy', 'high impact, low influence') +
      kpi('Catch-up needed', catchup, 'sm-k-warn', 'relationship 2+ levels below target');
  }
  // Adapter onto the SHARED metric card (UI.kpi). See the note in
  // risk-register/module.js -- the two registers had two hand-rolled copies of
  // the same card and they had already drifted (7 columns here, 6 there).
  function kpi(label, val, cls, sub) {
    return UI.kpi(label, val, { cls: cls || '', sub: sub });
  }

  // ---- band toggles -----------------------------------------------------
  // ⚠️ `label` is the FULL band name, printed by the table's own band header row
  // and used to title the Add/Edit modal's sections — the register's controlled
  // vocabulary. `short` is only the toggle caption in the module bar, which has
  // to hold this control plus the picker, the tabs dropdown, the funnel and two
  // buttons on ONE row. Same split, same reason, as risk-register/module.js.
  // ⚠️ SIX bands here, and that is why the split matters MORE in this module
  //    than in the Risk Register. Measured the same way (canvas measureText,
  //    resolved 700 11px Montserrat): six FULL names = 527px, six SHORT verbs =
  //    399px. Against a 996px content box at 1280px and ~610px of other controls,
  //    the full names overflow by ~140px — enough to squeeze the project picker
  //    down to an ellipsis. The verbs leave ~-13px, absorbed by the picker's own
  //    `flex: 0 1 auto` as a few characters of a long project name.
  //    The full name stays one hover away (title=), so nothing is hidden.
  var BANDS = [
    { key: 'id',  label: 'Identification', short: 'Identify' },
    { key: 'as',  label: 'Assessment',     short: 'Assess'   },
    { key: 'rs',  label: 'Response',       short: 'Respond'  },
    { key: 'en',  label: 'Engagement',     short: 'Engage'   },
    { key: 'res', label: 'Residual',       short: 'Residual' },
    { key: 'au',  label: 'Audit plan',     short: 'Audit'    }
  ];
  function renderBandToggles() {
    // `aria-pressed`, not `aria-checked` — six independent toggles, not one of six.
    $('sm-bands').innerHTML = BANDS.map(function (b) {
      var on = !!bands[b.key];
      return '<button type="button" class="' + (on ? 'on' : '') + '" data-band="' + b.key + '"' +
        ' aria-pressed="' + on + '"' +
        ' title="' + Fmt.esc(b.label) + ' columns — click to ' + (on ? 'hide' : 'show') + '">' +
        Fmt.esc(b.short) + '</button>';
    }).join('');
    $('sm-bands').querySelectorAll('[data-band]').forEach(function (btn) {
      btn.onclick = function () {
        bands[btn.dataset.band] = !bands[btn.dataset.band];
        try { localStorage.setItem('sm_bands', JSON.stringify(bands)); } catch (e) {}
        renderBandToggles(); renderTable(); paintRemote();
      };
    });
  }

  // ---- register table ---------------------------------------------------
  // ⚠️ An engagement plan is a sentence, and a <td> that simply wraps it makes
  // EVERY cell in that row as tall as the tallest text — measured at 191px per
  // row on a real fixture, i.e. three stakeholders per screen. Clamped to three
  // lines here (the full text is in the edit modal, the card and the CSV) so the
  // register stays scannable. Clamping needs a block child: applying
  // -webkit-line-clamp to the <td> itself would change its display and break the
  // table layout.
  function clamp(txt) {
    txt = (txt == null ? '' : String(txt)).trim();
    if (!txt) return '';
    return '<div class="sm-clamp" title="' + Fmt.esc(txt) + '">' + Fmt.esc(txt) + '</div>';
  }

  function columns() {
    return [
      { band: '_', label: 'Stakeholder', cls: 'sm-c-name', v: function (r) {
          return '<div class="sm-person">' + avatarHTML(r, 'sm') + '<div class="sm-person-t">' +
            '<strong>' + Fmt.esc(r.name) + '</strong>' +
            (r.nickname ? ' <span class="sm-nick">“' + Fmt.esc(r.nickname) + '”</span>' : '') +
            (r.role_title ? '<div class="sm-sub">' + Fmt.esc(r.role_title) + '</div>' : '') +
            '</div></div>';
        } },
      { band: 'id', label: 'Sub-process', v: function (r) { return Fmt.esc(r.sub_process); } },
      { band: 'id', label: 'Category', v: function (r) {
          if (!r.stk_category && !r.stk_sub_category) return '—';
          return '<span class="sm-cat">' + Fmt.esc(r.stk_category) + '</span>' +
            (r.stk_sub_category ? '<div class="sm-sub">' + Fmt.esc(r.stk_sub_category) + '</div>' : '');
        } },
      { band: 'id', label: 'Sector / group', v: function (r) {
          if (!r.category && !r.stakeholder_group) return '—';
          return Fmt.esc(r.category) + (r.stakeholder_group ? '<div class="sm-sub">' + Fmt.esc(r.stakeholder_group) + '</div>' : '');
        } },
      { band: 'id', label: 'Organisation', v: function (r) { return Fmt.esc(r.organization); } },
      { band: 'id', label: 'Champion', v: function (r) { return Fmt.esc(r.relationship_champion); } },
      { band: 'as', label: 'Imp', cls: 'sm-num', v: function (r) { return impactOf(r) || '—'; } },
      { band: 'as', label: 'Inf', cls: 'sm-num', v: function (r) { return influenceOf(r) || '—'; } },
      { band: 'as', label: 'Impce', cls: 'sm-num', v: function (r) { return importanceOf(r) || '—'; } },
      { band: 'as', label: 'Priority', v: function (r) {
          var p = priorityOf(r);
          return p ? '<span class="rcm-pill ' + E().priorityClass(p) + '">' + E().priorityShort(p) + '</span>' : '—';
        } },
      { band: 'rs', label: 'Response', v: function (r) {
          var x = responseOf(r);
          return x ? Fmt.esc(x) + (r.response_category ? ' <span class="sm-ovr" title="Manually overridden">±</span>' : '') : '—';
        } },
      { band: 'rs', label: 'Response description', cls: 'sm-c-wide', v: function (r) { return clamp(r.response_description); } },
      { band: 'rs', label: 'Relationship owner', v: function (r) { return Fmt.esc(r.relationship_owner || r.primary_responsible); } },
      { band: 'rs', label: 'Impact cost', cls: 'sm-num', v: function (r) { return r.impact_cost == null ? '—' : Fmt.moneyShort(r.impact_cost); } },
      { band: 'rs', label: 'Response cost', cls: 'sm-num', v: function (r) { return r.response_cost == null ? '—' : Fmt.moneyShort(r.response_cost); } },
      { band: 'en', label: 'Approach', v: function (r) {
          var a = approachOf(r);
          return a ? '<span class="sm-appr ' + approachClass(a) + '">' + Fmt.esc(a) + '</span>' +
            (r.mgmt_approach ? ' <span class="sm-ovr" title="Manually overridden">±</span>' : '') : '—';
        } },
      { band: 'en', label: 'Engagement plan', cls: 'sm-c-wide', v: function (r) { return clamp(r.engagement_plan); } },
      { band: 'en', label: 'Megawide counterpart', v: function (r) { return Fmt.esc(r.megawide_counterpart); } },
      { band: 'en', label: 'Rel (C→T)', cls: 'sm-num', v: function (r) {
          var c = n4(r.current_rel), t = n4(r.target_rel);
          if (c == null && t == null) return '—';
          return (c || '—') + ' → ' + (t || '—');
        } },
      { band: 'en', label: 'Strategy', v: function (r) {
          var s = strategyOf(gapOf(r));
          if (!s || s === 'N/A') return Fmt.esc(s || '—');
          return '<span class="sm-strat sm-s-' + s.replace(/\s/g, '') + '">' + Fmt.esc(s) + '</span>' +
            (freqOf(s) ? '<div class="sm-sub">' + freqOf(s) + '</div>' : '');
        } },
      { band: 'res', label: 'rI', cls: 'sm-num', v: function (r) { return r.res_impact || '—'; } },
      { band: 'res', label: 'rP', cls: 'sm-num', v: function (r) { return r.res_possibility || '—'; } },
      { band: 'res', label: 'rC', cls: 'sm-num', v: function (r) { return r.res_detectability || '—'; } },
      { band: 'res', label: 'Residual', v: function (r) {
          var s = residualOf(r); if (s == null) return '—';
          var b = E().residualBand(s);
          return '<span class="rcm-pill ' + b.cls + '">' + s + ' · ' + b.label + '</span>';
        } },
      { band: 'au', label: 'Audit procedures', cls: 'sm-c-wide', v: function (r) { return clamp(r.audit_procedures); } },
      { band: 'au', label: 'Required documents', cls: 'sm-c-wide', v: function (r) { return clamp(r.required_documents); } },
      { band: 'au', label: 'Point person', v: function (r) { return Fmt.esc(r.audit_contact); } },
      { band: 'au', label: 'Timing', v: function (r) { return Fmt.esc(r.audit_timing); } },
      { band: '_', label: 'Contact', v: function (r) {
          var bits = [];
          if (r.email) bits.push('<a href="mailto:' + Fmt.esc(r.email) + '">' + Fmt.esc(r.email) + '</a>');
          if (r.contact) bits.push(Fmt.esc(r.contact));
          return bits.length ? bits.join('<div class="sm-sub"></div>') : '—';
        } }
    ];
  }
  function visibleColumns() { return columns().filter(function (c) { return c.band === '_' || bands[c.band]; }); }

  function renderTable() {
    var t = $('sm-table');
    if (!rows.length) {
      t.innerHTML = '<tr><td style="padding:24px;color:var(--pd-muted);">No stakeholders yet for this project. Click “Add stakeholder”.</td></tr>';
      return;
    }
    var data = filtered();
    var cols = visibleColumns();

    var bandRow = '', run = null, span = 0;
    cols.forEach(function (c) {
      var name = c.band === '_' ? '' : (BANDS.filter(function (b) { return b.key === c.band; })[0] || {}).label;
      if (name === run) { span++; return; }
      if (span) bandRow += '<th class="sm-bandhead' + (run ? '' : ' sm-bandhead-x') + '" colspan="' + span + '">' + (run || '') + '</th>';
      run = name; span = 1;
    });
    if (span) bandRow += '<th class="sm-bandhead' + (run ? '' : ' sm-bandhead-x') + '" colspan="' + span + '">' + (run || '') + '</th>';
    bandRow += '<th class="sm-bandhead sm-bandhead-x"></th>';

    var head = '<thead><tr class="sm-bands-row">' + bandRow + '</tr><tr>' +
      cols.map(function (c) { return '<th>' + c.label + '</th>'; }).join('') + '<th></th></tr></thead>';

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
      var gp = {}; E().PRIORITIES.forEach(function (p) { gp[p] = 0; });
      g.rows.forEach(function (r) { var p = priorityOf(r); if (p) gp[p]++; });
      var hdr = '<tr class="sm-grow" data-group="' + g.no + '">' +
        '<td colspan="' + (cols.length + 1) + '">' +
          '<span class="sm-gcar' + (isCol ? ' col' : '') + '">▾</span>' +
          '<span class="sm-gno">' + (g.no || '—') + '</span>' +
          '<span class="sm-gname">' + Fmt.esc(name) + '</span>' +
          '<span class="sm-gcount">' + g.rows.length + ' stakeholder' + (g.rows.length === 1 ? '' : 's') + '</span>' +
          E().PRIORITIES.filter(function (p) { return gp[p]; }).map(function (p) {
            return '<span class="rcm-pill-o ' + E().priorityClass(p) + '">' + gp[p] + ' × ' + E().priorityShort(p) + '</span>';
          }).join('') +
          (act ? '<div class="sm-gobj">' + Fmt.esc(act.objective) + '</div>' : '') +
        '</td></tr>';
      if (isCol) return hdr;
      return hdr + g.rows.map(function (r) {
        return '<tr data-id="' + r.id + '">' + cols.map(function (c) {
          // data-l = the column heading; below 900px module.css hides the head and
          // stacks each row into a card where every value needs its own label.
          return '<td' + (c.cls ? ' class="' + c.cls + '"' : '') + ' data-l="' + c.label + '">' + c.v(r) + '</td>';
        }).join('') +
        '<td class="sm-rowacts"><button class="pd-btn" data-edit="' + r.id + '">Edit</button> ' +
        '<button class="pd-btn" data-del="' + r.id + '">Delete</button></td></tr>';
      }).join('');
    }).join('');

    t.innerHTML = head + '<tbody>' + (body ||
      '<tr><td colspan="' + (cols.length + 1) + '" style="padding:24px;color:var(--pd-muted);">No stakeholders match the current filters.</td></tr>') + '</tbody>';

    wireRowActions(t);
    t.querySelectorAll('.sm-grow').forEach(function (tr) {
      tr.onclick = function (e) {
        if (e.target.closest('button')) return;
        var no = tr.dataset.group;
        if (collapsed[no]) delete collapsed[no]; else collapsed[no] = true;
        try { localStorage.setItem('sm_collapsed', JSON.stringify(collapsed)); } catch (err) {}
        renderTable(); paintRemote();
      };
    });
  }
  function wireRowActions(scope) {
    scope.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); openForm(rows.filter(function (x) { return x.id === b.dataset.edit; })[0]); };
    });
    scope.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); del(b.dataset.del); };
    });
  }

  // ---- Cards view -------------------------------------------------------
  // The faces. Grouped by engagement approach, because that is the question a
  // card answers ("who am I managing closely, and what did we agree to do for
  // them?") — a register row answers "how is this person scored".
  function renderCards() {
    var data = filtered();
    var wrap = $('sm-cards');
    if (!rows.length) {
      wrap.innerHTML = '<div class="pd-card" style="color:var(--pd-muted);">No stakeholders yet for this project. Click “Add stakeholder”.</div>';
      return;
    }
    if (!data.length) {
      wrap.innerHTML = '<div class="pd-card" style="color:var(--pd-muted);">No stakeholders match the current filters.</div>';
      return;
    }
    var order = E().APPROACHES.concat(['']);
    var byAp = {};
    data.forEach(function (r) { var a = approachOf(r) || ''; (byAp[a] = byAp[a] || []).push(r); });

    wrap.innerHTML = order.filter(function (a) { return byAp[a]; }).map(function (a) {
      return '<div class="sm-cgroup">' +
        '<div class="sm-chead"><span class="sm-appr ' + approachClass(a) + '">' + Fmt.esc(a || 'Not yet assessed') + '</span>' +
        '<span class="sm-gcount">' + byAp[a].length + '</span></div>' +
        '<div class="sm-cgrid">' + byAp[a].map(cardHTML).join('') + '</div></div>';
    }).join('');
    wireRowActions(wrap);
    // Clicking the face opens the full-size photo; clicking anywhere else on the
    // card edits, which is what people reach for.
    wrap.querySelectorAll('[data-zoom]').forEach(function (el) {
      el.onclick = function (e) {
        e.stopPropagation();
        var r = rows.filter(function (x) { return x.id === el.dataset.zoom; })[0];
        if (r) openPhoto(r);
      };
    });
    wrap.querySelectorAll('.sm-card').forEach(function (el) {
      el.onclick = function (e) {
        if (e.target.closest('button') || e.target.closest('a') || e.target.closest('[data-zoom]')) return;
        openForm(rows.filter(function (x) { return x.id === el.dataset.id; })[0]);
      };
    });
  }
  function cardHTML(r) {
    var p = priorityOf(r), act = r.activity_no ? E().activityByNo(r.activity_no) : null;
    var s = strategyOf(gapOf(r));
    return '<div class="sm-card" data-id="' + r.id + '">' +
      '<div class="sm-card-top">' +
        '<span data-zoom="' + r.id + '" class="sm-card-av' + (r.photo_path ? ' zoomable' : '') + '" title="' +
          (r.photo_path ? 'View photo' : 'No photo yet') + '">' + avatarHTML(r, 'lg') + '</span>' +
        '<div class="sm-card-id">' +
          '<div class="sm-card-name">' + Fmt.esc(r.name) + (r.nickname ? ' <span class="sm-nick">“' + Fmt.esc(r.nickname) + '”</span>' : '') + '</div>' +
          (r.role_title ? '<div class="sm-card-role">' + Fmt.esc(r.role_title) + '</div>' : '') +
          (r.organization ? '<div class="sm-card-org">' + Fmt.esc(r.organization) + '</div>' : '') +
        '</div>' +
        (p ? '<span class="rcm-pill ' + E().priorityClass(p) + '">' + E().priorityShort(p) + '</span>' : '') +
      '</div>' +
      '<div class="sm-card-meters">' +
        meter('Impact', impactOf(r)) + meter('Influence', influenceOf(r)) +
      '</div>' +
      (act ? '<div class="sm-card-act"><span class="sm-gno">' + act.no + '</span>' + Fmt.esc(act.name) + '</div>' : '') +
      (r.engagement_plan ? '<div class="sm-card-plan">' + Fmt.esc(r.engagement_plan) + '</div>'
                         : '<div class="sm-card-plan sm-card-plan-none">No engagement plan yet</div>') +
      '<div class="sm-card-foot">' +
        (r.megawide_counterpart ? '<span class="sm-card-cp" title="Megawide counterpart">' + Fmt.esc(r.megawide_counterpart) + '</span>' : '') +
        (s && s !== 'N/A' ? '<span class="sm-strat sm-s-' + s.replace(/\s/g, '') + '">' + Fmt.esc(s) + '</span>' : '') +
        (r.email ? '<a class="sm-card-mail" href="mailto:' + Fmt.esc(r.email) + '" title="' + Fmt.esc(r.email) + '">email</a>' : '') +
        '<button class="pd-btn sm-card-edit" data-edit="' + r.id + '">Edit</button>' +
      '</div></div>';
  }
  function meter(label, v) {
    var bars = '';
    for (var i = 1; i <= 4; i++) bars += '<i class="' + (v && i <= v ? 'on' : '') + '"></i>';
    return '<span class="sm-meter"><span class="sm-meter-l">' + label + '</span>' +
      '<span class="sm-meter-b">' + bars + '</span><span class="sm-meter-v">' + (v || '—') + '</span></span>';
  }
  function openPhoto(r) {
    var u = fullPhotoUrl(r);
    if (!u) { UI.toast('No photo on this stakeholder yet', 'warn'); return; }
    var m = UI.modal('<div class="sm-photoview"><img src="' + Fmt.esc(u) + '" alt="' + Fmt.esc(r.name) + '">' +
      '<div class="sm-photoview-cap"><strong>' + Fmt.esc(r.name) + '</strong>' +
      (r.role_title ? '<div>' + Fmt.esc(r.role_title) + '</div>' : '') +
      (r.organization ? '<div class="rcm-muted">' + Fmt.esc(r.organization) + '</div>' : '') + '</div>' +
      '<div style="text-align:right;margin-top:10px;"><button class="pd-btn" id="pv-close">Close</button></div></div>');
    m.el.querySelector('#pv-close').onclick = m.close;
  }

  // ---- Impact / Influence view -----------------------------------------
  function renderGrid() {
    var e = E();
    var buckets = {};
    rows.forEach(function (r) {
      var i = impactOf(r), f = influenceOf(r);
      if (i && f) (buckets[i + '|' + f] = buckets[i + '|' + f] || []).push(r);
    });

    // Grid 1 — the register's own PRIORITY lookup (x = influence, y = impact).
    $('sm-grid-priority').innerHTML = e.gridHTML({
      xMax: 4, yMax: 4, xLabel: 'Influence →', yLabel: 'Impact →',
      cls: function (x, y) {
        var p = e.STK_GRID[x][y];   // STK_GRID[influence][impact]
        var active = filters.cell && filters.cell.i === y && filters.cell.f === x;
        return e.priorityClass(p) + (active ? ' rcm-cell-active' : '');
      },
      title: function (x, y) { return 'Impact ' + y + ' × Influence ' + x + ' = ' + (x * y) + ' · ' + e.STK_GRID[x][y]; },
      cell: function (x, y) {
        var list = buckets[y + '|' + x] || [];
        var chips = list.slice(0, 3).map(function (r) {
          return '<span class="rcm-gchip" title="' + Fmt.esc(r.name) + '">' + Fmt.esc(r.name) + '</span>';
        }).join('');
        if (list.length > 3) chips += '<span class="rcm-gchip">+' + (list.length - 3) + '</span>';
        return '<span class="rcm-gcell-lab">' + e.priorityShort(e.STK_GRID[x][y]) + '</span>' +
          (list.length ? '<span class="rcm-gcell-count">' + list.length + '</span><span class="rcm-gchips">' + chips + '</span>'
                       : '<span class="rcm-gcell-empty">·</span>');
      }
    });
    $('sm-grid-priority').querySelectorAll('.rcm-gcell').forEach(function (cell) {
      cell.onclick = function () {
        var f = +cell.dataset.x, i = +cell.dataset.y;
        if (filters.cell && filters.cell.i === i && filters.cell.f === f) filters.cell = null;
        else filters.cell = { i: i, f: f };
        switchView('list', document.querySelector('.sm-tabs [data-view="list"]'));
        render();
        if (histView) histView.push();
      };
    });
    var counts = {}; e.PRIORITIES.forEach(function (p) { counts[p] = 0; });
    rows.forEach(function (r) { var p = priorityOf(r); if (p) counts[p]++; });
    $('sm-grid-legend').innerHTML = e.priorityLegendHTML(counts);

    // Grid 2 — the Mendelow map that sets the ENGAGEMENT APPROACH. Deliberately
    // shown beside grid 1: the sheet computes two different answers from the same
    // two ratings and carries both as separate columns.
    var apCounts = {}; e.APPROACHES.forEach(function (a) { apCounts[a] = 0; });
    rows.forEach(function (r) { var a = approachOf(r); if (a && apCounts[a] != null) apCounts[a]++; });
    $('sm-grid-mendelow').innerHTML = e.gridHTML({
      xMax: 4, yMax: 4, xLabel: 'Influence →', yLabel: 'Impact →',
      cls: function (x, y) { return 'sm-gm ' + approachClass(e.MENDELOW[y][x]); },
      title: function (x, y) { return 'Impact ' + y + ' × Influence ' + x + ' · ' + e.MENDELOW[y][x]; },
      cell: function (x, y) {
        var list = (buckets[y + '|' + x] || []);
        return '<span class="sm-gm-lab">' + Fmt.esc(e.MENDELOW[y][x].replace(' (Minimum Effort)', '')) + '</span>' +
          (list.length ? '<span class="sm-gm-faces">' + list.slice(0, 6).map(function (r) { return avatarHTML(r, 'xs'); }).join('') +
            (list.length > 6 ? '<span class="rcm-gchip">+' + (list.length - 6) + '</span>' : '') + '</span>' : '');
      }
    });
    $('sm-grid-mendelow-legend').innerHTML = '<div class="rcm-legend">' + e.APPROACHES.map(function (a) {
      return '<span class="rcm-leg"><span class="sm-leg-sw ' + approachClass(a) + '"></span>' + Fmt.esc(a) + ' <b>' + apCounts[a] + '</b></span>';
    }).join('') + '</div>';
  }

  // ---- Criteria view (static reference) ---------------------------------
  function renderCriteria() {
    var e = E();
    function scaleTable(cap, scale, note) {
      return e.tbl(cap, ['Rating', 'Qualitative', 'Description'],
        scale.map(function (x) { return ['<strong>' + x.rating + '</strong>', Fmt.esc(x.label), Fmt.esc(x.desc)]; }), note);
    }
    $('sm-criteria').innerHTML =
      '<div class="pd-card"><h2>Stakeholder assessment criteria</h2>' +
      '<p class="sm-help">Transcribed from “Criteria for Assessment” in <em>CSF101. OPS. Stakeholder Register</em>. Both axes are 1–4 — narrower than the risk register\'s 1–5, and deliberately so: a stakeholder is placed, not measured.</p>' +
      scaleTable('Table 1A — Impact rating', STK_IMPACT, null) +
      scaleTable('Table 1B — Influence rating', STK_INFLUENCE,
        '⚠️ The controlled document numbers the influence scale 1–4 but leaves its descriptors blank. The wording above is the parallel phrasing of the impact scale, supplied here so two planners score the same way — it is not a transcription.') +
      '</div>' +

      '<div class="pd-card"><h2>Priority level and response category</h2>' +
      '<p class="sm-help">Priority Level is a lookup of Impact × Influence into the 4×4 grid below (the range the register\'s own <code>INDEX/MATCH</code> formula reads). Response Category is then a lookup of the priority.</p>' +
      '<div class="sm-refgrid">' + e.gridHTML({
        xMax: 4, yMax: 4, xLabel: 'Influence →', yLabel: 'Impact →',
        cls: function (x, y) { return e.priorityClass(e.STK_GRID[x][y]); },
        title: function (x, y) { return 'Impact ' + y + ' × Influence ' + x; },
        cell: function (x, y) { return '<span class="rcm-gcell-lab">' + e.priorityShort(e.STK_GRID[x][y]) + '</span>'; }
      }) + '</div>' +
      e.tbl('Priority → Response category', ['Priority', 'Response category'],
        e.PRIORITIES.map(function (p) {
          return ['<span class="rcm-pill ' + e.priorityClass(p) + '">' + p + '</span>', Fmt.esc(e.stkResponseCategory(p))];
        })) +
      '</div>' +

      '<div class="pd-card"><h2>Impact / Influence map — the engagement approach</h2>' +
      '<p class="sm-help">Table 2 of the criteria sheet, and the classic Mendelow grid. ' +
      '<strong>⚠️ It disagrees with the Response Category lookup on some cells, and the workbook keeps both.</strong> ' +
      'Impact 3 × Influence 3 is 2nd Priority → <em>Keep Informed</em> by the lookup, and <em>Keep Satisfied</em> by this map. They are two different columns of the register (Q and AF), computed two different ways; this module shows both rather than inventing a single answer the source does not give. The Approach field can be overridden per stakeholder when a planner\'s judgement differs.</p>' +
      '<div class="sm-refgrid">' + e.gridHTML({
        xMax: 4, yMax: 4, xLabel: 'Influence →', yLabel: 'Impact →',
        cls: function (x, y) { return 'sm-gm ' + approachClass(e.MENDELOW[y][x]); },
        title: function (x, y) { return 'Impact ' + y + ' × Influence ' + x; },
        cell: function (x, y) { return '<span class="sm-gm-lab">' + Fmt.esc(e.MENDELOW[y][x].replace(' (Minimum Effort)', '')) + '</span>'; }
      }) + '</div>' +
      '</div>' +

      '<div class="pd-card"><h2>Residual risk assessment</h2>' +
      '<p class="sm-help">A stakeholder is also a risk source, so the register re-scores them after the engagement response is in place: <strong>severity × occurrence × degree of control</strong> (1–125).</p>' +
      e.controlTableHTML() + e.residualBandTableHTML() + '</div>' +

      '<div class="pd-card"><h2>Relationship strategy (BD map)</h2>' +
      '<p class="sm-help">Carried over from the corporate <em>BD / TCD Stakeholder Map</em>, which the OPS register does not replace: rate the relationship you have and the one you need, and the gap sets a strategy and a minimum contact frequency.</p>' +
      e.tbl('Relationship rating', ['Rating', 'Meaning'],
        [4, 3, 2, 1].map(function (k) { return ['<strong>' + k + '</strong>', REL_L[k]]; })) +
      e.tbl('Gap → strategy → minimum frequency', ['Gap (target − current)', 'Strategy', 'Minimum frequency'],
        [['2 – 3', 'Catch up', 'Monthly'], ['1', 'Enhance', 'Every two months'],
         ['0', 'Maintain', 'Quarterly'], ['negative', 'N/A — target already met', '—']],
        '⚠️ The BD workbook contradicts itself: its Guide sheet says Maintain = semi-annually and Enhance = quarterly, while the live cell formula — which the data actually follows — says the above. The live formula governs.') +
      '</div>' +

      '<div class="pd-card"><h2>MCC Stakeholder Universe</h2>' +
      '<p class="sm-help">The same 10-term taxonomy the Risk Register uses, so a stakeholder and the risks they create can be read against each other.</p>' +
      e.universeTableHTML() + '</div>';
  }

  var VIEWS = ['list', 'cards', 'grid', 'criteria'];

  function switchView(view, link) {
    // ⚠️ Normalise first. Every view this module has ever shipped is still in
    // VIEWS, so no bookmark is stale today — but an unrecognised value hides
    // all four panes and renders a blank page with no error, which is a silent
    // failure a future rename would reintroduce. Fall back to the register.
    if (VIEWS.indexOf(view) === -1) view = 'list';
    if (!link) link = document.querySelector('.sm-tabs [data-view="' + view + '"]');
    curView = view;
    VIEWS.forEach(function (v) {
      var el = $('sm-view-' + v); if (el) el.style.display = view === v ? '' : 'none';
    });
    // Filters apply to the register AND the cards (both are lists of people);
    // the band toggles are columns, so they belong to the register alone.
    $('sm-filters').style.display = (view === 'list' || view === 'cards') ? '' : 'none';
    // ⚠️ Hide the seg's own trailing separator WITH it. The bands moved into the
    // module bar's tool cluster (2026-09-08), where every group is fenced by a
    // 1px `.sm-tb-sep`; hiding only the control left its fence behind, so the
    // three non-Register views showed two dividers with nothing between them.
    (function () {
      var el = $('sm-bands'), show = view === 'list';
      el.style.display = show ? '' : 'none';
      var sep = el.nextElementSibling;
      if (sep && sep.classList.contains('sm-tb-sep')) sep.style.display = show ? '' : 'none';
    }());
    if ($('sm-filttoggle')) $('sm-filttoggle').style.display = (view === 'list' || view === 'cards') ? '' : 'none';
    if (link) {
      document.querySelectorAll('.sm-tabs [data-view]').forEach(function (a) { a.classList.remove('active'); });
      link.classList.add('active');
    }
  }

  // ========================================================================
  // Photo handling
  // ========================================================================
  // Two objects per stakeholder: the display image (downscaled — a 6 MB phone
  // capture is pointless for a 320px card) and a real thumbnail.
  var MAIN_MAXW = 1024, MAIN_Q = 0.85, THUMB_MAXW = 240, THUMB_Q = 0.72;

  function fileToImage(file) {
    return new Promise(function (resolve, reject) {
      var u = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(u); resolve(img); };
      img.onerror = function (e) { URL.revokeObjectURL(u); reject(e); };
      img.src = u;
    });
  }
  function canvasToBlob(c, type, q) {
    return new Promise(function (resolve, reject) {
      if (!c.toBlob) return reject(new Error('toBlob unsupported'));
      c.toBlob(function (b) { b ? resolve(b) : reject(new Error('toBlob returned null')); }, type, q);
    });
  }
  async function downscale(file, maxw, q) {
    var img = await fileToImage(file);
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var scale = Math.min(1, maxw / w);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return canvasToBlob(c, 'image/jpeg', q);
  }
  // ⚠️ Returns {photo_path, photo_thumb_path} and throws only if the MAIN upload
  // fails. A missing thumbnail is a slower card, not a lost face — photoUrl()
  // already falls back to the full image — so a thumbnail failure (an exotic
  // format, toBlob missing in an embedded webview) degrades to null.
  async function uploadPhoto(file) {
    var stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    var main;
    try { main = await downscale(file, MAIN_MAXW, MAIN_Q); }
    catch (e) { main = file; }              // not a JPEG-able image? store as-is
    var ext = (main === file ? (file.name.split('.').pop() || 'jpg').replace(/[^\w]/g, '') : 'jpg').toLowerCase();
    var path = pid + '/' + stamp + '.' + ext;
    var up = await sb().storage.from(BUCKET).upload(path, main, {
      upsert: false, contentType: main.type || 'image/jpeg'
    });
    if (up.error) throw up.error;

    var thumbPath = null;
    try {
      var tb = await downscale(file, THUMB_MAXW, THUMB_Q);
      var tp = path + '.thumb.jpg';
      var t = await sb().storage.from(BUCKET).upload(tp, tb, { upsert: false, contentType: 'image/jpeg' });
      if (!t.error) thumbPath = tp;
    } catch (e) {}
    return { photo_path: path, photo_thumb_path: thumbPath };
  }
  // Best-effort. A leftover object costs storage; a failed delete must never
  // block a save the user already completed.
  async function removeObjects(paths) {
    paths = (paths || []).filter(Boolean);
    if (!paths.length) return;
    try { await sb().storage.from(BUCKET).remove(paths); } catch (e) {}
    paths.forEach(function (p) { delete urlCache[p]; });
  }

  // ========================================================================
  // EDIT PERSON -- the one door into the GLOBAL half of a stakeholder
  // ------------------------------------------------------------------------
  // ⚠️ A SEPARATE DIALOG, not an unlock button on band 1, and that is the whole
  //    design. Owner ask, 2026-09-08: "we should just consider if the updating of
  //    the stakeholder will have a global-level and project-level information."
  //    A single form where some fields quietly write to three other projects and
  //    the rest do not is the version of this feature that loses data: a planner
  //    fixes a typo in a role while assessing project B and changes what projects
  //    A and C print, with nothing on screen having said so. So the global fields
  //    live behind their own dialog whose title, banner and Save button all name
  //    the blast radius.
  //
  // ⚠️ It re-reads the person from the server before showing the form. The cached
  //    copy could be minutes old and another planner may have corrected the same
  //    record; editing a stale copy and saving it would silently revert them.
  async function openPersonForm(personId, onSaved) {
    var m0 = UI.modal('<div class="pd-modal-header"><h2>Loading person…</h2></div>' +
                      '<div class="pd-modal-body"><div class="sm-ap-load">Fetching the shared record…</div></div>');
    var cur = null;
    try {
      var res = await sb().from(DIR).select('*').eq('id', personId).limit(1);
      if (res.error) throw res.error;
      cur = (res.data || [])[0];
      if (!cur) throw new Error('That person is no longer in the directory.');
    } catch (err) {
      m0.close();
      UI.toast((err && err.message) || 'Could not load the person', 'error');
      return;
    }
    m0.close();

    // How many projects this change will reach. Counted, never guessed -- the
    // sentence on screen is a claim about the user's data and has to be true.
    var projCount = 1;
    try {
      var u = await sb().from(TABLE).select('project_id').eq('stakeholder_id', personId);
      var seen = {};
      (u.data || []).forEach(function (x) { seen[x.project_id] = 1; });
      projCount = Object.keys(seen).length || 1;
    } catch (e) { /* fall back to the honest minimum of 1 */ }

    function optsOf(list, val) {
      return '<option value="">—</option>' + list.map(function (o) {
        return '<option' + (val === o ? ' selected' : '') + '>' + Fmt.esc(o) + '</option>';
      }).join('');
    }

    var m = UI.modal(
      '<div class="pd-modal-header">' +
        '<h2>Edit person</h2>' +
        '<button type="button" class="pd-modal-close" id="ep-x" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="pd-modal-body">' +
        '<div class="sm-scope" data-scope="warn">' +
          '<span class="sm-scope-ic" data-ico="users" data-ico-size="15"></span>' +
          '<span class="sm-scope-tx">These are the person\'s own details. Saving changes them on ' +
            '<strong>' + (projCount === 1 ? 'this project' : 'all ' + projCount + ' projects') +
            '</strong> where they are registered. This project\'s assessment, response, ' +
            'engagement plan and owner are not affected.</span>' +
        '</div>' +
        '<div class="sm-frow">' +
          '<div class="pd-field" style="flex:2;"><label>Name of stakeholder</label><input class="pd-input" id="ep-name" value="' + Fmt.esc(cur.name) + '"></div>' +
          '<div class="pd-field" style="flex:1;"><label>Nickname</label><input class="pd-input" id="ep-nick" value="' + Fmt.esc(cur.nickname) + '"></div>' +
          '<div class="pd-field" style="flex:0 0 110px;"><label>Honorific</label><input class="pd-input" id="ep-title" value="' + Fmt.esc(cur.title) + '" placeholder="Engr. / Ar."></div>' +
        '</div>' +
        '<div class="sm-frow">' +
          '<div class="pd-field" style="flex:2;"><label>Role</label><input class="pd-input" id="ep-role" value="' + Fmt.esc(cur.role_title) + '"></div>' +
          '<div class="pd-field" style="flex:2;"><label>Organisation</label><input class="pd-input" id="ep-org" list="dl-orgs" value="' + Fmt.esc(cur.organization) + '"></div>' +
        '</div>' +
        '<div class="sm-frow">' +
          '<div class="pd-field" style="flex:1;"><label>Sector</label><select class="pd-select" id="ep-sector">' + optsOf(SECTORS, cur.category) + '</select></div>' +
          '<div class="pd-field" style="flex:1;"><label>Group</label><select class="pd-select" id="ep-group">' + optsOf(GROUPS, cur.stakeholder_group) +
            (cur.stakeholder_group && GROUPS.indexOf(cur.stakeholder_group) === -1 ? '<option selected>' + Fmt.esc(cur.stakeholder_group) + '</option>' : '') + '</select></div>' +
        '</div>' +
        '<div class="sm-frow">' +
          '<div class="pd-field" style="flex:1;"><label>Email</label><input class="pd-input" type="email" id="ep-email" value="' + Fmt.esc(cur.email) + '"></div>' +
          '<div class="pd-field" style="flex:1;"><label>Contact no.</label><input class="pd-input" id="ep-contact" value="' + Fmt.esc(cur.contact) + '"></div>' +
          '<div class="pd-field" style="flex:0 0 160px;"><label>Birthday</label><input class="pd-input" type="date" id="ep-bday" value="' + (cur.birthday || '') + '"></div>' +
          '<div class="pd-field" style="flex:0 0 120px;"><label>Gift tier</label><input class="pd-input" id="ep-gift" value="' + Fmt.esc(cur.gift_tier) + '"></div>' +
        '</div>' +
        '<div class="pd-field"><label>Notes about this person</label>' +
          '<textarea class="pd-textarea" id="ep-notes" rows="2" placeholder="Anything true of them wherever they appear — not this project\'s engagement plan.">' + Fmt.esc(cur.notes) + '</textarea></div>' +
      '</div>' +
      '<div class="pd-modal-footer">' +
        '<button class="pd-btn" id="ep-cancel">Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="ep-save">Save for all projects</button>' +
      '</div>');

    function q(sel) { return m.el.querySelector(sel); }
    q('#ep-x').onclick = m.close;
    q('#ep-cancel').onclick = m.close;

    q('#ep-save').onclick = async function () {
      var btn = q('#ep-save');
      var fields = {
        name: q('#ep-name').value.trim(),
        nickname: q('#ep-nick').value.trim(),
        title: q('#ep-title').value.trim(),
        role_title: q('#ep-role').value.trim(),
        organization: q('#ep-org').value.trim(),
        category: q('#ep-sector').value,
        stakeholder_group: q('#ep-group').value,
        email: q('#ep-email').value.trim(),
        contact: q('#ep-contact').value.trim(),
        birthday: q('#ep-bday').value || null,
        gift_tier: q('#ep-gift').value.trim(),
      };
      if (!fields.name) { UI.toast('Name is required', 'warn'); return; }
      try {
        btn.disabled = true; btn.textContent = 'Saving…';
        // `notes` is not in PERSON_FIELDS (it has no mirror column on
        // stakeholder_map), so it is patched alongside rather than through it.
        await updatePerson(personId, fields);
        var nres = await sb().from(DIR).update({ notes: q('#ep-notes').value.trim() || null }).eq('id', personId);
        if (nres.error) throw nres.error;
        UI.toast(projCount === 1 ? 'Person updated' : 'Person updated on ' + projCount + ' projects', 'ok');
        m.close();
        // ⚠️ A full reload, not a local patch. The person's fields are mirrored
        //    onto every project row, and the rows this project holds have to be
        //    re-overlaid AND re-sorted (the register sorts by name). load() is the
        //    one path that does all of that in the right order.
        if (typeof onSaved === 'function') onSaved();
        dirAll = null;
        load();
      } catch (err) {
        UI.toast((err && err.message) || 'Save failed', 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Save for all projects';
      }
    };

    // ⚠️ `hydrate`, not `paint`. icons.js exports { svg, hydrate, names } and
    //    hydrates on DOMContentLoaded only — markup injected into a modal AFTER
    //    that point keeps its bare `data-ico` span and renders NOTHING, silently.
    //    It also skips anything already carrying data-ico-done, so calling it on a
    //    subtree is cheap and idempotent.
    if (window.Icons) Icons.hydrate(m.el);
  }

  // ========================================================================
  // ADD -- pick an existing person first, type a new one only if they are new
  // ------------------------------------------------------------------------
  // ⚠️ THIS IS THE POINT OF THE WHOLE DIRECTORY FEATURE, so it is the DEFAULT
  //    path and not an option tucked inside the form. "+ Add stakeholder" used to
  //    open a blank 6-band form; registering a City Mayor already on three other
  //    projects meant re-typing twelve identity fields and re-uploading a
  //    photograph that already existed in the bucket. Now it opens this: a search
  //    over the directory, with "Add a new person" as the fallback for someone
  //    genuinely new.
  //
  // ⚠️ Choosing a person does NOT create the row and close. It opens the normal
  //    Add form with the identity band pre-filled AND LOCKED TO THE DIRECTORY,
  //    because the project-level bands -- which activity, what impact, whose
  //    relationship -- still have to be filled in and are the only reason a
  //    project row exists. Creating the row on click would leave an unassessed
  //    stakeholder on the register with no impact, no influence and no owner,
  //    which is worse than not adding them.
  async function openAddPicker() {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }

    // If the migration has not been run there is no directory to pick from, so
    // this step would be a dead dialog -- go straight to the blank form.
    if (dirOff) { openForm(null); return; }

    var m = UI.modal(
      '<div class="pd-modal-header">' +
        '<h2>Add stakeholder</h2>' +
        '<button type="button" class="pd-modal-close" id="ap-x" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="pd-modal-body">' +
        '<p class="sm-help" style="margin:0 0 10px;">Search the stakeholder directory. Picking someone reuses their name, role, organisation and photo &mdash; you only fill in this project\'s assessment.</p>' +
        '<input class="pd-input" id="ap-q" placeholder="Search by name, role or organisation…" autocomplete="off">' +
        '<div class="sm-ap-list" id="ap-list"><div class="sm-ap-load">Loading directory…</div></div>' +
      '</div>' +
      '<div class="pd-modal-footer">' +
        '<button class="pd-btn" id="ap-cancel">Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="ap-new">Add a new person</button>' +
      '</div>');

    function q(sel) { return m.el.querySelector(sel); }
    q('#ap-x').onclick = m.close;
    q('#ap-cancel').onclick = m.close;
    q('#ap-new').onclick = function () { m.close(); openForm(null); };

    var all = [];
    try { all = await loadDirAll(); }
    catch (err) { q('#ap-list').innerHTML = '<div class="sm-ap-load">Directory unavailable: ' + Fmt.esc((err && err.message) || 'request failed') + '</div>'; return; }
    if (dirOff) { m.close(); openForm(null); return; }

    // Who is ALREADY on this project, so they can be shown and disabled rather
    // than silently missing from the list -- "why can't I find him" is worse than
    // "he is already here".
    var here = {};
    rows.forEach(function (row) { if (row.stakeholder_id) here[row.stakeholder_id] = 1; });

    // Cross-project usage for every person in the directory, so the list can say
    // "on 3 projects". One query, not one per person.
    var usage = {};
    try {
      var u = await sb().from(TABLE).select('stakeholder_id,project_id').not('stakeholder_id', 'is', null);
      (u.data || []).forEach(function (x) {
        var a = usage[x.stakeholder_id] || (usage[x.stakeholder_id] = []);
        if (a.indexOf(x.project_id) === -1) a.push(x.project_id);
      });
    } catch (e) { /* the count is a nicety; the picker still works without it */ }

    function paint() {
      var term = q('#ap-q').value.trim().toLowerCase();
      var hits = !term ? all : all.filter(function (x) {
        return [x.name, x.role_title, x.organization, x.nickname, x.stakeholder_group]
          .some(function (v) { return String(v || '').toLowerCase().indexOf(term) !== -1; });
      });
      if (!all.length) {
        q('#ap-list').innerHTML = '<div class="sm-ap-load">The directory is empty. Add the first person with <strong>Add a new person</strong> &mdash; everyone you add from now on is reusable on every project.</div>';
        return;
      }
      if (!hits.length) {
        q('#ap-list').innerHTML = '<div class="sm-ap-load">Nobody in the directory matches &ldquo;' + Fmt.esc(term) + '&rdquo;. Use <strong>Add a new person</strong>.</div>';
        return;
      }
      // ⚠️ Capped, and it says so. The list is a picker, not a browser -- rendering
      //    a few hundred rows with an avatar each on every keystroke is what makes
      //    a search box feel broken.
      var shown = hits.slice(0, 60);
      q('#ap-list').innerHTML = shown.map(function (x) {
        var on = (usage[x.id] || []).length;
        var mine = !!here[x.id];
        var sub = [x.role_title, x.organization].filter(Boolean).join(' · ');
        return '<button type="button" class="sm-ap-row' + (mine ? ' is-here' : '') + '" data-id="' + x.id + '"' +
            (mine ? ' disabled title="Already on this project"' : '') + '>' +
            avatarHTML(x, 'sm') +
            '<span class="sm-ap-txt"><strong>' + Fmt.esc(x.name) + '</strong>' +
              (sub ? '<small>' + Fmt.esc(sub) + '</small>' : '') + '</span>' +
            '<span class="sm-ap-tag">' + (mine ? 'on this project'
               : on ? 'on ' + on + ' project' + (on === 1 ? '' : 's') : 'not yet used') + '</span>' +
          '</button>';
      }).join('') +
      (hits.length > shown.length
        ? '<div class="sm-ap-load">' + (hits.length - shown.length) + ' more match — keep typing to narrow it down.</div>' : '');

      q('#ap-list').querySelectorAll('[data-id]').forEach(function (b) {
        b.onclick = function () {
          var person = all.filter(function (x) { return x.id === b.dataset.id; })[0];
          if (!person) return;
          m.close();
          openForm(null, { person: person });
        };
      });
    }

    // ⚠️ Sign the shown faces, then repaint ONCE. A face is the reason photos
    //    exist in this module at all ("walking into a meeting with a client's
    //    operations head you have never met"), so a picker of initials would
    //    throw away the feature at the moment it is most useful. Signing is one
    //    batched round trip for at most 60 paths, fired AFTER the list is already
    //    on screen -- the same two-pass shape load() uses, for the same reason.
    //    Guarded against the modal having been closed in the meantime.
    var signing = false;
    async function paintAndSign() {
      paint();
      if (signing || !m.el.isConnected) return;
      var need = [];
      m.el.querySelectorAll('[data-id]').forEach(function (b) {
        var x = all.filter(function (y) { return y.id === b.dataset.id; })[0];
        var path = x && (x.photo_thumb_path || x.photo_path);
        if (path && !urlCache[path]) need.push(path);
      });
      if (!need.length) return;
      signing = true;
      await signPaths(need);
      signing = false;
      if (m.el.isConnected) paint();
    }

    if (window.Icons) Icons.hydrate(m.el);
    q('#ap-q').oninput = paintAndSign;
    paintAndSign();
    q('#ap-q').focus();
  }

  // ========================================================================
  // Add / Edit
  // ========================================================================
  function openForm(r, fopts) {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    var isNew = !r; r = r || {};
    var e = E();
    fopts = fopts || {};

    // ---- which PERSON is this row about? ----------------------------------
    // Three cases, and they are genuinely different:
    //   picked   -- openAddPicker chose an existing directory entry. `person` is
    //               set, so the identity band is that person's, read-only.
    //   linked   -- an existing project row that points at a directory entry.
    //               Same treatment: identity is shared, edited via "Edit person".
    //   legacy   -- a row from before the migration (or one whose person was
    //               deleted). `person` is null, the identity fields are the row's
    //               own, and saving CREATES the directory entry and links it, so
    //               the register cleans itself up as people touch it.
    var person = fopts.person || personOf(r) || null;
    var shared = !!person;
    // ⚠️ Read the identity fields off the PERSON where there is one. `r` is the
    //    mirror and can be stale; this is the same precedence overlayPeople()
    //    applies, and the form must not disagree with the table behind it.
    var ident = shared ? person : r;
    var onProjects = shared ? ((dirUsage[person.id] || fopts.onProjects || []).length || 1) : 0;

    // Photo state for this modal. ⚠️ The file is held in memory and uploaded on
    // SAVE, not on pick: uploading on pick means every abandoned modal leaves an
    // orphan object in the bucket that nothing points at and nobody will find.
    var pendingFile = null, previewUrl = null, removeExisting = false;

    function opts(list, val, blank) {
      return (blank ? '<option value="">—</option>' : '') +
        list.map(function (o) { return '<option' + (val === o ? ' selected' : '') + '>' + Fmt.esc(o) + '</option>'; }).join('');
    }
    function rate(val, scale) {
      var s = '<option value="">—</option>';
      for (var i = scale.length - 1; i >= 0; i--) {
        var x = scale[i];
        s += '<option value="' + x.rating + '"' + (+val === x.rating ? ' selected' : '') + '>' + x.rating + ' — ' + x.label + '</option>';
      }
      return s;
    }
    // ⚠️ Band 1's inputs are DISABLED, not hidden, when the person is shared.
    //    Hiding them would leave a planner unable to see the name of the person
    //    they are assessing; disabling shows the facts and says "not here".
    //    `disabled` (not `readonly`) on purpose: a readonly input still looks and
    //    tabs like an editable one, and this app's own `.pd-input:focus` ring
    //    would then fire on a field that cannot be typed into.
    //    ⚠️ It also means these fields are NOT in the save payload's person half
    //    when shared -- see the save handler, which reads them only for the
    //    unlinked/new case. A disabled input's .value still reads fine, so the
    //    guard there is on `shared`, not on the DOM.
    var dis = shared ? ' disabled' : '';

    function relSel(val) {
      var s = '<option value="">—</option>';
      for (var k = 4; k >= 1; k--) s += '<option value="' + k + '"' + (n4(val) === k ? ' selected' : '') + '>' + k + ' — ' + REL_L[k] + '</option>';
      return s;
    }
    function dl(id, list) {
      return '<datalist id="' + id + '">' + list.map(function (o) { return '<option value="' + Fmt.esc(o) + '">'; }).join('') + '</datalist>';
    }
    var people = uniqueSorted(
      rows.map(function (x) { return x.relationship_champion; }),
      rows.map(function (x) { return x.relationship_owner; }),
      rows.map(function (x) { return x.megawide_counterpart; }),
      rows.map(function (x) { return x.primary_responsible; }));
    var orgs = uniqueSorted(rows.map(function (x) { return x.organization; }));

    var actOpts = '<option value="">— not assigned —</option>' + e.ACTIVITIES.map(function (a) {
      return '<option value="' + a.no + '"' + (+r.activity_no === a.no ? ' selected' : '') + '>' + a.no + '. ' + Fmt.esc(a.name) + '</option>';
    }).join('');

    var m = UI.modal(
      // ⚠️ HEADER / BODY / FOOTER, not a raw dump into `.pd-modal`.
      // `.pd-modal` is itself the scroller (max-height:90vh; overflow-y:auto), so
      // the previous shape -- a bare <h2>, then ~40 fields across six RCM bands,
      // then a right-aligned <div> of buttons at the very bottom of that same
      // scrolling column -- took BOTH the title and the Save button off screen the
      // moment the form was scrolled. dashboard.css has carried a written warning
      // about exactly this since 2026-07-02, and it had already been fixed
      // one-module-at-a-time for `#ps-modal` (2026-08-24) and `.boq-imp`
      // (2026-08-26). This is the same fix, in the last two modules still on the
      // old shape. `.pd-modal-body` bounds the scroll to the fields, so the title
      // and Save stay put by construction rather than by a sticky offset.
      // ⚠️ The button ids are unchanged (#f-cancel / #f-save) -- the wiring below
      // finds them through m.el, so moving them into the footer rewires nothing.
      '<div class="pd-modal-header">' +
        '<h2>' + (isNew ? 'Add stakeholder' : 'Edit stakeholder') + '</h2>' +
        '<button type="button" class="pd-modal-close" id="f-x" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="pd-modal-body">' +

            // ⚠️ BAND 1 IS THE ONLY BAND THAT IS NOT ABOUT THIS PROJECT, and the form
      //    now says so instead of leaving a planner to discover it. Owner ask,
      //    2026-09-08: "we should just consider if the updating of the
      //    stakeholder will have a global-level and project-level information."
      //    Everything from band 2 down is this project's assessment of the
      //    person; band 1 IS the person. Editing a shared identity from inside
      //    one project's form and silently changing it on three others is the
      //    trap this banner exists to close -- so where the person is shared, the
      //    fields are DISABLED here and there is one explicit door into them.
      '<div class="sm-fsec">1 · Identity &amp; photo' +
        '<span class="sm-fsec-hint">' + (shared ? 'shared — the same person on every project' : 'this person') + '</span></div>' +
      (shared
        ? '<div class="sm-scope" data-scope="global">' +
            '<span class="sm-scope-ic" data-ico="users" data-ico-size="15"></span>' +
            '<span class="sm-scope-tx"><strong>' + Fmt.esc(ident.name) + '</strong> comes from the shared stakeholder directory' +
              (onProjects > 1 ? ' and is registered on <strong>' + onProjects + ' projects</strong>' : '') +
              '. Their name, role, organisation, contact details and photo are the same everywhere.</span>' +
            '<button type="button" class="pd-btn pd-btn-sm sm-scope-btn" id="f-editperson">Edit person…</button>' +
          '</div>'
        : '<div class="sm-scope" data-scope="new">' +
            '<span class="sm-scope-ic" data-ico="users" data-ico-size="15"></span>' +
            '<span class="sm-scope-tx">' + (isNew
              ? 'Saving adds this person to the <strong>shared directory</strong>, so the next project can reuse them without re-typing any of this.'
              : 'This row predates the shared directory. Saving adds this person to it and links them, so a correction here reaches every project from then on.') +
            '</span>' +
          '</div>') +
'<div class="sm-fsec">1 · Identity &amp; photo</div>' +
      '<div class="sm-idrow">' +
        // The photo well IS the drop target and the file picker — a separate
        // "Choose file" button beside a preview is two controls for one job.
        // ⚠️ The PHOTO is a person fact too, so a shared row's well is inert
        //    (`.is-locked` blocks the pointer and the keyboard, and wire() skips
        //    its handlers). A photo picker that opens, uploads, and then has its
        //    result discarded by the save split would be the worst of the three
        //    possible behaviours.
        '<div class="sm-photowell' + (shared ? ' is-locked' : '') + '" id="f-well"' +
          (shared ? '' : ' tabindex="0" role="button"') + ' aria-label="Add or replace photo">' +
          '<div class="sm-photowell-img" id="f-prev"></div>' +
          '<div class="sm-photowell-hint" id="f-well-hint">Add photo</div>' +
          '<input type="file" id="f-file" accept="image/*" hidden>' +
        '</div>' +
        '<div class="sm-idfields">' +
          '<div class="sm-frow">' +
            '<div class="pd-field" style="flex:2;"><label>Name of stakeholder</label><input class="pd-input" id="f-name" value="' + Fmt.esc(ident.name) + '"' + dis + '></div>' +
            '<div class="pd-field" style="flex:1;"><label>Nickname</label><input class="pd-input" id="f-nick" value="' + Fmt.esc(ident.nickname) + '"' + dis + '></div>' +
            '<div class="pd-field" style="flex:0 0 110px;"><label>Honorific</label><input class="pd-input" id="f-title" value="' + Fmt.esc(ident.title) + '" placeholder="Engr. / Ar."' + dis + '></div>' +
          '</div>' +
          '<div class="sm-frow">' +
            '<div class="pd-field" style="flex:2;"><label>Role</label><input class="pd-input" id="f-role" value="' + Fmt.esc(ident.role_title) + '" placeholder="e.g. C2W — Operations Head"' + dis + '></div>' +
            '<div class="pd-field" style="flex:2;"><label>Organisation</label><input class="pd-input" id="f-org" list="dl-orgs" value="' + Fmt.esc(ident.organization) + '"' + dis + '></div>' +
          '</div>' +
          '<div class="sm-frow">' +
            '<div class="pd-field" style="flex:1;"><label>Sector</label><select class="pd-select" id="f-sector"' + dis + '>' + opts(SECTORS, ident.category, true) + '</select></div>' +
            '<div class="pd-field" style="flex:1;"><label>Group</label><select class="pd-select" id="f-group"' + dis + '>' + opts(GROUPS, ident.stakeholder_group, true) +
              (ident.stakeholder_group && GROUPS.indexOf(ident.stakeholder_group) === -1 ? '<option selected>' + Fmt.esc(ident.stakeholder_group) + '</option>' : '') + '</select></div>' +
            '<div class="pd-field" style="flex:1;"><label>Relationship champion</label><input class="pd-input" id="f-champ" list="dl-people" value="' + Fmt.esc(r.relationship_champion) + '"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Email</label><input class="pd-input" type="email" id="f-email" value="' + Fmt.esc(ident.email) + '"' + dis + '></div>' +
        '<div class="pd-field" style="flex:1;"><label>Contact no.</label><input class="pd-input" id="f-contact" value="' + Fmt.esc(ident.contact) + '"' + dis + '></div>' +
        '<div class="pd-field" style="flex:0 0 160px;"><label>Birthday</label><input class="pd-input" type="date" id="f-bday" value="' + (ident.birthday || '') + '"' + dis + '></div>' +
        '<div class="pd-field" style="flex:0 0 120px;"><label>Gift tier</label><input class="pd-input" id="f-gift" value="' + Fmt.esc(ident.gift_tier) + '"' + dis + '></div>' +
      '</div>' +

      '<div class="sm-fsec">2 · Register placement</div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:2;"><label>Activity / business process (5-PMLC)</label><select class="pd-select" id="f-act">' + actOpts + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Sub-process</label><input class="pd-input" id="f-sub" list="dl-subproc" value="' + Fmt.esc(r.sub_process) + '"></div>' +
      '</div>' +
      '<div class="sm-actinfo" id="f-actinfo"></div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Stakeholder category</label><select class="pd-select" id="f-cat">' + opts(e.CATEGORY_NAMES, r.stk_category, true) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Stakeholder sub-category</label><select class="pd-select" id="f-subcat"></select></div>' +
      '</div>' +

      '<div class="sm-fsec">3 · Assessment <span class="sm-fsec-hint">impact × influence</span></div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Impact (1–4)</label><select class="pd-select" id="f-impact">' + rate(r.influence, STK_IMPACT) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Influence (1–4)</label><select class="pd-select" id="f-infl">' + rate(r.interest, STK_INFLUENCE) + '</select></div>' +
      '</div>' +
      '<div class="rcm-derived" id="f-out-as"></div>' +

      '<div class="sm-fsec">4 · Response</div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Response category <span class="sm-lbl-hint">(blank = derived)</span></label>' +
          '<select class="pd-select" id="f-resp">' + opts(e.APPROACHES, r.response_category, true) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Relationship owner</label><input class="pd-input" id="f-relowner" list="dl-people" value="' + Fmt.esc(r.relationship_owner) + '"></div>' +
      '</div>' +
      '<div class="pd-field"><label>Response description</label><textarea class="pd-textarea" id="f-respdesc" rows="2">' + Fmt.esc(r.response_description) + '</textarea></div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Impact cost (PHP)</label><input class="pd-input" type="number" step="0.01" id="f-icost" value="' + (r.impact_cost == null ? '' : r.impact_cost) + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Response cost (PHP)</label><input class="pd-input" type="number" step="0.01" id="f-rcost" value="' + (r.response_cost == null ? '' : r.response_cost) + '"></div>' +
      '</div>' +

      '<div class="sm-fsec">5 · Engagement</div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Management approach <span class="sm-lbl-hint">(blank = from the Impact / Influence map)</span></label>' +
          '<select class="pd-select" id="f-appr">' + opts(e.APPROACHES, r.mgmt_approach, true) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Megawide counterpart</label><input class="pd-input" id="f-cp" list="dl-people" value="' + Fmt.esc(r.megawide_counterpart) + '"></div>' +
      '</div>' +
      '<div class="pd-field"><label>Engagement plan</label>' +
        '<textarea class="pd-textarea" id="f-plan" rows="3" placeholder="what we send them, how often, and who sends it">' + Fmt.esc(r.engagement_plan) + '</textarea>' +
        '<div class="sm-suggest" id="f-plan-sug"><span class="sm-sug-lab">Cadence:</span>' +
          ENGAGEMENT_FREQ.map(function (f, i) { return '<button type="button" class="sm-sug" data-freq="' + i + '">' + f + '</button>'; }).join('') +
        '</div></div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Current relationship (1–4)</label><select class="pd-select" id="f-cur">' + relSel(r.current_rel) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Target relationship (1–4)</label><select class="pd-select" id="f-tgt">' + relSel(r.target_rel) + '</select></div>' +
      '</div>' +
      '<div class="rcm-derived" id="f-out-rel"></div>' +

      '<div class="sm-fsec">6 · Residual risk assessment</div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Severity (1–5)</label><select class="pd-select" id="f-ri">' + rate5(r.res_impact, e.IMPACT) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Occurrence (1–5)</label><select class="pd-select" id="f-rp">' + rate5(r.res_possibility, e.PROBABILITY) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Degree of control (1–5)</label><select class="pd-select" id="f-rd">' + rate5(r.res_detectability, e.CONTROL) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Residual response cost</label><input class="pd-input" type="number" step="0.01" id="f-rrcost" value="' + (r.res_response_cost == null ? '' : r.res_response_cost) + '"></div>' +
      '</div>' +
      '<div class="rcm-derived" id="f-out-res"></div>' +

      '<div class="sm-fsec">7 · Audit plan</div>' +
      '<div class="pd-field"><label>Audit procedures</label><textarea class="pd-textarea" id="f-audp" rows="2">' + Fmt.esc(r.audit_procedures) + '</textarea></div>' +
      '<div class="pd-field"><label>Required documents</label><textarea class="pd-textarea" id="f-audd" rows="2">' + Fmt.esc(r.required_documents) + '</textarea></div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Contact / point person</label><input class="pd-input" id="f-audc" list="dl-people" value="' + Fmt.esc(r.audit_contact) + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Timing</label><input class="pd-input" id="f-audt" value="' + Fmt.esc(r.audit_timing) + '"></div>' +
      '</div>' +

      '<div class="sm-fsec">8 · Ownership &amp; notes <span class="sm-fsec-hint">BD map</span></div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Primary responsible</label><input class="pd-input" id="f-prim" list="dl-people" value="' + Fmt.esc(r.primary_responsible) + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Alternate</label><input class="pd-input" id="f-alt" list="dl-people" value="' + Fmt.esc(r.alternate) + '"></div>' +
      '</div>' +
      '<div class="pd-field"><label>Notes</label><textarea class="pd-textarea" id="f-eng" rows="2">' + Fmt.esc(r.engagement) + '</textarea></div>' +

      dl('dl-people', people) + dl('dl-orgs', orgs) + '<datalist id="dl-subproc"></datalist>' +
      '</div>' +
      '<div class="pd-modal-footer">' +
        '<button class="pd-btn" id="f-cancel">Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="f-save">Save</button>' +
      '</div>'
    );

    function q(sel) { return m.el.querySelector(sel); }

    // -- photo well ---------------------------------------------------------
    function paintPhoto() {
      var prev = q('#f-prev'), hint = q('#f-well-hint');
      // ⚠️ `ident`, not `r`. For a person just chosen in the Add picker `r` is
      //    `{}` -- the project row does not exist yet -- so reading the row would
      //    show an initials placeholder for someone whose photograph is already
      //    in the bucket, which is precisely the re-upload this feature exists to
      //    avoid. `ident` is the person where there is one and the row otherwise.
      var url = previewUrl || (!removeExisting ? fullPhotoUrl(ident) : '');
      if (url) {
        prev.innerHTML = '<img src="' + Fmt.esc(url) + '" alt="">' +
          '<button type="button" class="sm-photo-x" id="f-photo-x" title="Remove photo">×</button>';
        hint.textContent = pendingFile ? 'New photo — saves with the row' : 'Replace photo';
        q('#f-photo-x').onclick = function (ev) {
          ev.stopPropagation();
          if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
          pendingFile = null;
          // Only flags the EXISTING object for deletion if there was one; the
          // actual delete happens after a successful save.
          removeExisting = !!(r.photo_path);
          paintPhoto();
          q('#f-name').dispatchEvent(new Event('input', { bubbles: true }));   // let Autosave notice
        };
      } else {
        prev.innerHTML = '<span class="sm-photowell-ph">' +
          Fmt.esc(initials(q('#f-name') ? q('#f-name').value : ident.name)) + '</span>';
        hint.textContent = 'Add photo';
      }
    }
    function takeFile(f) {
      if (!f) return;
      if (!/^image\//.test(f.type || '')) { UI.toast('That is not an image file', 'warn'); return; }
      // 12 MB is already generous — the file is downscaled before upload, but a
      // 60 MB RAW would hang the canvas step on a phone before it ever got there.
      if (f.size > 12 * 1024 * 1024) { UI.toast('Photo is over 12 MB — please pick a smaller one', 'warn'); return; }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      pendingFile = f; removeExisting = false;
      previewUrl = URL.createObjectURL(f);
      paintPhoto();
      q('#f-name').dispatchEvent(new Event('input', { bubbles: true }));
    }
    var well = q('#f-well');
    // ⚠️ The photo is a PERSON fact, so on a shared row none of this is wired at
    //    all. `.is-locked`'s `pointer-events:none` would already swallow the
    //    click, but relying on a CSS property to enforce a data rule is how a
    //    later "let's make the well clickable again" change quietly re-opens the
    //    hole: pick a file, upload it on save, and watch the save split discard
    //    the path. The handlers simply do not exist here.
    if (!shared) {
      well.onclick = function (ev) { if (!ev.target.closest('.sm-photo-x')) q('#f-file').click(); };
      well.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); q('#f-file').click(); } };
      q('#f-file').onchange = function () { takeFile(this.files && this.files[0]); this.value = ''; };
      ['dragenter', 'dragover'].forEach(function (t) {
        well.addEventListener(t, function (ev) { ev.preventDefault(); well.classList.add('drop'); });
      });
      ['dragleave', 'drop'].forEach(function (t) {
        well.addEventListener(t, function (ev) { ev.preventDefault(); well.classList.remove('drop'); });
      });
      well.addEventListener('drop', function (ev) {
        var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
        takeFile(f);
      });
      // A blank well shows the initials, so it has to follow the name as it is typed.
      q('#f-name').addEventListener('input', function () { if (!previewUrl && (removeExisting || !r.photo_path)) paintPhoto(); });
    }
    paintPhoto();

    // A person picked from the directory may have a photo whose URL this session
    // has never signed (they were on another project). Sign it and repaint --
    // one batched round trip, after the form is already on screen.
    if (shared && (ident.photo_path || ident.photo_thumb_path) && !fullPhotoUrl(ident)) {
      signPaths([ident.photo_path, ident.photo_thumb_path]).then(function () {
        if (m.el.isConnected) paintPhoto();
      });
    }

    // -- activity → objective/description + sub-process suggestions ---------
    function paintActivity() {
      var no = +q('#f-act').value;
      var a = no ? e.activityByNo(no) : null;
      q('#f-actinfo').innerHTML = a
        ? '<div class="sm-actinfo-t">Process objective</div><div>' + Fmt.esc(a.objective) + '</div>'
        : '<span class="rcm-muted">Registering a stakeholder against a business process is what makes the register auditable — it says <em>where</em> they matter, not just that they do.</span>';
      q('#dl-subproc').innerHTML = (a ? a.subs : []).map(function (s) { return '<option value="' + Fmt.esc(s) + '">'; }).join('');
      if (a && a.subs.length === 1 && !q('#f-sub').value.trim()) q('#f-sub').value = a.subs[0];
    }
    q('#f-act').onchange = paintActivity; paintActivity();

    // -- category → sub-category cascade (local, so Cancel changes nothing) --
    var curSub = r.stk_sub_category || '';
    function paintSubcat() {
      var subs = e.subNamesOf(q('#f-cat').value);
      q('#f-subcat').disabled = !subs.length;
      q('#f-subcat').innerHTML = '<option value="">' + (subs.length ? '—' : 'no sub-categories') + '</option>' +
        subs.map(function (s) { return '<option' + (curSub === s ? ' selected' : '') + '>' + Fmt.esc(s) + '</option>'; }).join('') +
        (curSub && subs.indexOf(curSub) === -1 ? '<option selected>' + Fmt.esc(curSub) + '</option>' : '');
    }
    q('#f-cat').onchange = function () { curSub = ''; paintSubcat(); }; paintSubcat();

    // -- engagement cadence chips ------------------------------------------
    q('#f-plan-sug').querySelectorAll('[data-freq]').forEach(function (btn) {
      btn.onclick = function () {
        var ta = q('#f-plan'), add = ENGAGEMENT_FREQ[+btn.dataset.freq];
        ta.value = ta.value.trim() ? add + ' — ' + ta.value.trim() : add + ' — ';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.focus();
      };
    });

    // -- live derivations ---------------------------------------------------
    function paintOut() {
      var i = +q('#f-impact').value || 0, f = +q('#f-infl').value || 0;
      var pri = e.stkPriority(i, f);
      var derivedResp = e.stkResponseCategory(pri), derivedAppr = e.stkApproach(i, f);
      q('#f-out-as').innerHTML = pri
        ? '<span class="rcm-d-k">Importance</span><span class="rcm-d-v">' + (i * f) + '</span>' +
          '<span class="rcm-d-k">Priority level</span><span class="rcm-d-v"><span class="rcm-pill ' + e.priorityClass(pri) + '">' + pri + '</span></span>' +
          '<span class="rcm-d-k">Response (derived)</span><span class="rcm-d-v">' + Fmt.esc(derivedResp) + '</span>' +
          '<span class="rcm-d-k">Approach (derived)</span><span class="rcm-d-v">' + Fmt.esc(derivedAppr) + '</span>' +
          (derivedResp !== derivedAppr ? '<span class="rcm-muted">⚠️ the workbook\'s two lookups disagree on this cell — both are shown, see Criteria</span>' : '')
        : '<span class="rcm-muted">Set Impact and Influence to derive the priority level, response category and engagement approach.</span>';
      // Show the placeholder the blank override will fall back to.
      var rs = q('#f-resp'), ap = q('#f-appr');
      rs.options[0].text = derivedResp ? 'derived — ' + derivedResp : '—';
      ap.options[0].text = derivedAppr ? 'derived — ' + derivedAppr : '—';

      var gap = (n4(q('#f-cur').value) == null || n4(q('#f-tgt').value) == null)
        ? null : n4(q('#f-tgt').value) - n4(q('#f-cur').value);
      var st = strategyOf(gap);
      q('#f-out-rel').innerHTML = gap == null
        ? '<span class="rcm-muted">Set both relationship ratings to derive the engagement strategy and minimum frequency.</span>'
        : '<span class="rcm-d-k">Gap</span><span class="rcm-d-v">' + gap + '</span>' +
          '<span class="rcm-d-k">Strategy</span><span class="rcm-d-v">' + Fmt.esc(st) + '</span>' +
          (freqOf(st) ? '<span class="rcm-d-k">Min. frequency</span><span class="rcm-d-v">' + freqOf(st) + '</span>' : '');

      var s = e.residualScore(q('#f-ri').value, q('#f-rp').value, q('#f-rd').value);
      var b = e.residualBand(s);
      q('#f-out-res').innerHTML = s != null
        ? '<span class="rcm-d-k">Residual score</span><span class="rcm-d-v">' + s + ' / 125</span>' +
          '<span class="rcm-d-k">Band</span><span class="rcm-d-v"><span class="rcm-pill ' + b.cls + '">' + b.label + '</span></span>' +
          '<span class="rcm-muted">' + Fmt.esc(b.action) + '</span>'
        : '<span class="rcm-muted">Set all three to derive the residual band.</span>';
    }
    ['#f-impact', '#f-infl', '#f-cur', '#f-tgt', '#f-ri', '#f-rp', '#f-rd'].forEach(function (s) { q(s).onchange = paintOut; });
    paintOut();

    wireModalCursor(m, isNew ? null : r);
    var _origClose = m.close;
    m.close = function () { if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; } _origClose(); };
    q('#f-cancel').onclick = m.close;
    // The header's own X (added with the header/body/footer restructure) --
    // every other dialog in the app that has a `.pd-modal-header` has one, and
    // a modal whose only way out is a Cancel button at the bottom of a long
    // scroll is the same defect in a different place.
    q('#f-x').onclick = m.close;

    // Band 1's one door into the global fields. Closes this form first: the
    // person dialog reloads the register on save, so leaving a stale project
    // form open behind it would show pre-edit identity values over post-edit
    // data -- and its own Save would then write that stale mirror back.
    // The band-1 scope banner carries a `data-ico` span, injected after
    // DOMContentLoaded — hydrate this modal's subtree or it renders empty.
    if (window.Icons) Icons.hydrate(m.el);

    var epBtn = q('#f-editperson');
    if (epBtn) {
      epBtn.onclick = function () {
        var id = person.id;
        m.close();
        openPersonForm(id);
      };
    }

    q('#f-save').onclick = async function () {
      var btn = q('#f-save');
      var no = +q('#f-act').value || null;
      var act = no ? e.activityByNo(no) : null;
      // ---- the identity half -------------------------------------------
      // ⚠️ Read from the PERSON where the row is shared, and from the (then
      //    editable) band-1 inputs where it is not. The inputs are `disabled` in
      //    the shared case, so reading them would work and would be WRONG in a
      //    quiet way: a disabled input reports its rendered value, so the payload
      //    would look correct while silently re-asserting a snapshot of the
      //    directory taken when the modal opened -- and would therefore overwrite
      //    any change another user made to that person in the meantime. The guard
      //    is `shared`, not the DOM.
      var ident2 = shared ? {
        name:      person.name,
        nickname:  person.nickname,
        title:     person.title,
        role_title: person.role_title,
        organization: person.organization,
        category:          person.category,
        stakeholder_group: person.stakeholder_group,
        email:    person.email,
        contact:  person.contact,
        birthday: person.birthday || null,
        gift_tier: person.gift_tier,
        // ⚠️ THE PHOTO PATHS TOO. Without these a person picked from the
        //    directory saves a project row with a null photo_path, so the register
        //    and the Cards view show initials for someone whose photograph is
        //    already in the bucket -- self-healing on the next load() via
        //    overlayPeople(), which makes it a flicker rather than a bug and
        //    therefore harder to notice and fix. The path is COPIED, not the
        //    object: the bucket's policies are not project-scoped, so a path
        //    minted under another project is readable here (see the migration).
        photo_path: person.photo_path || null,
        photo_thumb_path: person.photo_thumb_path || null,
      } : {
        name:      q('#f-name').value.trim(),
        nickname:  q('#f-nick').value.trim(),
        title:     q('#f-title').value.trim(),
        role_title: q('#f-role').value.trim(),
        organization: q('#f-org').value.trim(),
        category:          q('#f-sector').value,          // Sector (BD map)
        stakeholder_group: q('#f-group').value,
        email:    q('#f-email').value.trim(),
        contact:  q('#f-contact').value.trim(),
        birthday: q('#f-bday').value || null,
        gift_tier: q('#f-gift').value.trim(),
      };

      var data = Object.assign({
        project_id: pid,
        // ⚠️ `relationship_champion` sits with the identity fields on screen but
        //    is a PROJECT fact and is read from the form in BOTH cases -- see the
        //    PERSON_FIELDS note at the top of this file. It is deliberately not
        //    in `ident2`.
        relationship_champion: q('#f-champ').value.trim(),
        activity_no:         no,
        // Denormalised deliberately: the row still says which process it belongs
        // to when exported, or read by something that has not loaded MCCRCM.
        activity:            act ? act.name : (no ? r.activity : null),
        sub_process:         q('#f-sub').value.trim(),
        process_objectives:  act ? act.objective : null,
        process_description: act ? act.description : null,
        stk_category:     q('#f-cat').value,
        stk_sub_category: q('#f-subcat').value,
        // ⚠️ stored as TEXT '1'..'4' — that is what these two columns have held
        // since 2026-07-20 and what the dashboard's matrix metric reads.
        influence: q('#f-impact').value || null,           // Impact
        interest:  q('#f-infl').value || null,             // Influence
        response_category:    q('#f-resp').value,
        response_description: q('#f-respdesc').value.trim(),
        relationship_owner:   q('#f-relowner').value.trim(),
        impact_cost:   numOrNull(q('#f-icost').value),
        response_cost: numOrNull(q('#f-rcost').value),
        mgmt_approach:        q('#f-appr').value,
        engagement_plan:      q('#f-plan').value.trim(),
        megawide_counterpart: q('#f-cp').value.trim(),
        current_rel: n4(q('#f-cur').value),
        target_rel:  n4(q('#f-tgt').value),
        res_impact:        +q('#f-ri').value || null,
        res_possibility:   +q('#f-rp').value || null,
        res_detectability: +q('#f-rd').value || null,
        res_response_cost: numOrNull(q('#f-rrcost').value),
        audit_procedures:   q('#f-audp').value.trim(),
        required_documents: q('#f-audd').value.trim(),
        audit_contact:      q('#f-audc').value.trim(),
        audit_timing:       q('#f-audt').value.trim(),
        primary_responsible: q('#f-prim').value.trim(),
        alternate:           q('#f-alt').value.trim(),
        engagement:          q('#f-eng').value.trim(),
        updated_at: new Date().toISOString(),
      }, ident2);
      // ⚠️ The mirror is still written. `stakeholders` is the source of truth,
      //    but the CSV export, the offline cache, the live-collaboration cell
      //    paint and the project dashboard's own tile all read the project row
      //    directly -- see the migration's note on why the columns stayed.
      if (!data.name) { UI.toast('Name is required', 'warn'); return; }

      var oldPaths = [];
      try {
        btn.disabled = true;
        if (pendingFile) {
          btn.textContent = 'Uploading photo…';
          var up = await uploadPhoto(pendingFile);
          data.photo_path = up.photo_path;
          data.photo_thumb_path = up.photo_thumb_path;
          if (r.photo_path) oldPaths = [r.photo_path, r.photo_thumb_path];
        } else if (removeExisting) {
          data.photo_path = null; data.photo_thumb_path = null;
          oldPaths = [r.photo_path, r.photo_thumb_path];
        }
        btn.textContent = 'Saving…';

        // ---- the directory link ---------------------------------------
        // ⚠️ BEFORE the project row is written, so the row is never persisted
        //    with a null link it would then need a second write to repair. If
        //    this throws, nothing has been saved yet and the planner can retry.
        // ⚠️ Three cases:
        //      shared  -- already linked or picked; keep the link, touch nothing
        //                 in the directory. Person edits go through "Edit person".
        //      dirOff  -- the migration has not been run. Skip silently; the row
        //                 saves exactly as it did before this feature existed.
        //      else    -- a new person, or a legacy row being saved for the first
        //                 time since the migration: create-or-find and link. This
        //                 is what progressively cleans up the pre-migration rows.
        if (shared) {
          data.stakeholder_id = person.id;
        } else if (!dirOff) {
          try {
            var pr = await findOrCreatePerson(data);
            if (pr) {
              data.stakeholder_id = pr.id;
              people[pr.id] = pr;
              if (dirAll) dirAll = null;            // the picker's cache is now stale
            }
          } catch (derr) {
            // ⚠️ NOT fatal. The register row is the record the project needs; the
            //    directory is an optimisation on top of it. Failing the whole save
            //    because a shared master list refused would block a planner from
            //    recording a stakeholder at all -- so it degrades to an unlinked
            //    row (exactly a pre-migration row) and SAYS SO rather than
            //    pretending the person was shared.
            if (dirMissing(derr)) dirOff = true;
            else UI.toast('Saved to this project only — the shared directory refused: ' +
                          ((derr && derr.message) || 'request failed'), 'warn');
          }
        }

        if (isNew) {
          data.created_by = profile.id;              // REQUIRED for RLS
          data.sort_order = 10 + rows.filter(function (x) { return (x.activity_no || 0) === (no || 0); }).length * 10;
          var ins = await sb().from(TABLE).insert(data);
          if (ins.error) throw ins.error;
          await removeObjects(oldPaths);
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
          // ⚠️ Only AFTER the row no longer points at them. Deleting first and
          // then failing the update leaves a row referencing a missing object.
          await removeObjects(oldPaths);
          if (data.photo_path) await signPaths([data.photo_thumb_path, data.photo_path]);
          UI.toast('Saved', 'ok'); m.close(); sortRows(); render();
        }
      } catch (err) {
        UI.toast(photoHint(err), 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Save';
      }
    };

    // Autosave (edit only): debounced re-use of the Save button's own handler.
    if (!isNew && window.Autosave) {
      var asInd = document.createElement('span');
      asInd.className = 'pd-autosave pd-autosave-idle';
      asInd.textContent = 'Autosave on';
      var h2 = m.el.querySelector('h2');
      if (h2) { h2.style.display = 'flex'; h2.style.alignItems = 'center'; h2.style.gap = '10px'; h2.appendChild(asInd); }
      var as = Autosave.wire({ root: m.el, modal: m, saveBtn: q('#f-save'), indicator: asInd });
      var _smClose = m.close;
      m.close = function () { as.cancel(); _smClose(); };
    }

    function rate5(val, scale) {
      var s = '<option value="">—</option>';
      for (var i = scale.length - 1; i >= 0; i--) {
        var x = scale[i];
        s += '<option value="' + x.rating + '"' + (+val === x.rating ? ' selected' : '') + '>' + x.rating + ' — ' + x.label + '</option>';
      }
      return s;
    }
  }

  function photoHint(e) {
    var msg = (e && e.message) || 'Save failed';
    if (/bucket not found|does not exist.*bucket/i.test(msg)) {
      return 'The stakeholder-photos bucket is missing — run migrations/2026-09-01-stakeholder-register-ops.sql.';
    }
    return migrationHint(e);
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
  // Every column in register order, whatever the band toggles show — see the
  // matching note in the Risk Register: a band toggle is a viewing convenience
  // and an export that honoured it would be a silently partial register.
  function exportCsv() {
    if (!rows.length) { UI.toast('Nothing to export', 'warn'); return; }
    var e = E();
    var head = ['Activity No.', 'Activity / Business Process', 'Sub-process', 'Process Objectives',
      'Stakeholder Category', 'Stakeholder Sub-Category', 'Name of Stakeholder', 'Role', 'Organisation',
      'Sector', 'Group', 'Relationship Champion', 'Email', 'Contact No.',
      'Impact', 'Influence', 'Importance', 'Priority Level',
      'Response Category', 'Response Description', 'Relationship Owner', 'Impact Cost (PHP)', 'Response Cost (PHP)',
      'Residual Severity', 'Residual Occurrence', 'Degree of Control', 'Residual IMPORTANCE', 'Residual Band', 'Residual Response Cost',
      'Audit Procedures', 'Required Documents', 'Contact / Point Person', 'Timing',
      'Stakeholder Management Approach', 'Engagement Plan', 'Megawide Counterpart',
      'Current Relationship', 'Target Relationship', 'Engagement Strategy', 'Minimum Frequency',
      'Primary Responsible', 'Alternate', 'Photo on file'];
    var body = filtered().map(function (r) {
      var s = residualOf(r), st = strategyOf(gapOf(r));
      return [r.activity_no, r.activity, r.sub_process, r.process_objectives,
        r.stk_category, r.stk_sub_category, r.name, r.role_title, r.organization,
        r.category, r.stakeholder_group, r.relationship_champion, r.email, r.contact,
        impactOf(r), influenceOf(r), importanceOf(r), priorityOf(r),
        responseOf(r), r.response_description, r.relationship_owner || r.primary_responsible, r.impact_cost, r.response_cost,
        r.res_impact, r.res_possibility, r.res_detectability, s, s == null ? '' : e.residualBand(s).label, r.res_response_cost,
        r.audit_procedures, r.required_documents, r.audit_contact, r.audit_timing,
        approachOf(r), r.engagement_plan, r.megawide_counterpart,
        r.current_rel, r.target_rel, st === 'N/A' ? '' : st, freqOf(st),
        r.primary_responsible, r.alternate, r.photo_path ? 'yes' : 'no'];
    });
    downloadCsv('stakeholder-register', head, body);
  }
  function downloadCsv(base, head, body) {
    function cell(v) {
      if (v == null) return '';
      var s = String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var csv = [head].concat(body).map(function (r) { return r.map(cell).join(','); }).join('\r\n');
    // ⚠️ BOM, or Excel on Windows opens a UTF-8 CSV as ANSI and every ₱, × and
    // en-dash in the register becomes mojibake.
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
    var r = rows.filter(function (x) { return x.id === id; })[0];
    if (!confirm('Delete this stakeholder from THIS project? The person stays in the shared directory and on any other project. This cannot be undone.')) return;
    // ⚠️ `.select('id')`, and the row count is CHECKED. This table's DELETE
    // policy is owner-or-admin (`is_writer() and (created_by = auth.uid() or
    // is_admin())`, from the generic module-table loop in supabase-schema.sql),
    // NOT any writer -- so deleting a stakeholder somebody else registered
    // matches ZERO rows and PostgREST reports that as a clean success, with no
    // error. The same defect, the same fix, as the photo deletes in
    // progress-photos (2026-09-04); this is its sibling in this module.
    // ⚠️⚠️ HERE IT WAS WORSE THAN A MISLEADING TOAST. The photo cleanup below
    //     ran unconditionally, so a REFUSED delete still removed the objects --
    //     leaving a live row pointing at two paths that no longer exist, i.e. a
    //     stakeholder who permanently loses their face and cannot get it back
    //     from this screen. The cleanup is now gated on the row actually going.
    var res = await sb().from(TABLE).delete().eq('id', id).select('id');
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    if (!res.data || !res.data.length) {
      UI.toast('Not deleted — the database refused it. A register row can only be removed by whoever added it, or by an admin.', 'error');
      load();          // put the row back on screen; it never left the database
      return;
    }
    // The row is gone, so its photo objects are now unreachable — remove them
    // rather than leaving them to accumulate in the bucket forever.
    // ⚠️ Only the paths this PROJECT row owned. A person shared with another
    //    project points at the same object, so this is why the directory row is
    //    never touched here: deleting the person's photo because one project
    //    stopped tracking them would blank their face everywhere.
    if (r && !r.stakeholder_id) await removeObjects([r.photo_path, r.photo_thumb_path]);
    UI.toast('Deleted', 'ok'); load();
  }

  return { init: init };
})();
