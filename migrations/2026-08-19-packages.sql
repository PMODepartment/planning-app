-- ============================================================================
-- Migration: PACKAGES — a contract package lives INSIDE a project.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- WHAT THIS IS
--   Project → Package → (eventually) module records. A package is a contract
--   package / lot within one project: "Package 1 — Substructure", "PKG-03 —
--   MEPF Fit-out". It is a real entity with its own code, dates and contract
--   amount, not a label typed onto rows.
--
-- ⚠️ WHAT THIS IS *NOT*: the Main-Contract vs Change-Order split.
--   That axis already exists and is deliberately NOT a package — see
--   2026-08-19-schedule-contract-scope.sql: `scope_type` is a TAG on an
--   activity/WBS node so a change order can sit inside the construction
--   sequence where the WORK is, while still reporting where the MONEY comes
--   from. Packages are the orthogonal axis: WHICH contract package the work
--   belongs to. An activity can be "Package 2" AND "change_order"; forcing one
--   of those to model the other is what this note exists to prevent.
--
-- ⚠️ SCOPE OF THIS MIGRATION: it creates the entity and its access rules only.
--   No module table gets a `package_id` yet, and nothing is back-filled. Module
--   adoption is per-module and deliberate — a `package_id` added to a module
--   table before that module's UI can set it produces rows that belong to no
--   package and silently vanish from any package-filtered view.
-- ============================================================================

-- ---- 1) The table ----------------------------------------------------------
create table if not exists packages (
  id              uuid primary key default gen_random_uuid(),
  -- Cascade: a package cannot outlive its project. admin_delete_project already
  -- refuses while real work exists, so this only ever fires on an empty project.
  project_id      text not null references projects(id) on delete cascade,
  -- The planner's own package number off the contract documents ("PKG-01",
  -- "P2"). Unique WITHIN a project, never globally — two projects both having a
  -- "Package 1" is the normal case, not a clash.
  code            text not null,
  name            text not null,
  description     text,
  -- Same vocabulary as projects.status, so "archived" means the same thing at
  -- both levels and one filter idiom works for both.
  status          text default 'active' check (status in ('active', 'archived')),
  sort_order      int  default 0,
  start_date      date,
  end_date        date,
  contract_amount numeric,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Case-insensitive: "PKG-01" and "pkg-01" are the same package to a human, and
-- letting both exist splits every future package-scoped total in two.
create unique index if not exists packages_project_code_idx
  on packages (project_id, lower(code));
create index if not exists packages_project_idx on packages (project_id, sort_order);

-- ---- 2) Access -------------------------------------------------------------
-- Identical shape to every project-scoped module table (see
-- 2026-07-21-rls-project-scope-fix.sql): read follows project access, write
-- additionally requires planner. A viewer must never create a package.
alter table packages enable row level security;

drop policy if exists packages_read on packages;
create policy packages_read on packages
  for select using (can_access_project(project_id));

drop policy if exists packages_write on packages;
create policy packages_write on packages
  for all using (is_planner() and can_access_project(project_id))
       with check (is_planner() and can_access_project(project_id));

grant select, insert, update, delete on packages to authenticated;

-- ---- 3) Keep updated_at honest --------------------------------------------
-- The dashboard reports "last activity" per project from these timestamps; an
-- updated_at that only ever records the INSERT would quietly report a package
-- edited this morning as untouched since it was created.
create or replace function packages_touch_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists packages_touch on packages;
create trigger packages_touch before update on packages
  for each row execute function packages_touch_updated_at();

-- ---- 4) No seed ------------------------------------------------------------
-- Deliberately NOT inventing a "Main Package" for every existing project. A
-- project with no packages is a truthful state ("nobody has broken this one
-- down yet"), and the app says exactly that. A seeded placeholder would instead
-- assert a package structure that no planner agreed to, and every later real
-- package would have to be reconciled against it.

-- Done. Packages are readable/writable; module adoption comes per module.
