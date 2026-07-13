-- ============================================================================
-- Migration: manual activity sequence for drag-and-drop row reorder (2026-07-11)
-- Adds project_schedule.seq_order — a per-activity manual sequence used to order
-- leaf siblings WITHIN their WBS parent (when no column sort is active). Null =
-- unset (falls back to Activity-ID order, i.e. today's behaviour). The grid drag-
-- and-drop renumbers a WBS's siblings 0,1,2,… on drop. Run in the Supabase SQL
-- editor. Idempotent.
-- ============================================================================

alter table project_schedule add column if not exists seq_order numeric;
