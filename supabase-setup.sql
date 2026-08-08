-- ============================================================================
-- Planners Dashboard — ONE-PASTE SUPABASE SETUP
-- ----------------------------------------------------------------------------
-- Run this ENTIRE file once in the Supabase SQL editor of a fresh project.
-- It is idempotent (safe to re-run). Order: tables → grants → helpers → RLS →
-- storage → demo seed → bootstrap admin → Phase-2 consolidation.
--
-- ✅ COMPLETE (audit 2026-07-21). This file alone builds the full DB: the Phase-2
-- tables/columns that used to live only in /migrations are folded into the
-- "CONSOLIDATION" section at the bottom (cash_flow_*, schedule_baselines/
-- _snapshots/_audit, activity_expenses, cost_accounts, wpm_work_packages,
-- ppr_presentations/_slides, + the module-full column sets), with RLS applied
-- project-scoped. Running the individual /migrations afterward is optional and
-- harmless (all idempotent). Verified: 0 tables / 0 columns missing vs the union
-- of all sources; every policy re-runnable.
--
-- After running: see SETUP.md for the Supabase dashboard settings (disable
-- email confirmation, password-reset redirect URL) and the GitHub steps.
-- ============================================================================

-- ───────────────────────── Shared tables ─────────────────────────
create table if not exists projects (
  id text primary key, name text not null, location text,
  status text default 'active', start_date date, end_date date,
  created_at timestamptz default now()
);

create table if not exists users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text, email text,
  role text default 'user' check (role in ('super_admin','admin','planner','user','viewer')),
  status text default 'pending' check (status in ('pending','approved','rejected')),
  projects text[] default '{}', last_login timestamptz,
  created_at timestamptz default now()
);

