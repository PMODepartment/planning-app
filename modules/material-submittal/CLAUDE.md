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

## 2026-07-20 (c) — Top bar wasn't uniform (missing shared chrome)
Owner reported the top bar didn't match the suite, specifically the buttons beside the profile icon.
**Same defect as the 2026-07-17 Progress Photos pass:** this module was missing the three shared
topbar rules every uniform module carries, so it inherited `dashboard.css`'s `.pd-topbar { gap:14px }`
with **no `flex-wrap`**, the avatar had **no left divider**, and theme.js's injected toggle kept its
default size instead of matching the 34×34 tool buttons.
- Fixed by copying the block **verbatim** from `drawing-register/module.css` (see the top of
  `module.css`). ⚠️ **Do not drop it when copying this module** — the comment there says what breaks.
- **Verified by computed-style diff against the real drawing-register** (its stylesheet + real topbar
  markup inlined into an iframe, theme toggle injected to match runtime), with a **sanity assertion
  that the reference CSS actually loaded first** — that omission is what invalidated the first
  Progress Photos attempt. Zero differences on every chrome element.
- **Geometry is pixel-identical** to drawing-register: tool cluster right edge **1179px**, theme
  toggle left **1193px**, profile divider left **1247px**. The only residual property diffs were
  selector artifacts (drawing-register has a *labeled* "+ Level" button this module doesn't) and
  `margin-left:auto` resolving differently because left-hand content widths differ — the right edge,
  which is what "beside the profile icon" means, matches exactly.
- No horizontal overflow at 1280/1100/900/700/420px; profile + theme controls visible at every width.

## 2026-07-20 (b) — Document attachments wired up
Uses the existing **private** `material-submittal` bucket (2026-06-18 storage migration) and the
existing `file_url` column — **no new migration**. Follows drawing-register’s pattern.
- **One document per submittal, deliberately.** The log’s own model already carries a single
  *Type of Presentation* per row (brochure / test results / sample board …), and a submittal needing
  two document types is two rows in the workbook. Multi-file would need a new `files jsonb` column.
- `file_url` stores the object **PATH, not a URL**. The bucket is private, so the URL is signed on
  demand (`createSignedUrl`, 60 s) and opened in a new tab — a stored URL would expire and be useless.
  Uploads are namespaced `<project>/<timestamp>_<sanitised name>`; the display strips the timestamp.
- **Order of operations matters** (all verified against failure injection):
  - Upload happens **before** the row write, so a failed upload never leaves a row pointing at a
    missing object — nothing is written and the dialog stays open for a retry.
  - If the row write then fails, the just-uploaded object is **rolled back**, so a DB error can’t
    orphan a file in the bucket.
  - On replace, the superseded object is deleted **only after** the row successfully points at the
    new one.
  - Clicking **×** on an attachment is **deferred to Save** — cancelling the dialog must never
    delete a document.
  - Row delete, bulk delete, Clear all, and import-with-Replace all remove their objects. Bulk paths
    are captured **before** the rows leave `rows`, or they'd be unrecoverable. Object deletion is
    best-effort: a storage hiccup must never block the row delete.
- **Grid gained a “Doc” column** (eye button → signed URL). `icons.js` has no `paperclip` and is a
  shared asset the contract forbids editing, so it reuses `eye` — no global `?v=` bump needed.
- ⚠️ The header array is now the **single source of truth for the column count** (`SPAN`); the group
  rows and empty state span it. The previous hardcoded `COLS + 3` would have silently skewed the
  table the moment a column was added — which is exactly what adding “Doc” did.
- Export gained a **Document** column (filename only — a link would be dead once the signed URL
  expires). Print hides the Doc column.
- **Verified in a browser harness with a storage stub** (real module files, failure injection):
  new-with-file, replace (old object removed), remove-then-save, **cancel-after-× keeps the file**,
  upload failure writes no row, row-write failure rolls the object back, single + bulk delete remove
  their objects, signed URL requested at 60 s and opened, header/body/colspan all 19, no console
  errors. **Note:** a first run reported the rollback failing — that was the *stub* returning a bare
  Promise from `insert()` so `.select()` threw; with a faithful stub it passes. Model the client's
  chaining accurately or you'll chase phantom bugs.

### Notes / follow-ups
- **Overdue reads high (117/143) on this file** — correct, not a bug: the workbook is an 18-month-old
  snapshot, so nearly every unapproved item is past its planned approval date. Live data won’t do this.
- Search deliberately includes `trade_section`/`discipline`: no item text contains “rebar”, so
  without it the most natural query returns nothing.
- Not built: multi-file per submittal (needs a `files jsonb` column), revision history per submittal
  (only a `revision_no` field), and per-project coding vocabularies (the code dropdowns use the
  workbook’s Coding Reference as a fixed list).
- **Storage delete widened to planners (2026-07-20) — migration
  `../../migrations/2026-07-20-material-submittal-storage-delete.sql`, USER MUST RUN.** The
  2026-06-18 rule was `owner = auth.uid() or is_admin()`, so a planner deleting a submittal they
  didn't upload removed the row but orphaned its file. Now `owner = auth.uid() or is_planner()`.
  ⚠️ The **`owner` branch is kept deliberately**: the bucket's INSERT policy is `is_approved()`, so
  any approved user can upload — replacing it with `is_planner()` alone would remove a `user`-role
  uploader's ability to delete their own file, i.e. a narrowing. `is_planner()` already includes
  admin/super_admin, so the old `is_admin()` branch is subsumed. Purely additive: nobody loses access.
  ⚠️ In `supabase-setup.sql` this override **must sit after `is_planner()` is defined** (line ~342),
  not in the storage section (~line 278) — a policy's USING expression is parsed at creation, so
  referencing the function earlier fails on a fresh run.
- **`drawing-register` and `progress-photos` still carry the original owner-or-admin rule** and have
  the same orphaning behaviour. Deliberately left alone (only material-submittal was asked for); the
  migration widens them by adding them to its one array.

## Status
- [x] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [x] Chrome copied from drawing-register (not re-invented)
- [x] CRUD implemented (add / edit / list / delete / bulk)
- [x] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [x] `Fmt.esc()` on all user text injected into HTML
- [x] `enabled: true` set in `assets/js/config.js`
- [x] Document upload / view / replace / remove (private bucket + signed URLs)
- [x] Migration run on the live DB (owner confirmed 2026-07-20)
- [ ] Live click-through against a real login
