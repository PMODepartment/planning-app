-- ============================================================================
-- Migration: schedule_scurve_status(text[]) — per-project planned-vs-actual,
--            as of today, in ONE pass.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (create or replace).
--
-- WHY THIS AND NOT AN EXTENSION OF schedule_scurve_agg_multi:
--   That function builds a MONTHLY series, which costs a cross join of every
--   month in the window against every leaf activity. Across this portfolio that
--   is ~60 months x 149,233 activities, and it is already the heaviest statement
--   the dashboard issues. The Portfolio Overview's ranked table does not need
--   curves — it needs two numbers per project, "where should we be" and "where
--   are we". Those are one aggregate with a date predicate and NO month series,
--   so this adds a cheap query rather than doubling an expensive one.
--   ⚠️ schedule_scurve_agg_multi is therefore NOT TOUCHED, and its three
--      existing callers cannot regress.
--
-- ⚠️ security invoker, like every function in 2026-07-20-schedule-scurve-agg.sql
--    — the caller's own RLS applies, so a planner can only ever aggregate
--    projects they can already see. Never `definer`: that would turn a reporting
--    helper into a way to read another department's schedule.
-- ============================================================================

create or replace function schedule_scurve_status(p_ids text[])
returns table (
  project_id   text,
  tot_dur      numeric,   -- total duration weight
  planned_dur  numeric,   -- how much of it SHOULD be complete, as of today
  done_dur     numeric,   -- how much of it IS complete (recorded % x weight)
  n_act        bigint,    -- leaves counted
  min_date     date,
  max_date     date
)
language sql
stable
security invoker
as $$
  with leaves as (
    select
      ps.project_id,
      -- ⚠️ THE SAME WEIGHT AND THE SAME LEAF RULE as schedule_scurve_agg_multi,
      --    character for character. Two functions describing one portfolio must
      --    not disagree about what counts or what it weighs — that is how a
      --    ranked table ends up contradicting the curve above it.
      coalesce(nullif(ps.duration_days, 0), (ps.end_date - ps.start_date) + 1, 1)::numeric as w_dur,
      ps.start_date::date                                                                  as s,
      coalesce(ps.end_date, ps.start_date)::date                                           as e,
      greatest(0, least(100, coalesce(ps.percent_complete, 0)))::numeric / 100.0            as pc
    from project_schedule ps
    where ps.project_id = any(p_ids)
      and ps.start_date is not null
      and coalesce(ps.activity_type, '') !~* 'wbs|summary'
  )
  select
    l.project_id,
    sum(l.w_dur)                                        as tot_dur,
    /* Planned completion as of TODAY: finished before today counts whole, not
       started counts nothing, in progress counts its elapsed fraction.
       ⚠️ `e > s` guards the zero-length activity (a milestone), which is either
          wholly due or wholly not — never divided by zero. */
    sum(l.w_dur * (case
                     when current_date >= l.e then 1
                     when current_date <  l.s then 0
                     when l.e > l.s then (current_date - l.s)::numeric / (l.e - l.s)
                     else 1
                   end))                                as planned_dur,
    sum(l.w_dur * l.pc)                                 as done_dur,
    count(*)                                            as n_act,
    min(l.s)                                            as min_date,
    max(l.e)                                            as max_date
  from leaves l
  group by l.project_id;
$$;

grant execute on function schedule_scurve_status(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only). Should return one row per project that has dated leaves.
--   behind_pp is negative when a project is behind plan.
-- ---------------------------------------------------------------------------
-- select project_id, n_act,
--        round(100 * done_dur    / nullif(tot_dur, 0), 1) as actual_pct,
--        round(100 * planned_dur / nullif(tot_dur, 0), 1) as planned_pct,
--        round(100 * (done_dur - planned_dur) / nullif(tot_dur, 0), 1) as behind_pp
--   from schedule_scurve_status(array(select id from projects))
--  order by behind_pp asc;
