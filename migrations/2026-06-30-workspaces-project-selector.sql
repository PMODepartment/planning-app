-- ============================================================================
-- Migration: Workspaces (Workspace → Program → Project hierarchy) + Project
--            Selector support columns + Group Head assignment basis.
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Mirrors the Oracle Primavera Cloud structure:
--   Workspace tree (Corporate Root → … → Group) owns Projects.
--   The "Group" nodes (Calimag/Rodrin/Ronquillo/Tan) are the Group Heads —
--   the basis for assignments per project.
-- ============================================================================

-- ---- 1) Workspaces: self-referencing tree ---------------------------------
create table if not exists workspaces (
  id          text primary key,                  -- short code, e.g. 'PMO', 'CALIMAG'
  name        text not null,                      -- display name
  code        text,                               -- short prefix shown in list grouping (e.g. 'EPC')
  parent_id   text references workspaces(id),     -- null = root
  node_type   text default 'workspace'
                check (node_type in ('workspace','program','group')),
  group_head  text,                               -- group head name (assignment basis)
  sort_order  int  default 0,
  created_at  timestamptz default now()
);

-- ---- 2) Extend projects ----------------------------------------------------
alter table projects add column if not exists workspace_id    text references workspaces(id);
alter table projects add column if not exists group_head      text;
alter table projects add column if not exists description     text;
alter table projects add column if not exists project_manager text;
alter table projects add column if not exists forecast_start  date;
alter table projects add column if not exists forecast_finish date;
alter table projects add column if not exists original_budget numeric;
alter table projects add column if not exists estimated_cost  numeric;

-- ---- 3) Helper: is the current user a planner (auto-approve writer)? -------
-- SECURITY DEFINER + fixed search_path so it bypasses users-table RLS (avoids
-- the recursion class of bug fixed in 2026-06-18-fix-rls-recursion.sql).
create or replace function is_planner() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users
    where id = auth.uid() and status = 'approved'
      and role in ('super_admin','admin','planner')
  );
$$;

-- ---- 4) RLS + grants for workspaces ---------------------------------------
alter table workspaces enable row level security;

-- Everyone approved can read the tree (it is org structure, not project data).
drop policy if exists workspaces_read on workspaces;
create policy workspaces_read on workspaces for select using (is_approved());

-- Admins + planners can create / edit / delete workspace nodes.
drop policy if exists workspaces_write on workspaces;
create policy workspaces_write on workspaces for all
  using (is_planner()) with check (is_planner());

grant select, insert, update, delete on workspaces to authenticated;

-- ---- 5) Let planners (not just admins) manage projects --------------------
drop policy if exists projects_admin_write on projects;
drop policy if exists projects_write on projects;
create policy projects_write on projects for all
  using (is_planner()) with check (is_planner());

-- ---- 6) Seed the Megawide workspace tree (idempotent) ----------------------
insert into workspaces (id, name, code, parent_id, node_type, group_head, sort_order) values
  ('CORP',     'Corporate Root',  'Corp',  null,   'workspace', null, 0),
  ('NONPROD',  'Non Production',  'NonP',  'CORP', 'workspace', null, 1),
  ('PROD',     'Production',      'Prod',  'CORP', 'workspace', null, 2),
  ('EPC',      'Megawide EPC',    'EPC',   'PROD', 'workspace', null, 0),
  ('HOLDCO',   'Megawide HoldCo', 'HoldCo','PROD', 'workspace', null, 1),
  ('BIDS',     'Bids',            'Bids',  'EPC',  'workspace', null, 0),
  ('OPS',      'Operations',      'Ops',   'EPC',  'workspace', null, 1),
  ('PMO',      'PMO',             'PMO',   'EPC',  'program',   null, 2),
  ('CALIMAG',  'Calimag Group',   'CAL',   'OPS',  'group', 'Calimag Group',   0),
  ('RODRIN',   'Rodrin Group',    'ROD',   'OPS',  'group', 'Rodrin Group',    1),
  ('RONQUILLO','Ronquillo Group', 'RON',   'OPS',  'group', 'Ronquillo Group', 2),
  ('TAN',      'Tan Group',       'TAN',   'OPS',  'group', 'Tan Group',       3),
  ('FLORES',   'Flores Group',    'FLO',   'OPS',  'group', 'Flores Group',    4)
on conflict (id) do nothing;

-- ---- 7) Place the existing demo project under PMO (if present) -------------
update projects set workspace_id = 'PMO'
  where id = 'DEMO01' and workspace_id is null;

-- ---- 8) Optional sample projects (only inserted if absent) -----------------
-- Gives the selector a populated look across multiple workspace nodes.
insert into projects (id, name, location, status, workspace_id, group_head, description) values
  ('CP104',  'EPC. CP104 Project (Engineering)',           'Metro Manila', 'active', 'PMO',     null,           'Engineering package'),
  ('MCSP',   'EPC. PMO. 2025 Megawide Construction Strategic Plan','HO',   'active', 'PMO',     null,           'Strategic plan'),
  ('WCB363', 'Westside City Site B (Main Contract)',       'Entertainment City','active','CALIMAG','Calimag Group','Main Contract, MEPF, Change Orders'),
  ('HOR102', 'HO Renovation',                              'HO',           'active', 'RODRIN',  'Rodrin Group', 'Head office renovation')
on conflict (id) do nothing;

-- Done. Project Selector + Workspace hierarchy are ready.
