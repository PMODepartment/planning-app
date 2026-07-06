# Module: cash-flow

> **Claude / developer: read this first.**
> 1. Read `../../MODULE_CONTRACT.md` and `../../CONTRIBUTING.md` (NOT auto-loaded).
> 2. This module is **Cash Flow** (Phase 2). Your DB table is `cash_flow`
>    (defined in `../../supabase-schema.sql`; starter columns only — extend as needed).
> 3. Best reference to copy: **risk-register (plain CRUD; money via Fmt.money, cumulative series)**.
> 4. Work only inside this folder, on branch `module/cash-flow`, then PR to `main`.
> 5. Update this file as you build.

## Status
- [x] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [x] Built (single-file inline-script pattern, matching resource-loading/project-schedule/
      s-curve/portfolio-overview rather than the older module.js split)
- [x] CRUD implemented (add / edit / view / list / delete)
- [x] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [x] `Fmt.esc()` on all user text injected into HTML
- [x] `enabled: true` set in `assets/js/config.js`
- [ ] PR opened into `main`

## Built (2026-07-06)
Was a bare "Module in development" placeholder until now — no CRUD existed anywhere to
populate the `cash_flow` table, discovered while scoping a Portfolio Overview cross-project
Cash Flow view (which needed real data to roll up). Built:
- Project picker + category filter (free-text `category`, suggested via a `<datalist>` of
  common values) + search, matching the resource-loading/project-schedule toolbar pattern.
- **KPI cards**: Entries, Total Planned, Total Actual, Variance (color-coded).
- **Monthly chart** (SVG, no libs): period bars (Planned gray / Actual red) + cumulative
  Planned/Actual lines overlaid, mirroring the visual language of the single-project S-Curve
  chart. Entries with the same `period` (any day within a month) are summed per calendar month.
- **Table** (sortable-by-period) with inline Edit/Delete; **Add/Edit modal**: month picker,
  category, description, planned/actual amounts, remarks.
- Verified end-to-end in a stubbed harness (mutable in-memory Supabase-shaped store): added 3
  entries across 2 months/2 categories, hand-checked KPI totals, monthly aggregation, and
  cumulative series all matched exactly; category filter and per-row variance coloring
  confirmed.
- Flipped `enabled: true` in `assets/js/config.js`.

## Notes
(Record decisions, columns added via `alter table ... add column if not exists`, etc.)
