# Module: progress-photos

Developer change log for the **progress-photos** module. Update every PR.

## Gallery markup toggle drops its label; the video→360° pipeline is hardened
## against a mobile OOM/crash rather than just having its own error caught
## (2026-09-12, later same day)

Owner, two items:
```
1. in progress photos gallery, remove text label in view mark-up button. leave icon.
2. the reading and processing video to 360 does not work. app crashes when processing
   please exploit all options to resolve. use additional add-ins or other open-source
   features to resolve
```

### Item 1 — the Gallery "Markup" button is icon-only now

`#pp-mkvistoggle` (the shared show/hide-markup switch on the Gallery's own list bar —
not the lightbox's already-icon-only `#pp-lb-markuptoggle`, which needed no change)
dropped its trailing `Markup</span>` text, leaving `Icons.svg('eye'/'eyeOff', 15)`
alone. `syncMkVisBtn()` (module.js) only ever touches the icon `<span>`'s `innerHTML`
and the button's own `is-active` class — it has no dependency on a text node existing
beside it, so nothing else needed to change.

### Item 2 — the earlier grayscale/accumulation fixes made the ALGORITHM correct;
### this pass addresses the other honest possibility: a real device crash, not a
### thrown error

⚠️⚠️ **A crash is not the same failure as an error, and the same-day earlier entry
above only ever hardens the second one.** `open360Upload()`'s own try/catch around
`Pano360.stitchFromVideo(...)` already turns a *thrown* exception into a toast — but a
mobile browser killing the whole tab for memory pressure, or for one JS task blocking
the main thread long enough to be judged unresponsive, is not a thrown exception at
all. No amount of try/catch around the call site can recover from either, so "exploit
all options" here means removing the two real causes from `pano360.js` itself, not
adding a second catch block.

- ⚠️⚠️ **The per-frame warp loop allocated three full-mosaic-sized buffers per
  frame, with nothing forcing the previous iteration's to be freed first.**
  `stitchFrames`'s old sizing clamped WIDTH and HEIGHT to 8000px *independently*
  (`Math.min(MAX_DIM, ...)` on each) — which still allows a mosaic as large as
  8000×8000, and every one of up to 12 frames allocates a `dstMat` (an OpenCV Mat) PLUS
  a same-sized `<canvas>` (`tmp`) on top of the mosaic canvas already being built —
  three ~256MB buffers per iteration at that ceiling, with no yield point anywhere in
  the loop for the browser's garbage collector to reclaim the last iteration's before
  starting the next. That is a highly plausible, and previously undiagnosed, cause of
  "app crashes when processing" that a caught JS error could never explain.
- **Fixed with a pixel-AREA cap (`MAX_PIXELS = 6,000,000`), not a per-dimension one.**
  The real bounding box is computed exactly as before; if its area would exceed the
  cap, the WHOLE mosaic is scaled down proportionally (never distorted) before being
  drawn — `mat3Scale(scale, scale)` composed into the existing `shift` matrix, so every
  frame's placement scales together rather than each being warped at full size and
  cropped after. `MAX_DIM = 6000` is kept as a per-axis backstop for a pathologically
  long, thin mosaic that could otherwise pass the area check while still running one
  dimension away.
- **A `yieldToUI()` (a `requestAnimationFrame`, falling back to `setTimeout(0)`) is
  now awaited after every frame in BOTH loops** — the homography/RANSAC loop and the
  warp loop. A 12-frame stitch run as one uninterrupted synchronous block is exactly
  the shape a slower phone's browser reads as an unresponsive page; breaking it into
  one browser task per frame keeps the tab responsive AND gives the previous
  iteration's canvases/`cv.Mat`s a real chance to be garbage-collected before the next
  allocation — which is what the memory cap above is actually relying on to hold.
- **A degenerate frame (zero width/height — e.g. the camera never actually started)
  is now refused up front** with a clear message, rather than being handed to
  `cv.imread()` to fail in whatever way an empty canvas fails inside the WASM module.
- ⚠️ **What this does NOT claim to fix**: a genuine WebAssembly abort (Emscripten
  calling `abort()` on an internal invariant violation) is not always a catchable JS
  exception either, and no amount of JS-side hardening can guarantee OpenCV.js itself
  never does this on some device/build combination. The area cap above is the
  strongest available lever against that too, since it directly bounds the size of
  every buffer OpenCV.js is asked to allocate — but it is a mitigation, not a proof.

### Verified

**Genuinely executed against the real, shipped `pano360.js`** (never re-derived from
memory), via a Node `vm` harness with a hand-built OpenCV.js stub modelling the real
Mat/ORB/warpPerspective contract closely enough to run `stitchFrames` to completion:
- A normal 4-frame, modest-resolution mosaic passes through the area/dimension caps
  untouched (well under both).
- **A deliberately runaway case — 12 frames at 3000×2000 each, forced onto the
  no-homography fallback so they simply tile side by side — would bound to
  36000×2000 unclamped; the fix correctly scales it down to exactly 6000×333,
  preserving the 18:1 aspect ratio and landing under both the area and per-axis
  caps.** This is the exact shape of input (many wide frames) that produced the old
  code's ~256MB-per-buffer worst case.
- A frame with zero width/height is refused with the new, clear error message rather
  than reaching `cv.imread()`.
- `requestAnimationFrame` was genuinely invoked (not just present in source) across
  both loops, confirming the yield actually fires per iteration rather than being a
  no-op left over from a copy-paste.
- `mat3Scale` and its composition with the existing `mat3Translate`/`mat3Mul` were
  executed directly and checked against the expected point-transform arithmetic
  (translate-then-scale of a point lands exactly where the two operations predict).

`node --check` clean on `pano360.js`/`module.js`; `tools/wiring-check.js` — **123
passed, 0 failed**, confirming the version bump left no asset on two versions and no
cross-module reference broke.

⚠️ **Not verified against a real device or the real `@techstark/opencv-js` build** —
same standing caveat as every entry in this file: this sandbox has no camera and no
network path to the CDN. What is verified is that the exact shipped sizing/yielding
logic behaves correctly against a faithful model of OpenCV.js's real Mat/warp
contract, not that a real recorded 360° walk-around now stitches without crashing on
a real phone. **The first real recording, on a real device, through this exact code
path, is still the actual end-to-end test** — per the owner's own "exploit all
options" instruction, this pass removed every plausible cause reachable from the
JS/OpenCV.js layer; it cannot rule out a lower-level platform crash this environment
has no way to reproduce.

`pano360.js` → `?v=20260912g`; the shared `MODULE_V` fallback (`assets/js/modules-grid.js`,
`dashboard.html`, `modules.html`) → `20260912g` to match, since this module's `index.html`
itself changed (the markup edit in item 1, plus `pano360.js`'s own `?v=` line).
`module.js`/`module.css`/`capture.js` are unchanged this round and stay at their existing
`?v=` tokens.

## Fourth capture-flow round: the camera view and every topbar button were
## being swallowed by an always-visible "hidden" error box, 360 drops mute
## entirely, and the real reason video-to-360 processing has never worked
## (2026-09-12)

Owner, with four numbered items and "resolve at all cost" on three of them:
```
1. when taking photo, I cant see the camera view. the flash and close button is also not working.
2. when taking video, there seems to be an overlay on the video view. the flash, mute, and close
   buttons are also not working.
3. when taking video for 360, no need for mute, by default this should be mute. the close and
   flash button are also not working.
4. the processing from video to 360 photo is also not working. this has never worked well ever
   since.
```

### ⚠️⚠️ ITEMS 1–3's SHARED ROOT CAUSE: `.pp-cap-error` NEVER ACTUALLY RESPECTED `hidden`

`capture.js`'s overlay markup is `<div class="pp-cap-error" id="pp-cap-error" hidden></div>` —
correct, and the JS never touches that attribute until a real error fires (`showError()`). But its
own stylesheet declared `.pp-cap-error{display:flex; ...; z-index:3; background:rgba(0,0,0,.6)}`
**unconditionally** — a class selector at (0,1,0), the exact same specificity as the browser's own
`[hidden]{display:none}`, and an **author** rule always beats a **UA** rule at equal specificity.
So the box rendered `display:flex` from the very first frame of *every* session — photo, video and
360 alike — regardless of the `hidden` attribute being present and correct the whole time.

⚠️⚠️ **This is the identical defect this app's own `dashboard.css` already found and fixed once, for
`.pd-btn[hidden]`** ("THE `hidden` ATTRIBUTE DID NOT WORK ON ANY `.pd-btn` IN THIS APP, ANYWHERE") —
never generalised, and `capture.js` walked into the exact same shape independently. The box is a
`rgba(0,0,0,.6)` scrim sitting at `z-index:3`, **higher than `.pp-cap-topbar`'s `z-index:2`** — so it
sat over the whole camera preview (which is what "I can't see the camera view" actually was: not a
dark/dim preview, an always-on 60%-black scrim over it) **and** intercepted every click meant for
Close, Flash, and — for video — the mic toggle, since its box overlaps theirs. This is items 1, 2 and
the close/flash half of item 3 in one bug, not three separate ones.

**Fixed the identical way `dashboard.css` fixed its own instance**: `.pp-cap-error[hidden]{display:
none;}` — an attribute-selector override wins purely on specificity (0,2,0 > 0,1,0), so it holds
regardless of source order.

**Verified by genuine execution, not just read** — a throwaway Playwright/Chromium harness (no
network needed; deleted after use) loaded the real, unmodified `capture.js`, called
`Capture.takePhoto()` and checked the DOM **synchronously, before any async `getUserMedia` result
could touch it** (`buildOverlay()` runs synchronously inside `takePhoto`/`takeVideo`/`take360`, only
the camera permission prompt is async):

| | `hidden` attribute present | computed `display` | topmost element at Close's centre | at Flash's centre |
|---|---|---|---|---|
| **pre-fix** (the override rule stripped back out, as a negative control) | true | **`flex`** | `.pp-cap-error` | `.pp-cap-error` |
| **fixed** (shipped) | true | **`none`** | `.pp-cap-close` itself | inside `.pp-cap-flash` itself |

The negative control reproduces the report exactly — both buttons' own clicks land on the invisible
scrim, not the button — and the fix restores both to receiving their own clicks.

### Item 3 — 360 drops the mic toggle entirely, and never requests an audio track

`buildOverlay`'s condition for the mic button was `opts.mode !== 'photo'`, which included **both**
`'video'` and `'360'` — so 360 showed a mute control nobody asked for. Narrowed to
`opts.mode === 'video'` only. `wantsAudioTrack()` — which decides whether `getUserMedia` even
requests an audio track — went from `mode !== 'photo'` to `mode === 'video'`, so a 360 recording
never has an audio track to begin with: "by default this should be mute" is satisfied by there being
nothing to mute, not a forced-off flag layered on top of a track nobody needs.

**Verified by execution**: the same harness confirmed `#pp-cap-audio` exists only when
`Capture.takeVideo()` is the active session (absent for `takePhoto()` and `take360()`), and a stubbed
`getUserMedia` recorded the exact constraints object passed for each mode — `audio:false` for photo,
`audio:true` for video, **`audio:false` for 360**.

### Item 4 — the real reason video→360 stitching has never worked: no grayscale conversion before ORB

⚠️⚠️ **`prevMat`/`curMat` in `homographyBetween` come straight from `cv.imread()` on a `<canvas>` —
which OpenCV.js *always* returns as a 4-channel RGBA `Mat`, never grayscale.** ORB's own
`detectAndCompute` (per OpenCV's C++ implementation, and every OpenCV.js ORB sample, the library's
own official one included) expects a single-channel image and converts internally via
`COLOR_BGR2GRAY` — which asserts/throws on a 4-channel input. `pano360.js` never once called
`cv.cvtColor()` anywhere in the file (`grep` confirms zero occurrences before this fix) — every
OpenCV.js tutorial that reads from a canvas does this conversion as the very next line after
`cv.imread()`, and this file skipped it.

This explains "has never worked well ever since" far better than a tuning problem: on a real device,
this either **throws on the very first frame pair** (surfaced to the planner as "Could not build the
panorama" — every prior changelog entry's "fix" was to the homography-accumulation MATH, which is
correct but moot if `detectAndCompute` never produces a real homography to accumulate in the first
place) or, depending on the build, silently returns zero keypoints — either way, every pair falls
back to the no-homography path (a bare horizontal shift), so what came back was never actually an
aligned mosaic, just frames placed side by side.

**Fix**: `homographyBetween` now converts both frames to grayscale (`cv.cvtColor(prevMat, gray1,
cv.COLOR_RGBA2GRAY, 0)`, same for `curMat`/`gray2`) before handing them to `orb.detectAndCompute` —
the exact extra step every OpenCV.js feature-detection example takes. `prevMat`/`curMat` themselves
are untouched (the caller's own cleanup of them is unaffected); the two new grayscale Mats are
deleted in the function's existing `finally` block alongside everything else.

⚠️ **Not verified against real OpenCV.js or a real video** — this sandbox has no network access to
the CDN (`cdn.jsdelivr.net` is blocked by the environment's egress policy) and no camera, so the real
`@techstark/opencv-js` binary has never been loaded here. What **is** verified, genuinely: a
hand-built stub modelling OpenCV.js's real, documented API surface (`cv.Mat`, `cv.cvtColor`,
`cv.ORB`, `cv.BFMatcher`, `cv.findHomography`, …) was driven against the actual exported test hook
`Pano360._homographyBetween` — the SAME function that ships — with the stub's `detectAndCompute`
modelling the real OpenCV constraint (throws on a non-single-channel image, matching the exact
assertion OpenCV raises):

| | calls made | result |
|---|---|---|
| **pre-fix** (the two `cvtColor` lines reverted back out, as a negative control) | `detectAndCompute` called directly on the 4-channel Mat | **throws** `Assertion failed: image.channels() == 1` — reproducing "processing has been failing" |
| **fixed** (shipped) | `cvtColor` → `cvtColor` → `detectAndCompute` (×2, both on 1-channel Mats) → `knnMatch` → `findHomography` | returns `{matches:6, H:<Mat>}` — a real homography |

This proves the fix changes exactly what it claims to (grayscale conversion happens before feature
detection, and detection succeeds once it does) against a model of the real constraint — it does
**not** prove the real `@techstark/opencv-js` build behaves identically to the stub, or that a real
recorded 360° walk-around now produces a good mosaic. **The first real recording on a real device,
through this exact code path, is still the actual end-to-end test**, and per the owner's own
instruction that is stated plainly here rather than glossed over.

### Verified (whole round)

`node --check` clean on both touched files. `tools/wiring-check.js`: **123 passed, 0 failed** — every
asset reference still resolves and is on one version after the `?v=` bump. No other file's behaviour
was touched — `module.js`'s Add Media / 360-upload flow, and `module.css`, are unchanged.

`capture.js` / `pano360.js` → `?v=20260912c`; the shared `MODULE_V` fallback
(`assets/js/modules-grid.js`, `dashboard.html`, `modules.html`) → `20260912f` to match, since this
module's `index.html` itself changed (its own `?v=` lines).

⚠️ **Not verified signed in or on a real device** — same standing caveat as every capture-flow entry
in this file. The CSS fix and the mode-gating fix are proven by genuine execution against the real,
shipped `capture.js` in a real (if camera-less) Chromium; the stitching fix is proven against a
faithful model of the real OpenCV constraint, not the real library. The camera-view/button-click fix
in particular should be the fastest thing to confirm on a real phone — the previous behaviour was a
permanent, unconditional black scrim over the whole capture screen, which was never testable inside
this sandbox no matter how the harness was built.

## Third capture-flow round: the Add Media modal actually hides its own
## buttons now, a real close-during-recording race fixed, flash on/off/
## auto, a proportional key-plan pin, Pannellum replaces the drag-strip
## viewer, and Hugin ruled out with a reason (2026-09-11)

Owner, off the just-shipped second capture-flow round:
```
1. only 1 photo or video is allowed when adding media. do not allow multiple uploads per add media.
   when a photo or video is already uploaded, the take and upload photo/video/360 should be hidden.
   there should be an X button on the top right of the media preview to remove the upload. once
   removed, the take and upload buttons should reappear
2. when taking video, the mute button and close button is not working. the camera preview also
   seems to be shades darker. provide also button for on/off/auto flash.
3. when photo is opened or in presentation and the key plan is shown, the pin should be
   proportionally smaller. also provide option to drag bottom left corner to resize size of keyplan.
4. when adding 360, stitching of video frames is not good. explore using the open source Hugin to
   stitch frames.
5. viewing of 360 is also not good. use open source Panellum for 360 viewer
6. improve also workflow of uploading 360. once 360 photo is processed, user to use 360 viewer as
   both a preview and to select the thumbnail frame. (for thumbnail, use standard 3:4 landscape
   ratio). no need to have separate preview and thumbnail selector
```

### Item 1 — the single-item cap already existed; hide/show + a remove-× did not

The previous round capped `stagedFiles` at one, but Take/Upload stayed visible and clickable next to
whatever was already staged, and the only way to replace it was to take/choose again (a silent
replace-with-a-toast). `#pp-addbtnsrow` (the Take/Upload row) now hides the instant a file is staged
(`syncAddButtonsRow()`, called from the top of every `renderStagedGrid()`) and each staged card gets
a corner **×** (`.pp-stagermv`, the same fixed-dark-scrim-corner-overlay language as `.pp-cardsel`/
`.pp-mkeditbtn`, mirrored to the opposite corner). Removing it (`removeStaged`) revokes the object
URL, clears any pending markup/adjustments for that index, and re-renders — which is what brings the
row back via the same `syncAddButtonsRow()` call. ⚠️ The auto-replace toast from the previous round
is kept as a defensive fallback (a picker handing back >1 file in one go, or a future regression that
reintroduces `multiple`), but is now unreachable through the UI in the ordinary case, since there's
nothing left to click that could trigger it.

### Item 2 — the real close-during-recording race, a resolution-hint fix for "darker", and flash

⚠️⚠️ **The actual bug, distinct from the getUserMedia race the previous round fixed.** Tapping ×
**while a video was recording** called `close()`, which stops the `MediaRecorder` and fires
`opts.onCancel` → `onDone(null)` immediately — but the recorder's own **async** `'stop'` event still
caught up afterward and ran the callback wired at record-start (`function (blob) { var b = blob;
close(); onDone(b); }`), calling `onDone` a **second** time with a real file. From the planner's
side: the overlay visibly closed, and the recording got added anyway — exactly "I closed it and it
didn't work". Fixed by threading the SAME `stale()` guard the getUserMedia race already established
through to every caller (`startSession` now hands `onReady(videoEl, stale)`): `close()` bumps the
module's `sessionToken` as its very first action, so by the time the delayed `onstop` fires, `stale()`
correctly reports "something already closed this session" and the stray `onDone` is skipped. The
ordinary completion path (tapping the shutter a SECOND time, nobody closed anything) checks `stale()`
too, and correctly still fires — `close()` there is called from *inside* that same callback, after the
check, not before it. `takePhoto`'s async `canvas.toBlob` callback gets the identical guard for the
same reason (a tap on × between the shutter press and the callback firing is the same race, one step
earlier).

**"Camera preview seems shades darker"** — `openStream()` now requests `width:{ideal:1920},
height:{ideal:1080}` instead of no resolution hint at all. ⚠️ With no hint, some phone browsers fall
back to a lower-resolution/binned sensor profile whose default auto-exposure reads dimmer than the
same device's native camera app; asking for a proper HD frame (never a hard `min`/exact constraint, so
a device that can't provide it isn't refused) is a real, if partial, answer — it cannot fully close the
gap between a browser's `getUserMedia` pipeline and a native camera app's own exposure/AE tuning, and
this is stated rather than oversold.

**Flash on/off/auto**, a new `.pp-cap-flash` button joining the mic toggle in one right-side cluster
(`.pp-cap-rightcluster`), offered for every mode (photo included — flash isn't audio-specific the way
the mic toggle is). ⚠️⚠️ **"Auto" is a labelled degrade, not a real third mode.** The W3C Image
Capture spec's `torch` capability on a live `MediaStreamTrack` is a plain on/off switch — there is no
platform API for a continuously auto-decided flash the way a native camera app has — so `flashMode:
'auto'` applies `torch:false`, exactly like `'off'`, and the button's own tooltip says so rather than
silently pretending to work like a real auto-flash. `applyFlash()` re-checks the live video track's
own `getCapabilities().torch` on every attach (initial open AND after a camera flip — a front camera
commonly has no torch at all even when the rear one does) and disables the button entirely, with a
named reason, when the capability is absent — the same "never a control that looks live but does
nothing" convention `syncAudioBtn` already follows.

### Item 3 — the key-plan pin, made proportional (the drag-to-resize handle already existed)

⚠️ **Half of this item was already shipped** — both the lightbox's (`#pp-lb-keyplan-resize`) and the
presentation pane's (`.ppr-kpoverlay-resize`) bottom-left drag-to-resize handles were built in earlier
rounds (`kpResizeFrac`/`wireLightboxKpResizeDrag`, `wireKpResizeDrag`) — confirmed present before
touching anything, not re-built. What was missing: `.pp-kpmini-pin` (the shared small marker both
callers draw, via `BIM.keyPlanMiniMarkerHTML`) was a **fixed 16px** dot regardless of how big the
overlay itself was drawn — the overlay ranges 6%–60% of the photo's own width and is now
drag-resizable, so a fixed pin read as oversized at the common small end of that range and
increasingly wrong-sized as the overlay grew. `.pp-kpmini-pin` is now sized as a **percentage of its
own containing block** (`width:10%`, `aspect-ratio:1` deriving the height from the resolved width,
rather than a percentage `height`, which cannot reliably resolve against an absolutely-positioned
parent whose own height is auto) — it now scales automatically with every resize, live, with no JS
repaint required. The icon glyph inside (`Icons.svg(...,9)`, a fixed 9px SVG) is overridden to `width:
60%; height:60%` so it shrinks/grows in step with the pin rather than staying a constant size inside
one that now ranges 8px–20px.

### Item 4 — Hugin: investigated, and ruled out for a stated reason, not a preference

⚠️⚠️ Hugin is a native, desktop C++ application (wxWidgets UI, `nona`/`enblend`/`align_image_stack`
under the hood) with **no WebAssembly build and no JS bindings anywhere** — there is nothing to load
into a browser tab. Integrating it would mean standing up a server that runs Hugin's own binaries, a
different architecture from this module's "all processing happens client-side" design and a
materially larger undertaking than this pass's scope. Documented plainly in `pano360.js`'s own header
rather than silently left unaddressed. What IS done instead: **seam feathering**, a real, verifiable
quality improvement inside the existing OpenCV.js-primitives pipeline, targeting the specific defect a
from-scratch stitcher (this one, and the one it replaced) is prone to that a tool like Hugin's
`enblend` exists to fix — a visible hard edge where one frame's contribution stops and the next one's
starts.

⚠️⚠️ **The compositing loop drew every warped frame at full opacity and let `'destination-over'`
decide, per pixel, which one whole frame wins in an overlap** — a hard cut at the exact boundary
between two source images. New `featheredFrame(canvas, featherLeft, featherRight, marginFrac)` fades a
frame's own left/right edges to transparent (via a linear-gradient mask + `'destination-in'`) before
it's warped and drawn; every frame is then painted in order with plain `'source-over'`, so a later
frame's feathered edge blends smoothly into whatever the mosaic already has instead of snapping to it.
⚠️ **The very first frame's LEFT edge and the very last frame's RIGHT edge are never feathered** —
there is nothing on the far side of the mosaic for that particular edge to blend into, and fading it
would leave a transparent void at the panorama's own extremity rather than a seam. ⚠️ Feature matching
(`homographyBetween`, via `rawMats`) still runs against the **pristine** frames — feathering is applied
only to a separate copy used for the final draw, never to what ORB/BFMatcher see, so the alignment
math is completely unaffected by this change.

### Item 5 — Pannellum replaces the drag-to-pan strip, for both the saved-photo viewer and the upload preview

New pinned-version CDN tags (`pannellum.min.js`/`pannellum.min.css`, cdnjs — matching this page's own
established "one pinned `<script>` tag, no build step" convention for html2pdf.js/pptxgenjs/
opencv-js). New shared `mountPannellumViewer(container, imageUrl, heightOverWidth)` (module.js),
used by BOTH the saved-360°-photo lightbox and the 360°-upload preview, so the two can never
independently drift in how they configure the same library — replacing `wireDragPan`/`wirePanoDrag`
(both **deleted**, not left dormant; a second panorama viewer is exactly the kind of drift this
module's own history warns about).

⚠️⚠️ **Our stitched mosaic is a cylindrical panorama (pano360.js's own header), not a true
equirectangular sphere.** Pannellum's `'equirectangular'` viewer type still handles this correctly for
a **partial** panorama via its own documented `haov`/`vaov` config — exactly the mechanism it offers
for an image that doesn't cover the full sphere. `haov: 360` assumes the capture guide's own
instruction (a full walk-around) was followed; `vaov` is derived from the image's own real aspect
ratio (`360 * height/width`, clamped to `[20,140]`), read off the lightbox's own thumbnail stand-in
`<img>` once it's decoded (`naturalWidth`/`naturalHeight`) for the saved-photo path, and off
`stitchResult.width/height` for the fresh-upload path — never a guessed constant.

- **Lightbox**: `#pp-lb-pano-standin` (a plain `<img>`, the instant thumbnail stand-in, matching the
  ordinary-photo path) sits beside `#pp-lb-pano-viewer` (the Pannellum mount target) inside
  `.pp-lb-panowrap`. `teardownLbPano()` runs at the START of every `paintLightbox()` call
  (idempotent), so stepping ←/→ between two 360 photos, or from a 360 photo to any other kind, can
  never leave a stale viewer instance running behind what's now shown; it also runs on
  `closeLightbox()`.
- ⚠️⚠️ **The key-plan cone still follows wherever the viewer is looking, via a polling loop, not a
  scroll event.** Pannellum's stable API has no subscribable "view changed" event, so
  `startPanoYawPoll(viewer, onYawChange)` reads `viewer.getYaw()` once per animation frame — but only
  calls the DOM-touching callback when the yaw **actually changed** since the last tick, the same
  "dirty flag, never an unconditional repaint" discipline the earlier `wirePanoDrag` rAF-coalescing
  fix already established for this exact cone repaint. An idle, unmoved view costs one cheap getter
  read per frame, nothing more.
- **Adjustments (exposure/brightness/contrast)** now apply as a CSS `filter` to the whole panorama
  **wrap** (`panoWrap`) rather than the retired `<img>` — a CSS filter composites everything rendered
  inside an element, WebGL canvas included, so this reaches the Pannellum viewer exactly as it did the
  old `<img>`, with no change to `cssFilterFor`/`adjustmentsOf` themselves.
- **The 360°-upload preview** (`#pp360-panowrap`/`#pp360-pano-viewer`) reuses the identical
  `.pp-lb-panowrap`/`.pp-lb-panoviewer` pair, sized down via the existing `#pp360-panowrap` id
  override (240px, unchanged from the previous round's own fixed modal-appropriate height).

### Item 6 — the 360° upload workflow: the viewer IS the thumbnail selector now

The separate "Thumbnail frame" scrubber (`#pp360-repslider`/`#pp360-repframe`, driven by
`Pano360.extractFrameAt` against the ORIGINAL VIDEO) is **gone**. A new **"Use this view as
thumbnail"** button (`#pp360-usethumb`) captures whatever the Pannellum viewer is **currently
rendering** — the same interactive preview the planner is already looking around in — via a new
shared `captureViewerThumbnail(containerEl, cb)`. ⚠️ A default thumbnail is captured automatically the
first time the panorama actually renders (`pp360Viewer.on('load', ...)`), so Save is never blocked on
remembering to press the button; pressing it again at any point updates the thumbnail to whatever's
currently on screen. `setThumbFromBlob()` is the one place that updates `repBlob`/`repUrl`/the preview
`<img>`, shared by both the automatic capture and the manual button, so the two can never disagree
about what "updating the thumbnail" means.

⚠️⚠️ **"Standard 3:4 landscape ratio" is self-contradictory** — 3:4 is a **portrait** ratio (narrower
than tall). Read as the standard **4:3 landscape** ratio the word "landscape" actually names, since a
thumbnail cropped from a landscape panorama view has no sensible reason to come out portrait-shaped;
`THUMB_ASPECT = 4/3` is a named constant with this reasoning in its own comment, not a silent guess.
`captureViewerThumbnail` reads the Pannellum viewer's own `<canvas>` (`containerEl.querySelector
('canvas')`), centre-crops it to that ratio, downsizes to a fixed 640×480 output, and hands back a
real JPEG Blob — degrading to `null` (never throwing) if the viewer hasn't rendered a canvas yet.
⚠️ `Pano360.extractFrameAt`/`getDuration` are left in `pano360.js`, unchanged — they're generic,
still-exported public utilities (grab a frame from a video at time T), not orphaned implementation
detail; removing them would be speculative cleanup unrelated to what this item asked for.

### Verified

**897 passed, 0 failed** (up from 875) — every item above covered by genuine execution, not only
structural reads: `startPanoYawPoll`'s dirty-check against a real, queue-based rAF stub (an unchanged
yaw between two ticks fires nothing; a changed one fires with the new value; `stop()` genuinely halts
further callbacks); `mountPannellumViewer` against an injected `window.pannellum` stub (the real
`pannellum.viewer(...)` call, its `haov`/`vaov` config including the clamp on an extreme aspect ratio,
auto-generating a container id, and degrading to `null` when the library itself is unavailable);
`captureViewerThumbnail` against a fake canvas-bearing container (a real 640×480 JPEG Blob out, `null`
when no canvas exists yet); the close-during-recording race — a fake, controllable `MediaRecorder`
proves closing mid-recording fires `onCancel` with `null` exactly once and the recorder's own delayed
`onstop` is silently skipped afterward, **and** the inverse case (stopping via the shutter, nobody
closed anything) still hands back the real blob, so the fix doesn't overcorrect into swallowing a
genuine completion; the flash button's full off→on→auto→off cycle against a torch-capable fake video
track (the exact `applyConstraints` calls asserted, including that "auto" applies `torch:false`) and
the disabled state against a track with no torch capability at all; `featherStops`' clamp (an ordinary
frame gets a plain 12% margin, a very narrow frame's margin is clamped to half its own width so the
two edge gradients can never overlap/invert, a tiny frame still gets a 4px floor).

`node --check` clean on `module.js`/`capture.js`/`pano360.js`/`test.js`; 0 NUL bytes across every
touched file; CSS braces balanced (540/540); 0 duplicate DOM ids in `index.html` (90 unique).

⚠️ **Not verified signed in or on a real device** — same standing caveat as every entry in this file.
In particular: Pannellum has never been loaded in a real browser here (no network access to the CDN
in this environment, and no live camera/WebGL stack) — its config keys (`haov`/`vaov`/`type`) and
method names (`getYaw`, `on('load', ...)`, `destroy`) are used per its documented public API and
covered here only by genuine execution against an injected stub, never against the real library; the
close-during-recording race and the flash button are proven against fake `MediaRecorder`/
`MediaStreamTrack` objects, never a real camera; and the "camera preview shades darker" fix is a
resolution hint whose actual effect on real device auto-exposure has not been observed.

`module.js`/`capture.js`/`pano360.js` → `?v=20260912b`; `module.css` → `?v=20260912b`; the shared
`MODULE_V` fallback (`assets/js/modules-grid.js`, `dashboard.html`, `modules.html`) → `20260912b` to
match, since this module's `index.html` itself changed (new CDN tags, new markup). `bim.js`/`ppr.js`
are untouched and stay at their existing `?v=20260912a` from the concurrent session's own merge.

⚠️ **Rebased onto `origin/main` on 2026-09-12 after PR #80 (which carried this round's earlier
commits) had already merged.** A concurrent session's own work — the retirement of `pano.js`/
`recon.js` in favour of `capture.js`/`pano360.js`, and this same day's PDF/PPTX/HTML export QA
passes recorded below — had already landed on `main` in the meantime. `capture.js`, `pano360.js`
and `module.js` auto-merged cleanly (the two threads touched different regions of each file); the
only real collisions were cache-bust version-string and changelog-prepend seams, resolved per this
file's own standing rule for that exact shape: take the union, never pick a side, and bump every
touched asset's `?v=` past whichever token either side already held.
> ⚠️ **Merge note (2026-09-12):** two independent sessions had each prepended their own new
> entries above the same shared history at once — this branch's HTML/PDF/PPTX export overhaul
> (below) and a concurrent session's capture-flow work already landed on `main` (Add Media,
> mic toggle, 360° stitching, gallery tile sizing — the block starting at "Second capture-flow
> round"). Resolved as the union, per this file's own established convention for this exact
> collision shape: **both sides' entries kept whole**, none dropped, none duplicated.

## Final HTML/PDF QA pass — the upper-left red square removed, the colored photo
## markers confirmed as QA-fixture-only, and a real 1px page-bleed sliver found
## and fixed (2026-09-11, later still)

Owner's ask, explicit: this is a **minor refinement, not a redesign**, against the already-
close-to-template HTML/PDF format. Nine items — remove the small red-corner header element,
confirm whether the colored markers visible in the sample photos are export-generated or
embedded in the QA test images, small readability tweaks only, footer/spacing verification,
preserve photo layout, preserve the Thank You page, preserve every other approved behavior,
fresh live UI testing of both report types with real generated PDF bytes, and a full
deliverables list. Findings and fixes below, in the owner's own order.

### 1. Upper-left red square — removed from HTML/PDF only, PPTX/template untouched

The small red rounded-corner header strip (`content-header-strip.jpg`, a cropped slice of the
template's own `image3.jpeg`, shipped in an earlier round) is now **never rendered** in the
HTML/PDF header. `CONTENT_HEADER_STRIP_PATH`/`contentHeaderStripDataUrl()` (ppr.js) and
`DL_CONTENT_HEADER_STRIP_PATH`/`dlContentHeaderStripDataUrl()` (module.js) are removed
entirely; `slidesBodyHTML()`/`dlBodyHTML()` dropped the `headerStrip` parameter and no longer
emit `<img class="hdrstrip">`/`<img class="dl-hdrstrip">`. The `.hdrstrip` CSS rule is removed
from `EXPORT_CSS`/`DL_CSS`, and `header .hdrbody`'s padding widened (`10px 22px 12px` →
`18px 22px 14px`) to use the vertical space the strip's removal freed, rather than leaving a
gap. ⚠️ **Nothing was added in its place** — no new shape, no new color, per the owner's
explicit constraint. The header now reads: Megawide logo (footer) + red accent (footer
divider) + report-type label + Project Name/Description/Meeting Date — exactly the "sufficient
branding without the square" the owner named.
- ⚠️ **The asset file itself (`assets/branding/content-header-strip.jpg`) is left on disk,
  untouched** — only the code that loaded/rendered it was removed, per the owner's own
  "do not modify the original PPT template" instruction (the file is a crop of the template's
  own artwork, not something to delete on a UI-only ask).
- **PPTX export is completely untouched** — `logoDataUrl()`/`taglineDataUrl()`/
  `coverPanelDataUrl()` (the PPTX-only asset loaders) were never touched; confirmed by re-
  reading `exportPptx()`/`exportSelectedPptx()` end to end — neither references
  `contentHeaderStripDataUrl` at all, so there was nothing to remove there in the first place.

### 2. Colored photo markers — confirmed embedded in the QA test images only, not export code

Inspected both the actual test-image files and every line of export CSS/JS that touches a
photo's container (`.ph`/`.dl-phwrap img`, `im()`/`dlFigureHTML()`). **Confirmed: the red/
orange/magenta squares and stripes visible near photo edges in every sample this session has
generated are baked into the PIXELS of the two throwaway QA fixtures**
(`_qa_pdftest_landscape.jpg`/`_qa_pdftest_portrait.jpg`, my own PowerShell/System.Drawing-
generated test photos carrying a deliberate colored corner square + edge stripe + diagonal
pattern, made specifically so cropping/orientation/positioning bugs would be visually
unmistakable in a decoded PDF). No CSS rule, no canvas draw call, no photo-container markup
anywhere in `ppr.js`/`module.js` adds color, a border, or any overlay to a photo — `im()`/
`dlFigureHTML()` only ever embed the real photo's own `data:` URI inside `object-fit:contain`,
untouched. **A real, actual uploaded project photo will render exactly as captured, with no
added markers of any kind.**

### 3. Readability — reviewed at 100% PDF zoom; no changes needed this round

Re-checked every field the owner named (Project name, Description, Report type, Meeting date,
Tower/floor info, Previous/Current labels, photo dates/descriptions) against the real decoded
page-1 JPEG at native resolution. All of it was already sized/weighted correctly from the
2026-09-11 (earlier) visual-refinement pass — `h1` 21px, header meta 13px, `.loc` 13px (largest
of the three caption lines), `.d`/`.t` at their existing sizes. ⚠️ **No font-size/weight/
contrast change was made this round** — nothing read as hard to read at 100% zoom against the
freshly regenerated PDFs, so no "major typography redesign" risk was taken for a problem that
wasn't found.

### 4. Footer/spacing — re-verified against the template, unchanged

Footer position/content (logo + "Generated …" bottom-left, tagline + red divider bottom-right),
bottom margin, and its presence on every content page **and** the Thank You page were all
re-confirmed unchanged from the prior round's fix (the `.pagegroup`/footer-per-page mechanism).
The divider was not made thicker or more prominent — no change was needed or made here.

### 5. Photo layout — unchanged, re-confirmed

Max 2 photos/page, Previous/Current side-by-side with equal `1fr 1fr` columns, full visibility
via `object-fit:contain` (no cropping/distortion), portrait and landscape both supported,
captions aligned — all untouched by this round's changes and re-confirmed live (see Verified,
below). Photo sizing (`.phwrap{padding-top:78%}`) was not reduced.

### 6. Thank You page — unchanged, re-confirmed

Vertical balance, logo size, heading position, footer alignment all untouched from the prior
round's fix; no new graphics/icons/colors/shadows were added.

### 7. Everything else — confirmed untouched

PPTX export, the original PPT template, report-type logic, Internal/Client labels, the earlier
PDF-pagination fix, A4 landscape, the current footer implementation, current photo sizing,
Previous/Current arrangement, no-cropping/no-distortion behavior, and the Thank You page
structure are all unmodified by this round — confirmed by diff, not just by not having
intentionally edited those functions.

### A real, previously-undiscovered bug found and fixed in the course of this pass: a 1px
### page-bleed sliver at the bottom of the content page

Re-verifying against fresh, real generated PDF bytes (per the owner's own explicit instruction
to check actual bytes, not an HTML proxy) surfaced a genuine defect the prior round's own
"negligible, checked directly" note had underrated: a 1-canvas-px reddish sliver of the NEXT
page's top border bleeding across the page-slice boundary, visible at the very bottom edge of
the content page's decoded JPEG.

⚠️ **Root cause: html2pdf.js's own `toPdf()` canvas-slicing formula and its pagebreak-CSS
plugin's page-height formula are TWO DIFFERENT FORMULAS that can disagree by a rounding
pixel.** `toPdf()` slices the canvas at `Math.floor(canvas.width * pageSize.inner.ratio)` —
computed from the REAL, html2canvas-captured canvas width — while the pagebreak plugin (and
this file's own `pdfPageHeightPx()`) compute a page's height from a fixed mm→px conversion,
independent of the actual captured canvas width. The two formulas' results are usually
identical, but a small, real discrepancy (the captured canvas came out 2126px wide, not the
2124px `pdfPageWidthPx()` assumes — almost certainly a 1px border overflowing on each side
under content-box sizing) meant `layoutPagegroups()`'s own page-push math (inherited, unchanged,
from `avoidFirstSlidePageSplit()`) was pushing each `.pagegroup` to a boundary that didn't
exactly match where `toPdf()` itself would actually cut the page.
- **First fix attempt — generalizing `avoidFirstSlidePageSplit` into `layoutPagegroups()`
  (computing every page-to-page push in JS, from one canonical formula, for every `.pagegroup`
  rather than just the first) — did NOT eliminate the bleed.** Re-tested via the same live
  harness, pixel-sampled the regenerated PDF's decoded page-1 JPEG bottom row: the identical
  `rgb(204,63,53)` red sliver at y=1466, unchanged. Confirmed the root cause above by measuring
  the real captured canvas width (2126px) against the assumed constant (2124px) directly.
- **The fix that actually works: a small explicit safety margin.** `PAGE_BOUNDARY_SAFETY_PX = 3`
  (ppr.js) / `DL_PAGE_BOUNDARY_SAFETY_PX = 3` (module.js) — 3 design-px (6 canvas-px at scale:2)
  added to every computed page-push, on top of the canonical-formula math. Re-verified: every
  bottom row of the regenerated page-1 JPEG is now clean white with no bleed at all, while page
  count stays at exactly 2 (page 2's own height grew by exactly +6 canvas-px, +3 design-px×2 —
  precisely the expected effect of the safety margin, no new page created).
- New PDF-capture-only CSS override (`EXPORT_PDF_CSS`/`DL_PDF_CSS`,
  `.pagegroup{page-break-after:auto!important;break-after:auto!important}`) neutralizes the
  shared `.pagegroup:not(:last-of-type){page-break-after:always}` rule **only inside the
  off-screen PDF-capture `<style>` tag** — the shared rule itself is deliberately left
  untouched in `EXPORT_CSS`/`DL_CSS`, since it's still correct and needed for a real browser
  printing the saved standalone HTML file; only html2pdf's own JS-based page-break detection
  needed neutralizing, replaced entirely by `layoutPagegroups()`'s/`layoutDlPagegroups()`'s own
  JS-computed pushes during PDF capture specifically.

### Verified — fresh live exports through the real app UI, both report types, real generated PDF bytes decoded

Same stub-auth-harness convention as every round this session (real, unmodified `module.js`/
`ppr.js`, real pinned CDN `html2pdf.js@0.10.1`, harness deleted after use). Drove Internal AND
Client presentations through the real UI end to end, decoded the real generated PDF/HTML bytes
directly (not an HTML screenshot proxy):
- **Both PDFs: exactly 2 pages** (`/Count 2`), A4 landscape `/MediaBox` on both pages —
  pagination fix intact.
- **No red square anywhere in the header** — confirmed by opening the real decoded page-1 JPEG
  for both report types.
- **No bleed sliver** — every bottom row of both content pages' decoded JPEGs sampled and
  confirmed clean white, for both Internal and Client.
- **Report-type labels correct**: Internal → "PPR MEETING", Client → "CLIENT COORDINATION
  MEETING", both confirmed in the decoded page-1 image.
- **Photo markers confirmed QA-fixture-only** — visible strictly inside the two colored photo
  boxes in the decoded images, never in the page header/chrome, for both report types.
- **No cropping/distortion, Previous/Current still equal side-by-side columns** — both photos'
  own edge markers render fully intact in both decoded page-1 JPEGs.
- **Footer present on the content page and the Thank You page**, correct for both report types.
- **Project name, description, meeting date all correct** in the decoded content.
- **Thank You remains the final page** for both report types (page 2 of 2), confirmed via
  dimension/pixel sampling (Internal's Thank You page visually extracted and reviewed directly;
  Client's Thank You page dimension/bleed-checked, matching Internal's).
- **The reconstructed standalone HTML export** (from the real `Download → HTML` blob, base64/
  text round-tripped byte-for-byte) confirmed via direct grep of the reconstructed file: 0
  occurrences of `hdrstrip` anywhere, exactly 2 `<footer>` elements (one per pagegroup), exactly
  2 `.pagegroup` elements, correct `<h1>`/report-type text, and both `.pair figure` elements
  measuring identical widths in a live DOM check — matching the PDF layout.

`ppr.js`/`module.js`/`index.html` → `?v=20260911c`. **Not committed** — kept in the working
tree per the owner's explicit instruction. Scratch harness files
(`_qa_pdftest_harness.html`, `_qa_pdftest_landscape.jpg`, `_qa_pdftest_portrait.jpg`) deleted
before finishing.

## HTML/PDF visual refinement pass — footer on every page, tighter typography
## hierarchy, slightly bigger photos, a better-balanced Thank You page
## (2026-09-11, later same day)

Owner's ask, explicit and narrow: functional behavior (branding, A4 landscape, Previous/
Current side-by-side, max 2 photos/page, no-distortion, the pagination fix, Thank You page)
was already accepted — this is a visual polish pass only, against the real Slide 2 template.
Five items named; findings below, before touching anything.

### What was actually present, checked first

1. **Footer only on Thank You — CONFIRMED, real gap.** `slidesBodyHTML()`/`dlBodyHTML()` built
   exactly ONE `<footer>`, positioned once after every slide including Thank You — since it's
   the LAST element in the whole flowed document, it only ever lands on the final physical
   page. A content/progress-photo page had no footer at all.
2. **Typography hierarchy — present, flagged as MINOR in the last QA round too.** Title (19px)
   vs. meta text (12.5px) was only a ~1.5× jump, and `.loc` (12px) sat smaller than `.d` (13px)
   despite being the line a planner actually orients from.
3. **Photo sizing — real, deliberate headroom, not a bug.** `.phwrap{padding-top:75%}` was a
   real design choice from the pagination-fix pass, chosen conservatively to guarantee the
   page-count fix held; there was genuine room to give photos slightly more of the page now
   that the layout is understood precisely.
4. **Top-left red corner — CHECKED, found to ALREADY MATCH, no change made.** Re-cropped the
   template's own `image3.jpeg` fresh (top 11.067%, the documented `srcRect b="88933"`) and
   diff'd it pixel-for-pixel against the shipped `content-header-strip.jpg` asset: avg diff
   0.08/255 (pure JPEG re-encoding noise), max 39 at one edge pixel. The shipped asset **is**
   the template's own artwork, unaltered — nothing to fix here.
5. **Thank You balance — real, and worse than it looked.** The card's own content (logo,
   heading, subtext) occupied only ~54% of the physical page's printable height once decoded
   from a real generated PDF (jsPDF draws a "short" last page's image at its own proportional
   height, never stretched to fill the page — so the blank gap is real page area, not visible
   in a plain content screenshot). Confirmed by decoding a real PDF's own embedded JPEG and
   computing `pageHeight(mm) = sliceHeightPx × innerWidthMM / canvasWidthPx` directly from
   `toPdf()`'s own formula, not guessed.

### The fixes

- **Item 1**: `.pagegroup` now wraps each `.slide`/`.dl-slide` together with its OWN
  `footerHTML()`/`dlFooterHTML()` call — the footer is a real sibling of the slide (never
  nested inside its bordered card, so it keeps the exact "full-bleed bar below the card" look
  already established for Thank You), and the avoid+after page-break rules moved from `.slide`
  onto `.pagegroup` (the whole page unit), since that's the element that needs to stay
  together and force the NEXT page now. ⚠️ `avoidFirstSlidePageSplit()`/
  `avoidFirstDlSlidePageSplit()` (the html2pdf pagebreak-bug fix from the entry above) were
  updated to guard `.pagegroup`, not bare `.slide` — same technique, same reasoning, just
  targeting the new wrapper.
- **Item 2**: `h1` 19px→21px, header meta text 12.5px→13px, `.loc` 12px→13px (now the largest
  of the three caption lines, matching its actual role) — paired with tighter padding
  elsewhere (see item 3) so the header block is, net, slightly SHORTER despite bigger type.
- **Item 3**: `.phwrap{padding-top:75%→78%}` — a real but modest increase ("slightly more,"
  not a redesign). Chrome tightened to make room: slide padding 14px→12/14px, slide
  margin-bottom 16px→10px, header padding 14/22/16→10/22/12, footer padding 16px→10px
  vertical. Both grid columns stay the identical `1fr 1fr` track (unchanged) — still
  guaranteed equal width, captions still align.
- **Item 4**: no change — see the finding above.
- **Item 5**: `.slide.thankyou` gained `min-height:420px` and switched from padding-only
  centering to `display:flex;flex-direction:column;align-items:center;justify-content:center`
  — the same logo/heading/subtext group, just given more of the physical page and centered
  within it, per the owner's own explicit allowance. Logo 40px→48px, heading 30px→34px. No new
  decorative element was added.

### Verified — fresh live exports through the real app UI, both report types, real PDF bytes decoded

Same stub-auth-harness convention as every round. Drove Internal AND Client presentations
through the real UI end to end (New Presentation → Add Slide with a real landscape+portrait
pair, each carrying its own edge-marker stripe so cropping would be visually unmistakable →
Download → PDF), then decoded the REAL generated PDF bytes (not the HTML proxy):

- **Both PDFs: exactly 2 pages**, `/Count 2`, A4 landscape `/MediaBox` — pagination fix intact.
- **Footer present on the content page now**, confirmed by opening the real decoded page-1
  JPEG: Megawide logo + "Generated …" bottom-left, tagline + red divider bottom-right —
  identical treatment to the (unchanged) Thank You footer.
- **Thank You page real height grew from ~797 to ~1073 canvas-px** (of a ~1468 one-page
  budget) — printable coverage up from ~54% to ~73%, a real, measured reduction in blank
  space, not just "looks a bit different."
- **No cropping, no distortion**: both photos' own edge-marker stripes render fully intact at
  the right edge of their frame in the decoded page-1 JPEG, for both report types.
- **Report-type labels correct**: Internal → "PPR MEETING", Client → "CLIENT COORDINATION
  MEETING" — both confirmed in the real decoded content-page image.
- **Equal columns confirmed numerically**, not just by eye: `getBoundingClientRect()` on both
  `.pair figure` elements in the real generated standalone HTML reports **550.2px** for both —
  identical.
- ⚠️ A 1px reddish sliver was found at the very bottom edge of the content page's own decoded
  JPEG (checked directly, pixel by pixel) — the anti-aliased top edge of the NEXT page's
  `border-top` bleeding across the page-slice boundary by under one canvas pixel. Confirmed
  negligible (a single row out of 1467) and not a real visual defect.

`ppr.js`/`module.js`/`index.html` → `?v=20260911a`. **Not committed** — kept in the working
tree per the owner's explicit instruction.

## PDF export: a real html2pdf.js@0.10.1 library bug turned a 2-page report into
## 4 pages — plus a second, previously-unverified cropping bug found and fixed
## in the same pass (2026-09-11)

The prior round's live PDF QA measured **4 physical pages instead of 2** for a presentation
with 1 content slide + Thank You. Owner asked for the exact root cause and a fix, with a
specific structural requirement: one presentation slide/section must never be unnecessarily
split across physical PDF pages, and no unnecessary blank/duplicated page.

### Root cause #1 — a real defect in html2pdf.js's OWN pagebreak-CSS plugin, not this file

Traced directly into the pinned library's actual (non-minified) source
(`src/plugin/pagebreaks.js`, fetched from `cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/
html2pdf.js`) rather than guessed from behaviour. That plugin walks every element once, and
for each one computes three rules — `avoid` (from our `.slide{page-break-inside:avoid}`),
`before` (only set true if `avoid` finds the element straddling a page boundary in its
CURRENT, un-padded position) and `after` (from our `.slide:not(:last-of-type){page-break-
after:always}`) — from a **single `getBoundingClientRect()` snapshot** taken once per element.
When ONE element ends up with **both** `before` (from the avoid-straddle check) and `after`
(from being non-last) true at once — exactly the shape of a lone content slide, which is
simultaneously "first" (nothing yet pushed it to a page top, so tall header content can make
it straddle) and "non-last" (Thank You follows it) — the plugin inserts BOTH a `before`
padding div AND an `after` padding div, and the `after` div's height is computed from the
SAME stale, pre-push clientRect the `before` div has already invalidated — a second padding
div roughly a full page too tall, consuming an entire extra blank page. ⚠️ **Reproduced
directly, not inferred**: built a throwaway page loading the real pinned library, fed it the
real `EXPORT_CSS` + realistic slide markup, and swept the header height — whenever the
content slide's raw (un-padded) position straddled a page boundary, the plugin inserted a
~720px "after" pad where ~3px was correct, turning 2 pages into 4, at exactly the header
heights that reproduce the reported symptom. This is a defect in the library's own plugin —
real browsers' native print engines handle the identical `avoid`+`after` CSS combination
correctly; html2pdf's JS approximation of it does not.

**Fix**: new `avoidFirstSlidePageSplit()` (ppr.js) / `avoidFirstDlSlidePageSplit()`
(module.js) measure the real off-screen `wrap`'s first `.slide`/`.dl-slide` — in plain JS,
before html2pdf ever runs — and, only if it would actually straddle a page boundary, insert a
precisely-sized spacer div before it. Every slide **after** the first is already guaranteed
to start exactly at a fresh page's top (pushed there by the PRECEDING slide's own,
unconflicted `after` pad), so only the first slide (sitting right after an arbitrary-height
header, with no such guarantee) ever needs this. Once it's pre-positioned, the plugin's own
`avoid` check finds nothing to do, so it never combines with `after` on the same element —
the bug's precondition is eliminated at the root. ⚠️ **`EXPORT_CSS`/`DL_CSS` are completely
untouched** — `avoid`/`after` stay exactly as they were, since both are correct and still
needed for a real browser printing the saved offline HTML file directly; only `exportPdf()`/
`exportSelectedPdf()`'s own JS gained the guard.

### Root cause #2 — found DURING verification of fix #1, not asked for, but real: the
### rightmost ~10% of every PDF page was silently cropped

⚠️ **This was never actually verified before** — every prior round's "PDF looks right" claim
was checked against the *live HTML render* at the PDF's own capture width (a disclosed proxy,
since no PDF viewer exists in this environment), never against the real rasterized PDF
pixels. This round, a fresh PDF's raw bytes were decoded (the embedded JPEG extracted
byte-for-byte and opened with `System.Drawing`) for the first time — and it showed a wide
flat-`#F4F4F4` gutter down the right ~10% of the page, cutting off part of the "Current"
photo, the footer tagline, and the header strip's right edge.

Root cause: html2pdf's own off-screen `container` element (which it creates and is what
`html2canvas` actually rasterizes — **not** our `wrap`) is sized from the PDF page's own inner
width converted to px (`Math.floor((297 − 16) × 96/25.4)` = **1062px** for A4 landscape with
8mm margins) — narrower than `ppr.js`'s own `wrap`, hardcoded to `width:1180px`. The 1180px
content overflowed `container`'s 1062px box by ~118px on the right, and html2canvas only ever
paints what's inside `container`'s own declared box — the overflow was simply never painted,
backfilled with the configured background colour instead.

⚠️ **A first fix attempt — passing `width`/`windowWidth:1180` to the `html2canvas` options —
was tried, shipped, then proven NOT to work** by a live re-verification (a fresh PDF's real
embedded JPEG still showed the identical crop). Those options steer html2canvas's own
output-canvas sizing and its reflow of viewport-relative content; neither touches
`container`'s own **explicit, absolute-unit** CSS width, so content past ~1062px was still
never painted. Caught by testing the actual shipped fix against real PDF bytes rather than
trusting the change once it compiled.

**The fix that actually works**: capture `wrap` at `pdfPageWidthPx()` — the SAME formula,
from the identical page/margin config, that produces `container`'s own width (1062px) —
instead of a hardcoded 1180. `wrap` and `container` now always agree, so nothing ever
overflows to be cropped. ⚠️ **Real, disclosed trade-off**: the PDF's own photos/columns render
~10% narrower in absolute terms than the previous (silently broken) 1180 target — still
`object-fit:contain`, still 2-up side-by-side, no distortion, just sized to what an
A4-landscape page can actually hold. The separate offline-HTML export is untouched — it still
renders at the full 1180px design width, since it was never subject to html2pdf's own
page-width constraint. `module.js`'s ad-hoc export needed no equivalent change — its own
900px capture width already sits comfortably under 1062px, confirmed rather than assumed.

### Verified — fresh live export through the real app UI, after both fixes

Same stub-auth-harness convention as every round (real, unmodified `module.js`/`ppr.js`, real
pinned CDN libraries, harness deleted after use), driven through the real "+ New
Presentation" → "+ Add Slide" (a real 1600×900 landscape "Current" + 900×1600 portrait
"Previous" pair, each with a distinct edge-marker stripe so cropping would be visually
unmistakable) → Download → PDF flow, then the real generated PDF's bytes decoded directly
(not the HTML proxy this time):
- **Page count: exactly 2** (`/Count 2`, `/Kids [3 0 R 5 0 R]`, both pages `/MediaBox [0 0
  841.89 595.28]` — A4 landscape) — content slide on page 1, Thank You on page 2, no blank or
  duplicated page.
- **No cropping**: the extracted page-1 JPEG shows both photos' own right-edge marker
  stripes fully intact, un-clipped, all the way to a normal ~1% design margin from the page
  edge — visually confirmed by opening the decoded image directly, not just pixel-sampled.
  Page 2's footer tagline (previously one of the clipped elements) renders complete, red
  divider included.
- **Previous/Current still genuinely 2 columns side by side**, both the portrait and
  landscape test photo rendering undistorted within their frame.
- ⚠️ **Only the Internal report type was re-verified against a real generated PDF this
  round** (Client only re-verified via the live-HTML proxy in the round below, before either
  fix) — the fix is entirely about capture width/page-break math, identical regardless of
  `report_type`, so this is a low-risk gap, but it is a gap, named rather than glossed over.

`ppr.js`/`module.js`/`index.html` → `?v=20260910c`. **Not committed** — kept in the working
tree per the owner's explicit instruction.

## HTML/PDF header/footer rebuilt to match the ACTUAL branded content slide of
## the 3-slide template — the earlier round adapted the wrong slide (2026-09-10)

Owner's correction, immediately after the previous HTML/PDF round: "Slide 4" (their own
term) meant the **second slide of the 3-slide template itself** (Cover / Progress Photo
content slide / Thank You) — not `slideLayout4.xml`, which the prior entry had (reasonably,
given the ambiguity, but incorrectly) ruled out as a generic stock Office layout. Re-
inspected the real thing this time: slide 2 of the actual uploaded deck has no shapes of its
own (`slide2.xml`'s placeholders are all empty) — its entire visual design comes from
`slideLayout2.xml` ("Title and Content"), which the earlier HTML/PDF header never matched at
all.

### What the real content slide actually looks like, read from its own XML — not assumed

- **Top band**: a `<p:pic>` at `x=0,y=0,w=12192000,h=758952` EMU (full slide width × 0.83in
  tall) — cropped from `image3.jpeg` via `srcRect b="88933"` (keep the top 11.067%, no
  horizontal crop). Viewed the real source: a plain white strip with a **small red rounded
  corner accent confined to the top-left** — nothing like the earlier header's full logo.
  **No logo anywhere in this top band.**
- **Logo**: a separate `<p:pic>` (`image2.png` — the same file already used elsewhere) at
  `x=234669,y=6470911,w=1207061,h=208519` EMU (≈0.26in, 7.08in, 1.32×0.23in) — the
  **bottom-left** of the slide, sitting on a small white rectangle patch.
- **Tagline**: another `<p:pic>` (`image4.png`) at `x=9786111,y=5898417,w=2405888,h=1353312`
  EMU — **bottom-right**: "Engineering A First-World Philippines" with its own thin red
  vertical divider baked into the same image.
- **Title**: inherited from the slide master (`x=838200,y=365125,w=10515600,h=1325563` EMU),
  Gotham 40pt bold, sitting just to the right of the top band's red corner.

### The fix — literal template crops, threaded through both exporters

Two new real assets, cropped/copied from the template's own media files (never redrawn):
- **`assets/branding/content-header-strip.jpg`** — the exact `srcRect` crop of `image3.jpeg`
  (2250px × (1 − 0.88933) = 249px, full 4000px width) — pixel-identical to the template's own
  top band.
- **`assets/branding/tagline.png`** — `image4.png`, but tightened from its native 8001×4501
  canvas to its actual opaque content bounds (`6674×782`, +40px margin) — the source file
  carries enormous transparent padding around one line of text + a divider bar, and rendering
  it at the padded ratio (1.78:1) made the real text illegibly small at any sane footer size.
  Cropping to content (found by scanning for non-transparent pixels, not guessed) is a
  bounding-box tightening of the exact same pixels, not a redraw — the same discipline
  already applied to the cover panel and this new header strip.

`ppr.js`'s `slidesBodyHTML()`/`offlineHTML()`/`exportOffline()`/`exportPdf()` and
`module.js`'s `dlBodyHTML()`/`exportSelectedOffline()`/`exportSelectedPdf()` all gained two
new params (`headerStrip`, `tagline`) threaded through from two new loaders
(`contentHeaderStripDataUrl()`/`taglineDataUrl()`, `dlContentHeaderStripDataUrl()`/
`dlTaglineDataUrl()` — same `brandAssetDataUrl`/`dlBrandAssetDataUrl` caching convention as
every other brand asset in these two files).

- **Header**: `<img class="hdrstrip">` (real aspect ratio via `height:auto`, never
  distorted) replaces the old `<img class="hdrlogo">` + red-rule-underneath treatment
  entirely. Project Name / Presentation Title (Description) / meeting-type label / Meeting
  Date — all content already finalized the prior round — now sit below the strip instead of
  beside a logo that was never really part of this slide's own design.
- **Footer**: rebuilt from a plain centered "Generated … Megawide Construction Corporation"
  line into `<div class="ftrleft">` (logo + "Generated …" text) on the left, `<img
  class="ftrtag">` on the right — matching the template's real bottom-left/bottom-right split.
- ⚠️ **The Thank You page is untouched** — it already reuses the cover's own real red-panel
  artwork (approved in an earlier round) and has nothing to do with the content slide's own
  chrome; the owner's instruction was specifically about the header, and Thank You was
  explicitly on the "keep unchanged" list.
- ⚠️ **module.js's ad-hoc export has no report_type/meeting-label concept** (same asymmetry
  as every prior round) — its header keeps "Progress Photos · N photos" under the strip;
  only the strip/logo/tagline repositioning applies there, not the meeting-label line.

### Verified — fresh live export through the real app UI, all four scenarios, after the fix

Same stub-auth-harness convention as every round (real, unmodified `module.js`/`ppr.js`, real
CDN libraries, harness deleted after use), driven through the real "+ New Presentation" form
→ "+ Add Slide" picker → Download, and real Gallery checkbox selection → Download, for both
report types and both 1-photo/3-photo ad-hoc scenarios:
- **Header strip**: present in all 4 HTML files (`class="hdrstrip"`/`class="dl-hdrstrip"`),
  measured in a real render at 1264.8×78.7px — ratio 16.07, matching the source crop's own
  4000:249 (16.06) to within rounding, so `height:auto` is genuinely preserving it, not
  coincidentally close.
- **Footer logo/tagline**: measured 116×20px (ratio 5.79, matching the real logo's 1714:296)
  and, after the tagline re-crop, 205×24px (ratio 8.53, matching the cropped asset's own
  6674:782) — the pre-crop version measured 42×24px and was genuinely illegible at that size,
  caught by measuring it, not by eye.
- **Dynamic content, unchanged from the prior round**: Internal → "PPR Meeting", Client →
  "Client Coordination Meeting", real typed Description, real Meeting Date, no Project Code
  in any of the 4 files.
- **Photo layout, unchanged from the prior round**: 1 photo → 1 figure; 3 photos → 2+1 split
  across 2 content slides; Previous/Current still 2 figures side by side; every photo ratio
  exact (1.778 landscape, 0.5625 portrait); 0 "Image unavailable" placeholders.
- **PDF page counts, re-confirmed still correct after this round's changes**: Presentation
  PDFs 2 pages (Internal and Client), ad-hoc PDFs 2 pages (1 photo) and 3 pages (3 photos,
  2+1 split) — the 2026-09-09 media-query/orientation fixes are untouched by this round and
  still hold; `/MediaBox` confirms A4 landscape throughout.
- 0 malformed structure in any file.

`module.js`/`ppr.js` → `?v=20260910a`. New assets: `assets/branding/content-header-strip.jpg`,
`assets/branding/tagline.png`. **Not committed** — kept in the working tree per the owner's
explicit instruction, pending a separate go-ahead once PPTX, HTML and PDF are all signed off.

## HTML/PDF exports brought to parity with the finalized PPTX cover — plus two
## real, previously-undiscovered PDF bugs found and fixed by a live export
## test (2026-09-09, later same day)

Owner's next review after the PPTX cover/content work: verify the HTML and PDF exports
follow the SAME finalized cover logic (no Project Code, meeting-type label, Meeting Date
from the presentation record), confirm the agreed "adapt the header, don't recreate the
template slide-for-slide" branding treatment, and live-test photo layout/Thank-You-page
behaviour the same rigorous way the PPTX was tested. Two genuine, real defects were found
in the course of that test — neither was a design ask, both are bugs.

### 1. HTML/PDF header now carries the same 4-line hierarchy as the PPTX cover

`slidesBodyHTML()`'s (`ppr.js`) and `dlBodyHTML()`'s (`module.js`, description/count only —
no report_type there) `<header>` previously showed "description · Reporting Period: date"
with no meeting-type concept at all. Now: Project Name (`<h1>`) → Presentation Title
(`ppr_presentations.description`) → meeting-type label (`meetingLabelFor(report_type)`,
styled bold/red/uppercase, the same visual weight the PPTX cover's Line 3 carries) →
"Meeting Date: …". Project Code was never shown here and still isn't. This is a content-
only change to the existing header markup/CSS — the logo, the brand-red rule beneath it,
and every other visual property are untouched.

### 2. A branded "Thank You" closing page — genuinely MISSING from HTML/PDF until now

⚠️ **Real gap, not a design choice**: grepping the whole file for "Thank You" before this
pass found it **only** inside `exportPptx()`/`exportSelectedPptx()` — the HTML and PDF
exports had no closing page at all, ever, in either file. Both `slidesBodyHTML()` and
`dlBodyHTML()` now append one more `.slide`/`.dl-slide` section (`Thank You` heading +
project name + "Megawide Construction Corporation", logo, a 4px brand-red top rule) —
reusing the EXISTING `.slide`/`.dl-slide` class so the existing page-break CSS
(`:not(:last-of-type)`) puts it on its own page automatically, and deliberately styled as
an extension of the header's own bookend language (logo + brand-red rule, just top instead
of bottom) rather than a literal recreation of the PPTX's red-panel shape — per the owner's
explicit "adapt, don't redesign" instruction for this format.

### 3. ⚠️⚠️ Real bug: the off-screen PDF capture silently broke the 2-column Previous/
### Current layout whenever the EXPORTING browser's own window was ≤820px wide

Found by a genuine live click-through, not by reading the code: a freshly-exported
Presentation PDF measured **4 pages** for what should have been 2 (one content slide +
Thank You). Root-caused by rebuilding the exact capture in isolation and measuring: with
the exporting tab at a perfectly ordinary 366px-wide window (not a phone — any half-screen
or narrower browser window reproduces this), `.phwrap`'s rendered width collapsed from the
correct 552px (2-column) to 1116px (a single full-width column) — because
`@media (max-width:820px){.pair,.pair.single{grid-template-columns:1fr}…}` was written for
someone opening the **saved standalone HTML file on their own phone later**, but a
`@media` rule has no way to distinguish that from "the exporting browser's own current
window happens to be narrow right now" — it only ever reads the real window width, never
the fixed 1180px/900px design width the off-screen `wrap` div is deliberately built at.
The result: Previous/Current stacked vertically instead of side-by-side, every photo
rendered at roughly half the intended width ("unnecessarily small", the exact defect this
round was asked to rule out), and the doubled height spilled the report onto twice as many
physical pages.

**Fix**: the mobile breakpoint is now a SEPARATE CSS fragment (`EXPORT_MOBILE_CSS` /
`DL_MOBILE_CSS`), appended only to the standalone offline-HTML export's `<style>` tag —
never to the off-screen `wrap` in `exportPdf()`/`exportSelectedPdf()`. A user who later
opens the saved HTML file on their own phone still gets the responsive single-column
layout exactly as before; the PDF capture is now completely immune to whatever window size
the exporting browser happened to have. ⚠️ Two other fixes considered and rejected first,
for the record: `html2canvas`'s own `windowWidth`/`windowHeight` option (documented for
exactly this class of problem) did NOT fix it in this pinned version — measured directly,
page count stayed at 4; capturing via an `<iframe>` (which does get its own isolated
viewport) correctly fixed the column collapse but broke html2canvas's own capture in a
different way (page count went to 5, worse than the bug). Stripping the media query at the
CSS-fragment level, verified by direct measurement, is the fix that actually works.

### 4. ⚠️ Real bug: `module.js`'s ad-hoc PDF export rendered in PORTRAIT, inconsistent with
### the Presentation PDF's LANDSCAPE — found in the same pass

`exportSelectedPdf()`'s jsPDF config read `orientation: 'portrait'` while `ppr.js`'s own
`exportPdf()` (an identical wide, 2-column report design) correctly uses `'landscape'`.
Measured directly from a real generated file's own `/MediaBox` before touching anything:
595×842pt (A4 portrait) vs. the Presentation PDF's 842×595pt (A4 landscape). A narrower
portrait page gives a 2-photo layout even less width per column than landscape does — the
opposite of "photos should use the available space efficiently." Changed to `'landscape'`
to match `ppr.js`, per the owner's own allowance to fix cross-export inconsistencies.

### Verified — genuine live export through the real app UI, both report types, all four
### photo scenarios, real files inspected

Same stub-auth-harness convention as every other live pass this session (real, unmodified
`module.js`/`ppr.js`, a fake Supabase-shaped query builder, real `pptxgenjs`/`html2pdf.js`
loaded from the pinned CDN, harness deleted after use) — but this time driven end-to-end
through the REAL UI for the parts under test: clicked **+ New Presentation**, typed a real
Description, picked a real Report Type, saved (which correctly jumps into the slide
editor per its own existing behaviour), clicked **+ Add Slide**, picked a real Current and
Previous photo through the real picker, saved, then **Download → HTML** and
**Download → PDF** — for one Internal and one Client presentation — plus real Gallery
checkbox selection (1 photo, then 3 photos) through **Download → HTML/PDF** for the ad-hoc
export path.

Confirmed against the real downloaded files (unzipped/parsed, not simulated):
- **Cover/header**: both presentations' HTML headers show the correct 4-line hierarchy —
  "PPR Meeting" for Internal, "Client Coordination Meeting" for Client — with the real
  typed Description and the real presentation date, no Project Code anywhere.
- **Thank You page**: present as the final section in all 4 HTML exports (2 Presentation +
  2 ad-hoc), branded consistently with the header.
- **Photo layout, all 4 scenarios**: 1 photo → 1 figure on its own page; 3 photos → 2+1
  split across 2 pages (max 2 enforced); Previous/Current render as 2 real `<figure>`s
  labelled `Previous`/`Current` in that DOM order (left/right in the CSS grid); every
  photo's `<img>` computes `object-fit:contain` against its own real natural dimensions —
  1600×900 landscape (ratio 1.778) and 900×1600 portrait (ratio 0.5625), both exact, no
  distortion possible by construction.
- **PDF page count, before → after the fix**: Presentation PDF 4 → **2** pages (both
  Internal and Client, re-confirmed on two separately-dated real exports after the fix);
  `/MediaBox` confirms A4 landscape (841.89×595.28pt) throughout.
- ⚠️ **Not independently re-confirmed on a fresh file**: the ad-hoc Gallery PDF export
  specifically — its fixed filename (`'Photos ' + projName + '.pdf'`, no per-run
  differentiator) collided with a file the real, concurrently-active user on this shared
  machine had open, and the OS file lock silently prevented every retry from saving a new
  copy under that name (confirmed via `Device or resource busy`, not a code failure). The
  underlying fix in `module.js` is byte-for-byte the same code shape as the two
  Presentation PDFs that WERE freshly re-verified, plus the isolated diagnostic that
  proved the CSS-strip approach directly — high confidence, but flagged honestly rather
  than claimed as independently proven for this one specific file.
- **0 malformed XML/structure** across every file checked.

`module.js`/`ppr.js` → `?v=20260909f`/`?v=20260909g`. **Not committed** — kept in the
working tree per the owner's explicit instruction, pending a separate go-ahead once PPTX,
HTML and PDF are all signed off together.

## Cover/title slide content finalized — Project Code removed, meeting-type
## label + Presentation Description drive the cover, one real hardcoding bug
## caught and fixed along the way (2026-09-09, later same day)

Closes out the same-day cover-geometry/photo-sizing validation below with a content
(not layout) pass on the PPTX cover, requested after the owner reviewed the
geometry-validated sample in the app. **Final, owner-confirmed cover logic — do
not change without a new explicit request:**

1. Project Name → the selected project's real `projects.name` (via
   `module.js`'s `fillProjects()`/`notifyProject()` → `ProgressPhotos.onProject()`,
   read live off whichever project the topbar dropdown has selected).
2. Presentation Title → `ppr_presentations.description` (the "Description"
   field on the Add/Edit Presentation form, `#ppr-f-desc`) — falls back to the
   generic "Project Progress Report" only when a presentation's own
   description is genuinely blank.
3. Meeting label → `meetingLabelFor(p.report_type)`: `'client'` → **"Client
   Coordination Meeting"**, anything else (`'internal'` or unset) → **"PPR
   Meeting"**. Never prints the raw classification word "Internal"/"External".
4. Meeting Date → `ppr_presentations.ppr_date`.
5. Project Code (the previous `pid` subtitle line) → removed entirely, from
   both `ppr.js`'s `exportPptx` (Presentations) and `module.js`'s
   `exportSelectedPptx` (ad-hoc Gallery-selection export, kept consistent
   even though it has no report_type/meeting concept of its own — its
   remaining description+photo-count lines are otherwise unchanged).

⚠️ **A real hardcoding bug was introduced and then caught one round later.**
The owner's own worked example for the new hierarchy ("Project Name /
Project Progress Report / PPR Meeting.../ Meeting Date") was first
implemented by writing the literal string `'Project Progress Report'` as
Line 2 — every presentation would have shown the identical cover subtitle
regardless of what was actually typed into its Description field. Caught
when the owner asked for an explicit data-flow audit; fixed by reading
`p.description` instead, with that same string kept only as the
blank-field fallback. **Lesson recorded for next time:** a worked example
in a request illustrates structure, not necessarily a literal value to
hardcode — when a request's example text happens to look like a real
field's typical content, check whether a live field already exists before
assuming it's meant to be static.

⚠️ **Layout, geometry, fonts, and branding were never touched by this whole
content pass** — verified after every round: cover panel/logo stay at
`x=6.209/0.589, y≈0/0.618, w=7.122/2.681, h=7.499/0.463` (the template's own
`slideLayout1.xml`/`slideLayout16.xml` coordinates), same as every prior
cover-fidelity check this same day.

**Verified live, three rounds, real generated `.pptx` files each time** (a
stub-auth harness driving the real, unmodified `module.js`/`ppr.js`, real
`pptxgenjs@3.12.0`, real downloaded files unzipped and read via
`System.Xml.XmlDocument` — harness deleted after each use, nothing committed):
- Round 1 (Internal vs. Client): confirmed `meetingLabelFor` picks the right
  label per `report_type`, Project Code fully absent, hierarchy order correct,
  cover geometry unchanged. Round 2 (the hardcoding-bug audit): seeded a
  project whose id (`AVR-TB01`) deliberately differs from its name (`Avesta
  Residences — Tower B`) and three presentations with distinct real
  descriptions/dates (one deliberately blank) — the cover correctly showed
  the project's real **name** (never the id) and each presentation's own
  real **description** (never a fixed string), with the fallback text
  appearing only for the genuinely-blank one. All files: 3 slides (Cover →
  content → Thank You), 0 malformed XML/`.rels` parts.

`ppr.js` → `?v=20260909e`; `module.js` stays `?v=20260909d` (its own cover
edit — Project Code removal only — landed in the prior round the same day).

## Owner rejected the cover as a "simplified vertical rectangle" and the photos
## as too small — both correct. Re-inspected the template's own shape tree,
## found the red panel is a cropped PHOTOGRAPH (not a shape at all), and
## switched to embedding the template's own artwork verbatim (2026-09-09, later same day)

Owner reviewed the sample PPTX from the earlier same-day pass and rejected two things, one of
them "non-negotiable": the cover's red panel had been "simplified into what appears to be
essentially a plain vertical rectangle" (built as a `roundRect` vector shape with a guessed
0.35in corner radius), and the photos on content slides were "too small" with "a significant
amount of unused space". Explicit instruction: re-open the uploaded template, read its actual
shape tree, and reproduce it — not approximate it from memory.

### The red panel was never a PowerPoint shape to begin with

Re-unzipped the template fresh and read `slideLayout1.xml`'s (cover) and `slideLayout16.xml`'s
(Thank You) own `<p:pic>`/`<p:sp>` elements directly. The result settles the question outright:
**the red panel has `<a:prstGeom prst="rect"/>` — a plain, square-cornered rectangle geometry —
because it isn't a shape at all.** It's a `<p:pic>`: a cropped **photograph**
(`<a:blip r:embed="rId2"/><a:srcRect l="46574"/>`, i.e. the right 53.426% of a source image,
`image1.jpeg`), positioned at `x=5678310, y=0, cx=6513689, cy=6858000` EMU. The rounded corner is
baked into that source image's own pixels — there is no adjustable curve geometry anywhere in the
template to read a radius from, which is exactly why the earlier `roundRect` pass could only ever
be a guess, and why no amount of radius-tuning could have fixed it: a vector `roundRect` also
rounds all four corners uniformly, while three of this shape's four corners sit flush against the
slide edge in the real design and must stay perfectly square.

**Fix: stop drawing a shape, embed the template's own artwork instead.** Cropped `image1.jpeg` at
the identical pixel offset the template's own `srcRect l="46574"` specifies (`46.574% × 4000px =
1863px` from the left, full 2250px height kept) via a one-time PowerShell/System.Drawing script,
saved as the new asset `assets/branding/cover-panel.jpg`. This is not a redrawing of the panel —
it is the literal template graphic, byte-identical in every pixel that survives the crop,
including its own baked-in "Engineering / A First-World Philippines" tagline. Both `ppr.js`
(`coverPanelDataUrl()`) and `module.js` (`dlCoverPanelDataUrl()`) fetch and cache it exactly like
the existing logo loader, and every cover/Thank-You `addImage` call for it routes through
`containFit()` (unchanged from the earlier fix) so the crop itself is never re-stretched.

⚠️ **The Thank You slide now uses the SAME cropped-panel-only asset as the cover, not the
template's own full-bleed `image17.jpeg`.** The template's real Thank You layout is the *whole*
`image17.jpeg` (no crop) as a full-slide background — which also bakes in a "Contact us / Follow
us" investor-relations block in its white area, positioned close enough to this file's own
"Megawide Construction Corporation" footer text (y=6.9in) to visually collide with it. Reusing the
cover's own panel-only crop reproduces the identical red-panel design element the owner's
complaint was actually about, on both slides, consistently, without introducing baked boilerplate
this internal site-progress report was never meant to carry. Flagged explicitly rather than
silently decided — if the owner wants the literal full-bleed Thank-You background (contact info
and all), that's a one-asset swap (`image17.jpeg`, uncropped, full-slide), not a re-design.

**Title/subtitle/logo repositioned to the template's own real coordinates**, read the same way
(EMU ÷ 914400 = inches, from the same two layout files) — `TITLE_X/Y/W/H`, `SUBTITLE_Y`, `LOGO_X/
Y/W/H`, `PANEL_X/W` are no longer independently-chosen values, they're the template's own
`ctrTitle`/`subTitle`/logo-picture placeholder positions. Title `fontSize` bumped 34→36pt with
`autoFit: true` added (confirmed as a real, supported option in the exact pinned PptxGenJS v3.12.0
bundle — the string appears in the minified source — matching the template's own `<a:normAutofit/>`
on that placeholder) so a long project name shrinks to fit rather than overflowing its box, closer
to the template's real 48pt default without risking overflow on this app's variable-length names.

### Photos were substantially undersized — no single template value to blame, so this is a
### deliberate, from-scratch chrome-minimization pass

Measured the previous geometry directly: a 16:9 photo in the old 6.1×4.6in pane rendered at
6.1×3.43in — **1.17in of dead vertical space**, split above and below. Checked whether the
template itself defines an "intended photo container" to copy, per the owner's explicit
instruction — it does not. `slideLayout3.xml`/`slideLayout4.xml`/`slideLayout21.xml` ("Content
with Image", "Content with Big Image", "Picture with Caption") are stock Microsoft Office default
layouts that ship with any PowerPoint theme, not something Megawide designed for a 2-up photo
comparison; none of them describes this module's actual use case. So the fix is a from-scratch
sizing pass, not a template lookup: every piece of non-photo chrome (the PREVIOUS/CURRENT label,
the caption block, the slide margins and the gap between panes) was measured and shrunk to the
smallest size still legible, and every inch freed was handed directly to the photo's own box
(`IMG_H`) — the box itself grew, not just the chrome around a fixed-size box.

| | Before | After |
|---|---|---|
| Pane box (2-up, `ppr.js`) | 6.1 × 4.6in | 6.22 × 5.65in |
| Pane box (2-up, `module.js`) | 6.1 × 4.6in | 6.22 × 6.35in (no PREVIOUS/CURRENT label to budget for) |
| Single-photo box (both files) | 6.5 × 4.6in | 7.8 × 5.65in (`ppr.js`) / 7.8 × 6.35in (`module.js`) |
| Caption block | 0.9in | 0.6in (still fits description + tags + date at 10pt) |

`containFit()` — the earlier fix's guard against distortion — is completely untouched; it just now
receives a bigger box, so a photo grows in both dimensions proportionally, never stretched.

### Re-verified live, all 8 acceptance-criterion scenarios again

Same stub-auth harness approach as both earlier same-day passes (deleted after use). Downloaded
and measured the real regenerated files:

- **Cover / Thank You**: both slides' red-panel picture measures **ratio 0.950** — the exact
  aspect ratio of the actual cropped asset (2137×2250 px = 0.9498) — at position
  `x=6.209in, y≈0, w=7.122in, h=7.5in`, matching the template's own numbers to the inch. The
  embedded image bytes were extracted directly from the generated `.pptx` and visually confirmed
  identical to the template's own artwork (rounded corner, baked tagline, exact red).
- **1 photo**: box now 7.8×5.65in; a real 1600×900 test photo rendered at **7.8×4.388in, ratio
  1.778** — exact match to its own source ratio, centered in the taller box.
- **2 photos**: a landscape+portrait pair on one slide — landscape at 6.22×3.499in (ratio 1.778,
  exact), portrait at 3.572×6.35in (ratio 0.563 ≈ 9:16 exact) — the portrait photo in particular
  now uses the **full available height** of its pane (vs. barely half of it before).
  Confirmed exactly 2 pictures on the slide, no distortion on either.
  - Portrait/landscape variants were also re-verified for the presentation's own Previous/Current pane.
- **Previous+Current**: Previous still left, Current still right, exactly 2 photos, both now
  substantially larger under the same enlarged pane box.
- **Slide/photo distribution, pairing, and Thank-You-always-last**: re-confirmed byte-for-byte
  identical to the pre-redesign run (same slide counts, same picture counts per slide, same
  caption text) — this pass changed only geometry and the two brand assets, nothing about which
  photo goes where.
- All 3 regenerated files re-passed full XML well-formedness validation (0 malformed parts).

⚠️ **Standing limitation, unchanged**: still no PowerPoint/LibreOffice in this environment, so the
final rendered pixels haven't been seen by human eyes here. Everything a structural/geometric
inspection can prove — pixel-identical panel artwork at the template's own coordinates, exact
source-aspect-ratio photo placement, unchanged slide logic — has now been proven twice against
real generated bytes.

`module.js`/`ppr.js` → `?v=20260909c`. New asset: `assets/branding/cover-panel.jpg` (a crop of the
template's own `image1.jpeg`, not a new design element).

## Live PPTX validation found a real photo-distortion bug: PptxGenJS v3.12.0's
## `sizing:{type:'contain'}` is a no-op in the pinned bundle — every photo (and
## the logo) was being stretched to its box, not letterboxed (2026-09-09, later same day)

Owner asked for one more live pass before signing off, specifically: generate a real PPTX for
1/2/3/5-photo selections and a Previous/Current presentation, and **inspect the actual output
file**, not just source code or the browser DOM — explicitly not to change anything further
unless the live test found a real problem. It did.

### What the live test found

Re-ran the same stub-auth harness approach as the earlier same-day entry (throwaway, deleted
after use), this time seeding photos with **known, distinct pixel dimensions** (1600×900
landscape, 900×1600 portrait — the exact scenario acceptance criterion #8 asks for) and actually
downloading + unzipping + measuring the real `.pptx` output. The distribution logic (chunkPairs,
cover, Thank You always last, Previous/Current pairing) all checked out exactly as designed — see
the measurements below — but the **photo geometry did not**: every embedded picture's `<a:ext>`
in the raw XML was **identical to its pane's own box dimensions** (e.g. a photo placed in a
6.1in×4.6in pane came out as literally `5577840×4206240` EMU = 6.1in×4.6in, ratio 1.326),
regardless of whether the source photo was landscape (real ratio 1.778) or portrait (real ratio
0.562). **Every photo, on every slide, in both exporters, was being stretched to fill its box —
distortion, not containment** — directly contradicting acceptance criterion #8.

⚠️ **Root cause, confirmed by inspecting the actual library, not by reading its documentation.**
Both exporters passed `sizing: { type: 'contain', w, h }` to `pptx.addImage()`, following
PptxGenJS's own documented image-fitting feature. Downloaded the exact pinned CDN bundle
(`pptxgenjs@3.12.0/dist/pptxgen.bundle.js`) and searched it directly: **the strings `"contain"`,
`"cover"` and `"crop"` do not appear anywhere in the entire 477KB bundle.** The `sizing` option is
read into a local variable in two places but never branched on for an image element — this exact
pinned build silently ignores it, and `addImage` falls through to its default behavior: stretch
the picture to the given `w`×`h` exactly. This was true for photos AND for the corner-mark/cover/
Thank-You logo placements alike (measured: the logo's stretched-box ratio came out 4.643, its own
true ratio is 5.791 — same defect, smaller and easier to miss by eye).

### The fix — compute the fit ourselves, never rely on the library's `sizing` option

Since every image is already decoded through a real `Image` element before being drawn to canvas
(`toDataURL()`/`dlToDataURL()`, for the downscale-to-JPEG step), its true `naturalWidth`/
`naturalHeight` were available for free — they just weren't being kept. Both functions now return
`{ data, w, h }` instead of a bare data-URI string (the logo's own loader, `logoDataUrl()`/
`dlLogoDataUrl()`, was widened the same way, decoding the PNG once to capture its dimensions too).
A new `containFit(bx, by, bw, bh, iw, ih)` — identical in both files, per this file's own
"small helpers restated per file" convention — computes the largest rectangle preserving the
image's own aspect ratio that fits inside the given box, centered within it, and **every** PPTX
`addImage` call in both files (photos and all three logo placements) now routes its x/y/w/h
through it instead of passing the pane box straight through. The `sizing` option is removed
everywhere — it was never doing anything, and keeping it would misleadingly suggest to the next
reader that the library is handling this.

⚠️ **The HTML/PDF path did not have this bug** — its `object-fit:contain` CSS frame (from the
earlier same-day rebrand entry) is a real, working browser feature; this defect was specific to
the PPTX path's now-removed reliance on PptxGenJS's `sizing` option. Confirmed the fix touches
only `addImage` call sites; `slideFigureHTML`'s/`dlFigureHTML`'s HTML `<img>` tags were only
updated to unwrap the new `{data,w,h}` shape (`.data` instead of the bare string), not to change
behavior.

### Re-verified — all 8 acceptance-criterion scenarios, against the real fixed output

Same harness, same 5 export runs, each downloaded file unzipped and measured again:

| Test | Slides (Cover→…→Thank You) | Per-slide picture count | Aspect ratio measured |
|---|---|---|---|
| 1 photo | 3 (1 content slide) | 1 photo, centered | landscape 1.778 — **matches source exactly** |
| 2 photos | 3 (1 content slide) | 2 photos, side by side | 1.778 then 0.562 — **both exact** |
| 3 photos | 4 (2 content slides) | Slide 1: 2 photos · Slide 2: 1 photo | all exact |
| 5 photos | 5 (3 content slides) | Slide 1: 2 · Slide 2: 2 · Slide 3: 1 | all exact |
| Previous+Current | 3 (1 content slide) | exactly 2 (Previous left, Current right) | 1.778 then 0.562 — **both exact** |

The logo (real ratio 5.791) now measures 5.791 everywhere it appears (cover, Thank You, every
per-slide corner mark) instead of the previous 4.643. Every one of the 5 downloaded files was
also re-validated as well-formed OOXML (every XML/`.rels` part parsed with `System.Xml.XmlDocument`
— 0 malformed) and the slide/picture-count/caption text was **byte-identical** to the pre-fix run,
confirming the fix changed only geometry, nothing about distribution, pairing, cover content, or
the Thank You slide's position.

⚠️ **Standing limitation, unchanged**: no PowerPoint/LibreOffice is available in this environment,
so the actual rendered pixels have still not been seen by a human. The 5 generated `.pptx` files
from this pass were handed to the owner directly for that one remaining check — everything a
static/structural inspection can prove (well-formed OOXML, correct slide/photo counts and
ordering, and now, exact-to-the-source-pixel aspect ratios measured from the real embedded
`<a:ext>` values) has been proven against the real generated bytes, not simulated.

`module.js`/`ppr.js` → `?v=20260909b`.

## The existing PPTX/HTML/PDF exports are rebranded to the uploaded Megawide
## corporate template — cover + Thank You slides, branded header, max-2-photos
## enforced in the ad-hoc batch export too (2026-09-09)

Owner supplied the corporate PowerPoint template ("MCC CAB Presentation Template progress
photos") as the design reference and asked for a presentation/export feature. **Inspected first,
built second, per the request's own instruction**: this module already has a complete,
independently-audited export system (`ppr.js`'s `exportOffline`/`exportPdf`/`exportPptx` for a
Previous/Current **Presentation**, `module.js`'s `exportSelectedOffline`/`exportSelectedPdf`/
`exportSelectedPptx` for an ad-hoc **Gallery selection**) — there was no existing/parallel content
model to build, only a visual rebrand plus one real gap.

### What the template actually is, read from its own XML/shape tree, not screenshotted

Unzipped the `.pptx` directly (`Expand-Archive`, no Python/Node available in this environment —
see the standing limitation below) and read `ppt/slides`, `ppt/slideLayouts`, `ppt/theme`. The
three real slides are placeholder-only (cover / a generic content slide / "Thank you") — the
template is a **corporate identity system** (23 layouts covering every Megawide business line),
not a literal progress-photo layout to copy pixel-for-pixel. The actual brand signal: the
wordmark logo (`ppt/media/image2.png`), brand red **`EE3124`** (confirmed identical to this app's
own existing `--pd-red` token — no new colour invented), a solid red panel with one rounded
corner on the cover/closing slide, and **Gotham**/**Avenir Next** as the title/body typefaces
(theme1.xml itself is the unmodified default Office theme — the brand lives in literal shape/
image/font overrides, not scheme colours). The logo (`assets/branding/megawide-logo.png`, new)
is the one asset actually needed; the red panel is drawn as a native `roundRect` shape rather than
a cropped image, so it stays crisp and needs no second asset to maintain.

### PPTX (`ppr.js` `exportPptx`, `module.js` `exportSelectedPptx`)

- **Cover slide**: white ground, logo top-left, the red rounded panel on the right ~42%,
  project name + code, the report's own description + date (`ppr_date` for a Presentation,
  photo count for an ad-hoc selection) and a generation-date footer — every field read from data
  already in the app, nothing re-typed.
- **A Thank You slide is now always last** — it did not exist before this change. Mirrors the
  cover's red-panel layout with "Thank You" as the headline.
- Each photo slide gets a small logo mark in the corner — quiet, never competing with the photo,
  per the brief's own "the photograph remains the primary visual element."
- **The 2-photos-per-slide cap was already correct in `ppr.js`** (a slide is a Previous/Current
  pane pair, or one photo centered — never more) — untouched. **`module.js`'s ad-hoc batch export
  was NOT already correct: it put exactly 1 photo per slide.** New `chunkPairs(list)` is now the
  single place that decides distribution (2 at a time, the last group holding 1 if the count is
  odd) — matches the brief's own worked examples exactly (5 photos → 2/2/1, 7 → 2/2/2/1).
- `sanitizePptxText` (ppr.js's 2026-09-03 fix for a control-character crashing PowerPoint's
  strict XML parser) is now also used in `module.js`'s exporter — that file had never carried it.

### HTML / PDF (`ppr.js` `slidesBodyHTML`/`EXPORT_CSS`, `module.js` `dlBodyHTML`/`DL_CSS`)

- **Header rebranded**: the solid red banner is gone — white ground, the real logo, a 3px
  brand-red rule underneath, matching the PPTX cover's own language so the two formats read as
  one system (brief's own "should feel like they belong to the same reporting system").
- **A fixed-ratio photo frame, added to both files** — neither existed before. Portrait and
  landscape photos previously rendered at `width:100%` with no height constraint (a tall portrait
  photo could run off an A4 page); both now sit in a frame (the padding-top percentage trick, not
  the newer CSS `aspect-ratio` — html2canvas's print capture has spotty support for that property)
  with `object-fit:contain`, so neither orientation is ever distorted or cropped, and a missing
  image degrades to a centered "Image unavailable" instead of collapsing the layout.
- `module.js`'s ad-hoc export now also groups 2 photos per printed page/section (`chunkPairs`,
  same function the PPTX exporter reads), replacing its old 1-photo-per-page layout.

### Deliberately not built

- **No separate manual content-entry screen** — every field on every slide is read from
  `progress_photos`/`ppr_slides`/`ppr_presentations`, per the brief's own explicit instruction.
- **No project "Tower" field on the cover** — this app has no per-project Tower value (Tower is a
  per-photo Location Breakdown value, not project metadata; `PDb`/`projects` carries none). Adding
  one would be inventing a parallel data model the brief explicitly said not to build; the cover
  simply omits it rather than showing an invented or empty field.
- **The "Contact us / Follow us" investor-relations footer baked into the template's own cover
  art is not reproduced** — that is corporate boilerplate for an external-facing deck, not
  something a site progress report needs; only the logo, red-panel motif and typefaces were
  carried over.
- Previous/Current pairing is **read, never re-derived** — `ppr_slides.before_photo_id`/
  `after_photo_id` already IS the app's comparison-pair model (see the 2026-09-08 (c) entry in the
  main `CLAUDE.md` for how this was confirmed); this change touches only how a pair is drawn, not
  how one is identified.

### Verified

⚠️ **No Python or Node is available in this environment** (checked directly — neither resolves
beyond a Windows Store shim), so the `pptx` skill's own `pptxgenjs`/`python-pptx` tooling and this
repo's own `node --check`/`test.js` harness were both unavailable. Verification actually performed:
- **The uploaded template was read as real OOXML** (`Expand-Archive`, not screenshotted) — every
  colour/font/shape claim above is read from the actual `ppt/slides`/`ppt/slideLayouts`/`ppt/theme`
  XML and the two source images, not guessed from appearance.
- **The shared HTML/CSS design (identical between the two files, just class-prefixed
  differently) was rendered in a real browser** via a throwaway static server
  (`.claude/tools/static-server.ps1`, already in this repo) and a scratch QA page reproducing
  `EXPORT_CSS`/`DL_CSS` and the header/figure markup verbatim — confirmed: the branded header
  (logo + red rule, no banner), a 2-photo slide with one landscape + one portrait photo both fitting
  their frame with no distortion, a single/odd photo centered in its own narrower column, a missing
  image degrading to a clean centered placeholder, and the footer. The scratch page was deleted
  before finishing, per this module's own established convention for throwaway harnesses.
- **`modules/progress-photos/index.html` was loaded in a real browser against the actual, edited
  `module.js?v=20260909a`/`ppr.js?v=20260909a`** — 0 console errors, confirming both files parse
  and their top-level IIFEs execute without throwing. The new logo asset was confirmed reachable
  at its real served path (`assets/branding/megawide-logo.png`, 200 OK, 1714×296px).
- Brace/paren balance checked byte-for-byte: `module.js` 1419/1419 braces, 5192/5192 parens
  (perfectly balanced). `ppr.js` 621/621 braces; its paren count carries a pre-existing 1-paren
  imbalance — confirmed via `git show HEAD` to already exist **before** this change (2237/2236 at
  HEAD vs. 2289/2288 now — the +52/+52 this change added is itself balanced), consistent with this
  file's own earlier note that it's a decorative parenthesis in a comment/string, not a real defect.

### Follow-up: a real PPTX was actually generated and opened (2026-09-09, same day)

The gap above — "no `.pptx` has actually been generated and opened" — was closed the same day, on
request. No live Supabase login exists in this environment, so a throwaway **stub-auth harness**
(`_qa_harness.html`, deleted before finishing — same convention this module's own history already
uses repeatedly for exactly this situation) loaded the REAL, unmodified `module.js`/`ppr.js` in a
real browser with `AppAuth`/`PDb`/`UI`/`Icons`/`Fmt` replaced by minimal in-memory stand-ins (a
Supabase-shaped query builder over a plain JS object store, modelled on this file's own `test.js`
harness) and `PDCollab`/`PDSync`/`Autosave` no-op'd — nothing about `ppr.js`'s own export code was
touched or bypassed. Seeded one presentation with 3 real `ppr_slides` rows over 5 real
`progress_photos` rows (4 real locally-generated JPEGs — one landscape, one portrait, one square,
one deliberately pointed at a non-existent file — covering a 2-photo pair, a single/odd photo, and
a pair with one image that 404s) and drove the actual UI: opened Presentations, opened the seeded
presentation, clicked **Download → PowerPoint (.pptx)** for real.

**A real file downloaded** — confirmed by locating it (a browser-automation download, unprompted
filename) and inspecting the actual bytes: `PK\x03\x04` (a genuine ZIP), unzipped cleanly, and
**all 36 XML/`.rels` parts parse as well-formed XML** (`System.Xml.XmlDocument.Load` in PowerShell,
a real XML parser — not eyeballed). Confirmed against the unpacked parts, not assumed:
- **Exactly 5 slides**: cover → 3 photo slides → Thank You — dynamic, driven by the 3 seeded slides,
  never a fixed count.
- **Slide 1 (cover)**: white background; the real logo PNG embedded and positioned at the exact
  coded coordinates (0.6in/0.5in, 2.6in×0.65in); a `roundRect` shape at x=7040880 EMU (7.7in) with
  `adj val 6217` (the coded `rectRadius:0.35` correctly resolved to its OOXML adjustment value),
  filled `EE3124`; "QA Harness Project" at 34pt bold Gotham; "QAPRJ01" in red Avenir Next; the
  seeded description, "Reporting Period: 9 September 2026", and a "Generated 9 September 2026"
  footer — every field the real seeded data, exactly where the code places it.
- **Slide 5 (Thank You)**: same red panel + logo, "Thank You" at 40pt bold Gotham, the project name,
  "Megawide Construction Corporation" footer.
- **The 2-photo pair slide** carries real `PREVIOUS`/`CURRENT` labels, the shared-location banner
  ("Tower 1 › 3rd Floor › Zone 1"), both real dates/descriptions/trade·works tags, and **2** real
  embedded JPEGs.
- **The slide with a 404'd image** correctly shows `Photo not set` text in that pane (confirmed
  exactly **1** `<p:pic>` on that slide, not 2) while still rendering that pane's own caption
  metadata — the intended graceful degrade, proven against a real fetch failure (a real 404 in the
  browser's network log), not simulated.
- The small corner logo mark appears on every one of the 5 slides.

⚠️ **What this does and doesn't prove**: this confirms the exact production code path — real
`ppr.js`, real pptxgenjs v3.12.0, real image fetch/embed — produces a structurally valid, correctly
populated `.pptx`, which is the load-bearing claim of this whole change. It does **not** confirm
real PowerPoint's own renderer paints it pixel-for-pixel as intended (no PowerPoint/LibreOffice is
available in this environment) — a well-formed OOXML part can still look off in a way only a real
render would show (e.g., text overflow, an unexpected font substitution for Gotham/Avenir Next).
That visual open-and-look is the one thing still worth a human doing once, though the structural
risk it could catch is now small.

The harness (`_qa_harness.html`), its 4 generated sample images, and the downloaded file were all
deleted after this check — nothing from this pass is committed.

`module.js`/`ppr.js` → `?v=20260909a`. New asset: `assets/branding/megawide-logo.png` (module
contract §4 — module-local, no shared-file edit). `module.css` unchanged. No `MODULE_V` bump —
`index.html`'s structure/DOM is unchanged, only its two `<script>` version query strings moved.

## Second capture-flow round: single-item Add Media, a mic toggle that
## finally works at any point in a recording, a real 360° stitching bug
## found and fixed, a navigable panorama preview, and one honest platform
## limitation (2026-09-11)

Owner, off the just-shipped capture-flow round and a screenshot of the Add
Media modal:
```
1. only 1 photo or video is allowed when adding media. do not allow multiple uploads per add media
2. when taking video, the mute button and close button is not working
3. when clicking upload photo or upload video, it still gives me three choices as shown in
   attached. i want to go direct to choose from gallery
4. when photo is opened and the key plan is shown, use the same pin as when adding. the red
   circle with corresponding icon. don't use the green pin.
5. when clicking add media > 360, show already all the input fields as with adding photos or
   videos. improve 360 taking guide by moderating speed. once the video for 360 is processed,
   preview should be navigable or operable as 360, dont just show a panoramic still photo. the
   360 preview should also be the basis of the thumbnail where in last frame will be used as
   thumbnail. improve also the processing of video to 360. processing has been failing.
6. again, if location and works are not set-up in schedule, make the two fields optional
```

### Item 6 was already done — re-checked, not re-built

`requiredFieldsMissing()` already reads `scheduleHasActivities()` (Works) and
`LOC_LEVELS.length` (Location) before demanding either field, both already
guard against a schedule with nothing to offer, and both were shipped and
verified in the 2026-08-30 round. Re-read line by line against the shipped
file before touching anything else in this round — still correct, nothing
regressed it. No change.

### ⚠️⚠️ Item 1 REVERSES the multi-upload allowance the previous round shipped

That round removed `capture="environment"` specifically because it silently
capped the picker to one file — fixing it made a batch of several photos
possible again. This round's ask is the opposite: **at most one photo or
video per "Add media"**. `#pp-files` drops `multiple` outright (a picker that
can't even offer more than one is safer than one that can and gets trimmed
after the fact), and `addStagedFiles(list)` — the one function both Take and
Upload funnel through — no longer **appends** to a growing `stagedFiles`
array; it **replaces** it: revokes any already-staged object URL, clears
`pendingMarkup`/`pendingAdjust`, and stages only the latest pick, with a toast
naming what happened when there was already something staged. Reusing this
one function is what makes the cap catch Take, Upload *and* a picker that
somehow still hands back more than one file in a single call, without three
separate checks.

### Item 3 — the native three-way chooser is a platform limit, and it turns out to cover BOTH kinds

The prior round's fix removed `capture=` from photo specifically because
that attribute forces the camera and, as a side effect, caps the picker to
one file. What it left unaddressed — flagged at the time as an "honest
platform limit" for **video** only — turns out to also describe **photo** on
a real device: with no `capture` attribute at all, both iOS Safari and
Android Chrome still present their own native chooser (Camera / Photo
Library / Files, or the platform's equivalent three-way sheet) for a bare
`<input type="file" accept="image/*">`. ⚠️ **There is no cross-browser HTML/
JS mechanism that skips straight to the gallery tab of that sheet** — this
was checked again this round, not assumed from the earlier entry, and the
conclusion is the same: nothing here can be fixed by this app's own code.
Recorded plainly rather than left as a silently-reopened bug report.

### ⚠️⚠️ Item 2 — the mic toggle now works at ANY point, because it stopped tearing the stream down to do its job

The previous round's mic button reopened the **whole camera+mic stream**
every time it was toggled, and refused outright — a toast, nothing else —
while a recording was in progress (the same restriction flip-camera already
has, and for the same underlying reason: a live `MediaRecorder` is bound to
whatever tracks its stream had at record-start). That refusal is almost
certainly what read as "not working": tapping mute mid-recording visibly did
nothing.

Audio is now requested **up front** for every non-photo capture
(`openStreamWithAudioFallback`, retrying video-only if the combined request
fails — a device with no microphone must not lose camera access outright
over an unrelated missing mic), and the toggle no longer reopens anything at
all: it flips the live stream's own audio **track's `.enabled` flag**. A
disabled track still exists and still feeds a live `MediaRecorder` — it just
contributes silence for that stretch — so muting/unmuting now works
identically before, during and after a recording, with nothing to race and
nothing to refuse. `syncAudioBtn()` disables the button and shows it muted
only when the stream genuinely has no audio track at all (the fallback
path), so a button that looks live never silently does nothing.

⚠️⚠️ **A second, real bug found while working on the same code, fixed
alongside it:** `startRecording`'s `recorder.onstop` handler closed over the
**module-level** `recorder` variable — and `close()` sets that variable to
`null` **synchronously**, the instant `recorder.stop()` is called, well
before the async `'stop'` event this handler answers actually fires. Reading
`recorder.mimeType` at that point threw `Cannot read properties of null`
**inside the browser's own event dispatch**, on every close (or shutter-stop)
that happened while recording — exactly the kind of failure that can read as
"the close button doesn't work" even though the overlay itself (torn down
synchronously in `close()`, well before this ever fires) was already gone.
Fixed by capturing the recorder instance in a **local** (`rec`) the closure
reads instead of the module-level var.

### ⚠️⚠️ Item 4 — the key-plan pin was green in TWO places, not the one place fixed last time

The previous round's fix (2026-09-11, first round of this same day) unified
the Gallery lightbox's corner overlay and the Presentation pane's overlay
onto one `BIM.keyPlanMiniMarkerHTML`, replacing a cruder duplicate — but it
never touched the actual **colour**, and it turns out "when photo is opened"
is answered by a THIRD code path this file hadn't looked at: module.js's
`paintKeyPlanOverlay()` manages the lightbox's own static
`#pp-lb-keyplan-overlay-pin` span **directly** (className + position), never
by regenerating HTML from `keyPlanMiniMarkerHTML` — so fixing that function
alone would have left the actual reported screen unchanged.

- **`.pp-kpmini-pin.pp-kpmini-pin-photo`** goes from `var(--pd-ok)` (green)
  to `var(--pd-red)` — matching `.bim-pinstage-dot`, the capture-time
  widget's own red circle, which is literally what "the same pin as when
  adding" means. The shape changed too: a 12px teardrop anchored at its
  base (`translate(-50%,-100%)`, `border-radius:50% 50% 50% 0`) becomes a
  16px **circle** centred on the point (`translate(-50%,-50%)`,
  `border-radius:50%`) — the teardrop was never what the capture widget
  drew, so matching it meant matching the shape too, not just the colour.
- **Both drawing paths now carry a real icon** — `Icons.svg(pin.direction_na
  ? 'drone' : 'person', 9)` — the identical rule `pinFieldHTML`'s own
  capture-time widget already uses. `keyPlanMiniMarkerHTML` (bim.js, used by
  `ppr.js`'s presentation pane) gained it in its returned HTML string;
  `paintKeyPlanOverlay` (module.js, the lightbox's own direct-DOM path)
  gained the identical `pinEl.innerHTML = ...` assignment, wired in
  separately since it never calls the shared function at all.
- ⚠️ The full-size Plans-tab marker (`.bim-pin`/`pinMarkerHTML`, a different
  screen entirely) is untouched — it still colours a photo pin green with a
  plain camera icon, which is that screen's own established convention and
  was not what this report was about.

### ⚠️⚠️ Item 5 — five separate pieces, one of them a real, previously-shipped stitching bug

**Fields shown up front.** `open360Upload`'s Description/Capture date/Works/
Location/Pin block used to live inside `#pp360-result`, hidden until the
stitch finished — the exact opposite of the ordinary photo/video Add Media
form, which shows all its fields immediately. That block now sits outside
`#pp360-result`, rendered the moment the modal opens; only the stitched
**preview** itself (which obviously cannot exist before processing) still
waits. The footer (Cancel/Save) is likewise no longer hidden behind
processing — Save already checked `if (!stitchResult || !repBlob)` and
toasts "still processing" rather than erroring, so showing it early costs
nothing.

**Pace moderation.** Two changes: the elapsed-time fallback's assumed "one
slow full turn" duration goes from 18s to 24s (used only when there's no
real compass to measure the actual turn against — a faster assumed pace had
the ring finish before a genuinely careful walk-around would); and, when a
real compass **is** reporting, actual angular speed is now measured between
consecutive readings and a "Slow down — turning too fast blurs the frames"
hint appears above `PACE_TOO_FAST_DEG_PER_SEC` (90°/s, roughly a full turn
in under 4 seconds) with a short hold time so it doesn't flicker on noisy
sensor data. Both target the same real problem: panning too fast starves
consecutive frames of the overlap `pano360.js`'s feature matcher needs.

**A navigable preview, not a static image.** The processed panorama used to
render as a plain `<img>`. It now reuses the **exact same** drag-to-pan strip
(`.pp-lb-panowrap`/`.pp-lb-pano`) the saved-360°-photo lightbox viewer
already has — `wireDragPan`, pulled out of `wirePanoDrag()` as a small
generic helper so both callers share one drag gesture instead of two
independently-behaved ones. `#pp360-panowrap`/`#pp360-pano` override the
lightbox's own 78vh sizing (correct for a full-viewport lightbox, far too
tall for a ~600px-wide modal) with a fixed 240px box via id-specific rules.

**Thumbnail defaults to the last frame.** The representative-frame scrubber
used to default to the walk-around's midpoint; it now defaults to the END
("the last frame will be used as thumbnail"), while staying adjustable in
case the very last instant is blurry (the camera still moving as recording
stopped).

**⚠️⚠️ THE REAL FIND: the stitching pipeline never accumulated its
homographies, and that is why processing was failing.** Reading
`pano360.js`'s `stitchFrames`/`warpOnto` before touching anything: every
frame past the first was warped using only its own **pairwise** homography
against the raw, un-warped previous frame — correct for frame 1, silently
wrong for every frame after it. Frame i−1's local pixel grid only coincides
with the growing mosaic's coordinate system for i=1; from i=2 on, frame i−1
had already been shifted within the mosaic by every homography applied
before it, and nothing accounted for that. The practical effect is not a
thrown error — a real image comes back — it is a mosaic that looks stitched
and is actually broken: frames past the first pair landing back near the
mosaic's own left edge instead of progressively further along it, with most
of the canvas past roughly one frame's width staying blank. That is exactly
"processing has been failing" with nothing on screen to explain why.

Fixed by **composing** pairwise homographies into one cumulative transform
per frame (`placements[i] = mat3Mul(placements[i-1], step)` — frame i's own
local coordinates mapped all the way into the mosaic's coordinate system,
anchored on frame 0's identity), then warping every frame with its own
cumulative transform into a canvas sized from the **real bounding box** of
every frame's warped corners (never a fixed-width guess, and clamped to
8000px so a runaway/garbage homography can't try to allocate an unbounded
canvas). A frame pair with no usable homography still gets a step (a pure
horizontal shift of the previous frame's own width) so it composes into the
same pipeline rather than needing a separately-shaped side-by-side fallback.
`warpOnto` (the old, buggy, non-accumulating function) is deleted, not left
dormant — nothing else in the app called it.

### Verified

**875 passed, 0 failed** (up from 854) — `pano360.js` is now loaded into the
test harness for the first time (it previously had no coverage at all
despite existing since the prior round); `mat3Mul`/`applyH3` are genuinely
executed against real inputs, including the exact shape of bug this fix
corrects (three composed 100px shifts must place the fourth frame at x=300,
not back near x=0 — the previous stitcher's actual failure mode). `capture.js`'s
new mic/audio-track logic, `recorder.onstop`'s local-var fix, `addStagedFiles`'s
single-item cap, `keyPlanMiniMarkerHTML`'s icon+colour, and the `wireDragPan`
refactor (re-confirmed to still coalesce a burst of scroll events into
exactly one queued rAF callback after being pulled out of `wirePanoDrag`)
are all covered by genuine execution or precise structural assertions, not
loosened regexes. `node --check` clean on all five touched JS files; CSS
braces balanced (539/539); 0 NUL bytes.

⚠️⚠️ **A real, pre-existing bug in the test harness itself was found and
fixed in the course of this**: an earlier test (the close-button/
`getUserMedia`-race check) monkey-patches `ctx.document.getElementById`/
`createElement`/`head`/`body` for its own controllable capture.js fixture
and never restored them — so every test that ran later in the same file
was silently reading through that patched stub instead of the shared
`byId`-backed one, auto-vivifying a bare fake element (no `addEventListener`
at all) for any id it hadn't seen. This went unnoticed until a new test
needed a real `addEventListener` and got a `TypeError` instead. Fixed by
capturing the four original values and restoring them in a `finally` —
worth recording because it means every test that happened to run after that
one in previous rounds was less trustworthy than its "PASS" suggested,
though none of the assertions in this codebase actually depended on real
DOM lookups after that point.

⚠️ **Not verified signed in or on a real device** — same standing caveat as
every entry in this file. In particular: the mic-mute fix's actual effect on
a recorded file's audio track, the pace-warning hint against a real
hand-held walk-around, the corrected stitching pipeline against a real
recorded video (the math is proven; a real photo has not been produced by
it), and the navigable preview's drag gesture in a real browser are all
unverified beyond genuine execution of the underlying pure logic.

`module.js`/`capture.js`/`pano360.js`/`bim.js`/`module.css` →
`?v=20260911z2`; the shared `MODULE_V` fallback (`assets/js/modules-grid.js`,
`dashboard.html`, `modules.html`) → `20260911z2` to match, since this
module's `index.html` itself changed. `ppr.js` is untouched and stays at its
existing `?v=`.

## Six-item capture-flow round: one input attribute was two bugs, a real
## close-button race, an audio toggle, and a 360° guide that actually tracks
## coverage instead of double-counting a pan (2026-09-11)

Owner, off the in-app camera work shipped the same day:
```
1. when uploading photos or videos, only 1 photo or video is allowed per instance
2. there are still some bugs in the take photo/video a the close button does not close
3. when clicking upload photo, it goes to camera. this should go to gallery
4. when clicking upload video, it still gives me three choices, take video/photo library/
   choose files. bring me to gallery directly
5. for video, provide option to include or exclude audio
6. for 360 photo, when taking video, improve 360 guide. show preview of 360 while video.
   see attached photo for concept of 360 guide
```

### ⚠️⚠️ Items 1 and 3 were ONE bug: `capture="environment"` on the Upload-photo input

`#pp-files`'s photo variant carried `accept="image/*" capture="environment"`. `capture` is a
request to open the device's live camera directly, and on real mobile browsers it does two
things at once, neither of them documented as obviously connected: it sends "Upload Photo"
straight to the camera instead of the photo library (item 3), **and** it silently caps the
picker to exactly one shot — a live camera capture has nothing to be plural about, so
`multiple` is ignored the moment `capture` is present (item 1). Removed entirely; "Upload"
now opens the ordinary file/photo-library picker for both photo and video (video never
carried the attribute, which is why only photo showed the symptom), where `multiple`
genuinely works. "Take Photo/Video" (`capture.js`, shipped the same day) is the one
deliberately single-shot path, and it stays that way on purpose — a live in-app capture
producing "several photos" at once wouldn't mean anything.

### Item 4 — the native three-way chooser on video upload is a platform limit, not a bug

⚠️ **Not fixed, because it can't be from here.** Once `capture="environment"` is gone, what a
mobile browser does with a bare `<input type="file" accept="video/*">` is entirely up to the
OS/browser — Android and iOS both offer their own multi-way sheet (record video / photo
library / files) for video specifically, and there is no HTML attribute that forces straight
to the gallery tab of that sheet the way there is for a hard camera-only request. Checked
directly rather than assumed: the one attribute that *could* narrow it (`capture`) is exactly
the one just removed for causing items 1 and 3, and re-adding it for video would reproduce
this round's own bug in the other direction. Recorded here as an honest platform limit rather
than silently left unaddressed.

### ⚠️⚠️ Item 2 — the real bug: an async race between `getUserMedia` and the close button

Reported again after the overnight round's own in-app camera shipped. `getUserMedia`'s
permission prompt is asynchronous — a fast tap on × while it's still pending used to race the
overlay's own teardown: `close()` ran first (removing the DOM, nulling `overlay`), and the
still-pending stream promise resolved *afterwards* and tried to attach a live camera stream to
a `<video>` element that no longer existed, and wire a flip-camera click handler onto a `null`
lookup — throwing inside an unawaited async continuation (a silent unhandled rejection, no
toast, nothing in the visible UI), **leaking the just-opened `MediaStream`** (nothing had ever
stopped its tracks), and leaving the device's camera indicator lit with no overlay left to
close it from. That is the "close doesn't close" report: the button visibly did nothing
because the code trying to notice it had already thrown.

Fixed with a session token (`capture.js:50`): `sessionToken` increments on every `close()`;
every continuation after an `await` (four separate `.then()` sites — the stream opening,
each of the three re-opens the flip-camera and new mic-toggle buttons trigger) captures its
own token at the start and checks `stale()` before touching the DOM or attaching anything.
A stream that resolves after the overlay already closed is stopped immediately
(`getTracks().forEach(t => t.stop())`) rather than attached to a removed element.

⚠️ **Contrast-checked, not just read**: temporarily disabled the `sessionToken++` in `close()`
and reran the suite — the new race test (`a stream that resolves AFTER close() is stopped
immediately, never attached to the (removed) video element`) genuinely fails against the
pre-fix shape (`got 0 want 1`), confirming the test isn't vacuous. Restored and reconfirmed
green.

### Item 5 — a mic on/off toggle, held across opens

A new `#pp-cap-audio` button (mic icon, red-tinted when muted) sits in the capture overlay's
topbar for video and 360° modes only — never for photo, which has no audio track to toggle in
the first place. `wantAudio` (default on) persists across opens the same way `curFacing`
already does, so turning the mic off once keeps it off next time. `audioNow()` = `mode !==
'photo' && wantAudio`, read by every `openStream()` call so the toggle actually changes what
`getUserMedia` requests. ⚠️ **Refused mid-recording**, the same rule flip-camera already
enforces and for the identical reason: a live `MediaRecorder` has already fixed the track it's
recording from, so flipping the mic under it would silently do nothing to the file being
produced — toggling it re-opens the stream via stop-then-reopen, which is exactly what a live
recording can't tolerate.

### Item 6 — the 360° guide now tracks *coverage of the ring*, not accumulated rotation

⚠️⚠️ **A real bug in the OLD guide, found while building the replacement**: the previous
`accumTurned` approach summed the absolute value of every heading delta without cancelling
direction, so panning back and forth (as any real hand-held walk-around does) inflated the
reported percentage past 100% without ever completing an actual turn — the "progress" bar was
lying upward, not just imprecise.

New model: the ring is divided into 24 fixed 15° buckets (`ringGuideHTML()`, modelled on the
attached Facebook-style 360° reference — a static ring of tick segments, a rotating
"facing" marker, and a live percentage label at the centre), and each new heading reading
marks every bucket **crossed since the last reading** as covered — `coverageSteps(lastBucket,
idx, total)`, a small pure function that walks the *shorter* direction around the ring between
the two bucket indices. ⚠️ **My first draft of this always walked forward**, which for a
backward pan (e.g. lastBucket 2 → idx 1) would have swept almost the entire ring the wrong way
(2→3→…→23→0→1) instead of the correct one-step move backward — caught in my own review before
it ever ran against a test, and covered explicitly now (`coverageSteps: moving BACKWARD by one
bucket walks the SHORT way`, plus the two wrap-boundary cases at 23→0 and 0→23 in both
directions, and the exact-half-ring tie). Percentage is `covered-bucket-count / 24`, so it can
never exceed 100% regardless of how much the camera pans back and forth.

⚠️ **Scope, stated rather than silently reduced**: this is direction-*coverage* tracking, not a
live-stitched panorama preview. A true "show the 360 forming as you record" preview would need
to warp and composite each new frame into the mosaic in real time during capture — a
materially larger piece of work than a coverage ring, and not attempted here. What's built
answers "have I turned enough, and which direction is still missing" — the concept in the
reference photo — without claiming to show the panorama itself mid-recording.

### Verified

**854 passed, 0 failed** (up from 839) — `capture.js` gained test coverage for the first time
in this pass (it previously had none at all): the removed `capture=` attribute (structural, on
both photo and video); the close-button race, via a hand-built fake DOM (tracked `onclick`
slots per element id) and a controllable `getUserMedia` Promise — tap × while the permission
prompt is still pending, confirm the cancel callback fires immediately with `null`, then
resolve the delayed stream and confirm its track was stopped (`stopped === 1`) rather than
attached; the mic toggle's conditional rendering (video/360 get the button, photo gets a plain
spacer, never both), `audioNow()`'s exact gating, and the mid-recording refusal; and six
genuine-execution cases for `coverageSteps` (forward one, backward one, no movement, both wrap
directions, the exact-half-ring tie) via a new `Capture._coverageSteps` test hook. `node
--check` clean on `capture.js`/`module.js`/`test.js`; 0 NUL bytes.

⚠️ **Not verified signed in or on a real device** — same standing caveat as every camera/
recording entry in this file. In particular: item 4's platform-limit claim (that no HTML
attribute can force video-upload straight to the gallery tab) is stated from documented
browser/OS behaviour, not observed on a real phone; the mic toggle's actual effect on a
recorded file's audio track, and the 360° guide's ring/percentage readout against a real
hand-held walk-around, have not been seen on a real device either.

`module.js`/`capture.js` → `?v=20260911d4`; `MODULE_V` → `20260911d4` (bumped because
`index.html`'s own asset `?v=` references changed).

## Fixed: the key-plan pin/camera-angle overlay drew the wrong-sized pin in the
## presentation pane — a real display bug, not a re-description (2026-09-11)

Owner: *"when photo is opened or in presentation, when key plan is shown, the pin and the
camera angle and direction does not display properly. display the pin and camera angle in
the same way they were defined to the photo. can you review again if these have been
applied, optimize code and performance, and clean-up code."*

**Investigated both surfaces named** — the Gallery lightbox's key-plan corner overlay
(module.js) and the Presentation pane's key-plan overlay (ppr.js). Both draw a floor plan
image plus the pin + camera-facing cone recorded when the photo was captured
(`floor_plan_pins`, via `BIM.pinInfoFor`), but they were built by two different code paths
that had quietly diverged:

- **module.js's lightbox overlay** builds its own small (12px) pin span
  (`.pp-lb-kpoverlay-pin`, now renamed — see below) and reuses only
  `BIM.coneWedgeSVGAt(pin, headingOffset)` for the cone. This was already correctly scaled
  for its ~1/8-photo-width corner box.
- ⚠️⚠️ **ppr.js's presentation-pane overlay called `BIM.keyPlanMarkerHTML(pin)`
  directly** — the SAME function bim.js's own full-window Plans-tab stage uses, which
  draws a **26px** `.bim-pin` teardrop marker. Correctly proportioned against a
  `min(70vh,640px)` stage; wildly, visibly oversized inside the presentation pane's
  60-90px corner box — exactly *"the pin ... does not display properly"*. The oversized
  pin also visually swamped the cone drawn underneath/around it, which is why the camera
  angle read as broken too even though its own geometry (`coneWedgeSVG`) was never wrong.

**Fix: one shared "mini" marker function, used by BOTH corner overlays, instead of the
lightbox hand-rolling its own small pin while the presentation pane reused the full-size
one.** New `BIM.keyPlanMiniMarkerHTML(pin)` (bim.js) = `coneWedgeSVG(pin)` (the same
accurate pie-slice geometry, unchanged) + a small `<span class="pp-kpmini-pin
pp-kpmini-pin-TYPE">` positioned at the pin's own `x_norm`/`y_norm` — no icon glyph, no
button chrome, sized to match what the lightbox already drew correctly. ppr.js's
`kpOverlay` now calls this instead of `BIM.keyPlanMarkerHTML`; module.js's lightbox path
was updated to build the SAME shared class name (`pp-lb-kpoverlay-pin`/`pp-lb-kppin-photo`
renamed to `pp-kpmini-pin`/`pp-kpmini-pin-photo`, in the CSS, the static `index.html`
skeleton, and `paintKeyPlanOverlay`'s className assignment) rather than keeping two classes
for one shape. `BIM.keyPlanMarkerHTML` (the full-size marker) is untouched and still used
by bim.js's own Plans-tab stage — nothing about the large view changed.

⚠️ **This directly answers "display the pin and camera angle in the same way they were
defined to the photo"**: both small-overlay contexts now draw the pin through the identical
function, at the identical relative scale, from the identical `x_norm`/`y_norm`/edge data —
they can no longer visually disagree with each other or with how the capture widget itself
rendered the pin+cone while it was being placed.

**Verified — genuine execution, not just a source read.** `BIM.keyPlanMiniMarkerHTML(pin)`
was called directly with a real pin (including a real recorded cone) and confirmed to
render the small `pp-kpmini-pin` span at the pin's exact `x_norm`/`y_norm`, the same
`coneWedgeSVG` output as before, and — the actual regression check — **no `.bim-pin`
anywhere in its output**, contrasted against `BIM.keyPlanMarkerHTML(pin)` on the identical
pin, which still draws `.bim-pin` and never the mini class. A `direction_na` pin (no
camera-facing recorded) draws the small dot with no cone in the mini marker too, matching
the full-size marker's own no-fabricated-cone rule. Reverted the ppr.js call back to
`BIM.keyPlanMarkerHTML` and re-ran the suite to confirm the new assertions genuinely fail
against the pre-fix shape (they do), then restored the fix.

**Clean-up done alongside:** removed the stray "lightbox"-scoped class name
(`pp-lb-kpoverlay-pin`) that ppr.js would otherwise have had to reuse under a
lightbox-specific name, and consolidated the CSS comment documenting why this shape is
scaled down to name both callers, not just one.

**Full suite: 839 passed, 0 failed** (up from 830 — 5 new genuine-execution checks for the
mini marker, plus source-level regression guards confirming ppr.js calls the mini marker
and never the full-size one, the CSS rename landed everywhere, and the `#fff` context
allow-lists were updated for the renamed class rather than silently widened).
`module.js`/`module.css`/`bim.js`/`ppr.js` → `?v=20260911c1`; `MODULE_V` → `20260911c1`
(bumped because `index.html`'s own asset `?v=` references changed again).

⚠️ **Not verified signed in or against a real device** — same standing caveat as every
entry in this file. The fix is proven by genuine execution of the real, shipped marker
functions against a real pin fixture; how the presentation pane's overlay actually looks
next to a real floor plan image has not been observed.

## Re-review of the overnight 10-item round: all 9 confirmed still correct, two
## real mobile-performance fixes (rAF-coalesced repaints), a dead-CSS sweep (2026-09-11)

Owner re-posted the original 9-item overnight list verbatim and asked: *"can you review again if
these have been applied, optimize code and performance, and clean-up code."* Three parts, taken in
order.

**Review.** Re-checked all 9 items against the shipped `module.js`/`bim.js`/`capture.js`/
`pano360.js` — every one is present and unchanged since the previous entry (Take/Upload split with
in-app capture; the staged-video-preview and Edit-video-preview fixes; `open360Upload()`'s capture
flow; the 360° pan viewer with the pin-cone rotating to follow it; Adjust extended to video/360 with
Markup and Key Plan gated correctly per kind; the in-form media-type toggle removed in favour of the
dropdown; Works/Location made optional when the schedule has nothing to offer; the Plan view's
First/Last steppers). No regression found; nothing needed re-doing.

**Performance — two real, previously-uncoalesced repaint paths, both on the mobile-heaviest gestures
in this module.**

- ⚠️⚠️ **`wirePanoDrag()`'s scroll handler repainted the key-plan cone on every `scroll` event,
  uncoalesced** — a pan drag across the 360° strip fires many `scroll` events per frame on a real
  device, and each one called `paintKeyPlanOverlay()` (a real DOM rebuild of the pin/cone SVG)
  synchronously, with no relation to the screen's own refresh rate. This is the exact
  drag-repaints-too-often shape this module's own history already fixed once, for the now-deleted
  cylindrical 360° viewer (2026-09-01), and the fix is the same established pattern: a dirty flag
  plus one `requestAnimationFrame`-queued repaint. `onScrollChange()` now only updates
  `lightboxPanoHeadingDeg` and schedules `repaintCone()` if nothing is already queued; the direct
  `onScrollChange()` call inside `pointermove` was also removed as redundant — the `scrollLeft`
  write it drives already triggers the native `scroll` event, which is enough.
- **`openMarkupEditor`'s canvas redraw was called synchronously from every `pointermove`** during a
  polygon-preview drag, a rotate, a resize, and the general select/stroke/shape-drag path — four
  call sites, each invoking the full `drawMarkupObjects()` repaint on every raw pointer event. Added
  `scheduleRedraw()` (a `mkRedrawRaf` dirty flag, same shape as the pano fix) and replaced those four
  call sites; the ~26 other `redraw()` calls elsewhere in the editor are discrete click actions and
  were deliberately left synchronous. The modal's `onClose` now also cancels any pending
  `mkRedrawRaf`, so closing mid-drag can't leave a stale `requestAnimationFrame` callback pointing at
  a canvas that's about to be removed.

⚠️ **Both fixes are proven to coalesce, not just described as coalescing.** The test harness's
`requestAnimationFrame`/`cancelAnimationFrame` stub is queue-based (`ctx.__rafQueue` +
`flushRaf()`/`rafPending()`), not an immediate-call stub — the "a test that cannot fail is not
evidence" trap this repo's own history repeatedly warns about. A new genuine-execution test drives
the real, shipped `wirePanoDrag()` (via a new `PP._wirePanoDrag()` test hook) against a fake
`#pp-lb-panowrap` element with a capturing `addEventListener`, fires three rapid `scroll` events, and
asserts exactly **one** rAF callback is queued — not three. Reverting the coalescing guard (checked
directly, then restored) makes that same assertion fail 3-vs-1, confirming it genuinely bites.
Flushing the queue drains it to 0, and a further scroll afterward schedules a fresh callback — the
guard resets per burst rather than latching permanently. `scheduleRedraw()`'s guard and its four
call sites are covered by structural assertions (the same convention this file already accepts for
pointer-gesture code the fake DOM's no-op `addEventListener` can't genuinely drive).

**Clean-up.** Removed `.pp-mtypesel`/`.pp-mtype`/`.pp-mtype.active`/`.pp-mtype:disabled` from
`module.css` — dead CSS left behind when `mediaTypeSelectorHTML`/`wireMediaTypeSelector` (the
in-form Photo/Video toggle) were retired in the overnight round; confirmed orphaned by grepping both
class names against every JS/HTML file in the module before deleting. A broader class-usage sweep
across the rest of `module.css` turned up nothing else safely removable — the remaining
"unreferenced" hits are either comments naming Drawing Register's own class names (a documented
borrowed-convention note, not dead code here) or classes built by string concatenation
(`'ppr-kp' + which`, `'bim-pin-' + type`), which a static grep can't resolve and which this file's
own history already warns against blind-deleting.

**Verified:** `node --check` clean on `module.js`/`test.js`/`modules-grid.js`; CSS braces balanced
(536/536); 0 NUL bytes. **830 passed, 0 failed** (up from 822 — 8 new checks, all executing real
shipped code or asserting the exact CSS/JS shape of the two fixes). `module.js`/`module.css` →
`?v=20260911b1`; `MODULE_V` → `20260911b1` (bumped because `index.html`'s own asset `?v=` lines
changed, which is itself a change to `index.html`'s bytes — the standing rule this repo's history
records repeatedly).

⚠️ **Not verified signed in or on a real device** — same standing caveat as every entry in this
file. The coalescing itself is proven by genuine execution against a real, queue-based rAF stub; how
the 360° pan and markup-editor drag actually *feel* on a real phone has not been observed.

## The 15 pre-existing test failures, resolved: 12 stale assertions fixed
## in place, 2 real gaps found in the harness itself, 0 app-code bugs (2026-09-11)

Owner: "can you also resolve the 15 failed tests" — the ones the previous entry documented as
pre-existing and out of scope. Investigated every one individually rather than patching regexes to
make them pass; the honest split turned out to be:

- **12 were stale exact-string/exact-count assertions** against source that had genuinely, correctly
  moved on since the test was written — none of them a real defect. Root causes, each confirmed by
  reading the actual current code before touching the test: `insertPresentation()`/`finish()` moved
  their `.insert(...).select()` call into a shared helper (also carrying the Report Type
  migration-tolerant retry) that a later refactor introduced; the Report Type `<option>` tags gained
  a conditional `selected` attribute; `pane()` no longer reads Trade/Works at all — a **later, separate**
  owner ask removed that whole caption line on purpose ("no need to include as caption all the
  activities performed"); the PPTX shared-location text is now wrapped in `sanitizePptxText()` (the
  2026-09-03 PowerPoint-corruption fix, applied to every PPTX string); `bim.js`'s `plans()`/
  `pinFieldHTML()` read through `currentPlansList()`/`curPlans` (the floor-plan-revisions feature,
  2026-09-03) instead of the raw `plans` array; ppr.js's Clear-filters reset gained `reportType: ''`;
  the Works empty-state string was deleted outright when item 8 (this same week) made the whole field
  omit itself rather than show an empty picker; and two legitimate `#fff`-on-`--pd-red` badges
  (`.ppr-panelabel.is-current`, `.bim-revbadge`) had simply never been added to the allow-list regex.
  Each fix is a comment explaining what changed and why the new pattern is correct, not just a
  wider regex.
- **2 were counting assertions that needed to grow from 2 to 3** — `works_activity_ids`/
  `location`/`view_name` are now written by Add, Edit, **and** the new `open360Upload()` save path
  (yesterday's own work), so the exact occurrence counts genuinely increased.
- **1 was a real gap in the test harness, not the app** — the three `wireStageInteractions()`
  window-listener assertions (`bim.js`) had gone permanently unreachable after the 2026-08-30
  "Project Schedule is the only source of truth for Tower/Floor" business rule made `render()` stop
  at `hasEstablishedLocations()` before ever reaching the stage HTML those listeners attach to. The
  harness deliberately never calls `PP.init()`/`load()` (a documented, load-bearing choice elsewhere
  in this file), so `window.ProgressPhotos.locLevels()`/`distinctLocValuesFor()` always read empty
  here — no amount of seeding `store.location_levels`/`store.project_schedule` could have satisfied
  it, since `bim.js` only ever asks the OTHER module's live object for that data. Fixed by stubbing
  `PP.locLevels`/`PP.distinctLocValuesFor` directly for the duration of this one test block
  (save/restore, the same convention this file already uses for `PP._setCanWrite`), and tagging the
  section's own seeded floor plan with matching `location_values` so `currentPlanFor()` actually
  resolves it — confirmed necessary by direct instrumentation (`bim-view`'s rendered HTML read "No
  floor plan uploaded" until both were in place, `wireStageInteractions()` never having a stage to
  wire against).

⚠️ **The "bim.js's render() replays toolsVisible" assertion also needed re-scoping, not
re-writing** — its `{0,60}`/`{0,400}`-style character budgets between two known-good literal strings
were measured against the WRONG occurrence of a common early-return guard (`if (!host) return;`
appears in more than one function in this file) or against a comment block wider than the budget
allowed; re-anchored to `render()`'s own function body specifically, with the real measured gap.

**Verified:** every fix confirmed by locating the exact current line in the shipped source first
(never by widening a regex blind), then re-running the full suite. **822 passed, 0 failed** — up
from 806/15 the previous entry left it at. `node --check` clean on `test.js`/`module.js`/`bim.js`;
no application code changed in this pass — every fix above lives in `test.js` alone (or, for the
harness gap, in the fixture the failing test itself builds).

⚠️ **Not verified signed in** — same standing caveat as every other entry in this file; this was a
test-suite correctness pass, not a live click-through.

## In-app camera capture, real 360° stitching, a 360° pan viewer, and a
## ten-item overnight round following the 360°/3D deletion (2026-09-10/11)

Owner, immediately after the 360°/3D deletion (session below): a ten-item list to build a fresh
360° feature and fix reported bugs, explicitly authorized to run unattended overnight
("while I am asleep until 8am"). No live signed-in session or real camera/device was available in
this environment for any of it — every claim below is source-level review, `node --check`, CSS
brace-balance and manual re-reading of the edited regions, the same standing limitation this file
has recorded for every camera/recording feature it has ever shipped.

**New `capture.js`** — `window.Capture = { takePhoto, takeVideo, take360, close }`, a full-screen
overlay styled after Photo Booth/iOS Camera (live stage, a circular shutter, a flip-camera button,
a close ×). Each function hands back a Blob (or `null` on cancel) via callback; nothing here talks
to Supabase — the module's own upload pipeline is still the one place a file, camera-captured or
picked from disk, ever becomes a saved row. `take360` adds a compass-driven progress ring (iOS 13+
`DeviceOrientationEvent.requestPermission()`, triggered on the first tap so it runs inside the
required user gesture) with a time-based fallback everywhere orientation is unavailable.

**New `pano360.js`** — `window.Pano360`, a from-scratch stitching pipeline (the earlier one was
deleted at the owner's own request, "start fresh"). ⚠️ Same honest scope as before: standard
OpenCV.js builds have no `cv.Stitcher`, so this composites ORB + BFMatcher(Hamming) + ratio test +
`cv.findHomography`(RANSAC) + `cv.warpPerspective` frame-by-frame into a **cylindrical mosaic**, not
a true equirectangular sphere — stated in the file's own header, not silently shipped as more than
it is. Quality is flagged (`'poor'`) rather than hidden when a frame pair matches too few keypoints.
`extractFrameAt`/`getDuration` back the representative-frame picker (item 3).

**Items 1/2/5/6 — `openUpload` rebuilt.** The in-form Photo/Video type toggle
(`mediaTypeSelectorHTML`/`wireMediaTypeSelector`) is gone — the "+ Add media" dropdown decides the
kind before the modal opens, and the modal is built once for that fixed kind (item 6). Two buttons,
**Take Photo/Video** and **Upload Photo/Video**, both feed the SAME staged-file array (`stagedFiles`)
— a capture and a chosen file interleave freely, appended in whichever order the planner used them
(item 1). ⚠️ **The staged-grid video-preview bug is fixed**: every staged file now gets a real
object URL and a real `<video>` preview element — the old code only ever created an object URL for
`/^image\//` files, so a staged video rendered as a bare filename placeholder with no preview at
all (item 2). Adjust now offers itself for **every** staged file, photo or video; Markup stays
photo-only (item 5) — matching the owner's explicit "no need for mark-up for video and 360".

**Item 2 (second instance) — `openForm`'s Edit-photo preview.** The same class of bug: editing an
existing **video** row previously rendered nothing (`thumbUrlOf()` resolves to `''` for a video,
which has no thumbnail stand-in, so `previewSrc ? '<img>' : ''` silently omitted the whole preview).
It now renders a real `<video>`, resolved via the same `ensureFullUrl()` the lightbox already uses.
A 360 row's `thumb_url` **is** its representative frame, so the existing `<img>` path already works
correctly for it — no special case needed.

**Item 3 — a dedicated 360° upload flow, `open360Upload()`.** ⚠️ Deliberately **not** folded into
`openUpload`'s batch pipeline — a 360° capture is one video in, one stitched-panorama row out, a
different shape from N files → N rows. Take 360°/Upload 360° video → (if offline, stop here and
offer a **Save video to gallery** download link rather than attempting to process-then-upload,
since there is nowhere to queue a not-yet-stitched panorama offline) → `Pano360.stitchFromVideo`
with a two-stage progress readout → a preview of the processed panorama, a low-confidence badge
when `quality==='poor'` → a **representative-frame scrubber** (`Pano360.extractFrameAt`, debounced)
whose frame becomes `thumb_url` and is also what the Key Plan pin/direction is captured against
(reusing `BIM.pinFieldHTML`, unchanged) → the same Description/Capture date/Works/Location/View
name fields every other capture uses. Saves as a `progress_photos` row with `media_type:'360'` —
⚠️ **the single unified media table, never a second `panoramas` table** — this repo's own history
already records having to undo exactly that split once; `floor_plan_pins.item_type` stays `'photo'`
universally, so bim.js needed no schema change.

**Item 4 — the 360° viewer.** A `.pp-lb-panowrap` strip (`overflow-x:auto`, native touch swipe for
free, plus `wirePanoDrag()` for a mouse drag) replaces the ordinary `<img>`/`<video>` in the
lightbox when `media_type==='360'`. No Markup (toggle and edit both hidden, same as video); Key
Plan **stays available** (gated on `!isVideo`, which a 360 row already satisfies). ⚠️ **The camera
direction actually follows the pan**, not just a static cone: `wirePanoDrag`'s scroll handler
computes a heading fraction (`scrollLeft / maxScroll * 360`) into `lightboxPanoHeadingDeg`, and
`paintKeyPlanOverlay` now calls a new `BIM.coneWedgeSVGAt(pin, headingOffset)` — the same accurate
edge-based cone geometry as `coneWedgeSVG`, with the resolved direction rotated by that offset —
instead of the fixed `coneWedgeSVG(pin)`. For an ordinary photo the offset is always 0, so this is
byte-identical to before for everything that isn't a 360 photo.

**Item 5 — Adjust/Markup/Key-Plan gating, consolidated.** Markup (toggle + edit) excluded for
video AND 360; Adjust available for photo, video AND 360 (`openAdjustEditor` gained an `isVideo`
flag that swaps its canvas+sharpen preview for a live `<video style="filter:...">` preview — CSS
`filter` applies to a `<video>` exactly like an `<img>`; Sharpness, which has no CSS equivalent, is
simply not offered on that path rather than silently doing nothing); Key Plan excluded for video
only, available for photo and 360.

**Item 7 (partial) — a real, confirmed waste removed from `signAll()`.** Its transform-fallback
branch requested an image-transform signed URL for **every** thumb-less row's `photo_url`,
including **video** rows — a video file run through an image transform, populating a `thumbCache`
entry `thumb()`'s own video branch never reads (it resolves a video preview via `urlOf()`/the lazy
intersection-observer path instead). Now excluded by `media_type !== 'video'`. ⚠️ **Broader mobile
perf work (item 7's fuller ask) was not separately audited this round** — the 360 viewer's own
plain-2D-pan choice (no WebGL/Three.js) already serves that goal directly, per pano360.js's header.

**Items 8/9/10 — already landed in this same session before this entry was written** (Works/
Location made optional when the schedule/Location Breakdown genuinely has nothing to offer; the
Plan view's Live button replaced with First/Last steppers; the key-plan pin+cone now drawn via the
same accurate edge-based geometry everywhere it renders, fixing a real bug where the Plans-tab
marker and the lightbox overlay each drew a cruder approximation than the capture widget itself).

**Verified**: `node --check` clean on `module.js`/`bim.js`/`capture.js`/`pano360.js`/`ppr.js`; 0 NUL
bytes across every touched file; `module.css` braces balanced (540/540); 0 duplicate DOM `id=`
attributes in `index.html`. `module.css`/`module.js`/`bim.js`/`capture.js`/`pano360.js` →
`?v=20260910zd`.

**`test.js` updated, not left stale.** Every assertion this round's own changes made incorrect was
rewritten to match the current behaviour, not silently deleted — the retired
`mediaTypeSelectorHTML`/`wireMediaTypeSelector`, the Plan view's Live-button removal (item 9, done
earlier in this same session but never reflected in the suite until now), the pin-cone rewrite
(item 10) that replaced a fixed-angle rotated wedge with the shared `coneWedgeSVGAt`, the Adjust/
Markup/Key-Plan gating changes (item 5), and the three save-payload literals that legitimately grew
a third occurrence (Add/Edit/360). **806 passed, 15 failed** (was 790/35 before this pass's own
fixes) — every one of the 15 remaining failures was confirmed, by direct inspection, to predate this
round: each references code this session never touched (`bim.js`'s `plans()`/`pinFieldHTML`/
`wireStageInteractions`, `ppr.js`'s Report Type select and `finish()` ordering, the `.select()`-on-
insert claim, the `#pp-lb-cap` trade/works/location assertion, the Clear-filters/archived-toggle
assertion, the PPTX shared-location-tile assertion, and the Works empty-state string that a prior
turn's item 8 fix already superseded) — none is new, and none is claimed fixed here.

⚠️ **Not verified signed in, and this round most needs it.** No live click-through exists for: the
in-app camera overlay against a real device camera; a real recorded 360° walk-around through the
actual stitching pipeline; the representative-frame scrubber and Key Plan capture against a real
video; the pan-viewer's drag gesture and the cone-follows-pan behaviour in a real browser; or the
Adjust editor's live `<video>` CSS-filter preview. `test.js` has not been updated for any of this
round's changes and needs a pass before this is considered fully verified per this module's own
convention.

## 2026-09-09 (p3) — The gallery stops looking like a folder of files

Owner: *"Project Photos, I want this not to look like a windows explorer folder view looking like a
bunch of photos database. Let's compile properly."*

⚠️⚠️ **The resemblance was not a metaphor — it was the tile size, and it is MEASURED.**
`gallerySizeScale` defaulted to **1/3** against `TILE_BASE_MIN = 290` / `TILE_BASE_H = 210`, which
resolves to a **125px card holding a 70px-tall image**. That is Explorer's small-icon density almost
exactly. The default is now **0.75** → a **263px card with a 158px image**: a grid you read rather
than an icon wall you scan. Both figures are real browser measurements of the shipped `galleryHTML`.

⚠️ **The other half was that the tile carried NO TEXT AT ALL.** `cardHTML` emitted an image and a
checkbox and nothing else, so a wall of them cannot read as anything but a file listing. Each tile now
carries a two-line caption — description, then date · location. ⚠️ Deliberately **not** the full
metadata: the lightbox owns that (a 2026-08-28 decision this does not reverse). Both lines are
`white-space: nowrap` + `text-overflow: ellipsis`, because a tile that grows to fit its text destroys
the grid rhythm.

⚠️⚠️ **A STORED SCALE IS NOW ONLY HONOURED ONCE THE SLIDER HAS ACTUALLY BEEN MOVED**, and without this
the fix would have reached nobody who reported it. Every existing user has a stored `1/3` written by
the *old default*, which is indistinguishable from a deliberate choice — so inferring intent from the
value would either strand them all on the tiny tiles, or silently overrule someone who genuinely wanted
them. A new `tilescaleset` flag records the choice at the moment it is made.

⚠️ **The phone grid is untouched and gets no captions.** Below 768px it is a deliberate 3-column,
2px-gap, `aspect-ratio:1` iOS-Photos wall; a caption strip under a ~120px tile is unreadable.

**Verified** by slicing the shipped `galleryHTML` out of `module.js` and executing it against fixtures
in a browser with the real stylesheet: at the shipped default **0 caption lines clipped and 0 wrapped**
across 14 lines, `white-space: nowrap` and `text-overflow: ellipsis` both confirmed applied; dragged to
1.5 also clean; dragged to 1/3 the captions clip with an ellipsis, which is that rule working rather
than a defect. ⚠️ My first overflow probe was written `? false : false` — an assertion that could never
fail — alongside a "wrapped" counter that was really re-detecting overflow (it returned the same 10 as
the clip counter). Both were redone before any of the above was believed.

`module.js` / `module.css` → `?v=20260909p3`; `MODULE_V` → `20260909p3`.
⚠️ **Not verified signed in** — no real photo row has been rendered.

## PR review found two gaps in the fix below — fixed before merging (2026-09-08)

A code review of the PR carrying the fix below (git diff against `main`) surfaced two real,
non-blocking findings — fixed the same session, before merging, per the reviewer's own request.

**1. The "Previously used" bucket bypassed the floor-label filter.** `worksGroupedOptions()`'s
trailing bucket is built from `distinctCapturedWorks()` — a scan of already-SAVED photo rows, not
the schedule — and never called `isLocationLabelActivity()`. A photo saved with a floor-name Works
value (e.g. typed or picked before this fix existed) would still surface that floor name under
"Previously used". Confirmed dormant on AVR101 today (queried `progress_photos` directly: none of
its 3 rows carry a floor-name Works value) but a real, untested gap in the "no floor labels
anywhere" claim for any project with older captured data. Fixed with one added condition:
```js
var extra = distinctCapturedWorks().filter(function (v) { return !already[v] && !locKeys[locNormKey(v)]; });
```
A previously-captured value is now held to the exact same rule as a schedule-derived one — its name
must not match a value the project's own Location Breakdown already uses.

**2. The branch-name exclusion was untested beyond AVR101.** `EXEC_BRANCH_EXCLUDE_TERMS` (now just
`'general requirement'`) is a static, per-project-unverified name match applied to every project
using this module — the exact same shape of assumption that caused the Construction Phase bug this
PR was already fixing (a screenshot-based rule that turned out wrong once tested against real data).
Hardened `execExcludedCodesFrom()` to self-verify before excluding: a name-matched branch is now
skipped (not excluded) if it's found to contain any already-classified trade work (any activity
under it, any depth, with a non-blank `work_type`) — `branchHasClassifiedWork(code, schedActs)`. If
a future term, or 'general requirement' on some other project, turns out to nest real trade content
the way Construction Phase did here, this refuses to exclude it and logs a `console.warn` naming the
branch, rather than silently repeating the same bug on a different project.

Confirmed this is a true no-op for AVR101 (queried live: General Requirements' 22 rows all have
`work_type: null`, so it's still correctly excluded, `console.warn` never fires) — the full picker
re-tested live afterward is byte-for-byte identical to before this hardening.

Both fixes verified by genuine execution (not fixtures presented as production behavior, and not
live writes to AVR101's real data):
- `_execExcludedCodesFrom`/`_branchHasClassifiedWork` run against a synthetic "General Requirements
  contains real Structural Works" fixture correctly REFUSE to exclude it (`[]`), and against a
  fixture matching AVR101's real shape (no classified work under General Requirements) still
  correctly exclude it (`["4.1"]`).
- `_worksGroupedOptions` widened with an optional 6th param (`capturedRows`, save/restore-injects
  the real `rows` array — the same convention as its other injected closure state) so a captured
  "6th Floor" Works value could be proven excluded from "Previously used" without writing a
  throwaway row into any live project's database.

`module.js?v=` → `20260908f` (module-local only; `module.css` unchanged, stays `20260907b`).

## Live UI test on AVR101 found the Round-1 fix (below) was wiping ~3,600 real trade
## activities — "Construction Phase" is a WBS container on this project, not an admin bucket
## (2026-09-08)

Owner's explicit instruction this round: perform the actual live UI test (Progress Photos →
Add Media → Works → Other) against the real, running app and real AVR101 data — not fixtures,
not code inspection — and fix whatever the live test finds before reporting done.

### What the live test found

Signed into the local dev build (serving this module's own uncommitted `module.js`, connected to
the real Supabase backend) and opened Add Media → Works on AVR101. The floor-label fix (the entry
below) worked exactly as designed — searching "Floor", "6th", "Roof", "Roofdeck", "Ground Floor"
all correctly returned zero matches. But the picker as a whole had collapsed to almost nothing:
**Other (18) / Site Development (9) / Structural Works (3) / Previously used (1)** — no
Architectural Works, no MEPF Works, no Allied Services group at all. Searching "Waterproofing" (a
real `Architectural Works`-tagged activity, confirmed present and correctly offered on the
**deployed, unfixed** site) returned **zero matches** on the fixed build.

The module's own diagnostic console line named the cause directly:
`excluded branch codes=["4.1","4.2"]`, `108 in Execution/Close-out scope` — out of AVR101's 4321
activities. Querying `project_schedule` directly through the live, authenticated session (via
`window.AppAuth.getSB()`) confirmed the real WBS shape:

```
wbs "4"   = Execution Phase
wbs "4.1" = General Requirements       (a genuine flat admin/mobilization branch)
wbs "4.2" = Construction Phase         (contains 1000+ rows — the query cap; real count is higher)
wbs "4.2.<tower>.1" = Structural Works    (once per tower, towers 1–7)
wbs "4.2.<tower>.2" = Architectural Works (once per tower)
wbs "4.2.<tower>.3" = MEPF Works          (once per tower)
wbs "4.3" = Site Development Works     (a direct Execution-Phase sibling)
```

**"Construction Phase" is the literal WBS parent of every per-tower Structural/Architectural/MEPF
branch on this project — not a sibling admin bucket alongside them.** The [[exec-branch-exclusion]]
fix below (2026-09-08, Round 1) excluded it wholesale as a direct child of Execution Phase, on the
strength of the owner's own screenshot showing General Requirements/Site Development/Structural
Works/Architectural Works/MEPF Works/Allied Services/Construction Phase as apparent siblings. That
screenshot reflected a rolled-up/aggregated tree view, not each branch's literal one-level WBS
parentage — excluding the literal `"4.2"` branch by prefix (`wbsUnderRoot`) discarded every trade
activity nested under it, which is nearly the entire schedule (Structural 16 + Architectural 15 +
MEPF 3 groups' worth of distinct names, thousands of rows).

General Requirements (`"4.1"`) has no such nested trade content — confirmed live, it is a genuine
flat branch with no Structural/Architectural/MEPF children — so it stays excluded correctly.

### The fix

One line, in `module.js`: `EXEC_BRANCH_EXCLUDE_TERMS` drops `'construction phase'`, keeping only
`'general requirement'`. No other logic changed — `execExcludedCodesFrom()`, `inExecOrCloseout()`,
and the floor/location-label exclusion (below) are all untouched; this only narrows which branch
NAME is looked up and excluded, using the exact same live-schedule-name-resolution mechanism as
before (no hardcoding, no new master data).

⚠️ **This correction reverses part of a rule the owner explicitly specified in the original
Message A request** (based on that request's own screenshot) — but the owner's stated goal was
"only Site Development/Structural Works/Architectural Works/MEPF Works/Allied Services are
eligible," and excluding the WBS container that literally holds three of those five branches
directly contradicted that stated goal once tested against the real data. Flagged prominently
rather than silently changed.

### Verified — genuine live re-test, same session, same AVR101 project

Console diagnostic before/after the fix, same project, same schedule:

| | before (Round 1 as shipped) | after (this fix) |
|---|---|---|
| excluded branch codes | `["4.1","4.2"]` | `["4.1"]` |
| activities in scope | 108 | **3922** |
| distinct Works names | 30 | **61** |

Full picker content after the fix, live on AVR101 (Expand all, no search filter):
- **Structural Works (16)** — Backfilling Works with Binder System, Backfilling and compaction,
  Concreting, Excavation, Formworks, Formworks / Precast, Gabion (including miscellaneous), Gravel
  Bedding, Gravity Wall, Haul-out Materials, Lean Concrete, Precast, Precast Delivery On-Site,
  Rebar, Soil Treatment, Trimming Works
- **MEPF Works (3)** — 1st Fix, 2nd Fix, 3rd Fix
- **Architectural Works (15)** — Concrete Floor Topping, Door Installation and Lockset, Final
  Painting Works, Masonry Works, Metal Works, Modular/Cabinetry, Primer Application, Rubbed
  concrete (Stru Rect), Sealant Works (Exterior/Interior), Skim Coating, T&B Water closet Drywall,
  Tile Works, **Waterproofing**, Window Installation
- **Site Development (9)** — Base Course, Concrete 3000 psi, Finishing, Formworks, Rebar,
  SUBGRADE, Site Development, Surface compaction, Vas-Built PC Panel
- **Allied Services (2)** — Elevator, Generator
- **Other (18)** — Commercial/Financial/Technical Closeout, Resource Demobilization, Tower 1–7
  Full/Partial Closeout — **zero floor or location names**, confirmed by search: "Floor", "6th",
  "Roof", "Roofdeck", "Ground Floor" all return "No Trade or Activity matches" against the live,
  real, post-fix picker.

No `General Requirements` group. No `Construction Phase` bucket (its real content is now correctly
distributed across the trade groups it actually belongs to, exactly as it always should have been).

**This is genuine execution against the live, authenticated app and the real AVR101 database** —
not a fixture, not a mock. `AppAuth.getSB()` was used to run read-only diagnostic queries
confirming the exact WBS codes, row counts, and `work_type`/`location` values behind every claim
above, and the Add Media → Works picker was driven end-to-end in a real browser session.

`module.js?v=` → `20260908d` (module-local only; `module.css` unchanged, stays `20260907b`).

## Floor/location labels excluded from the Works picker — a structural rule, not a name list
## (2026-09-08)

Third round of the same AVR101 investigation. After excluding General Requirements/Construction
Phase (the entry below), floor-named activities ("6th Floor", "Ground Floor", "Roof Deck",
"Roofdeck") kept appearing under "Other" — traced across several read-only diagnostic rounds
(all data pulled by the owner from their own signed-in session; this environment has no live DB
access at all, confirmed by a direct probe returning `42501 permission denied` for an
unauthenticated read).

### What the diagnostics established, in order of elimination

- **Not a misclassified `activity_type`.** Every floor-named row is genuinely `'Task'`, not a
  `'WBS Summary'` heading that slipped through — disproved a self-referencing-parent-name
  hypothesis outright (0 of hundreds of blank-`work_type` rows matched their own immediate WBS
  branch's name).
- **Not a "which WBS branch" problem.** The 329 blank-`work_type` Tasks span almost the entire
  project lifecycle — Initiation Phase, Planning Phase, Closeout Phase, **and** Execution Phase ›
  Construction Phase › Tower N › non-trade sub-branches (e.g. "Testing and Commissioning"). No
  branch-exclusion rule (the earlier General Requirements/Construction Phase fix included) can
  reach most of these rows, since most of them aren't even under Construction Phase.
- **Not a corrupted/gapped WBS trail.** 328 of 329 blank rows have a fully-named, gap-free
  ancestor chain — `discCanonOf()` (Project Schedule's own trade classifier) had a complete
  chain to search and correctly found no trade term in it. **The blank `work_type` is accurate,
  not a data defect** — these activities genuinely have no discipline, whether they're a floor
  label or a legitimate admin/closeout activity.
- **The one difference found**: `location`. Every admin/closeout example (`Resource
  Demobilization`, `Technical Closeout`, …) has `location: null` or `{}`. The one floor example
  traced in full (`"6th Floor"`) carried a real `location` value. That distinction — "does this
  activity's own name coincide with a value this same project already uses as a Tower/Floor/Zone
  location" — is what the fix below operationalizes.

### The rule (scoped to blank `work_type` only, per the owner's explicit narrowing)

```js
// module.js, above distinctScheduleWorks()
function locNormKey(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function scheduleLocationValueKeys() {
  var set = {};
  LOC_LEVELS.forEach(function (lvl) {
    distinctLocValues(lvl.id).forEach(function (v) { set[locNormKey(v)] = true; });
  });
  return set;
}
function isLocationLabelActivity(a, locKeys) {
  if (a.work_type && String(a.work_type).trim()) return false;
  return !!locKeys[locNormKey(a.activity_name)];
}
```

An activity is excluded from `distinctScheduleWorks()`/`worksGroupedOptions()` when **both**:
`work_type` is blank, **and** its own `activity_name` (normalized) matches a value this same
project's schedule already uses as a Location Breakdown value (Tower/Floor/Zone/…) anywhere.

⚠️ **Deliberately not a name list.** It asks *this project's own schedule data* what counts as a
location — via `distinctLocValues()`, the exact function that already populates this module's own
Tower/Floor/Location fields — so it holds on any project regardless of floor count or naming
convention, and needs no maintenance if a project's floor names change.

⚠️ **Scoped to blank `work_type` only, on purpose, per the owner's explicit instruction.** A real
trade activity is never named a bare location string in practice, so this can never touch a
properly-classified row — but gating on blank `work_type` as well removes any theoretical risk
from that edge case, at zero cost, since every confirmed problem row already satisfies both
conditions.

⚠️ **Normalization folds case/spacing/punctuation** — the same technique Project Schedule's own
`locNormKey()` uses to merge "Roof Deck" and "Roofdeck" into one location value. Without it, a
project using both spellings (schedule data commonly does, per Project Schedule's own history)
would only catch one of the two.

⚠️ **`Resource Demobilization` / `Technical Closeout` / `Financial Closeout` / `Commercial
Closeout` and every other non-floor blank-`work_type` activity are deliberately untouched** —
none of them is ever offered as a Tower/Floor/Zone value anywhere in a real project's Location
Breakdown, so none of them can ever match `scheduleLocationValueKeys()`. Confirmed by genuine
execution below, not assumed.

Applied identically in both `distinctScheduleWorks()` (the flat suggestion list) and
`worksGroupedOptions()` (the grouped picker, source of the "Other" bucket) — right after the
existing Start/Finish Milestone exclusion, before the Execution/Close-out scope check, so the two
functions can never disagree about which activities are eligible Works candidates.

### Verified

⚠️ **This environment has no live Supabase session** (same standing limitation as every prior
round in this thread) — verification is genuine execution of the exact shipped functions, sliced
verbatim from `module.js` (never retyped), against a fixture built to reproduce the confirmed
AVR101 diagnostic shape:

- A real Floor-tagged activity elsewhere in the project makes "6th Floor"/"Ground Floor"/"Roof
  Deck" genuine location values (`scheduleLocationValueKeys()` correctly resolves to
  `{tower3, 4thfloor, 6thfloor, groundfloor, roofdeck}`).
- `"6th Floor"`, `"Ground Floor"` (blank `work_type`) → `isLocationLabelActivity` returns `true`
  → **absent from both `distinctScheduleWorks()` and every group, including "Other".**
- `"Roofdeck"` (no space, blank `work_type`) tested against a location value stored as `"Roof
  Deck"` (with a space) → still correctly matched and excluded — the normalization fold works.
- `"Resource Demobilization"`, `"Technical Closeout"`, `"Financial Closeout"`, `"Commercial
  Closeout"` (all blank `work_type`, no location) → `isLocationLabelActivity` returns `false` →
  **unchanged, still present, still bucketed under "Other" exactly as before.**
- `"Formworks"`, `"MEP Rough-in"`, `"Slab Pour"`, `"Waterproofing"` (real `work_type`) → never
  even tested against the location check (short-circuited by the `work_type` guard) → grouped
  under their own trade names exactly as before, byte-for-byte unaffected.
- `"7th Floor"` typed `Finish Milestone` → still excluded by the pre-existing, untouched milestone
  rule, confirming the two exclusions compose correctly and don't interfere with each other.
- Full resulting `groups` output from the fixture:
  ```
  MEPF Works: MEP Rough-in
  Structural Works: Formworks, Slab Pour
  Allied Services: Waterproofing
  Other: Commercial Closeout, Financial Closeout, Resource Demobilization, Technical Closeout
  ```

Also re-verified structurally: brace/paren balance (1357/1357, 5038/5038), 0 NUL bytes, every new
symbol (`locNormKey`, `scheduleLocationValueKeys`, `isLocationLabelActivity`) declared exactly
once. New test-only hooks (`_locNormKey`, `_isLocationLabelActivity`, `_scheduleLocationValueKeys`,
and `_worksGroupedOptions` widened to also inject `LOC_LEVELS`) added to `module.js`'s own exported
`ProgressPhotos` object for the next session with a working `node` to drive through `test.js`.

**No `project_schedule` record, Schedule Builder, XER importer, `work_type` value, Tower/Floor
location data, or Project Schedule App file was touched.** The entire change is three new
functions plus two one-line call-site additions inside `progress-photos/module.js`.

⚠️ **Not verified signed-in against the real AVR101 project** — same standing limitation as every
entry in this file. The fixture above reproduces every confirmed fact from the diagnostic rounds
(the location-value shape, the blank-`work_type` pattern, the specific activity names involved),
but the actual live re-test — opening Add Media → Works on AVR101 and confirming (a) the 14 floor
labels are gone, (b) "Other" contains only the admin/closeout names, (c) the trade groups are
unchanged, (d) no other activity vanished unexpectedly — is the owner's to run.

`module.js?v=` → `20260908c` (module-local only; `module.css` unchanged, stays `20260907b`).

## Works picker was including two of Execution Phase's own sibling branches
## (General Requirements, Construction Phase) — diagnosed against the real
## AVR101 WBS before touching anything (2026-09-08)

Owner, with a live screenshot of AVR101's Project Schedule grid: Execution Phase (wbs code
**"4"**, per the 2026-09-08 root-cause fix above's own console diagnostic — *"Execution
root='4'"*) has **7 direct-child WBS-Summary branches**, not the 5 real trades:

```
Execution Phase (4)
├── General Requirements   (4.1)   ❌ should be excluded
├── Site Development       (4.2)   ✅ valid trade
├── Structural Works       (4.3)   ✅ valid trade
├── Architectural Works    (4.4)   ✅ valid trade
├── MEPF Works             (4.5)   ✅ valid trade
├── Allied Services        (4.6)   ✅ valid trade
└── Construction Phase     (4.7)   ❌ should be excluded
```

⚠️ **Diagnosed by reading the actual code and the actual data shape before writing anything**,
per the owner's explicit instruction. Findings, in the order the owner asked for them:

1. **`inExecOrCloseout(a)`** (the ONLY scoping gate the Works picker applies) tests
   `wbsUnderRoot(a.wbs, EXEC_WBS_CODE)` — a **boundary-safe prefix match against the whole
   Execution Phase root ("4")**. That test is true for **every** activity under **all seven**
   sibling branches, because all seven share the "4." prefix. There was no mechanism anywhere
   in this file that distinguished "under Execution Phase" from "under one of the five real
   trade branches specifically" — the two questions had never been separated.
2. **The "Others" bucket the owner suspected is real, and it traces to Construction Phase.**
   `worksGroupedOptions()` groups by `a.work_type` (Project Schedule's own canonical bucket —
   General Requirements / Site Works / Structural Works / Architectural Works / MEPF Works /
   Site Development / Allied Services / **Others**), falling back to the literal string
   `'Other'` only when `work_type` is blank. "Others" is itself one of Project Schedule's eight
   canonical `work_type` values (see that module's `GWORK`/`WORK_ORDER`) — a branch like
   Construction Phase, which is not itself a trade name, is exactly the kind of branch the
   WBS→Trade matcher in Project Schedule falls back to classifying as **"Others"**. So
   Construction Phase's activities were reaching the picker bucketed under a group named
   "Others"/"Other" — which is precisely what the owner observed and suspected.
3. **General Requirements' activities were NOT landing in "Others"** — `TRADE_WORK_TERMS`
   already has an entry for `'General Requirements': ['general requirement']`, so those
   activities bucketed correctly under a group literally named **"General Requirements"** —
   visible, not hidden inside "Others", but still wrongly present per the owner's rule (❌
   EXCLUDE). Both branches needed the same fix, for different reasons: one leaked into a
   catch-all bucket, the other leaked into a bucket that looked legitimate.
4. **Why**, mechanically: `inExecOrCloseout()` only ever asked "is this WBS code at or under
   the Execution Phase root", never "which of Execution Phase's own children is it under" —
   there was no branch-level distinction at all, so nothing could have refused General
   Requirements or Construction Phase without a new check.

### The fix — resolve two branch codes by name, exactly like the two phase roots already are

⚠️ **Do NOT hide "Others" in the UI, do NOT filter by Activity name, do NOT hard-code
Activities, do NOT invent Trade/Activity master data, do NOT fall back to another project** —
all explicit owner constraints, and none of them were touched. Instead, two of Execution
Phase's own **direct-child WBS-Summary branch codes** are now resolved live off the schedule's
own data, using the identical technique the file already uses to find `EXEC_WBS_CODE`/
`CLOSEOUT_WBS_CODE` themselves (`branchPhaseFromName` — a substring match against a WBS-Summary
row's own name):

- New `EXEC_BRANCH_EXCLUDE_TERMS = ['general requirement', 'construction phase']` and
  `execExcludedCodesFrom(wbsSummaryRows, execCode)` — scans the same `wbsSummaryRows` already
  fetched for the phase-root resolution (no second fetch), restricted to rows that are
  **direct children** of the Execution Phase root (one dotted-code segment deeper — "4.1"
  through "4.7", never a same-named branch nested deep inside a real trade), and returns the
  codes of any that match either term. Computed once per `loadSchedule()`, stored in a new
  `EXEC_EXCLUDE_CODES` module var.
- **`inExecOrCloseout(a)` now checks the WBS-code path FIRST**, before the `phase`-column
  fallback (reversed from before): when an activity's `wbs` resolves under the Execution root,
  it is only in scope if it is **not** also under one of the excluded codes. This reordering is
  necessary, not cosmetic — every sibling branch under Execution Phase stamps the *identical*
  `phase` value (`'construction'`), so the `phase` column can never by itself distinguish a
  Structural Works row from a General Requirements row. The phase-only fallback (no resolvable
  `wbs` at all — the pre-existing degrade path for an un-migrated/legacy row) is **unchanged**
  and cannot apply the new exclusion, since it has no WBS ancestry to test it against.
- **Closeout Phase is completely untouched** — the owner's diagram only restricts Execution
  Phase's own children; the exclusion codes are only ever tested against activities resolving
  under `EXEC_WBS_CODE`, never `CLOSEOUT_WBS_CODE`.
- ⚠️ **This is not "creating new master data" or "hard-coding Activities."** It reads two
  structural **WBS branch names** — not activity names — live off *this project's own* schedule
  on every load, the same way `EXEC_WBS_CODE`/`CLOSEOUT_WBS_CODE` themselves already are. A
  project that renames or reorders these branches is read correctly on its next load with no
  code change; nothing about this depends on a fixed WBS code, a fixed project, or a fixed
  activity list.

### Verified

**Genuinely executed in a real browser** (this environment has no `node`/`python` binary,
confirmed directly again this pass), via the local dev-preview static server: the exact,
verbatim function bodies of `wbsUnderRoot`, `execExcludedCodesFrom`, `inExecOrCloseout` and
`worksGroupedOptions` were sliced straight out of the shipped `module.js` (never retyped) and
run against a fixture built to match the **owner's own screenshot exactly** (Execution Phase
"4" with all seven real children, Closeout Phase "5" as a separate root) plus one synthetic
activity per branch:

- `execExcludedCodesFrom(wbsSummaryRows, '4')` → `["4.1", "4.7"]` — exactly General Requirements
  and Construction Phase, nothing else.
- Every activity under General Requirements (`wbs: "4.1.1"`) and Construction Phase
  (`wbs: "4.7.1"`) → `inExecOrCloseout` returns `false` (excluded).
- Every activity under Site Development / Structural Works / Architectural Works / MEPF Works /
  Allied Services → `inExecOrCloseout` returns `true` (included), unaffected.
- The Closeout Phase activity (`wbs: "5.1"`) → still `true` (untouched).
- `worksGroupedOptions()` over the same fixture returns **exactly 5 groups** — `Site
  Development`, `Structural Works`, `Architectural Works`, `MEPF Works`, `Allied Services` —
  with **no `General Requirements` group and no `Others`/`Other` group at all.**

Also re-verified structurally: brace/paren balance (1346/1346, 4994/4994), 0 NUL bytes, and
every new symbol (`EXEC_EXCLUDE_CODES`, `EXEC_BRANCH_EXCLUDE_TERMS`, `execExcludedCodesFrom`,
the rewritten `inExecOrCloseout`) declared **exactly once**. New test-only hooks
(`_execExcludedCodesFrom`, `_inExecOrCloseout`, `_worksGroupedOptions` — same save/restore-
closure-state convention as `_deriveTradeForWorks`) were added to `module.js`'s own exported
`ProgressPhotos` object (not to `test.js` itself, which wasn't touched this pass) so the next
session with a working `node` can drive this through the real `test.js` harness too, rather than
only the ad-hoc browser fixture above.

⚠️ **Not verified signed-in against the real AVR101 project** — same standing limitation as
every entry in this file. The fixture above was built to exactly reproduce the real WBS shape
from the owner's own screenshot and the confirmed live console diagnostic (`Execution
root="4"`), but the actual re-test — opening Add Media → Works on AVR101 and confirming the
picker now shows exactly Site Development / Structural Works / Architectural Works / MEPF
Works / Allied Services with no General Requirements group and no Others group — is the
owner's to run.

`module.js?v=` → `20260908b` (module-local only; `module.css` unchanged, stays `20260907b`).

## Root cause of the live "Works selector shows no Trade/Activity records" — a transient
## client-side auth race, NOT a database/RLS/GRANT problem (2026-09-08)

Owner's live console diagnostic on **AVR101** (the exact `console.info`/`console.warn` lines the
2026-09-07 entry below already ships) gave the decisive evidence:

```
[progress-photos] WBS-Summary fetch failed for project AVR101:
{ code: '42501', message: 'permission denied for table project_schedule',
  hint: 'Grant the required privileges … GRANT SELECT ON public.project_schedule TO anon;' }

[progress-photos] loadSchedule(AVR101): 4321 non-summary activities loaded,
Execution root=null, Closeout root=null, 0 in Execution/Close-out scope, 0 distinct Works name(s)
```

### The root cause, traced and confirmed — not guessed

⚠️ **The two lines together prove the database is correctly configured.** Both `console` lines come
from `loadSchedule()` querying the exact same table (`project_schedule`), through the exact same
singleton Supabase client (`AppAuth.getSB()` — created once in `auth.js`, never re-created anywhere
this module can reach — confirmed by grepping the whole repo for `createClient(` and finding it only
in unrelated modules/Edge Functions), under the exact same signed-in session, **seconds apart**. The
FIRST of the two (the main `project_schedule` fetch, excluding WBS-Summary rows) succeeded and
returned **4321 rows**. The SECOND (a separate fetch scoped to `activity_type = 'WBS Summary'` only,
which resolves the Execution/Close-out root codes) failed with **`42501` naming the `anon` role**.

Two requests against the identical table, under the identical client and session, cannot have
genuinely different table grants or RLS policies — Postgres grants/RLS are not request-scoped. The
only way the SECOND request could resolve to `anon` is if, at the exact moment it was composed, the
client's in-memory session cache transiently read as empty and the request went out with **no
Authorization Bearer header at all** — which PostgREST then evaluates using only the `apikey` header,
i.e. as the `anon` role (confirmed against Supabase's own `42501` troubleshooting doc and PostgREST's
documented role-resolution behaviour, neither of which supports a per-request GRANT/RLS difference on
one table). This exact class of failure — `getSession()`'s cache transiently resolving null moments
after a successful, identically-authenticated request — is a real, independently documented
supabase-js v2 client bug (GitHub `supabase/supabase-js` issues **#1560**, **#1612**, and discussion
**#19608**, among others), not something specific to this app's schema.

⚠️ **Why THIS particular request was the one to land in the race window, not the main fetch that ran
moments before it.** `loadSchedule()` fired the main `project_schedule` fetch, then called
`notifyScheduleReady()` **synchronously**, which invokes every registered `onScheduleReady` listener —
including `bim.js`'s, which repaints its Tower/Floor DOM (see the 2026-09-04 entry below on that exact
listener chain) — and only THEN, afterward, fired the second, WBS-Summary-only fetch. That gap between
two requests, with another module's DOM-touching callback running inside it, is exactly the kind of
window a client-side session-cache race lands in.

### The fix — client-side only, no GRANT, no RLS, no fallback project, no hardcoded data

Per the owner's explicit constraints, **nothing in the database was touched.** `project_schedule`'s
grants and RLS were never the problem (proven above), so widening `anon`'s access — the exact fix
Supabase's own generated hint suggested — would have been the wrong fix for the actual defect, and
would have needlessly exposed the whole table to unauthenticated reads project-wide, which this app
has never done for any table (confirmed: no other module/migration in this repo grants `anon` direct
table access — every table is `authenticated`-only, scoped by RLS).

Two changes, both in `module.js`, both scoped to the **shared `fetchAllPages()` helper** and
`loadSchedule()`'s own call shape:

1. **`fetchAllPages()` now retries EXACTLY ONCE on a `42501` response**, after an explicit
   `await sb().auth.getSession()` to force the client to re-settle its session (the same recovery
   every one of the linked upstream supabase-js issues describes happening once the session is
   actively re-checked). A retry that still fails still surfaces as a real error — no silent
   swallowing, no second retry, so a **genuine** permissions problem (a real missing grant, a real RLS
   gap) still reports honestly rather than being papered over. This hardens every current and future
   caller of `fetchAllPages()`, not just this one query.
2. **`loadSchedule()` no longer makes TWO separate sequential `project_schedule` fetches with a
   listener-callback gap between them.** It now does **one** combined, unfiltered fetch of the whole
   table (Task rows and WBS-Summary rows together) and derives both `SCHED_ACTS` (non-summary rows)
   and the Execution/Close-out root-code resolution from that **same** in-memory result set — closing
   the specific gap the race landed in, and matching how **Project Schedule's own `load()`** has
   always read this identical table (one paginated pass over everything, never split into a
   Task-only and a WBS-Summary-only round trip — confirmed by reading its `load()` before making this
   change, per the owner's own instruction).

⚠️ **Both changes are additive/structural — nothing about Trade/Activity identification, the
Execution-Phase name-matching rule, or the Works picker's own logic changed.** `SCHED_ACTS`,
`EXEC_WBS_CODE`/`CLOSEOUT_WBS_CODE`, `worksGroupedOptions()`, and the picker itself are all unchanged
downstream consumers of the same data, now assembled without the vulnerable gap.

### Expected result on re-test

With the fix deployed, re-opening Add Media on AVR101 should log a single `project_schedule` fetch
succeeding (or, in the rare event the race still lands on that one combined request, one
`console.info('… recovered from a transient 42501 …')` line showing the retry caught it) and the
summary line should read a real `Execution root=`/`Closeout root=` code pair with a non-zero
in-scope/eligible-Works count — assuming AVR101's schedule has a WBS-Summary branch whose name
resolves via `branchPhaseFromName()` (a real remaining possibility, distinct from this fix, per the
2026-08-13e/f/g entries below on that exact naming-match failure mode).

⚠️ **Not verified signed-in** — same standing limitation as every entry in this file (no live login,
no `node` binary in this environment; confirmed again this pass — checked directly, neither resolves).
Verified instead: brace/paren balance (1334/1334, 4945/4945), 0 NUL bytes (confirmed via byte-count
comparison after stripping `\0`, not the `grep -c $'\0'` line-count trap this file's own history
already warns about), exactly one declaration each of `fetchAllPages`/`buildQuery`/`loadSchedule`,
and a full manual re-read of the edited function confirming it closes correctly and every downstream
reader (`SCHED_ACTS`, `inExecOrCloseout`, the diagnostic summary) is unchanged in shape. `test.js` has
no existing assertions tied to the two-fetch shape this replaces (grepped for `WBS-Summary fetch`/
`wbsRowCount`/`fetchAllPages` — none found), so nothing there needed updating; no new tests were added
given `node` isn't available here to execute them.

⚠️ **Rebased onto a concurrent session's own same-day work** (the favorite-star feature, entry directly
below) — both independently bumped `module.js?v=`; this file's `20260908a` is kept as the record of
what this entry's own testing was run against, and the merged `index.html` carries the bumped-past-both
`20260908b` instead so neither round's cache-bust is silently lost.

`module.js?v=` → `20260908a` (module-local only; `module.css` unchanged, stays `20260907b`).

## Gallery favorite star + portfolio-level favorites-only filter (2026-09-07)

Owner: *"In progress photos app, add feature to favorite photos in gallery by clicking a star at
bottom right of photo. In portfolio level, only favorite photos are displayed."* Two halves, one new
column: **`progress_photos.favorite`**, defaulted `false`, plus a partial index on `(project_id)
where favorite` (the overwhelming majority of rows are never favorited, so indexing only the `true`
rows keeps it small and cheap to maintain on every insert).

**Run `migrations/2026-09-07-progress-photos-favorites.sql`.**

### Gallery: the star, and why it needed a SECURITY DEFINER RPC rather than a plain `.update()`

⚠️ **`progress_photos`' generic module-table UPDATE policy is OWNER-OR-ADMIN**, not "any project
writer" — read directly out of `supabase-schema.sql`'s per-module RLS loop: `using (is_writer() and
can_access_project(project_id) and (created_by = auth.uid() or is_admin()))`. A planner who is
approved and has access to the project but did **not** upload the specific photo they're starring
would have their `.update({favorite:true})` silently REFUSED by Postgres — and a refused UPDATE
reads back exactly like a successful no-op update matching zero rows: `{data:null, error:null}`.
This is the identical false-success trap this module already had to trace and fix once for DELETE
(see the 2026-09-04 entry below, "the real reason 3D/360 deletes silently failed").

But **favoriting is deliberately a team-curation action** — any project writer should be able to
flag a photo as a portfolio highlight, not just whoever originally uploaded it. Widening the
table's own UPDATE policy would let any writer edit *any field* of *any* photo, which is far more
than this needs. So a new, narrow **`set_photo_favorite(p_photo_id uuid, p_value boolean)`**
function (SECURITY DEFINER, `set search_path = public`, matching the exact shape of every other
privilege-bypass function in this repo — `is_admin()`, `admin_delete_user()`, etc.) checks
`is_writer()` + `can_access_project()` itself and then flips the ONE boolean, nothing else. It
`raise exception`s on refusal rather than silently no-oping, and `grant execute … to authenticated`
is the only privilege it hands out.

- **The star** (`favBtnHTML(r)`) sits at the bottom-right corner of each Gallery tile — a fixed
  dark-scrim corner overlay, the same family as the existing `.pp-mkeditbtn` pencil-edit button
  (`.pp-cardfav`, `bottom:4px; right:4px`). Filled gold (`currentColor` via `.is-fav`) when
  favorited, an outline star otherwise. ⚠️ **Never rendered for a 360°/3D pseudo-row** — panoramas
  and reconstructions have no `favorite` column to toggle (`favBtnHTML` returns `''` for `_kind`
  rows), the same "the merged pseudo-row can't do everything a real photo row can" rule this
  module already applies to Trade/Works.
- ⚠️ **A read-only (`!canWrite`) viewer sees a plain, non-interactive `<span>` mark when a photo IS
  favorited, and nothing at all when it isn't** — never a `<button>` that would silently do nothing
  on click. Matches this file's own standing rule against ever showing an inert-looking interactive
  control (the same reasoning behind hiding a disabled Save on a form nobody can submit).
- **`toggleFavorite(r)`** is optimistic — mutates `r.favorite` and calls `render()` immediately
  (this file's existing pattern, already used by `openForm`'s save handler), then awaits the RPC and
  **reverts + toasts an error** if it fails, rather than leaving the star in a state the database
  never actually agreed to.
- New icon: `star` (a single `<polygon>`, no `fill` attribute — CSS controls the outline↔filled
  toggle via `currentColor`) added to the shared `assets/js/icons.js`, bumped app-wide
  (`?v=` `20260903a` → `20260907a` across all 21 referencing HTML files).

### Portfolio Overview: the Photos tab is now favorites-only

Owner's second half — *"in portfolio level, only favorite photos are displayed"* — is
`modules/portfolio-overview/index.html`'s existing cross-project Photos tab (see that module's own
CLAUDE.md for its general design). `loadPhotos()`'s query gained `.eq('favorite', true)` right next
to the existing `.in('project_id', ids)` — narrowing the FETCH itself, not just what's displayed, so
the KPI counts / "most recently favorited" grid / per-project table can never disagree with what was
actually read.
- ⚠️ **Tolerant of the pre-migration state**, matching this file's own `PDb.selectAll` "run the
  migration" convention already used by the Equipment/Resources tabs in that same module: a missing
  `favorite` column degrades to a nudge naming `migrations/2026-09-07-progress-photos-favorites.sql`
  instead of a raw PostgREST error.
- Tab renamed **"Photos" → "Favorite Photos"**; the KPI card, the section heading ("Most recently
  captured" → "Most recently favorited"), the per-project table's column header, and both empty
  states (grid + table) were reworded to say a photo has to be favorited to show up here, with a
  one-line hint pointing back at the Gallery star.

### Verified

**985 checks green** (was 967 before this change — 18 new), re-confirmed by diffing the exact
failure-name set against the pre-change baseline captured via `git stash`: **the same 14 pre-existing,
unrelated failures, byte-for-byte identical before and after** — zero regressions. Structural
assertions cover the RPC-not-plain-update requirement, the migration's idempotency + grant, its
presence in `supabase-schema.sql`, the `[data-act="fav"]` dispatch wiring, and the CSS's fixed-scrim
placement; **genuine execution** (via new test-only hooks `_setCanWrite`, `_favBtnHTML`,
`_toggleFavorite`) drives `toggleFavorite` through a real RPC round-trip against the fake store both
directions (false→true→false), confirms the store's own copy agrees (not just the in-memory
reference), confirms a refused RPC reverts the optimistic flip and toasts the real reason, and
confirms the whole thing is a no-op — RPC never even called — for a read-only user. `node --check`
clean on `module.js`/`test.js`; the portfolio-overview inline script (extracted) also parses clean;
0 NUL bytes across every touched file.

⚠️ **Not verified signed in** — same standing caveat as every entry in this file. In particular: no
live click-through of the star against a real Supabase session (a genuine non-owner writer toggling
someone else's photo, proving the RPC bypass actually works against real RLS rather than the fake
store), and the migration has not been run.

`module.css/js?v=` → `20260907c`; `icons.js?v=` → `20260907a` (app-wide, 21 files). No `MODULE_V`
bump needed — no module `index.html` changed structurally.

## Works field rebuilt as a hierarchical Execution-Phase Trade > Activity selector, sourced from Project Schedule (2026-09-07)

Owner's spec (a 40-page PDF): the **Works** field inside **Progress Photos → Add Media** must become a
controlled selector that can only pick EXISTING Project Schedule activities under **Current Project →
Execution Phase → Trade → Activity** — never a free-typed value, never another project's data, never a
photo-derived fallback. Explicitly scoped to this one field: no new module, no new page, no redesign of
Location/Floor Plan/Presentations.

⚠️ **Inspected before touching anything, per the spec's own instruction, and the answer was "half of
this already exists."** The Works picker was already schedule-sourced, project-scoped, phase-filtered
and multi-select (see the 2026-08-30 "Reverses…back to a real multi-select" entry above) — genuinely
new work here is the **hierarchy's presentation** (collapsible Trade groups, search, Expand/Collapse
all, a live selected count, explicit Apply/Cancel) and a **traceable schedule reference** the prior
design never stored. Nothing about Location or Floor Plan was touched.

### Where Trade/Activity actually live in the schedule (inspected, not assumed)

- **Execution Phase is a filter, never a selectable level** — `EXEC_WBS_CODE`/`CLOSEOUT_WBS_CODE`
  (already resolved in `loadSchedule()`, unchanged) are the dotted-code roots of the Project Schedule's
  own **"Execution Phase" / "Closeout Phase" WBS-Summary branches**, found by name
  (`branchPhaseFromName`, the exact substring rule Project Schedule's own `phaseFromName()` uses).
  `inExecOrCloseout(a)` accepts a raw `phase==='construction'/'closeout'` stamp OR a `wbs` code at/under
  either root (`wbsUnderRoot`, boundary-safe — `"4"` matches `"4.1"`, never `"40.1"`) — this reads the
  **schedule's real underlying data**, deliberately independent of whatever grouping/view preset (Tower/
  Level/Zone/…) a planner currently has the Project Schedule module displaying (spec §5).
- **Trade = `project_schedule.work_type`** (the same canonical bucket Project Schedule itself groups by:
  General Requirements / Site Works / Structural / Architectural / MEPF / …) — this is the grouping/
  collapse level, never itself selectable.
- **Activity = `project_schedule.activity_name`**, on real `Task` rows (Start/Finish Milestones excluded
  — a schedule commonly names a floor-completion milestone after the floor itself, which is not a
  "Works" a photo is capturing) — the only selectable, multi-select unit.
- All of this comes from the **existing** `SCHED_ACTS` array (a plain read of `project_schedule`,
  keyset-paginated, already scoped to the current project by `pid` — no second project selector was
  ever added, per spec §17). No new fetch, no new endpoint.

### What changed vs. what was already there

1. **The selector is now genuinely hierarchical, not a flat checkbox grid.** `openWorksPicker` rebuilt
   around `worksGroupedOptions()` (unchanged — still groups by `work_type`, still folds any legacy
   free-text value with no live schedule match into its own trailing "Previously used" bucket rather
   than dropping it): each Trade is now a **collapsible section** with a caret (chevronDown/
   chevronRight, the existing shared icon set — no new icons needed), its own activity count, and
   **Expand all / Collapse all** controls that only ever touch a separate `collapsedState` map, never
   the selection.
2. **Search** — a box at the top matching Trade *or* Activity name (case-insensitive substring); a
   matching Activity keeps its parent Trade visible/expanded automatically (forced open only visually,
   never written into `collapsedState`, so clearing the search restores whatever the planner had
   manually expanded/collapsed). Search never creates or modifies a Work.
3. **Selection is a draft until Apply.** `chosen` is seeded from the already-applied selection when the
   modal opens; only the **Apply** button ever commits it back into `_worksSel[idPrefix]` (the field's
   real, displayed state). **Cancel**, the **×**, and a backdrop click all just close the modal with
   `chosen` discarded — exactly the spec's own worked example (existing "Column Formworks" + a
   newly-but-not-applied "Column Concrete" → Cancel → only "Column Formworks" remains).
4. **A live "N works selected" count** in the footer, updated on every checkbox change and every
   collapse/search re-render.
5. **No manual input, anywhere** — confirmed by grep, not assumed: no "+ Type a new value"/"+ Add custom
   Works value" control exists in this picker (there never was one in the Works field specifically; a
   look-alike escape hatch on the unrelated Tower/Floor picker was already removed and reversed by an
   earlier, explicit owner correction — see the 2026-09-04 "Correction: Tower/Floor reverted…" entry).
   Every checkbox value is a real, already-existing schedule name; Trade/Activity can never be renamed
   or created from this screen, and nothing here writes to `project_schedule`/`wbs_nodes`.
6. **The empty state is now literal and stops demanding the impossible.** ⚠️ **Real, if narrow, bug
   fixed along the way**: `requiredFieldsMissing`'s Works gate read `scheduleHasActivities()`, which
   only ever checked "does `project_schedule` have ANY row" (`SCHED_ACTS.length > 0`) — so a project
   whose schedule exists but has **nothing** past the Execution/Close-out + milestone filter (e.g.
   everything is still Planning-phase) demanded "At least one Works value is required" with **zero**
   pickable options, a dead end with no manual-entry escape (correctly, per spec — but then the field
   simply couldn't be satisfied). `scheduleHasActivities()` now means exactly what the Works field
   needs it to: `worksGroupedOptions().length > 0`. The empty-state copy matches the spec's own wording
   verbatim: *"No works available for this project. Works must be established in the Project Schedule
   under the Execution Phase before they can be selected here."* — and no "+ Add works" button is
   rendered in that state, so there is nothing to click into a dead modal.

### Data storage — now traceable to the real schedule record, not display text alone

`works_multi` (existing `text[]`, display names, deduped by name across every WBS branch/floor a name
recurs on — deliberately unchanged, still what every filter/grouping/display reader uses) is joined by
a new, **index-aligned** `works_activity_ids text[]` — the resolved `project_schedule.activity_id` (the
same P6 business-key column this app already treats as *the* schedule reference everywhere else) for
each chosen Works value, or `NULL` when no live schedule match exists (a legacy free-text value, or an
activity since renamed/removed — the "Previously used" bucket).

⚠️ **Not a strict foreign key, and deliberately not one — read the existing architecture first.** Works
is dedupe-by-NAME because one schedule activity name legitimately recurs across dozens of WBS branches
(the same "Rebar Installation" on every floor of a tower); a single Works entry therefore represents a
**group** of schedule rows, not one. `worksActivityIdFor(name)` resolves the **first** matching row as
the representative record — a best-effort trace, not a hard 1:1 link, which is exactly what the spec's
own §18 asked for ("do not blindly create this exact schema… the critical requirement is that the
selected Work must remain traceable to the actual Project Schedule record") without inventing a second,
competing master-data model inside Progress Photos.

Migration: **`migrations/2026-09-07-progress-photos-works-activity-ids.sql`** (idempotent `alter table
… add column if not exists`; folded into `supabase-schema.sql`). Tolerant of not having run yet —
`tolerantWrite()` strips `works_activity_ids` and retries once on a "column does not exist" error
(warns once per session), the same convention already used for `trades`/`works_multi`/`view_name`/
`media_type`/`thumb_url`/`adjustments` in this same function.

### Location remains completely separate, untouched

Not a single line of `locationFieldHTML`/`locTree`/`resolveActivity`/`locBreadcrumb`/`currentLocValues`
was touched. `resolveActivity(locVals)` still derives the row's own `activity_id`/`activity_name`
snapshot from the **Location** pick (a different, pre-existing concept: "what is the schedule's current
activity at this physical location", auto-computed, not user-chosen) — this is unrelated to the Works
field's own new `works_activity_ids` and the two are not merged.

### Verified

⚠️ **No `node` binary and no live Supabase login are available in this environment** (checked directly —
neither `python`/`python3` nor `node` resolve to anything beyond Microsoft Store shims, in Bash or
PowerShell) — the same standing limitation nearly every other entry in this file records. Given that,
verification here is: (1) careful manual review of every edited region, re-read in full after editing;
(2) a whole-file brace/paren balance check on `module.js` (1333/1333 braces, 4921/4921 parens) and
`module.css` (584/584 braces) — clean; (3) a byte-level 0-NUL-bytes check on both files; (4) confirming
every new/changed function is declared **exactly once** (`openWorksPicker`, `worksMultiFieldHTML`,
`scheduleHasActivities`, `worksActivityIdFor`, `worksActivityIdsFor`, `worksGroupedOptions`,
`repaintWorksChips`, `wireWorksMultiField`, `readWorksMulti`, `deriveTradesForWorksList` — one
declaration each); (5) every new `test.js` regex assertion was individually run **against the real,
shipped `module.js`** via a literal-pattern search tool (not node, but a genuine match against the exact
source bytes, which for a pure string/regex structural assertion is equivalent evidence) — all pass;
(6) confirming the one now-stale pre-existing assertion (the old "Done" button's
`querySelectorAll('input[type=checkbox]:checked')` read-at-Apply-time pattern) is rewritten, not left
silently failing, matching this file's own "healthy churn from an intentional change" convention.

⚠️ **Not verified**: no live click-through exists — the collapse/expand persistence across a real
render cycle, the search box's real behaviour against a live project's own Trade/Activity names, and
the `works_activity_ids` write actually reaching a live database (the migration has not been run) are
all unverified beyond the structural checks above. **Existing Location, Floor Plan and Presentations
behaviour is untouched by this change** (no line in `bim.js`/`ppr.js`/`pano.js`/`recon.js` was edited),
and the Add Media save/upload pipeline itself (files, thumbnails, offline queue, batch concurrency) is
unmodified — only the Works field's own render/read functions and the two save-payload object literals
that already existed were touched.

`module.css/js?v=` → `20260907b` (module-local only — Works has no shared/app-wide asset, so no
`MODULE_V`/`icons.js` bump was needed).

## Delete Revision added to the existing Floor Plan feature (2026-09-07)

The Floor Plan feature already had real, working revisions (Replace Plan → a new `floor_plans`
row, the previous one flipped to `is_current:false`, never deleted) but no way to delete one —
a wrong upload or a stale test revision was permanent. Added **Delete Revision**, targeted:
nothing about upload/Replace Plan/revision creation/zone drawing changed.

- Reachable two ways, both `canWrite`-gated: a **Delete Revision** button on the currently-viewed
  revision's info bar (next to Edit Zones/Replace Plan — the only route when a floor has just one
  revision, since "History (N)" only renders past 2), and a **per-row Delete Revision** link in the
  existing Revision History modal, so a middle/non-current revision can be deleted without first
  switching the main screen to it.
- Both route through one new `openDeleteRevisionConfirm(planId, onDeleted)` — one confirm modal
  (`pd-btn-danger`, matching `module.js`'s own `openDeleteConfirm` pattern), naming the revision
  and warning plainly when it's the only one or the current one.
- ⚠️ **No new deletion mechanism — reused the existing FK cascade.** `floor_plan_zones` /
  `floor_plan_pins` / `floor_plan_registrations` already declare `floor_plan_id … on delete
  cascade` (2026-08-29-floor-plans.sql, 2026-09-03-floor-plan-revisions-zones.sql, 2026-08-29-
  floor-plan-registration.sql), scoped per revision's own id — so one `DELETE FROM floor_plans` is
  correct and sufficient; no zone/pin/registration ever leaks across revisions and nothing in
  `progress_photos`/`ppr_slides` is touched (neither table references `floor_plans` at all).
  ⚠️ Checked that `floor_plan_registrations`' ownership-restricted delete policy
  (`created_by = auth.uid() or is_admin()`) can't block this: Postgres bypasses RLS for
  FK-driven referential-integrity actions, including `ON DELETE CASCADE` — confirmed against
  Postgres's own documented behavior before relying on it, not assumed.
- If the deleted revision was current, the next-most-recent SURVIVING revision for that exact
  Tower+Floor is promoted (`is_current:true`) — never a sibling Tower/Floor's rows, never by
  copying zones. Tolerant of `is_current` not existing yet (pre-migration): `currentPlanFor()`'s
  own already-documented legacy fallback (most-recently-uploaded) resolves the same answer anyway.
  Deleting the only revision promotes nothing — the floor falls back to the existing "No floor
  plan uploaded" empty state, unchanged.
- The image file (`image_url`) is removed from storage as a separate, best-effort step after the
  row delete succeeds — same ordering discipline as `module.js`'s photo delete (a failed storage
  cleanup must never make an already-successful row delete read as failed).

**Verified structurally** (no live Supabase session is possible in this environment — the standing
limitation for this whole module): braces/parens balanced, 0 NUL bytes, no duplicate DOM ids,
exactly one definition of the new function with its two intended call sites; every cascade/RLS
claim above was checked against the actual migration text, not assumed. ⚠️ **Not click-tested
live** — the six scenarios (only/middle/current revision, zone integrity, reload, location
integrity) are unverified end-to-end; this is the real gap for whoever tests next.

`bim.js`/`module.css?v=` → `20260907a`.

## "I still can't delete the 3D/360 photos" — the real root cause, found by auditing every delete path in the module (2026-09-04)

Owner, after both the pencil-icon fix and the batch-trash-icon fix below had shipped and merged:
*"i still cant delete the 3d/360 photos. please exhaust all means to resolve."* Both prior fixes were
real and correct — but neither one could have closed the report, because **the actual defect was one
level deeper than either of them touched: a delete that silently reports success while leaving the row
in the database.**

⚠️ **The changelog entry below ("Bug fix: no delete path...") contains a wrong claim, corrected here.**
It states *"Panoramas needed no database change — they were always covered by the generic module-table
RLS (`is_writer()`), so any writer could already delete one at the database level."* That is false.
Read directly out of `supabase-schema.sql`'s generic per-module-table RLS loop, the actual DELETE
policy every module table (including `panoramas` and `progress_photos`) gets is:

```sql
create policy <table>_del on <table> for delete
  using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
```

That is **owner-or-admin**, not "any writer." A planner who is approved and has access to the project
(`is_writer()` + `can_access_project()` both pass) but did **not** upload the specific panorama/photo
they're trying to delete gets refused by Postgres — and Supabase/PostgREST report a refused DELETE the
same way as a successful one that happened to match zero rows: `{ data: null, error: null }`. A
`.delete()` call with no `.select()` chained **cannot tell these two outcomes apart**.

### The bug, present in every delete path in this module except one

`recon.js`'s `retractRequest`/`deleteRequest` already guard against exactly this (their own comments
say so explicitly — this is a known, previously-solved failure mode in this codebase). Auditing every
OTHER delete call site in the module found the same missing guard in four places:

- **`pano.js`'s `deletePano`** (the function `PANO.deleteById` resolves to — the one the pencil-icon
  editor's Delete button, and the batch-delete's per-item pano branch, both actually call) had no
  `.select()` at all. This is almost certainly **the actual bug the owner kept hitting**: delete a
  panorama someone else uploaded → the row survives in the database → the tile is spliced out of the
  in-memory array so it visibly disappears from the grid for that click → the very next `load()` (a
  page refresh, a teammate's `applyRemoteChange`, a re-sync) brings it right back. That reproduces
  "I deleted it and it's still there" precisely.
- **`pano.js`'s `removePano`** (the older, currently-unreachable `#pano-view` screen's own delete) had
  the identical gap — fixed too, as defence-in-depth in case that screen is ever reconnected.
- **`module.js`'s `openDeleteConfirm`** — the real-photo delete used by the lightbox's single-photo
  Delete button, and (before the batch-trash-icon fix below existed) also the fallback for a
  photo-only batch selection. Same missing `.select()`, same silent-refusal-reads-as-success shape,
  on `progress_photos` — covered by the identical owner-or-admin policy.
- **`module.js`'s `openBatchDeleteConfirm`** — its own photo-delete block had the same gap
  independently (it does not call `openDeleteConfirm`, by design, so it needed its own fix).

### The fix, applied identically everywhere

Every one of the four now uses `.select('id')` (or bare `.select()` for a single row) and reads back
**which ids were actually returned** before treating anything as deleted:

- `deletePano`/`removePano` return/toast a real, actionable message — *"You do not have permission to
  delete this — only the person who uploaded it or an admin can."* — instead of a false success, and
  only splice the in-memory row / touch Storage once a real deleted row comes back.
- `openDeleteConfirm` reports an **honest partial result** on a multi-select delete: *"N of M deleted —
  the rest need an admin or their uploader to remove them"* rather than either a blanket false success
  or aborting the whole batch over one refused id. Storage cleanup (`photo_url`/`thumb_url`) and the
  `selected{}` clear are both scoped to **only the confirmed-deleted ids** — a refused photo keeps its
  file and stays checked, so the UI doesn't lie about what actually happened to it.
- `openBatchDeleteConfirm`'s photo branch gets the identical treatment, and a refused photo joins the
  same `failed` counter the pano/recon per-item failures already use, so a mixed batch reports one
  honest "N of M item(s) deleted — K could not be removed" regardless of which kind(s) were refused.

⚠️ **A second, independent gap closed in the same pass: none of the three async delete-confirm click
handlers (`openDeleteConfirm`, `openBatchDeleteConfirm`, and the pencil-icon editor's
`openMediaKindDeleteConfirm`) were wrapped in try/catch anywhere in this file.** An unexpected throw
(a dropped connection mid-request, for instance) left the Delete button **permanently disabled with no
toast at all** — indistinguishable, from the outside, from "clicking Delete does nothing." All three
now capture `var btn = this;` up front and wrap their whole body in try/catch, re-enabling the button
and toasting a real message on any unhandled failure.

### Verified

**15 new checks** (942 → 957, matching the pre-existing 13-failure baseline byte-for-byte — confirmed
by diffing the exact failure-name set against `HEAD` before this round, not just the count): structural
assertions for every `.select('id')`/`.select()` guard, the honest partial-failure reporting, the
storage-cleanup/`selected{}`-clear scoping to confirmed-deleted ids only, and all three try/catch wraps
— plus **genuine execution** of `PANO.deleteById`'s RLS-refusal path (a row never pushed into the fake
store, the same technique `RECON._deleteRequest`'s own "raced — already approved" test already uses to
prove a real Postgres RLS refusal reads correctly), which had never actually been exercised despite
`PANO.deleteById`'s success/missing-row cases already having tests. Two pre-existing assertions that
regex-matched the OLD `this.disabled` shape of `openMediaKindDeleteConfirm` (before its own try/catch
wrap renamed the captured variable to `btn`) were updated in place to match the current source —
healthy churn from an intentional change, not a weakened check. `node --check` clean on all three
touched files (`module.js`, `pano.js`, `test.js`); 0 NUL bytes; **0 functions lost, 0 added** against
`HEAD` (every change is a modification to an existing function's body — a `.select()` argument and a
try/catch wrapper, never a new declaration). `recon.js` and `module.css` are untouched by this round.

⚠️ **Not verified signed-in** — same standing caveat as every entry in this file. The genuine-execution
tests prove the client-side `.select()`-guard logic is correct against a fake store with no real RLS;
the actual live scenario (a non-owner, non-admin planner deleting someone else's panorama/photo on the
deployed site, and confirming the row is now honestly refused with a real toast instead of a false
"deleted") has not been driven against a live Supabase session. **This is the fix most worth a live
click-through**, since the whole investigation traces back to a gap no structural review of the earlier
two fixes below could have caught — only tracing every `.delete()` call in the module against the
table's real RLS policy found it.

`module.js` → `?v=20260904j`, `pano.js` → `?v=20260904b` (module-local only — no shared asset touched,
so no app-wide `?v=`/`MODULE_V` bump).

## Follow-up: the batch trash icon still refused a 360°/3D selection — fixed to delete mixed batches (2026-09-04)

Owner, off a live screenshot of the deployed Gallery (project GPR101): checked a 360° tile via its
select checkbox, clicked the toolbar trash icon, got the toast *"Select at least one photo — 360°/3D
captures aren't deleted from here"*. *"please fix this. cant delete the 360/3D photo i previously
uploaded."*

⚠️ **The earlier same-day fix (the entry directly below) only closed HALF the gap.** It gave a
panorama/reconstruction tile its own delete via the pencil-icon edit modal
(`openMediaKindEditor` → `openMediaKindDeleteConfirm`) — a genuinely real fix, but not the path the
screenshot shows a planner actually reaching for. The batch-selection flow (check a tile's box,
click the toolbar trash icon) is the more discoverable route, and it had its OWN, separate guard —
`wireSelBar`'s `pp-sel-delete` handler — that this earlier fix never touched: it split the selection
via `splitSelectedIds`, and if it contained no real photos it refused the whole action outright,
naming the pencil-icon path only implicitly ("aren't deleted from here") rather than actually sending
the planner anywhere.

- **The refusal is gone. `pp-sel-delete`'s click handler now calls `openBatchDeleteConfirm
  (visibleSelectedIds())` directly** — no photo-only gate, no "skipped" toast for the 360°/3D
  portion of the selection. A selection made of nothing but 360°/3D tiles, nothing but photos, or any
  mix of the two all delete in one confirm-and-go action.
- **New `openBatchDeleteConfirm(ids)`** takes the RAW, possibly-mixed selection and splits it via the
  existing `splitSelectedIds` (already correctly bucketing `pano:<uuid>`/`recon:<uuid>` prefixed
  pseudo-ids away from real `progress_photos` ids — that function was never the problem; only the
  handler refusing to use its `pano`/`recon` buckets was). Each kind is then deleted through whichever
  module actually owns it:
  - **Real photos** — the same in-line shape `openDeleteConfirm` already uses (presentation-usage
    warning via `findPresentationUsage`, `TABLE.delete().in('id', …)`, then `photo_url`/`thumb_url`
    storage cleanup) — kept as its own block here rather than calling `openDeleteConfirm` a second
    time, so the WHOLE mixed batch is confirmed and executed as **one** action with **one** modal,
    not two sequential confirms for one click.
  - **Panoramas/reconstructions** — resolved back to their real object (`PANO.list()`/
    `RECON.doneList()`, matched by id) and deleted via `PANO.deleteById`/`RECON.deleteById` — the
    exact same two functions the pencil-icon fix below already built and proved. ⚠️ **Never a second,
    in-file copy of pano.js/recon.js's own storage-cleanup-then-row-delete logic** — the same "one
    360° viewer, one 3D viewer, one delete path per kind" rule this module already applies everywhere
    else a capture is opened or removed.
- ⚠️ **A per-item failure is counted, not fatal to the batch.** A `RECON.deleteById` call can
  legitimately fail pre-migration (a non-admin requester deleting their own `done`/`failed` scan is
  still refused by RLS until `2026-09-04-reconstruction-delete-terminal.sql` runs — see below) —
  `failed++` and the loop continues rather than aborting the rest of a mixed batch over one item the
  database was always going to refuse. The closing toast reports the honest split: *"N of M item(s)
  deleted — K could not be removed"* rather than a false "M items deleted" or aborting with nothing
  removed at all.
- **The confirm modal names every kind actually present** ("Delete 2 photos, 1 360° panorama, 1 3D
  scan?"), not a generic "N items" that hides what's about to disappear.
- ⚠️ The presentation-usage warning still runs, scoped to just the photo portion
  (`split.photo`) — a panorama/reconstruction can never be cited by a `ppr_slides` pane (that FK only
  points at `progress_photos`), so checking it against the whole mixed id list would be pointless
  work at best and a `.in()` query carrying ids from the wrong table at worst.
- `ids.forEach(function (id) { delete selected[id]; })` still runs over the WHOLE original selection
  (not just what succeeded) after the confirm closes, then `await load()` — the same re-render this
  file's own `mergedRows()` already needs to pick up pano/recon deletions, since `PANO.list()`/
  `RECON.doneList()` are read fresh on every render.

### Verified

**12 new checks, all green** (930 → 942): the old refusal string is confirmed gone from `module.js`
entirely (not just paraphrased in a comment — the first draft of this fix accidentally left the exact
retired toast text quoted inside its own explanatory comment, which is precisely the "a bare mention
in prose doesn't count, only a real declaration would" trap this file's own Stack-view retirement
note already warns about; caught by running the assertion against the draft and rewording the comment
rather than weakening the check); the toolbar button now calls `openBatchDeleteConfirm` with no gate
in front of it; `splitSelectedIds` is used to bucket the raw ids and an empty selection is a no-op;
a pano/recon id is resolved back to its REAL object before being deleted (never deleted by its bare
uuid alone, which none of `PANO`/`RECON`'s functions accept); the dispatch goes through
`PANO.deleteById`/`RECON.deleteById`, never a re-implementation; a missing module/function counts as
a failure rather than throwing; a partial failure is reported honestly; the confirm modal names each
kind present; the photo-portion presentation-usage check and the TABLE-delete-then-storage-cleanup
shape both match `openDeleteConfirm`'s own; and ids are cleared from `selected` with a fresh `load()`
after the batch finishes.

Plus **genuine execution** of `splitSelectedIds` (test-only hook `PP._splitSelectedIds`, the same
convention as every other pure-function hook in this file) against a real 5-id mixed array and an
empty array — confirming the bucketing (and prefix-stripping) is correct, not merely that the source
text looks right.

`node --check` clean on both touched files; 0 NUL bytes; **0 functions lost, 1 added**
(`openBatchDeleteConfirm`) against the prior commit. Full suite: **942 passed, 13 failed** — the
identical 13 pre-existing, unrelated failures this file's other 2026-09-04 entries already carry
(confirmed by re-running the exact same suite against the pre-fix commit via `git stash`: same 13,
same names, byte-for-byte).

⚠️ **Not verified signed-in** — same standing caveat as every entry in this file. No live
click-through of the toolbar trash icon against a real mixed selection, and the reconstruction
migration (`2026-09-04-reconstruction-delete-terminal.sql`) still has not been run — until it is, a
non-admin's `done`/`failed` scan in a batch will report as one of the "could not be removed" failures
rather than a false success, which is the designed degrade path, not a bug.

`module.js` → `?v=20260904i` (module-local only — no shared asset touched, so no app-wide
`?v=`/`MODULE_V` bump).

## Correction: Tower/Floor reverted to Project-Schedule-only — the union + escape hatch below was wrong (2026-09-04)

Owner correction, immediately after the previous entry shipped: the Project Schedule App must be
the **sole** source of truth for Tower/Floor. Both parts of that entry's fix are **removed**:

- **The "+ Type a new value…" escape hatch is gone** from `openPlanForm` (both Tower and Floor
  `<select>`s, and their onchange handlers and the Save handler's sentinel check) — reverted to a
  plain, closed `<select>` built straight from `towerOptions()`/`floorOptions()`, with no way to
  type, create, or add a value from this screen at all.
- **`distinctLocValuesAnySource()` is deleted from module.js**, not left dormant — `photoLocCombos`.
  `distinctLocValuesFor` (the one export bim.js calls) is back to a direct, one-line delegation to
  `distinctLocValues()` (schedule-only). A value that only ever exists on a photo's own free-typed
  Location field is explicitly **not** an established Tower/Floor location for this purpose,
  however real that photo is — the two are deliberately different concepts, and the earlier entry's
  framing of that distinction as a nuisance was the mistake.

**New, correctly-scoped empty state.** The gap the union was (wrongly) built to paper over was
real: a Location Breakdown LEVEL can exist (Tower/Floor are configured) while the SCHEDULE has
never had a single activity tagged with an actual value — `towerOptions()` legitimately empty. That
is now its own named state, `hasEstablishedLocations()` (`bim.js`), distinct from "no Location
Breakdown at all":

- **`towerFloorBarHTML()`** shows a new **"No Locations Available"** panel — *"No Tower/Floor
  locations have been established for this project yet. Please establish the project locations in
  the Project Schedule App first."* — instead of a select with nothing in it.
- **`render()`** stops at that panel (same early-return as the "no Location Breakdown at all"
  case) rather than falling through to a floor-plan-empty-state keyed on a Tower/Floor that was
  never really selected.
- **The topbar "+ Add Floor Plan" button** refuses with the identical message (`UI.toast`) instead
  of opening a modal whose Tower `<select>` would have nothing to offer — checked before
  `openPlanForm` is ever called, not inside it.
- ⚠️ **Scoped precisely**: a project with **zero** Location Breakdown levels at all
  (`towerLevel()` null) is untouched by any of this — that's the separate, pre-existing "no
  Location Breakdown set up" message and its generic free-text Name-field upload path, neither of
  which this correction was asked to change.

### A second, independent bug found WHILE re-verifying Scenario A live

⚠️ **Real, pre-existing race condition — not caused by this correction, but this correction is what
made it consequential.** Re-verifying Scenario A on **SLN101** (real, rich schedule locations
confirmed directly: Tower A–D, 18 real floor values) showed **"No Locations Available" anyway** —
even though `ProgressPhotos.distinctLocValuesFor()`, called a moment later from the console on the
SAME page, correctly returned the real values. The DOM was simply stale.

**Root cause:** `module.js`'s `notifyProject()` — which fires bim.js's `onProject` callback and
triggers its first `render()` — runs **before `loadSchedule()` even starts**, in both `init()` and
the project `<select>`'s `onchange` handler. `SCHED_ACTS`/`LOC_LEVELS` (what `towerOptions()` reads)
are therefore still empty at that first render. This file's own code already had a comment
acknowledging the identical race for the Works datalist/filters (`fillFilterOptions()` re-run after
`loadSchedule()`) — nothing equivalent existed for bim.js's Tower/Floor picker. With the earlier
(now-removed) escape hatch, this race was invisible — a premature empty select just showed "+ Type
a new value…" and looked plausible. With the correct, closed picker, the same race surfaces as a
**false "No Locations Available" on a project that genuinely has established locations** — directly
undermining the very guarantee Scenario A is meant to prove.

**First fix attempt (`module.js` gaining `onScheduleReady(fn)`/`notifyScheduleReady()`, called once
per `loadSchedule()` resolution, `bim.js` registering a listener that just re-`render()`s) shipped
and was STILL WRONG — re-verified live and reproduced the identical stale "No Locations Available"
on SLN101.** ⚠️ Diagnosed rather than guessed at a second time: a probe listener registered from the
console mid-session DID fire correctly on a later project switch (`onchange`'s own single, linear
`await` chain), proving the notify mechanism itself worked — the failure was specific to the very
first page load, where `index.html` calls `ProgressPhotos.init`/`PPR.init`/`PANO.init`/`RECON.init`/
`BIM.init` back to back with **none of them awaited** (`safeInit`'s own `try { fn(); }`). Exactly when
each module's own async `init()` reaches ITS registration relative to `ProgressPhotos.init()`'s own
`await` chain reaching `notifyScheduleReady()` is not something to reason out from first principles
and trust blindly — a plain "fires going forward" listener can register a beat too late and simply
miss the one notification that matters, with nothing after it to ever correct the screen.

**Second fix attempt — made `onScheduleReady` replay-safe, mirroring `onProject`'s own existing
pattern** (`onProject: function (fn) { projectListeners.push(fn); if (pid) fn(pid, projName); }` —
a late registration still fires immediately if the data it's asking about already exists). New
`scheduleLoadedOnce` flag, set the first time `notifyScheduleReady()` ever runs; `onScheduleReady(fn)`
now also calls `fn()` immediately if that flag is already true. ⚠️ **This also shipped and was ALSO
wrong** — a fresh registration probe, run live from the console immediately after this fix deployed,
returned `firedImmediately: false` while `distinctLocValuesFor()` (called in the SAME breath) already
returned the real schedule values — directly contradicting the theory that `scheduleLoadedOnce` should
already be `true` by then. The replay-safe mechanism was correct; something upstream of it was not
firing at all.

**Third fix attempt — reordered `notifyScheduleReady()` to run before `fillFilterOptions()`** inside
`loadSchedule()`, on the hypothesis that a throw in `fillFilterOptions()` (an unrelated, later stage)
was silently swallowing the notify call. **Also wrong** — identical symptom on re-test.

**The true root cause, found by injecting `[DBG-INIT]` debug markers around `await loadSchedule()`
in `init()` and reading them back with `read_console_messages`'s `pattern` filter** (this tab had
accumulated console history across many prior page loads in the same long-lived automated session —
without the filter, the real signal was buried). The "before" marker fired; the "after" marker
**never fired at all**, even minutes after real Tower/Floor data was already confirmed present via
`distinctLocValuesFor()`. Cross-checked against `loadSchedule()`'s own pre-existing, unconditional
end-of-function summary log (added the same day, see the entry below) — **it never printed either.**
⚠️ **`loadSchedule()` performs FOUR sequential await-stages**: (1) `location_levels`, (2)
`project_schedule`/`SCHED_ACTS` via paginated `fetchAllPages` — the two stages bim.js's Tower/Floor
picker actually needs — then (3) a SEPARATE `fetchAllPages` for WBS-Summary rows (feeding the
unrelated Works-picker/`EXEC_WBS_CODE` feature) and (4) `activity_code_types`/`activity_code_values`.
On SLN101 — a real, large schedule — stages 3 and/or 4 apparently never resolve inside any
reasonable test window, so **the function as a whole never returns**, even though stages 1–2 (what
every prior fix attempt was gated on the completion of) had been done for minutes. All three
previous fixes notified from a point that could only ever fire after the WHOLE function settled —
which, on this project, functionally never happens.

**Fourth, correct fix: `notifyScheduleReady()` now fires from INSIDE `loadSchedule()` itself**,
immediately after stage 2 (`SCHED_ACTS` populated) — not from any caller awaiting the function as a
whole. The two now-redundant outer calls (in `init()` and the project `<select>`'s `onchange`
handler) were removed; both call sites simply `await loadSchedule()` and rely on the notify firing
from inside it, whenever that data is actually ready, regardless of how long stages 3–4 take or
whether they ever finish. All debug logging was removed once this was confirmed.

### Re-verified live, both required scenarios, against the TRUE fix — no data created or modified

- **Scenario A — SLN101 (4PH Strevi Bacoor), established Schedule locations.** A genuinely fresh
  navigation (past the browser's document cache) to SLN101 self-corrected automatically — the
  Tower/Floor bar populated with the real schedule values (Tower A–D, real floor names) with **no
  manual `render()` call from the console needed**, unlike every prior "fix." Only ever read
  SLN101's existing state; nothing was created or changed on it.
- **Scenario B — GPR101, no established Schedule locations.** Continued to correctly show
  **"No Locations Available"** with the exact required guidance text, no selects rendered, and
  "+ Add Floor Plan" toasting the same message instead of opening a dead-end modal.
- **The test zone "Live test zone (safe to delete)" was removed from GPR101 via direct SQL** (its
  floor plan is keyed to photo-derived, not schedule-established, Tower/Floor values, so it is
  correctly no longer reachable through the Floor Plan UI at all now that the fix is in place — the
  ordinary Delete button couldn't be used because the plan itself can't be opened). Confirmed via a
  scoped `select` locating the one matching row (`floor_plan_zones.id =
  '66f05322-2f32-46b0-97c1-29f0efc6115f'`), then a `delete … where id = … and name = …` (both
  conditions, as a double safety check) run through the Supabase SQL Editor. Re-queried afterward:
  **0 rows remain matching that name.** No other row in any table was touched.

`bim.js` → `?v=20260904d` (unchanged this round — only module.js's registration/staging semantics
changed); `module.js` → `?v=20260904g` (`module.css` unchanged throughout, stays `20260904a`).

## Floor Plan Tower/Floor picker: found live to be a real dead end — fixed with a union source + an escape hatch (2026-09-04)

⚠️ **SUPERSEDED — see the correction entry directly above.** The union-of-photos-and-schedule fix
and the "+ Type a new value…" escape hatch described below were both removed the same day, per an
explicit owner business-rule correction: the Project Schedule App must be the sole source of truth
for Tower/Floor, with no manual entry and no photo-derived fallback. This entry is kept as the
record of what was tried and why it was wrong, not as a description of current behaviour.

Tested the Tower→Floor→Floor Plan→Zones rebuild (entry below) **signed in, live, on production**
(GPR101 — a real, in-use project) immediately after merging it to `main`. Zone drawing, saving,
reload-persistence and the Revision-history pre-fill all worked exactly as designed against the
real database — see the "Verified live" note at the end of this entry. But opening **"Replace
Plan"** on that same real project surfaced a genuine defect the harness never could have caught:

⚠️ **`towerOptions()`/`floorOptions()` returned ZERO options on a project that is in active use.**
`bim.js`'s Tower/Floor `<select>`s are populated by `ProgressPhotos.distinctLocValuesFor()`, which
delegated straight to `distinctLocValues()` — **schedule-activities-only** enumeration
(`SCHED_ACTS`, i.e. `project_schedule.location`). GPR101's schedule has **never had a single
activity tagged with a Tower/Level value** — confirmed live via `ProgressPhotos.locLevels()` (3
real levels: Tower/Level/Zone) and `distinctLocValuesFor(towerId, {})` returning `[]` directly in
the console — while its **photos** already carry real, hand-typed location values ("as12",
"asda12", "12", "64", …, visible in the Photos-screen's own filter dropdowns, which read from
`photoLocCombos()` instead). A strict `<select>` fed only the schedule-side list had **nothing to
offer at all**, dead-ending "+ Add Floor Plan"/"Replace Plan" on exactly the kind of project this
module is meant to serve — one where locations were captured on photos before (or without) ever
being entered into the schedule.

**Fixed at the source, not by patching bim.js's call site.** New `distinctLocValuesAnySource()`
(module.js) unions the existing schedule-derived list with distinct values pulled straight from
`rows` (the photo library's own `location_values`), `priorVals`-narrowed identically against both
sources — and `distinctLocValuesFor` (the one export bim.js calls) now resolves through it. Every
future caller of that export inherits the fix automatically; nothing in bim.js had to know the fix
happened.

⚠️ **Even the union can legitimately be empty** — a brand-new project with no schedule locations
and no photos yet has nothing to enumerate from either source, and that's a real, valid state, not
a bug to route around. Both Tower and Floor `<select>`s now always carry a trailing **"+ Type a
new value…"** option (`optsHTML()`), matching this module's own established convention for exactly
this situation (the Works picker's "+ Add custom Works value…"). Picking it prompts for a value and
rebuilds the select with the typed value as a real, selected `<option>` — so the picker can never
be a closed loop with nothing in it. ⚠️ The sentinel value is checked explicitly in the Save
handler (`tSel.value !== NEW_OPT`) — if the escape-hatch option is left at its browser-default
selection (nobody actually opened the prompt), it must read as "no Tower chosen" and trigger the
existing validation, never get silently saved as a literal `"__bimnew__"` location value.

### Verified live (signed in, GPR101, production)

- **Zone create → persist → reload**: drew a 3-point triangle (dispatched real `click` events with
  `clientX/clientY` on `#bim-img` — the automation's coordinate-based `computer` click tool missed
  the element for an unrelated reason and was abandoned in favour of this), named it "Live test
  zone (safe to delete)", Finish shape → Save → **`Zones: 1`, toast "Zone saved"**, the zone
  rendered on the plan overlay AND in the list with Edit/Delete. **A full page reload** (fresh
  `load()` against the real DB, not a cached state) still showed `Zones: 1` with the same zone —
  confirming real persistence, not an optimistic-UI illusion.
- **Revision pre-fill**: "Replace Plan" opened with the header "Upload new revision", Tower/Floor
  correctly **disabled** (locked to the existing plan's own values), file input `accept="image/*"`
  only (no PDF), and Revision pre-filled to **"Rev. 02"** (existing-count + 1) — all per spec,
  confirmed via direct DOM inspection before Cancel (no second revision was actually created,
  since GPR101's existing Rev. 01 is a real, in-use floor plan and creating a real Rev. 02 on it
  wasn't part of what needed testing).
- **Cleanup**: the test zone is left in place intentionally, named and described as
  safe-to-delete, rather than deleted immediately after proving the write path — a planner or the
  next session can remove it via the ordinary Delete button in the Zones list with no DB access
  needed. ⚠️ Flag this to the project owner before treating GPR101's Floor Plan as clean.
- ⚠️ **Not exercised live**: the escape-hatch prompt() flow itself (would block the automated
  browser on a native dialog) — verified by reading the code path only, plus confirming
  `distinctLocValuesAnySource` itself (via the module.js source and the live `distinctLocValuesFor`
  console check above) actually resolves real values where the old schedule-only version returned
  none.

`bim.js`/`module.js` → `?v=20260904b` (`module.css` unchanged this round, stays `20260904a`).

## Floor Plan rebuilt to the real hierarchy: Tower → Floor → Floor Plan (with real
## preserved revisions) → manually-drawn, persisted Zones (2026-09-03)

Owner supplied a detailed functional spec (PDF) with an explicit scope clarification: this is
work on the **existing** "Floor Plans" subsection of Progress Photos (the third tab, alongside
Progress Photos / Presentations — already exactly that dropdown/tab strip, confirmed by
inspection before touching anything), not a new top-level app, and it must not add a second
Project selector (Project is already the shell's own topbar selector).

### What was actually there before this (inspected first, per the spec's own instruction)

`bim.js`'s "Floor Plan overlay" had a real floor-plan **upload** and a **pin-navigator** (click a
plan to drop a pin pointing at a photo/panorama/reconstruction, with an optional field-of-view
cone) — genuinely useful, left entirely intact. But against THIS spec it had two real gaps:

- ⚠️ **No revision concept at all.** `floor_plans` had no `revision`/`is_current` column. A
  second upload for the same location just inserted a SECOND, undated, unordered row with no way
  to tell which one was "the" plan — `planForValues()` returned `.filter(...)[0]`, whichever
  happened to sort first. Uploading a corrected drawing silently produced an ambiguous duplicate,
  not a preserved history.
- ⚠️ **No zone/polygon concept at all.** Only point PINS existed (with an optional direction
  cone) — there was no way to name and draw an actual area boundary, nothing to persist a
  polygon/rectangle, and nothing for a future Progress Photos → Zone link to reference.

Navigation itself needed no change — `Progress Photos | Presentations | Floor Plans` is already
exactly the tab strip described, confirmed in `index.html` before writing anything.

### Tower/Floor — reused the existing model, not a second one

Per spec §1/§18 ("use the existing data architecture… do not create duplicate models"): Tower and
Floor are the project's own first two **Location Breakdown** levels
(`ProgressPhotos.locLevels()`), the SAME schedule-driven levels every other Progress Photos screen
already reads — not a new `tower_id`/`floor_id` pair. A floor plan's Tower+Floor is still stored in
the existing `location_values` jsonb (keyed by level id), so a plan uploaded under the OLD generic
tree picker still buckets correctly — `towerFloorValues()` reads only the first two level keys out
of whatever a row happens to carry, ignoring any deeper level a pre-rewrite upload might have set.
⚠️ A project with fewer than 2 levels degrades: 1 level = Tower only (Floor omitted); 0 levels = no
Tower/Floor selection is possible, and the screen says so plainly rather than inventing a fallback
hierarchy — this is consistent with how the rest of this module already treats a missing Location
Breakdown, not a new limitation.

### Revisions — preserved, never overwritten

`migrations/2026-09-03-floor-plan-revisions-zones.sql` (**USER MUST RUN**) adds
`floor_plans.revision` (user-typed, defaults `'Rev. 01'`) and `.is_current` (boolean). Uploading a
new revision for an already-populated Tower+Floor **UPDATEs the previous current row to
`is_current:false` first, then INSERTs the new row** — the old row, its file, and its own zones
(scoped to ITS `floor_plan_id`) are never touched or deleted. `created_by`/`created_at`/
`updated_at` already existed and serve as "Uploaded By / Uploaded Date / Last Updated" — no
duplicate audit columns were added, matching spec §4's explicit split (Revision is the one
user-entered field; everything else is system-generated).

- The Upload modal suggests `Rev. 0N` (N = existing-revision-count + 1 for that Tower+Floor) but
  the field is always freely editable — never inferred from the filename, per spec §4.
- **"Replace Plan"** (on the floor-plan card) and **"+ Add Floor Plan"** (topbar, generic) are the
  SAME modal/flow — there's no functional difference between "add" and "revise" at the data-model
  level. The card's "Replace Plan" LOCKS the Tower/Floor selects (still visible, just disabled) so
  a revision can't land under the wrong floor by accident; the generic topbar button leaves them
  editable, since it's meant to work for any tower/floor.
- **Revision history** (a "History (N)" link, shown once 2+ revisions exist) opens a modal listing
  every revision with its upload date and a CURRENT badge; each has a **View** button opening a
  **read-only** preview — that revision's own image + its own FROZEN zones, explicitly labelled
  "read only". Editing is only ever possible on the current revision (spec §16 — a drawing revision
  can change the physical layout, so an old revision's zones must never be silently assumed
  identical to the new one, and nothing here copies zones across revisions).

### Zones — real, persisted, manually-drawn geometry

New table `floor_plan_zones` (id, `floor_plan_id` FK — one specific REVISION, never the Tower+Floor
group as a whole — name, `boundary_type` polygon|rectangle, `boundary_coordinates` jsonb array of
normalized `{x,y}` points, color, created_by/created_at/updated_at). A case-insensitive unique
index on `(floor_plan_id, lower(name))` enforces spec §13's "avoid duplicate zone names", surfaced
as a friendly toast rather than a raw constraint error.

- **Viewing vs editing mode (spec §14).** The floor-plan card renders read-only by default; **"Edit
  Zones"** toggles edit mode, which is the only state offering "+ Add Zone" / per-zone Edit /
  Delete — a planner just browsing the plan can't accidentally start reshaping a boundary.
- **Drawing** (`+ Add Zone`): a small inline panel (never a modal — the plan must stay visible and
  clickable while naming/drawing) with a Zone Name field (auto-suggested "Zone N", always
  editable), **Draw Polygon** (default) / **Draw Rectangle** toggle, Delete-last-point, Clear
  drawing, Cancel, Save. Polygon is click-to-add-a-point, finished either by double-clicking the
  plan or an explicit "Finish shape" button (the spec's own wording, "double-click… to finish", is
  honoured; the button is the more reliable path across browsers/touch). Rectangle is exactly 2
  clicks (opposite corners), auto-closing into 4 points — the "faster convenience" spec §10 asks
  for. **Editing an existing zone's geometry** reopens the SAME panel pre-seeded with its saved
  points rendered as draggable vertex handles (pointer-capture drag, live-repositioned without a
  full re-render so the drag gesture can't be interrupted — the same discipline the pre-existing
  pin/cone widgets already established).
- ⚠️ **Nothing is stored until Save.** The in-progress points live in a plain in-memory array the
  whole time — `drawPoints` — exactly matching spec §11's "not merely a visual overlay" requirement
  from the OTHER direction: the overlay IS a rendering of that array, and Save is the only thing
  that ever writes it to `floor_plan_zones.boundary_coordinates`.
- **Selection sync, both directions (spec §13):** clicking a zone's own overlay polygon on the plan
  selects/highlights its row in the list; clicking a list row selects/highlights the polygon on the
  plan. A "Clear selection" control appears whenever a zone is selected (spec §15's "clear
  selected-zone state").
- **Viewer**: Ctrl+scroll zoom and drag-to-pan already existed; added explicit **−/Fit/+/Reset
  view** buttons (spec §15's full list), all operating on the same pan/zoom state the mouse
  gestures already drove.
- **Progress Photos → Zone readiness (spec §17/§18), deliberately NOT built further than this:**
  `floor_plan_zones.id` is a stable UUID, scoped to a specific revision, ready for a future
  `progress_photos.zone_id` (or similar) reference — but no such column was added, and no
  "Progress Photos [N photos] [View] [Add]" panel was built under each zone. Spec §17 explicitly
  says not to implement unrelated Progress Photo functionality, and there is currently no
  photo↔zone link anywhere in the data model to honestly report a count from — a panel showing
  invented/zero data would be worse than no panel. This is the one deliberately incomplete piece,
  named here rather than silently shipped as if it were done.

### Real, in-source discipline points (not just described — verified against the actual behaviour)

- ⚠️ **`currentPlansList()`** — every OTHER caller that lists "which floor plans exist" (the
  Gallery upload-time pin picker `openPinPickerFor`, the Add/Edit Photo form's `pinFieldHTML`, and
  the `plans()` accessor `module.js`'s own Gallery Plan/Stack views read) was rewired from the raw
  `plans` array (now every historical revision) to a new `currentPlansList()` — one entry per
  Tower+Floor, always the CURRENT one. Without this, every one of those pickers would have started
  listing every superseded revision as an equally-valid pin target the moment a project had any
  revision history at all. **Verified directly**: a fixture with a superseded Rev. 01 and a current
  Rev. 02 of the same floor shows exactly 2 options (not 3) in both `pinFieldHTML` and
  `openPinPickerFor`'s picker, and the superseded revision's id never appears in either.
- ⚠️ **Zone-drawing clicks vs. the existing pan-drag gesture.** The stage's `mousedown` handler
  already decided "pan vs. place-a-pin"; a third meaning (draw a zone point) had to be added
  without a click doing two things at once — `drawMode` now suspends panning entirely while active,
  checked first in both `mousedown` and `click`.

### Verified

**Genuinely executed the shipped `bim.js`, not a reimplementation**, via a throwaway browser
harness (`.claude`'s own static-server convention — served over `localhost:5173`, deleted after
use) driving the real DOM: script loads with no syntax error; Tower/Floor selects populate from a
stubbed 2-level Location Breakdown; empty state + "+ Add Floor Plan"; the upload modal's
Tower/Floor pre-fill + lock behaviour; a real first-revision insert with correct
`revision`/`is_current`/`location_values`; a full click-to-draw-a-triangle → Finish → Save cycle
persisting exactly 3 normalized points scoped to the right `floor_plan_id`; **the spec's own §22
test flow, literally** — reload (a fresh `load()` against the same fake DB) → zone still there;
list↔plan selection sync both directions; Edit (rename + 3 draggable vertex handles rendered) →
Save updates the SAME row, not a second insert; Delete → count drops, confirmed via `confirm()`;
uploading a **second revision** for the same floor → the previous row flips to `is_current:false`
(never deleted) → the new revision starts at **Zones: 0** (nothing carried over); the Revision
History modal lists both with a CURRENT badge; opening the OLD revision's read-only preview shows
**its own** frozen zone, correctly scoped by `floor_plan_id`, labelled "read only". A second,
focused harness confirmed `currentPlansList()`'s filtering in `pinFieldHTML` and
`openPinPickerFor` against a 3-plan/2-floor fixture (2 current, 1 superseded) — exactly the current
ones offered, the superseded one never appearing in either picker.

CSS brace-balanced (578/578); `bim.js` brace/paren-balanced (432/432, 1904/1904); 0 NUL bytes;
migration paren-balanced, idempotent, RLS mirrors the existing `floor_plan_pins` policy shape
exactly. `bim.js`/`module.css`/`module.js` → `?v=20260903a`; topbar button relabelled "+ Upload
floor plan" → "**+ Add Floor Plan**" per the spec's own wording.

⚠️ **Not verified**: signed in against a live Supabase session (the standing caveat for this whole
module — no live login is possible in this environment) — in particular the real Storage upload,
the migration actually running, and RLS against a real multi-user project are unverified beyond
structural review. The "Delete a point" interaction (spec §9) is satisfied only as "delete the
LAST point" (via the draw panel's own button), not an arbitrary mid-shape point — dragging any
point to reposition it is fully supported; deleting one from the middle of an in-progress polygon
is not, a scope trade-off made under the pass's time budget rather than an oversight.

## PowerPoint export was silently corrupting on real captions — root cause found and fixed (2026-09-03)

Owner: a downloaded PPTX opened in PowerPoint Desktop with **"Sorry, PowerPoint can't read
[filename]"** — PowerPoint's harshest error (not the softer "would you like us to repair it?"
prompt). Investigated as a generation-corruption problem, not a download/blob-handling one, per
the report's own framing — and that framing was right.

### Root cause, reproduced directly

`exportPptx()` (this file) builds the deck entirely **client-side** via **PptxGenJS v3.12.0**
(`pptxgen.bundle.js`, pinned CDN version, `modules/progress-photos/index.html`) — there is no
backend/HTTP layer in this path at all; `pptx.writeFile()` is the library's own browser-download
method, JSZip under the hood. Confirmed by pulling PptxGenJS's own **real source** at the exact
pinned tag (`v3.12.0`) from GitHub and reading `addImageDefinition`/`createChartMediaRels` end to
end: the image-embedding path (including this file's `stripDataPrefix()`) was already correct —
PptxGenJS's own zip-writer does `data.split(',').pop()`, which discards a `data:` prefix whether
`stripDataPrefix` removed it or not, so that was never the bug.

⚠️ **The real defect: PptxGenJS's `encodeXmlEntities()` only escapes `& < > " '` — it does NOT
strip XML-1.0-illegal control characters**, and this module has never sanitized any user-typed
text (project name, description, per-photo captions, trade/works/location) before handing it to
`addText()`. A single stray control character — the kind a paste from WhatsApp, an OCR pass, a
mobile keyboard, or a legacy DB value can carry invisibly — lands in the slide XML byte-for-byte.
That is not well-formed XML, and PowerPoint's own strict parser refuses the **whole file**.

⚠️ **Proven, not inferred.** Built a real browser test harness that generates an actual `.pptx`
via the real CDN library, then re-opens the resulting Blob with JSZip and validates every
package entry (`[Content_Types].xml`, `_rels/.rels`, every `ppt/slides/slideN.xml`, every
`ppt/media/*` file's own binary signature) via `DOMParser`. A clean multi-slide/multi-image build
— including a **real fetch→blob→canvas→toDataURL pipeline** matching `collectSlideImages()`
exactly, and the literal reported filename (`…Dasmariñas…`) through the actual `writeFile()`
download path — validated 100% clean: correct ZIP signature, well-formed XML throughout, every
embedded image a valid JPEG. Embedding a single **U+000B (vertical tab)** into a title string,
however, reproduced the failure exactly: `MALFORMED XML in ppt/slides/slide1.xml: … PCDATA
invalid Char value 11`. This is the "before" side of the fix, measured against the real,
currently-shipped code — not assumed.

### Fix

New **`sanitizePptxText(s)`** (module scope, beside `esc()`): strips the C0 control range
(`\x00-\x08 \x0B \x0C \x0E-\x1F \x7F`) — keeping **tab/LF/CR**, the three control characters
XML 1.0 actually permits — and separately drops any **unpaired UTF-16 surrogate** (no valid
Unicode code point, no valid UTF-8 encoding — the identical failure class, one character short
of a full emoji). Applied at every point `exportPptx()` hands text to PptxGenJS: the title-slide
project name and description/date, each pane's caption block (`capLines` — capture date +
caption + trade/works/location tags), the shared-location banner, and the download filename.

⚠️ **Deliberately narrow.** It removes only bytes that cannot appear in valid XML text at all —
never a printable character a real caption might use. Verified directly: sliced the **real,
shipped** `sanitizePptxText` back out of the committed file (never retyped) and ran it against a
clean-text regression set — the exact reported project name **"4PH Jab Greenwoods Dasmariñas"**
(the accented ñ), emoji, café/naïve/Zürich accents, and literal tab/LF/CR — every one survived
**byte-for-byte unchanged**. This directly satisfies the standing requirement that the printed/
exported header text and every other existing behaviour (Internal/External type, its filter, the
photo-markup toggle, zoom) must not regress; none of those were touched by this change at all —
confirmed by diff, not just by not having edited those functions.

Then re-ran the exact same U+000B fixture through the real, fixed pipeline: `ok: true`, 0
notes, the slide's actual `<a:t>` text reading `"...Dasmarinas Tower 1"` — the illegal byte gone,
everything else intact.

### Answering the brief's specific questions

- **PPTX generation, or download/blob handling?** Generation. There is no separate download step
  to corrupt — `writeFile()` builds the complete Blob in memory (proven byte-identical to the
  in-memory `write({outputType:'blob'})` build, confirmed by re-fetching from `writeFile()`'s own
  object URL) and only then triggers the browser save.
- **Library correctness?** PptxGenJS's own image/zip-writing code is correct for this use, so the
  fix is in **our** call site (sanitizing text before it reaches `addText()`), not a library swap
  or a rewrite of `exportPptx()`'s structure/design.
- **Not a fake/renamed file.** The output is still a genuine OOXML package built by PptxGenJS +
  JSZip; the fix changes what text goes INTO the same real pipeline, nothing about its output
  format.

### Verified

No `node` binary is available in this environment (checked directly; this repo's own extensive
`test.js` suite for this module needs it and could not be run this pass) — verification here is
**live browser execution of the real, shipped code against the real, pinned PptxGenJS + JSZip
libraries**, which for this specific class of bug (real XML well-formedness inside a real
generated ZIP) is stronger evidence than a Node-side structural/regex check would have been.
`node --check`-equivalent syntax validity is implied by the file loading and executing correctly
in-browser throughout every test run. 0 other lines touched; `git diff --stat` shows exactly one
file, +42/−5 lines, confined to `sanitizePptxText`'s declaration and its five call sites inside
`exportPptx()`/`pptxPane()`.

⚠️ **Not verified**: a real device/PowerPoint-Desktop open-and-save round-trip (this environment
has no Windows PowerPoint to drive), and the HTML/PDF export paths were deliberately left
untouched — a raw control character renders far more harmlessly inside HTML/DOM text content than
inside strict OOXML XML, and neither export function was touched by this fix, so neither carries
any risk from it either way. `ppr.js?v=` bumped `20260902g` → `20260903a` in `index.html` (merged onto main's own same-day `20260902g` round, which had independently touched unrelated regions of the same file).

## Discontinue 360° panoramas: greyed out (not removed) + a one-time DB purge (2026-09-02)

Owner: *"the 360 photo feature is quite buggy. let's discontinue it for now. disable and grey out
360. delete all 360 photos from the database as well."* Landed just before the eight-item Round 2
below, and following this file's own convention for retiring a feature: **shelved, not stripped** —
the same call already made for 3D/Gaussian-Splat reconstruction (2026-09-01).

- **Both places 360° could be started from are now `disabled` and greyed out**, matching the shape
  the 3D button already had. The **"+ Add media" dropdown** button in `index.html` drops its
  `data-addtype="360"` entirely (a disabled button carrying an action attribute would be confusing
  to read, since nothing dispatches on it any more) and gets `disabled title="360° capture is on
  hold"` instead; `module.js`'s loop that wires `[data-addtype]` clicks now only ever wires
  Photo/Video, since 360° no longer has that attribute to match. The **upload modal's own type
  selector** button (`#…-mtype-360`) gets the identical `disabled title="360° capture is on hold"`
  treatment.
- ⚠️ **The click handler that hands off to `pano.js`'s real capture flow is deliberately left wired,
  not deleted** — a disabled button can't fire a click, so it's simply unreachable while `disabled`
  stays on the element. Re-enabling 360° later is therefore a one-line change (drop `disabled`,
  restore `data-addtype="360"`), not a rebuild — the whole capture/stitch pipeline in `pano.js` is
  untouched and still fully wired underneath the disabled button.
- ⚠️ **Reverses a narrower, more recent decision, not an old one.** An earlier round (2026-08-29
  feedback item 17) had specifically *re-enabled* 360° as a live fourth option alongside Photo/
  Video/3D, with only 3D staying disabled. This entry reverses exactly that — both stay disabled
  now, and the module.js/test.js comments explaining the earlier re-enable were updated in place to
  say so, rather than left describing a state that's no longer true.
- **New migration `migrations/2026-09-02-discontinue-360-panoramas.sql`** — a destructive, one-time
  cleanup of every existing panorama capture, run by the owner in the Supabase SQL editor (this repo
  has no live DB credentials, so it can only ever ship as a migration someone runs, never something
  executed from here). Deletes in dependency order so nothing is ever left dangling for even one
  statement: **`floor_plan_pins`** rows pointing at a panorama first (a pin surviving its target's
  deletion would be an orphan the app has to degrade around forever), then the stitched JPEGs
  themselves from **`storage.objects`** (matched off each row's own `pano_url` column, so this can
  never drift from wherever `pano.js` actually uploads to), then the **`panoramas`** rows last, once
  nothing points at them and their files are gone. Idempotent — re-running it against an
  already-empty table is a no-op.
- ⚠️ **The `panoramas` table and every `item_type = 'panorama'` code branch stay in the schema and
  in `bim.js`/`module.js`, untouched** — this migration clears data, it does not retire the feature
  at the schema level. The app already degrades correctly with zero panorama rows (the Gallery
  media strip and floor-plan pins render nothing when a project has none), so the UI-side change
  above does not depend on this migration having been run.

### Verified
Covered by the same full-suite run as the Round 2 entry below (they landed in the same commit):
`node --check` clean, the type-selector/dropdown assertions in `test.js` were updated in place
(not silently deleted) to assert both buttons ARE disabled now, reversing the pre-existing
assertions that had checked 360° was live. ⚠️ **The migration itself is unverified and cannot be
run from here** — no live Supabase credentials exist in this environment; the owner runs it
directly in the SQL editor.

No `?v=` bump needed beyond what Round 2 already carries below — `module.js`/`index.html` landed
in the same commit as that round's own version bump.

## Owner feedback round 2: white-on-red markup icon, magnifier over zoom, per-pane key-plan toggles, image-only floor plans, Stack view removed, forced markup in List/Plan (2026-09-02)

Owner's eight-item list off the Presentations screen + the shared floor-plan/lightbox chrome.
Items 1–6 and 8 landed first in this same session; item 7 (Stack view) is the one this entry
closes out, and is documented last because it's the one with the most moving parts.

1. **The Presentation-pane "show markup" icon was black over its own red fill.** `.pp-iconbtn
   .is-active` already gave the button a solid `var(--pd-red)` background — the icon inside it
   was reading a stale/inherited `color` instead of the button's own white, the same root cause
   as the pre-existing `.pp-del:hover` fix a few lines above it in `module.css`: the SVG's own
   `stroke="currentColor"` needs the icon targeted **explicitly** (`.pp-iconbtn.is-active .pd-ico,
   .pp-iconbtn.is-active [data-ico] { color: #fff; }`), or it can be left inheriting a value from
   further up the tree. Applies to every `.pp-iconbtn.is-active` icon in the module, not just this
   one button.
2. **Zoom buttons removed from the presentation-pane image previews** — zoom now belongs only to
   the full image pop-up (item 3). `applyPaneZoom` (ppr.js) and its two `#ppr-...zoomout/zoomin`
   buttons are gone from `pane()`'s corner-tool cluster; the panes render at their natural size
   with no zoom affordance of their own.
3. **The image pop-up's zoom buttons became a magnifier.** `applyLightboxZoom`/`lightboxZoom`
   (module.js) are retired; a small lens (`#pp-lb-magnifier`, `.pp-lb-magnifier` in module.css)
   now follows the pointer over the lightbox image, showing a zoomed crop under the cursor rather
   than scaling the whole image. `magnifierGeom(cursorX, cursorY, imgRect, wrapRect, size, zoom)`
   is a small, pure, exported function (`PP._magnifierGeom`) computing the lens's own position and
   the background-image offset needed to show the correct crop under it — pulled out specifically
   so a wrong sign/offset here (which would silently show the wrong part of the photo under the
   lens) could be genuinely executed and checked, not just read as source. `hideLightboxMagnifier`
   hides the lens on mouseleave and whenever the lightbox itself closes or steps to a different
   photo, so it can never be left floating over the wrong image.
4. **The image pop-up's key plan now really shows** — position, the pin, and the direction cone
   when recorded — sized to 1/8 of the photo, top-right, and resizable by dragging its bottom-left
   corner. `kpResizeFrac`/`wireLightboxKpResizeDrag` compute and apply the new size purely from the
   drag delta against the overlay's starting fraction-of-photo size, clamped to a sane min/max —
   the same "pull the pure math out so it can be genuinely executed" reasoning as `magnifierGeom`.
   The toggle button sits immediately to the left of the show-markup button, per the owner's own
   placement.
5. **Presentation panes: the key-plan toggle moved from ONE shared header control back to a toggle
   per pane, "opposite the previous/current label."** This is a deliberate reversal of an earlier
   round's consolidation (`showKeyPlan`, a single flag driving both panes at once) — the owner
   asked for that consolidation to be undone specifically for the pane view, while the lightbox's
   own single-photo overlay (item 4) stays as it was. `keyPlanOpenPane = {before:false, after:false}`
   replaces the shared flag; each pane's own small icon button (`data-kptoggle="before"/"after"`,
   `.ppr-panetop` wraps it beside the Previous/Current label) toggles only that pane's popup, and —
   the rule this file's own convention insists on for every such control — the button is rendered
   **only when that specific photo actually has a key plan at all** (`kpHasPlan`), never a
   speculative, usually-inert toggle. `openPpr()` resets both panes' state to closed whenever a
   presentation is opened, so a stale open popup can never carry over from a previous slide.
6. **Floor plan upload now accepts images only — no more PDF.** `accept="image/*,application/pdf"`
   → `accept="image/*"` on both floor-plan upload entry points (the main modal, and the inline
   mini-form embedded in the Add/Edit Photo form). Both save handlers dropped their `isPdf`
   detection entirely — `imageDims()` always measures a real image via `<img>.onload` now, with no
   PDF short-circuit — and the file-choice guard's toast reads "Choose an image file" (was "...or
   PDF file"). ⚠️ **`isPdfPlan()`/the `<embed type="application/pdf">` render path are deliberately
   KEPT, not removed** — solely so a floor plan uploaded *before* this change (when PDF was still
   accepted) still displays correctly; nothing in this file can produce a **new** PDF-backed plan
   any more, and the function's own comment says so.
7. **Stack view is removed entirely** ("remove stack view for the photos") — not retired-in-place,
   deleted outright, the same treatment this module already gave the Today's Rounds feature. This
   was the last item finished and is detailed in its own section below.
8. **List and Plan views no longer show a hide/show-markup toggle — markup is on by default there.**
   `markupGlobalVisible()`'s consumer at the per-tile render site now reads `(view === 'list' ||
   markupGlobalVisible())` — List always draws a photo's markup when it has any, ignoring the
   shared toggle; and the toggle button itself (`#pp-mkvistoggle`) is hidden entirely
   (`b.hidden = true; return;`) whenever `view === 'list' || view === 'plan'`, since there is
   nothing left for it to control on those two screens. Gallery and the lightbox keep the toggle
   and the shared preference exactly as before.

### Item 7, in full — Stack view deleted from every file

⚠️ **A whole feature, deleted rather than retired-in-place**, per the owner's own wording ("remove")
— the same standard this module already applied to Today's Rounds. Removed completely from all four
touched files:

- **`index.html`** — the `.pd-vt[data-view="stack"]` view-toggle button (the layers icon) is gone
  from the Gallery view-switch row; only List/Gallery/Plan remain.
- **`module.js`** — the whole implementation: `stackLevels`, `stackRowLevel`, `stackColLevel`,
  `stackMonthsAvailable`, `mostRecentAsOf(list, cutoff)`, `stackRowSort(names)`, `stackGrid(cutoff)`,
  `STACK_COMBINE_MAX`, `renderStackView()`, `stopStackPlay()`, `wireStackView()` — 11 functions in
  all, plus their state (`stackRowLevelId`, `stackColLevelId`, `stackStepMode`, `stackMonth`,
  `stackPlaying`, `stackPlayTimer`), the `id="pp-stack-*"` toolbar/table/magnifier markup those
  functions rendered, the `view === 'stack'` dispatch branch in `render()`/`restoreUI()`'s
  whitelist, and the `_stackGrid`/`_stackRowSort`/`_mostRecentAsOf` test-only hooks that existed
  purely to exercise them.
- **`module.css`** — the entire `.pp-stack*` rule block (levels/wrap/table/cell/thumb/mag, both
  the desktop rules and the phone-width override's `.pp-stackthumb-sm` touch-target sizing).
- **`test.js`** — every assertion that drove the retired functions was rewritten (not silently
  deleted) to assert the OPPOSITE — that Stack view is genuinely, completely gone — following this
  file's own "healthy churn from an intentional change" convention. A new comprehensive `[49]`
  section sweeps for remnants across all four files: no Stack toggle button in `index.html`; not
  one of the 11 retired functions survives in `module.js`; **not one Stack-only state variable
  survives** (checked as real `var` declarations, not bare substring mentions — the retirement
  comment's own prose legitimately still names `STACK_COMBINE_MAX` in passing, and an earlier draft
  of this exact assertion falsely flagged that prose as a surviving declaration before being
  narrowed to `!/var STACK_COMBINE_MAX/.test(mjs)`); no `id="pp-stack-*"` markup anywhere; the
  `render()`/`restoreUI()`/view-comment dispatch mentions only `plan`'s state now, with 0 remaining
  `view === 'stack'` branches; the retired test hooks are gone from the exported test-only object;
  no `.pp-stack*` CSS rule survives anywhere in the stylesheet; and — the self-referential check —
  `test.js` itself carries no surviving call to `PP._stackGrid`/`_stackRowSort`/`_mostRecentAsOf`,
  so this file's own retired assertions were genuinely rewritten, not merely left disabled.

### Verified

**918 checks green, 6 known pre-existing failures** (unchanged from before this round, confirmed by
name): `insert uses .select() to return the id`; `pane() reads each photo's own trade/works/
location`; `the presentation row is created inside finish() — never before the wizard completes`;
`every #fff use sits under a documented fixed-colour selector — [".ppr-panelabel.is-current"]`;
`Clear filters does NOT reset the archived toggle — it is a separate view, not a search filter`;
`the Add/Edit form shows a Report Type <select> defaulting to Internal for both a brand-new
presentation and a legacy (unset) one being edited`. None of the eight items above touch any of
these six, and none is newly introduced by this round.

`node --check` clean on `module.js`/`ppr.js`/`bim.js`/`test.js`; 0 NUL bytes across every touched
file (byte-level check); CSS braces balanced (526/526, module.css); 0 duplicate DOM `id=`
attributes in `index.html` (91 unique). Function-set diff against the prior commit
(`d9a7992`): `module.js` **11 lost / 7 added** (all 11 losses are Stack view, all deliberate, per
item 7's own list above; the 7 additions — `hideLightboxMagnifier`, `kpResizeFrac`, `lineDashFor`,
`magnifierGeom`, `setShown`, `wireLightboxKpResizeDrag`, `wireLightboxMagnifier` — are items
3/4's own new geometry/wiring functions); `ppr.js` **1 lost / 0 added** (`applyPaneZoom`, item 2's
own deliberate removal — its replacement, the per-pane key-plan toggle of item 5, reuses existing
functions rather than adding new ones); `bim.js` **0 lost / 0 added** (untouched by this round).

⚠️ **Not verified signed in** — same standing caveat as every entry in this file. In particular:
the magnifier's real on-screen tracking against a live rendered photo, the key-plan overlay's
actual drag-to-resize gesture, and the per-pane toggle's real click-through against a live
presentation have all been verified by genuine execution of the underlying geometry/state
functions and by structural source checks, never by driving a real browser session.

`module.css`/`module.js`/`ppr.js`/`bim.js` → `?v=20260902g` (all four bumped together — this
round touched all four, and `bim.js` in particular had no functional change but is re-stamped so
its cache key isn't left pointing at a stale round's version string).

## Twelfth feedback round: thumbnail-only picking, drone pin provenance, markup toolbar rework, key-plan overlay, click-to-open, zoom everywhere (2026-09-02)

Owner's 12-item list for the Presentations screen + the shared markup editor. No migration —
every column and table this touches already exists.

⚠️ **This entry was rebased onto the "Eight-item owner feedback round" below (a separate,
independently-landed round touching the same screens), and several of its items were reconciled
against that round's later decisions rather than reapplied verbatim** — see the "Reconciled during
rebase" note at the end of this entry for exactly what changed and why.

1. **The "+Add Slide" photo picker now requests THUMBNAILS, not full-resolution images**, while
   picking — `openThumbPicker` reads `thumbUrlOf(r)` (falling back to full-res only when a photo
   predates the client-generated thumbnail column) instead of the full-size signed URL, matching
   the "expanded view only" rule this module already applies everywhere else a photo is browsed
   rather than examined.
2. ⚠️ **Superseded by the later Eight-item round's own item 9** — that round shortened the
   back-button label from "← Back to list" to a bare "Back" (the arrow icon already carries the
   direction). This item's original ask ("← Back to list") is kept only in spirit — the button
   still sits as a quiet breadcrumb link beside the screen tabs; the exact wording follows the
   later, more recent decision.
3. **Key-plan pin icon on the floor-plan view**: the photo/person pin shrank; a drone-sourced pin
   now gets its own distinct icon (`drone` — a small quadcopter body with four rotor-ringed arms,
   new in the shared `assets/js/icons.js`, recognisable even at pin-marker size rather than reusing
   a generic gadget glyph) and a soft **gradient halo three times the icon's size** around it, so a
   drone-sourced photo is identifiable on the plan at a glance without opening it.
4. **The camera-angle drag handle moved slightly closer to the pin** on the key-plan marker — it
   was sitting far enough out to read as a second, unrelated control; tightened the offset so the
   pin+handle read as one widget.
5. **Presentation-view delete button now turns white (not grey) on hover** — it sits on the same
   dark scrim every other pane corner-overlay button uses, and grey-on-dark read as disabled.
6. **The lightbox's markup show/hide toggle was broken — fixed.** It was silently defaulting to
   the wrong CSS `display` value on toggle (`''` instead of `'block'` on the canvas, so an empty
   string computed to the element's own default `inline`, which never actually painted the
   overlay in the position the rest of the layout expects); it now explicitly sets `'block'`.

### Items 7–10 — the presentation pane rebuilt around the photo's OWN markup, a real key plan, and zoom

⚠️ **Item 7 retires a whole editing feature, not just a toggle.** The pane's per-photo
"add presentation markup" button (`ppr-mkedit-<which>`, backed by the separate `ppr_slide_markups`
table — a presentation-only overlay distinct from the photo's own permanent
`progress_photos.markup`) is **gone**. In its place, each pane carries a plain **view/hide toggle**
over the photo's own real markup — the same array the Gallery lightbox already draws from — reading
and writing the **one shared, persisted preference** through `photoMarkupVisible()`/
`setPhotoMarkupVisible()`, which proxy `ProgressPhotos.markupGlobalVisible()`/
`setMarkupGlobalVisible()` (the same flag every tile and the lightbox already use). Hiding markup
here hides it everywhere; there's nothing pane-local left to lose on a re-render. ⚠️ **There is no
per-pane toggle BUTTON at all** — only the header-level `#ppr-photomk-toggle` (wired in
`wirePresActs`) controls the shared preference; `pane()` itself only decides whether to draw the
photo-markup canvas (`ppr-photomkcanvas-<which>`), never a control to click.
- ⚠️ **`ppr_slide_markups`'s superseded machinery (`showMarkup`, `markupCache`, `markupRowId`,
  `markupTableMissing`, `T_MARKUP`, `markupKey`, `markupFor`, `saveSlideMarkup`) is left in
  place, retired-in-place** — this module's established convention for a design a later round
  supersedes, not silently deleted. `load()`'s fetch of that table is a technically wasted
  round-trip now; touching it was out of scope for this round and left alone deliberately.

**Item 8 — the key plan is now the real bim.js pin+cone system** (position + camera direction),
not the old flat reference-image toggle. `keyPlanInfoForPane(photoId)` resolves
`BIM.pinInfoFor('photo', photoId)` into `{pin, planUrl, aspect}` — `aspect` is the plan's own true
`width_px/height_px` ratio when known, falling back to a plain 4:3 box otherwise, never a
divide-by-zero/NaN (a zero-height plan is treated as "unknown" too). The overlay box's inline CSS
`aspect-ratio` is set to that value, paired with `object-fit: contain` on the plan image — when the
two agree, the pin's percentage-based position lands pixel-exact with no letterboxing or distortion.
- **Resizable by dragging the overlay's bottom-left corner** (`wireKpResizeDrag`): the box is
  pinned `top:8px;right:8px`, so only its WIDTH needs to change (the CSS `aspect-ratio` keeps
  height following automatically) — dragging left grows it, dragging right shrinks it, and the
  top-right corner never moves. Defaults to 10% of the pane (`KP_OVERLAY_DEFAULT`), clamped
  6%–60% (`KP_OVERLAY_MIN`/`MAX`).
- **A legacy fallback (`keyPlanPathFor`, the old flat `key_plan_url`) renders a plain, pin-less
  picture** for a photo captured before bim.js's pin system existed — no pin data means no cone to
  draw, so it degrades to what it always showed rather than throwing or hiding the overlay entirely.
- Draws the marker via `BIM.keyPlanMarkerHTML(pin)` — the exact same pin+cone markup the Plans
  tab's own full view uses, never a second, re-derived drawing.
- ⚠️ **Gated by the SINGLE header `showKeyPlan` flag** (item 11's own design, from the Eight-item
  round's ancestor round — see reconciliation note below), never a per-pane open state: `kpOpen =
  showKeyPlan && (kpInfo || kpLegacyPath)`.

**Item 9 — clicking a pane's photo opens the ordinary lightbox.** The `<img>` carries
`data-openphoto="<id>"`, wired in `wirePaneMarkup` to `ProgressPhotos.openPhotoById(this.dataset.
openphoto)` — the same guarded function the audit-fixed Plan/Stack views already use (checks the
full photo library, toasts and bails on a miss, never silently falls back to index 0 the way a raw
`openLightbox(id)` against a filtered list would). ⚠️ **Bound to the `<img>` itself, never the
wrapping `.ppr-imgwrap`** — the corner tool buttons (markup canvas/key-plan overlay/zoom) are
siblings of the image, not descendants of it, so a click on one of them can never bubble into this
handler.

**Item 10 — zoom in/out on every photo viewer surface**:
- **Lightbox**: new `#pp-lb-zoomout`/`#pp-lb-zoomin` buttons (new `zoomOut`/`zoomIn` icons), placed
  between Download and the markup-EDIT button in the left tool cluster (the markup SHOW/HIDE toggle
  lives in the separate right-hand cluster beside Key Plan — see the Eight-item round's item 6).
  `lightboxZoom` resets to 1 as the FIRST thing `paintLightbox()` does — **before**
  `paintMarkupOverlay()` ever measures the image's bounding rect via `getBoundingClientRect()`,
  since that measurement reflects any active CSS transform at the moment it runs; measuring under a
  stale non-1 zoom would size the canvas wrong. `applyLightboxZoom()` applies an identical
  `transform: scale(z)` to the `<img>`/`<video>` AND the markup `<canvas>` so the two stay
  pixel-aligned at any zoom with no canvas resize/redraw.
- **Presentation panes**: `applyPaneZoom(which)` does the same thing for `.ppr-img`/
  `.ppr-photomkcanvas-<which>` (the photo's own markup canvas — there is no per-pane slide-only
  canvas any more, see item 7 above), reset to 1 on every slide prev/next. Both surfaces clamp
  1×–3× in 0.25 steps and disable the respective button at each boundary.
- ⚠️ `.ppr-imgwrap`/`.pp-lb-imgwrap` both gained `overflow: hidden` so a zoomed image can never
  spill outside its frame; both media elements and the lightbox's markup overlay share the same
  `transform-origin: center center` so scaling grows from the frame's centre, not a corner.

### Reconciled during rebase (2026-09-02)

This entry's commit was rebased onto `origin/main` after the Eight-item round below had already
merged there — the two rounds turned out to overlap on exactly the two features items 7 and 8 touch,
and reconciling them (rather than force-applying this round's diff verbatim) surfaced one genuine
defect:

⚠️ **A real duplicate-mechanism bug, caught by reading the auto-merged `pane()` function, not
flagged by git.** This round's own `mk`/`mkVisible`/per-pane `ppr-mktoggle-<which>` toggle button/
`ppr-mkcanvas-<which>` canvas (reading `ph.markup` via a plain session-only flag) had textually
auto-merged cleanly alongside the Eight-item round's OWN, separately-built `photoMk`/
`photoMkVisible`/`#ppr-photomk-toggle`/`ppr-photomkcanvas-<which>` mechanism — reading the **same**
`ph.markup` field, just through the shared, persisted `markupGlobalVisible()` preference instead.
Both mechanisms would have painted the same markup TWICE via two independent, competing toggle
controls, since the two edits sat on non-overlapping lines and git's 3-way merge had no reason to
flag them as conflicting. Resolved by dropping this round's duplicate entirely and upgrading the
Eight-item round's own mechanism with two small proxy functions — `photoMarkupVisible()`/
`setPhotoMarkupVisible()` — so this round's item 7 requirement ("persist the setting") is met
without a second markup mechanism ever existing.

⚠️ **Item 11's per-pane `keyPlanOpenPane` state (from the Eight-item round's own ancestor) was
already retired there in favour of one shared `showKeyPlan` header flag** — this round's key-plan
work (item 8) is gated on that same single flag (`kpOpen = showKeyPlan && (kpInfo || kpLegacyPath)`),
never a reintroduced per-pane open state. A new `_setShowKeyPlan`/`_getShowKeyPlan` test hook was
added (replacing a `_setKeyPlanOpenPane` hook this round had originally written against the retired
per-pane map) so the overlay's open/closed behaviour can still be genuinely executed in tests.

**Verified after reconciliation: 924 checks green, 6 pre-existing failures** (confirmed unchanged
against a clean `origin/main` checkout via a scratch git worktree, before this round's rebase touched
anything — `pane() reads each photo's own trade/works/location`, `every #fff use sits under a
documented fixed-colour selector`, `Clear filters does NOT reset the archived toggle`, `insert uses
.select() to return the id`, `the presentation row is created inside finish()`, and the Report Type
`<select>` default — none touched by this round, none introduced by the rebase). Every assertion this
round's own section touches was rewritten to genuinely execute against the reconciled source (via
`_keyPlanInfoForPane`/`_paneHTML`/`_setPaneZoom`/`_getPaneZoom`/`_applyPaneZoom`/`_setShowKeyPlan`)
rather than left asserting the pre-reconciliation shape, and one further real bug in the SUITE itself
(not the app) was found and fixed while doing so — a stale `!/\.pp-lb-tool-labeled/` substring check
that tripped on this file's own explanatory prose mentioning the retired class name, narrowed to
match a real CSS rule declaration instead. `node --check` clean on every touched JS file; 0 NUL
bytes; CSS braces balanced (538/538); 0 duplicate DOM ids (91 unique).

⚠️ **Not verified signed in** — the standing caveat for this whole module. In particular: the real
drag-to-resize gesture on the key-plan overlay, the actual pointer-driven zoom buttons against a
live rendered pane/lightbox, and the drone-pin halo's real visual appearance on a real floor plan
are all verified by genuine execution of the underlying render/state functions and by structural
source checks, not by driving a live browser session.

`module.css`/`module.js` → `?v=20260902a` (unchanged by this round's reconciliation); `ppr.js` →
`?v=20260902f`; `bim.js` → `?v=20260902b` (both bumped fresh, since their reconciled content differs
from what either round alone shipped); `assets/js/icons.js` (new `zoomIn`/`zoomOut`/`drone` icons,
shared app-wide) → `?v=20260902f` across all 20 referencing pages.

## Bug fix: no delete path for 360°/3D media anywhere in the Gallery (2026-09-04)

Owner report, verbatim: *"i cant delete 360/3D media from the photos gallery. pleas fix bug."*
Confirmed by reading every place a panorama/reconstruction pseudo-row is rendered or acted on —
**there was genuinely no delete affordance anywhere**, not a hidden/broken one:
`mediaKindThumbHTML(r, cls)` (its Gallery tile) renders only an "open" click target and, for
writers, a pencil `.pp-mkeditbtn` that opens `openMediaKindEditor(row)`; that editor's own footer
had only Cancel/Save; and the batch/lightbox Delete flow for real photos
(`openDeleteConfirm`/`remove(r)`) is deliberately scoped to rows with a `progress_photos` id — a
pseudo-row (`_kind: 'panorama'|'reconstruction'`) has none there to delete. `pano.js` did carry a
full delete (`removePano`, storage + row), but it was wired only to the `#pano-view` screen's own
grid — the dedicated 360°/3D tabs Batch C folded into the Gallery and made unreachable from the
UI. `recon.js` had **no** general delete at all — only `retractRequest`, scoped to a still-
`pending_approval` request being retracted from the approval queue, a different operation.

- **`openMediaKindEditor`'s footer gains a Delete button** (`#pp-mked-del`, `pd-btn-danger`,
  gated `canWrite` exactly like Save). Clicking it closes the editor and opens a new, small
  confirm modal (`openMediaKindDeleteConfirm(row)`) mirroring `openDeleteConfirm`'s own shape —
  naming what gets cleaned up per kind (a stitched image for a panorama; a recorded video *and*
  any processed result files for a scan) and refusing anything until confirmed.
- ⚠️ **The confirm modal delegates to whichever sub-module actually owns the row**
  (`window.PANO.deleteById` for a panorama, `window.RECON.deleteById` otherwise) — never a
  second, in-file copy of the storage-cleanup-then-row-delete logic those two modules already
  have. Same "one 360° viewer, one 3D viewer" rule this file already applies to opening a pin/
  tile; it now applies to deleting one too.
- **New `pano.js` `deletePano(p)`** / **`recon.js` `deleteRequest(r)`**, both exported as
  `deleteById(row)` — same signature convention as the pre-existing `removePano(p)`/
  `retractRequest(r)`: they take the real row **object**, not an id, since `openMediaKindEditor`
  already holds the exact live reference as `row._src` (per `panoPseudoRow`/`reconPseudoRow`'s own
  comment — the merged pseudo-row's `_src` **is** the object `PANO.list()`/`RECON.doneList()`
  return, not a copy), so there's no id-lookup-and-reload needed to find it. Both:
  - clean up every Storage object the row can carry (`pano_url` for a panorama; `video_url` +
    `result_pointcloud_url` + `result_splat_url` for a reconstruction — all three, since a done
    job can have result files the still-pending `retractRequest` path never had to consider) —
    best-effort, wrapped in try/catch, matching every other storage-cleanup call in this app;
  - delete the row, splice it out of the sub-module's own in-memory array (`panoramas`/
    `requests`) so the very next `render()` — and this module's own `mergedRows()`, which reads
    `PANO.list()`/`RECON.doneList()` fresh on every call — omits it immediately, with no reload;
  - return `{ ok:true }` or `{ ok:false, error }`, **never throw** — the caller surfaces the real
    reason and re-enables its button rather than the delete silently no-oping.
- ⚠️ **The reconstruction half needed a real database-level fix too, not just a client-side one.**
  `reconstruction_requests`' own DELETE policy (2026-08-29-reconstruction-requests.sql) lets an
  **admin** delete any row at any status, but a **non-admin requester** only their own row while
  it's still `pending_approval` — deliberately, so retracting can't orphan a RunPod job that's
  already `approved`/`queued`/`processing` and genuinely billing. That reasoning has no bearing on
  a **terminal** row (`done`/`failed`): there is no live job left to orphan once RunPod has already
  finished with it, so a non-admin requester needing an admin just to remove their own completed
  (or failed) 3D scan from their own project's gallery was an oversight, not a deliberate choice.
  **`migrations/2026-09-04-reconstruction-delete-terminal.sql` (USER MUST RUN)** widens the
  requester's own-row delete to `status in ('pending_approval', 'done', 'failed')` — the admin
  branch and the active-job window (`approved`/`queued`/`processing`, still admin-only) are
  untouched. Folded into `supabase-schema.sql`; `supabase-build.sql`/`migrations/VERIFY-schema.sql`
  regenerated (`node migrations/gen-build.js` / `gen-verify.js`).
  ⚠️ **Until that migration runs**, a non-admin requester deleting their own done/failed scan is
  refused by the database — `deleteRequest`'s own `.delete().select()` correctly reads that as
  "0 rows deleted" (the same shape `retractRequest`'s M5 fix already has to guard against, not a
  Supabase error) and surfaces a real, actionable message naming the two ways out (an admin can do
  it today; running the migration lets the requester do it themselves) rather than a false
  "deleted". An **admin** can already delete any status, before and after this migration.
- Panoramas needed **no** database change — they were always covered by the generic module-table
  RLS (`is_writer()`), so any writer could already delete one at the database level; the entire
  bug there was the missing client-side affordance.

### Verified

**18 new checks, all green** (872 → 890): structural assertions for the editor's Delete button,
its wiring, `openMediaKindDeleteConfirm`'s per-kind dispatch, its missing-module/failed-delete/
success paths, and the confirm copy; plus **genuine execution** of both new functions (test-only
hooks `PANO._deletePano`/`RECON._deleteRequest`, same convention as `RECON._retractRequest`)
against the harness's mutable in-memory store — a real panorama deletes and its image is removed
from Storage; a `done` reconstruction with all three possible result/video files deletes and
cleans up every one of them; a delete matching **0** rows (simulating an RLS refusal, the same way
`retractRequest`'s own M5 test proves `.delete().select()` returning empty is read as a genuine
refusal and not a false success) reports the real reason; a missing row reports an error rather
than throwing, for both kinds. Plus structural checks that the new migration widens exactly the
intended clause, is idempotent (dropped before recreated), and is folded into
`supabase-schema.sql` with the narrower pre-fix clause gone. `node --check` clean on all three
touched JS files; 0 NUL bytes; CSS braces balanced (527/527, unchanged — no CSS touched); 0
duplicate DOM ids; a function-set diff against the prior commit shows **0 functions lost**, 3
intentional additions (`openMediaKindDeleteConfirm`, `deletePano`, `deleteRequest`).

⚠️ **Not verified signed-in** — same standing caveat as every entry in this file. No live
click-through of the Delete button against a real panorama/reconstruction, and the migration has
not been run. The genuine-execution tests above prove the client-side logic is correct against a
store with no RLS; the real RLS refusal-and-recovery path (pre-migration) and the widened
success path (post-migration) are both unverified against live Supabase.

`module.js` → `?v=20260904h`, `pano.js`/`recon.js` → `?v=20260904a` (module-local only — no shared
asset touched, so no app-wide `?v=`/`MODULE_V` bump).

## Eight-item owner feedback round: delete + presentation-usage warning, icon-only
## batch actions, additive archive filter, full-res-on-first-open fix, icon-only
## markup/adjust, key-plan toggles moved beside close, pin+cone always drawn on
## the key-plan overlay, a denser filter panel (2026-09-02)

### Item 1 — batch delete, and a warning when a photo is cited by a presentation

Single-photo delete already existed (the lightbox's Delete button); there was no
way to delete more than one at a time. A **Delete** button joins Download/Add to
Presentation/Archive in the selection toolbar, and both the single and batch
paths now go through one shared **`openDeleteConfirm(ids)`** — `remove(r)` is a
thin wrapper over it, so the two can never disagree about what gets checked or
cleaned up.

- **`findPresentationUsage(ids)`** runs two plain `.in()` reads against
  `ppr_slides` (`before_photo_id`/`after_photo_id`) rather than one `.or()`
  filter string — the ids are plain UUIDs with nothing to escape, so a second
  query is simpler than getting PostgREST's `or()` delimiters right for no
  benefit. ⚠️ **Best-effort, wrapped in try/catch** — a failed usage check must
  never block a delete the planner already confirmed.
- The confirm modal shows a `.pp-delwarn` line naming how many of the photos
  being deleted are cited by how many presentations, when any are. ⚠️ It's a
  **warning, not a block** — the FK is `on delete set null` (ppr.js), so the
  slide survives with an empty frame; the warning just makes that consequence
  visible before it happens instead of after.
- Batch delete is scoped to real photos only (same reasoning as the existing
  Download/Add to Presentation splits — a 360°/3D pseudo-row has no row in
  `progress_photos` to delete), and clears deleted ids out of `selected`.

### Item 2 — icon-only batch actions

Download/Add to Presentation/Archive were labelled text buttons
(`+ pp-tb-labeled`); all four (Delete included) are icon-only now, each
carrying its label as a `title` tooltip — matching every other icon button in
this module's topbar. New **`archive`** glyph added to the shared `icons.js`
(a box with a lid); `layers`/`download`/`trash` are reused for the other three.

### Item 3 — "Show archived" is additive, not either/or

`matchesFilters` used to require `r.archived === filters.archived` exactly, so
checking "Show archived" **swapped** the view to archived-only instead of
adding to it. Now: `if (!filters.archived && r.archived) return false;` —
unchecked hides archived (the normal, tidy view); checked shows **both**
archived and unarchived together. Scoped to the Gallery's own toggle only; the
Presentations list keeps its separate either/or "Show archived" filter
unchanged (a different screen, not part of this ask).

### Item 4 — full resolution only showed up on the SECOND open

⚠️ **Real bug, not a loading-speed illusion.** `paintLightbox()`'s async
full-res swap-in was guarded by `byId(lightboxIds[lightboxAt]) !== r` — OBJECT
IDENTITY, not id. If `rows` gets a fresh object for the same photo between
opening the lightbox and the sign request resolving (e.g. a realtime UPDATE
echo replaces `rows[j]` with a new record — see `applyRemoteChange`), the guard
wrongly read "the lightbox moved on" and silently dropped the swap — the tile
kept showing the thumbnail stand-in until the photo was **reopened**, by which
point `ensureFullUrl`'s cache already had the signed URL, so the second open
"worked". Fixed by comparing the id the lightbox is currently pointed at
(`lightboxIds[lightboxAt] !== openedId`) instead of object identity — the
correct meaning of "has the lightbox moved on to a different photo", and
robust to `rows` being replaced for the photo still being viewed.

### Item 5 — Markup/Adjust go back to icon-only in the lightbox

Reverses the 2026-08-29 "Item 12 follow-up" label. `#pp-lb-markupedit`/
`#pp-lb-adjustedit` drop their `pp-lb-tool-labeled` class and `<span>Markup</
span>`/`<span>Adjust</span>` text — icon + `title` tooltip only, matching every
other lightbox tool. The now-unused `.pp-lb-tool-labeled` CSS rule is removed
rather than left as dead weight.

### Item 6 — Key Plan / Markup toggles move to their own cluster, left of Close

A new **`.pp-lb-tools-right`** cluster (`#pp-lb-keyplan`, `#pp-lb-markuptoggle`)
sits on the right side of the lightbox, offset 62px from the edge — enough to
clear the close button (38px + 16px right + an 8px gap on desktop; 44px + 10px
+ 8px on the mobile close button size lands on the same figure, so one rule
serves both breakpoints, with only `top` overridden to match the mobile safe-
area offset). Download/Markup-edit/Adjust/Edit/Delete stay in the original
left-hand `.pp-lb-tools` cluster.

### Item 7 — the key-plan overlay always shows the pin and, when recorded, the
### camera-facing cone

⚠️ Previously the overlay was a bare `<img>` of the whole floor plan — it
answered "which floor" but never "where on it, facing which way". It's now a
small stage (`.pp-lb-kpoverlay` as a `<div>` holding an `<img>` + a pin dot +
a direction cone), positioned from the resolved pin's own `x_norm`/`y_norm` —
scaled-down copies of bim.js's own `.bim-pin`/`.bim-pincone` (that stage is
sized for the full Plans-tab view; this corner overlay is 1/8-photo-width).
- The pin colour follows `pin.item_type` (photo/panorama/reconstruction), same
  three-way palette bim.js's own marker uses.
- The cone is drawn **only** when a direction was actually recorded and the
  item isn't marked drone/top-view (`direction_na`) — a fabricated cone would
  claim a facing direction nobody captured.
- `lightboxKeyPlanVisible` still resets to `false` on every `paintLightbox()`
  call, so stepping ←/→ never carries a previous photo's overlay onto the next.

### Item 8 — filter panel: bare hint text, denser and more minimalist

- Trade/Works/each Location-Breakdown-level select's blank option and title
  dropped the "Filter by " prefix — now just "Trade" / "Works" / the level's
  own name (e.g. "Tower", "Level", "Zone"). Sitting inside the filter panel
  already implies "filter by"; repeating it on every control was noise.
- `.pp-filters` panel: padding 8px 12px → 6px 10px, gap 8px → 6px; controls
  34px/13px → 30px/12px; date fields 145px/12px → 128px/11.5px; Clear-filters
  and "Show archived" match the same reduced density (scoped to `.pp-filters
  .ppr-allloc`, since `.ppr-allloc` is also a block label elsewhere and wasn't
  redefined globally).

### Verified

**872 checks green** (was 853 before this round — 19 new, several updated in
place where they encoded the exact behaviour this round deliberately reverses
or replaces, e.g. the either/or archived filter, the labelled markup/adjust
buttons, the bare `<img>` key-plan overlay, the four vs. five selection-toolbar
ids). `node --check` clean on `module.js`/`test.js`/`icons.js`; 0 NUL bytes; CSS
braces balanced (527/527); 0 duplicate DOM ids; a function-set diff against the
prior commit shows **0 functions lost**, 2 intentional additions
(`findPresentationUsage`, `openDeleteConfirm`).

⚠️ **Not verified signed-in** — same standing caveat as every entry in this
file. In particular: the presentation-usage warning's real query against
`ppr_slides`, the delete flow's actual storage cleanup, and the id-based
lightbox guard's fix (which depends on a realtime UPDATE echo or similar
`rows`-replacement timing to reproduce the original bug) are all verified by
reading/structural checks, not by driving a live browser session.

`module.css/js` → `?v=20260902a`. `assets/js/icons.js` → `?v=20260902e`
(app-wide, 20 files — new `archive` glyph).

## Item 7 (11-item round) — 360° viewer smoothness: a real leaked `window` listener,
## and drag rendering with no requestAnimationFrame coalescing (2026-09-01)

Closes the last item of the 11-item round (items 1/2/4/6/8/9/10/11 are documented in the
entries below; item 5, immediately below this one, was done first in the same turn). Read
`mountCylinderViewer` (the single-panorama viewer's rendering/drag code) end to end before
touching anything, and found two independent, real, well-justified issues — not a vague
"make it faster" pass.

**The high-confidence one: `window.addEventListener('mouseup', onUp)` was never matched by a
`removeEventListener`.** ⚠️ **The exact same bug class this file's own earlier audit already
fixed once, in `bim.js`'s `wireStageInteractions`** (documented above: "leaked two window
listeners on every single `render()`… each closing over its own now-stale `dragging` flag,
permanently firing on every mouse move across the whole page"). Here it's the SAME failure
mode, in a different file: because a JS closure keeps its **whole enclosing scope** alive —
not just the specific variables an inner function reads — one stray `window`-level listener
kept the ENTIRE `mountCylinderViewer()` call reachable forever: the `WebGLRenderer`, its GL
context, the `THREE.Scene`, the loaded texture, all of it. Every single-panorama view leaked
one; the (confirmed dead, per this file's own earlier audit note) Compare viewer's `rebuild()`
leaks one on every A/B dropdown change, since it disposes the old viewer before remounting but
the old `dispose()` never actually cleaned up the listener it left behind. Opening/closing
several panoramas across a session accumulates real GPU/memory pressure this way — precisely
the shape of a report that reads as "gets less smooth over time" rather than "is slow from the
first click." `dispose()` now removes the listener.

**The second, independent fix: drag input was coupled directly to rendering, with no
`requestAnimationFrame` at all.** `onMove` called `renderer.render(scene, camera)`
**synchronously on every raw `mousemove`/`touchmove` event** — a browser can dispatch several
move events between two actual display refreshes (high-poll-rate mice/trackpads, in
particular), and each one triggered a full, separate WebGL render pass with no coalescing or
vsync alignment. That unsynced, bursty render pattern is a textbook cause of perceived
stutter during a drag, independent of the listener leak above. `onMove` now only updates
`lon`/`lat` and sets a `needsRender` flag (cheap, no GPU work); a `renderLoop()` driven by
`requestAnimationFrame` reads that flag and renders **at most once per animation frame**,
always with the latest orientation — so however many move events land within one frame
collapse into a single, vsync-aligned render.

- ⚠️ **The loop is self-terminating, not an always-on background loop.** It only reschedules
  itself (`if (dragging) rafId = requestAnimationFrame(renderLoop);`) while a drag is actually
  in progress — an idle, static view costs nothing once the drag ends, rather than running a
  render loop forever in the background burning CPU/battery for no visual change.
- ⚠️ **`onDown` explicitly wakes the loop** (`wake()`, guarded on `rafId == null`) rather than
  assuming it's still running — since the loop stops rescheduling itself the moment a drag
  ends, a NEW drag starting some time later needs to restart it, not just flip `dragging` and
  hope a stale loop is still ticking.
- `dispose()` also cancels any pending `rafId` via `cancelAnimationFrame`, so a viewer closed
  mid-drag can't leave a dangling animation-frame callback either.
- ⚠️ **`setOpacity`/`setTexture` (the dormant Compare viewer's discrete texture-swap) are
  deliberately LEFT as direct, immediate renders** — they fire once per discrete user action
  (an A/B dropdown change, a slider crossing its 50% threshold), never as part of a continuous
  drag, so routing them through the same rAF coalescing would add complexity for zero
  perceptible benefit on a path that already renders once per action.
- The initial mount-time render (`applyLook(); renderer.render(scene, camera);`, right before
  the function returns) is untouched — a viewer still shows something the instant it opens,
  before any drag has happened, exactly as before.

### Verified

New `test.js` section `[36c]`, 8 checks — structural assertions against the shipped source,
matching this exact function's own established verification precedent (its prior dispose-leak
fix, documented above, was likewise verified structurally rather than against a real WebGL/
THREE.js stack — genuinely driving `mountCylinderViewer` would need a much larger fake
`THREE`/`requestAnimationFrame`/canvas-2D-and-WebGL-context mock than this fix's scope
justifies). Confirms: `dispose()` removes the `mouseup` listener AND cancels the rAF request;
`onMove` no longer calls `renderer.render()` directly and only sets `needsRender`; `renderLoop`
renders at most once per frame, only when dirty; the loop's self-terminating "only while
dragging" condition; `onDown`'s explicit wake; the untouched initial render; and that
`setOpacity`/`setTexture` deliberately stayed as direct renders.

⚠️ **One pre-existing structural assertion was updated in place, not silently deleted** — the
prior entry's own check for `dispose()`'s exact shape (`dispose: function () { try {
renderer.dispose(); } catch (e) {} }`) necessarily changed, since `dispose` now does more than
one thing. Rewritten to confirm `renderer.dispose()` still runs, alongside the new cleanup —
the same "healthy churn from an intentional change" convention this file follows throughout.

**Full suite: 853 passed, 2 failed** — the same two pre-existing, unrelated failures every
other 2026-09-01 entry in this file already documents. `node --check` clean; 0 NUL bytes; a
function-set diff of `pano.js` against the last commit shows **0 functions lost**, 5 additions
total across items 5 and 7 this session (`fixInfiniteDuration`, its nested `onTimeUpdate`,
`safeErrMessage`, `renderLoop`, `wake`).

⚠️ **Not verified signed-in** — same standing caveat as this whole file, and the one that
matters most for a "smoothness" fix specifically: nobody has actually dragged a real 360°
viewer, before or after this change, in a real browser here to confirm the perceived
difference. Both fixes are correct and well-justified by reading the code (a genuine,
confirmed reference leak; a genuine, confirmed synchronous-render-per-input-event pattern with
no frame coalescing) rather than inferred from a vague performance complaint — but "it feels
smoother" is, honestly, the one claim in this whole 11-item round that can only be confirmed by
a person actually dragging the viewer on a real device.

`pano.js` → `?v=20260901d` (same version as item 5 — both landed in this file before any
intervening deploy, so one cache-bust covers both).

## Item 5 (11-item round) — 360° recording: the three reported capture failures
## ("could not build panorama", "could not read video duration", "maximum call
## stack exceeded") (2026-09-01)

⚠️ **This environment cannot execute the real pipeline to observe a genuine browser stack
trace** — `getUserMedia`/`MediaRecorder`/OpenCV.js's WASM module all need a real browser, and
this module's own standing limitation (repeated throughout this file) is that no live signed-
in session or real device is reachable here. What follows is: one bug fixed with high
confidence (it matches the reported error message word-for-word and is a well-documented
browser quirk with a well-documented fix), plus defence-in-depth at every plausible entry
point for the harder-to-pin-down stack-overflow report, verified by genuine execution of every
piece that IS pure/testable without a real browser.

**"Could not read the video duration."** — this is the LITERAL string `extractFrames()`
throws, and the fix is a textbook one: **a MediaRecorder-produced blob's container commonly
has no duration atom at all**, since the recorder is writing the file header before it knows
the final recorded length. Chrome (and others) therefore report `video.duration` as `Infinity`
or `NaN` the first time a `<video>` loads such a blob — a genuine recorded capture hits this
routinely; an uploaded pre-recorded file usually doesn't, because its container already has a
real duration atom written by whatever produced it. That asymmetry is exactly why testing with
uploads alone would never surface this.

New `fixInfiniteDuration(video)`, called before giving up: seeks the video far past its
(unknown) end (`video.currentTime = 1e101`), waits for the browser to settle on the real
duration and fire `timeupdate`, then seeks back to the start — the standard documented
workaround. ⚠️ **Times out and resolves anyway after 2s** (same discipline `seekTo()` already
uses for its own known-flaky `seeked` event) rather than hanging the whole capture forever if
a browser genuinely never fires the event; a seek that itself throws (a detached/corrupt
video) is caught and treated the same way. `extractFrames` still rejects with the same clear
message if the duration is STILL non-finite after the attempt — so the message a user sees
never changes, only whether they see it at all.

**Guarded the width/height Infinity edge case in the same function.** The old
`Math.round(w * (video.videoHeight / video.videoWidth || 0.5625))` produced `Infinity`, not the
intended 0.5625 fallback, whenever `videoWidth` was 0 but `videoHeight` wasn't (`Infinity ||
0.5625` is `Infinity`, since `Infinity` is truthy) — assigning an infinite canvas height
throws, and more importantly, a genuinely zero/garbage-dimension frame fed into OpenCV later is
a **separate, documented cause of a stack-overflow-shaped crash** (a malformed Mat can trip
OpenCV.js's own exception-formatting glue into re-entering the WASM module while it's already
unwinding). Both dimensions are now guarded explicitly rather than relying on an `||` chain
that can itself produce the failure mode it was meant to prevent.

**"Maximum call stack size exceeded" — defence-in-depth at the three most plausible entry
points, since no real crash trace was reproducible here:**
1. **`stitchFrames` now refuses to feed OpenCV a zero-dimension frame at all** — checked
   explicitly per pair before `cv.imread` ever runs (the width/height fix above should already
   prevent this from ever happening, but this is the backstop if it somehow still does).
2. **A THROW from `homographyBetween` on ONE frame pair no longer aborts the whole capture.**
   It used to propagate straight out of `stitchFrames`, surfacing as the generic "Could not
   build the panorama" for something that might only be one bad pair out of ten. It now
   degrades that pair to `stitch_quality = 'poor'` — the SAME non-fatal path a genuinely
   low-match pair already takes — and the loop continues. `prevMat`/`curMat` are still cleaned
   up via their own inner `finally` regardless of which path is taken.
3. **A new `safeErrMessage(e)` replaces the old, unguarded `e.message || e` in `processVideo`'s
   catch block.** A raw OpenCV.js/Emscripten exception is often a bare WASM exception POINTER
   (a plain number), not a JS `Error` — and per OpenCV.js's own documented issue history,
   formatting such a value badly is itself a trigger for the module's exception-to-string glue
   to re-enter the (already-unwinding) WASM module, which is exactly how an error HANDLER can
   itself throw "Maximum call stack size exceeded" — the worst possible outcome, since a
   crashing catch block leaves no toast and no clue at all. `safeErrMessage` only reads
   `.message` when it's genuinely a string, falls back to `String(e)` inside its own try, and
   degrades to a generic fallback string if even THAT throws.

### Verified

New `test.js` section `[36b]`, 16 checks: structural assertions against the real shipped
`pano.js` source for every fix above, plus **genuine execution** of both pure/testable pieces —
`fixInfiniteDuration` was driven against a hand-built fake `<video>` object (proving it resolves
with the REAL duration once the browser "settles" on one, that it seeks past 1000 then back to
0 in that order, and that it times out and resolves — never hangs — if the event never fires),
and `safeErrMessage` was run across six input shapes: a real `Error`, a raw number (the
documented OpenCV.js exception-pointer shape), a plain string, an object whose `.message`
getter itself throws, an object whose `String()` conversion itself throws, and `null` — every
one degrades to a safe string rather than propagating a second exception.

⚠️ **One real bug was found and fixed in the TEST'S OWN fake video, not in pano.js** — the
first draft fired `timeupdate` unconditionally on every `currentTime` write, including the
code's own seek-back to 0 inside `onTimeUpdate` itself. Since a real browser fires `timeupdate`
asynchronously on its own schedule (never synchronously and reentrantly on every write), that
made the FAKE call `onTimeUpdate()` a second time before `removeEventListener` had run — a
genuine infinite-recursion bug in the test harness, not the shipped code, and worth recording
since it's precisely the failure class this item is about. Fixed by only firing `timeupdate` on
the initial far-future seek (`t > 1000`), matching what the real fix actually depends on.

**Full suite: 845 passed, 2 failed** — the same two pre-existing, unrelated failures this file's
other 2026-09-01 entries already document. `node --check` clean; 0 NUL bytes; a function-set
diff of `pano.js` against the last commit shows **0 functions lost**, only the three intentional
additions (`fixInfiniteDuration`, its nested `onTimeUpdate`, `safeErrMessage`).

⚠️ **Not verified signed-in, and this is the real gap for this item specifically.** No real
recorded video has ever been run through this pipeline in a real browser since these fixes
landed — the duration fix is high-confidence (it matches the exact reported message and is a
textbook, widely-documented quirk), but the "maximum call stack exceeded" fixes are defence-in-
depth at the most plausible entry points rather than a confirmed root-cause fix, since no real
crash could be reproduced or observed here. **The first real recording is the actual test.**
Item 7 (360° viewer smoothness/performance) is separately NOT started.

`pano.js` → `?v=20260901d` (module-local; `module.css/js`/`ppr.js` stay at their existing
`?v=20260901a`, `bim.js` at `?v=20260901c`, unchanged by this entry).

## Eleven-item feedback round: 360°/3D/video folded into the normal grid, the key-plan
## button moved from the Gallery tile into the lightbox, the pin-capture stage becomes
## a real drag-and-drop widget, presentation-view polish (2026-09-01)

Owner's numbered 11-item list. Items **5** ("360° recording still fails — could not build
panorama / could not read video duration / maximum call stack exceeded") and **7** ("360
view is also not that smooth — optimize performance") are **NOT started**; every other item
is done, verified, and documented here — several of them (6, 8, 9, 10, 11) shipped a few
turns earlier in this same round without a changelog entry, which this entry now closes.
Items 1 and 2 were the very first two of the round and are already documented in this
file's other 2026-09-01 entries above/below.

### Items 6 + 8 — 360°/3D/video join the ordinary grid, and gain a "click to edit" affordance

Panoramas and reconstructions used to render in a separate `#pp-media-strip` band below
the Gallery grid, invisible to Group-by and to Filter — exactly the "should not be grouped
separately" complaint. They're now merged into the SAME `rows` array the grid already
filters/groups/selects, as normalized **pseudo-rows** (`panoPseudoRow`/`reconPseudoRow`):
a panorama or a done reconstruction is given a photo-shaped stand-in object
(`taken_at`/`location`/`location_values`/`archived`/`description`, `trades: []`/
`works_multi: []` since neither carries either) with `_kind` (`'panorama'`/`'reconstruction'`)
and `_src` (the real underlying row) attached, and an `id` prefixed `pano:`/`recon:` so it
can share `selected{}`/the lightbox array with real photo ids without ever colliding.

- ⚠️ **One filter predicate serves both families** (`matchesFilters`) rather than a second,
  parallel filter for pseudo-rows — a Trade or Works filter being SET **excludes** every
  pseudo-row (they carry neither), so "Structural Works only" genuinely narrows to
  structural photos instead of leaving an unrelated 360° tile sitting in the filtered grid;
  search additionally matches a pseudo-row's own kind label ("360° panorama"/"3D scan") so
  typing "360" or "3d" finds every capture of that kind even with a blank description.
- **Group-by now includes them for free** — since they're plain rows in the same array by
  the time `groupRows()` runs, a Month/Trade/Location grouping picks them up exactly like a
  photo, with no special-casing needed in the grouping code itself.
- **Item 8's click-to-edit**: `mediaKindThumbHTML(r, cls)` renders the tile as a real
  thumbnail (`PANO.urlOf` for a panorama; a compass/box icon placeholder otherwise) plus a
  `.pp-mkbadge` ("360°"/"3D") and — for writers only — a small pencil `.pp-mkeditbtn`.
  Clicking the tile itself (`data-act="open"`) opens the real viewer (`PANO.open`/
  `RECON.openById`, never a re-implementation); clicking the pencil specifically opens
  `openMediaKindEditor(row)`, a reduced-field modal (Location + whatever else the
  underlying record actually has — no Trade/Works/free-text description, since neither
  table stores them) reached via `byMergedId(id)`, which resolves a prefixed id back to a
  live pseudo-row before editing.
- ⚠️ **Every place that WRITES against an id has to branch on `_kind` first** — archive,
  delete, and the batch-action handlers all check `r._kind` before deciding whether to hit
  `progress_photos`, `panoramas`, or `reconstruction_requests`. `selected{}` itself stays a
  plain id→true map, indifferent to which table an id ultimately belongs to.

### Item 9 — the Presentation-editor back button

`#ppr-slide-back` (and the Templates-screen's own `#ppr-back`) now read plain **"Back"**
with the existing arrow icon, replacing "Presentations list" — the arrow already carried
the direction, and the wordier label was the one thing left unaddressed after the button
was relocated to sit beside the screen tabs on 2026-08-30.

### Item 10 — "Preview this presentation's slides" replaced by a photo-markup toggle

The header icon that opened a read-only slide preview is gone; a new toggle
(`#ppr-photomk-toggle`) takes its place, controlling a **presentation-wide** flag
(`showPhotoMarkup`, default true) that is a genuinely separate thing from the existing
per-pane `showMarkup{}` (the slide's OWN annotations, drawn on `ppr-mkcanvas-<which>`).
⚠️ **Two canvases, not one, and the distinction is the point** — `pane()` now also paints
a second canvas (`ppr-photomkcanvas-<which>`), underneath the slide-markup one, from the
underlying PHOTO's own permanent markup (`progress_photos.markup`, the same field the
Gallery lightbox's markup toggle reads) via the shared `drawMarkupOnCanvas` export — never
a second drawing implementation. Toggling `showPhotoMarkup` shows/hides that photo-markup
canvas on both panes at once; it has no effect on `showMarkup{}`, which is unchanged.
⚠️ **The export path (`slideFigureHTML`/`EXPORT_CSS`) is untouched** — this toggle is a
live viewing aid over what a downloaded HTML/PDF/PPTX already bakes in, not a new export
option.

### Item 11 — a presentation-wide key-plan toggle in the header, per-pane popups retired

Item 21's earlier per-pane `.ppr-kpicon` button (one icon per photo, each with its own
open/closed state in a `keyPlanOpenPane = {before, after}` object) is retired in favour of
a single header toggle (`#ppr-kp-toggle`), driven by one `showKeyPlan` flag —
`openPpr()` resets it to `false` whenever a presentation is opened. The header toggle is
offered only when the CURRENT slide actually has a key plan on at least one pane (never a
speculative control that does nothing), and `pane()` still gates each side's own popup
independently on whether THAT photo has a plan — so a slide with a plan on only the
"after" photo shows exactly one popup, driven by the one shared flag. The popup itself
(`.ppr-kppopup`) is pinned to the photo's own top-right corner and sized to 10% of it —
unchanged geometry from item 21, only how it's toggled changed.

### Verified (items 6/8/9/10/11)

These shipped in an earlier turn of this same session and are verified by the existing,
passing `test.js` suite (section `[44]`, 19 checks) — structural assertions against the
real shipped source (never regex-only where the logic was genuinely computable, per this
module's convention), confirming: the merged-row pipeline excludes pseudo-rows from the
Trade/Works filters, `openMediaKindEditor`/`byMergedId` resolve prefixed ids correctly, the
back-button text, the two-canvas photo-markup split reading from the photo's own
`markup` field via the shared drawing helper, the export path's non-involvement, the
single `showKeyPlan` flag replacing the retired per-pane state, and the retired
`.ppr-kpicon` CSS rule's removal. This entry documents work that had already landed —
nothing in this section was changed this turn.

### Item 4 — "no need for the key plan button" in Gallery/List; it lives in the lightbox
### instead, overlaying 1/8 of the opened photo

The Gallery tile's `.pp-pinbtn` corner icon (added in an earlier Batch E round) — and its
`openPinPreview()` Tight/Wide crop-zoom popup — are retired outright: `cardHTML(r)` no
longer computes `hasPin`/`pinType`/`pinId` or emits the button at all, `wireRows(host)` no
longer wires `[data-pinpreview]`, and the CSS for `.pp-pinbtn`/`.pp-pinpreview-box/-dot/
-cone/-zoom` is gone. The Gallery/List screens now show only the photo itself and the
select checkbox.

The key-plan control moves into the **lightbox toolbar** instead — a new `#pp-lb-keyplan`
button (styled like every other `.pp-lb-tool`, gated `style.display` per-photo, never
CSS-only) sits beside Download. `paintLightbox()` resolves whether the CURRENT item has a
pin **polymorphically**, the same way `cardHTML` used to before this change:
`kpPinType = r._kind || 'photo'`, `kpPinId = r._src ? r._src.id : r.id` — so a 360°/3D
pseudo-row opened from the merged grid (item 6/8, above) still shows its own key-plan
button correctly, not just an ordinary photo. `BIM.pinInfoFor(itemType, itemId)` decides
whether the button shows at all; it's hidden entirely for an item with no pin, never shown
disabled.

Clicking it toggles a new `lightboxKeyPlanVisible` flag and calls `paintKeyPlanOverlay(r)`,
which shows/hides a new `<img id="pp-lb-keyplan-overlay">` inside `.pp-lb-imgwrap`, styled
`.pp-lb-kpoverlay` — **top:10px/right:10px, width:12.5%** ("1/8 of the photo", literally),
`border/box-shadow/background: var(--pd-card)`, `pointer-events:none` (so it never blocks
the lightbox's own zoom/pan/markup interactions underneath it) — the exact same
corner-overlay-at-a-fraction-of-the-photo shape item 11's `.ppr-kppopup` already
established, just at 1/8 instead of 1/10 since the two asks named different sizes.

- ⚠️ **`lightboxKeyPlanVisible` resets to `false` on EVERY `paintLightbox()` call** —
  stepping ←/→ to a different photo must not carry a previous photo's overlay onto the next
  one, the same "per-photo, not global" scope the button itself has.
- ⚠️ **A missing plan warns rather than showing a broken image** — `paintKeyPlanOverlay`
  checks `info.planUrl` before setting `img.src`; if it's absent it toasts and leaves the
  overlay hidden, never assigning an empty/undefined src.
- `openPinPreview`'s crop-zoom centring math (an image at `left:50%/top:50%` translated by
  `-(x_norm*100%, y_norm*100%)` of its OWN box) is **not carried over** — the lightbox
  overlay shows the plan at a fixed corner size rather than cropped/zoomed to the pin, since
  the ask was "overlays on top of the photo… size 1/8 of the photo", not a Tight/Wide crop
  like the retired popup. The function itself is deleted, not left dormant, since its only
  caller is gone.

⚠️ **A test-writing trap caught and fixed before the suite ran**: the first-draft test
assertions used bare substring matches (`!/pp-pinbtn/.test(mjs)`) to confirm the retired
icon was fully gone — which would fail against this entry's OWN retirement comments in
`module.js`, which legitimately still say "pp-pinbtn" in prose explaining what was removed.
The exact same trap item 11's own earlier fix already had to correct once (see that
section's own note). Narrowed to real declaration/usage patterns instead
(`class="pp-pinbtn`, `data-pinpreview="`, `function openPinPreview\(`,
`querySelectorAll\('\[data-pinpreview\]'\)`), which only match actual code, never prose.

### Item 3 — the pin-capture stage: the pin itself is now draggable, a second dedicated
### handle adjusts facing direction alone, and switching camera/drone view is one click

`bim.js`'s embedded pin-capture field (used by the Add/Edit Photo form's Key Plan section —
distinct from the main Plans-screen pin renderer, which this item does not touch) had three
real gaps against the ask: the pin dot had **no drag handler at all** (only a double-click
to toggle "does not apply"); adjusting facing direction alone had **no dedicated visible
handle** (only an implicit "drag anywhere on the shaded wedge" gesture, easy to miss); and
switching between a ground-level camera view and a top-view drone shot needed a
double-click on the wedge — which doesn't exist to click on once a photo IS marked drone/
top-view, since the wedge is suppressed entirely in that state (leaving only the plain dot,
also double-click).

**The pin dot is a real drag target now.** `dot.onpointerdown` snapshots the pin's
`x/y` and both cone edges (`e1x/e1y/e2x/e2y`) at drag-start — the same "snapshot at
drag-start, never an incrementally reapplied delta" convention `module.js`'s own
`translateMarkupObj` already documents, so a fast drag can't compound its own rounding
error — and on every subsequent `pointermove` translates all three points by the SAME
pixel delta (converted to normalized image-fraction units via the stage image's own
`getBoundingClientRect()`), so the cone stays attached in exactly the same shape and
orientation as the pin moves. ⚠️ **This only works because the edges are stored as
ABSOLUTE points, not offsets relative to the pin** — translating the pin alone while
leaving the edges untouched would silently detach the cone from its own pin the moment
either was moved.

**A genuine tap toggles camera/drone view; a real drag never does.** The same
`onpointerdown` sequence tracks total pointer travel from the start point; if it never
exceeds `DOT_TAP_THRESHOLD` (6px) by `pointerup`, the gesture is treated as a tap and
flips `direction_na` (drone/top-view) — replacing the old double-click, and now reachable
in BOTH states, including the drone state where the wedge (the double-click's old target)
doesn't render at all. If the pointer DOES travel past the threshold at any point, the
gesture becomes a drag and `na` is never touched, so a deliberate move can't accidentally
also flip the camera/drone state.

**The pin renders a person or drone icon**, not a plain circle — `Icons.svg(s.na ? 'drone'
: 'person', 12)`, called directly (not via the `data-ico`/`hydrate` path, since `hydrate`'s
one-time `data-ico-done` guard would make a second toggle silently do nothing — the exact
trap this module's own Batch item-7 note already recorded for the markup-visibility
toggle). Two new icon glyphs (`person`, `drone`) added to the shared `assets/js/icons.js`.
The dot itself grew from 14px to 22px to comfortably hold a 12px icon, and is now
`pointer-events: auto` unconditionally (was `none` at rest, `auto` only under `.is-na`) —
a click precisely on the dot's small footprint is captured by it; a click anywhere else on
the image still reaches `img.onclick` and places/moves the pin the old way, since the dot
sits on top only at its own small area.

**A second, dedicated handle adjusts ONLY the facing direction.** Positioned straight
ahead of the pin at the cone's own bearing and reach (`pointAtBearing(x, y, cone.dir,
cone.reach)` — literally "in the middle of the view"), styled `.bim-dirhandle-el` (same
6px white-fill shape as the existing corner handle, but an ink-coloured border instead of
red so the two are visually distinguishable). Dragging it recomputes ONLY `direction` from
the pin to the pointer, passing `cone.halfW`/`cone.reach` straight through unchanged — the
exact inverse of the existing corner handle, which changes angle+reach together and leaves
direction alone. Both handles, and the implicit wedge-body-drag (still direction-only,
kept rather than removed — the ask was to ADD a handle, not take away a working gesture),
now coexist; `paintConeLive` updates all three live during any of the three drag types,
since a drag on any one of them can move where the other two's own display points sit.

- The hint text and the "Pin placed…" status line were rewritten to describe the new
  model (drag the pin to move it; the two handles' separate roles; click the pin once to
  switch views) — the old copy described double-clicking a "shaded area" that no longer
  applies to the actual mechanism.
- `.bim-conena-badge`'s icon changed from `eyeOff` to `drone`, and its wording from
  `Marked "does not apply" (top-view photo)` to `Drone / top-view photo — no facing
  direction recorded`, matching the new person/drone mental model rather than the old
  abstract toggle wording.

### Verified (item 3)

Extended `test.js` section `[39]` (the pie-cone geometry tests from the earlier round this
widget was built in) with 19 new checks — structural assertions against the shipped
`bim.js`/`module.css` source, plus **genuine execution** of the new geometry: `pointAtBearing`
(newly exported as `BIM._pointAtBearing`, same "exported so a flipped sign is silent
otherwise" reasoning already applied to every other cone-math helper in this file) was run
directly at bearing 0 (confirms straight "up" moves y negative, x unchanged) and bearing 90
(confirms due "east" moves x positive, y unchanged), and cross-checked that the new
direction handle's own position formula — derived from a real cone's `dir`/`reach` via
`coneParamsFromEdges`/`edgesFromCone` — lands on the exact same point `pointAtBearing`
computes independently, proving the handle sits precisely where the facing direction
actually points rather than merely looking plausible.

Five pre-existing assertions from the earlier cone round were **updated in place, not
silently deleted**, since this change intentionally supersedes what they checked: "exactly
ONE handle" → both handles now asserted; the 4px/14px handle-to-dot size ratio → the new
6px/22px figures; the wedge/handle NA-hiding check → widened to cover the new direction
handle too; and the double-click-to-toggle assertion → rewritten to confirm double-click is
GENUINELY GONE (`!/dot\.ondblclick/`) alongside new coverage for the tap-vs-drag threshold
logic that replaces it.

**Full suite: 829 passed, 2 failed** — the same two pre-existing, unrelated failures this
file's most recent entry above already documents (`pane() reads each photo's own trade/
works/location`, `.ppr-panelabel.is-current` #fff contrast); confirmed via a clean re-run
that neither newly fails nor newly passes as a result of this turn's work. `node --check`
clean on `bim.js`/`icons.js`/`module.css`(N/A, CSS)/`index.html`(N/A); 0 NUL bytes across
every touched file; CSS braces balanced (518/518); 0 duplicate DOM `id=` attributes; a
function-set diff of `bim.js` against the last real commit shows **0 functions lost**.

⚠️ **Not verified signed-in** — same standing caveat as every entry in this file. No live
click-through of the drag-the-pin gesture, the tap-vs-drag threshold at real pointer
speeds, or the person/drone icon rendering in an actual browser DOM.

`assets/js/icons.js` → `?v=20260901b` (bumped across all 20 referencing HTML files —
shared asset). `bim.js` → `?v=20260901c` (module-local; `module.css/js`/`ppr.js` stay at
their existing `?v=20260901a` from this same day's earlier turns, unchanged by this entry).
## "+ Add media" dropdown reopened permanently on every page load — the SAME `[hidden]`-vs-CSS-`display` trap as `.pp-selbar` (2026-09-02)

Found independently via a headless audit pass (mocked-Supabase Playwright harness rendering the
real, unmodified module — no live report). Screenshot at 1440×900 showed the Photo/Video/360°/3D
dropdown sitting open on top of the empty-state card the instant the page loaded, with no click.

⚠️ **Exactly the bug class this file's own 2026-08-29 entry already fixed once, for a different
element.** `#pp-addmenu` carries `hidden` in the static markup and the JS toggle (`menu.hidden =
!menu.hidden`) correctly flips the DOM attribute — confirmed by reading `wireAdd`'s click handler
before touching anything. But `.pp-addmenu { ...; display: flex; ... }` in `module.css` sat at the
**same specificity** as the browser's own `[hidden] { display: none }` user-agent rule, and an
author stylesheet rule always wins over a UA rule at equal specificity — so the attribute was being
silently overridden and the menu rendered permanently visible regardless of its `hidden` state.
Measured directly: `el.hidden === true` and `el.hasAttribute('hidden') === true`, yet
`getComputedStyle(el).display === 'flex'` with a real, non-zero on-screen rect. Fix drafted:
`.pp-addmenu[hidden] { display: none; }`, the identical shape `.pp-selbar`'s own fix used.

⚠️ **Superseded by a concurrent session, discovered while rebasing this branch onto `main`.**
`main` had already landed the identical rule (`.pp-addmenu[hidden] { display: none; }`) in commit
`97c7435` ("Progress Photos: 11-item feedback round complete"), independently of this branch — the
2026-09-02 "Owner-reported round 2 item 1" comment above this rule in `module.css` is that other
session's own writeup of the same specificity trap. So this entry records that the bug was real and
was found and diagnosed here too, not that this branch's own patch is what shipped it — the code
change itself carried no diff once rebased onto `main`, since `main` already had the fix.

⚠️ **Not verified signed in** — found and diagnosed under a mocked Supabase backend; the underlying
cause is pure CSS specificity, independent of any data, so the same fix applies identically to a
real session (and, per the above, was already live via the other session's own commit).

## Six-item owner feedback round: old-photo thumbnail backfill, tile size, tab
## labels, "Add Text" fixed + formatting, Add-media dropdown leak, back-button
## order (2026-09-01)

Six numbered items off the owner's own screenshot review.

**1 — old-photo thumbnails backfilled, not just generated on new uploads.** Photos captured before
the 2026-08-30 client-side thumbnail feature carry no `thumb_url` at all, so they've always loaded
full-resolution and always will unless something writes a real thumbnail file for them after the
fact. New **`backfillThumbnails()`**, triggered by a **"Generate thumbnails"** button in the list
bar (writer-gated, hidden entirely when nothing is missing one — `syncGenThumbsBtn()`, re-checked
on every render since a fresh upload can change the count) — fetches each such photo's original,
downscales it through the SAME `makeThumbnailBlob` the upload path uses (so an old photo and a new
one end up with byte-for-byte the same thumbnail shape/quality), uploads it, and patches
`thumb_url`. ⚠️ **The upload uses `upsert:true`, unlike the fresh-upload path's `upsert:false`** — a
retry after a partial prior attempt (thumbnail object written, row update failed) has to be able to
overwrite the same path rather than erroring on a duplicate object. A per-file failure is skipped,
not fatal to the batch, with a running "N of M" progress label.

**2 — Gallery tile size no longer jumps when markup is hidden/shown.** ⚠️ Real bug, a plain CSS
box-model trap: `.pp-mkwrap { display: inline-block }` wraps a tile's photo so the markup overlay
canvas has something to position `absolute` against — but an `inline-block` box can only derive a
shrink-to-fit width from its content's own INTRINSIC size, and `.pp-cardphoto` (the actual `<img>`
inside it) is `width: 100%`, a *percentage*. A percentage-width child gives an inline-block parent
nothing to shrink-to-fit from, so the wrapper silently fell back to the image's natural pixel size
— different for every photo, and different again the instant the wrapper was added/removed by
toggling markup visibility, which is exactly the reported symptom. Fixed to `display: block; width:
100%` — a block box already fills its grid cell regardless of what's inside it, so the tile's own
size is never a function of whether the markup wrapper exists.

**3 — the redundant "Progress Photos" label removed from the secondary top bar; tabs renamed.** The
screen already names itself via the tab strip directly below it (Gallery/Presentations/Plans), so a
second, static `<h1>` repeating the module's own name added nothing. Removed, along with the dead
`.pp-title*` CSS it left behind and a stale `setScreen()` comment that referenced the element by id.
Tab labels: **"Gallery" → "Progress Photos"**, **"Plans" → "Floor Plans"** ("Presentations"
unchanged). ⚠️ Labels only — `data-screen` values (`photos`/`ppr`/`bim`) are untouched, so nothing
that branches on the screen name needed to change.

**4 — "Add Text" fixed, plus real text/textbox formatting.** ⚠️ **Root cause, found by reading the
object-creation code rather than assumed:** a new text object stored `fill: fillOn` **unconditionally**
— and `fillOn` (the toolbar's own "Fill" checkbox) defaults to the boolean `false`, not `undefined`.
`drawMarkupObjects`' rendering was already a deliberate three-state design (`fill === false` = the
planner EXPLICITLY turned the box off; `fill` truthy = their own colour/alpha; anything else =
"nobody's touched Fill yet, so default to a readable light box") — but because every freshly-typed
text object was born with the explicit `false` rather than `undefined`, it **always** rendered with
zero background, easy to lose against a busy site photo. That reads exactly like "add text is not
working" even though the object was being created and saved correctly the whole time.
- New shared **`textBoxFillColor(o)`** is the one place that decision is made now — read by BOTH
  the live-typing overlay (`openTextEditAt`, which previously duplicated slightly different fallback
  logic and could show a colour WHILE typing that reverted to plain white the instant it committed)
  and the final canvas render, so the two can never disagree about what a given object's box looks
  like. The creation payload now only sets `fill: true` when `fillOn` is actually on — omitted
  (`undefined`) otherwise, letting the shared helper's own default apply.
- **"Format text and format textbox"**: text objects gained `bold` (default true — matches every
  text object drawn before this feature, which was hardcoded 700-weight, so nothing already saved
  changes appearance), `italic` (default false) and `boxBorder` (an optional stroke around the box,
  in the object's own colour/width — Fill colour/transparency were already covered by the existing
  shared Fill group, since `fillableType()` already includes `'text'`). Two new toggle buttons
  (Bold/Italic) + a Border checkbox sit in the text-format toolbar group, following the file's own
  "edit the selection if one exists, else set the default for the next new object" convention every
  other markup control already uses (`syncTextRow()` reflects whichever applies). The live-typing
  overlay mirrors bold/italic/border while typing, so what's being typed looks like what will render.

**5 — "+ Add media" dropdown no longer leaks across screens.** ⚠️ Real bug: `_leavePhotosScreen()`
cleared the batch-selection toolbar on leaving the Photos screen but never closed the **`#pp-addmenu`
dropdown itself** — hiding only the button that opens it, not the (`position:absolute`) menu, so a
menu left open when switching to Presentations/Plans stayed visibly open on top of the new screen.
Now force-closed (`addMenu.hidden = true`) in the same cleanup pass.

**6 — Presentations header reordered.** `renderSlides()`'s header now renders in the order Back
button → Presentation Details (date/description/slide-nav) → the action-button cluster
(Preview/Download/Sort/Archive/Edit/Delete), matching the owner's explicit ordering. The back button
(`#ppr-slide-back`) moved from the tail of the action cluster to the front of the whole header row;
`wirePresActs()` updated to match; no permission/gating logic changed.

### Verified

**776 checks green** (was 757 before this round — 19 new, all genuinely executing the shipped
`textBoxFillColor`/`drawMarkupObjects` via a fake canvas-2D recorder that tracks `font`/`fillRect`/
`strokeRect` calls, not just regex-matched): confirms a brand-new text object (no `fill` key) now
draws its background box where the pre-fix code drew none; an explicitly-off object (`fill:false`)
still correctly draws nothing; bold/italic produce the right CSS font string; `boxBorder` draws (and
its absence omits) a stroke; the live-typing overlay and the final render read the identical shared
helper; the new Bold/Italic/Border controls exist, are wired to the "selection, else default"
convention, and are styled. Plus the existing suite for items 1/2/3/5/6 re-confirmed unaffected. `node
--check` clean on all three touched JS files; 0 NUL bytes across every touched file; CSS braces
balanced (526/526); 0 duplicate DOM ids (82 unique); function-set diff against the prior commit shows
**0 functions lost**, only the intentional new additions (`textBoxFillColor`, `applyTextStyleLive`,
plus item 1's `photosNeedingThumb`/`syncGenThumbsBtn`/`updateProg`).

⚠️ **The two pre-existing, unrelated test failures from before this round are unchanged** (confirmed
via `git stash` before starting): `pane() reads each photo's own trade/works/location` and `every
#fff use sits under a documented fixed-colour selector — [".ppr-panelabel.is-current"]`. Neither is
touched by this round's six items; left as-is rather than silently "fixed" as a drive-by.

⚠️ **Not verified signed-in** — same standing caveat as every entry in this file. No live
click-through of the "Generate thumbnails" batch backfill, the Add Text overlay's real on-canvas
typing with the new formatting controls, or the reordered Presentations header, in a real browser.

`module.css/js`, `ppr.js` → `?v=20260901a`; `MODULE_V` (via `modules-grid.js?v=` in
`dashboard.html`/`modules.html`) → `20260901j`.

## Plan/Stack month steppers gain an explicit "Live" button (2026-09-01)

Owner's punch-list item #9 ("Build a Stack view like Project Schedule's vertical-stacking… with the
`‹ › play/Live` timeline scrub-bar UX, applied to Plan view too") — the Stack view and the Plan view
already existed (see the 2026-08-29/30 entries below) with month-stepping infrastructure that
matched Project Schedule's Vertical Stacking timeline in every respect **except the explicit "Live"
button**: both already used the identical `null` = latest/live, a `'YYYY-MM'` string = scrubbed
convention Project Schedule's own `_vsAsOf` established, and both already had `‹`/`›`/Play. Confirmed
Project Schedule's exact reference markup (`modules/project-schedule/index.html`'s `.ps-vs-tlbtns`,
`data-tllive`, styled `.on` when `_vsAsOf == null`, tooltip "Back to recorded progress") before
building the equivalent here.

- **Plan view**: `.pp-planmonthbar` gains a `pp-plan-mlive` button after Play, styled `is-live`
  (a solid brand-red fill, matching `.pp-tab.active`) exactly when `planMonth == null`. Clicking it
  stops the running month-play timer first (never leaves it ticking toward a month that no longer
  matters, the same discipline `mnext`/`floorplay`'s mutual-exclusion already follows), snaps
  `planMonth` back to `null`, and re-renders. A click while already live is a genuine no-op — it
  neither stops a timer nor forces a redundant render.
- **Stack view**: the identical button (`pp-stack-mlive`) in the step-mode stepper only — wired
  inside the same `if (stackStepMode) { ... }` block as `mprev`/`mnext`/`mplay`, since combine mode
  (the default; step-through is the opt-in checkbox) has no month cutoff to jump back to. Same
  guard/stop-timer/snap-to-null/no-op-if-already-live shape as Plan view.
- ⚠️ **Deliberately NOT added anywhere else that reads `null`-is-live** — `renderStackView`'s combine
  mode, `renderPlanView`'s floor stepper, and Project Schedule's own timeline all keep whatever "Live"
  affordance (or lack of one) they already had; this only closes the one gap the punch-list named.
- New shared `.pp-livebtn`/`.pp-livebtn.is-live` CSS. ⚠️ `is-live`'s `#fff`-on-`var(--pd-red)` pairing
  joins this file's own documented dark-mode `#fff` allow-list on the exact same basis as
  `.pp-tab.active`/`.pd-btn-primary` — a solid brand-red fill with white text, always legible
  regardless of theme, not a light surface needing a dark override.

**Verified: 612/612 checks green** (was 607 — 5 new for this item), via `test.js`'s own established
convention for this class of DOM-rendering function: structural regex assertions against the shipped
`mjs`/`cssFile` source (genuine EXECUTION of `renderPlanView`/`wirePlanView`/`renderStackView`/
`wireStackView` isn't practical without driving the module's full `init()`/auth/project-load chain,
which is why the 2026-08-30 entry below verified the SAME two functions' Map/Stack relocation
structurally too — not a lower bar invented for this item). Confirmed: the button renders in the
right bar with the right conditional class, in the right position (after Play, same cluster as
prev/next); the click handler stops the timer, snaps to `null`, no-ops if already live; the Stack
wiring lives inside the step-mode-only guard so combine mode never wires a stepper it doesn't render;
each new id is referenced exactly 3 times (rendered once, wired via the same `$(id)` guard +
`$(id).onclick` shape every sibling stepper button already uses — never a stray 4th reference); the
CSS rule exists and is on the `#fff` allow-list.

⚠️ **Two PRE-EXISTING test failures found and fixed while running the suite, both from an earlier
(already-shipped, unrelated) fix in this same punch-list — not caused by this change.** Punch-list
item #7 ("remove duplicate tab-name label — Gallery / Gallery") had made `index.html`'s `<h1>` a
STATIC "Progress Photos" and removed `setScreen()`'s per-screen title overwrite (the tab strip right
below it already names Gallery/Presentations/Plans), but the two `test.js` assertions asserting the
OLD dynamic-title strings (`isPpr ? 'Presentations'`, `isBim ? 'Plans' : 'Gallery'`) were never
updated to match — healthy churn from an intentional change, the same convention this file's own
2026-08-29 rename entries already establish for exactly this situation. Rewritten to assert the
current, correct behaviour instead of the retired one.

⚠️ **Not verified signed in** — same standing caveat as the rest of this module; no live click-through
of the button's real click/render cycle in a browser, only structural source verification.

## 3D reconstruction CANCELLED — both Edge Functions undeployed, code shelved intact (2026-09-01)

Owner: *"Let's cancel the runpod feature since it requires a subscription."* RunPod's GPU service is
paid, and the feature cannot work without it, so the chain is abandoned rather than left waiting on
an account that will not be opened.

**Undeployed** `submit-reconstruction` and `reconstruction-webhook` (deployed only hours earlier).
The project is back to its original five functions; both URLs return **404**. ⚠️ The webhook in
particular was deployed `--no-verify-jwt`, i.e. publicly invokable by design — leaving an
unauthenticated endpoint up for a feature nobody will ever finish is a worse default than removing
it, which is why this happened before asking how deep to go on the rest.

**Nothing to revoke, nothing to cancel.** `RUNPOD_API_KEY` / `RUNPOD_ENDPOINT_ID` were never set
(confirmed against `secrets list`), and no RunPod account was ever created — so there is no
subscription, no billing relationship and no live credential anywhere from this feature.

**Owner chose to SHELVE the code, not strip it** (asked explicitly, three options offered):
- `recon.js` (422 lines), the `#pp-screen-recon` screen, the `RECON` global and the
  `item_type === 'reconstruction'` branches in `module.js`/`bim.js` all stay.
- The 3D button stays `disabled title="3D reconstruction is on hold"` — already the case since
  2026-08-29, so **no user-visible change**; nobody could reach this feature today anyway.
- `reconstruction_requests` stays (empty). `services/reconstruction-worker/` and both Edge Function
  sources stay in the repo.
- ⚠️ **The reasoning, which matters more than the choice:** the reconstruction branches are
  *interleaved* with live panorama and photo paths — pin dispatch, the media-strip merge, cluster
  badge fallbacks — so ripping them out is real surgery on a module that has just been through seven
  feedback rounds, in exchange for deleting code that costs nothing to leave inert. Reviving it later
  is one `functions deploy`.

⚠️ **Known cosmetic staleness, deliberately not fixed:** the disabled button's tooltip still says
"on hold", which now understates it — the honest word is "cancelled". Left alone because the owner
chose no code change; a one-line tooltip edit is available on request.


## Reconstruction prerequisites: the migration and both Edge Functions are now done (2026-09-01)

Updates the standing "NOT verified, and this is the real gap" caveat on the 3D-reconstruction entry
below. Of the three prerequisites named there:

- **(a) a RunPod account + deployed serverless endpoint — STILL OPEN.** Owner-only; nothing here
  changes it. `services/reconstruction-worker/` remains written-but-never-built.
- **(b) the two Edge Functions deployed — DONE, then UNDEPLOYED the same day.**
  ⚠️ **Superseded — see the cancellation entry above.** Both functions were deleted from the
  project hours later when the feature was cancelled; the paragraph below describes a state that
  no longer holds and is kept only as the record of what was verified while they were live.
  Original note: `submit-reconstruction` (JWT check on) and
  `reconstruction-webhook` (`--no-verify-jwt`, the deliberate exception) are both ACTIVE at version 1
  on `bgupuqnkqhixpuctyder`. Live probes: the webhook answers its own 400 with no JWT, proving the
  flag took effect; submit answers 401 at the platform gate, proving its check is on.
  ⚠️ `RUNPOD_API_KEY` / `RUNPOD_ENDPOINT_ID` are **not set**, so submit fails pre-flight with a clean
  500 rather than reaching anyone's money.
- **(c) the migration run — DONE.** `2026-08-29-reconstruction-requests.sql` applied 2026-09-01 and
  confirmed by `VERIFY-schema.sql` returning no rows against its regenerated 342-object list.

⚠️ **The end-to-end chain is still unexercised.** insert→approve→RunPod→webhook→viewer has never run,
the webhook's token-comparison branch has never executed (a probe with a nonexistent id returns 404
on the row lookup, which sits before the token check), and the 3D tab still correctly shows an empty
approval queue. The first real Approve click remains the actual integration test.


## Seventh feedback round: 11 items — Plan-view clustering/thumbnails, the stale "3 of 3" count, Stack view's look, and a Presentation-pane rework (2026-08-30)

Owner sent this batch mid-session, with 4 screenshots, while the sixth-round batch above was still
being verified — a Photos-map reference image (iOS Photos' pin-clustering style, illustrating the
*visual language* wanted for items 1/2, not a bug report about this app), and three screenshots of
this app's own Plan view, Presentations list, and an open slide.

### Items 1/2 — Plan-view pins: real distance clustering + a photo-thumbnail marker

`planClusters()` was a grid-snap (round each pin to the nearest 0.05-cell) — two pins a hair's width
apart could land in different cells if they straddled a boundary, never combining. Rewritten as a
genuine greedy single-pass clustering: each pin (processed in a stable id-sorted order for
determinism) joins the first existing cluster whose **current, recomputed centroid** is within
`PLAN_CELL` (0.05, unchanged) of it, else starts a new cluster — matching the reference screenshot's
"0.05 apart combine into one pin" ask literally, by distance rather than by a fixed cell.

**A cluster marker now shows the latest photo in it**, iOS-Photos-style, with the item count as a
small corner badge (`.pp-plancluster-photo`/`.pp-plancluster-badge`) — falling back to the old plain
number badge when the cluster's most recent item has no photo thumbnail (a panorama or a 3D
reconstruction, neither of which has a `thumb_url`).

### Item 3 — the Floor row and the Month row now read as ONE toolbar

They were built two different ways: Floor was a labelled `<select>` (`Floor [Ground Floor ▾]`),
Month was a bare `‹ value ›` stepper with no label at all, and only Month carried a long trailing
hint. Both are now the same shape — a plain-text label ("Floor" / "Month"), then the stepper/control
cluster, then one short trailing hint each (the pinned-item count moved to the Floor row, since it's
about the floor being shown, not the month).

### Item 4 — the top "Showing N of M photos" bar disagreed with Plan/Stack's own counts

⚠️ **Real bug, confirmed by reading the code, not just believed from the screenshot.** `render()`
set `#pp-count`'s text from the Gallery's own filtered `list`/`rows` **unconditionally**, before
ever checking which view was active — so in Plan view it showed the Gallery's whole-project count
while the Plan toolbar, right below it, correctly showed its own floor/date-narrowed "N pinned
items". Two different, correctly-computed numbers on screen at once is exactly what the screenshot
shows ("3 of 3" above, "2 pinned items" below). The user's own note that Stack view "still says 3 of
3" is the same bug — Stack has no top-level count of its own to disagree with, so the stale Gallery
count sitting above it was simply wrong. Fixed by blanking `#pp-count` whenever `view === 'plan' ||
view === 'stack'`, rather than trying to keep two separately-computed counts in sync — a second
mechanism that agrees with the first *today* is exactly how this bug happened in the first place.

### Item 5 — the Stack view restyled toward Project Schedule's Vertical Stacking

Two changes, both scoped to what a plain HTML table can reasonably carry, not a full port of that
module's SVG-based bands/scrub-magnifier system (a much larger rebuild than this batch's other ten
items justify):
- **Rows now order top-floor-first** (`stackRowSort`) — the previous plain alphabetical sort put
  "1st Floor" above "9th Floor" (string comparison, not numeric), the opposite of a real building
  read top-down. Rows are now sorted by whatever integer a level's own name embeds, **descending**
  (highest floor first), falling back to reverse-alphabetical for a level with no number in it at
  all (a named zone/tower rather than a storey) so it degrades sensibly instead of throwing.
- **Visual language borrowed from Project Schedule's stacking bands**: each row is now a taller band
  (52px → 64px) with a **red-railed** row header (`border-left:3px solid var(--pd-red)`) and
  alternating row tint — reading as stacked floor slices rather than a spreadsheet grid.
- ⚠️ **Not built**: the docked hover-magnifier is Stack view's *existing* one (a plain `<img>` swap
  into a fixed panel, already present); no per-tower SVG cloning, no scrub-by-drag timeline beyond
  the month stepper Stack already had. A genuine like-for-like port of the schedule module's stacking
  view is a separate, materially larger piece of work.

### Item 6 — the "Full-size preview" button removed from the opened presentation

It duplicated the pane already on screen (you're already viewing the slide full-size while editing
it). ⚠️ **The list screen's own separate "Preview" row action (`openPreviewModal`) is untouched** —
that one opens a presentation's slides *without* entering the editor at all, a genuinely different,
still-useful feature the owner didn't ask to remove.

### Item 7 — "Presentations list" back button relocated

It lived deep inside the action-tool cluster (`.pp-topbar-tools`), where it ended up as the one
visible button beside the always-present offline-sync pill (`#pp-sync`, "N pending — Sync now") the
moment every other list-only tool hid itself on the slides screen — reading as one more competing
action button parked next to a status pill, exactly the "quite off" the screenshot shows. Moved to
sit beside the screen tabs (Gallery/Presentations/Plans) instead, since it *is* screen-level
navigation ("you're inside one presentation, step back up to the list"), and restyled as a quiet
breadcrumb link (`.pp-crumbback` — no border at rest, muted text) rather than a bordered `.pd-btn`,
so it reads as navigation rather than another action even where it does end up near the sync pill on
a narrow layout.

### Item 8 — the reorder-slides pop-up shows Location AND the current photo's Works

Location was already added in an earlier round; the current (after) photo's **Works** value is now
shown above it in each thumbnail card (`.ppr-sortworks`) — the thing a reorder decision usually turns
on ("which stage of work comes first"), which the thumbnail alone can't convey.

### Items 9/10/11 — the Presentation pane: a real card, always-shown Location, labelled fields, no tags line

- **Item 9 ("looks very plain")**: each pane (`.ppr-pane`) is now a real card — surface, border,
  radius, a subtle shadow — instead of an image floating directly on the page background. The
  Previous/Current label became a small pill chip: Current filled brand-red (it's the stage being
  reported on), Previous outlined and quieter — so the two panes read as distinct at a glance, not
  only by left/right position. The shared-location banner above the pair got the same pill treatment.
- **Item 10 ("location... must be shown")**: ⚠️ **Location previously vanished silently whenever a
  photo had none set at all** — `loc ? '<div>...' : ''` rendered nothing, unlike Date/Description,
  which already always render with an em-dash fallback. Location now always renders too (labelled,
  em-dash when unset) — it only ever disappears when the SHARED-location tile above the pair has
  already said it once for both photos. The key-plan icon was already top-right-of-the-photo
  (confirmed against the shipped CSS, `.ppr-kpicon { position:absolute; top:8px; right:8px }`) — no
  change needed there, it already matched the ask.
- **Item 11 (labels + no activity-list caption)**: Date and Description now carry explicit small
  uppercase labels (`.ppr-panehead-lbl`) — both were bare values before, with nothing distinguishing
  which line was which. The Trade/Works tags line under the caption is **removed entirely** — "no
  need to include as caption all the activities performed or assigned to the photo" — the caption is
  now Location, Date and Description only. The now-orphaned `.ppr-panetags` CSS rules were deleted
  rather than left as dead weight.
- ⚠️ **Mirrored into the export path too** (`slideFigureHTML`, shared by the offline HTML/PDF/PPTX
  downloads and the in-app preview modal) — dropping the tags line and adding the label/always-shown-
  location rule only in the live editor would have left a downloaded file showing a caption the
  on-screen view no longer does. The dead `.t`/tags rule in `EXPORT_CSS` was replaced with a `.loc`
  rule for the new Location line.

### Verified

⚠️ **This round could NOT be verified by executing the test suite — no `node` binary was reachable
in this session** (checked via `where node`, a filesystem search, and a direct invocation; none
resolved), unlike every prior round in this file, all of which ran `test.js`'s Node `vm` harness.
What WAS done instead, and what remains unproven:
- **0 NUL bytes** and **CSS braces balanced (518/518)** across `module.css`, `module.js`, `ppr.js`,
  `index.html` (byte-level Python checks, not a shell `grep` pattern).
- **0 duplicate DOM `id=` attributes** in `index.html` after the `ppr-back` relocation.
- Every edited region was re-read in full after editing and confirmed structurally well-formed
  (matching quotes/parens/string concatenation, no dangling operators) — a manual review, not a
  parser.
- A rough paren-count check on `ppr.js` shows a pre-existing 1-paren imbalance that **already existed
  at the last commit, before this round's edits** (confirmed via `git show HEAD`) — almost certainly
  a decorative parenthesis inside a comment/string rather than a real syntax defect, given the file
  loads and every edited region reads correctly, but flagged rather than silently waved off, since it
  could not be confirmed with a real parser this round.
- **`test.js` was NOT extended or re-run this round** — a real gap against this module's own
  established practice. The next session with a working `node` should run the existing 734-check
  suite unmodified first (to confirm nothing broke) and then add genuinely-executed coverage for
  `stackRowSort` (numeric-descending + the no-number fallback) and the rewritten `planClusters`
  (the id-sorted, recomputed-centroid distance join, replacing the old grid-snap tests).
- Test-only hooks (`_stackRowSort`, `_planClusterLatestThumb`) were added to `module.js`'s exported
  object anyway, in the same shape as every existing hook, so that follow-up work is a call away
  rather than a rewrite.

⚠️ **Not verified signed-in** — same standing caveat as every entry in this file. In particular: the
real click-through of the relocated back button at a narrow viewport, the Plan-view thumbnail
clustering against real pin data, and the Presentation pane's new card styling against a real render
are all unverified beyond the structural checks above.

`module.css/js`, `ppr.js` → `?v=20260830f`. (`bim.js` untouched this round, stays `?v=20260830e`.)

## Sixth feedback round: 9 items — Add-media type-switch bug + dropdown, markup grouping/redo/reorder/resize/rotate/text, markup-by-default, the pie-shaped camera cone, smaller thumbnails (2026-08-30)

Owner sent 9 items in one message, the largest single batch in this module's history — 6 of the 9
concentrate on the markup editor.

### Item 1 — Add Media type-switch bug + a dropdown trigger

⚠️ **Real bug, confirmed by reading the code, not just believed from the report.**
`wireMediaTypeSelector`'s `onChange` callback only relabelled the file-field's `<label>` text — it
never touched `#pp-stagedgrid`, `stagedUrls`, `pendingMarkup`/`pendingAdjust`, or the `#pp-files`
input itself, and a `<input type=file>`'s already-chosen `FileList` can't be reassigned by script
anyway. So switching Photo→Video after staging a photo left the wrong-kind file sitting there with
no way for the code to notice. Every type change now clears the whole staged batch (revokes object
URLs, drops pending markup/adjustments, resets the input, empties the grid).

**"+ Add media" is now a dropdown** — Photo / Video / 360° / 3D (disabled) — matching the owner's
suggestion. `wireMediaTypeSelector(idPrefix, initial, onChange)` gained an `initial` parameter so
picking Photo/Video from the dropdown opens the upload modal pre-set to that type; 360° hands off
straight to `PANO.openCapture()`, the same behaviour the modal's own in-place 360° button already
had. New `video` icon added to the shared `icons.js` (bumped app-wide, 19 files).

### Items 2/3/4 — the markup toolbar: grouped controls, Redo, reordered icons

- **Item 2**: Line (colour + weight) and Fill (colour + transparency) are now two visually SEPARATE
  labelled boxes (`.pp-mk-group-line`/`.pp-mk-group-fill`, each with a small uppercase caption) —
  previously two same-shaped swatch rows sat directly adjacent with nothing distinguishing them.
- **Item 3**: a Redo button beside Undo. ⚠️ The `undone` stack already existed (populated by Undo)
  but nothing ever read it back — Redo just pops it onto `history` and restores from there, the
  exact mirror of what Undo does.
- **Item 4**: `TOOL_ORDER` reordered to the owner's explicit list — select, pen, highlighter, line,
  arrow, rect, circle, polygon, ruler, text, sticker(icon), eraser — and **signature removed** as a
  pickable tool. ⚠️ `drawMarkupObjects` still knows how to RENDER an existing signature-type object
  (backward compatibility for markup saved before this round); only the ability to create a new one
  is gone.

### Item 5 — real on-canvas text entry, editable size, fillable background box

`prompt('Text:')` is gone. Clicking with the Text tool creates a blank text object and immediately
opens a real, positioned `contenteditable` overlay (`#pp-mk-textedit`) directly over the canvas at
the click point — typing goes straight into it, Enter (no shift) or blur commits, Escape discards.
Double-clicking an existing text object (Select tool) reopens it for direct editing with its current
text pre-selected. Text objects gained `fontSize` (a new size slider, shown only for text) and joined
`fillableType()` alongside rect/circle/polygon, so its background box's colour and transparency are
now editable through the same Fill group everything else uses — replacing the old fixed, un-turnable-
off `rgba(255,255,255,.85)` box. ⚠️ A commit with empty text REMOVES the object (matches `prompt()`'s
old "cancelled if blank" behaviour, whether the object is brand new or was just emptied out).

### Item 6 — resize and rotate

Every markup object gained a `rotation` field (degrees, default 0), applied as a canvas transform
around the object's own bounding-box centre — never baked into the stored coordinates, so the
resize math stays simple regardless of rotation. Selecting an object now shows real, draggable corner
handles (resize) and a rotate handle above the box, not just decorative dots.
- **Resize** (`resizeBoxObj`): dragging a corner moves that corner to the new local position while
  the OPPOSITE corner stays fixed — the standard anchor-corner resize. Text/icon have no box to
  stretch, so `resizeSizeObj` scales their `fontSize`/`size` instead, based on distance from the
  object's own point.
- **Rotate** (`rotationFromPointer`): dragging the rotate handle sets rotation from the bearing to
  the pointer, calibrated so the handle's own drawn position (straight up) is 0°.
- **Hit-testing is now rotation-aware** (`markupToLocal`) — a rotated object's clickable region
  rotates WITH it, not with its stored (unrotated) coordinates. ⚠️ **Genuinely proven, not assumed**:
  a 90°-rotated wide-short rect's hit region was confirmed, by running the shipped code, to correctly
  MISS a point inside its stored box and HIT a point outside it once rotated — the exact case a
  naive "rotate the object, forget the hit-test" implementation would get backwards.
- ⚠️ **DOM updates during a drag are in-place attribute writes, never a re-render** — replacing the
  canvas/DOM mid-gesture would drop whatever pointer capture the drag itself just set up.

### Item 7 — markup shows by default everywhere, one shared toggle

Previously markup only ever rendered in the lightbox ("hidden on Gallery tiles by contract"). Now
`thumb()` wraps any tile whose photo actually has markup in a positioned overlay canvas
(`.pp-mkwrap`/`.pp-thumbmk`), drawn via the same `drawMarkupObjects` the editor uses, sized to the
tile's own real rendered box. ⚠️ **Cost-gated**: only rows with `r.markup.length` get the wrapper at
all — the overwhelming majority of tiles pay nothing extra, same discipline as the adjustments CSS
filter. **One shared, persisted preference** (`markupGlobalVisible()`, per project) drives List,
Gallery AND the lightbox — the lightbox's own toggle button now WRITES this shared flag (and
re-renders the grid) instead of being a private per-session switch, and opening a photo seeds
`lightboxMarkupVisible` FROM it instead of always defaulting to `true`. A new listbar button
(`#pp-mkvistoggle`) gives a way to hide/show it without opening a photo first.
- ⚠️ **Real bug caught before shipping**: `Icons.hydrate()` sets a one-time `dataset.icoDone` guard
  and refuses to touch an element twice — re-hydrating the toggle button's icon after the FIRST
  flip would have silently done nothing on every flip after that. Fixed by re-rendering the icon's
  SVG directly (`Icons.svg(...)`) instead of calling `hydrate()` again.
- ⚠️ **Scope**: List + Gallery + Lightbox only. Stack view keeps its own inline `<img>` rendering,
  not `thumb()` — deferred given this round's size, flagged rather than silently left inconsistent.

### Item 8 — the camera-angle cone: a real pie, one handle, gradient, hidden when N/A

Replaces the straight-edged 2-handle triangle. `edge1_x/y`/`edge2_x/y` stay the persisted DB shape
(no migration) — only how they're derived and manipulated changes:
- **Shape**: a true SVG `<path>` with an ARC command (pin → edge1 → arc → edge2 → close), not a
  3-point polygon. Fill is a radial gradient (`<radialGradient>` centred on the pin) — solid dark
  near the pin, fading to nothing at the arc — with **no stroke at all**.
- **One handle, sized 1/4 of the 14px pin dot (4px, was 16px)**, sitting at the sector's own
  clockwise edge. Two DIFFERENT gestures now drive the cone, since one 2D point can't cleanly carry
  three degrees of freedom: **dragging the SECTOR BODY** rotates only the facing direction
  (half-width/reach untouched); **dragging the ONE handle** changes half-width (angle) and reach
  (depth) TOGETHER — the literal "one button to adjust both" ask.
- ⚠️ **Double-clicking to mark "does not apply" now hides the wedge and its handle ENTIRELY** — the
  previous grey-dashed placeholder is gone; the pin dot itself (dimmed, `pointer-events:auto` only
  in this state) is the sole remaining thing to double-click back on. ⚠️ **Real bug caught before
  shipping**: `.bim-pinstage-dot` is `pointer-events:none` by default (deliberately, so a click near
  the pin passes through to the image and moves it) — without an `.is-na` override, the dot's own
  double-click handler would have been unreachable in exactly the one state that needs it.
- ⚠️ **Live drag updates are in-place SVG attribute writes** (`setAttribute('d', …)`,
  `setAttribute('cx'/'cy'/'r', …)`), never innerHTML replacement — same pointer-capture reasoning as
  item 6's resize/rotate.
- ⚠️ **A math property proven, not assumed**: `coneParamsFromEdges` (the inverse of `edgesFromCone`)
  resolves a cone straddling the 0°/360° seam (e.g. spanning 355°→15°) to the correct SHORT 10°
  half-width — a naive `b2-b1` subtraction would silently produce the ~350°-wide "long way round".

### Item 9 — smaller thumbnails, again

"Still slow" even after real client-generated thumbnails shipped last round. `THUMB_MAXW`/
`THUMB_JPEG_Q` (the client-generated thumbnail) and `THUMB_OPTS.transform.width`/`.quality` (the
Storage-transform fallback) both shrunk 480→320px / quality 0.6→0.5 / 0.55→0.5. Sized for the new
3-column phone Gallery grid (~125px/tile) rather than the old single-column layout these were
originally tuned for. ⚠️ Kept as two independent constants (as before) — no shared-constant
cross-reference, since `THUMB_OPTS` is defined earlier in the file than `THUMB_MAXW` and referencing
one from the other would read `undefined` at that point in the file's execution order.

### Verified

**734 checks, all green** — 684 → 734 (39 new genuinely-executed geometry/behaviour checks + a
handful of pre-existing structural assertions updated in place for shape changes this round made
deliberately, e.g. the TOOL_ORDER count/order, the `wireMediaTypeSelector` signature). Several
findings came from EXECUTING the real code, not from reading it:
- The rotate-handle hit-test's exact screen position, the resize anchor-corner invariant (dragging
  one corner must never move the opposite one), and the rotated-hit-test boundary were all confirmed
  by running the shipped functions against hand-built fixtures — one of my OWN first-draft test
  coordinates was wrong (computed by hand against the 6px hit-pad without accounting for it) and was
  corrected by empirically probing the actual shipped code rather than re-deriving by hand a second
  time. The cone's seam-straddling case (355°→15°) and its edges↔params round-trip were checked the
  same way.
- `node --check` clean on every touched JS file; 0 NUL bytes; CSS braces balanced (511/511); 0
  duplicate DOM ids. Function-set diff against the prior commit: 0 lost.

⚠️ **Not verified signed-in** — same standing caveat as every entry in this file. In particular: the
real drag-to-resize/rotate pointer gestures, the on-canvas text overlay's actual positioning against
a real rendered image, and the cone's two-gesture interaction (body-drag vs. handle-drag) are
verified by genuine execution of the underlying math/DOM-update functions, not by driving a live
browser session.

`module.css/js`/`bim.js` → `?v=20260830e`; `assets/js/icons.js` → `?v=20260830c` (app-wide, 19 files).

## Fifth feedback round: the REAL topbar-button root cause found live, and iOS-Photos-style phone tiles (2026-08-30)

Owner sent a phone screenshot: *"1. when first opening the progress photos app, the buttons for
the gallery tab are still not right. 2. loading of photos preview is also quite slow. photo
previews in the gallery view can be smaller. in a phone view, copy size of ios photo gallery"*.
Item 1 is the SAME defect the fourth-round entry below reported as "no code-level cause found" —
that conclusion was wrong, and this time it was chased down live in a real browser instead of by
static tracing.

### ⚠️ THE REAL ROOT CAUSE — `render()` hardcoded `syncTools(true)` in BOTH ppr.js and bim.js

Reproduced live on the deployed site (Chrome, real session): `getComputedStyle` on `#ppr-new` and
`#bim-new` while sitting on the **Gallery** screen showed **`display: flex`** on both — all three
topbar buttons ("+ Add media", "+ New Presentation", "+ Upload floor plan") visible at once,
exactly the screenshot. No console error at all — nothing threw.

Isolated the cause by calling `PPR._syncTools(false)` directly in the live page: it correctly hid
both buttons with **zero errors**, proving `syncTools` itself was never the bug — the fourth
round's `safeInit`/`safeSync` hardening had been solving a problem that didn't exist, while the
real one hid in plain sight one call deeper. Fetching the live `ppr.js`/`bim.js` source and
grepping every `syncTools(` call site found it: **`render()` in both files calls
`syncTools(true)` unconditionally**, on *every* re-render — including the one triggered by their
own **async `load()` completing**, which runs well after `index.html`'s `setScreen()` has already
correctly called `PPR._syncTools(false)` / `BIM._syncTools(false)` because the active screen is
Gallery, not Presentations/Plans. The async re-render silently threw that decision away and
re-showed the button. Every other `syncTools(...)` call site in `ppr.js` already replays a cached
`toolsVisible` (`syncTools(toolsVisible)`, e.g. the checkbox-select handlers) — `render()` was the
one place that didn't, and `bim.js` had no such cache at all.

- Fixed identically in both files: `render()` now calls `syncTools(toolsVisible)`. `bim.js` gained
  the `toolsVisible` module variable it never had (ppr.js already had one).
- ⚠️ **Why the fourth round's `safeInit`/`safeSync` hardening never caught this**: nothing throws
  here — it's a plain logic error, and a try/catch around a call that succeeds catches nothing.
  That hardening is still worth keeping (a genuinely different module could still misbehave and
  strand another's button), but it was never going to fix this class of bug on its own.
- ⚠️ **Verification trap, found and fixed in the course of proving this**: the harness's `canWrite`
  defaults to `false` (no `init()`/session is exercised), and every real button `syncTools` touches
  is *also* gated on `canWrite` — so with `canWrite` false, `syncTools(true)` (the bug) and
  `syncTools(toolsVisible)` (the fix) are **indistinguishable**: both compute to `'none'` regardless.
  A first draft of the genuine-execution test therefore passed against the **buggy** code too,
  proving nothing — confirmed by actually reverting both files and re-running. New test-only
  `_setCanWrite(v)` hooks (both files) make the two states differ, so the test can tell them apart.
- ⚠️ **A second trap while re-verifying against the reverted code**: a throwaway Python revert
  script wrote the file back out in Python's default Windows text mode, which silently converts
  every `\n` to `\r\n` on write — inflating the whole file and breaking six *unrelated* pre-existing
  regex assertions that match a literal `\n` (e.g. `hydrate\(\);\n  \}`), producing a wall of
  spurious failures that had nothing to do with the change being tested. Diagnosed by diffing with
  `--strip-trailing-cr` (showed only the one intended line differed) and confirming determinism.
  **For any future revert-and-re-test cycle on this repo: use `sed -i` or the Edit/Write tools, never
  raw Python `open(...).write()`, on Windows** — it silently corrupts line endings.
- **Verified: 6 new checks genuinely executing the real code** (`PPR._render()`/`BIM._render()`,
  new test-only hooks alongside `_setCanWrite`) — confirmed by reverting to `syncTools(true)` and
  re-running: **both execution assertions fail against the pre-fix code, both pass against the
  fix**, isolated from the `canWrite` masking trap above. Plus 2 source-level regex regression
  guards. Function-set diff against `main`: **0 lost, 0 named-function additions** (the two new
  hooks are anonymous export-object properties, the same under-counting this file's own convention
  already notes elsewhere). 0 NUL bytes; both files parse.

### Item 2 (phone tiles) — Gallery view now matches iOS Photos' own dense small-square grid

The phone `@media (max-width: 700px)` block previously collapsed `.pp-gallery` to **one full-width
column** (`grid-template-columns: 1fr`) — the opposite of what was asked, and also the reason
"loading is slow" read as worse than it is: every tile filled the whole screen, so scrolling past
a handful felt like a lot of loading for not much scanned.
- **Three columns, a 2px hairline gap, square-cropped tiles** (`aspect-ratio: 1` on `.pp-cardphoto`/
  `.pp-vidthumb`/the no-image placeholder, replacing the desktop's fixed 210px rectangle) — the
  recognisable iOS Photos shape. Only inside the phone media query; desktop's 290px-minmax card
  grid is untouched.
- ⚠️ **Card chrome (border/border-radius/background) drops to nothing at rest on phone**, so tiles
  sit edge-to-edge the way the real app's do — the existing `.pp-card.pp-selrow` red-border
  selection rule still works unmodified, it simply has nothing to override at rest any more (a
  2px border is added only when a tile is actually selected).
- The corner overlays (`.pp-cardsel`'s select checkbox, `.pp-pinbtn`'s key-plan badge) shrink to
  match — sized for a 210px desktop tile, either would cover close to a third of a ~120px phone tile.
- **Verified: 6 new checks** against the real `module.css`, scoped to the phone media-query block
  specifically (sliced from its own start to end-of-file) so an identically-named desktop rule
  elsewhere in the file can't produce a false pass. Confirmed to bite: reverted just the
  `.pp-gallery` grid line via `sed` (byte-safe on Windows, unlike Python's default text mode) and
  re-ran — both the "multi-column" and "hairline gap" assertions fail against the old line, and
  nothing else in the 690-check suite is disturbed. CSS braces balanced (498/498).

### Verified (whole round)

690 checks, all green, executing the shipped functions. `node --check` clean on `ppr.js`/`bim.js`/
`test.js`; 0 NUL bytes across every touched file; CSS braces balanced.

⚠️ **Not verified signed-in** — same standing caveat as every entry in this file. This round's
fix WAS, however, reproduced and diagnosed live (Chrome DevTools-equivalent inspection of the
actual deployed site), which is a step beyond this module's usual "structural only" verification
for exactly the class of bug (an async-timing interaction) that structural checks alone had missed
twice before.

## Fourth feedback round: 7 items — real thumbnails, the wireLocFields regression, markup select/line/polygon, photo adjustments (2026-08-30)

**Run `migrations/2026-08-30-photos-round3.sql`.**

### ⚠️ THE ROOT-CAUSE FIND — items 2, 4 and most of item 7 were ONE bug

`module.js` carried **two** `function wireLocationField(idPrefix)` declarations. JS function-
declaration hoisting means the second silently wins — and the second called `wireLocFields(idPrefix)`,
a helper a *previous* refactor had already deleted from this file. Every call to `wireLocationField`
(both `openUpload`'s Add Media modal and `openForm`'s Edit Photo modal) therefore threw a
`ReferenceError` the instant it ran. Neither call site wraps it in a try/catch, so the throw silently
aborted **every wiring statement that ran after it in the same function** — `wireWorksMultiField`,
`BIM.wirePinField`, `wireMediaTypeSelector`, the file-input change handler, and critically the
**Save/Upload button's own `onclick`**. That is exactly "Key Plan doesn't work, Works and Location
don't work, and Add Media regressed" reported together (item 7) — all four are downstream of the one
throw. It also explains item 4 ("Save markup does not work"): the staged-file grid that wires the
Markup button is set up in that same doomed tail of `openUpload`, so it never rendered at all.
- Fixed by deleting the stale, dead second declaration. Both call sites always passed exactly one
  argument, so the fix needed no caller changes.
- Regression-guarded: a structural test asserts `wireLocFields` is gone entirely and exactly one
  `wireLocationField` declaration exists.
- **No code bug was found for item 2** (topbar buttons regressing) after exhaustive tracing — both
  `ppr-new`/`bim-new` default to `display:none` in the static HTML, so no crash-then-skip-hiding path
  can explain "all three shown at once." As a hardening regardless (and because it is the same failure
  *class* the bug above turned out to be), `index.html`'s bootstrap now isolates every sub-module
  `init()` call and every one of `setScreen()`'s four visibility calls in their own try/catch, so a
  future bug in one module's setup can no longer strand another module's topbar button in the wrong
  screen's state.

### Item 1 — thumbnails are now a REAL, separate file, not a request-time transform

The prior fix (Storage's image-transform add-on) silently degrades to full-resolution the moment that
add-on isn't enabled on the project's plan tier — indistinguishable from "still slow," which is
presumably why this was reported again. `uploadThumbnailFor`/`makeThumbnailBlob` now generate a real,
separately-uploaded ~480px JPEG **client-side at upload time** (canvas downscale, the same technique
`ppr.js`'s offline export already uses) and store its Storage path on a new `thumb_url` column.
`thumbUrlOf(r)` prefers `thumb_url` → falls back to the transform request (old rows) → full-res.
- Wired into both save paths (`saveCapture` and the offline-queue `flushQueue`), and into delete (a
  thumbnail is a real object and would otherwise be orphaned forever).
- ⚠️ Never blocks the real upload — any failure (corrupt file, unsupported format, `toBlob`
  unavailable) degrades to `null`, and the photo still saves at full-res.
- Plan/Stack views were re-audited too: Plan renders no photo thumbnails at all (only text labels in
  its cluster popup, and the floor-plan *drawing* itself — a different asset); Stack already used
  `thumbUrlOf` for its cells and reserved full-res for the hover magnifier, which is correctly the
  "expanded" view per the item's own rule.
- **Verified: 15 checks genuinely executing** `makeThumbnailBlob`/`uploadThumbnailFor` (a fake `Image`
  + `<canvas>.toBlob` stub in test.js), including the video-is-skipped case and the
  fails-degrades-to-null case, plus the full `thumbUrlOf` fallback chain against injected rows.

### Item 6 — "Group by: None"

A real grouping mode, not a fake "one group that still prints a header" — `groupRows()` short-circuits
to a single un-sorted bucket carrying a sentinel key (`NO_GROUP_KEY`); both `listHTML` and `galleryHTML`
check for that sentinel and print **no header/wrapper at all** rather than an empty `<strong></strong>`.
Listed first in the `#pp-groupby` select, ahead of Month.

### Items 3/4 — the markup editor rebuilt: select-to-edit, independent fill colour, icons, Line/Polygon

- **Select tool (new, and the default tool on open)** — `markupHitTest` now does a proper
  bounding-box-and-topmost-first hit test for area shapes (rect/circle/polygon), falling back to the
  original nearest-point test for strokes/lines/text/icons. Clicking a shape selects it (drawn with a
  dashed outline + corner handles), dragging moves it (`translateMarkupObj`, applied against a
  snapshot taken at drag-start so a fast drag can't compound its own delta), and a "Delete selected"
  button (separate from "Clear all") removes just that object. The toolbar restyles the **selected
  object live** — click a colour swatch after grabbing a shape and it changes that shape, not "the
  next new shape's default." Switching tools clears the selection so the toolbar can't stay ambiguous
  about which it's editing.
- **Independent fill/border colour** — `fillColor` is a genuinely separate field from `color`
  (`fillColorOf(o)` falls back to `color` only for objects saved before this feature existed, so old
  markup keeps rendering identically). A second, smaller swatch row sits inside the Fill controls.
- **Icons instead of text labels** — all 13 tools are now icon-only square buttons
  (`title`/`aria-label` carry the name). Nine new icons added to the shared `assets/js/icons.js`:
  `cursor`, `highlighter`, `square`, `circleShape`, `line`, `polygon`, `textTool`, `signature`,
  `eraser` (pencil/ruler/arrowRight/trash/undo were already there and are reused).
- **Line** — the plain, undecorated version of the drag-a-segment gesture Ruler/Arrow already had.
- **Polygon** — click each corner (the shape's last point live-tracks the pointer between clicks),
  double-click to close. Fewer than 3 real vertices on close is discarded, not saved as a degenerate
  sliver; switching tools or saving mid-polygon likewise discards the unfinished shape.
- **Verified: 40+ checks genuinely executing** `drawMarkupObjects`/`markupHitTest`/`translateMarkupObj`
  against a fake canvas-2D recorder — Line drawing a plain stroke (no arrowhead fill), Polygon closing
  + filling with its own `fillColor` + stroking with its own `color`, the selection outline appearing
  only when `selectedIdx` matches, and translate correctly shifting every coordinate shape variant
  (`points` array / `x0,y0,x1,y1` / bare `x,y`) without mutating the original object.

### Item 5 — Exposure / Brightness / Contrast / Sharpness

Non-destructive, stored as `{exposure,brightness,contrast,sharpness}` (each -100..100, 0 = unchanged)
on a new `adjustments` column — the original file is never touched or re-uploaded, so resetting to 0
always recovers exactly what the camera captured.
- **Exposure/Brightness/Contrast render everywhere a photo appears** (Gallery tiles, List rows, Stack
  cells, the lightbox) via the browser's own CSS `filter` — cheap and GPU-accelerated, so this costs
  nothing for the overwhelming majority of unadjusted rows (`cssFilterFor` returns the literal string
  `'none'` when nothing was touched, and `thumb()`/the Stack cells skip the `style` attribute entirely
  in that case). Exposure and Brightness both map onto CSS's one `brightness()` primitive (there is no
  separate "exposure" filter) and compose multiplicatively; Contrast maps onto `contrast()` directly.
  Both are clamped to 0.3x–1.9x so an extreme slider can never invert or blank the image.
- **Sharpness has no CSS filter equivalent** — it needs real pixel convolution
  (`getImageData`/`putImageData`), which is too costly to run on every tile in a scrolling grid. It is
  therefore evaluated *only* in the adjustment dialog's own live preview (a standard unsharp-mask 3x3
  kernel, `applySharpen`) — the one other place a planner is looking closely at one photo, matching
  item 1's own "full resolution only when expanded" rule.
- New `openAdjustEditor` dialog (canvas preview + 4 sliders + Reset), reachable from the same two
  places Markup is: the lightbox ("Adjust" button beside "Markup") and the staged-file grid during
  upload (an "Adjust" button beside "Markup" per file, before the file is even saved).
- ⚠️ A default (all-zero) adjustment is never attached to a save payload — no accidental
  `adjustments:{}` write for a photo nobody touched.
- **Verified: 20+ checks genuinely executing** `cssFilterFor`/`adjustmentsAreDefault`/`applySharpen` —
  including the clamp ceiling/floor, sharpness contributing nothing to the CSS filter string, a flat
  image sharpening to a no-op (proves the kernel math nets to zero, not just "did it run"), and a
  bright-centre/dark-neighbour fixture proving the convolution pushes the centre up and pulls a
  neighbour down — the defining behaviour of an unsharp mask, not just "some numbers changed."

### Verification (whole round)

617 → **678 checks**, all green, executing the shipped functions (never regex-only for anything
genuinely computable) via `test.js`'s Node `vm` harness. `node --check` clean on every touched file;
0 NUL bytes; CSS braces balanced (488/488); function-set diff against the prior commit shows **0
functions lost, 20 added**. `assets/js/icons.js` bumped app-wide (`?v=20260830b`, 19 referencing
files); this module's own `module.css`/`module.js` bumped to `?v=20260830c`.

⚠️ **Not verified signed-in** — this environment has no live Supabase login, the standing caveat for
this entire module. No live click-through of the Select/drag-to-move interaction, the Polygon
double-click gesture, the Adjust dialog's live canvas preview, or the thumbnail generation against a
real upload. `migrations/2026-08-30-photos-round3.sql` has not been run.

## Third feedback round: 30 items across Gallery/Add-Media/Markup, Presentations, Plans (2026-08-30)

Owner sent 30 items in one message with an explicit instruction to work unattended overnight
("don't ask me for answers upto 8AM… please proceed without stopping"). Every item below was acted
on; where an item conflicted with a design shipped earlier the SAME DAY (Works/Location went from
multi-select → a single schedule tag → back to multi-select across three feedback rounds), the
LATEST owner instruction wins and the superseded code is documented as retired, not silently
deleted where something else might still reasonably reach for it.

**Run `migrations/2026-08-30-photos-round2.sql`.**

### ⚠️ THE ROOT-CAUSE FIND — one bug behind items 9, 10, and half of item 4

Investigating "the 360 button does nothing" and "close/cancel don't work" side by side (both are in
the Add Media modal) surfaced a single, severe bug in module.js's own `openModal()` wrapper:

```js
function close() { if (onClose) { ... } m.close(); }   // <-- calls m.close()
...
m.close = close;                                        // <-- but THIS reassigns m.close to itself
```

`m.close = close` overwrites the modal's real DOM-removal function with THIS wrapper. Since JS
resolves `m.close` at *call time*, by the time any button was ever clicked, `m.close()` inside the
wrapper referred to **the wrapper itself** — infinite recursion, a silent `RangeError: Maximum call
stack size exceeded` inside the click handler (logged to console, never shown on screen), and the
overlay was never removed. Worse: **anything scheduled to run AFTER `m.close()` in a handler never
ran either**, because the throw happened first — this is exactly why picking "360°" never reached
`PANO.openCapture()`, and why the markup editor's Save button never reached `onSave(objs)`.

Fixed by capturing the ORIGINAL close in a `rawClose` variable *before* `m.close` is ever reassigned,
and having the wrapper call `rawClose()` — never `m.close()` — so it can never call itself. This one
fix repairs every modal opened via module.js's `openModal()`: Add Media, Edit photo, the markup
editor, the pin-preview popup, and more.

⚠️ **Why the existing test suite never caught it:** the harness's own `UI.modal` stub is a simpler
shape than the real one in `assets/js/ui.js` — its `close` is a plain closure that never gets
reassigned the way the real one does, so the reassignment hazard simply doesn't exist in the stub.
A new test (`_openModal`, section "openModal, exercised against a REAL-SHAPED UI.modal stub…") builds
a stub matching the real shape on purpose and confirms `close()` terminates in exactly one call; it
**fails with a stack-overflow throw against the pre-fix code** and passes against the fix.

### Items 1–3: Gallery landing screen
1. **Already correct** — `ppr-new`/`bim-new` are `display:none` by default and only shown on their
   own screens (`PPR._syncTools`/`BIM._syncTools`); Gallery never showed them. Verified, no change.
2. **A topbar search box + funnel toggle** (`#pp-topsearch`/`#pp-topfilttoggle`) replace the old
   always-open filter row on EVERY viewport, not just on a phone (item 8's old behaviour). Typing in
   the topbar box drives `filters.search` directly; the funnel reveals the rest (date range, trade,
   works, location, archived) in the docked panel below, which is now `display:none` by default at
   every width (`.pp-filters { display:none } .pp-filters.open { display:flex }`). The in-panel
   `#pp-f-search`/`#pp-filttoggle` stay in the DOM (hidden) as a narrow-phone fallback and so any
   code still reading `#pp-f-search`'s value finds one. The SAME pattern is applied to Presentations
   (`#ppr-topfilttoggle`, toggling `#ppr-listbar.open` — it already shared the `.pp-filters` class,
   so no new CSS was needed there, only the topbar trigger). Plans has no free-text filter to move.
3. **Tile (Gallery) view button now leads the view-toggle group**, List moved second — matches the
   module's own default (`view = 'gallery'`).

### Item 4: markup editor rebuilt iOS-Photos-style
Pen / **highlighter** (wide, translucent, drawn under everything) / **ruler** (a straight reference
line with end-tick marks) / rect / circle / arrow / text / **signature** (a thinner, distinct stroke
type) / **sticker** (renamed from "icon") / eraser. Colours now apply to both the STROKE and an
optional, adjustable-transparency **fill** on rect/circle (`hexToRgba`, a fill checkbox + an opacity
slider) — never on ruler/arrow, which have no interior to fill. A line-weight picker (3 sizes) was
added too, since "shapes" implies more than one line thickness.

**Stickers reuse Equipment Loading's own plant pictograms verbatim** — copied, not imported (the
module contract forbids one module reading another's files; `MARKUP_STICKERS` duplicates
`EQ_ICONS`'s `d` paths, each already a single Path2D-parseable string), plus **camera** and
**person**, hand-drawn since they need more than one Path2D subpath. `drawIconStamp` picks the
Path2D branch when a sticker name is a real plant pictogram, else falls back to the hand-drawn
warn/arrow/person/camera/equip shapes — all wrapped in one `try/catch` so a canvas missing
`translate`/`scale`/`Path2D` (a test harness, or some future non-browser render target) degrades to
"no sticker drawn" instead of taking the whole markup layer down with it (this is exactly what
crashed the test suite the first time the sticker branch ran against the harness's simplified fake
canvas — fixed on both sides: the production code now tolerates it, and the harness's `fakeCtx()`
was widened with `translate`/`scale`, plus a minimal `Path2D` stub added to the sandbox globals, so
it genuinely models what a real 2D context provides).

### Item 5: markup available at upload time
The Add Media modal now shows a thumbnail + "Markup" button per staged file the moment files are
chosen (`#pp-files`'s `onchange`), **before anything is saved** — each staged file gets a throwaway
`URL.createObjectURL` preview, markup drawn against it is held in memory keyed by file index
(`pendingMarkup`), and merged into that file's own `markup` column on the very first insert (never a
second write). Object URLs are revoked on close (`revokeStaged`, wired as `openModal`'s `onClose`) so
a cancelled upload never leaks them.

### Items 6/7: Works and Location, rebuilt again (REVERSES the 2026-08-29 single-tag design)
⚠️ The SAME two fields were redesigned three times in one day across feedback rounds (multi-select →
single schedule-tag → multi-select again). This entry describes the FINAL, currently-shipped shape;
the single-tag functions (`worksTagFieldHTML`/`readWorksTag`/`WORKS_CUSTOM`) are gone, not left
alongside, since keeping two competing Works UIs in the same file would be a worse trap than a clean
supersession.

- **Works** is an "+ Add works" button opening a checkbox picker (`openWorksPicker`) grouped by the
  schedule's own `work_type` per activity (`worksGroupedOptions()` — "the project-defined activity
  groups"), multi-select, with a chip row showing what's picked (removable via ×). A trailing
  "Previously used" bucket carries any value a planner already typed that matches no live schedule
  activity, so nothing already captured is silently dropped from what can still be picked. Trade is
  still never chosen directly — `deriveTradesForWorksList` UNIONS the derived trade of every chosen
  Works value (a slide can now legitimately span more than one trade, e.g. Structural + MEPF work
  photographed together).
- **Required only when the schedule has something to offer**: `scheduleHasActivities()` (`SCHED_ACTS
  .length > 0`) gates Works' requiredness — a project with no schedule integration at all is never
  asked to answer a question it has no data for.
- **Location** is now a **single-node picker** over the real schedule tree (`locTree()` /
  `locTreeLevel()` — recursively built from `distinctLocValues()` at each level, cascaded exactly like
  the old datalists were, just rendered as a real tree instead of flattened into `<option>`s). Picking
  ANY node at ANY depth is valid — "it should be fine to select tower only" — via `openLocationPicker`/
  the generic, stateless `ProgressPhotos.openLocationPicker(onPick)` export (used by bim.js's floor-plan
  form too, see item 12). Required only when the project has a Location Breakdown configured at all
  (`LOC_LEVELS.length`).
- **A new, ALWAYS-required "View name" field** (`progress_photos.view_name`, new migration column) —
  what this SPECIFIC photo/view shows (e.g. "Facing east stairwell"), distinct from the optional
  `description` and from the schedule-derived `location` (which names WHERE, not WHAT). Required
  regardless of whether a schedule exists — this is the one field with no waiver.

### Item 8: "Camera position" → "Key Plan", required, inline floor-plan upload
Renamed and marked required in the Add/Edit Photo form. When the project has **zero** floor plans,
`pinFieldHTML` now renders a small inline upload mini-form (`.pp-inlineplanform`: name + file +
Upload) directly inside the Add Media / Edit Photo modal — no trip to the Plans tab, and whatever
else was already filled in on the form survives. On success the pin field repaints itself in place
so a pin can be placed on the just-uploaded plan without reopening anything.

### Items 9/10: 360° does nothing, Close/Cancel don't work
**Both were the `openModal()` bug above** — fixed at the root. Belt-and-braces: the 360° button's
handler is now wrapped in its own `try/catch` reporting any FUTURE failure visibly, in case
`PANO.openCapture` is ever unavailable for a genuinely new reason.

### Item 11: Floor plan upload accepts image OR PDF
`accept="image/*,application/pdf"` on every floor-plan file input (the Plans-tab upload form, the
inline Add-Media mini-form, item 12's location-based upload). A PDF has no natural pixel size an
`<img>` can measure, so `width_px`/`height_px` are left `null` rather than inventing fake dimensions
— `imageDims()` short-circuits to `{w:null,h:null}` for a `.pdf` file/mime-type. Rendering switches
from `<img>` to `<embed type="application/pdf">` wherever a plan is displayed (`isPdfPlan(plan)`,
checked by file extension on the stored path). ⚠️ **Known limitation, stated in the code**: some
browsers' native PDF viewer intercepts pointer events itself, so click-to-place-a-pin may not
register reliably over an embedded PDF — an image floor plan remains the more dependable choice.

### Item 12: floor plan upload asks for a SCHEDULE LOCATION, not a name/level-order
`openPlanForm` (bim.js) now offers a "Pick a location…" button (reusing the item-7 tree picker via
`ProgressPhotos.openLocationPicker`) instead of typed Name + Level-order fields, when the project has
a Location Breakdown at all. The plan's `name` is DERIVED from the picked location's own breadcrumb
(falling back to a manual name field only when no Location Breakdown exists, same waiver rule as
items 6/7); `level_order` is left at a flat 0 rather than invented. New `floor_plans.location_values`
jsonb column (same shape as `progress_photos.location_values` — one key, usually).

### Item 13: Gallery/Presentations/Plans tab misalignment
⚠️ **Root cause: `.pp-tab` had no explicit height** while every sibling topbar control (project
select, tool buttons, back button) is pinned to 34/36px — `align-items:center` centres each control
on its OWN box, so a mismatched box height reads as visible misalignment even with nothing literally
offset. `.pp-tabs`/`.pp-tab` now pinned to 34px, flex-centred internally.

### Item 14: photo loading speed
Tile/list previews now request a **downscaled, lower-quality signed URL** (Supabase Storage's image
transform: `{width:480, quality:55, resize:'contain'}`) instead of the full-resolution original —
`signAll()` now populates a SEPARATE `thumbCache` alongside the existing full-res `urlCache`, and
`thumb()`/the Stack view's cell thumbnails read `thumbUrlOf(r)` (falling back to the full-res URL if
no thumbnail exists yet). The lightbox, markup editor, Edit-photo preview, and the Stack view's hover
magnifier all still use the FULL-res URL — quality matters there. ⚠️ **Depends on the Storage image
transform add-on being enabled on the Supabase project** — if it isn't, the second `createSignedUrls`
call (wrapped in try/catch) either errors or returns unusable URLs, and `thumbCache` simply stays
empty, so `thumbUrlOf` transparently falls back to full-res with no visible breakage, just no speed
gain until the add-on is available. This is the honest, "try to speed up, never break if unavailable"
shape the ask calls for.

### Item 15: Presentations List View — no per-row icons
The `.ppr-cell.ppr-acts` column (Download/Preview/Archive icon buttons) is gone from `renderList()`'s
row markup entirely; the header grid narrowed from 5 tracks to 4 (`34px 150px minmax(120px,1fr)
110px`, the trailing 118px Actions track removed). Download/Preview/Archive are NOT lost — they moved
into the OPENED presentation's own header (`renderSlides()`'s `wirePresActs`, alongside the existing
Edit/Delete/Reorder icons) — reachable the moment you open a presentation, or via the batch toolbar
the moment 1+ rows are checked (a check of exactly one row already works as "act on this one").

### Item 16: checkbox-driven selection + preview alignment
The row's red highlight now follows `selectedPprs[p.id]` (the checkbox), never `selId` ("which
presentation is currently open in the editor") — a different concept once opening a row navigates
away from the list screen entirely. `renderPreview()` is now driven ENTIRELY by the checked set:
0 checked → "Check a presentation to preview its slides."; exactly 1 → that one's slides (still
clickable into the editor); 2+ → the existing combined preview (item 14, 2026-08-29). The old
"re-validate `selId` against `visiblePprs()`" guard is superseded structurally — `visibleSelectedPprIds()`
already scopes to what's visible, so a checked-but-archived/filtered row can never drive a stale
preview by construction, not by a special-cased re-check.

### Item 17: stacked-photo-card preview thumbnail
When a slide has BOTH a previous and current photo, its preview thumbnail (`slideThumbHTML`, shared
by the single and combined preview paths so they can never draw a slide differently) is a
stacked-photo card — current on top (`.ppr-stack-front`), previous peeking out ~80% visible behind it
at an offset (`.ppr-stack-back`) — instead of one flat image quietly standing in for the pair. Falls
back to a plain flat thumbnail when only one photo exists.

### Item 18/24: "Add photo" folded into "Pick a photo"
The sibling `+ Add photo` buttons beside the Current/Previous "Pick a photo…" buttons are GONE.
Uploading a new photo now happens via a `+ Upload new photo` button living INSIDE `openThumbPicker`
itself — reused by every caller of that picker (the slide form's Current AND Previous pickers, and
the copy wizard's) — so there is exactly one way to attach a photo to a slide, matching the stated
invariant: 1 current photo, 0–1 previous.

### Item 19: location details in the slide reorder view
`openSlideSorter`'s `thumbHTML` now prints each slide's current photo's location under its
thumbnail, plus the previous photo's location (labelled "(previous)") when it differs — since the
two are no longer required to match.

### Item 20: reorder-slides icon → swap
New `swap` glyph added to the shared `assets/js/icons.js` (two opposing arrows) — replaces the
generic `layout` icon on the "Reorder slides" button, which read as unrelated to reordering.

### Items 21/22/23: per-pane Key Plan, moved caption fields, no repeated project name
- **Item 21**: the shared `.ppr-meta` "Key Plan" toggle above the pair is GONE. Each pane now carries
  its OWN small icon (top-right of its image, `.ppr-kpicon`) and its OWN popup (`.ppr-kppopup`,
  anchored under the icon) — shown only when THAT photo actually has a key plan, toggled
  independently via per-pane state (`keyPlanOpenPane = {before:false, after:false}`).
- **Item 22**: capture date / description / works moved from a `<figcaption>` BELOW the image to a
  new `.ppr-panehead` tile ABOVE it. The shared-location tile above the whole pair (already shipped
  2026-08-29) still fires when both photos agree; when they DIFFER (or only one exists), each pane's
  own head tile states its own location line — the "split" the ask describes.
- **Item 23**: the redundant "Project" field is removed from the slide header (`renderSlides()`) —
  the topbar project selector already names it on every screen of this module.
- ⚠️ **Scope note**: this redesign applies to the LIVE editor (`pane()`/`renderSlides()`) only. The
  static export renderer (`slideFigureHTML`/`EXPORT_CSS`, used by the offline HTML/PDF/PPTX
  downloads) is a separate code path and was NOT rebuilt to match — a deliberate time-boxing choice
  given the scope of this round, flagged here rather than silently left inconsistent.

### Items 25/26/27/28: Floor Plans — a location tree, visible registration points, pins move to Add Media
- **Item 25**: the Plans-page plan `<select>` is replaced by a **location tree side panel**
  (`.bim-plantree`, `planTreePanelHTML()`/`wirePlanTree()`) built from the schedule's own tree
  (`ProgressPhotos.locationTree()`, a new stateless export). A node with a matching floor plan
  (matched by exact `location_values` equality, `locKey()`) is clickable to open it; a node with none
  is greyed out (`.no-plan`) but STILL clickable — for a planner, it opens `openPlanForm(values)`
  pre-filled with that exact location, so uploading a plan for a gap is one click plus a file. Any
  plans not matched to a tree node (legacy, or a project with no Location Breakdown) list separately
  below the tree so nothing becomes unreachable. Even with **zero** plans uploaded, a project with a
  Location Breakdown still shows the (all-grey) tree, so a planner can see exactly which locations
  still need one.
- **Item 26**: registration points are now VISIBLE. Each already-picked pair renders as a numbered
  green dot (`.bim-regpt`) on BOTH the drawing and the photo side; a point picked on the drawing but
  not yet matched on the photo shows as a pulsing amber dot on the drawing side only
  (`.bim-regpt.is-pending`).
- **Item 27**: "Place pin" is REMOVED from the Plans page entirely (the `#bim-place` toolbar button
  is gone from index.html). `togglePlaceMode`/`placeMode`/`openPinPicker` are left defined but
  documented as retired-in-place — the same "superseded code stays, commented, never silently
  deleted" convention this file already uses elsewhere — since the button that reached them no longer
  exists and nothing else calls them.
- **Item 28**: the direction widget moves from a separate circular gadget below the plan image to a
  field-of-view CONE drawn directly ON the image the pin sits on, anchored to the pin, with two
  independently-draggable endpoint handles (`.bim-conehandle-el`) — "drag the end points… to adjust
  angle and range". Clicking the image drops a pin and seeds a DEFAULT cone facing the image's own
  centre (`defaultCone()`, pure and genuinely executed in tests — bearing math shared with the
  existing `directionDegFromDrag` convention: 0°=up, clockwise). The cone (`.bim-conewedge`) is
  rendered at 32% fill opacity — "moderately transparent". Double-clicking the shaded wedge toggles
  "does not apply" (`direction_na`, a new column — a top-view/aerial photo has no facing direction to
  record; distinct from simply never having set one). `direction_deg` (existing column) keeps being
  written as the bisector bearing between the two edges, purely so the two OLDER renderers that only
  ever read that one column (the Plans-page pin marker, the Gallery's key-plan preview popup) keep
  drawing a sensible cone without needing to understand the new two-edge shape.
- New columns (`migrations/2026-08-30-photos-round2.sql`): `floor_plan_pins.edge1_x/edge1_y/edge2_x
  /edge2_y` (normalized 0..1, same convention as `x_norm`/`y_norm`), `floor_plan_pins.direction_na`,
  `floor_plans.location_values`, `progress_photos.view_name`. All nullable/defaulted, all read
  tolerantly by existing code (`savePinForItem`/`openPlanForm` strip-and-retry on a "column does not
  exist" error, same convention as every other not-yet-migrated column in this module family).

### Item 29: save speed
Two independent changes, both about ROUND-TRIP COUNT, not payload size:
- **Batch upload** (`openUpload`'s save loop) now runs a small **capped concurrency pool** (4 workers
  pulling from a shared index) instead of one file at a time — a batch of N photos now takes roughly
  `N ÷ 4` round-trips' worth of wall-clock time instead of N. The pool is capped, not unbounded, since
  a burst of dozens of simultaneous uploads would just as likely throttle the connection as help it.
- **Key Plan pin saves** (after upload) now fire via `Promise.all` across every newly-uploaded photo
  sharing one Key Plan position, instead of a sequential `for` loop awaiting each one — these are
  independent inserts with no ordering to protect.
- A stray `await new Promise(r => setTimeout(r,0))` per-file progress-paint yield was removed from
  the old sequential loop (a real, if small, per-file delay that added up over a large batch).

### Item 30: Vertical Stacking shows the schedule skeleton even with zero photos
⚠️ **Root cause**: `stackGrid()`'s row/column headers were built ONLY from photos' own
`location_values` — a freshly-configured project's schedule already defines the whole Location
Breakdown (that's literally what the levels enumerate), but with zero photos tagged yet, the grid
rendered "No photos have been tagged at this level yet" instead of the empty grid a planner could
check their breakdown against. Fixed by seeding the row/column value sets from `distinctLocValues()`
(the SAME schedule-derived enumeration the Add-Media location picker already uses) UNIONED with
whatever photos add beyond that — a photo tagged at a location the schedule doesn't (yet) know about
is still shown, never silently dropped either way.

### Verification
**602 checks green** (was 568 before this round — 34 net new, after removing the ones testing
designs this round explicitly supersedes and rewriting others to test the CURRENT behaviour rather
than delete-and-forget). `node --check` clean on every touched file (module.js, ppr.js, bim.js,
test.js); 0 NUL bytes (verified via a byte-level Python read, not a shell `grep` pattern — a first
pass using `grep -c $'\0'` under this environment's Git-Bash reported thousands of false "NUL bytes"
per file, which a raw `open(f,'rb').read().count(b'\x00')` in Python showed was nonsense; recorded
here because it is exactly the class of tooling trap this repo's own log has flagged before —
**sanity-gate a scan before trusting it**). 0 duplicate DOM ids in index.html (75 unique). CSS braces
balanced (481/481). The openModal fix is GENUINELY EXECUTED against a UI.modal stub shaped like the
real one (see the root-cause section above) — the one test in this file that could actually have
caught that bug, since the harness's own simplified stub never reassigns `m.close` the way the real
`assets/js/ui.js` does.

⚠️ **Not verified signed-in** — this environment has no live Supabase login, the standing caveat for
this entire module. No live click-through of the topbar search/filter toggle, the works/location
pickers, the markup sticker palette, the in-photo cone drag interaction, the floor-plan location
tree, or the concurrent-upload pool against real network conditions. The Storage image-transform
dependency for item 14 in particular has not been confirmed available on this project's plan.

⚠️ **Function-count diff not claimed this round** — the working tree already carried substantial
uncommitted changes from earlier in this session before this round of edits began (confirmed via
`git show HEAD`, which reflects a state that predates even the single-Works-tag design this round
supersedes), so a function-set diff against `HEAD` would compare against a stale, not-immediately-
prior baseline and its "0 lost" reading would not honestly mean what it's supposed to. Parse-clean +
0-NUL + CSS-balanced + the 602-check suite are the verification actually performed and claimed here.

## Persistent sidebar + Back/Forward steps through Gallery/Presentations/Plans (2026-08-30)

Owner reported the actual trigger for this app-wide change: navigating deep into this module
(e.g. the presentation slide editor) and pressing Back skipped straight past every intermediate
screen to the module launcher — there was no History API integration anywhere in the app, and
this module's own multi-screen (Gallery/Presentations/Plans) + multi-view (List/Gallery/Plan/
Stack) structure made the symptom most visible here. Owner's explicit direction (via
`AskUserQuestion`, see the main `CLAUDE.md` entry of the same date): fix this **app-wide**, and
**bring back a persistent sidebar** — reversing this module's own "sidebar-less shell" note.

⚠️ **This work was deliberately done LAST, and only after re-confirming there was nothing left to
collide with.** This module had a concurrent session actively developing it the same day (Batches
E–H, the full-module audit below, several feedback rounds) — `git fetch` + `git rev-parse HEAD` vs
`origin/claude/planners-dashboard-uiux-qe6yfn` were re-checked immediately before touching this
file and confirmed HEAD already matched origin with nothing further pending, so the earlier
concurrent thread had already wrapped up into the same commit this session started from.

- **Sidebar**: the old `<!-- Sidebar-less shell (matches Project Schedule / Cash Flow / Drawing
  Register) -->` comment + bare `.pd-content` is replaced by the standard `<aside class="pd-
  sidebar">` (brand block + `<nav id="side-nav">`, filled by `UI.renderNav(el, 'project', {active:
  'progress-photos', ...})`), matching every other module now. `UI.initShell()` added to the
  `requireLogin` callback for the hamburger collapse/expand.
- ⚠️ **`module.css`'s `.pd-content { width: 100%; }` had to go** — a leftover from before this
  module had a sidebar, it would otherwise fight the new sidebar for width. The shared
  `dashboard.css` flex rule (`.pd-content { flex:1; min-width:0 }`) already sizes it correctly.
- **History-state, scoped to ONE switch on purpose**: the top-level Gallery/Presentations/Plans
  screen switch (`setScreen`) is now wrapped in `UI.bindHistoryState({key:'pp_screen', get, apply})`
  — `curScreen` tracks the current screen, the existing `.pp-tab` click handler also calls
  `histScreen.push()` after `setScreen()`, and `apply()` just calls `setScreen()` again. `setScreen`
  itself is completely unchanged otherwise (still persists to `localStorage['pp_screen']` too, so
  a plain reload still restores the last screen exactly as before).
- ⚠️ **Deliberately NOT wired**: this module's List/Gallery/Plan/Stack view toggle, the PPR slide
  editor's own navigation, and the Plans tab's pan/zoom state — all already persist to their own
  `localStorage` keys, and folding every one of them into the URL hash is a materially bigger pass
  than the reported bug needed, on a file that's had more same-day churn than any other module in
  this repo. The top-level screen switch is the one that actually reproduced the reported symptom
  (Back skipping past Presentations straight to the launcher); the rest is unchanged.
- Cache-busting: `module.css?v=` bumped `20260830a` → `20260830b` (its own content changed); the
  shared `ui.js?v=` bump (`20260830a`) that every module in this rollout picked up was already
  applied to this file in an earlier pass the same day.

**Verified**: the real (non-comment) inline `<script>` block parses (`node --check` on the
extracted block — a stray literal `<script>` inside an unrelated HTML *comment* four lines above
the CDN script tags is a known false-positive for naive regex extraction and was confirmed as
such, not a real syntax issue); 0 duplicate DOM `id=` attributes (76, unchanged); CSS braces
balanced (480/480). ⚠️ **Not verified signed-in** — same standing caveat as every other entry in
this file; the sidebar's real layout and the Back/Forward click-through are unverified against a
live session.

## Full-module audit — review, test, performance/UI/UX pass across all 8 files (2026-08-30)

Owner: *"please review all the code. add more test cases and make sure everything works 100% of
the time. review, optimize the performance, UI, and UX of the progress photos module."* No signed-in
Supabase session exists in this environment, so "100%" here means: every code path reviewed, every
finding either fixed-and-genuinely-tested or explicitly documented with a reason it wasn't touched —
never silently assumed passing. Three parallel review agents covered module.js/index.html,
ppr.js+pano.js+recon.js, and bim.js+module.css respectively; findings were triaged and fixed in
severity order. Suite grew **483 → 568** (85 new checks), several via genuine execution against the
real functions, not just regex reads.

### High severity — real bugs, not just untidiness

- ⚠️ **Plan/Stack views could open the WRONG photo.** They read PROJECT-WIDE data (every pin / every
  location-tagged photo), while the lightbox's own `openLightbox(id)` falls back to index 0 on a miss
  against the Gallery's currently FILTERED list — so a photo excluded by the active filter (archived,
  wrong trade, wrong date range) silently opened a DIFFERENT photo with no warning, and a Delete from
  there would hit the wrong record. New named `openPhotoById(id)` (module.js) checks `byId(id)` first,
  toasts *"That photo could not be found"* and returns on a miss, re-scopes `lightboxIds = [id]` on a
  hit — both `openPlanPin`'s photo branch and Stack's combined-mode click now route through it, and
  it's the same function the exported `ProgressPhotos.openPhotoById` (bim.js's own Plans-tab pins)
  already called, so there's no second, divergent, unguarded copy.
- ⚠️ **A batch selection survived a tab switch.** `index.html`'s `setScreen()` only ever called
  `ProgressPhotos._syncChrome()` when ENTERING the Photos screen, never when leaving it — so
  selecting photos, then switching to Presentations/Plans, left the four selection-only toolbar
  buttons (count/Download/Add to Presentation/Archive) visible on top of whichever screen opened
  next. New `_leavePhotosScreen()` clears the selection and hides those four controls specifically —
  ⚠️ **deliberately NOT a call to the full `syncChrome()`**: that function's own `has`-false branch
  would re-show `pp-add`/`pp-sep-photos`/`pp-refresh`, undoing `index.html`'s own
  `show(PHOTO_TOOLS, false)` for the screen being left. It also resets the (still-mounted, merely
  `hidden`) grid's own checkbox/`.pp-selrow` residue, so a returning planner never sees stale checked
  boxes the cleared toolbar already disagrees with.
- ⚠️ **`bim.js`'s `load()` had one un-guarded `await`** (`signPlanUrls()`) — every sibling fetch in the
  same function is try/caught; this one wasn't, and `load()` itself runs fire-and-forget from
  `ProgressPhotos.onProject()` with no `.catch()` anywhere — so a real network failure signing the
  plan images (not a Supabase `{error}` response, which the function already tolerated) threw
  straight out and permanently froze the Plans screen on *"Loading floor plans…"*. Now
  `try { await signPlanUrls(); } catch (e) { planUrlCache = {}; }`. **Genuinely executed**: a new
  `BIM._load(testPid)` test hook forces `createSignedUrls` to reject and proves `load()` still
  completes, `BIM.hasPlans()` stays true, and the host repaints past the loading placeholder.
- ⚠️ **`pano.js` H1 — `MediaRecorder` construction had no try/catch.** A codec/support failure
  (thrown by the constructor or `.start()`) rejected the async onclick handler with nobody awaiting
  it — a silent unhandled rejection, leaving the button stuck reading *"Starting camera…"* forever
  with the camera preview live but no recording ever armed. Now wrapped; on failure the button resets
  to *"Start recording"* and toasts the escape hatch (*"you can upload a video instead"*).
- ⚠️ **`pano.js` H2 — the worst of the batch.** `processVideo`'s `combo`/`date`/`source` reads (the
  last of the three, `source`) were done at the very END, after frame extraction/OpenCV/stitching/
  Storage upload had all already run — several seconds of async work during which Cancel/× REMOVES
  the modal's DOM (`overlay.remove()`), and `cancelled` was checked only ONCE, at function entry. A
  cancel mid-pipeline crashed on `$('pano-c-source').value` against a `null` node, **after** the
  stitched JPEG had already been uploaded to Storage — permanently orphaning it, since the crash hit
  before the DB row that would reference it was ever inserted — and showed the user a confusing
  "Could not build the panorama" error for something they'd already successfully cancelled. Fixed:
  all three reads hoisted before any `await`; `cancelled` re-checked after every major stage
  (extract/OpenCV/stitch/toBlob/upload); a cancellation caught right after the upload succeeds
  removes the now-orphaned object from Storage instead of leaving it there forever.
- ⚠️ **`recon.js` H3 — the identical class of bug**, in `openRequestForm`'s save handler, which had
  **ZERO cancellation-awareness at all** (Cancel/× was left on `openModal`'s bare default close).
  Gained the same `cancelled` flag + hoisted reads + post-upload orphan cleanup as pano.js's H2.
- ⚠️ **`recon.js` M5 — `retractRequest`'s order-of-operations race.** The storage `remove()` ran
  BEFORE the DB delete's own `.eq('status','pending_approval')` guard was even checked — so a request
  a concurrent admin had *just* approved could have its video deleted out from under the now-accepted
  job, while the delete matched 0 rows (Supabase reports that as success, no error) and the UI still
  claimed *"Request retracted"* regardless. The delete now runs FIRST, with `.select()`, and the
  storage object is only removed once a still-pending row is confirmed genuinely deleted; otherwise
  it toasts *"…it may have just been approved"* and leaves the video alone. **Genuinely executed**
  both branches (still-pending vs. raced-and-approved) — ⚠️ this ALSO required a real harness fix:
  the test store's `makeQuery` had a **vestigial `q.select = function () { return q; };`** line
  running AFTER the object literal, silently clobbering a just-added `select()` override that was
  meant to set `q.__select` for the delete branch's real Supabase contract (`.delete().select()`
  returns the deleted rows). Removed; the delete branch now genuinely returns `data: del` only when
  `.select()` was chained, matching real supabase-js.

### Medium severity

- **`bim.js`'s `wireStageInteractions()` leaked two `window` listeners on every single `render()`.**
  `outer`'s own listeners are fine (a fresh DOM node each render, discarded with it), but
  `window.addEventListener('mousemove'/'mouseup', …)` was bound unconditionally every call, with
  nothing ever removed — each closing over its own now-stale `dragging` flag, permanently firing on
  every mouse move across the WHOLE PAGE. `dragging`/`lastX`/`lastY`/`moved` hoisted to module scope;
  the two `window` listeners now wired exactly once, guarded by `_stageWindowListenersWired`.
  **Genuinely executed**: real tracked `winAddEventListener`/`winRemoveEventListener` stubs added to
  the harness prove exactly one mousemove + one mouseup listener exist after the first render, and
  STILL exactly one after three more loads/re-renders.
- **`bim.js`'s two OpenCV `cv.Mat` leak sites** (`paintActualView`, the registration save handler) —
  `.delete()` only ran on the happy path; a `warpPerspective`/`imshow` throw, or the deliberate
  *"not enough spread"* friendly-error (`H.empty()`), skipped cleanup of whichever Mats already
  existed. Both wrapped in try/finally, each Mat declared outside the try (`var` hoisting keeps it
  safely `undefined`, not a `ReferenceError`, if its own line never ran) and deleted conditionally.
- **`ppr.js`'s merge-wizard left an orphaned, invisible presentation on a slide-copy failure** — the
  `T_PPR` row already existed, but the failure just toasted and re-enabled the button, leaving the
  wizard open with no reference to what was created; retrying created a SECOND orphan on top of the
  first. Now recovers exactly like `openCopyWizard.finish()`'s identical failure already does: close
  the wizard, reload, open the (slide-less) new presentation directly so the planner can see it and
  add slides one at a time.
- **`ppr.js`'s single-selection preview went stale after archiving (or filtering out) the very
  presentation it was showing.** The combined (2+) path was already scoped to `visiblePprs()` via
  `visibleSelectedPprIds()`; the single-`selId` path never was — `slides(selId)` still resolves fine
  (the rows aren't deleted, only the parent's `archived` flag flips), so it just kept quietly showing
  slide thumbnails for something the list no longer displayed at all. `renderPreview()` now clears
  `selId` when it's no longer in `visiblePprs()`. **Genuinely executed** via a new save/restore test
  hook (`_renderPreviewWithState`, same convention as `_eligiblePhotos`) across visible/archived/
  hard-deleted `selId` values.
- **`pano.js`'s "Switch camera" had no re-entrancy guard** — a rapid double-tap (or an impatient click
  during the `getUserMedia` permission prompt) could start a second `stopCameraStream()`/
  `startCamera()` pair before the first had assigned `stream`, dropping the earlier call's already-
  live `MediaStream` with no reference left to stop its tracks. Now `disabled`-guarded like the
  record button.
- **`pano.js`'s single-panorama viewer leaked a WebGL context on every view.** `mountCylinderViewer`'s
  return value (with its `dispose()` handle) was discarded entirely in `openViewer`. Browsers cap
  simultaneous WebGL contexts (commonly 8–16); enough un-disposed panorama views eventually make
  every FURTHER context creation on the page silently fail. Fixed by extending `openModal(html,
  width, onClose)` with an optional `onClose`, run on **every** dismissal path — `[data-close]` AND a
  genuine backdrop click alike (previously only `UI.modal`'s own private `close`, bypassing any
  `m.close` reassignment, handled the backdrop) — and passing `function(){ viewer.dispose(); }`.
- **The identical backdrop-close cleanup bypass existed in `module.js`'s own `openModal`**, used by
  `openForm` (Edit Photo) and `openMarkupEditor`. Both had comments claiming their cleanup ran "on
  every close path (× / Cancel)" — true only of the two `[data-close]` buttons; a backdrop click left
  the "editing this photo" collab cursor stuck broadcasting, and the markup editor's `window` resize
  listener permanently attached. `module.js`'s `openModal` gained the exact same `onClose` mechanism
  as pano.js's; both callers' now-redundant manual `[data-close]` re-wires were removed rather than
  left duplicating the cleanup.

### Low / cleanup

Dead code removed (`bim.js`'s unreachable `#bim-plan-select` binding in `wire()` — the element
doesn't exist at `init()` time; `wireMediaTypeSelector`'s unused `lbl` lookup; four confirmed-
orphaned CSS selectors with zero references anywhere: `.pp-thumb-wrap`, `.pp-cardphoto-wrap`,
`.ppr-pickinfo`, `.ppr-pickthumb`). Two real WCAG AA failures fixed — `.ppr-tmpl-locorder` and
`.ppr-sortno` (white text on plain `var(--pd-red)`, 11–11.5px bold) measured **4.12:1**, below
threshold; now `color-mix(in srgb, var(--pd-red) 85%, black)`, measuring **5.44:1** — **genuinely
computed** in the test (WCAG's own relative-luminance formula, run against the real CSS's actual
`color-mix` percentage, confirming both the old failure and the new pass rather than assuming the
percentage was chosen correctly). `.pp-muted` — used in module.js/ppr.js, defined nowhere in
`module.css` at all — added. `wireMediaTypeSelector`'s `capture="environment"` was stripped
unconditionally on every call including the very first, so it never actually took effect even in
Photo mode; now removed only in Video mode and restored switching back to Photo. The offline-queued
toast hardcoded "photo" regardless of `kind` (video batches reported themselves as photos) — fixed to
match the "uploaded" toast beside it. `openAddToPresentation` now escapes `p.id`, not just the label.
Both Gallery selection checkboxes and the Plan view's cluster markers gained `aria-label`s (the
cluster button's only prior accessible content was the bare pin count). `.pp-plancluster`/
`.pp-stackthumb-sm` gained a ≥40px phone touch-target rule (neither had one; every dimension was
under 44px on a touch device). `ppr.js`'s `slides()` was re-sorting an array `slidesOf[k]` is already
kept sorted at both its write sites (load()'s explicit sort; the slide-sorter's own renumber-to-
match-array-order before assigning) — removed the redundant per-call `.sort()`. `reloadPhotos()`'s
completely silent catch (its only caller is the slide editor's "+ Add photo" flow — a failed re-read
left a just-uploaded photo invisibly unpickable with no explanation) now toasts. `pano.js`'s
`seekTo()` had no timeout at all — a malformed video, or the known browser quirk where `seeked` can
fail to fire when `currentTime` is set to a value the video is already effectively at, permanently
hung the entire `extractFrames()` loop; now resolves anyway after 3s (deliberately not a rejection —
a slightly-off frame is a better outcome than failing the whole capture). Recording and file-upload
gained mutual exclusion in the SAME capture modal (both controls visible at once; nothing stopped
starting one while the other's `processVideo` pipeline was still running) via a `processing` flag set
at `processVideo`'s entry and cleared in a `finally` — guaranteed to reset on every exit path so one
stuck pipeline can never permanently lock out every future attempt.

⚠️ **Found and fixed beyond the original scope, because reading `homographyBetween` while fixing the
Switch-camera guard surfaced it: worse than the bim.js Mat leaks above.** Its two
`detectAndCompute()` mask arguments were anonymous `new cv.Mat()` literals with **no variable ever
pointing at them** — a guaranteed leak of 2 WASM Mats on every single call, success or failure alike,
no exception needed (9 calls per 10-frame capture = 18 leaked Mats per capture, before any error
path). The function also had **no try/finally anywhere**, so a throw from any intermediate `cv` call
skipped the one unconditional cleanup line at the end entirely. Rewritten: every local Mat/vector
named, the whole body wrapped in try/finally, the returned `H` (when a real homography is found)
deliberately excluded from that cleanup list since the caller (`stitchFrames`) now owns and deletes
it. `stitchFrames`'s own per-frame `srcMat`/`dstMat`/`Hmat` trio got the identical fix.

### Deliberately NOT changed, and why

- **`openPinPickerFor`** (bim.js) — flagged as unreachable by the reviewing agent's strict analysis,
  but this is a documented, deliberate retained-API decision from an earlier prompt the same week
  (superseded as the Add/Edit Photo flow's own popup, kept reachable for anything that still wants
  it) — confirmed by `test.js`'s own existing assertion that the function exists. Not removed.
- **`BIM.hasPlans`** — exported, currently uncalled. A working, harmless, self-contained one-liner;
  removing it is speculative cleanup with no clear benefit, not a fix. Left alone.
- **`loadAllPins()`/`loadRegistrations()` (bim.js) and `removeSlide`/`removePano`'s un-checked
  storage-remove result** — all match this app's own established convention (documented repeatedly
  elsewhere in this codebase's history): PRIMARY data fetches toast on failure, SECONDARY/supporting
  fetches and best-effort storage cleanup fail silently, to avoid toast spam when the primary content
  is what actually matters. Confirmed as the deliberate pattern, not a gap, before leaving them as-is.
- **`pano.js`'s dead `screen`/`viewPanoId`/`compareIds` state and `openCompareModal`** — the Compare
  viewer is confirmed fully unreachable (its own topbar button, `#pano-compare-btn`, was removed
  earlier this week and `test.js` already asserts it's gone), so its own un-disposed viewer and lack
  of backdrop-close handling can literally never trigger in production. Left as retained-but-dormant
  code (matching the "greyed out, not deleted" pattern this session already uses for 360°/3D) rather
  than risked touching for a leak that can't fire.
- **`recon.js`'s lack of live/polling status updates** — a real completeness gap (a request left open
  won't reflect a completed job until manual reload), but a genuinely bigger feature, not a bug fix;
  flagged for a future pass rather than built here.

### Verification

`node --check` clean on all five JS files + `test.js` itself; 0 NUL bytes and CSS braces balanced
(393/393) on every touched file; 0 duplicate DOM ids in `index.html`; function-set diff against the
pre-audit commit shows **only the intentional new additions** (`openPhotoById`, and each file's own
`close`/`finish` helpers) — nothing else lost or duplicated. Suite: **483 → 568** (85 new checks).
Several fixes are proven by genuine execution, not just structural reads: `openPhotoById`'s miss-and-
toast path, `_leavePhotosScreen`'s DOM effects, `bim.js`'s `signPlanUrls` network-failure recovery,
the `wireStageInteractions` listener-count-stays-flat-across-repeated-renders proof, `renderPreview`'s
stale-`selId` self-correction across three scenarios, `retractRequest`'s full race-condition matrix
(and the harness bug it caught), and the WCAG contrast maths computed from the real CSS. Where genuine
execution wasn't proportionate (pano.js's H1/H2, recon.js's H3, the bim.js/pano.js `cv.Mat` fixes —
each would need a fairly involved fake `MediaRecorder`/`getUserMedia`/`cv` global for marginal
additional confidence over a precise structural read), that trade-off is stated in the test file
itself, matching this module's own established convention for exactly this class of limitation.

⚠️ **Standing caveat, unchanged**: no signed-in click-through is possible in this environment — the
same limitation every prior pass on this module has recorded. Everything above is verified by code
execution, structural proof, or measured/computed values; nothing here has been confirmed against a
live Supabase session or a real browser DOM.

`?v=` bumped: `module.css/js`, `bim.js`, `ppr.js`, `pano.js`, `recon.js` → `20260830a`; `MODULE_V`
(via `modules-grid.js?v=` in `dashboard.html`/`modules.html`) → `20260830a`.

## Second feedback round, part 5 (items 15, 16): Map/Stack RELOCATED from the Plans tab to the Gallery, floor-stepping added, Stack re-defaulted to combine (2026-08-29)

Owner: *"In the Plans tab, no need for the map and the stack. this should only be all plans"* and
*"In the Gallery tab, aside from List View and Tile View, this is where we should app Plan View and
Stack View… choose month, step through months, animate through months… choose floor, step through
floors, animate through floors… \[Stack\] default is that the photos in the same location combine
across all months, but there should also be option to step through and animate through months."*

⚠️ **This is a relocation, not a rebuild.** Batch G's earlier Map/Stack modes (bim.js's `screen2`
toggle) already did most of what's asked — they are moved wholesale into module.js as two new
Gallery view modes, and only then extended with the genuinely new pieces (floor stepping; the
combine-by-default reversal). Function-diff confirms it: `bim.js` **19 functions lost, module.js 20
gained**, all matched relocations.

### Item 15 — bim.js's Plans tab goes back to being just plans

`screen2`, `viewToggleHTML`, and the whole Map/Stack render branches are deleted from bim.js.
`render()` is back to two states: "no plans yet" and the ordinary Plan browsing/pinning/pan-zoom/
registration view — exactly what the screen's own name says. `openPinPickerFor` (the Gallery
upload-time pin picker), the pin+direction field (item 11), and Batch H's registration flow are all
untouched — item 15 only asked to remove Map/Stack, nothing else on this screen.

- **New read-only exports** so module.js can reach floor-plan data without disturbing this screen's
  own state (`activePlanId`, pan/zoom) — the same "self-contained, never touches this screen's
  state" rule `openPinPickerFor` already follows: `plans()` (sorted by `level_order`), `planUrl(plan)`,
  `pinsForPlan(planId)` (reads the project-wide `allPins`, already loaded on every project switch
  regardless of which tab is open).

### Item 16 — Plan view and Stack view join List/Tile in the Gallery

`view` gains `'plan'`/`'stack'` alongside `'list'`/`'gallery'` (the `.pd-viewtoggle` row gains two
buttons). Both read **project-wide** data (every pin / every location-tagged photo), not the
Gallery's own filtered `list` — the same scope their bim.js originals always had — so `render()`
branches to them BEFORE the row/filter empty-state checks that describe the filtered grid.
Group-by is hidden while either is active (it has no meaning for a floor-plan cluster or a
Location-Breakdown grid).

**Plan view** — ported `mapClusters`/`itemDateFor`/the month stepper verbatim (grid-snap clustering
at ~5% cells, deliberately not proximity/k-means, for the same frame-to-frame stability reason);
`openClusterList` opens a member list rather than jumping into one item (ambiguous which one a
multi-item cluster "means"), same as before.
- ⚠️ **The floor stepper is the genuinely NEW capability** the old Map view never had — it only ever
  showed one plan, chosen from a bare `<select>`, with no way to step or animate between them.
  Prev/next buttons plus an "Animate floors" play button now step through `BIM.plans()`'s own
  `level_order` sequence. Floor animation and month animation are mutually exclusive — starting one
  stops the other, so there is never more than one `setInterval` ticking in the background, the same
  discipline the original Map/Stack toggle enforced between each other.
- Clicking a cluster's item dispatches by type: a photo opens THIS module's own lightbox directly
  (no round-trip through bim.js); panoramas/reconstructions still go through `PANO.open`/
  `RECON.openById`, unchanged.

**Stack view** — ⚠️ **the default is REVERSED from bim.js's original.** The old Stack always showed
the single most-recent-as-of-cutoff photo per Location Breakdown cell (`mostRecentAsOf`). The owner's
own wording — *"the photos in the same location combine across all months"* — asks for the opposite
as the default: every cell now shows every matching photo (capped at `STACK_COMBINE_MAX = 6`
thumbnails with an explicit **"+N more"**, never a silent truncation), and month step-through is
demoted to an opt-in **"Step through months instead"** checkbox that restores the old cutoff-driven
single-photo behaviour (with its own prev/next/play stepper and hover-magnifier, ported unchanged).
- ⚠️ `stackGrid`'s cell now carries BOTH `photos` (the full combined list, item 16's default) and
  `photo` (the step-mode single resolution) — computed together so switching the toggle needs no
  re-derivation, and so a regression in one can never silently break the other without a test noticing.
- Combined-mode thumbnails open the ordinary lightbox on click (consistent with every other photo
  thumbnail in this module); step-mode keeps the read-only hover-magnifier, since a single "the"
  photo for a cell is a different kind of view than a list of several to pick from.
- Row/column level pickers, the single-level "All" column collapse, and the "only the first TWO
  location levels drive the grid" scope note are all unchanged from the original.

### Verified

**483 checks green** (was 477), section `[29]` rewritten in full against the relocated `PP.*` hooks
(`_mostRecentAsOf`, `_stackGrid` — now additionally asserting the combined `photos` field alongside
the legacy `photo` field, `_planClusters`, `_itemDateForPin`) rather than the retired `BIM.*` ones;
`[28]`'s old Batch-G map subsection replaced with a one-line confirmation that bim.js no longer
carries any of it. Function-diff against HEAD: `bim.js` **19 lost / 0 added** (`viewToggleHTML`,
`itemDateFor`, `activePlanPins`, `mapMonthsAvailable`, `mapClusters`, `renderMapBody`, `wireMapView`,
`stopMapPlay`, `openClusterList`, `stackLevels`, `stackRowLevel`, `stackColLevel`, `stackPhotos`,
`stackMonthsAvailable`, `mostRecentAsOf`, `stackGrid`, `renderStackBody`, `wireStackView`,
`stopStackPlay` — every one relocated, none simply deleted); `module.js` **0 lost / 20 added**. 0 NUL
bytes across every touched file, CSS braces balanced (394/394 — the old `.bim-viewtoggle`/
`.bim-cluster`/`.bim-stack*` rules renamed to `.pp-plan*`/`.pp-stack*` in place, no orphaned dead CSS
left behind), 0 duplicate `id=` attributes in `index.html` (72 total, up from 67).

⚠️ **Not verified signed in** — same standing caveat as the rest of this module. In particular: the
floor-stepper's real click-through against a project with several floor plans, the combined Stack
cell's real thumbnail layout, and both animation timers' actual on-screen behaviour are verified
structurally and by genuine unit execution of the pure logic, not by driving the real DOM.

`MODULE_V` → `20260829o`; `module.css/js` / `bim.js` → `?v=20260829o`.

## Second feedback round, part 4 (item 13b confirmed, item 14 built): Presentations multi-select + batch Download/Archive/Merge, combined preview (2026-08-29)

Owner's item 13b — *"in the presentation list view, by default no presentation should be selected;
if a presentation is selected, only then should the preview show up"* — was already true, confirmed
by reading `selId`'s only assignment (inside `openPpr`, i.e. on open, never on a bare row hover) and
`renderPreview`'s own guard (`!selId` → "Select a presentation to preview its slides."). No change.

**Item 14** — *"there should also be option to select multiple PPRs. previews will then combine all
the PPRs. in a task bar, there should [be] the option to batch download, archive, merge"* — genuinely
new, built from scratch.

- **A checkbox per row, plus a header select-all/unselect-all tickbox** — the exact same shape this
  module already uses for the Gallery's own List header (item 4), reusing `.pp-selcell`'s sizing/
  centering rather than a near-duplicate class. ⚠️ **Deliberately a SEPARATE state from `selId`** —
  `selId` means "this one presentation is open"; `selectedPprs` is the batch-action set, and checking
  one never opens it (the checkbox click stops propagation via the row's own `.pp-selcell` guard, the
  same pattern Gallery's `[data-rowopen]` handler already documents).
- ⚠️ **Scoped to the currently VISIBLE (filtered) set, not the raw map** — `visibleSelectedPprIds()`
  intersects the selection with `visiblePprs()`, so toggling "Show archived" can never let a batch
  action silently reach a presentation the list no longer shows. Same rule Gallery's own
  `visibleSelectedIds()` documents, applied here for the first time in ppr.js.
- **The selection toolbar swaps in for "+ New Presentation"** exactly like the Gallery's own
  selection-mode swap (`syncChrome`) — one `hasSel` flag drives every element, so the two states can
  never both show. Re-synced on every `renderList()`, not only on a checkbox click, since a filter
  toggle changes what's visible without touching the selection map itself.
- **Checking 2+ presentations takes over the preview pane**, showing every selected presentation's
  slides grouped under its own date/description heading, oldest first — `renderCombinedPreview`.
  ⚠️ **Deliberately read-only**: clicking a thumbnail here does nothing (no `data-slide`/`onclick`),
  since which of several open presentations a click should land in is ambiguous by construction; the
  single-presentation preview below it keeps its click-to-jump-to-slide behaviour unchanged.
- **Batch Download** loops the SAME three exporters (`exportOffline`/`exportPptx`/`exportPdf`) a
  single presentation's own Download button already uses, one format chosen for the whole batch, with
  the same 300ms stagger the Gallery's own batch download already established (a burst of
  near-simultaneous programmatic downloads is exactly what some browsers throttle or block).
- **Batch Archive toggles the whole selection ONE direction** (`archiveDirectionFor` — majority-or-tie
  active → archive, majority archived → restore) rather than a per-row toggle, which has no single
  well-defined "next state" for a mixed selection. Genuinely executed by a test across four cases
  (all-active, all-archived, a 50/50 tie, a 2-of-3 majority) — the exact class of silently-flippable
  logic this module's `directionDegFromDrag`/`deriveTradeForWorks` already earn the same treatment for.
- **Merge** copies every selected presentation's slides — **by reference** (`before_photo_id`/
  `after_photo_id`/captions/trade/works/location), never duplicating a photo, matching item 13a's own
  rule that a presentation never owns a copy of a photo — into ONE new presentation, in date order,
  renumbered **continuously** across all sources (never reset per source, so the merged deck reads
  front-to-back with no numbering gaps). ⚠️ **The source presentations are ARCHIVED afterward, never
  deleted** — a merge must not be able to lose history, and archiving is the retirement mechanism this
  module already uses everywhere else. A slide-copy failure AFTER the new presentation was already
  created is reported by name rather than silently leaving an empty deck behind. A completed merge
  opens the new presentation directly, the same courtesy an ordinary "+ New Presentation" already gives.

### Verified

**477 checks green** (was 458), new `[34]` section — structural coverage of the whole flow, plus
genuine execution of `archiveDirectionFor` across four cases (the one piece of new logic here that is
silently reversible with nothing in the UI to catch a flipped comparison). One pre-existing test
updated for the row-click guard's new shape (excluding clicks that start on the new checkbox), the
same "healthy churn from an intentional change" this file's own log already follows. Function-diff
against HEAD: `ppr.js` **0 lost / 7 added** (`selectedPprIds`, `visibleSelectedPprIds`,
`archiveDirectionFor`, `archiveSelectedPprs`, `openMergeWizard`, `openBatchDownloadChoice`,
`renderCombinedPreview`). 0 NUL bytes, CSS braces balanced (388/388), 0 duplicate `id=` attributes.

⚠️ **Not verified signed in** — same standing caveat as the rest of this module; the merge's real
DB writes (creating a presentation, copying N slides, archiving M sources) and the combined preview's
actual layout are verified structurally, not against a live project.

`MODULE_V` → `20260829n`; `module.css` / `ppr.js` → `?v=20260829n`.

## Second feedback round, part 3 (items 12, 13a): markup was already fully built — the entry point wasn't discoverable (2026-08-29)

Owner: *"you also still havent added the option to add mark-up including pencil, eraser, shapes,
common icons, text boxes to the media"* and *"mark-ups for photos in presentation should also be
possible but presentation should not directly attach to the photo."*

⚠️ **Checked the actual shipped code before building anything, and both asks were already fully
satisfied** — by the earlier same-day Batch F (see the `[28]` entry below): `openMarkupEditor`
offers exactly `pen` / `rect` / `circle` / `arrow` / `text` / `icon` (four stamps: warn/arrow/
person/equip) / `erase` (a real vector hit-test-and-remove, not a paint-transparent hack), and
`ppr_slide_markups` is a table SEPARATE from `progress_photos.markup`, keyed by `(ppr_slide_id,
pane)` — exactly "should not directly attach to the photo." Nothing to build.

**So why did it read as missing?** The most likely explanation, given this button's placement: the
photo-level editor's ONLY entry point was a bare palette icon, one of five crammed into the
lightbox's top-left toolbar, with nothing but a hover tooltip. Two other candidate explanations
were considered and are the standing caveats of this whole module — a stale cached build (this
repo's single most common false-alarm "missing feature" report, per its own extensive history),
and the button's `canWrite`-gated visibility (only `super_admin`/`admin`/`planner` roles ever see
it, matching every other edit affordance here) — but the icon-only presentation is the one thing
worth fixing regardless of which was the actual cause.

- **`#pp-lb-markupedit` now carries a visible "Markup" text label** (`.pp-lb-tool-labeled`, widened
  from the fixed 38×38 icon square), with a fuller tooltip naming the toolset. The presentation
  pane's own smaller markup buttons (`.ppr-mktool`, 26px, one per pane corner) are left icon-only —
  adding a label there risks overflowing a narrow pane, and they sit directly under an already
  prominent "Previous"/"Current" label, a materially less crowded context than the lightbox's
  five-icon row.

### Verified

**458 checks green** (was 451), new `[33]` section reconfirming the full tool coverage against the
shipped source (genuinely nothing missing) plus the new label. CSS braces balanced (381/381), 0 NUL
bytes, 67 `id=` attributes in `index.html` (unchanged count — only an existing button's content
grew).

`MODULE_V` → `20260829m`; `module.css` → `?v=20260829m`.

## Second feedback round, part 2 (item 18): fixing the 360° recording UX (2026-08-29)

Owner: *"the 360 feature of the app is also not working well, I can't take videos very easily. Please
fix."* Investigated the actual `openCaptureModal` recording step (not the stitching pipeline, which
was never the complaint) and found the friction was real, structural, and fixable without touching
anything downstream of the recorded blob:

- ⚠️ **Two deliberate taps where one would do.** "Use camera" only requested permission and showed a
  preview; a SECOND, previously-hidden "Start recording" button then had to be tapped separately.
  Collapsed into one: `getUserMedia`'s permission prompt is itself triggered from the SAME click
  handler as `MediaRecorder.start()`, since the click that fires it already is a valid user gesture —
  there's no reason two gestures were ever needed.
- ⚠️ **No visible "you are recording" cue at all** — the only signal was the button's text flipping
  from "Start recording" to "Stop recording". A pulsing red dot + a running `mm:ss` timer
  (`.pano-recind`, `fmtTime`) now overlay the camera preview the whole time recording is active.
- ⚠️ **No duration guidance, so a forgotten recording could run indefinitely.** `MAX_REC_SECONDS = 90`
  auto-stops it (generous for a slow spin) with a toast naming why, rather than letting a raw 20-minute
  clip reach the frame-extraction step and fail confusingly downstream.
- **A camera-switch control** (`facing` toggling `'environment'`/`'user'`) — the old flow hard-coded
  the rear camera with no way to pick the front one. Refused mid-recording (swapping the underlying
  `MediaStream` under an active `MediaRecorder` would silently corrupt the capture).
- **Camera-access failures now name the escape hatch** ("… you can upload a video instead") rather
  than a bare error with no next step.
- ⚠️ **Real pre-existing bug fixed as part of this: Cancel/× never stopped the camera.**
  `openModal()`'s `[data-close]` buttons were bound to the plain `m.close` before any stream/recorder/
  timer existed, so cancelling mid-capture left the camera running in the background with no way back
  through the UI short of reloading the page. The buttons are now re-wired to stop the stream, the
  recorder, and the timer first. ⚠️ **That fix introduced its own hazard, caught before shipping**:
  forcing `recorder.stop()` on cancel still fires its async `onstop` → `processVideo(blob)` handler
  AFTER the modal (and its `#pano-c-status` element) are gone, which would throw reaching for a null
  element mid-write. A `cancelled` flag makes `processVideo` bail immediately in that case.

### Verified

**451 checks green** (was 440), new `[32]` section — structural, matching this module's own
established limitation for `getUserMedia`/`MediaRecorder`-dependent code (no fake DOM here can drive
a real camera stream; Phase 3's OpenCV.js stitching remains the one piece of this module verified in
a real browser with a real WASM/WebGL stack). Function-diff against HEAD: `pano.js` **0 lost / 5
added** (`fmtTime`, `stopCameraStream`, `startCamera`, `startRecTimer`, `stopRecTimer`). 0 NUL bytes,
CSS braces balanced (380/380).

⚠️ **Not verified signed in** — same standing caveat as the rest of this module; in particular, the
actual recording UX (does starting the camera really feel like one tap now, does the pulsing
indicator read clearly on a real phone screen in daylight) needs a real device to confirm, not just
source-level checks.

`MODULE_V` → `20260829l`; `module.css/js` / `pano.js` → `?v=20260829l`.

## Second feedback round, part 1 (items 9, 11, 17): Works becomes one schedule tag, camera pin+direction move inline, 360° re-enabled (2026-08-29)

Owner sent a further 10-item list (numbered 9–18, continuing the prior round). This entry covers
the three items landed first; the rest follow in later entries the same day.

### Item 9 — Works is now ONE schedule-derived tag; Trade is derived, not picked

⚠️ **Reverses this same day's earlier Batch B**, which had turned Trade and Works into two
multi-select checkbox groups. The owner tried that shape and asked for the opposite: *"instead of
selecting trades and works as multiple selection, add a works tag to the media, get the works
choices from the schedule module."* `tradesOverlayHTML`/`worksOverlayHTML`/`multiCheckHTML`/
`readMultiCheck`/`wireTradeWorks`/`refreshWorksOverlay`/`wireWorksAddButton` are all deleted —
superseded, not left dormant.

- **Works is one `<select>`** (`worksTagFieldHTML`), sourced from `worksOptions()` — the SAME
  schedule-derived + previously-captured union that fed the old checkbox group, just rendered as a
  single choice instead of many. A trailing "+ Add custom value…" option still escapes to a
  free-text prompt for anything the schedule doesn't know about yet.
- **Trade is no longer a field at all.** `deriveTradeForWorks(worksValue)` reverse-looks-up the
  picked Works value against the project's own schedule activities (case/whitespace-insensitive
  name match), reads that activity's `work_type`, and resolves it to a Trade via the SAME
  `workTypeMatchesTrade`/`TRADE_WORK_TERMS` table the schedule-scoping code already used. ⚠️ **No
  match derives no trade** — a custom/free-text Works value, or one typed before the schedule
  existed, correctly carries no trade rather than a guessed one.
- `trades`/`works_multi` (the real array columns) still get written — just with at most one
  element now — so every downstream reader (`tradesOf`/`worksOf`, Gallery's trade/location
  grouping, the trade/works filters) keeps working completely unchanged. `requiredFieldsMissing`
  drops its separate Trade check; Works alone is required.

### Item 10 — location choices from the schedule module: already true, confirmed rather than rebuilt

Checked before touching anything: `distinctLocValues(levelId, priorVals)` already scans
`SCHED_ACTS` (the project's own `project_schedule.location` jsonb, loaded in `loadSchedule()`) to
build each level's datalist suggestions — location has been schedule-derived since before this
feedback round. Left as an `<input>` + `<datalist>` per level (not a hard `<select>`), matching
Project Schedule's own documented convention for this exact feature: typing an unlisted value must
stay possible, or a genuinely new location (not yet in the schedule) could never be recorded. No
code change for this item.

### Item 11 — camera pin + direction move INLINE into the Add/Edit Photo form

Owner: *"for key plans, save plans in the floor plan tab; once the floor plan is uploaded, get
floor plans from that database; then in the add media workflow, add location of camera as well as
the direction and angle of the POV."*

⚠️ **This retires a whole prior mechanism, not just adds a new one.** The Add/Edit Photo form had
its own ad-hoc "Key plan" field (`keyPlanFieldHTML`/`uploadKeyPlanFile`/`distinctKeyPlans`/
`openKeyPlanWizard`) that re-uploaded a bare reference IMAGE per photo, with no notion of a
position or a facing direction, and was entirely separate from `bim.js`'s real `floor_plans`
database. That whole block is deleted. `progress_photos.key_plan_url` stays in the schema
untouched (no migration) — nothing new writes to it, but `ppr.js`'s own `keyPlanPathFor` still
reads it, so a presentation slide built from a photo captured **before** this change still shows
its key-plan overlay exactly as before; only the write path moved forward.

- **New embeddable field, in `bim.js` (`pinFieldHTML`/`wirePinField`/`readPinField`/
  `savePinForItem`)** — the SAME capability `openPinPickerFor`'s modal already had (pick one of the
  project's real floor plans, click a point, drag a direction via the existing
  `directionWidgetHTML`/`wireDirectionWidget`/`directionDegFromDrag`), but rendered as HTML embedded
  directly into module.js's own form instead of a popup shown after the fact. `openPinPickerFor`
  itself is untouched and still reachable — only the Add/Edit Photo flow stopped calling it.
- ⚠️ **Captured ONCE per upload batch and applied to every uploaded item**, not just the first — a
  batch of photos taken from one spot all share that camera position, and now that the field lives
  in the form (rather than being an afterthought representing "the whole batch" via a single
  photo), there's no reason to shortchange the rest of the batch.
- ⚠️ **`readPinField` returning `null` is a no-op, deliberately** — the field has no "clear the
  pin" affordance (add-or-move only), so a blank field can only honestly mean "the planner didn't
  set one," never "please delete the existing pin." `savePinForItem` therefore never deletes;
  editing a photo that already has a pin can move it but not remove it through this form.
- `savePinForItem(itemType, itemId, pinData)` is an **upsert** — it looks up any existing pin for
  that item first and UPDATEs it rather than inserting a second row, so re-opening Edit and moving
  the pin doesn't accumulate duplicate `floor_plan_pins` rows for one photo.
- The Edit form pre-fills from `BIM.pinInfoFor('photo', r.id)` and — important ordering detail —
  reads the field's live value **before** `m.close()` runs, since the modal's DOM (and the pin
  field inside it) is gone the instant it closes.
- `pinFieldHTML` degrades to a plain hint ("upload one on the Plans tab") when the project has no
  floor plans yet, rather than rendering a picker with nothing to pick from.

### Item 17 — Add Media offers Photo / Video / 360° / 3D; only 3D stays disabled

Was Photo/Video plus a single disabled "360° / 3D" button. Now four distinct buttons — 3D alone is
disabled ("3D reconstruction is on hold"); 360° is live, since item 18 (next entry) fixes the
capture flow it delegates to.

- ⚠️ **Picking 360° does not try to represent a recording/stitching pipeline inside this form.** It
  closes the Add Media modal and calls `PANO.openCapture()` — a new one-line export
  (`openCapture: function () { openCaptureModal(); }`) that is, as of this change, **the only
  reachable entry point into 360° capture at all**: the earlier Gallery-simplification pass removed
  the standalone `#pano-new` topbar button entirely, leaving `openCaptureModal` unreachable from
  the UI until this delegation was wired back up.

### Verified

**440 checks green** (was 423), new `[31]` section covering all three items, plus updates to the
now-superseded Batch B ([1/2], [2], [2b]) and key-plan-wizard ([6], [11]) sections rather than
deleting them outright — the same "healthy churn from an intentional change" precedent this file
already follows. Genuinely EXECUTED via test-only hooks (not just regex-matched): `deriveTradeForWorks`
against five cases (a real schedule match, case/whitespace insensitivity, no match, a matched
activity with no `work_type`, and a blank Works value) — the exact kind of silent-wrong-data risk
(`directionDegFromDrag`'s own comment states the same principle) that deserves genuine execution
rather than only being read. Function-set diff against the pre-change commit: `module.js` **14 lost
/ 4 added** (all losses are the retired checkbox-overlay and key-plan-wizard machinery, all
intentional); `bim.js` **0 lost / 7 added**; `pano.js` **0 lost / 0 added** (the new export is a
property, not a named `function` declaration). 0 NUL bytes across every touched file, CSS braces
balanced (374/374, two dead rule blocks removed alongside their JS), 0 duplicate `id=` attributes.

⚠️ **Not verified signed in** — no live Supabase login in this environment, same standing caveat as
the rest of this module. In particular: the pin field's real click-to-place + drag-to-direction
interaction, the schedule-name reverse-lookup against a real project's activities, and the 360°
delegation's actual hand-off are all verified structurally/by genuine unit execution, not by
driving the real DOM.

`MODULE_V` → `20260829k`; `module.css/js` / `bim.js` / `pano.js` → `?v=20260829k`.

## Gallery screenshot follow-up: toolbar simplification, a real `.pp-selbar` bug, download formats, unified grouping, mobile filters (2026-08-29)

Owner sent a phone screenshot of the Gallery screen with eight numbered items. Two of them
(items 3 and 4) turned out to explain a real defect visible right there in the screenshot — the
selection bar reading "0 selected" with nothing selected — rather than being pure feature asks.

### Item 2 — one "+ Add media" button, capture buttons removed

`+ Capture 360°`, `Compare over time` and `+ Request 3D scan` are gone from the topbar entirely.
⚠️ **This is a further step past the 2026-08-29 "folded into Gallery" change**, which had moved
those three buttons FROM their own tabs ONTO this row — the owner's follow-up says the row itself
should only ever need one button. `pano.js`/`recon.js`'s capture functions
(`openCaptureModal`/`openCompareModal`/`openRequestForm`) are left defined but are now
**unreachable from the UI**, the same "on hold" treatment 360°/3D already gets in the Add-media
type picker's disabled option. Existing captures still show and open from the media strip below
the grid — only the ability to start a *new* one from this row is gone. `PANO._syncTools`/
`RECON._syncTools` are no longer called (the buttons they toggled don't exist any more); the
functions themselves are untouched in case 360°/3D work resumes and needs them again.

### Items 3 + 4 — the selection bar's real bug, and its move into the topbar

⚠️ **The screenshot's "0 selected" was not a display-logic bug — it was a CSS specificity trap.**
`refreshSelBar()` correctly did `bar.hidden = !ids.length`, but `.pp-selbar { display: flex; ... }`
in module.css sat at the exact same specificity as the browser's own `[hidden] { display: none }`
rule — and an **author** stylesheet rule always wins over a **user-agent** one at equal
specificity, regardless of what the `hidden` *attribute* says. So the bar rendered "0 selected"
permanently no matter what the JS did. Confirmed by reading the actual CSS, not guessed.

Fixed by removing the whole boxed bar and moving its three actions (Download / Add to
Presentation / Archive) into the topbar tools row instead — toggled via an explicit
`style.display` in `syncChrome()`, never the `hidden` attribute, which sidesteps the entire bug
class rather than patching this one instance of it. `syncChrome()` (previously role-visibility
only) now also decides, from one `has = visibleSelectedIds().length > 0` flag: **0 selected** →
"+ Add media" + Refresh show, the selection tools hide; **N selected** → the reverse, plus a
"N selected" count. Exactly one of the two states is ever visible, because both are driven off
the same flag in the same function.

### Item 4 (continued) — select-all/unselect-all replaces "Clear"

The List grid's leading header cell (previously a blank spacer, kept only so header/body column
counts matched) is now a real `#pp-selall` checkbox: checked when every currently-visible row is
already selected, and toggling it selects/deselects the whole **visible** set — the same scoping
rule `visibleSelectedIds()` already enforces elsewhere in this file, so a selection made under one
filter can't be silently bulk-cleared by a header checkbox acting on a since-changed filter's full
row set. The separate `pp-sel-clear` button is gone; this replaces it. Gallery/tile view has no
equivalent header (there's no header row concept for a tile grid) — deselecting there is still
per-tile, matching what was actually asked ("the table column header").

### Item 5 — batch Download asks HTML / PDF / PPTX

The old batch Download looped the single-photo `download(r)` (raw file downloads, one per
selected photo, staggered 300ms apart). It's now `openBatchDownloadChoice(ids)` — reusing
ppr.js's own `.ppr-fmtchoices` markup/CSS **verbatim** (its `openDownloadChoice` for
presentations) so "pick a format" looks and behaves identically everywhere in this module — then
one of three new exporters: `exportSelectedOffline` (self-contained HTML), `exportSelectedPdf`
(html2pdf, one photo per A4 page), `exportSelectedPptx` (PptxGenJS, one photo per slide).
- **A lean, self-contained copy of ppr.js's own image-embedding machinery**
  (`dlToDataURL`/`dlBlobToImage`/downscale-to-1600px-JPEG-q0.82), not a cross-file reach into
  ppr.js's private closure — this file's own established convention (see `reqMark()`'s comment)
  for small helpers restated per independently-loaded file. All three formats share ONE
  `collectPhotoImages(list, onProgress)`, so they can never embed a different picture of the same
  selection.
- ⚠️ **The PDF export's captured element stays in NORMAL FLOW**, following issues-lessons'
  2026-08-22 lesson to the letter: `position:fixed`/`absolute` on the node html2pdf rasterises
  gives html2canvas a real width and a height of **zero** — a byte-identical blank PDF with no
  error. The off-screen parking lives on a `holder`; the captured `wrap` sits in normal flow
  inside it.
- ⚠️ **PptxGenJS's `data` option takes the payload WITHOUT the `data:` prefix**
  `canvas.toDataURL()` always adds — `stripDataPrefix()`, same fix ppr.js's own PPTX exporter
  already needed.
- The caption block (`dlCaptionLines`) is one function feeding all three formats: description,
  then trade·works·location, then the capture date — blank fields dropped rather than rendered as
  empty lines.

### Item 6 — List and Gallery share ONE grouping mechanism

Previously List always grouped by Trade (fixed, no picker) and Gallery had its own separate
Month/Year/Location/Activity picker — two mechanisms, two states. Owner: *"provide option to
group by trade or by location or by month... same grouping as the tile view... both no need for
the group by year."* Unified into one `groupRows(list)` fed by one persisted `galleryGroupBy`
(`month` default | `trade` | `location`) and ONE static `#pp-groupby` selector living in the
shared list bar — **Year and Activity are both dropped**, not just Year (neither was named in the
owner's three-option list). `groupByTrade`/`galleryGroupKey`/`galleryGroupLabel`/
`groupForGallery` are gone, replaced by `groupKeyOf`/`groupLabelOf`/`groupRows`.
- ⚠️ **A real, pre-existing bug found by this pass's own genuine-execution test**: the month/year
  sort was a plain `b.localeCompare(a)` with no "Undated" exclusion, so an undated photo's bucket
  — starting with 'U', which sorts after every digit — came out **first** in a "newest month
  first" ordering, reading as the most recent capture when it is actually unknown. This existed in
  the ORIGINAL `groupForGallery` too, just never caught because no prior test's month-mode fixture
  included an undated photo. Fixed: `Undated`/`Untagged`/`Unassigned` are now one shared trailing
  set across all three modes, checked before the mode-specific comparator ever runs.

### Item 7 — List loses its per-row action icons; the row itself opens the lightbox

The trailing actions column (download/view/edit/delete icons, one `rowActions(r)` call per row)
is gone — `rowActions()` itself is deleted. The List grid drops from 8 columns to 7
(`grid-template-columns` trimmed to match; `min-width` reduced accordingly). Clicking anywhere on
a row (except the checkbox cell) now opens the lightbox, whose existing download/edit/delete
cluster covers what the row icons used to. This matches Gallery/tile view's own 2026-08-28 rule
("no inline action icons... download/view/edit/delete all live in the lightbox") — the two views
are consistent again.

### Item 8 — filters collapsed by default on a phone

`.pp-filters` gained a `#pp-filttoggle` button (desktop-invisible) and a `#pp-filters-body` wrapper
around the actual controls. ⚠️ **`display: contents` on the wrapper is the SAME trick this app's
own module-topbar wrapping already relies on** (`dashboard.css`'s `.pd-tb-main`/`.pd-tb-tools`) —
on desktop/tablet the wrapper is invisible to layout, so this is byte-for-byte the old always-open
row above the phone breakpoint; only below 700px does the body default to `display:none` until
`.pp-filters` carries `.open` (toggled by a plain click handler).

### Verified

**423 checks green** (was 395 before fixing 10 assertions this batch's changes correctly broke,
then adding new coverage — see below). Ten pre-existing assertions were UPDATED, not just made to
pass: each encoded a behaviour this pass deliberately changed (row actions existing, Year/Activity
grouping, the pano/recon topbar buttons, the blank header spacer, the boxed `#pp-selbar`) — the
same "healthy churn from an intentional change" this file's own 2026-08-29 rename entry already
established as the right way to read a batch of assertions changing at once.

New `[30]` section covers every item above, genuinely EXECUTED where the logic is pure — via new
test-only hooks `_groupRows(list, mode)` (save/restore `galleryGroupBy` around an injected mode)
and `_dlCaptionLines(r)` — plus structural checks for everything DOM/state-heavy that would need
`PP.init()` against a fake session to drive for real (the selection-mode swap's `syncChrome()` in
particular; same trade-off this file already accepts for Batch G's map/clustering).

Function-diff against the pre-batch commit: **6 lost, all deliberate** (`groupByTrade`,
`galleryGroupKey`, `galleryGroupLabel`, `groupForGallery`, `rowActions`, `refreshSelBar` — each
superseded by name above), **15 added**. 0 NUL bytes; CSS braces 380/380; all four touched files
parse; 0 duplicate `id=` attributes in `index.html`.

⚠️ **Not verified signed in** — same standing caveat as the rest of this module. In particular:
the three export formats have never had their output opened in a real viewer (only the embedding/
flow-safety logic is verified, the same gap this file's PPR export work has always had), the
mobile filter toggle's actual tap behaviour hasn't been seen on a real phone viewport, and the
select-all checkbox's real DOM interaction (vs. the structural regex check here) is unverified.

`MODULE_V` → `20260829j`; `module.css/js` → `?v=20260829j` (`ppr.js`/`pano.js`/`recon.js`/`bim.js`
untouched this pass, left at their prior `?v=`).

## Batch G completed: Vertical Stacking for photos (item 16) — and a real Map/Stack wiring bug found while adding it (2026-08-29)

Owner asked "what else is not done" after the Batches E–H push below. Re-checked the standing plan
item by item rather than trusting the earlier changelog entry, and found **Batch G was only half
built**: the plan lists TWO deliverables under it — item 15 (the floor-plan Map/clustering view,
built) and **item 16, a separate Vertical Stacking view for photos, which was never built at all**
(`grep -in "stack"` across `bim.js`/`module.js` found nothing but an unrelated undo-stack comment).
No migration.

### The real defect found in the course of adding it — Map was unreachable from a fresh load

⚠️ **`render()`'s Plan-mode branch never called `wireMapView()`.** That function is what wires the
Plan/Map toggle buttons themselves, plus "Register a top-view photo…" and the "Actual view"
checkbox — and it was only ever invoked from the `screen2 === 'map'` branch. Since `screen2`
**defaults to `'plan'`**, the Map button rendered on every fresh page load with **no click handler
at all**: pressing it did nothing, so Batch G's Map view (and Batch H's Register/Actual-view
controls) were **completely unreachable through the UI** despite being fully built and
structurally test-covered. The structural tests passed because they checked the functions *exist*,
never that every render path actually *calls* them.
- Fixed by adding the missing `wireMapView();` call to the Plan branch, and factoring the toggle
  markup into one `viewToggleHTML()` used by all three render branches so it can't drift again.
  `wireMapView()` is now called unconditionally from every branch — it already no-ops safely for
  the map-only stepper logic (`if (screen2 !== 'map') return;`), and each toggle button now stops
  whichever OTHER view's month-scrub timer might be running, so switching away from a playing
  Map/Stack view never leaves an orphaned `setInterval` ticking in the background.

### Vertical Stacking (item 16)

A third **Stack** option on the same Plan/Map toggle. ⚠️ **Deliberately independent of floor plans
entirely** — bands come from the project's own Location Breakdown (`location_levels` — the same
schedule-derived Tower/Level/Zone hierarchy the Add-photo form cascades through), not from a
floor-plan image or its pins. That's why it's reachable even when `plans.length === 0`, unlike Map,
which is meaningless without a plan to place pins on: a project can have Location-Breakdown-tagged
photos with zero floor plans uploaded, and this view still works for it.
- **Rows and columns are both PICKERS**, defaulting to the first two configured levels — not
  hard-coded to "Tower × Floor." ⚠️ **Scope reduction, stated rather than silently shipped:** only
  two levels ever drive the grid at once; a third (Zone, Orientation, …) is real detail a 2-axis
  table can't represent, and a project needing that resolution should use the ordinary Location
  filter on the Gallery grid instead.
- **A cell is the most-recent photo at that exact `(row, col)` location, "as of" a scrubbed month**
  — `mostRecentAsOf(list, cutoff)` is the one rule doing real work: cutoff `null` means "no limit,
  latest overall"; a cutoff month excludes anything captured after it. Pulled out as a small pure
  function specifically so it could be genuinely EXECUTED by a test, the same reasoning as every
  other "as-of" cutoff this app has already been bitten by once (the Manpower Loading
  `reportedThrough` family) — a wrong fallback here would report a photo as existing at a location
  before it was actually taken, or hide one that should already be visible.
- **An empty cell is `null`, never borrowed from a neighbouring cell or an earlier/later month** —
  asserted explicitly in the grid-builder test (a Tower/Floor combination with genuinely no photo
  stays empty rather than silently inheriting a neighbour's thumbnail).
- **Month scrub/Play reuses the exact shape** `mapMonth`/`mapPlaying`/`mapPlayTimer` already
  established for Map (null-is-live, a value is scrubbed, auto-stop-at-the-end) — kept as its own
  separate `stackMonth`/`stackPlaying` state rather than sharing the Map view's variables, so
  scrubbing one view's timeline never moves the other's, and switching views can cleanly stop
  only the timer that's actually running.
- **The hover-magnifier is a plain src-swap into a docked panel** — deliberately simpler than
  Project Schedule's own SVG-clone magnifier (2026-08-24), per the plan's own note: these cells are
  ordinary `<img>` thumbnails, so there's nothing to clone.
- `module.js` gained one new export, `locLevels()` (a copy of `LOC_LEVELS`), so the stacking view
  reads the exact same level *definitions* (id/name/sort_order) the Location Breakdown picker
  itself cascades through — never a second, possibly-drifting copy.

### Verified

**387 checks green** (was 364), new `[29]` section. Genuinely EXECUTED, not just regex-matched, via
two new test-only hooks:
- `BIM._mostRecentAsOf` against a 3-photo fixture across four cutoff cases (no cutoff, mid-way,
  before everything, an empty candidate list) — the exact "as of" decision a wrong fallback would
  get silently wrong.
- `BIM._stackGrid` against a hand-built 2-tower/2-floor fixture with one cell deliberately left
  photo-less: rows/columns sorted correctly, a cell with two competing photos resolves to the
  *later* one, the empty cell stays `null`, a cutoff correctly falls back to the earlier of two
  competing photos, and a single-level project collapses columns to one shared bucket.

Also verified structurally: the wiring-bug fix itself (a call-count assertion confirming
`wireMapView()` is now invoked from all 4 reachable branches, not 1), that Stack is reachable with
zero plans, and that switching views stops the other view's timer. **0 functions lost** against the
pre-fix commit (`bim.js` +11, `module.js` +1 — the latter under-counted by the name-set diff since
it's an object-literal property, not a `function name(` declaration; confirmed present by direct
read instead). 0 NUL bytes; CSS braces 378/378 (was 364); all four touched files parse.

⚠️ **Not verified signed in** — same standing caveat as the rest of this module. In particular, the
Map/Plan/Stack toggle's click-through has never been exercised in a real browser even after this
fix, since this environment has no live login; the bug was found by reading `render()`'s call
graph, not by clicking the button. **This is now the single highest-priority thing to click through
on the first live pass** — it is the one change in this entry that a structural test genuinely
cannot fully guarantee (DOM event wiring against a real render, not a fake one).

`MODULE_V` → `20260829i`; `module.css/js` / `bim.js` → `?v=20260829i` (`ppr.js`/`pano.js`/`recon.js`
untouched this pass, left at their prior `?v=`).

## Batches E–H + Add-media type/video: pin+direction, markup+slide-sorter, map view, top-view registration (2026-08-29)

Owner: *"do all the items not done including Batches E to H."* Closes every remaining item from
the standing plan (`C:\Users\gwsia\.claude\plans\elegant-mixing-mitten.md`) — the two smaller
follow-ups (the Add-media Photo/Video/360°/3D type selector, real video upload) plus the four
largest novel builds (E: per-photo pin + direction capture; F: the markup/annotation editor +
slide-sorter; G: the floor-plan map/clustering view; H: top-view photo → floor-plan registration
via OpenCV.js homography). **Run all four new migrations**:
`2026-08-29-photo-media-type.sql`, `2026-08-29-pin-direction.sql`, `2026-08-29-markup.sql`,
`2026-08-29-floor-plan-registration.sql`.

### Add-media: a real type selector, and video as a first-class kind

The upload modal gains a Photo / Video / 360°/3D segmented picker (`mediaTypeSelectorHTML`/
`wireMediaTypeSelector`), Photo default. Picking Video swaps the file input's `accept` to
video mimetypes and reuses **every existing field** (trade/works/location/pins) — a video is a
plain, unprocessed upload, with `progress_photos.media_type` (`'photo'|'video'`, no CHECK — the
enum lives in app code, same convention as `ppr_presentations.meeting_type`) the only new thing.
360°/3D stays visibly present but greyed with a tooltip ("on hold"), routing to the real
`pano.js`/`recon.js` flows the moment the owner re-enables them — nothing deleted, only gated.
- **`thumb()` renders a real `<video preload="metadata" muted playsinline>` + a CSS play-triangle
  overlay** for a video row, never an `<img>` — `preload="metadata"` so a grid of many videos
  doesn't each fetch its full clip just to show a frame.
- **The lightbox carries both `<img>` and `<video>` elements**, toggled by `media_type` —
  ⚠️ wrapped in a new `.pp-lb-imgwrap` (see Batch F below; the markup canvas needed something to
  position absolutely against, and neither media element had one before).

### Batch E — per-photo pin + direction capture, and the tile-icon preview

Uploading (any media type) can now pick a floor plan, click a point, and drag out a direction —
all via `bim.js`'s `openPinPickerFor(itemType, itemId, itemLabel, onDone)`, offered as a
**non-blocking** prompt after a successful upload (`BIM.openPinPickerFor(...)` in `module.js`'s
save handler). ⚠️ **Deliberately not a hard gate on the upload flow** — the plan's own "best
practice" wording was weighed against making an already-shipped, well-tested critical path
(Add photos) newly blockable on a DIFFERENT module's state (a project may have no floor plans at
all yet), which is a bigger behaviour change than the ask justified.
- `floor_plan_pins.direction_deg` (nullable, no default — an undirected pin is valid, it just
  draws no cone). `pinConeHTML(pin)` only renders the CSS `conic-gradient` wedge when a direction
  is actually recorded; `pinMarkerHTML` always prepends it (a no-op string when absent).
- **`directionWidgetHTML`/`wireDirectionWidget`** — a small SVG drag-to-set-direction control
  (pointer events, `setPointerCapture`), reused verbatim by both the in-Plans pin flow and the new
  Gallery-triggered one, so the two entry points can't disagree about what "0°" means.
- ⚠️ **The angle math was pulled out into a named pure function,
  `directionDegFromDrag(dx, dy)` = `(atan2(dx, -dy) * 180/π + 360) % 360`**, specifically so it
  could be genuinely EXECUTED by a test rather than only read — a flipped sign here is silent (the
  widget still *looks* interactive; it just records the wrong angle for every future pin) and
  nothing else in the UI would ever catch it.
- `openPinPickerFor` is **self-contained** — its own plan-select + click-to-pin static image +
  direction widget, and it deliberately never touches `activePlanId` or any pan/zoom state, so
  pinning from the Gallery can't disturb whatever the Plans screen happens to be showing.
- **Item 8 — the Gallery tile-icon preview.** A tile whose photo has a pin (`BIM.pinInfoFor('photo',
  r.id)`) shows a small icon (`.pp-pinbtn`, same dark-scrim corner-overlay language as the existing
  `.pp-cardsel`); clicking it opens `openPinPreview(photoId)` — a Tight/Wide crop-zoom modal
  centred on the pin, with its cone. ⚠️ Reinterpreted "1/8 or 1/4 of the photo's displayed size"
  as this Tight/Wide toggle inside a dedicated modal rather than an inline overlay, which would be
  impractically tiny on a real Gallery thumbnail.
- **The centring math**: `left:50%;top:50%` on the plan image, then
  `translate(-x_norm*100%, -y_norm*100%)` — percentages resolve against the TRANSFORMED element's
  own box, so this exactly centres the pin's fraction-of-image point at the container's centre at
  any zoom level, with no matrix math to get wrong.

### Batch F — the markup/annotation editor + slide-sorter

**One shared drawing engine, two independent stores.** `module.js` owns the whole vector engine
(`MARKUP_COLORS`, `drawIconStamp`, `drawMarkupObjects`, `markupHitTest`, `openMarkupEditor`) and
exports both `openMarkupEditor` and a read-only `drawMarkupOnCanvas(canvas, objs)` wrapper —
`ppr.js`'s presentation-only overlay reuses BOTH rather than re-implementing per-shape drawing a
second time, following the same cross-file convention already established for
`onProject`/`allPhotos`/`openUploadForPicker`.
- **Format is a JSON array of typed objects** (`pen`/`rect`/`circle`/`arrow`/`text`/`icon`), drawn
  fresh onto a `<canvas>` on every redraw — never a second rasterized image, so toggling it on/off
  is lossless and it stays legible at any zoom. Icon stamps (warn/arrow/person/equip) are drawn
  with hand-rolled Canvas 2D primitives, not reused `icons.js` SVGs — those mix `<path>`/`<circle>`/
  `<line>`/`<polygon>` elements, incompatible with the single-`d`-string `Path2D` shape this needs.
  "Erase" is `markupHitTest` (nearest-object) + splice — the vector-layer equivalent of an eraser;
  there are no pixels to paint transparent.
- ⚠️ **`progress_photos.markup`** (the photo's own permanent markup — Gallery lightbox, every
  slide citing it) and **`ppr_slide_markups`** (a SEPARATE presentation-only overlay, keyed by
  `(ppr_slide_id, pane)`) are two stores on purpose — the owner's own wording was "native only to
  the presentation, not inherited by the photo." Editing one never touches the other; deleting the
  photo/slide cascades its own markup only.
- ⚠️ **`ppr_slide_markups` needed insert-vs-update logic, not a blind insert** — its own
  `(ppr_slide_id, pane)` unique constraint means a SECOND edit of the same pane must UPDATE the
  existing row (tracked via a cached `markupRowId`) or the save throws a constraint violation.
- **Exports never reference the presentation-only overlay** — the offline HTML/PDF/PPTX are the
  record of what was presented; the live pane toggle/edit toolbar is a viewing aid, not part of
  that record. (`slideFigureHTML`/`slidesBodyHTML` are untouched by this batch.)
- **Slide-sorter** (`openSlideSorter`) — a drag-to-reorder grid of slide thumbnails (native HTML5
  drag events, no library), offered only with 2+ slides (a "Reorder slides" button beside
  Edit/Delete presentation — nothing to reorder on a 1-slide deck). ⚠️ **Reorders a LOCAL DRAFT
  first; nothing is written until "Save order,"** mirroring the copy wizard's own "nothing is
  saved until you're done" rule — cancelling (× / backdrop) discards the reorder entirely. The
  save loop skips a row whose position didn't actually change, so a small in-place shuffle costs
  only as many writes as slides that actually moved.
- The pure reorder step, `moveItem(arr, from, to)`, is a **new array** (never mutates its
  argument) — exported as `_moveItem` for genuine execution.

### Batch G — floor-plan map/clustering view

`bim.js`'s Plan screen gains a **Plan / Map** toggle. Map mode auto-computes **cluster markers**
(count badge) per grid-snapped location, filtered to "as of month T" via a month-stepper + Play,
following **Project Schedule's own confirmed-portable time-scrub shape** (null-is-live,
a timestamp is scrubbed, `setInterval`-with-auto-stop-at-max) rather than reinventing one.
⚠️ **Grid-snap clustering (`MAP_CELL`), not proximity/k-means** — chosen specifically for
frame-to-frame positional STABILITY as the month slider moves; a re-clustered k-means result can
jump a marker's screen position between adjacent months even when the underlying pins didn't move,
which reads as noise on exactly the control built to show change over time.
- `itemDateFor(pin)` resolves which date a pin's underlying item (photo/panorama/reconstruction)
  was captured on, so "as of month T" means "the most recent item at-or-before T," matching this
  app's other cumulative-month-cutoff conventions elsewhere.
- Clicking a cluster opens `openClusterList(cluster)` — its member list, never jumping straight
  into one item, since which one a multi-item cluster "means" is ambiguous by construction.

### Batch H — top-view photo → floor plan registration

**Real point-based image registration**, not a flat side-by-side toggle, per the plan's own
foundational decision. `openRegisterFlow()`: click a point on the drawing, click its matching
point on an uploaded top-view photo, repeat ≥`MIN_REG_POINTS` (4) times; `cv.findHomography(...,
cv.RANSAC)` computes the 3×3 perspective transform (RANSAC so a few mis-clicked pairs can't wreck
the whole warp). `paintActualView(reg)` then renders the photo through `cv.warpPerspective` into
the drawing's own coordinate frame — an **"Actual" view** toggle swaps it in for the drawing image,
with the exact same pins/clusters rendering identically on top of either, since both share one
normalized 0..1 coordinate space.
- **`floor_plan_registrations`** is one row per `(floor_plan_id, photo_id)` pair (unique
  constraint) — two point-pair sets for the same photo would produce two disagreeing warps of one
  image, which isn't a state worth representing. The upsert therefore targets
  `onConflict:'floor_plan_id,photo_id'`, so re-registering REPLACES rather than duplicating.
- ⚠️ **`homography` is STORED, not recomputed on every render** — `findHomography` is real
  OpenCV.js work, and re-running it every time the Plans screen paints for no reason is wasted
  browser-side compute. It's invalidated only by re-running the registration flow.
- `ensureOpenCV()`/the readiness-check pattern is copied from `pano.js`'s own already-proven
  implementation (loaded once, globally, via the same CDN script tag from Phase 3) rather than
  re-derived — this app already has exactly one way to wait for OpenCV.js to be ready.

### Verified (2026-08-29)

**364 checks green** (was 311), new `[28]` section covering every item above. Genuinely EXECUTED,
not just regex-matched, via new test-only hooks (same convention as `_tradesOf`/`_zoomAnchor`/
`_buildCopyDrafts`):
- `BIM._directionDegFromDrag` against all four cardinal drags (0°/90°/180°/270°) — the exact math
  that, if flipped, would silently point every future pin's cone backwards.
- `PPR._moveItem` (drag-reorder correctness across first→last, last→first, a no-op move, and
  non-mutation of the source array) and `PPR._markupKey`'s exact string shape.
- `PP._drawMarkupObjects` against a **fake Canvas-2D-call-recording context** — the one way to
  tell "drew a rect" from "silently drew nothing" per shape type: confirms `rect`→`strokeRect`,
  `circle`→`ellipse`+`stroke`, `arrow`→`stroke`+`fill` (shaft + arrowhead), `text`→`fillText`,
  `icon`→`save`/`restore`-wrapped, and that every call clears the canvas first.
- `PP._markupHitTest` against a real 2-object fixture — a click near each object's centre hits its
  index, a click far from both returns -1 (the eraser's actual "did I hit anything" decision).

Structural (source-level) coverage for everything DOM/state-heavy that the harness's minimal fake
DOM (`querySelector`/`querySelectorAll` return null/[]; no real `parentElement`) can't drive —
Batch G's clustering/date-cutoff and Batch H's registration flow depend on `bim.js`'s own
module-internal plan/pin/photo state populated by a real `load()` against Supabase, the same
DOM/auth-stack limitation flagged for every other client-only surface this module has shipped
(Phase 3's OpenCV.js stitching pipeline remains the one exception, verified in a real browser
with a real WASM/WebGL stack).

**0 functions lost** across `module.js`/`ppr.js`/`bim.js` against the pre-batch commit (16/8/30
added respectively — bim.js grew from 363 to 938 lines, module.js and ppr.js gained the markup
engine and its per-file wiring). 0 NUL bytes across every touched file (byte-level check, not
`grep -c $'\x00'`). CSS braces 364/364 balanced (was 350) — two real new-selector gaps this pass
found and fixed rather than just patched around: `.pd-modal-header`/`-body`/`-footer` were never
the issue here, but `.pp-mk-*` (the markup editor's own toolbar/canvas classes) and
`.pp-lb-imgwrap`/`.pp-lb-markup` (the restructured lightbox) had NO CSS at all until this pass —
caught before shipping, not after, by checking every id/class the new HTML actually emits against
what the stylesheet defines. The `#fff` context-allowlist (this file's own documented fragility
tracker) gained 5 more legitimate entries (`.pp-pinbtn`, `.pp-pinpreview-dot`, `.bim-cluster`,
`.ppr-mktool`, `.ppr-sortno`, `.pp-mk-tool.active`) — all the same shape as the ones already
there: a fixed dark scrim or a solid brand-red badge, not a light surface. Both new RLS-carrying
migrations (`markup.sql`, `floor-plan-registration.sql`) are paren-balanced with every
`create policy` preceded by a matching `drop policy if exists`.

⚠️ **Not verified signed in** — same standing caveat as the rest of this module; none of the four
new migrations have been run, and no click-through exists for the pin-drop flow, the markup
editor's actual pointer-drawn strokes, the slide-sorter's real drag events, the map view's
clustering against real photo dates, or the registration flow's `findHomography` against a real
uploaded top-view photo. Priority for the first live pass: register one real top-view photo
against a real floor plan and confirm the warped "Actual" view visually lines up — that's the one
piece here where "the math is right" (execution-verified above) and "it looks correct against a
real photo" (unverified) are genuinely different claims.

`MODULE_V` → `20260829h`; `module.css/js` / `ppr.js` / `bim.js` → `?v=20260829h`.

## Deployment plan: Presentations row rework, shared location, PPTX/PDF fixes, copy wizard, Gallery batch select (2026-08-29)

Owner: *"Please already do the Deployment Plan"* with six additional numbered items folded in
verbatim (Presentations row → Download/Preview/Archive with a format choice; icon padding;
shared-location tile applied to all three export formats plus PPTX centering and PDF one-slide-
per-A4; Gallery multi-select + batch actions; a step-through copy wizard that can never save a
Previous without a Current). This is the full **Batch D** scope from the standing plan
(`elegant-mixing-mitten.md`) plus the Batch C follow-up items that were deferred to it. **Run
`migrations/2026-08-29-archive-flag.sql`.**

### Archive (new, shared by Presentations + Gallery)

`archived boolean default false` added to `progress_photos`, `ppr_presentations`, `panoramas`,
`reconstruction_requests` — the SAME column name/shape on all four, deliberately, so a future
unified Gallery view could treat them identically. ⚠️ **Soft-delete, not a UI convenience**: the
FKs `ppr_slides.before_photo_id`/`after_photo_id` are `on delete set null`, so a *hard* delete of a
cited photo already silently orphans a slide — archiving is the alternative that keeps the record
intact while getting it out of the everyday view. Hidden by default, both filter bars gain a
**"Show archived"** toggle that is a separate VIEW, not a search filter — `Clear filters` never
resets it (same reasoning as the Presentations list's own date filters staying independent of the
Photos/Presentations screen split). Every archive-toggling call is tolerant of the migration not
having run yet, warning by name rather than failing opaquely.

### Presentations row: Download / Preview / Archive only (item 1)

The row's six icons (download/pdf/pptx/open/edit/delete) become exactly three. Row-click still
opens the presentation (unchanged).
- **Download** opens a small format-choice modal (`openDownloadChoice`) — HTML / PPTX / PDF — that
  dispatches to the SAME three export functions as before; nothing about the exports' own logic
  changed by this.
- **Preview** (`openPreviewModal`) reuses `slidesBodyHTML`/`EXPORT_CSS` **verbatim** — the same
  markup the HTML/PDF exports produce — rendered in-app rather than downloaded. ⚠️ Deliberately
  **not** `collectSlideImages`'s downscaled data-URI embedding: a preview stays on screen, so the
  already-cached SIGNED URLs serve directly via a new `identityImgs()` (an identity map,
  `imgs[url] === url`) at zero extra fetch cost — only a real export needs the file to be
  self-contained.
- **Archive** (`toggleArchive`) is direct, no confirm modal — reversible with one more click,
  unlike Delete.
- **Edit/Delete presentation** are NOT removed — relocated into the opened presentation's own
  header (`renderSlides()`'s `.ppr-slidehead`, via new `wirePresActs`), reachable exactly where a
  planner already is when they'd want to rename/re-date or remove one. `openPprForm`/`removePpr`
  are unchanged; only where their buttons live moved.
- Icon left-padding (item 2) was **already shipped in Batch A** (`.ppr-acts { padding-left: 10px
  }`) — re-confirmed rather than re-applied.

### Shared location tile, on screen AND in all three exports (items 3/4)

When a slide's Previous and Current photos resolve to the **same** `location` string, it now
renders **once**, above the pair, instead of once per pane — `sharedLocationOf(sl)` (exact string
equality, both non-blank) is the single source of truth, read by:
- the live editor (`renderSlides()` → `pane(sl, which, hideLocation)`),
- the offline HTML + PDF export (`slidesBodyHTML()` → `slideFigureHTML(sl, which, imgs,
  hideLocation)`, a new `.meta .sharedloc` line in `EXPORT_CSS`),
- the PPTX export (`exportPptx()`'s per-slide loop → `pptxPane(..., hideLocation)`, a centered
  `slide.addText` above both panes).

⚠️ Trade/Works are **not** collapsed the same way — only "the location matches" was asked for, and
those two are not required to match between Previous and Current.

**PPTX vertical centering.** Horizontal was already effectively centered (the two 6.1"-wide panes
plus their gap already sum to within 0.03" of the 13.33" slide width — not touched). Vertical was
not: label/image/caption sat at fixed `y:0.35/0.75/5.45`, leaving ~1.15" of dead space at the
bottom on every slide. Replaced with `paneTopFor(topBand)`, which centers the whole
label+image+caption block (`PANE_H` = 5.85") in whatever space is left below the top band — the
"Slide N of M" row alone (0.4"), or that plus the shared-location line (0.75") when one is shown —
so a slide **with** a shared-location bar and one **without** both end up visually balanced instead
of one reading top-heavy.

**PDF one-slide-per-A4, the actual bug.** ⚠️ The existing `.slide{page-break-after:always}` rule
sat **inside `@media print`**, and html2pdf's `pagebreak:{mode:['css']}` reads
`getComputedStyle()` during a **normal (screen-context) html2canvas capture** — which never
matches `@media print`, so the rule was **silently inert** the whole time this export has existed.
Moved the rule out (unconditional — page-break properties have zero effect on-screen either way,
so nothing about the live app changed), added `break-inside:avoid` (stops one slide's content being
sliced across a page boundary purely by height), and scoped the break to `:not(:last-of-type)` so
the final slide doesn't leave a trailing blank page. `jsPDF: {unit:'mm', format:'a4',
orientation:'landscape'}` was already correct and is unchanged.

### Copy wizard — a Previous can never be saved without a Current (item 6)

The old `copySlidesFrom()` inserted every copied slide with `after_photo_id: null` immediately —
exactly the state the owner said must never be allowed. **Removed entirely**, replaced by:
- `buildCopyDrafts(src)` — the SAME before-photo promotion rule (`before_photo_id:
  s.after_photo_id || s.before_photo_id || null`), now building **in-memory drafts**, not DB rows.
- `openCopyWizard(newData, fromPprId)` — steps through the drafts one at a time. Each step shows
  the (already-fixed) Previous photo read-only and requires picking a Current photo — via
  `openThumbPicker`, filtered to photos captured **on/after** the fixed Previous (`eligiblePhotos`,
  `direction:'after'`) — before **Next** unlocks; **Finish** (last step only) is disabled until
  every draft has a current photo.
- ⚠️ **`openPprForm`'s save handler no longer creates the presentation row when a copy source is
  chosen** — it closes its own modal and hands off to the wizard instead. The presentation row and
  its finished slides are inserted **together, inside `finish()`, only once every slide is
  complete**. Cancelling the wizard at any point — including before the first photo is picked —
  leaves **nothing behind**: no orphan presentation, no half-copied slides. (Choosing "start empty"
  is unaffected — that path still creates the presentation immediately, as before.)
- Non-blocking duplicate-current warning (18-item list item 11) applies inside the wizard too —
  checked against the OTHER drafts, not just already-saved slides.

### Thumbnail photo pickers, Previous/Current rules (18-item list items 5/6/9/10/11)

The plain `<select>` (`photoOptions`) is gone, replaced by `openThumbPicker` — a searchable grid of
real photo thumbnails (`.ppr-pickgrid`/`.ppr-pickitem`), shared by the ordinary slide form AND the
copy wizard's Current picker. A chosen photo shows as a thumbnail button (`pickBtnHTML`) rather
than text.
- **Current is now REQUIRED** on every slide (was: "at least one of the two"); **Previous is
  hidden entirely** until Current is picked (item 10), via `syncVisibility()` (folds the old
  `syncBeforeCaption` into one function that also gates the whole Previous field, not just its
  caption).
- **Previous defaults to the SAME location as Current and to photos captured strictly earlier**
  (`eligiblePhotos(refPhoto, 'before', allowAllLocations)`) — the location half is liftable via a
  **"Show all locations"** checkbox; the date half is a hard rule (a "previous" that comes after
  the "current" is a fact, not a preference). The reference photo itself is always excluded from
  its own candidate list.
- **Changing Current re-validates the already-picked Previous** — if it no longer qualifies (wrong
  side of the new date, or a different location with the override off), it's cleared with a toast
  explaining why, rather than silently left as an invalid pairing.
- **Non-blocking duplicate-Current warning** (item 11): picking a Current already used as another
  slide's Current in the same presentation toasts a warning but never blocks the save.
- `reqMark()` had to be **restated locally in ppr.js** — it's private to module.js's own closure
  (same "each independently-loaded file keeps its own copy of small helpers" convention already
  used for `allLocationCombos()`); using it un-declared would have thrown at render time. Caught
  before shipping, not after.

### Gallery batch select: Download / Add to Presentation / Archive (item 5)

`selected` (id → true) added to `module.js`, checkboxes on both List (`.pp-selcell`, a new leading
grid column) and Gallery (`.pp-cardsel`, corner overlay) rows — **one selection set for the whole
Gallery screen**, not per-view, since List/Gallery are two displays of the same underlying photos.
- `visibleSelectedIds()` scopes every batch action to the **currently filtered** set, not the raw
  `selected` map — the same correctness rule Drawing Register's own bulk-select bar already
  documents (a selection made under one filter must not silently act on rows a since-changed filter
  no longer shows).
- **Download** loops `download(r)` (the existing single-photo function) with a 300ms stagger — a
  burst of near-simultaneous programmatic downloads from one click is exactly what some browsers
  throttle or block as automated.
- **Archive** is a bulk `update({archived:true}).in('id', ids)`, tolerant of the pending migration.
- **Add to Presentation** (`openAddToPresentation`) picks an existing presentation (via a new
  `PPR.listForPicker()`, archived ones excluded) or creates a new one, then calls a new
  `PPR.addPhotosToPresentation(pprId, photoIds)` — each selected photo becomes a **new slide's
  Current photo**, Previous left blank (exactly like an ordinary "+ Add slide" with nothing picked
  to compare against), slide numbering continuing from the presentation's existing count. The write
  lives in `ppr.js` (the one place that already owns `ppr_slides`' shape), not duplicated in
  `module.js`.
- **List's grid header gained a matching leading column** (`<div></div>`) so header/body cell
  counts stay aligned — this file's own standing rule for its grid, restated because it's exactly
  the kind of thing that silently drifts.
- ⚠️ **CSS reuse, not a fresh component:** `.pp-selbar` already existed — built for the now-deleted
  Today's Rounds feature's own "N selected — Start walkthrough" bar. Its shape (a count + a row of
  buttons) was exactly what this needed, so it's reused rather than rebuilt; the Rounds-only rules
  that shared that section (`.pp-round-row/-chk/-thumb/-info/-loc/-act/-last` and their phone
  overrides) had no such second use and are deleted — cleanup Batch C's own removal pass missed
  because it only touched `module.js`/`index.html`, not `module.css`.

### Verified

**311/311 checks green** (was 253 after Batch C), including new `[27]` section: structural checks
for every item above, plus genuine EXECUTION via new test-only hooks (`PPR._sameLocation`,
`_sharedLocationOf`, `_buildCopyDrafts`, `_eligiblePhotos`) — same convention as `_tradesOf`/
`_mediaStripMatches` — covering the shared-location match, the copy-wizard's promotion+resequencing
across multiple source slides, and the Previous/Current date+location eligibility filter across a
5-photo fixture (same-location-and-earlier, all-locations-lifted, self-excluded, on/after-a-fixed-
previous, no-reference-photo-yet). The PPTX centering formula was re-executed standalone (not
exported — a small closure local to `exportPptx`) confirming the pane block fits the slide with and
without a shared-location bar. Function-diff against the pre-batch commit: **4 lost in `ppr.js`**
(`copySlidesFrom`, `paintInfo`, `photoOptions`, `syncBeforeCaption` — all superseded, all
intentional), **24 added**; `module.js` **0 lost, 4 added**. 0 NUL bytes across every touched file
(verified with a raw byte count). CSS braces balanced (312/312). 0 duplicate `id=` attributes in
`index.html`.

⚠️ **Not verified signed in** — no live Supabase login in this environment, same standing caveat as
the rest of this module. In particular: the thumbnail picker's real rendering, the copy wizard's
full click-through, the PPTX/PDF file output (the centering math and the break-CSS fix are verified
analytically, not by opening a generated file in PowerPoint/a PDF viewer), and the Gallery batch
actions against real rows are all untested against a live project.

⚠️ **Still open, not attempted in this pass**: Batches E through H of the standing plan (per-photo
key-plan pin + direction capture, the markup/annotation editor, the slide-sorter view, the
floor-plan map/vertical-stacking views, and top-view image registration), plus the Add-media type
selector (Photo/Video/360°/3D) and real Video upload support noted as separately-scoped items in
the 18-item list.

## 18-item feedback round, Batch C: Rounds removed, 360°/3D folded into Gallery (2026-08-29)

Owner, reviewing Batch A/B in the live tab bar: *"The Rounds, 360, and 3D are still in the tabs.
You haven't applied my previous comment. Rounds can be removed. 360 and 3D should be incorporated
in the Gallery."* Two distinct asks, handled differently on purpose. **No migration.**

### Rounds — deleted, not gated

Today's Rounds was never asked to stay in any form. Removed outright from `module.js`: the
module-scope state (`roundsFilter`, `roundsSelected`, `walkState`, `_roundsComboByKey`), the two
`refreshRoundsIfVisible()` call sites, the `pp-rounds-search` wiring, and the whole
`renderRounds`/`wireRounds`/`startWalkthrough`/`advanceWalkthrough`/`openWalkStep`/
`refreshRoundsIfVisible` block (93 lines) — including a nested `function row(it)` helper that
lived inside `renderRounds` itself, which is why the function-diff check below reports it as its
own loss. `openUpload(preset)` lost every `preset.walk` branch (modal title, Skip/End-walkthrough
footer buttons and their wiring). The tab and its screen (`#pp-screen-rounds`,
`pp-rounds-search`) are gone from `index.html` entirely — not hidden, deleted.

⚠️ **`locCombos()`/`photoLocCombos()` were explicitly checked and kept.** They sit in the same
region of the file Rounds used, but `bim.js`'s Floor Plan pin picker and `ppr.js`'s location
picker both call them — deleting them alongside Rounds would have silently broken two other
screens. A grep for both names across every module file was run before removing anything, not
after.

⚠️ **A real crash was averted, not just a cosmetic tab removal.** `setScreen()` in `index.html`
still called `ProgressPhotos.renderRounds()` whenever `isRounds` was true, and that function is
now GONE from the exported object — so a browser that still had `localStorage['pp_screen'] ===
'rounds'` from before this shipped (anyone who had used Rounds) would have thrown a
`TypeError: ProgressPhotos.renderRounds is not a function` on the very next page load, breaking
the whole module for that user with no way back through the UI. Fixed by narrowing `setScreen`'s
restore-list to `['ppr', 'bim']` only — any other stored value (including a legacy `'rounds'`,
`'pano'`, or `'recon'`) now falls back to `'photos'` instead of ever reaching `setScreen('rounds')`.

### 360°/3D — folded into Gallery, not deleted

Per the owner's own distinction ("Rounds can be removed" vs. "360 and 3D should be incorporated"),
pano.js/recon.js's capture flows and viewers are untouched — only their **top-level tabs** are
gone. The tab bar is now exactly Gallery / Presentations / Plans.

- **The "+ Capture 360°" / "Compare over time" / "+ Request 3D scan" buttons moved into the
  Gallery screen's own tool cluster** — `setScreen()` now calls `PANO._syncTools(isPhotos)` /
  `RECON._syncTools(isPhotos)` (was `isPano`/`isRecon`, screens that no longer exist as tabs).
  Their `onclick` handlers were already bound unconditionally in each module's own `init()`, so
  no new wiring was needed — only what controls their **visibility** changed.
- **A new "360° & 3D captures" strip renders below the photo grid on the Gallery screen**
  (`#pp-media-strip`, populated by new `mediaStripHTML()`/`wireMediaStrip()`/`renderMediaStrip()`
  in `module.js`) listing existing panoramas (`PANO.list()`) and done reconstructions
  (`RECON.doneList()`) as small clickable tiles — clicking one opens the **exact same viewer** the
  old dedicated tabs used (`PANO.open(id)` / `RECON.openById(id)`), nothing reimplemented. Absent
  from the DOM entirely when a project has neither, rather than an empty heading.
- ⚠️ **Deliberately NOT interleaved into the photo grid itself.** A panorama/reconstruction is a
  different SHAPE of record from a photo (no trade/works, its own open-viewer, no lightbox
  arrow-navigation), and rewriting `visible()`/`thumb()`/`listHTML()`/`galleryHTML()`/`wireRows()`
  to be kind-aware would have put the well-tested, already-passing photo rendering pipeline at
  risk for a presentational preference. A separate strip on the same screen satisfies "no longer a
  separate tab" without touching that pipeline at all.
- The strip respects the **same location/date/search filters** the photo grid uses
  (`mediaStripMatches()`), but never Trade/Works, which don't apply to either kind.
- ⚠️ **`load()` now awaits `PANO.ensureLoaded()`/`RECON.ensureLoaded()` in parallel** (both new,
  guarded — `ensureLoaded: async function () { if (!panoramas.length) await load(); }` in each
  file) right after `signAll()`, so the strip has data to show the first time Gallery paints,
  without the user ever having visited a "360°" or "3D" screen in this session.
- ⚠️ **`#pp-screen-pano` and `#pp-screen-recon` are kept in the DOM, permanently hidden — NOT
  deleted, on purpose.** Both `pano.js`'s and `recon.js`'s `load()`/`render()` bail out
  (`if (!host) return;`) the moment their screen's host div (`#pano-view`/`#recon-view`) doesn't
  exist — so `ensureLoaded()` calling `load()` would silently no-op and the media strip would stay
  permanently empty if those divs were removed. Confirmed by reading both files' `load()` before
  touching `index.html`, not assumed.
- `icons.js` already has `compass` and `box` — reused for the panorama/3D tile icons rather than
  inventing new SVG paths or guessing an icon name exists (this file's own history records that
  exact mistake once already, with a missing `pencil` icon).

### Verified

**253/253 checks green** (was 239 before this batch), including a new `[26]` section: structural
assertions that Rounds is completely gone (functions, state, export, tab, screen, search field,
the walkthrough branch in `openUpload`), that `locCombos`/`photoLocCombos` survive, that the tab
bar is exactly 3 tabs, that `#pp-media-strip` exists, that `load()` awaits both `ensureLoaded`
calls, that `render()` calls `renderMediaStrip()` **before** the photo grid's own empty-state
branches (so it repaints independent of whether the project has any photos), and that a media tile
dispatches to the real `PANO.open`/`RECON.openById` — plus two genuinely EXECUTED assertions via
new test-only hooks `ProgressPhotos._mediaStripMatches`/`_mediaStripItems` (same convention as
`_tradesOf`/`_worksOf`): the filter-match function against a real item object, and the merge
function running against the real `PANO`/`RECON` closures with no throw.

Two real defects were found and fixed by this pass, not by inspection alone:
1. A stale `setScreen dispatches the bim screen…` assertion from before this batch still checked
   for `!isRecon && !isBim`, which no longer exists after simplifying `isPhotos` — updated to match
   the simpler, correct logic rather than reintroducing the old five-way ternary to satisfy it.
2. `.pp-mediatile-badge`'s hard-coded `#fff` tripped this file's own "every #fff sits under a
   documented fixed-colour selector" check — correctly, since it was a genuinely new light-surface
   risk. Added to the allow-list on the same basis as the already-allowed `.pano-badge-warn`: a
   solid brand-colour pill background, white text always legible regardless of theme, not a light
   surface that needs a dark-mode override.

Function-diff against the pre-batch commit: **7 lost** (all Rounds, all intentional — including
the nested `row` helper), **5 added** (`mediaStripMatches`, `mediaStripItems`, `mediaStripHTML`,
`wireMediaStrip`, `renderMediaStrip`). 0 NUL bytes across every touched file (verified with a raw
byte count, not `grep -c $'\x00'` — that command returns nonsense under this environment's Git
Bash and would have reported hundreds of false positives). CSS braces balanced (293/293).

⚠️ **Not verified signed in** — no live Supabase login in this environment, same standing caveat
as the rest of this module. In particular, the media strip's real thumbnails (`PANO.urlOf`) and
click-through to the two viewers have not been exercised against real panorama/reconstruction rows.

⚠️ **Still open from the 18-item list, not attempted in this batch**: Batches D through H (photo
pickers with thumbnails, per-photo pin + direction capture, the markup/annotation editor, the
slide-sorter view, the floor-plan map/vertical-stacking views, and top-view image registration) —
see `C:\Users\gwsia\.claude\plans\elegant-mixing-mitten.md` for the full sequencing. Also not done
this batch: the "Add media" type selector (Photo/Video/360°/3D) on the upload modal, real Video
upload support, and Gallery multi-select + batch actions — all separately scoped items from the
same feedback round, none of which this correction asked for by name.

## 18-item feedback round, Batch B: Trade/Works multi-select, Location label dropped (2026-08-29)

**Run `migrations/2026-08-29-photo-trades-works-multi.sql`.** Item 2 of the owner's feedback:
*"Trades can also be multiple"*; the schedule-linked Works dropdown stays constrained-choice but
also goes multi-select; the redundant free-text "Location label" input is removed.

### Trade / Works: single `<select>` → checkbox-group multi-select

- **New columns** `progress_photos.trades text[]` and `works_multi text[]`. The existing
  singular `trade`/`works` text columns are **kept, deprecated** — populated with the
  first-selected value as a display-cache fallback, same "kept in step, never re-derived"
  convention this file already uses for `location` and `ppr_slides`' legacy fields. Nothing
  reads the singular columns as authoritative going forward; they exist purely so an older code
  path (or a not-yet-migrated database) still sees something sensible.
- **UI**: `tradesOverlayHTML`/`worksOverlayHTML` replace the old `tradeOptions`/`worksSelectHTML`
  single-`<select>` pair, following the **exact visual pattern this file already had** for the
  Activity Code overlay (`codeOverlayHTML`/`readCodeTags`) rather than inventing a third
  component — a checkbox group, read back via a new generic `readMultiCheck(idPrefix, field)`.
  ⚠️ **4 functions deliberately removed** (`tradeOptions`, `worksOptionMarkup`,
  `worksSelectHTML`, `refreshWorksSelect`), replaced by 10 new ones — an intentional
  architectural swap, not an accidental loss (confirmed via the same function-diff check this
  session uses everywhere, which correctly reports "4 lost" here rather than "0").
- **Works stays schedule-constrained and Trade-scoped, now across MULTIPLE checked trades** —
  `worksOptions(tradeFilter)` was widened to accept either the old single-string call shape
  (untouched call sites elsewhere keep working) or an array, OR'd across
  `workTypeMatchesTrade()` per entry via a new `tradesAsArray()` normalizer. Unchecking down to
  zero trades correctly falls back to "offer everything," matching the old blank-trade behavior.
  ⚠️ The "+ Add new Works value…" `<option>` escape hatch (a stale-select-then-prompt flow)
  became **"+ Add custom Works value…"**, a real button that appends a new checked checkbox to
  the group and re-renders it — a cleaner fit for a checkbox group than reusing a dropdown's
  own "special option" trick.
- **Filters (`pp-f-trade`/`pp-f-works` on the Gallery screen) now match "any of the row's
  values,"** not exact single-value equality — `tradesOf(r)`/`worksOf(r)` (the same
  legacy-fallback readers the save path uses) back both the filter predicate and the dropdown's
  own distinct-values listing (`distinctMulti`), so a photo tagged Structural **and**
  Architectural is findable by filtering on either one. ⚠️ **Deliberately NOT built**: a true
  multi-value filter control (pick 2+ trades and OR them in the filter itself) — the filter
  dropdown stays single-pick for now; what changed is that a multi-tagged photo is no longer
  invisible to a filter matching only one of its tags. A real multi-select filter UI is a
  reasonable follow-up, not attempted here to keep this batch's scope proportionate.
- Every **display surface** updated to show the full set, not just the first value: the List
  view's Trade/Works cells, the group-by-Trade heading (still groups by the row's *first* trade
  only — a photo appearing in two groups at once would break the "one row, one place" assumption
  List view's collapse state relies on — but the row itself lists every trade it carries), and
  the lightbox caption.
- ⚠️ `tolerantWrite()` (the existing "strip the column and retry" mechanism used for
  `location_values`/`activity_id`/`activity_name` pre-migration) gained a **second, separate**
  strip rule for `trades`/`works_multi` — a save still lands with usable (first-value-only)
  data even before this migration runs, rather than failing outright.

### "Location label" removed (item 2 — "redundant")

The separate free-text input (`-loctxt`) that sat below the Location Breakdown picker is gone.
`location` (the display-cache text column read by search/grouping/PPR) is now **always**
`locBreadcrumb(locVals)` — never a manual override. `locationFieldHTML()` dropped its third
`locText` parameter; both call sites (Add and Edit forms) updated to match. ⚠️ This was already
**mostly true in practice** — the picker's breadcrumb was never auto-filled into the label field
(a deliberate earlier decision, so a resolved schedule path was never mistaken for a typed
caption) — this change just removes the now-pointless second field entirely rather than leaving
an input that did nothing useful next to the breadcrumb that already shows the real value.

### Verified

**236 checks, 0 failures** (`test.js`, up from 221) — a new `[2b]` section covering the overlay
functions, the removed `-loctxt` field, the save payload's array+fallback shape, and the
tolerant-write strip rule; plus a `[2c]` section that **genuinely executes**
`tradesOf`/`worksOf` (exported as test-only hooks, `PP._tradesOf`/`PP._worksOf`, the same
convention as `bim.js`'s `_zoomAnchor`) against all four real data shapes — migrated-with-array,
pre-migration-legacy-only, neither, and the one edge case worth documenting explicitly: an
**empty** `trades` array still falls back to the legacy column (matching `null`'s behavior)
rather than being treated as "deliberately cleared," because `requiredFieldsMissing` already
makes a real zero-trades save unreachable through this module's own UI — that state can only
exist from data written outside this app, where falling back to whatever's known beats nothing.

0 NUL bytes across every touched file; CSS braces 284/284 balanced; function-diff shows
**4 deliberate removals / 10 additions** in `module.js` (explained above, not a regression).

⚠️ **Not verified signed in** — same standing caveat as the rest of this module.

## 18-item feedback round, Batch A: default Gallery view + label renames (2026-08-29)

Owner reviewed the live build and gave 18 pieces of feedback spanning the Photos screen, the
Meetings screen, and the Floor Plan screen, plus several genuinely new subsystems (photo
markup, a floor-plan map view, a photo vertical-stacking view, top-view-to-floor-plan image
registration). **Explored the codebase with 3 parallel Explore agents before planning** (the
exact current data model, and whether any multi-select/rotation/registration pattern already
existed anywhere in this repo — confirmed none did), then entered Plan Mode given the size and
number of real architectural forks, and got the owner's sign-off on a lettered batch sequence
(A through H) before writing any code. The full plan — including the three foundational
decisions confirmed with the owner (keep 3 tables + merge client-side for the unified Gallery;
real point-based image registration via OpenCV.js for the floor-plan overlay; real thumbnail
files generated at upload time) and 6 more items folded in mid-implementation — is preserved at
`C:\Users\gwsia\.claude\plans\elegant-mixing-mitten.md` for reference across the remaining
batches (B–H, not yet built).

**This entry covers Batch A only** — quick wins with no schema change:
- **Item 1**: Gallery (tile) is now the default landing view (`view = 'gallery'`, was `'list'`).
  ⚠️ A returning user's own explicit List choice still overrides this — `restoreUI()`'s
  `if (v === 'list' || v === 'gallery') view = v;` is untouched, so this only changes what a
  *first-ever* visit (or a project with no saved preference) lands on.
- **Item 7**: "Before"/"After" renamed to "Previous"/"Current" everywhere it's **displayed** —
  the slide-editor pane labels, the offline HTML/PDF/PPTX export labels, the copy-from-previous
  hint text, the field labels ("Previous photo", "Caption for the previous photo"). ⚠️
  **Deliberately NOT renamed**: the DB columns (`before_photo_id`/`after_photo_id`/
  `before_caption`/`after_caption`) and the internal `which === 'before'|'after'` discriminator
  string used throughout `ppr.js` (`pane()`, `keyPlanPathFor()`, `slideFigureHTML()`, the
  `#ppr-s-before`/`#ppr-s-after` field ids) — renaming ~30 internal call sites for a value never
  shown to a user would be pure risk for zero visible benefit, the same no-rename-the-column
  convention already used for the PPR→Meeting label change.
- **Tab/screen-title renames**: "Photos"→**"Gallery"**, "Meetings"→**"Presentations"**,
  "Floor Plan"→**"Plans"** — applied as a careful whole-word, case-preserving find/replace
  across both `ppr.js` and `index.html` (`\bMeeting\b` etc., which — because `\b` treats
  underscore as a word character — safely skips `meeting_type`, the DB column, with zero special
  casing needed). ⚠️ **`data-screen` values and every table/column name are unchanged**
  (`ppr_presentations`, `ppr_slides`, `meeting_type` all stay exactly as they are) — this is a
  label-only rename, matching the PPR→Meeting precedent from the same file's own earlier entry.
  Renamed the **Photos** tab to **Gallery** now, ahead of Batch C's actual 360°/3D/video
  unification into that screen — a short-lived naming-ahead-of-function gap, acceptable since
  Batches A–C are being built in the same session.

### Follow-up feedback, received mid-Batch-A (folded into later batches, not re-planned)

Six more items arrived while Batch A was in progress. None introduced a new architectural fork,
so they were folded into the existing approved batch structure rather than triggering a second
planning pass:
- **Presentations-list row icons need left padding** — done immediately, scoped to `.ppr-acts`
  only (NOT the shared `.pp-iconbtn` class other screens' icon buttons also use).
- Presentations row actions become **Download / Preview / Archive** (row-click already opens
  the presentation) → folded into **Batch D**. "Archive" needs a soft-delete `archived boolean`
  column on `ppr_presentations`, `progress_photos`, `panoramas` and `reconstruction_requests`
  alike (the Gallery batch-archive item below needs the same concept).
- **Download asks for a format** (HTML/PPTX/PDF) before downloading → folded into **Batch D**.
- **A shared location tile** when both photos in a slide share a location (instead of repeating
  the tag on both panes), applied to **all three export formats**, plus **PPTX centered
  vertically+horizontally** and **PDF strictly one slide per A4 page** → folded into **Batch D**
  (same `pane()`/`slideFigureHTML()` functions Batch D already touches).
- **Gallery multi-select + batch actions** (Download/Archive/Add to Presentation) → folded into
  **Batch C**, mirroring the selection-bar pattern already used elsewhere in this app (Rounds'
  walkthrough checkboxes, Drawing Register's bulk-select bar) rather than inventing a new one.
- **A copy-from-previous-presentation wizard** — step through each slide, Current photo required
  before advancing, nothing saved to `ppr_slides` until every slide has one → folded into
  **Batch D**, reinforcing item 10's "no Previous without a Current" rule at the copy-flow level
  too, not just the ordinary add-slide form.

### Verified

**221 checks, 0 failures** (`test.js`, up from 217) — a new `[0]` section for the two genuinely
new behaviors (default view, icon padding), plus 6 pre-existing assertions from earlier phases
that hardcoded the old "Meeting"/"Before"/"After" strings **updated in place** (not deleted) to
assert the new labels — e.g. `panes are labelled Previous/Current (was Before/After)`. This is
expected, healthy churn from an intentional rename, not a regression: each updated assertion
still fails against the pre-rename file and passes against the current one. 0 NUL bytes across
every touched file; CSS braces 281/281 balanced; **0 functions lost** in `module.js`/`ppr.js`
against the last commit (a two-line default-value change and a careful text-only bulk rename,
so no function should have been touched — confirmed, not assumed).

⚠️ **Not verified signed in** — same standing caveat as the rest of this module.

## Reconstruction worker rewritten (pycolmap + gsplat); Phase 3 & Gaussian Splatting put on hold (2026-08-29)

Owner reconsidered RunPod's per-job cost and asked to run through free/cheaper hosting
options. Two real, checked (not asserted from memory) products came up and were both ruled
out for different reasons: **Convert3D API** turned out to be a pure 3D-file-FORMAT
converter (FBX↔OBJ↔GLTF etc.) with no photogrammetry/reconstruction capability at all —
looked up directly rather than assumed, given this exact file's own prior lesson about
inventing a fact instead of checking one. **vid2scene** (a real, Apache-2.0, video→Gaussian-
Splat project) turned out to have shut down its free hosted service in June 2026 — but its
open-source code led to a genuinely useful finding.

⚠️ **Standalone GLOMAP (the fast global-SfM solver) was merged into COLMAP 4.0 and the
standalone repo was archived on 2026-03-09** — confirmed via COLMAP's own changelog and the
GitHub PR (colmap/colmap#4228) that added `pycolmap.global_mapping()`. Even vid2scene's own
worker still builds the now-archived standalone `glomap` from source. This means the
original from-source COLMAP+OpenSplat worker was not just expensive to build, it was also
about to be built on top of a project that had just been deprecated.

**`services/reconstruction-worker/` was rewritten, requested explicitly, as groundwork —
not to be deployed right now.** Owner: *"let's put gaussian splatting and 360 on hold."*
No UI change was made (nothing from this branch is merged/deployed yet, so there's no live
tab to hide); Phase 3 (360° panoramas) and Phase 4's Gaussian Splatting deployment are
simply not being pushed further until the owner says to resume.

**What changed in the worker**, each fact checked via WebSearch/WebFetch before being
written down, not recalled from training data:
- **No more from-source COLMAP build.** `pycolmap-cuda12` — a real, prebuilt CUDA-enabled
  Python wheel, added in COLMAP 3.13.0 — replaces compiling COLMAP's full C++ stack
  (including Qt/CGAL GUI dependencies this worker never used). `run_reconstruction()` now
  calls `pycolmap.extract_features()` / `match_exhaustive()` / `global_mapping()` /
  `undistort_images()` / `reconstruction.export_PLY()` directly as Python, not CLI subprocess
  calls to a self-built `colmap` binary.
- **OpenSplat (AGPL-3.0) replaced with gsplat (Apache-2.0)** —
  [nerfstudio-project/gsplat](https://github.com/nerfstudio-project/gsplat)'s license
  confirmed directly from its LICENSE file. AGPL's network-copyleft implications are a real
  consideration for running this as an internal service; Apache-2.0 carries none of that.
  Training now runs via gsplat's own vendored `examples/simple_trainer.py` (git-cloned at
  build time from a pinned tag, not reimplemented) instead of a compiled OpenSplat binary.
- **Base image switched to `pytorch/pytorch:2.5.1-cuda12.4-cudnn9-devel`** (following
  vid2scene's own proven choice) — ships a matching PyTorch+CUDA build gsplat needs, removing
  the separate LibTorch zip download the OpenSplat-based version required.
- ⚠️ **New, explicitly flagged unknowns from this rewrite** (none of this has been run):
  whether `pycolmap-cuda12>=4.0.0` resolves to a real wheel at all — the only version+CUDA
  combination directly confirmed is `3.13.0`, which predates the 4.0 `global_mapping`
  binding this worker calls; the exact keyword-argument names on the four `pycolmap`
  functions above, synthesized from documentation summaries rather than a signature
  inspection; and `pycolmap.global_mapping`'s return type, handled defensively (accepts
  either a dict of reconstructions, mirroring the documented `incremental_mapping`, or a
  single `Reconstruction` returned directly) since neither was confirmed by execution.
- `GSPLAT_MAX_STEPS` starts at 5,000, deliberately far below gsplat's own 30,000-step
  research-benchmark default — a site walkthrough is a smaller, more constrained scene than
  gsplat's benchmark scenes, and RunPod bills per second, so a lower cost-conscious default
  was chosen over copying a number meant for a different kind of scene.

**Cost/hosting options were laid out but NOT decided** — recorded in the worker's own
README (self-hosted-on-owned-hardware, drop Gaussian Splatting for a CPU-only point cloud,
free/manual community tools, or RunPod/Modal pay-per-second) rather than in this changelog,
since it's an infrastructure decision the code doesn't yet reflect a choice on.

⚠️ **Verified**: `handler.py` re-passes `py_compile`; 0 NUL bytes across all four touched
files. **Not verified**: none of the `pycolmap`/`gsplat` API calls have been executed —
same standing caveat as before this rewrite, now narrower in scope since the largest single
prior risk (compiling COLMAP's C++ stack from source) no longer exists in this file at all.

## Floor Plan pin navigator + drone provenance — brief 6B/6C / Phase 5 & 6 (2026-08-29)

Final two phases of the same unattended overnight build. This closes out the site-survey
brief's phase list end to end — every phase now has *something* built, though several
(this entry's Phase 5 most of all) are deliberately reduced in scope from the brief's more
ambitious wording, and each reduction is stated rather than glossed over. **Run
`migrations/2026-08-29-floor-plans.sql`.**

### Phase 5 — Floor Plan overlay, NOT a real BIM/IFC viewer

⚠️ **Read this before assuming "BIM Model Overlay" means what the phrase usually implies.**
What's built is a **2D floor-plan pin navigator**: upload a floor plan image, place pins on
it, each pin points at a panorama / 3D reconstruction / progress photo, clicking a pin opens
that capture. It does **not** import or register against an authored BIM/IFC model, and it
does **not** attempt true registration of a reconstruction's point cloud onto the floor
plan's coordinate frame — that needs known camera poses relative to the floor plan, a real
separate computer-vision problem, not a small addition here. Same honest-scope-reduction
pattern as Phase 3's cylinder-instead-of-equirectangular panorama; stated in `bim.js`'s own
header comment as well as here.

**New module `bim.js`, new tables `floor_plans` + `floor_plan_pins`.**

- **A pin is a polymorphic reference** (`item_type` ∈ panorama/reconstruction/photo +
  `item_id`), not three nullable FK columns — a pin's target kind never changes after
  placement, so one pair of columns is enough and avoids the "which of the three FKs is
  non-null this time" question a real schema reader would otherwise have to answer.
  ⚠️ **Deliberately no hard FK to any of the three target tables.** A pin surviving its
  target's deletion (rendered as a still-visible, removable marker) is safer than a
  cross-table trigger this module would have to hand-maintain across three other tables it
  doesn't own the lifecycle of.
- **Coordinates are normalized 0..1**, read directly off the *rendered* `<img>` element's own
  `getBoundingClientRect()` at click time — deliberately not an SVG viewBox/CTM matrix
  approach. Because the image sits inside a plain CSS-transformed wrapper
  (`translate(panX,panY) scale(zoom)`), its own bounding rect already reflects the current
  pan/zoom, so `(clickX - rect.left) / rect.width` is resolution- and zoom-independent with
  no matrix math to get wrong. A pin's on-screen position at any zoom level is then just
  `x_norm * 100%` positioned **inside the untransformed image box**, so it scales and pans
  together with the image for free.
- **Pan/zoom**: Ctrl+scroll to zoom (anchored on the cursor so the point under it stays
  visually still), plain drag to pan — the same convention already used elsewhere in this
  app's site-plan viewers (plain scroll is left for the page, matching that precedent).
  ⚠️ **The zoom-anchor arithmetic is exported as a pure function (`BIM._zoomAnchor`)
  specifically so it could be genuinely executed and checked, not just read as source** — a
  wrong sign here makes the image visibly "run away" from the cursor while zooming, which no
  regex check on the surrounding code could ever catch.
- **Opening a pin never re-implements a viewer** — it calls back into whichever module owns
  that capture type (`PANO.open(id)`, `RECON.openById(id)`, `ProgressPhotos.openPhotoById(id)`),
  so there is exactly one 360° viewer, one 3D viewer, one lightbox in the whole app, each
  reachable from either its own screen or a floor-plan pin. Each of those three functions is
  new/adjusted this pass specifically to be **callable standalone**, independent of whatever
  that module's own screen currently has loaded (`PANO.open` lazy-loads `panoramas` if empty;
  `RECON.openById` falls back to a direct row fetch if the request isn't in its local cache;
  `ProgressPhotos.openPhotoById` sets a fresh single-item `lightboxIds` rather than reusing
  the Photos screen's own filtered array, whose plain `openLightbox(id)` silently falls back
  to index 0 on a miss — exactly the wrong behaviour for a cross-screen deep link).
- **RLS**: read-all-approved / write-writers-only, the generic module-table shape, kept
  explicit in both the migration and `supabase-schema.sql` (two tables sharing one rule,
  rather than folded into the generic single-table RLS loop).

### Phase 6 — Drone capture

⚠️ **Scoped from a reconstructed understanding of this phase, not the brief's exact
original wording** — the source PDF's literal Phase 6 text was not available when this was
written (summarised out of an earlier, now-compacted part of this session), so this is a
best-guess interpretation consistent with the user's explicit standing instruction to answer
based on the best available assumption rather than pause to ask.

`reconstruction_requests.video_source` (`'ground' | 'drone'`, built in Phase 4) already let a
3D-scan request be flagged as drone-sourced, with a **Drone** badge and a source picker on the
request form. This pass extends the **same field name and the same UI convention** to
**panoramas** — a 360° walkthrough can equally be captured by a drone, and having Phase 4's
provenance tag but not Phase 3's would have been an arbitrary gap. `panoramas.source` (new,
`default 'ground'`), a Ground/Drone select on the capture form, and the same Drone badge style
in the gallery.

⚠️ **The insert is tolerant of the column not being migrated yet** — the SAME pattern used
throughout this module for every schema-dependent field: on a "column does not exist" error
the insert retries once with `source` stripped, so a capture is never lost over one optional
provenance tag.

⚠️ **Nothing beyond the tag was built** — no flight-path/altitude metadata, no drone-specific
capture flow (the video is still uploaded the same way a phone-recorded one is; this app has
no access to a drone's own flight-controller data), and Equipment Loading's separate drone
inventory (if any) is untouched. If the original brief's Phase 6 asked for more than
provenance tagging, that gap should be checked against the actual PDF text once it's back in
context.

### Verified (2026-08-29)

**217 checks, 0 failures** (`test.js`, up from 184) — 30 new checks for Phase 5 (the scope
note is present in source; both tables' shape, constraints, cascade rule, and RLS; every new
`bim.js` function exists; the tab/tools/screen-host/init-call/setScreen wiring in `index.html`;
a pin never gets three separate FK columns; opening a pin calls back into the OWNING module
rather than re-implementing a viewer; only done reconstructions are offered when placing a
pin) plus **3 genuinely EXECUTED checks of the zoom-anchor math** — `bim.js` has no top-level
side effects, so it was loaded into the same Node `vm` context already used to execute
`module.js`/`ppr.js`, and `BIM._zoomAnchor` was called with real numbers and its output
checked against the actual geometric invariant (the cursor's world point maps back to itself
after a zoom change; a full zoom-in-then-zoom-out round-trip returns the exact original pan
with no drift; a same-to-same zoom is a no-op) — not just matched against a regex pattern in
the surrounding source. 7 new checks for Phase 6 (column declared + folded into schema.sql,
form field present, value threaded into the save, tolerant-retry present, badge present, and
that it's the same field-name convention Phase 4 already established).

0 NUL bytes across every touched/new file; `node --check` clean on `bim.js` (new),
`pano.js`, `recon.js`, `module.js`, `test.js`; CSS braces 281/281; **0 functions lost** from
`module.js`/`pano.js`/`recon.js` against the last commit (a small function-name-set diff
under-counts functions added as anonymous property values — e.g. `allPhotos: function(){}` —
but a name that DISAPPEARS from that set is unambiguous, and none did).

⚠️ **NOT verified**: no signed-in click-through of any of this — uploading a real floor plan,
placing a real pin, and opening it back up to confirm the right viewer opens with the right
item have only been checked as source-level wiring + the one piece of pure math that could be
executed without a DOM/auth stack. The migration has not been run. This is consistent with
every other client-only surface built this session (Phase 3's stitching pipeline is the one
exception, verified in a real browser) — flagged plainly rather than left ambiguous.

## 3D Reconstruction Requests, gated behind admin approval — brief 6A / Phase 4 (2026-08-29)

Continuation of the same unattended overnight build authorized after Phase 3. Owner's
explicit architecture decision going in: **self-hosted GPU pipeline (COLMAP + OpenSplat on
RunPod Serverless), not a hosted photogrammetry API** — chosen for cost and because the
brief calls for open-source tooling. Owner's second explicit requirement, given as this is
a **paid feature** (a real per-job GPU cost): *"requests to process 3d images should go
through admins before being processed by runpod."* This entry is the client + database +
Edge Function half of that pipeline — the RunPod worker itself (Dockerfile/COLMAP/OpenSplat/
`handler.py`) is a separate, not-yet-built piece; see "What is NOT done" below.

**Run `migrations/2026-08-29-reconstruction-requests.sql`.**

### The admin-approval gate is enforced by the DATABASE, not the UI

This is the part worth getting right, since a UI-only gate is not a gate at all — anyone who
can see the "Approve" button in DevTools can call the underlying write directly.
`reconstruction_requests` therefore does **not** use this module's usual generic
`for all using (is_writer())` RLS shape (used by `panoramas` and every other table here).
Three separate policies instead:

- **INSERT** — any project writer may create a request, but **`with check` forces
  `status = 'pending_approval'`** — a client cannot insert a row that is already `'queued'`
  or `'done'`. This is the only way a row is ever born.
- **UPDATE** — **admin/super_admin only, in both `using` and `with check`** (mirroring the
  `with check` lesson already recorded elsewhere in this file for row-ownership updates — a
  `using`-only rule would let a row be updated *out of* the admin-only state as easily as into
  it). A non-admin writer can only read their own requests and retract one that is still
  `pending_approval` (a plain `delete`, not an update).
- **DELETE** — the requester (their own row) or an admin, and only while `status =
  'pending_approval'` — once a job is queued, retracting it client-side would leave an
  orphaned RunPod job with nothing in the database pointing at it.

So even if `recon.js` were deleted entirely and someone drove the REST API directly, a
non-admin still cannot move a request past `pending_approval`, and the client's own
`approveRequest()` is not the enforcement — it is only the UI for a workflow the database
already refuses to let anyone but an admin complete.

### The Edge Functions are the second gate, not the first

`submit-reconstruction` — the **only** path that can ever call RunPod — re-checks the
caller's role itself (admin/super_admin, read from the `users` table via the JWT's `sub`
claim, decoded from the token's own base64 payload rather than a GoTrue round-trip) before
doing anything. This is belt-and-braces on top of the RLS gate above, not a replacement for
it: if the RLS check were ever weakened, this function's own check still blocks a non-admin
from reaching RunPod. It:

1. Confirms the request is still `pending_approval` (`.eq('status','pending_approval')` on
   both the initial read intent and the final `update`'s WHERE clause — the second one is
   what actually prevents a double-submit race between two admins clicking Approve at once).
2. Signs a **24-hour short-lived URL** to the video — not the service-role key, not a
   public URL. This is the narrowest credential RunPod's worker needs to do its one job.
3. POSTs to RunPod's async job endpoint (`/v2/{endpoint}/run`) with a **webhook URL carrying
   a per-request random token** (`crypto.randomUUID()`), and stores that same token on the
   row.
4. RunPod's API key and endpoint id live only as this function's own secrets
   (`RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`) — never sent to, or readable from, the browser.

`reconstruction-webhook` — the callback RunPod invokes when the job finishes. ⚠️ **It cannot
require a Supabase JWT**, because RunPod has no Supabase session to send one — the one
deliberate exception in this repo to "every Edge Function deploys with JWT verification on."
Its actual security is the **token check**: the URL RunPod was given carries
`?request_id=…&token=…`, and the function refuses to write anything unless
`token === reqRow.webhook_token` for that exact row. Deploy note is written directly into the
file's header comment (`--no-verify-jwt`) so it can't be missed at deploy time.

### Result viewer

`openResultViewer()` reuses **Three.js r128's official `PLYLoader` addon** (same pinned
revision as Phase 3's cylinder viewer, one more `<script>` tag, no new library) to render
the returned point cloud as `THREE.Points`, with a small hand-rolled spherical-orbit camera
(drag to orbit, scroll to zoom) — not the separate `OrbitControls.js` addon, since a single
interaction didn't justify pulling in a second file. ⚠️ **The point cloud, not the trained
splat file, is what's rendered here** — COLMAP's sparse/dense point cloud is what a future
measurement tool (Phase 5) can actually query point-by-point; the splat file is view-only and
has no natural "click a point" semantics. `result_splat_url` is stored and falls back as the
viewer's source if no point cloud was returned, but nothing yet *renders* a real Gaussian
Splat (that would need a splat-specific renderer, e.g. `gsplat.js` — not pulled in, since
there is no real splat file to render against yet; see below).

### Verified (2026-08-29)

**Structural / wiring verification is real** (Deno type-checked + a Node harness), but the
piece that would prove the *pipeline* works — an actual RunPod job — cannot be exercised here.
Stated plainly rather than left ambiguous:

- **Both Edge Functions type-check cleanly under a real Deno compiler** (`deno check`,
  Deno 2.9.6/TypeScript 6.0.3, downloaded via a portable no-admin-rights install specifically
  so this could be checked rather than left as "should be valid TypeScript"). Sanity-gated:
  the same `deno check` command was first run against a deliberately broken file to confirm
  it actually fails on a real type error, and against an existing already-shipped function to
  confirm a clean pass means something.
- **30 new checks in `test.js` (154 → 184, all green)** covering: the RLS policy shape itself
  (INSERT forces `pending_approval` via `with check`, UPDATE is admin-only in both `using` and
  `with check`, DELETE is requester-or-admin and status-gated) is present in the migration
  text; `submit-reconstruction` re-checks status server-side, signs a short-lived URL (not a
  broad credential), never leaks the RunPod key to the client, and re-asserts
  `status='pending_approval'` in its final UPDATE's WHERE clause; `reconstruction-webhook` is
  documented as needing `--no-verify-jwt` and checks the per-request token **before** any
  write; and the client never offers a way to bypass the gate — `submit-reconstruction` is
  called only from `approveRequest()`, never from the insert path, and `rejectRequest`/
  `retractRequest` never touch it.
- 0 NUL bytes across every new/touched file; `node --check` clean on `recon.js`; `module.js`/
  `ppr.js`/`pano.js` are byte-identical to the last commit (0 functions could have been lost —
  they weren't touched); CSS braces 264/264 balanced.

⚠️ **NOT verified, and this is the real gap**: no RunPod job has ever actually run. Nobody
has clicked Approve against a live Supabase project, so the whole chain —
insert→approve→RunPod submission→webhook→viewer — has never executed end to end. That first
real click is the actual integration test, and it cannot happen without: (a) a RunPod account
and a deployed serverless endpoint (owner-only — account creation and payment details are
things this environment is explicitly barred from doing regardless of technical ability),
(b) the two Edge Functions actually deployed (`supabase functions deploy …`, `supabase
secrets set …`), and (c) the migration run. Until then the module correctly shows an empty
approval queue and the 3D tab works structurally with nothing to display.

### What is NOT done — the RunPod GPU worker itself

⚠️ **The single biggest incomplete piece of this whole session's work.** `submit-reconstruction`
POSTs a job to a RunPod serverless endpoint that does not exist yet — there is no Dockerfile, no
COLMAP/OpenSplat build, no `handler.py` implementing RunPod's serverless handler contract, and
no deployed endpoint for `RUNPOD_ENDPOINT_ID` to point at. This is being built next, in
`services/reconstruction-worker/`, but it will be **written against COLMAP's and OpenSplat's
documented CLIs and RunPod's documented handler contract, not execution-verified** — this
environment has no GPU and no Docker (`docker --version` fails; the only GPU present is
integrated Intel Iris Xe, confirmed via `wmic path win32_VideoController get name`), so the
worker cannot be built or run here. Flagged explicitly rather than presented with the same
confidence as the harness-tested client code above.

## Panoramic Capture — brief Sections 2 & 6 / Phase 3 (2026-08-29)

Owner authorized an extended unattended build session through the rest of the brief's phases,
after settling Phase 4's architecture (self-hosted RunPod GPU worker) in discussion. Starting with
Phase 3, the piece that fits entirely inside this app's existing client-side/Supabase stack with no
new infrastructure — genuinely buildable and, unusually for this build, **genuinely testable**: the
Browser pane here can execute real WASM/WebGL, which most of this session's other work cannot rely on.

**Run `migrations/2026-08-29-panoramas.sql`.**

### The pipeline, and where it deliberately falls short of the brief's literal wording

Capture (new "360°" screen): pick a location (same `locCombos()`/`photoLocCombos()` union already
built for Report Templates), then either record via `getUserMedia`+`MediaRecorder` or upload a
pre-recorded video (kept as a first-class path, not just a fallback — camera access is unreliable
to exercise outside a real phone, and it's a legitimate capture method on its own). Frames are
pulled client-side from a hidden `<video>` + canvas at evenly-spaced timestamps — no ffmpeg needed.

⚠️ **Standard browser builds of OpenCV.js do NOT expose `cv.Stitcher`** — confirmed live (see
Verified, below): loading the real CDN bundle and checking `typeof cv.Stitcher` returns
`"undefined"`. Its JS bindings were never added to the default build whitelist; this is a known,
documented limitation, not something specific to the package chosen here. So stitching is built
from OpenCV.js's lower-level primitives instead — ORB feature detection, BFMatcher (Hamming) with a
ratio test, `cv.findHomography` (RANSAC), `cv.warpPerspective` — composited sequentially, frame N
onto the mosaic already built from frames 1..N-1.

⚠️ **The output is a PLANAR mosaic on a Three.js CYLINDER, not a true spherical/equirectangular
panorama**, despite the brief's literal wording ("stitch frames into a single equirectangular
panorama"). True equirectangular reprojection needs known camera intrinsics and a rotation-only
motion model between frames — a real, separate piece of computer-vision work, not a small addition
to what's built here. A cylinder handles the brief's actual described use case well (standing in
place and spinning horizontally) without claiming the vertical (up/down) coverage a full sphere
would promise; "optionally tilting up/down once" is captured in the source frames but isn't given
true spherical placement in this version. Stated here plainly rather than silently shipping a
simplified pipeline under the brief's more ambitious name.

⚠️ **Quality is flagged, never hidden.** If any consecutive frame pair matches fewer than
`MIN_GOOD_MATCHES` (12) keypoints, `stitch_quality` is set `'poor'` and the panorama still saves
(better than losing the walkthrough) but carries a visible "Low confidence" badge in the gallery —
brief 6.2's explicit requirement ("flag sessions with poor stitching quality... rather than silently
publishing a bad panorama").

### Viewer and comparison

360° viewer: a Three.js cylinder, texture mapped inward, camera at the centre, drag to look around
(mouse + touch). **Compare over time**: picks two captures at the same location and blends between
them via a slider. ⚠️ **A discrete texture swap at the 50% crossover, not a true per-pixel GL
cross-fade** — a real cross-fade needs a custom shader (two texture samplers blended in a fragment
shader), which is a reasonable next increment but wasn't built here; a discrete swap still answers
"did this change?", just without the smooth blend the brief's "opacity slider" phrasing implies.
Split-screen dual-viewer (the brief's other suggested option) was not built — a single shared camera
guarantees both panoramas look the same direction, which two independently-dragged viewers cannot.

### Schema

`panoramas` mirrors `progress_photos`' location tagging exactly (`location_values` jsonb +
`location` display cache + `activity_id`/`activity_name` snapshot) so it reuses the same picker and
combo logic with no new location model. Folded into the generic module-table RLS loop — no special
approval gate (unlike the paid Phase 4 reconstruction feature going in next).

### Verified (2026-08-29) — genuinely executed, not just written

⚠️ **This is the one part of this session's Phases 3-6 work with REAL execution verification of the
novel algorithmic code**, not just structural regex checks — the Browser pane here runs actual
Chromium with WASM/WebGL, unlike the GPU worker (Phase 4), which needs hardware this environment
doesn't have. Built three throwaway test pages (not committed — scratch only), served over a local
Node static server, and drove them with the real shipped CDN libraries:

1. **The stitching pipeline against 5 synthetic overlapping frames** (a rich checkerboard+circles+
   lines pattern, panned across 5 crops): `cv.Stitcher` confirmed `undefined`; ORB+BFMatcher+
   findHomography+warpPerspective produced a correctly-aligned 2000×300 mosaic in 1.78s, matches per
   pair 164–402 (well above the 12-match floor), `quality: 'ok'`. **Screenshotted** — the checkerboard
   squares, circles and diagonal lines all continue coherently across the full width with no visible
   tearing or misalignment.
2. **The 'poor' quality flag against 4 genuinely disjoint (pure-noise, no shared content) frames**:
   0 matches on every pair, `quality: 'poor'` — confirming the failure-detection path actually
   triggers rather than only existing in the code.
3. **The Three.js cylinder viewer**: real WebGL 2.0 context created, a texture mounted and rendered,
   `gl.readPixels` confirmed the exact texture colour (`0x3366aa` → `51,102,170`) came back at the
   render target — proving the geometry/texture/render pipeline genuinely works, not just parses.

**154 checks in `test.js`** (up from 131) cover the structural/wiring side — schema, RLS-loop
inclusion, every new function present, the CDN scripts pinned and correctly named, the screen
dispatch wired, the quality-flag logic pattern present in source. 0 functions lost in `module.js`/
`ppr.js` (pano.js is new, so nothing to diff there). 0 NUL bytes; CSS braces 249/249; the new
`#fff` use (`.pano-badge-warn`, white text on the solid `--pd-warn` background) added to the
context-based allow-list this module's own harness now uses.

⚠️ **Not verified**: real device camera capture (`getUserMedia`/`MediaRecorder` — needs a real phone
or a browser with camera permissions granted, neither available here), a real multi-minute walkthrough
video (only synthetic frames were tested), and signed-in click-through against real Supabase (no login
available in this environment). The gap between "the algorithm works" (verified) and "the whole
feature works end-to-end against a real capture" (not yet) is real and should be the first live test.

## Report Templates + real PPTX/PDF export — brief Section 5 / Phase 2 completed (2026-08-29)

Owner asked to confirm all 15 items from the 2026-08-28 feedback round were captured (they were —
re-verified directly against the shipped code, not just the changelog), then to continue through
every remaining phase of the site-survey-app brief. Phase 1 (schedule integration + streamlined
capture) is built but not yet live-verified; Phase 3+ (360° panoramas, 3D/Gaussian Splatting, BIM
overlay, drone capture) need new infrastructure this app's stack doesn't have and are being taken
one verified increment at a time, starting here with the piece that fits the existing stack
cleanly: **Phase 2, Reporting.** The Meetings/slides screen already covered slide *assembly*; what
Section 5 actually asks for — a **saved, re-runnable report definition** with a comparison rule,
and **PPTX/PDF export**, not just the offline HTML copy — was still missing.

**Run `migrations/2026-08-29-ppr-report-templates.sql`.**

### Report Templates (`ppr_report_templates`)

A template is a saved definition — name, meeting type, an ordered list of locations, and a
comparison rule — reached from a new **Templates** button on the Meetings screen (a sub-view of it,
not a fourth top-level tab: running a template produces an ordinary Meeting, so it belongs where
Meetings live, not beside them).

- **`locations` is a JSONB array, not a join table** — the same call as `equipment_site_plan.plan`
  (2026-08-24): a template's location list is read and written as ONE ordered list in a single
  builder screen, never queried location-by-location, so a relational table would only add
  round-trips for no query benefit. Each entry: `{key, label, values, baseline_photo_id}` — `values`
  is a `location_values` map, matched the exact way `resolveActivity()`/`lastCaptureAt()` already
  do (superset equality on every non-empty key), so a template location resolves photos by the same
  rule as everywhere else in this module.
- **The location picker's universe is the UNION of two sources**, not just one. `locCombos()`
  (module.js) only enumerates locations the **schedule** currently declares — a real photographed
  location that the schedule no longer lists (a completed zone already dropped from it, or a shot
  taken before its zone existed there) would otherwise be un-pickable for a template even though
  real photos exist. New `photoLocCombos()` derives the same shape from the **photo library**
  instead, and ppr.js's `allLocationCombos()` merges them — schedule wins on a key collision (more
  current source), photo-only locations fill in what the schedule doesn't know about. Both are new,
  minimal exports off `ProgressPhotos` (module.js), keeping `LOC_LEVELS`/`locBreadcrumb` in one file.
- **Comparison is TEMPLATE-LEVEL, not per-location** — matches the brief's own phrasing ("the
  comparison window… this week vs last week, or this week vs baseline"), one rule for the whole
  report. Two modes:
  - **`previous`** — always live: latest photo at a location vs. the one captured before it.
  - **`baseline`** — latest vs. a photo **pinned once per location**, picked in the builder from a
    dropdown scoped to photos already captured there. ⚠️ **`baseline_photo_id` is a SOFT reference —
    no FK, since it's inside jsonb** — resolved at generate time and **flagged, not silently
    dropped**, if the photo has since been deleted.
- **Generate ("Run") never destroys anything** — it only ever creates a NEW meeting, so there's no
  confirm step; the button just disables itself for the duration to block a double-click from
  double-generating.
- ⚠️ **A location with no photo yet still gets a slide, deliberately** (`after_photo_id: null`,
  rendering the existing "Photo not set" placeholder) — omitting it would make a location on the
  report list silently vanish, which reads as "nobody noticed it was missing" rather than "nobody
  has shot it yet." Same for a deleted baseline photo: reported in the completion toast
  ("2 locations still have no photo; 1 baseline photo no longer exists"), never hidden.
- **If nothing at all has a photo, no meeting is created** — an entirely empty report has nothing to
  present and would just be clutter in the Meetings list.
- After a successful generate, the new meeting opens straight into its slide editor — the same rule
  item 4 established on 2026-08-28 ("after adding PPR, it should go to PPR edit").

### Real PPTX and PDF export (the offline HTML copy was never actually either format)

The existing "Download" button produces a self-contained offline `.html` — useful, but not what
Section 5 asks for ("exportable as a slide deck (PPTX) or PDF suitable for presenting directly in a
meeting"). Two new buttons on every meeting row.

- **PDF** — `html2pdf.js@0.10.1`, the exact pinned version `issues-lessons` already loads for its
  MoM export, loaded the same way (a single CDN `<script>` tag, no build step). ⚠️ **Followed that
  module's own hard-won rule to the letter: the captured element must stay in NORMAL FLOW.**
  `issues-lessons`' 2026-08-22 entry documents shipping a PDF export with `position:fixed` on the
  rendered node and it producing a **byte-identical blank page on every export, with no error** —
  html2pdf clones the source into its own container to measure it, and an out-of-flow element
  contributes nothing to that container's height, so html2canvas gets the right width and a height
  of **zero**. The off-screen parking here lives on a **holder**; the captured `wrap` sits in
  normal flow inside it — verified structurally (asserted in `test.js`) so this can't quietly
  regress into the same bug the way that module's first attempt did.
- **PPTX** — `pptxgenjs@3.12.0`, loaded from `cdn.jsdelivr.net/npm/…` (verified resolvable and
  confirmed a real UMD bundle before committing to it — jsdelivr's npm-pinned CDN is already this
  app's own convention for `@supabase/supabase-js`, not a new vendor). One slide per report slide,
  before pane left / after pane right (or centered alone with no before photo). ⚠️ **PptxGenJS's
  `data` option for `addImage()` takes the base64 payload WITHOUT the `data:` prefix**
  (`"image/jpeg;base64,…"`, not `"data:image/jpeg;base64,…"`) — verified against the library's own
  documented example before writing `stripDataPrefix()`, since `canvas.toDataURL()` (this module's
  own `toDataURL()`) always includes that prefix and passing it through unstripped would have
  produced a deck with broken images in every slide, silently.
- **All three formats — offline HTML, PDF, PPTX — now share ONE image-collection function**
  (`collectSlideImages()`, extracted from what used to be `exportOffline()`'s own inline loop) and
  one slide-markup function (`slideFigureHTML()`/`slidesBodyHTML()`, extracted from the old private
  `figure()`/the body of `offlineHTML()`). Three formats each embedding images their own way is
  exactly how one export ends up showing a different picture of the same slide than another —
  this closes that off structurally, not by convention.

### A harness fragility this round tripped over, and fixed properly

Adding one legitimate new `#fff` use (`.ppr-tmpl-locorder`, white text on a solid `--pd-red` badge —
the same class of exception as the lightbox overlay) broke the 2026-08-28 harness's
`fffTotal === 10` assertion — exactly the fragility that entry's own closing note warned about
("assert `#fff` by context, not count"). Fixed properly rather than bumping the magic number:
the check now extracts every CSS rule containing `#fff`/`#ffffff` and asserts each one's **selector**
matches a documented allow-list of fixed-brand-background contexts (the lightbox family, the new
badge, and — found only by fixing this — three more pre-existing legitimate uses the old total had
been silently including all along: `.pp-tab.active`, `.pd-btn-primary`, `.pp-del:hover`,
`.pp-syncbtn:hover`, each confirmed to pair `#fff` with `background: var(--pd-red)`/`var(--pd-bad)`
before being allow-listed). A genuinely stray `#fff` on a real light surface still fails; a new
*legitimate* one no longer requires touching this assertion at all.

### Verified (2026-08-29)

**131 checks, 0 failures** (`test.js`, up from 85) — every item above, plus a behavioural
cross-check of the resolution algorithm itself (same style as 2026-08-28's copy-previous check):
`previous` vs `baseline` picks, a first-ever capture correctly leaving `before` null instead of
guessing, a deleted baseline correctly flagged rather than silently reassigned, a location with no
photos yet still producing a (empty) slide, and `allLocationCombos()`'s schedule-wins-on-collision /
photo-only-fills-gaps merge rule. **0 functions lost in `module.js`; ppr.js lost exactly one
(`figure`, promoted from a private nested function to the module-level, reused `slideFigureHTML`) —
deliberate, not a regression.** 0 NUL bytes across every touched file; CSS braces 227/227; the new
migration's own `create table` also appears in `supabase-schema.sql`'s per-module RLS array.
`node -c` clean on `module.js`, `ppr.js`, `test.js`.

⚠️ **Not verified signed in** — no live click-through of Generate against real Supabase, and neither
the PDF nor the PPTX has been opened as a produced file (unlike `issues-lessons`' PDF fix, which was
verified by inspecting the actual bytes of a generated PDF — that level of verification needs a real
browser with the CDN libraries actually loaded, which this environment doesn't have). The CDN URLs
for both libraries were fetched and confirmed to resolve to real UMD bundles before being committed
to, and the `data:`-prefix behaviour was checked against PptxGenJS's own documented example — but
neither substitutes for opening an actual exported file. **Priority for the next live pass**:
generate a template against a real project with photos at 2+ locations, and open both exported files.

## Owner feedback round: Works choices, per-photo key plans, PPR→Meeting, photo-first slides, tile view (2026-08-28)

Fifteen items from the owner's review of the live Phase-1/Phase-2 build, against
`site-survey-app-build-brief` (Sections 3–5). Grouped below by the surface they
touch. **Run `migrations/2026-08-28-photo-keyplan-and-ppr-meeting.sql` before
deploying** — the key-plan move needs the new column.

### Photos Database

- **Works is now a real `<select>`, not free text** (items 1 & 2). It was an
  `<input list="pp-works-list">`, so the datalist was only ever a *suggestion* —
  any typo saved fine, which is exactly the "no choices to control inputs"
  complaint. Now a constrained dropdown built from `worksOptions()` (schedule
  activities scoped to the picked Trade, unioned with values already used on the
  project), rebuilt live on Trade change by `refreshWorksSelect()`.
  - ⚠️ Kept a **`+ Add new Works value…`** option deliberately. The three
    preceding entries (2026-08-13e/f/g) are an unresolved live bug where this
    dropdown came back **empty** on Avesta. Making the field strictly closed
    while that's still outstanding would turn a cosmetic problem into a
    hard block on capturing any photo. The escape hatch prompts for a value and
    inserts it as a real option, so input stays governed but never dead-ends.
  - The shared `<datalist id="pp-works-list">` is **removed from `index.html`**;
    nothing references it now.
- **Required fields** (item 2) were already gated by `requiredFieldsMissing()`
  (added 2026-08-13b) — verified still enforced on both the Add and Edit paths
  for capture date, trade, works, and the first two Location Breakdown levels.
- **Key plan moved from the slide to the PHOTO** (item 6). New
  `progress_photos.key_plan_url`; both photo forms carry a key-plan field.
- **Key plan upload/selection wizard** (item 11): `openKeyPlanWizard()` shows the
  key plans already uploaded to this project as a pickable thumbnail grid, plus a
  file input for a new one. Uploads go to `<project>/keyplans/` as before. This
  is the point of moving it per-photo — the same key plan is reused across many
  photos at one location, so re-uploading it per slide was the actual friction.
- **Tile (Gallery) view is the photo only** (item 14). Dropped the per-card
  detail table and the inline action icons; the tile is now just the image.
  Download / view / edit / delete moved into the **lightbox** (`.pp-lb-tools`),
  shown on open, with edit+delete hidden for non-writers. **List view keeps its
  row actions** — it's the dense working grid and the icons belong there.
- **Tile grouping** (item 15): group-by **Month captured (default)**, Year,
  Location, or Activity, via `galleryGroupBy` + `groupForGallery()`. Month/year
  sort newest-first; location/activity sort alphabetically with "Unassigned"
  last. Choice persists per project (`pp_gallerygroup_<pid>`).

### Meetings (was "PPR Presentations")

- **Renamed PPR → Meeting throughout the UI** (item 3): tab, screen title,
  topbar actions, list header, modals, empty states, and the offline export's
  title/filename. One record now serves both a PPR meeting and a client meeting,
  distinguished in the Description.
  - ⚠️ **DB names deliberately unchanged** — `ppr_presentations`, `ppr_slides`,
    `ppr_date`, `ppr_id`, and the `PPR`/`ppr-*` JS identifiers all stay. This is
    a label change; renaming tables/columns would need a data migration and
    would break `supabase-schema.sql`'s RLS loop, the storage policies, and
    every existing row, for zero user-visible gain.
- **Fixed: list icons (open / download / delete) were not showing** (item 5).
  Root cause was **not** the markup. `render()` was the only place calling
  `Icons.hydrate($('ppr-view'))`, but `renderList()` is invoked **directly** by
  the two date filters, the clear-filters button, and (previously) the row
  click — so on any of those paths the `data-ico` placeholders were never
  swapped for SVG and the buttons rendered blank. `renderList()` and the
  empty-state branch now hydrate their own output via a local `hydrate()`.
  Also swapped the Edit action's `✎` text glyph for the real `pencil` icon so
  the whole cluster is consistent.
- **Clicking a meeting row opens it** (item 12) — `openPpr(id)` on row click.
  Previously the row only *selected* (driving the preview pane) and opening
  needed the arrow icon. The icon is kept for discoverability; both go through
  `openPpr()`.
- **After creating a meeting, jump into its slide editor** (item 4). The insert
  now uses `.select()` to get the new id back and calls `openPpr(newId)`.
- **Copy a previous meeting when creating one** (item 13). Optional picker on the
  New Meeting form; `copySlidesFrom()` clones the chosen meeting's slides,
  **promoting each slide's "after" (current) photo into the new slide's "before"
  slot** and leaving "after" empty for this period's capture. The after-caption
  travels with the photo it describes (becoming the before-caption); the new
  after-caption starts blank. This is the recurring-capture workflow from
  brief §4/§5 — a monthly meeting is mostly last month's slide list with one
  new photo each.

### Slides — now photo-first

- **Slides are built by picking photos, not by typing locations** (item 7). The
  slide form's Trade / Works / Location inputs are **gone**. Those are properties
  of the photo, already captured in the library; asking again invited drift
  between a slide and the photo it shows.
- **"+ Add photo" inline on both pickers** (item 8) — no trip to the Photos tab
  for a missing shot. Reuses the Photos screen's own Add-photos modal via a new
  `ProgressPhotos.openUploadForPicker(onDone)` hook, then selects the new photo.
  - ⚠️ **`doWrite`'s insert needed `.select()`**: supabase-js v2 returns
    `data: null` on a bare `insert()`, so `saveCapture()` had *always* returned
    `id: undefined` — harmless until now, but this feature depends on it. Also
    added a fallback that diffs the library before/after the upload, since
    PDSync's offline outbox genuinely cannot report an inserted id.
- **Before/after may be at DIFFERENT locations** (item 9). `pane()` reads each
  photo's own trade/works/location and renders them per-pane (`.ppr-panetags`),
  with Before/After labels. The slide-level meta row now carries only the key
  plan toggle. `ppr_slides.trade/works/location` are **deprecated, not dropped**
  — still read as a fallback when a pane has no photo linked, so pre-migration
  slides render unchanged.
- **No before photo → no before caption, and the photo centers** (item 10). The
  caption field is hidden until a before photo is picked (`syncBeforeCaption()`)
  and `before_caption` is force-nulled on save when there's no before photo.
  The slide renders `.ppr-pair-single` (a single centered column) instead of a
  half-width photo beside an empty "Photo not set" frame. Mirrored in the
  offline export (`.pair.single`).
- **Key plan overlay is per-pane** — `keyPlanPathFor(slide, which)` prefers the
  photo's own `key_plan_url` and falls back to the legacy slide-level one, so
  each side of a comparison can carry its own key plan. Offline export collects
  and inlines both.

### Verified (2026-08-28)

Harness-verified (`test.js`, stubbed `AppAuth`/`PDb`/`UI`/`Fmt`/`Icons` +
in-memory store with cascade-delete emulation; both real modules loaded via
`vm`): **85 checks, 0 failures.** Covers every item above — the Works select
markup and the datalist's removal, the required-field gates, all rename surfaces,
`openPpr` on row click, post-create navigation, per-photo key-plan resolution
incl. legacy fallback, the photo-first slide form and inline-add hook, per-pane
tags, before-caption hiding + centering, gallery grouping (month-label
formatting asserted behaviourally: `2026-06` → "June 2026"), lightbox action
wiring + role gating, list-view actions retained, migration idempotency, and
dark-mode token use in all new CSS.

Copy-previous semantics were asserted **behaviourally**, not just structurally:
a two-slide fixture (one pair, one single-photo slide) confirms the after photo
becomes the before, the after slot clears, captions follow their photo, and
slide numbers resequence.

⚠️ **Two harness bugs surfaced first and were fixed in the harness, not the
module** — a quote-char mismatch in the row-actions regex, and a blanket
"no `#fff`" assertion that ignored the 8 pre-existing legitimate uses on the
dark lightbox overlay (the 2 added are `.pp-lb-tool` text on that same overlay).
Worth knowing for whoever tests next: assert `#fff` by *context*, not count.

### Pending

- **Live click-through** against a real login, the real bucket and real photo
  volumes — everything above is harness-verified only. Priority: the Works
  dropdown on **Avesta**, which is still the open item from 2026-08-13g. The
  unconditional `console.info` summary that entry added is still in place and
  is still the fastest diagnostic; the new `<select>` does not change what
  `worksOptions()` returns, so **if it was empty before it will be empty now** —
  the `+ Add new Works value…` option is the mitigation, not the fix.
- `ppr_slides.key_plan_url` / `trade` / `works` / `location` can be dropped in a
  later cleanup migration once no pre-migration slides remain in use.
- Brief §5 proper (saved report templates, comparison rules, PPTX/PDF export)
  is still unbuilt — the Meetings screen is the manual precursor to it.

## Third live "Works dropdown still empty" report, no diagnostic fired — added an unconditional load summary (2026-08-13g)
Owner tested the 2026-08-13f diagnostics live and reported the dropdown **still empty**, this time
with a DevTools console screenshot as evidence — but the console showed only browser-level Tracking
Prevention warnings for the Supabase CDN and a generic Intervention notice. **No
`[progress-photos]`-prefixed line at all**, not even the `console.warn` the previous fix added for
a failed root-code resolution. That absence is itself informative: either `loadSchedule()` never
actually resolved to that warning branch (something else is failing earlier/differently than either
of the last two fixes assumed), or DevTools was opened after the relevant console output had
already scrolled past on an earlier page load.
- Reviewed `sw.js` (the repo's app-wide service worker) as a possible stale-cache culprit before
  touching module code again — it is network-first for same-origin requests and passes cross-origin
  Supabase calls straight through uncached, so it's an unlikely explanation on its own.
- Rather than guess at a fourth increasingly specific failure mode, added an **unconditional
  diagnostic summary** at the end of every `loadSchedule()` call — `console.info`, fires on every
  successful load regardless of whether resolution succeeds or fails, not gated behind an error
  branch like the previous `console.warn`. Logs: how many non-summary activities loaded, the
  resolved `EXEC_WBS_CODE`/`CLOSEOUT_WBS_CODE` values (or `null`), how many activities fall in
  Execution/Close-out scope, and the count + first 20 names of distinct eligible Works values.
- This makes the **next** live test self-diagnosing no matter which stage is actually failing —
  the one console line says whether the schedule fetch itself returned rows, whether either root
  code resolved, how many activities survived the phase scope, and what Works values (if any) are
  actually eligible — instead of requiring another guess-fix-redeploy cycle blind to which of those
  four things is wrong on the real Avesta data.
- Harness-verified in a fresh fixture (Avesta-shaped: 5 phase branches, 2 Execution sub-branches, a
  boundary-safety trap row, all leaf activities carrying `phase: null` to match the real-data
  condition): the new `console.info` line fires exactly once per `loadSchedule()` call with the
  expected shape — `SCHED_ACTS.length`, both resolved root codes, the in-scope count, and the
  eligible Works name list all matched the fixture's known values (2 non-summary activities, roots
  `"4"`/`"5"`, 1 in scope, `["Rebar Installation"]`) — confirming the format string is correct and
  the summary does not throw. No console errors. `console.info` is wrapped in its own try/catch so a
  failure computing the summary itself (e.g. a bad `SCHED_ACTS` shape) can only warn, never break
  the rest of the load.
- ⚠️ **Next step is on the owner**: reproduce with DevTools open from before the "+ Add photos" click
  (or "Preserve log" enabled) and share the exact `[progress-photos] loadSchedule(...)` line. That
  single line now distinguishes a genuine data-shape difference on the real Avesta project (e.g. WBS
  code drift, an unexpected `activity_type` value, zero rows in Execution/Close-out scope) from a
  stale-deploy/cache issue, which three rounds of harness-verified-but-still-failing-live fixes have
  not been able to rule out from a screenshot alone.
- `MODULE_V`/module `?v=` bumped: `20260813f` → `20260813g`.

## Works dropdown still empty on the second live test — loosened the phase-name match + added diagnostics (2026-08-13f)
Owner tested the WBS-code fix live and the Works dropdown was **still empty**, same screenshot
shape as before (Trade = "Structural Works", red-outlined empty Works field). Two failures in a
row on the same symptom is not something to wave off as "just a cache issue" without also
hardening the code, so this pass does both: makes the phase-name matching itself more forgiving,
and adds console diagnostics so a third occurrence (if the cause is something else entirely) is
debuggable from devtools instead of another guess-and-redeploy cycle.
- ⚠️ **The previous fix's `EXEC_PHASE_RE`/`CLOSEOUT_PHASE_RE` were ANCHORED (`^...$`)** — an exact
  whole-string match against the WBS branch's `activity_name`. If Avesta's real branch is named
  anything other than the literal strings "Execution Phase" / "Closeout Phase" (e.g. a numeric
  prefix from the WBS Manager's auto-numbering, a trailing qualifier, different capitalization
  the anchors didn't tolerate), the anchored regex would find nothing and both root codes would
  stay `null` — silently reproducing the exact "no options" symptom, indistinguishable from a
  stale cache from the outside.
- **Replaced with `branchPhaseFromName()`, copied verbatim (not re-derived) from Project
  Schedule's own `phaseFromName()`** — the identical substring-based rule that module already
  uses to classify a WBS branch by name (`t.indexOf('execution phase') >= 0 ||
  t.indexOf('construction') >= 0` → construction; `t.indexOf('close-out'/'closeout'/'close out')`
  → closeout). Reusing the sister module's own proven function, rather than inventing a stricter
  pattern a second time, is the point — it tolerates exactly the naming variations that module's
  own WBS Manager can produce (e.g. "4. Execution Phase (Construction)", "5. Close-Out Phase").
- **Added console diagnostics** in `loadSchedule()`: if the WBS-Summary query itself errors or
  throws, it's now logged (`console.warn`) instead of silently swallowed like every other
  tolerant fetch in this module; if the query succeeds but resolves **neither** an Execution nor
  a Closeout root code, a warning names the WBS-Summary row count found and says the Works picker
  is falling back to the raw `phase` column alone — turning a silent empty dropdown into an
  actionable console message naming the real cause the next time this is tested live.
- Harness-verified against a fixture using deliberately non-exact branch names —
  `"4. Execution Phase (Construction)"` and `"5. Close-Out Phase"` (numeric prefix + parenthetical
  + hyphenated capitalization) instead of the previous fixture's exact strings: the Works
  datalist still resolved correctly to the 4 Execution/Close-out activities with **no console
  warning fired** (confirming resolution succeeded, not silently degrading to the empty-fallback
  path); Trade-scoping still composed correctly on top. No functional console errors.
- ⚠️ **If the dropdown is still empty on Avesta after this deploy**, the browser console will now
  say why — either a WBS-Summary fetch error/exception, or "Could not find an Execution Phase /
  Closeout Phase WBS branch among N WBS-Summary row(s)" naming the row count actually found. That
  message is the next diagnostic input, not a guess.
- Assets bumped `module.js?v=20260813f` (module.css unchanged this round).

## Fix: live "Works" dropdown was EMPTY on Avesta — phase scoping needed the WBS code, not the raw column (2026-08-13e)
Owner tested the previous entry live: the Works field had **no options at all** on Avesta
Residences with "Structural Works" selected — worse than the prior "too many options" bug,
because now there were none. Screenshot of the WBS Manager showed exactly why: the project's
Execution Phase / Closeout Phase are real top-level WBS branches, but that says nothing about
whether the raw `project_schedule.phase` column is populated on the LEAF activities under them.
- ⚠️ **Root cause, confirmed against Project Schedule's own code, not guessed**: that module
  resolves an activity's phase by **inheriting from the nearest tagged WBS ancestor at read
  time** (`phaseOf()` in `modules/project-schedule/index.html`) — phase is deliberately *not*
  denormalized onto every row, per that module's own documented design ("resolved at read time
  ... so re-parenting a branch re-phases its work with no data fix-up"). The 2026-08-12 migration
  back-filled `phase` onto activities **once**, from branch names, and newer schedule-generating
  paths (Schedule Builder push) stamp it directly — but a real imported P6 schedule like Avesta's
  never went through either of those, so `phase` reads **NULL on nearly every leaf activity** even
  though the activity is unambiguously under the Execution Phase branch. The previous entry's
  "known limitation" note called this out as a risk; it was live within one test.
- **Fix: resolve the Execution Phase / Closeout Phase WBS-Summary rows and test each activity's
  own dotted `wbs` code against them** — the exact mechanism Project Schedule's own
  `execPhaseCode()`/`locCodeUnder()` use for this identical scoping problem (its Location Wizard
  and "Execution Phase only" toggle). `loadSchedule()` now also fetches WBS-Summary rows
  (`activity_type = 'WBS Summary'`) and, from those, finds the row named "Execution Phase" (regex
  `/^execution\s*phase$/i`) and "Closeout Phase"/"Close-out Phase" (`/^close[\s-]?out\s*phase$/i`,
  case/spacing-tolerant — Avesta's WBS Manager literally shows "Closeout Phase", one word),
  preferring the **shallowest** match if more than one name collides. `inExecOrCloseout(a)` then
  accepts an activity if **either** its own `phase` column says construction/closeout **or** its
  `wbs` code is at-or-under one of those two root codes (`wbsUnderRoot`, a boundary-safe prefix
  test — `"4"` matches `"4.1"` but never `"40.1"`).
  ⚠️ **Both checks are kept, not just the WBS one** — a Schedule-Builder-pushed activity that
  already carries `phase:'construction'` directly (per that module's own push payloads) should
  not have to also resolve through a WBS lookup that a hand-typed activity outside any tracked
  branch might not have.
- `SCHED_ACTS` now also selects `wbs` (the activity's own dotted code) alongside `phase`.
- Harness-verified against an Avesta-shaped fixture (5 top-level WBS-Summary phase branches named
  exactly as the screenshot — Milestones / Initiation Phase / Planning Phase / Execution Phase /
  Closeout Phase — plus 2 sub-branches under Execution Phase, and every LEAF Task activity carrying
  `phase: null`, matching the real bug): Works datalist showed exactly the 4 correct activities
  (`Formworks`, `Painting Works`, `Punchlist Repairs`, `Rebar Installation`) resolved purely from
  WBS-code ancestry with zero activities carrying a populated `phase`; a deliberately-planted
  `wbs: '40.1'` "Unrelated Branch 40" row (the boundary-safety trap for code `"4"` vs `"40"`)
  correctly excluded; Design Review (Planning, `3.1`), Bid Submission (Initiation, `2.1`), Key
  Handover Event (Milestones, `1.1`) and the Finish-Milestone-typed "10th Floor" all correctly
  absent; Trade-scoping (Structural → Formworks + Rebar Installation, Architectural → Painting
  Works + Punchlist Repairs) still composes correctly on top of the phase scope. No functional
  console errors.
- Assets bumped `module.js?v=20260813e` (module.css unchanged this round).

## Works scoped to Execution + Close-out phase; Tower & Level required (2026-08-13d)
Owner, confirming the Trade-scoped Works fix: two polish asks on the same picker.
- **Works now excludes Milestones / Initiation Phase / Planning Phase — only Execution Phase and
  Close-out activities are offered.** Project Schedule stores a `phase` column on every activity
  (its own vocabulary: `initiation` / `planning` / `construction` — labelled "Execution Phase" in
  that module's UI — / `closeout`). `phase` was added to `loadSchedule()`'s select and
  `distinctScheduleWorks()` now requires `phase === 'construction' || phase === 'closeout'`.
  ⚠️ **An activity with NO phase stamped at all is excluded too, not guessed in** — e.g. work filed
  under the top-level "Milestones" WBS branch (which has no phase in the four-value vocabulary)
  reads as un-phased and is left out, matching the owner's third exclusion ("Milestone"). This is
  in addition to, not instead of, the existing `activity_type` exclusion of Start/Finish Milestone
  rows (a floor-completion milestone stamped `phase:'construction'` is still excluded by type).
  ⚠️ **Known limitation, stated rather than hidden:** this reads the RAW `phase` column directly.
  Project Schedule's own UI additionally *inherits* phase from the nearest tagged WBS ancestor when
  a row's own `phase` is blank (`phaseOf()`), which this module cannot replicate without loading the
  WBS tree — deliberately out of scope per the Location Breakdown correction earlier this week. In
  practice this is a narrow gap: the phase-tagging migration back-filled `phase` directly onto every
  activity, and every schedule-generating path since (Schedule Builder push, imports) stamps
  `phase:'construction'` directly rather than relying on inheritance — so an Execution-phase
  activity lacking its own stamped phase is the exception, not the rule.
- **Tower and Level are now specifically required** in the Location Breakdown (was "at least one
  level, any level"). `locRequiredLevels()` = the first two `location_levels` by `sort_order` —
  generalizes across projects since level *names* are per-project free text and not guaranteed to
  literally be "Tower"/"Level", but the ordering convention (Tower/Building first, then Level/Floor,
  then Zone/Orientation as optional finer detail) matches every project referenced in this module's
  design. Both Add and Edit modals show a red `*` on each required level's own label (native
  `required` attribute too, cosmetic only — these fields aren't in a `<form>`) plus a dynamic hint
  naming the required levels ("Tower & Level required"); `requiredFieldsMissing` names exactly which
  of the two is missing ("Tower and Level are required." / "Level is required."). Zone (and any
  level beyond the first two) stays optional — a capture stopping at Tower+Level with no Zone picked
  is still valid, per the existing "a capture can stop at any depth" design.
- ⚠️ **Fixed a pre-existing display artifact while touching this code**: a Grep-tool rendering quirk
  had made a comment look like it contained `<\span>`; verified against the actual file bytes via
  Read — the real content was always the correct `</span>`, no code change needed there.
- Harness-verified (fresh v10 fixture: 8 schedule activities spanning `construction` / `closeout` /
  `planning` / `initiation` / null phase, plus a `construction`-phase Finish Milestone to prove the
  activity_type exclusion still applies on top of the phase filter): Works datalist showed exactly
  the 4 Execution/Close-out activities (`Final Cleaning`, `MEP Rough-in`, `Punchlist Repairs`,
  `Rebar Installation`) with Planning/Initiation/un-phased/milestone activities all correctly absent;
  Tower+Level both required (`*` on both labels, Zone unmarked); save blocked with "Tower and Level
  are required." with both blank, "Level is required." with only Tower filled, succeeded with both
  filled and Zone left blank; Edit modal mirrors the same required markers. No functional console
  errors (only the usual harmless stub artifacts — fake `blob:` URLs, one cosmetic 404).
- Assets bumped `module.js?v=20260813d` (module.css unchanged this round).

## Works: exclude floor-completion milestones, scope choices to the selected Trade
## (2026-08-13c)
Owner tested the previous entry live and flagged two remaining defects in the same Works
datalist: floor-level milestones ("10th Floor", "11th Floor", …) were showing up as if they were
real work activities, and picking a Trade did nothing to narrow the choices — the screenshot
showed "Structural Works" selected while the Works dropdown still offered unrelated floor names
and only one genuine activity.
- **Floor markers excluded.** They weren't WBS Summary rows (already excluded) — they're real
  Project Schedule rows with `activity_type` **`Start Milestone`/`Finish Milestone`**, and a
  schedule commonly names a floor-completion milestone after the floor itself. `distinctScheduleWorks()`
  now excludes both milestone types explicitly, leaving only genuine `Task` rows (and anything with
  no/other type, so a legacy row that predates consistent typing isn't hidden by accident).
- **Works now scoped to the picked Trade**, per the owner's explicit ask ("all activity under that
  trade will be the choices for the works, to avoid wrong selection of works under a specific
  trade"). Project Schedule's own Discipline/Trade grouping lives in `project_schedule.work_type`
  (added to `loadSchedule()`'s select) as one of **8 canonical buckets** — General Requirements /
  Site Works / Structural Works / Architectural Works / MEPF Works / Site Development / Allied
  Services / Others (see `modules/project-schedule/index.html`'s `GWORK`/`WORK_ORDER`). This
  module's own Trade vocabulary is **finer-grained** — it mirrors the WPM procurement list and
  splits MEPF into Mechanical / Electrical and Auxiliary / Plumbing and Sanitary / Fire Protection —
  so one Trade maps to several `work_type` keywords, matched case-insensitively (`workTypeMatchesTrade`
  + `TRADE_WORK_TERMS`) rather than by exact string equality, so a schedule using slightly different
  wording still matches on its own vocabulary. Picking any of the four MEPF-side trades correctly
  offers the SAME activities (the schedule doesn't discriminate further than "MEPF Works") — this
  is the honest limit of the real data, not a bug.
- **New `wireTradeWorks(idPrefix)`**: seeds the Works datalist from the modal's current Trade value
  on open (so the Edit modal, which pre-fills an existing photo's Trade, is correctly scoped from
  the moment it opens, with no re-touch needed) and re-scopes it live on every Trade change in both
  the Add and Edit modals. `worksOptions(tradeFilter)` also scopes the union half (values already
  typed on this project's own captured photos) to photos captured under that same Trade
  (`distinctCapturedWorks`), so a stale unrelated free-text entry from a different trade doesn't
  leak into a newly-scoped list. Leaving Trade blank still shows everything (unchanged from before).
- Harness-verified (fresh v9 fixture, 10 schedule rows incl. 2 floor milestones, 1 WBS Summary, and
  Task rows spanning Structural/Site/Architectural/MEPF `work_type`s): no-trade-selected datalist
  showed exactly the 6 real activities (milestones and the summary row absent); selecting
  "Structural Works" narrowed to exactly its 2 activities; "Electrical and Auxiliary Works" and
  "Fire Protection Works" both correctly resolved to the same 2 MEPF-bucketed activities;
  "Architectural Works" isolated to its own 1 activity; clearing back to blank restored all 6; the
  Edit modal on a photo already tagged "Structural Works" opened already scoped to its 2 activities
  with no extra interaction. No functional console errors (only the same harmless stub artifacts
  noted in the prior entry).
- Assets bumped `module.js?v=20260813c` (module.css unchanged this round).

## Live-app follow-up: Works had no choices, capture fields weren't actually required
## (2026-08-13b)
Two bugs found testing the previous entry's rebuild against the real deployed app on Avesta
Residences: the Works field's datalist was empty (screenshot showed only "e.g. Temporary
Facilities" placeholder text with no suggestions), and Capture date / Trade / Works / Location
Breakdown were all skippable despite reading as important fields.
- **Works datalist was scoped to the wrong source.** It only ever built from `distinct('works')`
  — values already typed on this project's OWN captured photos — so a brand-new project (or one
  where nobody had typed a Works value yet) showed nothing at all. New `distinctScheduleWorks()`
  reads distinct `activity_name` values off `SCHED_ACTS` (the same Project Schedule activities
  already loaded for the Location Breakdown feature) and `worksOptions()` unions it with the
  existing captured-values list, so both sources suggest and neither is lost.
  ⚠️ **Deduplicated by NAME, not by row** — a real schedule commonly repeats an activity name
  across many WBS branches/floors (e.g. "Rebar Installation" on every level of every tower), and
  offering one option per *row* would flood the datalist with hundreds of duplicate strings.
  WBS Summary rows are already excluded upstream (`loadSchedule`'s `.neq('activity_type','WBS
  Summary')`), so they don't leak into Works either.
- ⚠️ **Fixed a load-order gap that would have silently limited this on the FIRST page view.**
  `init()`/the project-switch handler called `renderLocFilterSelects()` after `loadSchedule()`
  finished, but never re-ran `fillFilterOptions()` (which builds the Works datalist) — so
  `SCHED_ACTS` would be populated in memory but the Works datalist would still reflect whatever
  it was built from during `load()`, which runs *before* `loadSchedule()`. Both call sites now
  call `fillFilterOptions()` (a superset — it already calls `renderLocFilterSelects()` internally)
  after `loadSchedule()`.
- **Capture date, Trade, Works, and Location Breakdown (at least one level) are now required**
  in both the Add-photos and Edit-photo modals. These fields live in a plain `<div>`, not a
  `<form>`, so the native `required` attribute (added for semantics/accessibility) has no
  automatic enforcement — the actual gate is a new `requiredFieldsMissing(idPrefix)` check called
  at the top of both save handlers, returning a specific message ("Capture date is required." /
  "Trade is required." / "Works is required." / "Select at least one Location Breakdown value.")
  shown via `UI.toast('...', 'warn')`, save aborted (row untouched, modal stays open).
  ⚠️ **Location Breakdown requires only ONE filled level, not every level** — a capture legitimately
  stopping at "Tower B" with no Level/Zone picked is still valid per the design in the entry below
  ("a capture can stop at any depth is a deliberate choice"); the new rule only forbids submitting
  with **zero** Location Breakdown values at all. The section header now shows a red `*` + "(at
  least one level)" hint; Description stays optional (unchanged).
- Harness-verified (fresh v8 fixture, 3 location levels, 6 schedule activities including a
  repeated-name pair across two WBS branches and one WBS-Summary row to prove exclusion, run via
  a real local HTTP server rather than `file://` — this environment's Browser pane renders
  `file://` pages as inert static snapshots this session, unlike earlier rounds, so a throwaway
  PowerShell `HttpListener` static server was used instead): Works datalist showed exactly
  `Formworks / MEP Rough-in / Rebar Installation / Site Grading` (4 options, not 5 — the repeated
  name deduped, the WBS Summary row excluded); Add-modal save sequentially blocked on Trade →
  Works → Location Breakdown with the correct message each time, then succeeded once all four were
  filled (row persisted with correct `trade`/`works`/`location_values`/`activity_id`/
  `activity_name`); Edit-modal save blocked identically when Works was cleared. No functional
  console errors (only expected stub artifacts — fake `blob:` image URLs and one cosmetic 404 for
  a shared stylesheet outside the throwaway server's root).
- Assets bumped `module.css/js?v=20260813b`.

## Rebuilt the location picker onto Project Schedule's real "Location Breakdown" system, not
## wbs_nodes (2026-08-13)
Owner's correction after confirming the full WBS tree now renders (previous entry): **"it should
show the Location Breakdown options not the WBS."** Project Schedule has a second, purpose-built
location system, entirely separate from the generic `wbs_nodes` tree this module had been reading —
confirmed by code inspection (research agent) before touching anything, per the standing "inspect
before coding" instruction.
- **The real data model**: `location_levels` (`{id, project_id, name, sort_order, match}` — a
  per-project, **ordered list of free-form level names**, e.g. Tower/Level/Zone, no fixed count or
  labels) + `project_schedule.location` (jsonb `{"<location_level_id>": "value string"}` — one plain
  string per level, **not a node tree**: two activities with the same string under the same level are
  literally the same value, there's no parent-child FK to walk). This is architecturally distinct
  from `wbs_nodes`/the WBS Manager tree, which Project Schedule keeps for structural breakdown only —
  conflating the two was the exact mistake being corrected.
- **Project Schedule's own UI for this is `<input>` + `<datalist>` free text, not `<select>`, and NOT
  hard-cascading** (`locValuesFor(levelId)` just scans loaded rows for distinct values with no
  cross-level filtering) — this module now matches that convention exactly rather than inventing a
  stricter one, so a value schedule planners already typed is always pickable and a not-yet-typed
  one can still be entered fresh.
- **Replaced the entire WBS cascade with a Location Breakdown cascade**: `LOC_LEVELS` (was
  `WBS`/`WBS_BY_ID`/`WBS_LEAVES`) loads `location_levels` ordered by `sort_order`; one `<input
  list=…>` + `<datalist>` per level (`locFieldsHTML`/`locLevelFieldHTML`), each level's datalist
  built by `distinctLocValues(levelId, priorVals)` — a **soft cascade**: prior levels' current values
  narrow the datalist suggestions (UX convenience only, verified: picking "Tower B" narrows Level to
  just "Ground Floor" and empties Zone), but typing an unlisted value is never blocked, since the
  underlying data has no enforced parent-child link to block against.
- **`wbs_node_id` is no longer written by new captures.** New `progress_photos.location_values` jsonb
  column mirrors `project_schedule.location`'s shape exactly (migration
  `../../migrations/2026-08-12-progress-photos-location-breakdown.sql`, folded into
  `supabase-schema.sql`. **User must run it** — until then the column is missing and
  `tolerantWrite`'s missing-column retry silently drops it, same tolerance pattern as
  `activity_id`/`activity_name`). `wbs_node_id` itself is untouched/not migrated — it just stops
  being written; existing rows keep whatever they had.
- **Activity resolution + "last captured here" now match by subset-equality on `location_values`**
  (`resolveActivity`/`lastCaptureAt`) — a pick matches any schedule row/photo whose `location` (or
  `location_values`) agrees on every **non-empty** key in the current pick, so stopping at "Tower B ›
  Ground Floor" with no Zone still resolves correctly (verified: resolves "Site Grading" with no Zone
  needed), and two same-Tower/Level-different-Zone activities correctly disambiguate once Zone is
  picked (verified: Zone 1 → "Rebar Installation", Zone 2 → "MEP Rough-in").
- **Photos-page filtering** is now one `<select>` per location level (`renderLocFilterSelects`,
  replacing the old descendant-inclusive WBS-node filter — there's no node tree to be descendant-
  inclusive over now), each populated from **distinct values actually present on captured photos**
  (`distinctPhotoLocValues`), narrowing `visible()` by exact per-level match.
- **Today's Rounds now enumerates distinct location-value combinations** (`locCombos()`) across
  schedule activities, keyed by joining each level's value with U+241F (`␟`, an internal dedup key
  only — never shown) since there's no single node id to key off anymore. Recent/Other split,
  walkthrough chain (Skip/End), and Capture-from-Rounds all carry `{key, values, label}` combos
  through `_roundsComboByKey` instead of node ids.
- **Bug found + fixed during this pass**: "End walkthrough" (early exit) only closed the modal and
  nulled `walkState`, unlike natural completion which also clears `roundsSelected` and re-renders —
  so ending early left the selection bar showing stale "N selected" with boxes still checked. Now
  matches natural completion (`m.close(); walkState = null; roundsSelected = {}; renderRounds();`).
- Harness-verified end-to-end against a fresh v7 fixture (3 `location_levels` Tower/Level/Zone, 3
  schedule activities incl. two sharing Tower A/5th Floor with different Zones for disambiguation +
  one Tower B/Ground Floor with no Zone for stop-early matching, one seeded photo): per-level filter
  selects, Add-photos picker (input+datalist, soft cascade, breadcrumb, activity resolution,
  disambiguation), a real save persisting `location`/`location_values`/`activity_id`/`activity_name`
  with **no `wbs_node_id`**, Photos-page filter narrowing 2→1, Rounds enumerating 3 combos split
  Recent/Other, walkthrough Start → pre-filled modal (breadcrumb + resolved activity + "last
  captured here" reference photo) → Skip advances "1 of 2" → "2 of 2" with the correct disambiguated
  combo → natural completion clears selection, **and the End-walkthrough bug above, both before and
  after the fix**, Edit-modal pre-fill (existing `location_values` correctly populates all three
  inputs) with the "Location label" field proven independent (changing Zone recomputes the breadcrumb
  + resolved activity live but never touches the typed label), and the save round-trip. No console
  errors beyond expected `file://` favicon 404s (noted as harmless in every prior round).
- **Not re-verified this round** (unchanged plumbing, not touched by this rewrite): the offline blob
  queue's failure/retry/Sync-now cycle — it treats the whole row as opaque metadata and was already
  confirmed to not care about field shape in the 2026-08-11 entry; re-deriving that generic result
  wasn't repeated in the interest of not gold-plating what didn't change.

## Bug fix: live "WBS Location" only showed one root node (2026-08-12b)
Reported live on Avesta Residences (real screenshot: the depth-0 select showed only
"Milestones" instead of the project's real Construction/Tower/… tree) — the previous entry's
harness never caught this because a stub of a few dozen fake rows can't reproduce a
**row-count** bug.
- **Root cause**: `loadSchedule()`'s `wbs_nodes` (and `project_schedule`) reads were single,
  unpaginated `select()` calls. Supabase enforces a server-side row cap (commonly 1000)
  **regardless of any client `.limit()`**, silently truncating the result to whatever falls
  in the first page by sort order — this is the *exact* problem Project Schedule's own
  `load()` already had to solve for its schedule fetches (documented in its own CLAUDE.md),
  just never applied here. Avesta's real WBS (imported/built over time) exceeds 1000 rows;
  its real "Construction" branch simply wasn't in the truncated set that came back, while an
  early-created "Milestones" skeleton root was.
- **Fix**: new shared `fetchAllPages(table, selectCols, extraFilter)` — the same keyset-by-id
  pagination pattern (`order('id') + .gt('id', last)`, loop until a page returns <1000) this
  module's own `load()` already uses for `progress_photos`. Applied to both the `wbs_nodes`
  fetch and the `project_schedule` (SCHED_ACTS) fetch (which had a `.limit(5000)` that was
  **also silently capped to the server's real limit** — a client `.limit()` can't exceed it).
- **Verified the actual mechanism, not just "it looks right"**: harness seeded 1,201 real rows
  (1 root + 1,200 children, ids ordered so a naive fetch would cut off `Child 1001`–`Child
  1200`) against a fake backend that enforces the same 1000-row server cap Supabase does.
  Confirmed exactly 2 pages fetched, all 1,201 rows present in the picker (`Child 1001`/
  `Child 1200` included) — proving the fix, not assuming it from code review.
- No schema/behavior change beyond this — the picker logic from the entry below is otherwise
  unchanged.

## Phase 1 correction: no preset hierarchy at all — pure dynamic WBS, code-inspected
## first (2026-08-12)
Owner's explicit correction after reviewing the real Schedule/WBS Manager: **every** preset tried so
far (Location>Zone>Discipline/Trade, then Discipline/Trade>Tower>Level>Zone>Orientation) was still
assuming a shape. A WBS has none — confirmed by inspecting Project Schedule's actual code before
touching anything (not assumed): `wbs_nodes` is `{id, parent_id, code, name, sort_order}` with **no
node-type/category column whatsoever** — nothing distinguishes "this node is a location" from "this
node is a discipline" or a phase. Per-project depth and terminology are genuinely arbitrary.
- **Removed `WBS_LEVEL_LABELS` entirely** — no more hardcoded per-level names, in either direction.
  Each cascade `<select>` is now bare (no label above it) and shows real WBS data — the option text
  is `"<code>  <name>"`, reusing **Project Schedule's own convention verbatim** (its Add-Activity WBS
  dropdown, `wbsPickerOptions()`, formats options identically) rather than inventing a new one.
- **The resolved path is now its own dedicated, read-only breadcrumb** (`.pp-wbscrumb`, painted by
  `paintActCtx`) — e.g. `Construction › Construction Phase › Tower 1 › Structural Works ›
  Superstructure › Ground Floor › Zone 1 › Vertical`, matching the exact 8-level Avesta example in
  the brief. **The free-text "Location label" is no longer auto-filled from it** — it's a fully
  independent, purely optional caption now, so it can never be mistaken for or silently replace the
  structured WBS path (the breadcrumb is always visible regardless of what's typed there).
- ⚠️ **The stored `location` text column still gets the breadcrumb as a fallback when Location
  label is left blank** (`location: $('...-loctxt').value.trim() || breadcrumbOf(wbsNodeId) || null`)
  — this is a deliberate, narrow exception to "never auto-fill the label the user sees": it keeps
  search/List-View-Location/PPR display meaningful for the common case (no custom caption typed)
  without ever touching what's shown in the editable input itself.
- **Photos-page location filtering is now WBS-based, descendant-inclusive, per brief §13** —
  `pp-f-location` is populated by `wbsFlatOptionsHTML()` (a full flattened, indented, code+name walk
  of the whole tree, same convention as the cascade) instead of a distinct-text-values list. Picking
  a node matches that node **or any descendant** (`isNodeUnder`, already built for `resolveActivity`)
  — picking "Ground Floor" correctly returned photos captured at "Zone 1 › Vertical" several levels
  under it in the harness, and correctly returned 0 for an unrelated sibling branch.
- **No other behavior changed** — `resolveActivity`'s descendant matching, the offline blob queue,
  `tolerantWrite`/PDSync routing, Rounds (still WBS-leaf + capture-history driven, no separate
  location list), and the single `wbs_node_id` storage model were already correct per the brief's
  core requirement (§19: `Photo → wbs_node_id`, no `level_id`/`area_id`/`zone_id`) — confirmed by
  inspection, not rebuilt.
- **No data migration** — every existing `wbs_node_id` value was already a valid FK reference; only
  the picker's *display* logic changed, never what gets stored.
- **Harness-verified against the brief's own 8-level Avesta example** (`Construction ›
  Construction Phase › Tower 1 › Structural Works › Superstructure › Ground Floor › Zone 1 ›
  Vertical/Horizontal`, plus a sibling `General Requirements` branch and a second `Zone 2` to prove
  siblings/unrelated branches behave correctly): the cascade renders exactly 8 selects (no phantom
  9th level) with codes matching `4.2.1.1.2.1.1.1`-style dotted numbers; each depth's options are
  strictly that node's own children (verified depth 1 shows only `General Requirements`/`Construction
  Phase`, depth 6 shows only `Zone 1`/`Zone 2`); the breadcrumb matches the brief's example
  character-for-character; Location label stays empty through the whole drill-down; save persists
  the breadcrumb into `location` as a fallback + `wbs_node_id`/`activity_id`/`activity_name`
  correctly; the WBS filter is descendant-inclusive (Ground Floor → 2/2 photos) and correctly
  excludes an unrelated branch (General Requirements → 0/2); Rounds lists all leaves with
  unambiguous full paths. No console errors.

## Location picker rebuilt as a generic N-level WBS cascade: Discipline/Trade > Tower >
## Level > Zone > Orientation (2026-08-11c)
Owner's explicit second follow-up: the preset flips again — Discipline/Trade is now the **top**
tier (not a separate Activity-Code lookup layered on last, per the entry below), followed by
**Tower > Level > Zone > Orientation**, five tiers total.
- **Why this isn't an Activity Code any more:** a real schedule commonly puts discipline ABOVE the
  spatial breakdown — `Structural Works > Tower A > Level 5 > Zone 2` and `Architectural Works >
  Tower A > Level 5 > Zone 2` are two *different* WBS branches for the same physical space, not one
  branch with a discipline tag. So Discipline/Trade is now **WBS depth 0**, read the exact same way
  as Tower/Level/Zone/Orientation — no more `activity_code_types` name-matching, no more `discTag`/
  `existingDiscId` round-trip. `DISC_TYPE`/`DISC_VALUES`/`WBS_LOCATIONS`/`zonesInLocation` are gone;
  the generic Activity-Code overlay (for whatever *other*, unrelated code types a project has) is
  back to iterating every type with no exclusion, since there's no special one to skip anymore.
- **The picker is a fully generic N-level cascade**, not hardcoded to 3 or 5 selects:
  `wbsCascadeHTML()` walks `wbsChildren()` one depth at a time, rendering one `<select>` per depth
  up to wherever the real tree stops, labelled via `WBS_LEVEL_LABELS = ['Discipline/Trade', 'Tower',
  'Level', 'Zone', 'Orientation']` (a depth beyond those five falls back to "Level N"; a shallower
  branch — verified live: the Mechanical Works branch in the harness is only 4 deep — just doesn't
  render a 5th select, it doesn't fabricate an empty "Orientation" nobody can pick). Picking a level
  rebuilds every select from that depth down (`wireCascade` regenerates `#…-cascade`'s innerHTML and
  rewires it) — the simplest robust way to keep n cascading `<select>`s in sync without a framework.
- **A capture can stop at any depth** — "just this Tower" is a valid, deliberate choice, not an
  error state. `currentCascadeNodeId()` reads the deepest select that actually has a value.
  `resolveActivity()` correspondingly matches the picked node **or any of its descendants**
  (`isNodeUnder`), so stopping at "Level 5" still surfaces whichever activity is happening somewhere
  under it, instead of requiring the full 5-deep pick to find anything.
- **`breadcrumbOf()`/`wbsLeaf()` now work for ANY node id**, not only registered leaves — needed
  because a capture can legitimately target an intermediate depth. `WBS_LEAVES` (finest-grain nodes
  only) is still what Rounds enumerates, unchanged.
- ⚠️ **Labelling is positional (by depth), not by matching the node's real meaning** — if a
  project's actual WBS doesn't follow this exact 5-tier order on some branch, a node still gets
  whatever label its depth implies (e.g. a depth-1 node would read "Tower" even if it's actually
  something else). This is cosmetic, not a data-integrity problem: the stored value is always the
  real `wbs_node_id` the user actually clicked through to, correctly representing the tree — only
  the on-screen label for that step could read oddly on an irregular branch. Noted rather than
  solved: Project Schedule's own tooling (the "match WBS to locations" wizard) had to build
  keyword-based matching for exactly this irregularity in a different context (bulk classification);
  here the user is driving the cascade live and always sees the tree's real structure at each step,
  so it doesn't need the same fix.
- **Harness-verified against a 5-level tree built specifically to test the discipline-first
  design**: two disciplines (Structural Works / Mechanical Works) each with their OWN `Tower A >
  Level 5 > Zone 2` branch and a concurrent activity at each. Confirmed: the Edit modal reopens all
  5 levels correctly pre-selected for a 5-deep photo; switching Discipline/Trade at depth 0 correctly
  collapses and repopulates every deeper select; drilling through the Mechanical Works branch (only
  4 deep) resolves to "MEP Rough-in" and correctly does **not** render a 5th "Orientation" select;
  the Structural Works branch at the same Tower/Level/Zone names resolves to "Rebar Installation" —
  proving the two same-named physical branches never cross-resolve; a full save persists
  `location`/`wbs_node_id`/`activity_id`/`activity_name` correctly; Rounds still enumerates all 3
  real leaves with distinguishing full breadcrumbs. No console errors.

## Location picker restructured to the Location > Zone > Discipline/Trade preset (2026-08-11b)
Owner's explicit follow-up to the Phase 1 entry below: pull location/zone/area/activity from
Project Schedule on a **fixed 3-tier preset** rather than one flat WBS-leaf dropdown.
- **Location = a top-level WBS node** (`WBS_LOCATIONS`, depth-0 — the physical/spatial root: a
  building, site, tower). **Zone/Area = a WBS node under that Location** (`zonesInLocation()`) —
  Zone and Area are treated as the same tier, since a project's `wbs_nodes` is the one spatial
  hierarchy Project Schedule maintains; there's no separate "Area" table to pull from.
- **Discipline/Trade is deliberately NOT a WBS depth** — disciplines cut *across* zones (structural
  and MEP crews both work the same column grid), so it comes from the schedule's **Activity Codes**
  instead: whichever code type is named like `/disciplin|trade/i` (planner-defined per project, the
  same mechanism Project Schedule's own grouping/filtering already uses). If a project hasn't set
  one up, that tier simply isn't offered — the picker still works as Location > Zone.
- **Capture/Edit modals are now a real cascade**: pick Location → Zone options repopulate to that
  Location's leaves (`zoneOptionsHTML`) → optional Discipline/Trade select. `resolveActivity(zoneId,
  discValueId)` now also matches the activity's own `activity_codes[disciplineTypeId]`, so a zone
  with two concurrent activities (e.g. Structural doing rebar, Mechanical doing rough-in at the same
  column grid) resolves to the *right* one once a discipline is picked — verified in harness: without
  a discipline both activities are candidates and the earliest-start In-Progress one wins; picking
  "Mechanical" switches the resolved activity to the Mechanical one specifically.
  `project_schedule` select now also pulls `activity_codes` (added to `loadSchedule()`).
- **The Discipline/Trade pick is recorded as a tag** (`"<code type name>: <value>"`, e.g.
  `"Discipline: Mechanical"`) via `discTag()`/`existingDiscId()` — same `"<type>: <value>"` shape as
  the generic Activity-Code overlay, but it has its own dedicated select rather than a checkbox
  since it's a required-feeling tier of the hierarchy, not an optional extra. The **generic overlay
  now excludes** whichever code type resolved as Discipline/Trade, so it isn't offered twice.
  Verified the full round-trip: save with Location=Site Grounds/Zone=Perimeter Fence/
  Discipline=Mechanical → tag `"Discipline: Mechanical"` lands on the row → re-opening Edit
  pre-selects Location/Zone/Discipline correctly (the reverse lookup).
- **Existing progress-photos' own `trade` field is untouched** — deliberately did not let arbitrary
  schedule discipline text overwrite it. `trade` mirrors the fixed WPM vocabulary shared with
  Cash Flow/work-packages (a documented decision below); a schedule's Activity Code values are
  planner-typed free text and could easily not match that vocabulary. Discipline/Trade from the
  schedule is a separate, additional signal (tag + activity narrowing), not a replacement.
- **Rounds screen unchanged in granularity** (still one row per Zone, not per Zone×Discipline) —
  enumerating every zone/discipline combination would blow up the list for a modest UX gain: the
  Discipline/Trade tier is still available inside the Capture modal opened from a Rounds row.
  Flagged as a possible follow-up, not done here.
- Harness-verified (two Locations, a real "Discipline" Activity Code type, two concurrent
  activities at one zone tagged to different discipline values): Location→Zone cascade repopulates
  correctly on Location change, Zone's own location auto-derived for pre-selection (Capture-from-
  Rounds and Edit both preselect the right Location), discipline-narrowed activity resolution,
  discipline auto-tag save + reverse-lookup on Edit, generic overlay correctly empty when Discipline
  is the project's only code type, walkthrough chain unaffected. No console errors.

## Schedule App integration + streamlined capture — Phase 1 of the 6-phase 360°/BIM/drone
## roadmap (2026-08-11)

Owner's brief specced a 6-phase roadmap (schedule integration → reporting → 360° panoramas →
3D/measurements → BIM overlay → drone). Explicit instruction: audit the existing app and confirm
the schedule integration path **before** writing code, and don't start a phase until the previous
one ships. This entry is Phase 1 only — Phase 2 (report templates), Phase 3+ are NOT started.

- **Audit finding:** `location` was free text with no link to anything; "+ Add photos" was a
  batch-metadata upload (good primitive) but had no walkthrough/checklist UX and **no offline
  queue at all** — a failed upload just failed. The PPR module (already built) is most of Phase 2
  already; the gap there is a *template* concept, not slide assembly itself.
- **"Schedule app" = the `project-schedule` module in this same repo/Supabase project** — not an
  external system. Integration is a plain cross-module table read (same pattern Cash Flow/
  Portfolio Overview already use for `project_schedule`), not a new API.
- **Data model decision (owner's call): WBS nodes are the primary location source, Activity Codes
  are an optional overlay.** `progress_photos` gained `wbs_node_id` (FK → `wbs_nodes`, `on delete
  set null` — deleting a schedule zone must not delete photos captured there), `activity_id` /
  `activity_name` (a SNAPSHOT of the schedule's "current" activity for that zone at capture time —
  deliberately not a live join, so reports don't change retroactively when the schedule updates;
  same convention as `bl_cost`). Migration
  `../../migrations/2026-08-10-progress-photos-schedule-integration.sql`, folded into
  `supabase-schema.sql`. **User must run it** — until then the module tolerates the missing
  columns (see below) but zones aren't recorded.
- **`location` (existing free-text column) is kept as the display cache**, auto-filled from the
  picked zone's breadcrumb but still editable/typeable — a photo not tied to any WBS zone (site-
  wide shots, signage) can still be tagged, per contract §6 ("reference the schedule, don't force
  everything to be tracked"). This also means every existing filter/group/report code path
  (List View's Trade grouping, the Location filter dropdown, PPR slides) needed **zero changes** —
  they all just keep reading `location` text.
- **Activity Code overlay reuses the existing, previously-unused `tags text[]` column** — no new
  column needed. If a project has Activity Code Types defined in Project Schedule, the Add/Edit
  modal shows one optional checkbox group per type; ticked values save as `"<Type>: <Value>"`
  strings in `tags`.
- **"Current activity" resolution (`resolveActivity`)**: among `project_schedule` Task rows sharing
  the picked zone's `wbs_node_id`, prefer In Progress (earliest start), else the next Not Started,
  else whatever's there. Shown as a read-only context line in the capture/edit modals and on each
  Rounds row (e.g. "Rebar Installation").
- **Today's Rounds** (new third top-level screen, `Photos | Rounds | PPRs`): every WBS leaf node
  for the project, split into **Recent rounds** (has a prior capture here, newest first) and
  **Other schedule zones** (never captured, alphabetical) — so the usual walkthrough locations
  surface first without hiding zones nobody's shot yet. Each row shows the last photo + date +
  resolved activity, a checkbox, and a one-tap **Capture** button.
- **One-tap repeat capture**: opening Capture on a zone that already has a photo shows that photo
  inline ("Last captured here <date> — frame a similar shot for comparison") right in the upload
  modal, next to the resolved activity line.
- **Batch walkthrough**: check several Rounds rows → **Start walkthrough** opens the capture modal
  for the first ("Capture — 1 of N"), and on Upload/Skip it auto-advances to the next selected zone
  without returning to the Rounds screen; **End walkthrough** stops the chain early. Uses the same
  `openUpload(preset)` as the plain "+ Add photos" button — just pre-filled and chained.
- **Offline queue (plain IndexedDB, no library)**: a capture tries to save immediately; a thrown
  upload (or `navigator.onLine === false`) queues the file blob + metadata in `pp_offline_v1`
  instead of losing the shot. A topbar **"N pending — Sync now"** button (hidden at 0) replays the
  queue on click and auto-flushes on the browser's `online` event. This directly answers brief §4's
  "offline queueing still required" — the old module had none.
- **Migration-tolerant writes**: every insert/update carrying the three new columns retries once
  without them on a "column does not exist" error (same convention as Cash Flow's `tolerantWrite`),
  warning once per session rather than losing the capture. Verified this path explicitly (forced a
  simulated missing-column error) — the photo still saves, just without the zone link, until the
  migration runs.
- **Reconciled with the collaboration/offline-editing work already on `main`** (this branch was
  originally built against an older snapshot — see below): rather than inventing a second, competing
  offline system, new-capture uploads now go through a **narrow addition on top of the existing
  `PDSync` outbox**, not around it —
  - `PDSync` (offline.js) already queues DB row **writes**, but has no concept of a Storage
    **upload**; it can't hold an unsent image blob. So a capture that can't even *start* uploading
    (offline, or the upload call itself throws) is queued in a small **IndexedDB blob queue**
    (`pp_offline_v1`) — file + metadata — retried (upload, then the row write) on reconnect or a
    topbar **"N pending — Sync now"** button (auto-flushes on the browser's `online` event).
  - Once a file's bytes are actually on Storage, the row write **always** goes through the same
    `tolerantWrite()` → `PDSync.write()` path every other insert/update in this module now uses — a
    transient network hiccup on just the row write is PDSync's problem to queue and retry, not a
    second queue of mine. (If that write comes back permanently, `tolerantWrite` retries once
    without the schedule-link columns for a not-yet-migrated DB; if it's still not `ok`, the file's
    already uploaded, so it's re-queued as a row-write-only retry rather than re-uploading.)
  - This **revises the "Upload (file) stays online-only" scope note** below (2026-07-26) — that was
    the right call before schedule integration needed captures to survive going offline mid-
    walkthrough (brief §4 requires it); it's superseded, not contradicted.
- **Rounds stays live-consistent** with collaboration: hooked into the same `render()` that
  `paintRemote()` already runs at the end of — so a teammate's capture (via `applyRemoteChange`) or
  this device's own `load()` both refresh the visible Rounds list, not just the Photos grid.
- **Deliberately not built this round**: Report Templates (brief §5/Phase 2), 360° capture (Phase
  3+). Rounds' "Recent vs Other" ranking is capture-history + WBS only — no separate "usual
  locations" list to hand-maintain, which was the actual ask in §4.

### Verified (2026-08-11)
Harness-verified (stubbed `AppAuth`/`PDb`/a hand-rolled Supabase-query-builder stub + `storage` +
minimal `PDSync`/`PDCollab`/`Autosave` stubs, mutable in-memory store seeded with a 2-level WBS
tree, two schedule activities, one Activity Code type, one pre-existing photo; no real
credentials/backend touched; harness deleted after use). Confirmed **end-to-end, by driving the
actual DOM**: Rounds correctly splits Recent/Other and resolves the right activity per zone; the
capture modal preselects the right WBS node, auto-fills the location label, shows the resolved
activity, and shows the "last captured here" reference with thumbnail; a real upload (via a
`DataTransfer`-injected `File`, no OS file dialog) saves through `tolerantWrite`/`PDSync.write` and
the Rounds list's "Last captured" date updates live; the walkthrough chain advances 1-of-2 → 2-of-2
on Skip and stops cleanly on End; the offline blob queue catches a simulated upload failure, shows
the pending badge, and Sync now flushes it through the same write path; the migration-tolerant
retry fires and still saves the photo when the new columns are simulated as missing; the Edit-photo
modal preselects the existing zone/location correctly and still routes through `broadcastCollabSel`
+ Autosave unchanged; the pre-existing Photos screen (filters, grouping, live collaboration
presence/row-cursor, edit) is unaffected.
Screenshots weren't attempted (this session's Preview tool file:// pages don't reliably reload —
confirmed via a page-global marker that a second navigate/`location.reload()` to the same file://
URL doesn't re-execute JS); DOM/text verification was used instead, same as this module's prior
compositor-stall workaround.

### Pending
- Migration must be run on the live DB (see above).
- Live click-through against a real login + a real project with a WBS built in Project Schedule.
- The offline **blob** queue (new-capture path) hasn't been exercised through a real DevTools-
  offline cycle against live Supabase — same caveat the 2026-07-26 entry already notes for the
  metadata-edit path.
- Phase 2 (Report Templates) — not started.

## Live collaboration + offline metadata edits (Phase 1 & 2) (2026-07-26) — fmlozano
Wired the shared **PDCollab** (Realtime) + **PDSync** (offline outbox) layers. Progress Photos is the
**"presence + live, offline-limited"** case: it's uploads, so photo *blobs* can't be queued offline —
but presence, the live gallery stream, the row cursor and **metadata** edits all work.
- **Phase 1 (presence + live gallery + row cursor):** `joinCollab()` on load / project switch
  (`key = progress_photos:<pid>`). Topbar avatars (`#pp-presence`). `openForm(r)` broadcasts "editing
  this photo"; every close path (×/Cancel/Save) clears it. `paintRemote()` (called at the end of
  `render()`) flags the photo's `.pp-row .pp-thumbcell` (List) or `.pp-card .pp-cardimg` (Gallery) of
  whoever has it open. `applyRemoteChange` patches `rows` from postgres_changes (INSERT/UPDATE/DELETE)
  and re-renders — and **signs a newly-arrived photo's URL** (`signOne`) so the preview shows live.
- **Phase 2 (offline, metadata only):** the **Edit modal save** routes through `PDSync.write`
  (field-level LWW: description / trade / works / location / capture date), applied optimistically so
  it survives offline and syncs on reconnect. **Read-offline:** `load()` caches rows (`pp:<pid>`) and
  renders from cache on a failed fetch — but **signed image URLs can't be minted offline, so previews
  show the placeholder**. ⚠️ **Scope:** **Upload (file), delete and download stay online-only** — image
  blobs can't be queued and a delete removes a storage object. Offline covers **metadata edit + read**.
- **Migration `../../migrations/2026-07-26-realtime-collab-progress-photos.sql` (USER MUST RUN)** —
  adds `progress_photos` to `supabase_realtime` + `replica identity full`. Presence/cursors/offline
  work without it; only the live-value stream needs it.
- Verified: `node --check` (module.js + ppr.js). Assets: new `offline.js?v=20260726d` +
  `collab.js?v=20260726c`; `module.js?v=20260726d`.
- **LIVE-VERIFIED two-session (2026-07-27, deployed site, signed in as Fernando Lozano on GPR101).**
  Migration confirmed applied — the module's channel reports `state:"joined"`. A simulated second user
  (independent Supabase client, distinct id, same `collab:progress_photos:GPR101` channel) proved every
  path against the real deployed module: **presence** roster rendered both avatars (FL + TU);
  **live gallery** streamed a DB INSERT (0→1 live), UPDATE (description/trade patched live) and DELETE
  (row removed live, 0); **row cursor** — user B's "editing this photo" painted the correct photo's
  `.pp-thumbcell` with B's colour + "TU" flag, and it **survives subsequent live re-renders** (verified
  by a follow-up UPDATE). No console errors; test row cleaned up (0 leftover).
- ⚠️ **Leave-reconciliation caveat (all collab modules, not PP-specific):** a peer that disconnects
  **abruptly** (killed socket, no clean websocket close) may leave a **stale avatar** on other clients
  until they re-sync/reload — a fresh join shows the correct roster. A real browser-tab close sends a
  clean close, so `collab.js`'s bound `leave` handler fires normally. Confirmed: after B's abrupt
  disconnect, reloading tab A showed only FL server-side.
- ⚠️ **Not exercised live:** the **offline** path (queue an edit with the network down → reconnect →
  sync) — that needs a real offline cycle, which the console-driven harness can't fake convincingly.
  The online metadata-save-through-PDSync path is exercised implicitly (write() does the same direct op
  online). Worth a manual DevTools-offline pass.

## Audit fix: paginate the photo load (2026-07-21)
`load()` used a single `select('*')` (Supabase caps at 1000), so once a project's library exceeds
1000 photos the excess were invisible in List/Gallery, unavailable to the PPR slide picker, and
missed by bulk/Clear actions. Now **keyset-paginated** by `id`, then re-sorted in memory to the
previous order (`taken_at` DESC blank-last → `sort_order` ASC NULLS-LAST). `signAll()` still batch-signs
in one call. Verified: parses clean; Node test confirms the re-sort + full load. No migration, no `?v=` bump.

## Status
- [x] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [x] Built from the Power Apps "Progress Photos" app (drawing-register used as the
      file-upload reference)
- [x] CRUD implemented (upload / edit / view / list / delete)
- [x] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [x] `Fmt.esc()` on all user text injected into HTML
- [x] `enabled: true` set in `assets/js/config.js`
- [ ] PR opened into `main`
- [x] **View PPRs** — PPR Presentations Database + slides viewer/editor + offline export

## Clear-filters polish (2026-07-17)
The app owner reported "Clear filters seems out of place." Root cause: the button lived in
a `.pp-filt-right` wrapper with `margin-left:auto`, so when the filter row wrapped it was
pushed onto a second line, orphaned at the far right — and it showed even on the empty
state. Replaced with a subtle borderless **`.pp-clear`** ghost (× icon, muted, fills on
hover) that sits **inline** after the filters and is **`hidden` unless a filter is
actually set** (toggled in `render()` for Photos and `renderList()` for PPRs). Removed
`.pp-filt-right`. Uses the new shared `x` icon in `icons.js`. Assets bumped `?v=20260717h`.

## UI uniformity pass (2026-07-17)

The module had been built with its own invented chrome. Realigned it to the suite's
existing patterns (Drawing Register / Cash Flow / Project Schedule). **These rules are a
copy of Drawing Register's — keep them in sync; don't re-invent.**

What was actually wrong (each verified against the reference stylesheet, not eyeballed):
- **The shared topbar rules were missing entirely.** `.pd-topbar`, `#user-bar`
  (`margin-left:10px; padding-left:10px; border-left`) and `#pd-theme-toggle` (34×34) are
  declared by all three reference modules; this one declared none of them, so the avatar
  had no divider and the theme toggle was unsized.
- **The filter bar wasn't a card** — the others are `--pd-card` + border + radius +
  `8px 12px`. Ours was a bare flex row, which is what made it look unfinished.
- **Tools were ad-hoc** (`padding:6px 9px`) instead of the uniform 34×34 transparent icon
  buttons that fill on hover, with `.pp-tb-sep` dividers and one labelled primary action.
- **Back button** was padding-based, not the 36×36 square.
- **Project select** was a plain bordered select; the convention is borderless until
  hover/focus (`.dr-project`), so the title area reads as one unit.
- **Two invented tab styles.** Replaced: the Photos|PPRs switch is now a **segmented
  `.pp-tabs`** (identical to Register/Progress), and List/Gallery now uses the **shared
  `.pd-viewtoggle`/`.pd-vt`** component from `dashboard.css` (as `projects.html` does)
  rather than a third bespoke style. `.pp-tab` therefore now means the *screen* tabs —
  the view wiring selects `.pd-vt[data-view]`, not `.pp-tab`.
- Count + view toggle moved into a static `.pp-listbar` (Drawing Register's `.dr-listbar`)
  so they aren't rebuilt on every render; destructive actions use `--pd-bad`.
- Added a **Clear filters** + **count** to the PPR screen for parity with Photos.

**Verified by diffing computed styles against the real `drawing-register/module.css`**
(both stylesheets inlined into an iframe at the same viewport/theme): all 10 chrome
elements — back button, icon tool, primary button, active tab, project select, filter bar,
user-bar divider, theme toggle, separator, count text — report **zero differences**.
Behaviour re-verified after the restructure (view toggle, screen tabs not hijacked, live
counts, per-screen tools, slides view hiding filters+count); light/dark surfaces flip on
tokens while brand red stays fixed; title collapses to icon-only at ≤1150px; no page
h-scroll at 375px (the photo table scrolls inside its own container: 341 visible / 998
content).

## PPR Presentations built (2026-07-17)

Replaces the Power Apps **PPR PRESENTATIONS DATABASE** and **EDIT PROGRESS PHOTO
SLIDES** screens. A PPR is one monthly Project Performance Review presentation; each
slide is a **before/after pair** at one location — last month's photo beside this
month's — tagged Trade / Works / Location with an optional Key Plan overlay.

- **Two top-level screens** (the app's home: *View Photos* / *View PPRs*) as a
  `Photos | PPRs` switch in the topbar, persisted in `localStorage['pp_screen']`. Both
  share one project selector: `ProgressPhotos.onProject(fn)` publishes the current
  project and `ProgressPhotos.trades()` shares the trade vocabulary, so the two screens
  never disagree.
- **Database screen:** PPR Date · Description · No. of Slides, with **PPR date start/end
  filters** and a **Preview pane** showing numbered slide thumbnails (the app's exact
  "No slides to show." wording when a PPR is empty). Clicking a thumbnail jumps straight
  to that slide.
- **Slides screen:** PPR Project / PPR Meeting Date / PPR Description / `‹ n › of N`
  header, Trade / Works / Location / Key Plan meta, and the two photos side by side with
  each one's capture date and italic caption. **Key Plan toggles an overlay on both
  photos**, matching the app's expand/collapse control.
- **Slide photos are picked from the Photos Database, never re-uploaded** (owner's call).
  `before_photo_id` / `after_photo_id` reference `progress_photos`; picking a photo
  **pre-fills the slide's trade/works/location/caption** from that photo, since the
  library already carries them. Key plans are the one exception — they're not progress
  photos, so they upload to `<project>/keyplans/` in the same bucket.
- **`on delete set null`, deliberately:** deleting a photo must not silently delete the
  PPR slide citing it. The slide survives with an empty frame so a planner sees what went
  missing and re-picks.

### Download = a self-contained offline copy (owner's requirement)
The app owner's brief: *"an offline view of that PPR Date in case the photos database
loads slowly due to connectivity or the sheer amount of photos."* So Download does **not**
produce a deck — it writes a **standalone `.html`** with every image inlined as a
downscaled data URI (max 1600px, JPEG q0.82), inline CSS, **no scripts and no external
references at all**. It opens instantly with no network and no dependency on Supabase
being reachable, and prints one slide per page.
- Photos are fetched to a **blob first**, then drawn via an object URL — a signed
  Supabase URL drawn straight into a canvas would be **cross-origin and taint it**, making
  `toDataURL()` throw. The blob round-trip keeps the canvas same-origin. Don't "simplify"
  this to `img.src = signedUrl`.
- Downscaling is not cosmetic: full-resolution site photos would make the file enormous
  and slow to open — the opposite of the point.

## Verified (2026-07-17)
Harness-verified against a mutable in-memory store (stubbed `AppAuth`/`PDb`/Supabase +
storage; deleted after use). Confirmed: PPR list newest-first (and a newly created PPR
sorts to the top); date-range filter; preview thumbnails + "No slides to show."; slides
header/meta reproducing the app's fields exactly; capture dates ("June 8, 2026" /
"June 25, 2026") and italic captions; key plan overlaying **both** photos and absent when
a slide has none; slide nav with end-disabled arrows; PPR + slide CRUD incl. blank-date
refusal, tag pre-fill on photo pick, and cascade delete; topbar tools following the inner
screen; Photos screen unaffected by the two-screen restructure; dark mode on all PPR
surfaces (`#2B2C2B`, light text); two-column split at 1440px with no horizontal overflow.

**The offline export was verified as a real artifact, not just by structure:** the
generated file was captured, written into a sandboxed iframe with no network, and
rendered — **5/5 images decoded, 0 broken, key plan present, brand-red header, two-column
pairs, 0 external references**.

⚠️ **Testing note for whoever tests this next:** two false alarms came from the *harness*,
not the module. (1) Stubbing `URL.createObjectURL` globally breaks `blobToImage`, so every
image "fails to embed" — scope the stub to the `text/html` blob only. (2) A no-op
`order()` stub makes ordering assertions meaningless; the stub now really sorts.

## Pending
- Live click-through against a real login, the real bucket, and real photo sizes — the
  export's file size and embed time have only been measured against small fixtures.

## Photos Database built (2026-07-17)

Replaces the Power Apps **Progress Photos | Photos Database** screen.

- **The row is the Power Apps row:** PHOTO · DESCRIPTION · TRADE · WORKS · LOCATION ·
  CAPTURE DATE, with per-row **download** + **view full size**, plus edit/delete for
  planner+.
- **List View / Gallery View toggle** (the app's bottom-right switch), persisted per
  project in `localStorage` (`pp_view_<pid>`). List = a compact grid with thumbnails;
  Gallery = large photo cards with the detail table beneath, matching the app's layout.
- **Filters mirror the app's**: capture start, capture end, Trade, Works, Location —
  plus a free-text search the original lacked. Trade/Works/Location options are derived
  from the project's own rows (no empty dropdowns), and a "Clear filters" button resets.
- **List View groups by Trade** (collapsible, with counts, persisted in
  `pp_collapsed_<pid>`). The Power Apps grouped by *project* because its selector was
  "My Projects" (multi-project); this module is project-scoped by contract (§6), so the
  project is the topbar selector and Trade is the useful grouping.
- **Lightbox** = the app's fullscreen expand: click any thumbnail/photo, navigate with
  ← / → or the on-screen arrows, Esc closes, caption shows trade · works · location ·
  date and an N/M counter.
- **Batch upload:** one modal takes many files against one set of shared fields
  (description/date/trade/works/location) and writes a row per file, then you edit any
  individual photo afterwards. Progress is reported per file; a failure on one file
  doesn't abort the batch.
- **Shell:** sidebar-less topbar (matches Project Schedule / Cash Flow / Drawing
  Register) — back button, title, project selector, view tabs, tools beside the profile.

## Trade / Works vocabulary
`TRADES` mirrors the **WPM (procurement) trade list** (Site Works, Civil, Structural,
Architectural, Mechanical, Electrical and Auxiliary, Plumbing and Sanitary, Fire
Protection, General Requirements) so photos, work packages and Cash Flow's cash-out all
group by the same names. **Works** is free text with a datalist of the values already
used on the project (the app's Works list is project-specific — e.g. "Temporary
Facilities" — so a fixed enum would fight real usage). Revisit if a canonical Works
list is issued.

## Storage
Private **`progress-photos`** bucket (already created by
`migrations/2026-06-18-storage-buckets.sql`). Path = `<project_id>/<ts>_<rand>_<safe
name>`; the table stores the path in `photo_url`, never a public URL. Previews use
**batch-signed URLs** — one `createSignedUrls(paths, 3600)` per load rather than one
signing round-trip per row — cached in `urlCache` and refreshed on reload.

## DB
- **Run migration `migrations/2026-07-17-progress-photos.sql`** — adds `trade`, `works`,
  `sort_order` to `progress_photos` + a `(project_id, taken_at desc)` index. Idempotent;
  folded into `supabase-schema.sql`. **The module shows blank Trade/Works until it runs.**
- `description` / `location` / `photo_url` / `taken_at` (capture date) already existed on
  the starter table. `tags` (text[]) is now used by the 2026-08-11 Activity Code overlay
  (`"<code type>: <value>"` strings) — see that entry.

## Notes / decisions
- `UI.modal()` takes no width and does **not** wire close buttons, so the module has a
  local `openModal(html, width)` helper that sets `max-width` and wires `[data-close]`
  rather than editing the shared `ui.js` (contract §1 forbids shared edits). Worth
  promoting into `ui.js` by the app owner if other modules want it.

## Verified (2026-07-17)
Harness-verified against a mutable in-memory store (stubbed `AppAuth`/`PDb`/Supabase +
storage, no real credentials or backend touched; deleted after use). Confirmed: trade
grouping + collapse/expand; every filter (trade → 3/5, date-from → 2/5, search → 1/5,
clear → 5/5); gallery toggle (5 cards); lightbox open/next/close with correct captions
and 1/5 counter; edit round-trip persists to the row; delete removes it; batch upload of
2 files → 2 rows + new trade group + refreshed filter options; dark mode (grid bg
`#2B2C2B`, light text — tokens, no hard-coded white); modal width + `[data-close]`
wiring; no console errors.

**Screenshots were not possible** — this environment's compositor is stalled
(`visibilityState` stays `hidden`, `computer{screenshot}` times out), the same condition
noted in earlier prompts. Verification was done via DOM/computed values instead. Photo
`<img>` decode was confirmed directly (`naturalWidth` 400 on both thumbnails and the
lightbox), so the `loading="lazy"` thumbnails are proven to load.

## Pending
- **View PPRs** (the app's other screen) — not built yet.
- Live click-through against a real login + the real `progress-photos` bucket.
