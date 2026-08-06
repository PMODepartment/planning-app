// ============================================================================
// Progress Photos — Photos Database
// ----------------------------------------------------------------------------
// Replaces the Power Apps "Progress Photos | Photos Database" screen:
//   • Project-scoped photo log: PHOTO · DESCRIPTION · TRADE · WORKS · LOCATION
//     · CAPTURE DATE
//   • Filters: capture start/end, trade, works, location, free-text search
//   • List View  — grouped by trade, thumbnail + row actions (open / download)
//   • Gallery View — large photo cards with the detail table beneath
//   • Lightbox (the Power Apps fullscreen expand), keyboard-navigable
//   • Upload many photos at once against one set of shared fields
//   • Private `progress-photos` storage bucket; viewed via signed URLs
// ============================================================================

window.ProgressPhotos = (function () {
  var TABLE  = 'progress_photos';
  var BUCKET = 'progress-photos';
  var SIGN_TTL = 3600;               // signed-URL lifetime (s); refreshed on reload

  var profile = null, uid = null, pid = null, projName = '';
  var rows = [];
  var view = 'list';                 // list | gallery
  var filters = { from: '', to: '', trade: '', works: '', location: '', search: '' };
  var collapsed = {};                // trade -> true
  var urlCache = {};                 // storage path -> signed URL
  var canWrite = false;              // planner+ / admin / super_admin
  var lightboxIds = [], lightboxAt = 0;
  var projectListeners = [];         // PPR screen subscribes; both share one selector

  // ===== live collaboration (presence + "who's editing this photo") =========
  // Shared PDCollab layer (Supabase Realtime): topbar avatars, a colored flag on
  // the photo row/card a teammate has open in the Edit modal, and live gallery
  // updates when someone saves/uploads/deletes. Images themselves still need a
  // connection (the signed-URL preview is fetched on the remote change), but the
  // gallery structure + metadata stream live.
  var _collab = null, _remoteSel = {};
  function _selfName() { return (profile && (profile.name || profile.email)) || 'Someone'; }
  function joinCollab() {
    if (!window.PDCollab) return;
    if (_collab) { _collab.leave(); _collab = null; }
    _remoteSel = {};
    if (!pid) { renderPresence([]); return; }
    _collab = PDCollab.join({
      key: 'progress_photos:' + pid, table: TABLE, projectId: pid,
      self: { id: uid, name: _selfName() },
      onPresence: function (members) {
        renderPresence(members);
        _remoteSel = {}; members.forEach(function (m) { if (!m.self && m.sel) _remoteSel[m.id] = { id: m.id, name: m.name, color: m.color, sel: m.sel }; });
        paintRemote();
      },
      onSelection: function (d) { if (d.sel) _remoteSel[d.id] = { id: d.id, name: d.name, color: d.color, sel: d.sel }; else delete _remoteSel[d.id]; paintRemote(); },
      onRemoteChange: applyRemoteChange
    });
  }
  function renderPresence(members) { var el = $('pp-presence'); if (el) el.innerHTML = window.PDCollab ? PDCollab.avatarsHTML(members || []) : ''; }
  function broadcastCollabSel(photoId, editing) { if (_collab) _collab.setSelection(photoId ? { rowId: photoId, editing: !!editing } : null); }
  function paintRemote() {
    if (!window.PDCollab) return;
    var host = $('pp-view'); if (!host) return;
    PDCollab.clearCells(host);
    Object.keys(_remoteSel).forEach(function (k) {
      var m = _remoteSel[k]; if (!m || !m.sel || !m.sel.rowId) return;
      var rid = (window.CSS && CSS.escape) ? CSS.escape(String(m.sel.rowId)) : m.sel.rowId;
      var node = host.querySelector('.pp-row[data-id="' + rid + '"] .pp-thumbcell') ||
                 host.querySelector('.pp-card[data-id="' + rid + '"] .pp-cardimg') ||
                 host.querySelector('[data-id="' + rid + '"]');
      if (node) PDCollab.paintCell(node, m);
    });
  }
  async function applyRemoteChange(payload) {
    var evt = payload.eventType || payload.event;
    var rec = payload['new'] || payload.record || null, old = payload['old'] || payload.old_record || null;
    if (evt === 'DELETE') { var did = old && old.id; if (did == null) return; rows = rows.filter(function (x) { return String(x.id) !== String(did); }); }
    else if (rec) {
      var j = -1; for (var i = 0; i < rows.length; i++) { if (String(rows[i].id) === String(rec.id)) { j = i; break; } }
      if (j < 0) rows.push(rec); else rows[j] = rec;
      // A newly-inserted / re-pathed photo has no signed URL yet — sign it so the
      // preview shows live (needs a connection; falls back to the placeholder).
      if (rec.photo_url && !urlCache[rec.photo_url]) { try { await signOne(rec.photo_url); } catch (e) {} }
    } else return;
    if (window.PDSync) PDSync.cachePut('pp:' + pid, rows);
    fillFilterOptions();
    render();
  }
  async function signOne(path) {
    var res = await sb().storage.from(BUCKET).createSignedUrl(path, SIGN_TTL);
    if (res && res.data && res.data.signedUrl) urlCache[path] = res.data.signedUrl;
  }

  // Trades mirror the WPM (procurement) trade vocabulary so photos, work
  // packages and cash-out all speak the same language.
  var TRADES = [
    'Site Works', 'Civil Works', 'Structural Works', 'Architectural Works',
    'Mechanical Works', 'Electrical and Auxiliary Works',
    'Plumbing and Sanitary Works', 'Fire Protection Works',
    'General Requirements'
  ];

  function sb() { return AppAuth.getSB(); }
  function $(id) { return document.getElementById(id); }

  // UI.modal() takes no width and doesn't wire close buttons, so do both here
  // rather than touching the shared ui.js (module contract §1).
  function openModal(html, width) {
    var m = UI.modal(html);
    var box = m.el.querySelector('.pd-modal');
    if (box && width) box.style.maxWidth = width + 'px';
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-close]'), function (b) {
      b.onclick = m.close;
    });
    if (window.Icons && Icons.hydrate) Icons.hydrate(m.el);
    return m;
  }

  // ---- per-project UI persistence ------------------------------------------
  function uiKey(k) { return 'pp_' + k + '_' + pid; }
  function saveUI() {
    try {
      localStorage.setItem(uiKey('view'), view);
      localStorage.setItem(uiKey('collapsed'), JSON.stringify(collapsed));
    } catch (e) {}
  }
  function restoreUI() {
    try {
      var v = localStorage.getItem(uiKey('view'));
      if (v === 'list' || v === 'gallery') view = v;
      collapsed = JSON.parse(localStorage.getItem(uiKey('collapsed')) || '{}') || {};
    } catch (e) { collapsed = {}; }
  }

  // ------------------------------------------------------------------ init ---
  async function init(user, prof) {
    profile = prof; uid = user.id;
    canWrite = ['super_admin', 'admin', 'planner'].indexOf(prof.role) >= 0;
    pid = sessionStorage.getItem('pd_project') || '';
    restoreUI();

    await fillProjects();
    wire();
    syncChrome();
    await load();
    joinCollab();
  }

  async function fillProjects() {
    var sel = $('pp-project');
    var projects = await PDb.getProjects();
    projects = projects.filter(function (p) { return AppAuth.canAccessProject(profile, p.id); });
    if (!projects.length) { sel.innerHTML = '<option value="">No projects</option>'; return; }
    if (!pid || !projects.some(function (p) { return p.id === pid; })) pid = projects[0].id;
    sel.innerHTML = projects.map(function (p) {
      return '<option value="' + Fmt.esc(p.id) + '"' + (p.id === pid ? ' selected' : '') + '>' +
             Fmt.esc(p.name || p.id) + '</option>';
    }).join('');
    UI.enhanceProjectSelect(sel);   // shared searchable project picker
    var cur = projects.filter(function (p) { return p.id === pid; })[0];
    projName = cur ? (cur.name || cur.id) : pid;
    sessionStorage.setItem('pd_project', pid);
    sessionStorage.setItem('pd_project_name', projName);
    notifyProject();
  }

  function notifyProject() {
    projectListeners.forEach(function (fn) {
      try { fn(pid, projName); } catch (e) { console.error(e); }
    });
  }

  function wire() {
    $('pp-project').onchange = async function () {
      pid = this.value;
      var opt = this.options[this.selectedIndex];
      projName = opt ? opt.textContent : pid;
      sessionStorage.setItem('pd_project', pid);
      sessionStorage.setItem('pd_project_name', projName);
      restoreUI(); syncChrome(); notifyProject();
      await load();
      joinCollab();
    };
    // List/Gallery is the shared .pd-viewtoggle. NB: `.pp-tab` now means the
    // topbar's Photos|PPRs screen tabs — don't select on it here.
    Array.prototype.forEach.call(document.querySelectorAll('.pd-vt[data-view]'), function (b) {
      b.onclick = function () { view = b.dataset.view; saveUI(); syncChrome(); render(); };
    });
    ['from', 'to', 'trade', 'works', 'location', 'search'].forEach(function (k) {
      var el = $('pp-f-' + k);
      if (!el) return;
      el.oninput = el.onchange = function () { filters[k] = this.value; render(); };
    });
    $('pp-clearfilters').onclick = function () {
      filters = { from: '', to: '', trade: '', works: '', location: '', search: '' };
      ['from', 'to', 'trade', 'works', 'location', 'search'].forEach(function (k) {
        var el = $('pp-f-' + k); if (el) el.value = '';
      });
      render();
    };
    $('pp-add').onclick = function () { openUpload(); };
    $('pp-refresh').onclick = function () { load(); };

    document.addEventListener('keydown', function (e) {
      if (!$('pp-lightbox') || $('pp-lightbox').hidden) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') stepLightbox(1);
      if (e.key === 'ArrowLeft') stepLightbox(-1);
    });
  }

  function syncChrome() {
    Array.prototype.forEach.call(document.querySelectorAll('.pd-vt[data-view]'), function (b) {
      b.classList.toggle('active', b.dataset.view === view);
    });
    // The upload action + its divider are planner+ only.
    ['pp-add', 'pp-sep-photos'].forEach(function (id) {
      var el = $(id); if (el) el.style.display = canWrite ? '' : 'none';
    });
  }

  // ------------------------------------------------------------------ load ---
  async function load() {
    var host = $('pp-view');
    host.innerHTML = '<div class="pp-empty">Loading photos…</div>';
    if (!pid) { host.innerHTML = '<div class="pp-empty">Select a project to see its photos.</div>'; return; }

    // Keyset-paginate (a single select caps at 1000; a project's photo library can exceed
    // that, silently hiding photos from the grid, PPR picker and bulk actions), then restore
    // the taken_at-desc / sort_order ordering.
    var all = [], last = null;
    while (true) {
      var q = sb().from(TABLE).select('*').eq('project_id', pid).order('id', { ascending: true }).limit(1000);
      if (last) q = q.gt('id', last);
      var res = await q;
      if (res.error) {
        // Offline / fetch failed: fall back to the read-cache so the gallery still
        // opens (metadata edits made offline queue via PDSync and sync on reconnect).
        // Signed image URLs can't be minted offline → previews show the placeholder.
        if (window.PDSync) {
          var c = await PDSync.cacheGet('pp:' + pid);
          if (c && c.rows) { rows = c.rows.slice(); fillFilterOptions(); render(); return; }
        }
        host.innerHTML = ''; UI.toast(res.error.message, 'error'); return;
      }
      var batch = res.data || []; all = all.concat(batch);
      if (batch.length < 1000) break; last = batch[batch.length - 1].id;
    }
    all.sort(function (a, b) {
      var ta = a.taken_at || '', tb = b.taken_at || '';   // taken_at DESC (blank last)
      if (ta !== tb) return ta < tb ? 1 : -1;
      var sa = a.sort_order, sb2 = b.sort_order;           // then sort_order ASC, NULLS LAST
      if (sa == null && sb2 == null) return 0;
      if (sa == null) return 1; if (sb2 == null) return -1;
      return sa - sb2;
    });
    rows = all;
    if (window.PDSync) PDSync.cachePut('pp:' + pid, rows);   // keep the offline cache current

    await signAll();
    fillFilterOptions();
    render();
  }

  // Batch-sign every photo path in one request rather than one call per row.
  async function signAll() {
    urlCache = {};
    var paths = rows.map(function (r) { return r.photo_url; })
                    .filter(function (p) { return !!p; });
    if (!paths.length) return;
    var res = await sb().storage.from(BUCKET).createSignedUrls(paths, SIGN_TTL);
    if (res.error) { UI.toast('Could not load photo previews: ' + res.error.message, 'warn'); return; }
    (res.data || []).forEach(function (d) {
      if (d && d.signedUrl && !d.error) urlCache[d.path] = d.signedUrl;
    });
  }
  function urlOf(r) { return r.photo_url ? urlCache[r.photo_url] : ''; }

  function distinct(field) {
    var seen = {}, out = [];
    rows.forEach(function (r) {
      var v = (r[field] || '').trim();
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out.sort();
  }
  function fillFilterOptions() {
    function fill(id, list, blank) {
      var el = $(id); if (!el) return;
      var keep = el.value;
      el.innerHTML = '<option value="">' + blank + '</option>' + list.map(function (v) {
        return '<option' + (v === keep ? ' selected' : '') + '>' + Fmt.esc(v) + '</option>';
      }).join('');
      if (list.indexOf(keep) < 0) el.value = '';
    }
    fill('pp-f-trade', distinct('trade'), 'Filter by Trade');
    fill('pp-f-works', distinct('works'), 'Filter by Works');
    fill('pp-f-location', distinct('location'), 'Filter by Location');
    var dl = $('pp-works-list');
    if (dl) dl.innerHTML = distinct('works').map(function (v) {
      return '<option value="' + Fmt.esc(v) + '"></option>'; }).join('');
  }

  // --------------------------------------------------------------- filter ---
  function visible() {
    var q = filters.search.trim().toLowerCase();
    return rows.filter(function (r) {
      if (filters.trade && r.trade !== filters.trade) return false;
      if (filters.works && r.works !== filters.works) return false;
      if (filters.location && r.location !== filters.location) return false;
      if (filters.from && (!r.taken_at || r.taken_at < filters.from)) return false;
      if (filters.to && (!r.taken_at || r.taken_at > filters.to)) return false;
      if (q) {
        var hay = [r.description, r.title, r.trade, r.works, r.location]
          .join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  // --------------------------------------------------------------- render ---
  function render() {
    var host = $('pp-view');
    var list = visible();
    lightboxIds = list.map(function (r) { return r.id; });

    // The count + view toggle live in the static list bar (Drawing Register's
    // .dr-listbar pattern), so they don't get rebuilt on every render.
    var count = $('pp-count');
    if (count) {
      count.textContent = rows.length
        ? 'Showing ' + list.length + ' of ' + rows.length + ' photo' + (rows.length === 1 ? '' : 's')
        : '';
    }
    var listbar = document.querySelector('.pp-listbar');
    if (listbar) listbar.style.visibility = rows.length ? '' : 'hidden';

    // Clear-filters only shows when a filter is actually set (no orphan button).
    var anyFilter = ['from', 'to', 'trade', 'works', 'location', 'search']
      .some(function (k) { return filters[k]; });
    var clr = $('pp-clearfilters');
    if (clr) clr.hidden = !anyFilter;

    if (!rows.length) {
      host.innerHTML = '<div class="pp-empty">' +
        '<span data-ico="camera" data-ico-size="34"></span>' +
        '<p>No photos yet for this project.</p>' +
        (canWrite ? '<p class="pp-hint">Use <strong>+ Add photos</strong> to upload the first batch.</p>' : '') +
        '</div>';
      hydrate(host); return;
    }
    if (!list.length) {
      host.innerHTML = '<div class="pp-empty"><p>No photos match these filters.</p></div>';
      return;
    }

    host.innerHTML = (view === 'gallery' ? galleryHTML(list) : listHTML(list));
    hydrate(host);
    wireRows(host);
    paintRemote();
  }

  function hydrate(host) { if (window.Icons && Icons.hydrate) Icons.hydrate(host); }

  function groupByTrade(list) {
    var groups = {}, order = [];
    list.forEach(function (r) {
      var t = (r.trade || '').trim() || 'Untagged';
      if (!groups[t]) { groups[t] = []; order.push(t); }
      groups[t].push(r);
    });
    order.sort();
    return order.map(function (t) { return { trade: t, items: groups[t] }; });
  }

  function rowActions(r) {
    return '<div class="pp-rowacts">' +
      '<button class="pp-iconbtn" data-act="download" data-id="' + r.id + '" title="Download photo">' +
        '<span data-ico="download" data-ico-size="15"></span></button>' +
      '<button class="pp-iconbtn" data-act="open" data-id="' + r.id + '" title="View full size">' +
        '<span data-ico="eye" data-ico-size="15"></span></button>' +
      (canWrite ? '<button class="pp-iconbtn" data-act="edit" data-id="' + r.id + '" title="Edit details">✎</button>' +
                  '<button class="pp-iconbtn pp-del" data-act="del" data-id="' + r.id + '" title="Delete photo">' +
                  '<span data-ico="trash" data-ico-size="15"></span></button>' : '') +
      '</div>';
  }

  function thumb(r, cls) {
    var u = urlOf(r);
    if (!u) return '<div class="' + cls + ' pp-noimg" title="Preview unavailable">' +
                   '<span data-ico="camera" data-ico-size="18"></span></div>';
    return '<img class="' + cls + '" src="' + Fmt.esc(u) + '" loading="lazy" ' +
           'alt="' + Fmt.esc(r.description || 'Progress photo') + '" data-act="open" data-id="' + r.id + '" />';
  }

  function listHTML(list) {
    var head = '<div class="pp-grid-head">' +
      '<div>Photo</div><div>Description</div><div>Trade</div><div>Works</div>' +
      '<div>Location</div><div>Capture Date</div><div></div></div>';

    var body = groupByTrade(list).map(function (g) {
      var isCol = !!collapsed[g.trade];
      var header = '<div class="pp-group" data-trade="' + Fmt.esc(g.trade) + '">' +
        '<span class="pp-caret" data-ico="' + (isCol ? 'chevronRight' : 'chevronDown') + '" data-ico-size="14"></span>' +
        '<strong>' + Fmt.esc(g.trade) + '</strong>' +
        '<span class="pp-groupcount">' + g.items.length + '</span></div>';
      if (isCol) return header;
      return header + g.items.map(function (r) {
        // data-l = the column's label. Unused on desktop (the sticky .pp-grid-head
        // supplies the headings); at phone width the head is hidden and the row
        // restacks under the thumbnail, where each value needs its own label —
        // module.css renders these via .pp-cell[data-l]::before.
        return '<div class="pp-row" data-id="' + r.id + '">' +
          '<div class="pp-cell pp-thumbcell">' + thumb(r, 'pp-thumb') + '</div>' +
          '<div class="pp-cell pp-desc">' + Fmt.esc(r.description || '—') + '</div>' +
          '<div class="pp-cell" data-l="Trade">' + Fmt.esc(r.trade || '—') + '</div>' +
          '<div class="pp-cell" data-l="Works">' + Fmt.esc(r.works || '—') + '</div>' +
          '<div class="pp-cell" data-l="Location">' + Fmt.esc(r.location || '—') + '</div>' +
          '<div class="pp-cell pp-date" data-l="Captured">' + (r.taken_at ? Fmt.date(r.taken_at) : '—') + '</div>' +
          '<div class="pp-cell pp-actcell">' + rowActions(r) + '</div>' +
          '</div>';
      }).join('');
    }).join('');

    return '<div class="pp-grid">' + head + body + '</div>';
  }

  function galleryHTML(list) {
    return '<div class="pp-gallery">' + list.map(function (r) {
      return '<figure class="pp-card" data-id="' + r.id + '">' +
        '<div class="pp-cardimg">' + thumb(r, 'pp-cardphoto') +
          '<button class="pp-expand" data-act="open" data-id="' + r.id + '" title="View full size">⤢</button>' +
        '</div>' +
        '<figcaption>' +
          '<table class="pp-cardtable"><tbody>' +
            trow('Description', r.description) +
            trow('Trade', r.trade) +
            trow('Works', r.works) +
            trow('Location', r.location) +
            trow('Capture Date', r.taken_at ? Fmt.date(r.taken_at) : '') +
          '</tbody></table>' +
          rowActions(r) +
        '</figcaption></figure>';
    }).join('') + '</div>';
  }
  function trow(k, v) {
    return '<tr><th>' + Fmt.esc(k) + '</th><td>' + Fmt.esc(v || '—') + '</td></tr>';
  }

  function wireRows(host) {
    Array.prototype.forEach.call(host.querySelectorAll('.pp-group'), function (g) {
      g.onclick = function () {
        var t = g.dataset.trade;
        collapsed[t] = !collapsed[t];
        saveUI(); render();
      };
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-act]'), function (el) {
      el.onclick = function (e) {
        e.stopPropagation();
        var r = byId(el.dataset.id); if (!r) return;
        var a = el.dataset.act;
        if (a === 'open') openLightbox(r.id);
        else if (a === 'download') download(r);
        else if (a === 'edit') openForm(r);
        else if (a === 'del') remove(r);
      };
    });
  }
  function byId(id) { return rows.filter(function (r) { return r.id === id; })[0]; }

  // ------------------------------------------------------------- lightbox ---
  function openLightbox(id) {
    lightboxAt = lightboxIds.indexOf(id);
    if (lightboxAt < 0) lightboxAt = 0;
    paintLightbox();
    $('pp-lightbox').hidden = false;
  }
  function closeLightbox() { $('pp-lightbox').hidden = true; }
  function stepLightbox(d) {
    if (!lightboxIds.length) return;
    lightboxAt = (lightboxAt + d + lightboxIds.length) % lightboxIds.length;
    paintLightbox();
  }
  function paintLightbox() {
    var r = byId(lightboxIds[lightboxAt]); if (!r) return;
    var u = urlOf(r);
    $('pp-lb-img').src = u || '';
    $('pp-lb-cap').innerHTML =
      '<strong>' + Fmt.esc(r.description || 'Progress photo') + '</strong>' +
      '<span>' + Fmt.esc([r.trade, r.works, r.location].filter(Boolean).join(' · ')) +
      (r.taken_at ? ' · ' + Fmt.date(r.taken_at) : '') + '</span>' +
      '<span class="pp-lb-count">' + (lightboxAt + 1) + ' / ' + lightboxIds.length + '</span>';
  }

  async function download(r) {
    var u = urlOf(r);
    if (!u) { UI.toast('Photo file unavailable', 'error'); return; }
    var a = document.createElement('a');
    a.href = u;
    a.download = (r.photo_url || 'photo').split('/').pop();
    document.body.appendChild(a); a.click(); a.remove();
  }

  // --------------------------------------------------------------- upload ---
  function tradeOptions(val) {
    return '<option value="">—</option>' + TRADES.map(function (t) {
      return '<option' + (val === t ? ' selected' : '') + '>' + Fmt.esc(t) + '</option>';
    }).join('');
  }

  function openUpload() {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    var today = new Date().toISOString().slice(0, 10);
    var html =
      '<div class="pd-modal-header"><h3>Add photos</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<p class="pp-hint">Fields below apply to every photo in this batch — edit any ' +
          'individual photo afterwards.</p>' +
        '<div class="pd-field"><label>Photos</label>' +
          '<input class="pd-input" type="file" id="pp-files" accept="image/*" multiple /></div>' +
        '<div class="pp-form2">' +
          '<div class="pd-field"><label>Description</label>' +
            '<input class="pd-input" id="pp-desc" placeholder="e.g. Model Unit" /></div>' +
          '<div class="pd-field"><label>Capture date</label>' +
            '<input class="pd-input" type="date" id="pp-date" value="' + today + '" /></div>' +
          '<div class="pd-field"><label>Trade</label>' +
            '<select class="pd-select" id="pp-trade">' + tradeOptions('') + '</select></div>' +
          '<div class="pd-field"><label>Works</label>' +
            '<input class="pd-input" id="pp-works" list="pp-works-list" placeholder="e.g. Temporary Facilities" /></div>' +
          '<div class="pd-field pp-span2"><label>Location</label>' +
            '<input class="pd-input" id="pp-loc" placeholder="e.g. Model Unit Entrance" /></div>' +
        '</div>' +
        '<div class="pp-progress" id="pp-prog" hidden></div>' +
      '</div>' +
      '<div class="pd-modal-footer">' +
        '<button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="pp-save">Upload</button></div>';

    var m = openModal(html, 620);
    $('pp-save').onclick = async function () {
      var files = $('pp-files').files;
      if (!files || !files.length) { UI.toast('Choose at least one photo', 'warn'); return; }
      var shared = {
        description: $('pp-desc').value.trim(),
        taken_at: $('pp-date').value || null,
        trade: $('pp-trade').value || null,
        works: $('pp-works').value.trim() || null,
        location: $('pp-loc').value.trim() || null
      };
      this.disabled = true;
      var prog = $('pp-prog'); prog.hidden = false;
      var done = 0, failed = [];

      for (var i = 0; i < files.length; i++) {
        prog.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + '…';
        try {
          var path = await uploadFile(files[i]);
          var row = Object.assign({}, shared, {
            project_id: pid, created_by: uid, photo_url: path, sort_order: i,
            title: files[i].name
          });
          var ins = await sb().from(TABLE).insert(row);
          if (ins.error) throw ins.error;
          done++;
        } catch (err) {
          failed.push(files[i].name + ': ' + (err.message || err));
        }
        await new Promise(function (r) { setTimeout(r, 0); });   // let progress paint
      }

      m.close();
      if (done) UI.toast(done + ' photo' + (done === 1 ? '' : 's') + ' uploaded', 'ok');
      if (failed.length) UI.toast(failed.length + ' failed — ' + failed[0], 'error');
      await load();
    };
  }

  async function uploadFile(file) {
    var safe = file.name.replace(/[^\w.\-]+/g, '_');
    var path = pid + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + safe;
    var res = await sb().storage.from(BUCKET).upload(path, file, { upsert: false });
    if (res.error) throw res.error;
    return path;
  }

  // ----------------------------------------------------------- edit/delete ---
  function openForm(r) {
    broadcastCollabSel(r.id, true);   // tell other viewers I'm editing this photo
    var html =
      '<div class="pd-modal-header"><h3>Edit photo</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        (urlOf(r) ? '<img class="pp-formpreview" src="' + Fmt.esc(urlOf(r)) + '" alt="" />' : '') +
        '<div class="pp-form2">' +
          '<div class="pd-field"><label>Description</label>' +
            '<input class="pd-input" id="pp-e-desc" value="' + Fmt.esc(r.description || '') + '" /></div>' +
          '<div class="pd-field"><label>Capture date</label>' +
            '<input class="pd-input" type="date" id="pp-e-date" value="' + Fmt.esc(r.taken_at || '') + '" /></div>' +
          '<div class="pd-field"><label>Trade</label>' +
            '<select class="pd-select" id="pp-e-trade">' + tradeOptions(r.trade || '') + '</select></div>' +
          '<div class="pd-field"><label>Works</label>' +
            '<input class="pd-input" id="pp-e-works" list="pp-works-list" value="' + Fmt.esc(r.works || '') + '" /></div>' +
          '<div class="pd-field pp-span2"><label>Location</label>' +
            '<input class="pd-input" id="pp-e-loc" value="' + Fmt.esc(r.location || '') + '" /></div>' +
        '</div>' +
      '</div>' +
      '<div class="pd-modal-footer">' +
        '<button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="pp-e-save">Save</button></div>';

    var m = openModal(html, 560);
    // Clear the "editing this photo" cursor on every close path (× / Cancel).
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-close]'), function (b) {
      b.onclick = function () { broadcastCollabSel(null); m.close(); };
    });
    $('pp-e-save').onclick = async function () {
      this.disabled = true;
      var patch = {
        description: $('pp-e-desc').value.trim(),
        taken_at: $('pp-e-date').value || null,
        trade: $('pp-e-trade').value || null,
        works: $('pp-e-works').value.trim() || null,
        location: $('pp-e-loc').value.trim() || null,
        updated_at: new Date().toISOString()
      };
      // Offline-capable metadata edit: apply optimistically, then route through
      // PDSync (field-level LWW; queues offline and syncs on reconnect). Only the
      // description/trade/works/location/date change — the image is untouched.
      Object.assign(r, patch);
      broadcastCollabSel(null); m.close();
      fillFilterOptions(); render();
      if (window.PDSync) {
        var w = await PDSync.write({ table: TABLE, op: 'update', id: r.id, patch: patch });
        if (!w.ok) { UI.toast(w.error ? w.error.message : 'Save failed', 'error'); return; }
        UI.toast(w.queued ? 'Saved on this device — will sync when you reconnect' : 'Photo updated', 'ok');
        PDSync.cachePut('pp:' + pid, rows);
      } else {
        var res = await sb().from(TABLE).update(patch).eq('id', r.id);
        if (res.error) { UI.toast(res.error.message, 'error'); return; }
        UI.toast('Photo updated', 'ok');
      }
    };

    // Autosave (metadata only — no re-upload involved): debounced re-use of the
    // Save button's own handler, with the modal's close suppressed meanwhile.
    if (window.Autosave) {
      var asInd = document.createElement('span');
      asInd.className = 'pd-autosave pd-autosave-idle';
      asInd.textContent = 'Autosave on';
      var hdr = m.el.querySelector('.pd-modal-header');
      if (hdr) hdr.insertBefore(asInd, hdr.querySelector('.pd-modal-close'));
      var as = Autosave.wire({ root: m.el, modal: m, saveBtn: $('pp-e-save'), indicator: asInd });
      var _ppClose = m.close;
      m.close = function () { as.cancel(); _ppClose(); };
    }
  }

  async function remove(r) {
    var html =
      '<div class="pd-modal-header"><h3>Delete photo</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><p>Delete <strong>' + Fmt.esc(r.description || r.title || 'this photo') +
        '</strong>? The image file is removed from storage too. This cannot be undone.</p></div>' +
      '<div class="pd-modal-footer">' +
        '<button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-danger" id="pp-d-yes">Delete</button></div>';
    var m = openModal(html, 460);
    $('pp-d-yes').onclick = async function () {
      this.disabled = true;
      var res = await sb().from(TABLE).delete().eq('id', r.id);
      if (res.error) { UI.toast(res.error.message, 'error'); this.disabled = false; return; }
      if (r.photo_url) { try { await sb().storage.from(BUCKET).remove([r.photo_url]); } catch (e) {} }
      m.close(); UI.toast('Photo deleted', 'ok');
      await load();
    };
  }

  return {
    init: init,
    // The PPR screen shares this module's project selector + trade vocabulary.
    onProject: function (fn) { projectListeners.push(fn); if (pid) fn(pid, projName); },
    trades: function () { return TRADES.slice(); },
    _syncChrome: syncChrome,
    _closeLightbox: closeLightbox,
    _stepLightbox: stepLightbox
  };
})();
