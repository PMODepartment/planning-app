-- ===========================================================================
-- Personal notebook — one planner's own notes, app-wide
-- 2026-09-15
--
-- Owner: *"let's also add a personal notebook in the app that saves … like a
-- sticky note that doesn't close when moving through pages. Collapsible but can
-- be opened somewhere within the page."*
--
-- "that saves" is the load-bearing word, and it is why this is a table rather
-- than localStorage: localStorage is per-BROWSER, so a note written on the
-- laptop is invisible on the desktop and gone the day the profile is cleared.
-- A planner who has been told their notes save will not discover otherwise
-- until they have lost some.
-- ===========================================================================

create table if not exists user_notes (
  id          uuid primary key default gen_random_uuid(),

  -- ⚠️⚠️ `default auth.uid()`, SO THE CLIENT NEVER SENDS IT. A note's owner is
  --    not a field the browser gets an opinion about: with the default here and
  --    the WITH CHECK below, writing a note onto somebody else's account is not
  --    something the app can express, rather than something it is trusted not
  --    to do. It also means the insert needs no session lookup at all.
  created_by  uuid not null default auth.uid() references users(id) on delete cascade,

  -- Optional: the project the planner was looking at when they wrote it. A tag,
  -- never a scope — the note belongs to the person, not the project.
  -- ⚠️ `on delete SET NULL`, never cascade: archiving a project must not delete
  --    somebody's own notes about it. That is the opposite of every other
  --    project_id in this schema, and it is deliberate.
  project_id  text references projects(id) on delete set null,

  -- ⚠️ The title is DERIVED from the first line by the app and stored, rather
  --    than asked for. A notebook that demands a title before you can write
  --    anything is a form, and people stop using it. Stored rather than
  --    re-derived on read so the list can be ordered and searched by it later
  --    without pulling every body.
  title       text,
  body        text,
  pinned      boolean not null default false,

  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- The list is "my notes, most recently touched first".
create index if not exists user_notes_owner_idx on user_notes (created_by, updated_at desc);

-- ---------------------------------------------------------------------------
-- RLS — ⚠️⚠️ OWNER ONLY, AND NOTABLY *NOT* is_admin()
-- ---------------------------------------------------------------------------
-- Every other table in this schema reads through `can_access_project()` and
-- several let `is_admin()` see everything. This one must not. These are a
-- person's private working notes — the place someone writes "call the client
-- about the delay, PM is being difficult" — and an admin silently able to read
-- them is a different product from the one the owner asked for. If a note needs
-- to be shared it belongs in the register it is about, not here.
alter table user_notes enable row level security;

drop policy if exists user_notes_own on user_notes;
create policy user_notes_own on user_notes
  for all to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- ⚠️⚠️ THE GRANT IS NOT THE POLICY. RLS filters rows for a role that already
--    holds the table privilege; it never confers it. Without this every query
--    fails with "permission denied for table user_notes", which reads like an
--    RLS problem and is not one. Omitted twice before in this repo (the
--    stakeholder directory, then 2026-09-10-scurve-manual-poc).
grant select, insert, update, delete on user_notes to authenticated;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--   select count(*) from user_notes;                      -- 0, and no error
--   select polname from pg_policy
--     where polrelid = 'user_notes'::regclass;            -- user_notes_own
--   select has_table_privilege('authenticated','user_notes','select');   -- t
--   -- and the one that matters: signed in as A, insert a note; signed in as B,
--   -- `select * from user_notes` returns 0 rows — including for an admin.
