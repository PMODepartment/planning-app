-- Cash Flow — downpayment tranches ------------------------------------------
-- The client downpayment is rarely a single lump sum: per the commercial
-- agreement it can be split into multiple tranches, each tagged by trade /
-- category, timed differently (a fixed month, an offset from NTP, or a schedule
-- milestone), and recouped proportionally against billings. One row per tranche.

create table if not exists cash_flow_dp_tranches (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id) on delete cascade,
  seq             integer default 0,            -- display / apply order
  label           text,                         -- e.g. "DP Tranche 1"
  category        text,                          -- trade / commercial tag (ST, AR, MEPF, …)
  basis           text default 'percent'
                    check (basis in ('percent','amount')),
  percent         numeric(6,5),                 -- of contract IBB (0..1) when basis='percent'
  amount          numeric(18,2),                -- fixed ₱ when basis='amount'
  timing_mode     text default 'offset'
                    check (timing_mode in ('month','offset','milestone')),
  timing_month    date,                          -- when timing_mode='month'
  timing_offset   integer default 0,             -- months from project start when 'offset'
  milestone       text,                          -- schedule milestone name when 'milestone'
  recoup_percent  numeric(6,5),                 -- per-billing claw-back rate (null → = tranche % of contract)
  remarks         text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_cf_dp_tranches_proj on cash_flow_dp_tranches(project_id);

grant select, insert, update, delete on cash_flow_dp_tranches to authenticated, service_role;

alter table cash_flow_dp_tranches enable row level security;

drop policy if exists cash_flow_dp_tranches_read on cash_flow_dp_tranches;
create policy cash_flow_dp_tranches_read on cash_flow_dp_tranches
  for select using (is_approved() and can_access_project(project_id));

drop policy if exists cash_flow_dp_tranches_write on cash_flow_dp_tranches;
create policy cash_flow_dp_tranches_write on cash_flow_dp_tranches
  for all using (is_approved() and can_access_project(project_id))
  with check (is_approved() and can_access_project(project_id));
