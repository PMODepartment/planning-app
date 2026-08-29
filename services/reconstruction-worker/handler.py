#!/usr/bin/env python3
# ==============================================================================
# RunPod Serverless handler: video walkthrough -> pycolmap (COLMAP's own
# integrated global mapper, GLOMAP's successor) sparse reconstruction ->
# gsplat Gaussian Splat training -> results uploaded to Supabase Storage.
#
# ------------------------------------------------------------------------------
# ⚠️ WRITTEN, NOT EXECUTED. Same disclosure as the original version of this
# file: no GPU/Docker in the environment that wrote it. What changed in this
# rewrite (requested after reconsidering cost/licensing) and WHY, in order of
# confidence -- see the Dockerfile's header for the full research trail:
#
#   CONFIRMED, high confidence:
#   - Standalone GLOMAP was merged into COLMAP 4.0 and archived 2026-03-09;
#     `pycolmap.global_mapping(...)` is COLMAP's own replacement.
#   - `pycolmap-cuda12` is a real, prebuilt CUDA-enabled wheel (added in
#     COLMAP 3.13.0) -- no source build of COLMAP needed at all now.
#   - gsplat (github.com/nerfstudio-project/gsplat) is Apache-2.0 and
#     pip-installable; its `examples/simple_trainer.py` (vendored into this
#     image by the Dockerfile) is the real, documented training entry point,
#     confirmed to accept `--data-dir / --data-factor / --result-dir /
#     --max-steps / --save-ply` and to read a COLMAP-format project directory.
#
#   NOT independently run, best-available synthesis of documentation -- the
#   single most likely source of a first-run failure, in this order:
#   1. `pycolmap.global_mapping`'s exact return type (a dict of
#      {index: Reconstruction}, mirroring `incremental_mapping`, is ASSUMED
#      below and handled defensively -- if it turns out to return a single
#      Reconstruction directly, the `isinstance` branch below already covers
#      that case too).
#   2. The exact keyword argument names on `pycolmap.extract_features`,
#      `pycolmap.match_exhaustive`, and `pycolmap.undistort_images` --
#      written from a documentation summary, not a signature inspection.
#      Run `python -c "import pycolmap; help(pycolmap.extract_features)"`
#      (and the same for the other two) inside the built image FIRST, before
#      submitting a real job, and adjust the keyword names below if they
#      differ. This is the standard "check the installed version's own
#      docstring" step this repo already uses elsewhere (e.g. checking
#      `opensplat --help` was the equivalent step for the previous version).
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

import os
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path

import requests
import runpod

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET = "progress-photos"
GSPLAT_TRAINER = "/app/gsplat_examples/simple_trainer.py"

# Target frame count for the extraction pass. A walkthrough video can run
# several minutes — too many frames makes reconstruction impractically slow
# on a single GPU worker, too few starves it of overlap to match against.
# 150-300 is the commonly recommended range for SfM+3DGS pipelines of this
# kind; not tuned against real footage here.
TARGET_FRAMES = 220
MIN_FPS = 1.0
MAX_FPS = 6.0

# gsplat training iterations. gsplat's own `simple_trainer.py` example
# defaults to 30,000 for its benchmark scenes (large outdoor/object scenes
# meant for research comparisons) -- deliberately NOT used here. A site
# walkthrough is a smaller, more constrained scene, and RunPod bills per
# second: this starts at a much lower budget as a cost-conscious default.
# ⚠️ CHECK-BEFORE-FIRST-RUN: this is the single biggest cost/quality lever
# in the whole pipeline and has no real timing data behind it yet.
GSPLAT_MAX_STEPS = 5000


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


