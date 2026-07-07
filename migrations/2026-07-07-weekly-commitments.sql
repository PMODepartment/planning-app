-- ============================================================================
-- Migration: Last Planner System weekly work plan + Percent Plan Complete (PPC).
-- Each row is one weekly commitment (a specific piece of work promised for a
-- given week), optionally linked to a project_schedule activity. At week's
-- end each commitment is marked Complete or Not Complete (with a reason code
-- if not) — PPC = Complete ÷ (Complete + Not Complete) for the week.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists weekly_commitments (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  week_start date not null,          -- Monday of the committed week
  activity_id text,                  -- optional link to project_schedule.activity_id
  description text not null,
  responsible text,
  status text default 'Open',        -- Open | Complete | Not Complete
  reason_code text,                  -- set when status = 'Not Complete'
  reason_notes text,
  created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create index if not exists weekly_commitments_project_week_idx on weekly_commitments(project_id, week_start);

alter table weekly_commitments enable row level security;
drop policy if exists weekly_commitments_read on weekly_commitments;
create policy weekly_commitments_read on weekly_commitments for select using (is_approved());
drop policy if exists weekly_commitments_write on weekly_commitments;
create policy weekly_commitments_write on weekly_commitments for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on weekly_commitments to authenticated;
