-- ============================================================================
-- Calendars: a per-weekday work schedule, and per-year exclusions for a
-- recurring non-working day.
-- 2026-09-17
--
-- Owner, on the Schedule Setup Calendars step: *"provide a calendar view of a
-- week from Monday to Sunday ... ask also working schedule from day from what
-- time to what time as well as the break time"*, and, for the annual
-- non-working days: *"allow also user to define if this is excluded for a
-- specific year."*
--
-- ⚠️⚠️ TWO COLUMNS, AND NEITHER REPLACES WHAT IS THERE.
--
--  • `day_hours` holds the AUTHORING shape of the working week — per weekday,
--    a start, an end and the breaks taken out of it. `hours_per_day` stays
--    exactly where it is and keeps its meaning: it is the scalar every other
--    reader in this app already multiplies by a day count (the FTE histogram,
--    resource capacity, `workingHoursInRange`, a season's fallback). The app
--    writes it as the AVERAGE over the working days it can see, so a reader
--    that knows nothing about `day_hours` still gets the right total over a
--    week — and a calendar with no `day_hours` at all behaves byte-identically
--    to the day before this ran.
--
--  • `extra_holiday_excludes` is a sidecar map keyed by the SAME string that
--    sits in `extra_holidays`, exactly as `extra_holiday_labels` already is:
--    { "--12-25": [2027, 2029] } = "this annual day is not observed in 2027 or
--    2029". A sidecar rather than a shape change, for the reason the
--    `--MM-DD` note in assets/js/calendar.js already gives: `extra_holidays`
--    is read by several modules and a reader that has not been taught about a
--    new element shape must not crash on it.
--
-- ⚠️ Neither column is required. The app drops an unknown column and retries
-- (the `_missingCol` path in the calendar editor's save), so a database that
-- has not run this keeps saving calendars — it simply cannot store a per-day
-- schedule or a year exclusion, and says so on screen rather than failing.
--
-- Safe to re-run.
-- ============================================================================

alter table public.calendars
  add column if not exists day_hours jsonb default '{}'::jsonb;

alter table public.calendars
  add column if not exists extra_holiday_excludes jsonb default '{}'::jsonb;

comment on column public.calendars.day_hours is
  'Per-weekday work schedule: {"mon":{"start":"08:00","end":"17:00","breaks":[{"start":"12:00","end":"13:00"}]}}. Authoring shape only — hours_per_day stays the canonical scalar and is written as the average over working days.';

comment on column public.calendars.extra_holiday_excludes is
  'Years in which a recurring extra_holidays entry is NOT observed, keyed by the same string: {"--12-25":[2027]}.';

-- ⚠️ A null would make every reader write `coalesce(...)` for ever; the column
-- defaults to {} for new rows, so existing rows are brought into line with it.
update public.calendars set day_hours = '{}'::jsonb where day_hours is null;
update public.calendars set extra_holiday_excludes = '{}'::jsonb where extra_holiday_excludes is null;

-- ---------------------------------------------------------------------------
-- VERIFY (one statement — the SQL editor shows only the last result)
-- ---------------------------------------------------------------------------
select 'day_hours' as column_name,
       (select data_type from information_schema.columns
         where table_schema = 'public' and table_name = 'calendars' and column_name = 'day_hours') as type,
       (select count(*) from public.calendars where day_hours is null) as nulls_left
union all
select 'extra_holiday_excludes',
       (select data_type from information_schema.columns
         where table_schema = 'public' and table_name = 'calendars' and column_name = 'extra_holiday_excludes'),
       (select count(*) from public.calendars where extra_holiday_excludes is null);
