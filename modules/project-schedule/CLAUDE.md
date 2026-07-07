# Module: project-schedule

> **Claude / developer: read this first.**
> 1. Read `../../MODULE_CONTRACT.md` and `../../CONTRIBUTING.md` (NOT auto-loaded).
> 2. This module is **Project Schedule & Cost Loading** (Phase 2). Your DB table is `project_schedule`
>    (defined in `../../supabase-schema.sql`; starter columns only — extend as needed).
> 3. Best reference to copy: **risk-register (plain CRUD; add a Gantt/cost-loading table as needed)**.
> 4. Work only inside this folder, on branch `module/project-schedule`, then PR to `main`.
> 5. Update this file as you build.

## Status
- [x] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [x] Built from scratch (Primavera Cloud reference, not a module copy)
- [x] CRUD implemented (add / edit / view / list / delete)
- [x] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [x] `Fmt.esc()` on all user text injected into HTML
- [x] `enabled: true` set in `assets/js/config.js`
- [ ] Run DB migration (see below)
- [ ] PR opened into `main`

## Schema additions (2026-06-30)

Run `../../migrations/2026-06-30-project-schedule-columns.sql` in the Supabase
SQL editor before testing. Adds:

| Column | Type | Default |
|---|---|---|
| `actual_start` | date | — |
| `actual_finish` | date | — |
| `activity_type` | text | `'Task'` |
| `status` | text | `'Not Started'` |
| `responsible_party` | text | — |

## Schema additions (2026-07-01) — OPC Activity Details fields
Run `../../migrations/2026-07-01-project-schedule-opc-fields.sql`. Adds:
`owner, work_package, calendar, duration_type, percent_complete_type,
program_milestone(bool), expected_finish, actual_duration, remaining_duration,
free_float, planned_labor_units, actual_labor_units, remaining_labor_units,
primary_constraint, primary_constraint_date, secondary_constraint,
secondary_constraint_date`. All editable in the Add/Edit modal and shown in the
General/Status detail tabs (At-Completion Duration/Labor are computed).

