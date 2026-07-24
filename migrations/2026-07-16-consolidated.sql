-- ============================================================================
-- 2026-07-16 — ONE migration covering everything outstanding. Run this alone.
-- Supersedes (and replaces) the separate 2026-07-16 planner-project-visibility
-- and admin-archive-delete files.
--
-- Fully idempotent — safe to re-run, and safe if you already ran either of the
-- superseded files. Every policy is dropped before it is created; every table /
-- column / index uses IF NOT EXISTS; every function is CREATE OR REPLACE.
--
-- Contents
--   1. wbs-nodes safety net  — re-assert the table + project_schedule.wbs_node_id.
--   2. Planner visibility fix — planners see ONLY their assigned projects.
--   3. Admin archive / delete — projects & workspaces.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. WBS NODES SAFETY NET
-- Re-asserted here because supabase-schema.sql never received this migration
-- (0 mentions of wbs_nodes) — so a DB built from that file lacks the table AND
-- project_schedule.wbs_node_id. A missing wbs_node_id is what silently broke the
-- WBS-Summary projection (nodes visible in the WBS Manager, absent from the
-- Project Schedule). No-op if you already ran 2026-07-07-wbs-nodes.sql.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists wbs_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  parent_id uuid references wbs_nodes(id) on delete cascade,
  code text,
  code_custom boolean default false,
  name text not null,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists wbs_nodes_project_idx on wbs_nodes(project_id);
create index if not exists wbs_nodes_parent_idx  on wbs_nodes(parent_id);

alter table project_schedule add column if not exists wbs_node_id uuid;
create index if not exists project_schedule_wbs_node_idx on project_schedule(wbs_node_id);

alter table wbs_nodes enable row level security;
drop policy if exists wbs_nodes_read on wbs_nodes;
create policy wbs_nodes_read on wbs_nodes for select using (is_approved());
drop policy if exists wbs_nodes_write on wbs_nodes;
create policy wbs_nodes_write on wbs_nodes for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on wbs_nodes to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PLANNER PROJECT VISIBILITY  (security fix)
-- `projects_write` was created `for all`, which covers SELECT. Postgres ORs
-- permissive policies together, so `using (is_planner())` gave every approved
-- planner read access to EVERY project, defeating the assignment filter in
-- projects_read. Split into per-command policies so projects_read is the only
-- SELECT gate. Update/delete are assignment-scoped too (a planner could
-- previously edit a project they couldn't see). INSERT stays is_planner()-only:
-- a new project isn't in anyone's users.projects array yet, so scoping it would
-- make "Add Project" impossible for planners.
--
-- MUST come after any older statement that recreates projects_write `for all`
-- (e.g. 2026-06-30-workspaces-project-selector.sql) or the hole reopens.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists projects_admin_write on projects;
drop policy if exists projects_write on projects;
drop policy if exists projects_ins on projects;
drop policy if exists projects_upd on projects;
drop policy if exists projects_del on projects;

create policy projects_ins on projects for insert
  with check (is_planner());

create policy projects_upd on projects for update
  using (is_planner() and (is_admin() or can_access_project(id)))
  with check (is_planner() and (is_admin() or can_access_project(id)));

create policy projects_del on projects for delete
  using (is_planner() and (is_admin() or can_access_project(id)));


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ADMIN ARCHIVE / DELETE
-- ~20 module tables carry `project_id references projects(id)` and most predate
-- `on delete cascade`, so deleting a used project dies on an FK violation.
-- Archive is the primary action; hard delete is the empty-only escape hatch.
-- No new archive column: projects.status ('active' | 'archived') already means
-- this and is already wired (portfolio-overview filters it, both Edit Project
-- modals expose it).
-- ─────────────────────────────────────────────────────────────────────────────
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

-- Refuses unless the project is empty across every table referencing it. The
-- table list is discovered from the pg catalog, not hardcoded, so a module added
-- later is covered automatically.
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
    execute format('select count(*) from %I where project_id = $1', t) into n using target;
    if n > 0 then blockers := blockers || format('%s (%s), ', t, n); end if;
  end loop;

  if blockers <> '' then
    raise exception 'Project % still has data in: %. Archive it instead, or clear these first.',
      target, rtrim(blockers, ', ');
  end if;

  -- users.projects is a text[] with no FK — strip the id so assignments don't dangle.
  update users set projects = array_remove(projects, target)
   where projects @> array[target];

  delete from projects where id = target;
end $$;

create or replace function admin_delete_workspace(target text)
returns void language plpgsql security definer set search_path = public as $$
declare kids bigint; projs bigint;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from workspaces where id = target) then
    raise exception 'Workspace % not found', target;
  end if;

  select count(*) into kids  from workspaces where parent_id    = target;
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
