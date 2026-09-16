/* WHERE A FLOOR PLAN LANDS ON THE SITE — executed, not read.
 *
 *   node modules/project-schedule/test-sitefit.js
 *
 * Owner 2026-09-16: *"look at the 3d vertical stacking view looking at site and then look at the
 * floor by floor view. FIX"* — the towers change size, shape and place between the two readings
 * of one drawing.
 *
 * Two faults, and this suite pins both:
 *   1 · the floor plan was fitted into the AXIS-ALIGNED BOUNDING BOX of the tower's traced
 *       footprint. A site is traced over a property and a property is rarely square to the sheet,
 *       so an angled slab's box is far bigger than the slab, square where the slab is thin, and
 *       centred somewhere the slab is not.
 *   2 · every floor was fitted SEPARATELY, so a setback penthouse was scaled up until it filled
 *       the same footprint as the podium under it — and the site card therefore disagreed with
 *       the per-tower card, which draws each floor at its own traced coordinates.
 *
 * ⚠️⚠️ EVERY FUNCTION UNDER TEST IS SLICED OUT OF THE SHIPPED index.html BY NAME AND RUN.
 * ⚠️ AND IT IS GATED against a pinned base SHA, executed on the same fixtures and required to
 *    reproduce both faults. A suite that passes on both files proves nothing.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { makeSlicer } = require('./test-slice.js');

const BASE_SHA = 'f48cf766';                 // the commit before the tower rectangle existed
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

/* ---- the geometry half: the shipped fit, against a traced footprint ----------------------- */
function buildFit(src) {
  const S = makeSlicer(src);
  const parts = [S.sliceVarLine('_VS_ZP_ALL'), S.sliceFn('_vsZpOutlineOf'), S.sliceFn('_vs3Hull')];
  /* ⚠️ IT REFUSES TO STUB. A name this file does not define is a link failure and not something to
     fill in: an auto-stub is how a suite goes green against a broken build. The two helpers the
     fix adds are OPTIONAL here and only here, because the pinned base predates them and the
     contrast block below has to be able to run the base at all. */
  let oriented = true;
  try { parts.push(S.sliceFn('_vsZpPlanBox')); parts.push(S.sliceFn('_vsZpMinRect')); }
  catch (e) { oriented = false; }
  parts.push(S.sliceFn('_vsZpFitPolys'));
  return new Function(parts.join('\n') +
    ';return { fit: _vsZpFitPolys, minRect: ' + (oriented ? '_vsZpMinRect' : 'null') +
    ', planBox: ' + (oriented ? '_vsZpPlanBox' : 'null') + ', oriented: ' + oriented + ' };')();
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
// A traced floor plan: one `*floor*` outline, `w` x `d` of the sheet, centred at (mx, my).
function plan(w, d, mx, my, ar) {
  return { ar: ar || 1, polys: [{ code: '*floor*', pts: [
    [mx - w / 2, my - d / 2], [mx + w / 2, my - d / 2], [mx + w / 2, my + d / 2], [mx - w / 2, my + d / 2]
  ] }] };
}
function ptsOf(polys) {
  const out = [];
  (polys || []).forEach(q => (q.pts || []).forEach(p => out.push([p[0] * PW, p[1] * PD])));
  return out;
}
// The drawn extent, as an AXIS-ALIGNED box — what the eye reads as "how wide is this building".
function extent(polys) {
  const p = ptsOf(polys);
  if (!p.length) return null;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  p.forEach(q => { u0 = Math.min(u0, q[0]); u1 = Math.max(u1, q[0]); v0 = Math.min(v0, q[1]); v1 = Math.max(v1, q[1]); });
  return { w: +(u1 - u0).toFixed(4), d: +(v1 - v0).toFixed(4),
           cx: +((u0 + u1) / 2).toFixed(4), cy: +((v0 + v1) / 2).toFixed(4) };
}
/* The extent measured ON THE TOWER'S OWN AXES. ⚠️ An axis-aligned box cannot answer "how long is
   this floor" for a building that is turned 30°: it mixes the length and the depth into both
   numbers, and the ratio between two floors of one tower comes out neither 0.5 nor 1. */
function extentOn(polys, deg) {
  const t = deg * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
  const p = ptsOf(polys).map(q => [q[0] * cs + q[1] * sn, -q[0] * sn + q[1] * cs]);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  p.forEach(q => { u0 = Math.min(u0, q[0]); u1 = Math.max(u1, q[0]); v0 = Math.min(v0, q[1]); v1 = Math.max(v1, q[1]); });
  return { w: +(u1 - u0).toFixed(4), d: +(v1 - v0).toFixed(4) };
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
// The axis-aligned box the OLD code fitted into: the corners of the traced footprint.
function bboxOf(polys) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  polys.forEach(q => q.pts.forEach(p => {
    u0 = Math.min(u0, p[0]); u1 = Math.max(u1, p[0]);
    v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]);
  }));
  return { u0: u0, u1: u1, v0: v0, v1: v1 };
}

