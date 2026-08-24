-- ============================================================================
-- Equipment Loading — a unique equipment CODE, and equipment shared between towers
-- 2026-08-24
--
-- Two changes, and they exist for the same reason: a piece of equipment is a
-- physical asset, not a line on a sheet.
--
-- 1) equipment_items.code — the asset's own identifier (TC-01, TC-02). Unique per
--    project, case-insensitively; the NAME is deliberately left free to repeat,
--    because a project really does have three "Tower Crane" rows and telling them
--    apart by name is impossible. The code is what a portfolio-level view will
--    later join on to answer "where is TC-01 and when is it free", so it must be
--    stable and unique from the start.
--
--    ⚠️ Unique per PROJECT, not globally: two projects legitimately both number
--    their first crane TC-01, and a global constraint would refuse the second
--    project's register with an error nobody could act on. A cross-project asset
--    register is a different table and a later decision.
--
-- 2) equipment_tower_links — one row per (equipment, tower). Replaces the single
--    equipment_items.site_block.
--
--    ⚠️ A many-to-many table, not an array column, because sharing is the point:
--    a tower crane serving two towers is one asset with two placements, and the
--    question asked of it ("which equipment does Tower B have?", and later "is
--    TC-01 free in March?") is a per-placement question. An array can hold the
--    ids but cannot be joined, counted per tower by the database, or extended
--    with a placement's own dates later without rewriting every reader.
--
--    ⚠️ site_block is BACKFILLED into it and then left in place, unread. Dropping
--    the column in the same migration that starts using the new table leaves no
--    way back if the backfill was wrong; it is stale from this migration on and
--    should be dropped in a later, separate one.
--
-- ⚠️ block_id is the shape's ID from equipment_site_plan.plan, so there is no FK
-- to enforce it — the same reason site_block had none. Deleting a shape therefore
-- has to delete its links explicitly, which the module does.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

alter table equipment_items add column if not exists code text;

-- Seed a code for every existing row so the unique index can be created and the
-- register is never left with a blank identifier: category initials + a per-project
-- sequence, which a planner can then rename to the site's own numbering.
with seeded as (
  select id,
         upper(left(regexp_replace(coalesce(category, 'EQ'), '[^A-Za-z]', '', 'g'), 2)) as pfx,
         row_number() over (partition by project_id, category order by sort_order, created_at, id) as n
  from equipment_items
  where code is null or btrim(code) = ''
)
update equipment_items e
   set code = s.pfx || '-' || lpad(s.n::text, 2, '0')
  from seeded s
 where e.id = s.id;

create unique index if not exists equipment_items_code_uni
  on equipment_items(project_id, lower(btrim(code)));

create table if not exists equipment_tower_links (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  equipment_id uuid not null references equipment_items(id) on delete cascade,
  block_id text not null,
  created_by uuid,
  created_at timestamptz default now()
);

-- One row per (equipment, tower). Without this two browsers can each add the same
-- placement and every per-tower count double-reports it.
create unique index if not exists equipment_tower_links_uni
  on equipment_tower_links(equipment_id, block_id);
create index if not exists equipment_tower_links_project_idx
  on equipment_tower_links(project_id, block_id);

-- Backfill the existing single assignment. Guarded on the link not already existing,
-- so re-running cannot duplicate a placement a planner has since removed and re-added.
insert into equipment_tower_links (project_id, equipment_id, block_id, created_by)
select i.project_id, i.id, i.site_block, i.created_by
  from equipment_items i
 where nullif(btrim(coalesce(i.site_block, '')), '') is not null
   and not exists (
     select 1 from equipment_tower_links l
      where l.equipment_id = i.id and l.block_id = i.site_block);

grant select, insert, update, delete on equipment_tower_links to authenticated;
alter table equipment_tower_links enable row level security;

drop policy if exists equipment_tower_links_read on equipment_tower_links;
create policy equipment_tower_links_read on equipment_tower_links
  for select using (can_access_project(project_id));
drop policy if exists equipment_tower_links_write on equipment_tower_links;
create policy equipment_tower_links_write on equipment_tower_links
  for all using (is_writer() and can_access_project(project_id))
       with check (is_writer() and can_access_project(project_id));
