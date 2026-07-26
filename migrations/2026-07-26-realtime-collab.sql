-- ============================================================================
-- Migration: enable Supabase Realtime for live collaboration (PDCollab).
--
-- Presence (who's here) and cursor broadcast (which cell someone is editing)
-- work with NO server change — they ride the Realtime websocket directly.
-- Only the LIVE-VALUE stream (postgres_changes: another user saved → my grid
-- updates) needs the table added to the `supabase_realtime` publication.
--
-- RLS still applies to Realtime: a client only receives change events for rows
-- it is already allowed to SELECT, so this exposes nothing new.
--
-- Scope: drawing_register only — the proving ground for the shared collab layer.
-- Extend to project_schedule / material_submittal / risk_register / etc. as each
-- module is wired (one `add table` + `replica identity full` per table). NOTE:
-- project_schedule is a very high-row, high-write table, so only add it when its
-- collaboration is actually built (REPLICA IDENTITY FULL adds a little WAL per
-- UPDATE) — not preemptively.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'drawing_register'
  ) then
    execute 'alter publication supabase_realtime add table public.drawing_register';
  end if;
end $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE change payloads carry every column —
-- including project_id, which the client subscription filters on
-- (filter: project_id=eq.<pid>). The default (primary key only) omits project_id,
-- so a filtered DELETE/UPDATE would never reach the subscriber.
alter table public.drawing_register replica identity full;
