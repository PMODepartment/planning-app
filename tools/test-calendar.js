/* ============================================================================
   PDCal — the working-calendar engine, executed.
   Run:  node tools/test-calendar.js [path/to/calendar.js]

   ⚠️⚠️ THE ASSERTION THAT MATTERS MOST IS THE CONTROL, not the new features: a
   calendar carrying none of the 2026-09-17 fields must compute byte-identically
   to the day before they existed. `hours_per_day` is multiplied by a day count
   in three other modules, so a change there is a silent, project-wide change to
   every capacity and FTE figure in the app.
   ============================================================================ */
var fs = require('fs'), path = require('path');
var SRC = process.argv[2] || path.join(__dirname, '..', 'assets', 'js', 'calendar.js');
var g = {};
new Function('window', fs.readFileSync(SRC, 'utf8'))(g);
var C = g.PDCal;
if (!C) { console.log('FAIL: calendar.js did not assign PDCal'); process.exit(1); }

var pass = 0, fail = 0, group = '';
function G(n) { group = n; console.log('\n' + n); }
function ok(c, m, extra) {
  if (c) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (extra !== undefined ? '   [' + extra + ']' : '')); }
}
function eq(a, b, m) { ok(a === b, m, JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function D(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }

// A plain pre-2026-09-17 calendar: Mon-Sat, 8h, nothing new on it.
function legacy(over) {
  var c = { name: 'L', hours_per_day: 8, work_mon: 1, work_tue: 1, work_wed: 1, work_thu: 1,
            work_fri: 1, work_sat: 1, work_sun: 0, extra_holidays: [], seasons: [] };
  return Object.assign(c, over || {});
}

/* -------------------------------------------------------------------------- */
G('1 · CONTROL — a calendar with none of the new fields is unchanged');
var L = legacy();
eq(C.hoursPerDay(L, D('2026-03-02')), 8, 'hours/day on a plain calendar is the scalar');
eq(C.isWorkDay(L, D('2026-03-02')), true, 'Monday works');
eq(C.isWorkDay(L, D('2026-03-01')), false, 'Sunday does not');
eq(C.isWorkDay(L, D('2026-12-25')), false, 'Christmas is a built-in regular holiday');
eq(C.workingDaysInMonth(L, 2026, 2), 26, 'March 2026 gives 26 working days');
// addWorkingDays is what turns a duration into a finish date - the money path.
eq(C.iso(C.addWorkingDays(L, D('2026-03-02'), 10)), '2026-03-12', '10 working days from Mon 2 Mar');
eq(C.workingHoursInRange(L, D('2026-03-02'), D('2026-03-07')), 48, 'a full Mon-Sat week is 48h');
eq(C.averageDayHours(L), 8, 'the average of a calendar with no day schedule is its own scalar');

/* -------------------------------------------------------------------------- */
G('2 · Per-day work schedule (day_hours)');
eq(C.specHours({ start: '08:00', end: '17:00', breaks: [{ start: '12:00', end: '13:00' }] }), 8,
   '08:00-17:00 less a 1h break is 8h');
eq(C.specHours({ start: '08:00', end: '17:00' }), 9, 'the same window with no break is 9h');
eq(C.specHours({ start: '08:00', end: '12:00' }), 4, 'a half day is 4h');
// A night shift must not come out negative or zero.
eq(C.specHours({ start: '22:00', end: '06:00' }), 8, 'an end before the start crosses midnight');
// A break outside the window cannot take hours that were never worked.
eq(C.specHours({ start: '08:00', end: '12:00', breaks: [{ start: '13:00', end: '14:00' }] }), 4,
   'a break outside the window subtracts nothing');
eq(C.specHours({ start: '08:00', end: '12:00', breaks: [{ start: '11:00', end: '14:00' }] }), 3,
   'a break overhanging the window is clipped to it');
eq(C.specHours({ start: 'oops', end: '17:00' }), null, 'an unparseable time yields null, not 0');
eq(C.specHours({ start: '08:00', end: '09:00', breaks: [{ start: '08:00', end: '23:00' }] }), 0,
   'a break that swallows the day floors at 0, never negative');

var DH = legacy({ day_hours: {
  mon: { start: '08:00', end: '17:00', breaks: [{ start: '12:00', end: '13:00' }] },  // 8
  sat: { start: '08:00', end: '12:00' }                                              // 4
} });
eq(C.hoursPerDay(DH, D('2026-03-02')), 8, 'Monday takes its own schedule');
eq(C.hoursPerDay(DH, D('2026-03-07')), 4, 'Saturday takes its own, shorter schedule');
eq(C.hoursPerDay(DH, D('2026-03-03')), 8, 'a day with no schedule falls back to the scalar');
// The average is what hours_per_day should be set to, so hours x days stays right.
eq(C.averageDayHours(DH), 7.33, 'the average over Mon-Sat with one 4h day');
// The week total must equal the sum of the real days, not 6 x anything.
eq(C.workingHoursInRange(DH, D('2026-03-02'), D('2026-03-07')), 44, 'the week is 5x8 + 1x4 = 44h');
eq(C.averageDayHours(legacy({ day_hours: {} })), 8, 'an empty day_hours map changes nothing');

/* -------------------------------------------------------------------------- */
G('3 · Low-productivity season — a REDUCTION, and the old absolute still works');
var RED = legacy({ seasons: [{ id: 's1', label: 'Wet', months: [6, 7, 8], hours_reduction: 2 }] });
eq(C.hoursPerDay(RED, D('2026-07-06')), 6, 'a 2h reduction takes an 8h day to 6h');
eq(C.hoursPerDay(RED, D('2026-03-02')), 8, 'a month outside the season is untouched');
// The whole point of a reduction over an absolute: it follows the base.
var RED10 = legacy({ hours_per_day: 10, seasons: [{ id: 's1', label: 'Wet', months: [7], hours_reduction: 2 }] });
eq(C.hoursPerDay(RED10, D('2026-07-06')), 8, 'raise the base to 10h and the reduction still gives 8h');
// ⚠️ Every season stored before today carries an ABSOLUTE. Reading one as a reduction
// would have cut a wet-season day from 8h to 2h.
var ABS = legacy({ seasons: [{ id: 's1', label: 'Wet', months: [7], hours_per_day: 6 }] });
eq(C.hoursPerDay(ABS, D('2026-07-06')), 6, 'an old absolute season still means 6 hours, not minus 6');
// A reduction wins over an absolute when both are present (the new field is the authored one).
var BOTH = legacy({ seasons: [{ id: 's1', months: [7], hours_per_day: 6, hours_reduction: 1 }] });
eq(C.hoursPerDay(BOTH, D('2026-07-06')), 7, 'a reduction beats a stale absolute on the same season');
// A 0-hour day would divide by zero in the FTE histogram.
var OVER = legacy({ seasons: [{ id: 's1', months: [7], hours_reduction: 99 }] });
ok(C.hoursPerDay(OVER, D('2026-07-06')) > 0, 'an over-large reduction is floored above zero',
   C.hoursPerDay(OVER, D('2026-07-06')));
// A reduction composes with a per-day schedule rather than replacing it.
var COMBO = legacy({ day_hours: { sat: { start: '08:00', end: '12:00' } },
                     seasons: [{ id: 's1', months: [7], hours_reduction: 1 }] });
eq(C.hoursPerDay(COMBO, D('2026-07-04')), 3, 'a 4h Saturday less a 1h seasonal reduction is 3h');

/* -------------------------------------------------------------------------- */
G('4 · "Every Nth weekday of the month"');
ok(C.isNthKey('--08-#4-1'), 'the nth key form is recognised');
ok(!C.isRecurKey('--08-#4-1'), 'and is NOT mistaken for a fixed annual date');
ok(!C.isNthKey('--08-21'), 'a fixed annual date is not mistaken for an nth key');
ok(!C.isNthKey('2026-08-21'), 'nor is an exact date');
ok(!C.isNthKey('--08-#5-1'), 'a 5th is refused — the form offers 1-4 and last');
eq(C.iso(C.nthKeyDate('--08-#4-1', 2026)), '2026-08-24', '4th Monday of August 2026');
eq(C.iso(C.nthKeyDate('--08-#L-1', 2026)), '2026-08-31', 'last Monday of August 2026');
eq(C.iso(C.nthKeyDate('--01-#1-4', 2026)), '2026-01-01', '1st Thursday of January 2026 is the 1st');
eq(C.iso(C.nthKeyDate('--02-#L-6', 2026)), '2026-02-28', 'last Saturday of February 2026');
// It must move with the year, which is the whole reason it is not a date.
eq(C.iso(C.nthKeyDate('--08-#4-1', 2027)), '2027-08-23', 'and it moves: 4th Monday of August 2027');
var NTH = legacy({ extra_holidays: ['--08-#4-1'] });
eq(C.isWorkDay(NTH, D('2026-08-24')), false, 'the 4th Monday of August is non-working');
eq(C.isWorkDay(NTH, D('2026-08-17')), true, 'the 3rd Monday is not');
eq(C.isWorkDay(NTH, D('2027-08-23')), false, 'and it lands correctly the following year');
eq(C.holidayLabel('--08-#4-1'), '4th Monday of Aug · every year', 'it reads as words, not as a key');
eq(C.holidayLabel('--08-#L-5'), 'last Friday of Aug · every year', 'and so does a "last"');

/* -------------------------------------------------------------------------- */
G('5 · Excluding a year from a recurring day');
/* ⚠ The dates are chosen so every year tested lands on a WORKING weekday (15 Jun is a
   Mon in 2026, a Tue in 2027, a Thu in 2028). A fixture on a date that falls at a weekend
   in one of the years cannot tell an honoured exclusion from an ordinary Sunday - which is
   exactly how the first cut of this assertion passed for the wrong reason. */
var EX = legacy({ extra_holidays: ['--06-15'], extra_holiday_excludes: { '--06-15': [2027] } });
[['2026-06-15', 1], ['2027-06-15', 2], ['2028-06-15', 4]].forEach(function (p) {
  ok(D(p[0]).getDay() === p[1], p[0] + ' is a working weekday, so this case discriminates');
});
eq(C.isWorkDay(EX, D('2026-06-15')), false, 'the annual day is off in a year it is observed');
eq(C.isWorkDay(EX, D('2027-06-15')), true, 'and WORKED in the year it is excluded');
eq(C.isWorkDay(EX, D('2028-06-15')), false, 'the exclusion is that one year only');
var EXN = legacy({ extra_holidays: ['--08-#4-1'], extra_holiday_excludes: { '--08-#4-1': [2027] } });
eq(C.isWorkDay(EXN, D('2026-08-24')), false, 'an nth-weekday day is off by default');
eq(C.isWorkDay(EXN, D('2027-08-23')), true, 'and can be excluded for one year too');
// ⚠️ An exclusion must not be able to override a BUILT-IN regular holiday: those are
// computed, not stored, so there is no key to exclude and Christmas stays off.
var EXR = legacy({ extra_holiday_excludes: { '--12-25': [2026] } });
eq(C.isWorkDay(EXR, D('2026-12-25')), false, 'excluding a built-in regular holiday does nothing');

/* -------------------------------------------------------------------------- */
G('6 · Year preview carries calendar days');
var st = C.yearStats(L, 2026);
eq(st.months.length, 12, 'twelve months');
eq(st.months[0].calendar, 31, 'January has 31 calendar days');
eq(st.months[1].calendar, 28, 'February 2026 has 28');
eq(C.yearStats(L, 2028).months[1].calendar, 29, 'and 29 in a leap year');
eq(st.totalCalendar, 365, 'the year totals 365 calendar days');
ok(st.total < st.totalCalendar, 'working days are fewer than calendar days', st.total + ' vs ' + st.totalCalendar);
// The difference IS what the calendar costs - it must be derived from the same pass.
var jan = st.months[0];
ok(jan.working <= jan.calendar, 'a month can never work more days than it has');

/* -------------------------------------------------------------------------- */
G('7 · The unknown-shape degrade is the SAFE direction');
// A reader that has not been taught the nth form files it under `exact`, where it
// matches nothing - so the day is WORKED rather than an arbitrary day being removed.
var ix = C.holidayIndex(legacy({ extra_holidays: ['--08-#4-1', '--12-25', '2026-04-09'] }));
eq(ix.nNth, 1, 'the index separates one nth key');
eq(ix.nRecur, 1, 'one fixed annual');
eq(ix.nExact, 1, 'one exact date');
var GARBAGE = legacy({ extra_holidays: ['not-a-date', '--13-99', ''] });
eq(C.isWorkDay(GARBAGE, D('2026-03-02')), true, 'junk entries remove no day at all');
eq(C.workingDaysInMonth(GARBAGE, 2026, 2), 26, 'and the month is unchanged by them');

/* --------------------------------------------------------------------------
   ⚠️⚠️ THE ONE THAT MATTERS: a legacy calendar must compute IDENTICALLY to the
   version before these fields existed. Six spot checks cannot say that - this
   is the money path (isWorkDay -> addWorkingDays -> every finish date, and
   hoursPerDay -> the FTE histogram and resource capacity in two other modules),
   so the previous implementation is LOADED and run beside this one over every
   day of three years and five real calendar shapes.
   ⚠️ Skipped with a printed reason rather than silently when git is unavailable:
   an equivalence check that quietly did not run is worse than none.
   -------------------------------------------------------------------------- */
G('8 · EQUIVALENCE against the pre-change engine');
(function () {
  var cp = require('child_process'), prev = null;
  try {
    /* ⚠️⚠️ PINNED TO A SHA, NEVER `HEAD`. `HEAD` becomes self-comparison the instant this
       change commits — and it did: the contrast started passing for the wrong reason, with the
       gate below the only thing that said so. 9fe4e9f is the commit before the engine moved. */
    var txt = cp.execSync('git show 9fe4e9f:assets/js/calendar.js', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    var gg = {}; new Function('window', txt)(gg); prev = gg.PDCal;
  } catch (e) { }
  if (!prev) { console.log('  ??   SKIPPED - could not load 9fe4e9f:assets/js/calendar.js'); return; }
  // If HEAD already knows the new fields this is self-comparison, not a contrast.
  ok(typeof prev.specHours !== 'function', 'the base really is the PRE-change engine');

  var shapes = [
    ['Mon-Sat 8h', legacy()],
    ['5-day office', legacy({ work_sat: 0, hours_per_day: 8 })],
    ['7-day 10h', legacy({ work_sun: 1, hours_per_day: 10 })],
    ['with special days + holidays', legacy({ observe_special_days: true,
        extra_holidays: ['--12-26', '2026-04-09', '2027-01-02'] })],
    ['with an ABSOLUTE season', legacy({ climate_type: 'I',
        seasons: [{ id: 's1', label: 'Wet', months: [6, 7, 8, 9], hours_per_day: 6, work_sat: false }] })]
  ];
  var diffs = [], checked = 0;
  shapes.forEach(function (sh) {
    var cal = sh[1];
    for (var y = 2026; y <= 2028; y++) {
      for (var mo = 0; mo < 12; mo++) {
        var end = new Date(y, mo + 1, 0).getDate();
        for (var dy = 1; dy <= end; dy++) {
          var d = new Date(y, mo, dy); checked++;
          if (prev.isWorkDay(cal, d) !== C.isWorkDay(cal, d)) diffs.push(sh[0] + ' isWorkDay ' + C.iso(d));
          if (prev.hoursPerDay(cal, d) !== C.hoursPerDay(cal, d)) {
            diffs.push(sh[0] + ' hoursPerDay ' + C.iso(d) + ' ' + prev.hoursPerDay(cal, d) + ' vs ' + C.hoursPerDay(cal, d));
          }
        }
      }
      if (prev.yearStats(cal, y).total !== C.yearStats(cal, y).total) diffs.push(sh[0] + ' yearStats ' + y);
      // The duration -> finish path, at four lengths.
      [1, 5, 30, 200].forEach(function (n) {
        var a = prev.iso(prev.addWorkingDays(cal, new Date(y, 2, 2), n));
        var b = C.iso(C.addWorkingDays(cal, new Date(y, 2, 2), n));
        if (a !== b) diffs.push(sh[0] + ' addWorkingDays ' + y + '/' + n + ' ' + a + ' vs ' + b);
      });
    }
  });
  ok(checked > 5000, 'the sweep actually ran over ' + checked + ' day comparisons', checked);
  ok(diffs.length === 0, 'ZERO differences across 5 calendar shapes x 3 years', diffs.slice(0, 5).join(' | '));
})();

/* --------------------------------------------------------------------------
   ⚠️⚠️ TWO DOORS, ONE CALENDAR. The Resource & Role Master has its own calendar
   form, and its save REBUILDS each season object field by field - so a field it
   does not name is deleted the next time anyone saves that calendar from there.
   A planner who opened a calendar in that module would silently undo the
   wet-season reduction set in the Schedule Setup. This is a SOURCE assertion
   because that form lives in another module's page and cannot be executed here;
   it is worth having anyway, because the failure is invisible in both screens.
   -------------------------------------------------------------------------- */
G('9 · The other editor round-trips the new season field');
(function () {
  var f = path.join(__dirname, '..', 'modules', 'resource-loading', 'index.html');
  if (!fs.existsSync(f)) { console.log('  ??   SKIPPED - resource-loading not present'); return; }
  var src = fs.readFileSync(f, 'utf8');
  var i = src.indexOf('calDraft.seasons || []).filter');
  ok(i > 0, 'found the season rebuild in the Resource & Role Master save');
  var chunk = src.slice(i, i + 1400);
  ok(/o\.hours_reduction\s*=/.test(chunk), 'it carries hours_reduction through');
  ok(/o\.hours_per_day\s*=/.test(chunk), 'and still carries the absolute it always did');
})();

console.log('\n' + (fail ? 'FAIL: ' : 'PASS: ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
