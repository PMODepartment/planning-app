/* THE FLOOR-PLAN LOOKUP, KEYED BY TOWER AS WELL AS BY TRADE — executed, not read.
 *
 *   node modules/project-schedule/test-zoneplan.js
 *
 * Owner 2026-09-16, with the site view in Whole towers and Floor by floor side by side:
 * *"look at the positioning and configuration of the towers. something happened when choosing
 * floor by floor."*
 *
 * ⚠️⚠️ EVERY FUNCTION UNDER TEST IS SLICED OUT OF THE SHIPPED index.html BY NAME AND RUN. Nothing
 *    here re-implements the key rule: a suite that re-implements the thing it tests proves the
 *    re-implementation, and this repo has been caught by that four times.
 * ⚠️ BY NAME, NEVER BY LINE NUMBER — this file is ~50,000 lines and under concurrent edit.
 * ⚠️ AND IT IS GATED against a pinned base SHA, executed on the same fixtures and required to
 *    reproduce the collapse. A suite that passes on both files proves nothing, and `HEAD` is not
 *    a base — it stops being the pre-change state the moment this work commits.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const BASE_SHA = '8c0fd9fb';                 // the commit before the tower key existed
const PAGE = path.join(__dirname, 'index.html');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) { if (cond) pass++; else { fail++; fails.push(label); } }
function eq(got, want, label) {
  ok(got === want, label + '  (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}

/* ---------------------------------------------------------------- the slicer */
/* ⚠️ SHARED with the other executed suites — see test-slice.js. It used to live here; a second
   copy is how two suites start disagreeing about what "the shipped function" means. */
const { makeSlicer } = require('./test-slice.js');

/* ---- the builder half: the map, built from a config -------------------------------------- */
function buildMapper(src) {
  const S = makeSlicer(src);
  const parts = [
    'var ZP_W = 1000, ZP_HDEF = 620, ZP_MAXPTS = 60;',
    "var ZP_NOLEV_ID = 'nolev', ZP_NOLEV_KEY = '*nolevel*';",
    'var KIND_LABEL = { basement: 1, podium: 1, typical: 1, roof: 1 };',
    S.sliceVarLine('GLABEL'), S.sliceVarLine('GWORK'),
    S.sliceVarLine('ZP_HUES'), S.sliceVarLine('ZP_EDGES')
  ];
  /* ⚠️ The UNTAGGED constants, linked from the module's OWN declaration and never stubbed — a
     stubbed colour would make this suite agree with itself rather than with the app.
     ⚠️ Guarded because the pinned contrast base predates them: it neither declares them nor
     reads them, so a hard slice would fail the base for the wrong reason. */
  ['ZP_UNTAG', 'ZP_UNTAG_COLOR'].forEach(function (n) {
    try { parts.push(S.sliceVarLine(n)); } catch (e) { /* base build: not declared */ }
  });
  ['floorKind', 'zpH', 'zpNewId', 'zpBlank', 'zpClamp', 'zpNormCode', 'zpNormFront', 'zpNormMark',
   'zpNormPoly', 'zpNorm', 'zpNormColors', 'zpNormAll', 'zpAutoHue', 'zpColorOfBag', 'zpShapeOfBag',
   'zpByLabelOf'].forEach(n => parts.push(S.sliceFn(n)));
  /* ⚠️ IT REFUSES TO STUB. A name this file does not define as a function is a link failure and
     not something to fill in: an auto-stub is how a suite goes green against a broken build. */
  return new Function(parts.join(String.fromCharCode(10)) + ';return zpByLabelOf;')();
}

/* ---- the stacking half: the lookup, against a map ----------------------------------------- */
function buildLookup(src, map) {
  const S = makeSlicer(src);
  const parts = [
    "var VS_NOLEV = '— No level —';",
    "var _VS_ZP_NOLEV = '*nolevel*';",
    'function _vsZpAll() { return _MAP; }',
    S.sliceFn('_vsZpNorm')
  ];
  let hasTowersOf = true;
  try { parts.push(S.sliceFn('_vsZpTowersOf')); } catch (e) { hasTowersOf = false; }
  parts.push(S.sliceFn('_vsZpFor'));
  parts.push(S.sliceFn('_vsZpLabels'));
  return new Function('_MAP', parts.join(String.fromCharCode(10)) +
    ';return { forFn: _vsZpFor, labels: _vsZpLabels, hasTowersOf: ' + hasTowersOf + ' };')(map);
}

