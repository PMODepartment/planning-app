-- ============================================================================
-- Migration: per-activity 3-point duration override for the Monte Carlo schedule
-- risk simulation (Actions ▾ → Schedule risk). When set, an activity's own
-- Optimistic %/Pessimistic % of plan is used instead of the simulation-wide
-- default (which otherwise applies the same relative spread to every activity).
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
-- ============================================================================

alter table project_schedule add column if not exists risk_optimistic_pct numeric(6,2);
alter table project_schedule add column if not exists risk_pessimistic_pct numeric(6,2);

comment on column project_schedule.risk_optimistic_pct is
  'Per-activity Monte Carlo override: optimistic duration as a % of plan (e.g. 85 = 85%). '
  'Null = use the simulation-wide Optimistic % entered in the Schedule Risk dialog.';
comment on column project_schedule.risk_pessimistic_pct is
  'Per-activity Monte Carlo override: pessimistic duration as a % of plan (e.g. 150 = 150%). '
  'Null = use the simulation-wide Pessimistic % entered in the Schedule Risk dialog.';
