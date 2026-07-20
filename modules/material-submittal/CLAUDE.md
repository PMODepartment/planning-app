# Module: material-submittal

> **Claude / developer: read this first.**
> 1. Read `../../MODULE_CONTRACT.md` and `../../CONTRIBUTING.md` (NOT auto-loaded).
> 2. This module is **Material Submittal Log**. DB table `material_submittal`.
> 3. Chrome (topbar/tabs/tools/filter bar) is copied from **drawing-register** — do not re-invent it.
> 4. Update this file as you build.

## Built 2026-07-20 — Dashboard + Material Submittal Log (from the PMO workbook)
Built against **“EPC. PMO. Material Submittal List Dashboard. 2025 01 25.xlsx”** (Modan Loft
Ortigas Hills). All 14 sheets were surveyed; `Material submittal log`, `Dashboard`, `Library`
and `Coding Reference` are the ones that define behaviour. Two screens, matching the ask:
**Dashboard** and **Material Submittal Log**.

### The log sheet is not a flat table (importer notes)
- **3-tier merged header** on sheet rows 10/11/12 — row 10 is the main header, row 11 sub-heads
  the 7-part *Material Submittal Number*, row 12 sub-heads *Approver* (Consultant/Client).
  Several headers repeat (**“Floor Levels” appears twice**), so the importer reads **by column
  index** off the located header row, never by fuzzy header matching.
- The body is broken up by **23 single-cell TRADE SECTION rows** (GENERAL REQUIREMENT, SITEWORKS,
  REBAR, …) which own the rows beneath them → `trade_section`.
- **Stop at the sign-off block.** Rows below “PREPARED AND CHECKED BY:” / “REVIEWED BY:” are names
  and job titles; without an explicit stop they import as submittals (“Project Manager” etc.).
- **A row is a submittal when it has substance, not merely an Item.** Sheet row 33 has a full code,
  dates and a status but a blank Item — requiring an Item silently dropped it and put the status
  total one under the workbook’s own COUNTIF. Its item stays `null` and renders “(untitled)”.
- ⚠️ **Dates: never read a spreadsheet Date with LOCAL getters.** SheetJS returns the cell
  displaying `18-Mar-24` as `2024-03-17T15:59:17Z`, so local getters give the 17th or the 18th
  depending on the browser’s timezone. The importer reads cells as **formatted text**
  (`raw:false`) so the normal path is the literal `"18-Mar-24"` string parsed with integer maths;
  `parseDate` is UTC-only elsewhere and rounds a Date to the nearest UTC day. It also duck-types
  (`typeof v.getTime`) rather than `instanceof Date`, which fails across realms.

### Dashboard maths — the workbook’s formulas are the spec
Read off its own cells, not guessed:
- status table = `COUNTIF(Status, …)` → **blank status is not counted** (its total read 107, not 146).
- `PLANNED` curve = `COUNTIFS(PlannedApproval within month, TradeCategory=<code>)`
- `ACTUAL`  curve = `COUNTIFS(ActualApproval  within month, TradeCategory=<code>)`
- i.e. **the S-curve is driven by the APPROVAL date pair, not submission** — despite the workbook
  labelling its own summary rows “Planned/Actual Submission”. Named ranges resolve to
  `U` (plan approval), `V` (actual approval) and `I` (**Trades**, not the Discipline column).

### TWO DEFECTS in the workbook — reproduced, proven, then fixed (owner decision: fix + show both)
1. **`TradeCategory` pointed at the redundant “Trades” column**, blank on **40** submittals — its
   chart silently dropped them.
2. **Its OVERALL row summed EIGHT discipline rows but listed “ST” twice**, double-counting
   Structural.

At the workbook’s own cutoff (Jan-2025) the legacy reproduction lands **exactly** on its printed
`97 / 29`, while the corrected maths gives `128 / 27` — so the old chart *under*-reported planned
by 31 despite the double count (the dropped rows outweighed it). This module groups by
**`discipline`** (always populated) and counts each discipline **once**. `legacyScurve()` exists
**only** to render the reconciliation note on the dashboard — never report from it, and never
group new work by `trade_code`.

