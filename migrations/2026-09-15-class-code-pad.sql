-- =============================================================================
-- 2026-09-15  project_schedule.class_code: restore the leading zeros
-- =============================================================================
-- Run this in the Supabase SQL editor. Idempotent -- a second run updates 0 rows.
--
-- WHY
-- ---
-- Owner, off a screenshot of OPW101: the Class Code column shows `3050`, `4050`,
-- `5050`, `6050` in red. Red means "not in the class-code chart at either level",
-- and it is correct: the chart holds `03050` (Rebar), `04050` (Formworks),
-- `05050` (Concrete), `06050` (Precast Works). The activity names beside those
-- codes are Rebar / Formworks / Concrete / Precast Works, so the match is not in
-- doubt -- the stored value has simply lost its leading zero.
--
-- WHERE THEY CAME FROM, and why nothing new writes them
-- ----------------------------------------------------
-- `CLASS_CODE_DB` -- the Schedule Builder's `+ Library` list -- held Finance's
-- Level-2 group chart WITH THE LEADING ZEROS STRIPPED until 2026-09-10 (z4)
-- padded all 43 of them. Any activity pushed from the library before that date
-- carries the de-zeroed code. The library is correct now, so this repairs a
-- bounded set of existing rows rather than an ongoing fault.
--
-- =============================================================================
-- WARNING  WARNING   DE-ZEROING IS FORBIDDEN, AND THIS IS THE INVERSE OF IT
-- =============================================================================
-- `2026-08-21-class-codes.sql` records that de-zeroing COLLIDES genuinely
-- different items:
--     015051  General Requirement > Support Equipment > Earthmoving
--      15051  Metal Works         > Railings          > Railings
--     017151  General Requirement > Bonds/Permits     > Misc. LGU and Estate Tax
--      17151  Aluminum Glass      > Swing Windows     > Aluminum Swing Windows
-- Both members of each pair are real codes. So the danger is a rule that strips a
-- zero, or that pads a value which is ALREADY a valid code.
--
-- This statement does NEITHER. It only touches a row whose stored value matches
-- NOTHING in the chart at either level -- a row that is already broken -- and it
-- refuses any value whose padded form is not UNIQUE. `15051` resolves on its own,
-- so `15051` is never in the candidate set and can never become `015051`.
--
-- Measured over the 702 seeded codes and 205 groups before writing this:
--   * every code at either level is 5 or 6 characters -- there is no 4-character
--     code anywhere, so a 4-digit stored value is unambiguously de-zeroed;
--   * of the 221 de-zeroed forms that are not themselves real codes,
--     221 pad to exactly ONE real code and 0 are ambiguous.
--
-- WARNING  It mirrors what the app does at read time. `ensureCodes` fetches
-- `.eq('active', true)`, so a value matching a RETIRED code (the four de-zeroed
-- twins `2026-09-07-class-code-dedupe.sql` deactivated) is treated as unresolved
-- here too, and is repaired onto its padded twin. That is the intended outcome:
-- those pairs are the same number written twice.
--
-- =============================================================================

begin;

-- The chart's own keys, both levels, active rows only -- the same set the app reads.
create temporary table _cc_keys on commit drop as
  select code as k from class_codes where active
  union
  select code_l2 as k from class_codes where active;

-- Candidates: a stored code the chart does not know, whose zero-padded form it does,
-- and whose padded form is UNIQUE.
create temporary table _cc_fix on commit drop as
select s.class_code as stored,
       min(k.k)     as padded,
       count(*)     as n_targets
  from (select distinct class_code
          from project_schedule
         where class_code is not null
           and btrim(class_code) <> ''
           and not exists (select 1 from _cc_keys c where c.k = btrim(class_code))
       ) s
  join _cc_keys k
    on k.k <> btrim(s.class_code)
   and ltrim(k.k, '0') = btrim(s.class_code)
   and ltrim(k.k, '0') <> k.k
 group by s.class_code
having count(*) = 1;

-- ---------------------------------------------------------------------------
-- DRY RUN -- read this before committing. One row per distinct stored value.
-- ---------------------------------------------------------------------------
select f.stored,
       f.padded,
       cc.desc_l1 || ' > ' || cc.desc_l2 as resolves_to,
       count(*)                          as activities
  from _cc_fix f
  join project_schedule ps on btrim(ps.class_code) = f.stored
  left join lateral (
    select desc_l1, desc_l2 from class_codes
     where active and (code = f.padded or code_l2 = f.padded) limit 1
  ) cc on true
 group by f.stored, f.padded, cc.desc_l1, cc.desc_l2
 order by f.stored;

-- Anything that could NOT be repaired, and why. Expect 0 rows on a healthy chart.
select distinct btrim(ps.class_code) as stored, 'no unique padded form in the chart' as reason
  from project_schedule ps
 where ps.class_code is not null
   and btrim(ps.class_code) <> ''
   and not exists (select 1 from _cc_keys c where c.k = btrim(ps.class_code))
   and not exists (select 1 from _cc_fix f where f.stored = btrim(ps.class_code))
 order by 1;

-- ---------------------------------------------------------------------------
-- THE WRITE
-- ---------------------------------------------------------------------------
update project_schedule ps
   set class_code = f.padded
  from _cc_fix f
 where btrim(ps.class_code) = f.stored;

-- WARNING  `boq_class_map` and `boq_allocations` are DELIBERATELY NOT touched.
-- A BOQ line's code is PICKED from the chart (`ccOptsHTML` lists real codes), so
-- it cannot be de-zeroed by the route above, and repairing a table by a rule
-- written for a different table's fault is how a tidy-up destroys good data.
-- To check, rather than assume:
--     select distinct class_code from boq_class_map m
--      where class_code is not null
--        and not exists (select 1 from class_codes c
--                         where c.active and (c.code = m.class_code or c.code_l2 = m.class_code));
-- Expect 0 rows. If it returns any, raise it -- do not pad them here.

commit;

-- ---------------------------------------------------------------------------
-- VERIFY (run after committing)
-- ---------------------------------------------------------------------------
-- Every stored code should now resolve at one level or the other. Expect 0 rows.
--   select distinct class_code
--     from project_schedule ps
--    where class_code is not null and btrim(class_code) <> ''
--      and not exists (select 1 from class_codes c
--                       where c.active and (c.code = btrim(ps.class_code)
--                                        or c.code_l2 = btrim(ps.class_code)));
--
-- And the two pairs that must BOTH still exist, untouched, because they are
-- different items (this migration must never have merged them):
--   select code, desc_l1, desc_l3 from class_codes
--    where code in ('015051','15051','017151','17151') order by code;
