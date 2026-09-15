-- Progress Photos: a 360° background draft now survives the browser being
-- closed entirely, not just navigation within the same tab.
--
-- ⚠️⚠️ WHY THE 2026-09-13 "Save as draft" feature was NOT enough. That entry's
-- own note said so plainly: "Deliberately SESSION-scoped, not persisted
-- across a reload... there is no IndexedDB queue backing this... Closing the
-- tab or navigating away mid-stitch loses the in-flight promise and leaves
-- the draft row stuck at stitch_status:'processing' forever, with no raw
-- video stored to retry from." The DRAFT ROW (progress_photos, stitch_status
-- = 'processing') was durable; the actual INPUT to the stitch -- the raw
-- recorded video -- lived only as a JS Blob reference in one tab's memory.
--
-- ⚠️⚠️ "Processing continues while the browser is closed" is not literally
-- achievable and never will be for this app's locked architecture (vanilla
-- HTML/JS, GitHub Pages hosting, no server-side compute -- CLAUDE.md
-- "2026-06-18"). Nothing runs while every tab is closed. What THIS table
-- makes durable is the WORK: the uploaded video (a real Storage object) plus
-- a job record saying it is still owed a stitch. The next time ANY tab opens
-- this project, module.js's resumePending360Jobs() claims every outstanding
-- job and RESTARTS its stitch from the stored video -- not "resumes
-- mid-frame", which nothing here can do. That is the honest mechanism this
-- migration exists to support.
--
-- This is a small, TEMPORARY table by design: one row per in-flight
-- background 360 stitch. A finished job's row (and its video) is DELETED
-- once the stitch succeeds (module.js finalizeBackgroundDraft/
-- cleanupJobForPhoto) or once every automatic retry is exhausted
-- (markBackgroundDraftFailed) -- nothing here is meant to accumulate.
--
-- status:
--   'queued'      -- video uploaded, nobody is actively working on it right now
--   'processing'  -- a browser tab has claimed it and is running (or about to run) the stitch
--   'failed'      -- the most recent attempt failed; video_url is kept so a
--                    future attempt (automatic, up to PENDING_360_MAX_ATTEMPTS
--                    in module.js, or manual) can retry without re-recording
--
-- Idempotent — safe to re-run.

create table if not exists progress_photos_360_jobs (
  id            uuid primary key default gen_random_uuid(),
  project_id    text references projects(id),
  photo_id      uuid references progress_photos(id) on delete cascade,
  video_url     text not null,          -- Storage path (progress-photos bucket) of the RAW recorded video
  status        text not null default 'queued'
                  check (status in ('queued', 'processing', 'failed')),
  attempts      integer not null default 0,
  error_message text,
  claimed_by    uuid references users(id),
  claimed_at    timestamptz,
  created_by    uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists progress_photos_360_jobs_project_idx
  on progress_photos_360_jobs (project_id, status);

comment on table progress_photos_360_jobs is
  'Temporary: one row per in-flight 360 background stitch (module.js persistDraftVideoForResume/resumePending360Jobs). Deleted once the job finishes or exhausts its retries.';

alter table progress_photos_360_jobs enable row level security;

drop policy if exists progress_photos_360_jobs_read on progress_photos_360_jobs;
create policy progress_photos_360_jobs_read on progress_photos_360_jobs
  for select using (can_access_project(project_id));

drop policy if exists progress_photos_360_jobs_ins on progress_photos_360_jobs;
create policy progress_photos_360_jobs_ins on progress_photos_360_jobs
  for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id));

-- ⚠️⚠️ UPDATE deliberately carries NO owner restriction, unlike the generic
-- module-table pattern (created_by = auth.uid() or is_admin()). The whole
-- point of this table is that a DIFFERENT tab, device or planner can claim
-- and finish a job someone else started (the draft's own creator may never
-- come back to the app that closed on them) -- restricting updates to the
-- original creator would make that impossible and defeat the feature.
drop policy if exists progress_photos_360_jobs_upd on progress_photos_360_jobs;
create policy progress_photos_360_jobs_upd on progress_photos_360_jobs
  for update using (is_writer() and can_access_project(project_id))
  with check (is_writer() and can_access_project(project_id));

drop policy if exists progress_photos_360_jobs_del on progress_photos_360_jobs;
create policy progress_photos_360_jobs_del on progress_photos_360_jobs
  for delete using (is_writer() and can_access_project(project_id));

grant select, insert, update, delete on progress_photos_360_jobs to authenticated;
