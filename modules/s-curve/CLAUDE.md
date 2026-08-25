# Module: s-curve

> **Claude / developer: read this first.**
> 1. Read `../../MODULE_CONTRACT.md` and `../../CONTRIBUTING.md` (NOT auto-loaded).
> 2. This module is **S-Curve** (Phase 2). Your DB table is `s_curve`
>    (defined in `../../supabase-schema.sql`; starter columns only — extend as needed).
> 3. Best reference to copy: **risk-register (plain CRUD; render a cumulative planned-vs-actual line chart)**.
> 4. Work only inside this folder, on branch `module/s-curve`, then PR to `main`.
> 5. Update this file as you build.

## Status
- [ ] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [ ] Copied a reference module as the starting point
- [ ] CRUD implemented (add / edit / view / list / delete)
- [ ] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [ ] `Fmt.esc()` on all user text injected into HTML
- [ ] `enabled: true` set in `assets/js/config.js`
- [ ] PR opened into `main`

## Uniform toolbar / top bar (2026-07-17)
Brought the module's chrome in line with the rest of the suite (Progress Photos / Drawing
Register / Cash Flow / Project Schedule) — the shell rules are deliberately identical; keep
them in sync.
- **Everything moved into the topbar.** Was: a titled topbar + a separate body `.sc-controls`
  row (project select · Refresh · Forecast finish · Show-table). Now: back button (36×36
  square) · **titled with the `trendingUp` brand-red icon** · **project selector in the topbar**
  (borderless until hover, `.sc-project`) · a tool cluster beside the profile
  (`.sc-topbar-tools`) holding the Forecast-finish control + a `.sc-tb-sep` divider + **34×34
  icon-only** Show-table and Refresh buttons · `#user-bar` with the standard left-divider · the
  34×34 theme toggle. `.sc-controls` is gone.
- **Show-table is now icon-only** (was relabelled "Show/Hide data table" text): it toggles
  `.is-active` (brand-red fill) + its `title` instead of rewriting its label.
- Title collapses to icon-only < 820px and the Forecast label hides (input stays); no page
  h-scroll. Pure chrome — the S-curve compute/render logic is untouched. No shared-asset
  changes, so no `?v=` bump.
- Harness-verified (real markup+styles+inline script pulled from index.html, stubbed
  auth/DB/schedule; gitignored `_ui_test.html`, deleted after use): topbar child order
  back·title·project·tools·user-bar; modback 36×36, tools 34×34, title icon `rgb(238,49,36)`,
  project borderless at rest → bordered on hover, user-bar 10px/1px left divider; table toggle
  reveals the 2-row data table with brand-red active fill and stays icon-only; KPIs+chart still
  render; dark mode + no h-scroll. Screenshots impossible (compositor stalled in this env).

## Forecast row in the data table (2026-07-17)
The data table showed only Planned % and Actual %; it now also carries a **Forecast %** row —
the same forecast the chart's red dashed line draws, sampled at each month end.
- Computed once in `compute()` as `forecastC` (units/month), so chart and table share one source.
  It follows the remaining plan's shape, time-stretched to the forecast finish (`fc`, SPI-based
  or the pinned override), rising from the actual point at the data date up to 100% at `fc`.
- Rendered as a third `<tr>` (`.sc-fc-row`, brand-red italic) **only when a forecast exists**
  (project not complete + remaining planned work). Months before the data date show "—".
- The final month's cell can read ~99.9% rather than exactly 100% — it samples at month-end and
  the forecast finish usually lands a few days into that month; truthful, matches the chart which
  lands on 100% at `fc` itself.
- Harness-verified (real markup+styles+inline script from index.html; stubbed auth/DB with a
  schedule straddling the data date so a forecast exists): rows = Planned/Actual/Forecast %;
  forecast dashes before the data date then climbs monotonically 53.2%→99.9%, one value per month
  column, red + italic; row is absent when there's no forecast (guarded by `hasForecast`).

