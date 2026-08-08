-- ============================================================================
-- Shared server-side monthly S-curve aggregate (generalizes cashflow_schedule_agg)
-- ----------------------------------------------------------------------------
-- Every consumer of the schedule (S-Curve, Cash Flow, Portfolio) needs the same
-- thing: per-month duration- AND cost-weighted cumulative PLANNED + ACTUAL
-- progress. Computing that in the browser means pulling every leaf activity
-- (16k–40k rows on large schedules) each load. These functions do the
-- per-activity × per-month spread on the server and return ONE compact JSON
-- (~1 row per month + totals + milestones), so the browser fetches dozens of
-- rows instead of tens of thousands.
--
--   schedule_scurve_agg_multi(text[])  — core; aggregates the given projects
--                                        into ONE combined curve (Portfolio).
--   schedule_scurve_agg(text)          — single project (S-Curve).
--   cashflow_schedule_agg(text)        — kept as a thin wrapper so Cash Flow
--                                        keeps working before/after redeploy.
--
-- security invoker → the caller's RLS (project_schedule read = can_access_project)
-- applies, so a user only ever aggregates projects they can already see.
-- Idempotent (create or replace). Run once in the Supabase SQL editor.
-- ============================================================================

create or replace function schedule_scurve_agg_multi(p_ids text[])
returns jsonb
language sql
stable
security invoker
as $$
  with leaves as (
    select
      coalesce(nullif(duration_days, 0), (end_date - start_date) + 1, 1)::numeric as w_dur,
      coalesce(planned_cost, bl_cost, 0)::numeric                                  as w_cost,
      start_date::date                                                             as s,
      coalesce(end_date, start_date)::date                                         as e,
      coalesce(actual_start, start_date)::date                                     as as_,
      coalesce(actual_finish, end_date, actual_start, start_date)::date            as ae_,
      greatest(0, least(100, coalesce(percent_complete, 0)))::numeric / 100.0      as pc,
      activity_name, activity_type, duration_days
    from project_schedule
    where project_id = any(p_ids)
      and start_date is not null
      and coalesce(activity_type, '') !~* 'wbs|summary'
  ),
  bounds as (select min(s) as mn, max(e) as mx from leaves),
  months as (
    select (generate_series(date_trunc('month', mn), date_trunc('month', mx), interval '1 month'))::date as m
    from bounds where mn is not null
  ),
  agg as (
    select
      to_char(mo.m, 'YYYY-MM') as key,
      sum(l.w_dur          * (case when d.me >= l.e   then 1 when d.me < l.s   then 0 when l.e   > l.s   then (d.me - l.s)::numeric  / (l.e   - l.s)   else 1 end)) as pd,
      sum(l.w_cost         * (case when d.me >= l.e   then 1 when d.me < l.s   then 0 when l.e   > l.s   then (d.me - l.s)::numeric  / (l.e   - l.s)   else 1 end)) as pc,
      sum(l.w_dur  * l.pc  * (case when d.me >= l.ae_ then 1 when d.me < l.as_ then 0 when l.ae_ > l.as_ then (d.me - l.as_)::numeric / (l.ae_ - l.as_) else 1 end)) as ad,
      sum(l.w_cost * l.pc  * (case when d.me >= l.ae_ then 1 when d.me < l.as_ then 0 when l.ae_ > l.as_ then (d.me - l.as_)::numeric / (l.ae_ - l.as_) else 1 end)) as ac
    from months mo
    cross join lateral (select (mo.m + interval '1 month - 1 day')::date as me) d
    cross join leaves l
    group by mo.m
    order by mo.m
  )
  select jsonb_build_object(
    'months',     coalesce((select jsonb_agg(jsonb_build_object('key', key, 'pd', pd, 'pc', pc, 'ad', ad, 'ac', ac) order by key) from agg), '[]'::jsonb),
    'totDur',     coalesce((select sum(w_dur)  from leaves), 0),
    'totCost',    coalesce((select sum(w_cost) from leaves), 0),
    'doneDur',    coalesce((select sum(w_dur  * pc) from leaves), 0),
    'doneCost',   coalesce((select sum(w_cost * pc) from leaves), 0),
    'nAct',       (select count(*) from leaves),
    'nCost',      (select count(*) from leaves where w_cost > 0),
    'minDate',    (select mn from bounds),
    'maxDate',    (select mx from bounds),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('name', activity_name, 'date', s) order by s)
                            from leaves where activity_name is not null
                              and (activity_type ~* 'milestone' or coalesce(duration_days, 0) = 0)), '[]'::jsonb)
  );
$$;

create or replace function schedule_scurve_agg(p_id text)
returns jsonb language sql stable security invoker
as $$ select schedule_scurve_agg_multi(array[p_id]); $$;

-- Back-compat: Cash Flow calls cashflow_schedule_agg — keep it as a wrapper.
create or replace function cashflow_schedule_agg(p_id text)
returns jsonb language sql stable security invoker
as $$ select schedule_scurve_agg(p_id); $$;

grant execute on function schedule_scurve_agg_multi(text[]) to authenticated;
grant execute on function schedule_scurve_agg(text)        to authenticated;
grant execute on function cashflow_schedule_agg(text)      to authenticated;

-- B1: composite index for the editor's keyset pagination
--   (where project_id = ? and id > ? order by id) — an indexed range scan per page.
create index if not exists project_schedule_proj_id_idx on project_schedule (project_id, id);
