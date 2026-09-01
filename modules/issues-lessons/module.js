// ============================================================================
// Issues, Concerns & Lessons Learned
// ----------------------------------------------------------------------------
// Reproduces the Power Apps "Issues & Concerns" log (Status · Department ·
// Champion · Issue · Caused By · Corrective Action · Date Presented · Days
// Aging · Date Resolved) and ADDS a Lessons Learned capability: every issue can
// carry a lesson, and a dedicated "Lessons Learned" library screen collects all
// captured lessons so management/operations can reference them on future work.
//
// Table: issues_lessons.  Field mapping (see the migration):
//   ISSUE   -> description        STATUS -> status (Open | On Hold | Closed)
//   the rest -> department / champion / caused_by / corrective_action /
//               date_presented / date_resolved / lesson_learned /
//               lesson_category / recommendation
// Days Aging is DERIVED in the app (0 when Closed, else today − date_presented).
//
// A THIRD screen, Minutes of Meeting, was moved here out of the Project Schedule
// module (tables `meeting_minutes` / `mom_items`): a meeting's action items are
// chased as entries in THIS register, so the minutes belong beside it. See the
// MINUTES OF MEETING section at the foot of this file.
// ============================================================================

window.IssuesLessons = (function () {
  var TABLE = 'issues_lessons';
  var profile = null, UID = null;
  var pid = null, projName = '';
  // ⚠️ THREE different permissions, not one flag. The old single `canWrite` (planner+)
  // was the actual thing stopping a department from raising an issue — the DATABASE
  // already allowed it (`is_writer()` = approved AND not a viewer). These mirror
  // migrations/2026-08-19-department-issues.sql exactly; where the UI and the RLS
  // disagree, the user gets a silent failure and no way to tell why.
  var canAdd = false;      // any approved non-viewer may raise an issue
  var isSteward = false;   // planner+ — may edit anyone's, and may delete
  var canWrite = false;    // kept as "can do SOMETHING here", for the toolbar
  var rows = [];
  var MOM_BY_ID = {};                  // meeting_minutes referenced by these issues (C4)
  // ⚠️ DEFAULT SCREEN IS ISSUES, not Minutes any more — Minutes of Meeting moved
  // to its own module (modules/minutes-of-meeting/), so this module opens on
  // the register it actually owns.
  var screen = 'issues';               // 'issues' | 'lessons'
  var histScreen = null;               // UI.bindHistoryState() handle — see init()

  // ---- Issues & Concerns presentation ---------------------------------------
  // ⚠️ Dashboard is no longer a mode NESTED inside this screen — it is its own
  // top-level tab now (screen === 'dashboard'), combined with Lessons Learned's,
  // so a planner sees open AND closed issues plus every lesson in one place
  // instead of switching a Dashboard/Log toggle per screen. This screen keeps
  // just two modes: `log` (the register table — scanning forty issues for the
  // one you want is a different job from reading one of them) and `detail`
  // (one issue, read/edited — a drill-down reached from the log OR the
  // Dashboard tab). Neither is a filter; the log shows whatever the filter bar
  // above it currently scopes to.
  var _issMode = 'log';                // 'log' | 'detail'
  var _issPrevMode = 'log';            // where "← Back" in detail returns to
  var _issSel = null;                  // id of the issue open in detail
  // ⚠️ A NEW ISSUE IS A DRAFT IN MEMORY, NOT AN INSERTED ROW — deliberately UNLIKE
  // "+ New minutes", which inserts immediately and lets you type. It cannot work that way
  // here: `issues_lessons_del` is planner-only (2026-08-19-department-issues.sql), so a
  // department that mis-clicked "+ New issue" would leave a blank row in the register with
  // no way to remove it. The draft is written on Save and discarded on Cancel.
  var _issNew = null;
  var _issQ = '';                      // search inside the issue list
  // ---- Status workflow (items #10–13): inline reveal panels, not a modal ----
  // Clicking "Put On Hold" / "Close Issue" opens one of these instead of changing
  // `status` directly — both require a narrative before anything is written.
  var _issHoldOpen = false, _issHoldNote = '';
  var _issCloseOpen = false, _issCloseDraft = { report: '', lesson: '', dateResolved: '' };
  var ISSUE_HISTORY = {};              // issue id -> array of history rows (loaded on open)
  // Set while a NEW issue draft was started from the Lessons Learned screen's
  // "+ New Lesson" (item #15) — routes "Back"/"Cancel" to Lessons instead of Issues.
  var _issNewFromLessons = false;

  // ---- Lessons Learned ------------------------------------------------------
  // A lesson is its OWN record now (table `lessons_learned`), linked to the issue and/or
  // the meeting that produced it — see migrations/2026-08-26-lessons-learned.sql for why
  // it stopped being three columns on the issue.
  var LESSONS = [], _lessLoaded = false, _lessErr = '', _lessLegacy = false;
  // ⚠️ Same restructuring as Issues above — 'dashboard' moved out to its own
  // top-level tab (combined with Issues'), so this screen keeps just 'log' (the
  // library table, plus a section for lessons captured without a full issue —
  // meeting-linked or legacy) and 'detail' (the standalone lesson editor,
  // `lessonDetailHTML`, unchanged — reached from "capture another lesson" / a
  // meeting link / the combined Dashboard).
  var _lessMode = 'log';               // 'log' | 'detail'
  var _lessPrevMode = 'log';
  var _lessSel = null, _lessNew = null, _lessReport = false;
  // "This came out of a meeting." The tag is read-only in the log: the minute is the
  // record of what was said, this register owns how the issue is chased. Both now live
  // in this module (the Minutes of Meeting screen), but they stay separate records.
  // Who may edit THIS row. A department maintains its own entries; a planner
  // maintains the register. ⚠️ A row with no `created_by` (imported, or predating the
  // stamp) is steward-only — there is no way to know whose it was, and guessing would
  // hand someone edit rights over a record they never touched.
  // ⚠️ Says WHOSE it is without naming a person. Resolving `created_by` to a name would
  // need a read of `users`, which a department user has no business being granted for
  // the sake of a caption — and the department column already carries the useful half.
  function raisedByLabel(r) {
    if (!r || !r.created_by) return 'Raised before entries recorded who logged them — only a planner can change it.';
    if (UID && r.created_by === UID) return 'Raised by you' + (r.department ? ' · ' + r.department : '') + '.';
    return 'Raised by ' + (r.department ? 'the ' + r.department + ' department' : 'someone else') +
      '. Only they or a planner can change it.';
  }
  function canEditRow(r) {
    if (isSteward) return true;
    return !!(canAdd && r && r.created_by && UID && r.created_by === UID);
  }
  function momTag(r) {
    if (!r.mom_id) return '';
    var m = MOM_BY_ID[r.mom_id];
    var label = m ? (m.title || 'a meeting') : 'a meeting';
    var when = m && m.meeting_date ? ' · ' + Fmt.date(m.meeting_date) : '';
    return '<span class="il-momtag" title="' + Fmt.esc('Raised at: ' + label + when) + '">' +
      '<span data-ico="clipboard" data-ico-size="12"></span>From MOM</span>';
  }

  // ⚠️ ITEMS #1/#6: status defaults to 'Open', not "All" — both the Dashboard and the Log
  // read this SAME filter, so "by default only open issues show" applies to both screens
  // at once, and changing the one status control in the filter bar broadens (or narrows)
  // what either presentation describes. Never silently reset to '' anywhere but the
  // explicit Clear-filters action, which restores THIS default rather than "All".
  var iFilters = { search: '', status: 'Open', department: '', champion: '', aging: '' };
  var lFilters = { search: '', department: '' };
  // ⚠️ ITEM 1: the Dashboard's own filter state — deliberately SEPARATE from iFilters/
  // lFilters, so switching screens never silently changes what a DIFFERENT screen is
  // showing (the same rule the Dashboard's read of `rows`/`LESSONS` unfiltered has always
  // followed — see renderDashboardScreen()). Scoped to what the dashboard actually charts:
  // status/department/champion/search across issues.
  var dFilters = { search: '', status: '', department: '', champion: '' };

  // ⚠️ THE OWNER'S OWN LIST, replacing the earlier invented starter vocabulary
  // (item #7). A department value already on a row that predates this list
  // (e.g. legacy 'MEP', 'QA/QC') is NOT migrated or hidden — `populateFilterOptions()`
  // already builds its filter options from whatever departments are actually
  // present in the data, so an old value stays visible/filterable; only the
  // ADD/EDIT picker offers the new canonical list going forward. Kept in step
  // with the copy in `admin.html` (Minutes of Meeting has no department picker
  // of its own — it only displays a linked issue's department verbatim, so
  // there is nothing to sync there).
  var DEPARTMENTS = ['Commercial and Contracts', 'Engineering', 'Procurement', 'Finance',
                     'Human Resources', 'Quality', 'Health and Safety', 'Operations',
                     'PMO', 'COO', 'CEO'];
  var STATUSES    = ['Open', 'On Hold', 'Closed'];
  // ⚠️ ITEM 4: a lesson used to carry its own "Lesson category" vocabulary, a second
  // classifying dimension alongside Department that meant the same thing in practice and
  // could disagree with it. Lessons are now classified by DEPARTMENT ONLY, the same field
  // and the same list an issue already uses — LESSON_CATS and every `category`/
  // `lesson_category` field this module wrote are gone (the underlying `category` COLUMN
  // is untouched — pre-existing values are simply no longer surfaced or collected).

  function sb() { return AppAuth.getSB(); }

  // ===== live collaboration (presence + who's-editing row cursor) + offline =====
  var _collab = null, _remoteSel = {}, _collabSelf = {}, PKEY = 'issues_lessons', PID_PFX = 'il';
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
  function renderPresence(ms) { var el = document.getElementById(PID_PFX + '-presence'); if (el) el.innerHTML = window.PDCollab ? PDCollab.avatarsHTML(ms || []) : ''; }
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
  // (the modal cursor helper was removed with the Add/Edit modal — the detail pane
  // broadcasts the collab selection directly from wireIssues())
  function $(id) { return document.getElementById(id); }
  function statusClass(s) {
    return s === 'Closed' ? 'is-closed' : (s === 'On Hold' ? 'is-hold' : 'is-open');
  }

  // ---- derived Days Aging ----
  function agingDays(r) {
    if ((r.status || '') === 'Closed') return 0;
    if (!r.date_presented) return null;
    var m = String(r.date_presented).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    var d0 = new Date(+m[1], +m[2] - 1, +m[3]);
    var now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((now - d0) / 86400000));
  }
  // ⚠️ Reads the LESSONS library first and the old column only as a fallback. A lesson is
  // its own record now, so an issue can carry several — or one captured by someone else —
  // and testing the legacy column alone would report those issues as having none.
  function hasLesson(r) {
    if (r && r.id && LESSONS.some(function (l) { return l.issue_id === r.id; })) return true;
    return !!(r && r.lesson_learned && r.lesson_learned.trim());
  }

  // ---- ITEM 2: drag-to-reorder — the display order the Issues list and the
  // Lessons list draw from. `sort_order` is a plain nullable integer (migration
  // 2026-09-01-issues-lessons-reorder.sql); a row nobody has dragged has none,
  // so it falls back to the existing date-based order it always had. Once a
  // list is reordered, every row in the reordered view carries an explicit
  // sort_order (spaced by 10) and sorts ahead of any still-unordered row.
  function issueOrderCmp(a, b) {
    if (a.sort_order != null || b.sort_order != null) {
      if (a.sort_order == null) return 1;
      if (b.sort_order == null) return -1;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    }
    var x = a.date_presented || '', y = b.date_presented || '';
    if (!x !== !y) return x ? -1 : 1;
    if (x !== y) return y.localeCompare(x);
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  }
  function lessonOrderCmp(a, b) {
    if (a.sort_order != null || b.sort_order != null) {
      if (a.sort_order == null) return 1;
      if (b.sort_order == null) return -1;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    }
    var x = a.date_captured || '', y = b.date_captured || '';
    if (!x !== !y) return x ? -1 : 1;
    if (x !== y) return y.localeCompare(x);
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  }
  // ⚠️ `list` is the CURRENTLY DISPLAYED (already filtered) view — reordering only ever
  // renumbers what is actually on screen, and its members are the SAME objects that live
  // in `baseArr` (a `.filter()` result, never a copy), so mutating `r.sort_order` here
  // already updates the real row; `baseArr.sort(cmp)` after just re-settles its order.
  var _dragReorderId = null;
  function dragGripHTML(id) {
    return '<span class="il-draghandle il-reorderable" draggable="true" data-reorder="' + Fmt.esc(id) +
      '" title="Drag to reorder"><svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">' +
      '<circle cx="3" cy="3" r="1.3"/><circle cx="9" cy="3" r="1.3"/><circle cx="3" cy="8" r="1.3"/>' +
      '<circle cx="9" cy="8" r="1.3"/><circle cx="3" cy="13" r="1.3"/><circle cx="9" cy="13" r="1.3"/></svg></span>';
  }
  function wireReorder(container, list, baseArr, cmp, table) {
    if (!container) return;
    var els = container.querySelectorAll('[data-reorder]');
    Array.prototype.forEach.call(els, function (el) {
      // The handle itself must never also trigger a row/card's own "open" click.
      el.onclick = function (e) { e.stopPropagation(); };
      el.ondragstart = function (e) {
        _dragReorderId = el.dataset.reorder;
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', _dragReorderId); } catch (e2) { /* some browsers refuse setData on certain drag sources — the id is already cached above */ }
        el.classList.add('il-dragging');
      };
      el.ondragend = function () {
        el.classList.remove('il-dragging');
        Array.prototype.forEach.call(els, function (x) { x.classList.remove('il-drop-before', 'il-drop-after'); });
        _dragReorderId = null;
      };
      el.ondragover = function (e) {
        if (!_dragReorderId || _dragReorderId === el.dataset.reorder) return;
        e.preventDefault();
        var rect = el.getBoundingClientRect();
        var before = (e.clientY - rect.top) < rect.height / 2;
        Array.prototype.forEach.call(els, function (x) { if (x !== el) x.classList.remove('il-drop-before', 'il-drop-after'); });
        el.classList.toggle('il-drop-before', before);
        el.classList.toggle('il-drop-after', !before);
      };
      el.ondrop = function (e) {
        e.preventDefault();
        var targetId = el.dataset.reorder, dragId = _dragReorderId, before = el.classList.contains('il-drop-before');
        el.classList.remove('il-drop-before', 'il-drop-after');
        if (!dragId || dragId === targetId) return;
        applyReorder(list, baseArr, cmp, table, dragId, targetId, before);
      };
    });
  }
  async function applyReorder(list, baseArr, cmp, table, dragId, targetId, before) {
    var from = -1, targetIdx = -1;
    for (var i = 0; i < list.length; i++) { if (String(list[i].id) === String(dragId)) { from = i; break; } }
    if (from < 0) return;
    var arr = list.slice();
    var moved = arr.splice(from, 1)[0];
    for (var j = 0; j < arr.length; j++) { if (String(arr[j].id) === String(targetId)) { targetIdx = j; break; } }
    if (targetIdx < 0) targetIdx = arr.length;
    arr.splice(before ? targetIdx : targetIdx + 1, 0, moved);
    var writes = [];
    arr.forEach(function (r, i) {
      var next = (i + 1) * 10;
      if (r.sort_order !== next) {
        r.sort_order = next;
        writes.push(sb().from(table).update({ sort_order: next }).eq('id', r.id));
      }
    });
    try { await Promise.all(writes); } catch (e) { /* best-effort — a failed write just leaves that one row's order stale until the next reload */ }
    baseArr.sort(cmp);
    render();
  }

  // ========================================================================
  async function init(user, prof) {
    profile = prof;
    UID = (user && user.id) || (prof && prof.id) || null;
    _collabSelf = { id: UID, name: (prof && (prof.name || prof.email)) || 'Someone' };
    isSteward = ['super_admin', 'admin', 'planner'].indexOf(prof.role) >= 0;
    canAdd = !!prof && prof.status === 'approved' && prof.role !== 'viewer';
    canWrite = canAdd;

    // ⚠️ Deep link from My Work, and from the sibling Minutes of Meeting module's
    // "Capture lesson" / "N lessons" buttons: ?screen=issues|lessons|dashboard. Read
    // BEFORE wire()/syncChrome(), which paint the tab strip from `screen` — set it
    // afterwards and the strip would say one thing while the module showed
    // another. An unknown or absent value leaves the default (Issues) untouched.
    try {
      var _q = new URLSearchParams(location.search).get('screen');
      if (_q === 'issues' || _q === 'lessons' || _q === 'dashboard') screen = _q;
    } catch (e) { /* no URLSearchParams / opaque URL — keep the default */ }

    // ⚠️ Tolerant, and NOT awaited-into-failure: `getPeople()` returns [] when the
    // roster RPC is missing (migration not yet run), so the pickers fall back to
    // free text rather than the whole module refusing to load over a dropdown.
    try { PEOPLE = await PDb.getPeople(); } catch (e) { PEOPLE = []; }

    await loadProjects();
    wire();
    // ⚠️ REAL BUG FIXED HERE — this used to be a bare `syncChrome();` call, on the
    // (false) assumption that syncChrome() "paints the tab strip from `screen`".
    // It doesn't: syncChrome() only toggles the +New button / view-toggle, never the
    // il-screen-* `hidden` attributes, the `.il-tab.active` class, or the title —
    // ONLY switchScreen() does that. So a `?screen=issues` deep link (My Work's row
    // click; also the sidebar's "Meetings" entry with `?screen=mom`) set the `screen`
    // VARIABLE above but left the DOM showing the default Minutes-of-Meeting screen
    // (still un-hidden, and empty because render() never draws into it for a
    // different screen) while the actually-requested screen's content rendered
    // correctly into a `<div>` that stayed `hidden` — i.e. "nothing shows up" for
    // whatever screen was actually asked for. switchScreen() also calls syncChrome()
    // and render() itself, so this both fixes the DOM and folds in the old call.
    switchScreen(screen);
    // Browser-history integration (UI.bindHistoryState, ui.js): without this the
    // Issues/Lessons tab strip never touches the URL, so the browser's native
    // Back button jumps straight past every screen switch to the module
    // launcher. Bound once here (after the ?screen= deep-link above has already
    // been resolved and applied to the DOM by switchScreen()); switchScreen() itself
    // does the DOM work, so it doubles as apply(). Every place that changes `screen`
    // also calls histScreen.push() once (see wire()'s tab click handler).
    histScreen = UI.bindHistoryState({
      key: 'il_screen',
      get: function () { return { s: screen }; },
      apply: function (state) { switchScreen(state.s); }
    });
    // ⚠️ BUG FIX (owner report: "when you don't select issues or lessons, nothing
    // shows up"). `bindHistoryState` only calls `apply()` — i.e. `switchScreen()`,
    // the ONLY thing that clears the `hidden` attribute off a screen `<div>` — when
    // the URL already carries its own hash (a reload, or a Back/Forward step). On a
    // genuinely first visit there is no hash, so `apply()` is never called and both
    // `#il-screen-issues` / `#il-screen-lessons` stay `hidden` forever: the module
    // paints a topbar and nothing else. The same gap meant `?screen=lessons` (the
    // deep link from Minutes of Meeting / My Work) set the `screen` VARIABLE above
    // but never told the DOM, which still showed whatever the last hash said (or
    // nothing). Calling switchScreen(screen) unconditionally here covers both: on
    // a plain visit it establishes the default; if bindHistoryState's apply() has
    // ALREADY run (a hash existed) this just re-applies the same value — a harmless
    // no-op repaint, not a second navigation (nothing here calls histScreen.push()).
    switchScreen(screen);
    if (pid) {
      // ⚠️ AWAITED here (unlike the fire-and-forget pattern this module used
      // before the split) so the cross-module deep link below can act once
      // LESSONS has actually loaded — newLesson()/openLesson() need it.
      await load();
      try {
        var dl = new URLSearchParams(location.search);
        // From Minutes of Meeting's "N lessons" / "Lesson captured" button.
        if (dl.get('openLesson')) openLesson(dl.get('openLesson'));
        // From Minutes of Meeting's "+ Capture lesson" button — pre-fills the
        // source exactly the way newLesson({mom_id, mom_item_id, issue_id})
        // always has, just triggered from the other module now.
        else if (dl.get('momId') && dl.get('momItem')) {
          newLesson({ mom_id: dl.get('momId'), mom_item_id: dl.get('momItem'),
                       issue_id: dl.get('issueId') || null });
        }
      } catch (e) { /* no URLSearchParams / opaque URL — nothing to deep-link to */ }
    }
    joinCollab();
  }

  async function loadProjects() {
    var projects = await PDb.getProjects();
    var sel = $('il-project');
    pid = sessionStorage.getItem('pd_project') || (projects[0] && projects[0].id) || null;
    var cur = projects.find(function (p) { return p.id === pid; });
    projName = cur ? (cur.name || cur.id) : '';
    sel.innerHTML = '<option value="">Select project…</option>' +
      projects.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === pid ? ' selected' : '') + '>' +
          Fmt.esc(p.name) + '</option>';
      }).join('');
    UI.enhanceProjectSelect(sel);   // shared searchable project picker
    if (pid) sessionStorage.setItem('pd_project', pid);
  }

  function wire() {
    $('il-project').onchange = function () {
      pid = this.value;
      var opt = this.options[this.selectedIndex];
      projName = opt ? opt.textContent : '';
      if (pid) sessionStorage.setItem('pd_project', pid);
      momReset();          // the light MOM read belongs to a project too — reset it on switch
      issReset(); lessReset();
      load();
      joinCollab();
    };

    // Screen tabs
    Array.prototype.forEach.call(document.querySelectorAll('.il-tab[data-screen]'), function (b) {
      b.onclick = function () { switchScreen(b.dataset.screen); if (histScreen) histScreen.push(); };
    });

    // ITEM 1: the topbar search box + funnel toggle, shared by all three screens —
    // the SAME UX Progress Photos uses. Which filter object / panel they act on is
    // whichever screen is currently active (see activeFilters()/activeFilterPanel()).
    wireTopFilters();

    // Issue filters (panel content — search is bound to the topbar box now, see
    // wireTopFilters(); this hidden field is kept so nothing else that reads it by
    // id breaks)
    ['search', 'status', 'department', 'champion', 'aging'].forEach(function (k) {
      var el = $('il-f-' + k);
      if (el) el.oninput = el.onchange = function () {
        iFilters[k] = (k === 'search') ? this.value.toLowerCase().trim() : this.value;
        renderIssues();
      };
    });
    $('il-clearfilters').onclick = function () {
      // ⚠️ Restores the DEFAULT (status=Open), not "All" — items #1/#6. A Clear that landed
      // on "All statuses" would silently widen the dashboard/log past the app's own default
      // scope, reading as a filter change rather than a reset.
      iFilters = { search: '', status: 'Open', department: '', champion: '', aging: '' };
      ['search', 'department', 'champion', 'aging'].forEach(function (k) {
        var el = $('il-f-' + k); if (el) el.value = '';
      });
      var st = $('il-f-status'); if (st) st.value = 'Open';
      syncTopFilters();
      renderIssues();
    };

    // Lesson filters — item 4 dropped the separate "category" filter.
    ['search', 'department'].forEach(function (k) {
      var el = $('il-lf-' + k);
      if (el) el.oninput = el.onchange = function () {
        lFilters[k] = (k === 'search') ? this.value.toLowerCase().trim() : this.value;
        renderLessons();
      };
    });
    $('il-lclearfilters').onclick = function () {
      lFilters = { search: '', department: '' };
      ['search', 'department'].forEach(function (k) {
        var el = $('il-lf-' + k); if (el) el.value = '';
      });
      syncTopFilters();
      renderLessons();
    };

    // Dashboard filters (item 1 — the same UX extended to the Dashboard tab).
    ['search', 'status', 'department', 'champion'].forEach(function (k) {
      var el = $('il-d-' + k);
      if (el) el.oninput = el.onchange = function () {
        dFilters[k] = (k === 'search') ? this.value.toLowerCase().trim() : this.value;
        renderDashboardScreen();
      };
    });
    $('il-dclearfilters').onclick = function () {
      dFilters = { search: '', status: '', department: '', champion: '' };
      ['search', 'status', 'department', 'champion'].forEach(function (k) {
        var el = $('il-d-' + k); if (el) el.value = '';
      });
      syncTopFilters();
      renderDashboardScreen();
    };

    $('il-new').onclick = function () {
      // ⚠️ ITEM #15: a standalone lesson goes through the SAME full issue-to-closure flow
      // as any other closed issue (see `newLessonAsClosedIssue`) — not the older lightweight
      // `newLesson(null)` form, which is still used for the narrower "link a lesson to a
      // meeting action item" / "capture another lesson on an already-closed issue" cases.
      if (screen === 'issues') newIssue();
      else if (screen === 'lessons') newLessonAsClosedIssue();
    };
    $('il-refresh').onclick = function () {
      momReset();
      load();
    };
    // ⚠️ The per-screen Dashboard/Log toggle is GONE — Dashboard is its own top-level tab
    // now (see `.il-tabs` in the HTML), so there is nothing left to wire here.
  }

  // ---- ITEM 1: one shared topbar search box + funnel toggle -----------------
  // Progress Photos' own pattern: a compact search input in the topbar tool
  // cluster plus a funnel button that reveals the rest of a screen's filters in
  // a panel docked below. Reused across all three screens here rather than
  // building three separate topbar controls — which filter object / panel they
  // read and write is decided by whichever screen is currently active.
  function activeFilters() { return screen === 'lessons' ? lFilters : (screen === 'dashboard' ? dFilters : iFilters); }
  function activeFilterPanelId() { return screen === 'lessons' ? 'il-lessons-filters' : (screen === 'dashboard' ? 'il-dashboard-filters' : 'il-issues-filters'); }
  function activeSearchPlaceholder() {
    return screen === 'lessons' ? 'Search lessons, recommendations…'
      : screen === 'dashboard' ? 'Search issues, champions, departments…'
      : 'Search issue, cause, corrective action, champion…';
  }
  function wireTopFilters() {
    var ts = $('il-topsearch'), tf = $('il-topfilttoggle');
    if (ts) ts.oninput = function () {
      activeFilters().search = this.value.toLowerCase().trim();
      if (screen === 'lessons') renderLessons();
      else if (screen === 'dashboard') renderDashboardScreen();
      else renderIssues();
    };
    if (tf) tf.onclick = function () {
      var panel = $(activeFilterPanelId());
      if (!panel) return;
      panel.classList.toggle('open');
      tf.classList.toggle('is-active', panel.classList.contains('open'));
    };
  }
  // Called whenever the active screen changes (or a Clear-filters button
  // resets a screen's own search) so the ONE shared search box always shows
  // the right screen's own search text, not whatever was last typed elsewhere.
  function syncTopFilters() {
    var ts = $('il-topsearch'), tf = $('il-topfilttoggle');
    if (ts) { ts.value = activeFilters().search || ''; ts.placeholder = activeSearchPlaceholder(); }
    if (tf) { var p = $(activeFilterPanelId()); tf.classList.toggle('is-active', !!(p && p.classList.contains('open'))); }
  }

  function switchScreen(s) {
    screen = s;
    $('il-screen-issues').hidden = s !== 'issues';
    $('il-screen-lessons').hidden = s !== 'lessons';
    $('il-screen-dashboard').hidden = s !== 'dashboard';
    $('il-screen-title').textContent =
      s === 'lessons' ? 'Lessons Learned' : (s === 'dashboard' ? 'Dashboard' : 'Issues & Concerns');
    Array.prototype.forEach.call(document.querySelectorAll('.il-tab[data-screen]'), function (b) {
      b.classList.toggle('active', b.dataset.screen === s);
    });
    syncChrome();
    syncTopFilters();
    render();
  }

  function syncChrome() {
    var curMode = screen === 'lessons' ? _lessMode : (screen === 'issues' ? _issMode : null);
    // ⚠️ `canAdd`, not `canWrite`: raising an issue is open to any approved non-viewer
    // (D1 — the DATABASE has always allowed it). Same rule for capturing a lesson. Hidden
    // while a single record is already open (`detail`) — there's nowhere for a second
    // "+ New" to land that isn't confusing mid-edit — and hidden on the Dashboard tab,
    // which has no register of its own to add into.
    var showNew = canAdd && (screen === 'issues' || screen === 'lessons') && curMode !== 'detail';
    var nb = $('il-new');
    nb.style.display = showNew ? '' : 'none';
    $('il-sep').style.display = showNew ? '' : 'none';
    if (showNew) {
      nb.textContent = screen === 'lessons' ? '+ New lesson' : '+ New issue';
      nb.title = screen === 'lessons' ? 'Capture a lesson learned' : 'Log a new issue';
    }
  }

  // ------------------------------------------------------------------ load ---
  async function load() {
    if (!pid) {
      rows = [];
      $('il-table').innerHTML =
        '<tr><td style="padding:24px;color:var(--pd-muted);">Select a project to see its issues.</td></tr>';
      render();
      return;
    }
    $('il-table').innerHTML = '<tr><td style="padding:24px;color:var(--pd-muted);">Loading…</td></tr>';
    // The report view is the default now, so it needs the loading state too — otherwise a
    // slow project reads as an empty register.
    var _iv = $('il-issues-view');
    if (_iv && !_issNew) _iv.innerHTML = '<div class="pd-card" style="padding:24px;color:var(--pd-muted);">Loading issues…</div>';
    // ⚠️ Keyset-paginated (see PDb.selectAll) — a plain .select() truncates at 1000 rows server-side
    // with no error, and this log accumulates for the life of the project. Shaped as {data}/{error}
    // so the offline-cache branch is untouched; the display sort is re-applied in memory.
    var res;
    try { res = { data: await PDb.selectAll(TABLE, function (q) { return q.eq('project_id', pid); }) }; }
    catch (err) { res = { error: err }; }
    if (res.error) {
      if (window.PDSync) { var c = await PDSync.cacheGet(PID_PFX + ':' + pid); if (c && c.rows) { rows = c.rows.slice(); populateFilterOptions(); render(); return; } }
      UI.toast(res.error.message, 'error'); return;
    }
    rows = res.data || [];
    // The reciprocal half of the schedule module's Minutes of Meeting (C4): an issue
    // raised out of a meeting carries `mom_id`, and the register says so.
    // ⚠️ Titles only, and only the meetings actually referenced — this register does not
    // own minutes and must not start loading them wholesale. Tolerant of the un-run
    // 2026-08-19 migration: no table -> no tag, everything else unaffected.
    try {
      var momIds = rows.map(function (r) { return r.mom_id; }).filter(Boolean)
        .filter(function (v, i, a2) { return a2.indexOf(v) === i; });
      if (momIds.length) {
        var mres = await sb().from('meeting_minutes').select('id,title,meeting_date').in('id', momIds);
        MOM_BY_ID = {};
        ((mres && !mres.error && mres.data) || []).forEach(function (m) { MOM_BY_ID[m.id] = m; });
      } else { MOM_BY_ID = {}; }
    } catch (e) { MOM_BY_ID = {}; }
    rows.sort(issueOrderCmp);   // manual sort_order first (item 2), else date_presented desc
    if (window.PDSync) PDSync.cachePut(PID_PFX + ':' + pid, rows);   // offline read-cache
    // ⚠️ Lessons load WITH the register, not lazily like the minutes. An issue's detail
    // pane states the lessons captured on it, so a lazily-loaded library would make the
    // issue screen say "no lessons yet" about an issue that has some — the worst possible
    // reading on a screen whose whole job is to be reported from.
    await loadLessons();
    populateFilterOptions();
    render();
  }

  function populateFilterOptions() {
    // Departments actually present + the canonical list; champions from data.
    function fill(sel, values, current, allLabel) {
      if (!sel) return;
      sel.innerHTML = '<option value="">' + allLabel + '</option>' +
        values.map(function (v) {
          return '<option' + (current === v ? ' selected' : '') + '>' + Fmt.esc(v) + '</option>';
        }).join('');
    }
    var depts = {}, champs = {};
    rows.forEach(function (r) {
      if (r.department) depts[r.department] = 1;
      if (r.champion) champs[r.champion] = 1;
    });
    // ⚠️ Lesson departments come from the LESSONS table too, not only from the issues —
    // a lesson can be captured on a meeting or on nothing at all, so filtering the library
    // by the issues' vocabulary alone would hide every unlinked lesson's department.
    LESSONS.forEach(function (l) { if (l.department) depts[l.department] = 1; });
    var deptList = Object.keys(depts).sort();
    var champList = Object.keys(champs).sort();
    fill($('il-f-status'), STATUSES, iFilters.status, 'All statuses');
    fill($('il-f-department'), deptList, iFilters.department, 'All departments');
    fill($('il-f-champion'), champList, iFilters.champion, 'All champions');
    fill($('il-lf-department'), deptList, lFilters.department, 'All departments');
    // Item 1: the Dashboard's own filter panel — same vocabulary as the Issues panel.
    fill($('il-d-status'), STATUSES, dFilters.status, 'All statuses');
    fill($('il-d-department'), deptList, dFilters.department, 'All departments');
    fill($('il-d-champion'), champList, dFilters.champion, 'All champions');
  }

  function render() {
    if (screen === 'lessons') renderLessons();
    else if (screen === 'dashboard') renderDashboardScreen();
    else renderIssues();
    if (window.Icons && Icons.hydrate) Icons.hydrate($('il-screen-' + screen));
    paintRemote();
  }

  // ------------------------------------------------------------- Issues ------
  function issuesFiltered() {
    return rows.filter(function (r) {
      if (iFilters.status && (r.status || 'Open') !== iFilters.status) return false;
      if (iFilters.department && r.department !== iFilters.department) return false;
      if (iFilters.champion && r.champion !== iFilters.champion) return false;
      if (iFilters.aging) {
        var a = agingDays(r);
        if (iFilters.aging === 'open') { if ((r.status || 'Open') === 'Closed') return false; }
        else if (a == null) return false;
        else if (iFilters.aging === '0-30' && !(a <= 30)) return false;
        else if (iFilters.aging === '31-90' && !(a >= 31 && a <= 90)) return false;
        else if (iFilters.aging === '90+' && !(a > 90)) return false;
      }
      if (iFilters.search) {
        var hay = [r.description, r.caused_by, r.corrective_action, r.champion,
                   r.department, r.lesson_learned].join(' ').toLowerCase();
        if (hay.indexOf(iFilters.search) === -1) return false;
      }
      return true;
    });
  }

  // ---- shared chart helpers (used by Issues AND Lessons dashboards) ---------
  // A ring chart via stroke-dasharray on stacked circles — no library, matches
  // this app's established "hand-rolled inline SVG" convention for dashboards
  // (drawing-register's donutSVG, the equipment/manpower portfolio charts, …).
  function donutChartSVG(slices, opts) {
    opts = opts || {};
    var size = opts.size || 130, sw = opts.stroke || 20;
    var r = (size - sw) / 2, c = size / 2, circ = 2 * Math.PI * r;
    var total = slices.reduce(function (s, x) { return s + x.value; }, 0);
    var offset = 0, arcs;
    if (!total) {
      arcs = '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="var(--pd-line)" stroke-width="' + sw + '"></circle>';
    } else {
      arcs = slices.map(function (s) {
        var frac = s.value / total, len = frac * circ;
        var piece = '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="' + s.color +
          '" stroke-width="' + sw + '" stroke-dasharray="' + len.toFixed(2) + ' ' + (circ - len).toFixed(2) +
          '" stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 ' + c + ' ' + c + ')">' +
          '<title>' + Fmt.esc(s.label) + ': ' + s.value + '</title></circle>';
        offset += len;
        return piece;
      }).join('');
    }
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size +
      '" role="img" aria-label="' + Fmt.esc(opts.aria || 'chart') + '">' + arcs + '</svg>';
  }
  // A small vertical bar chart, e.g. counts by aging bucket.
  function barChartSVG(bars, opts) {
    opts = opts || {};
    var w = opts.width || 280, h = opts.height || 140, padTop = 22, padBottom = 20;
    var bodyH = h - padTop - padBottom;
    var max = Math.max(1, bars.reduce(function (m, b) { return Math.max(m, b.value); }, 0));
    var bw = w / bars.length;
    var bars_svg = bars.map(function (b, i) {
      var bh = max ? Math.round((b.value / max) * bodyH) : 0;
      var innerW = bw * 0.6, x = i * bw + (bw - innerW) / 2;
      var y = padTop + (bodyH - bh);
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + innerW.toFixed(1) +
          '" height="' + Math.max(1, bh).toFixed(1) + '" fill="' + b.color + '" rx="3"><title>' +
          Fmt.esc(b.label) + ': ' + b.value + '</title></rect>' +
        '<text x="' + (x + innerW / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) +
          '" text-anchor="middle" font-size="11" font-weight="700" fill="var(--pd-ink)">' + b.value + '</text>' +
        '<text x="' + (x + innerW / 2).toFixed(1) + '" y="' + (h - 4).toFixed(1) +
          '" text-anchor="middle" font-size="10" fill="var(--pd-muted)">' + Fmt.esc(b.label) + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" role="img" ' +
      'aria-label="' + Fmt.esc(opts.aria || 'chart') + '" preserveAspectRatio="xMidYMid meet">' + bars_svg + '</svg>';
  }
  // ---- item 9: a grouped (Open vs Total) bar chart, e.g. per champion -------
  // Two bars side by side per item, sharing one y-axis scaled off the larger
  // TOTAL bars (Open can never exceed Total, so Total always sets the scale).
  function groupedBarSVG(items, opts) {
    opts = opts || {};
    var w = opts.width || 420, h = opts.height || 190, padTop = 20, padBottom = 34, padSide = 10;
    var bodyH = h - padTop - padBottom;
    var max = Math.max(1, items.reduce(function (m, it) { return Math.max(m, it.total); }, 0));
    var n = Math.max(1, items.length);
    var groupW = (w - padSide * 2) / n;
    var barW = Math.max(4, Math.min(18, groupW * 0.32));
    var openColor = opts.openColor || '#EE3124', totalColor = opts.totalColor || 'var(--pd-line)';
    var svg = items.map(function (it, i) {
      var gx = padSide + i * groupW + groupW / 2;
      var totalH = Math.max(1, Math.round((it.total / max) * bodyH));
      var openH = Math.max(it.open ? 1 : 0, Math.round((it.open / max) * bodyH));
      var totalY = padTop + (bodyH - totalH), openY = padTop + (bodyH - openH);
      var x1 = gx - barW - 1.5, x2 = gx + 1.5;
      return '<rect x="' + x1.toFixed(1) + '" y="' + totalY.toFixed(1) + '" width="' + barW.toFixed(1) +
          '" height="' + totalH.toFixed(1) + '" fill="' + totalColor + '" rx="2">' +
          '<title>' + Fmt.esc(it.label) + ' — Total: ' + it.total + '</title></rect>' +
        '<rect x="' + x2.toFixed(1) + '" y="' + openY.toFixed(1) + '" width="' + barW.toFixed(1) +
          '" height="' + openH.toFixed(1) + '" fill="' + openColor + '" rx="2">' +
          '<title>' + Fmt.esc(it.label) + ' — Open: ' + it.open + '</title></rect>' +
        '<text x="' + gx.toFixed(1) + '" y="' + (h - padBottom + 16).toFixed(1) +
          '" text-anchor="middle" font-size="9.5" fill="var(--pd-muted)">' + Fmt.esc(clip(it.label, 9)) + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" role="img" ' +
      'aria-label="' + Fmt.esc(opts.aria || 'chart') + '" preserveAspectRatio="xMidYMid meet">' + svg + '</svg>';
  }

  // ---- shared History (item #11) --------------------------------------------
  // ⚠️ ONE history table for both Issues and (via a closed issue) Lessons — a
  // lesson-producing closure IS an issue update, so its history lives with the
  // issue, not duplicated onto the lessons_learned row.
  var HISTORY_TABLE = 'issues_lessons_history';
  var ISSUE_HIST_LABELS = { create: 'Logged', update: 'Updated', hold: 'Put on hold', close: 'Closed' };
  async function logHistory(issueId, projectId, action, beforeRow, note) {
    // ⚠️ Best-effort and never awaited-into-failure: the real write (the issue
    // itself) has already succeeded by the time this runs, and a missing
    // migration or a transient failure here must not make that read as an
    // error to the person who just saved.
    try {
      await sb().from(HISTORY_TABLE).insert({
        issue_id: issueId, project_id: projectId, action: action, note: note || null,
        snapshot: beforeRow || null, changed_by: UID,
        changed_by_department: (profile && profile.department) || null,
      });
    } catch (e) { /* table not migrated yet, or a transient failure — silent */ }
    loadIssueHistory(issueId);
  }
  async function loadIssueHistory(id) {
    if (!id) return;
    try {
      var res = await sb().from(HISTORY_TABLE).select('*').eq('issue_id', id)
        .order('changed_at', { ascending: false }).limit(200);
      ISSUE_HISTORY[id] = res.error ? [] : (res.data || []);
    } catch (e) { ISSUE_HISTORY[id] = []; }
    if (_issSel === id && _issMode === 'detail') { renderIssues(); }
  }
  // ⚠️ ITEM #6: the fields shown as a before -> after line whenever they changed —
  // every field this register actually asks for, not just the action label + a
  // free-text note. `logHistory` already snapshots the WHOLE row before each
  // change (see saveIssue/confirmHoldIssue/confirmCloseIssue) — this is what turns
  // that stored jsonb into something readable rather than a blob nobody opens.
  var HIST_FIELDS = [
    ['status', 'Status'], ['department', 'Department'], ['champion', 'Champion(s)'],
    ['description', 'Issue'], ['caused_by', 'Caused By'],
    ['corrective_action', 'Corrective Action'], ['hold_reason', 'Reason for Hold'],
    ['closure_report', 'Closure Report'],
    ['date_presented', 'Date Presented'], ['date_resolved', 'Date Resolved'],
  ];
  function histNorm(v) { return (v === null || v === undefined) ? '' : String(v); }
  function histFieldHTML(key, val) {
    if (!val) return '<em>—</em>';
    if (key === 'date_presented' || key === 'date_resolved') return Fmt.esc(Fmt.date(val));
    return Fmt.esc(val).replace(/\n/g, '<br>');
  }
  // `before` is null on a `create` entry (logHistory is passed null — there is nothing
  // yet to compare against), in which case this lists what was actually captured at
  // creation instead of an arrow. Fields that did not change are omitted entirely.
  function issHistDiffHTML(before, after) {
    after = after || {};
    var lines = HIST_FIELDS.map(function (f) {
      var key = f[0], label = f[1];
      var a = histNorm(after[key]);
      if (!before) {
        if (!a) return '';
        return '<li><strong>' + Fmt.esc(label) + ':</strong> ' + histFieldHTML(key, a) + '</li>';
      }
      var b = histNorm(before[key]);
      if (b === a) return '';
      return '<li><strong>' + Fmt.esc(label) + ':</strong> ' + histFieldHTML(key, b) +
        ' &rarr; ' + histFieldHTML(key, a) + '</li>';
    }).filter(Boolean);
    return lines.length ? '<ul class="il-history-diff">' + lines.join('') + '</ul>' : '';
  }
  function historyHTML(id) {
    var list = ISSUE_HISTORY[id];
    if (list === undefined) return '<p class="il-mom-note">Loading history…</p>';
    if (!list.length) {
      return '<p class="il-mom-note">No changes recorded yet — Run <code>migrations/' +
        '2026-08-31-issues-workflow-history.sql</code> if this issue has been updated and ' +
        'nothing appears here.</p>';
    }
    // ⚠️ Entry i's AFTER state is the snapshot the NEXT-more-recent entry stored as its
    // BEFORE (list is newest-first) — the most recent entry's after-state is simply the
    // live row, since no later history entry exists to have snapshotted it.
    var current = rows.find(function (x) { return x.id === id; }) || {};
    return '<ul class="il-history">' + list.map(function (h, i) {
      var after = i === 0 ? current : (list[i - 1].snapshot || {});
      return '<li class="il-history-i"><div class="il-history-top">' +
        '<span class="il-history-action">' + Fmt.esc(ISSUE_HIST_LABELS[h.action] || h.action) + '</span>' +
        '<span class="il-history-when">' + Fmt.esc(Fmt.date(h.changed_at)) +
        (h.changed_by_department ? ' · ' + Fmt.esc(h.changed_by_department) : '') + '</span></div>' +
        (h.note ? '<div class="il-history-note">' + Fmt.esc(h.note).replace(/\n/g, '<br>') + '</div>' : '') +
        issHistDiffHTML(h.snapshot, after) +
      '</li>';
    }).join('') + '</ul>';
  }

  // Dispatcher — just `log`/`detail` now (see the state comment above); the analytics
  // landing page moved out to its own top-level tab, `renderDashboardScreen()` below.
  function renderIssues() {
    // ITEM 3: no tiles once an issue is open individually — a single record already
    // states its own status; a project-wide count beside it answers a question nobody
    // is asking on this screen.
    if (_issMode === 'log') renderIssueKpis();
    else { var kh = $('il-kpis'); if (kh) kh.innerHTML = ''; }
    // ⚠️ status='Open' is the DEFAULT scope (items #1/#6), not "no filter" — so it must not
    // count toward "any filter is active" or Clear would permanently show at rest.
    var anyF = ['search', 'department', 'champion', 'aging'].some(function (k) { return iFilters[k]; }) ||
      iFilters.status !== 'Open';
    var clr = $('il-clearfilters'); if (clr) clr.hidden = !anyF;
    // ITEM #3/#1: the filter panel can be collapsed, so a narrowed view needs a signal
    // that survives closing it — otherwise a hidden "Open items only" filter looks like
    // a missing issue rather than a filter someone forgot was on. The dot lives on the
    // ONE shared topbar funnel now, and only reflects it while Issues is the active screen.
    if (screen === 'issues') { var ft = $('il-topfilttoggle'); if (ft) ft.classList.toggle('has-active', anyF); }
    var log = $('il-issues-log'), view = $('il-issues-view');
    if (log) log.hidden = _issMode !== 'log';
    if (view) view.hidden = _issMode === 'log';
    if (_issMode === 'log') renderIssuesLog();
    else renderIssueDetailView();
  }

  // --------------------------------------------------------- Dashboard tab ---
  // Rebuilt (items 6-10) into ONE unified page, not an Issues section beside a
  // Lessons section: a status pie in place of tiles, an open-vs-total bar, a
  // champion breakdown (table + grouped open-vs-total bars), and the full
  // matching issue list at the very bottom, below every chart. It has its own
  // filter panel now (item 1), scoped by `dFilters` — deliberately separate
  // from the Issues/Lessons Log screens' own filter state, so switching
  // screens never silently changes what a DIFFERENT screen is showing.
  function dashIssuesFiltered() {
    return rows.filter(function (r) {
      if (dFilters.status && (r.status || 'Open') !== dFilters.status) return false;
      if (dFilters.department && r.department !== dFilters.department) return false;
      if (dFilters.champion && r.champion !== dFilters.champion) return false;
      if (dFilters.search) {
        var hay = [r.description, r.caused_by, r.corrective_action, r.champion, r.department]
          .join(' ').toLowerCase();
        if (hay.indexOf(dFilters.search) === -1) return false;
      }
      return true;
    });
  }
  function champTableHTML(list) {
    if (!list.length) return '';
    return '<div class="pd-tablewrap"><table class="il-dash-list il-dash-champ-table"><thead><tr>' +
      '<th>Champion</th><th>Open</th><th>Total</th></tr></thead><tbody>' +
      list.map(function (c) {
        return '<tr><td>' + Fmt.esc(c.label) + '</td>' +
          '<td class="il-dc-num">' + c.open + '</td>' +
          '<td class="il-dc-num">' + c.total + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  // ITEM 10: the full matching list, below every chart — not capped like the
  // dashboard's old 12-row summary, since this IS the full list.
  function fullIssueListHTML(data) {
    return '<div class="il-dash-fulllist-head"><h4>All matching issues</h4>' +
      '<span class="il-dash-fulllist-count">' + data.length + ' issue' + (data.length === 1 ? '' : 's') + '</span></div>' +
      (data.length
        ? '<div class="pd-tablewrap"><table class="il-dash-list"><thead><tr>' +
            '<th>Issue</th><th>Champion</th><th>Department</th><th>Status</th><th>Aging</th></tr></thead><tbody>' +
            data.map(function (r) {
              var a = agingDays(r);
              return '<tr data-open="' + Fmt.esc(r.id) + '">' +
                '<td>' + Fmt.esc(clip(r.description, 90) || '(no issue text)') + '</td>' +
                // Item 5: latest champion only, same rule as the Issues log.
                '<td>' + Fmt.esc(latestChampionText(r) || '—') + '</td>' +
                '<td>' + Fmt.esc(r.department || '—') + '</td>' +
                '<td><span class="il-pill ' + statusClass(r.status) + '">' + Fmt.esc(r.status || 'Open') + '</span></td>' +
                '<td>' + (a == null ? '—' : a + 'd') + '</td>' +
              '</tr>';
            }).join('') + '</tbody></table></div>'
        : '<div class="il-empty" style="padding:16px;">No issues match the current filter.</div>');
  }
  function renderDashboardScreen() {
    var host = $('il-dashboard-view'); if (!host) return;
    var anyF = ['search', 'status', 'department', 'champion'].some(function (k) { return dFilters[k]; });
    var clr = $('il-dclearfilters'); if (clr) clr.hidden = !anyF;
    if (screen === 'dashboard') { var ft = $('il-topfilttoggle'); if (ft) ft.classList.toggle('has-active', anyF); }
    if (!pid) {
      host.innerHTML = '<div class="pd-card" style="padding:24px;color:var(--pd-muted);">Select a project to see its dashboard.</div>';
      return;
    }
    var data = dashIssuesFiltered();
    var open = data.filter(function (r) { return (r.status || 'Open') === 'Open'; }).length;
    var hold = data.filter(function (r) { return r.status === 'On Hold'; }).length;
    var closed = data.filter(function (r) { return r.status === 'Closed'; }).length;
    var total = data.length;

    // ITEM 7: status pie, replacing the tiles.
    var statusSlices = [
      { label: 'Open', value: open, color: '#dc2626' },
      { label: 'On Hold', value: hold, color: '#d97706' },
      { label: 'Closed', value: closed, color: '#16a34a' },
    ];
    // ITEM 8: open vs total, overall.
    var openTotalBars = [
      { label: 'Open', value: open, color: '#dc2626' },
      { label: 'Total', value: total, color: '#94a3b8' },
    ];
    // ITEM 9: by champion — a table AND the same open-vs-total shape as item 8,
    // one grouped pair of bars per champion. Grouped by latestChampionText()
    // (item 5) — "who owns it now", not the full joined assignment history.
    var byChamp = {};
    data.forEach(function (r) {
      var c = latestChampionText(r) || '(no champion)';
      if (!byChamp[c]) byChamp[c] = { label: c, open: 0, total: 0 };
      byChamp[c].total++;
      if ((r.status || 'Open') === 'Open') byChamp[c].open++;
    });
    var champList = Object.keys(byChamp).map(function (k) { return byChamp[k]; })
      .sort(function (a, b) { return b.total - a.total; });
    var champTop = champList.slice(0, 10);

    // ITEM 6: lessons are folded in as one line, never a separate section.
    var standalone = LESSONS.filter(function (l) { return !l.issue_id; });
    var lessonsNote = '<p class="il-dash-note"><span data-ico="bulb" data-ico-size="14"></span>' +
      '<strong>' + LESSONS.length + '</strong> lesson' + (LESSONS.length === 1 ? '' : 's') + ' captured' +
      (standalone.length ? ' (' + standalone.length + ' without a full issue)' : '') +
      ' — see the Lessons Learned screen.</p>';

    host.innerHTML = migrateNoteHTML() + lessonsNote +
      '<div class="il-dash-grid">' +
        '<div class="pd-card il-dash-card"><h4>Status</h4>' +
          (total
            ? '<div class="il-dash-chartwrap">' + donutChartSVG(statusSlices, { aria: 'Issues by status' }) +
              '<div class="il-dash-legend">' + statusSlices.map(function (s) {
                return '<span class="il-dash-legend-i"><i style="background:' + s.color + '"></i>' +
                  Fmt.esc(s.label) + ' (' + s.value + ')</span>';
              }).join('') + '</div></div>'
            : '<div class="il-empty" style="padding:16px;">No issues match the current filter.</div>') +
        '</div>' +
        '<div class="pd-card il-dash-card"><h4>Open vs Total</h4>' +
          barChartSVG(openTotalBars, { aria: 'Open vs total issues' }) +
        '</div>' +
        '<div class="pd-card il-dash-card il-dash-wide"><h4>By champion — open vs total</h4>' +
          (champTop.length
            ? groupedBarSVG(champTop, { aria: 'Issues by champion, open vs total' }) +
              '<div class="il-dash-barlegend"><span><i style="background:#EE3124"></i>Open</span>' +
                '<span><i style="background:#94a3b8"></i>Total</span></div>' +
              champTableHTML(champList) +
              (champList.length > champTop.length
                ? '<p class="il-mom-note">Chart shows the top ' + champTop.length + ' of ' + champList.length +
                  ' champions by total; the table above lists every one.</p>' : '')
            : '<div class="il-empty" style="padding:16px;">No issues match the current filter.</div>') +
        '</div>' +
      '</div>' +
      // ITEM 10: the full list, below every chart.
      fullIssueListHTML(data);
    host.querySelectorAll('[data-open]').forEach(function (tr) { tr.onclick = function () { openIssue(tr.dataset.open); }; });
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
  }

  function renderIssuesLog() {
    var t = $('il-table');
    if (!pid) {
      t.innerHTML = '<tr><td style="padding:24px;color:var(--pd-muted);">Select a project to see its issues.</td></tr>';
      return;
    }
    if (!rows.length) {
      t.innerHTML = '<tr><td style="padding:0;">' +
        '<div class="il-empty"><span data-ico="clipboard" data-ico-size="40"></span>' +
        '<div class="il-empty-title">No issues logged yet for this project.</div>' +
        (canWrite ? '<div>Use <strong>+ New issue</strong> to log the first one.</div>' : '') +
        '</div></td></tr>';
      if (window.Icons) Icons.hydrate(t);
      return;
    }
    var data = issuesFiltered();
    // Item 2: drag-to-reorder needs a leading handle column, present in both the
    // header and every row so the column counts still match (this module's own
    // standing rule).
    var head = '<thead><tr>' +
      '<th class="il-dragcell"></th>' +
      '<th>No.</th><th>Department</th><th>Issue</th><th>Caused By</th>' +
      '<th>Corrective Action</th><th>Champion</th><th>Status</th>' +
      '<th>Date Presented</th><th>Days Aging</th><th>Date Resolved</th>' +
      (isSteward ? '<th></th>' : '') + '</tr></thead>';

    // ⚠️ ITEM #4: no per-row edit button any more — the WHOLE ROW opens the issue
    // (view-only where canEditRow(r) is false; issDetailHTML already renders read-only
    // in that case via its own `ro` flag, so this also lets a viewer read a record they
    // never had a click-through to before). Only a planner's delete icon remains, and it
    // stops the click from bubbling up into the row-open.
    var body = data.map(function (r, i) {
      var a = agingDays(r);
      var agingTxt = a == null ? '—' : (a + ' day' + (a === 1 ? '' : 's'));
      var hot = a != null && a > 90 && (r.status || 'Open') !== 'Closed';
      // data-l = the column heading. Unused on desktop (the <thead> supplies it);
      // at phone width module.css hides the head and stacks each row into a card,
      // where every value needs its own inline label (.il-table td::before).
      return '<tr class="il-clickrow" data-open="' + Fmt.esc(r.id) + '">' +
        // Item 2: drag handle — a separate element so the row's own click-to-open
        // handler is never fought by the drag gesture.
        '<td class="il-dragcell">' + dragGripHTML(r.id) + '</td>' +
        '<td class="il-cell-num">' + (i + 1) + '</td>' +
        '<td data-l="Department">' + Fmt.esc(r.department) + '</td>' +
        '<td class="il-cell-wrap il-cell-issue" data-l="Issue"><div class="il-clip">' + Fmt.esc(r.description) + '</div>' +
          (hasLesson(r) ? '<span class="il-lessontag"><span data-ico="bulb" data-ico-size="12"></span>Lesson captured</span>' : '') +
          momTag(r) +
        '</td>' +
        '<td class="il-cell-wrap" data-l="Caused by"><div class="il-clip">' + Fmt.esc(r.caused_by) + '</div></td>' +
        '<td class="il-cell-wrap" data-l="Corrective action"><div class="il-clip">' + Fmt.esc(r.corrective_action) + '</div></td>' +
        // Item 5: only the LATEST champion, not the joined history of everyone
        // ever assigned — see latestChampionText().
        '<td class="il-champ" data-l="Champion">' + Fmt.esc(latestChampionText(r)) + '</td>' +
        '<td data-l="Status"><span class="il-pill ' + statusClass(r.status) + '">' + Fmt.esc(r.status || 'Open') + '</span></td>' +
        '<td data-l="Presented">' + Fmt.date(r.date_presented) + '</td>' +
        '<td class="il-aging' + (hot ? ' is-hot' : '') + '" data-l="Aging">' + agingTxt + '</td>' +
        '<td data-l="Resolved">' + Fmt.date(r.date_resolved) + '</td>' +
        (isSteward ? '<td class="il-rowacts">' +
          '<button class="il-iconbtn is-danger" title="Delete" data-del="' + r.id + '">🗑</button>' +
          '</td>' : '') +
      '</tr>';
    }).join('');

    t.innerHTML = head + '<tbody>' + (body ||
      '<tr><td colspan="' + (isSteward ? 12 : 11) + '" style="padding:24px;color:var(--pd-muted);">No issues match the current filters.</td></tr>') +
      '</tbody>';

    // ⚠️ The row IS the editor entry point now. Its own click opens the issue; the
    // delete button inside it stops propagation first, or deleting would also open it.
    t.querySelectorAll('tr[data-open]').forEach(function (tr) {
      tr.onclick = function () { openIssue(tr.dataset.open); };
    });
    t.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); del(b.dataset.del); };
    });
    // Item 2: drag-to-reorder, scoped to whatever the current filter is showing.
    wireReorder(t, data, rows, issueOrderCmp, TABLE);
    if (window.Icons) Icons.hydrate(t);
  }

  // Open an issue in the detail drill-down (from the log, the dashboard, a minute, a lesson).
  function openIssue(id) {
    _issPrevMode = (_issMode === 'detail') ? _issPrevMode : _issMode;
    _issMode = 'detail'; _issSel = id; _issNew = null;
    _issHoldOpen = false; _issCloseOpen = false;
    loadIssueHistory(id);
    if (screen !== 'issues') switchScreen('issues');
    else { syncChrome(); renderIssues(); }
  }

  // "← Back" out of the detail drill-down, to the Log (there is only one other mode
  // now — see the state comment above) — OR back to the Lessons Learned screen, when
  // this draft was started from its "+ New Lesson" button (item #15's standalone-lesson
  // flow lives on the Issues screen's own detail form, since a lesson IS a closed issue;
  // Back has to return to where the planner actually was). Opening an issue from the
  // combined Dashboard tab also lands here on "Back" — the Issues screen's own Log,
  // not the Dashboard tab, matching how opening one from the Log itself behaves.
  function backFromIssueDetail() {
    if (_issNew && !confirm('Discard the unsaved new issue?')) return;
    var toLessons = !!_issNewFromLessons;
    _issNewFromLessons = false;
    _issMode = _issPrevMode || 'log';
    _issSel = null; _issNew = null; _issHoldOpen = false; _issCloseOpen = false;
    if (toLessons) { switchScreen('lessons'); return; }
    syncChrome(); renderIssues();
  }

  function issReset() {
    _issSel = null; _issNew = null; _issQ = ''; _issMode = 'log'; _issPrevMode = 'log';
    _issHoldOpen = false; _issCloseOpen = false;
    _issCloseDraft = { report: '', lesson: '', category: '', dateResolved: '' };
  }

  function reqMark(editable) { return editable ? ' <span class="il-req" title="Required">*</span>' : ''; }

  // ------------------------------------------------- Issues: detail view -----
  // ⚠️ THIS IS STILL THE POWER APPS "VIEW OPEN ISSUES" LAYOUT — a status panel beside the
  // issue / cause / corrective-or-hold-or-closure text — just reached as a drill-down now
  // (items #1/#16) instead of being the screen's default landing presentation.
  //
  // ⚠️ ONE renderer for read-only and editable, disabled by field rather than a second
  // markup path — two paths drift the moment either is touched (the same call the minutes
  // detail card documents). `ro` is now driven purely by EDIT PERMISSION (canEditRow) — the
  // separate "Reporting view" read-only toggle this used to also fold in is gone; Detail
  // itself is the single-record read/edit view now, and the toplevel Dashboard covers what
  // "reporting" meant.
  function renderIssueDetailView() {
    var host = $('il-issues-view'); if (!host) return;
    host.classList.remove('il-mom-report');
    if (!pid) {
      host.innerHTML = '<div class="pd-card" style="padding:24px;color:var(--pd-muted);">Select a project to see its issues.</div>';
      return;
    }
    var cur = _issNew || rows.find(function (r) { return r.id === _issSel; }) || null;
    // ⚠️ ITEM #5: step through the SAME set the log is currently showing —
    // issuesFiltered(), not all of `rows` — so Prev/Next tracks whatever filter is
    // applied. Never offered for a not-yet-saved draft, which has no place in that
    // list yet, and it degrades to a plain note when the open record has fallen out
    // of the active filter (e.g. it was just closed while "Open items only" is set)
    // rather than guessing which neighbour to step to.
    host.innerHTML =
      '<div class="il-detail-nav">' +
        '<button class="il-backlink" id="il-iss-back"><span data-ico="arrowLeft" data-ico-size="14"></span>Back to Issues</button>' +
        (cur && !_issNew ? issStepHTML(cur.id) : '') +
      '</div>' +
      (cur ? issDetailHTML(cur)
           : '<div class="il-empty" style="padding:28px;">This issue is no longer in the current filter — ' +
             '<button class="pd-btn pd-btn-sm" id="il-iss-back2">go back</button>.</div>');
    wireIssues();
    var prevBtn = $('il-iss-prev'), nextBtn = $('il-iss-next');
    if (prevBtn) prevBtn.onclick = function () { stepIssue(-1); };
    if (nextBtn) nextBtn.onclick = function () { stepIssue(1); };
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
  }

  function issStepHTML(id) {
    var list = issuesFiltered();
    var idx = list.findIndex(function (x) { return x.id === id; });
    if (idx === -1) return '<span class="il-stepnote">Not in the current filter</span>';
    return '<div class="il-steps">' +
      '<button class="il-iconbtn" id="il-iss-prev" title="Previous in the filtered list"' +
        (idx <= 0 ? ' disabled' : '') + '>&lsaquo;</button>' +
      '<span class="il-stepnote">' + (idx + 1) + ' of ' + list.length + '</span>' +
      '<button class="il-iconbtn" id="il-iss-next" title="Next in the filtered list"' +
        (idx >= list.length - 1 ? ' disabled' : '') + '>&rsaquo;</button>' +
    '</div>';
  }

  // Moves to the adjacent issue in issuesFiltered() — the log's own current order —
  // and opens it exactly as clicking that row would (same permission handling, same
  // history load). A boundary or a since-vanished current record is simply a no-op.
  function stepIssue(dir) {
    var list = issuesFiltered();
    var idx = list.findIndex(function (x) { return x.id === _issSel; });
    if (idx === -1) return;
    var next = list[idx + dir];
    if (next) openIssue(next.id);
  }

  function issDetailHTML(r) {
    var isNew = !r.id;
    var mayEdit = isNew ? canAdd : canEditRow(r);
    var ro = !mayEdit, d = ro ? ' disabled' : '';
    var a = agingDays(r);
    var ls = isNew ? [] : lessonsOfIssue(r.id);
    // ⚠️ ITEM #15's "standalone lesson" flow: a NEW issue started from the Lessons Learned
    // screen's "+ New Lesson" carries `_forceClose` and is presented — and, on Save, written
    // — as an already-Closed issue with its lesson attached in the SAME step, rather than
    // going through Open → Put On Hold/Close Issue. Every OTHER field is exactly what a
    // normal issue asks for, per the owner's own wording ("must still provide all the
    // details required from adding issues up to closure report and lessons learned").
    var forceClose = isNew && !!r._forceClose;
    var status = forceClose ? 'Closed' : (r.status || 'Open');

    function opts(list, val, blank) {
      return (blank ? '<option value="">' + blank + '</option>' : '') +
        list.map(function (o) { return '<option' + (val === o ? ' selected' : '') + '>' + Fmt.esc(o) + '</option>'; }).join('');
    }

    // ---- item #12/#13: the ONE narrative field swaps with the issue's status --
    var narrativeField;
    if (status === 'Closed') {
      narrativeField = ilField(ro, 'Closure Report' + reqMark(!ro), 'il-c-action',
        '<textarea class="pd-textarea il-if" data-f="closure_report" rows="4" spellcheck="true" ' +
          'placeholder="How was this issue resolved?"' + d + (ro ? '' : ' required') + '>' +
          Fmt.esc(r.closure_report) + '</textarea>', r.closure_report) +
        (forceClose && !ro
          ? ilField(false, 'Lessons Learned' + reqMark(true), 'il-c-lesson',
              '<textarea class="pd-textarea il-if" data-f="_lessonText" rows="4" spellcheck="true" ' +
                'placeholder="What did the team learn from this issue?" required>' +
                Fmt.esc(r._lessonText) + '</textarea>', r._lessonText)
          // Item 4: no separate "Lesson category" field — the lesson is classified by
          // Department, which the issue already carries and this form already collects.
          : '');
    } else if (status === 'On Hold') {
      narrativeField = ilField(ro, 'Reason for Hold' + reqMark(!ro), 'il-c-action',
        '<textarea class="pd-textarea il-if" data-f="hold_reason" rows="4" spellcheck="true" ' +
          'placeholder="Why is this issue on hold?"' + d + (ro ? '' : ' required') + '>' +
          Fmt.esc(r.hold_reason) + '</textarea>', r.hold_reason);
    } else {
      narrativeField = ilField(ro, 'Corrective Action' + reqMark(!ro), 'il-c-action',
        '<textarea class="pd-textarea il-if" data-f="corrective_action" rows="4" spellcheck="true" ' +
          'placeholder="Actions taken / planned…"' + d + (ro ? '' : ' required') + '>' +
          Fmt.esc(r.corrective_action) + '</textarea>', r.corrective_action);
    }

    // ---- items #10–13: Update / Put On Hold / Close Issue, replacing a status <select> ---
    var canHold = mayEdit && !isNew && status === 'Open';
    var canClose = mayEdit && !isNew && status !== 'Closed';
    var workflowRow = (ro || _issHoldOpen || _issCloseOpen) ? '' :
      '<div class="il-workflow-btns">' +
        '<button class="pd-btn pd-btn-primary pd-btn-sm" id="il-iss-save">' +
          (forceClose ? 'Close & save lesson' : (isNew ? 'Save issue' : 'Update Issue')) + '</button>' +
        (canHold ? '<button class="pd-btn pd-btn-sm" id="il-iss-holdbtn">Put On Hold</button>' : '') +
        (canClose ? '<button class="pd-btn pd-btn-sm" id="il-iss-closebtn">Close Issue</button>' : '') +
        (isNew ? '<button class="pd-btn pd-btn-sm" id="il-iss-cancel">Cancel</button>'
               : (isSteward
                   ? '<button class="pd-btn pd-btn-sm pd-btn-danger" id="il-iss-del" style="margin-left:auto;">Delete issue…</button>'
                   // Says why rather than showing a button the database would refuse: a
                   // department raising an issue must not be able to make it disappear.
                   : '<span class="il-raisedby" style="margin:0 0 0 auto;">Only a planner can delete an issue from the register.</span>')) +
      '</div>';

    var holdPanel = !_issHoldOpen ? '' :
      '<div class="il-workflow-panel"><label>Reason for Hold' + reqMark(true) + '</label>' +
        '<textarea class="pd-textarea" id="il-iss-holdnote" rows="3" spellcheck="true" required ' +
          'placeholder="Why is this issue being put on hold?">' + Fmt.esc(_issHoldNote) + '</textarea>' +
        '<div class="il-workflow-acts"><button class="pd-btn pd-btn-sm" id="il-iss-holdcancel">Cancel</button>' +
        '<button class="pd-btn pd-btn-primary pd-btn-sm" id="il-iss-holdconfirm">Confirm hold</button></div></div>';

    var closePanel = !_issCloseOpen ? '' :
      '<div class="il-workflow-panel">' +
        // ⚠️ ITEM 2: this is the ONE place a planner is actually asked for a Date
        // Resolved — at the moment of closing, not when the issue was raised.
        // Defaults to today (pre-filled, like Date Presented does on Add) but is a
        // real required field so a planner closing out a backlog of old issues can
        // still date each one correctly.
        '<label>Date Resolved' + reqMark(true) + '</label>' +
        '<input class="pd-input pd-input-sm" id="il-iss-closedate" type="date" required value="' +
          dateVal(_issCloseDraft.dateResolved || todayISO()) + '">' +
        '<label>Closure Report' + reqMark(true) + '</label>' +
        '<textarea class="pd-textarea" id="il-iss-closereport" rows="3" spellcheck="true" required ' +
          'placeholder="How was this issue resolved?">' + Fmt.esc(_issCloseDraft.report) + '</textarea>' +
        '<label>Lessons Learned' + reqMark(true) + '</label>' +
        '<textarea class="pd-textarea" id="il-iss-closelesson" rows="3" spellcheck="true" required ' +
          'placeholder="What did the team learn from this issue?">' + Fmt.esc(_issCloseDraft.lesson) + '</textarea>' +
        '<p class="il-mom-note">Closing an issue always records a lesson — this is what "no need for the ' +
          'capture a lesson button" means: closure IS the capture.</p>' +
        '<div class="il-workflow-acts"><button class="pd-btn pd-btn-sm" id="il-iss-closecancel">Cancel</button>' +
        '<button class="pd-btn pd-btn-primary pd-btn-sm" id="il-iss-closeconfirm">Confirm closure</button></div></div>';

    return '<div class="il-mom-detail-card il-iss-card">' +
      '<div class="il-mom-toolbar">' +
        '<span class="il-mom-state' + (status === 'Closed' ? ' on' : '') + '">' +
          (isNew ? 'New issue — not yet saved' : 'Issue in the register') + '</span>' +
      '</div>' +

      // ---- the Power Apps two-pane body -------------------------------------
      // Reordered by CSS `order` at ≤700px (item #14): the status panel follows the
      // issue/cause/action body on a narrow screen instead of leading it.
      '<div class="il-iss-split">' +
        '<div class="il-iss-panel">' +
          '<div class="il-mi-f il-c-status"><label>Status</label>' +
            '<span class="il-pill ' + statusClass(status) + '">' + Fmt.esc(status) + '</span></div>' +
          ilField(ro, 'Department' + reqMark(!ro), 'il-c-dept',
            '<select class="pd-select pd-input-sm il-if" data-f="department"' + d + (ro ? '' : ' required') + '>' +
              opts(DEPARTMENTS, r.department || '', '— Select —') + '</select>', r.department) +
          // ⚠️ The picker replaces the old free-text box but does NOT drop free
          // text — it carries both, so a champion without an account is still
          // nameable and no existing value is lost on the next save.
          ilField(ro, 'Champion(s)' + reqMark(!ro), 'il-c-champ',
            peoplePickerHTML('iss-champ', r.champion_ids, championExtra(r.champion_ids, r.champion), ro),
            championText(r.champion_ids, r.champion)) +
          ilField(ro, 'Date Presented' + reqMark(!ro), 'il-c-pres',
            '<input class="pd-input pd-input-sm il-if" data-f="date_presented" type="date" value="' +
              dateVal(r.date_presented) + '"' + d + (ro ? '' : ' required') + '>',
            r.date_presented ? Fmt.date(r.date_presented) : '') +
          // ⚠️ DERIVED, never stored and never editable — 0 when Closed, else today minus
          // the date presented. A stored aging is wrong the next morning.
          '<div class="il-mi-f il-c-aging"><label>Days Aging</label>' +
            '<div class="il-mi-val' + (a != null && a > 90 && status !== 'Closed' ? ' is-hot' : '') + '">' +
            (a == null ? '—' : a + ' day' + (a === 1 ? '' : 's')) + '</div></div>' +
          // ⚠️ ITEM 2: no "Date Resolved" field while the issue isn't Closed — adding
          // one asks for a resolution date on an issue nobody has resolved yet. It only
          // appears once status IS Closed (whether an already-closed issue, or a
          // forceClose draft being closed at creation), and is REQUIRED at that point —
          // see the closePanel below and saveIssue()'s validation, which is where a
          // planner is actually asked for it (not at Add time).
          (status === 'Closed'
            ? ilField(ro, 'Date Resolved' + reqMark(!ro), 'il-c-res',
                '<input class="pd-input pd-input-sm il-if" data-f="date_resolved" type="date" value="' +
                  dateVal(r.date_resolved || todayISO()) + '"' + d + (ro ? '' : ' required') + '>',
                r.date_resolved ? Fmt.date(r.date_resolved) : '')
            : '') +
        '</div>' +

        '<div class="il-iss-body">' +
          ilField(ro, 'Issue' + reqMark(!ro), 'il-c-issue',
            '<textarea class="pd-textarea il-if" data-f="description" rows="4" spellcheck="true" ' +
              'placeholder="Describe the issue or concern…"' + d + (ro ? '' : ' required') + '>' + Fmt.esc(r.description) + '</textarea>',
            r.description) +
          ilField(ro, 'Caused By' + reqMark(!ro), 'il-c-cause',
            '<textarea class="pd-textarea il-if" data-f="caused_by" rows="3" spellcheck="true" ' +
              'placeholder="Root cause…"' + d + (ro ? '' : ' required') + '>' + Fmt.esc(r.caused_by) + '</textarea>', r.caused_by) +
          narrativeField +
          (isNew ? '' : '<div class="il-iss-prov">' + (momTag(r) || '') +
            '<span class="il-raisedby">' + Fmt.esc(raisedByLabel(r)) + '</span></div>') +
        '</div>' +
      '</div>' +

      holdPanel + closePanel + workflowRow +

      // ---- lessons, as their own records ------------------------------------
      // ⚠️ NOT fields on this form any more. A lesson lives in `lessons_learned` and is
      // shown here because this issue produced it — one issue can produce several, and a
      // lesson outlives the issue. Closing (above) always creates the first one; this button
      // is only for an EXTRA lesson on an issue already closed.
      '<div class="il-mom-actions il-iss-lessons"><h4>Lessons learned from this issue</h4>' +
        (ls.length
          ? '<div class="il-lessons il-lessons-inline">' + ls.map(lessonCardHTML).join('') + '</div>'
          : '<div class="il-empty" style="padding:12px;">No lesson captured from this issue yet.</div>') +
        (canAdd && !isNew && status === 'Closed'
          ? '<div class="il-mom-addrow"><button class="pd-btn pd-btn-sm" id="il-iss-addlesson">+ Capture another lesson</button></div>'
          : '') +
      '</div>' +

      // ---- item #11: a per-issue audit trail --------------------------------
      '<div class="il-mom-actions il-iss-history"><h4>History</h4>' +
        (isNew ? '<p class="il-mom-note">History begins once this issue is saved.</p>' : historyHTML(r.id)) +
      '</div>' +

      '<datalist id="il-champ-list">' + champDatalist() + '</datalist>' +
    '</div>';
  }

  function wireIssues() {
    var host = $('il-issues-view'); if (!host) return;
    var back = host.querySelector('#il-iss-back'); if (back) back.onclick = backFromIssueDetail;
    var back2 = host.querySelector('#il-iss-back2'); if (back2) back2.onclick = backFromIssueDetail;
    var nb = host.querySelector('#il-iss-new'); if (nb) nb.onclick = newIssue;
    var sv = host.querySelector('#il-iss-save'); if (sv) sv.onclick = saveIssue;
    var cn = host.querySelector('#il-iss-cancel');
    if (cn) cn.onclick = function () { _issNew = null; backFromIssueDetail(); };
    var dl = host.querySelector('#il-iss-del');
    if (dl) dl.onclick = function () { del(_issSel); };
    var al = host.querySelector('#il-iss-addlesson');
    if (al) al.onclick = function () {
      var r = rows.find(function (x) { return x.id === _issSel; }) || {};
      newLesson({ issue_id: _issSel, mom_id: r.mom_id || null, department: r.department || null });
    };
    host.querySelectorAll('[data-open-lesson]').forEach(function (b) {
      b.onclick = function () { openLesson(b.dataset.openLesson); };
    });

    // ---- workflow: Put On Hold / Close Issue reveal panels ------------------
    var hb = host.querySelector('#il-iss-holdbtn');
    if (hb) hb.onclick = function () { _issHoldOpen = true; _issCloseOpen = false; _issHoldNote = ''; renderIssues(); };
    var hc = host.querySelector('#il-iss-holdcancel');
    if (hc) hc.onclick = function () { _issHoldOpen = false; renderIssues(); };
    var hn = host.querySelector('#il-iss-holdnote');
    if (hn) hn.oninput = function () { _issHoldNote = hn.value; };
    var hcf = host.querySelector('#il-iss-holdconfirm');
    if (hcf) hcf.onclick = confirmHoldIssue;

    var cb = host.querySelector('#il-iss-closebtn');
    if (cb) cb.onclick = function () {
      _issCloseOpen = true; _issHoldOpen = false;
      // ⚠️ Pre-filled to today, like Date Presented is on Add — a required field the
      // planner can accept or change, not one they have to remember to fill in blank.
      _issCloseDraft = { report: '', lesson: '', dateResolved: todayISO() };
      renderIssues();
    };
    var cc = host.querySelector('#il-iss-closecancel');
    if (cc) cc.onclick = function () { _issCloseOpen = false; renderIssues(); };
    var cdt = host.querySelector('#il-iss-closedate'); if (cdt) cdt.onchange = function () { _issCloseDraft.dateResolved = cdt.value; };
    var crp = host.querySelector('#il-iss-closereport'); if (crp) crp.oninput = function () { _issCloseDraft.report = crp.value; };
    var cls = host.querySelector('#il-iss-closelesson'); if (cls) cls.oninput = function () { _issCloseDraft.lesson = cls.value; };
    var ccf = host.querySelector('#il-iss-closeconfirm');
    if (ccf) ccf.onclick = confirmCloseIssue;

    // A draft's typing has to survive a re-render, so it is written into `_issNew` as it
    // is typed; a saved issue is read out of the form on Save.
    if (_issNew) {
      host.querySelectorAll('.il-if').forEach(function (f) {
        f.oninput = f.onchange = function () { _issNew[f.dataset.f] = f.value; };
      });
    }
    // ⚠️ The Champion picker is not an `.il-if`, so it needs its own draft capture —
    // otherwise the next re-render would reset it to the draft's stale value.
    wirePeople(host, function (key, ids, text) {
      if (key === 'iss-champ' && _issNew) { _issNew.champion_ids = ids; _issNew.champion = text; }
    });
    // Broadcast the collab cursor for whichever issue is open.
    var curR = _issNew || rows.find(function (x) { return x.id === _issSel; });
    broadcastCollabSel(_issNew ? null : _issSel, !!(curR && (_issNew ? canAdd : canEditRow(curR))));
  }

  function newIssue() {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    if (!canAdd) return;
    // ⚠️ Defaults from the raiser's PROFILE (D1). Typing the department every time invites
    // the typo that silently splits the register's own Department filter in two.
    // ⚠️ ITEM #10: no status field to fill in — every new issue is Open by default, and the
    // only way OUT of Open is the Put On Hold / Close Issue buttons on a SAVED issue.
    _issNew = {
      status: 'Open',
      department: (profile && profile.department) || '',
      champion: '', champion_ids: [], description: '', caused_by: '', corrective_action: '',
      date_presented: todayISO(), date_resolved: '',
    };
    _issSel = null;
    _issNewFromLessons = false;
    _issPrevMode = (_issMode === 'detail') ? _issPrevMode : _issMode;
    _issMode = 'detail';
    if (screen !== 'issues') switchScreen('issues'); else { syncChrome(); renderIssues(); }
    var el = $('il-issues-view'); var f = el && el.querySelector('[data-f="description"]');
    if (f) f.focus();
  }

  // ⚠️ ITEM #15: "+ New Lesson" on the Lessons Learned screen. A lesson captured without
  // going through Issues first is still a real issue that reached Closed — it just skips
  // the visible Open/On-Hold steps, and every field an ordinary issue requires (Issue,
  // Caused By, Champion, Department, Date Presented) is required here too, PLUS the
  // Closure Report and the Lessons Learned text (see the `_forceClose` branch of
  // `issDetailHTML`/`saveIssue`). This reuses the Issues detail form and its validation
  // rather than building a second, parallel "closed issue" editor that could drift from it.
  function newLessonAsClosedIssue() {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    if (!canAdd) return;
    _issNew = {
      // ⚠️ ITEM 2: date_resolved is pre-filled to today, NOT left blank — this draft is
      // ALREADY Closed (forceClose), so unlike an ordinary new (Open) issue, "Date
      // Resolved" is a real, required field here from the start. Editable if it wasn't today.
      status: 'Open', _forceClose: true, _lessonText: '',
      department: (profile && profile.department) || '',
      champion: '', champion_ids: [], description: '', caused_by: '',
      closure_report: '', date_presented: todayISO(), date_resolved: todayISO(),
    };
    _issSel = null;
    _issNewFromLessons = true;
    _issPrevMode = 'log';
    _issMode = 'detail';
    switchScreen('issues');
    var el = $('il-issues-view'); var f = el && el.querySelector('[data-f="description"]');
    if (f) f.focus();
  }

  function issFormValues() {
    var host = $('il-issues-view'), out = {};
    if (!host) return out;
    host.querySelectorAll('.il-if').forEach(function (f) { out[f.dataset.f] = f.value; });
    return out;
  }

  // Reads the Champion picker out of the DOM. ⚠️ Returns BOTH halves together —
  // building `champion` from the ids at one call site and the free text at
  // another is how the two would drift apart.
  function issChampion() {
    var host = $('il-issues-view');
    var root = host && host.querySelector('[data-people="iss-champ"]');
    if (!root) {                       // read-only renders text, not a control
      var r = _issNew || rows.find(function (x) { return x.id === _issSel; }) || {};
      return { ids: r.champion_ids || [], text: championExtra(r.champion_ids, r.champion) };
    }
    var free = root.querySelector('.il-pp-free');
    return { ids: idsOf(root), text: free ? free.value.trim() : '' };
  }

  // ⚠️ ITEM #8: every field of the issue is required — shared by the initial save AND every
  // "Update Issue" on an existing one, so an edit cannot silently blank a required field
  // either. Returns an error string, or null when everything required is present.
  function validateIssueCommon(v, ch) {
    if (!v.department) return 'Department is required.';
    if (!ch.ids.length && !ch.text) return 'At least one champion is required.';
    if (!(v.description || '').trim()) return 'The Issue field is required.';
    if (!(v.caused_by || '').trim()) return 'Caused By is required.';
    if (!v.date_presented) return 'Date Presented is required.';
    return null;
  }

  async function saveIssue() {
    var v = issFormValues();
    var ch = issChampion();
    var forceClose = !!(_issNew && _issNew._forceClose);
    var status = forceClose ? 'Closed'
      : (_issNew ? 'Open' : ((rows.find(function (x) { return x.id === _issSel; }) || {}).status || 'Open'));
    var err = validateIssueCommon(v, ch);
    if (!err && status === 'Open' && !(v.corrective_action || '').trim()) err = 'Corrective Action is required.';
    if (!err && status === 'On Hold' && !(v.hold_reason || '').trim()) err = 'Reason for Hold is required.';
    if (!err && status === 'Closed' && !(v.closure_report || '').trim()) err = 'Closure Report is required.';
    // ⚠️ ITEM 2: required only once the issue IS Closed (forceClose, or "Update Issue" on
    // an already-closed one) — never on an ordinary Add, which starts Open and has no
    // Date Resolved field on screen at all (see issDetailHTML's status-panel gate above).
    if (!err && status === 'Closed' && !v.date_resolved) err = 'Date Resolved is required.';
    // ⚠️ ITEM #15's standalone-lesson requirement: a lesson is required too, in the SAME step.
    if (!err && forceClose && !(v._lessonText || '').trim()) err = 'Lessons Learned is required.';
    if (err) { UI.toast(err, 'warn'); return; }
    var data = {
      project_id:     pid,
      type:           'Issue',
      status:         status,
      department:     v.department || null,
      champion_ids:   ch.ids,
      champion:       championText(ch.ids, ch.text),
      description:    (v.description || '').trim(),
      caused_by:      (v.caused_by || '').trim(),
      date_presented: v.date_presented || null,
      // Only ever set while Closed (the form has no Date Resolved field otherwise, so
      // `v.date_resolved` is simply absent) — and, now that it's required above, always
      // has a value by the time we get here.
      date_resolved:  status === 'Closed' ? (v.date_resolved || null) : null,
      updated_at:     new Date().toISOString(),
    };
    if (status === 'Open') data.corrective_action = (v.corrective_action || '').trim();
    else if (status === 'On Hold') data.hold_reason = (v.hold_reason || '').trim();
    else if (status === 'Closed') data.closure_report = (v.closure_report || '').trim();
    try {
      if (_issNew) {
        data.created_by = UID;               // REQUIRED for RLS
        var ins = await sb().from(TABLE).insert(data).select().single();
        if (ins.error) throw ins.error;
        rows.unshift(ins.data);
        _issNew = null; _issSel = ins.data.id;
        if (window.PDSync) PDSync.cachePut(PID_PFX + ':' + pid, rows);
        populateFilterOptions();
        logHistory(ins.data.id, pid, forceClose ? 'close' : 'create', null, forceClose ? data.closure_report : null);
        if (forceClose) {
          try {
            var lrow = {
              project_id: pid, issue_id: ins.data.id, mom_id: null,
              department: data.department,
              lesson: (v._lessonText || '').trim(), recommendation: null,
              date_captured: data.date_resolved, created_by: UID,
            };
            var lins = await sb().from(LESSON_TABLE).insert(lrow).select().single();
            if (!lins.error) LESSONS.unshift(lins.data);
            else UI.toast('Lesson logged as a closed issue, but the lesson record could not be saved: ' + lins.error.message, 'warn');
          } catch (e2) { UI.toast('Lesson logged as a closed issue, but the lesson record could not be saved: ' + (e2.message || ''), 'warn'); }
          UI.toast('Lesson captured', 'ok');
          _issNewFromLessons = false;
          switchScreen('lessons');
          return;
        }
        UI.toast('Issue logged', 'ok');
        renderIssues();
      } else {
        var r = rows.find(function (x) { return x.id === _issSel; });
        if (!r) return;
        if (!canEditRow(r)) { UI.toast('This issue was raised by someone else — ask a planner to change it.', 'warn'); return; }
        var before = Object.assign({}, r);   // ⚠️ snapshot BEFORE mutating — item #11's history
        Object.assign(r, data);   // optimistic — applies whether online or queued offline
        if (window.PDSync) {
          var w = await PDSync.write({ table: TABLE, op: 'update', id: r.id, patch: data });
          if (!w.ok) throw (w.error || new Error('Save failed'));
          PDSync.cachePut(PID_PFX + ':' + pid, rows);
        } else {
          var upd = await sb().from(TABLE).update(data).eq('id', r.id);
          if (upd.error) throw upd.error;
        }
        populateFilterOptions();
        UI.toast('Saved', 'ok');
        logHistory(r.id, pid, 'update', before, null);
        renderIssues();
      }
    } catch (e) { UI.toast(e.message, 'error'); }
  }

  // ---- items #10, #12: Put On Hold — requires a reason, replaces the old status <select> --
  async function confirmHoldIssue() {
    var note = (_issHoldNote || '').trim();
    if (!note) { UI.toast('A reason for the hold is required.', 'warn'); return; }
    var r = rows.find(function (x) { return x.id === _issSel; });
    if (!r || !canEditRow(r)) { UI.toast('This issue was raised by someone else — ask a planner to change it.', 'warn'); return; }
    var before = Object.assign({}, r);
    var data = { status: 'On Hold', hold_reason: note, updated_at: new Date().toISOString() };
    try {
      Object.assign(r, data);
      if (window.PDSync) {
        var w = await PDSync.write({ table: TABLE, op: 'update', id: r.id, patch: data });
        if (!w.ok) throw (w.error || new Error('Save failed'));
        PDSync.cachePut(PID_PFX + ':' + pid, rows);
      } else {
        var upd = await sb().from(TABLE).update(data).eq('id', r.id);
        if (upd.error) throw upd.error;
      }
      populateFilterOptions();
      _issHoldOpen = false; _issHoldNote = '';
      UI.toast('Issue put on hold', 'ok');
      logHistory(r.id, pid, 'hold', before, note);
      renderIssues();
    } catch (e) { UI.toast(e.message, 'error'); }
  }

  // ---- items #10, #13, #15: Close Issue — requires BOTH a closure report AND a lessons
  // learned entry (which is what closes the loop with the Lessons Learned screen: closing
  // an issue is the ONLY way a lesson gets attached to it, and it always happens). ----
  async function confirmCloseIssue() {
    var report = (_issCloseDraft.report || '').trim();
    var lesson = (_issCloseDraft.lesson || '').trim();
    var dateResolved = _issCloseDraft.dateResolved || '';
    if (!report) { UI.toast('A closure report is required.', 'warn'); return; }
    if (!lesson) { UI.toast('A lessons learned entry is required to close an issue.', 'warn'); return; }
    // ⚠️ ITEM 2: asked for HERE, at the moment of closing — never on Add.
    if (!dateResolved) { UI.toast('Date Resolved is required to close an issue.', 'warn'); return; }
    var r = rows.find(function (x) { return x.id === _issSel; });
    if (!r || !canEditRow(r)) { UI.toast('This issue was raised by someone else — ask a planner to change it.', 'warn'); return; }
    var before = Object.assign({}, r);
    var data = {
      status: 'Closed', closure_report: report,
      date_resolved: dateResolved,
      updated_at: new Date().toISOString(),
    };
    try {
      Object.assign(r, data);
      if (window.PDSync) {
        var w = await PDSync.write({ table: TABLE, op: 'update', id: r.id, patch: data });
        if (!w.ok) throw (w.error || new Error('Save failed'));
        PDSync.cachePut(PID_PFX + ':' + pid, rows);
      } else {
        var upd = await sb().from(TABLE).update(data).eq('id', r.id);
        if (upd.error) throw upd.error;
      }
      populateFilterOptions();
      logHistory(r.id, pid, 'close', before, report);
      // ⚠️ The lesson is captured HERE, not through a separate "capture a lesson" step
      // (item #13's "no need for the capture a lesson button") — closing an issue always
      // produces exactly one lesson, linked back to it.
      try {
        var lrow = {
          project_id: pid, issue_id: r.id, mom_id: r.mom_id || null,
          department: r.department || null,
          lesson: lesson, recommendation: null, date_captured: data.date_resolved, created_by: UID,
        };
        var lins = await sb().from(LESSON_TABLE).insert(lrow).select().single();
        if (!lins.error) LESSONS.unshift(lins.data);
        else UI.toast('Issue closed, but the lesson could not be saved: ' + lins.error.message, 'warn');
      } catch (e2) { UI.toast('Issue closed, but the lesson could not be saved: ' + (e2.message || ''), 'warn'); }
      _issCloseOpen = false; _issCloseDraft = { report: '', lesson: '', dateResolved: '' };
      UI.toast('Issue closed', 'ok');
      renderIssues();
    } catch (e) { UI.toast(e.message, 'error'); }
  }

  function todayISO() {
    // Local date, not toISOString().slice(0,10) — east of Greenwich that is yesterday.
    var dt = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
  }

  function renderIssueKpis() {
    var open = rows.filter(function (r) { return (r.status || 'Open') === 'Open'; }).length;
    var hold = rows.filter(function (r) { return r.status === 'On Hold'; }).length;
    var closed = rows.filter(function (r) { return r.status === 'Closed'; }).length;
    var ages = rows.filter(function (r) { return (r.status || 'Open') !== 'Closed'; })
      .map(agingDays).filter(function (a) { return a != null; });
    var avg = ages.length ? Math.round(ages.reduce(function (s, a) { return s + a; }, 0) / ages.length) : 0;
    $('il-kpis').innerHTML =
      kpi('Total', rows.length, '') +
      kpi('Open', open, 'is-open') +
      kpi('On Hold', hold, 'is-hold') +
      kpi('Closed', closed, 'is-closed') +
      kpi('Avg aging (open)', avg + 'd', '');
  }
  function kpi(label, val, cls) {
    return '<div class="il-kpi ' + cls + '"><div class="il-kpi-val">' + val + '</div>' +
      '<div class="il-kpi-label">' + label + '</div></div>';
  }

  // ==========================================================================
  // LESSONS LEARNED — its own record, linked to what produced it
  // --------------------------------------------------------------------------
  // ⚠️ A LESSON IS NO LONGER THREE COLUMNS ON AN ISSUE. It used to be
  // `lesson_learned` / `lesson_category` / `recommendation` on `issues_lessons`, which
  // forced one lesson per issue, no lesson without an issue, and a capture form welded to
  // the issue form. It is now a row in `lessons_learned` carrying OPTIONAL links to the
  // issue, the meeting and the action item that produced it — see
  // migrations/2026-08-26-lessons-learned.sql.
  //
  // ⚠️ AN UNLINKED LESSON IS A LEGITIMATE RECORD, not a broken one. Meetings produce
  // lessons nobody logged as a problem, and a lesson brought from another project has no
  // issue in THIS register at all. Nothing in the UI may require a link.
  //
  // ⚠️ LEGACY FALLBACK. Until the migration is run there is no table, so the library is
  // rebuilt read-only from the old columns and the screen says which file to run. Without
  // this, running the app before the migration would report a project's whole lessons
  // history as empty — which reads as data loss.
  // ==========================================================================

  // ==========================================================================
  // PEOPLE PICKER — Champion (issues) and Responsible (meeting action items)
  // --------------------------------------------------------------------------
  // ⚠️ HYBRID BY DESIGN: ids AND text, both written on every save.
  //   * The IDS are what make "show me what I own" answerable. A typed name
  //     cannot be resolved to an account, and this register already contains
  //     "Ronquillo, Jules Norman; Agcaoili, Heherson" — no equality test will
  //     ever match that against a login.
  //   * The TEXT is kept because not every champion has an account (a
  //     subcontractor's engineer is named on an issue and will never log in),
  //     because every existing row's champion is text, and because a printed
  //     sheet shows names rather than uuids.
  // The app writes both from one control, so they cannot disagree.
  //
  // ⚠️ THE SELECTION LIVES IN THE DOM (`data-ids` on the root), not in a module
  // variable. Two pickers can be on screen at once (several action items), and
  // a partial re-render of one must not disturb the other — nor lose text the
  // planner has typed into a neighbouring field, which a full re-render would.
  // ==========================================================================
  var PEOPLE = [];

  function peopleById() {
    var by = {};
    PEOPLE.forEach(function (p) { by[p.id] = p; });
    return by;
  }
  // ⚠️ An id that no longer resolves is reported as "Unknown person", never
  // dropped. It means the person left; showing fewer champions than the row
  // records would silently misstate who owns the work.
  function peopleNamesOf(ids) {
    var by = peopleById();
    return (ids || []).map(function (id) {
      var p = by[id]; return (p && p.name) ? p.name : 'Unknown person';
    });
  }
  // The display string the register/PDF/export read. Named people first, then
  // anyone typed in free text, joined the way the existing data already reads.
  function championText(ids, extra) {
    var parts = peopleNamesOf(ids);
    var t = (extra || '').trim();
    if (t) parts.push(t);
    return parts.join('; ');
  }
  // ⚠️ THE INVERSE OF championText — reconstructs just the free-typed portion from a
  // stored `champion` string, for RE-SEEDING the picker's free-text box on render.
  // `champion` on a saved row is already `championText(ids, extra)` — names AND extra,
  // joined. Feeding that whole string back into the free-text input (as the editable
  // picker used to) means the next save re-prepends the same names on top of it via
  // championText again, and the one after that prepends them AGAIN onto the already-
  // doubled result — the reported "concatenates every time Update is clicked" bug.
  // Strips out any segment that exactly matches one of the CURRENTLY resolved names for
  // `ids` (not by position, so it survives ids being reordered) and keeps the rest —
  // which is the actual typed extra, including legacy free-text-only data where `ids`
  // is empty and every segment survives untouched.
  function championExtra(ids, champion) {
    var named = {};
    peopleNamesOf(ids).forEach(function (n) { named[n] = 1; });
    return (champion || '').split(';')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s && !named[s]; })
      .join('; ');
  }
  function idsOf(root) {
    var v = (root && root.dataset.ids) || '';
    return v ? v.split(',').filter(Boolean) : [];
  }
  // ⚠️ ITEM 5: log/summary VIEWS show only the MOST RECENTLY assigned champion, not the
  // full joined history every prior champion — that full history is still what the
  // detail view's editable picker shows (it's what's needed to edit it), but a list
  // scanning many rows reads as noise once a champion column tries to also be an
  // ownership log. `champion_ids` is push-ordered (wirePeople's add handler always
  // appends), so the LAST id is the most recently assigned account; for a legacy
  // free-text-only champion (`champion_ids` empty), the last `;`-separated segment of
  // the joined string is the closest available reading of "who is on it now".
  function latestChampionText(r) {
    var ids = (r && r.champion_ids) || [];
    if (ids.length) {
      var names = peopleNamesOf([ids[ids.length - 1]]);
      if (names[0]) return names[0];
    }
    var parts = ((r && r.champion) || '').split(';').map(function (s) { return s.trim(); }).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  // ⚠️ The qualifier is the COMPANY for a contact and the DEPARTMENT for an
  // account. Two people called Cruz are told apart by who they work for, and for
  // someone outside Megawide the department field is usually empty anyway.
  function personLabel(p) {
    var q = (p.kind === 'contact' ? (p.company || p.department) : p.department) || '';
    return (p.name || '(unnamed)') + (q ? ' · ' + q : '');
  }

  function peopleOptionsHTML(chosen) {
    var taken = {}; (chosen || []).forEach(function (i) { taken[i] = 1; });
    var list = PEOPLE.filter(function (p) { return !taken[p.id]; });
    // ⚠️ The select is rendered even when the roster is EMPTY, because it now
    // carries the way to add somebody. Returning '' on an empty list — as it did
    // before the directory existed — would hide the only route on exactly the
    // project that most needs it.
    return '<select class="pd-select pd-input-sm il-pp-add">' +
      '<option value="">' + (list.length ? '+ add a person…' : '+ add someone…') + '</option>' +
      list.map(function (p) {
        return '<option value="' + Fmt.esc(p.id) + '">' + Fmt.esc(personLabel(p)) +
          (p.kind === 'contact' ? ' (no account)' : '') + '</option>';
      }).join('') +
      // ⚠️ Deliberately the LAST option and clearly separated: creating a person is
      // a real write that everyone else then sees, so it must not be one keystroke
      // away from picking an existing colleague.
      '<option disabled>──────────</option>' +
      '<option value="__new__">＋ Someone without an account…</option>' +
    '</select>';
  }

  // The inline "new person" form. ⚠️ Inline, NOT a modal: the surrounding fields
  // are only read on Save, and this module already learned (the pop-up that was
  // deleted) that anything which repaints or overlays the form loses whatever the
  // planner had typed and not yet saved.
  function newPersonHTML() {
    return '<div class="il-pp-new">' +
      '<div class="il-pp-newrow">' +
        '<input class="pd-input pd-input-sm il-pp-nname" placeholder="Full name" />' +
        '<input class="pd-input pd-input-sm il-pp-nco" placeholder="Company or department" />' +
      '</div>' +
      '<div class="il-pp-newact">' +
        '<button type="button" class="pd-btn pd-btn-sm pd-btn-primary il-pp-nadd">Add person</button>' +
        '<button type="button" class="pd-btn pd-btn-sm il-pp-ncancel">Cancel</button>' +
        '<span class="il-pp-nnote">Saved once and offered to everyone from now on. ' +
          'They have no login, so this work will not appear on a My Work page.</span>' +
      '</div>' +
    '</div>';
  }

  // `key` only has to be unique among the pickers rendered at the same time.
  function peoplePickerHTML(key, ids, text, ro, newOpen) {
    ids = (ids || []).filter(Boolean);
    var names = peopleNamesOf(ids);
    if (ro) {
      var shown = championText(ids, text);
      return '<div class="il-mi-val' + (shown ? '' : ' is-empty') + '">' +
        (shown ? Fmt.esc(shown) : '—') + '</div>';
    }
    return '<div class="il-people" data-people="' + Fmt.esc(key) + '" data-ids="' + Fmt.esc(ids.join(',')) + '"' +
      (newOpen ? ' data-new="1"' : '') + '>' +
      (ids.length
        ? '<div class="il-pp-chips">' + (function () {
            var by = peopleById();
            return ids.map(function (id, i) {
              // ⚠️ A person with no account is MARKED on the chip. The planner
              // assigning the work has to be able to see, at a glance, that this
              // item will never surface on anyone's personal view — the two kinds
              // of champion look identical otherwise.
              var p = by[id] || {};
              var contact = p.kind === 'contact';
              return '<span class="il-pp-chip' + (contact ? ' is-contact' : '') + '"' +
                (contact ? ' title="No account on the dashboard"' : '') + '>' +
                Fmt.esc(names[i]) +
                (contact ? '<span class="il-pp-noacct">no account</span>' : '') +
                '<button type="button" class="il-pp-rm" data-rm="' + Fmt.esc(id) + '" title="Remove">✕</button></span>';
            }).join('');
          })() + '</div>'
        : '') +
      peopleOptionsHTML(ids) +
      (newOpen ? newPersonHTML() : '') +
      // ⚠️ The free-text box is NOT a fallback for a missing roster — it is how
      // someone without an account gets named. Its own label says so, or a
      // planner reasonably assumes the dropdown is the only valid route.
      '<input class="pd-input pd-input-sm il-pp-free" value="' + Fmt.esc(text || '') + '" ' +
        'placeholder="Others not on the system (typed)">' +
    '</div>';
  }

  // Rebuilds ONE picker in place and re-wires it. ⚠️ Never re-renders the whole
  // form: the surrounding fields are only read on Save, so a full repaint would
  // discard whatever the planner had typed but not yet saved.
  function repaintPicker(root, onChange, newOpen) {
    var key = root.dataset.people;
    var ids = idsOf(root);
    var free = root.querySelector('.il-pp-free');
    var text = free ? free.value : '';
    // ⚠️ A half-typed new person survives the repaint that removing a chip causes.
    // Losing it would make the two controls fight each other.
    var nn = root.querySelector('.il-pp-nname'), nc = root.querySelector('.il-pp-nco');
    var keepN = nn ? nn.value : '', keepC = nc ? nc.value : '';
    if (newOpen === undefined) newOpen = root.dataset.new === '1';
    var holder = document.createElement('div');
    holder.innerHTML = peoplePickerHTML(key, ids, text, false, newOpen);
    var fresh = holder.firstChild;
    root.parentNode.replaceChild(fresh, root);
    if (newOpen) {
      var f1 = fresh.querySelector('.il-pp-nname'), f2 = fresh.querySelector('.il-pp-nco');
      if (f1) { f1.value = keepN; f1.focus(); }
      if (f2) f2.value = keepC;
    }
    wirePeople(fresh.parentNode, onChange);
    return fresh;
  }

  function wirePeople(scope, onChange) {
    if (!scope) return;
    scope.querySelectorAll('.il-people').forEach(function (root) {
      if (root._wired) return;
      root._wired = true;
      var fire = function () {
        if (onChange) onChange(root.dataset.people, idsOf(root),
          (root.querySelector('.il-pp-free') || {}).value || '');
      };
      var add = root.querySelector('.il-pp-add');
      if (add) add.onchange = function () {
        if (!add.value) return;
        // ⚠️ Opening the new-person form is NOT a selection — the select is reset
        // and nothing is added, or the sentinel id would end up in champion_ids
        // and resolve to "Unknown person" forever.
        if (add.value === '__new__') {
          add.value = '';
          repaintPicker(root, onChange, true);
          return;
        }
        var ids = idsOf(root);
        if (ids.indexOf(add.value) < 0) ids.push(add.value);
        root.dataset.ids = ids.join(',');
        var fresh = repaintPicker(root, onChange);
        if (onChange) onChange(fresh.dataset.people, idsOf(fresh),
          (fresh.querySelector('.il-pp-free') || {}).value || '');
      };

      // ---- The new-person form -------------------------------------------
      var nadd = root.querySelector('.il-pp-nadd');
      if (nadd) nadd.onclick = async function () {
        var nm = (root.querySelector('.il-pp-nname') || {}).value || '';
        var co = (root.querySelector('.il-pp-nco') || {}).value || '';
        if (!nm.trim()) { UI.toast('Enter a name for the person.', 'warn'); return; }
        nadd.disabled = true;
        var made;
        try {
          made = await PDb.createContact(nm, co, '', UID);
        } catch (e) {
          nadd.disabled = false;
          // ⚠️ The form is left OPEN with the typed name intact. Closing it on a
          // failure would throw the name away and the planner would have to work
          // out what had happened from a toast that has already gone.
          UI.toast('Could not add the person: ' + ((e && e.message) || e) +
            ' — if this names a missing table, run migrations/2026-08-28-people-directory.sql', 'error');
          return;
        }
        var ids = idsOf(root);
        // ⚠️ createContact returns the EXISTING row when the person is already in
        // the directory, so guard against adding the same id twice.
        if (ids.indexOf(made.id) < 0) ids.push(made.id);
        root.dataset.ids = ids.join(',');
        var fresh = repaintPicker(root, onChange, false);
        if (onChange) onChange(fresh.dataset.people, idsOf(fresh),
          (fresh.querySelector('.il-pp-free') || {}).value || '');
        UI.toast(made.name + ' added — everyone can pick them now.', 'ok');
      };
      var ncan = root.querySelector('.il-pp-ncancel');
      if (ncan) ncan.onclick = function () { repaintPicker(root, onChange, false); };
      root.querySelectorAll('.il-pp-rm').forEach(function (b) {
        b.onclick = function () {
          root.dataset.ids = idsOf(root).filter(function (i) { return i !== b.dataset.rm; }).join(',');
          var fresh = repaintPicker(root, onChange);
          if (onChange) onChange(fresh.dataset.people, idsOf(fresh),
            (fresh.querySelector('.il-pp-free') || {}).value || '');
        };
      });
      var free = root.querySelector('.il-pp-free');
      if (free) free.onchange = fire;
    });
  }

  var LESSON_TABLE = 'lessons_learned';

  function lessReset() {
    LESSONS = []; _lessLoaded = false; _lessErr = ''; _lessLegacy = false;
    _lessSel = null; _lessNew = null; _lessReport = false;
    _lessMode = 'log'; _lessPrevMode = 'log';
  }

  async function loadLessons() {
    _lessLoaded = true; _lessErr = ''; _lessLegacy = false;
    if (!pid) { LESSONS = []; return; }
    try {
      // ⚠️ Keyset-paginated (PDb.selectAll) — a plain .select() truncates at 1000 rows
      // server-side with no error, and a library accumulates for the life of the project.
      LESSONS = await PDb.selectAll(LESSON_TABLE, function (q) { return q.eq('project_id', pid); });
    } catch (e) {
      LESSONS = legacyLessons();
      _lessLegacy = true;
      _lessErr = (e && e.message) || 'load failed';
      return;
    }
    LESSONS.sort(lessonOrderCmp);   // manual sort_order first (item 2), else newest first
  }

  // The pre-migration shape, presented as read-only lessons so nothing disappears.
  // ⚠️ Ids are prefixed `legacy:` so they can never be mistaken for a real row and sent
  // to the database in an update.
  function legacyLessons() {
    return rows.filter(function (r) { return r.lesson_learned && r.lesson_learned.trim(); })
      .map(function (r) {
        return {
          id: 'legacy:' + r.id, project_id: r.project_id, issue_id: r.id, mom_id: r.mom_id || null,
          mom_item_id: null, department: r.department, category: r.lesson_category,
          lesson: r.lesson_learned, recommendation: r.recommendation,
          date_captured: r.date_resolved || r.date_presented, created_by: r.created_by, _legacy: true,
        };
      });
  }
  function isLegacyLesson(l) { return !!(l && (l._legacy || String(l.id || '').indexOf('legacy:') === 0)); }

  function lessonsOfIssue(id) {
    return id ? LESSONS.filter(function (l) { return l.issue_id === id; }) : [];
  }
  function lessonsOfMomItem(itemId) {
    return itemId ? LESSONS.filter(function (l) { return l.mom_item_id === itemId; }) : [];
  }

  // ⚠️ Mirrors the migration's policies. A lesson's author may edit AND delete it (unlike
  // an issue, which only a planner may delete): a lesson is something someone wrote down,
  // not the record of a problem having existed, and a duplicate is noise in a library
  // everyone reads. A lesson with no `created_by` is planner-only — there is no way to
  // know whose it was.
  function canEditLesson(l) {
    if (isLegacyLesson(l)) return false;
    if (isSteward) return true;
    return !!(canAdd && l && l.created_by && UID && l.created_by === UID);
  }

  function lessonsFiltered() {
    return LESSONS.filter(function (l) {
      if (lFilters.department && l.department !== lFilters.department) return false;
      if (lFilters.search) {
        var hay = [l.lesson, l.recommendation, l.department,
                   lessonSourceText(l)].join(' ').toLowerCase();
        if (hay.indexOf(lFilters.search) === -1) return false;
      }
      return true;
    });
  }

  // ⚠️ ITEM #15: "the lessons learned … are exclusively for closed issues only." A CLOSED
  // issue is where a lesson normally comes from now (closing one always requires and
  // creates a lesson — see confirmCloseIssue/saveIssue's `_forceClose` branch), so the
  // Lessons Dashboard/Log content is primarily THIS set, in the same shape Issues' own
  // Dashboard/Log use (department, champion, dates, aging-since-closed…).
  function closedIssuesFiltered() {
    return rows.filter(function (r) {
      if ((r.status || 'Open') !== 'Closed') return false;
      if (lFilters.department && r.department !== lFilters.department) return false;
      if (lFilters.search) {
        var hay = [r.description, r.caused_by, r.closure_report, r.champion, r.department]
          .join(' ').toLowerCase();
        if (hay.indexOf(lFilters.search) === -1) return false;
      }
      return true;
    });
  }
  // ⚠️ Lessons that do NOT correspond to a closed issue in this register — captured
  // straight from a meeting action item (item #23's auto-push), or a legacy row from
  // before this workflow existed. Kept visible rather than dropped: item #15 only scopes
  // NEW standalone lessons through the full issue-closure flow, it does not say these stop
  // existing.
  function standaloneLessonsFiltered() {
    return LESSONS.filter(function (l) {
      if (l.issue_id) return false;
      if (lFilters.department && l.department !== lFilters.department) return false;
      if (lFilters.search) {
        var hay = [l.lesson, l.recommendation, l.department, lessonSourceText(l)]
          .join(' ').toLowerCase();
        if (hay.indexOf(lFilters.search) === -1) return false;
      }
      return true;
    });
  }

  function renderLessons() {
    renderLessonKpis();
    var anyF = ['search', 'department'].some(function (k) { return lFilters[k]; });
    var clr = $('il-lclearfilters'); if (clr) clr.hidden = !anyF;
    // Item 1: the dot on the shared topbar funnel, only while Lessons is active.
    if (screen === 'lessons') { var ft = $('il-topfilttoggle'); if (ft) ft.classList.toggle('has-active', anyF); }
    var host = $('il-lessons-view'); if (!host) return;
    if (!pid) { host.innerHTML = ''; return; }
    // ⚠️ Just `log`/`detail` now — the analytics landing page moved out to its own
    // top-level tab (combined with Issues' — see renderDashboardScreen()).
    if (_lessMode === 'detail') renderLessonDetailView(host);
    else renderLessonsLogView(host);
    if (window.Icons) Icons.hydrate(host);
  }

  function migrateNoteHTML() {
    return _lessLegacy
      ? '<p class="il-mom-note">Showing lessons captured on issues before the library existed, ' +
        'read-only. Run <code>migrations/2026-08-26-lessons-learned.sql</code> to capture and edit ' +
        'lessons as records of their own.</p>'
      : '';
  }

  function renderLessonKpis() {
    var all = LESSONS;
    var linked = all.filter(function (l) { return l.issue_id || l.mom_id || l.mom_item_id; }).length;
    // Item 4: Department, not a separate "category" vocabulary — the same field an
    // issue already carries.
    var depts = {}; all.forEach(function (l) { if (l.department) depts[l.department] = 1; });
    $('il-lkpis').innerHTML =
      kpi('Lessons captured', all.length, '') +
      kpi('From a closed issue', linked, 'is-closed') +
      kpi('Departments', Object.keys(depts).length, '');
  }

  // ---- Lessons Log (items #6-analog, #15, #16) -------------------------------
  // ⚠️ SAME COLUMN SHAPE as the Issues log, with Corrective Action replaced by Closure
  // Report and a Lesson column — "similar in log content", per the owner's own wording —
  // PLUS a second section for lessons with no full issue behind them (kept, not dropped).
  function renderLessonsLogView(host) {
    host.classList.remove('il-mom-report');
    var closed = closedIssuesFiltered();
    var standalone = standaloneLessonsFiltered();
    // Item 2: a leading drag-handle column, present in both header and rows.
    var head = '<thead><tr><th class="il-dragcell"></th><th>No.</th><th>Department</th><th>Issue</th><th>Champion</th>' +
      '<th>Closure Report</th><th>Lesson</th><th>Date Resolved</th></tr></thead>';
    var body = closed.map(function (r, i) {
      var ls = lessonsOfIssue(r.id);
      var lessonTxt = ls.map(function (l) { return l.lesson; }).filter(Boolean).join(' · ');
      return '<tr data-open="' + Fmt.esc(r.id) + '" style="cursor:pointer;">' +
        '<td class="il-dragcell">' + dragGripHTML(r.id) + '</td>' +
        '<td class="il-cell-num">' + (i + 1) + '</td>' +
        '<td data-l="Department">' + Fmt.esc(r.department) + '</td>' +
        '<td class="il-cell-wrap" data-l="Issue"><div class="il-clip">' + Fmt.esc(r.description) + '</div></td>' +
        // Item 5: latest champion only, matching the Issues log.
        '<td class="il-champ" data-l="Champion">' + Fmt.esc(latestChampionText(r)) + '</td>' +
        '<td class="il-cell-wrap" data-l="Closure report"><div class="il-clip">' + Fmt.esc(r.closure_report) + '</div></td>' +
        '<td class="il-cell-wrap" data-l="Lesson"><div class="il-clip">' + Fmt.esc(lessonTxt) + '</div></td>' +
        '<td data-l="Resolved">' + Fmt.date(r.date_resolved) + '</td>' +
      '</tr>';
    }).join('');
    var table = '<div class="pd-card" style="padding:0;overflow:auto;"><table class="pd-table il-table" id="il-lessons-closed-table">' + head +
      '<tbody>' + (body || '<tr><td colspan="8" style="padding:24px;color:var(--pd-muted);">No closed issues match the current filters.</td></tr>') +
      '</tbody></table></div>';
    var standaloneSection = !standalone.length ? '' :
      '<h4 style="margin:18px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--pd-muted);">' +
        'Lessons captured without a full issue</h4>' +
      '<p class="il-mom-note">From a meeting action item, or captured before this workflow existed.</p>' +
      '<div class="il-lessons" id="il-lessons-standalone">' + standalone.map(lessonCardHTML).join('') + '</div>';
    host.innerHTML = migrateNoteHTML() + table + standaloneSection;
    host.querySelectorAll('tr[data-open]').forEach(function (tr) { tr.onclick = function () { openIssue(tr.dataset.open); }; });
    host.querySelectorAll('[data-open-lesson]').forEach(function (b) { b.onclick = function () { openLesson(b.dataset.openLesson); }; });
    host.querySelectorAll('[data-open-issue]').forEach(function (b) { b.onclick = function () { openIssue(b.dataset.openIssue); }; });
    // Item 2: drag-to-reorder — the closed-issues table shares issues_lessons' own
    // sort_order with the Issues log (they're the same rows); the standalone cards
    // reorder lessons_learned's sort_order instead.
    wireReorder(host.querySelector('#il-lessons-closed-table'), closed, rows, issueOrderCmp, TABLE);
    wireReorder(host.querySelector('#il-lessons-standalone'), standalone, LESSONS, lessonOrderCmp, LESSON_TABLE);
  }

  // ---- standalone-lesson detail (unchanged editor, now reached as a drill-down) ----
  function renderLessonDetailView(host) {
    host.classList.remove('il-mom-report');
    var cur = _lessNew || LESSONS.find(function (l) { return l.id === _lessSel; }) || null;
    host.innerHTML = migrateNoteHTML() +
      '<button class="il-backlink" id="il-less-back"><span data-ico="arrowLeft" data-ico-size="14"></span>Back to Lessons</button>' +
      (cur ? lessonDetailHTML(cur)
           : '<div class="il-empty" style="padding:28px;">Nothing to show — <button class="pd-btn pd-btn-sm" id="il-less-back2">go back</button>.</div>');
    wireLessons();
  }

  // What produced this lesson, said in one phrase. ⚠️ "Captured on its own" is a real
  // answer, never an apology for a missing link.
  function lessonSourceText(l) {
    if (!l) return '';
    if (l.issue_id) {
      var r = rows.find(function (x) { return x.id === l.issue_id; });
      return 'From an issue' + (r && r.description ? ': ' + clip(r.description, 60) : '');
    }
    if (l.mom_item_id || l.mom_id) {
      var m = MOM_BY_ID[l.mom_id];
      return 'From a meeting' + (m && m.title ? ': ' + m.title : '');
    }
    return 'Captured on its own';
  }

  function lessonCardHTML(l) {
    var src = lessonSourceText(l);
    // Item 2: reorderable unless it's a read-only legacy row (nothing to persist an
    // order onto — see isLegacyLesson()).
    var reorderAttrs = isLegacyLesson(l) ? ''
      : ' draggable="true" data-reorder="' + Fmt.esc(l.id) + '" title="Drag to reorder"';
    return '<div class="il-lcard il-reorderable"' + reorderAttrs + '>' +
      '<div class="il-lcard-top">' +
        // Item 4: department is the ONLY classification now — no separate "lesson
        // category" chip alongside it (see the LESSON_CATS removal note above).
        (l.department ? '<span class="il-chip">' + Fmt.esc(l.department) + '</span>' : '') +
        '<span class="il-lcard-date">' + (l.date_captured ? Fmt.date(l.date_captured) : '—') + '</span>' +
      '</div>' +
      '<div class="il-lcard-lesson">' + Fmt.esc(l.lesson) + '</div>' +
      (l.recommendation && l.recommendation.trim()
        ? '<div class="il-lcard-rec"><b>Recommendation:</b> ' + Fmt.esc(l.recommendation) + '</div>' : '') +
      '<div class="il-lcard-src"><span class="il-src-issue">' + Fmt.esc(src) + '</span></div>' +
      '<div class="il-lcard-acts">' +
        '<button class="il-lcard-open" data-open-lesson="' + Fmt.esc(l.id) + '">Open this lesson →</button>' +
        (l.issue_id && rows.some(function (x) { return x.id === l.issue_id; })
          ? '<button class="il-lcard-open" data-open-issue="' + Fmt.esc(l.issue_id) + '">Open the issue →</button>' : '') +
      '</div>' +
    '</div>';
  }

  function lessonDetailHTML(l) {
    var isNew = !l.id;
    var mayEdit = isNew ? canAdd : canEditLesson(l);
    var ro = !mayEdit || _lessReport, d = ro ? ' disabled' : '';
    // ⚠️ THE CHOSEN SOURCE IS UI INTENT AND MUST BE TRACKED, NOT DERIVED FROM THE IDS.
    // Deriving it looks right and is broken: picking "A meeting action item" clears the
    // issue link and leaves `mom_id` still null, so the re-render derived "Not linked" and
    // the Source select snapped straight back — the picker could never be reached from the
    // dropdown at all, only from a pre-filled "+ Capture a lesson". `_kind` is a transient
    // field on the in-memory object; `saveLesson` builds its payload from named columns, so
    // it is never written to the database.
    var linkKind = (l._kind !== undefined && l._kind !== null)
      ? l._kind
      : (l.issue_id ? 'issue' : ((l.mom_id || l.mom_item_id) ? 'mom' : ''));

    function opts(list, val, blank) {
      return (blank ? '<option value="">' + blank + '</option>' : '') +
        list.map(function (o) { return '<option' + (val === o ? ' selected' : '') + '>' + Fmt.esc(o) + '</option>'; }).join('');
    }

    return '<div class="il-mom-detail-card">' +
      '<div class="il-mom-toolbar">' +
        '<span class="il-mom-state' + (linkKind ? ' on' : '') + '">' +
          (isNew ? 'New lesson — not yet saved' : lessonSourceText(l)) + '</span>' +
        '<div style="flex:1;"></div>' +
        (isNew ? '' :
          '<button class="pd-btn pd-btn-sm' + (_lessReport ? ' is-active' : '') + '" id="il-less-report" ' +
            'title="Present this lesson as a clean read-only record">' +
            (_lessReport ? '✓ Reporting view' : 'Reporting view') + '</button>') +
      '</div>' +
      (isLegacyLesson(l)
        ? '<p class="il-mom-note" style="margin-top:0;">Captured on the issue itself, before lessons ' +
          'became records of their own. Run the migration named above to edit it here.</p>' : '') +

      '<div class="il-form-row">' +
        // Item 4: no separate "Lesson category" field — Department is the one
        // classification, same list and same field an issue already uses.
        '<div class="pd-field" style="flex:1 1 200px;">' +
          ilField(_lessReport, 'Department', 'il-c-dept',
            '<select class="pd-select pd-input-sm il-lf-fld" data-f="department"' + d + '>' +
            opts(DEPARTMENTS, l.department || '', '—') + '</select>', l.department) + '</div>' +
        '<div class="pd-field" style="flex:1 1 160px;">' +
          ilField(_lessReport, 'Date captured', 'il-c-date',
            '<input class="pd-input pd-input-sm il-lf-fld" data-f="date_captured" type="date" value="' +
            dateVal(l.date_captured) + '"' + d + '>',
            l.date_captured ? Fmt.date(l.date_captured) : '') + '</div>' +
      '</div>' +

      ilField(_lessReport, 'Lesson learned', 'il-c-lesson',
        '<textarea class="pd-textarea il-lf-fld" data-f="lesson" rows="4" ' +
        'placeholder="What did the team learn?"' + d + '>' + Fmt.esc(l.lesson) + '</textarea>', l.lesson) +
      ilField(_lessReport, 'Recommendation', 'il-c-rec',
        '<textarea class="pd-textarea il-lf-fld" data-f="recommendation" rows="3" ' +
        'placeholder="What should be done differently next time?"' + d + '>' +
        Fmt.esc(l.recommendation) + '</textarea>', l.recommendation) +

      // ---- what produced it -------------------------------------------------
      // ⚠️ Every link is OPTIONAL and "Not linked" is the first option, not a fallback.
      '<div class="il-mom-actions"><h4>What produced this lesson</h4>' +
        '<p>Link it to the issue or the meeting action item it came from — or leave it ' +
        'unlinked, which is a legitimate record. The lesson stays in the library either way.</p>' +
        (ro
          ? '<div class="il-mi-val">' + Fmt.esc(lessonSourceText(l)) + '</div>'
          : '<div class="il-form-row">' +
              '<div class="pd-field" style="flex:0 0 180px;"><label>Source</label>' +
                '<select class="pd-select pd-input-sm" id="il-less-kind">' +
                  '<option value=""' + (linkKind ? '' : ' selected') + '>Not linked</option>' +
                  '<option value="issue"' + (linkKind === 'issue' ? ' selected' : '') + '>An issue or concern</option>' +
                  '<option value="mom"' + (linkKind === 'mom' ? ' selected' : '') + '>A meeting action item</option>' +
                '</select></div>' +
              (linkKind === 'issue'
                ? '<div class="pd-field" style="flex:1 1 260px;"><label>Issue</label>' +
                  '<select class="pd-select pd-input-sm" id="il-less-issue">' +
                    '<option value="">— pick an issue —</option>' +
                    rows.map(function (r) {
                      return '<option value="' + Fmt.esc(r.id) + '"' + (l.issue_id === r.id ? ' selected' : '') + '>' +
                        Fmt.esc(clip(r.description, 70) || '(no issue text)') + '</option>';
                    }).join('') + '</select></div>'
                : '') +
              (linkKind === 'mom' ? momLinkPickerHTML(l) : '') +
            '</div>') +
      '</div>' +

      (ro ? '' :
        '<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
          (isNew
            ? '<button class="pd-btn pd-btn-sm" id="il-less-cancel">Cancel</button>'
            : '<button class="pd-btn pd-btn-sm pd-btn-danger" id="il-less-del">Delete lesson…</button>') +
          '<div style="flex:1;"></div>' +
          '<button class="pd-btn pd-btn-primary pd-btn-sm" id="il-less-save">' +
            (isNew ? 'Save lesson' : 'Save changes') + '</button></div>') +
    '</div>';
  }

  // ⚠️ The minutes load lazily (most sessions never open them), so the picker asks for
  // them on demand rather than assuming they are in hand — otherwise linking a lesson to a
  // meeting would offer an empty list on a project full of minutes.
  function momLinkPickerHTML(l) {
    if (!_momLoaded) { loadMoms().then(function () { renderLessons(); }); return '<div class="pd-field" style="flex:1 1 260px;"><label>Meeting</label><div class="il-mi-val">Loading minutes…</div></div>'; }
    var items = l.mom_id ? momItemsOf(l.mom_id) : [];
    return '<div class="pd-field" style="flex:1 1 240px;"><label>Meeting</label>' +
      '<select class="pd-select pd-input-sm" id="il-less-mom">' +
        '<option value="">— pick a meeting —</option>' +
        MOMS.map(function (m) {
          return '<option value="' + Fmt.esc(m.id) + '"' + (l.mom_id === m.id ? ' selected' : '') + '>' +
            Fmt.esc(m.title || '(untitled)') + (m.meeting_date ? ' · ' + Fmt.esc(Fmt.date(m.meeting_date)) : '') +
            '</option>';
        }).join('') + '</select></div>' +
      '<div class="pd-field" style="flex:1 1 240px;"><label>Action item <small style="font-weight:400;color:var(--pd-muted);">— optional</small></label>' +
        '<select class="pd-select pd-input-sm" id="il-less-momitem"' + (items.length ? '' : ' disabled') + '>' +
          '<option value="">— the meeting as a whole —</option>' +
          items.map(function (it) {
            var txt = it.action_item || it.description || it.issue || '(no action text)';
            return '<option value="' + Fmt.esc(it.id) + '"' + (l.mom_item_id === it.id ? ' selected' : '') + '>' +
              Fmt.esc((it.item_no ? it.item_no + '. ' : '') + clip(txt, 60)) + '</option>';
          }).join('') + '</select></div>';
  }

  function wireLessons() {
    var host = $('il-lessons-view'); if (!host) return;
    var back = host.querySelector('#il-less-back'); if (back) back.onclick = backFromLessonDetail;
    var back2 = host.querySelector('#il-less-back2'); if (back2) back2.onclick = backFromLessonDetail;
    var nb = host.querySelector('#il-less-new'); if (nb) nb.onclick = function () { newLesson(null); };
    var rep = host.querySelector('#il-less-report');
    if (rep) rep.onclick = function () { _lessReport = !_lessReport; renderLessons(); };
    var sv = host.querySelector('#il-less-save'); if (sv) sv.onclick = saveLesson;
    var cn = host.querySelector('#il-less-cancel');
    if (cn) cn.onclick = function () { _lessNew = null; backFromLessonDetail(); };
    var dl = host.querySelector('#il-less-del'); if (dl) dl.onclick = delLesson;

    // The link pickers re-render, because changing the source changes which controls exist.
    // ⚠️ Whatever has been typed is captured into the draft/edit buffer FIRST, or changing
    // the source would throw away the lesson text.
    function editing() {
      return _lessNew || LESSONS.find(function (x) { return x.id === _lessSel; });
    }
    var kind = host.querySelector('#il-less-kind');
    if (kind) kind.onchange = function () {
      var l = editing(); if (!l) return;
      captureLessonFields(l);
      l._kind = kind.value;               // remember the INTENT, before any id exists
      if (kind.value === 'issue') { l.mom_id = null; l.mom_item_id = null; }
      else if (kind.value === 'mom') { l.issue_id = null; }
      else { l.issue_id = null; l.mom_id = null; l.mom_item_id = null; }
      renderLessons();
    };
    var isel = host.querySelector('#il-less-issue');
    if (isel) isel.onchange = function () {
      var l = editing(); if (!l) return; captureLessonFields(l);
      l.issue_id = isel.value || null; renderLessons();
    };
    var msel = host.querySelector('#il-less-mom');
    if (msel) msel.onchange = function () {
      var l = editing(); if (!l) return; captureLessonFields(l);
      l.mom_id = msel.value || null; l.mom_item_id = null; renderLessons();
    };
    var isel2 = host.querySelector('#il-less-momitem');
    if (isel2) isel2.onchange = function () {
      var l = editing(); if (!l) return; captureLessonFields(l);
      l.mom_item_id = isel2.value || null;
    };
    host.querySelectorAll('.il-lf-fld').forEach(function (f) {
      f.oninput = f.onchange = function () {
        var l = editing(); if (l) l[f.dataset.f] = f.value;
      };
    });
  }

  // ⚠️ Reads the form into the object in hand. For an EXISTING lesson this mutates the
  // loaded row optimistically — the same shape the register's save uses — so a re-render
  // triggered by a link change cannot lose typed text. Nothing is written until Save.
  function captureLessonFields(l) {
    var host = $('il-lessons-view'); if (!host) return;
    host.querySelectorAll('.il-lf-fld').forEach(function (f) { l[f.dataset.f] = f.value; });
  }

  // `link` pre-fills the source, so "Capture a lesson" from an issue or a meeting action
  // item arrives already pointing at what produced it.
  function newLesson(link) {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    if (!canAdd) return;
    if (_lessLegacy) {
      UI.toast('Run migrations/2026-08-26-lessons-learned.sql before capturing lessons.', 'warn');
      return;
    }
    _lessNew = {
      department: (link && link.department) || (profile && profile.department) || '',
      lesson: '', recommendation: '', date_captured: todayISO(),
      issue_id: (link && link.issue_id) || null,
      mom_id: (link && link.mom_id) || null,
      mom_item_id: (link && link.mom_item_id) || null,
    };
    _lessPrevMode = (_lessMode === 'detail') ? _lessPrevMode : _lessMode;
    _lessSel = null; _lessMode = 'detail';
    if (screen !== 'lessons') switchScreen('lessons'); else { syncChrome(); renderLessons(); }
    var el = $('il-lessons-view'); var f = el && el.querySelector('[data-f="lesson"]');
    if (f) f.focus();
  }

  function openLesson(id) {
    _lessPrevMode = (_lessMode === 'detail') ? _lessPrevMode : _lessMode;
    _lessMode = 'detail'; _lessSel = id; _lessNew = null;
    if (screen !== 'lessons') switchScreen('lessons'); else { syncChrome(); renderLessons(); }
  }

  // "← Back" out of a lesson's detail view, to the Log (the only other mode now).
  function backFromLessonDetail() {
    if (_lessNew && !confirm('Discard the unsaved new lesson?')) return;
    _lessMode = _lessPrevMode || 'log';
    _lessSel = null; _lessNew = null;
    syncChrome(); renderLessons();
  }

  async function saveLesson() {
    var l = _lessNew || LESSONS.find(function (x) { return x.id === _lessSel; });
    if (!l) return;
    captureLessonFields(l);
    var data = {
      project_id:     pid,
      issue_id:       l.issue_id || null,
      mom_id:         l.mom_id || null,
      mom_item_id:    l.mom_item_id || null,
      department:     l.department || null,
      lesson:         (l.lesson || '').trim(),
      recommendation: (l.recommendation || '').trim(),
      date_captured:  l.date_captured || null,
      updated_at:     new Date().toISOString(),
    };
    if (!data.lesson) { UI.toast('The Lesson learned field is required', 'warn'); return; }
    try {
      if (_lessNew) {
        data.created_by = UID;             // REQUIRED for RLS
        var ins = await sb().from(LESSON_TABLE).insert(data).select().single();
        if (ins.error) throw ins.error;
        LESSONS.unshift(ins.data);
        _lessNew = null; _lessSel = ins.data.id;
        UI.toast('Lesson captured', 'ok');
      } else {
        if (!canEditLesson(l)) { UI.toast('This lesson was captured by someone else.', 'warn'); return; }
        var upd = await sb().from(LESSON_TABLE).update(data).eq('id', l.id);
        if (upd.error) throw upd.error;
        Object.assign(l, data);
        UI.toast('Saved', 'ok');
      }
      populateFilterOptions();
      render();
    } catch (e) {
      UI.toast(/relation|does not exist|schema cache/i.test(e.message || '')
        ? 'Run migrations/2026-08-26-lessons-learned.sql in Supabase first.' : e.message, 'error');
    }
  }

  async function delLesson() {
    var l = LESSONS.find(function (x) { return x.id === _lessSel; });
    if (!l || !canEditLesson(l)) return;
    if (!confirm('Delete this lesson? The issue or meeting it came from is not affected.')) return;
    var res = await sb().from(LESSON_TABLE).delete().eq('id', l.id);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    LESSONS = LESSONS.filter(function (x) { return x.id !== l.id; });
    _lessSel = null;
    UI.toast('Deleted', 'ok');
    populateFilterOptions();
    render();
  }

  function clip(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n).trim() + '…' : s;
  }

  // ⚠️ ONE field renderer for all three screens. In reporting mode a field renders as
  // TEXT, not as a control — a single-line <input> CLIPS its own value, so a long value was
  // unreadable in exactly the mode meant for reading it. Newlines survive as <br> because
  // the record is what was written, not a flattened paragraph. `extra` is appended INSIDE
  // the block because the reporting body itself contains a </div>, and splicing onto the
  // result would close the wrong one.
  function ilField(report, label, cls, control, raw, extra) {
    var body = report
      ? '<div class="il-mi-val' + (raw ? '' : ' is-empty') + '">' +
          (raw ? Fmt.esc(raw).replace(/\n/g, '<br>') : '—') + '</div>'
      : control;
    return '<div class="il-mi-f ' + cls + '"><label>' + label + '</label>' +
      body + (extra || '') + '</div>';
  }

  function dateVal(d) {
    if (!d) return '';
    var m = String(d).match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : '';
  }
  function champDatalist() {
    var seen = {};
    rows.forEach(function (r) { if (r.champion) seen[r.champion] = 1; });
    return Object.keys(seen).sort().map(function (c) {
      return '<option value="' + Fmt.esc(c) + '">';
    }).join('');
  }

  async function del(id) {
    if (!id) return;
    // ⚠️ The wording changed with the model, and the difference matters: lessons are their
    // own records with an `on delete set null` link, so they SURVIVE the issue. Saying
    // they are removed would be a false warning that stops people deleting a duplicate.
    var n = lessonsOfIssue(id).length;
    if (!confirm('Delete this issue? This cannot be undone.' +
      (n ? '\n\nThe ' + n + ' lesson' + (n === 1 ? '' : 's') + ' captured from it stay in the library, unlinked.' : ''))) return;
    var res = await sb().from(TABLE).delete().eq('id', id);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    if (_issSel === id) _issSel = null;
    UI.toast('Deleted', 'ok'); load();
  }


  // ==========================================================================
  // MINUTES OF MEETING — light read only.
  // --------------------------------------------------------------------------
  // Minutes of Meeting is now its OWN module (modules/minutes-of-meeting/) —
  // split out on the owner's explicit call. This module keeps only what the
  // LINK between the two still needs:
  //   - `momTag()` above (uses MOM_BY_ID, populated by load()'s own light
  //     fetch of meeting_minutes titles) — the register's "From MOM" tag.
  //   - MOMS / momItemsOf() below, read lazily by momLinkPickerHTML() (in the
  //     Lessons Learned section above) so a captured lesson can still be
  //     linked to "a meeting action item".
  // Everything else that used to live here — the meeting editor, distribute,
  // carry-over, raise/pull, attachments, the PDF export — moved wholesale to
  // the sibling module. This module never writes to meeting_minutes/mom_items.
  // ==========================================================================
  var MOMS = [], MOM_ITEMS = [], _momErr = '', _momLoaded = false;

  function momReset() {
    MOMS = []; MOM_ITEMS = []; _momErr = ''; _momLoaded = false;
  }

  // ⚠️ Loaded on first use (momLinkPickerHTML), not with the register: most
  // sessions never link a lesson to a meeting, and two extra round-trips on
  // every project switch is a cost paid by everyone for a link few use.
  async function loadMoms() {
    _momLoaded = true;
    if (!pid) { MOMS = []; MOM_ITEMS = []; return; }
    // ⚠️ Keyset-paginated (PDb.selectAll) — see the sibling module for why.
    try {
      MOMS = await PDb.selectAll('meeting_minutes', function (q) { return q.eq('project_id', pid); });
      MOM_ITEMS = await PDb.selectAll('mom_items', function (q) { return q.eq('project_id', pid); });
      _momErr = '';
    } catch (e) {
      MOMS = []; MOM_ITEMS = [];
      _momErr = (e && e.message) || 'load failed';
      return;
    }
    MOMS.sort(function (a, b) {                       // meeting_date desc, blanks last
      var x = a.meeting_date || '', y = b.meeting_date || '';
      if (!x !== !y) return x ? -1 : 1;
      if (x !== y) return y.localeCompare(x);
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
  }

  function momItemsOf(id) { return MOM_ITEMS.filter(function (x) { return x.mom_id === id; }); }

  return { init: init };
})();
