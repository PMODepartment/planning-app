/* WHAT THE SITE DRAWS A TOWER FROM, IN BOTH READINGS — executed, not read.
 *
 *   node modules/project-schedule/test-sitefit.js
 *
 * Owner 2026-09-16, four reports in one day:
 *   *"look at the positioning and configuration of the towers. something happened when choosing
 *     floor by floor."*
 *   *"the issue still remains. The configuration of the tower is not the same and the location is
 *     not the same. why?"*
 *   *"now the actual floor plan is gone? look at the floor plan defined here…"*  — with the
 *     L-shaped, three-zone F1 of Tower 1 open in the plan editor.
 *
 * ⚠️⚠️ THE TWO ASKS ARE ONE RULE, AND IT IS WHAT THIS SUITE HOLDS:
 *      the SITE plan says WHERE a tower stands, how big it is and which way it runs;
 *      the FLOOR plans say WHAT SHAPE it is;
 *      and BOTH readings of the site — Whole towers and Floor by floor — ask the same two
 *      questions of the same two drawings, through the same transform.
 *
 * Three earlier attempts moved the floor plan around (into the tower's bounding box, onto its
 * minimum-area rectangle, then out of the view altogether). All three left one reading using the
 * floor plan and the other not, which is why none of them closed the report.
 *
 * ⚠️⚠️ EVERY FUNCTION UNDER TEST IS SLICED OUT OF THE SHIPPED index.html BY NAME AND RUN.
 * ⚠️ And the gate is the SHIPPED CALL SITE, not a re-statement of it: the geometry helper was
 *    never the thing that was wrong, so a suite that only exercised it would have gone green on
 *    every rejected version.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const scan = require('../../tools/scan.js');
const { makeSlicer } = require('./test-slice.js');

const BASE_SHA = 'feae648b';                 // the attempt that took floor plans off the site
const PAGE = path.join(__dirname, 'index.html');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) { if (cond) pass++; else { fail++; fails.push(label); } }
function eq(got, want, label) {
  ok(got === want, label + '  (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}
function near(got, want, tol, label) {
  ok(typeof got === 'number' && isFinite(got) && Math.abs(got - want) <= tol,
     label + '  (got ' + JSON.stringify(got) + ', want ' + want + ' ±' + tol + ')');
}

/* ---- the call site: WHEN the site view reads a floor plan, and for WHICH cells ------------- */
/* ⚠️ Read off the shipped file with comments blanked — a `_pg` inside a comment is not code. */
function siteBranch(src) {
  const mask = scan.blankComments(src);
  const i = mask.search(/if \(model\.site(Floors)?[ )&]/);
  if (i < 0) return null;
  /* ⚠️ Far enough to reach the fit call at the end of the branch — the guard and what it does are
     one claim, and checking only the guard would miss which plan it resolves. */
  return mask.slice(i, i + 1600).replace(/\s+/g, ' ').trim();
}

/* ---- the geometry half: the shipped fit, run on real fixtures ------------------------------ */
function buildFit(src) {
  const S = makeSlicer(src);
  const parts = [S.sliceVarLine('_VS_ZP_ALL'), S.sliceFn('_vsZpOutlineOf')];
  /* ⚠️ IT REFUSES TO STUB, with one exception, here and only here: the pinned base is a version
     that REMOVED helpers this file has, and the contrast block has to be able to run it. */
  let full = true;
  try {
    parts.push(S.sliceFn('_vsZpPlanBox'));
    parts.push(S.sliceFn('_vs3Hull'));
    parts.push(S.sliceFn('_vsZpMinRect'));
  } catch (e) { full = false; }
  parts.push(S.sliceFn('_vsZpFitPolys'));
  return new Function(parts.join('\n') +
    ';return { fit: _vsZpFitPolys, planBox: ' + (full ? '_vsZpPlanBox' : 'null') +
    ', minRect: ' + (full ? '_vsZpMinRect' : 'null') + ', full: ' + full + ' };')();
}

/* ---- the resolution half: WHICH plan each kind of site cell resolves ----------------------- */
/* ⚠️ `_twFloors` / `_twSrc` / `_twBiggestPlan` are nested inside `_vs3Build`, and the slicer finds
   them by name wherever they live. Their dependencies are sliced too — `_vsZpFor` and its tower
   index included — so this exercises the whole chain from a cell to a plan, not a sketch of it.
   The only things supplied here are the two things the renderer supplies: the row's cells and the
   plan map. */
