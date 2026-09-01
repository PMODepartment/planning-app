-- Issues & Concerns: reopening an On Hold issue back to Open.
-- ----------------------------------------------------------------------------
-- Item 1: On Hold now has its own way back to Open (a "Reopen Issue" button,
-- mirroring the existing Put On Hold / Close Issue reveal-panel workflow) and
-- it always asks for an Action Plan before the transition is allowed — the
-- same "narrative required before the status changes" rule Hold (Reason for
-- Hold) and Close (Closure Report) already follow. `action_plan` is a plain
-- nullable column: most rows never touch this transition, so there is nothing
-- to back-fill.
--
-- Idempotent; safe to re-run.
-- ============================================================================

alter table issues_lessons add column if not exists action_plan text;