/* A thin tower, laid along a boundary at 30° — the shape a real site plan is full of. */
const SLAB_W = 0.5, SLAB_D = 0.12, SLAB_DEG = 30, SLAB_CX = 0.5, SLAB_CY = 0.5;
const FOOT = slab(SLAB_W, SLAB_D, SLAB_DEG, SLAB_CX, SLAB_CY);
const F_PODIUM = plan(0.6, 0.15, 0.5, 0.5);          // the shape of the tower: long and thin
const F_SETBACK = plan(0.3, 0.15, 0.5, 0.5);         // half as long — a genuine setback

/* ========================================================================================== */
const src = fs.readFileSync(PAGE, 'utf8');
const G = buildFit(src);

/* ---- 1 · the tower keeps its place, its size and its heading ------------------------------ */
{
  ok(G.oriented, 'the tower rectangle exists');
  const rect = G.minRect(FOOT, PW, PD);
  ok(!!rect, 'the traced footprint has a rectangle');
  near(Math.min(rect.w, rect.d), SLAB_D * PD, 0.002, 'rect: the short side IS the slab, not its box');
  near(Math.max(rect.w, rect.d), SLAB_W * PW, 0.002, 'rect: and the long side too');
  near(rect.cx, SLAB_CX * PW, 0.002, 'rect: centred on the slab (x)');
  near(rect.cy, SLAB_CY * PD, 0.002, 'rect: centred on the slab (y)');

  const box = G.planBox(F_PODIUM, null);
  const drawn = G.fit(F_PODIUM, rect, PW, PD, box);
  ok(!!drawn && drawn.length === 1, 'the floor plan is placed');
  /* ⚠️⚠️ THE ASSERTION THE WHOLE CHANGE TURNS ON: the drawn floor is inside the tower the planner
     traced — not inside the box its four corners happen to fall in. */
  ok(insideSlab(drawn, SLAB_W, SLAB_D, SLAB_DEG, SLAB_CX, SLAB_CY),
     'the floor lands INSIDE the traced slab, heading and all');
  const e = extent(drawn);
  near(e.cx, SLAB_CX * PW, 0.01, 'and on the slab centre (x)');
  near(e.cy, SLAB_CY * PD, 0.01, 'and on the slab centre (y)');
}

/* ---- 2 · a setback survives, because one transform serves the whole tower ----------------- */
{
  const rect = G.minRect(FOOT, PW, PD);
  // The tower's floors, measured TOGETHER — what the renderer hands the fit.
  let shared = G.planBox(F_PODIUM, null);
  shared = G.planBox(F_SETBACK, shared);
  const big = extentOn(G.fit(F_PODIUM, rect, PW, PD, shared), SLAB_DEG);
  const small = extentOn(G.fit(F_SETBACK, rect, PW, PD, shared), SLAB_DEG);
  const lng = +(Math.max(small.w, small.d) / Math.max(big.w, big.d)).toFixed(3);
  const shrt = +(Math.min(small.w, small.d) / Math.min(big.w, big.d)).toFixed(3);
  near(lng, 0.5, 0.01, 'the setback floor stays half the podium, as it was drawn');
  near(shrt, 1, 0.02, 'and keeps its own depth, which the planner drew the same');
}

/* ---- 3 · the degrade: a tower square to the sheet is drawn exactly as it was --------------- */
{
  const sq = slab(0.4, 0.2, 0, 0.5, 0.5);
  const rect = G.minRect(sq, PW, PD);
  const box = G.planBox(F_PODIUM, null);
  const nowE = extent(G.fit(F_PODIUM, rect, PW, PD, box));
  const oldE = extent(G.fit(F_PODIUM, bboxOf(sq), PW, PD, box));   // the axis-aligned path
  eq(nowE.w, oldE.w, 'square to the sheet: the rectangle IS the bounding box (w)');
  eq(nowE.d, oldE.d, 'square to the sheet: the rectangle IS the bounding box (d)');
  eq(nowE.cx, oldE.cx, 'square to the sheet: and in the same place');
}

