-- Milestone-based progress billing --------------------------------------------
-- Some contracts bill fixed lump-sum amounts on reaching project milestones
-- (e.g. "Structural Foundation ₱33M", "Structural 3rd Floor ₱43M") rather than on
-- % POC. billing_basis switches the contract-level cash-in between the two; the
-- milestones themselves live in cash_flow_billing_milestones.

alter table cash_flow_settings
  add column if not exists billing_basis text default 'poc';   -- 'poc' (S-curve) | 'milestone'

create table if not exists cash_flow_billing_milestones (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id) on delete cascade,
  seq            integer default 0,
  description    text,                                 -- e.g. "Structural Foundation"
  basis          text default 'amount' check (basis in ('amount','percent')),
  amount         numeric(18,2),                        -- fixed ₱ when basis='amount'
  percent        numeric(6,5),                         -- of contract IBB when basis='percent'
  trigger_mode   text default 'milestone'
                   check (trigger_mode in ('milestone','month','offset')),
  milestone      text,                                 -- schedule milestone name when 'milestone'
  trigger_month  date,                                 -- when 'month'
  trigger_offset integer default 0,                    -- months from start when 'offset'
  remarks        text,
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_cf_bill_ms_proj on cash_flow_billing_milestones(project_id);
grant select, insert, update, delete on cash_flow_billing_milestones to authenticated, service_role;
alter table cash_flow_billing_milestones enable row level security;
drop policy if exists cash_flow_billing_milestones_read on cash_flow_billing_milestones;
create policy cash_flow_billing_milestones_read on cash_flow_billing_milestones for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_billing_milestones_write on cash_flow_billing_milestones;
create policy cash_flow_billing_milestones_write on cash_flow_billing_milestones for all
  using (is_approved() and can_access_project(project_id))
  with check (is_approved() and can_access_project(project_id));
