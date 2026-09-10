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

## Two sources, a periodic chart, and a trade filter (2026-09-10) — ethanrobles10

Owner: *"currently there is cumulative. I want you to add a periodic bar chart, and then a mode at
the top to filter the trades being displayed. And then later on a filter for General Requirements
vs Measured Works."* Then: *"i want you to provide 2 options for the users, Manual intervention or
automatic detecting … For the planned, this should be defined in the planning phase of the project,
and will be locked as the project is actualized. For the actuals, allow users for manual
intervention. For the forecast, allow users to input POCs manually for the following months per
trade. For automatic detecting, it should be linked to the per trade accomplishment declared in the
schedule."*

### 1. The periodic bars

⚠️⚠️ **Derived, never fetched or re-summed.** Period *n* = cumulative *n* − cumulative *n−1*, off
the arrays the engine already returns. Two consequences worth stating: the bars **always add back
up to the line** (they cannot drift from it, because they *are* it), and there is no second pass
over the schedule to keep in step with the first.

- ⚠️ **A second y-axis, and it is not a decoration.** A monthly increment on a 3-year programme is
  a few percent of the total, so plotting the bars on the 0–100% cumulative axis leaves a row of
  stubs along the floor of the chart — correct and unreadable. They are scaled to the largest
  period in the series, the right-hand axis states that scale, and a note says which axis to read
  them against: a bar read against the wrong axis is out by an order of magnitude and nothing
  about the picture reveals it.
- ⚠️⚠️ **The data-date month has no actual bar in Automatic mode, and finding that took looking at
  the chart rather than testing it.** The bar reached **97% of the axis on a project that had done
  35%** — it claimed almost the whole job was built in one month. The cause is in the engine and is
  deliberate there: months before the data date are *modelled* (`actualAt(monthEnd)`) while the
  data-date month is *anchored* to the true recorded `overallDone`, so the step into it absorbs the
  entire discrepancy between model and reality. That is exactly what the cumulative line should do
  and is **not** a month's production. Manual mode keeps its bar, where that figure is one a
  planner typed for that month.
- ⚠️ `padR` 44 → 56: measured in a browser, the axis title rendered as *"per mor"* — clipped by the
  viewBox, which does not scroll and gives no hint anything is missing.

### 2. The trade filter, and General Requirements vs Measured Works

⚠️⚠️ **The trade is `work_type`, and that is the shell's own convention, not a new one.** The
dashboard's programme panel already groups this same table by `work_type`, so a second rule here
would put two screens' trade lists at odds over one schedule. Project Schedule's `workOf()`
additionally walks the WBS tree when the field is blank; **that walk is deliberately not copied** —
~30 lines of tree ancestry in a second module is what this module's own engine comment forbids, and
it would need the whole `wbs_nodes` table fetched alongside the schedule. The cost is stated rather
than hidden: untraded activities land in one honest bucket, the bar counts them, and the note names
where to set the field.

- ⚠️ **`UNTRADED` passes neither side of the split.** An activity whose trade nobody has set is
  *unknown*, not measured — folding it into Measured Works would put unclassified work inside the
  figure a claim is built on. The count is stated, so a planner who cannot reconcile Measured Works
  against the whole project can see why instead of hunting for it in the schedule.
- ⚠️ **General Requirements is matched, not listed.** Preliminaries arrive spelled a dozen ways; a
  hard list would silently drop a differently-spelled project into Measured Works, overstating the
  one number this split exists to isolate.
- ⚠️⚠️ **The RPC aggregate is refused whenever a filter is on.** `schedule_scurve_agg` returns
  pre-summed *month* buckets with no trade in them, so serving a "Structural only" curve from it
  would draw the whole project's curve under a Structural heading. The fast path is kept for the
  view that can use it and the row fetch is paid for the first time a filter needs it — the
  alternative (always fetch) costs every planner a 16k–40k-row download to serve a filter most
  never touch.
- ⚠️ The card **heading names the filter**. Screenshots of this card end up in reports, so the
  scope has to travel with the picture.

### 3. Manual vs Automatic

