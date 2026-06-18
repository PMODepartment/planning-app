-- ============================================================================
-- Migration: Phase 2 module tables (Project Schedule / Cost Loading & S-Curve,
-- Resource Loading, Productivity Rates, Cash Flow). Run in the Supabase SQL
-- editor. Idempotent. Assumes the helper functions can_access_project() /
-- is_admin() / is_approved() already exist (from the base schema + RLS migration).
-- ============================================================================

create table if not exists project_schedule (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  activity_id text, activity_name text, wbs text,
  start_date date, end_date date, duration_days numeric, percent_complete numeric,
  predecessors text, planned_cost numeric(18,2), actual_cost numeric(18,2),
  earned_value numeric(18,2), period date, remarks text,
  created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists resource_loading (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  resource_name text, resource_type text, unit text, period date,
  planned_qty numeric, actual_qty numeric, rate numeric(18,2), cost numeric(18,2),
  remarks text, created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists productivity_rates (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  activity text, unit text, output_qty numeric, manhours numeric,
  productivity_rate numeric, crew text, period date, remarks text,
  created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists cash_flow (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  period date, category text, description text,
  planned_amount numeric(18,2), actual_amount numeric(18,2), remarks text,
  created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

-- Grants (authenticated role) — default privileges from the base schema cover
-- new tables, but grant explicitly to be safe.
grant select, insert, update, delete
  on project_schedule, resource_loading, productivity_rates, cash_flow
  to authenticated;

-- RLS: same per-project policy template as the Phase-1 module tables.
do $$
declare t text;
begin
  foreach t in array array['project_schedule','resource_loading','productivity_rates','cash_flow'] loop
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
