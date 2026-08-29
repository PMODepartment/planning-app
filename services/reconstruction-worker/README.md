# 3D Reconstruction Worker (RunPod Serverless)

pycolmap (COLMAP's own integrated Structure-from-Motion, including its
GLOMAP-successor global mapper) → gsplat (Gaussian Splatting training)
worker for the Progress Photos module's "3D" tab. Triggered by the
`submit-reconstruction` Edge Function when an admin approves a
`reconstruction_requests` row; reports back via the `reconstruction-webhook`
Edge Function.

## ⏸️ On hold (owner's direction, 2026-08-29)

**Phase 3 (360° panoramas) and Phase 4's Gaussian Splatting pipeline are on
hold** while the owner reconsiders cost and hosting options — this rewrite
was requested specifically as groundwork to have on file, not as something
to push toward deployment right now. Don't spend further effort on RunPod
account setup, Docker builds, or endpoint creation for this until the owner
says to resume. See the "Cost & hosting options" section below for the
options actually discussed.

## Why this was rewritten (was: COLMAP + OpenSplat built from source)

The original version of this worker built the full COLMAP C++ stack and
OpenSplat (AGPL-3.0) from source. Researching cheaper/free hosting options
surfaced three real, checked facts that made a rewrite worthwhile regardless
of which infrastructure is eventually chosen:

1. **Standalone GLOMAP (the fast global-SfM solver) was merged into COLMAP
   4.0** as `global_mapper` / `pycolmap.global_mapping()`, and the standalone
   `github.com/colmap/glomap` repo was **archived on 2026-03-09**. This
   worker uses COLMAP's own integrated global mapper instead of building a
   now-deprecated separate project.
2. **COLMAP publishes a prebuilt CUDA-enabled Python wheel**
   (`pycolmap-cuda12`, added in COLMAP 3.13.0) — so this worker no longer
   compiles COLMAP from source at all. `pip install` gets CUDA-accelerated
   feature extraction, matching, mapping and undistortion via the `pycolmap`
   Python API, removing the single largest build-risk surface of the
   original file.
