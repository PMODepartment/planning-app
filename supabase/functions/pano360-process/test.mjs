// test.js — genuinely EXECUTES stitch-core.mjs against synthetic fixtures
// with known ground truth. Run directly: `node test.js` (from this
// directory). No test framework, no build step — same convention as every
// other `test.js` in this repo (progress-photos/test.js, etc.).
//
// ⚠️ This is the one part of the whole pano360-process worker that CAN be
// verified by real execution in this environment: stitch-core.mjs has zero
// imports (no Deno, no jpeg-js, no Supabase client), so it runs identically
// under plain Node. What it does NOT prove: that jpeg-js decodes/encodes
// correctly inside Deno, that the Edge Function's HTTP/DB/Storage wiring is
// right, or that a real recorded phone video stitches into something that
// looks good. Those are structural/manual review only — see this module's
// own changelog entry for the honest split.

import * as SC from './stitch-core.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', name); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

// ---------------------------------------------------------------------------
// Build a synthetic "photo": a textured scene (not a flat gradient — a flat
// gradient has no real texture and would let a wrong offset score just as
// well as the right one, which would make this test pass for the wrong
// reason). Draws a grid of distinct-luminance blocks plus a few diagonal
// stripes so every region of the frame is genuinely distinguishable from its
// neighbours, the same reasoning this repo's own pano360.js test harnesses
// already use ("a rich checkerboard+circles+lines pattern").
// ---------------------------------------------------------------------------
function buildScene(sceneWidth, sceneHeight) {
  const rgba = new Uint8Array(sceneWidth * sceneHeight * 4);
  for (let y = 0; y < sceneHeight; y++) {
    for (let x = 0; x < sceneWidth; x++) {
      const i = (y * sceneWidth + x) * 4;
      const block = (((x / 17) | 0) + ((y / 13) | 0)) % 2;
      const stripe = ((x + y * 2) % 23 < 3) ? 60 : 0;
      const base = block ? 190 : 70;
      const v = Math.max(0, Math.min(255, base + stripe - ((x % 31) | 0)));
      rgba[i] = v;
      rgba[i + 1] = (v + 40) % 256;
      rgba[i + 2] = (255 - v);
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

// A "frame" is a crop of the wide scene at a given x-offset (and a small,
// known y-jitter) — simulating a camera panning across a much wider real
// scene, exactly the geometry this module's alignment search is built for.
function cropFrame(scene, sceneWidth, sceneHeight, frameWidth, frameHeight, x, y) {
  const out = new Uint8Array(frameWidth * frameHeight * 4);
  for (let fy = 0; fy < frameHeight; fy++) {
    const sy = Math.max(0, Math.min(sceneHeight - 1, y + fy));
    for (let fx = 0; fx < frameWidth; fx++) {
      const sx = Math.max(0, Math.min(sceneWidth - 1, x + fx));
      const si = (sy * sceneWidth + sx) * 4;
      const di = (fy * frameWidth + fx) * 4;
      out[di] = scene[si];
      out[di + 1] = scene[si + 1];
      out[di + 2] = scene[si + 2];
      out[di + 3] = 255;
    }
  }
  return out;
}

// ===========================================================================
// [1] toGrayscaleDownsampled — correct dimensions, correct luma
// ===========================================================================
{
  const w = 40, h = 20;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 100; rgba[i * 4 + 1] = 150; rgba[i * 4 + 2] = 200; rgba[i * 4 + 3] = 255;
  }
  const { width, height, gray } = SC.toGrayscaleDownsampled(rgba, w, h, 20);
  ok('[1] downsample halves width', width === 20);
  ok('[1] downsample scales height proportionally', height === 10);
  const expectedLuma = ((100 * 299 + 150 * 587 + 200 * 114) / 1000) | 0;
  ok('[1] luma matches Rec.601 weights', gray[0] === expectedLuma);
  ok('[1] every pixel uniform for a uniform source', gray.every((v) => v === expectedLuma));
}

// ===========================================================================
// [2] meanAbsDiff — zero for an exact match, grows for a mismatch, Infinity
//     when the requested shift leaves too little overlap to trust
// ===========================================================================
{
  const w = 30, h = 20;
  const a = new Uint8Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = (i * 37) % 256;
  ok('[2] identical images at dx=0 score 0', SC.meanAbsDiff(a, w, h, a, w, h, 0, 0) === 0);

  // A "pan right by 4px" frame: what curr sees at its own local x is what
  // prev saw 4px further along — curr[x] = prev[x+4] — which is exactly the
  // relationship `meanAbsDiff(prev, curr, dx=4, ...)` tests for (canvas
  // position j+dx holds curr's local pixel j, and must equal prev's own
  // pixel at that same canvas position since prev sits at offset 0).
  const shifted = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x + 4;
      shifted[y * w + x] = sx < w ? a[y * w + sx] : 0;
    }
  }
  // "shifted" placed at dx=4 relative to "a" should line back up exactly
  // over the region that truly overlaps (x in [4, w)).
  ok('[2] a real 4px shift scores 0 once corrected for', SC.meanAbsDiff(a, w, h, shifted, w, h, 4, 0) === 0);
  ok('[2] the SAME data at the WRONG shift scores > 0', SC.meanAbsDiff(a, w, h, shifted, w, h, 0, 0) > 0);

  const huge = SC.meanAbsDiff(a, w, h, a, w, h, w - 1, 0);
  ok('[2] a shift leaving almost no overlap is Infinity (too little overlap to trust)', huge === Infinity);
}

