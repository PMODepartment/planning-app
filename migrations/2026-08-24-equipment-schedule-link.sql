-- ============================================================================
-- Equipment Loading â link a line item's DURATION to the project schedule
-- 2026-08-24
--
-- The register already says what equipment the project has and how much of it is
-- on site each month. What it could not say is WHY a month is loaded: the planned
-- months were typed by hand, so when the schedule moved the loading sheet did not.
-- That is the failure mode the OPS sheet has today.
--
-- This adds the link. One equipment line item points at either ONE schedule
-- activity or a WBS BRANCH, and its planned months are then derived from that
-- activity's / branch's dates Ã a quantity:
--
--   link_mode      null | 'activity' | 'wbs'
--   link_activity_id  project_schedule.activity_id (mode 'activity')
--   link_wbs       WBS path prefix (mode 'wbs') â every activity under it
--   link_qty       units on site for every month the link spans
--   lead_months    mobilise this many months BEFORE the linked start
--   lag_months     stay this many months AFTER the linked finish
--   link_start / link_finish  the span resolved at the last sync (cached)
--   link_synced_at when that was
--
-- â ï¸ link_activity_id stores the schedule's own activity_id TEXT, not the row's
-- uuid. A re-import of the same programme replaces every project_schedule row
-- (new uuids) while the activity ids are exactly what stays stable â keying on
-- the uuid is how the drawing register lost its schedule links once already.
--
-- â ï¸ The cached span is a CACHE, never the truth. The module re-resolves it from
-- the schedule on load and shows a drift warning; it does not silently trust
-- these two columns. They exist so the register can render a duration without
-- a query per row, and so "the schedule moved" is detectable at all.
--
-- equipment_loading.source records who wrote a month: 'schedule' rows are owned
-- by the sync and are overwritten by it; anything else is a planner's own number
-- and the sync leaves it alone. Without this column a re-sync cannot tell its own
-- previous output from a hand correction, and would either wipe corrections or
-- keep stale months forever.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

alter table equipment_items add column if not exists link_mode text;
alter table equipment_items add column if not exists link_activity_id text;
alter table equipment_items add column if not exists link_wbs text;
alter table equipment_items add column if not exists link_label text;
alter table equipment_items add column if not exists link_qty numeric;
alter table equipment_items add column if not exists lead_months int default 0;
alter table equipment_items add column if not exists lag_months int default 0;
alter table equipment_items add column if not exists link_start date;
alter table equipment_items add column if not exists link_finish date;
alter table equipment_items add column if not exists link_synced_at timestamptz;

alter table equipment_loading add column if not exists source text default 'manual';

-- ⚠️ Which location level is the "tower" level is remembered in the site plan's own
-- jsonb (plan.level_id), not in a new column — the plan is read and written as one
-- picture, and a second write path for one field is how the two drift apart.
-- location_levels are per-project and free-form (Tower / Building / Zone / …), so
-- there is no fixed key to hard-code: the first version of this module passed the
-- literal string 'tower' as the level id, which matches nothing on any project.

-- Resolving a link means "earliest start and latest finish under this WBS branch".
-- Two indexed reads per item, so both need to be indexed reads.
create index if not exists project_schedule_actid_idx
  on project_schedule(project_id, activity_id);
create index if not exists project_schedule_wbs_idx
  on project_schedule(project_id, wbs);
