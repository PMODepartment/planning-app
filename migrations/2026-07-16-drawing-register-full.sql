-- ============================================================================
-- Drawing Register — full-fidelity rebuild (matches the Megawide "Drawing
-- Register & Tracker" workbook: GPR101. TEC. Drawing Register).
-- Extends the starter `drawing_register` table with the structured drawing-code
-- parts, phase/discipline grouping, multi-revision submission tracking, and
-- approval/progress fields. Idempotent — safe to re-run.
-- ============================================================================

-- Structured drawing-code parts (from the workbook "Coding Reference" sheet):
--   <proj_code>-<building_ref>-<company>-<drawing_type>-<discipline>-<floor_level>-<dwg_number>-<revision>
alter table drawing_register add column if not exists proj_code    text;   -- e.g. GPR101 / NPL
alter table drawing_register add column if not exists building_ref  text;  -- TW1..TW9 / GEN
alter table drawing_register add column if not exists company       text;  -- MCC (Megawide) / subcon acronym
alter table drawing_register add column if not exists drawing_type  text;  -- ECD/SD1/SD2/FCD/CSD/ISD/DRC
alter table drawing_register add column if not exists floor_level   text;  -- GEN/FD/GF/2F.. / RDF / RORD
alter table drawing_register add column if not exists dwg_number    text;  -- the numeric sheet no (e.g. 4750, A-101)
alter table drawing_register add column if not exists drawing_code  text;  -- full composed code (also = drawing_no)

-- Grouping / classification
alter table drawing_register add column if not exists phase        text;   -- Concept Design / Schematic Design 1 / 2 / For Construction ...
alter table drawing_register add column if not exists category     text;   -- Floor Plan / Elevation / Section ...
alter table drawing_register add column if not exists description  text;   -- long description of the sheet
alter table drawing_register add column if not exists responsible  text;   -- consultant / party (e.g. ECTA, RBS, In-House)

-- Progress
alter table drawing_register add column if not exists no_of_sheets    integer default 1;
alter table drawing_register add column if not exists approved_sheets  integer default 0;
alter table drawing_register add column if not exists approved_pct     numeric;   -- 0..1 (approved_sheets / no_of_sheets)

-- Submission tracking across revisions 0..N:
--   [{ "rev": 0, "planned": "2025-04-28", "actual": "2025-05-05" }, ...]
alter table drawing_register add column if not exists submissions jsonb default '[]'::jsonb;

-- Approval tracking
alter table drawing_register add column if not exists planned_approval date;
alter table drawing_register add column if not exists actual_approval  date;

-- Ordering (preserves import / hierarchy order)
alter table drawing_register add column if not exists sort_order integer default 0;

-- `status` values now allowed (workbook approval outcomes), kept as free text so
-- existing rows aren't broken:
--   For Review | Revise & Resubmit | Approved w/ comments | Approved w/o comments
--   | Approved | Superseded

create index if not exists drawing_register_project_sort_idx
  on drawing_register (project_id, sort_order);
