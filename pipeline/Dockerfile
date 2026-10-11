# syntax=docker/dockerfile:1.27.1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
#
# Raster pipeline image: the Cloud Run Jobs `raster-pipeline` (4 vCPU, 16 GiB) and `raster-pipeline-xl`
# (8 vCPU, 32 GiB) run its `runtime` target. The build context is pipeline/:
#
#   docker build -f pipeline/Dockerfile --target runtime -t hcm-pipeline:local pipeline
#   docker run --rm hcm-pipeline:local                    # `doctor`: GDAL drivers, numpy, OpenCV
#   docker build -f pipeline/Dockerfile --target test -t hcm-pipeline:test pipeline
#   docker run --rm hcm-pipeline:test                     # the pytest suite on the shipped base
#
# Stages: base (the pinned GDAL image) -> deps (Poetry, and the locked runtime dependencies in /opt/venv) ->
# test (+ dev dependencies and the tests) | runtime (non-root: the venv and the package, nothing else).
# GDAL comes from the base image (`osgeo`, Python 3.14), visible through --system-site-packages; it is
# never pip-installed (a GDAL wheel would load a second GDAL into the process). No secret is baked in:
# the job reads its configuration from environment variables and Secret Manager (--set-secrets).
# The quality gates run the same suite in docker/Dockerfile.quality (same base digest, same lock).

# ghcr.io/osgeo/gdal:ubuntu-small-3.13.3 (Ubuntu 26.04, Python 3.14.4 with matching osgeo bindings)
FROM ghcr.io/osgeo/gdal:ubuntu-small-3.13.3@sha256:64250faf833c06d4b21afce4c27190039ba7ab58d70f0eebc87cf77d929c0b40 AS base

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV LANG=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# --- deps: Poetry and the locked runtime dependencies --------------------------------------------
FROM base AS deps

ARG PIP_VERSION=26.2.1

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# python3.14-venv: the GDAL image ships no ensurepip.
RUN --mount=type=cache,id=hcm-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=hcm-apt-lists,target=/var/lib/apt/lists,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3.14-venv=3.14.4*

# Poetry in its own venv, every package pinned (requirements-poetry.txt).
COPY requirements-poetry.txt /opt/poetry/requirements-poetry.txt
RUN --mount=type=cache,id=hcm-pip,target=/root/.cache/pip,sharing=locked \
    python3 -m venv /opt/poetry \
    && /opt/poetry/bin/pip install "pip==${PIP_VERSION}" \
    && /opt/poetry/bin/pip install --only-binary :all: -r /opt/poetry/requirements-poetry.txt

# The application venv: no pip of its own (Poetry installs into it), the base image's osgeo visible.
WORKDIR /work/pipeline
COPY pyproject.toml poetry.lock ./
RUN --mount=type=cache,id=hcm-poetry,target=/root/.cache/pypoetry,sharing=locked \
    python3 -m venv --without-pip --system-site-packages /opt/venv \
    && VIRTUAL_ENV=/opt/venv /opt/poetry/bin/poetry install --no-root --only main --no-interaction

# --- test: the pytest suite against the real GDAL (CMD), reports under /work/reports -----------------
FROM deps AS test

RUN --mount=type=cache,id=hcm-poetry,target=/root/.cache/pypoetry,sharing=locked \
    VIRTUAL_ENV=/opt/venv /opt/poetry/bin/poetry install --no-root --only dev --no-interaction

COPY . /work/pipeline/
RUN mkdir -p /work/reports && chown 10001:10001 /work/reports

# Every pipeline command runs from the repository root, which /work stands in for (pipeline/pyproject.toml).
WORKDIR /work
ENV HOME=/tmp
USER 10001:10001
CMD ["/opt/venv/bin/python", "-m", "pytest", "-c", "pipeline/pyproject.toml", "--rootdir", "."]

# --- runtime: what Cloud Run executes ----------------------------------------------------------------
FROM base AS runtime

COPY --from=deps /opt/venv /opt/venv
COPY src/hcm_pipeline /opt/app/hcm_pipeline

# The base image's tcmalloc preload stays: it serves GDAL's large warps (docs/research/M0-handoff.md).
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/opt/app \
    HOME=/tmp

WORKDIR /tmp
USER 10001:10001
ENTRYPOINT ["python", "-m", "hcm_pipeline"]
CMD ["doctor"]
