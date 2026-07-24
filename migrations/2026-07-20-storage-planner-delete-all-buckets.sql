-- ============================================================================
-- Migration: widen the DELETE policy on the remaining two module buckets
-- (drawing-register, progress-photos) to planners — same change already applied
-- to material-submittal by 2026-07-20-material-submittal-storage-delete.sql.
--
-- A NEW file rather than editing that one: it has already been run, and applied
-- migrations should stay immutable so "what ran" is unambiguous.
--
-- WHY: the 2026-06-18 storage migration set
--   delete using (bucket_id = <b> and (owner = auth.uid() or is_admin()))
-- so a PLANNER deleting a drawing/photo they did not upload removed the row but
-- its storage object delete silently no-opped, orphaning the file.
--
-- ⚠️ The `owner = auth.uid()` branch is KEPT deliberately. Both buckets' INSERT
-- policy is `is_approved()`, i.e. ANY approved user can upload — including the
-- `user`/`viewer` roles. Replacing the owner check with `is_planner()` alone
-- would take away those users' ability to delete their own uploads: a NARROWING,
-- not a widening. `is_planner()` (approved AND role in super_admin/admin/planner)
-- already subsumes the old `is_admin()` branch, so this is purely additive.
--
-- After this, all three module buckets share one delete rule.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

-- Guard: the policy references is_planner() (added by
-- 2026-06-30-workspaces-project-selector.sql). A policy's USING expression is
-- parsed at creation, so without it you'd get a bare "function does not exist".
do $$
begin
  if to_regprocedure('public.is_planner()') is null then
    raise exception 'is_planner() is missing — run migrations/2026-06-30-workspaces-project-selector.sql first';
  end if;
end $$;

do $$
declare b text;
begin
  foreach b in array array['drawing-register','progress-photos'] loop
    execute format('drop policy if exists %I on storage.objects', b || '_del');
    execute format(
      'create policy %I on storage.objects for delete using (bucket_id = %L and (owner = auth.uid() or is_planner()))',
      b || '_del', b);
  end loop;
end $$;

-- Verify (expects 3 rows, every using_expr naming is_planner):
--   select polname, pg_get_expr(polqual, polrelid) as using_expr
--   from pg_policy
--   where polrelid = 'storage.objects'::regclass and polname like '%\_del'
--   order by polname;
