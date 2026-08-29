// ============================================================================
// Progress Photos — Photos Database
// ----------------------------------------------------------------------------
// Replaces the Power Apps "Progress Photos | Photos Database" screen:
//   • Project-scoped photo log: PHOTO · DESCRIPTION · TRADE · WORKS · LOCATION
//     · CAPTURE DATE
//   • Filters: capture start/end, trade, works, location, free-text search
//   • List View  — grouped by trade, thumbnail + row actions (open / download)
//   • Gallery View — large photo cards with the detail table beneath
//   • Lightbox (the Power Apps fullscreen expand), keyboard-navigable
//   • Upload many photos at once against one set of shared fields
//   • Private `progress-photos` storage bucket; viewed via signed URLs
// ============================================================================

window.ProgressPhotos = (function () {
  var TABLE  = 'progress_photos';
  var BUCKET = 'progress-photos';
  var SIGN_TTL = 3600;               // signed-URL lifetime (s); refreshed on reload

  var profile = null, uid = null, pid = null, projName = '';
  var rows = [];
  var view = 'gallery';               // list | gallery — gallery is the default landing view (item 1, 2026-08-29 feedback)
  var filters = { from: '', to: '', trade: '', works: '', locValues: {}, search: '', archived: false };
  var collapsed = {};                // trade -> true
  var urlCache = {};                 // storage path -> signed URL
  var canWrite = false;              // planner+ / admin / super_admin
  var lightboxIds = [], lightboxAt = 0;
  var projectListeners = [];         // PPR screen subscribes; both share one selector
  var selected = {};                 // id -> true (Gallery batch select, follow-up feedback item 5)

  // ---- Schedule App integration (Phase 1) ----------------------------------
  // Locations are read from Project Schedule's real "Location Breakdown" —
  // NOT the wbs_nodes tree (an earlier cut of this integration used wbs_nodes;
  // corrected after inspecting Project Schedule's actual code). The real
  // system is `location_levels` (a per-project, ORDERED, free-form list of
  // level names — e.g. Tower/Level/Zone, but genuinely different per project)
  // plus a `location` jsonb on each project_schedule activity, keyed by level
  // id, always a plain string value. Project Schedule itself deliberately
  // stopped using wbs_nodes for this (its own CLAUDE.md, 2026-08-04: "location
  // and zone existed only as WBS tree structure... Fix = make them activity
  // data") — conflating the two was the exact mistake being corrected here.
  // There is NO cascading constraint in the data, and Schedule's own UI for
  // this is free-text + datalist suggestions, not a <select> — the "cascade"
  // below is a soft one (later levels' suggestions are filtered by earlier
  // picks) purely for convenience, not enforced by any parent-child link.
  var LOC_LEVELS = [];                     // [{id, name, sort_order}], sort_order ascending
  var SCHED_ACTS = [];                     // project_schedule rows: {id, activity_id, activity_name, location, activity_type, status, start_date, end_date}
  var CODE_TYPES = [], CODE_VALUES = [];   // optional Activity-Code overlay (unrelated code types)
  // Execution/Close-out phase scoping for the Works picker. Project Schedule's
  // `project_schedule.phase` column is often BLANK on individual activities --
  // that module resolves phase by walking up the WBS ancestry at read time
  // (its own `phaseOf()`), inheriting from the nearest tagged branch, rather
  // than storing it on every row. Progress Photos doesn't load the WBS tree
  // (a deliberate call after the wbs_nodes/Location-Breakdown correction), so
  // it resolves the SAME "is this under Execution Phase / Close-out Phase"
  // question the way Project Schedule's own `execPhaseCode()`/`locCodeUnder()`
  // do it for the identical scoping problem: find the top-level WBS-Summary
  // row named "Execution Phase" / "Closeout Phase" and test the activity's
  // OWN dotted `wbs` code for a boundary-safe prefix match against it. This
  // is more reliable than the raw `phase` column, which on a real imported
  // project (e.g. Avesta) is blank on nearly every leaf activity.
  var EXEC_WBS_CODE = null, CLOSEOUT_WBS_CODE = null;
  // Substring match (not anchored to the whole name), the same rule Project
  // Schedule's own `phaseFromName()` uses to classify a WBS branch by name —
  // reused deliberately rather than re-deriving a stricter pattern, so a
  // branch named "4. Execution Phase" or "Execution Phase (Construction)"
  // still resolves the same way it would inside that module.
  function branchPhaseFromName(name) {
    var t = String(name == null ? '' : name).trim().toLowerCase();
    if (!t) return null;
    if (t.indexOf('execution phase') >= 0 || t.indexOf('construction') >= 0) return 'construction';
    if (t.indexOf('close-out') >= 0 || t.indexOf('closeout') >= 0 || t.indexOf('close out') >= 0) return 'closeout';
    return null;
  }
  var migrationWarned = false;             // warn once per session, not per save
  var migrationWarnedMulti = false;        // same, for the 2026-08-29 trades/works_multi columns
  var migrationWarnedMedia = false;        // same, for the 2026-08-29 media_type column (video upload)
  var migrationWarnedMarkup = false;       // same, for the 2026-08-29 markup column (Batch F)
  // Today's Rounds (the streamlined-walkthrough screen) was removed entirely
  // per owner feedback (2026-08-29, "Rounds can be removed") — its state vars
  // (roundsFilter/roundsSelected/walkState/_roundsComboByKey) and its render/
  // wire/walkthrough functions are gone with it. locCombos()/photoLocCombos()
  // further down are NOT part of that removal — they're the shared location-
  // enumeration helpers bim.js's pin picker and ppr.js's Report Templates
  // builder both depend on, and stay exactly where they were.

  // ===== live collaboration (presence + "who's editing this photo") =========
  // Shared PDCollab layer (Supabase Realtime): topbar avatars, a colored flag on
  // the photo row/card a teammate has open in the Edit modal, and live gallery
  // updates when someone saves/uploads/deletes. Images themselves still need a
  // connection (the signed-URL preview is fetched on the remote change), but the
  // gallery structure + metadata stream live.
  var _collab = null, _remoteSel = {};
  function _selfName() { return (profile && (profile.name || profile.email)) || 'Someone'; }
  function joinCollab() {
    if (!window.PDCollab) return;
    if (_collab) { _collab.leave(); _collab = null; }
    _remoteSel = {};
    if (!pid) { renderPresence([]); return; }
    _collab = PDCollab.join({
      key: 'progress_photos:' + pid, table: TABLE, projectId: pid,
      self: { id: uid, name: _selfName() },
      onPresence: function (members) {
        renderPresence(members);
        _remoteSel = {}; members.forEach(function (m) { if (!m.self && m.sel) _remoteSel[m.id] = { id: m.id, name: m.name, color: m.color, sel: m.sel }; });
        paintRemote();
      },
      onSelection: function (d) { if (d.sel) _remoteSel[d.id] = { id: d.id, name: d.name, color: d.color, sel: d.sel }; else delete _remoteSel[d.id]; paintRemote(); },
      onRemoteChange: applyRemoteChange
    });
  }
  function renderPresence(members) { var el = $('pp-presence'); if (el) el.innerHTML = window.PDCollab ? PDCollab.avatarsHTML(members || []) : ''; }
  function broadcastCollabSel(photoId, editing) { if (_collab) _collab.setSelection(photoId ? { rowId: photoId, editing: !!editing } : null); }
  function paintRemote() {
    if (!window.PDCollab) return;
    var host = $('pp-view'); if (!host) return;
    PDCollab.clearCells(host);
    Object.keys(_remoteSel).forEach(function (k) {
      var m = _remoteSel[k]; if (!m || !m.sel || !m.sel.rowId) return;
      var rid = (window.CSS && CSS.escape) ? CSS.escape(String(m.sel.rowId)) : m.sel.rowId;
      var node = host.querySelector('.pp-row[data-id="' + rid + '"] .pp-thumbcell') ||
                 host.querySelector('.pp-card[data-id="' + rid + '"] .pp-cardimg') ||
                 host.querySelector('[data-id="' + rid + '"]');
      if (node) PDCollab.paintCell(node, m);
    });
  }
  async function applyRemoteChange(payload) {
    var evt = payload.eventType || payload.event;
    var rec = payload['new'] || payload.record || null, old = payload['old'] || payload.old_record || null;
    if (evt === 'DELETE') { var did = old && old.id; if (did == null) return; rows = rows.filter(function (x) { return String(x.id) !== String(did); }); }
    else if (rec) {
      var j = -1; for (var i = 0; i < rows.length; i++) { if (String(rows[i].id) === String(rec.id)) { j = i; break; } }
      if (j < 0) rows.push(rec); else rows[j] = rec;
      // A newly-inserted / re-pathed photo has no signed URL yet — sign it so the
      // preview shows live (needs a connection; falls back to the placeholder).
      if (rec.photo_url && !urlCache[rec.photo_url]) { try { await signOne(rec.photo_url); } catch (e) {} }
    } else return;
    if (window.PDSync) PDSync.cachePut('pp:' + pid, rows);
    fillFilterOptions();
    render();
  }
  async function signOne(path) {
    var res = await sb().storage.from(BUCKET).createSignedUrl(path, SIGN_TTL);
    if (res && res.data && res.data.signedUrl) urlCache[path] = res.data.signedUrl;
  }

  // Trades mirror the WPM (procurement) trade vocabulary so photos, work
  // packages and cash-out all speak the same language.
  var TRADES = [
    'Site Works', 'Civil Works', 'Structural Works', 'Architectural Works',
    'Mechanical Works', 'Electrical and Auxiliary Works',
    'Plumbing and Sanitary Works', 'Fire Protection Works',
    'General Requirements'
  ];

  function sb() { return AppAuth.getSB(); }
  function $(id) { return document.getElementById(id); }

  // UI.modal() takes no width and doesn't wire close buttons, so do both here
  // rather than touching the shared ui.js (module contract §1).
  // ⚠️ Audit fix: `onClose` (optional) now runs on EVERY way this modal can
  // be dismissed — the × / Cancel [data-close] buttons AND a backdrop
  // click. UI.modal()'s own backdrop listener closes over a PRIVATE `close`
  // variable, not the returned `m.close` PROPERTY, so a caller reassigning
  // `m.close` (or re-wiring [data-close], as openForm/openMarkupEditor both
  // did) was silently bypassed on backdrop dismissal specifically — the
  // "editing this photo" collab cursor and the markup editor's window
  // resize listener could both be left stuck/leaking that way. Passing
  // {noBackdropClose:true} disables UI.modal's internal listener so this
  // function's own — which DOES route through the same close() used by
  // [data-close] — is the only one active. Callers that don't need cleanup
  // simply omit `onClose` and get the previous behaviour unchanged.
  function openModal(html, width, onClose) {
    var m = UI.modal(html, { noBackdropClose: true });
    var box = m.el.querySelector('.pd-modal');
    if (box && width) box.style.maxWidth = width + 'px';
    function close() { if (onClose) { try { onClose(); } catch (e) {} } m.close(); }
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-close]'), function (b) {
      b.onclick = close;
    });
    m.el.addEventListener('click', function (e) { if (e.target === m.el) close(); });
    if (window.Icons && Icons.hydrate) Icons.hydrate(m.el);
    m.close = close;
    return m;
  }

  // ---- per-project UI persistence ------------------------------------------
  function uiKey(k) { return 'pp_' + k + '_' + pid; }
  function saveUI() {
    try {
      localStorage.setItem(uiKey('view'), view);
      localStorage.setItem(uiKey('collapsed'), JSON.stringify(collapsed));
      localStorage.setItem(uiKey('gallerygroup'), galleryGroupBy);
    } catch (e) {}
  }
  function restoreUI() {
    try {
      var v = localStorage.getItem(uiKey('view'));
      if (['list', 'gallery', 'plan', 'stack'].indexOf(v) >= 0) view = v;
      collapsed = JSON.parse(localStorage.getItem(uiKey('collapsed')) || '{}') || {};
      var g = localStorage.getItem(uiKey('gallerygroup'));
      if (['month', 'trade', 'location'].indexOf(g) >= 0) galleryGroupBy = g;
    } catch (e) { collapsed = {}; }
  }

  // ------------------------------------------------------------------ init ---
  async function init(user, prof) {
    profile = prof; uid = user.id;
    canWrite = ['super_admin', 'admin', 'planner'].indexOf(prof.role) >= 0;
    pid = sessionStorage.getItem('pd_project') || '';
    restoreUI();

    await fillProjects();
    wire();
    syncChrome();
    await load();
    await loadSchedule();
    fillFilterOptions();   // load() ran before location_levels/SCHED_ACTS existed — refresh the Works
                            // datalist + location filters now that the schedule is in
    await refreshQueueBadge();
    window.addEventListener('online', function () { if (pid) flushQueue(); });
    joinCollab();
  }

  // --------------------------------------------------------- schedule read ---
  // Reads location_levels / project_schedule / activity codes for the current
  // project. Tolerant of the tables not existing yet (pre-migration DB) —
  // the module just falls back to free-text-only locations.
  // Keyset-paginate (a single select caps at 1000 rows server-side, regardless
  // of any client .limit()) — a real project's project_schedule can exceed
  // that (P6/Excel imports routinely create thousands), which would silently
  // truncate the activity set to whatever fell in the first page by id order.
  // Same fix Project Schedule's own load() already needed for the identical
  // reason. location_levels itself is a short, curated per-project list (a
  // handful of rows) — not paginated, matching how Project Schedule's own
  // openLocLevels() loads it.
  async function fetchAllPages(table, selectCols, extraFilter) {
    var all = [], last = null;
    while (true) {
      var q = sb().from(table).select(selectCols).eq('project_id', pid);
      if (extraFilter) q = extraFilter(q);
      q = q.order('id', { ascending: true }).limit(1000);
      if (last) q = q.gt('id', last);
      var res = await q;
      if (res.error) return { data: null, error: res.error };
      var batch = res.data || [];
      all = all.concat(batch);
      if (batch.length < 1000) break;
      last = batch[batch.length - 1].id;
    }
    return { data: all, error: null };
  }

  async function loadSchedule() {
    LOC_LEVELS = []; SCHED_ACTS = [];
    CODE_TYPES = []; CODE_VALUES = [];
    EXEC_WBS_CODE = null; CLOSEOUT_WBS_CODE = null;
    if (!pid) return;
    try {
      var lres = await sb().from('location_levels').select('id,name,sort_order')
        .eq('project_id', pid).order('sort_order', { ascending: true });
      if (!lres.error) LOC_LEVELS = lres.data || [];
    } catch (e) {}

    try {
      var ares = await fetchAllPages('project_schedule',
        'id,activity_id,activity_name,location,activity_type,status,start_date,end_date,work_type,phase,wbs',
        function (q) { return q.neq('activity_type', 'WBS Summary'); });
      if (!ares.error) SCHED_ACTS = ares.data || [];
    } catch (e) {}

    // Resolve the Execution Phase / Close-out Phase WBS-Summary rows so the
    // Works picker can scope by dotted-code ancestry (see the EXEC_WBS_CODE
    // comment above) -- the raw `phase` column alone is not reliable enough
    // on an imported schedule that never had every activity re-stamped.
    try {
      var wres = await fetchAllPages('project_schedule', 'wbs,activity_name,activity_type',
        function (q) { return q.eq('activity_type', 'WBS Summary'); });
      if (!wres.error) {
        var execBest = null, closeoutBest = null, wbsRowCount = (wres.data || []).length;
        (wres.data || []).forEach(function (w) {
          var code = w.wbs;
          if (!code) return;
          var ph = branchPhaseFromName(w.activity_name);
          if (!ph) return;
          var depth = (code.match(/\./g) || []).length;
          if (ph === 'construction' && (!execBest || depth < execBest.depth)) execBest = { code: code, depth: depth };
          if (ph === 'closeout' && (!closeoutBest || depth < closeoutBest.depth)) closeoutBest = { code: code, depth: depth };
        });
        EXEC_WBS_CODE = execBest ? execBest.code : null;
        CLOSEOUT_WBS_CODE = closeoutBest ? closeoutBest.code : null;
        if (!EXEC_WBS_CODE && !CLOSEOUT_WBS_CODE) {
          console.warn('[progress-photos] Could not find an Execution Phase / Closeout Phase WBS ' +
            'branch among ' + wbsRowCount + ' WBS-Summary row(s) for project ' + pid + ' -- the ' +
            'Works picker will fall back to the raw project_schedule.phase column only, which is ' +
            'often blank on an imported schedule. Check the WBS Manager for the exact branch names.');
        }
      } else {
        console.warn('[progress-photos] WBS-Summary fetch failed for project ' + pid + ':', wres.error);
      }
    } catch (e) {
      console.warn('[progress-photos] WBS-Summary fetch threw for project ' + pid + ':', e);
    }

    try {
      var tres = await sb().from('activity_code_types').select('id,name').eq('project_id', pid);
      if (!tres.error) CODE_TYPES = tres.data || [];
      if (CODE_TYPES.length) {
        var vres = await sb().from('activity_code_values').select('id,code_type_id,value')
          .in('code_type_id', CODE_TYPES.map(function (t) { return t.id; }));
        if (!vres.error) CODE_VALUES = vres.data || [];
      }
    } catch (e) {}

    // Unconditional summary -- logged every load (not just on failure) so a
    // live report of "the Works dropdown is empty" can be diagnosed from
    // whatever this prints, instead of guessing which stage failed. Safe to
    // leave in: one console.info per project load, not per render.
    try {
      var inScopeCount = SCHED_ACTS.filter(inExecOrCloseout).length;
      var eligibleNames = distinctScheduleWorks();
      console.info('[progress-photos] loadSchedule(' + pid + '): ' + SCHED_ACTS.length +
        ' non-summary activities loaded, Execution root=' + JSON.stringify(EXEC_WBS_CODE) +
        ', Closeout root=' + JSON.stringify(CLOSEOUT_WBS_CODE) + ', ' + inScopeCount +
        ' in Execution/Close-out scope, ' + eligibleNames.length +
        ' distinct Works name(s) eligible: ' + JSON.stringify(eligibleNames.slice(0, 20)));
    } catch (e) { console.warn('[progress-photos] diagnostic summary threw:', e); }
  }
  // Boundary-safe "is this WBS code at or under that root code" test --
  // "4" matches "4.1" but never "40.1" (a naive startsWith would).
  function wbsUnderRoot(code, root) {
    if (!code || !root) return false;
    return code === root || code.indexOf(root + '.') === 0;
  }
  function inExecOrCloseout(a) {
    if (a.phase === 'construction' || a.phase === 'closeout') return true;
    return wbsUnderRoot(a.wbs, EXEC_WBS_CODE) || wbsUnderRoot(a.wbs, CLOSEOUT_WBS_CODE);
  }

  // Value of one level for any {location: {...}} bearing record (an activity
  // or, once saved, a photo's own location_values).
  function locValOf(obj, levelId) { return (obj && obj[levelId]) || ''; }

  // Every distinct value already used at this level among schedule
  // activities — feeds the datalist suggestions. `priorVals` (a
  // {levelId: value} map of levels picked so far, earlier in level order)
  // narrows the scan to activities that agree on those — a SOFT cascade for
  // convenience only; the data has no enforced parent-child link, and typing
  // an unlisted value is always allowed (matches Schedule's own datalist UX).
  function distinctLocValues(levelId, priorVals) {
    var seen = {}, out = [];
    SCHED_ACTS.forEach(function (a) {
      var loc = a.location || {};
      for (var lid in priorVals) { if (priorVals[lid] && (loc[lid] || '') !== priorVals[lid]) return; }
      var v = loc[levelId];
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out.sort();
  }

  // "›"-joined path across every level that has a value, in level order.
  function locBreadcrumb(values) {
    return LOC_LEVELS.map(function (l) { return values[l.id]; }).filter(Boolean).join(' › ');
  }

  // The schedule activity that's "current" for a set of picked location
  // values: prefer In Progress (earliest start), else the next Not Started,
  // else whatever's there. Matches any activity whose OWN location agrees on
  // every level actually specified in `values` — an activity with additional
  // levels set (more specific) still matches, so stopping the picker early
  // (e.g. just Tower + Level, no Zone) still surfaces something.
  function resolveActivity(values) {
    var keys = Object.keys(values || {}).filter(function (k) { return values[k]; });
    if (!keys.length) return null;
    var cands = SCHED_ACTS.filter(function (a) {
      var loc = a.location || {};
      return keys.every(function (k) { return (loc[k] || '') === values[k]; });
    });
    if (!cands.length) return null;
    var pick = cands.filter(function (a) { return (a.status || '') === 'In Progress'; })
      .sort(function (a, b) { return (a.start_date || '').localeCompare(b.start_date || ''); })[0];
    if (!pick) pick = cands.filter(function (a) { return (a.status || '') === 'Not Started'; })
      .sort(function (a, b) { return (a.start_date || '').localeCompare(b.start_date || ''); })[0];
    if (!pick) pick = cands[0];
    return { id: pick.activity_id, name: pick.activity_name };
  }

  // Most recent photo captured at (a superset of) this set of location values.
  function lastCaptureAt(values) {
    var keys = Object.keys(values || {}).filter(function (k) { return values[k]; });
    if (!keys.length) return null;
    var list = rows.filter(function (r) {
      var lv = r.location_values || {};
      return keys.every(function (k) { return (lv[k] || '') === values[k]; });
    }).sort(function (a, b) { return (b.taken_at || '').localeCompare(a.taken_at || ''); });
    return list[0] || null;
  }

  async function fillProjects() {
    var sel = $('pp-project');
    var projects = await PDb.getProjects();
    projects = projects.filter(function (p) { return AppAuth.canAccessProject(profile, p.id); });
    if (!projects.length) { sel.innerHTML = '<option value="">No projects</option>'; return; }
    if (!pid || !projects.some(function (p) { return p.id === pid; })) pid = projects[0].id;
    sel.innerHTML = projects.map(function (p) {
      return '<option value="' + Fmt.esc(p.id) + '"' + (p.id === pid ? ' selected' : '') + '>' +
             Fmt.esc(p.name || p.id) + '</option>';
    }).join('');
    UI.enhanceProjectSelect(sel);   // shared searchable project picker
    var cur = projects.filter(function (p) { return p.id === pid; })[0];
    projName = cur ? (cur.name || cur.id) : pid;
    sessionStorage.setItem('pd_project', pid);
    sessionStorage.setItem('pd_project_name', projName);
    notifyProject();
  }

  function notifyProject() {
    projectListeners.forEach(function (fn) {
      try { fn(pid, projName); } catch (e) { console.error(e); }
    });
  }

  function wire() {
    $('pp-project').onchange = async function () {
      pid = this.value;
      var opt = this.options[this.selectedIndex];
      projName = opt ? opt.textContent : pid;
      sessionStorage.setItem('pd_project', pid);
      sessionStorage.setItem('pd_project_name', projName);
      restoreUI(); syncChrome(); notifyProject();
      await load();
      await loadSchedule();
      fillFilterOptions();
      await refreshQueueBadge();
      joinCollab();
    };
    // Shared group-by (item 6) — a static, persistent select in the list bar
    // (outside #pp-view), wired ONCE here rather than rebuilt by wireRows()
    // on every render, unlike the row/tile markup itself.
    if ($('pp-groupby')) {
      $('pp-groupby').value = galleryGroupBy;
      $('pp-groupby').onchange = function () { galleryGroupBy = this.value; saveUI(); render(); };
    }
    // Item 8 — filters collapsed by default on a phone; the toggle button is
    // desktop-invisible (module.css), so this handler is harmless dead
    // weight above the phone breakpoint rather than something that needs
    // its own guard.
    if ($('pp-filttoggle')) $('pp-filttoggle').onclick = function () {
      var wrap = $('pp-filters'); if (wrap) wrap.classList.toggle('open');
    };
    // List/Gallery is the shared .pd-viewtoggle. NB: `.pp-tab` now means the
    // topbar's Photos|PPRs screen tabs — don't select on it here.
    Array.prototype.forEach.call(document.querySelectorAll('.pd-vt[data-view]'), function (b) {
      b.onclick = function () { view = b.dataset.view; saveUI(); syncChrome(); render(); };
    });
    // Location filtering is handled separately by renderLocFilterSelects()
    // (one <select> per Location Breakdown level, dynamically built — there's
    // no fixed "location" field to bind generically here).
    ['from', 'to', 'trade', 'works', 'search'].forEach(function (k) {
      var el = $('pp-f-' + k);
      if (!el) return;
      el.oninput = el.onchange = function () { filters[k] = this.value; render(); };
    });
    // Archived (follow-up feedback item 5's "Archive" batch action needs a way
    // back to what it hid) — not reset by Clear filters, same reasoning as
    // the Presentations list's own archived toggle: it isn't a search filter,
    // it's a completely separate view of the same list.
    if ($('pp-f-archived')) $('pp-f-archived').onchange = function () { filters.archived = this.checked; render(); };
    $('pp-clearfilters').onclick = function () {
      filters = { from: '', to: '', trade: '', works: '', locValues: {}, search: '', archived: filters.archived };
      ['from', 'to', 'trade', 'works', 'search'].forEach(function (k) {
        var el = $('pp-f-' + k); if (el) el.value = '';
      });
      renderLocFilterSelects();
      render();
    };
    $('pp-add').onclick = function () { openUpload(); };
    $('pp-refresh').onclick = function () { load(); };
    if ($('pp-sync')) $('pp-sync').onclick = function () { flushQueue(); };
    wireSelBar();

    document.addEventListener('keydown', function (e) {
      if (!$('pp-lightbox') || $('pp-lightbox').hidden) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') stepLightbox(1);
      if (e.key === 'ArrowLeft') stepLightbox(-1);
    });
  }

  // The single source of truth for what the Photos-screen tool row shows —
  // called on every render AND on every selection change, so the two states
  // (normal tools vs. selection tools) can never both be visible or both be
  // hidden at once. Previously this only handled role-based visibility; the
  // selection-mode swap (item 3: "when selecting photos, the download, add
  // to presentation, and archive buttons then show up in the taskbar") is
  // folded in here rather than a second parallel function, so there is one
  // place that decides "+ Add media" vs. "N selected" for this row.
  function syncChrome() {
    Array.prototype.forEach.call(document.querySelectorAll('.pd-vt[data-view]'), function (b) {
      b.classList.toggle('active', b.dataset.view === view);
    });
    var ids = visibleSelectedIds();
    var has = ids.length > 0;
    // The upload action + its divider are planner+ only, AND hidden while a
    // selection is active.
    ['pp-add', 'pp-sep-photos'].forEach(function (id) {
      var el = $(id); if (el) el.style.display = (has || !canWrite) ? 'none' : '';
    });
    var refresh = $('pp-refresh'); if (refresh) refresh.style.display = has ? 'none' : '';
    var count = $('pp-selcount');
    if (count) { count.style.display = has ? '' : 'none'; count.textContent = ids.length + ' selected'; }
    ['pp-sel-download', 'pp-sel-addppr', 'pp-sel-archive'].forEach(function (id) {
      var el = $(id); if (el) el.style.display = has ? '' : 'none';
    });
  }

  // ------------------------------------------------------------------ load ---
  async function load() {
    var host = $('pp-view');
    host.innerHTML = '<div class="pp-empty">Loading photos…</div>';
    if (!pid) { host.innerHTML = '<div class="pp-empty">Select a project to see its photos.</div>'; return; }

    // Keyset-paginate (a single select caps at 1000; a project's photo library can exceed
    // that, silently hiding photos from the grid, PPR picker and bulk actions), then restore
    // the taken_at-desc / sort_order ordering.
    var all = [], last = null;
    while (true) {
      var q = sb().from(TABLE).select('*').eq('project_id', pid).order('id', { ascending: true }).limit(1000);
      if (last) q = q.gt('id', last);
      var res = await q;
      if (res.error) {
        // Offline / fetch failed: fall back to the read-cache so the gallery still
        // opens (metadata edits made offline queue via PDSync and sync on reconnect).
        // Signed image URLs can't be minted offline → previews show the placeholder.
        if (window.PDSync) {
          var c = await PDSync.cacheGet('pp:' + pid);
          if (c && c.rows) { rows = c.rows.slice(); fillFilterOptions(); render(); return; }
        }
        host.innerHTML = ''; UI.toast(res.error.message, 'error'); return;
      }
      var batch = res.data || []; all = all.concat(batch);
      if (batch.length < 1000) break; last = batch[batch.length - 1].id;
    }
    all.sort(function (a, b) {
      var ta = a.taken_at || '', tb = b.taken_at || '';   // taken_at DESC (blank last)
      if (ta !== tb) return ta < tb ? 1 : -1;
      var sa = a.sort_order, sb2 = b.sort_order;           // then sort_order ASC, NULLS LAST
      if (sa == null && sb2 == null) return 0;
      if (sa == null) return 1; if (sb2 == null) return -1;
      return sa - sb2;
    });
    rows = all;
    if (window.PDSync) PDSync.cachePut('pp:' + pid, rows);   // keep the offline cache current

    await signAll();
    // Batch C (2026-08-29): the Gallery feed is now UNIFIED (photos/videos +
    // panoramas + done 3D reconstructions, one grid) — load the other two
    // modules' data alongside this module's own so the merge has something
    // to merge. Each call is a no-op once already loaded, so switching
    // between screens and back doesn't re-fetch every time.
    await Promise.all([
      (window.PANO && PANO.ensureLoaded) ? PANO.ensureLoaded() : Promise.resolve(),
      (window.RECON && RECON.ensureLoaded) ? RECON.ensureLoaded() : Promise.resolve()
    ]);
    fillFilterOptions();
    render();
  }

  // Batch-sign every photo path in one request rather than one call per row.
  async function signAll() {
    urlCache = {};
    var seen = {}, paths = [];
    rows.forEach(function (r) {
      [r.photo_url, r.key_plan_url].forEach(function (p) {
        if (p && !seen[p]) { seen[p] = 1; paths.push(p); }
      });
    });
    if (!paths.length) return;
    var res = await sb().storage.from(BUCKET).createSignedUrls(paths, SIGN_TTL);
    if (res.error) { UI.toast('Could not load photo previews: ' + res.error.message, 'warn'); return; }
    (res.data || []).forEach(function (d) {
      if (d && d.signedUrl && !d.error) urlCache[d.path] = d.signedUrl;
    });
  }
  function urlOf(r) { return r.photo_url ? urlCache[r.photo_url] : ''; }

  function distinct(field) {
    var seen = {}, out = [];
    rows.forEach(function (r) {
      var v = (r[field] || '').trim();
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out.sort();
  }
  // Array-aware distinct-values listing (2026-08-29, Trade/Works multi-select)
  // -- unions the new array column with the legacy singular column so a
  // pre-migration row's value still appears in the filter dropdown.
  function distinctMulti(arrField, singleField) {
    var seen = {}, out = [];
    rows.forEach(function (r) {
      (r[arrField] || []).forEach(function (v) {
        v = (v || '').trim();
        if (v && !seen[v]) { seen[v] = 1; out.push(v); }
      });
      var s = (r[singleField] || '').trim();
      if (s && !seen[s]) { seen[s] = 1; out.push(s); }
    });
    return out.sort();
  }
  // Maps THIS module's own Trade vocabulary onto Project Schedule's canonical
  // work_type buckets (see project-schedule's CLAUDE.md, GWORK: work_type is
  // one of General Requirements / Site Works / Structural Works /
  // Architectural Works / MEPF Works / Site Development / Allied Services /
  // Others). This module's Trade list is finer-grained -- it splits MEPF into
  // Mechanical/Electrical/Plumbing/Fire Protection to match the WPM
  // procurement vocabulary -- so one Trade maps to several schedule work_type
  // keywords. Matched by case-insensitive keyword, not exact equality, so a
  // schedule that predates the canonical resolver (or was hand-edited) still
  // matches on its own wording.
  var TRADE_WORK_TERMS = {
    'Site Works': ['site work', 'site development'],
    'Civil Works': ['civil', 'site development', 'earthwork'],
    'Structural Works': ['structural'],
    'Architectural Works': ['architectural'],
    'Mechanical Works': ['mepf', 'mechanical'],
    'Electrical and Auxiliary Works': ['mepf', 'electrical'],
    'Plumbing and Sanitary Works': ['mepf', 'plumbing', 'sanitary'],
    'Fire Protection Works': ['mepf', 'fire'],
    'General Requirements': ['general requirement']
  };
  function workTypeMatchesTrade(workType, trade) {
    if (!trade) return true;   // no Trade picked yet -- don't narrow anything
    if (!workType) return false;
    var terms = TRADE_WORK_TERMS[trade] || [trade.toLowerCase()];
    var wt = String(workType).toLowerCase();
    return terms.some(function (t) { return wt.indexOf(t) >= 0; });
  }
  // "Works" suggestions = the project's own schedule activities, scoped to the
  // Trade currently selected in the modal (so picking "Structural" only
  // offers structural activities as Works, preventing a planner from
  // attaching an MEPF activity name to a Structural photo by mistake) --
  // deduplicated by NAME, not by row (a schedule commonly repeats the same
  // activity name across many WBS branches/floors, e.g. "Rebar Installation"
  // on every level) -- UNION any values already typed on this project's own
  // captured photos under the same Trade (so a planner's past free-text entry
  // stays suggested even if it doesn't match a schedule activity name).
  // ⚠️ Start/Finish Milestones are excluded -- schedules commonly name a
  // floor-completion milestone after the floor itself ("10th Floor"), which
  // read as a bogus "activity" choice; only real Task rows are offered.
  // ⚠️ Scoped to Execution Phase + Close-out via `inExecOrCloseout()` --
  // design/bidding/planning activities (Initiation, Planning) and the
  // un-phased "Milestones" WBS branch describe pre-construction work or
  // point-in-time markers, neither of which is a "Works" a site photo is
  // capturing. An activity that resolves to NEITHER a stamped phase NOR a
  // WBS code under the Execution/Close-out root is excluded -- it is not
  // known to be construction work, so it is left out rather than guessed in.
  // ⚠️ `tradeFilter` accepts EITHER a single trade string (legacy call shape,
  // kept so nothing else in this file needs to change) OR an array of trades
  // (2026-08-29 feedback item 2 — Trade is now multi-select). An array is
  // OR'd across `workTypeMatchesTrade` per entry; an empty array behaves
  // exactly like the old "no trade picked" case (offers everything).
  function tradesAsArray(tradeFilter) {
    if (Array.isArray(tradeFilter)) return tradeFilter;
    return tradeFilter ? [tradeFilter] : [];
  }
  function distinctScheduleWorks(tradeFilter) {
    var trades = tradesAsArray(tradeFilter);
    var seen = {}, out = [];
    SCHED_ACTS.forEach(function (a) {
      if (a.activity_type === 'Start Milestone' || a.activity_type === 'Finish Milestone') return;
      if (!inExecOrCloseout(a)) return;
      var matches = !trades.length || trades.some(function (t) { return workTypeMatchesTrade(a.work_type, t); });
      if (!matches) return;
      var v = (a.activity_name || '').trim();
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out.sort();
  }
  function distinctCapturedWorks(tradeFilter) {
    var trades = tradesAsArray(tradeFilter);
    var seen = {}, out = [];
    rows.forEach(function (r) {
      // Matches either the new `trades` array or the legacy singular `trade`
      // column, so a pre-migration row's captured Works value still suggests.
      if (trades.length) {
        var rowTrades = (r.trades && r.trades.length) ? r.trades : (r.trade ? [r.trade] : []);
        if (!trades.some(function (t) { return rowTrades.indexOf(t) >= 0; })) return;
      }
      var v = (r.works || '').trim();
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
      (r.works_multi || []).forEach(function (w) {
        w = (w || '').trim();
        if (w && !seen[w]) { seen[w] = 1; out.push(w); }
      });
    });
    return out.sort();
  }
  function worksOptions(tradeFilter) {
    var seen = {}, out = [];
    distinctScheduleWorks(tradeFilter).concat(distinctCapturedWorks(tradeFilter)).forEach(function (v) {
      if (!seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out.sort();
  }
  // ---- Works: a single schedule-derived tag -------------------------------
  // 2026-08-29 feedback item 9: "instead of selecting trades and works as
  // multiple selection, add a works tag to the media, get the works choices
  // from the schedule module" — REVERSES the multi-select checkbox groups
  // this same file shipped earlier the same day (item 2 below, now retired).
  // Trade is no longer a field the planner fills in at all: it's DERIVED from
  // whichever schedule activity the picked Works value names, via
  // `deriveTradeForWorks` — so grouping/filtering by trade (unchanged
  // elsewhere in this file) keeps working without asking the question twice.
  // A photo's trades/works, tolerant of pre-migration rows that only ever
  // had the singular `trade`/`works` text columns filled in, AND of the
  // multi-select era's rows (which may carry more than one value in the
  // array columns) — both still read correctly here.
  function tradesOf(r) { return (r.trades && r.trades.length) ? r.trades : (r.trade ? [r.trade] : []); }
  function worksOf(r) { return (r.works_multi && r.works_multi.length) ? r.works_multi : (r.works ? [r.works] : []); }
  // Reverse of workTypeMatchesTrade: given a Works value, find the schedule
  // activity it names and report which Trade its work_type belongs to. No
  // match (a custom/free-text Works value, or one that predates the
  // schedule) returns null — the photo simply carries no trade, rather than
  // a guessed one.
  function deriveTradeForWorks(worksValue) {
    if (!worksValue) return null;
    var v = String(worksValue).trim().toLowerCase();
    var act = SCHED_ACTS.filter(function (a) { return (a.activity_name || '').trim().toLowerCase() === v; })[0];
    if (!act || !act.work_type) return null;
    return TRADES.filter(function (t) { return workTypeMatchesTrade(act.work_type, t); })[0] || null;
  }
  var WORKS_CUSTOM = '__custom__';
  function worksTagFieldHTML(idPrefix, existingVal) {
    existingVal = existingVal || '';
    var opts = worksOptions();
    if (existingVal && opts.indexOf(existingVal) < 0) opts.push(existingVal);
    opts.sort();
    return '<select class="pd-select" id="' + idPrefix + '-workstag">' +
      '<option value="">— Select —</option>' +
      opts.map(function (v) {
        return '<option value="' + Fmt.esc(v) + '"' + (v === existingVal ? ' selected' : '') + '>' + Fmt.esc(v) + '</option>';
      }).join('') +
      '<option value="' + WORKS_CUSTOM + '">+ Add custom value…</option>' +
    '</select>';
  }
  function wireWorksTagField(idPrefix) {
    var sel = $(idPrefix + '-workstag'); if (!sel) return;
    sel.onchange = function () {
      if (sel.value !== WORKS_CUSTOM) return;
      var v = (window.prompt('New Works value:') || '').trim();
      if (!v) { sel.value = ''; return; }
      var opt = document.createElement('option');
      opt.value = v; opt.textContent = v; opt.selected = true;
      sel.insertBefore(opt, sel.lastElementChild);
    };
  }
  function readWorksTag(idPrefix) {
    var sel = $(idPrefix + '-workstag');
    var v = sel ? sel.value : '';
    return v === WORKS_CUSTOM ? '' : v;
  }
  function fillFilterOptions() {
    function fill(id, list, blank) {
      var el = $(id); if (!el) return;
      var keep = el.value;
      el.innerHTML = '<option value="">' + blank + '</option>' + list.map(function (v) {
        return '<option' + (v === keep ? ' selected' : '') + '>' + Fmt.esc(v) + '</option>';
      }).join('');
      if (list.indexOf(keep) < 0) el.value = '';
    }
    fill('pp-f-trade', distinctMulti('trades', 'trade'), 'Filter by Trade');
    fill('pp-f-works', distinctMulti('works_multi', 'works'), 'Filter by Works');
    renderLocFilterSelects();
  }
  // Distinct values already captured at this level, across this project's
  // own photos.
  function distinctPhotoLocValues(levelId) {
    var seen = {}, out = [];
    rows.forEach(function (r) {
      var v = (r.location_values && r.location_values[levelId]) || '';
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out.sort();
  }
  function renderLocFilterSelects() {
    var host = $('pp-f-loclevels'); if (!host) return;
    if (!LOC_LEVELS.length) { host.innerHTML = ''; return; }
    host.innerHTML = LOC_LEVELS.map(function (l) {
      var cur = filters.locValues[l.id] || '';
      var vals = distinctPhotoLocValues(l.id);
      return '<select class="pd-select" data-lvl="' + l.id + '" title="Filter by ' + Fmt.esc(l.name) + '">' +
        '<option value="">' + Fmt.esc(l.name) + '</option>' +
        vals.map(function (v) { return '<option' + (v === cur ? ' selected' : '') + '>' + Fmt.esc(v) + '</option>'; }).join('') +
        '</select>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('select'), function (sel) {
      sel.onchange = function () { filters.locValues[sel.dataset.lvl] = sel.value; render(); };
    });
  }

  // --------------------------------------------------------------- filter ---
  function visible() {
    var q = filters.search.trim().toLowerCase();
    return rows.filter(function (r) {
      // Archived is hidden unless the toggle is on — same "never both at
      // once" rule as the Presentations list's own archived filter.
      if (!!r.archived !== !!filters.archived) return false;
      // A photo now carries MULTIPLE trades/works (2026-08-29 feedback item
      // 2) -- the filter matches if the picked value is ANY of the row's
      // values, checking both the new array column and the legacy singular
      // one (tradesOf/worksOf), not requiring an exact single-value match.
      if (filters.trade && tradesOf(r).indexOf(filters.trade) < 0) return false;
      if (filters.works && worksOf(r).indexOf(filters.works) < 0) return false;
      // A location filter is satisfied when every ACTIVE level filter matches
      // the photo's own recorded value at that level (AND across levels).
      var lv = r.location_values || {};
      var locOk = Object.keys(filters.locValues || {}).every(function (lid) {
        var want = filters.locValues[lid];
        return !want || (lv[lid] || '') === want;
      });
      if (!locOk) return false;
      if (filters.from && (!r.taken_at || r.taken_at < filters.from)) return false;
      if (filters.to && (!r.taken_at || r.taken_at > filters.to)) return false;
      if (q) {
        var hay = [r.description, r.title].concat(tradesOf(r), worksOf(r), [r.location])
          .join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  // --------------------------------------------------------------- render ---
  function render() {
    var host = $('pp-view');
    var list = visible();
    lightboxIds = list.map(function (r) { return r.id; });
    // Independent of the photo grid's own empty-state branches below (a
    // project can have panoramas/3D scans with zero regular photos, or vice
    // versa), so this runs unconditionally rather than only on the final
    // "has photos" path.
    renderMediaStrip();

    // The count + view toggle live in the static list bar (Drawing Register's
    // .dr-listbar pattern), so they don't get rebuilt on every render.
    var count = $('pp-count');
    if (count) {
      count.textContent = rows.length
        ? 'Showing ' + list.length + ' of ' + rows.length + ' photo' + (rows.length === 1 ? '' : 's')
        : '';
    }
    var listbar = document.querySelector('.pp-listbar');
    if (listbar) listbar.style.visibility = rows.length ? '' : 'hidden';
    // Keep the shared group-by select in step — restoreUI() can change
    // galleryGroupBy on a project switch after wire()'s one-time setup ran.
    if ($('pp-groupby')) $('pp-groupby').value = galleryGroupBy;
    // Group-by has no meaning in Plan (clustered by floor-plan position) or
    // Stack (already grouped by Location Breakdown) — hidden rather than
    // left visible and silently inert.
    var gbField = $('pp-groupby') && $('pp-groupby').closest('.pp-groupby');
    if (gbField) gbField.style.display = (view === 'plan' || view === 'stack') ? 'none' : '';

    // Clear-filters only shows when a filter is actually set (no orphan button).
    var anyFilter = ['from', 'to', 'trade', 'works', 'search'].some(function (k) { return filters[k]; }) ||
      Object.keys(filters.locValues || {}).some(function (k) { return filters.locValues[k]; });
    var clr = $('pp-clearfilters');
    if (clr) clr.hidden = !anyFilter;

    // Plan/Stack read PROJECT-WIDE data (every pin / every location-tagged
    // photo), not the filtered `list` above — the same scope their bim.js
    // originals always had. They bypass the row/filter empty-states below,
    // which describe the filtered Gallery grid and don't apply here (a
    // project can have zero photos matching the current filter and still
    // have a floor plan worth showing, or vice versa).
    if (view === 'plan' || view === 'stack') {
      host.innerHTML = view === 'plan' ? renderPlanView() : renderStackView();
      hydrate(host);
      if (view === 'plan') wirePlanView(); else wireStackView();
      syncChrome();
      return;
    }

    if (!rows.length) {
      host.innerHTML = '<div class="pp-empty">' +
        '<span data-ico="camera" data-ico-size="34"></span>' +
        '<p>No photos yet for this project.</p>' +
        (canWrite ? '<p class="pp-hint">Use <strong>+ Add media</strong> to upload the first batch.</p>' : '') +
        '</div>';
      hydrate(host); syncChrome(); return;
    }
    if (!list.length) {
      host.innerHTML = '<div class="pp-empty"><p>No photos match these filters.</p></div>';
      syncChrome(); return;
    }

    host.innerHTML = (view === 'gallery' ? galleryHTML(list) : listHTML(list));
    hydrate(host);
    wireRows(host);
    syncChrome();
    paintRemote();
  }

  function hydrate(host) { if (window.Icons && Icons.hydrate) Icons.hydrate(host); }

  // ---- Grouping — SHARED by List and Gallery views (2026-08-29 follow-up) --
  // Previously List always grouped by Trade (its own groupByTrade()) and
  // Gallery had a separate Month/Year/Location/Activity picker
  // (groupForGallery()) — two mechanisms, two states, and List's grouping
  // couldn't be changed at all. Owner feedback: "provide option to group by
  // trade or by location or by month... same grouping as the tile view...
  // both no need for the group by year." Year AND Activity are dropped
  // (neither was asked for); Month/Trade/Location now drive BOTH views from
  // one persisted setting, via one #pp-groupby selector in the list bar.
  var MONTH_NAMES = ['January','February','March','April','May','June','July',
    'August','September','October','November','December'];
  var galleryGroupBy = 'month';   // month (default) | trade | location

  // ---- Plan / Stack views (item 16 — relocated here from the Plans tab's
  // own Map/Stack modes, item 15 having removed them from there). Both read
  // project-wide data (every pin / every location-tagged photo), NOT the
  // Gallery's own filtered `list` — the same scope the originals in bim.js
  // always had (they read ProgressPhotos.allPhotos()/locLevels(), which from
  // inside this file is simply `rows`/`LOC_LEVELS` directly).
  var planFloorId = null;                 // which floor_plans row Plan view is showing
  var planMonth = null;                   // 'YYYY-MM' | null = latest month with any pin
  var planPlaying = false, planPlayTimer = null;
  var planFloorPlaying = false, planFloorPlayTimer = null;
  var stackRowLevelId = null, stackColLevelId = null;
  // Item 16: "default is that the photos in the same location combine across
  // all months, but there should also be option to step through and animate
  // through months as well" — REVERSES bim.js's old Stack default (one
  // most-recent-as-of-cutoff photo per cell). Combine is now the default;
  // step-through is an opt-in toggle.
  var stackStepMode = false;
  var stackMonth = null;
  var stackPlaying = false, stackPlayTimer = null;
  function groupKeyOf(r) {
    if (galleryGroupBy === 'trade') {
      // A photo can carry several trades now; it's grouped under its FIRST
      // one only (a row appearing in several groups at once would break the
      // "one row, one place" assumption the collapse state relies on) — the
      // row itself still shows every trade it carries.
      return (tradesOf(r)[0] || '').trim() || 'Untagged';
    }
    if (galleryGroupBy === 'location') return r.location || 'Unassigned';
    // month (default)
    var m = (r.taken_at || '').slice(0, 7);   // YYYY-MM
    return m || 'Undated';
  }
  function groupLabelOf(key) {
    if (galleryGroupBy === 'month' && /^\d{4}-\d{2}$/.test(key)) {
      var parts = key.split('-');
      return MONTH_NAMES[(+parts[1]) - 1] + ' ' + parts[0];
    }
    return key;
  }
  function groupRows(list) {
    var groups = {}, order = [];
    list.forEach(function (r) {
      var k = groupKeyOf(r);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(r);
    });
    // Month: most recent first, "Undated" always trailing (⚠️ a real,
    // pre-existing bug this file's own test found: a plain string sort put
    // "Undated" FIRST, since 'U' sorts after every digit — an undated bucket
    // has no place in a recency ordering and reading it as "most recent"
    // is exactly backwards). Trade/Location: alphabetical, the "nothing
    // tagged" bucket ("Untagged"/"Unassigned") always last.
    var UNTAGGED = { Untagged: 1, Unassigned: 1, Undated: 1 };
    order.sort(function (a, b) {
      var au = !!UNTAGGED[a], bu = !!UNTAGGED[b];
      if (au && !bu) return 1; if (bu && !au) return -1;
      if (au && bu) return 0;
      return galleryGroupBy === 'month' ? b.localeCompare(a) : a.localeCompare(b);
    });
    return order.map(function (k) { return { key: k, label: groupLabelOf(k), items: groups[k] }; });
  }

  // ---------------------------------------------------------- Plan view ----
  // A pin carries no date of its own — it points AT a photo/panorama/3D-scan,
  // and it's THAT item's own capture date that "as of month T" filters on.
  // Ported from bim.js's old itemDateFor (Batch G); photos resolve directly
  // against this file's own `rows`/`byId` rather than through
  // ProgressPhotos.allPhotos(), since this now IS that file.
  function itemDateForPin(pin) {
    var r;
    if (pin.item_type === 'photo') {
      r = byId(pin.item_id);
      return r ? (r.taken_at || (r.created_at || '').slice(0, 10)) : '';
    }
    if (pin.item_type === 'panorama') {
      var pl = (window.PANO && PANO.list) ? PANO.list() : [];
      r = pl.filter(function (x) { return x.id === pin.item_id; })[0];
      return r ? (r.taken_at || (r.created_at || '').slice(0, 10)) : '';
    }
    if (pin.item_type === 'reconstruction') {
      var rl = (window.RECON && RECON.doneList) ? RECON.doneList() : [];
      r = rl.filter(function (x) { return x.id === pin.item_id; })[0];
      return r ? (r.approved_at || r.created_at || '').slice(0, 10) : '';
    }
    return '';
  }
  // Grid-snap clustering, ported verbatim from bim.js's mapClusters — pins
  // within the same ~5% cell of the plan cluster together, deliberately NOT
  // proximity/k-means (a fixed grid is stable frame-to-frame as the month
  // slider moves, so a cluster doesn't visually jump as items enter/leave it).
  var PLAN_CELL = 0.05;
  function planMonthsAvailable(pins) {
    var set = {};
    pins.forEach(function (p) { var d = itemDateForPin(p); if (d) set[d.slice(0, 7)] = true; });
    return Object.keys(set).sort();
  }
  function planClusters(pins, monthCutoff) {
    var byCell = {};
    pins.forEach(function (p) {
      var d = itemDateForPin(p);
      if (monthCutoff && (!d || d.slice(0, 7) > monthCutoff)) return; // "as of" — cumulative up to and including the selected month
      var cx = Math.round(p.x_norm / PLAN_CELL) * PLAN_CELL, cy = Math.round(p.y_norm / PLAN_CELL) * PLAN_CELL;
      var key = cx.toFixed(2) + ',' + cy.toFixed(2);
      (byCell[key] = byCell[key] || { x: cx, y: cy, pins: [] }).pins.push(p);
    });
    return Object.keys(byCell).map(function (k) { return byCell[k]; });
  }
  function planPin(pinId, pins) { return pins.filter(function (p) { return p.id === pinId; })[0] || null; }
  // Opens a SPECIFIC photo's lightbox regardless of whatever the Gallery's
  // own currently-filtered view holds in `lightboxIds`. ⚠️ REAL BUG fixed
  // here (audit pass): Plan/Stack read PROJECT-WIDE data (every pin / every
  // location-tagged photo), so a photo pinned/stacked here can easily be one
  // the active Gallery filter excludes (archived, wrong trade, etc.) — a
  // plain `openLightbox(id)` falls back to index 0 on a miss and silently
  // shows a DIFFERENT photo with no warning, and a Delete from there would
  // hit the wrong record. This is the same fix already exported publicly as
  // `openPhotoById` for bim.js's own Plan-tab pin clicks; extracted to a
  // named function here so Plan/Stack's own clicks route through the exact
  // same safe path instead of duplicating (and this time, missing) the fix.
  function openPhotoById(id) {
    if (!byId(id)) { UI.toast('That photo could not be found', 'warn'); return; }
    lightboxIds = [id];
    openLightbox(id);
  }
  function openPlanPin(pin) {
    if (!pin) return;
    if (pin.item_type === 'panorama') { if (window.PANO && PANO.open) PANO.open(pin.item_id); }
    else if (pin.item_type === 'reconstruction') { if (window.RECON && RECON.openById) RECON.openById(pin.item_id); }
    else if (pin.item_type === 'photo') { openPhotoById(pin.item_id); }
  }
  function openPlanClusterList(cluster) {
    if (!cluster) return;
    var html =
      '<div class="pd-modal-header"><h3>' + cluster.pins.length + ' item' + (cluster.pins.length === 1 ? '' : 's') + ' here</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><div class="ppr-tmpl-picklist">' +
        cluster.pins.map(function (p) {
          return '<button type="button" class="ppr-tmpl-pickrow" data-open="' + p.id + '">' +
            Fmt.esc(p.label || (p.item_type === 'panorama' ? '360° panorama' : p.item_type === 'reconstruction' ? '3D reconstruction' : 'Photo')) +
            (itemDateForPin(p) ? ' — ' + Fmt.esc(itemDateForPin(p)) : '') + '</button>';
        }).join('') +
      '</div></div>';
    var m = openModal(html, 420);
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-open]'), function (b) {
      b.onclick = function () { m.close(); openPlanPin(planPin(this.dataset.open, cluster.pins)); };
    });
  }
  // "choose a floor, step through floors, animate through floors" (item 16) —
  // the genuinely NEW capability the old bim.js Map view didn't have (it only
  // ever showed ONE plan at a time, chosen from a bare <select>, with no
  // stepper). Floors step through BIM.plans()' own order (level_order).
  function planFloors() { return window.BIM ? BIM.plans() : []; }
  function stopPlanFloorPlay() { planFloorPlaying = false; if (planFloorPlayTimer) { clearInterval(planFloorPlayTimer); planFloorPlayTimer = null; } }
  function stopPlanMonthPlay() { planPlaying = false; if (planPlayTimer) { clearInterval(planPlayTimer); planPlayTimer = null; } }
  function renderPlanView() {
    var floors = planFloors();
    if (!floors.length) {
      return '<div class="pp-empty"><span data-ico="compass" data-ico-size="34"></span>' +
        '<p>No floor plans uploaded yet.</p>' +
        (canWrite ? '<p class="pp-hint">Upload one on the <strong>Plans</strong> tab, then place pins linking it ' +
          'to your photos, 360° captures and 3D scans — they\'ll show up here.</p>' : '') + '</div>';
    }
    if (!planFloorId || !floors.some(function (p) { return p.id === planFloorId; })) planFloorId = floors[0].id;
    var floor = floors.filter(function (p) { return p.id === planFloorId; })[0];
    var pins = window.BIM ? BIM.pinsForPlan(planFloorId) : [];
    var months = planMonthsAvailable(pins);
    var cutoff = planMonth || (months.length ? months[months.length - 1] : null);
    var clusters = planClusters(pins, cutoff);
    var url = window.BIM ? BIM.planUrl(floor) : '';
    var aspect = (floor && floor.width_px && floor.height_px) ? (floor.height_px / floor.width_px) : 0.75;
    var pinCount = clusters.reduce(function (n, c) { return n + c.pins.length; }, 0);
    return '<div class="pp-plantoolbar">' +
      '<div class="pp-planfloorbar">' +
        '<label class="pp-planfloorlabel">Floor ' +
          '<select class="pd-select" id="pp-plan-floor">' +
            floors.map(function (p) { return '<option value="' + Fmt.esc(p.id) + '"' + (p.id === planFloorId ? ' selected' : '') + '>' + Fmt.esc(p.name) + '</option>'; }).join('') +
          '</select></label>' +
        '<button class="pp-iconbtn" id="pp-plan-floorprev" title="Previous floor">‹</button>' +
        '<button class="pp-iconbtn" id="pp-plan-floornext" title="Next floor">›</button>' +
        '<button class="pd-btn" id="pp-plan-floorplay">' + (planFloorPlaying ? 'Stop' : '▶ Animate floors') + '</button>' +
      '</div>' +
      (months.length
        ? '<div class="pp-planmonthbar">' +
            '<button class="pp-iconbtn" id="pp-plan-mprev" title="Earlier month">‹</button>' +
            '<strong>' + (cutoff ? Fmt.esc(cutoff) : 'All') + '</strong>' +
            '<button class="pp-iconbtn" id="pp-plan-mnext" title="Later month">›</button>' +
            '<button class="pd-btn" id="pp-plan-mplay">' + (planPlaying ? 'Stop' : '▶ Play') + '</button>' +
            '<span class="pp-hint">as of the end of this month · ' + pinCount + ' pinned item' + (pinCount === 1 ? '' : 's') + '</span>' +
          '</div>'
        : '<p class="pp-hint">No dated captures pinned on this floor yet.</p>') +
    '</div>' +
    '<div class="pp-planstage">' +
      '<div class="pp-planimgwrap" style="padding-bottom:' + (aspect * 100) + '%;">' +
        (url ? '<img src="' + Fmt.esc(url) + '" draggable="false" />' : '<div class="pp-empty" style="position:absolute;inset:0;">Plan image not available</div>') +
        clusters.map(function (c, i) {
          // ⚠️ Audit fix: the only visible content was the bare pin count,
          // which a screen reader announces as just a number with no sense
          // of what the button does.
          return '<button class="pp-plancluster" data-cluster="' + i + '" style="left:' + (c.x * 100) + '%;top:' + (c.y * 100) + '%;" ' +
            'aria-label="' + c.pins.length + ' item' + (c.pins.length === 1 ? '' : 's') + ' at this location — view">' + c.pins.length + '</button>';
        }).join('') +
      '</div>' +
    '</div>';
  }
  function wirePlanView() {
    var floors = planFloors();
    if (!floors.length) return;
    var idx = floors.map(function (p) { return p.id; }).indexOf(planFloorId);
    if ($('pp-plan-floor')) $('pp-plan-floor').onchange = function () { planFloorId = this.value; planMonth = null; render(); };
    if ($('pp-plan-floorprev')) $('pp-plan-floorprev').onclick = function () {
      planFloorId = floors[Math.max(0, idx - 1)].id; planMonth = null; render();
    };
    if ($('pp-plan-floornext')) $('pp-plan-floornext').onclick = function () {
      planFloorId = floors[Math.min(floors.length - 1, idx + 1)].id; planMonth = null; render();
    };
    if ($('pp-plan-floorplay')) $('pp-plan-floorplay').onclick = function () {
      if (planFloorPlaying) { stopPlanFloorPlay(); render(); return; }
      stopPlanMonthPlay();   // never both animations running at once
      planFloorPlaying = true;
      planFloorPlayTimer = setInterval(function () {
        var fs = planFloors();
        var i = fs.map(function (p) { return p.id; }).indexOf(planFloorId);
        if (i >= fs.length - 1) { stopPlanFloorPlay(); render(); return; } // auto-stop at the end, same convention as every other time-scrub view in this app
        planFloorId = fs[i + 1].id; planMonth = null; render();
      }, 1200);
      render();
    };
    var pins = window.BIM ? BIM.pinsForPlan(planFloorId) : [];
    var months = planMonthsAvailable(pins);
    var cutoff = planMonth || (months.length ? months[months.length - 1] : null);
    var clusters = planClusters(pins, cutoff);
    if ($('pp-plan-mprev')) $('pp-plan-mprev').onclick = function () {
      var i = months.indexOf(cutoff); planMonth = months[Math.max(0, i - 1)]; render();
    };
    if ($('pp-plan-mnext')) $('pp-plan-mnext').onclick = function () {
      var i = months.indexOf(cutoff); planMonth = months[Math.min(months.length - 1, i + 1)]; render();
    };
    if ($('pp-plan-mplay')) $('pp-plan-mplay').onclick = function () {
      if (planPlaying) { stopPlanMonthPlay(); render(); return; }
      stopPlanFloorPlay();
      planPlaying = true;
      planPlayTimer = setInterval(function () {
        var ms = planMonthsAvailable(pins);
        var i = ms.indexOf(planMonth || (ms.length ? ms[ms.length - 1] : null));
        if (i >= ms.length - 1) { stopPlanMonthPlay(); render(); return; }
        planMonth = ms[i + 1]; render();
      }, 900);
      render();
    };
    Array.prototype.forEach.call(document.querySelectorAll('#pp-view [data-cluster]'), function (btn) {
      btn.onclick = function () { openPlanClusterList(clusters[+this.dataset.cluster]); };
    });
  }

  // --------------------------------------------------------- Stack view ----
  // Independent of floor plans entirely — bands come from the project's
  // Location Breakdown (LOC_LEVELS), the same schedule-derived Tower/Level/
  // Zone hierarchy the Add-photo form cascades through. Reachable even with
  // zero floor plans uploaded.
  function stackLevels() { return LOC_LEVELS.slice(); }
  function stackRowLevel() {
    var levels = stackLevels();
    return levels.filter(function (l) { return l.id === stackRowLevelId; })[0] || levels[0] || null;
  }
  function stackColLevel() {
    var levels = stackLevels();
    var picked = levels.filter(function (l) { return l.id === stackColLevelId; })[0];
    if (picked) return picked;
    return levels.filter(function (l) { return l.id !== (stackRowLevel() && stackRowLevel().id); })[0] || null;
  }
  function stackMonthsAvailable() {
    var set = {};
    rows.forEach(function (p) { if (p.taken_at) set[String(p.taken_at).slice(0, 7)] = true; });
    return Object.keys(set).sort();
  }
  // Pure — the actual "as of" decision for one grid cell in step mode, worth
  // genuinely EXECUTING (same reasoning as planClusters' own cutoff filter):
  // given photos already narrowed to one location cell, returns the most
  // recent one at-or-before `cutoff` ('YYYY-MM', or null = latest overall),
  // or null when nothing in the list qualifies.
  function mostRecentAsOf(list, cutoff) {
    var best = null;
    list.forEach(function (p) {
      if (!p.taken_at) return;
      if (cutoff && String(p.taken_at).slice(0, 7) > cutoff) return;
      if (!best || String(p.taken_at) > String(best.taken_at)) best = p;
    });
    return best;
  }
  // A cell reports EVERY matching photo (item 16's combined default) plus,
  // when step mode is on, which one of those is "the" photo as of `cutoff`.
  function stackGrid(cutoff) {
    var rowLevel = stackRowLevel(), colLevel = stackColLevel();
    if (!rowLevel) return { rowLevel: null, colLevel: null, cols: [], rows: [] };
    var rowVals = {}, colVals = {};
    rows.forEach(function (p) {
      var lv = p.location_values || {};
      var rv = lv[rowLevel.id]; if (rv) rowVals[rv] = true;
      if (colLevel) { var cv = lv[colLevel.id]; if (cv) colVals[cv] = true; }
    });
    var rowNames = Object.keys(rowVals).sort();
    var colNames = colLevel ? Object.keys(colVals).sort() : [];
    if (!colNames.length) colNames = [''];  // single-level project — one shared "All" column
    var gridRows = rowNames.map(function (rv) {
      return {
        row: rv,
        cells: colNames.map(function (cv) {
          var candidates = rows.filter(function (p) {
            var lv = p.location_values || {};
            if ((lv[rowLevel.id] || '') !== rv) return false;
            if (colLevel && cv && (lv[colLevel.id] || '') !== cv) return false;
            return true;
          });
          return { col: cv, photos: candidates, photo: mostRecentAsOf(candidates, cutoff) };
        })
      };
    });
    return { rowLevel: rowLevel, colLevel: colLevel, cols: colNames, rows: gridRows };
  }
  var STACK_COMBINE_MAX = 6;   // thumbnails shown per cell before "+N more"
  function renderStackView() {
    var levels = stackLevels();
    if (!levels.length) {
      return '<div class="pp-empty"><p>No Location Breakdown set up for this project yet — build it in ' +
        'Project Schedule (Group menu &rarr; Location Breakdown&hellip;), then photos tagged against it ' +
        'will stack here.</p></div>';
    }
    var months = stackMonthsAvailable();
    var cutoff = stackMonth || (months.length ? months[months.length - 1] : null);
    var g = stackGrid(cutoff);
    var levelPickers =
      '<div class="pp-stacklevels">' +
        '<label>Rows <select class="pd-select" id="pp-stack-rowlvl">' +
          levels.map(function (l) { return '<option value="' + Fmt.esc(l.id) + '"' + (g.rowLevel && l.id === g.rowLevel.id ? ' selected' : '') + '>' + Fmt.esc(l.name) + '</option>'; }).join('') +
        '</select></label>' +
        (levels.length > 1 ? '<label>Columns <select class="pd-select" id="pp-stack-collvl">' +
          levels.map(function (l) { return '<option value="' + Fmt.esc(l.id) + '"' + (g.colLevel && l.id === g.colLevel.id ? ' selected' : '') + '>' + Fmt.esc(l.name) + '</option>'; }).join('') +
        '</select></label>' : '') +
        '<label class="ppr-allloc" style="display:inline-flex;align-items:center;gap:5px;margin:0;">' +
          '<input type="checkbox" id="pp-stack-stepmode"' + (stackStepMode ? ' checked' : '') + ' /> Step through months instead</label>' +
      '</div>';
    var stepper = stackStepMode
      ? (months.length
          ? '<div class="pp-planmonthbar">' +
              '<button class="pp-iconbtn" id="pp-stack-mprev" title="Earlier month">‹</button>' +
              '<strong>' + (cutoff ? Fmt.esc(cutoff) : 'All') + '</strong>' +
              '<button class="pp-iconbtn" id="pp-stack-mnext" title="Later month">›</button>' +
              '<button class="pd-btn" id="pp-stack-mplay">' + (stackPlaying ? 'Stop' : '▶ Play') + '</button>' +
              '<span class="pp-hint">as of the end of this month</span></div>'
          : '<p class="pp-hint">No dated, location-tagged photos yet.</p>')
      : '<p class="pp-hint">Every photo captured at each location, combined across all months.</p>';
    if (!g.rows.length) {
      return levelPickers + stepper + '<div class="pp-empty"><p>No photos have been tagged at this Location Breakdown level yet.</p></div>';
    }
    var table =
      '<div class="pp-stackwrap"><table class="pp-stacktable"><thead><tr><th></th>' +
        g.cols.map(function (c) { return '<th>' + Fmt.esc(c || 'All') + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      g.rows.map(function (r) {
        return '<tr><th>' + Fmt.esc(r.row) + '</th>' +
          r.cells.map(function (c) {
            if (stackStepMode) {
              if (!c.photo) return '<td class="pp-stackcell pp-stackcell-empty">—</td>';
              var url = urlOf(c.photo);
              var cap = r.row + (c.col ? ' · ' + c.col : '') + ' — ' + (c.photo.taken_at || '');
              return '<td class="pp-stackcell">' +
                (url ? '<img class="pp-stackthumb" data-magnify="' + Fmt.esc(url) + '" data-cap="' + Fmt.esc(cap) + '" src="' + Fmt.esc(url) + '" alt="" />' : '—') +
              '</td>';
            }
            // Combined default (item 16) — every matching photo, not just the latest one.
            if (!c.photos.length) return '<td class="pp-stackcell pp-stackcell-empty">—</td>';
            var shown = c.photos.slice(0, STACK_COMBINE_MAX);
            return '<td class="pp-stackcell"><div class="pp-stackcellphotos">' +
              shown.map(function (p) {
                var u = urlOf(p);
                return u ? '<img class="pp-stackthumb pp-stackthumb-sm" data-open="' + p.id + '" src="' + Fmt.esc(u) + '" alt="" title="' + Fmt.esc(p.taken_at || '') + '" />' : '';
              }).join('') +
              (c.photos.length > STACK_COMBINE_MAX ? '<span class="pp-stackmore">+' + (c.photos.length - STACK_COMBINE_MAX) + '</span>' : '') +
            '</div></td>';
          }).join('') +
        '</tr>';
      }).join('') +
      '</tbody></table></div>' +
      (stackStepMode
        // A basic hover-magnifier — deliberately simpler than Project
        // Schedule's own SVG-clone version: these cells are plain <img>
        // thumbnails, so swapping a larger src into a docked panel is enough.
        ? '<div class="pp-stackmag" id="pp-stack-mag" hidden><img id="pp-stack-magimg" alt="" /><div class="pp-stackmagcap" id="pp-stack-magcap"></div></div>'
        : '');
    return levelPickers + stepper + table;
  }
  function stopStackPlay() { stackPlaying = false; if (stackPlayTimer) { clearInterval(stackPlayTimer); stackPlayTimer = null; } }
  function wireStackView() {
    if ($('pp-stack-rowlvl')) $('pp-stack-rowlvl').onchange = function () { stackRowLevelId = this.value; render(); };
    if ($('pp-stack-collvl')) $('pp-stack-collvl').onchange = function () { stackColLevelId = this.value; render(); };
    if ($('pp-stack-stepmode')) $('pp-stack-stepmode').onchange = function () {
      stackStepMode = this.checked; stopStackPlay(); render();
    };
    if (stackStepMode) {
      var months = stackMonthsAvailable();
      var cutoff = stackMonth || (months.length ? months[months.length - 1] : null);
      if ($('pp-stack-mprev')) $('pp-stack-mprev').onclick = function () {
        var i = months.indexOf(cutoff); stackMonth = months[Math.max(0, i - 1)]; render();
      };
      if ($('pp-stack-mnext')) $('pp-stack-mnext').onclick = function () {
        var i = months.indexOf(cutoff); stackMonth = months[Math.min(months.length - 1, i + 1)]; render();
      };
      if ($('pp-stack-mplay')) $('pp-stack-mplay').onclick = function () {
        if (stackPlaying) { stopStackPlay(); render(); return; }
        stackPlaying = true;
        stackPlayTimer = setInterval(function () {
          var ms = stackMonthsAvailable();
          var i = ms.indexOf(stackMonth || (ms.length ? ms[ms.length - 1] : null));
          if (i >= ms.length - 1) { stopStackPlay(); render(); return; } // auto-stop at the end
          stackMonth = ms[i + 1]; render();
        }, 900);
        render();
      };
      var mag = $('pp-stack-mag'), magImg = $('pp-stack-magimg'), magCap = $('pp-stack-magcap');
      if (mag) {
        Array.prototype.forEach.call(document.querySelectorAll('#pp-view [data-magnify]'), function (im) {
          im.addEventListener('mouseenter', function () { magImg.src = im.dataset.magnify; magCap.textContent = im.dataset.cap || ''; mag.hidden = false; });
          im.addEventListener('mouseleave', function () { mag.hidden = true; });
        });
      }
    } else {
      // Combined mode — each thumbnail opens the ordinary lightbox, same as
      // every other photo thumbnail in this module.
      Array.prototype.forEach.call(document.querySelectorAll('#pp-view [data-open]'), function (im) {
        im.onclick = function () { openPhotoById(this.dataset.open); };
      });
    }
  }

  function thumb(r, cls) {
    var u = urlOf(r);
    var isVideo = r.media_type === 'video';
    if (!u) return '<div class="' + cls + ' pp-noimg" title="Preview unavailable">' +
                   '<span data-ico="camera" data-ico-size="18"></span></div>';
    if (isVideo) {
      // preload="metadata" shows the video's first frame as a thumbnail at
      // negligible bandwidth cost, without playing dozens of clips at once in
      // a grid — real playback only happens once opened in the lightbox.
      return '<span class="pp-vidthumb ' + cls + '-wrap" data-act="open" data-id="' + r.id + '">' +
        '<video class="' + cls + '" preload="metadata" muted playsinline src="' + Fmt.esc(u) + '"></video>' +
        '<span class="pp-vidplay"></span></span>';
    }
    return '<img class="' + cls + '" src="' + Fmt.esc(u) + '" loading="lazy" ' +
           'alt="' + Fmt.esc(r.description || 'Progress photo') + '" data-act="open" data-id="' + r.id + '" />';
  }

  function listHTML(list) {
    // A leading select-all checkbox (item 4 — replaces the old separate
    // "Clear" button in the removed selection bar) plus one cell per data
    // column. The trailing action-icons column is GONE (item 7: "no need for
    // the buttons per row... upon opening the photo, the photos should be
    // fine" — the lightbox's own download/edit/delete cluster covers it),
    // so the header and every row branch below now share 7 cells, not 8.
    var vis = list.filter(function (r) { return !!r; });
    var allSelected = vis.length > 0 && vis.every(function (r) { return selected[r.id]; });
    var head = '<div class="pp-grid-head">' +
      '<div class="pp-cell pp-selcell"><input type="checkbox" id="pp-selall"' +
        (allSelected ? ' checked' : '') + ' title="Select all shown" /></div>' +
      '<div>Photo</div><div>Description</div><div>Trade</div><div>Works</div>' +
      '<div>Location</div><div>Capture Date</div></div>';

    var body = groupRows(list).map(function (g) {
      var isCol = !!collapsed[g.key];
      var header = '<div class="pp-group" data-group="' + Fmt.esc(g.key) + '">' +
        '<span class="pp-caret" data-ico="' + (isCol ? 'chevronRight' : 'chevronDown') + '" data-ico-size="14"></span>' +
        '<strong>' + Fmt.esc(g.label) + '</strong>' +
        '<span class="pp-groupcount">' + g.items.length + '</span></div>';
      if (isCol) return header;
      return header + g.items.map(function (r) {
        // data-l = the column's label. Unused on desktop (the sticky .pp-grid-head
        // supplies the headings); at phone width the head is hidden and the row
        // restacks under the thumbnail, where each value needs its own label —
        // module.css renders these via .pp-cell[data-l]::before.
        // Clicking the row opens the lightbox (item 7); the checkbox stops that
        // click from bubbling (wired in wireRows) so selecting never opens it.
        return '<div class="pp-row' + (selected[r.id] ? ' pp-selrow' : '') + '" data-id="' + r.id + '" data-rowopen="' + r.id + '">' +
          '<div class="pp-cell pp-selcell"><input type="checkbox" data-sel="' + r.id + '" aria-label="Select ' +
            Fmt.esc(r.description || 'this photo') + '"' +
            (selected[r.id] ? ' checked' : '') + ' /></div>' +
          '<div class="pp-cell pp-thumbcell">' + thumb(r, 'pp-thumb') + '</div>' +
          '<div class="pp-cell pp-desc">' + Fmt.esc(r.description || '—') + '</div>' +
          '<div class="pp-cell" data-l="Trade">' + Fmt.esc(tradesOf(r).join(', ') || '—') + '</div>' +
          '<div class="pp-cell" data-l="Works">' + Fmt.esc(worksOf(r).join(', ') || '—') + '</div>' +
          '<div class="pp-cell" data-l="Location">' + Fmt.esc(r.location || '—') + '</div>' +
          '<div class="pp-cell pp-date" data-l="Captured">' + (r.taken_at ? Fmt.date(r.taken_at) : '—') + '</div>' +
          '</div>';
      }).join('');
    }).join('');

    return '<div class="pp-grid">' + head + body + '</div>';
  }

  // Tile view: just the photo -- no description/table, no action icons on the
  // tile itself (owner feedback). Download/view/edit/delete live in the
  // lightbox once a photo is opened. Grouping is picked from the SHARED
  // #pp-groupby selector in the list bar (index.html) now, not a picker of
  // its own — see groupRows()'s own comment.
  function galleryHTML(list) {
    var body = groupRows(list).map(function (g) {
      return '<div class="pp-gallerygroup">' +
        '<div class="pp-gallerygrouphead"><strong>' + Fmt.esc(g.label) + '</strong>' +
          '<span class="pp-groupcount">' + g.items.length + '</span></div>' +
        '<div class="pp-gallery">' + g.items.map(function (r) {
          // Batch E item 8: a small expand icon appears ONLY when this photo
          // has a floor-plan pin — never shown speculatively, since most
          // photos won't have one and an always-present-but-usually-inert
          // icon reads as broken. BIM.pinInfoFor may not have data yet on the
          // very first paint (its own project load races this one) — the
          // icon simply appears on the next render once it does, same
          // trade-off this module already accepts for the 360°/3D strip.
          var hasPin = window.BIM && BIM.pinInfoFor && BIM.pinInfoFor('photo', r.id);
          return '<figure class="pp-card' + (selected[r.id] ? ' pp-selrow' : '') + '" data-id="' + r.id + '">' +
            '<span class="pp-cardsel"><input type="checkbox" data-sel="' + r.id + '" aria-label="Select ' +
              Fmt.esc(r.description || 'this photo') + '"' +
              (selected[r.id] ? ' checked' : '') + ' /></span>' +
            (hasPin ? '<button type="button" class="pp-pinbtn" data-pinpreview="' + r.id + '" ' +
              'title="Show this photo\'s position on the floor plan">' +
              '<span data-ico="mapPin" data-ico-size="13"></span></button>' : '') +
            '<div class="pp-cardimg">' + thumb(r, 'pp-cardphoto') + '</div>' +
          '</figure>';
        }).join('') + '</div></div>';
    }).join('');
    return body;
  }

  // Batch E item 8 — a cropped/zoomed view of the floor plan centred on this
  // photo's pin, with a Tight/Wide toggle (interpreted as two crop levels,
  // since a literal "1/8 or 1/4 of the tile's own pixel size" would render an
  // impractically tiny overlay on a small Gallery thumbnail). The centring
  // math: an image positioned at left:50%/top:50% of the container, then
  // translated by -(x_norm*100%, y_norm*100%) of ITS OWN box (not the
  // container's — percentage transforms are always relative to the
  // transformed element itself), places the point at (x_norm,y_norm) of the
  // image exactly at the container's centre regardless of zoom level.
  function openPinPreview(photoId) {
    if (!window.BIM || !BIM.pinInfoFor) return;
    var info = BIM.pinInfoFor('photo', photoId);
    if (!info || !info.planUrl) { UI.toast('That floor plan image is not available', 'warn'); return; }
    var tight = true;
    function bodyHTML() {
      var zoomPct = tight ? 700 : 350;
      var dir = info.pin.direction_deg;
      var hasDir = dir !== null && dir !== undefined;
      return '<div class="pp-pinpreview-box">' +
        '<img src="' + Fmt.esc(info.planUrl) + '" style="position:absolute;left:50%;top:50%;width:' + zoomPct +
          '%;max-width:none;transform:translate(-' + (info.pin.x_norm * 100) + '%,-' + (info.pin.y_norm * 100) + '%);" alt="" />' +
        (hasDir ? '<div class="pp-pinpreview-cone" style="transform:translate(-50%,-100%) rotate(' + dir + 'deg);"></div>' : '') +
        '<div class="pp-pinpreview-dot"></div>' +
      '</div>';
    }
    var html =
      '<div class="pd-modal-header"><h3>' + Fmt.esc(info.planName || 'Floor plan') + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<div id="pp-pinpreview-host">' + bodyHTML() + '</div>' +
        '<div class="pp-pinpreview-zoom">' +
          '<button type="button" class="pd-btn' + (tight ? ' pd-btn-primary' : '') + '" id="pp-pinpreview-tight">Tight</button>' +
          '<button type="button" class="pd-btn' + (!tight ? ' pd-btn-primary' : '') + '" id="pp-pinpreview-wide">Wide</button>' +
        '</div>' +
      '</div>';
    var m = openModal(html, 420);
    function refresh() {
      $('pp-pinpreview-host').innerHTML = bodyHTML();
      $('pp-pinpreview-tight').classList.toggle('pd-btn-primary', tight);
      $('pp-pinpreview-wide').classList.toggle('pd-btn-primary', !tight);
    }
    $('pp-pinpreview-tight').onclick = function () { tight = true; refresh(); };
    $('pp-pinpreview-wide').onclick = function () { tight = false; refresh(); };
  }

  // -------------------------------------------------------- 360°/3D media strip
  // Folded into the Gallery screen (2026-08-29 feedback: "Rounds can be
  // removed. 360 and 3D should be incorporated in the Gallery") rather than
  // interleaved into the photo grid itself. Panoramas and reconstructions are
  // a different SHAPE of record (no trade/works, a different open-viewer of
  // their own, no lightbox arrow-navigation), so merging them into
  // visible()/thumb()/wireRows() would risk the well-tested photo pipeline
  // for a presentational preference. This strip renders below the photo grid
  // -- same screen, same scroll, no separate tab -- reads the SAME
  // location/date/search filters as the grid (never Trade/Works, which don't
  // apply to either kind), and is entirely absent from the DOM when there's
  // nothing to show rather than an empty heading. PANO.list()/RECON.doneList()
  // and PANO.ensureLoaded/RECON.ensureLoaded (called from load(), below) are
  // what make this possible without a second fetch cycle owned by this file.
  function mediaStripMatches(item) {
    var lv = item.location_values || {};
    var locOk = Object.keys(filters.locValues || {}).every(function (lid) {
      var want = filters.locValues[lid];
      return !want || (lv[lid] || '') === want;
    });
    if (!locOk) return false;
    var d = item.taken_at || (item.created_at || '').slice(0, 10);
    if (filters.from && (!d || d < filters.from)) return false;
    if (filters.to && (!d || d > filters.to)) return false;
    var q = filters.search.trim().toLowerCase();
    if (q && (item.location || '').toLowerCase().indexOf(q) < 0) return false;
    return true;
  }
  function mediaStripItems() {
    var panos = (window.PANO && PANO.list ? PANO.list() : []).filter(mediaStripMatches)
      .map(function (p) { return { _kind: 'panorama', _src: p }; });
    var recons = (window.RECON && RECON.doneList ? RECON.doneList() : []).filter(mediaStripMatches)
      .map(function (r) { return { _kind: 'reconstruction', _src: r }; });
    return panos.concat(recons);
  }
  function mediaStripHTML() {
    var items = mediaStripItems();
    if (!items.length) return '';
    return '<div class="pp-mediastrip">' +
      '<div class="pp-mediastriphead"><strong>360&deg; &amp; 3D captures</strong>' +
        '<span class="pp-groupcount">' + items.length + '</span></div>' +
      '<div class="pp-mediastripgrid">' + items.map(function (it) {
        var r = it._src;
        var isPano = it._kind === 'panorama';
        var u = isPano && window.PANO && PANO.urlOf ? PANO.urlOf(r) : '';
        var label = isPano ? '360° panorama' : '3D scan';
        var date = r.taken_at || r.created_at || '';
        return '<button type="button" class="pp-mediatile" data-kind="' + it._kind + '" data-id="' + Fmt.esc(r.id) + '" title="' + Fmt.esc(label) + '">' +
          (u ? '<img src="' + Fmt.esc(u) + '" alt="" />' :
               '<span class="pp-mediatile-ico" data-ico="' + (isPano ? 'compass' : 'box') + '" data-ico-size="22"></span>') +
          '<span class="pp-mediatile-badge">' + Fmt.esc(isPano ? '360°' : '3D') + '</span>' +
          '<span class="pp-mediatile-cap">' + Fmt.esc(r.location || 'Unassigned') + (date ? ' · ' + Fmt.esc(Fmt.date(date)) : '') + '</span>' +
          '</button>';
      }).join('') + '</div></div>';
  }
  function wireMediaStrip(host) {
    Array.prototype.forEach.call(host.querySelectorAll('.pp-mediatile'), function (b) {
      b.onclick = function () {
        var id = this.dataset.id;
        if (this.dataset.kind === 'panorama') { if (window.PANO && PANO.open) PANO.open(id); }
        else { if (window.RECON && RECON.openById) RECON.openById(id); }
      };
    });
  }
  function renderMediaStrip() {
    var host = $('pp-media-strip');
    if (!host) return;
    host.innerHTML = mediaStripHTML();
    hydrate(host);
    wireMediaStrip(host);
  }

  function wireRows(host) {
    Array.prototype.forEach.call(host.querySelectorAll('.pp-group'), function (g) {
      g.onclick = function () {
        var k = g.dataset.group;
        collapsed[k] = !collapsed[k];
        saveUI(); render();
      };
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-act]'), function (el) {
      el.onclick = function (e) {
        e.stopPropagation();
        var r = byId(el.dataset.id); if (!r) return;
        var a = el.dataset.act;
        if (a === 'open') openLightbox(r.id);
        else if (a === 'download') download(r);
        else if (a === 'edit') openForm(r);
        else if (a === 'del') remove(r);
      };
    });
    // Item 7 — the List row itself opens the lightbox (per-row action icons
    // are gone: "upon opening the photo, the photos should be fine" — the
    // lightbox's own download/edit/delete cluster covers what those icons
    // used to). Clicks starting on the select checkbox are excluded so
    // ticking a box never also opens the photo.
    Array.prototype.forEach.call(host.querySelectorAll('[data-rowopen]'), function (row) {
      row.onclick = function (e) {
        if (e.target.closest('.pp-selcell')) return;
        openLightbox(this.dataset.rowopen);
      };
    });
    // Batch E item 8 — the expandable key-plan-style pin icon on a Gallery tile.
    Array.prototype.forEach.call(host.querySelectorAll('[data-pinpreview]'), function (btn) {
      btn.onclick = function (e) { e.stopPropagation(); openPinPreview(this.dataset.pinpreview); };
    });
    // Batch select (follow-up feedback item 5) — one checkbox per row/tile,
    // in both List and Gallery views (they're two displays of the same
    // Gallery screen, so a selection made in one shouldn't be view-specific).
    Array.prototype.forEach.call(host.querySelectorAll('[data-sel]'), function (cb) {
      cb.onchange = function () {
        if (this.checked) selected[this.dataset.sel] = true; else delete selected[this.dataset.sel];
        var card = this.closest('.pp-row, .pp-card');
        if (card) card.classList.toggle('pp-selrow', this.checked);
        syncChrome();
      };
    });
    // Item 4 — select/unselect ALL currently visible rows, replacing the old
    // separate "Clear" button. Scoped to visible() (the same filtered set
    // the header checkbox's own "all checked?" state reflects), not the
    // raw `selected` map, matching visibleSelectedIds()' own rule.
    var selAll = host.querySelector('#pp-selall');
    if (selAll) selAll.onchange = function () {
      var on = this.checked;
      visible().forEach(function (r) { if (on) selected[r.id] = true; else delete selected[r.id]; });
      render();
    };
  }
  function byId(id) { return rows.filter(function (r) { return r.id === id; })[0]; }

  // -------------------------------------------------------- batch select ----
  // Scoped to the currently VISIBLE (filtered) set, not the raw `selected`
  // map — a selection made under one filter must not silently act on rows a
  // since-changed filter no longer shows (Drawing Register's own bulk-select
  // bar was bitten by exactly this and documents the fix; the same rule
  // applies here).
  function visibleSelectedIds() {
    var vis = {}; visible().forEach(function (r) { vis[r.id] = true; });
    return Object.keys(selected).filter(function (id) { return vis[id]; });
  }
  // ⚠️ There used to be a separate refreshSelBar()/#pp-selbar element toggled
  // via the `hidden` ATTRIBUTE, but `.pp-selbar { display: flex }` in
  // module.css sat at the SAME specificity as the UA's `[hidden] {
  // display:none }` rule and, being an AUTHOR rule, always won regardless of
  // `hidden` — so the bar showed "0 selected" permanently no matter what the
  // JS did (screenshot: 2026-08-29). The whole element is gone now (moved
  // into the topbar tools row, toggled via syncChrome()'s explicit
  // `style.display`, never the `hidden` attribute), which sidesteps that bug
  // class entirely rather than just patching this one instance of it.
  function wireSelBar() {
    // Item 5: choose a format instead of downloading each raw file — mirrors
    // ppr.js's own openDownloadChoice for presentations, so "Download" means
    // the same thing (pick HTML/PDF/PPTX) everywhere in this module.
    if ($('pp-sel-download')) $('pp-sel-download').onclick = function () {
      openBatchDownloadChoice(visibleSelectedIds());
    };
    if ($('pp-sel-archive')) $('pp-sel-archive').onclick = async function () {
      var ids = visibleSelectedIds();
      if (!ids.length) return;
      var res = await sb().from(TABLE).update({ archived: true }).in('id', ids);
      if (res.error) {
        if (/column .* does not exist|schema cache/i.test(res.error.message || '')) {
          UI.toast('Archiving needs a pending migration — run migrations/2026-08-29-archive-flag.sql', 'warn');
        } else UI.toast(res.error.message, 'error');
        return;
      }
      UI.toast(ids.length + ' photo' + (ids.length === 1 ? '' : 's') + ' archived', 'ok');
      selected = {};
      await load();
    };
    if ($('pp-sel-addppr')) $('pp-sel-addppr').onclick = function () {
      var ids = visibleSelectedIds();
      if (!ids.length) return;
      openAddToPresentation(ids);
    };
  }

  // Picks (or creates) a presentation, then adds every selected photo as a
  // new slide's Current photo via PPR.addPhotosToPresentation — the write
  // itself lives in ppr.js (the one place that already owns ppr_slides'
  // shape/numbering), this just supplies which photos and which target.
  function openAddToPresentation(photoIds) {
    if (!window.PPR || !PPR.listForPicker) { UI.toast('Presentations are not available right now', 'error'); return; }
    var list = PPR.listForPicker();
    var html =
      '<div class="pd-modal-header"><h3>Add ' + photoIds.length + ' photo' + (photoIds.length === 1 ? '' : 's') +
        ' to a presentation</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        (list.length
          ? '<div class="pd-field"><label>Presentation</label>' +
            '<select class="pd-select" id="pp-a2p-select">' +
              list.map(function (p) { return '<option value="' + Fmt.esc(p.id) + '">' + Fmt.esc(p.description || p.ppr_date || p.id) + '</option>'; }).join('') +
            '</select></div>'
          : '<p class="pp-hint">No presentations yet — one will be created.</p>') +
        '<div class="pd-field"><label>Or create a new presentation, dated</label>' +
          '<input class="pd-input" type="date" id="pp-a2p-newdate" value="' + new Date().toISOString().slice(0, 10) + '" /></div>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="pp-a2p-go">Add</button></div>';
    var m = openModal(html, 480);
    $('pp-a2p-go').onclick = async function () {
      this.disabled = true;
      var pprId = $('pp-a2p-select') ? $('pp-a2p-select').value : '';
      if (!pprId) {
        var date = $('pp-a2p-newdate').value;
        if (!date) { UI.toast('Pick a date for the new presentation', 'warn'); this.disabled = false; return; }
        var ires = await sb().from('ppr_presentations').insert({ ppr_date: date, project_id: pid, created_by: uid }).select();
        if (ires.error) { UI.toast(ires.error.message, 'error'); this.disabled = false; return; }
        pprId = ires.data && ires.data[0] && ires.data[0].id;
      }
      if (!pprId) { UI.toast('Could not determine a presentation to add to', 'error'); this.disabled = false; return; }
      var res = await PPR.addPhotosToPresentation(pprId, photoIds);
      if (!res.ok) { UI.toast(res.error || 'Could not add photos', 'error'); this.disabled = false; return; }
      m.close();
      UI.toast(res.count + ' photo' + (res.count === 1 ? '' : 's') + ' added as new slides', 'ok');
      selected = {}; render();
    };
  }

  // ------------------------------------------------------------- lightbox ---
  function openLightbox(id) {
    lightboxAt = lightboxIds.indexOf(id);
    if (lightboxAt < 0) lightboxAt = 0;
    paintLightbox();
    $('pp-lightbox').hidden = false;
  }
  function closeLightbox() {
    $('pp-lightbox').hidden = true;
    var vidEl = $('pp-lb-video'); if (vidEl) { vidEl.pause(); vidEl.src = ''; }
  }
  function stepLightbox(d) {
    if (!lightboxIds.length) return;
    lightboxAt = (lightboxAt + d + lightboxIds.length) % lightboxIds.length;
    paintLightbox();
  }
  function paintLightbox() {
    var r = byId(lightboxIds[lightboxAt]); if (!r) return;
    var u = urlOf(r);
    var isVideo = r.media_type === 'video';
    var imgEl = $('pp-lb-img'), vidEl = $('pp-lb-video');
    if (isVideo) {
      if (imgEl) { imgEl.hidden = true; imgEl.src = ''; }
      if (vidEl) { vidEl.hidden = false; vidEl.src = u || ''; }
    } else {
      if (vidEl) { vidEl.hidden = true; vidEl.pause(); vidEl.src = ''; }
      if (imgEl) { imgEl.hidden = false; imgEl.src = u || ''; }
    }
    $('pp-lb-cap').innerHTML =
      '<strong>' + Fmt.esc(r.description || 'Progress photo') + '</strong>' +
      '<span>' + Fmt.esc(tradesOf(r).concat(worksOf(r), [r.location]).filter(Boolean).join(' · ')) +
      (r.taken_at ? ' · ' + Fmt.date(r.taken_at) : '') + '</span>' +
      '<span class="pp-lb-count">' + (lightboxAt + 1) + ' / ' + lightboxIds.length + '</span>';
    var editBtn = $('pp-lb-edit'), delBtn = $('pp-lb-delete');
    if (editBtn) editBtn.style.display = canWrite ? '' : 'none';
    if (delBtn) delBtn.style.display = canWrite ? '' : 'none';
    if (editBtn) editBtn.onclick = function () { closeLightbox(); openForm(r); };
    if (delBtn) delBtn.onclick = function () { closeLightbox(); remove(r); };
    var dlBtn = $('pp-lb-download');
    if (dlBtn) dlBtn.onclick = function () { download(r); };
    // Markup (18-item list item 13) — hidden on Gallery tiles by contract,
    // shown here only. Visibility is a per-session UI toggle (not persisted
    // per photo — "show it right now" is a viewing preference, not data).
    var mkBtn = $('pp-lb-markuptoggle'), mkEditBtn = $('pp-lb-markupedit');
    if (mkEditBtn) mkEditBtn.style.display = canWrite ? '' : 'none';
    if (mkBtn) mkBtn.onclick = function () { lightboxMarkupVisible = !lightboxMarkupVisible; paintMarkupOverlay(r); };
    if (mkEditBtn) mkEditBtn.onclick = function () {
      openMarkupEditor(u, r.markup || [], async function (newMarkup) {
        r.markup = newMarkup;
        lightboxMarkupVisible = true;
        var w = await tolerantWrite({ table: TABLE, op: 'update', id: r.id, patch: { markup: newMarkup, updated_at: new Date().toISOString() } });
        if (!w.ok) UI.toast(w.error && w.error.message || 'Could not save markup', 'error');
        paintMarkupOverlay(r);
      });
    };
    lightboxMarkupVisible = true;
    paintMarkupOverlay(r);
    hydrate($('pp-lightbox'));
  }
  var lightboxMarkupVisible = true;
  function paintMarkupOverlay(r) {
    var canvas = $('pp-lb-markup-canvas'); if (!canvas) return;
    var imgEl = r.media_type === 'video' ? $('pp-lb-video') : $('pp-lb-img');
    var show = lightboxMarkupVisible && r.markup && r.markup.length;
    canvas.style.display = show ? '' : 'none';
    var mkBtn = $('pp-lb-markuptoggle');
    if (mkBtn) mkBtn.classList.toggle('is-active', lightboxMarkupVisible);
    if (!show || !imgEl) return;
    // Sized to match whichever media element is currently visible — a photo
    // and a video report their box differently but both are the SAME element
    // the markup coordinates (normalized 0..1) are relative to.
    function fit() {
      var rect = imgEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      canvas.width = rect.width; canvas.height = rect.height;
      canvas.style.width = rect.width + 'px'; canvas.style.height = rect.height + 'px';
      drawMarkupObjects(canvas.getContext('2d'), r.markup, canvas.width, canvas.height);
    }
    if (imgEl.complete !== false) fit(); else imgEl.onload = fit;
  }

  async function download(r) {
    var u = urlOf(r);
    if (!u) { UI.toast('Photo file unavailable', 'error'); return; }
    var a = document.createElement('a');
    a.href = u;
    a.download = (r.photo_url || 'photo').split('/').pop();
    document.body.appendChild(a); a.click(); a.remove();
  }

  // -------------------------------------------------- batch download (item 5) --
  // "when clicking download, app should ask what format: html, pdf, or
  // pptx" — mirrors ppr.js's own openDownloadChoice for presentations
  // exactly, so "Download" asks the same three-way question everywhere in
  // this module rather than silently downloading N raw files.
  function openBatchDownloadChoice(ids) {
    if (!ids.length) return;
    // Reuses ppr.js's own .ppr-fmtchoices markup/CSS verbatim (its
    // openDownloadChoice for presentations) — one shared visual language for
    // "pick a download format" everywhere in this module.
    var html =
      '<div class="pd-modal-header"><h3>Download ' + ids.length + ' photo' + (ids.length === 1 ? '' : 's') + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><p class="pp-hint">Choose a format.</p>' +
        '<div class="ppr-fmtchoices">' +
          '<button type="button" class="pd-btn" data-fmt="html">' +
            '<span data-ico="download" data-ico-size="16"></span> Offline HTML' +
            '<small>Opens with no network — best for viewing on-site.</small></button>' +
          '<button type="button" class="pd-btn" data-fmt="pptx">' +
            '<span data-ico="layers" data-ico-size="16"></span> PowerPoint (.pptx)' +
            '<small>One photo per slide.</small></button>' +
          '<button type="button" class="pd-btn" data-fmt="pdf">' +
            '<span data-ico="clipboard" data-ico-size="16"></span> PDF' +
            '<small>One photo per page, ready to print.</small></button>' +
        '</div></div>';
    var m = openModal(html, 460);
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-fmt]'), function (b) {
      b.onclick = function () { var fmt = this.dataset.fmt; m.close(); exportSelectedPhotos(ids, fmt); };
    });
  }

  // Image-embedding helpers — a small, self-contained copy of ppr.js's own
  // toDataURL/blobToImage/collectSlideImages (this file's established
  // convention: small helpers are restated per independently-loaded file
  // rather than reached into another file's private closure — see reqMark()'s
  // own comment). Downscaling keeps a multi-photo export from becoming an
  // enormous file full of untouched full-resolution site photos.
  var DL_MAXW = 1600, DL_JPEG_Q = 0.82;
  function dlBlobToImage(blob) {
    return new Promise(function (resolve, reject) {
      var u = URL.createObjectURL(blob);
      var im = new Image();
      im.onload = function () { URL.revokeObjectURL(u); resolve(im); };
      im.onerror = function () { URL.revokeObjectURL(u); reject(new Error('decode failed')); };
      im.src = u;
    });
  }
  async function dlToDataURL(url) {
    var resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var blob = await resp.blob();
    var img = await dlBlobToImage(blob);
    var scale = Math.min(1, DL_MAXW / (img.naturalWidth || DL_MAXW));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((img.naturalWidth || DL_MAXW) * scale));
    c.height = Math.max(1, Math.round((img.naturalHeight || DL_MAXW) * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', DL_JPEG_Q);
  }
  // Every selected photo's image, embedded as a downscaled data URI — shared
  // by all three export formats below so they can never show a different
  // picture of the same selection. `onProgress(i,total)` is optional.
  async function collectPhotoImages(list, onProgress) {
    var imgs = {}, failed = 0;
    var jobs = list.map(function (r) { return urlOf(r); }).filter(function (u, i, arr) {
      return u && arr.indexOf(u) === i;
    });
    for (var i = 0; i < jobs.length; i++) {
      if (onProgress) onProgress(i, jobs.length);
      try { imgs[jobs[i]] = await dlToDataURL(jobs[i]); }
      catch (e) { failed++; console.warn('progress-photos: could not embed an image —', e && e.message); }
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    return { imgs: imgs, failed: failed };
  }
  // Caption block shared across all three formats — description, then
  // trade/works/location, then the capture date, exactly the fields the
  // List/Gallery views themselves show for a photo.
  function dlCaptionLines(r) {
    var tags = [tradesOf(r).join(', '), worksOf(r).join(', '), r.location].filter(Boolean).join(' · ');
    return [r.description || '', tags, r.taken_at ? Fmt.date(r.taken_at) : ''].filter(Boolean);
  }
  var DL_CSS =
    'body{margin:0;font-family:Montserrat,Segoe UI,Arial,sans-serif;color:#231F20;background:#F4F4F4}' +
    'header{background:#EE3124;color:#fff;padding:16px 22px}' +
    'header h1{margin:0;font-size:19px;letter-spacing:.02em}' +
    '.wrap{max-width:900px;margin:0 auto;padding:18px}' +
    '.item{background:#fff;border:1px solid #DCDBDB;border-radius:4px;padding:14px;margin-bottom:16px}' +
    '.item{break-inside:avoid;page-break-inside:avoid}' +
    '.item:not(:last-of-type){break-after:page;page-break-after:always}' +
    '.item img{width:100%;display:block;border:1px solid #DCDBDB;background:#F4F4F4}' +
    '.missing{padding:40px;text-align:center;color:#9a9a9a;font-size:13px;border:1px solid #DCDBDB}' +
    '.cap{margin-top:8px;font-size:13px;color:#4a4a4a}' +
    'footer{text-align:center;font-size:11.5px;color:#6b6b6b;padding:6px 0 22px}' +
    '@media print{body{background:#fff}.item{border:0}}';
  function dlItemHTML(r, imgs) {
    var u = urlOf(r);
    var d = u ? imgs[u] : '';
    var img = d ? '<img src="' + d + '" alt="' + Fmt.esc(r.description || '') + '" />'
                : '<div class="missing">Image unavailable</div>';
    var cap = dlCaptionLines(r).map(function (l) { return Fmt.esc(l); }).join('<br/>');
    return '<section class="item">' + img + (cap ? '<div class="cap">' + cap + '</div>' : '') + '</section>';
  }
  function dlBodyHTML(list, imgs) {
    return '<header><h1>' + Fmt.esc(projName || pid) + ' — Progress Photos</h1></header>' +
      '<div class="wrap">' + list.map(function (r) { return dlItemHTML(r, imgs); }).join('') + '</div>' +
      '<footer>Generated ' + Fmt.esc(Fmt.date(new Date().toISOString().slice(0, 10))) +
      ' from the Planners Dashboard · Megawide Construction Corporation</footer>';
  }

  async function exportSelectedPhotos(ids, fmt) {
    var list = ids.map(byId).filter(Boolean);
    if (!list.length) { UI.toast('Nothing to download', 'warn'); return; }
    if (fmt === 'pdf') return exportSelectedPdf(list);
    if (fmt === 'pptx') return exportSelectedPptx(list);
    return exportSelectedOffline(list);
  }

  async function exportSelectedOffline(list) {
    var m = openModal(
      '<div class="pd-modal-header"><h3>Preparing offline copy</h3></div>' +
      '<div class="pp-form"><p id="pp-dl-msg">Embedding images…</p></div>', 420);
    var msg = $('pp-dl-msg');
    var res = await collectPhotoImages(list, function (i, total) {
      if (msg) msg.textContent = 'Embedding image ' + (i + 1) + ' of ' + total + '…';
    });
    var html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
      '<title>' + Fmt.esc(projName || pid) + ' — Progress Photos</title>' +
      '<style>' + DL_CSS + '</style></head><body>' + dlBodyHTML(list, res.imgs) + '</body></html>';
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Photos ' + (projName || pid) + '.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    m.close();
    UI.toast('Offline copy downloaded' + (res.failed ? ' — ' + res.failed + ' image(s) could not be embedded' : ''),
      res.failed ? 'warn' : 'ok');
  }

  async function exportSelectedPdf(list) {
    if (typeof html2pdf !== 'function') {
      UI.toast('The PDF library did not load — check the connection and reload.', 'error'); return;
    }
    var m = openModal(
      '<div class="pd-modal-header"><h3>Preparing PDF</h3></div>' +
      '<div class="pp-form"><p id="pp-dl-msg">Embedding images…</p></div>', 420);
    var msg = $('pp-dl-msg');
    var holder = null;
    try {
      var res = await collectPhotoImages(list, function (i, total) {
        if (msg) msg.textContent = 'Embedding image ' + (i + 1) + ' of ' + total + '…';
      });
      if (msg) msg.textContent = 'Building PDF…';
      // ⚠️ Same rule ppr.js's own exportPdf documents (issues-lessons,
      // 2026-08-22): the captured element must stay in NORMAL FLOW, or
      // html2canvas gets a real width and a height of ZERO — a byte-identical
      // blank PDF with no error. Off-screen parking goes on a HOLDER; `wrap`
      // sits in normal flow inside it.
      holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;';
      var wrap = document.createElement('div');
      wrap.style.cssText = 'width:900px;';
      wrap.innerHTML = '<style>' + DL_CSS + '</style>' + dlBodyHTML(list, res.imgs);
      holder.appendChild(wrap);
      document.body.appendChild(holder);

      await html2pdf().set({
        margin: [8, 8, 8, 8],
        filename: 'Photos ' + (projName || pid) + '.pdf',
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: true, logging: false, backgroundColor: '#F4F4F4' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css'] }
      }).from(wrap).save();

      m.close();
      UI.toast('PDF downloaded' + (res.failed ? ' — ' + res.failed + ' image(s) could not be embedded' : ''),
        res.failed ? 'warn' : 'ok');
    } catch (e) {
      m.close(); UI.toast('PDF error: ' + ((e && e.message) || e), 'error');
    } finally {
      if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
    }
  }

  async function exportSelectedPptx(list) {
    if (typeof PptxGenJS !== 'function') {
      UI.toast('The PowerPoint library did not load — check the connection and reload.', 'error'); return;
    }
    var m = openModal(
      '<div class="pd-modal-header"><h3>Preparing PowerPoint</h3></div>' +
      '<div class="pp-form"><p id="pp-dl-msg">Embedding images…</p></div>', 420);
    var msg = $('pp-dl-msg');
    try {
      var res = await collectPhotoImages(list, function (i, total) {
        if (msg) msg.textContent = 'Embedding image ' + (i + 1) + ' of ' + total + '…';
      });
      if (msg) msg.textContent = 'Building file…';
      var imgs = res.imgs;

      var pptx = new PptxGenJS();
      pptx.defineLayout({ name: 'PP_WIDE', width: 13.33, height: 7.5 });
      pptx.layout = 'PP_WIDE';

      var title = pptx.addSlide();
      title.background = { color: 'EE3124' };
      title.addText(projName || pid, { x: 0.6, y: 2.6, w: 12, h: 0.8, fontSize: 28, bold: true, color: 'FFFFFF' });
      title.addText(list.length + ' photo' + (list.length === 1 ? '' : 's'),
        { x: 0.6, y: 3.5, w: 12, h: 1, fontSize: 16, color: 'FFFFFF' });

      // PptxGenJS's `data` option takes the payload WITHOUT the `data:`
      // prefix canvas.toDataURL() always adds (same as ppr.js's own exporter).
      function stripDataPrefix(uri) { return uri ? uri.replace(/^data:/, '') : ''; }

      list.forEach(function (r) {
        var slide = pptx.addSlide();
        var u = urlOf(r), data = u ? imgs[u] : '';
        if (data) slide.addImage({ data: stripDataPrefix(data), x: 1.67, y: 0.4, w: 10, h: 5.6, sizing: { type: 'contain', w: 10, h: 5.6 } });
        else slide.addText('Photo not set', { x: 1.67, y: 0.4, w: 10, h: 5.6, align: 'center', valign: 'middle', color: '9A9A9A', fontSize: 12 });
        var cap = dlCaptionLines(r).join('   ·   ');
        slide.addText(cap, { x: 0.6, y: 6.15, w: 12.13, h: 0.8, fontSize: 11, color: '4A4A4A', align: 'center' });
      });

      m.close();
      await pptx.writeFile({ fileName: 'Photos ' + (projName || pid) + '.pptx' });
      UI.toast('PowerPoint downloaded' + (res.failed ? ' — ' + res.failed + ' image(s) could not be embedded' : ''),
        res.failed ? 'warn' : 'ok');
    } catch (e) {
      m.close(); UI.toast('PowerPoint error: ' + ((e && e.message) || e), 'error');
    }
  }

  // ------------------------------------------------------- markup editor ---
  // 18-item list item 13/14: a vector annotation layer (pencil, eraser,
  // shapes, text, icon stamps), hidden on Gallery tiles, shown only when a
  // photo/slide is opened. ONE engine, exposed publicly (openMarkupEditor
  // below) so ppr.js's presentation-only overlay (item 14 — "native only to
  // the presentation, not shared with the photo") reuses it rather than a
  // second canvas implementation: ppr.js already depends on ProgressPhotos
  // being loaded first (onProject/openUploadForPicker/allPhotos all work the
  // same way), so this follows the same established cross-file convention.
  //
  // Storage format is a plain JS array of objects — never a second rasterised
  // image — so it stays small, can be toggled on/off losslessly, and
  // re-renders correctly at any canvas size:
  //   {type:'pen', points:[[x,y],...], color}
  //   {type:'rect'|'circle'|'arrow', x0,y0,x1,y1, color}   (all in 0..1 of the image)
  //   {type:'text', x,y, text, color}
  //   {type:'icon', x,y, icon, color}                       (icon: 'warn'|'arrow'|'person'|'equip')
  // Coordinates are normalized 0..1 of the image's own box, exactly like
  // floor_plan_pins' x_norm/y_norm — the same reason: re-renders correctly
  // regardless of the canvas's actual pixel size.
  var MARKUP_COLORS = ['#EE3124', '#231F20', '#FFC400', '#1E88E5', '#43A047'];
  // Hand-drawn on the canvas rather than reused from icons.js — that file's
  // glyphs mix <path>/<circle>/<line>/<polygon> elements, which Path2D (the
  // only way to paint an SVG path onto a 2D canvas) cannot parse as a single
  // 'd' string. Four simple primitives cover the ask.
  function drawIconStamp(ctx, name, cx, cy, size, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(2, size * 0.08);
    var r = size / 2;
    if (name === 'warn') {
      ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx - r, cy + r); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.35); ctx.lineTo(cx, cy + r * 0.25); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy + r * 0.55, size * 0.05, 0, Math.PI * 2); ctx.fill();
    } else if (name === 'arrow') {
      ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r * 0.5, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + r, cy); ctx.lineTo(cx + r * 0.3, cy - r * 0.5); ctx.lineTo(cx + r * 0.3, cy + r * 0.5); ctx.closePath(); ctx.fill();
    } else if (name === 'person') {
      ctx.beginPath(); ctx.arc(cx, cy - r * 0.5, r * 0.35, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.1); ctx.lineTo(cx, cy + r * 0.5); ctx.moveTo(cx - r * 0.4, cy + r * 0.9); ctx.lineTo(cx, cy + r * 0.5); ctx.lineTo(cx + r * 0.4, cy + r * 0.9);
      ctx.moveTo(cx - r * 0.35, cy + r * 0.05); ctx.lineTo(cx, cy + r * 0.25); ctx.lineTo(cx + r * 0.35, cy + r * 0.05); ctx.stroke();
    } else { // 'equip'
      ctx.strokeRect(cx - r * 0.7, cy - r * 0.5, r * 1.4, r);
      ctx.beginPath(); ctx.moveTo(cx - r * 0.35, cy - r * 0.5); ctx.lineTo(cx - r * 0.35, cy - r * 0.85); ctx.lineTo(cx + r * 0.35, cy - r * 0.85); ctx.lineTo(cx + r * 0.35, cy - r * 0.5); ctx.stroke();
    }
    ctx.restore();
  }
  function drawMarkupObjects(ctx, objs, w, h) {
    ctx.clearRect(0, 0, w, h);
    objs.forEach(function (o) {
      ctx.strokeStyle = o.color || MARKUP_COLORS[0]; ctx.fillStyle = o.color || MARKUP_COLORS[0]; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (o.type === 'pen' && o.points && o.points.length) {
        ctx.beginPath();
        o.points.forEach(function (p, i) { var x = p[0] * w, y = p[1] * h; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.stroke();
      } else if (o.type === 'rect') {
        ctx.strokeRect(o.x0 * w, o.y0 * h, (o.x1 - o.x0) * w, (o.y1 - o.y0) * h);
      } else if (o.type === 'circle') {
        var cx = (o.x0 + o.x1) / 2 * w, cy = (o.y0 + o.y1) / 2 * h;
        var rx = Math.abs(o.x1 - o.x0) / 2 * w, ry = Math.abs(o.y1 - o.y0) / 2 * h;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
      } else if (o.type === 'arrow') {
        var x0 = o.x0 * w, y0 = o.y0 * h, x1 = o.x1 * w, y1 = o.y1 * h;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        var ang = Math.atan2(y1 - y0, x1 - x0), head = 14;
        ctx.beginPath(); ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - head * Math.cos(ang - Math.PI / 7), y1 - head * Math.sin(ang - Math.PI / 7));
        ctx.lineTo(x1 - head * Math.cos(ang + Math.PI / 7), y1 - head * Math.sin(ang + Math.PI / 7));
        ctx.closePath(); ctx.fill();
      } else if (o.type === 'text') {
        ctx.font = '700 18px Montserrat, Arial, sans-serif';
        ctx.textBaseline = 'top';
        var tx = o.x * w, ty = o.y * h;
        var metrics = ctx.measureText(o.text || '');
        ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(tx - 3, ty - 2, metrics.width + 6, 22);
        ctx.fillStyle = o.color || MARKUP_COLORS[0];
        ctx.fillText(o.text || '', tx, ty);
      } else if (o.type === 'icon') {
        drawIconStamp(ctx, o.icon, o.x * w, o.y * h, 34, o.color || MARKUP_COLORS[0]);
      }
    });
  }
  // Nearest-object hit test for the eraser — "erase" on a vector layer means
  // REMOVE THE OBJECT, not paint pixels transparent (there are no pixels);
  // this is the vector equivalent the plan itself calls for ("eraser as a
  // path-hit-test removal").
  function markupHitTest(objs, nx, ny, w, h) {
    var best = -1, bestDist = 26; // px tolerance
    objs.forEach(function (o, i) {
      var d = Infinity;
      if (o.type === 'pen') {
        o.points.forEach(function (p) { d = Math.min(d, Math.hypot((p[0] - nx) * w, (p[1] - ny) * h)); });
      } else if (o.type === 'text' || o.type === 'icon') {
        d = Math.hypot((o.x - nx) * w, (o.y - ny) * h);
      } else {
        var cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2;
        d = Math.hypot((cx - nx) * w, (cy - ny) * h);
      }
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  // Opens the shared markup editor. `imageUrl` is any already-signed URL
  // (a photo, or a PPR pane's photo — the caller resolves that);
  // `initialMarkup` is the existing array (or []); `onSave(newMarkup)` is
  // called with the finished array on Save, never called on Cancel.
  function openMarkupEditor(imageUrl, initialMarkup, onSave) {
    var objs = (initialMarkup || []).map(function (o) { return Object.assign({}, o); }); // work on a copy — Cancel must leave the original untouched
    var tool = 'pen', color = MARKUP_COLORS[0], iconChoice = 'warn';
    var undone = []; // undo stack of removed/added ops, simple whole-array snapshots (this layer is small — dozens of objects at most)
    var history = [objs.map(function (o) { return Object.assign({}, o); })];

    var html =
      '<div class="pd-modal-header"><h3>Markup</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<div class="pp-mk-toolbar">' +
          '<div class="pp-mk-tools" role="tablist">' +
            ['pen', 'rect', 'circle', 'arrow', 'text', 'icon', 'erase'].map(function (t) {
              var lbl = { pen: 'Pen', rect: 'Rect', circle: 'Circle', arrow: 'Arrow', text: 'Text', icon: 'Icon', erase: 'Eraser' }[t];
              return '<button type="button" class="pp-mk-tool' + (t === tool ? ' active' : '') + '" data-tool="' + t + '">' + lbl + '</button>';
            }).join('') +
          '</div>' +
          '<div class="pp-mk-icons" id="pp-mk-icons" style="display:none;">' +
            ['warn', 'arrow', 'person', 'equip'].map(function (ic) {
              return '<button type="button" class="pp-mk-tool' + (ic === iconChoice ? ' active' : '') + '" data-icon="' + ic + '">' + ic + '</button>';
            }).join('') +
          '</div>' +
          '<div class="pp-mk-colors">' + MARKUP_COLORS.map(function (c) {
            return '<button type="button" class="pp-mk-swatch' + (c === color ? ' active' : '') + '" data-color="' + c + '" style="background:' + c + ';"></button>';
          }).join('') + '</div>' +
          '<button type="button" class="pd-btn" id="pp-mk-undo">Undo</button>' +
          '<button type="button" class="pd-btn" id="pp-mk-clear">Clear all</button>' +
        '</div>' +
        '<div class="pp-mk-canvaswrap" id="pp-mk-canvaswrap">' +
          '<img id="pp-mk-img" src="' + Fmt.esc(imageUrl) + '" alt="" />' +
          '<canvas id="pp-mk-canvas"></canvas>' +
        '</div>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="pp-mk-save">Save markup</button></div>';
    // ⚠️ Audit fix: onClose now covers × / Cancel AND a backdrop click alike
    // (previously only the [data-close] re-wiring further down did, so
    // dismissing via backdrop click left this listener on `window` forever
    // — see openModal's own comment for the mechanism).
    var m = openModal(html, 900, function () { window.removeEventListener('resize', sizeCanvas); });

    var canvas = $('pp-mk-canvas'), ctx = canvas.getContext('2d'), img = $('pp-mk-img');
    function sizeCanvas() {
      var r = img.getBoundingClientRect();
      canvas.width = r.width; canvas.height = r.height;
      canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
      redraw();
    }
    function redraw() { drawMarkupObjects(ctx, objs, canvas.width, canvas.height); }
    function pushHistory() { history.push(objs.map(function (o) { return Object.assign({}, o); })); undone = []; }
    if (img.complete) sizeCanvas(); else img.onload = sizeCanvas;
    window.addEventListener('resize', sizeCanvas);

    Array.prototype.forEach.call(m.el.querySelectorAll('[data-tool]'), function (b) {
      b.onclick = function () {
        tool = this.dataset.tool;
        Array.prototype.forEach.call(m.el.querySelectorAll('[data-tool]'), function (x) { x.classList.toggle('active', x.dataset.tool === tool); });
        $('pp-mk-icons').style.display = tool === 'icon' ? '' : 'none';
      };
    });
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-icon]'), function (b) {
      b.onclick = function () {
        iconChoice = this.dataset.icon;
        Array.prototype.forEach.call(m.el.querySelectorAll('[data-icon]'), function (x) { x.classList.toggle('active', x.dataset.icon === iconChoice); });
      };
    });
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-color]'), function (b) {
      b.onclick = function () {
        color = this.dataset.color;
        Array.prototype.forEach.call(m.el.querySelectorAll('[data-color]'), function (x) { x.classList.toggle('active', x.dataset.color === color); });
      };
    });
    $('pp-mk-undo').onclick = function () {
      if (history.length < 2) return;
      undone.push(history.pop());
      objs = history[history.length - 1].map(function (o) { return Object.assign({}, o); });
      redraw();
    };
    $('pp-mk-clear').onclick = function () { objs = []; pushHistory(); redraw(); };

    var drawing = false, penPoints = null, shapeStart = null;
    function toNorm(e) {
      var r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    }
    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      var p = toNorm(e);
      if (tool === 'erase') {
        var idx = markupHitTest(objs, p[0], p[1], canvas.width, canvas.height);
        if (idx >= 0) { objs.splice(idx, 1); pushHistory(); redraw(); }
        return;
      }
      if (tool === 'text') {
        var text = prompt('Text:'); if (!text) return;
        objs.push({ type: 'text', x: p[0], y: p[1], text: text, color: color });
        pushHistory(); redraw(); return;
      }
      if (tool === 'icon') {
        objs.push({ type: 'icon', x: p[0], y: p[1], icon: iconChoice, color: color });
        pushHistory(); redraw(); return;
      }
      drawing = true;
      if (tool === 'pen') { penPoints = [p]; objs.push({ type: 'pen', points: penPoints, color: color }); }
      else { shapeStart = p; objs.push({ type: tool, x0: p[0], y0: p[1], x1: p[0], y1: p[1], color: color }); }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = toNorm(e);
      if (tool === 'pen') { penPoints.push(p); }
      else { var last = objs[objs.length - 1]; last.x1 = p[0]; last.y1 = p[1]; }
      redraw();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      canvas.addEventListener(ev, function () {
        if (!drawing) return;
        drawing = false; pushHistory();
      });
    });

    // ⚠️ Audit fix: the [data-close] re-wire that used to live here is
    // gone — openModal's own onClose (passed above) now removes the
    // resize listener on EVERY dismissal path, including backdrop click,
    // which this per-button re-wire never covered. m.close() below already
    // runs it, so no separate removeEventListener call is needed here either.
    $('pp-mk-save').onclick = function () {
      m.close();
      if (onSave) onSave(objs);
    };
  }

  // --------------------------------------------------------------- upload ---
  function reqMark() { return ' <span class="pp-req">*</span>'; }
  // Capture date / Works / Location Breakdown are required. These fields
  // live in a plain <div>, not a <form>, so the native `required` attribute
  // is a visual/semantic cue only -- this is the actual gate, called before
  // either the Add or Edit save handler proceeds. Trade is no longer a
  // field of its own (item 9) -- it's derived from the Works value chosen,
  // so there is nothing to require separately.
  function requiredFieldsMissing(idPrefix) {
    var date = $(idPrefix + '-date');
    if (!date || !date.value) return 'Capture date is required.';
    if (!readWorksTag(idPrefix)) return 'A Works value is required.';
    var need = locRequiredLevels();
    if (need.length) {
      var vals = currentLocValues(idPrefix);
      var missing = need.filter(function (l) { return !vals[l.id]; });
      if (missing.length) {
        return missing.map(function (l) { return l.name; }).join(' and ') + ' ' +
          (missing.length > 1 ? 'are' : 'is') + ' required.';
      }
    }
    return null;
  }

  // ------------------------------------------------- Location Breakdown picker
  // One free-text input + datalist per location_levels row (Project
  // Schedule's own convention for this exact feature -- an <input>+<datalist>,
  // not a <select>, since values are project-specific free text with no
  // enforced tree). Suggestions soft-cascade: later levels' datalists are
  // recomputed from only the activities matching everything picked so far,
  // but typing an unlisted value is always allowed. The resolved path is
  // shown as its own read-only breadcrumb -- never written into the
  // separate, purely-optional free-text "Location label". Any Activity Code
  // types the project has (a separate, unrelated mechanism) get their own
  // generic overlay checkboxes.
  function locOptionsHTML(levelId, priorVals) {
    return distinctLocValues(levelId, priorVals).map(function (v) {
      return '<option value="' + Fmt.esc(v) + '"></option>';
    }).join('');
  }
  // The first two configured levels (by sort_order -- typically Tower/Building
  // then Level/Floor) are required; deeper levels (Zone, Orientation, ...) stay
  // optional, matching the "a capture can stop at any depth" design elsewhere
  // in this picker.
  function locRequiredLevels() { return LOC_LEVELS.slice(0, 2); }
  function locLevelFieldHTML(idPrefix, level, priorVals, curVal, isRequired) {
    var dlid = idPrefix + '-loclvl-' + level.id + '-dl';
    return '<div class="pd-field pp-wbslevel"><label>' + Fmt.esc(level.name) +
      (isRequired ? reqMark() : '') + '</label>' +
      '<input class="pd-input" id="' + idPrefix + '-loclvl-' + level.id + '" list="' + dlid + '" ' +
      'data-lvl="' + level.id + '" value="' + Fmt.esc(curVal || '') + '" placeholder="e.g. ..."' +
      (isRequired ? ' required' : '') + ' />' +
      '<datalist id="' + dlid + '">' + locOptionsHTML(level.id, priorVals) + '</datalist>' +
      '</div>';
  }
  function locFieldsHTML(idPrefix, existingValues) {
    existingValues = existingValues || {};
    if (!LOC_LEVELS.length) return '<p class="pp-hint">No Location Breakdown set up for this project yet -- build it in Project Schedule (Group menu &rarr; Location Breakdown...).</p>';
    var prior = {};
    var reqIds = {};
    locRequiredLevels().forEach(function (l) { reqIds[l.id] = true; });
    return LOC_LEVELS.map(function (l) {
      var html = locLevelFieldHTML(idPrefix, l, prior, existingValues[l.id], !!reqIds[l.id]);
      if (existingValues[l.id]) prior[l.id] = existingValues[l.id];
      return html;
    }).join('');
  }
  function currentLocValues(idPrefix) {
    var values = {};
    LOC_LEVELS.forEach(function (l) {
      var el = $(idPrefix + '-loclvl-' + l.id);
      var v = el ? el.value.trim() : '';
      if (v) values[l.id] = v;
    });
    return values;
  }
  function wireLocFields(idPrefix) {
    LOC_LEVELS.forEach(function (l, i) {
      var el = $(idPrefix + '-loclvl-' + l.id);
      if (!el) return;
      el.oninput = el.onchange = function () {
        var prior = {};
        for (var j = 0; j <= i; j++) {
          var pel = $(idPrefix + '-loclvl-' + LOC_LEVELS[j].id);
          if (pel && pel.value.trim()) prior[LOC_LEVELS[j].id] = pel.value.trim();
        }
        for (var k = i + 1; k < LOC_LEVELS.length; k++) {
          var nl = LOC_LEVELS[k];
          var dl = $(idPrefix + '-loclvl-' + nl.id + '-dl');
          if (dl) dl.innerHTML = locOptionsHTML(nl.id, prior);
        }
        paintLocCtx(idPrefix);
      };
    });
  }
  // The separate free-text "Location label" input was removed (2026-08-29
  // feedback, item 2 — "No need for the location label as this is
  // redundant"). `location` (the display-cache text column) is now ALWAYS
  // derived from `locBreadcrumb(locVals)` — never a manual override — so
  // the third `locText` parameter this function used to take is gone too;
  // both call sites below were updated to drop the argument they used to
  // pass here (it only ever fed the removed input's initial value).
  function locationFieldHTML(idPrefix, existingValues) {
    return (
      '<div class="pp-span2 pp-wbssection"><label>Location Breakdown' +
        (locRequiredLevels().length ? reqMark() + ' <span class="pp-optnote">(' +
          Fmt.esc(locRequiredLevels().map(function (l) { return l.name; }).join(' & ')) +
          ' required)</span>' : '') + '</label>' +
        '<div class="pp-wbscascade" id="' + idPrefix + '-loclevels">' + locFieldsHTML(idPrefix, existingValues) + '</div>' +
        '<div class="pp-wbscrumb" id="' + idPrefix + '-crumb"></div>' +
      '</div>' +
      '<div class="pp-actctx pp-span2" id="' + idPrefix + '-actctx"></div>' +
      codeOverlayHTML(idPrefix, [])
    );
  }
  function codeOverlayHTML(idPrefix, existingTags) {
    if (!CODE_TYPES.length) return '';
    existingTags = existingTags || [];
    var groups = CODE_TYPES.map(function (t) {
      var vals = CODE_VALUES.filter(function (v) { return v.code_type_id === t.id; });
      if (!vals.length) return '';
      return '<div class="pp-codegroup"><span class="pp-codegroup-name">' + Fmt.esc(t.name) + ':</span>' +
        vals.map(function (v) {
          var tag = t.name + ': ' + v.value;
          return '<label class="pp-codechk"><input type="checkbox" value="' + Fmt.esc(tag) + '"' +
                 (existingTags.indexOf(tag) >= 0 ? ' checked' : '') + '/> ' + Fmt.esc(v.value) + '</label>';
        }).join('') + '</div>';
    }).join('');
    if (!groups) return '';
    return '<div class="pd-field pp-span2"><label>Schedule code tags (optional)</label>' +
      '<div class="pp-codetags" id="' + idPrefix + '-codes">' + groups + '</div></div>';
  }
  function readCodeTags(idPrefix) {
    var wrap = $(idPrefix + '-codes'); if (!wrap) return [];
    return Array.prototype.map.call(wrap.querySelectorAll('input[type=checkbox]:checked'), function (c) { return c.value; });
  }
  // The `skipInitialFill` param is kept as a harmless no-op so existing call
  // sites don't need to change -- Location label is fully independent now,
  // never auto-filled from the picker (the breadcrumb is the one place the
  // resolved Location Breakdown path is shown).
  function wireLocationField(idPrefix, skipInitialFill) {
    wireLocFields(idPrefix);
    paintLocCtx(idPrefix);
  }
  function paintLocCtx(idPrefix) {
    var ctx = $(idPrefix + '-actctx'), crumb = $(idPrefix + '-crumb');
    var values = currentLocValues(idPrefix);
    var hasAny = Object.keys(values).length > 0;
    if (crumb) {
      crumb.innerHTML = hasAny
        ? Fmt.esc(locBreadcrumb(values))
        : '<span class="pp-muted">No Location Breakdown value selected yet.</span>';
    }
    if (!ctx) return;
    if (!hasAny) { ctx.innerHTML = ''; return; }
    var act = resolveActivity(values), last = lastCaptureAt(values);
    var html = '';
    if (act) html += '<div class="pp-actline">Current activity: <strong>' + Fmt.esc(act.name || act.id) + '</strong></div>';
    else html += '<div class="pp-actline pp-muted">No active schedule activity found for this location.</div>';
    if (last) {
      var u = urlOf(last);
      html += '<div class="pp-actline pp-lastref">' +
        (u ? '<img src="' + Fmt.esc(u) + '" class="pp-refthumb" alt="Last photo here" />' : '') +
        '<span>Last captured here ' + (last.taken_at ? Fmt.date(last.taken_at) : '') +
        ' -- frame a similar shot for comparison.</span></div>';
    }
    ctx.innerHTML = html;
    hydrate(ctx);
  }

  // Add-media type selector (18-item list item 4). Photo is the default and
  // the only kind this form has ever produced; Video is a plain,
  // unprocessed upload sharing every other field (trade/works/location/key
  // plan all apply the same way to a clip). 360°/3D are shown, not hidden —
  // so a planner can SEE the capability exists — but disabled with a
  // tooltip, since Gaussian Splatting/RunPod are on hold; they route to
  // pano.js/recon.js's own real capture flows (unchanged) once re-enabled,
  // never re-implemented here.
  // 2026-08-29 feedback item 17: four options -- Photo / Video / 360° / 3D --
  // with only 3D greyed out (3D reconstruction is the one still on hold; 360°
  // capture is being fixed in the same round, item 18, so it comes back as a
  // real choice here). Picking Photo/Video stays in THIS form (they share
  // every other field); picking 360° hands off to pano.js's own real capture
  // flow instead -- a 360° capture is a fundamentally different pipeline
  // (record/stitch into a `panoramas` row, not a plain file into
  // `progress_photos`), so it is delegated to, never reimplemented here.
  function mediaTypeSelectorHTML(idPrefix, cur) {
    cur = cur || 'photo';
    return '<div class="pd-field pp-span2"><label>Type</label>' +
      '<div class="pp-mtypesel" role="tablist">' +
        '<button type="button" class="pp-mtype' + (cur === 'photo' ? ' active' : '') +
          '" data-mtype="photo" id="' + idPrefix + '-mtype-photo">Photo</button>' +
        '<button type="button" class="pp-mtype' + (cur === 'video' ? ' active' : '') +
          '" data-mtype="video" id="' + idPrefix + '-mtype-video">Video</button>' +
        '<button type="button" class="pp-mtype" id="' + idPrefix + '-mtype-360">360°</button>' +
        '<button type="button" class="pp-mtype" disabled title="3D reconstruction is on hold">3D</button>' +
      '</div></div>';
  }
  function wireMediaTypeSelector(idPrefix, onChange) {
    var cur = 'photo';
    var fileInput = $(idPrefix + '-files');
    function apply() {
      if (fileInput) fileInput.accept = cur === 'video' ? 'video/*' : 'image/*';
      // ⚠️ Audit fix: this used to run unconditionally on every call
      // (including the very FIRST, before the user touches anything), so
      // the markup's own `capture="environment"` — meant to hint mobile
      // browsers to open the rear camera directly for a photo — was
      // stripped on arrival and never actually took effect in Photo mode
      // either. It's removed only in Video mode now, and restored when
      // switching back to Photo, so toggling between the two is reversible.
      if (fileInput) {
        if (cur === 'video') fileInput.removeAttribute('capture');
        else fileInput.setAttribute('capture', 'environment');
      }
      var pBtn = $(idPrefix + '-mtype-photo'), vBtn = $(idPrefix + '-mtype-video');
      if (pBtn) pBtn.classList.toggle('active', cur === 'photo');
      if (vBtn) vBtn.classList.toggle('active', cur === 'video');
      if (onChange) onChange(cur);
    }
    ['photo', 'video'].forEach(function (t) {
      var btn = $(idPrefix + '-mtype-' + t);
      if (btn) btn.onclick = function () { cur = t; apply(); };
    });
    apply();
    return { get: function () { return cur; } };
  }

  function openUpload(preset) {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    preset = preset || {};
    var today = new Date().toISOString().slice(0, 10);
    var html =
      '<div class="pd-modal-header"><h3>Add media</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<p class="pp-hint">Fields below apply to every file in this batch — edit any ' +
          'individual item afterwards.</p>' +
        mediaTypeSelectorHTML('pp') +
        '<div class="pd-field" id="pp-filesfield"><label>Photos</label>' +
          '<input class="pd-input" type="file" id="pp-files" accept="image/*" capture="environment" multiple /></div>' +
        '<div class="pp-form2">' +
          '<div class="pd-field"><label>Description</label>' +
            '<input class="pd-input" id="pp-desc" placeholder="e.g. Model Unit" /></div>' +
          '<div class="pd-field"><label>Capture date' + reqMark() + '</label>' +
            '<input class="pd-input" type="date" id="pp-date" value="' + today + '" required /></div>' +
          '<div class="pd-field pp-span2"><label>Works' + reqMark() + '</label>' +
            worksTagFieldHTML('pp', '') + '</div>' +
          locationFieldHTML('pp', preset.locationValues || {}) +
          (window.BIM ? BIM.pinFieldHTML('pp', null) : '') +
        '</div>' +
        '<div class="pp-progress" id="pp-prog" hidden></div>' +
      '</div>' +
      '<div class="pd-modal-footer">' +
        '<button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="pp-save">Upload</button></div>';

    var m = openModal(html, 640);
    wireLocationField('pp');
    wireWorksTagField('pp');
    if (window.BIM) BIM.wirePinField('pp');
    var mtype = wireMediaTypeSelector('pp', function (t) {
      var fld = $('pp-filesfield'); if (fld) fld.querySelector('label').textContent = t === 'video' ? 'Videos' : 'Photos';
    });
    // 360° hands off to pano.js's own real capture flow (item 17) — this
    // modal closes rather than trying to represent a recording/stitching
    // pipeline inside the same form as a plain file upload.
    if ($('pp-mtype-360')) $('pp-mtype-360').onclick = function () {
      m.close();
      if (window.PANO && PANO.openCapture) PANO.openCapture();
      else UI.toast('360° capture is not available', 'error');
    };
    hydrate(m.el);

    $('pp-save').onclick = async function () {
      var files = $('pp-files').files;
      var kind = mtype.get();
      if (!files || !files.length) { UI.toast('Choose at least one ' + (kind === 'video' ? 'video' : 'photo'), 'warn'); return; }
      var reqErr = requiredFieldsMissing('pp');
      if (reqErr) { UI.toast(reqErr, 'warn'); return; }
      var locVals = currentLocValues('pp');
      var act = resolveActivity(locVals);
      // Item 9: Works is now a single schedule-derived tag; Trade is DERIVED
      // from it, never picked directly. `trades`/`works_multi` stay the real
      // array columns (at most one element each now) so every downstream
      // reader (grouping, filters, `tradesOf`/`worksOf`) keeps working
      // unchanged; `trade`/`works` stay populated too as the singular
      // display-cache fallback, same "deprecated but kept in step"
      // convention this file already uses for `location`.
      var worksVal = readWorksTag('pp');
      var tradeVal = deriveTradeForWorks(worksVal);
      var pinData = window.BIM ? BIM.readPinField('pp') : null;   // item 11
      var shared = {
        description: $('pp-desc').value.trim(),
        taken_at: $('pp-date').value || null,
        trades: tradeVal ? [tradeVal] : [],
        works_multi: worksVal ? [worksVal] : [],
        trade: tradeVal,
        works: worksVal || null,
        location: locBreadcrumb(locVals) || null,
        location_values: locVals,
        activity_id: act ? act.id : null,
        activity_name: act ? act.name : null,
        tags: readCodeTags('pp'),
        media_type: kind
      };
      this.disabled = true;
      var prog = $('pp-prog'); prog.hidden = false;
      var done = 0, queued = 0, failed = [], newIds = [];

      for (var i = 0; i < files.length; i++) {
        prog.textContent = 'Saving ' + (i + 1) + ' of ' + files.length + '…';
        try {
          var r = await saveCapture(files[i], Object.assign({ sort_order: i }, shared));
          if (r.queued) queued++; else if (r.ok) { done++; if (r.id) newIds.push(r.id); } else failed.push(files[i].name);
        } catch (err) {
          failed.push(files[i].name + ': ' + (err.message || err));
        }
        await new Promise(function (r) { setTimeout(r, 0); });   // let progress paint
      }

      m.close();
      if (done) UI.toast(done + ' ' + (kind === 'video' ? 'video' : 'photo') + (done === 1 ? '' : 's') + ' uploaded', 'ok');
      // ⚠️ Audit fix: hardcoded "photo" regardless of kind, unlike the
      // "uploaded" toast right above it — a batch of videos queued offline
      // reported itself as photos.
      if (queued) UI.toast(queued + ' ' + (kind === 'video' ? 'video' : 'photo') + (queued === 1 ? '' : 's') + ' queued — offline, will sync automatically', 'warn');
      if (failed.length) UI.toast(failed.length + ' failed — ' + failed[0], 'error');
      await load();
      // Item 11: pin + direction is now captured INLINE, in the same form as
      // the upload itself, rather than a separate popup shown after the
      // fact -- so it's saved for every uploaded item that shares this one
      // camera position, not just a single representative photo. A no-op
      // when the planner left the field blank (readPinField returned null).
      if (pinData && window.BIM && BIM.savePinForItem) {
        for (var pi = 0; pi < newIds.length; pi++) await BIM.savePinForItem('photo', newIds[pi], pinData);
      }
      if (typeof preset.onDone === 'function') preset.onDone(newIds);
    };
  }

  async function uploadFile(file) {
    var safe = file.name.replace(/[^\w.\-]+/g, '_');
    var path = pid + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + safe;
    var res = await sb().storage.from(BUCKET).upload(path, file, { upsert: false });
    if (res.error) throw res.error;
    return path;
  }

  // ---------------------------------------------------- Key Plan (per photo)
  // RETIRED (2026-08-29 feedback item 11): this ad-hoc "upload your own key
  // plan image every time" wizard is superseded by BIM.pinFieldHTML/
  // wirePinField/readPinField/savePinForItem, which pick from the project's
  // REAL floor_plans database (the Plans tab) and additionally capture WHERE
  // on that plan the camera stood and which way it faced — the two things a
  // bare reference image never recorded. `progress_photos.key_plan_url`
  // stays in the schema for any pre-existing row that still carries one
  // (nothing reads or displays it going forward); no migration needed to
  // remove a column nothing new writes to.

  // ------------------------------------------------------------ tolerant write
  // Every DB write that might carry the new schedule-linkage columns goes
  // through here: routes through the shared PDSync outbox when present (same
  // offline/LWW mechanism openForm's metadata edits already use), and retries
  // once without wbs_node_id/activity_id/activity_name on a "column does not
  // exist" error so a not-yet-migrated DB never loses the whole write.
  async function doWrite(job) {
    if (window.PDSync) return PDSync.write(job);
    if (job.op === 'insert') {
      // ⚠️ .select() is REQUIRED: supabase-js v2 returns `data: null` on a bare
      // insert, so without it the new row's id never comes back — which the PPR
      // slide editor's inline "+ Add photo" depends on to select the photo it
      // just uploaded.
      var ires = await sb().from(job.table).insert(job.patch).select();
      return ires.error ? { ok: false, error: ires.error }
        : { ok: true, queued: false, id: ires.data && ires.data[0] && ires.data[0].id };
    }
    if (job.op === 'update') {
      var ures = await sb().from(job.table).update(job.patch).eq('id', job.id);
      return ures.error ? { ok: false, error: ures.error } : { ok: true, queued: false };
    }
    return { ok: false, error: { message: 'unsupported op ' + job.op } };
  }
  async function tolerantWrite(job) {
    var w = await doWrite(job);
    if (!w.ok && /column .* does not exist|schema cache/i.test((w.error && w.error.message) || '') &&
        job.patch && ('location_values' in job.patch || 'activity_id' in job.patch || 'activity_name' in job.patch)) {
      var stripped = Object.assign({}, job.patch);
      delete stripped.location_values; delete stripped.activity_id; delete stripped.activity_name;
      if (!migrationWarned) {
        migrationWarned = true;
        UI.toast('Saved without the schedule-zone link — run the pending migration', 'warn');
      }
      return await doWrite(Object.assign({}, job, { patch: stripped }));
    }
    // Same tolerance for the 2026-08-29 multi-select Trade/Works columns
    // (`trades`/`works_multi`) -- the singular `trade`/`works` columns
    // already exist, so a save still lands with usable data even before the
    // migration runs, it just falls back to first-selected-only until then.
    if (!w.ok && /column .* does not exist|schema cache/i.test((w.error && w.error.message) || '') &&
        job.patch && ('trades' in job.patch || 'works_multi' in job.patch)) {
      var stripped2 = Object.assign({}, job.patch);
      delete stripped2.trades; delete stripped2.works_multi;
      if (!migrationWarnedMulti) {
        migrationWarnedMulti = true;
        UI.toast('Saved with only the first Trade/Works value — run the pending migration for multi-select', 'warn');
      }
      return await doWrite(Object.assign({}, job, { patch: stripped2 }));
    }
    // Same tolerance for media_type (18-item list item 4, video upload) — a
    // pre-migration save still lands, just without knowing it's a video (it
    // renders as a broken <img>, no worse than before this feature existed).
    if (!w.ok && /column .* does not exist|schema cache/i.test((w.error && w.error.message) || '') &&
        job.patch && ('media_type' in job.patch)) {
      var stripped3 = Object.assign({}, job.patch);
      delete stripped3.media_type;
      if (!migrationWarnedMedia) {
        migrationWarnedMedia = true;
        UI.toast('Saved, but video type not stored — run migrations/2026-08-29-photo-media-type.sql', 'warn');
      }
      return await doWrite(Object.assign({}, job, { patch: stripped3 }));
    }
    // Same tolerance for markup (Batch F) — a pre-migration save drops the
    // just-drawn annotation rather than failing the whole update; the modal
    // has already closed by the time this runs, so the warning is the only
    // way the planner learns the markup didn't actually persist.
    if (!w.ok && /column .* does not exist|schema cache/i.test((w.error && w.error.message) || '') &&
        job.patch && ('markup' in job.patch)) {
      var stripped4 = Object.assign({}, job.patch);
      delete stripped4.markup;
      if (!migrationWarnedMarkup) {
        migrationWarnedMarkup = true;
        UI.toast('Markup could not be saved — run migrations/2026-08-29-markup.sql', 'warn');
      }
      return await doWrite(Object.assign({}, job, { patch: stripped4 }));
    }
    return w;
  }

  // ------------------------------------------------------- offline queue -----
  // PDSync (offline.js) already queues DB row writes offline, but it has no
  // concept of a Storage upload — it can't hold onto an unsent image blob. So
  // a capture that can't even START uploading (offline, or the upload itself
  // throws) is queued here instead: the file blob + metadata in IndexedDB,
  // retried (upload THEN the row write via tolerantWrite) on reconnect or
  // "Sync now". This is a deliberate, narrow addition on top of PDSync, not a
  // competing offline system — once a file's bytes are on Storage, the row
  // write always goes through the same tolerantWrite/PDSync path as any
  // other insert.
  var OfflineQueue = (function () {
    var DB_NAME = 'pp_offline_v1', STORE = 'queue', dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var d = req.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'qid', autoIncrement: true });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
      return dbp;
    }
    function add(record) {
      return open().then(function (d) { return new Promise(function (resolve, reject) {
        var tx = d.transaction(STORE, 'readwrite');
        var req = tx.objectStore(STORE).add(record);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      }); });
    }
    function all() {
      return open().then(function (d) { return new Promise(function (resolve, reject) {
        var out = [];
        var req = d.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
        req.onsuccess = function (e) {
          var cur = e.target.result;
          if (cur) { out.push(cur.value); cur.continue(); } else resolve(out);
        };
        req.onerror = function () { reject(req.error); };
      }); });
    }
    function remove(qid) {
      return open().then(function (d) { return new Promise(function (resolve, reject) {
        var tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(qid);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      }); });
    }
    return { add: add, all: all, remove: remove };
  })();

  async function queuedCountFor(pidVal) {
    try {
      var list = await OfflineQueue.all();
      return list.filter(function (r) { return r.project_id === pidVal; }).length;
    } catch (e) { return 0; }
  }

  async function refreshQueueBadge() {
    var n = await queuedCountFor(pid);
    var btn = $('pp-sync');
    if (!btn) return;
    btn.hidden = !n;
    var lbl = $('pp-sync-n'); if (lbl) lbl.textContent = n;
  }

  // Captures try to save immediately; a network failure (or being visibly
  // offline) queues the file+metadata instead of losing the shot. Once the
  // file is uploaded, the row write goes through tolerantWrite (PDSync) —
  // which handles a network hiccup on JUST the row write on its own.
  async function saveCapture(file, meta) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await OfflineQueue.add({ project_id: pid, created_by: uid, fileName: file.name, blob: file, meta: meta, queued_at: new Date().toISOString() });
      await refreshQueueBadge();
      return { queued: true };
    }
    var path;
    try {
      path = await uploadFile(file);
    } catch (err) {
      await OfflineQueue.add({ project_id: pid, created_by: uid, fileName: file.name, blob: file, meta: meta, queued_at: new Date().toISOString() });
      await refreshQueueBadge();
      return { queued: true };
    }
    var row = Object.assign({}, meta, { project_id: pid, created_by: uid, photo_url: path, title: file.name });
    var w = await tolerantWrite({ table: TABLE, op: 'insert', patch: row });
    if (!w.ok) {
      // The file IS already uploaded — queue just the row write (skips a
      // redundant re-upload on retry) rather than losing the capture.
      await OfflineQueue.add({ project_id: pid, created_by: uid, fileName: file.name, uploadedPath: path, meta: meta, queued_at: new Date().toISOString() });
      await refreshQueueBadge();
      return { queued: true, ok: false, error: w.error };
    }
    return { queued: !!w.queued, ok: true, id: w.id };
  }

  async function flushQueue() {
    var list = [];
    try { list = await OfflineQueue.all(); } catch (e) { UI.toast('Could not read the offline queue', 'error'); return; }
    var mine = list.filter(function (r) { return r.project_id === pid; });
    if (!mine.length) { UI.toast('Nothing to sync', 'ok'); return; }
    var ok = 0, fail = 0;
    for (var i = 0; i < mine.length; i++) {
      var item = mine[i];
      try {
        var path = item.uploadedPath || await uploadFile(item.blob);
        var row = Object.assign({}, item.meta, { project_id: item.project_id, created_by: item.created_by, photo_url: path, title: item.fileName });
        var w = await tolerantWrite({ table: TABLE, op: 'insert', patch: row });
        if (!w.ok) throw (w.error || new Error('write failed'));
        await OfflineQueue.remove(item.qid);
        ok++;
      } catch (e) { fail++; }
    }
    await refreshQueueBadge();
    if (ok) await load();
    UI.toast(ok + ' synced' + (fail ? (', ' + fail + ' still pending') : ''), fail ? 'warn' : 'ok');
  }

  // ----------------------------------------------------------- edit/delete ---
  function openForm(r) {
    broadcastCollabSel(r.id, true);   // tell other viewers I'm editing this photo
    var existingPinInfo = (window.BIM && BIM.pinInfoFor) ? BIM.pinInfoFor('photo', r.id) : null;
    var html =
      '<div class="pd-modal-header"><h3>Edit photo</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        (urlOf(r) ? '<img class="pp-formpreview" src="' + Fmt.esc(urlOf(r)) + '" alt="" />' : '') +
        '<div class="pp-form2">' +
          '<div class="pd-field"><label>Description</label>' +
            '<input class="pd-input" id="pp-e-desc" value="' + Fmt.esc(r.description || '') + '" /></div>' +
          '<div class="pd-field"><label>Capture date' + reqMark() + '</label>' +
            '<input class="pd-input" type="date" id="pp-e-date" value="' + Fmt.esc(r.taken_at || '') + '" required /></div>' +
          '<div class="pd-field pp-span2"><label>Works' + reqMark() + '</label>' +
            worksTagFieldHTML('pp-e', worksOf(r)[0] || '') + '</div>' +
          locationFieldHTML('pp-e', r.location_values || {}) +
          (window.BIM ? BIM.pinFieldHTML('pp-e', existingPinInfo ? existingPinInfo.pin : null) : '') +
        '</div>' +
      '</div>' +
      '<div class="pd-modal-footer">' +
        '<button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="pp-e-save">Save</button></div>';

    // ⚠️ Audit fix: onClose now clears the "editing this photo" collab
    // cursor on EVERY close path — × / Cancel AND a backdrop click alike.
    // The old comment here ("on every close path (× / Cancel)") was only
    // ever true of the two [data-close] buttons; a backdrop click bypassed
    // the m.close reassignment those relied on and left the cursor
    // broadcasting "still editing" to every other viewer indefinitely.
    var m = openModal(html, 560, function () { broadcastCollabSel(null); });
    var codeWrap = $('pp-e-codes');
    if (codeWrap) Array.prototype.forEach.call(codeWrap.querySelectorAll('input[type=checkbox]'), function (c) {
      c.checked = (r.tags || []).indexOf(c.value) >= 0;
    });
    wireLocationField('pp-e', true);
    wireWorksTagField('pp-e');
    if (window.BIM) BIM.wirePinField('pp-e');
    hydrate(m.el);
    $('pp-e-save').onclick = async function () {
      var reqErr = requiredFieldsMissing('pp-e');
      if (reqErr) { UI.toast(reqErr, 'warn'); return; }
      this.disabled = true;
      var locVals = currentLocValues('pp-e');
      var act = resolveActivity(locVals);
      var worksVal = readWorksTag('pp-e');
      var tradeVal = deriveTradeForWorks(worksVal);
      var pinData = window.BIM ? BIM.readPinField('pp-e') : null;   // item 11 -- read before the modal closes
      var patch = {
        description: $('pp-e-desc').value.trim(),
        taken_at: $('pp-e-date').value || null,
        trades: tradeVal ? [tradeVal] : [],
        works_multi: worksVal ? [worksVal] : [],
        trade: tradeVal,
        works: worksVal || null,
        location: locBreadcrumb(locVals) || null,
        location_values: locVals,
        activity_id: act ? act.id : null,
        activity_name: act ? act.name : null,
        tags: readCodeTags('pp-e'),
        updated_at: new Date().toISOString()
      };
      // Offline-capable metadata edit: apply optimistically, then route through
      // tolerantWrite (PDSync's field-level LWW outbox; queues offline and syncs
      // on reconnect, and retries once without the schedule-link columns if the
      // migration hasn't run). Only metadata changes here — the image is untouched.
      Object.assign(r, patch);
      m.close();   // onClose (passed to openModal above) clears the collab cursor
      fillFilterOptions(); render();
      var w = await tolerantWrite({ table: TABLE, op: 'update', id: r.id, patch: patch });
      if (!w.ok) { UI.toast(w.error ? w.error.message : 'Save failed', 'error'); return; }
      UI.toast(w.queued ? 'Saved on this device — will sync when you reconnect' : 'Photo updated', 'ok');
      if (window.PDSync) PDSync.cachePut('pp:' + pid, rows);
      if (pinData && window.BIM && BIM.savePinForItem) await BIM.savePinForItem('photo', r.id, pinData);
    };

    // Autosave (metadata only — no re-upload involved): debounced re-use of the
    // Save button's own handler, with the modal's close suppressed meanwhile.
    if (window.Autosave) {
      var asInd = document.createElement('span');
      asInd.className = 'pd-autosave pd-autosave-idle';
      asInd.textContent = 'Autosave on';
      var hdr = m.el.querySelector('.pd-modal-header');
      if (hdr) hdr.insertBefore(asInd, hdr.querySelector('.pd-modal-close'));
      var as = Autosave.wire({ root: m.el, modal: m, saveBtn: $('pp-e-save'), indicator: asInd });
      var _ppClose = m.close;
      m.close = function () { as.cancel(); _ppClose(); };
    }
  }

  async function remove(r) {
    var html =
      '<div class="pd-modal-header"><h3>Delete photo</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><p>Delete <strong>' + Fmt.esc(r.description || r.title || 'this photo') +
        '</strong>? The image file is removed from storage too. This cannot be undone.</p></div>' +
      '<div class="pd-modal-footer">' +
        '<button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-danger" id="pp-d-yes">Delete</button></div>';
    var m = openModal(html, 460);
    $('pp-d-yes').onclick = async function () {
      this.disabled = true;
      var res = await sb().from(TABLE).delete().eq('id', r.id);
      if (res.error) { UI.toast(res.error.message, 'error'); this.disabled = false; return; }
      if (r.photo_url) { try { await sb().storage.from(BUCKET).remove([r.photo_url]); } catch (e) {} }
      m.close(); UI.toast('Photo deleted', 'ok');
      await load();
    };
  }

  // Every distinct combination of location values that appears on at least
  // one schedule activity -- these are the "places to visit", the same
  // generalization WBS leaves used to be, now over Location Breakdown values.
  function locCombos() {
    var seen = {}, out = [];
    SCHED_ACTS.forEach(function (a) {
      var loc = a.location || {}, values = {}, any = false;
      LOC_LEVELS.forEach(function (l) { var v = loc[l.id]; if (v) { values[l.id] = v; any = true; } });
      if (!any) return;
      var key = LOC_LEVELS.map(function (l) { return values[l.id] || ''; }).join('␟');
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ key: key, values: values, label: locBreadcrumb(values) });
    });
    return out;
  }

  // Same derivation as locCombos(), sourced from the PHOTO LIBRARY's own
  // location_values instead of the schedule's. A location that was captured
  // before its schedule zone existed (or after the zone was removed) would
  // otherwise be un-pickable by the Report Templates builder (2026-08-29,
  // brief Section 5) even though real photos exist there.
  function photoLocCombos() {
    var seen = {}, out = [];
    rows.forEach(function (r) {
      var lv = r.location_values || {}, values = {}, any = false;
      LOC_LEVELS.forEach(function (l) { var v = lv[l.id]; if (v) { values[l.id] = v; any = true; } });
      if (!any) return;
      var key = LOC_LEVELS.map(function (l) { return values[l.id] || ''; }).join('␟');
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ key: key, values: values, label: locBreadcrumb(values) });
    });
    return out;
  }


  return {
    init: init,
    // The PPR screen shares this module's project selector + trade vocabulary.
    onProject: function (fn) { projectListeners.push(fn); if (pid) fn(pid, projName); },
    trades: function () { return TRADES.slice(); },
    _syncChrome: syncChrome,
    // ⚠️ REAL BUG fixed here (audit pass): index.html's setScreen() only ever
    // called syncChrome() when ENTERING the Photos screen, never when
    // LEAVING it — so the four selection-mode toolbar buttons (Download/
    // Add to Presentation/Archive + the count) stayed visible on top of
    // whichever OTHER screen's own tools were showing (e.g. Presentations'
    // "+ New Presentation"), for as long as a selection was active. Clearing
    // the selection on leaving is also the more honest behaviour — a batch
    // selection is a live, in-progress action tied to being on this screen,
    // not something that should silently survive a tab switch and be acted
    // on later with the planner having forgotten what was checked.
    // ⚠️ Deliberately NOT a call to the full syncChrome(): index.html's
    // setScreen() already runs `show(PHOTO_TOOLS, isPhotos)` to hide
    // pp-add/pp-sep-photos/pp-refresh when leaving — syncChrome()'s OWN
    // `has` branch for those same three ids re-shows them whenever there is
    // no active selection (the normal in-screen "selection just cleared"
    // case), which on leaving would silently UNDO that `show()` call and
    // leave the Photos screen's own Add/Refresh buttons visible on top of
    // whichever other screen is now showing. This only clears the selection
    // state and hides the four selection-only controls, nothing else.
    _leavePhotosScreen: function () {
      selected = {};
      var count = $('pp-selcount'); if (count) count.style.display = 'none';
      ['pp-sel-download', 'pp-sel-addppr', 'pp-sel-archive'].forEach(function (id) {
        var el = $(id); if (el) el.style.display = 'none';
      });
      // #pp-view isn't destroyed when leaving (its screen container is only
      // `hidden`, not emptied), so a checked box or highlighted row from a
      // now-cleared selection would otherwise sit there stale until the
      // grid's next unrelated re-render — visible again the moment the
      // planner comes back, even though `selected` (and the toolbar above)
      // both already correctly read "nothing selected".
      var host = $('pp-view');
      if (host) {
        Array.prototype.forEach.call(host.querySelectorAll('[data-sel]'), function (cb) {
          cb.checked = false;
          var card = cb.closest('.pp-row, .pp-card');
          if (card) card.classList.remove('pp-selrow');
        });
        var selAll = host.querySelector('#pp-selall');
        if (selAll) selAll.checked = false;
      }
    },
    _closeLightbox: closeLightbox,
    _stepLightbox: stepLightbox,
    // Used by the PPR slide editor's "+ Add photos" shortcut: opens the same
    // Add-photos modal used on the Photos screen; onDone(newIds) fires with
    // the newly created photo id(s) once the upload completes, so the slide
    // editor can select the fresh photo without a trip to the Photos tab.
    openUploadForPicker: function (onDone) { openUpload({ onDone: onDone }); },
    photoById: byId,
    // Read by the Report Templates builder (ppr.js) to offer a location picker
    // without duplicating LOC_LEVELS/locBreadcrumb in a second closure.
    locCombos: function () { return locCombos(); },
    photoLocCombos: function () { return photoLocCombos(); },
    // Read by bim.js's Vertical Stacking view (Batch G, item 16) — the same
    // ordered level DEFINITIONS (id/name/sort_order) the Location Breakdown
    // picker itself cascades through, so a stacking band means the same
    // thing there as it does on the Add-photo form.
    locLevels: function () { return LOC_LEVELS.slice(); },
    // Read by the Floor Plan pin picker (bim.js / Phase 5) to offer a photo
    // to pin without a second fetch of the same project's library.
    allPhotos: function () { return rows.slice(); },
    // Signed URL for an arbitrary photo id — used by bim.js's Batch H image
    // registration (it needs the actual pixels of a top-view photo, not just
    // the row) and available generally for the same reason allPhotos() is.
    urlOfPhotoId: function (id) { var r = byId(id); return r ? urlOf(r) : ''; },
    // Shared markup engine (18-item list item 13/14) — ppr.js's own
    // presentation-only overlay reuses this instead of a second canvas
    // implementation. See openMarkupEditor's own comment for the format.
    openMarkupEditor: function (imageUrl, initialMarkup, onSave) { openMarkupEditor(imageUrl, initialMarkup, onSave); },
    // Read-only render of a markup array onto an already-sized <canvas> — used
    // by ppr.js's own presentation-only overlay (a SEPARATE store, keyed by
    // ppr_slide_id+pane) so it never has to duplicate drawMarkupObjects'
    // per-shape drawing code just to display something someone already drew.
    // The canvas's own pixel size (set by the caller from its wrapper's
    // rendered size) is read directly, not assumed — a markup drawn against
    // one aspect ratio must scale correctly onto whatever size the caller
    // gives it, since normalized 0..1 coordinates are all that's stored.
    drawMarkupOnCanvas: function (canvas, objs) {
      if (!canvas || !canvas.getContext) return;
      var ctx = canvas.getContext('2d');
      drawMarkupObjects(ctx, objs || [], canvas.width, canvas.height);
    },
    // Opens a SPECIFIC photo's lightbox regardless of whatever the Photos
    // screen's own filtered view currently holds in `lightboxIds` — see
    // openPhotoById's own definition above (Plan/Stack views use it directly
    // from within this closure; this is the same function, exported for
    // bim.js's own Plans-tab pin clicks).
    openPhotoById: function (id) { return openPhotoById(id); },
    // Test-only hooks (same convention as bim.js's _zoomAnchor) — the
    // legacy-fallback logic in tradesOf/worksOf is exactly the kind of thing
    // worth genuinely EXECUTING rather than only regex-checking, since a
    // subtly wrong empty-array-vs-null check would silently hide a photo's
    // trades on every pre-migration row.
    _tradesOf: function (r) { return tradesOf(r); },
    _worksOf: function (r) { return worksOf(r); },
    // Item 9 (2026-08-29, second feedback round): worth genuinely executing
    // for the same reason — a wrong reverse-lookup here silently mislabels
    // every photo's trade for a group-by/filter that reads it, with nothing
    // in the UI to catch a subtly wrong match. Saves/restores SCHED_ACTS
    // around the call (same save/restore-closure-state convention bim.js's
    // own _stackGrid test hook already uses) so a test can inject a fixture
    // schedule without touching this module's real load path.
    _deriveTradeForWorks: function (worksValue, schedActs) {
      var saved = SCHED_ACTS;
      SCHED_ACTS = schedActs || [];
      try { return deriveTradeForWorks(worksValue); }
      finally { SCHED_ACTS = saved; }
    },
    // Test-only hooks for the Batch C (2026-08-29) 360°/3D media strip — lets
    // test.js genuinely execute the location/date/search filter match and
    // the panorama+reconstruction merge, rather than only regex-checking the
    // source, the same way _tradesOf/_worksOf are exercised above.
    _mediaStripMatches: function (item) { return mediaStripMatches(item); },
    _mediaStripItems: function () { return mediaStripItems(); },
    // Test-only hooks for the markup engine (Batch F, 2026-08-29) — the same
    // convention as every hook above: genuinely EXECUTE the per-shape canvas
    // drawing and the eraser's nearest-object hit test against real objects,
    // rather than only regex-matching the source. A fake ctx recorder (built
    // in test.js) captures which canvas 2D calls actually fired per shape
    // type — the one way to tell "drew a rect" from "silently did nothing".
    _drawMarkupObjects: function (ctx, objs, w, h) { drawMarkupObjects(ctx, objs, w, h); },
    _markupHitTest: function (objs, nx, ny, w, h) { return markupHitTest(objs, nx, ny, w, h); },
    // Item 16 (2026-08-29, second round) — Plan/Stack views relocated here
    // from bim.js. Genuinely EXECUTE the same "as of" cell rule and grid
    // builder bim.js's own tests already proved out, now against THIS
    // file's versions, plus the cluster grouping. Save/restore closure state
    // around each call, same convention as _stackGrid's bim.js predecessor.
    _mostRecentAsOf: function (list, cutoff) { return mostRecentAsOf(list, cutoff); },
    _planClusters: function (pins, monthCutoff) { return planClusters(pins, monthCutoff); },
    _itemDateForPin: function (pin, photosArr) {
      var saved = rows; if (photosArr) rows = photosArr;
      try { return itemDateForPin(pin); } finally { rows = saved; }
    },
    _stackGrid: function (levels, photosArr, rowId, colId, cutoff) {
      var savedLevels = LOC_LEVELS, savedRows = rows;
      LOC_LEVELS = levels; rows = photosArr;
      stackRowLevelId = rowId || null; stackColLevelId = colId || null;
      try { return stackGrid(cutoff); }
      finally { LOC_LEVELS = savedLevels; rows = savedRows; stackRowLevelId = null; stackColLevelId = null; }
    },
    // Test-only hook for the unified List+Gallery grouping (2026-08-29
    // follow-up item 6) — genuinely executes groupRows() with an INJECTED
    // mode, rather than only regex-checking the source, the same convention
    // as every hook above. Saves/restores the real galleryGroupBy so this
    // can't leak state into any other test that runs after it.
    _groupRows: function (list, mode) {
      var saved = galleryGroupBy; galleryGroupBy = mode;
      try { return groupRows(list); } finally { galleryGroupBy = saved; }
    },
    // Test-only hook for the batch-download caption block (item 5) — the
    // exact three lines (desc / trade·works·location / date) every one of
    // the three export formats reads, so a change here provably affects all
    // three rather than only the one format someone happened to test by eye.
    _dlCaptionLines: function (r) { return dlCaptionLines(r); }
  };
})();
