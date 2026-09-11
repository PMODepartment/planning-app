// ============================================================================
// Progress Photos — in-app camera capture (item 1 of the overnight batch)
// ----------------------------------------------------------------------------
// Owner: "when take photo/video is clicked, bring user to a separate page or
// pop-up window inside the app to take photos/videos directly inside app.
// use macOS and iOS camera as pegs for the feature."
//
// A single full-screen overlay, styled after the Photo Booth / iOS Camera
// app: a live black stage, the video feed filling it, a bottom control bar
// with a big circular shutter (photo) or a red record button that becomes a
// stop square while recording (video/360°), a flip-camera button, and a
// close (×) top-left. Nothing here talks to Supabase or progress_photos at
// all — this module's only job is "hand back a Blob", via one callback, so
// module.js's own upload/staging pipeline is the single place a file (camera
// or picked from disk) is ever turned into a saved row. That is also why
// Capture.take360 hands back a raw VIDEO blob, not a stitched panorama —
// the stitching pipeline lives in module.js beside the rest of the 360°
// upload flow, not here.
//
// ⚠️ SCOPE: getUserMedia/MediaRecorder need a real camera and a real
// permission prompt, neither of which exist in this sandbox — this file is
// written against the documented Web APIs and degrades explicitly (a named
// error message with an "upload instead" escape hatch) everywhere a real
// device could refuse or lack a capability, but the live capture itself is
// UNVERIFIED here, the same standing caveat this module's own history
// records for every camera/recording feature it has ever shipped.
// ============================================================================

