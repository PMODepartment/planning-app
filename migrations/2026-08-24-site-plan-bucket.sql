-- ============================================================================
-- Equipment Loading — storage for the site development plan image
-- 2026-08-24
--
-- The Site Plan view draws each tower as a shape over the project's own site
-- development plan. The plan itself is an image, so it needs a bucket.
--
-- ⚠️ PRIVATE, like every other bucket in this app. A site development plan shows
-- a client's site layout; a public bucket hands it to anyone holding the link,
-- with no login. equipment_site_plan.plan.image_path stores the object PATH and
-- the module signs a short-lived URL on demand — the same construction the
-- drawing register uses, and the reason it does NOT store a URL (a stored one
-- expires and is then useless).
--
-- ⚠️ Objects are laid out as <project_id>/plan-<timestamp>.<ext>, and the policies
-- below are NOT project-scoped: storage.objects has no project column to join on,
-- so the gate is the app's own role check. Anyone approved and not a viewer can
-- upload; the module only ever reads the path stored on a row the caller's RLS
-- already let them read.
--
-- INSERT is is_writer() (approved, not a viewer) rather than the older is_approved()
-- the 2026-06-18 buckets use: that predates viewer-readonly and lets a viewer upload
-- into a plan they cannot write a row for — an orphan by construction. DELETE keeps
-- the owner branch beside is_planner(), matching the settled rule on the other buckets.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('site-plans', 'site-plans', false)
on conflict (id) do nothing;

do $$
begin
  if to_regprocedure('public.is_writer()') is null then
    raise exception 'is_writer() is missing — run migrations/2026-07-21-viewer-readonly.sql first';
  end if;
end $$;

drop policy if exists site_plans_read on storage.objects;
create policy site_plans_read on storage.objects
  for select using (bucket_id = 'site-plans' and public.is_approved());

drop policy if exists site_plans_insert on storage.objects;
create policy site_plans_insert on storage.objects
  for insert with check (bucket_id = 'site-plans' and public.is_writer());

drop policy if exists site_plans_update on storage.objects;
create policy site_plans_update on storage.objects
  for update using (bucket_id = 'site-plans' and public.is_writer());

-- Replacing a plan deletes the object it replaced, and the person replacing it is
-- rarely the person who uploaded it — hence is_planner() beside the owner branch.
drop policy if exists site_plans_delete on storage.objects;
create policy site_plans_delete on storage.objects
  for delete using (bucket_id = 'site-plans' and (owner = auth.uid() or public.is_planner()));
