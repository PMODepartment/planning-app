-- ============================================================================
-- Migration: A CHAMPION WHO HAS NO ACCOUNT IS STILL A PERSON.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
-- Requires 2026-08-26-people-and-assignment.sql to have been run first.
--
-- THE PROBLEM THIS SOLVES. The people picker offers the roster (`app_people()`,
-- accounts only) plus a free-text line for everyone else. Free text works for
-- printing a sheet and nothing else:
--   * "Engr. Cruz" typed on one issue and "R. Cruz" on the next are two strings
--     nobody can group, filter or count — the exact fragmentation the group_heads
--     lookup table exists to prevent, and the reason the migration before this one
--     refused to guess a name -> account mapping.
--   * A second planner cannot REFERENCE that person. They retype the name, spell
--     it differently, and the register quietly holds three people who are one.
--
-- So: a directory of people who do not have (or do not yet have) a login, created
-- from the picker itself, stored ONCE, and offered to everyone from then on.
-- ============================================================================

-- ---- 1) The directory -------------------------------------------------------
-- ⚠️ ORG-WIDE, NOT PROJECT-SCOPED, and that is deliberate. A subcontractor's
-- engineer or a client's rep appears on several jobs; scoping the row to one
-- project would force the same person to be created again on each of them, which
-- is the fragmentation this table exists to end. `company` is what distinguishes
-- two people who share a surname, so it is the first thing the picker shows.
create table if not exists people_directory (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  company     text,                 -- subcontractor / consultant / client
  department  text,                 -- the discipline, when it is one of ours
  email       text,                 -- optional, for the day they get an account
  notes       text,
  -- ⚠️ Soft retirement, never a delete path in the app. A directory person is
  -- referenced by `champion_ids` / `owner_ids`, which carry NO foreign key
  -- (deliberately — see below), so deleting the row would leave every issue they
  -- own resolving to nothing. `active = false` drops them from the picker while
  -- every historical row still resolves to their name.
  active      boolean not null default true,
  created_by  uuid references users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ⚠️ Case-insensitive uniqueness on (name, company), so the second planner to
-- reach for "Engr. Cruz" gets the EXISTING row rather than a second one. Nulls
-- are distinct in Postgres, so coalesce the company or two rows with no company
-- would both be allowed through.
create unique index if not exists people_directory_ident_idx
  on people_directory (lower(trim(name)), lower(coalesce(trim(company), '')));

create index if not exists people_directory_active_idx on people_directory (active, name);

alter table people_directory enable row level security;

-- Read: any approved user. The picker is useless if you cannot see the roster,
-- and this table deliberately holds no more than a name, a company and a
-- department — the same three-column shape `app_people()` settled on.
drop policy if exists people_directory_read on people_directory;
create policy people_directory_read on people_directory
  for select using (is_approved());

-- ⚠️ Insert: any approved NON-VIEWER, stamped as themselves. Anyone who can raise
-- an issue must be able to name whoever owns it, or the picker sends them back to
-- free text and the fragmentation returns. A viewer writes nothing anywhere.
drop policy if exists people_directory_ins on people_directory;
create policy people_directory_ins on people_directory
  for insert with check (is_writer() and (created_by = auth.uid() or is_planner()));

-- ⚠️ Update: the person who created the entry, or a planner. A typo in a name
-- everyone now references has to be fixable by someone; letting ANY writer rename
-- a shared directory entry would let one project's correction rewrite another's.
-- `with check` as well as `using`, or a row can be updated out of your own
-- ownership, leaving you neither the right to fix it nor the record of writing it.
drop policy if exists people_directory_upd on people_directory;
create policy people_directory_upd on people_directory
  for update
  using (is_planner() or (is_writer() and created_by = auth.uid()))
  with check (is_planner() or (is_writer() and created_by = auth.uid()));

-- ⚠️ NO DELETE POLICY AT ALL, which means nobody can delete — including planners.
-- That is the point: `champion_ids` has no FK, so a delete cannot cascade or be
-- refused, it just silently turns every issue that person owns into an unresolvable
-- id. Retire with `active = false` instead. Add a delete policy only alongside a
-- migration that first re-points every array referencing the row.

-- ---- 2) One roster, two kinds of person -------------------------------------
-- ⚠️ `app_people()` GAINS A COLUMN, so it must be DROPPED first — Postgres cannot
-- change a function's return type with CREATE OR REPLACE, and the error it raises
-- is easy to mistake for a syntax problem.
drop function if exists app_people();

create or replace function app_people()
returns table (id uuid, name text, department text, company text, kind text)
language sql
security definer
set search_path = public
stable
as $$
  -- ⚠️ Callers who are not themselves approved get an EMPTY set, not an error.
  -- A pending or rejected account must not enumerate the staff list, and a picker
  -- that renders empty is a better failure than one that throws.
  select u.id, u.name, u.department, null::text as company, 'account'::text as kind
  from users u
  where is_approved() and u.status = 'approved' and u.role <> 'viewer'

  union all

  -- ⚠️ The directory is returned by the SAME function, so a caller cannot read one
  -- list and forget the other — which is precisely how a picker ends up offering
  -- accounts only and sending everyone back to free text. `kind` is what lets the
  -- UI say which people can actually be signed in as, without splitting the list.
  select d.id, d.name, d.department, d.company, 'contact'::text as kind
  from people_directory d
  where is_approved() and d.active

  order by 2;
$$;

revoke all on function app_people() from public;
grant execute on function app_people() to authenticated;

-- ---- 3) Notes on what is NOT changed ---------------------------------------
-- ⚠️ `issues_lessons.champion_ids` / `mom_items.owner_ids` are UNCHANGED and still
-- carry no foreign key. A directory id and an account id are both uuids and live
-- in the same array, because "who owns this" is one question with one answer list.
-- Adding an FK now would have to point at one table or the other and could not
-- express both.
--
-- ⚠️ THE CONSEQUENCE, STATED PLAINLY: a directory person can be a champion, but
-- they have no login, so the work assigned to them appears on NOBODY's My Work
-- page. That is honest rather than a gap — there is no account to show it to. The
-- register is where their items are chased, and the picker marks them so the
-- planner assigning the work knows which of the two they picked.
--
-- ⚠️ No back-fill of existing free text into the directory. Splitting
-- "Ronquillo, Jules Norman; Agcaoili, Heherson" into rows and guessing which
-- existing person each half is would assign one person's work to another — the
-- same reasoning that stopped the champion text being auto-matched to an account.
-- The free-text columns are still written and still displayed; entries appear in
-- the directory as planners create them.
