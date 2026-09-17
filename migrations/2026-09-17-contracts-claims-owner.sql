-- ============================================================================
-- Contracts & Claims: who is chasing each record.
--
-- Owner, 2026-09-17, on the project-level dashboard: the ageing band could say a
-- record had been with the client for 45 days, and the register could say what it
-- was worth, but nothing anywhere said WHOSE it was. "2 pending, oldest 45 days"
-- is a fact; "Alvarez has two, the older 45 days" is an instruction.
--
-- ⚠️ THIS FOLLOWS 2026-08-26-people-and-assignment.sql EXACTLY, and every note on
-- that migration applies here for the same reasons. Read it first. In short:
--
--   * ARRAY, not a single uuid. A claim genuinely can be run by two people (the
--     QS and the project manager), and a single-id column silently drops the
--     second name on the first save -- data loss disguised as a schema decision.
--     The form currently writes at most one; the column does not have to change
--     when that stops being true.
--
--   * THE FREE-TEXT COLUMN IS KEPT AND IS STILL WRITTEN. Not every person who
--     runs a claim has an account -- a consultant QS, the client's own surveyor --
--     and forcing ids would make them unnameable. The app writes BOTH on save so
--     the two cannot disagree; the ids are the machine-readable half and the text
--     is what a printed sheet shows.
--
--   * NO BACKFILL, deliberately. There is nothing to map from: no existing column
--     on this table names a person. Ids fill in as records are next saved, and a
--     record with nobody assigned simply does not appear in anyone's worklist,
--     which is honest -- nobody has said whose it is.
--
-- ⚠️ `if not exists` throughout, so running this twice is a no-op.
-- ============================================================================

alter table contracts_claims add column if not exists owner_ids uuid[] default '{}';
alter table contracts_claims add column if not exists owner     text;

-- GIN, because every personal-view query is a containment test
-- (`owner_ids @> array[auth.uid()]`) and a btree cannot serve that. Same index
-- shape as issues_lessons_champion_ids_idx and mom_items_owner_ids_idx.
create index if not exists contracts_claims_owner_ids_idx
  on contracts_claims using gin (owner_ids);

comment on column contracts_claims.owner_ids is
  'Who is chasing this record. uuid[] of app users; see 2026-08-26-people-and-assignment.sql for why this is an array and why the text column beside it is kept.';
comment on column contracts_claims.owner is
  'The same people as owner_ids, rendered as text, PLUS anyone with no account. Written by the app on every save so the two cannot disagree.';

-- ⚠️ NO RLS CHANGE. `contracts_claims` is already governed by the project-access
-- policies (2026-06-18-project-access-rls.sql) and adding a column does not alter
-- who may read or write the row. Assignment is not a permission: being named on a
-- claim does not grant access to the project, and must not, or assigning someone
-- would become a way to share data with them.
