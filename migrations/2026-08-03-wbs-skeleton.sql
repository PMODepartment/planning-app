-- ============================================================================
-- Migration: auto-generated WBS skeleton support.
-- Adds two columns to wbs_nodes so the Project Schedule module can seed a fixed
-- outline (Milestones / Initiation / Planning [Project Execution Plan / Design
-- Development / Procurement] / Execution) on a project's first load:
--   is_locked   — a skeleton heading: can't be renamed, recoded, moved, or deleted.
--   source_kind — a "special" heading whose contents come from ANOTHER module,
--                 not manual activities ('design_development' | 'procurement').
--                 Blocks "+ Add activity" / "+ Add WBS" under it.
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

alter table wbs_nodes add column if not exists is_locked boolean default false;
alter table wbs_nodes add column if not exists source_kind text;
