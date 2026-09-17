/* THE SCHEDULE BUILDER'S AUTO-TRACE AND ITS STEP MANUAL — executed, not read.
 *
 *   node modules/project-schedule/test-builder.js
 *
 * ⚠️⚠️ EVERY FUNCTION UNDER TEST IS SLICED OUT OF THE SHIPPED index.html BY NAME AND RUN.
 *    Nothing here is a re-typed copy of the sequencing rules: a suite that re-implements the
 *    thing it tests proves the re-implementation, and this repo has been caught by that before.
 * ⚠️ BY NAME, NEVER BY LINE NUMBER. This file is ~50,000 lines and under concurrent edit; a
 *    line-numbered slice goes stale within hours and then fails as a syntax error that reads
 *    exactly like a bug in the code under test.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const scan = require('../../tools/scan.js');

const PAGE = path.join(__dirname, 'index.html');
const src = fs.readFileSync(PAGE, 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) { if (cond) pass++; else { fail++; fails.push(label); } }
function eq(got, want, label) {
  ok(got === want, label + '  (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}

/* ---------------------------------------------------------------- the slicer */
function sliceFn(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('SLICE FAILED: ' + name + ' not found — aborting rather than comparing nothing');
  const start = src.slice(Math.max(0, i - 6), i) === 'async ' ? i - 6 : i;
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  const out = src.slice(start, k);
  try { new Function('return (' + out + ')'); }
  catch (e) { throw new Error('slice of ' + name + ' does not parse: ' + e.message); }
  return out;
}
function sliceVar(name) {
  const i = src.indexOf('var ' + name + ' = ');
  if (i < 0) throw new Error('SLICE FAILED: var ' + name + ' not found');
  let depth = 0, k = src.indexOf(name.length ? '{' : '{', i), started = false;
  for (; k < src.length; k++) {
    if (src[k] === '{') { depth++; started = true; }
    else if (src[k] === '}') { depth--; if (started && depth === 0) { k++; break; } }
  }
  return src.slice(i, k) + ';';
}

/* ============================================================ 1 · the step manual
   Owner: *"in the question mark or guide, can you provide a quick manual dedicated for each step
   that users are able to refer to."* */
{
  const manual = new Function('return (' + sliceVar('SB_MANUAL').replace(/^var SB_MANUAL = /, '').replace(/;$/, '') + ')')();
  const keys = Object.keys(manual);
  ok(keys.length >= 11, 'manual: a page per step, on both paths (' + keys.length + ')');

  /* ⚠️⚠️ THE ASSERTION THAT MATTERS: every step the rail can actually show has a page. The rail is
     built at runtime from `STEP_START` + the mode's list, and it has been renumbered twice — so a
     step added without a page is the failure this catches, not a typo in a title. */
  function titlesOf(varName) {
    const i = src.indexOf('var ' + varName + ' = [');
    if (i < 0) throw new Error('no ' + varName);
    const end = src.indexOf('\n    ];', i);
    const body = src.slice(i, end);
    const out = [];
    const re = /\{ t: '((?:[^'\\]|\\.)*)'/g;
    let m;
    while ((m = re.exec(body))) out.push(m[1].replace(/\\'/g, "'").replace(/\\u2019/g, '’'));
    return out;
  }
  const startT = /var STEP_START = \{ t: '([^']+)'/.exec(src)[1];
  const all = [startT].concat(titlesOf('STEPS_NEW'), titlesOf('STEPS_IMP'));
  all.forEach(function (t) {
    ok(!!manual[t], 'manual: step "' + t + '" has a page');
  });
  /* ⚠️ And nothing in the manual names a step that does not exist — a page nobody can reach is a
     page nobody maintains, and it is how the manual starts describing a wizard that changed. */
  keys.forEach(function (t) {
    ok(all.indexOf(t) >= 0, 'manual: page "' + t + '" belongs to a step the rail can show');
  });

  /* Every page answers the same four questions, and "Done when" is the one people actually have. */
  keys.forEach(function (t) {
    const m2 = manual[t];
    ok(typeof m2.why === 'string' && m2.why.length > 30, 'manual: "' + t + '" says what the step is for');
    ok(Array.isArray(m2.how) && m2.how.length >= 1, 'manual: "' + t + '" says what to do');
    ok(typeof m2.done === 'string' && m2.done.length > 10, 'manual: "' + t + '" says when it is done');
  });
  /* ⚠️ The two steps where getting it wrong is expensive must carry a warning, not just a how-to. */
  ['Floors & Zones', 'Repetition', 'Generate', 'Review & import'].forEach(function (t) {
    ok(manual[t] && manual[t].watch && manual[t].watch.length, 'manual: "' + t + '" carries a watch-out');
  });
  /* ⚠️⚠️ Auto-trace REPLACES every link, and a planner who learns that afterwards has lost work. */
  /* ⚠⚠ GUARDED, and the guard is the assertion. A renamed or dropped SB_MANUAL key made this
     line THROW on 'watch' of undefined, which takes the whole suite down with a TypeError and
     reports nothing about the 100 assertions after it. A suite must FAIL on a regression, not
     die on one — the death looks like a broken checker and gets the checker edited. */
  const _rep = manual['Repetition'];
  ok(!!_rep && /replaces every link/i.test((_rep.watch || []).join(' ')),
     'manual: Repetition warns that auto-trace replaces every link');

  /* The renderer runs, against the shipped slices. */
  const api = new Function('STEPS,e2,' + 'SB_MANUAL',
    sliceFn('sbManualFor') + '\n' + sliceFn('sbManualHTML') + '\nreturn sbManualHTML;')(
    [{ t: 'Activities', s: 'Class-code list + duration' }], function (x) { return String(x); }, manual);
  const html = api(0);
  ok(/Activities/.test(html), 'manual: the page names its step');
  ok(/What to do/.test(html) && /Watch out/.test(html) && /Done when/.test(html),
     'manual: and carries all three sections');
  ok(/sbld-man-n">1</.test(html), 'manual: numbered the way the rail numbers it');
  /* ⚠️ A step with no page must SAY so rather than open an empty modal that reads as broken. */
  const api2 = new Function('STEPS,e2,SB_MANUAL',
    sliceFn('sbManualFor') + '\n' + sliceFn('sbManualHTML') + '\nreturn sbManualHTML;')(
    [{ t: 'Nonexistent', s: '' }], function (x) { return String(x); }, manual);
  ok(/No manual page for this step yet/.test(api2(0)), 'manual: an unknown step says so plainly');
}