function buildResolve(src, cells, map) {
  const S = makeSlicer(src);
  const parts = [
    "var VS_NOLEV = '— No level —';",
    "var _VS_ZP_NOLEV = '*nolevel*';",
    S.sliceVarLine('_VS_ZP_ALL'),
    'function _vsZpAll() { return _MAP; }',
    'var model = { site: true, siteFloors: true, trade: null };',
    'var _twFlMemo = {}, _twSrcMemo = {}, _twBigMemo = {};',
    S.sliceFn('_vsZpNorm'), S.sliceFn('_vsZpTowersOf'), S.sliceFn('_vsZpFor'),
    S.sliceFn('_vsZpOutlineOf'), S.sliceFn('_vsZpPlanBox'),
    S.sliceFn('_twFloors'), S.sliceFn('_twSrc'), S.sliceFn('_twBiggestPlan')
  ];
  return new Function('cells', '_MAP', parts.join('\n') +
    ';return { floors: _twFloors, src: _twSrc, biggest: _twBiggestPlan };')(cells, map);
}

/* ---- fixtures ----------------------------------------------------------------------------- */
const PW = 2, PD = 2;                        // a square site sheet, so plate units ARE metric ones

// A rectangle centred on the plate, `w` x `d` in plate units, turned `deg` about its centre.
function slab(w, d, deg, cx, cy) {
  const t = deg * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
  const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
    .map(p => [cx + p[0] * cs - p[1] * sn, cy + p[0] * sn + p[1] * cs]);
  return [{ code: 'Tower 1', pts: pts }];
}
/* The owner's own F1: an L of three zones, no `*floor*` outline — which is the ordinary case, and
   the one `_vsZpOutlineOf` answers with the zones themselves. */
