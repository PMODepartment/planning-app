/* PER-TOWER ZONE SEQUENCING — slice-and-execute suite.
 *
 * Owner 2026-09-17: *"for the zone sequence, when there are multiple towers, users should be able
 * to define the zone sequence per tower … But users are able to copy the zone sequence of a tower
 * from another tower but if zones and number of floors and layout are not the same, these should
 * not proceed."* And, on the step above it: *"when users select another tower, there is an option
 * wherein users are able to copy the trades from another tower and the number of floors etc."*
 *
 * ⚠️⚠️ WHAT MAKES THIS WORTH A SUITE rather than a screenshot: `copyTowerSeq` copies links BY
 *    POSITION, and a position copy onto a tower with one floor fewer produces a schedule that is
 *    WRONG BUT PLAUSIBLE — every arrow lands one storey out, the diagonal still looks like a
 *    diagonal, and nothing downstream can tell. The refusal is therefore the feature, and a
 *    refusal is exactly the kind of thing that is quietly lost in a later edit. So the mismatch
 *    cases are asserted one at a time: a floor count, a category, a zone count, a unit count, and
 *    a trade present on one side only.
 *
 * ⚠️ The functions are SLICED OUT OF THE SHIPPED index.html BY NAME and executed — nothing here
 *    re-implements the rule under test (see test-slice.js for why that matters). Anything the
 *    sliced code needs is either sliced too or is a fixture the module does not own (`cfg`).
 *    NOTHING under test is stubbed.
 *
 * Usage:  node modules/project-schedule/test-towerseq.js
 * Contrast build (must NOT have the feature):  the suite runs it itself, pinned below.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { makeSlicer } = require('./test-slice.js');

const ROOT = path.join(__dirname, '..', '..');
const PAGE = path.join(__dirname, 'index.html');

/* ⚠️ PINNED, NEVER `HEAD`. This is the commit before this feature — the one that shipped the
   dialog kit and the shape editor. `git show HEAD:` becomes self-comparison the moment you
   commit, and this repo has been caught by that. */
const BASE_SHA = '2ae9bc7d';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label, got) {
  if (cond) pass++;
  else { fail++; fails.push(label + (got === undefined ? '' : '  [got: ' + JSON.stringify(got) + ']')); }
}

/* ---------------------------------------------------------------------------------------- */
/* The fixture. Two towers that are laid out identically, and the mutations that break them.  */
/* ---------------------------------------------------------------------------------------- */
let seq = 0;
function uidv() { return 'u' + (++seq); }

function mkTower(twId, floors) {
  return floors.map(function (f) {
    return {
      id: uidv(), code: f[0], name: '', kind: f[1], sub: f[1] === 'basement', towerId: twId,
      zones: (f[2] || []).map(function (z) {
        return { id: uidv(), code: z[0], units: [] .concat(new Array(z[1] || 0).fill(0)).map(function (_, i) { return { id: uidv(), code: 'U' + (i + 1) }; }) };
      })
    };
  });
}

/* Tower A and Tower B: same shape, different ids. ST is zoned, AR follows it. */
function mkCfg() {
  const A = 'twA', B = 'twB';
  const shape = [['B1', 'basement', [['Z1', 0]]], ['F1', 'typical', [['Z1', 0], ['Z2', 0]]], ['F2', 'typical', [['Z1', 0], ['Z2', 0]]]];
  return {
    locLevel: 'auto',
    towers: [{ id: A, code: 'TA', name: 'Tower A' }, { id: B, code: 'TB', name: 'Tower B' }],
    links: [],
    activities: [{ id: 'a1', group: 'ST' }, { id: 'a2', group: 'AR' }, { id: 'a3', group: 'GR' }],
    zoning: {
      GR: { floors: [] }, SW: { floors: [] },
      ST: { floors: mkTower(A, shape).concat(mkTower(B, shape)) },
      AR: { floors: mkTower(A, shape).concat(mkTower(B, shape)) },
      MEPF: { floors: [] }, SD: { floors: [] }, ALLIED: { floors: [] }, OT: { floors: [] }
    }
  };
}

