-- ============================================================================
-- Portfolio Dashboard — MEASUREMENT ONLY. Read-only. Run in the Supabase SQL
-- editor. Writes nothing, creates nothing, is not a migration.
--
-- ⚠️ It is deliberately NOT in migrations/ — that folder is things you run to
--    change the database, and a file in there invites being run as one.
--
-- It answers the five questions the 2026-09-15 portfolio plan is blocked on:
--   1. how many projects the `isBehind` change would affect, and
--   2. how many actually FLIP from On Track to Behind;
--   3. how much of the portfolio carries a schedule roll-up, and how stale;
--   4. how big project_schedule really is, per project and in total;
--   5. how many activities carry a `phase`, which decides whether the Portfolio
--      Schedule view can drill down to phases at all.
-- ============================================================================

-- ---------------------------------------------------------------- 1 and 2 ---
-- ⚠️ The two arms below reproduce the SHIPPED javascript exactly, so the answer
--    is about the app rather than about a tidier rule someone wrote in SQL:
--
--      isOverdue = coalesce(forecast_finish, schedule_finish, end_date) < today
--                  and (schedule_progress is null or schedule_progress < 100)
--      isBehind  = (schedule_finish > forecast_finish)            <- TODAY (bare)
--                  or isOverdue
--      proposed  = (schedule_finish > coalesce(forecast_finish, end_date))
--                  or isOverdue
--
--    Only the first term differs. isOverdue is untouched by the change.
with p as (
  select
    id, name, status,
    start_date, end_date, forecast_finish, schedule_finish,
    schedule_progress, schedule_activities, schedule_updated_at,
    (coalesce(forecast_finish, schedule_finish, end_date) < current_date
      and (schedule_progress is null or schedule_progress < 100))          as is_overdue,
    (schedule_finish is not null and forecast_finish is not null
      and schedule_finish > forecast_finish)                               as slip_now,
    (schedule_finish is not null and coalesce(forecast_finish, end_date) is not null
      and schedule_finish > coalesce(forecast_finish, end_date))           as slip_proposed
  from projects
),
b as (
  select *,
    (slip_now      or is_overdue) as behind_now,
    (slip_proposed or is_overdue) as behind_proposed
  from p
)
select
  '1 · isBehind impact'                                              as section,
  count(*)                                                           as projects,
  count(*) filter (where end_date is not null
                     and forecast_finish is null)                    as affected_population,
  count(*) filter (where behind_now)                                 as behind_today,
  count(*) filter (where behind_proposed)                            as behind_proposed,
  count(*) filter (where behind_proposed and not behind_now)         as would_flip_to_behind,
  count(*) filter (where behind_now and not behind_proposed)         as would_flip_to_ontrack
from b;

-- Name the projects that would flip, so the change is reviewable rather than a
-- number. ⚠️ If this returns nothing, the change is a no-op on today's data and
-- is safe to make purely for consistency with the table and projects.html.
with p as (
  select id, name, end_date, forecast_finish, schedule_finish, schedule_progress,
    (coalesce(forecast_finish, schedule_finish, end_date) < current_date
      and (schedule_progress is null or schedule_progress < 100))          as is_overdue,
    (schedule_finish is not null and forecast_finish is not null
      and schedule_finish > forecast_finish)                               as slip_now,
    (schedule_finish is not null and coalesce(forecast_finish, end_date) is not null
      and schedule_finish > coalesce(forecast_finish, end_date))           as slip_proposed
  from projects
)
select id, name, end_date, forecast_finish, schedule_finish, schedule_progress,
       (schedule_finish - coalesce(forecast_finish, end_date)) as days_past_committed
from p
where (slip_proposed or is_overdue) and not (slip_now or is_overdue)
order by days_past_committed desc nulls last;

-- ------------------------------------------------------------------- 3 -----
-- Roll-up coverage and staleness. ⚠️ This sizes the coverage note on the new
--    front page AND the "stale bar" warning on the Portfolio Schedule Gantt:
--    schedule_updated_at is written when the schedule module is opened, so a
--    project untouched for months carries a confident-looking bar off old numbers.
select
  '3 · schedule roll-up coverage'                                      as section,
  count(*)                                                             as projects,
  count(*) filter (where schedule_start is not null
                     and schedule_finish is not null)                  as have_dates,
  count(*) filter (where schedule_progress is not null)                as have_progress,
  count(*) filter (where original_budget is not null
                     and original_budget > 0)                          as have_budget,
  count(*) filter (where schedule_updated_at is null)                  as never_rolled_up,
  count(*) filter (where schedule_updated_at < now() - interval '30 days')  as stale_30d,
  count(*) filter (where schedule_updated_at < now() - interval '90 days')  as stale_90d,
  min(schedule_updated_at)                                             as oldest_rollup,
  max(schedule_updated_at)                                             as newest_rollup
from projects;

-- Per project, so the stale ones can be named on screen.
select id, name, status, schedule_start, schedule_finish, schedule_progress,
       schedule_activities, schedule_updated_at,
       case when schedule_updated_at is null then null
            else (current_date - schedule_updated_at::date) end as rollup_age_days
from projects
order by schedule_updated_at asc nulls first;

-- ------------------------------------------------------------------- 4 -----
-- ⚠️ Confirms (or refutes) the premise of the pager fix: how many activity rows
--    a portfolio-wide read was actually being asked to drag into the browser.
select
  '4 · project_schedule size'                                          as section,
  count(*)                                                             as activities_total,
  count(distinct project_id)                                           as projects_with_activities
from project_schedule;

-- Per project — this is the one to actually read.
select project_id,
       count(*)                                                        as activities,
       count(*) filter (where activity_type = 'WBS Summary')           as wbs_rows,
       count(*) filter (where start_date is not null)                  as dated,
       count(*) filter (where phase is not null)                       as with_phase,
       count(*) filter (where wbs_node_id is not null)                 as linked_to_wbs_node
from project_schedule
group by project_id
order by activities desc;

-- ------------------------------------------------------------------- 5 -----
-- ⚠️⚠️ THE ONE THAT DECIDES THE GANTT DRILL-DOWN. 2026-08-12-schedule-project-phase.sql
--    cascades `phase` onto activities ONLY where ps.wbs_node_id = t.id, and
--    wbs_node_id is NULL across entire projects after an import timeout. So if
--    `with_phase` is 0 for the big projects, a phase drill-down would render empty
--    for exactly the schedules that most need it, and the Portfolio Schedule view
--    should group by top-level WBS branch instead.
select
  '5 · phase coverage'                                                 as section,
  count(*)                                                             as activities,
  count(*) filter (where phase is not null)                            as with_phase,
  round(100.0 * count(*) filter (where phase is not null)
        / nullif(count(*), 0), 1)                                      as pct_with_phase,
  count(distinct project_id) filter (where phase is not null)          as projects_with_any_phase,
  count(distinct project_id)                                           as projects_total
from project_schedule;
