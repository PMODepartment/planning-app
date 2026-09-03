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
      '<a class="pd-usermenu-link" href="' + base + 'my-work.html">' + mIco('clipboard') + 'My Work</a>' +
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
    function projRow(p) {
      return '<div class="pd-nt-proj' + (opts.isSelected && opts.isSelected(p) ? ' sel' : '') + '" data-nt-proj="' + esc(p.id) + '">' +
        _ntIco('project', 14) + '<span>' + esc(p.name || p.id) + '</span></div>';
    }
    var portfolioRow = '<div class="pd-nt-portfolio' + (opts.portfolioActive ? ' sel' : '') + '" data-nt-portfolio="1">' +
      _ntIco('barChart', 15) + '<span>Portfolio</span></div>';
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
    function syncBtn() {
      var t = labelFor(sel.value), ph = !t;
      var txt = t || (sel.options[0] ? sel.options[0].textContent : 'Select…');
      btn.innerHTML = '<span class="pd-psel-txt' + (ph ? ' pd-psel-ph' : '') + '">' + esc(txt) + '</span>' +
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
        isSelected: function (p) { return p.id === sel.value; },
        onPortfolio: function () { location.href = appBase() + 'modules/portfolio-overview/index.html'; },
        onProject: function (p) { choose(p.id); }
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
  // Which portfolio-overview TAB a given module's cross-project data lives on, keyed by
  // config.js MODULES `key`. A module absent here has no cross-project consolidation of its
  // own inside portfolio-overview — either it hosts its OWN "Portfolio" view (manpower-loading
  // does; its sidebar link goes straight to the module) or it genuinely has none yet, in which
  // case the link falls back to the plain module page, same as it does in Project mode.
  var PORTFOLIO_TAB = {
    'minutes-of-meeting': 'meetings',
    'risk-register': 'risk',
    'stakeholder-map': 'stakeholders',
    'project-schedule': 'scurve',    // no dedicated cross-project Schedule tab — S-Curve is the
    's-curve': 'scurve',             // closest thing to one, and both modules feed it below
    'resource-loading': 'resources',
    'equipment-loading': 'equipment',
    'productivity-rates': 'productivity',
    'issues-lessons': 'issues',
    'progress-photos': 'photos',
    'contracts-claims': 'contracts',
    'cash-flow': 'cashflow'
  };
  function renderNav(navEl, mode, ctx) {
    if (!navEl) return;
    ctx = ctx || {};
    var base = ctx.base || '';
    var active = ctx.active || '';
    function cls(key) { return active === key ? ' class="active"' : ''; }
    var html;
    if (mode === 'portfolio') {
      // Three scopes, per the owner's own structure: PORTFOLIO (every project's data,
      // consolidated — Projects, the Portfolio Dashboard, then every module a project can
      // carry, each opening its cross-project view where one exists), PERSONAL (this
      // signed-in user's own work, not scoped to any one project), SYSTEM (Admin, gated).
      // (No "Home" link here — home.html is the landing/picker screen itself, not a
      // destination to navigate back to from inside the app.)
      var poBase = base + 'modules/portfolio-overview/index.html';
      function poHref(tab) { return poBase + '#po_view=' + encodeURIComponent(JSON.stringify({ v: tab })); }
      // ctx.modules is optional — every project-mode page already passes it (it built the
      // module grid), but the five portfolio-mode pages never needed to before now. Default
      // to the shared registry rather than requiring five call sites to be updated.
      var pmods = (ctx.modules || (window.APP_CONFIG && APP_CONFIG.MODULES) || []).filter(function (m) { return m.enabled; });
      html = '<div class="pd-navsec">Portfolio</div>' +
        '<a href="' + base + 'projects.html"' + cls('projects') + ' title="Projects">' +
          '<span class="pd-navico" data-ico="grid"></span><span class="pd-navtxt">Projects</span></a>' +
        '<a href="' + poBase + '"' + cls('portfolio-dashboard') + ' title="Portfolio Dashboard">' +
          '<span class="pd-navico" data-ico="barChart"></span><span class="pd-navtxt">Dashboard</span></a>' +
        pmods.map(function (m) {
          var tab = PORTFOLIO_TAB[m.key];
          var href = tab ? poHref(tab) : (window.ModulesGrid ? base + ModulesGrid.href(m) : base + m.path);
          return '<a href="' + href + '" title="' + esc(m.name) + (tab ? ' — portfolio-wide' : '') + '">' +
            '<span class="pd-navico" data-ico="' + esc(m.icon) + '"></span><span class="pd-navtxt">' + esc(m.name) + '</span></a>';
        }).join('') +
        '<div class="pd-navsec">Personal</div>' +
        '<a href="' + base + 'my-work.html"' + cls('personal-dashboard') + ' title="Personal Dashboard">' +
          '<span class="pd-navico" data-ico="clipboard"></span><span class="pd-navtxt">Dashboard</span></a>' +
        '<a href="' + base + 'my-tasks.html"' + cls('my-tasks') + ' title="Tasks">' +
          '<span class="pd-navico" data-ico="check"></span><span class="pd-navtxt">Tasks</span></a>' +
        (ctx.isAdmin
          ? '<div class="pd-navsec">System</div>' +
            '<a href="' + base + 'admin.html"' + cls('admin') + ' title="Admin">' +
              '<span class="pd-navico" data-ico="settings"></span><span class="pd-navtxt">Admin</span></a>'
          : '');
    } else {
      var mods = (ctx.modules || []).filter(function (m) { return m.enabled; });
      // No "Portfolio" section here (owner's call, 2026-08-31) — the shared
      // project dropdown (UI.enhanceProjectSelect) already offers a Portfolio
      // row, so a project's own sidebar stays scoped to that project.
      //
      // ⚠️ "Meetings" is no longer a hardcoded nav entry deep-linking into
      // issues-lessons — Minutes of Meeting split out into its own real
      // module (`minutes-of-meeting`), so it now flows through mods.map()
      // below like every other module; config.js's MODULES order is what
      // puts it first, right after Dashboard.
      html = '<div class="pd-navsec">Project</div>' +
        '<a href="' + base + 'dashboard.html"' + cls('dashboard') + ' title="Dashboard">' +
          '<span class="pd-navico" data-ico="home"></span><span class="pd-navtxt">Dashboard</span></a>' +
        mods.map(function (m) {
          var href = window.ModulesGrid ? base + ModulesGrid.href(m) : base + m.path;
          return '<a href="' + href + '"' + cls(m.key) + ' title="' + esc(m.name) + '">' +
            '<span class="pd-navico" data-ico="' + esc(m.icon) + '"></span><span class="pd-navtxt">' + esc(m.name) + '</span></a>';
        }).join('');
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
    mount.innerHTML =
      '<button class="pd-projsw-btn" type="button">' +
        '<span class="pd-projsw-ic" data-ico="' + (mode === 'portfolio' ? 'barChart' : 'project') + '" data-ico-size="16"></span>' +
        '<span class="pd-projsw-txt"><strong>' + esc(mode === 'portfolio' ? 'Portfolio' : (opts.pname || 'Select a project')) + '</strong>' +
          (opts.ghLabel ? '<small>' + esc(opts.ghLabel) + '</small>' : '') + '</span>' +
        '<span class="pd-projsw-caret" data-ico="chevronDown" data-ico-size="13"></span>' +
      '</button>' +
      '<div class="pd-projsw-menu"></div>';
    if (window.Icons) Icons.hydrate(mount);

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
  function tabsToDropdown(selOrEl) {
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
    }

    var wrap = document.createElement('div');
    wrap.className = 'pd-tabsdrop';
    var trig = document.createElement('button');
    trig.type = 'button'; trig.className = 'pd-tabsdrop-btn';
    var menu = document.createElement('div');
    menu.className = 'pd-tabsdrop-menu';
    wrap.appendChild(trig); wrap.appendChild(menu);
    tabs.parentNode.insertBefore(wrap, tabs);

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

  window.UI = { toast: toast, renderUserBar: renderUserBar, modal: modal, initShell: initShell,
                enhanceProjectSelect: enhanceProjectSelect, initModuleTopbar: initModuleTopbar,
                acceptSuggestOnTab: acceptSuggestOnTab, bindHistoryState: bindHistoryState,
                renderNav: renderNav, renderSwitcher: renderSwitcher,
                renderNavListInto: renderNavListInto, tabsToDropdown: tabsToDropdown,
                wireFilterToggle: wireFilterToggle };
})();
