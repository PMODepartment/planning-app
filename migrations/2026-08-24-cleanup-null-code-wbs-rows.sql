-- Cleanup: WBS-Summary rows with no dotted code (NULL `wbs`).
-- Written 2026-08-24. RUN THIS IN THE SUPABASE SQL EDITOR (it needs DDL for the backup table).
--
-- WHAT THESE ROWS ARE. They were written by the cross-project bug closed in the same day's commit
-- "WBS: close the cross-project summary-row writer": `pid` is set early in load() while WBS_NODES is
-- replaced later, so a projector pinned the NEW project id against the OLD project's nodes, and
-- computeWbsCodes() (reading the live tree) then returned `undefined` for those nodes -> `wbs` NULL.
--
-- MEASURED ON LIVE DATA BEFORE WRITING THIS (2026-08-24):
--   83 rows total  ·  BAU101 82, MWD101 1  ·  all created 2026-08-18 / 2026-08-19
--   3   point at a WBS node belonging to a DIFFERENT project
--   80  point at a WBS node that NO LONGER EXISTS
--   0   point at a node in their own project  -> not one of them is a legitimate projection
--   0   activities hang off those node ids    -> deleting them orphans nothing
--
-- WHY THEY CANNOT SELF-HEAL: `_wbsEnsureSummaries` probes `.in('wbs_node_id', <this project's ids>)`,
-- which matches neither a foreign id nor a NULL, and `_wbsDedupeSummariesByCode` skips a blank code
-- outright (`if (!k) return`). They are invisible to both repairs by construction.
--
-- ⚠️ SCOPE IS EXACT, VERIFIED AGAINST THE LIVE DB:
--   `wbs IS NULL`  matches 83 rows and nothing else.
--   `wbs = ''`     matches 0 rows and is NOT touched -- copy-WBS-from-project inserts a blank code
--                  deliberately and lets _wbsCommit() assign the real one. Never widen this to
--                  `coalesce(wbs,'') = ''`.
--   Non-summary rows with a NULL `wbs`: 0, and they are NOT in scope either way.
--
-- EXPECTED RESULT: BAU101 goes 112 summary rows -> 30 against 40 WBS nodes; the next time the project
-- is opened the heal projects the 10 genuinely-missing trade headings, ending at a clean 40/40.

-- 1. Backup first. Re-runnable: fails loudly if the table already exists, which is the point.
create table wbs_null_code_backup_20260824 as
  select * from public.project_schedule
   where activity_type = 'WBS Summary' and wbs is null;

-- 2. Confirm the backup captured everything before deleting anything.
--    Expect: 83
select count(*) as backed_up from wbs_null_code_backup_20260824;

-- 3. Delete exactly what was backed up (keyed on the backed-up ids, so the two can never disagree).
delete from public.project_schedule p
 using wbs_null_code_backup_20260824 b
 where p.id = b.id;

-- 4. Verify. Expect: remaining_null_code = 0
select count(*) as remaining_null_code
  from public.project_schedule
 where activity_type = 'WBS Summary' and wbs is null;

-- 5. Spot-check BAU101. Expect: nodes 40, summary_rows 30
select (select count(*) from public.wbs_nodes where project_id = 'BAU101') as nodes,
       (select count(*) from public.project_schedule
         where project_id = 'BAU101' and activity_type = 'WBS Summary') as summary_rows;

-- ── REVERSE (only if something looks wrong) ───────────────────────────────────
-- insert into public.project_schedule select * from wbs_null_code_backup_20260824;
--
-- ── ONCE SATISFIED (keep the backup for a while first) ────────────────────────
-- drop table wbs_null_code_backup_20260824;
