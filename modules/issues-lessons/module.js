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
  // ⚠️ TWO PRESENTATIONS OF ONE REGISTER, not two features. `report` reads ONE issue
  // the way the Power Apps "View Open Issues" screen reports it — a status panel beside
  // the issue / cause / corrective action — because that is what gets presented in a
  // meeting. `log` is the table, because scanning forty issues for the one you want is a
  // different job from reading one of them. Neither is a filter; both show the same set.
  var _issMode = 'report';             // 'report' | 'log'
  var _issSel = null;                  // id of the issue open in the detail pane
  // ⚠️ A NEW ISSUE IS A DRAFT IN MEMORY, NOT AN INSERTED ROW — deliberately UNLIKE
  // "+ New minutes", which inserts immediately and lets you type. It cannot work that way
  // here: `issues_lessons_del` is planner-only (2026-08-19-department-issues.sql), so a
  // department that mis-clicked "+ New issue" would leave a blank row in the register with
  // no way to remove it. The draft is written on Save and discarded on Cancel.
  var _issNew = null;
  var _issReport = false;              // reporting view (read-only presentation)
  var _issQ = '';                      // search inside the issue list

  // ---- Lessons Learned ------------------------------------------------------
  // A lesson is its OWN record now (table `lessons_learned`), linked to the issue and/or
  // the meeting that produced it — see migrations/2026-08-26-lessons-learned.sql for why
  // it stopped being three columns on the issue.
  var LESSONS = [], _lessLoaded = false, _lessErr = '', _lessLegacy = false;
  var _lessMode = 'report';            // 'report' | 'library'
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

  var iFilters = { search: '', status: '', department: '', champion: '', aging: '' };
  var lFilters = { search: '', department: '', category: '' };

  var DEPARTMENTS = ['PMO', 'Operations', 'Engineering', 'Design', 'QA/QC', 'Safety',
                     'Procurement', 'Commercial', 'Finance', 'Human Resources', 'MEP', 'External'];
  var STATUSES    = ['Open', 'On Hold', 'Closed'];
  var LESSON_CATS = ['Schedule', 'Cost', 'Quality', 'Safety', 'Design', 'Procurement',
                     'Contract', 'Communication', 'Resource', 'Stakeholder', 'Other'];

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

  // ========================================================================
  async function init(user, prof) {
    profile = prof;
    UID = (user && user.id) || (prof && prof.id) || null;
    _collabSelf = { id: UID, name: (prof && (prof.name || prof.email)) || 'Someone' };
    isSteward = ['super_admin', 'admin', 'planner'].indexOf(prof.role) >= 0;
    canAdd = !!prof && prof.status === 'approved' && prof.role !== 'viewer';
    canWrite = canAdd;

    // ⚠️ Deep link from My Work, and from the sibling Minutes of Meeting module's
    // "Capture lesson" / "N lessons" buttons: ?screen=issues|lessons. Read BEFORE
    // wire()/syncChrome(), which paint the tab strip from `screen` — set it
    // afterwards and the strip would say one thing while the module showed
    // another. An unknown or absent value leaves the default (Issues) untouched.
    try {
      var _q = new URLSearchParams(location.search).get('screen');
      if (_q === 'issues' || _q === 'lessons') screen = _q;
    } catch (e) { /* no URLSearchParams / opaque URL — keep the default */ }

    // ⚠️ Tolerant, and NOT awaited-into-failure: `getPeople()` returns [] when the
    // roster RPC is missing (migration not yet run), so the pickers fall back to
    // free text rather than the whole module refusing to load over a dropdown.
    try { PEOPLE = await PDb.getPeople(); } catch (e) { PEOPLE = []; }

    await loadProjects();
    wire();
    syncChrome();
    // Browser-history integration (UI.bindHistoryState, ui.js): without this the
    // Issues/Lessons tab strip never touches the URL, so the browser's native
    // Back button jumps straight past every screen switch to the module
    // launcher. Bound once here (after the ?screen= deep-link above has already
    // resolved the starting screen); switchScreen() itself does the DOM work, so
    // it doubles as apply(). Every place that changes `screen` also calls
    // histScreen.push() once (see wire()'s tab click handler).
    histScreen = UI.bindHistoryState({
      key: 'il_screen',
      get: function () { return { s: screen }; },
      apply: function (state) { switchScreen(state.s); }
    });
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

    // Issue filters
    ['search', 'status', 'department', 'champion', 'aging'].forEach(function (k) {
      var el = $('il-f-' + k);
      if (el) el.oninput = el.onchange = function () {
        iFilters[k] = (k === 'search') ? this.value.toLowerCase().trim() : this.value;
        renderIssues();
      };
    });
    $('il-clearfilters').onclick = function () {
      iFilters = { search: '', status: '', department: '', champion: '', aging: '' };
      ['search', 'status', 'department', 'champion', 'aging'].forEach(function (k) {
        var el = $('il-f-' + k); if (el) el.value = '';
      });
      renderIssues();
    };

    // Lesson filters
    ['search', 'department', 'category'].forEach(function (k) {
      var el = $('il-lf-' + k);
      if (el) el.oninput = el.onchange = function () {
        lFilters[k] = (k === 'search') ? this.value.toLowerCase().trim() : this.value;
        renderLessons();
      };
    });
    $('il-lclearfilters').onclick = function () {
      lFilters = { search: '', department: '', category: '' };
      ['search', 'department', 'category'].forEach(function (k) {
        var el = $('il-lf-' + k); if (el) el.value = '';
      });
      renderLessons();
    };

    $('il-new').onclick = function () {
      if (screen === 'issues') newIssue();
      else if (screen === 'lessons') newLesson(null);
    };
    $('il-refresh').onclick = function () {
      momReset();
      load();
    };

    // Report / Log presentation switch. One control, two screens — the second button's
    // label changes with the screen because "Log" and "Library" name different things.
    Array.prototype.forEach.call(document.querySelectorAll('#il-viewtoggle [data-view]'), function (b) {
      b.onclick = function () {
        if (screen === 'issues') _issMode = (b.dataset.view === 'log') ? 'log' : 'report';
        else if (screen === 'lessons') _lessMode = (b.dataset.view === 'log') ? 'library' : 'report';
        syncChrome();
        render();
      };
    });
  }

  function switchScreen(s) {
    screen = s;
    $('il-screen-issues').hidden = s !== 'issues';
    $('il-screen-lessons').hidden = s !== 'lessons';
    $('il-screen-title').textContent = s === 'lessons' ? 'Lessons Learned' : 'Issues & Concerns';
    Array.prototype.forEach.call(document.querySelectorAll('.il-tab[data-screen]'), function (b) {
      b.classList.toggle('active', b.dataset.screen === s);
    });
    syncChrome();
    render();
  }

  function syncChrome() {
    // ⚠️ `canAdd`, not `canWrite`: raising an issue is open to any approved non-viewer
    // (D1 — the DATABASE has always allowed it). Same rule for capturing a lesson.
    var showNew = canAdd && (screen === 'issues' || screen === 'lessons');
    var nb = $('il-new');
    nb.style.display = showNew ? '' : 'none';
    $('il-sep').style.display = showNew ? '' : 'none';
    if (showNew) {
      nb.textContent = screen === 'lessons' ? '+ New lesson' : '+ New issue';
      nb.title = screen === 'lessons' ? 'Capture a lesson learned' : 'Log a new issue';
    }

    // The presentation switch belongs to the two record screens (both remaining
    // ones use it now that Minutes of Meeting — which had its own Reporting view
    // on the minute itself — moved to its own module).
    var tg = $('il-viewtoggle');
    if (tg) {
      tg.hidden = false;
      var mode = screen === 'lessons' ? _lessMode : _issMode;
      var second = screen === 'lessons' ? 'library' : 'log';
      var lbl = $('il-view-log'); if (lbl) lbl.textContent = screen === 'lessons' ? 'Library' : 'Log';
      Array.prototype.forEach.call(tg.querySelectorAll('[data-view]'), function (b) {
        var isSecond = b.dataset.view === 'log';
        b.classList.toggle('on', isSecond ? (mode === second) : (mode === 'report'));
      });
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
    rows.sort(function (a, b) {   // date_presented desc (blanks last), then created_at desc
      var x = a.date_presented || '', y = b.date_presented || '';
      if (!x !== !y) return x ? -1 : 1;
      if (x !== y) return y.localeCompare(x);
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
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
    var depts = {}, champs = {}, cats = {};
    rows.forEach(function (r) {
      if (r.department) depts[r.department] = 1;
      if (r.champion) champs[r.champion] = 1;
    });
    // ⚠️ Lesson departments/categories come from the LESSONS table, not from the issues.
    // A lesson can be captured on a meeting or on nothing at all, so filtering the library
    // by the issues' vocabulary would hide every unlinked lesson's category.
    LESSONS.forEach(function (l) {
      if (l.department) depts[l.department] = 1;
      if (l.category) cats[l.category] = 1;
    });
    var deptList = Object.keys(depts).sort();
    fill($('il-f-status'), STATUSES, iFilters.status, 'All statuses');
    fill($('il-f-department'), deptList, iFilters.department, 'All departments');
    fill($('il-f-champion'), Object.keys(champs).sort(), iFilters.champion, 'All champions');
    fill($('il-lf-department'), deptList, lFilters.department, 'All departments');
    fill($('il-lf-category'), Object.keys(cats).sort(), lFilters.category, 'All categories');
  }

  function render() {
    if (screen === 'lessons') renderLessons();
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

  // Dispatcher. Both presentations run off `issuesFiltered()`, so the filter bar and the
  // KPIs mean the same thing in either — switching presentation never changes the set.
  function renderIssues() {
    renderIssueKpis();
    var anyF = ['search', 'status', 'department', 'champion', 'aging'].some(function (k) { return iFilters[k]; });
    var clr = $('il-clearfilters'); if (clr) clr.hidden = !anyF;
    var log = $('il-issues-log'), view = $('il-issues-view');
    if (log) log.hidden = _issMode !== 'log';
    if (view) view.hidden = _issMode === 'log';
    if (_issMode === 'log') renderIssuesLog(); else renderIssuesReport();
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
    var head = '<thead><tr>' +
      '<th>No.</th><th>Department</th><th>Issue</th><th>Caused By</th>' +
      '<th>Corrective Action</th><th>Champion</th><th>Status</th>' +
      '<th>Date Presented</th><th>Days Aging</th><th>Date Resolved</th>' +
      (canWrite ? '<th></th>' : '') + '</tr></thead>';

    var body = data.map(function (r, i) {
      var a = agingDays(r);
      var agingTxt = a == null ? '—' : (a + ' day' + (a === 1 ? '' : 's'));
      var hot = a != null && a > 90 && (r.status || 'Open') !== 'Closed';
      // data-l = the column heading. Unused on desktop (the <thead> supplies it);
      // at phone width module.css hides the head and stacks each row into a card,
      // where every value needs its own inline label (.il-table td::before).
      return '<tr>' +
        '<td class="il-cell-num">' + (i + 1) + '</td>' +
        '<td data-l="Department">' + Fmt.esc(r.department) + '</td>' +
        '<td class="il-cell-wrap il-cell-issue" data-l="Issue"><div class="il-clip">' + Fmt.esc(r.description) + '</div>' +
          (hasLesson(r) ? '<span class="il-lessontag"><span data-ico="bulb" data-ico-size="12"></span>Lesson captured</span>' : '') +
          momTag(r) +
        '</td>' +
        '<td class="il-cell-wrap" data-l="Caused by"><div class="il-clip">' + Fmt.esc(r.caused_by) + '</div></td>' +
        '<td class="il-cell-wrap" data-l="Corrective action"><div class="il-clip">' + Fmt.esc(r.corrective_action) + '</div></td>' +
        '<td class="il-champ" data-l="Champion">' + Fmt.esc(r.champion) + '</td>' +
        '<td data-l="Status"><span class="il-pill ' + statusClass(r.status) + '">' + Fmt.esc(r.status || 'Open') + '</span></td>' +
        '<td data-l="Presented">' + Fmt.date(r.date_presented) + '</td>' +
        '<td class="il-aging' + (hot ? ' is-hot' : '') + '" data-l="Aging">' + agingTxt + '</td>' +
        '<td data-l="Resolved">' + Fmt.date(r.date_resolved) + '</td>' +
        (canWrite ? '<td class="il-rowacts">' +
          (canEditRow(r)
            ? '<button class="il-iconbtn" title="Edit" data-edit="' + r.id + '">✎</button> '
            : '<span class="il-noedit" title="Raised by someone else — a planner maintains the register as a whole">—</span>') +
          (isSteward ? '<button class="il-iconbtn is-danger" title="Delete" data-del="' + r.id + '">🗑</button>' : '') +
          '</td>' : '') +
      '</tr>';
    }).join('');

    t.innerHTML = head + '<tbody>' + (body ||
      '<tr><td colspan="' + (canWrite ? 11 : 10) + '" style="padding:24px;color:var(--pd-muted);">No issues match the current filters.</td></tr>') +
      '</tbody>';

    // ⚠️ Editing from the log SWITCHES to the report view rather than opening a modal.
    // There is one editor for an issue now, and it is the detail pane — a second one would
    // be a second place for the fields to drift apart.
    t.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () { openIssue(b.dataset.edit); };
    });
    t.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () { del(b.dataset.del); };
    });
    if (window.Icons) Icons.hydrate(t);
  }

  // Open an issue in the report view (from the log, from a minute, from a lesson).
  function openIssue(id) {
    _issMode = 'report'; _issSel = id; _issNew = null;
    if (screen !== 'issues') switchScreen('issues');
    else { syncChrome(); renderIssues(); }
  }

  function issReset() {
    _issSel = null; _issNew = null; _issQ = ''; _issReport = false;
  }

  // ------------------------------------------------- Issues: report view -----
  // ⚠️ THIS IS THE POWER APPS "VIEW OPEN ISSUES" LAYOUT, and it is the point of the
  // screen: a status panel beside the issue / cause / corrective action, one record at a
  // time, readable aloud. The log is for finding a record; this is for reporting it.
  //
  // ⚠️ ONE renderer for read-only and editable, disabled by field rather than a second
  // markup path — two paths drift the moment either is touched (the same call the minutes
  // detail card documents).
  function renderIssuesReport() {
    var host = $('il-issues-view'); if (!host) return;
    if (!pid) {
      host.innerHTML = '<div class="pd-card" style="padding:24px;color:var(--pd-muted);">Select a project to see its issues.</div>';
      return;
    }
    var data = issuesFiltered();
    // ⚠️ The selection is validated against the FILTERED set, not just against `rows`: a
    // filter that hides the open issue must move the pane, or the reader is looking at a
    // record the list beside it says is not there.
    if (_issNew) _issSel = null;
    else if (!data.some(function (r) { return r.id === _issSel; })) _issSel = data.length ? data[0].id : null;

    var cur = _issNew || rows.find(function (r) { return r.id === _issSel; }) || null;
    var shown = issSearchList(data);

    host.classList.toggle('il-mom-report', _issReport);
    host.innerHTML =
      '<div class="il-mom-wrap"><div class="il-mom-list">' +
        '<div class="il-mom-head">Issues <span>' + data.length + '</span></div>' +
        (data.length > 6
          ? '<input class="pd-input pd-input-sm il-mom-search" id="il-iss-q" ' +
            'placeholder="Search these issues…" value="' + Fmt.esc(_issQ) + '">' : '') +
        (_issNew ? '<button class="il-mom-item on" data-iss="__new__">' +
          '<span class="il-mom-draft">New</span>Unsaved issue<small>Not yet in the register</small></button>' : '') +
        (shown.length ? shown.map(issListRowHTML).join('')
          : '<div class="il-empty" style="padding:14px;">' +
            (rows.length ? 'No issue matches the current filters.'
                         : 'No issues logged yet for this project.') + '</div>') +
        (canAdd ? '<button class="pd-btn pd-btn-sm pd-btn-primary" id="il-iss-new" style="width:100%;margin-top:8px;">+ New issue</button>' : '') +
      '</div><div class="il-mom-detail">' +
        (cur ? issDetailHTML(cur)
             : '<div class="il-empty" style="padding:28px;">' +
               (rows.length ? 'Pick an issue to read it.' : 'Nothing to show yet.') + '</div>') +
      '</div></div>';
    wireIssues();
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
  }

  function issSearchList(data) {
    var q = _issQ.trim().toLowerCase();
    if (!q) return data;
    return data.filter(function (r) {
      return [r.description, r.department, r.champion, r.caused_by, r.corrective_action]
        .join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }

  function issListRowHTML(r) {
    var a = agingDays(r);
    return '<button class="il-mom-item' + (r.id === _issSel ? ' on' : '') + '" data-iss="' + Fmt.esc(r.id) + '">' +
      '<span class="il-pill ' + statusClass(r.status) + ' il-iss-lpill">' + Fmt.esc(r.status || 'Open') + '</span>' +
      Fmt.esc(clip(r.description, 90) || '(no issue text)') +
      '<small>' + Fmt.esc(r.department || 'No department') +
      (a == null ? '' : ' · ' + a + 'd aging') +
      (lessonsOfIssue(r.id).length ? ' · lesson captured' : '') + '</small></button>';
  }

  function issDetailHTML(r) {
    var isNew = !r.id;
    var mayEdit = isNew ? canAdd : canEditRow(r);
    var ro = !mayEdit || _issReport, d = ro ? ' disabled' : '';
    var a = agingDays(r);
    var ls = isNew ? [] : lessonsOfIssue(r.id);

    function opts(list, val, blank) {
      return (blank ? '<option value="">' + blank + '</option>' : '') +
        list.map(function (o) { return '<option' + (val === o ? ' selected' : '') + '>' + Fmt.esc(o) + '</option>'; }).join('');
    }

    return '<div class="il-mom-detail-card il-iss-card">' +
      '<div class="il-mom-toolbar">' +
        '<span class="il-mom-state' + ((r.status || 'Open') === 'Closed' ? ' on' : '') + '">' +
          (isNew ? 'New issue — not yet saved' : 'Issue in the register') + '</span>' +
        '<div style="flex:1;"></div>' +
        // A VIEW control, offered to everyone who can read the issue — unlike every other
        // control on this card, which is gated on who may change the record.
        (isNew ? '' :
          '<button class="pd-btn pd-btn-sm' + (_issReport ? ' is-active' : '') + '" id="il-iss-report" ' +
            'title="Present this issue as a clean read-only record">' +
            (_issReport ? '✓ Reporting view' : 'Reporting view') + '</button>') +
      '</div>' +

      // ---- the Power Apps two-pane body -------------------------------------
      '<div class="il-iss-split">' +
        '<div class="il-iss-panel">' +
          ilField(_issReport, 'Status', 'il-c-status',
            '<select class="pd-select pd-input-sm il-if" data-f="status"' + d + '>' +
              opts(STATUSES, r.status || 'Open') + '</select>', r.status || 'Open') +
          ilField(_issReport, 'Department', 'il-c-dept',
            '<select class="pd-select pd-input-sm il-if" data-f="department"' + d + '>' +
              opts(DEPARTMENTS, r.department || '', '—') + '</select>', r.department) +
          // ⚠️ The picker replaces the old free-text box but does NOT drop free
          // text — it carries both, so a champion without an account is still
          // nameable and no existing value is lost on the next save.
          ilField(_issReport, 'Champion(s)', 'il-c-champ',
            peoplePickerHTML('iss-champ', r.champion_ids, r.champion, ro),
            championText(r.champion_ids, r.champion)) +
          ilField(_issReport, 'Date Presented', 'il-c-pres',
            '<input class="pd-input pd-input-sm il-if" data-f="date_presented" type="date" value="' +
              dateVal(r.date_presented) + '"' + d + '>',
            r.date_presented ? Fmt.date(r.date_presented) : '') +
          // ⚠️ DERIVED, never stored and never editable — 0 when Closed, else today minus
          // the date presented. A stored aging is wrong the next morning.
          '<div class="il-mi-f il-c-aging"><label>Days Aging</label>' +
            '<div class="il-mi-val' + (a != null && a > 90 && (r.status || 'Open') !== 'Closed' ? ' is-hot' : '') + '">' +
            (a == null ? '—' : a + ' day' + (a === 1 ? '' : 's')) + '</div></div>' +
          ilField(_issReport, 'Date Resolved', 'il-c-res',
            '<input class="pd-input pd-input-sm il-if" data-f="date_resolved" type="date" value="' +
              dateVal(r.date_resolved) + '"' + d + '>',
            r.date_resolved ? Fmt.date(r.date_resolved) : '') +
        '</div>' +

        '<div class="il-iss-body">' +
          ilField(_issReport, 'Issue', 'il-c-issue',
            '<textarea class="pd-textarea il-if" data-f="description" rows="4" ' +
              'placeholder="Describe the issue or concern…"' + d + '>' + Fmt.esc(r.description) + '</textarea>',
            r.description) +
          ilField(_issReport, 'Caused By', 'il-c-cause',
            '<textarea class="pd-textarea il-if" data-f="caused_by" rows="3" ' +
              'placeholder="Root cause…"' + d + '>' + Fmt.esc(r.caused_by) + '</textarea>', r.caused_by) +
          ilField(_issReport, 'Corrective Action', 'il-c-action',
            '<textarea class="pd-textarea il-if" data-f="corrective_action" rows="4" ' +
              'placeholder="Actions taken / planned…"' + d + '>' + Fmt.esc(r.corrective_action) + '</textarea>',
            r.corrective_action) +
          (isNew ? '' : '<div class="il-iss-prov">' + (momTag(r) || '') +
            '<span class="il-raisedby">' + Fmt.esc(raisedByLabel(r)) + '</span></div>') +
        '</div>' +
      '</div>' +

      // ---- lessons, as their own records ------------------------------------
      // ⚠️ NOT fields on this form any more. A lesson lives in `lessons_learned` and is
      // shown here because this issue produced it — one issue can produce several, and a
      // lesson outlives the issue. Editing one happens on the Lessons Learned screen.
      '<div class="il-mom-actions il-iss-lessons"><h4>Lessons learned from this issue</h4>' +
        '<p>A lesson is its own record in the library, linked back here. It stays there after ' +
        'this issue closes — which is the point of keeping it.</p>' +
        (ls.length
          ? '<div class="il-lessons il-lessons-inline">' + ls.map(lessonCardHTML).join('') + '</div>'
          : '<div class="il-empty" style="padding:12px;">No lesson captured from this issue yet.</div>') +
        (canAdd && !isNew && !_issReport
          ? '<div class="il-mom-addrow"><button class="pd-btn pd-btn-sm" id="il-iss-addlesson">+ Capture a lesson</button></div>'
          : '') +
      '</div>' +

      '<datalist id="il-champ-list">' + champDatalist() + '</datalist>' +

      (ro ? '' :
        '<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
          (isNew
            ? '<button class="pd-btn pd-btn-sm" id="il-iss-cancel">Cancel</button>'
            : (isSteward
                ? '<button class="pd-btn pd-btn-sm pd-btn-danger" id="il-iss-del">Delete issue…</button>'
                // Says why rather than showing a button the database would refuse: a
                // department raising an issue must not be able to make it disappear.
                : '<span class="il-raisedby" style="margin:0;">Closing an issue is a status. ' +
                  'Only a planner can delete it from the register.</span>')) +
          '<div style="flex:1;"></div>' +
          '<button class="pd-btn pd-btn-primary pd-btn-sm" id="il-iss-save">' +
            (isNew ? 'Save issue' : 'Save changes') + '</button></div>') +
    '</div>';
  }

  function wireIssues() {
    var host = $('il-issues-view'); if (!host) return;
    host.querySelectorAll('[data-iss]').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.iss === '__new__') return;
        // ⚠️ Leaving an unsaved draft is confirmed. The draft is in memory only, so
        // clicking another issue would otherwise discard typed work with no warning.
        if (_issNew && !confirm('Discard the unsaved new issue?')) return;
        _issNew = null; _issSel = b.dataset.iss; _issReport = false; renderIssues();
      };
    });
    var q = host.querySelector('#il-iss-q');
    if (q) q.oninput = function () {
      _issQ = q.value;
      var at = q.selectionStart; renderIssues();
      var n = $('il-iss-q'); if (n) { n.focus(); try { n.setSelectionRange(at, at); } catch (e) {} }
    };
    var nb = host.querySelector('#il-iss-new'); if (nb) nb.onclick = newIssue;
    var rep = host.querySelector('#il-iss-report');
    if (rep) rep.onclick = function () { _issReport = !_issReport; renderIssues(); };
    var sv = host.querySelector('#il-iss-save'); if (sv) sv.onclick = saveIssue;
    var cn = host.querySelector('#il-iss-cancel');
    if (cn) cn.onclick = function () { _issNew = null; renderIssues(); };
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
    broadcastCollabSel(_issNew ? null : _issSel, !_issReport);
  }

  function newIssue() {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    if (!canAdd) return;
    // ⚠️ Defaults from the raiser's PROFILE (D1). Typing the department every time invites
    // the typo that silently splits the register's own Department filter in two.
    _issNew = {
      status: 'Open',
      department: (profile && profile.department) || '',
      champion: '', champion_ids: [], description: '', caused_by: '', corrective_action: '',
      date_presented: todayISO(), date_resolved: '',
    };
    _issSel = null; _issMode = 'report'; _issReport = false;
    if (screen !== 'issues') switchScreen('issues'); else { syncChrome(); renderIssues(); }
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
    if (!root) {                       // reporting view renders text, not a control
      var r = _issNew || rows.find(function (x) { return x.id === _issSel; }) || {};
      return { ids: r.champion_ids || [], text: r.champion || '' };
    }
    var free = root.querySelector('.il-pp-free');
    return { ids: idsOf(root), text: free ? free.value.trim() : '' };
  }

  async function saveIssue() {
    var v = issFormValues();
    var ch = issChampion();
    var data = {
      project_id:        pid,
      type:              'Issue',
      status:            v.status || 'Open',
      department:        v.department || null,
      champion_ids:      ch.ids,
      champion:          championText(ch.ids, ch.text),
      description:       (v.description || '').trim(),
      caused_by:         (v.caused_by || '').trim(),
      corrective_action: (v.corrective_action || '').trim(),
      date_presented:    v.date_presented || null,
      date_resolved:     v.date_resolved || null,
      updated_at:        new Date().toISOString(),
    };
    if (!data.description) { UI.toast('The Issue field is required', 'warn'); return; }
    try {
      if (_issNew) {
        data.created_by = UID;               // REQUIRED for RLS
        var ins = await sb().from(TABLE).insert(data).select().single();
        if (ins.error) throw ins.error;
        rows.unshift(ins.data);
        _issNew = null; _issSel = ins.data.id;
        if (window.PDSync) PDSync.cachePut(PID_PFX + ':' + pid, rows);
        populateFilterOptions();
        UI.toast('Issue logged', 'ok');
        renderIssues();
      } else {
        var r = rows.find(function (x) { return x.id === _issSel; });
        if (!r) return;
        if (!canEditRow(r)) { UI.toast('This issue was raised by someone else — ask a planner to change it.', 'warn'); return; }
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
        renderIssues();
      }
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
  function idsOf(root) {
    var v = (root && root.dataset.ids) || '';
    return v ? v.split(',').filter(Boolean) : [];
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
    LESSONS.sort(function (a, b) {                    // newest first, blanks last
      var x = a.date_captured || '', y = b.date_captured || '';
      if (!x !== !y) return x ? -1 : 1;
      if (x !== y) return y.localeCompare(x);
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
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
      if (lFilters.category && l.category !== lFilters.category) return false;
      if (lFilters.search) {
        var hay = [l.lesson, l.recommendation, l.category, l.department,
                   lessonSourceText(l)].join(' ').toLowerCase();
        if (hay.indexOf(lFilters.search) === -1) return false;
      }
      return true;
    });
  }

  function renderLessons() {
    renderLessonKpis();
    var anyF = ['search', 'department', 'category'].some(function (k) { return lFilters[k]; });
    var clr = $('il-lclearfilters'); if (clr) clr.hidden = !anyF;
    var host = $('il-lessons-view'); if (!host) return;
    if (!pid) { host.innerHTML = ''; return; }
    if (_lessMode === 'library') renderLessonsLibrary(host);
    else renderLessonsReport(host);
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
    var cats = {}; all.forEach(function (l) { if (l.category) cats[l.category] = 1; });
    $('il-lkpis').innerHTML =
      kpi('Lessons captured', all.length, '') +
      kpi('Linked to a record', linked, 'is-closed') +
      kpi('Categories', Object.keys(cats).length, '');
  }

  // The library: every lesson at once, for browsing. Unchanged in spirit from the original
  // card grid — this is what people scan when starting a new project.
  function renderLessonsLibrary(host) {
    var data = lessonsFiltered();
    host.classList.remove('il-mom-report');
    if (!LESSONS.length) {
      host.innerHTML = migrateNoteHTML() +
        '<div class="il-empty"><span data-ico="bulb" data-ico-size="40"></span>' +
        '<div class="il-empty-title">No lessons captured yet.</div>' +
        '<div>Use <strong>+ New lesson</strong>, or capture one from an issue or a meeting action item.</div>' +
        '</div>';
      return;
    }
    host.innerHTML = migrateNoteHTML() + (data.length
      ? '<div class="il-lessons">' + data.map(lessonCardHTML).join('') + '</div>'
      : '<div class="il-empty"><div class="il-empty-title">No lessons match the current filters.</div></div>');
    host.querySelectorAll('[data-open-lesson]').forEach(function (b) {
      b.onclick = function () { openLesson(b.dataset.openLesson); };
    });
    host.querySelectorAll('[data-open-issue]').forEach(function (b) {
      b.onclick = function () { openIssue(b.dataset.openIssue); };
    });
  }

  // The report: one lesson at a time, the same master/detail shape as the minutes and the
  // register, so all three screens read the same way.
  function renderLessonsReport(host) {
    var data = lessonsFiltered();
    if (_lessNew) _lessSel = null;
    else if (!data.some(function (l) { return l.id === _lessSel; })) _lessSel = data.length ? data[0].id : null;
    var cur = _lessNew || LESSONS.find(function (l) { return l.id === _lessSel; }) || null;

    host.classList.toggle('il-mom-report', _lessReport);
    host.innerHTML = migrateNoteHTML() +
      '<div class="il-mom-wrap"><div class="il-mom-list">' +
        '<div class="il-mom-head">Lessons <span>' + LESSONS.length + '</span></div>' +
        (_lessNew ? '<button class="il-mom-item on" data-less="__new__">' +
          '<span class="il-mom-draft">New</span>Unsaved lesson<small>Not yet in the library</small></button>' : '') +
        (data.length ? data.map(lessonListRowHTML).join('')
          : '<div class="il-empty" style="padding:14px;">' +
            (LESSONS.length ? 'No lesson matches the current filters.'
                            : 'No lessons captured on this project yet.') + '</div>') +
        (canAdd && !_lessLegacy
          ? '<button class="pd-btn pd-btn-sm pd-btn-primary" id="il-less-new" style="width:100%;margin-top:8px;">+ New lesson</button>' : '') +
      '</div><div class="il-mom-detail">' +
        (cur ? lessonDetailHTML(cur)
             : '<div class="il-empty" style="padding:28px;">' +
               (LESSONS.length ? 'Pick a lesson to read it.' : 'Nothing to show yet.') + '</div>') +
      '</div></div>';
    wireLessons();
  }

  function lessonListRowHTML(l) {
    return '<button class="il-mom-item' + (l.id === _lessSel ? ' on' : '') + '" data-less="' + Fmt.esc(l.id) + '">' +
      (l.category ? '<span class="il-chip is-cat il-less-lchip">' + Fmt.esc(l.category) + '</span>' : '') +
      Fmt.esc(clip(l.lesson, 90) || '(no lesson text)') +
      '<small>' + Fmt.esc(l.department || 'No department') +
      (l.date_captured ? ' · ' + Fmt.date(l.date_captured) : '') +
      ' · ' + Fmt.esc(lessonSourceText(l)) + '</small></button>';
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
    return '<div class="il-lcard">' +
      '<div class="il-lcard-top">' +
        (l.category ? '<span class="il-chip is-cat">' + Fmt.esc(l.category) + '</span>' : '') +
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
        '<div class="pd-field" style="flex:1 1 200px;">' +
          ilField(_lessReport, 'Lesson category', 'il-c-cat',
            '<select class="pd-select pd-input-sm il-lf-fld" data-f="category"' + d + '>' +
            opts(LESSON_CATS, l.category || '', '—') + '</select>', l.category) + '</div>' +
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
    host.querySelectorAll('[data-less]').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.less === '__new__') return;
        if (_lessNew && !confirm('Discard the unsaved new lesson?')) return;
        _lessNew = null; _lessSel = b.dataset.less; _lessReport = false; renderLessons();
      };
    });
    var nb = host.querySelector('#il-less-new'); if (nb) nb.onclick = function () { newLesson(null); };
    var rep = host.querySelector('#il-less-report');
    if (rep) rep.onclick = function () { _lessReport = !_lessReport; renderLessons(); };
    var sv = host.querySelector('#il-less-save'); if (sv) sv.onclick = saveLesson;
    var cn = host.querySelector('#il-less-cancel');
    if (cn) cn.onclick = function () { _lessNew = null; renderLessons(); };
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
      category: '', department: (link && link.department) || (profile && profile.department) || '',
      lesson: '', recommendation: '', date_captured: todayISO(),
      issue_id: (link && link.issue_id) || null,
      mom_id: (link && link.mom_id) || null,
      mom_item_id: (link && link.mom_item_id) || null,
    };
    _lessSel = null; _lessMode = 'report'; _lessReport = false;
    if (screen !== 'lessons') switchScreen('lessons'); else { syncChrome(); renderLessons(); }
    var el = $('il-lessons-view'); var f = el && el.querySelector('[data-f="lesson"]');
    if (f) f.focus();
  }

  function openLesson(id) {
    _lessMode = 'report'; _lessSel = id; _lessNew = null; _lessReport = false;
    if (screen !== 'lessons') switchScreen('lessons'); else { syncChrome(); renderLessons(); }
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
      category:       l.category || null,
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
