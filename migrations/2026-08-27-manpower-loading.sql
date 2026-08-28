-- ============================================================================
-- Manpower Loading (per project) — 2026-08-27
--
-- The HRD "Manpower Report" sheet, as tables. Four objects, and the split is
-- the design:
--
--   manpower_positions  one row per POSITION LINE on the project (the requirement)
--   manpower_loading    one row per (position, month) carrying FOUR headcount series
--   manpower_roster     one row per PERSON — the employee masterlist behind the numbers
--   manpower_months     one row per (project, month): the project phase + the four COSTS
--
-- ⚠️ FOUR quantity columns on one row, not four rows with a `series` column.
-- The sheet's own bands are Planned / Revised / Proposed / Actual for the SAME
-- (position, month), every reader wants all four together, and the unique index
-- that stops two browsers double-inserting a month has to be on (position,
-- month) — with a series column that index no longer prevents the thing it
-- exists to prevent, it just moves the duplicate one column over.
--
-- ⚠️ Monthly quantities are their own table, not a jsonb blob on the position —
-- the same call equipment_loading and productivity_entries made. A blob cannot
-- be summed per month by the database, filtered, or edited by two people
-- without one clobbering the other's month.
--
-- ⚠️ COSTS ARE PROJECT-MONTH, NOT PER POSITION. The reference sheet types them
-- that way because they come off payroll, which is issued for the project as a
-- whole and never equals rate × headcount (it carries overtime, allowances,
-- separation pay). Storing a per-position cost would force the module to invent
-- a split nobody has. The module still DERIVES rate × headcount when a month
-- has no typed cost, and says on screen which of the two it is showing.
--
-- ⚠️ `manpower_months` carries a surrogate `id` even though (project_id, period)
-- is the natural key: PDb.selectAll paginates by `id`, so a table without one
-- silently reads at most 1000 rows and reports the rest as absent.
--
-- ⚠️ Columns are `position_title` and `job_rank`, not `position` and `rank`.
-- Both bare names are Postgres keywords (POSITION is a col_name_keyword, rank()
-- a window function); they are legal as column names today and are exactly the
-- kind of thing that starts needing quotes inside a view or a function later.
--
-- RLS is project-scoped from the start (the 2026-07-21 pattern). Writes are
-- is_writer() rather than created_by-or-admin: a manpower report is maintained
-- by the project team and HRD together, and "only whoever typed it may fix it"
-- is how a register goes stale.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists manpower_positions (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  code text,                              -- unique per project, case-insensitively
  workforce text not null default 'Staff',-- Staff | Skilled
  department text not null default 'OFFICE',
  position_title text not null,
  job_rank text,                          -- Managerial | Supervisory | Rank & File | Skilled | Helper
  monthly_rate numeric,                   -- cost per head per month, for the derived cost curve
  remarks text,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists manpower_loading (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  position_id uuid not null references manpower_positions(id) on delete cascade,
  period date not null,                   -- first day of the month
  planned_qty numeric,                    -- B0, the original plan
  approved_qty numeric,                   -- B1, the latest APPROVED revision
  forecast_qty numeric,                   -- proposed / for approval
  actual_qty numeric,                     -- what was actually deployed
  remarks text,
  source text,                            -- 'hand' | 'schedule' — who wrote the month
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists manpower_roster (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  position_id uuid references manpower_positions(id) on delete set null,
  employee_name text not null,            -- 'TBH' is a real, meaningful value: an unfilled slot
  employee_status text,                   -- Full-time | Part-time | Project-based
  job_rank text,
  allocation text,                        -- FULL-TIME | SHARED
  date_hired date,
  contract_start date,
  contract_end date,                      -- drives the demobilisation summary
  remarks text,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists manpower_months (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  period date not null,
  phase text,                             -- Earthworks | Structural | Architectural | MEPF | …
  planned_cost numeric,
  approved_cost numeric,
  forecast_cost numeric,
  actual_cost numeric,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- One row per position per month. Without this two browsers can each insert the
-- same month and every total silently double-counts it.
create unique index if not exists manpower_loading_uni
  on manpower_loading(position_id, period);
create unique index if not exists manpower_months_uni
  on manpower_months(project_id, period);
create index if not exists manpower_loading_project_idx
  on manpower_loading(project_id, period);
create index if not exists manpower_positions_project_idx
  on manpower_positions(project_id, sort_order);
create index if not exists manpower_roster_project_idx
  on manpower_roster(project_id, position_id);

-- ⚠️ Unique per PROJECT, not globally, and case-insensitively. Two projects
-- legitimately both number their first field engineer FE-01, and a global
-- constraint would refuse the second with an error nobody could act on.
create unique index if not exists manpower_positions_code_uni
  on manpower_positions(project_id, lower(code)) where code is not null and code <> '';

grant select, insert, update, delete
  on manpower_positions, manpower_loading, manpower_roster, manpower_months
  to authenticated;

alter table manpower_positions enable row level security;
alter table manpower_loading   enable row level security;
alter table manpower_roster    enable row level security;
alter table manpower_months    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['manpower_positions','manpower_loading','manpower_roster','manpower_months'] loop
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_write', t);
    execute format('create policy %I on %I for all using (is_writer() and can_access_project(project_id)) with check (is_writer() and can_access_project(project_id))', t||'_write', t);
  end loop;
end $$;

-- Keep updated_at honest: the register reports "last updated" per position, and
-- an updated_at that only records the INSERT reports a row edited this morning
-- as untouched.
create or replace function public.manpower_touch() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['manpower_positions','manpower_loading','manpower_roster','manpower_months'] loop
    execute format('drop trigger if exists %I on %I', t||'_touch', t);
    execute format('create trigger %I before update on %I for each row execute function public.manpower_touch()', t||'_touch', t);
  end loop;
end $$;
