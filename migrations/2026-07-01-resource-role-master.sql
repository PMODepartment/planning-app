-- ============================================================================
-- Migration: Resource & Role master (OPC-faithful) for the resource-loading
-- module. Run in the Supabase SQL editor. Idempotent.
--
-- Mirrors Oracle Primavera Cloud's Resources/Roles: a role roster (Primary
-- Role) and a resource roster with ID, Type, Default & Max Units/Time (the
-- availability line), UoM and Calendar. Time-phased assignment usage (feeding
-- Project Schedule's Resource/Role Usage tabs) comes in a later phase.
-- ============================================================================

create table if not exists resource_roles (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  name text,                       -- Primary Role, e.g. "Planning Engineer"
  discipline text,                 -- e.g. Labor | Engineering | Field
  uom text default 'hours',        -- unit of measure
  remarks text,
  created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  resource_code text,              -- OPC "ID", e.g. R150082
  name text,
  type text default 'Labor',       -- Labor | Nonlabor | Material
  primary_role text,               -- links (by name) to resource_roles.name
  default_units_per_time numeric default 100,  -- % (OPC Default Units/Time)
  max_units_per_time numeric default 100,      -- % availability (Max Units/Time)
  uom text default 'hours',
  calendar text,                   -- e.g. "MCC Project Calendar 2020-2049 5-2-1"
  remarks text,
  created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

grant select, insert, update, delete on resource_roles, resources to authenticated;

do $$
declare t text;
begin
  foreach t in array array['resource_roles','resources'] loop
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
