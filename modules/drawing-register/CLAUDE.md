# Module: drawing-register

Developer change log for the **drawing-register** module. Also the **reference
module for file uploads** (private bucket + signed-URL viewing). Update every PR.

## Status
- [x] Full-fidelity rebuild matching the Megawide "Drawing Register & Tracker"
      workbook (`GPR101. TEC. Drawing Register`).
- [x] CRUD + Excel import + export + progress dashboard
- [x] `enabled: true` in `assets/js/config.js`

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

## UI (2026-07-16 professional pass)
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
