-- ============================================================================
-- Migration: multiple named schedule baselines (OPC-style). Each baseline is one
-- row holding a compact per-activity snapshot as jsonb ({ "<activity_id>":
-- [start, finish, duration_days, planned_cost] }). One baseline can be flagged
-- primary; setting it primary also writes bl_start/bl_finish/bl_cost back onto
-- project_schedule so the existing Gantt baseline bar + variance keep working.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists schedule_baselines (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null,
  name           text,
  taken_at       timestamptz default now(),
  created_by     uuid,
  is_primary     boolean default false,
  activity_count int,
  activities     jsonb default '{}'::jsonb
);

create index if not exists schedule_baselines_project_idx on schedule_baselines (project_id, taken_at desc);

alter table schedule_baselines enable row level security;

drop policy if exists schedule_baselines_read on schedule_baselines;
create policy schedule_baselines_read on schedule_baselines for select using (is_approved());

drop policy if exists schedule_baselines_write on schedule_baselines;
create policy schedule_baselines_write on schedule_baselines for all
  using (is_planner()) with check (is_planner());

grant select, insert, update, delete on schedule_baselines to authenticated;
