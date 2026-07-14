-- Grant table privileges to service_role -------------------------------------
-- The original schema granted DML only to `authenticated` (app users run as that
-- role under RLS). Server-side code using the new `sb_secret_…` key runs as
-- `service_role`, which was never granted on these tables → "permission denied
-- for table users" / failed mirror writes from the sync-wpm Edge Function.
-- This grants service_role full DML on existing + future public tables.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
