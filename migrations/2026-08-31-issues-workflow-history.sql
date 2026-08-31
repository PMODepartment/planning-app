-- ============================================================================
-- Migration: Issues & Concerns status workflow (Update / Put On Hold / Close)
-- plus a per-issue audit history.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- ⚠️ WHY TWO NEW TEXT COLUMNS INSTEAD OF REUSING `corrective_action`.
--    The owner's workflow replaces the free-standing status dropdown with three
--    buttons — Update Issue / Put On Hold / Close Issue — and each of the latter
--    two now REQUIRES its own narrative: a reason for the hold, and a closure
--    report (plus a lessons-learned entry, captured separately in
--    `lessons_learned`). Overloading `corrective_action` for all three would
--    make an On-Hold issue's "planned actions" text silently mean "why we
--    paused" instead, and a Closed issue's mean "how we closed it" — three
--    different questions sharing one column is exactly how a report ends up
--    quoting the wrong thing. `corrective_action` keeps meaning what it always
--    has (actions taken/planned while the issue is OPEN); `hold_reason` and
--    `closure_report` are shown INSTEAD of it once the issue leaves Open.
--
-- ⚠️ WHY A HISTORY TABLE AND NOT A jsonb ARRAY COLUMN ON THE ISSUE.
--    An array column embedded on the row it audits can be edited by anyone who
--    can edit the row — the audit and the thing it audits would share one
--    write permission. A separate, insert-only table with its own RLS (no
--    update/delete policy at all) is the only shape where "the previous issue
--    details are logged" can't itself be edited or deleted by whoever is
--    editing the issue.
-- ============================================================================

alter table issues_lessons add column if not exists hold_reason    text;
alter table issues_lessons add column if not exists closure_report text;

create table if not exists issues_lessons_history (
  id                    uuid primary key default gen_random_uuid(),
  issue_id              uuid not null references issues_lessons(id) on delete cascade,
  -- Denormalized project_id: RLS on this table reads it directly rather than
  -- joining back to issues_lessons on every read, and it survives even if the
  -- parent issue is one day allowed to move projects (it currently cannot).
  project_id            text references projects(id),
  -- 'create' | 'update' | 'hold' | 'close'. Free text, not an enum: this is an
  -- audit label read by the app, never a value anything else joins against.
  action                text not null,
  -- The hold reason / closure report AT THE TIME of this change, if the action
  -- carried one. Kept alongside the snapshot so the history reads as a story
  -- ("put on hold: waiting on client survey") without decoding jsonb.
  note                  text,
  -- The FULL issue row as it stood BEFORE this change was applied — "the
  -- previous issue details", verbatim, so any field's prior value can be
  -- recovered even if this specific history entry's `note` does not mention it.
  snapshot              jsonb,
  changed_by            uuid references users(id),
  -- ⚠️ Denormalized at write time from the actor's OWN profile, not resolved
  -- later by joining `users` — a department user has no business being
  -- granted a read of `users` just so a history entry can say who touched it,
  -- and department (not a name) is this app's established privacy floor for
  -- "whose was this" (see raisedByLabel() in the Issues module).
  changed_by_department text,
  changed_at            timestamptz not null default now()
);

create index if not exists issues_lessons_history_issue_idx
  on issues_lessons_history (issue_id, changed_at desc);

alter table issues_lessons_history enable row level security;

drop policy if exists issues_lessons_history_read on issues_lessons_history;
create policy issues_lessons_history_read on issues_lessons_history
  for select using (can_access_project(project_id));

-- The generic loop policy (if this table is ever swept into the module-table
-- array elsewhere) must go, or Postgres ORs it back in and a history row
-- becomes editable/deletable by anyone who can write the project.
drop policy if exists issues_lessons_history_write on issues_lessons_history;

drop policy if exists issues_lessons_history_ins on issues_lessons_history;
create policy issues_lessons_history_ins on issues_lessons_history
  for insert with check (
    is_writer() and can_access_project(project_id)
  );

-- ⚠️ NO UPDATE POLICY. NO DELETE POLICY. On purpose, and it is the whole
-- point: an audit trail that anyone (including a planner) could edit or
-- remove after the fact is not an audit trail. If a bad entry is ever written
-- by a bug, fixing it is a manual, logged, out-of-band DBA action — never a
-- feature this app exposes.
