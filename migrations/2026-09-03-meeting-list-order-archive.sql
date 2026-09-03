-- Minutes of Meeting: manual drag-to-reorder + archiving the Meeting List.
-- ----------------------------------------------------------------------------
-- Meeting List item 5 ("provide option to manually organize/sort meetings in
-- list"): a plain, nullable `sort_order` on `meeting_minutes` (standalone
-- meetings) and `mom_schedules` (recurring series) — the same shape and the
-- same fallback rule issues-lessons already established
-- (2026-09-01-issues-lessons-reorder.sql): NULL means "no manual order has
-- been set yet" and the list falls back to its existing date-based order;
-- dragging a row assigns sort_order (spaced by 10) and that list's display
-- order becomes sort_order ascending, unordered rows sorting after the
-- ordered ones.
--
-- Meeting List item 1 (mid-turn addition): "select multiple meetings and
-- download… provide also a button to archive." A standalone meeting gets a
-- new `is_archived` flag. A recurring SERIES has no equivalent new column —
-- `mom_schedules.active` (2026-09-01) already means exactly "hide this from
-- the active list", so archiving a series simply sets `active = false`
-- rather than adding a second, redundant flag that could disagree with it.
--
-- Idempotent; safe to re-run.
-- ============================================================================

alter table meeting_minutes add column if not exists sort_order integer;
alter table meeting_minutes add column if not exists is_archived boolean not null default false;
alter table mom_schedules add column if not exists sort_order integer;
