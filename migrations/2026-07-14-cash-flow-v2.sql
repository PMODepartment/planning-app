-- Cash Flow v2: tax withholdings, staged retention, recorded actuals, roll-up ---

-- (1) Tax withholdings + (4) staged retention release — on the settings row.
alter table cash_flow_settings add column if not exists ewt_percent      numeric(6,5) default 0.02;  -- creditable withholding tax on billings
alter table cash_flow_settings add column if not exists vat_percent      numeric(6,5) default 0.12;  -- to derive the VAT-exclusive EWT base
alter table cash_flow_settings add column if not exists ret_rel1_pct     numeric(6,5) default 1;     -- fraction of retention released at stage 1 (1 = single release)
alter table cash_flow_settings add column if not exists ret_rel2_months  integer      default 12;    -- stage-2 (remainder) release: months after completion

-- (2) Recorded actuals ledger — real cash movements booked against the project.
create table if not exists cash_flow_actuals (
  id           uuid primary key default gen_random_uuid(),
  project_id   text references projects(id) on delete cascade,
  period       date not null,                       -- month the cash moved
  direction    text not null check (direction in ('in','out')),
  category     text,                                -- DP / Billing / Retention / Payment / …
  amount       numeric(18,2) not null,              -- positive magnitude
  description  text,
  remarks      text,
  created_by   uuid references users(id),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists idx_cf_actuals_proj on cash_flow_actuals(project_id);
grant select, insert, update, delete on cash_flow_actuals to authenticated, service_role;
alter table cash_flow_actuals enable row level security;
drop policy if exists cash_flow_actuals_read on cash_flow_actuals;
create policy cash_flow_actuals_read on cash_flow_actuals for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_actuals_write on cash_flow_actuals;
create policy cash_flow_actuals_write on cash_flow_actuals for all
  using (is_approved() and can_access_project(project_id))
  with check (is_approved() and can_access_project(project_id));

-- (3) Monthly roll-up per project — cheap source for the Portfolio consolidated view.
create table if not exists cash_flow_rollup (
  id           uuid primary key default gen_random_uuid(),
  project_id   text references projects(id) on delete cascade,
  period       date not null,
  cash_in      numeric(18,2) default 0,
  cash_out     numeric(18,2) default 0,   -- stored as a negative
  net          numeric(18,2) default 0,
  updated_at   timestamptz default now(),
  unique (project_id, period)
);
create index if not exists idx_cf_rollup_proj on cash_flow_rollup(project_id);
grant select, insert, update, delete on cash_flow_rollup to authenticated, service_role;
alter table cash_flow_rollup enable row level security;
drop policy if exists cash_flow_rollup_read on cash_flow_rollup;
create policy cash_flow_rollup_read on cash_flow_rollup for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_rollup_write on cash_flow_rollup;
create policy cash_flow_rollup_write on cash_flow_rollup for all
  using (is_approved() and can_access_project(project_id))
  with check (is_approved() and can_access_project(project_id));
