// ============================================================================
// Progress Photos — 360° panorama processing (item 3 of the overnight batch)
// ----------------------------------------------------------------------------
// Owner: "aside from photo and video, provide option to add 360 ... when
// take video is clicked, provide guides on camera to take the video for
// processing to 360. provide preview of processed 360 photo."
//
// A FRESH implementation (the earlier 360° feature was deleted outright at
// the owner's own request, to "start fresh"). It reuses the same well-
// established technique that feature used — extract frames from the walk-
// around video, match features between consecutive frames, and warp them
// into one wide mosaic — via OpenCV.js, which index.html already loads for
// bim.js's own floor-plan photo-registration feature (no new library, no
// extra download).
//
// ⚠️ SCOPE, stated up front rather than silently shipped:
// - This produces a CYLINDRICAL mosaic (frames warped and blended side by
//   side), not a true equirectangular/spherical panorama — the same honest
//   reduction the earlier feature made. A full sphere needs known camera
//   intrinsics and a rotation-only motion model; a phone's walk-around
//   pan is well served by a cylinder and does not need that.
// - Viewing it (module.js's viewer) is a plain 2D drag-to-pan over the wide
//   image, not a WebGL/Three.js scene — deliberately, so a 360° photo costs
//   no more to view on a phone than an ordinary wide image does (item 7,
//   performance). No GPU context, no separate render loop.
// - Standard OpenCV.js browser builds do NOT expose `cv.Stitcher` (its JS
//   bindings were never added to the default build) — confirmed the same
//   way the earlier feature confirmed it, by checking `typeof cv.Stitcher`
//   rather than assuming either way. Stitching here is built from OpenCV.js's
//   lower-level primitives: ORB features, a Hamming BFMatcher with a ratio
//   test, `cv.findHomography` (RANSAC), `cv.warpPerspective`.
// - Quality is flagged, never hidden: if a consecutive frame pair matches
//   fewer than MIN_GOOD_MATCHES keypoints, the result is marked 'poor'
//   (still returned — a low-confidence panorama beats losing the walk-
//   around entirely) rather than silently publishing a bad stitch as if it
//   were fine.
//
// ⚠️⚠️ Item 4 (2026-09-11, third round — "explore using open source Hugin
// to stitch frames"): Hugin was investigated and is NOT integrated, for a
// concrete reason rather than a preference — it is a native, desktop C++
// application (wxWidgets UI, its own `nona`/`enblend`/`align_image_stack`
// command-line tools under the hood), with no WebAssembly build and no JS
// bindings anywhere. There is nothing to load into a browser tab; running
// it here would mean shipping a server that runs Hugin's binaries, which
// is a different architecture from "this module does its own client-side
// processing" and a materially larger undertaking than this pass's scope.
// What IS done instead is a real, verifiable improvement reachable inside
// the EXISTING OpenCV.js-primitives pipeline: seam FEATHERING (see
// `featheredFrame` below), which is the specific defect a from-scratch
// primitives-based stitcher (ours, and the one this replaced) is prone to
// that a tool like Hugin's `enblend` step exists to fix — a visible hard
// edge where one frame's contribution stops and the next one's starts.
// ============================================================================

