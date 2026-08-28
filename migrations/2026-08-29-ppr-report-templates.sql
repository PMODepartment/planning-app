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
