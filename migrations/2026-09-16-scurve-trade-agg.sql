-- ============================================================================
-- Per-TRADE monthly S-curve aggregate (2026-09-16)
-- ----------------------------------------------------------------------------
-- Owner: *"allow users to click a specific month to know the breakdowns
-- (for example per trade …)"* — on the PORTFOLIO S-Curve.
--
-- ⚠️⚠️ WHY A NEW FUNCTION AND NOT A CLIENT-SIDE SPLIT. `schedule_scurve_agg`
-- returns months with NO trade dimension, so the only way to answer "what was
-- this month made of" in the browser is to fetch the raw activities — which for
-- one project is 16k–40k rows and across a portfolio of twenty-one is a third of
-- a million. That read is exactly what the server-side aggregate was introduced
-- to stop (see 2026-07-20-schedule-scurve-agg.sql). Grouping by trade adds a
-- dimension to an aggregate that is already being computed; it does not add a
-- pass over the table.
--
-- ⚠️⚠️ ONE PROJECT PER CALL, DELIBERATELY, AND THE `_multi` SHAPE IS NOT OFFERED.
-- On 2026-09-16 `schedule_scurve_agg_multi(21 ids)` was cancelled at the ~8s
-- statement_timeout in production: the month series is CROSS JOINed against the
-- leaves, so N projects is (union of every horizon) × (every activity). The
-- browser fans this out one project at a time — the shape
-- `project_schedule_proj_id_idx (project_id, id)` exists for — and sums the
-- results. A `_multi` here would re-introduce the statement that just failed.
--
-- ⚠️ THE TRADE COLUMN IS `work_type`, which is the shell's own convention (the
-- dashboard's programme panel groups this same table by it, and the S-Curve
-- module's `tradeOf()` reads it). Blank lands in ONE honest bucket rather than
-- being dropped: an activity with no trade is still work, and a breakdown that
-- silently omits it would not add up to the curve above it.
-- ⚠️ `'No trade set'` is the S-Curve module's own label for that bucket, spelled
-- identically on purpose — two names for one bucket across two screens over one
-- schedule is the drift this repo keeps paying for.
--
-- ⚠️ The arithmetic is `schedule_scurve_agg_multi`'s, unchanged: same leaf rule
-- (WBS/summary excluded), same duration weight, same linear spread of an
-- activity across the months it spans, same `percent_complete` clamp. If those
-- two ever disagree, the breakdown stops adding up to the curve it explains.
--
-- security invoker → the caller's RLS applies, same as every other read here.
-- Idempotent (create or replace). Run once in the Supabase SQL editor.
-- ============================================================================

create or replace function schedule_scurve_trade_agg(p_id text)
returns jsonb
language sql
stable
security invoker
as $$
  with leaves as (
    select
      coalesce(nullif(btrim(work_type), ''), 'No trade set')                       as trade,
      coalesce(nullif(duration_days, 0), (end_date - start_date) + 1, 1)::numeric  as w_dur,
      start_date::date                                                             as s,
      coalesce(end_date, start_date)::date                                         as e,
      coalesce(actual_start, start_date)::date                                      as as_,
      coalesce(actual_finish, end_date, actual_start, start_date)::date             as ae_,
      greatest(0, least(100, coalesce(percent_complete, 0)))::numeric / 100.0       as pc
    from project_schedule
    where project_id = p_id
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
      l.trade                  as trade,
      to_char(mo.m, 'YYYY-MM') as key,
      sum(l.w_dur         * (case when d.me >= l.e   then 1 when d.me < l.s   then 0 when l.e   > l.s   then (d.me - l.s)::numeric   / (l.e   - l.s)   else 1 end)) as pd,
      sum(l.w_dur * l.pc  * (case when d.me >= l.ae_ then 1 when d.me < l.as_ then 0 when l.ae_ > l.as_ then (d.me - l.as_)::numeric / (l.ae_ - l.as_) else 1 end)) as ad
    from months mo
    cross join lateral (select (mo.m + interval '1 month - 1 day')::date as me) d
    cross join leaves l
    group by l.trade, mo.m
    order by l.trade, mo.m
  ),
  tot as (
    select trade, sum(w_dur) as tot_dur, sum(w_dur * pc) as done_dur, count(*) as n_act
    from leaves group by trade
  )
  select jsonb_build_object(
    'trades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'trade',   t.trade,
        'totDur',  t.tot_dur,
        'doneDur', t.done_dur,
        'nAct',    t.n_act,
        'months',  coalesce((select jsonb_agg(jsonb_build_object('key', a.key, 'pd', a.pd, 'ad', a.ad) order by a.key)
                             from agg a where a.trade = t.trade), '[]'::jsonb)
      ) order by t.tot_dur desc)
      from tot t), '[]'::jsonb),
    -- ⚠️ The project totals travel WITH the split so the caller never has to decide which of two
    --    sources to trust for the denominator. They are the same `leaves` set, by construction.
    'totDur',  coalesce((select sum(w_dur) from leaves), 0),
    'doneDur', coalesce((select sum(w_dur * pc) from leaves), 0),
    'nAct',    (select count(*) from leaves)
  );
$$;

grant execute on function schedule_scurve_trade_agg(text) to authenticated;
