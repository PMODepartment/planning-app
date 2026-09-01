-- ============================================================================
-- Migration: Minutes of Meeting — recurring schedules, structured attendees,
-- venue/link/recording, and a per-action-item audit history + hold/close
-- narrative (mirroring the Issues & Concerns workflow shipped 2026-08-31).
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- ⚠️ WHY A SEPARATE `mom_schedules` TABLE INSTEAD OF A "frequency" COLUMN ON
--    `meeting_minutes`. A schedule describes a RECURRING COMMITMENT ("every
--    first Monday of the month") that exists independently of any meeting
--    that has actually happened yet — it needs to be defined, shown on the
--    calendar as a run of PLANNED dates, and used to pre-fill the next
--    occurrence, all before a single `meeting_minutes` row exists for it.
--    A column on the meeting row can only ever describe a meeting that has
--    already been created.
--
-- ⚠️ WHY `mom_items` GETS ITS OWN HISTORY TABLE RATHER THAN REUSING
--    `issues_lessons_history`. The two audit an unrelated primary key
--    (`issue_id` vs `item_id`) and unrelated rows — an insert-only audit
--    trail that mixed them would need a nullable, mutually-exclusive pair of
--    foreign keys, which is exactly the shape that lets a bug insert a row
--    naming neither. Two small tables, one obvious foreign key each.
--
-- ⚠️ NO UPDATE POLICY, NO DELETE POLICY on `mom_items_history` — same as
--    `issues_lessons_history` (2026-08-31): an audit trail a planner could
--    edit or remove after the fact is not an audit trail.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Recurring meeting schedules
-- ---------------------------------------------------------------------------
create table if not exists mom_schedules (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id),
  title          text not null,
  -- 'Internal' | 'External' — item #21's grouping. Free text, not a CHECK:
  -- the app's own picker only ever offers these two, but a CHECK would turn
  -- a legacy or hand-entered value into a hard failure rather than something
  -- the UI can still display and correct.
  meeting_group  text not null default 'Internal',
  -- 'weekly' | 'monthly_date' | 'monthly_weekday' | 'quarterly'. A biweekly
  -- (or any every-N-weeks) cadence is 'weekly' with interval_n=2 — one
  -- recurrence shape, not two, since they differ only in the step size.
  frequency      text not null default 'monthly_date',
  -- weekly: 0=Monday..6=Sunday, the day it recurs on.
  -- monthly_weekday: the weekday within week_ordinal (e.g. "first Monday").
  weekday        int,
  -- monthly_weekday only: 1..4, or -1 for "last" (the last such weekday
  -- in the month, so "last Friday" is still expressible in a short month).
  week_ordinal   int,
  -- monthly_date / quarterly: the day-of-month it recurs on (1..31; a month
  -- shorter than this clamps to its own last day — see PDCal-style clamping
  -- in the client, not enforced here).
  day_of_month   int,
  start_date     date not null default current_date,
  active         boolean not null default true,
  created_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists mom_schedules_project_idx on mom_schedules(project_id);

alter table mom_schedules enable row level security;

drop policy if exists mom_schedules_read on mom_schedules;
create policy mom_schedules_read on mom_schedules
  for select using (can_access_project(project_id));

-- Drop the generic loop policy in case a later sweep of "every module table"
-- ever adds one back — Postgres ORs permissive policies, so leaving it would
-- silently widen writes back to is_planner()-only or is_writer()-for-all.
drop policy if exists mom_schedules_write on mom_schedules;

-- ⚠️ Same per-row shape as meeting_minutes (2026-08-20-department-minutes.sql):
-- any approved non-viewer may define a schedule; a planner maintains all of
-- them, everyone else only the ones they created.
drop policy if exists mom_schedules_ins on mom_schedules;
create policy mom_schedules_ins on mom_schedules
  for insert with check (is_writer() and can_access_project(project_id));

drop policy if exists mom_schedules_upd on mom_schedules;
create policy mom_schedules_upd on mom_schedules
  for update using (
    can_access_project(project_id) and (is_planner() or created_by = auth.uid())
  ) with check (
    can_access_project(project_id) and (is_planner() or created_by = auth.uid())
  );

drop policy if exists mom_schedules_del on mom_schedules;
create policy mom_schedules_del on mom_schedules
  for delete using (
    can_access_project(project_id) and (is_planner() or created_by = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 2. meeting_minutes — link to a schedule, structured attendees, venue/link/
--    recording (item #20).
-- ---------------------------------------------------------------------------
alter table meeting_minutes add column if not exists schedule_id uuid references mom_schedules(id) on delete set null;
-- 'Internal' | 'External' (item #21) — independent of `meeting_type`, which
-- stays free text for the *label* ("PPR Meeting", "Client Meeting", …). A
-- one-off meeting with no recurring schedule still needs a group of its own,
-- so this is not derived from schedule_id.
alter table meeting_minutes add column if not exists meeting_group text;
alter table meeting_minutes add column if not exists venue text;
alter table meeting_minutes add column if not exists meeting_link text;
alter table meeting_minutes add column if not exists recording_url text;
-- ⚠️ jsonb, not a champion_ids-array + text pair per attendee tier (the
-- pattern `champion_ids`/`champion` uses) — three attendee tiers would
-- otherwise need six columns for what is fundamentally one shape
-- ({ids:[...], text:'...'}) repeated three times. Each is read/written as
-- one object by the client's existing People Picker component.
alter table meeting_minutes add column if not exists attendees_required jsonb;
alter table meeting_minutes add column if not exists attendees_optional jsonb;
alter table meeting_minutes add column if not exists attendees_actual   jsonb;

-- ---------------------------------------------------------------------------
-- 3. mom_items — hold/close narrative (item #23, mirroring issues_lessons).
-- ---------------------------------------------------------------------------
alter table mom_items add column if not exists hold_reason    text;
alter table mom_items add column if not exists closure_report text;

create table if not exists mom_items_history (
  id                    uuid primary key default gen_random_uuid(),
  item_id               uuid not null references mom_items(id) on delete cascade,
  project_id            text references projects(id),
  action                text not null,   -- 'create' | 'update' | 'hold' | 'close'
  note                  text,
  snapshot              jsonb,
  changed_by            uuid references users(id),
  changed_by_department text,
  changed_at            timestamptz not null default now()
);
create index if not exists mom_items_history_item_idx on mom_items_history (item_id, changed_at desc);

alter table mom_items_history enable row level security;

drop policy if exists mom_items_history_read on mom_items_history;
create policy mom_items_history_read on mom_items_history
  for select using (can_access_project(project_id));

drop policy if exists mom_items_history_write on mom_items_history;

drop policy if exists mom_items_history_ins on mom_items_history;
create policy mom_items_history_ins on mom_items_history
  for insert with check (is_writer() and can_access_project(project_id));

-- ⚠️ NO UPDATE POLICY. NO DELETE POLICY. On purpose — see the header comment.
