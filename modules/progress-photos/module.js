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
  var view = 'list';                 // list | gallery
  var filters = { from: '', to: '', trade: '', works: '', locValues: {}, search: '' };
  var collapsed = {};                // trade -> true
  var urlCache = {};                 // storage path -> signed URL
  var canWrite = false;              // planner+ / admin / super_admin
  var lightboxIds = [], lightboxAt = 0;
  var projectListeners = [];         // PPR screen subscribes; both share one selector

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
  var migrationWarned = false;             // warn once per session, not per save
  var roundsFilter = '';
  var roundsSelected = {};                 // location-combo key -> true (walkthrough queue)
  var walkState = null;                    // {queue:[comboKey,...], at:0} while a walkthrough modal chain is open
  var _roundsComboByKey = {};              // comboKey -> {key, values, label}, refreshed each renderRounds()

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
  function openModal(html, width) {
    var m = UI.modal(html);
    var box = m.el.querySelector('.pd-modal');
    if (box && width) box.style.maxWidth = width + 'px';
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-close]'), function (b) {
      b.onclick = m.close;
    });
    if (window.Icons && Icons.hydrate) Icons.hydrate(m.el);
    return m;
  }

  // ---- per-project UI persistence ------------------------------------------
  function uiKey(k) { return 'pp_' + k + '_' + pid; }
  function saveUI() {
    try {
      localStorage.setItem(uiKey('view'), view);
      localStorage.setItem(uiKey('collapsed'), JSON.stringify(collapsed));
    } catch (e) {}
  }
  function restoreUI() {
    try {
      var v = localStorage.getItem(uiKey('view'));
      if (v === 'list' || v === 'gallery') view = v;
      collapsed = JSON.parse(localStorage.getItem(uiKey('collapsed')) || '{}') || {};
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
    if (!pid) return;
    try {
      var lres = await sb().from('location_levels').select('id,name,sort_order')
        .eq('project_id', pid).order('sort_order', { ascending: true });
      if (!lres.error) LOC_LEVELS = lres.data || [];
    } catch (e) {}

    try {
      var ares = await fetchAllPages('project_schedule',
        'id,activity_id,activity_name,location,activity_type,status,start_date,end_date,work_type,phase',
        function (q) { return q.neq('activity_type', 'WBS Summary'); });
      if (!ares.error) SCHED_ACTS = ares.data || [];
    } catch (e) {}

    try {
      var tres = await sb().from('activity_code_types').select('id,name').eq('project_id', pid);
      if (!tres.error) CODE_TYPES = tres.data || [];
      if (CODE_TYPES.length) {
        var vres = await sb().from('activity_code_values').select('id,code_type_id,value')
          .in('code_type_id', CODE_TYPES.map(function (t) { return t.id; }));
        if (!vres.error) CODE_VALUES = vres.data || [];
      }
    } catch (e) {}
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
      refreshRoundsIfVisible();
      joinCollab();
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
    $('pp-clearfilters').onclick = function () {
      filters = { from: '', to: '', trade: '', works: '', locValues: {}, search: '' };
      ['from', 'to', 'trade', 'works', 'search'].forEach(function (k) {
        var el = $('pp-f-' + k); if (el) el.value = '';
      });
      renderLocFilterSelects();
      render();
    };
    $('pp-add').onclick = function () { openUpload(); };
    $('pp-refresh').onclick = function () { load(); };
    if ($('pp-sync')) $('pp-sync').onclick = function () { flushQueue(); };
    if ($('pp-rounds-search')) $('pp-rounds-search').oninput = function () { roundsFilter = this.value; renderRounds(); };

    document.addEventListener('keydown', function (e) {
      if (!$('pp-lightbox') || $('pp-lightbox').hidden) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') stepLightbox(1);
      if (e.key === 'ArrowLeft') stepLightbox(-1);
    });
  }

  function syncChrome() {
    Array.prototype.forEach.call(document.querySelectorAll('.pd-vt[data-view]'), function (b) {
      b.classList.toggle('active', b.dataset.view === view);
    });
    // The upload action + its divider are planner+ only.
    ['pp-add', 'pp-sep-photos'].forEach(function (id) {
      var el = $(id); if (el) el.style.display = canWrite ? '' : 'none';
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
    fillFilterOptions();
    render();
  }

  // Batch-sign every photo path in one request rather than one call per row.
  async function signAll() {
    urlCache = {};
    var paths = rows.map(function (r) { return r.photo_url; })
                    .filter(function (p) { return !!p; });
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
  // ⚠️ Scoped to Execution Phase + Close-out ('construction'/'closeout' in
  // Project Schedule's own phase vocabulary -- 'construction' IS the label
  // shown there as "Execution Phase") -- design/bidding/planning activities
  // (Initiation, Planning) and the un-phased "Milestones" WBS branch describe
  // pre-construction work or point-in-time markers, neither of which is a
  // "Works" a site photo is capturing. An activity with no phase stamped at
  // all (imported before the phase migration, or filed under Milestones with
  // nothing inherited) is excluded too -- an unphased activity is not known
  // to be construction work, so it is left out rather than guessed in.
  function distinctScheduleWorks(tradeFilter) {
    var seen = {}, out = [];
    SCHED_ACTS.forEach(function (a) {
      if (a.activity_type === 'Start Milestone' || a.activity_type === 'Finish Milestone') return;
      if (a.phase !== 'construction' && a.phase !== 'closeout') return;
      if (!workTypeMatchesTrade(a.work_type, tradeFilter)) return;
      var v = (a.activity_name || '').trim();
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out.sort();
  }
  function distinctCapturedWorks(tradeFilter) {
    var seen = {}, out = [];
    rows.forEach(function (r) {
      if (tradeFilter && r.trade !== tradeFilter) return;
      var v = (r.works || '').trim();
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
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
  function refreshWorksDatalist(tradeVal) {
    var dl = $('pp-works-list');
    if (dl) dl.innerHTML = worksOptions(tradeVal || '').map(function (v) {
      return '<option value="' + Fmt.esc(v) + '"></option>'; }).join('');
  }
  // Re-scopes the shared Works datalist to whichever Trade is picked in the
  // currently-open modal (Add or Edit -- idPrefix's own -trade select), live
  // on every change, seeded once from its current value on open.
  function wireTradeWorks(idPrefix) {
    var trade = $(idPrefix + '-trade');
    if (!trade) return;
    refreshWorksDatalist(trade.value);
    trade.onchange = function () { refreshWorksDatalist(this.value); };
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
    fill('pp-f-trade', distinct('trade'), 'Filter by Trade');
    fill('pp-f-works', distinct('works'), 'Filter by Works');
    renderLocFilterSelects();
    refreshWorksDatalist('');   // unfiltered baseline; the open modal's own Trade
                                // select re-scopes this live (see wireTradeWorks)
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
      if (filters.trade && r.trade !== filters.trade) return false;
      if (filters.works && r.works !== filters.works) return false;
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
        var hay = [r.description, r.title, r.trade, r.works, r.location]
          .join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  // --------------------------------------------------------------- render ---
  function render() {
    refreshRoundsIfVisible();   // keep Rounds live-consistent with load()/remote changes too
    var host = $('pp-view');
    var list = visible();
    lightboxIds = list.map(function (r) { return r.id; });

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

    // Clear-filters only shows when a filter is actually set (no orphan button).
    var anyFilter = ['from', 'to', 'trade', 'works', 'search'].some(function (k) { return filters[k]; }) ||
      Object.keys(filters.locValues || {}).some(function (k) { return filters.locValues[k]; });
    var clr = $('pp-clearfilters');
    if (clr) clr.hidden = !anyFilter;

    if (!rows.length) {
      host.innerHTML = '<div class="pp-empty">' +
        '<span data-ico="camera" data-ico-size="34"></span>' +
        '<p>No photos yet for this project.</p>' +
        (canWrite ? '<p class="pp-hint">Use <strong>+ Add photos</strong> to upload the first batch.</p>' : '') +
        '</div>';
      hydrate(host); return;
    }
    if (!list.length) {
      host.innerHTML = '<div class="pp-empty"><p>No photos match these filters.</p></div>';
      return;
    }

    host.innerHTML = (view === 'gallery' ? galleryHTML(list) : listHTML(list));
    hydrate(host);
    wireRows(host);
    paintRemote();
  }

  function hydrate(host) { if (window.Icons && Icons.hydrate) Icons.hydrate(host); }

  function groupByTrade(list) {
    var groups = {}, order = [];
    list.forEach(function (r) {
      var t = (r.trade || '').trim() || 'Untagged';
      if (!groups[t]) { groups[t] = []; order.push(t); }
      groups[t].push(r);
    });
    order.sort();
    return order.map(function (t) { return { trade: t, items: groups[t] }; });
  }

  function rowActions(r) {
    return '<div class="pp-rowacts">' +
      '<button class="pp-iconbtn" data-act="download" data-id="' + r.id + '" title="Download photo">' +
        '<span data-ico="download" data-ico-size="15"></span></button>' +
      '<button class="pp-iconbtn" data-act="open" data-id="' + r.id + '" title="View full size">' +
        '<span data-ico="eye" data-ico-size="15"></span></button>' +
      (canWrite ? '<button class="pp-iconbtn" data-act="edit" data-id="' + r.id + '" title="Edit details">✎</button>' +
                  '<button class="pp-iconbtn pp-del" data-act="del" data-id="' + r.id + '" title="Delete photo">' +
                  '<span data-ico="trash" data-ico-size="15"></span></button>' : '') +
      '</div>';
  }

  function thumb(r, cls) {
    var u = urlOf(r);
    if (!u) return '<div class="' + cls + ' pp-noimg" title="Preview unavailable">' +
                   '<span data-ico="camera" data-ico-size="18"></span></div>';
    return '<img class="' + cls + '" src="' + Fmt.esc(u) + '" loading="lazy" ' +
           'alt="' + Fmt.esc(r.description || 'Progress photo') + '" data-act="open" data-id="' + r.id + '" />';
  }

  function listHTML(list) {
    var head = '<div class="pp-grid-head">' +
      '<div>Photo</div><div>Description</div><div>Trade</div><div>Works</div>' +
      '<div>Location</div><div>Capture Date</div><div></div></div>';

    var body = groupByTrade(list).map(function (g) {
      var isCol = !!collapsed[g.trade];
      var header = '<div class="pp-group" data-trade="' + Fmt.esc(g.trade) + '">' +
        '<span class="pp-caret" data-ico="' + (isCol ? 'chevronRight' : 'chevronDown') + '" data-ico-size="14"></span>' +
        '<strong>' + Fmt.esc(g.trade) + '</strong>' +
        '<span class="pp-groupcount">' + g.items.length + '</span></div>';
      if (isCol) return header;
      return header + g.items.map(function (r) {
        // data-l = the column's label. Unused on desktop (the sticky .pp-grid-head
        // supplies the headings); at phone width the head is hidden and the row
        // restacks under the thumbnail, where each value needs its own label —
        // module.css renders these via .pp-cell[data-l]::before.
        return '<div class="pp-row" data-id="' + r.id + '">' +
          '<div class="pp-cell pp-thumbcell">' + thumb(r, 'pp-thumb') + '</div>' +
          '<div class="pp-cell pp-desc">' + Fmt.esc(r.description || '—') + '</div>' +
          '<div class="pp-cell" data-l="Trade">' + Fmt.esc(r.trade || '—') + '</div>' +
          '<div class="pp-cell" data-l="Works">' + Fmt.esc(r.works || '—') + '</div>' +
          '<div class="pp-cell" data-l="Location">' + Fmt.esc(r.location || '—') + '</div>' +
          '<div class="pp-cell pp-date" data-l="Captured">' + (r.taken_at ? Fmt.date(r.taken_at) : '—') + '</div>' +
          '<div class="pp-cell pp-actcell">' + rowActions(r) + '</div>' +
          '</div>';
      }).join('');
    }).join('');

    return '<div class="pp-grid">' + head + body + '</div>';
  }

  function galleryHTML(list) {
    return '<div class="pp-gallery">' + list.map(function (r) {
      return '<figure class="pp-card" data-id="' + r.id + '">' +
        '<div class="pp-cardimg">' + thumb(r, 'pp-cardphoto') +
          '<button class="pp-expand" data-act="open" data-id="' + r.id + '" title="View full size">⤢</button>' +
        '</div>' +
        '<figcaption>' +
          '<table class="pp-cardtable"><tbody>' +
            trow('Description', r.description) +
            trow('Trade', r.trade) +
            trow('Works', r.works) +
            trow('Location', r.location) +
            trow('Capture Date', r.taken_at ? Fmt.date(r.taken_at) : '') +
          '</tbody></table>' +
          rowActions(r) +
        '</figcaption></figure>';
    }).join('') + '</div>';
  }
  function trow(k, v) {
    return '<tr><th>' + Fmt.esc(k) + '</th><td>' + Fmt.esc(v || '—') + '</td></tr>';
  }

  function wireRows(host) {
    Array.prototype.forEach.call(host.querySelectorAll('.pp-group'), function (g) {
      g.onclick = function () {
        var t = g.dataset.trade;
        collapsed[t] = !collapsed[t];
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
  }
  function byId(id) { return rows.filter(function (r) { return r.id === id; })[0]; }

  // ------------------------------------------------------------- lightbox ---
  function openLightbox(id) {
    lightboxAt = lightboxIds.indexOf(id);
    if (lightboxAt < 0) lightboxAt = 0;
    paintLightbox();
    $('pp-lightbox').hidden = false;
  }
  function closeLightbox() { $('pp-lightbox').hidden = true; }
  function stepLightbox(d) {
    if (!lightboxIds.length) return;
    lightboxAt = (lightboxAt + d + lightboxIds.length) % lightboxIds.length;
    paintLightbox();
  }
  function paintLightbox() {
    var r = byId(lightboxIds[lightboxAt]); if (!r) return;
    var u = urlOf(r);
    $('pp-lb-img').src = u || '';
    $('pp-lb-cap').innerHTML =
      '<strong>' + Fmt.esc(r.description || 'Progress photo') + '</strong>' +
      '<span>' + Fmt.esc([r.trade, r.works, r.location].filter(Boolean).join(' · ')) +
      (r.taken_at ? ' · ' + Fmt.date(r.taken_at) : '') + '</span>' +
      '<span class="pp-lb-count">' + (lightboxAt + 1) + ' / ' + lightboxIds.length + '</span>';
  }

  async function download(r) {
    var u = urlOf(r);
    if (!u) { UI.toast('Photo file unavailable', 'error'); return; }
    var a = document.createElement('a');
    a.href = u;
    a.download = (r.photo_url || 'photo').split('/').pop();
    document.body.appendChild(a); a.click(); a.remove();
  }

  // --------------------------------------------------------------- upload ---
  function reqMark() { return ' <span class="pp-req">*</span>'; }
  function tradeOptions(val) {
    return '<option value="">—</option>' + TRADES.map(function (t) {
      return '<option' + (val === t ? ' selected' : '') + '>' + Fmt.esc(t) + '</option>';
    }).join('');
  }
  // Capture date / Trade / Works / Location Breakdown are required. These
  // fields live in a plain <div>, not a <form>, so the native `required`
  // attribute is a visual/semantic cue only -- this is the actual gate,
  // called before either the Add or Edit save handler proceeds.
  function requiredFieldsMissing(idPrefix) {
    var date = $(idPrefix + '-date'), trade = $(idPrefix + '-trade'), works = $(idPrefix + '-works');
    if (!date || !date.value) return 'Capture date is required.';
    if (!trade || !trade.value) return 'Trade is required.';
    if (!works || !works.value.trim()) return 'Works is required.';
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
  function locationFieldHTML(idPrefix, existingValues, locText) {
    return (
      '<div class="pp-span2 pp-wbssection"><label>Location Breakdown' +
        (locRequiredLevels().length ? reqMark() + ' <span class="pp-optnote">(' +
          Fmt.esc(locRequiredLevels().map(function (l) { return l.name; }).join(' & ')) +
          ' required)</span>' : '') + '</label>' +
        '<div class="pp-wbscascade" id="' + idPrefix + '-loclevels">' + locFieldsHTML(idPrefix, existingValues) + '</div>' +
        '<div class="pp-wbscrumb" id="' + idPrefix + '-crumb"></div>' +
      '</div>' +
      '<div class="pd-field pp-span2"><label>Location label ' +
        '<span class="pp-optnote">(optional -- does not replace the Location Breakdown above)</span></label>' +
        '<input class="pd-input" id="' + idPrefix + '-loctxt" value="' + Fmt.esc(locText || '') +
        '" placeholder="e.g. Model Unit Entrance" /></div>' +
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

  function openUpload(preset) {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    preset = preset || {};
    var today = new Date().toISOString().slice(0, 10);
    var html =
      '<div class="pd-modal-header"><h3>' + (preset.walk ? 'Capture — ' + preset.walk.at + ' of ' + preset.walk.total : 'Add photos') + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<p class="pp-hint">Fields below apply to every photo in this batch — edit any ' +
          'individual photo afterwards.</p>' +
        '<div class="pd-field"><label>Photos</label>' +
          '<input class="pd-input" type="file" id="pp-files" accept="image/*" capture="environment" multiple /></div>' +
        '<div class="pp-form2">' +
          '<div class="pd-field"><label>Description</label>' +
            '<input class="pd-input" id="pp-desc" placeholder="e.g. Model Unit" /></div>' +
          '<div class="pd-field"><label>Capture date' + reqMark() + '</label>' +
            '<input class="pd-input" type="date" id="pp-date" value="' + today + '" required /></div>' +
          '<div class="pd-field"><label>Trade' + reqMark() + '</label>' +
            '<select class="pd-select" id="pp-trade" required>' + tradeOptions('') + '</select></div>' +
          '<div class="pd-field"><label>Works' + reqMark() + '</label>' +
            '<input class="pd-input" id="pp-works" list="pp-works-list" placeholder="e.g. Temporary Facilities" required /></div>' +
          locationFieldHTML('pp', preset.locationValues || {}, preset.location || '') +
        '</div>' +
        '<div class="pp-progress" id="pp-prog" hidden></div>' +
      '</div>' +
      '<div class="pd-modal-footer">' +
        (preset.walk ? '<button class="pd-btn" id="pp-skip">Skip this location</button>' +
          '<button class="pd-btn" id="pp-endwalk">End walkthrough</button>' : '<button class="pd-btn" data-close>Cancel</button>') +
        '<button class="pd-btn pd-btn-primary" id="pp-save">Upload</button></div>';

    var m = openModal(html, 640);
    wireLocationField('pp');
    wireTradeWorks('pp');
    hydrate(m.el);
    if (preset.walk && $('pp-skip')) $('pp-skip').onclick = function () { m.close(); advanceWalkthrough(); };
    if (preset.walk && $('pp-endwalk')) $('pp-endwalk').onclick = function () {
      m.close(); walkState = null; roundsSelected = {}; renderRounds();
    };

    $('pp-save').onclick = async function () {
      var files = $('pp-files').files;
      if (!files || !files.length) { UI.toast('Choose at least one photo', 'warn'); return; }
      var reqErr = requiredFieldsMissing('pp');
      if (reqErr) { UI.toast(reqErr, 'warn'); return; }
      var locVals = currentLocValues('pp');
      var act = resolveActivity(locVals);
      var shared = {
        description: $('pp-desc').value.trim(),
        taken_at: $('pp-date').value || null,
        trade: $('pp-trade').value || null,
        works: $('pp-works').value.trim() || null,
        location: $('pp-loctxt').value.trim() || locBreadcrumb(locVals) || null,
        location_values: locVals,
        activity_id: act ? act.id : null,
        activity_name: act ? act.name : null,
        tags: readCodeTags('pp')
      };
      this.disabled = true;
      var prog = $('pp-prog'); prog.hidden = false;
      var done = 0, queued = 0, failed = [];

      for (var i = 0; i < files.length; i++) {
        prog.textContent = 'Saving ' + (i + 1) + ' of ' + files.length + '…';
        try {
          var r = await saveCapture(files[i], Object.assign({ sort_order: i }, shared));
          if (r.queued) queued++; else if (r.ok) done++; else failed.push(files[i].name);
        } catch (err) {
          failed.push(files[i].name + ': ' + (err.message || err));
        }
        await new Promise(function (r) { setTimeout(r, 0); });   // let progress paint
      }

      m.close();
      if (done) UI.toast(done + ' photo' + (done === 1 ? '' : 's') + ' uploaded', 'ok');
      if (queued) UI.toast(queued + ' photo' + (queued === 1 ? '' : 's') + ' queued — offline, will sync automatically', 'warn');
      if (failed.length) UI.toast(failed.length + ' failed — ' + failed[0], 'error');
      await load();
      if (preset.walk) advanceWalkthrough();
    };
  }

  async function uploadFile(file) {
    var safe = file.name.replace(/[^\w.\-]+/g, '_');
    var path = pid + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + safe;
    var res = await sb().storage.from(BUCKET).upload(path, file, { upsert: false });
    if (res.error) throw res.error;
    return path;
  }

  // ------------------------------------------------------------ tolerant write
  // Every DB write that might carry the new schedule-linkage columns goes
  // through here: routes through the shared PDSync outbox when present (same
  // offline/LWW mechanism openForm's metadata edits already use), and retries
  // once without wbs_node_id/activity_id/activity_name on a "column does not
  // exist" error so a not-yet-migrated DB never loses the whole write.
  async function doWrite(job) {
    if (window.PDSync) return PDSync.write(job);
    if (job.op === 'insert') {
      var ires = await sb().from(job.table).insert(job.patch);
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
          '<div class="pd-field"><label>Trade' + reqMark() + '</label>' +
            '<select class="pd-select" id="pp-e-trade" required>' + tradeOptions(r.trade || '') + '</select></div>' +
          '<div class="pd-field"><label>Works' + reqMark() + '</label>' +
            '<input class="pd-input" id="pp-e-works" list="pp-works-list" value="' + Fmt.esc(r.works || '') + '" required /></div>' +
          locationFieldHTML('pp-e', r.location_values || {}, r.location || '') +
        '</div>' +
      '</div>' +
      '<div class="pd-modal-footer">' +
        '<button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="pp-e-save">Save</button></div>';

    var m = openModal(html, 560);
    var codeWrap = $('pp-e-codes');
    if (codeWrap) Array.prototype.forEach.call(codeWrap.querySelectorAll('input[type=checkbox]'), function (c) {
      c.checked = (r.tags || []).indexOf(c.value) >= 0;
    });
    wireLocationField('pp-e', true);
    wireTradeWorks('pp-e');
    hydrate(m.el);
    // Clear the "editing this photo" cursor on every close path (× / Cancel).
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-close]'), function (b) {
      b.onclick = function () { broadcastCollabSel(null); m.close(); };
    });
    $('pp-e-save').onclick = async function () {
      var reqErr = requiredFieldsMissing('pp-e');
      if (reqErr) { UI.toast(reqErr, 'warn'); return; }
      this.disabled = true;
      var locVals = currentLocValues('pp-e');
      var act = resolveActivity(locVals);
      var patch = {
        description: $('pp-e-desc').value.trim(),
        taken_at: $('pp-e-date').value || null,
        trade: $('pp-e-trade').value || null,
        works: $('pp-e-works').value.trim() || null,
        location: $('pp-e-loctxt').value.trim() || locBreadcrumb(locVals) || null,
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
      broadcastCollabSel(null); m.close();
      fillFilterOptions(); render();
      var w = await tolerantWrite({ table: TABLE, op: 'update', id: r.id, patch: patch });
      if (!w.ok) { UI.toast(w.error ? w.error.message : 'Save failed', 'error'); return; }
      UI.toast(w.queued ? 'Saved on this device — will sync when you reconnect' : 'Photo updated', 'ok');
      if (window.PDSync) PDSync.cachePut('pp:' + pid, rows);
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

  // ------------------------------------------------------- Today's Rounds ---
  // The streamlined repeat-visit capture flow: a checklist of distinct
  // location-value COMBINATIONS drawn from the schedule's own activities
  // (not a separate location list), ranked by recent capture history, each
  // showing its last photo + current activity, single-tap capture or
  // multi-select into a sequential walkthrough.
  function refreshRoundsIfVisible() {
    var h = document.getElementById('pp-screen-rounds');
    if (h && !h.hidden) renderRounds();
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

  function renderRounds() {
    var host = $('pp-rounds-view');
    if (!host) return;
    if (!pid) { host.innerHTML = '<div class="pp-empty">Select a project.</div>'; return; }
    if (!LOC_LEVELS.length) {
      host.innerHTML = '<div class="pp-empty"><p>No Location Breakdown set up for this project yet.</p>' +
        '<p class="pp-hint">Build it in Project Schedule (Group menu &rarr; Location Breakdown&hellip;), or use ' +
        '<strong>+ Add photos</strong> on the Photos tab for an untracked location in the meantime.</p></div>';
      return;
    }
    var combos = locCombos();
    _roundsComboByKey = {};
    combos.forEach(function (c) { _roundsComboByKey[c.key] = c; });
    if (!combos.length) {
      host.innerHTML = '<div class="pp-empty"><p>No activities have a Location Breakdown value assigned yet in Project Schedule.</p></div>';
      return;
    }
    var q = roundsFilter.trim().toLowerCase();
    var items = combos.map(function (c) { return { combo: c, last: lastCaptureAt(c.values), act: resolveActivity(c.values) }; });
    if (q) items = items.filter(function (it) { return it.combo.label.toLowerCase().indexOf(q) >= 0; });

    var visited = items.filter(function (it) { return it.last; })
      .sort(function (a, b) { return (b.last.taken_at || '').localeCompare(a.last.taken_at || ''); });
    var unvisited = items.filter(function (it) { return !it.last; })
      .sort(function (a, b) { return a.combo.label.localeCompare(b.combo.label); });

    var selCount = Object.keys(roundsSelected).filter(function (k) { return roundsSelected[k]; }).length;
    var bar = selCount ? ('<div class="pp-selbar">' + selCount + ' location' + (selCount === 1 ? '' : 's') +
      ' selected <button class="pd-btn pd-btn-primary" id="pp-startwalk">Start walkthrough</button>' +
      '<button class="pd-btn" id="pp-clearsel">Clear</button></div>') : '';

    function row(it) {
      var u = it.last ? urlOf(it.last) : '';
      return '<div class="pp-round-row">' +
        '<input type="checkbox" class="pp-round-chk" data-key="' + Fmt.esc(it.combo.key) + '"' +
          (roundsSelected[it.combo.key] ? ' checked' : '') + ' />' +
        (u ? '<img class="pp-round-thumb" src="' + Fmt.esc(u) + '" alt="" />' :
             '<div class="pp-round-thumb pp-noimg"><span data-ico="camera" data-ico-size="16"></span></div>') +
        '<div class="pp-round-info">' +
          '<div class="pp-round-loc">' + Fmt.esc(it.combo.label) + '</div>' +
          (it.act ? '<div class="pp-round-act">' + Fmt.esc(it.act.name || it.act.id) + '</div>' : '') +
          (it.last ? '<div class="pp-round-last">Last captured ' + Fmt.date(it.last.taken_at) + '</div>' :
                     '<div class="pp-round-last pp-muted">Not yet captured</div>') +
        '</div>' +
        '<button class="pd-btn" data-cap="' + Fmt.esc(it.combo.key) + '">Capture</button>' +
        '</div>';
    }

    var html = bar;
    if (visited.length) html += '<div class="pp-round-sec">Recent rounds</div>' + visited.map(row).join('');
    if (unvisited.length) html += '<div class="pp-round-sec">Other schedule locations</div>' + unvisited.map(row).join('');
    if (!visited.length && !unvisited.length) html += '<div class="pp-empty"><p>No locations match this search.</p></div>';
    host.innerHTML = html;
    hydrate(host);
    wireRounds(host);
  }

  function wireRounds(host) {
    if ($('pp-startwalk')) $('pp-startwalk').onclick = startWalkthrough;
    if ($('pp-clearsel')) $('pp-clearsel').onclick = function () { roundsSelected = {}; renderRounds(); };
    Array.prototype.forEach.call(host.querySelectorAll('.pp-round-chk'), function (c) {
      c.onchange = function () { roundsSelected[this.dataset.key] = this.checked; renderRounds(); };
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-cap]'), function (b) {
      b.onclick = function () {
        var combo = _roundsComboByKey[this.dataset.cap];
        openUpload({ locationValues: combo ? combo.values : {}, location: combo ? combo.label : '' });
      };
    });
  }

  function startWalkthrough() {
    var keys = Object.keys(roundsSelected).filter(function (k) { return roundsSelected[k]; });
    if (!keys.length) { UI.toast('Select at least one location first', 'warn'); return; }
    walkState = { queue: keys, at: 0, total: keys.length };
    openWalkStep();
  }
  function advanceWalkthrough() {
    if (!walkState) return;
    walkState.at++;
    openWalkStep();
  }
  function openWalkStep() {
    if (!walkState || walkState.at >= walkState.queue.length) {
      if (walkState) UI.toast('Walkthrough complete', 'ok');
      walkState = null; roundsSelected = {}; renderRounds();
      return;
    }
    var key = walkState.queue[walkState.at];
    var combo = _roundsComboByKey[key];
    openUpload({ locationValues: combo ? combo.values : {}, location: combo ? combo.label : '',
      walk: { at: walkState.at + 1, total: walkState.total } });
  }

  return {
    init: init,
    // The PPR screen shares this module's project selector + trade vocabulary.
    onProject: function (fn) { projectListeners.push(fn); if (pid) fn(pid, projName); },
    trades: function () { return TRADES.slice(); },
    renderRounds: renderRounds,
    _syncChrome: syncChrome,
    _closeLightbox: closeLightbox,
    _stepLightbox: stepLightbox
  };
})();
