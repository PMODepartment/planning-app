-- One-call WBS link RPC (Project Schedule — WBS adoption after a big import)
-- ------------------------------------------------------------------------------------------------
-- After an import, `wbsAdopt()` builds one wbs_node per WBS-Summary row and then has to write
-- project_schedule.wbs_node_id back onto every row. It did that with one single-row PATCH per row
-- (40 in flight): 12,465 requests / 312 sequential waves for the 4PH Strevi Residences .xer — the
-- app looks hung for minutes, and any wave that fails leaves nodes unlinked. An unlinked node reads
-- to `_wbsEnsureSummaries()` as "this node has no summary row", which it heals by INSERTING one,
-- sequentially — the duplicate-WBS-row runaway seen on Avesta (AVR101).
--
-- This function does the whole set as a SINGLE UPDATE ... FROM jsonb_to_recordset. It matches on the
-- dotted WBS code, so it links the summary row AND any activity carrying that same code (a Builder
-- push / manually-added activity), which is exactly what the client loop did.
--
-- SECURITY INVOKER (the default) → the function runs as the CALLER, so Row-Level Security on
-- project_schedule still applies: a user can only relink rows in projects they can write. Do NOT
-- change this to SECURITY DEFINER — that would let any caller rewrite another project's tree links.
--
-- The client calls this first and falls back to per-row updates if the function is absent, so it is
-- safe to deploy the client before or after this migration.
--
-- Idempotent: create-or-replace + a re-granted execute privilege. Safe to run multiple times.

create or replace function public.wbs_link_codes(p_project_id text, p_map jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  update public.project_schedule s
     set wbs_node_id = m.node_id
    from jsonb_to_recordset(coalesce(p_map, '[]'::jsonb)) as m(code text, node_id uuid)
   where s.project_id = p_project_id
     and s.wbs = m.code
     and s.wbs_node_id is distinct from m.node_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Logged-in app users authenticate via Supabase Auth, so their requests run as `authenticated`.
grant execute on function public.wbs_link_codes(text, jsonb) to authenticated;


-- ================================================================================================
-- 2) Attach IMPORTED ACTIVITIES to their WBS branch.
-- ------------------------------------------------------------------------------------------------
-- `wbs_link_codes` above links rows whose dotted code EQUALS a branch's code — summary rows, and the
-- Builder-pushed / manually-added activities that are filed AT a branch. An IMPORTED activity is not
-- one of those: it carries its own LEAF code ("4.2.3.1.5" under branch "4.2.3.1"), so it matched
-- nothing and every import left `wbs_node_id` NULL on every activity. Measured on the real exports:
-- 4,393 of 4,393 (Avesta) and 16,393 of 16,393 (4PH Strevi).
--
-- The grid never showed it, because rebuild() derives ancestry by SPLITTING the dotted code. What
-- broke was everything keyed on the NODE:
--   * the WBS Manager's "N activities" read 0 on all 1,623 / 12,464 nodes;
--   * phaseOf() is `r.phase || _nodePhase(r.wbs_node_id)`, so every activity had NO phase —
--     isExecPhase() was false everywhere and Vertical Stacking reported "0 execution-phase
--     activities stacked" on a project holding 3,874 of them;
--   * workOf() had no branch to infer a trade from, and Contract Scope read "—".
--
-- ⚠️ NO PAYLOAD. The project's own WBS-Summary rows ARE the (dotted code -> node id) map, so the
-- join runs entirely inside the database. That is the point: the client-side alternative is one
-- PATCH per activity — 16,393 requests, the runaway `wbs_link_codes` was written to kill — so the
-- client has NO row-by-row fallback for this one and reports the missing function instead.
--
-- Matching rule: an activity belongs to the branch whose code is its own code minus the last
-- segment. `regexp_replace(wbs, '\.[^.]+$', '')` is exactly that, and the `like '%.%'` guard keeps a
-- single-segment code (which has no parent) from matching a top-level branch as its own parent.
--
-- The sub-select collapses the code -> node map with min(), so a project that still carries two
-- summary rows sharing one dotted code resolves deterministically instead of picking at random.
--
-- SECURITY INVOKER (the default) — runs as the CALLER, so RLS on project_schedule still applies.
-- Idempotent, and safe to re-run: rows that already carry the right node are excluded by the
-- `is distinct from` test, so a second run reports 0.

create or replace function public.wbs_link_activity_parents(p_project_id text)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  update public.project_schedule a
     set wbs_node_id = s.node_id
    from (
      select wbs, min(wbs_node_id::text)::uuid as node_id
        from public.project_schedule
       where project_id = p_project_id
         and activity_type = 'WBS Summary'
         and wbs_node_id is not null
         and wbs is not null
       group by wbs
    ) s
   where a.project_id = p_project_id
     and a.activity_type is distinct from 'WBS Summary'
     and a.wbs_node_id is null
     and a.wbs is not null
     and a.wbs like '%.%'
     and s.wbs = regexp_replace(a.wbs, '\.[^.]+$', '')
     and a.wbs_node_id is distinct from s.node_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.wbs_link_activity_parents(text) to authenticated;
