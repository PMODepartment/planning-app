-- ============================================================================
-- Migration: admin archive / delete for projects & workspaces
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Rationale: ~20 module tables carry `project_id text references projects(id)`
-- and most were created WITHOUT `on delete cascade`, so a plain delete of a
-- project that has ever been used fails on an FK violation. Rather than
-- cascade-wiping construction records, the primary action stays the existing
-- reversible ARCHIVE (projects.status). A hard delete is allowed only for a
-- genuinely empty project.
--
--   admin_archive_project(id, bool) — flips projects.status; the everyday action.
--   admin_delete_project(id)        — hard delete, refuses if ANY module row exists.
--   admin_delete_workspace(id)      — hard delete, refuses if it has children.
--
-- All three are admin-only, enforced in the DB (mirrors admin_delete_user).
--
-- NOTE: no new archive column. `projects.status` ('active' | 'archived') already
-- carries this meaning and is already wired up — portfolio-overview filters on
-- it, dashboard/projects render a muted pill for it, and the Edit Project modal
-- exposes it. A second boolean would have been a silent duplicate.
-- ============================================================================

-- ─────────────────────────── Archive / restore ───────────────────────────
-- Reversible, keeps every module row intact. Same field the Edit modal writes;
-- this just makes it a one-click action with an admin guard behind it.
create or replace function admin_archive_project(target text, archive boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from projects where id = target) then
    raise exception 'Project % not found', target;
  end if;

  update projects
     set status = case when archive then 'archived' else 'active' end
   where id = target;
end $$;

-- ─────────────────────────── Hard delete: project ───────────────────────────
-- Refuses unless the project is empty across every table that references it.
-- The table list is discovered from the catalog rather than hardcoded, so a
-- module added later is covered automatically without touching this function.
create or replace function admin_delete_project(target text)
returns void language plpgsql security definer set search_path = public as $$
declare
  t        text;
  n        bigint;
  blockers text := '';
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from projects where id = target) then
    raise exception 'Project % not found', target;
  end if;

  for t in
    select c.relname
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
       and a.attname = 'project_id' and a.attnum > 0 and not a.attisdropped
       and c.relname <> 'projects'
     order by c.relname
  loop
    execute format('select count(*) from %I where project_id = $1', t)
      into n using target;
    if n > 0 then
      blockers := blockers || format('%s (%s), ', t, n);
    end if;
  end loop;

  if blockers <> '' then
    raise exception 'Project % still has data in: %. Archive it instead, or clear these first.',
      target, rtrim(blockers, ', ');
  end if;

  -- users.projects is a text[] with no FK — strip the id so assignments don't
  -- keep pointing at a project that no longer exists.
  update users set projects = array_remove(projects, target)
   where projects @> array[target];

  delete from projects where id = target;
end $$;

-- ─────────────────────────── Hard delete: workspace / program ───────────────────────────
-- Refuses while anything still hangs off it, so no project is orphaned by a
-- stale workspace_id.
create or replace function admin_delete_workspace(target text)
returns void language plpgsql security definer set search_path = public as $$
declare
  kids  bigint;
  projs bigint;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from workspaces where id = target) then
    raise exception 'Workspace % not found', target;
  end if;

  select count(*) into kids  from workspaces where parent_id   = target;
  select count(*) into projs from projects   where workspace_id = target;

  if kids > 0 or projs > 0 then
    raise exception
      'Cannot delete %: it still contains % child workspace/program(s) and % project(s). Move or remove them first.',
      target, kids, projs;
  end if;

  delete from workspaces where id = target;
end $$;

grant execute on function admin_archive_project(text, boolean) to authenticated;
grant execute on function admin_delete_project(text)           to authenticated;
grant execute on function admin_delete_workspace(text)         to authenticated;
