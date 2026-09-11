-- Minutes of Meeting: manual drag-to-reorder for the Meetings List (List view).
-- ----------------------------------------------------------------------------
-- Adds a plain, nullable `sort_order` to both `meeting_minutes` (standalone /
-- already-recorded meetings) and `mom_schedules` (recurring series) — the two
-- tables `momUnifiedRows()` combines into the one List-view table. NULL means
-- "no manual order has been set yet", so the list falls back to its existing
-- date-based order exactly as before.
--
-- The List view mixes rows from BOTH tables in one sequence, so the two
-- columns share a single numbering space by convention (spaced by 10 — same
-- idiom as 2026-09-01-issues-lessons-reorder.sql and mom_items.seq): dragging
-- a meeting row past a series row, or vice versa, renumbers both tables
-- together and there is nothing that needs them to be globally unique across
-- the two, only locally ordered relative to each other.
--
-- Entering manual order (the new drag-handle column, shown only while
-- "Manual order" is the active List sort) deliberately does NOT keep
-- favorites pinned to the top the way every other List sort does — see the
-- note above momSortedRows() in module.js for why: pinning would make a
-- dropped row land somewhere other than where it was dropped, which is worse
-- than simply not pinning while a planner is manually deciding the order.
--
-- Idempotent; safe to re-run.
-- ============================================================================

alter table meeting_minutes add column if not exists sort_order integer;
alter table mom_schedules add column if not exists sort_order integer;
