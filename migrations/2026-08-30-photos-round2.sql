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
