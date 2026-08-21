-- ============================================================================
-- Migration: MINUTES OF MEETING — richer item schema, carry-over, draft/distribute.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run) —
-- but see the ⚠️ ONE-SHOT BACKFILL note in section 2, which is guarded so that a
-- re-run cannot move the same text twice.
--
-- Three changes the owner asked for together, in the order they depend on:
--
--   1. mom_items gains the fields the standalone mom-app has and this table did
--      not (`item_no` / `category` / `type` / `issue`, plus `action_item`), so the
--      PDF export stops mapping three printed blocks onto one stored field.
--   2. Carry-over: a new meeting can be seeded with the still-open actions of an
--      earlier one, CARRYING THE REGISTER LINK rather than re-raising.
--   3. Draft → Distribute: minutes are private to their recorder until issued.
--
-- ⚠️ 2 AND 3 ARE WHY THIS IS ONE FILE AND NOT THREE. Carry-over copies `issue_id`,
--    which changes what `mom_has_raised()` should mean (section 4), and the delete
--    policy that calls it was written in 2026-08-20-department-minutes.sql. And
--    distribution gates BOTH what can be read (section 5) and what may be raised
--    into the register (section 6). Split apart, any one of them leaves the other
--    two describing rules that are no longer true.
-- ============================================================================

-- ---- 0) Guard: fail readably rather than with "column does not exist" -------
do $$
begin
  if to_regclass('public.meeting_minutes') is null then
    raise exception 'meeting_minutes is missing — run migrations/2026-08-19-duration-scenarios-and-mom.sql first';
  end if;
  if to_regprocedure('public.mom_is_mine(uuid)') is null then
    raise exception 'mom_is_mine() is missing — run migrations/2026-08-20-department-minutes.sql first';
  end if;
  if to_regprocedure('public.is_writer()') is null then
    raise exception 'is_writer() is missing — run migrations/2026-07-21-viewer-readonly.sql first';
  end if;
end $$;


-- ============================================================================
-- 1) mom_items: the fields mom-app has and this table did not
-- ============================================================================
-- `seq` is NOT replaced by `item_no`. They answer different questions: `seq` is
-- the sort key the app maintains, `item_no` is the label a chair types on the
-- agenda ("3b", "carried from #12"). mom-app's `no` is free text for exactly that
-- reason, so this is text too — an int would refuse half the numbers in real use.
alter table mom_items add column if not exists item_no  text;
alter table mom_items add column if not exists category text;

-- The three-way classification the PDF badges. ⚠️ Constrained, unlike mom-app,
-- which lets any string in and then colours only three of them — a typo there
-- prints in the default grey and nobody finds out until the sheet is issued.
alter table mom_items add column if not exists type text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mom_items_type_chk') then
    alter table mom_items add constraint mom_items_type_chk
      check (type is null or type in ('Issue', 'FYI', 'Report'));
  end if;
end $$;

-- `issue` is the agenda topic — what was raised. `description` is the elaboration.
-- `action_item` is what somebody will now go and do. mom-app carries all three;
-- this table carried one.
alter table mom_items add column if not exists issue text;


-- ============================================================================
-- 2) ⚠️ ONE-SHOT BACKFILL: the action text moves out of `description`
-- ============================================================================
-- ⚠️ READ THIS BEFORE EDITING. `mom_items.description` has, since the table was
-- created, held THE ACTION — "Resequence L4 formworks", not a description of
-- anything. The PDF export already maps it to the sheet's "Action Item" block for
-- that reason. Now that `action_item` exists as its own column, leaving the text
-- in `description` would mean the same field means the action on old rows and the
-- elaboration on new ones, and no query could tell which.
--
-- So the text MOVES: description -> action_item, and description is emptied.
--
-- ⚠️ GUARDED ON THE COLUMN NOT HAVING EXISTED, not on the data. The obvious
--    idempotency test — "backfill where action_item is null" — is wrong: once a
--    user legitimately clears an action_item, a re-run would refill it from a
--    description that is now a different field, silently. Doing the move only in
--    the run that creates the column makes a re-run a no-op by construction.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mom_items' and column_name = 'action_item'
  ) then
    alter table mom_items add column action_item text;
    update mom_items set action_item = description where coalesce(description, '') <> '';
    update mom_items set description = '' where coalesce(description, '') <> '';
    raise notice 'mom_items: action text moved from description to action_item.';
  end if;
end $$;

-- `description` was `not null` because it WAS the action and an action with no
-- text is not an action. It is now the optional middle block, so the constraint
-- goes — but the default stays '' rather than null so nothing has to handle both
-- kinds of empty.
alter table mom_items alter column description drop not null;
alter table mom_items alter column description set default '';


-- ============================================================================
-- 3) Carry-over provenance
-- ============================================================================
-- Which item this one was carried from, and which meeting a minute was seeded
-- from. Both `on delete set null`: deleting the SOURCE meeting must not delete
-- the meeting that carried its actions forward — that would destroy the newer
-- record to tidy the older one.
alter table mom_items add column if not exists carried_from_item_id uuid
  references mom_items(id) on delete set null;
alter table meeting_minutes add column if not exists carried_from_mom_id uuid
  references meeting_minutes(id) on delete set null;

create index if not exists mom_items_carried_idx on mom_items (carried_from_item_id);


