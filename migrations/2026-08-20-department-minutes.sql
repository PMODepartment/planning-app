-- ============================================================================
-- Migration: DEPARTMENTS CAN RECORD MINUTES (the other half of D1).
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- WHY: `meeting_minutes` / `mom_items` were created (2026-08-19-duration-scenarios-
-- and-mom.sql) under the standard planner rule — `for all using (is_planner())` —
-- because the screen that edited them lived inside the Project Schedule module,
-- which is a planner tool. Minutes of Meeting has since moved into the Issues &
-- Concerns register, which is department-facing, and the owner has asked for
-- departments to record minutes there too. So this file does to minutes exactly
-- what D1 did to issues.
--
-- ⚠️ IT IS NOT A BLANKET WIDENING. `for all using (is_planner())` is one rule for
--    four commands; replacing it with `is_writer()` in the same shape would let any
--    approved non-viewer rewrite or delete ANOTHER department's minutes — a record
--    of what was said in a meeting they may not have attended. The three commands
--    get three different rules, mirroring the register beside them:
--      insert — any approved non-viewer, on a project they can access, stamped as
--               themselves.
--      update — planner+ on anything; everyone else only minutes THEY recorded.
--      delete — planner+ on anything; everyone else only their own, and only while
--               nothing has been raised from them (see the delete note below).
--
-- ⚠️ OWNERSHIP OF AN ACTION ITEM IS DERIVED, NOT STORED. `mom_items` has no
--    `created_by` and is not getting one: an action item belongs to its minute (it
--    is already `on delete cascade` from it), so "may I touch this action?" is the
--    same question as "may I edit the minute it is on?". A second ownership column
--    would be a second answer to that question, free to disagree with the first —
--    e.g. someone else's action item sitting inside minutes you own.
--
-- ⚠️ If 2026-08-19-duration-scenarios-and-mom.sql is ever re-run (it is idempotent,
--    so that is a reasonable thing to do), its do-block recreates the generic
--    `*_write` policies this file drops. Postgres ORs permissive policies, so that
--    would not re-narrow anything — those policies only ever grant to planners, who
--    already have everything here — but the file would then be misleading about what
--    governs writes. Re-run THIS file after it.
-- ============================================================================

-- ---- 0) Guard: fail readably rather than with "function does not exist" -----
do $$
begin
  if to_regprocedure('public.is_writer()') is null then
    raise exception 'is_writer() is missing — run migrations/2026-07-21-viewer-readonly.sql first';
  end if;
  if to_regclass('public.meeting_minutes') is null then
    raise exception 'meeting_minutes is missing — run migrations/2026-08-19-duration-scenarios-and-mom.sql first';
  end if;
end $$;


-- ---- 1) Helpers -------------------------------------------------------------
-- ⚠️ SECURITY DEFINER + a pinned search_path, like every other helper here: these
-- are called from inside RLS policies, and a policy whose sub-select is itself
-- filtered by RLS is how this schema got a stack-depth recursion bug once already
-- (see 2026-06-18-fix-rls-recursion.sql).

-- "Are these my minutes?" — the ownership question every mom_items rule asks.
create or replace function mom_is_mine(p_mom uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from meeting_minutes m
    where m.id = p_mom and m.created_by = auth.uid()
  );
$$;

-- "Has anything been raised out of these minutes?" — the delete guard.
create or replace function mom_has_raised(p_mom uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from mom_items i
    where i.mom_id = p_mom and i.issue_id is not null
  );
$$;

grant execute on function mom_is_mine(uuid), mom_has_raised(uuid) to authenticated;


-- ---- 2) meeting_minutes ----------------------------------------------------
alter table meeting_minutes enable row level security;

-- Reading is unchanged: anyone on the project reads the minutes. A meeting record
-- the site cannot read is not a record of anything.
drop policy if exists meeting_minutes_read on meeting_minutes;
create policy meeting_minutes_read on meeting_minutes
  for select using (can_access_project(project_id));

