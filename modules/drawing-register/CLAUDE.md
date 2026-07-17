# Module: drawing-register

Developer change log for the **drawing-register** module. Also the **reference
module for file uploads** (private bucket + signed-URL viewing). Update every PR.

## Status
- [x] Full-fidelity rebuild matching the Megawide "Drawing Register & Tracker"
      workbook (`GPR101. TEC. Drawing Register`).
- [x] CRUD + Excel import + export + progress dashboard
- [x] `enabled: true` in `assets/js/config.js`

## Topbar icons match Cash Flow (2026-07-17)
- The text **"Clear"** button abutted the dark-mode toggle (clash). Reworked the topbar tool
  cluster to match Cash Flow: **all secondary tools are icon-only** — Import (`upload`), Export
  (`download`), Clear (`trash`, red-tinted, hover→solid red). Kept `+ Add` (primary) and `+ Level`
  as the two labeled actions. Theme toggle `margin-left:4px` + user-bar `margin-left:10px`/border-left
  now exactly match Cash Flow spacing (14px gap Clear→toggle, no overlap; verified numerically).
- Added shared icons **`trash`** + **`upload`** to `assets/js/icons.js` (additive; drawing-register's
  `icons.js?v=` bumped to `20260717b`). Assets bumped `?v=20260717b`.

## Import fix, Add fix, + feature batch 1–6 (2026-07-17)
- **Import bug fixed — filename-as-code.** The workbook's "DWG No" column sometimes holds a
  submitted *file reference* (e.g. `2.3 4PH JAB RES SDP v 2.0 02-27-26.pdf`) instead of a code;
  the parser was using it as the drawing code. Now the code comes from the outline **"No" column
  (A)** and any filename in "DWG No" is kept as a `File: …` note in remarks (`fileRef`/`cleanDwgno`).
  Verified on the real file: 0 codes contain a filename; the two SDP rows now read `A-001` with the
  file note. **Re-import to apply.**
- **"+ Add drawing" fixed.** With nothing selected it inserted an *ungrouped* drawing under a
  collapsed "Ungrouped" phase → looked like it did nothing. Now it expands the target group
  (using `ph||'Ungrouped'`), scrolls to the new row, opens inline title editing, and warns when
  added ungrouped.
- **Feature 3 — persist per-project UI:** last view (Register/Progress) + collapse state saved to
  `localStorage` (`dr_view_<pid>`, `dr_collapsed_<pid>`) and restored on load (`saveUI`/`restoreUI`/
  `syncTabs`).
- **Feature 4 — inline date editing:** Latest Sub. + Approval columns are now double-click editable
  (`data-t="date"`); Latest Sub. writes the latest revision's `actual` (+`issue_date`), Approval
  writes `actual_approval`.
- **Feature 5 — saved filter views:** a **Views** menu in the filter bar saves/applies/deletes named
  filter presets per project (`dr_views_<pid>`).
- **Feature 6 — jump-to-phase:** a "Jump to phase…" select in the list bar (shown when >1 phase)
  expands + smooth-scrolls to that phase.
