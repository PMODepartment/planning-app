-- ============================================================================
-- Migration: User-Defined Fields (UDFs, P6/OPC "User Defined Fields") — project-
-- defined typed custom fields (Text / Number / Date / Cost) attached to
-- activities. Definitions live in activity_udf_defs; each activity's values are
-- a compact jsonb map on project_schedule ({ "<def_id>": value }), matching the
-- activity_codes convention.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists activity_udf_defs (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  name text not null,
  field_type text default 'text' check (field_type in ('text','number','date','cost')),
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists activity_udf_defs_project_idx on activity_udf_defs(project_id);

alter table project_schedule add column if not exists udf jsonb default '{}'::jsonb;

alter table activity_udf_defs enable row level security;
drop policy if exists activity_udf_defs_read on activity_udf_defs;
create policy activity_udf_defs_read on activity_udf_defs for select using (is_approved());
drop policy if exists activity_udf_defs_write on activity_udf_defs;
create policy activity_udf_defs_write on activity_udf_defs for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on activity_udf_defs to authenticated;
