/* LOCATION SEQUENCE — slice-and-execute suite.
 *
 * Owner 2026-09-18, six items on this step: one name, one screen (no tower/zone tabs, no view
 * options, no zoom), a building view that draws every rung, a resulting schedule that is a real
 * grouped Gantt, an auto-trace that asks four numbers, and linking by dragging a bar's start or
 * finish point onto another bar's.
 *
 * ⚠️⚠️ WHAT MAKES THIS WORTH A SUITE. Three of the six change ARITHMETIC that is wrong-but-plausible
 *    when it breaks: a takt window off by one still draws a diagonal, a Gantt grouped in the wrong
 *    order still looks like a Gantt, and a drag that derives the wrong relationship type still
 *    draws an arrow. None of those is visible in a screenshot, so each is executed here against
 *    the SHIPPED functions.
 *
 * ⚠️ Everything under test is SLICED OUT OF index.html BY NAME and run (see test-slice.js).
 *    Only `cfg` (the document under edit) and the app plumbing a rule does not own (`markDirty`,
 *    `render`, `UI.toast`) are supplied.
 *
 * Usage:  node modules/project-schedule/test-locseq.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { makeSlicer } = require('./test-slice.js');
const scan = require('../../tools/scan.js');

const PAGE = path.join(__dirname, 'index.html');

/* ⚠️ PINNED TO A SHA, NEVER `HEAD` — `git show HEAD:` becomes self-comparison the moment this
   commits, and this repo has been caught by that. This is the merge that shipped the towers/quick
   setup pass, i.e. the last commit BEFORE any of the six items below. */
const BASE_SHA = '0bbf9d7';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label, got) {
  if (cond) pass++;
  else { fail++; fails.push(label + (got === undefined ? '' : '  [got: ' + JSON.stringify(got) + ']')); }
}

/* ------------------------------------------------------------------------------------------ */
/* Fixture: two towers, three floors each, two zones per floor, two units per zone, two trades. */
/* ⚠️ Deliberately >1 at EVERY rung, because a window of N is only testable against a list       */
/*    longer than N — a one-floor tower cannot tell "one at a time" from "all at once".          */
/* ------------------------------------------------------------------------------------------ */
let seq = 0;
function uidv() { return 'u' + (++seq); }

