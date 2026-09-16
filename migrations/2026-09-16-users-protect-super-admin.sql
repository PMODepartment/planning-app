-- ============================================================================
-- Migration: an admin can no longer change a super_admin's account.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Owner, 2026-09-16, on the Users page: "if I am an admin, I should not be
-- able to change the access of super_admin but I should be able to see who
-- are super_admin."
--
-- ⚠️ READING WAS ALREADY RIGHT and needs no change. `users_self_read`
-- (supabase-schema.sql) is `auth.uid() = id or is_admin()`, and `is_admin()`
-- is true for BOTH `admin` and `super_admin` — so a plain admin already reads
-- every super_admin's row in full: name, email, role, department, status,
-- projects, module_access. That is the "should be able to see who are
-- super_admin" half, and it is the admin.html Users table's own Access
-- column (2026-09-15) that already states it in words ("+ all modules").
--
-- ⚠️ WRITING WAS NOT RIGHT. `users_admin_update` was the same undifferentiated
-- OR — `auth.uid() = id or is_admin()` — so a plain admin could change a
-- super_admin's role, status, projects or module_access through the exact
-- same UPDATE every admin action on that page already uses
-- (`assets/js/db.js` `PDb.updateUser`, `sb().from('users').update(...)`).
-- That function has exactly one caller in the whole app — admin.html — so
-- tightening it changes nothing for any self-service profile path; there is
-- none through this write.
--
-- ⚠️⚠️ THIS BRINGS UPDATE INTO LINE WITH A RULE THAT ALREADY EXISTS FOR
-- DELETE, RATHER THAN INVENTING A NEW ONE. `admin_delete_user()` has said
-- since it was written: "only a super_admin may delete a super_admin." UPDATE
-- was the one action on this same row left open. New `is_super_admin()`
-- mirrors `is_admin()`'s own shape (a `security definer` read of the caller's
-- OWN row, to avoid the 54001 recursion a plain policy subquery on `users`
-- would hit) rather than testing `auth.uid() = target-of-is_admin`, which
-- would be a different, wrong question — the actor's role, not the target's.
--
-- ⚠️⚠️ THE WHOLE ROW IS LOCKED, NOT A COLUMN LIST. A policy has no per-column
-- granularity without a trigger, and "department is fine but role silently
-- fails" is a worse admin.html experience than one rule an admin can learn
-- once: a super_admin's row is untouchable by anyone but a super_admin (or
-- themselves — `auth.uid() = id` is unchanged, so a super_admin editing their
-- own row, or an ordinary user's own self-service update if one is ever
-- added, is not affected by any of this).
--
-- ⚠️⚠️ CHECKED ON BOTH SIDES OF THE UPDATE, and BOTH are load-bearing:
--   - `using` reads the row's CURRENT role — without it, a plain admin could
--     still edit an existing super_admin's row down to a lower role, because
--     the row's NEW role (`admin`, say) would satisfy a check that only looks
--     at the post-write value.
--   - `with check` reads the row's NEW role — without it, a plain admin could
--     still promote an ordinary user straight to super_admin, because the
--     row's OLD role (not yet super_admin) would satisfy a check that only
--     looks at the pre-write value.
--   Dropping either half re-opens exactly one of those two, so this migration
--   sets both together rather than the one that reproduces the reported bug.
--
-- ⚠️ `admin.html`'s own UI is updated in the same commit to disable the Role
-- select, Approve/Reject, Modules and Delete controls for a super_admin row
-- when the signed-in user is a plain admin — but that is a courtesy (no
-- confusing "Saved" toast over a write RLS silently discarded), not the
-- enforcement. This migration is the enforcement; the client cannot be
-- trusted for it on its own.
-- ============================================================================

create or replace function is_super_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users u
    where u.id = auth.uid()
      and u.status = 'approved'
      and u.role = 'super_admin'
  );
$$;

drop policy if exists users_admin_update on users;
create policy users_admin_update on users for update
  using (auth.uid() = id or (is_admin() and (role <> 'super_admin' or is_super_admin())))
  with check (auth.uid() = id or (is_admin() and (role <> 'super_admin' or is_super_admin())));

-- ---- Verify -----------------------------------------------------------------
-- (a) The function exists.
-- select proname from pg_proc where proname = 'is_super_admin';
--
-- (b) The policy carries both clauses now (not just `qual`).
-- select polname, pg_get_expr(polqual, polrelid) as using_expr,
--        pg_get_expr(polwithcheck, polrelid) as check_expr
--   from pg_policy where polname = 'users_admin_update';
--
-- (c) Sign in as a plain `admin` (not super_admin) and try, e.g. from the
--     Users page: changing a super_admin's role, status, or Modules should
--     now fail (or, with the same-commit UI change, the controls are simply
--     disabled). Signed in as a `super_admin`, every control on every row —
--     including other super_admin rows — behaves exactly as before.