def run_reconstruction(project_dir, images_dir):
    """Structure-from-Motion entirely via pycolmap's Python API (no COLMAP
    CLI binary at all -- see the module header for why this replaced the
    original from-source COLMAP CLI build): extract_features -> match_exhaustive
    -> global_mapping (COLMAP 4.0's integrated GLOMAP successor) ->
    undistort_images -> export a plain-PLY point cloud.
    """
    import pycolmap  # deferred import so a missing/mismatched wheel fails
                      # inside handler(), reported as a job error, not a
                      # container crash-loop on start.

    db_path = project_dir / "database.db"
    sparse_dir = project_dir / "sparse"
    sparse_dir.mkdir(parents=True, exist_ok=True)
    dense_dir = project_dir / "dense"

    print("[worker] extracting SIFT features (GPU)...", flush=True)
    pycolmap.extract_features(
        database_path=str(db_path),
        image_path=str(images_dir),
        camera_model="SIMPLE_RADIAL",
        sift_options={"use_gpu": True},
    )

    print("[worker] matching features (exhaustive)...", flush=True)
    # ⚠️ Exhaustive, not sequential -- a sequential/windowed matcher was
    # searched for in pycolmap's Python bindings and NOT found documented
    # anywhere. Exhaustive is O(n^2) pairs rather than O(n) for ~220 ordered
    # video frames -- slower, not incorrect. Revisit if pycolmap.match_from_pairs
    # (mentioned in COLMAP 4.0's release notes for GPU custom-pair matching)
    # turns out to expose a documented way to build a sequential-window pair
    # list once its actual signature is confirmed.
    pycolmap.match_exhaustive(database_path=str(db_path))

    print("[worker] running COLMAP's integrated global mapper...", flush=True)
    pipeline_opts = pycolmap.GlobalPipelineOptions()
    recs = pycolmap.global_mapping(
        database_path=str(db_path),
        image_root=str(images_dir),
        sparse_path=str(sparse_dir),
        pipeline_opts=pipeline_opts,
    )

    # Defensive handling of the return shape -- see the module header's
    # "NOT independently run" note #1. `incremental_mapping` (the older,
    # confirmed-documented sibling function) returns a dict of
    # {index: Reconstruction}; global_mapping is assumed to follow the same
    # convention, but a single Reconstruction returned directly is also
    # handled so this doesn't hard-crash on the first real run over a naming
    # assumption alone.
    if hasattr(recs, "items"):
        if not recs:
            raise RuntimeError(
                "COLMAP's global mapper produced no reconstructed model at all -- "
                "the footage likely doesn't have enough overlap or texture to register."
            )
        reconstruction = max(recs.values(), key=lambda r: r.num_reg_images())
    elif recs is not None:
        reconstruction = recs
    else:
        raise RuntimeError(
            "COLMAP's global mapper produced no reconstructed model at all -- "
            "the footage likely doesn't have enough overlap or texture to register."
        )

    model_dir = sparse_dir / "0"
    model_dir.mkdir(parents=True, exist_ok=True)
    reconstruction.write(str(model_dir))

    registered = reconstruction.num_reg_images()

    # Undistort against a PINHOLE model -- gsplat's dataset parser (like
    # OpenSplat's before it) expects undistorted images, and SIMPLE_RADIAL
    # carries real lens distortion the raw frames still have.
    print("[worker] undistorting images...", flush=True)
    pycolmap.undistort_images(
        output_path=str(dense_dir),
        input_path=str(model_dir),
        image_path=str(images_dir),
    )

    # Export the sparse point cloud as a plain PLY -- this is what the
    # client's PLYLoader viewer renders directly (recon.js's
    # mountPointCloudViewer), independent of whatever gsplat produces.
    pointcloud_ply = project_dir / "sparse_pointcloud.ply"
    reconstruction.export_PLY(str(pointcloud_ply))

    return dense_dir, pointcloud_ply, registered


def run_gsplat_training(dense_dir, out_dir):
    """Train a Gaussian Splat via gsplat's own vendored `simple_trainer.py`
    (copied into the image by the Dockerfile from
    github.com/nerfstudio-project/gsplat's `examples/` folder — the exact,
    documented, versioned entry point, not a reimplementation of the
    training loop). Confirmed CLI shape: `--data-dir / --data-factor /
    --result-dir / --max-steps / --save-ply`, input is a COLMAP-format
    project directory (exactly what pycolmap.undistort_images produced).
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    run([
        sys.executable, GSPLAT_TRAINER,
        "--data-dir", str(dense_dir),
        "--data-factor", "1",   # our own frames are already downscaled at extraction; don't downscale again
        "--result-dir", str(out_dir),
        "--max-steps", str(GSPLAT_MAX_STEPS),
        "--save-ply",
        "--disable-video",      # skip the benchmark fly-through video render -- pure cost, no use to us
    ], timeout=60 * 90)  # generous cap so a stuck job doesn't run (and bill) forever

    ply_dir = out_dir / "ply"
    plys = sorted(ply_dir.glob("*.ply")) if ply_dir.exists() else []
    if not plys:
        raise RuntimeError(f"gsplat training completed without producing a PLY file in {ply_dir}.")
    return plys[-1]  # the highest-step checkpoint, per --ply-steps naming


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
        dense_dir, pointcloud_ply, registered = run_reconstruction(colmap_project, images_dir)

        quality_note = None
        if len(frames) > 0:
            ratio = registered / len(frames)
            if ratio < 0.5:
                quality_note = (
                    f"Only {registered} of {len(frames)} frames were registered "
                    f"({ratio*100:.0f}%) -- the reconstruction may be incomplete or "
                    "distorted. Consider a slower, more overlapping walkthrough."
                )

        splat_dir = work_dir / "splat_out"
        splat_ply = run_gsplat_training(dense_dir, splat_dir)

        pointcloud_object_path = f"{result_prefix}pointcloud.ply"
        splat_object_path = f"{result_prefix}splat.ply"
        upload_to_storage(pointcloud_ply, pointcloud_object_path)
        upload_to_storage(splat_ply, splat_object_path)

        elapsed = time.time() - started
        stats = {
            "frame_count": len(frames),
            "registered_images": registered,
            "gsplat_max_steps": GSPLAT_MAX_STEPS,
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
