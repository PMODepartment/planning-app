// ============================================================================
// Planners Dashboard — shared module launcher grid (ModulesGrid)
// ----------------------------------------------------------------------------
// The launcher is rendered by TWO pages now (modules.html, and the Dashboard's
// tile grid links through the same MODULE_V), so the card markup and the
// cache-busting version live here once instead of being copy-pasted.
// ⚠️ MODULE_V used to sit inside dashboard.html. It moved here when the module
// launcher moved out of dashboard.html (A4) — bump it HERE from now on.
// ============================================================================

(function () {
  // ⚠️ Cache-busting for the MODULE PAGES themselves. Every shared asset carries a ?v=, but each
  // module's own index.html did not — so a returning user kept serving the cached page and none of
  // that module's fixes reached them until a hard refresh. That has been mis-diagnosed as a code
  // bug more than once (a "broken import" that was simply an old parser still executing).
  // Bump MODULE_V on any deploy that changes a module's index.html. It is defined here, not in
  // config.js, deliberately: config.js is itself cache-busted from every HTML file, so versioning
  // it there would mean an app-wide bump to make a one-module change visible.
  // ⚠️⚠️ THE VERSION IS TAKEN FROM THIS SCRIPT'S OWN `?v=`, NOT FROM A CONSTANT HERE.
  // The bug that forced this (2026-08-25): dashboard.html and modules.html load
  // `modules-grid.js?v=20260825f`, and the browser caches a script BY ITS FULL URL. Bumping the
  // constant inside this file therefore changed nothing a returning user could ever see — the old
  // copy kept being served from cache, kept handing out `?v=20260825f` module links, and every
  // module fix from `g` to `q` sat undelivered behind a query string nobody had touched. Ten
  // "MODULE_V bumped" changelog lines, none of which reached a browser.
  // Deriving it from the tag means the ONE thing a deploy edits — the `?v=` in the HTML, which is
  // itself always fetched fresh (the service worker forces `cache: 'reload'` on HTML) — is also the
  // thing that busts this file AND the module pages. The two can no longer disagree.
  // The literal below is only the fallback for a page that omits the query.
  var MODULE_V = (function () {
    try {
      var s = document.currentScript && document.currentScript.src;
      var m = s && s.match(/[?&]v=([^&]+)/);
      if (m) return decodeURIComponent(m[1]);
    } catch (e) {}
    return '20260902z';
  })();

  function href(m) {
    return m.path + (m.path.indexOf('?') === -1 ? '?v=' : '&v=') + MODULE_V;
  }

  function card(m) {
    if (m.enabled) {
      return '<a class="pd-module-card" href="' + href(m) + '">' +
        '<div class="pd-module-icon">' + Icons.svg(m.icon, 24) + '</div>' +
        '<div class="pd-module-body"><div class="pd-module-title">' + Fmt.esc(m.name) + '</div>' +
        '<div class="pd-module-sub">Open module ' + Icons.svg('arrowRight', 14) + '</div></div></a>';
    }
    if (m.retiredTo && m.externalUrl) {
      // Retired modules with a known destination are clickable and open the
      // Engineering App (a separate Supabase project/login) in a new tab.
      return '<a class="pd-module-card retired" href="' + Fmt.esc(m.externalUrl) + '" target="_blank" rel="noopener" title="' +
        Fmt.esc(m.name + ' is maintained in ' + m.retiredTo + '. Opens in a new tab.') + '">' +
        '<div class="pd-module-icon">' + Icons.svg(m.icon, 24) + '</div>' +
        '<div class="pd-module-body"><div class="pd-module-title">' + Fmt.esc(m.name) + '</div>' +
        '<div class="pd-module-sub"><span class="pd-badge-soon">Moved to ' + Fmt.esc(m.retiredTo) + '</span> ' +
        Icons.svg('externalLink', 12) + '</div></div></a>';
    }
    // ⚠️ "Disabled" covers two OPPOSITE situations and they must not read the same.
    // A module that has not been built yet is "In development"; one that has MOVED
    // to another app is retired, and labelling it "In development" would send a
    // user waiting for something that already exists elsewhere.
    var sub = m.retiredTo
      ? '<span class="pd-badge-soon">Moved to ' + Fmt.esc(m.retiredTo) + '</span>'
      : '<span class="pd-badge-soon">In development</span>';
    return '<div class="pd-module-card disabled" title="' +
      Fmt.esc(m.retiredTo ? m.name + ' is maintained in ' + m.retiredTo + ' — this copy is read-only history.'
                          : m.name + ' is not built yet.') + '">' +
      '<div class="pd-module-icon">' + Icons.svg(m.icon, 24) + '</div>' +
      '<div class="pd-module-body"><div class="pd-module-title">' + Fmt.esc(m.name) + '</div>' +
      '<div class="pd-module-sub">' + sub + '</div></div></div>';
  }

  window.ModulesGrid = {
    MODULE_V: MODULE_V,
    href: href,
    // ⚠️ Exported so the DASHBOARD's tile grid can reuse the retired-module card verbatim
    // rather than keeping a second, dumber copy that rendered Drawing Register and Material
    // Submittal as dead grey boxes while the launcher made the same two modules clickable.
    // One card builder, so the two screens cannot drift about what a retired module looks like.
    card: card,
    render: function (host) {
      if (!host) return;
      host.innerHTML = (APP_CONFIG.MODULES || []).map(card).join('');
    },
  };
})();