- **Feature 1 — frozen Code + Title columns:** sticky-left on the checkbox/Code/Title cells with
  opaque backgrounds per row-state (drawing/hover/selected + phase/disc/cat group tints, light+dark)
  so the drawing identity stays visible when scrolling right. Group label spans Code+Title
  (COLSPAN_LABEL 3→2 + explicit Rev cell). `.dr-grid` gets `min-width:1080px` so narrow viewports
  actually scroll. (Sticky repositioning is compositor-driven; couldn't observe it under the headless
  stalled compositor, but it's the same pattern Project Schedule uses and the sticky header works.)
- **Feature 2 — duplicate-code flag:** a code repeated within the same **phase** gets an amber ⚠ on
  the code cell (`computeDups`/`dupSet`/`dupKey`) so planners reconcile genuine source repeats.
- **Progress tab:** the filter bar is hidden on the Progress view (it only applies to the Register).
- Assets bumped `?v=20260717a`. Verified in a mutable-store harness: dup flag, inline date persist,
  saved views, jump, progress-filter hide, opaque frozen backgrounds, no console errors.

## Topbar consolidation + bulk status (2026-07-16)
- **Toolbar moved into the topbar** (matches Project Schedule): project selector + Register/Progress
  tabs sit left; the action cluster (**+ Add**, **+ Level ▾**, then icon buttons Import / Export /
  Clear) sits **beside the profile** in `.dr-topbar-tools` (flat, hover-fill; theme toggle + user-bar
  after it). Body keeps only a **slim filter bar** (search + phase/discipline/status). Title collapses
  to icon-only under 1150px. Removed the stray "Approved w/o comments" option from the status filter.
- **Bulk status change:** the selection bar gains a "Set status…" dropdown that applies a status to all
  selected drawings (`setStatusSelected`) — for approving/rejecting a batch at once.
- Harness-verified: project/tabs/tools all in the topbar, tools pushed right, no overflow at desktop
  width, tab switch + Add-from-topbar + Level menu + bulk-status all work; no console errors.

## Sidebar-less shell + level delete + audit (2026-07-16)
- **Sidebar removed** (matches Project Schedule / Cash Flow): a `.dr-modback` back-to-modules
  button + title in the topbar, full-width content (`.pd-content{width:100%}`; user-bar
  pushed right). More horizontal room for the grid.
- **Delete a level:** group rows now show a ✕ (planner+, hover) that deletes that phase/
  discipline/category **and everything under it** (`deleteLevel`, confirm with drawing count)
  — completes level CRUD (build / rename / add-under / delete).
- **Audit (harness-verified against a mutable store):** sidebar gone + back button; category/
  discipline **code chips** (A-100, A-200, AR-000) render; level delete cascades (row + node +
  child drawings gone); discipline rename cascades to drawings + node; add-level/add-drawing/
  auto-number/inline-edit/status-dropdown/shift-select/delete/keyboard all intact; no console
  errors. Import phase-split confirmed on the real file (see below).

## Editable tree grid + structural nodes (2026-07-16)
- **Build the level skeleton first:** a **"+ Level"** menu (planner+) inserts phase /
  discipline / category rows (`node_kind` on `drawing_register`, migration
  `2026-07-16-drawing-register-nodes.sql` — **user must run it**). Keyed by the
  phase/discipline/category text, so it stays backward compatible: existing imported
  drawings still group via their text; structural nodes just add explicit, code-bearing
  headers. Double-click a group name to rename (cascades to descendant drawings' text).
- **Add drawings under a selected row** (project-schedule style): select any group/row →
  **+ Add drawing** (or **Enter**) inserts a drawing in that phase/discipline/category,
  **auto-numbers** the code (increments the group's numeric suffix), and drops straight
  into inline title editing.
- **Excel-like inline editing:** double-click a cell (code / title / rev / sheets /
  approved / responsible) to edit in place; **Status is an always-on dropdown** that saves
  immediately. Full-editor modal still available per row (✎) for the code builder,
  submissions and file upload.
- **Selection + shortcuts:** click to select, **Shift-click** range, **Ctrl/Cmd-click**
  toggle, **↑/↓** move (Shift extends), **Ctrl+A** select-all-visible, **Delete** delete
  selected, **Esc** clear, **Enter** add drawing. Bulk "Delete selected" bar.
- **Status list:** dropped **"Approved w/o comments"** (redundant with "Approved");
  `normalizeStatus` maps the workbook's "without comments" → "Approved".
- **Compact one-screen grid:** sticky header, condensed columns, internal scroll.

## Importer: faithful phases + level codes (2026-07-16)
- **Phase blocks kept verbatim** (`cleanPhase`, anchored `PHASE_RE`): the workbook has
  design iterations — *Schematic Design 1/2/3/4 (Scheme 1/2…)* and *For Construction
  (FCD)* — that were previously **collapsed into one "Schematic Design 1"** (old `mapPhase`
  only knew 1 & 2), producing false "duplicate" A-101/A-102/A-103 across iterations. Now
  each block is its own phase, ordered by workbook appearance (`phaseOrderKey` = min
  sort_order). Verified on the real file: SD1(S1)=96, SD2(S1)=178, SD2(S2)=131, FCD=646;
  SD1 Floor Plan correctly = A-101, A-102 only.
- **Header rows import as structural nodes carrying their code** — A-100 Floor Plan,
  A-200 Elevation, AR-000 Architectural — shown as a red code chip on the group row (the
  codes were previously discarded). ⚠️ **Existing imports predate this — re-import
  (Clear all → Import) to get faithful phases + level codes.**
- Anchored `PHASE_RE` stops category/sheet titles ("Schematic Diagrams", "Construction
  Notes", "Neighbor's As-Built…") from being misread as phases.

## What it does
Project-scoped drawing register that mirrors the workbook:
- **Structured drawing code** from the "Coding Reference" sheet:
  `<proj>-<building>-<company>-<type>-<discipline>-<floor>-<number>-<rev>`.
  The Add/Edit modal builds it from dropdowns (types ECD/SD1/SD2/FCD/CSD/ISD/DRC,
  disciplines AR/ST/CV/EL/AU/PL/ME/FP/SD/LA, floors GEN/FD/GF/2F.., buildings
  TW1–TW9/GEN) with a live code preview.
- **Register view** grouped by **phase → discipline** with per-group roll-ups
  (sheets, approved, % bar). Filters: phase, discipline, status, search.
- **Multi-revision submission tracking** (`submissions` jsonb: `[{rev,planned,actual}]`)
  + planned/actual approval dates + approval status
  (For Review · Revise & Resubmit · Approved w/ comments · Approved w/o comments ·
  Approved · Superseded).
- **No. of sheets / approved sheets / approved %** per drawing; roll-ups per
  phase & discipline.
- **Progress dashboard** tab: KPI tiles (drawings, total/submitted/approved sheets,
  approved %, balance) + Progress-by-Phase and Progress-by-Discipline tables.
- **Import Excel**: reads the workbook's flat "Dwg Registry" layout (SheetJS).
  Infers phase/discipline/category from the sheet-title indentation + code prefix,
  extracts every revision's planned/actual submission dates, normalises status.
  Optional "replace existing"; chunked insert (200/req).
- **Export** the filtered register to `.xlsx`.
- **File upload** (unchanged): private `drawing-register` bucket, store the path,
  view via 60s signed URL.

## Importer notes (verified against the real GPR101 workbook)
- Picks the sheet whose header has both "Sheet Title" and a DWG/drawing column and
  yields the most rows. Header found by scanning the first 30 rows.
- Row classification is **title/code-driven, not date-driven** (discipline group
  rows carry roll-up dates yet are headers): phase header (title matches a phase
  name), discipline header (`disciplineHeader()` exact-ish match), building/tower
  header, else category header (title, no dates/desc), else a drawing sheet.
- Discipline falls back to the code prefix (`disciplineFromCode`, A→Architectural,
  M→Mechanical, …) when no group header applied.
- Verified offline with Node+SheetJS: 1032 drawings, correct phase/discipline
  split, per-revision (0–2) planned/actual dates, sheet counts, normalised status;
  only ~26/1032 edge codes (CS-/R-) left unclassified.
- `DrawingRegister._parseWorkbook(wb)` is exposed for testing (harmless).

## DB
- **Run migration `migrations/2026-07-16-drawing-register-full.sql`** — extends
  `drawing_register` with the code parts, phase/category/description/responsible,
  sheet counts + approved %, `submissions` jsonb, planned/actual approval dates,
  `sort_order`. Idempotent; folded into `supabase-schema.sql`.
- Requires the earlier project-access RLS + storage-buckets migrations (for the
  private `drawing-register` bucket used by file upload).

## Delete / bulk actions (planner+)
- **Clear all** button (shown only to super_admin/admin/planner) — deletes every
  drawing for the current project via a **type-the-project-id** confirm modal;
  removes attached storage files first. For fixing a wrong-project import.
- **Bulk select** — a checkbox column (planner+), per-group and select-all
  checkboxes, and a "N selected · Delete selected" bar. Chunked delete (100/req).
- Per-row Edit/Del unchanged. RLS still governs who can delete which rows
  (creator or admin), so a planner clears what they imported.

## Hierarchy & level styling (2026-07-16)
- Register is now a **4-level tree**: phase (L1) → discipline (L2) → **category (L3)** →
  drawing sheet (L4). Category was previously only a column, so the workbook's level-3
  rows (A-100 Floor Plan, A-200 Elevation, A-300 Section, …) never appeared as groups —
  now derived from each drawing's `category` field and shown as collapsible L3 roll-ups.
  A drawing with no category renders directly under its discipline (at L3).
- **Indentation + colour by level**: the first cell gets left padding per depth
  (10/30/50/70px) and a coloured inset rail (phase=red, discipline=dark gray, category=gray,
  drawing=line) plus graded row backgrounds. Each level is independently collapsible.
- Verified against the real workbook: 688/1032 drawings carry a category (78 distinct:
  Floor Plan, Elevation, Section, …), so the L3 groups populate.

## Import performance (2026-07-16)
- **Root cause of the hang:** `gridOf` used `sheet_to_json(..., {defval:''})` over the
  sheet's bloated `!ref` (the workbook's "Dwg Registry" sheet claims **16,383 columns**),
  allocating ~100M empty cells. Rewrote `gridOf` to read a **bounded window via direct cell
  refs** (columns capped at 60, real row range only). Added `sheetRows:8000` to `XLSX.read`.
  Parse now deferred one tick (so "Reading…" paints) and insert chunks `await` a 0-ms timeout
  (so progress repaints). Verified against the real workbook: read ~1s + parse ~0.4s (was
  hanging), same 1032 drawings.

## UI (2026-07-16 professional pass + toolbar/table refinement)
- **Toolbar** reorganised into two rows inside one card: row 1 = project selector · Register/
  Progress tabs · action cluster (**+ Add drawing** primary, divider, Import/Export, subtle
  **Clear all**); row 2 = search (grows) + phase/discipline/status filters.
- **Collapsible groups**: click a phase or discipline roll-up row to collapse/expand (caret
  indicator, `collapsed` state). **Level-1 (phase) groups start collapsed on load** so the
  register opens as a clean list of phase rows; an **Expand all / Collapse all** toggle in the
  list bar flips every phase at once (Expand all clears all collapse state incl. disciplines).
- Toolbar in a bordered card; segmented Register/Progress tabs.
- Table: sticky header, zebra hover, monospace drawing codes, tinted phase
  roll-up rows, gradient progress bars, compact row buttons, a "Showing N of M"
  count bar, selection bar.
- KPI tiles get an accent bar; dashboard tables restyled.
- Import guard: `canonDiscipline()` rejects a non-canonical discipline value
  (e.g. a stray "A-013" from a mis-detected column) so it can't become a group.

## Pending
- Live click-through against a real login + this project's data (module +
  UI harness-verified; importer tested against the actual workbook).
