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

## A Manual data tab, a period lens, and a chart you can interrogate (2026-09-10) — ethanrobles10

Owner: *"add a tab wherein users are able to put the data manually. And also for the landing page of
the s-curve, allow users the option to view monthly, quarterly, yearly etc. and when hovering over
data, pls show the contents like POC, amount. And then when clicked, what are the details in terms
of gen req, site works, structural works, etc."*

### 1. The sheet becomes a screen

The manual sheet shipped earlier today as a card **stacked under the chart**, gated on the chart's
own `mode`. Two consequences the owner is right about: it was a scroll away from the control that
opened it, and entering next quarter's forecast meant first switching what the chart was claiming.

It is a tab now — `Curve` | `Manual data` — through **`UI.tabsToDropdown`, the app's own
convention**, so above 700px it collapses into the same compact dropdown fourteen other modules
use and `pd-tabsrc` puts it under the shared pre-JS boot-flash rule. A hand-rolled pair of buttons
would have been a fifteenth navigation idiom.

- ⚠️ **The tab and the mode are deliberately independent.** The tab is where the planner is; the
  mode is where the curve's numbers come from. Coupling them would silently change what the chart
  asserts the moment somebody opened the sheet.
- ⚠️ **So the sheet says whether the curve is actually reading it** — *"The Curve tab is drawing
  from the schedule, not from this sheet"*, with a button that switches the source. Independent
  controls are only safe if the screen states the combination; filling this in for an hour and
  discovering afterwards that the chart never moved is the failure that line prevents.
- ⚠️ The sheet computes its **own** view rather than taking the caller's `d`: on the Curve tab that
  argument is the automatic curve, and laying a manual sheet over automatic months would put the
  right rows against the wrong data-date boundary.
- ⚠️ The registration follows risk-register's documented **third-`DOMContentLoaded`** pattern, and
  `initModuleTopbar()` is deliberately *not* called early — that was tried there and reverted
  because it breaks `theme.js`'s own topbar injection.

### 2. Monthly / quarterly / yearly

⚠️⚠️ **The engine stays monthly and is not touched.** `PDScurve.compute` walks the schedule once;
re-running it per granularity would be three walks of a 16k-row schedule to answer one question and
three chances for the three views to disagree. `lens()` is a **lens over that one result**, so a
quarter is by construction the sum of its own three months.

- ⚠️⚠️ **Cumulative takes the LAST month of the bucket, periodic SUMS them.** Getting those the same
  way round is the whole correctness of the file: a quarter's cumulative is where the curve has
  *reached* by the end of March, not Jan+Feb+Mar added up — which would be about triple and would
  sail past 100%. Asserted both ways on a linear fixture (Q1 cumulative 300, Q1 periodic 300,
  Q2 cumulative 600, Q2 periodic 300), plus the invariant that the periodic buckets sum back to the
  final cumulative.
- ⚠️ **The bucket holding the data date reads its actual at `ti`**, not at the bucket's last month:
  the engine anchors that one month to the true recorded total and zeroes everything after it, so
  the bucket's last month would report **0% for the quarter we are standing in**.
- ⚠️ **A bucket entirely in the future carries `null`, not 0** — the engine's zeroes there mean "not
  yet", and a 0 would read as a quarter of no work.
- ⚠️ **Partial buckets are honest, not padded**: a November start gives a two-month Q4 and a
  two-month first year. Asserted, because padding to three would invent a month of nil progress.
- ⚠️⚠️ **The x-axis stays in MONTH space at every granularity**, and that decision is what kept this
  small and the forecast correct. A quarterly view draws fewer points on the same continuous
  timeline. So `x(i)` is still one mapping and the SPI forecast S-curve — plotted from *dates* —
  needed no change at all. Re-basing the axis per granularity would have meant a second date
  mapping, and the first disagreement between them is a forecast line that misses the finish it is
  drawn to.
- **The data table reads the same lens**, never its own bucketing: a quarterly chart over a monthly
  table is the shape of bug that gets believed, because both look plausible. It also gained the two
  periodic rows, which are the figures a monthly table could not show.

### 3. Hover: POC and amount