/* ---- fixtures ----------------------------------------------------------------------------- */
function rect(code, x0, y0, x1, y1) {
  return { id: 'q' + code + x0 + y0, code: code, pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] };
}
function bbox(shape) {
  /* ⚠️ A NULL SHAPE RETURNS A ROW OF NULLS, never null: dereferencing .w on it would make the
     suite DIE with a TypeError and report nothing about every assertion after it. A suite must
     fail on a regression, not fall over on one — the same guard the manual suite needed. */
  if (!shape) return { w: null, d: null };
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  shape.polys.forEach(q => q.pts.forEach(p => {
    u0 = Math.min(u0, p[0]); u1 = Math.max(u1, p[0]); v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]);
  }));
  return { w: +(u1 - u0).toFixed(4), d: +(v1 - v0).toFixed(4) };
}
const TOWERS = [{ id: 't1', code: 'T1', name: 'Tower 1' }, { id: 't2', code: 'T2', name: 'Tower 2' }];
const PLATES = {
  // Tower 1's F1: a NARROW slab.   Tower 2's F1: a WIDE one, four times the area.
  pNarrow: { h: 620, polys: [rect('Z1', 100, 100, 300, 500)] },
  pWide:   { h: 620, polys: [rect('Z1', 100, 100, 900, 500)] },
  pMid:    { h: 620, polys: [rect('Z1', 100, 100, 600, 500)] }
};
function floor(id, towerId) { return { id: id, code: 'F1', name: 'F1', towerId: towerId, kind: 'typical', zones: [] }; }
function cfgBothTowers() {
  return { towers: TOWERS,
    zoning: { ST: { floors: [floor('f1a', 't1'), floor('f1b', 't2')] } },
    zonePlan: { plate: { pA: PLATES.pNarrow, pB: PLATES.pWide }, of: { f1a: 'pA', f1b: 'pB' } } };
}
function cfgOneTraced() {
  return { towers: TOWERS,
    zoning: { ST: { floors: [floor('f1a', 't1'), floor('f1b', 't2')] } },
    zonePlan: { plate: { pA: PLATES.pNarrow }, of: { f1a: 'pA' } } };
}
function cfgNoTowers() {
  return { zoning: { ST: { floors: [floor('f1a', null)] } },
    zonePlan: { plate: { pA: PLATES.pNarrow }, of: { f1a: 'pA' } } };
}
function cfgTwoTradesOneTower() {
  return { towers: [TOWERS[0]],
    zoning: { ST: { floors: [floor('sF1', 't1')] }, AR: { floors: [floor('aF1', 't1')] } },
    zonePlan: { plate: { pA: PLATES.pNarrow, pB: PLATES.pWide }, of: { sF1: 'pA', aF1: 'pB' } } };
}

/* ========================================================================================== */
const src = fs.readFileSync(PAGE, 'utf8');
const mapOf = buildMapper(src);

/* ---- 1 · the owner's case: two towers, one floor name, two drawings ----------------------- */
{
  const map = mapOf(cfgBothTowers());
  const L = buildLookup(src, map);
  ok(L.hasTowersOf, 'the tower index exists');

  /* ⚠️⚠️ THE ASSERTION THIS WHOLE CHANGE TURNS ON. The site view passes NO trade — a site holds
     every one — so before the tower key it could read only the bare floor key, and that is one
     answer for both buildings. */
  const t1 = bbox(L.forFn('F1', null, 'Tower 1'));
  const t2 = bbox(L.forFn('F1', null, 'Tower 2'));
  eq(t1.w, 0.2, 'site: Tower 1 is drawn from Tower 1 own F1');
  eq(t2.w, 0.8, 'site: Tower 2 is drawn from Tower 2 own F1');
  ok(t1.w !== t2.w, 'site: and the two towers are no longer the same building');

  eq(bbox(L.forFn('F1', 'Structural Works', 'Tower 1')).w, 0.2, 'trade+tower: Tower 1 Structural');
  eq(bbox(L.forFn('F1', 'Structural Works', 'Tower 2')).w, 0.8, 'trade+tower: Tower 2 Structural');
  eq(bbox(L.forFn('F1', 'Structural', 'Tower 2')).w, 0.8, 'trade+tower: the short trade spelling too');

  ok(!!L.forFn('F1', null, null), 'a card spanning towers still resolves (bare key)');
  eq(L.labels(map).join(','), 'f1', 'labels: the floor name, never the key');
}

