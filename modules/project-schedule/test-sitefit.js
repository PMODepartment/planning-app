/* WHAT THE SITE DRAWS A TOWER FROM, IN BOTH READINGS — executed, not read.
 *
 *   node modules/project-schedule/test-sitefit.js
 *
 * Owner 2026-09-16, three times in one day, the last with the two readings side by side:
 * *"The configuration of the tower is not the same and the location is not the same. why?"*
 *
 * ⚠️⚠️ THE RULE THIS SUITE EXISTS TO HOLD: a tower the planner traced on the SITE PLAN is drawn
 *    from that footprint in Whole towers AND in Floor by floor. Same outline, same place, same
 *    size. The two readings differ in whether the solid is cut into storeys, and in nothing else.
 *
 * Two attempts at the other answer were made and rejected the same day — fitting the floor plan
 * into the tower's bounding box, then onto its minimum-area rectangle. Neither could work: the
 * shape being placed was never that tower's footprint. A site plan is traced building by building,
 * an outline at grade; a floor plan is traced room by room on another sheet at another scale with
 * a core and a notch in it. So the floor plan is now used ONLY where the site plan is silent — a
 * tower it does not name, which stands on a wrap slot and has no footprint to contradict.
 *
 * ⚠️⚠️ EVERY FUNCTION UNDER TEST IS SLICED OUT OF THE SHIPPED index.html BY NAME AND RUN.
 * ⚠️ The gate is the SHIPPED CALL SITE, not a re-statement of it: assertion 1 reads the real
 *    `if (...)` out of `_vs3Build` and requires `!_pg` to be in it. A suite that only exercised
 *    the fit helper would have passed on all three of today's versions, including the two the
 *    owner rejected — the helper was never the thing that was wrong.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const scan = require('../../tools/scan.js');
const { makeSlicer } = require('./test-slice.js');

const BASE_SHA = 'e8a9e73b';                 // the oriented-rectangle attempt, rejected by the owner
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

/* ---- the call site: WHEN the site view reads a floor plan at all --------------------------- */
/* ⚠️ Read off the shipped file with comments blanked (a `_pg` inside a comment is not code), and
   the guard is required to be the `if` that OPENS the branch — not a mention of `_pg` anywhere
   inside it. */
function siteFloorGuard(src) {
  const mask = scan.blankComments(src);
  const i = mask.indexOf('if (model.siteFloors && c.floor');
  if (i < 0) return null;
  return mask.slice(i, mask.indexOf('{', i) + 1).replace(/\s+/g, ' ').trim();
}

/* ---- the geometry half: the shipped fit, for the wrap-slot case --------------------------- */
function buildFit(src) {
  const S = makeSlicer(src);
  const parts = [S.sliceVarLine('_VS_ZP_ALL'), S.sliceFn('_vsZpOutlineOf')];
  /* ⚠️ IT REFUSES TO STUB, with one exception, here and only here: the pinned base has helpers
     this file no longer does (and vice versa), and the contrast block has to be able to run it. */
  let planBox = true;
  try { parts.push(S.sliceFn('_vsZpPlanBox')); } catch (e) { planBox = false; }
  try { parts.push(S.sliceFn('_vs3Hull')); } catch (e) { /* only the rejected attempt needed it */ }
  try { parts.push(S.sliceFn('_vsZpMinRect')); } catch (e) { /* removed with that attempt */ }
  parts.push(S.sliceFn('_vsZpFitPolys'));
  return new Function(parts.join('\n') +
    ';return { fit: _vsZpFitPolys, planBox: ' + (planBox ? '_vsZpPlanBox' : 'null') +
    ', hasPlanBox: ' + planBox + ' };')();
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
function extent(polys) {
  const p = ptsOf(polys);
  if (!p.length) return null;
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
function bboxOf(polys) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  polys.forEach(q => q.pts.forEach(p => {
    u0 = Math.min(u0, p[0]); u1 = Math.max(u1, p[0]);
    v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]);
  }));
  return { u0: u0, u1: u1, v0: v0, v1: v1 };
}

/* The owner's own shape: a thin tower laid along a boundary, and a floor plan that is a DIFFERENT
   drawing of it — squarer, with a notch, as a room-by-room plan is. */
const SLAB_W = 0.5, SLAB_D = 0.12, SLAB_DEG = 30, SLAB_CX = 0.5, SLAB_CY = 0.5;
const FOOT = slab(SLAB_W, SLAB_D, SLAB_DEG, SLAB_CX, SLAB_CY);
const F_PODIUM = plan(0.6, 0.15, 0.5, 0.5);
const F_SETBACK = plan(0.3, 0.15, 0.5, 0.5);         // half as long — a genuine setback

/* ========================================================================================== */
const src = fs.readFileSync(PAGE, 'utf8');
const G = buildFit(src);

