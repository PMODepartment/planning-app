-- ============================================================================
-- Migration: the PERSONAL SANDBOX PROJECT.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Owner, 2026-09-17: "I need a sandbox project. This will be the training
-- ground for tomorrow's cascade of the app. This sandbox project will be
-- personal to the user and any edits they made will not be shared for other
-- users. In this way planners will no longer have to add new projects that will
-- add +50 test projects. This will also help them in familiarizing the app."
--
-- ⚠️⚠️ THE WHOLE DESIGN IN ONE SENTENCE: a sandbox is an ORDINARY PROJECT ROW
-- that only its owner can see. Everything else falls out of that.
--
-- The reason this is a ~200-line migration and not a 16-module rewrite is that
-- this database already partitions every module's data by `project_id`, and
-- every one of those partitions is gated by ONE function. Measured, not
-- assumed, against supabase-build.sql on 2026-09-17:
--
--       can_access_project(...)   244 occurrences
--       create policy             279 occurrences
--
-- So `can_access_project()` IS the isolation boundary for the entire app. Teach
-- that one function that a sandbox belongs to exactly one person and all 16
-- modules inherit it -- project_schedule, boq, cash_flow, s_curve, risk_register,
-- the lot -- with no module table touched, no module code changed, and no new
-- per-user filter for a future module to forget to apply.
--
-- ⚠️ REJECTED: a `user_id` column on every module table. It is the obvious
-- shape and it is wrong here. It would mean 89 tables altered, 244 policies
-- rewritten, and -- the part that actually kills it -- every future module
-- silently defaulting to NOT isolated until somebody remembers to add the
-- column. The project partition already exists and is already enforced; a
-- second partition that means almost the same thing is the bug factory.
--
-- ⚠️ REJECTED: one shared 'SANDBOX' project for everybody. That is the cheapest
-- possible change and it fails the actual requirement in the first hour of the
-- cascade -- two planners on the same fake schedule, overwriting each other,
-- which is WORSE training than the +50 test projects this replaces.
--
-- ⚠️ WHAT THIS DOES NOT SOLVE, stated rather than discovered tomorrow:
--    A `viewer` gets a sandbox they can READ but not WRITE. Every module write
--    policy is `is_writer() and ... can_access_project(project_id)`, and
--    `is_writer()` takes no project argument, so there is no way to grant a
--    viewer write access to their own sandbox alone without rewriting all 137
--    `is_writer()` call sites -- which would flatten months of per-module
--    hand-tuning for one edge case. A viewer who needs to practise WRITING
--    should be moved to the `user` role for the cascade. That is a one-field
--    change in admin.html and it is the right lever.
-- ============================================================================

-- ---- 1) The two columns ----------------------------------------------------
-- ⚠️ `is_sandbox` is NOT NULL DEFAULT false on purpose. A nullable flag would
-- make every policy below read `coalesce(is_sandbox, false)` forever, and the
-- one place that forgot the coalesce would fail OPEN -- a sandbox visible to the
-- whole company. NOT NULL makes the safe reading the only reading.
alter table public.projects add column if not exists is_sandbox boolean not null default false;

-- ⚠️ ON DELETE SET NULL, and the alternatives are both worse:
--    * NO ACTION would make `admin_delete_user()` fail on a foreign key the
--      moment anyone with a sandbox is removed -- a user you cannot delete.
--    * CASCADE would delete the projects row and leave the sandbox's module
--      rows behind as orphans. 25 tables carrying `project_id` have NO foreign
--      key to projects at all (wbs_nodes among them -- see
--      2026-09-16-delete-project-purge.sql), so FK semantics cannot reach them
--      and nothing would ever clean them up.
-- SET NULL leaves a visible, purgeable husk instead: an ORPHANED sandbox, which
-- `projects_read` below deliberately shows to admins (and to nobody else) so it
-- can be deleted with the ordinary admin_delete_project() purge.
alter table public.projects add column if not exists owner_id uuid references auth.users(id) on delete set null;

