// stitch-core.js — pure pixel/array math for server-side 360° stitching.
//
// ZERO imports, ZERO I/O. Every function here takes plain typed arrays and
// numbers and returns the same, so it runs BYTE-IDENTICALLY under Node
// (directly executed by test.js, next to this file) and under Deno (the real
// worker, index.ts, imports this exact file unmodified — no build step, no
// transpile, matching this whole repo's own "no build step" convention).
// JPEG decode/encode is a separate, thin per-runtime wrapper — this file
// never touches an image FORMAT, only already-decoded RGB(A) pixel buffers.
//
// ⚠️⚠️ THIS IS A DELIBERATELY SIMPLER ALGORITHM THAN THE EXISTING CLIENT-SIDE
// PIPELINE (pano360.js), NOT A PORT OF IT. That file uses OpenCV.js — ORB
// feature detection, BFMatcher, RANSAC homography, cylindrical warping — none
// of which is available here: standard OpenCV.js is a large WASM module with
// no confirmed precedent for loading inside Supabase's Edge Runtime sandbox,
// and even if it loaded, a single `cv.findHomography` call is exactly the
// kind of unbounded-duration operation the 2-second CPU cap makes risky to
// depend on. This module instead does a bounded, downsampled, pure-JS
// grayscale cross-correlation search over a small horizontal(+small
// vertical) displacement window — matching this app's own capture guidance
// of a slow, mostly-horizontal pan. The accepted trade-off, stated plainly:
// it has NO tolerance for camera roll/tilt the way a full homography would,
// only translation. A capture that pans smoothly and doesn't roll the phone
// (the guidance this feature has always given) is exactly the case this
// still handles well.
//
// ⚠️⚠️ 2026-09-16 CORRECTNESS AUDIT — A REAL, KNOWN GAP FOUND AND DELIBERATELY
// NOT FIXED THIS ROUND: this pipeline does PURE TRANSLATION alignment and
// compositing on raw (un-warped) perspective frames, with no cylindrical
// reprojection step. That is architecturally the same category of bug the
// CLIENT-side pipeline (pano360.js) already hit and fixed, documented at
// length in this module's own CLAUDE.md under 2026-09-12: a camera that
// ROTATES about a fixed point (exactly what this app's own capture guide
// asks for — "stand in one spot and slowly turn") is not doing a lateral
// translation, and reprojecting rotated frames onto one flat reference plane
// via a plain shift produces a badly malformed, largely-black mosaic once
// the rotation is more than a few degrees. The client pipeline's fix was a
// real cylindrical warp (`cv.remap` at an assumed ~65° HFOV) applied to every
// frame BEFORE alignment/compositing, so a pure-yaw rotation becomes a plain
// horizontal translation in the warped coordinate space — which is exactly
// the motion this file's own alignment search already assumes and handles.
// The server pipeline has no equivalent warp, so the identical failure mode
// is reachable here on the same real capture that would trigger it client-
// side.
//
// This was NOT implemented from scratch in this pass. Reasoning, stated
// rather than silently deferred: a correct cylindrical remap needs real
// per-pixel trigonometry (source x/y as a function of the destination
// column's angle off-axis, with the destination edge's own half-angle being
// `atan(tan(HFOV/2))`-shaped, not a linear scale of HFOV/2 — an error caught
// and corrected during the reasoning for this note, which is itself the
// argument for not shipping an unverified version of it) plus real masking/
// clamping for the region a rotated frame's corners no longer cover. This
// environment has no Deno runtime, no real recorded video/image fixtures for
// this pipeline, and no way to RENDER a mosaic to visually confirm a remap
// is correct rather than subtly wrong in a way that only shows up on a real
// capture — the exact class of mistake this module's own engineering culture
// (see CLAUDE.md, repeatedly) treats as worse than not shipping a fix at
// all. Bounded, pure translation over a real (if imperfect) capture is a
// known, working degrade; an unverified cylindrical remap risking a WORSE,
// differently-wrong mosaic is not an improvement just because it addresses
// more of the geometry in principle.
//
// If this is picked up again: build an isolated Node/Deno-free harness with
// a SYNTHETIC rotating-camera test scene (the client pipeline's own
// 2026-09-12 fix was verified exactly this way, against a real recording,
// in a real browser) before trusting any cylindrical-warp arithmetic here —
// do not ship it on inspection alone.

// ---------------------------------------------------------------------------
// Grayscale downsampling — used only for the ALIGNMENT search, never for the
// final composite (that uses full decoded RGB frames, see jpeg-codec).
// ---------------------------------------------------------------------------
export function toGrayscaleDownsampled(rgba, width, height, targetWidth) {
  const scale = targetWidth / width;
  const tw = Math.max(1, Math.round(width * scale));
  const th = Math.max(1, Math.round(height * scale));
  const gray = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const si = (sy * width + sx) * 4;
      // Rec. 601 luma weights, integer math (no float rounding drift).
      gray[y * tw + x] = ((rgba[si] * 299 + rgba[si + 1] * 587 + rgba[si + 2] * 114) / 1000) | 0;
    }
  }
  return { width: tw, height: th, gray };
}

