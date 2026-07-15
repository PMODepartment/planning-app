# Module: project-schedule

> **Claude / developer: read this first.**
> 1. Read `../../MODULE_CONTRACT.md` and `../../CONTRIBUTING.md` (NOT auto-loaded).
> 2. This module is **Project Schedule & Cost Loading** (Phase 2). Your DB table is `project_schedule`
>    (defined in `../../supabase-schema.sql`; starter columns only — extend as needed).
> 3. Best reference to copy: **risk-register (plain CRUD; add a Gantt/cost-loading table as needed)**.
> 4. Work only inside this folder, on branch `module/project-schedule`, then PR to `main`.
> 5. Update this file as you build.

## Progress intelligence — POC-driven remaining/finish + retained-logic data-date shift (2026-07-14) — jasantos2 / eprobles
Two scheduling-logic features, both toggle-gated in the **Schedule dialog → Settings** (default ON).
- **Progress-driven dates (`progressDriven`).** Editing **% Complete (Earned Value POC)** — in the
  grid cell or the Status/General detail tab — now runs `_progressFields(r,pct)`: keeps
  `duration_days` as the original/planned duration and derives **remaining_duration =
  round(origDur × (1 − POC))**, actual_duration, status, actual_start, and an auto **finish =
  data date + remaining − 1** (remaining work scheduled from the data date). 100% → Completed,
  finish = data date, remaining 0; 0% → Not Started, remaining = full duration (dates untouched).
  All fields persist together through `persist()` (undoable + audited; `end_date`/`percent_complete`
  are in `_RECOMPUTE_FIELDS` so CPM/rollups refresh). Unit-checked: 40%→6d rem & finish +5;
  100%→finish at data date; shift keeps span.
- **Retain un-started work at the data date (`ddRetainOn`).** New `shiftUnstartedToDataDate()`:
  on **Schedule → Schedule Now**, any activity with 0% POC / no actual start whose planned start is
  **before** the data date is moved forward to start on the data date, **keeping its duration**
  (finish moves by the same delta). Runs for all tasks regardless of relationships (chunked bulk
  write, audited), *before* the CPM recompute + the existing relationship reschedule, so linked and
  unlinked schedules both self-adjust when the data date advances. (This complements the CPM's
  existing data-date flooring for linked activities.)
- **Verified:** full inline script parses; `_progressFields` + shift math hand-checked in-browser.
  Live click-through pending a session. (Note: with progress-driven ON, % edits move finish dates —
  a real scheduling action; the toggle lets teams that hand-manage dates turn it off.)

## Baseline bars above current + baseline roll-up + equal/full bar heights (2026-07-14) — jasantos2 / eprobles
- **Baseline (BL0) bar now drawn ABOVE the current schedule bar** (was below at +24). Activity bar
  geometry reworked: **with a baseline present**, planned + current are two **equal-height** bars
  (~11px each, density-scaled) stacked baseline-over-current; **without a baseline**, the current bar
  fills nearly the whole row height (`ROWH − 8`). Heights set inline (overriding the fixed
  `.ps-bl`/`.ps-bar` CSS heights). Bar label vertically centered on the current bar.
- **WBS summaries now roll up baseline dates.** New `_blSpanMap` (built in `rebuild()` from
  bl_start/bl_finish up the WBS tree, same walk as `_spanMap`) + `wbsBlSpan()`; the summary branch
  draws a rolled-up baseline bar above the summary bar (WBS grouping; keyed by dotted code). Summary
  bar shifts down to sit below it when a baseline roll-up is present.
- Milestones unchanged (point marker). Note: dep-line anchor Y left as-is (approximate elbow) — bars
  moving down a few px in baseline mode is cosmetically fine.

## Detail-form layout fix + import baseline (2026-07-14) — jasantos2 / eprobles
- **Fixed the cramped/overlapping Status (and General) editable detail form.** The forms wrapped
  their groups in `.ps-det-groups` (auto-fit `minmax(250px,1fr)`) while *each group* also had an
  inner 2-col field grid — at 250px the date inputs overlapped. New **`.ps-edit-groups`** wrapper
  (auto-fit `minmax(360px,1fr)`) gives each group room for its 2-col fields; the "Editing…" hint
  spans full width (`grid-column:1/-1`). detGeneralEdit + detStatusEdit now use it.
