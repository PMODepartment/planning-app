-- ============================================================================
-- Migration: a NAME for a non-working date, and the column type the code has
-- assumed since 2026-09-03.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Owner, 2026-09-17: "For Calendar, when adding one-off dates, provide option to
-- add label."
--
-- ⚠️⚠️ PART 1 IS A BUG FIX THE ASK UNCOVERED, NOT PART OF THE FEATURE.
-- `calendars.extra_holidays` is declared `date[]` (2026-07-06-working-calendars
-- .sql), and NOTHING has ever altered it — checked across every migration and
-- both schema files. But the "fold repeating dates into one yearly entry" pass
-- writes ISO 8601 recurring keys of the form `--MM-DD` into that same array, and
-- its own note says so in as many words:
--
--     "THE STORAGE IS UNCHANGED, DELIBERATELY. A repeat is written into the SAME
--      `extra_holidays` array as the string `--MM-DD` ... no migration"
--
-- That reasoning is right about the CLIENT, which treats every element as a
-- string, and wrong about the COLUMN. `'--12-25'` is not a date, so on a
-- database matching this repo's schema, pressing **Add yearly day** or **Fold N
-- repeating dates** and then Save is refused by Postgres with
-- `22007 invalid input syntax for type date`. The whole "Repeats every year"
-- section of the calendar editor cannot be saved.
--
-- ⚠️ WIDENING IS THE RIGHT DIRECTION, and the evidence is that `text[]` is what
-- every reader already assumes:
--    * `PDCal.holidayIndex` does `String(list[i]).trim()` and `isRecurKey(v)`;
--    * `PDCal.isWorkDay` looks the day up by STRING key;
--    * the only SQL that touches the column anywhere is `array_length(...)`,
--      which is type-agnostic (`2026-08-24-dedupe-existing-calendars.sql`).
--    So no reader has to change, and no date arithmetic is lost — there was none.
-- ⚠️ `::text[]` renders a date as `YYYY-MM-DD`, which is exactly the ISO string
--    the client already compares against. Existing rows come through unchanged.
--
-- ⚠️⚠️ IF THE LIVE COLUMN IS ALREADY `text[]`, this migration is a no-op on that
-- part, and that is a real possibility: VERIFICATION.md documents measured drift
-- between /migrations and this database. The DO block checks the catalog rather
-- than assuming either way, so it is correct in both worlds.
-- ============================================================================

-- ---- 1) The type the code has always assumed -------------------------------
do $$
declare t text;
begin
  select atttypid::regtype::text into t
    from pg_attribute
   where attrelid = 'public.calendars'::regclass
     and attname  = 'extra_holidays'
     and attnum > 0 and not attisdropped;

  if t is null then
    raise notice 'calendars.extra_holidays does not exist - nothing to widen.';
  elsif t = 'text[]' then
    raise notice 'calendars.extra_holidays is already text[] - no change.';
  elsif t = 'date[]' then
    alter table public.calendars
      alter column extra_holidays type text[] using extra_holidays::text[];
    raise notice 'calendars.extra_holidays widened date[] -> text[].';
  else
    -- Refuse rather than guess: an unexpected type means somebody changed this
    -- column for a reason this file does not know about.
    raise exception 'calendars.extra_holidays is %, expected date[] or text[]. Not touched.', t;
  end if;
end $$;

comment on column public.calendars.extra_holidays is
  'Non-working dates, as STRINGS. An exact date is ISO ''YYYY-MM-DD''; a date that
   repeats every year is ISO 8601''s recurring form ''--MM-DD''. Read only ever as
   text (PDCal.holidayIndex / isRecurKey), which is why this is text[] and not
   date[] - the recurring form is not a date.';

-- ---- 2) The label ----------------------------------------------------------
-- ⚠️⚠️ A SIDECAR MAP, NOT AN ARRAY OF OBJECTS, and the reason is the hot path.
-- `PDCal.isWorkDay` is called ONCE PER CALENDAR DAY by addWorkingDays, which
-- walks up to 7,300 days to turn one duration into one finish date - and the
-- schedule dates thousands of activities. `holidayIndex` exists precisely
-- because a linear scan there cost "up to 1.6 MILLION string comparisons to date
-- a single activity". Turning every element into an object would put a property
-- dereference inside that loop and force every reader in three other modules
-- (productivity-rates, resource-loading, project-schedule) to learn a new shape
-- for a field they only ever count or compare.
-- A separate map costs the date-arithmetic path NOTHING: it is read only by the
-- editor, when drawing a chip.
--
-- ⚠️ KEYED BY THE SAME STRING THAT IS IN `extra_holidays` - an ISO date or a
-- `--MM-DD` recurring key. One map serves both kinds, so a yearly holiday can be
-- named ("Christmas") exactly as a one-off can ("Typhoon Egay shutdown").
-- ⚠️ A key with no entry is not an error: the chip falls back to the date, which
-- is precisely what every calendar shows today. So an unlabelled calendar, and a
-- calendar saved before this migration, read identically to before.
alter table public.calendars
  add column if not exists extra_holiday_labels jsonb default '{}'::jsonb;

comment on column public.calendars.extra_holiday_labels is
  'Optional name per entry in extra_holidays, keyed by the SAME string
   (''2026-12-26'' or ''--12-25''). Absent key = no name, and the UI falls back to
   the date. Read only by the calendar editor - never by the working-day
   arithmetic, which must stay a string lookup.';

-- ---- 3) Verify -------------------------------------------------------------
-- (a) Both columns, and the type that matters:
--       select column_name, data_type, udt_name
--         from information_schema.columns
--        where table_schema='public' and table_name='calendars'
--          and column_name in ('extra_holidays','extra_holiday_labels');
--     Expect extra_holidays -> ARRAY / _text  (NOT _date).
--
-- (b) ⚠️ THE CHECK THAT PROVES PART 1 WAS NEEDED. Before this migration the
--     following is refused on a date[] column; after it, it succeeds. Run it
--     inside a transaction and roll it back - it writes to a real calendar.
--       begin;
--         update calendars
--            set extra_holidays = array_append(extra_holidays, '--12-25')
--          where id = (select id from calendars limit 1);
--         select extra_holidays from calendars where id = (select id from calendars limit 1);
--       rollback;
--
-- (c) Existing dates survived the widening unchanged:
--       select id, name, extra_holidays from calendars
--        where coalesce(array_length(extra_holidays,1),0) > 0 limit 5;
--     Expect plain 'YYYY-MM-DD' strings, the same dates as before.
