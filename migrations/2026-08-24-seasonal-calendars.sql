-- ============================================================================
-- Migration: SEASONAL working calendars + opt-in Philippine special days.
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Extends the existing `calendars` master (2026-07-06-working-calendars.sql).
-- Nothing here is required: every column defaults to the behaviour calendars
-- already had, so rows saved before this migration keep resolving to exactly
-- the same dates.
-- ============================================================================

-- ---- 1) Seasonal work patterns ---------------------------------------------
-- ⚠️ WHY THIS LIVES ON THE CALENDAR AND NOT IN A DURATION SCENARIO. A scenario's
-- rain profile answers "how many working days does weather TAKE from us" — a
-- what-if, held per scenario so it cannot move the live schedule. A season
-- answers "which days do we WORK in the monsoon" — a decision the project has
-- already made, that must apply to the live schedule and to every scenario
-- alike. Modelling a wet-season 5-day week as rain days would silently make a
-- deliberate policy look like weather damage, and would vanish the moment the
-- planner previewed a different scenario.
--
-- Shape: [{ "id": "s1a2b3", "label": "Wet season - reduced week",
--           "months": [6,7,8,9],          -- calendar months (1-12) it governs
--           "hours_per_day": 6,           -- null/absent = use the calendar's own
--           "work_mon": true, ... "work_sun": false }]   -- absent = base pattern
-- Months no season covers fall back to the calendar's base pattern. The FIRST
-- season whose months include a date wins; the editor refuses to save
-- overlapping months rather than averaging them.
alter table calendars add column if not exists seasons jsonb default '[]'::jsonb;

-- ---- 2) Philippine special (non-working) days ------------------------------
-- ⚠️ OPT-IN, and the default must stay false. A special day is "no work, no pay"
-- rather than a regular holiday, and many sites work them; defaulting this to
-- true would have removed ~5 working days a year from every existing project's
-- calendar the moment it shipped, moving live forecast dates with nothing on
-- screen to explain it. The dates themselves are computed in JS
-- (assets/js/calendar.js) exactly like the regular holidays are.
alter table calendars add column if not exists observe_special_days boolean default false;

-- ---- 3) PAGASA climate type ------------------------------------------------
-- 'I' | 'II' | 'III' | 'IV' — the modified Coronas classification for where the
-- site is. Purely an INPUT to the presets: it seeds the season months in the
-- calendar editor and the rain-day profile in a duration scenario, and nothing
-- reads it at schedule time. Held here because it is a property of the project's
-- location, and re-picking it in every scenario is how a Mindanao project ends
-- up planned against a Luzon wet season.
alter table calendars add column if not exists climate_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'calendars_climate_type_chk') then
    alter table calendars add constraint calendars_climate_type_chk
      check (climate_type is null or climate_type in ('I','II','III','IV'));
  end if;
end $$;
