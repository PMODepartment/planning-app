-- ============================================================================
-- Schedule Builder sub-module — bottom-up / location-based schedule setup.
-- One config row per project (the whole builder state as jsonb). The generated
-- output is previewed in-module and will later be pushed into project_schedule.
-- Idempotent; safe to re-run.
-- ============================================================================

create table if not exists schedule_builder (
  project_id  text primary key references projects(id) on delete cascade,
  config      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz default now(),
  updated_by  uuid
);

alter table schedule_builder enable row level security;

grant select, insert, update, delete on schedule_builder to authenticated;

-- Project-scoped RLS (matches the 2026-07-21 project-scope convention):
--   read  = approved AND can access the project
--   write = writer role AND can access the project
drop policy if exists schedule_builder_read  on schedule_builder;
drop policy if exists schedule_builder_write on schedule_builder;

create policy schedule_builder_read on schedule_builder
  for select using ( can_access_project(project_id) );

create policy schedule_builder_write on schedule_builder
  for all using ( is_writer() and can_access_project(project_id) )
          with check ( is_writer() and can_access_project(project_id) );
