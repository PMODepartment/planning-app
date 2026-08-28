-- ============================================================================
-- Migration: CHAMPIONS AND RESPONSIBLES BECOME PEOPLE, NOT TYPED TEXT.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Two things, and the second one is the reason for the first:
--   1. A roster an ordinary user may read, so Champion / Responsible can be a
--      dropdown instead of free text.
--   2. Assignment stored as user ids, so "show me what I own" is answerable.
--      A typed name cannot be resolved to an account, so a personal view built
--      on `champion` text would be a string match — and this register already
--      contains "Ronquillo, Jules Norman; Agcaoili, Heherson", which no
--      equality test will ever match against a login.
-- ============================================================================

-- ---- 1) The roster ---------------------------------------------------------
-- ⚠️ THIS IS A DELIBERATE, NARROW WIDENING OF WHO CAN SEE WHOM, and it needs to
-- be understood before it is extended. `users_self_read` is
-- `auth.uid() = id or is_admin()`, so until now a planner could not see that
-- anybody else existed. That is the correct default for a table holding email,
-- role, status and each person's project assignments.
--
-- ⚠️ SO THE POLICY IS NOT TOUCHED. Widening `users_self_read` would expose
-- email, role, `projects[]` and last_login to every approved user — far more
-- than a picker needs, and impossible to walk back once code depends on it.
-- Instead this function returns THREE columns and nothing else.
--
-- ⚠️ SECURITY DEFINER with a pinned search_path, like every other helper here
-- (an RLS-filtered sub-select inside a policy is how this schema acquired a
-- stack-depth recursion bug once — see 2026-06-18-fix-rls-recursion.sql).
create or replace function app_people()
returns table (id uuid, name text, department text)
language sql
security definer
set search_path = public
stable
as $$
  -- ⚠️ Callers who are not themselves approved get an EMPTY set, not an error.
  -- A pending or rejected account must not be able to enumerate the staff list,
  -- and a picker that renders empty is a better failure than one that throws.
  select u.id, u.name, u.department
  from users u
  where is_approved()
    and u.status = 'approved'
    -- ⚠️ A viewer is excluded: they cannot write anything, so making them a
    -- champion would assign work to someone the database will not let act on it.
    and u.role <> 'viewer'
  order by u.name;
$$;

revoke all on function app_people() from public;
grant execute on function app_people() to authenticated;

-- ---- 2) Assignment by id ---------------------------------------------------
-- ⚠️ ARRAYS, not a single uuid. The register's real data carries several
-- champions on one issue ("A; B"), and the Power Apps screen this reproduces
-- allowed it. A single-id column would silently drop the second name on the
-- first save, which is data loss disguised as a schema decision.
alter table issues_lessons add column if not exists champion_ids uuid[] default '{}';
alter table mom_items     add column if not exists owner_ids     uuid[] default '{}';

-- ⚠️ THE FREE-TEXT COLUMNS ARE KEPT AND ARE STILL WRITTEN. Three reasons, and
-- none of them is nostalgia:
--   * Not every champion has an account. A subcontractor's engineer is named on
--     an issue and will never log in; forcing ids would make them unnameable.
--   * Every existing row's champion is text, and exports/reports read it.
--   * The ids are the machine-readable half; the text is what a printed sheet
--     shows. The app writes BOTH on save so they cannot disagree.
--
-- ⚠️ AND THERE IS DELIBERATELY NO BACKFILL. Mapping "Ronquillo, Jules Norman"
-- to an account is a guess, and a wrong guess assigns one person's work to
-- another — the same reasoning that stopped `productivity_activities.
-- subcontractor` being auto-matched to a vendor. Ids fill in as rows are next
-- saved, and until then the text is still displayed. A row with no ids simply
-- does not appear in anyone's personal view, which is honest: nobody has said
-- whose it is in a way the database can act on.

-- GIN, because every personal-view query is a containment test
-- (`champion_ids @> array[auth.uid()]`) and a btree cannot serve that.
create index if not exists issues_lessons_champion_ids_idx
  on issues_lessons using gin (champion_ids);
create index if not exists mom_items_owner_ids_idx
  on mom_items using gin (owner_ids);

-- The personal view also asks "what did I raise", across every project.
create index if not exists issues_lessons_created_by_idx on issues_lessons (created_by);
create index if not exists lessons_learned_created_by_idx on lessons_learned (created_by);

-- ---- 3) Notes on what is NOT changed --------------------------------------
-- ⚠️ No RLS change on issues_lessons / mom_items / lessons_learned. Being a
-- champion does NOT grant edit rights: the rules stay
-- 2026-08-19-department-issues.sql (your own rows, or a planner) and
-- 2026-08-20-department-minutes.sql. Assignment says who OWES the work, not who
-- may rewrite the record — conflating the two would let anyone grant themselves
-- edit rights by putting their own name in the Champion box.
--
-- ⚠️ The personal view therefore needs NO new read policy either: it queries the
-- same tables under the same project-scoped rules, so it can only ever show a
-- user work on projects they can already access.