3. **gsplat ([nerfstudio-project/gsplat](https://github.com/nerfstudio-project/gsplat))
   is Apache-2.0**, confirmed from its own LICENSE file — unlike OpenSplat's
   AGPL-3.0, which carries network-copyleft implications worth avoiding for
   an internal company service. It's also pip-installable, with training
   done via its own documented `examples/simple_trainer.py` (vendored into
   the image), rather than a separately-compiled C++ binary.

This was cross-checked against [vid2scene](https://github.com/samuelm2/vid2scene)
(Apache-2.0, a real open-source video→Gaussian-Splat project whose hosted
free service has since shut down) — its own worker still builds the now-archived
standalone `glomap`, so this worker is intentionally a step ahead of that
reference on this one point, while borrowing its proven choice of base image
(`pytorch/pytorch:...-cuda12.4-cudnn9-devel`, which already ships a matching
PyTorch+CUDA build gsplat needs, removing the separate LibTorch download the
original OpenSplat-based version required) and its confirmed
`pycolmap-cuda12` package name.

## Cost & hosting options discussed (not yet decided)

RunPod Serverless (pay-per-second, $0 when idle) is what the rest of this
worker is written against, but the owner is reconsidering it in favor of
something free or closer to it. Real options discussed, roughly cheapest to
most capable:

1. **Self-hosted on hardware already owned** — run this exact worker (as a
   plain script, no RunPod) on a machine with any real NVIDIA GPU. Zero
   recurring cost; the machine isn't elastic (one job at a time, queues if
   busy/off).
2. **Drop Gaussian Splatting, keep the classical point cloud** — the
   `pycolmap` half of this pipeline alone runs on CPU only, no GPU needed at
   all, and already produces the point cloud the client's viewer renders
   today. Real scope reduction from "Gaussian Splatting" to classical
   photogrammetry, but genuinely free on any machine.
3. **Free/community shared GPU** (HuggingFace Spaces community grants,
   consumer apps like Luma AI / PostShot / freegaussian.ai used by hand) —
   free, but not something this app can call automatically; would mean an
   admin manually uploading a video through a third-party website and
   uploading results back.
4. **RunPod / Modal pay-per-second, scale-to-zero** — not free, but close to
   minimal for occasional internal use; what this worker is currently
   written against.

Options 1 and 4 use the exact code in this folder unchanged (just where it
runs). Option 2 would mean cutting `run_gsplat_training()` out of
`handler.py` entirely and returning only the point cloud — not done here
since Gaussian Splatting is on hold as a whole rather than being formally
descoped.

## ⚠️ Status: written, not built, not run, not deployed

Nothing in this folder has ever been built or executed. The environment that
wrote it has no Docker and no discrete GPU, so `handler.py` is syntax-checked
only (`python3 -m py_compile`) and the `Dockerfile` has never been built even
once. This is disclosed here deliberately, not to be alarmist — the code
follows pycolmap's, gsplat's, and RunPod's own documented interfaces as
closely as possible — but the honest status is "the first real build is the
first real test." This rewrite's `pip install`-based Dockerfile should have
noticeably fewer build surprises than the original from-source COLMAP+OpenSplat
version, since there's no C++ compiling of COLMAP itself left to get wrong —
but gsplat's own CUDA kernel compile step (part of its normal `pip install`)
and the exact `pycolmap` keyword-argument names in `handler.py` are still
real, flagged unknowns (see "The actual first test" below).

## What you (the owner) need to do — nothing here can be done from this
## environment, some of it because it's explicitly off-limits regardless of
## technical ability (account creation, payment details), some because there's
## no Docker/GPU here to run the build/push commands. **All of this is ON
## HOLD per the note at the top of this file — steps 1-6 below describe the
## RunPod path if/when the owner decides to resume it.**

### 1. Create a RunPod account and add a payment method
This is a paid GPU service. **I cannot and will not do this step** — it's
explicitly prohibited (financial credentials, account creation) even if it
were technically possible. Go to https://runpod.io, sign up, add billing.

### 2. Build and push the Docker image
From a machine with Docker installed (this repo's own environment does not
have one):

```bash
cd services/reconstruction-worker
docker build -t <your-dockerhub-username>/reconstruction-worker:v1 .
docker push <your-dockerhub-username>/reconstruction-worker:v1
```

The biggest likely failure points, in order: whether `pycolmap-cuda12>=4.0.0`
actually resolves to a real published wheel (the only version directly
confirmed is `3.13.0`, which predates the `global_mapping` binding this
worker calls — see the Dockerfile's header), and whether gsplat's CUDA
extension build succeeds against the base image's exact PyTorch/CUDA/driver
combination (a normal `pip install`, but still a from-source CUDA-extension
compile, which is sensitive to exact version alignment).

### 3. Create a RunPod Serverless endpoint from the pushed image
In the RunPod dashboard: **Serverless → New Endpoint**.
- **Container Image**: the image you pushed in step 2.
- **GPU**: any CUDA 12.4-compatible GPU RunPod offers (an RTX 4090 or A5000
  class card is a reasonable starting point for a ~200-frame walkthrough —
  not benchmarked here, since nothing has run).
- **Container Disk**: at least 15GB (the base PyTorch+CUDA image, gsplat's
  build, the extracted frames and intermediate models for one job add up;
  smaller than before since there's no separate LibTorch download or COLMAP
  build artifacts anymore).
- **Execution Timeout**: RunPod's default is 10 minutes, which is very
  likely too short for a full reconstruction + training pass on a real
  walkthrough. Set this to something generous (RunPod supports up to 7 days
  for serverless jobs) — 30–60 minutes is a more realistic starting guess,
  to be tuned once a real job's actual wall-clock time is known.
- **Environment Variables / Secrets** on the endpoint:
  - `SUPABASE_URL` = `https://bgupuqnkqhixpuctyder.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY` = the Planners project's service-role key
    (⚠️ a real secret — set it directly in RunPod's dashboard, never commit
    it to this repo).
- Note the **Endpoint ID** RunPod assigns — this is `RUNPOD_ENDPOINT_ID` below.

### 4. Deploy the two Edge Functions and set their secrets
From this repo, with the Supabase CLI installed and logged in:

```bash
supabase functions deploy submit-reconstruction --project-ref bgupuqnkqhixpuctyder
supabase functions deploy reconstruction-webhook --no-verify-jwt --project-ref bgupuqnkqhixpuctyder

supabase secrets set \
  RUNPOD_API_KEY=<your RunPod API key> \
  RUNPOD_ENDPOINT_ID=<the endpoint id from step 3> \
  --project-ref bgupuqnkqhixpuctyder
```

⚠️ **`reconstruction-webhook` MUST deploy with `--no-verify-jwt`.** RunPod's
webhook callback carries no Supabase session, so the platform's default JWT
check would reject every callback before the function's own token check even
runs. `submit-reconstruction` deploys normally (default JWT verification ON)
— it's called by an authenticated admin's browser session.

### 5. Run the database migration
`migrations/2026-08-29-reconstruction-requests.sql`, in the Supabase SQL
editor — same as every other migration in this repo.

### 6. The actual first test
Sign in as an admin, go to Progress Photos → 3D, submit a short real
walkthrough video, then click Approve on it. Watch the RunPod dashboard's
job logs. **This is the first time any part of this pipeline will have
actually executed.** Expect to iterate on, roughly in likelihood order:
- Whether `pip install "pycolmap-cuda12>=4.0.0"` actually resolves to a real
  wheel — the only version+CUDA-wheel combination directly confirmed is
  `pycolmap-cuda12==3.13.0`, which predates COLMAP 4.0's `global_mapping`.
  Run `pip index versions pycolmap-cuda12` inside the build to check.
- The exact keyword argument names on `pycolmap.extract_features`,
  `pycolmap.match_exhaustive`, `pycolmap.global_mapping`, and
  `pycolmap.undistort_images` in `run_reconstruction()` — written from
  documentation summaries, not a signature inspection. Run
  `python -c "import pycolmap; help(pycolmap.<name>)"` inside the built
  image for each before trusting the first job's output.
- The COLMAP camera model (`SIMPLE_RADIAL` is a reasonable default for an
  unknown phone camera, but a specific device's lens profile might do
  better with `OPENCV` or a calibrated model).
- `TARGET_FRAMES` / `GSPLAT_MAX_STEPS` in `handler.py` once you know the
  real trade-off between job cost (RunPod bills per second) and result
  quality for actual site footage.

## Files
- `Dockerfile` — `pytorch/pytorch:...-cuda12.4-cudnn9-devel` base (already
  has a matching PyTorch+CUDA build), `pip install`s `pycolmap-cuda12`
  (prebuilt CUDA-enabled COLMAP Python bindings — no C++ compiling of COLMAP
  itself) and `gsplat`, and vendors gsplat's own `examples/simple_trainer.py`
  training script from a pinned tag. No separate GLOMAP or LibTorch build
  (see "Why this was rewritten" above for why).
- `handler.py` — the RunPod serverless handler: download video → extract
  frames (ffmpeg) → pycolmap SfM pipeline (feature extraction → matching →
  COLMAP's integrated global mapper → undistortion → PLY point-cloud export)
  → gsplat training via its vendored `simple_trainer.py` → upload both the
  sparse point cloud (`.ply`, what the client's viewer renders today) and
  the trained splat file (`.ply`, Gaussian-Splatting-specific, stored for a
  future splat-aware viewer) to Supabase Storage → return their object
  paths + basic stats. RunPod's own platform POSTs this return value to the
  webhook URL that was supplied at job submission — the handler does not
  call the webhook itself.
- `requirements.txt` — `runpod` (serverless SDK) + `requests` (raw Storage
  REST upload, no full Supabase client needed for one PUT per file);
  `pycolmap-cuda12` and `gsplat` are installed directly in the Dockerfile
  instead (see that file's comments for why).