// ---------------------------------------------------------------------------
// Mean absolute difference over the OVERLAPPING region when `curr` is placed
// at offset (dx,dy) relative to `prev` (both anchored at their own (0,0)).
// Assumes prev and curr share the same dimensions (pw===cw, ph===ch) — true
// here because every frame of one video is downsampled with the identical
// scale factor. Returns Infinity when the overlap is too small to trust
// (near the edge of the search window on a short/narrow frame) so it can
// never win the search by accident.
// ---------------------------------------------------------------------------
export const MIN_OVERLAP_FRACTION = 0.15;

export function meanAbsDiff(prevGray, pw, ph, currGray, cw, ch, dx, dy) {
  const x0 = Math.max(0, dx);
  const x1 = Math.min(pw, cw + dx);
  const y0 = Math.max(0, dy);
  const y1 = Math.min(ph, ch + dy);
  if (x1 <= x0 || y1 <= y0) return Infinity;
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const cy = y - dy;
    const pRow = y * pw;
    const cRow = cy * cw;
    for (let x = x0; x < x1; x++) {
      sum += Math.abs(prevGray[pRow + x] - currGray[cRow + (x - dx)]);
      n++;
    }
  }
  if (n < pw * ph * MIN_OVERLAP_FRACTION) return Infinity;
  return sum / n;
}

// ---------------------------------------------------------------------------
// The alignment search itself: try every (dx,dy) in the window, keep the
// lowest-scoring one. `fallback` is set (reporting only — see the header
// comment) when even the BEST match found is a poor one, so a low-texture or
// motion-blurred pair is flagged honestly rather than silently accepted.
// ---------------------------------------------------------------------------
export const DEFAULT_MAX_DX = 40;
export const DEFAULT_MAX_DY = 4;
export const FALLBACK_SCORE_THRESHOLD = 35; // mean abs diff, 0..255 scale