## Live collaboration + offline (2026-07-27) — fmlozano
S-Curve is a **read-only** analytics view derived from `project_schedule`, so it gets **presence +
live-refresh + offline read-cache — no editing cursor** (nothing to edit here).
- **Presence:** `joinCollab()` (`key = scurve:<pid>`, table `project_schedule`) after every load /
  project switch; avatars in `#sc-presence`.
- **Live:** subscribing to `project_schedule` changes → a **debounced `load()`** (400ms coalesce) so a
  burst of schedule edits (bulk import / global change) triggers one recompute, not thousands.
- **Offline:** `load()` caches `{agg, rows}` under `sc:<pid>` and, on a failed fetch, renders the
  last-cached curve. The forecast pin (localStorage) still applies offline.
- **Migration:** none of its own — the live stream needs `project_schedule` in the realtime publication
  (`2026-07-26-realtime-collab-project-schedule.sql`). Presence + offline work without it.
- Verified: inline script parses (`node --check`-equivalent vm compile). Live verification pending.
  Assets: `offline.js?v=20260726d` + `collab.js?v=20260727a`.

## Notes
(Record decisions, columns added via `alter table ... add column if not exists`, etc.)

## Cost Loading feeds the curve: a COST basis alongside the duration one (2026-08-25) — fmlozano
Owner: *"the process of cost-loading… should translate or link to the s-curve module. based on the
cost-loaded activities and in relation to the schedule."*
- **The link is one column, not an integration.** The Project Schedule's Cost Loading writes
  `project_schedule.planned_cost`; this module now offers a **Duration | Cost ₱** weighting switch and,
  on Cost, weights every activity by that figure instead of by its duration. No export, no second
  store, no sync job — load the cost there, switch the weighting here.
- **The maths is the same curve with money as the weight**, so planned/actual/forecast, SPI and the
  data-date line all keep working:
  - planned value at D = Σ (activity cost × how much of its planned span has elapsed by D)
  - earned value at D = Σ (activity cost × % complete × how much of its ACTUAL span has elapsed)
- ⚠️ **Straight-line spread inside an activity**, exactly as the duration curve does it. A cost-loaded
  activity carries no cost profile of its own; any other shape would be invented.
- ⚠️ **Unpriced activities contribute NOTHING and that is stated, not hidden.** They are unpriced, not
  free. The KPI reads *"₱4M on 2 of 3 activities"* and the note names the remainder — a curve built
  from a third of the schedule's money looks exactly like a complete one, and that is how a planner
  ends up presenting one.
- ⚠️ **"No cost loaded" is its own empty state**, not "no dated activities" — the schedule is fine, the
  exercise simply has not been done; the message names the way out (Project Schedule → Cost Loading)
  and points out that Duration weighting works right now.
- ⚠️ **The cost basis deliberately SKIPS the `schedule_scurve_agg` RPC.** That aggregate is
  duration-only by construction (pre-summed month buckets, no money), so the cost path pays for the
  per-row fetch. Serving a cost curve from a duration aggregate is how a chart ends up labelled in
  pesos while plotting days. Switching *to* Cost therefore re-loads; switching back is a repaint.
- ⚠️ **Duration stays the default, and the choice is remembered PER PROJECT** — one project is
  cost-loaded and the next is not, and a global preference would open the second on an empty money
  curve.
- ⚠️ On the cost basis the KPI headline stays a **percentage** and the pesos go in the subtitles: the
  chart is a percentage-of-total curve either way, and a peso headline would make the neighbouring
  "Schedule Variance … pp" read as money too.
- Verified by executing the SHIPPED `costSeries`/`compute`/`peso` against a stub project (₱1M activity
  100% done, ₱3M activity 25% done, one unpriced, data date 25-Aug-2026): total **₱4,000,000**,
  coverage **2 of 3**, overall **43.8%** (₱1.75M earned of ₱4M), earned-to-date **₱1,750,000**,
  planned-to-date **₱2,010,000**; the duration basis still returns 725 day-units and 56.2% (untouched);
  everything unpriced → the `noCost` state, not a blank chart. Inline script parses. ⚠️ **Not verified
  signed-in.** Delivered as `?v=20260825r`.
