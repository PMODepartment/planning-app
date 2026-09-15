-- ============================================================================
-- Migration: close the "RLS Disabled in Public" advisory on the ad-hoc backup
--            tables created by hand in the SQL editor.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- ⚠️ DATED 09-16 ON PURPOSE. Several 2026-09-15-*.sql already exist and
-- migrations/gen-build.js sorts same-date files ALPHABETICALLY, so a second
-- 09-15 file would interleave with them in supabase-build.sql on no principle
-- at all.
--
-- THE FINDING: Supabase's own advisor reports public.wbs_summary_backup_20260817
-- as CRITICAL — RLS disabled. It holds ~103,548 WBS rows across EVERY project
-- (the rollback snapshot for the 2026-08-17 cleanup) and, being created ad hoc
-- in the SQL editor, is in no tracked migration and is enabled nowhere.
--
-- ⚠️ SEVERITY, MEASURED RATHER THAN ASSUMED. `anon` is refused outright (42501),
-- so this is NOT open to the internet. But supabase-schema.sql carries
--
--     alter default privileges in schema public
--       grant select, insert, update, delete on tables to authenticated;
--
-- so EVERY new public table is born with full DML for `authenticated` — and
-- with RLS off there is no row filter. Any signed-in account, a `viewer`
-- included, can therefore read every project's WBS out of this table and
-- delete the rollback. That is the whole of the exposure, and it is real.
--
-- THE FIX: RLS on, and NO policies. RLS with zero policies denies every role
-- except the table owner and service_role, which is exactly what a rollback
-- snapshot should be — reachable from the SQL editor, reachable from nothing
-- else. The revoke is belt-and-braces against the default-privileges grant
-- above: without it a refused read comes back as an empty result set, with it
-- as a permission error, which is the honest answer to a table you may not read.
--
-- ⚠️⚠️ DO NOT DROP THESE TABLES. They are the only rollback for their cleanups,
-- and the owner's explicit decision was "enable RLS, keep the data". Dropping
-- would also close the advisory — and would throw away the thing the advisory
-- is about.
--
-- ⚠️ NOTHING IN THE APP READS EITHER TABLE. Checked rather than assumed: the
-- only references anywhere in this repo are prose in
-- modules/project-schedule/changelog/2026-08.md and the CLEANUP file that
-- creates the second one. So this cannot break a screen.
-- ============================================================================

-- ---- 1) Secure every ad-hoc backup table that actually exists ---------------
-- ⚠️ A LOOP, not four bare statements, because these tables are hand-made and
-- WHICH of them exist differs per environment. `alter table` on a missing table
-- is a hard error that aborts the whole file in the SQL editor's single
-- transaction — so a plain statement list would leave a deployment that never
-- ran the 08-24 cleanup unable to run this migration at all.
--
-- ⚠️ wbs_null_code_backup_20260824 is in this list DELIBERATELY, and its status
-- is an open question rather than a claim: migrations/CLEANUP-wbs-null-code-
-- 20260824.sql:43 creates it with `create table ... as select`, which lands it
-- in public with RLS off exactly like the other one — yet the advisor reported
-- only ONE table. Either that cleanup was never run here, or the advisory list
-- was filtered. The loop answers both cases without needing to know which:
-- it secures the table if it is there and says so if it is not.
do $$
declare
  t    text;
  list text[] := array[
    'wbs_summary_backup_20260817',   -- the advisor's CRITICAL finding
    'wbs_null_code_backup_20260824'  -- same shape, created by the 08-24 cleanup
  ];
begin
  foreach t in array list loop
    if to_regclass('public.' || quote_ident(t)) is null then
      raise notice 'skipped % — no such table in this database', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    -- ⚠️ No `create policy` anywhere in this file. Zero policies IS the rule:
    -- deny everyone but the owner and service_role. Adding even a read policy
    -- for `authenticated` would re-open the exact hole being closed.
    execute format('revoke all on public.%I from authenticated', t);
    execute format('revoke all on public.%I from anon', t);

    raise notice 'secured % — RLS on, no policies, grants revoked', t;
  end loop;
end $$;

-- ---- 2) Verify -------------------------------------------------------------
-- (a) Both rows should read rls_enabled = true. A table absent here is one this
--     database does not have, which the notices above will have said.
select c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relname in ('wbs_summary_backup_20260817','wbs_null_code_backup_20260824')
 order by 1;

-- (b) Expect 0 rows. Neither table may carry a policy — a policy would hand the
--     data back to whichever role it names.
select tablename, policyname
  from pg_policies
 where schemaname = 'public'
   and tablename in ('wbs_summary_backup_20260817','wbs_null_code_backup_20260824');

-- (c) ⚠️ AND THE ONE THAT MATTERS MOST: find anything ELSE still unprotected.
--     Run this and read the whole list. Trust the CATALOG, not a grep of this
--     repo — RLS is enabled DYNAMICALLY here, by `do $$ ... execute format(
--     'alter table %I enable row level security', t)` loops that no literal
--     search can see, so grepping the migrations under-reports enablement
--     wildly (it reported 35 "unprotected" tables against the advisor's 1).
--     Expect: only tables you recognise as deliberate, and after this file runs,
--     neither of the two above.
select c.relname as unprotected_table
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relkind = 'r'
   and not c.relrowsecurity
 order by 1;
