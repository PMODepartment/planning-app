/* ============================================================================================
   THE PORTFOLIO DASHBOARDS, AS A LAYER EVERY MODULE CAN HOST
   ============================================================================================
   Owner, 2026-09-15, with the Portfolio Dashboard's view dropdown open: *"for the dashboard, you
   can see there is a dashboard module, and there is a dropdown that links to each module. that is
   wrong. The idea of each dashboard (e.g. s-curve, risk register etc.), the design of those
   dashboards must be pushed to each module established on the left."*

   ⚠️⚠️ THE DROPDOWN WAS A SECOND SIDEBAR, AND A SECOND HOME FOR TWELVE MODULES. The sidebar
   already opens every module's own page in portfolio scope (`#pd_scope=portfolio`, see ui.js and
   AppAuth.isPortfolioScope) — so "Risk Register" existed twice: once as the module, and once as a
   view of a page called Portfolio Dashboard. A planner who clicked the sidebar and a planner who
   clicked the dropdown landed on two different screens showing the same rows.

   ⚠️ SO THE DASHBOARD IS THE MODULE'S PORTFOLIO FACE. Each renderer below is the one that ran on
   the Portfolio Dashboard, MOVED here unchanged, and mounted by the module itself when it is
   opened portfolio-wide. One implementation, hosted where the thing it describes lives.
   ⚠️ NOT COPIED — MOVED. A second copy is how the two screens drift apart again, which is the
   fault this change exists to end. `portfolio-overview` no longer carries these six at all.

   ⚠️ SCOPE IS EVERY PROJECT THE PLANNER CAN SEE, and there is deliberately no multi-project
   picker here: a module in portfolio scope already has the shared project selector in its topbar
   reading "Portfolio", and choosing a real project there LEAVES portfolio scope for that project's
   own module (UI.enhanceProjectSelect). One control, one meaning, rather than a second filter that
   disagrees with it.
   ⚠️ READ-ONLY, AND THE NETWORK ENFORCES IT: writes are refused at the shared Supabase chokepoint
   while the portfolio flag is set (auth.js), so none of these views may author anything. That is
   why the Stakeholder Map — whose portfolio view CARRIES an authoring directory ("+ Add person") —
   is NOT in this file: moving it here would have silently broken the one thing it does.
   ============================================================================================ */
