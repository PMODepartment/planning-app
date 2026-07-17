# Module: progress-photos

Developer change log for the **progress-photos** module. Update every PR.

## Status
- [x] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [x] Built from the Power Apps "Progress Photos" app (drawing-register used as the
      file-upload reference)
- [x] CRUD implemented (upload / edit / view / list / delete)
- [x] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [x] `Fmt.esc()` on all user text injected into HTML
- [x] `enabled: true` set in `assets/js/config.js`
- [ ] PR opened into `main`
- [ ] **View PPRs** screen (the app's second half — still to come)

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
