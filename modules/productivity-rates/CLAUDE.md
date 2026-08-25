# Module: productivity-rates — Productivity Monitoring

## F1/F2/F6 vendor attribution, reconciliation and the rate library (2026-08-25) — fmlozano
**Run `../../migrations/2026-08-25-vendor-identity.sql` + `-vendor-performance.sql`.** New **Rates**
tab; `vendor_id` + `work_package` on each activity, and a Vendor + Work package column in the Data
register. Full reasoning in the main CLAUDE.md entry of the same date.

⚠️ **VENDOR PERFORMANCE IS DELIBERATELY NOT IN THIS MODULE.** The S-curve, the on-track/problem flags
and the cross-project scorecard live in the **prc-app's Vendor Management** — that is where vendors
are managed and awarded. This module owns the vendor **attribution** on a productivity record and the
productivity facts (rates, BOQ-vs-site reconciliation). Building a scorecard here too would put a
vendor's story in two apps with nothing keeping them in step.

- ⚠️ `subcontractor` is kept, shown, and **never auto-matched** to a vendor — abbreviations differ
  between projects and a wrong guess rewrites a vendor's record. Three states are distinct on screen:
  a resolved name, `GeoExpert (unlinked)` (free text only), and `UNLINKED` (an id not in the mirror).
- ⚠️ **No FK on `vendor_id`** — the mirror refreshes wholesale; an FK would let a vendor leaving WPM
  cascade real site history away.
- ⚠️ The rate library shows **sample size and date range beside every rate** and flags <3 months as
  **thin**; the rate is Σqty ÷ Σman-days, never an average of monthly rates.
- ⚠️ The reconciliation **never converts units** and never coerces a missing side to 0.
- ⚠️ **Harness lesson:** this module uses `AppAuth.getSB()`, not `supabase.createClient`. Stubbing the
  wrong one makes every KPI read 0 as if the data were absent.
- Verified in a browser against the shipped markup/CSS; 10/10 header-body cells; all semantic colours
  pass AA in both themes (min 6.39 / 6.56); un-migrated path degrades without touching Monitoring/Data.
- ⚠️ **`sync-wpm` must be REDEPLOYED** or every vendor column stays NULL.


Project-scoped **Productivity Monitoring** module, built from the Megawide OPS
workbook *"QHL706. OPS. Productivity Monitoring … (BL02)"*. Reference module for
the CRUD/chart patterns: **s-curve** (SVG planned/actual curves, uniform chrome)
and **risk-register** (CRUD + derived field).

## What it does
Every **activity / trade** (Rebar Works, Formworks, Reinforced Concrete, Bored
Piling, Excavation, Precast Column, …) carries monthly **Planned / Actual /
Baseline (BL0)** figures for two stored INPUTS — **resource loading** (manpower
pax / equipment unit) and **output quantity** (kg/m³/m²/pcs/unit) — plus a
`work_days` divisor per month. The **productivity rate, cumulative output and
variance are DERIVED in the app** (`rate = output ÷ (resource × work_days)`) and
never stored — same "derive, don't persist" rule as risk-register's rating.

- **Monitoring tab** — pick an activity + metric (Productivity Rate / Output
  Quantity / Manpower / Cumulative Output); SVG chart of BL0 (gray dashed) vs
  Planned (dark) vs Actual (red) with a "this month" line; 5 KPIs (latest &
  average actual rate, cumulative output actual-vs-plan, output variance %, avg
  resource); a toggleable transposed data table (months across; BL0/Planned/
  Actual/Variance rows).
- **Data tab** — activities register (add/edit/delete) + a **monthly editor**
  (grid of months × [work days, manpower BL0/Pl/Act, output BL0/Pl/Act]) with
  live-derived rate cells, "+ Add month" (defaults `work_days` to the Philippine
  6-day working calendar via `PDCal`), and save/persist.
- **Excel import** — reads the QHL706 workbook family (one sheet per trade),
  detecting the four labelled blocks (Manpower/Equipment loading · Output ·
  Average Productivity Rate · Cumulative) and the month/year header, and the
  subcontractor sub-block (AFCSC/JM2/CEC/GeoExpert). Preview before import.
  `work_days` is set to **reproduce the workbook's own stored rate**
  (`qty ÷ (mp × rate)`), falling back to PDCal when a month has no stored rate.

## Data model (migration `2026-07-20-productivity-rates-full.sql` — USER MUST RUN)
- `productivity_activities` — one row per trade (name, category, unit,
  resource_type, resource_unit, subcontractor, sort_order).
- `productivity_entries` — one row per (activity, month): `work_days`,
  `mp_bl0/planned/actual`, `qty_bl0/planned/actual`; unique on (activity_id,
  period); FK to activities `on delete cascade`.
- Idempotent, folded into `supabase-schema.sql` + `supabase-setup.sql`, added to
  the RLS loop (standard read-all-accessible / write-own-or-admin). The flat
  Phase-1 `productivity_rates` starter table is **superseded** (left untouched).
