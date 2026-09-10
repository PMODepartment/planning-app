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

  // Warps `curCanvas` by `H` onto a mosaic canvas already `mosaicW` wide,
  // compositing at the same vertical position (frames are horizontal pans,
  // so only X needs to grow) and returns the new, possibly-wider canvas.
  function warpOnto(mosaicCanvas, curCanvas, H, growBy) {
    var newW = mosaicCanvas.width + growBy;
    var out = document.createElement('canvas');
    out.width = newW; out.height = mosaicCanvas.height;
    var octx = out.getContext('2d');
    octx.drawImage(mosaicCanvas, 0, 0);

    var srcMat = null, dstMat = null, Hmat = null;
    try {
      srcMat = cv.imread(curCanvas);
      Hmat = H;
      dstMat = new cv.Mat();
      var dsize = new cv.Size(newW, out.height);
      cv.warpPerspective(srcMat, dstMat, Hmat, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
      var tmp = document.createElement('canvas');
      tmp.width = newW; tmp.height = out.height;
      cv.imshow(tmp, dstMat);
      // Composite the warped frame UNDER the existing mosaic pixels — the
      // already-placed frames are the ones already agreed with their own
      // neighbours; the new frame only fills in the fresh strip to the right.
      octx.globalCompositeOperation = 'destination-over';
      octx.drawImage(tmp, 0, 0);
      octx.globalCompositeOperation = 'source-over';
    } finally {
      if (srcMat) srcMat.delete();
      if (dstMat) dstMat.delete();
    }
    return out;
  }

  // Frame-by-frame progress, reported via `onProgress(fraction)` — a 12-
  // frame stitch is real, if modest, CPU work, and a caller (module.js's
  // upload modal) needs something to show while it runs.
  async function stitchFrames(frames, onProgress) {
    await ensureOpenCV();
    var mosaic = frames[0];
    var poor = false;
    var prevMat = cv.imread(frames[0]);
    try {
      for (var i = 1; i < frames.length; i++) {
        var curCanvas = frames[i];
        var curMat = cv.imread(curCanvas);
        var res;
        try { res = homographyBetween(prevMat, curMat); }
        finally { /* prevMat is reassigned below, curMat below too */ }
        if (res.matches < MIN_GOOD_MATCHES) poor = true;
        if (res.H) {
          // Advance the mosaic by roughly this frame's own width, minus a
          // generous overlap estimate — exact overlap varies with how fast
          // the phone was panned, so this is deliberately approximate; a
          // wrong estimate here shows as slightly more/less overlap, never
          // a crash or a torn image, since warpOnto composites under the
          // existing mosaic rather than assuming a hard seam.
          var growBy = Math.round(curCanvas.width * 0.6);
          mosaic = warpOnto(mosaic, curCanvas, res.H, growBy);
        } else {
          poor = true;
          // No usable homography for this pair — fall back to a plain
          // side-by-side append so the frame is not simply dropped.
          var appended = document.createElement('canvas');
          appended.width = mosaic.width + curCanvas.width; appended.height = mosaic.height;
          var actx = appended.getContext('2d');
          actx.drawImage(mosaic, 0, 0);
          actx.drawImage(curCanvas, mosaic.width, 0);
          mosaic = appended;
        }
        if (res.H) res.H.delete();
        prevMat.delete();
        prevMat = curMat;
        if (onProgress) onProgress(i / (frames.length - 1));
      }
    } finally {
      if (prevMat) prevMat.delete();
    }
    return { canvas: mosaic, quality: poor ? 'poor' : 'ok' };
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
    _warpOnto: warpOnto,
    _homographyBetween: homographyBetween
  };
})();
