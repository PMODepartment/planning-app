-- Cost Loading: the spread curve travels with the money.
--
-- Owner 2026-08-26: "there should be a step wherein the manner of distribution of an activity is
-- defined… if bell curve, front loaded, back loaded, linear distribution. This is in order to give a
-- more accurate projection. … And then after all that data, that should be reported in the s-curve."
--
-- ⚠️ WHY A COLUMN ON project_schedule AND NOT JUST schedule_cost_loading.config.
-- `schedule_cost_loading` holds the Cost Loading exercise's WORKING STATE, and the settled rule for
-- this module is that applying writes the RESULT onto the activity: `planned_cost` is the column
-- Cost/EVM, the Excel export and the S-Curve's cost basis already read. The curve is the other half
-- of that same fact — how the activity's money is spent over its dates — so it has to travel the same
-- way. The S-Curve module reads `project_schedule` and nothing else; making it reach into another
-- module's working-state table would be a second source of truth for the same number, which is
-- exactly what "no new home for the money" exists to prevent.
--
-- ⚠️ NO CHECK CONSTRAINT, deliberately. The vocabulary is the client-side `curveCdf` set
-- (linear / front / back / bell) and `curveCdf` already falls back to linear for anything it does not
-- recognise. A CHECK would make adding a fifth shape a migration, and would reject a P6/XER import
-- carrying its own spelling instead of quietly reading it as linear. Same call as `wbs_nodes.name`
-- and `project_schedule.activity_type`, which is also an open vocabulary.
--
-- ⚠️ NULL MEANS LINEAR, and nothing is back-filled. `curveCdf('linear')` is the identity, so every
-- activity in every existing project keeps spreading exactly as it does today until a planner
-- deliberately chooses a shape. Back-filling 'linear' would write ~40k rows to assert the default.
--
-- Idempotent; safe to re-run.

alter table public.project_schedule
  add column if not exists cost_curve text;

comment on column public.project_schedule.cost_curve is
  'How this activity''s planned_cost is spent across its own dates: linear (default/null), front, back, bell. Written by Cost Loading''s "Spread over time" step; read by the S-Curve''s cost basis and the Activity Usage curves. Open vocabulary - an unrecognised value reads as linear.';
