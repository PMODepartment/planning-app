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
- **Cost Loading tab** — WBS, Activity Name, Planned Cost, Actual Cost, Earned Value,
  Cost Variance, CPI, % Complete — with TOTALS row

**KPI cards:** Overall % Complete, Completed count, In Progress count,
Planned Cost / Actual Cost, CPI (green/red), SPI (green/red)

**Filters:** Status, Activity Type, text search across WBS / ID / Name / Responsible Party

**Modal fields:** WBS Code, Activity ID, Activity Name, Activity Type, Status,
Planned Start, Planned Finish, Actual Start, Actual Finish, % Complete,
Responsible Party, Planned Cost, Actual Cost, Earned Value, Predecessors, Remarks
