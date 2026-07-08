-- ============================================================================
-- Migration: schedule threshold monitors (P6 "Thresholds") — rules that watch a
-- schedule parameter (total float, finish variance, LD/contract exposure,
-- overdue days) and generate Issues (into issues_lessons) when an activity
-- breaches them. Definitions live here; generated issues live in the existing
-- issues_lessons table (type='Issue', category='Schedule Threshold').
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists schedule_thresholds (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  name text,
  metric text not null,          -- float_below | finish_var_above | contract_var_above | overdue_days
  value numeric not null,
  severity text default 'Medium', -- Low | Medium | High
  enabled boolean default true,
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists schedule_thresholds_project_idx on schedule_thresholds(project_id);

alter table schedule_thresholds enable row level security;
drop policy if exists schedule_thresholds_read on schedule_thresholds;
create policy schedule_thresholds_read on schedule_thresholds for select using (is_approved());
drop policy if exists schedule_thresholds_write on schedule_thresholds;
create policy schedule_thresholds_write on schedule_thresholds for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on schedule_thresholds to authenticated;