One transparent **band per period** spanning the full plot height, not the marks themselves —
hovering a 2px polyline means hunting for the pixel, and the readout is about the *period*, which is
no single mark's property. Boundaries are the midpoints between bucket centres so the bands tile
with no dead gaps.

⚠️⚠️ **POC and amount are the same curve on two different weightings, and that is the difficulty.**
On the cost basis `d.TOT` is already pesos; on the **duration** basis it is days, and 40% of the
duration is not 40% of the money. So a **companion cost series** is computed alongside — the same
`PDScurve.compute` on the same rows at `basis:'cost'`, not a second engine.

- ⚠️⚠️ **Aligned by month key, never by index.** The two results can have *different lengths*: the
  forecast finish is SPI-derived per basis, so a project behind on duration and ahead on cost
  produces two domains and index *i* is two different months in each. Reading it positionally would
  put March's money under June's progress and look entirely plausible. Asserted: a month outside the
  companion reads `null`, never index 0.
- ⚠️ **Absent, not faked.** No rows loaded (the RPC fast path holds none) or nothing cost-loaded →
  the readout shows the POC and says which of those two it is, rather than printing pesos derived
  from days.
- ⚠️ The variance is shown **only where both sides exist** — a future period has a plan and no
  actual, and "0.0 pp behind" there reads as a project on track.

### 4. Click: the trade breakdown

⚠️⚠️ **Each trade is its own curve, and it has to be.** A trade's % complete is a share of *its own*
scope; taking the project's figure and splitting it by weight would report every trade at the same
percentage, which is the one answer that is always wrong.

⚠️⚠️ **Two columns that are routinely confused, and the header says so.** *Own %* is how far along
that trade is; *Points of project* is how much of the project's percentage it contributes. General
Requirements at 100% of itself on a job where it is 6% of the scope contributes **6 points, not
100** — and a reader given only the first number reads a nearly-finished project. **The points
column sums to the project's own figure, which is the check**, and it does: measured in a browser,
20.0 against the project's planned 20%, and 10.8 against its actual 10.8%.

- ⚠️⚠️ **A REAL DEFECT CAUGHT BY LOOKING AT THE RENDER, not by testing.** The amount column first
  reported `projectAmount × durationShare`. Wrong in the way that looks right: a trade can be a
  tenth of the programme's *duration* and a third of its *money*. Measured on the fixture, Structural
  Works came out at **₱585.3K where its own cost curve says ₱1.9M** — a 3× error, with the column
  total still reconciling, so nothing on screen would have given it away. Each trade now gets its
  own cost-basis series; the amounts sum to the project's ₱2.8M as they should.
- ⚠️ **A bucket past a trade's own programme carries its last value, not 0** — a trade that finished
  in Q1 must not read 0% in Q4 — and a bucket before it starts is genuinely 0. Both asserted.
- ⚠️ A trade with nothing priced shows **no amount rather than an estimate**.
- ⚠️ It is a panel **under** the chart, not a modal: the question is "what is inside *that* period",
  and covering the chart hides the period being asked about. The band is the toggle, so clicking the
  open period closes it and there is no second control to find.
- ⚠️ Keyboard-reachable (`tabindex`, Enter/Space) — the breakdown is the only route to the per-trade
  figures, and a click-only control puts them out of reach without a mouse.

### 5. Verified

**37 assertions, 0 failing**, sliced out of the shipped file and executed: the bucket calendar and
its partial buckets, cumulative-vs-periodic both ways round, the data-date and future-bucket rules,
the companion's date alignment and its two absences, the per-trade shares, and the own-%-vs-points
distinction. The previous pass's 34 still pass — no regression to the manual mode or the filters.

**Rendered and driven in a real browser** against this module's own inline style block and the app's
real `dashboard.css`, light and dark, on a five-trade cost-loaded fixture:

```
period    bands  table cols  bar width  axis title   x-axis labels
month       27       28         16px     per month    2026 / 2027 / 2028
quarter      9       10         34px     per quarter  Q1 2026 … Q1 2028
year         3        4         54px     per year     2026 / 2027 / 2028
```

Hovering Q2 2026 returned planned 20%, actual 10.8%, variance −9.2 pp, in-quarter 12.5%/6.7% and
₱2.8M / ₱1.5M / ₱2.4M / ₱1.2M; a future quarter returned *"not yet"* for the actual, a forecast, no
variance and no earned amount. ⚠️ **The chart and the readout were checked against each other**: the
data-date quarter draws no actual bar *and* the readout omits the actual row — no contradiction
between what is drawn and what is said.

