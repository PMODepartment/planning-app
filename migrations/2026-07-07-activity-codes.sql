-- ============================================================================
-- Migration: Activity Codes (OPC-style project-defined code dictionaries, e.g.
-- Phase / Area / Zone) for grouping and filtering the schedule orthogonally to
-- the WBS. Each project defines its own code TYPES; each type has a list of
-- VALUES; each activity is assigned at most one value per type, stored as a
-- compact jsonb map on project_schedule ({ "<code_type_id>": "<code_value_id>" })
-- rather than a join table, matching the schedule_baselines jsonb-snapshot
-- convention already used in this module.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists activity_code_types (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  name text not null,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now()
);

create table if not exists activity_code_values (
  id uuid primary key default gen_random_uuid(),
  code_type_id uuid references activity_code_types(id) on delete cascade,
  project_id text not null,
  value text not null,
  color text,
  sort_order int default 0,
  created_at timestamptz default now()
);

create index if not exists activity_code_types_project_idx on activity_code_types(project_id);
create index if not exists activity_code_values_type_idx on activity_code_values(code_type_id);

alter table project_schedule add column if not exists activity_codes jsonb default '{}'::jsonb;

alter table activity_code_types enable row level security;
drop policy if exists activity_code_types_read on activity_code_types;
create policy activity_code_types_read on activity_code_types for select using (is_approved());
drop policy if exists activity_code_types_write on activity_code_types;
create policy activity_code_types_write on activity_code_types for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on activity_code_types to authenticated;

alter table activity_code_values enable row level security;
drop policy if exists activity_code_values_read on activity_code_values;
create policy activity_code_values_read on activity_code_values for select using (is_approved());
drop policy if exists activity_code_values_write on activity_code_values;
create policy activity_code_values_write on activity_code_values for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on activity_code_values to authenticated;
