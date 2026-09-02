/* ============================================================================
 * MyWork — "what do I owe?", answered from the signed-in account.
 *
 * ONE implementation, two hosts: the cross-project page (my-work.html) and the
 * per-project block on Project Home. ⚠️ Deliberately shared — two screens that
 * each computed "my items" their own way is exactly how one page comes to say a
 * planner has 3 open issues while the other says 5, and this app has already
 * been bitten by that class of drift twice (the mom-app category dropdowns, the
 * two status vocabularies).
 *
 * FOUR SOURCES, and each is a different question:
 *   1. Issues where I am a CHAMPION            — work assigned to me
 *   2. MOM action items where I am RESPONSIBLE — work assigned to me
 *   3. Issues I RAISED                         — work I am waiting on
 *   4. Lessons I CAPTURED                      — my contribution to the library
 * (1) and (2) are what you owe; (3) and (4) are what you have put in. They are
 * never summed into one "my items" figure, because acting on them is different.
 *
 * ⚠️ ASSIGNMENT IS READ FROM THE ID ARRAYS (champion_ids / owner_ids), NEVER
 * from the free-text champion/owner columns. A typed name cannot be resolved to
 * an account — the register really does contain "Ronquillo, Jules Norman;
 * Agcaoili, Heherson" — so a personal view built on a string match would either
 * miss the row or claim someone else's work. A row with no ids simply does not
 * appear here, which is honest: nobody has said whose it is in a way the
 * database can act on. See migrations/2026-08-26-people-and-assignment.sql.
 *
 * ⚠️ NO EXTRA RLS IS NEEDED OR ASSUMED. These are the same tables under the same
 * project-scoped policies, so this page can only ever show a user work on
 * projects they can already access. It adds visibility, never access.
 * ========================================================================== */