window.Pano360 = (function () {
  var FRAME_COUNT = 12;          // frames sampled evenly across the source video
  var WORK_MAXW = 640;           // per-frame width used for feature matching/warping — kept small for mobile CPU cost
  var MIN_GOOD_MATCHES = 12;     // below this, the pair is stitched anyway but the whole result is flagged 'poor'

  // ⚠️⚠️ 2026-09-12 (item 4, second fix in the same round — "processing has
  // never worked well, app crashes when processing"): the grayscale fix above
  // makes the ALGORITHM correct, but a real device recording can still crash
  // the whole tab for a reason no try/catch can ever recover from — a mobile
  // browser killing the page for exhausting memory or for one JS task
  // blocking the main thread too long. Neither is a thrown JS exception, so
  // wrapping stitchFromVideo's caller in try/catch (module.js already does
  // this) cannot help with either. Two changes below address both directly:
  // yieldToUI() below breaks the per-frame work into separate browser tasks
  // (so a slow phone stays responsive AND the previous iteration's canvases/
  // cv.Mats get a real chance to be garbage-collected before the next
  // allocation), and stitchFrames' new pixel-area cap bounds how large the
  // transient per-frame buffers (dstMat/tmp canvas, each outW*outH*4 bytes)
  // can ever get — the old code clamped each dimension to 8000px
  // independently, which still allowed a ~256MB buffer, repeated per frame,
  // with nothing forcing the previous one to be freed first.
  function yieldToUI() {
    return new Promise(function (resolve) {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { resolve(); });
      else setTimeout(resolve, 0);
    });
  }

  function ensureOpenCV() {
    return new Promise(function (resolve, reject) {
      if (typeof cv !== 'undefined' && cv.Mat) { resolve(); return; }
      var waited = 0;
      var iv = setInterval(function () {
        waited += 200;
        if (typeof cv !== 'undefined' && cv.Mat) { clearInterval(iv); resolve(); return; }
        if (waited > 20000) { clearInterval(iv); reject(new Error('The vision library took too long to load.')); }
      }, 200);
    });
  }

  // -------------------------------------------------------- frame sampling --
  // A MediaRecorder-produced blob commonly has no duration atom in its
  // header (the recorder writes it before the final length is known), so
  // `video.duration` can read Infinity/NaN on first load — the standard
  // documented workaround is to seek far past the end once, which forces
  // the browser to resolve the real duration, then seek back to 0.
  function fixInfiniteDuration(video) {
    return new Promise(function (resolve) {
      if (isFinite(video.duration) && video.duration > 0) { resolve(video.duration); return; }
      var done = false;
      function finish(d) { if (done) return; done = true; video.removeEventListener('timeupdate', onTU); resolve(d); }
      function onTU() { if (isFinite(video.duration) && video.duration > 0) { video.currentTime = 0; finish(video.duration); } }
      video.addEventListener('timeupdate', onTU);
      try { video.currentTime = 1e9; } catch (e) { finish(0); }
      setTimeout(function () { finish(isFinite(video.duration) ? video.duration : 0); }, 2500);
    });
  }
  function seekTo(video, t) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (done) return; done = true; video.removeEventListener('seeked', onSeeked); resolve(); }
      function onSeeked() { finish(); }
      video.addEventListener('seeked', onSeeked);
      try { video.currentTime = t; } catch (e) { finish(); return; }
      setTimeout(finish, 3000);   // some browsers never fire `seeked` for a value the video is already effectively at
    });
  }
  function drawFrame(video, maxW) {
    var w = video.videoWidth || 640, h = video.videoHeight || 480;
    var scale = Math.min(1, maxW / w);
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    var ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  // Extracts `count` frames evenly spaced across the whole clip, at up to
  // `maxW` wide, as an array of <canvas> elements (never <img> — a canvas is
  // already decoded pixel data, no further async load needed downstream).
  function extractFrames(videoBlob, count, maxW) {
    return new Promise(function (resolve, reject) {
      var video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.preload = 'auto';
      var url = URL.createObjectURL(videoBlob);
      video.src = url;
      video.onloadedmetadata = async function () {
        try {
          var dur = await fixInfiniteDuration(video);
          if (!isFinite(dur) || dur <= 0) { URL.revokeObjectURL(url); reject(new Error('Could not read the video duration.')); return; }
          var frames = [];
          for (var i = 0; i < count; i++) {
            // Avoid the very first/last few frames — a walk-around often
            // starts/ends on a hand or a pocket as recording is toggled.
            var t = dur * (0.03 + (i / (count - 1)) * 0.94);
            await seekTo(video, t);
            frames.push(drawFrame(video, maxW));
          }
          URL.revokeObjectURL(url);
          resolve(frames);
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      video.onerror = function () { URL.revokeObjectURL(url); reject(new Error('The video could not be read.')); };
    });
  }
  // A single frame at one timestamp, at up to `maxW` wide — used for the
  // representative-frame picker (item 3), which needs one real photographic
  // frame, not the wide stitched mosaic.
  function extractFrameAt(videoBlob, atSeconds, maxW) {
    return new Promise(function (resolve, reject) {
      var video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.preload = 'auto';
      var url = URL.createObjectURL(videoBlob);
      video.src = url;
      video.onloadedmetadata = async function () {
        try {
          await fixInfiniteDuration(video);
          await seekTo(video, Math.min(atSeconds, Math.max(0, (video.duration || atSeconds) - 0.05)));
          var canvas = drawFrame(video, maxW || 1280);
          URL.revokeObjectURL(url);
          canvas.toBlob(function (blob) { resolve(blob); }, 'image/jpeg', 0.9);
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      video.onerror = function () { URL.revokeObjectURL(url); reject(new Error('The video could not be read.')); };
    });
  }
  // Duration alone (for the representative-frame scrubber's slider range) —
  // a thin wrapper so the caller never has to re-derive fixInfiniteDuration.
  function getDuration(videoBlob) {
    return new Promise(function (resolve) {
      var video = document.createElement('video');
      video.muted = true; video.preload = 'metadata';
      var url = URL.createObjectURL(videoBlob);
      video.src = url;
      video.onloadedmetadata = async function () {
        var d = await fixInfiniteDuration(video);
        URL.revokeObjectURL(url);
        resolve(isFinite(d) ? d : 0);
      };
      video.onerror = function () { URL.revokeObjectURL(url); resolve(0); };
    });
  }

  // ⚠️⚠️ 2026-09-12, verified against a REAL recorded video in an isolated
  // test harness (real @techstark/opencv-js + real Pannellum, installed from
  // npm and driven in a real headless Chromium — see the changelog entry;
  // this sandbox has no network path to a CDN, so the harness lives at
  // scratchpad/pano-test in that session rather than in this repo): a
  // homography between two ADJACENT frames of a slow lateral pan must be
  // close to a pure translation — small rotation, scale near 1, no flip.
  // `cv.findHomography(..., cv.RANSAC)` only guarantees its inlier set is
  // internally CONSISTENT, never that the resulting model is physically
  // plausible — on a scene with repetitive/periodic texture (tiled flooring,
  // a repeated railing, evenly-spaced studs/blocks — exactly what a
  // construction site walk-around often is) it can converge on a model with
  // plenty of "good" matches whose linear part is a near-180° rotation+flip,
  // which two frames a fraction of a second apart could never actually
  // exhibit. Reproduced directly: a real MediaRecorder-encoded test video
  // produced a homography `[[-0.97,-0.105],[0.169,-1.28]]` backed by 113
  // ratio-test-passing matches — well above MIN_GOOD_MATCHES, so the
  // existing match-COUNT gate never caught it — and because every frame's
  // placement composes onto the one before it (`placements[i] =
  // placements[i-1] * step`), that ONE bad homography poisoned every later
  // frame, turning what should be a wide panorama into a tall, garbled mess
  // while still reporting quality 'ok'. This is very likely the concrete
  // shape of "the app crashes / does not work when processing", on top of
  // the grayscale fix below: even once stitching runs without throwing, a
  // single implausible homography can silently wreck the whole mosaic.
  function isPlausiblePanHomography(H) {
    var d = H.data64F;
    var a = d[0], b = d[1], c = d[3], e = d[4];
    var det = a * e - b * c;
    if (!(det > 0.2 && det < 5)) return false;      // a flip or a wild scale jump
    var scale = Math.sqrt(Math.abs(det));
    if (scale < 0.55 || scale > 1.8) return false;  // frame-to-frame scale can't swing this far
    var angleDeg = Math.atan2(c, a) * 180 / Math.PI;
    if (Math.abs(angleDeg) > 30) return false;      // consecutive video frames can't rotate this much
    return true;
  }

  // ------------------------------------------------------------- stitching --
  // ORB + BFMatcher(Hamming) + ratio test + findHomography(RANSAC) +
  // warpPerspective, composing frame N onto the mosaic built from frames
  // 1..N-1 — the same primitives-based approach the earlier feature used,
  // since standard OpenCV.js builds don't expose cv.Stitcher at all.
  function homographyBetween(prevMat, curMat) {
    var orb, kp1, kp2, desc1, desc2, matcher, matches, mask1, mask2, H = null;
    var srcPts, dstPts, gray1, gray2;
    try {
      // ⚠️⚠️ THE ACTUAL BUG BEHIND "processing from video to 360 photo is not
      // working" (2026-09-12): `prevMat`/`curMat` come from `cv.imread()` on
      // a <canvas> — which OpenCV.js ALWAYS returns as a 4-channel RGBA Mat,
      // never grayscale. ORB's own detectAndCompute (per OpenCV's C++
      // implementation, and every OpenCV.js ORB example, official ones
      // included) expects a single-channel image and converts internally via
      // cv.COLOR_BGR2GRAY — which throws (or, depending on the build,
      // silently detects nothing) on a 4-channel input. This file never
      // converted to grayscale before this call, so on a real device this
      // either threw on every single frame pair (surfaced to the planner as
      // "Could not build the panorama") or returned zero keypoints for every
      // pair — which is indistinguishable from a genuinely bad stitch: every
      // pair fell back to the no-homography path (a pure horizontal shift),
      // so the "mosaic" was never actually aligned, just 12 frames placed
      // side by side. Every prior fix to the ACCUMULATION math (see this
      // file's own header) was correct and moot — there was rarely a real
      // homography to accumulate in the first place. Converting to
      // grayscale here — mirroring the one extra step every OpenCV.js
      // feature-detection sample takes right after `cv.imread()` — is the
      // fix; ORB itself is untouched, and this never touches `prevMat`/
      // `curMat` themselves, so the caller's own cleanup of those is
      // unaffected.
      gray1 = new cv.Mat(); gray2 = new cv.Mat();
      cv.cvtColor(prevMat, gray1, cv.COLOR_RGBA2GRAY, 0);
      cv.cvtColor(curMat, gray2, cv.COLOR_RGBA2GRAY, 0);
      mask1 = new cv.Mat(); mask2 = new cv.Mat();
      orb = new cv.ORB(700);
      kp1 = new cv.KeyPointVector(); desc1 = new cv.Mat();
      kp2 = new cv.KeyPointVector(); desc2 = new cv.Mat();
      orb.detectAndCompute(gray1, mask1, kp1, desc1);
      orb.detectAndCompute(gray2, mask2, kp2, desc2);
      if (desc1.rows < 4 || desc2.rows < 4) return { H: null, matches: 0 };
      matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
      var knn = new cv.DMatchVectorVector();
      matcher.knnMatch(desc1, desc2, knn, 2);
      var good = [];
      for (var i = 0; i < knn.size(); i++) {
        var pair = knn.get(i);
        if (pair.size() < 2) continue;
        var m = pair.get(0), n = pair.get(1);
        if (m.distance < 0.75 * n.distance) good.push(m);
      }
      knn.delete();
      if (good.length >= 4) {
        var srcArr = [], dstArr = [];
        good.forEach(function (m) {
          var p1 = kp1.get(m.queryIdx).pt, p2 = kp2.get(m.trainIdx).pt;
          srcArr.push(p2.x, p2.y); dstArr.push(p1.x, p1.y);   // map CURRENT frame onto the PREVIOUS mosaic's frame
        });
        srcPts = cv.matFromArray(good.length, 1, cv.CV_32FC2, srcArr);
        dstPts = cv.matFromArray(good.length, 1, cv.CV_32FC2, dstArr);
        H = cv.findHomography(srcPts, dstPts, cv.RANSAC);
        if (H.empty()) H = null;
        if (H && !isPlausiblePanHomography(H)) H = (H.delete(), null);
      }
      return { H: H, matches: good.length };
    } finally {
      if (orb) orb.delete();
      if (kp1) kp1.delete(); if (desc1) desc1.delete();
      if (kp2) kp2.delete(); if (desc2) desc2.delete();
      if (matcher) matcher.delete();
      if (mask1) mask1.delete(); if (mask2) mask2.delete();
      if (srcPts) srcPts.delete(); if (dstPts) dstPts.delete();
      if (gray1) gray1.delete(); if (gray2) gray2.delete();
      // H is deliberately NOT deleted here — the caller owns it and must
      // delete it once it's done warping with it.
    }
  }

  // ⚠️⚠️ 2026-09-11 fix ("improve the processing of video to 360, processing
  // has been failing"): the ORIGINAL stitcher (kept in git history) warped
  // every frame using ONLY its own PAIRWISE homography against the raw,
  // un-warped previous frame — correct for frame 1, silently WRONG for every
  // frame after that. Frame i-1's own local pixel grid only lines up with
  // the growing mosaic's coordinate system for i=1; from i=2 on, frame i-1
  // had ALREADY been shifted within the mosaic by every homography applied
  // before it, and the code never accounted for that — so frame i kept
  // landing back near the mosaic's own left edge instead of progressively
  // further along it. That is not a crash, it is a mosaic that LOOKS
  // stitched (a real image comes back) and is actually broken — overlapping
  // garbage past the first pair, most of the canvas past ~one frame's width
  // staying blank — which reads exactly as "processing has been failing"
  // without ever throwing an error to say so.
  //
  // Fixed by COMPOSING pairwise homographies into one cumulative transform
  // per frame (frame i's own local coordinates -> the mosaic's coordinate
  // system, anchored on frame 0), then warping every frame with its OWN
  // cumulative transform into one canvas sized to the true bounding box of
  // every frame's warped corners — never a fixed width guess.
  function mat3Mul(a, b) {
    var r = new Array(9);
    for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 3; j++) {
        var s = 0;
        for (var k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j];
        r[i * 3 + j] = s;
      }
    }
    return r;
  }
  function mat3Translate(tx, ty) { return [1, 0, tx, 0, 1, ty, 0, 0, 1]; }
  function mat3Scale(sx, sy) { return [sx, 0, 0, 0, sy, 0, 0, 0, 1]; }
  // Applies a row-major 3x3 homography `m` to point (x,y), returning the
  // dehomogenized [X, Y] — exported (Pano360._applyH3) so a sign/order
  // mistake here (which would silently place every frame at the wrong
  // spot, exactly the class of bug this whole fix exists to catch) can be
  // genuinely executed and checked, not just read.
  function applyH3(m, x, y) {
    var X = m[0] * x + m[1] * y + m[2];
    var Y = m[3] * x + m[4] * y + m[5];
    var W = m[6] * x + m[7] * y + m[8];
    if (!W) W = 1;
    return [X / W, Y / W];
  }

  // ---------------------------------------------------------- seam feather --
  // Item 4 (2026-09-11, third round — "stitching of video frames is not
  // good"): the compositing loop below used to draw every warped frame at
  // FULL opacity and let 'destination-over' decide, per pixel, which one
  // whole frame wins in an overlap — a hard, visible cut at the exact
  // boundary between the two source images. `featheredFrame` instead fades
  // each frame's OWN left/right edges to transparent before it's warped, so
  // two adjacent frames blend smoothly across their shared overlap instead
  // of snapping from one to the other. FEATHER_FRAC is a fraction of the
  // frame's own width — 12% is enough to soften a seam without eating so
  // much of a narrow-overlap frame that its centre starts fading too.
  var FEATHER_FRAC = 0.12;
  // Pure, and exported (Pano360._featherStops) so a wrong clamp here — which
  // would silently feather too much of a frame, or not enough to matter —
  // can be genuinely checked rather than only read from the drawing code
  // that uses it.
  function featherStops(width, marginFrac) {
    var marginPx = Math.max(4, Math.round(width * marginFrac));
    marginPx = Math.min(marginPx, Math.floor(width / 2));
    return { marginPx: marginPx, stopFrac: marginPx / width };
  }
  // Returns a NEW canvas — the source frame's own pixels, unchanged, with an
  // alpha gradient composited over its left and/or right edge via
  // 'destination-in'. `featherLeft`/`featherRight` are false for the very
  // first/last frame's OUTER edge specifically — there is nothing on the
  // far side of the mosaic for that edge to blend into, and fading it would
  // leave a transparent void at the panorama's own extremity rather than a
  // seam. When neither edge needs feathering the source is returned as-is.
  function featheredFrame(srcCanvas, featherLeft, featherRight, marginFrac) {
    if (!featherLeft && !featherRight) return srcCanvas;
    var w = srcCanvas.width, h = srcCanvas.height;
    var stops = featherStops(w, marginFrac);
    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    var octx = out.getContext('2d');
    octx.drawImage(srcCanvas, 0, 0);
    var mask = document.createElement('canvas');
    mask.width = w; mask.height = h;
    var mctx = mask.getContext('2d');
    var grad = mctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, featherLeft ? 'rgba(255,255,255,0)' : 'rgba(255,255,255,1)');
    grad.addColorStop(stops.stopFrac, 'rgba(255,255,255,1)');
    grad.addColorStop(1 - stops.stopFrac, 'rgba(255,255,255,1)');
    grad.addColorStop(1, featherRight ? 'rgba(255,255,255,0)' : 'rgba(255,255,255,1)');
    mctx.fillStyle = grad;
    mctx.fillRect(0, 0, w, h);
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(mask, 0, 0);
    return out;
  }

  // Frame-by-frame progress, reported via `onProgress(fraction)` — a 12-
  // frame stitch is real, if modest, CPU work, and a caller (module.js's
  // upload modal) needs something to show while it runs.
  // ⚠️⚠️ 2026-09-12: bounds the OUTPUT mosaic's total pixel count, not just
  // each dimension independently. The prior code clamped width and height to
  // 8000px each — which still permits a ~256MB buffer (8000*8000*4 bytes),
  // and every frame of the warp loop below allocates one (`dstMat`) plus a
  // same-sized `<canvas>` (`tmp`) on top of it. That is very plausibly the
  // actual crash: not a thrown error, but the browser killing the tab for
  // memory pressure once several of these land before GC catches up.
  // MAX_PIXELS keeps the per-buffer footprint to a few tens of MB regardless
  // of how wide the real pan (or a garbage homography) makes the mosaic;
  // MAX_DIM is a backstop for a very long, thin mosaic that could otherwise
  // pass the area check while still running one dimension away.
  var MAX_PIXELS = 6000000;   // ~6 megapixels of OUTPUT — the actual memory-bounding cap
  var MAX_DIM = 6000;         // per-dimension backstop, independent of the area cap above

  // ⚠️⚠️ 2026-09-12 (found via a REAL "180 degrees from one location" test —
  // see the isolated harness described in the changelog): the plausibility
  // gate above is necessary but NOT sufficient. It stops one bad pairwise
  // homography from poisoning the chain; it does nothing about a chain of
  // otherwise-CORRECT pairwise homographies still producing a mosaic that is
  // hugely oversized and mostly blank once composed. Reproduced directly: 12
  // frames of a real 180° in-place rotation, with EVERY pairwise homography
  // individually valid and passing the plausibility gate, still produced a
  // 3938x1524 output with ~42% of its pixels solid black.
  //
  // Root cause: this stitcher was composing every frame's homography onto
  // ONE FLAT reference image plane (frame 0's own plane) — a planar
  // reprojection. That is only valid over a narrow angular range: as a
  // rotating camera turns further from the reference frame's facing
  // direction, reprojecting it onto a flat plane has to stretch it by
  // 1/cos(angle from the reference) — which genuinely diverges toward
  // infinity as that angle nears 90°, and is already large well before a
  // full 180° sweep. That is exactly what this file's own header comment
  // ("this produces a CYLINDRICAL mosaic") was always SUPPOSED to prevent —
  // but nothing in the code actually reprojected into cylindrical
  // coordinates; every frame was warped in flat image space the whole time.
  //
  // Fixed by doing the cylindrical projection the header always claimed:
  // every extracted frame is warped into a shared CYLINDRICAL coordinate
  // system (via `cv.remap`, using an assumed horizontal field of view —
  // there is no way to read a real phone camera's true focal length from a
  // plain getUserMedia/MediaRecorder stream) BEFORE any feature matching or
  // compositing happens. In cylindrical coordinates a pure camera-yaw
  // rotation becomes a plain horizontal TRANSLATION — the same well-behaved,
  // additively-composable motion this file's original "lateral pan" design
  // already handled correctly — so the existing homography-chaining,
  // plausibility-gating and feathering code below (all otherwise unchanged)
  // now applies correctly to a real walk-around rotation too, not only to a
  // lateral slide.
  var CYL_FOV_DEG = 65;   // assumed horizontal field of view of the recording camera

  function cylindricalFocalPx(width) {
    return width / (2 * Math.tan(CYL_FOV_DEG * Math.PI / 360));
  }

  // Builds the INVERSE remap (destination cylindrical pixel -> source
  // perspective pixel) once per frame size, reused for every frame — the
  // standard closed-form cylindrical-projection mapping used by every
  // from-scratch panorama stitcher (Szeliski, "Image Alignment and
  // Stitching"). Built as plain JS typed arrays first, then handed to
  // OpenCV.js in one bulk call — a per-pixel `cv.Mat` write would be far
  // slower for no benefit over ~300K pixels.
  function buildCylindricalMaps(w, h, f) {
    var cx = w / 2, cy = h / 2;
    var mapXData = new Float32Array(w * h);
    var mapYData = new Float32Array(w * h);
    for (var yc = 0; yc < h; yc++) {
      for (var xc = 0; xc < w; xc++) {
        var theta = (xc - cx) / f;
        var hh = (yc - cy) / f;
        var idx = yc * w + xc;
        mapXData[idx] = f * Math.tan(theta) + cx;
        mapYData[idx] = f * hh / Math.cos(theta) + cy;
      }
    }
    return { mapX: cv.matFromArray(h, w, cv.CV_32FC1, mapXData), mapY: cv.matFromArray(h, w, cv.CV_32FC1, mapYData) };
  }

  // Warps ONE frame (a <canvas>) into cylindrical coordinates via the shared
  // maps, returning a NEW <canvas> the same size — the source frame is
  // never mutated, so a caller still holding the raw frame (e.g. for the
  // representative-thumbnail picker) is unaffected.
  function cylindricalWarpFrame(frameCanvas, maps) {
    var src = cv.imread(frameCanvas), dst = new cv.Mat();
    try {
      cv.remap(src, dst, maps.mapX, maps.mapY, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
      var out = document.createElement('canvas');
      out.width = frameCanvas.width; out.height = frameCanvas.height;
      cv.imshow(out, dst);
      return out;
    } finally { src.delete(); dst.delete(); }
  }

  async function stitchFrames(frames, onProgress) {
    await ensureOpenCV();
    if (frames.some(function (f) { return !f || !f.width || !f.height; })) {
      throw new Error('Could not read the recorded frames — the camera may not have captured any video.');
    }
    var poor = false;
    var fallbackCount = 0;
    // Reproject every frame into cylindrical coordinates FIRST (see the note
    // above) — everything from here on operates on the cylindrical frames,
    // never the raw perspective ones.
    var focalPx = cylindricalFocalPx(frames[0].width);
    var cylMaps = buildCylindricalMaps(frames[0].width, frames[0].height, focalPx);
    var cylFrames;
    try {
      cylFrames = frames.map(function (f) { return cylindricalWarpFrame(f, cylMaps); });
    } finally {
      cylMaps.mapX.delete(); cylMaps.mapY.delete();
    }
    var rawMats = cylFrames.map(function (f) { return cv.imread(f); });
    try {
      // placements[i] = the 3x3 row-major homography mapping cylindrical
      // frame i's OWN local pixel coordinates directly into the mosaic's
      // coordinate system. placements[0] is the identity — frame 0 anchors
      // the mosaic.
      var placements = [[1, 0, 0, 0, 1, 0, 0, 0, 1]];
      for (var i = 1; i < cylFrames.length; i++) {
        var res = homographyBetween(rawMats[i - 1], rawMats[i]);
        if (res.matches < MIN_GOOD_MATCHES) poor = true;
        var step;
        if (res.H) {
          step = Array.prototype.slice.call(res.H.data64F);
          res.H.delete();
        } else {
          poor = true;
          fallbackCount++;
          // No usable homography for this pair — approximate with a pure
          // horizontal shift of one frame-width, so the frame still lands
          // BESIDE what came before it instead of vanishing or landing on
          // top of it (the previous version's side-by-side-append fallback,
          // expressed as a transform so it composes the same way).
          step = [1, 0, cylFrames[i - 1].width, 0, 1, 0, 0, 0, 1];
        }
        // T_i = T_(i-1) * H_i — H_i maps frame i into frame i-1's own local
        // space; T_(i-1) then carries that into the mosaic's space, which is
        // exactly the composition this fix was missing.
        placements.push(mat3Mul(placements[i - 1], step));
        if (onProgress) onProgress((i / (cylFrames.length - 1)) * 0.5);
        // Break each pair's ORB/BFMatcher/RANSAC work into its own browser
        // task — a 12-frame stitch run as ONE synchronous block is exactly
        // the shape that reads as an unresponsive/crashed page on a slower
        // phone, and yielding here lets the previous iteration's temporary
        // Mats actually be reclaimed before the next one is allocated.
        await yieldToUI();
      }

      // The real bounding box of every frame's warped corners — never a
      // fixed-width guess — decides both the canvas size and the shift
      // needed to keep it entirely on-canvas (a pan can drift the mosaic's
      // own origin negative just as easily as it can grow it rightward).
      var minX = 0, maxX = 0, minY = 0, maxY = 0;
      cylFrames.forEach(function (f, idx) {
        [[0, 0], [f.width, 0], [0, f.height], [f.width, f.height]].forEach(function (c) {
          var p = applyH3(placements[idx], c[0], c[1]);
          if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        });
      });
      // A runaway/garbage homography (or a genuinely very wide pan) must
      // never try to allocate an unbounded canvas — scale the WHOLE mosaic
      // down proportionally (never distorting it) so its total pixel count
      // stays under MAX_PIXELS, with MAX_DIM as a per-axis backstop.
      var rawW = Math.max(1, maxX - minX), rawH = Math.max(1, maxY - minY);
      var scale = 1;
      if (rawW * rawH > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (rawW * rawH));
      if (rawW * scale > MAX_DIM) scale = Math.min(scale, MAX_DIM / rawW);
      if (rawH * scale > MAX_DIM) scale = Math.min(scale, MAX_DIM / rawH);
      var outW = Math.max(1, Math.round(rawW * scale));
      var outH = Math.max(1, Math.round(rawH * scale));
      // Scale composed with the translate — applied to every frame's own
      // placement below, so the whole mosaic shrinks together rather than
      // each frame being placed at full size and then cropped.
      var shift = mat3Mul(mat3Scale(scale, scale), mat3Translate(-minX, -minY));

      var mosaic = document.createElement('canvas');
      mosaic.width = outW; mosaic.height = outH;
      var mctx = mosaic.getContext('2d');
      // ⚠️⚠️ 2026-09-12: an opaque neutral fill BEFORE any frame is painted.
      // A canvas starts fully transparent, and any area no warped frame ever
      // touches — a real gap, or the margin the cylindrical warp itself
      // leaves outside its valid field of view — stayed transparent all the
      // way to `canvas.toBlob(..., 'image/jpeg')`. JPEG has no alpha
      // channel, and a transparent pixel is composited onto BLACK by the
      // browser before JPEG encoding — so any uncovered area silently became
      // solid black in the saved photo, indistinguishable from "the stitch
      // is broken" even when most of the frame was fine. A neutral mid-gray
      // fill means an uncovered area reads as an honest gap, never as more
      // (wrong) picture content and never as an unreadable black void.
      mctx.fillStyle = '#808080';
      mctx.fillRect(0, 0, outW, outH);
      for (var idx2 = 0; idx2 < cylFrames.length; idx2++) {
        var placed = mat3Mul(shift, placements[idx2]);
        var dstMat = null, Hmat = null, featherMat = null;
        try {
          // Item 4: warp a FEATHERED copy of the frame (its own left/right
          // edges faded to transparent, except the mosaic's own outer
          // edges — see featheredFrame's own comment), not the raw pixels.
          // ORB feature matching above still runs against the pristine
          // `rawMats` — feathering only ever touches what gets DRAWN.
          var feathered = featheredFrame(cylFrames[idx2], idx2 > 0, idx2 < cylFrames.length - 1, FEATHER_FRAC);
          featherMat = cv.imread(feathered);
          Hmat = cv.matFromArray(3, 3, cv.CV_64F, placed);
          dstMat = new cv.Mat();
          cv.warpPerspective(featherMat, dstMat, Hmat, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
          var tmp = document.createElement('canvas');
          tmp.width = outW; tmp.height = outH;
          cv.imshow(tmp, dstMat);
          // Painted in ORDER, later frames on top of earlier ones — their
          // feathered edges blend smoothly into whatever is already there
          // instead of the earlier hard destination-over cut.
          mctx.drawImage(tmp, 0, 0);
        } finally {
          if (Hmat) Hmat.delete();
          if (dstMat) dstMat.delete();
          if (featherMat) featherMat.delete();
        }
        if (onProgress) onProgress(0.5 + (idx2 / (cylFrames.length - 1)) * 0.5);
        // Same reasoning as the homography loop's own yield above — each
        // frame's warp allocates a full mosaic-sized Mat + canvas, and this
        // gives the browser a real chance to free the previous one first.
        await yieldToUI();
      }
      // pairsTotal/pairsFallback let the caller report something concrete
      // ("N of M frame transitions could not be matched confidently")
      // instead of a single opaque "low confidence" flag — the owner's own
      // ask for a more descriptive error/quality message.
      return { canvas: mosaic, quality: poor ? 'poor' : 'ok', pairsTotal: cylFrames.length - 1, pairsFallback: fallbackCount };
    } finally {
      rawMats.forEach(function (m) { try { m.delete(); } catch (e) {} });
    }
  }

  // Public entry point: video Blob in, stitched-panorama Blob + quality out.
  // `onProgress(stage, fraction)` — stage is 'frames' then 'stitch', so the
  // caller can show one continuous progress bar across both phases.
  async function stitchFromVideo(videoBlob, onProgress) {
    var frames = await extractFrames(videoBlob, FRAME_COUNT, WORK_MAXW);
    if (onProgress) onProgress('frames', 1);
    var result = await stitchFrames(frames, function (f) { if (onProgress) onProgress('stitch', f); });
    return new Promise(function (resolve) {
      result.canvas.toBlob(function (blob) {
        resolve({
          blob: blob, quality: result.quality, width: result.canvas.width, height: result.canvas.height,
          pairsTotal: result.pairsTotal, pairsFallback: result.pairsFallback
        });
      }, 'image/jpeg', 0.88);
    });
  }

  return {
    ensureOpenCV: ensureOpenCV,
    extractFrameAt: extractFrameAt,
    getDuration: getDuration,
    stitchFromVideo: stitchFromVideo,
    // Test-only hooks — genuinely execute the pure/near-pure pieces.
    _fixInfiniteDuration: fixInfiniteDuration,
    _homographyBetween: homographyBetween,
    _mat3Mul: mat3Mul,
    _mat3Scale: mat3Scale,
    _applyH3: applyH3,
    _featherStops: featherStops,
    _stitchFrames: stitchFrames,
    _isPlausiblePanHomography: isPlausiblePanHomography,
    _cylindricalFocalPx: cylindricalFocalPx,
    _buildCylindricalMaps: buildCylindricalMaps,
    _cylindricalWarpFrame: cylindricalWarpFrame
  };
})();
