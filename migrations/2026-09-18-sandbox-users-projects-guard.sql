-- ============================================================================
-- Migration: THE SANDBOX COULD NOT BE CREATED BY ANYONE WHO IS NOT AN ADMIN.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
-- ⚠️ Requires 2026-09-17-sandbox-project.sql to have been run first: the guard
--    below reads `projects.is_sandbox` / `projects.owner_id`.
--
-- Owner, 2026-09-18: "Planners have difficulty in creating the sandbox."
--
-- ⚠️⚠️ THE BUG IN ONE SENTENCE: `sandbox_ensure()` ends by appending the new code
-- to the caller's OWN `users.projects`, and `users_guard_self_escalation` — the
-- 2026-08-11 privilege-escalation trigger — exists precisely to forbid that.
--
--   sandbox_ensure()                       -- SECURITY DEFINER
--     insert into projects ...             -- ok
--     update users set projects = array_append(...) where id = auth.uid()
--       -> trigger users_guard_self_escalation (BEFORE UPDATE ON users)
--            if auth.uid() is null or is_admin() then return new; end if;
--            if new.projects is distinct from old.projects then
--              raise exception 'You may not change your own project assignments.'
--
-- ⚠️ SECURITY DEFINER DOES NOT HELP, and that is the whole trap. It changes
-- `current_user` to the function's owner; it does NOT change `auth.uid()`, which
-- reads the request's JWT claim out of a GUC and stays the signed-in caller for
-- the entire statement. So the trigger's exemption (`auth.uid() is null` = the
-- SQL editor / service_role / psql) never fires for an RPC, and `is_admin()` is
-- false for a planner. The exception propagates out of the plpgsql function with
-- NO handler, so the whole transaction rolls back -- INCLUDING the insert.
--
-- The planner therefore clicks "Create my sandbox" on projects.html, gets the
-- toast `Could not open your sandbox: You may not change your own project
-- assignments.`, and NOTHING is created. Every time, forever: the get-or-create
-- read at the top of sandbox_ensure() finds nothing on the next attempt either,
-- because the previous attempt left no row behind.
--
-- ⚠️⚠️ WHY IT SHIPPED LOOKING FINE. The trigger returns early for `is_admin()`,
-- so for an admin or super_admin — i.e. whoever tested it — sandbox_ensure()
-- runs to completion and the feature works perfectly. The failure is invisible
-- from the only account likely to have tried it. Every OTHER role (planner,
-- user, viewer) is blocked, which is all 16 modules' worth of training ground
-- for everyone the feature was actually written for.
--
-- ⚠️ NOT A SECURITY HOLE, and worth saying because the fix loosens a security
-- trigger: `can_access_project()` does NOT consult `users.projects` for a
-- sandbox (2026-09-17 section 2 -- a sandbox is reachable via `owner_id` alone).
-- The append is cosmetic, for the surfaces that still read the array directly
-- (admin.html's Projects column, AppAuth.canAccessProject on the client). So the
-- carve-out below grants no database access whatsoever; it lets a user list a
-- project they can already read.
-- ============================================================================

-- ---- 1) The guard learns about sandboxes -----------------------------------
-- ⚠️ REJECTED: dropping the `users.projects` line from sandbox_ensure(). It is
-- the smallest diff and it breaks two live surfaces -- admin.html's Projects
-- column and the `AppAuth.canAccessProject(profile, p.id)` filter that five
-- modules (contracts-claims, equipment-loading, manpower-loading,
-- material-submittal, progress-photos) run over their project pickers. The
-- sandbox would be created and then be missing from a third of the app, which
-- is a worse bug than the one being fixed and much harder to see.
--
-- ⚠️ REJECTED: `... or current_setting('app.sandbox', true) = 'on'`, i.e.
-- sandbox_ensure() sets a flag the trigger trusts. That is a security guard with
-- an off switch in a GUC, and `set_config(..., false)` (session scope, one
-- character away from the transaction-scoped call) would leave it ON for the
-- rest of the connection -- and PostgREST pools connections. A guard that can be
-- disabled by a typo somewhere else is not a guard.
--
-- ⚠️ THE CARVE-OUT IS SELF-VERIFYING INSTEAD: the change is allowed only if it
-- is an ADD-ONLY change and every added id is a project that IS a sandbox and IS
-- owned by this very row. Nothing has to be trusted or coordinated -- the
-- trigger proves it from the projects table at the moment of the write. A user
-- cannot manufacture a qualifying id either: `projects_ins` carries
-- `not is_sandbox`, `projects_upd` pins the flag on BOTH sides, and
-- `projects_one_sandbox_per_owner` allows one per person. The only rows that can
-- satisfy it are ones sandbox_ensure() made for that user.
create or replace function users_guard_self_escalation() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  added   text[];
  removed text[];
