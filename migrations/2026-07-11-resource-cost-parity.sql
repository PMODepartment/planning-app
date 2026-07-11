-- ============================================================================
-- Migration: Resource / cost-side OPC parity (2026-07-11)
-- One migration covering the four approved gaps:
--   (3a) cost_accounts        — project cost-breakdown structure (CBS tree)
--   (3b) price_per_unit        — rate on resources + roles; cost fields on
--        resource_assignments  assignments so cost = units × rate (or manual)
--   (3c) activity_expenses     — itemized non-labor costs per activity
--   + project_schedule.cost_rollup — opt-in flag: when true, an activity's
--        planned/actual/earned cost is DERIVED from its assignments + expenses;
--        default false keeps today's manual direct-entry behaviour unchanged.
-- Run in the Supabase SQL editor. Idempotent. RLS: read=is_approved, write=is_planner.
-- ============================================================================

-- (3a) Cost Accounts / CBS -----------------------------------------------------
create table if not exists cost_accounts (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  parent_id uuid references cost_accounts(id) on delete set null,  -- CBS tree
  code text,                       -- e.g. "01-100"
  name text not null,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists cost_accounts_project_idx on cost_accounts(project_id);
alter table cost_accounts enable row level security;
drop policy if exists cost_accounts_read on cost_accounts;
create policy cost_accounts_read on cost_accounts for select using (is_approved());
drop policy if exists cost_accounts_write on cost_accounts;
create policy cost_accounts_write on cost_accounts for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on cost_accounts to authenticated;

-- (3b) Rates + cost on assignments --------------------------------------------
alter table resources       add column if not exists price_per_unit numeric(14,2);
alter table resource_roles  add column if not exists price_per_unit numeric(14,2);

alter table resource_assignments add column if not exists budgeted_cost  numeric(16,2);
alter table resource_assignments add column if not exists actual_cost    numeric(16,2);
alter table resource_assignments add column if not exists remaining_cost numeric(16,2);
alter table resource_assignments add column if not exists cost_account_id uuid references cost_accounts(id) on delete set null;
-- 'derived' = cost computed as units × price_per_unit; 'manual' = typed directly.
alter table resource_assignments add column if not exists rate_source text default 'derived';

-- (3c) Itemized expenses (non-labor) ------------------------------------------
create table if not exists activity_expenses (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  activity_id text,                -- matches project_schedule.activity_id (by code)
  name text not null,
  cost_account_id uuid references cost_accounts(id) on delete set null,
  planned_cost numeric(16,2),
  actual_cost  numeric(16,2),
  remarks text,
  created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists activity_expenses_project_activity_idx on activity_expenses(project_id, activity_id);
alter table activity_expenses enable row level security;
drop policy if exists activity_expenses_read on activity_expenses;
create policy activity_expenses_read on activity_expenses for select using (is_approved());
drop policy if exists activity_expenses_write on activity_expenses;
create policy activity_expenses_write on activity_expenses for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on activity_expenses to authenticated;

-- Opt-in bottom-up cost roll-up flag (default false = current manual behaviour) -
alter table project_schedule add column if not exists cost_rollup boolean default false;
