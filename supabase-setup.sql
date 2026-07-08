-- ============================================================================
-- Planners Dashboard — ONE-PASTE SUPABASE SETUP
-- ----------------------------------------------------------------------------
-- Run this ENTIRE file once in the Supabase SQL editor of a fresh project.
-- It is idempotent (safe to re-run) and supersedes running the individual
-- files in /migrations. Order: tables → grants → helpers → RLS → storage →
-- demo seed → bootstrap admin.
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
    'resource_roles','resources','resource_assignments'
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
drop policy if exists projects_admin_write on projects;
drop policy if exists projects_write on projects;
create policy projects_write on projects for all using (is_planner()) with check (is_planner());

-- ───────────────────────── RLS: Activity Codes / Steps / Last Planner ─────────────────────────
-- These three (added 2026-07-07) use the simpler is_approved()/is_planner() read/write split
-- (matches schedule_baselines/schedule_audit/schedule_snapshots) rather than the per-project
-- can_access_project() loop above — kept as standalone blocks so this file matches each
-- table's own migration exactly. Must come after is_planner() is defined (just above).
do $$
declare t text;
begin
  foreach t in array array['activity_code_types','activity_code_values','activity_udf_defs','activity_steps','weekly_commitments','schedule_scenarios','schedule_thresholds'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('create policy %I on %I for select using (is_approved())', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_write', t);
    execute format('create policy %I on %I for all using (is_planner()) with check (is_planner())', t||'_write', t);
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
  create policy calendars_ins on calendars for insert with check (is_approved() and created_by = auth.uid() and can_access_project(project_id));
  drop policy if exists calendars_upd on calendars;
  create policy calendars_upd on calendars for update using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
  drop policy if exists calendars_del on calendars;
  create policy calendars_del on calendars for delete using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
end $$;
