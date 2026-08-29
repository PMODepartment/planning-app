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
  var T_REG  = 'floor_plan_registrations';
  var BUCKET = 'progress-photos';
  var SIGN_TTL = 3600;

  var profile = null, uid = null, pid = null, projName = '';
  var canWrite = false;
  var plans = [], activePlanId = null, pins = [];
  var planUrlCache = {};
  var placeMode = false;
  // Every pin in the PROJECT (not just the active plan) — Batches E item 8
  // and G's map view both need to look a photo up by id, or cluster across
  // every plan, regardless of which single plan the toolbar select is
  // currently showing.
  var allPins = [];
  var screen2 = 'plan'; // 'plan' | 'map' (Batch G) — a second-level view switch, independent of the Gallery/Presentations/Plans top-level tab
  var mapMonth = null;  // 'YYYY-MM' | null (null = latest month with any pin)
  var mapPlaying = false, mapPlayTimer = null;
  var registrations = [];  // floor_plan_registrations rows, all plans (Batch H)
  var actualView = false;  // Batch H: show the warped photo instead of the drawing

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
    await loadAllPins();
    await loadRegistrations();
    await loadPins();
  }

  // ALL pins for the project, across every plan — kept separate from the
  // active-plan-scoped `pins` above (which the single-plan view renders)
  // because the Gallery's per-photo pin icon (item 8) and the map view
  // (Batch G) both need to look up a pin regardless of which plan is
  // currently selected in the toolbar.
  async function loadAllPins() {
    if (!plans.length) { allPins = []; return; }
    try {
      allPins = await PDb.selectAll(T_PIN, function (q) { return q.eq('project_id', pid); });
    } catch (e) { allPins = []; }
  }
  function pinsByItem(itemType, itemId) {
    return allPins.filter(function (p) { return p.item_type === itemType && p.item_id === itemId; });
  }
  function planById(id) { return plans.filter(function (p) { return p.id === id; })[0] || null; }

  // Batch H — registrations, project-wide (like allPins, above).
  async function loadRegistrations() {
    if (!plans.length) { registrations = []; return; }
    try {
      registrations = await PDb.selectAll(T_REG, function (q) { return q.eq('project_id', pid); });
    } catch (e) { registrations = []; }
  }
  // The most-recently-created registration for a plan, if any — one plan can
  // in principle have several top-view photos registered against it (a huge
  // site might need more than one aerial shot); "Actual view" shows the
  // latest by default rather than presenting a chooser for what's expected
  // to be a rare, deliberate one-photo-per-plan setup in practice.
  function actualRegistrationFor(planId) {
    var list = registrations.filter(function (r) { return r.floor_plan_id === planId && r.homography; });
    if (!list.length) return null;
    return list.sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); })[0];
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

  // The Plan / Map / Stack segmented toggle — a plain function, not inlined,
  // because it now has to render identically from THREE separate render()
  // branches (Stack, "no plans yet", and the ordinary Plan/Map body). Stack
  // is reachable from all three: it reads the Location Breakdown + the photo
  // library directly, not a floor plan or its pins, so — unlike Map, which
  // is meaningless with zero plans — it works even before any plan is ever
  // uploaded.
  function viewToggleHTML() {
    return '<div class="bim-viewtoggle" role="tablist">' +
      '<button class="bim-vtbtn' + (screen2 === 'plan' ? ' active' : '') + '" id="bim-vt-plan">Plan</button>' +
      '<button class="bim-vtbtn' + (screen2 === 'map' ? ' active' : '') + '" id="bim-vt-map">Map</button>' +
      '<button class="bim-vtbtn' + (screen2 === 'stack' ? ' active' : '') + '" id="bim-vt-stack">Stack</button>' +
    '</div>';
  }

  function render() {
    var host = $('bim-view');
    if (!host) return;
    syncTools(true);

    if (screen2 === 'stack') {
      host.innerHTML = '<div class="bim-toolbar">' + viewToggleHTML() + '</div>' + renderStackBody();
      wireMapView();   // wires the toggle buttons themselves; map-only stepper logic no-ops here
      wireStackView();
      hydrate();
      return;
    }

    if (!plans.length) {
      host.innerHTML = '<div class="bim-toolbar">' + viewToggleHTML() + '</div>' +
        '<div class="pp-empty">' +
        '<span data-ico="compass" data-ico-size="34"></span>' +
        '<p>No floor plans uploaded yet for this project.</p>' +
        (canWrite ? '<p class="pp-hint">Press <strong>+ Upload floor plan</strong> to add one, then place pins ' +
          'linking it to your 360° captures, 3D scans and photos — or switch to <strong>Stack</strong> above to ' +
          'see photos by Location Breakdown without a floor plan.</p>' : '') +
        '</div>';
      wireMapView();
      return;
    }

    var plan = activePlan();
    var url = planUrl(plan);
    var aspect = (plan && plan.width_px && plan.height_px) ? (plan.height_px / plan.width_px) : 0.75;

    // Batch H: Register… / Actual view controls — only meaningful in Plan
    // mode (Map deliberately doesn't support the warped-photo backdrop; it's
    // a clustering overview, not a per-plan detail view).
    var reg = actualRegistrationFor(activePlanId);
    var toolbarExtra =
      viewToggleHTML() +
      (screen2 === 'plan' && canWrite ? '<button class="pd-btn" id="bim-register">Register a top-view photo…</button>' : '') +
      (screen2 === 'plan' && reg ? '<label class="ppr-allloc" style="display:inline-flex;align-items:center;gap:5px;margin:0;">' +
        '<input type="checkbox" id="bim-actualview"' + (actualView ? ' checked' : '') + ' /> Actual view</label>' : '');

    if (screen2 === 'map') {
      host.innerHTML =
        '<div class="bim-toolbar">' +
          '<select class="pd-select" id="bim-plan-select">' +
            plans.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === activePlanId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
          '</select>' + toolbarExtra +
        '</div>' + renderMapBody();
      wirePlan();
      wireMapView();
      hydrate();
      return;
    }

    var actualUrl = (actualView && reg && reg.homography) ? '' : url; // Actual view swaps in a <canvas> instead of the <img>, painted after render()
    var html =
      '<div class="bim-toolbar">' +
        '<select class="pd-select" id="bim-plan-select">' +
          plans.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === activePlanId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
        '</select>' + toolbarExtra +
        '<span class="pp-hint">Ctrl+scroll to zoom · drag to pan' + (placeMode ? ' · click the plan to place a pin' : '') + '</span>' +
        (placeMode ? '<span class="bim-placebadge">Place-pin mode is ON</span>' : '') +
        (actualView && reg ? '<span class="bim-placebadge" style="background:color-mix(in srgb, var(--pd-ink) 14%, var(--pd-card));color:var(--pd-ink);">Actual view — warped photo, not the drawing</span>' : '') +
      '</div>' +
      '<div class="bim-stage-outer" id="bim-stage-outer">' +
        '<div class="bim-stage-inner" id="bim-stage-inner" style="transform:translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ');">' +
          '<div class="bim-imgwrap" id="bim-imgwrap" style="padding-bottom:' + (aspect * 100) + '%;">' +
            (actualUrl ? '<img id="bim-img" src="' + esc(actualUrl) + '" draggable="false" />' :
              (actualView && reg ? '<canvas id="bim-actual-canvas" style="position:absolute;inset:0;width:100%;height:100%;"></canvas>' :
              '<div class="pp-empty" style="position:absolute;inset:0;">Plan image not available</div>')) +
            pins.map(pinMarkerHTML).join('') +
          '</div>' +
        '</div>' +
      '</div>';
    host.innerHTML = html;
    wirePlan();
    // ⚠️ REAL BUG this pass found and fixed: this branch (Plan mode, the
    // DEFAULT screen2 value) never called wireMapView() before, so the
    // Map/Stack toggle buttons and the Register/Actual-view controls it
    // renders here were completely UNWIRED — clicking "Map" from the
    // default Plan view did nothing at all, making Batch G's map view
    // unreachable through the UI from a fresh load. wireMapView() itself
    // no-ops safely for the map-only stepper (`if (screen2 !== 'map')
    // return;` guards it), so calling it unconditionally here is safe.
    wireMapView();
    wireStageInteractions();
    hydrate();
    if (actualView && reg && reg.homography) paintActualView(reg);
  }

  function pinIcon(type) {
    return type === 'panorama' ? 'compass' : (type === 'reconstruction' ? 'box' : 'camera');
  }
  // A cone showing field-of-view, drawn ONLY when direction_deg is set (Batch
  // E) — a pin with no recorded direction is a plain dot, never a fabricated
  // cone. Rendered as a CSS conic-gradient wedge, rotated by direction_deg;
  // conic-gradient's own 0deg is "up", matching this column's own convention
  // (0 = up on the plan image, clockwise) — so the rotation IS the angle,
  // no offset needed.
  function pinConeHTML(pin) {
    if (pin.direction_deg === null || pin.direction_deg === undefined) return '';
    return '<span class="bim-pincone" style="left:' + (pin.x_norm * 100) + '%;top:' + (pin.y_norm * 100) +
      '%;transform:translate(-50%,-100%) rotate(' + pin.direction_deg + 'deg);"></span>';
  }
  function pinMarkerHTML(pin) {
    return pinConeHTML(pin) +
      '<button class="bim-pin bim-pin-' + esc(pin.item_type) + '" data-pin="' + esc(pin.id) + '" ' +
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

  // --------------------------------------------------------- map view (G) --
  // A pin carries no date of its own — it points AT a photo/panorama/3D-scan,
  // and it's THAT item's own capture date that "as of month T" filters on.
  function itemDateFor(pin) {
    var list, r;
    if (pin.item_type === 'photo') {
      list = (window.ProgressPhotos && ProgressPhotos.allPhotos) ? ProgressPhotos.allPhotos() : [];
      r = list.filter(function (x) { return x.id === pin.item_id; })[0];
      return r ? (r.taken_at || (r.created_at || '').slice(0, 10)) : '';
    }
    if (pin.item_type === 'panorama') {
      list = (window.PANO && PANO.list) ? PANO.list() : [];
      r = list.filter(function (x) { return x.id === pin.item_id; })[0];
      return r ? (r.taken_at || (r.created_at || '').slice(0, 10)) : '';
    }
    if (pin.item_type === 'reconstruction') {
      list = (window.RECON && RECON.doneList) ? RECON.doneList() : [];
      r = list.filter(function (x) { return x.id === pin.item_id; })[0];
      return r ? (r.approved_at || r.created_at || '').slice(0, 10) : '';
    }
    return '';
  }
  // Grid-snap clustering — pins within the same ~5% cell of the plan cluster
  // together (matches how tight two pins have to be before overlapping dots
  // become unreadable anyway). Deliberately NOT proximity/k-means clustering
  // — a fixed grid is stable frame to frame as the month slider moves, so a
  // cluster doesn't visually jump around as items enter/leave it.
  var MAP_CELL = 0.05;
  function activePlanPins() { return pins.filter(function (p) { return p.floor_plan_id === activePlanId; }); }
  function mapMonthsAvailable() {
    var set = {};
    activePlanPins().forEach(function (p) { var d = itemDateFor(p); if (d) set[d.slice(0, 7)] = true; });
    return Object.keys(set).sort();
  }
  function mapClusters(monthCutoff) {
    var byCell = {};
    activePlanPins().forEach(function (p) {
      var d = itemDateFor(p);
      if (monthCutoff && (!d || d.slice(0, 7) > monthCutoff)) return; // "as of" — cumulative up to and including the selected month
      var cx = Math.round(p.x_norm / MAP_CELL) * MAP_CELL, cy = Math.round(p.y_norm / MAP_CELL) * MAP_CELL;
      var key = cx.toFixed(2) + ',' + cy.toFixed(2);
      (byCell[key] = byCell[key] || { x: cx, y: cy, pins: [] }).pins.push(p);
    });
    return Object.keys(byCell).map(function (k) { return byCell[k]; });
  }
  function renderMapBody() {
    var months = mapMonthsAvailable();
    var cutoff = mapMonth || (months.length ? months[months.length - 1] : null);
    var clusters = mapClusters(cutoff);
    var stepper = months.length ? (
      '<div class="bim-mapstepper">' +
        '<button class="pp-iconbtn" id="bim-map-prev" title="Earlier month">‹</button>' +
        '<strong>' + (cutoff ? esc(cutoff) : 'All') + '</strong>' +
        '<button class="pp-iconbtn" id="bim-map-next" title="Later month">›</button>' +
        '<button class="pd-btn" id="bim-map-play">' + (mapPlaying ? 'Stop' : '▶ Play') + '</button>' +
        '<span class="pp-hint">as of the end of this month · ' + clusters.reduce(function (n, c) { return n + c.pins.length; }, 0) + ' pinned item' +
        (clusters.reduce(function (n, c) { return n + c.pins.length; }, 0) === 1 ? '' : 's') + '</span>' +
      '</div>') : '<p class="pp-hint">No dated captures pinned on this plan yet.</p>';
    var plan = activePlan();
    var url = planUrl(plan);
    var aspect = (plan && plan.width_px && plan.height_px) ? (plan.height_px / plan.width_px) : 0.75;
    return stepper +
      '<div class="bim-stage-outer" id="bim-map-stage">' +
        '<div class="bim-imgwrap" style="padding-bottom:' + (aspect * 100) + '%;">' +
          (url ? '<img src="' + esc(url) + '" draggable="false" />' : '<div class="pp-empty" style="position:absolute;inset:0;">Plan image not available</div>') +
          clusters.map(function (c, i) {
            return '<button class="bim-cluster" data-cluster="' + i + '" style="left:' + (c.x * 100) + '%;top:' + (c.y * 100) + '%;">' + c.pins.length + '</button>';
          }).join('') +
        '</div>' +
      '</div>';
  }
  function wireMapView() {
    // Now called unconditionally from EVERY render() branch (Stack, no-plans,
    // Map, and Plan) — see the ⚠️ comment above this fn's Plan-branch call
    // site for why that matters. Each toggle stops whichever OTHER view's
    // month-scrub timer might still be running, so switching away from a
    // playing Map/Stack never leaves an orphaned interval ticking in the
    // background.
    if ($('bim-vt-plan')) $('bim-vt-plan').onclick = function () { stopMapPlay(); stopStackPlay(); screen2 = 'plan'; render(); };
    if ($('bim-vt-map')) $('bim-vt-map').onclick = function () { stopStackPlay(); screen2 = 'map'; render(); };
    if ($('bim-vt-stack')) $('bim-vt-stack').onclick = function () { stopMapPlay(); screen2 = 'stack'; render(); };
    if ($('bim-register')) $('bim-register').onclick = openRegisterFlow;
    if ($('bim-actualview')) $('bim-actualview').onchange = function () { actualView = this.checked; render(); };
    if (screen2 !== 'map') return;
    var months = mapMonthsAvailable();
    var cutoff = mapMonth || (months.length ? months[months.length - 1] : null);
    var clusters = mapClusters(cutoff);
    if ($('bim-map-prev')) $('bim-map-prev').onclick = function () {
      var i = months.indexOf(cutoff); mapMonth = months[Math.max(0, i - 1)]; render();
    };
    if ($('bim-map-next')) $('bim-map-next').onclick = function () {
      var i = months.indexOf(cutoff); mapMonth = months[Math.min(months.length - 1, i + 1)]; render();
    };
    if ($('bim-map-play')) $('bim-map-play').onclick = function () {
      if (mapPlaying) { stopMapPlay(); render(); return; }
      mapPlaying = true;
      mapPlayTimer = setInterval(function () {
        var ms = mapMonthsAvailable();
        var i = ms.indexOf(mapMonth || (ms.length ? ms[ms.length - 1] : null));
        if (i >= ms.length - 1) { stopMapPlay(); render(); return; } // auto-stop at the end, same convention as this app's other time-scrub views
        mapMonth = ms[i + 1]; render();
      }, 900);
      render();
    };
    Array.prototype.forEach.call($('bim-view').querySelectorAll('[data-cluster]'), function (btn) {
      btn.onclick = function () { openClusterList(clusters[+this.dataset.cluster]); };
    });
  }
  function stopMapPlay() { mapPlaying = false; if (mapPlayTimer) { clearInterval(mapPlayTimer); mapPlayTimer = null; } }
  function openClusterList(cluster) {
    if (!cluster) return;
    var html =
      '<div class="pd-modal-header"><h3>' + cluster.pins.length + ' item' + (cluster.pins.length === 1 ? '' : 's') + ' here</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><div class="ppr-tmpl-picklist">' +
        cluster.pins.map(function (p) {
          return '<button type="button" class="ppr-tmpl-pickrow" data-open="' + esc(p.id) + '">' +
            esc(p.label || (p.item_type === 'panorama' ? '360° panorama' : p.item_type === 'reconstruction' ? '3D reconstruction' : 'Photo')) +
            (itemDateFor(p) ? ' — ' + esc(itemDateFor(p)) : '') + '</button>';
        }).join('') +
      '</div></div>';
    var m = openModal(html, 420);
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-open]'), function (b) {
      b.onclick = function () { m.close(); openPin(this.dataset.open); };
    });
  }

  // ------------------------------------------------- vertical stacking (G, item 16) --
  // ⚠️ Independent of floor plans entirely — bands come from the project's
  // Location Breakdown (location_levels), the SAME schedule-derived Tower/
  // Level/Zone hierarchy the Add-photo form cascades through, not from a
  // floor-plan image or its pins. That's why this is reachable from render()
  // even when `plans.length === 0` (see the top of render()): a project can
  // have Location-Breakdown-tagged photos with zero floor plans uploaded,
  // and this view should still work for it.
  // ⚠️ Scope reduction, stated rather than silently shipped: only the first
  // TWO location levels drive the grid (rows/columns) — a third level (Zone,
  // Orientation, ...) is real detail this 2-axis grid cannot represent, and
  // a project needing that resolution should use the ordinary Location
  // filter on the Gallery grid instead. Both axes are pickers, though, so a
  // planner can choose ANY two levels, not just the first two by default.
  var stackRowLevelId = null, stackColLevelId = null;
  var stackMonth = null;
  var stackPlaying = false, stackPlayTimer = null;

  function stackLevels() { return (window.ProgressPhotos && ProgressPhotos.locLevels) ? ProgressPhotos.locLevels() : []; }
  function stackRowLevel() {
    var levels = stackLevels();
    return levels.filter(function (l) { return l.id === stackRowLevelId; })[0] || levels[0] || null;
  }
  function stackColLevel() {
    var levels = stackLevels();
    var picked = levels.filter(function (l) { return l.id === stackColLevelId; })[0];
    if (picked) return picked;
    // Default to the SECOND configured level, never the same one as the row
    // axis, or every row would collapse to one repeated column.
    return levels.filter(function (l) { return l.id !== (stackRowLevel() && stackRowLevel().id); })[0] || null;
  }
  function stackPhotos() { return (window.ProgressPhotos && ProgressPhotos.allPhotos) ? ProgressPhotos.allPhotos() : []; }
  function stackMonthsAvailable() {
    var set = {};
    stackPhotos().forEach(function (p) { if (p.taken_at) set[String(p.taken_at).slice(0, 7)] = true; });
    return Object.keys(set).sort();
  }
  // Pure — the actual "as of" decision for one grid cell, worth genuinely
  // EXECUTING (same reasoning as mapClusters' own cutoff filter): given
  // photos already narrowed to one location cell, returns the most recent
  // one at-or-before `cutoff` ('YYYY-MM', or null for "no limit — latest
  // overall"), or null when nothing in the list qualifies.
  function mostRecentAsOf(list, cutoff) {
    var best = null;
    list.forEach(function (p) {
      if (!p.taken_at) return;
      if (cutoff && String(p.taken_at).slice(0, 7) > cutoff) return;
      if (!best || String(p.taken_at) > String(best.taken_at)) best = p;
    });
    return best;
  }
  function stackGrid(cutoff) {
    var rowLevel = stackRowLevel(), colLevel = stackColLevel();
    if (!rowLevel) return { rowLevel: null, colLevel: null, cols: [], rows: [] };
    var photos = stackPhotos();
    var rowVals = {}, colVals = {};
    photos.forEach(function (p) {
      var lv = p.location_values || {};
      var rv = lv[rowLevel.id]; if (rv) rowVals[rv] = true;
      if (colLevel) { var cv = lv[colLevel.id]; if (cv) colVals[cv] = true; }
    });
    var rowNames = Object.keys(rowVals).sort();
    var colNames = colLevel ? Object.keys(colVals).sort() : [];
    if (!colNames.length) colNames = [''];  // single-level project — one shared "All" column
    var rows = rowNames.map(function (rv) {
      return {
        row: rv,
        cells: colNames.map(function (cv) {
          var candidates = photos.filter(function (p) {
            var lv = p.location_values || {};
            if ((lv[rowLevel.id] || '') !== rv) return false;
            if (colLevel && cv && (lv[colLevel.id] || '') !== cv) return false;
            return true;
          });
          return { col: cv, photo: mostRecentAsOf(candidates, cutoff) };
        })
      };
    });
    return { rowLevel: rowLevel, colLevel: colLevel, cols: colNames, rows: rows };
  }
  function renderStackBody() {
    var levels = stackLevels();
    if (!levels.length) {
      return '<div class="pp-empty"><p>No Location Breakdown set up for this project yet — build it in ' +
        'Project Schedule (Group menu &rarr; Location Breakdown&hellip;), then photos tagged against it ' +
        'will stack here.</p></div>';
    }
    var months = stackMonthsAvailable();
    var cutoff = stackMonth || (months.length ? months[months.length - 1] : null);
    var g = stackGrid(cutoff);
    var stepper = months.length ? (
      '<div class="bim-mapstepper">' +
        '<button class="pp-iconbtn" id="bim-stack-prev" title="Earlier month">‹</button>' +
        '<strong>' + (cutoff ? esc(cutoff) : 'All') + '</strong>' +
        '<button class="pp-iconbtn" id="bim-stack-next" title="Later month">›</button>' +
        '<button class="pd-btn" id="bim-stack-play">' + (stackPlaying ? 'Stop' : '▶ Play') + '</button>' +
        '<span class="pp-hint">as of the end of this month</span>' +
      '</div>') : '<p class="pp-hint">No dated, location-tagged photos yet.</p>';
    var levelPickers =
      '<div class="bim-stacklevels">' +
        '<label>Rows <select class="pd-select" id="bim-stack-rowlvl">' +
          levels.map(function (l) { return '<option value="' + esc(l.id) + '"' + (g.rowLevel && l.id === g.rowLevel.id ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') +
        '</select></label>' +
        (levels.length > 1 ? '<label>Columns <select class="pd-select" id="bim-stack-collvl">' +
          levels.map(function (l) { return '<option value="' + esc(l.id) + '"' + (g.colLevel && l.id === g.colLevel.id ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') +
        '</select></label>' : '') +
      '</div>';
    if (!g.rows.length) {
      return levelPickers + stepper + '<div class="pp-empty"><p>No photos have been tagged at this Location Breakdown level yet.</p></div>';
    }
    var table =
      '<div class="bim-stackwrap"><table class="bim-stacktable"><thead><tr><th></th>' +
        g.cols.map(function (c) { return '<th>' + esc(c || 'All') + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      g.rows.map(function (r) {
        return '<tr><th>' + esc(r.row) + '</th>' +
          r.cells.map(function (c) {
            if (!c.photo) return '<td class="bim-stackcell bim-stackcell-empty">—</td>';
            var url = (window.ProgressPhotos && ProgressPhotos.urlOfPhotoId) ? ProgressPhotos.urlOfPhotoId(c.photo.id) : '';
            var cap = r.row + (c.col ? ' · ' + c.col : '') + ' — ' + (c.photo.taken_at || '');
            return '<td class="bim-stackcell">' +
              (url ? '<img class="bim-stackthumb" data-magnify="' + esc(url) + '" data-cap="' + esc(cap) + '" src="' + esc(url) + '" alt="" />' : '—') +
            '</td>';
          }).join('') +
        '</tr>';
      }).join('') +
      '</tbody></table></div>' +
      // A basic hover-magnifier — deliberately simpler than Project
      // Schedule's own SVG-clone version: these cells are plain <img>
      // thumbnails, so swapping a larger src into a docked panel is enough.
      '<div class="bim-stackmag" id="bim-stack-mag" hidden><img id="bim-stack-magimg" alt="" /><div class="bim-stackmagcap" id="bim-stack-magcap"></div></div>';
    return levelPickers + stepper + table;
  }
  function wireStackView() {
    if ($('bim-stack-rowlvl')) $('bim-stack-rowlvl').onchange = function () { stackRowLevelId = this.value; render(); };
    if ($('bim-stack-collvl')) $('bim-stack-collvl').onchange = function () { stackColLevelId = this.value; render(); };
    if (screen2 !== 'stack') return;
    var months = stackMonthsAvailable();
    var cutoff = stackMonth || (months.length ? months[months.length - 1] : null);
    if ($('bim-stack-prev')) $('bim-stack-prev').onclick = function () {
      var i = months.indexOf(cutoff); stackMonth = months[Math.max(0, i - 1)]; render();
    };
    if ($('bim-stack-next')) $('bim-stack-next').onclick = function () {
      var i = months.indexOf(cutoff); stackMonth = months[Math.min(months.length - 1, i + 1)]; render();
    };
    if ($('bim-stack-play')) $('bim-stack-play').onclick = function () {
      if (stackPlaying) { stopStackPlay(); render(); return; }
      stackPlaying = true;
      stackPlayTimer = setInterval(function () {
        var ms = stackMonthsAvailable();
        var i = ms.indexOf(stackMonth || (ms.length ? ms[ms.length - 1] : null));
        if (i >= ms.length - 1) { stopStackPlay(); render(); return; }  // auto-stop at the end, same convention as the map view and every other time-scrub view in this app
        stackMonth = ms[i + 1]; render();
      }, 900);
      render();
    };
    var mag = $('bim-stack-mag'), magImg = $('bim-stack-magimg'), magCap = $('bim-stack-magcap');
    if (!mag) return;
    Array.prototype.forEach.call($('bim-view').querySelectorAll('[data-magnify]'), function (im) {
      im.addEventListener('mouseenter', function () {
        magImg.src = im.dataset.magnify; magCap.textContent = im.dataset.cap || '';
        mag.hidden = false;
      });
      im.addEventListener('mouseleave', function () { mag.hidden = true; });
    });
  }
  function stopStackPlay() { stackPlaying = false; if (stackPlayTimer) { clearInterval(stackPlayTimer); stackPlayTimer = null; } }

  // --------------------------------------------------- registration (H) ----
  var _cvReady = null;
  function ensureOpenCV() {
    if (_cvReady) return _cvReady;
    _cvReady = new Promise(function (resolve, reject) {
      if (typeof cv !== 'undefined' && cv.Mat) { resolve(); return; }
      if (typeof cv === 'undefined') { reject(new Error('The vision library (OpenCV.js) did not load.')); return; }
      var prev = cv['onRuntimeInitialized'];
      cv['onRuntimeInitialized'] = function () { if (prev) prev(); resolve(); };
      setTimeout(function () { if (!(cv && cv.Mat)) reject(new Error('The vision library took too long to load.')); }, 20000);
    });
    return _cvReady;
  }
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Could not load the image')); };
      img.src = url;
    });
  }
  // Draws `img` onto a canvas at its natural size and returns the canvas —
  // OpenCV.js's cv.imread needs a canvas/img already in the document (or an
  // ImageData), and warpPerspective's OUTPUT also needs a target canvas of
  // the PLAN's own pixel size so pins (normalized 0..1 over the plan) still
  // land in the right place regardless of the photo's own resolution.
  function toCanvas(img, w, h) {
    var c = document.createElement('canvas');
    c.width = w || img.naturalWidth; c.height = h || img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  async function paintActualView(reg) {
    var canvas = $('bim-actual-canvas'); if (!canvas) return;
    try {
      await ensureOpenCV();
      var photoUrl = (window.ProgressPhotos && ProgressPhotos.urlOfPhotoId) ? ProgressPhotos.urlOfPhotoId(reg.photo_id) : '';
      if (!photoUrl) throw new Error('That registered photo is no longer available');
      var plan = planById(reg.floor_plan_id);
      var planW = (plan && plan.width_px) || 1200, planH = (plan && plan.height_px) || 900;
      var img = await loadImage(photoUrl);
      var srcCanvas = toCanvas(img);
      var src = cv.imread(srcCanvas);
      var dst = new cv.Mat();
      var h = reg.homography;
      var M = cv.matFromArray(3, 3, cv.CV_64F, h);
      var dsize = new cv.Size(planW, planH);
      cv.warpPerspective(src, dst, M, dsize);
      canvas.width = planW; canvas.height = planH;
      cv.imshow(canvas, dst);
      src.delete(); dst.delete(); M.delete();
    } catch (e) {
      UI.toast('Could not render the actual view: ' + ((e && e.message) || e), 'error');
    }
  }

  // Point-based registration flow: pick a top-view photo, click 3-4 matching
  // point pairs (drawing, then photo), compute the homography once there are
  // enough pairs. A SEPARATE static modal, not the live pan/zoom stage — the
  // stage's own click handling already means three different things
  // (nothing / place-a-pin / pan-release); adding a fourth meaning there
  // risks a click being misread as the wrong one of the four. Isolating
  // registration in its own modal makes that impossible by construction.
  var MIN_REG_POINTS = 4;
  function openRegisterFlow() {
    if (!activePlanId) { UI.toast('Select a floor plan first', 'warn'); return; }
    var photos = (window.ProgressPhotos && ProgressPhotos.allPhotos) ? ProgressPhotos.allPhotos() : [];
    if (!photos.length) { UI.toast('No photos in this project to register', 'warn'); return; }
    var plan = activePlan();
    var planImgUrl = planUrl(plan);
    var chosenPhotoId = photos[0].id;
    var pairs = [];          // {planX,planY,photoX,photoY} normalized 0..1
    var pendingPlanPt = null; // set after a plan click, cleared once paired with a photo click

    function photoLabel(p) { return p.description || p.location || (p.id ? p.id.slice(0, 8) : 'Untitled'); }
    function statusText() {
      if (pairs.length >= MIN_REG_POINTS) return pairs.length + ' point pairs — ready to compute.';
      if (pendingPlanPt) return pairs.length + ' pair(s) done — now click the MATCHING point on the photo.';
      return pairs.length + ' of at least ' + MIN_REG_POINTS + ' pairs — click a point on the DRAWING.';
    }

    var html =
      '<div class="pd-modal-header"><h3>Register a top-view photo</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<p class="pp-hint">Click a point on the drawing, then click the SAME point on the photo. Repeat at least ' +
          MIN_REG_POINTS + ' times, spread across the image — corners of a building work well.</p>' +
        '<div class="pd-field"><label>Top-view photo</label><select class="pd-select" id="bim-reg-photo">' +
          photos.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(photoLabel(p)) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="bim-regpair">' +
          '<div class="bim-regside"><div class="pp-hint">Drawing</div><img id="bim-reg-plan" src="' + esc(planImgUrl) + '" style="width:100%;cursor:crosshair;" draggable="false" /></div>' +
          '<div class="bim-regside"><div class="pp-hint">Photo</div><img id="bim-reg-photo-img" src="" style="width:100%;cursor:crosshair;" draggable="false" /></div>' +
        '</div>' +
        '<p class="pp-hint" id="bim-reg-status"></p>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn" id="bim-reg-undo">Undo last point</button>' +
        '<button class="pd-btn pd-btn-primary" id="bim-reg-save" disabled>Compute &amp; save</button></div>';
    var m = openModal(html, 760);

    function setPhotoImg() {
      var ph = photos.filter(function (p) { return p.id === chosenPhotoId; })[0];
      var url = (window.ProgressPhotos && ProgressPhotos.urlOfPhotoId) ? ProgressPhotos.urlOfPhotoId(chosenPhotoId) : '';
      if ($('bim-reg-photo-img')) $('bim-reg-photo-img').src = url || '';
    }
    setPhotoImg();
    $('bim-reg-photo').onchange = function () {
      chosenPhotoId = this.value; pairs = []; pendingPlanPt = null;
      setPhotoImg(); refresh();
    };
    function refresh() {
      if ($('bim-reg-status')) $('bim-reg-status').textContent = statusText();
      if ($('bim-reg-save')) $('bim-reg-save').disabled = pairs.length < MIN_REG_POINTS;
    }
    $('bim-reg-plan').onclick = function (e) {
      if (pendingPlanPt) { UI.toast('Click the matching point on the PHOTO first', 'warn'); return; }
      var rect = this.getBoundingClientRect();
      pendingPlanPt = { planX: (e.clientX - rect.left) / rect.width, planY: (e.clientY - rect.top) / rect.height };
      refresh();
    };
    $('bim-reg-photo-img').onclick = function (e) {
      if (!pendingPlanPt) { UI.toast('Click a point on the DRAWING first', 'warn'); return; }
      var rect = this.getBoundingClientRect();
      pairs.push(Object.assign({}, pendingPlanPt, {
        photoX: (e.clientX - rect.left) / rect.width, photoY: (e.clientY - rect.top) / rect.height
      }));
      pendingPlanPt = null;
      refresh();
    };
    $('bim-reg-undo').onclick = function () {
      if (pendingPlanPt) pendingPlanPt = null; else pairs.pop();
      refresh();
    };
    refresh();

    $('bim-reg-save').onclick = async function () {
      if (pairs.length < MIN_REG_POINTS) return;
      this.disabled = true;
      try {
        await ensureOpenCV();
        var planW = (plan && plan.width_px) || 1200, planH = (plan && plan.height_px) || 900;
        var photoImg = $('bim-reg-photo-img');
        var srcPts = [], dstPts = [];
        pairs.forEach(function (p) {
          srcPts.push(p.photoX * photoImg.naturalWidth, p.photoY * photoImg.naturalHeight);
          dstPts.push(p.planX * planW, p.planY * planH);
        });
        var srcMat = cv.matFromArray(pairs.length, 1, cv.CV_32FC2, srcPts);
        var dstMat = cv.matFromArray(pairs.length, 1, cv.CV_32FC2, dstPts);
        var H = cv.findHomography(srcMat, dstMat, cv.RANSAC);
        if (H.empty()) throw new Error('Could not compute a transform from these points — try more spread-out, distinct points');
        var hArr = [];
        for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) hArr.push(H.doubleAt(r, c));
        srcMat.delete(); dstMat.delete(); H.delete();

        var row = {
          floor_plan_id: activePlanId, photo_id: chosenPhotoId, project_id: pid,
          point_pairs: pairs, homography: hArr, created_by: uid
        };
        var res = await sb().from(T_REG).upsert(row, { onConflict: 'floor_plan_id,photo_id' });
        if (res.error) throw res.error;
        m.close();
        UI.toast('Registered — toggle "Actual view" to see the warped photo', 'ok');
        actualView = true;
        await loadRegistrations();
        render();
      } catch (e) {
        UI.toast('Registration failed: ' + ((e && e.message) || e), 'error');
        this.disabled = false;
      }
    };
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
        directionWidgetHTML('bim-pin-dir', null) +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="bim-pin-save">Place pin</button></div>';
    var m = openModal(html, 460);
    function refreshItems() { $('bim-pin-item').innerHTML = itemOptionsHTML($('bim-pin-type').value); }
    $('bim-pin-type').onchange = refreshItems;
    refreshItems();
    wireDirectionWidget('bim-pin-dir');

    $('bim-pin-save').onclick = async function () {
      var itemId = $('bim-pin-item').value;
      if (!itemId) { UI.toast('Nothing to pin — that list is empty', 'warn'); return; }
      this.disabled = true;
      var dirVal = $('bim-pin-dir-val').value;
      var row = {
        floor_plan_id: activePlanId, project_id: pid,
        item_type: $('bim-pin-type').value, item_id: itemId,
        x_norm: xNorm, y_norm: yNorm,
        direction_deg: dirVal === '' ? null : +dirVal,
        label: $('bim-pin-label').value.trim() || null, created_by: uid
      };
      var res = await sb().from(T_PIN).insert(row);
      if (res.error) {
        // Tolerant of migrations/2026-08-29-pin-direction.sql not having run
        // yet — same "strip the column, warn, retry" convention every other
        // not-yet-migrated column in this module family uses.
        if (/column .* does not exist|schema cache/i.test(res.error.message || '') && 'direction_deg' in row) {
          var stripped = Object.assign({}, row); delete stripped.direction_deg;
          var res2 = await sb().from(T_PIN).insert(stripped);
          if (res2.error) { UI.toast(res2.error.message, 'error'); this.disabled = false; return; }
          UI.toast('Pin placed without direction — run migrations/2026-08-29-pin-direction.sql', 'warn');
          m.close(); await loadAllPins(); await loadPins(); return;
        }
        UI.toast(res.error.message, 'error'); this.disabled = false; return;
      }
      m.close();
      UI.toast('Pin placed', 'ok');
      await loadAllPins();
      await loadPins();
    };
  }

  // ----------------------------------------------------- direction widget ---
  // A small drag-an-arrow control (Batch E) — direction_deg = degrees
  // clockwise from "up" on the plan image, matching the column's own
  // documented convention. Reused by both the ordinary pin picker and the
  // Gallery's own per-photo pin+direction capture (module.js calls
  // BIM.openPinPickerFor, below).
  function directionWidgetHTML(idPrefix, curDeg) {
    var deg = (curDeg === null || curDeg === undefined) ? '' : curDeg;
    var rad = deg === '' ? 0 : (deg * Math.PI / 180);
    var hx = 60 + 40 * Math.sin(rad), hy = 60 - 40 * Math.cos(rad);
    return '<div class="pd-field"><label>Direction the camera was facing ' +
      '<span class="pp-optnote">(optional — drag the arrow)</span></label>' +
      '<div class="bim-dirwidget" id="' + idPrefix + '-widget">' +
        '<svg viewBox="0 0 120 120" width="120" height="120">' +
          '<circle cx="60" cy="60" r="50" fill="none" stroke="var(--pd-line)" stroke-width="1"></circle>' +
          '<line id="' + idPrefix + '-line" x1="60" y1="60" x2="' + hx + '" y2="' + hy + '" stroke="var(--pd-red)" stroke-width="3"></line>' +
          '<circle id="' + idPrefix + '-handle" cx="' + hx + '" cy="' + hy + '" r="9" fill="var(--pd-red)" style="cursor:grab"></circle>' +
          '<circle cx="60" cy="60" r="4" fill="var(--pd-ink)"></circle>' +
        '</svg>' +
        '<button type="button" class="pd-btn" id="' + idPrefix + '-clear">No direction</button>' +
      '</div>' +
      '<input type="hidden" id="' + idPrefix + '-val" value="' + deg + '" />' +
    '</div>';
  }
  // Pure: 0° = up (the widget's own hand at rest), clockwise-positive, matching
  // floor_plan_pins.direction_deg's documented convention exactly — pulled out
  // of the pointer handler below so it can be genuinely EXECUTED by a test
  // rather than only regex-checked (a wrong sign here makes every recorded
  // direction cone point backwards, with nothing in the UI to catch it).
  function directionDegFromDrag(dx, dy) {
    return (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  }
  function wireDirectionWidget(idPrefix) {
    var widget = $(idPrefix + '-widget'); if (!widget) return;
    var svg = widget.querySelector('svg');
    var line = $(idPrefix + '-line'), handle = $(idPrefix + '-handle'), val = $(idPrefix + '-val');
    function setFromClient(clientX, clientY) {
      var rect = svg.getBoundingClientRect();
      // svg viewBox is 120x120 regardless of rendered size — scale back.
      var sx = (clientX - rect.left) / rect.width * 120;
      var sy = (clientY - rect.top) / rect.height * 120;
      var dx = sx - 60, dy = sy - 60;
      var deg = directionDegFromDrag(dx, dy);
      var rad = deg * Math.PI / 180;
      var hx = 60 + 40 * Math.sin(rad), hy = 60 - 40 * Math.cos(rad);
      line.setAttribute('x2', hx); line.setAttribute('y2', hy);
      handle.setAttribute('cx', hx); handle.setAttribute('cy', hy);
      val.value = deg.toFixed(1);
    }
    var dragging = false;
    handle.addEventListener('pointerdown', function (e) { dragging = true; handle.setPointerCapture(e.pointerId); });
    svg.addEventListener('pointermove', function (e) { if (dragging) setFromClient(e.clientX, e.clientY); });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      handle.addEventListener(ev, function () { dragging = false; });
    });
    // Clicking anywhere else on the widget also sets the direction — dragging
    // the handle precisely is fiddly on a phone; a plain tap should work too.
    svg.addEventListener('pointerdown', function (e) { if (e.target !== handle) setFromClient(e.clientX, e.clientY); });
    if ($(idPrefix + '-clear')) $(idPrefix + '-clear').onclick = function () {
      val.value = '';
      line.setAttribute('x2', 60); line.setAttribute('y2', 20);
      handle.setAttribute('cx', 60); handle.setAttribute('cy', 20);
    };
  }

  // Called from module.js's own upload flow ("Pin this on a floor plan?",
  // Batch E) — a self-contained modal that lets the planner pick WHICH plan
  // (not assumed to be whatever the Plans screen currently shows), click a
  // point on a plain <img> of it, and drag a direction, all without ever
  // leaving the Gallery screen. Uses the SAME direction widget as the
  // ordinary in-Plans pin flow; does not touch `activePlanId`/pan-zoom state
  // at all, so it can't disturb whatever the Plans screen is showing.
  function openPinPickerFor(itemType, itemId, itemLabel, onDone) {
    if (!plans.length) {
      UI.toast('No floor plans yet — upload one on the Plans tab first', 'warn');
      if (onDone) onDone(false);
      return;
    }
    var chosenPlanId = activePlanId || plans[0].id;
    var picked = null; // {xNorm,yNorm} once clicked

    function planImgHTML(planId) {
      var plan = planById(planId);
      var url = planUrl(plan);
      return url
        ? '<img id="bim-gpin-img" src="' + esc(url) + '" style="width:100%;display:block;cursor:crosshair;" draggable="false" />'
        : '<div class="pp-empty">Plan image not available</div>';
    }

    var html =
      '<div class="pd-modal-header"><h3>Pin ' + esc(itemLabel || 'this') + ' on a floor plan</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        (plans.length > 1
          ? '<div class="pd-field"><label>Floor plan</label><select class="pd-select" id="bim-gpin-plan">' +
              plans.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === chosenPlanId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
            '</select></div>'
          : '') +
        '<p class="pp-hint">Click on the plan where this was captured.</p>' +
        '<div id="bim-gpin-imgwrap">' + planImgHTML(chosenPlanId) + '</div>' +
        '<p class="pp-hint" id="bim-gpin-status">No point picked yet.</p>' +
        directionWidgetHTML('bim-gpin-dir', null) +
        '<div class="pd-field"><label>Label <span class="pp-optnote">(optional)</span></label>' +
          '<input class="pd-input" id="bim-gpin-label" /></div>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Skip</button>' +
        '<button class="pd-btn pd-btn-primary" id="bim-gpin-save" disabled>Place pin</button></div>';
    var m = openModal(html, 520);
    wireDirectionWidget('bim-gpin-dir');

    function wireImgClick() {
      var img = $('bim-gpin-img'); if (!img) return;
      img.onclick = function (e) {
        var rect = img.getBoundingClientRect();
        picked = { xNorm: (e.clientX - rect.left) / rect.width, yNorm: (e.clientY - rect.top) / rect.height };
        if ($('bim-gpin-status')) $('bim-gpin-status').textContent =
          'Point picked (' + (picked.xNorm * 100).toFixed(0) + '%, ' + (picked.yNorm * 100).toFixed(0) + '%) — click again to move it.';
        if ($('bim-gpin-save')) $('bim-gpin-save').disabled = false;
      };
    }
    wireImgClick();
    if ($('bim-gpin-plan')) $('bim-gpin-plan').onchange = function () {
      chosenPlanId = this.value; picked = null;
      $('bim-gpin-imgwrap').innerHTML = planImgHTML(chosenPlanId);
      if ($('bim-gpin-status')) $('bim-gpin-status').textContent = 'No point picked yet.';
      if ($('bim-gpin-save')) $('bim-gpin-save').disabled = true;
      wireImgClick();
    };
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-close]'), function (b) {
      b.onclick = function () { m.close(); if (onDone) onDone(false); };
    });
    $('bim-gpin-save').onclick = async function () {
      if (!picked) return;
      this.disabled = true;
      var dirVal = $('bim-gpin-dir-val').value;
      var row = {
        floor_plan_id: chosenPlanId, project_id: pid, item_type: itemType, item_id: itemId,
        x_norm: picked.xNorm, y_norm: picked.yNorm,
        direction_deg: dirVal === '' ? null : +dirVal,
        label: $('bim-gpin-label').value.trim() || null, created_by: uid
      };
      var res = await sb().from(T_PIN).insert(row);
      if (res.error && /column .* does not exist|schema cache/i.test(res.error.message || '') && 'direction_deg' in row) {
        var stripped = Object.assign({}, row); delete stripped.direction_deg;
        res = await sb().from(T_PIN).insert(stripped);
      }
      if (res.error) { UI.toast(res.error.message, 'error'); this.disabled = false; return; }
      m.close();
      UI.toast('Pinned on the floor plan', 'ok');
      await loadAllPins();
      if (activePlanId === chosenPlanId) await loadPins();
      if (onDone) onDone(true);
    };
  }

  return {
    init: init,
    _syncTools: syncTools,
    // Gallery upload follow-up (Batch E) — see openPinPickerFor's own comment.
    openPinPickerFor: openPinPickerFor,
    hasPlans: function () { return plans.length > 0; },
    // Item-8 lookup: does this photo have a pin, and if so where/on what plan
    // — used to render the Gallery tile's expandable key-plan-style icon.
    pinInfoFor: function (itemType, itemId) {
      var p = pinsByItem(itemType, itemId)[0];
      if (!p) return null;
      var plan = planById(p.floor_plan_id);
      return {
        pin: p, planName: plan ? plan.name : '', planUrl: planUrl(plan),
        planWidth: plan ? plan.width_px : null, planHeight: plan ? plan.height_px : null
      };
    },
    // Pure math, exported ONLY so it can be unit-tested without a DOM/WebGL
    // stack — the zoom-anchor arithmetic is the one part of this module
    // genuinely worth checking mechanically (a wrong sign here makes the
    // image visibly "run away" from the cursor while zooming).
    _zoomAnchor: function (cx, cy, prevZoom, newZoom, prevPanX, prevPanY) {
      return {
        panX: cx - (cx - prevPanX) * (newZoom / prevZoom),
        panY: cy - (cy - prevPanY) * (newZoom / prevZoom)
      };
    },
    // Batch E: same reasoning as _zoomAnchor above — the direction-cone drag
    // math is worth genuinely executing, not just reading, since a flipped
    // sign is silent (the widget still LOOKS interactive; it just records the
    // wrong angle for every future pin).
    _directionDegFromDrag: function (dx, dy) { return directionDegFromDrag(dx, dy); },
    // Vertical Stacking (Batch G, item 16) — genuinely execute the "as of"
    // cell-resolution rule and the row/column grid builder against injected
    // state, the same convention as every other test-only hook here.
    _mostRecentAsOf: function (list, cutoff) { return mostRecentAsOf(list, cutoff); },
    _stackGrid: function (levels, photosArr, rowId, colId, cutoff) {
      var savedLevels = stackLevels, savedPhotos = stackPhotos;
      stackLevels = function () { return levels; };
      stackPhotos = function () { return photosArr; };
      stackRowLevelId = rowId || null; stackColLevelId = colId || null;
      try { return stackGrid(cutoff); }
      finally { stackLevels = savedLevels; stackPhotos = savedPhotos; stackRowLevelId = null; stackColLevelId = null; }
    }
  };
})();
