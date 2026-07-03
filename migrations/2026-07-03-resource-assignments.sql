-- ============================================================================
-- Migration: resource_assignments — links activities to resources/roles with
-- budgeted/actual units (OPC Resource Assignments). Feeds Project Schedule's
-- Resource Usage / Role Usage (time-phased across the activity's dates).
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists resource_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  activity_id text,                -- matches project_schedule.activity_id (by code)
  resource_id uuid references resources(id),
  resource_code text,              -- denormalized (roster convenience)
  role text,                       -- role name (for role-usage rollups)
  budgeted_units numeric,          -- planned units (e.g. person-days / hours)
  actual_units numeric,
  remaining_units numeric,
  uom text default 'hours',
  remarks text,
  created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

grant select, insert, update, delete on resource_assignments to authenticated;

alter table resource_assignments enable row level security;
drop policy if exists resource_assignments_read on resource_assignments;
create policy resource_assignments_read on resource_assignments for select using (can_access_project(project_id));
drop policy if exists resource_assignments_ins on resource_assignments;
create policy resource_assignments_ins on resource_assignments for insert with check (is_approved() and created_by = auth.uid() and can_access_project(project_id));
drop policy if exists resource_assignments_upd on resource_assignments;
create policy resource_assignments_upd on resource_assignments for update using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
drop policy if exists resource_assignments_del on resource_assignments;
create policy resource_assignments_del on resource_assignments for delete using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
