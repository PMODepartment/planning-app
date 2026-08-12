-- ============================================================================
-- SECURITY FIX — privilege escalation via the users UPDATE policy
-- Planners Dashboard (bgupuqnkqhixpuctyder)                        2026-08-11
-- ----------------------------------------------------------------------------
-- Idempotent. Safe to re-run. Rollback at the bottom.
--
-- THE HOLE
-- Any approved user can make themselves super_admin with a single request:
--
--     await getSB().from('users').update({ role: 'super_admin' }).eq('id', myUid);
--
-- That grants every project, the Administration screen, and (in the Engineering
-- App) approval authority. It also works for `status` and `projects`.
--
-- CAUSE — the policy in supabase-schema.sql:559
--
--     create policy users_admin_update on users for update
--       using (auth.uid() = id or is_admin());
--
-- The `auth.uid() = id` branch is legitimate and necessary: users update their
-- own `name`, and db.js writes `last_login` on every sign-in. But the policy has
--   • no WITH CHECK clause, and
--   • no restriction on WHICH COLUMNS may change,
-- so "update your own row" silently included "update your own role".
--
-- WHY A TRIGGER AND NOT A BETTER POLICY
-- An RLS WITH CHECK expression is evaluated against the NEW row only — it cannot
-- see OLD, so it cannot express "role must not have changed". Postgres has no
-- column-level RLS. A BEFORE UPDATE trigger is the correct mechanism.
--
-- ⚠️ THIS SAME FIX IS ALREADY RUNNING IN PRODUCTION on the Engineering App
-- (zkxzaijznutmiueeurbb), migrations 0005 + 0006, where it was verified by
-- demoting a real account and confirming: escalation refused with 42501, while
-- admin user-management through admin.html still worked. The logic below is that
-- code with both lessons already folded in.
--
-- ============================================================================
-- COMPATIBILITY REVIEW — every existing write to `users` was checked first
-- ----------------------------------------------------------------------------
--   assets/js/auth.js  register()      inserts role='user', status='pending',
--                                      projects='{}'          → allowed by §2
--   assets/js/auth.js  ensureProfile() same three values       → allowed by §2
--   assets/js/db.js    updateUser()    admin.html only, is_admin() → exempt
--   assets/js/db.js    updateLastLogin() touches only last_login → unaffected,
--                        which matters: it runs for EVERY user on EVERY login
--   admin_delete_project() / admin_archive_project()
--                      `update users set projects = array_remove(...)`, but both
--                      begin with `if not is_admin() then raise exception`, so the
--                      caller is always an admin → exempt
--   auth.js isAutoApprove() is exported but never used to WRITE a status, so no
--                      client path self-assigns 'approved'
--
-- Nothing in the app changes behaviour. Only self-escalation stops working.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Block a non-admin changing their own privileges
-- ---------------------------------------------------------------------------
create or replace function users_guard_self_escalation() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() IS NULL = a trusted server-side session: the Supabase SQL editor,
  -- a service_role call, psql, a scheduled job. Those must stay able to
  -- administer, otherwise the documented bootstrap
  --     update users set role='super_admin' where email='…';
  -- stops working and a locked-out project becomes unrecoverable. (The Engineering
  -- App hit exactly that; it took a follow-up migration to undo.)
  --
  -- Not a new hole: the `anon` role also has no JWT, but anon never reaches this
  -- trigger — users_admin_update requires (auth.uid() = id or is_admin()), both
  -- false for anon, so RLS rejects the statement before any trigger fires. This
  -- guard stops a SIGNED-IN user escalating; RLS is what stops untrusted callers.
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'You may not change your own role.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    raise exception 'You may not change your own account status.' using errcode = '42501';
  end if;
  if new.projects is distinct from old.projects then
    raise exception 'You may not change your own project assignments.' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'You may not change a profile id.' using errcode = '42501';
  end if;

  return new;
end $$;

-- ⚠️ Plain BEFORE UPDATE, deliberately NOT `before update of role, status, …`.
-- An `UPDATE OF <cols>` trigger fires only when those columns appear in the SET
-- list, which makes the protection depend on how the client phrases its request.
-- For a security guard that is the wrong trade: always fire, then compare. (The
-- Engineering App's approval guard was written the other way and did not fire.)
drop trigger if exists users_guard_self_escalation on users;
create trigger users_guard_self_escalation
  before update on users
  for each row execute function users_guard_self_escalation();


-- ---------------------------------------------------------------------------
-- 2. Block a self-registration declaring itself pre-approved
-- ---------------------------------------------------------------------------
-- users_self_insert only checks `auth.uid() = id`, so a new registration could
-- self-declare role='super_admin', status='approved'. auth.js always sends
-- user/pending — but nothing enforced it, and the client is not the authority.
create or replace function users_guard_self_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;
  if new.role is distinct from 'user' or new.status is distinct from 'pending'
     or coalesce(array_length(new.projects, 1), 0) <> 0 then
    raise exception
      'A new account must be created as role=user, status=pending with no '
      'project assignments; an administrator grants access afterwards.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists users_guard_self_insert on users;
create trigger users_guard_self_insert
  before insert on users
  for each row execute function users_guard_self_insert();


-- ============================================================================
-- 3. VERIFY — do this, do not assume
-- ----------------------------------------------------------------------------
-- (a) Triggers installed and enabled ('O'):
--
--     select tgrelid::regclass as tbl, tgname, tgenabled
--     from pg_trigger
--     where not tgisinternal and tgname like 'users_guard%';
--
-- (b) The SQL editor can still administer (this must SUCCEED — if it raises,
--     the auth.uid() exemption is not working and you must roll back):
--
--     update users set role = 'planner'  where email = 'YOUR_TEST_ACCOUNT';
--     update users set role = 'planner'  where email = 'YOUR_TEST_ACCOUNT';  -- idempotent
--
-- (c) From the browser as a NON-ADMIN account (have an admin demote a test
--     account, or use a `user`/`planner` account) — all must be REFUSED 42501:
--
--     await getSB().from('users').update({ role:'super_admin' }).eq('id', myUid);
--     await getSB().from('users').update({ status:'approved'  }).eq('id', myUid);
--     await getSB().from('users').update({ projects:['AVR101'] }).eq('id', myUid);
--
--     …and these must still WORK:
--     await getSB().from('users').update({ name:'New Name' }).eq('id', myUid);
--     // plus: sign out and back in — last_login must still be written
--
-- (d) As an ADMIN, through admin.html — all must still work:
--       change someone's role, approve/reject an account, assign projects,
--       delete a user, archive and delete a project.
--
-- (e) Registration end to end: request access with a fresh email, confirm the
--     new row is role=user / status=pending, then approve it in admin.html.
-- ============================================================================


-- ============================================================================
-- ROLLBACK — if anything above misbehaves, this fully reverts the change.
-- The triggers are additive; dropping them restores the previous behaviour
-- exactly (including, deliberately, the escalation hole).
-- ----------------------------------------------------------------------------
--   drop trigger if exists users_guard_self_escalation on users;
--   drop trigger if exists users_guard_self_insert     on users;
--   drop function if exists users_guard_self_escalation();
--   drop function if exists users_guard_self_insert();
-- ============================================================================
