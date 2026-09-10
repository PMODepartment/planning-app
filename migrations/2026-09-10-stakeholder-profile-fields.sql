-- ============================================================================
-- Stakeholder directory: the profile fields the Megawide Stakeholders app has
-- and this one did not
-- 2026-09-10
--
-- Owner adopted two things from the separate `mwstakeholderapp` build: the
-- "Stakeholder Universe" grid with A-Z bands, and a directory dashboard. The
-- VIEWS needed no schema. The PROFILE did: that app's person carries a middle
-- initial, a sub-sector, a secondary position, an Active/Inactive status and a
-- favourite flag, and `stakeholders` had none of them.
--
-- ⚠️ NO GRANT AND NO POLICY HERE, and that is correct rather than an omission.
--    Privileges and RLS are held by the TABLE; a column added to it inherits
--    both. (Contrast 2026-09-08-stakeholder-directory.sql, which CREATED the
--    table and shipped without a grant — every query failed with "permission
--    denied", which reads like an RLS fault and is not one.)
--
-- ⚠️ EVERY COLUMN IS NULLABLE OR DEFAULTED, so nothing that exists today changes
--    meaning when this runs, and the app works identically before and after.
--    The application reads the live column list and simply omits what is absent,
--    so an un-run migration degrades rather than breaking.
--
-- Idempotent: `add column if not exists` throughout. Safe to re-run.
-- ============================================================================

-- Middle initial. ⚠️ Its own column rather than being folded into `name`:
-- `stakeholders_name_org_uidx` is keyed on lower(btrim(name)), so writing
-- "Fernando M. Lozano" into `name` would make him a DIFFERENT person from
-- "Fernando Lozano" as far as the unique index — and duplicate prevention is
-- the entire reason that index exists.
alter table stakeholders add column if not exists middle_initial   text;

-- Sub-sector, one level under `category` (which holds Government / Private).
alter table stakeholders add column if not exists sub_sector       text;

-- A second post. ⚠️ Not an array: the source app models exactly two, and a
-- jsonb list would invite a third with no UI able to show it.
alter table stakeholders add column if not exists secondary_position text;

-- ⚠️ Active / Inactive on the PERSON, which is a different fact from whether a
--    project still engages them. A retired counterpart is inactive everywhere;
--    a project simply closing is not. Defaulted so every existing row reads
--    Active, which is what the app has assumed until now.
alter table stakeholders add column if not exists status           text not null default 'Active';

-- ⚠️⚠️ A PORTFOLIO-WIDE favourite, not a per-user one, and that is a real
--    limitation worth stating rather than discovering. Starring here marks the
--    person for everyone. A per-user favourite needs its own table
--    (stakeholder_id, user_id) and is deliberately not built on a guess about
--    whether anyone wants it.
alter table stakeholders add column if not exists is_favorite      boolean not null default false;

-- Read paths that filter or sort on these.
create index if not exists stakeholders_status_idx   on stakeholders (status);
create index if not exists stakeholders_favorite_idx on stakeholders (is_favorite) where is_favorite;

-- ⚠️ A guard, not decoration: 'active'/'ACTIVE'/'Archived' from three different
--    screens is how a status column stops being filterable. Added as NOT VALID
--    so the statement cannot fail on rows written before it existed, then
--    validated separately.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stakeholders_status_chk') then
    alter table stakeholders
      add constraint stakeholders_status_chk check (status in ('Active', 'Inactive')) not valid;
    alter table stakeholders validate constraint stakeholders_status_chk;
  end if;
end $$;

comment on column stakeholders.status is
  'Active | Inactive. A property of the PERSON (retired, moved on), not of any project''s engagement with them.';
comment on column stakeholders.is_favorite is
  'Portfolio-wide star, shared by every user. A per-user favourite would need its own table.';
