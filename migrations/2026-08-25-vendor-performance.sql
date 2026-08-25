-- ============================================================================
-- Migration: F2 / F3 / F4 / F5 — VENDOR PERFORMANCE.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
-- ⚠️ Requires 2026-08-25-vendor-identity.sql (F1) and 2026-08-24-boq.sql (B1).
--
-- Design note: docs/vendor-performance-chain.md §3.
--
-- ⚠️ EVERY FUNCTION HERE IS `security invoker`, like schedule_scurve_agg_multi.
--    These read project_schedule across projects; a definer function would hand
--    every caller the whole portfolio regardless of their project assignments.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- F2a) The productivity → work-package link
-- ---------------------------------------------------------------------------
-- ⚠️ A WPM `wp_no`, the SAME key and the same picker `project_schedule.work_package`
--    already uses (2026-08-20). A second, differently-keyed link would make
--    "this vendor's planned vs actual" unjoinable without a translation table.
alter table productivity_activities add column if not exists work_package text;
create index if not exists idx_prod_act_wp on productivity_activities (project_id, work_package);

-- ---------------------------------------------------------------------------
-- F2b) Planned (BOQ) vs actual (productivity) quantity — the reconciliation
-- ---------------------------------------------------------------------------
-- ⚠️ THESE TWO NUMBERS ARE NOT THE SAME NUMBER AND MUST NOT BE FORCED TO AGREE.
--    BOQ quantity is measured FOR PAYMENT; productivity output is measured FOR
--    PROGRESS. Waste, remeasure, provisional sums and cut allowances separate
--    them legitimately. The variance is itself the information — over-consumption
--    on one side, a remeasure claim on the other. This view REPORTS it; nothing
--    anywhere reconciles it away.
--
-- ⚠️ GROUPED BY UNIT, AND UNITS ARE NEVER CONVERTED. If the BOQ measures a
--    package in m2 and the site reports it in kg, that is a fact to show, not a
--    conversion to invent — a wrong factor here silently rescales a vendor's
--    entire performance record.
create or replace view vendor_qty_reconciliation
  with (security_invoker = true) as
with planned as (
  -- Planned quantity reaches an activity through boq_allocations (B1), and only
  -- 'measured' lines contribute — lump-sum and provisional lines carry money but
  -- no measurable quantity, and letting them in corrupts every rate derived here.
  select ps.project_id,
         ps.work_package,
         q.unit,
         sum(q.qty) as qty_planned
  from boq_activity_quantity q
  join project_schedule ps
    on ps.project_id = q.project_id
   and ps.activity_id = q.activity_id
  where ps.work_package is not null
  group by ps.project_id, ps.work_package, q.unit
),
actual as (
  select pa.project_id,
         pa.work_package,
         pa.unit,
         sum(coalesce(pe.qty_actual, 0))  as qty_actual,
         sum(coalesce(pe.mp_actual, 0) * coalesce(pe.work_days, 0)) as man_days,
         min(pe.period) as first_period,
         max(pe.period) as last_period
  from productivity_activities pa
  join productivity_entries pe on pe.activity_id = pa.id
  where pa.work_package is not null
  group by pa.project_id, pa.work_package, pa.unit
)
select coalesce(p.project_id, a.project_id)     as project_id,
       coalesce(p.work_package, a.work_package) as work_package,
       coalesce(p.unit, a.unit)                 as unit,
       -- ⚠️ Null, not 0, when a side has nothing: "no BOQ line allocated here"
       --    and "allocated zero" are different facts, and only one of them is a
       --    reason to go and look.
       p.qty_planned,
       a.qty_actual,
       case when p.qty_planned is not null and a.qty_actual is not null
            then a.qty_actual - p.qty_planned end as qty_variance,
       -- ⚠️ Only meaningful when both sides measure the SAME unit. A full outer
       --    join on unit means a mismatch shows as two rows with one side null,
       --    which is exactly the signal a planner needs.
       case when p.unit is not distinct from a.unit then true else false end as units_agree,
       a.man_days,
       case when a.man_days > 0 then a.qty_actual / a.man_days end as rate_per_man_day,
       a.first_period, a.last_period
