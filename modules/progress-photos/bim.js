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
  var T_ZONE = 'floor_plan_zones';
  var BUCKET = 'progress-photos';
  var SIGN_TTL = 3600;

  var profile = null, uid = null, pid = null, projName = '';
  var canWrite = false;
  var plans = [], activePlanId = null, pins = [];
  var planUrlCache = {};
  var placeMode = false;

  // -------------------------------------------------------- Tower/Floor ----
  // 2026-09-03: PROJECT → TOWER → FLOOR → FLOOR PLAN → ZONES. Project is
  // already selected at the shell level (ProgressPhotos.onProject); Tower
  // and Floor are the project's own first two Location Breakdown levels
  // (ProgressPhotos.locLevels()) — the SAME schedule-driven levels every
  // other Progress Photos screen already reads, not a second parallel
  // concept. A project with no Location Breakdown at all has no Tower/Floor
  // to select, and the screen says so rather than inventing one.
  var selTowerVal = null, selFloorVal = null;
  // Zones for the plan currently on screen (the CURRENT revision unless a
  // past revision is being read-only-previewed via the history modal, which
  // never touches this — it renders its own separate, throwaway zone list).
  var zones = [];
  var zonesEditMode = false;
  var selectedZoneId = null;
  // Drawing state. drawMode is 'polygon' | 'rectangle' | null. editingZoneId
  // is the zone being reshaped (its saved geometry is what drawPoints starts
  // from); null means a brand-new zone. rectStart is the first corner click
  // while drawing a rectangle (a rectangle is 2 clicks, not click-per-vertex).
  var drawMode = null, drawPoints = [], editingZoneId = null, drawName = '';
  var rectStart = null;
  var ZONE_COLORS = ['#EE3124', '#2B6CB0', '#2F855A', '#B7791F', '#6B46C1', '#B83280', '#00838F', '#C05621'];
  // Every pin in the PROJECT (not just the active plan) — Batch E item 8, and
  // module.js's own Plan/Stack Gallery views (item 16), need to look a photo
  // up by id, or cluster across every plan, regardless of which single plan
  // this screen's own toolbar select is currently showing.
  var allPins = [];
  var registrations = [];  // floor_plan_registrations rows, all plans (Batch H)
  var actualView = false;  // Batch H: show the warped photo instead of the drawing
  // Last-known value passed to syncTools by index.html's setScreen — render()
  // must replay THIS, never a hardcoded true, or the Plans tools stay visible
  // after any async re-render (e.g. load()'s own completion) even when the
  // top-level screen is Gallery/Presentations, not Plans. Same convention and
  // same bug this fixes as ppr.js's own toolsVisible.
  var toolsVisible = false;

  // Pan/zoom state for the stage — plain translate+scale on a wrapper div,
  // not an SVG viewBox/CTM: simpler to reason about and to test (normalized
  // pin position is read straight off the rendered <img>'s own bounding box,
  // which already reflects the current zoom/pan — no matrix math needed).
  var zoom = 1, panX = 0, panY = 0;
  var MIN_ZOOM = 0.2, MAX_ZOOM = 6;
  // ⚠️ Audit fix: shared drag state, hoisted out of wireStageInteractions()
  // (which used to declare these fresh on every call) so the module-level
  // window mousemove/mouseup listeners below can be bound ONCE and still
  // read whatever the CURRENT render's mousedown handler set.
  var dragging = false, lastX = 0, lastY = 0, moved = false;
  var _stageWindowListenersWired = false;

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
    // ⚠️ Called with no args, deliberately not `= openPlanForm` directly —
    // a bare assignment would pass the click MouseEvent as `opts` instead.
    // Pre-fills the currently selected Tower/Floor for convenience but
    // leaves both editable (this is the generic topbar entry point, meant
    // to work for ANY tower/floor — "Replace Plan" on the floor-plan card
    // itself is the one that locks them, see render()).
    if ($('bim-new')) $('bim-new').onclick = function () {
      // ⚠️ 2026-09-04: a project WITH a Tower level configured but no
      // established Tower value yet must not open a modal whose Tower
      // <select> has nothing real to offer — refuse with the same guidance
      // the empty-state screen already shows, rather than a dead-end form.
      // A project with NO Location Breakdown at all (towerLevel() null)
      // is unaffected — that's the pre-existing generic Name-field path.
      if (towerLevel() && !hasEstablishedLocations()) {
        UI.toast('No Tower/Floor locations have been established for this project yet. Please establish the project locations in the Project Schedule App first.', 'warn');
        return;
      }
      openPlanForm({ tower: selTowerVal, floor: selFloorVal });
    };
    if ($('bim-place')) $('bim-place').onclick = togglePlaceMode;
    // ⚠️ Audit cleanup: #bim-plan-select doesn't exist yet at init() time
    // (it's only created inside render()'s own injected HTML), so a binding
    // here was always dead — wirePlan() (called from every render()) sets
    // up the real, working identical handler.
  }
  function syncTools(visible) {
    toolsVisible = visible;
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
    } catch (e) {
      plans = [];
      if (!/schema cache|does not exist/i.test((e && e.message) || '')) UI.toast(e.message || String(e), 'error');
    }
    // 2026-09-03: default Tower/Floor to the first combination that already
    // has a CURRENT plan, so returning to the screen lands somewhere real
    // rather than an empty "no floor plan" state when other floors exist.
    // Falls back to the schedule's own first Tower/Floor VALUES (not just
    // where a plan happens to live) so a brand-new project can still start
    // picking a tower/floor before anything has ever been uploaded.
    if (selTowerVal == null && selFloorVal == null) {
      var seeded = false;
      var withCurrent = plans.filter(function (p) { return p.is_current; });
      if (withCurrent.length) {
        var t0 = towerLevel(), f0 = floorLevel();
        selTowerVal = t0 ? (withCurrent[0].location_values || {})[t0.id] || null : null;
        selFloorVal = f0 ? (withCurrent[0].location_values || {})[f0.id] || null : null;
        seeded = true;
      }
      if (!seeded) {
        var firstTower = towerOptions()[0] || null;
        selTowerVal = firstTower;
        selFloorVal = firstTower ? (floorOptions(firstTower)[0] || null) : null;
      }
    }
    activePlanId = (currentPlanFor(selTowerVal, selFloorVal) || {}).id || null;
    // ⚠️ Audit fix: this was the one un-guarded await in load() (every
    // sibling fetch above/below it is try/caught). load() itself runs
    // fire-and-forget from ProgressPhotos.onProject() with no .catch(), so a
    // real network failure here (offline, DNS, a dropped connection — NOT a
    // Supabase {error} response, which signPlanUrls already tolerates
    // per-file) used to throw straight out of load(), leaving the host
    // permanently on "Loading floor plans…" with no way back short of a
    // full page reload, and an unhandled rejection nobody could see.
    try { await signPlanUrls(); } catch (e) { planUrlCache = {}; }
    resetView();
    zonesEditMode = false; drawMode = null; drawPoints = []; editingZoneId = null; selectedZoneId = null;
    await loadAllPins();
    await loadRegistrations();
    await loadPins();
    await loadZones();
  }

  // ---------------------------------------------------------- Tower/Floor --
  // Tower = the project's first Location Breakdown level, Floor = its
  // second — reusing ProgressPhotos.locLevels() (schedule-driven, ordered by
  // sort_order), never a second, parallel tower/floor concept. A project
  // with fewer than 2 levels degrades: 1 level = Tower only, Floor omitted;
  // 0 levels = no Tower/Floor selection is possible at all, and the screen
  // says so (see render()) rather than inventing a fallback hierarchy.
  function locLevelsList() { return (window.ProgressPhotos && ProgressPhotos.locLevels) ? ProgressPhotos.locLevels() : []; }
  function towerLevel() { return locLevelsList()[0] || null; }
  function floorLevel() { return locLevelsList()[1] || null; }
  function towerOptions() {
    var t = towerLevel(); if (!t) return [];
    return (window.ProgressPhotos && ProgressPhotos.distinctLocValuesFor) ? ProgressPhotos.distinctLocValuesFor(t.id, {}) : [];
  }
  function floorOptions(towerVal) {
    var t = towerLevel(), f = floorLevel(); if (!f) return [];
    var prior = {}; if (t && towerVal) prior[t.id] = towerVal;
    return (window.ProgressPhotos && ProgressPhotos.distinctLocValuesFor) ? ProgressPhotos.distinctLocValuesFor(f.id, prior) : [];
  }
  // ⚠️ 2026-09-04 business rule: the Project Schedule App is the ONLY source
  // of truth for Tower/Floor. A project can have the Tower LEVEL configured
  // (towerLevel() non-null — the Location Breakdown exists) while nobody has
  // yet tagged a single schedule activity with an actual Tower VALUE
  // (towerOptions() empty) — that is a real, valid "not established yet"
  // state, distinct from "no Location Breakdown at all", and it must show
  // its own guidance rather than a dead, optionless <select>. Never widened
  // to also check photos or accept a typed value — see the removed
  // distinctLocValuesAnySource()/"+ Type a new value…" escape hatch this
  // replaces, in module.js's own changelog for why that was wrong.
  function hasEstablishedLocations() { return !!towerLevel() && towerOptions().length > 0; }
  // The Tower+Floor-only subset of a plan's location_values — a plan
  // uploaded under the OLD generic tree picker may carry extra, deeper
  // level values too; grouping/replacing revisions only ever compares the
  // first two, so those older rows still bucket correctly.
  function towerFloorValues(locationValues) {
    var t = towerLevel(), f = floorLevel(), out = {};
    if (t) out[t.id] = (locationValues || {})[t.id] || '';
    if (f) out[f.id] = (locationValues || {})[f.id] || '';
    return out;
  }
  function locKey(values) {
    var keys = Object.keys(values || {}).sort();
    return keys.map(function (k) { return k + '=' + values[k]; }).join('&');
  }
  function towerFloorKey(towerVal, floorVal) {
    var t = towerLevel(), f = floorLevel(), vals = {};
    if (t) vals[t.id] = towerVal || '';
    if (f) vals[f.id] = floorVal || '';
    return locKey(vals);
  }
  // Every revision (current + previous) for one Tower+Floor, oldest first.
  function revisionsFor(towerVal, floorVal) {
    var key = towerFloorKey(towerVal, floorVal);
    return plans.filter(function (p) { return locKey(towerFloorValues(p.location_values)) === key; })
      .sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')); });
  }
  function currentPlanFor(towerVal, floorVal) {
    var revs = revisionsFor(towerVal, floorVal);
    var cur = revs.filter(function (p) { return p.is_current; });
    // Legacy data safety net: if nothing is explicitly flagged current
    // (rows written before this migration ran), the most recently uploaded
    // one is treated as current rather than showing nothing at all.
    return cur.length ? cur[cur.length - 1] : (revs.length ? revs[revs.length - 1] : null);
  }
  function towerFloorLabel(towerVal, floorVal) {
    var f = floorLevel();
    return f ? (towerVal || '—') + ' › ' + (floorVal || '—') : (towerVal || '—');
  }
  // Every FLOOR's current plan, one per Tower+Floor group — the list a pin
  // picker or the Gallery's Plan/Stack views should offer, never every
  // historical revision (a pin belongs on the drawing people actually look
  // at; an old superseded revision is read-only history, reached only
  // through openRevisionHistory/openRevisionPreview above).
  function currentPlansList() {
    var groups = {};
    plans.forEach(function (p) {
      var key = locKey(towerFloorValues(p.location_values));
      (groups[key] || (groups[key] = [])).push(p);
    });
    var out = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k].sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')); });
      var cur = g.filter(function (p) { return p.is_current; });
      out.push(cur.length ? cur[cur.length - 1] : g[g.length - 1]);
    });
    return out;
  }

  // ALL pins for the project, across every plan — kept separate from the
  // active-plan-scoped `pins` above (which the single-plan view renders)
  // because the Gallery's per-photo pin icon (item 8) and the map view
  // (Batch G) both need to look up a pin regardless of which plan is
  // currently selected in the toolbar.
  async function loadAllPins() {
    if (!plans.length) { allPins = []; allPinsIndex = null; return; }
    try {
      allPins = await PDb.selectAll(T_PIN, function (q) { return q.eq('project_id', pid); });
    } catch (e) { allPins = []; }
    allPinsIndex = null;   // rebuilt lazily, on first pinsByItem() call after this load
  }
  // ⚠️ Real perf bug fixed: `pinsByItem` used to `.filter()` the WHOLE
  // `allPins` array on every call, and the Gallery calls it ONCE PER TILE
  // (cardHTML -> BIM.pinInfoFor -> pinsByItem) on every render — so a
  // project with, say, 2,000 photos and 500 pins re-scanned up to a million
  // pin records synchronously before a single tile could paint, entirely on
  // the main thread, before the browser could even show the "loading"
  // placeholder. Indexed once per allPins load (lazily, so a project with
  // no plans/pins never builds an index it doesn't need) into a plain
  // object keyed by "itemType:itemId" -> array of pins for that item —
  // O(1) per tile instead of O(pins).
  var allPinsIndex = null;
  function ensureAllPinsIndex() {
    if (allPinsIndex) return allPinsIndex;
    allPinsIndex = {};
    allPins.forEach(function (p) {
      var k = p.item_type + ':' + p.item_id;
      (allPinsIndex[k] || (allPinsIndex[k] = [])).push(p);
    });
    return allPinsIndex;
  }
  function pinsByItem(itemType, itemId) {
    return ensureAllPinsIndex()[itemType + ':' + itemId] || [];
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

  // --------------------------------------------------------------- zones ---
  async function loadZones() {
    if (!activePlanId) { zones = []; render(); return; }
    try {
      zones = await PDb.selectAll(T_ZONE, function (q) { return q.eq('floor_plan_id', activePlanId); });
      zones.sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')); });
    } catch (e) {
      zones = [];
      if (!/schema cache|does not exist/i.test((e && e.message) || '')) UI.toast(e.message || String(e), 'error');
    }
    render();
  }
  function zoneById(id) { return zones.filter(function (z) { return z.id === id; })[0] || null; }
  function zoneColorFor(id) {
    var idx = zones.map(function (z) { return z.id; }).indexOf(id);
    return ZONE_COLORS[(idx < 0 ? zones.length : idx) % ZONE_COLORS.length];
  }
  function nextZoneName() {
    var n = zones.length + 1;
    while (zones.some(function (z) { return (z.name || '').toLowerCase() === ('Zone ' + n).toLowerCase(); })) n++;
    return 'Zone ' + n;
  }

  // ---------------------------------------------------- Tower/Floor bar ----
  function towerFloorBarHTML() {
    var t = towerLevel(), f = floorLevel();
    if (!t) {
      return '<div class="pp-empty" style="padding:24px 12px;">' +
        '<p>No Location Breakdown set up for this project yet.</p>' +
        '<p class="pp-hint">Tower and Floor come from the project\'s Location Breakdown — set it up in ' +
        'Project Schedule (Group menu &rarr; Location Breakdown&hellip;), then floor plans can be filed under it.</p>' +
      '</div>';
    }
    // ⚠️ 2026-09-04: the Location Breakdown LEVEL exists, but no schedule
    // activity has an actual Tower VALUE recorded yet — Tower/Floor must
    // stay unavailable (never a free-text/manual escape hatch) until the
    // Project Schedule App has real established locations to offer.
    if (!hasEstablishedLocations()) {
      return '<div class="pp-empty" style="padding:24px 12px;">' +
        '<p>No Locations Available</p>' +
        '<p class="pp-hint">No Tower/Floor locations have been established for this project yet. ' +
        'Please establish the project locations in the Project Schedule App first.</p>' +
      '</div>';
    }
    var towers = towerOptions();
    var floors = f ? floorOptions(selTowerVal) : [];
    return '<div class="bim-towerfloor">' +
      '<div class="pd-field"><label>Tower</label><select class="pd-select" id="bim-sel-tower">' +
        towers.map(function (v) { return '<option value="' + esc(v) + '"' + (v === selTowerVal ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') +
      '</select></div>' +
      (f ? '<div class="pd-field"><label>Floor</label><select class="pd-select" id="bim-sel-floor">' +
        floors.map(function (v) { return '<option value="' + esc(v) + '"' + (v === selFloorVal ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') +
      '</select></div>' : '') +
    '</div>';
  }
  function wireTowerFloorBar() {
    if ($('bim-sel-tower')) $('bim-sel-tower').onchange = function () {
      selTowerVal = this.value;
      var opts = floorOptions(selTowerVal);
      selFloorVal = opts.indexOf(selFloorVal) >= 0 ? selFloorVal : (opts[0] || null);
      afterTowerFloorChange();
    };
    if ($('bim-sel-floor')) $('bim-sel-floor').onchange = function () {
      selFloorVal = this.value;
      afterTowerFloorChange();
    };
  }
  function afterTowerFloorChange() {
    activePlanId = (currentPlanFor(selTowerVal, selFloorVal) || {}).id || null;
    resetView();
    zonesEditMode = false; drawMode = null; drawPoints = []; editingZoneId = null; selectedZoneId = null;
    loadPins();   // loadPins() re-renders; loadZones() chains after via its own await inside load(), so call both here directly
    loadZones();
  }

  function render() {
    var host = $('bim-view');
    if (!host) return;
    // ⚠️ ROOT-CAUSE FIX (2026-08-30): this was `syncTools(true)`, unconditionally,
    // on EVERY render — including one triggered by load()'s own async
    // completion, which runs well after index.html's setScreen() has already
    // correctly hidden this screen's tools because the Gallery (or
    // Presentations) tab is the one actually active. That silently re-showed
    // "+ Upload floor plan" on top of a screen it doesn't belong to — the
    // exact symptom reported live and reproduced in the browser, with no
    // console error, because nothing here ever threw. Replaying the
    // last-known value (set by index.html's setScreen -> BIM._syncTools)
    // keeps a later re-render from overriding a screen switch that already
    // happened.
    syncTools(toolsVisible);

    var bar = towerFloorBarHTML();
    // No Location Breakdown at all, OR the level exists but the Schedule App
    // has no established Tower value yet — either way `bar` already carries
    // the correct guidance message and there is no valid Tower/Floor to view
    // a plan under, so stop here rather than falling through to a floor-plan
    // empty-state keyed on a selTowerVal that was never a real selection.
    if (!hasEstablishedLocations()) { host.innerHTML = bar; return; }

    var plan = currentPlanFor(selTowerVal, selFloorVal);
    activePlanId = plan ? plan.id : null;

    if (!plan) {
      host.innerHTML = bar +
        '<div class="pp-empty" style="padding:32px 12px;">' +
          '<span data-ico="compass" data-ico-size="34"></span>' +
          '<p>No floor plan uploaded for this floor.</p>' +
          (canWrite ? '<button class="pd-btn pd-btn-primary" id="bim-fp-add-empty">+ Add Floor Plan</button>' : '') +
        '</div>';
      wireTowerFloorBar();
      if ($('bim-fp-add-empty')) $('bim-fp-add-empty').onclick = function () { openPlanForm({ tower: selTowerVal, floor: selFloorVal, lock: true }); };
      hydrate();
      return;
    }

    var url = planUrl(plan);
    var aspect = (plan && plan.width_px && plan.height_px) ? (plan.height_px / plan.width_px) : 0.75;

    // Batch H: Register… / Actual view controls (existing, untouched).
    var reg = actualRegistrationFor(activePlanId);
    var toolbarExtra =
      (canWrite ? '<button class="pd-btn" id="bim-register">Register a top-view photo…</button>' : '') +
      (reg ? '<label class="ppr-allloc" style="display:inline-flex;align-items:center;gap:5px;margin:0;">' +
        '<input type="checkbox" id="bim-actualview"' + (actualView ? ' checked' : '') + ' /> Actual view</label>' : '');

    var actualUrl = (actualView && reg && reg.homography) ? '' : url; // Actual view swaps in a <canvas> instead of the <img>, painted after render()
    var revs = revisionsFor(selTowerVal, selFloorVal);

    var stageHTML =
      '<div class="bim-toolbar">' + toolbarExtra +
        '<span class="pp-hint">Ctrl+scroll to zoom · drag to pan</span>' +
        (actualView && reg ? '<span class="bim-placebadge" style="background:color-mix(in srgb, var(--pd-ink) 14%, var(--pd-card));color:var(--pd-ink);">Actual view — warped photo, not the drawing</span>' : '') +
        (drawMode ? '<span class="bim-placebadge">' + (drawMode === 'rectangle'
            ? (rectStart ? 'Click the opposite corner' : 'Click the first corner of the rectangle')
            : 'Click to add a point · double-click to finish (need at least 3)') + '</span>' : '') +
      '</div>' +
      '<div class="bim-viewerbar">' +
        '<button class="pd-btn" id="bim-vw-out" title="Zoom out">−</button>' +
        '<button class="pd-btn" id="bim-vw-fit" title="Fit to screen">Fit</button>' +
        '<button class="pd-btn" id="bim-vw-in" title="Zoom in">+</button>' +
        '<button class="pd-btn" id="bim-vw-reset" title="Reset view">Reset view</button>' +
        (selectedZoneId ? '<button class="pd-btn" id="bim-vw-clearsel" title="Clear selected zone">Clear selection</button>' : '') +
      '</div>' +
      '<div class="bim-stage-outer' + (drawMode ? ' is-drawing' : '') + '" id="bim-stage-outer">' +
        '<div class="bim-stage-inner" id="bim-stage-inner" style="transform:translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ');">' +
          '<div class="bim-imgwrap" id="bim-imgwrap" style="padding-bottom:' + (aspect * 100) + '%;">' +
            (actualUrl
              ? (isPdfPlan(plan)
                  // Item 11 — a PDF plan renders via the browser's native PDF
                  // viewer instead of <img> (which cannot display a PDF at
                  // all). ⚠️ Known limitation: some browsers' built-in PDF
                  // viewer captures pointer events itself, so click-to-pin
                  // may not register reliably over an embedded PDF — an
                  // image floor plan remains the more dependable choice.
                  ? '<embed id="bim-img" src="' + esc(actualUrl) + '" type="application/pdf" style="position:absolute;inset:0;width:100%;height:100%;border:0;" />'
                  : '<img id="bim-img" src="' + esc(actualUrl) + '" draggable="false" />')
              : (actualView && reg ? '<canvas id="bim-actual-canvas" style="position:absolute;inset:0;width:100%;height:100%;"></canvas>' :
              '<div class="pp-empty" style="position:absolute;inset:0;">Plan image not available</div>')) +
            zoneOverlaySVG() +
            pins.map(pinMarkerHTML).join('') +
          '</div>' +
        '</div>' +
      '</div>';

    var infoHTML =
      '<div class="bim-fp-info">' +
        '<div class="bim-fp-info-row">' +
          '<span><strong>Revision:</strong> ' + esc(plan.revision || 'Rev. 01') + (revs.length > 1 ? ' <button class="pd-linkbtn" id="bim-fp-history">History (' + revs.length + ')</button>' : '') + '</span>' +
          '<span><strong>Updated:</strong> ' + esc(fmtDate(plan.updated_at || plan.created_at)) + '</span>' +
          '<span><strong>Zones:</strong> ' + zones.length + '</span>' +
        '</div>' +
        (canWrite ? '<div class="bim-fp-info-actions">' +
          '<button class="pd-btn' + (zonesEditMode ? ' pd-btn-primary' : '') + '" id="bim-fp-editzones">' + (zonesEditMode ? 'Done editing zones' : 'Edit Zones') + '</button>' +
          '<button class="pd-btn" id="bim-fp-replace">Replace Plan</button>' +
        '</div>' : '') +
      '</div>';

    var zonePanelHTML = drawMode ? zoneDrawPanelHTML() : '';
    var zoneListPanel = '<div class="bim-zonelist"><h4>Zones</h4>' +
      (zones.length ? zones.map(function (z, i) {
        return '<div class="bim-zonelist-row' + (z.id === selectedZoneId ? ' active' : '') + '" data-zonerow="' + esc(z.id) + '">' +
          '<span class="bim-zonelist-dot" style="background:' + zoneColorFor(z.id) + ';"></span>' +
          '<span class="bim-zonelist-name">' + esc(z.name) + '</span>' +
          (zonesEditMode ? '<span class="bim-zonelist-acts">' +
            '<button type="button" class="pd-linkbtn" data-zoneedit="' + esc(z.id) + '">Edit</button>' +
            '<button type="button" class="pd-linkbtn" data-zonedel="' + esc(z.id) + '">Delete</button>' +
          '</span>' : '') +
        '</div>';
      }).join('') : '<p class="pp-hint">No zones defined yet.</p>') +
      (zonesEditMode && !drawMode ? '<button class="pd-btn pd-btn-primary" id="bim-zone-add" style="margin-top:8px;">+ Add Zone</button>' : '') +
    '</div>';

    host.innerHTML = bar + infoHTML + stageHTML + zonePanelHTML +
      '<div class="bim-withzones">' + zoneListPanel + '</div>';

    wireTowerFloorBar();
    // wirePlan() still wires the [data-pin] MARKER clicks on the stage.
    wirePlan();
    if ($('bim-register')) $('bim-register').onclick = openRegisterFlow;
    if ($('bim-actualview')) $('bim-actualview').onchange = function () { actualView = this.checked; render(); };
    if ($('bim-fp-history')) $('bim-fp-history').onclick = function () { openRevisionHistory(revs, plan); };
    if ($('bim-fp-editzones')) $('bim-fp-editzones').onclick = function () {
      zonesEditMode = !zonesEditMode;
      if (!zonesEditMode) { drawMode = null; drawPoints = []; editingZoneId = null; }
      render();
    };
    if ($('bim-fp-replace')) $('bim-fp-replace').onclick = function () { openPlanForm({ tower: selTowerVal, floor: selFloorVal, lock: true }); };
    if ($('bim-vw-out')) $('bim-vw-out').onclick = function () { zoom = Math.max(MIN_ZOOM, zoom * 0.8); applyTransform(); };
    if ($('bim-vw-in')) $('bim-vw-in').onclick = function () { zoom = Math.min(MAX_ZOOM, zoom * 1.25); applyTransform(); };
    if ($('bim-vw-fit')) $('bim-vw-fit').onclick = function () { resetView(); applyTransform(); };
    if ($('bim-vw-reset')) $('bim-vw-reset').onclick = function () { resetView(); applyTransform(); };
    if ($('bim-vw-clearsel')) $('bim-vw-clearsel').onclick = function () { selectedZoneId = null; render(); };
    wireZoneList();
    wireZoneDrawPanel();
    wireStageInteractions();
    hydrate();
    if (actualView && reg && reg.homography) paintActualView(reg);
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    if (window.Fmt && Fmt.date) return Fmt.date(iso);
    try { return new Date(iso).toLocaleDateString(); } catch (e) { return String(iso).slice(0, 10); }
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

  // ⚠️ RETIRED IN PLACE (2026-08-30 feedback item 27): "Place pin should not
  // be done in the floor plans page — place pin should be done every time a
  // photo is added." The #bim-place toolbar button that used to call this is
  // removed from index.html, so `placeMode` can now never become true and
  // every branch below that checks it is dead code — left defined (not
  // deleted) per this module's own established convention for superseded
  // code, since openPinPicker's "point a pin at an EXISTING panorama/3D scan"
  // capability may still be worth a future button elsewhere. The real,
  // per-photo pin+cone workflow now lives entirely in pinFieldHTML/
  // wirePinField/readPinField below, driven from module.js's Add/Edit form.
  function togglePlaceMode() {
    placeMode = !placeMode;
    if ($('bim-place')) $('bim-place').classList.toggle('is-active', placeMode);
    render();
  }

  // ------------------------------------------------------- pan/zoom/click ---
  function wireStageInteractions() {
    var outer = $('bim-stage-outer');
    if (!outer) return;
    // ⚠️ Audit fix: `outer` is a fresh DOM node every render() (rebuilt from
    // host.innerHTML = html), so its OWN listeners below are naturally
    // discarded with it — no leak there. window.addEventListener is
    // different: `window` never goes away, so binding these unconditionally
    // on every render() call (this function's previous behaviour) added TWO
    // MORE permanent mousemove/mouseup listeners each time, all still firing
    // on every mouse move across the WHOLE PAGE forever — an unbounded leak
    // that grew with every plan switch, place-mode toggle or resize-driven
    // re-render. They're wired exactly once now, reading the shared
    // dragging/lastX/lastY/moved state that every render's own mousedown
    // handler (below) sets fresh.
    if (!_stageWindowListenersWired) {
      _stageWindowListenersWired = true;
      window.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        var dx = e.clientX - lastX, dy = e.clientY - lastY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        panX += dx; panY += dy; lastX = e.clientX; lastY = e.clientY;
        applyTransform();
      });
      window.addEventListener('mouseup', function () { dragging = false; });
    }

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
      // 2026-09-03: while actively drawing a zone, a click places a point —
      // panning must be suspended, or every click-to-add-a-vertex would also
      // start a drag gesture (a real interaction conflict this stage never
      // had before zones existed).
      if (drawMode) return;
      dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY;
    });

    outer.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-pin]')) return;
      if (drawMode) { handleZoneDrawClick(e); return; }
      if (placeMode && !moved) {
        var img = $('bim-img'); if (!img) { UI.toast('Upload a floor plan image first', 'warn'); return; }
        var rect = img.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        var xNorm = (e.clientX - rect.left) / rect.width;
        var yNorm = (e.clientY - rect.top) / rect.height;
        if (xNorm < 0 || xNorm > 1 || yNorm < 0 || yNorm > 1) return;
        openPinPicker(xNorm, yNorm);
        return;
      }
      // Clicking a zone's own overlay polygon selects it — the "clicking a
      // zone on the floor plan identifies it in the list" half of spec §13.
      // Clicking anywhere else on the plan (bare background) clears the
      // selection, so a stale highlight can't linger with nothing to explain it.
      if (!moved) {
        var zoneEl = e.target.closest && e.target.closest('[data-zone]');
        var newSel = zoneEl ? zoneEl.getAttribute('data-zone') : null;
        if (newSel !== selectedZoneId) { selectedZoneId = newSel; render(); }
      }
    });
    outer.addEventListener('dblclick', function (e) {
      if (drawMode === 'polygon') { e.preventDefault(); finishPolygon(); }
    });
  }
  function applyTransform() {
    var el = $('bim-stage-inner');
    if (el) el.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
  }

  // ------------------------------------------------------------- zones -----
  // Spec §11: geometry is real, persisted data (floor_plan_zones.
  // boundary_coordinates), not a visual-only overlay — drawn/dragged points
  // are held in `drawPoints` purely as an in-memory WORKING COPY until Save
  // writes them; nothing here paints a shape that isn't backed by that array.
  var drawClosed = false;
  function polygonCentroid(pts) {
    var x = 0, y = 0;
    pts.forEach(function (p) { x += p.x; y += p.y; });
    return { x: x / pts.length, y: y / pts.length };
  }
  function zonePathD(pts) {
    return pts.map(function (p, i) { return (i === 0 ? 'M ' : 'L ') + (p.x * 100) + ',' + (p.y * 100); }).join(' ') + (pts.length >= 3 ? ' Z' : '');
  }
  function zoneOverlaySVG() {
    var body = '';
    zones.forEach(function (z) {
      if (z.id === editingZoneId) return; // live drawPoints below replaces its saved shape while being reshaped
      var pts = z.boundary_coordinates || [];
      if (pts.length < 3) return;
      var color = zoneColorFor(z.id);
      var isSel = z.id === selectedZoneId;
      var c = polygonCentroid(pts);
      body += '<path class="bim-zone-poly' + (isSel ? ' is-sel' : '') + '" data-zone="' + esc(z.id) + '" d="' + zonePathD(pts) +
        '" fill="' + color + '" fill-opacity="' + (isSel ? 0.4 : 0.22) + '" stroke="' + color + '" stroke-width="' + (isSel ? 0.7 : 0.35) + '" />' +
        '<text class="bim-zone-label" x="' + (c.x * 100) + '" y="' + (c.y * 100) + '" text-anchor="middle" dominant-baseline="middle">' + esc(z.name) + '</text>';
    });
    if (drawMode && drawPoints.length) {
      body += '<path class="bim-zone-drawing" d="' + zonePathD(drawPoints) + '" fill="var(--pd-red)" fill-opacity="0.18" stroke="var(--pd-red)" stroke-width="0.5" stroke-dasharray="1.4,1" />';
      drawPoints.forEach(function (p, i) {
        body += '<circle class="bim-zone-vertex" data-vertexidx="' + i + '" cx="' + (p.x * 100) + '" cy="' + (p.y * 100) + '" r="1.1" />';
      });
    }
    if (drawMode === 'rectangle' && rectStart) {
      body += '<circle class="bim-zone-vertex" cx="' + (rectStart.x * 100) + '" cy="' + (rectStart.y * 100) + '" r="1.1" />';
    }
    return '<svg class="bim-zone-svg" viewBox="0 0 100 100" preserveAspectRatio="none">' + body + '</svg>';
  }
  function handleZoneDrawClick(e) {
    var img = $('bim-img');
    if (!img) { UI.toast('Plan image not available', 'warn'); return; }
    var rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    var y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    if (drawMode === 'rectangle') {
      if (!rectStart) { rectStart = { x: x, y: y }; render(); return; }
      // Two clicks — opposite corners — is the whole gesture; Rectangle is a
      // faster convenience over Polygon's click-per-vertex, per spec §10.
      drawPoints = [
        { x: rectStart.x, y: rectStart.y }, { x: x, y: rectStart.y },
        { x: x, y: y }, { x: rectStart.x, y: y }
      ];
      rectStart = null; drawClosed = true;
      render();
      return;
    }
    if (drawClosed) return; // polygon already closed — Save/Clear/Cancel only
    drawPoints.push({ x: x, y: y });
    render();
  }
  function finishPolygon() {
    if (drawPoints.length < 3) { UI.toast('A zone boundary needs at least 3 points before it can be closed', 'warn'); return; }
    drawClosed = true;
    render();
  }
  function startAddZone() {
    drawMode = 'polygon'; drawClosed = false; drawPoints = []; rectStart = null;
    editingZoneId = null; drawName = nextZoneName();
    render();
  }
  function startEditZone(id) {
    var z = zoneById(id); if (!z) return;
    drawMode = z.boundary_type === 'rectangle' ? 'rectangle' : 'polygon';
    drawClosed = true; // an existing zone's saved geometry is already a closed shape
    drawPoints = (z.boundary_coordinates || []).map(function (p) { return { x: p.x, y: p.y }; });
    rectStart = null; editingZoneId = id; drawName = z.name;
    render();
  }
  function cancelZoneDraw() {
    drawMode = null; drawPoints = []; editingZoneId = null; rectStart = null; drawClosed = false;
    render();
  }
  async function saveZone() {
    var name = (drawName || '').trim();
    if (!name) { UI.toast('Name the zone first', 'warn'); return; }
    if (drawPoints.length < 3) { UI.toast('Draw a boundary with at least 3 points', 'warn'); return; }
    var btn = $('bim-zd-save'); if (btn) btn.disabled = true;
    var row = {
      floor_plan_id: activePlanId, project_id: pid, name: name,
      boundary_type: drawMode === 'rectangle' ? 'rectangle' : 'polygon',
      boundary_coordinates: drawPoints,
      color: editingZoneId ? zoneColorFor(editingZoneId) : ZONE_COLORS[zones.length % ZONE_COLORS.length],
      created_by: uid, updated_at: new Date().toISOString()
    };
    var res = editingZoneId
      ? await sb().from(T_ZONE).update(row).eq('id', editingZoneId)
      : await sb().from(T_ZONE).insert(row);
    if (res.error) {
      // §13: avoid duplicate zone names within the same floor plan revision
      // — enforced by a case-insensitive unique index; surfaced here as a
      // plain, actionable message rather than a raw constraint error.
      if (/duplicate key|unique constraint|idx_floor_plan_zones_name_uniq/i.test(res.error.message || '')) {
        UI.toast('A zone named "' + name + '" already exists on this floor plan — pick a different name.', 'error');
      } else {
        UI.toast('Could not save the zone: ' + res.error.message, 'error');
      }
      if (btn) btn.disabled = false;
      return;
    }
    UI.toast('Zone saved', 'ok');
    drawMode = null; drawPoints = []; editingZoneId = null; rectStart = null; drawClosed = false;
    await loadZones();
  }
  function deleteZone(id) {
    var z = zoneById(id); if (!z) return;
    if (!window.confirm('Delete zone "' + z.name + '"? This cannot be undone.')) return;
    sb().from(T_ZONE).delete().eq('id', id).then(function (res) {
      if (res.error) { UI.toast('Could not delete the zone: ' + res.error.message, 'error'); return; }
      if (selectedZoneId === id) selectedZoneId = null;
      UI.toast('Zone deleted', 'ok');
      loadZones();
    });
  }
  function zoneDrawPanelHTML() {
    return '<div class="bim-zonedraw">' +
      '<div class="pd-field"><label>Zone Name</label><input class="pd-input" id="bim-zd-name" value="' + esc(drawName) + '" /></div>' +
      '<div class="bim-zonedraw-tools">' +
        '<button type="button" class="pd-btn' + (drawMode === 'polygon' ? ' pd-btn-primary' : '') + '" id="bim-zd-polygon">Draw Polygon</button>' +
        '<button type="button" class="pd-btn' + (drawMode === 'rectangle' ? ' pd-btn-primary' : '') + '" id="bim-zd-rect">Draw Rectangle</button>' +
        (drawMode === 'polygon' && !drawClosed ? '<button type="button" class="pd-btn" id="bim-zd-finish">Finish shape</button>' : '') +
        '<button type="button" class="pd-btn" id="bim-zd-undo"' + (drawPoints.length ? '' : ' disabled') + '>Delete last point</button>' +
        '<button type="button" class="pd-btn" id="bim-zd-clear"' + (drawPoints.length ? '' : ' disabled') + '>Clear drawing</button>' +
      '</div>' +
      '<div class="bim-zonedraw-foot">' +
        '<button type="button" class="pd-btn" id="bim-zd-cancel">Cancel</button>' +
        '<button type="button" class="pd-btn pd-btn-primary" id="bim-zd-save">Save</button>' +
      '</div>' +
    '</div>';
  }
  function wireZoneDrawPanel() {
    if ($('bim-zd-name')) $('bim-zd-name').oninput = function () { drawName = this.value; };
    if ($('bim-zd-polygon')) $('bim-zd-polygon').onclick = function () { drawMode = 'polygon'; drawClosed = false; drawPoints = []; rectStart = null; render(); };
    if ($('bim-zd-rect')) $('bim-zd-rect').onclick = function () { drawMode = 'rectangle'; drawClosed = false; drawPoints = []; rectStart = null; render(); };
    if ($('bim-zd-finish')) $('bim-zd-finish').onclick = finishPolygon;
    if ($('bim-zd-undo')) $('bim-zd-undo').onclick = function () { drawPoints.pop(); drawClosed = false; render(); };
    if ($('bim-zd-clear')) $('bim-zd-clear').onclick = function () { drawPoints = []; rectStart = null; drawClosed = false; render(); };
    if ($('bim-zd-cancel')) $('bim-zd-cancel').onclick = cancelZoneDraw;
    if ($('bim-zd-save')) $('bim-zd-save').onclick = saveZone;
    var host = $('bim-view'); if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll('[data-vertexidx]'), function (h) { wireVertexDrag(h); });
  }
  // Drag an existing point to reshape the boundary — spec §9's "drag points
  // to adjust". Repositions the SVG in place during the drag (never a full
  // render, which would drop the pointer capture the drag itself set up,
  // the same discipline the pin/cone widgets above already established) and
  // only commits into `drawPoints` — Save is still what persists it.
  function wireVertexDrag(handleEl) {
    var idx = +handleEl.dataset.vertexidx;
    handleEl.onpointerdown = function (e) {
      e.stopPropagation();
      handleEl.setPointerCapture(e.pointerId);
      var img = $('bim-img');
      function move(ev) {
        if (!img) return;
        var rect = img.getBoundingClientRect();
        var x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        var y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
        drawPoints[idx] = { x: x, y: y };
        handleEl.setAttribute('cx', x * 100); handleEl.setAttribute('cy', y * 100);
        var poly = $('bim-view').querySelector('.bim-zone-drawing');
        if (poly) poly.setAttribute('d', zonePathD(drawPoints));
      }
      function up() { handleEl.onpointermove = null; window.removeEventListener('pointerup', up); }
      handleEl.onpointermove = move;
      window.addEventListener('pointerup', up);
    };
  }
  function wireZoneList() {
    var host = $('bim-view'); if (!host) return;
    if ($('bim-zone-add')) $('bim-zone-add').onclick = startAddZone;
    Array.prototype.forEach.call(host.querySelectorAll('[data-zonerow]'), function (row) {
      row.onclick = function (e) {
        if (e.target.closest && e.target.closest('[data-zoneedit],[data-zonedel]')) return;
        var id = this.dataset.zonerow;
        selectedZoneId = (selectedZoneId === id) ? null : id;
        render();
      };
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-zoneedit]'), function (b) {
      b.onclick = function (e) { e.stopPropagation(); startEditZone(this.dataset.zoneedit); };
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-zonedel]'), function (b) {
      b.onclick = function (e) { e.stopPropagation(); deleteZone(this.dataset.zonedel); };
    });
  }

  // -------------------------------------------------- revision history -----
  function openRevisionHistory(revs, currentPlan) {
    var ordered = revs.slice().reverse(); // newest first
    var html =
      '<div class="pd-modal-header"><h3>Revision history</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        ordered.map(function (p) {
          var isCur = p.id === currentPlan.id;
          return '<div class="bim-revrow' + (isCur ? ' is-current' : '') + '">' +
            '<div><strong>' + esc(p.revision || 'Rev. 01') + '</strong>' + (isCur ? ' <span class="bim-revbadge">CURRENT</span>' : '') +
              '<div class="pp-hint">Uploaded ' + esc(fmtDate(p.created_at)) + (p.created_by === uid ? ' by you' : '') + '</div></div>' +
            '<button type="button" class="pd-btn" data-viewrev="' + esc(p.id) + '">View</button>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Close</button></div>';
    var m = openModal(html, 480);
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-viewrev]'), function (b) {
      b.onclick = function () { openRevisionPreview(this.dataset.viewrev); };
    });
  }
  // Read-only — an older revision's own zones, frozen exactly as they were.
  // §16: editing an old revision is deliberately not supported; the current
  // revision (rendered by the main screen) is the only one zones can be
  // added/moved/deleted on.
  async function openRevisionPreview(planId) {
    var plan = planById(planId); if (!plan) return;
    var url = planUrl(plan);
    var aspect = (plan.width_px && plan.height_px) ? (plan.height_px / plan.width_px) : 0.75;
    var zs = [];
    try { zs = await PDb.selectAll(T_ZONE, function (q) { return q.eq('floor_plan_id', planId); }); } catch (e) {}
    var svgBody = zs.map(function (z, i) {
      var pts = z.boundary_coordinates || []; if (pts.length < 3) return '';
      var color = ZONE_COLORS[i % ZONE_COLORS.length];
      var c = polygonCentroid(pts);
      return '<path d="' + zonePathD(pts) + '" fill="' + color + '" fill-opacity="0.22" stroke="' + color + '" stroke-width="0.35" />' +
        '<text class="bim-zone-label" x="' + (c.x * 100) + '" y="' + (c.y * 100) + '" text-anchor="middle" dominant-baseline="middle">' + esc(z.name) + '</text>';
    }).join('');
    var html =
      '<div class="pd-modal-header"><h3>' + esc(plan.revision || 'Rev. 01') + ' — read only</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<p class="pp-hint">Historical revision, shown as it was — ' + zs.length + ' zone(s). Editing an old revision is not supported.</p>' +
        '<div class="bim-imgwrap" style="position:relative;padding-bottom:' + (aspect * 100) + '%;">' +
          (url ? '<img src="' + esc(url) + '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;" />' : '<div class="pp-empty" style="position:absolute;inset:0;">Plan image not available</div>') +
          '<svg class="bim-zone-svg" viewBox="0 0 100 100" preserveAspectRatio="none">' + svgBody + '</svg>' +
        '</div>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Close</button></div>';
    openModal(html, 640);
  }

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
      // ⚠️ urlOfPhotoId now returns a Promise (full-res is signed on
      // demand, not pre-signed for the whole project) — awaited here,
      // same as every other on-demand full-res consumer.
      var photoUrl = (window.ProgressPhotos && ProgressPhotos.urlOfPhotoId) ? await ProgressPhotos.urlOfPhotoId(reg.photo_id) : '';
      if (!photoUrl) throw new Error('That registered photo is no longer available');
      var plan = planById(reg.floor_plan_id);
      var planW = (plan && plan.width_px) || 1200, planH = (plan && plan.height_px) || 900;
      var img = await loadImage(photoUrl);
      var srcCanvas = toCanvas(img);
      // ⚠️ Audit fix: src/dst/M were only ever .delete()'d on the happy
      // path — a throw from warpPerspective/imshow (or a malformed
      // homography from matFromArray) skipped straight to the catch block
      // below, permanently leaking whichever WASM cv.Mat objects had
      // already been created. `var` hoisting makes each one safely
      // `undefined` in the finally block if its own line never ran.
      var src, dst, M;
      try {
        src = cv.imread(srcCanvas);
        dst = new cv.Mat();
        var h = reg.homography;
        M = cv.matFromArray(3, 3, cv.CV_64F, h);
        var dsize = new cv.Size(planW, planH);
        cv.warpPerspective(src, dst, M, dsize);
        canvas.width = planW; canvas.height = planH;
        cv.imshow(canvas, dst);
      } finally {
        if (src) src.delete();
        if (dst) dst.delete();
        if (M) M.delete();
      }
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
          '<div class="bim-regside"><div class="pp-hint">Drawing</div><img id="bim-reg-plan" src="' + esc(planImgUrl) + '" style="width:100%;cursor:crosshair;" draggable="false" />' +
            '<div id="bim-reg-plan-pts"></div></div>' +
          '<div class="bim-regside"><div class="pp-hint">Photo</div><img id="bim-reg-photo-img" src="" style="width:100%;cursor:crosshair;" draggable="false" />' +
            '<div id="bim-reg-photo-pts"></div></div>' +
        '</div>' +
        '<p class="pp-hint" id="bim-reg-status"></p>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn" id="bim-reg-undo">Undo last point</button>' +
        '<button class="pd-btn pd-btn-primary" id="bim-reg-save" disabled>Compute &amp; save</button></div>';
    var m = openModal(html, 760);

    // ⚠️ urlOfPhotoId now returns a Promise. This is genuinely on-demand
    // work now, not a synchronous cache read — the <img> shows nothing
    // until it resolves, guarded so a fast picker change can't have an
    // older photo's sign request land after a newer one and show the
    // wrong image.
    async function setPhotoImg() {
      var forId = chosenPhotoId;
      if ($('bim-reg-photo-img')) $('bim-reg-photo-img').src = '';
      var url = (window.ProgressPhotos && ProgressPhotos.urlOfPhotoId) ? await ProgressPhotos.urlOfPhotoId(chosenPhotoId) : '';
      if (chosenPhotoId !== forId) return;   // the picker moved on while this was in flight
      if ($('bim-reg-photo-img')) $('bim-reg-photo-img').src = url || '';
    }
    setPhotoImg();
    $('bim-reg-photo').onchange = function () {
      chosenPhotoId = this.value; pairs = []; pendingPlanPt = null;
      setPhotoImg(); refresh();
    };
    // Item 26: "the points cannot be seen. points should be visible for
    // easier verification." Every already-picked pair renders as a numbered
    // green dot on BOTH images (so a planner can visually confirm the
    // Nth point on the drawing lines up with the Nth on the photo), and a
    // point picked on the drawing but not yet matched on the photo shows as
    // a pulsing amber dot on the drawing side only.
    function paintPoints() {
      var planHost = $('bim-reg-plan-pts'), photoHost = $('bim-reg-photo-pts');
      if (planHost) planHost.innerHTML = pairs.map(function (p, i) {
        return '<span class="bim-regpt" style="left:' + (p.planX * 100) + '%;top:' + (p.planY * 100) + '%;">' + (i + 1) + '</span>';
      }).join('') + (pendingPlanPt ? '<span class="bim-regpt is-pending" style="left:' + (pendingPlanPt.planX * 100) + '%;top:' + (pendingPlanPt.planY * 100) + '%;">?</span>' : '');
      if (photoHost) photoHost.innerHTML = pairs.map(function (p, i) {
        return '<span class="bim-regpt" style="left:' + (p.photoX * 100) + '%;top:' + (p.photoY * 100) + '%;">' + (i + 1) + '</span>';
      }).join('');
    }
    function refresh() {
      if ($('bim-reg-status')) $('bim-reg-status').textContent = statusText();
      if ($('bim-reg-save')) $('bim-reg-save').disabled = pairs.length < MIN_REG_POINTS;
      paintPoints();
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
        // ⚠️ Audit fix: the "not enough spread" friendly-error throw used to
        // fire BEFORE .delete() ran, leaking srcMat/dstMat/H (H itself is a
        // real cv.Mat even when .empty() — it still needs deleting) on
        // exactly the path a planner is most likely to hit while getting
        // the feel of picking registration points.
        var srcMat, dstMat, H, hArr;
        try {
          srcMat = cv.matFromArray(pairs.length, 1, cv.CV_32FC2, srcPts);
          dstMat = cv.matFromArray(pairs.length, 1, cv.CV_32FC2, dstPts);
          H = cv.findHomography(srcMat, dstMat, cv.RANSAC);
          if (H.empty()) throw new Error('Could not compute a transform from these points — try more spread-out, distinct points');
          hArr = [];
          for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) hArr.push(H.doubleAt(r, c));
        } finally {
          if (srcMat) srcMat.delete();
          if (dstMat) dstMat.delete();
          if (H) H.delete();
        }

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
  // 2026-09-03: rebuilt for the Tower/Floor/Revision hierarchy. Tower and
  // Floor are dropdowns sourced from the project's own Location Breakdown
  // (spec §3's mockup) — pre-filled to whatever the main screen currently
  // has selected, and DISABLED (still submitting their value) when opened
  // as "Replace Plan" from an already-open floor, so a revision can't
  // accidentally land under the wrong floor. Opened generically (the topbar
  // "+ Add Floor Plan" button) they stay editable, since that button is
  // meant to work for ANY tower/floor, not just the one on screen.
  // Revision is always a free-text field the user can override — never
  // inferred from the filename (spec §4) — merely SUGGESTED as "Rev. 0N"
  // from how many revisions already exist for that Tower+Floor.
  // Uploaded By / Uploaded Date / Last Updated are never asked for here —
  // created_by/created_at/updated_at capture them automatically.
  function openPlanForm(opts) {
    opts = opts || {};
    var hasTower = !!towerLevel();
    var lock = !!opts.lock;
    var curTower = opts.tower != null ? opts.tower : selTowerVal;
    var curFloor = opts.floor != null ? opts.floor : selFloorVal;
    function suggestedRevision(t, f) {
      var n = revisionsFor(t, f).length + 1;
      return 'Rev. ' + (n < 10 ? '0' + n : n);
    }
    // ⚠️ 2026-09-04 correction: Tower/Floor are picked EXCLUSIVELY from the
    // Project Schedule App's Established Locations (towerOptions()/
    // floorOptions(), schedule-only — see distinctLocValues() in module.js).
    // There is deliberately NO free-text/"type a new value" escape hatch and
    // NO fallback to values only ever seen on photos — the Schedule App is
    // the single source of truth for Tower/Floor, and this modal must never
    // be able to invent or accept one. `hasEstablishedLocations()` gates
    // every caller of this function (see its callers below and the topbar
    // button's own guard), so by the time this modal opens with `hasTower`
    // true, towerOptions() is guaranteed non-empty — if that guarantee were
    // ever broken, refusing to render a select with nothing real to offer
    // (rather than inventing an escape hatch again) is the correct failure.
    var html =
      '<div class="pd-modal-header"><h3>' + (lock ? 'Upload new revision' : 'Add Floor Plan') + '</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        (hasTower
          ? '<div class="pd-field"><label>Tower</label><select class="pd-select" id="bim-p-tower"' + (lock ? ' disabled' : '') + '>' +
              towerOptions().map(function (v) { return '<option value="' + esc(v) + '"' + (v === curTower ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') +
            '</select></div>' +
            (floorLevel()
              ? '<div class="pd-field"><label>Floor</label><select class="pd-select" id="bim-p-floor"' + (lock ? ' disabled' : '') + '>' +
                  floorOptions(curTower).map(function (v) { return '<option value="' + esc(v) + '"' + (v === curFloor ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') +
                '</select></div>'
              : '')
          : '<div class="pd-field"><label>Name</label><input class="pd-input" id="bim-p-name" placeholder="e.g. Ground Floor" /></div>') +
        // ⚠️ Round-2 item 6 (2026-09-02) RETIRES PDF uploads — "for floor
        // plan, accept only images. no longer pdf". The accept attribute is
        // the actual gate (a picker limited to image mimetypes); the render
        // side (isPdfPlan/<embed>, below) is kept ONLY so a plan uploaded
        // under the earlier image-or-PDF rule still displays — nothing here
        // can create a new one any more.
        '<div class="pd-field"><label>Floor plan file</label><input type="file" id="bim-p-file" accept="image/*" /></div>' +
        '<div class="pd-field"><label>Revision</label><input class="pd-input" id="bim-p-rev" value="' + esc(suggestedRevision(curTower, curFloor)) + '" /></div>' +
        (lock ? '<p class="pp-hint">The previous revision is kept in History — it is never overwritten, and this new revision starts with no zones of its own.</p>' : '') +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="bim-p-save">Upload</button></div>';
    var m = openModal(html, 480);
    if (hasTower && !lock) {
      if ($('bim-p-tower')) $('bim-p-tower').onchange = function () {
        curTower = this.value;
        var fOpts = floorOptions(curTower);
        curFloor = fOpts[0] || null;
        if ($('bim-p-floor')) $('bim-p-floor').innerHTML = fOpts.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
        if ($('bim-p-rev')) $('bim-p-rev').value = suggestedRevision(curTower, curFloor);
      };
      if ($('bim-p-floor')) $('bim-p-floor').onchange = function () {
        curFloor = this.value;
        if ($('bim-p-rev')) $('bim-p-rev').value = suggestedRevision(curTower, curFloor);
      };
    }
    $('bim-p-save').onclick = async function () {
      var f = $('bim-p-file').files && $('bim-p-file').files[0];
      var nameEl = $('bim-p-name');
      var tSel = $('bim-p-tower'), fSel = $('bim-p-floor');
      if (hasTower) { curTower = tSel ? tSel.value : curTower; curFloor = fSel ? fSel.value : curFloor; }
      var revision = ($('bim-p-rev').value || '').trim() || 'Rev. 01';
      var name = hasTower ? towerFloorLabel(curTower, curFloor) : (nameEl ? nameEl.value.trim() : '');
      if (hasTower && !curTower) { UI.toast('Pick a Tower first', 'warn'); return; }
      if (!hasTower && !name) { UI.toast('Name is required', 'warn'); return; }
      if (!f) { UI.toast('Choose an image file', 'warn'); return; }
      this.disabled = true;
      try {
        var dims = await imageDims(f);
        var path = pid + '/floorplans/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '_' + f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        var up = await sb().storage.from(BUCKET).upload(path, f, { contentType: f.type || 'image/jpeg' });
        if (up.error) throw up.error;
        var locVals = hasTower ? towerFloorValues((function () {
          var t = towerLevel(), fl = floorLevel(), o = {};
          if (t) o[t.id] = curTower; if (fl) o[fl.id] = curFloor;
          return o;
        })()) : {};
        var row = {
          project_id: pid, name: name, level_order: 0,
          image_url: path, width_px: dims.w, height_px: dims.h, created_by: uid,
          location_values: locVals, revision: revision, is_current: true
        };
        // The revision this replaces (if any) is UPDATEd to is_current:false
        // FIRST, never deleted — §5/§16: a previous revision, and its own
        // zones (tied to ITS floor_plan_id, untouched by this), must survive.
        var superseded = hasTower ? currentPlanFor(curTower, curFloor) : null;
        if (superseded) {
          var upd = await sb().from(T_PLAN).update({ is_current: false }).eq('id', superseded.id);
          if (upd.error && !/column .* does not exist|schema cache/i.test(upd.error.message || '')) throw upd.error;
        }
        var ires = await sb().from(T_PLAN).insert(row).select();
        if (ires.error) {
          // Tolerant of either migration not having run yet: strip
          // location_values (2026-08-30-photos-round2.sql) and/or
          // revision/is_current (2026-09-03-floor-plan-revisions-zones.sql)
          // and retry, same convention every not-yet-migrated column in
          // this module family already follows.
          if (/column .* does not exist|schema cache/i.test(ires.error.message || '')) {
            var stripped = Object.assign({}, row);
            delete stripped.location_values; delete stripped.revision; delete stripped.is_current;
            ires = await sb().from(T_PLAN).insert(stripped).select();
            if (!ires.error) UI.toast('Uploaded, but without revision tracking/location — run the pending migrations', 'warn');
          }
          if (ires.error) throw ires.error;
        }
        m.close();
        UI.toast(superseded ? 'New revision uploaded — the previous one is kept in History' : 'Floor plan uploaded', 'ok');
        if (hasTower) { selTowerVal = curTower; selFloorVal = curFloor; }
        activePlanId = (ires.data && ires.data[0] && ires.data[0].id) || activePlanId;
        await load();
      } catch (e) {
        UI.toast('Could not upload: ' + (e.message || e), 'error');
        this.disabled = false;
      }
    };
  }

  // ⚠️ Round-2 item 6 (2026-09-02) retired PDF UPLOADS ("accept only
  // images, no longer pdf") — both upload paths now always call this for a
  // real image file, so the PDF short-circuit that used to sit here is
  // gone. It's kept defensive rather than assumed-impossible: a file
  // picker's `accept` attribute is advisory (some OS pickers/drag-drop
  // paths don't enforce it), so a non-decodable file still degrades to
  // {w:null,h:null} via onerror below rather than throwing.
  function imageDims(file) {
    return new Promise(function (resolve) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve({ w: null, h: null }); };
      img.src = url;
    });
  }
  // Whether a stored floor-plan file is a PDF, purely from its path's
  // extension (uploaded paths always keep the original filename's
  // extension, see the upload path-building above) — used by the renderer to
  // choose <embed> over <img>. ⚠️ Kept ONLY for a plan uploaded before
  // Round-2 item 6 retired PDF uploads — nothing in this file can produce a
  // NEW row this would match any more.
  function isPdfPlan(plan) { return !!(plan && plan.image_url && /\.pdf(\?|$)/i.test(plan.image_url)); }

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
    var curPlans = currentPlansList();
    if (!curPlans.length) {
      UI.toast('No floor plans yet — upload one on the Plans tab first', 'warn');
      if (onDone) onDone(false);
      return;
    }
    var chosenPlanId = activePlanId || curPlans[0].id;
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
        (curPlans.length > 1
          ? '<div class="pd-field"><label>Floor plan</label><select class="pd-select" id="bim-gpin-plan">' +
              curPlans.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === chosenPlanId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
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

  // --------------------------------------------------- embeddable pin field ---
  // 2026-08-30 feedback items 8/27/28. Renamed "Camera position" → "Key
  // Plan" and made REQUIRED (item 8); "Place pin" is gone from the Plans
  // page entirely — this is now the ONLY place a pin is ever placed (item
  // 27); and the direction/range interaction moves from a separate circular
  // widget BELOW the plan image to a field-of-view CONE drawn directly ON
  // the image itself, anchored to the pin (item 28): click the image to drop
  // a pin → a default cone appears facing the image's own centre → drag
  // either of its two end-point handles to reshape angle/range → double-
  // click the cone to mark "does not apply" for a top-view photo, where a
  // facing direction is meaningless. idPrefix-scoped ('pp' / 'pp-e') exactly
  // like every other embeddable field in this form.
  //
  // Geometry, pure and testable (same reasoning as _zoomAnchor/
  // _directionDegFromDrag above — a wrong sign here is silent: the widget
  // still looks interactive, it just draws the cone facing the wrong way).
  // Both take/return coordinates in one consistent unit (pixels OR
  // normalized 0..1 — the caller's choice, since bearing/offset math is
  // scale-free) so the same functions serve both the default-cone placement
  // (computed once in real rendered pixels, then divided down to 0..1 for
  // storage) and any future re-use.
  function bearingFromTo(px, py, qx, qy) { return (Math.atan2(qx - px, -(qy - py)) * 180 / Math.PI + 360) % 360; }
  function pointAtBearing(px, py, bearingDeg, dist) {
    var rad = bearingDeg * Math.PI / 180;
    return { x: px + dist * Math.sin(rad), y: py - dist * Math.cos(rad) };
  }
  var CONE_DEFAULT_FOV = 50;       // degrees between the two default edges
  var CONE_DEFAULT_REACH = 0.22;   // fraction of min(imgW,imgH) the default edges reach
  // The default cone for a freshly-placed pin: faces the image's own centre,
  // spread symmetrically. `xNorm,yNorm` are the pin's own normalized
  // position; `w,h` the image's REAL rendered pixel box (so the reach is a
  // consistent visual distance regardless of the image's aspect ratio).
  // Exported as `_defaultCone` for direct execution by the test harness.
  function defaultCone(xNorm, yNorm, w, h) {
    var px = xNorm * w, py = yNorm * h;
    var bearing = bearingFromTo(px, py, w / 2, h / 2);
    var reach = CONE_DEFAULT_REACH * Math.min(w, h);
    var e1 = pointAtBearing(px, py, bearing - CONE_DEFAULT_FOV / 2, reach);
    var e2 = pointAtBearing(px, py, bearing + CONE_DEFAULT_FOV / 2, reach);
    return { edge1_x: e1.x / w, edge1_y: e1.y / h, edge2_x: e2.x / w, edge2_y: e2.y / h };
  }
  // The bisector bearing between two edge points, relative to the pin —
  // kept as `direction_deg` purely so the OLDER renderers that already read
  // that one column (the Plans-page marker cone, the Gallery's key-plan
  // preview popup) keep drawing something sensible without being rewritten
  // to understand the new two-edge shape.
  function bisectorBearing(pinXNorm, pinYNorm, e1x, e1y, e2x, e2y, w, h) {
    var mx = ((e1x + e2x) / 2) * w, my = ((e1y + e2y) / 2) * h;
    return bearingFromTo(pinXNorm * w, pinYNorm * h, mx, my);
  }
  // ---------------------------------------------------------------------
  // Fifth round item 8: the field-of-view widget is rebuilt as a pie/sector
  // with ONE handle (was a straight-edged triangle with two independent
  // handles). `edge1_x/y`/`edge2_x/y` STAY the persisted shape (no schema
  // change) — only how they're derived and manipulated changes:
  //   - direction  = the bisector bearing (which way the camera faces)
  //   - halfWidth  = half the field-of-view's angular spread
  //   - reach      = how far out the sector extends (its radius)
  // Dragging the SECTOR BODY changes only `direction` (halfWidth/reach
  // unchanged); dragging the ONE handle (sitting at the sector's right/
  // clockwise edge) changes `halfWidth` and `reach` together, exactly the
  // "one button… both the depth and the angle width" ask — direction and
  // width+depth are simply two different gestures on two different targets,
  // rather than trying to pack three degrees of freedom into one point.
  function coneParamsFromEdges(px, py, e1x, e1y, e2x, e2y) {
    var b1 = bearingFromTo(px, py, e1x, e1y), b2 = bearingFromTo(px, py, e2x, e2y);
    var d1 = Math.hypot(e1x - px, e1y - py), d2 = Math.hypot(e2x - px, e2y - py);
    // Signed shortest angular difference b1->b2, so a cone that happens to
    // straddle the 0°/360° seam still resolves to the correct small gap
    // instead of the ~360°-wide "long way round".
    var diff = ((b2 - b1 + 540) % 360) - 180;
    return { dir: (b1 + diff / 2 + 360) % 360, halfW: Math.abs(diff) / 2, reach: (d1 + d2) / 2 };
  }
  function edgesFromCone(px, py, dir, halfW, reach) {
    var e1 = pointAtBearing(px, py, dir - halfW, reach), e2 = pointAtBearing(px, py, dir + halfW, reach);
    return { e1x: e1.x, e1y: e1.y, e2x: e2.x, e2y: e2.y };
  }

  function pinFieldHTML(idPrefix, existing) {
    var curPlans = currentPlansList();
    if (!curPlans.length) {
      // Item 8: upload a floor plan RIGHT HERE rather than sending the
      // planner away to the Plans tab and losing whatever else they'd
      // already filled in on this form.
      return '<div class="pd-field pp-span2"><label>Key Plan' + reqMarkHTML() + '</label>' +
        '<p class="pp-hint">No floor plans uploaded yet for this project.</p>' +
        '<div class="pp-inlineplanform" id="' + idPrefix + '-inlineplan">' +
          '<input class="pd-input" id="' + idPrefix + '-inlineplan-name" placeholder="Floor plan name, e.g. Ground Floor" />' +
          '<input type="file" id="' + idPrefix + '-inlineplan-file" accept="image/*" />' +
          '<button type="button" class="pd-btn" id="' + idPrefix + '-inlineplan-go">Upload</button>' +
        '</div></div>';
    }
    var chosenId = (existing && existing.floor_plan_id) || activePlanId || curPlans[0].id;
    return '<div class="pd-field pp-span2 bim-pinfield" id="' + idPrefix + '-pinfield">' +
      '<label>Key Plan' + reqMarkHTML() + ' <span class="pp-optnote">(click the plan to place a pin)</span></label>' +
      (curPlans.length > 1
        ? '<select class="pd-select" id="' + idPrefix + '-pin-plan">' +
            curPlans.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === chosenId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
          '</select>'
        : '<input type="hidden" id="' + idPrefix + '-pin-plan" value="' + esc(chosenId) + '" />') +
      '<div id="' + idPrefix + '-pin-imgwrap"></div>' +
      '<p class="pp-hint" id="' + idPrefix + '-pin-status">' +
        (existing ? 'Pin placed — drag it to move, or click elsewhere on the plan.' : 'Click the plan to drop a pin.') + '</p>' +
      (existing && existing.direction_na ? '<p class="bim-conena-badge" id="' + idPrefix + '-pin-nabadge">' +
        '<span data-ico="drone" data-ico-size="12"></span> Drone / top-view photo — no facing direction recorded</p>' : '') +
      '<p class="bim-conehint">Drag the pin to move it. Drag the small handle at the arc\'s edge to adjust the ' +
        'camera\'s angle and range, or the handle straight ahead of the pin to adjust just the facing ' +
        'direction. Click the pin once to switch between a ground-level camera view and a top-view drone shot.</p>' +
      '<input type="hidden" id="' + idPrefix + '-pin-x" value="' + (existing ? existing.x_norm : '') + '" />' +
      '<input type="hidden" id="' + idPrefix + '-pin-y" value="' + (existing ? existing.y_norm : '') + '" />' +
      '<input type="hidden" id="' + idPrefix + '-pin-e1x" value="' + (existing ? existing.edge1_x : '') + '" />' +
      '<input type="hidden" id="' + idPrefix + '-pin-e1y" value="' + (existing ? existing.edge1_y : '') + '" />' +
      '<input type="hidden" id="' + idPrefix + '-pin-e2x" value="' + (existing ? existing.edge2_x : '') + '" />' +
      '<input type="hidden" id="' + idPrefix + '-pin-e2y" value="' + (existing ? existing.edge2_y : '') + '" />' +
      '<input type="hidden" id="' + idPrefix + '-pin-na" value="' + (existing && existing.direction_na ? '1' : '') + '" />' +
    '</div>';
  }
  // module.js's own reqMark() is private to its closure — restated here
  // rather than exported, same cross-file convention ppr.js already
  // documents for its own local reqMark().
  function reqMarkHTML() { return ' <span class="pp-req">*</span>'; }

  function wirePinField(idPrefix) {
    var inlineWrap = $(idPrefix + '-inlineplan');
    if (inlineWrap) {
      // Item 8: upload a plan without leaving the Add/Edit Photo form. Once
      // saved, the pin field ITSELF is repainted in place (module.js never
      // re-renders the whole modal for this), so the planner can place a pin
      // on the plan they just uploaded without reopening anything.
      $(idPrefix + '-inlineplan-go').onclick = async function () {
        var name = $(idPrefix + '-inlineplan-name').value.trim();
        var f = $(idPrefix + '-inlineplan-file').files && $(idPrefix + '-inlineplan-file').files[0];
        if (!name) { UI.toast('Name the floor plan first', 'warn'); return; }
        if (!f) { UI.toast('Choose an image file', 'warn'); return; }
        this.disabled = true;
        try {
          var dims = await imageDims(f);
          var path = pid + '/floorplans/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '_' + f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          var up = await sb().storage.from(BUCKET).upload(path, f, { contentType: f.type || 'image/jpeg' });
          if (up.error) throw up.error;
          var row = { project_id: pid, name: name, level_order: 0, image_url: path, width_px: dims.w, height_px: dims.h, created_by: uid };
          var ires = await sb().from(T_PLAN).insert(row).select();
          if (ires.error) throw ires.error;
          UI.toast('Floor plan uploaded', 'ok');
          activePlanId = (ires.data && ires.data[0] && ires.data[0].id) || activePlanId;
          await load();   // repopulates plans[]/planUrlCache
          var field = $(idPrefix + '-pinfield-host') || $(idPrefix + '-inlineplan');
          if (field && field.parentElement) field.parentElement.innerHTML = pinFieldHTML(idPrefix, null);
          hydrateIfPossible();
          wirePinField(idPrefix);
        } catch (e) {
          UI.toast('Could not upload: ' + ((e && e.message) || e), 'error');
          this.disabled = false;
        }
      };
      return;
    }
    var field = $(idPrefix + '-pinfield'); if (!field) return;   // no plans yet and nothing was wired above either
    var planSel = $(idPrefix + '-pin-plan');
    function state() {
      var g = function (id) { var el = $(id); return el ? el.value : ''; };
      var x = g(idPrefix + '-pin-x'), y = g(idPrefix + '-pin-y');
      if (x === '' || y === '') return null;
      return {
        x: +x, y: +y,
        e1x: +g(idPrefix + '-pin-e1x') || 0, e1y: +g(idPrefix + '-pin-e1y') || 0,
        e2x: +g(idPrefix + '-pin-e2x') || 0, e2y: +g(idPrefix + '-pin-e2y') || 0,
        na: g(idPrefix + '-pin-na') === '1'
      };
    }
    function setState(s) {
      $(idPrefix + '-pin-x').value = s ? s.x : ''; $(idPrefix + '-pin-y').value = s ? s.y : '';
      $(idPrefix + '-pin-e1x').value = s ? s.e1x : ''; $(idPrefix + '-pin-e1y').value = s ? s.e1y : '';
      $(idPrefix + '-pin-e2x').value = s ? s.e2x : ''; $(idPrefix + '-pin-e2y').value = s ? s.e2y : '';
      $(idPrefix + '-pin-na').value = s && s.na ? '1' : '';
      var st = $(idPrefix + '-pin-status');
      if (st) st.textContent = s ? 'Pin placed — drag it to move, or click elsewhere on the plan.' : 'Click the plan to drop a pin.';
    }
    // Fifth round item 8 — a true pie slice (M pin, L edge1, ARC to edge2, Z)
    // instead of a 3-point polygon, with a radial gradient dark-at-the-pin
    // fading to light-at-the-arc, and no stroke at all. ⚠️ Suppressed
    // ENTIRELY (not a grey placeholder) when `s.na` — "does not apply" now
    // means genuinely invisible, matching the ask that double-clicking to
    // mark a top-view photo makes the camera angle disappear.
    function coneSvg(px, py, dir, halfW, reach) {
      var e = edgesFromCone(px, py, dir, halfW, reach);
      var P = [px * 100, py * 100], E1 = [e.e1x * 100, e.e1y * 100], E2 = [e.e2x * 100, e.e2y * 100];
      var R = reach * 100;
      var largeArc = halfW * 2 > 180 ? 1 : 0;
      var gradId = idPrefix + '-conegrad';
      return '<svg viewBox="0 0 100 100" preserveAspectRatio="none">' +
        '<defs><radialGradient id="' + gradId + '" gradientUnits="userSpaceOnUse" cx="' + P[0] + '" cy="' + P[1] + '" r="' + R + '">' +
          '<stop offset="0%" style="stop-color:var(--pd-red);stop-opacity:.85" />' +
          '<stop offset="100%" style="stop-color:var(--pd-red);stop-opacity:0" />' +
        '</radialGradient></defs>' +
        '<path class="bim-conewedge" id="' + idPrefix + '-pin-wedge" fill="url(#' + gradId + ')" stroke="none" ' +
          'd="M ' + P[0] + ',' + P[1] + ' L ' + E1[0] + ',' + E1[1] + ' A ' + R + ',' + R + ' 0 ' + largeArc + ',1 ' + E2[0] + ',' + E2[1] + ' Z" />' +
      '</svg>';
    }
    function stageHTML(planId, s) {
      var plan = planById(planId), url = planUrl(plan);
      if (!url) return '<div class="pp-empty">Plan image not available</div>';
      // Item 11: a PDF plan can still be pinned — pins land on the browser's
      // rendered PDF viewport the same way they land on an <img>, though (as
      // noted on the Plans-page renderer) some browsers' native PDF viewer
      // may intercept the click before it ever reaches this handler.
      var body = isPdfPlan(plan)
        ? '<embed id="' + idPrefix + '-pin-img" src="' + esc(url) + '" type="application/pdf" style="width:100%;height:320px;border:0;display:block;" />'
        : '<img id="' + idPrefix + '-pin-img" src="' + esc(url) + '" draggable="false" />';
      if (s) {
        var cone = coneParamsFromEdges(s.x, s.y, s.e1x, s.e1y, s.e2x, s.e2y);
        var handlePt = pointAtBearing(s.x, s.y, cone.dir + cone.halfW, cone.reach);
        // Item 3 (this round): a SECOND drag point, straight ahead of the pin
        // at the cone's own bearing/reach — "in the middle of the view" —
        // that adjusts ONLY the facing direction, leaving angle/reach (the
        // corner handle above) untouched. Both handles hide with the wedge
        // when NA (nothing to point in a direction that doesn't apply).
        var dirPt = pointAtBearing(s.x, s.y, cone.dir, cone.reach);
        // Fifth round item 8: NA hides the wedge outright, and the handles
        // (which exist only to adjust a wedge that isn't there) hide with
        // it — the pin dot itself becomes the only thing left to click back
        // into a visible cone (single click now, see wireStage below).
        body += (s.na ? '' : coneSvg(s.x, s.y, cone.dir, cone.halfW, cone.reach)) +
        // Item 3: the dot itself is now DRAGGABLE (wireStage wires a real
        // pointer-capture drag on it, same convention as the handles below)
        // and renders a person/drone icon reflecting `na` — "the pin should
        // switch from person icon to drone icon" — rather than a plain
        // circle. `Icons.svg()` is called directly (not the data-ico/hydrate
        // path) so the icon updates synchronously on every repaint/toggle
        // with no separate hydrate pass needed.
        '<div class="bim-pinstage-dot' + (s.na ? ' is-na' : '') + '" id="' + idPrefix + '-pin-dot" ' +
          'title="Drag to move · click to switch camera/drone view" ' +
          'style="left:' + (s.x * 100) + '%;top:' + (s.y * 100) + '%">' +
          (window.Icons ? Icons.svg(s.na ? 'drone' : 'person', 12) : '') +
        '</div>' +
        (s.na ? '' : '<div class="bim-conehandle-el" id="' + idPrefix + '-cone-handle" title="Drag to adjust angle and range" style="left:' + (handlePt.x * 100) + '%;top:' + (handlePt.y * 100) + '%"></div>') +
        (s.na ? '' : '<div class="bim-dirhandle-el" id="' + idPrefix + '-dir-handle" title="Drag to adjust facing direction" style="left:' + (dirPt.x * 100) + '%;top:' + (dirPt.y * 100) + '%"></div>');
      }
      return '<div class="bim-conestage">' + body + '</div>';
    }
    function repaint() {
      var wrap = $(idPrefix + '-pin-imgwrap'); if (!wrap) return;
      var s = state();
      wrap.innerHTML = stageHTML(planSel ? planSel.value : currentPlansList()[0].id, s);
      wireStage(s);
    }
    function toNorm(img, clientX, clientY) {
      var rect = img.getBoundingClientRect();
      return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
    }
    // Fifth round item 8: repaints the wedge/gradient/handle IN PLACE
    // (attribute updates only, never innerHTML) during a drag — replacing
    // the DOM mid-gesture would drop the pointer capture the drag itself
    // set up, silently ending it on the very next move.
    function paintConeLive(cur) {
      var cone = coneParamsFromEdges(cur.x, cur.y, cur.e1x, cur.e1y, cur.e2x, cur.e2y);
      var e = edgesFromCone(cur.x, cur.y, cone.dir, cone.halfW, cone.reach);
      var wedge = $(idPrefix + '-pin-wedge');
      if (wedge) {
        var P = [cur.x * 100, cur.y * 100], E1 = [e.e1x * 100, e.e1y * 100], E2 = [e.e2x * 100, e.e2y * 100], R = cone.reach * 100;
        var largeArc = cone.halfW * 2 > 180 ? 1 : 0;
        wedge.setAttribute('d', 'M ' + P[0] + ',' + P[1] + ' L ' + E1[0] + ',' + E1[1] + ' A ' + R + ',' + R + ' 0 ' + largeArc + ',1 ' + E2[0] + ',' + E2[1] + ' Z');
        var grad = document.getElementById(idPrefix + '-conegrad');
        if (grad) { grad.setAttribute('cx', P[0]); grad.setAttribute('cy', P[1]); grad.setAttribute('r', R); }
      }
      var handle = $(idPrefix + '-cone-handle');
      if (handle) {
        var hp = pointAtBearing(cur.x, cur.y, cone.dir + cone.halfW, cone.reach);
        handle.style.left = (hp.x * 100) + '%'; handle.style.top = (hp.y * 100) + '%';
      }
      // Item 3: keep the new direction-only handle glued to the arc's
      // bearing/reach during any drag that moves the pin, the wedge, or the
      // corner handle — all three change `cone.dir`/`cone.reach`, and this
      // handle's position is a pure function of both.
      var dirHandle = $(idPrefix + '-dir-handle');
      if (dirHandle) {
        var dp = pointAtBearing(cur.x, cur.y, cone.dir, cone.reach);
        dirHandle.style.left = (dp.x * 100) + '%'; dirHandle.style.top = (dp.y * 100) + '%';
      }
      // Item 3: the pin dot's own screen position is set directly by the
      // drag handler (dot.onpointerdown, below) rather than here, since a
      // pin-drag changes `cur.x/y` itself (paintConeLive's inputs), not a
      // value paintConeLive derives — but the dot's icon (person/drone) never
      // changes mid-drag (only on a tap), so nothing else to touch here.
    }
    function wireStage(s) {
      var img = $(idPrefix + '-pin-img'); if (!img) return;
      // Clicking the BARE image (no pin yet, or clicking outside the wedge/
      // handle) drops/moves the pin and re-seeds a fresh default cone facing
      // the image's centre.
      img.onclick = function (e) {
        var rect = img.getBoundingClientRect();
        var n = toNorm(img, e.clientX, e.clientY);
        var cone = defaultCone(n.x, n.y, rect.width, rect.height);
        setState({ x: n.x, y: n.y, e1x: cone.edge1_x, e1y: cone.edge1_y, e2x: cone.edge2_x, e2y: cone.edge2_y, na: false });
        repaint();
      };
      var wedge = $(idPrefix + '-pin-wedge'), dot = $(idPrefix + '-pin-dot'), handle = $(idPrefix + '-cone-handle');
      // Fifth round item 8: double-clicking the wedge (visible) turns it off.
      // Kept as a secondary way to toggle while the wedge is on screen —
      // item 3's real fix is below, on the pin dot itself, which works in
      // BOTH states (the wedge doesn't exist to double-click when NA).
      function toggleNA(e) {
        e.stopPropagation();
        var cur = state(); if (!cur) return;
        cur.na = !cur.na; setState(cur); repaint();
      }
      if (wedge) wedge.ondblclick = toggleNA;
      // Item 3: the pin dot is now a real drag target — dragging it moves
      // the pin AND translates both cone edges by the same delta, so the
      // wedge stays attached in the same shape/orientation as the pin moves
      // (edges are stored as ABSOLUTE points, never relative offsets, so
      // both must move together or the cone silently detaches). A genuine
      // TAP (movement stays under DOT_TAP_THRESHOLD the whole gesture) is
      // instead a single-click toggle between camera view (person icon) and
      // drone/top view (drone icon) — replacing the old double-click-the-
      // wedge gesture, which only ever worked while a wedge existed to
      // double-click. Wired for BOTH na states: dragging must work even with
      // no cone, and a drone-marked pin must be one click away from
      // switching back to camera view.
      var DOT_TAP_THRESHOLD = 6; // px of pointer travel; below this = a tap
      if (dot) dot.onpointerdown = function (e) {
        e.stopPropagation();
        var start = state(); if (!start) return;
        var startClientX = e.clientX, startClientY = e.clientY;
        // Snapshot taken at drag-start, same convention module.js's own
        // translateMarkupObj() already documents — every move computes the
        // TOTAL delta from this snapshot, never an incremental delta reapplied
        // move-to-move, so a fast drag can't compound its own rounding error.
        var startX = start.x, startY = start.y;
        var startE1x = start.e1x, startE1y = start.e1y, startE2x = start.e2x, startE2y = start.e2y;
        var moved = false;
        dot.setPointerCapture(e.pointerId);
        function move(ev) {
          var dxPx = ev.clientX - startClientX, dyPx = ev.clientY - startClientY;
          if (!moved && Math.hypot(dxPx, dyPx) > DOT_TAP_THRESHOLD) moved = true;
          if (!moved) return; // still within tap range — don't nudge the pin for a click
          var rect = img.getBoundingClientRect();
          var dx = dxPx / rect.width, dy = dyPx / rect.height;
          var cur = state(); if (!cur) return;
          cur.x = Math.max(0, Math.min(1, startX + dx));
          cur.y = Math.max(0, Math.min(1, startY + dy));
          cur.e1x = startE1x + dx; cur.e1y = startE1y + dy;
          cur.e2x = startE2x + dx; cur.e2y = startE2y + dy;
          setState(cur);
          dot.style.left = (cur.x * 100) + '%'; dot.style.top = (cur.y * 100) + '%';
          paintConeLive(cur);
        }
        function up() {
          dot.onpointermove = null;
          window.removeEventListener('pointerup', up);
          if (!moved) {
            var cur = state(); if (!cur) return;
            cur.na = !cur.na; setState(cur); repaint();
          }
        }
        dot.onpointermove = move;
        window.addEventListener('pointerup', up);
      };
      if (!s || s.na) return; // nothing else to wire — no wedge/handles rendered
      // Dragging the SECTOR BODY changes only the facing DIRECTION
      // (halfWidth/reach untouched) — recomputed from the pin to wherever
      // the pointer currently is. Kept alongside the new dedicated direction
      // handle below (item 3 asked to ADD a handle, not remove this gesture).
      if (wedge) wedge.onpointerdown = function (e) {
        e.stopPropagation();
        wedge.setPointerCapture(e.pointerId);
        function move(ev) {
          var n = toNorm(img, ev.clientX, ev.clientY);
          var cur = state(); if (!cur) return;
          var cone = coneParamsFromEdges(cur.x, cur.y, cur.e1x, cur.e1y, cur.e2x, cur.e2y);
          var newDir = bearingFromTo(cur.x, cur.y, n.x, n.y);
          var edges = edgesFromCone(cur.x, cur.y, newDir, cone.halfW, cone.reach);
          cur.e1x = edges.e1x; cur.e1y = edges.e1y; cur.e2x = edges.e2x; cur.e2y = edges.e2y;
          setState(cur); paintConeLive(cur);
        }
        function up() { wedge.onpointermove = null; window.removeEventListener('pointerup', up); }
        wedge.onpointermove = move;
        window.addEventListener('pointerup', up);
      };
      // Dragging the CORNER handle changes BOTH half-width (angle) and reach
      // (depth) together — "the existing one is for the angle and range",
      // per the ask — direction stays whatever it was before this drag.
      if (handle) handle.onpointerdown = function (e) {
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        function move(ev) {
          var n = toNorm(img, ev.clientX, ev.clientY);
          var cur = state(); if (!cur) return;
          var cone = coneParamsFromEdges(cur.x, cur.y, cur.e1x, cur.e1y, cur.e2x, cur.e2y);
          var newBearing = bearingFromTo(cur.x, cur.y, n.x, n.y);
          var newReach = Math.max(0.02, Math.hypot(n.x - cur.x, n.y - cur.y));
          var diff = ((newBearing - cone.dir + 540) % 360) - 180;
          var newHalfW = Math.max(4, Math.min(88, Math.abs(diff)));
          var edges = edgesFromCone(cur.x, cur.y, cone.dir, newHalfW, newReach);
          cur.e1x = edges.e1x; cur.e1y = edges.e1y; cur.e2x = edges.e2x; cur.e2y = edges.e2y;
          setState(cur); paintConeLive(cur);
        }
        function up() { handle.onpointermove = null; window.removeEventListener('pointerup', up); }
        handle.onpointermove = move;
        window.addEventListener('pointerup', up);
      };
      // Item 3: the NEW handle, sitting straight ahead of the pin at the
      // cone's own bearing/reach — "one more small drag point for the
      // direction of the camera angle in the middle of the view" — changes
      // ONLY the facing direction, leaving half-width/reach exactly as they
      // are (the inverse split from the corner handle above: that one keeps
      // direction fixed and varies angle+reach; this one keeps angle+reach
      // fixed and varies only direction).
      var dirHandle = $(idPrefix + '-dir-handle');
      if (dirHandle) dirHandle.onpointerdown = function (e) {
        e.stopPropagation();
        dirHandle.setPointerCapture(e.pointerId);
        function move(ev) {
          var n = toNorm(img, ev.clientX, ev.clientY);
          var cur = state(); if (!cur) return;
          var cone = coneParamsFromEdges(cur.x, cur.y, cur.e1x, cur.e1y, cur.e2x, cur.e2y);
          var newDir = bearingFromTo(cur.x, cur.y, n.x, n.y);
          var edges = edgesFromCone(cur.x, cur.y, newDir, cone.halfW, cone.reach);
          cur.e1x = edges.e1x; cur.e1y = edges.e1y; cur.e2x = edges.e2x; cur.e2y = edges.e2y;
          setState(cur); paintConeLive(cur);
        }
        function up() { dirHandle.onpointermove = null; window.removeEventListener('pointerup', up); }
        dirHandle.onpointermove = move;
        window.addEventListener('pointerup', up);
      };
    }
    if (planSel) planSel.onchange = function () { setState(null); repaint(); };
    repaint();
  }
  function readPinField(idPrefix) {
    var inlineWrap = $(idPrefix + '-inlineplan');
    if (inlineWrap) return null;   // no plans exist yet — nothing to read
    var field = $(idPrefix + '-pinfield'); if (!field) return null;
    var planSel = $(idPrefix + '-pin-plan');
    var planId = planSel ? planSel.value : null;
    var g = function (id) { var el = $(id); return el ? el.value : ''; };
    var x = g(idPrefix + '-pin-x'), y = g(idPrefix + '-pin-y');
    if (!planId || x === '' || y === '') return null;   // planner left it blank — nothing to save
    var e1x = g(idPrefix + '-pin-e1x'), e1y = g(idPrefix + '-pin-e1y'), e2x = g(idPrefix + '-pin-e2x'), e2y = g(idPrefix + '-pin-e2y');
    var na = g(idPrefix + '-pin-na') === '1';
    var dir = na ? null : bisectorBearing(+x, +y, +e1x, +e1y, +e2x, +e2y, 1, 1);
    return {
      floor_plan_id: planId, x_norm: +x, y_norm: +y,
      edge1_x: e1x === '' ? null : +e1x, edge1_y: e1y === '' ? null : +e1y,
      edge2_x: e2x === '' ? null : +e2x, edge2_y: e2y === '' ? null : +e2y,
      direction_na: na, direction_deg: dir
    };
  }
  function hydrateIfPossible() { if (window.Icons && Icons.hydrate) Icons.hydrate($('bim-view') || document.body); }
  // Insert-or-update the ONE pin for an item — module.js's Add/Edit Photo
  // form calls this once per saved photo id, right inside its own save flow
  // (item 27/28: pin placement lives HERE, not on the Plans page).
  // `pinData === null` is a no-op: the planner left the field blank, and
  // that must never delete/disturb a pin the item already had (this form has
  // no "clear the pin" affordance — only add-or-move — so there is nothing
  // else a blank field could honestly mean here).
  async function savePinForItem(itemType, itemId, pinData) {
    if (!pinData) return;
    var existing = pinsByItem(itemType, itemId)[0] || null;
    var row = {
      floor_plan_id: pinData.floor_plan_id, project_id: pid, item_type: itemType, item_id: itemId,
      x_norm: pinData.x_norm, y_norm: pinData.y_norm, direction_deg: pinData.direction_deg,
      edge1_x: pinData.edge1_x, edge1_y: pinData.edge1_y, edge2_x: pinData.edge2_x, edge2_y: pinData.edge2_y,
      direction_na: pinData.direction_na, created_by: uid
    };
    var res = existing
      ? await sb().from(T_PIN).update(row).eq('id', existing.id)
      : await sb().from(T_PIN).insert(row);
    if (res.error && /column .* does not exist|schema cache/i.test(res.error.message || '')) {
      // Tolerant of migrations/2026-08-30-photos-round2.sql not having run
      // yet — same "strip the new columns, warn, retry" convention every
      // not-yet-migrated column in this module family already follows.
      var stripped = Object.assign({}, row);
      delete stripped.edge1_x; delete stripped.edge1_y; delete stripped.edge2_x; delete stripped.edge2_y; delete stripped.direction_na;
      res = existing
        ? await sb().from(T_PIN).update(stripped).eq('id', existing.id)
        : await sb().from(T_PIN).insert(stripped);
      if (!res.error) UI.toast('Pin saved without its cone shape — run migrations/2026-08-30-photos-round2.sql', 'warn');
    }
    if (res.error) { UI.toast('Key Plan pin not saved: ' + res.error.message, 'warn'); return; }
    await loadAllPins();
    if (activePlanId === row.floor_plan_id) await loadPins();
  }

  return {
    init: init,
    _syncTools: syncTools,
    // Test-only hook, same convention as ppr.js's — genuinely executes
    // render() so a regression of the 2026-08-30 syncTools(true) bug (a
    // re-render silently re-showing "+ Upload floor plan" on a screen it
    // doesn't belong to) is caught by running the real code, not just by
    // reading it. Guards on host existing, same as render() itself.
    _render: function () { render(); },
    // Test-only hook — same reasoning as ppr.js's own _setCanWrite. Never
    // called from production code.
    _setCanWrite: function (v) { canWrite = v; },
    // Gallery upload follow-up (Batch E) — see openPinPickerFor's own comment.
    openPinPickerFor: openPinPickerFor,
    // 2026-08-29 item 11 — the embeddable form field, see pinFieldHTML's own
    // comment above for why this superseded openPinPickerFor's after-the-fact
    // popup for the ordinary Add/Edit Photo flow (openPinPickerFor itself is
    // left in place — still reachable, just no longer called from there).
    pinFieldHTML: pinFieldHTML,
    wirePinField: wirePinField,
    readPinField: readPinField,
    savePinForItem: savePinForItem,
    hasPlans: function () { return plans.length > 0; },
    // Test-only hook (same convention as _zoomAnchor/_directionDegFromDrag):
    // drives load() directly with an injected pid, bypassing init()'s
    // onProject wiring — whose button-binding side effects aren't needed to
    // exercise load()'s own async error handling (the audit fix: a real
    // network failure signing the plan images must not leave the screen
    // stuck on "Loading floor plans…" forever).
    _load: function (testPid) { if (testPid) pid = testPid; return load(); },
    // Presentation-view item 8: the SAME pin+cone marker markup the Plans
    // tab's own full view uses, exported so ppr.js's small key-plan overlay
    // never has to duplicate the pin/cone drawing rules (position, cone
    // gradient, NA-hiding) a second time.
    keyPlanMarkerHTML: function (pin) { return pinMarkerHTML(pin); },
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
    // Fifth round item 8 — the pie-cone math, genuinely executed for the same
    // reason directionDegFromDrag already is: a flipped sign silently points
    // or resizes the cone wrong while it still LOOKS interactive.
    _coneParamsFromEdges: function (px, py, e1x, e1y, e2x, e2y) { return coneParamsFromEdges(px, py, e1x, e1y, e2x, e2y); },
    _edgesFromCone: function (px, py, dir, halfW, reach) { return edgesFromCone(px, py, dir, halfW, reach); },
    // Item 28 — the in-photo cone geometry, same reasoning: a wrong sign or
    // a wrong reach fraction is silent (the widget still looks interactive).
    _defaultCone: function (xNorm, yNorm, w, h) { return defaultCone(xNorm, yNorm, w, h); },
    _bearingFromTo: function (px, py, qx, qy) { return bearingFromTo(px, py, qx, qy); },
    // Item 3 — the new direction-only handle's position is a pure function
    // of pointAtBearing; exported for the same reason every other cone-math
    // helper here is: a flipped sign is silent (the handle still looks
    // interactive, it just sits somewhere geometrically wrong).
    _pointAtBearing: function (px, py, bearingDeg, dist) { return pointAtBearing(px, py, bearingDeg, dist); },
    _bisectorBearing: function (px, py, e1x, e1y, e2x, e2y, w, h) { return bisectorBearing(px, py, e1x, e1y, e2x, e2y, w, h); },
    // Read accessors for module.js's own Gallery Plan/Stack views (item 16,
    // which relocated Map/Stack out of this screen per item 15). Plan view
    // needs to browse every floor plan and its pins without disturbing this
    // screen's own activePlanId/pan-zoom state — the same "self-contained,
    // never touches this screen's state" rule openPinPickerFor already
    // follows for the Gallery's upload-time pin picker.
    // 2026-09-03: only CURRENT revisions — a Gallery Plan/Stack browse
    // should never surface a superseded historical drawing alongside live
    // ones (that's what openRevisionHistory/openRevisionPreview are for).
    plans: function () { return currentPlansList().sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); }); },
    planUrl: function (plan) { return planUrl(plan); },
    pinsForPlan: function (planId) { return allPins.filter(function (p) { return p.floor_plan_id === planId; }); }
  };
})();
