/* THE SHAPE EDITOR'S NEW GEOMETRY, AND THE TRADE THAT CARRIES NO LOCATION.
 *
 * Owner 2026-09-17: *"for adding floor plan, improve UI to edit shapes"* and *"general
 * requirements should have no tower, floor, or zones."*
 *
 * ⚠️ Every function is SLICED OUT OF THE SHIPPED `index.html` BY NAME and executed — never
 *    re-implemented here. A suite that re-states the rule proves the re-statement.
 * ⚠️ The contrast build runs the same assertions against a PINNED SHA, and each new rule is
 *    required to be ABSENT there: a suite that passes on both files proves nothing.
 *
 *   node test-shapeedit.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeSlicer } = require('./test-slice.js');

const ROOT = path.resolve(__dirname, '..', '..');
const FILE = path.join(__dirname, 'index.html');
const BASE_SHA = '806c91db';          // the commit before this work

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label, got) {
  if (cond) pass++; else { fail++; fails.push(label + (got === undefined ? '' : '  [got: ' + JSON.stringify(got) + ']')); }
}
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label, a); }
function near(a, b, label, tol) { ok(Math.abs(a - b) <= (tol == null ? 1e-9 : tol), label, a); }

/* ---------------------------------------------------------------- the harness */

const GEOM = ['zpClamp', 'zpBBoxOf', 'zpRingOk', 'zpXformPts', 'zpFitBack',
              'zpFlipPts', 'zpNudgePts', 'zpSetBoxPts'];

function buildGeom(src) {
  const S = makeSlicer(src);
  let body = 'var ZP_W = ' + /var ZP_W = (\d+)/.exec(src)[1] + ';\n';
  GEOM.forEach(function (n) { body += S.sliceFn(n) + '\n'; });
  return new Function('"use strict";\n' + body +
    'return { flip: zpFlipPts, nudge: zpNudgePts, setBox: zpSetBoxPts, bbox: zpBBoxOf, W: ZP_W };')();
}

const src = fs.readFileSync(FILE, 'utf8');
const G = buildGeom(src);
const H = 620;                                     // the default sheet height

/* ---------------------------------------------------------------- 1 · mirror */

console.log('1 · mirror');
{
  // An L, so a mirror is distinguishable from a rotation.
  const L = [[100, 100], [300, 100], [300, 200], [200, 200], [200, 300], [100, 300]];
  const fx = G.flip(L, 'x', H);
  ok(fx, 'a mirror inside the sheet is allowed');
  const b0 = G.bbox(L), b1 = G.bbox(fx);
  eq([b1.x, b1.y, b1.w, b1.h], [b0.x, b0.y, b0.w, b0.h],
     '⚠️ the bounding box does not move — a mirror is about the shape’s OWN centre');
  /* ⚠️⚠️ THE POINT OF THE FEATURE: the result is NOT reachable by any rotation. Every rotation
     preserves the signed area's sign; a mirror flips it. */
  function signedArea(p) {
    let a = 0;
    for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; }
    return a / 2;
  }
  ok(signedArea(L) * signedArea(fx) < 0, '⚠️⚠️ the winding reverses — this is a handed shape, not a turn');
  near(Math.abs(signedArea(fx)), Math.abs(signedArea(L)), 'the area is preserved exactly', 1e-9);
  eq(G.flip(G.flip(L, 'x', H), 'x', H), L, 'mirroring twice returns the original, point for point');

  const fy = G.flip(L, 'y', H);
  const b2 = G.bbox(fy);
  eq([b2.x, b2.y, b2.w, b2.h], [b0.x, b0.y, b0.w, b0.h], 'the vertical mirror keeps its box too');
  ok(JSON.stringify(fy) !== JSON.stringify(fx), 'the two axes are genuinely different mirrors');

  // A shape that fills the sheet still mirrors — nothing grows.
  const full = [[0, 0], [G.W, 0], [G.W, H], [0, H]];
  ok(G.flip(full, 'x', H), 'a shape filling the sheet can still be mirrored (a mirror never grows it)');
}

/* ---------------------------------------------------------------- 2 · nudge */

console.log('\n2 · nudge');
{
  const R = [[100, 100], [300, 100], [300, 200], [100, 200]];
  eq(G.nudge(R, 20, 0, H), [[120, 100], [320, 100], [320, 200], [120, 200]],
     'a nudge translates every point by the same amount');
  /* ⚠️ Clamped by the BOUNDING BOX, the same rule the body drag follows: a nudge can never push
     half the area off the sheet while the rest stays on. */
  const atLeft = [[0, 100], [200, 100], [200, 200], [0, 200]];
  ok(G.nudge(atLeft, -50, 0, H) === null, '⚠️ a nudge that cannot move at all returns null, not a no-op array');
  const nearLeft = [[10, 100], [210, 100], [210, 200], [10, 200]];
  eq(G.bbox(G.nudge(nearLeft, -50, 0, H)).x, 0, '⚠️ a nudge PAST the edge stops AT the edge rather than being refused');
  eq(G.bbox(G.nudge(R, 0, 10000, H)).y, H - 100, 'and the same downward');
  ok(G.nudge(R, 0, 0, H) === null, 'a zero nudge is refused, so it writes no undo step');
}

/* ---------------------------------------------------------------- 3 · the numeric box */

