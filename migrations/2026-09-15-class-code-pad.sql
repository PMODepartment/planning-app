-- =============================================================================
-- 2026-09-15  project_schedule.class_code: restore the leading zeros
-- =============================================================================
-- Run the three STEPS below ONE AT A TIME in the Supabase SQL editor, in order.
-- Idempotent -- a second run of step 2 updates 0 rows.
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
-- WARNING  WARNING   THE FIRST VERSION OF THIS FILE DID NOT RUN, AND WHY MATTERS
-- =============================================================================
-- It built two `create temporary table ... on commit drop` staging tables and
-- then referenced them, and it failed with:
--
--     ERROR: 42P01: relation "_cc_keys" does not exist
--
-- `on commit drop` means the table is dropped AT THE END OF THE TRANSACTION, and
-- the Supabase SQL editor commits per execution -- so the table was created and
-- destroyed by the very statement that made it, and the next statement could not
-- see it. (A pooled connection can lose a temp table between statements for the
-- same reason.) Nothing was written: the failure came long before the UPDATE.
--
-- ⚠️ SO THERE ARE NO TEMPORARY TABLES HERE. Every step is ONE self-contained
--    statement whose CTEs recompute the candidate set from scratch. That also
--    makes each step independently re-runnable, which is what you want when the
--    dry run and the write are read by a person in between.
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
-- This does NEITHER. It only touches a row whose stored value matches NOTHING in
-- the chart at either level -- a row that is already broken -- and it refuses any
-- value whose padded form is not UNIQUE. `15051` resolves on its own, so it is
-- never in the candidate set and can never become `015051`.
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
-- =============================================================================


-- =============================================================================
-- STEP 1 of 3 -- DRY RUN.  Read this before running step 2. Writes nothing.
-- One row per distinct stored value, with how many activities carry it.
-- =============================================================================
with cc_keys as (
  select code    as k from class_codes where active
  union
  select code_l2 as k from class_codes where active
),
stored as (
  select distinct btrim(class_code) as raw
    from project_schedule
   where class_code is not null
     and btrim(class_code) <> ''
),
orphans as (
  select s.raw
    from stored s
   where not exists (select 1 from cc_keys c where c.k = s.raw)
),
fix as (
  select o.raw as stored_code, min(k.k) as padded_code
    from orphans o
    join cc_keys k
      on ltrim(k.k, '0') = o.raw          -- the chart key, de-zeroed, is this value
     and ltrim(k.k, '0') <> k.k           -- and it really did carry leading zeros
   group by o.raw
  having count(*) = 1                     -- ⚠ refuse anything ambiguous
)
select f.stored_code,
       f.padded_code,
       cc.desc_l1 || ' > ' || cc.desc_l2 as resolves_to,
       (select count(*) from project_schedule ps
         where btrim(ps.class_code) = f.stored_code) as activities
  from fix f
  left join lateral (
    select desc_l1, desc_l2
      from class_codes
     where active and (code = f.padded_code or code_l2 = f.padded_code)
     limit 1
  ) cc on true
 order by f.stored_code;

-- Expect: `3050 -> 03050 Structural Works > Rebar`, and so on.
-- An EMPTY result means there is nothing to repair -- do not run step 2, and say so.


-- =============================================================================
-- STEP 1b (optional) -- anything that CANNOT be repaired, and why.
-- Expect 0 rows on a healthy chart. Raise it rather than padding by hand.
-- =============================================================================
with cc_keys as (
  select code as k from class_codes where active
  union
  select code_l2 as k from class_codes where active
)
select distinct btrim(ps.class_code) as stored_code,
       'no unique padded form in the chart' as reason
  from project_schedule ps
 where ps.class_code is not null
   and btrim(ps.class_code) <> ''
   and not exists (select 1 from cc_keys c where c.k = btrim(ps.class_code))
   and not exists (
     select 1 from cc_keys k
      where ltrim(k.k, '0') = btrim(ps.class_code)
        and ltrim(k.k, '0') <> k.k
      group by ltrim(k.k, '0')
     having count(*) = 1
   )
 order by 1;


-- =============================================================================
-- STEP 2 of 3 -- THE WRITE.  One statement; it is atomic on its own.
-- =============================================================================
with cc_keys as (
  select code    as k from class_codes where active
  union
  select code_l2 as k from class_codes where active
),
stored as (
  select distinct btrim(class_code) as raw
    from project_schedule
   where class_code is not null
     and btrim(class_code) <> ''
),
orphans as (
  select s.raw
    from stored s
   where not exists (select 1 from cc_keys c where c.k = s.raw)
),
fix as (
  select o.raw as stored_code, min(k.k) as padded_code
    from orphans o
    join cc_keys k
      on ltrim(k.k, '0') = o.raw
     and ltrim(k.k, '0') <> k.k
   group by o.raw
  having count(*) = 1
)
update project_schedule ps
   set class_code = f.padded_code
  from fix f
 where btrim(ps.class_code) = f.stored_code;

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


-- =============================================================================
-- STEP 3 of 3 -- VERIFY.
-- =============================================================================
-- (a) Every stored code should now resolve at one level or the other. Expect 0 rows.
with cc_keys as (
  select code as k from class_codes where active
  union
  select code_l2 as k from class_codes where active
)
select distinct btrim(ps.class_code) as still_unresolved
  from project_schedule ps
 where ps.class_code is not null
   and btrim(ps.class_code) <> ''
   and not exists (select 1 from cc_keys c where c.k = btrim(ps.class_code))
 order by 1;

-- (b) The two pairs that must BOTH still exist, untouched, because they are
--     different items -- this migration must never have merged them. Expect 4 rows.
--
--   select code, desc_l1, desc_l3 from class_codes
--    where code in ('015051','15051','017151','17151') order by code;
--
-- (c) And the app's own check, which needs no SQL: hard-refresh, open the Schedule,
--     and the Class Code column should read `03050` with NO dotted underline. The
--     underline means the screen is padding a value the database still holds
--     de-zeroed -- i.e. step 2 has not taken.
