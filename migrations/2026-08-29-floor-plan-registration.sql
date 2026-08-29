-- Top-view photo -> floor plan registration (18-item list, Batch H, item 17)
-- ------------------------------------------------------------------------------
-- Real point-based image registration: the planner clicks 3-4 matching points
-- on the DRAWING and on an uploaded TOP-VIEW PHOTO; cv.findHomography (OpenCV.js,
-- already loaded for panorama stitching) computes the 3x3 perspective transform
-- that warps the photo into the drawing's own coordinate frame. This is what
-- lets pins/clusters drawn in the drawing's normalized 0..1 space land in the
-- correct place on the "actual" (photo) view too.
--
-- One registration per (floor_plan, photo) pair — a plan can have at most one
-- active registration per photo, since two different point-pair sets for the
-- same photo would produce two disagreeing warps of the same image.
--
-- `homography` is STORED, not recomputed on every view: findHomography is a
-- few dozen milliseconds of OpenCV.js work per registration, and re-running it
-- on every render of the Plans screen for no reason is wasted GPU-adjacent
-- work in the browser. It's invalidated (this migration doesn't automate that
-- — the app recomputes and re-saves it) only when point_pairs changes.
--
-- Idempotent; folded into supabase-schema.sql.

create table if not exists floor_plan_registrations (
  id             uuid primary key default gen_random_uuid(),
  floor_plan_id  uuid references floor_plans(id) on delete cascade,
  photo_id       uuid references progress_photos(id) on delete cascade,
  project_id     text references projects(id),
  point_pairs    jsonb not null default '[]'::jsonb,  -- [{planX,planY,photoX,photoY}, ...] normalized 0..1
  homography     jsonb,                                -- the computed 3x3 matrix, [9 numbers], row-major
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (floor_plan_id, photo_id)
);
create index if not exists floor_plan_registrations_plan_idx on floor_plan_registrations (floor_plan_id);

alter table floor_plan_registrations enable row level security;
drop policy if exists floor_plan_registrations_read on floor_plan_registrations;
create policy floor_plan_registrations_read on floor_plan_registrations for select using (can_access_project(project_id));
drop policy if exists floor_plan_registrations_ins on floor_plan_registrations;
create policy floor_plan_registrations_ins on floor_plan_registrations for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id));
drop policy if exists floor_plan_registrations_upd on floor_plan_registrations;
create policy floor_plan_registrations_upd on floor_plan_registrations for update
  using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()))
  with check (is_writer() and can_access_project(project_id));
drop policy if exists floor_plan_registrations_del on floor_plan_registrations;
create policy floor_plan_registrations_del on floor_plan_registrations for delete
  using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
