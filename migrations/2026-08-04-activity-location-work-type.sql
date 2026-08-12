-- ============================================================================
-- Migration: Location Breakdown Structure (LBS) + work type on schedule activities.
--
-- WHY: location/zone previously existed ONLY as WBS tree structure, so the tree was
-- the one and only way to group a schedule (Location > Zone > Activity). Storing them
-- as activity DATA lets the grid group in any order — notably Activity > Location >
-- Zone — without touching the WBS tree.
--
-- SHAPE: the levels are per-project and configurable (Building / Level / Zone / Unit /
-- whatever a project uses), so this is an ordered list of LEVELS plus a compact jsonb
-- value map on each activity keyed by level id:
--     project_schedule.location = { "<location_level_id>": "Tower A", ... }
-- That is deliberately the SAME shape as activity_codes (a jsonb map keyed by a
-- definition-table id, not a join table), so the module's existing dynamic-column,
-- filter and grouping machinery applies to it unchanged.
--
-- ⚠️ Values are plain text per level, NOT a node tree. Zone "Z1" under two different
-- locations is the same string — they stay separate because grouping NESTS Zone under
-- Location. Grouping by Zone alone deliberately merges them ("everything in Z1").
--
-- RLS is project-scoped from the start (the 2026-07-21 fix pattern), not the older
-- un-scoped is_approved()/is_planner() shape that had to be corrected later.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists location_levels (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  name text not null,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists location_levels_project_idx on location_levels(project_id, sort_order);

alter table project_schedule add column if not exists location jsonb default '{}'::jsonb;
alter table project_schedule add column if not exists work_type text;

-- Grouping/filtering by work type scans this column on 17k–40k-row schedules.
create index if not exists project_schedule_work_type_idx on project_schedule(project_id, work_type);

alter table location_levels enable row level security;
drop policy if exists location_levels_read on location_levels;
create policy location_levels_read on location_levels
  for select using (can_access_project(project_id));
drop policy if exists location_levels_write on location_levels;
create policy location_levels_write on location_levels
  for all using (is_planner() and can_access_project(project_id))
  with check (is_planner() and can_access_project(project_id));
grant select, insert, update, delete on location_levels to authenticated;
