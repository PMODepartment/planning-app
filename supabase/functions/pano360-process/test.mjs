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
  // ⚠ ROUNDED, not truncated — changed with the box prefilter (2026-09-17).
  // Truncating every sample biases the whole grayscale image down by an average
  // of half a level, which is a systematic offset on a signal whose per-pair
  // differences are then summed along a 100+ frame chain. The value here is the
  // arithmetic, not a fudge: 140.75 rounds to 141.
  const expectedLuma = Math.round((100 * 299 + 150 * 587 + 200 * 114) / 1000);
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
  // ⚠️⚠️ 2026-09-17 — RETARGETED, and the reason matters more than the new
  // assertions do. These three used to pin the SIGNED-feather fix: with whole
  // frames pasted over each other, the feather had to know which edge of the
  // incoming frame overlapped the canvas, and getting the sign wrong put a
  // hard seam exactly where the blend was supposed to be. Band compositing
  // (pasteFrameBand) removes that question entirely — a frame now contributes
  // only the slice between the midpoints to its neighbours, feathered at BOTH
  // ends, so there is no single overlapping edge to pick. Keeping the old
  // assertions would pin a mechanism the file no longer has; what replaces
  // them pins the property the old ones were protecting (no hard seam) in the
  // terms the new compositor actually works in.
  ok('[8e] the compositing step pastes a centre BAND, not a whole frame — so the panorama is built from each frame\'s sharp middle rather than its soft leading edge',
    /pasteFrameBand\(/.test(src) && !/\bpasteFrame\(/.test(src));
  ok('[8e] the band is derived from the neighbouring placements (bandForFrame), so consecutive bands meet at the midpoint and overlap only by the feather',
    /bandForFrame\(placements, cursor, state\.frameWidth, featherPx\)/.test(src));
  ok('[8e] the WHOLE placement chain is rebuilt each step, not truncated at the cursor — bandForFrame needs the NEXT frame\'s placement or every frame pastes to its own right edge',
    /cumulativePlacementsClamped\(keptOffsets, state\.scaleFactor, state\.driftClamp\)/.test(src) &&
    /const keptOffsets = offsets\.slice\(0, Math\.max\(0, state\.keepFrames - 1\)\)/.test(src));
}

// ===========================================================================
// [8f] The cylindrical-warp gap the 2026-09-16 audit recorded is CLOSED, and
//      stays closed. These are structural assertions only — the geometry
//      itself is proved by executing the pipeline against a known scene in
//      section [11]; this block only guards against the warp being removed or
//      the file going back to claiming it does not reproject.
// ===========================================================================
{
  const stitchCorePath = fileURLToPath(new URL('./stitch-core.mjs', import.meta.url));
  const src = readFileSync(stitchCorePath, 'utf8');
  // ⚠️⚠️ 2026-09-17 — THE GAP THESE ASSERTIONS DOCUMENTED IS NOW CLOSED, so
  // they assert its ABSENCE instead of its presence. The 2026-09-16 note they
  // were written for said the cylindrical warp must not be shipped on
  // inspection alone and asked for "a SYNTHETIC rotating-camera test scene"
  // first. That harness is section [11] below, and it is what the warp was
  // developed against.
  ok('[8f] the cylindrical warp exists and is exported',
    /export function warpToCylindrical\(/.test(src) && /export function cylindricalDims\(/.test(src));
  ok('[8f] the equirectangular conversion exists — the viewer declares the image equirectangular, so the pipeline has to actually produce one',
    /export function cylStripToEquirect\(/.test(src));
  ok('[8f] the file no longer claims there is no cylindrical reprojection step',
    !/there is no[\s\S]{0,40}cylindrical reprojection step/i.test(src));
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

// ===========================================================================
// [11] THE SYNTHETIC ROTATING-CAMERA HARNESS.
//
// ⚠️⚠️ THIS SECTION IS THE PRECONDITION THE 2026-09-16 AUDIT NOTE SET FOR
// SHIPPING ANY CYLINDRICAL-WARP ARITHMETIC AT ALL: "build an isolated harness
// with a SYNTHETIC rotating-camera test scene ... do not ship it on inspection
// alone." It renders perspective frames out of a KNOWN equirectangular scene
// at KNOWN yaw angles — the real geometry of a planner standing in one spot
// and turning — pushes them through the actual shipped pipeline, and compares
// the recovered panorama against the ground truth it came from.
//
// It is also the only thing that caught two real bugs during development, and
// neither was visible by reading the code:
//   • the strip is `rotation + HFOV` wide, not `rotation` — mapping all of it
//     onto 360° was a silent ~18% horizontal scale error (see fullTurnCrop);
//   • cropping the drift band by the CLAMP rather than by where the frames
//     actually landed left a thin black strip on a capture that wobbles.
// ===========================================================================
{
  const TAU = Math.PI * 2;
  const SW = 720, SH = 360;              // ground-truth equirectangular scene
  const HFOV = 65 * Math.PI / 180;
  const FW = 160, FH = 120;              // small frames — this has to run fast
  const ALIGN_W = 120;

  // Smooth, globally-unique scene. Deliberately LOW frequency: the metric
  // below is a mean absolute difference, and a fine checkerboard would be
  // dominated by sub-pixel phase rather than by geometry, which is exactly how
  // a correct stitch can be made to look wrong (and a wrong one right).
  const scene = new Uint8Array(SW * SH * 3);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const i = (y * SW + x) * 3, lon = (x / SW) * TAU;
      scene[i] = 128 + 100 * Math.sin(lon * 3) * Math.cos((y / SH) * TAU);
      scene[i + 1] = 128 + 100 * Math.sin(lon * 5 + 1.1);
      scene[i + 2] = 128 + 100 * Math.cos(lon * 2 + (y / SH) * 4);
    }
  }
  function sampleScene(lon, lat, out) {
    let u = (lon / TAU + 0.5) * SW;
    u = ((u % SW) + SW) % SW;
    const v = Math.max(0, Math.min(SH - 1, (0.5 - lat / Math.PI) * SH));
    const x0 = Math.floor(u), y0 = Math.floor(v), x1 = (x0 + 1) % SW, y1 = Math.min(SH - 1, y0 + 1);
    const fx = u - x0, fy = v - y0;
    for (let c = 0; c < 3; c++) {
      out[c] = scene[(y0 * SW + x0) * 3 + c] * (1 - fx) * (1 - fy)
        + scene[(y0 * SW + x1) * 3 + c] * fx * (1 - fy)
        + scene[(y1 * SW + x0) * 3 + c] * (1 - fx) * fy
        + scene[(y1 * SW + x1) * 3 + c] * fx * fy;
    }
    return out;
  }
  // A real perspective camera at yaw ψ (and an optional pitch wobble) — the
  // INVERSE of what the pipeline has to undo.
  function renderFrame(yaw, pitch) {
    const f = (FW / 2) / Math.tan(HFOV / 2);
    const out = new Uint8Array(FW * FH * 3);
    const cx = (FW - 1) / 2, cy = (FH - 1) / 2;
    const cp = Math.cos(pitch || 0), sp = Math.sin(pitch || 0);
    const px = [0, 0, 0];
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const X = x - cx, Y0 = y - cy, Z0 = f;
        const Y = Y0 * cp - Z0 * sp, Z = Y0 * sp + Z0 * cp;
        const Xw = X * Math.cos(yaw) + Z * Math.sin(yaw);
        const Zw = -X * Math.sin(yaw) + Z * Math.cos(yaw);
        sampleScene(Math.atan2(Xw, Zw), Math.atan2(-Y, Math.hypot(Xw, Zw)), px);
        const di = (y * FW + x) * 3;
        out[di] = px[0]; out[di + 1] = px[1]; out[di + 2] = px[2];
      }
    }
    return out;
  }
  const toGray = (rgb, w, h) => {
    const g = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 3) g[i] = ((rgb[j] * 299 + rgb[j + 1] * 587 + rgb[j + 2] * 114) / 1000) | 0;
    return g;
  };

  // The shipped pipeline, in the same order index.ts runs it.
  function run(turnDeg, n, pitchJitter, useWarp) {
    const frames = [];
    for (let i = 0; i < n; i++) frames.push(renderFrame((turnDeg * Math.PI / 180) * i / (n - 1), Math.sin(i * 0.6) * (pitchJitter || 0)));
    const alignCyl = SC.cylindricalDims(ALIGN_W, Math.round((FH * ALIGN_W) / FW), HFOV);
    let offsets, alignWidth, focalAlign, warped, cw, ch;
    if (useWarp) {
      const small = frames.map((f) => SC.warpRgbaToCylindricalGray(SC.rgbToRgba(f, FW, FH), FW, FH, ALIGN_W, HFOV));
      offsets = [];
      for (let i = 0; i + 1 < small.length; i++) {
        offsets.push(SC.estimateOffset(small[i].gray, small[i].width, small[i].height, small[i + 1].gray, small[i + 1].width, small[i + 1].height, { maxDx: 40, maxDy: 5, subPixel: true }));
      }
      alignWidth = alignCyl.width; focalAlign = alignCyl.focal;
      warped = frames.map((f) => SC.warpToCylindrical(f, FW, FH, HFOV));
      cw = warped[0].width; ch = warped[0].height;
    } else {
      // The BEFORE pipeline, for contrast: no warp, whole-frame paste,
      // unbounded vertical drift — exactly what shipped before this round.
      const small = frames.map((f) => SC.toGrayscaleDownsampled(SC.rgbToRgba(f, FW, FH), FW, FH, ALIGN_W));
      offsets = [];
      for (let i = 0; i + 1 < small.length; i++) {
        offsets.push(SC.estimateOffset(small[i].gray, small[i].width, small[i].height, small[i + 1].gray, small[i + 1].width, small[i + 1].height, { maxDx: 40, maxDy: 5, subPixel: true }));
      }
      alignWidth = ALIGN_W; focalAlign = (ALIGN_W / 2) / Math.tan(HFOV / 2);
      warped = frames.map((f) => ({ rgb: f, width: FW, height: FH, focal: (FW / 2) / Math.tan(HFOV / 2) }));
      cw = FW; ch = FH;
    }
    const sf = cw / alignWidth;
    const keep = Math.min(n, SC.framesForFullTurn(offsets, focalAlign));
    const kept = offsets.slice(0, keep - 1);
    const clamp = Math.max(1, Math.round(ch * 0.02));
    const pl = useWarp ? SC.cumulativePlacementsClamped(kept, sf, clamp) : SC.cumulativePlacements(kept, sf);
    const b = SC.computeBounds(pl, cw, ch);
    const canvas = SC.makeCanvas(b.width, b.height, [20, 20, 20]);
    const feather = Math.max(1, Math.round(cw * (useWarp ? 0.02 : 0.12)));
    for (let i = 0; i < keep; i++) {
      if (useWarp) {
        const bd = SC.bandForFrame(pl, i, cw, feather);
        SC.pasteFrameBand(canvas, b.width, b.height, warped[i].rgb, cw, ch, pl[i].x - b.minX, pl[i].y - b.minY, bd.x0, bd.x1, feather);
      } else {
        SC.pasteFrame(canvas, b.width, b.height, warped[i].rgb, cw, ch, pl[i].x - b.minX, pl[i].y - b.minY, i === 0 ? 0 : feather);
      }
    }
    let y0 = 0, hh = b.height;
    if (useWarp) {
      const ys = pl.map((q) => q.y);
      y0 = Math.max(...ys) - b.minY;
      hh = Math.max(1, Math.min(...ys) + ch - b.minY - y0);
    }
    const strip = SC.cropRgb(canvas, b.width, b.height, { x: 0, y: y0, width: b.width, height: hh });
    let bg = 0;
    for (let i = 0; i < strip.length; i += 3) if (strip[i] === 20 && strip[i + 1] === 20 && strip[i + 2] === 20) bg++;
    const equi = SC.cylStripToEquirect(strip, b.width, hh, warped[0].focal, (hh - 1) / 2, 720);
    return { equi, keep, n, bgPct: (100 * bg) / (b.width * hh), coverageDeg: Math.abs(SC.coverageYaw(offsets, focalAlign)) * 180 / Math.PI };
  }

  // Ground truth at the recovered panorama's own size and vertical field. The
  // capture starts at an arbitrary yaw, so the comparison searches the whole
  // width for the phase — ⚠️ a narrow search here reports a CORRECT stitch as
  // badly wrong, which cost a full diagnostic pass during development.
  function bestDiff(equi) {
    const vaov = (equi.height / equi.width) * TAU, phiMax = vaov / 2, px = [0, 0, 0];
    const at = (x, y, sx, sy) => {
      const phi = phiMax - ((y + sy) / equi.height) * vaov;
      return sampleScene(((x + sx) / equi.width) * TAU - Math.PI, phi, px);
    };
    const score = (sx, sy) => {
      let s = 0, c = 0;
      for (let y = 2; y < equi.height - 2; y += 3) {
        for (let x = 0; x < equi.width; x += 3) {
          const g = at(x, y, sx, sy);
          for (let k = 0; k < 3; k++) { s += Math.abs(equi.rgb[(y * equi.width + x) * 3 + k] - g[k]); c++; }
        }
      }
      return s / c;
    };
    let best = { v: Infinity, sx: 0, sy: 0 };
    for (let sx = 0; sx < equi.width; sx += 6) for (let sy = -4; sy <= 4; sy += 1) { const v = score(sx, sy); if (v < best.v) best = { v, sx, sy }; }
    for (let sx = best.sx - 6; sx <= best.sx + 6; sx += 1) for (let sy = best.sy - 1; sy <= best.sy + 1; sy += 0.5) { const v = score(sx, sy); if (v < best.v) best = { v, sx, sy }; }
    return best.v;
  }

  const after = run(360, 48, 0, true);
  const before = run(360, 48, 0, false);
  const wobble = run(360, 48, 0.035, true);
  const over = run(430, 48, 0, true);

  ok(`[11] a full turn recovers the scene it was rendered from (mean abs diff ${after.d = bestDiff(after.equi).toFixed(2)}/255 — the scene's own contrast is ~64)`,
    (after.d = +after.d) < 4);
  ok(`[11] …and the un-warped pipeline this replaces does NOT (${before.d = bestDiff(before.equi).toFixed(2)}/255), so the metric genuinely discriminates`,
    +before.d > +after.d * 8);
  ok(`[11] the panorama has NO uncovered pixels (${after.bgPct.toFixed(2)}% background)`, after.bgPct < 0.01);
  ok(`[11] …while the un-warped pipeline leaves real holes (${before.bgPct.toFixed(2)}%) — the owner's "black space"`, before.bgPct > 1);
  ok(`[11] a capture that WOBBLES vertically still has no uncovered pixels (${wobble.bgPct.toFixed(2)}%) — the covered-band crop, not the drift clamp, is what guarantees this`,
    wobble.bgPct < 0.01);
  ok(`[11] …and still recovers the scene (${wobble.d = bestDiff(wobble.equi).toFixed(2)}/255)`, +wobble.d < 4);
  ok(`[11] the measured coverage of a true 360° turn is accurate (${after.coverageDeg.toFixed(0)}°)`,
    Math.abs(after.coverageDeg - 360) < 8);
  ok(`[11] OVER-ROTATION IS TRIMMED: a 430° capture keeps ${over.keep} of ${over.n} frames, not all of them`,
    over.keep < over.n && over.keep > over.n * 0.6);
  ok(`[11] …and the trimmed panorama is still a correct one (${over.d = bestDiff(over.equi).toFixed(2)}/255), not merely shorter`, +over.d < 6);
  ok(`[11] …and it too has no uncovered pixels (${over.bgPct.toFixed(2)}%)`, over.bgPct < 0.01);
  ok('[11] the output is LANDSCAPE and wider than 2:1 — a panorama, never the bowed arc it replaced',
    after.equi.width / after.equi.height > 2);
}