## Schema additions (2026-07-02) — Baseline cost
Run `../../migrations/2026-07-02-baseline-cost-column.sql`. Adds `bl_cost` (baseline
planned cost, matches OPC's "BL Planned IBB"), seeded from the current Planned Cost.
Editable in the modal; shown in the Cost Loading table.

## Import (2026-07-06) — P6 .xer support
The Import button ("Import Excel/XER (OPC / P6)") now also accepts Oracle Primavera P6
`.xer` exports (auto-detected by extension, read as Windows-1252 text). `parseXER` tokenizes
the `%T`/`%F`/`%R` tab-delimited tables and imports:
- **CALENDAR** → the new `calendars` table (a hand-rolled recursive-descent parser reads P6's
  proprietary `clndr_data` grammar for the Mon–Sun working-day pattern + non-working
  Exceptions/holidays; exceptions that carry a shift-time override are treated as special
  working days, not holidays, and skipped).
- **PROJWBS** → WBS rows, using the *real* `parent_wbs_id` tree (not an outline-level guess
  like the Excel path) to generate dotted codes.
- **TASK** → activities (task_type TT_Mile/TT_FinMile → Milestone), linked to their imported
  calendar via `calendar_id`.
- **TASKPRED** → resolved into the same `predecessors` text format the CPM engine already
  parses (`predRels`) — `"<code> <FS|SS|FF|SF>+<lagDays>"`, lag hours rounded to whole days.
- **RSRC** / **TASKRSRC** → `resources` + `resource_assignments` (added alongside anything
  already in Resource & Role Master, not replacing it).
Verified against a real 26MB/97,906-line cost-loaded P6 export (~600ms parse): exact row-count
matches (14,495 WBS + 27,811 activities, 2 calendars, 2 resources, 27,744 assignments), 100%
predecessor resolution (27,796/27,796), 0 activities missing dates, correct milestone typing,
and a spot-checked activity's dates/calendar/predecessor all matched the source file exactly.
(Not yet run end-to-end against a live Supabase project — the parsing/mapping logic is
verified, but nobody has clicked Import on a real login yet.)

## Planner Cockpit (2026-07-07) — batch 1 of the planner roadmap
New third view (`#ps-view-planner`, sidebar `data-view="planner"` + title menu `data-tab="planner"`,
`activeTab==='planner'`). `renderPlanner()` (called from `switchTab`/`renderAll`) is a read-only
weekly cockpit built entirely from existing columns (no schema change): KPI row (overall % complete,
activities behind baseline, milestones at risk, critical count, due-in-3-weeks, data date) + four
lists — **Milestones at risk** & **Most behind schedule** (via `finVar` = forecast finish − baseline
finish, days late), **3-week lookahead** (incomplete activities whose start/finish falls in
[data date, +21d]), **Critical-path drivers** (`_critical` from `computeCPM`). Rows click → jump to
the Schedule view with the activity selected. CSS `.ps-ck-*`.

## Planner batch 6 (2026-07-07) — Cockpit charts (replace list rows) + Schedule-only toolbar hidden
User feedback: the four cockpit panels were "just scrollable tables," not useful for reporting/
tracking; also the Schedule grid's toolbar (Actions/Add activity/Group/Zoom/Expand/Views/Schedule/
Layout/Columns/Colors/Critical path/Link/Search) showed on the Planner and Cost Loading tabs where
none of it applies.
- **Milestones at risk / Most behind schedule are now ranked bar charts, not plain rows**: each row
  (`barRow()` in `renderPlanner()`) got a horizontal bar (`.ps-ck-bartrack`/`.ps-ck-barfill`) whose
  width is the item's slip days relative to the worst item in that same list (so the worst offender
  reads as a full bar, not just a bigger number), colored by severity tier (`sev-1/2/3`: ≤7d / 8–21d
  / >21d, via opacity on `var(--pd-red)`). Same click-to-jump-to-Schedule behavior as before (still
  `.ps-ck-row`).
- **New "Progress Trend" chart** (`#ps-ck-trend`, above the 2×2 grid): an SVG line chart
  (`_ckTrendSVG`) plotting `pct_complete` across the project's saved **Schedule Snapshots**
  (`schedule_snapshots` — the same table "Take snapshot" already writes to), so a planner can see
  week-over-week whether the project is catching up or slipping instead of re-reading one static
  KPI. Lazy-loaded per project (`_ckLoadTrend`/`_ckTrend` cache, invalidated when a project switches
  or a new snapshot is taken) so opening the cockpit isn't blocked on a network round-trip. Needs
  ≥2 snapshots to draw a line; otherwise shows an empty-state nudging the user toward "Take
  snapshot." Tolerant of a missing table (shows a migration hint, same pattern as the rest of the
  cockpit).
- **Critical-path drivers gained a float-bucket summary strip** (`_ckFloatBuckets`, `#ps-ck-buckets`,
  above the existing driver list): a segmented bar + legend counting incomplete activities into
  Critical (0d) / 1–5d / 6–15d / >15d float, so the panel reads as "how much slack is left in the
  schedule" before drilling into names.
- **3-week lookahead is unchanged** (stays a plain list) — it's an action checklist for the coming
  weeks, not a trend or ranking, so a chart wouldn't add anything.
- **Schedule-only toolbar now hidden outside the Schedule tab**: `switchTab()` toggles
  `.ps-toolbar` display — visible only when `tab==='schedule'`, hidden on Planner Cockpit AND Cost
  Loading (matches how `#ps-view-schedule`/`#ps-view-cost`/`#ps-view-planner` are already toggled).
- Verified with a throwaway gitignored harness (`_ui_test.html`, matches the `**/_ui_test.html`
  gitignore pattern from Prompt 53) rendering the real CSS + the new functions against synthetic
  data, screenshotted, then deleted: bar widths/severity shading scale correctly against each
  list's own max, LD tags still render, the float-bucket counts matched a hand-count (2 critical /
  1 each in the other three buckets from a 7-task fixture), and the trend SVG drew a 6-point line
  with correct gridlines/date labels/end-value callout.

