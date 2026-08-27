-- ============================================================================
-- Migration: a contract package carries the CODES IT BUYS UNDER
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
-- ⚠️ Requires 2026-08-19-packages.sql.
--
-- WHY — the gap this closes, stated plainly
--   Owner, 2026-08-27: "How should we resolve this especially in connecting the
--   procurement from AVR102? Currently AVR101's schedule covers all 7 towers and
--   general requirements."
--
--   Two axes that do not line up:
--     · THE WORK is one construction sequence — shared tower cranes, shared
--       general requirements, predecessors running between towers. One schedule.
--     · THE MONEY is two contracts — AVR101 and AVR102 — each with its own
--       procurement scope, its own billing and its own claims, and each existing
--       as its own project in the Procurement (WPM) and Engineering apps.
--
--   Everything in this app is scoped by `projects.id`, so it forced those two to
--   be the same thing. The result: AVR101's schedule holds AVR102's work, while
--   AVR102's work packages sit in a WPM project nothing in that schedule maps to.
--
--   The join that was missing is HERE, on the package. A package already says
--   *what work*; these columns say *which contract buys it*.
--
-- THE MODEL THIS SETTLES (see planning-app/CLAUDE.md for the full write-up)
--   1. A Planners project = a contract code. AVR101 and AVR102 both stay — WPM
--      and Engineering key on the code, and merging them breaks the 1:1 that
--      every cross-app push relies on.
--   2. A schedule belongs to a DEVELOPMENT, not to a code. One project hosts it.
--   3. Each contract lot inside that schedule is a `package` on the host, named
--      for its SCOPE ("Towers 2-7"), never for a project code.
--   4. The package carries the codes it maps to. That is this migration.
--
-- ⚠️ WHY NOT NAME THE PACKAGE AFTER THE CODE. Because that is the exact shape
--    refused on 2026-08-27 — a package called AVR102 inside project AVR101 makes
--    one contract lot exist twice inside one app, and every per-package total
--    then double-counts or splits depending on which identity a report read. The
--    scope description and the contract code are DIFFERENT FACTS and get
--    different fields. That is what makes the guard and this column consistent
--    rather than in tension.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) The three mappings
-- ---------------------------------------------------------------------------
-- ⚠️ ALL NULLABLE, NOTHING BACK-FILLED, and that is the safety property that
--    makes this deployable on every project at once: a package with no mapping
--    behaves exactly as it does today (the schedule falls back to the
--    project-level `cash_flow_settings.wpm_project_id`). Only a package someone
--    deliberately maps changes anything.

-- The Procurement (WPM) project whose work packages fund this lot.
-- ⚠️ Free text, no FK — WPM is a SEPARATE Supabase project (cayjeqeleenizbdzrums)
--    and Postgres cannot reference across databases. Same call as
--    cash_flow_settings.wpm_project_id, which this deliberately mirrors rather
--    than re-inventing: two columns meaning "which WPM project" that could
--    disagree is worse than one that is sometimes blank.
alter table packages add column if not exists wpm_project_id text;

-- The Engineering app's project id for this lot.
-- ⚠️ Engineering currently reuses the Planners project id verbatim (see
--    supabase/functions/push-packages), so this is blank on every existing
--    package and the push keeps its present behaviour until one is set.
alter table packages add column if not exists eng_project_id text;

-- The SIBLING PLANNERS PROJECT that holds this lot's own commercial record.
-- AVR102's contract, claims, billing and cash flow live on the AVR102 project;
-- its WORK lives in AVR101's schedule. This is the link between the two.
-- ⚠️ A real FK, unlike the two above, because both rows live in THIS database —
--    and `on delete set null`, never cascade: deleting a project must not delete
--    the package that describes a scope division of somebody else's schedule.
-- ⚠️ It is NOT a parent/child link and must not be read as one. It says "this
--    lot's paperwork is filed over there", not "this project belongs to that
--    one" — a hierarchy is what produced the nesting this whole model removes.
alter table packages add column if not exists planners_project_id text
  references projects(id) on delete set null;

comment on column packages.wpm_project_id is
  'Procurement (WPM) project id this lot buys under. Blank = fall back to the '
  'host project mapping in cash_flow_settings.wpm_project_id. Set it when one '
  'schedule spans several contract codes (AVR101 hosting AVR102 work).';
comment on column packages.eng_project_id is
  'Engineering app project id for this lot. Blank = the Planners project id, '
  'which is what push-packages already uses.';
comment on column packages.planners_project_id is
  'The sibling Planners project holding this lot''s own contracts, claims and '
  'billing. NOT a parent/child link — the projects stay peers.';

-- ---------------------------------------------------------------------------
-- 2) Indexes
-- ---------------------------------------------------------------------------
-- The schedule asks "which WPM projects does this project's packages map to?"
-- once per load, and the cross-app pushes ask it per package.
create index if not exists packages_wpm_project_idx on packages (wpm_project_id)
  where wpm_project_id is not null;
create index if not exists packages_planners_project_idx on packages (planners_project_id)
  where planners_project_id is not null;

-- ---------------------------------------------------------------------------
-- 3) A guard rail, as a REPORT rather than a constraint
-- ---------------------------------------------------------------------------
-- ⚠️ NOT a CHECK constraint, deliberately. Two packages of one project pointing
--    at the same WPM project is a mistake almost every time — but it is legal
--    while someone is halfway through re-mapping a development, and a constraint
--    would refuse the save and lose their work rather than telling them. The
--    same reasoning as boq_progress's claimed-vs-certified: report the anomaly,
--    never block the write.
create or replace view package_mapping_conflicts as
  select p.project_id,
         p.wpm_project_id,
         count(*)                      as packages_sharing_it,
         string_agg(p.code, ', ' order by p.code) as codes
    from packages p
   where p.wpm_project_id is not null
     and p.status <> 'archived'
   group by p.project_id, p.wpm_project_id
  having count(*) > 1;

-- security_invoker so the caller's RLS on `packages` applies — a view is
-- otherwise evaluated as its owner and would leak other projects' packages.
alter view package_mapping_conflicts set (security_invoker = true);
grant select on package_mapping_conflicts to authenticated;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
-- No policy change. `packages` already carries read = can_access_project and
-- write = is_planner() and can_access_project (2026-08-19-packages.sql); new
-- columns inherit them.
