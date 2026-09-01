/* ============================================================================
   RUN-OUTSTANDING — the 14 migrations added 2026-08-28 .. 2026-08-31 that had
   not been applied as of 2026-09-01, concatenated in filename (= intended
   application) order.

   Generated, not hand-written. It is a CONVENIENCE BUNDLE, not a new migration:
   the individual files in this directory remain the source of truth, and this
   file is deliberately NOT date-prefixed so that gen-verify.js and gen-build.js
   (both of which glob /^\d{4}-\d{2}-\d{2}-.*\.sql$/) never read it and never
   double-count the objects declared inside it.

   HOW TO RUN — Supabase SQL editor, paste whole, Run once.

   ⚠️ SAFE TO RE-RUN. Every constituent migration is idempotent (IF NOT EXISTS /
      DROP-before-CREATE POLICY), so applying one that is already live is a
      no-op rather than an error. If any single statement DOES fail, the ones
      before it have already committed: there is no wrapping transaction here,
      and none was added on purpose — a BEGIN/COMMIT around all 14 would make
      one failure silently discard thirteen good migrations.

   ⚠️ ORDER MATTERS in one place: the 2026-08-31 manpower migration extends the
      tables created by 2026-08-27-manpower-loading.sql, which is ALREADY
      APPLIED (confirmed signed-in on QADEMO, 2026-08-28) and so is not
      included below. If you are running this against a database that never got
      the 2026-08-27 file, run that one FIRST.

   NOT INCLUDED, because they were already applied:
     2026-08-26-people-and-assignment.sql
     2026-08-28-people-directory.sql
     2026-08-27-manpower-loading.sql

   AFTER RUNNING: execute migrations/VERIFY-schema.sql to confirm the whole
   schema, not just this bundle, matches what the repo declares.
   ============================================================================ */



/* ===========================================================================
   [ 1/14] 2026-08-28-photo-keyplan-and-ppr-meeting.sql
   =========================================================================== */

-- ============================================================================
-- Migration: 2026-08-28 — Progress Photos / PPR feedback round
-- Idempotent. Run in the Supabase SQL editor, then fold into supabase-schema.sql.
-- ============================================================================

-- Key Plan moves from the SLIDE to the PHOTO (owner feedback: "Key plan should
-- be per photo, not per slide" — each before/after photo now carries its own
-- key plan, so a slide's two panes can show different key plans instead of one
-- overlay shared across both).
alter table progress_photos add column if not exists key_plan_url text;

-- ppr_slides.key_plan_url is now DEPRECATED (kept, not dropped, so existing
-- rows/back-references don't break) — new code reads/writes the key plan on
-- progress_photos instead. Safe to drop in a later cleanup migration once
-- confirmed nothing still reads it.
comment on column ppr_slides.key_plan_url is
  'Deprecated 2026-08-28 — key plan is now per-photo (progress_photos.key_plan_url). Left in place for old rows; no longer written by new code.';

-- ppr_slides.trade / works / location are also DEPRECATED for the same reason
-- (owner feedback: before/after can be different locations, so a single
-- slide-level location no longer makes sense) — the slide now shows each
-- photo's own trade/works/location. Columns kept for backward compatibility.
comment on column ppr_slides.trade is
  'Deprecated 2026-08-28 — trade is now read from each slide''s before/after photo.';
comment on column ppr_slides.works is
  'Deprecated 2026-08-28 — works is now read from each slide''s before/after photo.';
comment on column ppr_slides.location is
  'Deprecated 2026-08-28 — location is now read from each slide''s before/after photo.';


/* ===========================================================================
   [ 2/14] 2026-08-29-archive-flag.sql
   =========================================================================== */

-- Progress Photos — soft-archive flag (2026-08-29 follow-up feedback)
-- ------------------------------------------------------------------------------
-- Owner: Presentations-list rows become Download / Preview / Archive, and the
-- Gallery gains a batch "Archive" action. Both need a non-destructive way to
-- retire a record without deleting it — a real delete would destroy a
-- meeting's history / a photo that a past presentation still cites (FKs are
-- `on delete set null`, so a hard delete already silently orphans slides that
-- reference it; archiving is the alternative that keeps the record intact).
--
-- Deliberately the SAME column name/shape on all four tables (`archived
-- boolean default false`) so the Gallery's unified merge (module.js's
-- mediaStripItems / the batch-action bar) can treat photos, panoramas and
-- reconstructions identically, and so a presentation list-row hides on the
-- same rule. Default false + no back-fill, so every existing row is
-- unaffected until someone explicitly archives it.
--
-- Idempotent; folded into supabase-schema.sql.