begin
  -- Unchanged from 2026-08-11: a trusted server-side session (SQL editor,
  -- service_role, psql, a scheduled job) has no JWT and must stay able to
  -- administer, or the documented bootstrap stops working.
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'You may not change your own role.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    raise exception 'You may not change your own account status.' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'You may not change a profile id.' using errcode = '42501';
  end if;

  if new.projects is distinct from old.projects then
    -- ⚠️ SET DIFFERENCE, NOT `array_length(new) = array_length(old) + 1`. A
    -- length test is satisfied by swapping one real project for another and
    -- adding a duplicate, which is exactly the shape this trigger exists to
    -- refuse. Name what came and what went, then judge those.
    select coalesce(array_agg(x), '{}') into added
      from unnest(coalesce(new.projects, '{}')) as x
     where not (coalesce(old.projects, '{}') @> array[x]);

    select coalesce(array_agg(x), '{}') into removed
      from unnest(coalesce(old.projects, '{}')) as x
     where not (coalesce(new.projects, '{}') @> array[x]);

    -- ⚠️ `added` EMPTY IS STILL A REFUSAL, deliberately. It means the array
    -- changed without gaining or losing a member -- a reorder, or a duplicate
    -- appended -- which no legitimate path in this app performs and which the
    -- pre-2026-09-18 trigger refused. The carve-out is for the one write
    -- sandbox_ensure() makes, not a general licence to rewrite the array.
    if coalesce(array_length(removed, 1), 0) > 0
       or coalesce(array_length(added, 1), 0) = 0
       or exists (
            select 1 from unnest(added) as x
             where not exists (
               select 1 from projects p
                where p.id = x and p.is_sandbox and p.owner_id = new.id)
          )
    then
      raise exception 'You may not change your own project assignments.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

-- ⚠️ The TRIGGER itself is untouched and is NOT re-created here: `create or
-- replace function` swaps the body under the existing trigger, and re-creating
-- the trigger would only add a window in which `users` is unguarded.

-- ---- 2) sandbox_ensure() stops betting the project row on that update ------
-- ⚠️⚠️ THE REAL LESSON IS NOT "THIS TRIGGER"; IT IS THAT A COSMETIC WRITE WAS
-- ABLE TO ROLL BACK THE ESSENTIAL ONE. `users.projects` is a convenience for
-- other screens -- the sandbox is reachable without it -- yet it sat in the same
-- transaction as the insert with no handler, so ANY future guard, policy or
-- trigger on `users` silently becomes a guard on creating a sandbox, presenting
-- as a feature that has never worked for most of the company.
--
-- The append is now in its own block: it still runs, it is still fixed by (1),
-- and if it is ever refused again the sandbox is created anyway and the refusal
-- is logged rather than swallowed in silence.
--
-- ⚠️ `insufficient_privilege` ONLY -- not `when others`. A guard refusing the
-- append is a known, survivable condition; a unique-violation or a deadlock on
-- `users` is not, and continuing quietly past one would be the worse bug.
-- Narrow handlers or none.
--
-- ⚠️⚠️ THIS FILE NOW OWNS sandbox_ensure(). It is `create or replace`d here and
-- sorts AFTER 2026-09-17-sandbox-project.sql in both filename order and
-- supabase-build.sql, so an edit made to the 2026-09-17 copy would be silently
-- clobbered by this one. Edit THIS definition. (A forward-pointing note has
-- been added to the 2026-09-17 file so its reader finds out before, not after.)
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

  -- The id is derived from the user's uuid, not from a counter -- see
  -- 2026-09-17-sandbox-project.sql section 4 for why, and for the
  -- widen-on-collision loop below.
  hex := replace(uid::text, '-', '');
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

  -- Cosmetic, for the surfaces that read the array directly. NOT what grants
  -- access -- can_access_project() reaches a sandbox through owner_id alone.
  begin
    update users
       set projects = array_append(coalesce(projects, '{}'), code)
     where id = uid and not (coalesce(projects, '{}') @> array[code]);
  exception when insufficient_privilege then
    -- The sandbox itself is already inserted and SURVIVES this; only the
    -- convenience listing is missing. Logged loudly because the app cannot
    -- show it: whoever reads the Postgres log needs the project id.
    raise warning 'sandbox_ensure: % created, but adding it to users.projects was refused (%). Run migrations/2026-09-18-sandbox-users-projects-guard.sql.',
      code, sqlerrm;
  end;

  return p;
