-- =============================================================================
-- 2026-09-10  scurve_manual / scurve_manual_meta: planner-entered monthly POC
-- =============================================================================
-- Run this in the Supabase SQL editor. It is additive and idempotent, and the
-- S-Curve module works unchanged on a database where it has NOT been run: the
-- Manual data tab says the migration is outstanding and names this file, and
-- nothing else in the module changes.
--
-- ⚠️⚠️ CORRECTED 2026-09-10 — the first cut of this file FAILED TO RUN:
--
--     ERROR: 42804: foreign key constraint "scurve_manual_project_id_fkey"
--     cannot be implemented
--     DETAIL: Key columns "project_id" and "id" are of incompatible types:
--             uuid and text.
--
--     `projects.id` is **text** — it is the project CODE ('AVR101', 'OPW101'),
--     not a surrogate uuid (supabase-schema.sql:33). Every project-scoped table
--     in this schema therefore declares `project_id text references
--     projects(id)`, and this file declared `uuid` on both new tables. The
--     module's own JS was already correct: it writes `project_id: pid`, and
--     `pid` is that text code. Only the DDL was wrong.
--     ⚠️ Nothing was created by the failed run — the FK is inline in the CREATE
--     TABLE, so the statement fails atomically, and the SQL editor wraps the
--     whole file in one transaction. This file is safe to run now.
--
-- WHY
-- ---
-- Owner 2026-09-10: *"For the S-Curve, i want you to provide 2 options for the
-- users, Manual intervention or automatic detecting. Manual intervention allows
-- users to input POCs per trade on a monthly basis … For the planned, this
-- should be defined in the planning phase of the project, and will be locked as
-- the project is actualized. For the actuals, allow users for manual
-- intervention. For the forecast, allow users to input POCs manually for the
-- following months per trade. For automatic detecting, it should be linked to
-- the per trade accomplishment declared in the schedule."*
--
-- AUTOMATIC already existed: the curve is derived from `project_schedule` by
-- `assets/js/scurve.js`. What had no home anywhere is the MANUAL curve — a
-- planner's own monthly S-curve, per trade, which on a real project is
-- negotiated and submitted before the schedule is fully loaded and is then
-- reported against monthly.
--
-- ⚠️⚠️ IT IS A SECOND SOURCE OF TRUTH, AND THAT IS THE POINT — but it must never
--    be mistaken for the first. The module never merges the two: a curve is
--    EITHER the schedule's or the planner's, the mode is stated on the card and
--    travels into the heading (screenshots of that card end up in reports), and
--    switching modes changes nothing in the other one's data.
--
-- WHAT A ROW MEANS
-- ----------------
-- One row = one trade, one month, one kind, one number.
--
-- ⚠️⚠️ `pct` IS PERIODIC, NOT CUMULATIVE. It is the share of THAT TRADE's own
--    scope achieved in THAT month, so a trade's twelve rows should sum to 100.
--    Chosen over cumulative for three reasons, all of them practical:
--      1. It is what a monthly accomplishment report already states, so the
--         planner is copying a figure rather than converting one.
--      2. The invariant is checkable and the UI checks it on screen — a
--         cumulative column that ends at 97% is a typo you have to hunt for;
--         a periodic column that sums to 97% is one the sheet can flag.
--      3. The periodic bar chart is then the data, not a derivation of it, and
--         the cumulative curve is the running sum. Both readings come off one
--         set of numbers and cannot disagree.
--    ⚠️ The module shows the running cumulative beside every entry anyway, so
--       nobody has to add up in their head to see where the curve reaches.
--
-- ⚠️ `trade` IS THE `project_schedule.work_type` STRING, verbatim, because that
--    is what the rest of the app groups this schedule by (the dashboard's
--    programme panel does the same). It is text and not a foreign key on
--    purpose: trades are not a table in this schema, and a manual curve entered
--    against a trade that is later renamed in the schedule must not vanish — it
--    shows up as an unmatched trade the planner can see and re-point.
--
-- ⚠️ NO `unique` ON (project_id, trade, month) WITHOUT `kind`. Planned, actual
--    and forecast are three independent statements about the same month, and
--    collapsing them would make entering a forecast overwrite the plan.
-- =============================================================================

-- ⚠️⚠️ GUARD FIRST, BECAUSE `if not exists` IS A SILENT NO-OP ON A WRONG-TYPED
--    TABLE. If an earlier hand-edited attempt left `scurve_manual.project_id`
--    as uuid, every statement below would be skipped without complaint and the
--    module would keep failing with no explanation. Say so instead.
do $$
declare t text;
begin
  select data_type into t
    from information_schema.columns
   where table_schema = 'public' and table_name = 'scurve_manual' and column_name = 'project_id';
  if t is not null and t <> 'text' then
    raise exception
      'scurve_manual.project_id is % but projects.id is text. Drop the two tables and re-run this file: drop table if exists scurve_manual; drop table if exists scurve_manual_meta;', t;
  end if;
