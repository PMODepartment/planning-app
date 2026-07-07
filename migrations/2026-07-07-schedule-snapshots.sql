-- ============================================================================
-- Migration: schedule snapshots — "where we said we'd be". One row per snapshot
-- holding a project SUMMARY plus every MILESTONE's forecast/baseline/contract
-- date (as jsonb), so planners can chart milestone drift over time without
-- storing all activities. Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists schedule_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  project_id         text not null,
  label              text,
  data_date          date,
  taken_at           timestamptz default now(),
  created_by         uuid,
  -- summary
  pct_complete       numeric,
  activities_total   int,
  activities_behind  int,
  milestones_total   int,
  milestones_at_risk int,
  project_finish     date,
  -- [{ id, name, forecast, baseline, contract }] per milestone
  milestones         jsonb default '[]'::jsonb
);

create index if not exists schedule_snapshots_project_idx on schedule_snapshots (project_id, taken_at desc);

-- RLS: approved users read; planners/admins write (mirrors workspaces/projects policies,
-- reusing the is_approved()/is_planner() helpers from the workspaces migration).
alter table schedule_snapshots enable row level security;

drop policy if exists schedule_snapshots_read on schedule_snapshots;
create policy schedule_snapshots_read on schedule_snapshots for select using (is_approved());

drop policy if exists schedule_snapshots_write on schedule_snapshots;
create policy schedule_snapshots_write on schedule_snapshots for all
  using (is_planner()) with check (is_planner());

grant select, insert, update, delete on schedule_snapshots to authenticated;
