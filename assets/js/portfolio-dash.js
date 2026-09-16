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
   fault this change exists to end. `portfolio-overview` no longer carries these ten at all.

   ⚠️⚠️ TEN, NOT SIX — THE SECOND WAVE LANDED 2026-09-16. Six light registers moved on
   2026-09-15; the owner, looking at what was left, said it again and more precisely: *"those
   dashboards must be the landing page of each module when under the portfolio view."* So the
   four heaviest followed — the Portfolio S-Curve, the Consolidated Cash Flow, the
   server-aggregated Resources roll-up and the Equipment availability grid — into `s-curve`,
   `cash-flow`, `resource-loading` and `equipment-loading`.
   ⚠️ THREE OF THOSE FOUR MODULES WERE REFUSING TO ANSWER THE QUESTION THE DASHBOARD ANSWERED.
   Opened portfolio-wide, S-Curve said "there is no single combined curve across every project"
   and Cash Flow said "there is no single combined figure" — while a tab on another page drew
   exactly that, from a server-side aggregate built for it. The refusal was true of the
   module's own engine and false of the app.

   ⚠️ SCOPE IS EVERY PROJECT THE PLANNER CAN SEE, and there is deliberately no multi-project
   picker here: a module in portfolio scope already has the shared project selector in its topbar
   reading "Portfolio", and choosing a real project there LEAVES portfolio scope for that project's
   own module (UI.enhanceProjectSelect). One control, one meaning, rather than a second filter that
   disagrees with it.
   ⚠️ READ-ONLY, AND THE NETWORK ENFORCES IT: writes are refused at the shared Supabase chokepoint
   while the portfolio flag is set (auth.js), so none of these views may author anything. That is
   why the Stakeholder Map — whose portfolio view CARRIES an authoring directory ("+ Add person") —
   is NOT in this file: moving it here would have silently broken the one thing it does. It and the
   Milestone calendar (which has no module to move to) are all that is left on the Dashboard
   beside its own Overview.
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
  /* ⚠️⚠️ THE SAME CLASS OF FAULT AS THE DATE PAIR ABOVE, CAUGHT A SECOND TIME AND BY RUNNING
     THE VIEW RATHER THAN READING IT. The Project Schedule dashboard's month axis reached for
     `cfMonthLabel(...)` — a helper that exists only inside the CASH FLOW dashboard's own
     `setup()` closure, a few hundred lines below. Each `def()` gets its own closure, so the
     call PARSES fine, `wiring-check` cannot see it (it enumerates globals, and this is neither),
     and it throws `cfMonthLabel is not defined` the moment the axis is drawn — which is every
     portfolio open whose span is under four years. Measured: the KPI strip rendered and the
     rows did not.
     ⚠️ Named `moLabel`, not `cfMonthLabel` — `cf` means CASH FLOW, and this is the generic month
     tick any view here can use. The cash-flow copy is deliberately left alone: it is another
     session's working code, and converging the two is its own change. */
  function moLabel(k) {
    var MABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var m = String(k || '').match(/^(\d{4})-(\d{2})$/);
    return m ? MABBR[+m[2] - 1] + " '" + m[1].slice(2) : String(k || '');
  }
  /* ⚠️⚠️ ONE grouping rule for every cross-project table here. Owner, of the Meetings and
     Issues portfolio views: *"we should group the meetings / issues and concerns per project
     first then sorted by meeting date."* Two copies of "group these rows by project" is how two
     views start disagreeing about what a project is and in what order they come — the drift this
     file already exists to end for the six dashboards it holds.
     ⚠️ By PROJECT, not by `PDProgram` parent: the ask is per project, and the Overview's own
     table is the place that rolls AVR101 + AVR102 up into one programme. Grouping differently in
     two places would be worse than not grouping at all.
     ⚠️ Groups are ordered by the project NAME the planner reads, not by id and not by row count —
     a list whose order changes as rows are filtered is one nobody can scan twice. */
  function groupByProject(rows, pidOf, nameById) {
    var by = {};
    rows.forEach(function (r) {
      var pid = pidOf(r);
      (by[pid] || (by[pid] = { pid: pid, name: nameById[pid] || pid, rows: [] })).rows.push(r);
    });
    return Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  }
  /* The group header row. ⚠️⚠️ THE APPROVED GROUP HEADING IS projects.html's, AND THIS EMITS IT:
     `.pd-group-row` + a `.pd-ghchip` (tinted, red LEFT BORDER) + a muted `.pd-ghcount` beside it —
     the same three classes `renderList()` in projects.html is drawn with, taken from dashboard.css
     rather than restated here. It used to be the Overview's own idiom (a bold plain cell and a
     `.po-mut` count), which is one of the "different table formats" the owner counted across five
     screens.
     ⚠️ The count carries its NOUN ("6 issues", "2 action items"), the way projects.html writes
     "2 projects". A naked number beside a project name reads as an id at a glance.
     ⚠️ `.po-grp` STAYS on the row and is not decoration — it is the hook `wireGroupToggle` binds
     the collapse to, and collapsing is the one thing projects.html's own groups cannot do. The
     caret stays with it: `.po-grp td` declares `cursor:pointer`, and a pointer over something that
     does not respond is a lie. */
  function groupHeadRow(g, cols, open, noun) {
    var n = g.rows.length;
    noun = noun || 'item';
    return '<tr class="pd-group-row po-grp" data-pgrp="' + esc(g.pid) + '"><td colspan="' + cols + '">' +
      '<span class="po-grp-name"><span class="po-caret">' + (open ? '\u25be' : '\u25b8') + '</span>' +
      '<span class="pd-ghchip">' + esc(g.name) + '</span>' +
      '<span class="pd-ghcount">' + n + ' ' + noun + (n === 1 ? '' : 's') + '</span>' +
      '</span></td></tr>';
  }
  /* ==== OPENING ONE ROW, ON THE PAGE IT IS ALREADY STANDING ON ===============================
     Owner 2026-09-16: *"For meetings and issues and concerns I want to be able to open those
     specific meetings/items from the table as well from the portfolio view, not just a viewing
     page."* The portfolio table was a read-only list of every project's rows with no way into any
     one of them — a planner who spotted the overdue item had to note the project, change the
     project selector, find the register, and find the row again.

     ⚠⚠ IT LEAVES PORTFOLIO SCOPE, AND IT HAS TO. Portfolio scope is read-only at the Supabase
     chokepoint (auth.js wraps `.from()` and refuses every write while the flag is set), so an
     issue "opened" with the flag still set would render an editor whose every Save is refused by
     the network — a detail screen that looks writable and is not. Opening one row means standing
     in that row's project, which is exactly what the project selector already does (`wireSelect`
     below); this is that same three-step move — clear the flag, remember the project, reload — with
     a deep link on the end.
     ⚠ SAME PAGE, NEVER A CONSTRUCTED PATH. `location.pathname` is the module's own page, because
     the portfolio view of Issues IS the Issues module and the portfolio view of Meetings IS the
     Minutes module. Building "../minutes-of-meeting/index.html" here would be a second copy of the
     app's URL layout, wrong the first time a page is renamed.
     ⚠ A FULL RELOAD, not a router hop: the module's own init() was deliberately SKIPPED on this
     page (see each module's portfolio branch), so nothing on it is initialised to receive a
     project. Reloading is what runs init() for real. */
  function openInProject(pid, hashOrSearch) {
    if (!pid) return;
    if (window.AppAuth && AppAuth.setPortfolioScope) AppAuth.setPortfolioScope(false);
    try {
      sessionStorage.setItem('pd_project', pid);
      var p = PROJ.filter(function (x) { return x.id === pid; })[0];
      if (p) sessionStorage.setItem('pd_project_name', p.name || p.id);
    } catch (e) {}
    location.href = location.pathname + (hashOrSearch || '');
  }
  /* The hash a module's own `UI.bindHistoryState` binding would have written for that view.
     ⚠⚠ THIS IS NOT A NEW DEEP-LINK PROTOCOL — it is the one the module already round-trips.
     `bindHistoryState` restores `key=<url-encoded JSON>` out of the hash on load ("a link landing
     straight on this page with our key already in the hash restores that view"), so a link built
     to that shape opens the meeting through the module's OWN apply(), with no second code path to
     keep in step with it. Invent a `?meeting=` parameter instead and there are two ways to open a
     meeting, one of which the module does not know about. */
  function stateHash(key, state) {
    return '#' + key + '=' + encodeURIComponent(JSON.stringify(state));
  }
  /* Binds whatever rows carry `data-open-pid` (+ an optional `data-open-to`, already a hash or a
     query string) to openInProject. ⚠ One binder, like wireGroupToggle beside it, so a view adds
     an attribute rather than a click handler.
     ⚠ The group heading also matches `[data-open-pid]` in no view — it carries `data-pgrp` — so
     collapsing a group cannot be mistaken for opening one. */
  function wireRowOpen(table) {
    table.querySelectorAll('tr[data-open-pid]').forEach(function (tr) {
      tr.onclick = function () { openInProject(tr.dataset.openPid, tr.dataset.openTo || ''); };
    });
  }
  /* One binder for the caret, so neither view has to remember how a group toggles. */
  function wireGroupToggle(table, collapsed, rerender) {
    table.querySelectorAll('.po-grp[data-pgrp]').forEach(function (g) {
      g.onclick = function () {
        var k = g.dataset.pgrp;
        if (collapsed[k]) delete collapsed[k]; else collapsed[k] = 1;
        rerender();
      };
    });
  }
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
  /* ==== THE PROJECT FILTER, AND WHY THIS FILE NOW HAS ONE ====================================
     This file's own header used to say, in as many words, that there is *"deliberately no
     multi-project picker here"* — the argument being that the topbar's project selector already
     says "Portfolio", and a second control that disagrees with it is worse than none.
     ⚠⚠ THE OWNER OVERRULED THAT ON 2026-09-16, about the S-Curve: *"the s-curve doesn't have a
     select project filter as well, on which projects that will be loaded in the s-curve."* And on
     that view the argument was always weakest: eighteen overlaid curves is not a portfolio answer,
     it is a thicket, and the renderer ALREADY carried the empty state for a narrowed selection
     ("No projects match the current filter") from its life on the Portfolio Dashboard — a filter
     it had been built for and then shipped without.
     ⚠ THE TWO CONTROLS DO NOT DISAGREE, and that is what makes this safe: the topbar selector
     answers *"which project am I in?"* (and "Portfolio" is a real answer — picking a project there
     LEAVES portfolio scope entirely), while this answers *"which of them is this view about?"*
     inside portfolio scope. One changes scope; one narrows within it.

     ⚠⚠ IT NARROWS `scopedProjectIds()`, NOTHING ELSE. Every renderer in this file already asks
     that one function which projects it is about — so all eleven honour the filter without a line
     of per-view code, and none of them can honour it differently from another. `PROJ` itself is
     deliberately NOT narrowed: it is also the id→name lookup every view builds its labels from,
     and a filtered PROJ would print raw ids for rows the filter had just excluded.
     ⚠ EMPTY MEANS EVERY PROJECT, NOT NO PROJECT. `{}` is the default and the "All projects" state;
     "Clear" returns to it rather than to an empty view. A filter whose cleared state shows nothing
     is one a planner has to fight to get out of. */
  var pfSel = {};             // {} = every project in scope. NEVER a selection of none.
  var pfQuery = '';
  var pfOnChange = null;
  function pfCount() { return Object.keys(pfSel).length; }
  function pfGroups() {
    /* ⚠ PDProgram is loaded by some module pages and not others (see shGroupOf's note), so an
       absent one degrades to a flat list of projects rather than throwing on a page that simply
       does not carry program.js. */
    if (window.PDProgram && PDProgram.groups) return PDProgram.groups(PROJ);
    return PROJ.map(function (p) { return { key: p.id, label: p.name || p.id, members: [p] }; });
  }
  function pfLabel() {
    var n = pfCount();
    if (!n) return 'All projects';
    if (n === 1) {
      var p = PROJ.filter(function (x) { return pfSel[x.id]; })[0];
      return p ? (p.name || p.id) : '1 project';
    }
    /* One whole parent project selected reads as that project, not as a count — "Avesta
       Residences (2 packages)" is the answer to "what am I looking at?". */
    var whole = pfGroups().filter(function (g) {
      return g.members.length > 1 && g.members.every(function (x) { return pfSel[x.id]; });
    });
    if (whole.length === 1 && whole[0].members.length === n) return whole[0].label + ' (' + n + ' packages)';
    return n + ' projects';
  }
  function scopedProjectIds() {
    if (!pfCount()) return PROJ.map(function (p) { return p.id; });
    /* ⚠ Ordered by PROJ, never by the order boxes were ticked: the views cache on
       `ids.join(',')` to decide whether anything needs re-reading, and a set that reorders itself
       would look like a different selection every time and re-fetch the same projects. */
    return PROJ.filter(function (p) { return pfSel[p.id]; }).map(function (p) { return p.id; });
  }

  /* ==== THE PORTFOLIO MODULE BAR =============================================================
     ⚠️⚠️ THE PAGE NEEDS A BAR OF ITS OWN BECAUSE takeOver() HIDES THE MODULE'S. It always meant
     to — that bar's buttons act on a UI that is no longer showing — but until the
     `hidden`-vs-`display` fix in takeOver() below it never actually did, so nobody had seen what a
     portfolio page looks like with the module bar really gone: no heading, no name, nothing saying
     which module you are standing in.
     ⚠️ SO THIS IS NOT DECORATION. It restores the one thing the hidden bar carried that the
     dashboard still needs (the module's mark and its name) and gives the two portfolio-level
     controls a home: the project filter, and — where a view has more than one screen — its tabs.
     ⚠️ IT REUSES `.pd-modulebar` rather than inventing a bar class: the shell already styles that
     element (height, border, the ≤700px stacking rule, the sidebar-collapse interaction), and a
     private class would be a second thing to keep level with it every time the shell moves. */
  function buildBar(key, view, opts) {
    var content = document.querySelector('.pd-content');
    var main = document.querySelector((opts && opts.main) || '.pd-main');
    if (!content || !main) return null;
    var bar = document.createElement('div');
    bar.className = 'pd-modulebar po-dash-bar';
    bar.id = 'po-dash-bar';
    var ico = (opts && opts.icon) || view.icon || 'grid';
    bar.innerHTML =
      '<h1><span class="po-bar-ico" data-ico="' + esc(ico) + '" data-ico-size="18"></span>' +
      esc(view.title) + '</h1>' +
      '<span class="po-bar-scope">Portfolio</span>' +
      '<div class="po-bar-tabs" id="po-bar-tabs"></div>' +
      '<div class="po-bar-tools" id="po-bar-tools">' +
        (view.filter === false ? '' : projFilterHTML()) +
      '</div>';
    content.insertBefore(bar, main);
    if (view.filter !== false) wireProjFilter(bar);
    if (window.Icons && Icons.hydrate) Icons.hydrate(bar);
    return bar;
  }

  /* The multi-select project popover. ⚠️ SAME MARKUP AND SAME CLASSES as the Portfolio
     Overview's own picker: `.po-projfilter*` is already fully styled in portfolio-dash.css —
     anchored RIGHT so it opens into the page instead of off the edge, and pinned to the viewport
     below 700px. Both of those were bugs paid for once; re-skinning this would have meant
     re-learning them. */
  function projFilterHTML() {
    return '<div class="po-projfilter" id="po-projfilter-wrap">' +
      '<button class="pd-btn" id="po-projfilter-btn" type="button" title="Which projects this view is scoped to">' +
        '<span data-ico="filter" data-ico-size="14"></span> <span id="po-projfilter-label">All projects</span>' +
        ' <span data-ico="chevronDown" data-ico-size="13"></span></button>' +
      '<div class="po-projfilter-menu" id="po-projfilter-menu">' +
        '<div class="po-projfilter-search"><input class="pd-input pd-input-sm" id="po-projfilter-search" placeholder="Search projects…" /></div>' +
        '<div class="po-projfilter-actions"><button type="button" data-act="all">Select all</button>' +
        '<button type="button" data-act="none">Clear</button></div>' +
        '<div class="po-projfilter-list" id="po-projfilter-list"></div>' +
      '</div></div>';
  }
  function renderProjFilterList() {
    var host = document.getElementById('po-projfilter-list');
    if (!host) return;
    var q = pfQuery.trim().toLowerCase();
    var match = function (p) { return !q || ((p.name || '') + ' ' + p.id).toLowerCase().indexOf(q) !== -1; };
    var groups = pfGroups().map(function (g) {
      /* A search matching the PARENT name keeps all its packages — searching "Avesta" must not
         hide AVR102 just because its own name reads "Towers 2-7". */
      var keep = (q && g.label.toLowerCase().indexOf(q) !== -1) ? g.members : g.members.filter(match);
      return { key: g.key, label: g.label, members: keep };
    }).filter(function (g) { return g.members.length; });
    if (!groups.length) { host.innerHTML = '<div class="po-pf-empty">No projects match.</div>'; return; }
    host.innerHTML = groups.map(function (g) {
      /* ⚠️ A program of ONE is not a group: a parent header above a single package invents a
         hierarchy that is not there. program.js's own rule, followed here too. */
      if (g.members.length === 1) {
        var p = g.members[0];
        return '<label><input type="checkbox" data-pf="' + esc(p.id) + '"' + (pfSel[p.id] ? ' checked' : '') +
          '> ' + esc(p.name || p.id) + '</label>';
      }
      var all = g.members.every(function (p) { return pfSel[p.id]; });
      var some = !all && g.members.some(function (p) { return pfSel[p.id]; });
      return '<label class="po-pf-prog"><input type="checkbox" data-pf-prog="' + esc(g.key) + '"' +
          (all ? ' checked' : '') + (some ? ' data-ind="1"' : '') + '> <strong>' + esc(g.label) + '</strong>' +
          '<span class="po-pf-count">' + g.members.length + ' packages</span></label>' +
        g.members.map(function (p) {
          return '<label class="po-pf-child"><input type="checkbox" data-pf="' + esc(p.id) + '"' +
            (pfSel[p.id] ? ' checked' : '') + '> <span>' + esc(p.name || p.id) + '</span><code>' +
            esc(p.id) + '</code></label>';
        }).join('');
    }).join('');
    /* Indeterminate is a PROPERTY, not an attribute — it cannot be set in the markup above. */
    host.querySelectorAll('input[data-ind]').forEach(function (cb) { cb.indeterminate = true; });
    var after = function () {
      var lab = document.getElementById('po-projfilter-label');
      if (lab) lab.textContent = pfLabel();
      renderProjFilterList();          // repaint so a parent's tick follows its packages
      if (pfOnChange) pfOnChange();
    };
    host.querySelectorAll('input[data-pf]').forEach(function (cb) {
      cb.onchange = function () {
        if (cb.checked) pfSel[cb.dataset.pf] = true; else delete pfSel[cb.dataset.pf];
        after();
      };
    });
    host.querySelectorAll('input[data-pf-prog]').forEach(function (cb) {
      cb.onchange = function () {
        var g = groups.filter(function (x) { return x.key === cb.dataset.pfProg; })[0];
        if (!g) return;
        g.members.forEach(function (p) { if (cb.checked) pfSel[p.id] = true; else delete pfSel[p.id]; });
        after();
      };
    });
  }
  function wireProjFilter(bar) {
    var wrap = bar.querySelector('#po-projfilter-wrap'), menu = bar.querySelector('#po-projfilter-menu');
    if (!wrap || !menu) return;
    bar.querySelector('#po-projfilter-btn').onclick = function (e) {
      e.stopPropagation();
      var open = menu.classList.toggle('open');
      if (open) { renderProjFilterList(); bar.querySelector('#po-projfilter-search').focus(); }
    };
    bar.querySelector('#po-projfilter-search').oninput = function (e) { pfQuery = e.target.value; renderProjFilterList(); };
    var relabel = function () {
      var lab = bar.querySelector('#po-projfilter-label');
      if (lab) lab.textContent = pfLabel();
      renderProjFilterList();
      if (pfOnChange) pfOnChange();
    };
    menu.querySelector('[data-act="all"]').onclick = function () {
      PROJ.forEach(function (p) { pfSel[p.id] = true; }); relabel();
    };
    /* ⚠️ "Clear" goes back to ALL projects (the `{}` default), never to none — see the note on
       `pfSel`. A cleared filter that shows an empty page is one a planner has to fight. */
    menu.querySelector('[data-act="none"]').onclick = function () { pfSel = {}; relabel(); };
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) menu.classList.remove('open'); });
  }

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
    icon: "risk",
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
      "          <div style=\"overflow-x:auto;\"><table class=\"pd-table pd-proj-table po-table\" id=\"po-rk-table\"></table></div>",
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
    icon: "clipboard",
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
      "          <div style=\"overflow-x:auto;\"><table class=\"pd-table pd-proj-table po-table\" id=\"po-is-table\"></table></div>",
      "        </div>"
    ].join('\n'),
    setup: function () {
    // ================= Portfolio Issues & Concerns (cross-project) =================
    var isRows = null, isLoadedIds = null, isQuery = '', isStatus = '';
    /* ⚠️ Per view, and NOT persisted: a group a planner collapsed to read one project must
       not still be collapsed tomorrow, hiding rows they never chose to hide. */
    var isCollapsed = {};
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
      var nameById = {}; PROJ.forEach(function (p) { nameById[p.id] = p.name || p.id; });
      /* ⚠️ The PROJECT column is gone: it repeated the group heading on every row, which is the
         whole reason the flat table read as a wall. 6 columns -> 5. */
      var head = '<thead><tr><th>Issue</th><th>Department</th><th>Champion</th><th>Status</th><th class="num">Aging</th></tr></thead>';
      var groups = groupByProject(list, function (r) { return r.project_id; }, nameById);
      var body = '';
      groups.forEach(function (g) {
        var open = !isCollapsed[g.pid];
        body += groupHeadRow(g, 5, open, 'issue');
        if (!open) return;
        /* ⚠️ Oldest first WITHIN the project — aging is this register's own measure of what has
           been sitting longest, and it is null once an issue is closed, so a closed row sorts
           last rather than pretending to be new. */
        g.rows.slice().sort(function (a, b) {
          var x = isAgingDays(a), y = isAgingDays(b);
          return (y == null ? -1 : y) - (x == null ? -1 : x);
        }).forEach(function (r) {
          var age = isAgingDays(r), st = r.status || 'Open';
          /* ⚠ `?openIssue=` — a QUERY parameter, matching the `?openLesson=` deep link this same
             module already answers, rather than a second convention beside it. The Issues screen's
             own history binding (`il_screen`) carries only which SCREEN is showing, not which issue
             is open, so there is no existing hash to aim at the way Meetings has one. */
          body += '<tr class="pd-proj-row" data-open-pid="' + esc(r.project_id) + '"' +
            ' data-open-to="?openIssue=' + encodeURIComponent(r.id) + '"' +
            ' title="Open this issue in ' + esc(nameById[r.project_id] || r.project_id) + '">' +
            '<td>' + esc(clip(r.description, 90) || '(no issue text)') + '</td>' +
            '<td>' + esc(r.department || '—') + '</td>' +
            '<td>' + esc(r.champion || '—') + '</td>' +
            '<td>' + statePill(st, st === 'Open' ? 'bad' : st === 'On Hold' ? 'warn' : 'muted') + '</td>' +
            '<td class="num">' + (age == null ? '—' : age + 'd') + '</td></tr>';
        });
      });
      if (!groups.length) body = '<tr><td colspan="5" class="po-empty">No issues match the current filter.</td></tr>';
      var t = document.getElementById('po-is-table');
      t.innerHTML = head + '<tbody>' + body + '</tbody>';
      wireGroupToggle(t, isCollapsed, isRender);
      wireRowOpen(t);
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
    icon: "calendar",
    title: "Meetings",
    needs: [],
    markup: [
      "        <div class=\"po-toolbar\">",
      "          <div class=\"po-toolbar-fields\" id=\"po-mm-fields\">",
      "            <select class=\"pd-select\" id=\"po-mm-status\" style=\"max-width:170px;\">",
      "              <option value=\"open\">Open items</option><option value=\"overdue\">Overdue only</option><option value=\"closed\">Closed</option><option value=\"\">All statuses</option>",
      "            </select>",
      "            <span class=\"po-spacer\"></span>",
      "            <div class=\"po-search\"><span data-ico=\"search\" data-ico-size=\"15\"></span><input class=\"pd-input\" id=\"po-mm-q\" placeholder=\"Search action, owner, meeting…\" /></div>",
      "          </div>",
      "        </div>",
      "        <p style=\"font-size:12px;color:var(--pd-muted);margin:0 0 12px;\" id=\"po-mm-note\"></p>",
      "        <div class=\"pd-kpis\" id=\"po-mm-kpis\"></div>",
      "        <div class=\"po-card\" style=\"padding:0;overflow:hidden;\">",
      "          <div style=\"overflow-x:auto;\"><table class=\"pd-table pd-proj-table po-table\" id=\"po-mm-table\"></table></div>",
      "        </div>"
    ].join('\n'),
    setup: function () {
    // ================= Portfolio Minutes of Meeting — open action items (cross-project) ======
    // ⚠️ Deliberately simplified: reads `mom_items.status` directly rather than resolving a
    // raised item's live status through its linked issues_lessons row, the way the Minutes of
    // Meeting module itself does. This is a cross-project WORKLIST, not the register of record —
    // the module stays authoritative for a raised action's true status.
    var mmItems = null, mmMoms = null, mmLoadedIds = null;
    /* ⚠️ Defaults to OPEN, so the view opens on exactly what it showed before this filter
       existed — a worklist. The other three states are now reachable rather than hard-coded
       out of the page. */
    var mmStatus = 'open', mmQuery = '', mmCollapsed = {};
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
    function mmIsLate(it) { return !!(it.due_date && pd(it.due_date) < today()); }
    /* ⚠️ "Overdue" is DERIVED (a due date in the past on an item that is not closed), not a
       stored status — the register has no such value. Reading it off `status` would report
       nothing, which is the silent-empty-filter fault this repo keeps recording. */
    function mmVisible() {
      var q = mmQuery.trim().toLowerCase();
      var momById = {}; (mmMoms || []).forEach(function (m) { momById[m.id] = m; });
      return (mmItems || []).filter(function (it) {
        var closed = (it.status || 'Open') === 'Closed';
        if (mmStatus === 'open' && closed) return false;
        if (mmStatus === 'closed' && !closed) return false;
        if (mmStatus === 'overdue' && (closed || !mmIsLate(it))) return false;
        if (q) {
          var m = momById[it.mom_id];
          var hay = ((it.action_item || '') + ' ' + (it.description || '') + ' ' +
                     (it.owner || '') + ' ' + ((m && m.title) || '')).toLowerCase();
          if (hay.indexOf(q) < 0) return false;
        }
        return true;
      });
    }
    function mmRender() {
      var momById = {}; (mmMoms || []).forEach(function (m) { momById[m.id] = m; });
      var list = mmVisible();
      /* ⚠️ The KPI strip counts the WHOLE portfolio, never the filtered list: a strip that moved
         with the filter would be reporting the filter rather than the portfolio. The table below
         says what is being shown. Same rule the Contracts & Claims summary band already follows. */
      var allOpen = (mmItems || []).filter(function (it) { return (it.status || 'Open') !== 'Closed'; });
      var overdue = allOpen.filter(mmIsLate);
      var draftMoms = (mmMoms || []).filter(function (m) { return !m.is_distributed; }).length;
      document.getElementById('po-mm-kpis').innerHTML =
        kpi2('Meetings recorded', String((mmMoms || []).length)) + kpi2('Draft minutes', String(draftMoms)) +
        kpi2('Open action items', String(allOpen.length)) + kpi2('Overdue', String(overdue.length), overdue.length ? '--pd-bad' : null);

      var nameById = {}; PROJ.forEach(function (p) { nameById[p.id] = p.name || p.id; });
      /* ⚠️ The PROJECT column is gone — it repeated the group heading on every row. 6 -> 5. */
      var head = '<thead><tr><th>Meeting</th><th>Action item</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>';
      var groups = groupByProject(list, function (it) { return it.project_id; }, nameById);
      var body = '';
      groups.forEach(function (g) {
        var open = !mmCollapsed[g.pid];
        body += groupHeadRow(g, 5, open, 'action item');
        if (!open) return;
        /* ⚠️ MEETING DATE, newest first — the owner's own ask. A meeting with no date sorts last
           rather than to the top, which is where an empty string would put it. Ties inside one
           meeting fall back to the due date, so the oldest commitment leads. */
        g.rows.slice().sort(function (a, b) {
          var ma = momById[a.mom_id], mb = momById[b.mom_id];
          var da = (ma && ma.meeting_date) || '', db = (mb && mb.meeting_date) || '';
          if (da !== db) return (db || '0000').localeCompare(da || '0000');
          return (a.due_date || '9999').localeCompare(b.due_date || '9999');
        }).forEach(function (it) {
          var m = momById[it.mom_id];
          var late = mmIsLate(it), closed = (it.status || 'Open') === 'Closed';
          /* ⚠ The MEETING is what opens, not the action item: Minutes of Meeting has no
             single-item screen — an action item is a row inside its meeting's detail view, which
             is where a planner reads and answers it. */
          body += '<tr class="pd-proj-row" data-open-pid="' + esc(it.project_id) + '"' +
            (it.mom_id ? ' data-open-to="' + esc(stateHash('mom_view', { t: 'meetings', v: 'detail', m: it.mom_id })) + '"' : '') +
            ' title="Open this meeting in ' + esc(nameById[it.project_id] || it.project_id) + '">' +
            '<td>' + esc((m && m.title) || '—') + (m && m.meeting_date ? ' <span style="color:var(--pd-muted);">· ' + esc(Fmt.date(m.meeting_date)) + '</span>' : '') + '</td>' +
            '<td>' + esc(clip(it.action_item || it.description, 90) || '(no action text)') + '</td>' +
            '<td>' + esc(it.owner || '—') + '</td>' +
            '<td>' + (it.due_date ? Fmt.date(it.due_date) : '—') + '</td>' +
            '<td>' + statePill(closed ? 'Closed' : late ? 'Overdue' : (it.status || 'Open'),
                               closed ? 'muted' : late ? 'bad' : 'warn') + '</td></tr>';
        });
      });
      if (!groups.length) body = '<tr><td colspan="5" class="po-empty">Nothing matches the current filter.</td></tr>';
      var t = document.getElementById('po-mm-table');
      t.innerHTML = head + '<tbody>' + body + '</tbody>';
      wireGroupToggle(t, mmCollapsed, mmRender);
      wireRowOpen(t);

      /* ⚠️ The note follows the FILTER. It used to state "Closed items are left out" as a fixed
         fact; with the filter it would have been false three settings out of four. */
      var NOTE = { open: 'Open action items, grouped by project and newest meeting first — closed items are left out.',
                   overdue: 'Open action items past their due date, grouped by project.',
                   closed: 'Closed action items, grouped by project.',
                   '': 'Every action item, grouped by project and newest meeting first.' };
      document.getElementById('po-mm-note').textContent =
        NOTE[mmStatus] + ' Showing ' + list.length + ' of ' + (mmItems || []).length + '.';
    }
      document.getElementById('po-mm-status').onchange = function (e) { mmStatus = e.target.value; mmRender(); };
      document.getElementById('po-mm-q').oninput = function (e) { mmQuery = e.target.value; mmRender(); };
      return { load: loadMeetings };
    }
  });

  /* ---- Contracts & Claims ------------------------------------------------------------ */
  def("contracts", {
    icon: "contract",
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
      "          <div style=\"overflow-x:auto;\"><table class=\"pd-table pd-proj-table po-table\" id=\"po-ct-rank\"></table></div>",
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
      "          <div style=\"overflow-x:auto;margin-top:10px;\"><table class=\"pd-table pd-proj-table po-table\" id=\"po-ct-table\"></table></div>",
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
    icon: "camera",
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
      "          <div style=\"overflow-x:auto;\"><table class=\"pd-table pd-proj-table po-table\" id=\"po-ph-table\"></table></div>",
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
        /* ==== WHEN THE FAVORITES READ FAILS =====================================================
           ⚠⚠ IT USED TO ANSWER EVERY FAILURE WITH ONE FILENAME, AND THE FILENAME COULD NOT RUN.
           The old test was `/favorite|schema cache/i` → *"run
           migrations/2026-09-07-progress-photos-favorites.sql"*, which is right for a missing
           COLUMN and wrong for a missing TABLE — that migration's first statement is
           `alter table progress_photos add column ...`, so against a database without the table it
           dies with `42P01: relation "progress_photos" does not exist`, which is exactly what the
           owner reported on 2026-09-16 after following this very message. A nudge that names a
           file which then fails is worse than no nudge: it reads as "the app is broken in two
           places" rather than "one prerequisite is missing".
           ⚠ So the two are told apart and each names the file that will actually run. 42703 /
           "column ... does not exist" is the column; 42P01 / PGRST205 / "relation ... does not
           exist" is the table, and `supabase-schema.sql` is what creates it.
           ⚠⚠ AND THE WHOLE VIEW SAYS SO, NOT JUST THE PHOTO GRID. This branch returned after
           writing into `grid` alone, leaving the KPI strip and the per-project table as blank
           elements — the "progress photos bugs out" screenshot is that: a page with one sentence
           on it and two empty boxes below, which reads as a half-loaded page rather than as one
           clear prerequisite. */
        var msg = (e && e.message) || String(e);
        var code = (e && e.code) || '';
        var noTable = code === '42P01' || code === 'PGRST205' || /relation .* does not exist|could not find the table/i.test(msg);
        var noColumn = !noTable && (code === '42703' || /favorite|column .* does not exist|schema cache/i.test(msg));
        var say = noTable
          ? 'This database has no <code>progress_photos</code> table yet. Run <code>supabase-schema.sql</code> first — it creates the table; <code>migrations/2026-09-07-progress-photos-favorites.sql</code> only adds the favorite flag to an existing one, and fails on its own with <code>42P01</code>.'
          : noColumn
            ? 'Run <code>migrations/2026-09-07-progress-photos-favorites.sql</code> to enable favorites and the portfolio-level favorites view.'
            : 'Could not load the favorited photos: ' + esc(msg);
        grid.innerHTML = '<div class="po-empty">' + say + '</div>';
        kpis.innerHTML = '';
        tbl.innerHTML = '<tbody><tr><td class="po-empty">' + say + '</td></tr></tbody>';
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
    icon: "barChart",
    title: "Productivity Rates",
    needs: [],
    markup: [
      "        <p style=\"font-size:12px;color:var(--pd-muted);margin:0 0 12px;\">Rate = output ÷ (crew or equipment × working days).</p>",
      "        <div class=\"pd-kpis\" id=\"po-pr-kpis\"></div>",
      "        <div class=\"po-card\" style=\"padding:0;overflow:hidden;\">",
      "          <div style=\"overflow-x:auto;\"><table class=\"pd-table pd-proj-table po-table\" id=\"po-pr-table\"></table></div>",
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

  /* ---- Portfolio S-Curve ---------------------------------------------------------- */
  def("scurve", {
    icon: "trendingUp",
    title: "Portfolio S-Curve",
    needs: ["PDScurve"],
    markup: [
      "<div id=\"po-sc-pane-curve\">",
      "<div class=\"pd-kpis\" id=\"po-sc-kpis\"></div>",
      "<div class=\"po-card\">",
      "  <h3 style=\"text-transform:none;font-size:15px;\">Portfolio S-Curve — Planned vs Actual (duration-weighted, across selected projects)</h3>",
      "  <div id=\"po-sc-chart\"></div>",
      "</div>",
      "<!-- What a clicked month is MADE OF. A panel under the chart, not a modal: the question",
      "     it answers is \"what is inside THAT month\", and covering the chart hides the month",
      "     being asked about. Hidden until a month is clicked. -->",
      "<div class=\"po-card po-sc-bd\" id=\"po-sc-bd\" style=\"display:none;\"></div>",
      "</div>",
      "<!-- ==== MANUAL DATA, AT PORTFOLIO LEVEL ======================================",
      "     The module's Curve | Manual data tabs exist on this page too, and the second was a",
      "     DEAD CONTROL here: that tab strip is static markup wired by the module's own init(),",
      "     which a portfolio open deliberately SKIPS \u2014 so the dropdown rendered, opened, and did",
      "     nothing at all. Owner 2026-09-16: *\"there is a manual data tab that is clickable that",
      "     doesn't work.\"*",
      "     \u26a0\u26a0 IT IS A REGISTER, NOT THE SHEET, AND IT CANNOT BE THE SHEET. The project-level tab",
      "     is an editable trades-by-months grid, and portfolio scope is READ-ONLY at the Supabase",
      "     chokepoint (auth.js refuses every write while the flag is set). A grid rendered here",
      "     would accept keystrokes and have every save refused by the network.",
      "     \u26a0 So it answers the question a PORTFOLIO can answer: which projects carry a",
      "     hand-entered curve, whether the planned one is locked, how far it runs and when it was",
      "     last touched \u2014 with a row that opens that project's own sheet to actually edit it.",
      "     =========================================================================== -->",
      "<div id=\"po-sc-pane-manual\" hidden>",
      "  <div class=\"pd-kpis\" id=\"po-scm-kpis\"></div>",
      "  <p class=\"po-note\" id=\"po-scm-note\"></p>",
      "  <div class=\"po-card\" style=\"padding:0;overflow:hidden;\">",
      "    <div style=\"overflow-x:auto;\"><table class=\"pd-table pd-proj-table po-table\" id=\"po-scm-table\"></table></div>",
      "  </div>",
      "</div>"
    ].join('\n'),
    setup: function () {
    function isWbsRow(r) { return r.activity_type === 'WBS Summary'; }
    /* ⚠️⚠️ PAGED PER PROJECT, NOT `.in('project_id', ids)` — AND THAT IS THE FIX.
       The index this read lives or dies by is `project_schedule_proj_id_idx (project_id, id)`,
       and migrations/2026-07-20-schedule-scurve-agg.sql:92 says what it is for in as many
       words: "(where project_id = ? and id > ? order by id) — an indexed range scan per page."
       ONE project. Across 21 ids there is no single range to scan, the plan degenerates, and a
       page can run past the ~8s statement_timeout — which reached the owner as a bare
       "Load failed." on every portfolio-wide open.
       ⚠️ THE `count:'exact'` PRE-READ IS GONE. It counted every activity in the selection to
          decide whether to show a warning toast, and it was the most timeout-prone statement
          on the page — paid on every load, for a toast.
       ⚠️ One project failing no longer fails the view: it is collected and NAMED, and the rest
          still draw. A partial portfolio that says which project is missing beats an empty one
          that says nothing. */
    async function fetchScheduleForIds(ids, onProgress) {
      if (!ids.length) return { rows: [], failed: [] };
      // Lean columns only — never select('*') across tens of thousands of rows.
      // ⚠⚠ `project_id` IS LOAD-BEARING and was deliberately absent once: every row arrived
      //    anonymous, which is exactly why a per-project overlay could not be drawn.
      // ⚠ The rest mirrors PDScurve.COLS so the fetch and the engine cannot drift about which
      //    columns the maths needs.
      var LEAN = 'project_id,' + (window.PDScurve ? PDScurve.COLS.join(',')
        : 'id,activity_type,start_date,end_date,duration_days,percent_complete,actual_start,actual_finish');
      var all = [], failed = [];
      for (var i = 0; i < ids.length; i++) {
        var pid = ids[i];
        if (onProgress) onProgress(i, ids.length);
        try {
          var last = null;
          while (true) {
            var q = sb().from('project_schedule').select(LEAN).eq('project_id', pid)
                      .order('id', { ascending: true }).limit(1000);
            if (last) q = q.gt('id', last);
            var r = await q; if (r.error) throw r.error;
            var b = r.data || []; all = all.concat(b);
            if (b.length < 1000) break; last = b[b.length - 1].id;
          }
        } catch (e) { failed.push({ id: pid, err: e }); }
      }
      return { rows: all, failed: failed };
    }
    // ⚠️⚠️ scCompute() USED TO BE A HAND-COPIED DUPLICATE of assets/js/scurve.js's maths and
    //    is now a thin wrapper over the shared engine. The duplicate is exactly the drift the
    //    2026-09-01 extraction into PDScurve existed to prevent, and it had already cost
    //    something real: the "Overall Progress" / "Actual to date" identity bug had to be
    //    reasoned about in THREE places instead of one. Fixing the engine now fixes this page.
    // ⚠️ PDScurve.compute() filters its own leaves (WBS Summary rows excluded), so nothing
    //    here pre-filters — a second leaf rule is a second thing to get wrong.
    function scCompute(list) {
      if (!window.PDScurve) return { empty: true };
      return PDScurve.compute(list || []);
    }

    // ---- per-project overlay --------------------------------------------------
    // Owner: "a chart s-curve showing the different s-curves of different projects …
    // however, I am thinking how this would look if there are even 2 projects with
    // different s-curves (BL, Actual, Forecast) for each project."
    // The answer the chart implements: COLOUR = project, LINE STYLE = series.
    // ⚠️⚠️ THE Y AXIS IS PER-PROJECT PERCENT, NOT A SHARED ABSOLUTE TOTAL. Duration units
    //    are not comparable across projects — a 40,000-day programme would flatten a
    //    2,000-day one into the axis and the comparison would say nothing. Every curve runs
    //    0→100% of ITS OWN total, which is what "compare the S-curves" means.
    var SC_PALETTE = ['#E5534B', '#2F86D8', '#2FA36B', '#C9A227', '#9B59B6', '#E08A3C', '#17A2A2', '#D45D8C'];
    // ⚠️ Above this many projects the chart defaults to Actual-only. N projects × 3 series is
    //    3N lines; past ~5 the overlay stops being readable. It is a DEFAULT, not a limit —
    //    the toggles below re-enable the other series, and no project is ever silently dropped.
    var SC_FULL_MAX = 5;
    var scSeriesSel = null;          // null = the user has not chosen; auto-pick by count
    var scData = null;

    function scMonthKey(m) { return m.getFullYear() * 12 + m.getMonth(); }

    // Re-index one project's cumulative series onto the shared month axis.
    // ⚠️ Before the project starts the value is 0 and after it ends it holds its last value —
    //    these are CUMULATIVE curves, so carrying forward is the truthful continuation. A gap
    //    would read as "progress went away".
    function scOnAxis(d, arr, axis, fromIdx, toIdx) {
      var by = {};
      d.months.forEach(function (m, i) { by[scMonthKey(m)] = arr[i]; });
      var out = [], carry = null;
      axis.forEach(function (k, i) {
        var inRange = (fromIdx == null || i >= fromIdx) && (toIdx == null || i <= toIdx);
        var v = by[k];
        if (v == null) v = carry;
        else carry = v;
        out.push(inRange ? v : null);
      });
      return out;
    }

    function scRenderChart() {
      var host = document.getElementById('po-sc-chart');
      if (!scData || !scData.per.length) {
        host.innerHTML = '<div class="po-empty">No dated activities found for the selected projects.</div>';
        return;
      }
      var per = scData.per;
      var sel = scSeriesSel || { bl: per.length <= SC_FULL_MAX, ac: true, fc: per.length <= SC_FULL_MAX };
      /* ⚠️ The combined roll-up comes from the server-side monthly aggregate, which carries no
         SPI-stretched forecast — only the row-derived per-project curves do. Without this the
         Forecast box would sit TICKED over a chart that draws no forecast line, which is the
         silent-nothing this page has been bitten by before. */
      var anyFc = per.some(function (p) { return !!(p.d && p.d.forecastC); });

      // shared month axis: the union across every drawn project
      var lo = Infinity, hi = -Infinity;
      per.forEach(function (p) {
        p.d.months.forEach(function (m) { var k = scMonthKey(m); if (k < lo) lo = k; if (k > hi) hi = k; });
      });
      var axis = [], labels = [];
      for (var k = lo; k <= hi; k++) { axis.push(k); labels.push(new Date(Math.floor(k / 12), k % 12, 1)); }

      /* ⚠️ padR carries the BARS' own axis, which lives outside the plot. At the old 14 its
         labels were drawn past the viewBox and simply were not there — measured in the preview,
         where "per month" rendered as "Pe". */
      var W = 1000, H = 340, padL = 40, padR = 48, padT = 14, padB = 30, n = axis.length;
      function x(i) { return padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR)); }
      function y(pct) { return padT + (1 - pct / 100) * (H - padT - padB); }

      var grid = '';
      [0, 25, 50, 75, 100].forEach(function (p) {
        var yy = y(p);
        grid += '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" class="po-grid2"/>' +
                '<text x="' + (padL - 6) + '" y="' + (yy + 3) + '" class="po-ylab2">' + p + '%</text>';
      });
      var xlab = '', step = Math.max(1, Math.ceil(n / 12));
      labels.forEach(function (mo, i) {
        if (i % step === 0) xlab += '<text x="' + x(i) + '" y="' + (H - padB + 15) + '" class="po-xlab2">' +
          mo.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) + '</text>';
      });

      // today line — same month index on the shared axis for every project
      var tnow = today();
      var tKey = tnow.getFullYear() * 12 + tnow.getMonth();
      var tIdx = axis.indexOf(tKey);
      var todayL = tIdx < 0 ? '' : '<line x1="' + x(tIdx) + '" y1="' + padT + '" x2="' + x(tIdx) + '" y2="' + (H - padB) +
        '" stroke="var(--pd-red)" stroke-width="1.2" stroke-dasharray="4 3" opacity=".7"/>';

      function poly(vals, colour, dash, width) {
        // ⚠️ Split on nulls rather than joining across them — one polyline through a gap
        //    draws a straight line over months the series does not cover.
        var runs = [], cur = [];
        vals.forEach(function (v, i) {
          if (v == null) { if (cur.length) { runs.push(cur); cur = []; } return; }
          cur.push(x(i) + ',' + y(v));
        });
        if (cur.length) runs.push(cur);
        return runs.filter(function (r) { return r.length > 1; }).map(function (r) {
          return '<polyline points="' + r.join(' ') + '" fill="none" stroke="' + colour +
            '" stroke-width="' + width + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') +
            ' stroke-linejoin="round" stroke-linecap="round"/>';
        }).join('');
      }

      /* ================================================================= THE PERIODIC BARS
         Owner 2026-09-16: *"periodic values that are in the form of a bar chart"*.
         ⚠️⚠️ THE BARS ARE THE PORTFOLIO'S, NOT ONE PROJECT'S. The lines can be N projects each on
         its own 0–100 % scale (percent of ITS OWN total, because duration units are not
         comparable across projects) — but a histogram of N different denominators stacked in one
         slot would be adding percentages of different things. So the bars are the combined
         roll-up, in points of the PORTFOLIO's total, which is one denominator and adds up.
         ⚠️ Their own right-hand axis: a month's production is a tenth the size of a cumulative
         figure, and sharing the left axis would draw every bar as a sliver on the floor. */
      var roll = scData.rollup, bars = '', perP = null, perA = null, perMax = 0;
      if (roll && !roll.empty) {
        var RT = roll.TOT || 1;
        var rollP = scOnAxis(roll, roll.plannedC.map(function (v) { return v == null ? null : v / RT * 100; }), axis, null, null);
        var rollAHi = axis.indexOf(scMonthKey(roll.months[roll.ti]));
        var rollA = scOnAxis(roll, roll.actualC.map(function (v) { return v == null ? null : v / RT * 100; }), axis, null, rollAHi < 0 ? null : rollAHi);
        perP = scPeriodic(rollP); perA = scPeriodic(rollA);
        /* ⚠️⚠️ THE DATA-DATE MONTH GETS NO ACTUAL BAR, and the reason is on file in the
           single-project module: `scComputeFromAgg` pins that month's cumulative actual to the
           project's overall percent complete, so the step into it absorbs the whole discrepancy
           between the modelled curve and reality. That is what you want a cumulative line to do
           and is NOT a month's production; drawn as a bar it is a wrong claim about one month. */
        if (rollAHi >= 0) perA[rollAHi] = null;
        [perP, perA].forEach(function (arr) { arr.forEach(function (v) { if (v != null && v > perMax) perMax = v; }); });
        if (perMax > 0) {
          /* ⚠️⚠️ THE BARS GET BARELY HALF THE HEIGHT, AND THAT IS A JUDGEMENT ABOUT READING, NOT
             SPACE. Scaled to fill the plot they are the loudest thing on it and the eye reads a
             month-by-month histogram as the headline — but this card's subject is the cumulative
             curve, and the bars answer a second question underneath it. Measured in the preview
             at 0.92 the tallest bar crossed the 100% gridline, which also made two unrelated
             scales look like one. */
          var yb = function (v) { return (H - padB) - (v / perMax) * (H - padT - padB) * 0.55; };
          var pitch = n > 1 ? (W - padL - padR) / (n - 1) : (W - padL - padR);
          var bw = Math.max(1.5, Math.min(14, pitch * 0.62)), bwA = Math.max(1, bw * 0.56);
          var bar = function (i, v, cls, wdt) {
            if (v == null || !(v > 0)) return '';
            var h = (H - padB) - yb(v);
            if (!(h > 0.4)) return '';
            return '<rect class="' + cls + '" x="' + (x(i) - wdt / 2) + '" y="' + yb(v) +
              '" width="' + wdt + '" height="' + h + '" rx="1"></rect>';
          };
          for (var bi = 0; bi < n; bi++) {
            // Planned behind and wider, actual in front and narrower — so a month under plan
            // shows the plan standing behind it rather than the two competing for the slot.
            bars += bar(bi, perP[bi], 'po-barp', bw) + bar(bi, perA[bi], 'po-bara', bwA);
          }
          [0, 0.5, 1].forEach(function (f) {
            bars += '<text x="' + (W - padR + 5) + '" y="' + (yb(perMax * f) + 3) + '" class="po-ylab3">' +
              (Math.round(perMax * f * 10) / 10) + '%</text>';
          });
          // ⚠️ Right-anchored at the very edge: left-anchored beside the numbers it ran past the
          //    viewBox and rendered as "per mont" — measured, not guessed.
          bars += '<text x="' + (W - 3) + '" y="' + (padT - 3) + '" class="po-ylab3 po-ylab3-t">per month</text>';
        }
      }
      scBars = { perP: perP, perA: perA, keys: axis.map(scKeyOf), labels: labels };

      var lines = '';
      per.forEach(function (p, pi) {
        var d = p.d, c = scColor(pi), T = d.TOT || 1;
        var pctOf = function (v) { return v == null ? null : v / T * 100; };
        if (sel.bl) lines += poly(scOnAxis(d, d.plannedC.map(pctOf), axis, null, null), c, '5 3', 1.4);
        if (sel.ac) {
          var acIdxHi = axis.indexOf(scMonthKey(d.months[d.ti]));
          lines += poly(scOnAxis(d, d.actualC.map(pctOf), axis, null, acIdxHi < 0 ? null : acIdxHi), c, '', 2.2);
        }
        if (sel.fc && d.forecastC) {
          var fcIdxLo = axis.indexOf(scMonthKey(d.months[d.ti]));
          lines += poly(scOnAxis(d, d.forecastC.map(pctOf), axis, fcIdxLo < 0 ? null : fcIdxLo, null), c, '1.5 2.5', 1.6);
        }
      });

      var projLegend = per.map(function (p, pi) {
        return '<span class="po-lg2"><span class="sw2-line" style="border-color:' + scColor(pi) +
          ';border-width:2px;"></span>' + esc(p.name) + '</span>';
      }).join('');
      var styleLegend =
        '<span class="po-lg2"><span class="sw2 sw2-barp"></span>Planned this month</span>' +
        '<span class="po-lg2"><span class="sw2 sw2-bara"></span>Actual this month</span>' +
        '<span class="po-lg2"><span class="sw2-line" style="border-color:currentColor;border-style:dashed;"></span>Baseline</span>' +
        '<span class="po-lg2"><span class="sw2-line" style="border-color:currentColor;"></span>Actual</span>' +
        '<span class="po-lg2"><span class="sw2-line" style="border-color:currentColor;border-style:dotted;"></span>Forecast</span>';
      var toggles =
        '<div class="po-sc-series"><div class="pd-seg pd-seg-multi" role="group" aria-label="Series">' +
          ['bl', 'ac', 'fc'].map(function (kk, i) {
            var lbl = ['Baseline', 'Actual', 'Forecast'][i];
            var off = (kk === 'fc' && !anyFc);
            return '<button type="button" data-sc="' + kk + '"' +
              (off ? ' disabled title="The combined portfolio roll-up carries no forecast — it is a monthly aggregate with no SPI stretch in it."' : '') +
              (sel[kk] && !off ? ' class="on"' : '') + '>' + lbl + '</button>';
          }).join('') +
        '</div></div>';
      // ⚠️ When the default has quietly dropped two series, SAY SO. A chart that silently
      //    shows a third of what was asked for reads as missing data.
      /* ⚠️ A chart showing ONE line across 21 projects must say that is what it is. The
         roll-up is the honest portfolio curve; per-project curves are a different question
         and are read from rows, which is why they are offered only at a scope small enough
         to read them. Neither case silently drops a project. */
      var note = scData.rollupOnly
        ? '<div class="po-sc-note">One <b>combined</b> curve across <b>' + (scData.nProjects || per.length) +
          '</b> projects, computed on the database rather than read row by row. ' +
          'Open one project from the selector above for its own curve, or click any month for the ' +
          '<b>breakdown</b> of what went into it.</div>'
        : (!scSeriesSel && per.length > SC_FULL_MAX)
        ? '<div class="po-sc-note">Showing <b>Actual</b> only — ' + per.length +
          ' projects × 3 series is too many lines to read. Turn Baseline or Forecast back on to add them.</div>'
        : '';

      /* ⚠️⚠️ A PARTIAL CURVE MUST SAY IT IS PARTIAL, ON THE CHART. A portfolio curve missing
         three projects is not the portfolio's curve, and a toast is gone in five seconds while
         a screenshot of this card ends up in a report. */
      var short = (scData && scData.failedNames && scData.failedNames.length)
        ? '<div class="po-sc-note">Drawn over <b>' + scData.nRead + ' of ' + scData.nProjects +
          '</b> projects — ' + esc(scNameList(scData.failedNames)) + ' could not be read. This is ' +
          'not the whole portfolio.</div>'
        : '';
      /* ⚠️⚠️ ONE INVISIBLE BAND PER MONTH, FULL HEIGHT — not a hit target on the bar itself. A
         month whose bar is 2px tall (or absent) is exactly the month a planner most wants to ask
         about, and a 2px target cannot be hit. The band is the whole column. */
      var bands = '';
      var bwHit = n > 1 ? (W - padL - padR) / (n - 1) : (W - padL - padR);
      for (var hi2 = 0; hi2 < n; hi2++) {
        bands += '<rect class="po-sc-band' + (scBdOpen === hi2 ? ' on' : '') + '" data-mi="' + hi2 +
          '" x="' + (x(hi2) - bwHit / 2) + '" y="' + padT + '" width="' + bwHit +
          '" height="' + (H - padT - padB) + '"><title>' +
          esc(labels[hi2].toLocaleDateString('en-US', { month: 'long', year: 'numeric' })) +
          ' — click for the breakdown</title></rect>';
      }
      host.innerHTML =
        '<svg viewBox="0 0 ' + W + ' ' + H + '" class="po-svg po-svg-click">' + grid + bars + todayL +
          lines + xlab + bands + '</svg>' +
        toggles + short + note +
        '<div class="po-legend2">' + styleLegend + '</div>' +
        '<div class="po-legend2 po-legend-proj">' + projLegend + '</div>';

      /* ⚠️ A disabled rung fires no click, so Forecast cannot be turned on when nothing
         drawn carries one — the refusal is the control's own, not a guard bolted beside it. */
      host.querySelectorAll('button[data-sc]').forEach(function (b) {
        b.onclick = function () {
          scSeriesSel = scSeriesSel || { bl: sel.bl, ac: sel.ac, fc: sel.fc };
          scSeriesSel[b.dataset.sc] = !b.classList.contains('on');
          scRenderChart();
        };
      });
      Array.prototype.forEach.call(host.querySelectorAll('.po-sc-band'), function (b) {
        b.onclick = function () { scOpenBd(+b.dataset.mi); };
      });
    }

    function scColor(i) { return SC_PALETTE[i % SC_PALETTE.length]; }
    /* ==========================================================================================
       ⚠️⚠️ ONE AGGREGATE CALL PER PROJECT, NOT ONE CALL FOR ALL OF THEM — AND THAT IS THE FIX.
       `schedule_scurve_agg_multi(p_ids)` timed out in production on 2026-09-16 the first time a
       planner opened this view (57014, ~8s statement_timeout, 21 projects). The reason is in the
       SQL and it is combinatorial, not incidental: the function CROSS JOINs its month series
       against its leaf activities, and with N projects the month series spans the UNION of every
       project's dates while the leaf set is every project's activities. One project is ~60 months
       x ~16k leaves; twenty-one is ~100 months x ~300k leaves — thirty million rows to build a
       chart of a hundred points.
       ⚠️ `schedule_scurve_agg(p_id)` is the SAME function with one id, and it is the shape the
       index exists for — it is what the single-project S-Curve module has always called. So the
       portfolio curve is N of those, summed here. Identical arithmetic: every field the merge
       touches is a plain SUM over leaves server-side, so summing per-project sums gives exactly
       what the combined call would have returned.
       ⚠️ AND ONE PROJECT FAILING NO LONGER FAILS THE VIEW. It is collected and NAMED and the
       other twenty still draw — where the single call was all-or-nothing, and what it returned
       was nothing.
       ⚠️ A migration could also fix this server-side, but a migration is run by hand in the
       Supabase SQL editor and this view is broken until it is. The client fix works on the
       database as deployed. ========================================================== */
    var SC_AGG_CONC = 4;   // four in flight: enough to hide latency, not enough to queue on the db
        /* ⚠️ MOVED to assets/js/scurve.js on 2026-09-16 so the Portfolio Overview draws the same
       curve from the same code. The local names stay, so every call site in this closure is
       untouched — the same shape the attach.js extraction used. */
    async function fetchAggForIds(ids, onProgress) {
      return PDScurve.fanOutAgg(function (id) { return sb().rpc('schedule_scurve_agg', { p_id: id }); },
                                ids, { onProgress: onProgress });
    }

    /* Sum N per-project aggregates into the one the combined call used to return.
       ⚠️⚠️ THE CARRY-FORWARD IS THE WHOLE CORRECTNESS OF THIS FUNCTION. Each project's month
       series spans only ITS OWN dates, and these are CUMULATIVE figures — so a month after a
       project finishes is absent from its series while its true contribution is its full total.
       Treating absent as zero would make the portfolio curve DIP every time a project completed,
       which is the one thing an S-curve may never do. Before a project starts, absent IS zero,
       and the carry starts there. Same rule `scOnAxis` applies to the drawn overlay. */
    /* ⚠️ Capped. Twenty-one names in a toast is a wall nobody reads; three and a count is a
       sentence. The full list is in scData.failed for anything that needs it. */
    function scNameList(names) {
      return names.length <= 3 ? names.join(', ')
        : names.slice(0, 3).join(', ') + ' and ' + (names.length - 3) + ' more';
    }
    function scNames(failed, nameOf) {
      return scNameList(failed.map(function (f) { return nameOf[f.id] || f.id; }));
    }

    /* =========================================================================================
       PERIODIC VALUES — owner 2026-09-16: *"periodic values that are in the form of a bar chart"*.
       ⚠️⚠️ DERIVED, NEVER RE-SUMMED. Month n = cumulative n − cumulative n−1, off the same arrays
       the curve is drawn from. Two consequences worth stating: the bars ALWAYS add back up to the
       line (they cannot drift from it, because they ARE it), and there is no second pass over the
       schedule to keep in step with the first. Same rule the single-project S-Curve applies.
       ⚠️ `null` stays null. A month a series does not cover is not a month of zero production, and
       an absent bar and a zero-height bar mean different things. ======================= */
    function scPeriodic(cum) {
      var out = [], prev = null;
      for (var i = 0; i < cum.length; i++) {
        var v = cum[i];
        if (v == null) { out.push(null); continue; }
        out.push(Math.max(0, v - (prev == null ? 0 : prev)));
        prev = v;
      }
      return out;
    }

    /* One month-key axis shared by the chart and by every breakdown drawn under it. */
    function scKeyOf(k) { return Math.floor(k / 12) + '-' + String((k % 12) + 1).padStart(2, '0'); }

    /* ⚠️⚠️ THE ONE CARRY-FORWARD RULE, and it is shared on purpose. `scMergeAggs` and every
       breakdown below put a per-entity month series onto a shared axis, and they must all read an
       absent month the same way: BEFORE the entity starts it is genuinely 0; AFTER it finishes its
       cumulative figure HOLDS. Two copies of this is how one of them starts dipping. */
    function scCarry(months, axisKeys) { return PDScurve.carry(months, axisKeys); }

    /* ============================== the per-TRADE source, fetched only if it is asked for ====
       Owner 2026-09-16: *"click a specific month to know the breakdowns (for example per trade…)"*
       ⚠️⚠️ THE MONTHLY ROLL-UP CARRIES NO TRADE — it never has (see scComputeFromAgg). The only
       client-side way to split a month by trade is the raw activities, which across twenty-one
       projects is a third of a million rows: precisely the read the server-side aggregate exists
       to avoid. So there is a second aggregate that groups by trade,
       `migrations/2026-09-16-scurve-trade-agg.sql`, fanned out per project exactly as the curve is.
       ⚠️ LAZY, AND CACHED. A planner who never opens a breakdown never pays for it; one who opens
       three pays once. ⚠️ Not deployed is a NAMED state, not an error: the panel says which
       migration to run and the by-project breakdown — which needs nothing — still answers. */
    var scTrade = null;           // null | 'loading' | 'missing' | { entries: [...] }
    var scTradeErr = null;
    async function fetchTradeAggForIds(ids) {
      var got = [], missing = false, err = null, queue = ids.slice();
      /* ⚠️⚠️ ONE PROBE FIRST, THEN FAN OUT. A function that is not deployed answers PGRST202 for
         EVERY project, so firing twenty-one calls to learn one deployment fact is twenty wasted
         round trips — and on a slow link twenty seconds before the panel can say the one useful
         sentence it has. The probe is a real read, so nothing is paid twice. */
      if (queue.length) {
        var first = queue.shift();
        try {
          var r0 = await sb().rpc('schedule_scurve_trade_agg', { p_id: first });
          if (r0.error) throw r0.error;
          if (r0.data && r0.data.trades) got.push(r0.data);
        } catch (e0) {
          if (String((e0 && e0.code) || '') === 'PGRST202' || /Could not find the function/i.test(String(e0 && e0.message))) {
            return { aggs: [], missing: true, err: null };
          }
          err = e0;
        }
      }
      async function worker() {
        while (queue.length) {
          var id = queue.shift();
          try {
            var r = await sb().rpc('schedule_scurve_trade_agg', { p_id: id });
            if (r.error) throw r.error;
            if (r.data && r.data.trades) got.push(r.data);
          } catch (e) {
            /* ⚠️ A function that is not deployed answers PGRST202 for EVERY project, so one
               such answer settles it — there is no point asking twenty more times. */
            if (String((e && e.code) || '') === 'PGRST202' || /Could not find the function/i.test(String(e && e.message))) {
              missing = true; queue.length = 0; return;
            }
            if (!err) err = e;
          }
        }
      }
      var ws = [];
      for (var i = 0; i < Math.min(SC_AGG_CONC, ids.length); i++) ws.push(worker());
      await Promise.all(ws);
      return { aggs: got, missing: missing, err: err };
    }

    /* Sum N projects' per-trade splits into one list of trades. ⚠️ Through scCarry, like every
       other merge here: a trade present on one project and not another must hold, not dip. */
    function scMergeTrades(aggs, axisKeys) {
      var byTrade = {};
      aggs.forEach(function (a) {
        (a.trades || []).forEach(function (t) {
          var e = byTrade[t.trade] || (byTrade[t.trade] = {
            name: t.trade, totDur: 0, doneDur: 0, nAct: 0,
            pd: axisKeys.map(function () { return 0; }), ad: axisKeys.map(function () { return 0; })
          });
          e.totDur += +t.totDur || 0; e.doneDur += +t.doneDur || 0; e.nAct += +t.nAct || 0;
          var c = scCarry(t.months, axisKeys);
          for (var i = 0; i < axisKeys.length; i++) { e.pd[i] += c.pd[i]; e.ad[i] += c.ad[i]; }
        });
      });
      return Object.keys(byTrade).map(function (k) { return byTrade[k]; })
        .sort(function (a, b) { return b.totDur - a.totDur; });
    }

    function scMergeAggs(list) { return PDScurve.mergeAggs(list); }

    // Same shape as scCompute(), but from the server-side combined aggregate (one JSON of
    // ~monthly buckets) instead of every raw activity row across the scoped projects.
    function scComputeFromAgg(a) { return PDScurve.computeFromAgg(a); }


    /* =========================================================================================
       WHAT A CLICKED MONTH IS MADE OF
       Owner 2026-09-16: *"allow users to click a specific month to know the breakdowns (for
       example per trade, but if not applicable put others)"*.

       ⚠️⚠️ TWO COLUMNS THAT ARE ROUTINELY CONFUSED, AND THE HEADER SAYS SO. **This month** is
       points of the PORTFOLIO's percentage — it sums to the portfolio's own figure for that
       month, which is the check. **Own %** is how far along that project or trade is in its own
       scope. A trade at 100 % of itself on a portfolio where it is 4 % of the work contributes 4
       points, not 100, and a reader given only the second number would read a finished portfolio.

       ⚠️ TWO DIMENSIONS, ONE RENDERER. By project needs nothing (the per-project aggregates are
       already in hand from the curve's own fan-out); by trade needs the second aggregate. Both
       reduce to {name, totDur, pd[], ad[]} on the shared axis, so there is one table and one set
       of sums rather than two that can disagree.
       ========================================================================================= */
    var scBdOpen = null;          // the month index currently expanded, or null
    var scBdDim = 'trade';        // 'trade' | 'project' — the owner asked for trade first
    var scBars = null;            // the periodic arrays the chart last drew, shared with the panel

    function scCloseBd() {
      scBdOpen = null;
      var el = document.getElementById('po-sc-bd');
      if (el) { el.style.display = 'none'; el.innerHTML = ''; }
      scRenderChart();
    }

    function scOpenBd(i) {
      // ⚠️ Clicking the open month CLOSES it — the band is the toggle, so there is no second
      //    control to find and nothing left open that the planner did not ask for.
      if (scBdOpen === i) { scCloseBd(); return; }
      scBdOpen = i;
      scRenderChart();
      scRenderBd();
      if (scBdDim === 'trade') scEnsureTrade();
    }

    /* Fetch the trade split once, then repaint whatever is open. */
    function scEnsureTrade() {
      if (scTrade && scTrade !== 'loading') return;
      if (scTrade === 'loading') return;
      scTrade = 'loading';
      var ids = (scLoadedIds || []).slice();
      fetchTradeAggForIds(ids).then(function (r) {
        scTrade = r.missing ? 'missing' : { aggs: r.aggs };
        scTradeErr = r.err || null;
        if (scBdOpen != null) scRenderBd();
      }).catch(function (e) {
        scTrade = 'missing'; scTradeErr = e;
        if (scBdOpen != null) scRenderBd();
      });
    }

    /* The by-PROJECT rows, straight off the aggregates the curve already fetched. */
    function scBdProjects(axisKeys) {
      var nameOf = {};
      PROJ.forEach(function (p) { nameOf[p.id] = p.name || p.id; });
      return scAggs.map(function (a) {
        var c = scCarry(a.agg.months, axisKeys);
        return { name: nameOf[a.id] || a.id, totDur: +a.agg.totDur || 0,
                 doneDur: +a.agg.doneDur || 0, nAct: +a.agg.nAct || 0, pd: c.pd, ad: c.ad };
      }).sort(function (x2, y2) { return y2.totDur - x2.totDur; });
    }

    /* ⚠️ The header is built in ONE place because three branches render it — the trade table, the
       project table and the not-deployed fallback. Three copies of a header carrying the figure
       every column below it has to add up to is three chances for one of them to say something
       different from the other two. */
    function scRenderBdHead(when, monthP, monthA, r1) {
      return '<div class="po-bd-head"><h3>' + esc(when) + ' — by ' +
          (scBdDim === 'trade' ? 'trade' : 'project') + '</h3>' +
        '<span class="po-bd-sum">portfolio this month: planned <b>' + (r1(monthP) == null ? '—' : r1(monthP) + '%') +
          '</b> · actual <b>' + (r1(monthA) == null ? '—' : r1(monthA) + '%') + '</b></span>' +
        '<div class="pd-seg" id="po-bd-dim" role="group" aria-label="Breakdown">' +
          '<button type="button" data-dim="trade"' + (scBdDim === 'trade' ? ' class="on"' : '') + '>By trade</button>' +
          '<button type="button" data-dim="project"' + (scBdDim === 'project' ? ' class="on"' : '') + '>By project</button>' +
        '</div>' +
        '<button class="pd-btn pd-btn-sm" id="po-bd-x">Close</button></div>';
    }
    function scTradeMissingMsg() {
      return 'Showing <b>by project</b>: the per-trade split needs ' +
        '<code>migrations/2026-09-16-scurve-trade-agg.sql</code>, which is not deployed on this ' +
        'database yet. Run it in the Supabase SQL editor and <b>By trade</b> will answer too.' +
        (scTradeErr ? ' (' + esc(PDb.errText(scTradeErr)) + ')' : '');
    }

    function scRenderBd() {
      var card = document.getElementById('po-sc-bd');
      if (!card || scBdOpen == null || !scBars) return;
      var i = scBdOpen, axisKeys = scBars.keys;
      if (i < 0 || i >= axisKeys.length) { scCloseBd(); return; }
      card.style.display = '';
      var when = scBars.labels[i].toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      var monthP = scBars.perP ? scBars.perP[i] : null;
      var monthA = scBars.perA ? scBars.perA[i] : null;
      var r1 = function (v) { return v == null ? null : Math.round(v * 10) / 10; };

      var head = scRenderBdHead(when, monthP, monthA, r1);

      function wire() {
        Array.prototype.forEach.call(card.querySelectorAll('#po-bd-dim button'), function (b) {
          b.onclick = function () {
            scBdDim = b.dataset.dim;
            scRenderBd();
            if (scBdDim === 'trade') scEnsureTrade();
          };
        });
        var x2 = document.getElementById('po-bd-x');
        if (x2) x2.onclick = scCloseBd;
        if (window.Icons && Icons.hydrate) Icons.hydrate(card);
      }

      /* ⚠️ The trade split is a NAMED state machine, not a truthy check: 'loading' and 'not
         deployed' read completely differently to a planner and an unguarded `if (!scTrade)`
         would print the same thing for both. */
      if (scBdDim === 'trade' && scTrade !== null && typeof scTrade === 'object') {
        var rows = scMergeTrades(scTrade.aggs || [], axisKeys);
        card.innerHTML = head + scBdTable(rows, i, monthP, monthA, 'Trade');
        wire(); return;
      }
      /* ⚠️⚠️ A PANEL THAT ANSWERS NOTHING IS A BROKEN PANEL. If the trade split is not deployed,
         fall THROUGH to the breakdown that needs nothing rather than leaving a planner holding a
         sentence about SQL. The toggle flips with it, so the control and the content agree —
         showing projects under a lit "By trade" button would be its own small lie. */
      if (scBdDim === 'trade' && scTrade === 'missing') {
        scBdDim = 'project';
        card.innerHTML = scRenderBdHead(when, monthP, monthA, r1) +
          '<div class="po-bd-note">' + scTradeMissingMsg() + '</div>' +
          scBdTable(scBdProjects(axisKeys), i, monthP, monthA, 'Project');
        wire(); return;
      }
      if (scBdDim === 'trade') {
        // Only 'loading' reaches here — 'missing' fell through to the project table above.
        card.innerHTML = head + '<div class="po-bd-note">Reading the trade split of ' +
          (scLoadedIds || []).length + ' project(s)…</div>';
        wire(); return;
      }
      card.innerHTML = head + scBdTable(scBdProjects(axisKeys), i, monthP, monthA, 'Project');
      wire();
    }

    /* ⚠️ ONE TABLE FOR BOTH DIMENSIONS. Whatever is being split, the questions are the same four,
       and a second near-identical renderer is how two views of one month start disagreeing. */
    function scBdTable(rows, i, monthP, monthA, what) {
      /* ⚠️⚠️ THE PANEL CHECKS ITSELF, OUT LOUD. "This month" is points of the portfolio, so the
         column MUST sum to the figure in the header — that is the whole claim the table makes.
         The by-trade rows come from a DIFFERENT aggregate than the curve (two RPCs over the same
         rows), so "they agree" is an assumption about two pieces of SQL, not a fact of one. If
         they ever drift — a leaf rule edited on one side, a trade re-tagged between the two reads
         — the honest thing is to SAY the total does not reconcile, not to print two numbers that
         contradict each other and leave the reader to pick one. Caught in the preview, where a
         header of 10.4% sat above a total of 17.1% and nothing on screen remarked on it. */
      var TOT = rows.reduce(function (t, r) { return t + (r.totDur || 0); }, 0);
      if (!rows.length || !(TOT > 0)) {
        return '<div class="po-bd-note">Nothing to break down for this month.</div>';
      }
      var out = rows.map(function (r) {
        var prevP = i > 0 ? r.pd[i - 1] : 0, prevA = i > 0 ? r.ad[i - 1] : 0;
        return {
          name: r.name,
          share: r.totDur / TOT * 100,
          // points of the PORTFOLIO — the denominator is the whole, which is what makes these sum
          ptsP: Math.max(0, (r.pd[i] - prevP)) / TOT * 100,
          ptsA: Math.max(0, (r.ad[i] - prevA)) / TOT * 100,
          ownP: r.totDur ? r.pd[i] / r.totDur * 100 : null,
          ownA: r.totDur ? r.ad[i] / r.totDur * 100 : null,
          nAct: r.nAct || 0
        };
      }).sort(function (a, b) { return (b.ptsP + b.ptsA) - (a.ptsP + a.ptsA); });
      var r1 = function (v) { return v == null ? '—' : (Math.round(v * 10) / 10) + '%'; };
      var sumP = out.reduce(function (t, r) { return t + r.ptsP; }, 0);
      var sumA = out.reduce(function (t, r) { return t + r.ptsA; }, 0);
      // 0.05 pp — below a tenth of a point nothing on screen can differ, so that is rounding.
      var drift = (monthP != null && Math.abs(sumP - monthP) > 0.05) ||
                  (monthA != null && Math.abs(sumA - monthA) > 0.05);
      var body = out.map(function (r) {
        var zero = !(r.ptsP > 0.05 || r.ptsA > 0.05);
        return '<tr' + (zero ? ' class="po-bd-quiet"' : '') + '><td class="k">' + esc(r.name) +
          '<small>' + (Math.round(r.share * 10) / 10) + '% of the portfolio' +
          (r.nAct ? ' · ' + r.nAct + ' activit' + (r.nAct === 1 ? 'y' : 'ies') : '') + '</small></td>' +
          '<td class="num">' + r1(r.ptsP) + '</td>' +
          '<td class="num is-act">' + r1(r.ptsA) + '</td>' +
          '<td class="num">' + r1(r.ownP) + '</td>' +
          '<td class="num is-act">' + r1(r.ownA) + '</td></tr>';
      }).join('');
      return '<div style="overflow-x:auto;"><table class="pd-table pd-proj-table po-table po-bd-table">' +
        '<thead><tr><th>' + esc(what) + '</th>' +
          '<th class="num" title="Points of the PORTFOLIO&#39;s percentage this ' + esc(what.toLowerCase()) +
            ' added in this month — these sum to the portfolio figure above">This month planned</th>' +
          '<th class="num" title="Same, for work actually done">This month actual</th>' +
          '<th class="num" title="How far along it is in its OWN scope, cumulative to this month">Own % planned</th>' +
          '<th class="num" title="Same, actual">Own % actual</th></tr></thead>' +
        '<tbody>' + body + '</tbody>' +
        '<tfoot><tr><td class="k">Total</td><td class="num">' + r1(sumP) + '</td>' +
          '<td class="num is-act">' + r1(sumA) + '</td><td class="num">—</td><td class="num">—</td></tr></tfoot>' +
        '</table></div>' +
        (drift
          ? '<div class="po-bd-warn">\u26A0 This breakdown sums to <b>' + (Math.round(sumP * 10) / 10) +
            '%</b> planned, against the <b>' + (Math.round(monthP * 10) / 10) + '%</b> the chart drew for ' +
            'the same month — it does not reconcile. Read it as a shape, not as figures: the split and ' +
            'the curve come from two different aggregates and one of them is out of step.</div>'
          : '') +
        '<div class="po-bd-note"><b>This month</b> is points of the portfolio\'s own percentage — the ' +
        'column adds up to the portfolio figure in the header, which is the check. <b>Own %</b> is how ' +
        'far along that ' + esc(what.toLowerCase()) + ' is in its own scope: one at 100% of itself that ' +
        'is 4% of the portfolio contributes 4 points, not 100.</div>';
    }

    function scRenderKpis(d) {
      var host = document.getElementById('po-sc-kpis');
      if (d.empty) { host.innerHTML = ''; return; }
      var r1 = function (x) { return Math.round(x * 10) / 10; };
      var v = r1(d.variance);
      host.innerHTML = kpi2('Activities', String(d.activities)) + kpi2('Overall Progress', r1(d.overallPct) + '%') +
        kpi2('Planned to date', r1(d.plannedPct) + '%') + kpi2('Actual to date', r1(d.actualPct) + '%') +
        kpi2('Schedule Variance', (v > 0 ? '+' : '') + v + ' pp', v >= 0 ? '--pd-ok' : '--pd-bad');
    }
    var scLoadedIds = null, scAggs = [];
    /* ⚠️ A monotonic load token. Two overlapping loads used to BOTH paint, and whichever
       finished LAST committed scData / scLoadedIds — which is how a superseded 21-project
       load left its "Loading schedules across 21 project(s)…" on screen while the filter
       button already read "2 projects". Same device as contracts-claims and notebook.js. */
    var _scGen = 0;

    async function loadScurve(force) {
      var ids = scopedProjectIds();
      if (!force && scLoadedIds && scLoadedIds.join(',') === ids.join(',')) return;
      var gen = ++_scGen;
      var kpiHost = document.getElementById('po-sc-kpis'), chartHost = document.getElementById('po-sc-chart');
      if (!ids.length) {
        kpiHost.innerHTML = '';
        chartHost.innerHTML = '<div class="po-empty">No projects match the current filter.</div>';
        scData = null; scLoadedIds = ids; return;
      }
      kpiHost.innerHTML = '';
      chartHost.innerHTML = '<div class="po-empty">Reading the roll-up of ' + ids.length + ' project(s)…</div>';

      var nameOf = {};
      PROJ.forEach(function (p) { nameOf[p.id] = p.name || p.id; });

      /* ⚠️⚠️ THE ROLL-UP IS THE DEFAULT RENDER, AND IT IS N SMALL SERVER-SIDE CALLS — see
         fetchAggForIds for why the one big call had to go. This view never fetches raw activity
         rows for the combined curve: ~100k rows over 21 projects, to draw a chart that above
         SC_FULL_MAX falls back to Actual-only anyway. */
      var roll = null, rollErr = null, aggFailed = [];
      try {
        var ra = await fetchAggForIds(ids, function (d, n) {
          if (gen !== _scGen) return;
          chartHost.innerHTML = '<div class="po-empty">Reading project ' + d + ' of ' + n + '…</div>';
        });
        if (gen !== _scGen) return;                       // superseded — do not paint
        aggFailed = ra.failed || [];
        /* ⚠️ KEPT, not discarded after the merge: the by-project breakdown of any month is
           already sitting in these, so it costs no second read. */
        scAggs = ra.aggs || [];
        scTrade = null; scTradeErr = null;     // a new scope invalidates the trade split
        var merged = scMergeAggs(scAggs);
        if (merged) roll = scComputeFromAgg(merged);
        /* ⚠️ Only an EMPTY result is an error. A partial one draws, and says so below — a curve
           over eighteen of twenty-one projects beats an error message over all of them. */
        if ((!roll || roll.empty) && aggFailed.length) rollErr = aggFailed[0].err;
      } catch (e) { if (gen !== _scGen) return; rollErr = e; }
      if (gen !== _scGen) return;

      /* Per-project curves only where they can be read. ⚠️ A DEFAULT, NOT A LIMIT — and no
         project is ever silently dropped: the note under the chart says the combined curve is
         what is drawn and how to get the per-project ones. */
      var wantPer = ids.length <= SC_FULL_MAX;
      var per = [], failed = aggFailed.slice();
      if (wantPer) {
        chartHost.innerHTML = '<div class="po-empty">Reading ' + ids.length + ' project schedule(s)…</div>';
        var res;
        try {
          res = await fetchScheduleForIds(ids, function (i, n) {
            if (gen !== _scGen) return;
            chartHost.innerHTML = '<div class="po-empty">Reading project ' + (i + 1) + ' of ' + n + '…</div>';
          });
        } catch (e) { if (gen !== _scGen) return; res = { rows: [], failed: [{ id: '(all)', err: e }] }; }
        if (gen !== _scGen) return;
        /* ⚠️ Merged, not replaced: a project can fail the aggregate AND the row read, and it must
           be named once, not lost because the second list overwrote the first. */
        (res.failed || []).forEach(function (f) {
          if (!failed.some(function (x) { return x.id === f.id; })) failed.push(f);
        });
        var byP = {};
        (res.rows || []).forEach(function (x) { (byP[x.project_id] = byP[x.project_id] || []).push(x); });
        per = ids.map(function (id) { return { id: id, name: nameOf[id] || id, d: scCompute(byP[id] || []) }; })
                 .filter(function (p) { return p.d && !p.d.empty; });
        if (!roll || roll.empty) { var merged = scCompute(res.rows || []); if (!merged.empty) roll = merged; }
      }

      if (gen !== _scGen) return;

      /* ⚠️ THE COMBINED CURVE IS FED IN AS A SINGLE SERIES rather than given a second
         renderer — scRenderChart already draws N named series, and one of them being "the
         portfolio" costs nothing. A parallel renderer is how two pictures of one dataset
         start disagreeing, which this page has already paid for once with scCompute. */
      var rollupOnly = !per.length;
      if (rollupOnly && roll && !roll.empty) {
        per = [{ id: '__portfolio__', name: 'Portfolio — ' + ids.length + ' project' + (ids.length === 1 ? '' : 's'), d: roll }];
      }

      if (roll && !roll.empty) scRenderKpis(roll);
      else kpiHost.innerHTML = '';

      scData = { rollup: roll, per: per, rollupOnly: rollupOnly, nProjects: ids.length,
                 nRead: ids.length - failed.length, failed: failed,
                 failedNames: failed.map(function (f) { return nameOf[f.id] || f.id; }) };
      scLoadedIds = ids;
      // ⚠️ A new scope means a new axis; a month index from the old one points at a different
      //    month, or at none. Close rather than repaint something nobody asked to see.
      scBdOpen = null;
      var _bd = document.getElementById('po-sc-bd');
      if (_bd) { _bd.style.display = 'none'; _bd.innerHTML = ''; }

      if (!per.length) {
        /* ⚠️ NAMES THE PROJECTS, not just a count. Reading one project at a time is what makes
           that possible, and it is the difference between "the S-curve failed" and "these two
           schedules are the ones to look at". */
        var why = failed.length
          ? failed.length + ' of ' + ids.length + ' project(s) could not be read (' +
            scNames(failed, nameOf) + ') — ' + PDb.errText(failed[0].err)
          : (rollErr ? PDb.errText(rollErr) : 'no project in scope has any dated activity');
        chartHost.innerHTML = '<div class="po-empty">Could not draw the portfolio S-curve: ' + esc(why) + '</div>';
        if (rollErr || failed.length) UI.toast('S-curve: ' + why, 'error');
        return;
      }
      scRenderChart();
      // ⚠️ Reported even when the chart drew: a curve missing two projects is not the
      //    portfolio's curve, and nothing else on screen would say so.
      if (failed.length) {
        UI.toast(failed.length + ' of ' + ids.length + ' project(s) could not be read (' +
          scNames(failed, nameOf) + ') — ' + PDb.errText(failed[0].err), 'warn');
      }
    }
      /* ⚠️ Test seam, same contract as `_setProjects`: the merged curve read back rather than
         reached for inside the closure, so the carry-forward can be asserted on numbers instead
         of on the shape of an SVG path. */
    /* ==== MANUAL DATA — the cross-project register ===========================================
       ⚠️ ONE READ OF EACH TABLE, and only when the tab is first opened. A planner who never
       leaves the Curve tab pays nothing for this, and the 18-project schedule roll-up the Curve
       tab is already paying for is quite enough on one page load.
       ⚠️ Tolerant of the pre-migration state (`migrations/2026-09-10-scurve-manual-poc.sql` not
       yet run), the same way the Equipment and Photos views are: a missing table degrades to a
       named "run this migration" nudge rather than a raw PostgREST error. The module's own tab
       does exactly this for the same two tables — `isMissingTable` there, this test here. */
    var scmRows = null, scmMeta = null, scmLoadedIds = null, scmMissing = false;
    function scmIsMissing(e) {
      var m = ((e && (e.message || e.code)) || '') + '';
      return /does not exist|schema cache|42P01|PGRST205/i.test(m);
    }
    async function loadManual(force) {
      var ids = scopedProjectIds();
      if (!force && scmLoadedIds && scmLoadedIds.join(',') === ids.join(',')) return;
      var tbl = document.getElementById('po-scm-table');
      var kpis = document.getElementById('po-scm-kpis');
      var note = document.getElementById('po-scm-note');
      if (!tbl) return;
      if (!ids.length) { kpis.innerHTML = ''; tbl.innerHTML = ''; note.textContent = ''; return; }
      kpis.innerHTML = '';
      tbl.innerHTML = '<tbody><tr><td class="po-empty">Reading the manual curves of ' + ids.length + ' project(s)\u2026</td></tr></tbody>';
      try {
        var res = await Promise.all([
          PDb.selectAll('scurve_manual', function (q) { return q.in('project_id', ids); }),
          /* ⚠⚠ `'project_id'` IS THE CURSOR, AND LEAVING IT OFF WOULD HAVE BROKEN EVERY READ.
             `scurve_manual_meta` is keyed `project_id text primary key` — it has NO `id` column,
             and `PDb.selectAll` pages on `id` unless told otherwise, so the default would return
             `400 / 42703 column scurve_manual_meta.id does not exist` on EVERY load of this tab.
             ⚠ Caught by `node tools/selectall-key.js` before this shipped, which is the whole
             reason that checker exists: this exact shape has shipped four times (`class_codes`,
             `trade_map` and two vendor views that had never loaded on any project), and it
             surfaces to a planner as an empty screen blaming a migration they have already run.
             ⚠ `project_id` is legal as a cursor where `sort_order`/`period` are not: a keyset
             cursor must be UNIQUE and NON-NULL, and this is the primary key. */
          PDb.selectAll('scurve_manual_meta', function (q) { return q.in('project_id', ids); }, null, 'project_id')
        ]);
        scmRows = res[0] || []; scmMeta = res[1] || []; scmMissing = false;
      } catch (e) {
        scmMissing = scmIsMissing(e);
        note.textContent = '';
        tbl.innerHTML = '<tbody><tr><td class="po-empty">' + (scmMissing
          ? 'Run <code>migrations/2026-09-10-scurve-manual-poc.sql</code> to enable hand-entered S-curves.'
          : esc((e && e.message) || String(e))) + '</td></tr></tbody>';
        return;
      }
      scmLoadedIds = ids;
      scmRender();
    }
    function scmRender() {
      var tbl = document.getElementById('po-scm-table');
      if (!tbl) return;
      var nameById = {}; PROJ.forEach(function (p) { nameById[p.id] = p.name || p.id; });
      var metaBy = {}; (scmMeta || []).forEach(function (m) { metaBy[m.project_id] = m; });
      /* One row per PROJECT, not per cell: `scurve_manual` is one row per trade × month × kind,
         and a portfolio register of forty thousand cells is not a register of anything. */
      var by = {};
      (scmRows || []).forEach(function (r) {
        var g = by[r.project_id] || (by[r.project_id] = { trades: {}, months: {}, kinds: {}, cells: 0, touched: '' });
        g.cells++;
        if (r.trade) g.trades[r.trade] = 1;
        if (r.month) g.months[String(r.month).slice(0, 7)] = 1;
        if (r.kind) g.kinds[r.kind] = 1;
        if (r.updated_at && r.updated_at > g.touched) g.touched = r.updated_at;
      });
      var rows = Object.keys(by).map(function (id) {
        var g = by[id], ms = Object.keys(g.months).sort();
        return { id: id, name: nameById[id] || id, trades: Object.keys(g.trades).length,
                 cells: g.cells, kinds: g.kinds, from: ms[0] || '', to: ms[ms.length - 1] || '',
                 touched: g.touched, locked: !!(metaBy[id] && metaBy[id].planned_locked) };
      }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

      var locked = rows.filter(function (r) { return r.locked; }).length;
      document.getElementById('po-scm-kpis').innerHTML =
        kpi2('Projects with a manual curve', rows.length + ' of ' + scopedProjectIds().length) +
        kpi2('Planned curve locked', String(locked)) +
        kpi2('Trades covered', String(rows.reduce(function (a, r) { return a + r.trades; }, 0))) +
        kpi2('Cells entered', String(rows.reduce(function (a, r) { return a + r.cells; }, 0)));

      var head = '<thead><tr><th>Project</th><th class="num">Trades</th><th>Months covered</th>' +
        '<th>Kinds entered</th><th>Planned</th><th>Last edited</th></tr></thead>';
      var KINDS = ['planned', 'actual', 'forecast'];
      var body = rows.length ? rows.map(function (r) {
        var kinds = KINDS.filter(function (k) { return r.kinds[k]; })
          .map(function (k) { return statePill(k.charAt(0).toUpperCase() + k.slice(1), 'muted'); }).join(' ');
        /* ⚠️ `?scView=manual` — the row opens that project's OWN Manual data tab, which is the
           only place the sheet can actually be edited. Same shape as the `?openIssue=` link the
           Issues register uses, and answered by the S-Curve module's own boot. */
        return '<tr class="pd-proj-row" data-open-pid="' + esc(r.id) + '" data-open-to="?scView=manual"' +
          ' title="Open this project\u2019s manual sheet">' +
          '<td class="pd-proj-name">' + esc(r.name) + '</td>' +
          '<td class="num">' + r.trades + '</td>' +
          '<td>' + (r.from ? esc(moLabel(r.from)) + ' \u2013 ' + esc(moLabel(r.to)) : '\u2014') + '</td>' +
          '<td>' + (kinds || '\u2014') + '</td>' +
          '<td>' + (r.locked ? statePill('Locked', 'muted') : statePill('Open', 'warn')) + '</td>' +
          '<td>' + (r.touched ? Fmt.date(r.touched) : '\u2014') + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="po-empty">No project in scope carries a hand-entered curve yet. ' +
        'Open one project\u2019s S-Curve and use its Manual data tab to enter one.</td></tr>';
      tbl.innerHTML = head + '<tbody>' + body + '</tbody>';
      wireRowOpen(tbl);
      document.getElementById('po-scm-note').textContent =
        'A manual curve is the planner\u2019s own monthly POC per trade, entered by hand \u2014 a second source ' +
        'of truth the schedule knows nothing about. Portfolio scope is read-only, so this lists them; ' +
        'open a project to edit its sheet.';
    }

    /* The Curve | Manual data tabs, in the portfolio bar. ⚠️ `api.bar(bar)` is called by
       takeOver() once the bar exists — the view cannot build it itself, because `mount()` is also
       used by pages that host a dashboard without taking the page over. */
    var scView = 'curve';
    function scShowView(v, api) {
      scView = (v === 'manual') ? 'manual' : 'curve';
      var pc = document.getElementById('po-sc-pane-curve'), pm = document.getElementById('po-sc-pane-manual');
      if (pc) pc.hidden = scView !== 'curve';
      if (pm) pm.hidden = scView !== 'manual';
      document.querySelectorAll('#po-bar-tabs [data-scv]').forEach(function (b) {
        b.classList.toggle('on', b.dataset.scv === scView);
      });
      if (scView === 'manual') loadManual();
    }
    function scBar(bar) {
      var host = bar.querySelector('#po-bar-tabs');
      if (!host) return;
      host.innerHTML =
        '<button class="po-bar-tab on" data-scv="curve">Curve</button>' +
        '<button class="po-bar-tab" data-scv="manual">Manual data</button>';
      host.querySelectorAll('[data-scv]').forEach(function (b) {
        b.onclick = function () { scShowView(b.dataset.scv); };
      });
    }
      return { load: loadScurve, bar: scBar, _data: function () { return scData; },
               _bars: function () { return scBars; }, _bd: function () { return { i: scBdOpen, dim: scBdDim }; } };
    }
  });

  /* ---- Consolidated Cash Flow ------------------------------------------------------ */
  def("cashflow", {
    icon: "wallet",
    title: "Consolidated Cash Flow",
    needs: [],
    markup: [
      "<div class=\"pd-kpis\" id=\"po-cf-kpis\"></div>",
      "<div class=\"po-card\">",
      "  <h3 style=\"text-transform:none;font-size:15px;\">Consolidated Cash Flow — Cash In / Out per month + Net funding curve</h3>",
      "  <div id=\"po-cf-chart\"></div>",
      "</div>",
      "<div class=\"po-card\" style=\"padding:0;overflow:hidden;\">",
      "  <div style=\"overflow-x:auto;\"><table class=\"pd-table pd-proj-table po-table\" id=\"po-cf-table\"></table></div>",
      "</div>"
    ].join('\n'),
    setup: function () {
    // ================= Portfolio Cash Flow (cross-project) =================
    // Reads the per-project monthly roll-up written by each project's Cash Flow module
    // (cash_flow_rollup: cash_in, cash_out [negative], net) and consolidates it.
    // ⚠️ MUST be paginated, and this one was ALREADY truncating in production: the roll-up holds one
    // row per project per MONTH, so the portfolio's 19 projects over a ~5-year horizon is ~1,140 rows
    // — past PostgREST's 1000-row server cap. The consolidated Cash In/Out, the net funding curve and
    // the peak-funding KPI were all silently computed from a partial set, with no error to notice.
    async function fetchCashFlowForIds(ids) {
      if (!ids.length) return [];
      return await PDb.selectAll('cash_flow_rollup', function (q) { return q.in('project_id', ids); });
    }
    function cfMonthKey(v) { return v ? String(v).slice(0, 7) : ''; }
    function cfMonthLabel(k) {
      var MABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var m = k.match(/^(\d{4})-(\d{2})$/); if (!m) return k;
      return MABBR[+m[2] - 1] + " '" + m[1].slice(2);
    }
    function cfMonthlySeries(list) {
      var byMonth = {};
      list.forEach(function (r) {
        var k = cfMonthKey(r.period); if (!k) return;
        var m = byMonth[k] || (byMonth[k] = { cin: 0, cout: 0, net: 0 });
        m.cin += num(r.cash_in); m.cout += num(r.cash_out); m.net += num(r.net);
      });
      var keys = Object.keys(byMonth).sort(), nc = 0;
      return keys.map(function (k) { nc += byMonth[k].net; return { key: k, cin: byMonth[k].cin, cout: byMonth[k].cout, net: byMonth[k].net, netCum: nc }; });
    }
    function cfRenderKpis(list) {
      var host = document.getElementById('po-cf-kpis');
      var cin = list.reduce(function (a, r) { return a + num(r.cash_in); }, 0);
      var cout = list.reduce(function (a, r) { return a + num(r.cash_out); }, 0);
      var series = cfMonthlySeries(list);
      var peak = series.length ? Math.min.apply(null, series.map(function (s) { return s.netCum; })) : 0;
      var np = Object.keys(list.reduce(function (a, r) { a[r.project_id] = 1; return a; }, {})).length;
      host.innerHTML = kpi2('Projects', String(np)) + kpi2('Total Cash In', Fmt.moneyShort(cin)) +
        kpi2('Total Cash Out', Fmt.moneyShort(cout)) + kpi2('Net / Closing', Fmt.moneyShort(cin + cout), (cin + cout) >= 0 ? '--pd-ok' : '--pd-bad') +
        kpi2('Peak Funding Need', Fmt.moneyShort(peak), peak < 0 ? '--pd-bad' : '--pd-ok');
    }
    function cfRenderChart(list) {
      var host = document.getElementById('po-cf-chart');
      var series = cfMonthlySeries(list);
      if (!series.length) { host.innerHTML = '<div class="po-empty">No cash flow roll-up for the selected projects yet. Open each project\'s Cash Flow module once (it writes the roll-up on load).</div>'; return; }
      var W = 1000, H = 320, padL = 64, padR = 16, padT = 16, padB = 32, n = series.length;
      var cw = W - padL - padR, ch = H - padT - padB;
      var vals = []; series.forEach(function (s) { vals.push(s.cin, s.cout, s.netCum); });
      var maxV = Math.max.apply(null, vals), minV = Math.min.apply(null, vals);
      if (maxV === minV) maxV = minV + 1; var pad = (maxV - minV) * 0.08; maxV += pad; minV -= pad;
      function x(i) { return padL + (n <= 1 ? cw / 2 : (i / (n - 1)) * cw); }
      function y(v) { return padT + ch - ((v - minV) / (maxV - minV)) * ch; }
      var zeroY = y(0), grid = '', steps = 4;
      for (var i = 0; i <= steps; i++) { var v = minV + (maxV - minV) * i / steps, yy = y(v); grid += '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" class="po-grid2"/><text x="' + (padL - 6) + '" y="' + (yy + 3.5) + '" class="po-ylab2">' + Fmt.moneyShort(v) + '</text>'; }
      grid += '<line x1="' + padL + '" y1="' + zeroY + '" x2="' + (W - padR) + '" y2="' + zeroY + '" class="po-grid2" style="stroke-dasharray:3 3;"/>';
      var xw = cw / n, bw = Math.min(16, xw * 0.5), bars = '';
      series.forEach(function (s, i) {
        var cx = x(i);
        if (s.cin > 0) bars += '<rect x="' + (cx - bw / 2) + '" y="' + y(s.cin) + '" width="' + bw + '" height="' + (zeroY - y(s.cin)) + '" fill="var(--pd-ok)"/>';
        if (s.cout < 0) bars += '<rect x="' + (cx - bw / 2) + '" y="' + zeroY + '" width="' + bw + '" height="' + (y(s.cout) - zeroY) + '" fill="var(--pd-red)"/>';
      });
      var netPts = series.map(function (s, i) { return x(i) + ',' + y(s.netCum); }).join(' ');
      var xlab = ''; var step = Math.max(1, Math.ceil(n / 10));
      series.forEach(function (s, i) { if (i % step === 0) xlab += '<text x="' + x(i) + '" y="' + (H - padB + 16) + '" class="po-xlab2">' + cfMonthLabel(s.key) + '</text>'; });
      host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="po-svg">' + grid + bars +
        '<polyline points="' + netPts + '" fill="none" stroke="var(--pd-dark)" stroke-width="2.5"/>' + xlab + '</svg>' +
        '<div class="po-legend2">' +
        '<span class="po-lg2"><span class="sw2" style="background:var(--pd-ok);"></span>Cash In (period)</span>' +
        '<span class="po-lg2"><span class="sw2" style="background:var(--pd-red);"></span>Cash Out (period)</span>' +
        '<span class="po-lg2"><span class="sw2-line" style="border-color:var(--pd-dark);"></span>Net cumulative (funding curve)</span>' +
        '</div>';
    }
    function cfRenderTable(list) {
      var t = document.getElementById('po-cf-table');
      var nameById = {}; PROJ.forEach(function (p) { nameById[p.id] = p.name || p.id; });
      var byP = {};
      list.forEach(function (r) {
        var g = byP[r.project_id] || (byP[r.project_id] = { cin: 0, cout: 0, net: 0 });
        g.cin += num(r.cash_in); g.cout += num(r.cash_out); g.net += num(r.net);
      });
      var rows = Object.keys(byP).map(function (id) { return { id: id, name: nameById[id] || id, cin: byP[id].cin, cout: byP[id].cout, net: byP[id].net }; })
        .sort(function (a, b) { return a.net - b.net; });   // most negative (highest funding need) first
      var head = '<thead><tr><th>Project</th><th class="num">Cash In</th><th class="num">Cash Out</th><th class="num">Net</th></tr></thead>';
      var body = rows.length ? rows.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td class="num">' + Fmt.moneyShort(r.cin) + '</td><td class="num">' + Fmt.moneyShort(r.cout) + '</td>' +
          '<td class="num"><span class="' + (r.net >= 0 ? 'po-var-dn' : 'po-var-up') + '">' + Fmt.moneyShort(r.net) + '</span></td></tr>';
      }).join('') : '<tr><td colspan="4" class="po-empty">No roll-up rows.</td></tr>';
      if (rows.length) {
        var gi = rows.reduce(function (a, r) { return a + r.cin; }, 0), go = rows.reduce(function (a, r) { return a + r.cout; }, 0);
        body += '<tr class="po-tot-row"><td>TOTAL</td><td class="num">' + Fmt.moneyShort(gi) + '</td><td class="num">' + Fmt.moneyShort(go) + '</td><td class="num">' + Fmt.moneyShort(gi + go) + '</td></tr>';
      }
      t.innerHTML = head + '<tbody>' + body + '</tbody>';
    }
    var cfLoadedIds = null;
    async function loadCashflow(force) {
      var ids = scopedProjectIds();
      if (!force && cfLoadedIds && cfLoadedIds.join(',') === ids.join(',')) return;
      if (!ids.length) { document.getElementById('po-cf-kpis').innerHTML = ''; document.getElementById('po-cf-chart').innerHTML = '<div class="po-empty">No projects match the current filter.</div>'; document.getElementById('po-cf-table').innerHTML = ''; return; }
      document.getElementById('po-cf-chart').innerHTML = '<div class="po-empty">Loading…</div>';
      document.getElementById('po-cf-kpis').innerHTML = '';
      try {
        var list = await fetchCashFlowForIds(ids);
        cfLoadedIds = ids;
        cfRenderKpis(list); cfRenderChart(list); cfRenderTable(list);
      } catch (e) { UI.toast('Could not load cash flow: ' + (e.message || e), 'error'); document.getElementById('po-cf-chart').innerHTML = '<div class="po-empty">Load failed.</div>'; }
    }
      return { load: loadCashflow };
    }
  });

  /* ---- Portfolio Resources --------------------------------------------------------- */
  def("resources", {
    icon: "users",
    title: "Portfolio Resources",
    needs: [],
    markup: [
      "<p style=\"font-size:12px;color:var(--pd-muted);margin:0 0 12px;\">Aggregated server-side (safe at 27k+ assignments/project).</p>",
      "<div class=\"pd-kpis\" id=\"po-rs-kpis\"></div>",
      "<div class=\"po-card\">",
      "  <h3 style=\"text-transform:none;font-size:15px;\">Top resources by budgeted cost</h3>",
      "  <div id=\"po-rs-chart\"></div>",
      "</div>",
      "<div class=\"po-card\" style=\"padding:0;overflow:hidden;\">",
      "  <div style=\"overflow-x:auto;\"><table class=\"pd-table pd-proj-table po-table\" id=\"po-rs-table\"></table></div>",
      "</div>"
    ].join('\n'),
    setup: function () {
    // ================= Portfolio Resources (cross-project, server-aggregated) =================
    var rsLoadedIds = null;
    async function loadResources(force) {
      var ids = scopedProjectIds();
      if (!force && rsLoadedIds && rsLoadedIds.join(',') === ids.join(',')) return;
      var chart = document.getElementById('po-rs-chart'), tbl = document.getElementById('po-rs-table'), kpis = document.getElementById('po-rs-kpis');
      if (!ids.length) { kpis.innerHTML = ''; chart.innerHTML = '<div class="po-empty">No projects match the current filter.</div>'; tbl.innerHTML = ''; return; }
      chart.innerHTML = '<div class="po-empty">Aggregating resource demand across ' + ids.length + ' project(s)…</div>'; kpis.innerHTML = '';
      var res;
      try { res = await sb().rpc('portfolio_resource_summary', { p_ids: ids }); } catch (e) { res = { error: e }; }
      if (res.error) {
        var msg = (res.error.message || '') + '';
        chart.innerHTML = '<div class="po-empty">' + (/function|does not exist|PGRST202|404/i.test(msg) ? 'Run the <code>2026-07-11-portfolio-resource-rpc.sql</code> migration to enable the portfolio resource view.' : 'Could not load: ' + esc(msg)) + '</div>';
        tbl.innerHTML = ''; return;
      }
      rsLoadedIds = ids;
      var list = (res.data || []).map(function (r) { return { name: r.resource_name, type: r.resource_type, uom: r.uom, projects: +r.projects || 0, assignments: +r.assignments || 0, bu: +r.budgeted_units || 0, au: +r.actual_units || 0, ru: +r.remaining_units || 0, bc: +r.budgeted_cost || 0, ac: +r.actual_cost || 0 }; });
      rsRenderKpis(list); rsRenderChart(list); rsRenderTable(list);
    }
    function rsRenderKpis(list) {
      var host = document.getElementById('po-rs-kpis');
      var bc = list.reduce(function (a, r) { return a + r.bc; }, 0), ac = list.reduce(function (a, r) { return a + r.ac; }, 0);
      var na = list.reduce(function (a, r) { return a + r.assignments; }, 0);
      host.innerHTML = kpi2('Resources', String(list.length)) + kpi2('Assignments', na.toLocaleString()) +
        kpi2('Budgeted Cost', Fmt.moneyShort(bc)) + kpi2('Actual Cost', Fmt.moneyShort(ac));
    }
    function rsRenderChart(list) {
      var host = document.getElementById('po-rs-chart');
      var top = list.slice().sort(function (a, b) { return b.bc - a.bc; }).filter(function (r) { return r.bc > 0; }).slice(0, 12);
      if (!top.length) { host.innerHTML = '<div class="po-empty">No costed assignments yet — set a Price/Unit on resources and assign them (cost = units × rate), or enter assignment costs manually.</div>'; return; }
      var max = top[0].bc || 1;
      host.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px;padding:4px 2px;">' + top.map(function (r) {
        var pct = Math.max(2, Math.round(r.bc / max * 100));
        return '<div style="display:flex;align-items:center;gap:10px;font-size:12.5px;">' +
          '<div style="width:170px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(r.name) + '">' + esc(r.name) + '</div>' +
          '<div style="flex:1;background:var(--pd-line);border-radius:4px;height:16px;overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:var(--pd-red);"></div></div>' +
          '<div style="width:110px;flex:none;text-align:right;font-weight:700;">' + Fmt.moneyShort(r.bc) + '</div></div>';
      }).join('') + '</div>';
    }
    function rsRenderTable(list) {
      var t = document.getElementById('po-rs-table');
      var head = '<thead><tr><th>Resource</th><th>Type</th><th>UoM</th><th class="num">Projects</th><th class="num">Budgeted units</th><th class="num">Actual units</th><th class="num">Remaining</th><th class="num">Budgeted cost</th><th class="num">Actual cost</th></tr></thead>';
      var body = list.length ? list.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td><span class="rl-badge">' + esc(r.type) + '</span></td><td>' + esc(r.uom) + '</td>' +
          '<td class="num">' + r.projects + '</td>' +
          '<td class="num">' + (Math.round(r.bu * 100) / 100).toLocaleString() + '</td><td class="num">' + (Math.round(r.au * 100) / 100).toLocaleString() + '</td><td class="num">' + (Math.round(r.ru * 100) / 100).toLocaleString() + '</td>' +
          '<td class="num">' + Fmt.moneyShort(r.bc) + '</td><td class="num">' + Fmt.moneyShort(r.ac) + '</td></tr>';
      }).join('') : '<tr><td colspan="9" class="po-empty">No resource assignments found for the selected projects.</td></tr>';
      if (list.length) {
        var bu = list.reduce(function (a, r) { return a + r.bu; }, 0), au = list.reduce(function (a, r) { return a + r.au; }, 0), ru = list.reduce(function (a, r) { return a + r.ru; }, 0);
        var bc = list.reduce(function (a, r) { return a + r.bc; }, 0), ac = list.reduce(function (a, r) { return a + r.ac; }, 0);
        body += '<tr class="po-tot-row"><td>TOTAL</td><td></td><td></td><td></td><td class="num">' + (Math.round(bu * 100) / 100).toLocaleString() + '</td><td class="num">' + (Math.round(au * 100) / 100).toLocaleString() + '</td><td class="num">' + (Math.round(ru * 100) / 100).toLocaleString() + '</td><td class="num">' + Fmt.moneyShort(bc) + '</td><td class="num">' + Fmt.moneyShort(ac) + '</td></tr>';
      }
      t.innerHTML = head + '<tbody>' + body + '</tbody>';
    }
      return { load: loadResources };
    }
  });

  /* ---- Portfolio Equipment availability -------------------------------------------- */
  def("equipment", {
    icon: "box",
    title: "Equipment availability",
    needs: ["XLSX"],
    markup: [
      "<p style=\"font-size:12px;color:var(--pd-muted);margin:0 0 12px;\">Where every piece of equipment is committed, and when it comes free.</p>",
      "<div class=\"pd-kpis\" id=\"po-eq-kpis\"></div>",
      "<div class=\"po-eq-bar\">",
      "  <div class=\"po-toolbar-fields\" id=\"po-eq-fields\">",
      "    <select class=\"pd-select\" id=\"po-eq-cat\"><option value=\"\">All categories</option></select>",
      "    <span class=\"po-eq-seg\" id=\"po-eq-avail\">",
      "      <button data-av=\"\" class=\"active\">All assets</button>",
      "      <button data-av=\"free\">Free now</button>",
      "      <button data-av=\"soon\">Free within 3 months</button>",
      "      <button data-av=\"clash\">Double-booked</button>",
      "    </span>",
      "    <div class=\"po-search\" style=\"min-width:180px;\"><span data-ico=\"search\" data-ico-size=\"15\"></span><input class=\"pd-input\" id=\"po-eq-q\" placeholder=\"Search code or name…\" /></div>",
      "  </div>",
      "  <span style=\"margin-left:auto;font-size:12px;color:var(--pd-muted);\" id=\"po-eq-count\"></span>",
      "  <button class=\"pd-btn\" id=\"po-eq-export\"><span data-ico=\"download\" data-ico-size=\"15\"></span> Export</button>",
      "</div>",
      "<div class=\"po-card\">",
      "  <h3 id=\"po-eq-title\">Equipment availability</h3>",
      "  <div class=\"po-eq-scroll\" id=\"po-eq-grid\"></div>",
      "  <div class=\"po-eq-legend\" id=\"po-eq-legend\"></div>",
      "</div>",
      "<div class=\"po-card\" style=\"margin-top:16px;\">",
      "  <h3>Asset register across the portfolio</h3>",
      "  <div style=\"overflow-x:auto;\"><table class=\"pd-table pd-proj-table po-table\" id=\"po-eq-table\"></table></div>",
      "</div>"
    ].join('\n'),
    setup: function (host) {
    // ================= Portfolio Equipment availability =================
    // Answers one question across projects: WHERE is each asset committed, and WHEN does it come
    // free. The month grid is the answer — a coloured cell is a commitment, an empty cell is
    // availability, so the negative space carries the meaning.
    //
    // ⚠️ The asset identity is equipment_items.CODE, and its uniqueness is per PROJECT (that is what
    // the migration enforces). So one code appearing on two projects is EITHER one asset that moved
    // between them OR two projects that both numbered their first crane TC-01 — and nothing in the
    // data distinguishes those. The view therefore reports the overlap and says which projects,
    // rather than asserting a clash. Calling it an error would be a guess presented as a fact.
    //
    // ⚠️ Only PLANNED quantities drive the grid. Actuals say where an asset HAS been, not where it is
    // committed to be, and availability is a forward question.
    var eqRows = null, eqLoadedIds = null, eqMonths = [], eqProjColor = {}, eqNowIso = null;
    var eqCat = '', eqQuery = '', eqAvail = '';
    var EQ_MAX_MONTHS = 48;   // a 4-year window; beyond that the strip is unreadable and it says so

    function eqMkey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01'; }
    function eqMonthAdd(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
    var EQ_MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    // A stable per-project palette. ⚠️ Keyed by the project id, not by its position in the list, so a
    // project keeps its colour when the filter changes — otherwise every filter change repaints the
    // grid in different colours and the legend has to be re-read each time.
    var EQ_PALETTE = ['#EE3124','#1F6FB2','#1F7A3D','#B8860B','#7D3C98','#0E8388','#C2410C','#4B5563','#9D174D','#365314'];
    function eqColorFor(pid) {
      if (!eqProjColor[pid]) {
        var h = 0; for (var i = 0; i < pid.length; i++) h = (h * 31 + pid.charCodeAt(i)) % 9973;
        eqProjColor[pid] = EQ_PALETTE[h % EQ_PALETTE.length];
      }
      return eqProjColor[pid];
    }

    async function loadEquipment(force) {
      var ids = scopedProjectIds();
      if (!force && eqLoadedIds && eqLoadedIds.join(',') === ids.join(',')) return;
      var grid = document.getElementById('po-eq-grid'), tbl = document.getElementById('po-eq-table'), kpis = document.getElementById('po-eq-kpis');
      if (!ids.length) { kpis.innerHTML = ''; grid.innerHTML = '<div class="po-empty">No projects match the current filter.</div>'; tbl.innerHTML = ''; return; }
      grid.innerHTML = '<div class="po-empty">Reading the equipment registers of ' + ids.length + ' project(s)…</div>';
      kpis.innerHTML = ''; tbl.innerHTML = '';
      var items, load;
      try {
        // ⚠️ PDb.selectAll, not a bare select: one row per equipment per month across a whole
        // portfolio passes PostgREST's 1000-row cap easily, and a truncated read here would report
        // an asset as free in months it is actually committed — the most dangerous possible failure
        // for this screen, and a silent one.
        items = await PDb.selectAll('equipment_items', function (q) { return q.in('project_id', ids); });
        load = await PDb.selectAll('equipment_loading', function (q) { return q.in('project_id', ids); });
      } catch (e) {
        var msg = (e && e.message) || String(e);
        grid.innerHTML = '<div class="po-empty">' + (/equipment_items|equipment_loading|schema cache/i.test(msg)
          ? 'Run <code>migrations/2026-08-24-equipment-loading.sql</code> (and the two that follow it) to enable the portfolio equipment view.'
          : 'Could not load: ' + esc(msg)) + '</div>';
        return;
      }
      eqLoadedIds = ids;
      eqBuild(items, load);
      eqRender();
    }

    function eqBuild(items, load) {
      var pname = {}; PROJ.forEach(function (p) { pname[p.id] = p.name || p.id; });
      var byItem = {};                                   // equipment_id -> { iso: planned }
      var minIso = null, maxIso = null;
      (load || []).forEach(function (r) {
        var q = Number(r.planned_qty);
        if (!isFinite(q) || q <= 0) return;               // 0 and blank are both "not committed"
        var iso = String(r.period).slice(0, 10);
        (byItem[r.equipment_id] = byItem[r.equipment_id] || {})[iso] = (byItem[r.equipment_id][iso] || 0) + q;
        if (!minIso || iso < minIso) minIso = iso;
        if (!maxIso || iso > maxIso) maxIso = iso;
      });

      // The window always includes THIS month, even when nothing is committed near it — "free now"
      // is a claim about the present and needs the present on screen to be checkable.
      var now = new Date(); now = new Date(now.getFullYear(), now.getMonth(), 1);
      eqNowIso = eqMkey(now);
      var start = minIso ? pd(minIso) : now, end = maxIso ? pd(maxIso) : eqMonthAdd(now, 11);
      if (start > now) start = now;
      if (end < eqMonthAdd(now, 5)) end = eqMonthAdd(now, 5);
      eqMonths = [];
      var c = new Date(start.getFullYear(), start.getMonth(), 1), guard = 0;
      while (c <= end && guard++ < EQ_MAX_MONTHS) { eqMonths.push({ d: new Date(c), iso: eqMkey(c) }); c = eqMonthAdd(c, 1); }
      var truncated = guard >= EQ_MAX_MONTHS && c <= end;

      // Group by code. ⚠️ Case- and space-insensitive, because "TC-01" and "tc-01" typed on two
      // projects are the same asset to every human reading the sheet.
      var byCode = {};
      (items || []).forEach(function (it) {
        var code = String(it.code || '').trim();
        var key = code ? code.toLowerCase() : ('__nocode__' + it.id);
        var a = byCode[key] || (byCode[key] = {
          code: code, name: '', category: it.category || '', acq: {}, projects: {}, months: {}, clash: {}, uncoded: !code
        });
        if (!a.name) a.name = it.name || '';
        if (it.acquisition) a.acq[it.acquisition] = 1;
        var pj = a.projects[it.project_id] || (a.projects[it.project_id] = { id: it.project_id, name: pname[it.project_id] || it.project_id, months: {}, qty: 0 });
        var m = byItem[it.id] || {};
        Object.keys(m).forEach(function (iso) {
          pj.months[iso] = (pj.months[iso] || 0) + m[iso];
          var cell = a.months[iso] || (a.months[iso] = { qty: 0, projs: {} });
          cell.qty += m[iso];
          cell.projs[it.project_id] = (cell.projs[it.project_id] || 0) + m[iso];
          if (Object.keys(cell.projs).length > 1) a.clash[iso] = 1;
          if (m[iso] > pj.qty) pj.qty = m[iso];
        });
      });

      eqRows = Object.keys(byCode).map(function (k) {
        var a = byCode[k];
        a.projList = Object.keys(a.projects).map(function (id) { return a.projects[id]; })
          .sort(function (x, y) { return x.name.localeCompare(y.name); });
        a.committed = Object.keys(a.months).length;
        a.clashes = Object.keys(a.clash).length;
        // "Free from" = the first month on the axis, from this month onward, with no commitment
        // anywhere. ⚠️ Read off the same grid the planner is looking at, so the number and the
        // picture can never disagree; null means committed through the end of the window.
        a.freeFrom = null;
        for (var i = 0; i < eqMonths.length; i++) {
          var m = eqMonths[i];
          if (m.iso < eqNowIso) continue;
          if (!a.months[m.iso]) { a.freeFrom = m.iso; break; }
        }
        a.busyNow = !!a.months[eqNowIso];
        a.lastIso = Object.keys(a.months).sort().pop() || null;
        return a;
      }).sort(function (x, y) {
        // Codeless rows last — they are a register gap, not an asset, and mixing them into the
        // middle of the list hides them.
        if (x.uncoded !== y.uncoded) return x.uncoded ? 1 : -1;
        return String(x.code || x.name).localeCompare(String(y.code || y.name), undefined, { numeric: true });
      });
      eqRows.truncated = truncated;

      var cats = {};
      eqRows.forEach(function (a) { if (a.category) cats[a.category] = 1; });
      var sel = document.getElementById('po-eq-cat'), cur = eqCat;
      sel.innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) {
        return '<option' + (c === cur ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('');
      if (cur && sel.value !== cur) { eqCat = ''; sel.value = ''; }
    }

    function eqVisible() {
      var q = eqQuery.trim().toLowerCase();
      var soon = eqMonths.filter(function (m) { return m.iso >= eqNowIso; }).slice(0, 3).map(function (m) { return m.iso; });
      return (eqRows || []).filter(function (a) {
        if (eqCat && a.category !== eqCat) return false;
        if (q && (a.code + ' ' + a.name).toLowerCase().indexOf(q) < 0) return false;
        if (eqAvail === 'free' && a.busyNow) return false;
        if (eqAvail === 'clash' && !a.clashes) return false;
        if (eqAvail === 'soon') {
          var free = soon.some(function (iso) { return !a.months[iso]; });
          if (!free) return false;
        }
        return true;
      });
    }

    function eqRender() {
      if (!eqRows) return;
      var list = eqVisible();
      document.getElementById('po-eq-count').textContent =
        list.length + ' of ' + eqRows.length + ' asset(s)' + (eqRows.truncated ? ' · window capped at ' + EQ_MAX_MONTHS + ' months' : '');
      eqRenderKpis(list);
      eqRenderGrid(list);
      eqRenderTable(list);
      if (window.Icons) Icons.hydrate(host);
    }

    function eqRenderKpis(list) {
      var host = document.getElementById('po-eq-kpis');
      var freeNow = list.filter(function (a) { return !a.busyNow; }).length;
      var shared = list.filter(function (a) { return a.projList.length > 1; }).length;
      var clash = list.filter(function (a) { return a.clashes; }).length;
      var rental = list.filter(function (a) { return a.acq['Rental']; }).length;
      host.innerHTML = kpi2('Assets tracked', String(list.length)) +
        kpi2('Free this month', String(freeNow)) +
        kpi2('On more than one project', String(shared)) +
        kpi2('On rental', String(rental)) +
        kpi2('Double-booked assets', String(clash));
    }

    function eqRenderGrid(list) {
      var host = document.getElementById('po-eq-grid');
      if (!list.length) {
        host.innerHTML = '<div class="po-empty">' + (eqRows.length
          ? 'No asset matches these filters.'
          : 'No equipment registered on the selected projects yet. Add it in each project\'s <b>Equipment Loading</b> module.') + '</div>';
        document.getElementById('po-eq-legend').innerHTML = '';
        return;
      }
      // Year band, so a 30-month strip is readable without counting columns.
      var yr = [], run = null;
      eqMonths.forEach(function (m) {
        var y = m.d.getFullYear();
        if (!run || run.y !== y) { run = { y: y, n: 0 }; yr.push(run); }
        run.n++;
      });
      // 3-letter labels only while a column can hold them; past ~18 months the strip is compressed
      // to its 26px floor and three letters would collide.
      var wide = eqMonths.length <= 18;
      var h = ['<table class="po-eq"><thead>'];
      h.push('<tr class="po-eq-yr"><th class="po-eq-c1">Asset</th>' +
        yr.map(function (r) { return '<th colspan="' + r.n + '">' + r.y + '</th>'; }).join('') + '</tr>');
      h.push('<tr><th class="po-eq-c1"></th>' + eqMonths.map(function (m) {
        return '<th class="po-eq-m' + (m.iso === eqNowIso ? ' po-eq-now' : '') + '">' + (wide ? EQ_MON3[m.d.getMonth()] : EQ_MON3[m.d.getMonth()].charAt(0)) + '</th>';
      }).join('') + '</tr>');
      h.push('</thead><tbody>');
      list.forEach(function (a) {
        var sub = [a.category || 'Uncategorised'];
        if (a.projList.length) sub.push(a.projList.map(function (p) { return p.name; }).join(' · '));
        h.push('<tr><td class="po-eq-c1">' +
          '<div class="po-eq-name">' + (a.code ? '<span class="po-eq-code">' + esc(a.code) + '</span>' : '<span class="po-eq-flag" title="This item has no equipment code — it cannot be tracked across projects">no code</span> ') + esc(a.name || '—') + '</div>' +
          '<div class="po-eq-sub" title="' + esc(sub.join(' — ')) + '">' + esc(sub.join(' — ')) + '</div></td>');
        eqMonths.forEach(function (m) {
          var cell = a.months[m.iso];
          var cls = 'po-eq-cell', style = '', tip;
          if (cell) {
            var pids = Object.keys(cell.projs);
            cls += ' on';
            style = 'background-color:' + eqColorFor(pids[0]) + ';';
            if (pids.length > 1) cls += ' clash';
            tip = EQ_MON3[m.d.getMonth()] + ' ' + m.d.getFullYear() + ' — ' +
              pids.map(function (id) { return (a.projects[id] ? a.projects[id].name : id) + ' (' + (Math.round(cell.projs[id] * 100) / 100) + ')'; }).join(' + ') +
              (pids.length > 1 ? ' — planned on two projects at once' : '');
          } else {
            tip = EQ_MON3[m.d.getMonth()] + ' ' + m.d.getFullYear() + ' — free';
          }
          h.push('<td class="po-eq-m' + (m.iso === eqNowIso ? ' po-eq-now' : '') + '" title="' + esc(tip) + '">' +
            '<div class="' + cls + '" style="' + style + '"></div></td>');
        });
        h.push('</tr>');
      });
      h.push('</tbody></table>');
      host.innerHTML = h.join('');

      // Legend: only the projects actually on screen, so it stays a key rather than a project list.
      var seen = {};
      list.forEach(function (a) { a.projList.forEach(function (p) { if (Object.keys(p.months).length) seen[p.id] = p.name; }); });
      document.getElementById('po-eq-legend').innerHTML =
        Object.keys(seen).map(function (id) {
          return '<span class="po-eq-lg"><span class="sw" style="background:' + eqColorFor(id) + '"></span>' + esc(seen[id]) + '</span>';
        }).join('') +
        '<span class="po-eq-lg"><span class="sw" style="background:var(--pd-line);opacity:.35;"></span>free</span>' +
        '<span class="po-eq-lg"><span class="sw clash" style="background:var(--pd-muted);outline:1.5px solid var(--pd-bad);"></span>planned on two projects</span>' +
        '<span class="po-eq-lg"><span class="sw" style="background:var(--pd-red);width:3px;border-radius:0;"></span>this month</span>';
    }

    function eqFreeLabel(a) {
      if (!a.busyNow) return '<span class="po-eq-free">free now</span>';
      if (a.freeFrom) {
        var d = pd(a.freeFrom);
        return '<span class="po-eq-busy">' + EQ_MON3[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2) + '</span>';
      }
      return '<span class="po-eq-busy">beyond this window</span>';
    }

    function eqRenderTable(list) {
      var t = document.getElementById('po-eq-table');
      var head = '<thead><tr><th>Code</th><th>Equipment</th><th>Category</th><th>Type</th><th>Projects</th>' +
        '<th class="num">Months committed</th><th class="num">Peak qty</th><th>Free from</th><th>Flags</th></tr></thead>';
      if (!list.length) { t.innerHTML = head + '<tbody><tr><td colspan="9" class="po-empty">Nothing to show.</td></tr></tbody>'; return; }
      var body = list.map(function (a) {
        var peak = 0; Object.keys(a.months).forEach(function (iso) { if (a.months[iso].qty > peak) peak = a.months[iso].qty; });
        var flags = [];
        if (a.clashes) flags.push('<span class="po-eq-flag" title="Planned on more than one project in the same month — either one asset double-booked, or two projects using the same code">' + a.clashes + ' overlapping month(s)</span>');
        if (a.uncoded) flags.push('<span class="po-eq-flag">no code</span>');
        if (!a.committed) flags.push('<span class="po-eq-busy">no planned months</span>');
        return '<tr><td><b>' + esc(a.code || '—') + '</b></td><td>' + esc(a.name || '—') + '</td><td>' + esc(a.category || '—') + '</td>' +
          '<td>' + esc(Object.keys(a.acq).join(' / ') || '—') + '</td>' +
          '<td>' + (a.projList.length ? a.projList.map(function (p) {
            return '<span class="po-eq-lg" style="margin-right:8px;"><span class="sw" style="background:' + eqColorFor(p.id) + '"></span>' + esc(p.name) + '</span>';
          }).join('') : '<span class="po-eq-busy">unassigned</span>') + '</td>' +
          '<td class="num">' + a.committed + '</td><td class="num">' + (Math.round(peak * 100) / 100) + '</td>' +
          '<td>' + eqFreeLabel(a) + '</td><td>' + (flags.join(' · ') || '') + '</td></tr>';
      }).join('');
      t.innerHTML = head + '<tbody>' + body + '</tbody>';
    }

    function eqExport() {
      if (typeof XLSX === 'undefined') { UI.toast('Excel library still loading — try again.', 'error'); return; }
      var list = eqVisible();
      if (!list.length) { UI.toast('Nothing to export.', 'warn'); return; }
      // One row per asset with a column per month, so the exported sheet is the same picture as the
      // grid rather than a different summary of it.
      var rows = list.map(function (a) {
        var o = {
          Code: a.code, Equipment: a.name, Category: a.category,
          Type: Object.keys(a.acq).join(' / '),
          Projects: a.projList.map(function (p) { return p.name; }).join(' | '),
          'Months committed': a.committed,
          'Free from': a.busyNow ? (a.freeFrom || 'beyond window') : 'free now',
          'Overlapping months': a.clashes
        };
        eqMonths.forEach(function (m) {
          var cell = a.months[m.iso];
          o[EQ_MON3[m.d.getMonth()] + ' ' + String(m.d.getFullYear()).slice(2)] = cell
            ? Object.keys(cell.projs).map(function (id) { return (a.projects[id] ? a.projects[id].name : id); }).join(' + ')
            : '';
        });
        return o;
      });
      var ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Equipment availability');
      XLSX.writeFile(wb, 'Portfolio Equipment Availability.xlsx');
    }

    /* ⚠️ THE CONTROL WIRING CAME WITH THE VIEW. On the Portfolio Dashboard these four
       handlers were bound three thousand lines away, in that page's auth callback — the
       same separation that left the Meetings dashboard without its date helpers. A view
       that carries its own filter row has to carry the code that makes it do something. */
    function wire() {
      var cat = document.getElementById('po-eq-cat');
      if (cat) cat.onchange = function (e) { eqCat = e.target.value; eqRender(); };
      var q = document.getElementById('po-eq-q');
      if (q) q.oninput = function (e) { eqQuery = e.target.value; eqRender(); };
      var ex = document.getElementById('po-eq-export');
      if (ex) ex.onclick = eqExport;
      Array.prototype.forEach.call(document.querySelectorAll('#po-eq-avail button'), function (b) {
        b.onclick = function () {
          eqAvail = b.dataset.av || '';
          Array.prototype.forEach.call(document.querySelectorAll('#po-eq-avail button'), function (x) {
            x.classList.toggle('active', x === b);
          });
          eqRender();
        };
      });
    }
    wire();
      return { load: loadEquipment };
    }
  });

  /* ---- mounting -----------------------------------------------------------------------------
     ⚠️ ONE ENTRY POINT, and it is async: the markup goes in, the projects are fetched once, then
     the view loads itself. A module calls it and awaits it; nothing else needs to know how a
     dashboard is built. */
  def("schedule", {
    icon: "ganttChart",
    title: "Project Schedule",
    needs: [],
    markup: [
      "        <div class=\"po-toolbar\">",
      "          <div class=\"po-toolbar-fields\" id=\"po-sh-fields\">",
      "            <select class=\"pd-select\" id=\"po-sh-group\" style=\"max-width:190px;\">",
      "              <option value=\"program\">Group by parent project</option>",
      "              <option value=\"none\">No grouping</option>",
      "            </select>",
      "            <label class=\"po-chk\"><input type=\"checkbox\" id=\"po-sh-slip\"> Running past contract only</label>",
      "            <!-- \u26a0 THE TIME GRAIN, as an explicit control rather than a guess. It used to be",
      "                 inferred from the span alone (>48 months \u2192 years, >18 \u2192 quarters, else months),",
      "                 so a 2020\u20132031 portfolio was ALWAYS years and a planner who wanted to read",
      "                 this quarter had no way to ask. Owner 2026-09-16: *\"let's also have a toggle",
      "                 for year, quarterly, monthly viewing as well.\"* Auto is kept as the default",
      "                 and is still the right answer most of the time. -->",
      "            <span class=\"pd-seg po-sh-grain\" id=\"po-sh-grain\" title=\"Time grain of the chart\">",
      "              <button data-g=\"auto\" class=\"on\">Auto</button>",
      "              <button data-g=\"year\">Year</button>",
      "              <button data-g=\"quarter\">Quarter</button>",
      "              <button data-g=\"month\">Month</button>",
      "            </span>",
      "            <span class=\"po-spacer\"></span>",
      "            <div class=\"po-search\"><span data-ico=\"search\" data-ico-size=\"15\"></span><input class=\"pd-input\" id=\"po-sh-q\" placeholder=\"Search project…\" /></div>",
      "          </div>",
      "        </div>",
      "        <div class=\"pd-kpis\" id=\"po-sh-kpis\"></div>",
      "        <div class=\"po-card\">",
      "          <div class=\"po-sechead\"><h3>Programme against contract</h3><span class=\"po-mut\" id=\"po-sh-note\"></span></div>",
      "          <div id=\"po-sh-gantt\"></div>",
      "        </div>",
      "        <p class=\"po-coverage\" id=\"po-sh-cov\"></p>"
    ].join('\n'),
    setup: function () {
      var shGroup = 'program', shSlipOnly = false, shQuery = '', shGrain = 'auto';
      var STALE_DAYS = 45;

      function shRows() {
        var q = shQuery.trim().toLowerCase();
        return PROJ.filter(function (p) {
          if (q && String(p.name || p.id).toLowerCase().indexOf(q) < 0 &&
                   String(p.id).toLowerCase().indexOf(q) < 0) return false;
          if (shSlipOnly && !(shSlip(p) > 0)) return false;
          return true;
        }).map(shShape);
      }
      /* ⚠️ A project with no roll-up gets a NAMED EMPTY ROW, never a bar guessed from its
         contract dates - a contract window is what was agreed, not what is planned. */
      function shShape(p) {
        var cs = pd(p.start_date), cf = pd(p.end_date);
        var ps = pd(p.schedule_start), pf = pd(p.schedule_finish);
        var ff = pd(p.forecast_finish);
        var upd = pd(p.schedule_updated_at);
        var age = upd ? Math.round((today() - upd) / 86400000) : null;
        return { p: p, id: p.id, name: p.name || p.id, cs: cs, cf: cf, ps: ps, pf: pf, ff: ff,
                 pct: Math.max(0, Math.min(100, num(p.schedule_progress))),
                 acts: num(p.schedule_activities), age: age,
                 has: !!(ps && pf), slip: shSlip(p) };
      }
      function shSlip(p) {
        var pf = pd(p.schedule_finish), cf = pd(p.end_date);
        if (!pf || !cf) return null;
        return Math.round((pf - cf) / 86400000);
      }
      /* ⚠️ PDProgram.labelFor takes the PROJECT, not the key - it derives the key itself.
         ⚠️ It is loaded by project-schedule but not by every module that carries
         portfolio-dash.js, so an absent PDProgram degrades to no grouping rather than
         throwing on a page that simply does not have it. */
      function shGroupOf(p) {
        if (shGroup === 'none' || !(window.PDProgram && PDProgram.keyOf))
          return { key: '_all', label: 'All projects' };
        return { key: PDProgram.keyOf(p), label: PDProgram.labelFor(p, PROJ) || PDProgram.keyOf(p) };
      }

      function shRender() {
        var rows = shRows();
        var host = document.getElementById('po-sh-gantt');
        var kpis = document.getElementById('po-sh-kpis');
        var note = document.getElementById('po-sh-note');
        var cov = document.getElementById('po-sh-cov');
        if (!host) return;

        var withRoll = rows.filter(function (r) { return r.has; });
        var late = withRoll.filter(function (r) { return r.slip > 0; });
        var stale = withRoll.filter(function (r) { return r.age != null && r.age > STALE_DAYS; });
        kpis.innerHTML =
          kpi2('Projects', String(rows.length)) +
          kpi2('With a roll-up', withRoll.length + ' of ' + rows.length) +
          kpi2('Past contract finish', String(late.length), late.length ? '--pd-bad' : '--pd-ok') +
          kpi2('Roll-up over ' + STALE_DAYS + 'd old', String(stale.length), stale.length ? '--pd-warn' : '--pd-ok');

        if (!withRoll.length) {
          host.innerHTML = '<div class="po-empty">No project in scope carries a schedule roll-up yet. ' +
            'It is written when a project\'s Project Schedule is opened.</div>';
          note.textContent = ''; cov.textContent = ''; return;
        }

        /* the window: every date any drawn row carries, plus today */
        var ts = [+today()];
        withRoll.forEach(function (r) {
          [r.cs, r.cf, r.ps, r.pf, r.ff].forEach(function (d) { if (d) ts.push(+d); });
        });
        var t0 = new Date(Math.min.apply(null, ts)), t1 = new Date(Math.max.apply(null, ts));
        var span = (+t1 - +t0) || 1;
        function x(d) { return ((+d - +t0) / span) * 100; }

        /* ==== THE TIME AXIS ====================================================================
           ⚠️ THE GRAIN IS CHOSEN, NOT INFERRED. `every` used to be derived from the span alone
           (>48 months → one tick a year, >18 → a quarter, else a month), which over a 2020–2031
           portfolio meant YEARS, always, with no way to ask for anything else — the owner's
           *"toggle for year, quarterly, monthly viewing"*. `auto` keeps exactly the old rule as
           the default; the other three override it.
           ⚠️ A month tick every month over eleven years is ~132 labels in ~1500px. `month` is
           therefore a real choice a planner can make and not one the chart makes for them: it
           stays legible because the axis SCROLLS at that grain (see `.po-sh-scroll`), rather than
           squeezing 132 labels into the width and smearing them into a grey band. */
        var months = [], c = new Date(t0.getFullYear(), t0.getMonth(), 1);
        while (c <= t1) { months.push(new Date(c)); c = new Date(c.getFullYear(), c.getMonth() + 1, 1); }
        var every = shGrain === 'year' ? 12 : shGrain === 'quarter' ? 3 : shGrain === 'month' ? 1
                  : (months.length > 48 ? 12 : months.length > 18 ? 3 : 1);
        /* ⚠️ QUARTERS AND YEARS START WHERE THEY REALLY START. Stepping `i % every` from the
           first month in the window put "quarters" on Feb/May/Aug/Nov whenever the earliest
           contract happened to begin in February — ticks labelled as quarters that were not
           quarters. Anchoring on the calendar month instead makes a Q label a real Q. */
        function shOnTick(m) {
          if (every === 12) return m.getMonth() === 0;
          if (every === 3) return m.getMonth() % 3 === 0;
          return true;
        }
        function shTickLabel(m) {
          if (every === 12) return String(m.getFullYear());
          if (every === 3) return 'Q' + (Math.floor(m.getMonth() / 3) + 1) + " '" + String(m.getFullYear()).slice(2);
          return moLabel(m.getFullYear() + '-' + ('0' + (m.getMonth() + 1)).slice(-2));
        }
        var ticks = months.filter(shOnTick);
        var axis = ticks.map(function (m) {
          return '<span class="po-sh-tick" style="left:' + x(m).toFixed(3) + '%">' + shTickLabel(m) + '</span>';
        }).join('');
        /* ⚠⚠ ONE CONTINUOUS GRID, DRAWN ONCE BEHIND EVERY ROW — and this is the fix for the
           "today" line the owner was looking at. `.po-sh-now` was emitted per row INSIDE each
           18px-tall `.po-sh-track`, plus once inside the 18px-tall axis: today was never a line
           down the chart, it was a stack of disconnected 18px stubs with a gap at every row
           padding and group heading. A bar could not be read against a date, which is most of
           what a gantt is for. This layer spans the whole plot area, so a period boundary and
           today are each ONE line from the axis to the last row. */
        var nowX = x(today());
        var grid = ticks.map(function (m) {
          return '<span class="po-sh-gl" style="left:' + x(m).toFixed(3) + '%"></span>';
        }).join('') + '<span class="po-sh-now" style="left:' + nowX.toFixed(3) + '%"></span>';

        var groups = {};
        rows.forEach(function (r) {
          var g = shGroupOf(r.p);
          (groups[g.key] || (groups[g.key] = { label: g.label, rows: [] })).rows.push(r);
        });

        /* ⚠️ ONE COUNTER FOR THE WHOLE CHART, not one per group — measured, not assumed. Banding
           from each group's own index looked right in the code and produced ONE striped row out of
           five on real data: "Group by parent project" is the default, most parents hold a single
           package, and a group of one always starts at index 0. Zebra striping that appears on one
           row in five reads as a rendering fault, not as a rhythm. */
        var shBand = 0;
        var body = Object.keys(groups).sort(function (a, b) {
          return String(groups[a].label).localeCompare(String(groups[b].label));
        }).map(function (k) {
          var g = groups[k];
          /* ⚠️ program.js's own rule: a heading above a SINGLE project invents a hierarchy
             that is not there. A parent with one package reads as a plain row. */
          var head = g.rows.length > 1
            ? '<div class="po-sh-grp"><span class="pd-ghchip">' + esc(g.label) + '</span>' +
              '<span class="pd-ghcount">' + g.rows.length + ' project' + (g.rows.length === 1 ? '' : 's') + '</span></div>'
            : '';
          /* ⚠️ BANDED IN JS, NOT WITH `:nth-child`. Group headings and rows are both plain divs
             inside `.po-sh-body`, so a CSS `:nth-child(even)` counts the HEADINGS too and the
             stripe flips at every group — banding that is worse than none, because it looks
             deliberate. `shRow` also returns '' for a project with no roll-up, so the index has
             to count rows that were actually DRAWN; filtering first is what makes that true. */
          return head + g.rows.sort(function (a, b) {
            return (b.slip == null ? -1e9 : b.slip) - (a.slip == null ? -1e9 : a.slip);
          }).filter(function (r) { return r.has; })
            .map(function (r) { return shRow(r, shBand++); }).join('');
        }).join('');

        /* ⚠️ The plot is its own positioned box so the grid layer above can be absolute against
           IT and not against the axis strip (which is 18px tall — the old bug). `.po-sh-plot` is
           inset from the left by exactly the label column, which is why that width lives in ONE
           place now (`--po-sh-lab` in portfolio-dash.css) instead of being repeated as a 230px
           margin on the axis and a 220px flex-basis on the labels, two numbers that had to agree
           and were only ever checked by eye.
           ⚠️ At MONTH grain the whole plot scrolls sideways instead of compressing: 132 monthly
           labels in the pane's width is a grey smear, and a planner who asked for months wants to
           read months. Auto/quarter/year fit as before. */
        /* ⚠⚠ THE PLOT IS WIDENED FROM THE TICK COUNT, NOT FROM A GUESSED CONSTANT — and the
           constant was measured to be wrong. This was `min-width: 1600px` whenever the grain was
           months, which over a 2020–2027 window is 96 labels in 1370px: rendering it and asking
           the DOM how many labels overlapped their neighbour returned **95 of 96**. That is the
           unreadable smear this control exists to escape, reproduced by the escape hatch.
           ⚠ So each tick is given a floor of its own label's width. `max(100%, Npx)` keeps the
           plot exactly pane-width whenever the ticks already fit (year and auto on any normal
           portfolio), and lets `.po-sh-scroll` take over only when they genuinely do not. */
        var perTick = every === 12 ? 44 : every === 3 ? 50 : 52;
        var minW = ticks.length * perTick;
        host.className = 'po-sh-chart';
        host.innerHTML = '<div class="po-sh-scroll"><div class="po-sh-inner" style="min-width:max(100%,' + minW + 'px)">' +
          '<div class="po-sh-axis">' + axis + '</div>' +
          '<div class="po-sh-plot"><div class="po-sh-grid">' + grid + '</div></div>' +
          '<div class="po-sh-body">' + body + '</div></div></div>' +
          '<div class="po-legend2">' +
            '<span class="po-lg2"><span class="sw2" style="background:var(--pd-line);"></span>Contract window</span>' +
            '<span class="po-lg2"><span class="sw2" style="background:var(--pd-dark);"></span>Live programme</span>' +
            '<span class="po-lg2"><span class="sw2" style="background:var(--pd-bad-text);"></span>Past contract finish</span>' +
            '<span class="po-lg2"><span class="sw2-line" style="border-color:var(--pd-red);"></span>Today</span>' +
          '</div>';

        function shRow(r, i) {
          if (!r.has) return '';
          var a = Math.min(x(r.ps), x(r.pf)), b = Math.max(x(r.ps), x(r.pf));
          var rail = (r.cs && r.cf)
            ? '<span class="po-sh-rail" style="left:' + x(r.cs).toFixed(3) + '%;width:' +
              Math.max(0.2, x(r.cf) - x(r.cs)).toFixed(3) + '%"></span>' : '';
          /* the overrun is drawn as its own segment past the contract finish */
          var over = '';
          if (r.cf && r.slip > 0)
            over = '<span class="po-sh-over" style="left:' + x(r.cf).toFixed(3) + '%;width:' +
                   Math.max(0.2, b - x(r.cf)).toFixed(3) + '%"></span>';
          var bar = '<span class="po-sh-bar" style="left:' + a.toFixed(3) + '%;width:' +
                    Math.max(0.3, b - a).toFixed(3) + '%">' +
                    '<span class="po-sh-fill" style="width:' + r.pct + '%"></span></span>';
          var fc = r.ff ? '<span class="po-sh-fc" style="left:' + x(r.ff).toFixed(3) + '%" title="Forecast finish"></span>' : '';
          var flags = '';
          if (r.slip > 0) flags += ' <span class="po-bad">' + r.slip + 'd past contract</span>';
          /* ⚠️ A stale roll-up is SAID, not silently drawn as current: schedule_updated_at is
             written when the module is opened, so a project untouched for months carries a
             confident-looking bar built from months-old numbers. */
          if (r.age != null && r.age > STALE_DAYS) flags += ' <span class="po-warn">roll-up ' + r.age + 'd old</span>';
          return '<div class="po-sh-row' + (i % 2 ? ' alt' : '') + '">' +
            '<div class="po-sh-lab">' + esc(r.name) +
              '<span class="po-mut"> ' + Math.round(r.pct) + '%</span>' + flags + '</div>' +
            /* ⚠️ No per-row "today" stub any more — the grid layer draws it once, continuously,
               for the whole chart. See the note at `grid` above for why the stubs were wrong. */
            '<div class="po-sh-track">' + rail + over + bar + fc + '</div>' +
            '</div>';
        }

        note.innerHTML = withRoll.length + ' drawn · ' +
          t0.getFullYear() + ' – ' + t1.getFullYear() +
          ' · <span class="po-mut">measured against today, not a data date</span>';
        /* ⚠️ What the picture could NOT show, counted rather than dropped. */
        var noRoll = rows.length - withRoll.length;
        var noContract = withRoll.filter(function (r) { return !(r.cs && r.cf); }).length;
        var bits = [];
        if (noRoll) bits.push(noRoll + ' project(s) carry no schedule roll-up, so they are not drawn');
        if (noContract) bits.push(noContract + ' have no contract window to measure against');
        if (stale.length) bits.push(stale.length + ' were last rolled up over ' + STALE_DAYS + ' days ago');
        cov.textContent = bits.length
          ? 'Of the ' + rows.length + ' project(s) in scope, ' + bits.join('; ') + '.'
          : '';
      }

      async function loadSchedule() { shRender(); }

      document.querySelectorAll('#po-sh-grain button').forEach(function (b) {
        b.onclick = function () {
          shGrain = b.dataset.g || 'auto';
          document.querySelectorAll('#po-sh-grain button').forEach(function (x) { x.classList.toggle('on', x === b); });
          shRender();
        };
      });
      document.getElementById('po-sh-group').onchange = function (e) { shGroup = e.target.value; shRender(); };
      document.getElementById('po-sh-slip').onchange = function (e) { shSlipOnly = e.target.checked; shRender(); };
      document.getElementById('po-sh-q').oninput = function (e) { shQuery = e.target.value; shRender(); };
      return { load: loadSchedule };
    }
  });

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
    /* ⚠️ THE HOST IS HANDED TO setup(), and one view genuinely needs it: the Equipment
       renderer re-hydrated its icons through `getElementById('po-view-equipment')` — the id of
       the PANE it used to sit in on the Portfolio Dashboard, which does not exist on a module
       page. `Icons.hydrate(null)` silently falls back to the whole document, so nothing threw
       and nothing looked wrong; the name was simply pointing at a screen that is gone. */
    var api = v.setup(host);
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
    /* ⚠⚠ A CLASS, NOT THE `hidden` ATTRIBUTE — AND THIS IS A REAL BUG THIS LINE ONCE HAD.
       `hidden` is a UA-stylesheet rule (`[hidden] { display: none }`), and ANY author rule that
       sets `display` on the same element beats it outright — author origin wins over UA origin,
       no matter how weak the selector. Three of the things this line is pointing at declare
       exactly that:
         · `.pd-modulebar { display: flex }`        (dashboard.css)  — every module
         · `.ps-toolbar   { display: flex }`        (project-schedule) — its authoring toolbar
         · `.po-toolbar   { display: flex }`        (portfolio-dash.css)
       So `n.hidden = true` set an attribute that changed NOTHING, and every portfolio view has
       been drawing underneath its module's own still-visible chrome. Owner 2026-09-16, on Project
       Schedule: *"portfolio level UI bugged out completely"*, and separately *"the toolbars
       aren't necessary since these are unusable until a project is selected"* — which is what
       this line was always trying to say. It also explains the Issues module's "duplicated logo":
       a module bar that was supposed to be gone, showing its <h1> mark beside the dropdown's.
       ⚠ `!important` is not belt-and-braces here: `body.ps-reporting .pd-modulebar` already uses
       `display:none !important`, so an ordinary class would be the WEAKER rule against a module
       that plays the same card to show something.
       ⚠ `hidden` is still set alongside it, for the semantics the attribute carries (it is what
       assistive tech and `:not([hidden])` selectors read); the class is what actually hides. */
    /* ⚠⚠ THE PAGE IS MARKED, NOT JUST THE ELEMENTS — AND THIS IS THE SECOND HALF OF THE BUG.
       The first half was `hidden` losing to an author `display` rule (see the note below). Fixing
       that alone left the module bar STILL on screen, now with the dashboard's own bar under it —
       the owner's *"title bar has bugged out completely, it duplicated"*, across every module.
       ⚠⚠ BECAUSE `.pd-modulebar` DOES NOT EXIST YET WHEN THIS RUNS, HALF THE TIME. It is not in
       any module's markup: `UI.initModuleTopbar()` CREATES it (ui.js) and moves the title, tabs and
       tools into it — and that runs on DOMContentLoaded, while this runs from
       `AppAuth.requireLogin`'s callback. Those two race. With a cold session the auth round-trips
       lose and the bar is there to be hidden; with a cached session they win, this
       `querySelectorAll` matches NOTHING, and the bar is built afterwards, unhidden. A bug that
       depends on whether you are already logged in is exactly the kind that survives testing.
       ⚠ So the rule is hung on the BODY and the stylesheet does the hiding. However late the bar
       is built, it is born into a page that already says "a dashboard has taken this over".
       ⚠ The per-element class is kept as well: it is what carries the `hidden` semantics, and it
       still covers `.pd-main`'s own children, which ARE in the markup and never move. */
    document.body.classList.add('po-dash-page');
    Array.prototype.forEach.call(main.children, function (c) { c.hidden = true; c.classList.add('po-taken-over'); });
    Array.prototype.forEach.call(document.querySelectorAll(opts.hide || '.pd-modulebar'), function (n) {
      n.hidden = true; n.classList.add('po-taken-over');
    });
    var host = document.createElement('div');
    host.id = 'po-dash-host';
    main.appendChild(host);
    if (opts.select) wireSelect(document.querySelector(opts.select));
    /* ⚠️ The bar is built BEFORE the view mounts, and awaits the project list first — its
       filter is a list OF those projects, and an empty popover on first open would read as "this
       page has no projects" rather than "they have not arrived yet". mount() awaits the same
       already-started promise, so this costs no second fetch. */
    await loadProjects();
    var bar = buildBar(key, VIEWS[key], opts);
    var api = await mount(key, host, opts);
    /* ⚠️ Re-LOADS, never just re-renders. Narrowing the filter changes which projects the view
       is about, and nine of the eleven views hold rows they fetched for the PREVIOUS selection —
       a repaint would redraw the old projects under the new label. Each view's own `load()` already
       compares `scopedProjectIds().join(',')` against what it last read and returns early when
       nothing moved, so widening back to a set it already holds costs nothing. */
    pfOnChange = function () { if (api && api.load) api.load(); };
    if (bar && api && api.bar) api.bar(bar);
    return api;
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
    _projects: function () { return PROJ.slice(); },
    // Test seam: a view's markup WITHOUT mounting it, so the suite can prove every table in this
    // file asks for the approved treatment by name rather than mounting eleven pages to find out.
    _markup: function (k) { return VIEWS[k] ? VIEWS[k].markup : ''; }
  };
})();
