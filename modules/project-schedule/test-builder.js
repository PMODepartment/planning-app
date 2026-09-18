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
  /* ⚠ RETARGETED TWICE, never dropped: 'Repetition' split into Location Sequence and Activity
     Sequence on 2026-09-17, and on 2026-09-18 'Scope per zone' left that step to become 'Zone
     scoping' while the step itself went to sentence case. Every step where getting it wrong is
     expensive still has to carry a warning, so the list FOLLOWS the rail rather than being
     shortened to suit it — and Zone scoping is added rather than inherited, because unticking an
     activity there removes it from the programme entirely. */
  ['Towers', 'Floors & Zones', 'Location Sequence', 'Activity sequence', 'Zone scoping', 'Generate', 'Review & import'].forEach(function (t) {
    ok(manual[t] && manual[t].watch && manual[t].watch.length, 'manual: "' + t + '" carries a watch-out');
  });
  /* ⚠️⚠️ Auto-trace REPLACES every link, and a planner who learns that afterwards has lost work. */
  /* ⚠⚠ GUARDED, and the guard is the assertion. A renamed or dropped SB_MANUAL key made this
     line THROW on 'watch' of undefined, which takes the whole suite down with a TypeError and
     reports nothing about the 100 assertions after it. A suite must FAIL on a regression, not
     die on one — the death looks like a broken checker and gets the checker edited. */
  /* ⚠ The warning followed the Zone sequence view into Location Sequence — that is the step
     that now owns Auto-trace, so that is the page that has to carry it. */
  const _rep = manual['Location Sequence'];
  ok(!!_rep && /replaces every link/i.test((_rep.watch || []).join(' ')),
     'manual: Location Sequence warns that auto-trace replaces every link');

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
  /* ⚠⚠ `locCellKey` IS SLICED, NOT STUBBED. It used to be a one-line fake in the env above, which
     is a second opinion about the rule this suite exists to check — and it was wrong in the one way
     that matters: it ignored the unit, so a project with units keyed every unit of a zone the same.
     ⚠️ Renamed from `cellKey` on 2026-09-18 because this file declared two functions of that name.
     ⚠ `towerSimulOf` / `floorSimulOf` are the auto-trace windows added the same day; autoTrace calls
     both, so a suite that does not slice them fails at run time rather than proving anything. */
  const body = sliceFn('tryLink') + '\n' + sliceFn('zoneGroupsOfFloor') + '\n' +
    sliceFn('floorGateOf') + '\n' + sliceFn('floorLagOf') + '\n' +
    sliceFn('locCellKey') + '\n' + sliceFn('towerSimulOf') + '\n' + sliceFn('floorSimulOf') + '\n' +
    sliceFn('autoTrace') + '\nreturn autoTrace;';
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

