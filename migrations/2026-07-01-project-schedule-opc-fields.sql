-- ============================================================================
-- Migration: add remaining Oracle Primavera Cloud (OPC) Activity Details fields
-- to project_schedule. Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

alter table project_schedule
  -- General
  add column if not exists owner text,
  add column if not exists work_package text,
  add column if not exists calendar text,
  add column if not exists duration_type text default 'Fixed Duration & Units/Time',
  add column if not exists percent_complete_type text default 'Duration',
  add column if not exists program_milestone boolean default false,
  -- Status: dates / duration
  add column if not exists expected_finish date,
  add column if not exists actual_duration numeric,
  add column if not exists remaining_duration numeric,
  add column if not exists free_float numeric,
  -- Status: labor units
  add column if not exists planned_labor_units numeric,
  add column if not exists actual_labor_units numeric,
  add column if not exists remaining_labor_units numeric,
  -- Status: constraints
  add column if not exists primary_constraint text,
  add column if not exists primary_constraint_date date,
  add column if not exists secondary_constraint text,
  add column if not exists secondary_constraint_date date;
