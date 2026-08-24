-- ============================================================================
-- ONE-OFF CLEANUP: collapse the duplicate calendars left behind by repeated XER
-- imports. Run in the Supabase SQL editor, BLOCK BY BLOCK, in order.
--
-- Background: the importer used to insert every calendar in a P6 file
-- unconditionally, so each re-import copied the whole set (one live project
-- reached 30+ rows: 5x "Performance Bond-1-1-1-1", 4x "Surety Bond-2-1-1", ...).
-- The importer now reuses a matching calendar, so this is a one-time tidy-up and
-- not a tool — nothing here needs to run again.
--
-- ⚠️⚠️ THIS DELETES ROWS AND REPOINTS LIVE SCHEDULE DATA. Read BLOCK A's output
-- before running BLOCK B. The plan is written to a table first precisely so that
-- what you review is exactly what gets executed — a report that re-derives its
-- own grouping can disagree with the action that follows it.
--
-- ⚠️ WHY REPOINTING IS NOT OPTIONAL. All three foreign keys are
-- `on delete set null`, so deleting a duplicate WITHOUT repointing first would
-- silently blank the reference and drop those activities onto the project default
-- calendar. That is a schedule change with nothing on screen to explain it.
-- Referencing tables: project_schedule.calendar_id, resources.calendar_id,
-- duration_scenarios.calendar_id.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- BLOCK A — build the plan, then review it. Makes NO changes to any calendar.
-- ---------------------------------------------------------------------------
drop table if exists calendars_dedupe_plan;

create table calendars_dedupe_plan as
with ident as (
  select
    c.id, c.project_id, c.name, c.is_default, c.created_at,
    -- ⚠️ THE IDENTITY, deliberately the same rule the importer now uses
    -- (name + working week + hours). Two calendars sharing a name but working
    -- different weeks are different calendars, and collapsing them would
    -- repoint activities onto the wrong week.
    lower(btrim(c.name))                                          as name_key,
    coalesce(c.hours_per_day, 8)                                  as hours_key,
    (c.work_mon::int::text || c.work_tue::int::text || c.work_wed::int::text ||
     c.work_thu::int::text || c.work_fri::int::text || c.work_sat::int::text ||
     c.work_sun::int::text)                                       as days_key,
    coalesce(array_length(c.extra_holidays, 1), 0)                as holiday_count,
    -- Rows a planner has actually worked on, in this app rather than in P6.
    case when (case when jsonb_typeof(coalesce(c.seasons, '[]'::jsonb)) = 'array'
                    then jsonb_array_length(coalesce(c.seasons, '[]'::jsonb)) else 0 end) > 0
              or c.climate_type is not null
              or coalesce(c.observe_special_days, false)
         then 1 else 0 end                                        as curated
  from calendars c
  -- ⚠️ project_id is nullable on this table. NULLs form ONE partition, so two
  -- orphaned calendars belonging to different projects would be treated as
  -- duplicates of each other and activities repointed ACROSS projects. Orphans are
  -- left completely alone; if any exist, deal with them by hand (see A5).
  where c.project_id is not null
),
ranked as (
  select i.*,
    count(*) over wpart                                           as group_size,
    -- ⚠️ SURVIVOR ORDER, and why each step is where it is:
    --   is_default  — the project's default must remain the default.
    --   curated     — never discard seasons / climate type / special-days in
    --                 favour of a raw P6 copy that knows nothing about them.
    --   holidays    — keep the RICHEST proclaimed-holiday list. Repointed
    --                 activities then GAIN non-working days rather than losing
    --                 them: dates move later, which is the safe direction for a
    --                 programme, and no hand-entered holiday is thrown away.
    --   created_at  — the original, not a copy of it.
    --   id          — a deterministic tiebreak so re-running cannot pick
    --                 differently from what was reviewed.
    row_number() over word                                        as rank_in_group,
    first_value(i.id) over word                                   as keep_id,
    first_value(i.name) over word                                 as keep_name
  from ident i
  -- ⚠️ TWO windows, and the split is not cosmetic. count(*) over an ORDERED
  -- window is a RUNNING count (1,2,3…), so sharing one window here would have
  -- made group_size read 1 for every group's first row and `group_size > 1`
  -- would have dropped every survivor from the plan — repointing activities at
  -- rows the delete then removed. group_size takes the unordered partition.
  window
    wpart as (partition by i.project_id, i.name_key, i.hours_key, i.days_key),
    word  as (partition by i.project_id, i.name_key, i.hours_key, i.days_key
              order by i.is_default desc nulls last, i.curated desc, i.holiday_count desc,
                       i.created_at asc nulls last, i.id asc)
)
select
  r.project_id, r.name_key, r.hours_key, r.days_key, r.group_size,
  r.id                                    as cal_id,
  r.name                                  as cal_name,
  r.keep_id, r.keep_name,
  (r.id = r.keep_id)                      as is_survivor,
  r.is_default, r.holiday_count, r.curated, r.created_at,
  (select count(*) from project_schedule   s where s.calendar_id = r.id) as activities,
  (select count(*) from resources          x where x.calendar_id = r.id) as resources,
  (select count(*) from duration_scenarios d where d.calendar_id = r.id) as scenarios
from ranked r
where r.group_size > 1;

-- A1. Headline: how much collapses.
select
  count(*) filter (where is_survivor)       as groups_kept,
  count(*) filter (where not is_survivor)   as rows_to_delete,
  coalesce(sum(activities) filter (where not is_survivor), 0) as activities_to_repoint,
  coalesce(sum(resources)  filter (where not is_survivor), 0) as resources_to_repoint,
  coalesce(sum(scenarios)  filter (where not is_survivor), 0) as scenarios_to_repoint
from calendars_dedupe_plan;

