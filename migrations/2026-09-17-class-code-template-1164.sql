-- ============================================================================
-- Class codes: adopt "EPC. FIN. Class Code Mapping Template_1164", sheet `Excel Temp (2)`
--
-- Owner, 2026-09-17: *"Let's replace the current library of class codes in the app. Let's
-- follow the Excel Temp (2)."*
--
-- ⚠️⚠️ WHAT THE NEW TEMPLATE ACTUALLY IS. Compared row by row against the chart this repo
-- seeded on 2026-08-21: the 466 codes on that sheet are a strict SUBSET of the 702 already in
-- `class_codes`, and nothing about them has moved.
--     kept ................ 466   (every one already present)
--     added ...............   0
--     retired ............. 236
--     desc_l1/2/3 changed .   0
--     code_l1 / code_l2 ...   0 changed
--     trade ...............   0 changed
--     relative order ...... identical
-- So this is a RETIREMENT, not a re-seed. There is nothing to insert and nothing to correct,
-- and writing it as a re-seed would rewrite 466 rows to the values they already hold.
--
-- WHAT GOES. 208 of the 236 are the SIX-character sub-item codes ('010521' Rental of Flat Bed
-- Truck, under '01052' Demobilization); the other 28 are five-character items, and four of those
-- (11011, 11021, 11031, 11032) were already retired by `2026-09-07-class-code-dedupe.sql` as
-- de-zeroed twins. Eight LEVEL-2 GROUPS disappear with them: 12500, 16450, 17550, 25700, 25750,
-- 50000, 51000, 61000.
--
-- ⚠️ CROSS-CHECKED AGAINST THE MODULE, and this is the reassuring part. The schedule's own
-- `CLASS_CODE_DB` (the Level-2 group chart a planner picks activities from) holds 197 groups.
-- The new template holds 197 groups. They are the SAME 197 -- the eight the template drops are
-- exactly the eight the module never had. The app is already speaking this template; only the
-- item-level table still carries the retired rows. **No code change accompanies this migration.**
--
-- ⚠️⚠️ ACTIVE = FALSE, NEVER DELETE. `project_schedule.class_code`, `boq_class_map` and
-- `boq_allocations` carry these strings with no FK, deliberately (see 2026-08-21): a schedule
-- imported from P6 can hold a code that predates a template revision, and holding an unresolved
-- code is a visible data-quality signal where a deleted row is a silent one. `loadClassCodes()`
-- filters on `active = true`, so a retired code stops being OFFERED immediately and anything
-- already carrying one keeps it, visibly unresolved. Section 1 counts those rows BEFORE anything
-- is written, so the size of that is known rather than discovered.
--
-- Run in the Supabase SQL editor (Planners project). Idempotent / re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Preflight -- what is in use that this retires. Writes nothing.
-- ---------------------------------------------------------------------------
-- ⚠️⚠️ NO DOLLAR-QUOTED DO BLOCK AND NO DYNAMIC SQL HERE, and that is not a style choice.
-- The first version of this section was a DO block whose three dynamic-SQL strings each embedded
-- the full 466-code list. Run on 2026-09-17 it left the chart at 698 active / 4 retired -- i.e.
-- the editor stopped somewhere in section 1 and section 2 never executed at all. A preflight that
-- can block the migration it is advising on is worse than no preflight. Plain SELECTs run, report,
-- and cannot take the rest of the file down with them.
--
-- ⚠️ The membership test below is the SHORT form of the same set: everything the template
-- drops is either a six-character sub-item code or one of these 28 five-character items. Verified
-- against the sheet -- it reproduces the 236 exactly, and its complement is exactly the 466.
-- Section 2 still carries the explicit list, because THAT one is authoritative and must not
-- depend on a shape rule that a later revision could break.
select 'class_codes: active now'  as what, count(*) as n from class_codes where active
union all
select 'class_codes: this retires', count(*) from class_codes
 where active and (length(code) <> 5 or code in
   ('01661','01700','01717','01719','01901','03053','04053','07054','11011','11021',
    '11031','11032','12501','16451','17551','25606','25653','25701','25751','26350',
    '27101','27102','27204','27215','29252','50000','51000','NOBDT'))
union all
-- The rows that KEEP a code this retires. They are not touched: the code stays on the row and
-- simply stops being offered in the picker, which is the visible data-quality signal the
-- no-FK decision exists to produce.
select 'project_schedule rows carrying one', count(*)
  from project_schedule s join class_codes c on c.code = s.class_code
 where c.active and (length(c.code) <> 5 or c.code in
   ('01661','01700','01717','01719','01901','03053','04053','07054','11011','11021',
    '11031','11032','12501','16451','17551','25606','25653','25701','25751','26350',
    '27101','27102','27204','27215','29252','50000','51000','NOBDT'))
union all
select 'boq_class_map rows carrying one', count(*)
  from boq_class_map m join class_codes c on c.code = m.class_code
 where c.active and (length(c.code) <> 5 or c.code in
   ('01661','01700','01717','01719','01901','03053','04053','07054','11011','11021',
    '11031','11032','12501','16451','17551','25606','25653','25701','25751','26350',
    '27101','27102','27204','27215','29252','50000','51000','NOBDT'))