### Screens
- **Dashboard** — 6 KPI tiles; the workbook’s Status / No. / Wt % block (reproduces its printed
  percentages to the decimal); an approval donut; a cumulative planned-vs-actual **S-curve** with a
  per-discipline breakdown; and the amber reconciliation note explaining the difference from the Excel.
- **Log** — grouped by trade section (collapsible, per-group approved count), frozen
  Submittal-No + Item columns, status pills, overdue flagging, filters (search / section /
  discipline / status / presentation / overdue-only), bulk status + bulk delete, Add/Edit modal
  with a **live 7-part code preview**, Excel import/export, print, admin-only Clear.

### Migration — USER MUST RUN
`../../migrations/2026-07-20-material-submittal-full.sql` (idempotent). Adds the 7 code parts,
`trade_section`, `discipline`, `trade_code`, `floor_levels`, `location`, `reference_document`,
`brand`, `type_presentation`, `plan_submission_date`, `plan_approval_date`, `approver_consultant`,
`approver_client`, `revision_no`, `mas_id`, `seq_no`, `sort_order` + 3 indexes. Existing starter
columns are **reused** for their natural match (no dead duplicates): `material`=Item,
`specification`, `supplier`=Vendor, `status`, `remarks`, `date_required`=Required Date Baseline,
`date_submitted`=Actual Submission, `date_approved`=Actual Approval, `submittal_no`=composed code.
Until it is run, load/import fail with an explicit “run the migration” message rather than a raw
Postgres error.

### Verification
- **54/54 automated checks against the real workbook**, loading the shipped `module.js` itself (no
  reimplementation): date parsing, status/presentation normalisation, 143 records, 23 sections,
  every date ISO, every status/presentation in vocabulary, and — decisively — the **status table
  matching the workbook’s COUNTIF block exactly** (9/11/2/3/0/14/68, total **107**) and the
  **legacy S-curve reproducing its printed 97 / 29**.
- **Browser-verified** against real imported data: dashboard renders (status weights match the
  sheet’s printed 8.41 %/10.28 %/…/63.55 %), donut, S-curve, 143 rows in 21 populated sections,
  frozen columns actually `position:sticky`, dark mode flips on tokens, frozen cells stay opaque
  in both themes, no page h-scroll, all filters + collapse + selection + bulk bar + modal code
  preview work, no console errors.
- ⚠️ **Environment caveat — do not trust computed styles after a dynamic class change here.** The
  compositor is stalled (screenshots time out): flipping `.active` updates the DOM but
  `getComputedStyle` keeps returning the pre-change value even after forcing layout, which reads as
  “inverted tab colours”. Verified the CSS is correct by measuring a **freshly created** element
  (`.active` = brand red on white text). Measure fresh nodes, or initial paint, only.

### Notes / follow-ups
- **Overdue reads high (117/143) on this file** — correct, not a bug: the workbook is an 18-month-old
  snapshot, so nearly every unapproved item is past its planned approval date. Live data won’t do this.
- Search deliberately includes `trade_section`/`discipline`: no item text contains “rebar”, so
  without it the most natural query returns nothing.
- **No file upload yet.** The `material-submittal` storage bucket exists (2026-06-18 storage
  migration) and `file_url` is on the table; wiring the drawing-register upload pattern is the
  obvious next step.
- Not built: revision history per submittal (only a `revision_no` field), and per-project coding
  vocabularies (the code dropdowns use the workbook’s Coding Reference as a fixed list).

## Status
- [x] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [x] Chrome copied from drawing-register (not re-invented)
- [x] CRUD implemented (add / edit / list / delete / bulk)
- [x] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [x] `Fmt.esc()` on all user text injected into HTML
- [x] `enabled: true` set in `assets/js/config.js`
- [ ] **Run the migration on the live DB**
- [ ] Live click-through against a real login
