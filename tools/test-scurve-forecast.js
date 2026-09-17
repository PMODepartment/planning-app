/* PDScurve.compute — the forecast finish, loaded as the browser loads it.
 *
 * ⚠️⚠️ WHY THIS EXISTS. Owner 2026-09-17, on DEMO01: *"finish is at Apr 23, 2027 but the s-curve
 * has its own forecast finishing by 2034."* The forecast was `now + remaining / SPI`, with SPI
 * clamped to a floor of 0.1 — so on a project a few days old with almost nothing booked, the clamp
 * did not protect anything, it GUARANTEED a ten-fold stretch of the remaining programme. That is
 * not a forecast; it is a division by something close to zero.
 *
 * ⚠️ `scurve.js` is loaded, not reimplemented. The arithmetic under test is the shipped arithmetic.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'scurve.js'), 'utf8');
const win = {};
new Function('window', SRC)(win);
const PDScurve = win.PDScurve;
if (!PDScurve || !PDScurve.compute) throw new Error('scurve.js did not export PDScurve.compute');

let pass = 0, fail = 0; const fails = [];
function ok(c, label) { if (c) pass++; else { fail++; fails.push(label); } }
function eq(got, want, label) {
  ok(got === want, label + '  (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}
const DAY = 86400000;
/* ⚠️ LOCAL components, not `toISOString()`. `pd('2026-06-01')` parses to LOCAL midnight, and in
   Manila (UTC+8) that is 16:00 on 31 May in UTC — so a UTC formatter reports every date one day
   early and two assertions failed against a product that was correct. */
const iso = d => { const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' +
         String(x.getDate()).padStart(2, '0'); };
function days(a, b) { return Math.round((+new Date(b) - +new Date(a)) / DAY); }

/* A `series` is handed straight to compute(), which short-circuits the per-row work — the same
   shape the module's RPC aggregate produces. ⚠️ `plannedAt` is the PLAN's cumulative curve; here a
   straight line from start to end, which is what a schedule with evenly spread work looks like. */
function series(startISO, endISO, pctDone) {
  const minDate = new Date(startISO + 'T00:00:00Z');
  const plannedEnd = new Date(endISO + 'T00:00:00Z');
  const TOT = 1000;
  const span = +plannedEnd - +minDate;
  return {
    TOT,
    overallDone: TOT * pctDone / 100,
    minDate, plannedEnd,
    activities: 591, priced: 591,
    plannedAt: function (d) {
      const t = +d;
      if (t <= +minDate) return 0;
      if (t >= +plannedEnd) return TOT;
      return TOT * (t - +minDate) / span;
    },
    actualAt: function () { return TOT * pctDone / 100; }
  };
}
function run(startISO, endISO, pctDone, todayISO, opts) {
  return PDScurve.compute([], Object.assign(
    { series: series(startISO, endISO, pctDone), today: todayISO }, opts || {}));
}

/* ============================================================ the reported case */
{
  /* DEMO01 as reported: starts 14-Sep-26, plan ends 07-Jul-27, data date 17-Sep-26, and almost
     nothing booked. Three days into a 296-day programme. */
  const d = run('2026-09-14', '2027-07-07', 0.5, '2026-09-17');
  eq(d.basis, 'slip', 'demo01: too early for a performance forecast');
  ok(+d.autoFc < +new Date('2028-01-01'),
     'demo01: the forecast is no longer years past the plan (' + iso(d.autoFc) + ')');
  const over = days('2027-07-07', d.autoFc);
  ok(over >= 0 && over <= 31,
     'demo01: it is the planned finish plus the slip so far, ' + over + ' day(s)');
  /* ⚠️ The number that used to come out. Pinned so the fix cannot be quietly undone: with the old
     rule this project forecast 2,930 days past the data date. */
  const oldWay = new Date(+new Date('2026-09-17') + (+new Date('2027-07-07') - +new Date('2026-09-17')) / 0.1);
  ok(+d.autoFc < +oldWay - 2000 * DAY,
     'demo01: and it is thousands of days earlier than the old SPI rule gave (' + iso(oldWay) + ')');
}

/* ============================================================ the gate */
{
  /* Just under the threshold: still slip-based, however bad the ratio looks. */
  const d = run('2026-01-01', '2026-12-31', 9, '2026-07-01');
  eq(d.basis, 'slip', 'gate: 9% complete is below the threshold');
  eq(d.spiMinPct, 10, 'gate: and the threshold is reported so the caption can say it');
}
{
  /* Over the threshold, and genuinely behind: SPI takes over and says so. */
  const d = run('2026-01-01', '2026-12-31', 25, '2026-07-01');
  eq(d.basis, 'spi', 'gate: 25% complete against ~50% planned is enough signal');
  ok(d.spi > 0.4 && d.spi < 0.6, 'gate: SPI is about a half (' + d.spi.toFixed(2) + ')');
  ok(+d.autoFc > +new Date('2026-12-31'),
     'gate: so the forecast is later than the plan, which is the finding');
}
{
  /* ⚠️ A HALF-SPEED PROJECT MUST STILL FORECAST TWICE ITS REMAINING DURATION. The clamp exists to
     stop an arithmetic blow-up, not to flatten bad news, and a fix that made every forecast look
     like the plan would be worse than the bug. */
  const d = run('2026-01-01', '2026-12-31', 25, '2026-07-01');
  const rem = days('2026-07-01', '2026-12-31');
  const fcRem = days('2026-07-01', d.autoFc);
  ok(fcRem > rem * 1.6, 'clamp: the remaining programme is stretched, not flattened ('
     + fcRem + 'd vs ' + rem + 'd planned)');
}

