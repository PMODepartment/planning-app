/* OVERLAPPING ZONES ON A FLOOR PLAN — slice-and-execute suite.
 *
 * Owner 2026-09-17: *"for the definition of the floor plans, there should be like a system or
 * error if there are overlapping zones."*
 *
 * ⚠️⚠️ WHY THIS NEEDS A SUITE RATHER THAN A SCREENSHOT. The feature is a REFUSAL to say
 *    "everything is fine", and the two ways it can be wrong are opposites that cancel out in
 *    casual testing:
 *      • it misses a real overlap — the floor is silently double-counted, which is the bug the
 *        check exists to catch;
 *      • it flags two zones that merely SHARE A WALL — which is every properly-drawn floor, so
 *        the warning appears everywhere, nobody reads it, and the first case goes unseen anyway.
 *    The second is the one a screenshot of a working plan would never reveal, so the abutting
 *    cases are asserted individually, including the ones a bounding-box test gets wrong: two Ls
 *    that interlock without overlapping, and a courtyard whose hole another zone sits in.
 *
 * ⚠️ Every function under test is SLICED OUT OF THE SHIPPED index.html BY NAME and executed —
 *    nothing here re-implements the rule (see test-slice.js for why that matters). The ONE
 *    re-implementation in this file is `shoelace`, used to state EXPECTED areas independently of
 *    the code under test; it is not the thing being proved.
 *
 * ⚠️ The contrast build runs against a PINNED SHA and is required NOT to have the feature: a
 *    suite that passes on both files proves nothing.
 *
 *   node modules/project-schedule/test-zoneoverlap.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeSlicer } = require('./test-slice.js');

const ROOT = path.resolve(__dirname, '..', '..');
const FILE = path.join(__dirname, 'index.html');

/* ⚠️ PINNED, NEVER `HEAD`. The commit before this work — `git show HEAD:` becomes
   self-comparison the moment you commit, and this repo has been caught by that. */
const BASE_SHA = '2ae9bc7d';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label, got) {
  if (cond) pass++; else { fail++; fails.push(label + (got === undefined ? '' : '  [got: ' + JSON.stringify(got) + ']')); }
}
function near(a, b, label, tol) { ok(Math.abs(a - b) <= (tol == null ? 1e-6 : tol), label, a); }

/* ---------------------------------------------------------------- the harness */

const GEOM = ['zpBBoxOf', 'zpNormCode', 'zpIsAll', 'zpSgnArea', 'zpClipConvex',
              'zpFanOf', 'zpInterArea', 'zpOverlapsOf', 'zpHasOverlap'];

function buildGeom(src) {
  const S = makeSlicer(src);
  let body = 'var ZP_ALL = ' + /var ZP_ALL = ('[^']+')/.exec(src)[1] + ';\n' +
             S.sliceVarLine('ZP_OV_TOL') + '\n';
  GEOM.forEach(function (n) { body += S.sliceFn(n) + '\n'; });
  return new Function('"use strict";\n' + body +
    'return { area: zpInterArea, pairs: zpOverlapsOf, has: zpHasOverlap, sgn: zpSgnArea,\n' +
    '         clip: zpClipConvex, TOL: ZP_OV_TOL, ALL: ZP_ALL };')();
}

const src = fs.readFileSync(FILE, 'utf8');
const G = buildGeom(src);

