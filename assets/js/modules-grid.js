// ============================================================================
// Planners Dashboard â€” shared module launcher grid (ModulesGrid)
// ----------------------------------------------------------------------------
// The launcher is rendered by TWO pages now (modules.html, and the Dashboard's
// tile grid links through the same MODULE_V), so the card markup and the
// cache-busting version live here once instead of being copy-pasted.
// âš ï¸ MODULE_V used to sit inside dashboard.html. It moved here when the module
// launcher moved out of dashboard.html (A4) â€” bump it HERE from now on.
// ============================================================================

(function () {
  // âš ï¸ Cache-busting for the MODULE PAGES themselves. Every shared asset carries a ?v=, but each
  // module's own index.html did not â€” so a returning user kept serving the cached page and none of
  // that module's fixes reached them until a hard refresh. That has been mis-diagnosed as a code
  // bug more than once (a "broken import" that was simply an old parser still executing).
  // Bump MODULE_V on any deploy that changes a module's index.html. It is defined here, not in
  // config.js, deliberately: config.js is itself cache-busted from every HTML file, so versioning
  // it there would mean an app-wide bump to make a one-module change visible.
  var MODULE_V = '20260824f';

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
    // âš ï¸ "Disabled" covers two OPPOSITE situations and they must not read the same.
    // A module that has not been built yet is "In development"; one that has MOVED
    // to another app is retired, and labelling it "In development" would send a
    // user waiting for something that already exists elsewhere.
    var sub = m.retiredTo
      ? '<span class="pd-badge-soon">Moved to ' + Fmt.esc(m.retiredTo) + '</span>'
      : '<span class="pd-badge-soon">In development</span>';
    return '<div class="pd-module-card disabled" title="' +
      Fmt.esc(m.retiredTo ? m.name + ' is maintained in ' + m.retiredTo + ' â€” this copy is read-only history.'
                          : m.name + ' is not built yet.') + '">' +
      '<div class="pd-module-icon">' + Icons.svg(m.icon, 24) + '</div>' +
      '<div class="pd-module-body"><div class="pd-module-title">' + Fmt.esc(m.name) + '</div>' +
      '<div class="pd-module-sub">' + sub + '</div></div></div>';
  }

  window.ModulesGrid = {
    MODULE_V: MODULE_V,
    href: href,
    render: function (host) {
      if (!host) return;
      host.innerHTML = (APP_CONFIG.MODULES || []).map(card).join('');
    },
  };
})();