/* ---------------------------------------------------------------------------------------- */
/* Build a sandbox out of the SHIPPED source.                                                 */
/* ---------------------------------------------------------------------------------------- */
const FNS = [
  'floorsOf', 'towerById', 'towerLabel', 'towerIdOf', 'towerList', 'blankTowers', 'floorsOfTower',
  'floorKind', 'locless', 'leavesOfFloor', 'cloneFloors', 'multiTower',
  'twShapeOf', '_twSame', 'twShapeDiff', 'twSeqCount', 'copyTowerSeq', 'copyTower', 'seqFloors',
  /* ⚠️ Tower TYPES (2026-09-18). floorsOfTower resolves an instance to its type's representative,
     so these are REAL dependencies of a function this suite already slices — linked, never stubbed.
     They are optional for the same reason `twShapeOf` is: the pinned base does not define them. */
  'blankTowerTypes', 'typeList', 'typeById', 'typeOfTower', 'towersOfType', 'repTowerOf', 'repTowerOfTower'
];
const VARS = ['GROUPS', 'GLABEL', 'KIND_ORDER', 'KIND_LABEL', 'LOCLESS'];

function build(src, opts) {
  opts = opts || {};
  const S = makeSlicer(src);
  const bodies = [];
  FNS.forEach(function (n) {
    if (opts.optional && opts.optional.indexOf(n) >= 0 && src.indexOf('function ' + n + '(') < 0) return;
    bodies.push(S.sliceFn(n));
  });
  VARS.forEach(function (n) { bodies.push(S.sliceVarLine(n)); });
  /* ⚠️ `cfg`, `seqTower` and `uidv` are the ONLY things provided: `cfg` is the document under
     edit (the suite's fixture is the document), `seqTower` is UI state the step owns, and `uidv`
     is a random-id source a deterministic test must control. Every rule being tested is sliced. */
  const pre = 'var cfg = null, seqTower = "ALL";\n' + uidv.toString() + '\nvar seq = 0;\n';
  const post = '\nreturn { ' + FNS.filter(function (n) {
    return !(opts.optional && opts.optional.indexOf(n) >= 0 && src.indexOf('function ' + n + '(') < 0);
  }).map(function (n) { return n + ': ' + n; }).join(', ') +
    ', setCfg: function (c) { cfg = c; }, getCfg: function () { return cfg; },' +
    ' setSeqTower: function (t) { seqTower = t; } };';
  return new Function(pre + bodies.join('\n') + post)();
}

const SRC = fs.readFileSync(PAGE, 'utf8');
let M;
try { M = build(SRC); }
catch (e) { console.error('BUILD FAILED — cannot run: ' + e.message); process.exit(1); }

/* Helper: the leaf uids of one tower, in order, for a trade. */
function leaves(m, tr, twId) {
  const out = [];
  m.floorsOfTower(tr, twId).forEach(function (f) { m.leavesOfFloor(tr, f).forEach(function (l) { out.push(l.uid); }); });
  return out;
}
/* A straight chain through one tower's leaves, which is what auto-trace produces. */
function chain(m, tr, twId) {
  const u = leaves(m, tr, twId), out = [];
  for (let i = 1; i < u.length; i++) out.push({ from: u[i - 1], to: u[i], type: 'FS', lag: 0 });
  return out;
}

console.log('per-tower zone sequencing — the shipped functions, executed\n');

/* ================= 1 · the shape reader ================================================== */
{
  const c = mkCfg(); M.setCfg(c);
  const sa = M.twShapeOf('twA');
  ok(sa.length === 2, '1.1  twShapeOf lists the two trades that have floors, not all eight', sa.length);
  ok(sa[0].tr === 'ST' && sa[1].tr === 'AR', '1.2  in GROUPS order', sa.map(function (x) { return x.tr; }));
  ok(sa[0].floors.length === 3, '1.3  three floors per trade in this tower', sa[0].floors.length);
  ok(sa[0].floors[0].kind === 'basement', '1.4  the category is read through floorKind');
  ok(sa[0].floors[1].zones.length === 2, '1.5  and the zones under each floor', sa[0].floors[1].zones.length);
  /* ⚠️ THE ONE THAT MATTERS FOR "general requirements should have no tower": GR carries no
     locations, so it must not appear in a shape comparison at all — otherwise a GR floor typed by
     accident would block every copy on the project. */
  c.zoning.GR.floors = mkTower('twA', [['F1', 'typical', []]]);
  const sa2 = M.twShapeOf('twA');
  ok(sa2.filter(function (x) { return x.tr === 'GR'; }).length === 0,
    '1.6  a LOCLESS trade never enters the shape, however many floors it has');
}