/* ---- 2 · a tower with no plan of its own must not BORROW one ------------------------------ */
{
  const L = buildLookup(src, mapOf(cfgOneTraced()));
  eq(bbox(L.forFn('F1', null, 'Tower 1')).w, 0.2, 'partial: the traced tower draws its own plan');
  /* ⚠️⚠️ Falling through to the bare key here would keep the defect alive for exactly the project
     where only some towers are traced — which is most of them, most of the time. */
  eq(L.forFn('F1', null, 'Tower 2'), null, 'partial: the untraced tower gets NO plan, not a neighbour plan');
}

/* ---- 3 · the degrades: nothing may change for a project this does not apply to ------------ */
{
  const map = mapOf(cfgNoTowers());
  const L = buildLookup(src, map);
  eq(Object.keys(map).filter(k => k.charAt(0) === '@').length, 0, 'no towers named: no tower key at all');
  eq(bbox(L.forFn('F1', null, 'Tower 1')).w, 0.2, 'no towers named: the bare key still serves');
  eq(bbox(L.forFn('F1', null, null)).w, 0.2, 'no towers named: and so does a lookup with no tower');

  /* ⚠️⚠️ A TOWER THE SETUP NEVER NAMED — the drift towerReality reports — GETS NO PLAN,
     and my first expectation here was the wrong one. I wrote 0.8: fall through to the bare key so
     the card keeps a building. But the bare key on a multi-tower project IS another building’s
     outline, which is the whole defect; borrowing it for an unknown tower would reintroduce the
     bug silently in exactly the case nobody is watching. It draws the wrap guess instead, and the
     footer names the tower and says the plan belongs to another one. */
  const L2 = buildLookup(src, mapOf(cfgBothTowers()));
  eq(L2.forFn('F1', null, 'Tower 9'), null, 'a tower the setup never named borrows nobody else’s plan');
}

/* ---- 4 · largest-wins is kept WITHIN a tower, and never applied across towers -------------- */
{
  const L = buildLookup(src, mapOf(cfgTwoTradesOneTower()));
  const sh = L.forFn('F1', null, 'Tower 1');
  eq(bbox(sh).w, 0.8, 'one tower, two trades: the card that spans them takes the largest');
  eq(sh.sources, 2, 'and it SAYS the footprint came from several trades plans');
  eq(bbox(L.forFn('F1', 'Structural Works', 'Tower 1')).w, 0.2, 'while each trade keeps its own');
  eq(bbox(L.forFn('F1', 'Architectural Works', 'Tower 1')).w, 0.8, 'while each trade keeps its own (2)');

  const Lm = buildLookup(src, mapOf(cfgBothTowers()));
  ok(!Lm.forFn('F1', null, 'Tower 1').sources,
     'across towers it is never merged: one tower, one plan, no several-trades note');
}

/* ---- 5 · the un-levelled band is one plate for the config, not one per tower --------------- */
{
  const c = cfgBothTowers();
  c.zonePlan.plate.pN = PLATES.pMid;
  c.zonePlan.of.nolev = 'pN';
  const L = buildLookup(src, mapOf(c));
  eq(bbox(L.forFn('— No level —', null, 'Tower 1')).w, 0.5, 'the band resolves, whichever tower asks');
  eq(bbox(L.forFn('— No level —', null, 'Tower 2')).w, 0.5, 'the band resolves, whichever tower asks (2)');
}

/* ---- 6 · DRAW FIRST, TAG AFTER — an area that carries no code ------------------------------
   Owner 2026-09-17: *"allow users to define the shapes / trace zones first, before tagging which
   zones are those or if that zone is the whole floor etc."*

   ⚠️⚠️ THE WHOLE FEATURE RESTS ON ONE DELETED LINE — `zpNormPoly`'s `if (!code) return null;`.
   Every claim made in its place is asserted here against the SHIPPED functions: that an untagged
   area survives a save/load round trip, that it is invisible to the consumers keyed on a code,
   and that it cannot be mistaken on screen for Zone 1. The contrast in §7 runs the first of
   those against the pinned base, which must still drop it.
   ⚠️ Its own builder, because these are the sanitiser and the readers rather than the map: the
   map builder returns `zpByLabelOf` alone and stubbing a second return out of it would make the
   two halves of this file disagree about what was linked. */
