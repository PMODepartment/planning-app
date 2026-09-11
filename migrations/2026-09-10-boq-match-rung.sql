-- =============================================================================
-- 2026-09-10  boq_allocations: record WHICH RUNG matched the activity
-- =============================================================================
-- Run this in the Supabase SQL editor. It is additive and idempotent; the module
-- works unchanged on a database where it has NOT been run (boq.js drops the two
-- keys and retries once, then says so in the toast).
--
-- WHY
-- ---
-- The BOQ allocator used to offer ONE rung: every activity carrying the line's
-- class code. A class code is a TAG — "Rebar Works" is one code on forty
-- floor-level activities — so a 3rd-floor line was matched to all forty and its
-- quantity smeared across them by duration pro-rata.
--
-- ⚠️ That is a MONEY defect, not a tidiness one. Cost Loading's `boqDerive`
--    (modules/project-schedule/index.html) splits a line's `amount` across
--    exactly the activities it is allocated to, and the result is written to
--    `project_schedule.planned_cost` — which is the cost-basis S-curve
--    (`schedule_scurve_agg`.w_cost) and therefore Cash Flow's cash-in. A line
--    spread over forty floors puts ~95% of its cost on floors it never touches.
--
-- The matcher now has four rungs — location, WBS branch, name similarity, and
-- the bare class code — and allocates over the STRONGEST rung that found
-- anything. These two columns record which one, so a later audit can tell a
-- location match from a pro-rata guess from a planner's own hand-made link.
--
-- ⚠️⚠️ `method` IS DELIBERATELY LEFT ALONE AND ITS CHECK IS NOT RELAXED.
--    `method` is HOW THE QUANTITY WAS SPLIT (equal across matched places, or
--    pro-rata by duration, or typed by hand). `matched_by` is HOW THE ACTIVITY
--    WAS FOUND. They are two different facts and the existing code already
--    strains against conflating them: `addAuthoredLines` writes
--    `method = 'manual'` with a comment saying neither of the other two values
--    describes what happened. Widening `method` to carry rung names would have
--    made every historical row ambiguous about which of the two it meant.
-- -----------------------------------------------------------------------------

alter table boq_allocations add column if not exists matched_by  text;
alter table boq_allocations add column if not exists match_score numeric;

comment on column boq_allocations.matched_by is
  'Which matcher rung found this activity: location | wbs | name | code | manual. '
  'NULL on rows written before 2026-09-10 — unknown, NOT manual.';
comment on column boq_allocations.match_score is
  'The rung''s confidence at the time it was accepted. Display and audit only; '
  'nothing reads it to make a decision.';

-- ⚠️ NULL is allowed and must stay allowed: every row written before today has no
--    recorded rung, and back-filling one would invent a provenance for decisions
--    nobody can now reconstruct. "Unknown" and "manual" are different claims.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'boq_alloc_matched_by_ck') then
    alter table boq_allocations add constraint boq_alloc_matched_by_ck
      check (matched_by is null or matched_by in ('location','wbs','name','code','manual'));
  end if;
end $$;

-- No index. `matched_by` is read per row on a screen that has already fetched the
-- project's allocations; it is never a filter on its own.
