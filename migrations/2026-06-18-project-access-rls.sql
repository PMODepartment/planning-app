-- ============================================================================
-- Migration: per-project access control (database-enforced)
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Effect: admins & super_admins see ALL projects and module rows. Everyone else
-- (planner / user / viewer) can only read/write rows for projects listed in
-- their users.projects array. This turns the admin "Assign projects" feature
-- into a real security boundary, not just a UI convenience.
-- ============================================================================

-- Helper: may the current user access this project id?
create or replace function can_access_project(pid text)
returns boolean language sql stable as $$
  select exists (
    select 1 from users u
    where u.id = auth.uid()
      and u.status = 'approved'
      and (u.role in ('admin','super_admin') or pid = any(u.projects))
  );
$$;

-- Projects: non-admins only see assigned projects (drives the project pickers).
drop policy if exists projects_read on projects;
create policy projects_read on projects for select
  using (is_admin() or can_access_project(id));

-- Module tables: read/write gated on project membership.
do $$
declare t text;
begin
  foreach t in array array[
    'progress_photos','issues_lessons','contracts_claims','risk_register',
    'stakeholder_map','drawing_register','material_submittal'
  ] loop
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t||'_read', t);

    execute format('drop policy if exists %I on %I', t||'_ins', t);
    execute format('create policy %I on %I for insert with check (is_approved() and created_by = auth.uid() and can_access_project(project_id))', t||'_ins', t);

    execute format('drop policy if exists %I on %I', t||'_upd', t);
    execute format('create policy %I on %I for update using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()))', t||'_upd', t);

    execute format('drop policy if exists %I on %I', t||'_del', t);
    execute format('create policy %I on %I for delete using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()))', t||'_del', t);
  end loop;
end $$;
