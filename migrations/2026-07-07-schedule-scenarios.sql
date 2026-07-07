-- ============================================================================
-- Migration: What-if scenarios (P6/OPC "Reflections") — a named, restorable
-- checkpoint of the whole schedule. Capture the current schedule as a scenario,
-- experiment freely on the live schedule, compare live-vs-scenario deltas, then
-- keep the experiment or RESTORE the scenario (roll it back). One row per
-- scenario, activities stored as a compact jsonb snapshot keyed by activity_id
-- (matching the schedule_baselines convention).
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists schedule_scenarios (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null,
  name           text,
  taken_at       timestamptz default now(),
  created_by     uuid,
  activity_count int,
  -- summary captured at snapshot time (for a cheap compare without rehydrating jsonb):
  project_finish date,
  critical_count int,
  total_cost     numeric,
  -- per-activity snapshot: { "<activity_id>": [start, finish, duration_days, percent_complete,
  --                          predecessors, planned_cost, bl_start, bl_finish] }
  activities     jsonb default '{}'::jsonb
);

create index if not exists schedule_scenarios_project_idx on schedule_scenarios (project_id, taken_at desc);

alter table schedule_scenarios enable row level security;
drop policy if exists schedule_scenarios_read on schedule_scenarios;
create policy schedule_scenarios_read on schedule_scenarios for select using (is_approved());
drop policy if exists schedule_scenarios_write on schedule_scenarios;
create policy schedule_scenarios_write on schedule_scenarios for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on schedule_scenarios to authenticated;
