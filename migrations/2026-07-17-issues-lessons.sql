-- ============================================================================
-- Issues, Concerns & Lessons Learned — module columns
-- ----------------------------------------------------------------------------
-- The starter `issues_lessons` table (supabase-schema.sql) predates the Power
-- Apps "Issues & Concerns" screen this module reproduces. That screen's fields:
--   STATUS · DEPARTMENT · CHAMPION · ISSUE · CAUSED BY · CORRECTIVE ACTION ·
--   DATE PRESENTED · DAYS AGING (derived) · DATE RESOLVED
-- plus this module's addition — a LESSON LEARNED captured per issue so
-- management/operations can reference it later.
--
-- Field mapping to the existing table:
--   ISSUE          -> `description` (existing)
--   STATUS         -> `status`      (existing; Open | On Hold | Closed)
-- Genuinely new fields are added below. `type` is set to 'Issue' by the module
-- for these rows; a captured lesson lives on the same row (lesson_* columns) so
-- a lesson is never divorced from the issue that produced it.
--
-- Days Aging is DERIVED in the app (not stored): 0 when Closed, else
-- today − date_presented — so it is always live and needs no column.
--
-- Idempotent — safe to re-run. Folded into supabase-schema.sql.
-- Requires the project-access RLS + grants migrations.
-- ============================================================================

alter table issues_lessons add column if not exists department        text;
alter table issues_lessons add column if not exists champion          text;
alter table issues_lessons add column if not exists caused_by         text;
alter table issues_lessons add column if not exists corrective_action text;
alter table issues_lessons add column if not exists date_presented    date;
alter table issues_lessons add column if not exists date_resolved     date;

-- Lessons Learned (the module's addition) — captured on the issue itself.
alter table issues_lessons add column if not exists lesson_learned    text;
alter table issues_lessons add column if not exists lesson_category   text;
alter table issues_lessons add column if not exists recommendation    text;

-- Log is always project-scoped and ordered newest-presented first.
create index if not exists issues_lessons_proj_date_idx
  on issues_lessons (project_id, date_presented desc);
