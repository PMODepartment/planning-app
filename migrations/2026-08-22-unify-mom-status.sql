-- 2026-08-22 — one status vocabulary for minutes and the register
--
-- ⚠️ READ THIS BEFORE EDITING.
-- `mom_items.status` and `issues_lessons.status` were two different lists:
--
--     mom_items        Open | In Progress | Closed
--     issues_lessons   Open | On Hold     | Closed
--
-- That drift was visible to the owner: an action raised into the register had to be
-- TRANSLATED on the way (`In Progress` -> `On Hold`), the minute's own filter had to
-- offer BOTH vocabularies because momItemStatus() could return either, and a raised
-- action's row could be filtered by a word its own dropdown did not contain.
--
-- The register's vocabulary wins (the owner's call): `On Hold`, not `In Progress`.
-- The register is the authoritative record of what is being chased, minutes feed it,
-- and its word is the one that appears on the dashboard's attention band
-- (assets/js/config.js -> attention.values = ['Open', 'On Hold']).
--
-- ⚠️ ORDER MATTERS. The existing CHECK forbids 'On Hold' and the new one forbids
-- 'In Progress', so neither can be added while rows or the other constraint disagree:
--   1) drop the old CHECK   2) move the rows   3) add the new CHECK
-- Doing (3) before (2) fails on every in-flight action in the database.

-- 1) ---------------------------------------------------------------------------
-- Dropped by DEFINITION, not by name: the constraint came from an inline `check`
-- in the create-table, so its name is Postgres-generated and is not guaranteed to
-- be `mom_items_status_check` on an instance that has been through a table rewrite.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'mom_items'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%In Progress%'
  loop
    execute format('alter table public.mom_items drop constraint %I', c.conname);
    raise notice 'mom_items: dropped old status CHECK %', c.conname;
  end loop;
end $$;

-- 2) ---------------------------------------------------------------------------
-- ⚠️ ONE-SHOT and idempotent: after this runs no row can hold 'In Progress' again,
-- because the CHECK added in (3) refuses it. Re-running is a no-op, not a second
-- translation — this maps a value to a value, it does not move a column.
update public.mom_items set status = 'On Hold' where status = 'In Progress';

-- Legacy rows predating any default. The column is nullable (default 'Open'), and a
-- null would render as 'Open' in a select that has no blank option — write the value
-- the screen already claims, so the data and the display agree.
update public.mom_items set status = 'Open' where status is null;

-- 3) ---------------------------------------------------------------------------
-- `not valid` is deliberately NOT used: (2) has just made every row conform, and a
-- constraint left unvalidated would not be trusted by later reads or by anyone
-- reading the schema to learn what the column may hold.
-- ⚠️ DROP-THEN-ADD BY NAME, not a bare `add constraint` — Postgres has no
-- `ADD CONSTRAINT IF NOT EXISTS` for table constraints (unlike columns, indexes
-- and policies elsewhere in this repo), so a bare add fails with "already exists"
-- on any re-run once this migration has applied once. This constraint's name is
-- OURS (chosen here, not Postgres-generated), so dropping it by name is safe —
-- unlike step (1) above, which has to hunt the OLD constraint by definition
-- because its name was never under our control.
alter table public.mom_items drop constraint if exists mom_items_status_chk;
alter table public.mom_items
  add constraint mom_items_status_chk
  check (status in ('Open', 'On Hold', 'Closed'));

-- 4) ---------------------------------------------------------------------------
-- The register side is left ALONE on purpose. `issues_lessons.status` already holds
-- exactly this vocabulary and carries no CHECK of its own (the column predates these
-- migrations); adding one here would be a separate decision about a separate table,
-- and it would fail on any historical row holding a word neither list anticipated.
-- Verify before considering it:
--     select status, count(*) from issues_lessons group by 1 order by 2 desc;

do $$
begin
  raise notice 'status vocabulary unified: Open | On Hold | Closed';
end $$;
