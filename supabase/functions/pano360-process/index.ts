// Edge Function: pano360-process
// -----------------------------------------------------------------------------
// The server-side worker for 360° panorama stitching. See
// migrations/2026-09-16-pano360-jobs.sql for the full design rationale (why
// this exists, how a job is driven forward, the one manual Vault step) — this
// file is that migration's other half.
//
// WHAT A SINGLE INVOCATION DOES, deliberately kept to ONE bounded step:
//   status='queued'      -> flip to 'aligning' (step_cursor=0), self-chain.
//   status='aligning'     -> align exactly ONE frame pair (decode both frames,
//                            downsample to grayscale, cross-correlate), append
//                            the offset, advance step_cursor by 1, self-chain.
//                            Once step_cursor reaches pairs_total, flip to
//                            'compositing' (step_cursor=0) instead.
//   status='compositing'  -> paste exactly ONE frame onto the growing raw
//                            composite buffer (stored in Storage between
//                            steps, since it can be several MB — see
//                            composite_state), advance step_cursor by 1,
//                            self-chain. Once step_cursor reaches
//                            frame_count, JPEG-encode the composite + a 4:3
//                            thumbnail, upload both, and finish (status='done'
//                            — no further self-chain).
//   status in (done,failed,cancelled) -> no-op (a stray/duplicate wake).
//
// ⚠️⚠️ EVERY REAL WRITE USES OPTIMISTIC CONCURRENCY (`.eq('step_cursor', …)`
// on the UPDATE), because a job can legitimately be woken twice in quick
// succession — the normal self-chain AND, rarely, the cron safety net waking
// the same job before the self-chain's own invocation has finished. If our
// UPDATE's step_cursor no longer matches (another invocation already moved
// it), we lost the race: return without self-chaining AGAIN, since whichever
// invocation actually won already scheduled the next step itself. Without
// this, two invocations advancing the same job at once would each append
// their own (different) offset for the SAME pair, or paste the SAME frame
// twice at different canvas positions — silent corruption of the panorama,
// not a crash, which is exactly the failure mode optimistic concurrency
// exists to rule out.
//
// ⚠️ ANY THROWN ERROR marks the job 'failed' with the error message and does
// NOT self-chain — a job that failed once must not spin forever (the cron
// safety net's own `attempts` cap is the LAST resort, not the normal path;
// this is the normal path).
//
// DEPLOY (from planning-app/) — multi-file function; the CLI bundles the
// whole `pano360-process/` directory, including stitch-core.mjs, unmodified:
//   supabase functions deploy pano360-process --project-ref bgupuqnkqhixpuctyder
// No `--no-verify-jwt` here (unlike reconstruction-webhook) — every real
// caller (pg_net, via pano360_invoke) sends the project's own service-role
// key as its Bearer token, which the platform's default JWT check accepts
// like any other valid, project-signed JWT.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jpeg from "https://esm.sh/jpeg-js@0.4.4";
import {
  estimateOffset,
  rgbaToRgb,
  rgbToRgba,
  capScaleFactor,
  computeBounds,
  makeCanvas,
  centerCropRect,
  cropRgb,
  resizeRgbNearest,
  THUMB_ASPECT,
  // 2026-09-17 — cylindrical reprojection + equirectangular output. See
  // stitch-core.mjs's own header for the geometry and for the synthetic
  // rotating-camera verification every one of these was developed against.
  hfovForFrame,
  cylindricalDims,
  warpToCylindrical,
  warpRgbaToCylindricalGray,
  cumulativePlacementsClamped,
  coverageYaw,
  framesForFullTurn,
  pasteFrameBand,
  bandForFrame,
  cylStripToEquirect,
} from "./stitch-core.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const BUCKET = "progress-photos";

