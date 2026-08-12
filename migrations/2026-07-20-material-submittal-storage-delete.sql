-- ============================================================================
-- Migration: widen the material-submittal bucket's DELETE policy to planners.
--
-- WHY: the 2026-06-18 storage migration gave all three buckets
--   delete using (bucket_id = <b> and (owner = auth.uid() or is_admin()))
-- so a PLANNER deleting a submittal they did not upload removed the row but its
-- storage object delete silently no-opped, orphaning the file in the bucket.
-- (Not data loss — the row is gone — but the bucket accumulates junk, and the
-- module's row/bulk/clear delete paths all hit this.)
--
-- `is_planner()` is `approved AND role in (super_admin, admin, planner)`, so it
-- already subsumes the old `is_admin()` branch.
--
-- ⚠️ The `owner = auth.uid()` branch is KEPT deliberately. The bucket's INSERT
-- policy is `is_approved()`, i.e. ANY approved user can upload — including the
-- `user`/`viewer` roles. Replacing the owner check with `is_planner()` alone
-- would take away those users' ability to delete their own uploads, which would
-- be a NARROWING, not a widening. Keeping both makes this purely additive: no
-- one loses access, planners gain it.
--
-- SCOPE: material-submittal only, as requested. `drawing-register` and
-- `progress-photos` still carry the original owner-or-admin rule and have the
-- same orphaning behaviour — to widen those too, add them to the array below
-- and re-run.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

-- Guard: this policy references is_planner() (added by
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
  foreach b in array array['material-submittal'] loop
    execute format('drop policy if exists %I on storage.objects', b || '_del');
    execute format(
      'create policy %I on storage.objects for delete using (bucket_id = %L and (owner = auth.uid() or is_planner()))',
      b || '_del', b);
  end loop;
end $$;

-- Verify (expects one row, qual naming is_planner):
--   select polname, pg_get_expr(polqual, polrelid) as using_expr
--   from pg_policy
--   where polrelid = 'storage.objects'::regclass and polname = 'material-submittal_del';
