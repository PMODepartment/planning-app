-- ============================================================================
-- Bug fix: RLS infinite recursion ("stack depth limit exceeded", code 54001).
-- Run in the Supabase SQL editor. Idempotent.
--
-- Cause: RLS policies call is_admin()/is_approved()/can_access_project(), which
-- SELECT from `users`. The `users` table's own policy also calls is_admin(),
-- which re-queries `users` → the policy recurses until the stack overflows.
-- Empty tables didn't trip it (no rows to evaluate); tables WITH rows (projects,
-- risk_register, drawing_register — incl. the DEMO01 seed) did.
--
-- Fix: mark the helpers SECURITY DEFINER so they read `users` as the function
-- owner, bypassing RLS on `users` and breaking the recursion. `set search_path`
-- keeps them safe. They only inspect the current auth.uid()'s own attributes.
-- ============================================================================

create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users u
    where u.id = auth.uid() and u.status = 'approved' and u.role in ('admin','super_admin')
  );
$$;

create or replace function is_approved() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.status = 'approved');
$$;

create or replace function can_access_project(pid text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users u
    where u.id = auth.uid() and u.status = 'approved'
      and (u.role in ('admin','super_admin') or pid = any(u.projects))
  );
$$;