// Alignment runs on a small downsampled grayscale image — cheap to search,
// and ALIGN_TARGET_WIDTH is a fixed constant so the scale factor between
// "alignment resolution" and "composite resolution" is always exactly
// (compositeFrameWidth / ALIGN_TARGET_WIDTH), never a rounded approximation
// (see toGrayscaleDownsampled: with an integer target width and every frame
// sharing the same natural width, the returned width is always exactly
// ALIGN_TARGET_WIDTH — round(width * (target/width)) === round(target)).
const ALIGN_TARGET_WIDTH = 240;

// The composite is built from frames downsized to this width (full-res phone
// frames would make an already-large panorama unworkably huge, and Edge
// Function memory is not unbounded) — then the WHOLE composite is additionally
// capped below, since a long pan at this per-frame width can still exceed a
// sane canvas size.
const COMPOSITE_FRAME_MAX_WIDTH = 640;
// ⚠️ Raised from 3600/1200 (2026-09-17). Cylindrical warping makes the strip
// SHORTER than it used to be (its height is cropped to the all-valid band —
// see cylindricalDims) and its width is now bounded by one full turn plus one
// frame, because anything past a full turn is trimmed rather than pasted. A
// higher width cap therefore costs less memory than the old one did and lets a
// full turn keep its native per-frame resolution instead of being scaled down.
const MAX_COMPOSITE_WIDTH = 4200;
const MAX_COMPOSITE_HEIGHT = 1400;

// ⚠️⚠️ WAS 0.12, NOW 0.02 — and this is a real part of the "blurry" fix, not a
// tuning nudge. A 12%-of-frame-width feather made sense when whole frames were
// pasted over each other; with band pasting (pasteFrameBand) each frame
// contributes only the slice between the midpoints to its neighbours, so the
// feather only has to hide a seam, not blend a whole frame. Left at 12% it
// would smear each join across ~77px and undo most of what band pasting buys.
const FEATHER_FRACTION = 0.02;

// The final equirectangular image's width. One full turn of the strip is
// 2π·focal composite pixels (~3150 for a 640-wide landscape frame at 65°), so
// this preserves the strip's own horizontal resolution without inventing any.
const EQUIRECT_MAX_WIDTH = 3200;

// How far the running vertical placement may wander from the first frame's
// row, as a fraction of the (warped) frame height. See
// cumulativePlacementsClamped — this is what stops the mosaic bowing into an
// arc, and the same band is cropped off both edges at the end so every
// remaining pixel is real.
const DRIFT_CLAMP_FRACTION = 0.02;

const THUMB_WIDTH = 480;
const JPEG_QUALITY = 85;

// -----------------------------------------------------------------------------
// Tiny helpers
// -----------------------------------------------------------------------------

