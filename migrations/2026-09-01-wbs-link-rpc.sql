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