end $fn$;

grant execute on function sandbox_ensure() to authenticated;

-- ---- 3) VERIFY — do this, do not assume ------------------------------------
-- ⚠️⚠️ THE SQL EDITOR CANNOT TEST THIS. It runs as `postgres` with no JWT, so
-- `auth.uid()` is null, the trigger returns early at its FIRST line, and both
-- the bug and the fix are invisible. This has to be run from a signed-in
-- browser session, and from a NON-ADMIN one -- an admin passes either way.
--
-- (a) The bug is gone. Signed in as a `planner` (or `user`), in the console:
--       await PDb.ensureSandbox()
--     Expect a project row back: { id: 'SBX-XXXXXX', is_sandbox: true, ... }.
--     Before this migration the same call throws
--       'You may not change your own project assignments.'
--
-- (b) It is idempotent and the array really was written:
--       (await PDb.ensureSandbox()).id                    // same id, twice
--       (await getSB().from('users').select('projects')
--          .eq('id', (await getSB().auth.getUser()).data.user.id).single()).data.projects
--                                                         // contains SBX-XXXXXX
--
-- (c) ⚠️ THE ESCALATION HOLE IS STILL SHUT. As the SAME non-admin account, all
--     three must still be REFUSED with 42501 -- this is the check that says the
--     carve-out did not become a door:
--       await getSB().from('users').update({ role:'super_admin' }).eq('id', myUid);
--       await getSB().from('users').update({ status:'approved'  }).eq('id', myUid);
--       await getSB().from('users').update({ projects:['AVR101'] }).eq('id', myUid);
--     ⚠️ And the add-only carve-out must refuse a REMOVAL bundled with a valid
--        add -- the one case a naive "is every added id my sandbox?" test would
--        wave through:
--       await getSB().from('users').update({ projects:['SBX-XXXXXX'] }).eq('id', myUid);
--                                                         // refused: drops real projects
--     …and the legitimate self-write must still WORK:
--       await getSB().from('users').update({ name:'New Name' }).eq('id', myUid);
--       // plus: sign out and back in — last_login must still be written
--
-- (d) As an ADMIN, through admin.html — unchanged: change a role, approve an
--     account, assign projects, delete a user, archive and delete a project.
--
-- (e) The function bodies actually took (both must be present):
--       select prosrc like '%is_sandbox%' as guard_knows_sandbox
--         from pg_proc where proname = 'users_guard_self_escalation';   -- t
--       select prosrc like '%insufficient_privilege%' as ensure_tolerates
--         from pg_proc where proname = 'sandbox_ensure';                -- t

-- ============================================================================
-- ROLLBACK — restores the 2026-08-11 guard and the 2026-09-17 sandbox_ensure()
-- exactly. ⚠️ Doing so reinstates the bug this file fixes: the sandbox becomes
-- uncreatable for every non-admin again.
-- ----------------------------------------------------------------------------
--   Re-run migrations/2026-08-11-fix-privilege-escalation.sql  (section 1), then
--   re-run migrations/2026-09-17-sandbox-project.sql           (section 4).
-- ============================================================================