async function downloadBytes(admin: any, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Could not download '${path}': ${error?.message || "no data"}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function uploadBytes(admin: any, path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Could not upload '${path}': ${error.message}`);
}

function decodeJpeg(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } {
  // useTArray -> a Uint8Array (not a plain Array), directly compatible with
  // every stitch-core function, which all assume typed-array pixel buffers.
  return jpeg.decode(bytes, { useTArray: true }) as any;
}

function encodeJpeg(rgb: Uint8Array, width: number, height: number, quality: number): Uint8Array {
  const rgba = rgbToRgba(rgb, width, height);
  const out = jpeg.encode({ data: rgba, width, height }, quality);
  return out.data as Uint8Array;
}

// Decode a frame at its Storage path and return it as RGB at the COMPOSITE
// resolution (already downsized to `targetWidth`, aspect-ratio preserved).
// Used only by the compositing phase — the aligning phase works on the raw
// decoded RGBA directly (toGrayscaleDownsampled takes RGBA), never resized
// first, since resizing before downsampling would just waste a pass.
async function decodeFrameForComposite(
  admin: any,
  path: string,
  targetWidth: number,
): Promise<{ rgb: Uint8Array; width: number; height: number }> {
  const jpegBytes = await downloadBytes(admin, path);
  const decoded = decodeJpeg(jpegBytes);
  const rgb = rgbaToRgb(decoded.data, decoded.width, decoded.height);
  // Never UPSCALE — this function only ever shrinks a frame for the
  // composite; a target wider than the source (a tiny/low-res source clip)
  // would otherwise invent detail that was never there.
  const clampedTarget = Math.min(targetWidth, decoded.width);
  if (decoded.width === clampedTarget) {
    return { rgb, width: decoded.width, height: decoded.height };
  }
  const targetHeight = Math.max(1, Math.round((decoded.height * clampedTarget) / decoded.width));
  const resized = resizeRgbNearest(rgb, decoded.width, decoded.height, clampedTarget, targetHeight);
  return { rgb: resized, width: clampedTarget, height: targetHeight };
}

type CompositeState = {
  storagePath: string;
  width: number; // canvas width, AFTER capping
  height: number; // canvas height, AFTER capping
  frameWidth: number; // per-frame width used when pasting, AFTER capping
  frameHeight: number;
  shiftX: number; // add to a raw placement.x to get a non-negative canvas x
  shiftY: number;
  scaleFactor: number; // alignment-resolution px -> composite-resolution px, AFTER capping
  hfov: number;        // radians, derived from the frame's own aspect (hfovForFrame)
  focal: number;       // composite-resolution pixels per radian of yaw
  keepFrames: number;  // frames kept after trimming anything past one full turn
  driftClamp: number;  // composite-resolution px, how far the chain was allowed to wander
  validY0: number;     // first canvas row covered by EVERY kept frame
  validH: number;      // how many rows are covered by every kept frame
  coverageDeg: number; // how far the capture actually turned — reported, never guessed
};

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const PL_URL = Deno.env.get("SUPABASE_URL")!;
  const PL_SERVICE = Deno.env.get("PL_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(PL_URL, PL_SERVICE, { auth: { persistSession: false } });

  // ---- Authorize the caller -------------------------------------------------
  // The two REAL callers — the INSERT trigger and the cron safety net, both
  // via pano360_invoke — always send the project's own service-role-equivalent
  // secret as the Bearer token (see the migration). ⚠️⚠️ 2026-09-17: this used
  // to be checked by DECODING the token as a JWT and reading `role ===
  // "service_role"` off its payload — which is exactly why every 360° job sat
  // at "queued" once this project's own service-role key rotated from the
  // legacy `eyJ...` JWT format to the newer opaque `sb_secret_...` format:
  // `auth.split(".")[1]` on a non-JWT string is `undefined`, and decoding it
  // threw, so `payload` was always null and every legitimate call from
  // `pano360_invoke` was rejected as "Could not read the bearer token" — not
  // a config mistake, a real bug in this file, found live by an owner working
  // through the platform gateway's own migration to the new key format one
  // token at a time (see `migrations/2026-09-16-pano360-jobs.sql` and this
  // module's own CLAUDE.md for the full chase).
  // ⚠️ Checked by DIRECT EQUALITY against `PL_SERVICE` above instead — the
  // same env-injected secret this function already uses to build its own
  // admin client — which is correct for BOTH key formats (it's just a string
  // comparison, agnostic to whether that string happens to be JWT-shaped)
  // and is arguably the tighter check anyway: it trusts only the literal
  // secret this deployment was actually given, never anything merely shaped
  // like a service-role JWT. The JWT-decode path is kept, but ONLY as the
  // fallback for an ordinary user's own JWT (nothing in this app sends one
  // today, but nothing forbids it either) — held to this app's own baseline
  // bar: an approved account, matching the `is_writer()` gate this table's
  // own INSERT policy already requires to create a job in the first place.
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth) return json({ error: "Missing Authorization" }, 401);
  if (auth !== PL_SERVICE) {
    let payload: any = null;
    try {
      const seg = auth.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      payload = JSON.parse(atob(seg));
    } catch { payload = null; }
    if (!payload) return json({ error: "Could not read the bearer token" }, 401);
    const uid = payload.sub;
    if (!uid) return json({ error: "Token names no user and is not a service-role key" }, 401);
    const { data: prof } = await admin.from("users").select("status").eq("id", uid).maybeSingle();
    if (!prof || prof.status !== "approved") return json({ error: "Not an approved user" }, 403);
  }

  // ---- Load the job ----------------------------------------------------------
  let jobId: string | null = null;
  try { jobId = (await req.json())?.job_id || null; } catch { /* no body */ }
  if (!jobId) return json({ error: "job_id is required" }, 400);

  const { data: job, error: jobErr } = await admin.from("pano360_jobs").select("*").eq("id", jobId).maybeSingle();
  if (jobErr) return json({ error: jobErr.message }, 500);
  if (!job) return json({ error: "Job not found" }, 404);

  // A terminal status (including 'cancelled', which a client can set at any
  // time) means there is nothing left for this invocation to do — a stray
  // wake (e.g. the cron sweep and a self-chain landing moments apart) is a
  // harmless no-op, not an error.
  if (!["queued", "aligning", "compositing"].includes(job.status)) {
    return json({ ok: true, status: job.status, note: "job is terminal — nothing to do" });
  }

  const nowIso = () => new Date().toISOString();

  // A single next-step CAS update. Returns the updated row, or null if we
  // lost the race (another invocation already advanced step_cursor) — the
  // caller should then simply return without self-chaining again.
  async function commitStep(fromCursor: number, patch: Record<string, unknown>) {
    const { data, error } = await admin
      .from("pano360_jobs")
      .update({ ...patch, updated_at: nowIso() })
      .eq("id", jobId)
      .eq("step_cursor", fromCursor)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Could not save progress: ${error.message}`);
    return data; // null if the CAS missed (someone else already moved it)
  }

  async function selfChain() {
    try { await admin.rpc("pano360_invoke", { p_job_id: jobId }); } catch { /* best-effort */ }
  }

  async function fail(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await admin.from("pano360_jobs").update({
        status: "failed",
        error: message,
        updated_at: nowIso(),
      }).eq("id", jobId);
    } catch { /* if even this fails, the cron sweep's attempts cap is the backstop */ }
    return json({ ok: false, error: message });
  }

  try {
    // =========================================================================
    // status: queued -> aligning (nothing decoded yet; just start the clock)
    // =========================================================================
    if (job.status === "queued") {
      if (job.frame_count < 2) {
        return await fail(new Error(`A 360° capture needs at least 2 frames — this job has ${job.frame_count}.`));
      }
      const updated = await commitStep(0, {
        status: "aligning",
        pairs_total: job.frame_count - 1,
        pairs_fallback: 0,
        offsets: [],
        progress_pct: 0,
        progress_msg: "Aligning frames…",
      });
      if (updated) await selfChain();
      return json({ ok: true, status: "aligning" });
    }

    // =========================================================================
    // status: aligning — exactly ONE frame pair per invocation
    // =========================================================================
    if (job.status === "aligning") {
      const cursor: number = job.step_cursor;
      const pairsTotal: number = job.pairs_total ?? job.frame_count - 1;

      if (cursor >= pairsTotal) {
        // Every pair aligned — hand off to compositing.
        const updated = await commitStep(cursor, {
          status: "compositing",
          step_cursor: 0,
          composite_state: null,
          progress_pct: 50,
          progress_msg: "Building the panorama…",
        });
        if (updated) await selfChain();
        return json({ ok: true, status: "compositing" });
      }

      const [prevBytes, currBytes] = await Promise.all([
        downloadBytes(admin, job.frame_paths[cursor]),
        downloadBytes(admin, job.frame_paths[cursor + 1]),
      ]);
      const prevDecoded = decodeJpeg(prevBytes);
      const currDecoded = decodeJpeg(currBytes);
      // ⚠️⚠️ WARP FIRST, THEN ALIGN. This one reordering is what makes the
      // translation-only search below geometrically VALID: a camera turning on
      // the spot relates two frames by a rotation, and only in cylindrical
      // coordinates does that rotation become the plain horizontal shift
      // `estimateOffset` looks for. Measured on the synthetic rotating-camera
      // harness (test.mjs): the best-match residual stays flat at ~0.3–0.9 as
      // the step grows from 2° to 8°, where un-warped frames degrade from 1.6
      // to 5.2 — that growing residual IS the ghosting/blur in the join.
      const hfov = hfovForFrame(prevDecoded.width, prevDecoded.height);
      const prevGray = warpRgbaToCylindricalGray(prevDecoded.data, prevDecoded.width, prevDecoded.height, ALIGN_TARGET_WIDTH, hfov);
      const currGray = warpRgbaToCylindricalGray(currDecoded.data, currDecoded.width, currDecoded.height, ALIGN_TARGET_WIDTH, hfov);
      // ⚠️⚠️ `subPixel` is not a refinement of a refinement — these offsets are
      // SUMMED along the whole chain, so a consistent rounding bias becomes a
      // scale error on the finished panorama. Measured on the synthetic
      // rotating-camera harness: without it a true 360° turn reports itself as
      // 372° and the recovered scene scores 8.53/255 against ground truth;
      // with it, 362° and 0.95. See estimateOffset's own comment.
      const offset = estimateOffset(
        prevGray.gray, prevGray.width, prevGray.height,
        currGray.gray, currGray.width, currGray.height,
        { subPixel: true },
      );

      const offsets = Array.isArray(job.offsets) ? job.offsets.slice() : [];
      offsets.push(offset);
      const fallbackCount = (job.pairs_fallback || 0) + (offset.fallback ? 1 : 0);
      const nextCursor = cursor + 1;

      const updated = await commitStep(cursor, {
        step_cursor: nextCursor,
        offsets,
        pairs_fallback: fallbackCount,
        progress_pct: Math.round((nextCursor / pairsTotal) * 50),
        progress_msg: `Aligning frames — ${nextCursor} of ${pairsTotal}…`,
      });
      if (updated) await selfChain();
      return json({ ok: true, status: "aligning", pair: cursor });
    }

    // =========================================================================
    // status: compositing — exactly ONE frame paste per invocation
    // =========================================================================
    if (job.status === "compositing") {
      const cursor: number = job.step_cursor;
      const frameCount: number = job.frame_count;

      // ---- Step 0: derive the WHOLE panorama's layout up front, before any
      // pixel is pasted, because capping the canvas size needs to know the
      // full extent first (see capScaleFactor's own doc comment in
      // stitch-core.mjs). ----
      let state: CompositeState;
      if (!job.composite_state) {
        const firstRaw = await decodeFrameForComposite(admin, job.frame_paths[0], COMPOSITE_FRAME_MAX_WIDTH);
        const hfov = hfovForFrame(firstRaw.width, firstRaw.height);
        // Every frame is warped to the SAME cylindrical size, so the layout can
        // be derived once from the first one.
        const cylRaw = cylindricalDims(firstRaw.width, firstRaw.height, hfov);
        const alignCyl = cylindricalDims(
          ALIGN_TARGET_WIDTH,
          Math.max(1, Math.round((firstRaw.height * ALIGN_TARGET_WIDTH) / firstRaw.width)),
          hfov,
        );
        const scaleFactorRaw = cylRaw.width / alignCyl.width;
        const offsets = Array.isArray(job.offsets) ? job.offsets : [];

        // ---- 360° normalisation (the owner's item 2) --------------------
        // Arc length / focal length is the yaw angle, so once the frames are
        // cylindrical the capture's real rotation is measurable rather than
        // assumed. Anything past a full turn is duplicated content that would
        // otherwise be pasted straight over the beginning of the panorama.
        const coverage = coverageYaw(offsets, alignCyl.focal);
        const keepFrames = Math.min(frameCount, framesForFullTurn(offsets, alignCyl.focal));
        const keptOffsets = offsets.slice(0, Math.max(0, keepFrames - 1));

        const driftRaw = Math.max(1, Math.round(cylRaw.height * DRIFT_CLAMP_FRACTION));
        const rawPlacements = cumulativePlacementsClamped(keptOffsets, scaleFactorRaw, driftRaw);
        const rawBounds = computeBounds(rawPlacements, cylRaw.width, cylRaw.height);

        const cap = capScaleFactor(rawBounds.width, rawBounds.height, MAX_COMPOSITE_WIDTH, MAX_COMPOSITE_HEIGHT);
        const scaleFactor = scaleFactorRaw * cap;
        const frameWidth = Math.max(1, Math.round(cylRaw.width * cap));
        const frameHeight = Math.max(1, Math.round(cylRaw.height * cap));
        const driftClamp = Math.max(1, Math.round(driftRaw * cap));
        const placements = cap === 1
          ? rawPlacements
          : cumulativePlacementsClamped(keptOffsets, scaleFactor, driftClamp);
        const bounds = computeBounds(placements, frameWidth, frameHeight);

        state = {
          storagePath: `${job.project_id}/pano360-jobs/${jobId}/composite.raw`,
          width: Math.max(1, bounds.width),
          height: Math.max(1, bounds.height),
          frameWidth,
          frameHeight,
          shiftX: -bounds.minX,
          shiftY: -bounds.minY,
          scaleFactor,
          hfov,
          focal: cylRaw.focal * cap,
          keepFrames,
          driftClamp,
          // ⚠️⚠️ The fully-covered band is the INTERSECTION of where the frames
          // actually landed, not `driftClamp` off each edge. Cropping by the
          // clamp assumes every frame sat at the clamp; on a capture that
          // wobbles, some frames sit at 0 and some at ±clamp, so the covered
          // band is narrower than the clamp implies and the difference comes
          // out as a thin black strip along one edge. Measured on the
          // synthetic harness with a 2° pitch wobble: 1.34% of the panorama
          // was still black with the clamp-based crop, 0% with this one.
          validY0: Math.max(...placements.map((q) => q.y)) - bounds.minY,
          validH: Math.max(
            1,
            Math.min(...placements.map((q) => q.y)) + frameHeight - bounds.minY
              - (Math.max(...placements.map((q) => q.y)) - bounds.minY),
          ),
          coverageDeg: Math.round(Math.abs(coverage) * (180 / Math.PI)),
        };

        const canvas = makeCanvas(state.width, state.height, [20, 20, 20]);
        const warped0 = warpToCylindrical(firstRaw.rgb, firstRaw.width, firstRaw.height, hfov);
        const frame0 = cap === 1
          ? warped0
          : { rgb: resizeRgbNearest(warped0.rgb, warped0.width, warped0.height, frameWidth, frameHeight), width: frameWidth, height: frameHeight };
        const feather0 = Math.max(1, Math.round(frameWidth * FEATHER_FRACTION));
        const band0 = bandForFrame(placements, 0, frameWidth, feather0);
        pasteFrameBand(
          canvas, state.width, state.height, frame0.rgb, frame0.width, frame0.height,
          state.shiftX + placements[0].x, state.shiftY + placements[0].y, band0.x0, band0.x1, feather0,
        );
        await uploadBytes(admin, state.storagePath, canvas, "application/octet-stream");

        const updated = await commitStep(cursor, {
          composite_state: state,
          step_cursor: 1,
          progress_pct: 50 + Math.round((1 / keepFrames) * 50),
          progress_msg: `Building the panorama — 1 of ${keepFrames}…`,
        });
        if (updated) await selfChain();
        return json({ ok: true, status: "compositing", frame: 0 });
      }

      state = job.composite_state as CompositeState;

      // ⚠️⚠️ UPGRADE GUARD. A job that reached `compositing` under the
      // pre-2026-09-17 pipeline has a composite_state with no `hfov`,
      // `keepFrames`, `validY0` … — and `warpToCylindrical(rgb, w, h,
      // undefined)` is not an error, it is NaN propagated silently through
      // every sampled coordinate, producing a black panorama with nothing in
      // the logs to say why. Rebuilding the layout is cheap (step 0 re-derives
      // everything from `offsets`, which survive untouched) and is the only
      // outcome that is actually correct, so a stale state is discarded rather
      // than half-trusted.
      // ⚠️ Stated rather than papered over: a job caught mid-`aligning` by this
      // same deploy keeps whatever offsets it had already measured WITHOUT the
      // cylindrical warp, mixed with warped ones for the rest. That is not
      // detectable from the row (the offsets carry no provenance) and it
      // degrades to a poor stitch, not a crash — a one-deploy transient a
      // planner can Discard and re-record. Adding a provenance marker would
      // need a column, which is not worth a migration for a minutes-long job.
      if (!state || typeof state.hfov !== "number" || typeof state.keepFrames !== "number") {
        const updated = await commitStep(cursor, {
          composite_state: null,
          step_cursor: 0,
          progress_msg: "Rebuilding the panorama layout…",
        });
        if (updated) await selfChain();
        return json({ ok: true, status: "compositing", note: "stale composite_state discarded" });
      }

      if (cursor >= state.keepFrames) {
        // Every frame pasted — finalize. Two transforms happen here, both of
        // them the difference between the owner's screenshots and a usable
        // panorama, and NEITHER can happen earlier: both need the whole strip.
        const raw = await downloadBytes(admin, state.storagePath);

        // (1) Crop to the band EVERY kept frame covered (state.validY0 /
        // validH, computed from the real placements at layout time). This is
        // what makes "no black" a property of the geometry rather than a hope:
        // cumulativePlacementsClamped bounded how far the chain could wander,
        // and this takes the intersection of where the frames actually landed.
        const bandY = Math.max(0, Math.min(state.validY0 | 0, state.height - 1));
        const stripH = Math.max(1, Math.min(state.validH | 0, state.height - bandY));
        const strip = (bandY > 0 || stripH < state.height)
          ? cropRgb(raw, state.width, state.height, { x: 0, y: bandY, width: state.width, height: stripH })
          : raw;

        // (2) Cylinder -> equirectangular. The viewer declares this image
        // `type: 'equirectangular'`; until now it was handed a CYLINDRICAL
        // mosaic, and the two projections disagree down y. That mismatch is
        // what bent every horizontal line into an arc and put a curved black
        // boundary across the top and bottom of the review modal. This also
        // normalises the width to exactly one turn, so the viewer's own
        // `vaov = 360 * height / width` reads the correct vertical field
        // straight off the aspect ratio.
        const outWidth = Math.min(EQUIRECT_MAX_WIDTH, Math.max(320, Math.round(state.width)));
        const equi = cylStripToEquirect(strip, state.width, stripH, state.focal, (stripH - 1) / 2, outWidth);

        const canvas = equi.rgb;
        const finalJpeg = encodeJpeg(canvas, equi.width, equi.height, JPEG_QUALITY);
        const resultPath = `${job.project_id}/pano360-jobs/${jobId}/result.jpg`;
        await uploadBytes(admin, resultPath, finalJpeg, "image/jpeg");

        const cropRect = centerCropRect(equi.width, equi.height, THUMB_ASPECT);
        const cropped = cropRgb(canvas, equi.width, equi.height, cropRect);
        const thumbHeight = Math.max(1, Math.round(THUMB_WIDTH / THUMB_ASPECT));
        const thumbRgb = resizeRgbNearest(cropped, cropRect.width, cropRect.height, THUMB_WIDTH, thumbHeight);
        const thumbJpeg = encodeJpeg(thumbRgb, THUMB_WIDTH, thumbHeight, JPEG_QUALITY);
        const thumbPath = `${job.project_id}/pano360-jobs/${jobId}/thumb.jpg`;
        await uploadBytes(admin, thumbPath, thumbJpeg, "image/jpeg");

        // Best-effort cleanup of the raw intermediate — it served its purpose
        // and would otherwise sit in Storage forever, several MB per job,
        // never referenced again once result_path/thumb_path exist.
        try { await admin.storage.from(BUCKET).remove([state.storagePath]); } catch { /* not fatal */ }

        const pairsFallback = job.pairs_fallback || 0;
        const pairsTotal = job.pairs_total || Math.max(1, frameCount - 1);
        // ⚠️ The measured coverage is REPORTED rather than quietly absorbed.
        // Under 360° the panorama is stretched to fill a full turn (see
        // cylStripToEquirect) — a uniform yaw scale error in place of a black
        // wedge — and a planner is entitled to know that is what happened.
        // Over 360° the duplicated tail was trimmed, and the frame count says so.
        const trimmed = frameCount - state.keepFrames;
        const bits = [`${pairsFallback} of ${pairsTotal} joins could not be matched confidently`];
        if (trimmed > 0) bits.push(`turned ${state.coverageDeg}° — ${trimmed} over-rotated frame(s) trimmed to one full turn`);
        else if (state.coverageDeg < 330) bits.push(`turned only ${state.coverageDeg}°, stretched to fill 360°`);
        await commitStep(cursor, {
          status: "done",
          result_path: resultPath,
          thumb_path: thumbPath,
          quality: (pairsFallback > 0 || state.coverageDeg < 300) ? "poor" : "ok",
          progress_pct: 100,
          progress_msg: `Done — ${bits.join("; ")}.`,
        });
        // Terminal — no self-chain.
        return json({ ok: true, status: "done", result_path: resultPath });
      }

      // ---- An ordinary compositing step: paste one more frame -----------
      // The frame is cylindrically reprojected first (the same warp the
      // alignment step used, so a placement measured there lands where it
      // says it does here), then only its CENTRE BAND is pasted — see
      // pasteFrameBand in stitch-core.mjs for why pasting whole frames left
      // the panorama built out of every frame's softest edge.
      const canvas = await downloadBytes(admin, state.storagePath);
      const frameRaw = await decodeFrameForComposite(admin, job.frame_paths[cursor], COMPOSITE_FRAME_MAX_WIDTH);
      const warped = warpToCylindrical(frameRaw.rgb, frameRaw.width, frameRaw.height, state.hfov);
      const rgb = warped.width === state.frameWidth && warped.height === state.frameHeight
        ? warped.rgb
        : resizeRgbNearest(warped.rgb, warped.width, warped.height, state.frameWidth, state.frameHeight);

      const offsets = Array.isArray(job.offsets) ? job.offsets : [];
      const keptOffsets = offsets.slice(0, Math.max(0, state.keepFrames - 1));
      // ⚠️ The WHOLE placement chain is recomputed, not just up to `cursor`:
      // bandForFrame needs the NEXT frame's placement to know where this
      // frame's contribution should stop, and a chain truncated at the cursor
      // would make every frame think it was the last one and paste to its own
      // right edge — putting the soft edge back.
      const placements = cumulativePlacementsClamped(keptOffsets, state.scaleFactor, state.driftClamp);
      const p = placements[cursor];
      const featherPx = Math.max(1, Math.round(state.frameWidth * FEATHER_FRACTION));
      const band = bandForFrame(placements, cursor, state.frameWidth, featherPx);
      pasteFrameBand(
        canvas, state.width, state.height, rgb, state.frameWidth, state.frameHeight,
        state.shiftX + p.x, state.shiftY + p.y, band.x0, band.x1, featherPx,
      );
      await uploadBytes(admin, state.storagePath, canvas, "application/octet-stream");

      const nextCursor = cursor + 1;
      const updated = await commitStep(cursor, {
        step_cursor: nextCursor,
        progress_pct: 50 + Math.round((nextCursor / state.keepFrames) * 50),
        progress_msg: `Building the panorama — ${nextCursor} of ${state.keepFrames}…`,
      });
      if (updated) await selfChain();
      return json({ ok: true, status: "compositing", frame: cursor });
    }

    return json({ ok: true, status: job.status, note: "unrecognized status — no-op" });
  } catch (err) {
    return await fail(err);
  }
});
