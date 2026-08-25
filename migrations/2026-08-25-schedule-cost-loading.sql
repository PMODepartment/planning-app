-- ============================================================================
-- Cost Loading (Project Schedule) — how a project's cost is assigned to activities.
-- 2026-08-25
--
-- One config row per project. The config holds the WORKING state of the loading
-- exercise: a total per named activity, and how that total is distributed across
-- the sub-WBS instances of that name.
--
-- ⚠️ The MONEY ITSELF is not stored here. Applying the loading writes
-- `project_schedule.planned_cost` on each activity row — the column the Cost/EVM
-- dashboard, the exports and Cash Flow's cost-basis S-curve already read. A second
-- place holding per-activity cost would let two screens disagree about the same
-- peso, which is the failure this app has already had to fix in the equipment
-- matrix and the BOQ billing sheets.
--
-- ⚠️ The config keys its instances by `activity_id` (the P6/business key), NEVER by
-- the schedule row's uuid: a re-import replaces every row and mints new uuids while
-- the activity ids stay stable, so a uuid-keyed distribution would silently reset
-- to "equal" on the next import.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists schedule_cost_loading (
  project_id  text primary key references projects(id) on delete cascade,
  config      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz default now(),
  updated_by  uuid
);

alter table schedule_cost_loading enable row level security;

grant select, insert, update, delete on schedule_cost_loading to authenticated;

-- Project-scoped RLS (the 2026-07-21 convention):
--   read  = approved AND can access the project
--   write = writer role AND can access the project
drop policy if exists schedule_cost_loading_read  on schedule_cost_loading;
drop policy if exists schedule_cost_loading_write on schedule_cost_loading;

create policy schedule_cost_loading_read on schedule_cost_loading
  for select using ( can_access_project(project_id) );

create policy schedule_cost_loading_write on schedule_cost_loading
  for all using ( is_writer() and can_access_project(project_id) )
          with check ( is_writer() and can_access_project(project_id) );
