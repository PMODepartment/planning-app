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

## Notes
(Record decisions, columns added via `alter table ... add column if not exists`, etc.)
