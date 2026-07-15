# Module: cash-flow

> **Claude / developer: read this first.**
> 1. Read `../../MODULE_CONTRACT.md` and `../../CONTRIBUTING.md` (NOT auto-loaded).
> 2. This module is **Cash Flow** (Phase 2). It is a **derived projection**, not a
>    manual ledger — see the model below.
> 3. Work only inside this folder, on branch `module/cash-flow`, then PR to `main`.
> 4. Update this file as you build.

## Status
- [x] Rebuilt as a work-package-driven projection (replaces the old manual CRUD)
- [x] Cash-in sourced from `project_schedule` S-curve × contract, with full terms engine
- [x] Cash-out sourced LIVE from the WPM (procurement) Supabase `work_packages`
- [x] Assumptions stored in `cash_flow_settings` (migration 2026-07-14)
- [x] `enabled: true` in `assets/js/config.js`
- [ ] Live end-to-end run against real logins + real WPM read access

## Model (matches the Excel "Cashflow" sheet — EPC.PMO.OPW101 rev1)
The cashflow is a **monthly projection**, not manual inflow/outflow rows:

- **Header / assumptions** (`cash_flow_settings`, one row per project): contract
  IBB (VAT inc, the cash-in base) + BCB, DP %, retention %, DP recoup %, billing
  terms (months), retention-release lag, cashflow start month, and `wpm_project_id`.
- **Cash In** (revenue, driven by the **schedule**): monthly progress billing =
  contract IBB × ΔS-curve% (duration-weighted from `project_schedule` leaves).
  Each billing is net of retention (withheld) and DP recoup, then shifted by the
  billing-terms lag to when cash is actually received. Downpayment lands up front;
  retention is released after completion + release lag. Rows: Downpayment /
  Billing / Retention release / **Cumulative**.
- **Cash Out** (payments, driven by **WPM**): each `work_packages` row's budget
  (`total_awarded` → `awarded_cost` → `approved_budget_bcb`) is spread linearly
  across its window (award/delivery → completion), with its own DP %, retention %,
  and `payment_terms_days` (→ months). Rows: Downpayment / Billing / Retention /
  **Cumulative**.
- **Net Cash Flow** = Cash In − Cash Out, periodic + cumulative. **Peak funding
  need** = most-negative cumulative net.

Invariant (verified): total cash in = contract IBB; total cash out = Σ WP budgets.

