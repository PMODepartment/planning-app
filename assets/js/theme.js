// ============================================================================
// Planners Dashboard — Dark mode (shared, automatic)
// ----------------------------------------------------------------------------
// Load this FIRST in <head> of every page (before the stylesheet paints) so the
// saved theme is applied with no flash of the wrong colors. It:
//   • applies the saved/system theme immediately by toggling `pd-dark` on <html>
//   • on DOMContentLoaded, auto-injects a 🌙/☀️ toggle button:
//       - into the .pd-topbar (shell pages), or
//       - as a floating round button (auth pages with no topbar)
//   • persists the choice in localStorage 'pd_theme'
//
// Dark mode works by remapping the --pd-* CSS variables under `html.pd-dark`
// (see dashboard.css), so every token-driven element adapts automatically.
// Module developers: just include this script — no other work needed.
// ============================================================================

(function () {
  var KEY = 'pd_theme';

  function preferred() {
    try { var t = localStorage.getItem(KEY); if (t === 'dark' || t === 'light') return t; } catch (e) {}
    return (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  function apply(mode) {
    document.documentElement.classList.toggle('pd-dark', mode === 'dark');
  }
  function current() {
    return document.documentElement.classList.contains('pd-dark') ? 'dark' : 'light';
  }

  // FOUC-prevention: run immediately (this script is in <head>).
  apply(preferred());

  function icon(mode) { return mode === 'dark' ? '☀️' : '🌙'; }

  function inject() {
    if (document.getElementById('pd-theme-toggle')) return;
    var btn = document.createElement('button');
    btn.id = 'pd-theme-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle dark mode');
    btn.title = 'Toggle dark mode';
    btn.textContent = icon(current());
    btn.onclick = function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
      btn.textContent = icon(next);
    };
    var topbar = document.querySelector('.pd-topbar');
    if (topbar) {
      btn.className = 'pd-theme-toggle';
      var ub = topbar.querySelector('#user-bar');
      if (ub) topbar.insertBefore(btn, ub); else topbar.appendChild(btn);
    } else {
      btn.className = 'pd-theme-toggle pd-theme-toggle-float';
      document.body.appendChild(btn);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();

  window.PDTheme = { apply: apply, current: current };
})();
