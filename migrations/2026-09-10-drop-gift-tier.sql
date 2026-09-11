-- ============================================================================
-- Drop `gift_tier` from the stakeholder tables.
--
-- Owner, 2026-09-10, on the project-level Stakeholder Map: "Let's drop the Gift
-- Tier as well." Asked whether to remove it from the UI only or to drop the
-- columns outright, the owner chose to drop them.
--
-- ⚠️⚠️ THIS IS IRREVERSIBLE AND IT DESTROYS DATA. Any gift tier ever recorded on
--    any stakeholder, on any project, is gone the moment this runs. There is no
--    backup taken here and `alter table ... drop column` cannot be undone by
--    re-adding the column — that gives you an empty one. This was stated before
--    the choice was made; it is restated here because the next person to read
--    this file will not have been in that conversation.
--
-- ⚠️ IF YOU WANT THE VALUES KEPT, STOP AND RUN THIS FIRST — it costs nothing and
--    makes the drop recoverable:
--
--      create table if not exists _archive_gift_tier_20260910 as
--      select id, project_id, name, gift_tier from public.stakeholder_map
--       where nullif(btrim(gift_tier), '') is not null
--      union all
--      select id, null::text, name, gift_tier from public.stakeholders
--       where nullif(btrim(gift_tier), '') is not null;
--
-- ⚠️ `gift_tier` is one of the 13 PERSON_FIELDS mirrored between `stakeholders`
--    (the directory) and `stakeholder_map` (the per-project register). Both sides
--    are dropped together, in one transaction: dropping one alone would leave the
--    mirror asymmetric, and every insert that still names the column would fail
--    against whichever table lost it. The application's own PERSON_FIELDS list is
--    updated in the same commit as this file.
--
-- Idempotent: `if exists` throughout, so a partial or repeated run is safe.
-- ============================================================================

begin;

-- How many values are about to be destroyed. Read this in the output BEFORE the
-- drop takes effect — the transaction has not committed yet at this point.
do $$
declare
  n_map int := 0;
  n_dir int := 0;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'stakeholder_map'
                and column_name = 'gift_tier') then
    execute 'select count(*) from public.stakeholder_map where nullif(btrim(gift_tier), '''''''') is not null'
      into n_map;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'stakeholders'
                and column_name = 'gift_tier') then
    execute 'select count(*) from public.stakeholders where nullif(btrim(gift_tier), '''''''') is not null'
      into n_dir;
  end if;
  raise notice 'gift_tier values being destroyed: stakeholder_map=%, stakeholders=%', n_map, n_dir;
  if n_map + n_dir > 0 then
    raise notice 'If that number is not acceptable, ROLLBACK now and run the archive query in the header first.';
  end if;
end $$;

alter table public.stakeholder_map drop column if exists gift_tier;
alter table public.stakeholders    drop column if exists gift_tier;

commit;

-- Verify: both should return 0 rows.
-- select table_name, column_name from information_schema.columns
--  where table_schema = 'public' and column_name = 'gift_tier';