## Planner batch 5 (2026-07-07) — Change history (audit trail)
**Migration:** `../../migrations/2026-07-07-schedule-audit.sql` (`schedule_audit`, insert-only for
planners, read for approved). `logAudit(r, action, changes)` is **fire-and-forget + tolerant** (a
missing table never breaks a save). Hooked into `persist()` (inline/grid/drag/link/tracker edits —
`_auditChanges(prev, patch)` diff), modal `save()` insert, `saveBulkUpdate()` (per row), and
`applyScheduleDates()` (one `reschedule` event with a count). Cockpit **Change history**
(`openAudit`, `#ps-audit-back`) lists the last 400 changes (When / Who [resolved via
`PDb.getAllUsers`] / Activity / field from→to), `_auditSummary` formats dates.

## Planner batch 4 (2026-07-07) — Schedule snapshots (milestones + summary)
**Migration:** `../../migrations/2026-07-07-schedule-snapshots.sql` (`schedule_snapshots` table +
RLS via `is_approved()`/`is_planner()`). Cockpit **Take snapshot** (`takeSnapshot`) captures a
summary (avg % / activities total+behind / milestones total+at-risk / project finish) plus every
milestone's forecast/baseline/contract date as `milestones` jsonb — one row per snapshot (scales to
27k activities). **Snapshots** (`openSnapshots`, `#ps-snap-back`) lists them; selecting one shows a
**milestone drift** table (Then forecast vs Now forecast, +Nd drift). `deleteSnapshot` removes one.
Fully tolerant — missing table just shows a "run the migration" note, never breaks the cockpit.

## Planner batch 3 (2026-07-07) — Contract date + LD tracker
**Migration:** `../../migrations/2026-07-07-schedule-contract-date.sql` (adds
`project_schedule.contract_date date`). A **Contract Date** field is in the Add/Edit modal
(`#ps-f-contract`, next to Baseline Finish). To avoid breaking saves on a not-yet-migrated DB,
`contract_date` is written **separately + tolerantly** after the main save (a missing-column error
is swallowed) — it is NOT in the main payload. `contractVar(r)` = forecast finish − contract date
(+ = LD exposure). Cockpit adds a **"Contract dates at risk"** KPI and an **"LD +Nd"** tag on the
Milestones-at-risk / Most-behind rows when the forecast passes the contract date.

## Planner batch 2 (2026-07-07) — bulk progress update + lookahead export
Both schema-free, driven from the cockpit action bar (`.ps-ck-bar`).
- **Bulk "Update Progress" grid** (`#ps-bulk-back` overlay): `openBulkUpdate()` → `renderBulkBody()`
  lists incomplete activities filtered by `#ps-bulk-scope` (Due 2/3/6 wks / In progress / All
  incomplete) + a text filter, each row with inline Status / % Complete / Actual start / Actual
  finish inputs. Edits accumulate in `_bulkEdits{id:{field:val}}` (row goes `.dirty`);
  `saveBulkUpdate()` writes changed rows in chunks of 40 via direct `update().eq('id')`, updates
  local `rows`, `rebuild()/computeCPM()/renderAll()`. Overdue target-finish flagged red.
- **Lookahead window + export**: `_ckLookWeeks` (2/3/4/6, `#ps-ck-weeks`) drives BOTH the cockpit
  "N-week lookahead" panel (`_ckLookSet()`) and `exportLookahead()` (XLSX handout: ID/Activity/
  Status/Start/Finish/%/Critical/Float/Responsible for the window).

