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
  toGrayscaleDownsampled,
  estimateOffset,
  rgbaToRgb,
  rgbToRgba,
  cumulativePlacements,
  capScaleFactor,
  computeBounds,
  pasteFrame,
  makeCanvas,
  centerCropRect,
  cropRgb,
  resizeRgbNearest,
  THUMB_ASPECT,
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
const MAX_COMPOSITE_WIDTH = 3600;
const MAX_COMPOSITE_HEIGHT = 1200;

// A frame's own left edge blends into whatever the canvas already has there
// over this many composite-resolution pixels — proportional to frame width
// so a narrower final composite (after capping) still gets a sensible blend.
const FEATHER_FRACTION = 0.12;

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
  // via pano360_invoke — always send the project's own service-role key as
  // the Bearer token (see the migration). That key's own JWT payload carries
  // `role: "service_role"`, not a `sub` naming a real user, so it can never be
  // looked up in `users` — trust it outright, the same way this repo already
  // trusts a service-role caller everywhere else. A request bearing an
  // ordinary user's JWT instead (nothing in this app sends one today, but
  // nothing forbids it either) is held to this app's own baseline bar: an
  // approved account, matching the `is_writer()` gate this table's own INSERT
  // policy already requires to create a job in the first place.
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth) return json({ error: "Missing Authorization" }, 401);
  let payload: any = null;
  try {
    const seg = auth.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    payload = JSON.parse(atob(seg));
  } catch { payload = null; }
  if (!payload) return json({ error: "Could not read the bearer token" }, 401);
  if (payload.role !== "service_role") {
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
      const prevGray = toGrayscaleDownsampled(prevDecoded.data, prevDecoded.width, prevDecoded.height, ALIGN_TARGET_WIDTH);
      const currGray = toGrayscaleDownsampled(currDecoded.data, currDecoded.width, currDecoded.height, ALIGN_TARGET_WIDTH);
      const offset = estimateOffset(
        prevGray.gray, prevGray.width, prevGray.height,
        currGray.gray, currGray.width, currGray.height,
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
        const firstFrame = await decodeFrameForComposite(admin, job.frame_paths[0], COMPOSITE_FRAME_MAX_WIDTH);
        const scaleFactorRaw = firstFrame.width / ALIGN_TARGET_WIDTH;
        const offsets = Array.isArray(job.offsets) ? job.offsets : [];
        const rawPlacements = cumulativePlacements(offsets, scaleFactorRaw);
        const rawBounds = computeBounds(rawPlacements, firstFrame.width, firstFrame.height);

        const cap = capScaleFactor(rawBounds.width, rawBounds.height, MAX_COMPOSITE_WIDTH, MAX_COMPOSITE_HEIGHT);
        const scaleFactor = scaleFactorRaw * cap;
        const frameWidth = Math.max(1, Math.round(firstFrame.width * cap));
        const frameHeight = Math.max(1, Math.round(firstFrame.height * cap));
        const placements = cap === 1 ? rawPlacements : cumulativePlacements(offsets, scaleFactor);
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
        };

        const canvas = makeCanvas(state.width, state.height, [20, 20, 20]);
        const frame0 = cap === 1
          ? firstFrame
          : { rgb: resizeRgbNearest(firstFrame.rgb, firstFrame.width, firstFrame.height, frameWidth, frameHeight), width: frameWidth, height: frameHeight };
        pasteFrame(canvas, state.width, state.height, frame0.rgb, frame0.width, frame0.height, state.shiftX, state.shiftY, 0);
        await uploadBytes(admin, state.storagePath, canvas, "application/octet-stream");

        const updated = await commitStep(cursor, {
          composite_state: state,
          step_cursor: 1,
          progress_pct: 50 + Math.round((1 / frameCount) * 50),
          progress_msg: `Building the panorama — 1 of ${frameCount}…`,
        });
        if (updated) await selfChain();
        return json({ ok: true, status: "compositing", frame: 0 });
      }

      state = job.composite_state as CompositeState;

      if (cursor >= frameCount) {
        // Every frame pasted — finalize: encode + upload the result and a
        // thumbnail, drop the (large, now-unneeded) raw intermediate, finish.
        const canvas = await downloadBytes(admin, state.storagePath);
        const finalJpeg = encodeJpeg(canvas, state.width, state.height, JPEG_QUALITY);
        const resultPath = `${job.project_id}/pano360-jobs/${jobId}/result.jpg`;
        await uploadBytes(admin, resultPath, finalJpeg, "image/jpeg");

        const cropRect = centerCropRect(state.width, state.height, THUMB_ASPECT);
        const cropped = cropRgb(canvas, state.width, state.height, cropRect);
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
        await commitStep(cursor, {
          status: "done",
          result_path: resultPath,
          thumb_path: thumbPath,
          quality: pairsFallback > 0 ? "poor" : "ok",
          progress_pct: 100,
          progress_msg: `Done — ${pairsFallback} of ${pairsTotal} joins could not be matched confidently.`,
        });
        // Terminal — no self-chain.
        return json({ ok: true, status: "done", result_path: resultPath });
      }

      // ---- An ordinary compositing step: paste one more frame -----------
      // ⚠️⚠️ This pastes a RAW, un-warped perspective frame — there is no
      // cylindrical reprojection step anywhere in this file or in
      // stitch-core.mjs. A camera ROTATING about a fixed point (this app's
      // own capture guidance) is not handled correctly by pure translation
      // past a few degrees of rotation; see stitch-core.mjs's own header
      // comment ("2026-09-16 CORRECTNESS AUDIT") for the full reasoning on
      // why this is a known, real gap left deliberately unfixed this round.
      const canvas = await downloadBytes(admin, state.storagePath);
      const frame = await decodeFrameForComposite(admin, job.frame_paths[cursor], state.frameWidth);
      const rgb = frame.width === state.frameWidth && frame.height === state.frameHeight
        ? frame.rgb
        : resizeRgbNearest(frame.rgb, frame.width, frame.height, state.frameWidth, state.frameHeight);

      const offsets = Array.isArray(job.offsets) ? job.offsets : [];
      const placements = cumulativePlacements(offsets.slice(0, cursor), state.scaleFactor);
      const p = placements[placements.length - 1];
      const featherMag = Math.max(1, Math.round(state.frameWidth * FEATHER_FRACTION));
      // ⚠️⚠️ The feather direction has to match which edge of THIS frame
      // actually overlaps the canvas, not always the left one — see
      // pasteFrame's own header comment in stitch-core.mjs. offsets[cursor-1]
      // is the alignment for the pair (cursor-1, cursor): a non-negative dx
      // means this frame landed to the right of the previous one (the
      // ordinary case — its LEFT edge is the one that overlaps, so the
      // sign stays positive), a negative dx means it landed to the left
      // (a leftward pan or a momentary backward wobble — its RIGHT edge is
      // the one that overlaps, so the sign flips negative).
      const pairDx = offsets[cursor - 1] ? offsets[cursor - 1].dx : 0;
      const featherPx = pairDx < 0 ? -featherMag : featherMag;
      pasteFrame(canvas, state.width, state.height, rgb, state.frameWidth, state.frameHeight, state.shiftX + p.x, state.shiftY + p.y, featherPx);
      await uploadBytes(admin, state.storagePath, canvas, "application/octet-stream");

      const nextCursor = cursor + 1;
      const updated = await commitStep(cursor, {
        step_cursor: nextCursor,
        progress_pct: 50 + Math.round((nextCursor / frameCount) * 50),
        progress_msg: `Building the panorama — ${nextCursor} of ${frameCount}…`,
      });
      if (updated) await selfChain();
      return json({ ok: true, status: "compositing", frame: cursor });
    }

    return json({ ok: true, status: job.status, note: "unrecognized status — no-op" });
  } catch (err) {
    return await fail(err);
  }
});
