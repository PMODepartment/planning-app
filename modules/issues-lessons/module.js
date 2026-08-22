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
  var screen = 'issues';               // 'issues' | 'lessons' | 'mom'
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
  function wireModalCursor(m, r) { if (!r || !r.id) return; var oc = m.close; m.close = function () { broadcastCollabSel(null); oc(); }; broadcastCollabSel(r.id, true); m.el.addEventListener('click', function (e) { if (e.target === m.el) broadcastCollabSel(null); }); }
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
  function hasLesson(r) { return !!(r.lesson_learned && r.lesson_learned.trim()); }

  // ========================================================================
  async function init(user, prof) {
    profile = prof;
    UID = (user && user.id) || (prof && prof.id) || null;
    _collabSelf = { id: UID, name: (prof && (prof.name || prof.email)) || 'Someone' };
    isSteward = ['super_admin', 'admin', 'planner'].indexOf(prof.role) >= 0;
    canAdd = !!prof && prof.status === 'approved' && prof.role !== 'viewer';
    canWrite = canAdd;

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

    $('il-new').onclick = function () { openForm(null); };
    $('il-refresh').onclick = function () {
      if (screen === 'mom') { momReset(); renderMom(); }   // renderMom re-fetches when unloaded
      load();
    };
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
    // "+ New issue" is planner+ and belongs to the Issues screen.
    var show = canWrite && screen === 'issues';
    $('il-new').style.display = show ? '' : 'none';
    $('il-sep').style.display = show ? '' : 'none';
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
      if (hasLesson(r) && r.lesson_category) cats[r.lesson_category] = 1;
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

  function renderIssues() {
    renderIssueKpis();
    var anyF = ['search', 'status', 'department', 'champion', 'aging'].some(function (k) { return iFilters[k]; });
    var clr = $('il-clearfilters'); if (clr) clr.hidden = !anyF;

    var t = $('il-table');
    if (!pid) return;
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

    t.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () { openForm(rows.find(function (x) { return x.id === b.dataset.edit; })); };
    });
    t.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () { del(b.dataset.del); };
    });
    if (window.Icons) Icons.hydrate(t);
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

  // ------------------------------------------------------------ Lessons ------
  function lessonsFiltered() {
    return rows.filter(hasLesson).filter(function (r) {
      if (lFilters.department && r.department !== lFilters.department) return false;
      if (lFilters.category && r.lesson_category !== lFilters.category) return false;
      if (lFilters.search) {
        var hay = [r.lesson_learned, r.recommendation, r.description, r.lesson_category]
          .join(' ').toLowerCase();
        if (hay.indexOf(lFilters.search) === -1) return false;
      }
      return true;
    });
  }

  function renderLessons() {
    var all = rows.filter(hasLesson);
    var closed = all.filter(function (r) { return r.status === 'Closed'; }).length;
    var cats = {}; all.forEach(function (r) { if (r.lesson_category) cats[r.lesson_category] = 1; });
    $('il-lkpis').innerHTML =
      kpi('Lessons captured', all.length, '') +
      kpi('From closed items', closed, 'is-closed') +
      kpi('Categories', Object.keys(cats).length, '');

    var anyF = ['search', 'department', 'category'].some(function (k) { return lFilters[k]; });
    var clr = $('il-lclearfilters'); if (clr) clr.hidden = !anyF;

    var host = $('il-lessons-view');
    if (!pid) { host.innerHTML = ''; return; }
    if (!all.length) {
      host.innerHTML = '<div class="il-empty"><span data-ico="bulb" data-ico-size="40"></span>' +
        '<div class="il-empty-title">No lessons captured yet.</div>' +
        '<div>Open any issue and fill in its <strong>Lessons Learned</strong> section — it will appear here.</div>' +
        '</div>';
      if (window.Icons) Icons.hydrate(host);
      return;
    }
    var data = lessonsFiltered();
    if (!data.length) {
      host.innerHTML = '<div class="il-empty"><div class="il-empty-title">No lessons match the current filters.</div></div>';
      return;
    }
    host.innerHTML = '<div class="il-lessons">' + data.map(function (r) {
      return '<div class="il-lcard">' +
        '<div class="il-lcard-top">' +
          (r.lesson_category ? '<span class="il-chip is-cat">' + Fmt.esc(r.lesson_category) + '</span>' : '') +
          (r.department ? '<span class="il-chip">' + Fmt.esc(r.department) + '</span>' : '') +
          '<span class="il-lcard-date">' + Fmt.date(r.date_resolved || r.date_presented) + '</span>' +
        '</div>' +
        '<div class="il-lcard-lesson">' + Fmt.esc(r.lesson_learned) + '</div>' +
        (r.recommendation && r.recommendation.trim()
          ? '<div class="il-lcard-rec"><b>Recommendation:</b> ' + Fmt.esc(r.recommendation) + '</div>' : '') +
        '<div class="il-lcard-src"><span class="il-src-issue">From issue:</span> ' +
          Fmt.esc(clip(r.description, 140)) +
          ' <span class="il-pill ' + statusClass(r.status) + '" style="transform:scale(.85);">' +
          Fmt.esc(r.status || 'Open') + '</span></div>' +
        (canWrite ? '<button class="il-lcard-open" data-open="' + r.id + '">Edit this issue &amp; lesson →</button>' : '') +
      '</div>';
    }).join('') + '</div>';

    host.querySelectorAll('[data-open]').forEach(function (b) {
      b.onclick = function () { openForm(rows.find(function (x) { return x.id === b.dataset.open; })); };
    });
    if (window.Icons) Icons.hydrate(host);
  }

  function clip(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n).trim() + '…' : s;
  }

  // ---------------------------------------------------------- Add / Edit -----
  function openForm(r) {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    if (!canAdd) return;
    // ⚠️ Checked here, not only on the row button: an edit the DATABASE will refuse must
    // not open a form at all. Letting someone fill one in and bounce the save is how a
    // permission boundary reads as a bug.
    if (r && !canEditRow(r)) {
      UI.toast('This issue was raised by someone else — ask a planner to change it.', 'warn');
      return;
    }
    var isNew = !r; r = r || {};

    function opts(list, val, blank) {
      return (blank ? '<option value="">' + blank + '</option>' : '') +
        list.map(function (o) { return '<option' + (val === o ? ' selected' : '') + '>' + o + '</option>'; }).join('');
    }

    var m = UI.modal(
      '<h2 style="margin-top:0;">' + (isNew ? 'Log issue / concern' : 'Edit issue / concern') + '</h2>' +

      '<div class="il-form-sec">Details</div>' +
      '<div class="il-form-row">' +
        // ⚠️ Defaults from the raiser's PROFILE on a new issue (D1). Typing it every time
        // invites the typo that silently splits the register's own Department filter in
        // two — the same failure the group_heads lookup exists to prevent.
        '<div class="pd-field"><label>Department</label><select class="pd-select" id="f-dept">' +
          opts(DEPARTMENTS, isNew ? (r.department || (profile && profile.department) || '') : r.department, '—') + '</select></div>' +
        '<div class="pd-field"><label>Status</label><select class="pd-select" id="f-status">' + opts(STATUSES, r.status || 'Open') + '</select></div>' +
      '</div>' +
      '<div class="pd-field"><label>Champion(s)</label>' +
        '<input class="pd-input" id="f-champ" list="il-champ-list" value="' + Fmt.esc(r.champion) + '" placeholder="e.g. Ronquillo, Jules Norman; Agcaoili, Heherson"></div>' +
      '<div class="il-form-row">' +
        '<div class="pd-field"><label>Date Presented</label><input class="pd-input" type="date" id="f-presented" value="' + (dateVal(r.date_presented)) + '"></div>' +
        '<div class="pd-field"><label>Date Resolved</label><input class="pd-input" type="date" id="f-resolved" value="' + (dateVal(r.date_resolved)) + '"></div>' +
      '</div>' +

      (isNew ? '' : '<p class="il-raisedby">' + Fmt.esc(raisedByLabel(r)) + '</p>') +
      '<div class="il-form-sec">Issue</div>' +
      '<div class="pd-field"><label>Issue</label><textarea class="pd-textarea" id="f-issue" rows="3" placeholder="Describe the issue or concern…">' + Fmt.esc(r.description) + '</textarea></div>' +
      '<div class="pd-field"><label>Caused By</label><textarea class="pd-textarea" id="f-cause" rows="2" placeholder="Root cause…">' + Fmt.esc(r.caused_by) + '</textarea></div>' +
      '<div class="pd-field"><label>Corrective Action</label><textarea class="pd-textarea" id="f-action" rows="3" placeholder="Actions taken / planned…">' + Fmt.esc(r.corrective_action) + '</textarea></div>' +

      '<div class="il-form-sec">Lessons Learned <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--pd-muted);">— for future reference</span></div>' +
      '<div class="pd-field"><label>Lesson category</label><select class="pd-select" id="f-lcat" style="max-width:220px;">' + opts(LESSON_CATS, r.lesson_category, '—') + '</select></div>' +
      '<div class="pd-field"><label>Lesson learned</label><textarea class="pd-textarea" id="f-lesson" rows="3" placeholder="What did the team learn from this issue?">' + Fmt.esc(r.lesson_learned) + '</textarea></div>' +
      '<div class="pd-field"><label>Recommendation</label><textarea class="pd-textarea" id="f-rec" rows="2" placeholder="What should be done differently next time?">' + Fmt.esc(r.recommendation) + '</textarea></div>' +

      '<datalist id="il-champ-list">' + champDatalist() + '</datalist>' +

      '<div style="text-align:right;margin-top:10px;">' +
        '<button class="pd-btn" id="f-cancel">Cancel</button> ' +
        '<button class="pd-btn pd-btn-primary" id="f-save">Save</button></div>'
    );

    wireModalCursor(m, isNew ? null : r);
    m.el.querySelector('#f-cancel').onclick = m.close;
    m.el.querySelector('#f-save').onclick = async function () {
      var data = {
        project_id:        pid,
        type:              'Issue',
        status:            m.el.querySelector('#f-status').value,
        department:        m.el.querySelector('#f-dept').value,
        champion:          m.el.querySelector('#f-champ').value.trim(),
        description:       m.el.querySelector('#f-issue').value.trim(),
        caused_by:         m.el.querySelector('#f-cause').value.trim(),
        corrective_action: m.el.querySelector('#f-action').value.trim(),
        date_presented:    m.el.querySelector('#f-presented').value || null,
        date_resolved:     m.el.querySelector('#f-resolved').value || null,
        lesson_category:   m.el.querySelector('#f-lcat').value,
        lesson_learned:    m.el.querySelector('#f-lesson').value.trim(),
        recommendation:    m.el.querySelector('#f-rec').value.trim(),
        updated_at:        new Date().toISOString(),
      };
      if (!data.description) { UI.toast('The Issue field is required', 'warn'); return; }
      try {
        if (isNew) {
          data.created_by = UID;               // REQUIRED for RLS
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
          UI.toast('Saved', 'ok'); m.close(); render();
        }
      } catch (e) { UI.toast(e.message, 'error'); }
    };

    // Autosave (edit only): debounced re-use of the Save button's own handler.
    if (!isNew && window.Autosave) {
      var asInd = document.createElement('span');
      asInd.className = 'pd-autosave pd-autosave-idle';
      asInd.textContent = 'Autosave on';
      var h2 = m.el.querySelector('h2');
      if (h2) { h2.style.display = 'flex'; h2.style.alignItems = 'center'; h2.style.gap = '10px'; h2.appendChild(asInd); }
      var as = Autosave.wire({ root: m.el, modal: m, saveBtn: m.el.querySelector('#f-save'), indicator: asInd });
      var _ilClose = m.close;
      m.close = function () { as.cancel(); _ilClose(); };
    }
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
    if (!confirm('Delete this issue? This also removes any lesson captured on it. This cannot be undone.')) return;
    var res = await sb().from(TABLE).delete().eq('id', id);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
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
  function momFieldHTML(label, cls, control, raw, extra) {
    var body = _momReport
      ? '<div class="il-mi-val' + (raw ? '' : ' is-empty') + '">' +
          (raw ? Fmt.esc(raw).replace(/\n/g, '<br>') : '—') + '</div>'
      : control;
    return '<div class="il-mi-f ' + cls + '"><label>' + label + '</label>' +
      body + (extra || '') + '</div>';
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
      momFieldHTML('Responsible', 'il-c-owner',
        '<input class="pd-input pd-input-sm il-mi" data-f="owner" value="' + Fmt.esc(it.owner || '') + '" placeholder="Who owns it" ' + d + '>',
        it.owner) +
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
      champion: it.owner || null,
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
