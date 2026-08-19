-- ============================================================================
-- Migration: CONTRACT SCOPE on schedule activities — is this line of work part
--            of the MAIN CONTRACT, or is it a CHANGE ORDER / variation?
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- WHY a column and not a WBS branch: a change order is almost never a tidy
-- branch hanging off the end of the schedule. A CO for "additional slab
-- openings on L5" belongs *inside* the structural sequence, between two main
-- contract activities, linked to both. Modelling it as a branch would force the
-- planner to choose between logical position and contractual identity. A tag
-- lets an activity sit where the WORK sits while still reporting where the
-- MONEY comes from — and the grid can then filter to Main contract only,
-- Change orders only, or blended (both), which is the whole point.
--
-- WHY execution phase only: initiation / planning / close-out activities are
-- project overhead, not contracted scope, so tagging them would invite a
-- meaningless "is the design review a change order?" question. The app only
-- surfaces the field on activities whose (inherited) phase is 'construction';
-- the column is nullable everywhere else, which reads as "not applicable".
-- ============================================================================

-- ---- 1) The columns --------------------------------------------------------
-- scope_type: null = untagged. On an execution-phase activity the app READS an
-- untagged row as Main Contract (the honest default — everything is main
-- contract until someone says otherwise), but it is stored as null so a real,
-- deliberate 'main' tag stays distinguishable from "never looked at".
alter table project_schedule add column if not exists scope_type       text;
-- The CO reference the planner writes on the sheet — "VO-014", "CO-2026-03".
-- Free text on purpose: change-order numbering is a contract convention, not
-- ours to constrain, and these come off the client's own correspondence.
alter table project_schedule add column if not exists change_order_ref text;
-- WBS nodes carry the same tag so a whole CO branch can be labelled once and
-- its activities inherit it (same inheritance rule as `phase`).
alter table wbs_nodes add column if not exists scope_type       text;
alter table wbs_nodes add column if not exists change_order_ref text;

-- ---- 2) Constrain the vocabulary ------------------------------------------
-- Two values, fixed. Free text here would fragment the filter the same way a
-- free-text phase would — and this one gates cost reporting, so "CO" vs
-- "Change Order" vs "change order" splitting a project's variation total into
-- three buckets is a real and expensive failure.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_schedule_scope_type_chk') then
    alter table project_schedule add constraint project_schedule_scope_type_chk
      check (scope_type is null or scope_type in ('main', 'change_order'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wbs_nodes_scope_type_chk') then
    alter table wbs_nodes add constraint wbs_nodes_scope_type_chk
      check (scope_type is null or scope_type in ('main', 'change_order'));
  end if;
end $$;

create index if not exists project_schedule_scope_type_idx on project_schedule (project_id, scope_type);
create index if not exists wbs_nodes_scope_type_idx        on wbs_nodes (project_id, scope_type);

-- ---- 3) No back-fill -------------------------------------------------------
-- Deliberately NOT seeding every existing execution-phase row to 'main'. The
-- app already reads null as Main Contract, so a back-fill would buy nothing and
-- would destroy the one thing null is good for: telling a planner which rows
-- have actually been reviewed for contractual scope.

-- Done. Group / filter / roll up the schedule by Contract Scope.
