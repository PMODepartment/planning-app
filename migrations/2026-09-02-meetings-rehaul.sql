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
-- ⚠️ A plain jsonb ARRAY OF STRINGS (["Review budget", "Site walk-through"]),
-- not a table of its own. An agenda item defined at series-creation time is
-- just a STARTING LIST of topics — the moment an occurrence is created each
-- one becomes a real `mom_items` row with the full action-item apparatus
-- (owner, due date, status workflow, history) behind it. A second table here
-- would just be a queue of text waiting to become the thing mom_items
-- already is; the array is that queue and nothing more.
alter table mom_schedules add column if not exists default_agenda jsonb;
