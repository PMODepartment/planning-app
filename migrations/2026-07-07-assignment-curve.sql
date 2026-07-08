-- ============================================================================
-- Migration: resource/cost distribution curve per assignment (P6 "Resource
-- Curves"). Controls how an assignment's units/cost are time-phased across its
-- activity's dates in the Resource Usage histogram/spreadsheet, instead of the
-- default uniform (linear) spread: linear | front | back | bell.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

alter table resource_assignments add column if not exists curve text default 'linear';

comment on column resource_assignments.curve is
  'Distribution curve for time-phasing this assignment: linear (uniform), front '
  '(front-loaded), back (back-loaded), or bell (peak mid-activity).';
