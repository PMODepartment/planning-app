-- ============================================================================
-- Migration: remember which WBS names a planner matched to each location level.
--
-- WHY: the Location Wizard lets a planner state "the WBS node 'Ground Floor' IS
-- the Level 'Ground Floor'", "'Tower D - Substructure' IS the Tower 'Tower D'".
-- Without somewhere to keep that, the matching is a one-shot action that has to
-- be redone by hand after every re-import — and a re-import is exactly when it
-- is needed. Storing it makes the mapping a reusable, editable project asset,
-- and lets a later import apply the same matching automatically.
--
-- SHAPE: one jsonb map per level, keyed by the WBS node NAME as written in the
-- schedule, valued by the location value to write:
--     location_levels.match = { "Tower D - Substructure": "Tower D",
--                               "Tower D - Superstructure": "Tower D" }
-- Keyed by NAME, not by wbs node id, deliberately: the same name recurs under
-- every tower and trade (Avesta's "9th Floor" sits under 7 towers × 3 trades),
-- so matching by name is one decision instead of twenty-one, and it survives a
-- re-import that renumbers every node id.
--
-- ⚠️ Tolerant by design: the app treats a missing column as "no saved matching"
-- and still applies the wizard's result, so this migration is not a hard
-- prerequisite for the feature — only for remembering it.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

alter table location_levels add column if not exists match jsonb default '{}'::jsonb;

-- No index: the map is read with the level rows themselves (a handful per
-- project) and is never queried by its contents.
