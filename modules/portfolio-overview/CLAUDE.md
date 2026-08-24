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

## Project selector moved to the tab bar (2026-07-11)
User feedback during live testing: on the S-Curve tab there was no project selector — it lived only in
the Overview toolbar, so you had to switch back to Overview to change scope. Moved `#po-projfilter-wrap`
out of the Overview toolbar into the always-visible `.po-tabs` bar (right-aligned, `margin-left:auto`),
so the same multi-select filter scopes Overview + S-Curve + Cash Flow from any tab. Handlers are keyed
by id (no JS change); the scope notes on the S-Curve/Cash Flow tabs now read "the project filter above"
instead of "set on the Overview tab". Behaviour unchanged: changing scope while on a data tab still needs
the tab's **Refresh** (cached by scope, per the 2026-07-06 note).

## Resources tab — cross-project resource demand (2026-07-11)
4th tab (Overview / S-Curve / Cash Flow / **Resources**), scoped by the same project filter. Because
`resource_assignments` can be 27k+ rows for ONE project, it does NOT fetch raw rows — it calls a new
**`portfolio_resource_summary(text[])` RPC** (migration `../../migrations/2026-07-11-portfolio-resource-rpc.sql`,
**USER MUST RUN**) that GROUP-BYs on the server and returns one compact row per resource identity
(name/type/uom) across the scoped projects: distinct projects, assignment count, Σ budgeted/actual/
remaining units, Σ budgeted/actual cost. UI = KPI row + a top-12-resources-by-budgeted-cost bar list
+ a full per-resource table with a TOTAL row. Lazy-loaded + cached by scope (Refresh button), same as
the S-Curve/Cash-Flow tabs. **Tolerant:** if the RPC isn't installed, shows a "run the migration"
nudge (verified live 2026-07-11 — tab opens, nudge shows). RPC is `security invoker` so the caller's
RLS (`resource_assignments` read = `is_approved`) applies.

## Live collaboration (presence) + offline read (2026-07-27) — fmlozano
Portfolio spans **all** projects and is a **read-only rollup**, so it gets **presence-only + offline
read-cache** — no per-project live stream (cross-project unfiltered would be broad) and no editing cursor.
- **Presence:** `PDCollab.join({ key:'portfolio', … })` with **no `tables`/`projectId`** (presence +
  broadcast only, no postgres_changes) — shows who else is viewing the portfolio right now, avatars in
  `#po-presence`. Live per-project data still arrives via the per-tab **Refresh** + the modules that
  write the rollups.
- **Offline:** the `PDb.getProjects()` + `getWorkspaces()` load is cached under `po:all`; on a failed
  fetch the last-cached portfolio renders so the dashboard still opens offline (the lazy S-Curve/Cash
  Flow/Resources tabs still need a connection).
- No migration (presence needs no server change). Verified: inline script parses. Live verification
  pending. Assets: `offline.js?v=20260726d` + `collab.js?v=20260727a`.

## Cash Flow module now real (2026-07-06)
Cash Flow was flipped to `enabled: true` in `config.js` because it stopped being a placeholder
— see `modules/cash-flow/CLAUDE.md`. This tab reads its `cash_flow` table.

## Equipment availability across the portfolio (2026-08-24) — fmlozano

A fifth tab, **Equipment**, answering the one question a project-scoped register cannot: *where is
each asset committed, and when does it come free?* No migration — it reads `equipment_items` +
`equipment_loading` for the scoped projects.

**The month grid is the answer, and availability is its negative space.** One row per asset, one
cell per month, coloured by the project that has it; an empty cell means free. A KPI band, four
availability filters (All / Free now / Free within 3 months / Double-booked), category + search, an
asset register below it, and an Excel export that emits **the same picture** (a column per month) so
the sheet and the screen cannot tell different stories.

⚠️ **The asset identity is `equipment_items.code`, and that column is unique per PROJECT — which is
exactly why the same code on two projects is reported, not judged.** It is either one asset that
moved between them or two projects that both numbered their first crane TC-01, and *nothing in the
data distinguishes those*. So a month where two projects both plan one code is marked "planned on two
projects" with both names in the tooltip; calling it an error would be a guess presented as a fact.
Codes are merged case- and space-insensitively, because "TC-01" and "tc-01" are the same asset to
every human reading the sheet.

⚠️ **Only PLANNED quantities drive the grid.** Actuals say where an asset *has been*; availability is
a forward question. A planned quantity of **0 or blank is not a commitment** — those are how the
Equipment Loading module records "not reported" and "none on site", and treating either as a booking
would report a free asset as busy.

⚠️ **`PDb.selectAll`, never a bare select.** One row per equipment per month across a whole portfolio
passes PostgREST's 1000-row cap easily, and a truncated read here would report an asset as free in
months it is actually committed — the most dangerous failure this screen has, and a silent one.

⚠️ **"Free from" is read off the same grid the planner is looking at**, so the number in the table and
the picture in the strip can never disagree. This month is always on the axis even when nothing is
committed near it — "free now" is a claim about the present and needs the present on screen to be
checkable. The window is capped at 48 months and **says so** when it truncates.

⚠️ **Project colours are keyed by project id, not by position in the filtered list** — otherwise
every filter change repaints the grid in different colours and the legend has to be re-read.

**Four real defects found by measuring, none of which would have shown up in a code read.**
1. The inline `style="background:…"` shorthand **reset `background-image`**, so the diagonal hatch
   marking a double-booked month never rendered — measured as `background-image: none` on a cell that
   should carry it. It is `background-color` now.
2. `min-width:100%` with auto table layout let the browser widen the columns past their declared
   widths; with `table-layout:fixed; width:100%; min-width:max-content` the strip fills the card
   (it previously huddled in ~610px of a 1400px card) and still scrolls when the portfolio is long.
3. The brand red on the red tint used by the code chip reads **3.60:1** — under AA at 12px bold. Ink
   on the same tint is **14.25:1 light / 13.45:1 dark**, and a red left border keeps the brand cue
   (the same treatment as the PRC group-head chip).
4. In dark mode the "free now" green read **2.61:1** and the flag colour **4.02:1**. The dark
   overrides take those to 7.26 and 6.12. A single colour for both themes cannot satisfy either.

**Verified** — 24 checks executing the shipped `eqBuild` / `eqVisible` / `eqColorFor` (sliced from the
file, never reimplemented): codes merged case-insensitively into one asset, sequential months across
two projects **not** flagged while the same month **is**, zero and blank ignored, a registered but
unplanned asset carrying no months, an uncoded item kept + flagged + sorted last, "free from" landing
on the first uncommitted month, this month always on the axis, a 12-year span capped at 48 with the
truncation reported, and every filter. Plus a real browser against the shipped CSS at 1440 and a
375px layout viewport: 23 rows × 13 months, sticky asset column and header, the hatch present, all
five KPIs, 0 page horizontal scroll at either width, the grid and the register each scrolling inside
their own card, every control ≥44px on the phone, and light/dark contrast at **min 5.37:1**.

⚠️ **Not verified signed in** — the anon key has no grants on the equipment tables, so the
cross-project read itself is untested against real data.
⚠️ **This module's `index.html` is NOT cache-busted** (it is reached by a plain sidebar href, not
through `MODULE_V`), so hard-refresh once after the deploy.