comment on column public.projects.is_sandbox is
  'True for a personal training project. Visible ONLY to projects.owner_id --
   not to admins, not to super_admins. Excluded from portfolio aggregates by
   the client (UI.allProjectIds / portfolio-dash scopedProjectIds).';
comment on column public.projects.owner_id is
  'The single user a sandbox belongs to. NULL for every real project, and NULL
   for an orphaned sandbox whose owner was deleted (those stay admin-visible so
   they can be purged).';

-- ⚠️ ONE SANDBOX PER PERSON, ENFORCED IN THE DATABASE. sandbox_ensure() below
-- already checks before inserting, but a check-then-insert is a race: two tabs
-- opening the app at the same moment both find nothing and both insert. This
-- index is what actually makes "exactly one" true.
-- ⚠️ PARTIAL (`where is_sandbox`) because owner_id is NULL on every real
-- project, and a plain unique index would be satisfied by those NULLs today and
-- collide the moment owner_id is ever reused for something else.
create unique index if not exists projects_one_sandbox_per_owner
  on public.projects (owner_id) where is_sandbox;

-- The read path below asks "is this project a sandbox?" on every row of every
-- module table, so it had better be an index hit.
create index if not exists projects_sandbox_idx
  on public.projects (is_sandbox) where is_sandbox;

-- ---- 2) The isolation boundary --------------------------------------------
-- The ONE function change that isolates all 16 modules.
--
-- ⚠️⚠️ NOTE WHAT THE SANDBOX BRANCH DOES **NOT** SAY: there is no
-- `u.role in ('admin','super_admin')` in it. That omission is the feature. An
-- admin can see every real project in the company and CANNOT see anyone else's
-- sandbox, because a training ground you share with your boss is not a training
-- ground. This is the only place in this schema where admin is not a superset.
--
-- ⚠️ WRITTEN AS ONE `exists` OVER A JOIN, NOT TWO NESTED `exists` CALLS. This
-- function is invoked PER ROW by 244 policies, including on project_schedule
-- reads that run to six figures of rows against an 8s statement_timeout. The
-- obvious shape -- `case when (select is_sandbox...) then (select owner...)
-- else (select users...) end` -- costs two separate subplans per row. The join
-- below costs one, and both lookups are primary-key hits.
--
-- ⚠️ `left join` is load-bearing. `project_id` on the 25 FK-less tables can name
-- a project that does not exist (orphan rows outlive their project -- the purge
-- migration documents exactly that residue). An inner join would make
-- can_access_project() return false for them, which is harmless for reads but
-- changes behaviour silently. The left join keeps an unknown project on the
-- pre-existing `else` path, exactly as before this migration.
create or replace function can_access_project(pid text) returns boolean
  language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
      from users u
      left join projects p on p.id = pid
     where u.id = auth.uid()
       and u.status = 'approved'
       and case
             when coalesce(p.is_sandbox, false)
               then p.owner_id = u.id
             else u.role in ('admin','super_admin') or pid = any(u.projects)
           end
  );
$fn$;

comment on function can_access_project(text) is
  'May the current user touch this project? Real project: admins all, everyone
   else their users.projects assignments. SANDBOX: its owner and NOBODY ELSE,
   admins included. Called per-row by 244 RLS policies -- keep it one plan.';

-- ---- 3) The projects table's own policies ----------------------------------
-- ⚠️ `projects_read` cannot simply delegate to can_access_project(): its
-- existing shape is `is_admin() or can_access_project(id)`, and that leading
-- `is_admin()` SHORT-CIRCUITS -- an admin would see every sandbox in the
-- company however carefully the function above is written. The admin fast path
-- has to be pushed inside the non-sandbox branch.
drop policy if exists projects_read on projects;
create policy projects_read on projects for select
  using (
    case when is_sandbox
         -- `owner_id is null and is_admin()` is the orphan husk described in (1):
         -- an admin can find and purge a departed user's sandbox. A LIVE sandbox
         -- stays invisible to them.
         then is_approved() and (owner_id = auth.uid() or (owner_id is null and is_admin()))
         else is_admin() or can_access_project(id)
    end
  );

