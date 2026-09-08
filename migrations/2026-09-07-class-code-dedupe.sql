-- ============================================================================
-- Retire four de-zeroed twins in the class-code chart
--
-- Owner reported "duplicate rows" in the Add-lines picker. They are real, and they are in
-- Finance's template rather than in the app: 101 groups hold two or more codes sharing a
-- description, across 209 of the 702 codes. Almost all of those are legitimate -- a 5-digit and a
-- 6-digit code for the same words is a granularity difference Finance maintains on purpose.
--
-- ⚠️⚠️ EXACTLY FOUR ARE NOT. These are the SAME NUMBER written twice, once padded and once with
--    its leading zero stripped, in the SAME group with the SAME description:
--
--        011011 / 11011   Office - Megawide & Owner
--        011021 / 11021   Barracks
--        011031 / 11031   Staging Area
--        011032 / 11032   Utilities
--
--    The padded form is authoritative. 2026-08-21-class-codes.sql says so in its own header:
--    "THE PADDED LEVEL-3 CODE IS THE KEY. Do NOT strip its leading zeros." So the stripped twin
--    is retired and the padded one stays.
--
-- ⚠️⚠️ TWO OTHER ZERO-STRIP PAIRS EXIST AND MUST NOT BE TOUCHED. They are the exact pairs that
--    same header warns about, and they are DIFFERENT ITEMS that happen to collide when de-zeroed:
--
--        015051  General Requirement > Support Equipment > Earthmoving
--         15051  Metal Works         > Railings          > Railings
--        017151  General Requirement > Bonds/Permits     > Misc. LGU and Estate Tax
--         17151  Aluminum Glass      > Swing Windows     > Aluminum Swing Windows
--
--    Retiring either would delete a real cost code. This file names all six pairs so the
--    distinction is on the record, and touches only the four where group AND description match.
--
-- ⚠️ DEACTIVATED, NEVER DELETED. `active = false` is what the picker already filters on
--    (ensureCodes reads `.eq('active', true)`), so a retired code disappears from selection while
--    every BOQ line and every schedule activity that already carries it keeps working and keeps
--    reporting. A delete would break existing rows and could not be undone; this is one UPDATE
--    away from being reversed.
--
-- Run in the Supabase SQL editor (Planners project). Idempotent / re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Who is already using the twins? Read this BEFORE and AFTER.
-- ---------------------------------------------------------------------------
-- ⚠️ Deactivating hides a code from the picker; it does not migrate anything that already
--    references it. If either count below is non-zero, decide whether to re-point those rows at
--    the padded code first -- the app will keep working either way, but the two forms would go on
--    reporting as separate lines in a cost roll-up.
do $$
declare
  n_map integer := 0;
  n_act integer := 0;
begin
  select count(*) into n_map from boq_class_map where class_code in ('11011','11021','11031','11032');
  begin
    execute $q$ select count(*) from project_schedule where class_code in ('11011','11021','11031','11032') $q$
      into n_act;
  exception when undefined_column or undefined_table then n_act := -1;
  end;
  raise notice 'de-zeroed twins in use -> boq_class_map: % row(s), project_schedule: % (-1 = column absent)', n_map, n_act;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Retire the four
-- ---------------------------------------------------------------------------
-- ⚠️ Guarded on the padded twin actually existing. If a chart is ever reseeded without it, this
--    must not quietly retire the only surviving copy of the item.
update class_codes c
   set active = false
 where c.code in ('11011', '11021', '11031', '11032')
   and exists (
     select 1 from class_codes p
      where p.code = '0' || c.code
        and p.code_l2 = c.code_l2
        and p.desc_l3 = c.desc_l3
   );

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--   select code, code_l2, desc_l3, active from class_codes
--    where code in ('011011','11011','011021','11021','011031','11031','011032','11032')
--    order by desc_l3, code;
--     -- expect: the 0-prefixed rows active = true, the others active = false
--
--   select count(*) from class_codes where active;         -- expect 698 (was 702)
--
--   -- the two pairs that must still BOTH be active, because they are different items:
--   select code, desc_l1, desc_l3, active from class_codes
--    where code in ('015051','15051','017151','17151') order by code;
--     -- expect: all four active = true
--
-- To reverse:
--   update class_codes set active = true where code in ('11011','11021','11031','11032');
