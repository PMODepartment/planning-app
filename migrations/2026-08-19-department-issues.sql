-- ============================================================================
-- Migration: (D1) DEPARTMENTS CAN RAISE ISSUES.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- ⚠️ WHAT THE AUDIT ACTUALLY FOUND, WHICH IS NOT WHAT THE REQUIREMENT ASSUMED.
--    "Departments can also add issues" reads like a permission that needs opening
--    up. It is not: `issues_lessons` is covered by the standard module-table
--    policy `for all using (is_writer() and can_access_project(project_id))`, and
--    `is_writer()` is "approved AND role <> 'viewer'" — so the `user` role could
--    ALREADY insert. The block was in the UI, which gated every write on
--    planner/admin/super_admin.
--
--    But the same policy is also too LOOSE in the other direction: it lets any
--    approved non-viewer UPDATE or DELETE *anyone else's* issue. Nobody intended
--    a department to be able to rewrite another department's entry, and once the
--    UI is opened up that stops being theoretical.
--
--    So this migration WIDENS nothing at the DB and TIGHTENS the write side:
--      insert  — any approved non-viewer, on a project they can access, and only
--                stamped as themselves.
--      update  — planner+ on anything; everyone else only their OWN rows.
--      delete  — planner+ only. A department raising an issue must not be able to
--                make it disappear; closing it is a status, and the record of a
--                problem having existed is the point of a register.
-- ============================================================================

-- ---- 1) The submitter's department ----------------------------------------
-- ⚠️ On `users`, not typed per issue. A department is a property of the PERSON
-- raising the issue; asking them to pick it every time invites a typo that
-- silently fragments the register's own Department filter — the same failure the
-- group_heads lookup exists to prevent. The issue keeps its own `department`
-- column (it is what the register groups by), defaulted from the profile.
alter table users add column if not exists department text;

-- ---- 2) The register's own write rules ------------------------------------
-- Replaces the generic loop policy for THIS table only; every other module table
-- keeps the standard rule.
alter table issues_lessons enable row level security;

drop policy if exists issues_lessons_read on issues_lessons;
create policy issues_lessons_read on issues_lessons
  for select using (can_access_project(project_id));

-- ⚠️ The generic `_write` policy must go, or it stays as a second permissive
-- policy and Postgres ORs them together — which would leave the loose behaviour
-- exactly as it was while this file looked like it had fixed it.
drop policy if exists issues_lessons_write on issues_lessons;

drop policy if exists issues_lessons_ins on issues_lessons;
create policy issues_lessons_ins on issues_lessons
  for insert with check (
    is_writer()
    and can_access_project(project_id)
    -- Stamped as yourself. Without this a department user could file an issue
    -- under someone else's name, and "who raised this?" stops being answerable.
    -- ⚠️ Planners/admins are exempt: the Minutes-of-Meeting "raise as issue" flow
    -- and any future bulk import legitimately create rows on behalf of others.
    and (created_by = auth.uid() or is_planner())
  );

drop policy if exists issues_lessons_upd on issues_lessons;
create policy issues_lessons_upd on issues_lessons
  for update using (
    can_access_project(project_id)
    and (is_planner() or (is_writer() and created_by = auth.uid()))
  ) with check (
    can_access_project(project_id)
    and (is_planner() or (is_writer() and created_by = auth.uid()))
  );

drop policy if exists issues_lessons_del on issues_lessons;
create policy issues_lessons_del on issues_lessons
  for delete using (is_planner() and can_access_project(project_id));

grant select, insert, update, delete on issues_lessons to authenticated;

-- ---- 3) No back-fill ------------------------------------------------------
-- ⚠️ Existing rows with a null `created_by` (imported, or created before the
-- stamp) become editable by planners only. That is the correct outcome: there is
-- no way to know whose they were, and guessing an owner would hand someone edit
-- rights over a record they never touched.

-- Done. A department can raise and maintain its own issues; planners still own
-- the register as a whole.