⚠️ **Not verified signed in.** The page parses and loads to the sign-in redirect; the tab conversion,
the hover and the breakdown were driven against a fixture through the shipped renderers, never
against a real project's schedule. The manual tables still need
`migrations/2026-09-10-scurve-manual-poc.sql`.

⚠️ Also fixed in passing, and found because a harness could not resolve it: this file had **two
arrays of month names** (`_MABBR` for the lens, `MABBR2` in the sheet). Consolidated onto one —
twelve strings in two places is one more than can be kept in agreement.

## The manual-POC migration could not run: `projects.id` is text, not uuid (2026-09-10) — ethanrobles10

Owner, running `migrations/2026-09-10-scurve-manual-poc.sql`:

```
ERROR: 42804: foreign key constraint "scurve_manual_project_id_fkey"
cannot be implemented
DETAIL: Key columns "project_id" and "id" are of incompatible types: uuid and text.
```

⚠️⚠️ **`projects.id` is `text` — it is the project CODE (`AVR101`, `OPW101`), not a surrogate uuid**
(`supabase-schema.sql:33`). I declared `project_id uuid` on both new tables. Every project-scoped
table in this schema already says `project_id text references projects(id)` — **26 of them** — so
this was a convention that was there to be read, and I wrote the type I expected instead of the one
the schema has.

⚠️ **The module's own JS was already correct**: `pid` comes from `sessionStorage.getItem('pd_project')`
or `projects[0].id`, which is that text code, and it writes `project_id: pid`. Only the DDL was
wrong, so nothing in the module needed changing — which is also why no verification I ran could have
caught it. Every check was against the shipped JS; the SQL is only exercised by being run.

⚠️ **Nothing was created by the failed run.** The FK is inline in the `create table`, so the
statement fails atomically, and the SQL editor wraps the file in one transaction. The corrected file
is safe to run as-is.

### Three things fixed while in there, two of them the same class of omission

- ⚠️⚠️ **A GUARD, because `if not exists` IS A SILENT NO-OP ON A WRONG-TYPED TABLE.** If any attempt
  had left `scurve_manual.project_id` as uuid, every statement below it would have been skipped
  without complaint and the module would have gone on failing with nothing to explain why. It now
  reads the column's type out of `information_schema` and `raise exception`s with the two `drop`
  statements to run. A migration that cannot apply should say so, not do nothing quietly.
- ⚠️⚠️ **THE GRANTS WERE MISSING, which is the exact defect the root changelog records for the
  stakeholder-directory migration on 2026-09-09.** A policy is not a grant: RLS *filters* rows for a
  role that already holds the table privilege, so without `grant select, insert, update, delete …
  to authenticated` every query would have failed with *"permission denied for table
  scurve_manual"* — which reads like an RLS problem and is not one. I wrote the RLS half and the
  policies and left out the two lines every sibling migration in the folder carries. **The next
  error the owner would have hit after fixing the type.**
- `updated_by` / `planned_locked_by` now carry `references users(id)`, matching the `created_by`
  shape the other 26 tables use. Nullable, so a write with no session id still lands.

### Verified

Structurally, since a migration is only really verified by running it: code parens **24/24**, `$$`
delimiters **6, paired**, 2 tables, 2 grants, 2 policies, **0 occurrences of `project_id uuid`**, 2
of `project_id text`, 2 `references projects(id)`, 2 `references users(id)`, 0 NUL bytes. The
project-id type is asserted against `projects.id` in the file's own VERIFY block, which now checks
all three columns read `text` in one query.

⚠️ **Still not run against a database from here** — the anon key has no grants and there is no SQL
runner in this environment, so the owner's next run is the real test. The VERIFY block is written to
be pasted separately and answers, in three queries, whether the types match, the shape is right and
both the grants and the policies exist.

## The manual sheet becomes a matrix, with the curve live above it (2026-09-10) — ethanrobles10

Owner: *"i was thinking, what if it were the other way around. meaning the months are plotted as
columns and the trades are plotted as rows. And then while inputting, there would still be an
scurve displayed above the table."*

