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
    mount.innerHTML =
      '<div class="pd-user">' +
        '<button class="pd-avatar" id="pd-avatar-btn" type="button" title="' + esc(label) + '" aria-label="Account menu">' + esc(initials) + '</button>' +
        '<div class="pd-usermenu" id="pd-usermenu">' +
          '<div class="pd-usermenu-head">' +
            '<div class="pd-usermenu-name">' + esc(label) + '</div>' +
            '<div class="pd-usermenu-role">' + esc((profile.role || '').replace(/_/g, ' ')) + '</div>' +
          '</div>' +
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

  // ---- Collapsible sidebar ----
  // Auto-injects a hamburger toggle into the topbar of any shell page (a page
  // with both .pd-sidebar and .pd-topbar). Desktop: collapses the sidebar to
  // zero width (persisted). Mobile (≤820px): slides the sidebar in/out.
  function initShell() {
    var app = document.querySelector('.pd-app');
    var sidebar = document.querySelector('.pd-sidebar');
    var topbar = document.querySelector('.pd-topbar');
    if (!app || !sidebar || !topbar || topbar.querySelector('.pd-sidebar-toggle')) return;

    // Default to collapsed for a clean entry; only an explicit '0' keeps it open.
    if (localStorage.getItem('pd_sidebar_collapsed') !== '0') app.classList.add('pd-collapsed');

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