-- ⚠️ `not is_sandbox` on INSERT: a planner may create projects, and without this
-- they could hand-insert `is_sandbox = true, owner_id = <someone else>` and
-- manufacture a project nobody but that person can see. sandbox_ensure() is
-- SECURITY DEFINER so it bypasses this policy -- the RPC stays the only door,
-- which is what makes "owner_id is always the caller" an invariant rather than
-- a convention.
drop policy if exists projects_ins on projects;
create policy projects_ins on projects for insert
  with check (is_planner() and not is_sandbox);

-- Sandbox branch: its owner may rename/edit it whatever their role -- a `user`
-- is not a planner and must still be able to manage their own training ground.
-- ⚠️ BOTH SIDES OF THE `with check` PIN THE FLAG. Without it the owner could
-- update `is_sandbox = false` and promote their training data into a real
-- project visible to every admin -- the exact +50-test-projects mess this
-- feature exists to end, arriving through the back door. The `not is_sandbox`
-- branch pins it the other way: a planner cannot convert a real project into a
-- private sandbox and take it out of everyone else's sight.
drop policy if exists projects_upd on projects;
create policy projects_upd on projects for update
  using (
    case when is_sandbox then is_approved() and owner_id = auth.uid()
         else is_planner() and (is_admin() or can_access_project(id)) end
  )
  with check (
    case when is_sandbox then is_approved() and owner_id = auth.uid()
         else is_planner() and (is_admin() or can_access_project(id)) end
  );

-- ⚠️ A sandbox is NOT deletable from the client -- `sandbox_reset()` empties it
-- and the row itself stays. Deleting it would strand `users.projects` and hand
-- the owner an app with a dangling context, and there is no user-facing reason
-- to want the row gone. An admin can still purge an ORPHANED one through
-- admin_delete_project(), which is SECURITY DEFINER and bypasses this policy.
drop policy if exists projects_del on projects;
create policy projects_del on projects for delete
  using (not is_sandbox and is_planner() and (is_admin() or can_access_project(id)));

-- ---- 4) sandbox_ensure() ---------------------------------------------------
-- Get-or-create, called by the client every time someone opens the sandbox.
-- ⚠️ SECURITY DEFINER because the caller may be a `user` or `viewer`, whom
-- projects_ins deliberately does not let insert projects at all. The function
-- is the carve-out; the policy stays strict.
create or replace function sandbox_ensure()
returns projects language plpgsql security definer set search_path = public as $fn$
declare
  uid  uuid := auth.uid();
  p    projects;
  hex  text;
  code text;
  who  text;
  n    int;