### 1. ⚠️⚠️ This reverses the shape I argued for yesterday, and the argument was incomplete rather than wrong

I refused a trades × months matrix in the entry above, and the reasoning was: eight trades over
three years is 288 cells, and at three kinds per cell **864** — *"a grid nobody can fill in without
losing their place"*. That arithmetic is right. What I missed is that **the third dimension does not
have to be in the grid**: Planned / Actual / Forecast is now a **mode**, so the sheet is 8 × 36 for
one kind at a time.

That is the shape of the spreadsheet a planner is copying from, and of a monthly accomplishment
submission. It is also **strictly better than the per-trade sheet it replaces** on a job the
per-trade version could not do at all: comparing two trades in the same month was two separate
screens there and is a glance here.

- ⚠️ **The matrix is always MONTHLY**, whatever the Period control is set to. The stored grain is a
  month; letting somebody type a *quarter* would mean splitting it back across three months and
  there is no honest way to choose that split. The chart above it follows the Period control,
  because reading is not entering. Said on screen, not just here.
- ⚠️ **A frozen corner, and both halves are load-bearing**: 36 columns are wider than any screen, so
  the trade name stays put while you scroll right (or you are typing into an unlabelled cell) and
  the month stays put while you scroll down. Measured after scrolling 600px: trade column pinned
  left, header pinned top, Total column pinned right, corner at `z-index: 3`.
- ⚠️ **The column footer is the project's WEIGHTED figure, not the sum of the column.** Adding six
  trades' percentages gives a number over 100 that means nothing — each is a share of a different
  scope. Weighted, it is exactly the height of that month's bar on the chart above, which makes the
  footer a cross-check between the sheet and the curve rather than a second opinion. Measured:
  typing 25% into General Requirements moved the footer 22.7% → **29.5%**, which is its 27.2% share.
- ⚠️ `manTrade` is **gone** rather than left unused — the sheet no longer has a "which trade" to
  remember, and a live-looking variable nothing reads is the next reader's wrong turn.

### 2. The curve above the sheet, and what "live" required

- ⚠️⚠️ **`computeManual` had to stop reading the saved rows.** It read `MAN.rows` — the database's
  copy — so a chart above the sheet would have sat still while the planner typed and jumped on Save.
  New `manEffective()` lays the unsaved edits over the saved rows with the same precedence
  `manValue` uses, and **every reader goes through it**, so the chart, the row totals and the column
  totals all describe the sheet as it is on screen. Asserted: a dirty cell overwrites its saved twin
  rather than being appended twice, a dirty cell with no saved row is added, and clearing the dirty
  map falls back to the saved number.
- ⚠️ **It is the SAME `renderChart` the Curve tab uses, pointed at a second host.** A second chart
  builder would be ~150 lines of axis, bar and forecast geometry to keep in step, and the first
  divergence would be a preview that disagrees with the chart it is previewing. `opts.interactive`
  is false there because the click opens the trade breakdown, which is a card in the *other* pane —
  so the hover readout is kept and its "click for the breakdown" line is dropped rather than left as
  a dead promise.
- ⚠️ Its note carries **"Includes N unsaved edits"** in the warning colour. A chart drawn from
  numbers that are not in the database must say so; a screenshot of it would otherwise assert data
  nobody has kept.
- ⚠️⚠️ **A cell edit does NOT re-render the sheet, and the matrix is what forced that.** The
  per-trade sheet re-rendered on every change because its running-cumulative column had to be
  recomputed — harmless there, fatal here: rebuilding the table drops the focus out of the cell
  being typed in and destroys PDGrid's listeners, so Tab, fill-down and paste would all die on the
  first keystroke. `manRefresh()` writes the three things that changed and redraws the chart, which
  lives outside the table. **Measured: after an edit the table node is the same object and
  `document.activeElement` is still the cell.**

### 3. ⚠️⚠️ A defect this found in what I shipped this morning: the Curve tab drew NO chart in Manual mode

`renderChart`'s manual branch set the basis note and then **`return`ed from the function**, before
any drawing. So since the manual mode shipped, selecting it left the Curve tab with the sentence
explaining the curve and an **empty plot underneath it**. Nothing errored, and the note made it look
as though something had happened — which is exactly why it survived a browser check: that check only
ever ran the automatic mode. Confirmed present in `HEAD` before touching it, not assumed.

