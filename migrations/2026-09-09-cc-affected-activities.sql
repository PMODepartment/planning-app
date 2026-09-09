-- ============================================================================
-- cc_affected_activities: which schedule activities a Change Order / EOT touches
--
-- Owner, 2026-09-09: *"adding change orders and extension of time the planner should be able to
-- easily select which activities are affected with the CO/EOT ... in a bulk manner in case that
-- the CO/EOT affects a lot ... by selecting affected activities based on the location and optional
-- to add other activities in the schedule as well."*
--
-- WHY A TABLE AND NOT A COLUMN. `project_schedule.change_order_ref` already exists and already
-- joins to `contracts_claims.reference_no` -- the schedule reads the register at index.html:6043 to
-- resolve it. It cannot carry this feature, for three separate reasons:
--   1. It is ONE text column, so a second variation overwrites the first. Real projects re-touch
--      the same activity: CO-014 adds work to 5F Formworks in March and EOT-003 cites the same
--      activity as its delay basis in June. Both facts have to survive.
--   2. Paired with `scope_type = 'change_order'` it already MEANS something else -- "this row IS
--      change-order scope". Writing it onto a main-contract activity to mean "this row is AFFECTED
--      BY that change order" overloads one column with two incompatible readings.
--   3. EOT has nowhere to go at all. There is no `eot_ref`, and there should not be one.
--
-- ⚠️⚠️ AN EOT LINK CARRIES NO DAYS, AND THAT IS THE WHOLE POINT OF THE SHAPE.
--    `contracts_claims.approved_days` stays the single contract-level figure the schedule already
--    sums (index.html:35194-35203: "Contract finish + granted days = Revised finish"). The rows in
--    THIS table are the delay BASIS -- evidence of which activities the delay ran through -- and
--    they are deliberately a SET, not numbers.
--    Storing days per activity would invite the obvious roll-up, and that roll-up is wrong: delay
--    on parallel paths is CONCURRENT. Two activities each slipping 10 days on two parallel paths is
--    10 days of project delay, not 20 -- only the critical path carries. A summed per-activity day
--    column would produce a figure nobody could defend in a claim, and this app already has a
--    roll-up that would happily report it. Same trap the BOQ allocations recorded from the other
--    direction: *"one line allocated across forty activities must contribute its amount once, so
--    the sum belongs on the allocation, not on the tag."*
--
-- ⚠️⚠️ KEYED ON `activity_id` (TEXT), NEVER ON `project_schedule.id`.
--    An import DELETES AND REINSERTS every row on the project, so every uuid changes and a uuid
--    link would be silently destroyed by the next import -- while the planner's Activity ID
--    survives, because it is the id the planner and Primavera both use. This is the rule the
--    schedule<->document links already follow and the reason `boq_tag_activities` keys the same way.
--
-- ⚠️ NO FOREIGN KEY TO project_schedule, on purpose.
--    `activity_id` carries no unique constraint (it is unique per project, not globally), so an FK
--    is not even declarable -- and if it were, it would make an import FAIL rather than merely
--    orphan a link. A link whose activity no longer exists is a real state that a planner needs to
--    see and re-point, not a constraint violation mid-import. The UI names those rows.
--
-- ⚠️ NO SECURITY-DEFINER RPC IS NEEDED FOR THIS FEATURE, and it is worth writing down why, because
--    `boq_tag_activities` in 2026-09-07-boq-manual.sql had to be one. That function UPDATES
--    `project_schedule`, and `project_schedule_upd` is gated on `created_by = auth.uid() or
--    is_admin()` -- so a planner who did not import the schedule cannot update its rows, and
--    PostgREST answers an RLS-filtered UPDATE with 200 and ZERO ROWS. Silent success.
--    Because the link lives in its own table, nothing here updates an activity anybody else
--    imported. `project_schedule` INSERT is only `is_writer() and created_by = auth.uid() and
--    can_access_project(...)` -- no ownership clause -- so even the bulk change-order insert needs
--    no definer function, and it runs in the schedule module where that arithmetic already lives.
--
-- Add-only and idempotent. Run in the Supabase SQL editor.
-- ============================================================================

create table if not exists cc_affected_activities (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null,
  cc_id       uuid not null references contracts_claims(id) on delete cascade,
  -- The planner's Activity ID, not a row uuid. See the note above.
  activity_id text not null,
  -- Free text for the one thing the set cannot say: WHY this activity is in it ("trenching
  -- re-routed", "access denied 12-24 Mar"). Never a number -- see the no-days note above.
  note        text,
  created_by  uuid,
  created_at  timestamptz default now(),
  -- One activity appears at most once per record. Makes re-saving the picker an upsert rather
  -- than a duplicate, and makes "is this activity already linked?" a single lookup.
  unique (cc_id, activity_id)
);

-- ⚠️ `on delete cascade` above is deliberate: the links are part of the record's own argument, not
--    independent data. Deleting CO-014 must not leave 23 rows pointing at nothing.

-- Both directions are queried: "what does this record touch?" (the record form, the wizard) and
-- "what touches this activity?" (the schedule's marker on every visible row).
create index if not exists cc_aff_cc_idx  on cc_affected_activities(project_id, cc_id);
create index if not exists cc_aff_act_idx on cc_affected_activities(project_id, activity_id);

alter table cc_affected_activities enable row level security;

-- Same four-policy shape 2026-07-21-viewer-readonly.sql establishes for every project-scoped
-- register table. Reading is project-wide; writing needs a non-viewer; changing or removing
-- somebody else's link needs to be your own row or an admin.
-- ⚠️ `drop policy if exists` before each create, so the file is re-runnable.
drop policy if exists cc_aff_read on cc_affected_activities;
create policy cc_aff_read on cc_affected_activities
  for select using (can_access_project(project_id));

drop policy if exists cc_aff_ins on cc_affected_activities;
create policy cc_aff_ins on cc_affected_activities
  for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id));

drop policy if exists cc_aff_upd on cc_affected_activities;
create policy cc_aff_upd on cc_affected_activities
  for update using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()))
          with check (is_writer() and can_access_project(project_id));

drop policy if exists cc_aff_del on cc_affected_activities;
create policy cc_aff_del on cc_affected_activities
  for delete using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()));

grant select, insert, update, delete on cc_affected_activities to authenticated;
