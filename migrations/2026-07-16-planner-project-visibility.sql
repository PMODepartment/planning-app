-- ============================================================================
-- Migration: planners are limited to their assigned projects
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Bug: `projects_write` was created `for all`, which includes SELECT. Postgres
-- ORs permissive policies together, so `using (is_planner())` granted every
-- approved planner read access to every project row, defeating the assignment
-- filter in `projects_read`. Splitting it into per-command policies leaves
-- `projects_read` as the only SELECT gate on the table.
--
-- Effect: planners now see (and may edit) only projects in their users.projects
-- array, matching canAccessProject() in assets/js/auth.js. Admins & super_admins
-- are unaffected — is_admin() short-circuits both policies. Planners keep the
-- ability to create projects: a brand-new project isn't in anyone's array yet,
-- so the insert check stays is_planner().
-- ============================================================================

drop policy if exists projects_write on projects;

create policy projects_ins on projects for insert
  with check (is_planner());

create policy projects_upd on projects for update
  using (is_planner() and (is_admin() or can_access_project(id)))
  with check (is_planner() and (is_admin() or can_access_project(id)));

create policy projects_del on projects for delete
  using (is_planner() and (is_admin() or can_access_project(id)));
