-- ============================================================================
-- Manpower Loading — Table of Organization, schedule/location tagging, manhours
-- 2026-08-31
--
-- Adds what the existing manpower_positions/manpower_loading/manpower_roster
-- tables (2026-08-27) could not yet do:
--
--   1. A real reporting-line hierarchy for the Table of Organization view, kept
--      OPTIONAL — a position with no manager still renders, grouped by
--      department, exactly as today. `reports_to_id` is a self-reference so a
--      planner who wants a true org tree can build one without a schema change.
--
--   2. `manpower_roster` gains the SAME schedule-link shape equipment_items
--      already carries (`2026-08-24-equipment-schedule-link.sql`) — one
--      activity or one WBS branch, plus a `location` jsonb keyed by
--      `location_levels.id` (the same shape `project_schedule.location`
--      already uses). ⚠️ This is a TAG, not a second source of derived
--      months — manpower_loading is still driven by the roster's own
--      contract_start/contract_end (2026-08-28's derivation). Linking a
--      subcontractor to an activity says WHERE they work, for the
--      Activities×Subcontractor matrix and the vertical stacking view; it
--      does not compute a duration a second, possibly-disagreeing way.
--
--   3. `manpower_manhours` — one row per (roster entry, month), planned and
--      actual hours. ⚠️ Its own table, not a jsonb blob and not columns on
--      manpower_roster, for the same reason manpower_loading is its own
--      table: two people editing different months must not clobber each
--      other, and the database needs to sum it per month.
--
-- ⚠️ `location` on manpower_roster is intentionally NOT restricted to any
-- workforce category at the database level. The UI only offers it for Skilled
-- Self-Performed / Subcontractors (an office-based Project Staff profile has
-- no site location to tag), but that is a UI decision, not a data rule the
-- schema should enforce — a category renamed or reused later must not need a
-- migration to keep working.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

alter table manpower_positions add column if not exists reports_to_id uuid
  references manpower_positions(id) on delete set null;
create index if not exists manpower_positions_reports_to_idx
  on manpower_positions(reports_to_id);

alter table manpower_roster add column if not exists link_mode text;         -- null | 'activity' | 'wbs'
alter table manpower_roster add column if not exists link_activity_id text;  -- project_schedule.activity_id
alter table manpower_roster add column if not exists link_wbs text;          -- WBS path prefix
alter table manpower_roster add column if not exists link_label text;        -- cached display name
alter table manpower_roster add column if not exists link_start date;        -- resolved span, cached
alter table manpower_roster add column if not exists link_finish date;
alter table manpower_roster add column if not exists link_synced_at timestamptz;
alter table manpower_roster add column if not exists location jsonb default '{}'::jsonb;

-- Same two indexed reads equipment_items' link resolution relies on.
create index if not exists project_schedule_actid_idx on project_schedule(project_id, activity_id);
create index if not exists project_schedule_wbs_idx on project_schedule(project_id, wbs);

create table if not exists manpower_manhours (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  roster_id uuid not null references manpower_roster(id) on delete cascade,
  period date not null,                   -- first day of the month
  planned_hours numeric,
  actual_hours numeric,
  source text,                            -- 'hand' — reserved for a future derivation source
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- One row per roster entry per month, for the same reason manpower_loading has
-- one per (position, month): without it two browsers can each insert the same
-- month and every manhours total silently double-counts it.
create unique index if not exists manpower_manhours_uni
  on manpower_manhours(roster_id, period);
create index if not exists manpower_manhours_project_idx
  on manpower_manhours(project_id, period);

grant select, insert, update, delete on manpower_manhours to authenticated;
alter table manpower_manhours enable row level security;
drop policy if exists manpower_manhours_read on manpower_manhours;
create policy manpower_manhours_read on manpower_manhours
  for select using (can_access_project(project_id));
drop policy if exists manpower_manhours_write on manpower_manhours;
create policy manpower_manhours_write on manpower_manhours
  for all using (is_writer() and can_access_project(project_id))
  with check (is_writer() and can_access_project(project_id));

drop trigger if exists manpower_manhours_touch on manpower_manhours;
create trigger manpower_manhours_touch before update on manpower_manhours
  for each row execute function public.manpower_touch();

-- ⚠️ Re-declared here (identical to 2026-08-24-equipment-loading.sql) so this
-- module does not depend on Equipment Loading's migration having been run
-- first. `create or replace` on an identical body is a no-op if it already
-- exists; SECURITY INVOKER so the caller's own RLS on project_schedule still
-- applies — never DEFINER, which would leak another project's locations.
create or replace function public.project_location_values(p_project_id text, p_key text)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('value', v, 'n', n) order by v), '[]'::jsonb)
  from (
    select trim(location ->> p_key) as v, count(*) as n
    from project_schedule
    where project_id = p_project_id
      and coalesce(activity_type, '') <> 'WBS Summary'
      and nullif(trim(coalesce(location ->> p_key, '')), '') is not null
    group by 1
  ) t;
$$;
grant execute on function public.project_location_values(text, text) to authenticated;
