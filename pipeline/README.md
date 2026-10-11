# Raster pipeline (`hcm_pipeline`)

The Python + GDAL pipeline that turns declassified USGS film scans into georeferenced historical layers, run as the
Cloud Run Jobs `raster-pipeline` and `raster-pipeline-xl`. M0 ships the skeleton: configuration, redacted JSON logging,
the step registry and command line, the `doctor` step and the USGS M2M client. The processing steps (fetch, crop,
georef, warp, export, publish) arrive in M3. Design: `docs/research/PLAN.md` → *Raster pipeline*; skill:
`.agent/skills/pipeline/raster_pipeline_skill.md`.

## Layout

| Path | What |
| --- | --- |
| `src/hcm_pipeline/main.py` | `python -m hcm_pipeline <step>` (or `--list`): logging, configuration, dispatch, exit codes |
| `src/hcm_pipeline/config.py` | the job environment (`JOB_ID`, `CITY_ID`, `GOOGLE_CLOUD_PROJECT`, buckets, `USGS_M2M_BASE_URL`), validated |
| `src/hcm_pipeline/log.py` | Cloud Logging JSON lines; tokens, `X-Auth-Token`, `access_token=`, JWTs and signed-URL queries redacted |
| `src/hcm_pipeline/steps/` | the `Step` protocol, `Outcome` (DONE or WAITING), the registry, the `doctor` step |
| `src/hcm_pipeline/m2m.py` | USGS M2M client: login-token, logout, JSON on any status, typed errors, re-login after 100 minutes |
| `src/hcm_pipeline/raster.py` | the one import point of `osgeo.gdal` / `osgeo.osr`, with exceptions enabled |
| `typings/osgeo/` | mypy stubs for the GDAL API the code calls (GDAL ships no type information) |
| `tests/{unit,integration,synthetic}` | pytest; `tests/fakes/` holds the loopback firewall, the fake M2M server and a valid environment |

## Exit codes

`0` done, or waiting on USGS or Mapbox (the job state says why; `ops.tick` resumes it), `1` failed (Cloud Run may
retry), `2` bad command line, `3` incomplete or invalid environment (a retry cannot help).

## Toolchain

- `osgeo.gdal` comes from `ghcr.io/osgeo/gdal:ubuntu-small-3.13.3` (by digest, Python 3.14); it is never
  pip-installed. The venv is created with `--system-site-packages` and without pip.
- Poetry 2.5.1 (`requirements-poetry.txt`, every transitive dependency pinned) locks `poetry.lock`. Regenerate the lock
  inside the quality image, never on the host:

  ```bash
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
    bash -c 'mkdir -p $HOME && /opt/hcm/poetry/bin/poetry --directory pipeline lock'
  ```

- Every pipeline command runs from the repository root: `pyproject.toml` holds the pytest, coverage and mypy settings
  with repository-relative paths, so the reports land in `reports/coverage/pipeline.xml` and `reports/junit/pipeline.xml`.

## Quality gates

The quality image (`docker/Dockerfile.quality`) carries Poetry in `/opt/hcm/poetry` and the locked dependencies in
`/opt/hcm/pipeline-venv`, so the gates run there like every other gate (`python3 scripts/ci/pipeline.py --list`):

| Gate | Stage | Checks |
| --- | --- | --- |
| `ruff-check`, `ruff-format` | static | the repository-wide `ruff.toml` (complexity 5) |
| `pipeline-lock` | static | `poetry check --lock --strict`: the lock matches `pyproject.toml` |
| `pipeline-mypy` | static | mypy strict over `src` and `tests`, against the pipeline venv |
| `pipeline-radon` | static | radon grade A (complexity and maintainability) for `src` |
| `pipeline-bandit` | static | bandit, every severity, for `src` |
| `pipeline-pip-audit` | static | the pipeline venv and the Poetry pins |
| `pipeline-pytest` | tests | the suite with branch coverage; `coverage` then holds every file to 90 % |

## Images

`Dockerfile` (build context `pipeline/`) has the stages `base` → `deps` → `test` | `runtime`:

```bash
docker build -f pipeline/Dockerfile --target runtime -t hcm-pipeline:local pipeline && docker run --rm hcm-pipeline:local
docker build -f pipeline/Dockerfile --target test -t hcm-pipeline:test pipeline && docker run --rm hcm-pipeline:test
```

`runtime` runs as uid 10001 with the venv and the package only (no pip, no test tools, no secret); its default command
is `doctor`. Configuration and secrets arrive at run time (environment variables, Secret Manager `--set-secrets`).
