-- ============================================================================
-- Migration: first-class Work Breakdown Structure (P6 PROJWBS). The WBS tree is
-- authored in wbs_nodes (unlimited depth via parent_id); each node's dotted code
-- is auto-numbered from tree position but can be overridden (code_custom).
--
-- Integration: wbs_nodes is the source of truth for the TREE. On every tree edit
-- the app PROJECTS the nodes into the existing project_schedule WBS-Summary rows
-- (one row per node, linked by wbs_node_id, carrying the node's code + name), so
-- the whole existing grid / roll-up / CPM / importer pipeline — which keys off the
-- dotted project_schedule.wbs code — keeps working unchanged. Activities link to
-- their node via project_schedule.wbs_node_id and carry the denormalized code in
-- project_schedule.wbs.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists wbs_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  parent_id uuid references wbs_nodes(id) on delete cascade,
  code text,                         -- dotted code (auto from position, or custom)
  code_custom boolean default false, -- true = user overrode the code; auto-numbering keeps it
  name text not null,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create index if not exists wbs_nodes_project_idx on wbs_nodes(project_id);
create index if not exists wbs_nodes_parent_idx on wbs_nodes(parent_id);

-- Link an activity (or a projected WBS-Summary row) to its WBS node.
alter table project_schedule add column if not exists wbs_node_id uuid;
create index if not exists project_schedule_wbs_node_idx on project_schedule(wbs_node_id);

alter table wbs_nodes enable row level security;
drop policy if exists wbs_nodes_read on wbs_nodes;
create policy wbs_nodes_read on wbs_nodes for select using (is_approved());
drop policy if exists wbs_nodes_write on wbs_nodes;
create policy wbs_nodes_write on wbs_nodes for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on wbs_nodes to authenticated;
