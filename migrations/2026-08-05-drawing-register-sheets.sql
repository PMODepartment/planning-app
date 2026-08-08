-- ============================================================================
-- Drawing Register — per-sheet tracking matrix.
--
-- A drawing may be broken out into one row PER SHEET. A sheet is an ordinary
-- `drawing_register` row (node_kind='drawing', no_of_sheets=1) that points at its
-- parent drawing via `parent_id`. The parent keeps the things that belong to the
-- whole drawing — the single planned approval date, the schedule link, the title
-- — and its sheet counters (no_of_sheets / approved_sheets / approved_pct /
-- actual_approval) become DERIVED roll-ups over its children, written back by the
-- app so every existing consumer (Overview KPIs, progress tables, export, backlog)
-- keeps working unchanged.
--
-- Aggregate mode is unaffected: a drawing with NO children is exactly what it was
-- before — one row carrying no_of_sheets=100 / approved_sheets=37 by hand. Which
-- mode a drawing uses is per drawing, chosen by the Technical Officer.
--
-- Idempotent — safe to re-run.
-- ============================================================================

alter table drawing_register
  add column if not exists parent_id uuid references drawing_register(id) on delete cascade;

-- The grid looks children up by parent on every render, and the cascade above
-- means a parent delete scans this too.
create index if not exists drawing_register_parent_idx
  on drawing_register (parent_id);

comment on column drawing_register.parent_id is
  'Sheet rows point at their parent drawing. NULL = a normal drawing (or a structural node).';