## Topbar + project browser (2026-07-07)
- **Topbar tools spacing**: the global tool cluster (`#ps-topbar-tools`: undo/redo/health/reports/
  filter/refresh/print) now uses uniform 34×34 buttons, `gap:4px`, a left divider, and a divider
  before `#user-bar`; the theme toggle (`#pd-theme-toggle`, injected by theme.js before `#user-bar`)
  is sized to match. Removed the conflicting `width:36px` vs `padding:0 9px` rules.
- **OPC-style project browser (folder navigator — scales to 100+ schedules)**: the flat project
  `<select>` is hidden (kept as source of truth for `projName()` / load) behind `#ps-projsel-btn`,
  which opens `#ps-projsel-menu`. `renderProjectSelector()` shows **one folder level at a time**
  (state `_pssPath` = current workspace id, `''` = root): sub-folders (workspace/program/group nodes
  from the `workspaces` tree, with a node-type badge + a **descendant project count**) then the
  projects directly under the folder. A **breadcrumb** (`.ps-pss-crumb`, `_pssCrumbs`) walks back up;
  clicking a folder drills in. A **search box** (`_pssSearch`) flattens to matching projects across
  the whole tree (breadcrumb hidden while searching). Opening the menu sets `_pssPath` to the current
  project's `workspace_id` so it lands in context. Picking a project → `selectProject(id)` (syncs the
  hidden select + labels, reloads). `folder` icon added to icons.js. `.ps-projctx` is
  `position:relative` (NOT `.ps-menu-wrap`, which forces inline-block and breaks the name/workspace
  column). Module `?v=` → 20260708.

## Gantt timeline scale (2026-07-07) — adjustable period-column width
The Gantt timescale width is `dayw = DAYW[zoom] * ganttScale`. `DAYW` sets the base px/day per
Month/Quarter/Year; **`ganttScale`** (persisted `localStorage.ps_ganttscale`, clamped 0.35–6) lets
the user widen/narrow the period columns. Two gestures adjust it (the +/− buttons were removed):
- **Excel-style drag**: each date-header cell (`.ps-yr`/`.ps-mo`) carries a right-edge grip
  (`.ps-ts-grip`, `data-days` = its day span). `startTsResize(e, days)` rescales uniformly —
  `newDayw = startDayw + dragDx/days` → `ganttScale = newDayw / DAYW[zoom]` — re-rendering per rAF,
  saving on mouseup.
- **Ctrl + mouse-wheel** over `#ps-gantt-scroll`: `applyGanttScale(ganttScale × 1.15^±1)`, keeping
  the date under the cursor fixed (capture content-x ratio before, restore `scrollLeft` after a
  double-rAF since `renderGantt→scheduleRender` batches `doRender` one frame later).
`applyGanttScale(v)` / `_saveGanttScale()` are module-scope. (This is the Gantt month/qtr/year
column width — NOT the activity-grid columns.)

## Columns (2026-07-07) — eye-icon show/hide, resize everywhere, export toggle
- **Eye-icon multi-select chooser**: the toolbar column button is now an **eye** icon
  (`icons.js` gained `eye`/`eyeOff`). `renderColsMenu()` shows a checkbox per column (ticked =
  visible) with a per-row eye glyph + **Show all / Hide all / Reset** footer. It is
  **context-aware**: on the Schedule tab it lists `GRID_COLS`; on the Cost Loading tab it lists
  `COST_COLS` (driven by `activeTab`, set in `switchTab`). Hidden state persists in
  `localStorage.ps_colhidden` (keyed by label; `saveColHidden()`).
- **Cost Loading table is now dynamic** (was static HTML). `COST_COLS` defines label / num /
  locked / default width / `cell(r)` / `tot(T)` renderers; `renderCost()` builds `<colgroup>` +
  `<thead>` (with `.ps-colgrip` handles) + `<tbody>`, **skipping hidden columns** and applying
  persisted widths (`localStorage.ps_costcols`, `startCostColResize`). Table is `table-layout:fixed`;
  the totals row now emits one cell per visible column (no colspan) so hide/resize line up.
