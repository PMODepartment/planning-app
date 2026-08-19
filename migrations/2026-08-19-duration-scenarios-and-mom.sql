-- ============================================================================
-- Migration: (C3) DURATION SCENARIOS and (C4) MINUTES OF MEETING.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Two unrelated features share one file only because they ship together; the
-- two halves are independent and either can be dropped without the other.
-- ============================================================================


-- ============================================================================
-- C3) DURATION SCENARIOS — "what does this schedule look like in a wet season?"
--
-- ⚠️ NOT the same thing as `schedule_scenarios`, which already exists. That is a
--    whole-schedule SNAPSHOT (P6/OPC "Reflections") you restore. This is a set
--    of RULES that derives adjusted durations from the live schedule, so it
--    stays meaningful as the schedule changes underneath it. A snapshot answers
--    "what did it look like on Tuesday"; a duration scenario answers "what would
--    it look like if every exterior activity ran 25% slower from June".
--
-- WHY rules and not a second copy of the durations: a copy is stale the moment
-- anyone edits an activity, and a planner would have to re-apply the wet-season
-- assumption by hand after every change. Rules re-evaluate.
-- ============================================================================
create table if not exists duration_scenarios (
  id            uuid primary key default gen_random_uuid(),
  project_id    text not null references projects(id) on delete cascade,
  name          text not null,
  description   text,
  -- ⚠️ THE CALENDAR LINK — this is what makes a scenario mean anything in DATES
  -- rather than in day-counts. A stretched duration only moves a finish date if
  -- something knows which days are working days; that is the calendar's job
  -- (working-day pattern + extra_holidays). Null = use each activity's own
  -- calendar, which is the honest default for a project with several.
  calendar_id   uuid references calendars(id) on delete set null,
  -- Ordered list of rules. Each:
  --   { "id": "...", "label": "Wet season - exterior",
  --     "months": [6,7,8,9,10,11],        -- calendar months it applies in (1-12); [] = all year
  --     "trades": ["Structural Works"],   -- work_type match; [] = any
  --     "phases": ["construction"],       -- phase match; [] = any
  --     "scope":  "",                     -- '' | 'main' | 'change_order'
  --     "factor": 1.25,                   -- multiply the duration
  --     "add_days": 0 }                   -- ...then add this many
  -- ⚠️ Rules are evaluated IN ORDER and their effects COMPOUND, which is why the
  -- list is ordered and not a set: "wet season +25%" then "high-rise +2 days"
  -- is a different (and intended) answer from applying only the larger of the two.
  rules         jsonb default '[]'::jsonb,
  -- ⚠️ RAIN DAYS are a SECOND, different mechanism from `rules`, and conflating
  -- them is the mistake this comment exists to prevent:
  --   a RULE stretches a duration      — "this work runs 25% slower when it is wet"
  --   a RAIN DAY removes a working day — "we lose 8 days to weather in July"
  -- A planner needs both, and they compose: 10 days x 1.25 = 13 days of work, then
  -- laid onto a calendar that gives up 8 of July's working days.
  -- Shape: { "6": 4, "7": 8, "8": 8, "9": 6 } — calendar month (1-12) -> days lost.
  -- ⚠️ Held on the SCENARIO, not written into the calendar's extra_holidays: a
  -- calendar is shared by every activity and every scenario on the project, so
  -- baking one scenario's weather assumption into it would silently move dates in
  -- the live schedule and in every other scenario.
  rain_days     jsonb default '{}'::jsonb,
  created_by    uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists duration_scenarios_project_idx on duration_scenarios (project_id, name);

alter table duration_scenarios enable row level security;
drop policy if exists duration_scenarios_read on duration_scenarios;
create policy duration_scenarios_read on duration_scenarios
  for select using (can_access_project(project_id));
drop policy if exists duration_scenarios_write on duration_scenarios;
create policy duration_scenarios_write on duration_scenarios
  for all using (is_planner() and can_access_project(project_id))
       with check (is_planner() and can_access_project(project_id));
grant select, insert, update, delete on duration_scenarios to authenticated;


-- ============================================================================
-- C4) MINUTES OF MEETING — captured against the project, with action items that
--     become entries in the Issues & Concerns register.
--
-- WHY the action items are their own table and not jsonb on the MOM: an action
-- item has to be findable, assignable and closable on its own, and it has to be
-- able to POINT AT an issue row. A jsonb blob can hold the text but cannot be
-- joined, filtered by owner, or referenced by the issue it raised.
-- ============================================================================
create table if not exists meeting_minutes (
  id            uuid primary key default gen_random_uuid(),
  project_id    text not null references projects(id) on delete cascade,
  title         text not null,
  meeting_date  date,
  location      text,
  attendees     text,
  notes         text,
  -- Optional link to the schedule the meeting was about. Free text on purpose:
  -- it holds `project_schedule.activity_id` (the stable P6/business key), NOT the
  -- row uuid — the same rule the drawing-register link follows, because a row
  -- uuid changes on every "Replace" import while the activity id does not.
  schedule_activity_id text,
  created_by    uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists mom_items (
  id            uuid primary key default gen_random_uuid(),
  mom_id        uuid not null references meeting_minutes(id) on delete cascade,
  project_id    text not null references projects(id) on delete cascade,
  seq           int default 0,
  description   text not null,
  owner         text,
  due_date      date,
  status        text default 'Open' check (status in ('Open', 'In Progress', 'Closed')),
  -- ⚠️ The link to the register. `on delete set null`, deliberately: deleting the
  -- issue must not delete the minute it came out of — the MOM is the record of
  -- what was said, and it stays true whatever happens to the issue afterwards.
  issue_id      uuid references issues_lessons(id) on delete set null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists meeting_minutes_project_idx on meeting_minutes (project_id, meeting_date desc);
create index if not exists mom_items_mom_idx on mom_items (mom_id, seq);
create index if not exists mom_items_issue_idx on mom_items (issue_id);

-- The reciprocal pointer, so the register can say "this came out of a meeting"
-- without scanning mom_items.
alter table issues_lessons add column if not exists mom_id uuid references meeting_minutes(id) on delete set null;
create index if not exists issues_lessons_mom_idx on issues_lessons (mom_id);

do $$
declare t text;
begin
  foreach t in array array['meeting_minutes', 'mom_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all using (is_planner() and can_access_project(project_id)) with check (is_planner() and can_access_project(project_id))', t || '_write', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- Keep updated_at honest on all three (the registers report "last activity").
create or replace function touch_updated_at()
  returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['duration_scenarios', 'meeting_minutes', 'mom_items'] loop
    execute format('drop trigger if exists %I on %I', t || '_touch', t);
    execute format('create trigger %I before update on %I for each row execute function touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- Done.
