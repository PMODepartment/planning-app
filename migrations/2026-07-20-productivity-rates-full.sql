-- ============================================================================
-- Migration: Productivity Rates — full module schema (Productivity Monitoring)
--
-- Reverse-engineered from the Megawide OPS workbook
--   "QHL706. OPS. Productivity Monitoring … (BL02)"
-- where every construction trade lives on its own sheet as a monthly
-- Planned / Actual / Baseline (BL0) monitoring graph tracking THREE series:
--   1. Manpower (or Equipment) loading    — crew size per month
--   2. Output quantity                     — kg / m3 / m2 / pcs / unit installed
--   3. Average Productivity Rate           — output per man-day  (DERIVED)
-- plus a cumulative-output curve with Planned-vs-Actual variance.
--
-- MODEL: two tables. `productivity_activities` = one row per trade (the sheet
-- header: name, output unit, resource type/unit, subcontractor). Manpower and
-- output are stored INPUTS; `work_days` (working days that month) is the input
-- man-day divisor. The productivity RATE, the cumulative and the variance are
-- DERIVED in the app (rate = output ÷ (resource × work_days)) and never stored
-- — the same "derive, don't persist" rule risk-register uses for its rating, so
-- a stored figure can never drift from its inputs.
--
-- The Phase-1 starter table `productivity_rates` (flat activity/output/manhours
-- row) is SUPERSEDED by these two purpose-built tables; it is left in place
-- untouched so nothing that referenced it breaks.
--
-- Run in the Supabase SQL editor. Idempotent / add-only.
-- ============================================================================

-- ---- One row per trade / activity ------------------------------------------
create table if not exists productivity_activities (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id),
  name           text not null,
  category       text,                        -- optional grouping (e.g. Substructure / Superstructure / Precast)
  unit           text,                        -- output unit: kg | m3 | m2 | pcs | unit
  resource_type  text default 'Manpower',     -- Manpower | Equipment
  resource_unit  text default 'pax',          -- pax | unit | man-day
  subcontractor  text,                         -- executing subcontractor (AFCSC / JM2 / CEC / GeoExpert …)
  sort_order     numeric,
  remarks        text,
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- ---- One row per (activity, month) — the monthly monitoring point ----------
-- Each series (Baseline BL0 / Planned / Actual) has its own manpower + output
-- column. `work_days` is the working-day count for that month (the man-day
-- divisor); on import it is set to reproduce the workbook's own rate, and for
-- manual entry it defaults to the Philippine 6-day working calendar (PDCal).
create table if not exists productivity_entries (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id),
  activity_id    uuid references productivity_activities(id) on delete cascade,
  period         date not null,               -- first day of the month
  work_days      numeric,                      -- working days this month (man-day divisor)
  mp_bl0         numeric, mp_planned numeric, mp_actual numeric,    -- resource loading
  qty_bl0        numeric, qty_planned numeric, qty_actual numeric,  -- output quantity
  remarks        text,
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create unique index if not exists productivity_entries_uq  on productivity_entries(activity_id, period);
create index        if not exists productivity_entries_prj on productivity_entries(project_id, period);
create index        if not exists productivity_act_prj     on productivity_activities(project_id, sort_order);

comment on table productivity_activities is 'Productivity Monitoring: one row per construction trade/activity (per project).';
comment on table productivity_entries    is 'Productivity Monitoring: monthly Planned/Actual/BL0 manpower + output per activity. Rate/cumulative/variance are derived in the app.';
comment on column productivity_entries.work_days is 'Working days in the month = the man-day divisor. rate = output ÷ (resource × work_days).';

-- ---- Grants (explicit; the schema also grants future tables by default) -----
grant select, insert, update, delete on productivity_activities to authenticated;
grant select, insert, update, delete on productivity_entries    to authenticated;

-- ---- RLS: the standard read-all-accessible / write-own-or-admin pattern -----
-- (same shape as every other module table in supabase-schema.sql). Both rows
-- carry project_id + created_by so the project-access + authorship gates apply.
do $$
declare t text;
begin
  foreach t in array array['productivity_activities','productivity_entries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_ins', t);
    execute format('create policy %I on %I for insert with check (is_approved() and created_by = auth.uid() and can_access_project(project_id))', t||'_ins', t);
    execute format('drop policy if exists %I on %I', t||'_upd', t);
    execute format('create policy %I on %I for update using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()))', t||'_upd', t);
    execute format('drop policy if exists %I on %I', t||'_del', t);
    execute format('create policy %I on %I for delete using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()))', t||'_del', t);
  end loop;
end $$;
