-- ---------------------------------------------------------------------------
-- BOQ allocations gain a SCOPE: a line may be allocated across activities, or
-- to the PROJECT as a whole.
--
-- Owner, 2026-09-10, on OPW101: 122 General Requirement lines — Mobilization,
-- Demobilization, Rental of Skidloader, Barracks, Site Office — every one coded,
-- against a schedule whose 2,561 activities are every one coded, and NOT ONE
-- candidate between them. That is not a matching failure. Those are TIME-RELATED
-- PRELIMINARIES, and a structural programme has no activity called "Rental of
-- Flat Bed Truck".
--
-- Until now `activity_id` was `not null`, so the only way to record such a line
-- was to attach it to an activity it does not belong to — inventing a
-- relationship that flows into project_schedule.planned_cost, then into
-- schedule_scurve_agg's w_cost, then into Cash Flow. So planners left them
-- unallocated instead, and `boqDerive` drops a line with no allocations
-- outright (project-schedule/index.html: `if (!list.length) return;`).
--
-- MEASURED CONSEQUENCE: those 122 lines are inside the contract sum and
-- contribute EXACTLY ZERO to the cost-loaded S-curve. This migration is what
-- lets them carry their money without lying about where the work is.
--
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- ---------------------------------------------------------------------------

-- 1 · the column ------------------------------------------------------------
-- ⚠️ DEFAULT 'activity', so every existing row keeps exactly the meaning it has
--    today and nothing downstream changes when this runs. A default of 'project'
--    would retroactively reclassify every allocation in the database.
alter table boq_allocations
  add column if not exists scope text not null default 'activity';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'boq_allocations_scope_chk') then
    alter table boq_allocations
      add constraint boq_allocations_scope_chk check (scope in ('activity', 'project'));
  end if;
end $$;

-- ⚠️ 'wbs' IS DELIBERATELY NOT IN THAT LIST. A branch-scoped allocation is a
--    plausible third case (a tower's own site office), but nothing in the UI can
--    produce one — and this module's own history records the trap of adding a
--    pointer before the screen that sets it: rows that belong to nothing and
--    vanish from every filtered view. Add it with its UI, not before.

-- 2 · activity_id becomes nullable -------------------------------------------
-- ⚠️ NULL here means "no activity, by design", never "not filled in yet". The
--    CHECK below is what keeps those two apart: a row is either an activity
--    allocation WITH an activity, or a project allocation WITHOUT one. There is
--    no third state, so a NULL can never be read as a missing value.
alter table boq_allocations alter column activity_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'boq_allocations_scope_shape_chk') then
    alter table boq_allocations
      add constraint boq_allocations_scope_shape_chk check (
        (scope = 'activity' and activity_id is not null) or
        (scope = 'project'  and activity_id is null)
      );
  end if;
end $$;

-- 3 · at most ONE project row per line ---------------------------------------
-- ⚠️ A PARTIAL UNIQUE INDEX, and it is required rather than tidy. The existing
--    unique index is on (boq_item_id, activity_id), and Postgres treats NULLs as
--    DISTINCT — so without this, "the project as a whole" could be recorded
--    twice for one line and its amount would be counted twice in the spread.
create unique index if not exists boq_allocations_project_once_idx
  on boq_allocations (boq_item_id) where scope = 'project';

-- 4 · a line is allocated ONE way or the OTHER, never both -------------------
-- ⚠️⚠️ THIS IS A DOUBLE-COUNT GUARD AND IT CANNOT BE A CONSTRAINT. A CHECK sees
--    one row; the rule is about the SET of rows for a line. The app already
--    replaces a line's whole allocation set on Apply, so mixing cannot arise
--    from the UI — but a trigger is what makes it impossible from anywhere,
--    which is the standard this module already applies to the issued-lines lock
--    ("enforced by a trigger rather than by every future UI remembering to").
--    Mixing would put the same money in both the per-activity map and the
--    project-wide spread, and the contract total would silently exceed itself.
create or replace function boq_alloc_scope_guard() returns trigger
language plpgsql as $$
declare
  other_kind text;
begin
  select scope into other_kind
    from boq_allocations
   where boq_item_id = new.boq_item_id
     and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
     and scope <> new.scope
   limit 1;

  if other_kind is not null then
    raise exception
      'BOQ line % already has % allocation(s); a line is allocated across activities OR to the project, never both.',
      new.boq_item_id, other_kind
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists boq_alloc_scope_guard_trg on boq_allocations;
create trigger boq_alloc_scope_guard_trg
  before insert or update on boq_allocations
  for each row execute function boq_alloc_scope_guard();

-- 5 · verify ------------------------------------------------------------------
-- Run these by hand after the migration; each should return what the comment says.
--
--   -- every existing row still reads as an activity allocation:
--   select scope, count(*) from boq_allocations group by scope;
--        -> only 'activity', with the count you had before
--
--   -- the shape check bites:
--   insert into boq_allocations (project_id, boq_item_id, activity_id, scope)
--   values ('X', '00000000-0000-0000-0000-000000000001', null, 'activity');
--        -> ERROR: boq_allocations_scope_shape_chk
--
--   -- the mixing guard bites (against a line that already has activity rows):
--   insert into boq_allocations (project_id, boq_item_id, activity_id, qty, scope)
--   select project_id, boq_item_id, null, 0, 'project' from boq_allocations limit 1;
--        -> ERROR: ... a line is allocated across activities OR to the project, never both.
