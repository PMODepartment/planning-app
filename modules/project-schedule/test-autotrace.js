/* AUTO-TRACE — the Schedule Setup's takt link generator, EXECUTED.
 *
 * Run:  node modules/project-schedule/test-autotrace.js
 *
 * ⚠️⚠️ THE SHIPPED `autoTrace` IS SLICED OUT OF index.html BY NAME AND RUN, together with every
 *    helper it reaches. Nothing here re-implements the linking rule: a suite that re-implements it
 *    proves the re-implementation, and this repo has been caught by that four times.
 * ⚠️ GATED against a pinned base SHA that must REPRODUCE the defect. A suite that passes on both
 *    files proves nothing, and `HEAD` stops being the pre-change state the moment this commits.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeSlicer } = require('./test-slice.js');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(__dirname, 'index.html');
const BASE_SHA = '56b34565';   // the commit BEFORE the per-tower cross-trade fix

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('  FAIL ' + m); } }
function eq(a, b, m) { ok(a === b, m + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); }

/* ---------------------------------------------------------------- the harness */

const FNS = ['autoTrace', 'zoneGroupsOfFloor', 'floorGateOf', 'floorLagOf', 'tryLink', 'reaches',
  'START', 'END', 'floorKind', 'batchKind', 'declaredBatch', 'declaredBatchOf',
  'parallelKind', 'parallelKindOf', 'leavesOfFloor', 'towerList', 'towerIdOf',
  'floorIndexOf', 'tradeActs', 'locList', 'floorsOf'];

/* ⚠️⚠️ `locless` IS SLICED ONLY WHERE IT EXISTS, and that is the one exception to this suite's
   refuse-to-stub rule. `locList` gained a `if (locless(tr)) return;` gate on 2026-09-17 (General
   Requirements carries no tower, floor or zone), so the CURRENT file needs it and the PINNED BASE
   does not define it at all — slicing it unconditionally would fail the contrast build on a
   function the base has never heard of.
   ⚠️ It is not stubbed: where the name exists the REAL function is linked, and an assertion below
   requires the current file to define it, so this cannot quietly hide the gate going missing. */
/* ⚠️ Tower TYPES (2026-09-18) join `locless` under the same rule and for the same reason: locList
   now resolves a floor's type to its instances, so these are real dependencies of a function this
   suite slices — but the PINNED BASE defines none of them, and slicing unconditionally would fail
   the contrast build on functions it has never heard of. Where the name exists the REAL function is
   linked; nothing here is stubbed. */
const FNS_OPT = ['locless', 'towerById', 'blankTowerTypes', 'typeList', 'typeById', 'typeOfTower', 'towersOfType', 'repTowerOf', 'repTowerOfTower'];

function build(src) {
  const S = makeSlicer(src);
  let body = '';
  FNS.forEach(function (n) { body += S.sliceFn(n) + '\n'; });
  FNS_OPT.forEach(function (n) {
    if (src.indexOf('function ' + n + '(') >= 0) body += S.sliceFn(n) + '\n';
  });
  // ⚠️ The table `locless` reads, sliced by the same rule and from the same file — never a
  // fixture. Which trades are loc-less is the fact under test whenever this gate matters.
  if (src.indexOf('var LOCLESS = ') >= 0) body += S.sliceVarLine('LOCLESS') + '\n';
  /* ⚠️ `cellKey` is declared TWICE in this file — a 3-argument gantt helper and the 1-argument
     location one. `sliceFn` would take the first; the location-shaped one is what autoTrace calls. */
  const i = src.indexOf('function cellKey(loc)');
  if (i < 0) throw new Error('SLICE FAILED: function cellKey(loc)');
  body += src.slice(i, src.indexOf('\n', i)) + '\n';
  body += S.sliceVarLine('KIND_LABEL') + '\n' + S.sliceVarLine('KIND_ORDER') + '\n';

  return new Function(
    '"use strict";\n' +
    'var cfg = null, GROUPS = ["ST","AR","ME"];\n' +
    'function markDirty(){}\n' +
    'function render(){}\n' +
    'function blankTowers(){ return [{ id:"t1", name:"Tower 1" }]; }\n' +
    'function towerLabel(id){ return id; }\n' +
    body +
    'return function (c) { cfg = c; autoTrace(); return cfg.links; };'
  )();
}