alter table progress_photos          add column if not exists archived boolean default false;
alter table ppr_presentations        add column if not exists archived boolean default false;
alter table panoramas                add column if not exists archived boolean default false;
alter table reconstruction_requests  add column if not exists archived boolean default false;

create index if not exists progress_photos_archived_idx         on progress_photos (project_id, archived);
create index if not exists ppr_presentations_archived_idx       on ppr_presentations (project_id, archived);


/* ===========================================================================
   [ 3/14] 2026-08-29-floor-plan-registration.sql
   =========================================================================== */

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


/* ===========================================================================
   [ 4/14] 2026-08-29-floor-plans.sql
   =========================================================================== */

-- Progress Photos — Floor Plan overlay (brief Section 6B / Phase 5)
-- ------------------------------------------------------------------
-- "BIM Model Overlay" here means what the brief's own examples describe:
-- placing a captured panorama / 3D reconstruction / photo as a PIN on a 2D
-- floor plan image, so a reviewer can click around a floor plan the way
-- Matterport's dollhouse/floor-plan view works. It deliberately does NOT mean
-- importing or registering against a real BIM/IFC model — that is a much
-- larger, separate undertaking (true 3D<->3D registration against an
-- authored BIM model) and was not attempted; noted plainly in
-- modules/progress-photos/CLAUDE.md rather than silently scoped down.
--
-- Idempotent; folded into supabase-schema.sql's per-module RLS loop.

create table if not exists floor_plans (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  name text not null,
  level_order integer default 0,
  image_url text,          -- storage object path in the progress-photos bucket, signed on demand
  width_px integer,
  height_px integer,
  created_by uuid references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_floor_plans_project on floor_plans(project_id);

-- One row per pin. item_type + item_id is a soft polymorphic reference
-- (panoramas / reconstruction_requests / progress_photos), not three
-- separate FK columns — a pin's target kind never changes after it's placed,
-- so this avoids three nullable FK columns where only one is ever non-null.
-- No hard FK to any of the three target tables: a pin surviving its target's
-- deletion (rendered as a broken/removable pin, never silently vanishing) is
-- safer than a cross-table trigger the module would have to maintain by hand.
create table if not exists floor_plan_pins (
  id uuid primary key default gen_random_uuid(),
  floor_plan_id uuid references floor_plans(id) on delete cascade,
  project_id text references projects(id),
  item_type text not null check (item_type in ('panorama', 'reconstruction', 'photo')),
  item_id uuid not null,
  x_norm double precision not null check (x_norm >= 0 and x_norm <= 1),
  y_norm double precision not null check (y_norm >= 0 and y_norm <= 1),
  label text,
  created_by uuid references users(id),
  created_at timestamptz default now()
);

create index if not exists idx_floor_plan_pins_plan on floor_plan_pins(floor_plan_id);
create index if not exists idx_floor_plan_pins_project on floor_plan_pins(project_id);

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'floor_plans' and policyname = 'floor_plans_rw') then
    execute 'alter table floor_plans enable row level security';
    execute 'create policy floor_plans_rw on floor_plans for all
      using (is_writer() and can_access_project(project_id))
      with check (is_writer() and can_access_project(project_id))';
    execute 'create policy floor_plans_read on floor_plans for select
      using (can_access_project(project_id))';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'floor_plan_pins' and policyname = 'floor_plan_pins_rw') then
    execute 'alter table floor_plan_pins enable row level security';
    execute 'create policy floor_plan_pins_rw on floor_plan_pins for all
      using (is_writer() and can_access_project(project_id))
      with check (is_writer() and can_access_project(project_id))';
    execute 'create policy floor_plan_pins_read on floor_plan_pins for select
      using (can_access_project(project_id))';
  end if;