/* ================================================ 2 · the zone order a trade actually works in
   Owner: *"significantly improve the questions being asked for better linking especially on zone
   sequence."* The two new answers are what gates the floor above, and whether the crew walks back. */
function zoneGroupsSandbox(cfg, zonesByFloor) {
  return new Function('cfg,leavesOfFloor',
    sliceFn('zoneGroupsOfFloor') + '\nreturn zoneGroupsOfFloor;')(
    cfg,
    function (tr, f) {
      return (zonesByFloor[f.id] || []).map(function (z) {
        return { uid: tr + '/' + f.id + '/' + z, trade: tr, floor: f, zone: { code: z }, unit: null };
      });
    });
}
{
  const zones = { F1: ['C', 'A', 'B'], F2: ['C', 'A', 'B'] };   // listed out of order on purpose
  const base = { zoneOrder: { ST: ['A', 'B', 'C'] }, zoneZigzag: {} };
  const g = zoneGroupsSandbox(base, zones);
  eq(g('ST', { id: 'F1' }, 0).map(x => x.zk).join(''), 'ABC',
     'zone order: the declared order wins over the order the zones were typed in');

  const zz = zoneGroupsSandbox({ zoneOrder: { ST: ['A', 'B', 'C'] }, zoneZigzag: { ST: true } }, zones);
  eq(zz('ST', { id: 'F1' }, 0).map(x => x.zk).join(''), 'ABC',
     'zig-zag: the FIRST floor of a tower is always the declared order');
  /* ⚠️⚠️ THE POINT OF ZIG-ZAG: the crew carries on from where it finished instead of walking back
     to zone A, which is what real crews do and what the plan was booking travel time for. */
  eq(zz('ST', { id: 'F2' }, 1).map(x => x.zk).join(''), 'CBA',
     'zig-zag: the next floor up is worked in reverse');
  eq(zz('ST', { id: 'F2' }, 2).map(x => x.zk).join(''), 'ABC',
     'zig-zag: and back again on the one above that');
  eq(g('ST', { id: 'F2' }, 1).map(x => x.zk).join(''), 'ABC',
     'zig-zag off: every floor starts at the first zone, as before');
}

