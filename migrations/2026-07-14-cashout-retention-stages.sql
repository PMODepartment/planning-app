-- Separate cash-OUT retention release staging ---------------------------------
-- Subcontract retention terms can differ from the client's. These optional
-- columns let cash-out retention release on its own schedule; when null, the
-- engine falls back to the cash-in staging (ret_rel1_pct / retention_release_months
-- / ret_rel2_months) so existing projects are unchanged.

alter table cash_flow_settings add column if not exists co_ret_rel1_pct    numeric(6,5);  -- fraction released at stage 1 (null → = cash-in)
alter table cash_flow_settings add column if not exists co_ret_rel1_months integer;       -- stage-1 lag, months after WP completion
alter table cash_flow_settings add column if not exists co_ret_rel2_months integer;       -- stage-2 (remainder) lag
