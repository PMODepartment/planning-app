-- ============================================================================
-- boq_allocations.method gains 'link' -- "matched, not yet quantified"
--
-- Run in the Supabase SQL editor (Planners project). Idempotent / re-runnable.
--
-- WHY
-- ---------------------------------------------------------------------------
-- `method` is how the QUANTITY WAS SPLIT. `matched_by` (2026-09-10-boq-match-rung)
-- is how the ACTIVITY WAS FOUND. Since 2026-09-07 (h) a line can be LINKED before it
-- is measured -- qty = 0 means "matched, not yet quantified" -- and in that state
-- nothing has been split at all.
--
-- The vocabulary had no value for that, so every such row was stamped 'manual', which
-- asserts A HUMAN PICKED IT. The code knew and said so in two places:
--
--   proposeSplit()      "Method stays null: nothing has been split, and labelling this
--                        'prorata' would claim an arithmetic that did not happen."
--   scheduleSeedPlan()  "method is 'manual' because the constraint allows only
--                        location/prorata/manual and NEITHER of the other two happened
--                        here."
--
-- ...and the write then coerced that honest null back to 'manual' (`prop.method ||
-- 'manual'`), because the column is NOT NULL and the CHECK allowed nothing else.
--
-- MEASURED ON THE LIVE DATABASE (DEMO01, 2026-09-14), 50 allocations:
--   method=manual | matched_by=code   | score 0.1   -> 14   <- found by the matcher
--   method=manual | matched_by=name   | score 0.6   -> 23   <- found by the matcher
--   method=manual | matched_by=manual | score null  -> 13   <- genuinely by hand
-- 37 of 50 rows claimed a human decision that never happened.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 - widen the CHECK
-- ---------------------------------------------------------------------------
-- The original constraint is INLINE (`method text not null default 'manual' check
-- (...)`) so Postgres named it itself. Found by definition rather than by a guessed
-- name, and only CHECKs that actually mention `method` are touched.
do $$
declare c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.boq_allocations'::regclass
       and contype  = 'c'
       and pg_get_constraintdef(oid) ilike '%method%'
  loop
    execute format('alter table public.boq_allocations drop constraint %I', c.conname);
    raise notice 'dropped old method check: %', c.conname;
  end loop;
end $$;

alter table public.boq_allocations
  add constraint boq_allocations_method_chk
  check (method in ('location','prorata','manual','link'));

-- ---------------------------------------------------------------------------
-- 2 - back-fill the rows that were stamped 'manual' because nothing else fitted
-- ---------------------------------------------------------------------------
-- NARROW ON PURPOSE: `qty = 0` only. A row with a quantity really was split, and its
-- 'location' / 'prorata' / 'manual' is a true statement about that split.
--
-- It covers the hand-picked links too (matched_by = 'manual'), and that loses nothing:
-- `method` describes the split, and at qty 0 there wasn't one. WHO chose it is still
-- recorded, in `matched_by`, which is the column that answers that question.
--
-- A row with matched_by NULL (written before the rung migration, or by the seed path)
-- is still moved -- 'manual' was never true of it either -- but nothing is invented
-- about how it was found: matched_by stays NULL, which means "not recorded".
do $$
declare n_before int; n_moved int;
begin
  select count(*) into n_before
    from public.boq_allocations where qty = 0 and method = 'manual';
  raise notice 'qty-0 rows stamped manual before: %', n_before;

  update public.boq_allocations
     set method = 'link'
   where qty = 0 and method = 'manual';
  get diagnostics n_moved = row_count;
  raise notice 'moved to link: %', n_moved;
end $$;

-- ---------------------------------------------------------------------------
-- 3 - verify
-- ---------------------------------------------------------------------------
-- Expect: no qty-0 row left on 'manual', and every qty>0 row untouched.
--
--   select method, matched_by, count(*), min(qty), max(qty)
--     from boq_allocations group by 1,2 order by 1,2;
--
--   select count(*) as should_be_zero
--     from boq_allocations where qty = 0 and method = 'manual';
--
--   select pg_get_constraintdef(oid)
--     from pg_constraint where conname = 'boq_allocations_method_chk';