- **Gantt-only layout keeps the columns**: `.ps-split.ps-gantt-only .ps-grid-pane` no longer
  `display:none` — it stays as a compact (300px default) **resizable + hideable** activity-column
  table beside the bars (Primavera-style). Drag the divider / hide columns for a leaner view.
- **Export honors hidden columns**: `exportExcel(includeHidden)` filters out headers whose grid
  column is hidden (`EXP_TO_GRID`/`expHeaderHidden`); % and ₱ number formats + column widths are
  resolved by header NAME (so positions stay correct when columns are dropped). `downloadSchedule()`
  (wired to `#ps-download`) prompts "Include hidden columns?" only when an exportable column is
  hidden, else exports directly.
- Module page `?v=` bumped to **20260707** (icons.js changed — shared asset, cache-busted).

## Scheduling (2026-07-06) — Reschedule dependent activities (relationship-driven dates)
The CPM forward pass (`cpmLogic`) computes each activity's early start/finish (`_es`/`_ef`,
day offsets from `_cpmBase`) honoring FS/SS/FF/SF + lag, actual dates, the data date, and
Retained-Logic/Progress-Override — but historically only used them for critical-path highlight.
`applyScheduleDates()` now WRITES those back so a successor's Start/Finish moves when a
predecessor's (actual or planned) dates change. Rules: completed activities (actual finish) keep
their dates; started-but-unfinished keep their Start (actual-pinned) and only Finish moves;
milestones snap to `_es`. `_ef` is start+duration (one past the inclusive last day) so finish =
`off(_ef - 1)`. Bulk-writes in chunks of 40 via direct `update().eq('id')`, updates local rows,
then `rebuild()/computeCPM()/renderAll()`; confirms first and is not per-step undoable
(`resetUndo()`). Wired into the **Schedule** dialog: a **"Reschedule dependent activities"**
checkbox (`#ps-dd-resched`, persisted `localStorage.ps_resched`, state `reschedOn`); `scheduleNow()`
runs `computeCPM()` then, if checked and `mode==='logic'`, calls `applyScheduleDates()`. Without
relationships it warns instead (nothing to drive the moves). This is P6-F9-style manual reschedule
(explicit, not automatic on every edit) to avoid silently rewriting dates.

## Import (2026-07-06) — Predecessors + Successors columns (Excel/OPC)
`parseWorkbook` now detects BOTH the **Predecessors** (`cPred`) and **Successors**
(`cSucc`) columns of an OPC/Primavera Cloud `.xlsx` export. Relationships are stored
as `predecessors` text only (single source of truth); the CPM engine derives successors
as the inverse. To make the imported graph complete regardless of which column an edge
lives in, `mergeSuccessors()` (end of `parseWorkbook`) folds each row's Successors into
the target activity's predecessors — a successor edge `A→B` is identical to `B` listing
`A` as a predecessor. Merge is de-duplicated by Activity ID (`predIds`), so symmetric
exports add 0 duplicates. Verified on the Avesta 4PH file (4,578 activities): both
columns fully symmetric → 6,841 edges, 0 extra. No schema change (uses existing
`predecessors` column). OPC exports here use plain comma-separated IDs (no FS/lag);
`predRels` defaults those to `FS+0`.

## Schema additions (2026-07-06) — Working calendars
Run `../../migrations/2026-07-06-working-calendars.sql` (adds `project_schedule.calendar_id`
+ the new `calendars` table, owned by resource-loading). The Activity modal's
Calendar field is now a dropdown into `calendars` instead of free text. The
FTE/Max-Availability histogram (`resCapacity`, Resource Usage tab) was rewritten
to use each resource's *actual assigned calendar* (working-day pattern + hours/day,
via the shared `assets/js/calendar.js` `PDCal` helper — 6-day/8h Philippine
Standard by default, PH regular holidays computed automatically) instead of a
hardcoded 5-day Mon–Fri week. See `modules/resource-loading/CLAUDE.md` for the
calendar CRUD UI.

## Module design