// ===========================================================================
// [12] THE 2026-09-17 SECOND PASS — the owner's three reports against the
//      first one: "a deadspace connecting the start and finish of the video
//      recording", "line streaks vertically across", "still blurry and
//      misaligned areas".
//
// Each block below reproduces the DEFECT first (so the metric is known to
// bite) and then the fix, on the same input. Where the old behaviour is a
// four-line rule it is re-stated inline and labelled as such rather than
// imported, so a reader can see exactly what changed without a second file.
// ===========================================================================
{
  // -------------------------------------------------------------------------
  // [12a] THE DEADSPACE. The canvas spans min(x)..max(x)+frameWidth over ALL
  // placements, so the frame that owns an edge is the SPATIAL extreme — which
  // on a hand-held capture is very often not the first or last frame in time.
  // Model: a planner presses record, settles backward for three frames, then
  // turns. Pure placement arithmetic; no pixels needed.
  // -------------------------------------------------------------------------
  const FW = 570;
  const FEATHER = Math.max(1, Math.round(FW * 0.02));
  const FOCAL = 502.3;
  const N = 108;
  const DEG = Math.PI / 180;

  // THE RULE THIS REPLACED, restated so the contrast is visible: first/last in
  // TIME got the frame's own outer edge.
  function bandOld(pl, i, fw, feather) {
    const c = fw / 2;
    const here = pl[i].x;
    const prev = i > 0 ? pl[i - 1].x : null;
    const next = i < pl.length - 1 ? pl[i + 1].x : null;
    const x0 = prev === null ? 0 : c - Math.abs(here - prev) / 2 - feather;
    const x1 = next === null ? fw : c + Math.abs(next - here) / 2 + feather;
    return { x0: Math.max(0, x0), x1: Math.min(fw, Math.max(x0 + 1, x1)) };
  }
  function uncovered(pl, bandFn) {
    const minX = Math.min(...pl.map((p) => p.x));
    const maxX = Math.max(...pl.map((p) => p.x)) + FW;
    const W = Math.ceil(maxX - minX);
    const cov = new Uint8Array(W);
    for (let i = 0; i < pl.length; i++) {
      const b = bandFn(pl, i, FW, FEATHER);
      const s = Math.max(0, Math.floor(pl[i].x - minX + b.x0));
      const e = Math.min(W, Math.ceil(pl[i].x - minX + b.x1));
      for (let x = s; x < e; x++) cov[x] = 1;
    }
    let total = 0;
    let left = 0;
    let right = 0;
    for (let x = 0; x < W; x++) if (!cov[x]) total++;
    while (left < W && !cov[left]) left++;
    while (right < W && !cov[W - 1 - right]) right++;
    return { W, total, left, right };
  }
  const yawTo = (f) => { const a = []; for (let i = 0; i < N; i++) a.push({ x: Math.round(f(i) * FOCAL), y: 0 }); return a; };
  const monotonic = yawTo((i) => 360 * DEG * i / (N - 1));
  const settleStart = yawTo((i) => (i < 4 ? -2.0 * DEG * Math.min(i, 3) : 360 * DEG * (i - 3) / (N - 4) - 6 * DEG));
  const driftEnd = yawTo((i) => (i > N - 5 ? 360 * DEG + 2.0 * DEG * (N - 1 - i) : 360 * DEG * i / (N - 5)));

  const leftward = yawTo((i) => -360 * DEG * i / (N - 1));

  const oldLeft = uncovered(leftward, bandOld);
  const newLeft = uncovered(leftward, SC.bandForFrame);
  const oldSettle = uncovered(settleStart, bandOld);
  const newSettle = uncovered(settleStart, SC.bandForFrame);
  const oldDrift = uncovered(driftEnd, bandOld);
  const newDrift = uncovered(driftEnd, SC.bandForFrame);
  const oldMono = uncovered(monotonic, bandOld);
  const newMono = uncovered(monotonic, SC.bandForFrame);

  ok(`[12a] THE WORST CASE, AND AN ENTIRELY ORDINARY CAPTURE: turning ANTICLOCKWISE left ${oldLeft.total} of ${oldLeft.W} strip columns (${(100 * oldLeft.total / oldLeft.W).toFixed(1)}%) unpainted — ${oldLeft.left} at each end, about 25° of black on either side of the wrap. Every placement is negative, so the FIRST frame in time is the rightmost in space and the LAST is the leftmost: each was extended to the wrong edge and neither end of the strip was ever painted`,
    oldLeft.total > 0 && oldLeft.left > 0 && oldLeft.right > 0);
  ok('[12a] …and a leftward pan is now pixel-complete, like a rightward one',
    newLeft.total === 0);
  ok('[12a] …while a RIGHTWARD pan was never affected, which is why this survived: the capture guide happens to show one',
    uncovered(monotonic, bandOld).total === 0);

  ok(`[12a] THE DEFECT: a 3-frame backward settle at the START left ${oldSettle.total} of ${oldSettle.W} strip columns (${(100 * oldSettle.total / oldSettle.W).toFixed(2)}%) unpainted, all of them at the left edge — the wedge sits exactly where the 360° wrap puts it, between where the recording started and where it finished`,
    oldSettle.total > 0 && oldSettle.left === oldSettle.total);
  ok('[12a] …and it is gone: the same placements now leave ZERO unpainted columns',
    newSettle.total === 0);
  ok(`[12a] THE MIRROR CASE: drifting backward at the END used to leave ${oldDrift.total} columns unpainted at the RIGHT edge`,
    oldDrift.total > 0 && oldDrift.right === oldDrift.total);
  ok('[12a] …also gone', newDrift.total === 0);
  ok('[12a] a monotonic pan was never affected and is unchanged — the fix cannot have been a no-op that only looked right on the broken case',
    oldMono.total === 0 && newMono.total === 0);

  // -------------------------------------------------------------------------
  // [12b] THE VERTICAL STREAKS, cause one: a feather blends into WHATEVER THE
  // CANVAS ALREADY HAS. On the edge facing nothing, that is the bare
  // background colour, so the frame fades to black there. Flat grey frames on
  // a dark canvas: every deviation from the source value is an artefact.
  // -------------------------------------------------------------------------
  {
    const fw = 200;
    const fh = 8;
    const feather = 10;
    const src = 160;
    // A LEFTWARD pan — the case [12a] showed was already losing a third of its
    // strip. Flat grey frames on a dark canvas, so every value that is neither
    // the source nor the bare background is an artefact of the blend.
    const pl = [0, -40, -80, -120, -160, -200].map((x) => ({ x, y: 0 }));
    const frame = new Uint8Array(fw * fh * 3).fill(src);
    function bandOldLocal(p, i, w, f) {
      const c = w / 2;
      const here = p[i].x;
      const prev = i > 0 ? p[i - 1].x : null;
      const next = i < p.length - 1 ? p[i + 1].x : null;
      const x0 = prev === null ? 0 : c - Math.abs(here - prev) / 2 - f;
      const x1 = next === null ? w : c + Math.abs(next - here) / 2 + f;
      return { x0: Math.max(0, x0), x1: Math.min(w, Math.max(x0 + 1, x1)) };
    }
    const build = (bandFn, signed) => {
      const minX = Math.min(...pl.map((p) => p.x));
      const W = Math.max(...pl.map((p) => p.x)) + fw - minX;
      const canvas = SC.makeCanvas(W, fh, [20, 20, 20]);
      for (let i = 0; i < pl.length; i++) {
        const b = bandFn(pl, i, fw, feather);
        const f = signed ? SC.featherSignFor(pl, i, feather) : (i === 0 ? 0 : feather);
        SC.pasteFrameBand(canvas, W, fh, frame, fw, fh, pl[i].x - minX, pl[i].y, b.x0, b.x1, f);
      }
      let darkest = 255;
      let bare = 0;
      for (let x = 0; x < W; x++) {
        const v = canvas[(((fh >> 1) * W) + x) * 3];
        if (v === 20) { bare++; continue; }
        if (v < darkest) darkest = v;
      }
      return { darkest, bare, W };
    };
    const before = build(bandOldLocal, false);
    const after = build(SC.bandForFrame, true);
    ok(`[12b] THE DEFECT, both halves at once: the old band rule left ${before.bare} of ${before.W} columns bare, and where the old feather ran out into that bare canvas it dragged a painted column down to ${before.darkest} on a flat ${src} source — a dark vertical streak, which is what a feather pointed at nothing always produces`,
      before.bare > 0 && before.darkest < src - 10);
    ok(`[12b] …every painted column is now exactly the source value (${after.darkest}) and nothing is left bare (${after.bare})`,
      after.darkest === src && after.bare === 0);
    ok('[12b] the hard-cut edge leaves no gap — the neighbouring band always starts a full feather INSIDE it, which is what makes cutting safe',
      after.bare === 0);
    // ⚠ Said plainly: with the band rule fixed, a both-edges feather no longer
    // darkens anything on ANY placement sequence — searched exhaustively over
    // 3,125 five-step pans and found none. So the signed feather is not
    // independently demonstrable today; it removes the MECHANISM rather than
    // relying on the band rule to keep covering for it.
    let anyDark = false;
    const steps = [-40, -20, 20, 40, 60];
    (function rec(p) {
      if (anyDark) return;
      if (p.length > 5) { if (build(SC.bandForFrame, false).darkest < src - 5) anyDark = true; return; }
      for (const st of steps) rec(p.concat([{ x: p[p.length - 1].x + st, y: 0 }]));
    })([{ x: 0, y: 0 }]);
    ok('[12b] and the two fixes are belt and braces, stated as such: with the band rule corrected, the OLD both-edges feather no longer darkens any column either',
      anyDark === false);
  }

  // -------------------------------------------------------------------------
  // [12c] THE VERTICAL STREAKS, cause two: auto-exposure. A phone re-exposes
  // as it turns towards a window, so consecutive frames are photometrically
  // different pictures and each band lands at its own brightness.
  // -------------------------------------------------------------------------
  {
    // A clean 12% step at pair 5, nothing anywhere else.
    const ratios = new Array(20).fill(1);
    ratios[5] = 1.12;
    const g = SC.gainChain(ratios, {});
    ok('[12c] a real exposure STEP is carried through the chain: every frame after it is scaled differently from every frame before it',
      g[6] / g[4] > 1.10 && g[6] / g[4] < 1.14);
    ok('[12c] …and the chain is CENTRED, so the panorama keeps the capture\'s own exposure instead of being dragged onto frame 0\'s',
      Math.min(...g) < 1 && Math.max(...g) > 1);

    // The regression this feature nearly shipped: measurement noise on a
    // capture whose exposure never actually changed.
    const noisy = [];
    for (let i = 0; i < 107; i++) noisy.push(1 + ((i * 37) % 7 - 3) * 0.0009);   // |log r| <= 0.0027
    const gn = SC.gainChain(noisy, {});
    ok('[12c] THE REGRESSION THIS AVOIDS: per-pair noise below the measured floor is treated as no change at all, so a constant-exposure capture gets gains of exactly 1 — without the deadband this correction INVENTED a ±2% brightness ramp, i.e. the very banding it exists to remove',
      Array.from(gn).every((v) => v === 1));
    const justAbove = new Array(107).fill(1);
    justAbove[10] = Math.exp(0.02);
    ok('[12c] …while a change an order of magnitude above the noise floor passes through UNCHANGED — a hard deadband, not a soft threshold that would shave every real step',
      Math.abs(Math.log(SC.gainChain(justAbove, {})[11] / SC.gainChain(justAbove, {})[9]) - 0.02) < 1e-9);

    // Loop closure and clamping.
    const creep = [];
    for (let i = 0; i < 100; i++) creep.push(Math.exp(0.01));   // a steady 1%/frame drift
    const open = SC.gainChain(creep, { closeLoop: false });
    const closed = SC.gainChain(creep, { closeLoop: true });
    ok(`[12c] on a FULL TURN the chain is closed: the last frame looks at the same scene as the first, so its gain matches (${closed[closed.length - 1].toFixed(4)} vs ${closed[0].toFixed(4)})`,
      Math.abs(closed[closed.length - 1] - closed[0]) < 1e-6);
    ok('[12c] …and NOT closed on a partial capture, where the two ends are different places and forcing them to agree would invent a brightness ramp',
      Math.abs(open[open.length - 1] - open[0]) > 0.5);
    ok('[12c] every gain is bounded whatever the chain says, so one pathological pair cannot black out or blow out a frame',
      Array.from(open).every((v) => v >= SC.GAIN_MIN - 1e-9 && v <= SC.GAIN_MAX + 1e-9));

    // applyGainRgb: clamps, rounds, and is a genuine no-op at 1.
    const buf = new Uint8Array([10, 128, 250]);
    SC.applyGainRgb(buf, 1.4);
    ok('[12c] applyGainRgb scales and CLAMPS rather than wrapping a channel round past 255',
      buf[0] === 14 && buf[1] === 179 && buf[2] === 255);
    const same = new Uint8Array([10, 128, 250]);
    SC.applyGainRgb(same, 1);
    ok('[12c] …and a gain of 1 touches nothing', same[0] === 10 && same[1] === 128 && same[2] === 250);

    // overlapMeanRatio refuses the cases where a ratio means nothing.
    const g8 = new Uint8Array(64).fill(100);
    const g8b = new Uint8Array(64).fill(150);
    const r = SC.overlapMeanRatio(g8, 8, 8, g8b, 8, 8, 0, 0);
    ok(`[12c] overlapMeanRatio measures the ratio over the shared region (${r.ratio.toFixed(3)} for 100 against 150)`,
      approx(r.ratio, 100 / 150, 1e-9));
    const dark = new Uint8Array(64).fill(1);
    ok('[12c] …and refuses a near-black overlap rather than dividing by something close to zero',
      SC.overlapMeanRatio(dark, 8, 8, g8, 8, 8, 0, 0).ratio === 1);
    ok('[12c] …and refuses an overlap too small to trust',
      SC.overlapMeanRatio(g8, 8, 8, g8b, 8, 8, 7, 0).ratio === 1);
  }

  // -------------------------------------------------------------------------
  // [12d] BLURRY AND MISALIGNED, cause one: the sub-pixel fit. `meanAbsDiff`
  // is an L1 surface, which near its minimum is a V — so a PARABOLA puts the
  // vertex in the wrong place, by an amount that depends on where the true
  // offset sits between two pixels. Those offsets are summed along the chain.
  //
  // Synthetic V with known vertex: score(d) = |d - t| + base. Exact answer
  // available, so this measures the estimator itself rather than a stitch.
  // -------------------------------------------------------------------------
  {
    let worstPara = 0;
    let worstEqui = 0;
    for (let k = 1; k < 20; k++) {
      const t = -0.5 + k / 20;                       // true sub-pixel offset
      const s0 = Math.abs(0 - t);
      const sL = Math.abs(-1 - t);
      const sR = Math.abs(1 - t);
      const para = (0.5 * (sL - sR)) / (sL - 2 * s0 + sR);
      const equi = (0.5 * (sL - sR)) / ((sL > sR ? sL : sR) - s0);
      worstPara = Math.max(worstPara, Math.abs(para - t));
      worstEqui = Math.max(worstEqui, Math.abs(equi - t));
    }
    ok(`[12d] on a V-shaped (L1) score surface the equiangular fit is EXACT (worst error ${worstEqui.toExponential(1)}px) where a parabola is not (${worstPara.toFixed(3)}px)`,
      worstEqui < 1e-12 && worstPara > 0.08);
    // ⚠ 0.086px on a PERFECT V understates it. The gain on real data is much
    // larger, because a real surface is noisy as well as V-shaped and the bias
    // then interacts with the noise: measured against exact ground truth on the
    // synthetic rotating-camera scene, accumulated rotation error over a full
    // turn fell from 0.16–0.98% (parabola) to 0.01–0.06% (equiangular), and
    // stopped depending on the frame count at all. The table is in
    // estimateOffset's own comment.

    // And the shipped estimator really uses it: a known half-pixel shift.
    const w = 64;
    const h = 24;
    const mk = (shift) => {
      const g = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          g[y * w + x] = Math.max(0, Math.min(255, Math.round(128 + 90 * Math.sin((x - shift) * 0.21) * Math.cos(y * 0.13))));
        }
      }
      return g;
    };
    const a = mk(0);
    const b = mk(3.5);
    const est = SC.estimateOffset(a, w, h, b, w, h, { maxDx: 8, maxDy: 1, subPixel: true });
    const plain = SC.estimateOffset(a, w, h, b, w, h, { maxDx: 8, maxDy: 1 });
    ok(`[12d] the shipped estimator recovers a known 3.5px shift to ${est.dx.toFixed(2)}px, where the integer search alone can only say ${plain.dx}`,
      Math.abs(Math.abs(est.dx) - 3.5) < 0.2 && Number.isInteger(plain.dx));
    ok('[12d] …and sub-pixel refinement stays OPT-IN: without it the answer is still a whole number, which every existing caller expects',
      Number.isInteger(plain.dx));
  }

  // -------------------------------------------------------------------------
  // [12e] BLURRY AND MISALIGNED, cause two: NEAREST-NEIGHBOUR DOWNSCALING.
  // Every frame of every capture is reduced to the composite width, often by a
  // non-integer factor — where nearest keeps whichever pixels land on the grid
  // and throws the rest away. A fine vertical grating is the clearest case:
  // area-averaging resolves it to its true mean, nearest turns it into a
  // low-frequency beat that moves with the sampling phase.
  // -------------------------------------------------------------------------
  {
    const sw = 441;
    const sh = 4;
    const dw = 300;                                   // 1.47x, the portrait-capture ratio
    const grating = new Uint8Array(sw * sh * 3);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const v = x % 2 === 0 ? 40 : 216;             // mean 128
        const i = (y * sw + x) * 3;
        grating[i] = v; grating[i + 1] = v; grating[i + 2] = v;
      }
    }
    const spread = (buf) => {
      let lo = 255;
      let hi = 0;
      for (let x = 0; x < dw; x++) { const v = buf[x * 3]; if (v < lo) lo = v; if (v > hi) hi = v; }
      return hi - lo;
    };
    const near = SC.resizeRgbNearest(grating, sw, sh, dw, sh);
    const area = SC.resizeRgbArea(grating, sw, sh, dw, sh);
    ok(`[12e] THE DEFECT: nearest turns a fine grating into a ${spread(near)}-level beat across the row — aliasing whose phase differs per frame, which is what lands as vertical streaks once each frame owns its own band`,
      spread(near) > 150);
    ok(`[12e] …area-averaging collapses the same grating towards its true mean: spread ${spread(area)} against ${spread(near)}, a ${(spread(near) / spread(area)).toFixed(1)}× reduction`,
      spread(area) * 2 < spread(near));
    // ⚠ NOT zero, and it should not be: at 1.47× each destination pixel covers
    // two or three source pixels, and a 2-pixel grating averages to 128 over an
    // even box and to 99 or 157 over an odd one. That residual is the honest
    // floor for a box filter at a non-integer ratio — what matters is that it
    // no longer swings the full black-to-white of the source.
    ok('[12e] …and it is genuinely the local mean, not a blur that also shifts the image',
      Math.abs(area[3 * (dw >> 1)] - 128) <= 45);
    ok('[12e] resizeRgbNearest is KEPT and unchanged — it is still the right, provably colour-preserving choice for a thumbnail nobody aligns against',
      Array.from(SC.resizeRgbNearest(grating, sw, sh, 8, 2)).every((v) => v === 40 || v === 216));
  }

  // -------------------------------------------------------------------------
  // [12f] THE UNDER-ROTATED CAPTURE: stretched to fill 360° rather than left
  // with a black wedge — but stretched in BOTH axes, or the panorama comes out
  // horizontally elongated, which reads as "blurry and misaligned" long before
  // anyone works out that it is an aspect error.
  // -------------------------------------------------------------------------
  {
    const focal = 300;
    const stripH = 121;
    const outW = 720;
    const strip = new Uint8Array(900 * stripH * 3).fill(120);
    const short = SC.cylStripToEquirect(strip, 900, stripH, focal, (stripH - 1) / 2, outW);   // 900 < 2π·300 = 1885
    const full = SC.cylStripToEquirect(new Uint8Array(2400 * stripH * 3).fill(120), 2400, stripH, focal, (stripH - 1) / 2, outW);
    ok(`[12f] on a FULL turn the scale is the plain one turn across the output (${short.pxPerRad ? '' : ''}${full.pxPerRad.toFixed(2)} px/rad vs ${(outW / (Math.PI * 2)).toFixed(2)})`,
      approx(full.pxPerRad, outW / (Math.PI * 2), 1e-6));
    ok(`[12f] on an UNDER-ROTATED capture the vertical scale follows the stretched horizontal one (${short.pxPerRad.toFixed(2)} px/rad, ${(short.pxPerRad / (outW / (Math.PI * 2))).toFixed(2)}× the un-stretched scale) instead of staying behind it`,
      short.pxPerRad > outW / (Math.PI * 2) * 1.5);
    ok('[12f] …so the result is a uniform angular magnification: the output is TALLER in proportion, not squashed',
      short.height > full.height);
  }

  // -------------------------------------------------------------------------
  // [12g] THE WRAP JOIN. Once the hole is gone, the start and the finish of
  // the recording still meet as a butt join. Cross-fade it — but only when the
  // capture genuinely came round far enough for the strip to hold that yaw
  // twice, because a partial capture has nothing to blend with.
  // -------------------------------------------------------------------------
  {
    const focal = 300;
    const stripH = 61;
    const turn = Math.round(Math.PI * 2 * focal);
    const outW = 720;
    // A strip whose two ends disagree: left half dark, the duplicated tail bright.
    const wide = turn + 400;
    const strip = new Uint8Array(wide * stripH * 3);
    for (let y = 0; y < stripH; y++) {
      for (let x = 0; x < wide; x++) {
        const i = (y * wide + x) * 3;
        const v = x >= turn ? 220 : 60;
        strip[i] = v; strip[i + 1] = v; strip[i + 2] = v;
      }
    }
    const blended = SC.cylStripToEquirect(strip, wide, stripH, focal, (stripH - 1) / 2, outW, { wrapBlendPx: 12 });
    const plain = SC.cylStripToEquirect(strip, wide, stripH, focal, (stripH - 1) / 2, outW, { wrapBlendPx: 0 });
    const col = (r, x) => r.rgb[(((r.height >> 1) * r.width) + x) * 3];
    ok(`[12g] the join is cross-faded: column 0 leads with the FINISH (${col(blended, 0)}) and has reached the START by the end of the fade (${col(blended, 11)})`,
      col(blended, 0) > 150 && col(blended, 11) < 120 && col(blended, 0) > col(blended, 11));
    ok('[12g] …and without it the same strip meets as a hard cut', col(plain, 0) === col(plain, 11));
    ok(`[12g] the fade is NARROW — a wide one over two views that do not quite agree is a ghost, which is worse than the cut it replaces (${blended.blendPx} of ${outW} columns)`,
      blended.blendPx > 0 && blended.blendPx <= outW / 20);
    const partial = SC.cylStripToEquirect(new Uint8Array(900 * stripH * 3).fill(120), 900, stripH, focal, (stripH - 1) / 2, outW, { wrapBlendPx: 12 });
    ok('[12g] an UNDER-ROTATED capture gets no blend at all — there is no second view of that yaw, and inventing one would be a join the capture never had',
      partial.blendPx === 0);
  }
}