// ===========================================================================
// [3] estimateOffset — genuinely recovers a KNOWN horizontal pan from two
//     crops of one synthetic scene. This is the load-bearing test: if the
//     search is wrong, every downstream stage inherits a wrong placement.
// ===========================================================================
{
  const sceneW = 400, sceneH = 200;
  const scene = buildScene(sceneW, sceneH);
  const frameW = 120, frameH = 80;
  const trueDx = 18; // frame B's content is frame A's content shifted 18px to the right in the scene
  const trueDy = 2;
  const rgbaA = cropFrame(scene, sceneW, sceneH, frameW, frameH, 60, 40);
  const rgbaB = cropFrame(scene, sceneW, sceneH, frameW, frameH, 60 + trueDx, 40 + trueDy);

  const targetWidth = 96;
  const gA = SC.toGrayscaleDownsampled(rgbaA, frameW, frameH, targetWidth);
  const gB = SC.toGrayscaleDownsampled(rgbaB, frameW, frameH, targetWidth);
  const scale = gA.width / frameW;

  const res = SC.estimateOffset(gA.gray, gA.width, gA.height, gB.gray, gB.width, gB.height, { maxDx: 30, maxDy: 6 });
  const expectedDx = Math.round(trueDx * scale);
  const expectedDy = Math.round(trueDy * scale);
  ok(`[3] recovers the true horizontal shift (got dx=${res.dx}, want ~${expectedDx})`, approx(res.dx, expectedDx, 1));
  ok(`[3] recovers the true vertical jitter (got dy=${res.dy}, want ~${expectedDy})`, approx(res.dy, expectedDy, 1));
  ok('[3] a confident match is NOT flagged as fallback', res.fallback === false);
  ok('[3] a confident match scores well under the fallback threshold', res.score < SC.FALLBACK_SCORE_THRESHOLD);
}

// ===========================================================================
// [4] estimateOffset on genuinely disjoint noise — no shared content at all,
//     so the search must have nothing confident to report (the honest
//     failure case this module's own reporting is built around).
// ===========================================================================
{
  const w = 64, h = 40;
  const noiseA = new Uint8Array(w * h);
  const noiseB = new Uint8Array(w * h);
  // Deterministic pseudo-noise (no Math.random — a test must be reproducible).
  for (let i = 0; i < w * h; i++) {
    noiseA[i] = (i * 2654435761) % 256;
    noiseB[i] = ((i + 12345) * 40503) % 256;
  }
  const res = SC.estimateOffset(noiseA, w, h, noiseB, w, h, { maxDx: 20, maxDy: 4 });
  ok('[4] two unrelated frames are flagged fallback (no confident match)', res.fallback === true);
}

