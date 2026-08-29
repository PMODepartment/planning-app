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
