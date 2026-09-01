-- ============================================================================
-- Risk Register -> the real EPC Risk and Control Matrix (RCM)
-- Source: "SLN101. OPS. Risk Register. 2025 07 01.xlsx" (EPC Project Risk Register)
-- 2026-09-01
--
-- WHAT WAS MISSING. The starter table modelled a generic risk list: code, title,
-- category, L x I, response, owner. The register Megawide actually runs is an RCM
-- with SIX bands across the sheet, and five of them had nowhere to live:
--
--   RISK IDENTIFICATION | RISK APPETITE | RISK ASSESSMENT | RISK RESPONSE
--   | RESIDUAL RISK ASSESSMENT | AUDIT PLAN
--
-- The consequence was not cosmetic. Without the identification band a risk is
-- not attached to the 5-PMLC activity that owns it, so the register cannot be
-- read the way the sheet is read (by business process) and the process owner
-- has no column to be named in. Without the residual band there is no way to
-- record that a control WORKED — the register keeps showing inherent scores
-- forever, which is precisely the number a control is supposed to move.
--
-- ⚠️ ADD-ONLY. Every pre-existing column keeps its meaning, because the dashboard
-- tile (`config.js` -> risk-register.dash.metrics) counts `status` and plots
-- `impact` x `likelihood`, and a rename here silently zeroes that tile:
--   title      = Risk Event          (col H)
--   category   = Risk Category       (col F)   -- now the workbook's 10-term taxonomy
--   likelihood = Probability 1..5    (col N)
--   impact     = Impact 1..5         (col M)
--   rating     = IMPORTANCE          (col O)   = impact x probability
--   response   = Control Category    (col Q)   -- Treat/Transfer/Terminate/Tolerate
--   mitigation = Control Description (col R)
--   owner      = Risk Owner          (col I)
--
-- ⚠️ PRIORITY / LEVEL (col P) IS NOT STORED. It is a pure lookup of
-- (impact, probability) into the workbook's 5x5 heat map, so storing it would
-- only let it drift out of step with the two numbers it is made of — the same
-- rule `rating` already follows in this module. Derived in `module.js`
-- (PRIORITY_GRID). Same for the residual band's own priority.
--
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
-- ============================================================================

-- ---- RISK IDENTIFICATION (cols A-E) ----------------------------------------
-- The 5-PMLC activity the risk belongs to. `activity_no` is the sheet's own
-- Activity No. and is what the register groups and orders by; the three text
-- columns are the activity's header block, repeated on each of its risks so a
-- row is self-describing when it is filtered out of its group.
alter table risk_register add column if not exists activity_no          int;
alter table risk_register add column if not exists activity             text;
alter table risk_register add column if not exists sub_process          text;
alter table risk_register add column if not exists process_objectives   text;
alter table risk_register add column if not exists process_description  text;

-- Risk Sub-Category (col G) — the second level of the EPC Risk Universe
-- ("Commercial > IBB", "Operational > Safety"). Free text in the DB on purpose:
-- the taxonomy is a workbook sheet that grows, and a check constraint here would
-- reject a legitimate new sub-category until someone shipped a migration.
alter table risk_register add column if not exists sub_category         text;

alter table risk_register add column if not exists risk_champion        text;   -- col J
alter table risk_register add column if not exists risk_appetite        text;   -- col K

-- ---- RISK RESPONSE (cols Q-T) ----------------------------------------------
-- `control_type` is the Control Masterlist's L1 category (Framework/Policy,
-- Document Review and Approval, Management Review, Independent Review or Audit,
-- Physical Inspection, Quality Control, Control Self-Assessment). It is NOT the
-- same field as `response`, which the sheet confusingly also labels "Control
-- Category" while filling it with the four treatment terms.
alter table risk_register add column if not exists control_type         text;
alter table risk_register add column if not exists control_owner        text;   -- col S
alter table risk_register add column if not exists response_cost        numeric;-- col T (PHP)

-- ---- RESIDUAL RISK ASSESSMENT (cols U-Z) -----------------------------------
-- Scored 1..5 each; IMPORTANCE = product (1..125) and the band is
-- Low 1-27 / Moderate 28-64 / High 65-125 per "Table 3A - RISK RATING".
-- Derived in the app, not stored, for the reason in the header.
alter table risk_register add column if not exists res_impact           int;    -- severity after control
alter table risk_register add column if not exists res_possibility      int;    -- occurrence after control
alter table risk_register add column if not exists res_detectability    int;    -- degree of control (Table 1C)
alter table risk_register add column if not exists res_response_cost    numeric;

-- ---- AUDIT PLAN (cols AA-AD) ------------------------------------------------
alter table risk_register add column if not exists audit_procedures     text;
alter table risk_register add column if not exists required_documents   text;
alter table risk_register add column if not exists audit_contact        text;
alter table risk_register add column if not exists audit_timing         text;

-- ---- Housekeeping -----------------------------------------------------------
-- `sort_order` keeps hand-arranged order inside an activity. Without it the only
-- stable order is rating desc, which shuffles a register every time a score is
-- edited — the sheet's rows do not move when a number changes.
alter table risk_register add column if not exists sort_order           int default 0;
alter table risk_register add column if not exists identified_date      date;
alter table risk_register add column if not exists target_date          date;

-- Grouped reads are the module's default view, so the index matches them.
create index if not exists risk_register_activity_idx
  on risk_register (project_id, activity_no, sort_order);
