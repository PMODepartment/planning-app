-- ============================================================================
-- Migration: PACKAGE-SCOPED SCHEDULING — named Builder setups per package,
--            a push history, and package roots in the WBS.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
-- ⚠️ Requires 2026-07-23-schedule-builder.sql, 2026-08-19-packages.sql and
--    2026-08-19-schedule-package.sql.
--
-- WHY
--   Owner, 2026-08-26: "For cases with projects that have multiple packages
--   let's modify the project schedule module to show this multiple packaged
--   project but tracked and monitored separately as a package. Each package will
--   have its own WBS and own activities depending on the scope of that package.
--   The schedule builder now will consider which package should it push and the
--   schedule builder should have an option to save schedules and go back to that
--   saved schedule."
--
--   A project like Avesta Residences is ONE project bought as Package 1 (Tower 1
--   and General Requirements) and Package 2 (Towers 2-7). Each is administered,
--   progressed, billed and disputed on its own, so each needs its own WBS branch,
--   its own builder setup, and its own push / import / clear.
--
-- ⚠️ THE PACKAGE AXIS AND THE CHANGE-ORDER AXIS STAY ORTHOGONAL. Owner's call,
--    same day: a change order BELONGS TO a package. package_id says which
--    contract lot; scope_type says main-contract vs change-order. A variation
--    raised against Package 2 is both, and the grid's Blended / Main / Change
--    orders control keeps working INSIDE whichever package is shown. Neither
--    column is ever derived from the other — see 2026-08-19-schedule-package.sql,
--    which exists to say exactly this.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) schedule_builder: one row per project → many named setups per package
-- ---------------------------------------------------------------------------
-- The old table was keyed by project_id alone, so a project could hold exactly
-- one builder state. That is the thing being fixed, so the primary key has to
-- move — carefully, because a live project already has a setup in it.
--
-- ⚠️ THE EXISTING ROW IS PRESERVED AND BECOMES A NAMED SETUP, never dropped.
--    A planner's builder state is hours of work; losing it to a migration would
--    be the most expensive possible way to add a feature.
-- ⚠️ NO package_id IS GUESSED for it. The existing setup predates packages, so
--    it lands with package_id NULL — "not yet assigned to a package", which is
--    honest and visible, rather than silently filed under whichever package
--    happens to sort first.
do $$
begin
  -- Fresh installs: nothing to migrate, the table below is created outright.
  if to_regclass('public.schedule_builder') is null then
    return;
  end if;
  -- Already migrated (id column present) → nothing to do.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'schedule_builder'
                and column_name = 'id') then
    return;
  end if;
  alter table schedule_builder drop constraint if exists schedule_builder_pkey;
  alter table schedule_builder add column id uuid not null default gen_random_uuid();
  alter table schedule_builder add primary key (id);
  alter table schedule_builder add column package_id uuid;
  alter table schedule_builder add column name text;
  alter table schedule_builder add column created_at timestamptz default now();
  alter table schedule_builder add column created_by uuid;
  -- The pre-existing setup keeps its config and gains a name that says what it is.
  update schedule_builder set name = 'Original setup' where name is null;
end $$;

create table if not exists schedule_builder (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  -- ⚠️ on delete set null, never cascade: retiring a package must not delete the
  --    setups that built its schedule. They become unassigned and visibly so.
  package_id  uuid references packages(id) on delete set null,
  name        text,
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz default now(),
  created_by  uuid,
  updated_at  timestamptz default now(),
  updated_by  uuid
);

-- The FK is added separately so BOTH paths above (migrated table, fresh table)
-- end up constrained the same way.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'schedule_builder_package_fk') then
    alter table schedule_builder add constraint schedule_builder_package_fk
      foreign key (package_id) references packages(id) on delete set null;
  end if;
end $$;

