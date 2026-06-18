-- ============================================================================
-- Migration: split S-Curve into its own module → add `s_curve` table.
-- Run in the Supabase SQL editor. Idempotent. Assumes helper functions
-- (can_access_project / is_admin / is_approved) already exist.
-- ============================================================================

create table if not exists s_curve (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  period date,
  planned_value numeric(18,2),
  actual_value numeric(18,2),
  planned_cumulative numeric(18,2),
  actual_cumulative numeric(18,2),
  percent_planned numeric,
  percent_actual numeric,
  remarks text,
  created_by uuid references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

grant select, insert, update, delete on s_curve to authenticated;

alter table s_curve enable row level security;
drop policy if exists s_curve_read on s_curve;
create policy s_curve_read on s_curve for select using (can_access_project(project_id));
drop policy if exists s_curve_ins on s_curve;
create policy s_curve_ins on s_curve for insert with check (is_approved() and created_by = auth.uid() and can_access_project(project_id));
drop policy if exists s_curve_upd on s_curve;
create policy s_curve_upd on s_curve for update using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
drop policy if exists s_curve_del on s_curve;
create policy s_curve_del on s_curve for delete using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
