# Module: progress-photos

Developer change log for the **progress-photos** module. Update every PR.

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