-- A2. The plan, group by group. KEEP rows are the survivors.
select project_id, keep_name, group_size,
       case when is_survivor then 'KEEP' else 'delete' end as action,
       cal_name, holiday_count, curated, is_default,
       activities, resources, scenarios, cal_id
from calendars_dedupe_plan
order by project_id, name_key, days_key, is_survivor desc, cal_name;

-- A3. ⚠️ REVIEW THIS ONE. Groups where the duplicates disagree about how many
-- proclaimed holidays they carry. Those activities' dates WILL move when they are
-- repointed (the survivor holds the richest list, so they gain non-working days).
-- If any line here looks wrong, fix that group by hand before running BLOCK B.
select project_id, keep_name,
       min(holiday_count) as fewest_holidays,
       max(holiday_count) as most_holidays,
       sum(activities) filter (where not is_survivor) as activities_affected
from calendars_dedupe_plan
group by project_id, keep_name, name_key, days_key, hours_key
having min(holiday_count) <> max(holiday_count)
order by 5 desc nulls last;

-- A4. ADVISORY ONLY — never actioned by this script. Near-duplicates whose names
-- differ only by P6's copy suffixes ("CARI1-1-1" vs "CARI1-1-1-1", "Copy of X").
-- ⚠️ These are NOT collapsed: the names come verbatim from the XER's clndr_name,
-- so a suffix may mark a genuinely different P6 calendar. Judge these by eye and
-- merge any you recognise by hand.
select project_id,
       regexp_replace(regexp_replace(lower(btrim(name)), '^copy of ', ''), '(-[0-9]+)+$', '') as family,
       count(*) as variants,
       string_agg(distinct name, ' | ' order by name) as names
from calendars
group by 1, 2
having count(*) > 1
order by variants desc;


-- A5. Orphaned calendars (no project) — EXCLUDED from the plan above, listed so
-- their exclusion is visible rather than assumed. Normally zero rows.
select id, name, is_default, created_at,
       (select count(*) from project_schedule s where s.calendar_id = calendars.id) as activities
from calendars where project_id is null order by name;


-- ---------------------------------------------------------------------------
-- BLOCK B — apply the reviewed plan. ⚠️ DESTRUCTIVE. Run only after BLOCK A.
-- One transaction: either every reference is repointed and every duplicate is
-- gone, or nothing changed. A half-applied cleanup would leave activities
-- pointing at rows that no longer exist (nulled by the FK) — the exact silent
-- schedule change this whole script exists to avoid.
-- ---------------------------------------------------------------------------
begin;

-- Repoint FIRST, delete last.
update project_schedule s
   set calendar_id = p.keep_id
  from calendars_dedupe_plan p
 where s.calendar_id = p.cal_id
   and not p.is_survivor;

update resources x
   set calendar_id = p.keep_id
  from calendars_dedupe_plan p
 where x.calendar_id = p.cal_id
   and not p.is_survivor;

update duration_scenarios d
   set calendar_id = p.keep_id
  from calendars_dedupe_plan p
 where d.calendar_id = p.cal_id
   and not p.is_survivor;

-- ⚠️ Carry the default flag across if it sat on a row being deleted. The survivor
-- order already prefers is_default, so this should be a no-op — it is here so that
-- a project cannot come out of this with NO default calendar, which would send
-- every unassigned activity to the hard-coded Philippine standard instead.
update calendars c
   set is_default = true
 where c.id in (select distinct keep_id from calendars_dedupe_plan
                 where not is_survivor and is_default);

delete from calendars c
 where c.id in (select cal_id from calendars_dedupe_plan where not is_survivor);

commit;


-- ---------------------------------------------------------------------------
-- BLOCK C — verify. Expect: zero orphan groups, zero references left dangling,
-- and exactly one default per project.
-- ---------------------------------------------------------------------------
-- C1. No exact-identity duplicates remain.
select project_id, lower(btrim(name)) as name_key, count(*) as still_duplicated
from calendars
group by project_id, lower(btrim(name)), coalesce(hours_per_day, 8),
         (work_mon, work_tue, work_wed, work_thu, work_fri, work_sat, work_sun)
having count(*) > 1;

-- C2. RECONCILIATION — the check that can actually fail. ⚠️ A "nothing points at a
-- deleted calendar" query would be worthless here: the FKs are `on delete set null`,
-- so Postgres nulls any straggler and such a query reports 0 whether the repoint
-- worked or not. Instead compare what the plan recorded against what the survivors
-- now hold: each group's survivor must carry its own references plus every loser's.
-- Expect ZERO rows. A row here means references were lost, not repointed.
select p.keep_id, max(p.keep_name) as keep_name,
       sum(p.activities) as expected_activities,
       (select count(*) from project_schedule s where s.calendar_id = p.keep_id) as actual_activities,
       sum(p.resources)  as expected_resources,
       (select count(*) from resources x where x.calendar_id = p.keep_id) as actual_resources,
       sum(p.scenarios)  as expected_scenarios,
       (select count(*) from duration_scenarios d where d.calendar_id = p.keep_id) as actual_scenarios
from calendars_dedupe_plan p
group by p.keep_id
having sum(p.activities) <> (select count(*) from project_schedule s where s.calendar_id = p.keep_id)
    or sum(p.resources)  <> (select count(*) from resources x where x.calendar_id = p.keep_id)
    or sum(p.scenarios)  <> (select count(*) from duration_scenarios d where d.calendar_id = p.keep_id);

-- C3. One default per project.
select project_id, count(*) filter (where is_default) as defaults, count(*) as calendars
from calendars group by project_id order by defaults desc, project_id;

-- The plan table is left in place on purpose: it is the record of which row
-- survived and what was repointed. Drop it once you are satisfied:
--   drop table calendars_dedupe_plan;
