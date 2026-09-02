-- Batch the activity->branch link, because the single-statement version times out on a real project
-- ================================================================================================
-- MEASURED, not theorised. Called against 4PH Strevi (SLN101) in the owner's signed-in browser:
--
--     rpc('wbs_link_activity_parents', { p_project_id: 'SLN101' })
--       -> 57014  "canceling statement due to statement timeout"   after 8,173 ms
--
-- So the deployment's `statement_timeout` is ~8s and this function needs more: it is ONE update over
-- 16,485 activities joined against a GROUP BY over 12,473 WBS-summary rows, with the join key
-- computed per row (`regexp_replace(wbs, '\.[^.]+$', '')`), which no index can serve.
--
-- ⚠️ THE CONSEQUENCE WAS SILENT AND SEVERE. `_wbsLinkActivityParents` catches the error and only
-- toasts when not silent — and every caller that matters passes silent. So the import finished, the
-- WBS tree was complete (12,473 nodes, all summary rows linked), and **16,393 of 16,485 activities
-- kept `wbs_node_id = NULL`** with nothing said. That is the exact state documented in
-- 2026-09-01-wbs-link-rpc.sql: `phaseOf()` null for every activity, so `isExecPhase()` false
-- everywhere and Vertical Stacking draws nothing; `workOf()` finds no trade; every WBS Manager count
-- reads 0 — while the grid looks perfect, because `rebuild()` derives ancestry by splitting the
-- dotted code and never reads the node id.
--
-- THE FIX IS THE ONE THE CLEAR ALREADY USES: bound the work per call and let the caller come back.
-- A plpgsql loop inside one call would NOT help — the timeout is armed once, when the top-level
-- statement starts — so the bound has to be visible to the client, which loops until it gets 0 and
-- halves `p_limit` if a call still times out.
--
-- ⚠️ `drop function` first, deliberately. Adding a defaulted second parameter to the existing
-- one-argument function would leave BOTH in the catalog, and PostgREST cannot resolve
-- `wbs_link_activity_parents(p_project_id)` against two candidates — it answers PGRST203
-- (ambiguous). Replacing it outright keeps exactly one signature, and the default keeps any older
-- client that calls it with one argument working.
--
-- SECURITY INVOKER — runs as the CALLER, so RLS on project_schedule still applies. Idempotent: rows
-- already carrying the right node are excluded, so a second run reports 0.

drop function if exists public.wbs_link_activity_parents(text);
drop function if exists public.wbs_link_activity_parents(text, integer);

create or replace function public.wbs_link_activity_parents(p_project_id text, p_limit integer default 4000)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  with map as (
    select wbs, min(wbs_node_id::text)::uuid as node_id
      from public.project_schedule
     where project_id = p_project_id
       and activity_type = 'WBS Summary'
       and wbs_node_id is not null
       and wbs is not null
     group by wbs
  ),
  targets as (
    select a.id, m.node_id
      from public.project_schedule a
      join map m on m.wbs = regexp_replace(a.wbs, '\.[^.]+$', '')
     where a.project_id = p_project_id
       and a.activity_type is distinct from 'WBS Summary'
       and a.wbs_node_id is null
       and a.wbs is not null
       and a.wbs like '%.%'
     limit greatest(1, coalesce(p_limit, 4000))
  )
  update public.project_schedule s
     set wbs_node_id = t.node_id
    from targets t
   where s.id = t.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.wbs_link_activity_parents(text, integer) to authenticated;
