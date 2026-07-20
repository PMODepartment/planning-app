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
// ============================================================================

window.IssuesLessons = (function () {
  var TABLE = 'issues_lessons';
  var profile = null, UID = null;
  var pid = null, projName = '';
  var canWrite = false;
  var rows = [];
  var screen = 'issues';               // 'issues' | 'lessons'

  var iFilters = { search: '', status: '', department: '', champion: '', aging: '' };
  var lFilters = { search: '', department: '', category: '' };

  var DEPARTMENTS = ['PMO', 'Operations', 'Engineering', 'Design', 'QA/QC', 'Safety',
                     'Procurement', 'Commercial', 'Finance', 'Human Resources', 'MEP', 'External'];
  var STATUSES    = ['Open', 'On Hold', 'Closed'];
  var LESSON_CATS = ['Schedule', 'Cost', 'Quality', 'Safety', 'Design', 'Procurement',
                     'Contract', 'Communication', 'Resource', 'Stakeholder', 'Other'];

  function sb() { return AppAuth.getSB(); }
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
    canWrite = ['super_admin', 'admin', 'planner'].indexOf(prof.role) >= 0;

    await loadProjects();
    wire();
    syncChrome();
    if (pid) load();
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
      load();
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
    $('il-refresh').onclick = function () { load(); };
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
    var res = await sb().from(TABLE).select('*')
      .eq('project_id', pid)
      .order('date_presented', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    rows = res.data || [];
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
    if (screen === 'lessons') renderLessons(); else renderIssues();
    if (window.Icons && Icons.hydrate) Icons.hydrate($('il-screen-' + screen));
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
      return '<tr>' +
        '<td class="il-cell-num">' + (i + 1) + '</td>' +
        '<td>' + Fmt.esc(r.department) + '</td>' +
        '<td class="il-cell-wrap"><div class="il-clip">' + Fmt.esc(r.description) + '</div>' +
          (hasLesson(r) ? '<span class="il-lessontag"><span data-ico="bulb" data-ico-size="12"></span>Lesson captured</span>' : '') +
        '</td>' +
        '<td class="il-cell-wrap"><div class="il-clip">' + Fmt.esc(r.caused_by) + '</div></td>' +
        '<td class="il-cell-wrap"><div class="il-clip">' + Fmt.esc(r.corrective_action) + '</div></td>' +
        '<td class="il-champ">' + Fmt.esc(r.champion) + '</td>' +
        '<td><span class="il-pill ' + statusClass(r.status) + '">' + Fmt.esc(r.status || 'Open') + '</span></td>' +
        '<td>' + Fmt.date(r.date_presented) + '</td>' +
        '<td class="il-aging' + (hot ? ' is-hot' : '') + '">' + agingTxt + '</td>' +
        '<td>' + Fmt.date(r.date_resolved) + '</td>' +
        (canWrite ? '<td class="il-rowacts">' +
          '<button class="il-iconbtn" title="Edit" data-edit="' + r.id + '">✎</button> ' +
          '<button class="il-iconbtn is-danger" title="Delete" data-del="' + r.id + '">🗑</button></td>' : '') +
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
    if (!canWrite) return;
    var isNew = !r; r = r || {};

    function opts(list, val, blank) {
      return (blank ? '<option value="">' + blank + '</option>' : '') +
        list.map(function (o) { return '<option' + (val === o ? ' selected' : '') + '>' + o + '</option>'; }).join('');
    }

    var m = UI.modal(
      '<h2 style="margin-top:0;">' + (isNew ? 'Log issue / concern' : 'Edit issue / concern') + '</h2>' +

      '<div class="il-form-sec">Details</div>' +
      '<div class="il-form-row">' +
        '<div class="pd-field"><label>Department</label><select class="pd-select" id="f-dept">' + opts(DEPARTMENTS, r.department, '—') + '</select></div>' +
        '<div class="pd-field"><label>Status</label><select class="pd-select" id="f-status">' + opts(STATUSES, r.status || 'Open') + '</select></div>' +
      '</div>' +
      '<div class="pd-field"><label>Champion(s)</label>' +
        '<input class="pd-input" id="f-champ" list="il-champ-list" value="' + Fmt.esc(r.champion) + '" placeholder="e.g. Ronquillo, Jules Norman; Agcaoili, Heherson"></div>' +
      '<div class="il-form-row">' +
        '<div class="pd-field"><label>Date Presented</label><input class="pd-input" type="date" id="f-presented" value="' + (dateVal(r.date_presented)) + '"></div>' +
        '<div class="pd-field"><label>Date Resolved</label><input class="pd-input" type="date" id="f-resolved" value="' + (dateVal(r.date_resolved)) + '"></div>' +
      '</div>' +

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
        } else {
          var upd = await sb().from(TABLE).update(data).eq('id', r.id);
          if (upd.error) throw upd.error;
        }
        UI.toast('Saved', 'ok'); m.close(); load();
      } catch (e) { UI.toast(e.message, 'error'); }
    };
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

  return { init: init };
})();