begin
  if not is_approved() then
    raise exception 'Your account is not approved yet.';
  end if;

  select * into p from projects where is_sandbox and owner_id = uid;
  if found then return p; end if;

  -- ⚠️ THE ID IS DERIVED FROM THE USER'S UUID, NOT FROM A COUNTER. A counter
  -- ("SBX-001") needs a read of the max before every insert, which is the same
  -- check-then-insert race the unique index exists to stop, and it leaks how
  -- many people have opened a sandbox. A uuid slice is stable, collision-free
  -- in practice, and regenerates to the SAME code if this row is ever rebuilt.
  hex := replace(uid::text, '-', '');
  -- Widen on collision rather than fail. 6 hex chars over a random uuid is
  -- ~16.7M -- a collision needs roughly 5,000 users to be even a 1-in-1000
  -- event, so this loop should never run twice. It exists because "should
  -- never" is not "cannot", and the failure it prevents is an unexplainable
  -- primary-key error on somebody's first login during the cascade.
  for n in 0..3 loop
    code := 'SBX-' || upper(substr(hex, 1, 6 + n * 2));
    exit when not exists (select 1 from projects where id = code);
  end loop;
  if exists (select 1 from projects where id = code) then
    raise exception 'Could not allocate a sandbox code for this account.';
  end if;

  select coalesce(nullif(trim(u.name), ''), split_part(u.email, '@', 1), 'My')
    into who from users u where u.id = uid;

  insert into projects (id, name, status, is_sandbox, owner_id, description)
  values (code, who || '''s Sandbox', 'active', true, uid,
          'Personal training project. Only you can see it. Nothing here affects real project data - use Reset Sandbox to empty it.')
  returning * into p;

  -- ⚠️ `users.projects` is a text[] with no foreign key, and can_access_project()
  -- no longer consults it for a sandbox -- so this append is NOT what grants
  -- access. It is here because other surfaces still read the array directly
  -- (admin.html's Projects column, AppAuth.canAccessProject on the client), and
  -- a sandbox missing from it would read as "unassigned" in those places.
  update users
     set projects = array_append(coalesce(projects, '{}'), code)
   where id = uid and not (coalesce(projects, '{}') @> array[code]);

  return p;
end $fn$;

grant execute on function sandbox_ensure() to authenticated;

-- ---- 5) sandbox_reset() ----------------------------------------------------
-- Empty MY sandbox, keep the project row.
--
-- ⚠️ THIS IS admin_delete_project()'S SWEEP, MINUS THE FINAL DELETE. Same
-- catalog-driven discovery, same retry loop, same reasoning -- see
-- 2026-09-16-delete-project-purge.sql for why a hardcoded table list is
-- forbidden here (a grep-built list would have deleted every sibling package
-- link in the database) and why the sweep must reach the 25 tables that have no
-- foreign key to projects at all.
--
-- ⚠️ DELIBERATELY NOT REFACTORED INTO A SHARED HELPER with admin_delete_project.
-- They differ in who may call them, what happens at the end, and what a failure
-- means. Folding them together would put the company's hard-delete and a
-- self-service button on the same code path, where a change made for one
-- silently alters the other.
create or replace function sandbox_reset()
returns void language plpgsql security definer set search_path = public as $fn$
declare
  target  text;
  r       record;
  t       text;
  tables  text[];
  keep    text[] := '{}';
  pending text[];
  nextq   text[];
  pass    int := 0;
begin
  if not is_approved() then
    raise exception 'Your account is not approved yet.';
  end if;

  -- ⚠️ THE TARGET IS LOOKED UP, NEVER PASSED IN. A `sandbox_reset(target text)`
  -- signature would be a SECURITY DEFINER function that purges any project id
  -- the caller names -- one missing ownership check away from a company-wide
  -- data loss. Taking no argument at all means there is no check to forget.
  select id into target from projects
   where is_sandbox and owner_id = auth.uid();
  if target is null then
    raise exception 'You have no sandbox project yet.';
  end if;

  -- 5a) Unlink the columns the SCHEMA ITSELF declares ON DELETE SET NULL.
  -- ⚠️ Reset UNLINKS rather than deletes here, which is a real judgement call:
  -- `user_notes.project_id` means your own notes about the sandbox survive a
  -- reset as general notes instead of being destroyed. A "reset" that silently
  -- deleted something you wrote by hand is the worse surprise of the two.
  for r in
    select src.relname as tbl, a.attname as col
      from pg_constraint c
      join pg_class src     on src.oid = c.conrelid
      join pg_class tgt     on tgt.oid = c.confrelid
      join pg_namespace ns  on ns.oid  = src.relnamespace
      join pg_attribute a   on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confdeltype = 'n'
       and tgt.relname = 'projects' and ns.nspname = 'public'
       and array_length(c.conkey, 1) = 1
     order by src.relname, a.attname
  loop
    execute format('update %I set %I = null where %I = $1', r.tbl, r.col, r.col)
      using target;
    if r.col = 'project_id' then keep := keep || r.tbl; end if;
  end loop;

  -- 5b) Everything else carrying a project_id, from the catalog.
  select array_agg(c.relname order by c.relname) into tables
    from pg_attribute a
    join pg_class c      on c.oid = a.attrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r'
     and a.attname = 'project_id' and a.attnum > 0 and not a.attisdropped
     and c.relname <> 'projects'
     and not (c.relname = any(keep));

  pending := coalesce(tables, '{}');
  while array_length(pending, 1) > 0 and pass < 5 loop
    pass  := pass + 1;
    nextq := '{}';
    foreach t in array pending loop
      begin
        execute format('delete from %I where project_id = $1', t) using target;
      exception
        when foreign_key_violation then nextq := nextq || t;
      end;
    end loop;
    if array_length(nextq, 1) = array_length(pending, 1) then
      raise exception
        'Could not reset the sandbox: these tables reference each other (%). Nothing was deleted.',
        array_to_string(nextq, ', ');
    end if;
    pending := nextq;
  end loop;

  if array_length(pending, 1) > 0 then
    raise exception 'Could not reset the sandbox after % passes; still blocked: %.',
      pass, array_to_string(pending, ', ');
  end if;

  -- ⚠️ The projects row SURVIVES -- that is the whole difference from
  -- admin_delete_project(). The user keeps their sandbox, its id and its place
  -- in users.projects; only the contents go.
end $fn$;

-- ⚠️ SAME 8s CEILING, SAME REASON as admin_delete_project(). PostgREST runs as
-- `authenticated`, capped at 8s; a sandbox someone has imported a real 100k-row
-- XER into will blow straight through that, and the whole body is ONE
-- transaction so a timeout rolls back everything and the reset can NEVER
-- succeed. Raised for this function alone.
alter function sandbox_reset() set statement_timeout = '120s';

grant execute on function sandbox_reset() to authenticated;

-- ---- 6) ⚠️ OUT OF SCOPE: STORAGE -------------------------------------------
-- Identical to the purge migration's section 4, for the identical reason:
-- `delete from storage.objects` drops the metadata row and leaves the BYTES
-- billed and unreachable. A photo uploaded into the sandbox survives a reset in
-- the bucket. Doing it properly needs an Edge Function holding the service-role
-- key. What is left behind, per sandbox:
--     select bucket_id, count(*), pg_size_pretty(sum((metadata->>'size')::bigint))
--       from storage.objects where split_part(name, '/', 1) = 'SBX-XXXXXX'
--      group by bucket_id;

-- ---- 7) Verify -------------------------------------------------------------
-- (a) The columns and the one-per-owner guarantee:
--       select column_name, data_type, is_nullable, column_default
--         from information_schema.columns
--        where table_schema='public' and table_name='projects'
--          and column_name in ('is_sandbox','owner_id');
--       select indexdef from pg_indexes
--        where tablename='projects' and indexname='projects_one_sandbox_per_owner';
--
-- (b) ⚠️ THE TEST THAT ACTUALLY MATTERS -- isolation from an ADMIN, which is the
--     one claim in this file that contradicts every other policy in the schema.
--     Run as a real signed-in admin session (the SQL editor runs as `postgres`
--     and BYPASSES RLS, so it will happily show you every sandbox and prove
--     nothing). In the app, signed in as an admin, in the browser console:
--       (await PDb.getProjects()).filter(p => p.is_sandbox)
--                                        // expect: only your own, or none
--     and against another user's sandbox id directly:
--       (await getSB().from('projects').select('*').eq('id','SBX-XXXXXX')).data
--                                        // expect: []
--
-- (c) Module isolation is inherited, not separately enforced -- confirm it once
--     rather than trusting the claim. As user A, put a row in the sandbox
--     (any module). As admin B, in the console:
--       (await getSB().from('risk_register').select('*')
--          .eq('project_id','SBX-<A''s code>')).data      // expect: []
--
-- (d) The sweep, rehearsed and undone. Safe on your OWN sandbox:
--       begin;
--         select count(*) from project_schedule where project_id = 'SBX-XXXXXX';
--         select sandbox_reset();
--         select count(*) from project_schedule where project_id = 'SBX-XXXXXX';  -- expect 0
--         select count(*) from projects where id = 'SBX-XXXXXX';                  -- expect 1
--       rollback;
--
-- (e) The timeout actually took:
--       select proname, proconfig from pg_proc where proname = 'sandbox_reset';
--     Expect BOTH search_path=public and statement_timeout=120s.
--
-- (f) ⚠️ REGRESSION CHECK ON THE 244. can_access_project() was rewritten, so
--     prove a REAL project still behaves exactly as before: an admin sees a
--     project they are not assigned to, and a `user` does not.
--       select can_access_project('DEMO01');   -- as each role, in the app