-- ───────────────────────── Module tables (Phase 1) ─────────────────────────
create table if not exists progress_photos (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  title text, description text, photo_url text, taken_at date, location text, tags text[],
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists issues_lessons (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  type text, title text, description text, category text, severity text, status text default 'Open',
  raised_by text, date_raised date, resolution text, date_closed date,
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists contracts_claims (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  record_type text, reference_no text, title text, counterparty text, description text,
  amount numeric(18,2), status text, date_filed date, date_resolved date, remarks text,
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists risk_register (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  risk_code text, title text, description text, category text,
  likelihood int, impact int, rating int, response text, mitigation text, owner text,
  status text default 'Open', review_date date,
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists stakeholder_map (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  name text, organization text, role_title text, category text, influence text, interest text,
  contact text, engagement text,
  -- corporate-BD methodology (2026-07-20-stakeholder-map-full.sql):
  -- category=Sector, organization=Institution, role_title=Position,
  -- influence=Impact 1-4, interest=Interest 1-4 (both text); derived fields not stored.
  stakeholder_group text, title text, nickname text, birthday date, email text,
  current_rel smallint, target_rel smallint, primary_responsible text, alternate text, gift_tier text,
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists drawing_register (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  drawing_no text, title text, discipline text, revision text, status text,
  issue_date date, due_date date, file_url text, remarks text,
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists material_submittal (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  submittal_no text, material text, specification text, supplier text, status text,
  date_submitted date, date_required date, date_approved date, file_url text, remarks text,
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());

-- ───────────────────────── Module tables (Phase 2) ─────────────────────────
create table if not exists project_schedule (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  activity_id text, activity_name text, wbs text, start_date date, end_date date,
  duration_days numeric, percent_complete numeric, predecessors text,
  planned_cost numeric(18,2), actual_cost numeric(18,2), earned_value numeric(18,2), period date, remarks text,
  -- evolved schedule columns (see migrations)
  activity_type text default 'Task', status text default 'Not Started', responsible_party text,
  actual_start date, actual_finish date, bl_start date, bl_finish date, bl_cost numeric(18,2),
  -- Monte Carlo schedule risk: per-activity 3-point override (see 2026-07-07-risk-3point-duration.sql)
  risk_optimistic_pct numeric(6,2), risk_pessimistic_pct numeric(6,2),
  -- Activity Codes assignment: { "<code_type_id>": "<code_value_id>" } (see 2026-07-07-activity-codes.sql)
  activity_codes jsonb default '{}'::jsonb,
  -- WBS node link (see 2026-07-07-wbs-nodes.sql)
  wbs_node_id uuid,
  -- User-Defined Fields values: { "<udf_def_id>": value } (see 2026-07-07-user-defined-fields.sql)
  udf jsonb default '{}'::jsonb,
  -- OPC Activity Details fields
  owner text, work_package text, calendar text,
  duration_type text default 'Fixed Duration & Units/Time', percent_complete_type text default 'Duration',
  program_milestone boolean default false, expected_finish date,
  actual_duration numeric, remaining_duration numeric, free_float numeric,
  planned_labor_units numeric, actual_labor_units numeric, remaining_labor_units numeric,
  primary_constraint text, primary_constraint_date date,
  secondary_constraint text, secondary_constraint_date date,
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists resource_loading (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  resource_name text, resource_type text, unit text, period date,
  planned_qty numeric, actual_qty numeric, rate numeric(18,2), cost numeric(18,2), remarks text,
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists productivity_rates (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  activity text, unit text, output_qty numeric, manhours numeric, productivity_rate numeric,
  crew text, period date, remarks text,
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());

-- Productivity Monitoring (full module — supersedes the flat productivity_rates above).
create table if not exists productivity_activities (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  name text not null, category text, unit text,
  resource_type text default 'Manpower', resource_unit text default 'pax',
  subcontractor text, sort_order numeric, remarks text,
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists productivity_entries (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  activity_id uuid references productivity_activities(id) on delete cascade,
  period date not null, work_days numeric,
  mp_bl0 numeric, mp_planned numeric, mp_actual numeric,
  qty_bl0 numeric, qty_planned numeric, qty_actual numeric,
  remarks text, created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now());
create unique index if not exists productivity_entries_uq  on productivity_entries(activity_id, period);
create index        if not exists productivity_entries_prj on productivity_entries(project_id, period);
create index        if not exists productivity_act_prj     on productivity_activities(project_id, sort_order);

create table if not exists cash_flow (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  period date, category text, description text, planned_amount numeric(18,2), actual_amount numeric(18,2), remarks text,
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists s_curve (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  period date, planned_value numeric(18,2), actual_value numeric(18,2),
  planned_cumulative numeric(18,2), actual_cumulative numeric(18,2),
  percent_planned numeric, percent_actual numeric, remarks text,
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());

-- Resource & Role master (resource-loading module)
create table if not exists resource_roles (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  name text, discipline text, uom text default 'hours', remarks text,
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists resources (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  resource_code text, name text, type text default 'Labor', primary_role text,
  default_units_per_time numeric default 100, max_units_per_time numeric default 100,
  uom text default 'hours', calendar text, remarks text,
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists resource_assignments (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id),
  activity_id text, resource_id uuid references resources(id), resource_code text, role text,
  budgeted_units numeric, actual_units numeric, remaining_units numeric, uom text default 'hours', remarks text,
  curve text default 'linear',   -- distribution curve (see 2026-07-07-assignment-curve.sql)
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now());

-- WBS nodes (see 2026-07-07-wbs-nodes.sql) — first-class Work Breakdown Structure tree,
-- projected into project_schedule WBS-Summary rows for the existing pipeline.
create table if not exists wbs_nodes (
  id uuid primary key default gen_random_uuid(), project_id text not null,
  parent_id uuid references wbs_nodes(id) on delete cascade,
  code text, code_custom boolean default false, name text not null, sort_order int default 0,
  created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());

-- Activity Codes (see 2026-07-07-activity-codes.sql) — project-defined code
-- dictionaries for grouping/filtering the schedule orthogonally to the WBS.
create table if not exists activity_code_types (
  id uuid primary key default gen_random_uuid(), project_id text not null, name text not null,
  sort_order int default 0, created_by uuid, created_at timestamptz default now());
create table if not exists activity_code_values (
  id uuid primary key default gen_random_uuid(), code_type_id uuid references activity_code_types(id) on delete cascade,
  project_id text not null, value text not null, color text, sort_order int default 0, created_at timestamptz default now());

-- User-Defined Fields (see 2026-07-07-user-defined-fields.sql) — project-defined typed custom
-- fields on activities; values stored as project_schedule.udf jsonb ({ "<def_id>": value }).
create table if not exists activity_udf_defs (
  id uuid primary key default gen_random_uuid(), project_id text not null, name text not null,
  field_type text default 'text' check (field_type in ('text','number','date','cost')),
  sort_order int default 0, created_by uuid, created_at timestamptz default now());

-- Weighted Steps (see 2026-07-07-activity-steps.sql) — per-activity checklist
-- whose weighted % complete can drive project_schedule.percent_complete.
create table if not exists activity_steps (
  id uuid primary key default gen_random_uuid(), project_id text not null, activity_id text,
  name text not null, weight numeric(10,2) default 1, percent_complete numeric(5,2) default 0,
  sort_order int default 0, created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now());

-- Last Planner weekly work plan + PPC (see 2026-07-07-weekly-commitments.sql).
create table if not exists weekly_commitments (
  id uuid primary key default gen_random_uuid(), project_id text not null, week_start date not null,
  activity_id text, description text not null, responsible text, status text default 'Open',
  reason_code text, reason_notes text, created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now());

-- What-if scenarios / Reflections (see 2026-07-07-schedule-scenarios.sql) — restorable checkpoints.
create table if not exists schedule_scenarios (
  id uuid primary key default gen_random_uuid(), project_id text not null, name text,
  taken_at timestamptz default now(), created_by uuid, activity_count int,
  project_finish date, critical_count int, total_cost numeric, activities jsonb default '{}'::jsonb);

-- Schedule threshold monitors (see 2026-07-07-schedule-thresholds.sql) — auto-generate Issues.
create table if not exists schedule_thresholds (
  id uuid primary key default gen_random_uuid(), project_id text not null, name text,
  metric text not null, value numeric not null, severity text default 'Medium',
  enabled boolean default true, created_by uuid, created_at timestamptz default now());

-- ───────────────────────── Grants (API roles) ─────────────────────────
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

-- ───────────────────────── Helper functions ─────────────────────────
-- SECURITY DEFINER so they read `users` bypassing RLS — prevents infinite
-- recursion when policies (incl. users' own policy) call them. set search_path
-- keeps them safe; they only check the current auth.uid()'s own attributes.
create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.status='approved' and u.role in ('admin','super_admin'));
$$;
create or replace function is_approved() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.status='approved');
$$;
-- Approved and NOT a 'viewer' — gates module-table writes so viewers are read-only.
create or replace function is_writer() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.status='approved' and u.role <> 'viewer');
$$;
create or replace function can_access_project(pid text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.status='approved'
    and (u.role in ('admin','super_admin') or pid = any(u.projects)));
$$;

-- Admin "delete user completely": removes auth.users (cascades to public.users),
-- freeing the email for future re-registration. Nulls authorship first so FKs
-- don't block. Admin-only; no self-delete; only super_admin deletes super_admin.
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

-- ───────────────────────── RLS: users + projects ─────────────────────────
alter table users enable row level security;
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

-- ───────────────────────── RLS: all module tables ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'progress_photos','issues_lessons','contracts_claims','risk_register',
    'stakeholder_map','drawing_register','material_submittal',
    'project_schedule','resource_loading','productivity_rates','cash_flow','s_curve',
    'resource_roles','resources','resource_assignments',
    'productivity_activities','productivity_entries'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_ins', t);
    execute format('create policy %I on %I for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id))', t||'_ins', t);
    execute format('drop policy if exists %I on %I', t||'_upd', t);
    execute format('create policy %I on %I for update using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin())) with check (is_writer() and can_access_project(project_id))', t||'_upd', t);
    execute format('drop policy if exists %I on %I', t||'_del', t);
    execute format('create policy %I on %I for delete using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()))', t||'_del', t);
  end loop;
end $$;

-- ───────────────────────── Storage buckets (private) ─────────────────────────
insert into storage.buckets (id, name, public) values
  ('drawing-register','drawing-register',false),
  ('progress-photos','progress-photos',false),
  ('material-submittal','material-submittal',false)
on conflict (id) do nothing;
do $$
declare b text;
begin
  foreach b in array array['drawing-register','progress-photos','material-submittal'] loop
    execute format('drop policy if exists %I on storage.objects', b||'_read');
    execute format('create policy %I on storage.objects for select using (bucket_id = %L and is_approved())', b||'_read', b);
    execute format('drop policy if exists %I on storage.objects', b||'_ins');
    execute format('create policy %I on storage.objects for insert with check (bucket_id = %L and is_approved())', b||'_ins', b);
    execute format('drop policy if exists %I on storage.objects', b||'_del');
    execute format('create policy %I on storage.objects for delete using (bucket_id = %L and (owner = auth.uid() or is_admin()))', b||'_del', b);
  end loop;
end $$;
-- NOTE: the DELETE policy above is superseded for ALL THREE buckets further down
-- (see "Storage: planner deletes"), widening it to is_planner(). It CANNOT be done
-- here — is_planner() is not defined until later in this file, and a policy's
-- USING expression is parsed at creation time, so referencing it here would fail
-- on a fresh run.

-- ───────────────────────── Demo project + sample data ─────────────────────────
-- A sandbox so developers have a project to select and data to see immediately.
-- Assign 'DEMO01' to each developer in Admin → Users (or they're admins).
insert into projects (id, name, location, status, start_date)
values ('DEMO01','Demo Project (sandbox)','Quezon City','active', current_date)
on conflict (id) do nothing;

-- Sample risks (only if none exist for DEMO01 — keeps re-runs clean)
insert into risk_register (project_id, risk_code, title, description, category, likelihood, impact, rating, response, owner, status)
select * from (values
  ('DEMO01','R-001','Delayed permit approval','LGU permit may slip','Regulatory',3,4,12,'Mitigate','PMO','Open'),
  ('DEMO01','R-002','Steel price escalation','Market volatility on rebar','Commercial',4,4,16,'Transfer','Procurement','Open'),
  ('DEMO01','R-003','Rainy-season productivity drop','Weather impact on earthworks','Schedule',3,3,9,'Accept','Site','In Progress')
) v(project_id,risk_code,title,description,category,likelihood,impact,rating,response,owner,status)
where not exists (select 1 from risk_register where project_id='DEMO01');

-- Sample drawings
insert into drawing_register (project_id, drawing_no, title, discipline, revision, status, issue_date)
select * from (values
  ('DEMO01','A-101','Ground Floor Plan','Architectural','B','Approved', current_date - 20),
  ('DEMO01','S-201','Foundation Layout','Structural','A','For Review', current_date - 5)
) v(project_id,drawing_no,title,discipline,revision,status,issue_date)
where not exists (select 1 from drawing_register where project_id='DEMO01');

-- ───────────────────────── Bootstrap admin ─────────────────────────
-- Promote the owner account (creates the profile row from auth.users if needed).
-- Change the email if different.
insert into users (id, email, name, role, status)
select id, email, 'Fernando Lozano', 'super_admin', 'approved'
from auth.users where email = 'fmlozano@megawide.com.ph'
on conflict (id) do update set name='Fernando Lozano', role='super_admin', status='approved';

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

-- ───────────────────── Storage: planner deletes (all module buckets) ─────────
-- Must sit AFTER is_planner() is defined above (a policy's USING expression is
-- parsed at creation). Supersedes the owner-or-admin delete rule set in the
-- storage section earlier in this file.
-- The `owner = auth.uid()` branch is kept on purpose: the buckets' INSERT policy
-- is is_approved(), so any approved user can upload — dropping it would remove
-- their ability to delete their OWN file. is_planner() already includes admins.
-- See migrations/2026-07-20-material-submittal-storage-delete.sql and
--     migrations/2026-07-20-storage-planner-delete-all-buckets.sql.
do $$
declare b text;
begin
  foreach b in array array['drawing-register','progress-photos','material-submittal'] loop
    execute format('drop policy if exists %I on storage.objects', b||'_del');
    execute format('create policy %I on storage.objects for delete using (bucket_id = %L and (owner = auth.uid() or is_planner()))', b||'_del', b);
  end loop;
end $$;
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

-- ───────────────────────── RLS: Activity Codes / Steps / Last Planner ─────────────────────────
-- These schedule-support tables (added 2026-07-07) are project-scoped: read =
-- can_access_project(project_id), write = is_planner() AND can_access_project — matching
-- migrations/2026-07-21-rls-project-scope-fix.sql (audit #2, which stopped any approved user
-- from reading every project's schedule/WBS/cost data). Must come after is_planner() (above).
do $$
declare t text;
begin
  foreach t in array array['wbs_nodes','activity_code_types','activity_code_values','activity_udf_defs','activity_steps','weekly_commitments','schedule_scenarios','schedule_thresholds'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_write', t);
    execute format('create policy %I on %I for all using (is_planner() and can_access_project(project_id)) with check (is_planner() and can_access_project(project_id))', t||'_write', t);
  end loop;
end $$;

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

-- ============================================================================
-- Working calendars (Resource Master + Project Schedule) — Added 2026-07-06.
-- (Standalone copy: migrations/2026-07-06-working-calendars.sql)
-- ============================================================================
create table if not exists calendars (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  name text not null,
  hours_per_day numeric default 8,
  work_mon boolean default true,
  work_tue boolean default true,
  work_wed boolean default true,
  work_thu boolean default true,
  work_fri boolean default true,
  work_sat boolean default true,
  work_sun boolean default false,
  extra_holidays date[] default '{}',
  is_default boolean default false,
  created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table resources add column if not exists calendar_id uuid references calendars(id) on delete set null;
alter table project_schedule add column if not exists calendar_id uuid references calendars(id) on delete set null;
grant select, insert, update, delete on calendars to authenticated;
do $$
begin
  alter table calendars enable row level security;
  drop policy if exists calendars_read on calendars;
  create policy calendars_read on calendars for select using (can_access_project(project_id));
  drop policy if exists calendars_ins on calendars;
  create policy calendars_ins on calendars for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id));
  drop policy if exists calendars_upd on calendars;
  create policy calendars_upd on calendars for update using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin())) with check (is_writer() and can_access_project(project_id));
  drop policy if exists calendars_del on calendars;
  create policy calendars_del on calendars for delete using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
end $$;


-- ============================================================================
-- CONSOLIDATION (audit 2026-07-21): tables + columns that previously lived ONLY
-- in /migrations, folded here so this file alone builds a complete DB. Every
-- statement is idempotent. Support-table RLS is applied PROJECT-SCOPED (mirrors
-- migrations/2026-07-21-rls-project-scope-fix.sql); cash-flow / ppr / wpm keep
-- their own policies (already project-scoped / service-role-guarded).
-- ============================================================================

-- ---- Phase-2 tables (dependency-ordered) + indexes + grants + own policies ----
-- (tables first: a missing column below — resource_assignments.cost_account_id —
--  FKs cost_accounts, so that table must exist before the ALTER runs.)
-- cost_accounts
create table if not exists cost_accounts (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  parent_id uuid references cost_accounts(id) on delete set null,  
  code text,                       
  name text not null,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists cost_accounts_project_idx on cost_accounts(project_id);
alter table cost_accounts enable row level security;
grant select, insert, update, delete on cost_accounts to authenticated;

-- activity_expenses
create table if not exists activity_expenses (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  activity_id text,                
  name text not null,
  cost_account_id uuid references cost_accounts(id) on delete set null,
  planned_cost numeric(16,2),
  actual_cost  numeric(16,2),
  remarks text,
  created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists activity_expenses_project_activity_idx on activity_expenses(project_id, activity_id);
alter table activity_expenses enable row level security;
grant select, insert, update, delete on activity_expenses to authenticated;

-- schedule_baselines
create table if not exists schedule_baselines (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null,
  name           text,
  taken_at       timestamptz default now(),
  created_by     uuid,
  is_primary     boolean default false,
  activity_count int,
  activities     jsonb default '{}'::jsonb
);
create index if not exists schedule_baselines_project_idx on schedule_baselines (project_id, taken_at desc);
alter table schedule_baselines enable row level security;
grant select, insert, update, delete on schedule_baselines to authenticated;

-- schedule_snapshots
create table if not exists schedule_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  project_id         text not null,
  label              text,
  data_date          date,
  taken_at           timestamptz default now(),
  created_by         uuid,
  
  pct_complete       numeric,
  activities_total   int,
  activities_behind  int,
  milestones_total   int,
  milestones_at_risk int,
  project_finish     date,
  
  milestones         jsonb default '[]'::jsonb
);
create index if not exists schedule_snapshots_project_idx on schedule_snapshots (project_id, taken_at desc);
alter table schedule_snapshots enable row level security;
grant select, insert, update, delete on schedule_snapshots to authenticated;

-- schedule_audit
create table if not exists schedule_audit (
  id            uuid primary key default gen_random_uuid(),
  project_id    text,
  activity_pk   uuid,          
  activity_id   text,          
  activity_name text,
  action        text,          
  changes       jsonb,         
  changed_by    uuid,
  changed_at    timestamptz default now()
);
create index if not exists schedule_audit_project_idx on schedule_audit (project_id, changed_at desc);
alter table schedule_audit enable row level security;
grant select, insert on schedule_audit to authenticated;

-- cash_flow_settings
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
alter table cash_flow_settings
  add column if not exists billing_basis text default 'poc';
alter table cash_flow_settings add column if not exists ewt_percent      numeric(6,5) default 0.02;
alter table cash_flow_settings add column if not exists vat_percent      numeric(6,5) default 0.12;
alter table cash_flow_settings add column if not exists ret_rel1_pct     numeric(6,5) default 1;
alter table cash_flow_settings add column if not exists ret_rel2_months  integer      default 12;
alter table cash_flow_settings add column if not exists finance_rate  numeric(7,5) default 0;
alter table cash_flow_settings add column if not exists funding_limit numeric(18,2);
alter table cash_flow_settings add column if not exists scurve_basis text default 'duration';
alter table cash_flow_settings add column if not exists co_ret_rel1_pct    numeric(6,5);
alter table cash_flow_settings add column if not exists co_ret_rel1_months integer;
alter table cash_flow_settings add column if not exists co_ret_rel2_months integer;
alter table cash_flow_settings enable row level security;
grant select, insert, update, delete on cash_flow_settings to authenticated;
drop policy if exists cash_flow_settings_read on cash_flow_settings;
create policy cash_flow_settings_read on cash_flow_settings
  for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_settings_write on cash_flow_settings;
create policy cash_flow_settings_write on cash_flow_settings
  for all using (is_writer() and can_access_project(project_id))
  with check (is_writer() and can_access_project(project_id));

-- cash_flow_billing_milestones
create table if not exists cash_flow_billing_milestones (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id) on delete cascade,
  seq            integer default 0,
  description    text,                                 
  basis          text default 'amount' check (basis in ('amount','percent')),
  amount         numeric(18,2),                        
  percent        numeric(6,5),                         
  trigger_mode   text default 'milestone'
                   check (trigger_mode in ('milestone','month','offset')),
  milestone      text,                                 
  trigger_month  date,                                 
  trigger_offset integer default 0,                    
  remarks        text,
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_cf_bill_ms_proj on cash_flow_billing_milestones(project_id);
alter table cash_flow_billing_milestones enable row level security;
grant select, insert, update, delete on cash_flow_billing_milestones to authenticated, service_role;
drop policy if exists cash_flow_billing_milestones_read on cash_flow_billing_milestones;
create policy cash_flow_billing_milestones_read on cash_flow_billing_milestones for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_billing_milestones_write on cash_flow_billing_milestones;
create policy cash_flow_billing_milestones_write on cash_flow_billing_milestones for all
  using (is_writer() and can_access_project(project_id))
  with check (is_writer() and can_access_project(project_id));

-- cash_flow_dp_tranches
create table if not exists cash_flow_dp_tranches (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id) on delete cascade,
  seq             integer default 0,            
  label           text,                         
  category        text,                          
  basis           text default 'percent'
                    check (basis in ('percent','amount')),
  percent         numeric(6,5),                 
  amount          numeric(18,2),                
  timing_mode     text default 'offset'
                    check (timing_mode in ('month','offset','milestone')),
  timing_month    date,                          
  timing_offset   integer default 0,             
  milestone       text,                          
  recoup_percent  numeric(6,5),                 
  remarks         text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_cf_dp_tranches_proj on cash_flow_dp_tranches(project_id);
alter table cash_flow_dp_tranches enable row level security;
grant select, insert, update, delete on cash_flow_dp_tranches to authenticated, service_role;
drop policy if exists cash_flow_dp_tranches_read on cash_flow_dp_tranches;
create policy cash_flow_dp_tranches_read on cash_flow_dp_tranches
  for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_dp_tranches_write on cash_flow_dp_tranches;
create policy cash_flow_dp_tranches_write on cash_flow_dp_tranches
  for all using (is_writer() and can_access_project(project_id))
  with check (is_writer() and can_access_project(project_id));

-- cash_flow_actuals
create table if not exists cash_flow_actuals (
  id           uuid primary key default gen_random_uuid(),
  project_id   text references projects(id) on delete cascade,
  period       date not null,                       
  direction    text not null check (direction in ('in','out')),
  category     text,                                
  amount       numeric(18,2) not null,              
  description  text,
  remarks      text,
  created_by   uuid references users(id),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists idx_cf_actuals_proj on cash_flow_actuals(project_id);
alter table cash_flow_actuals enable row level security;
grant select, insert, update, delete on cash_flow_actuals to authenticated, service_role;
drop policy if exists cash_flow_actuals_read on cash_flow_actuals;
create policy cash_flow_actuals_read on cash_flow_actuals for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_actuals_write on cash_flow_actuals;
create policy cash_flow_actuals_write on cash_flow_actuals for all
  using (is_writer() and can_access_project(project_id))
  with check (is_writer() and can_access_project(project_id));

-- cash_flow_rollup
create table if not exists cash_flow_rollup (
  id           uuid primary key default gen_random_uuid(),
  project_id   text references projects(id) on delete cascade,
  period       date not null,
  cash_in      numeric(18,2) default 0,
  cash_out     numeric(18,2) default 0,   
  net          numeric(18,2) default 0,
  updated_at   timestamptz default now(),
  unique (project_id, period)
);
create index if not exists idx_cf_rollup_proj on cash_flow_rollup(project_id);
alter table cash_flow_rollup enable row level security;
grant select, insert, update, delete on cash_flow_rollup to authenticated, service_role;
drop policy if exists cash_flow_rollup_read on cash_flow_rollup;
create policy cash_flow_rollup_read on cash_flow_rollup for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_rollup_write on cash_flow_rollup;
create policy cash_flow_rollup_write on cash_flow_rollup for all
  using (is_writer() and can_access_project(project_id))
  with check (is_writer() and can_access_project(project_id));

-- cash_flow_trade_packages
create table if not exists cash_flow_trade_packages (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id) on delete cascade,
  seq            integer default 0,
  name           text,                                 
  basis          text not null default 'percent' check (basis in ('percent','amount')),
  percent        numeric(9,6),                         
  amount         numeric(18,2),                         
  dp_percent        numeric(9,6) default 0,             
  retention_percent numeric(9,6) default 0,             
  billing_terms_months integer default 0,               
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
alter table cash_flow_trade_packages
  add column if not exists dp_tranches jsonb default '[]'::jsonb;
create index if not exists idx_cf_trade_proj on cash_flow_trade_packages(project_id);
alter table cash_flow_trade_packages enable row level security;
grant select, insert, update, delete on cash_flow_trade_packages to authenticated, service_role;
drop policy if exists cash_flow_trade_read on cash_flow_trade_packages;
create policy cash_flow_trade_read on cash_flow_trade_packages for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_trade_write on cash_flow_trade_packages;
create policy cash_flow_trade_write on cash_flow_trade_packages for all
  using (is_writer() and can_access_project(project_id))
  with check (is_writer() and can_access_project(project_id));

-- cash_flow_scenarios
create table if not exists cash_flow_scenarios (
  id           uuid primary key default gen_random_uuid(),
  project_id   text references projects(id) on delete cascade,
  name         text not null,                          
  is_baseline  boolean default false,                  
  snapshot     jsonb not null,                         
  created_by   uuid references users(id),
  created_at   timestamptz default now()
);
create index if not exists idx_cf_scen_proj on cash_flow_scenarios(project_id);
alter table cash_flow_scenarios enable row level security;
grant select, insert, update, delete on cash_flow_scenarios to authenticated, service_role;
drop policy if exists cash_flow_scen_read on cash_flow_scenarios;
create policy cash_flow_scen_read on cash_flow_scenarios for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_scen_write on cash_flow_scenarios;
create policy cash_flow_scen_write on cash_flow_scenarios for all
  using (is_writer() and can_access_project(project_id))
  with check (is_writer() and can_access_project(project_id));

-- wpm_work_packages
create table if not exists wpm_work_packages (
  id                    uuid primary key default gen_random_uuid(),
  wpm_project_id        text not null,          
  wp_no                 text not null,
  description           text,
  approved_budget_bcb   numeric(18,2),
  awarded_cost          numeric(18,2),
  total_awarded         numeric(18,2),
  dp_percent            numeric(6,5),
  retention_percent     numeric(6,5),
  payment_terms_days    integer,
  awarding_date         date,
  actual_awarding_date  date,
  target_delivery       date,
  target_installation   date,
  target_completion     date,
  source_id             uuid,                   
  synced_at             timestamptz default now(),
  unique (wpm_project_id, wp_no)
);
alter table wpm_work_packages add column if not exists award_status       text;
alter table wpm_work_packages add column if not exists procurement_status text;
alter table wpm_work_packages add column if not exists delivery_status     text;
alter table wpm_work_packages add column if not exists trade text;
create index if not exists idx_wpm_mirror_proj on wpm_work_packages(wpm_project_id);
alter table wpm_work_packages enable row level security;
grant select on wpm_work_packages to authenticated;
drop policy if exists wpm_work_packages_read on wpm_work_packages;
create policy wpm_work_packages_read on wpm_work_packages
  for select using (is_approved());

-- ppr_presentations
create table if not exists ppr_presentations (
  id          uuid primary key default gen_random_uuid(),
  project_id  text references projects(id),
  ppr_date    date,                  
  description text,                  
  created_by  uuid references users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists ppr_presentations_proj_date_idx
  on ppr_presentations (project_id, ppr_date desc);
alter table ppr_presentations enable row level security;
grant select, insert, update, delete on ppr_presentations to authenticated;

-- ppr_slides
create table if not exists ppr_slides (
  id              uuid primary key default gen_random_uuid(),
  ppr_id          uuid references ppr_presentations(id) on delete cascade,
  project_id      text references projects(id),
  slide_no        integer default 1,
  trade           text,
  works           text,
  location        text,
  key_plan_url    text,              
  before_photo_id uuid references progress_photos(id) on delete set null,
  after_photo_id  uuid references progress_photos(id) on delete set null,
  before_caption  text,              
  after_caption   text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists ppr_slides_ppr_idx
  on ppr_slides (ppr_id, slide_no);
alter table ppr_slides enable row level security;
grant select, insert, update, delete on ppr_slides        to authenticated;

-- ---- Missing columns on existing tables --------------------------------------
-- contracts_claims
alter table contracts_claims add column if not exists est_amount numeric(18,2);
alter table contracts_claims add column if not exists sub_amount numeric(18,2);
alter table contracts_claims add column if not exists eval_amount numeric(18,2);
alter table contracts_claims add column if not exists approved_amount numeric(18,2);
alter table contracts_claims add column if not exists est_days integer;
alter table contracts_claims add column if not exists sub_days integer;
alter table contracts_claims add column if not exists eval_days integer;
alter table contracts_claims add column if not exists approved_days integer;
alter table contracts_claims add column if not exists date_submitted date;
alter table contracts_claims add column if not exists date_evaluated date;
alter table contracts_claims add column if not exists date_approved date;
alter table contracts_claims add column if not exists sort_order integer default 0;

-- drawing_register
alter table drawing_register add column if not exists proj_code text;
alter table drawing_register add column if not exists building_ref text;
alter table drawing_register add column if not exists company text;
alter table drawing_register add column if not exists drawing_type text;
alter table drawing_register add column if not exists floor_level text;
alter table drawing_register add column if not exists dwg_number text;
alter table drawing_register add column if not exists drawing_code text;
alter table drawing_register add column if not exists phase text;
alter table drawing_register add column if not exists category text;
alter table drawing_register add column if not exists description text;
alter table drawing_register add column if not exists responsible text;
alter table drawing_register add column if not exists no_of_sheets integer default 1;
alter table drawing_register add column if not exists approved_sheets integer default 0;
alter table drawing_register add column if not exists approved_pct numeric;
alter table drawing_register add column if not exists submissions jsonb default '[]'::jsonb;
alter table drawing_register add column if not exists planned_approval date;
alter table drawing_register add column if not exists actual_approval date;
alter table drawing_register add column if not exists sort_order integer default 0;
alter table drawing_register add column if not exists node_kind text default 'drawing';

-- issues_lessons
alter table issues_lessons add column if not exists department text;
alter table issues_lessons add column if not exists champion text;
alter table issues_lessons add column if not exists caused_by text;
alter table issues_lessons add column if not exists corrective_action text;
alter table issues_lessons add column if not exists date_presented date;
alter table issues_lessons add column if not exists date_resolved date;
alter table issues_lessons add column if not exists lesson_learned text;
alter table issues_lessons add column if not exists lesson_category text;
alter table issues_lessons add column if not exists recommendation text;

-- material_submittal
alter table material_submittal add column if not exists code_project text;
alter table material_submittal add column if not exists code_building text;
alter table material_submittal add column if not exists code_company text;
alter table material_submittal add column if not exists code_doctype text;
alter table material_submittal add column if not exists code_discipline text;
alter table material_submittal add column if not exists code_floor text;
alter table material_submittal add column if not exists code_number text;
alter table material_submittal add column if not exists trade_section text;
alter table material_submittal add column if not exists discipline text;
alter table material_submittal add column if not exists trade_code text;
alter table material_submittal add column if not exists floor_levels text;
alter table material_submittal add column if not exists location text;
alter table material_submittal add column if not exists reference_document text;
alter table material_submittal add column if not exists brand text;
alter table material_submittal add column if not exists type_presentation text;
alter table material_submittal add column if not exists plan_submission_date date;
alter table material_submittal add column if not exists plan_approval_date date;
alter table material_submittal add column if not exists approver_consultant text;
alter table material_submittal add column if not exists approver_client text;
alter table material_submittal add column if not exists revision_no text;
alter table material_submittal add column if not exists mas_id text;
alter table material_submittal add column if not exists seq_no int;
alter table material_submittal add column if not exists sort_order int default 0;

-- progress_photos
alter table progress_photos add column if not exists trade text;
alter table progress_photos add column if not exists works text;
alter table progress_photos add column if not exists sort_order integer;

-- project_schedule
alter table project_schedule add column if not exists contract_date date;
alter table project_schedule add column if not exists seq_order numeric;
alter table project_schedule add column if not exists cost_rollup boolean default false;
alter table public.project_schedule
 add column if not exists ev_poc numeric(6,2);
ALTER TABLE public.project_schedule ADD COLUMN IF NOT EXISTS notebook jsonb;
ALTER TABLE public.project_schedule ADD COLUMN IF NOT EXISTS files jsonb;

-- projects
alter table projects add column if not exists schedule_progress numeric;
alter table projects add column if not exists schedule_start date;
alter table projects add column if not exists schedule_finish date;
alter table projects add column if not exists schedule_activities integer;
alter table projects add column if not exists schedule_updated_at timestamptz;

-- resource_assignments
alter table resource_assignments add column if not exists budgeted_cost numeric(16,2);
alter table resource_assignments add column if not exists actual_cost numeric(16,2);
alter table resource_assignments add column if not exists remaining_cost numeric(16,2);
alter table resource_assignments add column if not exists cost_account_id uuid references cost_accounts(id) on delete set null;
alter table resource_assignments add column if not exists rate_source text default 'derived';

-- resource_roles
alter table resource_roles add column if not exists price_per_unit numeric(14,2);

-- resources
alter table resources add column if not exists price_per_unit numeric(14,2);

-- ---- Project-scoped RLS for the support tables (2026-07-21 fix) ---------------
do $$
declare t text;
begin
  foreach t in array array['cost_accounts','activity_expenses','schedule_baselines','schedule_snapshots'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all using (is_planner() and can_access_project(project_id)) with check (is_planner() and can_access_project(project_id))', t || '_write', t);
  end loop;
  if to_regclass('public.schedule_audit') is not null then
    execute 'alter table schedule_audit enable row level security';
    execute 'drop policy if exists schedule_audit_read on schedule_audit';
    execute 'create policy schedule_audit_read on schedule_audit for select using (can_access_project(project_id))';
    execute 'drop policy if exists schedule_audit_write on schedule_audit';
    execute 'create policy schedule_audit_write on schedule_audit for insert with check (is_planner() and can_access_project(project_id))';
  end if;
end $$;

-- ---- Standard module RLS for the PPR tables (read + created_by-owned write) ----
do $$
declare t text;
begin
  foreach t in array array['ppr_presentations','ppr_slides'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_ins', t);
    execute format('create policy %I on %I for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id))', t || '_ins', t);
    execute format('drop policy if exists %I on %I', t || '_upd', t);
    execute format('create policy %I on %I for update using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin())) with check (is_writer() and can_access_project(project_id))', t || '_upd', t);
    execute format('drop policy if exists %I on %I', t || '_del', t);
    execute format('create policy %I on %I for delete using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()))', t || '_del', t);
  end loop;
end $$;