window.MyWork = (function () {
  'use strict';

  // ---- Config --------------------------------------------------------------
  // ⚠️ `open` is what makes an item outstanding. Closed work still exists and is
  // still yours; it is just not something you owe, so it is counted separately
  // rather than hidden — "nothing open" and "nothing at all" are different facts.
  var OPEN_ISSUE = { 'Open': 1, 'On Hold': 1 };

  function esc(s) { return Fmt.esc(s == null ? '' : String(s)); }

  // ---- Dates ---------------------------------------------------------------
  // ⚠️ UTC integer arithmetic, never new Date(str). Parsing a bare date string as
  // local time shifts it a day either side of Greenwich — the off-by-one this repo
  // has hit repeatedly (minusDays in both registers, the drawing importer).
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function daysBetween(fromISO, toISO) {
    if (!fromISO || !toISO) return null;
    var a = Date.parse(fromISO + 'T00:00:00Z'), b = Date.parse(toISO + 'T00:00:00Z');
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  // The register's own aging rule, reproduced rather than invented.
  // ⚠️ 0 once closed, and always derived — a stored aging is wrong the next morning.
  function agingOf(r) {
    if ((r.status || 'Open') === 'Closed') return 0;
    return daysBetween(r.date_presented, todayISO());
  }

  // ---- Data ----------------------------------------------------------------
  // ⚠️ PDb.selectAll, never a bare .select(). PostgREST caps a read at 1000 rows
  // server-side with NO error, and this is the one screen where a silently
  // truncated read reads as "you have nothing left to do".
  async function fetchAll(uid, pid) {
    function scope(q) { return pid ? q.eq('project_id', pid) : q; }

    async function tolerant(table, apply) {
      try { return await PDb.selectAll(table, apply); }
      catch (e) {
        // A missing table or column (pre-migration) must degrade THIS section
        // only, never blank the page — the other three are still true.
        return { __error: (e && e.message) || String(e) };
      }
    }

    var res = await Promise.all([
      tolerant('issues_lessons', function (q) { return scope(q).contains('champion_ids', [uid]); }),
      tolerant('mom_items',      function (q) { return scope(q).contains('owner_ids', [uid]); }),
      tolerant('issues_lessons', function (q) { return scope(q).eq('created_by', uid); }),
      tolerant('lessons_learned', function (q) { return scope(q).eq('created_by', uid); })
    ]);
    return { champion: res[0], responsible: res[1], raised: res[2], lessons: res[3] };
  }

  function isErr(x) { return !!(x && x.__error); }
  function rowsOf(x) { return isErr(x) ? [] : (x || []); }

  // ⚠️ An issue I both raised AND champion appears in two sections on purpose.
  // They answer different questions, and dropping it from one would make that
  // section's count disagree with the register it is quoting.

  function counts(d) {
    var ch = rowsOf(d.champion), rs = rowsOf(d.responsible);
    return {
      championOpen: ch.filter(function (r) { return !!OPEN_ISSUE[r.status || 'Open']; }).length,
      championAll: ch.length,
      respOpen: rs.filter(function (r) { return (r.status || 'Open') !== 'Closed'; }).length,
      respAll: rs.length,
      raised: rowsOf(d.raised).length,
      lessons: rowsOf(d.lessons).length
    };
  }

  // ---- Rendering -----------------------------------------------------------
  function projLabel(map, pid) { return esc(map[pid] || pid || '—'); }

  function kpi(n, label, hot) {
    return '<div class="mw-kpi' + (hot && n > 0 ? ' is-hot' : '') + '">' +
      '<div class="n">' + n + '</div><div class="l">' + esc(label) + '</div></div>';
  }

  function section(id, title, why, count, bodyHTML) {
    return '<section class="mw-sec">' +
      '<div class="mw-sechead"><h2>' + esc(title) + '</h2>' +
      '<span class="c">' + esc(count) + '</span>' +
      '<span class="why">' + esc(why) + '</span></div>' +
      '<div class="mw-tablewrap" id="' + esc(id) + '">' + bodyHTML + '</div></section>';
  }

  function errBody(x) {
    return '<p class="mw-empty">Could not load this section: ' + esc(x.__error) +
      '<br>If this names a missing column, run <code>migrations/2026-08-26-people-and-assignment.sql</code>.</p>';
  }

  function issueTable(rows, map, showProj, empty) {
    if (!rows.length) return '<p class="mw-empty">' + esc(empty) + '</p>';
    var body = rows.map(function (r) {
      var a = agingOf(r), st = r.status || 'Open';
      var hot = a != null && a > 90 && st !== 'Closed';
      return '<tr data-pid="' + esc(r.project_id) + '" data-screen="issues">' +
        (showProj ? '<td class="mw-proj">' + projLabel(map, r.project_id) + '</td>' : '') +
        '<td><div class="mw-main">' + esc(r.description || '(no description)') + '</div>' +
          (r.department ? '<div class="mw-sub">' + esc(r.department) + '</div>' : '') + '</td>' +
        '<td><span class="mw-pill' + (OPEN_ISSUE[st] ? ' open' : '') + '">' + esc(st) + '</span></td>' +
        '<td class="mw-age' + (hot ? ' is-hot' : '') + '">' + (a == null ? '—' : a + 'd') + '</td>' +
        '</tr>';
    }).join('');
    return '<table class="mw-table"><thead><tr>' +
      (showProj ? '<th>Project</th>' : '') +
      '<th>Issue</th><th>Status</th><th>Aging</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  function actionTable(rows, map, showProj, empty) {
    if (!rows.length) return '<p class="mw-empty">' + esc(empty) + '</p>';
    var today = todayISO();
    var body = rows.map(function (r) {
      var st = r.status || 'Open';
      // ⚠️ Overdue only when there IS a due date. A blank due date is "nobody has
      // dated this", not "on time" — and only one of those is a reason to look.
      var od = !!(r.due_date && st !== 'Closed' && r.due_date < today);
      return '<tr data-pid="' + esc(r.project_id) + '" data-screen="mom">' +
        (showProj ? '<td class="mw-proj">' + projLabel(map, r.project_id) + '</td>' : '') +
        '<td><div class="mw-main">' + esc(r.action_item || r.description || '(no action)') + '</div>' +
          (r.category ? '<div class="mw-sub">' + esc(r.category) + '</div>' : '') + '</td>' +
        '<td><span class="mw-pill' + (st !== 'Closed' ? ' open' : '') + '">' + esc(st) + '</span></td>' +
        '<td class="mw-age' + (od ? ' is-hot' : '') + '">' +
          (r.due_date ? esc(Fmt.date(r.due_date)) + (od ? ' · overdue' : '') : 'no due date') + '</td>' +
        '</tr>';
    }).join('');
    return '<table class="mw-table"><thead><tr>' +
      (showProj ? '<th>Project</th>' : '') +
      '<th>Action item</th><th>Status</th><th>Due</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  function lessonTable(rows, map, showProj, empty) {
    if (!rows.length) return '<p class="mw-empty">' + esc(empty) + '</p>';
    var body = rows.map(function (r) {
      return '<tr data-pid="' + esc(r.project_id) + '" data-screen="lessons">' +
        (showProj ? '<td class="mw-proj">' + projLabel(map, r.project_id) + '</td>' : '') +
        '<td><div class="mw-main">' + esc(r.lesson || '(no lesson text)') + '</div>' +
          (r.recommendation ? '<div class="mw-sub">' + esc(r.recommendation) + '</div>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="mw-age">' + (r.date_captured ? esc(Fmt.date(r.date_captured)) : '—') + '</td>' +
        '</tr>';
    }).join('');
    return '<table class="mw-table"><thead><tr>' +
      (showProj ? '<th>Project</th>' : '') +
      '<th>Lesson</th><th>Category</th><th>Captured</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  // Clicking a row switches the app to that project and opens the right module
  // at the right screen. ⚠️ The project context is set FIRST — landing on the
  // module with the previous project still selected would show someone else's
  // register.
  // ⚠️ 'mom' routes to the SEPARATE Minutes of Meeting module now (it used to be
  // a third screen of this one) — 'issues'/'lessons' still route to Issues &
  // Concerns, which keeps its own ?screen= param for its two remaining tabs.
  var MW_SCREEN_MODULE = { mom: 'minutes-of-meeting', issues: 'issues-lessons', lessons: 'issues-lessons' };
  function wireRows(root) {
    var base = root.dataset.base || '';
    root.querySelectorAll('tr[data-pid]').forEach(function (tr) {
      tr.onclick = function () {
        var pid = tr.dataset.pid;
        if (pid) {
          sessionStorage.setItem('pd_project', pid);
          var nm = (window.__mwProjNames || {})[pid];
          if (nm) sessionStorage.setItem('pd_project_name', nm);
          // A package belongs to ONE project; carrying it across is meaningless.
          sessionStorage.removeItem('pd_package');
          sessionStorage.removeItem('pd_package_name');
        }
        var screen = tr.dataset.screen || 'issues';
        var mod = MW_SCREEN_MODULE[screen] || 'issues-lessons';
        location.href = base + 'modules/' + mod + '/index.html' +
          (mod === 'issues-lessons' ? '?screen=' + encodeURIComponent(screen) : '');
      };
    });
  }

  // ---- Public: the cross-project page --------------------------------------
  async function render(host, user) {
    host.innerHTML = '<p class="mw-empty">Loading…</p>';
    host.dataset.base = host.dataset.base || '';

    var map = {};
    try {
      (await PDb.getProjects()).forEach(function (p) { map[p.id] = p.name || p.id; });
    } catch (e) { /* names are a nicety — ids still identify the project */ }
    window.__mwProjNames = map;

    var d;
    try { d = await fetchAll(user.id, null); }
    catch (e) {
      host.innerHTML = '<p class="mw-empty">Could not load your work: ' + esc(e.message || e) + '</p>';
      return;
    }

    var c = counts(d);
    var html = '<div class="mw-kpis">' +
      kpi(c.championOpen, 'Open · I am champion', true) +
      kpi(c.respOpen, 'Open · I am responsible', true) +
      kpi(c.raised, 'Issues I raised') +
      kpi(c.lessons, 'Lessons I captured') +
      '</div>';

    html += section('mw-champ', 'Issues where I am a champion',
      'Assigned to your account, not to typed text',
      c.championOpen + ' open of ' + c.championAll,
      isErr(d.champion) ? errBody(d.champion)
        : issueTable(rowsOf(d.champion), map, true,
            'No issue names you as a champion yet. An issue whose champion was typed as free text cannot be matched to a login — reopen it and pick the person.'));

    html += section('mw-resp', 'Meeting action items I am responsible for',
      'From minutes across every project',
      c.respOpen + ' open of ' + c.respAll,
      isErr(d.responsible) ? errBody(d.responsible)
        : actionTable(rowsOf(d.responsible), map, true, 'No action item names you as responsible.'));

    html += section('mw-raised', 'Issues I raised',
      'What you are waiting on someone else for',
      String(c.raised),
      isErr(d.raised) ? errBody(d.raised)
        : issueTable(rowsOf(d.raised), map, true, 'You have not raised an issue yet.'));

    html += section('mw-lessons', 'Lessons I captured',
      'Your contribution to the lessons library',
      String(c.lessons),
      isErr(d.lessons) ? errBody(d.lessons)
        : lessonTable(rowsOf(d.lessons), map, true, 'You have not captured a lesson yet.'));

    host.innerHTML = html;
    wireRows(host);
  }

  // ---- Public: the per-project block on Project Home ------------------------
  // Same data, same rules, scoped to one project — and it LINKS to the full page
  // rather than restating it, so there is one place to read the whole picture.
  async function renderBlock(host, user, pid, base) {
    if (!pid) { host.innerHTML = ''; return; }
    host.dataset.base = base || '';
    host.innerHTML = '<p class="mw-empty">Loading your items…</p>';

    var d;
    try { d = await fetchAll(user.id, pid); }
    catch (e) {
      host.innerHTML = '<p class="mw-empty">Could not load your items: ' + esc(e.message || e) + '</p>';
      return;
    }

    var c = counts(d);
    var total = c.championAll + c.respAll;
    var openTotal = c.championOpen + c.respOpen;

    var html = '<div class="mw-sechead"><h2>My items on this project</h2>' +
      '<span class="c">' + openTotal + ' open of ' + total + '</span>' +
      '<span class="why"><a href="' + esc(base || '') + 'my-work.html">See all my work &rarr;</a></span></div>';

    if (isErr(d.champion) || isErr(d.responsible)) {
      host.innerHTML = html + '<div class="mw-tablewrap">' +
        errBody(isErr(d.champion) ? d.champion : d.responsible) + '</div>';
      return;
    }

    if (!total) {
      // ⚠️ Says WHY it may be empty. "Nothing assigned to you" and "assignment was
      // typed as text so the database cannot match it to you" look identical here,
      // and only the second is something the planner can fix.
      host.innerHTML = html + '<div class="mw-tablewrap"><p class="mw-empty">' +
        'Nothing on this project is assigned to your account. Items whose champion or ' +
        'responsible was typed as free text cannot be matched to a login — reopen them ' +
        'and pick the person to see them here.</p></div>';
      return;
    }

    if (c.championAll) {
      html += '<div class="mw-tablewrap" style="margin-bottom:10px;">' +
        issueTable(rowsOf(d.champion), {}, false, '') + '</div>';
    }
    if (c.respAll) {
      html += '<div class="mw-tablewrap">' +
        actionTable(rowsOf(d.responsible), {}, false, '') + '</div>';
    }
    host.innerHTML = html;
    wireRows(host);
  }

  // ---- Public: the Tasks page — the two "what I OWE" sources (champion issues +
  // responsible action items), as ONE unified, filterable, sortable worklist.
  // ⚠️ A THIRD host on the same fetchAll/counts, not a fourth definition of "mine" —
  // this file's whole reason to exist is that two screens computing "my items"
  // their own way is how one page comes to disagree with another.
  // ⚠️ Deliberately excludes "issues I raised" / "lessons I captured": those are
  // what the account has PUT IN, not what it owes, and a worklist mixing the two
  // would answer a question this page was not asked.
  async function renderTasks(host, user) {
    host.innerHTML = '<p class="mw-empty">Loading…</p>';
    host.dataset.base = host.dataset.base || '';

    var map = {};
    try { (await PDb.getProjects()).forEach(function (p) { map[p.id] = p.name || p.id; }); }
    catch (e) { /* names are a nicety — ids still identify the project */ }
    window.__mwProjNames = map;

    var d;
    try { d = await fetchAll(user.id, null); }
    catch (e) { host.innerHTML = '<p class="mw-empty">Could not load your tasks: ' + esc(e.message || e) + '</p>'; return; }

    if (isErr(d.champion) || isErr(d.responsible)) {
      host.innerHTML = errBody(isErr(d.champion) ? d.champion : d.responsible);
      return;
    }

    var today = todayISO();
    // ⚠️ An issue has no due date of its own (only aging, from date_presented); an
    // action item has due_date but no aging. Unified as one shape so they can share
    // a sort/filter, without pretending one has a field it does not.
    function taskOf(r, kind) {
      var st = r.status || 'Open';
      var due = kind === 'action' ? (r.due_date || null) : null;
      var overdue = !!(due && st !== 'Closed' && due < today);
      var open = kind === 'issue' ? !!OPEN_ISSUE[st] : st !== 'Closed';
      return {
        kind: kind, project_id: r.project_id,
        text: kind === 'issue' ? (r.description || '(no description)') : (r.action_item || r.description || '(no action)'),
        sub: kind === 'issue' ? (r.department || '') : (r.category || ''),
        status: st, due: due, aging: kind === 'issue' ? agingOf(r) : null, overdue: overdue, open: open
      };
    }
    var ALL = rowsOf(d.champion).map(function (r) { return taskOf(r, 'issue'); })
      .concat(rowsOf(d.responsible).map(function (r) { return taskOf(r, 'action'); }));

    // ⚠️ Filter bar is a STATIC shell, built once, outside the part that re-renders
    // on every filter change — see the CSS comment in my-work.css for why: rebuilding
    // the search input on every keystroke would lose focus after one character.
    host.innerHTML =
      '<div class="mw-kpis" id="mw-t-kpis"></div>' +
      '<div class="mw-taskfilters">' +
        '<input class="pd-input" id="mw-t-q" placeholder="Search your tasks…">' +
        '<select class="pd-select" id="mw-t-status">' +
          '<option value="open">Open</option><option value="overdue">Overdue</option><option value="">All</option>' +
        '</select>' +
        '<select class="pd-select" id="mw-t-proj"><option value="">All projects</option>' +
          Object.keys(map).sort(function (a, b) { return (map[a] || '').localeCompare(map[b] || ''); }).map(function (pid) {
            return '<option value="' + esc(pid) + '">' + esc(map[pid]) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<div id="mw-t-body"></div>';
    var kpisEl = document.getElementById('mw-t-kpis'), bodyEl = document.getElementById('mw-t-body');
    var fStatus = 'open', fProj = '', fQ = '';

    function visible() {
      return ALL.filter(function (t) {
        if (fStatus === 'open' && !t.open) return false;
        if (fStatus === 'overdue' && !t.overdue) return false;
        if (fProj && t.project_id !== fProj) return false;
        if (fQ && (t.text + ' ' + t.sub).toLowerCase().indexOf(fQ) < 0) return false;
        return true;
      }).sort(function (a, b) {
        // Overdue / soon-due first; a blank due date (every issue, and an undated
        // action) sorts after every dated one, then by aging (oldest first).
        var ax = a.due || '9999-99-99', bx = b.due || '9999-99-99';
        return ax.localeCompare(bx) || (b.aging || 0) - (a.aging || 0);
      });
    }

    function renderResults() {
      var list = visible();
      var openN = ALL.filter(function (t) { return t.open; }).length;
      var overdueN = ALL.filter(function (t) { return t.overdue; }).length;
      kpisEl.innerHTML = kpi(openN, 'Open tasks', true) + kpi(overdueN, 'Overdue', overdueN > 0) + kpi(ALL.length, 'Total assigned');

      if (!list.length) {
        bodyEl.innerHTML = '<p class="mw-empty">' + (ALL.length ? 'Nothing matches these filters.' :
          'Nothing is assigned to your account yet. An item whose champion or responsible was ' +
          'typed as free text cannot be matched to a login — reopen it and pick the person.') + '</p>';
        return;
      }
      bodyEl.innerHTML = '<div class="mw-tablewrap"><table class="mw-table"><thead><tr>' +
        '<th>Project</th><th>Task</th><th>Type</th><th>Status</th><th>Due / Aging</th></tr></thead><tbody>' +
        list.map(function (t) {
          return '<tr data-pid="' + esc(t.project_id) + '" data-screen="' + (t.kind === 'issue' ? 'issues' : 'mom') + '">' +
            '<td class="mw-proj">' + projLabel(map, t.project_id) + '</td>' +
            '<td><div class="mw-main">' + esc(t.text) + '</div>' + (t.sub ? '<div class="mw-sub">' + esc(t.sub) + '</div>' : '') + '</td>' +
            '<td>' + (t.kind === 'issue' ? 'Issue' : 'Action item') + '</td>' +
            '<td><span class="mw-pill' + (t.open ? ' open' : '') + '">' + esc(t.status) + '</span></td>' +
            '<td class="mw-age' + ((t.overdue || (t.aging != null && t.aging > 90)) ? ' is-hot' : '') + '">' +
              (t.due ? esc(Fmt.date(t.due)) + (t.overdue ? ' · overdue' : '') : (t.aging == null ? '—' : t.aging + 'd')) +
            '</td></tr>';
        }).join('') + '</tbody></table></div>';
      // wireRows queries descendants of `host` and reads `host.dataset.base` — safe
      // to call with the outer host even though only bodyEl's markup changed.
      wireRows(host);
    }

    document.getElementById('mw-t-q').oninput = function (e) { fQ = e.target.value.toLowerCase(); renderResults(); };
    document.getElementById('mw-t-status').onchange = function (e) { fStatus = e.target.value; renderResults(); };
    document.getElementById('mw-t-proj').onchange = function (e) { fProj = e.target.value; renderResults(); };
    renderResults();
  }

  // ⚠️ Counts through the SAME fetchAll + counts() the panel renders from, so the dashboard's
  // drawer badge and the panel it opens can never disagree. A badge computed its own way is a
  // second definition of "mine", and the first time the two differ the badge is the one believed.
  // Resolves to 0 rather than rejecting when the fetch fails: a badge is decoration, and a caller
  // should not have to catch to render a page.
  async function countOpen(userId, pid) {
    if (!userId || !pid) return 0;
    try {
      var c = counts(await fetchAll(userId, pid));
      return c.championOpen + c.respOpen;
    } catch (e) { return 0; }
  }

  return {
    render: render,
    renderBlock: renderBlock,
    renderTasks: renderTasks,
    countOpen: countOpen,
    // Exposed for the test harness — never called by the app.
    _internals: {
      agingOf: agingOf, daysBetween: daysBetween, counts: counts,
      issueTable: issueTable, actionTable: actionTable, lessonTable: lessonTable,
      OPEN_ISSUE: OPEN_ISSUE
    }
  };
})();
