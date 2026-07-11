# Live verification & hardening playbook

A single pass to confirm the app actually works end-to-end against the **live** Supabase project
(`bgupuqnkqhixpuctyder`) with real data — because most feature batches so far were verified only in
throwaway harnesses, never clicked on a real login. Work top to bottom; each step is independent.

> Created 2026-07-11. Tick boxes as you go; leave notes inline when something fails.

---

## 0. Security — rotate the exposed service-role key (do this first)

**Codebase is clean** (audited 2026-07-11): the only key in client code is the **anon** key
(`config.js`, JWT `role: anon`, valid to 2036) — that's correct and safe; RLS protects the data. No
`service_role` key exists anywhere in the repo (`.js`, `.html`, `.sql`, `.md`). The exposure was
out-of-band (the key was shared in chat once and flagged in memory), so rotation is a **Supabase
dashboard action only you can do**:

- [ ] Supabase → **Project Settings → API**.
- [ ] Rotate the **JWT secret** (this invalidates the leaked `service_role` key).
- [ ] ⚠️ **Coupling:** this project uses legacy JWT keys, so rotating the JWT secret **also changes the
      `anon` key**. After rotating, copy the new anon key into
      [`assets/js/config.js`](assets/js/config.js) (`SUPABASE_ANON_KEY`) **and bump the `?v=` cache
      token** across all HTML (see the PowerShell one-liner in [CLAUDE.md](CLAUDE.md) → Prompt 65),
      or every logged-in browser breaks until it hard-refreshes.
- [ ] Confirm login still works after the swap.

---

## 1. Migration audit — confirm the live DB matches the code

The code has evolved far past the original `supabase-setup.sql`. All 30 migrations use `IF NOT EXISTS`
with **no DROPs**, so they're safe to re-run — but first find out what's actually missing. Paste this
**non-destructive** query into the Supabase SQL editor:

```sql
-- Expected tables (from migrations/). Any row that prints here is MISSING.
select t as missing_table from unnest(array[
  'workspaces','project_schedule','wbs_nodes',
  'schedule_baselines','schedule_snapshots','schedule_audit','schedule_scenarios',
  'schedule_thresholds','weekly_commitments','activity_steps',
  'activity_code_types','activity_code_values','activity_udf_defs',
  'calendars','resources','resource_roles','resource_assignments',
  's_curve','cash_flow','productivity_rates','resource_loading'
]) as t
where to_regclass('public.'||t) is null;

-- Expected project_schedule columns. Any row that prints here is MISSING.
select c as missing_column from unnest(array[
  'wbs_node_id','activity_type','status','responsible_party','actual_start','actual_finish',
  'bl_start','bl_finish','bl_cost','predecessors','calendar_id','contract_date',
  'activity_codes','udf','risk_optimistic_pct','risk_pessimistic_pct',
  'owner','work_package','duration_type','percent_complete_type','program_milestone',
  'expected_finish','actual_duration','remaining_duration','free_float',
  'planned_labor_units','actual_labor_units','remaining_labor_units',
  'primary_constraint','primary_constraint_date','secondary_constraint','secondary_constraint_date'
]) as c
where not exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='project_schedule' and column_name=c
);
```

**RESULT (verified live 2026-07-11):** all 21 expected tables present (30 total). `project_schedule`
had **2 missing columns — `activity_codes` and `udf`** (both jsonb; per-activity Activity-Code and UDF
values were failing to persist silently). Fixed live by running the two `add column if not exists`
statements; re-check returned 0 rows. ✅ §1 complete. (The code-type/UDF *definition* tables already
existed — only the two `project_schedule` jsonb columns were missing.)

- [x] **No rows returned by either query** → DB is current, skip to §2.
- [x] **Rows returned** → run the matching migration(s) from [`migrations/`](migrations/), then re-run
      the query until both come back empty. Guide (table/column → file):
  - `wbs_nodes`, `wbs_node_id` → `2026-07-07-wbs-nodes.sql`
  - `schedule_baselines` → `2026-07-07-schedule-baselines.sql`; `bl_cost` → `2026-07-02-baseline-cost-column.sql`
  - `schedule_snapshots` → `…-schedule-snapshots.sql`; `schedule_audit` → `…-schedule-audit.sql`
  - `schedule_scenarios` → `…-schedule-scenarios.sql`; `schedule_thresholds` → `…-schedule-thresholds.sql`
  - `weekly_commitments` → `…-weekly-commitments.sql`; `activity_steps` → `…-activity-steps.sql`
  - `activity_code_*`, `activity_codes` → `2026-07-07-activity-codes.sql`; `activity_udf_defs`, `udf` → `…-user-defined-fields.sql`
  - `calendars`, `calendar_id` → `2026-07-06-working-calendars.sql`
  - `resources`, `resource_roles` → `2026-07-01-resource-role-master.sql`; `resource_assignments` → `2026-07-03-resource-assignments.sql`; `curve` col → `…-assignment-curve.sql`
  - `contract_date` → `…-schedule-contract-date.sql`; `risk_*_pct` → `…-risk-3point-duration.sql`
  - the 17 OPC detail columns (`owner`…`secondary_constraint_date`) → `2026-07-01-project-schedule-opc-fields.sql`

