-- One-call schedule fetch RPC (Project Schedule cold-load speedup)
-- ------------------------------------------------------------------------------------------------
-- Loading a big schedule was dominated by ~8 sequential keyset-paginated round-trips (measured:
-- ~8.9s for a 6k-activity project), because PostgREST caps each table read at 1000 rows. This
-- function returns ALL of a project's activity rows as a SINGLE jsonb array in ONE round-trip:
-- a SCALAR (jsonb) return is not subject to the max-rows cap, so the whole schedule comes back at
-- once. The client (modules/project-schedule) calls this first and falls back to keyset pagination
-- if the function is absent, so it is safe to deploy the client before or after this migration.
--
-- SECURITY INVOKER (the default) → the function runs as the CALLER, so Row-Level Security on
-- project_schedule still applies: a user only receives rows for projects they can access. Do NOT
-- change this to SECURITY DEFINER — that would bypass RLS and leak cross-project data.
--
-- Idempotent: create-or-replace + a re-granted execute privilege. Safe to run multiple times.

create or replace function public.schedule_rows(p_project_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  from public.project_schedule t
  where t.project_id = p_project_id;
$$;

-- Logged-in app users authenticate via Supabase Auth, so their requests run as `authenticated`.
grant execute on function public.schedule_rows(text) to authenticated;