union all
-- ⚠⚠ WAS `boq_allocations a ... a.class_code`, WHICH DOES NOT EXIST AND STOPPED THE WHOLE
-- SCRIPT: `ERROR: 42703: column a.class_code does not exist`, reported by the owner on his first
-- run. `boq_allocations` links a BOQ item to an activity (boq_item_id, activity_id, qty, method)
-- and has never carried a class code. The three tables that DO carry the string are
-- `project_schedule`, `boq_class_map` and `boq_class_suggestions` — the last is the one meant
-- here, and the count below is the same question asked of the right table.
-- ⚠ Checked the rest of this file the same way rather than fixing only the line that threw:
-- every other table.column it references exists.
select 'boq_class_suggestions rows carrying one', count(*)
  from boq_class_suggestions g join class_codes c on c.code = g.class_code
 where c.active and (length(c.code) <> 5 or c.code in
   ('01661','01700','01717','01719','01901','03053','04053','07054','11011','11021',
    '11031','11032','12501','16451','17551','25606','25653','25701','25751','26350',
    '27101','27102','27204','27215','29252','50000','51000','NOBDT'));
-- expect before a first run: active now 698, this retires 232.

-- ---------------------------------------------------------------------------
-- 2) Retire everything off the template, and re-activate anything on it
-- ---------------------------------------------------------------------------
-- One statement, so it is one transaction and one pass over the chart. The two branches are
-- disjoint by construction (`active` vs `not active`), so no row is written twice.
-- ⚠️ The re-activating branch is not decoration: it is what makes this re-runnable after a
-- hand edit, and it REPORTS a template code missing from the chart rather than passing over
-- it -- a code on Finance's sheet that the app would offer nobody.
with tmpl(code) as (values
  ('01051'),('01052'),('01101'),('01102'),('01103'),('01104'),('01105'),('01151'),
  ('01152'),('01201'),('01202'),('01251'),('01301'),('01302'),('01303'),('01304'),
  ('01351'),('01352'),('01353'),('01354'),('01401'),('01451'),('01452'),('01453'),
  ('01454'),('01501'),('01502'),('01503'),('01504'),('01505'),('01506'),('01507'),
  ('01508'),('01551'),('01601'),('01602'),('01651'),('01652'),('01653'),('01654'),
  ('01655'),('01656'),('01657'),('01658'),('01659'),('01660'),('01701'),('01702'),
  ('01703'),('01704'),('01705'),('01706'),('01707'),('01708'),('01709'),('01710'),
  ('01711'),('01712'),('01713'),('01714'),('01715'),('01716'),('01751'),('01752'),
  ('01753'),('01754'),('01755'),('01801'),('01851'),('01852'),('02051'),('02052'),
  ('02053'),('02054'),('02055'),('02056'),('02057'),('02058'),('02059'),('02060'),
  ('02101'),('02102'),('02103'),('02104'),('02105'),('02106'),('02107'),('02108'),
  ('02151'),('02152'),('02153'),('02154'),('02201'),('02202'),('03051'),('03052'),
  ('04051'),('04052'),('05051'),('05052'),('06051'),('06052'),('06053'),('06054'),
  ('06055'),('06056'),('06057'),('06058'),('06059'),('07051'),('07052'),('07053'),
  ('08051'),('08101'),('08151'),('08201'),('08251'),('08301'),('08351'),('08401'),
  ('08451'),('08501'),('08551'),('08601'),('08651'),('08701'),('09051'),('09101'),
  ('09151'),('10051'),('10101'),('10151'),('10201'),('10251'),('10301'),('10351'),
  ('10401'),('10451'),('10501'),('10551'),('11051'),('11101'),('11151'),('12051'),
  ('12101'),('12151'),('12201'),('12251'),('12301'),('12351'),('12401'),('12451'),
  ('13051'),('13101'),('13151'),('13201'),('13251'),('13301'),('13351'),('13401'),
  ('14051'),('14101'),('14151'),('15051'),('15052'),('15061'),('15101'),('15151'),
  ('15201'),('15251'),('15301'),('15351'),('15401'),('15451'),('15501'),('15551'),
  ('15601'),('15651'),('16051'),('16101'),('16151'),('16201'),('16251'),('16301'),
  ('16351'),('16401'),('17051'),('17101'),('17151'),('17201'),('17251'),('17301'),
  ('17351'),('17401'),('17451'),('17501'),('18051'),('18101'),('18151'),('18201'),
  ('19051'),('19101'),('19151'),('19201'),('20051'),('20052'),('20101'),('20151'),
  ('20201'),('20251'),('20301'),('21051'),('22051'),('23051'),('23052'),('24051'),
  ('25051'),('25052'),('25053'),('25054'),('25055'),('25056'),('25057'),('25058'),
  ('25059'),('25060'),('25061'),('25062'),('25063'),('25064'),('25065'),('25101'),
  ('25102'),('25103'),('25104'),('25151'),('25152'),('25153'),('25154'),('25155'),
  ('25156'),('25157'),('25158'),('25159'),('25201'),('25202'),('25203'),('25211'),
  ('25212'),('25213'),('25251'),('25252'),('25253'),('25301'),('25302'),('25303'),
  ('25351'),('25352'),('25353'),('25401'),('25402'),('25403'),('25451'),('25452'),
  ('25453'),('25501'),('25502'),('25503'),('25504'),('25551'),('25552'),('25553'),
  ('25601'),('25602'),('25603'),('25604'),('25605'),('25611'),('25612'),('25613'),
  ('25651'),('25652'),('26051'),('26052'),('26053'),('26054'),('26101'),('26151'),
  ('26152'),('26153'),('26154'),('26155'),('26156'),('26157'),('26158'),('26159'),
  ('26160'),('26161'),('26201'),('26251'),('26252'),('26301'),('26351'),('26352'),
  ('26353'),('26354'),('26355'),('26401'),('26402'),('26403'),('26451'),('26452'),
  ('26453'),('26501'),('26502'),('26503'),('26551'),('26552'),('26553'),('26601'),
  ('26602'),('26603'),('26651'),('26652'),('26653'),('26701'),('26702'),('26703'),
  ('26751'),('26752'),('26753'),('26801'),('26802'),('26851'),('26852'),('27051'),
  ('27052'),('27053'),('27054'),('27055'),('27103'),('27104'),('27105'),('27106'),
  ('27107'),('27108'),('27151'),('27152'),('27153'),('27154'),('27201'),('27202'),
  ('27203'),('27251'),('27252'),('27301'),('27302'),('27303'),('27304'),('27305'),
  ('27306'),('27307'),('27308'),('27309'),('27351'),('27352'),('27353'),('27401'),
  ('27402'),('27403'),('28051'),('28052'),('28101'),('28102'),('28103'),('28104'),
  ('28151'),('28201'),('28251'),('28252'),('28253'),('28301'),('28302'),('28303'),
  ('28304'),('28305'),('28306'),('28307'),('29051'),('29052'),('29101'),('29151'),
  ('29201'),('29251'),('30051'),('30052'),('31051'),('32051'),('32101'),('32151'),
  ('33051'),('33052'),('33053'),('33054'),('33055'),('33056'),('33057'),('33058'),
  ('33059'),('33060'),('34051'),('35051'),('36051'),('36052'),('36053'),('37051'),
  ('37052'),('37053'),('37054'),('37055'),('37056'),('37057'),('37058'),('37059'),
  ('37060'),('37061'),('37062'),('37063'),('37064'),('37065'),('37066'),('37067'),
  ('37068'),('37069'),('37070'),('37071'),('37072'),('37073'),('37074'),('37075'),
  ('38051'),('39051'),('39052'),('39053'),('39054'),('39055'),('39056'),('39101'),
  ('39102'),('39151'),('39152'),('39201'),('39202'),('39203'),('39251'),('39252'),
  ('39253'),('39301'),('39302'),('39303'),('39351'),('39352'),('39353'),('39354'),
  ('39401'),('39402')
),
retired as (
  update class_codes c set active = false
   where c.active
     and not exists (select 1 from tmpl t where t.code = c.code)
  returning c.code
),
restored as (
  update class_codes c set active = true
   where not c.active
     and exists (select 1 from tmpl t where t.code = c.code)
  returning c.code
)
select (select count(*) from retired)  as retired_now,
       (select count(*) from restored) as re_activated,
       (select count(*) from tmpl t
         where not exists (select 1 from class_codes c where c.code = t.code)) as missing_from_chart;
