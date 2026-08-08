-- ============================================================================
-- Migration: enable Supabase Realtime for the Material Submittal Log (PDCollab).
--
-- Companion to 2026-07-26-realtime-collab.sql (drawing_register) and
-- 2026-07-26-realtime-collab-project-schedule.sql. Wires live-value streaming
-- for material_submittal: another user saves / bulk-updates a submittal → every
-- other open client patches its log live.
--
-- Presence (who's here) + the "who's editing this submittal" cursor need NO
-- server change — only this live-value stream does. RLS still applies to
-- Realtime, so a client only receives changes for rows it can already SELECT.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'material_submittal'
  ) then
    execute 'alter publication supabase_realtime add table public.material_submittal';
  end if;
end $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE payloads carry every column — including
-- project_id, which the client subscription filters on (project_id=eq.<pid>).
alter table public.material_submittal replica identity full;
