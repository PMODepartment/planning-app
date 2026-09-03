// ============================================================================
// Planners Dashboard — Shared working-calendar math (PDCal)
// ----------------------------------------------------------------------------
// Used by the resource-loading module (Calendars tab) and the project-schedule
// module (FTE / Max-Availability histogram) to answer "is this date a working
// day, and how many working hours does a calendar give us in this period."
//
// A calendar row (from the `calendars` table) is a weekday work-pattern +
// hours/day + an editable extra-holiday list. Philippine *regular* holidays
// with fixed or Easter-derived dates are computed here rather than stored —
// only Eid'l Fitr/Eid'l Adha and any ad-hoc proclamation-moved dates need to
// go in a calendar's extra_holidays, since those are announced yearly by the
// Philippine government and can't be computed offline.
// ============================================================================

(function (global) {
  'use strict';

  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Anonymous Gregorian algorithm (Meeus/Jones/Butcher) — used for Maundy
  // Thursday / Good Friday, which are defined relative to Easter Sunday.
  function easterSunday(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31);
    var day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  function lastMondayOfAugust(y) {
    var d = new Date(y, 8, 0);           // last day of August
    var back = (d.getDay() + 6) % 7;     // days back to the preceding Monday
    d.setDate(d.getDate() - back);
    return d;
  }

  // Philippine *regular* holidays (RA 9849 + standing proclamations) that fall
  // on a fixed or Easter-derived date every year, WITH their names. Does NOT include
  // Eid'l Fitr / Eid'l Adha (lunar, announced yearly) or ad-hoc proclamation-moved
  // dates — add those to a calendar's extra_holidays instead.
  // ⚠️ The NAMES are not decoration. A planner looking at a calendar has to be able to
  // check that the built-in list is the one they expect before they trust a finish
  // date to it; a bare set of ISO strings cannot be checked at all.
  var _cache = {}, _specCache = {};
  function phRegularHolidayList(y) {
    var easter = easterSunday(y);
    var maundy = new Date(easter); maundy.setDate(easter.getDate() - 3);
    var good = new Date(easter); good.setDate(easter.getDate() - 2);
    return [
      { date: iso(new Date(y, 0, 1)),   name: "New Year's Day" },
      { date: iso(maundy),              name: 'Maundy Thursday' },
      { date: iso(good),                name: 'Good Friday' },
      { date: iso(new Date(y, 3, 9)),   name: 'Araw ng Kagitingan' },
      { date: iso(new Date(y, 4, 1)),   name: 'Labor Day' },
      { date: iso(new Date(y, 5, 12)),  name: 'Independence Day' },
      { date: iso(lastMondayOfAugust(y)), name: 'National Heroes Day' },
      { date: iso(new Date(y, 10, 30)), name: 'Bonifacio Day' },
      { date: iso(new Date(y, 11, 25)), name: 'Christmas Day' },
      { date: iso(new Date(y, 11, 30)), name: 'Rizal Day' }
    ];
  }
  function phRegularHolidays(y) {
    if (_cache[y]) return _cache[y];
    var set = {};
    phRegularHolidayList(y).forEach(function (h) { set[h.date] = h.name; });
    return (_cache[y] = set);
  }

  // Philippine SPECIAL (non-working) days that recur on a fixed or Easter-derived
  // date. ⚠️ These are OPT-IN per calendar (`observe_special_days`), because they are
  // not the same animal as a regular holiday: a special day is "no work, no pay"
  // unless the contract says otherwise, and plenty of construction sites work them.
  // Defaulting them to non-working would have shortened every existing project's
  // available days the moment this shipped.
  // Chinese New Year, Eid'l Fitr and Eid'l Adha are lunar and proclaimed yearly —
  // they stay in extra_holidays. Nov 2 and Dec 24 are usually, but not always,
  // proclaimed; also left out on purpose.
  function phSpecialDayList(y) {
    var easter = easterSunday(y);
    var blackSat = new Date(easter); blackSat.setDate(easter.getDate() - 1);
    return [
      { date: iso(blackSat),            name: 'Black Saturday' },
      { date: iso(new Date(y, 7, 21)),  name: 'Ninoy Aquino Day' },
      { date: iso(new Date(y, 10, 1)),  name: "All Saints' Day" },
      { date: iso(new Date(y, 11, 8)),  name: 'Feast of the Immaculate Conception' },
      { date: iso(new Date(y, 11, 31)), name: 'Last Day of the Year' }
    ];
  }
  function phSpecialDays(y) {
    if (_specCache[y]) return _specCache[y];
    var set = {};
    phSpecialDayList(y).forEach(function (h) { set[h.date] = h.name; });
    return (_specCache[y] = set);
  }

  var WD_KEYS = ['work_sun', 'work_mon', 'work_tue', 'work_wed', 'work_thu', 'work_fri', 'work_sat'];

  // The one supported calendar shape when a resource/activity has none assigned
  // yet: 6-day week (Mon–Sat), 8 hours/day, PH regular holidays off.
  function defaultCalendar() {
    return {
      name: 'Philippine Standard (6-day, 8h)', hours_per_day: 8,
      work_mon: true, work_tue: true, work_wed: true, work_thu: true, work_fri: true, work_sat: true, work_sun: false,
      observe_special_days: false, extra_holidays: [], seasons: []
    };
  }

  // ⚠️ STARTER TEMPLATES, not calendar types. Picking one only PRE-FILLS the form —
  // nothing downstream reads `key`, and the saved row is an ordinary calendar the
  // planner can edit freely afterwards. The point is that "new calendar" should not
  // open on an empty name and seven unticked boxes: on a Philippine site the shape is
  // nearly always one of these five, and retyping it is how two calendars that were
  // meant to be identical end up differing by one Saturday.
  var CALENDAR_TEMPLATES = [
    { key: 'ph6',    name: 'Philippine Standard (6-day, 8h)', hours_per_day: 8, days: 'mon,tue,wed,thu,fri,sat',
      note: 'Mon–Sat, regular holidays off. The default on most sites and what an unassigned activity already assumes.' },
    { key: 'ph6s',   name: 'Philippine Standard + special days off (6-day, 8h)', hours_per_day: 8, days: 'mon,tue,wed,thu,fri,sat',
      observe_special_days: true,
      note: 'As above, plus the recurring special non-working days (Black Saturday, Ninoy Aquino Day, All Saints’, Immaculate Conception, Dec 31).' },
    { key: 'ph5',    name: 'Office / 5-day week (8h)', hours_per_day: 8, days: 'mon,tue,wed,thu,fri',
      observe_special_days: true,
      note: 'Head-office, design and procurement work — engineering durations should not be counted on Saturdays the office does not work.' },
    { key: 'ph6x10', name: 'Extended shift (6-day, 10h)', hours_per_day: 10, days: 'mon,tue,wed,thu,fri,sat',
      note: 'Accelerated works. ⚠️ Changes HOURS, not days — it shortens nothing on its own; it feeds resource capacity and cost.' },
    { key: 'ph7',    name: 'Continuous works (7-day, 8h)', hours_per_day: 8, days: 'mon,tue,wed,thu,fri,sat,sun',
      note: 'Pours, dewatering, tunnelling and other work that cannot stop. Regular holidays are still non-working — untick nothing to change that.' }
  ];
  function templateCalendar(key) {
    var t = CALENDAR_TEMPLATES.filter(function (x) { return x.key === key; })[0];
    if (!t) return defaultCalendar();
    var days = t.days.split(',');
    var cal = { name: t.name, hours_per_day: t.hours_per_day, extra_holidays: [],
                observe_special_days: !!t.observe_special_days, is_default: false };
    WD_KEYS.forEach(function (k) { cal[k] = days.indexOf(k.replace('work_', '')) !== -1; });
    return cal;
  }

  // ==========================================================================
  // SEASONAL WORK PATTERNS — a calendar that changes shape through the year
  // --------------------------------------------------------------------------
  // ⚠️ A Philippine site does not work the same week in July that it works in
  // February, and modelling that as "rain days lost" alone is wrong in a way that
  // hides the decision: losing 8 days to weather is something that HAPPENS to you;
  // dropping to a 5-day week and 6-hour days through the monsoon is something you
  // DECIDE, and it belongs in the calendar where every duration is counted, not in a
  // what-if scenario. The two still compose — a wet-season pattern gives fewer days,
  // and a scenario's rain profile then takes some of those away.
  //
  // A season is { id, label, months: [6,7,8,9], hours_per_day, work_mon..work_sun }.
  // Months NOT covered by any season fall back to the calendar's own base pattern, so
  // a calendar with no seasons behaves exactly as it always did. The FIRST season
  // whose months include the date wins; overlapping months are a mis-configuration
  // the editor warns about rather than silently averaging.
  function seasonsOf(cal) {
    return (cal && Array.isArray(cal.seasons)) ? cal.seasons : [];
  }
  function seasonFor(cal, date) {
    var mo = date.getMonth() + 1, ss = seasonsOf(cal);
    for (var i = 0; i < ss.length; i++) {
      if (ss[i] && Array.isArray(ss[i].months) && ss[i].months.indexOf(mo) !== -1) return ss[i];
    }
    return null;
  }
  // The weekday pattern + hours in force on `date`. ⚠️ A season may declare hours only
  // (shorter days, same week) or days only — an unset field falls back to the base
  // calendar rather than to zero, which is why this merges instead of replacing.
  function patternFor(cal, date) {
    cal = cal || defaultCalendar();
    var s = seasonFor(cal, date);
    if (!s) return cal;
    var out = {};
    WD_KEYS.forEach(function (k) { out[k] = (s[k] === undefined || s[k] === null) ? cal[k] : s[k]; });
    out.hours_per_day = (s.hours_per_day == null || s.hours_per_day === '') ? cal.hours_per_day : Number(s.hours_per_day);
    out.observe_special_days = cal.observe_special_days;
    out.extra_holidays = cal.extra_holidays;
    out._season = s;
    return out;
  }
  function hoursPerDay(cal, date) {
    cal = cal || defaultCalendar();
    if (!date) return Number(cal.hours_per_day) || 8;
    return Number(patternFor(cal, date).hours_per_day) || Number(cal.hours_per_day) || 8;
  }
  // Working hours a calendar gives over [start,end] — the season-aware answer, since a
  // 6-hour wet-season day and an 8-hour dry-season day are no longer interchangeable.
  function workingHoursInRange(cal, start, end) {
    var h = 0, d = new Date(start);
    for (; d <= end; d.setDate(d.getDate() + 1)) if (isWorkDay(cal, d)) h += hoursPerDay(cal, d);
    return h;
  }
  // Build wet/dry season blocks from a PAGASA climate type, as the starting point a
  // planner would otherwise assemble by hand. Dry months get the fuller week.
  function phSeasonPreset(typeKey, opts) {
    opts = opts || {};
    var t = climateType(typeKey), out = [];
    function block(label, months, days, hours) {
      if (!months.length) return;
      var b = { id: 's' + Math.random().toString(36).slice(2, 8), label: label, months: months.slice(),
                hours_per_day: hours };
      WD_KEYS.forEach(function (k) { b[k] = days.indexOf(k.replace('work_', '')) !== -1; });
      out.push(b);
    }
    block('Wet season — reduced week', t.wet, (opts.wetDays || 'mon,tue,wed,thu,fri').split(','), opts.wetHours || 8);
    block('Dry season — full week', t.dry, (opts.dryDays || 'mon,tue,wed,thu,fri,sat').split(','), opts.dryHours || 8);
    return out;
  }

  /* ==========================================================================================
     EXTRA NON-WORKING DAYS: EXACT DATES *AND* ANNUAL REPEATS
     ------------------------------------------------------------------------------------------
     Owner 2026-09-03, after picking a calendar imported from P6: *"it loaded non working days for
     all years but to think that most of these only differ by year let's just simplify this by only
     selecting the relevant days and it will repeat for years since these are regular holidays.
     Only those special non-working days that need to be exact by its date."*

     They are right, and the numbers make the case: the "MCC Project Calendar 2020-2049" branch of
     4PH Strevi arrived with 226 entries covering 2021 to 2030 — the same ten or so company days
     restated once per year. A list like that cannot be read, cannot be checked, and cannot be
     edited: correcting one company holiday means finding and fixing ten chips.

     ⚠️⚠️ THE STORAGE IS UNCHANGED, DELIBERATELY. A repeat is written into the SAME
     `extra_holidays` array as the string `--MM-DD` — which is not an invention, it is ISO 8601's own
     notation for a recurring annual date. So:
       • no migration, and no new column to add to `calendars` in six other modules;
       • every existing calendar keeps working untouched (an all-exact list is still an all-exact
         list);
       • a reader that has not been taught about repeats simply fails to match them rather than
         crashing on them, which is the safe direction for a shared table.
     `--` cannot collide with a real date: an ISO date never starts with a hyphen.

     ⚠️ AND IT IS INDEXED, which is the other half of the reported slowness. This function is
     called ONCE PER CALENDAR DAY by isWorkDay → addWorkingDays, which walks up to 7,300 days to turn
     one duration into one finish date. With `extra_holidays.indexOf(ds)` — a linear scan of a
     226-element array of strings — that is up to 1.6 MILLION string comparisons to date a single
     activity, and the schedule dates thousands. The index is built once per array and cached against
     the array itself, so a re-fetched calendar gets a fresh one and a stale one is collected.
     ========================================================================================== */
  // The recurring form of an ISO date: '2026-08-21' -> '--08-21'.
  function recurKey(isoOrMonthDay) {
    var s = String(isoOrMonthDay || '');
    if (s.indexOf('--') === 0) return s.slice(0, 7);
    var m = s.match(/^\d{4}-(\d{2})-(\d{2})/);
    return m ? ('--' + m[1] + '-' + m[2]) : null;
  }
  function isRecurKey(s) { return /^--\d{2}-\d{2}$/.test(String(s || '')); }
  var _holIdxCache = (typeof WeakMap === 'function') ? new WeakMap() : null;
  var _holIdxFallbackKey = null, _holIdxFallback = null;
  function holidayIndex(cal) {
    var list = (cal && Array.isArray(cal.extra_holidays)) ? cal.extra_holidays : null;
    if (!list) return { exact: {}, recur: {}, nExact: 0, nRecur: 0 };
    if (_holIdxCache) { var hit = _holIdxCache.get(list); if (hit) return hit; }
    else if (_holIdxFallbackKey === list) return _holIdxFallback;
    var out = { exact: {}, recur: {}, nExact: 0, nRecur: 0 };
    for (var i = 0; i < list.length; i++) {
      var v = String(list[i] || '').trim();
      if (!v) continue;
      if (isRecurKey(v)) { if (!out.recur[v]) { out.recur[v] = 1; out.nRecur++; } }
      else if (!out.exact[v]) { out.exact[v] = 1; out.nExact++; }
    }
    if (_holIdxCache) _holIdxCache.set(list, out);
    else { _holIdxFallbackKey = list; _holIdxFallback = out; }
    return out;
  }

  /* Fold an exact-date list down to annual repeats. A month/day that appears in at least
     `minYears` DISTINCT years is the same company holiday restated, so it becomes one `--MM-DD`;
     anything appearing in fewer years is a one-off (a proclamation, a typhoon shutdown, a lunar
     holiday) and is kept verbatim, which is exactly the distinction the owner drew.
     ⚠️ Returns a NEW list and a report; it never mutates the input. Nothing calls this
     automatically on an existing saved calendar — collapsing somebody's stored dates without being
     asked would be a silent rewrite of a schedule input. The import does it (the list is being
     created at that moment, so there is nothing to overwrite) and the editor offers a button. */
  function collapseHolidays(list, minYears) {
    minYears = minYears || 3;
    var byMd = {}, recur = {}, exact = [];
    (list || []).forEach(function (v) {
      var s = String(v || '').trim(); if (!s) return;
      if (isRecurKey(s)) { recur[s] = 1; return; }
      var k = recurKey(s); if (!k) { exact.push(s); return; }
      (byMd[k] = byMd[k] || []).push(s);
    });
    var collapsed = 0, madeRecur = [];
    Object.keys(byMd).forEach(function (k) {
      var yrs = {};
      byMd[k].forEach(function (d) { yrs[d.slice(0, 4)] = 1; });
      if (Object.keys(yrs).length >= minYears) {
        if (!recur[k]) { recur[k] = 1; madeRecur.push(k); }
        collapsed += byMd[k].length;
      } else {
        byMd[k].forEach(function (d) { exact.push(d); });
      }
    });
    var recurList = Object.keys(recur).sort();
    exact = exact.filter(function (d, i, a) { return a.indexOf(d) === i; }).sort();
    return { list: recurList.concat(exact), recurring: recurList, added: madeRecur,
             exact: exact, collapsed: collapsed };
  }

  var _MD_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // How a stored entry should read on a chip: 'Aug 21 · every year' or '2026-04-09'.
  function holidayLabel(s) {
    var v = String(s || '').trim();
    if (!isRecurKey(v)) return v;
    var mo = parseInt(v.slice(2, 4), 10), dy = parseInt(v.slice(5, 7), 10);
    return (_MD_NAMES[mo - 1] || v.slice(2, 4)) + ' ' + dy + ' \u00b7 every year';
  }

  // Why a date is non-working, for the UI. Returns null when it IS a working day.
  // { kind: 'weekend' | 'regular' | 'special' | 'extra', name: '...' }
  function nonWorkingReason(cal, date) {
    cal = cal || defaultCalendar();
    var pat = patternFor(cal, date), ds = iso(date);
    if (!pat[WD_KEYS[date.getDay()]]) {
      return { kind: 'weekend', name: pat._season ? ('Non-working in ' + (pat._season.label || 'season')) : 'Non-working weekday' };
    }
    var reg = phRegularHolidays(date.getFullYear())[ds];
    if (reg) return { kind: 'regular', name: reg };
    if (cal.observe_special_days) {
      var sp = phSpecialDays(date.getFullYear())[ds];
      if (sp) return { kind: 'special', name: sp };
    }
    var ix = holidayIndex(cal);
    if (ix.exact[ds]) return { kind: 'extra', name: 'Extra non-working day' };
    if (ix.nRecur && ix.recur['--' + ds.slice(5)]) return { kind: 'extra', name: 'Annual non-working day (' + holidayLabel('--' + ds.slice(5)) + ')' };
    return null;
  }

  function isWorkDay(cal, date) {
    return !nonWorkingReason(cal, date);
  }

  function workingDaysInRange(cal, start, end) {
    var n = 0, d = new Date(start);
    for (; d <= end; d.setDate(d.getDate() + 1)) if (isWorkDay(cal, d)) n++;
    return n;
  }

  // The date on which the n-th WORKING day lands, counting the start date itself as
  // day 1 when it is a working day. This is what turns a duration into a finish date,
  // and it is the whole reason a duration scenario has to name a calendar: stretching
  // an activity by 25% only moves its finish if something knows which days are
  // workable. ⚠️ Capped at 20 years of calendar days so a calendar with every day
  // marked non-working (a real mis-configuration) cannot spin forever.
  function addWorkingDays(cal, start, n) {
    cal = cal || defaultCalendar();
    n = Math.max(1, Math.round(n || 1));
    var d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    var counted = 0, guard = 0;
    // Roll forward to the first working day; a start on a Sunday means the activity
    // begins on the Monday, not that Sunday counts as worked.
    while (!isWorkDay(cal, d) && guard++ < 7300) d.setDate(d.getDate() + 1);
    for (; guard < 7300; guard++) {
      if (isWorkDay(cal, d)) { counted++; if (counted >= n) return d; }
      d.setDate(d.getDate() + 1);
    }
    return d;
  }

  // Like addWorkingDays, but a number of working days per CALENDAR MONTH are lost to
  // weather. `rainByMonth` is { 1..12 -> days }. ⚠️ The lost days are spread EVENLY
  // through each month rather than taken off the front: taking them off the front
  // would model a monsoon that stops on a fixed date, and would make an activity's
  // slip depend on which day of the month it happened to start.
  // ⚠️ Never removes more than the month actually has — 31 rain days in a 26-working-day
  // month is a data-entry error, and treating it as "this month does not exist" would
  // silently push the whole schedule out with nothing on screen to explain it.
  function addWorkingDaysWithRain(cal, start, n, rainByMonth) {
    cal = cal || defaultCalendar();
    if (!rainByMonth) return addWorkingDays(cal, start, n);
    n = Math.max(1, Math.round(n || 1));
    var d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    var counted = 0, guard = 0, seenInMonth = 0, curMonth = -1, lost = 0, avail = 0;
    while (!isWorkDay(cal, d) && guard++ < 7300) d.setDate(d.getDate() + 1);
    for (; guard < 7300; guard++) {
      if (isWorkDay(cal, d)) {
        if (d.getMonth() !== curMonth) {
          curMonth = d.getMonth(); seenInMonth = 0;
          avail = workingDaysInMonth(cal, d.getFullYear(), curMonth);
          lost = Math.max(0, Math.min(avail, Math.round(Number(rainByMonth[curMonth + 1]) || 0)));
        }
        seenInMonth++;
        // Even spread: this working day is lost when the running quota crosses an
        // integer. With lost=0 the test never fires, so a dry month is untouched.
        var quotaBefore = Math.floor((seenInMonth - 1) * lost / avail);
        var quotaNow = Math.floor(seenInMonth * lost / avail);
        var isRained = quotaNow > quotaBefore;
        if (!isRained) { counted++; if (counted >= n) return d; }
      }
      d.setDate(d.getDate() + 1);
    }
    return d;
  }

  function workingDaysInMonth(cal, y, mo) {
    return workingDaysInRange(cal, new Date(y, mo, 1), new Date(y, mo + 1, 0));
  }

  // ==========================================================================
  // PHILIPPINE SEASONS — rainy days and sunny days, as a planning allowance
  // --------------------------------------------------------------------------
  // ⚠️ These are PLANNING ALLOWANCES, not weather data. They say "a site of this
  // climate type should expect to lose about this many working days to rain in this
  // month", which is the number a programme needs; they are not a forecast and they
  // are not PAGASA's rainfall record. Every figure is editable in the UI, and the
  // preset exists so a planner starts from the right shape of year instead of a row
  // of zeros or one flat figure applied to all twelve months.
  //
  // ⚠️ WHY CLIMATE TYPE AND NOT ONE NATIONAL "WET SEASON": the country does not have
  // one. Type I (Manila, Zambales, Ilocos) is bone dry Nov–Apr and drowns Jun–Sep.
  // Type II (Samar, Surigao, the eastern seaboard) is the near-opposite — its worst
  // months are Nov–Jan, exactly when a Manila planner's "dry season" preset would say
  // to expect nothing. Applying a Luzon wet season to a Mindanao project is the single
  // most expensive mistake this preset set exists to prevent.
  // Reference: PAGASA modified Coronas climate classification (Types I–IV).
  var PH_CLIMATE_TYPES = [
    { key: 'I', name: 'Type I — two pronounced seasons (dry Nov–Apr, wet May–Oct)',
      short: 'Type I · W. Luzon',
      areas: 'Metro Manila, Bataan, Zambales, Bulacan (W), Pampanga, Tarlac, Pangasinan, Ilocos, Cavite, Batangas (W), Occidental Mindoro, W. Palawan',
      wet: [6, 7, 8, 9], dry: [12, 1, 2, 3, 4],
      days: { 1: 1, 2: 1, 3: 0, 4: 1, 5: 3, 6: 6, 7: 8, 8: 8, 9: 7, 10: 5, 11: 3, 12: 2 } },
    { key: 'II', name: 'Type II — no dry season, very pronounced maximum Nov–Jan',
      short: 'Type II · E. seaboard',
      areas: 'Catanduanes, Sorsogon, E. Camarines, Samar, Leyte (E), Surigao, Agusan, Davao Oriental',
      wet: [11, 12, 1], dry: [],
      days: { 1: 7, 2: 5, 3: 4, 4: 3, 5: 3, 6: 4, 7: 5, 8: 5, 9: 6, 10: 7, 11: 8, 12: 9 } },
    { key: 'III', name: 'Type III — seasons not very pronounced, relatively dry Nov–Apr',
      short: 'Type III · Central',
      areas: 'W. Cagayan/Isabela, Bulacan (E), E. Mindoro, Marinduque, Romblon, N. Cebu, Bohol, N. Mindanao, Negros (W)',
      wet: [6, 7, 8, 9], dry: [1, 2, 3],
      days: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 3, 6: 5, 7: 6, 8: 6, 9: 5, 10: 4, 11: 3, 12: 2 } },
    { key: 'IV', name: 'Type IV — rainfall more or less evenly distributed all year',
      short: 'Type IV · Even',
      areas: 'Batangas (E), Bicol (W), E. Panay, Camiguin, Misamis, most of interior Mindanao, S. Cebu',
      wet: [], dry: [],
      days: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 4, 6: 5, 7: 5, 8: 5, 9: 5, 10: 5, 11: 5, 12: 4 } }
  ];
  // How hard the site is hit relative to the type's baseline. A sheltered, topped-out
  // or interior scope loses far less than open excavation in the same month — this is
  // the dial for that, and it is why the preset is (type × exposure) and not one number.
  var PH_RAIN_INTENSITY = [
    { key: 'light',    label: 'Sheltered / interior', factor: 0.4,
      note: 'Work inside a topped-out structure, fit-out, off-site fabrication. Loses the odd access or delivery day only.' },
    { key: 'moderate', label: 'Typical site works', factor: 1,
      note: 'The type’s baseline allowance — general structure and site works with normal exposure.' },
    { key: 'severe',   label: 'Fully exposed / earthworks', factor: 1.5,
      note: 'Excavation, embankment, exterior concrete, roofing, crane-dependent lifts. Ground stays unworkable after the rain stops.' }
  ];
  function climateType(key) {
    return PH_CLIMATE_TYPES.filter(function (t) { return t.key === key; })[0] || PH_CLIMATE_TYPES[0];
  }
  // { 1..12 -> working days lost }, rounded, zero months omitted so the stored profile
  // stays a statement of what was assumed rather than a wall of zeros.
  function phRainProfile(typeKey, intensityKey) {
    var t = climateType(typeKey);
    var f = (PH_RAIN_INTENSITY.filter(function (x) { return x.key === intensityKey; })[0] || PH_RAIN_INTENSITY[1]).factor;
    var out = {};
    for (var m = 1; m <= 12; m++) {
      var v = Math.round((t.days[m] || 0) * f);
      if (v > 0) out[m] = v;
    }
    return out;
  }
  // 'wet' | 'dry' | 'mixed' — what the UI colours a month with. ⚠️ 'dry' is the useful
  // half of this: the sunny months are when exposed work should be PLANNED, and a
  // planner cannot see that from a column of rain-day numbers alone.
  function phSeasonOf(typeKey, month) {
    var t = climateType(typeKey);
    if (t.wet.indexOf(month) !== -1) return 'wet';
    if (t.dry.indexOf(month) !== -1) return 'dry';
    return 'mixed';
  }
  // Working days a calendar gives in each month of `y`, and what it took out — the
  // numbers behind the year preview in the calendar editor.
  function yearStats(cal, y) {
    cal = cal || defaultCalendar();
    var months = [], total = 0;
    for (var mo = 0; mo < 12; mo++) {
      var d = new Date(y, mo, 1), end = new Date(y, mo + 1, 0), work = 0, hrs = 0, off = [];
      var seas = seasonFor(cal, new Date(y, mo, 1));
      for (; d <= end; d.setDate(d.getDate() + 1)) {
        var why = nonWorkingReason(cal, d);
        if (!why) { work++; hrs += hoursPerDay(cal, d); continue; }
        if (why.kind !== 'weekend') off.push({ date: iso(d), name: why.name, kind: why.kind });
      }
      total += work;
      months.push({ month: mo + 1, working: work, hours: hrs, season: seas ? (seas.label || 'Season') : null, holidays: off });
    }
    return { year: y, months: months, total: total };
  }

  global.PDCal = {
    phRegularHolidays: phRegularHolidays,
    defaultCalendar: defaultCalendar,
    isWorkDay: isWorkDay,
    workingDaysInRange: workingDaysInRange,
    workingDaysInMonth: workingDaysInMonth,
    addWorkingDays: addWorkingDays,
    addWorkingDaysWithRain: addWorkingDaysWithRain,
    phRegularHolidayList: phRegularHolidayList,
    phSpecialDays: phSpecialDays,
    phSpecialDayList: phSpecialDayList,
    nonWorkingReason: nonWorkingReason,
    CALENDAR_TEMPLATES: CALENDAR_TEMPLATES,
    templateCalendar: templateCalendar,
    PH_CLIMATE_TYPES: PH_CLIMATE_TYPES,
    PH_RAIN_INTENSITY: PH_RAIN_INTENSITY,
    climateType: climateType,
    phRainProfile: phRainProfile,
    phSeasonOf: phSeasonOf,
    yearStats: yearStats,
    seasonsOf: seasonsOf,
    seasonFor: seasonFor,
    patternFor: patternFor,
    hoursPerDay: hoursPerDay,
    workingHoursInRange: workingHoursInRange,
    phSeasonPreset: phSeasonPreset,
    // Recurring extra non-working days (see the block above nonWorkingReason).
    recurKey: recurKey,
    isRecurKey: isRecurKey,
    holidayIndex: holidayIndex,
    holidayLabel: holidayLabel,
    collapseHolidays: collapseHolidays,
    iso: iso
  };
})(window);