Found by pointing the same renderer at the preview host and getting an empty element back. Now an
`if/else`: the two notes are alternatives, the drawing below is common to both.

### 4. The app's own spreadsheet layer, and a `type="number"` trap it exposed

`PDGrid` (`assets/js/xlgrid.js`) is adopted rather than re-implemented — the module now loads it and
the cells carry its two-attribute contract (`data-i` = trade, `data-f` = month). That buys
Tab/Enter/arrows, Shift+arrow selection, Ctrl+D fill-down, Ctrl+Z and **a paste of a TSV block
straight out of Excel**, which is where a monthly accomplishment sheet already lives. Measured: a
`1\t2\t3\t4` paste filled four consecutive months of the target trade. ⚠️ Its `onSet` routes through
the same `setCell` an ordinary edit takes, so a pasted value gets identical validation — a second
write path would be a second set of rules.

⚠️ It also loads it at the version the other page already uses (`?v=20260907e`), not a second one —
a shared asset on two versions is a split this repo's own audits flag.

⚠️⚠️ **And wiring the paste exposed the `type="number"` trap for the third time in this repo.** A
number input refuses anything the spec cannot parse and reads back `""`, so typing `12,5` gave an
empty string, `setCell`'s comma handling never saw a comma, and the value vanished with no error.
Measured, then fixed the way the BOQ grid and the nine Contracts & Claims money fields were fixed:
`type="text"` + `inputmode="decimal"`. ⚠️ `min`/`max`/`step` were dropped with it — they do nothing
on a text input and would read as validation that is not happening; the range is enforced in
`setCell`, the one path every edit and every paste goes through.

⚠️ **And a comma is now REFUSED rather than stripped.** Stripping turns the European `12,5` (meaning
12.5) into 125 — a guess about the writer's locale that produces a plausible wrong number. This repo
settled the same question for Contracts & Claims on 2026-09-09: refuse, and say so. `parseFloat` on
its own is no better; it reads `12,5` as 12 and `5abc` as 5, both silently. The two refusals now
carry **two different messages**, because an unreadable value and an out-of-range one are different
mistakes and one message for both sends a planner who typed `12,5` hunting for a range problem.

Measured, seven cases: `7.5` `0` `100` accepted, `12.5%` → 12.5 (a trailing % is stripped, since the
column *is* a percentage), and `12,5` / `150` / `5abc` each refused with the right one of the two
messages.

### 5. Verified

**85 assertions across three suites, 0 failing** — 14 new on the dirty overlay, the live preview and
the per-kind independence, plus the 37 and 34 from the two passes above, both re-run.

**Driven in a real browser** against the shipped CSS and the real PDGrid, light and dark: 5 trades ×
24 months = 120 cells; typing moved the row total 0 → 25%, the weighted footer 22.7 → 29.5% and the
planned curve's first point from y=300 to y=280.67, **with the table node unchanged and the focus
still in the cell**; the over-100 row total is flagged (120% in the bad colour); the frozen corner
holds after a 600px horizontal scroll; the paste filled four months; every status token resolves in
dark mode.

⚠️ **Not verified signed in**, and the migration still has to be run — `scurve_manual` /
`scurve_manual_meta`, `migrations/2026-09-10-scurve-manual-poc.sql`. Nothing here has written a row;
Save is exercised against a stub.

## The manual sheet's preview curve gets its own compact size (2026-09-11 d8) — ethanrobles10

Owner: *"can you make the curve smaller for the manual POC entry. And make it aesthetically
pleasing."*

The preview above the manual sheet was the **full Curve-tab chart**, verbatim: a 340-unit plot, five
gridlines, a two-row legend and two long paragraphs — about 580px of furniture sitting on top of a
36-column spreadsheet the planner is actually trying to type into.

⚠️ `MODULE_V` → `20260911sc1`, **re-derived from the remote after rebasing**: this landed as `d7`, then `d8`, then `d9`,
another session took all three while it was being written. A shared cache-bust that two
commits both claim busts nothing for whichever deploy lands second, so this one steps OFF the shared `d<N>` run rather than racing it again — `sc1` cannot collide with a sequence nobody else is walking.

