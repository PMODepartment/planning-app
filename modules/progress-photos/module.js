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
  var view = 'gallery';               // list | gallery | plan — gallery is the default landing view (item 1, 2026-08-29 feedback)
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
  var migrationWarnedViewName = false;     // same, for the 2026-08-30 view_name column (item 7)
  var migrationWarnedThumb = false;        // same, for the 2026-08-30 thumb_url column (item 1, round 2)
  var migrationWarnedAdjust = false;       // same, for the 2026-08-30 adjustments column (item 5, round 2)
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
  // ⚠️ 2026-08-30 REAL BUG FOUND AND FIXED HERE — this is why items 9/10
  // ("clicking 360 does nothing", "close and cancel don't work") and half of
  // item 4 ("the markup editor's close/save/cancel buttons don't work") all
  // happened at once: `m.close = close;` below REASSIGNED the modal's own
  // `close` property to this wrapper — but the wrapper's BODY calls
  // `m.close()`, and JS resolves `m.close` at CALL TIME, not at the moment
  // this function was defined. By the time a button was actually clicked,
  // `m.close` no longer pointed at UI.modal()'s real DOM-removal function —
  // it pointed at THIS WRAPPER ITSELF, so `m.close()` called itself,
  // recursed until the stack overflowed, and threw a silent RangeError
  // inside the click handler (browsers log this to the console; nothing
  // reaches the screen). The overlay was never removed, and — critically —
  // any code AFTER the `m.close()` call in a handler (e.g. the 360° button's
  // `if (window.PANO...) PANO.openCapture();`, or the markup editor's Save
  // button calling `onSave(objs)` right after `m.close()`) never ran either,
  // because the throw happened first. The original close function is now
  // captured in `rawClose` BEFORE `m.close` is ever reassigned, and the
  // wrapper calls THAT — never `m.close()` — so it can never call itself.
  function openModal(html, width, onClose) {
    var m = UI.modal(html, { noBackdropClose: true });
    var box = m.el.querySelector('.pd-modal');
    if (box && width) box.style.maxWidth = width + 'px';
    var rawClose = m.close;
    function close() { if (onClose) { try { onClose(); } catch (e) {} } rawClose(); }
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
      localStorage.setItem(uiKey('tilescale'), String(gallerySizeScale));
    } catch (e) {}
  }
  function restoreUI() {
    try {
      // ⚠️ Round-2 item 7 (2026-09-02) removed Stack view — 'stack' is
      // deliberately no longer in this whitelist, so a browser that still
      // has it saved from before this change simply falls through to the
      // 'gallery' default above rather than restoring a view that no
      // longer exists.
      var v = localStorage.getItem(uiKey('view'));
      if (['list', 'gallery', 'plan'].indexOf(v) >= 0) view = v;
      collapsed = JSON.parse(localStorage.getItem(uiKey('collapsed')) || '{}') || {};
      var g = localStorage.getItem(uiKey('gallerygroup'));
      if (['none', 'month', 'trade', 'location'].indexOf(g) >= 0) galleryGroupBy = g;
      var ts = parseFloat(localStorage.getItem(uiKey('tilescale')));
      if (ts && ts >= 0.2 && ts <= 2) gallerySizeScale = ts;
    } catch (e) { collapsed = {}; }
  }
  // Applies the current scale as CSS custom properties on the gallery's own
  // scroll host, so a project switch (which re-runs restoreUI) or a fresh
  // page load both repaint tiles at the right size without waiting for a
  // render pass to touch #pp-tilesize.
  function applyTileScale() {
    var host = document.getElementById('pp-view');
    if (!host) return;
    host.style.setProperty('--pp-tile-min', Math.round(TILE_BASE_MIN * gallerySizeScale) + 'px');
    host.style.setProperty('--pp-tile-h', Math.round(TILE_BASE_H * gallerySizeScale) + 'px');
    var slider = document.getElementById('pp-tilesize');
    if (slider) slider.value = gallerySizeScale;
  }

  // ------------------------------------------------------------------ init ---
  async function init(user, prof) {
    profile = prof; uid = user.id;
    canWrite = ['super_admin', 'admin', 'planner'].indexOf(prof.role) >= 0;
    pid = sessionStorage.getItem('pd_project') || '';
    restoreUI();

    await fillProjects();
    wire();
    applyTileScale();
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
      restoreUI(); applyTileScale(); syncChrome(); notifyProject();
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
    // Tile-size control — Gallery/Tile view only (shown/hidden alongside
    // #pp-groupby's own view-based visibility, in render()). Drags the scale
    // live via CSS vars on #pp-view; no re-render needed since nothing about
    // the tile MARKUP changes, only its size.
    if ($('pp-tilesize')) {
      $('pp-tilesize').value = gallerySizeScale;
      $('pp-tilesize').oninput = function () {
        gallerySizeScale = parseFloat(this.value) || 1 / 3;
        applyTileScale();
      };
      $('pp-tilesize').onchange = function () { saveUI(); };
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
    // Item 2: the topbar search box IS the real search field now — it drives
    // `filters.search` directly (the panel's own #pp-f-search stays hidden,
    // kept only so any other code reading it by id still finds a value).
    if ($('pp-topsearch')) $('pp-topsearch').oninput = function () {
      filters.search = this.value;
      var hidden = $('pp-f-search'); if (hidden) hidden.value = this.value;
      render();
    };
    if ($('pp-topfilttoggle')) $('pp-topfilttoggle').onclick = function () {
      var wrap = $('pp-filters'); if (!wrap) return;
      wrap.classList.toggle('open');
      this.classList.toggle('is-active', wrap.classList.contains('open'));
    };
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
      if ($('pp-topsearch')) $('pp-topsearch').value = '';
      renderLocFilterSelects();
      render();
    };
    // Fifth round item 7: reflects and flips the same shared preference
    // thumb()/paintThumbMarkups() and the lightbox's own toggle all read.
    if ($('pp-mkvistoggle')) {
      syncMkVisBtn();
      $('pp-mkvistoggle').onclick = function () { setMarkupGlobalVisible(!markupGlobalVisible()); syncMkVisBtn(); render(); };
    }
    // Fifth round item 1: "+ Add media" is now a dropdown deciding the media
    // type UP FRONT — Photo/Video open the same modal pre-set to that type
    // (mediaTypeSelectorHTML/wireMediaTypeSelector both take the preset now).
    // ⚠️ 2026-09-02: 360° is `disabled` in the menu markup now (discontinued
    // — see index.html), so it carries no `data-addtype` any more and this
    // loop only ever wires Photo/Video; 3D stays disabled as before.
    if ($('pp-add')) $('pp-add').onclick = function (e) {
      e.stopPropagation();
      var menu = $('pp-addmenu');
      if (!menu) { openUpload(); return; } // defensive fallback if the menu markup is ever missing
      menu.hidden = !menu.hidden;
    };
    if ($('pp-addmenu')) {
      Array.prototype.forEach.call($('pp-addmenu').querySelectorAll('[data-addtype]'), function (b) {
        b.onclick = function () {
          $('pp-addmenu').hidden = true;
          openUpload({ mtype: this.dataset.addtype });
        };
      });
      document.addEventListener('click', function (e) {
        var wrap = $('pp-addmenu-wrap'), menu = $('pp-addmenu');
        if (wrap && menu && !menu.hidden && !wrap.contains(e.target)) menu.hidden = true;
      });
    }
    $('pp-refresh').onclick = function () { load(); };
    if ($('pp-sync')) $('pp-sync').onclick = function () { flushQueue(); };
    if ($('pp-genthumbs')) $('pp-genthumbs').onclick = function () { backfillThumbnails(); };
    wireSelBar();
    wireLightboxMagnifier();
    wireLightboxKpResizeDrag();

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
    // selection is active. Fifth round item 1: targets the whole
    // pp-addmenu-wrap now (button + its dropdown), not just the button — the
    // dropdown menu is a sibling of the button, not a child, so hiding only
    // the button could leave an already-open menu visually stranded.
    var hideAdd = (has || !canWrite) ? 'none' : '';
    if ($('pp-addmenu') && hideAdd === 'none') $('pp-addmenu').hidden = true;
    ['pp-addmenu-wrap', 'pp-sep-photos'].forEach(function (id) {
      var el = $(id); if (el) el.style.display = hideAdd;
    });
    var refresh = $('pp-refresh'); if (refresh) refresh.style.display = has ? 'none' : '';
    var count = $('pp-selcount');
    if (count) { count.style.display = has ? '' : 'none'; count.textContent = ids.length + ' selected'; }
    ['pp-sel-download', 'pp-sel-addppr', 'pp-sel-archive', 'pp-sel-delete'].forEach(function (id) {
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

    // ⚠️ Real perf fix, the other half of signAll()'s own comment: this used
    // to AWAIT signAll() (a Storage round-trip signing every path in the
    // project) — plus PANO/RECON's own loads — before render() ever ran
    // once, so the grid sat on "Loading photos…" for the WHOLE signing
    // round-trip even though rows (small JSON, already in hand) is all a
    // first paint actually needs. render() now runs the moment rows are
    // fetched+sorted — the grid paints with its existing placeholder
    // (.pp-noimg) for anything not yet signed — and signing/PANO/RECON load
    // happen in the background, triggering ONE follow-up render() once they
    // resolve to fill in real thumbnails. fillFilterOptions() also needs
    // PANO/RECON's data (item 6 unifies them into one grouped grid), so it
    // moves to the background pass too.
    fillFilterOptions();
    render();
    await Promise.all([
      signAll(),
      // Batch C (2026-08-29): the Gallery feed is UNIFIED (photos/videos +
      // panoramas + done 3D reconstructions, one grid) — load the other two
      // modules' data alongside this module's own so the merge has
      // something to merge. Each call is a no-op once already loaded, so
      // switching between screens and back doesn't re-fetch every time.
      (window.PANO && PANO.ensureLoaded) ? PANO.ensureLoaded() : Promise.resolve(),
      (window.RECON && RECON.ensureLoaded) ? RECON.ensureLoaded() : Promise.resolve()
    ]);
    fillFilterOptions();
    render();
  }

  // Batch-sign every photo path in one request rather than one call per row.
  // Item 1 (2026-08-30, fourth round): thumbUrlOf() now prefers a REAL,
  // separately-uploaded small file (`r.thumb_url`, produced client-side at
  // upload time by uploadThumbnailFor) over Supabase Storage's image-
  // transform add-on (`THUMB_OPTS` below) — the transform approach silently
  // degrades to full-res the moment that add-on isn't enabled on the
  // project's plan (its own comment already said so), which is
  // indistinguishable from "still slow" and is why this kept recurring as
  // feedback. The transform request is KEPT as a second-line fallback for
  // rows captured before this feature existed (no `thumb_url` yet) — those
  // still get whatever speed-up the add-on can offer, or degrade further to
  // full-res exactly as before if it can't. `thumb_url` paths are signed in
  // the SAME batch as photo_url/key_plan_url, since a thumbnail is just
  // another object in the same bucket, not a special request shape.
  var thumbCache = {};
  // Fifth round item 9: shrunk 480->320 (and the client-generated
  // THUMB_MAXW/THUMB_JPEG_Q below to match) after "still slow" feedback even
  // with real client-side thumbnails already in place — the largest tile
  // this now needs to look sharp at is the new 3-column phone Gallery grid
  // (~125px per tile), not the old single-column layout it was originally
  // sized for. ⚠️ Kept as two independent constants, same as before — see
  // THUMB_MAXW's own comment for why they can't share one without a
  // file-ordering hazard — so BOTH must be changed together if this is
  // revisited again.
  var THUMB_OPTS = { transform: { width: 320, quality: 50, resize: 'contain' } };
  // ⚠️ REAL PERF FIX (owner: "gallery tile view... still loading slowly...
  // full load only when opening the photo"). Three real, compounding causes
  // were found by reading this function, not assumed:
  // 1. It re-signed EVERY path from scratch on every call (urlCache/
  //    thumbCache wiped first) — switching projects back and forth, or any
  //    filter change that re-triggers load(), re-requested signed URLs for
  //    photos already resolved a moment ago. Caches are now kept across
  //    calls; only paths NOT already cached are ever requested again.
  // 2. It signed every row's FULL-RESOLUTION `photo_url` up front, for the
  //    WHOLE project, even though the grid only ever displays the THUMBNAIL
  //    (thumbUrlOf). Full-res is now signed lazily, on demand, by
  //    ensureFullUrl() below — only when a specific photo is actually
  //    opened (lightbox, edit form, download, export) — "full load only
  //    when opening the photo", literally.
  // 3. It requested a Storage-transform thumbnail (THUMB_OPTS — real
  //    per-image transform compute on Supabase's side) for EVERY row's
  //    photo_url, including rows that already have a real, cheap,
  //    client-generated `thumb_url` from item 1's backfill and every
  //    upload since 2026-08-30 — pure waste for the (hopefully large,
  //    post-backfill) majority of rows. The transform fallback is now only
  //    requested for rows genuinely missing thumb_url.
  // The two remaining requests (plain sign for thumb_url+key_plan_url, and
  // the narrowed transform fallback) run in PARALLEL (Promise.all), not
  // sequentially — halves the wall-clock cost of whatever signing is still
  // needed.
  async function signAll() {
    var plainPaths = [], transformPaths = [];
    rows.forEach(function (r) {
      [r.thumb_url, r.key_plan_url].forEach(function (p) {
        if (p && !urlCache[p] && plainPaths.indexOf(p) < 0) plainPaths.push(p);
      });
      // Only the transform-fallback rows need their photo_url signed at
      // all for the GRID — a row with a real thumb_url never needs its
      // full photo re-derived into a second, redundant small copy.
      if (!r.thumb_url && r.photo_url && !thumbCache[r.photo_url] && transformPaths.indexOf(r.photo_url) < 0) {
        transformPaths.push(r.photo_url);
      }
    });
    var jobs = [];
    if (plainPaths.length) {
      jobs.push(sb().storage.from(BUCKET).createSignedUrls(plainPaths, SIGN_TTL).then(function (res) {
        if (res.error) { UI.toast('Could not load photo previews: ' + res.error.message, 'warn'); return; }
        (res.data || []).forEach(function (d) { if (d && d.signedUrl && !d.error) urlCache[d.path] = d.signedUrl; });
      }));
    }
    if (transformPaths.length) {
      jobs.push(sb().storage.from(BUCKET).createSignedUrls(transformPaths, SIGN_TTL, THUMB_OPTS).then(function (tres) {
        if (!tres.error) (tres.data || []).forEach(function (d) { if (d && d.signedUrl && !d.error) thumbCache[d.path] = d.signedUrl; });
      }).catch(function () { /* transform add-on unavailable — thumbOf() falls back to urlOf() below */ }));
    }
    if (jobs.length) await Promise.all(jobs);
  }
  // On-demand, single-path signing for the cases that genuinely need the
  // FULL-resolution image — never called from the grid/load path itself.
  // Cached in the SAME urlCache signAll() already uses, so a photo signed
  // here (e.g. opened in the lightbox) never gets re-signed if the grid
  // later needs its thumbnail fallback, or vice versa.
  var fullUrlInFlight = {};   // path -> Promise, so a rapid double-open can't fire two sign requests for the same photo
  async function ensureFullUrl(r) {
    if (!r || !r.photo_url) return '';
    if (urlCache[r.photo_url]) return urlCache[r.photo_url];
    if (fullUrlInFlight[r.photo_url]) return fullUrlInFlight[r.photo_url];
    var p = sb().storage.from(BUCKET).createSignedUrl(r.photo_url, SIGN_TTL).then(function (res) {
      delete fullUrlInFlight[r.photo_url];
      if (res.error || !res.data) return '';
      urlCache[r.photo_url] = res.data.signedUrl;
      return res.data.signedUrl;
    }).catch(function () { delete fullUrlInFlight[r.photo_url]; return ''; });
    fullUrlInFlight[r.photo_url] = p;
    return p;
  }
  // ⚠️ Synchronous, best-effort only — returns the cached full-res URL if
  // one already exists (e.g. ensureFullUrl() was already awaited elsewhere
  // for this same photo), else '' without triggering a fetch. Every call
  // site that actually needs full-resolution on demand (lightbox, download,
  // export, edit form, urlOfPhotoId, the Stack hover magnifier) awaits
  // ensureFullUrl() instead; this now exists mainly so an ALREADY-resolved
  // photo (a repeat view, or one another call site already signed) can be
  // read back cheaply with no promise overhead — e.g. resolved video tiles
  // and the thumb()/thumbUrlOf() fallback chain below.
  function urlOf(r) { return r.photo_url ? (urlCache[r.photo_url] || '') : ''; }
  function thumbUrlOf(r) {
    if (r.thumb_url && urlCache[r.thumb_url]) return urlCache[r.thumb_url];
    if (r.photo_url && thumbCache[r.photo_url]) return thumbCache[r.photo_url];
    return r.photo_url ? (urlCache[r.photo_url] || '') : '';
  }

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
  // ---- Works: multi-select from the schedule's activity groups -----------
  // 2026-08-30 feedback item 6: REVERSES the single schedule-derived tag
  // (2026-08-29 item 9) back to a genuine multi-select — "remove the
  // dropdown and replace with an add works button. When clicked, the module
  // retrieves the activities in the project-defined groups. Users can then
  // select multiple activities." Trade is still never picked directly — it's
  // derived from whichever activities are chosen (now unioned across all of
  // them, since a slide can now legitimately span more than one trade).
  // A photo's trades/works, tolerant of every era's rows this file has ever
  // written: pre-migration singular columns, the 2026-08-29 multi-select
  // checkboxes, and the single-tag era in between — all still read correctly.
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
  // Union of every derived trade across a set of chosen Works values — a
  // photo naming activities from two disciplines now legitimately carries
  // two trades, rather than only ever the first one's.
  function deriveTradesForWorksList(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (v) {
      var t = deriveTradeForWorks(v);
      if (t && !seen[t]) { seen[t] = 1; out.push(t); }
    });
    return out;
  }
  // Whether the project's schedule actually offers anything to pick — this is
  // the "if the schedule has not been set-up" test the Works field's own
  // required-ness hinges on (requiredFieldsMissing, below): SCHED_ACTS being
  // empty means there is no schedule integration to speak of, not merely
  // that today's picked Trade/phase filters narrowed it to nothing.
  function scheduleHasActivities() { return SCHED_ACTS.length > 0; }
  // Every distinct schedule activity NAME eligible as a Works value, bucketed
  // by its work_type ("the project-defined activity groups") — the same
  // exec/closeout + non-milestone scoping distinctScheduleWorks() already
  // applies, just grouped instead of flattened into one list. A trailing
  // "Previously used" bucket carries any value a planner already typed that
  // matches no live schedule activity (free text from before this
  // integration, or an activity since renamed/removed) — never silently
  // dropped from what can still be picked.
  function worksGroupedOptions() {
    var byGroup = {}, order = [];
    SCHED_ACTS.forEach(function (a) {
      if (a.activity_type === 'Start Milestone' || a.activity_type === 'Finish Milestone') return;
      if (!inExecOrCloseout(a)) return;
      var name = (a.activity_name || '').trim();
      if (!name) return;
      var group = (a.work_type || '').trim() || 'Other';
      if (!byGroup[group]) { byGroup[group] = {}; order.push(group); }
      byGroup[group][name] = true;
    });
    var already = {};
    order.forEach(function (g) { Object.keys(byGroup[g]).forEach(function (n) { already[n] = true; }); });
    var extra = distinctCapturedWorks().filter(function (v) { return !already[v]; });
    if (extra.length) {
      byGroup['Previously used'] = {};
      extra.forEach(function (v) { byGroup['Previously used'][v] = true; });
      order.push('Previously used');
    }
    return order.map(function (g) { return { group: g, items: Object.keys(byGroup[g]).sort() }; });
  }
  // Picker state is in-memory, per idPrefix ('pp' for Add, 'pp-e' for Edit) —
  // the same scoping convention every other embeddable field in this form
  // already uses (locFieldsHTML, BIM.pinFieldHTML).
  var _worksSel = {};
  function worksSelOf(idPrefix) { return (_worksSel[idPrefix] || []).slice(); }
  function worksChipsHTML(idPrefix) {
    var sel = worksSelOf(idPrefix);
    if (!sel.length) return '<p class="pp-hint">No works selected yet.</p>';
    return '<div class="pp-workschosen">' + sel.map(function (v) {
      return '<span class="pp-workschip">' + Fmt.esc(v) +
        '<button type="button" data-removework="' + Fmt.esc(v) + '" title="Remove" aria-label="Remove ' + Fmt.esc(v) + '">' +
        '<span data-ico="x" data-ico-size="11"></span></button></span>';
    }).join('') + '</div>';
  }
  function worksMultiFieldHTML(idPrefix, existingWorks) {
    _worksSel[idPrefix] = (existingWorks || []).slice();
    return '<div id="' + idPrefix + '-worksfield">' + worksChipsHTML(idPrefix) +
      '<button type="button" class="pd-btn" id="' + idPrefix + '-worksadd">+ Add works</button></div>';
  }
  function repaintWorksChips(idPrefix) {
    var host = $(idPrefix + '-worksfield'); if (!host) return;
    host.innerHTML = worksChipsHTML(idPrefix) +
      '<button type="button" class="pd-btn" id="' + idPrefix + '-worksadd">+ Add works</button>';
    wireWorksMultiField(idPrefix);
    hydrate(host);
  }
  function openWorksPicker(idPrefix) {
    var groups = worksGroupedOptions();
    var chosen = {}; worksSelOf(idPrefix).forEach(function (v) { chosen[v] = true; });
    var html =
      '<div class="pd-modal-header"><h3>Add works</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        (groups.length
          ? '<div class="pp-worksgrid">' + groups.map(function (g) {
              return '<div class="pp-worksgroup"><span class="pp-worksgroup-name">' + Fmt.esc(g.group) + '</span>' +
                g.items.map(function (v) {
                  return '<label class="pp-worksitem"><input type="checkbox" value="' + Fmt.esc(v) + '"' +
                    (chosen[v] ? ' checked' : '') + ' /> ' + Fmt.esc(v) + '</label>';
                }).join('') + '</div>';
            }).join('') + '</div>'
          : '<p class="pp-hint">No schedule activities are set up for this project yet — Works can be left blank.</p>') +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="pp-works-done">Done</button></div>';
    var m = openModal(html, 480);
    $('pp-works-done').onclick = function () {
      var picked = Array.prototype.map.call(m.el.querySelectorAll('input[type=checkbox]:checked'), function (c) { return c.value; });
      _worksSel[idPrefix] = picked;
      m.close();
      repaintWorksChips(idPrefix);
    };
  }
  function wireWorksMultiField(idPrefix) {
    var addBtn = $(idPrefix + '-worksadd');
    if (addBtn) addBtn.onclick = function () { openWorksPicker(idPrefix); };
    var host = $(idPrefix + '-worksfield');
    if (host) Array.prototype.forEach.call(host.querySelectorAll('[data-removework]'), function (b) {
      b.onclick = function () {
        _worksSel[idPrefix] = worksSelOf(idPrefix).filter(function (v) { return v !== b.dataset.removework; });
        repaintWorksChips(idPrefix);
      };
    });
  }
  function readWorksMulti(idPrefix) { return worksSelOf(idPrefix); }
  function fillFilterOptions() {
    function fill(id, list, blank) {
      var el = $(id); if (!el) return;
      var keep = el.value;
      el.innerHTML = '<option value="">' + blank + '</option>' + list.map(function (v) {
        return '<option' + (v === keep ? ' selected' : '') + '>' + Fmt.esc(v) + '</option>';
      }).join('');
      if (list.indexOf(keep) < 0) el.value = '';
    }
    fill('pp-f-trade', distinctMulti('trades', 'trade'), 'Trade');
    fill('pp-f-works', distinctMulti('works_multi', 'works'), 'Works');
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
      // Item 8 (owner feedback): just the level's own name — "Filter by "
      // is implied by sitting inside the filter panel and only added noise.
      return '<select class="pd-select" data-lvl="' + l.id + '" title="' + Fmt.esc(l.name) + '">' +
        '<option value="">' + Fmt.esc(l.name) + '</option>' +
        vals.map(function (v) { return '<option' + (v === cur ? ' selected' : '') + '>' + Fmt.esc(v) + '</option>'; }).join('') +
        '</select>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('select'), function (sel) {
      sel.onchange = function () { filters.locValues[sel.dataset.lvl] = sel.value; render(); };
    });
  }

  // --------------------------------------------------------------- filter ---
  // Items 6+8 (current round): "in gallery tile view, 360, 3D and video
  // should not be grouped separately. it should be included with the normal
  // grouping whether by date or what" + "add select options for the 360 or
  // video... provide option to edit all details." Panoramas/reconstructions
  // used to render in a separate `#pp-media-strip` below the grid
  // (mediaStripMatches/mediaStripItems, both retired below); they now flow
  // through the SAME filter/group/select/thumb pipeline as ordinary photos,
  // as normalized "pseudo-rows" (`_kind`/`_src`, real underlying row on
  // `_src`) — one filter predicate serves both real rows and pseudo-rows so
  // the two families can never silently disagree about what's "visible".
  //
  // A pseudo-row's `id` is PREFIXED ("pano:<uuid>"/"recon:<uuid>") so it can
  // share the same `selected{}`/checkbox/lightbox machinery as a real photo
  // id without ever colliding with one — every place that WRITES against an
  // id (archive/delete/the progress_photos table) has to branch on `_kind`
  // first; see byMergedId()/openMediaKindEditor()/the batch-action handlers.
  function matchesFilters(r) {
    // "Show archived" is additive, not an either/or toggle: unchecked hides
    // archived items (the normal, tidy view); checked shows BOTH archived
    // and unarchived together, so a planner can see everything at once
    // instead of the view flipping to archived-only.
    if (!filters.archived && r.archived) return false;
    // Panoramas/reconstructions carry no trade/works at all -- a trade or
    // works filter being SET therefore excludes them rather than silently
    // matching everything, so "Structural Works only" genuinely narrows to
    // structural photos and doesn't leave an unrelated 360° tile sitting in
    // the middle of the filtered grid.
    if (filters.trade) {
      if (r._kind) return false;
      // A photo now carries MULTIPLE trades/works (2026-08-29 feedback item
      // 2) -- the filter matches if the picked value is ANY of the row's
      // values, checking both the new array column and the legacy singular
      // one (tradesOf/worksOf), not requiring an exact single-value match.
      if (tradesOf(r).indexOf(filters.trade) < 0) return false;
    }
    if (filters.works) {
      if (r._kind) return false;
      if (worksOf(r).indexOf(filters.works) < 0) return false;
    }
    // A location filter is satisfied when every ACTIVE level filter matches
    // the item's own recorded value at that level (AND across levels).
    var lv = r.location_values || {};
    var locOk = Object.keys(filters.locValues || {}).every(function (lid) {
      var want = filters.locValues[lid];
      return !want || (lv[lid] || '') === want;
    });
    if (!locOk) return false;
    if (filters.from && (!r.taken_at || r.taken_at < filters.from)) return false;
    if (filters.to && (!r.taken_at || r.taken_at > filters.to)) return false;
    var q = filters.search.trim().toLowerCase();
    if (q) {
      // A pseudo-row's own kind label ("360° panorama"/"3D scan") is in the
      // haystack too, so typing "360" or "3d" into the search box finds
      // every capture of that kind even when its description is blank.
      var hay = (r._kind
        ? [r.location, r.description, r._kind === 'panorama' ? '360 panorama' : '3d scan']
        : [r.description, r.title, r.view_name].concat(tradesOf(r), worksOf(r), [r.location])
      ).join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }
  function visible() { return rows.filter(matchesFilters); }

  // Normalizes a panorama row into the same shape the photo pipeline reads
  // (taken_at / location / location_values / archived / trades / works_multi
  // / description), prefixing its id so it can share `selected{}` with real
  // photos without colliding. `_src` keeps the real underlying row for
  // anything that needs it (PANO.open, the edit-details modal). `description`
  // carries a readable label for the List/Gallery grid's own Description
  // column, since neither table has a photo-shaped caption field.
  function panoPseudoRow(p) {
    return {
      id: 'pano:' + p.id, _kind: 'panorama', _src: p,
      taken_at: p.taken_at || (p.created_at || '').slice(0, 10),
      location: p.location || '', location_values: p.location_values || {},
      archived: !!p.archived, description: '360° panorama', title: '', view_name: '',
      trades: [], works_multi: [],
    };
  }
  function reconPseudoRow(r) {
    return {
      id: 'recon:' + r.id, _kind: 'reconstruction', _src: r,
      taken_at: (r.created_at || '').slice(0, 10),
      location: r.location || '', location_values: r.location_values || {},
      archived: !!r.archived, description: r.requested_note ? '3D scan — ' + r.requested_note : '3D scan',
      title: '', view_name: '', trades: [], works_multi: [],
    };
  }
  function panoPseudoRows() {
    return (window.PANO && PANO.list ? PANO.list() : []).map(panoPseudoRow);
  }
  function reconPseudoRows() {
    // Only DONE reconstructions have anything to show/open — a pending or
    // in-progress request has no viewable result yet, matching the old
    // media-strip's own `RECON.doneList()` scope.
    return (window.RECON && RECON.doneList ? RECON.doneList() : []).map(reconPseudoRow);
  }
  // The merged, filtered set the Gallery grid actually renders — real photos
  // plus panorama/reconstruction pseudo-rows, one filter predicate over all
  // of them (see matchesFilters' comment above for why trade/works exclude
  // pseudo-rows rather than matching them unconditionally).
  function mergedRows() {
    return rows.concat(panoPseudoRows(), reconPseudoRows()).filter(matchesFilters);
  }
  // Resolves a merged-grid id (real OR prefixed) back to its row — used by
  // anything that needs to act on a clicked/selected tile regardless of kind.
  function byMergedId(id) {
    if (typeof id === 'string' && id.indexOf('pano:') === 0) {
      var p = (window.PANO && PANO.list ? PANO.list() : []).filter(function (x) { return x.id === id.slice(5); })[0];
      return p ? panoPseudoRow(p) : null;
    }
    if (typeof id === 'string' && id.indexOf('recon:') === 0) {
      var rc = (window.RECON && RECON.doneList ? RECON.doneList() : []).filter(function (x) { return x.id === id.slice(6); })[0];
      return rc ? reconPseudoRow(rc) : null;
    }
    return byId(id);
  }

  // Item 8: "add select options for the 360 or video. only when clicked
  // like the photos, provide option to edit all details." A panorama/
  // reconstruction has far fewer editable fields than a photo — no trade,
  // works, or free-text description; `panoramas` stores
  // location_values/taken_at/source, `reconstruction_requests` stores
  // location_values/requested_note/video_source (see each file's own insert
  // payload) — so this edits exactly those, never invents new columns.
  // Reached from the small pencil icon on a merged-grid tile
  // (mediaKindThumbHTML's [data-mkedit]); clicking the TILE itself still
  // opens the real viewer (PANO.open/RECON.openById) — this is the separate,
  // dedicated "edit all details" path the tile's own viewer has no UI for.
  function openMediaKindEditor(row) {
    var isPano = row._kind === 'panorama';
    var src = row._src;
    var locVals = Object.assign({}, src.location_values || {});
    function locLine() {
      return Object.keys(locVals).length
        ? '<div class="pp-locchosen"><span data-ico="mapPin" data-ico-size="15"></span><strong>' +
            Fmt.esc(locBreadcrumb(locVals)) + '</strong></div>'
        : '<p class="pp-hint">No location selected yet.</p>';
    }
    var html =
      '<div class="pd-modal-header"><h3>Edit ' + (isPano ? '360° panorama' : '3D scan') + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<div class="pp-span2 pp-wbssection"><label>Location</label>' +
          '<div id="pp-mked-locfield">' + locLine() + '</div></div>' +
        '<div class="pd-field pp-span2"><button type="button" class="pd-btn" id="pp-mked-locbtn">Change location…</button></div>' +
        (isPano
          ? '<div class="pd-field"><label>Capture date</label>' +
              '<input class="pd-input" type="date" id="pp-mked-date" value="' + Fmt.esc(src.taken_at || '') + '" /></div>' +
            '<div class="pd-field"><label>Source</label><select class="pd-select" id="pp-mked-source">' +
              '<option value="ground"' + (src.source !== 'drone' ? ' selected' : '') + '>Ground (staff phone)</option>' +
              '<option value="drone"' + (src.source === 'drone' ? ' selected' : '') + '>Drone (aerial)</option>' +
            '</select></div>'
          : '<div class="pd-field pp-span2"><label>Note</label>' +
              '<textarea class="pd-input" id="pp-mked-note" rows="3">' + Fmt.esc(src.requested_note || '') + '</textarea></div>' +
            '<div class="pd-field"><label>Source</label><select class="pd-select" id="pp-mked-source">' +
              '<option value="ground"' + (src.video_source !== 'drone' ? ' selected' : '') + '>Ground (staff phone)</option>' +
              '<option value="drone"' + (src.video_source === 'drone' ? ' selected' : '') + '>Drone (aerial)</option>' +
            '</select></div>') +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        (canWrite ? '<button type="button" class="pd-btn pd-btn-primary" id="pp-mked-save">Save</button>' : '') +
      '</div>';
    var m = openModal(html, 480);
    hydrate(m.el);
    if ($('pp-mked-locbtn')) $('pp-mked-locbtn').onclick = function () {
      openGenericLocationPicker(function (values) {
        locVals = values;
        var f = $('pp-mked-locfield');
        if (f) { f.innerHTML = locLine(); hydrate(f); }
      });
    };
    if ($('pp-mked-save')) $('pp-mked-save').onclick = async function () {
      var patch = { location_values: locVals, location: Object.keys(locVals).length ? locBreadcrumb(locVals) : null };
      if (isPano) {
        if ($('pp-mked-date')) patch.taken_at = $('pp-mked-date').value || null;
        if ($('pp-mked-source')) patch.source = $('pp-mked-source').value;
      } else {
        if ($('pp-mked-note')) patch.requested_note = $('pp-mked-note').value.trim() || null;
        if ($('pp-mked-source')) patch.video_source = $('pp-mked-source').value;
      }
      var table = isPano ? 'panoramas' : 'reconstruction_requests';
      var w = await tolerantWrite({ table: table, op: 'update', id: src.id, patch: patch });
      if (!w.ok) { UI.toast((w.error && w.error.message) || 'Could not save', 'error'); return; }
      // The underlying array PANO.list()/RECON.doneList() return is a
      // .slice() of the module's own live objects — `src` IS that same
      // object reference, so mutating it here updates every future
      // panoPseudoRow()/reconPseudoRow() read of it too, with no separate
      // reload/refresh call needed on pano.js/recon.js.
      Object.keys(patch).forEach(function (k) { src[k] = patch[k]; });
      m.close();
      UI.toast('Saved', 'ok');
      render();
    };
  }

  // --------------------------------------------------------------- render ---
  function render() {
    var host = $('pp-view');
    // Items 6+8: List/Gallery now render the MERGED set (real photos + the
    // panorama/reconstruction pseudo-rows from mergedRows()) — there's no
    // longer a separate strip below the grid for those two kinds.
    var list = mergedRows();
    // The lightbox is a photo/video-only viewer (markup, adjustments, the
    // edit/download cluster) — it never opens a panorama/reconstruction, so
    // its own prev/next chain stays scoped to real rows only. A pseudo-row
    // tile dispatches straight to PANO.open/RECON.openById instead (see
    // wireRows' [data-act]/[data-rowopen] handlers), never into the lightbox.
    lightboxIds = list.filter(function (r) { return !r._kind; }).map(function (r) { return r.id; });
    syncGenThumbsBtn();

    // The count + view toggle live in the static list bar (Drawing Register's
    // .dr-listbar pattern), so they don't get rebuilt on every render.
    // ⚠️ Sixth round item 4: this used to show the GALLERY's own filtered
    // count (list.length of rows.length) UNCONDITIONALLY, even in Plan
    // view — which read PROJECT-WIDE data narrowed by its OWN floor/month/
    // location-level filters, not this count's `list`/`rows` at all. That's
    // exactly the reported "Showing 3 of 3 photos" sitting above a Plan
    // toolbar correctly saying "2 pinned items" for the SAME screen. Rather
    // than try to keep two separately-computed counts in sync (a second way
    // for them to disagree again the next time either filter changes), this
    // bar is blank in Plan view — it already states its own count in its
    // own toolbar ("N pinned items") — and only ever describes the Gallery
    // grid it's the header of.
    // Total now spans every merged kind (real photos + panoramas + 3D scans),
    // matching what `list`/mergedRows() actually draws from — "N of M" must
    // describe the SAME grid it sits above, or a project with mostly
    // panoramas/scans would read as if most of its media didn't exist.
    var total = rows.length +
      (window.PANO && PANO.list ? PANO.list().length : 0) +
      (window.RECON && RECON.doneList ? RECON.doneList().length : 0);
    var count = $('pp-count');
    if (count) {
      count.textContent = (total && view !== 'plan')
        ? 'Showing ' + list.length + ' of ' + total + ' item' + (total === 1 ? '' : 's')
        : '';
    }
    var listbar = document.querySelector('.pp-listbar');
    if (listbar) listbar.style.visibility = total ? '' : 'hidden';
    // Keep the shared group-by select in step — restoreUI() can change
    // galleryGroupBy on a project switch after wire()'s one-time setup ran.
    if ($('pp-groupby')) $('pp-groupby').value = galleryGroupBy;
    // Group-by has no meaning in Plan view (clustered by floor-plan
    // position) — hidden rather than left visible and silently inert.
    var gbField = $('pp-groupby') && $('pp-groupby').closest('.pp-groupby');
    if (gbField) gbField.style.display = (view === 'plan') ? 'none' : '';
    // Tile size only means anything in Gallery/Tile view — List rows and
    // Plan pins each size themselves differently.
    var tsField = $('pp-tilesize') && $('pp-tilesize').closest('.pp-tilesizefield');
    if (tsField) tsField.style.display = view === 'gallery' ? '' : 'none';

    // Clear-filters only shows when a filter is actually set (no orphan button).
    var anyFilter = ['from', 'to', 'trade', 'works', 'search'].some(function (k) { return filters[k]; }) ||
      Object.keys(filters.locValues || {}).some(function (k) { return filters.locValues[k]; });
    var clr = $('pp-clearfilters');
    if (clr) clr.hidden = !anyFilter;

    // Plan view reads PROJECT-WIDE data (every pin), not the filtered `list`
    // above — the same scope its bim.js original always had. It bypasses the
    // row/filter empty-states below, which describe the filtered Gallery
    // grid and don't apply here (a project can have zero photos matching
    // the current filter and still have a floor plan worth showing).
    if (view === 'plan') {
      host.innerHTML = renderPlanView();
      hydrate(host);
      wirePlanView();
      syncChrome();
      return;
    }

    if (!total) {
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
    paintThumbMarkups(host);
    observeLazyVideos(host);
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
  var galleryGroupBy = 'month';   // none | month (default) | trade | location
  // The sentinel group key groupRows() returns for "None" (item 6) — a single
  // bucket holding every row, unsorted. Every real key groupKeyOf() can
  // produce is a month ("YYYY-MM" or "Undated"), a trade name or "Untagged",
  // or a location string or "Unassigned" -- none of which is this literal, so
  // the renderers can test g.key === NO_GROUP_KEY to decide whether to print
  // a group header at all.
  var NO_GROUP_KEY = '__none__';

  // Tile-size control (Gallery/Tile view only). A scale factor applied to the
  // BASE tile geometry (290px min-width, 210px photo height — the sizes the
  // grid always used) via CSS custom properties, so the control never has to
  // know the underlying px values and the CSS never has to know the scale.
  // ⚠️ Default is 1/3 — denser than the fixed size this view always rendered
  // at before the control existed — per the owner's ask; dragging back up to
  // 1.0 reproduces the old fixed tile size exactly.
  var TILE_BASE_MIN = 290, TILE_BASE_H = 210;
  var gallerySizeScale = 1 / 3;

  // ---- Plan view (item 16 — relocated here from the Plans tab's own Map
  // mode, item 15 having removed it from there). Reads project-wide data
  // (every pin / every location-tagged photo), NOT the Gallery's own
  // filtered `list` — the same scope the original in bim.js always had (it
  // read ProgressPhotos.allPhotos()/locLevels(), which from inside this file
  // is simply `rows`/`LOC_LEVELS` directly). ⚠️ Stack view (the sibling
  // Location-Breakdown grid this same comment used to describe) is REMOVED
  // entirely — Round-2 item 7 (2026-09-02, owner: "remove stack view for the
  // photos") — see the retirement note above stackRowSort/stackGrid's old
  // location, further down this file, for what was deleted and why nothing
  // was left half-retired.
  var planFloorId = null;                 // which floor_plans row Plan view is showing
  var planMonth = null;                   // 'YYYY-MM' | null = latest month with any pin
  var planPlaying = false, planPlayTimer = null;
  var planFloorPlaying = false, planFloorPlayTimer = null;
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
    // Item 6 (2026-08-30): "None" is a real grouping mode, not merely one
    // group that happens to hold everything with a header printed anyway --
    // a single "All photos (42)" header above a flat list defeats the whole
    // point of asking for no grouping. Short-circuits before groupKeyOf() is
    // ever called, in the row's own existing order (whatever `visible()`'s
    // filter/sort already produced), so the renderers' `g.key === NO_GROUP_KEY`
    // check is what tells them to skip the header entirely.
    if (galleryGroupBy === 'none') return [{ key: NO_GROUP_KEY, label: '', items: list }];
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
  // Sixth round item 1: TRUE distance-based clustering — pins within
  // PLAN_CELL (0.05 normalized) of each other combine into ONE marker,
  // matching iOS Photos' own map-clustering behaviour. ⚠️ REVERSES the
  // earlier grid-snap approach (round each pin to the nearest 0.05 grid
  // line), which could leave two pins a hair's-width apart in DIFFERENT
  // cells if they happened to straddle a grid boundary — exactly the
  // "should have combined but didn't" gap the owner reported. Greedy
  // single-pass agglomeration: a pin joins the first existing cluster
  // whose CURRENT centroid is within threshold, else starts a new one:
  // simple and deterministic (pins are processed in a stable id-sorted
  // order, so the same input always produces the same clusters regardless
  // of array order) rather than a full pairwise/optimal clustering, which
  // is unnecessary for the small, spatially-sparse pin counts this map
  // actually has to handle.
  function planClusters(pins, monthCutoff) {
    var eligible = [];
    pins.forEach(function (p) {
      var d = itemDateForPin(p);
      if (monthCutoff && (!d || d.slice(0, 7) > monthCutoff)) return; // "as of" — cumulative up to and including the selected month
      eligible.push(p);
    });
    var sorted = eligible.slice().sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
    var clusters = [];
    sorted.forEach(function (p) {
      var target = null;
      for (var i = 0; i < clusters.length; i++) {
        if (Math.hypot(p.x_norm - clusters[i].x, p.y_norm - clusters[i].y) <= PLAN_CELL) { target = clusters[i]; break; }
      }
      if (target) {
        target.pins.push(p);
        // Recompute the centroid so a THIRD pin compares against the
        // cluster's current shape, not just its first member's position.
        target.x = target.pins.reduce(function (s, q) { return s + q.x_norm; }, 0) / target.pins.length;
        target.y = target.pins.reduce(function (s, q) { return s + q.y_norm; }, 0) / target.pins.length;
      } else {
        clusters.push({ x: p.x_norm, y: p.y_norm, pins: [p] });
      }
    });
    return clusters;
  }
  // Sixth round item 2: "pins show number of photos. preview of the latest
  // photo should also be shown" (iOS Photos map style — the pin itself IS a
  // photo thumbnail, with a count badge). Only photos have a natural
  // thumbnail source here (thumbUrlOf); a cluster whose latest item is a
  // panorama/reconstruction falls back to the plain number badge, since
  // neither has an equivalent still-image preview wired up yet.
  function planClusterLatestThumb(cluster) {
    var latest = null, latestDate = '';
    cluster.pins.forEach(function (p) {
      if (p.item_type !== 'photo') return;
      var d = itemDateForPin(p) || '';
      if (!latest || d > latestDate) { latest = p; latestDate = d; }
    });
    if (!latest) return null;
    var r = byId(latest.item_id);
    return r ? thumbUrlOf(r) : null;
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
    // Sixth round item 3: the Floor row and the Month row read as two
    // differently-built controls (a labelled <select> vs. a bare ‹value›
    // stepper with no label at all, then a much longer trailing hint on only
    // one of the two). Both are now the SAME shape — a plain-text label,
    // then the stepper/control cluster, then one short trailing hint — so
    // they read as one consistent toolbar instead of two unrelated rows.
    return '<div class="pp-plantoolbar">' +
      '<div class="pp-planfloorbar">' +
        '<span class="pp-planfloorlabel">Floor</span>' +
        '<select class="pd-select" id="pp-plan-floor">' +
          floors.map(function (p) { return '<option value="' + Fmt.esc(p.id) + '"' + (p.id === planFloorId ? ' selected' : '') + '>' + Fmt.esc(p.name) + '</option>'; }).join('') +
        '</select>' +
        '<button class="pp-iconbtn" id="pp-plan-floorprev" title="Previous floor">‹</button>' +
        '<button class="pp-iconbtn" id="pp-plan-floornext" title="Next floor">›</button>' +
        '<button class="pd-btn" id="pp-plan-floorplay">' + (planFloorPlaying ? 'Stop' : '▶ Animate floors') + '</button>' +
        '<span class="pp-hint">' + pinCount + ' pinned item' + (pinCount === 1 ? '' : 's') + '</span>' +
      '</div>' +
      (months.length
        ? '<div class="pp-planmonthbar">' +
            '<span class="pp-planfloorlabel">Month</span>' +
            '<button class="pp-iconbtn" id="pp-plan-mprev" title="Earlier month">‹</button>' +
            '<strong>' + (cutoff ? Fmt.esc(cutoff) : 'All') + '</strong>' +
            '<button class="pp-iconbtn" id="pp-plan-mnext" title="Later month">›</button>' +
            '<button class="pd-btn" id="pp-plan-mplay">' + (planPlaying ? 'Stop' : '▶ Play') + '</button>' +
            '<button class="pd-btn pp-livebtn' + (planMonth == null ? ' is-live' : '') + '" id="pp-plan-mlive" title="Back to the latest month">Live</button>' +
            '<span class="pp-hint">as of the end of this month</span>' +
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
          // Sixth round item 2: the marker itself shows the LATEST photo in
          // the cluster (iOS Photos' own map style), with the count as a
          // small badge rather than being the whole button's content —
          // falls back to the old plain-number style when the cluster's
          // latest item has no photo thumbnail (a panorama/reconstruction).
          var thumb = planClusterLatestThumb(c);
          return '<button class="pp-plancluster' + (thumb ? ' pp-plancluster-photo' : '') + '" data-cluster="' + i + '" style="left:' + (c.x * 100) + '%;top:' + (c.y * 100) + '%;' +
            (thumb ? 'background-image:url(\'' + Fmt.esc(thumb) + '\');' : '') + '" ' +
            'aria-label="' + c.pins.length + ' item' + (c.pins.length === 1 ? '' : 's') + ' at this location — view">' +
            (thumb ? '<span class="pp-plancluster-badge">' + c.pins.length + '</span>' : c.pins.length) + '</button>';
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
    // Same "null = recorded/latest, a value = scrubbed" convention Project
    // Schedule's Vertical Stacking timeline established — Live jumps back to
    // it in one click instead of stepping through every intervening month.
    if ($('pp-plan-mlive')) $('pp-plan-mlive').onclick = function () {
      if (planMonth == null) return;   // already live — nothing to do
      stopPlanMonthPlay();
      planMonth = null; render();
    };
    Array.prototype.forEach.call(document.querySelectorAll('#pp-view [data-cluster]'), function (btn) {
      btn.onclick = function () { openPlanClusterList(clusters[+this.dataset.cluster]); };
    });
  }

  // ⚠️ RETIRED (Round-2 item 7, 2026-09-02): Stack view — "remove stack view
  // for the photos" — is deleted outright, not left in place. It used to
  // live here: stackLevels/stackRowLevel/stackColLevel/stackMonthsAvailable/
  // mostRecentAsOf/stackRowSort/stackGrid/STACK_COMBINE_MAX/renderStackView/
  // stopStackPlay/wireStackView, plus the pp-stack-* toolbar/table markup and
  // the .pp-stack* CSS it drove. Its state vars (stackRowLevelId/
  // stackColLevelId/stackStepMode/stackMonth/stackPlaying/stackPlayTimer)
  // are removed too, from further up this file (see the Plan-view state
  // block's own comment). Explicitly a delete, not a retire-in-place, per
  // the owner's own wording ("remove") — the same treatment this module
  // already gave the Today's Rounds feature.

  // Item 14: grid/list previews use the DOWNSCALED thumbnail URL, never the
  // full-resolution one — see signAll()'s own comment for the fallback rule.
  // Video previews are unaffected (there is no server-side transcode here;
  // `preload="metadata"` already keeps their bandwidth cost negligible).
  function thumb(r, cls) {
    // Items 6+8: a panorama/reconstruction pseudo-row draws its own tile —
    // it has no `photo_url`/`thumb_url` at all, so it must never reach the
    // photo/video branches below.
    if (r._kind) return mediaKindThumbHTML(r, cls);
    var u = thumbUrlOf(r);
    var isVideo = r.media_type === 'video';
    // ⚠️ A video tile has no equivalent of a photo's thumb_url/transform
    // thumbnail — it always needed its own FULL video file signed to show
    // a poster frame. Since full-res is no longer signed eagerly for the
    // whole project (signAll()'s own comment), a video tile is resolved
    // LAZILY instead: it renders as a placeholder now and is swapped for a
    // real <video> the moment it scrolls near the viewport (see
    // observeLazyVideos below) — never signed at all if it's never
    // scrolled to, exactly "full load only when opening the photo"
    // extended to the one other tile kind that needs a full-res file just
    // to render a preview at all.
    if (isVideo && !urlCache[r.photo_url]) {
      return '<span class="pp-vidthumb ' + cls + '-wrap pp-vidlazy" data-act="open" data-id="' + r.id + '" ' +
        'data-lazyvideo="' + r.id + '" data-cls="' + cls + '">' +
        '<span class="' + cls + ' pp-noimg" title="Video"><span data-ico="video" data-ico-size="18"></span></span>' +
        '<span class="pp-vidplay"></span></span>';
    }
    if (!u && !isVideo) return '<div class="' + cls + ' pp-noimg" title="Preview unavailable">' +
                   '<span data-ico="camera" data-ico-size="18"></span></div>';
    if (isVideo) {
      // preload="metadata" shows the video's first frame as a thumbnail at
      // negligible bandwidth cost, without playing dozens of clips at once in
      // a grid — real playback only happens once opened in the lightbox.
      // Reaching here means urlCache[r.photo_url] is already set (the guard
      // above), so urlOf(r) resolves synchronously with no further network
      // round-trip — this is the "already resolved, render for real" path.
      return '<span class="pp-vidthumb ' + cls + '-wrap" data-act="open" data-id="' + r.id + '">' +
        '<video class="' + cls + '" preload="metadata" muted playsinline src="' + Fmt.esc(urlOf(r)) + '"></video>' +
        '<span class="pp-vidplay"></span></span>';
    }
    // Item 5: exposure/brightness/contrast render everywhere a photo tile
    // does, via the same cheap CSS filter as the lightbox — `cssFilterFor`
    // itself returns the literal string 'none' for an unadjusted photo, so
    // this costs nothing extra for the overwhelming majority of rows that
    // have never touched a slider.
    var filt = adjustmentsAreDefault(r.adjustments) ? '' : ' style="filter:' + Fmt.esc(cssFilterFor(adjustmentsOf(r))) + '"';
    var img = '<img class="' + cls + '" src="' + Fmt.esc(u) + '" loading="lazy"' + filt + ' ' +
           'alt="' + Fmt.esc(r.description || 'Progress photo') + '" data-act="open" data-id="' + r.id + '" />';
    // Fifth round item 7: markup now shows on List/Gallery tiles by DEFAULT,
    // gated by ONE shared toggle (markupGlobalVisible) so it can be hidden
    // everywhere at once — not just in the lightbox, per the earlier
    // "hidden on Gallery tiles by contract" decision this reverses. The
    // wrapper only appears for rows that actually HAVE markup, so the
    // overwhelming majority of tiles pay nothing extra (no canvas, no paint
    // call) — same discipline as the CSS-filter check just above.
    // Round-2 item 8: List (and Plan, which never reaches this branch at all
    // — its cluster thumbnails are drawn straight from thumbUrlOf(), never
    // thumb()) always show markup regardless of the shared preference below,
    // and have no toggle to turn it off (see syncMkVisBtn's view gating).
    // Gallery keeps respecting the stored preference, unchanged.
    if (r.markup && r.markup.length && (view === 'list' || markupGlobalVisible())) {
      return '<span class="pp-mkwrap">' + img + '<canvas class="pp-thumbmk" data-mkfor="' + r.id + '"></canvas></span>';
    }
    return img;
  }
  // One shared "show markup" preference for the whole module (item 7) —
  // per project, so switching projects doesn't carry a hide/show decision
  // that has nothing to do with the new project's own photos.
  function markupVisKey() { return 'pp_markupvis_' + pid; }
  function markupGlobalVisible() {
    try { var v = localStorage.getItem(markupVisKey()); return v === null ? true : v === '1'; }
    catch (e) { return true; }
  }
  function setMarkupGlobalVisible(v) {
    try { localStorage.setItem(markupVisKey(), v ? '1' : '0'); } catch (e) {}
  }
  // Reflects the shared preference on the listbar toggle button (icon +
  // active state) — called on wire() and every time the button itself
  // flips it, so a stale icon can never disagree with what's actually shown.
  // ⚠️ Icons.hydrate() sets a one-time `dataset.icoDone` guard and refuses to
  // touch an element twice — calling it again here would silently no-op on
  // the SECOND toggle onward, leaving the icon stuck on whatever it first
  // rendered. Re-rendering the SVG directly sidesteps that guard entirely.
  // Round-2 item 8: "in the list and plan view, no need for the show/hide
  // mark-up button. by default show mark-up for these views." The button is
  // hidden entirely on those two views (List always shows markup per thumb()'s
  // own view check above; Plan never draws a markup layer at all, so a control
  // for it there would be a control that does nothing) and re-shown, reflecting
  // the real stored preference, everywhere else — called on every render, not
  // just on the button's own click, since switching views has to update it too.
  function syncMkVisBtn() {
    var b = $('pp-mkvistoggle'); if (!b) return;
    if (view === 'list' || view === 'plan') { b.hidden = true; return; }
    b.hidden = false;
    var on = markupGlobalVisible();
    b.classList.toggle('is-active', on);
    var ic = b.querySelector('[data-ico]');
    if (ic && window.Icons) ic.innerHTML = Icons.svg(on ? 'eye' : 'eyeOff', 15);
  }
  // Sizes + draws each tile's markup overlay canvas onto its own sibling
  // <img>'s ACTUAL rendered box (never assumed) — run after new tile HTML is
  // inserted (render()) since a canvas's own width/height attributes have no
  // relationship to its CSS box until explicitly set to match it.
  function paintThumbMarkups(host) {
    if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll('.pp-thumbmk[data-mkfor]'), function (canvas) {
      var r = byId(canvas.dataset.mkfor);
      if (!r || !r.markup || !r.markup.length) return;
      var img = canvas.previousElementSibling;
      if (!img) return;
      function paint() {
        var w = img.clientWidth, h = img.clientHeight;
        if (!w || !h) return;
        canvas.width = w; canvas.height = h;
        drawMarkupObjects(canvas.getContext('2d'), r.markup, w, h);
      }
      if (img.complete && img.naturalWidth) paint(); else img.onload = paint;
    });
  }

  // ------------------------------------------------- lazy video tiles ---
  // A video tile (thumb()'s `.pp-vidlazy` placeholder) is resolved — its
  // full video file signed, and the placeholder swapped for a real
  // <video> — only once it scrolls near the viewport, via ONE shared
  // IntersectionObserver reused across renders. `rootMargin` starts the
  // sign request a little before the tile is actually visible, so
  // scrolling to it doesn't show an empty placeholder for a beat.
  // Un-intersected tiles below the fold are never signed at all — the
  // whole point of "full load only when opening the photo".
  var lazyVideoObserver = null;
  function ensureLazyVideoObserver() {
    if (lazyVideoObserver || typeof IntersectionObserver === 'undefined') return lazyVideoObserver;
    lazyVideoObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        lazyVideoObserver.unobserve(el);   // resolve once; a resolved tile is re-rendered as a real <video> next paint anyway
        var id = el.dataset.lazyvideo;
        var r = byId(id);
        if (!r) return;
        ensureFullUrl(r).then(function (u) {
          if (!u) return;
          // The placeholder may already be gone (a re-render replaced the
          // whole grid while this was in flight) — re-query fresh rather
          // than trust the captured `el` is still attached. `data-cls`
          // carries the ORIGINAL thumb() cls argument (e.g. "pp-cardphoto")
          // — the placeholder's own className is "pp-vidthumb <cls>-wrap
          // pp-vidlazy", not that value itself.
          Array.prototype.forEach.call(document.querySelectorAll('[data-lazyvideo="' + id + '"]'), function (ph) {
            ph.outerHTML = thumb(r, ph.dataset.cls);
          });
        });
      });
    }, { rootMargin: '400px 0px' });
    return lazyVideoObserver;
  }
  // Called after every render() that may have inserted fresh `.pp-vidlazy`
  // placeholders (List/Gallery). Harmless (and a cheap no-op) to call when
  // there are none — querySelectorAll simply returns an empty list.
  function observeLazyVideos(host) {
    if (!host) return;
    var obs = ensureLazyVideoObserver(); if (!obs) return;
    Array.prototype.forEach.call(host.querySelectorAll('.pp-vidlazy'), function (el) { obs.observe(el); });
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
      // Item 6: "None" prints no header at all -- not a collapsible header
      // with an empty label, which would still claim a row and a caret for a
      // grouping the planner explicitly asked to turn off.
      if (g.key === NO_GROUP_KEY) return g.items.map(rowHTML).join('');
      var isCol = !!collapsed[g.key];
      var header = '<div class="pp-group" data-group="' + Fmt.esc(g.key) + '">' +
        '<span class="pp-caret" data-ico="' + (isCol ? 'chevronRight' : 'chevronDown') + '" data-ico-size="14"></span>' +
        '<strong>' + Fmt.esc(g.label) + '</strong>' +
        '<span class="pp-groupcount">' + g.items.length + '</span></div>';
      if (isCol) return header;
      return header + g.items.map(rowHTML).join('');
    }).join('');

    return '<div class="pp-grid">' + head + body + '</div>';

    function rowHTML(r) {
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
    }
  }

  // Tile view: just the photo -- no description/table, no action icons on the
  // tile itself (owner feedback). Download/view/edit/delete live in the
  // lightbox once a photo is opened. Grouping is picked from the SHARED
  // #pp-groupby selector in the list bar (index.html) now, not a picker of
  // its own — see groupRows()'s own comment.
  function galleryHTML(list) {
    var body = groupRows(list).map(function (g) {
      var cards = '<div class="pp-gallery">' + g.items.map(cardHTML).join('') + '</div>';
      // Item 6: "None" is a flat grid -- no group-head wrapper (which would
      // otherwise print an empty <strong></strong> and a redundant total
      // count identical to the toolbar's own #pp-count above the grid).
      if (g.key === NO_GROUP_KEY) return cards;
      return '<div class="pp-gallerygroup">' +
        '<div class="pp-gallerygrouphead"><strong>' + Fmt.esc(g.label) + '</strong>' +
          '<span class="pp-groupcount">' + g.items.length + '</span></div>' +
        cards + '</div>';
    }).join('');
    return body;

    function cardHTML(r) {
      // Item 4 (11-item round): "in the gallery progress photos view no need
      // for the key plan button" -- the .pp-pinbtn corner icon + its
      // openPinPreview() crop-zoom popup are RETIRED. The key-plan button now
      // lives only in the lightbox toolbar (#pp-lb-keyplan, wired in
      // paintLightbox()), shown once a photo is actually opened.
      return '<figure class="pp-card' + (selected[r.id] ? ' pp-selrow' : '') + '" data-id="' + r.id + '">' +
        '<span class="pp-cardsel"><input type="checkbox" data-sel="' + r.id + '" aria-label="Select ' +
          Fmt.esc(r.description || 'this photo') + '"' +
          (selected[r.id] ? ' checked' : '') + ' /></span>' +
        '<div class="pp-cardimg">' + thumb(r, 'pp-cardphoto') + '</div>' +
      '</figure>';
    }
  }

  // ⚠️ RETIRED (item 4, 11-item round): openPinPreview() -- the Gallery
  // tile's Tight/Wide crop-zoom popup -- is gone along with the .pp-pinbtn
  // button that was its only caller (cardHTML, above). The key-plan overlay
  // moved into the lightbox instead: see #pp-lb-keyplan / paintKeyPlanOverlay()
  // below paintLightbox(). Its centring math (an image at left:50%/top:50%
  // translated by -(x_norm*100%, y_norm*100%) of ITS OWN box) carries over
  // unchanged into that overlay, since percentage transforms are always
  // relative to the transformed element itself regardless of zoom.

  // ⚠️ RETIRED (items 6+8, current round): panoramas/reconstructions used to
  // render in a separate `#pp-media-strip` below the grid via
  // mediaStripMatches/mediaStripItems/mediaStripHTML/wireMediaStrip/
  // renderMediaStrip — "360, 3D and video should not be grouped separately...
  // it should be included with the normal grouping". That whole block is
  // gone; the equivalent logic now lives in matchesFilters()/mergedRows()/
  // panoPseudoRow()/reconPseudoRow() above, and mediaKindThumbHTML() (below,
  // called from thumb()) draws the tile inline in List/Gallery.

  // Kind-aware tile for a panorama/reconstruction pseudo-row (thumb()'s
  // `r._kind` branch). Clicking the tile opens the real viewer
  // (PANO.open/RECON.openById — wired in wireRows' [data-act]/[data-rowopen]
  // handlers below, which special-case a prefixed id before falling back to
  // byId()); the small pencil button opens openMediaKindEditor() — item 8's
  // separate "edit all details" affordance, since the viewer itself has no
  // edit UI of its own.
  function mediaKindThumbHTML(r, cls) {
    var isPano = r._kind === 'panorama';
    var u = isPano && window.PANO && PANO.urlOf ? PANO.urlOf(r._src) : '';
    var label = isPano ? '360° panorama' : '3D scan';
    return '<span class="' + cls + '-wrap pp-mkthumb" data-act="open" data-id="' + Fmt.esc(r.id) + '" title="' + Fmt.esc(label) + '">' +
      (u ? '<img class="' + cls + '" src="' + Fmt.esc(u) + '" alt="" />' :
           '<span class="' + cls + ' pp-noimg"><span data-ico="' + (isPano ? 'compass' : 'box') + '" data-ico-size="18"></span></span>') +
      '<span class="pp-mkbadge">' + Fmt.esc(isPano ? '360°' : '3D') + '</span>' +
      (canWrite ? '<button type="button" class="pp-mkeditbtn" data-mkedit="' + Fmt.esc(r.id) + '" title="Edit details">' +
        '<span data-ico="pencil" data-ico-size="12"></span></button>' : '') +
      '</span>';
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
        var id = el.dataset.id, a = el.dataset.act;
        // A panorama/reconstruction tile's own [data-act="open"] dispatches
        // to the real viewer (PANO.open/RECON.openById), never the photo
        // lightbox — byId() below only ever knows real photo rows, so a
        // prefixed pseudo-row id is resolved here first.
        if (a === 'open' && typeof id === 'string' && id.indexOf('pano:') === 0) {
          if (window.PANO && PANO.open) PANO.open(id.slice(5));
          return;
        }
        if (a === 'open' && typeof id === 'string' && id.indexOf('recon:') === 0) {
          if (window.RECON && RECON.openById) RECON.openById(id.slice(6));
          return;
        }
        var r = byId(id); if (!r) return;
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
    // ticking a box never also opens the photo. Same pseudo-row dispatch as
    // [data-act="open"] above — a merged List row for a panorama/scan opens
    // its own real viewer, not the photo lightbox.
    Array.prototype.forEach.call(host.querySelectorAll('[data-rowopen]'), function (row) {
      row.onclick = function (e) {
        if (e.target.closest('.pp-selcell, .pp-mkeditbtn')) return;
        var id = this.dataset.rowopen;
        if (typeof id === 'string' && id.indexOf('pano:') === 0) { if (window.PANO && PANO.open) PANO.open(id.slice(5)); return; }
        if (typeof id === 'string' && id.indexOf('recon:') === 0) { if (window.RECON && RECON.openById) RECON.openById(id.slice(6)); return; }
        openLightbox(id);
      };
    });
    // ⚠️ RETIRED (item 4): the [data-pinpreview] tile icon + its wiring are
    // gone -- the key-plan button now lives in the lightbox toolbar only
    // (#pp-lb-keyplan, wired in paintLightbox()).
    // Items 6+8 — the pencil icon on a panorama/reconstruction tile opens the
    // "edit all details" dialog, separate from clicking the tile itself
    // (which opens the real viewer, matching "clicked like the photos").
    Array.prototype.forEach.call(host.querySelectorAll('[data-mkedit]'), function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var row = byMergedId(this.dataset.mkedit);
        if (row) openMediaKindEditor(row);
      };
    });
    // Batch select (follow-up feedback item 5) — one checkbox per row/tile,
    // in both List and Gallery views (they're two displays of the same
    // Gallery screen, so a selection made in one shouldn't be view-specific).
    // Works unchanged for a pseudo-row's prefixed id — `selected{}` is just a
    // plain id->true map, indifferent to what kind of id it holds.
    Array.prototype.forEach.call(host.querySelectorAll('[data-sel]'), function (cb) {
      cb.onchange = function () {
        if (this.checked) selected[this.dataset.sel] = true; else delete selected[this.dataset.sel];
        var card = this.closest('.pp-row, .pp-card');
        if (card) card.classList.toggle('pp-selrow', this.checked);
        syncChrome();
      };
    });
    // Item 4 — select/unselect ALL currently visible rows, replacing the old
    // separate "Clear" button. Scoped to mergedRows() (the same filtered set
    // the header checkbox's own "all checked?" state reflects, and the same
    // set visibleSelectedIds() scopes against), not the raw `selected` map.
    var selAll = host.querySelector('#pp-selall');
    if (selAll) selAll.onchange = function () {
      var on = this.checked;
      mergedRows().forEach(function (r) { if (on) selected[r.id] = true; else delete selected[r.id]; });
      render();
    };
  }
  function byId(id) { return rows.filter(function (r) { return r.id === id; })[0]; }

  // -------------------------------------------------------- batch select ----
  // Scoped to the currently VISIBLE (filtered) set, not the raw `selected`
  // map — a selection made under one filter must not silently act on rows a
  // since-changed filter no longer shows (Drawing Register's own bulk-select
  // bar was bitten by exactly this and documents the fix; the same rule
  // applies here). mergedRows(), not visible(), so a selected panorama/scan
  // tile stays counted while its own filter state still shows it.
  function visibleSelectedIds() {
    var vis = {}; mergedRows().forEach(function (r) { vis[r.id] = true; });
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
  // Items 6+8: splits a mixed batch-selection (real photo ids + prefixed
  // panorama/reconstruction pseudo-ids) into their three real target tables
  // — every bulk action below needs to know which table each selected id
  // actually belongs to, since progress_photos/panoramas/reconstruction_
  // requests are three separate tables with no shared id space.
  function splitSelectedIds(ids) {
    var out = { photo: [], pano: [], recon: [] };
    ids.forEach(function (id) {
      if (typeof id === 'string' && id.indexOf('pano:') === 0) out.pano.push(id.slice(5));
      else if (typeof id === 'string' && id.indexOf('recon:') === 0) out.recon.push(id.slice(6));
      else out.photo.push(id);
    });
    return out;
  }
  function wireSelBar() {
    // Item 5: choose a format instead of downloading each raw file — mirrors
    // ppr.js's own openDownloadChoice for presentations, so "Download" means
    // the same thing (pick HTML/PDF/PPTX) everywhere in this module.
    // ⚠️ Scoped to real photos only — a panorama has no flat image suited to
    // the HTML/PDF/PPTX embedding pipeline (collectPhotoImages expects a
    // photo_url), and a 3D scan's "download" is really its own point-cloud
    // viewer, not a slide. Selecting a mix downloads just the photos and
    // says so, rather than silently dropping the rest with no explanation.
    if ($('pp-sel-download')) $('pp-sel-download').onclick = function () {
      var split = splitSelectedIds(visibleSelectedIds());
      if (!split.photo.length) {
        UI.toast('Select at least one photo to download — 360°/3D captures open their own viewer instead', 'warn');
        return;
      }
      if (split.pano.length || split.recon.length) {
        UI.toast((split.pano.length + split.recon.length) + ' 360°/3D item(s) skipped — download covers photos only', 'warn');
      }
      openBatchDownloadChoice(split.photo);
    };
    if ($('pp-sel-archive')) $('pp-sel-archive').onclick = async function () {
      var ids = visibleSelectedIds();
      if (!ids.length) return;
      var split = splitSelectedIds(ids);
      var jobs = [];
      if (split.photo.length) jobs.push(sb().from(TABLE).update({ archived: true }).in('id', split.photo));
      if (split.pano.length) jobs.push(sb().from('panoramas').update({ archived: true }).in('id', split.pano));
      if (split.recon.length) jobs.push(sb().from('reconstruction_requests').update({ archived: true }).in('id', split.recon));
      var results = await Promise.all(jobs);
      var err = results.filter(function (r) { return r.error; })[0];
      if (err) {
        if (/column .* does not exist|schema cache/i.test(err.error.message || '')) {
          UI.toast('Archiving needs a pending migration — run migrations/2026-08-29-archive-flag.sql', 'warn');
        } else UI.toast(err.error.message, 'error');
        return;
      }
      UI.toast(ids.length + ' item' + (ids.length === 1 ? '' : 's') + ' archived', 'ok');
      selected = {};
      await load();
    };
    if ($('pp-sel-addppr')) $('pp-sel-addppr').onclick = function () {
      var split = splitSelectedIds(visibleSelectedIds());
      // ⚠️ A presentation slide is a before/after PHOTO pane by construction
      // (before_photo_id/after_photo_id FK progress_photos) — a panorama or
      // 3D scan can't fill that slot, so this stays photo-only, same
      // reasoning as the download split above.
      if (!split.photo.length) {
        UI.toast('Select at least one photo — 360°/3D captures can\'t be added to a presentation slide', 'warn');
        return;
      }
      if (split.pano.length || split.recon.length) {
        UI.toast((split.pano.length + split.recon.length) + ' 360°/3D item(s) skipped', 'warn');
      }
      openAddToPresentation(split.photo);
    };
    // Item 1 (owner feedback) — batch delete, joining Download/Add to
    // Presentation/Archive in the selection cluster. Scoped to real photos
    // only (a 360°/3D pseudo-row has no row in TABLE for this to delete),
    // same reasoning as the two splits above.
    if ($('pp-sel-delete')) $('pp-sel-delete').onclick = function () {
      var split = splitSelectedIds(visibleSelectedIds());
      if (!split.photo.length) {
        UI.toast('Select at least one photo — 360°/3D captures aren\'t deleted from here', 'warn');
        return;
      }
      if (split.pano.length || split.recon.length) {
        UI.toast((split.pano.length + split.recon.length) + ' 360°/3D item(s) skipped — delete covers photos only', 'warn');
      }
      openDeleteConfirm(split.photo);
    };
  }

  // ---------------------------------------------------------------- delete ---
  // Any photo(s) about to be deleted that are cited by a presentation slide
  // (ppr_slides.before_photo_id/after_photo_id) — used to WARN before the
  // irreversible delete, not to block it. The FK is `on delete set null`
  // (see ppr.js), so the slide survives with an empty frame; the warning is
  // what makes that consequence visible before it happens instead of after.
  // ⚠️ Two separate `.in()` queries, not one `.or()` string — building an
  // `or()` filter string is fiddly to get right (PostgREST's own delimiters)
  // for no real benefit here, since ids are plain UUIDs with nothing to
  // escape either way.
  async function findPresentationUsage(ids) {
    if (!ids.length) return { photoIds: [], pprIds: [] };
    var beforeQ = sb().from('ppr_slides').select('ppr_id, before_photo_id').in('before_photo_id', ids);
    var afterQ = sb().from('ppr_slides').select('ppr_id, after_photo_id').in('after_photo_id', ids);
    var results = await Promise.all([beforeQ, afterQ]);
    var photoIds = {}, pprIds = {};
    results.forEach(function (res) {
      (res.data || []).forEach(function (row) {
        if (row.before_photo_id) photoIds[row.before_photo_id] = true;
        if (row.after_photo_id) photoIds[row.after_photo_id] = true;
        if (row.ppr_id) pprIds[row.ppr_id] = true;
      });
    });
    return { photoIds: Object.keys(photoIds), pprIds: Object.keys(pprIds) };
  }

  // Shared confirm-and-delete for one photo (the lightbox's own Delete
  // button, `remove(r)` below) or several at once (the batch selection's
  // Delete button) — one path, so the presentation-usage warning and the
  // storage cleanup can never disagree between the two entry points.
  async function openDeleteConfirm(ids) {
    if (!ids.length) return;
    var one = ids.length === 1 ? byId(ids[0]) : null;
    var label = one
      ? ('<strong>' + Fmt.esc(one.description || one.title || one.view_name || 'this photo') + '</strong>')
      : (ids.length + ' photos');
    var usage = { photoIds: [], pprIds: [] };
    try { usage = await findPresentationUsage(ids); } catch (e) { /* best-effort — a failed check must not block deleting */ }
    var warnHtml = '';
    if (usage.photoIds.length) {
      var pluralPhoto = usage.photoIds.length === 1;
      var pluralPpr = usage.pprIds.length === 1;
      warnHtml = '<div class="pp-delwarn"><span aria-hidden="true">⚠</span><span>' +
        (pluralPhoto ? 'This photo is' : usage.photoIds.length + ' of ' + (ids.length === 1 ? 'this photo' : ids.length + ' selected photos') + ' are') +
        ' used in ' + usage.pprIds.length + ' presentation' + (pluralPpr ? '' : 's') + '. Deleting ' +
        (pluralPhoto ? 'it' : 'them') + ' will remove ' + (pluralPhoto ? 'it' : 'them') +
        ' from ' + (pluralPpr ? 'that presentation' : 'those presentations') + ' too.</span></div>';
    }
    var html =
      '<div class="pd-modal-header"><h3>Delete ' + (ids.length === 1 ? 'photo' : ids.length + ' photos') + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><p>Delete ' + label + '? The image file' + (ids.length === 1 ? ' is' : 's are') +
        ' removed from storage too. This cannot be undone.</p>' + warnHtml + '</div>' +
      '<div class="pd-modal-footer">' +
        '<button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-danger" id="pp-d-yes">Delete</button></div>';
    var m = openModal(html, 460);
    $('pp-d-yes').onclick = async function () {
      this.disabled = true;
      var targetRows = rows.filter(function (r) { return ids.indexOf(r.id) >= 0; });
      var res = await sb().from(TABLE).delete().in('id', ids);
      if (res.error) { UI.toast(res.error.message, 'error'); this.disabled = false; return; }
      // Item 1's thumbnail is a real, separate object in the same bucket —
      // deleting only the original would leave it orphaned forever (nothing
      // else in the app ever points at it once this row is gone).
      var toRemove = [];
      targetRows.forEach(function (r) { if (r.photo_url) toRemove.push(r.photo_url); if (r.thumb_url) toRemove.push(r.thumb_url); });
      if (toRemove.length) { try { await sb().storage.from(BUCKET).remove(toRemove); } catch (e) {} }
      m.close();
      UI.toast((ids.length === 1 ? 'Photo' : ids.length + ' photos') + ' deleted', 'ok');
      ids.forEach(function (id) { delete selected[id]; });
      await load();
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
  // Round-2 item 3 (2026-09-02): RETIRES the zoom-buttons/scale-transform
  // approach item 10 built for the lightbox — "instead of zoom buttons in
  // the image pop-up, have a magnifier instead" (see wireLightboxMagnifier/
  // moveMagnifier below, and .pp-lb-magnifier in module.css). The magnifier
  // reads the media element's CURRENT src on every move, so it needs no
  // per-photo reset the way the old scale value did.
  function paintLightbox() {
    var r = byId(lightboxIds[lightboxAt]); if (!r) return;
    // ⚠️ "full load only when opening the photo" — full-resolution is no
    // longer pre-signed for the whole project, so it's resolved HERE, the
    // one place that actually needs it, the moment a photo is opened. The
    // (already-signed, already-cached) thumbnail paints INSTANTLY as a
    // stand-in so opening a photo never shows a blank frame while the
    // full-res sign round-trip (now a single path, not the whole project)
    // completes in the background.
    var u = thumbUrlOf(r);
    var isVideo = r.media_type === 'video';
    var imgEl = $('pp-lb-img'), vidEl = $('pp-lb-video');
    if (isVideo) {
      if (imgEl) { imgEl.hidden = true; imgEl.src = ''; }
      if (vidEl) { vidEl.hidden = false; vidEl.src = ''; }   // resolved below — a video has no separate thumbnail to stand in with
    } else {
      if (vidEl) { vidEl.hidden = true; vidEl.pause(); vidEl.src = ''; }
      if (imgEl) { imgEl.hidden = false; imgEl.src = u || ''; }
    }
    // Swap in the real full-res image/video once signed. Guarded against
    // the lightbox having moved on to a different photo (rapid ←/→
    // stepping) or having been closed entirely by the time the sign
    // request resolves — an outdated promise must never overwrite what's
    // now on screen.
    // ⚠️ Item 4 (owner feedback) fix: this used to compare OBJECT IDENTITY
    // (`byId(lightboxIds[lightboxAt]) !== r`), which silently dropped the
    // full-res swap whenever `rows` was mutated for the SAME photo between
    // opening the lightbox and this promise resolving (e.g. a realtime
    // UPDATE echo replaces `rows[j]` with a new object — see
    // applyRemoteChange) — the photo being viewed hadn't changed, only the
    // object reference had, so the guard wrongly treated it as stale and
    // the tile kept showing the thumbnail until the photo was reopened
    // (full-res was already cached by then, so the SECOND open "worked").
    // Comparing the ID the lightbox is currently pointed at is what the
    // guard actually means — "has the lightbox moved on to a different
    // photo" — and is robust to `rows` being replaced for the same id.
    var openedId = r.id;
    ensureFullUrl(r).then(function (full) {
      if (!full) return;
      if (lightboxIds[lightboxAt] !== openedId) return;
      if (!$('pp-lightbox') || $('pp-lightbox').hidden) return;
      u = full;
      if (isVideo) { if (vidEl) vidEl.src = full; }
      else { if (imgEl) imgEl.src = full; }
    });
    // Item 5: exposure/brightness/contrast render live via CSS filter —
    // photos only (adjustments has no meaning for a video clip here).
    if (imgEl) imgEl.style.filter = isVideo ? '' : cssFilterFor(adjustmentsOf(r));
    $('pp-lb-cap').innerHTML =
      '<strong>' + Fmt.esc(r.view_name || r.description || 'Progress photo') + '</strong>' +
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
    // Fifth round item 7: markup visibility is now ONE shared, persisted
    // preference for the whole module (markupGlobalVisible), not a private
    // per-session lightbox toggle — hiding it here also hides it on every
    // List/Gallery tile, and vice versa. The lightbox still keeps its own
    // `lightboxMarkupVisible` var (paintMarkupOverlay reads it), it's just
    // seeded FROM and written BACK to the shared preference below.
    var mkBtn = $('pp-lb-markuptoggle'), mkEditBtn = $('pp-lb-markupedit');
    if (mkEditBtn) mkEditBtn.style.display = canWrite ? '' : 'none';
    if (mkBtn) mkBtn.onclick = function () {
      lightboxMarkupVisible = !lightboxMarkupVisible;
      setMarkupGlobalVisible(lightboxMarkupVisible);
      paintMarkupOverlay(r);
      render(); // repaints/removes every tile's own overlay to match
    };
    if (mkEditBtn) mkEditBtn.onclick = function () {
      openMarkupEditor(u, r.markup || [], async function (newMarkup) {
        r.markup = newMarkup;
        lightboxMarkupVisible = true;
        var w = await tolerantWrite({ table: TABLE, op: 'update', id: r.id, patch: { markup: newMarkup, updated_at: new Date().toISOString() } });
        if (!w.ok) UI.toast(w.error && w.error.message || 'Could not save markup', 'error');
        paintMarkupOverlay(r);
      });
    };
    // Item 5 — same shape as the markup edit button above: hidden for a
    // video (adjustments are photo-only) and for a read-only viewer.
    var adjBtn = $('pp-lb-adjustedit');
    if (adjBtn) {
      adjBtn.style.display = (canWrite && !isVideo) ? '' : 'none';
      adjBtn.onclick = function () {
        openAdjustEditor(u, r.adjustments || {}, async function (newAdj) {
          r.adjustments = newAdj;
          if (imgEl) imgEl.style.filter = cssFilterFor(newAdj);
          var w = await tolerantWrite({ table: TABLE, op: 'update', id: r.id, patch: { adjustments: newAdj, updated_at: new Date().toISOString() } });
          if (!w.ok) UI.toast(w.error && w.error.message || 'Could not save adjustments', 'error');
        });
      };
    }
    // Item 4: the key-plan toggle -- shown only when this photo/item actually
    // has a floor-plan pin (BIM.pinInfoFor, polymorphic across photo/pano/
    // reconstruction the same way cardHTML used to compute it). Resets to
    // hidden on every photo change (lightboxKeyPlanVisible), matching the
    // per-photo scope the button itself now has -- stepping ←/→ to a
    // different item must not carry the overlay over onto it.
    var kpBtn = $('pp-lb-keyplan');
    var kpPinType = r._kind || 'photo';
    var kpPinId = r._src ? r._src.id : r.id;
    var kpHasPin = window.BIM && BIM.pinInfoFor && !!BIM.pinInfoFor(kpPinType, kpPinId);
    if (kpBtn) {
      kpBtn.style.display = kpHasPin ? '' : 'none';
      kpBtn.onclick = function () {
        lightboxKeyPlanVisible = !lightboxKeyPlanVisible;
        paintKeyPlanOverlay(r);
      };
    }
    lightboxKeyPlanVisible = false;
    // Round-2 item 4: reset the key-plan overlay's size back to its default on every
    // new photo -- "temporarily resize" means per-photo, not a size that sticks and
    // silently carries over onto whatever the next ←/→ step happens to show.
    lightboxKpOverlaySize = null;
    paintKeyPlanOverlay(r);
    // Round-2 item 3: hide any lens left showing from before this photo was
    // painted (e.g. the cursor didn't move between a keyboard ←/→ step) —
    // it would otherwise show a stale crop of the PREVIOUS photo at whatever
    // position it last sat, until the next mousemove corrects it.
    hideLightboxMagnifier();
    lightboxMarkupVisible = markupGlobalVisible();
    paintMarkupOverlay(r);
    hydrate($('pp-lightbox'));
  }
  var lightboxMarkupVisible = true;
  var lightboxKeyPlanVisible = false;
  // Round-2 item 3 (2026-09-02): the lightbox's magnifier — replaces the
  // zoom in/out buttons item 10 added ("zoom is only for... the image pop-up
  // view" now means a magnifier, not a scale control). A circular lens
  // follows the cursor over the currently-shown PHOTO (never a video — there
  // is no still frame to magnify) and shows a zoomed crop of that same
  // element via a CSS background-image, so it always reflects whatever
  // src is currently loaded (thumbnail, then the full-res swap-in) with no
  // extra fetch of its own. Wired once — `.pp-lb-imgwrap` is static markup,
  // never rebuilt — rather than re-bound on every paintLightbox() call.
  var LB_MAG_SIZE = 160, LB_MAG_ZOOM = 2.5;
  function hideLightboxMagnifier() {
    var mag = $('pp-lb-magnifier'); if (mag) mag.style.display = 'none';
  }
  // Pure geometry — pulled out of the mousemove handler specifically so it
  // can be genuinely EXECUTED by a test (a flipped sign here silently points
  // the lens at the wrong crop of the image; a source-level read alone
  // can't catch that). Returns null when the cursor isn't over the image at
  // all (including a zero-size rect, an image not yet laid out) — the
  // caller's only job on null is to hide the lens.
  function magnifierGeom(cursorX, cursorY, imgRect, wrapRect, size, zoom) {
    if (!imgRect.width || !imgRect.height) return null;
    var x = cursorX - imgRect.left, y = cursorY - imgRect.top;
    if (x < 0 || y < 0 || x > imgRect.width || y > imgRect.height) return null;
    return {
      left: cursorX - wrapRect.left - size / 2,
      top: cursorY - wrapRect.top - size / 2,
      bgW: imgRect.width * zoom, bgH: imgRect.height * zoom,
      bgX: -(x * zoom - size / 2), bgY: -(y * zoom - size / 2)
    };
  }
  function wireLightboxMagnifier() {
    var wrap = $('pp-lb-imgwrap'), mag = $('pp-lb-magnifier');
    if (!wrap || !mag) return;
    wrap.onmousemove = function (e) {
      var imgEl = $('pp-lb-img'), vidEl = $('pp-lb-video');
      // Only ever magnifies the PHOTO — a playing video has no single frame
      // to show a still, zoomed crop of.
      if (!imgEl || imgEl.hidden || !imgEl.src || (vidEl && !vidEl.hidden)) { hideLightboxMagnifier(); return; }
      var g = magnifierGeom(e.clientX, e.clientY, imgEl.getBoundingClientRect(),
        wrap.getBoundingClientRect(), LB_MAG_SIZE, LB_MAG_ZOOM);
      if (!g) { hideLightboxMagnifier(); return; }
      mag.style.display = 'block';
      mag.style.width = LB_MAG_SIZE + 'px';
      mag.style.height = LB_MAG_SIZE + 'px';
      mag.style.left = g.left + 'px';
      mag.style.top = g.top + 'px';
      mag.style.backgroundImage = 'url("' + imgEl.src + '")';
      mag.style.backgroundSize = g.bgW + 'px ' + g.bgH + 'px';
      mag.style.backgroundPosition = g.bgX + 'px ' + g.bgY + 'px';
    };
    wrap.onmouseleave = hideLightboxMagnifier;
  }
  // Item 4 — the lightbox's own key-plan corner overlay (top-right, 1/8 of
  // the photo). ⚠️ Owner feedback (item 7): the overlay must always include
  // the PIN itself and, when recorded, the camera-facing direction CONE —
  // the bare plan image alone doesn't answer "where in the building, facing
  // which way, was this shot from". The overlay is now a small stage (an
  // <img> + a pin dot + a cone), positioned by the pin's own normalized
  // x_norm/y_norm — the same left/top-percentage convention bim.js's own
  // pinMarkerHTML/pinConeHTML use on the full Plans-tab stage, just at the
  // smaller scale this 1/8-photo-width corner box needs.
  // Round-2 item 4: how far the overlay is dragged open, RESET on every
  // photo (paintLightbox) — "temporarily resize", not a size that should
  // carry over onto the next photo's own overlay.
  var LB_KP_DEFAULT = 0.125, LB_KP_MIN = 0.06, LB_KP_MAX = 0.6;
  var lightboxKpOverlaySize = null;
  function paintKeyPlanOverlay(r) {
    var wrap = $('pp-lb-keyplan-overlay'); if (!wrap) return;
    var kpBtn = $('pp-lb-keyplan');
    var img = $('pp-lb-keyplan-overlay-img');
    var pinEl = $('pp-lb-keyplan-overlay-pin');
    var coneEl = $('pp-lb-keyplan-overlay-cone');
    // ⚠️ The button's "active" state reflects whether the overlay is
    // ACTUALLY showing, not merely the toggle's own intent — a button lit up
    // while nothing is on screen (e.g. because the plan image genuinely
    // isn't available, below) would read as "it's on" over an overlay that
    // silently isn't there. Set once, at every return point, never ahead of
    // knowing the real outcome.
    function setShown(shown) {
      if (kpBtn) kpBtn.classList.toggle('is-active', shown);
      wrap.hidden = !shown;
      if (!shown) { if (img) img.removeAttribute('src'); if (pinEl) pinEl.hidden = true; if (coneEl) coneEl.hidden = true; }
    }
    if (!lightboxKeyPlanVisible) { setShown(false); return; }
    var pinType = r._kind || 'photo';
    var pinId = r._src ? r._src.id : r.id;
    var info = window.BIM && BIM.pinInfoFor && BIM.pinInfoFor(pinType, pinId);
    if (!info || !info.planUrl) {
      UI.toast('That floor plan image is not available', 'warn');
      setShown(false);
      return;
    }
    wrap.style.width = ((lightboxKpOverlaySize || LB_KP_DEFAULT) * 100) + '%';
    if (img) img.src = info.planUrl;
    var pin = info.pin;
    if (pinEl) {
      if (pin) {
        pinEl.hidden = false;
        pinEl.className = 'pp-lb-kpoverlay-pin pp-lb-kppin-' + (pin.item_type || 'photo');
        pinEl.style.left = (pin.x_norm * 100) + '%';
        pinEl.style.top = (pin.y_norm * 100) + '%';
      } else {
        pinEl.hidden = true;
      }
    }
    if (coneEl) {
      // A cone is drawn only when a facing direction was actually recorded
      // and the item isn't marked drone/top-view (direction_na) — a
      // fabricated cone would claim a facing direction nobody captured.
      var hasDir = pin && !pin.direction_na && pin.direction_deg !== null && pin.direction_deg !== undefined;
      if (hasDir) {
        coneEl.hidden = false;
        coneEl.style.left = (pin.x_norm * 100) + '%';
        coneEl.style.top = (pin.y_norm * 100) + '%';
        coneEl.style.transform = 'translate(-50%,-100%) rotate(' + pin.direction_deg + 'deg)';
      } else {
        coneEl.hidden = true;
      }
    }
    setShown(true);
  }
  // Round-2 item 4: drag the overlay's bottom-left corner to resize it —
  // pinned top/right, so only the WIDTH needs to change; the <img>'s own
  // natural aspect ratio keeps the height following, same "only one
  // dimension to drive" shape as ppr.js's wireKpResizeDrag. Wired once —
  // the handle is static markup, never rebuilt — rather than re-bound on
  // every paintKeyPlanOverlay() call.
  // Pulled out as a pure function -- same reasoning as magnifierGeom /
  // directionDegFromDrag / pointAtBearing elsewhere in this app: a flipped
  // sign or a missing clamp here is silent (the handle still LOOKS
  // draggable either way), so it's exported for genuine execution rather
  // than only read from the surrounding source. Dragging the handle LEFT
  // (cursor x decreases, so startX-curX is positive) grows the box, since
  // the box is pinned top/right and only its bottom-LEFT corner moves.
  function kpResizeFrac(startFrac, startX, curX, wrapW) {
    var dx = startX - curX;
    return Math.max(LB_KP_MIN, Math.min(LB_KP_MAX, startFrac + dx / (wrapW || 1)));
  }
  function wireLightboxKpResizeDrag() {
    var handle = $('pp-lb-keyplan-resize'), box = $('pp-lb-keyplan-overlay');
    if (!handle || !box || !box.parentElement) return;
    handle.onpointerdown = function (e) {
      e.preventDefault(); e.stopPropagation();
      var wrapW = box.parentElement.clientWidth || 1;
      var startX = e.clientX;
      var startFrac = lightboxKpOverlaySize || LB_KP_DEFAULT;
      var move = function (ev) {
        var frac = kpResizeFrac(startFrac, startX, ev.clientX, wrapW);
        lightboxKpOverlaySize = frac;
        box.style.width = (frac * 100) + '%';
      };
      var up = function () {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    };
  }
  function paintMarkupOverlay(r) {
    var canvas = $('pp-lb-markup-canvas'); if (!canvas) return;
    var imgEl = r.media_type === 'video' ? $('pp-lb-video') : $('pp-lb-img');
    var show = lightboxMarkupVisible && r.markup && r.markup.length;
    // ⚠️ Item 6 fix: `.pp-lb-markup`'s own base CSS rule is `display:none`
    // (module.css) — setting the inline style to an EMPTY STRING clears the
    // override rather than showing it, so it fell straight back to the
    // stylesheet's `none` and "show markup" never actually showed anything.
    // Must be an explicit non-none value.
    canvas.style.display = show ? 'block' : 'none';
    var mkBtn = $('pp-lb-markuptoggle');
    if (mkBtn) {
      mkBtn.classList.toggle('is-active', lightboxMarkupVisible);
      // Swap the glyph itself (eye / eyeOff), not just the active-class tint —
      // matching syncMkVisBtn's own fix for the identical listbar toggle. A
      // static "eye" icon that never changes shape is what read as unclear;
      // re-render the SVG directly rather than Icons.hydrate() (its one-time
      // dataset.icoDone guard would silently no-op from the second toggle on).
      var mkIc = mkBtn.querySelector('[data-ico]');
      if (mkIc && window.Icons) mkIc.innerHTML = Icons.svg(lightboxMarkupVisible ? 'eye' : 'eyeOff', 16);
    }
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
    var u = await ensureFullUrl(r);
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
    // "full load only when opening the photo" applies to an export too — a
    // download is an explicit user action on a specific (usually small)
    // selection, so signing full-res on demand HERE, for just this list,
    // costs nothing extra: it was never part of the project-wide upfront
    // batch to begin with (see signAll()'s own comment).
    await Promise.all(list.map(ensureFullUrl));
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

  // -------------------------------------------------- photo adjustments ---
  // Item 5 (2026-08-30, fourth round): "adjust exposure, brightness, contrast
  // and sharpness of photo." Stored as a plain {exposure,brightness,contrast,
  // sharpness} object on progress_photos.adjustments, each -100..100 (0 =
  // unchanged) — deliberately the SAME non-destructive, small-JSON-column
  // convention as markup: the original file is never touched or re-uploaded,
  // so a planner can always get back to exactly what the camera captured by
  // resetting the sliders to 0.
  //
  // Exposure/Brightness/Contrast render live and CHEAPLY everywhere a photo
  // appears (Gallery tiles, List rows, Stack cells, the lightbox) via the
  // browser's own CSS `filter`, which a canvas 2D context can also apply
  // verbatim (`ctx.filter = cssFilterFor(adj)`) — no per-frame pixel work,
  // no cost to the tile-loading speed item 1 just fixed.
  //
  // Sharpness has NO CSS filter equivalent (there is no `filter: sharpen()`)
  // — it needs real pixel convolution (getImageData/putImageData), which is
  // too costly to run on every tile in a scrolling grid. It is therefore
  // ONLY evaluated in the adjustment dialog's own live preview and — because
  // that is the one other place a planner is looking closely at ONE photo,
  // matching the exact "full resolution only when expanded" rule item 1
  // established — the lightbox. Tiles show exposure/brightness/contrast
  // only; the difference is invisible at tile size regardless.
  var ADJUST_DEFAULTS = { exposure: 0, brightness: 0, contrast: 0, sharpness: 0 };
  function adjustmentsOf(r) { return Object.assign({}, ADJUST_DEFAULTS, r && r.adjustments); }
  function adjustmentsAreDefault(adj) {
    return !adj || (Math.abs(adj.exposure || 0) < 0.5 && Math.abs(adj.brightness || 0) < 0.5 &&
      Math.abs(adj.contrast || 0) < 0.5 && Math.abs(adj.sharpness || 0) < 0.5);
  }
  // Exposure and Brightness both map onto CSS's one `brightness()` filter
  // (there is no separate "exposure" primitive in CSS) — they compose
  // multiplicatively rather than fighting over the same knob, so the two
  // sliders still do visibly different things together (e.g. +50 exposure
  // and -50 brightness roughly cancel, exactly as a photographer would
  // expect two opposing brightness-family controls to). Contrast maps onto
  // CSS's own `contrast()` directly. Range -100..100 maps to roughly
  // 0.3x..1.9x, clamped so an extreme slider can never invert or blank the
  // image entirely (0x or negative would).
  function pctToMultiplier(v) { return Math.max(0.3, Math.min(1.9, 1 + (v || 0) / 100)); }
  function cssFilterFor(adj) {
    adj = adj || ADJUST_DEFAULTS;
    if (adjustmentsAreDefault(adj)) return 'none';
    return 'brightness(' + pctToMultiplier(adj.exposure) + ') ' +
           'brightness(' + pctToMultiplier(adj.brightness) + ') ' +
           'contrast(' + pctToMultiplier(adj.contrast) + ')';
  }
  // A standard unsharp-mask-style 3x3 convolution: the centre pixel is
  // boosted by (1+4k) and its four direct neighbours subtracted by k each —
  // k=0 is a no-op (identity kernel), matching "sharpness 0 = unchanged".
  // Applied to whatever is ALREADY drawn on the canvas (so it composes with
  // ctx.filter's exposure/brightness/contrast, which runs at draw time,
  // rather than needing its own separate light/dark handling).
  function applySharpen(ctx, w, h, amount) {
    if (!amount) return;
    var k = Math.max(0, Math.min(1, amount / 100)) * 0.8;
    if (!k) return;
    var src, dst;
    try { src = ctx.getImageData(0, 0, w, h); } catch (e) { return; } // e.g. a cross-origin canvas — degrade to unsharpened rather than throwing
    dst = ctx.createImageData(w, h);
    var sd = src.data, dd = dst.data;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        for (var c = 0; c < 3; c++) {
          var center = sd[i + c];
          var up = y > 0 ? sd[i - w * 4 + c] : center;
          var down = y < h - 1 ? sd[i + w * 4 + c] : center;
          var left = x > 0 ? sd[i - 4 + c] : center;
          var right = x < w - 1 ? sd[i + 4 + c] : center;
          var v = center * (1 + 4 * k) - k * (up + down + left + right);
          dd[i + c] = Math.max(0, Math.min(255, v));
        }
        dd[i + 3] = sd[i + 3];
      }
    }
    ctx.putImageData(dst, 0, 0);
  }

  // ------------------------------------------------------- markup editor ---
  // 18-item list item 13/14, rebuilt 2026-08-30 per feedback item 4 into an
  // iOS-Photos-style tool set: pen, highlighter, ruler, shapes (rect/circle/
  // arrow), text, signature, a sticker palette (reusing the Equipment
  // Loading module's own plant pictograms, plus camera/person), and an
  // eraser. ONE engine, exposed publicly (openMarkupEditor below) so ppr.js's
  // presentation-only overlay reuses it rather than a second canvas
  // implementation.
  //
  // Storage format is a plain JS array of objects — never a second rasterised
  // image — so it stays small, can be toggled on/off losslessly, and
  // re-renders correctly at any canvas size:
  //   {type:'pen'|'highlighter'|'signature', points:[[x,y],...], color, width}
  //   {type:'rect'|'circle'|'ruler'|'arrow', x0,y0,x1,y1, color, width, fill, fillAlpha}
  //   {type:'text', x,y, text, color}
  //   {type:'icon', x,y, icon, color}   (icon: any key in MARKUP_STICKERS)
  // Coordinates are normalized 0..1 of the image's own box, exactly like
  // floor_plan_pins' x_norm/y_norm — the same reason: re-renders correctly
  // regardless of the canvas's actual pixel size.
  var MARKUP_COLORS = ['#EE3124', '#231F20', '#FFC400', '#1E88E5', '#43A047', '#8E24AA', '#FFFFFF'];
  var MARKUP_WIDTHS = [2, 4, 7];
  // 2026-09-02 owner feedback item 6: a line TYPE alongside line colour and
  // line weight. `o.lineType` is a plain field on every stroke-drawing
  // object (default 'solid' when unset, so nothing saved before this
  // feature changes appearance); `lineDashFor` is the one place that decides
  // what dash pattern each type means, read by drawMarkupObjects right
  // before every shape/stroke render so the choice can never disagree
  // between one object type and another.
  var MARKUP_LINE_TYPES = [
    { v: 'solid', label: 'Solid', dash: [] },
    { v: 'dashed', label: 'Dashed', dash: [10, 6] },
    { v: 'dotted', label: 'Dotted', dash: [2, 5] }
  ];
  function lineDashFor(t) {
    for (var i = 0; i < MARKUP_LINE_TYPES.length; i++) if (MARKUP_LINE_TYPES[i].v === t) return MARKUP_LINE_TYPES[i].dash;
    return [];
  }
  // Plant pictograms COPIED VERBATIM from modules/equipment-loading/index.html's
  // own EQ_ICONS (a module cannot import another module's file per the
  // module contract, so this is a deliberate duplicate, not a shared asset —
  // each is already a SINGLE SVG path 'd' string on a 24x24 grid, which
  // Path2D can paint directly onto a canvas, unlike icons.js's multi-element
  // glyphs). Camera and person are added per item 4's explicit request,
  // hand-drawn since they're each more than one primitive.
  var MARKUP_STICKERS = {
    towercrane: 'M3 4h18M12 4v16M6 20h12M12 7l-7 -3M5 4v3M9 4v3M12 7v2M10.5 9h3',
    mobilecrane: 'M3 16h11l6 -9M3 16v2h18v-2M6 18a1.6 1.6 0 1 0 3 0M14 18a1.6 1.6 0 1 0 3 0M20 7l-1 5',
    excavator: 'M3 18h12M3 18a2 2 0 0 1 0 -3h12a2 2 0 0 1 0 3M5 15v-4h6v4M11 12l5 -4 4 3M20 11l-2 4h-4',
    dozer: 'M3 17h13M3 17a2 2 0 0 1 0 -3h13a2 2 0 0 1 0 3M6 14v-4h6l2 4M20 8v8M20 8l-4 2v4l4 2',
    roller: 'M3 17a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M15 17a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M9 14h6M8 11h9v3',
    forklift: 'M4 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M12 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M6 16V8h5l2 8M17 5v13M17 9h4',
    truck: 'M3 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M15 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M3 16V6h10v10M13 10h4l3 3v3',
    mixer: 'M3 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M14 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M3 16V8h6l1 8M11 7l7 2l-2 7l-6 -2z',
    pump: 'M3 17h9M3 17a2 2 0 0 1 0 -3h9a2 2 0 0 1 0 3M5 14v-3h5v3M10 11l5 -5h6M15 6v4',
    pilerig: 'M5 19h9M5 19a2 2 0 0 1 0 -3h9a2 2 0 0 1 0 3M8 16V4h3M11 4v12M14 7h3v9',
    hoist: 'M6 21V3h4v18M6 3h8M10 7h5M10 12h5M15 5v9M17 21h-6',
    generator: 'M4 8h16v9H4zM7 17v2M17 17v2M8 11h3l-2 3h3M4 6h5',
    welder: 'M5 9h9v8H5zM14 12l5 -4M5 17v2M13 17v2M8 12h3',
    warn: 'M12 3l10 18H2z M12 9v5 M12 16.2v.1'
  };
  // The four kinds needing more than one Path2D subpath, drawn by hand.
  function drawIconStamp(ctx, name, cx, cy, size, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(2, size * 0.08);
    var r = size / 2;
    if (MARKUP_STICKERS[name]) {
      // Everything here is best-effort: translate/scale/Path2D are ordinary
      // 2D-canvas primitives on every real browser, but wrapped together
      // (not just the Path2D line) so a stubbed/partial canvas — a test
      // harness, or a future non-browser render target — degrades to "no
      // sticker drawn" instead of taking down the whole markup layer.
      try {
        ctx.translate(cx - r, cy - r); ctx.scale(size / 24, size / 24);
        // The scale() above already maps the path's own 24x24 grid onto the
        // stamp's real on-canvas size, so a CONSTANT line width here (in the
        // path's own pre-scale units) renders as a visually consistent
        // stroke regardless of `size`.
        ctx.lineWidth = 1.9;
        ctx.stroke(new Path2D(MARKUP_STICKERS[name]));
      } catch (e) {}
    } else if (name === 'arrow') {
      ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r * 0.5, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + r, cy); ctx.lineTo(cx + r * 0.3, cy - r * 0.5); ctx.lineTo(cx + r * 0.3, cy + r * 0.5); ctx.closePath(); ctx.fill();
    } else if (name === 'person') {
      ctx.beginPath(); ctx.arc(cx, cy - r * 0.5, r * 0.35, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.1); ctx.lineTo(cx, cy + r * 0.5); ctx.moveTo(cx - r * 0.4, cy + r * 0.9); ctx.lineTo(cx, cy + r * 0.5); ctx.lineTo(cx + r * 0.4, cy + r * 0.9);
      ctx.moveTo(cx - r * 0.35, cy + r * 0.05); ctx.lineTo(cx, cy + r * 0.25); ctx.lineTo(cx + r * 0.35, cy + r * 0.05); ctx.stroke();
    } else if (name === 'camera') {
      ctx.strokeRect(cx - r * 0.75, cy - r * 0.35, r * 1.5, r * 0.9);
      ctx.beginPath(); ctx.moveTo(cx - r * 0.35, cy - r * 0.35); ctx.lineTo(cx - r * 0.2, cy - r * 0.6); ctx.lineTo(cx + r * 0.25, cy - r * 0.6); ctx.lineTo(cx + r * 0.4, cy - r * 0.35); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy + r * 0.12, r * 0.28, 0, Math.PI * 2); ctx.stroke();
    } else { // 'equip' fallback
      ctx.strokeRect(cx - r * 0.7, cy - r * 0.5, r * 1.4, r);
      ctx.beginPath(); ctx.moveTo(cx - r * 0.35, cy - r * 0.5); ctx.lineTo(cx - r * 0.35, cy - r * 0.85); ctx.lineTo(cx + r * 0.35, cy - r * 0.85); ctx.lineTo(cx + r * 0.35, cy - r * 0.5); ctx.stroke();
    }
    ctx.restore();
  }
  var STICKER_NAMES = ['camera', 'person', 'warn', 'arrow'].concat(Object.keys(MARKUP_STICKERS).filter(function (k) { return k !== 'warn'; }));
  // Item 4: colours apply to BOTH the stroke and an optional, adjustable-
  // transparency FILL on shapes. hex -> rgba() at a given 0..1 alpha.
  function hexToRgba(hex, alpha) {
    var h = (hex || '#000000').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16) || 0, g = parseInt(h.slice(2, 4), 16) || 0, b = parseInt(h.slice(4, 6), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }
  // Item 3: fill and border/line colour can now be assigned independently.
  // `fillColor` is a SEPARATE field from `color` (the stroke); it defaults
  // to `color` when absent so every object saved BEFORE this feature
  // (single colour for both) keeps rendering exactly as it always did.
  function fillColorOf(o) { return o.fillColor || o.color || MARKUP_COLORS[0]; }
  // ⚠️ Real bug fixed ("add text is not working"/text hard to read): a newly
  // created text object stores `fill: fillOn`, and `fillOn` defaults to the
  // boolean `false` (the toolbar's own "Fill: On" checkbox starts unticked)
  // — NOT `undefined`. drawMarkupObjects' own three-state design only ever
  // meant `o.fill === false` as "the planner EXPLICITLY turned the box off"
  // (giving fully transparent text with no backing at all), reserving that
  // for an object someone had already selected and deliberately unticked;
  // "nobody has touched Fill yet" was meant to read as `undefined` and fall
  // back to a light, readable default backing. Because every freshly-typed
  // text box got the explicit `false` instead, it ALWAYS rendered with zero
  // background — easy to lose against a busy photo, which is what made
  // typing text look like it silently "did nothing". One function computes
  // the box colour so the live-typing overlay (openTextEditAt) and the
  // final canvas render (drawMarkupObjects) can never show two different
  // answers for the same object — null means "no box at all".
  function textBoxFillColor(o) {
    if (o.fill === false) return null;
    if (o.fill) return hexToRgba(fillColorOf(o), (o.fillAlpha == null ? 0.85 : o.fillAlpha));
    return 'rgba(255,255,255,.85)';
  }
  // Fifth round item 6 — rotation is a plain degrees field on EVERY object
  // type, applied as a canvas transform around the object's own bounding-box
  // centre (never baked into the stored coordinates) so a rotated shape's
  // points stay in the same simple, resize-friendly local space they always
  // were. markupCenterPx/rotatePointDeg are pure and genuinely executed by
  // test.js, since a flipped sign here would silently rotate every future
  // shape the wrong way with nothing in the UI to catch it.
  function markupCenterPx(o, w, h, ctx) {
    var box = markupBoundsPx(o, w, h, ctx);
    if (!box) return null;
    return { cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2 };
  }
  function rotatePointDeg(px, py, cx, cy, deg) {
    var rad = deg * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    var dx = px - cx, dy = py - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  }
  function drawMarkupObjects(ctx, objs, w, h, selectedIdx) {
    ctx.clearRect(0, 0, w, h);
    objs.forEach(function (o, oi) {
      var col = o.color || MARKUP_COLORS[0];
      ctx.save();
      // Rotate the WHOLE per-object draw (shape + its own selection box/
      // handles below) around its own centre — so the handles always track
      // the shape visually, and hit-testing only has to undo this one
      // transform (markupToLocal) rather than track rotated geometry itself.
      if (o.rotation) {
        var rc = markupCenterPx(o, w, h, ctx);
        if (rc) { ctx.translate(rc.cx, rc.cy); ctx.rotate(o.rotation * Math.PI / 180); ctx.translate(-rc.cx, -rc.cy); }
      }
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.lineWidth = o.width || 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // Item 6: the dash pattern is set once here, inside this object's own
      // ctx.save()/restore() pair (top/bottom of this forEach body) — so it
      // can never leak onto the NEXT object's stroke, with no explicit
      // reset needed before this function returns. ⚠️ Only called when there
      // IS a pattern (dashed/dotted) — 'solid'/unset never calls setLineDash
      // at all, matching a plain object's line drawing before this feature
      // existed byte-for-byte (an unconditional call here would also make
      // the selection-outline's own dashed-vs-not distinction unreliable,
      // since both would then always appear together on a selected object).
      var lineDash = lineDashFor(o.lineType);
      if (lineDash.length) ctx.setLineDash(lineDash);
      ctx.globalAlpha = 1;
      if (o.type === 'pen' && o.points && o.points.length) {
        ctx.beginPath();
        o.points.forEach(function (p, i) { var x = p[0] * w, y = p[1] * h; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.stroke();
      } else if (o.type === 'polygon' && o.points && o.points.length > 1) {
        // Item 3: a closed multi-vertex shape — click to add each corner,
        // double-click to close (see openMarkupEditor's polygon handling).
        ctx.beginPath();
        o.points.forEach(function (p, i) { var x = p[0] * w, y = p[1] * h; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.closePath();
        if (o.fill) { ctx.fillStyle = hexToRgba(fillColorOf(o), (o.fillAlpha == null ? 0.3 : o.fillAlpha)); ctx.fill(); }
        ctx.strokeStyle = col; ctx.stroke();
      } else if (o.type === 'line') {
        // Item 3: a plain straight line — the tool-neutral primitive that
        // Ruler (end-ticks) and Arrow (arrowhead) are each a decorated
        // version of.
        ctx.beginPath(); ctx.moveTo(o.x0 * w, o.y0 * h); ctx.lineTo(o.x1 * w, o.y1 * h); ctx.stroke();
      } else if (o.type === 'signature' && o.points && o.points.length) {
        // A thin, dark freehand stroke — visually distinct from an ordinary
        // pen mark so a signature reads as one on the page.
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, (o.width || 2) * 0.6);
        ctx.beginPath();
        o.points.forEach(function (p, i) { var x = p[0] * w, y = p[1] * h; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.stroke();
      } else if (o.type === 'highlighter' && o.points && o.points.length) {
        // Wide, translucent, drawn UNDER everything else already painted so
        // far — the classic "highlighter over text" look.
        ctx.globalAlpha = 0.35; ctx.lineWidth = (o.width || 4) * 4;
        ctx.beginPath();
        o.points.forEach(function (p, i) { var x = p[0] * w, y = p[1] * h; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (o.type === 'rect' || o.type === 'circle') {
        var x0 = o.x0 * w, y0 = o.y0 * h, x1 = o.x1 * w, y1 = o.y1 * h;
        if (o.fill) { ctx.fillStyle = hexToRgba(fillColorOf(o), (o.fillAlpha == null ? 0.3 : o.fillAlpha)); }
        if (o.type === 'rect') {
          if (o.fill) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
          ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        } else {
          var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          if (o.fill) ctx.fill();
          ctx.stroke();
        }
      } else if (o.type === 'ruler') {
        // A straight measuring/reference line with a small perpendicular
        // tick at each end (iOS Photos' "ruler" tool is a straight-edge
        // guide, not a unit-labelled measurement).
        var rx0 = o.x0 * w, ry0 = o.y0 * h, rx1 = o.x1 * w, ry1 = o.y1 * h;
        var ang2 = Math.atan2(ry1 - ry0, rx1 - rx0), tick = 8;
        ctx.beginPath(); ctx.moveTo(rx0, ry0); ctx.lineTo(rx1, ry1); ctx.stroke();
        [[rx0, ry0], [rx1, ry1]].forEach(function (pt) {
          ctx.beginPath();
          ctx.moveTo(pt[0] + tick * Math.sin(ang2), pt[1] - tick * Math.cos(ang2));
          ctx.lineTo(pt[0] - tick * Math.sin(ang2), pt[1] + tick * Math.cos(ang2));
          ctx.stroke();
        });
      } else if (o.type === 'arrow') {
        var ax0 = o.x0 * w, ay0 = o.y0 * h, ax1 = o.x1 * w, ay1 = o.y1 * h;
        ctx.beginPath(); ctx.moveTo(ax0, ay0); ctx.lineTo(ax1, ay1); ctx.stroke();
        var ang = Math.atan2(ay1 - ay0, ax1 - ax0), head = 14;
        ctx.beginPath(); ctx.moveTo(ax1, ay1);
        ctx.lineTo(ax1 - head * Math.cos(ang - Math.PI / 7), ay1 - head * Math.sin(ang - Math.PI / 7));
        ctx.lineTo(ax1 - head * Math.cos(ang + Math.PI / 7), ay1 - head * Math.sin(ang + Math.PI / 7));
        ctx.closePath(); ctx.fill();
      } else if (o.type === 'text') {
        // Fifth round item 5: an editable size (was a hardcoded 18px) and an
        // optional box FILL reusing the same fillColor/fillAlpha fields every
        // fillable shape already has (item 2's grouping applies to text too),
        // instead of a fixed white-ish box nobody could turn off or recolour.
        // Owner feedback ("format text and format textbox"): Bold/Italic are
        // now real per-object fields (default bold:true — matches the fixed
        // 700-weight every text object drawn before this had), and the box
        // can carry its own BORDER (o.boxBorder), stroked with this object's
        // own colour/width — "Line" now formats the textbox, not just the
        // text's own outline (there is none — canvas fillText has no stroke
        // concept here), giving the box a second, independent way to stand
        // out from a busy photo besides its fill.
        var fsz = o.fontSize || 18;
        var fWeight = o.bold === false ? '400' : '700';
        var fStyle = o.italic ? 'italic ' : '';
        ctx.font = fStyle + fWeight + ' ' + fsz + 'px Montserrat, Arial, sans-serif';
        ctx.textBaseline = 'top';
        var tx = o.x * w, ty = o.y * h;
        var metrics = ctx.measureText(o.text || '');
        var padX = Math.max(3, fsz * 0.18), padY = Math.max(2, fsz * 0.12);
        var boxW = metrics.width + padX * 2, boxH = fsz + padY * 2;
        // The two functions that decide what this box looks like — colour
        // (textBoxFillColor) and whether it exists at all — must NEVER
        // disagree with what the live-typing overlay (openTextEditAt) shows
        // for the SAME object, so both read the one shared helper.
        var boxFill = textBoxFillColor(o);
        if (boxFill) { ctx.fillStyle = boxFill; ctx.fillRect(tx - padX, ty - padY, boxW, boxH); }
        if (o.boxBorder) {
          ctx.strokeStyle = col; ctx.lineWidth = o.width || 2;
          ctx.strokeRect(tx - padX, ty - padY, boxW, boxH);
        }
        ctx.fillStyle = col;
        ctx.fillText(o.text || '', tx, ty);
      } else if (o.type === 'icon') {
        drawIconStamp(ctx, o.icon, o.x * w, o.y * h, o.size || 34, col);
      }
      // Item 3 (and item 6's resize/rotate below): a selected object gets a
      // visible dashed bounding box with real, draggable corner handles and a
      // rotate handle — drawn INSIDE this object's own rotation transform, so
      // the handles visually track a rotated shape without any extra math
      // here (markupHandleRects below undoes the same transform to hit-test).
      if (oi === selectedIdx) {
        var box = markupBoundsPx(o, w, h, ctx);
        if (box) {
          ctx.save();
          ctx.globalAlpha = 1; ctx.strokeStyle = '#1E88E5'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
          ctx.strokeRect(box.x0 - 8, box.y0 - 8, (box.x1 - box.x0) + 16, (box.y1 - box.y0) + 16);
          ctx.setLineDash([]);
          var hs = markupHandleRectsLocal(box);
          ctx.fillStyle = '#1E88E5';
          ['nw', 'ne', 'sw', 'se'].forEach(function (k) {
            ctx.beginPath(); ctx.rect(hs[k][0] - 5, hs[k][1] - 5, 10, 10); ctx.fill();
          });
          // Rotate handle: a small connector line up to a round grip.
          ctx.beginPath(); ctx.moveTo((box.x0 + box.x1) / 2, box.y0 - 8); ctx.lineTo(hs.rotate[0], hs.rotate[1]); ctx.stroke();
          ctx.beginPath(); ctx.arc(hs.rotate[0], hs.rotate[1], 6, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
      ctx.restore(); // matches the rotation-transform ctx.save() at the top of this object's block
    });
    ctx.globalAlpha = 1;
  }
  // Fixed handle POSITIONS in the object's own LOCAL (unrotated) space — the
  // canvas transform already applied by drawMarkupObjects rotates them onto
  // the screen for free when drawn; hit-testing undoes that same transform
  // on the pointer instead of forward-rotating these (markupToLocal below).
  function markupHandleRectsLocal(box) {
    var pad = 8;
    return {
      nw: [box.x0 - pad, box.y0 - pad], ne: [box.x1 + pad, box.y0 - pad],
      sw: [box.x0 - pad, box.y1 + pad], se: [box.x1 + pad, box.y1 + pad],
      rotate: [(box.x0 + box.x1) / 2, box.y0 - pad - 24]
    };
  }
  // Undoes an object's own rotation transform on a real (screen-space)
  // pointer point, so hit-testing a rotated object can compare against its
  // simple, never-rotated local geometry — the inverse of the ctx.rotate()
  // drawMarkupObjects applies before drawing that same object.
  function markupToLocal(px, py, o, w, h, ctx) {
    if (!o.rotation) return [px, py];
    var c = markupCenterPx(o, w, h, ctx);
    if (!c) return [px, py];
    return rotatePointDeg(px, py, c.cx, c.cy, -o.rotation);
  }
  // Which handle (if any) of the CURRENTLY SELECTED object the given
  // screen-space point lands on — 'nw'/'ne'/'sw'/'se' (resize) or 'rotate',
  // else null. Only ever tested against the one selected object, since
  // handles only render for it.
  function markupHandleHit(o, px, py, w, h, ctx) {
    var box = markupBoundsPx(o, w, h, ctx);
    if (!box) return null;
    var local = markupToLocal(px, py, o, w, h, ctx);
    var hs = markupHandleRectsLocal(box), R = 12;
    var keys = ['nw', 'ne', 'sw', 'se', 'rotate'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (Math.hypot(local[0] - hs[k][0], local[1] - hs[k][1]) <= R) return k;
    }
    return null;
  }
  // The on-canvas pixel bounding box of one markup object — used for both the
  // selection outline above and as the fallback "did I click this one"
  // region for shapes markupHitTest's point-distance test alone would miss
  // (e.g. clicking well inside a big rectangle, far from its centre).
  function markupBoundsPx(o, w, h, ctx) {
    if (o.type === 'icon') {
      var s = (o.size || 34) / 2;
      return { x0: o.x * w - s, y0: o.y * h - s, x1: o.x * w + s, y1: o.y * h + s };
    }
    // ⚠️ 2026-09-02 owner feedback item 2: "the textbox selection box doesn't
    // quite align with the text." Root cause: this branch used to return a
    // fixed square GUESS centred on (x,y) — width/height fixed to the
    // fontSize alone, with no regard for the string's real width. But
    // drawMarkupObjects' own text render (above) draws the box top-left
    // anchored at (tx-padX, ty-padY) and sized to the string's MEASURED
    // width (padX/padY/boxW/boxH, computed from ctx.measureText) — a
    // different box, both in size (a 4-letter word got the same square as a
    // 40-letter one) and in anchor (centred vs. top-left). This branch now
    // reproduces that exact same box, so the selection outline/handles and
    // the visible (and possibly rotated) text box can never disagree again.
    if (o.type === 'text') {
      var fsz = o.fontSize || 18;
      var fWeight = o.bold === false ? '400' : '700';
      var fStyle = o.italic ? 'italic ' : '';
      var tx = o.x * w, ty = o.y * h;
      var textW;
      if (ctx && ctx.measureText) {
        ctx.font = fStyle + fWeight + ' ' + fsz + 'px Montserrat, Arial, sans-serif';
        textW = ctx.measureText(o.text || '').width;
      } else {
        // No live canvas on hand to measure against (e.g. a structural test
        // calling this in isolation, or a hit-test path invoked before the
        // editor's own canvas exists) — approximate at ~0.55em/char, close
        // to what Montserrat/Arial average out to. Real interactive use
        // always has `ctx` in scope, so this fallback never runs there.
        textW = (o.text || '').length * fsz * 0.55;
      }
      var padX = Math.max(3, fsz * 0.18), padY = Math.max(2, fsz * 0.12);
      var boxW = textW + padX * 2, boxH = fsz + padY * 2;
      return { x0: tx - padX, y0: ty - padY, x1: tx - padX + boxW, y1: ty - padY + boxH };
    }
    if (o.points && o.points.length) {
      var xs = o.points.map(function (p) { return p[0] * w; }), ys = o.points.map(function (p) { return p[1] * h; });
      return { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys), x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) };
    }
    if (o.x0 != null) {
      return { x0: Math.min(o.x0, o.x1) * w, y0: Math.min(o.y0, o.y1) * h, x1: Math.max(o.x0, o.x1) * w, y1: Math.max(o.y0, o.y1) * h };
    }
    return null;
  }
  // Object hit test — used by BOTH the eraser (remove what's hit) and, since
  // item 3 ("I can't select the markup or shape to edit"), the Select tool
  // (grab what's hit, then let it be dragged/restyled/deleted). Two passes:
  // shapes with a real filled/enclosed AREA (rect/circle/polygon) are hit by
  // "is the point inside this shape's box", checked TOPMOST-OBJECT-FIRST
  // (later objects are drawn over earlier ones, so a click should prefer
  // whichever one is actually on top) — a bare centre-distance test would
  // make a large rectangle nearly impossible to grab except dead-centre.
  // Everything else (freehand strokes, lines, text, icons) keeps the
  // original nearest-point/nearest-anchor distance test, since a bounding-
  // box test on, say, a long diagonal signature would make almost the whole
  // canvas count as "inside" it.
  // ⚠️ Item 6: rotation-aware. A click is real screen-space, but a rotated
  // object's own geometry is stored UN-rotated — so every candidate object's
  // hit test now runs against the click point undone through THAT object's
  // own rotation (markupToLocal), not the raw point. An object with no
  // rotation is untouched (markupToLocal is a no-op then), so this is a
  // strict superset of the pre-rotation behaviour, not a rewrite of it.
  function markupHitTest(objs, nx, ny, w, h, ctx) {
    var px = nx * w, py = ny * h, PAD = 6;
    for (var i = objs.length - 1; i >= 0; i--) {
      var o = objs[i];
      if (o.type !== 'rect' && o.type !== 'circle' && o.type !== 'polygon') continue;
      var box = markupBoundsPx(o, w, h, ctx);
      var lp = markupToLocal(px, py, o, w, h, ctx);
      if (box && lp[0] >= box.x0 - PAD && lp[0] <= box.x1 + PAD && lp[1] >= box.y0 - PAD && lp[1] <= box.y1 + PAD) return i;
    }
    var best = -1, bestDist = 26; // px tolerance
    objs.forEach(function (o, i) {
      if (o.type === 'rect' || o.type === 'circle' || o.type === 'polygon') return; // handled above
      var lp = markupToLocal(px, py, o, w, h, ctx), lx = lp[0], ly = lp[1];
      var d = Infinity;
      if (o.type === 'pen' || o.type === 'highlighter' || o.type === 'signature') {
        (o.points || []).forEach(function (p) { d = Math.min(d, Math.hypot(p[0] * w - lx, p[1] * h - ly)); });
      } else if (o.type === 'text' || o.type === 'icon') {
        d = Math.hypot(o.x * w - lx, o.y * h - ly);
      } else {
        // line / ruler / arrow — the centre-of-the-endpoints test this file
        // already used, kept as-is for these three.
        var cx = (o.x0 + o.x1) / 2 * w, cy = (o.y0 + o.y1) / 2 * h;
        d = Math.hypot(cx - lx, cy - ly);
      }
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }
  // Item 3's drag-to-move: shifts every coordinate an object carries by the
  // same normalized delta, regardless of shape (points array vs x0/y0/x1/y1
  // vs a bare x/y) — one function so dragging can never move only PART of a
  // multi-point shape.
  function translateMarkupObj(o, dx, dy) {
    var n = Object.assign({}, o);
    if (n.points) n.points = n.points.map(function (p) { return [p[0] + dx, p[1] + dy]; });
    if (n.x0 != null) { n.x0 += dx; n.x1 += dx; n.y0 += dy; n.y1 += dy; }
    if (n.x != null && n.y != null && !n.points) { n.x += dx; n.y += dy; }
    return n;
  }
  // Item 6 — resize. The object's own NORMALIZED (never pixel) bounding box,
  // used only by resizeBoxObj below — distinct from markupBoundsPx (which is
  // pixel-space and also covers text/icon's synthetic box, neither of which
  // resizeBoxObj handles: those two resize by SIZE, not geometry, via
  // resizeSizeObj).
  function markupBoundsNorm(o) {
    if (o.points && o.points.length) {
      var xs = o.points.map(function (p) { return p[0]; }), ys = o.points.map(function (p) { return p[1]; });
      return { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys), x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) };
    }
    if (o.x0 != null) return { x0: Math.min(o.x0, o.x1), y0: Math.min(o.y0, o.y1), x1: Math.max(o.x0, o.x1), y1: Math.max(o.y0, o.y1) };
    return null;
  }
  // Resizes a bounded shape (rect/circle/polygon/line/ruler/arrow/pen/
  // highlighter/signature) by moving ONE corner to a new LOCAL (unrotated)
  // pixel position while the OPPOSITE corner stays fixed — the standard
  // anchor-corner resize every vector editor uses. `newLx/newLy` are already
  // in the object's own local space (the caller undoes rotation via
  // markupToLocal before calling this, same as the hit-test above) and in
  // PIXEL units; `w,h` convert back to the object's normalized storage.
  // Never mutates `o`. A drag collapsing the box to (or past) zero width/
  // height is clamped to a tiny minimum rather than inverting or vanishing
  // the shape out from under the user.
  function resizeBoxObj(o, corner, newLx, newLy, w, h) {
    var n = Object.assign({}, o);
    var box = markupBoundsNorm(o);
    if (!box) return n;
    var anchorX = (corner === 'ne' || corner === 'se') ? box.x0 : box.x1;
    var anchorY = (corner === 'sw' || corner === 'se') ? box.y0 : box.y1;
    var newXNorm = newLx / w, newYNorm = newLy / h;
    var oldW = box.x1 - box.x0, oldH = box.y1 - box.y0;
    var rawW = newXNorm - anchorX, rawH = newYNorm - anchorY;
    var MIN = 0.008;
    var newW = Math.abs(rawW) < MIN ? (rawW < 0 ? -MIN : MIN) : rawW;
    var newH = Math.abs(rawH) < MIN ? (rawH < 0 ? -MIN : MIN) : rawH;
    var sx = oldW === 0 ? 1 : newW / oldW, sy = oldH === 0 ? 1 : newH / oldH;
    function tx(x) { return anchorX + (x - anchorX) * sx; }
    function ty(y) { return anchorY + (y - anchorY) * sy; }
    if (n.points) n.points = o.points.map(function (p) { return [tx(p[0]), ty(p[1])]; });
    if (n.x0 != null) { n.x0 = tx(o.x0); n.x1 = tx(o.x1); n.y0 = ty(o.y0); n.y1 = ty(o.y1); }
    return n;
  }
  // Resizes a POINT object (text/icon) — there's no box to stretch, only a
  // font size / icon size, so a corner drag instead scales that size by
  // `scale` (the caller computes scale from how far the drag moved relative
  // to where it started). Clamped so a wild drag can't shrink text to
  // nothing or blow an icon up past the canvas.
  function resizeSizeObj(o, scale) {
    var n = Object.assign({}, o);
    if (n.type === 'text') n.fontSize = Math.max(8, Math.min(96, Math.round((o.fontSize || 18) * scale)));
    else if (n.type === 'icon') n.size = Math.max(12, Math.min(80, Math.round((o.size || 34) * scale)));
    return n;
  }
  // Item 6 — rotation. Converts a pointer offset FROM AN OBJECT'S OWN CENTRE
  // into a rotation in degrees, calibrated so a pointer straight above the
  // centre (dx=0, dy<0) yields 0° — i.e. rotation=0 always means "the rotate
  // handle points up", matching where drawMarkupObjects/markupHandleRectsLocal
  // actually draws it before any rotation is applied.
  function rotationFromPointer(dx, dy) {
    return ((Math.atan2(dy, dx) * 180 / Math.PI) + 90 + 360) % 360;
  }

  // Opens the shared markup editor. `imageUrl` is any already-signed URL
  // (a photo, or a PPR pane's photo — the caller resolves that);
  // `initialMarkup` is the existing array (or []); `onSave(newMarkup)` is
  // called with the finished array on Save, never called on Cancel.
  // Fourth feedback round, items 3/4 (2026-08-30): a real Select tool (drag
  // to move, restyle, delete an already-placed object — "I can't select the
  // markup or shape to edit"), independent border/fill colours, icon-only
  // tool buttons, and two new primitives (Line, Polygon).
  function openMarkupEditor(imageUrl, initialMarkup, onSave) {
    var objs = (initialMarkup || []).map(function (o) { return Object.assign({}, o); }); // work on a copy — Cancel must leave the original untouched
    var tool = 'select', color = MARKUP_COLORS[0], fillColor = MARKUP_COLORS[0], iconChoice = 'camera';
    var strokeWidth = MARKUP_WIDTHS[0], fillOn = false, fillAlpha = 0.3, fontSize = 18;
    var lineType = 'solid'; // item 6 — the next new object's line type; a selected object's own field wins (see syncControlsFromSelection)
    // "Format text and format textbox" — Bold/Italic style the TEXT itself;
    // Border draws a stroke around the textbox (using the same Line colour/
    // weight the box's Fill already borrows the Fill group's colour/alpha
    // from), a second, independent way for the box to stand out besides
    // its fill. Defaults match what every text object drawn before this
    // feature always looked like (bold, no italic, no border) so nothing
    // already-saved changes appearance.
    var textBold = true, textItalic = false, textBorder = false;
    var selectedIdx = -1;   // item 3: the currently grabbed object, -1 = none
    var undone = []; // redo stack (fifth round item 3) — cleared on any new edit, same as before
    var history = [objs.map(function (o) { return Object.assign({}, o); })];
    // Line joins the drag-from-point-A-to-B family; Ruler/Arrow keep their
    // own decorated look, Line is the plain, undecorated version of the same
    // gesture. Rect/Circle/Polygon/Text are the shapes with an interior a
    // Fill colour can apply to (text's "interior" is its background box —
    // fifth round item 5).
    var SHAPE_TOOLS = { rect: 1, circle: 1, arrow: 1, ruler: 1, line: 1 };
    var STROKE_TOOLS = { pen: 1, highlighter: 1 };
    function fillableType(t) { return t === 'rect' || t === 'circle' || t === 'polygon' || t === 'text'; }

    // Fifth round item 4: reordered per the owner's explicit list and
    // 'signature' removed as a pickable tool. drawMarkupObjects still knows
    // how to RENDER an existing signature-type object (backward
    // compatibility for markup saved before this round) — only the ability
    // to draw a NEW one is gone, matching how 'erase' already only removes,
    // never invents, an object type.
    var TOOL_ICONS = { select: 'cursor', pen: 'pencil', highlighter: 'highlighter', line: 'line',
      arrow: 'arrowRight', rect: 'square', circle: 'circleShape', polygon: 'polygon', ruler: 'ruler',
      text: 'textTool', icon: 'box', erase: 'eraser' };
    var TOOL_TITLES = { select: 'Select — tap a shape to move, resize, rotate, restyle, or delete it', pen: 'Pen',
      highlighter: 'Highlighter', line: 'Line', arrow: 'Arrow', rect: 'Rectangle', circle: 'Circle',
      polygon: 'Polygon — click each corner, double-click to finish', ruler: 'Ruler', text: 'Text — click, then type directly into the box',
      icon: 'Sticker', erase: 'Eraser' };
    var TOOL_ORDER = ['select', 'pen', 'highlighter', 'line', 'arrow', 'rect', 'circle', 'polygon', 'ruler', 'text', 'icon', 'erase'];
    function toolBtnHTML(t) {
      return '<button type="button" class="pp-mk-tool' + (t === tool ? ' active' : '') + '" data-tool="' + t +
        '" title="' + Fmt.esc(TOOL_TITLES[t]) + '" aria-label="' + Fmt.esc(TOOL_TITLES[t]) + '">' +
        (window.Icons ? Icons.svg(TOOL_ICONS[t], 18) : '') + '</button>';
    }
    var html =
      '<div class="pd-modal-header"><h3>Markup</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        // Tools grouped left, actions (Undo/Clear all) grouped right, with a
        // full-width divider under the whole bar — .pp-mk-toolbar just splits
        // into two flex groups; every id/data-attr below is unchanged, so the
        // existing querySelector wiring (by id or [data-*], not by parent) still
        // finds everything.
        // Item 11: the Tools row and the Line/Fill/Text option groups are now
        // two EXPLICIT stacked rows (.pp-mk-toolrow / .pp-mk-groupsrow) inside
        // .pp-mk-toolgroup, rather than one flex-wrap row that only happened
        // to break onto a second line once it ran out of width — "move line
        // colours group BELOW the tools group" needs the tools row to always
        // be its own row, not a width-dependent wrap.
        '<div class="pp-mk-toolbar">' +
        '<div class="pp-mk-toolgroup">' +
          '<div class="pp-mk-toolrow">' +
          '<div class="pp-mk-tools" role="tablist">' + TOOL_ORDER.map(toolBtnHTML).join('') + '</div>' +
          '<div class="pp-mk-icons pp-mk-stickers" id="pp-mk-icons" style="display:none;">' +
            STICKER_NAMES.map(function (ic) {
              // Camera/person/arrow aren't in MARKUP_STICKERS (they're hand-
              // drawn on canvas, more than one Path2D subpath) — their PALETTE
              // preview borrows the closest icons.js glyph instead so the
              // button isn't blank; the actual canvas stamp still uses
              // drawIconStamp's own hand-drawn shape, not this glyph.
              var previewName = { camera: 'camera', person: 'user', arrow: 'arrowRight' }[ic];
              var previewSvg = previewName && window.Icons ? Icons.svg(previewName, 20)
                : (MARKUP_STICKERS[ic] ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + MARKUP_STICKERS[ic] + '"></path></svg>' : '');
              return '<button type="button" class="pp-mk-sticker' + (ic === iconChoice ? ' active' : '') + '" data-icon="' + ic + '" title="' + ic + '">' +
                '<span style="display:inline-block;width:20px;height:20px;">' + previewSvg + '</span></button>';
            }).join('') +
          '</div>' +
          '</div>' +
          '<div class="pp-mk-groupsrow">' +
          // Fifth round item 2: Line colour + Line weight are now visually ONE
          // labelled group, and Fill colour + Fill transparency are a
          // SEPARATE labelled group beside it (item 11: "fill colour group
          // then beside line colour group") — the two were adjacent,
          // same-shaped swatch rows before, which is exactly what read as
          // "mixed up".
          '<div class="pp-mk-group pp-mk-group-line">' +
            '<span class="pp-mk-grouplabel">Line</span>' +
            '<div class="pp-mk-colors" id="pp-mk-colors" title="Line colour">' + MARKUP_COLORS.map(function (c) {
              return '<button type="button" class="pp-mk-swatch' + (c === color ? ' active' : '') + '" data-color="' + c + '" style="background:' + c + ';"></button>';
            }).join('') + '</div>' +
            '<div class="pp-mk-widths" id="pp-mk-widths">' + MARKUP_WIDTHS.map(function (wd, i) {
              return '<button type="button" class="pp-mk-width' + (wd === strokeWidth ? ' active' : '') + '" data-width="' + wd + '" title="Line weight">' +
                '<span style="width:' + (4 + i * 4) + 'px;height:' + (4 + i * 4) + 'px;"></span></button>';
            }).join('') + '</div>' +
            // Item 6: line TYPE (solid/dashed/dotted), the third thing that
            // formats a line/shape's border alongside its colour and weight
            // above. Each button previews its own dash pattern as a tiny
            // sample line rather than just naming it.
            '<div class="pp-mk-linetypes" id="pp-mk-linetypes" title="Line type">' + MARKUP_LINE_TYPES.map(function (lt) {
              return '<button type="button" class="pp-mk-linetype' + (lt.v === lineType ? ' active' : '') + '" data-linetype="' + lt.v + '" title="' + lt.label + '">' +
                '<svg width="20" height="8" viewBox="0 0 20 8"><line x1="1" y1="4" x2="19" y2="4" stroke="currentColor" stroke-width="2"' +
                (lt.dash.length ? ' stroke-dasharray="' + lt.dash.join(',') + '"' : '') + ' /></svg></button>';
            }).join('') + '</div>' +
          '</div>' +
          '<div class="pp-mk-group pp-mk-group-fill" id="pp-mk-fillrow" style="display:none;">' +
            '<span class="pp-mk-grouplabel">Fill</span>' +
            '<label><input type="checkbox" id="pp-mk-fillon"' + (fillOn ? ' checked' : '') + ' /> On</label>' +
            '<div class="pp-mk-colors pp-mk-fillcolors" id="pp-mk-fillcolors" title="Fill colour">' + MARKUP_COLORS.map(function (c) {
              return '<button type="button" class="pp-mk-swatch' + (c === fillColor ? ' active' : '') + '" data-fillcolor="' + c + '" style="background:' + c + ';"></button>';
            }).join('') + '</div>' +
            '<input type="range" id="pp-mk-fillalpha" min="0" max="100" value="' + Math.round(fillAlpha * 100) + '" title="Fill transparency" />' +
          '</div>' +
          // Fifth round item 5: text size, editable independently of line weight.
          // Issue 4 follow-up: "format text and format textbox" — Bold/Italic
          // style the TEXT itself, Border toggles a stroke on the textbox
          // (the fill colour/transparency for the box are handled by the
          // shared Fill group above, via fillableType() including 'text').
          '<div class="pp-mk-group pp-mk-group-text" id="pp-mk-textrow" style="display:none;">' +
            '<span class="pp-mk-grouplabel">Text</span>' +
            '<input type="range" id="pp-mk-fontsize" min="10" max="48" value="' + fontSize + '" title="Text size" />' +
            '<button type="button" class="pd-btn pp-mk-toggle" id="pp-mk-bold" title="Bold" style="font-weight:700;">B</button>' +
            '<button type="button" class="pd-btn pp-mk-toggle" id="pp-mk-italic" title="Italic" style="font-style:italic;">I</button>' +
            '<label class="pp-mk-checklabel" title="Draw a border around the text box">' +
              '<input type="checkbox" id="pp-mk-textborder" /> Border</label>' +
          '</div>' +
          '</div>' + // /.pp-mk-groupsrow
        '</div>' + // /.pp-mk-toolgroup
        '<div class="pp-mk-actiongroup">' +
          '<button type="button" class="pd-btn" id="pp-mk-undo" title="Undo">' + (window.Icons ? Icons.svg('undo', 16) : 'Undo') + '</button>' +
          // Fifth round item 3.
          '<button type="button" class="pd-btn" id="pp-mk-redo" title="Redo">' + (window.Icons ? Icons.svg('redo', 16) : 'Redo') + '</button>' +
          // Item 3: appears only once something is selected — deletes JUST
          // that object, distinct from "Clear all" beside it.
          '<button type="button" class="pd-btn pd-btn-danger" id="pp-mk-delsel" title="Delete selected" style="display:none;">' +
            (window.Icons ? Icons.svg('trash', 16) : 'Delete') + '</button>' +
          '<button type="button" class="pd-btn" id="pp-mk-clear">Clear all</button>' +
        '</div>' +
        '</div>' +
        '<div class="pp-mk-canvaswrap" id="pp-mk-canvaswrap">' +
          '<img id="pp-mk-img" src="' + Fmt.esc(imageUrl) + '" alt="" />' +
          '<canvas id="pp-mk-canvas"></canvas>' +
          // Fifth round item 5: real on-canvas typing, not a browser prompt() —
          // this sits absolutely-positioned over the canvas, shown/hidden and
          // repositioned by openTextEditAt() below, never rendered by
          // drawMarkupObjects itself (the canvas draws the COMMITTED object;
          // this is only visible mid-edit).
          '<div class="pp-mk-textedit" id="pp-mk-textedit" contenteditable="true" style="display:none;"></div>' +
        '</div>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="pp-mk-save">Save markup</button></div>';
    // ⚠️ Audit fix: onClose now covers × / Cancel AND a backdrop click alike
    // (previously only the [data-close] re-wiring further down did, so
    // dismissing via backdrop click left this listener on `window` forever
    // — see openModal's own comment for the mechanism).
    var m = openModal(html, 900, function () { window.removeEventListener('resize', sizeCanvas); });

    var canvas = $('pp-mk-canvas'), ctx = canvas.getContext('2d'), img = $('pp-mk-img'), textEl = $('pp-mk-textedit');
    function sizeCanvas() {
      var r = img.getBoundingClientRect();
      canvas.width = r.width; canvas.height = r.height;
      canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
      redraw();
    }
    function redraw() { drawMarkupObjects(ctx, objs, canvas.width, canvas.height, selectedIdx); }
    function pushHistory() { history.push(objs.map(function (o) { return Object.assign({}, o); })); undone = []; }
    if (img.complete) sizeCanvas(); else img.onload = sizeCanvas;
    window.addEventListener('resize', sizeCanvas);

    function syncDelBtn() { var b = $('pp-mk-delsel'); if (b) b.style.display = selectedIdx >= 0 ? '' : 'none'; }
    // Item 3: while something is selected, the toolbar reflects and edits
    // THAT object's own properties (rather than "the next new shape's"
    // defaults) — so a planner clicking a colour swatch after grabbing a
    // rectangle sees, and changes, the rectangle they're looking at.
    function syncFillRow() {
      var el = $('pp-mk-fillrow'); if (!el) return;
      var showFor = selectedIdx >= 0 ? objs[selectedIdx].type : tool;
      el.style.display = fillableType(showFor) ? '' : 'none';
    }
    function syncTextRow() {
      var el = $('pp-mk-textrow'); if (!el) return;
      var sel = selectedIdx >= 0 ? objs[selectedIdx] : null;
      var showFor = sel ? sel.type : tool;
      el.style.display = showFor === 'text' ? '' : 'none';
      if (showFor !== 'text') return;
      // Reflects either the SELECTED text object's own formatting, or (with
      // nothing selected) the defaults the NEXT new text object will get —
      // same "selection wins, else the default" convention as the color/fill
      // controls elsewhere in this toolbar.
      var b = sel ? sel.bold !== false : textBold;
      var i = sel ? !!sel.italic : textItalic;
      var bd = sel ? !!sel.boxBorder : textBorder;
      if ($('pp-mk-bold')) $('pp-mk-bold').classList.toggle('active', b);
      if ($('pp-mk-italic')) $('pp-mk-italic').classList.toggle('active', i);
      if ($('pp-mk-textborder')) $('pp-mk-textborder').checked = bd;
    }
    function syncControlsFromSelection() {
      if (selectedIdx < 0) return;
      var o = objs[selectedIdx];
      var c = o.color || color, fc = fillColorOf(o), w = o.width || strokeWidth, lt = o.lineType || 'solid';
      Array.prototype.forEach.call(m.el.querySelectorAll('[data-color]'), function (x) { x.classList.toggle('active', x.dataset.color === c); });
      Array.prototype.forEach.call(m.el.querySelectorAll('[data-fillcolor]'), function (x) { x.classList.toggle('active', x.dataset.fillcolor === fc); });
      Array.prototype.forEach.call(m.el.querySelectorAll('[data-width]'), function (x) { x.classList.toggle('active', +x.dataset.width === w); });
      Array.prototype.forEach.call(m.el.querySelectorAll('[data-linetype]'), function (x) { x.classList.toggle('active', x.dataset.linetype === lt); });
      if ($('pp-mk-fillon')) $('pp-mk-fillon').checked = !!o.fill;
      if ($('pp-mk-fillalpha')) $('pp-mk-fillalpha').value = Math.round((o.fillAlpha == null ? 0.3 : o.fillAlpha) * 100);
      if ($('pp-mk-fontsize') && o.type === 'text') $('pp-mk-fontsize').value = o.fontSize || 18;
      // Bold/Italic/Border are reflected inside syncTextRow() itself (it
      // reads `objs[selectedIdx]` directly), so nothing further needed here.
      syncFillRow(); syncTextRow();
    }
    // Cancels an in-progress, not-yet-finished polygon (e.g. the planner
    // switched tools mid-click) — discarded rather than silently committed
    // with too few vertices to be a real shape.
    var polyPoints = null, polyObjIdx = null;
    function cancelPolygon() {
      if (polyObjIdx != null) objs.splice(polyObjIdx, 1);
      polyPoints = null; polyObjIdx = null;
    }
    // ------------------------------------------------- fifth round item 5 ---
    // Real on-canvas text entry. Opens a positioned, styled contenteditable
    // box over `objs[idx]`'s own x/y — typing goes straight into it, Enter
    // (no shift) or blur commits, Escape discards. `isNew` controls what
    // "commit with empty text" means: a just-created object is REMOVED (the
    // old prompt()'s "cancelled if blank" behaviour); an EXISTING object
    // emptied out this way is also removed, since a text box with nothing in
    // it isn't a markup worth keeping either way.
    var editingTextIdx = -1, editingTextWasNew = false, editingOrigText = '';
    function closeTextEdit(commit) {
      if (editingTextIdx < 0) { textEl.style.display = 'none'; return; }
      var idx = editingTextIdx, wasNew = editingTextWasNew;
      textEl.onblur = null;
      textEl.style.display = 'none';
      editingTextIdx = -1;
      if (!commit) {
        if (wasNew) objs.splice(idx, 1); else objs[idx].text = editingOrigText;
        redraw();
        return;
      }
      var val = (textEl.innerText || textEl.textContent || '').replace(/\n+$/, '');
      if (!val.trim()) { objs.splice(idx, 1); selectedIdx = -1; syncDelBtn(); }
      else { objs[idx].text = val; }
      pushHistory(); redraw();
    }
    function openTextEditAt(idx) {
      var o = objs[idx];
      editingTextIdx = idx; editingOrigText = o.text || '';
      textEl.textContent = o.text || '';
      textEl.style.left = (o.x * canvas.width) + 'px';
      textEl.style.top = (o.y * canvas.height) + 'px';
      textEl.style.fontSize = (o.fontSize || 18) + 'px';
      textEl.style.color = o.color || color;
      // ⚠️ Unified with the final canvas render via the shared textBoxFillColor()
      // helper — previously this line's own inline fallback logic disagreed with
      // drawMarkupObjects' (a colored fill showed WHILE typing, then reverted to
      // plain white the instant it committed), which is exactly the kind of
      // "looks broken" mismatch behind the "add text is not working" report.
      var boxBg = textBoxFillColor(o);
      textEl.style.background = boxBg || 'transparent';
      textEl.style.fontWeight = o.bold === false ? '400' : '700';
      textEl.style.fontStyle = o.italic ? 'italic' : 'normal';
      textEl.style.border = o.boxBorder ? '2px solid ' + (o.color || color) : 'none';
      textEl.style.display = 'block';
      textEl.onblur = function () { closeTextEdit(true); };
      textEl.onkeydown = function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textEl.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeTextEdit(false); }
      };
      textEl.focus();
      // Select-all so typing over a re-opened existing caption replaces it
      // rather than requiring a manual select first.
      try {
        var range = document.createRange(); range.selectNodeContents(textEl);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      } catch (e) {}
    }
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-tool]'), function (b) {
      b.onclick = function () {
        cancelPolygon();
        if (editingTextIdx >= 0) closeTextEdit(true);
        tool = this.dataset.tool;
        selectedIdx = -1; syncDelBtn();
        Array.prototype.forEach.call(m.el.querySelectorAll('[data-tool]'), function (x) { x.classList.toggle('active', x.dataset.tool === tool); });
        $('pp-mk-icons').style.display = tool === 'icon' ? '' : 'none';
        syncFillRow(); syncTextRow();
        redraw();
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
        var c = this.dataset.color;
        if (selectedIdx >= 0) {
          objs[selectedIdx].color = c; pushHistory(); redraw();
          if (editingTextIdx === selectedIdx) textEl.style.color = c;
        } else color = c;
        Array.prototype.forEach.call(m.el.querySelectorAll('[data-color]'), function (x) { x.classList.toggle('active', x.dataset.color === c); });
      };
    });
    // Item 3: fill colour is a SEPARATE swatch row from border colour.
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-fillcolor]'), function (b) {
      b.onclick = function () {
        var c = this.dataset.fillcolor;
        if (selectedIdx >= 0) { objs[selectedIdx].fillColor = c; pushHistory(); redraw(); }
        else fillColor = c;
        Array.prototype.forEach.call(m.el.querySelectorAll('[data-fillcolor]'), function (x) { x.classList.toggle('active', x.dataset.fillcolor === c); });
      };
    });
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-width]'), function (b) {
      b.onclick = function () {
        var w = +this.dataset.width;
        if (selectedIdx >= 0) { objs[selectedIdx].width = w; pushHistory(); redraw(); }
        else strokeWidth = w;
        Array.prototype.forEach.call(m.el.querySelectorAll('[data-width]'), function (x) { x.classList.toggle('active', +x.dataset.width === w); });
      };
    });
    // Item 6: line type — same "edit the selection, else set the next new
    // object's default" convention as colour/fill/width above.
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-linetype]'), function (b) {
      b.onclick = function () {
        var lt = this.dataset.linetype;
        if (selectedIdx >= 0) { objs[selectedIdx].lineType = lt; pushHistory(); redraw(); }
        else lineType = lt;
        Array.prototype.forEach.call(m.el.querySelectorAll('[data-linetype]'), function (x) { x.classList.toggle('active', x.dataset.linetype === lt); });
      };
    });
    if ($('pp-mk-fillon')) $('pp-mk-fillon').onchange = function () {
      if (selectedIdx >= 0) { objs[selectedIdx].fill = this.checked; pushHistory(); redraw(); }
      else fillOn = this.checked;
    };
    if ($('pp-mk-fillalpha')) $('pp-mk-fillalpha').oninput = function () {
      var a = (+this.value) / 100;
      if (selectedIdx >= 0) { objs[selectedIdx].fillAlpha = a; redraw(); }
      else fillAlpha = a;
    };
    // Fifth round item 5: live text-size control, applies to the selected
    // text object (or the next new one when nothing's selected).
    if ($('pp-mk-fontsize')) $('pp-mk-fontsize').oninput = function () {
      var v = +this.value;
      if (selectedIdx >= 0 && objs[selectedIdx].type === 'text') {
        objs[selectedIdx].fontSize = v; redraw();
        if (editingTextIdx === selectedIdx) textEl.style.fontSize = v + 'px';
      } else fontSize = v;
    };
    if ($('pp-mk-fontsize')) $('pp-mk-fontsize').onchange = function () { if (selectedIdx >= 0) pushHistory(); };
    // Issue 4 follow-up: Bold/Italic/Border — same "edit the selected object,
    // else set the default for the next new one" pattern as color/fill/size.
    function applyTextStyleLive(idx) {
      if (editingTextIdx !== idx) return;
      var o = objs[idx];
      textEl.style.fontWeight = o.bold === false ? '400' : '700';
      textEl.style.fontStyle = o.italic ? 'italic' : 'normal';
      textEl.style.border = o.boxBorder ? '2px solid ' + (o.color || color) : 'none';
    }
    if ($('pp-mk-bold')) $('pp-mk-bold').onclick = function () {
      if (selectedIdx >= 0 && objs[selectedIdx].type === 'text') {
        var o = objs[selectedIdx];
        o.bold = o.bold === false ? true : false;
        this.classList.toggle('active', o.bold !== false);
        applyTextStyleLive(selectedIdx);
        pushHistory(); redraw();
      } else {
        textBold = !textBold;
        this.classList.toggle('active', textBold);
      }
    };
    if ($('pp-mk-italic')) $('pp-mk-italic').onclick = function () {
      if (selectedIdx >= 0 && objs[selectedIdx].type === 'text') {
        var o = objs[selectedIdx];
        o.italic = !o.italic;
        this.classList.toggle('active', !!o.italic);
        applyTextStyleLive(selectedIdx);
        pushHistory(); redraw();
      } else {
        textItalic = !textItalic;
        this.classList.toggle('active', textItalic);
      }
    };
    if ($('pp-mk-textborder')) $('pp-mk-textborder').onchange = function () {
      if (selectedIdx >= 0 && objs[selectedIdx].type === 'text') {
        objs[selectedIdx].boxBorder = this.checked;
        applyTextStyleLive(selectedIdx);
        pushHistory(); redraw();
      } else {
        textBorder = this.checked;
      }
    };
    $('pp-mk-undo').onclick = function () {
      if (history.length < 2) return;
      undone.push(history.pop());
      objs = history[history.length - 1].map(function (o) { return Object.assign({}, o); });
      selectedIdx = -1; syncDelBtn(); redraw();
    };
    // Fifth round item 3 — redo replays whatever undo just popped, mirroring
    // it exactly: pop `undone`'s top back onto `history` and restore from it.
    // A fresh edit (pushHistory) clears `undone`, so a stale redo can never
    // resurrect a branch abandoned several edits ago.
    $('pp-mk-redo').onclick = function () {
      if (!undone.length) return;
      history.push(undone.pop());
      objs = history[history.length - 1].map(function (o) { return Object.assign({}, o); });
      selectedIdx = -1; syncDelBtn(); redraw();
    };
    $('pp-mk-clear').onclick = function () { objs = []; selectedIdx = -1; syncDelBtn(); pushHistory(); redraw(); };
    if ($('pp-mk-delsel')) $('pp-mk-delsel').onclick = function () {
      if (selectedIdx < 0) return;
      objs.splice(selectedIdx, 1); selectedIdx = -1; syncDelBtn(); pushHistory(); redraw();
    };

    var drawing = false, penPoints = null, dragOrig = null, dragStart = null;
    // Fifth round item 6 — resize/rotate interaction state. Only ever set
    // while `tool === 'select'` and something is already selected; a plain
    // move-drag (dragOrig above) and these are mutually exclusive per pointer
    // gesture (pointerdown decides which, if any, applies).
    var resizing = false, resizeCorner = null, resizeOrig = null, resizeStartDist = 0;
    var rotating = false, rotateOrig = null, rotateCenter = null;
    function toNorm(e) {
      var r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    }
    canvas.addEventListener('pointerdown', function (e) {
      // Item 12 fix: a canvas has no `tabindex` and is not natively focusable,
      // so the BROWSER'S OWN default mousedown action — which runs right
      // after this handler returns — blurs whatever currently has focus and
      // tries to focus the (unfocusable) canvas instead. That happens to run
      // just after the Text tool's own `textEl.focus()` below, so the
      // just-opened text box was blurred again within the same click, and
      // `closeTextEdit`'s onblur handler then deleted it for being empty —
      // "clicking Text does nothing" was this, not a missing feature.
      // Proved live: a real `page.mouse.down()/up()` click reproduced it,
      // while a bare synthetic `dispatchEvent(new PointerEvent(...))` (which
      // never runs the browser's native default action) did not.
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      if (editingTextIdx >= 0) closeTextEdit(true);
      var p = toNorm(e);
      var px = p[0] * canvas.width, py = p[1] * canvas.height;
      if (tool === 'select') {
        // Fifth round item 6: a handle on the ALREADY-selected object takes
        // priority over re-hit-testing/re-selecting — otherwise grabbing a
        // corner handle that happens to sit over empty space near the shape
        // would just deselect it instead of resizing.
        if (selectedIdx >= 0) {
          var h = markupHandleHit(objs[selectedIdx], px, py, canvas.width, canvas.height, ctx);
          if (h === 'rotate') {
            rotating = true; drawing = true;
            rotateOrig = Object.assign({}, objs[selectedIdx]);
            rotateCenter = markupCenterPx(objs[selectedIdx], canvas.width, canvas.height, ctx);
            return;
          }
          if (h) {
            resizing = true; drawing = true; resizeCorner = h;
            resizeOrig = Object.assign({}, objs[selectedIdx]);
            if (resizeOrig.type === 'text' || resizeOrig.type === 'icon') {
              resizeStartDist = Math.max(1, Math.hypot(resizeOrig.x * canvas.width - px, resizeOrig.y * canvas.height - py));
            }
            return;
          }
        }
        var hit = markupHitTest(objs, p[0], p[1], canvas.width, canvas.height, ctx);
        selectedIdx = hit;
        syncDelBtn();
        if (hit >= 0) {
          dragOrig = Object.assign({}, objs[hit]); dragStart = p; drawing = true;
          syncControlsFromSelection();
        } else {
          drawing = false;
          syncFillRow(); syncTextRow();
        }
        redraw();
        return;
      }
      if (tool === 'erase') {
        var idx = markupHitTest(objs, p[0], p[1], canvas.width, canvas.height, ctx);
        if (idx >= 0) { objs.splice(idx, 1); pushHistory(); redraw(); }
        return;
      }
      if (tool === 'text') {
        // Fifth round item 5: no more prompt() — a blank object is created
        // and immediately opened for direct on-canvas typing; closeTextEdit
        // removes it again if nothing was ever typed (isNew=true).
        // ⚠️ Real bug fixed: `fill` used to be set to fillOn's boolean value
        // UNCONDITIONALLY — including an explicit `false` when fillOn was off
        // (its own default). textBoxFillColor() treats fill===false as "user
        // explicitly turned the box off", so every brand-new text object was
        // silently born with NO readable background, contradicting the
        // documented default-on-white-backing behaviour. Now `fill` is only
        // ever set when it's actually true; omitted (undefined) lets
        // textBoxFillColor() apply its default white box, matching what the
        // live-typing overlay already shows via the same helper.
        var newTextObj = {
          type: 'text', x: p[0], y: p[1], text: '', color: color, fontSize: fontSize,
          fillColor: fillColor, fillAlpha: fillAlpha, lineType: lineType,
          bold: textBold, italic: textItalic, boxBorder: textBorder
        };
        if (fillOn) newTextObj.fill = true;
        objs.push(newTextObj);
        selectedIdx = objs.length - 1;
        redraw();
        openTextEditAt(selectedIdx);
        editingTextWasNew = true;
        return;
      }
      if (tool === 'icon') {
        objs.push({ type: 'icon', x: p[0], y: p[1], icon: iconChoice, color: color });
        pushHistory(); redraw(); return;
      }
      if (tool === 'polygon') {
        // Item 3: click each corner; the shape's LAST point always tracks
        // the pointer live (pointermove below) until the next click commits
        // it and opens a fresh preview point after it.
        if (polyPoints === null) {
          polyPoints = [p];
          objs.push({ type: 'polygon', points: [p, p], color: color, width: strokeWidth, lineType: lineType, fill: fillOn, fillColor: fillColor, fillAlpha: fillAlpha });
          polyObjIdx = objs.length - 1;
        } else {
          polyPoints.push(p);
          objs[polyObjIdx].points = polyPoints.concat([p]);
        }
        redraw();
        return;
      }
      drawing = true;
      if (STROKE_TOOLS[tool]) {
        penPoints = [p];
        objs.push({ type: tool, points: penPoints, color: color, width: strokeWidth, lineType: lineType });
      } else {
        objs.push({ type: tool, x0: p[0], y0: p[1], x1: p[0], y1: p[1], color: color, width: strokeWidth, lineType: lineType, fill: fillOn, fillColor: fillColor, fillAlpha: fillAlpha });
      }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (tool === 'polygon' && polyPoints !== null) {
        // Live preview of the NEXT edge, before it's clicked into place.
        objs[polyObjIdx].points = polyPoints.concat([toNorm(e)]);
        redraw();
        return;
      }
      if (!drawing) return;
      var p = toNorm(e);
      var px = p[0] * canvas.width, py = p[1] * canvas.height;
      if (rotating) {
        objs[selectedIdx] = Object.assign({}, rotateOrig, { rotation: rotationFromPointer(px - rotateCenter.cx, py - rotateCenter.cy) });
        redraw(); return;
      }
      if (resizing) {
        if (resizeOrig.type === 'text' || resizeOrig.type === 'icon') {
          var dist = Math.hypot(resizeOrig.x * canvas.width - px, resizeOrig.y * canvas.height - py);
          objs[selectedIdx] = resizeSizeObj(resizeOrig, dist / resizeStartDist);
        } else {
          var local = markupToLocal(px, py, resizeOrig, canvas.width, canvas.height, ctx);
          objs[selectedIdx] = resizeBoxObj(resizeOrig, resizeCorner, local[0], local[1], canvas.width, canvas.height);
        }
        redraw(); return;
      }
      if (tool === 'select') {
        if (selectedIdx < 0 || !dragOrig) return;
        objs[selectedIdx] = translateMarkupObj(dragOrig, p[0] - dragStart[0], p[1] - dragStart[1]);
      } else if (STROKE_TOOLS[tool]) {
        penPoints.push(p);
      } else {
        var last = objs[objs.length - 1]; last.x1 = p[0]; last.y1 = p[1];
      }
      redraw();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      canvas.addEventListener(ev, function () {
        if (!drawing) return;
        drawing = false;
        if (resizing || rotating) { resizing = false; rotating = false; resizeOrig = null; rotateOrig = null; }
        if (tool === 'select') { dragOrig = null; }
        pushHistory();
      });
    });
    // Polygon is finished by DOUBLE-CLICK, not pointerup — it's a multi-
    // click gesture, not a drag. Fewer than 3 real vertices isn't a shape;
    // it's discarded rather than saved as a degenerate 2-point sliver.
    // Fifth round item 5: double-clicking an existing TEXT object (select
    // tool) reopens it for direct editing instead.
    canvas.addEventListener('dblclick', function (e) {
      if (tool === 'polygon' && polyPoints !== null) {
        if (polyPoints.length >= 3) { objs[polyObjIdx].points = polyPoints.slice(); pushHistory(); }
        else { objs.splice(polyObjIdx, 1); }
        polyPoints = null; polyObjIdx = null;
        redraw();
        return;
      }
      if (tool === 'select' && selectedIdx >= 0 && objs[selectedIdx].type === 'text') {
        editingTextWasNew = false;
        openTextEditAt(selectedIdx);
      }
    });

    // ⚠️ Audit fix: the [data-close] re-wire that used to live here is
    // gone — openModal's own onClose (passed above) now removes the
    // resize listener on EVERY dismissal path, including backdrop click,
    // which this per-button re-wire never covered. m.close() below already
    // runs it, so no separate removeEventListener call is needed here either.
    $('pp-mk-save').onclick = function () {
      cancelPolygon();
      if (editingTextIdx >= 0) closeTextEdit(true);
      m.close();
      if (onSave) onSave(objs);
    };
  }

  // ---------------------------------------------------- adjustments editor ---
  // Item 5 (2026-08-30, fourth round). `onSave(newAdjustments)` mirrors
  // openMarkupEditor's own contract exactly (never called on Cancel) so both
  // editors' callers (Add Media's staged-file grid, the lightbox) look the
  // same either way.
  function openAdjustEditor(imageUrl, initialAdjustments, onSave) {
    var adj = adjustmentsOf({ adjustments: initialAdjustments });
    var FIELDS = [
      { key: 'exposure', label: 'Exposure' },
      { key: 'brightness', label: 'Brightness' },
      { key: 'contrast', label: 'Contrast' },
      { key: 'sharpness', label: 'Sharpness' }
    ];
    var html =
      '<div class="pd-modal-header"><h3>Adjust</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        // The <img> stays visible and laid out (needed so getBoundingClientRect
        // reports a real size to draw the canvas at) — the canvas sits
        // absolutely on top of it and, since drawImage repaints the whole
        // rect opaquely, fully covers it the instant the first redraw runs.
        // Same overlay pairing openMarkupEditor's own canvas uses.
        '<div class="pp-adj-canvaswrap pp-mk-canvaswrap" id="pp-adj-canvaswrap">' +
          '<img id="pp-adj-img" src="' + Fmt.esc(imageUrl) + '" alt="" />' +
          '<canvas id="pp-adj-canvas"></canvas>' +
        '</div>' +
        '<div class="pp-adj-sliders">' + FIELDS.map(function (f) {
          return '<label class="pp-adj-row">' + f.label +
            ' <span class="pp-adj-val" id="pp-adj-val-' + f.key + '">' + adj[f.key] + '</span>' +
            '<input type="range" min="-100" max="100" value="' + adj[f.key] + '" id="pp-adj-' + f.key + '" /></label>';
        }).join('') + '</div>' +
        '<button type="button" class="pd-btn" id="pp-adj-reset">Reset to original</button>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="pp-adj-save">Save adjustments</button></div>';
    // Same fix as openMarkupEditor's own onClose (2026-08-30): passed to
    // openModal directly, which covers × / Cancel / backdrop-click alike —
    // never a separate [data-close] re-wire, which would miss the backdrop
    // path and leak this resize listener exactly like the audited bug did.
    var m = openModal(html, 700, function () { window.removeEventListener('resize', redraw); });
    var canvas = $('pp-adj-canvas'), ctx = canvas.getContext('2d'), img = $('pp-adj-img');
    function redraw() {
      var r = img.getBoundingClientRect();
      // A 0-sized box (image not yet loaded/laid out — including the whole
      // fake-DOM test harness, which never lays anything out) draws nothing
      // rather than a canvas full of NaN geometry.
      if (!r.width || !r.height) return;
      canvas.width = r.width; canvas.height = r.height;
      canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
      ctx.filter = cssFilterFor(adj);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none'; // sharpen's own convolution must not be filtered AGAIN on top
      applySharpen(ctx, canvas.width, canvas.height, adj.sharpness);
    }
    if (img.complete) redraw(); else img.onload = redraw;
    window.addEventListener('resize', redraw);

    FIELDS.forEach(function (f) {
      var el = $('pp-adj-' + f.key); if (!el) return;
      el.oninput = function () {
        adj[f.key] = +this.value;
        var v = $('pp-adj-val-' + f.key); if (v) v.textContent = this.value;
        redraw();
      };
    });
    if ($('pp-adj-reset')) $('pp-adj-reset').onclick = function () {
      adj = Object.assign({}, ADJUST_DEFAULTS);
      FIELDS.forEach(function (f) {
        var el = $('pp-adj-' + f.key); if (el) el.value = 0;
        var v = $('pp-adj-val-' + f.key); if (v) v.textContent = '0';
      });
      redraw();
    };
    $('pp-adj-save').onclick = function () {
      m.close();
      if (onSave) onSave(adj);
    };
  }

  // --------------------------------------------------------------- upload ---
  function reqMark() { return ' <span class="pp-req">*</span>'; }
  // Capture date / Works / Location / View name are required, with two
  // narrow, explicit waivers (2026-08-30 feedback items 6 & 7): Works is
  // only required when the project's SCHEDULE actually offers activities to
  // pick from, and Location is only required when the project has a
  // Location Breakdown configured at all — a project with neither cannot
  // honestly be made to answer a question it has no data to answer. View
  // name is ALWAYS required regardless of either. These fields live in a
  // plain <div>, not a <form>, so the native `required` attribute is a
  // visual/semantic cue only -- this is the actual gate, called before
  // either the Add or Edit save handler proceeds.
  function requiredFieldsMissing(idPrefix) {
    var date = $(idPrefix + '-date');
    if (!date || !date.value) return 'Capture date is required.';
    if (scheduleHasActivities() && !readWorksMulti(idPrefix).length) return 'At least one Works value is required.';
    if (LOC_LEVELS.length && !Object.keys(currentLocValues(idPrefix)).length) return 'A location is required.';
    var vn = $(idPrefix + '-viewname');
    if (!vn || !vn.value.trim()) return 'A view name is required.';
    return null;
  }

  // ------------------------------------------------- Location Breakdown picker
  // 2026-08-30 feedback item 7: REPLACES the free-text cascading Tower/
  // Level/Zone inputs with a single "Add field" button that opens the
  // project's real Location Breakdown as a TREE (built from the schedule's
  // own distinct values per level, cascaded the same way the old datalists
  // were) and lets the planner pick exactly ONE node, at ANY depth — "it
  // should be fine to select tower only". A required, always-asked "view
  // name" free-text field is added alongside it (progress_photos.view_name)
  // — the specific name for THIS shot at that location (e.g. "Facing east
  // stairwell"), required regardless of whether a schedule exists at all.
  var _locSel = {};   // idPrefix -> {levelId: value} — the ONE picked node's path from the root
  function locSelOf(idPrefix) { return Object.assign({}, _locSel[idPrefix] || {}); }
  // Recursive node tree: level 0's distinct values, each carrying the next
  // level's distinct values SCOPED to it, and so on — the same soft-cascade
  // distinctLocValues() already computes, just built out as a real tree
  // instead of flattening straight into <select> options and only when
  // requested (item 7 asks for a node PICKER, not an always-open cascade).
  function locTreeLevel(levelIdx, priorVals) {
    if (levelIdx >= LOC_LEVELS.length) return [];
    var level = LOC_LEVELS[levelIdx];
    return distinctLocValues(level.id, priorVals).map(function (v) {
      var childVals = Object.assign({}, priorVals); childVals[level.id] = v;
      return { levelId: level.id, levelName: level.name, value: v, values: childVals, children: locTreeLevel(levelIdx + 1, childVals) };
    });
  }
  function locTree() { return locTreeLevel(0, {}); }
  function locChosenHTML(idPrefix) {
    var values = locSelOf(idPrefix);
    var hasAny = Object.keys(values).length > 0;
    if (!LOC_LEVELS.length) {
      return '<p class="pp-hint">No Location Breakdown set up for this project yet — build it in Project ' +
        'Schedule (Group menu &rarr; Location Breakdown&hellip;). Location can be left blank until then.</p>';
    }
    return (hasAny
      ? '<div class="pp-locchosen"><span data-ico="mapPin" data-ico-size="15"></span><strong>' +
          Fmt.esc(locBreadcrumb(values)) + '</strong></div>'
      : '<p class="pp-hint">No location selected yet.</p>') +
      '<button type="button" class="pd-btn" id="' + idPrefix + '-locadd">' + (hasAny ? 'Change location…' : '+ Add field') + '</button>';
  }
  function locationFieldHTML(idPrefix, existingValues, existingViewName) {
    _locSel[idPrefix] = Object.assign({}, existingValues || {});
    return '<div class="pp-span2 pp-wbssection"><label>Location' + (LOC_LEVELS.length ? reqMark() : '') + '</label>' +
        '<div id="' + idPrefix + '-locfield">' + locChosenHTML(idPrefix) + '</div>' +
      '</div>' +
      '<div class="pp-actctx pp-span2" id="' + idPrefix + '-actctx"></div>' +
      codeOverlayHTML(idPrefix, []) +
      '<div class="pd-field pp-span2"><label>View name' + reqMark() +
        ' <span class="pp-optnote">(what this specific photo/view shows)</span></label>' +
        '<input class="pd-input" id="' + idPrefix + '-viewname" value="' + Fmt.esc(existingViewName || '') + '" required /></div>';
  }
  function locNodeButtonHTML(node) {
    return '<button type="button" class="pp-locnode" data-locpick="' + Fmt.esc(node.values ? JSON.stringify(node.values) : '{}') + '">' +
      '<span class="pp-locnode-lvl">' + Fmt.esc(node.levelName) + '</span>' + Fmt.esc(node.value) + '</button>' +
      (node.children.length ? '<div style="padding-left:16px;">' + node.children.map(locNodeButtonHTML).join('') + '</div>' : '');
  }
  function openLocationPicker(idPrefix) {
    var tree = locTree();
    var html =
      '<div class="pd-modal-header"><h3>Pick a location</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        (tree.length
          ? '<p class="pp-hint">Pick any node — a single Tower is a valid location on its own; drill in for more detail.</p>' +
            '<div class="pp-loctree">' + tree.map(locNodeButtonHTML).join('') + '</div>'
          : '<p class="pp-hint">No Location Breakdown set up for this project yet.</p>') +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>' + (tree.length ? 'Cancel' : 'Close') + '</button>' +
        (Object.keys(locSelOf(idPrefix)).length
          ? '<button type="button" class="pd-btn pd-btn-danger" id="pp-loc-clear">Clear location</button>' : '') +
      '</div>';
    var m = openModal(html, 460);
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-locpick]'), function (b) {
      b.onclick = function () {
        _locSel[idPrefix] = JSON.parse(this.dataset.locpick);
        m.close();
        repaintLocField(idPrefix);
      };
    });
    if ($('pp-loc-clear')) $('pp-loc-clear').onclick = function () {
      _locSel[idPrefix] = {};
      m.close();
      repaintLocField(idPrefix);
    };
  }
  // Stateless variant of openLocationPicker, for callers OUTSIDE the Add/Edit
  // Photo form's own idPrefix-scoped state — item 12's floor-plan-upload
  // form (bim.js) is the first of these: it needs "pick one node from the
  // schedule's location breakdown" without touching `_locSel` at all, since a
  // floor plan isn't a photo field and shouldn't share that state. Exported
  // as `ProgressPhotos.openLocationPicker`.
  function openGenericLocationPicker(onPick) {
    var tree = locTree();
    var html =
      '<div class="pd-modal-header"><h3>Pick a location</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        (tree.length
          ? '<p class="pp-hint">Pick any node — a single Tower is a valid location on its own; drill in for more detail.</p>' +
            '<div class="pp-loctree">' + tree.map(locNodeButtonHTML).join('') + '</div>'
          : '<p class="pp-hint">No Location Breakdown set up for this project yet.</p>') +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>' + (tree.length ? 'Cancel' : 'Close') + '</button></div>';
    var m = openModal(html, 460);
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-locpick]'), function (b) {
      b.onclick = function () {
        var values = JSON.parse(this.dataset.locpick);
        m.close();
        onPick(values, locBreadcrumb(values));
      };
    });
  }
  function repaintLocField(idPrefix) {
    var host = $(idPrefix + '-locfield'); if (!host) return;
    host.innerHTML = locChosenHTML(idPrefix);
    wireLocationField(idPrefix);
    hydrate(host);
    paintLocCtx(idPrefix);
  }
  function currentLocValues(idPrefix) { return locSelOf(idPrefix); }
  function wireLocationField(idPrefix) {
    var addBtn = $(idPrefix + '-locadd');
    if (addBtn) addBtn.onclick = function () { openLocationPicker(idPrefix); };
    paintLocCtx(idPrefix);
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
  function paintLocCtx(idPrefix) {
    var ctx = $(idPrefix + '-actctx');
    var values = currentLocValues(idPrefix);
    var hasAny = Object.keys(values).length > 0;
    if (!ctx) return;
    if (!hasAny) { ctx.innerHTML = ''; return; }
    var act = resolveActivity(values), last = lastCaptureAt(values);
    var html = '';
    if (act) html += '<div class="pp-actline">Current activity: <strong>' + Fmt.esc(act.name || act.id) + '</strong></div>';
    else html += '<div class="pp-actline pp-muted">No active schedule activity found for this location.</div>';
    if (last) {
      // A small reference thumbnail never needed full-resolution — using
      // the (already-cheap, already-cached) thumbnail here instead of
      // urlOf() both fixes an unnecessary full-res dependency and means
      // this hint no longer needs its own on-demand sign at all.
      var u = thumbUrlOf(last);
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
  // tooltip, since Gaussian Splatting/RunPod (3D) and 360° capture (buggy,
  // discontinued 2026-09-02 per owner feedback item 1) are both on hold;
  // their capture code in pano.js/recon.js is untouched and unreachable from
  // here, never re-implemented in this form.
  // 2026-08-29 feedback item 17: four options -- Photo / Video / 360° / 3D.
  // Picking Photo/Video stays in THIS form (they share every other field).
  // ⚠️ 2026-09-02: 360° is now ALSO disabled, same shape as 3D — reverses
  // this comment's earlier "360° capture is being fixed... comes back as a
  // real choice" note. Re-enabling it is: drop `disabled` on the button
  // below, restore its click handler (still present, just unreachable while
  // disabled), which hands off to pano.js's own real capture flow -- a 360°
  // capture is a fundamentally different pipeline (record/stitch into a
  // `panoramas` row, not a plain file into `progress_photos`), so it was
  // always delegated to, never reimplemented here.
  function mediaTypeSelectorHTML(idPrefix, cur) {
    cur = cur || 'photo';
    return '<div class="pd-field pp-span2"><label>Type</label>' +
      '<div class="pp-mtypesel" role="tablist">' +
        '<button type="button" class="pp-mtype' + (cur === 'photo' ? ' active' : '') +
          '" data-mtype="photo" id="' + idPrefix + '-mtype-photo">Photo</button>' +
        '<button type="button" class="pp-mtype' + (cur === 'video' ? ' active' : '') +
          '" data-mtype="video" id="' + idPrefix + '-mtype-video">Video</button>' +
        '<button type="button" class="pp-mtype" id="' + idPrefix + '-mtype-360" disabled title="360° capture is on hold">360°</button>' +
        '<button type="button" class="pp-mtype" disabled title="3D reconstruction is on hold">3D</button>' +
      '</div></div>';
  }
  function wireMediaTypeSelector(idPrefix, initial, onChange) {
    var cur = initial || 'photo';
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

  var _uploadModalOpen = false; // guards against stacking a 2nd "+ Add media" overlay on a fast
                                 // double-click — the previous one still full-viewport underneath
                                 // reads exactly as "the dropdown gets stuck open (doesn't close)".
  function openUpload(preset) {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    if (_uploadModalOpen) return;   // already open — don't stack a second copy on top of it
    _uploadModalOpen = true;
    preset = preset || {};
    var today = new Date().toISOString().slice(0, 10);
    // Item 5: markup is now available AT UPLOAD TIME, before the file is even
    // saved — one local, in-memory annotation per staged file, keyed by
    // index, applied to a throwaway object URL (never uploaded anywhere) and
    // merged into that file's own `markup` column on save. Rebuilt every
    // time the file input changes (a fresh batch starts with no markup).
    var pendingMarkup = {};   // file-array index -> markup objects[]
    // Item 5 (fourth round, 2026-08-30): exposure/brightness/contrast/
    // sharpness, available at upload time for the same reason markup is —
    // one in-memory {exposure,brightness,contrast,sharpness} per staged file.
    var pendingAdjust = {};   // file-array index -> adjustments object
    var stagedUrls = [];      // parallel array of object URLs, revoked on close/replace
    function revokeStaged() {
      stagedUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); stagedUrls = [];
      // openModal() calls this onClose on EVERY close path (×, Cancel, backdrop
      // click, and a programmatic m.close() after a successful upload), so this
      // is the one place that reliably clears the guard whichever way it closed.
      _uploadModalOpen = false;
    }
    var html =
      '<div class="pd-modal-header"><h3>Add media</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<p class="pp-hint">Fields below apply to every file in this batch — edit any ' +
          'individual item afterwards.</p>' +
        mediaTypeSelectorHTML('pp', preset.mtype) +
        '<div class="pd-field" id="pp-filesfield"><label>Photos</label>' +
          '<input class="pd-input" type="file" id="pp-files" accept="image/*" capture="environment" multiple /></div>' +
        '<div class="pp-gallery" id="pp-stagedgrid" style="margin:8px 0;"></div>' +
        '<div class="pp-form2">' +
          '<div class="pd-field"><label>Description</label>' +
            '<input class="pd-input" id="pp-desc" placeholder="e.g. Model Unit" /></div>' +
          '<div class="pd-field"><label>Capture date' + reqMark() + '</label>' +
            '<input class="pd-input" type="date" id="pp-date" value="' + today + '" required /></div>' +
          '<div class="pd-field pp-span2"><label>Works' + reqMark() + '</label>' +
            worksMultiFieldHTML('pp', []) + '</div>' +
          locationFieldHTML('pp', preset.locationValues || {}) +
          (window.BIM ? BIM.pinFieldHTML('pp', null) : '') +
        '</div>' +
        '<div class="pp-progress" id="pp-prog" hidden></div>' +
      '</div>' +
      '<div class="pd-modal-footer">' +
        '<button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="pp-save">Upload</button></div>';

    var m = openModal(html, 640, revokeStaged);
    wireLocationField('pp');
    wireWorksMultiField('pp');
    if (window.BIM) BIM.wirePinField('pp');
    // ⚠️ ROOT-CAUSE FIX (fifth round item 1): switching Photo<->Video after a
    // file was already staged left the WRONG kind of file sitting there — a
    // file input's own FileList can't be reassigned by script, so changing
    // `accept`/`capture` did nothing to whatever was already chosen; only
    // re-picking files through the input ever rebuilt the staged grid. Every
    // type change now clears the whole staged batch (revoking object URLs,
    // dropping pending markup/adjustments, resetting the input itself), so a
    // photo staged for "Photo" can never survive into a "Video" upload.
    var mtype = wireMediaTypeSelector('pp', preset.mtype, function (t) {
      var fld = $('pp-filesfield'); if (fld) fld.querySelector('label').textContent = t === 'video' ? 'Videos' : 'Photos';
      var filesInput = $('pp-files');
      if (filesInput && filesInput.value) filesInput.value = '';
      revokeStaged();
      pendingMarkup = {}; pendingAdjust = {};
      var grid = $('pp-stagedgrid'); if (grid) grid.innerHTML = '';
    });
    // 360° hands off to pano.js's own real capture flow (item 17) — this
    // modal closes rather than trying to represent a recording/stitching
    // pipeline inside the same form as a plain file upload.
    // ⚠️ Item 9 fix: wrapped in try/catch and reports the error visibly. The
    // REAL cause of "clicking 360 does nothing" was a bug in openModal()
    // itself (fixed above, 2026-08-30) — m.close() used to throw, so
    // execution never reached PANO.openCapture() at all. This try/catch is
    // belt-and-braces so a FUTURE failure here (e.g. pano.js not yet loaded)
    // is visible instead of silent, not a fix for the same bug twice.
    // ⚠️ 2026-09-02: the button is `disabled` now (360° discontinued, item 1
    // of this round), so this handler is currently unreachable — left wired
    // rather than removed, so re-enabling the button alone restores it.
    if ($('pp-mtype-360')) $('pp-mtype-360').onclick = function () {
      try {
        m.close();
        if (window.PANO && PANO.openCapture) PANO.openCapture();
        else UI.toast('360° capture is not available', 'error');
      } catch (e) {
        UI.toast('Could not open 360° capture: ' + ((e && e.message) || e), 'error');
      }
    };
    // Item 5 — a thumbnail + "Markup" button per staged file, appearing the
    // moment files are chosen (before Upload is ever pressed).
    if ($('pp-files')) $('pp-files').onchange = function () {
      revokeStaged();
      pendingMarkup = {}; pendingAdjust = {};
      var files = this.files || [];
      var grid = $('pp-stagedgrid');
      if (!grid) return;
      grid.innerHTML = Array.prototype.map.call(files, function (f, i) {
        var isImg = /^image\//.test(f.type);
        var url = isImg ? URL.createObjectURL(f) : '';
        if (url) stagedUrls[i] = url;
        return '<figure class="pp-card" data-staged="' + i + '">' +
          (url ? '<div class="pp-cardimg"><img class="pp-cardphoto" src="' + Fmt.esc(url) + '" alt="" /></div>'
               : '<div class="pp-cardimg pp-noimg" style="height:210px;">' + Fmt.esc(f.name) + '</div>') +
          (isImg ? '<div class="pp-cardactions">' +
              '<button type="button" class="pd-btn" style="margin:6px;" data-markupstage="' + i + '">Markup</button>' +
              '<button type="button" class="pd-btn" style="margin:6px;" data-adjuststage="' + i + '">Adjust</button>' +
            '</div>' : '') +
        '</figure>';
      }).join('');
      Array.prototype.forEach.call(grid.querySelectorAll('[data-markupstage]'), function (b) {
        b.onclick = function () {
          var i = +this.dataset.markupstage;
          openMarkupEditor(stagedUrls[i], pendingMarkup[i] || [], function (objs) { pendingMarkup[i] = objs; });
        };
      });
      Array.prototype.forEach.call(grid.querySelectorAll('[data-adjuststage]'), function (b) {
        b.onclick = function () {
          var i = +this.dataset.adjuststage;
          openAdjustEditor(stagedUrls[i], pendingAdjust[i] || {}, function (adj) { pendingAdjust[i] = adj; });
        };
      });
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
      // Item 6: Works is a multi-select again; Trade is the UNION of every
      // chosen Works value's own derived trade. `trades`/`works_multi` are
      // the real array columns; `trade`/`works` stay populated too as the
      // singular display-cache fallback (first of each array), same
      // "deprecated but kept in step" convention this file already uses for
      // `location`.
      var worksList = readWorksMulti('pp');
      var tradeList = deriveTradesForWorksList(worksList);
      var pinData = window.BIM ? BIM.readPinField('pp') : null;
      var viewNameEl = $('pp-viewname');
      var shared = {
        description: $('pp-desc').value.trim(),
        taken_at: $('pp-date').value || null,
        trades: tradeList,
        works_multi: worksList,
        trade: tradeList[0] || null,
        works: worksList[0] || null,
        location: locBreadcrumb(locVals) || null,
        location_values: locVals,
        view_name: viewNameEl ? viewNameEl.value.trim() : null,
        activity_id: act ? act.id : null,
        activity_name: act ? act.name : null,
        tags: readCodeTags('pp'),
        media_type: kind
      };
      this.disabled = true;
      var prog = $('pp-prog'); prog.hidden = false;
      var done = 0, queued = 0, failed = [], newIds = [];

      // Item 29: uploads used to run ONE FILE AT A TIME — for a batch of
      // photos (the normal case here) that's the sum of every file's own
      // network round-trip. Each file's save is independent (its own
      // Storage upload + its own row insert), so a small pool of CONCURRENT
      // uploads (capped, not unbounded — a burst of 30+ simultaneous
      // requests would just as likely throttle the connection) finishes a
      // batch in roughly (files ÷ pool size) round-trips instead of one per
      // file.
      var POOL = 4;
      var nextIdx = 0, finishedCount = 0;
      function updateProg() { prog.textContent = 'Saving ' + finishedCount + ' of ' + files.length + '…'; }
      updateProg();
      async function worker() {
        while (nextIdx < files.length) {
          var i = nextIdx++;
          try {
            // Item 5: whatever markup was drawn on this staged file travels
            // with it into the very first insert — never a second write.
            var perFile = Object.assign({ sort_order: i }, shared);
            if (pendingMarkup[i] && pendingMarkup[i].length) perFile.markup = pendingMarkup[i];
            // Item 5: same "travels with it into the very first insert" rule
            // as markup — only when the planner actually touched a slider,
            // never a default-valued object nobody asked for.
            if (pendingAdjust[i] && !adjustmentsAreDefault(pendingAdjust[i])) perFile.adjustments = pendingAdjust[i];
            var r = await saveCapture(files[i], perFile);
            if (r.queued) queued++; else if (r.ok) { done++; if (r.id) newIds.push(r.id); } else failed.push(files[i].name);
          } catch (err) {
            failed.push(files[i].name + ': ' + (err.message || err));
          }
          finishedCount++; updateProg();
        }
      }
      await Promise.all(Array.from({ length: Math.min(POOL, files.length) }, worker));

      m.close();
      if (done) UI.toast(done + ' ' + (kind === 'video' ? 'video' : 'photo') + (done === 1 ? '' : 's') + ' uploaded', 'ok');
      // ⚠️ Audit fix: hardcoded "photo" regardless of kind, unlike the
      // "uploaded" toast right above it — a batch of videos queued offline
      // reported itself as photos.
      if (queued) UI.toast(queued + ' ' + (kind === 'video' ? 'video' : 'photo') + (queued === 1 ? '' : 's') + ' queued — offline, will sync automatically', 'warn');
      if (failed.length) UI.toast(failed.length + ' failed — ' + failed[0], 'error');
      await load();
      // Item 27/28: pin + cone is captured INLINE, in the same form as the
      // upload itself -- so it's saved for every uploaded item that shares
      // this one Key Plan position, not just a single representative photo.
      // A no-op when the planner left the field blank (readPinField
      // returned null). Fired in parallel, not one at a time -- these are
      // independent inserts and awaiting them sequentially only adds
      // latency with no ordering to protect (item 29: faster saving).
      if (pinData && window.BIM && BIM.savePinForItem) {
        await Promise.all(newIds.map(function (id) { return BIM.savePinForItem('photo', id, pinData); }));
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

  // Item 1 (2026-08-30, fourth feedback round): "photo loading is still quite
  // slow in tile modes... show only limited file size" — repeated feedback on
  // the SAME complaint the 2026-08-29 pass tried to fix via Supabase
  // Storage's image-transform add-on (THUMB_OPTS below). That fix degrades
  // silently to full-res the moment the add-on isn't enabled on the project's
  // plan tier (see signAll()'s own comment) — which is indistinguishable from
  // "still slow" to a planner, and is the likely reason this kept recurring.
  // This makes the speed-up NOT depend on any Supabase feature at all: a real,
  // separate, small JPEG is generated client-side at upload time and stored
  // as its own object — the same downscale-to-canvas technique ppr.js's
  // offline export already uses (MAXW/JPEG_Q below intentionally mirror
  // THUMB_OPTS' width so the two paths look the same regardless of which one
  // actually rendered a given row).
  // Fifth round item 9: 480->320 / 0.6->0.5 quality — "still takes time to
  // load... minimize photo resolution" even after real thumbnails already
  // shipped. Sized for the new 3-column phone Gallery grid (~125px/tile),
  // not the old single-column layout this was originally tuned for.
  var THUMB_MAXW = 320, THUMB_JPEG_Q = 0.5;
  function fileToImage(file) {
    return new Promise(function (resolve, reject) {
      var u = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(u); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(u); reject(new Error('Could not decode image')); };
      img.src = u;
    });
  }
  function canvasToBlob(c, type, q) {
    return new Promise(function (resolve, reject) {
      c.toBlob(function (b) { if (b) resolve(b); else reject(new Error('toBlob failed')); }, type, q);
    });
  }
  async function makeThumbnailBlob(file) {
    var img = await fileToImage(file);
    var w = img.naturalWidth || THUMB_MAXW, h = img.naturalHeight || THUMB_MAXW;
    var scale = Math.min(1, THUMB_MAXW / w);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return canvasToBlob(c, 'image/jpeg', THUMB_JPEG_Q);
  }
  // ⚠️ Never throws, and never blocks the real upload — a photo without a
  // thumbnail is a slower tile, not a lost capture. Any failure (a corrupt
  // file, an unsupported format, toBlob unsupported in some embedded
  // webview) degrades to null, which the caller simply doesn't attach to the
  // row; thumbUrlOf() then falls back the same way it already did before
  // this feature existed. Skipped entirely for anything that isn't a real
  // image file (videos already get a free, negligible-cost preview via
  // `<video preload="metadata">` — generating a frame-grab thumbnail for
  // them is a materially bigger, browser-inconsistent lift this pass did
  // not attempt).
  async function uploadThumbnailFor(file, mainPath) {
    if (!/^image\//.test(file.type || '')) return null;
    try {
      var blob = await makeThumbnailBlob(file);
      var thumbPath = mainPath + '.thumb.jpg';
      var res = await sb().storage.from(BUCKET).upload(thumbPath, blob, { contentType: 'image/jpeg', upsert: false });
      if (res.error) return null;
      return thumbPath;
    } catch (e) { return null; }
  }

  // ---------------------------------------------- backfill older thumbnails ---
  // Item: "fix the slow loading for old photos… manually add the thumbnail
  // data to the database". Every photo captured SINCE 2026-08-30 already gets
  // a real, small thumbnail file generated at upload time (thumb_url, see
  // uploadThumbnailFor above); anything captured BEFORE that shipped has none
  // and still loads full-resolution on every request — exactly what makes an
  // older project feel slow. This is a one-time, one-click catch-up: fetch
  // each such photo's already-uploaded full-resolution file, downscale it the
  // SAME way a brand-new upload does, upload the small copy, and record its
  // path — a real, stored preview the app can just fetch from then on,
  // instead of recomputing/re-downloading the original every time.
  function photosNeedingThumb() {
    // Videos already get a free, negligible-cost preview via
    // <video preload="metadata"> — see thumb()'s own comment — so this is
    // scoped to real images, matching uploadThumbnailFor's own guard.
    return rows.filter(function (r) {
      return r.photo_url && !r.thumb_url && r.media_type !== 'video';
    });
  }
  function syncGenThumbsBtn() {
    var b = $('pp-genthumbs');
    if (!b) return;
    var need = canWrite ? photosNeedingThumb() : [];
    b.style.display = need.length ? '' : 'none';
    b.title = need.length
      ? 'Generate a small, stored preview file for ' + need.length + ' older photo' +
        (need.length === 1 ? '' : 's') + ' so the gallery loads them faster'
      : '';
  }
  // Uses upsert:true (unlike the fresh-upload path above) — a retry after a
  // partial prior attempt (thumbnail uploaded, row update failed) must be
  // able to overwrite the same object path rather than fail on it.
  async function backfillThumbnailBlob(blob, mainPath) {
    if (!/^image\//.test(blob.type || '')) return null;
    try {
      var thumbBlob = await makeThumbnailBlob(blob);
      var thumbPath = mainPath + '.thumb.jpg';
      var res = await sb().storage.from(BUCKET).upload(thumbPath, thumbBlob, { contentType: 'image/jpeg', upsert: true });
      if (res.error) return null;
      return thumbPath;
    } catch (e) { return null; }
  }
  async function backfillOneThumbnail(r) {
    var url = urlOf(r);
    if (!url) {
      try {
        var signed = await sb().storage.from(BUCKET).createSignedUrl(r.photo_url, SIGN_TTL);
        if (signed.error || !signed.data) return false;
        url = signed.data.signedUrl;
      } catch (e) { return false; }
    }
    var blob;
    try {
      var resp = await fetch(url);
      if (!resp.ok) return false;
      blob = await resp.blob();
    } catch (e) { return false; }
    var thumbPath = await backfillThumbnailBlob(blob, r.photo_url);
    if (!thumbPath) return false;
    var w = await tolerantWrite({ table: TABLE, op: 'update', id: r.id, patch: { thumb_url: thumbPath } });
    if (!w.ok) return false;
    r.thumb_url = thumbPath; // update in place so a re-render sees it immediately
    return true;
  }
  async function backfillThumbnails() {
    var need = photosNeedingThumb();
    if (!need.length) { UI.toast('Nothing to generate — every photo already has a thumbnail', 'ok'); return; }
    var btn = $('pp-genthumbs'), prog = $('pp-genthumbs-prog');
    if (btn) btn.disabled = true;
    if (prog) prog.style.display = '';
    var ok = 0, fail = 0;
    // Same small capped-concurrency-pool shape as the batch upload save loop
    // (item 29, 2026-08-29) — a handful of photos at a time, not one at a
    // time and not all at once.
    var POOL = 3, nextIdx = 0, doneCount = 0;
    function updateProg() { if (prog) prog.textContent = 'Generating ' + doneCount + ' of ' + need.length + '…'; }
    updateProg();
    async function worker() {
      while (nextIdx < need.length) {
        var r = need[nextIdx++];
        try { if (await backfillOneThumbnail(r)) ok++; else fail++; }
        catch (e) { fail++; }
        doneCount++; updateProg();
      }
    }
    await Promise.all(Array.from({ length: Math.min(POOL, need.length) }, worker));
    if (btn) btn.disabled = false;
    if (prog) prog.style.display = 'none';
    await signAll();
    syncGenThumbsBtn();
    render();
    UI.toast(ok + ' thumbnail' + (ok === 1 ? '' : 's') + ' generated' + (fail ? (', ' + fail + ' failed') : ''), fail ? 'warn' : 'ok');
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
    // Same tolerance for view_name (2026-08-30 item 7) — a pre-migration
    // save still lands with the rest of the record intact; the required-ness
    // check is client-side only, so the row is still saved rather than
    // blocked on a column the database doesn't have yet.
    if (!w.ok && /column .* does not exist|schema cache/i.test((w.error && w.error.message) || '') &&
        job.patch && ('view_name' in job.patch)) {
      var stripped5 = Object.assign({}, job.patch);
      delete stripped5.view_name;
      if (!migrationWarnedViewName) {
        migrationWarnedViewName = true;
        UI.toast('Saved without the view name — run migrations/2026-08-30-photos-round2.sql', 'warn');
      }
      return await doWrite(Object.assign({}, job, { patch: stripped5 }));
    }
    // Same tolerance for thumb_url (2026-08-30, item 1 round 2) — the
    // thumbnail file itself is already sitting in Storage by the time this
    // runs (uploadThumbnailFor uploads before the row insert), so a
    // pre-migration DB simply doesn't get told about it; the photo still
    // saves, it just renders full-res in the grid until the migration runs.
    if (!w.ok && /column .* does not exist|schema cache/i.test((w.error && w.error.message) || '') &&
        job.patch && ('thumb_url' in job.patch)) {
      var stripped6 = Object.assign({}, job.patch);
      delete stripped6.thumb_url;
      if (!migrationWarnedThumb) {
        migrationWarnedThumb = true;
        UI.toast('Saved without the fast-loading thumbnail — run migrations/2026-08-30-photos-round3.sql', 'warn');
      }
      return await doWrite(Object.assign({}, job, { patch: stripped6 }));
    }
    // Same tolerance for adjustments (2026-08-30 item 5, round 2) — a
    // pre-migration save still lands the photo itself; the exposure/
    // brightness/contrast/sharpness the planner just set are the only thing
    // dropped, and they can be re-applied once the migration runs.
    if (!w.ok && /column .* does not exist|schema cache/i.test((w.error && w.error.message) || '') &&
        job.patch && ('adjustments' in job.patch)) {
      var stripped7 = Object.assign({}, job.patch);
      delete stripped7.adjustments;
      if (!migrationWarnedAdjust) {
        migrationWarnedAdjust = true;
        UI.toast('Saved without the exposure/brightness/contrast adjustment — run migrations/2026-08-30-photos-round3.sql', 'warn');
      }
      return await doWrite(Object.assign({}, job, { patch: stripped7 }));
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
    // Item 1: a real, small preview file, uploaded ALONGSIDE the original —
    // never blocking the save if it can't be produced (see
    // uploadThumbnailFor's own comment for why this never throws).
    var thumbPath = await uploadThumbnailFor(file, path);
    var row = Object.assign({}, meta, { project_id: pid, created_by: uid, photo_url: path, title: file.name });
    if (thumbPath) row.thumb_url = thumbPath;
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
        var thumbPath = await uploadThumbnailFor(item.blob, path);
        var row = Object.assign({}, item.meta, { project_id: item.project_id, created_by: item.created_by, photo_url: path, title: item.fileName });
        if (thumbPath) row.thumb_url = thumbPath;
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
    // "Full load only when opening the photo" — opening the EDIT form is
    // exactly that: the (already cheap, already cached) thumbnail shows
    // immediately, and ensureFullUrl() below swaps in the real full-
    // resolution preview once it's signed, rather than the form needing to
    // await a network round-trip before it can even open.
    var previewSrc = thumbUrlOf(r);
    var html =
      '<div class="pd-modal-header"><h3>Edit photo</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        (previewSrc ? '<img class="pp-formpreview" id="pp-e-preview" src="' + Fmt.esc(previewSrc) + '" alt="" />' : '') +
        '<div class="pp-form2">' +
          '<div class="pd-field"><label>Description</label>' +
            '<input class="pd-input" id="pp-e-desc" value="' + Fmt.esc(r.description || '') + '" /></div>' +
          '<div class="pd-field"><label>Capture date' + reqMark() + '</label>' +
            '<input class="pd-input" type="date" id="pp-e-date" value="' + Fmt.esc(r.taken_at || '') + '" required /></div>' +
          '<div class="pd-field pp-span2"><label>Works' + reqMark() + '</label>' +
            worksMultiFieldHTML('pp-e', worksOf(r)) + '</div>' +
          locationFieldHTML('pp-e', r.location_values || {}, r.view_name) +
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
    if (previewSrc) ensureFullUrl(r).then(function (full) {
      var img = $('pp-e-preview');   // gone once the modal has closed — the query itself is the "still open" check
      if (full && img) img.src = full;
    });
    var codeWrap = $('pp-e-codes');
    if (codeWrap) Array.prototype.forEach.call(codeWrap.querySelectorAll('input[type=checkbox]'), function (c) {
      c.checked = (r.tags || []).indexOf(c.value) >= 0;
    });
    wireLocationField('pp-e');
    wireWorksMultiField('pp-e');
    if (window.BIM) BIM.wirePinField('pp-e');
    hydrate(m.el);
    $('pp-e-save').onclick = async function () {
      var reqErr = requiredFieldsMissing('pp-e');
      if (reqErr) { UI.toast(reqErr, 'warn'); return; }
      this.disabled = true;
      var locVals = currentLocValues('pp-e');
      var act = resolveActivity(locVals);
      var worksList = readWorksMulti('pp-e');
      var tradeList = deriveTradesForWorksList(worksList);
      var pinData = window.BIM ? BIM.readPinField('pp-e') : null;   // read before the modal closes
      var viewNameEl = $('pp-e-viewname');
      var patch = {
        description: $('pp-e-desc').value.trim(),
        taken_at: $('pp-e-date').value || null,
        trades: tradeList,
        works_multi: worksList,
        trade: tradeList[0] || null,
        works: worksList[0] || null,
        location: locBreadcrumb(locVals) || null,
        location_values: locVals,
        view_name: viewNameEl ? viewNameEl.value.trim() : null,
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

  // Single-photo delete (the lightbox's Delete button, and every [data-act=
  // "del"] row action) — a thin wrapper over the shared openDeleteConfirm
  // (item 1, owner feedback), which also handles the batch-selection case
  // and the presentation-usage warning. One path, so a single delete and a
  // batch delete can never disagree about what gets checked or cleaned up.
  function remove(r) { return openDeleteConfirm([r.id]); }

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
    // state and hides the five selection-only controls, nothing else.
    _leavePhotosScreen: function () {
      selected = {};
      var count = $('pp-selcount'); if (count) count.style.display = 'none';
      ['pp-sel-download', 'pp-sel-addppr', 'pp-sel-archive', 'pp-sel-delete'].forEach(function (id) {
        var el = $(id); if (el) el.style.display = 'none';
      });
      // ⚠️ Real bug fixed: the "+ Add media" DROPDOWN (#pp-addmenu, a
      // position:absolute sibling of the #pp-add button, not a child) has
      // no relationship to index.html's own PHOTO_TOOLS-driven show/hide —
      // that array only ever toggled the #pp-add BUTTON's display, so a
      // dropdown left open (hidden=false) when switching away from Gallery
      // stayed visually open, floating on top of Presentations/Plans with
      // no trigger button in sight ("dropdown choices for add media is also
      // showing throughout all progress photos pages"). Force-closed here,
      // on every screen switch away from Gallery, regardless of whether it
      // was ever opened.
      var addMenu = $('pp-addmenu'); if (addMenu) addMenu.hidden = true;
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
    // Item 12 — a generic "pick one node from the schedule's Location
    // Breakdown" picker, for use OUTSIDE the Add/Edit Photo form (bim.js's
    // floor-plan upload form is the first caller). onPick(values, label).
    openLocationPicker: function (onPick) { openGenericLocationPicker(onPick); },
    hasLocationLevels: function () { return LOC_LEVELS.length > 0; },
    // 2026-09-03 — Floor Plan's Tower/Floor dropdowns (bim.js) read the
    // project's first two Location Breakdown levels via locLevels() below,
    // then need the SOFT-CASCADE value list distinctLocValues() already
    // computes (Floor's options narrowed to the picked Tower) without
    // pulling in the whole node-tree picker UI — that's for a single-node
    // "any depth" pick; Tower/Floor is always exactly two fixed levels.
    distinctLocValuesFor: function (levelId, priorVals) { return distinctLocValues(levelId, priorVals); },
    // Item 25 — the raw node tree (not a modal), for bim.js's Plans-page
    // side panel to render as a persistent tree rather than a one-shot picker.
    locationTree: function () { return locTree(); },
    locBreadcrumbOf: function (values) { return locBreadcrumb(values || {}); },
    // Read by bim.js's Vertical Stacking view (Batch G, item 16) — the same
    // ordered level DEFINITIONS (id/name/sort_order) the Location Breakdown
    // picker itself cascades through, so a stacking band means the same
    // thing there as it does on the Add-photo form.
    locLevels: function () { return LOC_LEVELS.slice(); },
    // Read by the Floor Plan pin picker (bim.js / Phase 5) to offer a photo
    // to pin without a second fetch of the same project's library.
    allPhotos: function () { return rows.slice(); },
    // Signed URL for an arbitrary photo id — used by bim.js's Batch H image
    // registration (it needs the actual pixels of a top-view photo, not
    // just the row) and available generally for the same reason
    // allPhotos() is. ⚠️ Returns a PROMISE, not a string — full-resolution
    // is signed on demand now (signAll()'s own comment), so this is
    // ensureFullUrl() exported across the module boundary, not a
    // synchronous cache read. Both bim.js callers await it.
    urlOfPhotoId: function (id) { var r = byId(id); return r ? ensureFullUrl(r) : Promise.resolve(''); },
    // Shared markup engine (18-item list item 13/14) — ppr.js's own
    // presentation-only overlay reuses this instead of a second canvas
    // implementation. See openMarkupEditor's own comment for the format.
    openMarkupEditor: function (imageUrl, initialMarkup, onSave) { openMarkupEditor(imageUrl, initialMarkup, onSave); },
    // Public (non-underscore) accessors for the ONE shared, per-project
    // "show markup" preference (item 7, presentation-view rework) — reused
    // by ppr.js's own pane markup toggle so hiding markup in the
    // presentation view also hides it on Gallery tiles/the lightbox and vice
    // versa, rather than a second, independently-toggled preference.
    markupGlobalVisible: function () { return markupGlobalVisible(); },
    setMarkupGlobalVisible: function (v) { setMarkupGlobalVisible(v); },
    // Test-only hook (2026-08-30 audit fix) — lets the test harness drive
    // openModal directly against a UI.modal stub shaped like the REAL one
    // (where m.close is the actual DOM-removal function), to genuinely
    // execute the close()-recursion fix rather than only regex-checking it.
    _openModal: function (html, width, onClose) { return openModal(html, width, onClose); },
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
    // ⚠️ RETIRED (items 6+8, current round) — the old Batch C media-strip
    // hooks (_mediaStripMatches/_mediaStripItems) pointed at functions that
    // no longer exist; superseded by _matchesFilters/_mergedRows below, the
    // equivalent genuine-execution hooks for the merged-grid pipeline that
    // replaced the separate strip.
    // `testFilters` (optional) is shallow-merged over the module's real
    // `filters` state for the duration of the call, then restored — same
    // save/restore-closure-state convention `_deriveTradeForWorks` above
    // already uses, so a test can genuinely exercise a SET filter (e.g.
    // `{ trade: 'Structural Works' }`) without touching wireFilters()/init().
    _matchesFilters: function (item, testFilters) {
      if (!testFilters) return matchesFilters(item);
      var saved = filters;
      filters = Object.assign({}, filters, testFilters);
      try { return matchesFilters(item); }
      finally { filters = saved; }
    },
    _mergedRows: function () { return mergedRows(); },
    _panoPseudoRow: function (p) { return panoPseudoRow(p); },
    _reconPseudoRow: function (r) { return reconPseudoRow(r); },
    // Test-only hooks for the markup engine (Batch F, 2026-08-29) — the same
    // convention as every hook above: genuinely EXECUTE the per-shape canvas
    // drawing and the eraser's nearest-object hit test against real objects,
    // rather than only regex-matching the source. A fake ctx recorder (built
    // in test.js) captures which canvas 2D calls actually fired per shape
    // type — the one way to tell "drew a rect" from "silently did nothing".
    _drawMarkupObjects: function (ctx, objs, w, h, selectedIdx) { drawMarkupObjects(ctx, objs, w, h, selectedIdx); },
    _markupHitTest: function (objs, nx, ny, w, h, ctx) { return markupHitTest(objs, nx, ny, w, h, ctx); },
    // 2026-09-02 owner feedback item 2 — the text selection-box alignment
    // fix: exposed directly (not just via _markupCenterPx/_markupHandleHit)
    // so a test can assert the box itself, with and without a real ctx to
    // measure against.
    _markupBoundsPx: function (o, w, h, ctx) { return markupBoundsPx(o, w, h, ctx); },
    // Fourth round, item 3 — the drag-to-move math genuinely executed, same
    // reasoning as every hook above: a wrong coordinate field here silently
    // moves only PART of a multi-point shape while looking interactive.
    _translateMarkupObj: function (o, dx, dy) { return translateMarkupObj(o, dx, dy); },
    // Fifth round item 6 — resize/rotate, genuinely executed for the same
    // reason: a flipped sign or swapped axis here silently resizes/rotates
    // the wrong way while still LOOKING interactive.
    _resizeBoxObj: function (o, corner, newLx, newLy, w, h) { return resizeBoxObj(o, corner, newLx, newLy, w, h); },
    _resizeSizeObj: function (o, scale) { return resizeSizeObj(o, scale); },
    _rotationFromPointer: function (dx, dy) { return rotationFromPointer(dx, dy); },
    _rotatePointDeg: function (px, py, cx, cy, deg) { return rotatePointDeg(px, py, cx, cy, deg); },
    // 2026-09-02 owner feedback item 6 — line type (solid/dashed/dotted).
    _lineDashFor: function (t) { return lineDashFor(t); },
    _markupCenterPx: function (o, w, h, ctx) { return markupCenterPx(o, w, h, ctx); },
    _markupHandleHit: function (o, px, py, w, h, ctx) { return markupHandleHit(o, px, py, w, h, ctx); },
    // Fifth round item 7 — the shared show/hide-markup preference.
    _markupGlobalVisible: function () { return markupGlobalVisible(); },
    _setMarkupGlobalVisible: function (v) { setMarkupGlobalVisible(v); },
    _thumb: function (r, cls) { return thumb(r, cls); },
    // Round-2 item 3 — the lightbox magnifier's pure geometry, exported so
    // its sign/offset math can be genuinely executed rather than only read.
    _magnifierGeom: function (cx, cy, imgRect, wrapRect, size, zoom) {
      return magnifierGeom(cx, cy, imgRect, wrapRect, size, zoom);
    },
    // Round-2 item 4 — the key-plan overlay's drag-to-resize clamp, same
    // "export the pure math so a flipped sign/missing clamp is genuinely
    // caught" reasoning as _magnifierGeom above.
    _kpResizeFrac: function (startFrac, startX, curX, wrapW) {
      return kpResizeFrac(startFrac, startX, curX, wrapW);
    },
    // Test-only hooks for item 5's adjustments engine (2026-08-30, fourth
    // round) — genuinely EXECUTE the CSS-filter mapping and the sharpen
    // convolution, same convention as every hook above (a wrong coefficient
    // here is silent: the image still renders, it just doesn't look right).
    _cssFilterFor: function (adj) { return cssFilterFor(adj); },
    _adjustmentsAreDefault: function (adj) { return adjustmentsAreDefault(adj); },
    _adjustmentsOf: function (r) { return adjustmentsOf(r); },
    _applySharpen: function (ctx, w, h, amount) { applySharpen(ctx, w, h, amount); },
    openAdjustEditor: function (imageUrl, initialAdjustments, onSave) { openAdjustEditor(imageUrl, initialAdjustments, onSave); },
    // Item 16 (2026-08-29, second round) — Plan view relocated here from
    // bim.js. Genuinely EXECUTE the cluster grouping bim.js's own tests
    // already proved out, now against THIS file's version.
    // ⚠️ _mostRecentAsOf/_stackGrid/_stackRowSort (hooks over
    // mostRecentAsOf()/stackGrid()/stackRowSort() — all three Stack-view-
    // only) are deliberately NOT carried forward — Round-2 item 7
    // (2026-09-02) removed Stack view entirely, functions and all, so there
    // is nothing left for these hooks to call.
    _planClusters: function (pins, monthCutoff) { return planClusters(pins, monthCutoff); },
    _itemDateForPin: function (pin, photosArr) {
      var saved = rows; if (photosArr) rows = photosArr;
      try { return itemDateForPin(pin); } finally { rows = saved; }
    },
    // Item 2 (2026-08-30, second round) — the Plan-view cluster marker's
    // "latest photo" resolution, against an injected row set.
    _planClusterLatestThumb: function (cluster, photosArr) {
      var saved = rows; if (photosArr) rows = photosArr;
      try { return planClusterLatestThumb(cluster); } finally { rows = saved; }
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
    _dlCaptionLines: function (r) { return dlCaptionLines(r); },
    // Test-only hooks for item 1's client-side thumbnail generation
    // (2026-08-30, fourth round) — genuinely EXECUTE the canvas downscale and
    // the fail-safe upload wrapper, rather than only regex-checking the
    // source, the same convention as every hook above.
    _makeThumbnailBlob: function (file) { return makeThumbnailBlob(file); },
    _uploadThumbnailFor: function (file, mainPath) { return uploadThumbnailFor(file, mainPath); },
    // Runs the real signAll()/thumbUrlOf() pair against an injected row set,
    // so a test can prove thumb_url actually wins once signed, and that the
    // fallback chain (thumb_url -> transform thumbCache -> full-res) still
    // resolves correctly when it's absent — save/restore `rows` around the
    // call, same convention as _stackGrid's closure-state handling.
    _thumbUrlsFor: function (rowsArr) {
      var saved = rows; rows = rowsArr;
      return signAll().then(function () {
        var out = {};
        rowsArr.forEach(function (r) { out[r.id] = thumbUrlOf(r); });
        return out;
      }).finally(function () { rows = saved; });
    },
    // Test-only hooks for the old-photo thumbnail backfill — genuinely
    // executes the fetch/downscale/upload/row-update chain against an
    // injected row, rather than only regex-checking the source, the same
    // convention as every hook above. `photosNeedingThumb` reads the
    // closure's own `rows`, so it's save/restored like `_stackGrid`.
    _photosNeedingThumb: function (rowsArr) {
      var saved = rows; if (rowsArr) rows = rowsArr;
      try { return photosNeedingThumb(); } finally { rows = saved; }
    },
    _backfillOneThumbnail: function (r) { return backfillOneThumbnail(r); },
    // Issue 4 follow-up — the "add text is not working" fix: exposes the
    // shared background-colour decision so the exact fill===false-vs-
    // undefined bug (and its fix) can be asserted directly, not just
    // inferred from drawMarkupObjects' rendered calls.
    _textBoxFillColor: function (o) { return textBoxFillColor(o); }
  };
})();
