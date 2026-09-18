/* CRITICAL PATH — both engines, EXECUTED.
 *
 * Run:  node modules/project-schedule/test-cpm.js
 *
 * ⚠️⚠️ `computeCPM` PICKS ONE OF TWO ENGINES, and only one of them was broken. `cpmLogic` is the
 *    relationship-driven pass (topological sort, forward/backward over a working-day axis);
 *    `drivingPath` is the fallback for a schedule where NOT ONE predecessor resolves. A project
 *    reporting "no critical path" can only be in the second, because under the first the task
 *    attaining the project finish has no successor to pull its late finish in, so its float is
 *    exactly 0 and it always reads critical. That reasoning is asserted below rather than
 *    asserted at, so the suite also proves the diagnosis.
 * ⚠️ Both are sliced out of the shipped index.html BY NAME and run. Nothing here re-implements
 *    the arithmetic.
 * ⚠️ GATED against a pinned base SHA that must reproduce "0 critical activities".
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeSlicer } = require('./test-slice.js');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(__dirname, 'index.html');
const BASE_SHA = '56b34565';   // the commit BEFORE the drivingPath fix

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('  FAIL ' + m); } }
function eq(a, b, m) { ok(a === b, m + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); }
function same(a, b, m) { eq(JSON.stringify(a), JSON.stringify(b), m); }

/* ---------------------------------------------------------------- the harness */

const FNS = ['computeCPM', 'cpmLogic', 'drivingPath', 'predRels', 'isWbs', 'isMile', 'pd', 'dstr',
  'addDays', 'dayDiff', 'makeAxis', 'axisFor', 'today', 'taskConstraints',
  'fwdConstrain', 'bwdConstrain', 'relCandidateES', 'relCandidateRemES'];
/* ⚠️ `_axBaseKey` is NOT listed: it is the second declarator of `var _axCache = {}, _axBaseKey =
   null;`, so the `_axCache` slice already carries it. Asking for it by name fails the slicer,
   which is the right failure — it refuses rather than handing back half a statement. */
const VARS = ['_PR_SUFFIX', '_PR_LAGONLY', 'NEARDAYS', 'schedMode', 'useActuals', '_cpmBase',
  'calCpmOn', '_axCache'];

function build(src) {
  const S = makeSlicer(src);
  let body = '';
  FNS.forEach(function (n) { body += S.sliceFn(n) + '\n'; });
  VARS.forEach(function (n) {
    try { body += S.sliceVarLine(n) + '\n'; }
    catch (e) { throw new Error('VAR MISS ' + n + ' — a stub here would test the stub'); }
  });
  body += S.sliceVarObj('ALLAX') + '\n';

  return new Function(
    '"use strict";\n' +
    /* ⚠️ Only the three names that are pure STATE are stood in for — the row list, the pinned
       data date and the recompute flag. Every name that carries a RULE is sliced. */
    'var rows = [], dataDate = null, _cpmDirty = true;\n' +
    'function wallToday(){ return new Date(2026, 0, 1); }\n' +
    'function cpmCalOf(){ return null; }\n' +
    /* ⚠️⚠️ THIS SUITE WAS DARK FROM b311c7b4 UNTIL 2026-09-18 AND NOBODY SAW IT, because a
       ReferenceError kills the file before a single assertion prints — there is no failing count
       to notice, only an absent one. `axisFor` gained `if (!calCpmOn || !window.PDCal) return
       ALLAX;`, and `calCpmOn` is SLICED from the shipped file, where it reads localStorage inside
       a try/catch that returns TRUE on a throw — which is what node does. So the flag came up on,
       the second operand was evaluated, and `window` does not exist here.
       ⚠️⚠️ `{}` — DELIBERATELY WITHOUT `PDCal`, AND THAT IS NOT A STUB DODGE. It is a state the
       browser is really in: `calCpmOn` on with the calendar library not loaded, which the shipped
       code answers by falling back to ALLAX. That fallback IS the day axis these 28 assertions
       were written against, so the suite tests what it always tested.
       ⚠️ Standing in a PDCal here would be the forbidden move: the calendar axis would then be
       measured against the stub rather than against PDCal, and the suite would go green on
       arithmetic no shipped code performs. The working-calendar axis is therefore NOT covered by
       this suite — it is covered by nothing, and that gap is real. `PDCalStub` (unreferenced since
       it was written) is removed rather than left as an invitation to close the gap the wrong way. */
    'var window = {};\n' +
    body +
    'return function (rs, dd) {\n' +
    '  rows = rs; dataDate = dd || null;\n' +
    '  _axCache = {}; _axBaseKey = null;\n' +
    '  computeCPM();\n' +
    '  return rows;\n' +
    '};'
  )();
}

