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
// ============================================================================

window.Pano360 = (function () {
  var FRAME_COUNT = 12;          // frames sampled evenly across the source video
  var WORK_MAXW = 640;           // per-frame width used for feature matching/warping — kept small for mobile CPU cost
  var MIN_GOOD_MATCHES = 12;     // below this, the pair is stitched anyway but the whole result is flagged 'poor'

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

  // ------------------------------------------------------------- stitching --
  // ORB + BFMatcher(Hamming) + ratio test + findHomography(RANSAC) +
  // warpPerspective, composing frame N onto the mosaic built from frames
  // 1..N-1 — the same primitives-based approach the earlier feature used,
  // since standard OpenCV.js builds don't expose cv.Stitcher at all.
  function homographyBetween(prevMat, curMat) {
    var orb, kp1, kp2, desc1, desc2, matcher, matches, mask1, mask2, H = null;
    var srcPts, dstPts;
    try {
      mask1 = new cv.Mat(); mask2 = new cv.Mat();
      orb = new cv.ORB(700);
      kp1 = new cv.KeyPointVector(); desc1 = new cv.Mat();
      kp2 = new cv.KeyPointVector(); desc2 = new cv.Mat();
      orb.detectAndCompute(prevMat, mask1, kp1, desc1);
      orb.detectAndCompute(curMat, mask2, kp2, desc2);
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
      }
      return { H: H, matches: good.length };
    } finally {
      if (orb) orb.delete();
      if (kp1) kp1.delete(); if (desc1) desc1.delete();
      if (kp2) kp2.delete(); if (desc2) desc2.delete();
      if (matcher) matcher.delete();
      if (mask1) mask1.delete(); if (mask2) mask2.delete();
      if (srcPts) srcPts.delete(); if (dstPts) dstPts.delete();
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

  // Frame-by-frame progress, reported via `onProgress(fraction)` — a 12-
  // frame stitch is real, if modest, CPU work, and a caller (module.js's
  // upload modal) needs something to show while it runs.
  async function stitchFrames(frames, onProgress) {
    await ensureOpenCV();
    var poor = false;
    var rawMats = frames.map(function (f) { return cv.imread(f); });
    try {
      // placements[i] = the 3x3 row-major homography mapping frame i's OWN
      // local pixel coordinates directly into the mosaic's coordinate
      // system. placements[0] is the identity — frame 0 anchors the mosaic.
      var placements = [[1, 0, 0, 0, 1, 0, 0, 0, 1]];
      for (var i = 1; i < frames.length; i++) {
        var res = homographyBetween(rawMats[i - 1], rawMats[i]);
        if (res.matches < MIN_GOOD_MATCHES) poor = true;
        var step;
        if (res.H) {
          step = Array.prototype.slice.call(res.H.data64F);
          res.H.delete();
        } else {
          poor = true;
          // No usable homography for this pair — approximate with a pure
          // horizontal shift of one frame-width, so the frame still lands
          // BESIDE what came before it instead of vanishing or landing on
          // top of it (the previous version's side-by-side-append fallback,
          // expressed as a transform so it composes the same way).
          step = [1, 0, frames[i - 1].width, 0, 1, 0, 0, 0, 1];
        }
        // T_i = T_(i-1) * H_i — H_i maps frame i into frame i-1's own local
        // space; T_(i-1) then carries that into the mosaic's space, which is
        // exactly the composition this fix was missing.
        placements.push(mat3Mul(placements[i - 1], step));
        if (onProgress) onProgress((i / (frames.length - 1)) * 0.5);
      }

      // The real bounding box of every frame's warped corners — never a
      // fixed-width guess — decides both the canvas size and the shift
      // needed to keep it entirely on-canvas (a pan can drift the mosaic's
      // own origin negative just as easily as it can grow it rightward).
      var minX = 0, maxX = 0, minY = 0, maxY = 0;
      frames.forEach(function (f, idx) {
        [[0, 0], [f.width, 0], [0, f.height], [f.width, f.height]].forEach(function (c) {
          var p = applyH3(placements[idx], c[0], c[1]);
          if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        });
      });
      // A runaway/garbage homography must never try to allocate an
      // unbounded canvas — clamp rather than let the browser OOM.
      var MAX_DIM = 8000;
      var outW = Math.min(MAX_DIM, Math.max(1, Math.round(maxX - minX)));
      var outH = Math.min(MAX_DIM, Math.max(1, Math.round(maxY - minY)));
      var shift = mat3Translate(-minX, -minY);

      var mosaic = document.createElement('canvas');
      mosaic.width = outW; mosaic.height = outH;
      var mctx = mosaic.getContext('2d');
      for (var idx2 = 0; idx2 < frames.length; idx2++) {
        var placed = mat3Mul(shift, placements[idx2]);
        var dstMat = null, Hmat = null;
        try {
          Hmat = cv.matFromArray(3, 3, cv.CV_64F, placed);
          dstMat = new cv.Mat();
          cv.warpPerspective(rawMats[idx2], dstMat, Hmat, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
          var tmp = document.createElement('canvas');
          tmp.width = outW; tmp.height = outH;
          cv.imshow(tmp, dstMat);
          // Earlier frames stay authoritative where they overlap a later
          // one — destination-over only fills pixels the mosaic doesn't
          // already have, matching the original stitcher's own rule.
          mctx.globalCompositeOperation = idx2 === 0 ? 'source-over' : 'destination-over';
          mctx.drawImage(tmp, 0, 0);
          mctx.globalCompositeOperation = 'source-over';
        } finally {
          if (Hmat) Hmat.delete();
          if (dstMat) dstMat.delete();
        }
        if (onProgress) onProgress(0.5 + (idx2 / (frames.length - 1)) * 0.5);
      }
      return { canvas: mosaic, quality: poor ? 'poor' : 'ok' };
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
        resolve({ blob: blob, quality: result.quality, width: result.canvas.width, height: result.canvas.height });
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
    _applyH3: applyH3
  };
})();
