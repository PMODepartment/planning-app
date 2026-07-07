-- ============================================================================
-- Migration: Weighted Steps (OPC-style per-activity checklist) that rolls up
-- into a weighted "physical % complete", which is written back onto
-- project_schedule.percent_complete so every existing consumer (CPM, EVM,
-- Cost Loading, forecasts, the Planner Cockpit, Monte Carlo actuals) benefits
-- automatically with no further changes. Keyed by activity_id (the human
-- code), matching the resource_assignments convention already used here.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists activity_steps (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  activity_id text,                 -- matches project_schedule.activity_id (by code)
  name text not null,
  weight numeric(10,2) default 1,
  percent_complete numeric(5,2) default 0,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create index if not exists activity_steps_project_activity_idx on activity_steps(project_id, activity_id);

alter table activity_steps enable row level security;
drop policy if exists activity_steps_read on activity_steps;
create policy activity_steps_read on activity_steps for select using (is_approved());
drop policy if exists activity_steps_write on activity_steps;
create policy activity_steps_write on activity_steps for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on activity_steps to authenticated;
