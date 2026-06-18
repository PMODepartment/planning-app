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

-- ───────────────────────── Grants (API roles) ─────────────────────────
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

-- ───────────────────────── Helper functions ─────────────────────────
create or replace function is_admin() returns boolean language sql stable as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.status='approved' and u.role in ('admin','super_admin'));
$$;
create or replace function is_approved() returns boolean language sql stable as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.status='approved');
$$;
create or replace function can_access_project(pid text) returns boolean language sql stable as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.status='approved'
    and (u.role in ('admin','super_admin') or pid = any(u.projects)));
$$;

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
    'project_schedule','resource_loading','productivity_rates','cash_flow'
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