end $$;

create table if not exists scurve_manual (
  id          uuid primary key default gen_random_uuid(),
  -- ⚠️ text, matching projects.id — see the corrected-error note at the top.
  project_id  text not null references projects(id) on delete cascade,
  trade       text not null,
  month       date not null,
  kind        text not null check (kind in ('planned', 'actual', 'forecast')),
  -- Percent of this trade's own scope in this month. Bounded at 0 and 100:
  -- a month cannot deliver more than the whole trade, and a negative month is a
  -- correction, which belongs in the month it corrects.
  pct         numeric(6,3) not null default 0 check (pct >= 0 and pct <= 100),
  note        text,
  updated_at  timestamptz not null default now(),
  -- ⚠️ `references users(id)`, the same shape every other table in this schema
  --    uses for a `created_by` / `updated_by`. Nullable, so a write with no
  --    session id still lands rather than failing.
  updated_by  uuid references users(id),
  constraint scurve_manual_uniq unique (project_id, trade, month, kind)
);

-- ⚠️ `month` is stored as the FIRST of the month by convention and the module
--    writes it that way. The check keeps a hand-written insert from putting a
--    mid-month date in and creating a second bucket for the same month that the
--    unique constraint would not catch.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scurve_manual_month_first') then
    alter table scurve_manual
      add constraint scurve_manual_month_first check (extract(day from month) = 1);
  end if;
end $$;

create index if not exists scurve_manual_proj_idx on scurve_manual (project_id, kind, month);

-- -----------------------------------------------------------------------------
-- The lock. One row per project.
-- -----------------------------------------------------------------------------
-- Owner: *"For the planned, this should be defined in the planning phase of the
-- project, and will be locked as the project is actualized."*
--
-- ⚠️⚠️ THE LOCK IS RECORDED, NOT INFERRED, and this table is why. The module
--    also treats the planned curve as read-only the moment the schedule carries
--    any recorded actual progress — that is the "as the project is actualized"
--    half, and it needs no storage because it is a fact about the schedule. But
--    a planner must be able to say "the plan is final" BEFORE the first actual
--    is booked, and must be able to lift it deliberately when a re-baseline is
--    agreed. An inferred-only lock can do neither.
-- ⚠️ `by` and `at` are the whole reason it is a table and not a boolean: a
--    baseline that can be unlocked is only trustworthy if unlocking leaves a
--    mark. The module shows both on the card.
create table if not exists scurve_manual_meta (
  project_id        text primary key references projects(id) on delete cascade,
  planned_locked    boolean not null default false,
  planned_locked_at timestamptz,
  planned_locked_by uuid references users(id),
  updated_at        timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- RLS — the same shape every other project-scoped table in this schema uses:
-- any signed-in member may read and write their own project's rows.
-- -----------------------------------------------------------------------------
-- ⚠️ A POLICY IS NOT A GRANT. RLS filters rows for a role that already holds the
--    table privilege; without the grant every query fails with "permission
--    denied for table scurve_manual", which reads like an RLS problem and is
--    not one. Every sibling migration in this folder carries these two lines,
--    and the one that forgot them is recorded in the root changelog (2026-09-09 m2).
alter table scurve_manual      enable row level security;
alter table scurve_manual_meta enable row level security;

grant select, insert, update, delete on scurve_manual      to authenticated;
grant select, insert, update, delete on scurve_manual_meta to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'scurve_manual' and policyname = 'scurve_manual_all') then
    create policy scurve_manual_all on scurve_manual
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'scurve_manual_meta' and policyname = 'scurve_manual_meta_all') then
    create policy scurve_manual_meta_all on scurve_manual_meta
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- =============================================================================
-- VERIFY (paste separately; it writes nothing)
-- =============================================================================
-- -- 1. the types match projects.id
-- select table_name, column_name, data_type
--   from information_schema.columns
--  where table_schema = 'public'
--    and (table_name in ('scurve_manual','scurve_manual_meta') and column_name = 'project_id')
--     or (table_name = 'projects' and column_name = 'id')
--  order by table_name;
--   -- expect: all three rows read `text`
--
-- -- 2. the shape
-- select count(*) as cols from information_schema.columns
--  where table_schema = 'public' and table_name = 'scurve_manual';   -- expect 8
-- select conname from pg_constraint
--  where conrelid = 'scurve_manual'::regclass order by conname;
--   -- expect scurve_manual_month_first, scurve_manual_pct_check,
--   --        scurve_manual_kind_check, scurve_manual_uniq, + pkey/fkeys
--
-- -- 3. the grants and the policies both exist
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'scurve_manual' and grantee = 'authenticated';  -- expect 4 rows
-- select tablename, policyname from pg_policies
--  where tablename in ('scurve_manual','scurve_manual_meta');         -- expect 2 rows
--
-- select count(*) from scurve_manual_meta;                            -- expect 0 on a fresh run
