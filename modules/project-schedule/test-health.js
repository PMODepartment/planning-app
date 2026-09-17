/* Schedule Health — the REAL computeHealth, sliced out of index.html and run.
 *
 * ⚠️⚠️ WHY THIS EXISTS. Owner 2026-09-17: *"let's debug the schedule health if its working
 * properly."* It was not. The score was `100 - mean(pct)` over however many checks happened to
 * apply, so a schedule where EVERY activity carried negative float scored 91% and painted GREEN.
 * Negative float is a zero-tolerance finding in DCMA-14 — the standard the 44-day thresholds at
 * the top of that function already cite.
 *
 * ⚠️ The function is SLICED FROM THE SHIPPED SOURCE, not reimplemented. A copy of the formula in a
 * test only proves the copy works. Everything computeHealth reaches for is stubbed; the arithmetic
 * and the metric table are the ones that ship.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const scan = require('../../tools/scan.js');

const PAGE = path.join(__dirname, 'index.html');
const src = fs.readFileSync(PAGE, 'utf8');
const mask = scan.blankComments(src);

function endOf(i) {
  let k = mask.indexOf('{', i), d = 0;
  const BS = String.fromCharCode(92);
  for (; k < mask.length; k++) {
    const ch = mask[k];
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; k++;
      while (k < mask.length && mask[k] !== q) { if (mask[k] === BS) k++; k++; }
      continue;
    }
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (!d) return k + 1; }
  }
  throw new Error('unbalanced braces walking from ' + i);
}
function sliceFn(name) {
  const i = mask.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('SLICE FAILED: ' + name + ' — aborting rather than testing nothing');
  const out = src.slice(i, endOf(i));
  try { new Function('return (' + out + ')'); }
  catch (e) { throw new Error('slice of ' + name + ' does not parse: ' + e.message); }
  return out;
}

const COMPUTE = sliceFn('computeHealth');

/* Everything the sliced function reaches for. ⚠️ Deliberately dumb: the point is to drive the
   SCORING, so each stub answers from a field the fixture sets directly. */
function run(rows) {
  const ctx = {
    rows: rows,
    ensureCPM: function () {},
    isWbs: function (r) { return !!r.wbs; },
    today: function () { return new Date('2026-09-01'); },
    pd: function (v) { return v ? new Date(v) : null; },
    dayDiff: function (a, b) { return Math.round((b - a) / 86400000); },
    finVar: function (r) { return r.finVar == null ? null : r.finVar; },
    isHardConstraint: function (v) { return v === 'MSO' || v === 'MFO'; },
    isAnyConstraint: function (v) { return !!v; },
    HEALTH_LARGE_FLOAT: 44,
    HEALTH_LARGE_DUR: 44,
    _wpKey: function (v) { return v || ''; },
    wpOf: function (r) { return r._wp || null; },
    wpIsUnlinked: function (r) { return !!r._wpStale; },
    dispStart: function (r) { return r.start_date; }
  };
  const names = Object.keys(ctx);
  const fn = new Function(...names, COMPUTE + '; return computeHealth();');
  return fn(...names.map(n => ctx[n]));
}

/* A clean activity: logic both ways, no constraints, sane float, short, on baseline. */
let seq = 0;
function act(over) {
  seq++;
  const r = {
    id: 'a' + seq, activity_id: 'A' + seq, activity_name: 'Activity ' + seq,
    start_date: '2026-01-01', end_date: '2026-01-10',
    _float: 5, finVar: 0, bl_finish: '2026-01-10',
    _relObjs: [{ type: 'FS', lag: 0, p: { actual_finish: '2025-12-01' } }],
    _succObjs: [{ type: 'FS' }]
  };
  return Object.assign(r, over || {});
}
function many(n, over) { return Array.from({ length: n }, () => act(over)); }