// ---------------------------------------------------------------------------
// [13] THE CLAMP WAS BOUNDING THE SCENE, NOT THE BIAS
//
// Owner, on the SECOND pass, with a real capture: "there are still a few
// streaks". ⚠⚠ THE WORD THAT MATTERED WAS "FEW". At ~29 composite px per band
// there are DOZENS of seams on screen at once, so a handful of streaks cannot
// be a per-seam cause — and three per-seam candidates were each measured and
// each REFUTED before this one was found: a luminance-only gain leaving a
// colour step on a saturated wall (1 level, and a per-channel gain was no
// better), the feather's linear ramp leaving a slope discontinuity for Mach
// banding to find (0.716 against 0.716 for smoothstep), and generational JPEG
// on the intermediate canvas (there is none — it is stored as raw bytes).
//
// What is rare is a CLAMP, which does nothing at all until the scene asks for
// more range than it allows and then truncates hard. See GAIN_MIN/GAIN_MAX.
// ---------------------------------------------------------------------------
{
  const FW = 320, FH = 120, N = 144, STEP = 11;
  // A real room, and a real TURN: a dim interior wall, one bright window, back
  // to the wall. On a full turn the exposure necessarily returns to where it
  // began, which is what makes loop closure the appropriate guard below.
  const trueLum = (x) => {
    const t = (((x % (STEP * N)) + STEP * N) % (STEP * N)) / (STEP * N);
    return 60 + 185 * Math.exp(-Math.pow((t - 0.5) / 0.13, 2));
  };
  // the camera's own auto-exposure, driving each frame toward a mid grey
  const ae = (i) => {
    let s = 0;
    for (let x = 0; x < FW; x++) s += trueLum(i * STEP + x);
    return Math.max(0.35, Math.min(1.6, 110 / (s / FW)));
  };
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const grays = [];
  for (let i = 0; i < N; i++) {
    const g = new Uint8Array(FW * FH), a = ae(i);
    for (let x = 0; x < FW; x++) {
      const v = Math.max(0, Math.min(255, trueLum(i * STEP + x) * a + (rnd() - 0.5) * 2));
      for (let y = 0; y < FH; y++) g[y * FW + x] = v | 0;
    }
    grays.push(g);
  }
  const ratios = [];
  for (let i = 1; i < N; i++) {
    ratios.push(SC.overlapMeanRatio(grays[i - 1], FW, FH, grays[i], FW, FH, STEP, 0).ratio);
  }
  const aes = Array.from({ length: N }, (_, i) => ae(i));
  const swing = Math.max(...aes) / Math.min(...aes);
  ok(`[13] the fixture is a real one, not a tuned one: the camera's OWN auto-exposure swings ${swing.toFixed(2)}x across the capture`,
    swing > 3);

  // Residual seam step: how far two neighbouring frames still disagree AFTER
  // their gains, in levels, at the midpoint they share. On a flat wall any
  // step at all is an artefact, so this needs no tolerance to be meaningful.
  const residual = (gains) => {
    let worst = 0, ge1 = 0, ge2 = 0;
    for (let i = 1; i < N; i++) {
      const mid = (i - 0.5) * STEP + FW / 2;
      const d = Math.abs(trueLum(mid) * ae(i - 1) * gains[i - 1] - trueLum(mid) * ae(i) * gains[i]);
      if (d > worst) worst = d;
      if (d >= 1) ge1++;
      if (d >= 2) ge2++;
    }
    return { worst, ge1, ge2 };
  };

  const now = SC.gainChain(ratios, { closeLoop: true });
  // ⚠ THE CONTRAST IS THE ALGORITHM EXACTLY AS IT SHIPPED — no per-pair bound,
  // and the accumulated gain clamped to the old [0.72, 1.38] after centring,
  // which is where the old code clamped. Without this the block would assert
  // that the new code is fine and prove nothing about what it fixed.
  const was = Array.from(
    SC.gainChain(ratios, { closeLoop: true, stepMax: Infinity }),
    (g) => (g < 0.72 ? 0.72 : (g > 1.38 ? 1.38 : g)));

  const rNow = residual(now), rWas = residual(was);
  const pinned = was.filter((g) => g <= 0.72 + 1e-9 || g >= 1.38 - 1e-9).length;

  ok(`[13] REPRODUCES THE REPORT: under the old bounds ${pinned} of ${N} frames are PINNED AT A CLAMP, so the correction is truncated rather than applied`,
    pinned > N / 2);
  ok(`[13] …and the truncation lands as a hard brightness step at their seams — worst ${rWas.worst.toFixed(2)} levels, ${rWas.ge2} seams past 2 levels`,
    rWas.worst > 3 && rWas.ge2 > 10);
  ok(`[13] THE DEFECT IS RARE, NOT PER-SEAM — ${rWas.ge2} of ${N - 1} seams — which is exactly why three per-seam causes were measured and refuted first`,
    rWas.ge2 < (N - 1) / 3);
  ok(`[13] with the per-pair bound the same capture leaves worst ${rNow.worst.toFixed(2)} levels and ${rNow.ge1} seams past 1 level`,
    rNow.worst < 1.5 && rNow.ge1 === 0);
  ok(`[13] …because the range the scene actually needs is now expressible (max gain ${Math.max(...now).toFixed(3)}, where the old bound stopped at 1.38)`,
    Math.max(...now) > 1.38);

  // ⚠⚠ THE TWO GUARANTEES THE WIDENED BOUND MUST NOT COST.
  const flat = Array.from({ length: N - 1 }, () => 1.0);
  ok('[13] a CONSTANT-exposure capture still gets gains of exactly 1 — the regression this feature once caused (a ±2% ramp over frames that were all identically exposed) stays fixed',
    Array.from(SC.gainChain(flat, { closeLoop: false })).every((v) => Math.abs(v - 1) < 1e-12));

  // A consistent per-pair bias is exactly a LINEAR drift in log space, and
  // loop closure removes a linear drift outright — so on a full turn (every
  // real 360° capture) the accumulated clamp was never the working guard.
  const biased = Array.from({ length: N - 1 }, () => 1.005);
  ok('[13] a consistent bias just above the deadband is removed OUTRIGHT by loop closure, so widening the accumulated bound costs the runaway guard nothing on a full turn',
    Array.from(SC.gainChain(biased, { closeLoop: true })).every((v) => Math.abs(v - 1) < 1e-9));

  const open = SC.gainChain(biased, { closeLoop: false });
  ok(`[13] on a PARTIAL capture there is no loop to close, and the accumulated bound is still the backstop and still holds (${Math.min(...open).toFixed(3)}..${Math.max(...open).toFixed(3)})`,
    Array.from(open).every((v) => v >= SC.GAIN_MIN - 1e-9 && v <= SC.GAIN_MAX + 1e-9));

  // The per-pair bound itself: one impossible pair must not displace the rest.
  const spike = [1.0, 1.0, 4.0, 1.0, 1.0, 1.0, 1.0];
  const spread = (a) => Math.max(...a) / Math.min(...a);
  const bounded = SC.gainChain(spike, { closeLoop: false });
  const unbounded = SC.gainChain(spike, { closeLoop: false, stepMax: Infinity });
  ok(`[13] ONE impossible pair — 4x between two frames that overlap ~96% — no longer displaces every frame after it: spread ${spread(bounded).toFixed(2)}x against ${spread(unbounded).toFixed(2)}x unbounded`,
    spread(bounded) < spread(unbounded) / 2);

  const maxStep = Math.max(...ratios.map((r) => Math.abs(Math.log(r))));
  ok(`[13] …and it is a GUARD, not a correction: the real capture's largest per-pair step is ${maxStep.toFixed(4)}, well inside GAIN_STEP_MAX ${SC.GAIN_STEP_MAX}, so it never bites on an honest pan`,
    maxStep < SC.GAIN_STEP_MAX);
}

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