/* ===================================================== 3 · auto-trace, run against a real fixture */
function autoTraceSandbox(cfg, opts) {
  opts = opts || {};
  const FLOORS = ['F1', 'F2', 'F3'];
  const ZONES = ['A', 'B', 'C'];
  const floors = FLOORS.map(function (id) { return { id: id, code: id, zones: ZONES.map(z => ({ code: z, units: [] })) }; });
  const leaves = [];
  floors.forEach(function (f) { ZONES.forEach(function (z) { leaves.push({ uid: 'ST/' + f.id + '/' + z, trade: 'ST', floor: f, zone: { code: z }, unit: null }); }); });
  const env = {
    cfg: cfg,
    GROUPS: ['ST'],
    locList: function () { return leaves; },
    floorsOf: function () { return floors; },
    tradeActs: function () { return [{ id: 'a1' }]; },
    towerList: function () { return [{ id: 'T1' }]; },
    towerIdOf: function () { return 'T1'; },
    floorIndexOf: function (l) { return FLOORS.indexOf(l.floor.id); },
    cellKey: function (l) { return l.zone ? l.zone.code : '_'; },
    leavesOfFloor: function (tr, f) { return leaves.filter(function (l) { return l.floor.id === f.id; }); },
    floorKind: function () { return 'typical'; },
    parallelKind: function () { return false; },
    batchKind: function () { return 1; },
    START: function () { return '__START__'; },
    END: function () { return '__END__'; },
    markDirty: function () {},
    render: function () {},
    reaches: function () { return false; }
  };
  const names = Object.keys(env);
  const body = sliceFn('tryLink') + '\n' + sliceFn('zoneGroupsOfFloor') + '\n' +
    sliceFn('floorGateOf') + '\n' + sliceFn('floorLagOf') + '\n' + sliceFn('autoTrace') +
    '\nreturn autoTrace;';
  const run = new Function(names.join(','), body).apply(null, names.map(n => env[n]));
  run();
  return { links: cfg.links, leaves: leaves };
}
function baseCfg(over) {
  return Object.assign({
    links: [], zoneSimul: { ST: 1 }, unitSimul: {}, zoneOrder: { ST: ['A', 'B', 'C'] },
    zoneZigzag: {}, floorGate: {}, floorLag: {}, tradeParallel: {}, tradeBatch: {},
    tradeBatchKind: {}, tradeParallelKind: {}, floorLead: 4
  }, over || {});
}
function has(links, from, to) { return links.some(k => k.from === from && k.to === to); }
function lagOf(links, from, to) { const k = links.find(x => x.from === from && x.to === to); return k ? k.lag : null; }

/* ---- the default (unchanged) shape: each zone climbs its own column ---------------- */
{
  const r = autoTraceSandbox(baseCfg());
  ok(has(r.links, 'ST/F1/A', 'ST/F2/A'), 'gate cell: zone A climbs its own column');
  ok(has(r.links, 'ST/F1/C', 'ST/F2/C'), 'gate cell: and so does zone C');
  ok(!has(r.links, 'ST/F1/C', 'ST/F2/A'), 'gate cell: the floor above is NOT gated on the whole floor below');
  ok(has(r.links, 'ST/F1/A', 'ST/F1/B'), 'gate cell: one zone at a time still chains within the floor');
  /* ⚠️ This is the behaviour every setup built before today assumed, because it was hard-coded.
     It has to stay the default or those setups would silently re-sequence on the next auto-trace. */
  eq(lagOf(r.links, 'ST/F1/A', 'ST/F2/A'), 0, 'gate cell: no lag unless one is asked for');
}

/* ---- the answer that could not be given before: finish the floor first -------------- */
{
  const r = autoTraceSandbox(baseCfg({ floorGate: { ST: 'floor' } }));
  ok(has(r.links, 'ST/F1/C', 'ST/F2/A'), 'gate floor: the floor above starts when the floor below is finished');
  /* ⚠️⚠️ ONE link per floor pair, not one per zone. Gating every zone on the same predecessor
     draws three identical arrows saying one thing, and a link diagram nobody can read is the
     reason this dialog exists. */
  ok(!has(r.links, 'ST/F1/A', 'ST/F2/A'), 'gate floor: and the zone column is NOT also drawn');
  ok(!has(r.links, 'ST/F1/B', 'ST/F2/B'), 'gate floor: for any zone');
  eq(r.links.filter(k => k.from.indexOf('/F1/') > 0 && k.to.indexOf('/F2/') > 0).length, 1,
     'gate floor: exactly one arrow between two floors');
}

