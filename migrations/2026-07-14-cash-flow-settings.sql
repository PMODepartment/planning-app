-- Cash Flow — projection settings (one row per project) ----------------------
-- The Cash Flow module is a DERIVED projection: cash-in timing comes from the
-- project_schedule S-curve, cash-out comes from the WPM (procurement) work
-- packages. This table only stores the contract/terms ASSUMPTIONS that aren't
-- derivable from either source (contract value, DP%, retention%, payment terms,
-- and the mapping to the WPM project id, since project ids differ across apps).

create table if not exists cash_flow_settings (
  id                        uuid primary key default gen_random_uuid(),
  project_id                text references projects(id) on delete cascade unique,
  contract_ibb              numeric(18,2),          -- contract amount IBB (VAT inc) — cash-in base
  contract_bcb              numeric(18,2),          -- contract amount BCB (cost base, reference)
  dp_percent                numeric(6,5) default 0, -- client downpayment % (0..1)
  retention_percent         numeric(6,5) default 0.10, -- retention withheld from each billing (0..1)
  dp_recoup_percent         numeric(6,5),           -- % recouped from each billing (null → = dp_percent)
  billing_terms_months      integer default 1,      -- lag: certified billing → cash received (client side)
  retention_release_months  integer default 1,      -- lag after completion for retention release
  start_period              date,                   -- cashflow month 0 (null → schedule start)
  wpm_project_id            text,                   -- maps to the WPM app's projects.id (cash-out scope)
  remarks                   text,
  created_by                uuid references users(id),
  created_at                timestamptz default now(),
  updated_at                timestamptz default now()
);

-- Grants (PostgREST runs as authenticated/anon) + per-project RLS.
grant select, insert, update, delete on cash_flow_settings to authenticated;

alter table cash_flow_settings enable row level security;

drop policy if exists cash_flow_settings_read on cash_flow_settings;
create policy cash_flow_settings_read on cash_flow_settings
  for select using (is_approved() and can_access_project(project_id));

drop policy if exists cash_flow_settings_write on cash_flow_settings;
create policy cash_flow_settings_write on cash_flow_settings
  for all using (is_approved() and can_access_project(project_id))
  with check (is_approved() and can_access_project(project_id));
