-- ============================================================================
-- Migration: make the 'viewer' role truly read-only (audit finding #7, 2026-07-21)
--
-- Module-table write policies gated on is_approved(), which is true for EVERY
-- approved user including 'viewer' — so a viewer (documented as read-only) could
-- insert/update/delete their own rows in any accessible project. This adds an
-- is_writer() helper (approved AND role <> 'viewer') and re-applies the module
-- tables' insert/update/delete policies to use it. Reads are unchanged.
--
-- Covers: the module tables (loop below), calendars, AND the cash_flow_* assumption/
-- derived tables (bottom block) — so a viewer can read every accessible project but
-- WRITE NOTHING anywhere. (The schedule/cost SUPPORT tables — cost_accounts,
-- activity_expenses, schedule_baselines/_snapshots/_audit, wbs_nodes, activity_code_*,
-- etc. — already write via is_planner(), which also excludes viewers.)
--
-- Idempotent + existence-guarded. Run in the Supabase SQL editor.
-- ============================================================================
create or replace function is_writer() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.status = 'approved' and u.role <> 'viewer');
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'progress_photos','ppr_presentations','ppr_slides',
    'issues_lessons','contracts_claims','risk_register',
    'stakeholder_map','drawing_register','material_submittal',
    'project_schedule','resource_loading','productivity_rates','cash_flow','s_curve',
    'resource_roles','resources','resource_assignments',
    'productivity_activities','productivity_entries'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;   -- table not present → skip
    execute format('drop policy if exists %I on %I', t || '_ins', t);
    execute format('create policy %I on %I for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id))', t || '_ins', t);
    execute format('drop policy if exists %I on %I', t || '_upd', t);
    execute format('create policy %I on %I for update using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin())) with check (is_writer() and can_access_project(project_id))', t || '_upd', t);
    execute format('drop policy if exists %I on %I', t || '_del', t);
    execute format('create policy %I on %I for delete using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()))', t || '_del', t);
  end loop;

  -- calendars uses named per-command policies (not the loop's <table>_ins/_upd/_del names).
  if to_regclass('public.calendars') is not null then
    drop policy if exists calendars_ins on calendars;
    create policy calendars_ins on calendars for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id));
    drop policy if exists calendars_upd on calendars;
    create policy calendars_upd on calendars for update using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin())) with check (is_writer() and can_access_project(project_id));
    drop policy if exists calendars_del on calendars;
    create policy calendars_del on calendars for delete using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
  end if;
end $$;

-- cash_flow_* assumption/derived tables: writes were is_approved() (a project-assigned viewer
-- could edit cash-flow assumptions / the rollup cache). Re-create their WRITE policies with
-- is_writer() so viewers write nothing anywhere. Reads (cash_flow_*_read) stay is_approved so
-- viewers can still view cash flow. Policy names are non-uniform, so map them explicitly.
do $$
declare
  pol text[] := array['cash_flow_settings_write','cash_flow_billing_milestones_write','cash_flow_dp_tranches_write','cash_flow_actuals_write','cash_flow_rollup_write','cash_flow_trade_write','cash_flow_scen_write'];
  tbl text[] := array['cash_flow_settings','cash_flow_billing_milestones','cash_flow_dp_tranches','cash_flow_actuals','cash_flow_rollup','cash_flow_trade_packages','cash_flow_scenarios'];
  i int;
begin
  for i in 1 .. array_length(pol, 1) loop
    if to_regclass('public.' || tbl[i]) is null then continue; end if;
    execute format('drop policy if exists %I on %I', pol[i], tbl[i]);
    execute format('create policy %I on %I for all using (is_writer() and can_access_project(project_id)) with check (is_writer() and can_access_project(project_id))', pol[i], tbl[i]);
  end loop;
end $$;