function buildZones(source) {
  const S = makeSlicer(source);
  const parts = [
    'var ZP_W = 1000, ZP_HDEF = 620, ZP_MAXPTS = 60;',
    S.sliceVarLine('ZP_HUES'), S.sliceVarLine('ZP_EDGES'),
    S.sliceVarLine('ZP_ALL'), S.sliceVarLine('ZP_ALL_LABEL')
  ];
  /* ⚠️ Guarded exactly as in `buildMapper`: the pinned base declares none of these, and a hard
     slice would fail the contrast for the wrong reason — missing constants rather than the
     behaviour being contrasted. `has` is what the assertions below branch on. */
  let has = true;
  ['ZP_UNTAG', 'ZP_UNTAG_LABEL', 'ZP_UNTAG_COLOR'].forEach(function (n) {
    try { parts.push(S.sliceVarLine(n)); } catch (e) { has = false; }
  });
  const fns = ['zpH', 'zpClamp', 'zpNewId', 'zpBlank', 'zpNormCode', 'zpNormFront', 'zpNormMark',
    'zpNormPoly', 'zpNorm', 'zpNormHex', 'zpNormColors', 'zpNormAll', 'zpAutoHue', 'zpColorOfBag',
    'zpShapeOfBag', 'zpCodesOf', 'zpBox', 'zpIsAll', 'zpLabelOf'];
  fns.forEach(n => parts.push(S.sliceFn(n)));
  if (has) parts.push(S.sliceFn('zpIsUntagged'));
  const api = '{ has: ' + has + ', norm: zpNorm, normAll: zpNormAll, normPoly: zpNormPoly,' +
    ' codesOf: zpCodesOf, box: zpBox, colorOf: zpColorOfBag, shapeOf: zpShapeOfBag,' +
    ' autoHue: zpAutoHue, labelOf: zpLabelOf, isAll: zpIsAll,' +
    ' UNTAG: ' + (has ? 'ZP_UNTAG' : 'null') + ', COLOR: ' + (has ? 'ZP_UNTAG_COLOR' : 'null') + ' }';
  return new Function(parts.join(String.fromCharCode(10)) + ';return ' + api + ';')();
}

const Z = buildZones(src);
ok(Z.has, 'the untagged constants are declared in the shipped file');
{
  // one tagged area and one that nobody has said anything about yet
  const plate = { h: 620, polys: [rect('Z1', 100, 100, 400, 500),
                                  { id: 'qU', code: '', pts: [[500, 100], [900, 100], [900, 500], [500, 500]] }] };

  /* ---- it survives being saved and loaded ---- */
  eq(Z.norm(plate).polys.length, 2, 'an untagged area survives zpNorm — the deleted `if (!code)`');
  const bag = Z.normAll({ plate: { pA: plate }, of: { f1a: 'pA' } });
  eq(bag.plate.pA.polys.length, 2, 'and the whole-bag round trip keeps it too');
  eq(bag.plate.pA.polys[1].code, '', 'and keeps its code EMPTY rather than inventing one');
  ok(Z.normPoly({ code: '   ', pts: plate.polys[1].pts }, 620) !== null,
    'a code of nothing but spaces is untagged, not a poly to throw away');
  ok(Z.normPoly({ code: '', pts: [[0, 0], [10, 0]] }, 620) === null,
    'but a two-point ring is still dropped — untagged relaxes the CODE rule, not the geometry one');

  /* ---- what it is called ---- */
  eq(Z.labelOf(''), 'Untagged', 'zpLabelOf names it');
  eq(Z.labelOf('*floor*'), 'Whole floor', 'and still names the floor outline');
  eq(Z.labelOf('Z1'), 'Z1', 'and leaves a real zone alone');
  ok(!Z.isAll(''), 'untagged is NOT the whole-floor outline — the two states cannot collide');

  /* ---- what colour it is ---- */
  eq(Z.colorOf(bag, ''), Z.COLOR, 'it gets its own colour');
  /* ⚠️⚠️ THE CLAIM THE COMMENT MAKES: falling through to `zpAutoHue('')` would hash to the FIRST
     zone hue, so an untagged area would be painted exactly like Zone 1 — the one thing this
     state must never look like. */
  ok(Z.colorOf(bag, '') !== Z.autoHue(''), 'and NOT the hash of the empty string');
  ok(Z.colorOf(bag, '') !== Z.colorOf(bag, 'Z1'), 'and not Zone 1’s colour');
  const over = Z.normAll({ plate: { pA: plate }, of: { f1a: 'pA' }, color: { '': '#ff0000' } });
  eq(Z.colorOf(over, ''), Z.COLOR, 'an override on the empty key cannot repaint it — checked first');

  /* ---- and that every consumer keyed on a code simply does not see it ---- */
  const p = Z.norm(plate);
  eq(Z.codesOf(p).length, 1, 'zpCodesOf lists the tagged zone only');
  eq(Z.codesOf(p)[0], 'Z1', 'and it is the right one');
  ok(Z.box(p, '') === null, 'zpBox has no box for it');
  /* ⚠️ The untagged area spans x 500..900 and Z1 spans 100..400. If zpBox let an empty code match
     anything, Z1's box would stretch to 800 wide instead of 300. */
  eq(Z.box(p, 'Z1').w, 0.3, 'and an untagged area sitting beside a zone does not widen that zone');

  /* ---- what DOES carry it: the outline handed to the 3D view ---- */
  /* ⚠️ DELIBERATE, and asserted so it cannot be "fixed" by accident: an untagged area is part of
     the floor that was traced, so the stacking draws it — in the untagged grey, tagged as no
     zone. It is invisible to everything keyed on a CODE, not invisible on the drawing. */
  const sh = Z.shapeOf(bag, p);
  eq(sh.polys.length, 2, 'zpShapeOfBag carries the untagged area to the stacking view');
  eq(sh.polys[1].color, Z.COLOR, 'in the untagged colour, so it reads as unfinished there too');
}