end $$;


/* ===========================================================================
   [ 5/14] 2026-08-29-markup.sql
   =========================================================================== */

-- Photo/slide markup & annotation (18-item list, Batch F, items 13/14)
-- ------------------------------------------------------------------------------
-- Two SEPARATE stores, because a presentation slide's markup is explicitly
-- "native only to the presentation, not inherited by the photo" (the owner's
-- own wording):
--   1. progress_photos.markup  — the PHOTO's own permanent markup, follows the
--      photo everywhere it's used (Gallery lightbox, every slide that cites it).
--   2. ppr_slide_markups       — a PRESENTATION-ONLY overlay, keyed by
--      (ppr_slide_id, pane). Editing it never touches the photo's own markup,
--      and deleting the photo/slide takes its markup with it (cascade) rather
--      than leaving an orphaned annotation layer nobody can reach.
--
-- Format: a JSON ARRAY of vector drawing objects — {type, points/position,
-- color, strokeWidth, rotation, text, icon, ...} depending on `type`
-- ('pen'|'rect'|'circle'|'arrow'|'text'|'icon') — VECTOR, not a second
-- rasterized image, so it stays small, can be toggled on/off losslessly, and
-- re-renders correctly at any zoom level.
--
-- Idempotent; folded into supabase-schema.sql.

alter table progress_photos add column if not exists markup jsonb default '[]'::jsonb;
comment on column progress_photos.markup is 'Vector annotation layer: [{type,points|position,color,strokeWidth,rotation,text,icon}]. Hidden on Gallery tiles; shown only when a photo is opened.';

create table if not exists ppr_slide_markups (
  id            uuid primary key default gen_random_uuid(),
  ppr_slide_id  uuid references ppr_slides(id) on delete cascade,
  project_id    text references projects(id),
  pane          text not null check (pane in ('before', 'after')),
  markup        jsonb default '[]'::jsonb,
  created_by    uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (ppr_slide_id, pane)
);
create index if not exists ppr_slide_markups_slide_idx on ppr_slide_markups (ppr_slide_id);

-- Same read-all-approved / write-own-or-admin shape as every other module
-- table (see supabase-schema.sql's generic RLS loop) — restated standalone
-- here so this migration is a complete, runnable unit on its own.
alter table ppr_slide_markups enable row level security;
drop policy if exists ppr_slide_markups_read on ppr_slide_markups;
create policy ppr_slide_markups_read on ppr_slide_markups for select using (can_access_project(project_id));
drop policy if exists ppr_slide_markups_ins on ppr_slide_markups;
create policy ppr_slide_markups_ins on ppr_slide_markups for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id));
drop policy if exists ppr_slide_markups_upd on ppr_slide_markups;
create policy ppr_slide_markups_upd on ppr_slide_markups for update
  using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()))
  with check (is_writer() and can_access_project(project_id));
drop policy if exists ppr_slide_markups_del on ppr_slide_markups;
create policy ppr_slide_markups_del on ppr_slide_markups for delete
  using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()));


/* ===========================================================================
   [ 6/14] 2026-08-29-panoramas.sql
   =========================================================================== */

-- ============================================================================
-- Migration: 2026-08-29 — Panoramic Capture (brief Section 6 / Phase 3)
-- Idempotent. Run in the Supabase SQL editor, then fold into supabase-schema.sql.
-- ============================================================================

