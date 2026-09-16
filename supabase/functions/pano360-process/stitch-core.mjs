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
  return { dx: best.dx, dy: best.dy, score: isFinite(best.score) ? best.score : null, fallback };
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
// linearly feathered across its own LEFT `featherPx` columns so a seam
// blends into whatever the canvas already has there instead of cutting hard
// — pass featherPx=0 for the very first frame placed (nothing to blend
// into yet).
// ---------------------------------------------------------------------------
export function pasteFrame(canvas, cw, ch, frameRgb, fw, fh, offsetX, offsetY, featherPx) {
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
      if (featherPx > 0 && x < featherPx) a = x / featherPx;
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

