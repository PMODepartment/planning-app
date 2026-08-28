#!/usr/bin/env python3
# ==============================================================================
# RunPod Serverless handler: video walkthrough -> COLMAP sparse reconstruction
# -> OpenSplat Gaussian Splat training -> results uploaded to Supabase Storage.
#
# ------------------------------------------------------------------------------
# ⚠️ WRITTEN, NOT EXECUTED. This code follows RunPod's documented serverless
# handler contract and COLMAP's/OpenSplat's documented CLI usage as closely as
# possible, but no GPU or Docker is available in the environment that wrote it
# (confirmed: `docker --version` fails; only an integrated Intel Iris Xe GPU is
# present, no discrete NVIDIA card to test CUDA against). The exact OpenSplat
# CLI flags in particular should be checked against `opensplat --help` on the
# actual built image before the first real job is submitted — see the
# CHECK-BEFORE-FIRST-RUN comments below. Only `handler.py`'s own Python syntax
# has been verified (py_compile), and only the request/response SHAPE this
# module's Edge Functions expect has been cross-checked against
# `supabase/functions/reconstruction-webhook/index.ts`.
#
# INPUT (event["input"], set by submit-reconstruction):
#   { "request_id": str, "project_id": str, "video_url": str (signed, 24h),
#     "result_prefix": str (e.g. "OPW101/reconstructions/<uuid>/") }
#
# OUTPUT (returned from `handler()` — RunPod POSTs this as
#   {"id", "status":"COMPLETED", "output": <this dict>} to the webhook URL that
#   was given at job-submission time; a returned {"error": ...} instead marks
#   the job FAILED and is what reconstruction-webhook's `body?.error` branch
#   expects):
#   { "pointcloud_url": str, "splat_url": str, "stats": {...} }
#   Both URLs are STORAGE OBJECT PATHS (not signed URLs) — the client signs
#   them on demand when opening the viewer, same convention as every other
#   file this app stores (drawing_register.file_url, progress_photos.photo_url).
# ==============================================================================

import json
import math
import os
import shutil
import subprocess
import time
import traceback
from pathlib import Path

import requests
import runpod

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET = "progress-photos"

# Target frame count for the extraction pass. COLMAP's sequential matcher
# scales roughly linearly with frame count and a walkthrough video can run
# several minutes — too many frames makes the mapper stage impractically slow
# on a single GPU worker, too few starves it of overlap to match against.
# 150-300 is the commonly recommended range for SfM+3DGS pipelines of this
# kind; not tuned against real footage here.
TARGET_FRAMES = 220
MIN_FPS = 1.0
MAX_FPS = 6.0

# OpenSplat training iterations. OpenSplat's own defaults/examples commonly
# use a few thousand for a reasonable quality/time trade-off on a single GPU;
# left generous rather than tuned, since no real timing data exists yet from
# this environment. ⚠️ CHECK-BEFORE-FIRST-RUN: confirm this is still a
# sensible number against the actual wall-clock time of a real job — RunPod
# bills per second, and this is the single biggest cost lever in the whole
# pipeline.
OPENSPLAT_ITERATIONS = 3000


def run(cmd, cwd=None, timeout=None):
    """Run a subprocess, raising with full stdout/stderr on failure so a
    pipeline error surfaces as a readable message on the request row instead
    of a bare non-zero exit code."""
    print(f"[worker] $ {' '.join(cmd)}", flush=True)
    proc = subprocess.run(
        cmd, cwd=cwd, timeout=timeout,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    if proc.stdout:
        print(proc.stdout, flush=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"Command failed ({proc.returncode}): {' '.join(cmd)}\n{proc.stdout[-4000:]}"
        )
    return proc.stdout


def probe_duration_seconds(video_path):
    out = run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(video_path),
    ])
    try:
        return max(float(out.strip()), 0.1)
    except ValueError:
        return 60.0  # a sane fallback rather than crashing the whole job on a probe hiccup


