-- ============================================================================
-- Migration: predecessors column (dependencies / critical path) + per-project
-- schedule rollup columns surfaced in the Portfolio / Program / Workspace views.
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
-- ============================================================================

-- Dependencies: comma-separated predecessor Activity IDs on each activity.
alter table project_schedule add column if not exists predecessors text;

-- Portfolio rollup summary stored on the project (written by the schedule module
-- whenever a schedule is loaded/imported/edited, so the Portfolio can read it cheaply
-- without re-scanning thousands of activity rows).
alter table projects add column if not exists schedule_progress   numeric;   -- overall % complete (0-100)
alter table projects add column if not exists schedule_start      date;
alter table projects add column if not exists schedule_finish     date;
alter table projects add column if not exists schedule_activities integer;
alter table projects add column if not exists schedule_updated_at  timestamptz;