/* ---- 4 · no traced footprint: the wrap slot still serves, axis-aligned ---------------------- */
{
  const slot = { u0: 0.3, u1: 0.55, v0: 0.3, v1: 0.55 };
  const e = extent(G.fit(F_PODIUM, slot, PW, PD, null));
  ok(e.w <= 0.25 * PW + 1e-6 && e.d <= 0.25 * PD + 1e-6, 'wrap slot: the floor is contained by it');
  near(e.cx, 0.425 * PW, 0.001, 'wrap slot: and centred in it');
}

/* ---- 5 · a plan drawn the other way round is turned, never stretched ----------------------- */
{
  const tall = plan(0.15, 0.6, 0.5, 0.5);            // the same building, drawn portrait
  const rect = G.minRect(FOOT, PW, PD);
  const drawn = G.fit(tall, rect, PW, PD, G.planBox(tall, null));
  const e = extentOn(drawn, SLAB_DEG);
  ok(insideSlab(drawn, SLAB_W, SLAB_D, SLAB_DEG, SLAB_CX, SLAB_CY),
     'a portrait plan still lands on the slab');
  /* ⚠️ Turned, so it runs the LENGTH of the tower — a stretch would have made it fit too, and a
     stretch is the one thing this view may never do. */
  ok(Math.max(e.w, e.d) > 0.6, 'a portrait plan is turned to run the length of the tower');
}

/* ---- 6 · THE CONTRAST: the pinned base must reproduce both faults -------------------------- */
{
  let base = null;
  try {
    base = cp.execSync('git show ' + BASE_SHA + ':modules/project-schedule/index.html',
      { cwd: path.join(__dirname, '..', '..'), maxBuffer: 268435456 }).toString('utf8');
  } catch (e) { base = null; }
  if (!base) {
    console.log('CONTRAST SKIPPED: could not read ' + BASE_SHA + ' - a green run here proves less.');
  } else {
    const B = buildFit(base);
    ok(!B.oriented, 'BASE: has no tower rectangle');
    const bbox = bboxOf(FOOT);
    const bDrawn = B.fit(F_PODIUM, bbox, PW, PD);
    /* ⚠️⚠️ FAULT 1, REPRODUCED: the floor is drawn outside the tower the planner traced. */
    ok(!insideSlab(bDrawn, SLAB_W, SLAB_D, SLAB_DEG, SLAB_CX, SLAB_CY),
       'BASE: the floor spills outside the traced slab - the reported defect');
    const bE = extent(bDrawn), rect = G.minRect(FOOT, PW, PD);
    const nE = extent(G.fit(F_PODIUM, rect, PW, PD, G.planBox(F_PODIUM, null)));
    ok(bE.w !== nE.w || bE.d !== nE.d, 'BASE vs now: the same fixture is drawn differently');
    /* ⚠️⚠️ FAULT 2, REPRODUCED: a floor traced at half the podium is scaled until it fills the same
       box — same width, and DEEPER than the podium it stands on, which is not a building. */
    const b1 = extent(B.fit(F_PODIUM, bbox, PW, PD));
    const b2 = extent(B.fit(F_SETBACK, bbox, PW, PD));
    eq(b2.w, b1.w, 'BASE: the setback floor is blown up to the podium footprint (w)');
    ok(b2.d > b1.d, 'BASE: and comes out deeper than the podium under it');
    const nShared = G.planBox(F_SETBACK, G.planBox(F_PODIUM, null));
    const n1 = extentOn(G.fit(F_PODIUM, rect, PW, PD, nShared), SLAB_DEG);
    const n2 = extentOn(G.fit(F_SETBACK, rect, PW, PD, nShared), SLAB_DEG);
    ok(Math.max(n2.w, n2.d) < Math.max(n1.w, n1.d) * 0.6, 'NOW: the setback is a setback again');
  }
}

console.log('');
console.log('site floor fit: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log(''); fails.forEach(f => console.log('  ' + f)); process.exitCode = 1; }