window.Capture = (function () {
  var overlay = null;          // the one live <div> overlay, or null when closed
  var stream = null;
  var recorder = null;
  var recordedChunks = [];
  var recTimer = null, recStartedAt = 0;
  var curFacing = 'environment';   // 'environment' = rear camera, 'user' = front — matches facingMode's own vocabulary
  var closing = false;             // re-entrancy guard: a fast double-close must only clean up once
  // ⚠️ 2026-09-11 fix ("the close button does not close"): getUserMedia's
  // permission prompt is asynchronous, so a fast tap on × WHILE it's still
  // pending used to race the overlay's own teardown — close() would run
  // first (removing the DOM, nulling `overlay`), and the STREAM promise
  // would still resolve afterwards and try to attach a live camera stream
  // to a video element that no longer exists, and wire a flip-camera click
  // handler onto a `null` (getElementById of a removed node) — throwing,
  // leaking the just-opened MediaStream (nothing ever stopped its tracks),
  // and leaving the camera indicator lit with no overlay left to close it
  // from. `sessionToken` is bumped on every close/open; a pending
  // continuation checks its OWN token against the current one before
  // touching anything, and stops a stream that arrived too late instead of
  // attaching it.
  var sessionToken = 0;
  // Item 5: "for video, provide option to include or exclude audio" — a
  // real preference, kept across opens the same way curFacing already is
  // (turn the mic off once, it stays off next time you record). Photo mode
  // never reads this at all — it never requested audio in the first place.
  var wantAudio = true;

  function $(id) { return document.getElementById(id); }

  // -------------------------------------------------------------- styling --
  // Kept here (not module.css) so this file has no dependency on which page
  // loaded it first — a capture overlay is the same everywhere it's used.
  var STYLE_ID = 'pp-capture-style';
  function ensureStyle() {
    if ($(STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent =
      '.pp-cap-overlay{position:fixed;inset:0;z-index:1000;background:#000;display:flex;flex-direction:column;}' +
      '.pp-cap-stage{position:relative;flex:1;min-height:0;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;}' +
      '.pp-cap-video{width:100%;height:100%;object-fit:cover;}' +
      '.pp-cap-canvas{display:none;}' +
      '.pp-cap-topbar{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;' +
        'padding:max(10px,env(safe-area-inset-top)) 14px 10px;z-index:2;}' +
      '.pp-cap-close{width:38px;height:38px;border-radius:50%;background:rgba(0,0,0,.45);border:0;color:#fff;' +
        'font-size:20px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;}' +
      // Item 5: the mic toggle sits where the topbar's empty balancing
      // span used to (video/360 modes only — see buildOverlay). Same
      // 38px round-button shape as close, so the row reads as one family;
      // .is-muted reddens it, the same "this is off" signal .pp-cap-shutter
      // already uses for the recording dot, so a muted recording session
      // can never look identical to a normal one at a glance.
      '.pp-cap-audiotoggle{width:38px;height:38px;border-radius:50%;background:rgba(0,0,0,.45);border:0;color:#fff;' +
        'cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}' +
      '.pp-cap-audiotoggle.is-muted{background:rgba(255,59,48,.55);}' +
      '.pp-cap-audiotoggle:disabled{opacity:.4;cursor:not-allowed;}' +
      '.pp-cap-timer{color:#fff;font-variant-numeric:tabular-nums;font-size:15px;font-weight:700;' +
        'background:rgba(0,0,0,.45);padding:4px 12px;border-radius:999px;display:none;align-items:center;gap:6px;}' +
      '.pp-cap-timer.on{display:flex;}' +
      '.pp-cap-timer .dot{width:8px;height:8px;border-radius:50%;background:#ff3b30;animation:pp-cap-pulse 1s ease-in-out infinite;}' +
      '@keyframes pp-cap-pulse{0%,100%{opacity:1}50%{opacity:.3}}' +
      '.pp-cap-guide{position:absolute;left:0;right:0;top:56px;display:flex;flex-direction:column;align-items:center;' +
        'gap:10px;z-index:2;pointer-events:none;padding:0 20px;text-align:center;}' +
      '.pp-cap-guide-text{color:#fff;font-size:14px;background:rgba(0,0,0,.5);padding:8px 14px;border-radius:10px;max-width:340px;}' +
      // Item 6 (2026-09-11): the 360 guide — a fixed ring of 24 heading
      // segments (dim until the camera has actually swept past that
      // bucket) plus a facing marker that moves around the ring live,
      // replacing the old single conic-gradient percentage wedge (see
      // ringGuideHTML()'s own comment for why).
      '.pp-cap-ringwrap{position:relative;width:120px;height:120px;}' +
      '.pp-cap-ringsvg{width:120px;height:120px;overflow:visible;}' +
      '.pp-cap-ringbg{fill:rgba(0,0,0,.4);stroke:rgba(255,255,255,.3);stroke-width:2;}' +
      '.pp-cap-seg{stroke:rgba(255,255,255,.32);stroke-width:4;stroke-linecap:round;transition:stroke .15s;}' +
      '.pp-cap-seg.is-covered{stroke:#fff;}' +
      '.pp-cap-facing{fill:#ff3b30;transition:transform .12s linear;}' +
      '.pp-cap-ringpct{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'color:#fff;font-weight:700;font-size:16px;}' +
      '.pp-cap-bottombar{position:relative;z-index:2;padding:18px 20px max(18px,env(safe-area-inset-bottom));' +
        'display:flex;align-items:center;justify-content:center;gap:0;}' +
      '.pp-cap-shutter-row{display:flex;align-items:center;justify-content:center;width:100%;max-width:420px;}' +
      '.pp-cap-side{width:52px;height:52px;flex:none;}' +
      '.pp-cap-flip{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.18);border:0;color:#fff;' +
        'display:flex;align-items:center;justify-content:center;cursor:pointer;}' +
      '.pp-cap-shutter-wrap{flex:1;display:flex;align-items:center;justify-content:center;}' +
      // The shutter: a plain white ring for photo, exactly the iOS Camera
      // shutter shape; the video/360 record button is the same ring but the
      // INNER disc is red and morphs into a rounded square while recording —
      // the same shape language iOS Camera uses to say "tap again to stop".
      '.pp-cap-shutter{width:72px;height:72px;border-radius:50%;border:4px solid #fff;background:transparent;' +
        'cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}' +
      '.pp-cap-shutter-inner{width:58px;height:58px;border-radius:50%;background:#fff;transition:border-radius .15s,width .15s,height .15s;}' +
      '.pp-cap-shutter.is-video .pp-cap-shutter-inner{background:#ff3b30;}' +
      '.pp-cap-shutter.is-recording .pp-cap-shutter-inner{width:28px;height:28px;border-radius:8px;}' +
      '.pp-cap-hint{color:rgba(255,255,255,.75);font-size:12px;text-align:center;margin-top:10px;}' +
      '.pp-cap-error{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'gap:14px;color:#fff;text-align:center;padding:0 24px;z-index:3;background:rgba(0,0,0,.6);}' +
      '.pp-cap-error p{max-width:320px;margin:0;}';
    document.head.appendChild(el);
  }

  // ------------------------------------------------------------- lifecycle --
  function stopStream() {
    if (stream) { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); stream = null; }
  }
  function stopTimer() { if (recTimer) { clearInterval(recTimer); recTimer = null; } }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  // Every entry point routes its cleanup through here — the ONE place a
  // stream/recorder/timer/DOM overlay can be torn down, so a cancel, a
  // completed capture and an unexpected error can never leave any of the
  // four half-cleaned-up.
  function close() {
    if (closing) return;
    closing = true;
    sessionToken++;   // invalidate any in-flight startSession() continuation
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (e) {}
    recorder = null;
    stopTimer();
    stopStream();
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    closing = false;
  }

  async function openStream(withAudio) {
    var constraints = { video: { facingMode: { ideal: curFacing } }, audio: !!withAudio };
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  // Item 5's mic glyph — hand-drawn rather than a shared icons.js addition:
  // this file already keeps itself dependency-free of the app's own icon
  // set (its own header note: "no CSS dependency ... works anywhere it's
  // loaded"), and .pp-cap-flip already falls back to a plain glyph when
  // Icons isn't loaded, so a second icon here would need the same fallback
  // anyway. A slash through the mic body is the universal "muted" mark.
  function micSVG(muted) {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/>' +
      '<path d="M19 11a7 7 0 0 1-14 0"/><line x1="12" y1="18" x2="12" y2="22"/>' +
      (muted ? '<line x1="3" y1="3" x2="21" y2="21" stroke="#fff"/>' : '') +
      '</svg>';
  }

  function buildOverlay(opts) {
    ensureStyle();
    var el = document.createElement('div');
    el.className = 'pp-cap-overlay';
    el.innerHTML =
      '<div class="pp-cap-topbar">' +
        '<button type="button" class="pp-cap-close" id="pp-cap-close" title="Close" aria-label="Close">×</button>' +
        '<span class="pp-cap-timer" id="pp-cap-timer"><span class="dot"></span><span id="pp-cap-timertxt">00:00</span></span>' +
        (opts.mode !== 'photo'
          ? '<button type="button" class="pp-cap-audiotoggle" id="pp-cap-audio" title="Toggle microphone" aria-label="Toggle microphone"></button>'
          : '<span class="pp-cap-side"></span>') +
      '</div>' +
      (opts.guideHTML || '') +
      '<div class="pp-cap-stage">' +
        '<video class="pp-cap-video" id="pp-cap-video" autoplay playsinline muted></video>' +
        '<canvas class="pp-cap-canvas" id="pp-cap-canvas"></canvas>' +
        '<div class="pp-cap-error" id="pp-cap-error" hidden></div>' +
      '</div>' +
      '<div class="pp-cap-bottombar">' +
        '<div class="pp-cap-shutter-row">' +
          '<span class="pp-cap-side"></span>' +
          '<div class="pp-cap-shutter-wrap">' +
            '<button type="button" class="pp-cap-shutter' + (opts.mode !== 'photo' ? ' is-video' : '') + '" id="pp-cap-shutter" title="' +
              (opts.mode === 'photo' ? 'Take photo' : 'Start recording') + '">' +
              '<span class="pp-cap-shutter-inner"></span></button>' +
          '</div>' +
          '<button type="button" class="pp-cap-flip pp-cap-side" id="pp-cap-flip" title="Switch camera" aria-label="Switch camera">' +
            (window.Icons ? Icons.svg('refresh', 20) : '⟳') + '</button>' +
        '</div>' +
      '</div>' +
      (opts.hint ? '<p class="pp-cap-hint">' + opts.hint + '</p>' : '');
    document.body.appendChild(el);
    return el;
  }

  function showError(msg, onUploadInstead) {
    var box = $('pp-cap-error');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = '<p>' + msg + '</p>' +
      '<button type="button" class="pd-btn pd-btn-primary" id="pp-cap-err-upload">Upload a file instead</button>' +
      '<button type="button" class="pd-btn" id="pp-cap-err-close">Close</button>';
    $('pp-cap-err-upload').onclick = function () { close(); if (onUploadInstead) onUploadInstead(); };
    $('pp-cap-err-close').onclick = function () { close(); };
  }

  // Shared session bootstrap for all three entry points: opens the stream,
  // wires close/flip, and calls back once the live video is actually playing
  // — or reports a clear, actionable error (never a silent dead camera).
  function startSession(mode, opts, onReady) {
    if (overlay) close();   // never stack two capture overlays
    opts = opts || {};
    overlay = buildOverlay({ mode: mode, hint: opts.hint, guideHTML: opts.guideHTML });
    var videoEl = $('pp-cap-video');
    // This session's own token — checked against the shared counter after
    // every await below, so a close() that runs while one of these is still
    // pending is detected instead of racing it. See the field's own comment.
    var mySession = ++sessionToken;
    function stale() { return mySession !== sessionToken; }
    $('pp-cap-close').onclick = function () { close(); if (opts.onCancel) opts.onCancel(); };
    function audioNow() { return mode !== 'photo' && wantAudio; }

    function attach(s) {
      stream = s;
      videoEl.srcObject = s;
    }

    // Item 5: the mic toggle only exists (buildOverlay) for video/360 —
    // photo mode never requests audio at all, so there's nothing to toggle.
    var audioBtn = $('pp-cap-audio');
    function syncAudioBtn() {
      if (!audioBtn) return;
      audioBtn.innerHTML = micSVG(!wantAudio);
      audioBtn.classList.toggle('is-muted', !wantAudio);
      audioBtn.setAttribute('aria-pressed', String(!wantAudio));
      audioBtn.title = wantAudio ? 'Turn microphone off' : 'Turn microphone on';
    }
    if (audioBtn) {
      syncAudioBtn();
      audioBtn.onclick = async function () {
        // ⚠️ Same restriction as flip-camera, and for the identical reason:
        // an already-recording MediaRecorder is bound to the audio track
        // its stream had at record-start; there's no clean way to add or
        // drop a track mid-clip without corrupting it.
        if (recorder && recorder.state === 'recording') {
          UI && UI.toast && UI.toast('Turn the mic on/off before you start recording', 'warn');
          return;
        }
        wantAudio = !wantAudio;
        syncAudioBtn();
        stopStream();
        var s3;
        try { s3 = await openStream(audioNow()); } catch (e) { return; }
        if (stale()) { try { s3.getTracks().forEach(function (t) { t.stop(); }); } catch (e2) {} return; }
        attach(s3);
      };
    }

    openStream(audioNow()).then(function (s) {
      if (stale()) { try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} return; }
      attach(s);
      $('pp-cap-flip').onclick = async function () {
        curFacing = curFacing === 'environment' ? 'user' : 'environment';
        var wasRecording = recorder && recorder.state === 'recording';
        // ⚠️ Switching the physical camera mid-recording would need to swap
        // the live MediaRecorder's own track, which is not something this
        // API supports cleanly — refused rather than silently corrupting or
        // truncating the clip already in progress.
        if (wasRecording) { UI && UI.toast && UI.toast('Switch camera before you start recording', 'warn'); return; }
        stopStream();
        var s2;
        try { s2 = await openStream(audioNow()); }
        catch (e) {
          curFacing = curFacing === 'environment' ? 'user' : 'environment';
          try { s2 = await openStream(audioNow()); } catch (e2) { return; }
        }
        if (stale()) { try { s2.getTracks().forEach(function (t) { t.stop(); }); } catch (e3) {} return; }
        attach(s2);
      };
      onReady(videoEl);
    }).catch(function (err) {
      if (stale()) return;
      // ⚠️ No camera, no permission, or an insecure (non-HTTPS) context —
      // every one of these must still leave a way forward: uploading an
      // existing file never depends on getUserMedia at all.
      var msg = (err && err.name === 'NotAllowedError')
        ? 'Camera access was not allowed. You can still add media by uploading a file.'
        : (err && err.name === 'NotFoundError')
          ? 'No camera was found on this device.'
          : 'The camera could not be started (' + ((err && err.message) || 'unknown error') + ').';
      showError(msg, opts.onCancel);
    });
  }

  // ------------------------------------------------------------------ photo --
  function takePhoto(onDone) {
    startSession('photo', { hint: 'Tap the shutter to take a photo', onCancel: function () { onDone(null); } }, function (videoEl) {
      $('pp-cap-shutter').onclick = function () {
        var canvas = $('pp-cap-canvas');
        canvas.width = videoEl.videoWidth || 1280;
        canvas.height = videoEl.videoHeight || 960;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        // A quick white flash — cheap, and the one bit of camera-app
        // polish that actually confirms "the shutter fired" at a glance.
        var flash = document.createElement('div');
        flash.style.cssText = 'position:absolute;inset:0;background:#fff;opacity:.85;z-index:5;pointer-events:none;transition:opacity .25s;';
        overlay.querySelector('.pp-cap-stage').appendChild(flash);
        requestAnimationFrame(function () { flash.style.opacity = '0'; });
        setTimeout(function () { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 260);
        canvas.toBlob(function (blob) {
          close();
          onDone(blob);
        }, 'image/jpeg', 0.92);
      };
    });
  }

  // ------------------------------------------------------------------ video --
  var MIME_CANDIDATES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  function pickMimeType() {
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i];
    }
    return '';   // let the browser pick its own default rather than force an unsupported one
  }
  function startRecording(mimeType, onStopped) {
    recordedChunks = [];
    var opts = mimeType ? { mimeType: mimeType } : {};
    try { recorder = new MediaRecorder(stream, opts); }
    catch (e) { recorder = new MediaRecorder(stream); }   // constructor itself can reject an unsupported opts object
    recorder.ondataavailable = function (e) { if (e.data && e.data.size) recordedChunks.push(e.data); };
    recorder.onstop = function () {
      var blob = new Blob(recordedChunks, { type: recorder.mimeType || mimeType || 'video/webm' });
      recordedChunks = [];
      onStopped(blob);
    };
    recorder.start();
    recStartedAt = Date.now();
    var timerEl = $('pp-cap-timer'), txt = $('pp-cap-timertxt');
    if (timerEl) timerEl.classList.add('on');
    stopTimer();
    recTimer = setInterval(function () {
      if (txt) txt.textContent = fmtTime((Date.now() - recStartedAt) / 1000);
    }, 250);
  }
  function stopRecording() {
    stopTimer();
    var timerEl = $('pp-cap-timer'); if (timerEl) timerEl.classList.remove('on');
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }
  function takeVideo(onDone) {
    var mimeType = pickMimeType();
    startSession('video', { hint: 'Tap to start recording, tap again to stop', onCancel: function () { onDone(null); } }, function () {
      var shutter = $('pp-cap-shutter');
      shutter.onclick = function () {
        if (recorder && recorder.state === 'recording') {
          shutter.classList.remove('is-recording');
          shutter.disabled = true;
          stopRecording();
          // recorder.onstop (set below) hands the blob back and closes.
        } else {
          shutter.classList.add('is-recording');
          startRecording(mimeType, function (blob) {
            var b = blob; close(); onDone(b);
          });
        }
      };
    });
  }

  // ------------------------------------------------------------------- 360° --
  // Item 3 (original): "provide guides on camera to take the video for
  // processing to 360." Item 6 (2026-09-11): "improve 360 guide... show
  // preview of 360 while video" — reworked from a single conic-gradient
  // percentage ring into a real coverage guide, closer to the referenced
  // Facebook-style capture (a fixed backdrop the camera pans across, a
  // highlighted band marking what's already been covered).
  // ⚠️ SCOPE: this is coverage-by-DIRECTION, not a live stitched panorama.
  // Actually compositing frames into a preview WHILE still recording would
  // mean running pano360.js's ORB/homography pipeline concurrently with
  // MediaRecorder against live frames — real, substantial work with its own
  // performance/threading questions, and it is NOT attempted here. What IS
  // real and shipped: the ring now tracks which of 24 heading buckets the
  // camera has actually swept past (never un-marking one you turn away
  // from, and — the actual bug in the OLD ring — never over-counting one
  // you pan back and forth across either, since the old `accumTurned` just
  // summed absolute movement and happily passed 100% on a phone that never
  // completed a real walk-around), plus a facing marker that moves around
  // the fixed ring live, the same "window moving over a fixed backdrop"
  // shape as the reference image.
  var ROTATION_TARGET_MS = 18000;   // the elapsed-time fallback's assumed "one slow full turn"
  var COVERAGE_BUCKETS = 24, BUCKET_DEG = 360 / COVERAGE_BUCKETS;
  // Pure, and exported (Capture._coverageSteps) purely so it can be
  // genuinely executed by a test — a flipped `dir` here silently marks
  // nearly the WHOLE ring covered on a single small step back the way you
  // came, which nothing short of running it against real inputs would
  // catch. Returns every bucket index from `lastBucket` to `idx` inclusive,
  // walked the SHORTER way around a `total`-bucket ring.
  function coverageSteps(lastBucket, idx, total) {
    var fwd = (idx - lastBucket + total) % total;
    var bwd = (lastBucket - idx + total) % total;
    var dir = fwd <= bwd ? 1 : -1, steps = Math.min(fwd, bwd);
    var out = [], cur = lastBucket;
    for (var s = 0; s <= steps; s++) { out.push(cur); cur = (cur + dir + total) % total; }
    return out;
  }
  function requestOrientationPermission() {
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      return DeviceOrientationEvent.requestPermission().then(function (r) { return r === 'granted'; }).catch(function () { return false; });
    }
    return Promise.resolve(!!window.DeviceOrientationEvent);
  }
  // The ring's own markup — a fixed circle of 24 tick segments (one per
  // 15° heading bucket, drawn once) plus a facing marker that rotates live
  // and a centred percentage label. Segments are addressed by id
  // (`pp-cap-seg-0`..`pp-cap-seg-23`) rather than rebuilt, so lighting one
  // up as its bucket is covered is a single classList.add — no re-render.
  function ringGuideHTML() {
    var segs = '';
    for (var i = 0; i < COVERAGE_BUCKETS; i++) {
      segs += '<line class="pp-cap-seg" id="pp-cap-seg-' + i + '" x1="60" y1="7" x2="60" y2="19" ' +
        'transform="rotate(' + (i * BUCKET_DEG) + ' 60 60)" />';
    }
    return '<div class="pp-cap-guide">' +
      '<div class="pp-cap-guide-text">Hold the phone level and slowly turn all the way around while recording — the ring lights up where you’ve already covered.</div>' +
      '<div class="pp-cap-ringwrap">' +
        '<svg class="pp-cap-ringsvg" viewBox="0 0 120 120" width="120" height="120">' +
          '<circle class="pp-cap-ringbg" cx="60" cy="60" r="52" />' +
          segs +
          '<polygon class="pp-cap-facing" id="pp-cap-facing" points="60,10 55,24 65,24" transform="rotate(0 60 60)" />' +
        '</svg>' +
        '<span class="pp-cap-ringpct" id="pp-cap-ringpct">0%</span>' +
      '</div>' +
    '</div>';
  }
  function take360(onDone) {
    startSession('360', { hint: 'Tap to start recording your 360° walk-around', guideHTML: ringGuideHTML(), onCancel: function () { onDone(null); } }, function () {
      var shutter = $('pp-cap-shutter');
      var mimeType = pickMimeType();
      var usingCompass = false, startHeading = null, lastBucket = -1;
      var covered = new Array(COVERAGE_BUCKETS).fill(false);
      var orientHandler = null;
      function markCovered(headingRel) {
        headingRel = ((headingRel % 360) + 360) % 360;
        var facing = $('pp-cap-facing');
        if (facing) facing.setAttribute('transform', 'rotate(' + headingRel + ' 60 60)');
        var idx = Math.floor(headingRel / BUCKET_DEG) % COVERAGE_BUCKETS;
        // Mark every bucket crossed since the last reading, not just the
        // one landed on — a fast turn between two ticks would otherwise
        // silently skip whatever buckets it swept past. coverageSteps()
        // walks whichever direction is SHORTER around the ring; walking
        // the wrong way round would mark nearly the whole ring covered for
        // one small step back the way you came.
        if (lastBucket === -1) lastBucket = idx;
        coverageSteps(lastBucket, idx, COVERAGE_BUCKETS).forEach(function (cur) {
          covered[cur] = true;
          var seg = $('pp-cap-seg-' + cur); if (seg) seg.classList.add('is-covered');
        });
        lastBucket = idx;
        var pct = Math.round((covered.filter(Boolean).length / COVERAGE_BUCKETS) * 100);
        var lbl = $('pp-cap-ringpct'); if (lbl) lbl.textContent = pct + '%';
      }
      function stopOrientation() {
        if (orientHandler) { window.removeEventListener('deviceorientationabsolute', orientHandler); window.removeEventListener('deviceorientation', orientHandler); orientHandler = null; }
      }
      shutter.onclick = function () {
        if (recorder && recorder.state === 'recording') {
          shutter.classList.remove('is-recording');
          shutter.disabled = true;
          stopOrientation();
          stopRecording();
        } else {
          shutter.classList.add('is-recording');
          var recStart = Date.now();
          requestOrientationPermission().then(function (granted) {
            usingCompass = granted;
            if (granted) {
              orientHandler = function (e) {
                var h = (e.webkitCompassHeading != null) ? e.webkitCompassHeading : e.alpha;
                if (h == null) return;
                if (startHeading == null) startHeading = h;
                markCovered(h - startHeading);
              };
              window.addEventListener('deviceorientationabsolute', orientHandler);
              window.addEventListener('deviceorientation', orientHandler);
            }
          });
          // Elapsed-time fallback runs regardless — if the compass IS
          // reporting, its own bucket coverage overwrites this on the next
          // tick anyway, so there's no fight between the two; if it never
          // fires (no permission/no sensor), this is the only progress the
          // ring ever shows — a synthetic heading sweeping at a steady rate
          // rather than a real one, same honest approximation as before.
          var fallbackTimer = setInterval(function () {
            if (!usingCompass) markCovered(((Date.now() - recStart) / ROTATION_TARGET_MS) * 360);
          }, 300);
          startRecording(mimeType, function (blob) {
            clearInterval(fallbackTimer);
            stopOrientation();
            var b = blob; close(); onDone(b);
          });
        }
      };
    });
  }

  return {
    takePhoto: takePhoto, takeVideo: takeVideo, take360: take360, close: close,
    // Test-only hook — genuinely executes the real coverage-walk function
    // (never a re-description of it) without needing a camera/orientation
    // stack at all, since it's pure.
    _coverageSteps: function (lastBucket, idx, total) { return coverageSteps(lastBucket, idx, total); }
  };
})();