export function estimateOffset(prevGray, pw, ph, currGray, cw, ch, opts) {
  const maxDx = (opts && opts.maxDx) || DEFAULT_MAX_DX;
  const maxDy = (opts && opts.maxDy) || DEFAULT_MAX_DY;
  let best = { dx: 0, dy: 0, score: Infinity };
  for (let dy = -maxDy; dy <= maxDy; dy++) {
    for (let dx = -maxDx; dx <= maxDx; dx++) {
      const score = meanAbsDiff(prevGray, pw, ph, currGray, cw, ch, dx, dy);
      if (score < best.score) best = { dx, dy, score };
    }
  }
  const fallback = !isFinite(best.score) || best.score > FALLBACK_SCORE_THRESHOLD;
  const out = { dx: best.dx, dy: best.dy, score: isFinite(best.score) ? best.score : null, fallback };

  // ⚠️⚠️ SUB-PIXEL REFINEMENT — OPT-IN, AND IT MATTERS FAR MORE THAN A
  // FRACTION OF A PIXEL SOUNDS. These offsets are SUMMED along the whole
  // chain, so a rounding bias does not average out — it accumulates. Measured
  // on the synthetic rotating-camera harness (test.mjs section [11]): a true
  // 360° turn whose real per-pair shift is 12.56px is rounded to 13 every
  // single time, and 48 pairs later the chain reports the capture turned 372°.
  // The panorama is then normalised as if those pixels were a full turn, so
  // every feature lands up to ~3.4% of a revolution — about 12° — from where
  // it belongs. The same harness run at a step that happens to land near a
  // whole pixel scored 2.43 where this one scored 8.53: a 3.5× difference in
  // recovered accuracy, caused by nothing but rounding.
  //
  // The standard remedy: the score surface near its minimum is locally
  // quadratic, so fitting a parabola through the best score and its two
  // horizontal neighbours puts the true minimum at the vertex. Guarded on a
  // genuinely convex triple (denom > 0) and clamped to ±0.5px, so a flat or
  // noisy surface can only ever return the integer answer it already had.
  //
  // ⚠️ Opt-in rather than always-on because callers (and this repo's own
  // existing tests) reasonably expect integer offsets from a pixel search;
  // only the compositing pipeline, which sums them, needs the fraction.
  if (opts && opts.subPixel && isFinite(best.score)) {
    const sL = meanAbsDiff(prevGray, pw, ph, currGray, cw, ch, best.dx - 1, best.dy);
    const sR = meanAbsDiff(prevGray, pw, ph, currGray, cw, ch, best.dx + 1, best.dy);
    if (isFinite(sL) && isFinite(sR)) {
      const denom = sL - 2 * best.score + sR;
      if (denom > 0) {
        let delta = (0.5 * (sL - sR)) / denom;
        if (delta > 0.5) delta = 0.5; else if (delta < -0.5) delta = -0.5;
        out.dx = best.dx + delta;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// RGBA -> RGB (the composite never needs an alpha channel; dropping it a
// third of the way through the pipeline halves every downstream buffer).
// ---------------------------------------------------------------------------
export function rgbaToRgb(rgba, width, height) {
  const out = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height * 4; i += 4, j += 3) {
    out[j] = rgba[i];
    out[j + 1] = rgba[i + 1];
    out[j + 2] = rgba[i + 2];
  }
  return out;
}

// The exact inverse of rgbaToRgb, above — used only at the JPEG ENCODE
// boundary in index.ts (jpeg-js's encode() wants RGBA, matching how its own
// decode() hands back RGBA; every actual pixel op in between — pasteFrame,
// cropRgb, resizeRgbNearest — works in RGB, since a composite has no
// meaningful alpha channel of its own). Alpha is always fully opaque (255):
// nothing upstream of this ever produces a transparent pixel.
export function rgbToRgba(rgb, width, height) {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height * 3; i += 3, j += 4) {
    out[j] = rgb[i];
    out[j + 1] = rgb[i + 1];
    out[j + 2] = rgb[i + 2];
    out[j + 3] = 255;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cumulative composite-resolution placements from per-pair alignment-
// resolution offsets. `scaleFactor` converts an alignment-resolution pixel
// distance into a composite-resolution one (compositeFrameWidth /
// alignFrameWidth) — the two stages deliberately run at different
// resolutions (alignment stays tiny to keep the search cheap; the composite
// uses a larger frame so the final image is actually worth looking at).
// Frame 0 is always anchored at {x:0, y:0}; every later frame's placement is
// the running sum of every (dx,dy) before it, exactly matching how
// `meanAbsDiff` defines what "curr is at offset (dx,dy) from prev" means —
// each frame is positioned relative to the one immediately before it, and
// those deltas simply add up along the chain.
// ---------------------------------------------------------------------------
export function cumulativePlacements(pairOffsets, scaleFactor) {
  const out = [{ x: 0, y: 0 }];
  let x = 0;
  let y = 0;
  for (const p of pairOffsets) {
    x += p.dx * scaleFactor;
    y += p.dy * scaleFactor;
    out.push({ x: Math.round(x), y: Math.round(y) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The bounding box a set of placed frames actually occupies, BEFORE any cap
// is applied — the caller (index.ts) is responsible for capping the result
// to a sane maximum and re-scaling every placement + frame size together if
// the raw bounds exceed it, so nothing here silently allocates an unbounded
// buffer from a single bad offset.
// ---------------------------------------------------------------------------
// A scale factor (always <= 1) that brings a width/height pair down to fit
// within a maximum, preserving aspect ratio — the caller applies it to every
// frame dimension AND every placement together, so the composite never
// allocates an unbounded buffer from a single wide capture. Returns 1
// (no-op) when the input already fits.
export function capScaleFactor(width, height, maxWidth, maxHeight) {
  const sw = width > maxWidth ? maxWidth / width : 1;
  const sh = height > maxHeight ? maxHeight / height : 1;
  return Math.min(sw, sh, 1);
}

export function computeBounds(placements, frameWidth, frameHeight) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placements) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + frameWidth);
    maxY = Math.max(maxY, p.y + frameHeight);
  }
  return { minX, minY, maxX, maxY, width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) };
}

// ---------------------------------------------------------------------------
// Paste one RGB frame onto a growing RGB canvas buffer, clipped to the
// canvas bounds (never wraps, never throws on an out-of-range offset) and
// linearly feathered across `featherPx` columns so a seam blends into
// whatever the canvas already has there instead of cutting hard — pass
// featherPx=0 for the very first frame placed (nothing to blend into yet).
//
// ⚠️⚠️ `featherPx` is SIGNED, and the sign picks which edge is feathered —
// this is the fix for a real correctness gap found on audit: the function
// used to ALWAYS feather the frame's own LEFT edge, which is only the right
// edge to blend when the frame was placed to the RIGHT of whatever is
// already on the canvas (an ordinary rightward pan). A frame placed to the
// LEFT of the existing content (a leftward pan, a momentary backward wobble
// in an otherwise-forward walk-around, or a mirrored/front-facing capture)
// overlaps the canvas on its own RIGHT edge instead — feathering the left
// edge in that case blends into nothing (there's no overlap there) and
// hard-cuts the edge that actually needed blending, which is exactly where
// a visible seam would appear. A positive `featherPx` feathers the LEFT
// `featherPx` columns (the original, still-default behaviour); a negative
// value feathers the RIGHT `|featherPx|` columns instead. The caller (the
// compositor in index.ts) is responsible for picking the sign from the
// direction the frame actually moved relative to the previous one.
// ---------------------------------------------------------------------------
export function pasteFrame(canvas, cw, ch, frameRgb, fw, fh, offsetX, offsetY, featherPx) {
  const featherAbs = Math.abs(featherPx);
  const featherRight = featherPx < 0;
  for (let y = 0; y < fh; y++) {
    const cy = offsetY + y;
    if (cy < 0 || cy >= ch) continue;
    const cRowBase = cy * cw;
    const fRowBase = y * fw;
    for (let x = 0; x < fw; x++) {
      const cx = offsetX + x;
      if (cx < 0 || cx >= cw) continue;
      const si = (fRowBase + x) * 3;
      const di = (cRowBase + cx) * 3;
      let a = 1;
      if (featherAbs > 0) {
        if (!featherRight && x < featherAbs) {
          a = x / featherAbs;
        } else if (featherRight && x >= fw - featherAbs) {
          a = (fw - 1 - x) / featherAbs;
        }
      }
      if (a >= 1) {
        canvas[di] = frameRgb[si];
        canvas[di + 1] = frameRgb[si + 1];
        canvas[di + 2] = frameRgb[si + 2];
      } else {
        canvas[di] = (canvas[di] * (1 - a) + frameRgb[si] * a) | 0;
        canvas[di + 1] = (canvas[di + 1] * (1 - a) + frameRgb[si + 1] * a) | 0;
        canvas[di + 2] = (canvas[di + 2] * (1 - a) + frameRgb[si + 2] * a) | 0;
      }
    }
  }
}

export function makeCanvas(width, height, bg) {
  const buf = new Uint8Array(width * height * 3);
  if (bg) {
    for (let i = 0; i < buf.length; i += 3) {
      buf[i] = bg[0];
      buf[i + 1] = bg[1];
      buf[i + 2] = bg[2];
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// A plain 4:3 centre-crop thumbnail, matching the SAME rule the existing
// client pipeline already applies (captureViewerThumbnail/cropToThumbBlob in
// module.js) — kept consistent so a server-produced thumbnail looks like a
// client-produced one to anyone comparing captures side by side.
// ---------------------------------------------------------------------------
export const THUMB_ASPECT = 4 / 3;

export function centerCropRect(width, height, aspect) {
  let cw = width;
  let ch = Math.round(width / aspect);
  if (ch > height) {
    ch = height;
    cw = Math.round(height * aspect);
  }
  const x = Math.round((width - cw) / 2);
  const y = Math.round((height - ch) / 2);
  return { x, y, width: cw, height: ch };
}

export function cropRgb(rgb, width, height, rect) {
  const out = new Uint8Array(rect.width * rect.height * 3);
  for (let y = 0; y < rect.height; y++) {
    const srcRow = (rect.y + y) * width;
    const dstRow = y * rect.width;
    for (let x = 0; x < rect.width; x++) {
      const si = (srcRow + rect.x + x) * 3;
      const di = (dstRow + x) * 3;
      out[di] = rgb[si];
      out[di + 1] = rgb[si + 1];
      out[di + 2] = rgb[si + 2];
    }
  }
  return out;
}

// Nearest-neighbour resize — used only to bring the crop down to a fixed,
// small thumbnail size; not used anywhere alignment-accuracy depends on.
export function resizeRgbNearest(rgb, srcW, srcH, dstW, dstH) {
  const out = new Uint8Array(dstW * dstH * 3);
  const sx = srcW / dstW;
  const sy = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const yy = Math.min(srcH - 1, Math.floor(y * sy));
    for (let x = 0; x < dstW; x++) {
      const xx = Math.min(srcW - 1, Math.floor(x * sx));
      const si = (yy * srcW + xx) * 3;
      const di = (y * dstW + x) * 3;
      out[di] = rgb[si];
      out[di + 1] = rgb[si + 1];
      out[di + 2] = rgb[si + 2];
    }
  }
  return out;
}


// ===========================================================================
// 2026-09-17 — CYLINDRICAL REPROJECTION + EQUIRECTANGULAR OUTPUT
// ---------------------------------------------------------------------------
// This closes the gap the 2026-09-16 audit note at the top of this file named
// and deliberately left open ("A REAL, KNOWN GAP FOUND AND DELIBERATELY NOT
// FIXED THIS ROUND"), on the owner's own report of the three symptoms it
// predicted: a badly-bowed mosaic with large black regions, visibly blurry /
// ghosted joins, and a capture that reads as covering less than it really did.
//
// That note asked for one specific thing before any of this arithmetic could
// be trusted: "build an isolated harness with a SYNTHETIC rotating-camera test
// scene ... do not ship it on inspection alone." That is exactly how every
// function below was developed — `test.mjs` now renders perspective frames out
// of a known synthetic EQUIRECTANGULAR scene at known yaw angles, pushes them
// through this whole pipeline, and checks the recovered panorama against the
// ground-truth scene it came from. Nothing here is shipped on inspection.
//
// THE GEOMETRY, stated once so the three functions below read as one idea:
//
//   A camera rotating about a fixed point does NOT translate. Two frames a few
//   degrees apart are related by a rotation (a homography), not a shift — so
//   pasting raw perspective frames at a pure (dx,dy) offset is wrong the
//   moment the rotation is more than a couple of degrees, and wrong in a way
//   that compounds along the chain. Reprojecting each frame onto a CYLINDER
//   first makes a pure yaw rotation become exactly a horizontal shift in the
//   warped image, which is the one motion this file's existing alignment
//   search (`estimateOffset`) already models correctly. So the warp is not a
//   cosmetic improvement to the stitch — it is what makes the existing
//   translation-only alignment geometrically VALID in the first place.
//
//   Perspective -> cylinder, for a destination column at yaw θ off-axis:
//       x_src = f·tan(θ) + cx          y_src = (y_dst - cy_dst)/cos(θ) + cy
//   where f = (W/2)/tan(HFOV/2) is the focal length in pixels.
//
//   Cylinder -> equirectangular is then a pure per-ROW remap, because both
//   projections are already linear in yaw across x. Only the vertical mapping
//   differs: a cylinder is linear in tan(elevation), an equirectangular image
//   is linear in elevation itself.
//       y_cyl = cy_cyl + f·tan(φ)      for equirect row elevation φ
// ===========================================================================

// A phone's main camera is ~65° horizontal FOV in landscape. This is the same
// assumption the CLIENT pipeline (pano360.js) already makes for its own
// cylindrical remap, kept identical on purpose so a locally-stitched and a
// server-stitched panorama of the same capture have the same geometry rather
// than two subtly different ones.
// ⚠️ A portrait-held phone (the common way to record a walk-around) has the
// NARROW field across the frame's width, so `hfovForFrame` reads the frame's
// own aspect and picks accordingly rather than applying one number to both.
export const DEFAULT_HFOV_DEG = 65;
export const DEG = Math.PI / 180;

export function hfovForFrame(frameWidth, frameHeight, baseHfovDeg) {
  const base = (baseHfovDeg || DEFAULT_HFOV_DEG) * DEG;
  if (frameHeight <= frameWidth) return base;
  // Portrait: the ~65° field now runs down the LONG side, so the field across
  // the (shorter) width is narrower. Derived from the same focal length rather
  // than guessed: f is fixed by the long side, and the short side's half-angle
  // is atan((short/2)/f).
  const f = (frameHeight / 2) / Math.tan(base / 2);
  return 2 * Math.atan((frameWidth / 2) / f);
}

export function focalPx(frameWidth, hfovRad) {
  return (frameWidth / 2) / Math.tan(hfovRad / 2);
}

// The size of the cylindrical image a `frameWidth`×`frameHeight` perspective
// frame reprojects into.
//
// ⚠️⚠️ The HEIGHT is the part that is easy to get wrong and is what keeps the
// warp FREE OF BLACK CORNERS — the classic "pincushion" artefact of a naive
// cylindrical warp, and one of the two things producing the black regions the
// owner reported. A cylindrical warp stretches the source vertically by
// 1/cos(θ) as it moves off-axis, so the outermost columns run out of source
// rows first. Rather than emitting those as black and relying on a
// neighbouring frame to cover them, the destination is cropped up front to the
// vertical band that is valid at EVERY column — |y| ≤ cy·cos(θ_max). Every
// pixel of the returned image is then real image data, by construction.
//
// ⚠️ θ_max is derived from the ROUNDED destination width, not from hfov/2
// directly: rounding `f·hfov` to whole pixels can put the last column a hair
// past hfov/2, and computing the height from the un-rounded angle would then
// leave that one column sampling just outside the source.
export function cylindricalDims(frameWidth, frameHeight, hfovRad) {
  const f = focalPx(frameWidth, hfovRad);
  const width = Math.max(1, Math.round(f * hfovRad));
  const thetaMax = (width - 1) / (2 * f);
  const cySrc = (frameHeight - 1) / 2;
  const height = Math.max(1, Math.floor(2 * cySrc * Math.cos(thetaMax)) + 1);
  return { width, height, focal: f, thetaMax };
}

// Bilinear RGB sample with edge clamping. Used by the warp instead of the
// nearest-neighbour sampling the rest of this file uses for thumbnails —
// nearest is fine for a thumbnail nobody aligns against, and is a real
// sharpness/aliasing loss on the one resample every output pixel passes
// through. This is part of the answer to "the stitched photo is blurry".
export function sampleBilinearRgb(rgb, w, h, x, y, out) {
  const xc = x < 0 ? 0 : (x > w - 1 ? w - 1 : x);
  const yc = y < 0 ? 0 : (y > h - 1 ? h - 1 : y);
  const x0 = Math.floor(xc);
  const y0 = Math.floor(yc);
  const x1 = x0 + 1 > w - 1 ? w - 1 : x0 + 1;
  const y1 = y0 + 1 > h - 1 ? h - 1 : y0 + 1;
  const fx = xc - x0;
  const fy = yc - y0;
  const i00 = (y0 * w + x0) * 3;
  const i10 = (y0 * w + x1) * 3;
  const i01 = (y1 * w + x0) * 3;
  const i11 = (y1 * w + x1) * 3;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  for (let c = 0; c < 3; c++) {
    out[c] = (rgb[i00 + c] * w00 + rgb[i10 + c] * w10 + rgb[i01 + c] * w01 + rgb[i11 + c] * w11 + 0.5) | 0;
  }
  return out;
}

// Reproject one perspective RGB frame onto a cylinder. Returns a NEW buffer
// whose every pixel is real image data (see cylindricalDims).
export function warpToCylindrical(rgb, w, h, hfovRad) {
  const dims = cylindricalDims(w, h, hfovRad);
  const cw = dims.width;
  const ch = dims.height;
  const f = dims.focal;
  const out = new Uint8Array(cw * ch * 3);
  const cxSrc = (w - 1) / 2;
  const cySrc = (h - 1) / 2;
  const cxDst = (cw - 1) / 2;
  const cyDst = (ch - 1) / 2;
  const px = [0, 0, 0];
  // tan/cos depend only on the column — hoisted out of the row loop, which on
  // a 3600-wide composite frame is the difference between ~2 and ~2·height
  // transcendental calls per column.
  const xs = new Float64Array(cw);
  const invCos = new Float64Array(cw);
  for (let xd = 0; xd < cw; xd++) {
    const theta = (xd - cxDst) / f;
    xs[xd] = f * Math.tan(theta) + cxSrc;
    invCos[xd] = 1 / Math.cos(theta);
  }
  for (let yd = 0; yd < ch; yd++) {
    const yRel = yd - cyDst;
    const rowBase = yd * cw * 3;
    for (let xd = 0; xd < cw; xd++) {
      sampleBilinearRgb(rgb, w, h, xs[xd], yRel * invCos[xd] + cySrc, px);
      const di = rowBase + xd * 3;
      out[di] = px[0];
      out[di + 1] = px[1];
      out[di + 2] = px[2];
    }
  }
  return { rgb: out, width: cw, height: ch, focal: f };
}

// Same warp, straight to the 8-bit GRAYSCALE the alignment search consumes —
// so the aligning step never has to allocate a full RGB cylindrical frame it
// would immediately throw away. Takes RGBA (what a JPEG decode hands back),
// matching `toGrayscaleDownsampled`'s own input shape.
export function warpRgbaToCylindricalGray(rgba, w, h, targetWidth, hfovRad) {
  // Downsample FIRST (cheap, and the alignment search wants a small image
  // anyway), then warp at that small size.
  const small = toGrayscaleDownsampled(rgba, w, h, targetWidth);
  const dims = cylindricalDims(small.width, small.height, hfovRad);
  const cw = dims.width;
  const ch = dims.height;
  const f = dims.focal;
  const out = new Uint8Array(cw * ch);
  const cxSrc = (small.width - 1) / 2;
  const cySrc = (small.height - 1) / 2;
  const cxDst = (cw - 1) / 2;
  const cyDst = (ch - 1) / 2;
  const xs = new Float64Array(cw);
  const invCos = new Float64Array(cw);
  for (let xd = 0; xd < cw; xd++) {
    const theta = (xd - cxDst) / f;
    xs[xd] = f * Math.tan(theta) + cxSrc;
    invCos[xd] = 1 / Math.cos(theta);
  }
  for (let yd = 0; yd < ch; yd++) {
    const yRel = yd - cyDst;
    for (let xd = 0; xd < cw; xd++) {
      const sx = Math.max(0, Math.min(small.width - 1, xs[xd]));
      const sy = Math.max(0, Math.min(small.height - 1, yRel * invCos[xd] + cySrc));
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(small.width - 1, x0 + 1), y1 = Math.min(small.height - 1, y0 + 1);
      const fx = sx - x0, fy = sy - y0;
      const v = small.gray[y0 * small.width + x0] * (1 - fx) * (1 - fy)
        + small.gray[y0 * small.width + x1] * fx * (1 - fy)
        + small.gray[y1 * small.width + x0] * (1 - fx) * fy
        + small.gray[y1 * small.width + x1] * fx * fy;
      out[yd * cw + xd] = (v + 0.5) | 0;
    }
  }
  return { width: cw, height: ch, gray: out };
}

// ---------------------------------------------------------------------------
// Vertical drift control.
//
// ⚠️⚠️ THIS IS THE SECOND HALF OF THE "big black regions" REPORT, and it is a
// different cause from the pincushion corners `cylindricalDims` handles.
// `cumulativePlacements` sums every pair's dy along the chain with nothing
// bounding it, so the per-pair estimate's own noise is a RANDOM WALK: over ~100
// pairs a ±1px jitter wanders tens of pixels up or down, and the mosaic BOWS.
// The bounding box then has to cover that whole excursion, and everything the
// arc does not reach is empty canvas — which is exactly the curved black band
// across the top and bottom of the owner's screenshots.
//
// Clamping the CUMULATIVE y (not the per-pair dy) keeps real, slow tilt
// tracking up to ±maxAbsY and refuses to let the chain wander past it. The
// cost, stated plainly: a capture that genuinely tilts further than maxAbsY
// over its length is held at the clamp, so a little real vertical content is
// traded away — a bounded, uniform trade against an unbounded bow that makes
// the whole panorama unusable.
// ---------------------------------------------------------------------------
export function cumulativePlacementsClamped(pairOffsets, scaleFactor, maxAbsY) {
  const out = [{ x: 0, y: 0 }];
  let x = 0;
  let yRaw = 0;
  for (const p of pairOffsets) {
    x += p.dx * scaleFactor;
    yRaw += p.dy * scaleFactor;
    const y = yRaw > maxAbsY ? maxAbsY : (yRaw < -maxAbsY ? -maxAbsY : yRaw);
    out.push({ x: Math.round(x), y: Math.round(y) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 360° normalisation — the owner's item 2: "code assumes video starts at 0 and
// ends at 360, but sometimes 360 extends."
//
// Nothing upstream ever measured how far the camera actually turned; frames
// were simply laid end to end. Once every frame is cylindrically warped, that
// measurement is available for free and is exact: arc length / focal length IS
// the yaw angle in radians. Over-rotation past a full turn therefore stops
// being invisible — `framesForFullTurn` finds the frame at which the capture
// has come back around to where it started, so the duplicated tail can be
// dropped instead of being pasted over the beginning of the panorama.
// ---------------------------------------------------------------------------
export const TWO_PI = Math.PI * 2;

export function coverageYaw(pairOffsets, focalAlign) {
  let sum = 0;
  for (const p of pairOffsets) sum += p.dx;
  return focalAlign > 0 ? sum / focalAlign : 0;
}

// How many frames to KEEP so the kept span covers at most one full turn.
// Returns pairOffsets.length + 1 (i.e. everything) when the capture never gets
// all the way round — under-rotation is a different problem and is NOT solved
// by throwing frames away.
export function framesForFullTurn(pairOffsets, focalAlign) {
  if (!(focalAlign > 0)) return pairOffsets.length + 1;
  let sum = 0;
  for (let i = 0; i < pairOffsets.length; i++) {
    sum += pairOffsets[i].dx;
    if (Math.abs(sum) / focalAlign > TWO_PI) return i + 1;
  }
  return pairOffsets.length + 1;
}

// ---------------------------------------------------------------------------
// Paste only a COLUMN BAND of a frame, feathered at both ends.
//
// ⚠️⚠️ THIS IS THE MAIN ANSWER TO "the stitched photo is blurry", and the
// reason is not obvious from reading `pasteFrame`. With frames pasted whole,
// in order, each one OVERWRITES its predecessor everywhere they overlap — so
// for a left-to-right pan the pixel you finally see always comes from close to
// some frame's LEFT EDGE. That is the worst part of any frame: furthest
// off-axis, where the cylindrical warp stretches hardest, where lens
// distortion is largest, and where any alignment error is most visible. At the
// sampling density this feature now uses (108 frames), consecutive frames
// overlap enormously, so this was throwing away almost every frame's sharp
// centre and keeping only its soft edge.
//
// Pasting a band centred on each frame's own optical centre — from halfway
// back to the previous frame to halfway on to the next, plus a feather —
// means every output pixel comes from near the middle of some frame instead.
// This is the standard "seam at the midpoint" rule a real stitcher uses, and
// it also cuts ghosting: a given pixel is now a blend of two frames across a
// narrow feather, not of a dozen frames stacked on top of each other.
// ---------------------------------------------------------------------------
export function pasteFrameBand(canvas, cw, ch, frameRgb, fw, fh, offsetX, offsetY, bandX0, bandX1, featherPx) {
  const x0 = Math.max(0, Math.floor(bandX0));
  const x1 = Math.min(fw, Math.ceil(bandX1));
  if (x1 <= x0) return;
  const feather = Math.max(0, featherPx | 0);
  for (let y = 0; y < fh; y++) {
    const cy = offsetY + y;
    if (cy < 0 || cy >= ch) continue;
    const cRowBase = cy * cw;
    const fRowBase = y * fw;
    for (let x = x0; x < x1; x++) {
      const cx = offsetX + x;
      if (cx < 0 || cx >= cw) continue;
      let a = 1;
      if (feather > 0) {
        // Ramp in from the band's left edge and out at its right edge, but
        // only where that edge is a real seam — a band clipped to the frame's
        // own 0 / fw boundary has nothing beyond it to blend into, so
        // feathering there would fade into whatever happened to be on the
        // canvas (usually nothing) and darken the join instead of hiding it.
        if (x - x0 < feather && bandX0 > 0) a = Math.min(a, (x - x0) / feather);
        if (x1 - 1 - x < feather && bandX1 < fw) a = Math.min(a, (x1 - 1 - x) / feather);
      }
      const si = (fRowBase + x) * 3;
      const di = (cRowBase + cx) * 3;
      if (a >= 1) {
        canvas[di] = frameRgb[si];
        canvas[di + 1] = frameRgb[si + 1];
        canvas[di + 2] = frameRgb[si + 2];
      } else {
        canvas[di] = (canvas[di] * (1 - a) + frameRgb[si] * a) | 0;
        canvas[di + 1] = (canvas[di + 1] * (1 - a) + frameRgb[si + 1] * a) | 0;
        canvas[di + 2] = (canvas[di + 2] * (1 - a) + frameRgb[si + 2] * a) | 0;
      }
    }
  }
}

// The column band frame `i` should contribute: from halfway back to the
// previous frame's centre to halfway on to the next frame's centre, widened by
// `featherPx` at each seam so neighbouring bands overlap enough to blend. The
// first and last frames extend to their own outer edge, so the panorama has no
// gap at either end.
export function bandForFrame(placements, i, frameWidth, featherPx) {
  const c = frameWidth / 2;
  const here = placements[i].x;
  const prev = i > 0 ? placements[i - 1].x : null;
  const next = i < placements.length - 1 ? placements[i + 1].x : null;
  const x0 = prev === null ? 0 : c - Math.abs(here - prev) / 2 - featherPx;
  const x1 = next === null ? frameWidth : c + Math.abs(next - here) / 2 + featherPx;
  return { x0: Math.max(0, x0), x1: Math.min(frameWidth, Math.max(x0 + 1, x1)) };
}

// ---------------------------------------------------------------------------
// Cylindrical strip -> EQUIRECTANGULAR, the format the viewer actually
// declares it is rendering (`type: 'equirectangular'` in Pannellum).
//
// ⚠️⚠️ THE MISMATCH THIS FIXES IS ITS OWN, THIRD CAUSE OF THE REPORTED BLACK
// AND BOWING, and it sits in the VIEWER rather than in the stitch: the
// pipeline produced a CYLINDRICAL mosaic and handed it to Pannellum as an
// EQUIRECTANGULAR texture. Those two projections agree across x (both linear
// in yaw) and disagree down y — a cylinder is linear in tan(elevation), an
// equirectangular image is linear in elevation. Feeding one to the other bends
// every horizontal line into an arc, which is precisely the curved black
// boundary arcing across the owner's screenshots. Remapping y here — the only
// axis that differs — makes the image genuinely be what the viewer says it is.
//
// The output covers exactly 360° horizontally, so the viewer's own
// `vaov = 360 * height / width` reads the correct vertical field straight off
// the image's aspect ratio with nothing else to plumb through.
//
// `outHeight` is derived, never chosen: it is however tall the captured band
// really is at the equirectangular scale. Nothing is padded, so every pixel of
// the result is real image data and the panorama has no black in it at all.
// ---------------------------------------------------------------------------
export function equirectDims(stripHeight, focal, horizonY, outWidth) {
  const k = outWidth / TWO_PI;                       // pixels per radian
  const halfBand = Math.min(horizonY, stripHeight - 1 - horizonY);
  const phiMax = Math.atan(halfBand / focal);
  return { width: outWidth, height: Math.max(1, Math.round(2 * phiMax * k)), phiMax, k };
}

// How much of the strip's own width is ONE full turn.
//
// ⚠️⚠️ THE STRIP IS WIDER THAN THE CAPTURE'S ROTATION, and getting this wrong
// is a silent ~18% horizontal scale error — caught only by comparing a
// recovered panorama against the synthetic scene it was rendered from, never
// by reading the code. The frames are placed by their alignment offsets, so
// the distance between the FIRST and LAST frame's centres is the rotation. But
// the strip also keeps half a frame of real content before the first centre
// and half a frame after the last, so the strip's own angular width is
// `rotation + HFOV`. Mapping the whole strip onto 360° therefore squeezes a
// ~425° strip into a 360° output and every feature lands in the wrong place.
// One turn is exactly `2π · focal` pixels of arc, so that — not `stripW` — is
// what maps onto the output.
export function fullTurnCrop(stripW, focal) {
  const turnPx = TWO_PI * focal;
  return stripW >= turnPx ? turnPx : stripW;
}

export function cylStripToEquirect(stripRgb, stripW, stripH, focal, horizonY, outWidth) {
  const dims = equirectDims(stripH, focal, horizonY, outWidth);
  const outW = dims.width;
  const outH = dims.height;
  const out = new Uint8Array(outW * outH * 3);
  // x normalisation to exactly one turn. When the capture got all the way
  // round (or past it — see framesForFullTurn) this is exact and the duplicated
  // tail is simply not sampled. When it did not, the shorter arc is stretched
  // to fill 360° instead of leaving a black wedge: a uniform yaw scale error
  // the viewer cannot show as a hole, in place of a gap it would show as
  // black. The real measured coverage is reported on the job either way, so
  // the stretch is stated rather than hidden.
  const xScale = fullTurnCrop(stripW, focal) / outW;
  const px = [0, 0, 0];
  const srcX = new Float64Array(outW);
  for (let xe = 0; xe < outW; xe++) srcX[xe] = xe * xScale;
  for (let ye = 0; ye < outH; ye++) {
    const phi = dims.phiMax - ye / dims.k;
    const sy = horizonY - focal * Math.tan(phi);
    const rowBase = ye * outW * 3;
    for (let xe = 0; xe < outW; xe++) {
      sampleBilinearRgb(stripRgb, stripW, stripH, srcX[xe], sy, px);
      const di = rowBase + xe * 3;
      out[di] = px[0];
      out[di + 1] = px[1];
      out[di + 2] = px[2];
    }
  }
  return { rgb: out, width: outW, height: outH };
}