/* ============================================================ the other two bases */
{
  const d = run('2026-01-01', '2026-12-31', 100, '2026-06-01');
  eq(d.basis, 'done', 'done: a finished project forecasts the data date');
  eq(iso(d.autoFc), '2026-06-01', 'done: which is today, not a projection');
}
{
  const d = run('2026-01-01', '2026-12-31', 5, '2026-03-01', { forecastFinish: '2027-03-01' });
  eq(d.manual, true, 'pinned: a pinned date still overrides everything');
  eq(iso(d.fcFinish), '2027-03-01', 'pinned: and is what the chart draws to');
}

/* ============================================================ ahead of plan */
{
  /* ⚠️ AHEAD must not forecast EARLIER than the plan by way of the slip branch. Slip is clamped at
     zero: being ahead is not evidence that the remaining work will go faster, and a forecast that
     beats the programme on three days of data is the same overconfidence as the 2034 figure,
     pointing the other way. */
  const d = run('2026-01-01', '2026-12-31', 8, '2026-01-15');
  eq(d.basis, 'slip', 'ahead: still below the threshold');
  eq(d.slipDays, 0, 'ahead: slip does not go negative');
  eq(iso(d.autoFc), '2026-12-31', 'ahead: so the forecast is the planned finish, not earlier');
}
{
  /* Above the threshold and genuinely ahead, SPI may pull the finish in — that IS a performance
     reading with enough data behind it. */
  const d = run('2026-01-01', '2026-12-31', 60, '2026-07-01');
  eq(d.basis, 'spi', 'ahead: 60% against ~50% planned is enough signal');
  ok(d.spi > 1, 'ahead: SPI is above 1 (' + d.spi.toFixed(2) + ')');
  ok(+d.autoFc < +new Date('2026-12-31'), 'ahead: and the forecast comes in early');
}

/* ============================================================ the slip measure itself */
{
  /* A straight-line plan over 2026: at 50% the plan expected to be here on 2 July. Reading on
     1 October with 50% booked is a 91-day slip. */
  const d = run('2026-01-01', '2026-12-31', 50, '2026-10-01');
  ok(Math.abs(d.slipDays - 91) <= 2, 'slip: measured horizontally between the curves ('
     + d.slipDays + 'd)');
  ok(Math.abs(days('2026-07-02', d.esDate)) <= 2,
     'slip: and the earned date is where the plan crossed 50% (' + iso(d.esDate) + ')');
}

/* ============================================ past the planned finish */
{
  /* ⚠️⚠️ THE SAME DEFECT AT THE OTHER END OF THE JOB. `remMs` is `max(0, plannedEnd - now)`, so
     once the data date passes the planned finish it is ZERO -- and `now + 0 / spi` is the data date.
     A project 40% complete and six months past its programme forecast **finishing today**,
     confidently, from the same line that produced the 2034 figure. Both are one defect: an
     expression only meaningful in the middle of a job, used at its edges. */
  const d = run('2026-01-01', '2026-12-31', 40, '2027-06-30');
  eq(d.basis, 'slip', 'overrun: past the planned end, SPI has no remaining duration to stretch');
  ok(+d.autoFc > +new Date('2027-06-30'),
     'overrun: so the forecast is in the FUTURE, not the data date (' + iso(d.autoFc) + ')');
  ok(d.slipDays > 200, 'overrun: and it carries the slip already incurred (' + d.slipDays + 'd)');
}

/* ======================================== and there is only ONE of it */
{
  /* ⚠️⚠️ THE SECOND COPY IS WHY THIS GUARD EXISTS. Project Schedule's cockpit chart was a
     "same math, verbatim" port of this forecast, defect included -- so one screen told a planner
     2034 while the schedule beside it said 2027. Asserted against the source text because a
     behavioural test of `scurve.js` cannot see a copy living in another file. */
  const files = [
    ['assets/js/scurve.js', fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'scurve.js'), 'utf8')],
    ['modules/project-schedule/index.html',
     fs.readFileSync(path.join(__dirname, '..', 'modules', 'project-schedule', 'index.html'), 'utf8')],
    ['modules/s-curve/index.html',
     fs.readFileSync(path.join(__dirname, '..', 'modules', 's-curve', 'index.html'), 'utf8')]
  ];
  const scan = require('./scan.js');
  let copies = 0;
  for (const [name, src] of files) {
    const code = scan.blankComments(src);
    /* The shape of the old line, in any spacing: `now + remaining / spi`. */
    if (/\+\s*tnow\s*\+\s*remMs\s*\/\s*spi/.test(code)) {
      copies++;
      console.log('  forecast arithmetic lives in ' + name +
                  (name === 'assets/js/scurve.js' ? '  (expected — this is the canonical one)'
                                                  : '  <-- A SECOND COPY'));
    }
  }
  eq(copies, 1, 'one copy: `+tnow + remMs / spi` appears in exactly one file');
  const sc = scan.blankComments(files[0][1]);
  ok(/forecast: forecast/.test(sc), 'one copy: and scurve.js exports it for the other callers');
  const ps = scan.blankComments(files[1][1]);
  ok(/PDScurve\.forecast\(/.test(ps),
     'one copy: the cockpit chart calls the shared one rather than carrying its own');
}

console.log('\nscurve-forecast: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  ' + fails.join('\n  ')); process.exit(1); }