// ===========================================================================
// [5] rgbaToRgb — drops exactly the alpha channel, keeps RGB order/values
// ===========================================================================
{
  const rgba = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 128]);
  const rgb = SC.rgbaToRgb(rgba, 2, 1);
  ok('[5] output length is 2/3 of input (no alpha)', rgb.length === 6);
  ok('[5] pixel 0 RGB preserved', rgb[0] === 10 && rgb[1] === 20 && rgb[2] === 30);
  ok('[5] pixel 1 RGB preserved regardless of alpha value', rgb[3] === 40 && rgb[4] === 50 && rgb[5] === 60);
}

// ===========================================================================
// [5b] rgbToRgba — the exact inverse of rgbaToRgb (index.ts's JPEG-encode
//      boundary): RGB in, alpha=255 appended, and round-tripping through both
//      functions must be lossless for the colour channels.
// ===========================================================================
{
  const rgb = new Uint8Array([10, 20, 30, 40, 50, 60]);
  const rgba = SC.rgbToRgba(rgb, 2, 1);
  ok('[5b] output length is 4/3 of input (alpha added)', rgba.length === 8);
  ok('[5b] pixel 0 RGB preserved, alpha forced opaque', rgba[0] === 10 && rgba[1] === 20 && rgba[2] === 30 && rgba[3] === 255);
  ok('[5b] pixel 1 RGB preserved, alpha forced opaque', rgba[4] === 40 && rgba[5] === 50 && rgba[6] === 60 && rgba[7] === 255);

  const original = new Uint8Array([200, 5, 90, 1, 2, 3, 255, 254, 253]);
  const roundTripped = SC.rgbaToRgb(SC.rgbToRgba(original, 3, 1), 3, 1);
  let identical = true;
  for (let i = 0; i < original.length; i++) if (roundTripped[i] !== original[i]) identical = false;
  ok('[5b] rgbToRgba -> rgbaToRgb round-trips losslessly', identical);
}

// ===========================================================================
// [6] cumulativePlacements — deltas accumulate along the chain, frame 0 fixed
//     at the origin, scale factor applied consistently
// ===========================================================================
{
  const pairs = [{ dx: 10, dy: 1 }, { dx: 12, dy: -1 }, { dx: 9, dy: 0 }];
  const placements = SC.cumulativePlacements(pairs, 2); // composite is 2x alignment resolution
  ok('[6] four frames in, four placements out', placements.length === 4);
  ok('[6] frame 0 anchored at the origin', placements[0].x === 0 && placements[0].y === 0);
  ok('[6] frame 1 = first pair scaled', placements[1].x === 20 && placements[1].y === 2);
  ok('[6] frame 2 = running sum of pairs 0+1, scaled', placements[2].x === 44 && placements[2].y === 0);
  ok('[6] frame 3 = running sum of all three pairs, scaled', placements[3].x === 62 && placements[3].y === 0);
}

// ===========================================================================
// [7] computeBounds — correct min/max across a set of placed frames,
//     including a frame placed at a NEGATIVE offset (a small backward jitter
//     must not be silently clipped out of the bounds)
// ===========================================================================
{
  const placements = [{ x: 0, y: 0 }, { x: 50, y: -5 }, { x: -10, y: 8 }];
  const b = SC.computeBounds(placements, 100, 60);
  ok('[7] minX accounts for the negative-offset frame', b.minX === -10);
  ok('[7] minY accounts for the negative-offset frame', b.minY === -5);
  ok('[7] maxX is the rightmost frame edge', b.maxX === 150); // 50 + 100
  ok('[7] maxY is the tallest frame bottom edge', b.maxY === 68); // 8 + 60
  ok('[7] width/height derived correctly', b.width === 160 && b.height === 73);
}