console.log('\n3 · the numeric box');
{
  const L = [[100, 100], [300, 100], [300, 200], [200, 200], [200, 300], [100, 300]];
  const out = G.setBox(L, { x: 0, y: 0, w: 400, h: 400 }, H);
  const b = G.bbox(out);
  eq([b.x, b.y, b.w, b.h], [0, 0, 400, 400], 'the box lands exactly where and at the size it was told');
  ok(out.length === L.length, 'the corner count is unchanged — it is scaled, not re-traced');
  /* ⚠️ NON-UNIFORM ON PURPOSE: the planner is STATING the dimensions, so width without height
     would make the control unable to say the thing it exists for. Proved by asking for a box
     whose aspect differs from the shape's. */
  const wide = G.setBox(L, { x: 0, y: 0, w: 800, h: 100 }, H);
  const bw = G.bbox(wide);
  eq([bw.w, bw.h], [800, 100], '⚠️⚠️ width and height are set independently');

  // Clamped onto the sheet rather than refused.
  const off = G.setBox(L, { x: 5000, y: 5000, w: 200, h: 200 }, H);
  const bo = G.bbox(off);
  eq([bo.x, bo.y], [G.W - 200, H - 200], 'a position past the sheet is clamped to the sheet');
  const big = G.setBox(L, { x: 0, y: 0, w: 99999, h: 99999 }, H);
  const bb = G.bbox(big);
  eq([bb.w, bb.h], [G.W, H], 'a size past the sheet is clamped to the sheet');
  // Degenerate: a shape with no area cannot be given one.
  ok(G.setBox([[10, 10], [20, 10], [30, 10]], { x: 0, y: 0, w: 100, h: 100 }, H) === null,
     '⚠️ a degenerate ring stays degenerate and is REFUSED, never silently given an area');
}

/* ---------------------------------------------------------------- 4 · the loc-less trade */

console.log('\n4 · the trade that carries no location');
{
  const mask = require('../../tools/scan.js').blankComments(src);
  ok(/var LOCLESS = \{ GR: 1 \};/.test(mask), 'General Requirements is the loc-less trade');
  ok(/function locless\(tr\) \{ return !!LOCLESS\[tr\]; \}/.test(mask), 'and there is exactly one reader');

  /* ⚠️⚠️ FOUR CALL SITES, ASSERTED INDIVIDUALLY. The whole reason `locless` exists rather than four
     `=== 'GR'` tests is that the first change to the rule would otherwise leave three behind. */
  // ⚠️ Bounded to 400 characters so this still matches locList's OWN gate and not another
  //    function's — locList stopped being a one-liner when tower types landed.
  ok(/function locList\(\)\s*\{[\s\S]{0,400}?if \(locless\(tr\)\) return;/.test(mask),
     '1 · locList produces no leaves for it');
  ok(/if \(locless\(tr\)\) return;\s*\(\(c\.zoning\[tr\] && c\.zoning\[tr\]\.floors\) \|\| \[\]\)/.test(mask),
     '2 · catalogueFrom contributes none of its floors to the location catalogue');
  ok(/var _allTw = locless\(tr\) \? null : towerIdOf\(_allFloor\);/.test(mask),
     '3 · generate gives its single occurrence NO tower');
  ok(/tower: _allTw \? towerLabel\(_allTw\) : ''/.test(mask),
     '   …and no tower label either, so locMapOf writes nothing');
  ok(/function locGroups\(\) \{ return usedGroups\(\)\.filter\(function \(g\) \{ return !locless\(g\); \}\); \}/.test(mask),
     '4 · locGroups is what the Floors & Zones editor lists');
  ok(/var used = locGroups\(\), _loclessUsed = usedGroups\(\)\.filter\(locless\);/.test(mask),
     '   …and stLevels reads it, keeping the left-out trades to name them');

  /* ⚠️ The zoning is IGNORED, not deleted — so the change is reversible by removing one key. */
  ok(!/delete cfg\.zoning\.GR/.test(mask) && !/cfg\.zoning\.GR = /.test(mask),
     '⚠️ nothing deletes or rewrites a loc-less trade’s stored zoning');
}

/* ---------------------------------------------------------------- 5 · the contrast */

console.log('\n5 · the base does NOT have any of this');
{
  let base;
  try {
    base = execFileSync('git', ['show', BASE_SHA + ':modules/project-schedule/index.html'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  } catch (e) {
    console.log('   ! could not read base ' + BASE_SHA + ' — the contrast did not run');
    base = null;
  }
  if (base) {
    ok(base.indexOf('function zpFlipPts(') < 0, 'BASE cannot mirror a shape');
    ok(base.indexOf('function zpNudgePts(') < 0, 'BASE has no nudge');
    ok(base.indexOf('function zpSetBoxPts(') < 0, 'BASE has no numeric box');
    ok(base.indexOf('var LOCLESS') < 0, 'BASE has no loc-less trade');
    ok(base.indexOf('function psAsk(') < 0, 'BASE has no in-app dialog kit');
    ok(base.indexOf('zpw-nolev') >= 0, '⚠️ BASE still carries the “no level” band checkbox');
    ok(src.indexOf('zpw-nolev') < 0, '…and this file does not');
    // The same slices must still build against the base where they exist at all.
    ok(base.indexOf('function zpBBoxOf(') >= 0, 'BASE does have the bbox helper the new ones build on');
  }
}

console.log('\n' + (fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed');
fails.forEach(function (f) { console.log('   x ' + f); });
process.exit(fail ? 1 : 0);
