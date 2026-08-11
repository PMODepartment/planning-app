-- ============================================================================
-- Progress Photos — Schedule App integration (Phase 1)
-- ----------------------------------------------------------------------------
-- Locations are no longer a separate hand-maintained list: the picker in the
-- module now reads live from Project Schedule's `wbs_nodes` tree (already
-- shared in this same Supabase project — no new API, just a cross-module
-- read). This adds the columns needed to REFERENCE a zone rather than copy it:
--   - wbs_node_id : FK into wbs_nodes. `on delete set null` deliberately —
--     deleting a schedule zone must not delete photos captured there.
--   - activity_id / activity_name : a SNAPSHOT of the schedule activity that
--     was "current" for that zone at capture time (e.g. "Rebar Installation").
--     Deliberately NOT a live join — reports must keep showing what was true
--     when the photo was taken, even if the schedule activity later finishes
--     or is renamed. This mirrors the bl_cost / schedule_baselines snapshot
--     convention already used elsewhere in this app.
-- `location` (existing text column) is kept as the display cache — auto-filled
-- from the zone's breadcrumb when one is picked, but still free-text so a
-- photo that isn't tied to any schedule zone (site-wide shots, signage, etc.)
-- can still be tagged. This is intentional per MODULE_CONTRACT §6 (reference
-- the schedule app's data, don't force everything to be tracked).
--
-- Idempotent / safe to re-run.
-- ============================================================================

alter table progress_photos add column if not exists wbs_node_id uuid references wbs_nodes(id) on delete set null;
alter table progress_photos add column if not exists activity_id text;
alter table progress_photos add column if not exists activity_name text;

create index if not exists progress_photos_wbs_node_idx on progress_photos(project_id, wbs_node_id);

-- No RLS change needed: progress_photos' existing per-project policies already
-- cover the new columns, and wbs_nodes/activity_code_types/activity_code_values
-- are already readable by any approved user (is_approved()) per their own
-- policies — same as every other module that cross-reads the schedule.
