# Module: progress-photos

Developer change log for the **progress-photos** module. Update every PR.

## Schedule App integration + streamlined capture — Phase 1 of the 6-phase 360°/BIM/drone
## roadmap (2026-08-11)

Owner's brief specced a 6-phase roadmap (schedule integration → reporting → 360° panoramas →
3D/measurements → BIM overlay → drone). Explicit instruction: audit the existing app and confirm
the schedule integration path **before** writing code, and don't start a phase until the previous
one ships. This entry is Phase 1 only — Phase 2 (report templates), Phase 3+ are NOT started.

- **Audit finding:** `location` was free text with no link to anything; "+ Add photos" was a
  batch-metadata upload (good primitive) but had no walkthrough/checklist UX. The PPR module
  (already built) is most of Phase 2 already; the gap there is a *template* concept, not slide
  assembly itself.
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
