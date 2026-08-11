# Module: progress-photos

Developer change log for the **progress-photos** module. Update every PR.

## Schedule App integration + streamlined capture — Phase 1 of the 6-phase 360°/BIM/drone
## roadmap (2026-08-10)

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
- **Deliberately not built this round**: Report Templates (brief §5/Phase 2), 360° capture (Phase
  3+). Rounds' "Recent vs Other" ranking is capture-history + WBS only — no separate "usual
  locations" list to hand-maintain, which was the actual ask in §4.

### Verified (2026-08-10)
Harness-verified (stubbed `AppAuth`/`PDb`/a hand-rolled Supabase-query-builder stub + `storage`,
mutable in-memory store seeded with a 2-level WBS tree, two schedule activities, one Activity Code
type, one pre-existing photo; no real credentials/backend touched; harness deleted after use).
Confirmed **end-to-end, by driving the actual DOM** (not just reading the code): Rounds correctly
splits Recent/Other and resolves the right activity per zone; the capture modal preselects the
right WBS node, auto-fills the location label, shows the resolved activity, and shows the "last
captured here" reference with thumbnail; a real upload (via a `DataTransfer`-injected `File`, no
OS file dialog) saves and the Rounds list's "Last captured" date updates; the walkthrough chain
advances 1-of-2 → 2-of-2 on Skip and stops cleanly on End; the offline queue catches a simulated
upload failure, shows the pending badge, and Sync now flushes it; the migration-tolerant retry
fires and still saves the photo when the new columns are simulated as missing; the Edit-photo
modal preselects the existing zone/location correctly; the pre-existing Photos screen (filters,
grouping, edit) is unaffected. **Bug caught and fixed by this testing** (not just code review): the
Rounds list didn't refresh after a capture made while Rounds was the visible screen — `load()` now
re-renders Rounds too when it's on screen, not just Photos.
Screenshots weren't attempted (this session's Preview tool file:// pages don't reliably reload —
tested and confirmed via a page-global marker that a second `navigate`/`location.reload()` to the
same file:// URL doesn't re-execute JS); DOM/text verification was used instead, same as prior
sessions' documented compositor-stall workaround.

### Pending
- Migration must be run on the live DB (see above).
- Live click-through against a real login + a real project with a WBS built in Project Schedule.
- Phase 2 (Report Templates) — not started.

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
  the starter table. `tags` is unused so far.

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
