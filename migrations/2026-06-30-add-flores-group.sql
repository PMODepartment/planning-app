-- ============================================================================
-- Migration: add "Flores Group" group head under Operations.
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
-- ============================================================================
insert into workspaces (id, name, code, parent_id, node_type, group_head, sort_order) values
  ('FLORES', 'Flores Group', 'FLO', 'OPS', 'group', 'Flores Group', 4)
on conflict (id) do nothing;