- Load/import surface a "run the migration" toast until the tables exist.

## Key decisions
- **Data sourcing is manual/import, not derived from other modules.** The
  workbook's actuals (crew deployed, quantity installed) are site-reported and
  have no upstream source in the suite (resource-loading holds *scheduled*
  resources, not daily manpower; installed quantities live nowhere else). So
  this is a data-entry + monitoring tool, like material-submittal / drawing-
  register — unlike cash-flow, whose inputs genuinely exist in schedule+WPM.
- **`work_days` is a stored input; the rate is derived.** The workbook's own
  rate ≈ output/(manpower×~30) with a per-month day count that varies by trade;
  storing `work_days` (editable) reproduces it exactly while keeping the rate a
  pure function of inputs.

## Verification (2026-07-20)
- **Parser** verified in Node+SheetJS against the real workbook: 13 trade sheets
  (correctly excludes Assumptions/Sheet1-3/scratch tabs), correct units/resource
  types/subcontractors, BL0/Planned/Actual series, 307 monthly entries. The
  block detector uses the invariant "a main block has an empty col-C in the row
  above; a subcontractor sub-block does not" (fixed Excavation grabbing the
  "No. of Backhoe" sub-row as output). Same parser re-verified in-browser.
- **Import reconciliation** (Node): 187/192 rate-bearing months reproduce the
  workbook's stored rate within 0.5% (the ~5 outliers are the workbook's own
  integer-rounded rates, ≤9% on tiny values); 115 rate-less months fall back to
  PDCal.
- **UI/behaviour** verified in a browser harness (real module code fetched from
  index.html, in-memory Supabase stub): Monitoring KPIs (cum 870.78, latest
  0.717, avg mp 25.7 — all hand-checked), chart planned/actual/BL0 lines + dots,
  metric switch, transposed table + variance, empty states; Data register;
  monthly editor live-derive (95→190 doubles the rate; +month appends Sep-2024
  with PDCal work_days=25) and save/persist (4 entries, cum 1370.78); add-
  activity modal. No console errors. Screenshots remain impossible in this env
  (stalled compositor) — checks are DOM/JS-based.

## Live collaboration + offline (Phase 1 & 2) (2026-07-27) — fmlozano
Wired the shared **PDCollab** (Realtime) + **PDSync** (offline outbox) layers — full presence +
cursors + live + offline.
- **Multi-table live:** this module spans **two** tables (`productivity_activities` +
  `productivity_entries`), so `joinCollab()` (`key = productivity_rates:<pid>`) uses the new
  **`opts.tables` array** on PDCollab.join (added to `collab.js`, backward compatible) to subscribe to
  both. `applyRemoteChange` switches on `payload.table` and patches `acts` / `entriesByAct`, then
  re-renders. Topbar avatars (`#pr-presence`).
- **Cursor granularity = the ACTIVITY** (its Data-register row): both `openActForm` (edit) and
  `openEditor` (monthly grid) broadcast "editing this activity"; every close path (Cancel/Save) clears
  it. `paintRemote()` (end of `renderData`) flags the `tr[data-id]` of whoever has it open — only on
  the **Data** view (that's where the register rows live).
- **Offline (Phase 2):** a shared `persist(job)` routes every write through `PDSync.write`
  (field-level LWW). **Activity add/edit, delete, and the monthly-editor save (deletes + upserts) are
  all offline-capable** — applied optimistically and reconciled on reconnect; when the write goes
  through online we `load()` for authoritative data, when queued we apply locally + `render()`.
  Read-cache: `load()` caches **both tables** under `pr:<pid>` and restores from cache on a failed
  fetch. ⚠️ **Import stays online-only** (bulk insert; guarded on `navigator.onLine`).
  ⚠️ Offline inserts use PDSync's client-generated uuid as the row id, so a new activity + its months
  queue consistently and replay in order.
- **Migration `../../migrations/2026-07-27-realtime-collab-productivity-rates.sql` (USER MUST RUN)** —
  adds both tables to `supabase_realtime` + `replica identity full`. Presence/cursors/offline work
  without it; only the live-value stream needs it.
- Verified: inline module + `collab.js` pass `node --check`. Live two-session verification pending
  (deployed + 2 sessions + an offline cycle). Assets: `offline.js?v=20260726d` +
  `collab.js?v=20260727a` (bumped — multi-table support); inline module (no separate file to version).

## Status
- [x] Migration written + folded into schema/setup + RLS loop
- [x] Monitoring (chart + KPIs + table) + Data (register + monthly editor) + import
- [x] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [x] `Fmt.esc()` on injected user text; derived fields never stored
- [x] `enabled: true` in `config.js`
- Only module-local files + the `config.js` enabled flag changed → **no global `?v=` bump** (suite convention).
