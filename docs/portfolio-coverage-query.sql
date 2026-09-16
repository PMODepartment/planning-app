-- ============================================================================
-- Portfolio Dashboard — MEASUREMENT ONLY. Read-only. Writes nothing, creates
-- nothing, is not a migration.
--
-- ⚠️ Deliberately NOT in migrations/ — that folder is things you run to change
--    the database, and a file in there invites being run as one.
--
-- ⚠️⚠️ QUERY A IS ONE STATEMENT AND ANSWERS EVERYTHING. The first cut of this
--    file was SEVEN separate statements, and the Supabase SQL editor shows only
--    the result of the LAST one — so running it returned section 5 and nothing
--    else, every time, with sections 1–4 invisible. Whole thing folded into a
--    single result set: one run, one grid, every figure.
--
--    Queries B–D below are the per-project detail. They are separate on purpose
--    (one row per project, so they cannot share A's shape) — run them one at a
--    time, or highlight one and press Run.
-- ============================================================================


-- ============================================================================
-- QUERY A — everything, in one result set. Run this one.
-- ============================================================================
with p as (
  -- ⚠️ Reproduces the SHIPPED javascript exactly, so the answer is about the app
  --    rather than a tidier rule written in SQL:
  --      isOverdue = coalesce(forecast_finish, schedule_finish, end_date) < today
  --                  and (schedule_progress is null or schedule_progress < 100)
  --      isBehind  = (schedule_finish > forecast_finish)            <- TODAY (bare)
  --                  or isOverdue
  --      proposed  = (schedule_finish > coalesce(forecast_finish, end_date))
  --                  or isOverdue
  --    Only the first term differs; isOverdue is untouched by the change.
  select
    id, name, end_date, forecast_finish, schedule_finish, schedule_start,
    schedule_progress, schedule_activities, schedule_updated_at, original_budget,
    (coalesce(forecast_finish, schedule_finish, end_date) < current_date
      and (schedule_progress is null or schedule_progress < 100))        as is_overdue,
    (schedule_finish is not null and forecast_finish is not null
      and schedule_finish > forecast_finish)                             as slip_now,
    (schedule_finish is not null and coalesce(forecast_finish, end_date) is not null
      and schedule_finish > coalesce(forecast_finish, end_date))         as slip_proposed
  from projects
),
b as (
  -- ⚠️ Straight off `p`. A CTE may only reference one declared BEFORE it, so this
  --    cannot be chained through a later name.
  select *, (slip_now or is_overdue) as behind_now,
            (slip_proposed or is_overdue) as behind_proposed
  from p
),
act as (
  select count(*) as n_act,
         count(*) filter (where phase is not null)          as n_phase,
         count(distinct project_id)                         as n_proj,
         count(distinct project_id) filter (where phase is not null) as n_proj_phase,
         count(*) filter (where wbs_node_id is not null)    as n_linked
  from project_schedule
)
select * from (
  select 1 as ord, '1 · isBehind' as section, 'projects in the portfolio' as metric,
         (select count(*) from b)::text as value
  union all select 2, '1 · isBehind', 'carry end_date but NO forecast_finish (the affected population)',
         (select count(*) from b where end_date is not null and forecast_finish is null)::text
  union all select 3, '1 · isBehind', 'read Behind today',
         (select count(*) from b where behind_now)::text
  union all select 4, '1 · isBehind', 'would read Behind after the change',
         (select count(*) from b where behind_proposed)::text
  union all select 5, '1 · isBehind', '>>> would FLIP On Track -> Behind',
         (select count(*) from b where behind_proposed and not behind_now)::text
  union all select 6, '1 · isBehind', '>>> would FLIP Behind -> On Track',
         (select count(*) from b where behind_now and not behind_proposed)::text

  union all select 10, '2 · roll-up coverage', 'have schedule_start AND schedule_finish',
         (select count(*) from b where schedule_start is not null and schedule_finish is not null)::text
  union all select 11, '2 · roll-up coverage', 'have schedule_progress',
         (select count(*) from b where schedule_progress is not null)::text
  union all select 12, '2 · roll-up coverage', 'have an original_budget > 0',
         (select count(*) from b where coalesce(original_budget,0) > 0)::text
  union all select 13, '2 · roll-up coverage', 'NEVER rolled up (schedule_updated_at is null)',
         (select count(*) from b where schedule_updated_at is null)::text

  union all select 20, '3 · staleness', 'roll-up older than 30 days',
         (select count(*) from b where schedule_updated_at < now() - interval '30 days')::text
  union all select 21, '3 · staleness', 'roll-up older than 90 days',
         (select count(*) from b where schedule_updated_at < now() - interval '90 days')::text
  union all select 22, '3 · staleness', 'oldest roll-up',
         coalesce((select min(schedule_updated_at) from b)::text, '(none)')
  union all select 23, '3 · staleness', 'newest roll-up',
         coalesce((select max(schedule_updated_at) from b)::text, '(none)')

  union all select 30, '4 · project_schedule size', 'activities, portfolio-wide',
         (select n_act from act)::text
  union all select 31, '4 · project_schedule size', 'projects carrying activities',
         (select n_proj from act)::text
  union all select 32, '4 · project_schedule size', 'activities linked to a wbs_node',
         (select n_linked from act)::text

  union all select 40, '5 · phase coverage', 'activities carrying a phase',
         (select n_phase from act)::text
  union all select 41, '5 · phase coverage', 'percent of activities with a phase',
         (select round(100.0 * n_phase / nullif(n_act,0), 1) from act)::text
  union all select 42, '5 · phase coverage', 'projects with ANY phase',
         (select n_proj_phase from act)::text
) x
order by ord;


-- ============================================================================
-- QUERY B — which projects would flip On Track -> Behind. Run separately.
-- ⚠️ If this returns nothing, the isBehind change is a no-op on today's data and
--    is safe to make purely for consistency with the table and projects.html.
-- ============================================================================
with p as (
  select id, name, end_date, forecast_finish, schedule_finish, schedule_progress,
    (coalesce(forecast_finish, schedule_finish, end_date) < current_date
      and (schedule_progress is null or schedule_progress < 100))        as is_overdue,
    (schedule_finish is not null and forecast_finish is not null
      and schedule_finish > forecast_finish)                             as slip_now,
    (schedule_finish is not null and coalesce(forecast_finish, end_date) is not null
      and schedule_finish > coalesce(forecast_finish, end_date))         as slip_proposed
  from projects
)
select id, name, end_date, forecast_finish, schedule_finish, schedule_progress,
       (schedule_finish - coalesce(forecast_finish, end_date)) as days_past_committed
from p
where (slip_proposed or is_overdue) and not (slip_now or is_overdue)
order by days_past_committed desc nulls last;


-- ============================================================================
-- QUERY C — roll-up freshness per project. Run separately.
-- ⚠️ Sizes the coverage note on the front page AND the "stale bar" warning on the
--    Portfolio Schedule Gantt: schedule_updated_at is written when the schedule
--    module is opened, so a project untouched for months carries a
--    confident-looking bar off old numbers.
-- ============================================================================
select id, name, status, schedule_start, schedule_finish, schedule_progress,
       schedule_activities, schedule_updated_at,
       case when schedule_updated_at is null then null
            else (current_date - schedule_updated_at::date) end as rollup_age_days
from projects
order by schedule_updated_at asc nulls first;


-- ============================================================================
-- QUERY D — activities per project. Run separately.
-- ⚠️ `with_phase` per project is what says whether the 8.1% portfolio-wide figure
--    is spread thinly or concentrated in the small projects — i.e. whether the
--    big schedules could ever support a phase drill-down. `linked_to_wbs_node`
--    is the mechanism: 2026-08-12-schedule-project-phase.sql cascades phase ONLY
--    where wbs_node_id is set, and an import timeout leaves it NULL wholesale.
-- ============================================================================
select project_id,
       count(*)                                              as activities,
       count(*) filter (where activity_type = 'WBS Summary') as wbs_rows,
       count(*) filter (where start_date is not null)        as dated,
       count(*) filter (where phase is not null)             as with_phase,
       count(*) filter (where wbs_node_id is not null)       as linked_to_wbs_node
from project_schedule
group by project_id
order by activities desc;
