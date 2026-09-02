# Module: progress-photos

Developer change log for the **progress-photos** module. Update every PR.

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
