-- ============================================================================
-- Planners Dashboard — Supabase schema (Phase 1)
-- Run this in the Supabase SQL Editor of the NEW planning project.
-- All statements are idempotent (IF NOT EXISTS) and safe to re-run.
--
-- Conventions for module developers (see MODULE_CONTRACT.md):
--   * Every module owns its own table(s), prefixed with the module key,
--     e.g. risk_register, drawing_register, material_submittal.
--   * Every module table has: id (uuid PK), project_id (text FK -> projects),
--     created_by (uuid), created_at, updated_at.
--   * Enable RLS and add the standard policies (template at the bottom).
-- ============================================================================

-- ---- Shared: projects ------------------------------------------------------
create table if not exists projects (
  id          text primary key,                 -- e.g. 'AVR101'
  name        text not null,
  location    text,
  status      text default 'active',            -- active | archived
  start_date  date,
  end_date    date,
  created_at  timestamptz default now()
);

-- ---- Shared: users (profiles, FK to auth.users) ----------------------------
create table if not exists users (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  email       text,
  role        text default 'user'
                check (role in ('super_admin','admin','planner','user','viewer')),
  status      text default 'pending'
                check (status in ('pending','approved','rejected')),
  projects    text[] default '{}',              -- assigned project ids
  last_login  timestamptz,
  created_at  timestamptz default now()
);

-- ============================================================================
-- MODULE TABLES (Phase 1)
-- Each block is owned by the module's developer. Columns here are a STARTING
-- POINT — developers extend their own table via ALTER TABLE ... ADD COLUMN
-- IF NOT EXISTS and document it in their module's CLAUDE.md.
-- ============================================================================

-- 1) Progress Photos ---------------------------------------------------------
create table if not exists progress_photos (
  id          uuid primary key default gen_random_uuid(),
  project_id  text references projects(id),
  title       text,
  description text,
  photo_url   text,                  -- Supabase Storage path
  taken_at    date,
  location    text,
  tags        text[],
  created_by  uuid references users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- 2) Issues, Concerns & Lessons Learned --------------------------------------
create table if not exists issues_lessons (
  id          uuid primary key default gen_random_uuid(),
  project_id  text references projects(id),
  type        text,                  -- Issue | Concern | Lesson Learned
  title       text,
  description text,
  category    text,
  severity    text,                  -- Low | Medium | High | Critical
  status      text default 'Open',   -- Open | In Progress | Closed
  raised_by   text,
  date_raised date,
  resolution  text,
  date_closed date,
  created_by  uuid references users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- 3) Contracts & Claims Register ---------------------------------------------
create table if not exists contracts_claims (
  id            uuid primary key default gen_random_uuid(),
  project_id    text references projects(id),
  record_type   text,                -- Contract | Claim | Change Order
  reference_no  text,
  title         text,
  counterparty  text,
  description    text,
  amount        numeric(18,2),
  status        text,
  date_filed    date,
  date_resolved date,
  remarks       text,
  created_by    uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 4) Risk Register -----------------------------------------------------------
create table if not exists risk_register (
  id            uuid primary key default gen_random_uuid(),
  project_id    text references projects(id),
  risk_code     text,
  title         text,
  description   text,
  category      text,
  likelihood    int,                 -- 1..5
  impact        int,                 -- 1..5
  rating        int,                 -- likelihood * impact (app-computed)
  response      text,                -- Avoid | Mitigate | Transfer | Accept
  mitigation    text,
  owner         text,
  status        text default 'Open',
  review_date   date,
  created_by    uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 5) Stakeholder Map ---------------------------------------------------------
create table if not exists stakeholder_map (
  id            uuid primary key default gen_random_uuid(),
  project_id    text references projects(id),
  name          text,
  organization  text,
  role_title    text,
  category       text,               -- Internal | Client | Regulator | Vendor | Community
  influence     text,                -- Low | Medium | High
  interest      text,                -- Low | Medium | High
  contact       text,
  engagement    text,                -- engagement strategy / notes
  created_by    uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 6) Drawing Register --------------------------------------------------------
