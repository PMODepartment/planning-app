-- ============================================================================
-- Migration: link the Drawing Register + Material Submittal Log to the
-- Project Schedule.
--
-- A drawing / material submittal is a PREREQUISITE for construction work: the
-- linked schedule activity's start date is the "need-by / required-on-site"
-- date, and (start − lead_days) is the date the document must be APPROVED by.
-- That drives the register's planned-approval field automatically, and any
-- activity whose enabling documents aren't approved by their need-by date is a
-- schedule-readiness risk.
--
-- LINK TARGET = project_schedule.activity_id (the P6/business key), NOT the row
-- uuid. Schedule re-imports (P6/XER "Replace") delete + re-insert every row, so
-- the uuid changes each time while activity_id (e.g. A1010) is stable — the link
-- survives a re-import. Stored as plain text scoped by project_id; no FK, since
-- the schedule row may not exist yet at link time and must not block the write.
--
-- Run in the Supabase SQL editor. Idempotent. RLS/grants unchanged (both are
-- existing module tables — adding columns doesn't alter either).
-- ============================================================================

-- ---- Drawing Register ------------------------------------------------------
alter table drawing_register add column if not exists schedule_activity_id text;
-- Optional coarser link: a WBS code, when a drawing enables a whole trade/zone
-- rather than one activity. activity link wins when both are set.
alter table drawing_register add column if not exists schedule_wbs text;
-- Approval-before-start lead time (days). NULL falls back to the project default
-- (drawings typically approved ~30 days before the work they enable).
alter table drawing_register add column if not exists lead_days int;

create index if not exists drawing_register_sched_act_idx
  on drawing_register (project_id, schedule_activity_id);

comment on column drawing_register.schedule_activity_id is
  'Links to project_schedule.activity_id (business key, survives re-import). '
  'The activity''s start is the drawing''s need-by date.';
comment on column drawing_register.lead_days is
  'Days the drawing must be approved BEFORE the linked activity starts. '
  'NULL = project default (~30). required_approval = activity_start − lead_days.';

-- ---- Material Submittal Log ------------------------------------------------
alter table material_submittal add column if not exists schedule_activity_id text;
alter table material_submittal add column if not exists schedule_wbs text;
alter table material_submittal add column if not exists lead_days int;

create index if not exists material_submittal_sched_act_idx
  on material_submittal (project_id, schedule_activity_id);

comment on column material_submittal.schedule_activity_id is
  'Links to project_schedule.activity_id (business key, survives re-import). '
  'The activity''s start is the submittal''s need-by date.';
comment on column material_submittal.lead_days is
  'Days the material must be approved BEFORE the linked activity starts '
  '(procurement + delivery lead). NULL = project default (~45). '
  'required_approval = activity_start − lead_days.';
