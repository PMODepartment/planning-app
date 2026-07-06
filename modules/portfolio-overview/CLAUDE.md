# Module: portfolio-overview

Cross-project **Portfolio Overview** dashboard (Phase 2). Unlike other modules it is
**project-agnostic** — it reads ALL projects the signed-in user can access (RLS-scoped) plus
the workspace tree, and does not use `pd_project`.

## Data
- `PDb.getProjects()` + `PDb.getWorkspaces()` only — no own table, no migration.
- Uses the same Workspace→Program→Group-Head tree model as `dashboard.html`
  (`ancestorOfType`, `groupHead`, `childrenMap`, `pathOf`).
- Reads existing `projects` fields: `status, workspace_id, group_head, original_budget,
  estimated_cost, schedule_progress, schedule_start/finish, forecast_start/finish,
  start_date/end_date` (the schedule_* rollups are written by the project-schedule module).

## Contents
- **KPI cards**: Projects, Active, Avg Schedule %, Original Budget, Estimated Cost, Budget
  Variance (est−orig), Over Budget count, Behind Schedule count.
- **Schedule Health donut** (SVG, no libs): On Track / Behind / No Schedule.
  `health(p)` = no schedule_progress → none; slipped vs baseline finish OR overdue-and-incomplete
  → behind; else on track.
- **Budget-by-group bars** (SVG): Original vs Estimated per group, top 8 by estimated.
- **Grouped, sortable portfolio table**: group by Workspace / Program / Group Head / Status /
  None; per-group subtotals + grand total; sort any column; collapse groups; click a project
  row to drill in (sets `pd_project`/name/workspace → `dashboard.html`).
- **Filters**: status, behind-schedule-only, text search. **Export** to Excel.

## Discovery
- Registered in `assets/js/config.js` MODULES (`enabled: true`) → appears on the Project Home
  module grid.
- Top-level nav link added in `projects.html` (sits with "All Projects").

## Notes
- Pure vanilla + shared APIs (AppAuth/PDb/Fmt/UI/Icons); XLSX from CDN for export.
- No schema changes.

## Project selector filter (2026-07-06)
The single "All projects / one project" dropdown became a **multi-select checklist**
(search + Select all/Clear); KPIs/donut/bars/table all narrow to the checked set (`projSel`
map; empty = all projects). Verified in a stubbed harness.

## Cross-project S-Curve + Cash Flow tabs (2026-07-06)
Added a tab strip (**Overview / S-Curve / Cash Flow**) above the existing dashboard, which
moved into a `#po-view-overview` container unchanged. The two new tabs are **real** cross-
project views (not just a nav shortcut) — decided after finding the actual data-cost tradeoffs
per module:
- **S-Curve**: fetches real `project_schedule` rows (paginated, `.in('project_id', ids)`)
  across whichever projects the Overview tab's project filter currently resolves to, and
  reuses the **exact duration-weighted math** the single-project S-Curve module computes
  with (`compute()` in `modules/s-curve/index.html`) — `project_id` doesn't matter to that
  math, so a combined multi-project activity list works without modification. Warns (toast)
  if a combined fetch exceeds 20,000 activities. **Not the vestigial `s_curve` table** — that
  table has no writer anywhere and isn't used by the real S-Curve module either.
- **Cash Flow**: fetches `cash_flow` rows across the same scoped project ids (cheap — one row
  per project per month), aggregates into monthly Planned/Actual bars + cumulative curves +
  a category breakdown table.
- Both tabs are lazy-loaded on first visit and cache by the current project-id scope; a
  Refresh button force-reloads (so changing the Overview filter while already on a data tab
  doesn't silently go stale, but also doesn't refire a heavy query on every keystroke).
- Verified in a stubbed harness (synthetic 2-project, multi-activity, multi-category fixture):
  hand-checked S-Curve math (TOT=186 duration-days, overall 33.2%, planned-to-date 57.9%,
  variance -24.7pp) and Cash Flow aggregation (₱1.15M planned / ₱990k actual across 4 entries,
  category breakdown to the peso) both matched exactly; confirmed the project filter narrows
  both new tabs identically to the Overview tab.

## Cash Flow module now real (2026-07-06)
Cash Flow was flipped to `enabled: true` in `config.js` because it stopped being a placeholder
— see `modules/cash-flow/CLAUDE.md`. This tab reads its `cash_flow` table.