create table if not exists drawing_register (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id),
  drawing_no     text,
  title          text,
  discipline     text,
  revision       text,
  status         text,               -- For Review | Approved | Superseded
  issue_date     date,
  due_date       date,
  file_url       text,
  remarks        text,
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- 7) Material Submittal Log --------------------------------------------------
create table if not exists material_submittal (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id),
  submittal_no    text,
  material        text,
  specification   text,
  supplier        text,
  status          text,              -- Submitted | Under Review | Approved | Rejected
  date_submitted  date,
  date_required   date,
  date_approved   date,
  file_url        text,
  remarks         text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ============================================================================
-- MODULE TABLES (Phase 2) — starter columns only; developers extend as needed.
-- ============================================================================

-- Project Schedule, Cost Loading & S-Curve ----------------------------------
create table if not exists project_schedule (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id),
  activity_id     text,
  activity_name   text,
  wbs             text,
  start_date      date,
  end_date        date,
  duration_days   numeric,
  percent_complete numeric,        -- 0..100
  predecessors    text,
  planned_cost    numeric(18,2),   -- cost loading
  actual_cost     numeric(18,2),
  earned_value    numeric(18,2),
  period          date,            -- for S-curve bucketing
  remarks         text,
  -- evolved schedule columns (see migrations 2026-06-30 / 2026-07-01)
  activity_type   text default 'Task',
  status          text default 'Not Started',
  responsible_party text,
  actual_start    date,
  actual_finish   date,
  bl_start        date,
  bl_finish       date,
  bl_cost         numeric(18,2),   -- baseline planned cost (migration 2026-07-02-baseline-cost-column.sql)
  -- OPC Activity Details fields (migration 2026-07-01-project-schedule-opc-fields.sql)
  owner                   text,
  work_package            text,
  calendar                text,
  duration_type           text default 'Fixed Duration & Units/Time',
  percent_complete_type   text default 'Duration',
  program_milestone       boolean default false,
  expected_finish         date,
  actual_duration         numeric,
  remaining_duration      numeric,
  free_float              numeric,
  planned_labor_units     numeric,
  actual_labor_units      numeric,
  remaining_labor_units   numeric,
  primary_constraint      text,
  primary_constraint_date date,
  secondary_constraint    text,
  secondary_constraint_date date,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Resource Loading -----------------------------------------------------------
create table if not exists resource_loading (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id),
  resource_name   text,
  resource_type   text,            -- Labor | Equipment | Material
  unit            text,
  period          date,
  planned_qty     numeric,
  actual_qty      numeric,
  rate            numeric(18,2),
  cost            numeric(18,2),
  remarks         text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Productivity Rates ---------------------------------------------------------
