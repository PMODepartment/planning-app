-- ============================================================================
-- Migration: 2026-08-29 — 3D Reconstruction Requests (brief 6A / Phase 4)
-- Idempotent. Run in the Supabase SQL editor, then fold into supabase-schema.sql.
-- ============================================================================
--
-- A 3D reconstruction (video -> COLMAP -> OpenSplat, run on a rented GPU) is a
-- REAL PER-JOB COST, unlike every other write in this app. The owner's explicit
-- requirement: a request must be approved by an admin BEFORE it is sent to
-- the paid processing service — this is not a UI nicety, it is enforced here
-- at the RLS level, because a UI-only gate is one unauthenticated API call
-- away from being bypassed by anyone who can read this table's schema.
--
-- ⚠️ This table is DELIBERATELY NOT folded into the generic module-table RLS
-- loop (supabase-schema.sql's `foreach t in array [...]` block). That loop's
-- shape is "insert = own row, update = own row or admin" — applied here, a
-- REQUESTER could update their own row's `status` to 'approved' and defeat
-- the entire gate. This table gets its own, narrower policies instead.

create table if not exists reconstruction_requests (
  id                    uuid primary key default gen_random_uuid(),
  project_id            text references projects(id),
  location_values       jsonb default '{}'::jsonb,
  location              text,
  activity_id           text,
  activity_name         text,
  video_url             text,                 -- Storage path of the uploaded walkthrough video
  -- 'ground' (phone, Phase 4) | 'drone' (Phase 6) — same pipeline either way,
  -- per the brief's explicit "drone footage feeds the same underlying
  -- pipeline... rather than introducing a separate parallel system."
  video_source          text default 'ground',
  requested_note        text,                 -- optional context from the requester
  -- 'pending_approval' -> 'approved' | 'rejected' ; 'approved' -> 'queued' ->
  -- 'processing' -> 'done' | 'failed'. Every transition past 'pending_approval'
  -- either comes from an admin action (approve/reject) or from the trusted
  -- server-side webhook (queued/processing/done/failed) — never from the
  -- requester directly. See the RLS policies below.
  status                text default 'pending_approval',
  requested_by          uuid references users(id),
  approved_by           uuid references users(id),
  approved_at           timestamptz,
  rejected_reason       text,
  runpod_job_id         text,
  -- A per-request random token, generated at submit time and echoed back on
  -- the RunPod webhook call — the only thing standing between "a webhook
  -- claiming to be RunPod" and "the real one". Not a full HMAC signature
  -- scheme (RunPod's own webhook signing was not verified against here, since
  -- doing so needs a live RunPod account this environment doesn't have) but a
  -- real, non-guessable secret is far better than an open callback endpoint.
  webhook_token         text,
  result_pointcloud_url text,   -- COLMAP's scaled sparse/dense point cloud (.ply) — for measurement
  result_splat_url      text,   -- the trained Gaussian Splat (.ply) — for the navigable viewer
  result_stats          jsonb,  -- frame_count, colmap/opensplat timings, point count, etc.
  error_message         text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);
create index if not exists reconstruction_requests_proj_idx
  on reconstruction_requests (project_id, created_at desc);
create index if not exists reconstruction_requests_status_idx
  on reconstruction_requests (project_id, status);

alter table reconstruction_requests enable row level security;

-- READ: same transparency rule as every other register in this app — anyone
-- who can see the project can see its requests (so a requester can track
-- their own, and other planners can see what's already been asked for before
-- asking again). Visibility is not the gate; who can APPROVE is.
drop policy if exists reconstruction_requests_read on reconstruction_requests;
create policy reconstruction_requests_read on reconstruction_requests
  for select using (can_access_project(project_id));

-- INSERT: any approved non-viewer may REQUEST — but only as themselves, and
-- only ever starting at 'pending_approval'. The WITH CHECK on status is what
-- stops a crafted insert from creating a pre-approved row.
drop policy if exists reconstruction_requests_ins on reconstruction_requests;
create policy reconstruction_requests_ins on reconstruction_requests
  for insert with check (
    is_writer() and requested_by = auth.uid() and can_access_project(project_id)
    and status = 'pending_approval'
  );

-- UPDATE: admin-only, full stop. This is the actual gate — approving,
-- rejecting, and every status transition after that (queued/processing/
-- done/failed, written by the webhook using the service role, which bypasses
-- RLS entirely) all require this row, not a client-side check.
drop policy if exists reconstruction_requests_upd on reconstruction_requests;
create policy reconstruction_requests_upd on reconstruction_requests
  for update using (is_admin() and can_access_project(project_id))
  with check (is_admin() and can_access_project(project_id));

-- DELETE: admin any time, OR the original requester retracting their OWN
-- request while it is STILL pending — never once it has been approved (by
-- then a job may already be queued/running/billed, and retracting a row out
-- from under a job that references it would orphan the RunPod job).
drop policy if exists reconstruction_requests_del on reconstruction_requests;
create policy reconstruction_requests_del on reconstruction_requests
  for delete using (
    (is_admin() and can_access_project(project_id))
    or (requested_by = auth.uid() and status = 'pending_approval')
  );
