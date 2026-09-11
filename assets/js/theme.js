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

  // ⚠️⚠️ FLASH OF THE PRE-JS TAB STRIP, and this is the ONLY script that can prevent it.
  // Six modules ship a flat <div class="x-tabs pd-tabsrc"> that UI.tabsToDropdown() collapses
  // into a compact dropdown. Every module's scripts sit at the END of <body>, so the body paints
  // with that full-width tab row and only then does the conversion run and remove it.
  // MEASURED on the live Risk Register: stylesheets ready at 66ms, DOMContentLoaded at 135ms on a
  // WARM cache -- but 1601ms on a COLD one, which is every load after a deploy bumps `?v=`. So the
  // raw row sat on screen for over a second and then vanished, which is exactly the "it shows the
  // previous UI for a split second" the owner reported.
  // `pd-js` is set HERE because this file is the only one guaranteed to run before first paint;
  // dashboard.css hides `.pd-tabsrc` while it is present.
  document.documentElement.classList.add('pd-js');

  // ⚠️ FAILSAFE, and it must NOT live in ui.js. The modules call tabsToDropdown behind
  // `if (window.UI && UI.tabsToDropdown)`, i.e. they degrade to the raw tabs on purpose when ui.js
  // is missing. Hiding the strip from CSS would turn that graceful degradation into a module with
  // no navigation at all, so the reveal has to come from a file that does not depend on ui.js.
  // Anything still unconverted once the page has settled gets shown.
  function revealUnconverted() {
    var left = document.querySelectorAll('.pd-tabsrc:not(.pd-tabsdrop-src)');
    for (var i = 0; i < left.length; i++) left[i].classList.remove('pd-tabsrc');
  }
  window.addEventListener('load', function () { setTimeout(revealUnconverted, 0); });
  setTimeout(revealUnconverted, 4000);

  function icon(mode) {
    var s = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    if (mode === 'dark') {
      // sun (click to go light)
      return s + '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/></svg>';
    }
    // moon (click to go dark)
    return s + '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z"/></svg>';
  }

  function inject() {
    if (document.getElementById('pd-theme-toggle')) return;
    var btn = document.createElement('button');
    btn.id = 'pd-theme-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle dark mode');
    btn.title = 'Toggle dark mode';
    btn.innerHTML = icon(current());
    btn.onclick = function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
      btn.innerHTML = icon(next);
    };
    var topbar = document.querySelector('.pd-topbar');
    if (topbar) {
      btn.className = 'pd-theme-toggle';
      var ub = topbar.querySelector('#user-bar');
      // ⚠️⚠️ INSERT RELATIVE TO `ub`, NOT TO `topbar` — this threw and cost the theme toggle.
      // `topbar.querySelector('#user-bar')` is a DESCENDANT search, but `insertBefore` demands a
      // direct child, and UI.initModuleTopbar() moves #user-bar down into `.pd-tb-main`. With a
      // CACHED SESSION AppAuth.requireLogin's callback resolves in a microtask — before the
      // DOMContentLoaded task that runs this — so on a logged-in load initModuleTopbar had
      // already moved it and this threw NotFoundError, killing the rest of inject() and leaving
      // the page with NO theme toggle. Invisible when logged out, which is why it survived.
      if (ub) ub.parentNode.insertBefore(btn, ub); else topbar.appendChild(btn);
    } else {
      btn.className = 'pd-theme-toggle pd-theme-toggle-float';
      document.body.appendChild(btn);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();

  // ---- PWA offline resilience (installable + network-first service worker) ----
  // Derive the app root from THIS script's own URL so it works at any page depth
  // (root pages and modules/<name>/ pages alike).
  var _root = (function () {
    try {
      var s = document.currentScript && document.currentScript.src;
      if (!s) { var els = document.getElementsByTagName('script'); for (var i = 0; i < els.length; i++) { if (/assets\/js\/theme\.js/.test(els[i].src)) { s = els[i].src; break; } } }
      return s ? s.replace(/assets\/js\/theme\.js.*$/, '') : null;
    } catch (e) { return null; }
  })();
  if (_root) {
    if (!document.querySelector('link[rel="manifest"]')) {
      var lk = document.createElement('link'); lk.rel = 'manifest'; lk.href = _root + 'manifest.webmanifest'; document.head.appendChild(lk);
    }
    if (!document.querySelector('meta[name="theme-color"]')) {
      var mc = document.createElement('meta'); mc.name = 'theme-color'; mc.content = '#EE3124'; document.head.appendChild(mc);
    }
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () { navigator.serviceWorker.register(_root + 'sw.js', { scope: _root }).catch(function () {}); });
    }
  }

  // ---- Connectivity indicator (pure UI; no caching risk) ----
  function offlineBadge() {
    var ID = 'pd-offline-badge', _pdFlush = false;
    function render(msg, color) {
      var el = document.getElementById(ID);
      if (!msg) { if (el) el.style.display = 'none'; return; }
      if (!el) {
        el = document.createElement('div'); el.id = ID;
        el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:99999;color:#fff;padding:7px 14px;border-radius:999px;font:600 12px/1.2 system-ui,-apple-system,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);max-width:92vw;text-align:center;';
        document.body.appendChild(el);
      }
      el.textContent = msg; el.style.background = color; el.style.display = 'block';
    }
    function upd() {
      // On modules that opted into offline editing (PDSync present), the message is accurate:
      // edits are queued locally and synced on reconnect. Elsewhere, keep the conservative text.
      var sync = window.PDSync, pending = sync ? sync.pendingCount() : 0;
      if (!navigator.onLine) {
        render(sync
          ? ('Offline — your edits are saved on this device' + (pending ? ' (' + pending + ' pending)' : '') + ' and will sync when you reconnect.')
          : 'Offline — showing last-loaded data; changes won’t save until you reconnect.', '#B45309');
      } else if (sync && (pending > 0 || _pdFlush)) {
        render('Syncing ' + pending + ' change' + (pending === 1 ? '' : 's') + '…', '#1a73e8');
      } else { render(null); }
    }
    window.addEventListener('online', upd); window.addEventListener('offline', upd);
    if (window.PDSync && window.PDSync.onStatus) window.PDSync.onStatus(function (st) { _pdFlush = st.flushing; upd(); });
    upd();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', offlineBadge);
  else offlineBadge();

  window.PDTheme = { apply: apply, current: current };
})();
