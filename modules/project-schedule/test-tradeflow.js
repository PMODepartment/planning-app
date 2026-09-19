/* THE CROSS-TRADE HAND-OFF — declared predecessor + lead, EXECUTED.
 *
 * Run:  node modules/project-schedule/test-tradeflow.js
 *
 * ⚠️⚠️ THE SHIPPED FUNCTIONS ARE SLICED OUT OF index.html BY NAME AND RUN — `autoTrace`,
 *    `tradeFlowOf`, `handoffFrom` and every helper they reach. Nothing here re-implements the
 *    linking rule: a suite that re-implements it proves the re-implementation, and this repo has
 *    been caught by that four times.
 * ⚠️⚠️ GATED AGAINST A PINNED SHA that must REPRODUCE the pre-change behaviour. A suite that
 *    passes on both files proves nothing, and `HEAD` stops being the pre-change state the moment
 *    this commits — so the SHA is written out rather than resolved.
 * ⚠️ The base predates `tradeFlowOf` entirely, so the contrast is drawn on what auto-trace
 *    PRODUCES rather than on the resolver, which has nothing to compare against.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeSlicer } = require('./test-slice.js');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(__dirname, 'index.html');
const BASE_SHA = 'fb2bf73';   // the commit BEFORE the declared cross-trade hand-off

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('  FAIL ' + m); } }
function eq(a, b, m) { ok(a === b, m + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); }

/* ---------------------------------------------------------------- the harness */

const FNS = ['autoTrace', 'zoneGroupsOfFloor', 'floorGateOf', 'floorLagOf', 'tryLink', 'reaches',
  'START', 'END', 'floorKind', 'batchKind', 'declaredBatch', 'declaredBatchOf',
  'parallelKind', 'parallelKindOf', 'leavesOfFloor', 'towerList', 'towerIdOf',
  'floorIndexOf', 'tradeActs', 'locList', 'floorsOf', 'handoffFrom',
  'towerSimulOf', 'floorSimulOf', 'locCellKey'];

/* ⚠️ Sliced ONLY where it exists: `tradeFlowOf` is the function under test and the pinned base has
   never heard of it, so slicing it unconditionally would fail the contrast build on a name the
   base does not define. It is NOT stubbed — an assertion below requires the current file to define
   it, so this cannot quietly hide the whole feature going missing. */
const FNS_OPT = ['tradeFlowOf', 'locless', 'towerById', 'blankTowerTypes', 'typeList', 'typeById',
  'typeOfTower', 'towersOfType', 'repTowerOf', 'repTowerOfTower'];

function build(src) {
  const S = makeSlicer(src);
  let body = '';
  FNS.forEach(function (n) { body += S.sliceFn(n) + '\n'; });
  FNS_OPT.forEach(function (n) {
    if (src.indexOf('function ' + n + '(') >= 0) body += S.sliceFn(n) + '\n';
  });
  if (src.indexOf('var LOCLESS = ') >= 0) body += S.sliceVarLine('LOCLESS') + '\n';
  body += S.sliceVarLine('KIND_LABEL') + '\n' + S.sliceVarLine('KIND_ORDER') + '\n';
  /* ⚠️ GWORK / GLABEL are what `handoffFrom` keys its export by — sliced from the file, never
     retyped, because the KEY SPELLING is half of what that function is for. */
  body += S.sliceVarLine('GLABEL') + '\n' + S.sliceVarLine('GWORK') + '\n';

  return new Function(
    '"use strict";\n' +
    'var cfg = null, GROUPS = ["ST","AR","ME"];\n' +
    'function markDirty(){}\n' +
    'function render(){}\n' +
    'function blankTowers(){ return [{ id:"t1", name:"Tower 1" }]; }\n' +
    'function towerLabel(id){ return id; }\n' +
    body +
    'return {\n' +
    '  trace: function (c) { cfg = c; autoTrace(); return cfg.links; },\n' +
    '  flow: (typeof tradeFlowOf === "function")\n' +
    '        ? function (c, tr, present, i) { cfg = c; return tradeFlowOf(tr, present, i); } : null,\n' +
    '  handoff: function (c) { return handoffFrom(c); }\n' +
    '};'
  )();
}

