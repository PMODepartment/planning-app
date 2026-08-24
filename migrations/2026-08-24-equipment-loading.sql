-- ============================================================================
-- Equipment Loading (per project) — 2026-08-24
--
-- Three objects, and the split is the design:
--   equipment_items    one row per piece of equipment on the project (the register)
--   equipment_loading  one row per (equipment, month) carrying planned + actual qty
--   equipment_site_plan  ONE row per project holding the site-dev blocks as jsonb
--
-- ⚠️ The monthly quantities are their own table, not a jsonb blob on the item. A blob
-- can hold the numbers but cannot be filtered, summed per month by the database, or
-- edited by two people without one clobbering the other's month. Same call the
-- productivity module made for productivity_entries.
--
-- ⚠️ The site plan IS a jsonb blob, deliberately the opposite call: it is geometry
-- (x/y/w/h of each block on a plan view) read and written as one picture, never
-- queried a block at a time. Same shape as schedule_builder.config.
--
-- ⚠️ equipment_items.site_block stores the block's ID, never its NAME. Renaming a
-- tower must not orphan every assignment — the WBS-code lesson, where a name-derived
-- key drifted the moment the tree was renumbered.
--
-- RLS is project-scoped from the start (the 2026-07-21 fix pattern). Writes are
-- is_writer() (approved, not a viewer) rather than resource-loading's
-- created_by-or-admin: an equipment register is maintained by the whole project
-- team, and "only the person who typed it may fix it" is how a register goes stale.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists equipment_items (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  name text not null,
  category text not null default 'Ground Equipment',
  acquisition text,                       -- Purchase | Rental
  unit text,                              -- unit / set / lot
  site_block text,                        -- id of a block in equipment_site_plan.plan
  monthly_rate numeric,                   -- rental/ownership cost per unit per month
  supplier text,
  remarks text,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists equipment_loading (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  equipment_id uuid not null references equipment_items(id) on delete cascade,
  period date not null,                   -- first day of the month
  planned_qty numeric,
  actual_qty numeric,
  remarks text,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists equipment_site_plan (
  project_id text primary key,
  plan jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_at timestamptz default now()
);

-- One row per equipment per month. Without this two browsers can each insert the
-- same month and the matrix silently double-counts it.
create unique index if not exists equipment_loading_uni
  on equipment_loading(equipment_id, period);
create index if not exists equipment_loading_project_idx
  on equipment_loading(project_id, period);
create index if not exists equipment_items_project_idx
  on equipment_items(project_id, sort_order);

-- ---- Distinct location values, for seeding the site plan from the schedule ----
-- ⚠️ An RPC because PostgREST cannot do DISTINCT: the alternative is paging every
-- activity row (40k on a real project, capped at 1000 per read) to find perhaps six
-- tower names. security INVOKER, so the caller's RLS on project_schedule still applies —
-- never definer, which would leak another project's locations.
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

grant select, insert, update, delete on equipment_items, equipment_loading, equipment_site_plan to authenticated;

alter table equipment_items enable row level security;
alter table equipment_loading enable row level security;
alter table equipment_site_plan enable row level security;

do $$
declare t text;
begin
  foreach t in array array['equipment_items','equipment_loading','equipment_site_plan'] loop
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_write', t);
    execute format('create policy %I on %I for all using (is_writer() and can_access_project(project_id)) with check (is_writer() and can_access_project(project_id))', t||'_write', t);
  end loop;
end $$;

-- Keep updated_at honest: the register reports "last updated" per item, and an
-- updated_at that only records the INSERT reports an item edited this morning as
-- untouched. Same reasoning as the packages table.
create or replace function public.equipment_touch() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists equipment_items_touch on equipment_items;
create trigger equipment_items_touch before update on equipment_items
  for each row execute function public.equipment_touch();
drop trigger if exists equipment_loading_touch on equipment_loading;
create trigger equipment_loading_touch before update on equipment_loading
  for each row execute function public.equipment_touch();
drop trigger if exists equipment_site_plan_touch on equipment_site_plan;
create trigger equipment_site_plan_touch before update on equipment_site_plan
  for each row execute function public.equipment_touch();
