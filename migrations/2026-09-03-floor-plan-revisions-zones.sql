-- Progress Photos — Floor Plan revisions + manually-drawn Zones
-- ------------------------------------------------------------------
-- Two additive changes to the existing floor_plans / floor_plan_pins schema
-- (migrations/2026-08-29-floor-plans.sql, 2026-08-30-photos-round2.sql).
-- Reuses the EXISTING location model rather than inventing a parallel one:
-- a floor plan is already keyed by `location_values` (a jsonb map onto the
-- project's schedule Location Breakdown levels). Tower = the project's
-- first Location Breakdown level, Floor = its second — the same "first two
-- levels" convention this app's own module.js already documents elsewhere
-- (locRequiredLevels()). No new tower_id/floor_id columns.
--
-- 1) REVISIONS. `floor_plans` previously had no revision concept at all —
--    uploading a second plan for the same Tower+Floor silently created a
--    second, undated, unordered row with no way to tell which was current.
--    `revision` (user-typed, belongs to the drawing itself — never inferred
--    from the filename) + `is_current` (exactly one true row per Tower+Floor
--    group, enforced in application code: the previous current row is
--    UPDATEd to false, never deleted, in the same save that inserts the
--    new one). created_by/created_at/updated_at already existed and serve
--    as "Uploaded By / Uploaded Date / Last Updated" — no duplicate columns.
--
-- 2) ZONES. `floor_plan_zones` — a user-drawn polygon/rectangle boundary,
--    named by the user, scoped to ONE floor_plan_id (one specific
--    REVISION, never the Tower+Floor group as a whole) — so a new revision
--    starts with zero zones and old revisions keep exactly the zones they
--    had, per spec: "do not silently copy old geometry to a new revision."
--    Deliberately NOT the same thing as a `location_levels` "Zone" level
--    (a schedule-driven text tag) — this is a real drawn boundary, additive
--    and unrelated to that existing concept.
--
-- Idempotent; folded into supabase-schema.sql's per-module RLS loop.

alter table floor_plans add column if not exists revision text not null default 'Rev. 01';
alter table floor_plans add column if not exists is_current boolean not null default true;
comment on column floor_plans.revision is 'User-entered drawing revision label (e.g. "Rev. 03") — belongs to the document, never inferred from the filename.';
comment on column floor_plans.is_current is 'Exactly one true row per (project, location_values) group. Older revisions are preserved with this flipped to false, never deleted.';

create index if not exists idx_floor_plans_current on floor_plans(project_id, is_current);

-- One row per user-drawn zone, scoped to a specific floor-plan REVISION.
-- boundary_coordinates is an ordered array of {x,y} points normalized 0..1
-- against the plan image — the same normalized-coordinate convention
-- floor_plan_pins.x_norm/y_norm already uses, so both share one mental
-- model of "a point on this plan". Stored as one array regardless of
-- whether the user drew a polygon or a rectangle — boundary_type is
-- provenance (which tool was used) only, never a second geometry format,
-- so every consumer (render/hit-test/edit) has exactly one shape to handle.
create table if not exists floor_plan_zones (
  id uuid primary key default gen_random_uuid(),
  floor_plan_id uuid not null references floor_plans(id) on delete cascade,
  project_id text references projects(id),
  name text not null,
  boundary_type text not null default 'polygon' check (boundary_type in ('polygon', 'rectangle')),
  boundary_coordinates jsonb not null,
  color text,
  created_by uuid references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_floor_plan_zones_plan on floor_plan_zones(floor_plan_id);
create index if not exists idx_floor_plan_zones_project on floor_plan_zones(project_id);
-- Avoid duplicate zone names within the same floor-plan revision (spec
-- §13), case-insensitive so "Zone A" and "zone a" are treated as the same
-- collision. A partial unique index rather than a plain UNIQUE constraint
-- so it composes cleanly if a future soft-delete flag is ever added.
create unique index if not exists idx_floor_plan_zones_name_uniq
  on floor_plan_zones(floor_plan_id, lower(name));

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'floor_plan_zones' and policyname = 'floor_plan_zones_rw') then
    execute 'alter table floor_plan_zones enable row level security';
    execute 'create policy floor_plan_zones_rw on floor_plan_zones for all
      using (is_writer() and can_access_project(project_id))
      with check (is_writer() and can_access_project(project_id))';
    execute 'create policy floor_plan_zones_read on floor_plan_zones for select
      using (can_access_project(project_id))';
  end if;
end $$;
