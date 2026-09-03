-- Batch the "clear dangling wbs_node_id" pass of Reset WBS tree
-- ================================================================================================
-- Reset WBS tree deletes the unlocked nodes and then has to clear every `project_schedule.
-- wbs_node_id` that pointed at them. It did that as ONE update:
--
--     update project_schedule set wbs_node_id = null
--      where project_id = $1 and wbs_node_id is not null and wbs_node_id not in (<locked ids>)
--
-- ⚠️ On 4PH Strevi that is ~28,958 rows in one statement, and this deployment's `statement_timeout`
-- is **~8 seconds** — measured, not assumed: `wbs_link_activity_parents` returned 57014 after
-- 8,173ms on 16,485 rows the same afternoon. So Reset WBS tree — the documented recovery from a
-- broken tree — would itself fail on exactly the projects that need it, leaving the nodes deleted
-- and every row still pointing at them.
--
-- ⚠️ NO KEEP-LIST. The old form had to be told which nodes survived, and passed them as a
-- `not in (…)` of ids. This asks the better question: null the rows whose node **no longer exists**.
-- After the delete that is precisely the dangling set, it cannot be wrong about which nodes
-- survived, and it needs no argument that grows with the tree.
--
-- ⚠️ Bounded by `p_limit` for the same reason as every other statement here: a plpgsql loop inside
-- one call does NOT get a fresh timeout per iteration, because the timer is armed once when the
-- top-level statement starts. The caller loops until it gets 0 and halves the batch on 57014.
--
-- SECURITY INVOKER — runs as the CALLER, so RLS still applies. Idempotent: a second run finds
-- nothing dangling and returns 0.

create or replace function public.wbs_unlink_dangling(p_project_id text, p_limit integer default 4000)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  update public.project_schedule s
     set wbs_node_id = null
   where s.id in (
     select a.id
       from public.project_schedule a
      where a.project_id = p_project_id
        and a.wbs_node_id is not null
        and not exists (select 1 from public.wbs_nodes w where w.id = a.wbs_node_id)
      limit greatest(1, coalesce(p_limit, 4000))
   );
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.wbs_unlink_dangling(text, integer) to authenticated;


-- ================================================================================================
-- 2) Orphan NODES — a node no WBS-summary row points at.
-- ------------------------------------------------------------------------------------------------
-- Adopting twice against a stale in-memory copy inserts a second node for every branch that already
-- had one. Measured on 4PH Strevi: `wbs_nodes` went 12,473 -> **18,323** against 12,473 summary
-- rows, i.e. 5,850 duplicates — exactly the number the first adopt had left outstanding.
--
-- ⚠️ Duplicates do not sit still. `_wbsEnsureSummaries()` projects a summary row for any node without
-- one, so the next load manufactures a summary row per duplicate, which the next adopt then adopts.
-- That is the duplicate-WBS-row runaway.
--
-- ⚠️ THIS DELETES LEAVES ONLY (`not exists (child)`), and that is the whole safety argument.
-- `wbs_nodes.parent_id` is `on delete cascade`, so deleting an orphan that happens to be the PARENT
-- of a referenced node would silently take the good node with it. Peeling only childless orphans,
-- repeatedly, can never do that: a node is removed only once nothing hangs beneath it. The caller
-- loops until it returns 0, so a duplicated SUBTREE still goes completely, one layer at a time.
-- ⚠️ Locked skeleton nodes are excluded outright — they are legitimately unreferenced.

create or replace function public.wbs_delete_orphan_leaves(p_project_id text, p_limit integer default 2000)
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
     select w.id
       from public.wbs_nodes w
      where w.project_id = p_project_id
        and coalesce(w.is_locked, false) = false
        and not exists (select 1 from public.wbs_nodes c where c.parent_id = w.id)
        and not exists (select 1 from public.project_schedule s
                         where s.project_id = p_project_id and s.wbs_node_id = w.id)
      limit greatest(1, coalesce(p_limit, 2000))
   );
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.wbs_delete_orphan_leaves(text, integer) to authenticated;