/* ---- 7 · THE CONTRAST: the pinned base must reproduce the collapse ------------------------- */
{
  let base = null;
  try {
    base = cp.execSync('git show ' + BASE_SHA + ':modules/project-schedule/index.html',
      { cwd: path.join(__dirname, '..', '..'), maxBuffer: 268435456 }).toString('utf8');
  } catch (e) { base = null; }
  if (!base) {
    console.log('CONTRAST SKIPPED: could not read ' + BASE_SHA + ' - a green run here proves less.');
  } else {
    const bMap = buildMapper(base)(cfgBothTowers());
    const bL = buildLookup(base, bMap);
    ok(!bL.hasTowersOf, 'BASE: has no tower index');
    eq(Object.keys(bMap).filter(k => k.charAt(0) === '@').length, 0, 'BASE: emits no tower key');
    /* ⚠️⚠️ THE DEFECT, REPRODUCED: both towers are handed ONE shape — the largest F1 anywhere. */
    const b1 = bbox(bL.forFn('F1', null, 'Tower 1'));
    const b2 = bbox(bL.forFn('F1', null, 'Tower 2'));
    eq(b1.w, 0.8, 'BASE: Tower 1 is drawn from the OTHER tower F1 - the reported defect');
    ok(b1.w === b2.w, 'BASE: and both towers are the same building');
    const now = bbox(buildLookup(src, mapOf(cfgBothTowers())).forFn('F1', null, 'Tower 1'));
    ok(now.w !== b1.w, 'BASE vs now: the same fixture answers differently');

    /* ⚠️⚠️ AND THE CONTRAST FOR §6. The base must THROW THE UNTAGGED AREA AWAY — that is the
       behaviour the owner's ask exists to change, and a §6 that passed on both files would be
       asserting nothing about this change. */
    const bZ = buildZones(base);
    ok(!bZ.has, 'BASE: the untagged constants do not exist yet');
    const bPlate = { h: 620, polys: [rect('Z1', 100, 100, 400, 500),
                                     { id: 'qU', code: '', pts: [[500, 100], [900, 100], [900, 500], [500, 500]] }] };
    eq(bZ.norm(bPlate).polys.length, 1, 'BASE: the untagged area is DROPPED — draw-then-tag was impossible');
    eq(Z.norm(bPlate).polys.length, 2, 'BASE vs now: the same plate survives differently');
  }
}

console.log('');
console.log('zone-plan tower key: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log(''); fails.forEach(f => console.log('  ' + f)); process.exitCode = 1; }
