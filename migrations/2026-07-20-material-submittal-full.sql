-- ============================================================================
-- Migration: Material Submittal Log — full fidelity against the PMO workbook
-- ("EPC. PMO. Material Submittal List Dashboard").
--
-- The starter table carried only 8 business columns. The real log has 28, built
-- around a 7-part structured submittal number (the same coding convention the
-- Drawing Register uses) plus TWO date pairs that the dashboard depends on:
--   submission: plan_submission_date / date_submitted (actual)
--   approval  : plan_approval_date   / date_approved  (actual)
-- The S-curve is driven by the APPROVAL pair, not submission — see the module's
-- CLAUDE.md for the derivation proof against the workbook's own formulas.
--
-- Existing starter columns are REUSED for their natural match rather than
-- duplicated, so there are no dead columns:
--   material   = Item          specification = Specification
--   supplier   = Vendor        status        = Status
--   remarks    = Remarks       submittal_no  = full composed code
--   date_required  = Required Date Baseline
--   date_submitted = Actual Submission Date
--   date_approved  = Actual Approval Date
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

-- ---- 7-part structured submittal number -----------------------------------
-- <project>-<building>-<company>-<doctype>-<discipline>-<floor>-<number>
-- e.g. TMS-SUB-MCC-MT-CL-FND-1000
alter table material_submittal add column if not exists code_project    text;
alter table material_submittal add column if not exists code_building   text;
alter table material_submittal add column if not exists code_company    text;
alter table material_submittal add column if not exists code_doctype    text;
alter table material_submittal add column if not exists code_discipline text;
alter table material_submittal add column if not exists code_floor      text;
alter table material_submittal add column if not exists code_number     text;

-- ---- classification --------------------------------------------------------
-- trade_section = the workbook's section header rows (GENERAL REQUIREMENT,
-- SITEWORKS, REBAR, …) — 23 of them; the log is grouped by these.
alter table material_submittal add column if not exists trade_section text;
-- discipline = CL/ST/AR/ME/EL/PL/FP… Drives the dashboard S-curve.
-- NOTE: the workbook has a REDUNDANT "Trades" column that its S-curve grouped
-- by; it was blank on 39 of 141 rows, silently dropping them from the chart.
-- This module groups by `discipline` (always populated) instead. Deliberate.
alter table material_submittal add column if not exists discipline    text;
-- The workbook's redundant "Trades" column, preserved ONLY so the dashboard can
-- reproduce the legacy Excel figure for reconciliation ("Excel parity" line).
-- Nothing else reads it — never group new work by this column.
alter table material_submittal add column if not exists trade_code    text;
alter table material_submittal add column if not exists floor_levels  text;
alter table material_submittal add column if not exists location      text;

-- ---- item detail -----------------------------------------------------------
alter table material_submittal add column if not exists reference_document text;
alter table material_submittal add column if not exists brand              text;
-- Sample Board | Mock Up | Brochure and Technical Data Sheet | Sample |
-- Product Certification | Test Results   (workbook "Library" sheet)
alter table material_submittal add column if not exists type_presentation  text;

-- ---- the planned half of each date pair ------------------------------------
alter table material_submittal add column if not exists plan_submission_date date;
alter table material_submittal add column if not exists plan_approval_date   date;

-- ---- approval / revision ---------------------------------------------------
alter table material_submittal add column if not exists approver_consultant text;
alter table material_submittal add column if not exists approver_client     text;
alter table material_submittal add column if not exists revision_no         text;
alter table material_submittal add column if not exists mas_id              text;

-- ---- ordering --------------------------------------------------------------
-- seq_no = the workbook's visible "NO." column (display only, may repeat/blank).
-- sort_order = the module's own stable ordering within a trade section.
alter table material_submittal add column if not exists seq_no     int;
alter table material_submittal add column if not exists sort_order int default 0;

create index if not exists material_submittal_project_idx    on material_submittal(project_id);
create index if not exists material_submittal_discipline_idx on material_submittal(project_id, discipline);
create index if not exists material_submittal_status_idx     on material_submittal(project_id, status);

-- Status vocabulary (workbook "Library" sheet, with its letter codes):
--   A Approved · B Approved w/ Comments · C Resubmit · D Rejected
--   F For Information · P For Submission · (no code) Pending Approval
comment on column material_submittal.status is
  'Approved | Approved w/ Comments | Resubmit | Rejected | For Information | For Submission | Pending Approval';
comment on column material_submittal.discipline is
  'Discipline code (CL/ST/AR/ME/EL/PL/FP…) — drives the dashboard S-curve grouping.';
comment on column material_submittal.plan_approval_date is
  'Planned approval date — the PLANNED series of the dashboard S-curve.';
comment on column material_submittal.date_approved is
  'Actual approval date — the ACTUAL series of the dashboard S-curve.';

-- RLS + grants already exist for this table (Phase-1 module table, see
-- supabase-schema.sql). Adding columns does not change either.
