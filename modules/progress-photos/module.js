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
    var cur = projects.filter(function (p) { return p.id === pid; })[0];
    projName = cur ? (cur.name || cur.id) : pid;
    sessionStorage.setItem('pd_project', pid);
  }

  function wire() {
    $('pp-project').onchange = async function () {
      pid = this.value;
      sessionStorage.setItem('pd_project', pid);
      restoreUI(); syncChrome();
      await load();
    };
    Array.prototype.forEach.call(document.querySelectorAll('.pp-tab'), function (b) {
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
    Array.prototype.forEach.call(document.querySelectorAll('.pp-tab'), function (b) {
      b.classList.toggle('active', b.dataset.view === view);
    });
    $('pp-add').style.display = canWrite ? '' : 'none';
  }

  // ------------------------------------------------------------------ load ---
  async function load() {
    var host = $('pp-view');
    host.innerHTML = '<div class="pp-empty">Loading photos…</div>';
    if (!pid) { host.innerHTML = '<div class="pp-empty">Select a project to see its photos.</div>'; return; }

    var res = await sb().from(TABLE).select('*')
      .eq('project_id', pid)
      .order('taken_at', { ascending: false })
      .order('sort_order', { ascending: true, nullsFirst: false });
    if (res.error) { host.innerHTML = ''; UI.toast(res.error.message, 'error'); return; }
    rows = res.data || [];

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

    var bar = '<div class="pp-countbar">Showing <strong>' + list.length + '</strong> of ' +
              rows.length + ' photo' + (rows.length === 1 ? '' : 's') +
              (projName ? ' · ' + Fmt.esc(projName) : '') + '</div>';

    if (!rows.length) {
      host.innerHTML = '<div class="pp-empty">' +
        '<span data-ico="camera" data-ico-size="34"></span>' +
        '<p>No photos yet for this project.</p>' +
        (canWrite ? '<p class="pp-hint">Use <strong>+ Add photos</strong> to upload the first batch.</p>' : '') +
        '</div>';
      hydrate(host); return;
    }
    if (!list.length) {
      host.innerHTML = bar + '<div class="pp-empty"><p>No photos match these filters.</p></div>';
      return;
    }

    host.innerHTML = bar + (view === 'gallery' ? galleryHTML(list) : listHTML(list));
    hydrate(host);
    wireRows(host);
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
        return '<div class="pp-row" data-id="' + r.id + '">' +
          '<div class="pp-cell pp-thumbcell">' + thumb(r, 'pp-thumb') + '</div>' +
          '<div class="pp-cell">' + Fmt.esc(r.description || '—') + '</div>' +
          '<div class="pp-cell">' + Fmt.esc(r.trade || '—') + '</div>' +
          '<div class="pp-cell">' + Fmt.esc(r.works || '—') + '</div>' +
          '<div class="pp-cell">' + Fmt.esc(r.location || '—') + '</div>' +
          '<div class="pp-cell pp-date">' + (r.taken_at ? Fmt.date(r.taken_at) : '—') + '</div>' +
          '<div class="pp-cell">' + rowActions(r) + '</div>' +
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
      var res = await sb().from(TABLE).update(patch).eq('id', r.id);
      if (res.error) { UI.toast(res.error.message, 'error'); this.disabled = false; return; }
      m.close(); UI.toast('Photo updated', 'ok');
      await load();
    };
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

  return { init: init, _closeLightbox: closeLightbox, _stepLightbox: stepLightbox };
})();
