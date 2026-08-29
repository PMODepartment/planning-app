-- Progress Photos — Floor Plan overlay (brief Section 6B / Phase 5)
-- ------------------------------------------------------------------
-- "BIM Model Overlay" here means what the brief's own examples describe:
-- placing a captured panorama / 3D reconstruction / photo as a PIN on a 2D
-- floor plan image, so a reviewer can click around a floor plan the way
-- Matterport's dollhouse/floor-plan view works. It deliberately does NOT mean
-- importing or registering against a real BIM/IFC model — that is a much
-- larger, separate undertaking (true 3D<->3D registration against an
-- authored BIM model) and was not attempted; noted plainly in
-- modules/progress-photos/CLAUDE.md rather than silently scoped down.
--
-- Idempotent; folded into supabase-schema.sql's per-module RLS loop.

create table if not exists floor_plans (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  name text not null,
  level_order integer default 0,
  image_url text,          -- storage object path in the progress-photos bucket, signed on demand
  width_px integer,
  height_px integer,
  created_by uuid references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_floor_plans_project on floor_plans(project_id);

-- One row per pin. item_type + item_id is a soft polymorphic reference
-- (panoramas / reconstruction_requests / progress_photos), not three
-- separate FK columns — a pin's target kind never changes after it's placed,
-- so this avoids three nullable FK columns where only one is ever non-null.
-- No hard FK to any of the three target tables: a pin surviving its target's
-- deletion (rendered as a broken/removable pin, never silently vanishing) is
-- safer than a cross-table trigger the module would have to maintain by hand.
create table if not exists floor_plan_pins (
  id uuid primary key default gen_random_uuid(),
  floor_plan_id uuid references floor_plans(id) on delete cascade,
  project_id text references projects(id),
  item_type text not null check (item_type in ('panorama', 'reconstruction', 'photo')),
  item_id uuid not null,
  x_norm double precision not null check (x_norm >= 0 and x_norm <= 1),
  y_norm double precision not null check (y_norm >= 0 and y_norm <= 1),
  label text,
  created_by uuid references users(id),
  created_at timestamptz default now()
);

create index if not exists idx_floor_plan_pins_plan on floor_plan_pins(floor_plan_id);
create index if not exists idx_floor_plan_pins_project on floor_plan_pins(project_id);

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'floor_plans' and policyname = 'floor_plans_rw') then
    execute 'alter table floor_plans enable row level security';
    execute 'create policy floor_plans_rw on floor_plans for all
      using (is_writer() and can_access_project(project_id))
      with check (is_writer() and can_access_project(project_id))';
    execute 'create policy floor_plans_read on floor_plans for select
      using (can_access_project(project_id))';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'floor_plan_pins' and policyname = 'floor_plan_pins_rw') then
    execute 'alter table floor_plan_pins enable row level security';
    execute 'create policy floor_plan_pins_rw on floor_plan_pins for all
      using (is_writer() and can_access_project(project_id))
      with check (is_writer() and can_access_project(project_id))';
    execute 'create policy floor_plan_pins_read on floor_plan_pins for select
      using (can_access_project(project_id))';
  end if;
end $$;
