-- WPM work-packages MIRROR (cash-out source for the Cash Flow module) ---------
-- Procurement budgets live in a SEPARATE Supabase project (the WPM app). Its
-- anon key is public (client JS), so we do NOT read it from the browser. Instead
-- an Edge Function (supabase/functions/sync-wpm) uses the WPM service_role key
-- SERVER-SIDE to copy the columns the cashflow needs into this table. The module
-- then reads this mirror under normal RLS. Budgets are never exposed to anon.
--
-- Keyed by (wpm_project_id, wp_no). The Edge Function upserts on that key.

create table if not exists wpm_work_packages (
  id                    uuid primary key default gen_random_uuid(),
  wpm_project_id        text not null,          -- the WPM app's projects.id
  wp_no                 text not null,
  description           text,
  approved_budget_bcb   numeric(18,2),
  awarded_cost          numeric(18,2),
  total_awarded         numeric(18,2),
  dp_percent            numeric(6,5),
  retention_percent     numeric(6,5),
  payment_terms_days    integer,
  awarding_date         date,
  actual_awarding_date  date,
  target_delivery       date,
  target_installation   date,
  target_completion     date,
  source_id             uuid,                   -- the WPM work_packages.id (traceability)
  synced_at             timestamptz default now(),
  unique (wpm_project_id, wp_no)
);

create index if not exists idx_wpm_mirror_proj on wpm_work_packages(wpm_project_id);

-- Read for any approved user (the mirror isn't mapped to a Planners project id,
-- so we gate on approval only). WRITES happen exclusively via the Edge Function
-- using the service_role key, which bypasses RLS — no write policy is granted to
-- authenticated/anon, so the browser can never tamper with the mirror.
grant select on wpm_work_packages to authenticated;

alter table wpm_work_packages enable row level security;

drop policy if exists wpm_work_packages_read on wpm_work_packages;
create policy wpm_work_packages_read on wpm_work_packages
  for select using (is_approved());
