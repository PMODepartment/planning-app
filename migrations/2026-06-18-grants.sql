-- ============================================================================
-- Migration: table privileges (GRANTs) for the API roles.
-- Run in the Supabase SQL editor. Idempotent.
--
-- WHY: PostgREST queries run as the `authenticated` (logged-in) or `anon`
-- (logged-out) Postgres role. Those roles need table-level GRANTs IN ADDITION
-- to passing RLS — they are two separate checks. Without these grants every
-- request fails with "42501 permission denied for table ...", even for admins.
--
-- Security note: GRANTs only open the door; ROW-LEVEL SECURITY (already set up
-- in supabase-schema.sql) still decides which rows each user actually sees.
-- ============================================================================

grant usage on schema public to anon, authenticated;

-- Logged-in users: full DML on all app tables (RLS narrows it per user/project).
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Anonymous role needs no table access (login/registration go through Supabase
-- Auth; the profile insert on sign-up runs as `authenticated`). Leave anon with
-- no table grants.

-- Make sure tables added LATER by module developers are auto-granted too.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