-- One row per stitched panorama. Location tagging mirrors progress_photos
-- exactly (location_values jsonb keyed by location_level id + a display-cache
-- `location` text) so the SAME location picker / Rounds-style combo logic
-- already built for photos works unmodified for panoramas.
create table if not exists panoramas (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id),
  location_values jsonb default '{}'::jsonb,
  location        text,
  activity_id     text,             -- snapshot of the "current activity" at capture
  activity_name   text,             -- time, same convention as progress_photos (not a live join)
  pano_url        text,             -- Storage path (progress-photos bucket, <project>/panoramas/)
  frame_count     integer,          -- how many source frames were stitched
  -- 'ok' | 'poor' — set by the CLIENT'S stitch-quality heuristic (match count
  -- / warp coverage), never silently upgraded. A 'poor' panorama is still
  -- saved (better than losing the walkthrough entirely) but flagged for
  -- re-capture rather than presented as a finished result. See brief 6.2:
  -- "Flag sessions with poor stitching quality... rather than silently
  -- publishing a bad panorama."
  stitch_quality  text default 'ok',
  taken_at        date,
  -- 'ground' | 'drone' (brief 6C / Phase 6) — mirrors
  -- reconstruction_requests.video_source. A panorama's stitching pipeline is
  -- identical either way; this is purely a provenance tag shown as a badge,
  -- same convention as the 3D request list's Drone badge.
  source          text default 'ground',
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists panoramas_proj_idx on panoramas (project_id, taken_at desc);

-- Idempotent add for a project where this migration already ran before the
-- `source` column existed (this migration is being edited in place while
-- still un-run everywhere — but add-if-missing costs nothing and protects
-- against exactly that race).
alter table panoramas add column if not exists source text default 'ground';

-- RLS: folded into supabase-schema.sql's generic module-table loop (same
-- read/write shape as progress_photos — no special approval gate here, unlike
-- 2026-08-29's reconstruction_requests). If running standalone before that
-- fold lands:
--   alter table panoramas enable row level security;
--   create policy panoramas_read on panoramas for select using (can_access_project(project_id));
--   create policy panoramas_ins on panoramas for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id));
--   create policy panoramas_upd on panoramas for update using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin())) with check (is_writer() and can_access_project(project_id));
--   create policy panoramas_del on panoramas for delete using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()));


/* ===========================================================================
   [ 7/14] 2026-08-29-photo-media-type.sql
   =========================================================================== */

-- Progress Photos — Video as a first-class media type (18-item list item 4)
-- ------------------------------------------------------------------------------
-- "Gallery accepts Photos, Videos, and 360/3D captures" — a video is a plain,
-- unprocessed upload (no relation to Gaussian Splatting/RunPod, which stays on
-- hold). It reuses EVERY existing progress_photos column (trade/works/location/
-- key plan/pins all apply the same way to a video clip as a photo); the only
-- new thing is WHICH element renders it.
--
-- Default 'photo' so every existing row is unaffected. No CHECK constraint —
-- the Gallery only ever writes 'photo'/'video' itself, and a CHECK would need
-- its own migration to loosen if a third kind is ever added; the enum lives in
-- the app (module.js), matching this repo's own convention elsewhere (e.g.
-- ppr_presentations.meeting_type has none either, for the same reason).
--
-- Idempotent; folded into supabase-schema.sql.

alter table progress_photos add column if not exists media_type text default 'photo';