/* ================= 2 · identical towers compare equal ==================================== */
{
  const c = mkCfg(); M.setCfg(c);
  const d = M.twShapeDiff(M.twShapeOf('twA'), M.twShapeOf('twB'));
  ok(d.blocking.length === 0, '2.1  two towers with the same layout have NO blocking differences', d.blocking);
  ok(d.naming.length === 0, '2.2  and no naming differences either', d.naming);
}

/* ================= 3 · every way of being different is caught ============================ */
function diffAfter(mutate) {
  const c = mkCfg(); M.setCfg(c); mutate(c);
  return M.twShapeDiff(M.twShapeOf('twA'), M.twShapeOf('twB'));
}
{
  /* a floor fewer — the case that would otherwise shift every link one storey */
  let d = diffAfter(function (c) { c.zoning.ST.floors = c.zoning.ST.floors.filter(function (f) { return !(f.towerId === 'twB' && f.code === 'F2'); }); });
  ok(d.blocking.length === 1 && /3 floors there, 2 here/.test(d.blocking[0]),
    '3.1  a different FLOOR COUNT blocks, and says both numbers', d.blocking);

  /* a category changed — the field the zone sequence branches on */
  d = diffAfter(function (c) { c.zoning.ST.floors.filter(function (f) { return f.towerId === 'twB' && f.code === 'F2'; })[0].kind = 'roof'; });
  ok(d.blocking.length === 1 && /Typical there and Roof Deck here/.test(d.blocking[0]),
    '3.2  a different CATEGORY blocks, in words not codes', d.blocking);

  /* a zone fewer */
  d = diffAfter(function (c) { c.zoning.AR.floors.filter(function (f) { return f.towerId === 'twB' && f.code === 'F1'; })[0].zones.pop(); });
  ok(d.blocking.length === 1 && /2 zones there and 1 here/.test(d.blocking[0]),
    '3.3  a different ZONE COUNT blocks', d.blocking);

  /* a unit count that differs — the deepest rung, and the one a screen does not show */
  d = diffAfter(function (c) {
    const f = c.zoning.ST.floors.filter(function (x) { return x.towerId === 'twB' && x.code === 'F1'; })[0];
    f.zones[0].units.push({ id: 'zz', code: 'U1' });
  });
  ok(d.blocking.length === 1 && /0 units there and 1 here/.test(d.blocking[0]),
    '3.4  a different UNIT COUNT blocks', d.blocking);

  /* a trade on one side only */
  d = diffAfter(function (c) { c.zoning.AR.floors = c.zoning.AR.floors.filter(function (f) { return f.towerId !== 'twB'; }); });
  ok(d.blocking.some(function (s) { return /Architectural has floors there and none here/.test(s); }),
    '3.5  a trade present in one tower and not the other blocks, naming the trade', d.blocking);

  /* ⚠️ AND THE ONE THAT MUST **NOT** BLOCK. Two towers laid out identically may legitimately name
     their floors A-F1 and B-F1; the copy maps by position and never reads a code. */
  d = diffAfter(function (c) { c.zoning.ST.floors.filter(function (f) { return f.towerId === 'twB' && f.code === 'F1'; })[0].code = 'B-F1'; });
  ok(d.blocking.length === 0, '3.6  a different NAME does not block', d.blocking);
  ok(d.naming.length === 1 && /“F1” there and “B-F1” here/.test(d.naming[0]),
    '3.7  …it is reported instead', d.naming);

  /* ⚠️ Once the counts differ, the per-floor walk is skipped — comparing floor 3 of one tower
     against nothing is how a refusal grows a list of noise nobody reads. */
  d = diffAfter(function (c) {
    c.zoning.ST.floors = c.zoning.ST.floors.filter(function (f) { return !(f.towerId === 'twB' && f.code === 'F2'); });
    c.zoning.ST.floors.filter(function (f) { return f.towerId === 'twB' && f.code === 'F1'; })[0].zones.pop();
  });
  ok(d.blocking.length === 1, '3.8  a floor-count mismatch reports ONCE, not once per floor', d.blocking);
}

