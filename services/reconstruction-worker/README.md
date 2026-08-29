# 3D Reconstruction Worker (RunPod Serverless)

COLMAP (Structure-from-Motion) → OpenSplat (Gaussian Splatting) worker for the
Progress Photos module's "3D" tab. Triggered by the `submit-reconstruction`
Edge Function when an admin approves a `reconstruction_requests` row; reports
back via the `reconstruction-webhook` Edge Function.

## ⚠️ Status: written, not built, not run, not deployed

Nothing in this folder has ever been built or executed. The environment that
wrote it has no Docker and no discrete GPU, so `handler.py` is syntax-checked
only (`python3 -m py_compile`) and the `Dockerfile` has never been built even
once. This is disclosed here deliberately, not to be alarmist — the code
follows COLMAP's, OpenSplat's, and RunPod's own documented interfaces as
closely as possible — but the honest status is "the first real build is the
first real test," and a first build commonly needs a few rounds of fixing
apt package names before it succeeds. That is normal for a CUDA image built
from source, not a sign the approach is wrong.

## What you (the owner) need to do — nothing here can be done from this
## environment, some of it because it's explicitly off-limits regardless of
## technical ability (account creation, payment details), some because there's
## no Docker/GPU here to run the build/push commands.

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

Expect the build to fail at least once on an apt package name/version
mismatch — Ubuntu 22.04's exact package versions shift over time and the
Dockerfile's runtime-stage `apt-get install` list was written from documented
COLMAP/OpenSplat dependency lists, not from a real `ldd` run against actual
built binaries. If a shared library is reported missing at container start
(not at build time), run `ldd /usr/local/bin/colmap` and
`ldd /usr/local/bin/opensplat` inside the built image to find the real package
that provides it — that command isn't available in this environment either,
which is exactly why this step needs a real Docker host.

### 3. Create a RunPod Serverless endpoint from the pushed image
In the RunPod dashboard: **Serverless → New Endpoint**.
- **Container Image**: the image you pushed in step 2.
- **GPU**: any CUDA 12.1-compatible GPU RunPod offers (an RTX 4090 or A5000
  class card is a reasonable starting point for COLMAP+OpenSplat on a
  ~200-frame walkthrough — not benchmarked here, since nothing has run).
- **Container Disk**: at least 20GB (COLMAP's build artifacts + LibTorch +
  the extracted frames + intermediate models for one job can add up).
- **Execution Timeout**: RunPod's default is 10 minutes, which is very
  likely too short for a full COLMAP+OpenSplat pass on a real walkthrough.
  Set this to something generous (RunPod supports up to 7 days for
  serverless jobs) — 30–60 minutes is a more realistic starting guess,
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
actually executed.** Expect to iterate on:
- The exact `opensplat` CLI flags (`-n`, `-o`, and the expected input
  directory shape) — check `opensplat --help` inside the running container
  if the job fails immediately.
- The COLMAP camera model (`SIMPLE_RADIAL` is a reasonable default for an
  unknown phone camera, but a specific device's lens profile might do
  better with `OPENCV` or a calibrated model).
- `TARGET_FRAMES` / `OPENSPLAT_ITERATIONS` in `handler.py` once you know the
  real trade-off between job cost (RunPod bills per second) and result
  quality for actual site footage.

## Files
- `Dockerfile` — multi-stage build: COLMAP + OpenSplat compiled from source
  in a `-devel` CUDA image, copied into a slimmer `-runtime` image.
- `handler.py` — the RunPod serverless handler: download video → extract
  frames (ffmpeg) → COLMAP SfM pipeline → OpenSplat training → upload both
  the sparse point cloud (`.ply`, what the client's viewer renders today)
  and the trained splat file (`.ply`, Gaussian-Splatting-specific, stored
  for a future splat-aware viewer) to Supabase Storage → return their
  object paths + basic stats. RunPod's own platform POSTs this return value
  to the webhook URL that was supplied at job submission — the handler does
  not call the webhook itself.
- `requirements.txt` — `runpod` (serverless SDK) + `requests` (raw Storage
  REST upload, no full Supabase client needed for one PUT per file).
