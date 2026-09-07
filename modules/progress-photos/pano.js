// ============================================================================
// Progress Photos — Panoramic Capture (brief Section 2/6, Phase 3)
// ----------------------------------------------------------------------------
// Capture: staff spin in place recording a short video (or upload one, since
// getUserMedia camera access is unreliable to test outside a real phone).
// Frames are extracted client-side (canvas grabs from a hidden <video>, no
// ffmpeg needed) and stitched with OpenCV.js (WASM, loaded via CDN — no
// server round-trip, matching brief 6.2's "no dedicated 360° hardware").
//
// ⚠️ HONEST SCOPE NOTE, stated here rather than left implicit: standard
// browser builds of OpenCV.js do NOT expose `cv.Stitcher` — its JS bindings
// were never added to the default build whitelist. This uses the lower-level
// primitives instead (ORB features -> BFMatcher -> findHomography ->
// warpPerspective), sequentially compositing frame N+1 onto the panorama
// built from frames 1..N. That produces a real, working PLANAR mosaic, not a
// mathematically rigorous spherical/equirectangular projection — true
// equirectangular reprojection needs known camera intrinsics and a
// rotation-only motion model, a separate piece of work. The mosaic is
// rendered on a Three.js CYLINDER (inside-out), which gives a genuine
// drag-to-look-around feel for the brief's actual use case (a horizontal
// spin) without claiming full spherical (up/down) coverage.
// ============================================================================

