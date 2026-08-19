-- ============================================================================
-- Migration: CONTRACT PACKAGE on schedule activities — WHICH package does this
--            line of work belong to?
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
-- Requires 2026-08-19-packages.sql (the `packages` table) to have been run.
--
-- ⚠️ THIS IS A DIFFERENT AXIS FROM `scope_type`, AND THE DISTINCTION IS THE
--    WHOLE POINT OF THIS MIGRATION.
--      scope_type  = WHERE THE MONEY COMES FROM — main contract or a change
--                    order (2026-08-19-schedule-contract-scope.sql).
--      package_id  = WHICH CONTRACT PACKAGE the work belongs to.
--    They are orthogonal: an activity can be "Package 2" AND "change_order" —
--    a variation raised against the MEPF package is exactly that. Modelling
--    either one with the other collapses a real distinction and makes the
--    reports lie, which is why they are two columns and not one.
--
-- WHY a column and not a WBS branch: same reasoning as scope_type. A package's
-- work does not sit in one tidy branch — a package cuts across floors, trades
-- and phases, and the planner must be free to put an activity where the WORK
-- belongs in the sequence. A tag lets the grid filter, group and roll up by
-- package without dictating the shape of the WBS.
-- ============================================================================

-- ---- 1) The columns --------------------------------------------------------
-- null = not assigned to a package. ⚠️ Read as "unassigned", NEVER defaulted to
-- a package: unlike scope_type (where untagged execution work is honestly main
-- contract), there is no defensible default package — guessing one would file
-- real work under a contract lot nobody put it in.
alter table project_schedule add column if not exists package_id uuid;
-- WBS nodes carry the same tag so a whole branch can be assigned once and its
-- activities inherit it (same inheritance rule as `phase` and `scope_type`).
alter table wbs_nodes        add column if not exists package_id uuid;

-- ---- 2) Referential integrity ---------------------------------------------
-- ⚠️ ON DELETE SET NULL, deliberately. A package is a contractual grouping; the
-- activities are the work itself. Deleting a package must never delete the
-- schedule — the work becomes unassigned and shows up as such, which is a
-- visible, recoverable state. (The app additionally refuses the delete while
-- anything still points at it — see admin_delete_package below — so this
-- constraint is the backstop, not the everyday path.)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_schedule_package_fk') then
    alter table project_schedule add constraint project_schedule_package_fk
      foreign key (package_id) references packages(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wbs_nodes_package_fk') then
    alter table wbs_nodes add constraint wbs_nodes_package_fk
      foreign key (package_id) references packages(id) on delete set null;
  end if;
end $$;

create index if not exists project_schedule_package_idx on project_schedule (project_id, package_id);
create index if not exists wbs_nodes_package_idx        on wbs_nodes        (project_id, package_id);

-- ---- 3) Guarded delete -----------------------------------------------------
-- Mirrors admin_delete_group_head / admin_delete_project: refuse while the
-- package is in use and NAME what is blocking, rather than silently unassigning
-- a few hundred activities (which the ON DELETE SET NULL above would otherwise
-- do without anyone noticing). Setting the package's status to 'archived' is
-- the non-destructive way to retire one.
create or replace function admin_delete_package(target uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  n_act int; n_wbs int; proj text;
begin
  select project_id into proj from packages where id = target;
  if proj is null then
    raise exception 'Package not found.';
  end if;
  -- Same rule the table's own write policy applies, re-checked here because a
  -- security definer function bypasses RLS.
  if not (is_planner() and can_access_project(proj)) then
    raise exception 'Not authorized to delete this package.';
  end if;
  select count(*) into n_act from project_schedule where package_id = target;
  select count(*) into n_wbs from wbs_nodes        where package_id = target;
  if n_act > 0 or n_wbs > 0 then
    raise exception 'Cannot delete: % activity/activities and % WBS branch(es) are still assigned to this package. Reassign them first, or set the package to archived.', n_act, n_wbs;
  end if;
  delete from packages where id = target;
end $$;

grant execute on function admin_delete_package(uuid) to authenticated;

-- ---- 4) No back-fill -------------------------------------------------------
-- Deliberately NOT assigning existing activities to anything. There is no rule
-- that could infer a package from the current data, and a guessed assignment is
-- worse than an honest blank: the grid's "— No package —" bucket is exactly the
-- list a planner needs to work through.

-- Done. Filter / group / roll up the schedule by contract package, independently
-- of the main-contract vs change-order tag.