/* ---- zig-zag + finish-the-floor: no walk back ---------------------------------------- */
{
  const r = autoTraceSandbox(baseCfg({ floorGate: { ST: 'floor' }, zoneZigzag: { ST: true } }));
  /* ⚠️⚠️ THE WHOLE POINT, IN ONE ASSERTION: F1 finishes on C, so F2 starts on C. The crew does
     not walk back to A, and the plan stops booking the travel. */
  ok(has(r.links, 'ST/F1/C', 'ST/F2/C'), 'zig-zag: the floor above starts on the zone the floor below finished');
  ok(!has(r.links, 'ST/F1/C', 'ST/F2/A'), 'zig-zag: not back at zone A');
  ok(has(r.links, 'ST/F2/C', 'ST/F2/B'), 'zig-zag: and the floor above is worked C → B → A');
  ok(has(r.links, 'ST/F2/B', 'ST/F2/A'), 'zig-zag: right through to A');
}

/* ---- the cure lag, which was declared in cfg for months and never read ---------------- */
{
  const r = autoTraceSandbox(baseCfg({ floorLag: { ST: 3 } }));
  eq(lagOf(r.links, 'ST/F1/A', 'ST/F2/A'), 3, 'cure lag: it lands on the floor-to-floor link');
  eq(lagOf(r.links, 'ST/F1/A', 'ST/F1/B'), 0, 'cure lag: and NOT on the zone-to-zone link within a floor');
  const r2 = autoTraceSandbox(baseCfg({ floorGate: { ST: 'floor' }, floorLag: { ST: 5 } }));
  eq(lagOf(r2.links, 'ST/F1/C', 'ST/F2/A'), 5, 'cure lag: it applies on the finish-the-floor gate too');
}

/* ---- and the whole thing is still a schedule: everything is bookended ---------------- */
{
  const r = autoTraceSandbox(baseCfg());
  const hasIn = {}, hasOut = {};
  r.links.forEach(k => { hasIn[k.to] = 1; hasOut[k.from] = 1; });
  ok(r.leaves.every(l => hasIn[l.uid]), 'every location has a predecessor');
  ok(r.leaves.every(l => hasOut[l.uid]), 'every location has a successor');
}

/* ======================================== 4 · the dialog asks the two new questions, in words */
{
  const dlg = sliceFn('openAutoTraceDialog');
  ok(/data-atkind="gate"/.test(dlg), 'dialog: it asks what gates the floor above');
  ok(/whole floor below/.test(dlg), 'dialog: in words a planner uses, not as a mode number');
  ok(/data-atkind="zig"/.test(dlg), 'dialog: it asks whether the crew walks back');
  ok(/data-atkind="lag"/.test(dlg), 'dialog: and how long the wait before the floor above is');
  /* ⚠️ The readback is what makes six controls across four trades checkable. */
  ok(/data-atsay/.test(dlg) && /function sbAtSay/.test(dlg), 'dialog: it says the flow back as a sentence');
  ok(/one zone at a time/.test(dlg), 'dialog: and the sentence is plain language');
  /* ⚠️⚠️ THE FALSE CLAIM THAT IS GONE. The old blurb promised "vertical progression with the cure
     lag" over an autoTrace that passed lag 0 — the lag existed in cfg and was never read.
     ⚠️ COMMENTS ARE STRIPPED FIRST, and this assertion failed until they were: the only place
     that phrase survives is the note explaining that it was removed. A checker that reads its
     own explanation and reports it as a finding is a trap this repo has fallen into before. */
  const dlgCode = scan.clean('x.js', dlg);
  ok(!/vertical progression with the cure lag/.test(dlgCode),
     'dialog: it no longer claims a cure lag it did not apply');
  ok(/if \(kind === 'gate'\) \{ if \(inp\.checked\)/.test(dlg),
     'dialog: only the CHECKED radio is read — the unchecked sibling cannot overwrite the answer');
}

/* =================================================== 5 · the fields survive a save/load round trip
   ⚠️ normalize() copies only the keys it knows about, so a field added to blank() and not to it
   works for a session and is gone tomorrow. That exact shape is on file in this module. */
{
  const norm = src.slice(src.indexOf('d.floorLag = '), src.indexOf('d.locLevel = '));
  ok(/d\.floorGate = /.test(norm), 'round trip: floorGate is normalised, not just blanked');
  ok(/d\.zoneZigzag = /.test(norm), 'round trip: and so is zoneZigzag');
  const blank = src.slice(src.indexOf('function blank() { return { startDate'), src.indexOf('phases: {},'));
  ok(/floorGate: \{\}/.test(blank) && /zoneZigzag: \{\}/.test(blank),
     'round trip: both start empty on a new setup');
}

console.log('');
console.log('schedule-builder: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  ' + fails.join('\n  ')); process.exit(1); }
