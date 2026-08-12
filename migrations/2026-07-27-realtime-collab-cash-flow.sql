-- ============================================================================
-- Migration: enable Supabase Realtime for Cash Flow (PDCollab).
--
-- Cash Flow is a DERIVED projection whose editable inputs live across several
-- tables. Streaming these lets a co-editor's saved assumptions recompute every
-- other open client's projection live.
--
--   • cash_flow_settings        — the assumptions row (per project)
--   • cash_flow_actuals         — recorded real cash movements
--   • cash_flow_dp_tranches     — downpayment tranches
--   • cash_flow_trade_packages  — per-trade cash-in split
--
-- Presence (who's here) + the avatar "editing" indicator need NO server change —
-- only this live-value stream does. RLS still applies to Realtime.
--
-- (S-Curve reuses project_schedule, covered by
-- 2026-07-26-realtime-collab-project-schedule.sql. Portfolio Overview is
-- presence-only — no table stream, no migration.)
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'cash_flow_settings', 'cash_flow_actuals', 'cash_flow_dp_tranches', 'cash_flow_trade_packages'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;   -- skip if the table isn't created yet
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute 'alter publication supabase_realtime add table public.' || t;
    end if;
    execute 'alter table public.' || t || ' replica identity full';
  end loop;
end $$;
