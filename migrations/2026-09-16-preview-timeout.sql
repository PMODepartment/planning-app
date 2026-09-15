-- ============================================================================
-- Migration: give admin_project_delete_preview() its own statement_timeout.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- WHY. 2026-09-16-delete-project-purge.sql raised the ceiling on
-- admin_delete_project() to 120s and deliberately left the PREVIEW alone, so it
-- inherits the `authenticated` role's 8 second cap. Looking at it again with the
-- rehearsal's numbers in hand, that is the wrong side of the trade:
--
--   * the preview runs `select count(*)` on EVERY public table carrying a
--     project_id -- 89 of them today -- plus one per SET NULL foreign key;
--   * not all of those tables have an index on project_id, so some of those
--     counts are sequential scans;
--   * and the projects where that matters are exactly the ones somebody wants
--     to delete: a 100k-activity schedule, years of photos and audit rows.
--
-- ⚠️⚠️ AND THE EVIDENCE WE HAVE CANNOT SEE THE PROBLEM. The live rehearsal ran
-- against BAU101-TEST, which the preview itself reported as **76 rows to
-- delete**. It proved the LOGIC end to end -- the purge completes, wbs_nodes
-- goes, and a seeded user_notes row survives with its project_id cleared
-- (SURVIVES=1, still tagged=0) -- and it proved nothing whatever about timing,
-- because a 76-row project cannot take 8 seconds to count.
--
-- ⚠️ THE FAILURE IS SAFE, WHICH IS WHY THIS IS A FIX AND NOT AN EMERGENCY.
-- projects.html will not arm the delete button when the preview rejects, and it
-- says so on screen. So a timeout means "the big project is the one you cannot
-- delete" -- the owner's ORIGINAL complaint wearing a different hat -- rather
-- than a delete that proceeds without anybody seeing its blast radius.
--
-- ⚠️ 60s, NOT 120s. The preview is a read and a person is watching a modal
-- while it runs; if it genuinely needs longer than a minute the honest answer
-- is an index on the offending table, not a larger number here. The purge's
-- 120s is different in kind -- nobody is waiting on a spinner to decide
-- something, and it is the write that must not be abandoned half way.
-- ============================================================================

alter function admin_project_delete_preview(text) set statement_timeout = '60s';

-- ---- Verify ----------------------------------------------------------------
-- ⚠️ ONE statement: the Supabase SQL editor shows only the LAST statement's
-- result, so a file of separate verify queries silently answers just one of
-- them. (This repo has already shipped that mistake once, and I repeated it in
-- chat while verifying the migrations above.)
--
-- Expect BOTH functions to carry search_path=public, admin_delete_project to
-- carry statement_timeout=120s, and admin_project_delete_preview 60s.
select proname,
       coalesce(array_to_string(proconfig, ', '), '(no config)') as config
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('admin_delete_project', 'admin_project_delete_preview')
 order by proname;
