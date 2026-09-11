-- =============================================================================
-- 2026-09-10  class_codes: two group descriptions name the wrong group
-- =============================================================================
-- Run this in the Supabase SQL editor. Idempotent, and it touches DESCRIPTIONS only —
-- no code changes, so nothing that joins on `code` or `code_l2` is affected.
--
-- WHY
-- ---
-- Found while auditing the Schedule Builder's own class-code library against the chart.
-- 195 of its 197 group names agree with `class_codes.desc_l2` exactly. The two that
-- disagree are the chart's error, not the library's — established by reading the L3
-- items each group actually holds:
--
--   group 25200  desc_l2 = 'Chilled Water AC Works'
--                items   = Fresh Air Duct Riser, Fresh Air Duct Branch, ...   (4 items,
--                          every one of them a Fresh Air duct)
--                ⚠️ 'Chilled Water AC Works' is the CORRECT name of group 25150, which
--                   sits immediately above it and holds Chilled Water items. A copy-down.
--
--   group 25550  desc_l2 = 'Stair Pressurization Ducting Works'
--                items   = Kitchen Exhaust Air Duct Riser, Kitchen Exhaust Air Duct
--                          Branch, ...
--                ⚠️ 'Stair Pressurization Ducting Works' is the CORRECT name of group
--                   25500, immediately above it. The same copy-down, one group later.
--
-- ⚠️ THE ITEMS ARE THE EVIDENCE, NOT THE OTHER CHART. Both corrections are taken from
--    what `desc_l3` says the group contains, which is data Finance also owns and which
--    two independent sources agree on. The Schedule Builder's list happens to match; it
--    is corroboration, not the authority.
--
-- ⚠️ `desc_l2` IS DENORMALISED — it repeats on every L3 row of the group — so both
--    updates are written by `code_l2`, never by a single row's `code`. Updating one row
--    would leave the group with two different names depending on which item you read.
-- -----------------------------------------------------------------------------

do $$
declare
  n_fresh int;
  n_kitchen int;
begin
  -- 25200 — Fresh Air Ducting Works
  update class_codes
     set desc_l2 = 'Fresh Air Ducting Works'
   where code_l2 = '25200'
     and desc_l2 is distinct from 'Fresh Air Ducting Works';
  get diagnostics n_fresh = row_count;

  -- 25550 — Kitchen Exhaust Ducting Works
  update class_codes
     set desc_l2 = 'Kitchen Exhaust Ducting Works'
   where code_l2 = '25550'
     and desc_l2 is distinct from 'Kitchen Exhaust Ducting Works';
  get diagnostics n_kitchen = row_count;

  raise notice 'class_codes desc_l2 corrected: 25200 -> % row(s), 25550 -> % row(s)',
               n_fresh, n_kitchen;

  -- ⚠️ A LOUD no-op is the point of running it twice: re-running must report 0/0 rather
  --    than looking identical to a run that did something.
  if n_fresh = 0 and n_kitchen = 0 then
    raise notice 'Nothing to do - both group names are already correct.';
  end if;
end $$;

-- Read-back, so the run shows what the two groups now say and how many items each holds.
select code_l2, desc_l2, count(*) as items
  from class_codes
 where code_l2 in ('25150', '25200', '25500', '25550')
 group by code_l2, desc_l2
 order by code_l2;

-- ⚠️ NOT changed, and deliberately: 11 groups whose TRADE disagrees between the chart
--    ('Others') and the Schedule Builder's library ('SW') — Site Development Works and the
--    LD Roadworks / Drainage / Waterline / Sewerline / Telecom / Lighting family. Both
--    readings are defensible: the chart files them in its catch-all, the library calls them
--    site works. Choosing one is a Finance decision, not a data repair, so it is recorded
--    in modules/project-schedule/CLAUDE.md and left alone.
