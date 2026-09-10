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
      '.pp-cap-timer{color:#fff;font-variant-numeric:tabular-nums;font-size:15px;font-weight:700;' +
        'background:rgba(0,0,0,.45);padding:4px 12px;border-radius:999px;display:none;align-items:center;gap:6px;}' +
      '.pp-cap-timer.on{display:flex;}' +
      '.pp-cap-timer .dot{width:8px;height:8px;border-radius:50%;background:#ff3b30;animation:pp-cap-pulse 1s ease-in-out infinite;}' +
      '@keyframes pp-cap-pulse{0%,100%{opacity:1}50%{opacity:.3}}' +
      '.pp-cap-guide{position:absolute;left:0;right:0;top:56px;display:flex;flex-direction:column;align-items:center;' +
        'gap:10px;z-index:2;pointer-events:none;padding:0 20px;text-align:center;}' +
      '.pp-cap-guide-text{color:#fff;font-size:14px;background:rgba(0,0,0,.5);padding:8px 14px;border-radius:10px;max-width:340px;}' +
      '.pp-cap-ring{width:76px;height:76px;border-radius:50%;position:relative;' +
        'background:conic-gradient(#fff var(--pp-cap-pct,0%), rgba(255,255,255,.25) 0);' +
        'display:flex;align-items:center;justify-content:center;}' +
      '.pp-cap-ring::after{content:"";position:absolute;inset:5px;border-radius:50%;background:rgba(0,0,0,.55);}' +
      '.pp-cap-ring span{position:relative;z-index:1;color:#fff;font-weight:700;font-size:13px;}' +
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

  function buildOverlay(opts) {
    ensureStyle();
    var el = document.createElement('div');
    el.className = 'pp-cap-overlay';
    el.innerHTML =
      '<div class="pp-cap-topbar">' +
        '<button type="button" class="pp-cap-close" id="pp-cap-close" title="Close" aria-label="Close">×</button>' +
        '<span class="pp-cap-timer" id="pp-cap-timer"><span class="dot"></span><span id="pp-cap-timertxt">00:00</span></span>' +
        '<span class="pp-cap-side"></span>' +
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
    $('pp-cap-close').onclick = function () { close(); if (opts.onCancel) opts.onCancel(); };

    function attach(s) {
      stream = s;
      videoEl.srcObject = s;
    }

    openStream(mode !== 'photo').then(function (s) {
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
        try { attach(await openStream(mode !== 'photo')); }
        catch (e) { curFacing = curFacing === 'environment' ? 'user' : 'environment'; try { attach(await openStream(mode !== 'photo')); } catch (e2) {} }
      };
      onReady(videoEl);
    }).catch(function (err) {
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
  // Item 3: "provide guides on camera to take the video for processing to
  // 360." A real compass-driven progress ring when the device exposes
  // orientation (iOS 13+ needs an explicit user gesture + permission
  // prompt — DeviceOrientationEvent.requestPermission() — which this
  // function triggers on the FIRST tap of the record button, since it must
  // run inside a user gesture); everywhere else (desktop, a browser that
  // refuses orientation, permission denied) the ring instead advances on a
  // simple elapsed-time estimate for one full slow rotation, so the guide is
  // still there — just a time-based approximation rather than a true compass
  // reading — and the recording itself is never blocked by its absence.
  var ROTATION_TARGET_MS = 18000;   // the elapsed-time fallback's assumed "one slow full turn"
  function requestOrientationPermission() {
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      return DeviceOrientationEvent.requestPermission().then(function (r) { return r === 'granted'; }).catch(function () { return false; });
    }
    return Promise.resolve(!!window.DeviceOrientationEvent);
  }
  function take360(onDone) {
    var guideHTML =
      '<div class="pp-cap-guide">' +
        '<div class="pp-cap-guide-text">Hold the phone level and slowly turn all the way around while recording — try to keep the horizon centred.</div>' +
        '<div class="pp-cap-ring" id="pp-cap-ring"><span id="pp-cap-ringpct">0%</span></div>' +
      '</div>';
    startSession('360', { hint: 'Tap to start recording your 360° walk-around', guideHTML: guideHTML, onCancel: function () { onDone(null); } }, function () {
      var shutter = $('pp-cap-shutter');
      var mimeType = pickMimeType();
      var usingCompass = false, startHeading = null, accumTurned = 0, lastHeading = null;
      var orientHandler = null;
      function setPct(p) {
        p = Math.max(0, Math.min(100, p));
        var ring = $('pp-cap-ring'); if (ring) ring.style.setProperty('--pp-cap-pct', p + '%');
        var lbl = $('pp-cap-ringpct'); if (lbl) lbl.textContent = Math.round(p) + '%';
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
                if (lastHeading != null) {
                  var d = h - lastHeading;
                  if (d > 180) d -= 360; else if (d < -180) d += 360;
                  accumTurned += Math.abs(d);
                }
                lastHeading = h;
                setPct((accumTurned / 360) * 100);
              };
              window.addEventListener('deviceorientationabsolute', orientHandler);
              window.addEventListener('deviceorientation', orientHandler);
            }
          });
          // Elapsed-time fallback runs regardless — if the compass IS
          // reporting, its own accumulated-turn percentage overwrites this
          // on the next tick anyway, so there's no fight between the two;
          // if it never fires (no permission/no sensor), this is the only
          // progress the ring ever shows.
          var fallbackTimer = setInterval(function () {
            if (!usingCompass) setPct(((Date.now() - recStart) / ROTATION_TARGET_MS) * 100);
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

  return { takePhoto: takePhoto, takeVideo: takeVideo, take360: take360, close: close };
})();
