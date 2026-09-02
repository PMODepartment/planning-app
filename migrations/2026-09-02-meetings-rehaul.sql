-- ============================================================================
-- Migration: Minutes of Meeting rehaul — meeting start/end time, favorites,
-- and recurring series carry their own defaults (venue/link/attendees/agenda/
-- time/end date) so a series is a real, browsable object from the moment it
-- is created, not just a rule that produces meetings once one exists.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- ⚠️ WHY `mom_schedules` NEEDS ITS OWN venue/link/attendees/agenda, NOT ONLY
--    `meeting_minutes`. Before this, a recurring series' "+ Add a meeting"
--    form could only default from the LAST HELD occurrence — a brand-new
--    series with no occurrence yet had nothing to show, and the unified
--    Meetings list (list + series in one list, per the rehaul) has no
--    occurrence to read attendee-count / location from until one exists.
--    So the series itself now carries the same defaults a standalone meeting
--    does; "+ Add a meeting" still prefers the most recent occurrence when
--    one exists (a schedule drifts over time — the series' own values are
--    the STARTING point, not a value that silently overrides what actually
--    happened last time).
--
-- ⚠️ WHY start_time/end_time ARE TEXT ('HH:MM'), NOT a Postgres `time`.
--    Every other date-shaped field this module writes comes straight off an
--    <input>'s .value with no Date object in between (meeting_date is a real
--    `date` column but is always read/written as its own 'YYYY-MM-DD' string
--    — never parsed into a JS Date, which is how this app's local-vs-UTC bugs
--    keep happening). A `time` column adds a server-side type Supabase-js has
--    to round-trip faithfully for no benefit here — nothing in this module
--    does time arithmetic in SQL, only in the client (the week-view grid).
--
-- ⚠️ WHY `end_date` ON `mom_schedules`, NOT JUST `start_date`. Every
--    recurring series before this was open-ended forever — schedDatesInRange
--    would produce planned dates into the far future with no way to stop.
--    Nullable: a null end_date means "no end", the same as before this
--    column existed, so no existing schedule's behaviour changes on migrate.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. meeting_minutes — start/end time (planned), actual start/end time (once
--    held), and a favorite flag.
-- ---------------------------------------------------------------------------
alter table meeting_minutes add column if not exists start_time text;
alter table meeting_minutes add column if not exists end_time   text;
-- ⚠️ Separate columns from start_time/end_time, not the same field reused
-- once the meeting is over — a meeting that ran long or started late needs
-- BOTH the plan and what actually happened on the record at once (the same
-- reason attendees_required and attendees_actual are two columns, not one).
alter table meeting_minutes add column if not exists actual_start_time text;
alter table meeting_minutes add column if not exists actual_end_time   text;
alter table meeting_minutes add column if not exists is_favorite boolean not null default false;
create index if not exists meeting_minutes_favorite_idx on meeting_minutes(project_id, is_favorite);

-- ---------------------------------------------------------------------------
-- 2. mom_schedules — end date, favorite, and its own venue/link/attendees/
--    agenda/time defaults (see header comment).
-- ---------------------------------------------------------------------------
alter table mom_schedules add column if not exists end_date date;
alter table mom_schedules add column if not exists is_favorite boolean not null default false;
alter table mom_schedules add column if not exists venue text;
alter table mom_schedules add column if not exists meeting_link text;
alter table mom_schedules add column if not exists start_time text;
alter table mom_schedules add column if not exists end_time   text;
alter table mom_schedules add column if not exists attendees_required jsonb;
alter table mom_schedules add column if not exists attendees_optional jsonb;
-- ⚠️ Genuinely missing from the table that created `mom_schedules` — the
-- weekly-recurrence code path (schedDatesInRange / scheduleRuleFieldsHTML)
-- has read/written `interval_n` since that table was introduced, but the
-- CREATE TABLE never declared the column, so "every 2 weeks" has silently
-- been writing to nothing and always recurring weekly. Backfilled to 1
-- (weekly, the default before this existed) rather than left null, since
-- schedDatesInRange treats a null interval as falsy and falls back to 1
-- anyway — the default just makes that explicit in the schema too.
alter table mom_schedules add column if not exists interval_n int not null default 1;

-- ---------------------------------------------------------------------------
-- 3. meeting_minutes.agenda — the meeting's own agenda list.
--
-- ⚠️ WHY A jsonb ARRAY AND NOT `mom_items` ROWS. An agenda is the list of
--    TOPICS a meeting intends to cover; a minute is the RECORD of what was
--    said about one of them, with its own department, responsible, target
--    date, hold/close workflow and audit history. Modelling the agenda as
--    mom_items rows would mean every topic nobody ended up minuting still
--    shows up as an empty minute in the register, in the exports and in the
--    dashboard counts. Same array-of-strings shape as
--    mom_schedules.default_agenda above, so a recurring series' default
--    agenda copies straight across with no transformation.
-- ---------------------------------------------------------------------------
alter table meeting_minutes add column if not exists agenda jsonb;

-- ---------------------------------------------------------------------------
-- 4. mom_items — a minute's own department and its own discussed activity.
--
-- ⚠️ WHY `department` RATHER THAN REUSING `category`. `mom_items.category`
--    came from mom-app's own taxonomy (Technical / Commercial / Safety / …),
--    a second classifying dimension that meant roughly the same thing as the
--    department already carried by every issue in Issues & Concerns — and
--    could disagree with it, which is exactly the drift that made
--    issues_lessons drop its own "lesson category" in favour of department
--    (2026-09-01(d)). The department vocabulary is now the single one, read
--    from the same 11-value list the register's own picker offers, so a
--    minute pulled in from an issue keeps the department it was raised
--    under instead of being re-classified into a parallel scheme.
-- ⚠️ `category` IS NOT DROPPED. Existing rows still hold real values, the
--    exports still print whatever is there, and a destructive drop of a
--    populated column is not something a feature migration should do — it
--    simply stops being offered as an editor.
-- ---------------------------------------------------------------------------
alter table mom_items add column if not exists department text;
-- ⚠️ The activity discussed moves from the MEETING to the MINUTE. One
--    meeting covers several activities; tagging the whole meeting with one
--    of them was only ever true of a single-topic meeting, and it is the
--    individual minute that a schedule activity is actually about.
--    `meeting_minutes.schedule_activity_id` is left in place (populated on
--    existing meetings, still printed by the exports) rather than migrated —
--    a meeting-level tag is not wrong, only coarse, and rewriting it into
--    one arbitrary minute would invent a precision nobody recorded.
alter table mom_items add column if not exists schedule_activity_id text;
-- One minute, one department index — the dashboard groups by it (Minutes by
-- Department) across every meeting on the project.
create index if not exists mom_items_department_idx on mom_items(project_id, department);
-- ⚠️ A plain jsonb ARRAY OF STRINGS (["Review budget", "Site walk-through"]),
-- not a table of its own. An agenda item defined at series-creation time is
-- just a STARTING LIST of topics — the moment an occurrence is created each
-- one becomes a real `mom_items` row with the full action-item apparatus
-- (owner, due date, status workflow, history) behind it. A second table here
-- would just be a queue of text waiting to become the thing mom_items
-- already is; the array is that queue and nothing more.
alter table mom_schedules add column if not exists default_agenda jsonb;