-- expect on a first run: retired_now = 232, re_activated = 0, missing_from_chart = 0
--   (232 and not 236 -- four were already retired by 2026-09-07-class-code-dedupe.sql)
-- expect on a re-run:   0, 0, 0

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--   select count(*) from class_codes;                       -- expect 702 (nothing deleted)
--   select count(*) from class_codes where active;          -- expect 466
--   select count(*) from class_codes where not active;      -- expect 236
--
--   -- the template's own shape, read back off the table:
--   select count(distinct code_l1), count(distinct code_l2) from class_codes where active;
--     -- expect 39, 197 -- and 197 is the module's CLASS_CODE_DB length
--
--   select trade, count(*) from class_codes where active group by 1 order by 2 desc;
--     -- expect: MEPF Works 172, Architectural Works 104, Others 72, General Requirement 70,
--     --         Site Works 24, Structural Works 18, Allied Services Works 6
--
--   -- no six-character code is left active:
--   select count(*) from class_codes where active and length(code) <> 5;   -- expect 0
--
--   -- the eight groups that go with them:
--   select distinct code_l2 from class_codes where not active
--      and code_l2 not in (select code_l2 from class_codes where active) order by 1;
--     -- expect 12500, 16450, 17550, 25700, 25750, 50000, 51000, 61000
--
--   -- ROLLBACK, if the retirement turns out to be wrong:
--   --   update class_codes set active = true
--   --    where code not in ('11011','11021','11031','11032');   -- back to 698 active
