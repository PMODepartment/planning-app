-- Cash Flow v3: (#5) financing cost, (#8) funding limit, (#6) scenario snapshots,
-- (#7) per-trade cash-in packages. Data date is stored client-side (localStorage),
-- shared with the Project Schedule module's `ps_datadate_<pid>` key — no column.

-- (#5) financing cost rate + (#8) funding (credit-line) limit — on the settings row.
alter table cash_flow_settings add column if not exists finance_rate  numeric(7,5) default 0;   -- ANNUAL interest applied to negative cumulative (drawdowns)
alter table cash_flow_settings add column if not exists funding_limit numeric(18,2);            -- credit-line ceiling; cumulative net below -limit = breach (null = none)

-- Cash-in S-curve weighting basis: 'duration' (time-weighted) or 'cost' (per-activity
-- planned_cost/Planned IBB). Cost mode auto-falls-back to duration when the schedule has
-- no cost loaded. Makes the projection track whichever S-curve the schedule supports.
alter table cash_flow_settings add column if not exists scurve_basis text default 'duration';

-- (#7) Per-trade cash-in packages — split the contract into trades (ST / AR / MEPF …),
-- each with its own share of the contract and its own DP / retention / billing terms.
-- When any package exists it REPLACES the single contract-level cash-in (the packages
-- should sum to the contract IBB; the module surfaces the reconciliation). All packages
-- share the schedule S-curve shape (we have one project schedule); per-trade curves can
-- be added later if per-trade schedules are ever loaded.
create table if not exists cash_flow_trade_packages (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id) on delete cascade,
  seq            integer default 0,
  name           text,                                 -- trade / package label (ST, AR, MEPF, …)
  basis          text not null default 'percent' check (basis in ('percent','amount')),
  percent        numeric(9,6),                         -- share of contract IBB (when basis = percent)
  amount         numeric(18,2),                         -- fixed ₱ (when basis = amount)
  dp_percent        numeric(9,6) default 0,             -- this trade's downpayment %
  retention_percent numeric(9,6) default 0,             -- this trade's retention %
  billing_terms_months integer default 0,               -- this trade's billing lag (blank/0 → settings default)
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_cf_trade_proj on cash_flow_trade_packages(project_id);
grant select, insert, update, delete on cash_flow_trade_packages to authenticated, service_role;
alter table cash_flow_trade_packages enable row level security;
drop policy if exists cash_flow_trade_read on cash_flow_trade_packages;
create policy cash_flow_trade_read on cash_flow_trade_packages for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_trade_write on cash_flow_trade_packages;
create policy cash_flow_trade_write on cash_flow_trade_packages for all
  using (is_approved() and can_access_project(project_id))
  with check (is_approved() and can_access_project(project_id));

-- (#6) Scenario snapshots — save a projection version (its computed monthly series +
-- headline totals) to compare a later revision against, mirroring the Excel "rev1".
create table if not exists cash_flow_scenarios (
  id           uuid primary key default gen_random_uuid(),
  project_id   text references projects(id) on delete cascade,
  name         text not null,                          -- e.g. "Baseline", "Rev 1"
  is_baseline  boolean default false,                  -- the version deltas are measured against
  snapshot     jsonb not null,                         -- { totalIn, totalOut, closing, peak, finance, months:[…], netCum:[…] }
  created_by   uuid references users(id),
  created_at   timestamptz default now()
);
create index if not exists idx_cf_scen_proj on cash_flow_scenarios(project_id);
grant select, insert, update, delete on cash_flow_scenarios to authenticated, service_role;
alter table cash_flow_scenarios enable row level security;
drop policy if exists cash_flow_scen_read on cash_flow_scenarios;
create policy cash_flow_scen_read on cash_flow_scenarios for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_scen_write on cash_flow_scenarios;
create policy cash_flow_scen_write on cash_flow_scenarios for all
  using (is_approved() and can_access_project(project_id))
  with check (is_approved() and can_access_project(project_id));