-- ⚠️ The generic policy MUST go, or it stays as a second permissive policy and
-- Postgres ORs them — leaving the file looking like it had changed the rules.
drop policy if exists meeting_minutes_write on meeting_minutes;

drop policy if exists meeting_minutes_ins on meeting_minutes;
create policy meeting_minutes_ins on meeting_minutes
  for insert with check (
    is_writer()
    and can_access_project(project_id)
    -- Stamped as yourself, so "who recorded this?" stays answerable — and because
    -- the update rule below is built on that answer. ⚠️ Planners are exempt for the
    -- same reason as the register: an import or a minute typed up on someone else's
    -- behalf is legitimate.
    and (created_by = auth.uid() or is_planner())
  );

drop policy if exists meeting_minutes_upd on meeting_minutes;
create policy meeting_minutes_upd on meeting_minutes
  for update using (
    can_access_project(project_id)
    and (is_planner() or (is_writer() and created_by = auth.uid()))
  ) with check (
    -- ⚠️ Asserted in BOTH clauses. With `using` alone a row could be updated OUT of
    -- your own ownership (hand it to someone else, or to nobody) and you would keep
    -- neither the right to fix it nor the record of having written it.
    can_access_project(project_id)
    and (is_planner() or (is_writer() and created_by = auth.uid()))
  );

drop policy if exists meeting_minutes_del on meeting_minutes;
create policy meeting_minutes_del on meeting_minutes
  for delete using (
    can_access_project(project_id)
    and (
      is_planner()
      -- ⚠️ WHY OWN-DELETE IS ALLOWED AT ALL, when the register's is not: the "+ New
      -- minutes" button INSERTS immediately and then lets you type, so a mis-click
      -- leaves a real empty row. Without this, every stray draft would need a
      -- planner to clear it.
      -- ⚠️ AND WHY IT IS GUARDED: once an action item has been raised, issues in the
      -- register point back at these minutes for their provenance ("Raised at: …",
      -- the From MOM tag). `on delete set null` means deleting the minute does not
      -- delete those issues — it silently strips where they came from. That is a
      -- planner's call, not a side effect of tidying your own drafts.
      or (is_writer() and created_by = auth.uid() and not mom_has_raised(id))
    )
  );

grant select, insert, update, delete on meeting_minutes to authenticated;


-- ---- 3) mom_items ----------------------------------------------------------
alter table mom_items enable row level security;

drop policy if exists mom_items_read on mom_items;
create policy mom_items_read on mom_items
  for select using (can_access_project(project_id));

drop policy if exists mom_items_write on mom_items;

-- All three write rules are the same question — "may I edit the minute this is on?"
-- ⚠️ Note there is NO own-row exemption on delete here, unlike the minute itself: an
-- action item is a line inside someone's minutes, so the minute's owner (or a
-- planner) maintains it. Removing a line never touches an issue raised from it —
-- `mom_items.issue_id` is the only link, and the issue is its own row.
drop policy if exists mom_items_ins on mom_items;
create policy mom_items_ins on mom_items
  for insert with check (
    is_writer() and can_access_project(project_id)
    and (is_planner() or mom_is_mine(mom_id))
  );

drop policy if exists mom_items_upd on mom_items;
create policy mom_items_upd on mom_items
  for update using (
    is_writer() and can_access_project(project_id)
    and (is_planner() or mom_is_mine(mom_id))
  ) with check (
    is_writer() and can_access_project(project_id)
    and (is_planner() or mom_is_mine(mom_id))
  );

drop policy if exists mom_items_del on mom_items;
create policy mom_items_del on mom_items
  for delete using (
    is_writer() and can_access_project(project_id)
    and (is_planner() or mom_is_mine(mom_id))
  );

grant select, insert, update, delete on mom_items to authenticated;


-- ---- 4) No back-fill ------------------------------------------------------
-- ⚠️ Existing minutes with a null `created_by` (recorded before this, or by an
-- import) become planner-only to edit. That is correct and deliberate: there is no
-- way to know whose they were, and guessing would hand someone edit rights over a
-- meeting record they never wrote. The UI says so on the row rather than showing a
-- disabled form with no explanation.

-- Done.
