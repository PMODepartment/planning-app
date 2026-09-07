-- Progress Photos — Add Media → Works: traceable Schedule Activity references
-- ------------------------------------------------------------------------------
-- Idempotent (add column if not exists); folds into supabase-schema.sql.
-- The app is TOLERANT of this column not existing yet (module.js's
-- tolerantWrite() strips it and retries, warning once) — running this late
-- costs nothing already saved, it just starts recording the trace going
-- forward. `works_multi` (the display names, already live) is untouched.
--
-- Why this column, and why it holds what it holds:
-- `progress_photos.works_multi` stores the CHOSEN Works values as plain
-- display text (activity names), deduped by name — the same activity name
-- commonly recurs across many WBS branches/floors of a real P6 schedule
-- (e.g. "Rebar Installation" on every level of a tower), so one Works entry
-- necessarily represents a GROUP of schedule rows, not a single one. Storing
-- a single "the" schedule row id per name is therefore a best-effort
-- traceability aid (the first/representative matching row), not a strict
-- foreign key — hence a plain text[], not a uuid[] FK array. It is
-- INDEX-ALIGNED with works_multi (same convention as WPM's own
-- awarded_vendor_ids/awarded_vendor_amounts): entry i here is the resolved
-- project_schedule.activity_id for works_multi[i], or NULL when the value
-- has no live schedule match (free text captured before this integration,
-- or an activity since renamed/removed).
alter table progress_photos add column if not exists works_activity_ids text[] default '{}'::text[];
comment on column progress_photos.works_activity_ids is
  'Index-aligned with works_multi: the resolved project_schedule.activity_id (the P6 business key) for each chosen Works value, or NULL when no live schedule match exists. Traceability only — nothing in the app matches/derives FROM this array, works_multi (the name) remains authoritative for display, filtering and grouping.';
