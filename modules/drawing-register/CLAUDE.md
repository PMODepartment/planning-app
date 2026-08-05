# Module: drawing-register

## Search no longer hides its own matches inside collapsed groups (2026-08-05) — fmlozano
Found while re-deriving BAU101's sheet-parents: searching a drawing code whose discipline happened to
be collapsed painted the phase and discipline headers and **nothing else** — `buildModel` returns at
`if (isCollapsed(dkey)) return;` before reaching the drawings. The register read **"Showing 0 of 424"
for a code that is definitely in it**; measured on BAU101, **5 of 6 known drawings were invisible to a
search for their own code**. Reads as "not in the register", which is the worst possible wrong answer
from a register.
- **Collapse state is now split in two.** `collapsed` stays the planner's manual, persisted tree state;
  **`fCollapsed` applies only while a filter is active and starts EMPTY**, so a filter always reveals
  its matches. `isCollapsed(key)` picks the live map and `toggleCollapsed(key)` writes to it — every
  read and every caret now goes through those two.
- ⚠️ **Clearing `collapsed` outright was the obvious fix and is wrong** — it destroys the hand-built
  tree the planner is working in, as a side effect of typing in a search box. Keeping the two maps
  apart means the tree is exactly as they left it the moment the filter clears.
- **You can still collapse a group while filtering** (a 400-match search is not useful fully expanded);
  that just writes to the transient map. ⚠️ **`fCollapsed` is discarded on every filter change** —
  otherwise a group collapsed under one search stays collapsed under the next and silently hides its
  matches, reintroducing the same bug one step removed. Reset in `readFilters()`, on the dups-only
  toggle (it counts toward `anyFilter()`), and on project switch.
- **Expand/collapse-all acts on whichever map is live**, so it still works during a filter.
- ⚠️ **Removed `drillTo`'s `collapsed = {}`.** That line was a workaround for this same defect and was
  destructive: clicking a donut slice or a progress-table row threw away the planner's entire tree
  state. A filter now reveals its own matches, so only the transient map needs clearing.
- **Verified 14/14** in a new harness over the SHIPPED `buildModel`/`isCollapsed`/`toggleCollapsed`
  (not reimplemented): the reported bug reproduced and fixed; the manual state survives a search and
  is restored intact when it clears; collapsing during a filter works and writes only to the transient
  map; a new search discards it; non-search filters (discipline) behave identically; and a filter
  reveals a matching **sheet** under a collapsed drawing. Existing suites re-run green (40 + 35).
  ⚠️ One harness failure was my own leaked state between blocks, not a product fault.
- **Verified live, signed in.** On **BAU101** the exact reported case now works: a fresh search for
  `U-200` returns **"Showing 4 of 424"** (the drawing + its 3 sheets) where it previously returned
  **"Showing 0 of 424"**. The five-step state behaviour was then walked through on the sandbox:
  manually collapse a discipline → only the other discipline's drawing shows; search a code inside it →
  **revealed**, group painted expanded; collapse it again *during* the filter → hidden, as intended;
  type a **new** search → the group re-opens for it; clear the filter → **the manual collapse is still
  exactly as the planner left it**. Sandbox emptied afterwards; BAU101 540 and GPR101 1,372 untouched.
  ⚠️ Run this kind of multi-render check on a SMALL project — driving repeated re-renders of the
  424-drawing BAU101 grid through CDP froze the renderer twice.
- Assets `module.js?v=20260805d`.

## Live check on BAU101 + status vocabulary sanitised (2026-08-05) — fmlozano
Verified the per-sheet feature signed in on the deployed site against the real **BAU101** register
(540 rows / 453 drawings / 1,286 sheets / 45% POC). The migration was already applied and
**29 sheets across 6 parents already existed** — the feature is in real use.

**Counters correct on all 6 parents** (`no_of_sheets` and `approved_sheets` matched the actual child
counts exactly), so `syncParent` works against live data.

### ⚠️ REAL BUG FOUND LIVE: a parent kept a stale "Approved" pill over 0/15 unapproved sheets
`A-1000.1 "2F Wall Setting-Out"` had been marked **Approved** as a single row, was then broken out
into 15 sheets — all "For Review" — and **kept the Approved pill while its own counters read 0/15**.
Cause: `syncParent`'s status fell back to `(p.status || 'For Review')` when nothing was approved yet,
preserving whatever the row held before break-out. The pill said done, the numbers beside it said
nothing was — the exact two-sources-of-truth contradiction per-sheet tracking exists to remove,
reappearing one level up.
- New **`derivedStatus(kids)`** is the single source: all approved → `Approved` (or **`Approved w/
  comments`** if any sheet carried comments — a materially different outcome that must survive the
  roll-up); any approved / submitted / returned → `In Progress`; otherwise `For Review`. **No fallback
  to the stored value, ever.**
- ⚠️ **The parent's pill renders `derivedStatus()` too, not the stored column** — so a row that is
  already wrong in the database (as `A-1000.1` was) displays correctly on load, without needing a
  write-on-load heal, and converges the next time `syncParent` runs.

### Status vocabulary sanitised
Measured first, across both live registers (1,506 drawings): blank **823**, Approved 358, Approved w/
comments 227, Ongoing 50, For Review 34, Pending 10, Superseded 2, Revise & Resubmit 2 — and
`Approved w/o comments` **0**.
- ⚠️ **Three names meant "not decided yet"** — Ongoing / Pending / For Review, all 94 rows in BAU101,
  all inherited from that workbook's own legend block, and nobody could say which was which. Now two,
  and the surviving distinction is real: **In Progress** = we are still drafting it, **For Review** =
  it is submitted and sitting with the reviewer. That is the difference between chasing ourselves and
  chasing the consultant. `STATUSES` is now 6: In Progress · For Review · Revise & Resubmit ·
  Approved w/ comments · Approved · Superseded.
- **Blank is now a labelled state, not an em-dash.** 55% of live drawings have no status; it renders
  as **"Not started"** with the quietest chip in the set (`.dr-ns`), is offered in the filter, and is
  counted as its own donut slice. **No data was written for this** — blank still means blank.
- ⚠️ **`statusCounts()` was counting all 823 blanks as "For Review"** (`|| 'For Review'` fallback), so
  the Overview donut's largest slice was a fiction — 612 of GPR101's 1,053 drawings were reported as
  awaiting review when nothing had been submitted. Fixed.
- **`LEGACY_STATUS` + `statusOf()/statusLabel()`** map retired spellings for display, so an
  un-migrated row is shown as what it became rather than as an unmatched value. ⚠️ This matters
  because the grid's Status cell is a `<select>` built from `STATUSES`: a value outside the list
  **silently displays as the first option while the row holds something else**. `statusSelect`,
  `matchesFilters` and the full editor all compare through `statusOf()` for the same reason.
- **The importer maps rather than imports verbatim** (`ongoing|wip → In Progress`,
  `pending → For Review`), so no future import can reintroduce an off-list value.
- ⚠️ **`matchesFilters` treats "Not started" as the blank state** — without it the 823 blank drawings
  are unreachable by the status filter.

### Live data remap applied
`Ongoing → In Progress` (50) and `Pending → For Review` (10) written to BAU101; GPR101 held neither.
`Approved w/o comments` had 0 rows in either. Re-queried afterwards: **0 legacy values remain** in
either register (BAU101 now In Progress 50 / For Review 45). All 6 sheet-parents were re-derived;
five were already correct and only `A-1000.1` needed healing (`"Approved" → "For Review"`, 0/15).

### End-to-end proof on live BAU101 data (signed in)
Loaded BAU101 in the deployed app and drove the real UI:
- **Registry renders the nesting**: `A-1000.1` as a sheet-parent row with the caret, the "15 sheets"
  tag, the Manage-sheets button, `15 / 0 / 0%` rolled up, and its **15 sheet rows** underneath.
- **The pill now reads "For Review", not the contradictory "Approved"** — the bug, fixed, on the real row.
- **Changed one sheet's status to Approved through the grid dropdown** → its `approved_sheets` derived
  to 1 by itself (the two-sources-of-truth fix), the parent rolled to **1/15 · 7%** and its pill became
  **In Progress**, and a direct DB re-query confirmed both rows persisted (`approved_pct 0.0666…`,
  `actual_approval` correctly still null since not all sheets are approved).
- **Restored**: the sheet and its parent were returned to their exact prior values. 0 test rows left
  behind, no console errors.
### Break out / Add sheets / merge-back — full lifecycle on BAU101-TEST (signed in)
Seeded the empty sandbox with a phase/discipline/category skeleton, a drawing **deliberately marked
`Approved` with 100 sheets / 37 approved** (so the break-out also re-tests the stale-status path), and
a second drawing left in aggregate mode as a control. Every step driven through the real UI:
- **Break out** — dialog pre-filled with the drawing's own 100, created **100 sheet rows**, codes
  **contiguous `A-101.1 … A-101.100`**, all `For Review`, each `no_of_sheets=1`. Parent showed the
  caret, the "100 sheets" tag and `100 / 0 / 0%`. ⚠️ **The pill read `For Review`, not the stale
  `Approved`** — the live bug's fix confirmed on a fresh break-out, not just on the healed row.
- **Inheritance held**: **0 of 100** sheets carry their own `planned_approval` (they read the parent's
  `2026-03-31` through `inh()`), all 100 inherited phase/discipline/category and `responsible`.
- **Bulk status** on a 37-sheet selection → parent `In Progress`, `37 / 100 · 37%`, and the Approval
  column still showing the **planned** date because max-actual is withheld.
- **The min/max rule, proven both ways**: at **99/100** → `In Progress`, 99%, planned date shown; at
  **100/100** → `Approved`, 100%, and the Approval column became **Apr 20 2026 — the MAX actual date,
  which belonged to sheet .42, not the last row written.**