**Automatic** is what this module already was, now per trade. **Manual** is the planner's own
monthly S-curve — the curve that on a real job is negotiated and submitted before the schedule is
fully loaded, and reported against monthly.

⚠️⚠️ **The two are never merged and never averaged.** A curve is either the schedule's or the
planner's; the mode is stated in the basis note *and* in the heading. A manual curve and a
schedule-derived one look identical on a chart and mean completely different things — one is what
the job is doing, the other is what somebody typed.

- ⚠️⚠️ **`pct` is periodic, not cumulative** (the migration carries the three reasons). The sheet
  shows the running cumulative beside every entry, so nobody adds up in their head, and the column
  total is a **checkable invariant the sheet checks on screen** — a periodic column summing to 97%
  is a typo the sheet can flag; a cumulative column ending at 97% is one you have to hunt for.
- ⚠️⚠️ **A trade is worth its share of the schedule, never an equal share.** A project curve cannot
  be the *average* of its trades' POCs — a trade that is 2% of the job would move the project as
  much as one that is 40%, and the result is wrong in a way that looks entirely plausible.
  Asserted: a trade weighted 100/1000 declaring **100% of itself moves the project 10%**; add a
  900-weight trade at 50% and the project reads **55%**. The weights come from the schedule even in
  Manual mode — the manual numbers are the *progress*, the schedule is still the *scope*.
- ⚠️ **A trade the schedule no longer knows carries weight 0 and is named on screen**, not dropped
  and not given an equal share, which would invent scope. A trade renamed in the schedule keeps its
  entries here.
- ⚠️ **Which cells are editable is a rule, not a style.** Planned is open only while the plan is
  neither locked nor overtaken by actuals; actual is editable to the data-date month; forecast only
  after it. Every refusal is explained where it is refused — a read-only cell with no reason is the
  first thing reported as broken. Read-only cells are **plain figures, not disabled inputs**: an
  input with disabled styling still reads as "type here, but not now".
- ⚠️ **The lock has two halves.** *Actualized* is a fact about the schedule and needs no storage
  (and a planner must not be able to unlock the baseline by deleting their own actual entries);
  *locked* is a recorded decision, with who and when, because a baseline that can be unlocked is
  only trustworthy if unlocking leaves a mark.
- ⚠️ **One trade at a time, months down the page** — not a trades × months matrix. Eight trades on
  a 3-year job is 288 cells, and with three kinds per cell 864: a grid nobody can fill in without
  losing their place, scrolling in both directions on any screen.
- ⚠️ Mode is remembered **per project** (one job is manually curved, another is not) and per user;
  the sheet itself is per project in the database, because two planners must see one manual curve.
- ⚠️ There are no `lock` / `unlock` icons in `assets/js/icons.js` and `Icons.hydrate` leaves an
  unknown key as an empty span, so the banner uses `signature` / `pencil` — checked against the key
  list, not assumed. A 15px gap where an icon should be is invisible in a diff.

### 4. Verified

**34 assertions, 0 failing**, sliced out of the shipped file and executed — the periodic derivation
(including that a dip clamps at 0 and that nulls stay null), the GR keyword match, the untraded row
passing neither side, the duration and cost weights, both halves of the lock rule, the weighted
roll-up above, and the actual/forecast boundary (an actual entered for a future month is kept but
not drawn; the forecast continues **from** the actual point, 18% → 54%, not from zero).

**Rendered in a real browser** against this module's own inline style block and the app's real
`dashboard.css`, light and dark: the shipped `renderChart`, `renderFilters` and `renderManual` on a
six-trade fixture — 54 bars, 3 lines, 7 chips, a 24-row sheet with **24 editable and 48 read-only
cells, which is exactly what the editability rule predicts** (planned locked by actuals = 24
read-only; actual editable for 6 of 24 months; forecast for 18). Chip weights sum to 100%. Both
defects above were found by looking at that render, not by testing it.

⚠️ **Not verified against the database.** The anon key carries no grants, so nothing here has
written a row: the two new tables, the upsert, the lock write and the 42P01 fallback are
code-and-migration, not observed behaviour. Until `migrations/2026-09-10-scurve-manual-poc.sql` is
run, **Manual mode says so and names the file**, and Automatic is untouched.
