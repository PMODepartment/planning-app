-- ============================================================================
-- Migration: enable Supabase Realtime for Productivity Rates (PDCollab).
--
-- Companion to the other 2026-07-26 realtime-collab migrations. This module
-- spans TWO tables, so BOTH are streamed: another user adds/edits an activity
-- or its monthly entries → every other open client patches its register +
-- monitoring live.
--
-- Presence (who's here) + the "who's editing this activity" cursor need NO
-- server change — only this live-value stream does. RLS still applies to
-- Realtime, so a client only receives changes for rows it can already SELECT.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['productivity_activities', 'productivity_entries'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute 'alter publication supabase_realtime add table public.' || t;
    end if;
  end loop;
end $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE payloads carry every column — including
-- project_id (the subscription filter) and, for entries, activity_id (needed to
-- locate the row's bucket client-side on DELETE).
alter table public.productivity_activities replica identity full;
alter table public.productivity_entries    replica identity full;
