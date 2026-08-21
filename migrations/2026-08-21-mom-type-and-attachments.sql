-- ============================================================================
-- Migration: MINUTES OF MEETING — meeting type + per-action attachments.
--
-- The second and last batch of mom-app parity. Run this whole file in the
-- Supabase SQL editor. Idempotent (safe to re-run).
--
-- Run 2026-08-21-mom-schema-carryover-distribute.sql FIRST — this file assumes
-- the columns it added.
--
-- Two things the standalone mom-app has that this module did not:
--   1. `meeting_type` on the minute. ⚠️ In mom-app this is not decoration: the
--      meetings list is GROUPED by it, which is what keeps a project's weekly
--      coordination minutes from being buried among its client meetings.
--   2. An attachment per action item — the photo or PDF someone tabled.
-- ============================================================================

-- ---- 0) Guard: fail readably rather than with "column does not exist" -------
do $$
begin
  if to_regclass('public.mom_items') is null then
    raise exception 'mom_items is missing — run migrations/2026-08-19-duration-scenarios-and-mom.sql first';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mom_items' and column_name = 'action_item'
  ) then
    raise exception 'run migrations/2026-08-21-mom-schema-carryover-distribute.sql first';
  end if;
  if to_regprocedure('public.is_writer()') is null then
    raise exception 'is_writer() is missing — run migrations/2026-07-21-viewer-readonly.sql first';
  end if;
  if to_regprocedure('public.is_planner()') is null then
    raise exception 'is_planner() is missing — run migrations/2026-06-30-workspaces-project-selector.sql first';
  end if;
end $$;


-- ============================================================================
-- 1) meeting_type
-- ============================================================================
-- ⚠️ FREE TEXT, NO CHECK CONSTRAINT — deliberately, and this is the opposite
--    call from `mom_items.type` in the previous migration. `type` has three
--    fixed values the PDF badges by name, so a typo there prints in the default
--    grey and nobody finds out until the sheet is issued. A meeting type is
--    project vocabulary ("Weekly Coordination", "Client Progress Meeting",
--    "Safety Toolbox") that nobody can enumerate up front — mom-app lets an
--    admin add one at runtime, and a CHECK would turn that into a migration.
--
-- ⚠️ The fragmentation risk a CHECK would have covered is handled in the UI
--    instead: the control offers the canonical starter list UNION every type
--    already used on this project, so the second person to minute a weekly
--    coordination meeting picks the existing spelling rather than inventing one.
--    That is the same construction the drawing register's `phaseOptions()` uses.
alter table meeting_minutes add column if not exists meeting_type text;

-- The meetings list groups by type and orders by date within each group.
create index if not exists meeting_minutes_type_idx
  on meeting_minutes (project_id, meeting_type, meeting_date desc);


-- ============================================================================
-- 2) Per-action attachment
-- ============================================================================
-- ⚠️ `attachment_url` HOLDS THE OBJECT PATH, NOT A URL, despite the name — which
--    is kept for parity with mom-app's column. The same deliberate mismatch as
--    `drawing_register.file_url`, and for the same reason: the bucket is PRIVATE,
--    so the only way to read the file is a short-lived signed URL minted on
--    demand. Storing a URL would store one that has already expired.
alter table mom_items add column if not exists attachment_url  text;
alter table mom_items add column if not exists attachment_name text;


-- ============================================================================
-- 3) Storage bucket
-- ============================================================================
-- ⚠️ PRIVATE. mom-app's bucket is PUBLIC and it stores
--    `/storage/v1/object/public/…` URLs, so anybody holding the link reads the
--    file with no login at all. That is not copied here: minutes attachments are
--    site photos and commercial documents, and every other bucket in this app is
--    private + signed-URL. Deliberate divergence from parity.
insert into storage.buckets (id, name, public)
values ('mom-attachments', 'mom-attachments', false)
on conflict (id) do nothing;

-- ⚠️ INSERT is `is_writer()`, NOT the `is_approved()` the 2026-06-18 buckets use.
--    That older rule predates the viewer-readonly work and lets a VIEWER upload
--    into a register they cannot write a row to — an orphan file by construction,
--    since they cannot attach it to anything. A new bucket has no legacy uploads
--    to protect, so it starts on the correct rule rather than inheriting the drift.
--
-- ⚠️ DELETE keeps the `owner = auth.uid()` branch beside `is_planner()`, matching
--    the settled rule on the other three buckets: a planner deleting an action
--    someone else attached to must actually remove the object, or the row goes and
--    the file is orphaned — while the uploader keeps the right to remove their own.
drop policy if exists mom_attachments_read on storage.objects;
create policy mom_attachments_read on storage.objects
  for select using (bucket_id = 'mom-attachments' and is_approved());

drop policy if exists mom_attachments_ins on storage.objects;
create policy mom_attachments_ins on storage.objects
  for insert with check (bucket_id = 'mom-attachments' and is_writer());

drop policy if exists mom_attachments_del on storage.objects;
create policy mom_attachments_del on storage.objects
  for delete using (
    bucket_id = 'mom-attachments' and (owner = auth.uid() or is_planner())
  );

-- Verify:
--   select id, public from storage.buckets where id = 'mom-attachments';
--   select polname, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
--   from pg_policy where polrelid = 'storage.objects'::regclass
--     and polname like 'mom_attachments%' order by polname;

-- Done.
