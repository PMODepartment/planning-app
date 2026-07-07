-- ============================================================================
-- Migration: per-activity Contract Date (obligation/LD date) on project_schedule.
-- Lets the Planner Cockpit flag activities/milestones whose forecast finish is
-- LATER than the contractual date (liquidated-damages exposure).
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
-- ============================================================================

alter table project_schedule add column if not exists contract_date date;

comment on column project_schedule.contract_date is
  'Contractual / obligation finish date for this activity or milestone. When the '
  'forecast finish (actual_finish || end_date) is later, the cockpit flags LD exposure.';
