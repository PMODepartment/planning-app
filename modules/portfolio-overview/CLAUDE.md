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

## Milestone calendar (2026-08-26) — fmlozano

Owner: *"For portfolio dashboard, let's have a calendar view of the milestones as well."* A sixth
tab, **Milestones**, scoped by the same project filter as every other tab. **No migration** — it
reads `project_schedule` for the scoped projects.

**A month grid with an agenda under it.** Chips sit in day cells colour-coded achieved / overdue /
due; month arrows and a Today button move the window; clicking a chip opens the milestone with its
slip against baseline. Filters are project, state and a programme-milestones-only toggle. The KPI
band reads Milestones · Overdue · Next 30 days · Achieved · Undated.

⚠️ **A milestone is `activity_type ILIKE '%milestone%'` OR `program_milestone = true`, matched
server-side.** Both, because the two disagree in the real data: P6 exports type them (`Start
Milestone` / `Finish Milestone`) while the flag is set by hand here, and either test alone silently
drops a whole class of them. The `ILIKE` also catches the `Milestone`/`milestone` casing both spellings
appear in.

⚠️ **`PDb.selectAll`, never a bare select.** Milestones across a whole portfolio pass PostgREST's
1000-row cap, and a truncated read would report a project as having no milestones this month — a
silent wrong answer on the screen whose entire job is "what is due".

⚠️ **UNDATED MILESTONES ARE COUNTED AND NAMED, never dropped.** A milestone with no date cannot be
placed on a grid, so the tempting thing is to filter it out — but "no milestone this month" and
"nobody has dated this milestone" are opposite facts, and only the second is a reason to go and
look. It gets its own KPI reading "1 (cannot be placed on the calendar)".

⚠️ **Achieved is `actual_finish`, and it is reported against BASELINE, not against the current
plan.** Comparing an actual to `end_date` measures nothing — the plan moves, so a milestone that
slipped six months reads as on time the moment someone re-baselines the date. `bl_finish` is the
committed date and the slip is the variance from it. Falls back to the planned date only when there
is no baseline, and says which it used.

⚠️ **Overdue means past AND not achieved.** A date in the past is not by itself a problem.

⚠️ **All date arithmetic is UTC string maths** (`ymd`/`isoOf`/`addDays`), never `new Date(str)`.
Local parsing of a bare `YYYY-MM-DD` is midnight UTC rendered in local time, which east of Greenwich
is the previous day — the off-by-one that has bitten this repo repeatedly (see the drawing-register
importer and the MoM aging fixtures).

⚠️ **The grid is Monday-first with a fixed 42 cells** (`lead = (getUTCDay() + 6) % 7`). Six weeks
always, so the calendar does not change height as you page through months and the chips do not jump.

⚠️ **The `+N more` overflow is a BUTTON that opens the day, not a label.** The cap is 3 chips per
cell; a "+2 more" you cannot click is the same as hiding them.

**Two real contrast failures, found by measuring rather than reading.** The first measurement was
itself wrong — it ignored alpha, so a tint of the same hue read as ratio 1.00 and looked fine.
Compositing over the actual ancestor background surfaced `.po-cal-more` and `.po-ms-prog` at
**3.40:1 dark / 4.12:1 light**, under the AA floor for small bold text. Both now use body ink (with a
red border on the programme mark to keep the brand cue): **all 13 marks pass, min 4.86 light / 4.81
dark.**

⚠️ **A pre-existing phone defect, which I made worse and therefore fixed.** An A/B against my own
added tab measured `.po-tabs` at **573px in a 375px viewport before this change** and **685px
after** — it already overflowed, and the 6th tab widened it by 112px. It was `flex-wrap: nowrap;
overflow-x: visible`, so the later tabs simply spilled off-screen unreachable.
⚠️ **It now WRAPS rather than scrolling, and that is deliberate:** `#po-projfilter-wrap` is a *child*
of `.po-tabs` and its dropdown is `position:absolute`, so an `overflow-x` scroller here would
establish a clipping context and cut the project filter's own menu off — the exact trap the module
topbar hit in the 2026-07-24 part-6 pass. The filter takes its own full-width row. Measured after:
strip **355px**, all 6 tabs on screen over 2 rows, 44px targets, dropdown clipped by nothing.

