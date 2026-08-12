-- ============================================================================
-- Migration: RLS project-scope fix for the schedule / cost support tables
--
-- AUDIT FINDING (2026-07-21). A cluster of PROJECT-SCOPED tables created by the
-- 2026-07-07 schedule batch + the 2026-07-11 resource-cost-parity migration were
-- given policies that ignore the project boundary:
--     read  : using (is_approved())          -- any approved user, ANY project
--     write : for all using (is_planner())   -- any planner, ANY project
-- Neither gate calls can_access_project(project_id), so every approved user could
-- READ every project's schedule/WBS and — worse — its COST data (activity_expenses,
-- schedule_baselines, cost_accounts), and any planner could WRITE across projects.
-- This contradicts the app's per-project access model; the cash_flow_* tables were
-- already scoped correctly, this brings the rest in line.
--
-- FIX: read  = can_access_project(project_id)   -- helper already allows admins +
--                                                  requires status='approved'
--      write = is_planner() and can_access_project(project_id)
-- schedule_audit keeps its INSERT-ONLY write (it is an immutable change log).
--
-- Idempotent + existence-guarded (skips any table whose own migration wasn't run).
-- Run in the Supabase SQL editor.
-- ============================================================================
do $$
declare t text;
begin
  -- Read + full (planner) write, both project-scoped.
  foreach t in array array[
    'schedule_baselines','cost_accounts','activity_expenses','wbs_nodes',
    'activity_code_types','activity_code_values','activity_steps','activity_udf_defs',
    'schedule_scenarios','schedule_snapshots','schedule_thresholds','weekly_commitments'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;   -- migration not run → skip
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all using (is_planner() and can_access_project(project_id)) with check (is_planner() and can_access_project(project_id))', t || '_write', t);
  end loop;

  -- schedule_audit: project-scoped read, INSERT-ONLY write (immutable log).
  if to_regclass('public.schedule_audit') is not null then
    execute 'alter table schedule_audit enable row level security';
    execute 'drop policy if exists schedule_audit_read on schedule_audit';
    execute 'create policy schedule_audit_read on schedule_audit for select using (can_access_project(project_id))';
    execute 'drop policy if exists schedule_audit_write on schedule_audit';
    execute 'create policy schedule_audit_write on schedule_audit for insert with check (is_planner() and can_access_project(project_id))';
  end if;
end $$;