const BASE_SRC = execFileSync('git', ['show', BASE_SHA + ':modules/project-schedule/index.html'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
const NOW = build(fs.readFileSync(FILE, 'utf8'));
const BASE = build(BASE_SRC);

/* ---------------------------------------------------------------- fixtures */

function fl(code, tw, kind) {
  return {
    id: code + '@' + tw, code: code, name: code, kind: kind || 'typical', towerId: tw,
    zones: [{ id: 'z' + code + tw, code: 'Z1', units: [] }]
  };
}
function cfgOf(towers, floorsByTrade, opts) {
  const o = opts || {};
  const trades = Object.keys(floorsByTrade), z = {};
  ['ST', 'AR', 'ME'].forEach(function (tr) { z[tr] = { floors: floorsByTrade[tr] || [] }; });
  return {
    startDate: '2026-01-01',
    activities: trades.map(function (tr) { return { id: 'a' + tr, group: tr }; }),
    towers: towers, zoning: z, links: [], actLinks: [], locLevel: 'auto',
    floorLead: o.lead == null ? 4 : o.lead,
    tradeLeads: {}, tradeBatch: {}, tradeBatchKind: o.batchKind || {},
    tradeParallel: o.parallel || {}, tradeParallelKind: o.parallelKind || {},
    zoneSimul: {}, unitSimul: {}, floorLag: {}, floorGate: {}, zoneZigzag: {}, zoneOrder: {}
  };
}
const TW2 = [{ id: 't1', name: 'Tower 1' }, { id: 't2', name: 'Tower 2' }];
const TW1 = [{ id: 't1', name: 'Tower 1' }];

// A leaf uid is `<trade>/<floor id>/<zone id>`, and the floor id carries its own tower.
function towerOf(uid) { const m = /@(t\d+)/.exec(String(uid)); return m ? m[1] : null; }
function crossTrade(links) {
  return links.filter(function (k) { return /^ST\//.test(k.from) && /^AR\//.test(k.to); });
}
function threeEach() {
  return [fl('L1', 't1'), fl('L2', 't1'), fl('L3', 't1'),
    fl('L1', 't2'), fl('L2', 't2'), fl('L3', 't2')];
}

/* ---------------------------------------------------------------- 1 · the defect, reproduced */

console.log('\n1 · two towers, three typical floors each, a handoff of 4 levels');
{
  const mk = function () { return cfgOf(TW2, { ST: threeEach(), AR: threeEach() }, { lead: 4 }); };
  const was = crossTrade(BASE.run ? BASE.run(mk()) : BASE(mk()));
  const now = crossTrade(NOW(mk()));

  const wasSame = was.filter(function (k) { return towerOf(k.from) === towerOf(k.to); }).length;
  const nowSame = now.filter(function (k) { return towerOf(k.from) === towerOf(k.to); }).length;

  ok(was.length > 0, 'the base draws cross-trade links at all (or this contrast proves nothing)');
  /* ⚠️⚠️ THREE OF THE SIX CROSS, and the three that do not only stay put by accident: the ordinal
     has run off the end of the combined list, so the clamp lands on the LAST tower — which
     happens to be the tower they belong to. An earlier reading of this run said none of them
     stayed; that was wrong, and this assertion is what caught it. */
  eq(wasSame, 3, 'BASE: half the cross-trade links leave their own tower');
  eq(was.filter(function (k) { return k.to === 'AR/L1@t1/zL1t1'; })[0].from, 'ST/L1@t2/zL1t2',
    'BASE: Tower 1 floor 1 waits on TOWER 2 floor 1 — the reported shape');
  eq(nowSame, now.length, 'every cross-trade link now stays inside its own tower');
  eq(now.length, 6, 'one link per following-trade floor (3 floors x 2 towers)');

  const a1 = now.filter(function (k) { return k.to === 'AR/L1@t1/zL1t1'; });
  eq(a1.length, 1, 'Tower 1 floor 1 has exactly one leading-trade predecessor');
  eq(a1[0].from, 'ST/L3@t1/zL3t1',
    'a handoff past the top of the tower clamps to THAT tower’s top floor');
}

/* ---------------------------------------------------------------- 2 · the handoff still counts */

console.log('\n2 · a handoff that fits inside the tower still trails by exactly that many levels');
{
  const links = crossTrade(NOW(cfgOf(TW2, { ST: threeEach(), AR: threeEach() }, { lead: 2 })));
  const by = {};
  links.forEach(function (k) { by[k.to] = k.from; });
  eq(by['AR/L1@t1/zL1t1'], 'ST/L2@t1/zL2t1', 'Tower 1 floor 1 trails Tower 1 floor 2 (ord 0 + 2 - 1)');
  eq(by['AR/L2@t1/zL2t1'], 'ST/L3@t1/zL3t1', 'Tower 1 floor 2 trails Tower 1 floor 3');
  eq(by['AR/L1@t2/zL1t2'], 'ST/L2@t2/zL2t2',
    'Tower 2 counts its OWN ordinal, not one continued through Tower 1');
  eq(by['AR/L3@t2/zL3t2'], 'ST/L3@t2/zL3t2', 'the top floor clamps within its own tower');
}

/* ---------------------------------------------------------------- 3 · uneven towers */

console.log('\n3 · towers of different heights');
{
  const F = function () {
    return [fl('L1', 't1'), fl('L2', 't1'),
      fl('L1', 't2'), fl('L2', 't2'), fl('L3', 't2'), fl('L4', 't2')];
  };
  const was = crossTrade(BASE(cfgOf(TW2, { ST: F(), AR: F() }, { lead: 2 })));
  const now = crossTrade(NOW(cfgOf(TW2, { ST: F(), AR: F() }, { lead: 2 })));
  ok(was.some(function (k) { return towerOf(k.from) !== towerOf(k.to); }),
    'BASE: a short tower’s top floor reaches into the tall one');
  eq(now.filter(function (k) { return towerOf(k.from) !== towerOf(k.to); }).length, 0,
    'no link crosses towers, whatever the heights');
  eq(now.length, 6, 'every following floor still gets a predecessor — nothing was dropped');
}

/* ---------------------------------------------------------------- 4 · single tower is untouched */

console.log('\n4 · a single-tower project is byte-for-byte what it was');
{
  const F = function () {
    return [fl('B2', 't1', 'basement'), fl('B1', 't1', 'basement'),
      fl('GF', 't1', 'podium'), fl('L2', 't1'), fl('L3', 't1'), fl('L4', 't1'),
      fl('RD', 't1', 'roof')];
  };
  const opts = { lead: 3, batchKind: { ST: { basement: 1, podium: 2, typical: 3, roof: 1 } } };
  const was = JSON.stringify(BASE(cfgOf(TW1, { ST: F(), AR: F() }, opts)));
  const now = JSON.stringify(NOW(cfgOf(TW1, { ST: F(), AR: F() }, opts)));
  eq(now, was, 'identical link set on one tower — the fix cannot move an existing project');
  ok(JSON.parse(now).length > 10, 'and it is a real link set, not two empty arrays agreeing');
}

/* ---------------------------------------------------------------- 5 · per KIND, per TOWER */

console.log('\n5 · the handoff is counted within the kind AND the tower');
{
  const F = function () {
    return [fl('B2', 't1', 'basement'), fl('B1', 't1', 'basement'), fl('L1', 't1'), fl('L2', 't1'),
      fl('B2', 't2', 'basement'), fl('B1', 't2', 'basement'), fl('L1', 't2'), fl('L2', 't2')];
  };
  const links = crossTrade(NOW(cfgOf(TW2, { ST: F(), AR: F() },
    { batchKind: { ST: { basement: 1, typical: 2 } } })));
  const by = {}; links.forEach(function (k) { by[k.to] = k.from; });
  eq(by['AR/B2@t2/zB2t2'], 'ST/B2@t2/zB2t2',
    'a basement at 1 level behind follows the SAME basement, in its own tower');
  eq(by['AR/L1@t2/zL1t2'], 'ST/L2@t2/zL2t2',
    'a typical floor at 2 levels behind trails one level, in its own tower');
  eq(links.filter(function (k) { return towerOf(k.from) !== towerOf(k.to); }).length, 0,
    'still no crossing, with two kinds in play');
}

/* ---------------------------------------------------------------- 6 · the fallbacks */

console.log('\n6 · what happens where the leading trade does not work this tower');
{
  const ST = [fl('L1', 't1'), fl('L2', 't1')];                                   // Tower 1 only
  const AR = [fl('L1', 't1'), fl('L2', 't1'), fl('L1', 't2'), fl('L2', 't2')];   // both
  const by = {};
  crossTrade(NOW(cfgOf(TW2, { ST: ST, AR: AR }, { lead: 1 })))
    .forEach(function (k) { by[k.to] = k.from; });
  eq(by['AR/L1@t1/zL1t1'], 'ST/L1@t1/zL1t1', 'the tower the leader does work links normally');
  ok(by['AR/L1@t2/zL1t2'] != null,
    'a tower the leader never touches is NOT left without a predecessor — it falls back across towers');
}
{
  /* ⚠️⚠️ THE FIXTURE IS BUILT SO NEITHER LAZY ANSWER PASSES. The leading trade's list ENDS in
     Tower 1, so "the last floor overall" is the wrong tower; and it carries a floor coded `B1`
     in Tower 1, so "the same code anywhere" is the wrong tower too. Only the per-tower answer
     lands in Tower 2. An earlier version of this fixture had the leader ending in Tower 2 and
     could not tell the three apart — it passed with the fallback disabled. */
  const ST = [fl('L1', 't2'), fl('L2', 't2'), fl('B1', 't1', 'basement'), fl('L1', 't1')];
  const AR = [fl('B1', 't2', 'basement'), fl('L1', 't2'), fl('L2', 't2'), fl('L1', 't1')];
  const by = {};
  crossTrade(NOW(cfgOf(TW2, { ST: ST, AR: AR }, { lead: 1 })))
    .forEach(function (k) { by[k.to] = k.from; });
  eq(by['AR/B1@t2/zB1t2'], 'ST/L2@t2/zL2t2',
    'a kind the leader has none of in this tower takes THAT tower’s own top floor — ' +
    'not the last floor overall, and not a same-coded floor in another tower');
}

/* ---------------------------------------------------------------- 7 · the answers still suppress */

console.log('\n7 · "start together" still suppresses the handoff');
{
  const all = crossTrade(NOW(cfgOf(TW2, { ST: threeEach(), AR: threeEach() },
    { parallel: { ST: 1 } })));
  eq(all.length, 0, 'a leading trade marked parallel outright draws no cross-trade link at all');

  const one = function () { return [fl('B1', 't1', 'basement'), fl('L1', 't1')]; };
  const kindly = crossTrade(NOW(cfgOf(TW1, { ST: one(), AR: one() },
    { parallelKind: { ST: { basement: 1 } } })));
  eq(kindly.length, 1, 'a kind marked parallel drops only that kind’s link');
  eq(kindly[0].to, 'AR/L1@t1/zL1t1', 'and it is the basement that was dropped');
}

/* ---------------------------------------------------------------- 8 · source gates */

console.log('\n8 · the source');
{
  const scan = require('../../tools/scan.js');
  const code = scan.blankComments(fs.readFileSync(FILE, 'utf8'));
  const base = scan.blankComments(BASE_SRC);

  ok(/var lead = Math\.max\(1, \+cfg\.floorLead/.test(base),
    'BASE carries the dead per-project `lead` local');
  ok(!/var lead = Math\.max\(1, \+cfg\.floorLead/.test(code),
    'the dead `lead` local is gone — `batchKind` is the only reader of cfg.floorLead');
  ok(/pByTK\[tw \+ '\|' \+ k\]/.test(code), 'the leading trade is grouped by (tower, kind)');
  ok(!/pByKind/.test(code), 'the kind-only grouping is gone, not left beside its replacement');

  /* ⚠️⚠️ THE OPTIONAL SLICE CANNOT HIDE THE GATE GOING MISSING. `locless` is linked only where the
     source defines it (see FNS_OPT), which is what lets the pinned base build at all — so the
     CURRENT file is required to define it, and `locList` is required to call it. Without these
     two, deleting the gate would make the suite pass by falling back to the base's behaviour. */
  ok(/function locless\s*\(/.test(code), 'the current file defines locless');
  // ⚠️ Bounded to 400 characters so this still matches locList's OWN gate and not another
  //    function's — locList stopped being a one-liner when tower types landed.
  ok(/function locList\(\)\s*\{[\s\S]{0,400}?if \(locless\(tr\)\) return;/.test(code),
     'locList gates on it, so a loc-less trade produces no leaves');
  ok(!/function locless\s*\(/.test(base), 'BASE has no locless — which is why the slice is optional');
}

console.log('\nPASS ' + pass + '  FAIL ' + fail);
process.exit(fail ? 1 : 0);
