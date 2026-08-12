-- ============================================================================
-- Migration: project PHASE (Initiation / Planning / Construction / Close-out)
--            as a tag on schedule activities and WBS nodes.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- WHY a tag and not four seeded WBS roots: the WBS is already the file's own
-- structure (P6/OPC imports bring their own tree, and the locked skeleton has
-- its own shape). Forcing four roots would reshuffle every existing schedule.
-- A tag composes with the N-level grouping engine instead — Phase becomes just
-- another dimension you can group, filter and roll up by, exactly like
-- Location, Work Type and Work Package.
-- ============================================================================

-- ---- 1) The column ---------------------------------------------------------
-- Nullable on purpose: an untagged activity is "not yet classified", which is
-- the honest state for every row that already exists. It buckets into
-- "— No phase —" in the grid rather than being silently called Construction.
alter table project_schedule add column if not exists phase text;
alter table wbs_nodes       add column if not exists phase text;

-- ---- 2) Constrain the vocabulary ------------------------------------------
-- Four phases, fixed. A free-text phase fragments the grouping the same way a
-- free-text group head would — and this one drives roll-ups, so a typo would
-- silently split a project's S-curve in two.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_schedule_phase_chk') then
    alter table project_schedule add constraint project_schedule_phase_chk
      check (phase is null or phase in ('initiation','planning','construction','closeout'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wbs_nodes_phase_chk') then
    alter table wbs_nodes add constraint wbs_nodes_phase_chk
      check (phase is null or phase in ('initiation','planning','construction','closeout'));
  end if;
end $$;

create index if not exists project_schedule_phase_idx on project_schedule (project_id, phase);
create index if not exists wbs_nodes_phase_idx        on wbs_nodes (project_id, phase);

-- ---- 3) Seed from the locked WBS skeleton ---------------------------------
-- The skeleton already names these branches, so the first classification is
-- free and correct. Name-matched (not id-matched) because the skeleton nodes
-- are created per project. Only fills NULLs — never overwrites a planner's tag.
update wbs_nodes set phase = 'initiation'
 where phase is null and lower(name) like '%initiation%';

update wbs_nodes set phase = 'planning'
 where phase is null and lower(name) like '%planning phase%';

update wbs_nodes set phase = 'construction'
 where phase is null and (lower(name) like '%execution phase%' or lower(name) like '%construction%');

update wbs_nodes set phase = 'closeout'
 where phase is null and (lower(name) like '%close-out%' or lower(name) like '%closeout%'
                       or lower(name) like '%close out%');

-- ---- 4) Cascade the seeded node phase down to its activities --------------
-- An activity inherits the nearest tagged ancestor. Done once here so existing
-- schedules arrive already classified; from then on the app resolves inheritance
-- at read time, so re-parenting a branch doesn't need a data migration.
with recursive tree as (
  select id, project_id, parent_id, phase, phase as eff
    from wbs_nodes where parent_id is null
  union all
  select c.id, c.project_id, c.parent_id, c.phase, coalesce(c.phase, t.eff)
    from wbs_nodes c join tree t on c.parent_id = t.id
)
update project_schedule ps
   set phase = t.eff
  from tree t
 where ps.wbs_node_id = t.id
   and ps.phase is null
   and t.eff is not null;

-- Done. Group / filter / roll up the schedule by Phase.