### ⚠️⚠️ SMALLER IS A DIFFERENT CHART, NOT A SCALED-DOWN ONE
The obvious move — cap the rendered height and let the viewBox shrink — takes the **type** down with
it. At the height this needed, the 11px axis labels land near 7px and the legend swatches become
dashes. So `renderChart` takes a `compact` flag that re-proportions the **drawing**, and the fonts
keep real sizes in CSS:

| | Curve tab | Manual preview |
|---|---|---|
| Plot box | 1000 × 340 | 1000 × **196** |
| Gridlines | 0/25/50/75/100 | 0/**50**/100 |
| Pads (L/T/B, R with bars) | 40 / 16 / 40 / 56 | 34 / 12 / 26 / 48 |
| Axis label size | 11px | **10px** (not 6px) |
| Source note | 317 chars | **69** |

- ⚠️ **A flag on the shared renderer, never a second renderer.** The preview and the Curve tab draw
  the same project; two chart builders is how they start disagreeing about it. Everything below the
  five geometry numbers — the x mapping, the bars, the forecast S-curve, the hover bands — is already
  expressed in terms of them, so no second code path was needed.
- ⚠️ Three gridlines, not five: at 196 units tall, five sit ~18px apart on screen and read as
  hatching rather than as a scale.
- ⚠️ Thinner strokes in compact (2.5 → 2, 2 → 1.6). At two-fifths less height the full-weight lines
  read as ribbons and the planned and actual curves touch where they run close together.
- ⚠️ Every `-sm` rule is scoped to its own class, never written on the bare `.sc-svg` / `.sc-legend`.
  The Curve tab is the same markup from the same function, so a rule on the bare class would quietly
  restyle the full-size chart too. Verified: the full chart still reports `viewBox 0 0 1000 340`,
  class `sc-svg`, 5 gridlines, 11px labels.

### ⚠️ The honesty note got shorter, not weaker
The manual-curve paragraph is the longest thing on the preview and shortening it was half the ask —
but it is also the note that stops a screenshot asserting data nobody entered. The compact form still
makes **all three claims**: this is a manual curve, what the trades are weighted by, and what has
actually been entered (`Manual curve · trades weighted by duration · entered: planned, actual`), with
`manChart` still appending the unsaved count. What it drops is the sentence telling the planner where
the sheet is and how to switch back to Automatic — both on screen a few pixels below, on the very tab
this preview lives in. **The Curve tab keeps the full paragraph**, where the sheet is a tab away and
neither is in view.

⚠️⚠️ `var compact` is declared at the TOP of `renderChart`, not beside the geometry it mostly drives.
The note branch above the plot reads it too, and `var` hoisting would have handed that branch an
`undefined` — the compact note would have silently never fired while every geometry change worked.

### And the block itself
A caption row (`Live preview · redraws as you type, unsaved edits included`) above a hairline rule,
tighter padding, a one-line compact legend and micro-sized notes. ⚠️ The caption is not decoration:
that the curve follows your typing was a fact only a code comment stated, and a planner who does not
know it has no reason to look up at the chart at all.

### Verified
A gitignored harness (deleted) that loads the module's **own `<style>` block** by XHR and the
**shipped** `renderChart` / `lens` / `periodBuckets` / `periodic` sliced verbatim, drawing the same
synthetic 30-month programme twice — compact and full — side by side in one page.

| Measured in the browser | Result |
|---|---|
| Compact plot | `viewBox 0 0 1000 196`, class `sc-svg sc-svg-sm`, rendered **220px** tall |
| Full plot (unchanged) | `viewBox 0 0 1000 340`, class `sc-svg`, rendered 390px tall |
| Whole preview block | **352px**, against 583px for the full-size card — **40% less vertical space** |
| Gridlines | 3 compact / 5 full |
| Axis label size | 10px compact / 11px full — still a real size |
| Source note | 69 chars compact / 317 full, all three claims intact in both |

⚠️ **Not verified against real data** — the anon key has no grants, so this was measured on a
synthetic curve, not on a project's own manual sheet. What is proven is the geometry, the scoping of
the `-sm` rules and that the full-size chart is untouched; what has not been seen is the preview
redrawing as a planner types into the matrix.