create index if not exists schedule_builder_project_idx on schedule_builder (project_id, package_id);
-- ⚠️ coalesce, because NULLs are DISTINCT in a unique index: without it a project
--    could hold five unassigned setups all called "Draft" and the picker would
--    show five identical rows.
create unique index if not exists schedule_builder_name_idx
  on schedule_builder (project_id, coalesce(package_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(coalesce(name, '')));

-- ---------------------------------------------------------------------------
-- 2) schedule_builder_pushes — what was pushed, from which setup, when
-- ---------------------------------------------------------------------------
-- "Go back to that saved schedule in case of any error" needs more than the
-- current config: it needs the config AS IT WAS at the moment of a push, because
-- the setup keeps being edited afterwards.
--
-- ⚠️ THE SNAPSHOT IS A FULL COPY OF config, not a reference to the setup row.
--    A pointer would follow later edits and quietly stop describing the schedule
--    it produced — which is exactly the failure this table exists to prevent.
-- ⚠️ setup_id is on delete SET NULL: deleting a setup must not erase the record
--    that a push happened. The snapshot stands on its own.
create table if not exists schedule_builder_pushes (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  setup_id    uuid references schedule_builder(id) on delete set null,
  package_id  uuid references packages(id) on delete set null,
  setup_name  text,
  config      jsonb not null,
  n_activities int,
  wbs_root_id uuid,
  note        text,
  pushed_at   timestamptz default now(),
  pushed_by   uuid
);
create index if not exists schedule_builder_pushes_project_idx
  on schedule_builder_pushes (project_id, pushed_at desc);

-- ---------------------------------------------------------------------------
-- 3) Access — unchanged shape, re-applied so both tables match the convention
-- ---------------------------------------------------------------------------
alter table schedule_builder        enable row level security;
alter table schedule_builder_pushes enable row level security;
grant select, insert, update, delete on schedule_builder        to authenticated;
grant select, insert, update, delete on schedule_builder_pushes to authenticated;

drop policy if exists schedule_builder_read  on schedule_builder;
drop policy if exists schedule_builder_write on schedule_builder;
create policy schedule_builder_read on schedule_builder
  for select using ( can_access_project(project_id) );
create policy schedule_builder_write on schedule_builder
  for all using ( is_writer() and can_access_project(project_id) )
          with check ( is_writer() and can_access_project(project_id) );

drop policy if exists schedule_builder_pushes_read  on schedule_builder_pushes;
drop policy if exists schedule_builder_pushes_write on schedule_builder_pushes;
create policy schedule_builder_pushes_read on schedule_builder_pushes
  for select using ( can_access_project(project_id) );
create policy schedule_builder_pushes_write on schedule_builder_pushes
  for all using ( is_writer() and can_access_project(project_id) )
          with check ( is_writer() and can_access_project(project_id) );

-- ---------------------------------------------------------------------------
-- 4) Package roots in the WBS
-- ---------------------------------------------------------------------------
-- The grid shows each package as a top-level row with its own WBS beneath, so a
-- package needs a real root node — not a filter. `wbs_nodes.package_id` already
-- exists (2026-08-19-schedule-package.sql) and the app creates the root on push;
-- this flag marks it as THE root for that package so a second push adopts it
-- instead of creating a sibling beside it.
--
-- ⚠️ A FLAG, NOT A NAME MATCH. Matching on the node's name would break the first
--    time someone renames "PKG-2 — Towers 2-7" to "Towers 2 to 7", and the next
--    push would silently build a second root holding half the schedule.
alter table wbs_nodes add column if not exists is_package_root boolean not null default false;

-- ⚠️ One root per package, enforced. Two roots is the failure mode that makes a
--    package total half-right, which is worse than an error at insert time.
create unique index if not exists wbs_nodes_package_root_idx
  on wbs_nodes (project_id, package_id) where is_package_root;

-- ---------------------------------------------------------------------------
-- 5) Verify
-- ---------------------------------------------------------------------------
--   select id, project_id, package_id, name from schedule_builder;
--        -- expect: every pre-existing row still here, named 'Original setup'
--   select column_name from information_schema.columns
--    where table_name = 'wbs_nodes' and column_name = 'is_package_root';   -- expect 1
--   select count(*) from schedule_builder_pushes;                          -- expect 0
--
-- No back-fill of package_id anywhere: an existing setup, activity or WBS node
-- belongs to no package until a planner says which, and guessing would file real
-- work under a contract lot nobody put it in.