comment on column progress_photos.media_type is '''photo'' | ''video'' — how the Gallery renders photo_url (<img> vs <video>). Never any relation to 360°/3D/Gaussian Splatting.';


/* ===========================================================================
   [ 8/14] 2026-08-29-photo-trades-works-multi.sql
   =========================================================================== */

-- Progress Photos — Trade/Works become multi-select (2026-08-29 feedback item 2)
-- ------------------------------------------------------------------------------
-- "Trades can also be multiple" — a photo can now carry several trades and
-- several works values at once. The existing singular `trade`/`works` text
-- columns are kept, deprecated: they hold the FIRST-selected value as a
-- display-cache fallback for any older code path that still reads them (the
-- same "kept in step, never re-derived from the array" convention already
-- used elsewhere in this module for `location` / `ppr_slides`' legacy
-- trade/works/location / `wbs_node_id`).
--
-- Idempotent; folded into supabase-schema.sql.

alter table progress_photos add column if not exists trades text[] default '{}'::text[];
alter table progress_photos add column if not exists works_multi text[] default '{}'::text[];

comment on column progress_photos.trade is 'Deprecated: first-selected value only. See trades (text[]).';
comment on column progress_photos.works is 'Deprecated: first-selected value only. See works_multi (text[]).';


/* ===========================================================================
   [ 9/14] 2026-08-29-pin-direction.sql
   =========================================================================== */

-- Floor Plan pins — direction/POV capture (18-item list, Batch E)
-- ------------------------------------------------------------------------------
-- A pin marks WHERE a photo/panorama/3D-scan was taken; direction_deg records
-- which way the camera was FACING, so the Floor Plan view can draw a cone
-- showing field of view, not just a dot.
--
-- Nullable, no default: a pin with no recorded direction is a perfectly valid
-- pin (older pins, or one placed without dragging out a direction) — it just
-- has no cone drawn. Degrees, 0-360, matching standard screen/compass
-- convention (0 = up/north on the plan image, clockwise) — the SAME
-- convention `atan2` on screen-space vectors naturally produces once negated
-- for screen Y being flipped, so the app's direction math and this column
-- agree without a stored offset.
--
-- Idempotent; folded into supabase-schema.sql.

alter table floor_plan_pins add column if not exists direction_deg double precision;

comment on column floor_plan_pins.direction_deg is 'Camera facing direction in degrees, 0-360 clockwise from up on the plan image. NULL = no direction recorded (valid).';


/* ===========================================================================
   [10/14] 2026-08-29-ppr-report-templates.sql
   =========================================================================== */

-- ============================================================================
-- Migration: 2026-08-29 — PPR Report Templates (brief Section 5, Phase 2)
-- Idempotent. Run in the Supabase SQL editor, then fold into supabase-schema.sql.
-- ============================================================================

-- A Report Template is a SAVED DEFINITION of a recurring report ("Weekly Client
-- Update — Tower B"): which locations to include, in what order, and how the
-- before/after comparison is chosen. Running it ("Generate") produces an
-- ordinary Meeting (ppr_presentations + ppr_slides) with slides auto-populated
-- from the CURRENT photo library — the template itself is never rendered
-- directly and holds no photos of its own.
--
-- `locations` is a JSONB array, not a join table — same call as
-- equipment_site_plan.plan (2026-08-24): it is read and written as ONE ordered
-- list in a single builder screen, never queried location-by-location, so a
-- relational table would only add round-trips for no query benefit. Shape:
--   [{ key, label, values, baseline_photo_id }]
-- - `key`   — the location's combo key (see progress-photos module.js
--             locCombos(): location_values levels joined with U+241F), OR any
--             string if a location was added by hand. Only used to detect
--             "this location is already in the template" in the builder UI.
-- - `label` — the display breadcrumb ("Tower A › 5th Floor › Zone 2"), so a
--             regenerated report and the template editor can show something
--             human-readable even if the underlying location_levels are later
--             renamed or removed.
-- - `values` — the location_values map (level_id -> value string) used to
--             resolve photos at generate time via superset match, the exact
--             mechanism resolveActivity()/lastCaptureAt() already use.
-- - `baseline_photo_id` — only meaningful when comparison_rule = 'baseline';
--             a SOFT reference (no FK — it's inside jsonb), resolved against
--             progress_photos at generate time and reported, not assumed, if
--             the photo no longer exists (deleted since the template was set up).
create table if not exists ppr_report_templates (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id),
  name            text not null,
  -- Free text, no CHECK: same call as meeting_minutes.meeting_type
  -- (2026-08-20) — "client"/"internal" are the brief's two examples, not an
  -- exhaustive vocabulary a planner should be blocked from extending.
  meeting_type    text default 'client',
  -- 'previous' = latest photo vs the one before it at that location, always
  -- live; 'baseline' = latest vs a photo pinned once per location (see
  -- locations[].baseline_photo_id above). Template-level, per the brief's
  -- own phrasing ("the comparison window... this week vs last week, or this
  -- week vs baseline") — one rule for the whole report, not per-location.
  comparison_rule text default 'previous',
  locations       jsonb default '[]'::jsonb,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists ppr_report_templates_proj_idx
  on ppr_report_templates (project_id, name);

-- RLS: folded into the generic module-table loop in supabase-schema.sql
-- (read = can_access_project, write = is_writer() + own-row-or-admin). If
-- running this file standalone before that fold lands, apply the same shape
-- by hand:
--   alter table ppr_report_templates enable row level security;
--   create policy ppr_report_templates_read on ppr_report_templates
--     for select using (can_access_project(project_id));
--   create policy ppr_report_templates_ins on ppr_report_templates
--     for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id));
--   create policy ppr_report_templates_upd on ppr_report_templates
--     for update using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()))
--     with check (is_writer() and can_access_project(project_id));
--   create policy ppr_report_templates_del on ppr_report_templates
--     for delete using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()));


/* ===========================================================================
   [11/14] 2026-08-29-reconstruction-requests.sql
   =========================================================================== */

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


/* ===========================================================================
   [12/14] 2026-08-30-photos-round2.sql
   =========================================================================== */

-- Progress Photos — 2026-08-30 feedback round, schema additions
-- ------------------------------------------------------------------------------
-- Idempotent (add column if not exists throughout); folds into supabase-schema.sql.
-- Every reader in the app is TOLERANT of these not existing yet (see module.js's
-- tolerantWrite / bim.js's savePinForItem / openPlanForm) — running this migration
-- late costs nothing already saved, it just starts storing the fields it enables.

-- Item 7: a required, free-text "view name" for the specific photo/view, kept
-- separate from `description` (which is optional and often blank) and from the
-- schedule-derived `location` (which names WHERE, not WHAT this particular shot
-- shows — e.g. "Facing east stairwell").
alter table progress_photos add column if not exists view_name text;
comment on column progress_photos.view_name is 'Required, free-text name for what this specific photo/view shows (2026-08-30 item 7). Distinct from description (optional) and location (schedule-derived, WHERE not WHAT).';

-- Item 28: the field-of-view cone is now two independently-draggable edge
-- points (normalized 0..1 of the plan image, same convention as x_norm/y_norm),
-- rather than a single angle+spread — "drag the end points... to adjust angle
-- AND range" needs two points, each with its own bearing and its own reach.
-- `direction_deg` (existing column) keeps being written as the bisector bearing
-- between the two edges, purely so renderers that only ever read that one
-- column (the Plans-page pin marker, the Gallery's key-plan preview popup)
-- keep drawing a sensible cone without being rewritten to understand edges.
-- `direction_na`: an EXPLICIT "this does not apply" mark for a top-view/aerial
-- photo, distinct from "nobody has set a direction yet" (NULL) — double-
-- clicking the cone in the Add/Edit Photo form sets this rather than merely
-- deleting the cone, so the distinction between "unknown" and "not applicable"
-- survives.
alter table floor_plan_pins add column if not exists edge1_x double precision;
alter table floor_plan_pins add column if not exists edge1_y double precision;
alter table floor_plan_pins add column if not exists edge2_x double precision;
alter table floor_plan_pins add column if not exists edge2_y double precision;
alter table floor_plan_pins add column if not exists direction_na boolean not null default false;
comment on column floor_plan_pins.edge1_x is 'Normalized x (0..1) of the field-of-view cone''s first edge endpoint, relative to the plan image. NULL = no cone drawn.';
comment on column floor_plan_pins.edge2_x is 'Normalized x (0..1) of the field-of-view cone''s second edge endpoint.';
comment on column floor_plan_pins.direction_na is 'Explicitly marked "does not apply" (e.g. a top-view/aerial photo with no facing direction) — distinct from direction_deg simply being unset.';

-- Item 12: a floor plan can now be tied to ONE node of the project's schedule
-- Location Breakdown (the same "pick any single node, any depth" model item 7
-- uses for photos), so uploading a plan asks for the location instead of a
-- typed name/level-order. Same jsonb shape as progress_photos.location_values
-- for consistency — a plan usually carries exactly one key, but the shape
-- allows more if a project ever needs it.
alter table floor_plans add column if not exists location_values jsonb not null default '{}'::jsonb;
comment on column floor_plans.location_values is 'The one schedule Location Breakdown node this floor plan corresponds to (2026-08-30 item 12). Empty object = not tied to a location (legacy plans, or a project with no Location Breakdown at all).';


/* ===========================================================================
   [13/14] 2026-08-30-photos-round3.sql
   =========================================================================== */

-- Progress Photos — fourth feedback round, schema additions
-- ------------------------------------------------------------------------------
-- Idempotent (add column if not exists throughout); folds into supabase-schema.sql.
-- Every reader/writer in the app is TOLERANT of these not existing yet (see
-- module.js's tolerantWrite / thumbUrlOf) — running this migration late costs
-- nothing already saved, it just starts storing/serving the field it enables.

-- Item 1: a REAL, separately-uploaded, downscaled preview file, produced
-- client-side at upload time (module.js's uploadThumbnailFor/
-- makeThumbnailBlob) and stored as its own Storage object alongside the
-- original -- NOT a request-time transform of the original. The prior
-- attempt at this (Supabase Storage's image-transform add-on) silently
-- degrades to full-resolution the moment that add-on isn't enabled on the
-- project's plan, which reads to a planner as "still slow" with no visible
-- cause; storing a genuinely smaller file removes that dependency entirely.
-- NULL for every row captured before this column existed (or before this
-- migration ran) -- thumbUrlOf() falls back to the transform request, then
-- to the full-resolution original, exactly as it already did.
alter table progress_photos add column if not exists thumb_url text;
comment on column progress_photos.thumb_url is 'Storage path of a client-generated downscaled JPEG preview (2026-08-30 item 1, fourth round), signed on demand like photo_url. NULL = no thumbnail yet (pre-migration capture, or generation failed) -- List/Gallery/Stack views then fall back to the Storage image-transform request, then to the full-resolution original.';

-- Item 5: non-destructive exposure/brightness/contrast/sharpness, applied at
-- RENDER time (CSS filter for the first three, a canvas convolution for
-- sharpness in the lightbox/editor only) -- the original file is never
-- touched or re-uploaded. Empty object (or column absent) = every value at
-- its default (0, unchanged); module.js's adjustmentsOf() fills in the
-- {exposure,brightness,contrast,sharpness} shape either way, so no reader
-- has to special-case a missing key.
alter table progress_photos add column if not exists adjustments jsonb default '{}'::jsonb;
comment on column progress_photos.adjustments is 'Non-destructive {exposure,brightness,contrast,sharpness} (each -100..100, 0=unchanged), 2026-08-30 item 5. Applied at render time only -- photo_url/thumb_url are never modified, so resetting to 0 always recovers exactly what the camera captured.';


/* ===========================================================================
   [14/14] 2026-08-31-manpower-org-schedule-manhours.sql
   =========================================================================== */

-- ============================================================================
-- Manpower Loading — Table of Organization, schedule/location tagging, manhours
-- 2026-08-31
--
-- Adds what the existing manpower_positions/manpower_loading/manpower_roster
-- tables (2026-08-27) could not yet do:
--
--   1. A real reporting-line hierarchy for the Table of Organization view, kept
--      OPTIONAL — a position with no manager still renders, grouped by
--      department, exactly as today. `reports_to_id` is a self-reference so a
--      planner who wants a true org tree can build one without a schema change.
--
--   2. `manpower_roster` gains the SAME schedule-link shape equipment_items
--      already carries (`2026-08-24-equipment-schedule-link.sql`) — one
--      activity or one WBS branch, plus a `location` jsonb keyed by
--      `location_levels.id` (the same shape `project_schedule.location`
--      already uses). ⚠️ This is a TAG, not a second source of derived
--      months — manpower_loading is still driven by the roster's own
--      contract_start/contract_end (2026-08-28's derivation). Linking a
--      subcontractor to an activity says WHERE they work, for the
--      Activities×Subcontractor matrix and the vertical stacking view; it
--      does not compute a duration a second, possibly-disagreeing way.
--
--   3. `manpower_manhours` — one row per (roster entry, month), planned and
--      actual hours. ⚠️ Its own table, not a jsonb blob and not columns on
--      manpower_roster, for the same reason manpower_loading is its own
--      table: two people editing different months must not clobber each
--      other, and the database needs to sum it per month.
--
-- ⚠️ `location` on manpower_roster is intentionally NOT restricted to any
-- workforce category at the database level. The UI only offers it for Skilled
-- Self-Performed / Subcontractors (an office-based Project Staff profile has
-- no site location to tag), but that is a UI decision, not a data rule the
-- schema should enforce — a category renamed or reused later must not need a
-- migration to keep working.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

alter table manpower_positions add column if not exists reports_to_id uuid
  references manpower_positions(id) on delete set null;
create index if not exists manpower_positions_reports_to_idx
  on manpower_positions(reports_to_id);

alter table manpower_roster add column if not exists link_mode text;         -- null | 'activity' | 'wbs'
alter table manpower_roster add column if not exists link_activity_id text;  -- project_schedule.activity_id
alter table manpower_roster add column if not exists link_wbs text;          -- WBS path prefix
alter table manpower_roster add column if not exists link_label text;        -- cached display name
alter table manpower_roster add column if not exists link_start date;        -- resolved span, cached
alter table manpower_roster add column if not exists link_finish date;
alter table manpower_roster add column if not exists link_synced_at timestamptz;
alter table manpower_roster add column if not exists location jsonb default '{}'::jsonb;

-- Same two indexed reads equipment_items' link resolution relies on.
create index if not exists project_schedule_actid_idx on project_schedule(project_id, activity_id);
create index if not exists project_schedule_wbs_idx on project_schedule(project_id, wbs);

create table if not exists manpower_manhours (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  roster_id uuid not null references manpower_roster(id) on delete cascade,
  period date not null,                   -- first day of the month
  planned_hours numeric,
  actual_hours numeric,
  source text,                            -- 'hand' — reserved for a future derivation source
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- One row per roster entry per month, for the same reason manpower_loading has
-- one per (position, month): without it two browsers can each insert the same
-- month and every manhours total silently double-counts it.
create unique index if not exists manpower_manhours_uni
  on manpower_manhours(roster_id, period);
create index if not exists manpower_manhours_project_idx
  on manpower_manhours(project_id, period);

grant select, insert, update, delete on manpower_manhours to authenticated;
alter table manpower_manhours enable row level security;
drop policy if exists manpower_manhours_read on manpower_manhours;
create policy manpower_manhours_read on manpower_manhours
  for select using (can_access_project(project_id));
drop policy if exists manpower_manhours_write on manpower_manhours;
create policy manpower_manhours_write on manpower_manhours
  for all using (is_writer() and can_access_project(project_id))
  with check (is_writer() and can_access_project(project_id));

drop trigger if exists manpower_manhours_touch on manpower_manhours;
create trigger manpower_manhours_touch before update on manpower_manhours
  for each row execute function public.manpower_touch();

-- ⚠️ Re-declared here (identical to 2026-08-24-equipment-loading.sql) so this
-- module does not depend on Equipment Loading's migration having been run
-- first. `create or replace` on an identical body is a no-op if it already
-- exists; SECURITY INVOKER so the caller's own RLS on project_schedule still
-- applies — never DEFINER, which would leak another project's locations.
create or replace function public.project_location_values(p_project_id text, p_key text)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('value', v, 'n', n) order by v), '[]'::jsonb)
  from (
    select trim(location ->> p_key) as v, count(*) as n
    from project_schedule
    where project_id = p_project_id
      and coalesce(activity_type, '') <> 'WBS Summary'
      and nullif(trim(coalesce(location ->> p_key, '')), '') is not null
    group by 1
  ) t;
$$;
grant execute on function public.project_location_values(text, text) to authenticated;


/* ===================== end of bundle: 14 migrations ====================== */
