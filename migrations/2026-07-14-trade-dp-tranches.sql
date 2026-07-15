-- Per-trade DP tranches -------------------------------------------------------
-- A cash-in trade package can break its downpayment into tranches (each with its
-- own %/amount, timing, and recoup rate), same shape as the contract-level DP
-- tranches. Stored as JSON on the trade row (trades are saved delete+insert, so a
-- JSON column is more robust than an FK).

alter table cash_flow_trade_packages
  add column if not exists dp_tranches jsonb default '[]'::jsonb;