/* ======================================== 4 · the dialog asks FOUR numbers, one per rung
   ⚠⚠ RETARGETED, NOT WEAKENED (2026-09-18). This block used to assert the gate fork, the zig-zag
   question and the cure-lag box — owner: *"no need to ask if zigzag and about next floor, just use
   default settings."* Asserting that a retired control is still on screen would have kept a suite
   green on a dialog nobody ships. What it asserts instead is the STRICTER pair: the four rungs are
   asked for, AND the retired questions are still HONOURED from `cfg` (section 3 above proves the
   gate, the zig-zag and the lag still change the links) — so a planner who answered the old dialog
   keeps their answers even though the boxes are gone. */
{
  const dlg = sliceFn('openAutoTraceDialog');
  /* ⚠️ On the ROW CALLS, not on `data-atkind="tower"` — the attribute is templated
     (`data-atkind="' + kind + '"`), so the literal appears nowhere and a regex for it would pass
     only by accident on some future rewrite. */
  ok(/row\('tower',/.test(dlg), 'dialog: it asks how many towers run at once');
  ok(/row\('floor',/.test(dlg), 'dialog: how many floors of one tower');
  ok(/row\('zone',/.test(dlg), 'dialog: how many zones of one floor');
  ok(/row\('unit',/.test(dlg), 'dialog: and how many units of one zone');
  /* ⚠️ The three retired questions are gone from the SCREEN. Comments are stripped first — the
     note recording the reversal names all three, and a checker that reads its own explanation and
     reports it as a finding is a trap this repo has fallen into before. */
  const dlgCode = scan.clean('x.js', dlg);
  ok(!/row\('gate',/.test(dlgCode) && !/'gate'/.test(dlgCode), 'dialog: the gate fork is no longer asked');
  ok(!/'zig'/.test(dlgCode), 'dialog: nor whether the crew walks back');
  ok(!/'lag'/.test(dlgCode), 'dialog: nor the cure lag');
  /* ⚠️ The readback is what makes four numbers across four trades checkable. */
  ok(/data-atsay/.test(dlg) && /function sbAtSay/.test(dlg), 'dialog: it says the flow back as a sentence');
  ok(/one zone at a time/.test(dlg), 'dialog: and the sentence is plain language');
  ok(!/vertical progression with the cure lag/.test(dlgCode),
     'dialog: it no longer claims a cure lag it did not apply');
  /* ⚠⚠ THE BOXES ARE SEEDED FROM THE HELPERS THE TRACER READS, never from a literal — which is
     the one thing that stops the dialog stating a plan different from the one the button builds. */
  ok(/towerSimulOf\(tr\)/.test(dlg) && /floorSimulOf\(tr\)/.test(dlg),
     'dialog: the tower and floor boxes read the tracer\'s own helpers');
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

/* =================================================== 6 · prerequisite gating, executed
   Owner: *"Users are unable to proceed the next step without defining the pre-requisites or
   preceding steps."*

   ⚠️⚠️ NOTHING HERE IS STUBBED. _stepReady, _firstBlockedUpTo, locGroups, usedGroups,
      locless and floorsOf are all sliced out of the shipped file and run; only cfg, mode and
      STEPS — the scenario's own inputs — are supplied. Stubbing locGroups would have made the
      project-wide case below a test of the stub rather than of the rule. */
{
  /* The rail's own step titles, read out of the shipped STEPS_NEW rather than re-typed, so the
     fixture cannot drift from the rail. */
  const newBlock = src.slice(src.indexOf('var STEPS_NEW = ['), src.indexOf('var STEPS_IMP = ['));
  const titles = [...newBlock.matchAll(/\{ t: '((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'"));
  /* ⚠ 8 → 9 on 2026-09-18: Zone scoping is its own step. The number is asserted rather than
     derived because the rail's LENGTH is the thing a merge silently changes. */
  ok(titles.length === 9, 'gating: the new-path rail has 9 steps after Start (' + titles.length + ')');
  const STEPS = [{ t: 'Start', s: '' }].concat(titles.map(x => ({ t: x, s: '' })));

  const GROUPS_SRC = src.match(/var GROUPS = \[[^\]]*\];/)[0];
  const LOCLESS_SRC = src.match(/var LOCLESS = \{[^}]*\};/)[0];

  function run(mode, cfg) {
    const body = GROUPS_SRC + '\n' + LOCLESS_SRC + '\n' +
      sliceFn('locless') + '\n' + sliceFn('usedGroups') + '\n' + sliceFn('locGroups') + '\n' +
      sliceFn('floorsOf') + '\n' + sliceFn('_stepNo') + '\n' +
      sliceFn('_stepReady') + '\n' + sliceFn('_firstBlockedUpTo') + '\n' +
      'return { ready: _stepReady, firstBlocked: _firstBlockedUpTo };';
    return new Function('mode,cfg,STEPS,STEP_ALIAS', body)(mode, cfg, STEPS, {});
  }
  const act = g => ({ code: 'X', name: 'x', group: g });
  const zoned = (tr, n) => ({ [tr]: { floors: Array.from({ length: n }, (_, i) => ({ id: 'f' + i })) } });

  /* ---- the import path is not gated at all ---------------------------------------------- */
  {
    const r = run('import', { activities: [], zoning: {} });
    eq(r.ready('Generate'), '', 'gating: the import path writes from a file and is never gated');
    eq(r.ready('Floors & Zones'), '', 'gating: nor is any other step on it');
  }
  /* ---- no cfg yet ------------------------------------------------------------------------ */
  eq(run('new', null).ready('Generate'), '', 'gating: with no cfg there is nothing to measure');

  /* ---- no activities: everything downstream of Activities is unanswerable ---------------- */
  {
    const r = run('new', { activities: [], zoning: {} });
    ['Floors & Zones', 'Location Sequence', 'Activity sequence', 'Zone scoping', 'Generate'].forEach(function (s2) {
      ok(/Activities first\./.test(r.ready(s2)), 'gating: "' + s2 + '" is blocked with no activities');
    });
    ['Calendars', 'Project phases', 'Activities', 'Towers'].forEach(function (s2) {
      eq(r.ready(s2), '', 'gating: "' + s2 + '" is NOT blocked — it is at or before Activities');
    });
    ok(/step \d/.test(r.ready('Generate')),
       'gating: the reason names a step NUMBER, resolved through _stepNo rather than hard-coded');
    eq(r.firstBlocked(titles.length), 5, 'gating: the first blocked step is Floors & Zones (index 5)');
    eq(r.firstBlocked(4), -1, 'gating: nothing before Floors & Zones is blocked');
  }

  /* ---- activities, a location-bearing trade, floors typed ------------------------------- */
  {
    const r = run('new', { activities: [act('ST')], zoning: zoned('ST', 3) });
    eq(r.ready('Location Sequence'), '', 'gating: floors typed → Location Sequence is open');
    eq(r.ready('Generate'), '', 'gating: and so is Generate');
    eq(r.firstBlocked(titles.length), -1, 'gating: a complete setup blocks nothing');
  }
  /* ---- activities, a location-bearing trade, NO floors anywhere -------------------------- */
  {
    const r = run('new', { activities: [act('ST')], zoning: { ST: { floors: [] } } });
    ok(/Floors & Zones first\./.test(r.ready('Location Sequence')),
       'gating: location-bearing trades with no floors → Location Sequence is blocked');
    eq(r.ready('Generate'), '', 'gating: Generate is NOT blocked by missing floors — only by no activities');
    eq(r.firstBlocked(titles.length), 6, 'gating: the block is Location Sequence (index 6)');
  }
  /* ---- ⚠⚠ THE CASE THE WHOLE RULE TURNS ON: project-wide work only ------------------------
     General Requirements carries no tower, floor or zone (LOCLESS), so this project has no floors
     and never will. Gating on "has floors" would strand it short of Generate for ever. */
  {
    const r = run('new', { activities: [act('GR')], zoning: {} });
    eq(r.ready('Location Sequence'), '',
       'gating: a project whose only trade is project-wide is NOT blocked — it can never type a floor');
    eq(r.ready('Generate'), '', 'gating: and it can still reach Generate');
    eq(r.firstBlocked(titles.length), -1, 'gating: nothing at all is blocked for it');
  }
  /* ---- a trade with no zoning entry at all: counted as 0 floors, never a throw ------------ */
  {
    const r = run('new', { activities: [act('ST')], zoning: {} });
    ok(/Floors & Zones first\./.test(r.ready('Location Sequence')),
       'gating: a trade with no zoning entry reads as no floors rather than throwing');
  }
  /* ---- Start is always reachable --------------------------------------------------------- */
  {
    const r = run('new', { activities: [], zoning: {} });
    eq(r.ready('Start'), '', 'gating: Start is the path chooser and is never blocked');
    eq(r.firstBlocked(0), -1, 'gating: _firstBlockedUpTo starts at k=1, so Start can never be the block');
  }

  /* ---- the wiring: the rail, the footer and the handler all read the one predicate -------- */
  const code = scan.clean('x.js', src);
  ok(/var _why = _stepReady\(s\.t\);/.test(code), 'gating: the rail marks a blocked step');
  ok(/\(_why \? ' locked' : ''\)/.test(code), 'gating: … with the locked class');
  ok(/var _blk = _firstBlockedUpTo\(_i\);/.test(code),
     'gating: a forward rail jump is checked against every step in between, not just the target');
  ok(/_i = Math\.max\(0, _blk - 1\);/.test(code),
     'gating: … and lands on the step BEFORE the block, never on the blocked step itself');
  ok(/if \(_i > step\) \{/.test(code), 'gating: going backwards is never blocked');
  ok(/var _nextBlock = \(!_nextTab && step < STEPS\.length - 1\) \? _stepReady\(STEPS\[step \+ 1\]\.t\) : '';/.test(code),
     'gating: the footer computes the block ONCE, and a tab walk within a step is never blocked');
  ok(/id="b-next"' \+ \(_nextBlock \? ' disabled/.test(code), 'gating: Next is disabled when blocked');
  ok(/if \(_nextBlock\) \{ if \(window\.UI\) UI\.toast\(_nextBlock, 'warn'\); return; \}/.test(code),
     'gating: … and the handler guards it too, since the attribute is one repaint from being alone');
  ok(/\.sbld-step\.locked \{/.test(src) && /\.sbld-step\.locked\.on \{/.test(src),
     'gating: the locked style exists and yields to the active state');
  ok(/--pd-warn-text/.test(src.slice(src.indexOf('.sbld-blockwhy'), src.indexOf('.sbld-blockwhy') + 200)),
     'gating: the reason uses --pd-warn-text, never the 3.46:1 surface --pd-warn');

  /* ---- ⚠⚠ THE CONTRAST, pinned to a SHA and not to HEAD, which becomes self-comparison ---- */
  {
    const BASE = '6047d600';
    let base = null;
    try {
      base = require('child_process').execSync('git show ' + BASE + ':modules/project-schedule/index.html',
        { cwd: __dirname + '/../..', maxBuffer: 1 << 28, encoding: 'utf8' });
    } catch (e) { /* not a checkout — the gate is skipped and says so */ }
    if (base == null) {
      console.log('  (contrast skipped: ' + BASE + ' not reachable from here)');
    } else {
      ok(base.indexOf('function _stepReady(') < 0, 'contrast: the pinned base has no _stepReady at all');
      ok(base.indexOf('_firstBlockedUpTo') < 0, 'contrast: nor _firstBlockedUpTo');
      ok(base.indexOf('sbld-blockwhy') < 0, 'contrast: nor the blocked-reason style');
      ok(/rail\.querySelectorAll\('\[data-step\]'\)\.forEach\(function \(b\) \{ b\.onclick = function \(\) \{ step = \+b\.dataset\.step; render\(\); \}; \}\);/.test(base),
         'contrast: the base jumps to any step unconditionally — the behaviour this replaces');
    }
  }
}

console.log('');
console.log('schedule-builder: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  ' + fails.join('\n  ')); process.exit(1); }