function ell(scale) {
  const s = scale == null ? 1 : scale, x0 = 0.5 - 0.35 * s, y0 = 0.5 - 0.18 * s;
  const W = 0.7 * s, H = 0.36 * s;
  return { ar: 1, polys: [
    { code: 'Z1', pts: [[x0, y0], [x0 + W * 0.22, y0], [x0 + W * 0.22, y0 + H], [x0, y0 + H]] },
    { code: 'Z2', pts: [[x0 + W * 0.22, y0], [x0 + W * 0.68, y0], [x0 + W * 0.68, y0 + H * 0.45],
                        [x0 + W * 0.22, y0 + H * 0.45]] },
    { code: 'Z3', pts: [[x0 + W * 0.68, y0], [x0 + W, y0], [x0 + W, y0 + H], [x0 + W * 0.68, y0 + H]] }
  ] };
}
function ptsOf(polys) {
  const out = [];
  (polys || []).forEach(q => (q.pts || []).forEach(p => out.push([p[0] * PW, p[1] * PD])));
  return out;
}
function extentOn(polys, deg) {
  const t = (deg || 0) * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
  const p = ptsOf(polys).map(q => [q[0] * cs + q[1] * sn, -q[0] * sn + q[1] * cs]);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  p.forEach(q => { u0 = Math.min(u0, q[0]); u1 = Math.max(u1, q[0]); v0 = Math.min(v0, q[1]); v1 = Math.max(v1, q[1]); });
  return { w: +(u1 - u0).toFixed(4), d: +(v1 - v0).toFixed(4),
           cx: +((u0 + u1) / 2).toFixed(4), cy: +((v0 + v1) / 2).toFixed(4) };
}
// Is every drawn point inside the traced footprint's own rectangle (not its bounding box)?
function insideSlab(polys, w, d, deg, cx, cy) {
  const t = deg * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
  return ptsOf(polys).every(p => {
    const dx = p[0] - cx * PW, dy = p[1] - cy * PD;
    const a = dx * cs + dy * sn, b = -dx * sn + dy * cs;
    return Math.abs(a) <= (w * PW) / 2 + 1e-6 && Math.abs(b) <= (d * PD) / 2 + 1e-6;
  });
}
function shapeKey(polys) {
  return (polys || []).map(q => (q.pts || []).map(p => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join(' ')).join(' | ');
}

const SLAB_W = 0.5, SLAB_D = 0.16, SLAB_DEG = 30, SLAB_CX = 0.5, SLAB_CY = 0.5;
const FOOT = slab(SLAB_W, SLAB_D, SLAB_DEG, SLAB_CX, SLAB_CY);
const F_PODIUM = ell(1);                             // the biggest floor — the tower's outline
const F_SETBACK = ell(0.5);                          // half of it, a genuine setback

/* ========================================================================================== */
const src = fs.readFileSync(PAGE, 'utf8');
const G = buildFit(src);
const mask = scan.blankComments(src);

/* ---- 1 · THE RULE, at the call site: both readings read a floor plan ----------------------- */
{
  const br = siteBranch(src);
  ok(!!br, 'the site branch is still where this suite thinks it is');
  /* ⚠️⚠️ THE ASSERTION THE WHOLE CHANGE TURNS ON. `model.site` is true for BOTH site models;
     `model.siteFloors` is true only for Floor by floor, and gating on it is what left Whole towers
     drawing a different outline. */
  ok(/^if \(model\.site\)/.test(br || ''),
     'the branch is entered for BOTH readings, not only Floor by floor');
  ok(!/&&\s*!_pg/.test(br || ''),
     'and a traced tower is not excluded from it — the 2026-09-16 (za) over-correction is gone');
  /* ⚠️ A whole-tower cell names no floor, so it must resolve one: the tower's BIGGEST. */
  ok(/c\.floor \? _vsZpFor\(c\.floor, model\.trade, c\.label\) : _twBiggestPlan\(c\)/.test(br || ''),
     'a floor slice takes its own plan; a whole-tower solid takes the tower biggest floor');
  ok(/_twSrc\(c\)/.test(br || ''), 'and both go through ONE source box per tower');
}

/* ---- 2 · the model carries what the renderer needs to ask ---------------------------------- */
{
  /* ⚠️ A whole-tower cell has no `floor`, so without `floors` on the cell the renderer could not
     find the tower's plans at all and Whole towers would silently keep its old outline. */
  ok(/floors: levsOf\[t\] \|\| \[\]/.test(mask),
     'whole-tower cells carry the levels the tower has work on');
  ok(/_twFlMemo|_twFloors/.test(mask), 'and the renderer reads them through one memo');
}

/* ---- 3 · a traced tower: the plan lands ON the tower, heading and all ---------------------- */
{
  ok(G.full, 'the tower rectangle is back in the file');
  const rect = G.minRect(FOOT, PW, PD);
  ok(!!rect, 'the traced footprint has a rectangle');
  near(Math.min(rect.w, rect.d), SLAB_D * PD, 0.002, 'rect: the short side IS the slab, not its box');
  near(Math.max(rect.w, rect.d), SLAB_W * PW, 0.002, 'rect: and the long side too');

  const shared = G.planBox(F_SETBACK, G.planBox(F_PODIUM, null));
  const drawn = G.fit(F_PODIUM, rect, PW, PD, shared);
  eq((drawn || []).length, 3, 'the L keeps all three of its zones');
  ok(insideSlab(drawn, SLAB_W, SLAB_D, SLAB_DEG, SLAB_CX, SLAB_CY),
     'and lands INSIDE the traced slab, heading and all');
  const e = extentOn(drawn, 0);
  near(e.cx, SLAB_CX * PW, 0.01, 'on the slab centre (x)');
  near(e.cy, SLAB_CY * PD, 0.01, 'on the slab centre (y)');
}

/* ---- 4 · THE TWO READINGS DRAW THE SAME BUILDING ------------------------------------------- */
{
  /* The plan map as `zpByLabelOf` emits it: keyed by tower, F1 the podium and F5 the setback. */
  const MAP = { '@tower 1|f1': F_PODIUM, '@tower 1|f5': F_SETBACK };
  // Floor by floor: one cell per (tower, floor).   Whole towers: one cell, carrying `floors`.
  const floorCells = [{ label: 'Tower 1', floor: 'F1' }, { label: 'Tower 1', floor: 'F5' }];
  const towerCells = [{ label: 'Tower 1', floors: ['F1', 'F5'] }];

  const RF = buildResolve(src, floorCells, MAP);
  const RT = buildResolve(src, towerCells, MAP);
  eq(RT.floors(towerCells[0]).join(','), 'F1,F5', 'a whole-tower cell finds its own floors');
  eq(RF.floors(floorCells[0]).join(','), 'F1,F5', 'and so does a floor slice, off the row');

  /* ⚠️⚠️ THE ASSERTION THE OWNER'S FOUR REPORTS REDUCE TO. The solid Whole towers draws and the
     biggest slice Floor by floor draws must resolve the SAME plan through the SAME source box —
     otherwise the two readings are two buildings again, which is all any of them said. */
  ok(RT.biggest(towerCells[0]) === F_PODIUM, 'the whole-tower solid resolves the tower biggest floor');
  const sT = RT.src(towerCells[0]), sF = RF.src(floorCells[0]);
  eq(JSON.stringify(sT), JSON.stringify(sF), 'and both readings build the identical source box');

  const rect = G.minRect(FOOT, PW, PD);
  const massing = G.fit(RT.biggest(towerCells[0]), rect, PW, PD, sT);
  const slice = G.fit(MAP['@tower 1|f1'], rect, PW, PD, sF);
  eq(shapeKey(massing), shapeKey(slice), 'so the massing solid IS the biggest floor slice');

  /* ⚠️ And it is the BIGGEST, not the first: reverse the order and the answer does not move. */
  const RR = buildResolve(src, [{ label: 'Tower 1', floors: ['F5', 'F1'] }], MAP);
  ok(RR.biggest({ label: 'Tower 1', floors: ['F5', 'F1'] }) === F_PODIUM,
     'the biggest floor wins whichever order the levels arrive in');
}

/* ---- 5 · and a setback is still a setback inside it ---------------------------------------- */
{
  const rect = G.minRect(FOOT, PW, PD);
  const shared = G.planBox(F_SETBACK, G.planBox(F_PODIUM, null));
  const big = extentOn(G.fit(F_PODIUM, rect, PW, PD, shared), SLAB_DEG);
  const small = extentOn(G.fit(F_SETBACK, rect, PW, PD, shared), SLAB_DEG);
  near(+(Math.max(small.w, small.d) / Math.max(big.w, big.d)).toFixed(3), 0.5, 0.01,
       'the setback floor stays half the podium, as it was drawn');
  near(+(Math.min(small.w, small.d) / Math.min(big.w, big.d)).toFixed(3), 0.5, 0.02,
       'in both directions, because that is how it was drawn');
}

/* ---- 6 · the biggest floor fills the tower, so the site trace still sizes the building ------ */
{
  const rect = G.minRect(FOOT, PW, PD);
  const shared = G.planBox(F_SETBACK, G.planBox(F_PODIUM, null));
  const e = extentOn(G.fit(F_PODIUM, rect, PW, PD, shared), SLAB_DEG);
  const fill = Math.max(Math.max(e.w, e.d) / Math.max(rect.w, rect.d),
                        Math.min(e.w, e.d) / Math.min(rect.w, rect.d));
  near(+fill.toFixed(3), 1, 0.005, 'the biggest floor fills the traced footprint in one direction');
  ok(Math.max(e.w, e.d) <= Math.max(rect.w, rect.d) + 1e-6 &&
     Math.min(e.w, e.d) <= Math.min(rect.w, rect.d) + 1e-6, 'and never overruns it — contain, never stretch');
}

/* ---- 7 · no traced footprint: the wrap slot still serves, axis-aligned --------------------- */
{
  const slot = { u0: 0.3, u1: 0.55, v0: 0.3, v1: 0.55 };
  const e = extentOn(G.fit(F_PODIUM, slot, PW, PD, null), 0);
  ok(e.w <= 0.25 * PW + 1e-6 && e.d <= 0.25 * PD + 1e-6, 'wrap slot: the floor is contained by it');
  near(e.cx, 0.425 * PW, 0.001, 'wrap slot: and centred in it');
}

/* ---- 8 · THE CONTRAST: the pinned base must show the asymmetry ----------------------------- */
{
  let base = null;
  try {
    base = cp.execSync('git show ' + BASE_SHA + ':modules/project-schedule/index.html',
      { cwd: path.join(__dirname, '..', '..'), maxBuffer: 268435456 }).toString('utf8');
  } catch (e) { base = null; }
  if (!base) {
    console.log('CONTRAST SKIPPED: could not read ' + BASE_SHA + ' - a green run here proves less.');
  } else {
    const bBr = siteBranch(base);
    ok(!!bBr, 'BASE: the branch is there');
    /* ⚠️⚠️ THE DEFECT, REPRODUCED AT THE CALL SITE: the base reads a floor plan only for Floor by
       floor, and only for a tower the site plan does NOT name — which is why the owner's traced
       towers lost their floor plans entirely. */
    ok(/^if \(model\.siteFloors/.test(bBr || ''),
       'BASE: only Floor by floor reads a floor plan - the two readings cannot agree');
    ok(/&&\s*!_pg/.test(bBr || ''),
       'BASE: and a traced tower is excluded, so the floor plan the owner drew is not shown');
    ok(!/_vsZpMinRect/.test(scan.blankComments(base)), 'BASE: the tower rectangle had been removed');
  }
}

console.log('');
console.log('site footprint, both readings: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log(''); fails.forEach(f => console.log('  ' + f)); process.exitCode = 1; }