// ⚠️ Stated here, independently of the code under test, so an expected area is never the output
// of the thing being proved.
function shoelace(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; }
  return Math.abs(a / 2);
}
function rect(x, y, w, h) { return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
function plate(...polys) {
  return { h: 620, polys: polys.map((q, i) => ({ id: 'p' + i, code: q[0], pts: q[1] })) };
}

/* ---------------------------------------------------------- 1 · the area itself */

console.log('1 · the intersection area, exactly');
{
  const A = rect(0, 0, 100, 100);
  near(G.area(A, rect(50, 0, 100, 100)), 50 * 100, 'half-overlapping rectangles: the exact strip');
  near(G.area(A, rect(50, 50, 100, 100)), 50 * 50, 'corner overlap: the exact corner');
  near(G.area(A, rect(25, 25, 50, 50)), 50 * 50, 'a rectangle wholly inside is its own whole area');
  near(G.area(A, A), 100 * 100, 'a shape against itself is its own area');

  /* ⚠️⚠️ THE CASE THE WHOLE FEATURE TURNS ON. Zones are MEANT to share a wall — the snap grid
     exists so that they do — and a shared wall must measure exactly zero, not a sliver. */
  near(G.area(A, rect(100, 0, 100, 100)), 0, '⚠️⚠️ two zones sharing a wall overlap by exactly 0');
  near(G.area(A, rect(100, 100, 100, 100)), 0, '⚠️ touching at a single corner is 0 too');
  near(G.area(A, rect(200, 0, 100, 100)), 0, 'two zones nowhere near each other are 0');

  // ⚠️ Orientation must not matter: a planner traces clockwise as often as anticlockwise.
  const cw = [[0, 0], [0, 100], [100, 100], [100, 0]];
  ok(G.sgn(cw) * G.sgn(A) < 0, 'the two fixtures really are wound opposite ways');
  near(G.area(cw, rect(50, 0, 100, 100)), 50 * 100, '⚠️ a clockwise trace measures the same as an anticlockwise one');
  near(G.area(cw, cw), 100 * 100, 'and against itself');
}

/* ---------------------------------------------------------- 2 · concave shapes */

console.log('\n2 · concave shapes — where a bounding box gets it wrong');
{
  /* ⚠️⚠️ TWO INTERLOCKING Ls. Their bounding boxes overlap across a 100×100 square, and they do
     not share one square unit of actual area. A box test reports a 100% overlap here; this is
     the single most common real floor-plan layout there is. */
  const L1 = [[0, 0], [200, 0], [200, 100], [100, 100], [100, 200], [0, 200]];
  const L2 = [[100, 100], [200, 100], [200, 300], [0, 300], [0, 200], [100, 200]];
  const bb1 = [0, 0, 200, 200], bb2 = [0, 100, 200, 300];
  ok(bb1[2] > bb2[0] && bb1[3] > bb2[1], 'the two Ls really do have overlapping bounding boxes');
  near(G.area(L1, L2), 0, '⚠️⚠️ two interlocking Ls share a boundary and no area');
  near(shoelace(L1), 30000, 'the L fixture is the area it looks like');

  // Push one L one unit into the other and the shared boundary becomes a real strip.
  const L2in = L2.map(p => [p[0], p[1] - 10]);
  near(G.area(L1, L2in), 100 * 10 + 100 * 10, '⚠️ moved 10 units in, exactly the two 100×10 strips appear');

  /* ⚠️ A COURTYARD. A zone sitting in the hole of a C-shaped zone is inside its bounding box and
     outside the zone. The signed fan is what makes this work with no special case. */
  const C = [[0, 0], [300, 0], [300, 300], [0, 300], [0, 200], [200, 200], [200, 100], [0, 100]];
  near(shoelace(C), 300 * 300 - 200 * 100, 'the C fixture is the area it looks like');
  near(G.area(C, rect(20, 120, 160, 60)), 0, '⚠️⚠️ a zone in the courtyard of a C overlaps it by 0');
  near(G.area(C, rect(20, 120, 260, 60)), 80 * 60, 'and one that pokes through the far wall overlaps by exactly the part that pokes');
}

/* ---------------------------------------------------------- 3 · what counts as a pair */

console.log('\n3 · which pairs are reported at all');
{
  const p = plate(['Z1', rect(0, 0, 200, 200)], ['Z2', rect(100, 0, 200, 200)]);
  const r = G.pairs(p);
  ok(r.length === 1, 'one overlapping pair is one report', r.length);
  ok(r[0].a.code === 'Z1' && r[0].b.code === 'Z2', 'and it names both zones');
  near(r[0].area, 100 * 200, 'carrying the measured area');
  near(r[0].frac, 0.5, 'and the fraction of the SMALLER zone');
  ok(G.has(p) === true, 'the yes/no wrapper agrees');

  /* ⚠️⚠️ THE WHOLE-FLOOR OUTLINE IS NOT A ZONE. It is drawn AROUND the zones on purpose, so
     counting it would report every correctly-traced floor as broken. */
  const withOutline = plate([G.ALL, rect(0, 0, 400, 400)],
                            ['Z1', rect(0, 0, 200, 200)], ['Z2', rect(200, 0, 200, 200)]);
  ok(G.pairs(withOutline).length === 0,
     '⚠️⚠️ the whole-floor outline containing every zone is not an overlap');
  ok(G.has(withOutline) === false, 'and the floor reads clean');

  /* ⚠️ TWO AREAS OF ONE ZONE. `zpBox` already treats them as one zone traced in two pieces, and
     a zone cannot double-count itself. Asserted with pieces that genuinely overlap. */
  const twoPiece = plate(['Z1', rect(0, 0, 200, 200)], ['Z1', rect(100, 0, 200, 200)]);
  ok(G.pairs(twoPiece).length === 0, '⚠️ two pieces of the SAME zone are one zone, not an overlap');
  const casey = plate(['Zone 1', rect(0, 0, 200, 200)], ['  zone   1 ', rect(100, 0, 200, 200)]);
  ok(G.pairs(casey).length === 0, '⚠️ and the codes are compared the way the rest of the module compares them');

  // A degenerate scrap is not a shape and cannot overlap anything.
  const degen = plate(['Z1', rect(0, 0, 200, 200)], ['Z2', [[10, 10], [20, 20]]]);
  ok(G.pairs(degen).length === 0, 'a two-point scrap is not a shape');

  // Three mutually overlapping zones are three pairs, not one.
  const three = plate(['Z1', rect(0, 0, 200, 200)], ['Z2', rect(50, 0, 200, 200)], ['Z3', rect(100, 0, 200, 200)]);
  ok(G.pairs(three).length === 3, 'three mutually overlapping zones report all three pairs', G.pairs(three).length);
  ok(G.pairs(three)[0].frac >= G.pairs(three)[2].frac, 'worst first');
}

/* ---------------------------------------------------------- 4 · the tolerance */

console.log('\n4 · the tolerance, which is the reason anybody will read the warning');
{
  ok(G.TOL > 0 && G.TOL < 0.05, 'the tolerance is a small positive fraction', G.TOL);

  /* A 400×400 zone is 160,000, so 0.5% of it is 800 — a 2-unit strip down its 400-unit wall. */
  const hair = plate(['Z1', rect(0, 0, 400, 400)], ['Z2', rect(399, 0, 400, 400)]);
  ok(G.pairs(hair).length === 0, '⚠️ a 1-unit hand-drag past the wall is below the tolerance and is not flagged');
  const real = plate(['Z1', rect(0, 0, 400, 400)], ['Z2', rect(390, 0, 400, 400)]);
  ok(G.pairs(real).length === 1, '⚠️ a 10-unit one is over it and is', G.pairs(real).length);
  /* ⚠️ THE THRESHOLD IS INCLUSIVE — an overlap of exactly the tolerance is REPORTED. Pinned,
     because "at the tolerance" is the one value a later edit to the comparison would flip
     without changing any other case. */
  const exact = plate(['Z1', rect(0, 0, 400, 400)], ['Z2', rect(398, 0, 400, 400)]);
  near(G.pairs(exact)[0] && G.pairs(exact)[0].frac, G.TOL, 'the fixture really is exactly at the tolerance');
  ok(G.pairs(exact).length === 1, '⚠️ an overlap of exactly the tolerance is reported, not swallowed');

  /* ⚠️⚠️ RELATIVE TO THE SMALLER AREA, NOT TO THE FLOOR. A small store wholly inside a big slab
     is a tiny fraction of the floor and 100% of itself, and it is the store that is
     double-counted — the case a floor-relative tolerance would throw away. */
  const store = plate(['Slab', rect(0, 0, 1000, 600)], ['Store', rect(100, 100, 40, 40)]);
  const sr = G.pairs(store);
  ok(sr.length === 1, '⚠️⚠️ a small zone wholly inside a large one IS flagged', sr.length);
  near(sr[0].frac, 1, 'at 100% of itself');
  near(sr[0].area, 1600, 'and the area reported is the small one');
}

/* ---------------------------------------------------------- 5 · the clip's own edge cases */

console.log('\n5 · the clip');
{
  // ⚠️ A subject point lying exactly ON a clip edge is KEPT — that is what makes a shared wall
  // clip to a zero-area strip rather than to nothing on one side and a sliver on the other.
  const tri = [[0, 0], [100, 0], [0, 100]];
  const got = G.clip(rect(0, 0, 100, 100), tri);
  near(shoelace(got), 5000, 'clipping a square by a triangle gives the triangle');
  ok(G.clip(rect(500, 500, 10, 10), tri).length < 3, 'a subject nowhere near the clip yields nothing');
}

/* ---------------------------------------------------------- 6 · where it is surfaced */

console.log('\n6 · the three places it is reported');
{
  /* ⚠️ TEXTUAL, and deliberately so: these assert that the measurement is WIRED to a surface,
     which is the half of the feature the geometry above cannot prove. A correct overlap test
     nobody is shown is the same as no test at all, and the wiring is what a later refactor of
     either screen would drop silently. */

  // (a) the plan window — measured on every repaint, marked on the drawing, listed in a strip.
  ok(/var _ovs = zpOverlapsOf\(d\), _ovIds = \{\};/.test(src),
     '⚠️ the plan window measures the DRAFT on every repaint, not the saved plate');
  ok(src.indexOf("(_ovIds[q.id] ? ' ov' : '')") > 0,
     '⚠️ and marks each offending area ON the drawing, not only in a list');
  ok(src.indexOf("'<div class=\"zpw-ov\">'") > 0, 'the strip is emitted');
  ok(src.indexOf('data-zpov=') > 0 && /b\.onclick = function \(\) \{ W\.sel = b\.dataset\.zpov;/.test(src),
     '⚠️ each pair is a route to the fix — Show selects one of the two');
  /* ⚠️ The handler in full, because what must be ABSENT from it is the point: `snap()` would push
     an undo step and `commit()` would mark the setup dirty, and selecting a shape changes nothing
     about the drawing. Asserted on the body itself rather than on a window around it — a
     character count would sweep in the neighbouring Delete handler, which snapshots on purpose. */
  const ovHandler = /b\.onclick = function \(\) \{([^}]*)\};\s*\}\);/.exec(
    src.slice(src.indexOf("wrap.querySelectorAll('[data-zpov]')")));
  ok(!!ovHandler, 'the Show handler is where the suite expects it');
  ok(ovHandler && ovHandler[1].indexOf('snap()') < 0 && ovHandler[1].indexOf('commit()') < 0,
     '⚠️ selecting pushes no undo step and marks nothing dirty — it changes nothing about the drawing',
     ovHandler && ovHandler[1]);

  // (b) the floor row, so a forty-storey list can be read for faults without opening anything.
  ok(src.indexOf('var _ov = _p ? zpHasOverlap(_p) : false;') > 0,
     '⚠️ every floor row asks the question');
  ok(src.indexOf("(_ov ? ' ov' : '')") > 0 && src.indexOf('sbld-zpov') > 0,
     '⚠️⚠️ and reports it as a glyph AND a colour — colour alone is not a channel everyone has');

  // (c) the per-category panel, which is the altitude the work actually repeats on.
  ok(src.indexOf('nOv += ovFl.length;') > 0, 'the floor-plan panel counts the offending storeys');
  ok(src.indexOf("(nHave && !nOv ? '' : ' open')") > 0,
     '⚠️⚠️ an overlap forces the fold OPEN — a fault reported inside a fold nobody opens is not reported');
  ok(src.indexOf("(bare.length ? 'Draw\\u2026' : (ovFl.length ? 'Fix\\u2026' : 'Open\\u2026'))") > 0 ||
     src.indexOf("(ovFl.length ? 'Fix") > 0,
     'and the category button becomes the route to the worst floor once everything is drawn');

  /* ⚠️⚠️ IT WARNS, IT DOES NOT BLOCK, and that is asserted rather than left to be noticed. Half a
     trace IS an overlap — a planner drawing the second zone over the first and pulling its corners
     back is in this state for the whole of that gesture — so refusing to close the window or to
     save would make the ordinary way of drawing a floor impossible. */
  const closeFn = src.slice(src.indexOf('      m.close = function () {'), src.indexOf('      paint();\n      loadImg();'));
  ok(closeFn.length > 0 && closeFn.indexOf('zpOverlapsOf') < 0 && closeFn.indexOf('zpHasOverlap') < 0,
     '⚠️⚠️ closing the plan window is never refused over an overlap');
}

/* ---------------------------------------------------------- 7 · the contrast build */

console.log('\n7 · the pinned build must NOT have this');
{
  let base = '';
  try {
    base = execFileSync('git', ['show', BASE_SHA + ':modules/project-schedule/index.html'],
                        { cwd: ROOT, maxBuffer: 1 << 28 }).toString('utf8');
  } catch (e) { base = ''; }
  ok(!!base, 'the pinned build ' + BASE_SHA + ' could be read (a suite that cannot read it proves nothing)');
  if (base) {
    ok(base.indexOf('function zpInterArea(') < 0, '⚠️ ' + BASE_SHA + ' has no intersection-area test');
    ok(base.indexOf('function zpOverlapsOf(') < 0, '⚠️ ' + BASE_SHA + ' cannot find an overlapping pair');
    ok(base.indexOf('ZP_OV_TOL') < 0, '⚠️ and has no tolerance, because it had nothing to tolerate');
    ok(src.indexOf('function zpOverlapsOf(') > 0, 'and the shipped build does');
  }
}

/* ---------------------------------------------------------------- report */

console.log('');
if (fail) { fails.forEach(f => console.log('  FAIL: ' + f)); }
console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