// ===========================================================================
// [7b] capScaleFactor — index.ts's composite-size guard: no-op when already
//      within bounds, scales down preserving aspect ratio when not, and never
//      returns MORE than 1 (never upscales).
// ===========================================================================
{
  ok('[7b] fits within bounds already -> scale factor 1 (no-op)', SC.capScaleFactor(800, 600, 3600, 1200) === 1);
  ok('[7b] exactly at the bound -> still 1', SC.capScaleFactor(3600, 1200, 3600, 1200) === 1);

  const s1 = SC.capScaleFactor(7200, 1000, 3600, 1200); // width is the binding constraint
  ok('[7b] width-bound case scales to exactly half', s1 === 0.5);

  const s2 = SC.capScaleFactor(1000, 2400, 3600, 1200); // height is the binding constraint
  ok('[7b] height-bound case scales to exactly half', s2 === 0.5);

  const s3 = SC.capScaleFactor(10000, 10000, 3600, 1200);
  ok('[7b] both dimensions over -> the SMALLER (more restrictive) ratio wins',
    approx(s3, 1200 / 10000, 0.0001));
  ok('[7b] applying the returned factor brings both dimensions within bounds',
    10000 * s3 <= 3600.0001 && 10000 * s3 <= 1200.0001);

  ok('[7b] never returns a factor above 1 even for a tiny input', SC.capScaleFactor(10, 10, 3600, 1200) === 1);
}

// ===========================================================================
// [8] pasteFrame — clips to canvas bounds (never throws/wraps), feathers the
//     left edge correctly, and a feather of 0 makes a hard, unblended cut
// ===========================================================================
{
  // 8a: out-of-bounds paste (partially off both edges) does not throw and
  // only writes the pixels that genuinely land on the canvas.
  const cw = 10, ch = 10;
  const canvas = SC.makeCanvas(cw, ch, [0, 0, 0]);
  const frame = SC.makeCanvas(6, 6, [255, 255, 255]);
  let threw = false;
  try {
    SC.pasteFrame(canvas, cw, ch, frame, 6, 6, -3, 7, 0); // top-left corner off-canvas left, bottom mostly off-canvas
  } catch (e) { threw = true; }
  ok('[8a] an out-of-bounds paste does not throw', !threw);
  // The frame's local (4,1) maps to canvas (1,8), which is on-canvas and should be white.
  ok('[8a] the part that lands on-canvas is written', canvas[(8 * cw + 1) * 3] === 255);
  // The frame's local (0,0) maps to canvas (-3,7) — off-canvas, must be untouched (still black).
  // Canvas (7,7) (unrelated pixel) must stay untouched too.
  ok('[8a] pixels the frame never reaches stay at background', canvas[(7 * cw + 7) * 3] === 0);

  // 8b: feathering blends proportionally across the declared width, and a
  // featherPx of 0 makes a hard cut with no blending at all.
  const bg = SC.makeCanvas(20, 4, [0, 0, 0]);
  const fg = SC.makeCanvas(10, 4, [200, 200, 200]);
  SC.pasteFrame(bg, 20, 4, fg, 10, 4, 0, 0, 5); // feather only the first 5 of 10 columns
  const halfway = bg[(0 * 20 + 2) * 3]; // x=2 of a 5px feather => alpha 0.4
  ok('[8b] a point inside the feather zone is partially blended', approx(halfway, 80, 15));
  ok('[8b] the edge PAST the feather zone is fully opaque', bg[(0 * 20 + 9) * 3] === 200);

  const hard = SC.makeCanvas(20, 4, [0, 0, 0]);
  SC.pasteFrame(hard, 20, 4, fg, 10, 4, 0, 0, 0);
  ok('[8c] featherPx=0 is a hard cut — the very first column is already fully opaque', hard[0] === 200);
}