## Data sources & integration
- **Schedule**: this app's `project_schedule` (paginated read, leaves only).
- **WPM cash-out**: read from this app's `wpm_work_packages` **mirror** (NOT live
  from WPM — its anon key is public, so browser reads of procurement budgets are
  avoided). The `sync-wpm` Edge Function copies the needed columns from the WPM
  project (`cayjeqeleenizbdzrums`) using the **WPM service key (server-side only)**
  into the mirror; the module reads the mirror under normal RLS.
  - Admins/planners get a **"Sync from WPM"** toolbar button →
    `sb().functions.invoke('sync-wpm', { body: { wpm_project_id } })`. Source chips
    show the last `synced_at`.
  - Project ids differ between the two apps → the `wpm_project_id` field in
    Assumptions maps them (defaults to this project's id).
  - Chosen over an anon view / shared login because those would expose procurement
    budgets to anyone holding the public anon key.

## DB & deploy (user must do)
1. Run `migrations/2026-07-14-cash-flow-settings.sql` (assumptions table).
   Also run `2026-07-14-cash-flow-v2.sql` and `2026-07-14-cash-flow-v3.sql`
   (tax/retention/actuals/rollup, then financing/funding/scenarios/trade-packages).
2. Run `migrations/2026-07-14-wpm-work-packages-mirror.sql` (`wpm_work_packages`).
3. Deploy the Edge Function + set its secrets (see header of
   `supabase/functions/sync-wpm/index.ts`):
   - `supabase functions deploy sync-wpm --project-ref bgupuqnkqhixpuctyder`
   - `supabase secrets set WPM_URL=… WPM_SERVICE_KEY=… --project-ref bgupuqnkqhixpuctyder`
4. Click **Sync from WPM** once (or schedule a nightly run).

The old `cash_flow` table (manual planned/actual entries) is **no longer used** by
this module; kept in the schema for now.

## Downpayment tranches (2026-07-14)
Client DP is no longer a single `dp_percent`. New `cash_flow_dp_tranches` table
(migration `2026-07-14-cash-flow-dp-tranches.sql` — **user must run it**): each
tranche has a label, category/trade tag, basis (`% of contract` or fixed ₱),
timing (`milestone` / fixed `month` / `offset` months from start), and a
proportional `recoup_percent` (blank → the tranche's own % of contract). Edited in
the Assumptions modal's **Downpayment Tranches** section. Engine: `resolveTranches()`
→ each tranche's cash lands at its resolved due month; billings claw back each
tranche's rate until its pool is spent. Falls back to the simple `dp_percent` when
no tranches exist. Milestone timing reads named/0-duration activities from
`project_schedule`. Invariant still holds: total cash in = contract IBB.

## v3 — financing, funding limit, scenarios, per-trade cash-in, settable data date (2026-07-14)
Migration `2026-07-14-cash-flow-v3.sql` (**user must run**): adds `finance_rate` +
`funding_limit` to `cash_flow_settings`; new tables `cash_flow_trade_packages` and
`cash_flow_scenarios`.

- **(#5) Financing cost** — annual `finance_rate` applied to the negative cumulative
  (monthly = drawdown × rate/12) → a **Financing Cost** KPI. Transparent carrying cost,
  not compounded into the operational balance. Exported.
- **(#8) Settable data date + funding-limit alert** — the data date is now a toolbar
  control, **shared with Project Schedule** (reads its `ps_datadate_<pid>` localStorage
  key as the default; a cash-flow override is stored under `cf_datadate_<pid>`; the ×
  button clears the override). `today()` returns it. A `funding_limit` (credit line)
  raises a red **breach banner** listing the months where cumulative net drops below
  −limit; the Peak Funding KPI shows the limit.
- **(#6) Scenario snapshots** — "Manage snapshots" (in the Scenarios card) saves the
  current projection (totals + peak + finance + netCum) to `cash_flow_scenarios`. One is
  the **baseline**; the dashboard shows a **current-vs-baseline Δ table** (mirrors the
  Excel "rev1"). First snapshot auto-becomes baseline.
- **(#7) Per-trade cash-in packages** — split the contract into trades (ST/AR/MEPF…) in
  the Assumptions modal, each billing its share over the **shared schedule S-curve** with
  its own DP/retention/terms. **When any package exists it replaces the contract-level
  cash-in and the client DP tranches are ignored.** A reconciliation banner flags any
  mismatch vs Contract IBB. (Per-trade *schedules* not modeled — all trades share the one
  project schedule shape; can be extended later.)

## Cash-in S-curve basis switcher (2026-07-14)
`cash_flow_settings.scurve_basis` (`'duration'` | `'cost'`, added in the v3 migration).
Toolbar segmented switcher **Duration / Cost** (persists to the settings row, recomputes
live). The cash-in billing spread = contract IBB × Δ of the schedule S-curve, and that
curve is now weighted either by **activity duration** (time) or **per-activity
`planned_cost` / Planned IBB** (value, falls back to `bl_cost`). **Cost mode auto-reverts
to duration when the schedule has no cost loaded** (a source chip shows the active basis
and any fallback). Same weight fn drives planned + actual accrual, so Cash Flow tracks
exactly the S-curve the schedule implies. `scheduleCurve`/`scheduleCurveBlended` take an
optional `val` weight fn; `scurveWeight()` picks it.

## Live funding position + chart readability (2026-07-14)
- **Peak Funding Need / Closing Balance** (and the funding-limit breach banner, scenario
  snapshots, print report) use a **live cumulative** (`model.liveNetCum/livePeak/liveClosing`)
  = booked recorded actuals through the data date + projection after — the same trajectory
  the periodic chart draws. Equals the plan when no actuals exist. The monthly matrix stays
  the plan projection; the variance card still shows actual-vs-plan.
- **What-if sliders removed** (low value).
- **Chart:** y-axis uses `niceStep()` round ticks. Data labels: per-bar (quarterly / when bars
  are wide enough), the previous cleaner style — the significant-only labels + peak-funding
  marker were tried then reverted per feedback.
- **Sidebar removed** (matches Project Schedule): `.cf-modback` back button in the topbar,
  full-width content; `UI.initShell()` no-ops with no sidebar.

## Verified
- JS parses (`node --check`). Engine math hand-checked on a synthetic fixture:
  DP/billing-net/retention/terms lag land in the correct months and totals
  conserve (cash in = contract, cash out = Σ budgets).
- Not yet run against live logins + live WPM read (see Status).
