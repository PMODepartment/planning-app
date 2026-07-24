-- ============================================================================
-- Migration: Contracts & Claims Register — full fidelity against the Power Apps
-- "Contracts & Claims Register" app (Overview / Claims and Change Orders /
-- Extension of Time screens).
--
-- The starter table had a single `amount`, which only fits a Contract row. Both
-- the Claims/CO and the EOT screens are a FOUR-STAGE PIPELINE:
--     Estimated -> Submitted -> Evaluated -> Client Approved
-- identical in shape, differing only in unit: Claims/CO are money, EOT is DAYS.
--
-- Money and days are kept as SEPARATE column sets rather than one generic
-- value + unit discriminator: they are never mixed in a view, the roll-up totals
-- are per-screen, and separate columns make it impossible to accidentally sum
-- pesos and calendar days together.
--
-- record_type discriminates the three parts of the module:
--     'Contract' | 'Claim' | 'Change Order' | 'EOT'
-- ('Claim' and 'Change Order' share the Claims/CO screen; the app's
--  "Select Claim/CO" filter switches between them.)
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

-- ---- Claims / Change Order: the money pipeline -----------------------------
alter table contracts_claims add column if not exists est_amount      numeric(18,2);
alter table contracts_claims add column if not exists sub_amount      numeric(18,2);
alter table contracts_claims add column if not exists eval_amount     numeric(18,2);
alter table contracts_claims add column if not exists approved_amount numeric(18,2);

-- ---- Extension of Time: the same pipeline in DAYS --------------------------
alter table contracts_claims add column if not exists est_days      integer;
alter table contracts_claims add column if not exists sub_days      integer;
alter table contracts_claims add column if not exists eval_days     integer;
alter table contracts_claims add column if not exists approved_days integer;

-- ---- Pipeline dates --------------------------------------------------------
-- date_submitted drives AGING: the app shows an aging figure only while a record
-- is Pending (days since it was submitted to the client). Aging is DERIVED at
-- render time, never stored, so it can't go stale.
alter table contracts_claims add column if not exists date_submitted date;
alter table contracts_claims add column if not exists date_evaluated date;
alter table contracts_claims add column if not exists date_approved  date;

-- ---- Ordering --------------------------------------------------------------
alter table contracts_claims add column if not exists sort_order integer default 0;

create index if not exists contracts_claims_project_idx on contracts_claims(project_id);
create index if not exists contracts_claims_type_idx    on contracts_claims(project_id, record_type);
create index if not exists contracts_claims_status_idx  on contracts_claims(project_id, status);

comment on column contracts_claims.record_type is
  'Contract | Claim | Change Order | EOT — selects which screen the row belongs to.';
comment on column contracts_claims.status is
  'Pending | Approved | Disapproved | Cancelled';
comment on column contracts_claims.amount is
  'Contract amount. Only meaningful for record_type = ''Contract''; Claims/CO use the *_amount pipeline and EOT the *_days pipeline.';
comment on column contracts_claims.date_submitted is
  'Date submitted to the client — drives the derived Aging shown while Pending.';

-- RLS + grants already exist for this table (Phase-1 module table, see
-- supabase-schema.sql). Adding columns does not change either.
