-- ===========================================================================
-- Contracts & Claims — attachments on the RECORDS themselves
-- 2026-09-15
--
-- Owner: *"In the contracts & claims module there should also be an attach a
-- file feature in the contracts, claims, eot, and change order"*, and then, on
-- being shown the wizard: *"Yes there is an existing bucket but it can't be
-- accessed / there is no path for planners to upload them."*
--
-- He is right on both counts. The `contracts-claims` bucket has existed since
-- 2026-08-25-pmi.sql and its storage policies are already BUCKET-WIDE, not
-- PMI-scoped — so nothing about storage needs changing here. What was missing
-- is a table to hang a record's files off, and a screen to put them there.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) cc_attachments
-- ---------------------------------------------------------------------------
-- ⚠️ A SEPARATE TABLE FROM pmi_attachments, not a widened one. A PMI and a
--    contract record are different rows in different tables; making one
--    attachment table serve both would mean a nullable pmi_id AND a nullable
--    record_id with a check constraint holding the invariant — i.e. the
--    database no longer able to say what an attachment belongs to. Two narrow
--    tables with real foreign keys cost one more CREATE and answer that
--    question by construction.
create table if not exists cc_attachments (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  -- ⚠️ on delete CASCADE: an attachment is part of the record, not a document
  --    in its own right. Deleting a change order must not leave its cost
  --    proposal behind with nothing to explain what it was proposing.
  --    (The BUCKET object is removed by the app, which deletes the row first —
  --    a failed object delete leaves a recoverable orphan, the reverse leaves
  --    an attachment that will not open. Same ordering as pmi.js.)
  record_id   uuid not null references contracts_claims(id) on delete cascade,
  -- The vocabulary a commercial file actually arrives as. `other` is the
  -- default and always available, because a list that cannot express the file
  -- in front of you is a list people work around by mislabelling.
  doc_type    text not null default 'other'
              check (doc_type in ('signed_contract','variation_order','client_instruction',
                                  'cost_backup','programme_impact','correspondence',
                                  'certificate','other')),
  -- ⚠️ THE OBJECT PATH, NOT A URL. The bucket is private, so the URL is signed
  --    on demand; a stored URL expires and is then worse than useless because
  --    it still looks like a working link. Same construction as
  --    pmi_attachments.file_path and drawing_register.file_url.
  file_path   text not null,
  file_name   text,
  file_size   bigint,
  label       text,
  uploaded_by uuid references users(id),
  uploaded_at timestamptz default now()
);

-- Several files per type is the normal case (a variation carries the
-- instruction, the build-up and the client's reply), so this is deliberately
-- NOT unique on (record_id, doc_type).
create index if not exists cc_attachments_record_idx  on cc_attachments (record_id, doc_type);
create index if not exists cc_attachments_project_idx on cc_attachments (project_id);

-- ---------------------------------------------------------------------------
-- 2) RLS — the same two policies every register table in this app carries
-- ---------------------------------------------------------------------------
-- Read follows project access; write is planner-only. Copied from the loop in
-- 2026-08-25-pmi.sql rather than invented, so an attachment is visible to
-- exactly the people who can see the record it hangs off.
do $$
declare t text;
begin
  foreach t in array array['cc_attachments']
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
-- 3) No bucket work, and that is the point
-- ---------------------------------------------------------------------------
-- ⚠️ The `contracts-claims` bucket and its three storage policies already exist
--    (2026-08-25-pmi.sql §8) and are keyed on `bucket_id`, not on PMI. Read is
--    is_approved(), insert is is_writer(), delete is owner-or-is_planner().
--    Re-declaring them here would be a second definition of the same rule, and
--    the copy that drifts is the one nobody is looking at.
--
-- Verify:
--   select count(*) from cc_attachments;                       -- 0, and no error
--   select polname from pg_policy where polrelid = 'cc_attachments'::regclass;
--     -- cc_attachments_read, cc_attachments_write
--   select id, public from storage.buckets where id = 'contracts-claims';
--     -- contracts-claims | f      (already there; this migration does not touch it)
