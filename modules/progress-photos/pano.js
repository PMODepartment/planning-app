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

  function openModal(html, width) {
    var m = UI.modal(html);
    var box = m.el.querySelector('.pd-modal');
    if (box && width) box.style.maxWidth = width + 'px';
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-close]'), function (b) { b.onclick = m.close; });
    if (window.Icons && Icons.hydrate) Icons.hydrate(m.el);
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
    if (p.pano_url) await sb().storage.from(BUCKET).remove([p.pano_url]);
    var res = await sb().from(T_PANO).delete().eq('id', p.id);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    UI.toast('Panorama deleted', 'ok');
    await load();
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
    var m = openModal(html, 900);
    var canvas = m.el.querySelector('#pano-canvas');
    canvas.width = 820; canvas.height = 520;
    mountCylinderViewer(canvas, u);
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
    function onDown(x, y) { dragging = true; lastX = x; lastY = y; }
    function onMove(x, y) {
      if (!dragging) return;
      lon -= (x - lastX) * 0.2; lat = Math.max(-70, Math.min(70, lat + (y - lastY) * 0.2));
      lastX = x; lastY = y; applyLook(); renderer.render(scene, camera);
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
      dispose: function () { try { renderer.dispose(); } catch (e) {} }
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
          '<p class="pp-hint">Stand at the location and slowly spin around while recording (optionally ' +
          'tilt up/down once), OR upload a walkthrough video recorded earlier.</p>' +
          '<div class="pano-camwrap"><video id="pano-cam-preview" autoplay muted playsinline hidden></video></div>' +
          '<div class="pano-capturebtns">' +
            '<button class="pd-btn" id="pano-c-startcam" type="button">Use camera</button>' +
            '<button class="pd-btn" id="pano-c-record" type="button" hidden>Start recording</button>' +
            '<label class="pd-btn" for="pano-c-file">Upload video<input type="file" id="pano-c-file" accept="video/*" hidden /></label>' +
          '</div>' +
          '<p id="pano-c-status" class="pp-hint"></p>' +
        '</div>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button></div>';
    var m = openModal(html, 560);
    var combosByKey = {}; combos.forEach(function (c) { combosByKey[c.key] = c; });
    var stream = null, recorder = null, chunks = [];

    $('pano-c-startcam').onclick = async function () {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        var v = $('pano-cam-preview'); v.hidden = false; v.srcObject = stream;
        $('pano-c-startcam').hidden = true; $('pano-c-record').hidden = false;
      } catch (e) { UI.toast('Could not access the camera: ' + (e.message || e), 'error'); }
    };
    $('pano-c-record').onclick = function () {
      if (!recorder) {
        chunks = [];
        var mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : '';
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        recorder.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
        recorder.onstop = function () {
          var blob = new Blob(chunks, { type: 'video/webm' });
          stream.getTracks().forEach(function (t) { t.stop(); });
          processVideo(blob);
        };
        recorder.start();
        $('pano-c-record').textContent = 'Stop recording';
      } else {
        recorder.stop(); recorder = null;
        $('pano-c-record').textContent = 'Start recording';
      }
    };
    $('pano-c-file').onchange = function () {
      var f = this.files && this.files[0]; if (f) processVideo(f);
    };

    async function processVideo(blob) {
      var status = $('pano-c-status');
      var combo = combosByKey[$('pano-c-loc').value] || null;
      var date = $('pano-c-date').value || new Date().toISOString().slice(0, 10);
      try {
        status.textContent = 'Extracting frames…';
        var frames = await extractFrames(blob, FRAME_COUNT, function (i, n) { status.textContent = 'Extracting frame ' + (i + 1) + ' of ' + n + '…'; });
        if (frames.length < 3) throw new Error('Not enough distinct frames in this video to stitch.');
        status.textContent = 'Loading the vision library (first time only)…';
        await ensureOpenCV();
        status.textContent = 'Stitching…';
        var result = await stitchFrames(frames, function (i, n) { status.textContent = 'Stitching frame ' + (i + 1) + ' of ' + n + '…'; });
        status.textContent = 'Uploading…';
        var jpegBlob = await new Promise(function (res) { result.canvas.toBlob(res, 'image/jpeg', 0.9); });
        var path = pid + '/panoramas/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.jpg';
        var up = await sb().storage.from(BUCKET).upload(path, jpegBlob, { contentType: 'image/jpeg' });
        if (up.error) throw up.error;
        var row = {
          project_id: pid, created_by: uid,
          location_values: combo ? combo.values : {}, location: combo ? combo.label : null,
          pano_url: path, frame_count: frames.length,
          stitch_quality: result.quality, taken_at: date,
          source: $('pano-c-source').value
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
        status.textContent = '';
        UI.toast('Could not build the panorama: ' + (e.message || e), 'error');
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
        if (!isFinite(duration) || duration <= 0) { reject(new Error('Could not read the video duration.')); return; }
        var frames = [];
        var w = Math.min(video.videoWidth, 640) || 640;
        var h = Math.round(w * (video.videoHeight / video.videoWidth || 0.5625));
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
  function seekTo(video, t) {
    return new Promise(function (resolve) {
      function onSeeked() { video.removeEventListener('seeked', onSeeked); resolve(); }
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
      var prevMat = cv.imread(frameCanvases[i - 1]);
      var curMat = cv.imread(frameCanvases[i]);
      var H = null, matches = 0;
      try {
        var r = homographyBetween(prevMat, curMat);
        H = r.H; matches = r.matches;
      } finally { prevMat.delete(); curMat.delete(); }
      if (matches < MIN_GOOD_MATCHES || !H) { quality = 'poor'; if (H) H.delete(); continue; }

      // Compose: newBaseTransform = accumTransform * H (H maps frame[i] -> frame[i-1]'s space)
      accumTransform = mul3(accumTransform, H.data64F ? Array.from(H.data64F) : matToArray(H));
      H.delete();

      var srcMat = cv.imread(frameCanvases[i]);
      var dstMat = new cv.Mat();
      var Hmat = cv.matFromArray(3, 3, cv.CV_64F, accumTransform);
      var dsize = new cv.Size(base.width, base.height);
      cv.warpPerspective(srcMat, dstMat, Hmat, dsize, cv.INTER_LINEAR, cv.BORDER_TRANSPARENT);
      var tmp = document.createElement('canvas'); tmp.width = base.width; tmp.height = base.height;
      cv.imshow(tmp, dstMat);
      bctx.drawImage(tmp, 0, 0);
      srcMat.delete(); dstMat.delete(); Hmat.delete();
      await new Promise(function (res) { setTimeout(res, 0); }); // yield so the UI can update the status line
    }
    return { canvas: base, quality: quality };
  }

  // ORB keypoints + BFMatcher(Hamming) + ratio test + RANSAC homography.
  // Returns { H: cv.Mat|null, matches: number } — H maps points in `curMat`
  // into `prevMat`'s coordinate frame.
  function homographyBetween(prevMat, curMat) {
    var orb = new cv.ORB(800);
    var kp1 = new cv.KeyPointVector(), kp2 = new cv.KeyPointVector();
    var des1 = new cv.Mat(), des2 = new cv.Mat();
    var g1 = new cv.Mat(), g2 = new cv.Mat();
    cv.cvtColor(prevMat, g1, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(curMat, g2, cv.COLOR_RGBA2GRAY);
    orb.detectAndCompute(g1, new cv.Mat(), kp1, des1);
    orb.detectAndCompute(g2, new cv.Mat(), kp2, des2);

    var result = { H: null, matches: 0 };
    if (des1.rows > 0 && des2.rows > 0) {
      var bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
      var knn = new cv.DMatchVectorVector();
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
        var srcMat = cv.matFromArray(good.length, 1, cv.CV_32FC2, srcPts);
        var dstMat = cv.matFromArray(good.length, 1, cv.CV_32FC2, dstPts);
        var mask = new cv.Mat();
        var H = cv.findHomography(srcMat, dstMat, cv.RANSAC, 5, mask);
        if (!H.empty()) result = { H: H, matches: good.length }; else H.delete();
        srcMat.delete(); dstMat.delete(); mask.delete();
      }
      bf.delete(); knn.delete();
    }
    orb.delete(); kp1.delete(); kp2.delete(); des1.delete(); des2.delete(); g1.delete(); g2.delete();
    return result;
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
    openCapture: function () { openCaptureModal(); }
  };
})();
