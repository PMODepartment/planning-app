// ============================================================================
// Progress Photos — Floor Plan overlay (brief Section 6B / Phase 5)
// ----------------------------------------------------------------------------
// ⚠️ SCOPE NOTE, stated up front because "BIM Model Overlay" invites a much
// bigger reading than what's built here. This is a 2D FLOOR-PLAN PIN
// NAVIGATOR — upload a floor plan image, place pins on it that each point at
// a panorama / 3D reconstruction / progress photo, click a pin to open that
// capture. It does NOT import, register against, or overlay a real BIM/IFC
// model, and it does NOT attempt true 3D-to-2D registration of a
// reconstruction's point cloud onto the floor plan (that would need known
// camera poses relative to the floor plan's own coordinate frame — a real,
// separate computer-vision problem). This is the same kind of honest scope
// reduction as Phase 3's cylinder-instead-of-true-equirectangular panorama —
// stated here rather than silently shipped under the bigger name.
// ============================================================================

window.BIM = (function () {
  var T_PLAN = 'floor_plans';
  var T_PIN  = 'floor_plan_pins';
  var BUCKET = 'progress-photos';
  var SIGN_TTL = 3600;

  var profile = null, uid = null, pid = null, projName = '';
  var canWrite = false;
  var plans = [], activePlanId = null, pins = [];
  var planUrlCache = {};
  var placeMode = false;

  // Pan/zoom state for the stage — plain translate+scale on a wrapper div,
  // not an SVG viewBox/CTM: simpler to reason about and to test (normalized
  // pin position is read straight off the rendered <img>'s own bounding box,
  // which already reflects the current zoom/pan — no matrix math needed).
  var zoom = 1, panX = 0, panY = 0;
  var MIN_ZOOM = 0.2, MAX_ZOOM = 6;

  function sb() { return AppAuth.getSB(); }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return Fmt.esc(s); }

  function openModal(html, width) {
    var m = UI.modal(html);
    var box = m.el.querySelector('.pd-modal');
    if (box && width) box.style.maxWidth = width + 'px';
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-close]'), function (b) { b.onclick = m.close; });
    if (window.Icons && Icons.hydrate) Icons.hydrate(m.el);
    return m;
  }

  function init(user, prof) {
    profile = prof; uid = user.id;
    canWrite = ['super_admin', 'admin', 'planner'].indexOf(prof.role) >= 0;
    wire();
    ProgressPhotos.onProject(function (p, name) { pid = p; projName = name; load(); });
  }

  function wire() {
    if ($('bim-new')) $('bim-new').onclick = openPlanForm;
    if ($('bim-place')) $('bim-place').onclick = togglePlaceMode;
    if ($('bim-plan-select')) $('bim-plan-select').onchange = function () {
      activePlanId = this.value || null;
      resetView();
      loadPins();
    };
  }
  function syncTools(visible) {
    if ($('bim-new')) $('bim-new').style.display = (visible && canWrite) ? '' : 'none';
    if ($('bim-place')) $('bim-place').style.display = (visible && canWrite && activePlanId) ? '' : 'none';
  }

  function resetView() { zoom = 1; panX = 0; panY = 0; }

  async function load() {
    var host = $('bim-view');
    if (!host) return;
    if (!pid) { host.innerHTML = '<div class="pp-empty">Select a project.</div>'; return; }
    host.innerHTML = '<div class="pp-empty">Loading floor plans…</div>';
    try {
      plans = await PDb.selectAll(T_PLAN, function (q) { return q.eq('project_id', pid); });
      plans.sort(function (a, b) { return (a.level_order || 0) - (b.level_order || 0); });
    } catch (e) {
      plans = [];
      if (!/schema cache|does not exist/i.test((e && e.message) || '')) UI.toast(e.message || String(e), 'error');
    }
    if (!plans.some(function (p) { return p.id === activePlanId; })) {
      activePlanId = plans.length ? plans[0].id : null;
    }
    await signPlanUrls();
    resetView();
    await loadPins();
  }

  async function signPlanUrls() {
    planUrlCache = {};
    var paths = plans.map(function (p) { return p.image_url; }).filter(Boolean);
    if (!paths.length) return;
    var res = await sb().storage.from(BUCKET).createSignedUrls(paths, SIGN_TTL);
    (res.data || []).forEach(function (d, i) { if (!d.error) planUrlCache[paths[i]] = d.signedUrl; });
  }
  function planUrl(p) { return p && p.image_url ? (planUrlCache[p.image_url] || '') : ''; }
  function activePlan() { return plans.filter(function (p) { return p.id === activePlanId; })[0] || null; }

  async function loadPins() {
    if (!activePlanId) { pins = []; render(); return; }
    try {
      pins = await PDb.selectAll(T_PIN, function (q) { return q.eq('floor_plan_id', activePlanId); });
    } catch (e) {
      pins = [];
      if (!/schema cache|does not exist/i.test((e && e.message) || '')) UI.toast(e.message || String(e), 'error');
    }
    render();
  }

  function hydrate() { if (window.Icons && Icons.hydrate) Icons.hydrate($('bim-view')); }

  function render() {
    var host = $('bim-view');
    if (!host) return;
    syncTools(true);

    if (!plans.length) {
      host.innerHTML = '<div class="pp-empty">' +
        '<span data-ico="compass" data-ico-size="34"></span>' +
        '<p>No floor plans uploaded yet for this project.</p>' +
        (canWrite ? '<p class="pp-hint">Press <strong>+ Upload floor plan</strong> to add one, then place pins ' +
          'linking it to your 360° captures, 3D scans and photos.</p>' : '') +
        '</div>';
      return;
    }

    var plan = activePlan();
    var url = planUrl(plan);
    var aspect = (plan && plan.width_px && plan.height_px) ? (plan.height_px / plan.width_px) : 0.75;

    var html =
      '<div class="bim-toolbar">' +
        '<select class="pd-select" id="bim-plan-select">' +
          plans.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === activePlanId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
        '</select>' +
        '<span class="pp-hint">Ctrl+scroll to zoom · drag to pan' + (placeMode ? ' · click the plan to place a pin' : '') + '</span>' +
        (placeMode ? '<span class="bim-placebadge">Place-pin mode is ON</span>' : '') +
      '</div>' +
      '<div class="bim-stage-outer" id="bim-stage-outer">' +
        '<div class="bim-stage-inner" id="bim-stage-inner" style="transform:translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ');">' +
          '<div class="bim-imgwrap" id="bim-imgwrap" style="padding-bottom:' + (aspect * 100) + '%;">' +
            (url ? '<img id="bim-img" src="' + esc(url) + '" draggable="false" />' :
              '<div class="pp-empty" style="position:absolute;inset:0;">Plan image not available</div>') +
            pins.map(pinMarkerHTML).join('') +
          '</div>' +
        '</div>' +
      '</div>';
    host.innerHTML = html;
    wirePlan();
    wireStageInteractions();
    hydrate();
  }

  function pinIcon(type) {
    return type === 'panorama' ? 'compass' : (type === 'reconstruction' ? 'box' : 'camera');
  }
  function pinMarkerHTML(pin) {
    return '<button class="bim-pin bim-pin-' + esc(pin.item_type) + '" data-pin="' + esc(pin.id) + '" ' +
      'style="left:' + (pin.x_norm * 100) + '%;top:' + (pin.y_norm * 100) + '%;" ' +
      'title="' + esc(pin.label || pin.item_type) + '">' +
      '<span data-ico="' + pinIcon(pin.item_type) + '" data-ico-size="13"></span></button>';
  }

  function wirePlan() {
    if ($('bim-plan-select')) $('bim-plan-select').onchange = function () {
      activePlanId = this.value || null;
      resetView();
      loadPins();
    };
    Array.prototype.forEach.call($('bim-view').querySelectorAll('[data-pin]'), function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        if (placeMode) return; // in place mode, clicks on the plan (not existing pins) are what matter
        openPin(this.dataset.pin);
      };
    });
  }

  function openPin(pinId) {
    var pin = pins.filter(function (p) { return p.id === pinId; })[0];
    if (!pin) return;
    if (pin.item_type === 'panorama') { if (window.PANO && PANO.open) PANO.open(pin.item_id); }
    else if (pin.item_type === 'reconstruction') { if (window.RECON && RECON.openById) RECON.openById(pin.item_id); }
    else if (pin.item_type === 'photo') { if (window.ProgressPhotos && ProgressPhotos.openPhotoById) ProgressPhotos.openPhotoById(pin.item_id); }
  }

  function togglePlaceMode() {
    placeMode = !placeMode;
    if ($('bim-place')) $('bim-place').classList.toggle('is-active', placeMode);
    render();
  }

  // ------------------------------------------------------- pan/zoom/click ---
  function wireStageInteractions() {
    var outer = $('bim-stage-outer');
    if (!outer) return;
    var dragging = false, lastX = 0, lastY = 0, moved = false;

    outer.addEventListener('wheel', function (e) {
      if (!e.ctrlKey && !e.metaKey) return; // plain scroll is left for the page; Ctrl+scroll zooms, matching this app's Equipment Loading site-plan convention
      e.preventDefault();
      var rect = outer.getBoundingClientRect();
      var cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      var prevZoom = zoom;
      zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
      // Keep the point under the cursor stationary while zooming, same
      // anchor-preserving approach as the site-plan zoom this mirrors.
      panX = cx - (cx - panX) * (zoom / prevZoom);
      panY = cy - (cy - panY) * (zoom / prevZoom);
      applyTransform();
    }, { passive: false });

    outer.addEventListener('mousedown', function (e) {
      if (e.target.closest && e.target.closest('[data-pin]')) return;
      dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      panX += dx; panY += dy; lastX = e.clientX; lastY = e.clientY;
      applyTransform();
    });
    window.addEventListener('mouseup', function () { dragging = false; });

    outer.addEventListener('click', function (e) {
      if (!placeMode || moved) return;
      if (e.target.closest && e.target.closest('[data-pin]')) return;
      var img = $('bim-img'); if (!img) { UI.toast('Upload a floor plan image first', 'warn'); return; }
      var rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var xNorm = (e.clientX - rect.left) / rect.width;
      var yNorm = (e.clientY - rect.top) / rect.height;
      if (xNorm < 0 || xNorm > 1 || yNorm < 0 || yNorm > 1) return;
      openPinPicker(xNorm, yNorm);
    });
  }
  function applyTransform() {
    var el = $('bim-stage-inner');
    if (el) el.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
  }

  // ------------------------------------------------------------- forms -----
  function openPlanForm() {
    var html =
      '<div class="pd-modal-header"><h3>Upload a floor plan</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<div class="pd-field"><label>Name</label><input class="pd-input" id="bim-p-name" placeholder="e.g. Ground Floor" /></div>' +
        '<div class="pd-field"><label>Level order <span class="pp-optnote">(lower = shown first)</span></label>' +
          '<input class="pd-input" type="number" id="bim-p-order" value="0" /></div>' +
        '<div class="pd-field"><label>Floor plan image</label><input type="file" id="bim-p-file" accept="image/*" /></div>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="bim-p-save">Upload</button></div>';
    var m = openModal(html, 480);
    $('bim-p-save').onclick = async function () {
      var f = $('bim-p-file').files && $('bim-p-file').files[0];
      var name = $('bim-p-name').value.trim();
      if (!name) { UI.toast('Name is required', 'warn'); return; }
      if (!f) { UI.toast('Choose an image file', 'warn'); return; }
      this.disabled = true;
      try {
        var dims = await imageDims(f);
        var path = pid + '/floorplans/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '_' + f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        var up = await sb().storage.from(BUCKET).upload(path, f, { contentType: f.type || 'image/jpeg' });
        if (up.error) throw up.error;
        var row = {
          project_id: pid, name: name, level_order: parseInt($('bim-p-order').value, 10) || 0,
          image_url: path, width_px: dims.w, height_px: dims.h, created_by: uid
        };
        var ires = await sb().from(T_PLAN).insert(row).select();
        if (ires.error) throw ires.error;
        m.close();
        UI.toast('Floor plan uploaded', 'ok');
        activePlanId = (ires.data && ires.data[0] && ires.data[0].id) || activePlanId;
        await load();
      } catch (e) {
        UI.toast('Could not upload: ' + (e.message || e), 'error');
        this.disabled = false;
      }
    };
  }

  function imageDims(file) {
    return new Promise(function (resolve) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve({ w: null, h: null }); };
      img.src = url;
    });
  }

  function openPinPicker(xNorm, yNorm) {
    var panos = (window.PANO && PANO.list) ? PANO.list() : [];
    var recons = (window.RECON && RECON.doneList) ? RECON.doneList() : [];
    var photos = (window.ProgressPhotos && ProgressPhotos.allPhotos) ? ProgressPhotos.allPhotos() : [];

    function itemOptionsHTML(type) {
      var list = type === 'panorama' ? panos : (type === 'reconstruction' ? recons : photos);
      if (!list.length) return '<option value="">— none available —</option>';
      return list.map(function (r) {
        var label = r.location || r.description || (r.id ? r.id.slice(0, 8) : 'Untitled');
        return '<option value="' + esc(r.id) + '">' + esc(label) + '</option>';
      }).join('');
    }

    var html =
      '<div class="pd-modal-header"><h3>Place a pin</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<div class="pd-field"><label>What does this pin point to?</label>' +
          '<select class="pd-select" id="bim-pin-type">' +
            '<option value="panorama">360° panorama</option>' +
            '<option value="reconstruction">3D reconstruction</option>' +
            '<option value="photo">Progress photo</option>' +
          '</select></div>' +
        '<div class="pd-field"><label>Which one</label><select class="pd-select" id="bim-pin-item"></select></div>' +
        '<div class="pd-field"><label>Label <span class="pp-optnote">(optional)</span></label>' +
          '<input class="pd-input" id="bim-pin-label" /></div>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="bim-pin-save">Place pin</button></div>';
    var m = openModal(html, 460);
    function refreshItems() { $('bim-pin-item').innerHTML = itemOptionsHTML($('bim-pin-type').value); }
    $('bim-pin-type').onchange = refreshItems;
    refreshItems();

    $('bim-pin-save').onclick = async function () {
      var itemId = $('bim-pin-item').value;
      if (!itemId) { UI.toast('Nothing to pin — that list is empty', 'warn'); return; }
      this.disabled = true;
      var row = {
        floor_plan_id: activePlanId, project_id: pid,
        item_type: $('bim-pin-type').value, item_id: itemId,
        x_norm: xNorm, y_norm: yNorm,
        label: $('bim-pin-label').value.trim() || null, created_by: uid
      };
      var res = await sb().from(T_PIN).insert(row);
      if (res.error) { UI.toast(res.error.message, 'error'); this.disabled = false; return; }
      m.close();
      UI.toast('Pin placed', 'ok');
      await loadPins();
    };
  }

  return {
    init: init,
    _syncTools: syncTools,
    // Pure math, exported ONLY so it can be unit-tested without a DOM/WebGL
    // stack — the zoom-anchor arithmetic is the one part of this module
    // genuinely worth checking mechanically (a wrong sign here makes the
    // image visibly "run away" from the cursor while zooming).
    _zoomAnchor: function (cx, cy, prevZoom, newZoom, prevPanX, prevPanY) {
      return {
        panX: cx - (cx - prevPanX) * (newZoom / prevZoom),
        panY: cy - (cy - prevPanY) * (newZoom / prevZoom)
      };
    }
  };
})();