def extract_frames(video_path, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    duration = probe_duration_seconds(video_path)
    fps = TARGET_FRAMES / duration
    fps = max(MIN_FPS, min(MAX_FPS, fps))
    print(f"[worker] video duration={duration:.1f}s -> extracting at {fps:.2f} fps", flush=True)
    run([
        "ffmpeg", "-y", "-i", str(video_path),
        "-vf", f"fps={fps:.4f}",
        "-q:v", "2",
        str(out_dir / "frame_%05d.jpg"),
    ])
    frames = sorted(out_dir.glob("frame_*.jpg"))
    if len(frames) < 8:
        raise RuntimeError(
            f"Only {len(frames)} frames extracted from the video — too few for a "
            "reconstruction (need at least ~8 with real overlap)."
        )
    return frames


def run_colmap(project_dir, images_dir):
    """Structure-from-Motion via COLMAP's own documented CLI pipeline
    (feature_extractor -> sequential_matcher -> mapper -> image_undistorter).
    Sequential matcher, not exhaustive, since walkthrough frames are ordered
    and overlap mostly with their near neighbours in time -- exhaustive
    matching on 200+ frames would be needlessly slow.
    """
    db_path = project_dir / "database.db"
    sparse_dir = project_dir / "sparse"
    sparse_dir.mkdir(parents=True, exist_ok=True)
    dense_dir = project_dir / "dense"

    run([
        "colmap", "feature_extractor",
        "--database_path", str(db_path),
        "--image_path", str(images_dir),
        "--ImageReader.camera_model", "SIMPLE_RADIAL",
        "--ImageReader.single_camera", "1",
        "--SiftExtraction.use_gpu", "1",
    ])
    run([
        "colmap", "sequential_matcher",
        "--database_path", str(db_path),
        "--SiftMatching.use_gpu", "1",
    ])
    run([
        "colmap", "mapper",
        "--database_path", str(db_path),
        "--image_path", str(images_dir),
        "--output_path", str(sparse_dir),
    ])

    model_dirs = sorted([p for p in sparse_dir.iterdir() if p.is_dir()])
    if not model_dirs:
        raise RuntimeError(
            "COLMAP's mapper produced no reconstructed model at all -- the "
            "footage likely doesn't have enough overlap or texture to register."
        )
    model_dir = model_dirs[0]  # COLMAP names the largest/first reconstructed model "0"

    # Undistort against a PINHOLE model -- OpenSplat's documented input formats
    # (COLMAP / nerfstudio / OpenSfM) expect undistorted images, and
    # SIMPLE_RADIAL carries real lens distortion the raw frames still have.
    run([
        "colmap", "image_undistorter",
        "--image_path", str(images_dir),
        "--input_path", str(model_dir),
        "--output_path", str(dense_dir),
        "--output_type", "COLMAP",
    ])

    # Export the sparse point cloud as a plain PLY -- this is what the
    # client's PLYLoader viewer renders directly (recon.js's
    # mountPointCloudViewer), independent of whatever OpenSplat produces.
    pointcloud_ply = project_dir / "sparse_pointcloud.ply"
    run([
        "colmap", "model_converter",
        "--input_path", str(model_dir),
        "--output_path", str(pointcloud_ply),
        "--output_type", "PLY",
    ])

    return dense_dir, pointcloud_ply, model_dir


def run_opensplat(dense_dir, out_dir):
    """Train a Gaussian Splat from the undistorted COLMAP project.
    ⚠️ CHECK-BEFORE-FIRST-RUN: OpenSplat's CLI (as of the pinned v1.2.1 tag in
    the Dockerfile) is documented as
        opensplat <input-path> -n <iterations> -o <output.ply>
    where <input-path> is a directory containing a COLMAP-style project
    (images/ + sparse/ or cameras.bin/images.bin/points3D.bin at its root).
    Confirm this against `opensplat --help` on the built image -- if the flag
    names or the expected directory layout have moved since this was written,
    this is the single most likely place a real job's first run fails.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    splat_ply = out_dir / "splat.ply"
    run([
        "opensplat", str(dense_dir),
        "-n", str(OPENSPLAT_ITERATIONS),
        "-o", str(splat_ply),
    ], timeout=60 * 90)  # generous cap so a stuck job doesn't run (and bill) forever
    if not splat_ply.exists():
        raise RuntimeError("OpenSplat completed without producing an output file.")
    return splat_ply


def count_registered_images(model_dir):
    """A cheap reconstruction-quality signal: how many of the input frames
    COLMAP actually managed to register (localise) into the model, vs. how
    many were fed in. A low ratio is the honest sign of a poor walkthrough
    (too fast a pan, not enough texture/overlap) -- surfaced in `stats` rather
    than silently hidden behind a technically-"done" status."""
    images_txt = model_dir / "images.txt"
    if images_txt.exists():
        # COLMAP's images.txt has one non-comment header line per registered
        # image, followed by a POINTS2D line -- every other non-comment line.
        lines = [l for l in images_txt.read_text(errors="ignore").splitlines() if l and not l.startswith("#")]
        return len(lines) // 2
    return None


def upload_to_storage(local_path, object_path):
    """Raw REST upload to Supabase Storage using the service-role key -- no
    supabase-py client dependency needed for a single PUT. Overwrites any
    existing object at that path (this worker owns result_prefix exclusively,
    per-request, so there's nothing to collide with)."""
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{object_path}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "apikey": SUPABASE_SERVICE_KEY,
        "Content-Type": "application/octet-stream",
        "x-upsert": "true",
    }
    with open(local_path, "rb") as f:
        resp = requests.post(url, headers=headers, data=f, timeout=300)
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Storage upload failed for {object_path}: {resp.status_code} {resp.text[:500]}")
    return object_path  # stored as a PATH, signed on demand by the client -- see module header


def handler(event):
    started = time.time()
    inp = event.get("input") or {}
    request_id = inp.get("request_id")
    video_url = inp.get("video_url")
    result_prefix = inp.get("result_prefix") or ""

    if not video_url or not request_id:
        return {"error": "input.video_url and input.request_id are required"}
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return {"error": "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured on the worker"}

    work_dir = Path(f"/tmp/job_{request_id}")
    if work_dir.exists():
        shutil.rmtree(work_dir)  # a re-run of a stuck job id should never see a stale partial state
    work_dir.mkdir(parents=True)

    try:
        print(f"[worker] downloading video for request {request_id}", flush=True)
        video_path = work_dir / "input.mp4"
        with requests.get(video_url, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(video_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    f.write(chunk)

        images_dir = work_dir / "images"
        frames = extract_frames(video_path, images_dir)
        print(f"[worker] extracted {len(frames)} frames", flush=True)

        colmap_project = work_dir / "colmap"
        colmap_project.mkdir()
        dense_dir, pointcloud_ply, model_dir = run_colmap(colmap_project, images_dir)

        registered = count_registered_images(model_dir)
        quality_note = None
        if registered is not None and len(frames) > 0:
            ratio = registered / len(frames)
            if ratio < 0.5:
                quality_note = (
                    f"Only {registered} of {len(frames)} frames were registered "
                    f"({ratio*100:.0f}%) -- the reconstruction may be incomplete or "
                    "distorted. Consider a slower, more overlapping walkthrough."
                )

        splat_dir = work_dir / "splat_out"
        splat_ply = run_opensplat(dense_dir, splat_dir)

        pointcloud_object_path = f"{result_prefix}pointcloud.ply"
        splat_object_path = f"{result_prefix}splat.ply"
        upload_to_storage(pointcloud_ply, pointcloud_object_path)
        upload_to_storage(splat_ply, splat_object_path)

        elapsed = time.time() - started
        stats = {
            "frame_count": len(frames),
            "registered_images": registered,
            "opensplat_iterations": OPENSPLAT_ITERATIONS,
            "processing_seconds": round(elapsed, 1),
        }
        if quality_note:
            stats["quality_note"] = quality_note
        print(f"[worker] done in {elapsed:.1f}s -> {stats}", flush=True)

        return {
            "pointcloud_url": pointcloud_object_path,
            "splat_url": splat_object_path,
            "stats": stats,
        }
    except Exception as e:
        print("[worker] FAILED:", traceback.format_exc(), flush=True)
        return {"error": str(e)}
    finally:
        # Best-effort cleanup so a long-lived warm worker doesn't accumulate
        # every past job's frames/models on local disk.
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass


runpod.serverless.start({"handler": handler})