**Three-tab layout (Primavera Cloud reference):**

- **Schedule tab** — WBS, Activity ID, Activity Name, Type, Status, Planned Start/Finish,
  Actual Start/Finish, Duration, % Complete (progress bar), Responsible Party, Edit/Delete
- **Gantt tab** — Oracle Primavera-style: frozen Activities column (Activity ID + name,
  WBS-indented) on the left + time-scaled bar chart on the right. Planned bars with a
  progress fill (% complete), green Actual bars (actual_start→actual_finish||today),
  milestone diamonds, WBS-summary brackets, month/year timescale, **Week/Month/Quarter
  zoom**, month gridlines, and a red **Data date** (today) line. Pure HTML/CSS — no libs.
  Respects the same Status/Type/Search filters. `renderGantt()` in the IIFE; `pdate/dDiff/iso`
  date helpers; `ganttZoom` + `PX_PER_DAY` control scale.
  - **Baseline (BL0) bar** (`.ps-bl`): drawn under each activity bar from `bl_start`/`bl_finish`.
    Restyled 2026-07-06 for visibility — was a 5px hollow light-gray (`#9a9a9a`) outline that was
    effectively invisible; now an **8px solid blue bar** (`--ps-bl` `#2F6FB0` light / `#5AA0E6` dark)
    with a subtle border + shadow. Legend swatch (`.lg-bl`) and the Gantt color-picker default
    (`COLORDEFS` `bl` = `#2F6FB0`) updated to match. Blue was chosen to stay clear of the red
    progress fill / amber critical-path outline.
  - **Relationship (FS/SS/FF/SF) lines**: drawn in `renderWindow()` as an absolutely-positioned
    SVG overlay (`.ps-deps`, arrow marker `#ps-arrow`) from each visible task's `_relObjs`. Anchored
    on the correct bar edges per type (SS/SF leave the start edge, FF/SF arrive at the finish edge),
    with an origin dot + a type/lag label (non-FS). Only edges whose BOTH endpoints are in the
    rendered window draw (same as critical-path lines). **Toggle:** the toolbar **`#ps-deps`** button
    (arrow icon, next to Critical Path) controls visibility via `depsOn` (persisted in
    `localStorage.ps_deps`, **default ON**). The draw block runs when `critMode || depsOn`, so
    imported dependencies now show WITHOUT turning on Critical Path (previously they were gated behind
    `critMode` only — the reason imported FS/SS/FF/SF links didn't appear on the Gantt).
- **Cost Loading tab** — WBS, Activity Name, Planned Cost, Actual Cost, Earned Value,
  Cost Variance, CPI, % Complete — with TOTALS row

**KPI cards:** Overall % Complete, Completed count, In Progress count,
Planned Cost / Actual Cost, CPI (green/red), SPI (green/red)

**Filters:** Status, Activity Type, text search across WBS / ID / Name / Responsible Party

**Modal fields:** WBS Code, Activity ID, Activity Name, Activity Type, Status,
Planned Start, Planned Finish, Actual Start, Actual Finish, % Complete,
Responsible Party, Planned Cost, Actual Cost, Earned Value, Predecessors, Remarks

**Predecessors activity picker (2026-07-06):** below the free-text `#ps-f-pred` field, a picker
row (`#ps-pred-search` datalist of `ID — Name` for all leaf activities, `#ps-pred-type` FS/SS/FF/SF,
`#ps-pred-lag` days, `#ps-pred-add`) lets the user **select an activity from the schedule** instead
of typing the Activity ID. `setupPredPicker(row)` (called from `openForm`) rebuilds the datalist
(excludes the current activity + WBS summaries, sorted numeric by ID), and Add appends a
`predRels`-parseable token (`ID [type][±lag]`, FS omitted unless a lag is set) to `#ps-f-pred`,
de-duplicated by ID (via `predIds`), rejecting self-links and unknown IDs. The text field is kept
as the source of truth (typing + CSV/XER import unchanged); the picker only appends to it.
