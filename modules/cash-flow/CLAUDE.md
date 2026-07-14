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

## Verified
- JS parses (`node --check`). Engine math hand-checked on a synthetic fixture:
  DP/billing-net/retention/terms lag land in the correct months and totals
  conserve (cash in = contract, cash out = Σ budgets).
- Not yet run against live logins + live WPM read (see Status).