// ===========================================================================
// [8d] pasteFrame — SIGNED featherPx picks which edge is feathered. Audit
//      finding: the shipped function always feathered the frame's own LEFT
//      edge regardless of which way the frame actually moved relative to
//      the previous one — correct for an ordinary rightward pan (the
//      overlap IS on the left edge), silently wrong for a leftward pan or a
//      momentary backward wobble (the overlap is on the RIGHT edge, and
//      feathering the left edge there blends into nothing while hard-
//      cutting the edge that actually needed it). A negative featherPx now
//      feathers the RIGHT |featherPx| columns instead.
// ===========================================================================
{
  // A canvas already filled with "existing content" (value 100), simulating
  // whatever was pasted before this frame.
  const w = 20, h = 4, fw = 10;
  const existing = 100, incoming = 200, mag = 5;
  const fg2 = SC.makeCanvas(fw, h, [incoming, incoming, incoming]);

  const rightFeathered = SC.makeCanvas(w, h, [existing, existing, existing]);
  SC.pasteFrame(rightFeathered, w, h, fg2, fw, h, 0, 0, -mag); // negative == feather the RIGHT edge
  // Far from the feathered edge (column 0): fully the new frame.
  ok('[8d] right-feather: a column far from the feathered edge is fully opaque (new frame)',
    rightFeathered[0] === incoming);
  // The very last column (x = fw-1 = 9): a is driven to 0, so it reads as
  // fully the EXISTING content — the seam blends into what was already
  // there, rather than hard-cutting over it.
  ok('[8d] right-feather: the very last column blends fully back to the existing content',
    rightFeathered[(0 * w + 9) * 3] === existing);
  // A column inside the feather zone (x=8, one step in from the edge) is a
  // genuine partial blend, not one extreme or the other.
  const midRight = rightFeathered[(0 * w + 8) * 3];
  ok(`[8d] right-feather: a column inside the feather zone is genuinely blended (got ${midRight})`,
    midRight > existing && midRight < incoming);

  // A positive featherPx of the same magnitude still feathers the LEFT edge
  // exactly as before this fix — the default/original behaviour is
  // unchanged for the ordinary rightward-pan case.
  const leftFeathered = SC.makeCanvas(w, h, [existing, existing, existing]);
  SC.pasteFrame(leftFeathered, w, h, fg2, fw, h, 0, 0, mag);
  ok('[8d] left-feather (unchanged default): the very FIRST column blends back to the existing content',
    leftFeathered[0] === existing);
  ok('[8d] left-feather (unchanged default): a column past the feather zone is fully opaque',
    leftFeathered[(0 * w + 9) * 3] === incoming);

  // ---- The actual bug, reproduced: the PRE-FIX formula (feather the left
  // edge unconditionally, `featherPx > 0 && x < featherPx`) is replayed
  // here against the exact same inputs used above. Fed the same NEGATIVE
  // featherPx meant to signal "feather the right edge", the old formula's
  // `featherPx > 0` guard is false for every column, so it silently
  // degrades to a hard cut with NO feathering at all — the seam this fix
  // exists to blend is left as a hard edge, reproducing the defect this
  // fix corrects. ----
  function preFixPasteFrame(canvas, cw, ch, frameRgb, fw2, fh2, offsetX, offsetY, featherPx) {
    for (let y = 0; y < fh2; y++) {
      const cy = offsetY + y;
      if (cy < 0 || cy >= ch) continue;
      for (let x = 0; x < fw2; x++) {
        const cx = offsetX + x;
        if (cx < 0 || cx >= cw) continue;
        const si = (y * fw2 + x) * 3;
        const di = (cy * cw + cx) * 3;
        let a = 1;
        if (featherPx > 0 && x < featherPx) a = x / featherPx;
        if (a >= 1) {
          canvas[di] = frameRgb[si]; canvas[di + 1] = frameRgb[si + 1]; canvas[di + 2] = frameRgb[si + 2];
        } else {
          canvas[di] = (canvas[di] * (1 - a) + frameRgb[si] * a) | 0;
          canvas[di + 1] = (canvas[di + 1] * (1 - a) + frameRgb[si + 1] * a) | 0;
          canvas[di + 2] = (canvas[di + 2] * (1 - a) + frameRgb[si + 2] * a) | 0;
        }
      }
    }
  }
  const preFixCanvas = SC.makeCanvas(w, h, [existing, existing, existing]);
  preFixPasteFrame(preFixCanvas, w, h, fg2, fw, h, 0, 0, -mag);
  ok('[8d] CONTRAST — the pre-fix formula given the same negative featherPx hard-cuts instead (the bug, reproduced)',
    preFixCanvas[(0 * w + 9) * 3] === incoming);
  ok('[8d] the shipped fix genuinely differs from the pre-fix formula on this exact input',
    rightFeathered[(0 * w + 9) * 3] !== preFixCanvas[(0 * w + 9) * 3]);
}

