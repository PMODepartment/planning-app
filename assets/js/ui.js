// ============================================================================
// Planners Dashboard — Shared UI helpers (UI)
// ----------------------------------------------------------------------------
// Toasts, the top user bar, and the shared sidebar shell. Modules call these so
// every screen looks and behaves consistently. Keep this dependency-free.
// ============================================================================

(function () {
  // ---- Toast ----
  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'pd-toast pd-toast-' + (type || 'info');
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 300);
    }, 3000);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- User bar (top-right): clickable avatar → dropdown with Sign out ----
  function renderUserBar(profile, mountId) {
    var mount = document.getElementById(mountId || 'user-bar');
    if (!mount || !profile) return;
    var label = profile.name || profile.email || 'U';
    var initials = label.trim().split(/\s+/).map(function (n) { return n[0]; }).join('').slice(0, 2).toUpperCase();

    // ⚠️ THE ACCOUNT MENU CARRIES THE SYSTEM DESTINATIONS, and it has to, because
    // it is the ONLY chrome that renders on every page. renderNav's 'project'
    // branch (dashboard.html, modules.html and every module page — i.e. where a
    // planner spends the whole day) deliberately shows only Dashboard + modules
    // since 2026-08-31, and home.html has no sidebar at all. That left Projects
    // and Admin reachable ONLY via the project dropdown's Portfolio row →
    // portfolio-overview → its sidebar, which reads as "switch project", not
    // "leave the project" — so in practice "+ Add project" and user management
    // became unreachable. Putting them here fixes all 20 pages from one place
    // and does NOT reinstate the Portfolio nav section the owner removed:
    // these are account/system destinations, not portfolio navigation.
    //
    // ⚠️ Admin is gated on `profile.role` HERE rather than on a flag passed by
    // the caller. 20 call sites would have to pass it, several are in modules
    // owned by other developers, and a half-applied gate is a menu that offers
    // Admin to a viewer on some pages and hides it from an admin on others.
    // admin.html is `requireAdmin`-gated and the DB enforces it regardless, so
    // this is an affordance, never the security boundary.
    var base = appBase();
    var isAdmin = ['admin', 'super_admin'].indexOf(profile.role) !== -1;
    function mIco(n) { return window.Icons ? Icons.svg(n, 16) : ''; }
    var links =
      '<a class="pd-usermenu-link" href="' + base + 'projects.html">' + mIco('grid') + 'Projects</a>' +
      // ⚠️ Super-admin-only "for now" (2026-09-03), same as the sidebar's Personal section
      // (renderNav) — this menu is the OTHER path to my-work.html (it renders on every page,
      // sidebar or not), so gating one without the other would still leave the page one click
      // away for everyone via the avatar.
      (profile.role === 'super_admin'
        ? '<a class="pd-usermenu-link" href="' + base + 'my-work.html">' + mIco('clipboard') + 'My Work</a>'
        : '') +
      (isAdmin
        ? '<a class="pd-usermenu-link" href="' + base + 'admin.html">' + mIco('settings') + 'Admin</a>'
        : '');

    mount.innerHTML =
      '<div class="pd-user">' +
        '<button class="pd-avatar" id="pd-avatar-btn" type="button" title="' + esc(label) + '" aria-label="Account menu">' + esc(initials) + '</button>' +
        '<div class="pd-usermenu" id="pd-usermenu">' +
          '<div class="pd-usermenu-head">' +
            '<div class="pd-usermenu-name">' + esc(label) + '</div>' +
            '<div class="pd-usermenu-role">' + esc((profile.role || '').replace(/_/g, ' ')) + '</div>' +
          '</div>' +
          '<div class="pd-usermenu-links">' + links + '</div>' +
          '<button class="pd-usermenu-signout" id="pd-signout" type="button">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
            'Sign out</button>' +
        '</div>' +
      '</div>';
    var btn = document.getElementById('pd-avatar-btn');
    var menu = document.getElementById('pd-usermenu');
    btn.onclick = function (e) { e.stopPropagation(); menu.classList.toggle('open'); };
    document.getElementById('pd-signout').onclick = function () { window.AppAuth.logout(); };
    document.addEventListener('click', function (e) {
      if (!menu.contains(e.target) && !btn.contains(e.target)) menu.classList.remove('open');
    });
  }

  // ---- Modal ----
  function modal(html, opts) {
    opts = opts || {};
    var overlay = document.createElement('div');
    overlay.className = 'pd-modal-overlay';
    overlay.innerHTML = '<div class="pd-modal">' + html + '</div>';
    document.body.appendChild(overlay);
    function close() { overlay.remove(); }
    if (!opts.noBackdropClose) {
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    }
    return { el: overlay, close: close };
  }

  // ---- Shared nav tree: Portfolio + Group-Head-labelled Projects ------------
  // ONE list-building function reused by three call sites — the per-module
  // project-select popover (enhanceProjectSelect, below), the shell-page
  // topbar switcher (renderSwitcher, below), and the standalone landing page
  // (home.html) — so "the same dropdown for navigating across portfolio and
  // projects" is literally true rather than three components that merely
  // look similar. Always fully expanded (no drill-down/breadcrumb): Portfolio
  // first (a real destination, not a project), then each Group Head as a
  // plain, non-clickable label with its projects indented beneath, then any
  // project with no group head in its own trailing bucket. A search box
  // flattens across every group.
  //
  // renderNavListInto(container, projects, groupHeads, opts) — opts:
  //   portfolioActive : bool   — highlight the Portfolio row as current
  //   isSelected(p)    : fn    — highlight this project row as current
  //   onPortfolio()    : fn    — called when the Portfolio row is picked
  //   onProject(p)     : fn    — called with the project object when picked
  // Returns { repaint(), focusSearch() }. Rebuilds `container`'s innerHTML on
  // every keystroke in its own search box — callers who need STATIC content
  // alongside the list (e.g. an "All projects" link) must mount their own
  // wrapper element for it, not rely on the list's own container.
  var NONE_GH = '__nogh__';   // bucket for projects with no group head
  function _ntIco(name, size) { return window.Icons ? Icons.svg(name, size) : ''; }
  function _ntByName(a, b) { return String(a.name || a.id).localeCompare(String(b.name || b.id)); }
  function navListBody(projects, groupHeads, opts) {
    opts = opts || {};
    var P = projects || [];
    // Owner (2026-09-03): "add project code before project name" — the project id IS
    // its code (the PK), so this needs no lookup, matching the same "CODE — Name"
    // convention the closed trigger button already uses (enhanceProjectSelect's
    // syncBtn / renderSwitcher's mainLabel) — a row here and the trigger it opens from
    // should read the same way. Wrapped in its own <strong> (bold, per the owner's
    // second ask) so it reads distinctly from the address/group-head subtitle below it,
    // which stays regular weight.
    function projRow(p) {
      var gh = p.group_head_id && (groupHeads || []).filter(function (g) { return g.id === p.group_head_id; })[0];
      /* ⚠ THE LABEL IS DROPPED, THE NAME IS NOT. Owner: *"remove the 'Group Head:' and just
         leave who the group head is"*. In a two-line project row the subtitle has room for the
         location AND a name, and "Group Head: " spent a third of it restating a column heading
         the reader already understands from context. The name is still there and still second. */
      var sub = [p.location, gh ? gh.name : ''].filter(Boolean).join(' · ');
      return '<div class="pd-nt-proj' + (opts.isSelected && opts.isSelected(p) ? ' sel' : '') + '" data-nt-proj="' + esc(p.id) + '">' +
        _ntIco('project', 14) + '<span class="pd-nt-proj-txt"><strong>' + esc(p.id + ' — ' + (p.name || p.id)) + '</strong>' +
        (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></div>';
    }
    // ⚠️ Same "Portfolio" + "every project you can see" wording as the closed
    // trigger (enhanceProjectSelect's syncBtn / renderSwitcher's mainLabel/
    // subLabel, above) — owner, 2026-09-16: "always use this type of dropdown
    // when portfolio is selected". The row you PICK Portfolio from should read
    // exactly like the state it puts you in, not merely share one word with it.
    var portfolioRow = '<div class="pd-nt-portfolio' + (opts.portfolioActive ? ' sel' : '') + '" data-nt-portfolio="1">' +
      _ntIco('barChart', 15) + '<span class="pd-nt-portfolio-txt"><strong>Portfolio</strong>' +
      '<small>every project you can see</small></span></div>';
    var q = (opts.search || '').trim().toLowerCase(), body;
    if (q) {
      var matches = P.filter(function (p) { return (p.name || '').toLowerCase().indexOf(q) !== -1 || (p.id || '').toLowerCase().indexOf(q) !== -1; }).sort(_ntByName);
      body = matches.length ? matches.map(projRow).join('') : '<div class="pd-nt-empty">No projects match “' + esc(opts.search) + '”.</div>';
    } else {
      var pm = {};
      P.forEach(function (p) { var k = p.group_head_id || NONE_GH; (pm[k] = pm[k] || []).push(p); });
      var sections = (groupHeads || []).slice().sort(function (a, b) {
        return (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(String(b.name));
      }).filter(function (g) { return (pm[g.id] || []).length; }).map(function (g) {
        return '<div class="pd-nt-ghlabel">' + esc(g.name) + '</div><div class="pd-nt-ghkids">' +
          (pm[g.id] || []).slice().sort(_ntByName).map(projRow).join('') + '</div>';
      }).join('');
      if ((pm[NONE_GH] || []).length) {
        sections += '<div class="pd-nt-ghlabel pd-nt-ghlabel-none">— No group head —</div><div class="pd-nt-ghkids">' +
          pm[NONE_GH].slice().sort(_ntByName).map(projRow).join('') + '</div>';
      }
      body = sections || '<div class="pd-nt-empty">No projects available.</div>';
    }
    return portfolioRow + '<div class="pd-nt-list">' + body + '</div>';
  }
  function renderNavListInto(container, projects, groupHeads, opts) {
    opts = opts || {};
    var search = '';
    // ⚠️⚠️ YOU COULD NOT TYPE A SPACE IN THIS BOX, and the cause was one .trim().
    // Reported 2026-09-02: *"i cannot add / type space in the search bar of the projects."*
    // Every keystroke used to rebuild the WHOLE container — search input included — and it
    // re-rendered that input with the TRIMMED query as its value. A space is only ever typed at the
    // END of what you have typed so far, so it was trailing whitespace at the instant it was
    // written, and the repaint deleted it before the next character arrived. "Test Project" could
    // never be typed; "TestProject" was all the box would hold. It looked like a blocked keystroke
    // and it was actually a value being rewritten underneath the caret.
    // TWO fixes, and the second is what makes the first stay fixed:
    //   1) the input keeps the RAW value — trimming is for the FILTER, never for the field;
    //   2) typing no longer re-renders the input at all. The search box is painted once and only
    //      the list body below it repaints, so there is no value to restore, no caret to put back,
    //      and no way for a repaint to edit what someone is typing. (The old code had to save and
    //      restore selectionStart precisely because it was destroying the live field.)
    function paintBody() {
      var host = container.querySelector('.pd-nt-body');
      if (!host) return;
      host.innerHTML = navListBody(projects, groupHeads, {
        search: search, portfolioActive: opts.portfolioActive, isSelected: opts.isSelected
      });
      var pf = host.querySelector('[data-nt-portfolio]');
      if (pf) pf.onclick = function (e) { e.stopPropagation(); if (opts.onPortfolio) opts.onPortfolio(); };
      host.querySelectorAll('[data-nt-proj]').forEach(function (r) {
        r.onclick = function (e) {
          e.stopPropagation();
          var id = r.dataset.ntProj;
          var p = (projects || []).filter(function (x) { return x.id === id; })[0] || { id: id };
          if (opts.onProject) opts.onProject(p);
        };
      });
      if (window.Icons) Icons.hydrate(host);
    }
    function paint() {
      container.innerHTML = '<div class="pd-nt-search"><input type="text" class="pd-nt-q" placeholder="Search all projects…"></div>' +
        '<div class="pd-nt-body"></div>';
      var qi = container.querySelector('.pd-nt-q');
      if (qi) {
        // ⚠️ Set as a PROPERTY, not as a value= attribute in the markup above: a query holding a
        // quote would otherwise have to be escaped into the HTML, and that escaping is the other
        // half of how a search box ends up editing what the user typed.
        qi.value = search;
        qi.oninput = function () { search = qi.value; paintBody(); };
      }
      paintBody();
    }
    paint();
    return {
      repaint: paint,
      focusSearch: function () { var qi = container.querySelector('.pd-nt-q'); if (qi) qi.focus(); }
    };
  }
  // Base path back to the app root — modules always live one folder deep
  // (modules/<key>/index.html), every shell page at the root itself.
  function appBase() { return location.pathname.indexOf('/modules/') !== -1 ? '../../' : ''; }

  // ---- Portfolio scope: every project id this planner can see ---------------
  // The one thing every module needs to consolidate its own data across the
  // portfolio: `PDb.getProjects()` is already RLS-scoped (an admin sees every
  // project, everyone else only their assignments), so "every project id" IS
  // "every project this call returns" — no second access rule to write.
  // Cached alongside the project-selector's own cache (same underlying read).
  async function allProjectIds() {
    if (!_pdProjCache) { try { _pdProjCache = await PDb.getProjects(); } catch (e) { _pdProjCache = []; } }
    return (_pdProjCache || []).map(function (p) { return p.id; });
  }
  // ---- Portfolio scope: a project's own row, by id ---------------------------
  // The companion read to allProjectIds() — a module consolidating across the
  // portfolio needs to know WHICH id is which, e.g. to group a list by project
  // (owner, 2026-09-16: "for consolidated data in portfolio, if in list group by
  // project"). Shares the exact same cache/read as allProjectIds() and the
  // project-selector popover, so a module's grouping can never name a project
  // differently from what the selector itself calls it.
  async function projectsById() {
    if (!_pdProjCache) { try { _pdProjCache = await PDb.getProjects(); } catch (e) { _pdProjCache = []; } }
    var map = {};
    (_pdProjCache || []).forEach(function (p) { map[p.id] = p; });
    return map;
  }

  // ---- Portfolio provenance: which project a consolidated row came from ----
  // In portfolio scope every module's list mixes rows from every project the
  // planner can see, and a row that does not say WHICH project it belongs to
  // cannot be acted on — the Meetings list rendered six rows all reading
  // "Meeting Aug 31, 2026" with nothing whatsoever to tell them apart.
  // Owner (2026-09-15): in a LIST, group by project; everywhere else, mark the
  // row with the project CODE.
  //
  // ⚠️⚠️ SHARED, BECAUSE FOUR MODULES CONSOLIDATE. minutes-of-meeting,
  // issues-lessons, contracts-claims and progress-photos each read across every
  // project, and four hand-rolled id→label lookups is precisely the drift this
  // repo has already paid for three times over (the location normaliser, the
  // S-curve maths copied into portfolio-overview, the change-order insert).
  // One cache, one label rule, one chip, one group header.
  //
  // ⚠️ THE PROJECT ID *IS* THE CODE — `projects.id` is text ('AVR101'), the PK,
  // which is why the code needs no lookup and is right on the very first paint.
  // Only the NAME is async (it rides the project-selector's own warm cache), so
  // a label asked for before that read lands degrades to the bare code rather
  // than to a blank cell or the word "undefined".
  function projectCode(id) { return id ? String(id) : ''; }
  function projectName(id) {
    var row = (_pdProjCache || []).filter(function (p) { return p.id === id; })[0];
    return row ? (row.name || '') : '';
  }
  function projectLabel(id) {
    var n = projectName(id);
    return n ? (projectCode(id) + ' — ' + n) : projectCode(id);
  }
  // The marker for a row that is NOT in a grouped list — a kanban card, a
  // calendar chip, a photo tile. ⚠️ The CODE alone, never "CODE — Name": these
  // sit inside dense furniture where the full label would be the longest thing
  // on the card. The name is still reachable, in the chip's own `title`.
  function projectTagHTML(id, opts) {
    if (!id) return '';
    opts = opts || {};
    // ⚠️ `opts.title` exists for a caller that already holds the project's name
    // from its OWN read — portfolio-dash.js does, and `PDb.getProjects()` is not
    // cached, so making it warm this file's cache instead would cost a second
    // network round trip for a string it already has.
    return '<span class="pd-projtag' + (opts.cls ? ' ' + esc(opts.cls) : '') + '" title="' +
      esc(opts.title || projectLabel(id)) + '">' + esc(projectCode(id)) + '</span>';
  }
  // Group rows for a LIST. Returns [{ id, code, name, label, rows }] ordered by
  // code, so one project sits in the same place on every module's screen.
  // ⚠️ A row carrying no project_id is NOT dropped — it gathers in a named
  // bucket at the end, because silently losing a row is worse than an ugly one.
  // ⚠️ ROW ORDER WITHIN A GROUP IS THE CALLER'S, UNTOUCHED. This regroups; it
  // never re-sorts, so a list the planner has sorted by date stays sorted by
  // date inside each project.
  function groupByProject(rows, getId) {
    var pick = getId || function (r) { return r && r.project_id; };
    var map = {}, order = [];
    (rows || []).forEach(function (r) {
      var id = pick(r) || '';
      if (!map[id]) { map[id] = []; order.push(id); }
      map[id].push(r);
    });
    order.sort(function (a, b) {
      if (!a !== !b) return a ? -1 : 1;                 // the no-project bucket last
      return String(a).localeCompare(String(b));
    });
    return order.map(function (id) {
      return {
        id: id, code: projectCode(id), name: projectName(id),
        label: id ? projectLabel(id) : 'No project recorded',
        rows: map[id]
      };
    });
  }
  // One header row for a grouped <table>. ⚠️ `colspan` is the CALLER'S own
  // column count — a <tr> narrower than the table it sits in draws a visible
  // notch down the side of every group.
  function projectGroupRowHTML(g, colspan) {
    // ⚠️⚠️ THE FLEX LIVES ON AN INNER <div>, NEVER ON THE <td>, AND ONLY
    // RENDERING FOUND THIS. `display:flex` on a table cell takes it out of the
    // table box model — the browser generates an anonymous cell around it and
    // DROPS `colspan` entirely. Measured: the band came out 342px wide inside a
    // 1398px table, a notch down the side of every group, while the markup and
    // the colspan attribute both looked perfectly correct in the source.
    return '<tr class="pd-projgrouprow"><td class="pd-projgroupcell" colspan="' + (colspan || 1) + '">' +
      '<div class="pd-projgroup">' +
        '<span class="pd-projgroup-code">' + esc(g.id ? g.code : g.label) + '</span>' +
        (g.id && g.name ? '<span class="pd-projgroup-name">' + esc(g.name) + '</span>' : '') +
        '<span class="pd-projgroup-n">' + g.rows.length + '</span>' +
      '</div></td></tr>';
  }

  // ---- Project selector (shared group-head browser) ------------------------
  // Upgrades a native project <select> into a button that opens the shared
  // nav tree above (Portfolio + Group-Head-grouped projects). The <select>
  // stays the source of truth (its value + change events still fire) for an
  // actual project pick, so existing `sel.onchange` handlers keep working;
  // picking "Portfolio" is a real navigation instead, since Portfolio is not
  // one of the select's options. The list is built from PDb.getProjects +
  // PDb.getGroupHeads, but FILTERED to the ids present in the select's
  // options — so any module-level access filtering already applied to the
  // options is respected. Safe to call again to refresh. The trigger button
  // copies the select's classes/inline style so each module's per-topbar look
  // carries.
  var _pdProjCache = null, _pdGhCache = null;   // per-page (one load), shared across instances
  function enhanceProjectSelect(sel) {
    if (!sel) return null;
    if (sel.__pdEnhanced) { sel.__pdEnhanced.refresh(); return sel.__pdEnhanced; }

    var wrap = document.createElement('div');
    wrap.className = 'pd-psel';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('pd-psel-native');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = (sel.className.replace('pd-psel-native', '').trim()) + ' pd-psel-btn';
    if (sel.getAttribute('style')) btn.setAttribute('style', sel.getAttribute('style'));
    if (sel.title) btn.title = sel.title;
    wrap.appendChild(btn);

    var pop = document.createElement('div');
    pop.className = 'pd-psel-pop';
    pop.hidden = true;
    wrap.appendChild(pop);

    var ghs = [], projs = [];

    function labelFor(v) {
      var o = Array.prototype.filter.call(sel.options, function (o) { return o.value === v; })[0];
      return o ? o.textContent : '';
    }
    // Subtitle: address + group head, resolved from the same cached
    // PDb.getProjects()/getGroupHeads() reads ensureData() already populates.
    // Blank until that resolves — unlike the code/name (below), there's no
    // synchronous source for either field, so the button's second line fills
    // in a beat after first paint rather than blocking it.
    function subFor(v) {
      var row = (projs || []).filter(function (p) { return p.id === v; })[0];
      if (!row) return '';
      var gh = row.group_head_id && (ghs || []).filter(function (g) { return g.id === row.group_head_id; })[0];
      return [row.location, gh ? gh.name : ''].filter(Boolean).join(' · ');
    }
    function syncBtn() {
      // ⚠️⚠️ PORTFOLIO ALWAYS WINS OVER `sel.value`. A module opened from the
      // Portfolio sidebar carries `#pd_scope=portfolio`, but `pd_project`
      // sessionStorage is a SEPARATE, app-wide key that usually still holds
      // whatever project the planner was last looking at — so reading
      // `sel.value` here would silently show that stale project's real name
      // instead of "Portfolio", which is the reported bug this exists to fix.
      if (window.AppAuth && AppAuth.isPortfolioScope()) {
        btn.innerHTML = '<span class="pd-psel-txt pd-psel-portfolio"><strong>Portfolio</strong>' +
          '<small>every project you can see</small></span>' +
          '<span class="pd-psel-caret" data-ico="chevronDown" data-ico-size="14"></span>';
        if (window.Icons) Icons.hydrate(btn);
        return;
      }
      var t = labelFor(sel.value), ph = !t;
      // The project id IS its code (the PK) — "CODE — Name" needs no async
      // lookup, sel.value already carries it synchronously.
      var txt = t ? (sel.value + ' — ' + t) : (sel.options[0] ? sel.options[0].textContent : 'Select…');
      var sub = t ? subFor(sel.value) : '';
      btn.innerHTML = '<span class="pd-psel-txt' + (ph ? ' pd-psel-ph' : '') + '"><strong>' + esc(txt) + '</strong>' +
        (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
        '<span class="pd-psel-caret" data-ico="chevronDown" data-ico-size="14"></span>';
      if (window.Icons) Icons.hydrate(btn);
    }
    function choose(id) {
      if (id !== sel.value) { sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      syncBtn(); close();
    }
    function currentProjects() {
      var ids = {};
      Array.prototype.forEach.call(sel.options, function (o) { if (o.value) ids[o.value] = 1; });
      return projs.filter(function (p) { return ids[p.id]; });
    }
    function paintPop() {
      renderNavListInto(pop, currentProjects(), ghs, {
        portfolioActive: window.AppAuth && AppAuth.isPortfolioScope(),
        isSelected: function (p) { return !((window.AppAuth && AppAuth.isPortfolioScope())) && p.id === sel.value; },
        onPortfolio: function () { location.href = appBase() + 'modules/portfolio-overview/index.html'; },
        onProject: function (p) {
          // Picking a REAL project out of the popover is the one place
          // Portfolio scope is left again — clear it before the module's own
          // sel.onchange handler (unchanged) writes the new pd_project and
          // re-renders, so that re-render already sees itself out of scope.
          if (window.AppAuth && AppAuth.isPortfolioScope()) AppAuth.setPortfolioScope(false);
          choose(p.id);
        }
      });
    }
    async function ensureData() {
      if (!_pdProjCache) { try { _pdProjCache = await PDb.getProjects(); } catch (e) { _pdProjCache = []; } }
      if (!_pdGhCache) { try { _pdGhCache = await PDb.getGroupHeads(); } catch (e) { _pdGhCache = []; } }
    }
    async function open() {
      pop.hidden = false; wrap.classList.add('open');
      if (!projs.length) pop.innerHTML = '<div class="pd-nt-empty">Loading…</div>';
      await ensureData(); projs = _pdProjCache || []; ghs = _pdGhCache || [];
      paintPop();
      var qi = pop.querySelector('.pd-nt-q'); if (qi) setTimeout(function () { qi.focus(); }, 0);
    }
    function close() { pop.hidden = true; wrap.classList.remove('open'); }

    btn.onclick = function (e) { e.stopPropagation(); if (pop.hidden) open(); else close(); };
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) { close(); btn.focus(); } });
    sel.addEventListener('change', syncBtn);   // stay in sync on programmatic value changes

    var api = { refresh: function () { syncBtn(); if (!pop.hidden) paintPop(); }, close: close };
    sel.__pdEnhanced = api;
    syncBtn();
    // Warm the project/group-head cache in the BACKGROUND — not gated behind
    // the popover's own open() — so the subtitle fills in without requiring a
    // click. open() awaits the same cache and just finds it already warm.
    ensureData().then(function () { projs = _pdProjCache || []; ghs = _pdGhCache || []; syncBtn(); });
    return api;
  }

  // ---- Mode-aware sidebar nav + top-bar context switcher --------------------
  // The shell used to show BOTH the Portfolio group and the Project group in
  // the sidebar at once, all the time — and switching projects only lived on
  // dashboard.html's own bespoke topbar control. Both are replaced by ONE
  // pair of shared renderers so every shell page (dashboard/projects/modules/
  // admin/my-work/portfolio-overview) behaves identically:
  //   UI.renderNav(navEl, mode, ctx)      — sidebar contents for the mode
  //   UI.renderSwitcher(mountEl, opts)    — topbar "Portfolio ▾ / <Project> ▾"
  // `mode` is never a separately-persisted flag — it is simply which of the
  // two page families you are on, so it can never desync from what the page
  // actually shows. 'portfolio' = projects.html / admin.html / my-work.html /
  // portfolio-overview. 'project' = dashboard.html / modules.html.
  function renderNav(navEl, mode, ctx) {
    if (!navEl) return;
    ctx = ctx || {};
    var base = ctx.base || '';
    var active = ctx.active || '';
    function cls(key) { return active === key ? ' class="active"' : ''; }
    // ⚠️ Read straight off the globals `requireLogin` already set, rather than a ctx flag every
    // one of the 15+ call sites would otherwise have to be taught to pass — see config.js's
    // `superAdminOnly` comment. `!!` guards a page that renders nav before auth resolves (none do
    // today, but a false positive here would show every super-admin-only link to a stranger).
    var superAdmin = !!window.__role && window.__role === 'super_admin';
    // ⚠️ `AppAuth.moduleVisible` (2026-09-15) is the ONE gate — role default plus the per-user
    // override from admin.html's Modules editor — shared with ModulesGrid.visible() so the
    // sidebar and the launcher/dashboard tile grid cannot disagree about a module.
    function visible(m) {
      return window.AppAuth ? AppAuth.moduleVisible(m, window.__profile) : (!m.superAdminOnly || superAdmin);
    }
    var html;
    if (mode === 'portfolio') {
      // Three scopes, per the owner's own structure: PORTFOLIO (every project's data,
      // consolidated — Projects, the Portfolio Dashboard, then every module a project can
      // carry, each opening READ-ONLY, consolidated across every project), PERSONAL (this
      // signed-in user's own work, not scoped to any one project), SYSTEM (Admin, gated).
      // (No "Home" link here — home.html is the landing/picker screen itself, not a
      // destination to navigate back to from inside the app.)
      /* ⚠️⚠️ CACHE-BUSTED, WHICH IT HAS NEVER BEEN. `portfolio-overview` is not in
         `APP_CONFIG.MODULES` — it is a standalone page — so `pmodRow`'s `ModulesGrid.href(m)`
         never reached it, and every sidebar link here was a bare `index.html`. A browser caches
         a page by its full URL, so each of this page's rebuilds has needed a hard refresh, which
         that module's own log has had to record as a caveat more than once. `MODULE_V` is
         exported for exactly this; it is the same token every module page is stamped with, so
         one deploy busts them together. ⚠️ Falls back to the bare path when `modules-grid.js`
         is absent, rather than linking to a version string that does not exist. */
      var poBase = base + 'modules/portfolio-overview/index.html' +
        (window.ModulesGrid && ModulesGrid.MODULE_V ? '?v=' + encodeURIComponent(ModulesGrid.MODULE_V) : '');
      // ctx.modules is optional — every project-mode page already passes it (it built the
      // module grid), but the five portfolio-mode pages never needed to before now. Default
      // to the shared registry rather than requiring five call sites to be updated.
      var pmods = (ctx.modules || (window.APP_CONFIG && APP_CONFIG.MODULES) || []).filter(function (m) { return m.enabled && visible(m); });
      // ⚠️ Pormac renders before BOTH dashboard links, as the very first row —
      // owner's call (2026-09-12), same reason as the project-mode branch below.
      var pPormac = pmods.filter(function (m) { return m.key === 'pormac'; })[0];
      pmods = pmods.filter(function (m) { return m.key !== 'pormac'; });
      // ⚠️⚠️ EVERY MODULE'S OWN PAGE NOW OPENS FROM HERE — `PORTFOLIO_TAB`'s
      // redirect to a portfolio-overview TAB is gone (2026-09-14). It used to
      // send 11 of 12 modules to a hand-built, separately-styled dashboard
      // duplicating that module's own aggregation logic per table, which read
      // as "click Risk Register, land on a different screen called Portfolio
      // Dashboard" — confusing, and a maintenance burden of its own (each
      // table's `.in('project_id', ids)` re-implemented by hand a second
      // time). `#pd_scope=portfolio` is read once by `AppAuth` (auth.js) into
      // a per-tab sessionStorage flag; every module now reads
      // `AppAuth.isPortfolioScope()` itself and both (a) shows "Portfolio" in
      // its own project selector (UI.enhanceProjectSelect, automatic) and
      // (b) queries across every project it can see instead of one, with
      // writes refused at the shared Supabase-client chokepoint (see
      // auth.js). `portfolio-overview` itself is unaffected — its own
      // "Dashboard" row below still opens it directly, as a destination in
      // its own right, not as a stand-in for every other module.
      function pmodRow(m) {
        var href = (window.ModulesGrid ? base + ModulesGrid.href(m) : base + m.path) + '#pd_scope=portfolio';
        return '<a href="' + href + '" title="' + esc(m.name) + ' — portfolio-wide, read-only">' +
          '<span class="pd-navico" data-ico="' + esc(m.icon) + '"></span><span class="pd-navtxt">' + esc(m.name) + '</span></a>';
      }
      html = '<div class="pd-navsec">Portfolio</div>' +
        '<a href="' + base + 'projects.html"' + cls('projects') + ' title="Projects">' +
          '<span class="pd-navico" data-ico="grid"></span><span class="pd-navtxt">Projects</span></a>' +
        (pPormac ? pmodRow(pPormac) : '') +
        /* ⚠️⚠️ NOT `barChart`, AND NOT BECAUSE IT READS BADLY — because Productivity Rates, eight
           rows below, is `barChart` too. Measured by rendering this nav and grouping the rows by
           the geometry each icon actually DRAWS: three pairs collided (Dashboard/Productivity
           Rates, Milestones/Meetings, Issues/My Work). ⚠️ In a COLLAPSED rail the label is
           `font-size:0`, so the glyph is the only thing left and two rows become
           indistinguishable — the defect class this repo has already paid for twice in the
           Project Schedule's toolbar (ps-lsmbtn/ps-outlinebtn, ps-progressbtn/ps-flowbtn).
           ⚠️ The three rows changed are the three that exist ONLY here. A module's icon is its
           identity in the project sidebar and the module grid as well, so moving one to settle a
           collision in this nav would change two other screens to fix neither. */
        '<a href="' + poBase + '"' + cls('portfolio-dashboard') + ' title="Portfolio Dashboard">' +
          '<span class="pd-navico" data-ico="layout"></span><span class="pd-navtxt">Dashboard</span></a>' +
        // ⚠️ MILESTONES WAS A ROW HERE AND IS GONE — owner, 2026-09-16: *"There is a
        //    milestones tab in the side panel for portfolio view. Let's remove this since
        //    milestones are already seen within the schedule."*
        // ⚠️⚠️ THIS IS A NAMED REVERSAL OF 2026-09-09 (p3), AND THE REASON THAT ROW EXISTED
        //    NO LONGER HOLDS. It was added because Milestones has no module — `pmods` below
        //    cannot produce it — so when the in-page tab strip was removed it would have been
        //    left with NO entry point at all. The strip came back on 2026-09-15 (u) as the
        //    view switcher (`.po-tabs` → UI.tabsToDropdown), and `data-view="milestones"` is
        //    one of its buttons — checked, not assumed. So the view is still reachable from
        //    the Portfolio Dashboard itself; only the duplicate sidebar row is gone.
        // ⚠️ `poHref()` went with it: this was its only caller, and a helper left behind with
        //    no reader is the dead-export shape `tools/dead-exports.js` exists to catch.
        //    `poBase` stays — the Dashboard row above still uses it.
        pmods.map(pmodRow).join('') +
        // ⚠️ Personal (My Work / Tasks) is super-admin-only "for now" too (2026-09-03,
        // same owner ask as the module hiding above) — gated the same way, off the global
        // role rather than a new ctx flag.
        (superAdmin
          ? '<div class="pd-navsec">Personal</div>' +
            /* ⚠️⚠️ "My Work", NOT "Dashboard" — owner 2026-09-15: *"Personal 'Dashboard' shouldn't
               be called dashboard."* The sharper problem was that this sidebar rendered TWO rows
               both reading "Dashboard" (Portfolio → Dashboard, ten lines above, and this one), so
               the label did not distinguish the two things it was on screen to distinguish.
               ⚠️ "My Work" is not a new word: the avatar menu has linked this page as "My Work"
                  since it was built (see renderUserBar), the file is `my-work.html`, the module is
                  `MyWork` and the script is `my-work.js`. The app already called it this
                  everywhere except the one place the planner reads.
               ⚠️ THE KEY `personal-dashboard` IS DELIBERATELY UNCHANGED. It is an identifier passed
                  by my-work.html to `cls()`, not text anyone sees, and renaming an identifier to
                  match a label is how a two-place change becomes a silent mismatch. Same call the
                  Manpower/Equipment rename made when `data-view="loading"` stayed put while the
                  tab became "Overview". */
            /* ⚠️ `user`, not `clipboard` — Issues and Concerns carries the clipboard, and this row
               is about ONE person's own work, which is exactly what separates `user` (one figure)
               from Manpower Loading's `users` (a group). */
            '<a href="' + base + 'my-work.html"' + cls('personal-dashboard') + ' title="My Work">' +
              '<span class="pd-navico" data-ico="user"></span><span class="pd-navtxt">My Work</span></a>' +
            '<a href="' + base + 'my-tasks.html"' + cls('my-tasks') + ' title="Tasks">' +
              '<span class="pd-navico" data-ico="check"></span><span class="pd-navtxt">Tasks</span></a>'
          : '') +
        (ctx.isAdmin
          ? '<div class="pd-navsec">System</div>' +
            /* ⚠️ "Users", NOT "Admin" — owner 2026-09-15: *"for admin keep only user
               management and rename to Users."* admin.html dropped its Projects tab the
               same change (projects.html already owns that, group heads included), so
               the page is user management now and the label says so.
               ⚠️ THE KEY `admin` IS DELIBERATELY UNCHANGED — same call as the My Work
               row's `personal-dashboard` key just above: `cls('admin')` here and the
               `active: 'admin'` admin.html itself passes to renderNav must keep matching
               each other, and the filename/href stays `admin.html` so nothing that
               already links here breaks. Only the visible word moved. */
            '<a href="' + base + 'admin.html"' + cls('admin') + ' title="Users">' +
              '<span class="pd-navico" data-ico="settings"></span><span class="pd-navtxt">Users</span></a>'
          : '');
    } else {
      var mods = (ctx.modules || []).filter(function (m) { return m.enabled && visible(m); });
      // No "Portfolio" section here (owner's call, 2026-08-31) — the shared
      // project dropdown (UI.enhanceProjectSelect) already offers a Portfolio
      // row, so a project's own sidebar stays scoped to that project.
      //
      // ⚠️ "Meetings" is no longer a hardcoded nav entry deep-linking into
      // issues-lessons — Minutes of Meeting split out into its own real
      // module (`minutes-of-meeting`), so it now flows through mods.map()
      // below like every other module; config.js's MODULES order is what
      // puts it first, right after Dashboard.
      //
      // ⚠️ Pormac is pulled out and rendered BEFORE the Dashboard link — the
      // one exception to "config.js's order is the nav order" (owner's call,
      // 2026-09-12): it is the very first row in the sidebar, above Dashboard,
      // not merely first among modules.
      function modRow(m) {
        var href = window.ModulesGrid ? base + ModulesGrid.href(m) : base + m.path;
        return '<a href="' + href + '"' + cls(m.key) + ' title="' + esc(m.name) + '">' +
          '<span class="pd-navico" data-ico="' + esc(m.icon) + '"></span><span class="pd-navtxt">' + esc(m.name) + '</span></a>';
      }
      var pormacMod = mods.filter(function (m) { return m.key === 'pormac'; })[0];
      mods = mods.filter(function (m) { return m.key !== 'pormac'; });
      html = '<div class="pd-navsec">Project</div>' +
        (pormacMod ? modRow(pormacMod) : '') +
        /* ⚠️ In PORTFOLIO scope this row must not point at the project dashboard. A module
           page always renders this nav under mode:'project' (see the note at the top of this
           function), so without this the Dashboard row led out of the portfolio and into
           whichever project `pd_project` last held. dashboard.html guards itself as well; this
           is what stops the redirect ever being seen. */
        '<a href="' + (window.AppAuth && AppAuth.isPortfolioScope()
            ? base + 'modules/portfolio-overview/index.html' +
              (window.ModulesGrid && ModulesGrid.MODULE_V ? '?v=' + encodeURIComponent(ModulesGrid.MODULE_V) : '')
            : base + 'dashboard.html') + '"' + cls('dashboard') + ' title="Dashboard">' +
          '<span class="pd-navico" data-ico="home"></span><span class="pd-navtxt">Dashboard</span></a>' +
        mods.map(modRow).join('');
    }
    navEl.innerHTML = html;
    if (window.Icons) Icons.hydrate(navEl);
  }

  // Shared cache for both the project selector and the switcher below — one
  // load per page, not one per instance.
  var _pdSwProj = null, _pdSwGh = null;
  async function ensureSwitcherData() {
    if (!_pdSwProj) { try { _pdSwProj = await PDb.getProjects(); } catch (e) { _pdSwProj = []; } }
    if (!_pdSwGh) { try { _pdSwGh = await PDb.getGroupHeads(); } catch (e) { _pdSwGh = []; } }
  }

  function renderSwitcher(mount, opts) {
    if (!mount) return;
    opts = opts || {};
    var base = opts.base || '';
    var mode = opts.mode || 'project';
    var pid = opts.pid || null;

    mount.classList.add('pd-projsw');
    // Code before name (the project id IS the code, no lookup needed) — a
    // caller carrying both synchronously (every call site already has pid+
    // pname before this runs) gets it for free.
    var mainLabel = mode === 'portfolio' ? 'Portfolio'
      : (pid && opts.pname ? pid + ' — ' + opts.pname : (opts.pname || 'Select a project'));
    // ⚠️⚠️ PORTFOLIO'S SUBTITLE IS FIXED TEXT, MATCHING enhanceProjectSelect's OWN
    // portfolio-scope trigger VERBATIM (owner, 2026-09-16: "always use this type of
    // dropdown when portfolio is selected"). Before this, this shell-page topbar
    // switcher showed a bare "Portfolio" with no subtitle at all while the
    // per-module project selector (enhanceProjectSelect, above) showed "Portfolio"
    // over "every project you can see" — two different readings of the same state,
    // depending only on which of the two selector components a given page happens
    // to use. `opts.ghLabel` still wins outside Portfolio mode (a project's own
    // address/group-head subtitle, or its async-fetched placeholder).
    var subLabel = mode === 'portfolio' ? 'every project you can see' : opts.ghLabel;
    mount.innerHTML =
      '<button class="pd-projsw-btn" type="button">' +
        '<span class="pd-projsw-ic" data-ico="' + (mode === 'portfolio' ? 'barChart' : 'project') + '" data-ico-size="16"></span>' +
        '<span class="pd-projsw-txt"><strong>' + esc(mainLabel) + '</strong>' +
          (subLabel ? '<small>' + esc(subLabel) + '</small>' : '<small class="pd-projsw-sub"></small>') + '</span>' +
        '<span class="pd-projsw-caret" data-ico="chevronDown" data-ico-size="13"></span>' +
      '</button>' +
      '<div class="pd-projsw-menu"></div>';
    if (window.Icons) Icons.hydrate(mount);

    // Subtitle: address + group head, resolved from the same cached
    // PDb.getProjects()/getGroupHeads() reads the menu itself uses below —
    // never gated behind actually opening the menu. opts.ghLabel (an explicit
    // override a couple of callers already pass) always wins and is left
    // untouched — the placeholder above is only rendered when it's absent.
    if (!opts.ghLabel && mode === 'project' && pid) {
      ensureSwitcherData().then(function () {
        var sub = mount.querySelector('.pd-projsw-sub');
        if (!sub) return;   // this switcher was re-rendered before the fetch resolved
        var row = (_pdSwProj || []).filter(function (p) { return p.id === pid; })[0];
        if (!row) return;
        var gh = row.group_head_id && (_pdSwGh || []).filter(function (g) { return g.id === row.group_head_id; })[0];
        sub.textContent = [row.location, gh ? gh.name : ''].filter(Boolean).join(' · ');
      });
    }

    var btn = mount.querySelector('.pd-projsw-btn');
    var menu = mount.querySelector('.pd-projsw-menu');
    function close() { menu.classList.remove('open'); }
    // Static shell (a mount div for the shared list body + a fixed "All
    // projects" link below it) so repainting the list on every search
    // keystroke never wipes out the link — see UI.renderNavListInto.
    menu.innerHTML = '<div class="pd-nt-mount"></div>' +
      '<a class="pd-projsw-all" href="' + base + 'projects.html">' + (window.Icons ? Icons.svg('arrowRight', 15) : '') + ' All projects / selector</a>';
    if (window.Icons) Icons.hydrate(menu);
    var ntMount = menu.querySelector('.pd-nt-mount');
    function renderMenu() {
      renderNavListInto(ntMount, _pdSwProj || [], _pdSwGh || [], {
        portfolioActive: mode === 'portfolio',
        isSelected: function (p) { return p.id === pid; },
        // Opening Portfolio lands on the Portfolio Dashboard now, not the
        // Projects list — the Projects list is still one click away (the
        // 'All projects / selector' link below), it's just no longer default.
        onPortfolio: function () { location.href = base + 'modules/portfolio-overview/index.html'; },
        onProject: function (p) {
          sessionStorage.setItem('pd_project', p.id);
          sessionStorage.setItem('pd_project_name', p.name || p.id);
          sessionStorage.setItem('pd_group_head', p.group_head_id || '');
          // ⚠️ A package belongs to the OLD project — carrying it across would
          // scope the shell to a package this project does not contain.
          sessionStorage.removeItem('pd_package');
          sessionStorage.removeItem('pd_package_name');
          location.href = base + 'dashboard.html';
        }
      });
    }
    async function open() {
      ntMount.innerHTML = '<div class="pd-nt-empty">Loading&hellip;</div>';
      menu.classList.add('open');
      await ensureSwitcherData();
      renderMenu();
    }
    btn.onclick = function (e) { e.stopPropagation(); menu.classList.contains('open') ? close() : open(); };
    document.addEventListener('click', function (e) { if (!mount.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  // ---- Collapsible sidebar / mobile drawer ----
  // Auto-injects a hamburger toggle into the topbar of any shell page (a page
  // with both .pd-sidebar and .pd-topbar).
  //   Desktop (>820px): collapses the sidebar to a slim icon rail (persisted).
  //   Mobile  (≤820px): the sidebar is an off-canvas DRAWER — it slides over the
  //                     content behind a scrim, locks background scroll, and
  //                     dismisses on scrim tap / nav tap / Escape.
  // The 820px breakpoint must stay in sync with the drawer media query in
  // dashboard.css. Mobile state is deliberately NOT persisted: a drawer that
  // reopens itself on every page load would cover the content each time.
  var MOBILE_Q = '(max-width: 820px)';
  function isMobile() { return window.matchMedia(MOBILE_Q).matches; }

  function initShell() {
    var app = document.querySelector('.pd-app');
    var sidebar = document.querySelector('.pd-sidebar');
    var topbar = document.querySelector('.pd-topbar');
    if (!app || !sidebar || !topbar) return;
    if (topbar.querySelector('.pd-sidebar-toggle')) return;

    // Default to collapsed for a clean entry; only an explicit '0' keeps it open.
    // (On mobile the CSS re-expands the drawer — .pd-collapsed must not turn the
    // drawer into a label-less 64px rail.)
    if (localStorage.getItem('pd_sidebar_collapsed') !== '0') app.classList.add('pd-collapsed');

    var scrim = document.querySelector('.pd-scrim');
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.className = 'pd-scrim';
      document.body.appendChild(scrim);
    }

    function openDrawer(on) {
      sidebar.classList.toggle('open', on);
      scrim.classList.toggle('open', on);
      document.body.classList.toggle('pd-noscroll', on);
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    function closeDrawer() { openDrawer(false); }

    var btn = document.createElement('button');
    btn.className = 'pd-sidebar-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle menu');
    btn.setAttribute('aria-controls', sidebar.id || 'pd-sidebar');
    btn.setAttribute('aria-expanded', 'false');
    if (!sidebar.id) sidebar.id = 'pd-sidebar';
    btn.innerHTML = '<span></span><span></span><span></span>';
    btn.onclick = function () {
      if (isMobile()) {
        openDrawer(!sidebar.classList.contains('open'));
      } else {
        app.classList.toggle('pd-collapsed');
        localStorage.setItem('pd_sidebar_collapsed', app.classList.contains('pd-collapsed') ? '1' : '0');
      }
    };
    topbar.insertBefore(btn, topbar.firstChild);

    scrim.addEventListener('click', closeDrawer);
    // Tapping a nav link navigates; close so the drawer isn't left open behind
    // the next page's paint (and for same-page anchors, so content is visible).
    sidebar.addEventListener('click', function (e) {
      if (isMobile() && e.target.closest('a')) closeDrawer();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) closeDrawer();
    });
    // Rotating a tablet from portrait to landscape can cross the breakpoint with
    // the drawer open — it would otherwise stay "open" as a docked sidebar with
    // the scrim and the body scroll lock still applied.
    window.addEventListener('resize', function () {
      if (!isMobile() && sidebar.classList.contains('open')) closeDrawer();
    });
  }

  // ---- Module topbar: pure app chrome, everything else moves below it ------
  // Every topbar used to carry a module's own identity (icon + title) and its
  // controls (view tabs, action buttons) alongside the app-wide chrome. It is
  // now down to exactly four things, identical on every page: the sidebar
  // toggle, the shared project/portfolio dropdown, the theme toggle, and the
  // avatar. EVERYTHING ELSE a page had in its topbar — a module's icon+title,
  // its tabs, its tool cluster, a shell page's own bare title — is pulled out
  // into a NEW SIBLING element, `.pd-modulebar`, inserted directly below the
  // topbar (as a sibling in `.pd-content`, not nested inside it).
  //
  // ⚠️ No back button is ever bucketed here — the browser's own Back covers
  // it, and every module markup has had its `-modback` anchor removed.
  //
  // Safe because no CSS anywhere targets topbar children with a DIRECT-child
  // combinator (`.pd-topbar > x`) — every module rule is a descendant selector.
  // Check before adding one.
  function initModuleTopbar() {
    var topbar = document.querySelector('.pd-topbar');
    if (!topbar || topbar.querySelector(':scope > .pd-tb-main')) return;

    var kids = Array.prototype.slice.call(topbar.children);
    if (!kids.length) return;

    var main = document.createElement('div');
    main.className = 'pd-tb-main';
    var below = document.createElement('div');
    below.className = 'pd-modulebar';

    kids.forEach(function (el, i) {
      var isLead = i === 0 && el.classList.contains('pd-sidebar-toggle');
      var isAccount = el.id === 'user-bar' || el.id === 'pd-theme-toggle';
      var isProjCtx = /-projctx$/.test(el.className || '') ||
                      el.id === 'ctx-switcher' || /(^|\s)pd-projsw(\s|$)/.test(el.className || '');
      // Everything that is not one of the four fixed chrome controls above —
      // a module's mark/icon, its <h1> (or a title-switch button like Project
      // Schedule's), its tab strip, its tool cluster, presence dots, a shell
      // page's bare title — moves below, together, in its original order.
      (isLead || isAccount || isProjCtx ? main : below).appendChild(el);
    });

    // ⚠️ REVERTED (owner ask, 2026-09-04): the 2026-09-02 pass here used to
    // pull a module's own icon glyph out of `below` and pair it with the
    // project dropdown in `main` (the top identity row) — "no module logo is
    // allowed in this top bar across all modules." The top row is back to
    // being exactly the four fixed chrome controls the block comment above
    // this function describes; a module's own icon simply stays wherever it
    // already sits inside `below` (its <h1>, or a title-switch button like
    // Project Schedule's), which lands it in `.pd-modulebar` below — see the
    // module bar's own CSS for how it renders beside a tabs strip / dropdown
    // there instead.

    topbar.appendChild(main);
    // Marks the topbar as restructured. The CSS keys off THIS class, never off
    // `.pd-topbar` alone — the column layout assumes `.pd-tb-main` exists.
    topbar.classList.add('pd-tb-split');
    if (below.children.length) topbar.parentNode.insertBefore(below, topbar.nextSibling);
  }

  // ---- Item 6: a tab strip rendered as a Project-Schedule-style dropdown ---
  // Converts an existing flat row of tab <button>s (a module's own `.xx-tabs`
  // strip) into a single trigger button + menu, matching the pattern Project
  // Schedule already used for its own view switch. The original buttons stay
  // in the DOM — still what the module's own click handlers/state management
  // are wired to — just hidden (`.pd-tabsdrop-src`); picking a menu item
  // simply clicks the corresponding real button, so no module JS needs to
  // change to adopt this. Call once per tab strip, after it is populated.
  // opts.icon (2026-09-04, owner ask — supersedes the 2026-09-03 approach of
  // baking it into `trig.innerHTML`): the module identity icon is a SEPARATE
  // element immediately to the LEFT of the trigger, not fused inside the
  // button — "keep this logo... but do not include this inside the dropdown
  // selector. keep it to the left of it as a separate icon." It is still a
  // child of `.pd-tabsdrop` (a sibling of the trigger, not of
  // `.pd-modulebar`'s own top-level children), which is what avoids the
  // mobile problem the 2026-09-03 comment was written to solve: on a phone
  // `.pd-tabsdrop` itself takes the whole row (dashboard.css, ≤700px), so the
  // icon rides along with the trigger on that one row rather than becoming an
  // orphaned icon-only row of its own — the same outcome, reached by nesting
  // it inside the trigger's own flex unit instead of by fusing it into the
  // button.
  function tabsToDropdown(selOrEl, opts) {
    var tabs = typeof selOrEl === 'string' ? document.querySelector(selOrEl) : selOrEl;
    if (!tabs || tabs.__pdTabsDrop) return;
    var btns = Array.prototype.slice.call(tabs.querySelectorAll('button'));
    if (btns.length < 2) return;
    tabs.__pdTabsDrop = true;
    tabs.classList.add('pd-tabsdrop-src');

    // ⚠️ The dropdown trigger built below already names the current screen (see
    // sync()'s `trig.innerHTML`), so a module's own static/dynamic title TEXT
    // sitting beside it is a duplicate label — "Dashboard" next to a trigger
    // also reading "Dashboard ▾". Only a CLASS is added here; dashboard.css
    // decides WHEN to actually hide it (`.pd-title-hasdrop`, min-width:701px) —
    // never unconditionally in JS. Two reasons:
    // 1. By the time this runs, initModuleTopbar() (bound to DOMContentLoaded,
    //    so it always runs first) has already moved this tab strip OUT of
    //    `.pd-topbar` and into the sibling `.pd-modulebar` bar alongside the
    //    module's own <h1> — `tabs.closest('.pd-topbar')` finds nothing at this
    //    point; `.closest('.pd-modulebar')` is the shared ancestor now.
    // 2. Below 700px `.pd-modulebar > h1` is forced onto its OWN full-width row
    //    (dashboard.css's ≤700px stacking rule), with the dropdown trigger on
    //    the row after it — hiding the title text there leaves a bare icon on
    //    one line and the trigger's label on the next, exactly the "icon
    //    alone / label on the next line" defect this app's own history
    //    (issues-lessons/module.css, "REMOVED 2026-08-31") already fixed once
    //    and says not to reintroduce. A width-gated CSS rule can't recreate it;
    //    an unconditional JS hide can and did.
    var modBar = tabs.closest('.pd-modulebar');
    var titleTxt = modBar && modBar.querySelector('[class$="-title-txt"]');
    if (titleTxt) {
      titleTxt.classList.add('pd-title-hasdrop');
      // Item 1 (2026-09-01, mobile round): below 700px, hiding just the TEXT
      // (note above) still reserves a whole full-width row for the now-empty-
      // but-for-its-icon <h1> — a bare icon sitting alone on its own line,
      // which is a materially different shape from the "icon alone / label on
      // the next line" defect that comment warns about (there the icon had a
      // row and the trigger's label sat on the NEXT row; the reported bug here
      // was the FULL duplicate text, not a bare icon). Marking the <h1> itself
      // lets dashboard.css remove that row entirely below 700px, so there is
      // no separate icon row left to be "alone" — see `.pd-h1-hasdrop`.
      var h1 = titleTxt.closest('h1');
      if (h1) h1.classList.add('pd-h1-hasdrop');
      /* ⚠⚠ AN ICON-CARRYING TRIGGER MAKES THE WHOLE <h1> REDUNDANT, NOT JUST ITS TEXT — AND
         THIS IS THE "DUPLICATED LOGO" THE OWNER REPORTED ON ISSUES & CONCERNS (2026-09-16).
         `.pd-title-hasdrop` hides the title TEXT above 700px, on the reasoning that the trigger
         already names the screen. True — but when the caller also passes `opts.icon` the trigger
         names the screen AND carries the module's mark, so what is left of the <h1> is a second
         copy of that same mark sitting beside it: two clipboards, then "Issues & Concerns ▾".
         Issues had been papering over this in its own JS (switchScreen() sets the <h1> to
         `display:none` on every screen), which is why it only ever showed where switchScreen does
         not run — the portfolio view, and the moment before auth resolves on a normal load.
         ⚠ Hiding the WHOLE element is the safe shape, and deliberately so: hiding the text alone
         is what once left "an icon alone on a line" with the trigger's label on the next, a defect
         this repo fixed once and its own comments forbid bringing back. With the element gone
         there is no orphan row to leave behind, at any width.
         ⚠ Only two callers pass an icon today (Issues & Concerns, Progress Photos) and Progress
         Photos has no <h1> at all — so this is one module's duplicate mark, removed at the cause
         rather than worked around a third time. */
      if (h1 && opts && opts.icon) h1.classList.add('pd-h1-hasdropico');
    }

    var wrap = document.createElement('div');
    wrap.className = 'pd-tabsdrop';
    var trig = document.createElement('button');
    trig.type = 'button'; trig.className = 'pd-tabsdrop-btn';
    var menu = document.createElement('div');
    menu.className = 'pd-tabsdrop-menu';
    wrap.appendChild(trig); wrap.appendChild(menu);
    tabs.parentNode.insertBefore(wrap, tabs);

    // The icon is built once, as its own element, and inserted BEFORE the
    // trigger inside `wrap` — never written into `trig.innerHTML`, so it can
    // never be mistaken for part of the dropdown control itself.
    if (opts && opts.icon) {
      var ico = document.createElement('span');
      ico.className = 'pd-tabsdrop-ico';
      ico.setAttribute('data-ico', opts.icon);
      ico.setAttribute('data-ico-size', '16');
      wrap.insertBefore(ico, trig);
      // ⚠️ `Icons.hydrate(el)` looks for `[data-ico]` among EL'S DESCENDANTS —
      // it never checks `el` itself — so hydrating `ico` directly is a no-op
      // (found the hard way: an empty, unhydrated span). Hydrate `wrap`
      // instead, which has `ico` as a child.
      if (window.Icons) Icons.hydrate(wrap);
    }
    function activeBtn() { return btns.filter(function (b) { return b.classList.contains('active'); })[0] || btns[0]; }
    function sync() {
      var a = activeBtn();
      trig.innerHTML = '<span>' + esc(a.textContent) + '</span><span class="pd-tabsdrop-caret" data-ico="chevronDown" data-ico-size="14"></span>';
      menu.innerHTML = btns.map(function (b, i) {
        return '<button type="button" data-i="' + i + '" class="' + (b === a ? 'cur' : '') + '">' + esc(b.textContent) + '</button>';
      }).join('');
      if (window.Icons) { Icons.hydrate(trig); Icons.hydrate(menu); }
      menu.querySelectorAll('button[data-i]').forEach(function (mi) {
        mi.onclick = function (e) { e.stopPropagation(); btns[+mi.dataset.i].click(); close(); sync(); };
      });
    }
    function close() { menu.classList.remove('open'); }
    trig.onclick = function (e) { e.stopPropagation(); sync(); menu.classList.toggle('open'); };
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    // Re-sync the trigger's label whenever the module's own code flips which
    // real tab button carries `.active` (e.g. after a screen switch).
    var mo = new MutationObserver(sync);
    btns.forEach(function (b) { mo.observe(b, { attributes: true, attributeFilter: ['class'] }); });
    sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initShell(); initModuleTopbar(); });
  } else { initShell(); initModuleTopbar(); }

  // ---- Accept-the-suggestion inputs -----------------------------------------
  // A placeholder that reads like a proposed value ("Philippine Standard (6-day,
  // 8h)") invites the shell/autocomplete reflex: Tab to take it. Without this,
  // Tab moved on and left the field empty — the suggestion looked broken rather
  // than decorative, which is exactly how it was reported.
  // ⚠️ Only fires on an EMPTY field, so Tab never overwrites anything typed, and
  // the default Tab is NOT prevented: the value is accepted and focus still moves
  // on, which is what the reflex expects. → also on Enter, where the reflex is to
  // commit rather than to leave.
  // ⚠️ Bound with a capture-phase listener on a container rather than per input,
  // so editors that re-render their own markup keep the behaviour without having
  // to re-bind every field they draw.
  function acceptSuggestOnTab(root) {
    if (!root || root._pdSuggestBound) return;
    root._pdSuggestBound = true;
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' && e.key !== 'Enter') return;
      var el = e.target;
      if (!el || el.tagName !== 'INPUT' || el.type !== 'text' && el.type !== '') return;
      if (el.value !== '' || !el.placeholder) return;
      if (el.dataset && el.dataset.nosuggest != null) return;
      el.value = el.placeholder;
      // Let anything listening for the typed value (draft readers, live previews)
      // see it — assigning .value alone fires nothing.
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (e.key === 'Enter') e.preventDefault();   // commit in place; don't submit
    }, true);
  }

  // ---- Browser-history integration for in-page view switches ---------------
  // Every module (and several shell tabs) renders its screens by flipping a
  // plain JS variable and re-rendering — no real navigation, so the browser's
  // native Back button has nothing to step through: it jumps straight past
  // every in-page view change to whatever page was loaded BEFORE this one
  // (usually the module launcher), which reads as "Back lost my place."
  //
  // Usage — call ONCE per logical "screen" a page owns:
  //   var hist = UI.bindHistoryState({
  //     key: 'pp',                                       // unique on this page
  //     get:   function () { return { view: view }; },   // current state
  //     apply: function (s) { view = s.view; render(); } // restore + repaint
  //   });
  // then, wherever the view-changing code used to just call render(), also
  // call hist.push() (after mutating the state, so get() reads the new
  // value) — that is what turns the change into a real history entry.
  //
  // ⚠️ Bundle everything that makes up "what screen am I looking at" into ONE
  // binding's get()/apply() and call push() ONCE per user action. Two
  // bindings both pushing for one click makes Back require two presses to
  // undo what looked like one change.
  // ⚠️ Never call push() from inside apply() (i.e. from the popstate handler
  // or from the initial-hash restore) — that would push a second, redundant
  // entry for a navigation the browser is already recording itself.
  //
  // State lives in the URL hash as `key=<url-encoded JSON>&...`, so several
  // independent bindings on one page (e.g. a module's top-level screen AND a
  // sub-screen's own state) each own one segment and can't clobber another's.
  function bindHistoryState(opts) {
    var key = opts.key, get = opts.get, apply = opts.apply;
    function parts() {
      var h = location.hash.replace(/^#/, '');
      return h ? h.split('&').filter(function (p) { return p; }) : [];
    }
    function readMine() {
      var prefix = key + '=';
      var found = parts().filter(function (p) { return p.indexOf(prefix) === 0; })[0];
      if (!found) return null;
      try { return JSON.parse(decodeURIComponent(found.slice(prefix.length))); }
      catch (e) { return null; }
    }
    function writeUrl(replace) {
      var mine = key + '=' + encodeURIComponent(JSON.stringify(get()));
      var rest = parts().filter(function (p) { return p.indexOf(key + '=') !== 0; });
      rest.push(mine);
      var url = location.pathname + location.search + '#' + rest.join('&');
      if (replace) history.replaceState(history.state, '', url);
      else history.pushState(history.state, '', url);
    }
    window.addEventListener('popstate', function () {
      var s = readMine();
      // If our key is gone from the hash, the user has gone back past every
      // state we ever pushed (or forward again with nothing of ours in it) —
      // there is nothing of OURS to restore; the module's current state (or
      // the browser's own navigation) stands.
      if (s) apply(s);
    });
    // A reload, or a link landing straight on this page with our key already
    // in the hash, restores that view instead of the module's hardcoded
    // default — deliberately NOT pushed, since it is the current entry, not
    // a new one.
    var initial = readMine();
    if (initial) {
      apply(initial);
    } else {
      // ⚠️ Load-bearing: without this, the entry the browser was ALREADY on
      // when this bound (the module's initial screen) carries no state of
      // ours. Push a first view change, then go Back twice — the first Back
      // correctly restores the state one level up, but the second Back lands
      // on this untouched entry, finds nothing of ours in its hash, and
      // leaves the last-applied view on screen instead of restoring the
      // original one. Stamping the current (default) state into THIS entry
      // via replaceState — never pushState, which would add a spurious extra
      // entry for a view the user never navigated to — makes it a real,
      // restorable step in the stack.
      writeUrl(true);
    }
    return {
      push: function () { writeUrl(false); },
      replace: function () { writeUrl(true); }
    };
  }

  // ---- Shared collapsible filter group (search box + selects behind a
  // funnel toggle) --------------------------------------------------------
  // Generalises the pattern Issues & Concerns / Progress Photos shipped by
  // hand (their own `.il-filters`/`.pp-filters`) so every module's top
  // filter/search row — whether it's literally inside `.pd-topbar` or the
  // always-visible bar most modules render directly under it — can hide
  // behind one toggle instead of sitting permanently open. Pure
  // show/hide + a "something is filtered" dot; it never touches a module's
  // own filter-application logic (its `oninput`/`onchange` handlers on the
  // individual controls keep working exactly as before — this only adds a
  // capture-phase listener alongside them to keep the dot in sync).
  //
  // Usage:
  //   var fg = UI.wireFilterToggle(document.getElementById('xx-filttoggle'),
  //                                 document.getElementById('xx-filters'));
  //   // after a Clear-filters button resets fields programmatically
  //   // (native input/change events don't fire on `el.value = ''`):
  //   fg.sync();
  function filterGroupActive(panel) {
    if (!panel) return false;
    var els = panel.querySelectorAll('select, input');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked) return true; continue; }
      if (el.disabled || el.hidden) continue;
      var v = el.value == null ? '' : String(el.value).trim();
      if (v) return true;
    }
    return false;
  }
  function wireFilterToggle(toggle, panel, opts) {
    if (!toggle || !panel) return { open: function () {}, close: function () {}, sync: function () {} };
    opts = opts || {};
    panel.classList.add('pd-filtergroup');
    toggle.classList.add('pd-filttoggle');
    function sync() { toggle.classList.toggle('has-active', filterGroupActive(panel)); }
    function setOpen(open) {
      panel.classList.toggle('open', open);
      toggle.classList.toggle('is-active', open);
      if (open && opts.autoFocus !== false) {
        var first = panel.querySelector('input[type="text"], input[type="search"], input:not([type])');
        if (first) { try { first.focus(); } catch (e) {} }
      }
      if (opts.onToggle) opts.onToggle(open);
    }
    toggle.onclick = function () { setOpen(!panel.classList.contains('open')); };
    if (opts.closeOnEscape !== false) {
      panel.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { setOpen(false); toggle.focus(); }
      });
    }
    panel.addEventListener('input', sync, true);
    panel.addEventListener('change', sync, true);
    sync();
    return { open: function () { setOpen(true); }, close: function () { setOpen(false); }, sync: sync };
  }

  // ---- KPI / metric card -------------------------------------------------
  // ⚠️ ONE metric card for the whole suite. Before 2026-09-08 there were FIVE
  // hand-rolled copies -- `.rr-kpi`, `.sm-kpi`, `.il-kpi`, `.cf-kpi` and the
  // dashboard's own `.pd-perf`/`.pd-mini-c` -- and they disagreed about
  // everything a card can disagree about: the value ran 19 / 20 / 23 / 24 / 25 /
  // 26px depending on which module you were standing in, the label ran 9.5 / 10 /
  // 10.5 / 12px, three of them put the value ABOVE the label and two below, and
  // only the dashboard's carried the brand accent bar. The shared `.pd-kpi` block
  // in dashboard.css had been written for exactly this and was used by NOTHING.
  //
  // opts: { sub, cls, title }
  //   cls   extra classes on the card. Two vocabularies are understood by the
  //         shared CSS and neither needs module CSS:
  //           `pd-kpi-ok` / `pd-kpi-warn` / `pd-kpi-bad`  -- app status colours
  //           any `rcm-*` level class (mcc-rcm.css)        -- register semantics
  //         Both tint the accent bar AND the value; the label stays muted so it
  //         is still readable, which is the rule the registers had already
  //         arrived at independently.
  //   sub   the basis line. ⚠️ Pass one. A number with no stated basis gets
  //         trusted further than it deserves -- the dashboard's own perf cards
  //         carry a basis even when empty, and that note is worth honouring here.
  //
  // ⚠️ LABEL FIRST, then value, then sub. Not a style preference: `.pd-kpi-label`
  // reserves the two lines a wrapping label needs (min-height + flex-end) so that
  // a one-word and a three-word label still line their VALUES up across the row.
  // Emitting value-first, as three of the five copies did, breaks that alignment.
  function kpi(label, value, opts) {
    opts = opts || {};
    var cls = opts.cls ? ' ' + opts.cls : '';
    return '<div class="pd-kpi' + cls + '"' +
      (opts.title ? ' title="' + esc(opts.title) + '"' : '') + '>' +
      '<div class="pd-kpi-label">' + esc(label) + '</div>' +
      // Values are pre-formatted HTML in several call sites (money spans,
      // pills), so this one is deliberately NOT escaped. Callers pass numbers
      // or their own already-escaped markup.
      '<div class="pd-kpi-value">' + (value == null ? '—' : value) + '</div>' +
      (opts.sub ? '<div class="pd-kpi-sub">' + esc(opts.sub) + '</div>' : '') +
      '</div>';
  }
  // Wrap N cards in the shared responsive strip. auto-fit, so six cards reflow to
  // 3+3 and then 2+2+2 without any module declaring its own column count -- the
  // five copies each hardcoded one (6, 7, 4) plus its own breakpoints, which is
  // why the same register showed a ragged empty cell at one window width and not
  // another.
  function kpis(html, extraCls) {
    return '<div class="pd-kpis' + (extraCls ? ' ' + extraCls : '') + '">' + html + '</div>';
  }

  window.UI = { toast: toast, renderUserBar: renderUserBar, modal: modal, initShell: initShell,
                enhanceProjectSelect: enhanceProjectSelect, initModuleTopbar: initModuleTopbar,
                acceptSuggestOnTab: acceptSuggestOnTab, bindHistoryState: bindHistoryState,
                renderNav: renderNav, renderSwitcher: renderSwitcher,
                renderNavListInto: renderNavListInto, tabsToDropdown: tabsToDropdown,
                wireFilterToggle: wireFilterToggle, allProjectIds: allProjectIds,
                projectsById: projectsById,
                projectCode: projectCode, projectName: projectName,
                projectLabel: projectLabel, projectTagHTML: projectTagHTML,
                groupByProject: groupByProject, projectGroupRowHTML: projectGroupRowHTML,
                kpi: kpi, kpis: kpis };
})();