- **Import baseline (Excel).** The "set baseline from current schedule" flow already exists
  (Actions ▸ Baselines… ▸ **Capture current as baseline**). Added the requested **alternative**:
  a **Import baseline (Excel)…** button + file input in the Baselines modal → reuses the schedule
  importer's `parseWorkbook`, then `importBaselineFile()` stores the parsed start/finish/dur/
  planned-cost as a `schedule_baselines` snapshot **keyed by Activity ID, without touching the live
  schedule**. Set it primary to apply it to BL0/variance. (XLSX only for now; `.xer` baseline import
  can follow — the main importer's XER path is a different shape.)

## Theme-aware line colors, dark-mode WBS/activity contrast, full-row selection (2026-07-14) — jasantos2 / eprobles
- **Relationship lines + data-date line are now theme-aware** and editable. New CSS vars
  `--ps-dep` (relationship lines/dots/label/arrowhead) and `--ps-dd` (data-date line + label +
  legend swatch) on `#ps-view-schedule`: default **black in light mode, white in dark**. Both were
  hard-red before. Added **Relationship lines** + **Data date line** color pickers to the Colors
  menu (COLORDEFS `dep`/`dd`); a user override applies in both themes (inline var beats the
  theme default), Reset reverts to the black/white default.
- **Dark-mode WBS/sub-WBS shading brightened + stepped** (`--wl` per level was #3a…#21, nearly
  invisible on the #1C bg) → #56…#2a, clearly distinct per depth; added a left-accent bar to WBS
  levels 3–5 in dark (was only 0–2) so sub-WBS depth reads. Activity zebra stripe strengthened in
  dark (`.ps-alt` .03→.06) so activity rows separate.
- **Full-row selection highlight across both panes.** Clicking a WBS or activity now tints the
  **entire grid row** (`.ps-row-sel` full-width bg + red left inset) and draws a matching
  **`.ps-gantt-selband`** spanning that row across the Gantt (behind the bars). Emitted in
  `ganttRowHTML` for full renders and managed imperatively in `highlightRow` so a plain click (no
  Gantt re-render) still shows it; `highlightRow` also now matches WBS rows via `data-wbsid`.

## Arrow routing v2 (gap-routed) + Month default zoom (2026-07-14) — jasantos2 / eprobles
- **Dependency connector no longer runs its horizontal over a bar.** Previous routing kept a single
  vertical just outside the destination and ran the horizontal along the *source row* (a.y) — for
  adjacent FS bars that meant a visible back-track over the predecessor's tail. New **Z-route**: leave
  the source edge with a short stub (`S=9` outside the anchor), drop to the **midpoint Y between the
  two rows**, run the horizontal there (in the inter-row gap, no bars), drop to the destination row,
  then a short stub into its anchor edge. Only the two short end-stubs touch bar rows; the long run is
  always in the gap. Source stub direction follows the anchor (start-anchored SS/SF step left,
  finish-anchored FS/FF step right); destination vertical sits just outside its start (FS/SS) or finish
  (FF/SF). Label/dot repositioned to the new geometry.
- **Default timeline zoom is now Month** (was Quarter): `var zoom='month'` + the `.active` class moved
  to the Month segment button. Users can still switch to Quarter/Year (and saved layouts restore their
  own zoom).

## Colors menu was inaccessible — restored (2026-07-14) — jasantos2 / eprobles
- Tester asked "where is the Colors menu". Root cause: the `.ps-gantt-tools` CSS and
  `renderColorsMenu()` existed, but the **palette button + `#ps-colors-menu` element were missing
  from the Gantt-pane markup** (dropped at some point), so `renderColorsMenu` returned early and there
  was no way to open it. This means the earlier "bar colors already exist" note (below) was wrong —
  the feature was orphaned. **Fix:** added the `.ps-gantt-tools` palette button + `#ps-colors-menu`
  back into `.ps-gantt-pane` (top-right floating gear), declared `colorsMenu`, added it to
  `closeMenus()` + stop-propagation, and wired `#ps-colorsbtn` to `renderColorsMenu()` + toggle
  (same pattern as the other menus). The menu contents (Task bar / Progress fill / Summary / Baseline
  / Milestone pickers + per-WBS overrides + Reset) were already implemented — now reachable again.
  So item #2 (differentiate + modify WBS vs activity bar colors) is genuinely delivered.

## Gantt/print/filter batch (2026-07-14) — jasantos2 / eprobles
From a multi-item tester list; implemented the genuine gaps (several items were already built — see
"already existed" note at the end).
- **WBS bar progress fill (#1).** Summary bars now show a duration-weighted rolled-up %-complete fill
  (`_costMap[code].wearn/wd`) as a `.ps-sum-fill` child clipped to the bracket shape, plus the % on
  the bar label and title. Group headers (non-WBS grouping) don't get a fill.
- **Succeeding months (#3).** `range()` now pads the timeline: ~2 extra trailing months after the last
  activity (`addDays(_max, 62)`) + 14-day lead, so the Gantt shows context beyond the activity span.
- **Critical-path-only filter (#5b).** New **Filter → Schedule → "Critical path only"** (`filters.crit`);
  `rowMatches` excludes non-critical activities (WBS rows pass so ancestors are kept). This *excludes*
  the others, unlike the Critical Path toolbar toggle which only dims them.
- **Project title on print (#4).** The Print button injects a `#ps-print-head` banner (project name +
  data date + print date) shown only in `@media print`, at the top of the printed schedule.
- **Already existed (confirmed, no change needed):** progress override (#6 — Schedule dialog Settings:
  Retained Logic / Progress Override); differentiated + editable WBS vs activity bar colors (#2 — the
  Colors menu sets Task bar / Summary / Milestone separately); constraints + actual-date/data-date
  logic (#8 — primary/secondary constraints, constraint-aware CPM, use-actual-dates); a P6-style
  Advanced filter builder (#5a — `filters.adv`, Match All/Any rules).
- **Deferred / needs scoping:** #5a "time-based" filter condition (the Advanced builder exists — needs
  a date/duration operator added); #7 extra complete/activity types (Start Milestone, Finish Milestone,
  Resource Dependent) — needs decisions on how each renders/behaves (milestone side + duration-type).

## Quick-add default dates (2026-07-14) — jasantos2 / eprobles
- **New activities now default to start on the data date with a 5-day duration.** `quickAddActivity`
  stamps `start_date = today()` (the data date, `dataDate || wallToday()`), `end_date = today()+4`
  (5 inclusive days), and `duration_days = 5` on the insert payload (was blank/no dates). So a
  freshly-added activity shows a real bar on the Gantt immediately and can be nudged from there.

## Visible Schedule button + dependency-arrow routing fix (2026-07-14) — jasantos2 / eprobles
- **Schedule button is now a visible red primary button** (`pd-btn pd-btn-primary`, calculator icon +
  "Schedule" text) matching the "+ Add activity" button, instead of an icon-only `.ps-icobtn` whose
  label only showed in Labels mode. Same `#ps-schedbtn` id/handler (`openSchedule`).
- **Dependency arrows no longer run across the linked bar.** The elbow used to turn at
  `predecessorFinish + 8`, which for adjacent FS bars sat on top of the successor bar (per the
  tester's screenshot). Now the vertical turns just **outside the destination bar's anchor edge** —
  `toX − 10` (left of its start for FS/SS) or `toX + 10` (right of its finish for FF/SF) — so the
  connector leaves the source edge, runs along the source row to the turn, drops to the successor
  row, and enters with a short 10px stub, never crossing the linked bar. Origin dot + type/lag label
  repositioned to the new turn X.

## Wrapping column headers (2026-07-14) — jasantos2 / eprobles
- **Grid column headers now wrap** instead of truncating with an ellipsis, so long labels stay
  readable when a column is narrow / being resized. Header cells (`.ps-grid-row.head .ps-cell`) get
  `white-space:normal; overflow-wrap/word-break:break-word; text-overflow:clip`; data cells keep
  `nowrap`/ellipsis (verified in-browser: header WS=`normal`, data WS=`nowrap`).
- **Header row grows to fit the wrapped lines** (`.ps-grid-row.head` → `min-height:38px; height:auto`)
  and a new **`syncHeadHeights()`** sets the Gantt header's height (border-box) equal to the grid
  header's measured height, so the first data row stays aligned across the two panes. Called from
  `renderHeader()`, the end of `doRender()`, and live during `startColResize` (mou…move + up). This
  also makes the two heads exactly equal by measurement (previously both relied on matching fixed CSS
  heights, incl. the `.ps-colf-on` 68px filter-row case, which the inline sync now supersedes).

## Column chooser scroll + Schedule reschedules by default (2026-07-14) — jasantos2 / eprobles
- **Column chooser (grid-header "+" / `#ps-cols-menu`) now scrolls.** Root cause: `.ps-menu`
  (line ~550) sets `overflow:hidden` and, being *later* in source than `.ps-cols-menu` (line ~158,
  `overflow:auto`) at equal specificity, won the cascade — so the menu clipped at its `max-height:340px`
  with no scrollbar (visible in the tester's screenshot, cut off at "Planned Value"). Added
  `.ps-cols-menu { overflow-y:auto }` *after* `.ps-menu` so the chooser scrolls again.
- **Schedule now reschedules dependent activities by default.** The CPM (`cpmLogic`) already honors
  **multiple predecessors** per activity (each successor's early start = **max** candidate across all
  its `_relObjs`, topological pass), and `applyScheduleDates()` writes those dates back — but it only
  ran when the Schedule dialog's "Reschedule dependent activities" box was ticked, which defaulted
  **off**. Changed `reschedOn` to default **on** (respects an explicit user off-setting), so hitting
  **Schedule → Schedule Now** moves successors' Start/Finish along their FS/SS/FF/SF + lag links
  (completed activities keep actuals; started ones keep their Start). Still confirms before the bulk
  write. No relationships → it warns instead of moving.

## WBS click-to-select, WBS-scoped Activity ID, scrollable menus (2026-07-14) — jasantos2 / eprobles
Follow-ups from tester feedback. No migration, no schema change.
- **Clicking a WBS row now SELECTS it** (instead of toggling collapse every time). Expand/collapse is
  now **only** via the ▼/► chevron. Real WBS summary rows carry `data-wbsid` + get `ps-row-sel`, and
  the `.ps-wbs-row` click handler selects the node (sets `selId`/`_wbsSel`, re-renders) so it becomes
  the Add-activity target; synthetic **group** headers keep click-to-collapse. Chevron clicks are
  guarded (`closest('[data-toggle]')`) so they never fall through to selection.
- **Activity ID is now WBS-scoped** as **`<wbs>-A<num>`**: `nextActivityId(wbs)` uses the prefix
  `"<wbs>-A"` and numbers in increments of 10 from **1000** (e.g. WBS 1.1 → `1.1-A1000`, then
  `1.1-A1010`, …), continuing from the highest number already used under that exact WBS prefix and
  skipping collisions. No WBS → plain `A<num>`. `quickAddActivity` passes the target `wbs`.
  (Unit-checked in-browser: fresh 1.1→`1.1-A1000`; with A1000/A1010→`1.1-A1020`; per-WBS isolated;
  no-WBS continues the `A` series.)
- **Popup menus scroll instead of clipping.** `.ps-menu` had `overflow:hidden` + no height cap, so a
  tall **row context menu** (Add activity / Edit / clipboard / WBS / Delete) ran off-screen with no
  scroll. Added `.ps-rowctx, .ps-colhdr-menu { max-height:82vh; overflow-y:auto }` and, in
  `openRowMenu`, an explicit `max-height = viewportHeight − top − 10px` so the menu always fits the
  space below its anchor and scrolls when taller.

## Auto Activity ID + editable Status & Relationships tabs (2026-07-14) — jasantos2 / eprobles
Follow-up to the interactive-Add work below. No migration, no schema change.
- **Auto-generated Activity ID on quick-add.** `quickAddActivity` now stamps `activity_id =
  nextActivityId()` instead of leaving it blank. `nextActivityId()` takes the max existing numeric
  Activity ID in the project, rounds **up to the next multiple of 10** (P6/OPC-style — `…1010`→`1020`,
  `1013`→`1020`), and keeps whatever prefix the highest ID uses (e.g. `A1020`→`A1030`). Starts at
  `1010` when the project has no numeric IDs; skips collisions. (Logic unit-checked in-browser:
  empty→1010, `A1010/A1020/A1005`→`A1030`, `A1013`→`A1020`, collision→next free.)
- **Editable Status tab.** `renderDetails` status branch now renders `detStatusEdit(r)` + the shared
  `wireEditFields` (same live-editor pattern as General): Status, % Complete, Expected Finish, all
  Planned/Actual/Baseline dates, Actual/Remaining Duration, Free Float, Planned/Actual/Remaining Labor
  Units, and Primary/Secondary Constraints (+dates) are editable and persist on change. Computed
  fields (Planned/At-Completion Duration, Total Float, Critical, Finish Variance) stay read-only via
  the new `_gro()` helper. Added a `num` field type (non-negative, unbounded) to `_gf`/`wireEditFields`
  for durations/labor units (the existing `number` type stays 0–100, used for % Complete).
- **Editable Relationships tab.** `detRelsEdit(r)` + `wireRels` replace the read-only tables:
  predecessors get a **× remove** per row and an **add row** (activity datalist + FS/SS/FF/SF type +
  lag), mirroring the modal's predecessor picker. Edits reserialize to the predecessor token text via
  `serializeRels()` (verified to match the CPM `predRels` format — `1010 SS+3`, `1010 FS-2`) and go
  through `persist()` (undoable + audited + CPM rebuild). **Successors stay read-only** (derived as the
  inverse of other activities' predecessors).
- Resource Assignments / Steps / Expenses / Notebook / Files were already editable (CRUD) — unchanged.
- **Verification:** full inline script parses clean (module page loads, zero console errors);
  `nextActivityId`/`serializeRels` logic unit-checked in-browser. **Live click-through still pending a
  real login** (needs an approved session + a project with data).

## Interactive Add-activity + editable General tab (2026-07-14) — jasantos2 / eprobles
Requested: make "Add activity" contextual — select a WBS or activity first, then Add places the new
activity under that respective WBS and lets you edit its details in the panel below (no migration,
no schema change).
- **Contextual Add.** The toolbar **Add activity** button (`#ps-add`) and the right-click **"Add
  activity below"** now call the new **`quickAddActivity(sel)`** instead of always opening the modal.
  Placement is uniform: `wbs = sel.wbs`, `wbs_node_id = sel.wbs_node_id` — a selected **WBS summary**
  gets a child activity under it; a selected **activity** gets a sibling in the same WBS. It inserts a
  blank `Task` ("New Activity", Not Started, 0%) via the same insert + `pushUndo({type:'insert'})` +
  `logAudit` path as the modal `save()`, appends to `rows` locally (no full `load()` refetch),
  `rebuild()`s, un-collapses the new row's WBS ancestry, selects it, and scrolls it into view
  (deferred one rAF since `DL` is rebuilt inside the render frame). `wbs_node_id` is written
  separately + tolerantly (column-missing safe), like `save()`. **No selection → falls back to the
  full modal** (with a hint toast), so the modal path is unchanged and still reachable.
- **Editable General detail tab.** `renderDetails()`'s General tab now renders **`detGeneralEdit(r)`**
  + `wireGeneral()` (the old read-only `detGeneral` is kept, now unused). Core fields are live inputs —
  Activity ID, Name, Work Package, Type, Duration Type, % Complete Type, Status, % Complete,
  Responsible, Owner, Planned Start/Finish, Predecessors, Remarks (WBS shown read-only, since it's set
  by the parent). Each control persists **on `change`** through the existing `persist()` (so edits are
  undoable + audited + trigger the rebuild/CPM), then `renderGrid()`/`renderGantt()` refresh; Start/
  Finish recompute `duration_days` exactly like the inline grid editor. Activity Codes / UDFs stay
  read-only here (managed via the modal / their own editors).
- **New module-scope hook `_openDetail(tab)`** — assigned in init (where `setDetCollapsed`/
  `setDetailTab` are in scope) so `quickAddActivity` can expand a collapsed panel and jump to General.
- **Verification:** the full inline script parses clean (page loads at `/modules/project-schedule/`
  with zero console errors, then redirects via `AppAuth.requireLogin`). **Live click-through against a
  real login is still pending** (needs an approved session + a project with a WBS — same constraint as
  prior batches). Manual test: select a WBS/activity → Add activity → confirm a "New Activity" row
  appears under that WBS, is selected, and the General tab below is editable and persists.

## UX improvements batch 2 (2026-07-13) — shortcuts help, density, pinned data-date, dark-mode audit
The remaining four build-improvement asks (3, 4, 6, 7); no migration, no schema change.
- **3. Keyboard-shortcut help.** New **"?"** button in the toolbar (next to Labels) + the **?** key
  open `openShortcuts()` — a modal listing the previously-invisible grid shortcuts (Insert / Delete /
  Ctrl+C·X·V / Ctrl+D fill-down / Ctrl+Z·Y / Esc) plus mouse gestures (shift-click cell range,
  ctrl-click row, drag bar/edge, Ctrl+scroll zoom, drag-to-reorder). Also **wired Ctrl+D** into the
  grid keydown handler (was right-click-menu only): fills the active cell's field down to the selected
  rows via the existing `fillDown`. `.ps-kbd`/`.ps-sc-*` styles.
- **6. Row-density toggle (comfortable/compact).** `ROWH` is now driven by `_density`
  (`localStorage.ps_density`; 34px comfortable / 27px compact). A **Row density** section in the
  **Layout ▾** menu (`applyDensity`) reassigns ROWH + toggles `.ps-compact` on `.ps-split` and
  re-renders. Grid rows tighten via CSS (`.ps-split.ps-compact .ps-grid-row:not(.head):not(.ps-filter-row)`);
  Gantt bar offsets were refactored to scale with row height (`oY = ROWH/34`, so comfortable is
  byte-identical) — summary/baseline/milestone/bar tops + the dependency-line anchor Y all derive
  from it, keeping the two panes aligned at either density.
- **7. Pinned data-date label.** The Gantt data-date label (`#ps-datedate-lbl`) is now a readable
  pill (card bg + red border) and `renderWindow` sets its `top` to the current vertical scrollTop on
  every scroll, so it stays at the top of the Gantt viewport instead of scrolling out of view.
- **4. Dark-mode consistency audit.** Swept the named suspects — chart/SVG `<text>` labels, the
  `.ps-mini` tables, `.ps-trace-node`/trace logic, `.ps-net-node`/PERT text, dependency labels, the
  bar-colour vars + legend swatches. All already resolve through `var(--pd-*)` / the
  `#ps-view-schedule`-scoped `--ps-*` bar vars with a `html.pd-dark` override (the fix the original
  legend bug landed). No remaining mismatches found; the new elements added this session (WBS shading,
  import card, shortcuts panel, data-date pill) all include dark-mode-safe vars.
- Verified: full inline script parses clean (`new Function`, 537k chars). Live click-through still
  pending (needs a session + data), same as batch 1.

## UX improvements batch (2026-07-13) — toolbar labels, WBS shading, import feedback
Three of the seven build-improvement asks (1, 2, 5); no migration, no schema change.
- **1. Toolbar discoverability — labeled-mode toggle.** The secondary view cluster
  (Outline/Layouts/Schedule/Layout/Analyze) was icon-only + tooltips. Added a **"Labels"** toggle
  button (`#ps-tb-labeltoggle`, eye icon, far right of the toolbar before the search box) that adds a
  `.ps-tb-labeled` class to `.ps-toolbar`; CSS reveals each icon button's word via
  `.ps-icobtn[data-label]::after { content:attr(data-label) }` (the five buttons carry `data-label`
  = Outline/Layouts/Schedule/Layout/Analyze). Persisted in `localStorage.ps_tb_labels`; toggle shows
  an active red state. Pure CSS reveal — no change to the button render paths or their handlers.
- **2. WBS level visual hierarchy — depth shading.** WBS summary rows previously all shared
  `var(--pd-bg)`. `gridRowHTML`'s WBS branch now adds `ps-wl{min(depth,5)}`; CSS tints the row + its
  frozen c-num/c-id/c-name cells via a `--wl` custom prop (shallower = darker), light + dark variants,
  plus a left accent (inset box-shadow, no layout reflow) on the name cell for the top 3 levels
  (red / red-mid / muted). Group rows keep their red-light background (untouched — separate branch).
- **5. Import feedback — progress bar + "what came in" card.** The loading overlay gained a
  determinate progress bar (`#ps-load-bar`/`#ps-load-fill`); `setProgress(frac)` (null = hide) is
  driven by the chunked-insert loops in both `doImport` (Excel) and `doImportXER` (P6). After a
  successful import, `showImportSummary({title,file,tiles,warnings,note})` shows a modal card of
  counts (Excel: Activities / WBS nodes / With predecessors; XER also Calendars / Resources /
  Assignments / UDFs) plus warnings (e.g. activities missing start/finish) — replacing the old bare
  success toast. `fname` is now threaded into both `doImport`/`doImportXER`.
- Verified: full inline script block parses clean (`new Function`, 532k chars). Not yet clicked
  through on a live login (needs a session + an import file).

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

## Perf hardening (2026-07-07) — topological CPM + compute dedup
The scheduling engine is the hot path on large imports (27k+ activities). Two changes, no behaviour
change (verified 0 mismatches vs the old algorithm across 2,000 random DAGs):
- **`cpmLogic` forward/backward passes rewritten from fixed-point relaxation to a single
  topological-order pass (Kahn).** The old `while (chg && guard++ < tasks.length+5) { tasks.forEach }`
  was **O(n²)** on a long dependency chain — a 27k chain = ~730M iterations, which froze the tab.
  Now each pass is O(n + edges): build `_indeg` (= `_relObjs.length`; each node gets exactly that
  many decrements via predecessors' `_out`, so duplicate edges are safe), Kahn queue → `order`,
  forward pass over `order` (preds precede), backward pass over reverse `order` (succs precede).
  Cycles (bad data) leave nodes un-queued → appended so none is dropped. Measured: 27k-chain **19ms**.
- **CPM compute dedup**: `_cpmDirty` flag + `ensureCPM()` (recompute only if dirty). `rebuild()` sets
  dirty then computes (clears it); read/render paths that used to each call `computeCPM()` fresh —
  `renderPlanner`, `_snapSummary`, `exportLookahead`, `computeHealth`, `repCritical`, and the
  redundant post-`rebuild()` calls in `saveBulkUpdate`/`applyScheduleDates` — now call `ensureCPM()`
  (no-op right after a rebuild). Data-changing/option-changing paths (`scheduleNow`, link creation,
  `recomputeCPM`, crit-toggle) still force `computeCPM()`.
- Data fetch was already paged (`load()` fetches all `.range()` pages in parallel) and the Gantt/grid
  already window rows — those were not regressed.
- **Incremental `rebuild(structural)`**: `rebuild()` ran on every single-cell edit / drag / bulk save
  and re-did a full O(n log n) WBS sort (~129ms at 27k rows in node, worse in-browser via
  `localeCompare`). Now `structural` (default true) gates the sort; pure field edits that can't change
  ordering pass `false` and **reuse the existing `_sorted`** (which holds live row references, so
  edits still show). Callers passing `false`: `persist` when the patch has no `wbs`/`activity_id`
  (`rebuild(!!(patch && ('wbs' in patch || 'activity_id' in patch)))`), `saveBulkUpdate`,
  `applyScheduleDates`. Add/delete/import/column-sort/grouping/WBS-or-ID edits stay structural.
  A `_sorted.length !== rows.length` guard force-sorts if the row count changed anyway. WBS-derived
  `_segs/_depth/_anc` are also cached per row (`_segsWbs`) and recomputed only when `wbs` changes.
  The rollups (`_spanMap`/`_costMap`/`_min`/`_max`) + CPM still refresh every rebuild (needed after
  date/cost edits); only the sort + segs recompute are skipped.
- **Cosmetic-edit skip (in `persist`)**: a patch is classified against `_RECOMPUTE_FIELDS` (the fields
  feeding the sort / WBS roll-ups / CPM). If it touches **none** of them — a purely cosmetic edit
  (status, responsible_party, remarks, owner, PO fields, …) — `persist` **skips `rebuild()` entirely**;
  `_sorted`/`_spanMap`/`_costMap`/`_critical`/`_float` are all unchanged and still valid, and the
  renderers read the live row, so the value shows with zero recompute. WBS/Activity-ID/Type edits set
  `structural` (re-sort); any roll-up/CPM field triggers a `rebuild(structural)`. **Guard:** when the
  OPC column-sort (`colSort`) is active, leaf-sibling order can depend on the edited field, so an edit
  then forces a structural rebuild regardless. (Grouped views regroup from live rows in `buildNodes`
  every render, so they need no special handling.) Note: date/%/cost edits still pay the roll-up + CPM
  recompute — true incremental roll-ups were deliberately NOT added: CPM (~19ms, topological) is the
  floor and must recompute on any date/predecessor change, and `_spanMap`'s min/max isn't safely
  reversible, so the risk/reward was poor. Server-side WBS lazy-loading was also rejected — the grid
  is already windowed (`renderWindow`, cached `DL`, scroll never rebuilds) and client-side
  CPM/critical-path/roll-ups require the full dataset in memory.

## OPC clipboard extras (2026-07-11) — cell-level Cut/Copy/Paste
Follows the existing row clipboard (whole-activity Copy/Cut/Paste). Adds an Excel/OPC-style **cell**
clipboard operating on individual grid cells, independent of the row selection/clipboard.
- **Cell-range selection** (`_cellSel` = a rectangle in DL-row × grid-column index space; `_cellAnchor`
  = shift-extend anchor). A plain grid click sets the active cell (still selects the row for the
  details panel); **Shift-click extends a rectangular block**. Wired via `_setCellFromClick(rw,e)` in
  both the row click and contextmenu handlers (computes the column index from the clicked `.ps-cell`'s
  DOM position minus the `#` gutter — the DOM stays in data order, so this equals the `gridCols()`
  index). Painted by `highlightCells()` (called from `highlightRow()`, so it survives virtualization
  scroll/re-render): `.ps-cell-sel` tinted block, `.ps-cell-active` solid box, `.ps-cell-cut` dashed box.
- **`_CELL_META`** = per-column (GRID_COLS order, built-ins only) `{f, edit, t}`. Editable: Activity ID/
  Name, BL Start/Finish, Start, Finish, % Complete, Planned/Actual/EV/BL IBB. Computed columns (POC,
  At-Completion, Dur, Float, Var, Status, % Complete Type) are **copy-only** (paste skips them, counted
  in the toast). Extra code/UDF columns are out of scope (jsonb).
- **`copyCells(mode)`** packs the rectangle into `_cellClip` `{h,w,cells,cut,refs,tsv}` — each cell keeps
  its raw `val` (editable source, for a clean round-trip) plus display `text`; also writes a **TSV to the
  system clipboard** (`navigator.clipboard.writeText`, best-effort) so cells can be pasted into Excel.
  Clears `_clip` (row clipboard) so Ctrl+V stays unambiguous; `copyRows` reciprocally clears `_cellClip`.
- **`pasteCells()`** (async): single copied cell **fills** the whole target rectangle; a block **pastes
  once** from the top-left. Values coerce to the *target* column's type (`_coerceCell`: number clamps
  0–100, money ≥0 strips currency/commas, date via `_isoFromAny`). Writes are grouped per row and go
  through **`persist()`** (undoable + audited + triggers rebuild/CPM); **duration recomputes** when
  Start/Finish are pasted. A **cut** clears its source cells after paste (except any that were themselves
  paste targets). Falls back to reading the **system clipboard** (Excel paste) when nothing was copied
  in-grid. Non-editable targets are skipped and reported.
- **Keyboard:** Ctrl+C/X/V act on the cell selection when one exists (Excel-style), else fall back to the
  row clipboard; paste prefers whichever clipboard was filled last. **Esc** clears both selections. The
  right-click menu shows a **Copy/Cut/Paste cell(s)** section (Ctrl+C/X/V) above the relabeled **Copy/Cut
  row(s)** / **Paste N rows here** items.
- Verified: the 467k inline module block parses clean; a node harness hand-checked `_coerceCell`/
  `_isoFromAny` (150→100, "50%"→50, "₱1,250.5"→1250.5, iso+human dates→ISO, empty→null) and the
  block-vs-fill paste index mapping (2×2 block expands from a single target cell; a 1-cell clip fills a
  3×2 target). Page loads with no console errors. **Not yet exercised end-to-end against a live login**
  (same constraint as prior batches — needs a real session + data to click through).

## Details panel collapse/expand chevron (2026-07-11)
OPC-style inline toggle (`#ps-det-collapse`) at the right of the detail-tab strip: collapses/expands the
panel BODY while keeping the tab strip visible (so it can be reopened). Chevron rotates 180° when
collapsed (`.up`; only `chevronDown` exists in icons.js). Hides `#ps-details-body` + the resize grip;
state persisted (`ps_details_collapsed`). Clicking any tab while collapsed auto-expands. Independent of
the Layout-menu "hide whole panel" toggle. Verified live on Avesta (collapse→body/grip display:none +
chevron up; expand→restored).

## Trace Logic multi-level · auto-adopt on import · sidebar→back button (2026-07-11)
- **Trace Logic (multi-level):** `detTrace` now walks predecessor/successor chains N levels deep
  (`_traceWalk` = BFS with a `seen` set for dedup + cycle safety), rendering one column per level
  (deepest predecessors far-left). Persisted **Predecessor/Successor Levels** number inputs
  (`ps_trace_levels`, default 3, up to 99); `.ps-trace` scrolls both ways as it grows. Verified live on
  Avesta: A1005 now shows L1 A1100 Concept Design + **L2 A1149 Release of NTP** (matching OPC; the old
  single-level view only showed the immediate predecessor).
- **Auto-adopt WBS on import:** `wbsAdopt` rewritten to insert a whole **depth level at a time**
  (chunked, `.insert(batch).select()` → map code→id), instead of one node per await (which stalled on
  big P6 imports). Resumes cleanly from a partial adoption (seeds `nodeByCode`/`sibCount` from existing
  `WBS_NODES`). `silent` param skips confirm/toasts. `doImport`/`doImportXER` now `await load()` then
  `autoAdoptAfterImport()` (tolerant — never blocks the import). The manual WBS-Manager Adopt uses the
  same fast path now.
- **Sidebar removed:** the left `.pd-sidebar` (which duplicated the title dropdown's view switcher) is
  gone; a `.ps-modback` back-to-modules button (→ `../../dashboard.html`) sits where the hamburger was.
  `UI.initShell()` no-ops without a sidebar (harmless). Verified live: sidebar absent, back button
  present + correct href, content full-width, grid loads, title dropdown still switches views.

## Drag-and-drop row reorder within a WBS (2026-07-11)
**Migration `../../migrations/2026-07-11-activity-seq-order.sql` (RUN):** adds `project_schedule.seq_order`.
- **Sort:** in `rebuild()`, leaf siblings (same WBS parent) order by `seq_order` (unset = last → falls
  back to Activity-ID order = pre-feature behaviour), before the Activity-ID tiebreaker. colSort still
  takes precedence when active (its sibling branch runs first).
- **DnD:** task rows get `draggable=true` only when `_reorderEnabled()` (WBS grouping + no colSort +
  not view-only). Drag listeners rebind each `renderWindow` (rows are windowed). A red insertion line
  (`.ps-drop-above/.ps-drop-below`) marks the drop position; drop only lands within the SAME WBS parent.
  `reorderWithinWbs(draggedId,targetId,before)` renumbers that WBS's leaf siblings 0,1,2,… (from the
  current `_sorted` order) and persists changed `seq_order`s via parallel updates, then rebuild/render.
  Gantt auto-syncs (same `_sorted`/DL). Not undo-integrated (reversible by dragging back).
- **Extended to sibling WBS nodes (2026-07-11):** first cut only reordered activities SHARING a WBS —
  but P6 imports (e.g. Avesta) put one activity per WBS leaf (M6001 = WBS 1.1.1.5), so there were no
  same-WBS siblings and drag did nothing ("no red line"). Now the sort honors a **node-level**
  `seq_order` via `_seqByCode` (built from each WBS code's representative row — summary preferred, else
  a lone leaf activity), and a drop between two different WBS leaves under the **same parent** reorders
  those NODES by writing `seq_order` on their representative rows. **No code renumbering, no wbs_nodes
  dependency, update-only.** `dragover` allows any drop where the two rows share a WBS parent
  (`parentCodeOf`); `reorderDrop` dispatches to `reorderWithinWbs` (same wbs) or `reorderWbsSiblings`.
- **Undo/redo (2026-07-11):** both reorder paths record `pushUndo({type:'reorder', changes:[{id,before,after}]})`
  capturing each affected row's old→new `seq_order`; new `reorder` branch in `undo()`/`redo()` calls
  `_reorderApply(changes,'before'|'after')` (seq-only writes + `rebuild(true)`+render, no refetch). So
  Ctrl+Z/Ctrl+Y and the toolbar undo/redo revert/replay a drag reorder.
- **Verified LIVE on Avesta (2026-07-11):** node-level comparator unit-tested; then on the real
  4,393-row project, setting `seq_order` on the 7 "Topping Off" milestones (each its own WBS leaf,
  1.1.1.1–1.1.1.7) reversed their grid order exactly (M7001…M3001) — the exact path a drop triggers —
  then reverted. Confirms sort + reorder end-to-end. (The literal mouse drag-drop gesture still wants a
  human confirm; draggable rows + the same-parent drop rule are in place.)
- **Known limitation:** if a WBS node has MULTIPLE activities AND is itself reordered as a sibling, the
  node's `seq_order` (taken from one activity) can overlap with that activity's leaf-order meaning.
  Neither Avesta nor typical data hits this; documented for later.

## P6 .xer import RUN LIVE (2026-07-11) — import verified, load-timeout bug found
The P6 importer had never run end-to-end against live Supabase (parser-only verified). Imported a real
`.xer` into scratch project **XERTEST**: **42,306 activities, 14,495 WBS summaries, 27,796 predecessors
resolved, 11 milestones, 4 calendars, 5 resources, 55,489 assignments** — counts match the offline
parser verification exactly. **Import writes correctly at scale.**
- **BUG FOUND (new task):** opening a 42k-row project fails with *"canceling statement due to statement
  timeout."* `load()` fetches ~43 pages via `.range()` **OFFSET** pagination in parallel; far pages
  (offset ~41k) re-scan tens of thousands of rows each → exceeds Supabase's statement_timeout. 4.4k-row
  projects (Avesta) load fine; the threshold is a few thousand rows. **Fix planned:** keyset pagination
  (`order=id.asc&id=gt.<last>&limit=N`) so every page is an indexed range scan. Hot path — verify on a
  small project + XERTEST before shipping. (A single ordered 1000-row page measured 1.4s.)
- **FIXED + verified live (`1aaecfb`):** `load()` now uses keyset pagination (`order=id.asc & id>last,
  limit 1000`) instead of `.range()`/OFFSET — each page is an indexed PK range scan. REST simulation
  fetched all 42,306 rows across 43 pages (max page ~1.05s, ~12s total, no timeout); then the live app
  loaded XERTEST fully — **27,811 activities** + 14,495 WBS, Gantt with milestones + dependency lag
  labels rendering, no timeout toast. Sequential (each page needs the prior page's last id) so mid-size
  projects load marginally slower than the old parallel fetch, but nothing times out. Small projects =
  single page (unaffected).

## Resource/cost-side OPC parity — in progress (2026-07-11)
User approved building all four gaps. **Migration `../../migrations/2026-07-11-resource-cost-parity.sql`
(USER MUST RUN):** `cost_accounts` (CBS tree), `price_per_unit` on `resources`+`resource_roles`,
`budgeted/actual/remaining_cost`+`cost_account_id`+`rate_source` on `resource_assignments`,
`activity_expenses` table, and `project_schedule.cost_rollup` (opt-in bottom-up cost derivation;
default false = current manual behaviour preserved). Build sequence (UI, next):
- **3a Cost Accounts / CBS manager** — DONE + deployed (`871279c`). Actions ▾ → Cost Accounts…: a
  single-pane indented CBS **tree** manager (add top-level / add child / edit / delete with child+usage
  guards). `COST_ACCTS`/`EXPENSES` loaded in `loadResourcesAssignments` (tolerant). Helpers
  `costAcctTree`/`costAcctOptions`/`costAcctLabel`/`costAcctUsage` ready for 3b/3c pickers. Tree
  ordering/indentation node-verified; interactive smoke-test blocked by the 4,393-row render freeze
  (needs a small project, same blocker as §2 write-actions).
- **3b Price/Unit + assignment cost + roll-up** — DONE + deployed (`1fdc9b8`). Resource-master
  Price/Unit field on resources+roles (roster column) — verified live on DEMO01. Assignment form:
  budgeted/actual/remaining COST + cost-account picker + Derived (units × `resRate`) / Manual toggle
  (`recalcCost` auto-fills + disables cost inputs when derived); cost fields written tolerantly with
  `curve`. Panel shows cost + account columns + total + a per-activity **cost_rollup** toggle;
  `syncActivityCost(r)` sums Σ assignment + Σ expense cost → activity planned/actual via `persist()`
  (undoable) ONLY when the flag is on (default off = manual preserved), called after assignment
  save/delete. (Assignment-form interactive test blocked by the 4,393-row grid freeze — code-verified.)
- **3c Expenses tab** — DONE + deployed (`3a05035`). New **Expenses** detail tab (between Resource
  Assignments and Relationships): per-activity CRUD (name, cost account, planned/actual cost, remarks)
  + Total row (`detExpenses`/`wireExpenses`/`openExpenseForm`/`delExpense`, copied from Steps/Assignments).
  Feeds `syncActivityCost` so expenses roll into the activity's Planned/Actual cost when `cost_rollup`
  is on. Tolerant of the not-yet-run migration.
**Batch complete + verified LIVE end-to-end (2026-07-11).** Created a small scratch project
`XERTEST` (via the authenticated session) to escape the 4,393-row render freeze, then drove the full
flow on the live app: added a rated resource (₱500/unit), a cost account (01 Preliminaries), an
assignment (20 units → derived ₱10,000, tagged to the account), and an expense (₱2,500); toggling the
activity's **Roll cost up** ran `syncActivityCost` → activity `planned_cost` = **₱12,500** in the DB
(10,000 + 2,500). Confirms 3a (account shown), 3b (assignment cost + toggle + sync), and 3c (expense
feeding the rollup) all working together. Resource-master Price/Unit + roster column also verified live.
`XERTEST` is left in place as the responsive venue for the P6-import test + future interactive checks.

## Excel export now includes dynamic columns (2026-07-11)
`exportExcel` previously used a fixed header set — the Activity-Code/UDF dynamic grid columns were
grid-only. Now it appends the extras **currently shown in the grid** (`extraColDefs().filter(c=>!colHidden[colKey(c)])`
— WYSIWYG; extras default hidden so a plain schedule still exports the 16 built-ins only). Per-row
value via `extraCellVal` (blank on WBS rows, matching the grid). Header labels are **uniquified**
against the built-ins and each other (a UDF named "Status" → "Status (2)"; duplicate "Zone" →
"Zone"/"Zone (2)") so the `json_to_sheet` object keys can't collide. Verified the uniquifier in a node
harness. Widths default 18 for extras.

## Clipboard fixes from live DEMO01 testing (2026-07-11)
Two bugs surfaced during the first real-login click-through (VERIFICATION.md §2), both fixed:
- **Shift-click made a native browser text-selection** (blue highlight + the browser's selection
  toolbar) that buried the red cell-range block and made Ctrl+C/X/V feel tied to inline editing. Fix:
  `user-select:none` on `.ps-grid-pane .ps-cell` (re-enabled `user-select:text` on `.ps-cell input`
  so editing still allows text selection). The cell block is now the only visible selection and the
  keyboard clipboard acts on it directly.
- **Row Copy/Paste (right-click → Copy/Paste row(s)) wasn't undoable** — `pasteRows` inserted directly
  and never recorded undo. Fix: new **`insertMany`** undo action. `pasteRows` now collects the inserted
  rows (`_dbPayload(res.data)` = the row minus underscore-prefixed computed props) and, on a cut, the
  deleted source rows; `undo()` deletes the pasted rows + re-inserts cut sources; `redo()` reverses it;
  both `await load()` to resync. (Cell paste was already undoable — it routes through `persist()`.)

## OPC parity batch: Activity Codes, Weighted Steps, Last Planner/PPC (2026-07-07)
Three requested together (user prioritization: build the one that's more foundational/necessary
where it matters — see the per-feature notes below).

**1. Activity Codes + code-based grouping/filtering.**
**Migration:** `../../migrations/2026-07-07-activity-codes.sql` (`activity_code_types`,
`activity_code_values`, both RLS via `is_approved()`/`is_planner()`; `project_schedule.activity_codes
jsonb default '{}'` — a compact `{ "<code_type_id>": "<code_value_id>" }` map, matching the
`schedule_baselines` jsonb-snapshot convention rather than a join table).
- **Actions ▾ → Activity Codes…** (`#ps-codes-back`, `openCodes`/`renderCodesList`/`renderCodesDetail`)
  — a two-pane manager (list of code TYPES on the left — e.g. Phase, Area, Zone — their VALUES on
  the right), reusing the Snapshots modal's `.ps-snap-list`/`.ps-snap-detail` two-pane CSS. Rename/
  delete a type, add/delete its values; each value's detail row shows how many activities currently
  use it.
  - **Add/Edit Activity modal** gets one dynamic `<select>` per code type (`populateCodesFields`,
    `#ps-f-codes-wrap`/`#ps-f-codes-fields`, hidden entirely when the project has no code types
    yet). Written **separately + tolerantly** after the main save (own try/catch, same pattern as
    `contract_date`/`risk_*_pct`).
  - **Grouping**: `#ps-group` gets one auto-populated "Group: <name>" option per code type
    (`populateGroupSelect`, called after every project load and after any code-type CRUD); `groupKeyOf`
    resolves `groupBy==='code:<id>'` via the activity's `activity_codes[id]` → the value's label
    (falls back to "— Unassigned —"). The existing non-WBS grouping path in `buildNodes()` is fully
    generic, so no grouping-logic changes were needed beyond `groupKeyOf`.
  - **Filtering**: `filters.codes = { "<code_type_id>": { "<code_value_id>": true } }`, one checkbox
    section per code type in the filter menu (`buildFilterMenu`), ANDed across types / ORed within a
    type in `rowMatches`.
- Deliberately **not** added as a grid column this round — the sticky-column chain (contiguous-from-
  the-left invariant noted elsewhere in this file) is easy to break, and grouping+filtering already
  satisfies the ask; a column can follow later if wanted.

**2. Weighted Steps → physical % complete.**
**Migration:** `../../migrations/2026-07-07-activity-steps.sql` (`activity_steps`, keyed by
`activity_id` like `resource_assignments`, not the row's uuid).
- New **Steps** tab in the Activity Details panel (between Status and Resource Assignments —
  `detSteps`/`wireSteps`/`openStepForm`/`delStep`, copied structurally from `detAssign`/
  `wireAssign`/`openAssignForm`/`delAssign`): a per-activity checklist, each step has a name/weight/
  %-complete. Shows the rolled-up "Weighted physical % complete" above the list.
- **`physicalPct(activityId)`**: weight-weighted average of each step's own % complete
  (`Σ(weight·pct)/Σ(weight)`); returns `null` when the activity has no steps (manual entry still
  applies, no behavior change for activities that don't use Steps).
- **`syncPhysicalPct(r)`** writes the rolled-up value back onto `project_schedule.percent_complete`
  via the existing `persist()` (not a raw update) every time a step is added/edited/deleted — so
  undo, audit, and the CPM/rebuild trigger (`percent_complete` is already in `_RECOMPUTE_FIELDS`)
  all fire exactly as they would for a manual edit. This is the entire point of the feature: CPM,
  EVM, Cost Loading, forecasts, the Planner Cockpit, and Monte Carlo actuals all read
  `percent_complete` already, so they benefit with **zero further changes**.
- The Add/Edit modal's **% Complete** field is disabled (with an explanatory title) when the
  activity has steps, pointing to the Steps tab — purely a UX affordance; the field still submits
  its (already-synced) value if somehow re-enabled, so nothing breaks if steps are deleted mid-edit.

**3. Last Planner System — weekly work plan + Percent Plan Complete (PPC).**
**Migration:** `../../migrations/2026-07-07-weekly-commitments.sql` (`weekly_commitments`: project +
`week_start` (Monday) + description + optional `activity_id` link + responsible + status
(Open/Complete/Not Complete) + reason_code/notes).
- New 4th view/tab (**Last Planner**, sidebar `data-view="lastplanner"` + title-menu
  `data-tab="lastplanner"`, `#ps-view-lastplanner`) — same top-level pattern as Planner/Schedule/
  Cost Loading. The Schedule-only toolbar (Add activity/Group/Zoom/etc.) is hidden here too, same
  as on Planner/Cost Loading.
- **Week navigator** (`_lpWeek`, `mondayOf(d)`, prev/next/"This week", persisted per-project in
  localStorage) + **Add commitment** modal (description, optional linked activity picked from the
  live schedule, responsible).
- **Weekly commitments table**: inline **Status** (Open/Complete/Not Complete) and **Reason code**
  selects per row (reason select disabled unless status is Not Complete) — changes save immediately
  (`lpUpdate`), matching a real Friday-afternoon review workflow rather than requiring the edit modal
  for every status flip. Reason codes are a fixed Last-Planner-standard list (`LP_REASONS`: Materials,
  Manpower/Labor, Equipment, Prior Work Not Complete, Design/Information, Weather, Owner/Client
  Decision, Rework, Other).
- **PPC KPI** for the selected week = `Complete ÷ (Complete + Not Complete)` — **Open (not yet
  reviewed) commitments are excluded from the denominator** so a PPC number doesn't read artificially
  low mid-week before the review happens; the KPI row also shows the raw Open count so it's clear
  not everything's been assessed yet.
- **PPC trend chart** (`renderLPPpcTrend`): all weeks with ≥1 assessed commitment, plotted against a
  dashed 80% Lean-Construction benchmark line. **PPC trend / Reasons for variance** panels reuse the
  cockpit's `.ps-ck-trend-card`/`.ps-risk-torn-row` visual language rather than inventing new chart
  chrome.
- **Reasons for variance** (`renderLPReasons`): a Pareto-style ranked bar list of reason codes across
  **all** Not-Complete commitments (not just the current week), so recurring root causes are visible
  even if this week's variance count is small.
- Verified in throwaway gitignored harnesses (`_ui_test.html`): `mondayOf()` hand-checked against all
  7 weekdays (Sun correctly maps back to the *previous* Monday, Mon–Sat map to their own week);
  `physicalPct` weighted-average matched a hand calc (2·100+3·80+3·0+2·0)/10 = 44%; the Activity-
  Codes assignment `<select>`s correctly pre-select an activity's existing code values; screenshotted
  the PPC trend chart and — same lesson as the Milestone Outlook timeline earlier — caught and fixed
  an edge-label clipping bug (last x-axis date ran off the SVG's right edge) before shipping.

## First-class WBS (2026-07-07) — WBS Manager + dedicated wbs_nodes table
User wanted the Work Breakdown Structure built FIRST (unlimited depth), then activities placed under
any main- or sub-node — rather than hand-typing dotted codes. **Migration:** `../../migrations/
2026-07-07-wbs-nodes.sql` (`wbs_nodes` table + `project_schedule.wbs_node_id`).
- **Architecture (chosen by user): dedicated `wbs_nodes` table** (id, parent_id, code, code_custom,
  name, sort_order) as the AUTHORING source of truth for the tree. Codes are **auto-numbered from
  tree position** (`computeWbsCodes` → 1, 1.1, 1.1.2…) but **editable** (`code_custom` keeps a typed
  code e.g. `CIV-100`; its subtree is prefixed by it).
- **Projection (key integration):** the existing grid/roll-up/CPM/importer pipeline keys off the
  dotted `project_schedule.wbs` code + `activity_type='WBS Summary'` rows, so on every tree edit the
  app PROJECTS the nodes into those summary rows (`_wbsCommit`: recompute codes → update each node's
  `wbs_nodes.code`, its linked WBS-Summary row's `wbs`+`activity_name`, and the `wbs` of activities
  under any re-coded node; batched via `_batchUpdate`). This keeps the entire tested pipeline
  UNCHANGED — no rewrite of grouping/rollups/importers.
- **WBS Manager** — new view (`#ps-view-wbs`, sidebar `data-view="wbs"` + title menu `data-tab="wbs"`,
  `renderWbsManager`): indented tree with per-node Add-child, Move up/down, **Indent/Outdent**, Edit
  code, Delete; inline name edit; badges (sub-count · activity-count). Node CRUD: `wbsAddChild`/
  `wbsAddRoot` (inserts node + a projected WBS-Summary row), `wbsRename`, `wbsMove` (up/down/indent/
  outdent using the verified tree algos + `_wbsNormalizeAndPersist`), `wbsEditCode`, `wbsDelete`
  (**guarded** — blocks if the node still has sub-nodes or activities). Tree algorithms
  (auto-numbering, custom codes, move/indent/outdent, guards) unit-tested in a node harness.
- **Adopt existing WBS** (`wbsAdopt`) — one-time bridge for imported/legacy projects: builds `wbs_nodes`
  from the current WBS-Summary rows (parents resolved by dotted-code prefix, depth-ordered so parents
  exist first; codes preserved as `code_custom`), then links the summary rows + matching activities via
  `wbs_node_id`. Importers stay unchanged (they still create summary rows); Adopt pulls them into the
  manager. The Adopt button auto-shows only when un-adopted summary rows exist.
- **Add/Edit activity** — new **Parent WBS picker** (`#ps-f-wbs-node`, indented `wbsPickerOptions`)
  before the WBS Code field: picking a node auto-fills + locks the code and sets `wbs_node_id`
  (written tolerantly, like `contract_date`). Direct code entry still works when no tree exists yet
  (back-compat). `wbs_node_id` also added to the Add/Edit save + activity save paths.

## Toolbar/topbar de-clutter (2026-07-07) — File menu + labeled groups
The top area had ~22 icon-only buttons, several sharing a glyph (pulse=Health & Spotlight, risk=
Critical & Threshold/Monte-Carlo, listView=Layouts & UDF/GlobalChange, layers=Expand & Baselines) —
so planners had to guess. Reworked to labeled controls + grouping (no logic changes to the underlying
actions; ids preserved so all existing handlers work unchanged):
- **File ▾ menu** (topbar, `#ps-filebtn`/`#ps-file-menu`): **Import, Export, Print** combined. Import/
  Export were removed from the **Actions ▾** menu and the standalone Print icon removed from the topbar;
  the three item buttons keep their original ids (`ps-import`/`ps-export`/`ps-print`) so their handlers
  are untouched. `.ps-tb-labeled` gives topbar buttons auto width (icon + word); `.ps-tb-sep` dividers.
- **Topbar** now: undo · redo │ **File ▾** · **Reports** · **Health** (last two now show text labels) │
  filter · refresh. Undo/redo/filter/refresh stay icon-only (universally understood).
- **Lower toolbar** relabeled every icon button to icon+word: **Expand · Outline ▾ · Layouts ▾ ·
  Schedule · Layout ▾ · Columns ▾ · Colors ▾** (all keep their existing `.ps-menu-wrap` popovers +
  ids/handlers — just labels + drop `.ps-icobtn` fixed width).
- **Analyze ▾ menu** (`#ps-analyzebtn`/`#ps-analyze-menu`): the four analysis controls — **Critical
  path · Show dependencies · Link mode · Progress Spotlight** (advance 1/2wk·1mo·clear) — grouped into
  one labeled dropdown. The crit/deps/linkmode items keep their ids so their toggle handlers are
  unchanged; `analyzeMenu` stops click propagation so several can be toggled without closing, and
  `_syncAnalyzeBtn()` (module scope) mirrors any-active (crit/deps/link/`_spotlight.on`) onto the
  Analyze button (`#ps-analyzebtn.active`). The standalone `#ps-spotlight` button was removed (its
  `#ps-spotlight-menu` data-spot items now live inside Analyze); `advanceSpotlight`/`clearSpotlight`
  call `_syncAnalyzeBtn()` instead of touching the old button.
- `closeMenus()` gained `fileMenu` + `analyzeMenu`. Net: ~22 mystery icons → labeled words + 2 grouped
  dropdowns (File, Analyze), collisions gone.

## Advanced scheduling batch (2026-07-07) — 9 features, easiest→hardest
All in `modules/project-schedule/index.html`. Each feature was unit-tested (pure logic extracted
into a node harness) and committed+pushed separately. **User must run the new migrations** listed.

1. **Progress Spotlight / data-date advancement** (no migration). Toolbar Spotlight menu (`#ps-spotlight`,
   `advanceSpotlight`/`clearSpotlight`/`spotlightRow`): advance the data date 1/2 weeks or 1 month and
   blue-highlight (+dim the rest, mirroring critMode) the incomplete activities whose planned work fell
   in the window just passed — the exact set to status. `_spotlight={on,start,end}`; row class
   `ps-spotrow`, bar class `ps-spot`, `ps-spotmode` on grid-scroll + gantt-pane.
2. **Constraint-aware CPM** (no migration; uses existing primary/secondary constraint fields). `cpmLogic`
   now honors date constraints in both passes via `taskConstraints`/`fwdConstrain`/`bwdConstrain`:
   Start/Finish On·On-or-After·Mandatory pin/floor early dates (forward, applied LAST after the data-date
   floor); Start/Finish On-or-Before·Mandatory cap the late finish (backward); As-Late-As-Possible sits
   the activity at its late dates. **Critical is now `_float <= 0`** (was `=== 0`) so over-constrained
   (negative-float) activities flag critical — the point of the feature.
3. **Global Change** (no migration). Actions ▸ Global Change: WHERE conditions (field/op/value, ANDed;
   blank=all) + THEN changes (Set/Add/Subtract/Multiply/Clear · text/num, Set/Shift-days · date) with a
   live Preview count. `GC_FIELDS` catalog with per-type ops; `gcMatch`/`gcBuildPatch`; moving start/finish
   auto-recomputes duration. Chunked writes, resets undo, confirms first (same safety model as the bulk
   progress grid).
4. **Resource leveling / over-allocation resolver** (no migration). Actions ▸ Resource leveling
   (`levelScan`/`renderLeveling`/`levelDelay`): scans each resource's monthly planned demand vs calendar
   capacity (reuses `spreadAdd`+`resCapacity`), reports over-allocated periods + peak overage, lists the
   flexible (positive-float, not-started) contributors, and delays one within its own total float per
   click (through `persist()` → undoable + recomputes CPM; report re-scans). Never moves the project
   finish; critical/started contributors untouched.
5. **What-if scenarios (reflections)** — **migration `2026-07-07-schedule-scenarios.sql`**
   (`schedule_scenarios`). Actions ▸ What-if scenarios: capture the schedule as a named jsonb checkpoint
   (dates/dur/%/predecessors/cost), experiment on the live schedule, compare live-vs-scenario deltas
   (finish / critical count / planned cost / activities that moved), or **Restore** to roll the experiment
   back. Mirrors the baselines two-pane modal.
6. **User-Defined Fields** — **migration `2026-07-07-user-defined-fields.sql`** (`activity_udf_defs` +
   `project_schedule.udf jsonb`). Actions ▸ User-Defined Fields defines typed fields (Text/Number/Date/
   Cost); Add/Edit modal renders one typed input per def (`populateUdfFields`, saved tolerantly to `udf`
   jsonb, same pattern as `activity_codes`); values show in the details General tab. `UDF_DEFS` loaded in
   `loadResourcesAssignments`.
7. **Resource/cost distribution curves** — **migration `2026-07-07-assignment-curve.sql`**
   (`resource_assignments.curve`). Assignment modal gains a Distribution curve (Linear/Front/Back/Bell);
   new `curveCdf`+`spreadCurveAdd` shape how planned+remaining units are time-phased in Resource Usage
   (actuals stay linear). `spreadCurveAdd` uses each curve's cumulative fn → O(months), exact,
   total-conserving; `linear` reduces to `spreadAdd` exactly (verified). Curve written tolerantly.
8. **Saved layouts** (no migration; localStorage `ps_views`). The Saved-views control now bundles the
   FULL working arrangement — filter + grouping (incl. `code:<id>` groups) + zoom/search + the whole
   column setup (hidden columns / column sort / renamed headers / `--c-*` widths). `applyView` restores
   all of it and writes back to the same localStorage keys the renderers read; old saved views still
   apply (each field guarded).
9. **Threshold monitoring → auto-issues** — **migration `2026-07-07-schedule-thresholds.sql`**
   (`schedule_thresholds`). Actions ▸ Threshold monitoring: rules watching a per-activity metric
   (`float_below` / `finish_var_above` / `contract_var_above` / `overdue_days`) at a severity. "Scan now"
   (`scanThresholds`/`thrValue`/`thrBreached`) lists breaches; "Generate issues" writes them into the
   shared **`issues_lessons`** table (type=Issue, category='Schedule Threshold'), **deduplicated** against
   still-open threshold issues for the same activity+rule (deterministic `_thrIssueTitle`) so repeated
   scans don't spam duplicates.

## Monte Carlo: per-activity 3-point duration override (2026-07-07)
**Migration:** `../../migrations/2026-07-07-risk-3point-duration.sql` (`project_schedule.risk_optimistic_pct`/
`risk_pessimistic_pct`, both `numeric(6,2)`, nullable — folded into `supabase-setup.sql`).
Prioritized over adding a criticality-index output: the simulation previously applied ONE global
Optimistic%/Pessimistic% to every activity regardless of type, so a 2-day punch-list item and a
180-day long-lead procurement activity got the identical relative spread — an input-fidelity gap
that limits every downstream output (P50/P80/P90, tornado). A criticality index would instead need
a **backward pass per iteration** (to get float), roughly doubling compute right where 27k-activity/
1000-iteration runs are already flagged as heavy, and its result would mostly just re-derive what
the tornado already shows under a uniform-variance model. The override is compute-neutral (same
forward-pass-only architecture, per-node opt/pess instead of one global pair) and improves every
existing output immediately, so it came first.
- **Add/Edit Activity modal** gained **Risk: Optimistic %**/**Risk: Pessimistic %** fields (next to
  Contract Date) — blank (the default) means "use the simulation-wide default"; set only on the
  activities a planner actually has a stronger/weaker view on (e.g. long-lead procurement,
  permitting, weather-sensitive site work). Written **separately + tolerantly** after the main
  save (own try/catch, like `contract_date`), so a not-yet-migrated DB doesn't break saves — and so
  a missing `risk_*` column can't also swallow the `contract_date` write, or vice versa (kept as
  two independent tolerant updates rather than one combined payload).
- **`_riskPrep()`** captures `riskOpt`/`riskPess` (the activity's own %, `/100`, or `null`) per node.
  **`runRisk()`** computes each varied node's *effective* range once before the iteration loop
  (`nd._opt`/`nd._pess` = the override or the global default; re-clamped so pess>opt exactly like
  the global pair already was) — not per-iteration, since it's invariant across samples — and the
  sampling loop calls `_triSample(nd._opt, 1, nd._pess)` instead of the global `opt`/`pess`.
- **Results surface which activities used a custom estimate**: the count line adds "· N with a
  custom 3-point estimate", and any overridden activity in the **tornado** (top duration drivers)
  gets a small "(custom)" tag next to its name.
- Verified in a node harness (no DOM/backend touched): the effective-range fallback/clamp logic
  hand-checked across 5 cases (both null → global; one overridden → mixed; both overridden with
  pess≤opt → guard re-clamps, matching the global pair's own guard); `_triSample` re-verified with a
  realistic per-activity override range (opt 70%/pess 115%) — sampled mean matched `(a+c+b)/3`
  exactly over 300k draws, bounds respected.

## OPC parity: Multiple baselines + Monte Carlo risk (2026-07-07)
Both reached from the **Actions ▾** menu (`#ps-baselines`, `#ps-risk`).

**Multiple baselines** — **Migration:** `../../migrations/2026-07-07-schedule-baselines.sql`
(`schedule_baselines`: one row/baseline, `activities` jsonb `{ "<activity_id>":[start,finish,dur,
planned_cost] }`, `is_primary`, RLS via `is_approved`/`is_planner`). Modal `#ps-bl-back` (list + compare
panes). `captureBaseline()` snapshots all leaf activities; `setPrimaryBaseline()` flags one primary AND
**writes its dates back onto `project_schedule.bl_start/bl_finish/bl_cost`** (chunked, then `load()`) so
the existing Gantt BL0 bar + `finVar` variance use it; `showBlCompare()` shows per-activity
current-vs-baseline finish variance (top 300, sorted by slip, avg + late count); `deleteBaseline()`.
Tolerant of a missing table (shows a "run the migration" note).

**Monte Carlo schedule risk** — **no migration** (pure client compute). Modal `#ps-risk-back`.
`_riskPrep()` builds the task graph + topological `order` (same Kahn approach as `cpmLogic`) once;
`_riskForward(prep,durs)` is a single forward pass returning project finish (max EF) for a given
duration array. `runRisk()` samples each **incomplete, not-started** activity's duration from a
**triangular** distribution between Optimistic% and Pessimistic% of plan (mode = 100%; completed/started
keep actuals) via `_triSample`, runs N iterations (default 1000, chunked 100/frame with a progress %
so the UI never freezes — leverages the O(n+e) CPM), and accumulates running sums for a
**duration-sensitivity** (Pearson r of each activity's sampled duration vs the finish — no per-iteration
backward pass needed). `finalizeRisk()` shows P50/P80/P90 finish dates, deterministic (plan) finish,
P80-vs-plan slip, a 30-bin finish-date histogram, and a **tornado of the top duration drivers**. Finish
date = `base + EF − 1` (inclusive, matches `applyScheduleDates`). Verified in a node harness: triangular
mean = (o+m+p)/3 exactly, bounds respected, percentiles monotonic and right-skewed of the deterministic
finish.

## PWA / offline resilience (2026-07-07) — app-wide
For flaky site connectivity. Three new pieces, all safe-by-construction:
- **`sw.js`** (repo root) — a **network-first** service worker: only same-origin GET is handled;
  writes and ALL cross-origin (Supabase REST/auth) pass straight through (never cached/queued).
  Online it always fetches fresh then refreshes the cache; offline it falls back to the last cached
  asset/page. Because network is tried first, it can only ADD an offline fallback — never serves
  stale while online. Bump `CACHE` (`pd-shell-v*`) to purge.
- **`manifest.webmanifest`** (repo root) — installable (name/icons/theme `#EE3124`, `display:standalone`).
- **`assets/js/theme.js`** (loaded on every page) now, app-wide: derives the app root from its own
  script URL (works at any page depth), injects the `<link rel=manifest>` + `theme-color` meta,
  registers `sw.js` on `load`, and shows a fixed **offline indicator** ("Offline — … changes won't
  save") toggled by `online`/`offline` events (pure UI, no caching risk).
- **NOT offline writes** — edits still require connectivity (the indicator says so). Full offline
  write-queue/sync is deliberately out of scope (auth + conflict complexity).
- Module `?v=` → 20260709 (theme.js changed). NOTE: could not be tested against the live GitHub
  Pages origin from here; network-first is the safest strategy but verify install/offline on staging.

## Planner batch 7 (2026-07-07) — Cockpit redeveloped as a client-facing outlook, not tables
User feedback after batch 6 (which had already turned the two list panels into bar charts): "still
doesn't feel very useful... shouldn't be full of tables," and asked what a **Client** would want to
see. Agreed direction: are-we-on-track, when-will-it-finish, what's-at-risk — a snapshot/outlook,
not an activity punch list. Rebuilt the passive dashboard content (kept the `.ps-ck-bar` action
buttons — Update progress/Export lookahead/Take snapshot/Snapshots/Change history — since those are
on-demand tools, not part of the problem):
- **Status banner** (`_ckStatusHTML`, `#ps-ck-status`, top of the page): a traffic-light chip (On
  Track / At Risk / Behind Schedule — thresholds 0d / 30d off the forecast-vs-planned finish) plus
  one auto-generated sentence: "{Project} is X% complete. At the current pace, forecast finish is
  {date}, {N days past / on pace with} the planned finish ({date}). N milestones at risk. N exposed
  to contract-date (LD) risk." This is the single thing a client should read first.
- **New hero chart — Progress S-Curve & Forecast** (`_ckSCurveCompute`/`_ckSCurveSVG`, replaces
  batch 6's snapshot-based "Progress Trend" line): duration-weighted Planned / Actual / Forecast-
  to-finish curves, **ported verbatim from the standalone `modules/s-curve/` module's
  `compute()`/`renderChart()`** (same math — SPI-based forecast clamped 0.1–3, S-curve-shaped
  forecast tail, data-date line) but reusing this module's **already-loaded `rows`** for the current
  project instead of a second fetch, so it draws instantly with zero network cost. Strictly better
  than the snapshot trend it replaced: always available (no dependency on planners remembering to
  take weekly snapshots), and it's the chart a client actually recognizes from monthly reports. No
  manual forecast-override input here (that stays a feature of the dedicated s-curve module) — the
  cockpit's version is auto/SPI-only by design, kept simple.
- **New "Milestone Outlook" timeline** (`_ckMilestoneTimeline`, replaces the "Milestones at risk"
  list): every milestone plotted on a single date axis as a dumbbell — a faint gray dot at its
  baseline finish, a colored dot at its current forecast/actual finish, joined by a line when they
  differ. Color = status (green on-track / amber ≤14d late / red >14d late, thresholds intentionally
  tighter than the project-level status banner since a single milestone slipping 2 weeks matters
  more than the overall project doing so). Shows the WHOLE milestone set, not just the late ones —
  a client wants "what's coming up," not only "what's already broken." Only at-risk/late milestones
  get a text label (alternating above/below to reduce overlap); labels are clamped inside the
  viewBox (`padL+22`/`padL+cw-22`) so the first/last milestone's label doesn't clip off the edge —
  caught by screenshotting a throwaway harness before shipping.
- **"Top risk drivers"** (was "Most behind schedule"): same ranked bar rows as batch 6, just capped
  to the top 5 with a "+N more — see Update progress/Export lookahead" footer instead of a 60-row
  scrolling list.
- **Critical-path drivers**: kept the batch-6 float-bucket strip chart; the scrolling row-list below
  it became compact non-scrolling **pills** (`fillPills`, `.ps-ck-pill`, up to 18 + "+N more") — a
  name badge per activity, click still jumps to the Schedule view with that activity selected.
- **"3-week lookahead" panel removed from the passive view entirely** — it's an action checklist,
  not an outlook metric, and the same scope is still fully available via "Update progress…" (the
  bulk-edit grid, which has its own Due-2/3/6-weeks scope filter) and "Export lookahead" (the XLSX
  site-meeting handout); only its count remains, folded into the KPI strip.
- KPI strip condensed from 7 tiles to 6, swapping "Activities behind"/"Data date" (now in the
  headline sentence / chart data-date line) for "Forecast finish" (with a +Nd-vs-plan sub-label).
- Removed the now-dead snapshot-trend code (`_ckLoadTrend`/`_renderCkTrend`/`_ckTrendSVG` and the
  `_ckTrend` cache/invalidation call in `takeSnapshot`) rather than leaving it unused — "Take
  snapshot"/"Snapshots"/"Change history" still work exactly as before, just no longer feed a trend
  chart (the S-curve replaced that need).
- Verified with a throwaway gitignored harness (`_ui_test.html`) against a hand-built 12-activity/
  6-milestone fixture (mobilization on-time, substructure done-but-late, superstructure behind,
  MEPF/finishes not started) with a pinned data date: screenshotted the status banner (correctly
  read "Behind Schedule", 35% complete, forecast 186 days past plan), the S-curve (planned/actual/
  dashed-forecast rendered correctly, actual line flat past the data date as expected), and the
  milestone timeline (all four status colors present, dumbbell baseline-vs-forecast lines correct,
  labels legible and non-clipping after the padding fix above).

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

## Column drag-to-reorder (2026-07-08)
Header cells are `draggable` (HTML5 DnD): drag one onto another to reorder. Implemented purely via CSS
flex `order` — `applyColOrder()` writes `.ps-cell:nth-child(i){order:p}` rules keyed to each column's
DOM/data index, so the **DOM stays in data order** and everything positional keeps working (nth-child
hide, `data-ci`→`openColMenu`, `colSortVal`, resize) while only the VISUAL order changes. State is a
persisted `ps_colorder` list of `colKey`s; `normalizeColOrder()` appends new columns / drops removed
ones; `moveCol(src,tgt)` drops src before tgt. The resize grip preventDefaults its mousedown so it
resizes (not drags); a plain click still opens the column menu. Columns ▾ **Reset** also clears the
order back to default. NOTE (2026-07-08): removed the Procurement-flavoured UDF example text
("Cost Code / PO Number / Vendor / Risk Owner") — those belong to the separate Procurement Dashboard,
not the Planning App; the UDF prompt/empty-state are now domain-neutral.

## Dynamic columns (2026-07-08) — Activity Codes + UDFs as grid columns
"Define columns" now matches OPC: the project's **Activity Codes** and **User-Defined Fields** appear
as real, choosable grid columns (no new migration — reuses `CODE_TYPES`/`CODE_VALUES`/`UDF_DEFS` +
`project_schedule.activity_codes`/`udf` jsonb). `extraColDefs()` maps them to `[key,label,'c-x',meta]`
tuples; `gridCols() = GRID_COLS.concat(extraColDefs())` is the single source the whole column pipeline
now iterates (`renderHeader`, `applyColHidden`, `openColMenu`, `fitColumn`, `renderColsMenu`,
`colSortVal`). `gridRowHTML` appends `gridExtraHtml(r)` to ALL three row kinds (value on leaf tasks,
blank on group/WBS) so cell counts — and the `nth-child` hide rules — stay aligned. `extraCellVal`
reads the code value (`codeValueLabel`) or UDF (`udfFmt`). Extra columns share the resizable `--c-x`
width. **Collision-safe:** hide/rename use `colKey(c)` — built-ins keep their LABEL key (back-compat),
extras use their unique id (`code:<id>`/`udf:<id>`), so a code/UDF named e.g. "Status" can't hide the
built-in Status. Extras **default hidden** (`seedExtraHidden` + `ps_colseen`) — OPC-style deliberate
add via the Columns ▾ chooser, which now has an "Activity Codes & User-Defined Fields" sub-section
(Show all / Hide all / Reset — Reset re-seeds extras hidden). New codes/UDFs appear as columns when
their editor modal closes (`closeCodes`/`closeUdf` → `renderHeader`+`renderGrid`). Verified in a node
harness (collision-safety + hide-index alignment). NOTE: the Excel export still uses its fixed header
set — extra columns are grid-only for now.

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
