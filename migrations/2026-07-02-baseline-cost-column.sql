-- ============================================================================
-- Migration: baseline planned cost (matches OPC's "BL Planned IBB" column).
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
-- ============================================================================
alter table project_schedule add column if not exists bl_cost numeric(18,2);

-- Optional: seed BL0 cost from the current Planned Cost where not set, mirroring
-- how bl_start/bl_finish were seeded from the current plan dates (see
-- 2026-06-30-schedule-baseline-columns.sql). Comment out if you prefer blank baselines.
update project_schedule
   set bl_cost = planned_cost
 where bl_cost is null;