(function () {
  'use strict';

  /* ---- what every dashboard below shares --------------------------------------------------
     Moved with them, from the same file: the same esc/kpi2/statePill/clip the renderers were
     written against, so not one line of a renderer had to be edited to live here. */
  var PROJ = [], GH = [], _loadedP = null;
  function sb() { return AppAuth.getSB(); }
  function esc(s) { return Fmt.esc(s); }
  function num(v) { return Number(v) || 0; }
  /* ⚠️ THE DATE PAIR CAME WITH THEM, and leaving it behind was a real fault caught by running the
     views rather than reading them: the Meetings dashboard asks `pd(due) < today()` to decide what
     is overdue, and both lived in the Portfolio Dashboard’s closure three thousand lines away.
     Moved verbatim — `pd` parses the DATE PART of a string into a local Date so a stored
     timestamp cannot drift a day, and `today` is midnight local, the same instant every other
     “is it late” test in this app uses. */
  function pd(v) { if (!v) return null; var m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function today() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  var KPI_VARIANT = { '--pd-ok': 'pd-kpi-ok', '--pd-warn': 'pd-kpi-warn', '--pd-bad': 'pd-kpi-bad' };
  function kpi2(l, v, cls) {
    var variant = cls ? KPI_VARIANT[cls] : '';
    var val = (variant || !cls) ? v : '<span style="color:var(' + cls + ');">' + v + '</span>';
    return UI.kpi(l, val, variant ? { cls: variant } : {});
  }
  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function statePill(label, tone) { return '<span class="pd-pill pd-pill-' + (tone || 'muted') + '">' + esc(label) + '</span>'; }
  /* ⚠️ THE SCOPE FUNCTION KEEPS ITS NAME. On the Portfolio Dashboard this resolved the project
     filter; here it is every project the planner can see. The renderers ask the same question and
     never had to learn a second one. */
  function scopedProjectIds() { return PROJ.map(function (p) { return p.id; }); }

  /* ---- provenance in a consolidated view --------------------------------------------------
     Owner, 2026-09-15: *"for consolidated data in portfolio, if in list group by project"* and
     *"for consolidated data not in list, add a marker project code to identify."*

     ⚠️⚠️ EVERY TABLE HERE WAS A FLAT LIST WITH A `Project` COLUMN, and that is the thing being
     replaced rather than decorated. A name repeated down a column costs a sideways scan on every
     single row to answer "whose is this", and — worse — the sort scattered one project's rows the
     whole length of the table, so there was no way to read a project's records together. The
     column goes and a group band takes its place: the question is answered once per project
     instead of once per row, and the rows of a project are finally adjacent.

     ⚠️ Ordered by project CODE, through the SHARED `UI.groupByProject` / `UI.projectGroupRowHTML`
     — the same two functions the modules' own registers use — so a project sits in the same place
     on every consolidated screen in the app rather than in whatever order each table sorted by.
     ⚠️ Grouping runs after each view's own sort and never re-sorts within a group, so "most aging
     first" still means that inside each project.
     ⚠️ THE NAME IS FILLED IN FROM `PROJ`, this file's own project read, rather than by warming
     UI's separate cache: `PDb.getProjects()` does no caching, so asking for it a second time
     would be a real extra round trip for a string already in hand. The CODE — which is what
     orders the groups and what a planner recognises — needs no lookup either way. */
  function projGroups(list, getId) {
    var nameById = {}; PROJ.forEach(function (p) { nameById[p.id] = p.name || p.id; });
    return UI.groupByProject(list, getId).map(function (g) {
      if (!g.name && nameById[g.id]) { g.name = nameById[g.id]; g.label = g.code + ' — ' + g.name; }
      return g;
    });
  }
  function groupedBody(list, colspan, rowHTML, emptyText, getId) {
    if (!list.length) return '<tr><td colspan="' + colspan + '" class="po-empty">' + esc(emptyText) + '</td></tr>';
    return projGroups(list, getId).map(function (g) {
      return UI.projectGroupRowHTML(g, colspan) + g.rows.map(rowHTML).join('');
    }).join('');
  }
  /* The non-list half of the same ask: a photo tile has no group band to sit under, so it carries
     the CODE. ⚠️ The full "CODE — Name" goes in the title from `PROJ`, for the reason above. */
  function projTag(id) {
    var row = PROJ.filter(function (p) { return p.id === id; })[0];
    return UI.projectTagHTML(id, { title: row ? (id + ' — ' + (row.name || id)) : id });
  }

  /* One fetch per page, shared by whichever dashboard is mounted. ⚠️ The same offline read-cache
     the Portfolio Dashboard uses, under its own key: a module opened on a dead connection still
     draws its portfolio view rather than an empty table. */
  function loadProjects() {
    if (_loadedP) return _loadedP;
    _loadedP = (async function () {
      try {
        var res = await Promise.all([PDb.getProjects(), PDb.getGroupHeads()]);
        PROJ = res[0] || []; GH = res[1] || [];
        if (window.PDSync) PDSync.cachePut('podash:all', { PROJ: PROJ, GH: GH });
      } catch (e) {
        if (window.PDSync) {
          var c = await PDSync.cacheGet('podash:all');
          if (c && c.rows) { PROJ = c.rows.PROJ || []; GH = c.rows.GH || []; return; }
        }
        throw e;
      }
    })();
    return _loadedP;
  }

  /* ---- the registry -------------------------------------------------------------------------
     ⚠️ Each view's renderers live inside its own `setup()`, not at file scope: the six were
     written as six sets of same-shaped names in one closure (rkRender / isRender / mmRender …)
     and only one of them is ever mounted on a page. A closure each keeps them exactly as they
     were AND stops a seventh view from having to invent a new prefix to avoid a collision. */
  var VIEWS = {};
  function def(key, o) { VIEWS[key] = o; }

  /* ---- Risk Register ------------------------------------------------------------ */
  def("risk", {
    title: "Risk Register",
    needs: ["MCCRCM"],
    markup: [
      "        <div class=\"po-toolbar\">",
      "          <div class=\"po-toolbar-fields\" id=\"po-rk-fields\">",
      "            <select class=\"pd-select\" id=\"po-rk-status\" style=\"max-width:160px;\">",
      "              <option value=\"\">All statuses</option><option>Open</option><option>In Progress</option><option>Closed</option>",
      "            </select>",
      "            <span class=\"po-spacer\"></span>",
      "            <div class=\"po-search\"><span data-ico=\"search\" data-ico-size=\"15\"></span><input class=\"pd-input\" id=\"po-rk-q\" placeholder=\"Search risk, category…\" /></div>",
      "          </div>",
      "        </div>",
      "        <p style=\"font-size:12px;color:var(--pd-muted);margin:0 0 12px;\">Priority is the same 5×5 lookup the Risk Register itself uses.</p>",
      "        <div class=\"pd-kpis\" id=\"po-rk-kpis\"></div>",
      "        <div class=\"po-card\" style=\"padding:0;overflow:hidden;\">",
      "          <div style=\"overflow-x:auto;\"><table class=\"po-table\" id=\"po-rk-table\"></table></div>",
      "        </div>"
    ].join('\n'),
    setup: function () {
    // ================= Portfolio Risk Register (cross-project) =================
    // Priority uses the SAME 5×5 lookup the Risk Register module derives from (MCCRCM.riskPriority)
    // rather than a re-guessed threshold on impact × probability — see mcc-rcm.js for why a
    // threshold on the product would be wrong (a product of 4 answers three different ways).
    var rkRows = null, rkLoadedIds = null, rkQuery = '', rkStatus = '';
    function rkPriority(r) {
      if (r.impact == null || r.likelihood == null) return '';
      return (window.MCCRCM && MCCRCM.riskPriority) ? (MCCRCM.riskPriority(r.impact, r.likelihood) || '') : '';
    }
    async function loadRisks(force) {
      var ids = scopedProjectIds();
      if (!force && rkLoadedIds && rkLoadedIds.join(',') === ids.join(',')) return;
      var tbl = document.getElementById('po-rk-table'), kpis = document.getElementById('po-rk-kpis');
      if (!ids.length) { kpis.innerHTML = ''; tbl.innerHTML = ''; return; }
      tbl.innerHTML = '<tbody><tr><td class="po-empty">Reading the risk registers of ' + ids.length + ' project(s)…</td></tr></tbody>';
      kpis.innerHTML = '';
      try {
        // ⚠️ PDb.selectAll, not a bare select — risks across a whole portfolio can pass
        // PostgREST's 1000-row cap, and a truncated read here would silently under-report
        // the very number (1st Priority count) this tab exists to surface.
        rkRows = await PDb.selectAll('risk_register', function (q) { return q.in('project_id', ids); });
      } catch (e) {
        var msg = (e && e.message) || String(e);
        tbl.innerHTML = '<tbody><tr><td class="po-empty">' + esc(msg) + '</td></tr></tbody>';
        return;
      }
      rkLoadedIds = ids;
      rkRender();
    }
    function rkVisible() {
      var q = rkQuery.trim().toLowerCase();
      return (rkRows || []).filter(function (r) {
        if (rkStatus && (r.status || 'Open') !== rkStatus) return false;
        if (q && ((r.title || '') + ' ' + (r.description || '') + ' ' + (r.category || '') + ' ' + (r.risk_code || '')).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
    }
    var RK_PRI_RANK = { '1st Priority': 0, '2nd Priority': 1, '3rd Priority': 2, '4th Priority': 3, '': 4 };
    function rkRender() {
      var list = rkVisible();
      var open = list.filter(function (r) { return (r.status || 'Open') !== 'Closed'; }).length;
      var top = list.filter(function (r) { return rkPriority(r) === '1st Priority'; }).length;
      var projSet = {}; list.forEach(function (r) { projSet[r.project_id] = 1; });
      document.getElementById('po-rk-kpis').innerHTML =
        kpi2('Risks tracked', String(list.length)) + kpi2('Open', String(open)) +
        kpi2('1st Priority', String(top), top ? '--pd-bad' : null) + kpi2('Projects', String(Object.keys(projSet).length));
      var nameById = {}; PROJ.forEach(function (p) { nameById[p.id] = p.name || p.id; });
      var sorted = list.slice().sort(function (a, b) {
        var d = (RK_PRI_RANK[rkPriority(a)] == null ? 4 : RK_PRI_RANK[rkPriority(a)]) - (RK_PRI_RANK[rkPriority(b)] == null ? 4 : RK_PRI_RANK[rkPriority(b)]);
        return d || (a.title || '').localeCompare(b.title || '');
      });
      var head = '<thead><tr><th>Project</th><th>Risk</th><th>Category</th><th class="num">Impact × Prob.</th><th>Priority</th><th>Status</th><th>Owner</th></tr></thead>';
      var body = sorted.length ? sorted.map(function (r) {
        var pri = rkPriority(r);
        return '<tr><td>' + esc(nameById[r.project_id] || r.project_id) + '</td>' +
          '<td>' + esc(r.title || r.risk_code || '(untitled)') + '</td>' +
          '<td>' + esc(r.category || '—') + '</td>' +
          '<td class="num">' + (r.impact && r.likelihood ? (r.impact + ' × ' + r.likelihood) : '—') + '</td>' +
          '<td>' + (pri ? statePill(pri, pri === '1st Priority' ? 'bad' : pri === '2nd Priority' ? 'warn' : 'muted') : '—') + '</td>' +
          '<td>' + statePill(r.status || 'Open', (r.status || 'Open') === 'Closed' ? 'muted' : 'warn') + '</td>' +
          '<td>' + esc(r.owner || '—') + '</td></tr>';
      }).join('') : '<tr><td colspan="7" class="po-empty">No risks match the current filter.</td></tr>';
      document.getElementById('po-rk-table').innerHTML = head + '<tbody>' + body + '</tbody>';
    }
      // ⚠️ Wired here rather than by the host page: these two lines lived in the Portfolio
      //    Dashboard’s auth block, three thousand lines from the renderer they drive.
      document.getElementById('po-rk-status').onchange = function (e) { rkStatus = e.target.value; rkRender(); };
      document.getElementById('po-rk-q').oninput = function (e) { rkQuery = e.target.value; rkRender(); };
      return { load: loadRisks };
    }
  });

  /* ---- Issues & Concerns ------------------------------------------------------------ */
  def("issues", {
    title: "Issues & Concerns",
    needs: [],
    markup: [
      "        <div class=\"po-toolbar\">",
      "          <div class=\"po-toolbar-fields\" id=\"po-is-fields\">",
      "            <select class=\"pd-select\" id=\"po-is-status\" style=\"max-width:160px;\">",
      "              <option value=\"\">All statuses</option><option>Open</option><option>On Hold</option><option>Closed</option>",
      "            </select>",
      "            <span class=\"po-spacer\"></span>",
      "            <div class=\"po-search\"><span data-ico=\"search\" data-ico-size=\"15\"></span><input class=\"pd-input\" id=\"po-is-q\" placeholder=\"Search issue, department…\" /></div>",
      "          </div>",
      "        </div>",
      "        <div class=\"pd-kpis\" id=\"po-is-kpis\"></div>",
      "        <div class=\"po-card\" style=\"padding:0;overflow:hidden;\">",
      "          <div style=\"overflow-x:auto;\"><table class=\"po-table\" id=\"po-is-table\"></table></div>",
      "        </div>"
    ].join('\n'),
    setup: function () {
    // ================= Portfolio Issues & Concerns (cross-project) =================
    var isRows = null, isLoadedIds = null, isQuery = '', isStatus = '';
    // Aging matches the module's own rule: only meaningful while the issue is still open.
    function isAgingDays(r) {
      if (!r.date_presented || (r.status || 'Open') === 'Closed') return null;
      var d = pd(r.date_presented); if (!d) return null;
      return Math.max(0, Math.round((today() - d) / 86400000));
    }
    async function loadIssues(force) {
      var ids = scopedProjectIds();
      if (!force && isLoadedIds && isLoadedIds.join(',') === ids.join(',')) return;
      var tbl = document.getElementById('po-is-table'), kpis = document.getElementById('po-is-kpis');
      if (!ids.length) { kpis.innerHTML = ''; tbl.innerHTML = ''; return; }
      tbl.innerHTML = '<tbody><tr><td class="po-empty">Reading the issues registers of ' + ids.length + ' project(s)…</td></tr></tbody>';
      kpis.innerHTML = '';
      try {
        isRows = await PDb.selectAll('issues_lessons', function (q) { return q.in('project_id', ids); });
      } catch (e) {
        var msg = (e && e.message) || String(e);
        tbl.innerHTML = '<tbody><tr><td class="po-empty">' + esc(msg) + '</td></tr></tbody>';
        return;
      }
      isLoadedIds = ids;
      isRender();
    }
    function isVisible() {
      var q = isQuery.trim().toLowerCase();
      return (isRows || []).filter(function (r) {
        if (isStatus && (r.status || 'Open') !== isStatus) return false;
        if (q && ((r.description || '') + ' ' + (r.department || '') + ' ' + (r.champion || '')).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
    }
    function isRender() {
      var list = isVisible();
      var open = list.filter(function (r) { return (r.status || 'Open') === 'Open'; }).length;
      var hold = list.filter(function (r) { return r.status === 'On Hold'; }).length;
      var over30 = list.filter(function (r) { var a = isAgingDays(r); return a != null && a > 30; }).length;
      var projSet = {}; list.forEach(function (r) { projSet[r.project_id] = 1; });
      document.getElementById('po-is-kpis').innerHTML =
        kpi2('Open', String(open), open ? '--pd-bad' : null) + kpi2('On Hold', String(hold)) +
        kpi2('Aging > 30 days', String(over30), over30 ? '--pd-bad' : null) + kpi2('Projects', String(Object.keys(projSet).length));
      var sorted = list.slice().sort(function (a, b) { var x = isAgingDays(a), y = isAgingDays(b); return (y == null ? -1 : y) - (x == null ? -1 : x); });
      var head = '<thead><tr><th>Issue</th><th>Department</th><th>Champion</th><th>Status</th><th class="num">Aging</th></tr></thead>';
      var body = groupedBody(sorted, 5, function (r) {
        var age = isAgingDays(r), st = r.status || 'Open';
        return '<tr>' +
          '<td>' + esc(clip(r.description, 90) || '(no issue text)') + '</td>' +
          '<td>' + esc(r.department || '—') + '</td>' +
          '<td>' + esc(r.champion || '—') + '</td>' +
          '<td>' + statePill(st, st === 'Open' ? 'bad' : st === 'On Hold' ? 'warn' : 'muted') + '</td>' +
          '<td class="num">' + (age == null ? '—' : age + 'd') + '</td></tr>';
      }, 'No issues match the current filter.');
      document.getElementById('po-is-table').innerHTML = head + '<tbody>' + body + '</tbody>';
    }
      // ⚠️ Wired here rather than by the host page: these two lines lived in the Portfolio
      //    Dashboard’s auth block, three thousand lines from the renderer they drive.
      document.getElementById('po-is-status').onchange = function (e) { isStatus = e.target.value; isRender(); };
      document.getElementById('po-is-q').oninput = function (e) { isQuery = e.target.value; isRender(); };
      return { load: loadIssues };
    }
  });

  /* ---- Meetings ------------------------------------------------------------ */
  def("meetings", {
    title: "Meetings",
    needs: [],
    markup: [
      "        <p style=\"font-size:12px;color:var(--pd-muted);margin:0 0 12px;\">Open action items — Closed items are left out, this is a worklist.</p>",
      "        <div class=\"pd-kpis\" id=\"po-mm-kpis\"></div>",
      "        <div class=\"po-card\" style=\"padding:0;overflow:hidden;\">",
      "          <div style=\"overflow-x:auto;\"><table class=\"po-table\" id=\"po-mm-table\"></table></div>",
      "        </div>"
    ].join('\n'),
    setup: function () {
    // ================= Portfolio Minutes of Meeting — open action items (cross-project) ======
    // ⚠️ Deliberately simplified: reads `mom_items.status` directly rather than resolving a
    // raised item's live status through its linked issues_lessons row, the way the Minutes of
    // Meeting module itself does. This is a cross-project WORKLIST, not the register of record —
    // the module stays authoritative for a raised action's true status.
    var mmItems = null, mmMoms = null, mmLoadedIds = null;
    async function loadMeetings(force) {
      var ids = scopedProjectIds();
      if (!force && mmLoadedIds && mmLoadedIds.join(',') === ids.join(',')) return;
      var tbl = document.getElementById('po-mm-table'), kpis = document.getElementById('po-mm-kpis');
      if (!ids.length) { kpis.innerHTML = ''; tbl.innerHTML = ''; return; }
      tbl.innerHTML = '<tbody><tr><td class="po-empty">Reading minutes across ' + ids.length + ' project(s)…</td></tr></tbody>';
      kpis.innerHTML = '';
      try {
        var res = await Promise.all([
          PDb.selectAll('meeting_minutes', function (q) { return q.in('project_id', ids); }),
          PDb.selectAll('mom_items', function (q) { return q.in('project_id', ids); })
        ]);
        mmMoms = res[0]; mmItems = res[1];
      } catch (e) {
        var msg = (e && e.message) || String(e);
        tbl.innerHTML = '<tbody><tr><td class="po-empty">' + esc(msg) + '</td></tr></tbody>';
        return;
      }
      mmLoadedIds = ids;
      mmRender();
    }
    function mmRender() {
      var momById = {}; (mmMoms || []).forEach(function (m) { momById[m.id] = m; });
      var open = (mmItems || []).filter(function (it) { return (it.status || 'Open') !== 'Closed'; });
      var overdue = open.filter(function (it) { return it.due_date && pd(it.due_date) < today(); });
      var draftMoms = (mmMoms || []).filter(function (m) { return !m.is_distributed; }).length;
      document.getElementById('po-mm-kpis').innerHTML =
        kpi2('Meetings recorded', String((mmMoms || []).length)) + kpi2('Draft minutes', String(draftMoms)) +
        kpi2('Open action items', String(open.length)) + kpi2('Overdue', String(overdue.length), overdue.length ? '--pd-bad' : null);
      var sorted = open.slice().sort(function (a, b) { var x = a.due_date || '9999', y = b.due_date || '9999'; return x.localeCompare(y); });
      var head = '<thead><tr><th>Meeting</th><th>Action item</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>';
      var body = groupedBody(sorted, 5, function (it) {
        var m = momById[it.mom_id];
        var late = !!(it.due_date && pd(it.due_date) < today());
        return '<tr>' +
          '<td>' + esc((m && m.title) || '—') + (m && m.meeting_date ? ' <span style="color:var(--pd-muted);">· ' + esc(Fmt.date(m.meeting_date)) + '</span>' : '') + '</td>' +
          '<td>' + esc(clip(it.action_item || it.description, 90) || '(no action text)') + '</td>' +
          '<td>' + esc(it.owner || '—') + '</td>' +
          '<td>' + (it.due_date ? Fmt.date(it.due_date) : '—') + '</td>' +
          '<td>' + statePill(late ? 'Overdue' : (it.status || 'Open'), late ? 'bad' : 'warn') + '</td></tr>';
      }, 'No open action items across the selected projects.');
      document.getElementById('po-mm-table').innerHTML = head + '<tbody>' + body + '</tbody>';
    }
      return { load: loadMeetings };
    }
  });

  /* ---- Contracts & Claims ------------------------------------------------------------ */
  def("contracts", {
    title: "Contracts & Claims",
    needs: [],
    markup: [
      "        <div class=\"pd-kpis\" id=\"po-ct-kpis\"></div>",
      "        <!-- ⚠⚠ RANKED BY UNRECOVERED EXPOSURE, NOT ALPHABETICALLY (2026-09-15). The question this",
      "             page exists to answer for management is \"which project is bleeding\", and a list sorted",
      "             by project name actively hides that — the worst project is wherever the alphabet put",
      "             it. The old flat table is kept below, because the page is also used to find one row. -->",
      "        <div class=\"po-card\" id=\"po-ct-rankcard\">",
      "          <h3 style=\"text-transform:none;font-size:15px;\">Projects by unrecovered exposure</h3>",
      "          <div style=\"overflow-x:auto;\"><table class=\"po-table\" id=\"po-ct-rank\"></table></div>",
      "          <p class=\"po-ct-note\" id=\"po-ct-ranknote\"></p>",
      "        </div>",
      "        <div class=\"po-card\" id=\"po-ct-agecard\">",
      "          <h3 style=\"text-transform:none;font-size:15px;\">How long the client has been holding it</h3>",
      "          <ul class=\"po-ages\" id=\"po-ct-age\"></ul>",
      "          <p class=\"po-ct-note\">Counted from <b>date submitted</b>, and only while a record is Pending.",
      "            A record with no submitted date is listed separately — it is waiting on us, not the client.</p>",
      "        </div>",
      "        <!-- ⚠ The full register is KEPT, behind a disclosure. It is the only way to find a specific",
      "             row on this page, and deleting it to make room for the summary would trade one job for",
      "             another. Shut by default: a summary that opens on 900 rows is not a summary. -->",
      "        <details class=\"po-card po-ct-all\" id=\"po-ct-allwrap\">",
      "          <summary id=\"po-ct-allsum\">All records</summary>",
      "          <div style=\"overflow-x:auto;margin-top:10px;\"><table class=\"po-table\" id=\"po-ct-table\"></table></div>",
      "        </details>"
    ].join('\n'),
    setup: function () {
    // ================= Portfolio Contracts & Claims (cross-project) =================
    var ctRows = null, ctLoadedIds = null;
    function ctDesc(r) {
      var ref = (r.reference_no || '').trim(), d = (r.description || '').trim() || (r.title || '').trim();
      if (ref && d) return ref + ' — ' + d;
      return d || ref || '(untitled)';
    }
    async function loadContracts(force) {
      var ids = scopedProjectIds();
      if (!force && ctLoadedIds && ctLoadedIds.join(',') === ids.join(',')) return;
      var tbl = document.getElementById('po-ct-table'), kpis = document.getElementById('po-ct-kpis');
      if (!ids.length) { kpis.innerHTML = ''; tbl.innerHTML = ''; return; }
      tbl.innerHTML = '<tbody><tr><td class="po-empty">Reading contracts &amp; claims across ' + ids.length + ' project(s)…</td></tr></tbody>';
      kpis.innerHTML = '';
      try {
        ctRows = await PDb.selectAll('contracts_claims', function (q) { return q.in('project_id', ids); });
      } catch (e) {
        var msg = (e && e.message) || String(e);
        tbl.innerHTML = '<tbody><tr><td class="po-empty">' + esc(msg) + '</td></tr></tbody>';
        return;
      }
      ctLoadedIds = ids;
      ctRender();
    }
    /* ==========================================================================================
       PORTFOLIO CONTRACTS & CLAIMS — rebuilt 2026-09-15.
       Owner: *"in terms of portfolio-level contracts & claims there should be a proper dashboard as
       well but should provide portfolio level information that can provide informed decisions for
       higher management. UI in the portfolio-level needs work as well."*

       What was here was four KPI tiles and every row of every project's register in one flat table
       sorted by project NAME. That is a register, not a decision surface — the project that most
       needs attention was wherever the alphabet happened to put it.

       ⚠️⚠️ EVERY RULE COMES FROM `PDClaims`, NEVER RE-DERIVED HERE. Decided = Approved +
         Disapproved, shortfall clamped at 0, recovery over decided only, aging derived from
         date_submitted while Pending. Those exist in the project dashboard's panel and the
         register's own band too, and three screens each computing them would be the drift this repo
         keeps paying for.
       ⚠️ MONEY AND DAYS ARE REPORTED SEPARATELY. EOT is time, not cash — `PDClaims` is given the
         day keys for it and the amount keys for the rest, and the two are never added.
       ========================================================================================== */
    function ctRender() {
      var list = ctRows || [];
      var nameById = {}; PROJ.forEach(function (p) { nameById[p.id] = p.name || p.id; });
      var today = PDClaims.todayISO();

      /* Cash-bearing claims (Claim + Change Order) and EOT are two different currencies. */
      var claimish = PDClaims.claimsOnly(list);
      var cash = claimish.filter(function (r) { return PDClaims.typeOf(r) !== 'EOT'; });
      var eots = PDClaims.ofType(claimish, 'EOT');

      var contractVal = PDClaims.contractValue(list);
      var decCash = PDClaims.decided(cash);
      var claimed = PDClaims.sum(decCash, 'sub_amount');
      var certified = PDClaims.sum(decCash, 'approved_amount');
      var shortfall = PDClaims.shortfallOf(cash, 'sub_amount', 'approved_amount');
      var pendVal = PDClaims.pendingValue(cash, 'eval_amount', 'sub_amount');
      var pendDays = PDClaims.pendingValue(eots, 'eval_days', 'sub_days');
      var rec = PDClaims.recoveryOf(cash, 'sub_amount', 'approved_amount');
      /* ⚠️ The SAME key list `pendingValue` above gets, or the bars do not add up to the
         “Pending with client” figure printed beside them. */
      var ag = PDClaims.agingBuckets(cash, ['eval_amount', 'sub_amount'], today);

      /* ⚠️ "Exposure" is pending + shortfall: money asked for and not yet certified, plus money
         asked for and refused. Both are unrecovered; only one of them is still arguable. They are
         shown as separate figures AND summed for the ranking, never silently merged into one. */
      document.getElementById('po-ct-kpis').innerHTML =
        kpi2('Contract value', Fmt.moneyShort(contractVal)) +
        kpi2('Pending with client', Fmt.moneyShort(pendVal), pendVal ? '--pd-warn-text' : '') +
        kpi2('Shortfall', Fmt.moneyShort(shortfall), shortfall ? '--pd-bad-text' : '') +
        kpi2('Recovery rate', rec == null ? '—' : Math.round(rec) + '%',
             rec == null ? '' : (rec >= 80 ? '--pd-ok-text' : (rec < 50 ? '--pd-bad-text' : '--pd-warn-text'))) +
        kpi2('EOT pending', pendDays ? Math.round(pendDays) + 'd' : '—') +
        kpi2('Oldest pending', ag.oldest != null ? ag.oldest + 'd' : '—',
             (ag.oldest != null && ag.oldest > 90) ? '--pd-bad-text' : '');

      ctRenderRank(cash, eots, nameById, today);
      ctRenderAging(ag, cash, today);

      // ⚠️ The project half of this sort is GONE, not merely reordered: the band now groups by
      // project, so sorting rows by project name as well would be a second, competing ordering —
      // and one keyed on the NAME where the bands are keyed on the CODE, which is how a table
      // ends up with its groups in one order and its rows in another.
      var sorted = list.slice().sort(function (a, b) {
        return (a.record_type || '').localeCompare(b.record_type || '');
      });
      var head = '<thead><tr><th>Type</th><th>Reference</th><th>Counterparty</th><th class="num">Amount</th><th>Status</th></tr></thead>';
      var body = groupedBody(sorted, 5, function (r) {
        var amt = r.record_type === 'Contract' ? r.amount : (r.approved_amount != null ? r.approved_amount : (r.eval_amount != null ? r.eval_amount : r.sub_amount));
        var st = r.record_type === 'Contract' ? null : (r.status || 'Pending');
        return '<tr>' +
          '<td>' + esc(r.record_type || '—') + '</td>' +
          '<td>' + esc(ctDesc(r)) + '</td>' +
          '<td>' + esc(r.counterparty || '—') + '</td>' +
          '<td class="num">' + (amt != null ? Fmt.moneyShort(amt) : '—') + '</td>' +
          '<td>' + (st ? statePill(st, st === 'Approved' ? 'ok' : st === 'Pending' ? 'warn' : st === 'Disapproved' ? 'bad' : 'muted') : '—') + '</td></tr>';
      }, 'No contract or claim records match the current filter.');
      document.getElementById('po-ct-table').innerHTML = head + '<tbody>' + body + '</tbody>';
      /* ⚠️ The disclosure states its own count. A `<summary>` reading only "All records" gives no
         reason to open it and no sense of what is behind it. */
      var sum = document.getElementById('po-ct-allsum');
      if (sum) sum.textContent = 'All records (' + list.length + ')';
    }

    /* One row per project, ranked by what is unrecovered. ⚠️ Projects with NOTHING outstanding are
       still listed, at the bottom — a management view that hides the healthy projects cannot be used
       to say "these four are fine", which is half of what it is for. */
    function ctRenderRank(cash, eots, nameById, today) {
      var by = {};
      function slot(pid) {
        if (!by[pid]) by[pid] = { pid: pid, cash: [], eots: [] };
        return by[pid];
      }
      cash.forEach(function (r) { slot(r.project_id).cash.push(r); });
      eots.forEach(function (r) { slot(r.project_id).eots.push(r); });

      var rowsOut = Object.keys(by).map(function (pid) {
        var g = by[pid];
        var pend = PDClaims.pendingValue(g.cash, 'eval_amount', 'sub_amount');
        var shortf = PDClaims.shortfallOf(g.cash, 'sub_amount', 'approved_amount');
        var recv = PDClaims.recoveryOf(g.cash, 'sub_amount', 'approved_amount');
        var agg = PDClaims.agingBuckets(g.cash, ['eval_amount', 'sub_amount'], today);
        var eotPend = PDClaims.pendingValue(g.eots, 'eval_days', 'sub_days');
        return { pid: pid, name: nameById[pid] || pid, pend: pend, shortf: shortf,
                 recv: recv, oldest: agg.oldest, eotPend: eotPend,
                 nPend: PDClaims.pending(g.cash).length + PDClaims.pending(g.eots).length,
                 exposure: pend + shortf };
      });
      /* ⚠️ Ties break on the OLDEST pending, not on the name: two projects with the same exposure
         are not equally urgent if one has been waiting four months. */
      rowsOut.sort(function (a, b) {
        return (b.exposure - a.exposure) || ((b.oldest || 0) - (a.oldest || 0)) ||
               a.name.localeCompare(b.name);
      });

      var head = '<thead><tr><th>Project</th><th class="num">Pending</th><th class="num">Shortfall</th>' +
        '<th class="num">Unrecovered</th><th class="num">EOT</th><th class="num">Oldest</th>' +
        '<th class="num">Recovery</th></tr></thead>';
      var body = rowsOut.length ? rowsOut.map(function (r) {
        var tone = r.oldest == null ? '' : (r.oldest > 90 ? ' style="color:var(--pd-bad-text);"'
                                         : (r.oldest > 60 ? ' style="color:var(--pd-warn-text);"' : ''));
        var rtone = r.recv == null ? '' : (r.recv >= 80 ? ' style="color:var(--pd-ok-text);"'
                                        : (r.recv < 50 ? ' style="color:var(--pd-bad-text);"' : ''));
        return '<tr><td>' + esc(r.name) + '</td>' +
          '<td class="num">' + (r.pend ? Fmt.moneyShort(r.pend) : '—') + '</td>' +
          '<td class="num">' + (r.shortf ? Fmt.moneyShort(r.shortf) : '—') + '</td>' +
          '<td class="num"><b>' + (r.exposure ? Fmt.moneyShort(r.exposure) : '—') + '</b></td>' +
          '<td class="num">' + (r.eotPend ? Math.round(r.eotPend) + 'd' : '—') + '</td>' +
          '<td class="num"' + tone + '>' + (r.oldest != null ? r.oldest + 'd' : '—') + '</td>' +
          /* ⚠️ An em dash, never 0%. Nothing decided yet is not a 0% recovery rate — it is the
             absence of a rate, and printing 0 would read as total refusal. */
          '<td class="num"' + rtone + '>' + (r.recv == null ? '—' : Math.round(r.recv) + '%') + '</td></tr>';
      }).join('') : '<tr><td colspan="7" class="po-empty">No claims, change orders or extensions of time on these projects.</td></tr>';
      document.getElementById('po-ct-rank').innerHTML = head + '<tbody>' + body + '</tbody>';

      var note = document.getElementById('po-ct-ranknote');
      if (note) {
        note.innerHTML = '<b>Unrecovered</b> is pending plus shortfall — money asked for and not yet ' +
          'certified, plus money asked for and refused. Both are outstanding; only the first is still ' +
          'arguable. <b>EOT</b> is time, kept apart from the cash columns and never added to them.';
      }
    }

    function ctRenderAging(ag, cash, today) {
      var host = document.getElementById('po-ct-age');
      if (!host) return;
      /* Scaled to the largest bucket, not the total — see the same note in contracts-claims'
         own band. Scaled to the total, a healthy portfolio draws three invisible slivers. */
      var worst = Math.max.apply(null, ag.buckets.map(function (b) { return b.value; }).concat([1]));
      var li = ag.buckets.map(function (b) {
        var w = Math.max(b.value ? 2 : 0, Math.round(b.value / worst * 100));
        var tone = b.key === '90+' ? ' po-age-bad' : (b.key === '61-90' ? ' po-age-warn' : '');
        return '<li class="po-age' + tone + '"><span class="po-age-l">' + esc(b.label) + '</span>' +
          '<span class="po-age-bar"><i style="width:' + w + '%"></i></span>' +
          '<span class="po-age-v">' + (b.n ? Fmt.moneyShort(b.value) + ' · ' + b.n : '—') + '</span></li>';
      }).join('');
      if (ag.unsent) {
        li += '<li class="po-age po-age-unsent"><span class="po-age-l">Not submitted</span>' +
          '<span class="po-age-bar"></span><span class="po-age-v">' +
          Fmt.moneyShort(ag.unsentValue) + ' · ' + ag.unsent + '</span></li>';
      }
      host.innerHTML = li || '<li class="po-age"><span class="po-age-l">Nothing pending.</span></li>';
    }
      return { load: loadContracts };
    }
  });

  /* ---- Progress Photos ------------------------------------------------------------ */
  def("photos", {
    title: "Progress Photos",
    needs: [],
    markup: [
      "        <p style=\"font-size:12px;color:var(--pd-muted);margin:0 0 12px;\">Only photos marked as a favorite (starred in a project's Gallery) are shown here.</p>",
      "        <div class=\"pd-kpis\" id=\"po-ph-kpis\"></div>",
      "        <div class=\"po-card\">",
      "          <h3 style=\"text-transform:none;font-size:15px;\">Most recently favorited</h3>",
      "          <div class=\"po-photo-grid\" id=\"po-ph-grid\"></div>",
      "        </div>",
      "        <div class=\"po-card\" style=\"margin-top:16px;padding:0;overflow:hidden;\">",
      "          <div style=\"overflow-x:auto;\"><table class=\"po-table\" id=\"po-ph-table\"></table></div>",
      "        </div>"
    ].join('\n'),
    setup: function () {
    // ================= Portfolio Progress Photos (cross-project) =================
    // ⚠️ Deliberately narrow: one bucket ('progress-photos') shared by every project (not a
    // per-project bucket), so a batched createSignedUrls call — the same primitive the module
    // itself uses — is enough for a recent-photos strip. No presentation/PPR consolidation here;
    // that stays a per-project screen.
    // ⚠️ 2026-09-07: scoped to FAVORITES ONLY (owner's ask — "in portfolio level, only favorite
    // photos are displayed"). `.eq('favorite', true)` narrows the read itself, not just the
    // display, so the KPI counts/grid/table can never disagree with what was actually fetched.
    // Tolerant of the pre-migration state (migrations/2026-09-07-progress-photos-favorites.sql
    // not yet run): a missing `favorite` column degrades to the same "run the migration" nudge
    // this file already uses for equipment/resources, rather than a raw PostgREST error.
    var phRows = null, phLoadedIds = null;
    var PH_BUCKET = 'progress-photos';
    async function loadPhotos(force) {
      var ids = scopedProjectIds();
      if (!force && phLoadedIds && phLoadedIds.join(',') === ids.join(',')) return;
      var kpis = document.getElementById('po-ph-kpis'), grid = document.getElementById('po-ph-grid'), tbl = document.getElementById('po-ph-table');
      if (!ids.length) { kpis.innerHTML = ''; grid.innerHTML = ''; tbl.innerHTML = ''; return; }
      grid.innerHTML = '<div class="po-empty">Reading the favorited photos of ' + ids.length + ' project(s)…</div>';
      kpis.innerHTML = ''; tbl.innerHTML = '';
      try {
        phRows = await PDb.selectAll('progress_photos', function (q) { return q.in('project_id', ids).eq('favorite', true); });
      } catch (e) {
        var msg = (e && e.message) || String(e);
        grid.innerHTML = '<div class="po-empty">' + (/favorite|schema cache/i.test(msg)
          ? 'Run <code>migrations/2026-09-07-progress-photos-favorites.sql</code> to enable favorites and the portfolio-level favorites view.'
          : 'Could not load: ' + esc(msg)) + '</div>';
        return;
      }
      phLoadedIds = ids;
      await phRender();
    }
    async function phRender() {
      var list = phRows || [];
      var nameById = {}; PROJ.forEach(function (p) { nameById[p.id] = p.name || p.id; });
      var trades = {}; list.forEach(function (r) { if (r.trade) trades[r.trade] = 1; });
      var withProj = {}; list.forEach(function (r) { withProj[r.project_id] = 1; });
      var latest = list.reduce(function (mx, r) { return (r.taken_at && r.taken_at > mx) ? r.taken_at : mx; }, '');
      document.getElementById('po-ph-kpis').innerHTML =
        kpi2('Favorited photos', String(list.length)) + kpi2('Trades covered', String(Object.keys(trades).length)) +
        kpi2('Projects', String(Object.keys(withProj).length)) + kpi2('Latest capture', latest ? Fmt.date(latest) : '—');

      var recent = list.slice().sort(function (a, b) { return (b.taken_at || '').localeCompare(a.taken_at || ''); }).slice(0, 18);
      var grid = document.getElementById('po-ph-grid');
      if (!recent.length) { grid.innerHTML = '<div class="po-empty">No photos have been favorited on the selected projects yet. Star a photo in a project\'s Gallery to have it show up here.</div>'; }
      else {
        var paths = recent.map(function (r) { return r.thumb_url || r.photo_url; }).filter(Boolean);
        var urlByPath = {};
        if (paths.length) {
          try {
            var sres = await sb().storage.from(PH_BUCKET).createSignedUrls(paths, 3600);
            (sres.data || []).forEach(function (d) { if (d && d.signedUrl && !d.error) urlByPath[d.path] = d.signedUrl; });
          } catch (e) { /* previews degrade to placeholder boxes below — the table still loads */ }
        }
        grid.innerHTML = recent.map(function (r) {
          var path = r.thumb_url || r.photo_url, url = path ? urlByPath[path] : '';
          return '<div class="po-photo-item">' +
            (url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<div style="width:150px;height:104px;border-radius:8px;background:var(--pd-bg);border:1px solid var(--pd-line);"></div>') +
            // ⚠️ The CODE, not the name it used to print. A tile is ~150px wide and a project
            // name routinely runs past that, so the caption was being ellipsised into something
            // that identified nothing; the code is short enough to read at a glance and is what
            // every other consolidated screen now marks a row with. The full name is still one
            // hover away, in the title this tile already carried.
            '<div class="po-photo-cap" title="' + esc((nameById[r.project_id] || r.project_id) + ' — ' + (r.description || '')) + '">' +
            projTag(r.project_id) + '</div></div>';
        }).join('');
      }

      var byProj = {};
      list.forEach(function (r) {
        var g = byProj[r.project_id] || (byProj[r.project_id] = { n: 0, latest: '', trades: {} });
        g.n++; if (r.taken_at && r.taken_at > g.latest) g.latest = r.taken_at; if (r.trade) g.trades[r.trade] = 1;
      });
      var rows = Object.keys(byProj).map(function (id) { return { id: id, name: nameById[id] || id, n: byProj[id].n, latest: byProj[id].latest, trades: Object.keys(byProj[id].trades).length }; })
        .sort(function (a, b) { return b.n - a.n; });
      var head = '<thead><tr><th>Project</th><th class="num">Favorited photos</th><th class="num">Trades</th><th>Latest capture</th></tr></thead>';
      var body = rows.length ? rows.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td class="num">' + r.n + '</td><td class="num">' + r.trades + '</td><td>' + (r.latest ? Fmt.date(r.latest) : '—') + '</td></tr>';
      }).join('') : '<tr><td colspan="4" class="po-empty">No photos have been favorited on the selected projects yet.</td></tr>';
      document.getElementById('po-ph-table').innerHTML = head + '<tbody>' + body + '</tbody>';
    }
      return { load: loadPhotos };
    }
  });

  /* ---- Productivity Rates ------------------------------------------------------------ */
  def("productivity", {
    title: "Productivity Rates",
    needs: [],
    markup: [
      "        <p style=\"font-size:12px;color:var(--pd-muted);margin:0 0 12px;\">Rate = output ÷ (crew or equipment × working days).</p>",
      "        <div class=\"pd-kpis\" id=\"po-pr-kpis\"></div>",
      "        <div class=\"po-card\" style=\"padding:0;overflow:hidden;\">",
      "          <div style=\"overflow-x:auto;\"><table class=\"po-table\" id=\"po-pr-table\"></table></div>",
      "        </div>"
    ].join('\n'),
    setup: function () {
    // ================= Portfolio Productivity Rates (cross-project) =================
    var prActs = null, prEntries = null, prLoadedIds = null;
    function prRateOf(qty, res, wd) { return (qty != null && res > 0 && wd > 0) ? qty / (res * wd) : null; }
    async function loadProductivity(force) {
      var ids = scopedProjectIds();
      if (!force && prLoadedIds && prLoadedIds.join(',') === ids.join(',')) return;
      var tbl = document.getElementById('po-pr-table'), kpis = document.getElementById('po-pr-kpis');
      if (!ids.length) { kpis.innerHTML = ''; tbl.innerHTML = ''; return; }
      tbl.innerHTML = '<tbody><tr><td class="po-empty">Reading productivity monitoring across ' + ids.length + ' project(s)…</td></tr></tbody>';
      kpis.innerHTML = '';
      try {
        var res = await Promise.all([
          PDb.selectAll('productivity_activities', function (q) { return q.in('project_id', ids); }),
          PDb.selectAll('productivity_entries', function (q) { return q.in('project_id', ids); })
        ]);
        prActs = res[0]; prEntries = res[1];
      } catch (e) {
        var msg = (e && e.message) || String(e);
        tbl.innerHTML = '<tbody><tr><td class="po-empty">' + esc(msg) + '</td></tr></tbody>';
        return;
      }
      prLoadedIds = ids;
      prRender();
    }
    function prRender() {
      var nameById = {}; PROJ.forEach(function (p) { nameById[p.id] = p.name || p.id; });
      var byAct = {}; (prEntries || []).forEach(function (e) { (byAct[e.activity_id] = byAct[e.activity_id] || []).push(e); });
      var projSet = {}; (prActs || []).forEach(function (a) { projSet[a.project_id] = 1; });
      document.getElementById('po-pr-kpis').innerHTML =
        kpi2('Activities tracked', String((prActs || []).length)) + kpi2('Monthly entries', String((prEntries || []).length)) +
        kpi2('Projects reporting', String(Object.keys(projSet).length));
      var rows = (prActs || []).map(function (a) {
        var es = (byAct[a.id] || []).slice().sort(function (x, y) { return (x.period || '').localeCompare(y.period || ''); });
        var latest = null;
        for (var i = es.length - 1; i >= 0; i--) { var r = prRateOf(es[i].qty_actual, es[i].mp_actual, es[i].work_days); if (r != null) { latest = r; break; } }
        return { a: a, months: es.length, latest: latest };
      }).sort(function (x, y) { return (nameById[x.a.project_id] || '').localeCompare(nameById[y.a.project_id] || '') || (x.a.name || '').localeCompare(y.a.name || ''); });
      var head = '<thead><tr><th>Project</th><th>Activity</th><th>Type</th><th class="num">Months reported</th><th class="num">Latest rate</th></tr></thead>';
      var body = rows.length ? rows.map(function (r) {
        var unit = (r.a.unit || 'unit') + '/' + (r.a.resource_type === 'Equipment' ? (r.a.resource_unit || 'unit') + '-day' : 'man-day');
        return '<tr><td>' + esc(nameById[r.a.project_id] || r.a.project_id) + '</td>' +
          '<td>' + esc(r.a.name || '(unnamed)') + '</td>' +
          '<td>' + esc(r.a.resource_type || 'Manpower') + '</td>' +
          '<td class="num">' + r.months + '</td>' +
          '<td class="num">' + (r.latest == null ? '—' : (Math.round(r.latest * 100) / 100) + ' ' + esc(unit)) + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="po-empty">No productivity activities on the selected projects yet.</td></tr>';
      document.getElementById('po-pr-table').innerHTML = head + '<tbody>' + body + '</tbody>';
    }
      return { load: loadProductivity };
    }
  });

  /* ---- mounting -----------------------------------------------------------------------------
     ⚠️ ONE ENTRY POINT, and it is async: the markup goes in, the projects are fetched once, then
     the view loads itself. A module calls it and awaits it; nothing else needs to know how a
     dashboard is built. */
  async function mount(key, host, opts) {
    opts = opts || {};
    var v = VIEWS[key];
    if (!v) throw new Error('No portfolio dashboard called "' + key + '"');
    if (!host) throw new Error('No host element for the "' + key + '" dashboard');
    host.classList.add('po-dash');
    host.innerHTML = v.markup;
    /* ⚠️ THE FILTER ROW OPENS BY DEFAULT HERE, and that is not a style tweak. On the Portfolio
       Dashboard these fields hid behind that page's own funnel button (UI.wireFilterToggle); a
       module has no such button to bind to, so left alone the row would be permanently invisible
       and the view would lose its search and status filter outright. */
    Array.prototype.forEach.call(host.querySelectorAll('.po-toolbar-fields'), function (f) {
      f.classList.add('open');
    });
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
    var api = v.setup();
    await loadProjects();
    await api.load(true);
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
    return api;
  }

  /* The module's own portfolio face: its normal UI steps aside and the dashboard takes the page.
     ⚠️ HIDDEN, NOT REMOVED. The module's script has already wired handlers to those nodes and is
     free to keep rendering into them; tearing them out of the DOM would turn every one of those
     handlers into a null dereference, which is a fault in a module that has nothing to do with
     this change.
     ⚠️ The module bar goes with them: its buttons act on the UI that is no longer showing. The
     four fixed chrome controls (project selector, presence, user bar, sidebar) stay — they are
     how a planner leaves portfolio scope again. */
  async function takeOver(key, opts) {
    opts = opts || {};
    var mainSel = opts.main || '.pd-main';
    var main = document.querySelector(mainSel);
    if (!main) throw new Error('No ' + mainSel + ' to mount the "' + key + '" dashboard in');
    Array.prototype.forEach.call(main.children, function (c) { c.hidden = true; });
    Array.prototype.forEach.call(document.querySelectorAll(opts.hide || '.pd-modulebar'), function (n) { n.hidden = true; });
    var host = document.createElement('div');
    host.id = 'po-dash-host';
    main.appendChild(host);
    if (opts.select) wireSelect(document.querySelector(opts.select));
    return mount(key, host, opts);
  }

  /* ⚠️⚠️ THE WAY BACK OUT, and it is the module that would otherwise lose it. A module hosting
     one of these dashboards skips its own init() (see each module’s branch) — and with it the code
     that fills the topbar’s project <select>. Left alone, a planner standing on the portfolio view
     of Risk Register could reach every OTHER page from the sidebar but could not open THIS module
     on one project, which is the first thing anybody tries.
     ⚠️ Choosing a project does what the module’s own onchange does — leave portfolio scope,
     remember the project, reload — rather than handing a project id to a module that was never
     initialised to receive one. The hash goes with the reload, so the page comes back in project
     scope instead of straight into this dashboard again. */
  async function wireSelect(sel) {
    if (!sel) return;
    await loadProjects();
    sel.innerHTML = '<option value="">Select project…</option>' +
      PROJ.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.name || p.id) + '</option>';
      }).join('');
    if (window.UI && UI.enhanceProjectSelect) UI.enhanceProjectSelect(sel);
    sel.onchange = function () {
      var id = this.value;
      if (!id) return;
      if (window.AppAuth && AppAuth.setPortfolioScope) AppAuth.setPortfolioScope(false);
      try {
        sessionStorage.setItem('pd_project', id);
        var o = this.options[this.selectedIndex];
        if (o) sessionStorage.setItem('pd_project_name', o.textContent);
      } catch (e) {}
      location.href = location.pathname + location.search;
    };
  }

  window.PortfolioDash = {
    mount: mount, takeOver: takeOver,
    has: function (k) { return !!VIEWS[k]; },
    keys: function () { return Object.keys(VIEWS); },
    titleOf: function (k) { return VIEWS[k] ? VIEWS[k].title : null; },
    needs: function (k) { return VIEWS[k] ? (VIEWS[k].needs || []).slice() : []; },
    // ⚠️ Test seam. The harness fills the project list and reads it back rather than reaching
    // into the closure, so the renderers can be exercised against fixtures with no network.
    _setProjects: function (p, g) { PROJ = p || []; GH = g || []; _loadedP = Promise.resolve(); },
    _projects: function () { return PROJ.slice(); }
  };
})();