- **Group roll-ups with both modes side by side**: phase/discipline/category rows all read
  `103 sheets / 102 approved / 99% / min planned Mar 31 2026 / max actual —` (withheld because the
  aggregate control drawing isn't finished). Per-sheet and aggregate roll up together correctly.
- **Add sheets** — numbering continued from `.101` with no collision or restart, and the parent
  correctly **reverted from `Approved` to `In Progress` 100/105 · 95%, withdrawing the actual date**.
- **Merge-back** — confirm names the exact count, deleted all 105 sheet rows, **0 orphans left**, and
  the drawing returned to aggregate mode (caret gone, sheet counters inline-editable again, sheet
  total kept, approved reset to 0). The control drawing was untouched throughout.
- **Cleanup**: sandbox emptied (0 rows, as found). Re-verified the real registers were never touched —
  BAU101 still 540 rows / 29 sheets, GPR101 still 1,372. No console errors at any point.
### Revision matrix on BAU101-TEST — and THREE bugs it exposed
Tested the full editor on a sheet (`A-101.1`, under a 2-sheet parent). The matrix itself was correct
first time: 7 columns, per-revision outcome offering the sanitised statuses, the latest revision's
outcome mirroring into the drawing-level Status and its approval date into Actual approval, the
inherited-date hint reading *"Inherited from the drawing — Mar 31, 2026"*, both revisions persisting to
the `submissions` jsonb with `status`/`approved`/`file_url`, `actual_approval` derived from the
approving revision, a real PDF uploaded and **fetched back 200 `application/pdf` through a signed
URL**, and a **full round-trip on re-open** (every field restored; rev 1 showing its filename with view
+ remove, rev 0 showing an upload input). **Cancel-safety verified**: clicking ✕ on a revision's file
and then cancelling left the object in storage AND still referenced by the row.

But saving through the full editor exposed three real defects, all now fixed:
- ⚠️ **`rollup()` and `syncParent()` disagreed about what "approved" means.** rollup summed
  `approved_sheets`; syncParent counted children by `isApprovedStatus(status)`. Approving a sheet via
  the editor (which did not derive the count) left the parent **STORING 1/2 · 50% while the grid
  DISPLAYED 0/2 · 0%**. New **`approvedOf(r)`** is the one definition, used by both: a row with sheets
  sums its sheets · a single-sheet row follows its **status** · an aggregate row keeps its hand-typed
  count. `pctApproved` routes through it too, and now only trusts the stored `approved_pct` for a
  multi-sheet aggregate row (where the count really is hand-typed).
- ⚠️ **The editor rewrote a sheet's code.** `composeCode()` rebuilt it from the code-part dropdowns, so
  saving `A-101.1` turned it into **`BAU101-TEST-MCC-AR-A-101.1`**, destroying the child-of-parent
  numbering the break-out had just created. A sheet now keeps its own `<parent>.<n>` code; the
  structured code belongs to the drawing.
- ⚠️ **The editor's save skipped the status→`approved_sheets` derivation** that `persistCell` applies to
  an inline edit, so a sheet could read Approved while contributing 0 to its drawing's POC. Same rule
  now applied on the modal path.
Re-ran the whole flow against the fixed build: code stayed `A-101.1`, sheet `Approved · 1 · 100%`,
parent `In Progress · 1/2 · 50%` with stored and displayed values agreeing. Sandbox emptied afterwards
(0 rows, storage object removed and confirmed gone); BAU101 540/29 and GPR101 1,372 untouched.

### Re-derived BAU101's 6 sheet-parents after the `approvedOf()` fix — nothing had drifted
Recomputed all 6 parents and all 29 sheets under the corrected single definition and diffed against
what is stored: **0 parents needed a write, 0 of 29 sheets had a count disagreeing with their status.**
The two old definitions only diverge once a sheet is approved *through the full editor*, and every
BAU101 sheet is still `For Review` — so the drift was possible but had not actually happened.
Confirmed in the app as well (displayed vs stored, all 6): `A-1000.1` 15/0, `U-200` 3/0, `E-400` 3/0,
`F-200` 3/0, `E-100` 2/0, `E-500` 3/0, all `For Review`, every sheet-count tag and nested row count
correct.
- ⚠️ **Measurement trap:** searching for a code renders **nothing** when its discipline group is
  collapsed — the group rows paint but `buildModel` returns at `if (collapsed[dkey]) return;` before
  the drawings. Five of the six read as "missing" until the groups were expanded. **Pre-existing
  behaviour unrelated to sheets** (plain search does not auto-expand; only `drillTo` clears
  `collapsed`), but it makes a search-based check silently under-report. Expand before asserting.
⚠️ **Environment note:** the CDP `Runtime.evaluate` bridge times out at 45s and froze the renderer twice
on the 540-row BAU101 page. Do heavy multi-query work from a light page (`projects.html`) and keep each
eval short, or the tab has to be reloaded.

### Verification
**68 checks green** (33 model + 35 renderer) against functions sliced verbatim from the shipped
`module.js`, including new regressions for the live bug (a stale "Approved" parent over 0/15 sheets
must not render as Approved; all-approved-with-comments rolls up as `Approved w/ comments`) and for
the vocabulary (blank → "Not started" with `.dr-ns`, legacy `Ongoing` → "In Progress", legacy
`Pending` preselects "For Review", the select no longer offers the retired values).
- Assets `module.css?v=20260805b` / `module.js?v=20260805b`.

## Per-sheet tracking matrix — submissions + approval merged into one grid (2026-08-05) — fmlozano
User: a Technical Officer sets "100 sheets, approved by 31-Mar" on one row and grows the approved count
over time. They asked to turn that into a matrix where **each row is a sheet**, with a status per sheet
and revisions per sheet, while the **planned approval date stays one date for the whole drawing** — and
crucially, to keep the option of *not* using it and tracking the whole thing on one row.

**Most of this already existed.** A register row already carried `no_of_sheets`/`approved_sheets`, a
`submissions[]` jsonb (rev + planned + actual + file), status, and planned/actual approval; group rows
already rolled up Σapproved ÷ Σtotal. So this is a restructure, not a new data model.

### The shape
A sheet is an **ordinary drawing row** (`no_of_sheets = 1`) carrying the new `parent_id`. Tree becomes
Type › Discipline › Category › **Drawing › Sheet**. Two modes coexist per drawing, the TO's choice:
- **aggregate** — one row, hand-typed approved count. Byte-for-byte what it was before; still the default.
- **per-sheet** — the drawing becomes a parent; its sheet rows each carry their own status, revisions
  and uploaded files, while the drawing keeps the single planned approval date and the schedule link.

⚠️ **Sheets are real rows, deliberately.** Everything already built works on them for free — inline
editing, sorting, drag order, filters, bulk status, per-revision upload, export, collab, offline edits.
A `sheets[]` jsonb would have been invisible to all of it.

- **Migration `../../migrations/2026-08-05-drawing-register-sheets.sql` (USER MUST RUN)** — `parent_id`
  + index. Break-out reports "run the migration" instead of failing opaquely if it hasn't been.

### The invariant that keeps everything else working
⚠️ **`drawingRows()` now EXCLUDES sheets, and the parent's stored counters are a derived mirror of its
children (`syncParent`).** Every consumer — Overview KPIs, progress tables, donut, period chart, export,
Backlog, dup detection — counts through `drawingRows()` and reads the same plain columns it always did,
so **none of them needed changing**. Including both parent and sheets would double-count the register
(measured in the harness: 103 sheets, not 206). `syncParent` is called after every sheet status change,
inline edit, form save, add and delete — and **once per drawing, not once per sheet**, on bulk status.

### Roll-up rules (all levels, not just sheets)
`rollup()` is now the single source for every group row: POC = Σapproved ÷ Σtotal, **min planned
approval**, and **max actual approval**. ⚠️ **maxActual is withheld until everything in the group is
approved** — POC only reads 100% when the last sheet lands, so surfacing a max date earlier would read
as a completion date for open work. Legacy sentinel dates (`2000-01-06`) are rejected from both extremes
via the shared `validDate()`. Group rows gained the two date columns (progress bar moved to span
Rev+Status); cell counts re-measured against the header in both writer and read-only modes.

### ⚠️ REAL DEFECT FIXED: status and approved_sheets were two sources of truth
On a single-sheet row the status *is* the approval state, but a TO had to set **both** `status=Approved`
and `approved_sheets=1`. Miss the second and the sheet reads Approved while contributing 0 to its
drawing's POC — silently. `persistCell` now derives `approved_sheets` from the status whenever
`no_of_sheets <= 1` and the row has no children. Multi-sheet aggregate rows keep their hand-typed count;
an explicit `approved_sheets` in the same patch still wins; a parent is never touched by this rule.

### Editor: one revision matrix instead of two sections
"Submissions" and "Approval" were separate blocks, so the status you were reading never said which
revision it belonged to. Now one grid per revision: **planned sub · actual sub · outcome · approved on ·
drawing file**. `status` + `approved` are new keys on the existing jsonb — **no migration** — and any
`bl:{…}` re-baseline series from the BAU101 importer is carried through untouched. The latest revision's
outcome mirrors up to the drawing-level Status/Actual approval as you type. A sheet's Planned approval
field shows the inherited drawing date as its placeholder plus a hint, so overriding it is a deliberate act.

### Inheritance
`inh(r, field)` answers from the parent when a sheet has no value of its own. ⚠️ `leadOf`/`needByOf`/
`agingDays`/`docFloatOf` all read through it — without that every sheet reads as "unlinked" and the
Need-by column, float chip, aging bar and Backlog sort go blank the moment a drawing is broken out.
Sheets deliberately do **not** get a copy of the parent's date, so changing it moves all 100 at once
instead of leaving stale copies to reconcile.

### Other traps handled
- ⚠️ **Filtering:** a parent survives when *any of its sheets* match, and only the matching sheets paint.
  Its own status is a roll-up ("Ongoing"), so filtering by "Revise & Resubmit" would otherwise hide the
  very sheets you are hunting.
- ⚠️ **`allFilesOf` recurses into sheets** — `parent_id` cascades on delete, so without this every
  sheet's uploaded revision is orphaned in the bucket with no row pointing at it. Cycle-guarded.
- ⚠️ **Derived cells are not inline-editable** on a parent (`syncParent` would overwrite a typed value),
  its status is a pill not a select, and it is not draggable (reorder would break the nesting).
- ⚠️ **Frozen Code/Title cells need an OPAQUE background** on the tinted parent row — the row tint is an
  rgba overlay and a sticky cell would let the rows beneath show through. Flattened equivalents added
  for light and dark; keep them in step with `.dr-sheetparent`.
- ⚠️ **`.dr-subrow .dr-substat` must be (0,2,0)** — `.dr-stsel` is a bare class defined later in the
  file, so a plain `.dr-substat` ties and loses on source order (18px pill beside 32px date inputs).
  The outcome control reuses `.dr-stsel` rather than `.pd-select` because the `.dr-st-*` classes only
  set a background; `color:#fff` lives on `.dr-stsel`.
- **Export** now emits sheets under their drawing with a new **"Sheet Of"** column (a per-sheet register
  otherwise exported as parents only, losing every sheet's status and date). ⚠️ Checked against **every**
  importer probe before adding — it collides with none, and all 20 probes still resolve to exactly the
  columns they did before, so the export stays round-trippable.

### Verification
**58 checks, all green**, against functions **sliced verbatim out of the shipped `module.js`** (never
reimplemented): 33 on the model (index, no double-counting, inheritance, POC, min/max rules, sentinel
rejection, the status→approved derivation incl. all four negative cases, sheet codes, orphan guard,
empty-set) and 25 on the renderers (header vs plain/parent/sheet/group row column counts in both writer
and read-only modes, plus the roll-up cells and affordances actually emitted). **In-browser** against
the real `module.css` + `icons.js` at 1440px: every row type's column x-positions identical to the
header, the 5-level indent ladder (10/30/50/70/90px), sticky parent cells opaque, revision header and
body sharing one grid with identical x-positions, all four controls at a matching 32px, white-on-pill
outcome, 0 page h-scroll, no console errors. `node --check` + CSS brace/comment balance.
⚠️ **Not verified signed-in** — nobody has clicked Break out against live data, and the migration is not
run. ⚠️ Screenshots remain impossible here (stalled compositor), so UI claims are measured geometry.
- Assets `module.css?v=20260805a` / `module.js?v=20260805a`.

## L1 is the DRAWING TYPE, not a phase — relabel + a data-loss fix (2026-08-04) — fmlozano
User: *"Progress by Phase is not necessarily phase given that FCD, Temp and ISD can happen
simultaneously."* Correct, and the workbook agrees — its **Coding Reference** sheet calls this level
**"TYPE OF DRAWING"** (DRC / ECD / SD1 / SD2 / FCD / ABD), and the module's own `TYPES` map already
lists the same vocabulary (incl. FCD, ISD, CSD). "Phase" implied a sequence that doesn't exist:
For Construction, Temporary Works and Individual Services drawings are produced **concurrently**.
- **Relabelled every user-facing string** to "drawing type": the Overview roll-up
  (`Progress by Phase` → **Progress by Drawing Type**), the filter (`All phases` → **All drawing
  types**), the Backlog column, the `+ Level` menu item, the jump select, the Add/Edit field, the
  group-row level name (`NODE_LABELS`), the duplicate-code tooltips, the reorder warning, and the
  import dialog's help text.
- ⚠️ **The stored column stays `phase`.** Renaming it means a migration across every register plus the
  importer, the collab payloads, the offline cache and `renameGroup`/`deleteLevel`'s queries — all for
  zero functional gain. `phase` is now purely an internal name; nothing shows it.
- ⚠️ **Export header is "Type of Drawing", NOT "Drawing Type".** The importer probes
  `col('drawing type')` for the separate per-drawing code part and `col()` matches on **substring**, so
  a "Drawing Type" header would make a re-import of our own export load this column into
  `drawing_type`. `"type of drawing"` does not contain `"drawing type"`, so the export stays
  round-trippable — the same property the old `Phase` header had (it matched no probe). Verified by
  running every probe against the new export header row.

### ⚠️ REAL BUG FIXED: the Add/Edit form silently wiped a drawing's type on Save
The drawing-type `<select>` was built from the hardcoded `PHASES` list alone
(`['Concept Design','Schematic Design 1','Schematic Design 2','For Construction','As-Built']`). None of
BAU101's three actual types were in it, so **no option matched, the select fell back to the blank "—",
and saving wrote `''` straight over the type** — moving the drawing to "Ungrouped". Reachable by opening
the ✎ full editor on almost any BAU101 drawing and pressing Save, with no warning.
New `phaseOptions(cur)` builds the list as **canonical ∪ types present in this project ∪ the row's own
current value**, so whatever is on screen can always round-trip. `PHASES` was also updated to the real
vocabulary (Concept Design, Schematic Design, For Construction Drawing, Temporary Works Drawing,
Individual Services Drawing, Combined Services Drawing, As-Built Drawing).
- ⚠️ `PHASES` is **display-only** — it supplies the sort order (`phaseRank`) and the default dropdown
  options, and is NOT used by the importer. Verified: BAU101 and the real GPR101 workbook both parse
  **byte-identically** before vs after this change, so a register with its own names (GPR101's
  "For Construction Drawings (FCD)") is unaffected and still orders by first appearance via
  `phaseOrderKey()`.
- **Verified 10/10** in a Node harness over the extracted functions: all three BAU101 types now offered,
  an arbitrary project-specific value round-trips, no duplicate options, canonical order still leads,
  plus the two byte-identical parse comparisons. The pre-change `PHASES` is asserted in the test to
  document that the bug was real. Existing suites re-run green (41 / 68 / 29 + GPR101 backcompat).
- Assets `module.js?v=20260804e`.

## Importer: explicit "Row Level" column + FIXED a one-day date shift (2026-08-04) — fmlozano
Driven by the BAU101 re-import off the `Dwg Registry (Based on FCD)` sheet.

### ⚠️ REAL BUG FIXED: every imported date was ONE DAY EARLY
`dateOf()` did `v.toISOString().slice(0,10)` on a Date. With `cellDates:true`, SheetJS returns the cell
displaying **30-Sep-2024** as **`2024-09-29T15:59:17Z`** (its Excel-serial epoch lands ~43s short of
midnight), so slicing the ISO string produced **2024-09-29**. Local getters are no better — that instant
is 23:59 on the 29th in Manila. **Neither a UTC nor a local read is safe.**
Fix = round the instant to the nearest whole **UTC day** (the approach material-submittal's `parseDate()`
already used), plus integer-maths paths for ISO / `18-Mar-24` / `dd/mm/yyyy` strings and Excel serials,
and a duck-typed Date check (`typeof v.getTime`) so a Date from another realm doesn't fall through to the
string branch. **Measured on the real GPR101 workbook: all 895 dates move +1 day and nothing else
changes.** ⚠️ **Every register imported before today therefore holds planned/actual dates a day early;
re-importing corrects them.**

### New: optional explicit `Row Level` column in the importer
Values `phase` | `discipline` | `category` | `drawing`. When a workbook supplies it, it **wins** over the
header heuristics; when absent, everything behaves exactly as before.
⚠️ **Why it was needed:** the heuristics infer "category" from *the absence of* a date and a description,
but a real drawing can legitimately have neither — BAU101's Temporary Works and Individual Services
sheets are titled and counted with no date and no description, and **~250 of them were being silently
turned into empty category groups**. Indentation can't rescue it: the title is read as "first non-empty
column in the title range", which discards which column it came from.
- ⚠️ Header must be **`Row Level`**, not `Level` — `col()` matches on substring and `Level` collides with
  `Floor Levels`.
- ⚠️ All four header branches are guarded with `!lvl`, and the "no substance" skip too. Without the
  guards a row explicitly declared a drawing but titled e.g. *"Site Development"* would still be
  captured as a **discipline**, and a titled sheet with no date/desc/sheets would still be dropped.
- ⚠️ A workbook fed to this importer **must** have a header row containing both `sheet title` **and**
  `dwg`/`drawing` — `findHeader()` rejects the sheet otherwise and imports **nothing, silently**. That
  is why the generated file carries an (empty) `Drawing No` column.

### ⚠️ PHASE_RE was widened, then REVERTED — do not re-widen it
Adding `temporary works` / `individual services` / a digit-less `schematic design` looked harmless and
was not: GPR101 carries those two as sub-groups under a phase, so promoting them reset `cur.discipline`
and left **25 of its drawings with no discipline** (phases 6→8, categories 245→243). Caught by diffing
this parser against the previous version on the real workbook. A register that needs those blocks as
phases declares them in `Row Level` instead — per-file, and it cannot regress another project.

### BAU101 re-import, round 2 (2026-08-04): auto-numbering + a legend-row trap
- **Uncoded drawings are now auto-numbered**, following the source's OWN conventions rather than an
  invented scheme (251 codes generated, **0 collisions**, 0 drawings left blank):
  - child of a **coded** category → `<catcode>.<n>` — the file's own style (`A-100` → `A-100.1`).
  - category with **no** code → allocate `<PREFIX>-<base>` stepping by **100** from above every number
    already used for that prefix *in that phase*. This is exactly what ISD already does
    (`S-1000`/`S-1100`/`S-1200`), so the 14 uncoded ISD/Architectural categories became
    `A-1100 … A-2400` (existing ISD `A` numbers stop at 1003).
  - drawing directly under a **discipline** with no category at all (the whole Temporary Works block,
    which has no coded row anywhere) → `<PREFIX>-<base+n>`, using the module's canonical 2-letter
    discipline codes: `TF-1001…`, `SP-1001…`, `CE-1001…`. Those cannot collide with the source's
    1-letter sheet prefixes (A/E/F/M/P/S/U) or `BIM`.
  - `PREFIX` per (phase, discipline) is the **most common prefix already used there**, not a guess.
  - Every generated code is checked against the real codes *and* against each other; the verifier also
    re-checks the module's own `(phase, code)` duplicate rule.
  - Generated rows carry `Remarks = "Auto-numbered from parent"` so the audit trail survives — a
    planner can tell our numbers from the consultant's.
- ⚠️ **TRAP FOUND: a trailing status legend was importing as 7 junk drawings.** Source rows 547-554
  hold a legend (`List` / Approved / Approved w/ Comments / Revise & Resubmit / Pending / Ongoing /
  For Approval / Superseded) in the **drawing-title column**, after a 13-row gap. Same class as
  material-submittal's sign-off block. The transform now stops at the **first run of ≥3 blank rows** —
  structural, not a hardcoded row number, and safe because the real data's longest interior blank run
  is **1** (measured). Belt-and-braces: a bare status word with no code/sheets/date is also skipped.
  Drawing count 431 → **424**.

### BAU101 re-import (data prep, not app code)
One-off Python transform reads **only** `Dwg Registry (Based on FCD)` and emits
`BAU101 Drawing Register - FCD sheet (import).xlsx`. Source levels are the staircase in cols 9/10/11/12
(phase/discipline/category/drawing) — read cell-by-cell, not from the header labels.
- Phase names mapped to the requested vocabulary: `FOR CONSTRUCTION DRAWINGS (FCD)` → **For Construction
  Drawing**, `TEMPORARY WORKS DWG (TWG)` → **Temporary Works Drawing**, `INDIVIDUAL SERVICES DWG (ISD)`
  → **Individual Services Drawing**.
- ⚠️ **Concept Design and Schematic Design do not exist in this sheet** (0 matches for
  "concept"/"schematic" anywhere in it). They are emitted as **empty phase headers** so the L1 vocabulary
  is exactly the five requested; **no drawing is invented for them**.
- 431 drawings / 18 disciplines / 64 categories: FCD 88, TWG 20, ISD 323.
- ⚠️ **258 of the 431 drawings have no code in the source** (only category rows carry codes in the TWG
  and ISD blocks). Codes are left **blank** rather than synthesised — fabricating sheet numbers in a
  drawing register is how someone ends up citing a drawing number that doesn't exist.
- `Responsible` holds stray numbers in places, so it is only carried when it contains a letter (2 dropped).
- **Verified by running the module's own `parseWorkbook`/`gridOf`/`findHeader`/`parseGrid` in Node against
  the generated file** (extracted from the shipped source, not reimplemented): 22/22 — exactly 5 phase
  nodes with the requested titles in order, every drawing on one of the 5, no blank phase or discipline,
  all disciplines canonical, category nesting + category codes preserved, nothing pre-marked approved,
  and **all 223 BL0 dates reconciled against the source as multisets with 0 mismatches** (the 3 `"- "`
  dash placeholders are correctly rejected). **Not run against the live DB** — the user imports it.

## UI review pt.3: Backlog Doc column + bulk actions (#8) — + a delete-scope bug (2026-08-04) — fmlozano
Last item of the UI review. The Registry had a Doc column and bulk actions; the Backlog — the screen
you actually work from when chasing an open submission — had neither.
- **Doc column** on the Backlog (eye → `viewFile`, em-dash when there's no file).
- **Bulk actions**: checkbox column, "select all shown", and the Registry's own selection bar
  (`#dr-selbar` — same ids, so `deleteSelected`/`setStatusSelected` are reused verbatim). Bulk status
  is the point on a backlog screen.
- ⚠️ **`visibleIds` is now published by `renderBacklog()` too**, from the **painted slice** (`shown`),
  not the full filtered list — `refreshSel`/`setStatusSelected` scope the selection by it, so without
  this a Backlog selection would be filtered out as "not visible" and the bar would read 0; and using
  the full list would let "select all shown" silently act on rows behind the 200-row page cap.
- ⚠️ **New `refreshSelBacklog()`** rather than reusing `refreshSel()`: Backlog rows are `.dr-bk-row`,
  not `.dr-drow`, so the shared row-highlight loop doesn't match them.
- ⚠️ **Both the Doc button and the checkboxes `stopPropagation()`** — they sit inside a row whose click
  opens the editor, so without it viewing a file also pops the modal.

### ⚠️ REAL BUG FIXED: `deleteSelected()` could delete more rows than the bar said
It took **every** key in `selected`, while the "N selected" count (and `setStatusSelected`) scope by
`visibleIds`. A selection made under one filter stays in `selected` while `visibleIds` changes, so the
bar could read "3 selected" and the delete could remove 10. Adding bulk actions to a second surface
made this trivially reachable, so it's now scoped to the visible selection like everything else.
⚠️ **And the file-capture loop had to move with it** — it was keyed off `selected`, so once `ids` was
narrowed it would have deleted the storage objects of rows that *survive*, orphaning them from their
files. Now keyed off `ids`. **Selection is also cleared on any tab change**, since Registry and Backlog
are different lists with different `visibleIds` and a carried-over selection just leaves the bar
counting rows you can't see.

### Verification
**68/68 in a Node harness** over the real extracted source (plus the 41 from pt.2, re-run green):
head/body column counts agree (9 = cb + 7 + Doc), select-all is scoped to `shown` in both modules,
every inner control stops propagation, `deleteSelected` is visibleIds-scoped *and* its file capture is
keyed off `ids`, selection/aging/sort all reset on tab or project change, every emitted CSS class
exists, and no text glyph was reintroduced. **In-browser** against the real chrome + `module.css`:
9/9 columns aligned, 15×15 Doc icon in a 51px column, the selection bar's shared `margin-left:auto`
correctly overridden to 0 (it would otherwise be shoved to the card's right edge), selected-row tint
distinct, aging chip a red pill inside the heading, 0 page h-scroll, no console errors.
⚠️ **Not verified signed-in**; screenshots impossible here (stalled compositor).
- Assets `module.css?v=20260804c` / `module.js?v=20260804c`.

## UI review pt.2: sortable Registry, drillable Overview, viewport fit — + a real date bug (2026-08-04) — fmlozano
Items 3, 7 and 9 of the UI review, plus a genuine correctness bug found while testing them.

### ⚠️ REAL BUG FIXED: `minusDays()` was one day early in Manila
`minusDays` built a **local** date (`new Date(iso+'T00:00:00')` + `setDate`) then read it back with
**`toISOString()`** (UTC). East of Greenwich local midnight is the *previous* UTC day, so every result
came out **one day early** — `minusDays('2026-03-31', 0)` returned `2026-03-30`, and subtracting zero
days must be the identity, which is what makes it unambiguous rather than a rounding argument.
`requiredApprovalOf()` is `minusDays(needBy, lead)`, so **every schedule-linked required-approval date
was off by a day** in PH time, and that fed the Need-by column, the float chip's colour, `agingDays()`,
the aging bar and the Backlog urgency sort. Now pure `Date.UTC` integer arithmetic. **The same bug was
in material-submittal's copy and is fixed there too.** Never mix a local constructor with UTC getters —
the trap material-submittal's importer notes already warn about.

### #3 Sortable Registry columns
- `regSort {col,dir}` + `REG_SORTABLE` + `regSortVal/regSortList/regSetSort`. All 10 data columns sort;
  click cycles **asc → desc → natural**.
- ⚠️ **Sorting is applied INSIDE each leaf group** (`buildModel()` wraps `D.nocat` and `D.cat[c]` in
  `regSortList`), never across the whole register — the phase → discipline → category tree is the point
  of this view, and a flat sort would destroy it. Group membership, roll-ups and collapse state are
  untouched.
- ⚠️ **`reorderEnabled()` now also requires `!regSort.col`.** A sorted display is detached from
  `sort_order`, so re-dealing sort_order to match a drop would scramble the real order. The third click
  (→ natural) is the documented way back, and a red **"Sorted by X ▲ ×"** chip in the list bar both says
  a sort is active and restores manual order in one click — otherwise "why can't I drag?" is a mystery.
- **Blanks always sort last**, in both directions: an empty date/status is *unknown*, not *earliest*.
- Persisted per project (`dr_regsort_<pid>`), and the restored column is **validated against
  REG_SORTABLE** — a stale key would otherwise sort by a value `regSortVal()` doesn't know.

### #7 Drillable Overview
- `drillTo(view, patch)` + `drillAttr()`/`wireDrills()`: sets the filters, syncs the actual controls,
  switches tab, and **clears `collapsed`** (a filtered Registry with everything collapsed shows group
  headers and no rows, which reads as "found nothing").
- Drillable: the **Drawings** KPI, **donut legend rows** (→ Registry by status), **aging bar segments +
  legend** (→ Backlog by bucket), the **unlinked-items count**, **Progress by Phase/Trade rows**
  (→ Registry by phase/discipline), and the Backlog's **Revise & Resubmit** KPI.
- ⚠️ **Deliberately NOT everything.** Total sheets / Submitted / Approved / Approved % / Balance are
  **sheet** aggregates, not sets of drawings — drilling them would land on a list whose row count
  doesn't match the number clicked. They get no pointer and no hover, so "looks clickable" always means
  "is clickable". Same for the `—` placeholder row in the progress tables (no filter value selects it).
- **`agingBucketOf(r)`** is now the single source of truth for bucketing, used by both the chart and the
  drill filter, so the two can never disagree.
- **`bkAging`** is a Backlog-only filter (aging is schedule-derived, meaningful only for open items, and
  the Registry has no aging column) — shown as a removable chip in the Backlog card header, and reset on
  project switch so it can't leak.
- ⚠️ `drillTo`'s select-setter **adds the option if missing**: a legacy status like "Approved w/o
  comments" exists in data and appears on the donut but isn't in the filter list, and a `<select>`
  silently ignores an unmatched value — the filter would apply while the control read "All statuses".

### #9 Registry fills the viewport instead of guessing chrome height
`max-height:calc(100vh - 205px)` hardcoded an assumption about chrome height, but the topbar now wraps
to **5 rows at 800px** (the 2026-07-24 mobile passes). **Measured at 800×720: the old rule put the card
bottom 24px PAST the viewport and gave the page a 40px scroll; the new one lands 16px inside with 0 page
scroll.** `body.dr-fit` (set by `render()` on Registry only) makes the shell a real `100dvh` flex column
so the card takes what's left. ⚠️ Gated `@media (min-width:701px)` — the phone breakpoint deliberately
releases the cap for page scrolling, and this block's higher specificity would otherwise beat it.
Overview/Backlog are multi-card documents and keep normal page scroll.

### Verification
- **41/41 in a Node harness** extracting the **real** functions from `module.js` (no reimplementation):
  sort asc/desc/case-insensitivity/numeric-not-lexical/blanks-last-both-ways/no-caller-mutation, the
  3-click cycle, unknown-column guard, all 5 aging buckets **including the 60/30/0 boundaries**, every
  produced bucket ∈ AGING_ORDER, and 9 `minusDays` cases (identity at n=0, month/year/leap boundaries,
  garbage → null) for **both** modules' copies.
- **In-browser against the real `index.html` chrome + real `module.css`** (gitignored harnesses, deleted):
  #9 measured at 375/768/1280 via **per-width iframes** (`resize_window` proved unreliable mid-session) —
  clamped to the viewport with 0 page scroll at 768/1280, correctly **not** clamped at 375 (page scrolls
  12,482px); sorted header red + indicator + `user-select:none`, and **frozen Code/Title columns still
  `position:sticky`** now that they're also sort buttons; sort chip a red pill in the list bar; drill
  affordances have `cursor:pointer` + `role=button` + `tabindex=0` while non-drillable aggregates have
  `cursor:auto` and no role. No console errors.
- ⚠️ **Not verified signed-in against live data**, and **screenshots remain impossible** here (stalled
  compositor) — all UI claims are measured geometry/computed style, not observed rendering.
- Assets `module.css?v=20260804b` / `module.js?v=20260804b`.

## UI review: debounced search, loading skeleton, clear-filters, icons (2026-08-04) — fmlozano
Four items from a UI review of this module (items 1/2/4/5 of the review; sorting, KPI click-through
and the Backlog Doc column were deferred).
- **Search is debounced (160ms); the selects still apply instantly.** ⚠️ **Do not fold search back
  in with the selects.** The old handler was `el.oninput = el.onchange` over all four controls, so
  **every keystroke ran `computeDups()` + `buildModel()` + a full `innerHTML` rebuild of every row** —
  visible typing lag on a 1,000+ drawing register (Bauhinia is 1,114). New `readFilters()` is shared
  by both paths so there's still one place that reads the controls.
- **Loading skeleton** (`skeletonHTML()`, `.dr-sk*`): spinner + 9 shimmer rows. ⚠️ **Gated on
  `opts.reset`** — a bare `load()` is a post-edit refresh, and flashing a skeleton there would make
  every save look like a full reload. Only project switch / init / import / clear show it. Without
  this, `load()`'s keyset pagination (1000 rows per round-trip) left the *previous* project's grid on
  screen and then swapped, which read as a glitch.
- **Ghost clear-filters button** (`#dr-f-clear` / `.dr-clearfilt`), copied from
  `.ms-clearfilt`/`.pp-clear`. `syncClearFilt()` shows it only when `anyFilter()` is true (which
  includes the duplicates-only toggle), so it never orphans in dead space; it's called from
  `render()`, so the saved-views and dup-legend paths keep it in sync too. Clearing also resets
  `filters.dupsOnly` and cancels a pending debounce.
- **Text glyphs → inline SVG** (`ico()` → `Icons.svg`): row actions `▤ ✎ ✕` → eye / pencil / trash,
  level delete `✕` → trash, group caret `▾` → chevronDown, saved-views `✕`/`＋` → x / plus, and the
  per-revision file buttons in the edit form. The glyphs rendered at inconsistent weights across
  Windows font fallbacks. ⚠️ **Must be `Icons.svg` inline, not `data-ico`** — `Icons.hydrate()` only
  runs on DOMContentLoaded, and grid rows are re-rendered constantly. `⚠` (duplicate-code mark) is
  deliberately kept: icons.js has no warning glyph and it's a semantic marker, not a control.
- **`icons.js` gained a `pencil` icon** (there was none) → **`icons.js?v=` bumped
  `20260724a` → `20260804a` across all 17 referencing HTML files** (shared asset).
- **Verified in-browser** (gitignored `_ui_test.html` against the real `module.css` + `icons.js`,
  deleted after): skeleton 9 rows / 11px bars / 13×13 spinner; clear button `display:none` when no
  filter → `flex` 52×31 with a hydrated 13×13 × icon, contained in the filter bar, and **adds no row
  to it at 1280px even with the Views button present** (57px either way); all row/level/caret buttons
  emit a 15×15 SVG inheriting `currentColor` through every existing hover rule; caret collapse still
  rotates (`matrix(0,-1,1,0,0,0)`); `pencil` geometry sane (17×17 inside the 24×24 viewBox, in line
  with trash/eye); 0 page h-scroll; no console errors. ⚠️ **Screenshots remain impossible here**
  (stalled compositor) — checks are measured geometry. **Not verified signed-in against live data.**
- Assets `module.css?v=20260804a` / `module.js?v=20260804a`.

## Searchable schedule-activity picker (2026-08-03) — fmlozano
Replaced the Activity (need-by) `<input list>` + `<datalist>` with a real searchable dropdown.
- ⚠️ **A datalist physically cannot search by name.** Browsers filter datalist options by the option's
  **`value`**, which must be the `activity_id` we store — the activity name lived only in the display
  text, so typing it matched nothing. This is why it had to be rebuilt rather than tweaked.
- `schedPickerHTML()` renders a search box + hidden `#dr-f-sact` (the stored id) + a selection chip
  (`ID — Name`, with a clear ×). `wireSchedPicker()` handles input/focus/Enter(first match)/Esc/
  outside-click. `schedMatches()` = whitespace-separated **AND** matching over `activity_id + " " +
  activity_name`, lowercased; capped at `SCHED_PICK_MAX` (60) rows/query because schedules reach 40k
  activities, with a "keep typing to narrow" hint when the cap is hit.
- **Lazy-load handling:** the schedule loads after the register, so a form opened early showed a stale
  "not in this project's schedule" warning forever. A capped poller (60 × 500ms, cleared by a wrapped
  `m.close`) refreshes the chip + derived date once `schedPid === pid`.
- Verified `schedMatches()` in a Node harness (by-ID, by-name, multi-term AND, case-insensitivity,
  no-match, cap) + `node --check` + CSS brace-balance. **Not browser-verified.**
- Assets `module.css?v=20260803h` / `module.js?v=20260803j`.

## Chart.js adoption + per-revision drawing files (2026-08-03) — fmlozano
- **Chart.js 4.4.1 + chartjs-plugin-datalabels (CDN) replaces the hand-rolled SVG period chart.**
  ⚠️ **This reverts the `preserveAspectRatio="none"` change from the previous entry, which WAS the
  "S-curve looks stretched" bug** — non-uniform scaling distorts the viewBox's contents (text, point
  markers), not just its box. And the reason hover "didn't work like the prc-app" is simply that PRC
  uses Chart.js; its `interaction:{mode:'index'}` tooltip is the thing being compared against.
  `periodChartSVG` + `wirePeriodHover` (~110 lines) deleted. `.dr-pc-wrap` must keep an explicit
  height — Chart.js with `maintainAspectRatio:false` collapses to 0 without a sized parent.
- **`#`/`%` is one switching button** (`.dr-segswitch`), not a 2-button segmented control.
- **`#dr-view > .pd-card / > .dr-dash-grid { margin-bottom:16px }`** — the Overview's top-level blocks
  had no margin between them, so the Status card collided with the chart below it. Done as one rule
  for the view rather than per-card so new sections inherit the rhythm.
- **Per-revision drawing files.** Each `submissions[]` entry now carries its own `file_url` (upload /
  view / remove per revision in the form); the row-level `file_url` is now specifically the
  **approved** version. **No migration** — `submissions` is already jsonb.
  ⚠️ **Ordering invariants (copied from material-submittal's attachment work, don't "simplify" them):**
  upload before the row write; roll back this save's uploads if the write fails; delete superseded
  objects only after the row points away; ✕ is deferred to Save so cancelling never deletes a file.
  New `allFilesOf(r)` collects the approved file + every revision's file for row/bulk/clear deletes,
  capturing paths before rows leave memory.
  ⚠️ Per-revision file inputs are read by their **current DOM index before `subs` is filtered** —
  filtering first would reindex the array and attach uploads to the wrong revision.
- Assets `module.css?v=20260803g` / `module.js?v=20260803i` + 2 CDN script tags. Verified
  `node --check`, CSS brace-balance, 0 stale refs. **Not browser-verified.**

## Period chart overhaul: PowerBI hover, actual bars, %/# toggle + layout fixes (2026-08-03) — fmlozano
Second round of live-review feedback (Bauhinia). Concrete asks + real bugs found while doing them:
- **Real bug: the chart wasn't actually full width.** `width:100%` + a fixed pixel `height` with no
  `preserveAspectRatio` override means the browser's default `xMidYMid meet` scales the 960×h viewBox
  down to fit *inside* the box while preserving aspect ratio — on a card much wider than the chart's
  own ratio, that letterboxes it (empty space left/right). Fixed with `preserveAspectRatio="none"`
  (safe: every coordinate is already computed from the target pixel dimensions).
- **PowerBI-style hover** (`wirePeriodHover`): a real floating tooltip (`.dr-pc-tip`) + vertical guide
  line, driven by transparent per-period hit-zone rects (`.dr-pc-hit`, drawn last = on top) instead of
  the plain-browser `<title>` tooltip from before.
- **Actual-this-period bars** — grouped bars per period (light-gray Planned + translucent-red Actual),
  not just the cumulative Actual line.
- **Data labels above bars** when ≤20 periods (`showLabels`); beyond that, hover carries the detail.
- **`periodValueMode` (# / %) toggle** — `periodScaled()` rescales every value as a % of `draws.length`
  when active; y-axis pins to 0–100 in % mode (the conventional S-curve reading).
- **Legend centered** (`.dr-pc-legend { justify-content:center }`).
- **KPI accent color** — was brand red on every card by default (six neutral metrics all "flagged red"
  read as clashing); default is now a muted neutral, red/green/amber reserved for `.dr-warn`/`.dr-ok`.
- **`.dr-dash-grid` `align-items:start`** — CSS Grid's default `stretch` was forcing the 4-row
  "Progress by Phase" table to match the height of the 11-row Trade table beside it, leaving a big
  blank gap. Real bug, not a spacing preference.
- **"Progress by Discipline" → "Progress by Trade"** (heading text only, `groupAgg('discipline')`
  unchanged).
- Assets `module.css?v=20260803f` / `module.js?v=20260803h`. Verified `node --check` + CSS
  brace-balance. **Not browser-verified** (auth wall) — reasoned from the SVG/DOM spec, not observed
  in a live render.

## KPI card polish + chart readability pass (2026-08-03) — fmlozano
User reviewed a live screenshot of the Bauhinia Overview and called out three things:
- **KPI cards "too close together" / "maximize the space" / "look professionally built":** `.dr-kpis`
  went from a fixed `repeat(6,1fr)` grid to `repeat(auto-fit, minmax(170px,1fr))`, gap 12→18px, card
  padding 16/18→20/22px, value font 26→32px, added `box-shadow` + hover lift, thicker 4px accent bar.
  Cards now claim real width on a wide screen instead of being squeezed into six equal narrow slots.
- **"Open Items by Aging doesn't look very helpful":** Bauhinia has 997 of 1,010 open items with no
  schedule link, so the old bar (built from ALL 5 buckets incl. "No due date") was one giant grey blob
  — the genuinely actionable overdue/tight buckets were reduced to a barely-visible sliver. The
  proportional bar (`AGING_DATED`) now excludes "No due date" entirely; it's reported as a separate
  line below ("+N open items not yet linked…") instead of competing for bar space. If zero items have
  a date, the card says so explicitly instead of rendering an all-grey bar.
- **"The s-curve doesn't look very nice"** (the Period chart): taller (220→280px), rounded bar tops,
  a translucent gradient area fill under Cumulative Planned (the classic S-curve "target band" look),
  point markers on both cumulative lines, dashed gridlines, and the planned line recolored from
  `currentColor` (which reads washed-out, same tone as the muted axis labels) to `var(--pd-ink)` —
  theme-correct but a solid, clearly visible line.
- Assets `module.css?v=20260803e` / `module.js?v=20260803g`. Verified `node --check`. **Not
  browser-verified against a real render** — this pass was visual-design work against the user's
  screenshot, not something `node --check` can confirm looks right.

## Live UI review fixes: Backlog scroll containment, sentinel-date bug, KPI sections (2026-08-03) — fmlozano
Reviewed the live deployed site against a real project (Bauhinia, BAU101) and GPR101; found and fixed:
- **Backlog scroll containment.** Bauhinia has **1,010 open items** — rendering all of them as one
  page-length table was the "vastness" the user hit. `renderBacklog()` now wraps the table in
  `.dr-bk-scroll` (`max-height:min(62vh,640px); overflow-y:auto`) so the KPI row + card header stay
  fixed and only the table body scrolls, **and** only paints the first `BK_PAGE` (200) sorted rows
  until "show all" is clicked (`bkShowAll`) — DOM stays light even on a huge backlog. Sort/filter
  always operate on the full list before slicing, so paging can never hide the worst-ranked rows.
- **Real bug found live: "Jan '00" on the new Period chart.** A live Supabase query (run from the
  browser console against the deployed site) turned up ~9 GPR101 drawings with
  `actual_approval = "2000-01-06"` — a legacy-import sentinel/placeholder, not a real date — which
  stretched the whole chart's x-axis to a 25-year span. `periodKeyOf()` and `agingDays()` now discard
  any date outside 2015–2100 as "no date."
- **`kpiSection()`** — wraps a KPI row with a small uppercase eyebrow label ("Register Overview" /
  "Backlog Overview"), matching WPM's "Cost Overview" / "Work Package Status" section-label pattern.
- Assets `module.css?v=20260803d` / `module.js?v=20260803f`. Verified `node --check`; the sentinel-date
  bug and Bauhinia's row count were confirmed live before fixing (not guessed).

## Overview: Aging bar + Period chart (2026-08-03) — fmlozano
Added the two remaining WPM Overview charts, on top of the status donut from the previous pass.
- **`agingBuckets()`/`agingBarSVG()`** — a stacked horizontal bar over the whole project's open items
  (not status-approved), bucketed by `agingDays()` (>60d overdue / 30-60d overdue / 0-30d current /
  Future / No due date). Deliberately **unfiltered** — an aggregate independent of the Registry/Backlog
  filter bar's current selection, same scope as the status donut.
- **`periodBuckets()`/`periodChartSVG()`** — bar+line chart (grey bars = drawings planned to be
  approved that period, dark line = cumulative planned, red line = cumulative actual) grouped by
  `planned_approval`/`actual_approval`, with a Monthly/Quarterly toggle (`periodMode`, `.dr-seg`
  buttons wired after render).
- Both live in the Overview tab (`renderProgress`), above the existing Progress-by-Phase/Discipline
  tables. New CSS: `.dr-seg`/`.dr-seg-btn` (segmented toggle, mirrors the existing tab-strip style).
- Assets `module.css?v=20260803c` / `module.js?v=20260803e`. Verified `node --check`. **Not
  browser-verified** (auth wall).

## Pattern the WPM Backlog/Overview look further: Aging column, sortable headers, status donut (2026-08-03) — fmlozano
Follow-up after the tabs shipped: user pointed at the live WPM (Procurement) project view and asked to
match its look more closely.
- **`agingDays(r)`**: `today − requiredApprovalOf(r)` (falls back to `planned_approval` when unlinked to
  a schedule activity) — positive = N days overdue, negative = N days still to go, same convention as
  WPM's Aging(d) column. Added as a 7th Backlog column.
- **Sortable Backlog headers** (`bkSort`/`BK_COLS`/`bkSortVal`/`bkSetSort`): click any header to sort by
  it, click again to flip direction (▲/▼ indicator). Default is unchanged from before (most urgent
  first, via the existing `backlogUrgency`).
- **`donutSVG()` + `statusCounts()`** on the Overview tab: a ring chart (pure inline SVG, no library)
  showing drawing count by approval status, using `STATUS_COLOR` mapped to the same colors as the
  Registry's status pills (`statusCls`) so the two views agree visually.
- Assets `module.css?v=20260803b` / `module.js?v=20260803d`. Verified `node --check`. **Not
  browser-verified** (auth wall).

## Overview / Backlog / Registry tabs — procurement-style project view (2026-08-03) — fmlozano
Restructured the topbar from Register/Progress into three tabs matching the Procurement (WPM)
project-view pattern: **Overview | Backlog | Registry**.
- **Overview** = the existing "Progress" dashboard (`renderProgress`), unchanged.
- **Registry** = the existing "Register" grid (`renderRegister`), unchanged — this is "the current
  page folded into the Registry tab."
- **Backlog** (new): `backlogRows()` = drawings not `isApprovedStatus` OR still `Revise & Resubmit`;
  sorted by `backlogUrgency()` (uses the existing schedule-link `docFloatOf()` — negative/late first,
  then tight ≤3d, then un-linked rows ranked by status). KPIs (open items / late vs need-by / due
  ≤3d / Revise & Resubmit) + a table (Code/Title/Phase/Discipline/Status pill/Need-by chip); clicking
  a row opens the existing `openForm(r)` edit modal. Reuses `statusCls`/`needByCellHtml`/`kpi` — no
  new visual language introduced.
- `view` default changed `'register'` → `'overview'`; `restoreUI()` migrates old persisted values
  (`register`→`registry`, `progress`→`overview`) so a returning user's saved tab still resolves.
- No DB/migration change. Assets `module.css?v=20260803a` / `module.js?v=20260803b`. Verified
  `node --check` + confirmed all called helpers exist. **Not browser-verified** (auth wall).

## BAU101 (Bauhinia) migration prep: 5 new disciplines recognized (2026-08-03) — fmlozano
Preparing to migrate the Bauhinia project's real drawing register (multiple candidate sheets in
`EPC. OPS. BAU101 Drawing Register Version 01. 2025 03 14.xlsx`) surfaced construction-methodology
"disciplines" the importer didn't recognize: **Temporary Facilities** (workbook also spells this
"Temporary Works" in an older tab), **Safety Protection**, **Construction Equipment**, **Other
Specialties**, **MEPF Combined**. Without recognizing them, `disciplineHeader()` fell through to
the category-classifier and mis-nested those drawings under whichever discipline preceded them.
- Added all 5 as new `DISCIPLINES` entries + matching `disciplineHeader()` MAP keys — **purely
  additive** (new recognized labels only; every existing key/value/behavior for GPR101-style
  imports is untouched). `module.js?v=` bumped `20260726a`→`20260803a`.
- **Also found and worked around (not a code fix — a data-shaping one) during the same
  reverse-engineering pass:** the importer's category-vs-drawing classifier only distinguishes the
  two by "has at least one submission date OR a description" — it does **not** look at the drawing
  code at all. A drawing row with neither (exactly what you get when deliberately importing a
  design phase with no real submission history, i.e. skipping fabricated dates) is silently
  swallowed as a phantom category node. Not fixed in `parseGrid` itself (GPR101's own workbook
  apparently never hits this — its real drawings always carry a date or description — so changing
  the classifier's rule risks that primary format instead). Worked around **in the import file
  itself**: any dateless/descriptionless drawing gets its own (truthful, unembellished) title
  copied into Description before import, which is enough to survive classification.
- Verified by extracting the real `parseWorkbook`/`gridOf`/`findHeader`/`parseGrid` functions
  straight out of this file and running them in Node against the generated import workbook (not a
  reimplementation) — confirms the shipped importer, unmodified beyond the 5 new disciplines, parses
  the prepared BAU101 file into the intended phase→discipline→category→drawing tree with 0 drawings
  landing with a blank discipline and 0 stray dates on the dateless early-phase drawings.

## Offline editing + sync — Phase 2 (2026-07-26) — fmlozano
Wired the shared **PDSync** outbox (`assets/js/offline.js`): edit inline with no connection, sync on
reconnect.
- **`persistCell`** routes its update through `PDSync.write({table,op:'update',id,patch})` (falls back to
  a direct write if PDSync is absent). Optimistic `Object.assign(r,patch)` is unchanged, so the edit
  shows instantly whether online or queued.
- **Read-offline:** `load()` caches rows via `PDSync.cachePut('dr:'+pid, rows)` on success and, when the
  fetch fails (offline), renders from `PDSync.cacheGet`. `persistCell` re-caches after each edit so an
  offline reload shows the pending change (the outbox re-applies it on reconnect regardless).
- **Field-level LWW**, online behaviour byte-identical to before (see main CLAUDE.md).
- ⚠️ **Scope:** offline covers **inline cell UPDATES only.** The modal Add/Edit, single/bulk **delete**,
  Clear-all, and Excel import stay **online-only** (desk activities; deletes still call `load()`). No
  migration. Verified: `node --check` + the shared outbox Node harness. NOT browser-verified (needs a real
  offline→online cycle). Assets: new `offline.js?v=20260726d`.

## Live collaboration — presence + live cell editing (2026-07-26) — fmlozano
Proving ground for the app-wide **PDCollab** layer (shared `assets/js/collab.js`, Supabase Realtime).
Google-Sheets/Teams-style co-editing: topbar avatars of who's viewing the project, colored outlines of
the cell each person is editing, and live row updates when someone else saves.
- **Wiring:** `joinCollab()` (re)joins a per-project channel on load + project switch (`key =
  drawing_register:<pid>`, `table = drawing_register`). `renderPresence` → `#dr-presence` avatars.
  `broadcastSel(rowId,field,editing)` fires on cell click + on `beginEdit`/commit. `paintRemote()`
  (called at the end of `render()`) outlines each remote user's `tr.dr-drow[data-id] td[data-f]` cell
  via `PDCollab.paintCell`. `applyRemoteChange` patches `rows` from postgres_changes (INSERT/UPDATE/
  DELETE) and re-renders — **deferred while `.dr-editing` is open** (`_deferredRemote`) so a remote save
  can't wipe my inline input, then flushed on commit.
- **Conflict model:** last-write-wins per cell (a grid, not rich text). Two users on different fields of
  the same row both win; same-cell simultaneous edits converge via each write's own echo (brief flash).
- **Migration `../../migrations/2026-07-26-realtime-collab.sql` (USER MUST RUN)** — adds
  `drawing_register` to the `supabase_realtime` publication + `replica identity full`. Presence/cursors
  work WITHOUT it; only the live-value stream needs it. Without the migration the module still works
  (avatars + cursors), just no live row updates.
- Verified: `node --check` + presence-render unit checks. **NOT browser-verified** — needs two
  signed-in sessions to observe presence/cursors. Assets `?v=20260726a` (+ new shared `collab.js`).
- **Next:** once live-verified with 2 users, the same pattern drops into Project Schedule.

Developer change log for the **drawing-register** module. Also the **reference
module for file uploads** (private bucket + signed-URL viewing). Update every PR.

## Project Schedule link — Need-by column + auto-derived planned approval (2026-07-25)
Connected the register to the Project Schedule. A drawing is a prerequisite for construction work:
the linked activity's **start** is the drawing's **need-by** date, and (start − `lead_days`) is the
date it must be **approved by**.
- **Migration `../../migrations/2026-07-25-schedule-document-links.sql` (USER MUST RUN).** Adds
  `schedule_activity_id` (links to `project_schedule.activity_id`, the **business key** — survives P6/XER
  re-imports, which delete+reinsert rows and change the uuid), `schedule_wbs` (reserved for a coarser
  WBS-level link), and `lead_days` (NULL → `LEAD_DEFAULT` = 30).
- **Schedule cache** (`ensureSchedule`/`loadSchedule`): keyset-loads the project's leaf activities
  (`activity_id`, `activity_name`, `start_date`, `actual_start`) lazily after the main load, then
  re-renders the register. Skips WBS-Summary rows. Degrades quietly if the schedule can't be read.
- **New "Need-by" grid column** (`needByCellHtml`): shows the required-approval deadline + a **float
  chip** — green slack / amber ≤3d / red late — comparing the actual-or-planned approval date against
  the deadline. Blank when the drawing isn't linked. ⚠️ Adding the column touched **both** the header
  and `groupRowHTML`'s cell count (added the th + two empty `<td>`s so the group-row spans still align);
  `.dr-grid` min-width bumped 1080→1180.
- **Add/Edit form — "Schedule link" section:** an activity datalist (`schedOptions`, capped 3000),
  `lead_days`, a read-only **Required approval** preview, and a live hint that offers to **set it as the
  Planned approval** (checkbox, default on when the drawing has no planned approval yet). Saved via a
  **tolerant write** (strips the two new fields + warns if the migration hasn't run, so saves never break).
- Verified: `node --check` passes. **Not yet browser-verified** (auth wall + the schedule cache needs a
  real project with a schedule). Assets `?v=20260725a`.
- **Reciprocal not built here:** the Project Schedule "Documents" tab / document-readiness flag (the
  schedule-side view of the same link) is a follow-up in `modules/project-schedule/`.

## Audit fix: paginate the register load (2026-07-21)
`load()` used a single `select('*')` (Supabase caps at 1000) — the register **already truncated**
(the GPR101 workbook is 1,032 drawings), so the grid, Progress KPIs, phase/discipline roll-ups,
export and Clear-all silently operated on only the first 1000. Now **keyset-paginated** by `id`, then
re-sorted in memory to the previous DB order (`sort_order` ASC NULLS-LAST → `drawing_no`). Verified:
parses clean; Node test confirms the re-sort reproduces the DB order and the loop loads all rows. No
migration, no `?v=` bump.

## Status
- [x] Full-fidelity rebuild matching the Megawide "Drawing Register & Tracker"
      workbook (`GPR101. TEC. Drawing Register`).
- [x] CRUD + Excel import + export + progress dashboard
- [x] `enabled: true` in `assets/js/config.js`

## Project-Schedule-style row interaction (2026-07-17)

Asked to bring Project Schedule's grid feel here. **Most of it was already present** —
inline cell editing, click-to-select + Shift/Ctrl range, keyboard shortcuts, and group
collapse all existed. The genuine gaps were these four, each fixed:

1. **Drag-to-reorder rows — was entirely missing.** Drawings are now `draggable` and
   reorder within their own group, with Project Schedule's affordances: dimmed drag row
   (`.dr-rowdragging`), a red insertion line on the hovered target's top/bottom edge
   (`.dr-drop-above/-below`), and a grab cursor only while reorder is armed.
   - ⚠️ **`sort_order` is re-dealt from the group's OWN pool of values, never renumbered.**
     Phase order comes from each phase's *minimum* `sort_order` (`phaseOrderKey`), so free
     renumbering would silently reshuffle the phases. Re-dealing the same multiset keeps
     every phase's min fixed. Verified: after a reorder the SD1 pool is still `[10,11,12]`
     and phase order is unchanged. A NULL in the pool simply re-deals to whichever row
     should sort last (matching Postgres ASC NULLS LAST).
   - **Armed only when no filter/search is active** (`reorderEnabled()`), mirroring PS's
     `_reorderEnabled()`: with a filter on you'd be reordering against rows you can't see.
   - Reorder is refused across groups **and** across phases (dragover won't even accept the
     drop; an explicit toast explains why).
   - No migration — `sort_order` already exists on `drawing_register`.
2. **Collapse only fired on the small label span**, so clicking anywhere else on a group
   row did nothing — this is what made collapsing "feel unnatural" vs PS. The **whole group
   row now toggles** (PS's Excel-style behaviour); the label still owns dblclick-to-rename
   and buttons/checkboxes own their clicks.
3. **The add target was invisible.** Selecting a group set `selCtx` but showed no state, so
   "+ Add drawing" inserted into a level the user couldn't see was chosen. Group rows now
   carry `.dr-grpactive` (a red left rail, so the level tints still read) and it survives
   re-renders via `activeGrpKey`.
4. **Real bug — Add filed rows under the wrong level.** `selCtx` was only ever set from
   *group* row clicks, so selecting a **drawing** and hitting "+ Add" filed the new row
   under whatever group was last touched (or ungrouped). Clicking a drawing now sets the
   context from that drawing, so Add/Enter inserts a **sibling** next to it — PS's
   behaviour. Verified: click A-201 → Add → new row is `A-202` under AR/Elevation with the
   title editor open.

**Bug found in my own work during verification:** `buildModel()` walks `rows` in array
order (only sorted because `load()` fetches `.order('sort_order')`), so mutating
`sort_order` in memory persisted correctly but the row **didn't move on screen until a
reload**. Added `sortRows()` (NULLs last) before the optimistic `render()`.

**Not ported** (deliberate — large, and not what was asked): PS's row virtualization, cell
clipboard (TSV copy/paste), column chooser/column menu, and undo/redo. **Reorder is
therefore not undoable** — PS pushes a `reorder` undo entry, but this module has no undo
stack at all.

Harness-verified with a mutable store + real `DragEvent`s: move-to-top and move-back both
update display *and* store (`A-103@10, A-101@11, A-102@12`); cross-group and cross-phase
drags refused; phase order preserved; filters disarm and re-arm the drag; group-body click
collapses (6→2 rows) and re-expands; active group survives re-render; no regressions in
inline edit, status dropdown, single/shift select, or checkboxes.

## Shift-click text-selection + duplicate legend (2026-07-17)
- **Shift-click no longer drags a native text selection.** The `user-select:none` rule was gated on
  `.dr-grid.dr-reorder` (only during reorder), so range-selecting still highlighted text + popped the
  browser selection menu. Now `user-select:none` applies to all `.dr-grid td/th` unconditionally, with
  `user-select:text` restored on inputs/selects/textarea/`.dr-editin`. Verified: shift-click selects a
  4-row range with **0 characters natively selected**.
- **Duplicate-code flag redesigned.** Dropped the two-tone amber cell background (looked off). Kept a
  clearer round ⚠ badge on each duplicate code, and added a **legend chip** in the list bar —
  "⚠ N duplicate code(s)" — that is always visible when duplicates exist and **clicking it filters to
  duplicates only** (`filters.dupsOnly`; toggles back). Verified: legend counts distinct duplicated
  codes, badge on both offending rows, filter shows only the dupes and restores. `?v=20260717i`.

## "+ Add" no-selection fix (2026-07-17)
- **Root cause of "Add not working":** with nothing selected (the default all-collapsed view),
  `addDrawing` inserted an **ungrouped orphan** row (`D-001`, empty phase) at the bottom under a new
  "Ungrouped" phase — off-screen among the collapsed phases, so it read as "nothing happened."
- **Fix (matches Project Schedule):** when no phase/discipline/category/drawing is selected, "+ Add"
  now **opens the full Add form** (`openForm(null)`) so the planner sets the location explicitly.
  When a row/group IS selected it still inline quick-adds a sibling in that context (auto-numbered,
  editor opens). Verified in a harness: no-selection → form opens, 0 orphan rows; drawing selected →
  inline A-103 into Floor Plan with the title editor open; no console errors. `module.js?v=20260717h`.

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

## BAU101 re-import: Status + every approval/submission date the source actually holds (2026-08-04) — fmlozano
User: "the import for BAU did not include the status of the drawings seen in Column AD… check all the
data that are useful that can be imported", plus "check for approval dates and the submission dates
BL0-BL4 (Planned) and Actual". The 2026-08-04 transform had emitted **only 11 columns** (No, Row Level,
Project name, Drawing No, Sheet Title, Category, Description, Responsible, No of Sheets, Subm BL0,
Remarks-for-auto-numbering) — so Status, every approval date, every actual submission date, BL1–BL4 and
**the source's own Remarks** were all dropped. Measured through the shipped parser, old file → new file:

| carried onto drawings | old | new |
|---|---|---|
| Status | **0** | **208** |
| Planned approval (Approval Date BL0) | **0** | 71 |
| Actual approval | **0** | 78 |
| Actual submission (rev 0) | **0** | 204 |
| Actual submission rev 1 | **0** | 50 |
| Re-baselined plans (BL1–BL4) | **0** | 88 (9 with all five) |
| Approved sheets | **0** | 200 |
| Source remarks | 0 (251 auto-number notes only) | 355 |
| structure (phases/disciplines/categories/drawings) | 5 / 18 / 64 / 424 | **identical** |

**Four importer defects fixed (all affect any register, not just BAU101):**
- ⚠️ **`papp` never matched the real header.** The OPS template calls the planned approval date
  **"Approval Date (BL0)"**; the matcher only knew `approval date (plan` / `planned approval`, so on
  BAU101 it silently resolved to −1 and every planned approval date was dropped. Added
  `approval date (bl` + `approval date (base`. (GPR101 uses "(Plan)" and was already fine.)
- ⚠️ **`Approved w/ Comments` was silently downgraded to plain "Approved".** `normalizeStatus` tested
  `/with *comment/`, which the slash spelling doesn't match, so it fell through to the bare `/approved/`
  test. 16 BAU101 drawings **and 3 GPR101 drawings** lost the distinction. The `w/o comments` branch is
  unaffected — `w\/ *comment` can't match "w/o comments" because an `o` follows the slash.
- ⚠️ **BL0–BL4 all collapsed onto rev 0 and overwrote each other.** A "(BLn)" header is a *re-baseline
  of the planned date for the same revision*, not a drawing revision, but `subCols` had no concept of
  it. Now each is captured with a `bl` index: **`planned` = the latest non-empty baseline** (that is the
  point of a re-baseline) and the whole series is kept on the submission entry as `bl:{0:…,1:…}`, so the
  original baseline and the slip between them survive. `submissions` is jsonb → **no migration**.
- **`Ongoing` / `Pending` are now first-class statuses** (`STATUSES`, `statusCls` + a new `.dr-wip`
  indigo pill, `STATUS_COLOR`, and `normalizeStatus`). ⚠️ Not cosmetic: the grid's inline Status cell is
  a `<select>` built from `STATUSES`, so a value outside the list **displays as the first option while
  the row holds something else** — the same silent-mismatch trap the Overview status filter hit. Neither
  counts as approved (`isApprovedStatus` untouched), so both stay in the Backlog. 59 BAU101 drawings are
  "Ongoing", 10 "Pending".

**Data-prep notes (one-off transform, not committed app code):**
- The new file **enriches the previously delivered one** rather than regenerating it, so the
  auto-numbered codes and row order are byte-identical. Safe because the two align **1:1 — 509/509
  source rows, 0 level or title mismatches** (verified before writing anything).
- ⚠️ **The "stop at the first run of ≥3 blank rows" rule documented earlier is wrong for this sheet.**
  There is a **14-row blank stretch INSIDE the real data** (rows 487–500) before OTHER SPECIALTIES /
  MEPF COMBINED, which contribute the last 31 rows (2 disciplines + 5 categories + 24 drawings). The
  cut is now structural: **stop at the row whose col A is "List"** — the status-legend block (rows
  547–554), which is what the blank-run rule was really there to exclude.
- Row level comes straight from which indent column holds the title (I → phase, J → discipline,
  K → category, L → drawing) — 3/18/64/431 in the source, 431 − 7 legend titles = the 424 drawings.
- **Placeholder junk is correctly rejected, not imported:** 3 `'- '` in BL0, 12 in BL1, 9 `'-'`/`' '` in
  Approval BL0, and **two cells where someone typed "Approved" into the *Actual Subm. Date rev 1*
  column** (source rows 243–244). Also the 3 "1-2/3/4 Weeks Lead Time" values in column AD are part of
  the legend block, not statuses — excluded by the cut.
- **Approved % (AF) is deliberately not imported** — measured 253/253 rows where it equals
  `Approved Sheets ÷ No of Sheets`, and the importer already derives `approved_pct` itself.
- **No column exists for Prioritization (AB, "Critical Level", 40 rows), Planned Award Date (AC, 49) or
  Vendor (AI, 3)**, so they are appended to Remarks as `Critical: Level 3` / `Planned award: <iso>` /
  `Vendor: …` — lossless and searchable, but not filterable. A real `criticality` column would need a
  migration. Date Awarded / Delivery / Installation are **entirely empty** in the source (0 rows) and
  belong to the procurement side anyway.

**Verified by running the SHIPPED parser** (`findHeader` + `parseGrid` + `normalizeStatus` + the
discipline/phase helpers, extracted from `module.js`, never reimplemented) over both files: every
per-field count matches the new file's drawing-row count **exactly** (Status 208=208, planned approval
71=71, actual approval 78=78, rev0 actual 204=204, rev1 actual 50=50, remarks 355=355; rev0 planned 225
= 223 BL0 + the 2 rows that have a BL1 and no BL0), 0 unknown statuses, 0 blank discipline/phase/code,
and the structure identical to the previous delivery. **GPR101 regression-checked through the same
harness, old parser vs new: byte-identical on all 1,372 records except the 3 `w/ Comments` drawings that
the status fix correctly reclassifies.** `node --check` on `module.js`, CSS braces balanced (329/329).
⚠️ **Not verified signed-in** — the user clicks **Clear all → Import** on BAU101.

## "The import did not recognize the ISD and Temp Works Dwg L1s" (2026-08-04) — fmlozano
**Root cause: the raw source workbook was imported, not the prepared file — and the importer picked the
wrong sheet.** Reproduced with the shipped `parseWorkbook`/`parseGrid` over the real workbook:
- ⚠️ **Sheet selection was "most RECORDS wins", and the winner had ZERO drawings.** BAU101's stale
  templated sheet **"Dwg Register (Vert)1" parses to 950 records of which 0 are drawings** (all group
  rows), so it beat the live sheet's 371 drawings. An import from the raw workbook therefore produced
  no drawings and no top-level rows at all. Now ranked by **drawing count** (ties on records), which
  drops both `(Vert)` sheets to the bottom.
- ⚠️ **Ranking alone still can't identify the *live* sheet** — the workbook holds six registry-ish
  sheets and the highest drawing count is `Dwg Registry (August 2024)` (460), the **superseded**
  snapshot, not `Dwg Registry (Based on FCD)` (371). So the import modal now shows a **sheet dropdown**
  ("<name> — N drawings"), and the preview lists the **L1 drawing types it detected** plus a sample, so
  a wrong sheet is visible *before* writing. Import stays disabled when a sheet yields 0 drawings.
- **Raw parsing of ANY sheet in that workbook yields only `For Construction Drawings (FCD)` as L1** —
  measured. That is precisely the reported symptom: TWG and ISD are invisible.

⚠️ **ATTEMPTED AND REVERTED — recognising TWG/ISD from a raw sheet (second failed attempt, new route).**
Widening `PHASE_RE` by text was tried and reverted on 2026-08-04. This time I inferred the phase level
from the **indent column** (learn it from the PHASE_RE hit, then accept later titles in that same
column) — text-independent, and it *did* give BAU101 all three raw L1s. It was reverted anyway because
it reproduced the identical damage on GPR101: **blank-discipline drawings 1 → 25, categories 245 → 243.**
The reason is structural and admits no heuristic: **BAU101's TWG/ISD blocks contain discipline headers;
GPR101's contain drawings directly**, so promoting them there resets `cur.discipline` and strands the
drawings underneath. Both registers use the same words at different depths. ⇒ The explicit **"Row
Level"** column stays the answer (per-file, cannot regress another register) — and the prepared BAU101
file uses it, yielding all five L1s.
- **`cleanPhase` keeps template acronyms upper-case** (FCD/TWG/TWD/ISD/DED/BIM/CBW/SD/AB) — a raw
  import used to read "Temporary Works Dwg (Twg)". Display-only; GPR101's six phase names unchanged.

**Verified with the shipped parser:** prepared file → 5 L1s (Concept, Schematic, For Construction 88,
Temporary Works 20, Individual Services 316), 424 drawings, 0 blank phase/discipline/code. **GPR101
byte-identical to the pre-change parser** on all 1,372 records — 6 phases, 245 categories, 1 blank
discipline, 894 planned approvals — except the 3 `w/ Comments` rows the status fix reclassifies.
Sheet ranking re-checked on both workbooks: the 0-drawing sheets no longer win. `node --check` clean.
⚠️ Not verified signed-in.