**Verified in a browser harness against the shipped markup and CSS**, at a 375px layout viewport and
at 1280: 42 cells in a 7-column grid, Monday first / Sunday last, today highlighted; KPIs read
`12 / 1 overdue / 7 next-30 / 2 achieved (1 late) / 1 undated`; the `+2 more` overflow opens and
shows all 5; an empty month says *"Nothing in November 2026 — use the arrows, or Today, to move."*;
the agenda's first row reads `2026-08-11 | One Portwood Residences | Topping Off — Tower 1 program |
Construction | Achieved planned 2026-08-06 | +5d`. Desktop confirmed byte-for-byte unchanged
(`nowrap`, one row, 38px tabs, filter right-aligned, no page scroll). Inline script parses, CSS
braces balanced, **0 functions lost / 21 added**, and the BOQ (112), PMI (82) and push (22) suites
are still green.

⚠️ **Not verified signed in** — the anon key has no grants on `project_schedule`, so the query
itself is exercised against a fixture, not against real data. The `.or()` filter string in particular
is untested against PostgREST.
⚠️ **This module's `index.html` is NOT cache-busted** — it is not in the `MODULES` registry and all
five hrefs to it are plain links, so `MODULE_V` does not reach it. **Hard-refresh once after the
deploy** or the new tab will not appear.

### 2026-08-27 — "Parent project": AVR101 + AVR102 consolidate without becoming one project

Owner: *"Let's just consolidate the two into a portfolio view… similar to how procurement dashboard
works."* Avesta Residences is bought as **AVR101** (Tower 1 and General Requirements) and **AVR102**
(Towers 2-7). Both are real, separate projects here — and in Procurement and Engineering, which is the
constraint that decided the design.

⚠️ **A ROLLUP, NOT A MERGE, and that is the whole point.** Folding them into one Planners project holding
two `packages` rows is what produced the `AVR101 › {AVR101, AVR102}` nesting the owner reported, and it
breaks the cross-app link: `push-packages` resolves **one** downstream project per Planners project
(`cash_flow_settings.wpm_project_id`), while WPM and Engineering each hold AVR101 and AVR102 as their own
projects. Keeping the rows separate keeps that 1:1 intact and costs no data change.

**Ported from `wpm/index.html`** (`_progKey` / `_progLabel` / `_progTotals`) rather than re-invented — the
Procurement dashboard hit this first and its answer is already the one the buyers read.

- **`Group by → Parent project`**, alongside Group Head / Status / None. The key is the **leading letters
  of the project code** (AVR101, AVR102 → AVR), overridable by a `program` column if one is ever added.
  ⚠️ Not a guess: it is the convention every id here already follows (AVR, BAU, GPR, SLN, SLT), so it
  needs **no data entry** to start working, and a project with a unique prefix forms a group of one that
  reads exactly as it does today.
- **The group is named by the words its members' names actually share** — "Avesta Residences", not "AVR".
  ⚠️ Falls back to the code when they share fewer than 3 characters, which is the honest answer for an
  accidental prefix collision; inventing a shared name for two unrelated projects would be worse than
  showing the bare code.
- ⚠️ **The key groups, a separate function names.** Collapse state and sorting stay on the KEY, so
  renaming a project never loses a collapsed group.
- ⚠️ **GROUP PROGRESS IS WEIGHTED BY ACTIVITY COUNT, never a plain mean** — the single number that makes
  this rollup worth having. AVR101 carries ~4,393 activities and AVR102 far fewer; averaging 60% and 10%
  to **35%** describes no real project, where the weighted answer is **58%**. Same principle as WPM's note
  on award rate: *"a 2-WP package at 100% and a 200-WP package at 10% is not 55%."* Falls back to the
  unweighted mean only when no member reports a count, and the cell's tooltip **says which method it
  used** rather than presenting the two alike.
- **The project filter groups too**, so the consolidation reaches past the overview table: ticking
  **Avesta Residences** puts both packages into the S-curve, Cash Flow, Equipment, Milestones and
  Resources tabs at once. The parent checkbox is tri-state; searching "Avesta" keeps AVR102 even though
  its own name reads "Towers 2-7". ⚠️ A program of one renders **flat, with no parent header** — a
  hierarchy above a single project is the same invention this change exists to remove.
- **The label answers "what am I looking at?"** — one whole parent selected reads *"Avesta Residences
  (2 packages)"*, not *"2 projects"*.
- **The Excel export carries a `Parent project` column** so a pivot consolidates the same way.
  ⚠️ Computed over the whole portfolio, not the filtered list, or a filter hiding AVR102 would rename
  AVR101's parent to AVR101's own title.

**Verified 23/23 in Node against the shipped functions** (extracted from this file by brace-matching, not
re-typed): the AVR pair keys together; `program` overrides the prefix; the shared-name label, its
punctuation trim and its collision fallback; weighted 58% vs the naive 35%; a project with no progress
excluded rather than counted as zero; group ordering and membership; all four filter-label states.
Group-header and checklist markup rendered and inspected.

⚠️ **Not clicked through signed in** — the app is auth-gated and this session had no credentials. Class
audit clean (`po-pf-prog` / `po-pf-child` / `po-pf-count` all defined); the only undefined classes are the
pre-existing `po-scope` and `po-tablecard`.