> Symptom if you skip this: saves silently fail or the module toasts a Postgres "column/table not
> found" error. Several batches wrote fields **tolerantly** (own try/catch) precisely so a missing
> column wouldn't break the whole save — meaning a gap can hide until you look for it here.

---

## 2. Core click-through (the loops that matter)

Log in as a **planner/admin** on a real project (or DEMO01) and walk these. Watch the browser console
for errors as you go.

**A. Import → grid**
- [ ] Actions ▾ → **Import Excel/XER** — import a small OPC `.xlsx` (and, if handy, a `.xer`). Confirm
      the preview row counts look right, then commit. Grid + Gantt populate; WBS tree is correct.
- [ ] (The 42k-row P6 import was only ever verified as a *parser* — if you have the JENARA file, this
      is the moment to confirm it writes to a live project without timing out.)

**B. Inline + cell editing (this session's feature)**
- [ ] Double-click a cell → edit → Enter; value persists (reload to confirm).
- [ ] Click a cell, **Shift-click** another → rectangular block highlights.
- [ ] **Ctrl+C** then click a target cell → **Ctrl+V**: values paste; a single copied cell fills a
      selected range; a block pastes from the top-left. Dates recompute duration; % clamps 0–100.
- [ ] **Ctrl+X** → paste elsewhere → source cells clear. **Esc** clears the selection.
- [ ] Right-click a cell → menu shows **Copy/Cut/Paste cell(s)** above **Copy/Cut row(s)**.
- [ ] Copy grid cells, paste into Excel → TSV lands (system-clipboard path).
- [ ] **Undo (Ctrl+Z)** reverts a cell paste — AND a row paste (right-click → Copy/Paste row(s)).

> **User-tested 2026-07-11 on DEMO01 — 2 bugs found, both FIXED (pending deploy):**
> 1. **Shift-click was making a native browser text-selection** (blue + the Edge selection toolbar)
>    instead of the cell block — cell selection worked underneath but was visually buried, and Ctrl+C/X/V
>    felt tied to inline editing. Fixed: `user-select:none` on grid cells (kept on edit inputs), so the
>    red cell block is now the only selection and Ctrl+C/X/V act on it. **Cell C/X/V do NOT require
>    inline editing** — select a block and copy/paste.
> 2. **Row Copy/Paste (right-click → Copy/Paste row(s)) wasn't undoable.** Fixed: row paste now records
>    an `insertMany` undo step (removes the pasted rows on undo, and restores any cut sources).
> Both live only after the module is deployed to GitHub Pages (edits are local). No shared `assets/**`
> changed, so no `?v=` bump needed — just push + hard-refresh.

**C. Schedule engine**
- [ ] Edit a predecessor / date → Schedule ▾ → **Schedule Now** with "Reschedule dependent
      activities" → successor dates move; Critical Path highlight looks right.
- [ ] Toggle Critical Path / dependency arrows on the Gantt.

**D. Cost & rollups**
- [ ] Cost Loading tab totals reconcile; WBS summary rows roll up (POC %, IBB sums).
- [ ] Capture a **baseline** → set primary → BL0 bar + Var (BL) column populate.

**E. Export & reports**
- [ ] Grid footer **Download** → Excel opens with the OPC column layout and DD-Mon-YY dates.
- [ ] Reports → run one built-in to PDF.

**F. Cross-project / portfolio**
- [ ] Portfolio Overview → S-Curve and Cash Flow tabs load across ≥2 projects.
- [ ] **Project selector** now sits in the Portfolio **tab bar** (top-right) and scopes all three tabs
      — checking/unchecking projects narrows the S-Curve (hit **Refresh** on the S-Curve tab after
      changing it). *(Fixed 2026-07-11: the selector used to live only on the Overview toolbar.)*

---

## 3. Sign-off

**This is not a form or a task you fill in — it's just recording that the live app was actually
exercised** (so the next session doesn't re-litigate whether features work only in harnesses). Claude
records the one-line outcome in [CLAUDE.md](CLAUDE.md); you just confirm the three lines below are true.

- [x] §0 key rotation done and login re-confirmed. *(You rotated the JWT secret + updated the anon key
      in `config.js` — confirm login still works after deploy.)*
- [x] §1 self-check returns empty. *(Ran 2026-07-11: found + fixed the `activity_codes`/`udf` gap.)*
- [ ] §2: walk the loops above once on DEMO01. Log any failure with its console error. *(In progress —
      2 bugs found + fixed so far; re-test B and F after the next deploy.)*

When all three are checked, you're done — the app has been verified live, not just in harnesses.
