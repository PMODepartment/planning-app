-- ============================================================================
-- Progress Photos — Photos Database columns
-- ----------------------------------------------------------------------------
-- The starter `progress_photos` table (supabase-schema.sql) predates the Power
-- Apps "Photos Database" screen it replaces. That screen's row is:
--   PHOTO · DESCRIPTION · TRADE · WORKS · LOCATION · CAPTURE DATE
-- `description`, `location`, `photo_url` and `taken_at` (capture date) already
-- exist; `trade` and `works` are the two genuinely new fields. `sort_order`
-- keeps a stable order for photos captured on the same day.
--
-- Idempotent — safe to re-run. Folded into supabase-schema.sql.
-- Requires the earlier storage-buckets migration (private `progress-photos`
-- bucket) and the project-access RLS migration.
-- ============================================================================

alter table progress_photos add column if not exists trade      text;
alter table progress_photos add column if not exists works      text;
alter table progress_photos add column if not exists sort_order integer;

-- Filters are always project-scoped and usually date-ordered.
create index if not exists progress_photos_proj_date_idx
  on progress_photos (project_id, taken_at desc);