from planned p
full outer join actual a
  on  a.project_id   = p.project_id
  and a.work_package = p.work_package
  and a.unit is not distinct from p.unit;

grant select on vendor_qty_reconciliation to authenticated;

-- ---------------------------------------------------------------------------
-- F3) The vendor S-curve
-- ---------------------------------------------------------------------------
-- ⚠️ THIS IS schedule_scurve_agg_multi's BODY WITH ONE EXTRA FILTER on the leaf
--    CTE — deliberately, so a vendor curve and the project curve can never
--    disagree about what a month or a weight means. If that function's weighting
--    changes, change it here too.
--
-- ⚠️ THE PLANNERS→WPM PROJECT MAPPING IS CASH FLOW'S
--    (`cash_flow_settings.wpm_project_id`, falling back to the project id). Two
--    modules disagreeing about which WPM project a schedule belongs to would show
--    different packages for the same job.
--
-- ⚠️ CO-AWARDED PACKAGES ARE ATTRIBUTED TO THE PRIMARY `vendor_id` ONLY (open
--    decision #2). Counting a shared package for both co-awardees would
--    double-count the project total. The omission is NOT silent: `coAwarded`
--    below reports how many packages named this vendor only as a co-awardee, so
--    a curve that looks short can be explained rather than doubted.
create or replace function schedule_scurve_agg_vendor(p_ids text[], p_vendor_id uuid)
returns jsonb
language sql
stable
security invoker
as $$
  with wp as (
    -- The vendor's packages, per Planners project, through Cash Flow's mapping.
    select p.id as project_id, m.wp_no, m.vendor_id, m.awarded_vendor_ids
    from unnest(p_ids) as p(id)
    left join cash_flow_settings cs on cs.project_id = p.id
    join wpm_work_packages m
      on m.wpm_project_id = coalesce(cs.wpm_project_id, p.id)
  ),
  mine as (
    select project_id, wp_no from wp where vendor_id = p_vendor_id
  ),
  leaves as (
    select
      coalesce(nullif(ps.duration_days, 0), (ps.end_date - ps.start_date) + 1, 1)::numeric as w_dur,
      coalesce(ps.planned_cost, ps.bl_cost, 0)::numeric                                    as w_cost,
      ps.start_date::date                                                                  as s,
      coalesce(ps.end_date, ps.start_date)::date                                           as e,
      coalesce(ps.actual_start, ps.start_date)::date                                       as as_,
      coalesce(ps.actual_finish, ps.end_date, ps.actual_start, ps.start_date)::date        as ae_,
      greatest(0, least(100, coalesce(ps.percent_complete, 0)))::numeric / 100.0           as pc,
      ps.activity_name, ps.activity_type, ps.duration_days,
      ps.actual_finish, ps.bl_finish
    from project_schedule ps
    join mine on mine.project_id = ps.project_id and mine.wp_no = ps.work_package
    where ps.project_id = any(p_ids)
      and ps.start_date is not null
      and coalesce(ps.activity_type, '') !~* 'wbs|summary'
  ),
  bounds as (select min(s) as mn, max(e) as mx from leaves),
  months as (
    select (generate_series(date_trunc('month', mn), date_trunc('month', mx), interval '1 month'))::date as m
    from bounds where mn is not null
  ),
  agg as (
    select
      to_char(mo.m, 'YYYY-MM') as key,
      sum(l.w_dur  * greatest(0, least(1, (d.me - l.s + 1)::numeric / greatest(1, (l.e - l.s + 1))))) as pd,
      sum(l.w_cost * greatest(0, least(1, (d.me - l.s + 1)::numeric / greatest(1, (l.e - l.s + 1))))) as pc,
      sum(l.w_dur  * l.pc * greatest(0, least(1, (d.me - l.as_ + 1)::numeric / greatest(1, (l.ae_ - l.as_ + 1))))) as ad,
      sum(l.w_cost * l.pc * greatest(0, least(1, (d.me - l.as_ + 1)::numeric / greatest(1, (l.ae_ - l.as_ + 1))))) as ac
    from months mo
    cross join leaves l
    cross join lateral (select (mo.m + interval '1 month - 1 day')::date as me) d
    group by mo.m
  )
  select jsonb_build_object(
    'vendorId',   p_vendor_id,
    'months',     coalesce((select jsonb_agg(jsonb_build_object('key', key, 'pd', pd, 'pc', pc, 'ad', ad, 'ac', ac) order by key) from agg), '[]'::jsonb),
    'totDur',     coalesce((select sum(w_dur)  from leaves), 0),
    'totCost',    coalesce((select sum(w_cost) from leaves), 0),
    'doneDur',    coalesce((select sum(w_dur  * pc) from leaves), 0),
    'doneCost',   coalesce((select sum(w_cost * pc) from leaves), 0),
    'nAct',       (select count(*) from leaves),
    'nCost',      (select count(*) from leaves where w_cost > 0),
    'minDate',    (select mn from bounds),
    'maxDate',    (select mx from bounds),
    'nPackages',  (select count(*) from mine),
    -- ⚠️ Packages where this vendor is only a CO-awardee, excluded from the curve
    --    above. Reported so a short curve is explainable, never silently short.
    'coAwarded',  (select count(*) from wp
                    where vendor_id is distinct from p_vendor_id
                      and p_vendor_id = any(coalesce(awarded_vendor_ids, '{}'::uuid[]))),
    -- F4 inputs: slip on the vendor's own activities, derived here so the
    -- client never has to pull the leaves to compute it.
    'slipDays',   coalesce((select sum(l.actual_finish - l.bl_finish)
                            from leaves l where l.actual_finish is not null and l.bl_finish is not null), 0),
    'nSlipped',   (select count(*) from leaves l
                    where l.actual_finish is not null and l.bl_finish is not null and l.actual_finish > l.bl_finish),
    'nFinished',  (select count(*) from leaves l where l.actual_finish is not null)
  );
$$;

-- ---------------------------------------------------------------------------
-- F5) The portfolio roll-up — one row per vendor, across projects
-- ---------------------------------------------------------------------------
-- ⚠️ FOLLOWS THE PORTFOLIO RPC PATTERN (2026-07-11-portfolio-resource-rpc.sql),
--    NOT a browser loop. A cross-project vendor ranking read one project at a
--    time is N round-trips and, on this app's real data, tens of thousands of
--    rows in the browser to produce a dozen numbers.
create or replace function vendor_scorecard_multi(p_ids text[])
returns jsonb
language sql
stable
security invoker
as $$
  with wp as (
    select p.id as project_id, m.wp_no, m.vendor_id, m.contractor,
           m.awarded_vendor_ids, m.total_awarded, m.awarded_cost,
           m.target_installation, m.delivery_status
    from unnest(p_ids) as p(id)
    left join cash_flow_settings cs on cs.project_id = p.id
    join wpm_work_packages m
      on m.wpm_project_id = coalesce(cs.wpm_project_id, p.id)
    where m.vendor_id is not null
  ),
  acts as (
    select w.vendor_id, w.project_id, w.wp_no,
           ps.start_date, ps.end_date, ps.actual_finish, ps.bl_finish,
           greatest(0, least(100, coalesce(ps.percent_complete, 0)))::numeric / 100.0 as pc,
           coalesce(nullif(ps.duration_days, 0), (ps.end_date - ps.start_date) + 1, 1)::numeric as w_dur
    from wp w
    join project_schedule ps
      on ps.project_id = w.project_id and ps.work_package = w.wp_no
    where coalesce(ps.activity_type, '') !~* 'wbs|summary'
      and ps.start_date is not null
  ),
  -- Need-by adherence: the schedule's earliest start for the package against
  -- WPM's Target Installation — the same comparison E2 already surfaces.
  -- ⚠️ There is NO actual-delivery date anywhere in the mirror, so this measures
  --    PLANNED adherence, not delivered-on-time. Naming it otherwise would be a
  --    number nobody could defend.
  needby as (
    select w.vendor_id, w.project_id, w.wp_no,
           min(a.start_date) as need_by,
           w.target_installation,
           (w.target_installation - min(a.start_date)) as slack_days
    from wp w
    join acts a on a.project_id = w.project_id and a.wp_no = w.wp_no
    where w.target_installation is not null
    group by w.vendor_id, w.project_id, w.wp_no, w.target_installation
  )
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.vendor_name), '[]'::jsonb)
  from (
    select v.id                                    as vendor_id,
           coalesce(v.name, min(w.contractor))     as vendor_name,
           v.vendor_code, v.trade_categories, v.accreditation, v.status,
           count(distinct w.project_id)            as n_projects,
           count(distinct (w.project_id || '|' || w.wp_no)) as n_packages,
           sum(coalesce(w.total_awarded, w.awarded_cost, 0)) as awarded_value,
           (select count(*) from acts a where a.vendor_id = v.id)          as n_activities,
           (select coalesce(sum(a.w_dur * a.pc), 0) / nullif(sum(a.w_dur), 0)
              from acts a where a.vendor_id = v.id)                        as pct_complete,
           (select coalesce(sum(a.actual_finish - a.bl_finish), 0) from acts a
             where a.vendor_id = v.id and a.actual_finish is not null and a.bl_finish is not null) as slip_days,
           (select count(*) from acts a
             where a.vendor_id = v.id and a.actual_finish is not null
               and a.bl_finish is not null and a.actual_finish > a.bl_finish) as n_slipped,
           (select count(*) from needby n where n.vendor_id = v.id and n.slack_days < 0) as n_needby_late,
           (select count(*) from needby n where n.vendor_id = v.id)          as n_needby_checked
    from wp w
    join wpm_vendors v on v.id = w.vendor_id
    group by v.id, v.name, v.vendor_code, v.trade_categories, v.accreditation, v.status
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- F6) The rate library — vendor x trade x unit, from real months
-- ---------------------------------------------------------------------------
-- ⚠️ SAMPLE SIZE AND DATE RANGE TRAVEL WITH THE RATE, ALWAYS. A productivity
--    rate from two months of one crew is not the same claim as one from thirty,
--    and a duration offered without saying which it came from is how a schedule
--    acquires false confidence.
--
-- ⚠️ RATE IS RECOMPUTED FROM THE MONTHLY TOTALS, NOT AVERAGED FROM THE MONTHLY
--    RATES. Averaging per-month rates weights a 3-day month equally with a
--    26-day one; Σqty ÷ Σman-days is the honest figure.
create or replace view vendor_rate_library
  with (security_invoker = true) as
