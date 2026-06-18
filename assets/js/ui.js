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

  // ---- User bar (top-right): name + role + logout ----
  function renderUserBar(profile, mountId) {
    var mount = document.getElementById(mountId || 'user-bar');
    if (!mount || !profile) return;
    mount.innerHTML =
      '<span class="pd-userbar-name">' + (profile.name || profile.email) + '</span>' +
      '<span class="pd-userbar-role">' + (profile.role || '') + '</span>' +
      '<button class="pd-userbar-logout" id="pd-logout">Logout</button>';
    var btn = document.getElementById('pd-logout');
    if (btn) btn.onclick = function () { window.AppAuth.logout(); };
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

  // ---- Collapsible sidebar ----
  // Auto-injects a hamburger toggle into the topbar of any shell page (a page
  // with both .pd-sidebar and .pd-topbar). Desktop: collapses the sidebar to
  // zero width (persisted). Mobile (≤820px): slides the sidebar in/out.
  function initShell() {
    var app = document.querySelector('.pd-app');
    var sidebar = document.querySelector('.pd-sidebar');
    var topbar = document.querySelector('.pd-topbar');
    if (!app || !sidebar || !topbar || topbar.querySelector('.pd-sidebar-toggle')) return;

    if (localStorage.getItem('pd_sidebar_collapsed') === '1') app.classList.add('pd-collapsed');

    var btn = document.createElement('button');
    btn.className = 'pd-sidebar-toggle';
    btn.setAttribute('aria-label', 'Toggle menu');
    btn.innerHTML = '<span></span><span></span><span></span>';
    btn.onclick = function () {
      if (window.matchMedia('(max-width: 820px)').matches) {
        sidebar.classList.toggle('open');
      } else {
        app.classList.toggle('pd-collapsed');
        localStorage.setItem('pd_sidebar_collapsed', app.classList.contains('pd-collapsed') ? '1' : '0');
      }
    };
    topbar.insertBefore(btn, topbar.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShell);
  } else { initShell(); }

  window.UI = { toast: toast, renderUserBar: renderUserBar, modal: modal, initShell: initShell };
})();
