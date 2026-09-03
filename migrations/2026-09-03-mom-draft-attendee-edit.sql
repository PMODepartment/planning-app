-- ============================================================================
-- Migration: DRAFT MINUTES ARE EDITABLE BY THEIR ATTENDEES, NOT ONLY THEIR
-- CREATOR/A PLANNER (Individual View item 4, 2026-09-03).
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- WHY: the owner asked that "for drafts, all meeting attendees (not just the
-- creator/planner) should be able to see and edit the draft." Reading was
-- already project-wide — meeting_minutes_read has never carried a draft
-- carve-out (see 2026-08-20-department-minutes.sql, "Reading is unchanged").
-- The gap was entirely on the write side: `meeting_minutes_upd` and the
-- `mom_items_*` policies only ever let the CREATOR (or a planner) touch a
-- minute — attendees_required/_optional/_actual (2026-09-01) record who was
-- invited, but recording them never granted them anything.
--
-- ⚠️ ONLY WHILE THE MINUTE IS STILL A DRAFT. Once distributed, the record is
--    everyone's to read but nobody's to silently rewrite except its creator
--    or a planner — reverting to draft first is a deliberate act, not
--    something an attendee's edit should bypass.
--
-- ⚠️ DISTRIBUTING (AND REVERTING) STAYS OUT OF SCOPE. An attendee gets to
--    EDIT the record — title, agenda, the minutes themselves — never to
--    ISSUE it. The update policy's WITH CHECK below tests `is_distributed`
--    against the ROW BEING WRITTEN, so an attendee's own update is accepted
--    only while the row they are writing STAYS undistributed; they cannot
--    flip it themselves. (Deliberately NOT delegated to a function that
--    re-queries meeting_minutes for its own row — WITH CHECK's guarantee
--    about seeing the proposed NEW values only holds for the table's own
--    columns referenced directly, not for a subquery back into the same
--    table from inside the same statement, so the attendee test here reads
--    `attendees_required`/`_optional`/`_actual`/`is_distributed` as plain
--    columns rather than through a helper function.)
--
-- ⚠️ mom_items DOES get a helper (mom_is_attendee below) — it is a DIFFERENT
--    table, so a subquery into meeting_minutes from there has none of the
--    same-statement ambiguity; it simply reads that minute's current row.
-- ============================================================================

-- ---- 0) Guard: fail readably rather than with "function does not exist" -----
do $$
begin
  if to_regprocedure('public.is_writer()') is null then
    raise exception 'is_writer() is missing — run migrations/2026-07-21-viewer-readonly.sql first';
  end if;
  if to_regprocedure('public.mom_is_mine(uuid)') is null then
    raise exception 'mom_is_mine() is missing — run migrations/2026-08-20-department-minutes.sql first';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'meeting_minutes' and column_name = 'attendees_required'
  ) then
    raise exception 'meeting_minutes.attendees_required is missing — run migrations/2026-09-01-mom-schedules-attendees-item-history.sql first';
  end if;
end $$;


-- ---- 1) Helper for mom_items — "am I an attendee on this DRAFT?" -----------
-- ⚠️ SECURITY DEFINER + a pinned search_path, like every other helper here.
create or replace function mom_is_attendee(p_mom uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from meeting_minutes m
    where m.id = p_mom
      and not m.is_distributed
      and (
        (m.attendees_required -> 'ids') @> to_jsonb(auth.uid()::text)
        or (m.attendees_optional -> 'ids') @> to_jsonb(auth.uid()::text)
        or (m.attendees_actual -> 'ids') @> to_jsonb(auth.uid()::text)
      )
  );
$$;

grant execute on function mom_is_attendee(uuid) to authenticated;


-- ---- 2) meeting_minutes — widen UPDATE only ---------------------------------
-- Read and INSERT are untouched (an attendee doesn't create the record —
-- whoever ran the meeting does). DELETE is untouched on purpose: see the
-- header note above and canDeleteMinute() in module.js, which was deliberately
-- NOT broadened alongside canEditMinute().
drop policy if exists meeting_minutes_upd on meeting_minutes;
create policy meeting_minutes_upd on meeting_minutes
  for update using (
    can_access_project(project_id)
    and (
      is_planner()
      or (is_writer() and created_by = auth.uid())
      -- A draft ATTENDEE may edit the record too. `is_distributed` and the
      -- attendee columns here refer to the CURRENT (pre-update) row, since
      -- USING filters which existing rows may even be targeted.
      or (
        is_writer() and not is_distributed
        and (
          (attendees_required -> 'ids') @> to_jsonb(auth.uid()::text)
          or (attendees_optional -> 'ids') @> to_jsonb(auth.uid()::text)
          or (attendees_actual -> 'ids') @> to_jsonb(auth.uid()::text)
        )
      )
    )
  ) with check (
    can_access_project(project_id)
    and (
      is_planner()
      or (is_writer() and created_by = auth.uid())
      -- Tested against the ROW BEING WRITTEN — `is_distributed` here is the
      -- proposed NEW value, so an attendee's update is accepted only while
      -- the row they are writing stays undistributed. They cannot flip
      -- `is_distributed` themselves; only the creator or a planner can,
      -- through the branch above.
      or (
        is_writer() and not is_distributed
        and (
          (attendees_required -> 'ids') @> to_jsonb(auth.uid()::text)
          or (attendees_optional -> 'ids') @> to_jsonb(auth.uid()::text)
          or (attendees_actual -> 'ids') @> to_jsonb(auth.uid()::text)
        )
      )
    )
  );


-- ---- 3) mom_items — widen insert/update/delete the same way ---------------
-- ⚠️ OWNER ITEM 1 (2026-09-02) renamed these rows from "action items" to
-- "Minutes" — they ARE the record of what was said, so an attendee who may
-- now edit the draft's fields must also be able to add to / correct its
-- minutes, not just its header. Same three-way OR everywhere: planner, the
-- minute's creator (mom_is_mine), or a draft attendee (mom_is_attendee).
drop policy if exists mom_items_ins on mom_items;
create policy mom_items_ins on mom_items
  for insert with check (
    is_writer() and can_access_project(project_id)
    and (is_planner() or mom_is_mine(mom_id) or mom_is_attendee(mom_id))
  );

drop policy if exists mom_items_upd on mom_items;
create policy mom_items_upd on mom_items
  for update using (
    is_writer() and can_access_project(project_id)
    and (is_planner() or mom_is_mine(mom_id) or mom_is_attendee(mom_id))
  ) with check (
    is_writer() and can_access_project(project_id)
    and (is_planner() or mom_is_mine(mom_id) or mom_is_attendee(mom_id))
  );

drop policy if exists mom_items_del on mom_items;
create policy mom_items_del on mom_items
  for delete using (
    is_writer() and can_access_project(project_id)
    and (is_planner() or mom_is_mine(mom_id) or mom_is_attendee(mom_id))
  );

-- Done.