create table if not exists productivity_rates (
  id                uuid primary key default gen_random_uuid(),
  project_id        text references projects(id),
  activity          text,
  unit              text,
  output_qty        numeric,
  manhours          numeric,
  productivity_rate numeric,       -- output per manhour (app-computed)
  crew              text,
  period            date,
  remarks           text,
  created_by        uuid references users(id),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- Cash Flow ------------------------------------------------------------------
create table if not exists cash_flow (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id),
  period          date,
  category        text,            -- Inflow | Outflow
  description     text,
  planned_amount  numeric(18,2),
  actual_amount   numeric(18,2),
  remarks         text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Cash Flow — projection settings (see migrations/2026-07-14-cash-flow-settings.sql).
-- The Cash Flow module is a DERIVED projection (cash-in from the schedule S-curve,
-- cash-out from the WPM procurement work packages); this row holds only the
-- contract/terms assumptions + the WPM project-id mapping. RLS/grants are set in
-- that migration (project-scoped, shared row — not created_by-gated).
create table if not exists cash_flow_settings (
  id                        uuid primary key default gen_random_uuid(),
  project_id                text references projects(id) on delete cascade unique,
  contract_ibb              numeric(18,2),
  contract_bcb              numeric(18,2),
  dp_percent                numeric(6,5) default 0,
  retention_percent         numeric(6,5) default 0.10,
  dp_recoup_percent         numeric(6,5),
  billing_terms_months      integer default 1,
  retention_release_months  integer default 1,
  start_period              date,
  wpm_project_id            text,
  remarks                   text,
  created_by                uuid references users(id),
  created_at                timestamptz default now(),
  updated_at                timestamptz default now()
);

-- Cash Flow — DP tranches (see migrations/2026-07-14-cash-flow-dp-tranches.sql).
-- Client downpayment broken into tranches, each tagged by trade/agreement, timed
-- by milestone / fixed month / offset, recouped proportionally. RLS in that migration.
create table if not exists cash_flow_dp_tranches (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id) on delete cascade,
  seq             integer default 0,
  label           text,
  category        text,
  basis           text default 'percent',
  percent         numeric(6,5),
  amount          numeric(18,2),
  timing_mode     text default 'offset',
  timing_month    date,
  timing_offset   integer default 0,
  milestone       text,
  recoup_percent  numeric(6,5),
  remarks         text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- S-Curve --------------------------------------------------------------------
create table if not exists s_curve (
  id                 uuid primary key default gen_random_uuid(),
  project_id         text references projects(id),
  period             date,
  planned_value      numeric(18,2),   -- per-period planned
  actual_value       numeric(18,2),   -- per-period actual
  planned_cumulative numeric(18,2),
  actual_cumulative  numeric(18,2),
  percent_planned    numeric,         -- 0..100
  percent_actual     numeric,         -- 0..100
  remarks            text,
  created_by         uuid references users(id),
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- ============================================================================
-- TABLE PRIVILEGES (GRANTs) — required IN ADDITION to RLS.
-- PostgREST runs queries as the `authenticated`/`anon` role; without these
-- grants every request fails with "42501 permission denied", before RLS runs.
-- ============================================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- ============================================================================
-- ROW-LEVEL SECURITY
-- Baseline policy: any authenticated, approved user may read; insert/update/
-- delete allowed for the row's creator or admins. Tighten per module later.
-- ============================================================================

-- Helpers are SECURITY DEFINER so they read `users` bypassing RLS — this
-- prevents infinite recursion (54001) when policies (including users' own
-- policy) call them. `set search_path` keeps them safe; each only inspects the
-- current auth.uid()'s own attributes.

-- Helper: is the current user an approved admin?
create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users u
    where u.id = auth.uid()
      and u.status = 'approved'
      and u.role in ('admin','super_admin')
  );
$$;

create or replace function is_approved() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.status = 'approved');
$$;

-- Helper: may the current user access this project? Admins: all. Others: only
-- projects listed in their users.projects array. This enforces the admin
-- "Assign projects" feature at the database level.
create or replace function can_access_project(pid text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users u
    where u.id = auth.uid() and u.status = 'approved'
      and (u.role in ('admin','super_admin') or pid = any(u.projects))
  );
$$;

-- Admin "delete user completely": removes auth.users (cascades to public.users),
-- freeing the email for future re-registration. Admin-only; no self-delete;
-- only a super_admin may delete a super_admin. Authorship is nulled (data kept).
create or replace function admin_delete_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if target = auth.uid() then raise exception 'You cannot delete your own account'; end if;
  if exists (select 1 from users where id = target and role = 'super_admin')
     and not exists (select 1 from users where id = auth.uid() and role = 'super_admin') then
    raise exception 'Only a super admin can delete a super admin';
  end if;
  for r in select table_name from information_schema.columns
           where table_schema = 'public' and column_name = 'created_by' loop
    execute format('update public.%I set created_by = null where created_by = %L', r.table_name, target);
  end loop;
  delete from auth.users where id = target;
end $$;
grant execute on function admin_delete_user(uuid) to authenticated;

-- users + projects
alter table users    enable row level security;
alter table projects enable row level security;

drop policy if exists users_self_read on users;
create policy users_self_read on users for select using (auth.uid() = id or is_admin());
drop policy if exists users_self_insert on users;
create policy users_self_insert on users for insert with check (auth.uid() = id);
drop policy if exists users_admin_update on users;
create policy users_admin_update on users for update using (auth.uid() = id or is_admin());

