-- ============================================================================
-- Per-user module access override.
--
-- Owner, 2026-09-15, on the admin page: "provide options to change module
-- access for users with button to reset to default."
--
-- ⚠️ WHAT "DEFAULT" MEANS. Module visibility today is entirely role-based:
--    `config.js`'s `MODULES[].superAdminOnly` flag hides a module from every
--    role but `super_admin` (see the flag's own comment there, added
--    2026-09-03). That rule is untouched and stays the DEFAULT for every
--    user — this migration adds one nullable column that, when set, OVERRIDES
--    it for one specific user, in either direction (can grant access to a
--    role-restricted module, or withhold a module a role would normally see).
--
-- ⚠️ NULL IS THE "NO OVERRIDE" STATE, ON PURPOSE — not an empty array.
--    An empty array (`{}`) is a real, meaningful value: "this user gets NO
--    modules." NULL is the only value that can honestly mean "nothing has
--    been decided here, fall back to the role default," which is what
--    "Reset to default" writes. Distinguishing the two is why this is not a
--    boolean-per-module design — a nullable array lets the UI (and any future
--    reader) tell "never touched" apart from "deliberately set to nothing"
--    with a single `is null` check, rather than a second flag column.
--
-- ⚠️ STORES MODULE KEYS (`config.js` `MODULES[].key`, e.g. 'risk-register'),
--    never module NAMES — a renamed module's display label must not silently
--    orphan every user's override the way it would if this stored `name`.
--
-- No RLS/grant change needed: `users_admin_update` (supabase-schema.sql) is a
-- plain row-level policy with no column list, so it already covers this
-- column exactly as it already covers `role`/`status`/`projects`; likewise
-- `users_self_read` already lets a signed-in user read their own row,
-- `module_access` included, which is what lets the client apply the override
-- to its own session without a separate fetch.
--
-- Idempotent: `if not exists` throughout, safe to re-run.
-- ============================================================================

alter table public.users add column if not exists module_access text[];

comment on column public.users.module_access is
  'Override of the role-based module visibility in config.js MODULES[].
   NULL = no override, role default applies (the historical behavior).
   A (possibly empty) array = the exact set of module keys this user may
   see, replacing the role default entirely. Set back to NULL to reset.';

-- Verify: column exists, nullable, text[].
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'users' and column_name = 'module_access';
