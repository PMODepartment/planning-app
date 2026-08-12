-- ============================================================================
-- Migration: enable Supabase Realtime for Progress Photos (PDCollab).
--
-- Companion to 2026-07-26-realtime-collab.sql (drawing_register),
-- 2026-07-26-realtime-collab-project-schedule.sql,
-- 2026-07-26-realtime-collab-material-submittal.sql and
-- 2026-07-26-realtime-collab-registers.sql. Wires live-value streaming for
-- progress_photos: another user uploads / edits / deletes a photo → every other
-- open client patches its gallery live (the new photo's preview is signed on the
-- change; images themselves still need a connection).
--
-- Presence (who's here) + the "who's editing this photo" cursor need NO server
-- change — only this live-value stream does. RLS still applies to Realtime, so a
-- client only receives changes for rows it can already SELECT.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'progress_photos'
  ) then
    execute 'alter publication supabase_realtime add table public.progress_photos';
  end if;
end $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE payloads carry every column — including
-- project_id, which the client subscription filters on (project_id=eq.<pid>).
alter table public.progress_photos replica identity full;