select pa.vendor_id,
       pa.category                                    as trade,
       pa.unit,
       pa.resource_type,
       count(*)                                       as n_months,
       count(distinct pa.project_id)                  as n_projects,
       sum(coalesce(pe.qty_actual, 0))                as qty_total,
       sum(coalesce(pe.mp_actual, 0) * coalesce(pe.work_days, 0)) as man_days_total,
       case when sum(coalesce(pe.mp_actual, 0) * coalesce(pe.work_days, 0)) > 0
            then sum(coalesce(pe.qty_actual, 0))
               / sum(coalesce(pe.mp_actual, 0) * coalesce(pe.work_days, 0)) end as rate_per_man_day,
       min(pe.period) as first_period,
       max(pe.period) as last_period
from productivity_activities pa
join productivity_entries pe on pe.activity_id = pa.id
-- ⚠️ Only months that actually recorded BOTH sides. A month with output but no
--    manpower (or vice versa) is an incomplete record, and including it drags the
--    rate toward a number no crew ever achieved.
where coalesce(pe.qty_actual, 0) > 0
  and coalesce(pe.mp_actual, 0) > 0
  and coalesce(pe.work_days, 0) > 0
group by pa.vendor_id, pa.category, pa.unit, pa.resource_type;

grant select on vendor_rate_library to authenticated;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--   select * from vendor_qty_reconciliation limit 5;
--   select * from vendor_rate_library limit 5;
--   select schedule_scurve_agg_vendor(array['OPW101'], '<a wpm_vendors.id>');
--   select vendor_scorecard_multi(array['OPW101','AVR101']);
--
-- ⚠️ All of these read empty until `sync-wpm` has been redeployed and re-run —
--    `wpm_work_packages.vendor_id` is the join key and it is NULL until then.
