-- ============================================================================
-- Migration: LESSONS LEARNED BECOMES ITS OWN RECORD.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- ⚠️ WHY A TABLE AND NOT THREE MORE COLUMNS. A lesson used to live as
--    `lesson_learned` / `lesson_category` / `recommendation` ON the issue, which
--    forced three things that are all wrong:
--      1. ONE lesson per issue. A six-month dispute teaches more than one thing,
--         and the second one had nowhere to go.
--      2. NO lesson without an issue. Meetings produce lessons that were never
--         a problem anybody logged, and a lesson learned on another project has
--         no issue in THIS register at all.
--      3. The capture form was welded to the issue form — you could not write a
--         lesson without opening the issue that "owned" it.
--
--    A lesson is a knowledge artefact with its own life: it is captured once and
--    read on future projects long after the issue that produced it closed. It
--    LINKS to what produced it (an issue, a meeting, or an action item) and all
--    three links are OPTIONAL — an unlinked lesson is a legitimate record, not a
--    broken one.
--
-- ⚠️ THE OLD COLUMNS ARE KEPT AND ARE NOT DROPPED. They are backfilled into this
--    table below, and the app stops writing them. Dropping them would destroy the
--    only copy for anyone still running an older tab, and they cost nothing left
--    in place. Do not "tidy" them away without checking every deployed client.
-- ============================================================================

create table if not exists lessons_learned (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id),

  -- ---- What produced this lesson. ALL THREE ARE OPTIONAL --------------------
  -- ⚠️ `on delete set null`, never cascade. A lesson outlives its source: that is
  -- the whole point of a lessons library. Deleting the issue must strip the link,
  -- not the knowledge.
  issue_id       uuid references issues_lessons(id) on delete set null,
  mom_id         uuid references meeting_minutes(id) on delete set null,
  mom_item_id    uuid references mom_items(id) on delete set null,

  department     text,
  category       text,                    -- Schedule | Cost | Quality | …
  lesson         text,                    -- what was learned
  recommendation text,                    -- what to do differently next time
  date_captured  date default current_date,

  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists lessons_learned_proj_idx
  on lessons_learned (project_id, date_captured desc);
-- The two lookups the module actually does: "what did this issue teach us" and
-- "what did this meeting teach us".
create index if not exists lessons_learned_issue_idx on lessons_learned (issue_id);
create index if not exists lessons_learned_mom_idx   on lessons_learned (mom_id);

-- ---- Write rules ----------------------------------------------------------
-- Mirrors issues_lessons (2026-08-19-department-issues.sql) with ONE deliberate
-- difference, at DELETE.
alter table lessons_learned enable row level security;

drop policy if exists lessons_learned_read on lessons_learned;
create policy lessons_learned_read on lessons_learned
  for select using (can_access_project(project_id));

-- The generic loop policy must go or Postgres ORs it back in.
drop policy if exists lessons_learned_write on lessons_learned;

drop policy if exists lessons_learned_ins on lessons_learned;
create policy lessons_learned_ins on lessons_learned
  for insert with check (
    is_writer()
    and can_access_project(project_id)
    and (created_by = auth.uid() or is_planner())
  );

drop policy if exists lessons_learned_upd on lessons_learned;
create policy lessons_learned_upd on lessons_learned
  for update using (
    can_access_project(project_id)
    and (is_planner() or created_by = auth.uid())
  );

-- ⚠️ DELETE IS WIDER HERE THAN ON THE REGISTER, ON PURPOSE. An issue may not be
-- deleted by the department that raised it: the record of a problem having
-- existed is the point of a register, and closing it is a status. A lesson is
-- not a record of a problem — it is something someone wrote down. A lesson typed
-- into the wrong project, or duplicated, is noise in a library everyone reads,
-- and its author is the right person to remove it.
drop policy if exists lessons_learned_del on lessons_learned;
create policy lessons_learned_del on lessons_learned
  for delete using (
    can_access_project(project_id)
    and (is_planner() or created_by = auth.uid())
  );

-- ---- Backfill --------------------------------------------------------------
-- Every lesson captured on an issue becomes a row here, linked back to it.
-- ⚠️ Guarded by `not exists`, so re-running this file does not duplicate a
-- lesson someone has since edited here.
insert into lessons_learned
  (project_id, issue_id, mom_id, department, category, lesson, recommendation,
   date_captured, created_by, created_at)
select
  i.project_id, i.id, i.mom_id, i.department, i.lesson_category,
  i.lesson_learned, i.recommendation,
  coalesce(i.date_resolved, i.date_presented, i.created_at::date),
  i.created_by, coalesce(i.updated_at, i.created_at, now())
from issues_lessons i
where i.lesson_learned is not null
  and btrim(i.lesson_learned) <> ''
  and not exists (
    select 1 from lessons_learned l where l.issue_id = i.id
  );

-- ⚠️ NOT DONE, DELIBERATELY: clearing issues_lessons.lesson_learned after the
-- copy. If this file is ever re-run against a database where someone deleted a
-- backfilled lesson on purpose, a cleared source column means the `not exists`
-- guard silently resurrects nothing — but a cleared column ALSO means an older
-- deployed tab reading the issue shows a lesson that has vanished. Leaving the
-- source intact keeps both readings truthful; the app is what decides which one
-- is authoritative, and it reads this table.
