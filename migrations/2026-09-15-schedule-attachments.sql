-- ===========================================================================
-- Project Schedule — attachments on ACTIVITIES
-- 2026-09-15
--
-- Owner: *"attachments on activities in the Schedule module, in the Notes
-- section. The engine for that already exists now — attUpload/attOpen/attRemove
-- with the ordering rules, plus the contracts-claims bucket — but the schedule
-- is a different module with its own table, so it needs its own
-- activity_attachments table and migration."*
--
-- Right on all counts. The ENGINE is shared rather than copied (it moved to
-- assets/js/attach.js as PDAttach in the same change, and contracts-claims now
-- delegates to it), so the ordering rules below exist in exactly one place. What
-- is new here is the table those rules write to, and a bucket of its own.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) activity_attachments
-- ---------------------------------------------------------------------------
create table if not exists activity_attachments (
  id          uuid primary key default gen_random_uuid(),

  -- ⚠️ TEXT, not uuid. `projects.id` is the project CODE (AVR101, OPW101), not a
  --    surrogate key — the same trap that made 2026-09-10-scurve-manual-poc.sql
  --    fail to run with `42804 … incompatible types: uuid and text`. 26 tables in
  --    this schema already declare `project_id text references projects(id)`.
  project_id  text not null references projects(id) on delete cascade,

  -- ⚠️⚠️ THE PLANNER'S ACTIVITY ID, NEVER `project_schedule.id`.
  --    An import DELETES AND REINSERTS EVERY ROW, so a uuid foreign key here
  --    would be destroyed by the next import and every attachment on the project
  --    would cascade away with it. The Drawing Register and the Material
  --    Submittal Log already link into the schedule this way for exactly this
  --    reason. No FK is possible as a result: `project_schedule.activity_id` is
  --    not unique-constrained, and the row being pointed at may legitimately not
  --    exist yet (or any more).
  activity_id text not null,

  -- ⚠️⚠️ AND THIS COLUMN IS WHY THAT TRADE IS ACCEPTABLE. `activity_id` survives
  --    an import, but a REGENERATED schedule reissues the same generated id space
  --    (SB100000, SB300003 …) to different work — measured on 2026-09-14 (t),
  --    where 24 of 50 stale BOQ allocations silently re-attached to activities
  --    nobody had allocated them to. A broken link is visible; that one is not.
  --    Storing the activity's name AS IT WAS AT UPLOAD makes the mis-point
  --    detectable: the app compares it to the current name and says so rather
  --    than showing a method statement under work it was never written for.
  --    It is a tell-tale, not a second source of truth — nothing resolves by it.
  activity_name text,

  -- The vocabulary a SCHEDULE file actually arrives as. Deliberately NOT
  -- cc_attachments' commercial list: a variation order and a signed contract are
  -- not things that hang off one activity, and a method statement and a permit
  -- are not things that hang off a claim. `other` is the default and always
  -- available, because a list that cannot express the file in front of you is a
  -- list people work around by mislabelling.
  doc_type    text not null default 'other'
              check (doc_type in ('method_statement','drawing','permit',
                                  'site_instruction','inspection','photo',
                                  'delay_notice','correspondence','other')),

  -- ⚠️ THE OBJECT PATH, NOT A URL. The bucket is private, so the URL is signed on
  --    demand; a stored URL expires and is then worse than useless, because it
  --    still looks like a working link. Same construction as
  --    cc_attachments.file_path and pmi_attachments.file_path.
  file_path   text not null,
  file_name   text,
  file_size   bigint,
  label       text,
  uploaded_by uuid references users(id),
  uploaded_at timestamptz default now()
);

-- Several files per type is the normal case (a method statement, its approval
-- and the revised copy), so this is deliberately NOT unique on
-- (activity_id, doc_type).
create index if not exists activity_attachments_act_idx
  on activity_attachments (project_id, activity_id);
create index if not exists activity_attachments_project_idx
  on activity_attachments (project_id);

-- ---------------------------------------------------------------------------
-- 2) RLS + GRANTS — the same two policies every register table here carries
-- ---------------------------------------------------------------------------
-- ⚠️⚠️ THE GRANT IS NOT OPTIONAL AND IS NOT IMPLIED BY THE POLICY. RLS FILTERS
--    rows for a role that already holds the table privilege; it never confers
--    it. A migration that creates the table and its policies but no grant fails
--    every query with "permission denied for table activity_attachments" —
--    which reads like an RLS problem and is not one. That omission has shipped
--    twice here (the stakeholder directory, then 2026-09-10-scurve-manual-poc).
do $$
declare t text;
begin
  foreach t in array array['activity_attachments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select to authenticated using (can_access_project(project_id))', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all to authenticated using (is_planner() and can_access_project(project_id)) with check (is_planner() and can_access_project(project_id))', t || '_write', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3) A bucket of its own
-- ---------------------------------------------------------------------------
-- ⚠️⚠️ NOT the `contracts-claims` bucket, and this is a deliberate cost. Reusing
--    it would need no storage work at all — its three policies are keyed on
--    `bucket_id`, not on what the file hangs off, so they would have covered
--    schedule files on the day. What that buys is a bucket named
--    `contracts-claims` holding method statements and permits: the next person
--    reading the storage console cannot tell what is in it, and any future
--    decision about the commercial bucket (a retention rule, a revoke, an
--    export for a claim) silently applies to the schedule too. Three copied
--    policies is the cheaper half of that trade.
insert into storage.buckets (id, name, public)
values ('project-schedule', 'project-schedule', false)
on conflict (id) do nothing;

-- ⚠️ INSERT is `is_writer()`, NOT `is_approved()`. The 2026-06-18 buckets use the
--    older rule, which predates viewer-readonly and lets a VIEWER upload into a
--    register they cannot write a row to — an orphan file by construction. A new
--    bucket has no legacy uploads to protect, so it starts on the correct rule
--    rather than inheriting the drift. Same reasoning as 2026-08-25-pmi.sql §8.
drop policy if exists project_schedule_read on storage.objects;
create policy project_schedule_read on storage.objects
  for select using (bucket_id = 'project-schedule' and is_approved());

drop policy if exists project_schedule_ins on storage.objects;
create policy project_schedule_ins on storage.objects
  for insert with check (bucket_id = 'project-schedule' and is_writer());

-- ⚠️ DELETE keeps the owner branch beside is_planner(), the settled rule on the
--    other five buckets: a planner removing an attachment somebody else uploaded
--    must actually remove the object, or the row goes and the file is orphaned —
--    while the uploader keeps the right to remove their own.
drop policy if exists project_schedule_del on storage.objects;
create policy project_schedule_del on storage.objects
  for delete using (
    bucket_id = 'project-schedule' and (owner = auth.uid() or is_planner())
  );

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--   select count(*) from activity_attachments;          -- 0, and no error
--   select polname from pg_policy
--     where polrelid = 'activity_attachments'::regclass order by polname;
--     -- activity_attachments_read, activity_attachments_write
--   select has_table_privilege('authenticated','activity_attachments','select');
--     -- t   (this is the check the two missing-grant incidents would have failed)
--   select id, public from storage.buckets where id = 'project-schedule';
--     -- project-schedule | f
--   select polname from pg_policy where polrelid = 'storage.objects'::regclass
--     and polname like 'project_schedule%' order by polname;
--     -- project_schedule_del, project_schedule_ins, project_schedule_read
