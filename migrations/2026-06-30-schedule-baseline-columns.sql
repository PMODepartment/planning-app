-- ============================================================================
-- Migration: baseline (BL0) columns for the Project Schedule Gantt.
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
-- ============================================================================
alter table project_schedule add column if not exists bl_start  date;
alter table project_schedule add column if not exists bl_finish date;

-- Optional: seed BL0 from the current plan where not set, so existing rows
-- immediately show a baseline bar (comment out if you prefer blank baselines).
update project_schedule
   set bl_start  = coalesce(bl_start,  start_date),
       bl_finish = coalesce(bl_finish, end_date)
 where bl_start is null or bl_finish is null;
