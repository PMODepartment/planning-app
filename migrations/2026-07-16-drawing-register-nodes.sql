-- ============================================================================
-- Drawing Register — structural tree nodes.
-- Lets planners build the level skeleton (phase → discipline → category) as real
-- rows, then add drawings under a selected node. Backward compatible: existing
-- imported rows default to node_kind='drawing' and still render via their
-- phase/discipline/category text. Idempotent.
-- ============================================================================

alter table drawing_register add column if not exists node_kind text default 'drawing';
  -- one of: phase | discipline | category | drawing

update drawing_register set node_kind = 'drawing' where node_kind is null;

create index if not exists drawing_register_kind_idx
  on drawing_register (project_id, node_kind, sort_order);
