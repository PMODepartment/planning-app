-- One-call project CLEAR (Project Schedule — "Clear schedule" and every REPLACE import)
-- ================================================================================================
-- WHY THIS EXISTS, and why the obvious fix was not enough.
--
-- `Clear schedule` was a single `delete ... where project_id = $1` from PostgREST. On SLN101 that
-- returned **"canceling statement due to statement timeout"** and cleared nothing. The 2026-09-02
-- client fix chunked it into `delete ... where id in (<200 ids>)` requests, which WORKS but is
-- brutally slow: measured by the owner at **100-200 activities per 2 seconds**, i.e. ~10ms per row.
--
-- ⚠️ THAT 10ms IS NOT DATABASE TIME. `project_schedule` carries no trigger, no rule and nothing
-- referencing it (`grep -rn "references project_schedule"` over the whole schema: no matches), and
-- it is indexed on `(project_id, id)`. Deleting 16,485 rows server-side is one index scan. The cost
-- is the HTTP ROUND TRIP: 200 ids is already close to the practical URL length for a PostgREST
-- `in.(...)` filter (36-char uuids + encoding ≈ 8KB), so the chunk size cannot simply be raised —
-- 20,000 rows means ~100 sequential requests whatever we do on the client. The fix has to move the
-- loop into the database.
--
-- 4PH Strevi Bacoor is 16,485 activities and 12,465 WBS nodes. At 200 per round trip that is ~145
-- requests and minutes of spinner; here it is one call.
--
-- WHY A ROW LIMIT RATHER THAN A BARE `delete where project_id = $1`:
-- the bare form is what timed out in the first place. `statement_timeout` is a property of the
-- deployment, not of this function — a plpgsql loop inside one call does NOT get a fresh timeout per
-- iteration, because the timer is armed once when the top-level statement starts. So the bound has
-- to be visible to the CALLER, which can then come back for more. `p_limit` is that bound: the
-- client asks for a batch, gets the count, and calls again until it gets 0. It also lets the client
-- HALVE the batch and retry when a call does time out, instead of failing the whole operation.
--
-- SECURITY INVOKER (the default) — the function runs as the CALLER, so Row-Level Security still
-- applies and a user can only clear projects they can already write. ⚠️ Do NOT change this to
-- SECURITY DEFINER: these functions delete a whole project's schedule, and definer rights would let
-- any authenticated caller wipe any project.
--
-- The client calls these first and falls back to its id-chunking loop when the function is absent,
-- so it is safe to deploy the client before or after this migration.
--
-- Idempotent: create-or-replace + re-granted execute. Safe to run more than once.

-- 1) The activities. -------------------------------------------------------------------------
create or replace function public.clear_project_schedule(p_project_id text, p_limit integer default 20000)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.project_schedule
   where id in (
     select id from public.project_schedule
      where project_id = p_project_id
      limit greatest(1, coalesce(p_limit, 20000))
   );
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.clear_project_schedule(text, integer) to authenticated;


-- 2) The WBS tree. ---------------------------------------------------------------------------
-- ⚠️ `is_locked = false` ONLY, exactly like the client's `_clearWbsTree`. The standard Milestones /
-- Initiation / Planning / Execution Phase skeleton is locked and must survive a clear — the whole
-- app assumes it exists, and an import re-adopts underneath it.
-- ⚠️ Children before parents is NOT needed: `wbs_nodes.parent_id` is
-- `references wbs_nodes(id) on delete cascade`, so a batch that deletes a parent takes its subtree
-- with it. That also means the returned count UNDER-reports what actually went, which is why the
-- client loops until it gets 0 rather than counting up to a total it predicted.
create or replace function public.clear_project_wbs_nodes(p_project_id text, p_limit integer default 20000)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.wbs_nodes
   where id in (
     select id from public.wbs_nodes
      where project_id = p_project_id
        and coalesce(is_locked, false) = false
      limit greatest(1, coalesce(p_limit, 20000))
   );
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.clear_project_wbs_nodes(text, integer) to authenticated;


-- 3) Resource assignments, cleared by both REPLACE paths alongside the activities. -------------
create or replace function public.clear_project_resource_assignments(p_project_id text, p_limit integer default 20000)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.resource_assignments
   where id in (
     select id from public.resource_assignments
      where project_id = p_project_id
      limit greatest(1, coalesce(p_limit, 20000))
   );
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.clear_project_resource_assignments(text, integer) to authenticated;