window.PANO = (function () {
  var T_PANO  = 'panoramas';
  var BUCKET  = 'progress-photos';
  var SIGN_TTL = 3600;
  var FRAME_COUNT = 10;          // frames sampled evenly across the source video
  var MIN_GOOD_MATCHES = 12;     // below this for any pair -> stitch_quality = 'poor'

  var profile = null, uid = null, pid = null, projName = '';
  var canWrite = false;
  var panoramas = [];
  var urlCache = {};
  var screen = 'list';           // list | view | compare
  var viewPanoId = null, compareIds = [null, null];

  function sb() { return AppAuth.getSB(); }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return Fmt.esc(s); }

  // ⚠️ Audit fix: `onClose` (optional) is run on EVERY way this modal can
  // be dismissed — the × / Cancel [data-close] buttons AND a backdrop
  // click. UI.modal()'s own backdrop listener closes over a PRIVATE `close`
  // variable, not the returned `m.close` PROPERTY — so a caller reassigning
  // `m.close` (or, as here, just wiring [data-close] to something extra)
  // is silently bypassed on backdrop dismissal specifically. Passing
  // {noBackdropClose:true} disables that internal listener so this
  // function's own — which DOES route through the same `close()` used by
  // [data-close] — is the only one active. Callers that don't need cleanup
  // (most of pano.js's modals) simply omit `onClose` and get the previous
  // behaviour unchanged.
  function openModal(html, width, onClose) {
    var m = UI.modal(html, { noBackdropClose: true });
    var box = m.el.querySelector('.pd-modal');
    if (box && width) box.style.maxWidth = width + 'px';
    function close() { if (onClose) { try { onClose(); } catch (e) {} } m.close(); }
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-close]'), function (b) { b.onclick = close; });
    m.el.addEventListener('click', function (e) { if (e.target === m.el) close(); });
    if (window.Icons && Icons.hydrate) Icons.hydrate(m.el);
    m.close = close;
    return m;
  }

  // ------------------------------------------------------------------ init ---
  function init(user, prof) {
    profile = prof; uid = user.id;
    canWrite = ['super_admin', 'admin', 'planner'].indexOf(prof.role) >= 0;
    wire();
    ProgressPhotos.onProject(function (p, name) { pid = p; projName = name; load(); });
  }

  function wire() {
    if ($('pano-new')) $('pano-new').onclick = function () { openCaptureModal(); };
    if ($('pano-compare-btn')) $('pano-compare-btn').onclick = function () { openCompareModal(); };
  }

  function syncTools(visible) {
    if ($('pano-new')) $('pano-new').style.display = (visible && canWrite) ? '' : 'none';
    if ($('pano-compare-btn')) $('pano-compare-btn').style.display = visible ? '' : 'none';
  }

  // ------------------------------------------------------------------ load ---
  async function load() {
    var host = $('pano-view');
    if (!host) return;
    if (!pid) { host.innerHTML = '<div class="pp-empty">Select a project.</div>'; return; }
    host.innerHTML = '<div class="pp-empty">Loading panoramas…</div>';
    try {
      panoramas = await PDb.selectAll(T_PANO, function (q) { return q.eq('project_id', pid); });
      panoramas.sort(function (a, b) { return String(b.taken_at || '').localeCompare(String(a.taken_at || '')); });
    } catch (e) {
      panoramas = [];
      if (!/schema cache|does not exist/i.test((e && e.message) || '')) UI.toast(e.message || String(e), 'error');
    }
    await signAll();
    render();
  }

  async function signAll() {
    urlCache = {};
    var paths = panoramas.map(function (p) { return p.pano_url; }).filter(Boolean);
    if (!paths.length) return;
    var res = await sb().storage.from(BUCKET).createSignedUrls(paths, SIGN_TTL);
    if (res.error) return;
    (res.data || []).forEach(function (d) { if (d && d.signedUrl && !d.error) urlCache[d.path] = d.signedUrl; });
  }

  function urlOf(path) { return path ? (urlCache[path] || '') : ''; }
  function panoById(id) { return panoramas.filter(function (p) { return p.id === id; })[0] || null; }

  // Same union rule as ppr.js's allLocationCombos() — restated here rather
  // than shared, since this file holds no dependency on ppr.js and each
  // module-internal file already keeps its own copy of this small merge
  // (see ppr.js's own comment on why: independently-loaded state per file).
  function allLocationCombos() {
    var byKey = {};
    (window.ProgressPhotos && ProgressPhotos.locCombos ? ProgressPhotos.locCombos() : [])
      .forEach(function (c) { byKey[c.key] = c; });
    (window.ProgressPhotos && ProgressPhotos.photoLocCombos ? ProgressPhotos.photoLocCombos() : [])
      .forEach(function (c) { if (!byKey[c.key]) byKey[c.key] = c; });
    return Object.keys(byKey).map(function (k) { return byKey[k]; }).sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  // ---------------------------------------------------------------- render ---
  function hydrate() { if (window.Icons && Icons.hydrate) Icons.hydrate($('pano-view')); }

  function render() {
    var host = $('pano-view');
    if (!panoramas.length) {
      host.innerHTML = '<div class="pp-empty">' +
        '<span data-ico="camera" data-ico-size="34"></span>' +
        '<p>No panoramas captured yet for this project.</p>' +
        (canWrite ? '<p class="pp-hint">Press <strong>+ Capture 360°</strong>, pick a location, and spin ' +
          'in place while recording (or upload a walkthrough video) to build one.</p>' : '') +
        '</div>';
      hydrate(); return;
    }
    var cards = panoramas.map(function (p) {
      var u = urlOf(p.pano_url);
      return '<div class="pano-card" data-id="' + esc(p.id) + '">' +
        '<div class="pano-thumb">' +
          (u ? '<img src="' + esc(u) + '" alt="' + esc(p.location || 'Panorama') + '" />'
             : '<div class="pp-noimg"><span data-ico="camera" data-ico-size="20"></span></div>') +
          (p.stitch_quality === 'poor' ? '<span class="pano-badge pano-badge-warn" title="Some frames did not stitch cleanly — consider re-capturing">Low confidence</span>' : '') +
        '</div>' +
        '<div class="pano-meta">' +
          '<div class="pano-loc">' + esc(p.location || 'Unassigned') +
            (p.source === 'drone' ? ' <span class="pano-src" title="Drone-sourced footage">Drone</span>' : '') + '</div>' +
          '<div class="pano-date">' + esc(Fmt.date(p.taken_at)) + (p.activity_name ? ' · ' + esc(p.activity_name) : '') + '</div>' +
        '</div>' +
        '<div class="pano-acts">' +
          '<button class="pd-btn" data-act="view" data-id="' + esc(p.id) + '">View 360&deg;</button>' +
          (canWrite ? '<button class="pp-iconbtn pp-del" data-act="del" data-id="' + esc(p.id) + '" title="Delete">' +
                      '<span data-ico="trash" data-ico-size="15"></span></button>' : '') +
        '</div></div>';
    }).join('');
    host.innerHTML = '<div class="pano-grid">' + cards + '</div>';
    Array.prototype.forEach.call(host.querySelectorAll('[data-act]'), function (el) {
      el.onclick = function () {
        var p = panoById(el.dataset.id); if (!p) return;
        if (el.dataset.act === 'view') openViewer(p.id);
        else if (el.dataset.act === 'del') removePano(p);
      };
    });
    hydrate();
  }

  async function removePano(p) {
    if (!confirm('Delete this panorama? This cannot be undone.')) return;
    // ⚠️ Same `.select()` guard as `deletePano` below, and for the same
    // reason — the RLS DELETE policy is owner-or-admin, not any writer, and
    // a plain `.delete()` with no `.select()` cannot tell "actually deleted"
    // from "RLS silently matched 0 rows". Fixed here too even though this
    // function is dormant (its only caller, #pano-view, is unreachable from
    // the current UI) so it can't reintroduce the same false-success trap if
    // that screen is ever brought back.
    var res = await sb().from(T_PANO).delete().eq('id', p.id).select();
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    if (!res.data || !res.data.length) {
      UI.toast('You do not have permission to delete this — only the person who uploaded it or an admin can.', 'error');
      return;
    }
    if (p.pano_url) { try { await sb().storage.from(BUCKET).remove([p.pano_url]); } catch (e) {} }
    UI.toast('Panorama deleted', 'ok');
    await load();
  }

  // Bug fix (2026-09-04): panoramas had NO delete path reachable from the
  // merged Gallery grid at all — module.js's mediaKindThumbHTML() never
  // rendered a delete icon and openMediaKindEditor()'s footer only had
  // Cancel/Save, so `removePano` above (wired only to this module's own
  // #pano-view screen, which Batch C made unreachable from the UI) was the
  // only place this logic existed. Same signature convention as `removePano`
  // (takes the real row object, not an id — module.js's editor already holds
  // the exact live reference as `row._src`, per panoPseudoRow's own comment,
  // so there's no id-lookup/reload needed here to find it). No confirm() of
  // its own — the caller (module.js) shows its own confirm modal matching the
  // rest of that module's delete flow — and it keeps the in-memory
  // `panoramas` array (and this screen's own render, if it's ever visible
  // again) in sync rather than requiring a full reload to notice the row is gone.
  // ⚠️ REAL BUG FIXED (2026-09-04, exhausting the "still can't delete"
  // report): this table's DELETE RLS policy (the generic module-table loop
  // in supabase-schema.sql) is `is_writer() and (created_by = auth.uid() or
  // is_admin())` — NOT "any writer", despite this file's own earlier claim
  // that panoramas needed no DB change. A non-admin planner deleting a
  // panorama someone ELSE uploaded is silently refused BY POSTGRES: the
  // DELETE matches 0 rows and Supabase reports that as a plain success with
  // no error. The old code below only checked `res.error`, so it read that
  // silent refusal as "deleted" — toasted success, spliced the row out of
  // the in-memory array so it visibly vanished from the grid — while the row
  // was NEVER actually removed from the database, and reappears on the next
  // reload/resync. Exactly the same trap `deleteRequest` below was already
  // built to guard against (`.select()` + check the returned row count);
  // this function just never got the same guard.
  async function deletePano(p) {
    if (!p || !p.id) return { ok: false, error: 'That panorama could not be found' };
    var res = await sb().from(T_PANO).delete().eq('id', p.id).select();
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || !res.data.length) {
      return { ok: false, error: 'You do not have permission to delete this — only the person who uploaded it or an admin can.' };
    }
    // Storage cleanup only after a REAL row delete is confirmed — removing
    // the file first and then discovering RLS refused the row would leave
    // the row pointing at a now-missing object.
    if (p.pano_url) { try { await sb().storage.from(BUCKET).remove([p.pano_url]); } catch (e) {} }
    panoramas = panoramas.filter(function (x) { return x.id !== p.id; });
    if ($('pano-view')) render();
    return { ok: true };
  }

  // ------------------------------------------------------------- 360 viewer --
  // Three.js sphere-of-revolution (a cylinder, per the file-header scope note)
  // with the panorama texture mapped INSIDE-OUT so the camera, placed at the
  // centre, sees the image wrapped around it. Drag rotates the view.
  function openViewer(id) {
    var p = panoById(id); if (!p) return;
    var u = urlOf(p.pano_url);
    if (!u) { UI.toast('This panorama image is not available', 'warn'); return; }
    var html =
      '<div class="pd-modal-header"><h3>' + esc(p.location || 'Panorama') + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pano-viewerwrap"><canvas id="pano-canvas"></canvas>' +
      '<p class="pano-viewerhint">Drag to look around</p></div>';
    // ⚠️ Audit fix: mountCylinderViewer()'s return value used to be
    // discarded entirely — its `dispose` handle (which releases the
    // WebGL context) was dropped, so every single-panorama view leaked a
    // real WebGL context. Browsers cap simultaneous contexts (commonly
    // 8-16), so opening enough panoramas without ever freeing one
    // eventually makes every FURTHER WebGL context creation on the page —
    // not just this viewer — silently fail. `onClose` (passed to
    // openModal, see its own comment above) now runs `viewer.dispose()`
    // on every dismissal path: ×, Cancel, and backdrop click alike.
    var viewer = null;
    var m = openModal(html, 900, function () { if (viewer) viewer.dispose(); });
    var canvas = m.el.querySelector('#pano-canvas');
    canvas.width = 820; canvas.height = 520;
    viewer = mountCylinderViewer(canvas, u);
  }

  // Shared by the single viewer and the compare (opacity-blend) viewer: builds
  // a Three.js scene with one cylinder, textured from `url`, camera at the
  // centre. Returns { renderer, scene, camera, mesh, dispose } so a caller can
  // swap the texture (compare mode) or tear it down when the modal closes.
  function mountCylinderViewer(canvas, url, opts) {
    opts = opts || {};
    if (typeof THREE === 'undefined') {
      var ctx2d = canvas.getContext('2d');
      ctx2d.fillStyle = '#2B2C2B'; ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      ctx2d.fillStyle = '#fff'; ctx2d.font = '14px sans-serif';
      ctx2d.fillText('3D viewer library did not load — check the connection and reload.', 16, canvas.height / 2);
      return null;
    }
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(canvas.width, canvas.height, false);
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(75, canvas.width / canvas.height, 0.1, 1000);
    camera.position.set(0, 0, 0.01);

    var loader = new THREE.TextureLoader();
    var geometry = new THREE.CylinderGeometry(50, 50, 40, 64, 1, true);
    geometry.scale(-1, 1, 1); // flip so the texture faces INWARD (we're inside the cylinder)
    var material = new THREE.MeshBasicMaterial({ color: 0x333333 });
    var mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    loader.load(url, function (tex) {
      tex.wrapS = THREE.RepeatWrapping;
      material.map = tex; material.color.set(0xffffff); material.needsUpdate = true;
      renderer.render(scene, camera);
    });

    var lon = 0, lat = 0, dragging = false, lastX = 0, lastY = 0;
    function applyLook() {
      var phi = THREE.MathUtils.degToRad(90 - lat);
      var theta = THREE.MathUtils.degToRad(lon);
      camera.lookAt(
        500 * Math.sin(phi) * Math.cos(theta),
        500 * Math.cos(phi),
        500 * Math.sin(phi) * Math.sin(theta)
      );
    }
    // Item 7: drag was rendering SYNCHRONOUSLY on every raw mousemove/
    // touchmove event, with no requestAnimationFrame coalescing at all. A
    // browser can dispatch several move events between two actual display
    // refreshes (especially on Windows / high-poll-rate mice/trackpads),
    // and each one used to trigger a full separate WebGL render pass on the
    // main thread — wasted, redundant renders that never get a chance to
    // reach the screen, and exactly the kind of unsynced, bursty work that
    // reads as stutter/jank rather than a smooth drag. `needsRender` now
    // just records that the view changed; the actual `renderer.render()`
    // call happens at most ONCE per animation frame, always with the
    // latest lon/lat, via `renderLoop`.
    var needsRender = false, rafId = null;
    function renderLoop() {
      rafId = null;
      if (needsRender) { needsRender = false; applyLook(); renderer.render(scene, camera); }
      // Keep ticking only while a drag is actually in progress — an idle
      // view costs nothing (no background render loop running forever),
      // and `wake()` restarts it the instant a new drag begins even if it
      // had already gone idle.
      if (dragging) rafId = requestAnimationFrame(renderLoop);
    }
    function wake() { if (rafId == null) rafId = requestAnimationFrame(renderLoop); }
    function onDown(x, y) { dragging = true; lastX = x; lastY = y; wake(); }
    function onMove(x, y) {
      if (!dragging) return;
      lon -= (x - lastX) * 0.2; lat = Math.max(-70, Math.min(70, lat + (y - lastY) * 0.2));
      lastX = x; lastY = y; needsRender = true;
    }
    function onUp() { dragging = false; }
    canvas.addEventListener('mousedown', function (e) { onDown(e.clientX, e.clientY); });
    canvas.addEventListener('mousemove', function (e) { onMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', function (e) { var t = e.touches[0]; onDown(t.clientX, t.clientY); });
    canvas.addEventListener('touchmove', function (e) { var t = e.touches[0]; onMove(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchend', onUp);
    applyLook();
    renderer.render(scene, camera);

    return {
      renderer: renderer, scene: scene, camera: camera, material: material,
      setOpacity: function (a) { material.opacity = a; material.transparent = a < 1; material.needsUpdate = true; renderer.render(scene, camera); },
      setTexture: function (u2) {
        loader.load(u2, function (tex) { material.map = tex; material.needsUpdate = true; renderer.render(scene, camera); });
      },
      // Item 7: `window.addEventListener('mouseup', onUp)` above was NEVER
      // matched by a removeEventListener — the SAME bug class this file's
      // own audit already fixed once in bim.js's wireStageInteractions
      // (see that entry above). Every single panorama view (and every
      // Compare-view rebuild(), which disposes and remounts on the SAME
      // canvas each time a dropdown changes) left a `window`-level listener
      // behind, and because JS closures keep their WHOLE enclosing scope
      // alive — not just the variables a function actually reads — that one
      // leaked listener kept the ENTIRE mountCylinderViewer() call reachable
      // forever: the WebGLRenderer, its GL context, the scene, the texture,
      // all of it. Opening/closing panoramas repeatedly in one session would
      // accumulate real GPU/memory pressure this way, which is exactly the
      // kind of thing that reads as "gets less smooth over time." The rAF
      // loop is also cancelled here so a viewer closed mid-drag can't leave
      // a dangling animation-frame request either.
      dispose: function () {
        window.removeEventListener('mouseup', onUp);
        if (rafId != null) { try { cancelAnimationFrame(rafId); } catch (e) {} rafId = null; }
        try { renderer.dispose(); } catch (e) {}
      }
    };
  }

  // --------------------------------------------------------------- compare --
  // Section 6.3: "overlay with opacity slider, or split-screen dual viewer, at
  // the same tagged location across two dates." Opacity slider chosen — a
  // single shared camera means the two panoramas are always looking the same
  // direction, which a dual independently-dragged viewer cannot guarantee.
  function openCompareModal() {
    var combos = allLocationCombos();
    var byLoc = {};
    panoramas.forEach(function (p) {
      var key = JSON.stringify(p.location_values || {});
      (byLoc[key] = byLoc[key] || []).push(p);
    });
    var multi = Object.keys(byLoc).filter(function (k) { return byLoc[k].length > 1; });
    if (!multi.length) {
      UI.toast('Need at least two panoramas at the same location to compare', 'warn'); return;
    }
    var options = multi.map(function (k) {
      var g = byLoc[k];
      return '<option value="' + esc(k) + '">' + esc(g[0].location || 'Unassigned') + ' (' + g.length + ' captures)</option>';
    }).join('');
    var html =
      '<div class="pd-modal-header"><h3>Compare panoramas over time</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><div class="pd-field"><label>Location</label>' +
      '<select class="pd-select" id="pano-cmp-loc">' + options + '</select></div>' +
      '<div id="pano-cmp-body"></div></div>';
    var m = openModal(html, 940);
    function paintFor(key) {
      var g = byLoc[key].slice().sort(function (a, b) { return String(a.taken_at || '').localeCompare(String(b.taken_at || '')); });
      var opts = g.map(function (p, i) { return '<option value="' + i + '">' + esc(Fmt.date(p.taken_at)) + '</option>'; }).join('');
      $('pano-cmp-body').innerHTML =
        '<div class="pano-cmp-controls">' +
          '<label>Earlier <select class="pd-select" id="pano-cmp-a">' + opts + '</select></label>' +
          '<label>Later <select class="pd-select" id="pano-cmp-b">' + opts.replace('value="0"', 'value="0" selected="false"') + '</select></label>' +
          '<label>Blend <input type="range" id="pano-cmp-slider" min="0" max="100" value="50" /></label>' +
        '</div>' +
        '<div class="pano-viewerwrap"><canvas id="pano-cmp-canvas"></canvas>' +
        '<p class="pano-viewerhint">Drag to look around · slide to blend earlier &harr; later</p></div>';
      var canvas = $('pano-cmp-canvas'); canvas.width = 860; canvas.height = 480;
      $('pano-cmp-b').value = String(g.length - 1);
      var viewerA = null, viewerB = null;
      function rebuild() {
        var a = g[+$('pano-cmp-a').value], b = g[+$('pano-cmp-b').value];
        if (viewerA) viewerA.dispose();
        // Two stacked transparent canvases would need real compositing; kept
        // simple and robust: one viewer, texture swapped by the slider at the
        // 50% crossover point rather than a true per-pixel cross-fade (a true
        // GL cross-fade needs a custom shader — flagged as a follow-up, not
        // built here, since a discrete swap still answers "did this change?").
        viewerA = mountCylinderViewer(canvas, urlOf(a.pano_url));
        var slider = $('pano-cmp-slider');
        slider.oninput = function () {
          var showB = +this.value >= 50;
          if (viewerA) viewerA.setTexture(urlOf(showB ? b.pano_url : a.pano_url));
        };
      }
      $('pano-cmp-a').onchange = rebuild; $('pano-cmp-b').onchange = rebuild;
      rebuild();
    }
    $('pano-cmp-loc').onchange = function () { paintFor(this.value); };
    paintFor(multi[0]);
  }

  // ------------------------------------------------------------ capture flow -
  function openCaptureModal() {
    var combos = allLocationCombos();
    var html =
      '<div class="pd-modal-header"><h3>Capture a 360&deg; panorama</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<div class="pd-field"><label>Location</label>' +
          '<select class="pd-select" id="pano-c-loc"><option value="">— none / untracked —</option>' +
          combos.map(function (c) { return '<option value="' + esc(c.key) + '">' + esc(c.label) + '</option>'; }).join('') +
          '</select></div>' +
        '<div class="pd-field"><label>Capture date</label>' +
          '<input class="pd-input" type="date" id="pano-c-date" value="' + new Date().toISOString().slice(0, 10) + '" /></div>' +
        '<div class="pd-field"><label>Source</label>' +
          '<select class="pd-select" id="pano-c-source">' +
            '<option value="ground">Ground (staff phone)</option>' +
            '<option value="drone">Drone (aerial)</option>' +
          '</select></div>' +
        '<div class="pano-capturearea">' +
          '<p class="pp-hint">Tap "Start recording" and slowly spin around (optionally tilt up/down ' +
          'once), OR upload a walkthrough video recorded earlier.</p>' +
          '<div class="pano-camwrap">' +
            '<video id="pano-cam-preview" autoplay muted playsinline hidden></video>' +
            '<div class="pano-recind" id="pano-recind" hidden><span class="pano-recdot"></span><span id="pano-rectime">0:00</span></div>' +
          '</div>' +
          '<div class="pano-capturebtns">' +
            '<button class="pd-btn pd-btn-primary" id="pano-c-record" type="button">Start recording</button>' +
            '<button class="pd-btn" id="pano-c-switchcam" type="button" hidden>Switch camera</button>' +
            '<label class="pd-btn" for="pano-c-file">Upload video<input type="file" id="pano-c-file" accept="video/*" hidden /></label>' +
          '</div>' +
          '<p id="pano-c-status" class="pp-hint"></p>' +
        '</div>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button></div>';
    var m = openModal(html, 560);
    var combosByKey = {}; combos.forEach(function (c) { combosByKey[c.key] = c; });
    var stream = null, recorder = null, chunks = [];
    var facing = 'environment';
    // Item 18 — "I can't take videos very easily": recording had no visible
    // "you are recording" cue at all (only a button LABEL changed), and
    // required TWO deliberate taps (Use camera, then Start recording) before
    // anything happened. Both are fixed below: one button now does both
    // (getUserMedia's permission prompt IS a valid user gesture on its own,
    // so requesting it from "Start recording"'s own click handler works),
    // and a pulsing dot + running timer make "recording is active" visible
    // without reading the button text.
    var recTimer = null, recSeconds = 0;
    var MAX_REC_SECONDS = 90;   // a generous cap for a slow spin — auto-stops
                                // a recording nobody remembered to stop, per
                                // friction point "no duration guidance at all"
    // ⚠️ Audit fix: no mutual exclusion existed between recording and
    // uploading a file — both controls are visible in the same modal at
    // once, so a user could start a recording, then ALSO pick an uploaded
    // file (or vice versa) while the first was still mid-pipeline. Two
    // concurrent processVideo() runs would fight over the SAME status text
    // element and could create two separate panorama rows from one
    // session. Set for the whole span of processVideo() (not just the
    // upload path), so it also blocks starting a NEW recording while an
    // earlier upload is still extracting/stitching/uploading.
    var processing = false;

    function fmtTime(s) {
      var mm = Math.floor(s / 60), ss = s % 60;
      return mm + ':' + (ss < 10 ? '0' : '') + ss;
    }
    function stopCameraStream() {
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    }
    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
        var v = $('pano-cam-preview'); if (v) { v.hidden = false; v.srcObject = stream; }
        var sw = $('pano-c-switchcam'); if (sw) sw.hidden = false;
        return true;
      } catch (e) {
        // Named as its own friction point: a bare error with no next step
        // left the planner stuck. Every camera failure now names the escape
        // hatch that is guaranteed to work.
        UI.toast('Could not access the camera: ' + (e.message || e) + ' — you can upload a video instead.', 'error');
        return false;
      }
    }
    function startRecTimer() {
      recSeconds = 0;
      var t = $('pano-rectime'); if (t) t.textContent = fmtTime(0);
      var ind = $('pano-recind'); if (ind) ind.hidden = false;
      recTimer = setInterval(function () {
        recSeconds++;
        var t2 = $('pano-rectime'); if (t2) t2.textContent = fmtTime(recSeconds);
        if (recSeconds >= MAX_REC_SECONDS) {
          UI.toast('Recording stopped automatically after ' + fmtTime(MAX_REC_SECONDS), 'warn');
          $('pano-c-record').click();
        }
      }, 1000);
    }
    function stopRecTimer() {
      if (recTimer) { clearInterval(recTimer); recTimer = null; }
      var ind = $('pano-recind'); if (ind) ind.hidden = true;
    }
    $('pano-c-switchcam').onclick = async function () {
      if (recorder) return;   // never swap cameras mid-recording
      // ⚠️ Audit fix: no re-entrancy guard at all — a rapid double-tap
      // (or an impatient click while getUserMedia's permission prompt is
      // still pending) could start a SECOND stopCameraStream()/startCamera()
      // pair before the first `await startCamera()` had assigned its own
      // `stream`. Whichever call's assignment lands last wins, silently
      // dropping the OTHER call's already-live MediaStream with no
      // reference left to stop its tracks — an orphaned camera that stays
      // on (and keeps the hardware light lit) even after this modal closes,
      // since the close handler's stopCameraStream() only ever sees
      // whichever stream `stream` currently points to.
      if (this.disabled) return;
      this.disabled = true;
      facing = facing === 'environment' ? 'user' : 'environment';
      stopCameraStream();
      await startCamera();
      this.disabled = false;
    };
    $('pano-c-record').onclick = async function () {
      var btn = this;
      if (!recorder) {
        if (processing) { UI.toast('An earlier capture is still processing — wait for it to finish first', 'warn'); return; }
        if (!stream) {
          btn.disabled = true; btn.textContent = 'Starting camera…';
          var ok = await startCamera();
          btn.disabled = false;
          if (!ok) { btn.textContent = 'Start recording'; return; }
        }
        chunks = [];
        // ⚠️ Audit fix (H1): construction/wiring/start() had NO try/catch —
        // a codec or MediaRecorder-support failure here (thrown by the
        // constructor or by .start()) rejected this async onclick handler
        // with nobody awaiting it, so it surfaced only as a silent unhandled
        // rejection in the console. The camera preview was already live (it
        // succeeded above), so the button was left stuck reading "Starting
        // camera…" forever with no error shown and no way to tell recording
        // never actually armed.
        try {
          var mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : '';
          recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
          recorder.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
          recorder.onstop = function () {
            var blob = new Blob(chunks, { type: 'video/webm' });
            stopCameraStream();
            processVideo(blob);
          };
          recorder.start();
        } catch (e) {
          recorder = null;
          btn.textContent = 'Start recording';
          UI.toast('Could not start recording: ' + (e.message || e) + ' — you can upload a video instead.', 'error');
          return;
        }
        btn.textContent = 'Stop recording'; btn.classList.add('is-active');
        startRecTimer();
      } else {
        recorder.stop(); recorder = null;
        btn.textContent = 'Start recording'; btn.classList.remove('is-active');
        stopRecTimer();
      }
    };
    $('pano-c-file').onchange = function () {
      if (recorder) { UI.toast('Stop the current recording first', 'warn'); this.value = ''; return; }
      if (processing) { UI.toast('An earlier capture is still processing — wait for it to finish first', 'warn'); this.value = ''; return; }
      var f = this.files && this.files[0]; if (f) processVideo(f);
    };
    // Cancel/× must stop a live camera stream + recorder + timer, or the
    // camera silently keeps running after the planner walks away from a
    // capture they abandoned — openModal binds these to the ORIGINAL m.close
    // before any of the above existed, so they're re-wired here. `cancelled`
    // guards processVideo: forcing recorder.stop() here still fires its
    // async onstop -> processVideo(blob) AFTER the modal (and its #pano-c-*
    // elements) are already gone, which would otherwise throw reaching for
    // a null `status` element mid-write.
    var cancelled = false;
    var closeOrig = m.close;
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-close]'), function (b) {
      b.onclick = function () {
        cancelled = true;
        if (recorder) { try { recorder.stop(); } catch (e) {} recorder = null; }
        stopRecTimer(); stopCameraStream();
        closeOrig();
      };
    });

    async function processVideo(blob) {
      if (cancelled) return;
      processing = true;
      var status = $('pano-c-status');
      // ⚠️ Audit fix (H2): all THREE form reads are hoisted here, before any
      // async work begins — `source` used to be read at the very end, after
      // frame extraction/OpenCV/stitching/upload had all already run. Those
      // stages can take many seconds, and Cancel/× REMOVES the modal's DOM
      // (openModal -> UI.modal -> overlay.remove()) without aborting this
      // in-flight pipeline (`cancelled` was only ever checked once, right
      // here, at function entry) — so a late $('pano-c-source') resolved to
      // null and threw, AFTER the stitched JPEG had already been uploaded to
      // Storage, leaving it permanently orphaned (the crash happened before
      // the DB row that would reference it was ever inserted) and showing
      // the user a confusing "Could not build the panorama" error for
      // something they had already successfully cancelled.
      var combo = combosByKey[$('pano-c-loc').value] || null;
      var date = $('pano-c-date').value || new Date().toISOString().slice(0, 10);
      var source = $('pano-c-source').value;
      var uploadedPath = null;
      try {
        status.textContent = 'Extracting frames…';
        var frames = await extractFrames(blob, FRAME_COUNT, function (i, n) { status.textContent = 'Extracting frame ' + (i + 1) + ' of ' + n + '…'; });
        if (cancelled) return;
        if (frames.length < 3) throw new Error('Not enough distinct frames in this video to stitch.');
        status.textContent = 'Loading the vision library (first time only)…';
        await ensureOpenCV();
        if (cancelled) return;
        status.textContent = 'Stitching…';
        var result = await stitchFrames(frames, function (i, n) { status.textContent = 'Stitching frame ' + (i + 1) + ' of ' + n + '…'; });
        if (cancelled) return;
        status.textContent = 'Uploading…';
        var jpegBlob = await new Promise(function (res) { result.canvas.toBlob(res, 'image/jpeg', 0.9); });
        if (cancelled) return;
        var path = pid + '/panoramas/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.jpg';
        var up = await sb().storage.from(BUCKET).upload(path, jpegBlob, { contentType: 'image/jpeg' });
        if (up.error) throw up.error;
        uploadedPath = path;
        if (cancelled) {
          // The upload can't be un-awaited, but the row it would belong to
          // can still be skipped — clean up the now-orphaned object rather
          // than leaving it in Storage forever with nothing pointing at it.
          try { await sb().storage.from(BUCKET).remove([uploadedPath]); } catch (e2) {}
          return;
        }
        var row = {
          project_id: pid, created_by: uid,
          location_values: combo ? combo.values : {}, location: combo ? combo.label : null,
          pano_url: path, frame_count: frames.length,
          stitch_quality: result.quality, taken_at: date,
          source: source
        };
        var ires = await sb().from(T_PANO).insert(row);
        if (ires.error && /column .*source.* does not exist|schema cache/i.test(ires.error.message || '')) {
          // Phase 6's `source` column may not be migrated yet — retry without
          // it rather than losing the whole capture over one optional field.
          delete row.source;
          ires = await sb().from(T_PANO).insert(row);
        }
        if (ires.error) throw ires.error;
        m.close();
        UI.toast('Panorama saved' + (result.quality === 'poor' ? ' — some frames matched poorly; consider re-capturing' : ''),
          result.quality === 'poor' ? 'warn' : 'ok');
        await load();
      } catch (e) {
        // A cancellation is not a failure — nothing to report, and reporting
        // it as one is exactly the confusing "error" the user never caused.
        if (cancelled) { if (uploadedPath) { try { await sb().storage.from(BUCKET).remove([uploadedPath]); } catch (e2) {} } return; }
        status.textContent = '';
        // Item 5: `e.message || e` is not safe here — a raw OpenCV.js/
        // Emscripten exception is often a bare WASM exception POINTER
        // (a number), not a JS Error, and reading/formatting it is a
        // documented trigger for OpenCV.js's own exception-to-string glue to
        // re-enter the (already-unwinding) WASM module, which is exactly how
        // "Maximum call stack size exceeded" can surface from a catch block
        // that never expected to throw a SECOND time. safeErrMessage() never
        // lets that escape uncaught.
        UI.toast('Could not build the panorama: ' + safeErrMessage(e), 'error');
      } finally {
        // Runs on every exit path — success, error, or an early `return`
        // inside the try (cancellation) — so the record/upload mutual
        // exclusion above can never get permanently stuck refusing every
        // future attempt because one path forgot to clear it.
        processing = false;
      }
    }
  }

  // Draws `count` evenly-spaced frames from a video Blob onto canvases.
  function extractFrames(blob, count, onProgress) {
    return new Promise(function (resolve, reject) {
      var video = document.createElement('video');
      video.muted = true; video.playsInline = true;
      video.src = URL.createObjectURL(blob);
      video.onloadedmetadata = async function () {
        var duration = video.duration;
        if (!isFinite(duration) || duration <= 0) {
          // Item 5: this IS the "could not read video duration" failure the
          // owner reported. A MediaRecorder-produced blob's container commonly
          // has NO duration atom at all — the recorder is writing the header
          // before it knows the final length — so <video>.duration reads
          // Infinity (or NaN) on first load. This is a well-documented browser
          // quirk with a well-documented fix: forcing a seek past the end (and
          // back) makes the browser recompute the real duration from the
          // actual media data rather than the missing header. A REAL recorded
          // capture hits this routinely; an uploaded pre-recorded file usually
          // doesn't, since its container already carries a real duration atom
          // — which is why this bug was easy to miss testing with uploads alone.
          duration = await fixInfiniteDuration(video);
        }
        if (!isFinite(duration) || duration <= 0) { reject(new Error('Could not read the video duration.')); return; }
        var frames = [];
        // Item 5: guard both dimensions EXPLICITLY rather than a `||`
        // fallback chain — the old `Math.round(w * (video.videoHeight /
        // video.videoWidth || 0.5625))` produced `Infinity` (not the intended
        // 0.5625 fallback) whenever videoWidth was 0 but videoHeight was not,
        // since `Infinity || 0.5625` is `Infinity` (Infinity is truthy).
        // Assigning an Infinite canvas height throws — and feeding OpenCV a
        // zero/garbage-dimension frame later in stitchFrames is a separate,
        // well-documented cause of the "Maximum call stack size exceeded"
        // failure (a malformed Mat fed into ORB/BFMatcher can throw a raw
        // WASM exception whose own message-formatting can itself recurse).
        // Both dimensions are guarded here so a frame canvas can never be
        // constructed with a 0/NaN/Infinite width or height in the first place.
        var vw = video.videoWidth || 0, vh = video.videoHeight || 0;
        var w = vw ? Math.min(vw, 640) : 640;
        var h = (vw && vh) ? Math.round(w * (vh / vw)) : Math.round(w * 0.5625);
        for (var i = 0; i < count; i++) {
          var t = (duration * (i + 0.5)) / count;
          await seekTo(video, t);
          var c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(video, 0, 0, w, h);
          frames.push(c);
          if (onProgress) onProgress(i, count);
        }
        URL.revokeObjectURL(video.src);
        resolve(frames);
      };
      video.onerror = function () { reject(new Error('Could not read this video file.')); };
    });
  }
  // Item 5: the standard fix for a MediaRecorder blob's Infinity/NaN
  // duration — seek far past the (unknown) end, wait for the browser to
  // settle on the real duration, then seek back to the start. Resolves with
  // whatever `video.duration` ends up being (which the caller re-checks for
  // finiteness) rather than rejecting itself, so a browser that genuinely
  // can't recover a duration still reports the SAME clear "Could not read
  // the video duration." message instead of a different one from in here.
  function fixInfiniteDuration(video) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        video.removeEventListener('timeupdate', onTimeUpdate);
        clearTimeout(timer);
        resolve(video.duration);
      }
      function onTimeUpdate() { video.currentTime = 0; finish(); }
      // Not every browser fires 'timeupdate' for this trick, or some do so
      // before duration has actually settled — never hang the whole capture
      // waiting on it (same timeout-and-resolve-anyway discipline seekTo()
      // already uses, for the same reason: a slightly-off duration reading
      // is a better outcome than a permanently stuck pipeline).
      var timer = setTimeout(finish, 2000);
      video.addEventListener('timeupdate', onTimeUpdate);
      try { video.currentTime = 1e101; } catch (e) { finish(); }
    });
  }
  // ⚠️ Audit fix: no timeout at all — a malformed video, or the known
  // browser quirk where 'seeked' can fail to fire when currentTime is set
  // to a value the video is already effectively at, left this Promise
  // permanently unresolved. extractFrames() awaits this sequentially for
  // every one of FRAME_COUNT frames, so one stuck seek hung the ENTIRE
  // capture pipeline forever with no error and no way out short of closing
  // the tab. Timing out and resolving anyway (not rejecting) is deliberate:
  // whatever frame the video is currently showing is still a usable,
  // approximately-correct frame — failing the whole capture over one
  // imperfect seek would be a worse outcome than a slightly-off frame.
  function seekTo(video, t) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', onSeeked);
        clearTimeout(timer);
        resolve();
      }
      function onSeeked() { finish(); }
      var timer = setTimeout(finish, 3000);
      video.addEventListener('seeked', onSeeked);
      video.currentTime = t;
    });
  }

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

  // Sequential planar mosaic (see file-header scope note). Returns
  // { canvas, quality } — quality = 'poor' if any consecutive pair matched
  // fewer than MIN_GOOD_MATCHES keypoints (flagged per brief 6.2, not hidden).
  async function stitchFrames(frameCanvases, onProgress) {
    var base = document.createElement('canvas');
    var padX = frameCanvases[0].width * (frameCanvases.length - 1);
    base.width = frameCanvases[0].width * frameCanvases.length;
    base.height = frameCanvases[0].height;
    var bctx = base.getContext('2d');
    // Start the mosaic with the middle frame at the canvas centre, so growth
    // to either side (left/right pans during the spin) both fit on-canvas
    // without needing a dynamic resize mid-stitch.
    var originX = Math.round(base.width / 2 - frameCanvases[0].width / 2);
    bctx.drawImage(frameCanvases[0], originX, 0);

    var quality = 'ok';
    var accumTransform = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // running 3x3, frame0 -> base
    accumTransform[2] = originX;

    for (var i = 1; i < frameCanvases.length; i++) {
      if (onProgress) onProgress(i, frameCanvases.length);
      // Item 5: never hand OpenCV a zero-dimension canvas. extractFrames'
      // own width/height guards (above) mean this should not happen any
      // more, but a malformed Mat is a documented cause of the reported
      // "Maximum call stack size exceeded" — cv.imread on a 0×0 canvas
      // produces a Mat that ORB/BFMatcher can crash on deep in the WASM
      // module rather than raising a clean, catchable JS error. Skipping the
      // pair (same "poor quality, keep going" path a genuinely low-match
      // pair already takes) is a far better failure mode than feeding it in
      // and finding out.
      if (!frameCanvases[i - 1].width || !frameCanvases[i - 1].height ||
          !frameCanvases[i].width || !frameCanvases[i].height) {
        quality = 'poor'; continue;
      }
      var prevMat = cv.imread(frameCanvases[i - 1]);
      var curMat = cv.imread(frameCanvases[i]);
      var H = null, matches = 0;
      // Item 5: a THROW from homographyBetween (a genuine OpenCV/WASM-level
      // failure on this one pair, not merely "too few matches" — which is
      // already handled below without throwing) used to abort the WHOLE
      // capture, surfacing as the generic "Could not build the panorama"
      // error even though 9 of 10 frame pairs might have stitched fine.
      // One bad pair is now treated exactly like a low-match pair: this
      // pair contributes nothing (quality drops to 'poor', so the failure is
      // still visible, never silently hidden), and the loop carries on.
      try {
        try {
          var r = homographyBetween(prevMat, curMat);
          H = r.H; matches = r.matches;
        } finally { prevMat.delete(); curMat.delete(); }
      } catch (pairErr) {
        quality = 'poor'; continue;
      }
      if (matches < MIN_GOOD_MATCHES || !H) { quality = 'poor'; if (H) H.delete(); continue; }

      // Compose: newBaseTransform = accumTransform * H (H maps frame[i] -> frame[i-1]'s space)
      accumTransform = mul3(accumTransform, H.data64F ? Array.from(H.data64F) : matToArray(H));
      H.delete();

      // ⚠️ Audit fix: srcMat/dstMat/Hmat were only ever .delete()'d on the
      // happy path — a throw from warpPerspective/imshow (same class as
      // bim.js's own cv.Mat fixes above) leaked all three per failed frame.
      var srcMat, dstMat, Hmat;
      try {
        srcMat = cv.imread(frameCanvases[i]);
        dstMat = new cv.Mat();
        Hmat = cv.matFromArray(3, 3, cv.CV_64F, accumTransform);
        var dsize = new cv.Size(base.width, base.height);
        cv.warpPerspective(srcMat, dstMat, Hmat, dsize, cv.INTER_LINEAR, cv.BORDER_TRANSPARENT);
        var tmp = document.createElement('canvas'); tmp.width = base.width; tmp.height = base.height;
        cv.imshow(tmp, dstMat);
        bctx.drawImage(tmp, 0, 0);
      } finally {
        if (srcMat) srcMat.delete();
        if (dstMat) dstMat.delete();
        if (Hmat) Hmat.delete();
      }
      await new Promise(function (res) { setTimeout(res, 0); }); // yield so the UI can update the status line
    }
    return { canvas: base, quality: quality };
  }

  // ORB keypoints + BFMatcher(Hamming) + ratio test + RANSAC homography.
  // Returns { H: cv.Mat|null, matches: number } — H maps points in `curMat`
  // into `prevMat`'s coordinate frame.
  // ⚠️ Audit fix: this function had NO try/finally at all, and its two
  // detectAndCompute() mask arguments were anonymous `new cv.Mat()`
  // literals with no variable to ever call .delete() on — a GUARANTEED
  // leak of 2 WASM Mats on every single call, success or failure alike
  // (9 calls per 10-frame capture = 18 leaked Mats per capture, before
  // even considering an error path). Every other Mat here was cleaned up
  // only at the very end, unconditionally reached — so any throw from an
  // intermediate cv call (a corrupt/blank frame is a real possibility)
  // skipped that cleanup entirely and leaked whichever of orb/kp1/kp2/
  // des1/des2/g1/g2/bf/knn/srcMat/dstMat/mask had already been created.
  function homographyBetween(prevMat, curMat) {
    var orb, kp1, kp2, des1, des2, g1, g2, mask1, mask2;
    var bf, knn, srcMat, dstMat, mask;
    var result = { H: null, matches: 0 };
    try {
      orb = new cv.ORB(800);
      kp1 = new cv.KeyPointVector(); kp2 = new cv.KeyPointVector();
      des1 = new cv.Mat(); des2 = new cv.Mat();
      g1 = new cv.Mat(); g2 = new cv.Mat();
      mask1 = new cv.Mat(); mask2 = new cv.Mat();
      cv.cvtColor(prevMat, g1, cv.COLOR_RGBA2GRAY);
      cv.cvtColor(curMat, g2, cv.COLOR_RGBA2GRAY);
      orb.detectAndCompute(g1, mask1, kp1, des1);
      orb.detectAndCompute(g2, mask2, kp2, des2);

      if (des1.rows > 0 && des2.rows > 0) {
        bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
        knn = new cv.DMatchVectorVector();
        bf.knnMatch(des2, des1, knn, 2); // match cur -> prev
        var good = [];
        for (var i = 0; i < knn.size(); i++) {
          var m = knn.get(i);
          if (m.size() >= 2 && m.get(0).distance < 0.75 * m.get(1).distance) good.push(m.get(0));
        }
        if (good.length >= 4) {
          var srcPts = [], dstPts = [];
          good.forEach(function (mm) {
            srcPts.push(kp2.get(mm.queryIdx).pt.x, kp2.get(mm.queryIdx).pt.y);
            dstPts.push(kp1.get(mm.trainIdx).pt.x, kp1.get(mm.trainIdx).pt.y);
          });
          srcMat = cv.matFromArray(good.length, 1, cv.CV_32FC2, srcPts);
          dstMat = cv.matFromArray(good.length, 1, cv.CV_32FC2, dstPts);
          mask = new cv.Mat();
          var H = cv.findHomography(srcMat, dstMat, cv.RANSAC, 5, mask);
          if (!H.empty()) result = { H: H, matches: good.length }; else H.delete();
        }
      }
      return result;
    } finally {
      // result.H (when set) is now owned by the CALLER (stitchFrames deletes
      // it once composed, or the caller discards it) — every other Mat/
      // vector created above is local to this call and is cleaned up here,
      // unconditionally, regardless of which branch was reached or whether
      // something threw partway through.
      [orb, kp1, kp2, des1, des2, g1, g2, mask1, mask2, bf, knn, srcMat, dstMat, mask].forEach(function (x) {
        if (x) x.delete();
      });
    }
  }

  // Item 5: turns ANY caught value into a display-safe string, defensively —
  // never lets reading/formatting the exception itself be what throws.
  // `e.message` is read only when it's genuinely a string (a real Error);
  // a raw non-Error value (a WASM exception pointer, a plain object with a
  // weird toString) goes through `String()` inside its own try, so a
  // pathological value can degrade to a generic message instead of crashing
  // the error handler that exists to report it.
  function safeErrMessage(e) {
    try {
      if (e && typeof e === 'object' && typeof e.message === 'string' && e.message) return e.message;
      return String(e);
    } catch (e2) {
      return 'an unexpected error';
    }
  }
  function matToArray(m) { var out = []; for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) out.push(m.doubleAt(r, c)); return out; }
  function mul3(a, b) {
    var out = new Array(9).fill(0);
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) for (var k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
    return out;
  }

  return {
    init: init,
    _syncTools: syncTools,
    // Exposed for the client-side calibration/measurement work (Phase 5),
    // which needs to read a project's saved panoramas without a second fetch.
    list: function () { return panoramas.slice(); },
    // Opens a specific panorama's viewer by id — used by the Floor Plan pin
    // navigator (bim.js), which may open this before the 360° screen itself
    // has ever loaded (so `panoramas` here could be empty; openViewer already
    // does its own byId lookup via panoById, which reads this closure's own
    // `panoramas` array — if that's empty because this screen was never
    // visited, load() is called first so the lookup has something to find).
    open: async function (id) {
      if (!panoramas.length) await load();
      openViewer(id);
    },
    // Batch C (2026-08-29): 360°/3D fold into the unified Gallery feed, which
    // needs this module's data loaded and its signed thumbnail URLs — both
    // exposed here rather than duplicating the fetch+sign logic in module.js.
    ensureLoaded: async function () { if (!panoramas.length) await load(); },
    urlOf: function (p) { return p ? urlOf(p.pano_url) : ''; },
    // 2026-08-29 item 17 — the Add Media type selector's "360°" button
    // delegates to the real capture flow rather than reimplementing it; this
    // is that flow's only remaining entry point now that its own topbar
    // button (#pano-new) is gone (folded into the Gallery screen, item 2).
    openCapture: function () { openCaptureModal(); },
    // Bug fix (2026-09-04) — see deletePano's own comment. Takes the real
    // panorama row object (not an id). Returns { ok:true } or
    // { ok:false, error }; never throws.
    deleteById: function (p) { return deletePano(p); },
    // Test-only hook — deletePano is otherwise unreachable outside the
    // merged-Gallery editor's click handler.
    _deletePano: function (p) { return deletePano(p); },
    // Item 5 — exported so the test harness can genuinely EXECUTE these
    // rather than only read them, same reasoning as every other pure-math
    // hook this app exports: a wrong string/number here is silent (nothing
    // visibly "looks broken" about a slightly-off error message), so it's
    // worth proving rather than trusting on inspection alone.
    _safeErrMessage: function (e) { return safeErrMessage(e); },
    _fixInfiniteDuration: function (video) { return fixInfiniteDuration(video); }
  };
})();