/* ================= 4 · the copy itself =================================================== */
{
  const c = mkCfg(); M.setCfg(c);
  c.links = chain(M, 'ST', 'twA').concat(chain(M, 'AR', 'twA'));
  const before = c.links.length;
  ok(M.twSeqCount('twA') === before, '4.1  twSeqCount sees the source tower’s own links', M.twSeqCount('twA'));
  ok(M.twSeqCount('twB') === 0, '4.2  …and none in the empty tower');

  const r = M.copyTowerSeq('twA', 'twB', true);
  ok(r.added === before, '4.3  every link is copied', r);
  ok(M.twSeqCount('twB') === before, '4.4  and lands INSIDE tower B', M.twSeqCount('twB'));
  ok(M.twSeqCount('twA') === before, '4.5  leaving tower A untouched', M.twSeqCount('twA'));
  ok(c.links.length === before * 2, '4.6  nothing else was added or removed', c.links.length);

  /* ⚠️ THE SHAPE OF THE COPY, NOT JUST ITS SIZE: the nth link of the source must join the nth and
     (n+1)th leaf of the DESTINATION. A copy that produced the right COUNT against the wrong leaves
     is precisely the bug this feature exists to make impossible. */
  const dst = leaves(M, 'ST', 'twB');
  const stB = c.links.filter(function (k) { return dst.indexOf(k.from) >= 0 && dst.indexOf(k.to) >= 0; });
  let inOrder = stB.length === dst.length - 1;
  stB.forEach(function (k) {
    const i = dst.indexOf(k.from), j = dst.indexOf(k.to);
    if (j !== i + 1) inOrder = false;
  });
  ok(inOrder, '4.7  each copied link joins consecutive leaves of the DESTINATION tower');

  /* Running it again adds nothing — the links are already there. */
  const r2 = M.copyTowerSeq('twA', 'twB', false);
  ok(r2.added === 0 && r2.skipped === before, '4.8  a second copy adds nothing and says so', r2);
}
{
  /* ⚠️ A CROSS-TOWER LINK IS A STATEMENT ABOUT THE OTHER TOWER and must not be duplicated: copying
     it would invent a second arrow nobody drew, pointing at the same place. */
  const c = mkCfg(); M.setCfg(c);
  const a = leaves(M, 'ST', 'twA'), b = leaves(M, 'ST', 'twB');
  c.links = [{ from: a[0], to: a[1], type: 'FS', lag: 0 }, { from: a[1], to: b[0], type: 'SS', lag: 3 }];
  const r = M.copyTowerSeq('twA', 'twB', true);
  ok(r.added === 1, '4.9  only the link with BOTH ends inside the source is copied', r);
  ok(c.links.filter(function (k) { return k.type === 'SS'; }).length === 1,
    '4.10 the cross-tower link is left exactly as it was, not duplicated');
}
{
  /* `replace` clears the destination's own links only — never the ones that cross to elsewhere. */
  const c = mkCfg(); M.setCfg(c);
  const a = leaves(M, 'ST', 'twA'), b = leaves(M, 'ST', 'twB');
  c.links = chain(M, 'ST', 'twA')
    .concat([{ from: b[0], to: b[2], type: 'FF', lag: 7 }])   // tower B's own, to be replaced
    .concat([{ from: a[0], to: b[0], type: 'SS', lag: 1 }]);  // crosses — must survive
  const r = M.copyTowerSeq('twA', 'twB', true);
  ok(r.removed === 1, '4.11 replace removes the destination’s OWN links', r);
  ok(c.links.filter(function (k) { return k.type === 'FF'; }).length === 0, '4.12 …that one is gone');
  ok(c.links.filter(function (k) { return k.type === 'SS' && k.lag === 1; }).length === 1,
    '4.13 …and the cross-tower link survives it');
}