const BASE_SRC = execFileSync('git', ['show', BASE_SHA + ':modules/project-schedule/index.html'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
const SRC = fs.readFileSync(FILE, 'utf8');
const NOW = build(SRC);
const BASE = build(BASE_SRC);

/* ⚠️ THE GATE. If the base already had the feature, every contrast below is self-comparison. */
ok(BASE_SRC.indexOf('function tradeFlowOf(') < 0, 'GATE: the pinned base has no tradeFlowOf');
ok(SRC.indexOf('function tradeFlowOf(') >= 0, 'GATE: the current file defines tradeFlowOf');
ok(!!NOW.flow, 'GATE: tradeFlowOf was sliced and is callable');

/* ---------------------------------------------------------------- fixtures */

function fl(code, tw, kind) {
  return {
    id: code + '@' + tw, code: code, name: code, kind: kind || 'typical', towerId: tw,
    zones: [{ id: 'z' + code + tw, code: 'Z1', units: [] }]
  };
}
function fourEach(tw) { return [fl('L1', tw), fl('L2', tw), fl('L3', tw), fl('L4', tw)]; }
const TW1 = [{ id: 't1', name: 'Tower 1' }];

function cfgOf(opts) {
  const o = opts || {}, z = {};
  ['ST', 'AR', 'ME'].forEach(function (tr) { z[tr] = { floors: fourEach('t1') }; });
  return {
    startDate: '2026-01-01',
    activities: ['ST', 'AR', 'ME'].map(function (tr) { return { id: 'a' + tr, group: tr }; }),
    towers: TW1, zoning: z, links: [], actLinks: [], locLevel: 'auto',
    floorLead: o.lead == null ? 4 : o.lead,
    tradeLeads: o.tradeLeads || {}, tradeBatch: {}, tradeBatchKind: o.batchKind || {},
    tradeParallel: o.parallel || {}, tradeParallelKind: {},
    tradeFlow: o.tradeFlow || {},
    towerSimul: {}, floorSimul: o.floorSimul || {},
    zoneSimul: {}, unitSimul: {}, floorLag: {}, floorGate: {}, zoneZigzag: {}, zoneOrder: {}
  };
}
// A leaf uid is `<trade>/<floor id>/<zone id>`; the floor id carries its own tower.
function fnum(uid) { const m = /\/L(\d)@/.exec(String(uid)); return m ? +m[1] : null; }
function pairLinks(links, a, b) {
  const ra = new RegExp('^' + a + '/'), rb = new RegExp('^' + b + '/');
  return links.filter(function (k) { return ra.test(k.from) && rb.test(k.to); });
}
function mapOf(links, a, b) {   // follower floor -> leader floor it waits on
  const out = {};
  pairLinks(links, a, b).forEach(function (k) { out[fnum(k.to)] = fnum(k.from); });
  return out;
}

/* ---------------------------------------------------------------- 1 · nothing declared */

console.log('\n1 · no tradeFlow — byte-for-byte the positional chain the base draws');
{
  const mk = function () { return cfgOf({ lead: 2 }); };
  const was = BASE.trace(mk()), now = NOW.trace(mk());
  eq(JSON.stringify(now), JSON.stringify(was),
    'an un-answered setup traces identically to the pinned base');
  // and the positional chain is what that is: ST -> AR -> ME, nobody skipping anybody
  ok(pairLinks(now, 'ST', 'AR').length > 0, 'ST leads AR');
  ok(pairLinks(now, 'AR', 'ME').length > 0, 'AR leads ME');
  eq(pairLinks(now, 'ST', 'ME').length, 0, 'ST does NOT lead ME — that is the positional chain');
}

/* ---------------------------------------------------------------- 2 · a declared predecessor */

console.log('\n2 · "MEPF follows Structural" — unsayable before, because the chain was positional');
{
  const c = cfgOf({ lead: 2, tradeFlow: { ME: { after: 'ST', lead: 2 } } });
  const now = NOW.trace(c);
  ok(pairLinks(now, 'ST', 'ME').length > 0, 'ME now waits on ST directly');
  eq(pairLinks(now, 'AR', 'ME').length, 0, 'and no longer on AR, which sits between them in GROUPS order');
  // the base cannot express it at all — the same cfg traces the positional chain
  const was = BASE.trace(cfgOf({ lead: 2, tradeFlow: { ME: { after: 'ST', lead: 2 } } }));
  eq(pairLinks(was, 'ST', 'ME').length, 0, 'CONTRAST: the base ignores the declaration entirely');
  ok(pairLinks(was, 'AR', 'ME').length > 0, 'CONTRAST: the base still chains ME behind AR');
}

/* ---------------------------------------------------------------- 3 · the lead */

console.log('\n3 · the lead is the declared number, and it is counted the tracer’s own way');
{
  const m1 = mapOf(NOW.trace(cfgOf({ lead: 4, tradeFlow: { AR: { after: 'ST', lead: 1 } } })), 'ST', 'AR');
  eq(JSON.stringify(m1), JSON.stringify({ 1: 1, 2: 2, 3: 3, 4: 4 }),
    '1 level behind: each AR floor waits on the ST floor of the same level');
  const m2 = mapOf(NOW.trace(cfgOf({ lead: 4, tradeFlow: { AR: { after: 'ST', lead: 2 } } })), 'ST', 'AR');
  eq(JSON.stringify(m2), JSON.stringify({ 1: 2, 2: 3, 3: 4, 4: 4 }),
    '2 levels behind, CLAMPED at the top floor — Math.min(ord + L - 1, pk.length - 1)');
  /* ⚠️ The declared number must WIN over cfg.floorLead, which is the default `blank()` writes to
     every project. That it does is the whole reason the question exists. */
  const m3 = mapOf(NOW.trace(cfgOf({ lead: 4, tradeFlow: { AR: { after: 'ST', lead: 1 } } })), 'ST', 'AR');
  const m4 = mapOf(NOW.trace(cfgOf({ lead: 1, tradeFlow: { AR: { after: 'ST', lead: 1 } } })), 'ST', 'AR');
  eq(JSON.stringify(m3), JSON.stringify(m4), 'the declared lead overrides cfg.floorLead');
}

/* ---------------------------------------------------------------- 4 · start together */

console.log('\n4 · lead 0 is "start together", and it draws no trailing link');
{
  const now = NOW.trace(cfgOf({ lead: 4, tradeFlow: { AR: { after: 'ST', lead: 0 } } }));
  eq(pairLinks(now, 'ST', 'AR').length, 0, 'no ST→AR link at all');
  // ⚠️ and AR is not left dangling: the bookend pass gives every un-preceded leaf START.
  const arStart = now.filter(function (k) { return /^AR\/L1@/.test(k.to) && k.from === '__START__'; });
  ok(arStart.length > 0 || now.some(function (k) { return /^AR\//.test(k.to) && !/^(ST|AR|ME)\//.test(k.from); }),
    'AR’s first floor is bookended to START rather than orphaned');
}

/* ---------------------------------------------------------------- 5 · "starts with the project" */

console.log('\n5 · after:"" is an ANSWER — the trade waits on nobody');
{
  const now = NOW.trace(cfgOf({ lead: 4, tradeFlow: { AR: { after: '', lead: null } } }));
  eq(pairLinks(now, 'ST', 'AR').length, 0, 'AR waits on no trade');
  ok(pairLinks(now, 'AR', 'ME').length > 0, 'and ME still follows AR — one answer does not break the chain');
}

/* ---------------------------------------------------------------- 6 · BALANCED */

console.log('\n6 · balanced (lead null) is DERIVED from the leader’s own floor window');
{
  /* ST runs 2 floors of the tower at once, so it has cleared its window 2 levels up: the tightest
     handoff that never puts two trades on one storey is AR trailing by 2. */
  const now = NOW.trace(cfgOf({ lead: 4, floorSimul: { ST: 2 }, tradeFlow: { AR: { after: 'ST', lead: null } } }));
  const mB = mapOf(now, 'ST', 'AR');
  eq(JSON.stringify(mB), JSON.stringify({ 1: 2, 2: 3, 3: 4, 4: 4 }), 'ST doing 2 at once → AR trails by 2');
  const m1 = mapOf(NOW.trace(cfgOf({ lead: 4, floorSimul: { ST: 1 }, tradeFlow: { AR: { after: 'ST', lead: null } } })), 'ST', 'AR');
  eq(JSON.stringify(m1), JSON.stringify({ 1: 1, 2: 2, 3: 3, 4: 4 }), 'ST doing 1 at once → AR trails by 1');
  const m3 = mapOf(NOW.trace(cfgOf({ lead: 4, floorSimul: { ST: 3 }, tradeFlow: { AR: { after: 'ST', lead: null } } })), 'ST', 'AR');
  eq(JSON.stringify(m3), JSON.stringify({ 1: 3, 2: 4, 3: 4, 4: 4 }), 'ST doing 3 at once → AR trails by 3');
  /* ⚠️ THE LEADER'S window, never the follower's — what gates the handoff is when the floor comes
     FREE, which is a fact about the trade vacating it. */
  const mF = mapOf(NOW.trace(cfgOf({ lead: 4, floorSimul: { ST: 1, AR: 3 }, tradeFlow: { AR: { after: 'ST', lead: null } } })), 'ST', 'AR');
  eq(JSON.stringify(mF), JSON.stringify(m1), 'the FOLLOWER’s own window does not move the handoff');
  // and 4 is never the answer here, which is what cfg.floorLead would have given
  ok(JSON.stringify(mB) !== JSON.stringify(mapOf(NOW.trace(cfgOf({ lead: 4 })), 'ST', 'AR')),
    'balanced is not merely cfg.floorLead under another name');
}

/* ---------------------------------------------------------------- 7 · the resolver itself */

console.log('\n7 · tradeFlowOf — the fallbacks, stated');
{
  const P = ['ST', 'AR', 'ME'];
  const f0 = NOW.flow(cfgOf({}), 'AR', P, 1);
  eq(f0.after, 'ST', 'nothing declared → the positional predecessor');
  eq(f0.declared, false, 'and it says so');
  eq(f0.lead('typical'), 4, 'and the lead is the legacy batchKind answer (cfg.floorLead)');

  const f1 = NOW.flow(cfgOf({ tradeFlow: { AR: { after: 'ME', lead: 1 } } }), 'AR', P, 1);
  eq(f1.after, 'ME', 'a declared predecessor is honoured even against GROUPS order');

  /* ⚠️ A predecessor that is no longer on the project falls back rather than chaining to nothing —
     `idx[prev]` would be undefined and the whole cross-trade pass for that trade would throw. */
  const f2 = NOW.flow(cfgOf({ tradeFlow: { AR: { after: 'XX', lead: 1 } } }), 'AR', ['ST', 'AR'], 1);
  eq(f2.after, 'ST', 'a predecessor absent from `present` falls back to the positional one');

  const f3 = NOW.flow(cfgOf({ tradeFlow: { AR: { after: '', lead: null } } }), 'AR', P, 1);
  eq(f3.after, '', '"starts with the project" survives as an answer');
  eq(f3.parallel('typical'), true, 'and reads as parallel — nothing to trail');

  const f4 = NOW.flow(cfgOf({ tradeFlow: { AR: { after: 'ST', lead: 0 } } }), 'AR', P, 1);
  eq(f4.parallel('typical'), true, 'lead 0 reads as parallel');
  const f5 = NOW.flow(cfgOf({ tradeFlow: { AR: { after: 'ST', lead: 3 } } }), 'AR', P, 1);
  eq(f5.parallel('typical'), false, 'a real lead does not');

  // the first trade has no positional predecessor and must not invent one
  const f6 = NOW.flow(cfgOf({}), 'ST', P, 0);
  eq(f6.after, '', 'the leading trade follows nobody');
}

/* ---------------------------------------------------------------- 8 · the legacy answers survive */

console.log('\n8 · a setup on the retired per-category answers is UNTOUCHED');
{
  const legacy = { batchKind: { ST: { typical: 2 } } };
  const was = BASE.trace(cfgOf(legacy)), now = NOW.trace(cfgOf(legacy));
  eq(JSON.stringify(now), JSON.stringify(was), 'per-kind tradeBatchKind still drives the trace');
  const withNew = NOW.trace(cfgOf({ batchKind: { ST: { typical: 2 } }, tradeFlow: { AR: { after: 'ST', lead: 4 } } }));
  eq(JSON.stringify(mapOf(withNew, 'ST', 'AR')), JSON.stringify({ 1: 4, 2: 4, 3: 4, 4: 4 }),
    'and the new answer wins where it exists');
}

/* ---------------------------------------------------------------- 9 · a declared loop */

console.log('\n9 · a circular declaration cannot produce a link cycle');
{
  const c = cfgOf({ tradeFlow: { ST: { after: 'AR', lead: 1 }, AR: { after: 'ST', lead: 1 } } });
  let threw = null;
  try { NOW.trace(c); } catch (e) { threw = e; }
  ok(!threw, 'it traces rather than throwing');
  // tryLink refuses a cycle via reaches(), so one direction survives and the other does not
  const a = pairLinks(c.links, 'ST', 'AR').length, b = pairLinks(c.links, 'AR', 'ST').length;
  ok(!(a > 0 && b > 0), 'never both directions between the same two trades');
}

/* ---------------------------------------------------------------- 10 · the clash export */

console.log('\n10 · handoffFrom projects the declared flow onto the pair export');
{
  const h = NOW.handoff(cfgOf({ tradeFlow: { AR: { after: 'ST', lead: 3 } } }));
  ok(h.any, 'it counts as a declaration');
  eq(h.pair['structural works>architectural works'], 3, 'keyed by the canonical GWORK label');
  eq(h.pair['structural>architectural'], 3, 'and by the setup’s own short GLABEL');
  eq(h.pair['st>ar'], 3, 'and by the raw trade code');

  /* ⚠️⚠️ A LEAD OF 0 IS EXPORTED, and that is what makes "start together" silence the clash
     detector by STATEMENT rather than by luck: the consumer's own `L >= 1` test fails, AND the
     pair being present stops it falling back to a stale per-leading-trade record. */
  const h0 = NOW.handoff(cfgOf({ tradeFlow: { AR: { after: 'ST', lead: 0 } } }, 0));
  eq(h0.pair['st>ar'], 0, 'lead 0 reaches the export rather than being filtered out');

  // balanced is deliberately NOT exported — this side has no floors to derive it from
  const hb = NOW.handoff(cfgOf({ tradeFlow: { AR: { after: 'ST', lead: null } } }));
  eq(hb.pair['st>ar'], undefined, 'balanced is left to the per-leading-trade record, not guessed');

  // the legacy per-pair field still wins, as its own note says it must
  const hl = NOW.handoff(cfgOf({ tradeFlow: { AR: { after: 'ST', lead: 3 } }, tradeLeads: { 'ST>AR': 7 } }));
  eq(hl.pair['st>ar'], 7, 'the legacy per-pair answer is the most specific and still wins');

  const hBase = BASE.handoff(cfgOf({ tradeFlow: { AR: { after: 'ST', lead: 3 } } }));
  eq(hBase.pair['st>ar'], undefined, 'CONTRAST: the base cannot see the declaration');
}

/* ---------------------------------------------------------------- report */

console.log('\n' + (fail ? 'FAIL' : 'PASS') + ': ' + pass + ' assertions passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