// ===========================================================================
// [8e] index.ts — structural check that the compositing step reads the
//      pair's own dx sign and passes a SIGNED featherPx through to
//      pasteFrame, rather than always calling it with the same positive
//      magnitude (which would silently reintroduce the [8d] bug). This is
//      the one part of the fix that can't be executed directly in Node
//      (index.ts is Deno-only, imports `@supabase/supabase-js` from
//      esm.sh) — a source check on the exact shipped call site.
// ===========================================================================
{
  const indexTsPath = fileURLToPath(new URL('./index.ts', import.meta.url));
  const src = readFileSync(indexTsPath, 'utf8');
  ok('[8e] the compositing step reads the previous pair\'s own dx before choosing a feather sign',
    /offsets\[cursor\s*-\s*1\]/.test(src));
  ok('[8e] a negative pair dx flips the feather sign (so pasteFrame is told which edge to feather)',
    /pairDx\s*<\s*0\s*\?\s*-featherMag\s*:\s*featherMag/.test(src));
  ok('[8e] pasteFrame is called with the derived SIGNED value, not the bare magnitude',
    /pasteFrame\([^)]*featherPx\)/.test(src) && !/pasteFrame\([^)]*featherMag\)/.test(src));
}

// ===========================================================================
// [8f] The cylindrical-warp gap found on the 2026-09-16 audit is DOCUMENTED,
//      not silently absent. This never proves the geometry is right — a
//      cylindrical warp isn't implemented at all — it only proves the next
//      reader isn't left to rediscover a known, real gap from scratch. See
//      the header comment in stitch-core.mjs for the full reasoning.
// ===========================================================================
{
  const stitchCorePath = fileURLToPath(new URL('./stitch-core.mjs', import.meta.url));
  const src = readFileSync(stitchCorePath, 'utf8');
  ok('[8f] the file states there is no cylindrical reprojection step',
    /no cylindrical[\s\S]{0,20}reprojection step/i.test(src));
  ok('[8f] the file names the client pipeline\'s own 2026-09-12 fix as the precedent for this gap',
    /2026-09-12/.test(src) && /cylindrical/i.test(src));
  ok('[8f] the file states why a from-scratch remap was not shipped this round (unverifiable here)',
    /NOT.{0,40}implemented from scratch/is.test(src));
}

// ===========================================================================
// [9] centerCropRect / cropRgb / resizeRgbNearest — the thumbnail path
// ===========================================================================
{
  // A wide (16:9-ish) source crops down to 4:3 by trimming width, not height.
  const rect = SC.centerCropRect(400, 200, SC.THUMB_ASPECT);
  ok('[9a] a wide source keeps full height', rect.height === 200);
  ok('[9a] a wide source crops width to the 4:3 ratio', rect.width === Math.round(200 * SC.THUMB_ASPECT));
  ok('[9a] the crop is centred horizontally', rect.x === Math.round((400 - rect.width) / 2) && rect.y === 0);

  // A tall source crops down to 4:3 by trimming height, not width.
  const rectTall = SC.centerCropRect(200, 500, SC.THUMB_ASPECT);
  ok('[9b] a tall source keeps full width', rectTall.width === 200);
  ok('[9b] a tall source crops height to the 4:3 ratio', rectTall.height === Math.round(200 / SC.THUMB_ASPECT));

  // cropRgb actually extracts the right pixels, not just the right rect.
  const w = 6, h = 4;
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = i; rgb[i * 3 + 1] = i; rgb[i * 3 + 2] = i; }
  const crop = SC.cropRgb(rgb, w, h, { x: 2, y: 1, width: 3, height: 2 });
  // Source pixel at (2,1) has linear index 1*6+2 = 8, so crop[0] should be 8.
  ok('[9c] cropRgb extracts the correct source pixel at the crop origin', crop[0] === 8);

  // resizeRgbNearest changes only the sampling grid, never invents colours.
  const small = SC.resizeRgbNearest(rgb, w, h, 3, 2);
  ok('[9d] resize produces the requested output size', small.length === 3 * 2 * 3);
  ok('[9d] every resized pixel value came from the source (no interpolation artefacts)', Array.from(small).every((v) => Array.from(rgb).includes(v)));
}

