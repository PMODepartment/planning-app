-- ============================================================================
-- Migration: enable Supabase Realtime for the modal-edit registers (PDCollab).
--
-- Companion to the drawing_register / project_schedule / material_submittal
-- realtime migrations. Wires the live-value stream (another user saves → my grid
-- updates) for the four modal-edit registers:
--   risk_register, issues_lessons, contracts_claims, stakeholder_map
--
-- Presence (who's here) + the "who's editing this row" cursor need NO server
-- change — only this live-value stream does. RLS still applies to Realtime, so a
-- client only receives changes for rows it can already SELECT.
--
-- (resource-loading is intentionally NOT here: it's low-traffic master data wired
-- for presence + offline only, with no live-value stream — so its tables
-- resources / resource_roles / calendars are left out on purpose.)
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['risk_register','issues_lessons','contracts_claims','stakeholder_map']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    -- REPLICA IDENTITY FULL so UPDATE/DELETE payloads carry project_id (the client
    -- filter is project_id=eq.<pid>); the default (PK only) omits it.
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
