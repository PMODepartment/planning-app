-- Issues, Concerns & Lessons Learned: manual drag-to-reorder.
-- ----------------------------------------------------------------------------
-- Adds a plain, nullable `sort_order` to both tables. NULL means "no manual
-- order has been set yet" — the log falls back to its existing date-based
-- order (newest first) exactly as before. Dragging a row in the Issues log,
-- the closed-issues table on the Lessons Learned screen, or the standalone
-- lesson cards assigns sort_order (spaced by 10, so a later drop can slot
-- between two existing values without renumbering everything) and from then
-- on that list's display order is sort_order ascending, with unordered rows
-- falling back to the date-based order after the ordered ones.
--
-- Idempotent; safe to re-run.
-- ============================================================================

alter table issues_lessons add column if not exists sort_order integer;
alter table lessons_learned add column if not exists sort_order integer;