function mkTower(twId, nFloors, nZones, nUnits) {
  const out = [];
  for (let i = 0; i < nFloors; i++) {
    const zones = [];
    for (let z = 0; z < nZones; z++) {
      const units = [];
      for (let u = 0; u < nUnits; u++) units.push({ id: uidv(), code: 'U' + (u + 1) });
      zones.push({ id: uidv(), code: 'Z' + (z + 1), units: units });
    }
    out.push({ id: uidv(), code: 'F' + (i + 1), name: '', kind: 'typical', sub: false, towerId: twId, zones: zones });
  }
  return out;
}
function mkCfg(nFloors, nZones, nUnits, nTowers) {
  nFloors = nFloors == null ? 3 : nFloors;
  nZones = nZones == null ? 2 : nZones;
  nUnits = nUnits == null ? 2 : nUnits;
  nTowers = nTowers == null ? 2 : nTowers;
  const towers = [];
  for (let i = 0; i < nTowers; i++) towers.push({ id: 'tw' + i, code: 'T' + (i + 1), name: 'Tower ' + (i + 1) });
  function allFloors() { let f = []; towers.forEach(function (t) { f = f.concat(mkTower(t.id, nFloors, nZones, nUnits)); }); return f; }
  return {
    locLevel: 'auto', startDate: '2026-01-01',
    towers: towers, towerTypes: [], towerLinks: [],
    links: [], actLinks: [], activities: [{ id: 'a1', group: 'ST' }, { id: 'a2', group: 'AR' }],
    zoning: { GR: { floors: [] }, SW: { floors: [] }, ST: { floors: allFloors() }, AR: { floors: allFloors() },
              MEPF: { floors: [] }, SD: { floors: [] }, ALLIED: { floors: [] }, OT: { floors: [] } },
    towerSimul: {}, floorSimul: {}, zoneSimul: {}, unitSimul: {},
    floorLag: {}, floorGate: {}, zoneZigzag: {}, zoneOrder: {},
    tradeLeads: {}, tradeBatch: {}, tradeParallel: {}, tradeBatchKind: {}, tradeParallelKind: {},
    floorLead: 4, scopeOff: {}
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Sandbox out of the SHIPPED source.                                                           */
/* ------------------------------------------------------------------------------------------ */
const FNS = [
  'e2', 'locless', 'floorsOf', 'towerById', 'towerLabel', 'towerIdOf', 'towerList', 'blankTowers',
  'blankTowerTypes', 'typeList', 'typeById', 'typeOfTower', 'towersOfType', 'repTowerOf', 'repTowerOfTower',
  'floorsOfTower', 'multiTower', 'floorKind', 'leavesOfFloor', 'locList', 'locLabel', 'floorIndexOf',
  'locCellKey', 'tradeActs', 'usedGroups',
  'linkOf', 'reaches', 'tryLink', 'removeLink', 'START', 'END',
  'declaredBatchOf', 'declaredBatch', 'batchKind', 'parallelKindOf', 'parallelKind',
  'zoneGroupsOfFloor', 'floorGateOf', 'floorLagOf', 'towerSimulOf', 'floorSimulOf',
  /* ⚠⚠ `tradeFlowOf` is a REAL DEPENDENCY of autoTrace since 2026-09-18 (the declared cross-trade
     hand-off), not a convenience: the cross-trade pass resolves each follower's predecessor
     through it. A suite that does not slice it fails at run time instead of proving anything. */
  'tradeFlowOf', 'autoTrace',
  /* items 3 and 4 — the building view's rungs, and the grouped Gantt's own model. */
  'towerNodesFor', '_gRanks', '_gPath', '_gLeafLabel', 'schedRows', 'schedVisible'
];
const VARS = ['GROUPS', 'GLABEL', 'LOCLESS', 'KIND_ORDER', 'KIND_LABEL'];
/* ⚠️ `_gFold` and `_PT_TYPE` are object literals on one line, so `sliceVarLine` reads them
   whole. `_gFold` is MUTABLE state the fold test writes into, which is why it is linked rather
   than re-declared here — a local copy would prove the copy folds, not the shipped chart. */

function build(src) {
  const S = makeSlicer(src);
  const bodies = [];
  FNS.forEach(function (n) { bodies.push(S.sliceFn(n)); });
  VARS.forEach(function (n) { bodies.push(S.sliceVarLine(n)); });
  /* ⚠️ Only `cfg` and the plumbing a RULE does not own are supplied. `markDirty`/`render` are the
     app saying something changed and repainting; neither is part of any arithmetic here. */
  const pre = 'var cfg = null, seqTower = "ALL";\n' +
    'var _toasts = [];\n' +
    'var UI = { toast: function (m, k) { _toasts.push([k || "", m]); } };\n' +
    'var _dirty = 0; function markDirty() { _dirty++; } function render() {}\n' +
    uidv.toString() + '\nvar seq = 0;\n';
  bodies.push(S.sliceVarLine('_gFold'));
  bodies.push(S.sliceVarLine('_PT_TYPE'));
  const post = '\nreturn { ' + FNS.map(function (n) { return n + ': ' + n; }).join(', ') +
    ', _gFold: _gFold, _PT_TYPE: _PT_TYPE' +
    ', setCfg: function (c) { cfg = c; }, getCfg: function () { return cfg; }, toasts: function () { return _toasts; } };';
  return new Function(pre + bodies.join('\n') + post)();
}

const SRC = fs.readFileSync(PAGE, 'utf8');
let M;
try { M = build(SRC); }
catch (e) { console.error('BUILD FAILED — cannot run: ' + e.message); process.exit(1); }

/* ------------------------------------------------------------------------------------------ */
/* [1] AUTO-TRACE: the four rungs, and the two that never existed.                             */
/* ------------------------------------------------------------------------------------------ */
function trace(mut) {
  const c = mkCfg();
  if (mut) mut(c);
  M.setCfg(c);
  M.autoTrace();
  return c;
}
function u2l(c) { M.setCfg(c); const m = {}; M.locList().forEach(function (l) { m[l.uid] = l; }); return m; }
/* A link between two leaves, expressed in human terms: "ST T1 F1 Z1 U1 → ST T1 F2 Z1 U1". */
function edges(c) {
  const m = u2l(c);
  return c.links.filter(function (k) { return m[k.from] && m[k.to]; }).map(function (k) {
    function nm(l) { return l.trade + ' ' + (M.towerById(l.towerId) || {}).code + ' ' + l.floor.code + ' ' + (l.zone ? l.zone.code : '-') + ' ' + (l.unit ? l.unit.code : '-'); }
    return nm(m[k.from]) + ' -> ' + nm(m[k.to]);
  });
}
function hasEdge(c, a, b) { return edges(c).indexOf(a + ' -> ' + b) >= 0; }

/* 1.1 floorSimul — the default IS the old unconditional chain, and it is one floor at a time. */
(function () {
  const c = trace(null);
  ok(M.floorSimulOf('ST') === 1, '1.1 an unanswered floorSimul is 1 — one floor at a time, the pre-2026-09-18 chain', M.floorSimulOf('ST'));
  ok(hasEdge(c, 'ST T1 F1 Z1 U1', 'ST T1 F2 Z1 U1'), '1.2 F1 drives F2 in the same column');
  ok(hasEdge(c, 'ST T1 F2 Z1 U1', 'ST T1 F3 Z1 U1'), '1.3 F2 drives F3');
  ok(!hasEdge(c, 'ST T1 F1 Z1 U1', 'ST T1 F3 Z1 U1'), '1.4 and F1 does NOT reach F3 directly at a window of 1');
})();

/* 1.5 floorSimul = 2 — two floors live at once, so F3 waits on F1 and nothing waits on F2. */
(function () {
  const c = trace(function (c) { c.floorSimul.ST = 2; c.floorSimul.AR = 2; });
  ok(hasEdge(c, 'ST T1 F1 Z1 U1', 'ST T1 F3 Z1 U1'), '1.5 at 2-at-once F3 waits on F1, not on F2');
  ok(!hasEdge(c, 'ST T1 F1 Z1 U1', 'ST T1 F2 Z1 U1'), '1.6 …and F2 is no longer gated by F1');
  ok(!hasEdge(c, 'ST T1 F2 Z1 U1', 'ST T1 F3 Z1 U1'), '1.7 …nor F3 by F2');
})();

/* 1.8 floorSimul >= the floor count — the ladder is unlinked and every floor starts together. */
(function () {
  const c = trace(function (c) { c.floorSimul.ST = 3; c.floorSimul.AR = 3; });
  const vert = edges(c).filter(function (e) { const p = e.split(' -> '); return p[0].slice(0, 5) === p[1].slice(0, 5) && p[0].split(' ')[2] !== p[1].split(' ')[2]; });
  ok(vert.length === 0, '1.8 at 3-of-3 no floor of a tower waits on another', vert.slice(0, 3));
})();

/* 1.9 towerSimul — unanswered means every tower at once, which is what it has always been. */
(function () {
  const c = trace(null);
  ok(M.towerSimulOf('ST') === 0, '1.9 an unanswered towerSimul is 0 = all towers at once');
  const cross = edges(c).filter(function (e) { const p = e.split(' '); return p[1] !== e.split(' -> ')[1].split(' ')[1]; });
  ok(cross.length === 0, '1.10 and no link crosses a tower', cross.slice(0, 3));
})();

/* 1.11 towerSimul = 1 — tower 2 waits on tower 1, ONE arrow, last leaf → first leaf. */
(function () {
  const c = trace(function (c) { c.towerSimul.ST = 1; c.towerSimul.AR = 1; });
  const cross = edges(c).filter(function (e) {
    const a = e.split(' -> ')[0].split(' '), b = e.split(' -> ')[1].split(' ');
    return a[0] === b[0] && a[1] !== b[1];
  });
  ok(cross.length === 2, '1.11 one crossing arrow per trade (2 trades = 2)', cross);
  ok(cross.indexOf('ST T1 F3 Z2 U2 -> ST T2 F1 Z1 U1') >= 0,
     '1.12 …and it joins T1’s LAST leaf to T2’s FIRST, in worked order', cross);
})();

/* 1.13 towerSimul = 2 on a 2-tower project is the same statement as "all of them": no link. */
(function () {
  const c = trace(function (c) { c.towerSimul.ST = 2; c.towerSimul.AR = 2; });
  const cross = edges(c).filter(function (e) {
    const a = e.split(' -> ')[0].split(' '), b = e.split(' -> ')[1].split(' ');
    return a[0] === b[0] && a[1] !== b[1];
  });
  ok(cross.length === 0, '1.13 a window as wide as the tower list draws nothing', cross);
})();

/* 1.14 the three-tower case, so the window is testable rather than degenerate. */
(function () {
  const c = mkCfg(2, 1, 1, 3); c.towerSimul.ST = 1; c.towerSimul.AR = 1;
  M.setCfg(c); M.autoTrace();
  const cross = edges(c).filter(function (e) {
    const a = e.split(' -> ')[0].split(' '), b = e.split(' -> ')[1].split(' ');
    return a[0] === b[0] && a[1] !== b[1];
  }).filter(function (e) { return e.slice(0, 2) === 'ST'; });
  ok(cross.length === 2, '1.14 three towers at 1-at-once chain T1→T2→T3 (2 arrows)', cross);
  const c2 = mkCfg(2, 1, 1, 3); c2.towerSimul.ST = 2; c2.towerSimul.AR = 2;
  M.setCfg(c2); M.autoTrace();
  const cross2 = edges(c2).filter(function (e) {
    const a = e.split(' -> ')[0].split(' '), b = e.split(' -> ')[1].split(' ');
    return a[0] === b[0] && a[1] !== b[1];
  }).filter(function (e) { return e.slice(0, 2) === 'ST'; });
  ok(cross2.length === 1 && cross2[0].indexOf('T1') === 3 && cross2[0].indexOf('T3') > 0,
     '1.15 …at 2-at-once only T3 waits, and it waits on T1', cross2);
})();

/* 1.16 the two rungs that already existed are untouched by the two that did not. */
(function () {
  const c = trace(function (c) { c.zoneSimul.ST = 1; c.unitSimul.ST = 1; });
  ok(hasEdge(c, 'ST T1 F1 Z1 U2', 'ST T1 F1 Z2 U1'), '1.16 zoneSimul 1 still chains Z1 → Z2 within a floor');
  ok(hasEdge(c, 'ST T1 F1 Z1 U1', 'ST T1 F1 Z1 U2'), '1.17 unitSimul 1 still chains U1 → U2 within a zone');
})();

/* 1.18 the retired questions still apply from cfg — the dialog stopped asking, autoTrace kept reading. */
(function () {
  const c = trace(function (c) { c.floorGate.ST = 'floor'; c.floorLag.ST = 7; });
  ok(M.floorGateOf('ST') === 'floor', '1.18 a floorGate answered before today is still honoured');
  const lagged = c.links.filter(function (k) { return k.lag === 7; });
  ok(lagged.length > 0, '1.19 …and so is a floorLag', lagged.length);
  ok(M.floorGateOf('AR') === 'cell', '1.20 an unanswered floorGate defaults to cell, as it always did');
  ok(M.floorLagOf('AR') === 0, '1.21 an unanswered floorLag defaults to 0');
})();

/* ------------------------------------------------------------------------------------------ */
/* [3] THE BUILDING VIEW draws every rung the floor actually has.                               */
/* ⚠️⚠️ THE BUG WAS NOT A MISSING RUNG, IT WAS A COLLAPSE LEVEL. `seqLevel` drew exactly one rung  */
/*    and defaulted to 2, so a project with units showed its zones and never its units — owner:  */
/*    *"the building view skips some levels."* So the assertions here are about "as applicable"   */
/*    being read PER FLOOR, which is the property that replaces the setting.                     */
/* ------------------------------------------------------------------------------------------ */
(function () {
  const c = mkCfg(); M.setCfg(c);
  const f = c.zoning.ST.floors[0];
  const nodes = M.towerNodesFor('ST', f);
  ok(nodes.length === 2, '3.1 a 2-zone floor makes two zone nodes', nodes.length);
  ok(nodes[0].units.length === 2, '3.2 …and each carries its two units', nodes[0].units.length);
  /* ⚠️ Every read below is GUARDED. A build that stops emitting the unit rung must FAIL these
     assertions, not throw — a suite that dies mid-run reports nothing about the other 90. */
  const u0 = nodes[0].units[0] || { label: null, uids: [] };
  ok(nodes[0].label === 'Z1' && u0.label === 'U1', '3.3 labelled by their own codes',
     [nodes[0].label, u0.label]);
  /* ⚠️ A zone node carries its WHOLE subtree, a unit node exactly one uid — clicking a zone
     focuses everything under it and clicking a unit focuses just that unit. */
  ok(nodes[0].uids.length === 2, '3.4 a zone node carries every uid beneath it', nodes[0].uids.length);
  ok(u0.uids.length === 1, '3.5 …and a unit node carries exactly one', u0.uids.length);
  ok(u0.uids[0] === nodes[0].uids[0], '3.6 …which is one of its zone’s own');
})();

/* 3.7 a zone with NO units is the leaf itself — no second rung stating the same fact twice.
   ⚠️ "No units" is `units: []`, which is what `leavesOfFloor` tests — NOT one unit. A fixture with
   one unit builds a real unit object and is a different case, and asserting on it would have made
   this pass for the wrong reason. */
(function () {
  const c = mkCfg(2, 2, 1);
  c.zoning.ST.floors.forEach(function (f) { f.zones.forEach(function (z) { z.units = []; }); });
  M.setCfg(c);
  const nodes = M.towerNodesFor('ST', c.zoning.ST.floors[0]);
  ok(nodes.length === 2, '3.7 two zones', nodes.length);
  ok(nodes.every(function (n) { return n.units.length === 0; }),
     '3.8 a zone whose only unit is itself grows no unit row', nodes.map(function (n) { return n.units.length; }));
})();

/* 3.9 a floor with NO zone split is ONE node named for the floor — not an invented "Z". */
(function () {
  const c = mkCfg(2, 1, 1); M.setCfg(c);
  const f = c.zoning.ST.floors[0];
  const nodes = M.towerNodesFor('ST', f);
  ok(nodes.length === 1, '3.9 one node for a floor with one zone and one unit', nodes.length);
  ok(nodes[0].label === 'Z1', '3.10 …labelled from the zone that does exist', nodes[0].label);
  const c2 = mkCfg(2, 1, 1); c2.zoning.ST.floors.forEach(function (ff) { ff.zones = []; });
  M.setCfg(c2);
  const n2 = M.towerNodesFor('ST', c2.zoning.ST.floors[0]);
  ok(n2.length === 0 || (n2.length === 1 && !n2[0].zoned),
     '3.11 …and a floor with no zones at all is the floor, never a phantom zone', n2.map(function (n) { return n.label; }));
})();

/* ------------------------------------------------------------------------------------------ */
/* [4] THE RESULTING SCHEDULE IS A REAL GANTT — units under zones, zones under floors, floors   */
/*     under towers. Owner 2026-09-18.                                                          */
/* ------------------------------------------------------------------------------------------ */
function rowsFor(c, multi) {
  M.setCfg(c);
  const locs = M.locList();
  const starts = {}; locs.forEach(function (l, i) { starts[l.uid] = i; });
  return { rows: M.schedRows(locs, starts, multi == null ? M.multiTower() : multi), locs: locs };
}
(function () {
  const c = mkCfg(); const R = rowsFor(c);
  const groups = R.rows.filter(function (r) { return r.kind === 'group'; });
  const leaves = R.rows.filter(function (r) { return r.kind === 'leaf'; });
  ok(leaves.length === R.locs.length, '4.1 every location is a leaf row', [leaves.length, R.locs.length]);
  /* ⚠️⚠️ THE NESTING IS THE POINT: a leaf’s depth equals the number of groups above it, and the
     kinds run tower → floor → zone in that order. A Gantt grouped in the wrong order still looks
     like a Gantt, which is why this is asserted rather than eyeballed. */
  const kinds = [];
  const stack = [];
  R.rows.forEach(function (r) {
    stack.length = r.depth;
    if (r.kind === 'group') { stack.push(r.gkind); if (kinds.indexOf(stack.join('>')) < 0) kinds.push(stack.join('>')); }
  });
  ok(kinds.indexOf('tower') === 0, '4.2 the outermost rung is the tower', kinds);
  ok(kinds.indexOf('tower>floor') >= 0, '4.3 floors sit under towers', kinds);
  ok(kinds.indexOf('tower>floor>zone') >= 0, '4.4 and zones under floors', kinds);
  ok(groups.every(function (g) { return g.n === g.uids.length && g.n > 0; }),
     '4.5 every group counts exactly what it holds');
  /* ⚠️ A summary row SPANS its descendants — that is what makes it a summary rather than a bar. */
  ok(groups.every(function (g) {
    const mine = R.rows.filter(function (r) { return r.kind === 'leaf' && g.uids.indexOf(r.key) >= 0; });
    return g.s === Math.min.apply(null, mine.map(function (m) { return m.s; })) &&
           g.sMax === Math.max.apply(null, mine.map(function (m) { return m.sMax; }));
  }), '4.6 a group’s span is the min/max of its own leaves');
})();

/* 4.7 ONE TOWER DRAWS NO TOWER RUNG — a heading above a single child invents a hierarchy. */
(function () {
  const c = mkCfg(3, 2, 2, 1); const R = rowsFor(c);
  const tw = R.rows.filter(function (r) { return r.kind === 'group' && r.gkind === 'tower'; });
  ok(tw.length === 0, '4.7 a single-tower project draws no tower rung', tw.length);
  ok(R.rows.filter(function (r) { return r.kind === 'group' && r.gkind === 'floor'; }).length === 3,
     '4.8 …and the floors are then the outermost rung');
})();

/* 4.9 A RUNG IS NEVER BOTH THE HEADING AND THE LEAF. `F1 › F1` states one fact twice, and the
   first cut of `_gPath` did exactly that. */
(function () {
  const c = mkCfg(2, 1, 1, 1);
  c.zoning.ST.floors.forEach(function (f) { f.zones = []; });   // no zone split at all
  M.setCfg(c);
  const l = M.locList().filter(function (x) { return x.trade === 'ST'; })[0];
  ok(!l.zone && !l.unit, '4.9a the fixture really is a floor-level leaf', [!!l.zone, !!l.unit]);
  const p = M._gPath(l, false);
  ok(p.length === 0, '4.9 a floor with no zone and no unit is the leaf, with no group above it', p.map(function (x) { return x.kind; }));
  const c2 = mkCfg(2, 2, 1, 1);
  c2.zoning.ST.floors.forEach(function (f) { f.zones.forEach(function (z) { z.units = []; }); });
  M.setCfg(c2);
  const l2 = M.locList().filter(function (x) { return x.trade === 'ST'; })[0];
  ok(!!l2.zone && !l2.unit, '4.10a the fixture really is a zone-level leaf', [!!l2.zone, !!l2.unit]);
  const p2 = M._gPath(l2, false);
  ok(p2.length === 1 && p2[0].kind === 'floor',
     '4.10 a zone with no units is the leaf under its floor — no zone rung as well', p2.map(function (x) { return x.kind; }));
})();

/* 4.11 THE ORDER OF A RUNG IS THE MAX INDEX ACROSS TRADES, never first-seen. A trade that works
   only the middle floor would otherwise give it ordinal 0 and push the floor below it down. */
(function () {
  /* ⚠⚠ THE SPARSE TRADE HAS TO COME FIRST IN `GROUPS`, or this proves nothing. `_gRanks` walks
     GROUPS in order, so a sparse trade LATER in that list is already overwritten by a complete one
     and first-seen would give the right answer by luck — the first cut of this assertion did
     exactly that and passed against a deliberately broken build. Site Works precedes Structural. */
  const c = mkCfg(3, 1, 1, 1);
  c.zoning.SW.floors = [c.zoning.ST.floors[1]];   // SW works F2 only, and SW sorts before ST
  M.setCfg(c);
  const R = M._gRanks();
  const keys = Object.keys(R.fl).sort(function (a, b) { return R.fl[a] - R.fl[b]; });
  ok(keys.length === 3 && /F1$/.test(keys[0]) && /F2$/.test(keys[1]) && /F3$/.test(keys[2]),
     '4.11 F1 < F2 < F3 even though the FIRST trade sees only F2', keys.map(function (k) { return k + '=' + R.fl[k]; }));
  /* ⚠️ And the rows really come out in that order — the rank tuple is what `schedRows` sorts on,
     so a rank table that is right and a sort that is not would still draw the wrong building. */
  const locs = M.locList(), starts = {};
  locs.forEach(function (l, i) { starts[l.uid] = i; });
  const fl = M.schedRows(locs, starts, false).filter(function (r) { return r.kind === 'group' && r.gkind === 'floor'; });
  ok(fl.map(function (r) { return r.label; }).join(',') === 'F1,F2,F3',
     '4.11b …and the Gantt draws them bottom-up', fl.map(function (r) { return r.label; }));
})();

/* 4.12 FOLDING a group hides everything beneath it, however deep. */
(function () {
  const c = mkCfg(); const R = rowsFor(c);
  Object.keys(M._gFold).forEach(function (k) { delete M._gFold[k]; });
  ok(M.schedVisible(R.rows).length === R.rows.length, '4.12 nothing folded shows every row');
  const floorRow = R.rows.filter(function (r) { return r.kind === 'group' && r.gkind === 'floor'; })[0];
  M._gFold[floorRow.key] = 1;
  const vis = M.schedVisible(R.rows);
  ok(vis.indexOf(floorRow) >= 0, '4.13 the folded group itself stays on screen');
  const hidden = R.rows.filter(function (r) { return vis.indexOf(r) < 0; });
  /* ⚠️ Its ZONE rungs go too, not only its leaves — a fold two rungs up must close everything. */
  ok(hidden.length > 0 && hidden.every(function (r) { return r.depth > floorRow.depth; }),
     '4.14 …and everything deeper than it is hidden', hidden.length);
  ok(hidden.some(function (r) { return r.kind === 'group' && r.gkind === 'zone'; }),
     '4.15 …including the zone rungs, not just the leaves');
  delete M._gFold[floorRow.key];
  ok(M.schedVisible(R.rows).length === R.rows.length, '4.16 unfolding restores every row');
})();

/* ------------------------------------------------------------------------------------------ */
/* [6] THE DRAG DERIVES THE RELATIONSHIP FROM THE PAIR OF ENDS — nothing is chosen, nothing is  */
/*     confirmed. Owner 2026-09-18: *"each gantt bar chart should have a start point and finish  */
/*     point. clicking on the part will start the arrow link and dropping it will end the arrow  */
/*     link to the point."*                                                                      */
/* ------------------------------------------------------------------------------------------ */
(function () {
  ok(M._PT_TYPE.fs === 'FS', '6.1 finish → start is FS');
  ok(M._PT_TYPE.ss === 'SS', '6.2 start → start is SS');
  ok(M._PT_TYPE.ff === 'FF', '6.3 finish → finish is FF');
  ok(M._PT_TYPE.sf === 'SF', '6.4 start → finish is SF');
  ok(Object.keys(M._PT_TYPE).length === 4, '6.5 …and there is no fifth answer', Object.keys(M._PT_TYPE));
  /* ⚠️⚠️ ONE EMITTER AND ONE BINDER, read by the Location Sequence's schedule AND by BOTH of the
     Activity Sequence's charts. A second copy is how the two steps would start deriving a different
     relationship from the same gesture — which is the bug this file's own note warns about. */
  const ptDefs = (SRC.match(/function _ptsHTML\(/g) || []).length;
  const dragDefs = (SRC.match(/function bindLinkDrag\(/g) || []).length;
  ok(ptDefs === 1, '6.6 _ptsHTML is defined exactly once', ptDefs);
  ok(dragDefs === 1, '6.7 bindLinkDrag is defined exactly once', dragDefs);
  const binds = (SRC.match(/bindLinkDrag\(host\.querySelector/g) || []).length;
  ok(binds === 2, '6.8 …and both sequencing steps bind it', binds);
  const typeDefs = (SRC.match(/var _PT_TYPE = /g) || []).length;
  ok(typeDefs === 1, '6.9 the pair→relationship table is defined once', typeDefs);
  /* ⚠️ Three charts emit the two points, so the gesture exists wherever a bar does: the Location
     Sequence's schedule and the Activity Sequence's flow and Gantt. */
  const emits = (SRC.match(/_ptsHTML\(/g) || []).length;
  ok(emits === 4, '6.10 three charts emit the points (plus the one definition)', emits);
})();

/* ------------------------------------------------------------------------------------------ */
/* [2] ONE SCREEN — no tower/zone tabs, no view options, no zoom.                               */
/* ⚠️ Source assertions, deliberately: what changed is which controls are EMITTED, and executing  */
/*    a renderer against a fake DOM would prove the fake rather than the step.                   */
/* ------------------------------------------------------------------------------------------ */
(function () {
  const S2 = makeSlicer(SRC);
  const st = S2.sliceFn('stLocSeq');
  ok(SRC.indexOf('function stTowerLinks(') < 0, '2.1 the Tower Sequence renderer is deleted, not parked');
  ok(SRC.indexOf("'Location Sequence': [") < 0, '2.2 …and the step has no tab strip left to render it');
  ok(/openTowerLinkDlg/.test(st), '2.3 the tower relationships moved into a dialog off the one page');
  ok(!/data-seqlayout/.test(st), '2.4 no Split/Stacked layout buttons');
  ok(!/sbld-viewopts/.test(st), '2.5 no View-options fold');
  ok(!/b-zout|b-zin|seqZoom/.test(st), '2.6 and no zoom — owner: *"zoom not needed"*');
  /* ⚠️⚠️ THE LAYOUT IS A WRAP, NOT A BREAKPOINT. Owner: *"layout should depend on window width."*
     A media query picks one number for every project; a wrapping flex row lets each pane state the
     width below which it stops being readable. The `min-width` is load-bearing — a flex item's
     default `min-width` is `auto`, which resolves to min-content and OVERFLOWS instead of wrapping,
     a trap this repo has paid for five times. */
  ok(/sbld-seq2-wrap/.test(st), '2.7 the row is the wrapping variant');
  ok(/\.sbld-seq2-wrap \{[^}]*flex-wrap:wrap/.test(SRC), '2.8 …which wraps');
  ok(/\.sbld-seq2-wrap > \.sbld-seq2-left \{[^}]*min-width:/.test(SRC) &&
     /\.sbld-seq2-wrap > \.sbld-seq2-right \{[^}]*min-width:/.test(SRC),
     '2.9 …and both panes state a real min-width, so they wrap rather than overflow');
  ok(SRC.indexOf('.sbld-flow {') < 0 && SRC.indexOf('.sbld-modeseg {') < 0,
     '2.10 the retired flow panel’s CSS is deleted too — a rule that cannot match reads as working styling');
})();

/* ------------------------------------------------------------------------------------------ */
/* [9] CONTRAST — the pinned base must NOT have any of this.                                   */
/* ------------------------------------------------------------------------------------------ */
(function () {
  let base;
  try { base = cp.execSync('git show ' + BASE_SHA + ':modules/project-schedule/index.html', { cwd: path.join(__dirname, '..', '..'), maxBuffer: 1 << 28 }).toString(); }
  catch (e) { ok(false, '9.0 the pinned base ' + BASE_SHA + ' could not be read: ' + e.message); return; }
  ok(base.indexOf('function towerSimulOf(') < 0, '9.1 the base has no towerSimulOf — the tower rung is new');
  ok(base.indexOf('function floorSimulOf(') < 0, '9.2 the base has no floorSimulOf — the floor rung is new');
  ok(base.indexOf('function locCellKey(') < 0, '9.3 the base still calls it cellKey, twice');
  ok(base.indexOf("data-atkind=\"zig\"") >= 0, '9.4 the base still asks the zig-zag question');
  ok(base.indexOf("data-atkind=\"gate\"") >= 0, '9.5 the base still asks the floor-gate question');
  ok(SRC.indexOf("data-atkind=\"zig\"") < 0, '9.6 and this build does not');
  ok(SRC.indexOf("data-atkind=\"gate\"") < 0, '9.7 nor the gate fork');
  ok(SRC.indexOf("data-atkind=\"bkind\"") < 0, '9.8 nor the per-category handoff');
  /* item 1 — the name. ⚠️ BOTH DIRECTIONS: the new title is the STEP, and the retired ones still
     RESOLVE. `_stepNo` answers '' for a title it cannot find, and a blank where a step number belongs
     reads as a broken app — this module has shipped that once. */
  ok(/\{ t: 'Location Sequence', s: '[^']*', fn: stLocSeq \}/.test(SRC), '9.9 the step is titled Location Sequence');
  ok(base.indexOf("{ t: 'Location Sequence'") < 0 || base.indexOf("stTowerLinks") >= 0,
     '9.10 the base still had the Tower Sequence renderer');
  ["'Tower Sequence': 'Location Sequence'", "'Tower links': 'Location Sequence'",
   "'Zone sequence': 'Location Sequence'", "'Repetition': 'Location Sequence'"].forEach(function (a, i) {
    ok(SRC.indexOf(a) >= 0, '9.1' + (1 + i) + ' the alias ' + a.split(':')[0] + ' still resolves');
  });
  /* item 2 — the contrast. The base had the two-tab strip and the renderer this build deletes. */
  ok(base.indexOf('function stTowerLinks(') >= 0, '9.15 the base HAS the Tower Sequence renderer, so 2.1 bites');
  ok(base.indexOf("'Location Sequence': [") >= 0, '9.16 …and the tab strip, so 2.2 bites');
  /* items 4 and 6 — the model and the gesture are both new. */
  ok(base.indexOf('function schedRows(') < 0, '9.17 the base has no grouped-Gantt model');
  ok(base.indexOf('function schedKeyOf(') >= 0, '9.18 …it had the flat one-row-per-floor key instead');
  ok(base.indexOf('function bindLinkDrag(') < 0, '9.19 the base has no drag binder — the gesture is new');
  ok(base.indexOf('var _PT_TYPE') < 0, '9.20 nor the pair→relationship table');
  ok(base.indexOf('sbld-seq2-wrap') < 0, '9.21 nor the wrapping row');
  /* item 3 — the collapse level that WAS the "skips some levels" report. */
  ok(base.indexOf('seqLevel') >= 0, '9.22 the base drew one rung at a time, chosen by seqLevel');
  /* ⚠️ COMMENTS STRIPPED FIRST. The ONLY surviving mention of `seqLevel` is the note recording
     that it was removed, and a checker that reads its own explanation and reports it as a finding is
     a trap this repo has fallen into four times. */
  ok(scan.blankComments(SRC).indexOf('seqLevel') < 0, '9.23 …and this build has no such setting');
})();

console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' assertions passed, ' + fail + ' failed');
fails.forEach(function (f) { console.log('  x ' + f); });
process.exit(fail ? 1 : 0);
