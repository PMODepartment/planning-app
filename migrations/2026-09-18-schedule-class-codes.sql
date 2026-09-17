-- ============================================================================
-- Migration: a merged activity carries EVERY class code it covers into the
-- schedule, not only the first one.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Owner, 2026-09-18: "if an activity is a merged activity, it should carry
-- multiple class codes to schedule."
--
-- ⚠️⚠️ WHY A NEW COLUMN RATHER THAN A DELIMITED `class_code`.
-- `project_schedule.class_code` is a SINGLE text value and every consumer of it
-- matches on EXACT equality:
--    * `boq.js` -> `scheduleSeedPlan` buckets activities by `a.class_code`;
--    * `boq_allocations` gates on it, which is what lets a bill line find the
--      activities it is priced against;
--    * the schedule's own `ccByCode` / `ccLevelOf` resolve it against the
--      Finance chart, and the grid's Class Code cell is an enum editor over it;
--    * the `cc1` / `cc2` / `cc3` grouping dims read it as a bucket key.
-- Putting "01050, 01100" in there resolves to NOTHING in every one of those, so
-- the merged activity would go from matching one code to matching none — and it
-- would do it silently, reading on screen as an off-chart code.
--
-- ⚠️⚠️ AND WHY NOT `activity_codes`. That jsonb is a map of
-- `code_type_id -> code_value_id`: ONE value per type, read everywhere as
-- `r.activity_codes[typeId]` and then resolved through `codeValueLabel`. An
-- array under a type key would break all ~10 readers. It is a per-project flat
-- mirror; this is the org-wide chart value, and the two are deliberately
-- different things (see the note above `taskPayload`).
--
-- ⚠️ `class_code` IS UNCHANGED and stays the canonical single value: the first
-- code the activity carries. `class_codes` is ADDITIVE — the full set, first
-- element equal to `class_code` — so every existing reader keeps working
-- untouched and only the readers that want the whole set opt in.
--
-- ⚠️ NO BACKFILL, deliberately. A row written before today carries exactly one
-- code and `class_codes` is null; every reader in this repo falls back to
-- `class_code` when the array is null or empty, so a null means "this row has
-- one code" rather than "unknown". Backfilling 150k rows to say something the
-- adjacent column already says would be churn with a lock attached.
-- ============================================================================

alter table project_schedule
  add column if not exists class_codes text[];

comment on column project_schedule.class_codes is
  'Every Finance class code this activity covers, first element = class_code. '
  'Null/empty means the single class_code is the whole answer. Written by the '
  'Schedule Setup push for a MERGED activity (one built from several SAP '
  'groups, or an SAP group carrying its level-3 items).';

-- ⚠️ An INDEX, because the whole point is that the BOQ can match on any element.
-- GIN over a text[] is what makes `class_codes && array['03051']` an index scan
-- rather than a sequential one over every activity in the project.
create index if not exists project_schedule_class_codes_idx
  on project_schedule using gin (class_codes);

-- ---------------------------------------------------------------------------
-- VERIFY — one statement, because the Supabase SQL editor shows only the LAST
-- statement's result (recorded 2026-09-16 (b), after three verify queries were
-- silently reduced to one).
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
     where table_name = 'project_schedule' and column_name = 'class_codes')      as column_present,   -- expect 1
  (select data_type from information_schema.columns
     where table_name = 'project_schedule' and column_name = 'class_codes')      as data_type,        -- expect ARRAY
  (select count(*) from pg_indexes
     where tablename = 'project_schedule'
       and indexname = 'project_schedule_class_codes_idx')                       as index_present,    -- expect 1
  (select count(*) from project_schedule where class_codes is not null)          as rows_with_set;    -- expect 0 before the first push