// ===========================================================================
// [10] END-TO-END: align + composite a full 6-frame synthetic pan in one
//      Node process, proving the low-level pieces compose correctly. The
//      chunked worker (index.ts) calls these same functions split across
//      many invocations — this proves the MATH, not the chunking/HTTP glue.
// ===========================================================================
{
  const sceneW = 1200, sceneH = 300;
  const scene = buildScene(sceneW, sceneH);
  const frameW = 200, frameH = 150;
  const trueStepDx = 45; // each frame pans 45px further right in the scene
  const frameCount = 6;
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push(cropFrame(scene, sceneW, sceneH, frameW, frameH, 100 + i * trueStepDx, 75));
  }

  const alignWidth = 96;
  const grays = frames.map((f) => SC.toGrayscaleDownsampled(f, frameW, frameH, alignWidth));
  const pairOffsets = [];
  let fallbackCount = 0;
  for (let i = 1; i < frameCount; i++) {
    const prev = grays[i - 1];
    const curr = grays[i];
    const r = SC.estimateOffset(prev.gray, prev.width, prev.height, curr.gray, curr.width, curr.height, { maxDx: 30, maxDy: 4 });
    if (r.fallback) fallbackCount++;
    pairOffsets.push(r);
  }
  ok('[10] all 5 pairs of a clean synthetic pan align confidently', fallbackCount === 0);

  const compositeFrameW = 200; // same as source here — no extra scaling for this test
  const scaleFactor = compositeFrameW / grays[0].width;
  const placements = SC.cumulativePlacements(pairOffsets, scaleFactor);
  ok('[10] one placement per frame', placements.length === frameCount);

  const expectedTotalDx = trueStepDx * (frameCount - 1);
  ok(`[10] the LAST frame's cumulative placement matches the true total pan (got ${placements[frameCount - 1].x}, want ~${expectedTotalDx})`,
    approx(placements[frameCount - 1].x, expectedTotalDx, 6));

  const bounds = SC.computeBounds(placements, frameW, frameH);
  const canvas = SC.makeCanvas(bounds.width, bounds.height, [30, 30, 30]);
  for (let i = 0; i < frameCount; i++) {
    const rgb = SC.rgbaToRgb(frames[i], frameW, frameH);
    const ox = placements[i].x - bounds.minX;
    const oy = placements[i].y - bounds.minY;
    SC.pasteFrame(canvas, bounds.width, bounds.height, rgb, frameW, frameH, ox, oy, i === 0 ? 0 : 24);
  }
  // The composite must be noticeably WIDER than a single frame (proves the
  // frames actually landed side-by-side, not stacked on top of each other).
  // Expected span: ~frameW + trueStepDx*(frameCount-1) = 200 + 225 = 425.
  ok('[10] the composite is wider than a single source frame', bounds.width > frameW * 2);
  // No pixel should be left at the untouched background colour in the
  // region every frame's own placement covers, i.e. compositing actually
  // painted something everywhere it was supposed to.
  const midY = Math.floor(bounds.height / 2);
  let stillBackground = 0;
  for (let x = 0; x < bounds.width; x++) {
    const i = (midY * bounds.width + x) * 3;
    if (canvas[i] === 30 && canvas[i + 1] === 30 && canvas[i + 2] === 30) stillBackground++;
  }
  ok(`[10] the composite's covered region is actually painted (${stillBackground} untouched px out of ${bounds.width})`, stillBackground < bounds.width * 0.05);
}

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