drop policy if exists projects_read on projects;
create policy projects_read on projects for select using (is_admin() or can_access_project(id));
drop policy if exists projects_admin_write on projects;
create policy projects_admin_write on projects for all using (is_admin()) with check (is_admin());

-- ---- Module-table RLS (apply the same pattern to every module table) -------
-- Run this DO block; it loops over all Phase-1 module tables and creates the
-- standard read-all-approved / write-own-or-admin policies for each.
do $$
declare t text;
begin
  foreach t in array array[
    'progress_photos','issues_lessons','contracts_claims','risk_register',
    'stakeholder_map','drawing_register','material_submittal',
    'project_schedule','resource_loading','productivity_rates','cash_flow','s_curve'
  ] loop
    execute format('alter table %I enable row level security', t);
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

-- ============================================================================
-- BOOTSTRAP: after you self-register through the app, promote yourself.
-- Replace the email below, then run:
--   update users set role = 'super_admin', status = 'approved'
--   where email = 'fmlozano@megawide.com.ph';
-- ============================================================================

-- ============================================================================
-- Workspaces (Workspace → Program → Project hierarchy) + Project Selector
-- Added 2026-06-30. Mirrors Oracle Primavera Cloud structure. Idempotent.
-- (Standalone copy: migrations/2026-06-30-workspaces-project-selector.sql)
-- ============================================================================
create table if not exists workspaces (
  id text primary key, name text not null, code text,
  parent_id text references workspaces(id),
  node_type text default 'workspace' check (node_type in ('workspace','program','group')),
  group_head text, sort_order int default 0, created_at timestamptz default now()
);
alter table projects add column if not exists workspace_id    text references workspaces(id);
alter table projects add column if not exists group_head      text;
alter table projects add column if not exists description     text;
alter table projects add column if not exists project_manager text;
alter table projects add column if not exists forecast_start  date;
alter table projects add column if not exists forecast_finish date;
alter table projects add column if not exists original_budget numeric;
alter table projects add column if not exists estimated_cost  numeric;
create or replace function is_planner() returns boolean
  language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from users where id = auth.uid() and status = 'approved'
    and role in ('super_admin','admin','planner')); $fn$;
alter table workspaces enable row level security;
drop policy if exists workspaces_read on workspaces;
create policy workspaces_read on workspaces for select using (is_approved());
drop policy if exists workspaces_write on workspaces;
create policy workspaces_write on workspaces for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on workspaces to authenticated;
drop policy if exists projects_admin_write on projects;
-- Per-command, never `for all`: `for all` covers SELECT too, which would OR with
-- projects_read and let planners see unassigned projects. Insert stays unfiltered
-- because a new project isn't in anyone's users.projects array yet.
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
insert into workspaces (id, name, code, parent_id, node_type, group_head, sort_order) values
  ('CORP','Corporate Root','Corp',null,'workspace',null,0),
  ('NONPROD','Non Production','NonP','CORP','workspace',null,1),
  ('PROD','Production','Prod','CORP','workspace',null,2),
  ('EPC','Megawide EPC','EPC','PROD','workspace',null,0),
  ('HOLDCO','Megawide HoldCo','HoldCo','PROD','workspace',null,1),
  ('BIDS','Bids','Bids','EPC','workspace',null,0),
  ('OPS','Operations','Ops','EPC','workspace',null,1),
  ('PMO','PMO','PMO','EPC','program',null,2),
  ('CALIMAG','Calimag Group','CAL','OPS','group','Calimag Group',0),
  ('RODRIN','Rodrin Group','ROD','OPS','group','Rodrin Group',1),
  ('RONQUILLO','Ronquillo Group','RON','OPS','group','Ronquillo Group',2),
  ('TAN','Tan Group','TAN','OPS','group','Tan Group',3),
  ('FLORES','Flores Group','FLO','OPS','group','Flores Group',4)
on conflict (id) do nothing;
update projects set workspace_id='PMO' where id='DEMO01' and workspace_id is null;