-- ============================================================================
-- 4) ⚠️ `mom_has_raised()` is re-defined, because carry-over changes what it means
-- ============================================================================
-- The delete policy in 2026-08-20-department-minutes.sql lets you delete your own
-- minutes only while nothing has been raised from them. The reason was precise:
-- issues in the register point BACK at the minute they came from, and
-- `on delete set null` strips that provenance silently rather than failing.
--
-- ⚠️ CARRY-OVER BREAKS THAT TEST AS WRITTEN. A carried item has an `issue_id` —
--    it is the same issue, still being chased — so the moment you seed a new
--    meeting from an old one, the OLD test says "something has been raised here"
--    and your brand-new draft becomes planner-delete-only. Nobody raised anything.
--
-- The provenance pointer (`issues_lessons.mom_id`) names the meeting the issue was
-- FIRST raised from, and carry-over never moves it. So deleting a meeting that
-- merely CARRIED the action destroys no provenance at all, and the test is
-- correspondingly narrowed to actions first raised HERE.
create or replace function mom_has_raised(p_mom uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from mom_items i
    where i.mom_id = p_mom
      and i.issue_id is not null
      and i.carried_from_item_id is null   -- carried, not raised here
  );
$$;


-- ============================================================================
-- 5) Draft → Distribute
-- ============================================================================
alter table meeting_minutes add column if not exists is_distributed boolean not null default false;
alter table meeting_minutes add column if not exists distributed_by uuid references users(id);

-- ⚠️ EXISTING MINUTES ARE BACKFILLED TO DISTRIBUTED, and the column defaults to
--    false only for rows created from here on. Every minute already in the table
--    was written in a world with no draft concept: it is already being read by the
--    site and already has actions raised off it. Letting the `false` default apply
--    to them would retroactively hide the entire history from everyone except each
--    minute's recorder — a data-loss-shaped event with no data lost.
--
-- ⚠️ Guarded on `distributed_at` NOT HAVING EXISTED, the same construction as the
--    section-2 backfill and for the same reason. The tempting data test — "nothing
--    is distributed yet, so this must be the first run" — is wrong: it is also true
--    of a project that has distributed nothing, or has reverted everything to
--    draft, and on those a re-run would publish every draft in the table.
do $$
declare n int;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'meeting_minutes' and column_name = 'distributed_at'
  ) then
    alter table meeting_minutes add column distributed_at timestamptz;
    update meeting_minutes set is_distributed = true,
                               distributed_at = coalesce(updated_at, created_at, now());
    get diagnostics n = row_count;
    raise notice 'meeting_minutes: % pre-existing minute(s) marked distributed.', n;
  end if;
end $$;

-- "Can this person see this minute at all?" — drafts are private to their
-- recorder (and to planners, who maintain the register).
create or replace function mom_is_visible(p_mom uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from meeting_minutes m
    where m.id = p_mom
      and (m.is_distributed or m.created_by = auth.uid() or is_planner())
  );
$$;

-- "Has this minute been issued?" — the guard on raising into the register.
create or replace function mom_is_distributed(p_mom uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select m.is_distributed from meeting_minutes m where m.id = p_mom), false);
$$;

grant execute on function mom_is_visible(uuid), mom_is_distributed(uuid) to authenticated;

-- ⚠️ READ is narrowed — this is the only part of draft/distribute that is a
--    SECURITY boundary, and so the only part enforced here. The "a distributed
--    minute is locked for editing" half is UI-only, deliberately: it is a workflow
--    guard, not a permission, and the person it stops is the one who may legally
--    revert it to draft two clicks later. (UI stricter than RLS is safe; the
--    reverse is the silent-failure trap the department-issues migration removed.)
drop policy if exists meeting_minutes_read on meeting_minutes;
create policy meeting_minutes_read on meeting_minutes
  for select using (
    can_access_project(project_id)
    and (is_distributed or created_by = auth.uid() or is_planner())
  );

-- ⚠️ mom_items MUST match, or a draft's action items are readable by everyone
--    while the minute heading them is not — which is the leak, not a lesser
--    version of it: the actions are the substance.
drop policy if exists mom_items_read on mom_items;
create policy mom_items_read on mom_items
  for select using (
    can_access_project(project_id) and mom_is_visible(mom_id)
  );


-- ============================================================================
-- 6) An action cannot be raised into the register out of an undistributed minute
-- ============================================================================
-- ⚠️ The register is the shared artefact. Raising from a draft publishes a line
--    out of a meeting record nobody has issued — and worse, the issue's "Raised
--    at: …" provenance would point at a minute the reader is not allowed to open
--    (section 5). Enforced in the DATABASE rather than the UI because, unlike the
--    edit lock, this one leaves a permanent row behind if it slips through.
drop policy if exists issues_lessons_ins on issues_lessons;
create policy issues_lessons_ins on issues_lessons
  for insert with check (
    is_writer()
    and can_access_project(project_id)
    -- Stamped as yourself. Without this a department user could file an issue
    -- under someone else's name, and "who raised this?" stops being answerable.
    -- ⚠️ Planners/admins are exempt: the Minutes-of-Meeting "raise as issue" flow
    -- and any future bulk import legitimately create rows on behalf of others.
    and (created_by = auth.uid() or is_planner())
    -- New in this migration. An issue with no `mom_id` is a normal register entry
    -- and is unaffected.
    and (mom_id is null or mom_is_distributed(mom_id))
  );


-- ============================================================================
-- 7) Grants unchanged
-- ============================================================================
grant select, insert, update, delete on meeting_minutes to authenticated;
grant select, insert, update, delete on mom_items to authenticated;

-- Done.
