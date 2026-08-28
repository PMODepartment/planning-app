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
  // ⚠️ Minutes have NO screen-wide write flag, deliberately — see canEditMinute() in the
  // MINUTES OF MEETING section. Departments record minutes now
  // (migrations/2026-08-20-department-minutes.sql) under the same rules as the register:
  // you maintain what you wrote, a planner maintains all of it. A single flag could not
  // express that, and a flag that said "yes" for a minute the DB will refuse is exactly
  // the silent failure D1 removed from issues.
  var rows = [];
  var MOM_BY_ID = {};                  // meeting_minutes referenced by these issues (C4)
  // ⚠️ DEFAULT SCREEN IS THE MINUTES, matching the tab order (meeting → register → library).
  // The module opens where the input comes in; the register is one click away.
  var screen = 'mom';                  // 'mom' | 'issues' | 'lessons'

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

    // ⚠️ Deep link from My Work: ?screen=issues|lessons|mom. Read BEFORE wire()/
    // syncChrome(), which paint the tab strip from `screen` — set it afterwards and
    // the strip would say one thing while the module showed another. An unknown or
    // absent value leaves the default (the minutes) untouched.
    try {
      var _q = new URLSearchParams(location.search).get('screen');
      if (_q === 'issues' || _q === 'lessons' || _q === 'mom') screen = _q;
    } catch (e) { /* no URLSearchParams / opaque URL — keep the default */ }

    // ⚠️ Tolerant, and NOT awaited-into-failure: `getPeople()` returns [] when the
    // roster RPC is missing (migration not yet run), so the pickers fall back to
    // free text rather than the whole module refusing to load over a dropdown.
    try { PEOPLE = await PDb.getPeople(); } catch (e) { PEOPLE = []; }

    await loadProjects();
    wire();
    syncChrome();
    if (pid) load();
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
      momReset();          // minutes belong to a project — never carry them across a switch
      issReset(); lessReset();
      load();
      if (screen === 'mom') renderMom();
      joinCollab();
    };

    // Screen tabs
    Array.prototype.forEach.call(document.querySelectorAll('.il-tab[data-screen]'), function (b) {
      b.onclick = function () { switchScreen(b.dataset.screen); };
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
      if (screen === 'mom') { momReset(); renderMom(); }   // renderMom re-fetches when unloaded
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
    $('il-screen-mom').hidden = s !== 'mom';
    $('il-screen-title').textContent =
      s === 'lessons' ? 'Lessons Learned' : (s === 'mom' ? 'Minutes of Meeting' : 'Issues & Concerns');
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

    // The presentation switch belongs to the two record screens; the minutes have their
    // own Reporting view on the minute itself.
    var tg = $('il-viewtoggle');
    if (tg) {
      tg.hidden = (screen === 'mom');
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
    if (screen === 'mom') renderMom();
    else if (screen === 'lessons') renderLessons();
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
  // MINUTES OF MEETING — moved here out of the Project Schedule module
  // --------------------------------------------------------------------------
  // WHY IT LIVES HERE NOW: a meeting produces two different kinds of thing and they
  // must not be collapsed into one — a RECORD of what was said (which stays true
  // forever, whatever happens next) and ACTION ITEMS, which have an owner, a due date
  // and a life of their own. The actions are chased in THIS register, so the minutes
  // belong beside it rather than inside the schedule.
  //
  // ⚠️ STILL ONE-WAY, AND DELIBERATELY SO. Raising an action item COPIES it into the
  // register and links the two; from that moment the register is authoritative for how
  // the issue is chased, and the minute keeps saying what the meeting said. Two-way
  // sync would mean two places both claiming to own a status, and the answer to "why
  // did this close?" would depend on which screen you happened to open.
  //
  // ⚠️ THE ONE REAL GAIN FROM THE MOVE: the linked issue is read straight out of
  // `rows` — this module already holds the register for this project — so there is no
  // second fetch of `issues_lessons` and no second copy of an issue's status to drift.
  // The schedule module had to fetch them separately because it did not own the register.
  //
  // ⚠️ `schedule_activity_id` is KEPT (existing minutes carry it) but is now searched
  // against the server, never listed. This module does not own the schedule and must
  // not pull 40k activities into a side screen; and a <datalist> could not have served
  // it anyway — a datalist filters on each option's VALUE, which has to be the
  // activity_id we store, so typing part of a NAME would match nothing (the same trap
  // documented when the drawing register's activity picker was built).
  // ==========================================================================
  var MOMS = [], MOM_ITEMS = [], _momSel = null, _momErr = '', _momLoaded = false;
  var MOM_ACT_NAME = {};        // activity_id -> activity_name, resolved on demand
  var _momActTimer = null;      // debounce for the activity search
  var _momDocClick = null;      // the one outside-click handler for the picker
  // ⚠️ There is ONE status vocabulary, shared with the register: STATUSES
  // (Open | On Hold | Closed), declared at the top of this module. `mom_items` used to
  // have its own list with `In Progress` where the register says `On Hold`, which meant
  // raising an action had to TRANSLATE the value, the minute's filter had to offer both
  // vocabularies, and a raised row could be filtered by a word its own dropdown did not
  // contain. The 2026-08-22 migration moved the rows and rewrote the CHECK to match.
  // Do not reintroduce a MoM-only list: the CHECK on mom_items now refuses 'In Progress'.
  // ⚠️ Mirrors the `mom_items_type_chk` CHECK added by
  // migrations/2026-08-21-mom-schema-carryover-distribute.sql. A value outside this
  // list is refused by the database, so the control is a <select>, never free text.
  var MOM_TYPES = ['Issue', 'FYI', 'Report'];
  // mom-app's own category list. ⚠️ Taken as the UNION of the two lists that app
  // carries, because they disagree: its edit form offers `Finance` and its filter
  // does not — so an item categorised Finance there can never be filtered to. One
  // list, read by both the editor and the filter, is what stops that recurring here.
  var MOM_CATEGORIES = [
    'Commercial / Contracts', 'Organizational Hr', 'Engineering', 'Procurement',
    'Operations', 'Risk', 'Stakeholder Management', 'Quality',
    'Project Execution Plan', 'Finance', 'Other Matters'
  ];
  // A starting vocabulary, NOT a closed list — see the migration's note on why
  // `meeting_type` carries no CHECK. Whatever a project actually uses joins it
  // through momOptions().
  var MOM_MEETING_TYPES = [
    'Weekly Coordination', 'Client Progress Meeting', 'Technical Coordination',
    'Kick-off', 'Safety Toolbox', 'Site Inspection', 'Management Review'
  ];
  // ⚠️ SESSION-ONLY and never persisted or written anywhere. Reporting view is how
  // the record is being LOOKED AT right now — on a projector in the meeting — not a
  // property of the minute. Persisting it would have one planner's presentation mode
  // greet the next person who opens the screen.
  var _momReport = false;
  var _momF = { q: '', cat: '', type: '', status: '' };   // action-item filters
  var _momQ = '';                                          // meetings-list search

  // ⚠️ THE SELECT-VALUE TRAP, which this app has been bitten by twice (the drawing
  // register's drawing-type field silently WIPED a value on save; the schedule's
  // work-package picker read back ''). A <select> whose value is absent from its
  // options reports the FIRST option instead — so a legacy or hand-entered value
  // would be silently rewritten the next time anything saved the row.
  //
  // Options are therefore canonical ∪ values already in use on this project ∪ the
  // row's own current value, so whatever is on screen always round-trips.
  function momOptions(canon, present, cur, blank) {
    var seen = {}, out = [];
    canon.concat(present || []).concat(cur ? [cur] : []).forEach(function (v) {
      v = String(v == null ? '' : v).trim();
      if (!v || seen[v.toLowerCase()]) return;
      seen[v.toLowerCase()] = 1; out.push(v);
    });
    return '<option value="">' + (blank || '—') + '</option>' +
      out.map(function (v) {
        return '<option' + (cur === v ? ' selected' : '') + '>' + Fmt.esc(v) + '</option>';
      }).join('');
  }
  // What this project actually uses, so one planner's spelling is offered to the next.
  function momUsedCategories() {
    return MOM_ITEMS.map(function (x) { return x.category; }).filter(Boolean);
  }
  function momUsedMeetingTypes() {
    return MOMS.map(function (x) { return x.meeting_type; }).filter(Boolean);
  }

  // ------------------------------------------------ action-item filters -----
  function momFilterOn() {
    return !!(_momF.q || _momF.cat || _momF.type || _momF.status);
  }
  // ⚠️ For a RAISED action the REGISTER's status is what the row displays, so it is
  // what the status filter must test — otherwise filtering to Closed would hide a row
  // the screen is showing as Closed. Same rule as the PDF and carry-over.
  function momItemStatus(it) {
    var iss = momIssueOf(it);
    return iss ? (iss.status || 'Open') : (it.status || 'Open');
  }
  function momVisibleItems(momId) {
    var all = momItemsOf(momId);
    if (!momFilterOn()) return all;
    var q = _momF.q.toLowerCase();
    return all.filter(function (it) {
      if (_momF.cat && (it.category || '') !== _momF.cat) return false;
      if (_momF.type && (it.type || '') !== _momF.type) return false;
      if (_momF.status && momItemStatus(it) !== _momF.status) return false;
      if (!q) return true;
      // Everything the row shows as text, so a search finds what the eye can see.
      return [it.item_no, it.category, it.issue, it.description, it.action_item, it.owner]
        .join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  // momItemStatus() returns the register's status for a raised action and the item's
  // own otherwise — since the vocabularies were unified those are the same three words,
  // so the filter no longer has to union two lists to keep either reachable. Kept as a
  // function because it is the seam the filter bar and its tests both call.
  function momStatusFilterOpts() { return STATUSES.slice(); }

  function momReset() {
    MOMS = []; MOM_ITEMS = []; _momSel = null; _momErr = ''; _momLoaded = false;
    _momQ = ''; _momF = { q: '', cat: '', type: '', status: '' };
    MOM_ACT_NAME = {};   // activity ids are project-scoped — this cache is too
  }

  // ⚠️ Loaded on first open of this screen, not with the register: most sessions never
  // look at the minutes, and two extra round-trips on every project switch is a cost
  // paid by everyone for a screen few open.
  async function loadMoms() {
    _momLoaded = true;
    if (!pid) { MOMS = []; MOM_ITEMS = []; return; }
    // ⚠️ Keyset-paginated (PDb.selectAll): a plain .select() truncates at 1000 rows
    // server-side with no error, and both of these accumulate for the life of the
    // project — one row per meeting, and one per action item on every meeting.
    try {
      MOMS = await PDb.selectAll('meeting_minutes', function (q) { return q.eq('project_id', pid); });
      MOM_ITEMS = await PDb.selectAll('mom_items', function (q) { return q.eq('project_id', pid); });
      _momErr = '';
    } catch (e) {
      MOMS = []; MOM_ITEMS = [];
      _momErr = (e && e.message) || 'load failed';
      momLoadDone();      // a failed fetch must also stop the picker waiting forever
      return;
    }
    // selectAll returns id order — the display order is applied here.
    MOMS.sort(function (a, b) {                       // meeting_date desc, blanks last
      var x = a.meeting_date || '', y = b.meeting_date || '';
      if (!x !== !y) return x ? -1 : 1;
      if (x !== y) return y.localeCompare(x);
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    MOM_ITEMS.sort(function (a, b) {
      return (a.seq || 0) - (b.seq || 0) ||
        String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
    // The log's "From MOM" tag reads MOM_BY_ID. Now that the real minutes are in hand,
    // feed it from them rather than leaving it on the narrower fetch load() does.
    MOMS.forEach(function (m) { MOM_BY_ID[m.id] = m; });
    momLoadDone();
  }

  // ⚠️ `_momLoaded` is set on the FIRST line of loadMoms as a re-entrancy guard, so it
  // means "a fetch has started", NOT "the minutes are in hand". Anything that renders from
  // MOMS while the fetch is in flight therefore sees an EMPTY list and, without this, never
  // hears that the data arrived: the lesson form's meeting picker rendered "— pick a
  // meeting —" and nothing else on a project full of minutes. Measured, then fixed.
  // Re-rendering the lessons screen on completion covers every such reader at once rather
  // than making each one race the fetch.
  function momLoadDone() {
    if (screen === 'lessons') renderLessons();
  }

  function momItemsOf(id) { return MOM_ITEMS.filter(function (x) { return x.mom_id === id; }); }
  // The register this module already loaded IS the source of truth for a raised issue.
  function momIssueOf(item) {
    return item.issue_id && rows.find(function (x) { return x.id === item.issue_id; });
  }
  // ⚠️ PER MINUTE, not per screen. These mirror
  // migrations/2026-08-20-department-minutes.sql line for line; where the UI and the RLS
  // disagree the user fills in a form and the save bounces with nothing to explain it.
  function canEditMinute(m) {
    if (isSteward) return true;
    // ⚠️ A minute with no `created_by` (recorded before the stamp, or imported) is
    // planner-only: there is no way to know whose it was, and guessing would hand
    // someone edit rights over a meeting record they never wrote.
    return !!(canAdd && m && m.created_by && UID && m.created_by === UID);
  }
  // ⚠️ Your own DRAFT you may delete — "+ New minutes" inserts immediately and then lets
  // you type, so a mis-click leaves a real row. But once an action has been raised, the
  // issues in the register point back here for their provenance and `on delete set null`
  // strips that SILENTLY rather than failing, so that deletion is a planner's call.
  function canDeleteMinute(m) {
    if (isSteward) return true;
    // ⚠️ `carried_from_item_id` is excluded, matching mom_has_raised() in the
    // migration. A carried action has an `issue_id` — it is the same issue, still being
    // chased — but the register's provenance points at the minute it was FIRST raised
    // from, which carry-over never moves. Deleting a minute that merely carried it
    // destroys no provenance, so counting it would make every new draft seeded from an
    // old meeting planner-delete-only the moment it was created.
    return canEditMinute(m) && !momItemsOf(m.id).some(function (i) {
      return i.issue_id && !i.carried_from_item_id;
    });
  }
  // "Has this been issued?" — the workflow state, NOT a permission. Distribution locks
  // the form in the UI only; the DATABASE enforces the half that is a security boundary
  // (a draft is readable only by its recorder and planners) and the half that leaves a
  // permanent row behind (an action cannot be raised out of a draft). See section 5 of
  // migrations/2026-08-21-mom-schema-carryover-distribute.sql.
  function momLocked(m) { return !!(m && m.is_distributed); }
  // Says whose it is without naming a person — same rule as the register's caption: a
  // department user has no business being granted a read of `users` for a caption.
  function minuteByLabel(m) {
    if (!m || !m.created_by) return 'Recorded before minutes noted who wrote them — a planner maintains it.';
    if (UID && m.created_by === UID) return 'Recorded by you.';
    return 'Recorded by someone else — they or a planner can change it.';
  }
  function momToday() {
    // Local date, not toISOString().slice(0,10) — east of Greenwich that is yesterday.
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // ------------------------------------------------------------------ render ---
  function renderMom() {
    var host = $('il-mom-view'); if (!host) return;
    if (!pid) {
      host.innerHTML = '<div class="pd-card" style="padding:24px;color:var(--pd-muted);">Select a project to see its minutes.</div>';
      return;
    }
    if (!_momLoaded) {
      host.innerHTML = '<div class="pd-card" style="padding:24px;color:var(--pd-muted);">Loading minutes…</div>';
      loadMoms().then(renderMom);   // _momLoaded is already true, so this cannot loop
      return;
    }
    var cur = MOMS.find(function (x) { return x.id === _momSel; }) || null;
    var shown = momSearchList();
    // Scoped to this screen's host, not <body> — switching to Issues & Concerns must
    // not leave the register rendered as a read-only report.
    host.classList.toggle('il-mom-report', _momReport);
    host.innerHTML =
      (isSteward ? '' : (canAdd
        ? '<p class="il-mom-note">You can record minutes and maintain the ones you recorded. ' +
          'A planner maintains the rest — everyone on the project can read them all.</p>'
        : '<p class="il-mom-note">You can read the minutes of this project.</p>')) +
      '<div class="il-mom-wrap"><div class="il-mom-list">' +
        '<div class="il-mom-head">Meetings <span>' + MOMS.length + '</span></div>' +
        // A project accumulates one minute per meeting for its whole life, so the list
        // is the thing that gets long. Offered only once it actually is.
        (MOMS.length > 6
          ? '<input class="pd-input pd-input-sm il-mom-search" id="il-mom-q" ' +
            'placeholder="Search meetings…" value="' + Fmt.esc(_momQ) + '">' : '') +
        (shown.length ? momListHTML(shown, cur)
          : '<div class="il-empty" style="padding:14px;">' +
            (_momErr ? 'Could not load minutes: ' + Fmt.esc(_momErr) +
                       '<br><small>If this says the relation does not exist, run <code>migrations/2026-08-19-duration-scenarios-and-mom.sql</code>.</small>'
                     : (MOMS.length ? 'No meeting matches “' + Fmt.esc(_momQ) + '”.'
                                    : 'No minutes recorded on this project yet.')) + '</div>') +
        (canAdd ? '<button class="pd-btn pd-btn-sm pd-btn-primary" id="il-mom-new" style="width:100%;margin-top:8px;">+ New minutes</button>' : '') +
      '</div><div class="il-mom-detail">' +
        (cur ? momDetailHTML(cur)
             : '<div class="il-empty" style="padding:28px;">' +
               (MOMS.length ? 'Pick a meeting to read it.' : 'Nothing to show yet.') + '</div>') +
      '</div></div>';
    wireMom();
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
  }

  function momSearchList() {
    var q = _momQ.trim().toLowerCase();
    if (!q) return MOMS;
    return MOMS.filter(function (x) {
      return [x.title, x.location, x.meeting_type, x.attendees, x.meeting_date]
        .join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }

  // ⚠️ GROUPED BY MEETING TYPE, which is what that field is FOR in mom-app — it is
  // not decoration on the form. A project runs several standing meetings at once, and
  // a flat date-ordered list interleaves them, so last week's client meeting sits
  // between two weekly coordinations. MOMS is already sorted by date desc, so pushing
  // into buckets in order keeps each group date-ordered without a second sort.
  //
  // ⚠️ Untyped minutes get their own trailing bucket rather than being hidden or
  // spread through the typed ones — every minute predating the meeting_type column is
  // untyped, so that bucket is the whole list until someone starts filling it in.
  function momListHTML(list, cur) {
    var groups = {}, order = [];
    list.forEach(function (x) {
      var k = (x.meeting_type || '').trim() || ' untyped';
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(x);
    });
    order.sort(function (a, b) {
      if ((a === ' untyped') !== (b === ' untyped')) return a === ' untyped' ? 1 : -1;
      return a.localeCompare(b);
    });
    // A single group is not a grouping — the header would just be a label over the
    // whole list, which is the common case on a project that types nothing.
    var oneGroup = order.length < 2;
    return order.map(function (k) {
      return (oneGroup ? '' : '<div class="il-mom-group">' +
                (k === ' untyped' ? 'No meeting type' : Fmt.esc(k)) +
                ' <span>' + groups[k].length + '</span></div>') +
        groups[k].map(function (x) { return momListRowHTML(x, cur); }).join('');
    }).join('');
  }

  function momListRowHTML(x, cur) {
    var items = momItemsOf(x.id);
    var open = items.filter(function (i) { return momItemStatus(i) !== 'Closed'; }).length;
    return '<button class="il-mom-item' + (cur && cur.id === x.id ? ' on' : '') + '" data-mom="' + Fmt.esc(x.id) + '">' +
      // ⚠️ Marked in the LIST, not only on the open minute: a recorder with three
      // drafts among a dozen issued meetings needs to see which are still unissued
      // without opening each one. Nobody else can see a draft at all (RLS).
      (momLocked(x) ? '' : '<span class="il-mom-draft">Draft</span>') +
      Fmt.esc(x.title || '(untitled)') +
      '<small>' + (x.meeting_date ? Fmt.date(x.meeting_date) : 'no date') +
      ' · ' + items.length + ' action' + (items.length === 1 ? '' : 's') +
      (open ? ' · <b>' + open + ' open</b>' : '') + '</small></button>';
  }

  // ⚠️ ONE detail renderer, read-only by disabling its fields rather than a second
  // read-only markup path — two paths drift the moment either is touched, and a
  // disabled input already reads as "you cannot change this".
  function momDetailHTML(mom) {
    // ⚠️ THREE states, not two. `mayEdit` is the PERMISSION (whose minute is this);
    // `locked` is the WORKFLOW state (has it been issued). A distributed minute is
    // read-only even to the person who wrote it — they revert it to draft first, which
    // is a deliberate act rather than a silent edit to a sheet already circulated.
    var mayEdit = canEditMinute(mom), locked = momLocked(mom);
    var ro = !mayEdit || locked, d = ro ? ' disabled' : '';
    var items = momItemsOf(mom.id);
    // ⚠️ `vis` drives the TABLE; `items` still drives the count, the filter bar and
    // the empty state. Rendering the filtered set as if it were everything is how a
    // hidden row gets mistaken for a deleted one.
    var vis = momVisibleItems(mom.id);
    var act = mom.schedule_activity_id || '';
    var others = MOMS.filter(function (x) { return x.id !== mom.id && momCarryable(x).length; });
    return '<div class="il-mom-detail-card">' +
      (ro ? '' : '<input type="file" id="il-mom-fileinput" hidden ' +
        'accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx">') +
      '<div class="il-mom-toolbar">' +
        '<span class="il-mom-state' + (locked ? ' on' : '') + '">' +
          (locked ? 'Distributed' : 'Draft — only you and planners can see this') + '</span>' +
        '<div style="flex:1;"></div>' +
        // Export is a READ, so it is offered to everyone who can see the minute —
        // unlike every other control on this card, which is gated on canEditMinute().
        // A VIEW control, so — like PDF — it is offered to everyone who can see the
        // minute, not only to whoever may edit it.
        '<button class="pd-btn pd-btn-sm' + (_momReport ? ' is-active' : '') + '" id="il-mom-report" ' +
          'title="Present these minutes as a clean read-only record — hides the editing controls">' +
          (_momReport ? '\u2713 Reporting view' : 'Reporting view') + '</button>' +
        '<button class="pd-btn pd-btn-sm" id="il-mom-pdf" title="Download these minutes as a PDF">⬇ PDF</button>' +
        (mayEdit ? '<button class="pd-btn pd-btn-sm' + (locked ? '' : ' pd-btn-primary') + '" id="il-mom-dist">' +
          (locked ? '↩ Revert to draft' : '📤 Distribute') + '</button>' : '') +
      '</div>' +
      (locked && mayEdit
        ? '<p class="il-mom-note" style="margin-top:0;">These minutes have been issued, so the form is ' +
          'locked. Revert to draft to change them — everyone on the project can already read this version.</p>'
        : '') +
      '<div class="il-form-row">' +
        '<div class="pd-field" style="flex:2 1 260px;"><label>Title</label><input class="pd-input" id="il-mom-title" value="' + Fmt.esc(mom.title || '') + '"' + d + '></div>' +
        '<div class="pd-field" style="flex:1 1 140px;"><label>Date</label><input class="pd-input" type="date" id="il-mom-date" value="' + (dateVal(mom.meeting_date)) + '"' + d + '></div>' +
        '<div class="pd-field" style="flex:1 1 140px;"><label>Location</label><input class="pd-input" id="il-mom-loc" value="' + Fmt.esc(mom.location || '') + '"' + d + '></div>' +
        '<div class="pd-field" style="flex:1 1 170px;"><label>Meeting type</label>' +
          '<select class="pd-select" id="il-mom-type"' + d + '>' +
            momOptions(MOM_MEETING_TYPES, momUsedMeetingTypes(), mom.meeting_type || '', '— none —') +
          '</select></div>' +
      '</div>' +
      '<div class="pd-field"><label>Attendees</label><input class="pd-input" id="il-mom-att" value="' + Fmt.esc(mom.attendees || '') + '" placeholder="Names, comma separated"' + d + '></div>' +
      '<div class="pd-field il-mom-act"><label>Activity discussed ' +
        '<small style="font-weight:400;color:var(--pd-muted);">— optional; links these minutes to a schedule activity</small></label>' +
        '<input type="hidden" id="il-mom-act" value="' + Fmt.esc(act) + '">' +
        '<div id="il-mom-actsel">' + momActChipHTML(act, ro) + '</div>' +
        (ro ? '' :
          '<input class="pd-input pd-input-sm" id="il-mom-actq" placeholder="Search the schedule by Activity ID or name…" autocomplete="off">' +
          '<div class="il-mom-acres" id="il-mom-acres" hidden></div>') +
      '</div>' +
      (ro ? '<p class="il-raisedby il-mom-by">' + Fmt.esc(minuteByLabel(mom)) + '</p>' : '') +
      '<div class="pd-field"><label>Notes / discussion</label>' +
        '<textarea class="pd-textarea" id="il-mom-notes" rows="4"' + d + '>' + Fmt.esc(mom.notes || '') + '</textarea>' +
      '</div>' +

      '<div class="il-mom-actions"><h4>Action items</h4>' +
        '<p>An action item lives here. <b>Raise</b> it to put a copy in the Issues &amp; Concerns ' +
        'register and link the two — after that the register is where it is chased, and these ' +
        'minutes keep saying what the meeting said.</p>' +
        // ⚠️ Offered only when there is enough to filter. A filter bar over three
        // rows is noise, and a "Showing 0 of 3" that a stale filter caused is how a
        // planner concludes their minutes have lost data.
        (items.length > 4 ? momFilterBarHTML(items) : '') +
        (items.length && !vis.length
          ? '<div class="il-empty" style="padding:14px;">No action item on these minutes matches the filter.</div>'
          : '') +
        // ⚠️⚠️ THIS IS A CARD LIST, NOT A TABLE, AND IT MUST STAY ONE.
        // It was an 11-column table needing 1400px+, so on a real screen Owner, Due,
        // Status, File and the register link all sat off the right edge behind a
        // horizontal scrollbar — exactly the columns a reporter reads. An action item
        // has more fields than any screen has columns, so widening or re-tuning the
        // columns cannot fix that; the layout has to WRAP instead of scroll.
        //
        // The card deliberately mirrors mom-app's own layout — the same one
        // momDownloadPDF() already renders: a six-cell meta grid (No. / Category /
        // Type / Status / Responsible / Target date) above full-width text blocks.
        // Keeping the two identical means what you read on screen IS what the export
        // prints; a third bespoke layout would let the screen and the PDF drift.
        (vis.length ? '<div class="il-mi-cards">' +
          vis.map(function (it, i) { return momItemRowHTML(it, ro, d, mayEdit, locked, i); }).join('') +
          '</div>'
          : (items.length ? '' : '<div class="il-empty" style="padding:14px;">No action items on these minutes.</div>')) +
        (ro ? '' :
          '<div class="il-mom-addrow">' +
            '<button class="pd-btn pd-btn-sm" id="il-mom-additem">+ Add action item</button>' +
            // Carry-over is offered on ANY minute, not only a brand-new one — a recurring
            // meeting often has its agenda seeded after the fact. Only meetings that
            // actually still have something open are listed; an empty dropdown would
            // invite a click that does nothing.
            (others.length
              ? '<span class="il-mom-carry">' +
                  '<select class="pd-select pd-input-sm" id="il-mom-carryfrom">' +
                    '<option value="">Carry over still-open actions from…</option>' +
                    others.map(function (x) {
                      return '<option value="' + Fmt.esc(x.id) + '">' + Fmt.esc(x.title || '(untitled)') +
                        (x.meeting_date ? ' · ' + Fmt.esc(Fmt.date(x.meeting_date)) : '') +
                        ' · ' + momCarryable(x).length + ' open</option>';
                    }).join('') +
                  '</select>' +
                  '<button class="pd-btn pd-btn-sm" id="il-mom-carrygo">Carry over</button>' +
                '</span>'
              : '') +
          '</div>') +
      '</div>' +

      (ro ? '' :
        '<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
          (canDeleteMinute(mom)
            ? '<button class="pd-btn pd-btn-sm pd-btn-danger" id="il-mom-del">Delete minutes…</button>'
            // Says why rather than showing a button the database would refuse.
            : '<span class="il-raisedby" style="margin:0;">An action has been raised from these ' +
              'minutes, so only a planner can delete them.</span>') +
          '<div style="flex:1;"></div>' +
          '<button class="pd-btn pd-btn-primary pd-btn-sm" id="il-mom-save">Save minutes</button></div>') +
    '</div>';
  }

  // mom-app keeps these in a collapsible drawer; here they sit inline above the
  // table, matching the filter bars the rest of this app already uses.
  function momFilterBarHTML(items) {
    var on = momFilterOn();
    return '<div class="il-mom-filters">' +
      '<span class="il-filt-ico" data-ico="filter" data-ico-size="15"></span>' +
      '<input class="pd-input pd-input-sm" id="il-momf-q" placeholder="Search agenda, action, owner…" value="' + Fmt.esc(_momF.q) + '">' +
      '<select class="pd-select pd-input-sm" id="il-momf-cat">' +
        momOptions(MOM_CATEGORIES, momUsedCategories(), _momF.cat, 'All categories') + '</select>' +
      '<select class="pd-select pd-input-sm" id="il-momf-type">' +
        momOptions(MOM_TYPES, [], _momF.type, 'All types') + '</select>' +
      '<select class="pd-select pd-input-sm" id="il-momf-status">' +
        momOptions(momStatusFilterOpts(), [], _momF.status, 'All statuses') + '</select>' +
      (on ? '<button class="il-clear" id="il-momf-clear" title="Clear all filters">' +
            '<span data-ico="x" data-ico-size="14"></span>Clear</button>' : '') +
      '<span class="il-mom-count">' +
        (on ? 'Showing ' + momVisibleItems(_momSel).length + ' of ' + items.length
            : items.length + ' action' + (items.length === 1 ? '' : 's')) + '</span>' +
    '</div>';
  }

  // ⚠️ `ro` is "can this row's FIELDS be typed into" = permission AND not-locked.
  // Raising needs a DIFFERENT test, so `mayEdit` and `locked` are passed separately.
  // Collapsing them into `ro` created a deadlock — see the register cell below.
  // ⚠️ `i` is the position among the VISIBLE items and is used only for the fallback
  // number placeholder, exactly as the PDF does it — never as an identity.
  // ⚠️ In Reporting view a field renders as TEXT, not as a control. This is not
  // cosmetic: a single-line <input> CLIPS its own value (measured — a 659px value in a
  // 416px box), so a long Issue / Agenda was unreadable in exactly the mode meant for
  // reading it. Text wraps; an input cannot be made to. It also stops a printed-looking
  // record being built out of form widgets.
  // ⚠️ `raw` is the value to SHOW; it is escaped here, and newlines survive as <br>
  // because the record is what was said, not a flattened paragraph.
  // ⚠️ `extra` is appended INSIDE the block (the carried badge needs to sit under the
  // number in both modes). It is a separate argument rather than something the caller
  // splices onto the result, because the reporting body itself contains a </div> and a
  // string-surgery approach would close the wrong one.
  // Delegates to the shared renderer — the register and the library render their fields
  // the same way, so a change to reporting presentation lands on all three screens at once.
  function momFieldHTML(label, cls, control, raw, extra) {
    return ilField(_momReport, label, cls, control, raw, extra);
  }

  function momItemRowHTML(it, ro, d, mayEdit, locked, i) {
    var iss = momIssueOf(it);
    // ⚠️ Rows written before the 2026-08-21 migration hold their action text in
    // `description`, the same fallback the PDF applies.
    var actText = it.action_item || it.description || '';
    return '<div class="il-mi-card" data-item="' + Fmt.esc(it.id) + '">' +
      // ---- the six-cell meta grid, in mom-app's own order --------------------
      '<div class="il-mi-meta">' +
      momFieldHTML('No.', 'il-c-no',
        '<input class="pd-input pd-input-sm il-mi" data-f="item_no" value="' + Fmt.esc(it.item_no || '') +
        '" placeholder="' + ((it.seq == null ? (i || 0) : it.seq) + 1) + '"' + d + '>',
        it.item_no || String((it.seq == null ? (i || 0) : it.seq) + 1),
        // Says the action came in from an earlier meeting. ⚠️ Not a status: a carried
        // action is the SAME action, and its register link came with it — without the
        // tag it reads as something someone re-typed, and the two would be chased twice.
        (it.carried_from_item_id ? '<span class="il-mom-carried" title="Carried over from an earlier meeting">carried</span>' : '')) +
      momFieldHTML('Category', 'il-c-cat',
        '<select class="pd-select pd-input-sm il-mi" data-f="category"' + d + '>' +
        momOptions(MOM_CATEGORIES, momUsedCategories(), it.category || '') + '</select>',
        it.category) +
      momFieldHTML('Type', 'il-c-type',
        '<select class="pd-select pd-input-sm il-mi" data-f="type"' + d + '>' +
        // ⚠️ A blank option is offered because the column is nullable — without it an
        // untyped legacy row would silently read as the first option while the database
        // still holds null, the select-value trap the drawing register documents.
        '<option value="">—</option>' +
        MOM_TYPES.map(function (o) { return '<option' + (it.type === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') +
      '</select>', it.type) +
      momFieldHTML('Status', 'il-c-status',
        '<select class="pd-select pd-input-sm il-mi" data-f="status"' + d + '>' +
        // ⚠️ No blank option: `status` carries a CHECK and the handler deliberately
        // does NOT null-convert it, so an empty pick would write '' and be refused.
        // `present` carries any off-list legacy value through so the select shows the
        // truth instead of silently reporting 'Open' — the select-value trap.
        // ⚠️ Deliberately NOT momOptions(): that helper always emits a blank first
        // option, and picking it here would write '' into a CHECK-constrained column and
        // be refused by the database. The list is closed, so an off-list LEGACY value is
        // appended instead of being swallowed — otherwise the select silently reports
        // 'Open' while the row holds something else (the select-value trap).
        STATUSES.concat(it.status && STATUSES.indexOf(it.status) < 0 ? [it.status] : [])
          .map(function (o) {
            return '<option' + (it.status === o ? ' selected' : '') + '>' + Fmt.esc(o) + '</option>';
          }).join('') +
      '</select>',
        // ⚠️ Once raised, the REGISTER owns the status — the same rule the PDF follows.
        // Showing `mom_items.status` on a raised action would put a stale word in the
        // record beside a register pill saying something else.
        iss ? (iss.status || 'Open') : (it.status || 'Open')) +
      // Same roster as the register's Champion, so an action raised into an issue
      // carries a responsible the personal view can actually resolve.
      momFieldHTML('Responsible', 'il-c-owner',
        peoplePickerHTML('mom-own-' + it.id, it.owner_ids, it.owner, ro),
        championText(it.owner_ids, it.owner)) +
      momFieldHTML('Target date', 'il-c-due',
        '<input class="pd-input pd-input-sm il-mi" data-f="due_date" type="date" value="' + dateVal(it.due_date) + '"' + d + '>',
        it.due_date ? Fmt.date(it.due_date) : '') +
      '</div>' +
      // ---- the text blocks, full width so nothing is clipped ----------------
      momFieldHTML('Issue / Agenda', 'il-c-issue',
        '<input class="pd-input pd-input-sm il-mi" data-f="issue" value="' + Fmt.esc(it.issue || '') + '" placeholder="What was raised" ' + d + '>',
        it.issue) +
      momFieldHTML('Action item', 'il-c-act',
        '<input class="pd-input pd-input-sm il-mi" data-f="action_item" value="' + Fmt.esc(actText) + '" placeholder="What will be done" ' + d + '>',
        actText) +
      // ⚠️ Description is rendered here but was NOT on the old table, so it was a
      // column the screen could never show — the PDF printed it and the screen did
      // not. In reporting/read-only it appears only when it has something to say;
      // an empty labelled block on every action is noise in a printed record.
      // ⚠️ Blank when the action text CAME from `description` (a legacy row), or the
      // card shows the same sentence twice under two headings — the same rule the PDF
      // applies.
      ((ro && (!it.description || it.description === actText))
        ? ''
        : momFieldHTML('Description <span>optional</span>', 'il-c-desc',
            '<textarea class="pd-textarea il-mi" data-f="description" rows="2" placeholder="Any elaboration"' + d + '>' +
            Fmt.esc(it.description === actText ? '' : (it.description || '')) + '</textarea>',
            it.description === actText ? '' : it.description)) +
      // ---- the footer: the two things the PDF has no equivalent for ----------
      '<div class="il-mi-foot">' +
      '<div class="il-mi-f il-c-file"><label>File</label>' + momAttachCellHTML(it, ro) + '</div>' +
      '<div class="il-mi-f il-c-reg"><label>In the register</label>' + (it.issue_id
        // The status shown is the REGISTER's, read from `rows` — the minute does not keep
        // its own copy of it, so the two can never disagree.
        ? (iss
            ? '<span class="il-pill ' + statusClass(iss.status) + '" title="' + Fmt.esc(iss.description || '') + '">Raised · ' + Fmt.esc(iss.status || 'Open') + '</span>'
            // Linked, but not in the loaded register — say only what is known rather than
            // colouring it with a status we do not have.
            : '<span style="font-size:12px;color:var(--pd-muted);" title="Raised in the register">Raised</span>')
        // ⚠⚠ THE DEADLOCK THIS FIXES. Raising requires the minute to be DISTRIBUTED
        // (enforced in the DB by issues_lessons_ins), but this cell used to be gated on
        // `ro` — which is true the moment a minute is distributed. So a draft showed a
        // button that always refused, and distributing made the button disappear: there
        // was NO state in which an action could be raised at all.
        //
        // Raising is not an edit of the minute. It writes a REGISTER row (plus the
        // link), so the right test is "may I write the link" (mayEdit — the same rule
        // RLS applies to mom_items) AND "has it been issued" (locked). It is
        // deliberately AVAILABLE while locked, which is the whole point.
        : (!mayEdit
            ? '<span class="il-noedit" title="The recorder or a planner raises an action into the register">—</span>'
            : !locked
              // A disabled control that says why beats a live button that toasts an
              // error on every click — the state is visible before the click, not after.
              ? '<button class="pd-btn pd-btn-sm" disabled title="Distribute these minutes first — an issue in the register must come from a meeting record everyone can read.">Raise as issue</button>'
              : '<button class="pd-btn pd-btn-sm il-mi-raise">Raise as issue</button>')) + '</div>' +
      // ⚠️ Capturing a lesson is NOT an edit of the minute — it writes a row in the
      // library — so it is offered to anyone who may add records, on a distributed minute
      // or a draft alike, and it stays available when the minute is locked. Same reasoning
      // as the register cell above, without the distribution gate: a lesson carries no
      // provenance a reader must be able to open.
      '<div class="il-mi-f il-c-lesson"><label>Lesson</label>' + (function () {
        var ls = lessonsOfMomItem(it.id);
        if (ls.length) {
          return '<button class="pd-btn pd-btn-sm il-mi-lesson-open" data-lesson="' + Fmt.esc(ls[0].id) + '" ' +
            'title="' + Fmt.esc(clip(ls[0].lesson, 140)) + '">' +
            (ls.length > 1 ? ls.length + ' lessons' : 'Lesson captured') + '</button>';
        }
        return canAdd && !_momReport
          ? '<button class="pd-btn pd-btn-sm il-mi-lesson">+ Capture lesson</button>'
          : '<span class="il-noedit" title="No lesson captured from this action">—</span>';
      })() + '</div>' +
      (ro ? '' : '<div class="il-mi-f il-c-del"><button class="pd-btn pd-btn-sm pd-btn-danger il-mi-del" title="Remove this action">Remove</button></div>') +
      '</div>' +
    '</div>';
  }

  function momActChipHTML(id, ro) {
    if (!id) return '<span style="font-size:12px;color:var(--pd-muted);">Not linked to an activity.</span>';
    var nm = MOM_ACT_NAME[id];
    return '<span class="il-mom-chip"><code>' + Fmt.esc(id) + '</code>' +
      '<span id="il-mom-actname">' + (nm ? Fmt.esc(nm) : '') + '</span>' +
      (ro ? '' : '<button type="button" id="il-mom-actclear" title="Unlink">✕</button>') + '</span>';
  }

  // ---------------------------------------------------------- carry-over -----
  // "What is still open on that meeting?" — the set carry-over would bring forward.
  // ⚠️ For a RAISED action the REGISTER's status decides, not `mom_items.status`, which
  // is the same rule the screen and the PDF already follow. An action raised months ago
  // and since closed in the register must not be dragged into next week's agenda
  // because nobody went back to tick the box on the old minute.
  function momCarryable(mom) {
    return momItemsOf(mom.id).filter(function (it) {
      var iss = momIssueOf(it);
      return (iss ? (iss.status || 'Open') : (it.status || 'Open')) !== 'Closed';
    });
  }

  // ⚠️ CARRY-OVER COPIES THE REGISTER LINK RATHER THAN RE-RAISING. A carried action is
  // the SAME issue, discussed again — so `issue_id` comes across and the new minute
  // shows the register's live status. Re-raising would put a second competing issue in
  // the register for one problem, and copying the link also means the carried row has
  // no "Raise" button, so it cannot be double-raised by hand either.
  //
  // ⚠️ `issues_lessons.mom_id` is NOT moved: provenance names the meeting an issue was
  // FIRST raised from. That is what lets canDeleteMinute() ignore carried links.
  async function momCarryOver(fromId) {
    var target = MOMS.find(function (x) { return x.id === _momSel; });
    var src = MOMS.find(function (x) { return x.id === fromId; });
    if (!target || !src || !canEditMinute(target) || momLocked(target)) return;
    // The header is saved first: this re-renders, and a title typed a moment ago would
    // otherwise be thrown away by that repaint. Same reason as "+ Add action item".
    await momSaveHeader();

    // ⚠️ Idempotent by construction. Carrying twice from the same meeting must not
    // duplicate the agenda, so anything already carried from one of these source items
    // is skipped — and the button reports that rather than silently doing nothing.
    var already = {};
    momItemsOf(target.id).forEach(function (it) {
      if (it.carried_from_item_id) already[it.carried_from_item_id] = 1;
    });
    var take = momCarryable(src).filter(function (it) { return !already[it.id]; });
    if (!take.length) {
      UI.toast(momCarryable(src).length
        ? 'Every still-open action from those minutes has already been carried over.'
        : 'Nothing is still open on those minutes.', 'info');
      return;
    }
    var seq = momItemsOf(target.id).length;
    var payload = take.map(function (it, i) {
      return {
        mom_id: target.id, project_id: pid, seq: seq + i,
        item_no: it.item_no || null, category: it.category || null, type: it.type || null,
        issue: it.issue || null, description: it.description || '', action_item: it.action_item || null,
        owner: it.owner || null, due_date: it.due_date || null,
        // ⚠️ The status carried is the minute's own, not the register's. Where the two
        // differ the register is authoritative and the row displays ITS status anyway
        // (momItemRowHTML reads the linked issue), so copying the register's value here
        // would freeze a snapshot that goes stale the moment the issue moves.
        status: it.status || 'Open',
        issue_id: it.issue_id || null,
        carried_from_item_id: it.id
      };
    });
    try {
      var ins = await sb().from('mom_items').insert(payload).select();
      if (ins.error) throw ins.error;
      (ins.data || []).forEach(function (r) { MOM_ITEMS.push(r); });
      // Records where the agenda came from, once — a minute can be topped up from several
      // meetings, and only the first seeding is what "carried from" means.
      if (!target.carried_from_mom_id) {
        var u = await sb().from('meeting_minutes').update({ carried_from_mom_id: src.id }).eq('id', target.id);
        if (!u.error) target.carried_from_mom_id = src.id;
      }
      var linked = take.filter(function (it) { return it.issue_id; }).length;
      UI.toast('Carried over ' + take.length + ' action' + (take.length === 1 ? '' : 's') +
        (linked ? ' — ' + linked + ' still linked to the register' : ''), 'ok');
      renderMom();
    } catch (e) {
      UI.toast(/column|schema cache/i.test(e.message || '')
        ? 'Run migrations/2026-08-21-mom-schema-carryover-distribute.sql in Supabase first.'
        : e.message, 'error');
    }
  }

  // ------------------------------------------------------------- distribute ---
  // ⚠️ Distribution is the point the minutes become everyone's. Reverting does NOT
  // retract anything already raised into the register — those are their own rows and
  // someone may already be working them — so the confirmation says so rather than
  // letting a planner assume "revert" undoes the meeting's consequences.
  async function momSetDistributed(momId, on) {
    var mom = MOMS.find(function (x) { return x.id === momId; });
    if (!mom || !canEditMinute(mom)) return;
    if (on) {
      if (!confirm('Distribute "' + (mom.title || 'these minutes') +
        '"?\n\nEveryone on the project will be able to read them, and the form locks ' +
        'until you revert it to draft.')) return;
    } else {
      var raised = momItemsOf(momId).filter(function (i) { return i.issue_id; }).length;
      if (!confirm('Revert "' + (mom.title || 'these minutes') + '" to draft?' +
        '\n\nOnly you and planners will see them again.' +
        (raised ? '\n\n' + raised + ' issue(s) already raised in Issues & Concerns STAY there — ' +
          'reverting does not retract them.' : ''))) return;
    }
    var patch = { is_distributed: on, distributed_at: on ? new Date().toISOString() : null,
                  distributed_by: on ? UID : null };
    try {
      var u = await sb().from('meeting_minutes').update(patch).eq('id', momId);
      if (u.error) throw u.error;
      Object.assign(mom, patch);
      UI.toast(on ? 'Minutes distributed' : 'Reverted to draft', 'ok');
      renderMom();
    } catch (e) {
      UI.toast(/column|schema cache/i.test(e.message || '')
        ? 'Run migrations/2026-08-21-mom-schema-carryover-distribute.sql in Supabase first.'
        : e.message, 'error');
    }
  }

  // ------------------------------------------------------- activity search ----
  // Server-side, capped, and it says when it capped. A schedule can hold 40k
  // activities; this screen must not load them to offer a picker.
  async function momActSearch(q) {
    // ⚠️ PostgREST's or() is comma/parenthesis delimited, so those characters in the
    // query would corrupt the filter rather than search for themselves.
    q = String(q || '').replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (q.length < 2 || !pid) return null;
    var like = '%' + q + '%';
    var res = await sb().from('project_schedule')
      .select('activity_id,activity_name,activity_type')
      .eq('project_id', pid)
      .not('activity_id', 'is', null)
      .or('activity_id.ilike.' + like + ',activity_name.ilike.' + like)
      .limit(26);
    if (res.error) throw res.error;
    // A WBS summary is not an activity anyone holds a meeting about; the schedule
    // module's own picker excluded them too.
    return (res.data || []).filter(function (r) { return r.activity_type !== 'WBS Summary'; });
  }

  async function momResolveActName(id) {
    if (!id || MOM_ACT_NAME[id] !== undefined) return;
    try {
      var res = await sb().from('project_schedule').select('activity_name')
        .eq('project_id', pid).eq('activity_id', id).limit(1);
      MOM_ACT_NAME[id] = (res && !res.error && res.data && res.data[0] && res.data[0].activity_name) || '';
    } catch (e) { MOM_ACT_NAME[id] = ''; }
    // ⚠️ Patch the chip in place instead of re-rendering: a re-render here would throw
    // away whatever the planner has typed into the form while this was in flight.
    var el = $('il-mom-actname');
    if (el && $('il-mom-act') && $('il-mom-act').value === id) el.textContent = MOM_ACT_NAME[id] ? '· ' + MOM_ACT_NAME[id] : '';
  }

  // -------------------------------------------------------------- persist -----
  async function momSaveHeader() {
    var mom = MOMS.find(function (x) { return x.id === _momSel; });
    if (!mom || !canEditMinute(mom)) return false;
    var g = function (id) { var e = $(id); return e ? e.value : ''; };
    var payload = {
      title: g('il-mom-title').trim() || '(untitled)',
      meeting_date: g('il-mom-date') || null,
      location: g('il-mom-loc').trim() || null,
      meeting_type: g('il-mom-type').trim() || null,
      attendees: g('il-mom-att').trim() || null,
      notes: g('il-mom-notes').trim() || null,
      schedule_activity_id: g('il-mom-act').trim() || null,
    };
    try {
      var u = await sb().from('meeting_minutes').update(payload).eq('id', mom.id);
      if (u.error) throw u.error;
      Object.assign(mom, payload);
      return true;
    } catch (e) { UI.toast(e.message, 'error'); return false; }
  }

  // Action-item edits save on change, one field at a time — a planner typing into a
  // table expects it to stick, and a single Save that silently covers the header AND
  // every row is how a half-typed action gets written.
  async function momSaveItem(id, patch) {
    // ⚠️ The action item has no owner of its own — it belongs to its minute, so the
    // question is whether that MINUTE is mine. Same derivation as the policy.
    var it0 = MOM_ITEMS.find(function (x) { return x.id === id; });
    if (!it0 || !canEditMinute(MOMS.find(function (m) { return m.id === it0.mom_id; }))) return false;
    try {
      var u = await sb().from('mom_items').update(patch).eq('id', id);
      if (u.error) throw u.error;
      var it = MOM_ITEMS.find(function (x) { return x.id === id; });
      if (it) Object.assign(it, patch);
      return true;
    } catch (e) { UI.toast(e.message, 'error'); return false; }
  }

  // ⚠️ Raising is IDEMPOTENT by construction: the button is only rendered when
  // `issue_id` is null, and this re-checks before writing. Raising the same action
  // twice would put two competing issues in the register with no way to tell which one
  // anybody is working.
  async function momRaiseIssue(itemId) {
    var it = MOM_ITEMS.find(function (x) { return x.id === itemId; });
    if (!it) return;
    if (!canEditMinute(MOMS.find(function (m) { return m.id === it.mom_id; }))) return;
    if (it.issue_id) { UI.toast('Already raised — it is on the Issues & Concerns screen.', 'info'); return; }
    var mom = MOMS.find(function (x) { return x.id === it.mom_id; }) || {};
    // ⚠️ Refused on a DRAFT, and the database refuses it too (issues_lessons_ins now
    // tests mom_is_distributed). The register is the shared artefact: an issue raised
    // out of an unissued minute would carry "Raised at: …" provenance pointing at a
    // meeting record the reader is not allowed to open.
    if (!momLocked(mom)) {
      UI.toast('Distribute these minutes first — an issue in the register must come from a meeting record everyone can read.', 'warn');
      return;
    }
    // The ACTION is what gets chased, so that is what the register entry says. ⚠️ Not
    // `description`, which since the migration is the optional elaboration.
    var act = String(it.action_item || '').trim();
    if (!act) { UI.toast('Describe the action before raising it.', 'warn'); return; }
    // No translation any more — the two tables share one vocabulary. The fallback is
    // for a legacy row still holding null, which the migration also settles.
    var st = it.status || 'Open';
    var payload = {
      project_id: pid, type: 'Issue',
      description: act,
      // ⚠️ The ids travel with the name. Copying only the text would put the issue
      // in the register with a champion nobody's personal view could resolve —
      // which is the whole reason the ids exist.
      champion: it.owner || null,
      champion_ids: it.owner_ids || [],
      status: st,
      date_presented: mom.meeting_date || null,
      caused_by: mom.title ? ('Raised at: ' + mom.title) : null,
      // Defaulted from the raiser's profile, exactly as a new issue is (D1) — the
      // register groups by department, and it stays editable afterwards.
      department: (profile && profile.department) || null,
      mom_id: it.mom_id,
      created_by: UID,
    };
    try {
      var ins = await sb().from(TABLE).insert(payload).select().single();
      if (ins.error) throw ins.error;
      // ⚠️ Link the action to the issue only AFTER the insert succeeded. Writing the
      // link first and failing the insert would leave an action pointing at nothing,
      // which renders as "Raised" and hides the fact that nobody is chasing it.
      var ok = await momSaveItem(itemId, { issue_id: ins.data.id });
      if (!ok) throw new Error('Issue created but the link could not be saved — check Issues & Concerns for a duplicate before raising again.');
      // The register is loaded in this very module, so show the new issue immediately
      // rather than making the planner reload to find it.
      rows.unshift(ins.data);
      MOM_BY_ID[it.mom_id] = mom;
      if (window.PDSync) PDSync.cachePut(PID_PFX + ':' + pid, rows);
      populateFilterOptions();
      UI.toast('Raised in Issues & Concerns', 'ok');
      renderMom();
    } catch (e) { UI.toast(e.message, 'error'); }
  }


  // ------------------------------------------------------------ attachments ---
  // ⚠️ PRIVATE BUCKET. `attachment_url` stores the object PATH and the URL is signed
  // on demand, never stored — a stored signed URL is one that has already expired.
  // mom-app uses a PUBLIC bucket and stores the public URL, so anyone holding the
  // link reads the file with no login; that is deliberately not copied. Same
  // construction as the drawing register's `file_url`.
  var MOM_BUCKET = 'mom-attachments';

  function momAttachCellHTML(it, ro) {
    if (it.attachment_url) {
      return '<span class="il-mom-file">' +
        '<button class="pd-btn pd-btn-sm il-mi-fview" title="' + Fmt.esc(it.attachment_name || 'Open the attachment') + '">' +
          '<span data-ico="eye" data-ico-size="14"></span></button>' +
        (ro ? '' : '<button class="pd-btn pd-btn-sm pd-btn-danger il-mi-fdel" title="Remove the attachment">' +
          '<span data-ico="x" data-ico-size="13"></span></button>') +
      '</span>';
    }
    return ro ? '<span class="il-noedit">—</span>'
      : '<button class="pd-btn pd-btn-sm il-mi-fadd" title="Attach a photo or document">+ File</button>';
  }

  // ⚠️ ORDERING IS THE WHOLE GAME HERE, and each rule exists because the opposite
  // order leaves a real mess behind. The same four rules the material-submittal and
  // drawing-register attachment work settled on:
  //   1. UPLOAD FIRST, then write the row — a failed upload must never leave a row
  //      pointing at an object that does not exist.
  //   2. If the row write then fails, DELETE WHAT WAS JUST UPLOADED — otherwise the
  //      object is orphaned in the bucket with nothing referencing it.
  //   3. On replace, delete the OLD object only AFTER the row points at the new one.
  //   4. On remove, null the row FIRST, then delete the object — a failed delete
  //      leaves an orphan (recoverable), where the reverse leaves a row pointing at
  //      nothing (renders as an attachment that will not open).
  async function momAttachUpload(itemId, file) {
    var it = MOM_ITEMS.find(function (x) { return x.id === itemId; });
    if (!it || !file) return;
    var mom = MOMS.find(function (m) { return m.id === it.mom_id; });
    if (!canEditMinute(mom) || momLocked(mom)) return;
    // 25 MB: a site photo or a tabled PDF, not a drawing set. Refused before the
    // upload rather than after, so nobody waits for a transfer that will be rejected.
    if (file.size > 25 * 1024 * 1024) {
      UI.toast('That file is ' + Math.round(file.size / 1048576) + ' MB — attachments are capped at 25 MB.', 'warn');
      return;
    }
    var old = it.attachment_url || null;
    // Path is scoped by project and item so two meetings cannot collide, and the
    // timestamp keeps a re-upload from overwriting the object a row still points at.
    var safe = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    var path = pid + '/' + it.mom_id + '/' + itemId + '-' + Date.now() + '-' + safe;
    UI.toast('Uploading ' + safe + '…', 'info');
    try {
      var up = await sb().storage.from(MOM_BUCKET).upload(path, file, { upsert: false });
      if (up.error) throw up.error;
      var okRow = await momSaveItem(itemId, { attachment_url: path, attachment_name: file.name || safe });
      if (!okRow) {
        // Rule 2 — roll the object back rather than orphan it.
        try { await sb().storage.from(MOM_BUCKET).remove([path]); } catch (e) {}
        return;
      }
      // Rule 3 — the row already points at the new object, so the old one is safe
      // to drop. A failure here is an orphan, not data loss, so it does not throw.
      if (old) { try { await sb().storage.from(MOM_BUCKET).remove([old]); } catch (e) {} }
      UI.toast('Attached', 'ok');
      renderMom();
    } catch (e) {
      UI.toast(/bucket|not found/i.test(e.message || '')
        ? 'Run migrations/2026-08-21-mom-type-and-attachments.sql in Supabase first.'
        : 'Upload failed: ' + ((e && e.message) || e), 'error');
    }
  }

  async function momAttachRemove(itemId) {
    var it = MOM_ITEMS.find(function (x) { return x.id === itemId; });
    if (!it || !it.attachment_url) return;
    var mom = MOMS.find(function (m) { return m.id === it.mom_id; });
    if (!canEditMinute(mom) || momLocked(mom)) return;
    if (!confirm('Remove "' + (it.attachment_name || 'this file') + '" from this action?\n\nThe file is deleted.')) return;
    var path = it.attachment_url;
    // Rule 4 — the row stops pointing at it first.
    if (!await momSaveItem(itemId, { attachment_url: null, attachment_name: null })) return;
    try { await sb().storage.from(MOM_BUCKET).remove([path]); } catch (e) {}
    UI.toast('Attachment removed', 'ok');
    renderMom();
  }

  // ⚠️ Signed on demand and opened immediately. 60s is plenty to hand the URL to the
  // browser and is the same window the other registers use — the link is not meant to
  // be copied out and shared, which is the point of the bucket being private.
  async function momAttachOpen(itemId) {
    var it = MOM_ITEMS.find(function (x) { return x.id === itemId; });
    if (!it || !it.attachment_url) return;
    try {
      var r = await sb().storage.from(MOM_BUCKET).createSignedUrl(it.attachment_url, 60);
      if (r.error) throw r.error;
      window.open(r.data.signedUrl, '_blank', 'noopener');
    } catch (e) {
      UI.toast('Could not open the attachment: ' + ((e && e.message) || e), 'error');
    }
  }

  // Every attachment under a set of action items — used before a delete, while the
  // rows are still in memory to read the paths from.
  function momPathsOf(items) {
    return items.map(function (x) { return x.attachment_url; }).filter(Boolean);
  }

  // ------------------------------------------------------------------- pdf ----
  // ⚠️ The layout below is the standalone mom-app's `downloadPDF()` reproduced field
  // for field — same red header band, same six-column meta grid, same grey field
  // blocks, same badge palette, same html2pdf/jsPDF settings — so a minute exported
  // from here and one exported from that app are the SAME sheet. Do not "tidy" the
  // inline styles into module.css: html2canvas rasterises this DOM, and the module's
  // own stylesheet deliberately does not reach it (a themed export would come out dark).
  var MOM_PDF_BADGE = {
    'open': 'background:#d4f5d4;color:#1a8f3a;',
    'closed': 'background:#e5e5ea;color:#666;',
    'on hold': 'background:#fff3cd;color:#b06800;',
    // ⚠️ RETAINED although no row can hold 'In Progress' since the 2026-08-22
    // migration. An export runs against MOM_ITEMS in memory, so a tab opened before the
    // migration can still print a stale value — and dropping the key would render it in
    // the default grey, the same grey as Closed. One line, and it fails safe.
    'in progress': 'background:#fff3cd;color:#b06800;',
    'issue': 'background:#fde8e8;color:#b40000;',
    'fyi': 'background:#e8f0fe;color:#1a56db;',
    'report': 'background:#f3e8ff;color:#6b21a8;'
  };
  function momPdfBadge(val) {
    var s = MOM_PDF_BADGE[String(val || '').toLowerCase()] || 'background:#eee;color:#333;';
    return '<span style="' + s + ';font-size:9px;font-weight:700;padding:2px 8px;border-radius:20px;' +
      'display:inline-block;">' + Fmt.esc(val || '-') + '</span>';
  }
  function momPdfCell(label, val, mono) {
    return '<div style="background:#f7f7f8;border-radius:5px;padding:6px 8px;border:1px solid #e5e5ea;">' +
      '<div style="font-size:8px;font-weight:600;color:#8e8e93;text-transform:uppercase;margin-bottom:2px;">' + label + '</div>' +
      '<div style="font-size:10px;' + (mono ? 'font-family:monospace;' : '') + '">' + Fmt.esc(val || '-') + '</div></div>';
  }
  function momPdfField(label, val) {
    // Newlines survive as <br> — the notes field is multi-line, and a flattened
    // paragraph is not the record of what was said.
    var safe = Fmt.esc(val || '-').replace(/\n/g, '<br>');
    return '<div style="margin-bottom:6px;background:#f7f7f8;border-radius:6px;padding:7px 10px;border:1px solid #e5e5ea;">' +
      '<div style="font-size:8px;font-weight:600;color:#8e8e93;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">' + label + '</div>' +
      '<div style="font-size:10px;color:#1c1c1e;word-break:break-word;">' + safe + '</div></div>';
  }

  async function momDownloadPDF(momId) {
    var mom = MOMS.find(function (x) { return x.id === momId; });
    if (!mom) return;
    if (typeof html2pdf !== 'function') {
      UI.toast('The PDF library did not load — check the connection and reload.', 'error');
      return;
    }
    var btn = $('il-mom-pdf'), orig = btn ? btn.innerHTML : '';
    if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }
    var wrap = null, holder = null;
    try {
      var items = momItemsOf(mom.id);
      var filename = (mom.title || 'Meeting').replace(/[^a-zA-Z0-9_]/g, '_') +
        (momLocked(mom) ? '' : '_DRAFT') + '_MOM.pdf';

      var cards = items.map(function (it, i) {
        var iss = momIssueOf(it);
        // ⚠️ Rows written before the migration hold their action text in `description`.
        var actText = it.action_item || it.description;
        return '<div style="margin-bottom:14px;padding:12px;border:1px solid #ddd;border-radius:8px;break-inside:avoid;">' +
          '<div style="display:grid;grid-template-columns:0.4fr 1.5fr 0.9fr 0.9fr 1.2fr 1fr;gap:5px;margin-bottom:8px;">' +
            momPdfCell('No.', it.item_no || String((it.seq == null ? i : it.seq) + 1), true) +
            momPdfCell('Category', it.category) +
            '<div style="background:#f7f7f8;border-radius:5px;padding:6px 8px;border:1px solid #e5e5ea;">' +
              '<div style="font-size:8px;font-weight:600;color:#8e8e93;text-transform:uppercase;margin-bottom:2px;">Type</div>' +
              // ⚠️ Falls back to the register link only when the row is untyped — legacy
              // rows predate the `type` column, and printing a dash for every one of them
              // would lose a true statement the export can still make about them.
              momPdfBadge(it.type || (it.issue_id ? 'Issue' : 'FYI')) + '</div>' +
            '<div style="background:#f7f7f8;border-radius:5px;padding:6px 8px;border:1px solid #e5e5ea;">' +
              '<div style="font-size:8px;font-weight:600;color:#8e8e93;text-transform:uppercase;margin-bottom:2px;">Status</div>' +
              // ⚠️ Once raised, the REGISTER owns the status — the same rule the screen
              // follows. Printing `mom_items.status` for a raised action would put a
              // stale status on paper that outlives the screen showing the live one.
              momPdfBadge(iss ? (iss.status || 'Open') : (it.status || 'Open')) + '</div>' +
            momPdfCell('Responsible', it.owner) +
            momPdfCell('Target Date', it.due_date ? Fmt.date(it.due_date) : '', true) +
          '</div>' +
          // mom-app's three text blocks, now backed by three real columns.
          // ⚠️ Each falls back to what the row can still truthfully say, because rows
          // written before the migration hold their action text in `description`.
          momPdfField('Issue / Agenda', it.issue) +
          momPdfField('Action Item', actText) +
          // Blank when the action text CAME from description (a legacy row), or the
          // sheet prints the same sentence twice under two different headings.
          momPdfField('Description', it.description !== actText ? it.description : '') +
          // Not a mom-app block: mom-app has no register to point at. Printed only when
          // the action has actually been raised, so it never adds an empty row.
          // Named, never embedded: the bucket is private, so a link in the sheet would
          // be dead for whoever opens the PDF. Saying a file exists is the useful half.
          (it.attachment_name ? momPdfField('Attachment', it.attachment_name) : '') +
          (iss ? momPdfField('Status in Issues & Concerns',
            (iss.status || 'Open') + (iss.champion ? ' · champion ' + iss.champion : '') +
            (it.carried_from_item_id ? ' · carried over from an earlier meeting' : '')) : '') +
        '</div>';
      }).join('');

      // ⚠️ A plain detached element, not a full document string: html2canvas renders
      // whatever DOM it is handed, and reusing the module's own markup would drag the
      // dark-theme variables in with it.
      // ⚠️⚠️ THE EXPORTED NODE MUST BE IN NORMAL FLOW. DO NOT PUT `position:fixed`
      // (or absolute) BACK ON `wrap`. It used to carry `position:fixed;left:-10000px`
      // to park itself off-screen, and that produced a COMPLETELY BLANK PDF — every
      // sheet was an empty A4 page whose content stream held nothing but a line width.
      //
      // Why: html2pdf clones the source into its own container and measures it there.
      // An out-of-flow element contributes NOTHING to that container's height, so
      // html2canvas got the right width and a height of ZERO and rendered no image at
      // all (measured: canvas 1438x0, and `/XObject <<>>` empty in the produced file).
      // An explicit `height` does not save it — the clone is still out of flow.
      //
      // So the OFF-SCREEN PARKING MOVES TO A HOLDER and the captured element stays in
      // normal flow inside it. The holder is what hides the node; `wrap` is what gets
      // rendered. Measured after the change: canvas 1438x360 with real content.
      holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:190mm;';

      wrap = document.createElement('div');
      wrap.style.cssText = 'font-family:Arial,sans-serif;font-size:9px;color:#1c1c1e;width:190mm;' +
        'padding:15mm 10mm;box-sizing:border-box;background:#fff;';

      // Header fields this module records and mom-app does not. They are the minute's
      // substance — dropping them to match a narrower app would export a worse record —
      // so they print in the same field blocks, above the actions.
      var head = '';
      if (mom.attendees) head += momPdfField('Attendees', mom.attendees);
      if (mom.schedule_activity_id) {
        head += momPdfField('Activity discussed', mom.schedule_activity_id +
          (MOM_ACT_NAME[mom.schedule_activity_id] ? ' · ' + MOM_ACT_NAME[mom.schedule_activity_id] : ''));
      }
      if (mom.notes) head += momPdfField('Notes / discussion', mom.notes);
      if (head) head = '<div style="margin-bottom:14px;">' + head + '</div>';

      wrap.innerHTML =
        '<div style="background:#b40000;padding:14px 20px;margin:-20px -20px 18px -20px;display:flex;justify-content:space-between;align-items:center;">' +
          '<img src="../../assets/img/logo-white.png" style="height:26px;width:auto;" crossorigin="anonymous"/>' +
          '<div style="text-align:right;">' +
            '<div style="font-size:12px;font-weight:700;color:#fff;">' +
              // ⚠️ An undistributed minute MUST say so on paper. A PDF outlives the screen
              // that knows it was a draft, and a sheet that reads as issued minutes when
              // nobody has issued them is the one way this export can mislead.
              (momLocked(mom) ? '' : '<span style="background:#fff;color:#b40000;font-size:9px;' +
                'font-weight:800;padding:2px 7px;border-radius:3px;letter-spacing:0.08em;' +
                'margin-right:8px;vertical-align:middle;">DRAFT</span>') +
              Fmt.esc(projName) + ' — ' + Fmt.esc(mom.title || 'Meeting') + '</div>' +
            '<div style="font-size:9px;color:rgba(255,255,255,0.85);margin-top:3px;">📅 ' +
              Fmt.esc(mom.meeting_date ? Fmt.date(mom.meeting_date) : '-') + '   📍 ' + Fmt.esc(mom.location || '-') +
              '   (' + items.length + ' item' + (items.length !== 1 ? 's' : '') + ')</div>' +
          '</div>' +
        '</div>' + head +
        (items.length ? cards : momPdfField('Action items', 'No action items were recorded on these minutes.'));

      // ⚠️ Must be IN the document: html2canvas measures a laid-out element, and an
      // orphan node has no box. The HOLDER is parked off-screen so the page does not
      // jump; `wrap` sits in normal flow inside it (see the warning above).
      holder.appendChild(wrap);
      document.body.appendChild(holder);

      await html2pdf().set({
        margin: [10, 10, 10, 10],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: true, logging: false, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      }).from(wrap).save();

      UI.toast('PDF downloaded', 'ok');
    } catch (e) {
      UI.toast('PDF error: ' + ((e && e.message) || e), 'error');
    } finally {
      // ⚠️ In `finally`: a throw mid-render would otherwise leave the off-screen node
      // in the document, and every later export would stack another one.
      // Removing the holder takes `wrap` with it.
      if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
  }

  // ---------------------------------------------------------------- wire ------
  function wireMom() {
    var host = $('il-mom-view'); if (!host) return;
    host.querySelectorAll('[data-mom]').forEach(function (b) {
      // ⚠️ Filters are cleared on switching minutes. They belong to the set of actions
      // being looked at, and carrying one across would open the next meeting already
      // filtered — showing "no action items" on a minute that has plenty.
      b.onclick = function () {
        if (_momSel !== b.dataset.mom) _momF = { q: '', cat: '', type: '', status: '' };
        _momSel = b.dataset.mom; renderMom();
      };
    });
    var nb = host.querySelector('#il-mom-new');
    if (nb) nb.onclick = async function () {
      try {
        var ins = await sb().from('meeting_minutes').insert({
          project_id: pid, title: 'Meeting ' + Fmt.date(momToday()),
          meeting_date: momToday(), created_by: UID }).select().single();
        if (ins.error) throw ins.error;
        MOMS.unshift(ins.data); _momSel = ins.data.id; _momErr = ''; renderMom();
      } catch (e) {
        UI.toast(/relation|does not exist|schema cache/i.test(e.message || '')
          ? 'Run migrations/2026-08-19-duration-scenarios-and-mom.sql in Supabase first.' : e.message, 'error');
      }
    };
    if (!_momSel) return;
    momResolveActName(($('il-mom-act') || {}).value);

    // ⚠️ Re-rendering on every keystroke would destroy the input and its focus, so
    // the value is kept in module state and the caret is restored after the repaint.
    // The list is already in memory — there is no request to debounce.
    var mq = host.querySelector('#il-mom-q');
    if (mq) mq.oninput = function () {
      _momQ = mq.value; var at = mq.selectionStart;
      renderMom();
      var again = $('il-mom-q');
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (e) {} }
    };

    var fq = host.querySelector('#il-momf-q');
    if (fq) fq.oninput = function () {
      _momF.q = fq.value; var at = fq.selectionStart;
      renderMom();
      var again = $('il-momf-q');
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (e) {} }
    };
    [['il-momf-cat', 'cat'], ['il-momf-type', 'type'], ['il-momf-status', 'status']].forEach(function (pair) {
      var el = host.querySelector('#' + pair[0]);
      if (el) el.onchange = function () { _momF[pair[1]] = el.value; renderMom(); };
    });
    var fc = host.querySelector('#il-momf-clear');
    if (fc) fc.onclick = function () { _momF = { q: '', cat: '', type: '', status: '' }; renderMom(); };

    var rep = host.querySelector('#il-mom-report');
    if (rep) rep.onclick = function () { _momReport = !_momReport; renderMom(); };

    var dist = host.querySelector('#il-mom-dist');
    if (dist) dist.onclick = function () {
      var cur = MOMS.find(function (x) { return x.id === _momSel; });
      momSetDistributed(_momSel, !momLocked(cur));
    };

    var cgo = host.querySelector('#il-mom-carrygo');
    if (cgo) cgo.onclick = function () {
      var sel = host.querySelector('#il-mom-carryfrom');
      if (!sel || !sel.value) { UI.toast('Pick the meeting to carry actions from.', 'warn'); return; }
      momCarryOver(sel.value);
    };

    var pb = host.querySelector('#il-mom-pdf');
    // ⚠ Saves the header first when the user may edit: the export reads MOMS, not
    // the form, so a title typed and not saved would be missing from the sheet.
    if (pb) pb.onclick = async function () {
      var cur = MOMS.find(function (x) { return x.id === _momSel; });
      // ⚠️ Not when locked: the form is disabled, so this would be a pointless write
      // to a distributed minute — and one that bumps its updated_at for nothing.
      if (cur && canEditMinute(cur) && !momLocked(cur)) await momSaveHeader();
      await momDownloadPDF(_momSel);
    };
    var sv = host.querySelector('#il-mom-save');
    if (sv) sv.onclick = async function () { if (await momSaveHeader()) { UI.toast('Minutes saved', 'ok'); renderMom(); } };

    var ai = host.querySelector('#il-mom-additem');
    if (ai) ai.onclick = async function () {
      // The header is saved first: adding a row re-renders, and a title typed a moment
      // ago would be thrown away by that repaint.
      await momSaveHeader();
      try {
        var seq = momItemsOf(_momSel).length;
        var ins = await sb().from('mom_items').insert({
          mom_id: _momSel, project_id: pid, seq: seq, description: '', action_item: '',
          // ⚠️ Defaults to FYI, not Issue: most minuted lines are information, and a row
          // that defaults to Issue would have every new action pre-classified as a
          // problem before anyone typed what it was.
          type: 'FYI', status: 'Open' }).select().single();
        if (ins.error) throw ins.error;
        MOM_ITEMS.push(ins.data); renderMom();
      } catch (e) { UI.toast(e.message, 'error'); }
    };

    host.querySelectorAll('.il-mi').forEach(function (f) {
      f.onchange = function () {
        var id = f.closest('[data-item]').dataset.item, fld = f.dataset.f, patch = {};
        var v = f.value.trim ? f.value.trim() : f.value;
        // ⚠️ Empty means NULL on every nullable column, not the empty string.
        // `type` carries a CHECK (Issue | FYI | Report); writing '' when the planner
        // picks the blank option would be REFUSED by the database, and the other new
        // columns would silently store '' where every read tests for null.
        patch[fld] = (fld === 'due_date' || !v) && fld !== 'description' && fld !== 'status'
          ? (v || null) : v;
        momSaveItem(id, patch);
      };
    });
    // ⚠️ ONE hidden <input type=file> reused by every row, not one per row: a table of
    // 40 actions would otherwise carry 40 file inputs, and the row that owns the
    // pending pick is tracked instead.
    var fin = host.querySelector('#il-mom-fileinput');
    host.querySelectorAll('.il-mi-fadd').forEach(function (b) {
      b.onclick = function () {
        if (!fin) return;
        fin.dataset.item = b.closest('[data-item]').dataset.item;
        fin.value = '';            // so re-picking the same file still fires change
        fin.click();
      };
    });
    if (fin) fin.onchange = function () {
      var id = fin.dataset.item, f = fin.files && fin.files[0];
      fin.value = '';
      if (id && f) momAttachUpload(id, f);
    };
    host.querySelectorAll('.il-mi-fview').forEach(function (b) {
      b.onclick = function () { momAttachOpen(b.closest('[data-item]').dataset.item); };
    });
    host.querySelectorAll('.il-mi-fdel').forEach(function (b) {
      b.onclick = function () { momAttachRemove(b.closest('[data-item]').dataset.item); };
    });

    host.querySelectorAll('.il-mi-raise').forEach(function (b) {
      b.onclick = function () { momRaiseIssue(b.closest('[data-item]').dataset.item); };
    });
    host.querySelectorAll('.il-mi-lesson').forEach(function (b) {
      b.onclick = function () {
        var id = b.closest('[data-item]').dataset.item;
        var it = MOM_ITEMS.find(function (x) { return x.id === id; }) || {};
        // Carries the register link across when the action was already raised, so the
        // lesson points at the issue rather than only at the meeting.
        newLesson({ mom_id: it.mom_id, mom_item_id: id, issue_id: it.issue_id || null });
      };
    });
    host.querySelectorAll('.il-mi-lesson-open').forEach(function (b) {
      b.onclick = function () { openLesson(b.dataset.lesson); };
    });
    // ⚠️ Saves on change, one field at a time — the same rule the rest of this card
    // follows. A Save button covering the header AND every action is how a half-typed
    // action gets written.
    wirePeople(host, function (key, ids, text) {
      if (key.indexOf('mom-own-') !== 0) return;
      var id = key.slice('mom-own-'.length);
      momSaveItem(id, { owner_ids: ids, owner: championText(ids, text) || null });
    });
    host.querySelectorAll('.il-mi-del').forEach(function (b) {
      b.onclick = async function () {
        var id = b.closest('[data-item]').dataset.item;
        var it = MOM_ITEMS.find(function (x) { return x.id === id; });
        // ⚠️ Removing the action does NOT remove the issue it raised — the register is
        // its own record and someone may already be working it. Said out loud, because
        // the opposite is a reasonable thing to assume.
        if (!confirm('Remove this action item?' +
          (it && it.attachment_url ? '\n\nIts attached file is deleted too.' : '') +
          (it && it.issue_id
          ? '\n\nThe issue it raised STAYS in Issues & Concerns — this only removes the line from these minutes.' : ''))) return;
        // ⚠️ Read the path BEFORE the row leaves memory, or there is nothing left to
        // name the object with and it is orphaned in the bucket forever.
        var paths = momPathsOf(it ? [it] : []);
        try {
          var dl = await sb().from('mom_items').delete().eq('id', id);
          if (dl.error) throw dl.error;
          if (paths.length) { try { await sb().storage.from(MOM_BUCKET).remove(paths); } catch (e) {} }
          MOM_ITEMS = MOM_ITEMS.filter(function (x) { return x.id !== id; });
          renderMom();
        } catch (e) { UI.toast(e.message, 'error'); }
      };
    });

    var db = host.querySelector('#il-mom-del');
    if (db) db.onclick = async function () {
      var items = momItemsOf(_momSel), raised = items.filter(function (i) { return i.issue_id; }).length;
      // ⚠️ Same rule as the single-action delete: capture the paths first. The action
      // rows go by `on delete cascade`, so after this they cannot be queried at all.
      var paths = momPathsOf(items);
      if (!confirm('Delete these minutes and their ' + items.length + ' action item(s)?' +
        (paths.length ? '\n\n' + paths.length + ' attached file(s) are deleted too.' : '') +
        (raised ? '\n\n' + raised + ' issue(s) already raised in Issues & Concerns will REMAIN — they simply stop pointing back at a meeting.' : ''))) return;
      try {
        var dl = await sb().from('meeting_minutes').delete().eq('id', _momSel);
        if (dl.error) throw dl.error;
        if (paths.length) { try { await sb().storage.from(MOM_BUCKET).remove(paths); } catch (e) {} }
        MOM_ITEMS = MOM_ITEMS.filter(function (x) { return x.mom_id !== _momSel; });
        MOMS = MOMS.filter(function (x) { return x.id !== _momSel; });
        _momSel = null; UI.toast('Minutes deleted', 'ok'); renderMom();
      } catch (e) { UI.toast(e.message, 'error'); }
    };

    // ---- the activity picker ----
    var clr = host.querySelector('#il-mom-actclear');
    if (clr) clr.onclick = function () {
      $('il-mom-act').value = '';
      $('il-mom-actsel').innerHTML = momActChipHTML('', false);
      wireMom();
    };
    var q = host.querySelector('#il-mom-actq'), res = host.querySelector('#il-mom-acres');
    if (q && res) {
      var close = function () { res.hidden = true; res.innerHTML = ''; };
      q.oninput = function () {
        var term = q.value;
        if (_momActTimer) clearTimeout(_momActTimer);
        if (String(term).trim().length < 2) { close(); return; }
        _momActTimer = setTimeout(async function () {
          try {
            var hits = await momActSearch(term);
            if (hits === null) { close(); return; }
            res.hidden = false;
            res.innerHTML = hits.length
              ? hits.slice(0, 25).map(function (r) {
                  return '<button type="button" data-act="' + Fmt.esc(r.activity_id) + '" data-actn="' + Fmt.esc(r.activity_name || '') + '">' +
                    '<b>' + Fmt.esc(r.activity_id) + '</b> — ' + Fmt.esc(r.activity_name || '(unnamed)') + '</button>';
                }).join('') + (hits.length > 25 ? '<div class="il-mom-acnote">More than 25 match — keep typing to narrow.</div>' : '')
              : '<div class="il-mom-acnote">No activity in this project matches.</div>';
            res.querySelectorAll('[data-act]').forEach(function (b) {
              b.onclick = function () {
                var id = b.dataset.act;
                MOM_ACT_NAME[id] = b.dataset.actn || '';
                $('il-mom-act').value = id;
                $('il-mom-actsel').innerHTML = momActChipHTML(id, false);
                var nm = $('il-mom-actname'); if (nm && MOM_ACT_NAME[id]) nm.textContent = '· ' + MOM_ACT_NAME[id];
                q.value = ''; close(); wireMom();
              };
            });
          } catch (e) {
            res.hidden = false;
            res.innerHTML = '<div class="il-mom-acnote">Could not search the schedule: ' + Fmt.esc(e.message || 'failed') + '</div>';
          }
        }, 250);
      };
      q.onkeydown = function (e) { if (e.key === 'Escape') { close(); e.stopPropagation(); } };
      // ⚠️ Bound ONCE for the life of the page, not per wireMom() call — wireMom runs on
      // every render and on every picker interaction, so a listener added here would
      // accumulate. It looks the picker up by id each time instead of closing over it.
      if (!_momDocClick) {
        _momDocClick = function (e) {
          var r = $('il-mom-acres'), i = $('il-mom-actq');
          if (r && !r.hidden && !r.contains(e.target) && e.target !== i) { r.hidden = true; r.innerHTML = ''; }
        };
        document.addEventListener('click', _momDocClick);
      }
    }
  }

  return { init: init };
})();
