# ==============================================================================
# RunPod Serverless worker image: pycolmap (COLMAP's Python bindings, BSD-3
# license, CUDA-enabled prebuilt wheel) -> gsplat (Gaussian Splatting trainer,
# Apache-2.0, github.com/nerfstudio-project/gsplat).
#
# ⚠️⚠️ WRITTEN, NEVER BUILT, NEVER RUN. ⚠️⚠️ Same disclosure as before this
# rewrite: no Docker and no discrete GPU in the environment that wrote this
# (only integrated Intel Iris Xe -- confirmed via
# `wmic path win32_VideoController get name`).
#
# ---- WHY THIS IS A REWRITE, NOT A TWEAK ------------------------------------
# The original version of this file built COLMAP and OpenSplat entirely from
# source (~130 lines of apt/cmake/git-clone). Researched into a rewrite after
# the owner asked to reconsider cost/licensing, which surfaced three real,
# checked (not guessed) facts that change the shape of this file:
#
#  1. Standalone GLOMAP (github.com/colmap/glomap, the fast global-SfM solver)
#     was MERGED INTO COLMAP 4.0 as `global_mapper` / pycolmap.global_mapping(),
#     and the standalone glomap repo was ARCHIVED on 2026-03-09. Building a
#     separate glomap binary -- which is what the reference project this was
#     compared against (vid2scene, github.com/samuelm2/vid2scene, Apache-2.0)
#     still does in its own Dockerfile -- now targets a deprecated project.
#     This file uses COLMAP's own integrated global mapper instead.
#  2. COLMAP now publishes a PREBUILT CUDA-ENABLED PYTHON WHEEL
#     (`pycolmap-cuda12`, Linux x86-64 only, added in COLMAP 3.13.0) --
#     confirmed present on PyPI and confirmed as the exact package vid2scene's
#     own Dockerfile installs. This means NO SOURCE BUILD OF COLMAP AT ALL is
#     needed here -- `pip install` gets you CUDA-accelerated SIFT extraction,
#     matching, mapping and undistortion via the `pycolmap` Python API. This
#     removes the single largest build-risk surface of the original Dockerfile
#     (compiling COLMAP's full C++ stack, including the Qt/CGAL GUI deps this
#     worker never even used) entirely.
#  3. gsplat (the actual Gaussian Splatting trainer) is Apache-2.0 --
#     confirmed directly from github.com/nerfstudio-project/gsplat's LICENSE
#     file -- unlike OpenSplat's AGPL-3.0. Apache-2.0 carries none of AGPL's
#     network-copyleft implications, which matters for running this as an
#     internal company service. gsplat is also `pip install`-able (a CUDA
#     rasterization *library* with Python bindings, not a standalone CLI
#     binary like OpenSplat was) -- training is done by invoking a Python
#     script (vendored from gsplat's own `examples/simple_trainer.py`), not a
#     compiled executable this file has to build.
#
# Net effect: no `git clone` + `cmake --build` of anything COLMAP/GLOMAP-
# related, no separate LibTorch download (the base image already ships a
# matching PyTorch+CUDA build gsplat needs anyway). What's left to actually
# build from source is only gsplat's own CUDA kernels, which happen via its
# normal `pip install` (a source + custom-op build, same as installing any
# CUDA-extension PyTorch package) -- a much smaller, better-trodden path than
# compiling COLMAP's full C++ stack.
#
# ⚠️ NOT YET VERIFIED (flagged rather than silently assumed):
#  - The exact CURRENT version of the `pycolmap-cuda12` wheel that includes
#    COLMAP 4.0's `global_mapping` binding. The only version+package name
#    directly confirmed is `pycolmap-cuda12==3.13.0`, which PREDATES the 4.0
#    global-mapper merge. Pinned below to `>=4.0.0` with a comment to verify
#    against `pip index versions pycolmap-cuda12` at build time -- if no
#    CUDA wheel exists yet at or above 4.0.0, fall back to the plain (CPU-only
#    feature extraction) `pycolmap>=4.0.0` and accept slower SIFT extraction,
#    or pin `pycolmap-cuda12==3.13.0` and use the plain `incremental_mapping`
#    binding instead of `global_mapping` until a newer CUDA wheel ships.
#  - `pycolmap.global_mapping`'s exact signature was confirmed from the PR
#    description for colmap/colmap#4228, not from running it:
#    `pycolmap.global_mapping(database_path, image_root, sparse_path, pipeline_opts)`
#    with `pycolmap.GlobalMapperOptions()` / `pycolmap.GlobalPipelineOptions()`.
#    Check `python -c "import pycolmap; help(pycolmap.global_mapping)"` inside
#    the built image before the first real job.
#  - Whether pycolmap exposes a sequential (rather than exhaustive) matcher
#    was searched for and NOT found documented anywhere -- `match_exhaustive`
#    is used below as the confirmed-real, safe default. For ~200 ordered
#    video frames this is O(n^2) pairs rather than sequential matching's
#    O(n) -- slower, not incorrect. `pycolmap.match_from_pairs` (mentioned in
#    COLMAP 4.0's release notes as new GPU custom-pair matching) may be the
#    right thing to build a sequential-window pair list against as a later
#    optimization -- not attempted here since its exact signature is
#    unconfirmed.
# ==============================================================================

FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-devel

ENV DEBIAN_FRONTEND=noninteractive

# ffmpeg for frame extraction; the handful of shared libs pycolmap's wheel
# links against at runtime (OpenGL/GLU for its headless rendering paths,
# libgomp for OpenMP). No compilers, no Qt, no CGAL, no Ceres dev headers --
# none of that is needed once COLMAP itself comes from a prebuilt wheel.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg libgl1 libglu1-mesa libgomp1 git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ⚠️ CHECK-BEFORE-FIRST-RUN (see header comment): confirm this version
# actually exists with a CUDA wheel before building. If not, see the fallback
# options in the header comment above.
RUN pip install --no-cache-dir "pycolmap-cuda12>=4.0.0"

# gsplat: pip-installs and JIT/AOT-compiles its CUDA kernels against the
# base image's already-present matching torch+CUDA build (2.5.1+cu124) --
# no separate LibTorch download needed, unlike OpenSplat's C++ build.
RUN pip install --no-cache-dir gsplat

# Vendor gsplat's own documented training entry point + its COLMAP dataset
# parser, rather than reimplementing the training loop -- this is the exact,
# real, versioned script the "python simple_trainer.py --data-dir ... " usage
# in gsplat's own docs refers to. Pinned to a tag, not `main`. v1.5.3 was
# confirmed as the latest tagged release (Jul 2025) at the time this was
# written -- check https://github.com/nerfstudio-project/gsplat/tags for a
# newer one before building.
RUN git clone --branch v1.5.3 --depth 1 https://github.com/nerfstudio-project/gsplat.git /opt/gsplat-src \
    && cp -r /opt/gsplat-src/examples /app/gsplat_examples \
    && rm -rf /opt/gsplat-src

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY handler.py .

# RunPod injects SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and any other
# secrets configured on the endpoint as plain environment variables at
# container start -- nothing further to declare here.
CMD ["python", "-u", "handler.py"]
