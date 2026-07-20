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

  // ---- Searchable project selector -----------------------------------------
  // Upgrades a native <select> into a searchable combobox WITHOUT changing a
  // module's logic: the <select> stays the source of truth (its value + change
  // events still fire), so existing `sel.onchange` handlers keep working. Built
  // for large project lists (100+). Safe to call again to refresh after options
  // are repopulated. The trigger button copies the select's classes/inline style
  // so each module's per-topbar look (borderless-until-hover, max-width) carries.
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
    pop.innerHTML =
      '<div class="pd-psel-searchwrap">' +
        '<span class="pd-psel-sico" data-ico="search" data-ico-size="14"></span>' +
        '<input type="text" class="pd-psel-search" placeholder="Search projects…" aria-label="Search projects" />' +
      '</div><div class="pd-psel-list" role="listbox"></div>';
    wrap.appendChild(pop);
    var search = pop.querySelector('.pd-psel-search');
    var list = pop.querySelector('.pd-psel-list');
    if (window.Icons) Icons.hydrate(pop);

    function labelFor(v) {
      var o = Array.prototype.filter.call(sel.options, function (o) { return o.value === v; })[0];
      return o ? o.textContent : '';
    }
    function syncBtn() {
      var t = labelFor(sel.value);
      var ph = !t;
      var txt = t || (sel.options[0] ? sel.options[0].textContent : 'Select…');
      btn.innerHTML = '<span class="pd-psel-txt' + (ph ? ' pd-psel-ph' : '') + '">' + esc(txt) + '</span>' +
        '<span class="pd-psel-caret" data-ico="chevronDown" data-ico-size="14"></span>';
      if (window.Icons) Icons.hydrate(btn);
    }
    function buildList(q) {
      q = (q || '').toLowerCase().trim();
      var html = '';
      Array.prototype.forEach.call(sel.options, function (o) {
        var txt = o.textContent;
        if (q && txt.toLowerCase().indexOf(q) === -1) return;
        html += '<div class="pd-psel-opt' + (o.value === sel.value ? ' is-sel' : '') +
          '" role="option" data-val="' + esc(o.value) + '">' + esc(txt) + '</div>';
      });
      list.innerHTML = html || '<div class="pd-psel-empty">No matching projects</div>';
    }
    function open() { pop.hidden = false; wrap.classList.add('open'); search.value = ''; buildList(''); setTimeout(function () { search.focus(); }, 0); }
    function close() { pop.hidden = true; wrap.classList.remove('open'); }
    function choose(v) {
      if (v !== sel.value) { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      syncBtn(); close();
    }

    btn.onclick = function (e) { e.stopPropagation(); if (pop.hidden) open(); else close(); };
    search.oninput = function () { buildList(this.value); };
    search.onkeydown = function (e) {
      if (e.key === 'Escape') { close(); btn.focus(); }
      else if (e.key === 'Enter') { var f = list.querySelector('.pd-psel-opt'); if (f) choose(f.dataset.val); e.preventDefault(); }
    };
    list.onclick = function (e) { var o = e.target.closest('.pd-psel-opt'); if (o) choose(o.dataset.val); };
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    sel.addEventListener('change', syncBtn);   // stay in sync on programmatic value changes

    var api = { refresh: function () { syncBtn(); if (!pop.hidden) buildList(search.value); }, close: close };
    sel.__pdEnhanced = api;
    syncBtn();
    return api;
  }

  // ---- Collapsible sidebar ----
  // Auto-injects a hamburger toggle into the topbar of any shell page (a page
  // with both .pd-sidebar and .pd-topbar). Desktop: collapses the sidebar to
  // zero width (persisted). Mobile (≤820px): slides the sidebar in/out.
  function initShell() {
    var app = document.querySelector('.pd-app');
    var sidebar = document.querySelector('.pd-sidebar');
    var topbar = document.querySelector('.pd-topbar');
    if (!app || !sidebar || !topbar) return;
    // Fill the "Project Home" sub-caption with the current project (if the nav has that slot).
    var np = document.getElementById('nav-proj');
    if (np) { var pn = sessionStorage.getItem('pd_project_name') || sessionStorage.getItem('pd_project'); np.textContent = pn || 'None selected'; }
    if (topbar.querySelector('.pd-sidebar-toggle')) return;

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

  window.UI = { toast: toast, renderUserBar: renderUserBar, modal: modal, initShell: initShell, enhanceProjectSelect: enhanceProjectSelect };
})();
