// ============================================================================
// Planners Dashboard — Shared Auth (AppAuth)
// ----------------------------------------------------------------------------
// Wraps Supabase Auth + the `users` profile table. Every page (shell AND every
// module) uses this so there is ONE login across the whole dashboard.
//
// Load order on every page:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="assets/js/config.js"></script>
//   <script src="assets/js/auth.js"></script>
//   <script src="assets/js/db.js"></script>
//   <script src="assets/js/ui.js"></script>
//
// Module pages live one level deeper (modules/<name>/index.html), so they load
// the same files with a ../../ prefix. See MODULE_CONTRACT.md.
// ============================================================================

(function () {
  // Create the Supabase client once, synchronously, on the window.
  if (!window.__sb) {
    var c = window.APP_CONFIG || {};
    window.__sb = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
  }

  function getSB() { return window.__sb; }

  // ---- Portfolio scope -------------------------------------------------
  // A per-TAB flag, parallel to `pd_project` sessionStorage: true when a
  // module was opened from the Portfolio side of the app (ui.js's renderNav
  // appends `#pd_scope=portfolio` to every module link in its 'portfolio'
  // branch) rather than from a specific project's own module grid. Read out
  // of the hash exactly ONCE — into sessionStorage, which is what makes it
  // survive whatever a module's own screen-switching does to the hash
  // afterward (UI.bindHistoryState rewrites it on every view change).
  //
  // ⚠️ This generalizes the one-off convention Pormac shipped for itself
  // (2026-09-14, `#pmc_scope=portfolio`) into something every module can
  // read the same way, with no module-specific hash key to invent.
  var PORTFOLIO_KEY = 'pd_portfolio';
  if (/(^|[#&])pd_scope=portfolio(&|$)/.test(location.hash)) {
    try { sessionStorage.setItem(PORTFOLIO_KEY, '1'); } catch (e) {}
  }
  function isPortfolioScope() {
    try { return sessionStorage.getItem(PORTFOLIO_KEY) === '1'; } catch (e) { return false; }
  }
  /* ==== THE PAGE SAYS WHICH SCOPE IT IS IN, SO CSS CAN ANSWER =================================
     Owner 2026-09-16: *"some buttons in the toolbars are not working for portfolio view, probably
     since these buttons only work for project-level, which defeats the purpose of showing the
     buttons in the first place."*
     ⚠️⚠️ WRITES WERE ALREADY REFUSED — THE UI JUST DID NOT AGREE. `wrapWritesForPortfolio`
     below blocks every insert/update/upsert/delete at the Supabase chokepoint while this flag is
     set, so an "+ Add stakeholder" in portfolio scope could only ever raise a toast explaining it
     would not work. A control whose entire behaviour is to say "not here" should not be there.
     ⚠️ A CLASS ON `<html>`, NOT A SWEEP OVER THE BUTTONS. Module chrome is built at wildly
     different times — `UI.initModuleTopbar()` on DOMContentLoaded, module renderers on every
     repaint, `PortfolioDash.takeOver()` from an auth callback that races both. A one-shot
     `querySelectorAll` hides whatever exists at that instant and misses everything drawn after it;
     that exact race produced the duplicated title bar (2026-09-16 (u)). A class on the document is
     already in force whenever a control is finally created.
     ⚠️ Set at SCRIPT LOAD, not on DOMContentLoaded: `sessionStorage` is readable
     immediately, `document.documentElement` exists as soon as this file runs (it is loaded in
     <head> on every page), and anything later would let a project-only control paint first. */
  function markScope() {
    try {
      var el = document.documentElement;
      if (!el) return;
      el.classList.toggle('pd-portfolio', isPortfolioScope());
    } catch (e) {}
  }
  markScope();
  // Called when a planner picks a REAL project out of the shared selector
  // (UI.enhanceProjectSelect) while in Portfolio scope — leaving Portfolio
  // for a specific project is the one place this flag is cleared again.
  function setPortfolioScope(on) {
    try {
      if (on) sessionStorage.setItem(PORTFOLIO_KEY, '1');
      else sessionStorage.removeItem(PORTFOLIO_KEY);
    } catch (e) {}
    /* ⚠️ The class follows the flag. Every caller of this reloads immediately afterwards, so
       this is belt-and-braces — but a flag and a class that can disagree is exactly the kind of
       thing that stops being true later, quietly. */
    markScope();
  }

  // ⚠️⚠️ WRITES ARE BLOCKED AT THE ONE CHOKEPOINT EVERY MODULE'S WRITE GOES
  // THROUGH, NOT RE-IMPLEMENTED PER MODULE. Every module in this app talks to
  // Postgres the same way — `AppAuth.getSB().from(table).insert/update/
  // upsert/delete(...)` — so wrapping `.from()` here makes "Portfolio is
  // read-only" true for every module at once, present and future, without a
  // single module file having to remember to check a flag before its own
  // Save/Delete button fires. A module that ALSO hides its own Add/Edit
  // buttons while in Portfolio scope is a nicer UI; this is the guarantee
  // that holds even if it doesn't.
  // ⚠️ `.rpc(...)` is deliberately NOT touched here — several modules read
  // through a security-definer RPC (e.g. `is_admin()`), and blocking RPCs
  // indiscriminately would break those reads. The handful of write-shaped
  // RPCs are each still gated by their own `created_by =
  // auth.uid()`/role checks server-side, same as if a viewer called them.
  (function wrapWritesForPortfolio() {
    if (window.__sb.__pdPortfolioWrapped) return;
    window.__sb.__pdPortfolioWrapped = true;
    var rawFrom = window.__sb.from.bind(window.__sb);
    var WRITE_METHODS = ['insert', 'update', 'upsert', 'delete'];
    window.__sb.from = function (table) {
      var qb = rawFrom(table);
      if (!isPortfolioScope()) return qb;
      WRITE_METHODS.forEach(function (m) {
        if (typeof qb[m] !== 'function') return;
        qb[m] = function () {
          if (window.UI && UI.toast) {
            UI.toast('Portfolio is read-only — switch to a project to make changes.', 'warn');
          }
          var err = { message: 'Portfolio view is read-only.', code: 'PD_PORTFOLIO_READONLY' };
          // A thenable that also carries the chainable methods a caller might
          // still call before awaiting (.select()/.eq()/.single()/...) — every
          // one of them just returns the same blocked result rather than
          // reaching Postgres.
          var blocked = {
            then: function (resolve, reject) { return Promise.resolve({ data: null, error: err }).then(resolve, reject); }
          };
          ['select', 'eq', 'neq', 'in', 'is', 'match', 'single', 'maybeSingle', 'order', 'limit'].forEach(function (k) {
            blocked[k] = function () { return blocked; };
          });
          return blocked;
        };
      });
      return qb;
    };
  })();

  // Roles, highest → lowest privilege.
  var ROLES = ['super_admin', 'admin', 'planner', 'user', 'viewer'];
  var AUTO_APPROVE = ['super_admin', 'admin', 'planner'];

  function profKey(uid) { return 'pd_prof_' + uid; }

  // ⚠️ THE CACHE USED TO BE RETURNED UNCONDITIONALLY AND NEVER REVALIDATED, so a
  // role or status change did not reach a tab that had already cached the old
  // one — sessionStorage lives until the tab closes, and every page in the app
  // reads through this. An admin promoting someone to admin, or approving a
  // pending user, appeared to do nothing until that person happened to open a
  // fresh tab, which looks exactly like "the app will not give me my access".
  // The cache is still returned immediately (it is what keeps first paint fast),
  // but it is now checked against the server in the background.
  function revalidateProfile(user, cached) {
    getSB().from('users').select('*').eq('id', user.id).single().then(function (r) {
      if (r.error || !r.data) return;              // offline / transient — keep the cache
      try { sessionStorage.setItem(profKey(user.id), JSON.stringify(r.data)); } catch (e) {}
      // Only role and status change what the user may DO, so only those are
      // worth interrupting the page for. Any other edit (name, projects) simply
      // corrects the cache for the next navigation.
      if (r.data.role === cached.role && r.data.status === cached.status) return;
      // ⚠️ Reload at most once PER OBSERVED STATE, not once ever: a second
      // legitimate change in the same tab must still take effect, while a
      // reload can never loop (after it, cache and server agree and the
      // early-return above fires first).
      try {
        var k = 'pd_prof_rl_' + user.id;                     // cleared by logout()
        var sig = r.data.role + '|' + r.data.status;
        if (sessionStorage.getItem(k) === sig) return;
        sessionStorage.setItem(k, sig);
      } catch (e) { return; }                                // no storage → do not reload
      location.reload();
    }, function () { /* network error — keep the cache, never sign the user out */ });
  }

  async function loadProfile(user) {
    // Try the sessionStorage cache first.
    var cached = null;
    try {
      var raw = sessionStorage.getItem(profKey(user.id));
      if (raw) cached = JSON.parse(raw);
    } catch (e) {}
    if (cached) { revalidateProfile(user, cached); return cached; }

    var { data, error } = await getSB()
      .from('users').select('*').eq('id', user.id).single();
    if (error || !data) return null;
    try { sessionStorage.setItem(profKey(user.id), JSON.stringify(data)); } catch (e) {}
    return data;
  }

  function redirect(page) {
    // Works from both the shell (root) and modules (../../) — compute prefix.
    var depth = (location.pathname.match(/\/modules\//)) ? '../../' : '';
    location.href = depth + page;
  }

  // ensureProfile(user): self-heal — if an auth user has no profile row yet
  // (e.g. created via email confirmation, or an earlier insert failed), create
  // a pending one so they go to pending.html instead of looping on login.
  async function ensureProfile(user) {
    var ins = await getSB().from('users').insert({
      id: user.id, email: user.email,
      name: (user.user_metadata && user.user_metadata.name) || user.email,
      role: 'user', status: 'pending', projects: [],
    }).select().single();
    if (!ins.error && ins.data) return ins.data;
    // Insert may race / already exist — re-read.
    var re = await getSB().from('users').select('*').eq('id', user.id).single();
    return re.error ? null : re.data;
  }

  // requireLogin(cb): ensures an approved, signed-in user; else redirects.
  // IMPORTANT: a sessioned user with a missing/unapproved profile must NEVER be
  // sent back to index.html — index.html bounces sessions to dashboard, which
  // would create an infinite loop. Send them to pending.html (or sign out).
  async function requireLogin(cb) {
    var { data: { session } } = await getSB().auth.getSession();
    if (!session) return redirect('index.html');

    var profile = await loadProfile(session.user);
    if (!profile) profile = await ensureProfile(session.user);   // self-heal
    if (!profile) {                 // truly cannot load/create → break the loop
      await getSB().auth.signOut();
      return redirect('index.html');
    }
    if (profile.status !== 'approved') return redirect('pending.html');

    window.__profile = profile;
    window.__role = profile.role;
    if (cb) cb(session.user, profile);
  }

  // requireRole(roles, cb): like requireLogin but also gates on role membership.
  async function requireRole(roles, cb) {
    return requireLogin(function (user, profile) {
      if (roles.indexOf(profile.role) === -1) {
        alert('You do not have access to this page.');
        return redirect('projects.html');
      }
      if (cb) cb(user, profile);
    });
  }

  function requireAdmin(cb) { return requireRole(['super_admin', 'admin'], cb); }

  function isAutoApprove(profile) {
    return AUTO_APPROVE.indexOf((profile || {}).role) !== -1;
  }

  // canAccessProject(profile, projectId): admins see all; others by assignment.
  function canAccessProject(profile, projectId) {
    if (!profile) return false;
    if (profile.role === 'super_admin' || profile.role === 'admin') return true;
    return (profile.projects || []).indexOf(projectId) !== -1;
  }

  // moduleVisible(m, profile): the ONE place that decides whether a module
  // shows up for a signed-in user — read by UI.renderNav, ModulesGrid.visible
  // (which dashboard.html's own tile grid delegates to), and Portfolio
  // Overview's hardcoded tab list, so all three surfaces a module can appear
  // on cannot disagree about it.
  //
  // ⚠️ `m.superAdminOnly` (config.js) is still the DEFAULT — untouched here —
  //    and `profile.module_access` (2026-09-15, admin.html's per-user Modules
  //    editor) is an OVERRIDE on top of it, not a second independent rule:
  //    - `module_access` absent/null → the role default alone decides, exactly
  //      as before this existed. This is "Reset to default"'s whole effect.
  //    - `module_access` a (possibly empty) array → it is the EXACT set of
  //      keys this user may see, in EITHER direction: it can grant a
  //      `superAdminOnly` module to a non-super_admin, or withhold an
  //      ordinary module from anyone, role notwithstanding.
  //    A plain boolean-per-module map could not express "never touched" vs
  //    "deliberately set to nothing," which is exactly the distinction
  //    Reset-to-default needs to act on.
  // ⚠️ A retired module (`enabled:false`) is not this function's concern —
  //    every caller already filters on `enabled` separately, and an override
  //    naming a retired module's key is simply never asked about.
  function moduleVisible(m, profile) {
    if (profile && Array.isArray(profile.module_access)) {
      return profile.module_access.indexOf(m.key) !== -1;
    }
    return !m.superAdminOnly || !!profile && profile.role === 'super_admin';
  }

  async function login(email, password) {
    return getSB().auth.signInWithPassword({ email: email, password: password });
  }

  // loginWithMicrosoft(): redirects to Microsoft (Azure AD) via Supabase's
  // "azure" OAuth provider. Only called from index.html (root), so the
  // redirect target is always the root home.html landing page. On return,
  // Supabase completes the session from the URL automatically
  // (detectSessionInUrl, on by default) — the landing page just calls
  // requireLogin() as usual, which self-heals a profile row for a first-time
  // Microsoft sign-in the same way email sign-up does.
  async function loginWithMicrosoft() {
    return getSB().auth.signInWithOAuth({
      provider: 'azure',
      options: {
        redirectTo: location.origin + location.pathname.replace(/index\.html$/, '') + 'home.html',
        scopes: 'email',
      },
    });
  }

  async function register(email, password, name) {
    var res = await getSB().auth.signUp({ email: email, password: password });
    if (res.error) return res;
    // Create the pending profile row.
    if (res.data && res.data.user) {
      await getSB().from('users').insert({
        id: res.data.user.id, email: email, name: name,
        role: 'user', status: 'pending', projects: [],
      });
    }
    return res;
  }

  async function logout() {
    try {
      Object.keys(sessionStorage).forEach(function (k) {
        if (k.indexOf('pd_prof_') === 0) sessionStorage.removeItem(k);
      });
    } catch (e) {}
    await getSB().auth.signOut();
    redirect('index.html');
  }

  window.AppAuth = {
    getSB: getSB, ROLES: ROLES,
    requireLogin: requireLogin, requireRole: requireRole, requireAdmin: requireAdmin,
    isAutoApprove: isAutoApprove, canAccessProject: canAccessProject,
    moduleVisible: moduleVisible,
    login: login, loginWithMicrosoft: loginWithMicrosoft, register: register, logout: logout,
    isPortfolioScope: isPortfolioScope, setPortfolioScope: setPortfolioScope,
  };
  window.getSB = getSB;
})();