let pass = 0, fail = 0; const fails = [];
function ok(c, label) { if (c) pass++; else { fail++; fails.push(label); } }
function eq(got, want, label) {
  ok(got === want, label + '  (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}
function m(h, key) { return h.metrics.find(x => x.key === key); }

/* ---------------------------------------------------------------- a clean schedule */
{
  const h = run(many(100));
  eq(h.score, 100, 'clean: a schedule with nothing wrong scores 100');
  eq(h.failed, 0, 'clean: no checks failed');
  eq(h.band, 'ok', 'clean: and the band is green');
  ok(h.checks > 0, 'clean: some checks actually applied (' + h.checks + ')');
}

/* ------------------------------------------------- THE BUG THIS FILE EXISTS FOR */
{
  const h = run(many(100, { _float: -5 }));
  const nf = m(h, 'negfloat');
  eq(nf.pct, 100, 'negfloat: all 100 activities are found');
  eq(nf.ok, false, 'negfloat: and the check FAILS — DCMA allows none');
  eq(h.band, 'bad', 'negfloat: a zero-tolerance failure bands RED however good the average looks');
  eq(h.failed, 1, 'negfloat: exactly one check failed');
  /* ⚠️⚠️ THE NUMBER IS NOT THE VERDICT, AND THIS ASSERTION SAYS SO ON PURPOSE. Weighted, this
     schedule still scores in the 80s — it IS otherwise clean, with one disqualifying defect — and
     forcing the number down would double-count the same fact the band already carries. The score
     is for TREND (better or worse than last month); the band and the failed-count are the verdict,
     and all three are on the card. What must never happen again is a red fact painted green. */
  ok(h.score < 95 && h.score > 50,
     'negfloat: the score drops from 100 but stays a weighted average (' + h.score + '%)');
  ok(h.worst[0].key === 'negfloat', 'negfloat: and it is named as the worst finding');
}
{
  /* ⚠️⚠️ THE SINGLE BAD ROW. 1 of 2,561 is 0.039%, which Math.round makes 0 — so a `pct <= 0`
     test would have passed it. A zero-tolerance check is judged on the COUNT. */
  const rows = many(2560); rows.push(act({ actual_start: '2026-09-15' }));  // after the data date
  const h = run(rows);
  const ip = m(h, 'invprog');
  eq(ip.count, 1, 'one bad row: it is found');
  eq(ip.pct, 0, 'one bad row: and rounds to 0% for display');
  eq(ip.ok, false, 'one bad row: but the check still FAILS — judged on the count, not the rounding');
  eq(h.band, 'bad', 'one bad row: and it bands red');
}

/* ---------------------------------------------------------- thresholds are DCMA-14's */
{
  const h = run(many(95).concat(many(5, { _relObjs: [], _succObjs: [] })));
  eq(m(h, 'open').pct, 5, 'threshold: 5% open ends measured');
  eq(m(h, 'open').ok, true, 'threshold: 5% open ends is exactly the DCMA limit — passes');
}
{
  const h = run(many(94).concat(many(6, { _relObjs: [], _succObjs: [] })));
  eq(m(h, 'open').ok, false, 'threshold: 6% open ends is over the limit — fails');
  eq(h.band, 'bad', 'threshold: open ends are weight 3, so that is red');
}

/* --------------------------------------------- informational checks are never scored */
{
  const clean = run(many(100)).score;
  const soft = run(many(100, { primary_constraint: 'SNET' }));
  eq(m(soft, 'softcon').pct, 100, 'info: every activity carries a soft constraint');
  eq(m(soft, 'softcon').weight, 0, 'info: and it is weight 0');
  eq(soft.score, clean, 'info: so the score is unchanged — normal practice is not a defect');
  eq(soft.band, 'ok', 'info: and it does not band');
}

/* ------------------------------- the divisor no longer moves with what data exists */
{
  /* ⚠️⚠️ THE OLD SCORE WAS NOT COMPARABLE BETWEEN PROJECTS. Metrics with an empty denominator were
     dropped from a flat mean, so recording a baseline changed the scale underneath the number. */
  const withBL = run(many(100)).score;
  const noBL = run(many(100, { bl_finish: null, finVar: null })).score;
  eq(withBL, 100, 'divisor: clean WITH baselines scores 100');
  eq(noBL, 100, 'divisor: clean WITHOUT baselines also scores 100 — same scale');
}
{
  const a = run(many(50).concat(many(50, { _float: -1 }))).score;
  const b = run(many(50, { bl_finish: null, finVar: null })
          .concat(many(50, { _float: -1, bl_finish: null, finVar: null }))).score;
  ok(Math.abs(a - b) <= 2, 'divisor: 50% negative float scores alike with and without baselines ('
     + a + '% vs ' + b + '%)');
}

/* ---------------------------------------------------- severity separates the bands */
{
  const h = run(many(90).concat(many(10, { _float: 100 })));   // 10% large float: limit 5, weight 1
  eq(m(h, 'largefloat').ok, false, 'severity: 10% large float breaches its 5% limit');
  eq(h.band, 'warn', 'severity: but large float is advisory — amber, not red');
  ok(h.score > 80, 'severity: and an advisory breach barely moves the score (' + h.score + '%)');
}

/* ------------------------------------------- what the old formula would have said */
{
  /* ⚠️ THE NEGATIVE TEST, INLINE. The OLD rule re-run over the SAME metric objects the shipped
     function just produced. If this ever stops differing, the rework has been undone. */
  const h = run(many(100, { _float: -5 }));
  const applied = h.metrics.filter(x => x.denom > 0);
  const oldScore = Math.round(100 - applied.reduce((s, x) => s + x.pct, 0) / applied.length);
  ok(oldScore >= 80, 'old rule: would have scored this ' + oldScore + '% — green');
  ok(h.score < oldScore, 'old rule: the new score is lower (' + h.score + '% vs ' + oldScore + '%)');
}

console.log('\nschedule-health: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  ' + fails.join('\n  ')); process.exit(1); }
