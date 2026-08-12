-- ============================================================================
-- Migration: enable Supabase Realtime for the Project Schedule (PDCollab).
--
-- Companion to 2026-07-26-realtime-collab.sql (which did drawing_register).
-- Wires live-value streaming for project_schedule: another user saves an
-- activity → every other open client patches its grid live.
--
-- Presence (who's here) + cursor broadcast (which cell someone edits) need NO
-- server change — only this live-value stream does. RLS still applies to
-- Realtime, so a client only receives changes for rows it can already SELECT.
--
-- NOTE ON SCALE: project_schedule is large (tens of thousands of rows) and P6/XER
-- imports insert ~40k rows at once. That fans out as ~40k change events; the
-- client COALESCES them and, past a threshold, does ONE reload instead of
-- per-row patching (see the module's _flushCollab storm guard). So this is safe,
-- but do not add REPLICA IDENTITY FULL to other high-write tables unless their
-- module actually consumes the stream.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_schedule'
  ) then
    execute 'alter publication supabase_realtime add table public.project_schedule';
  end if;
end $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE payloads carry every column — including
-- project_id, which the client subscription filters on (project_id=eq.<pid>).
-- The default (primary key only) omits project_id, so filtered UPDATE/DELETE
-- events would never reach the subscriber. (INSERTs are unaffected — the new row
-- is always sent in full.)
alter table public.project_schedule replica identity full;
