-- ============================================================================
-- READ-ONLY AUDIT: which what-if scenarios stored dates only?
--
-- Context: the Schedule Setup's push captures the internal (target) plan as a
-- what-if scenario storing [start, finish, duration, null, null, null, null,
-- null] -- dates only, on purpose. Until 2026-09-17, restoreScenario did not
-- SKIP those nulls, it WROTE them, so restoring such a scenario set every
-- covered activity's percent_complete, predecessors and planned_cost to NULL.
--
-- The reader is fixed, and the fix covers these rows -- restoring one now
-- leaves those three columns alone and says so. This audit is to see how many
-- such rows exist and on which projects, NOT to repair anything.
--
-- ⚠ NOTHING HERE WRITES. Every statement is a SELECT. Run in the SQL editor.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Every scenario, with how many of its activities are dates-only.
--
--    dates_only = entries whose positions 3 (percent_complete), 4
--    (predecessors) and 5 (planned_cost) are ALL null -- the shape restore
--    used to write back over live data.
--
--    ⚠ LEFT JOIN LATERAL, not CROSS JOIN: a scenario with an empty
--    `activities` object has no entries to expand, and a cross join would drop
--    it from the audit entirely -- which would read as "no such scenario".
-- ---------------------------------------------------------------------------
select
  s.taken_at::date                                   as taken,
  s.project_id,
  p.name                                             as project,
  s.name                                             as scenario,
  s.activity_count,
  count(e.key)                                       as entries,
  count(e.key) filter (
    where e.value ->> 3 is null
      and e.value ->> 4 is null
      and e.value ->> 5 is null
  )                                                  as dates_only,
  -- the two summary columns the push never set; both null is the signature of
  -- a push-captured scenario, and is what used to fabricate the compare tiles
  s.critical_count,
  s.total_cost,
  case
    when count(e.key) = 0                            then 'empty'
    when count(e.key) filter (
      where e.value ->> 3 is null
        and e.value ->> 4 is null
        and e.value ->> 5 is null) = count(e.key)    then 'DATES ONLY (was destructive to restore)'
    when count(e.key) filter (
      where e.value ->> 3 is null
        and e.value ->> 4 is null
        and e.value ->> 5 is null) > 0               then 'mixed'
    else                                                  'full snapshot'
  end                                                as shape
from schedule_scenarios s
left join projects p on p.id = s.project_id
left join lateral jsonb_each(coalesce(s.activities, '{}'::jsonb)) e on true
group by s.id, s.taken_at, s.project_id, p.name, s.name, s.activity_count,
         s.critical_count, s.total_cost
order by s.taken_at desc;


-- ---------------------------------------------------------------------------
-- 2. The one-line answer: how many scenarios are of each shape, and how many
--    activities across the whole database were exposed.
-- ---------------------------------------------------------------------------
with per_scn as (
  select
    s.id,
    s.name,
    count(e.key) as entries,
    count(e.key) filter (
      where e.value ->> 3 is null
        and e.value ->> 4 is null
        and e.value ->> 5 is null) as dates_only
  from schedule_scenarios s
  left join lateral jsonb_each(coalesce(s.activities, '{}'::jsonb)) e on true
  group by s.id, s.name
)
select
  count(*)                                                as scenarios_total,
  count(*) filter (where entries > 0 and dates_only = entries) as dates_only_scenarios,
  count(*) filter (where dates_only > 0 and dates_only < entries) as mixed_scenarios,
  count(*) filter (where entries > 0 and dates_only = 0)  as full_snapshots,
  count(*) filter (where entries = 0)                     as empty_scenarios,
  coalesce(sum(dates_only), 0)                            as activities_dates_only,
  -- how many of them came from the Setup push, by name
  count(*) filter (where name like 'Internal (target)%')  as named_internal_target
from per_scn;


-- ---------------------------------------------------------------------------
-- 3. ⚠ A NAME IS NOT THE TEST, AND THIS IS WHY IT IS ASKED SEPARATELY.
--    The push names its scenario 'Internal (target) — <date>', but a planner
--    can rename it, and a scenario captured some other way could in principle
--    be dates-only too. If these two numbers disagree, the SHAPE is the
--    authority and the name is not.
-- ---------------------------------------------------------------------------
select
  s.name,
  s.taken_at::date as taken,
  s.project_id,
  (s.name like 'Internal (target)%')                          as looks_like_a_push,
  (s.critical_count is null and s.total_cost is null)         as summary_cols_unset
from schedule_scenarios s
order by s.taken_at desc;