/* ================= 5 · copying the tower itself, per trade =============================== */
{
  const c = mkCfg(); M.setCfg(c);
  /* Give tower B something of its own under AR that must survive a ST-only copy. */
  c.zoning.AR.floors.filter(function (f) { return f.towerId === 'twB'; })[0].name = 'KEEP ME';
  const r = M.copyTower('twA', 'twB', { groups: ['ST'] });
  ok(r.floors === 3, '5.1  copyTower with one trade copies that trade’s floors only', r.floors);
  ok(M.floorsOfTower('AR', 'twB').length === 3, '5.2  the other trade still has its floors');
  ok(M.floorsOfTower('AR', 'twB')[0].name === 'KEEP ME',
    '5.3  …and they are the SAME floors, not replacements');
  ok(M.floorsOfTower('ST', 'twB').length === 3, '5.4  the copied trade has three floors');
}
{
  const c = mkCfg(); M.setCfg(c);
  c.links = chain(M, 'ST', 'twA');
  const nA = c.links.length;
  const r = M.copyTower('twA', 'twB', { groups: ['ST'], links: false });
  ok(r.links === 0, '5.5  links:false reports that it copied none', r);
  ok(c.links.length === nA, '5.6  …and cfg.links is exactly as long as it was', c.links.length);
  ok(M.twSeqCount('twB') === 0, '5.7  links:false copies the places and NOT the sequence', M.twSeqCount('twB'));
}
{
  const c = mkCfg(); M.setCfg(c);
  c.links = chain(M, 'ST', 'twA');
  const n = c.links.length;
  const r = M.copyTower('twA', 'twB');
  ok(r.floors === 6, '5.8  no options copies every trade, exactly as it always did', r.floors);
  ok(r.links === n, '5.9  …and brings the sequence with it', r);
}

/* ================= 6 · the tower filter on the building view ============================= */
{
  const c = mkCfg(); M.setCfg(c);
  M.setSeqTower('ALL');
  ok(M.seqFloors('ST').length === 6, '6.1  seqFloors shows both towers when the filter is off', M.seqFloors('ST').length);
  M.setSeqTower('twA');
  ok(M.seqFloors('ST').length === 3, '6.2  …and one tower when it is on', M.seqFloors('ST').length);
  ok(M.seqFloors('ST').every(function (f) { return f.towerId === 'twA'; }), '6.3  …the right one');
  M.setSeqTower('ALL');
}

/* ================= 7 · the contrast build ================================================ */
/* ⚠️⚠️ A TEST THAT CANNOT FAIL IS NOT EVIDENCE. The pinned base must NOT have any of this, and
   its `copyTower` must ignore a per-trade option — which is the defect, stated as an assertion. */
{
  let base = null;
  try { base = cp.execSync('git show ' + BASE_SHA + ':modules/project-schedule/index.html',
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }); }
  catch (e) { console.log('  (contrast build skipped — ' + BASE_SHA + ' not reachable)\n'); }

  if (base) {
    ['twShapeOf', 'twShapeDiff', 'copyTowerSeq', 'twSeqCount', 'seqFloors'].forEach(function (n) {
      ok(base.indexOf('function ' + n + '(') < 0, '7.x  base ' + BASE_SHA + ' has no ' + n);
    });
    ok(base.indexOf('var seqTower =') < 0, '7.6  base has no per-tower filter at all');
    /* The base's copyTower takes two arguments and copies EVERY trade. Executed, not read. */
    const B = build(base, { optional: ['twShapeOf', '_twSame', 'twShapeDiff', 'twSeqCount', 'copyTowerSeq', 'seqFloors',
      'blankTowerTypes', 'typeList', 'typeById', 'typeOfTower', 'towersOfType', 'repTowerOf', 'repTowerOfTower'] });
    const c = mkCfg(); B.setCfg(c);
    const r = B.copyTower('twA', 'twB', { groups: ['ST'] });
    ok(r.floors === 6, '7.7  base copyTower IGNORES a per-trade option and takes all six floors', r.floors);
  }
}

console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed');
if (fail) { fails.forEach(function (f) { console.log('   x ' + f); }); process.exit(1); }
