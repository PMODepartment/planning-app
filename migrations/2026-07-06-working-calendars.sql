-- ============================================================================
-- Migration: Working calendars for the resource-loading + project-schedule
-- modules. Run in the Supabase SQL editor. Idempotent.
--
-- Adds a `calendars` master (project-scoped, same pattern as resources/roles):
-- a working-day pattern (which weekdays are worked + hours/day) plus an
-- editable list of extra (movable/proclaimed) holiday dates. The Philippine
-- *regular* holidays with fixed or Easter-derived dates are computed in JS
-- (assets/js/calendar.js) rather than stored — only Eid'l Fitr/Eid'l Adha and
-- any ad-hoc proclamation-moved dates need to be added here by hand, since
-- those are announced yearly by the Philippine government and can't be
-- computed offline.
--
-- `resources.calendar_id` / `project_schedule.calendar_id` replace the old
-- free-text `calendar` column as the source of truth going forward; the text
-- column is kept for legacy display fallback (rows saved before this
-- migration) but is no longer written by the app.
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
  extra_holidays date[] default '{}',   -- movable/proclaimed holidays (Eid'l Fitr, Eid'l Adha, proclamation-moved dates, etc.)
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
