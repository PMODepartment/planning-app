-- ============================================================================
-- Migration: replace the Workspace → Program → Group tree with a flat
--            GROUP HEAD tag on each project.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- WHY: the tree was three levels deep to express one fact — which group head
-- owns the project. Every consumer (dashboard caption, portfolio grouping,
-- project selector) ultimately resolved the tree back down to `group_head`,
-- so the tree was ceremony around a single tag. This collapses it.
--
-- ⚠️ DESTRUCTIVE at the end: it drops `projects.workspace_id`, `projects.
-- group_head` (text) and the `workspaces` table. Everything they carried is
-- backfilled into `projects.group_head_id` FIRST, in the same transaction-safe
-- order, and step 9 refuses to drop if any project would lose its group head.
-- ============================================================================

-- ---- 1) The lookup table ---------------------------------------------------
-- A tag, not a tree. `active=false` retires a group head without breaking the
-- projects that still reference it (history stays readable).
create table if not exists group_heads (
  id          text primary key,          -- short code, e.g. 'CALIMAG'
  name        text not null,             -- display name, e.g. 'Calimag Group'
  sort_order  int  default 0,
  active      boolean default true,
  created_at  timestamptz default now()
);

create unique index if not exists group_heads_name_idx on group_heads (lower(name));

-- ---- 2) Seed from the retired workspace tree's group nodes ----------------
insert into group_heads (id, name, sort_order) values
  ('CALIMAG',  'Calimag Group',   0),
  ('RODRIN',   'Rodrin Group',    1),
  ('RONQUILLO','Ronquillo Group', 2),
  ('TAN',      'Tan Group',       3),
  ('FLORES',   'Flores Group',    4)
on conflict (id) do nothing;

-- ---- 3) The new column on projects ----------------------------------------
alter table projects add column if not exists group_head_id text references group_heads(id);
create index if not exists projects_group_head_idx on projects (group_head_id);

-- ---- 4) Backfill: the project's OWN group_head text wins -------------------
-- Matched case-insensitively on name, because the text column was free-form.
update projects p
   set group_head_id = g.id
  from group_heads g
 where p.group_head_id is null
   and p.group_head is not null
   and lower(trim(p.group_head)) = lower(g.name);

-- ---- 5) Backfill: otherwise inherit from the workspace ancestry ------------
-- Same rule the app used: walk up from the project's workspace node and take
-- the first ancestor carrying a group_head. Guarded so this file still runs on
-- a database where `workspaces` was already dropped.
do $$
begin
  if to_regclass('public.workspaces') is not null then
    with recursive up as (
      select p.id as project_id, w.id as node_id, w.parent_id, w.group_head, 0 as depth
        from projects p
        join workspaces w on w.id = p.workspace_id
       where p.group_head_id is null
      union all
      select u.project_id, w.id, w.parent_id, w.group_head, u.depth + 1
        from up u
        join workspaces w on w.id = u.parent_id
       where u.group_head is null
    ),
    resolved as (
      select distinct on (project_id) project_id, group_head
        from up
       where group_head is not null
       order by project_id, depth
    )
    update projects p
       set group_head_id = g.id
      from resolved r
      join group_heads g on lower(trim(r.group_head)) = lower(g.name)
     where p.id = r.project_id
       and p.group_head_id is null;
  end if;
end $$;

-- ---- 6) Any group-head NAME that existed but has no lookup row ------------
-- Adopt it rather than dropping it on the floor. Code = uppercased first word,
-- de-duplicated with a suffix if it collides.
do $$
declare r record; base text; cand text; n int;
begin
  for r in
    select distinct trim(group_head) as gh
      from projects
     where group_head_id is null and coalesce(trim(group_head), '') <> ''
  loop
    base := upper(regexp_replace(split_part(r.gh, ' ', 1), '[^A-Za-z0-9]', '', 'g'));
    if base = '' then base := 'GROUP'; end if;
    cand := base; n := 1;
    while exists (select 1 from group_heads where id = cand) loop
      n := n + 1; cand := base || n::text;
    end loop;
    insert into group_heads (id, name, sort_order)
      values (cand, r.gh, 90) on conflict do nothing;
    update projects set group_head_id = cand
     where group_head_id is null and trim(group_head) = r.gh;
  end loop;
end $$;

-- ---- 7) RLS + grants -------------------------------------------------------
alter table group_heads enable row level security;

-- Org structure, not project data — every approved user reads it.
drop policy if exists group_heads_read on group_heads;
create policy group_heads_read on group_heads for select using (is_approved());

drop policy if exists group_heads_write on group_heads;
create policy group_heads_write on group_heads for all
  using (is_planner()) with check (is_planner());

grant select, insert, update, delete on group_heads to authenticated;

-- ---- 8) Refuse the delete of a group head still in use ---------------------
-- Mirrors admin_delete_project's "name what's blocking" behaviour so the admin
-- sees why, instead of a bare FK violation.
create or replace function admin_delete_group_head(target text)
  returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then
    raise exception 'Only an admin can delete a group head.';
  end if;
  select count(*) into n from projects where group_head_id = target;
  if n > 0 then
    raise exception 'Cannot delete: % project(s) are still assigned to this group head. Reassign them first, or set the group head inactive.', n;
  end if;
  delete from group_heads where id = target;
end $$;

revoke all on function admin_delete_group_head(text) from public;
grant execute on function admin_delete_group_head(text) to authenticated;

-- ---- 9) Drop the tree ------------------------------------------------------
-- Guarded: if any project still carries a group head that did NOT make it into
-- group_head_id, stop with a readable error instead of destroying the source.
do $$
declare lost int;
begin
  select count(*) into lost
    from projects
   where group_head_id is null and coalesce(trim(group_head), '') <> '';
  if lost > 0 then
    raise exception 'Aborting drop: % project(s) have a group_head that was not migrated. Fix them, then re-run.', lost;
  end if;
end $$;

drop function if exists admin_delete_workspace(text);

alter table projects drop column if exists workspace_id;
alter table projects drop column if exists group_head;

drop table if exists workspaces;

-- Done. Projects now carry one Group Head tag; the workspace tree is gone.