/* ---- 1 · THE RULE: a traced tower never reaches the floor plan at all ---------------------- */
{
  const guard = siteFloorGuard(src);
  ok(!!guard, 'the site floor-by-floor branch is still where this suite thinks it is');
  /* ⚠️⚠️ THE ASSERTION THE WHOLE CHANGE TURNS ON, and it is about the CALL SITE rather than the
     geometry: a tower with a traced site footprint (`_pg`) must not have it replaced. */
  ok(/&&\s*!_pg/.test(guard || ''),
     'a tower with a traced site footprint keeps it — the floor plan is not read for it');
  ok(!/_vsZpMinRect/.test(scan.blankComments(src)),
     'and the rejected oriented-rectangle attempt is gone, not left dead');
}

/* ---- 2 · what the two readings now share --------------------------------------------------- */
{
  /* ⚠️ Whole towers and Floor by floor both draw a traced tower from `_vsZpPolysOf(sitePlan,
     tower)`. There is no second code path to compare against any more — that IS the fix — so what
     is asserted here is that nothing in the file fits a plan onto a traced footprint. */
  const mask = scan.blankComments(src);
  const calls = (mask.match(/_vsZpFitPolys\(/g) || []).length;
  eq(calls, 2, 'exactly one definition and one call of the fit helper remain');
}

/* ---- 3 · the silence: an untraced tower still gets its floor plan in its slot --------------- */
{
  ok(G.hasPlanBox, 'the shared source box exists');
  const slot = { u0: 0.3, u1: 0.55, v0: 0.3, v1: 0.55 };
  const e = extent(G.fit(F_PODIUM, slot, PW, PD, null));
  ok(e.w <= 0.25 * PW + 1e-6 && e.d <= 0.25 * PD + 1e-6, 'wrap slot: the floor is contained by it');
  near(e.cx, 0.425 * PW, 0.001, 'wrap slot: and centred in it (x)');
  near(e.cy, 0.425 * PD, 0.001, 'wrap slot: and centred in it (y)');
}

/* ---- 4 · and a setback in that slot stays a setback ---------------------------------------- */
{
  const slot = { u0: 0.3, u1: 0.55, v0: 0.3, v1: 0.55 };
  let shared = G.planBox(F_PODIUM, null);
  shared = G.planBox(F_SETBACK, shared);
  const big = extent(G.fit(F_PODIUM, slot, PW, PD, shared));
  const small = extent(G.fit(F_SETBACK, slot, PW, PD, shared));
  near(+(small.w / big.w).toFixed(3), 0.5, 0.01, 'the setback floor stays half the podium, as drawn');
  near(+(small.d / big.d).toFixed(3), 1, 0.02, 'and keeps its own depth, which the planner drew the same');
  near(small.cx, big.cx, 0.001, 'both centred in the slot the tower stands in');
}

/* ---- 5 · a plan drawn the other way round is turned, never stretched ----------------------- */
{
  const slot = { u0: 0.2, u1: 0.8, v0: 0.4, v1: 0.55 };        // a wide, shallow slot
  const tall = plan(0.15, 0.6, 0.5, 0.5);                      // the same building, drawn portrait
  const e = extent(G.fit(tall, slot, PW, PD, G.planBox(tall, null)));
  ok(e.w > e.d, 'a portrait plan is turned to run the length of the slot');
  ok(e.w <= 0.6 * PW + 1e-6 && e.d <= 0.15 * PD + 1e-6, 'and is still contained, never stretched');
}

/* ---- 6 · THE CONTRAST: the pinned base must place a plan on a TRACED tower ----------------- */
{
  let base = null;
  try {
    base = cp.execSync('git show ' + BASE_SHA + ':modules/project-schedule/index.html',
      { cwd: path.join(__dirname, '..', '..'), maxBuffer: 268435456 }).toString('utf8');
  } catch (e) { base = null; }
  if (!base) {
    console.log('CONTRAST SKIPPED: could not read ' + BASE_SHA + ' - a green run here proves less.');
  } else {
    const bGuard = siteFloorGuard(base);
    ok(!!bGuard, 'BASE: the branch is there');
    /* ⚠️⚠️ THE DEFECT, REPRODUCED AT THE CALL SITE: the base reads a floor plan for a tower that
       HAS a traced footprint, which is what the owner was looking at. */
    ok(!/&&\s*!_pg/.test(bGuard || ''),
       'BASE: a traced tower has its footprint replaced by a floor plan - the reported defect');
    const B = buildFit(base);
    /* ⚠️ And the shape it put there was a different building: fitted onto the tower's rectangle,
       it is contained by the slab but it is not the slab — different outline, different size. */
    const bDrawn = B.fit(F_PODIUM, bboxOf(FOOT), PW, PD, null);
    ok(!insideSlab(bDrawn, SLAB_W, SLAB_D, SLAB_DEG, SLAB_CX, SLAB_CY),
       'BASE: and the first attempt at it spilled outside the traced slab too');
    ok(/_vsZpMinRect/.test(scan.blankComments(base)), 'BASE: has the oriented-rectangle attempt');
  }
}

console.log('');
console.log('site floor footprint: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log(''); fails.forEach(f => console.log('  ' + f)); process.exitCode = 1; }
