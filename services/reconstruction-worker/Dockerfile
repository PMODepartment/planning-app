# ==============================================================================
# RunPod Serverless worker image: COLMAP (Structure-from-Motion, BSD license)
# -> OpenSplat (Gaussian Splatting trainer, AGPL-3.0, github.com/pierotofy/OpenSplat)
#
# ⚠️⚠️ WRITTEN, NEVER BUILT, NEVER RUN. ⚠️⚠️
# This environment has no Docker (`docker --version` fails) and no discrete
# GPU (only integrated Intel Iris Xe -- confirmed via
# `wmic path win32_VideoController get name`), so this Dockerfile has not been
# built even once. Every step follows COLMAP's and OpenSplat's own documented
# build instructions as closely as could be done from documentation alone, but
# apt package names/versions in particular are exactly the kind of thing that
# drift between Ubuntu point releases and are the most likely first-build
# failure. See README.md's "First build, expect to iterate" section before
# treating a build failure here as a sign of a deeper design problem -- it
# almost certainly just means a package name needs adjusting for whatever
# Ubuntu 22.04 snapshot is current when this is actually built.
# ==============================================================================

# ---- Stage 1: build COLMAP + OpenSplat from source -------------------------
FROM nvidia/cuda:12.1.1-devel-ubuntu22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      git cmake ninja-build build-essential \
      libboost-program-options-dev libboost-filesystem-dev libboost-graph-dev \
      libboost-system-dev libeigen3-dev libflann-dev libfreeimage-dev \
      libmetis-dev libgoogle-glog-dev libgtest-dev libsqlite3-dev libglew-dev \
      qtbase5-dev libqt5opengl5-dev libcgal-dev libceres-dev \
      libatlas-base-dev libsuitesparse-dev \
      wget curl unzip \
    && rm -rf /var/lib/apt/lists/*

# COLMAP, pinned to a released tag (not `main`) so a rebuild months from now
# doesn't silently pick up an unrelated breaking change.
RUN git clone --branch 3.9.1 --depth 1 https://github.com/colmap/colmap.git /opt/colmap-src \
    && cmake -S /opt/colmap-src -B /opt/colmap-src/build -GNinja \
         -DCMAKE_BUILD_TYPE=Release -DCMAKE_CUDA_ARCHITECTURES=native \
    && cmake --build /opt/colmap-src/build --target install -- -j"$(nproc)" \
    && rm -rf /opt/colmap-src

# LibTorch (OpenSplat's C++ training backend depends on it). CUDA 12.1 build,
# matching the base image's CUDA version -- these two must agree.
RUN wget -q "https://download.pytorch.org/libtorch/cu121/libtorch-cxx11-abi-shared-with-deps-2.1.2%2Bcu121.zip" -O /tmp/libtorch.zip \
    && unzip -q /tmp/libtorch.zip -d /opt \
    && rm /tmp/libtorch.zip

# OpenSplat itself, pinned similarly. ⚠️ CHECK-BEFORE-FIRST-RUN: confirm this
# tag still exists and still builds against CUDA 12.1 + the LibTorch version
# above -- OpenSplat is a fast-moving research-adjacent project and its build
# requirements have changed across releases.
RUN git clone --branch v1.2.1 --depth 1 https://github.com/pierotofy/OpenSplat.git /opt/opensplat-src \
    && cmake -S /opt/opensplat-src -B /opt/opensplat-src/build -GNinja \
         -DCMAKE_BUILD_TYPE=Release \
         -DCMAKE_PREFIX_PATH="/opt/libtorch;/usr/local" \
         -DGPU_RUNTIME=CUDA -DCMAKE_CUDA_ARCHITECTURES=native \
    && cmake --build /opt/opensplat-src/build -- -j"$(nproc)" \
    && cp /opt/opensplat-src/build/opensplat /usr/local/bin/opensplat \
    && rm -rf /opt/opensplat-src

# ---- Stage 2: slim runtime image -------------------------------------------
FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip ffmpeg \
      libboost-program-options1.74.0 libboost-filesystem1.74.0 \
      libboost-graph1.74.0 libboost-system1.74.0 \
      libfreeimage3 libmetis5 libgoogle-glog0v5 libglew2.2 \
      libqt5opengl5 libqt5core5a libqt5gui5 libqt5widgets5 \
      libceres3 libsuitesparse-dev libgomp1 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/bin/colmap /usr/local/bin/colmap
COPY --from=builder /usr/local/share/colmap /usr/local/share/colmap
COPY --from=builder /usr/local/bin/opensplat /usr/local/bin/opensplat
COPY --from=builder /opt/libtorch /opt/libtorch
ENV LD_LIBRARY_PATH="/opt/libtorch/lib:${LD_LIBRARY_PATH}"

WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY handler.py .

# RunPod injects SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and any other
# secrets configured on the endpoint as plain environment variables at
# container start -- nothing further to declare here.
CMD ["python3", "-u", "handler.py"]