const BASE_SRC = execFileSync('git', ['show', BASE_SHA + ':modules/project-schedule/index.html'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
const NOW = build(fs.readFileSync(FILE, 'utf8'));
const BASE = build(BASE_SRC);

/* ---------------------------------------------------------------- fixtures */

function wbs(code, name) {
  return { id: 'w' + code, activity_id: 'W' + code, activity_name: name || ('Branch ' + code),
    activity_type: 'WBS Summary', wbs: code, predecessors: '' };
}
function act(code, id, name, s, f) {
  return { id: 'a' + id, activity_id: id, activity_name: name, activity_type: 'Task',
    wbs: code, start_date: s, end_date: f, predecessors: '' };
}
/* `rebuild()` derives these in the app; the fixture states them the same way it does — split the
   dotted code, strip the last segment. ⚠️ A row's OWN `wbs` is its branch code, so an activity
   filed at `4.2.1` is a SIBLING of the `4.2.1` summary row, not its child. */
function derive(rs) {
  rs.forEach(function (r) {
    const segs = String(r.wbs == null ? '' : r.wbs).split('.').filter(Boolean);
    r._segs = segs;
    r._depth = segs.length;
    r._anc = segs.slice(0, -1).map(function (_, i) { return segs.slice(0, i + 1).join('.'); });
  });
  return rs;
}

/* No relationship anywhere — the state that sends computeCPM down the fallback. */
function noRels() {
  return derive([
    wbs('4', 'Execution Phase'),
    wbs('4.1', 'Tower 1'), wbs('4.1.1', 'Structural'),
    act('4.1.1', 'A1', 'Rebar', '2026-03-02', '2026-10-10'),
    act('4.1.1', 'A2', 'Formworks', '2026-03-02', '2026-11-20'),
    wbs('4.2', 'Tower 2'), wbs('4.2.1', 'Structural'),
    act('4.2.1', 'B1', 'Rebar', '2026-03-02', '2026-12-31'),
    act('4.2.1', 'B2', 'Formworks', '2026-03-02', '2026-10-05')
  ]);
}
function crit(rs) {
  return rs.filter(function (r) { return r._critical && r.activity_type !== 'WBS Summary'; })
    .map(function (r) { return r.activity_id; }).sort();
}
function critWbs(rs) {
  return rs.filter(function (r) { return r._critical && r.activity_type === 'WBS Summary'; })
    .map(function (r) { return r.wbs; }).sort();
}
function floats(rs) {
  const o = {};
  rs.forEach(function (r) { if (r.activity_type !== 'WBS Summary') o[r.activity_id] = r._float; });
  return o;
}

/* ---------------------------------------------------------------- 1 · the defect */

console.log('\n1 · a schedule with no relationships at all');
{
  const was = BASE(noRels());
  const now = NOW(noRels());

  same(crit(was), [], 'BASE: ZERO critical activities — the toast the owner read, reproduced');
  ok(critWbs(was).length > 0, 'BASE marked something — it marked only WBS rows, which the count excludes');

  same(crit(now), ['B1'], 'the latest-finishing work is the driving path');
  same(critWbs(now), ['4', '4.2'], 'and the branches above it are marked down to that work');

  /* ⚠️ `4.2.1` is a SUMMARY ROW filed at the same code its activities carry, so in the kids map it
     is their SIBLING, not their parent — B1 and B2 compete directly at the `4.2` level, and
     nothing sits beneath `4.2.1` for it to inherit a finish from. The max wins either way, which
     is why this is correct rather than merely tolerable. */
  ok(critWbs(now).indexOf('4.2.1') < 0,
    'a summary row filed at its activities’ own code is their sibling, and finishes nothing');
}

console.log('\n2 · the floats were never the problem');
{
  const was = floats(BASE(noRels()));
  const now = floats(NOW(noRels()));
  same(now, was, 'the float arithmetic is byte-identical to the base — only the marking changed');
  eq(now.B1, 0, 'the activity attaining the project finish has zero float');
  eq(now.A2, 41, 'and the rest are counted back from it in calendar days');
  eq(now.A1, 82, 'A1');
  eq(now.B2, 87, 'B2');
}

/* ---------------------------------------------------------------- 3 · the two faults, named */

console.log('\n3 · each fault on its own');
{
  /* FAULT 2, isolated: work that sits two levels under the root can only be reached by descending
     THROUGH a branch, and a branch carries no end_date of its own. */
  const deep = derive([
    wbs('1'), wbs('1.1'), wbs('1.1.1'),
    act('1.1.1', 'D1', 'Deep', '2026-01-01', '2026-06-30'),
    wbs('1.2'),
    act('1.2', 'S1', 'Shallow', '2026-01-01', '2026-02-01')
  ]);
  same(crit(BASE(deep)), [], 'BASE cannot reach work below the first level');
  same(crit(NOW(deep)), ['D1'], 'a branch now contributes the latest finish beneath it');

  /* FAULT 3: the root used to be marked wholesale, before any comparison. */
  /* ⚠️ The work is filed one level UNDER each phase. An activity carrying the phase's own code
     would be that summary row's SIBLING, not its child — which is correct behaviour and would
     have tested nothing here. The first version of this fixture made exactly that mistake. */
  const phases = derive([
    wbs('1', 'Initiation'), act('1.1', 'P1', 'Kickoff', '2026-01-01', '2026-01-10'),
    wbs('4', 'Execution'), act('4.1', 'P4', 'Build', '2026-01-01', '2026-12-31')
  ]);
  same(critWbs(BASE(phases)), ['1', '4'], 'BASE marked every top-level phase critical, finished or not');
  same(critWbs(NOW(phases)), ['4'], 'only the phase that actually drives the finish is marked');
  same(crit(NOW(phases)), ['P4'], 'and the work inside it');
}

/* ---------------------------------------------------------------- 4 · the rules it keeps */

console.log('\n4 · the rules the fallback keeps');
{
  const ties = derive([
    wbs('1'), wbs('1.1'), act('1.1', 'T1', 'One', '2026-01-01', '2026-06-30'),
    wbs('1.2'), act('1.2', 'T2', 'Two', '2026-01-01', '2026-06-30')
  ]);
  same(crit(NOW(ties)), ['T1', 'T2'],
    'two branches finishing the same day both drive the parent — a tie keeps BOTH');

  const actuals = derive([
    wbs('1'), act('1', 'X1', 'Planned late', '2026-01-01', '2026-12-31'),
    act('1', 'X2', 'Actually later', '2026-01-01', '2026-06-30')
  ]);
  actuals[2].actual_finish = '2027-03-01';
  same(crit(NOW(actuals)), ['X2'], 'an actual finish beats the planned one, which is the point of the fallback');

  const undated = derive([
    wbs('1'), act('1', 'U1', 'No dates', null, null),
    act('1', 'U2', 'Dated', '2026-01-01', '2026-05-05')
  ]);
  same(crit(NOW(undated)), ['U2'], 'an undated row cannot drive anything');
  eq(floats(NOW(undated)).U1, null, 'and it is given no float rather than a zero');

  /* ⚠️ Hand-edited data can make a code its own ancestor. The guard is why this is asserted at
     all: without it the walk recurses for ever and hangs the grid on every render. */
  const cyc = derive([wbs('1'), act('1', 'C1', 'Work', '2026-01-01', '2026-02-02')]);
  cyc[0]._anc = ['1'];
  let threw = false;
  try { NOW(cyc); } catch (e) { threw = true; }
  ok(!threw, 'a row that is its own ancestor does not hang or throw');
}

/* ---------------------------------------------------------------- 5 · cpmLogic untouched */

console.log('\n5 · the relationship-driven engine is not the one that was broken');
{
  /* ⚠️⚠️ THE CLAIM IN THE HEADER, DEMONSTRATED: with relationships present, the task attaining
     the project finish reads critical, so `cpmLogic` can never produce zero. */
  const chain = derive([
    wbs('1'),
    act('1', 'R1', 'First', '2026-01-05', '2026-01-09'),
    act('1', 'R2', 'Second', '2026-01-12', '2026-01-16'),
    act('1', 'R3', 'Slack', '2026-01-05', '2026-01-06')
  ]);
  chain[2].predecessors = 'R1';
  const was = BASE(chain.map(function (r) { return Object.assign({}, r); }));
  const now = NOW(chain);
  ok(crit(now).length > 0, 'a schedule with relationships always has a critical path');
  ok(crit(now).indexOf('R2') >= 0, 'and it runs through the task attaining the project finish');
  same(crit(now), crit(was), 'identical to the base — cpmLogic is untouched by the fallback fix');
  same(floats(now), floats(was), 'floats identical to the base too');
}

/* ---------------------------------------------------------------- 6 · source gates */

console.log('\n6 · the source');
{
  const scan = require('../../tools/scan.js');
  const code = scan.blankComments(fs.readFileSync(FILE, 'utf8'));
  const base = scan.blankComments(BASE_SRC);

  ok(/kids\[node\.code\]/.test(base), 'BASE walks the tree by a `code` field a schedule row does not have');
  ok(!/kids\[node\.code\]/.test(code), 'that lookup is gone, not left beside its replacement');
  ok(/function finOf\(r\)/.test(code), 'a branch resolves the latest finish beneath it');
  ok(/depth > 64/.test(code), 'and the walk is depth-capped rather than trusted');
}

console.log('\nPASS ' + pass + '  FAIL ' + fail);
process.exit(fail ? 1 : 0);
