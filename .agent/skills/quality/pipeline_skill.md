# Pipeline Skill

The single entry point for every quality check, locally and in CI, is `scripts/ci/run-all-checks.sh`. This file is the **only definition of the stages**; every other document links here instead of repeating the table. The gate registry itself is data in `scripts/ci/pipeline.py` (`GATES`, `STAGES`, `COMPOSITE_STAGES`), and `python3 scripts/ci/pipeline.py --list` prints it.

## How a run works

1. `scripts/ci/run-all-checks.sh` calls `scripts/ci/build-and-test.sh`, which builds `docker/Dockerfile.quality` as `hcm-quality:local` (override with `HCM_IMAGE`; extra `docker build` flags from `HCM_DOCKER_BUILD_FLAGS`). With unchanged manifests the build takes seconds.
2. It starts the image as the calling user (`--user $(id -u):$(id -g)`), with `HOME=/tmp/hcm-home`, the repository mounted at the **same absolute path** (so coverage paths match Sonar's) and nothing else from the host. It passes `PIPELINE_STAGE` (default `all`), `CI` and `GITLEAKS_LOG_OPTS`.
3. Inside, `scripts/ci/in-container.sh` refuses to run unless `HCM_TEST_IMAGE=1` (set only by the image), then runs `python3 scripts/ci/pipeline.py --stage "$PIPELINE_STAGE"`.
4. `pipeline.py` first runs `npm ci --prefer-offline` from the npm cache baked into the image whenever `node_modules/.hcm-install-stamp` does not hold the SHA-256 of `package-lock.json` (delete the stamp to force it). Then it runs every gate of the stage in order, announced as `static 3/23 tsc`, and keeps going after a failure so one run lists every problem.
5. The run ends with `[SUCCESS] stage '<x>' passed (reports/pipeline/green-<x>.json)` (exit 0) or `[FAILURE] stage '<x>' failed: <stage>/<gate>, ...` (exit 1). The green marker records `{stage, head, status_sha256}`, the hash of `git status --porcelain=v1 --untracked-files=all`, which the pre-push hook checks.

## Stages

| Stage | Gates (in order) | Status |
| --- | --- | --- |
| `static` | `suppressions`, `prettier`, `tsc`, `eslint`, `stylelint`, `htmlhint`, `html-validate`, `markdownlint`, `knip`, `dependency-cruiser`, `yamllint`, `taplo-fmt`, `taplo-lint`, `ruff-check`, `ruff-format`, `mypy`, `shellcheck`, `shfmt`, `hadolint`, `actionlint`, `gitleaks`, `npm-audit`, `pip-audit` | green |
| `tests` | `vitest` (`vitest run --coverage`: projects shared, ui in headless Chromium, engine, admin; functions and rules rows activate with their `package.json`), `pytest` (`scripts/ci/tests`, later `pipeline/tests`) | green |
| `e2e` | none yet; M1 registers `npm run test:e2e` (Playwright under the Firebase emulators and mock APIs) | **fails on purpose** (empty) |
| `build` | `vite-build` (`npm run build`: `packages/engine/dist/engine.{iife.js,mjs,css}` and the admin bundle) | green |
| `sonar` | none yet; planned `scripts/ci/sonar_scan.sh` (pinned scanner image) then `scripts/ci/sonar_report.py` | **fails on purpose** (empty) |
| `deps` | none yet; planned `scripts/ci/check_dependency_updates.py` (latest stable of every pin, `HELD` table) | **fails on purpose** (empty) |
| `release` | none yet; planned tag, version and release-notes checks plus the reproducible `dist` | **fails on purpose** (empty) |
| `quality` | `static` → `tests` → `e2e` → `build` (what CI runs) | fails until `e2e` has gates |
| `all` | `quality` → `sonar` (the default; run before every push to `master` or a tag) | fails until `e2e` and `sonar` have gates |

An empty stage fails ("no gates registered yet") so it can never report green for work that does not exist. `deps` is never part of `quality` or `all`: currency depends on the calendar, not on the commit. Gates with a `files` pathspec (`htmlhint`, `html-validate`, `shellcheck`, `shfmt`, `hadolint`, `actionlint`) are skipped, and count as passed, while no file matches.

Planned gates, each added with the milestone that needs it (`docs/research/M0-handoff.md` → *TODO for the next agents*):

- `static`: skill mirrors (`scripts/ci/check_skill_mirrors.py`), agent-asset budgets and paths (`scripts/ci/check_agent_assets.py`), data files (`scripts/ci/check_data_files.py` + `check-jsonschema`), EditorConfig (`scripts/ci/check_editorconfig.py`), the scenario registry and its generated doc (`scripts/ci/check_e2e_matrix.py`, `scripts/ci/gen_scenarios_doc.py check`), i18n key parity (`scripts/ci/check_i18n.py`), action pins (`scripts/ci/check_action_pins.py`), radon grade A, bandit, jscpd, repo and bundle budgets.
- `tests`: the unified per-file coverage gate `scripts/ci/check_coverage.py` (scope from `sonar-project.properties`, badges into `.github/badges/`), rules tests under the emulators plus `scripts/ci/check_rules_coverage.py`.

## Running it

```bash
mkdir -p reports/pipeline
PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh > reports/pipeline/run.log 2>&1; echo "EXIT=$?"
grep -E '^\[(SUCCESS|FAILURE)\]|FAILED' reports/pipeline/run.log
```

- Read the verdict from a log file; never pipe the run through `tail` (the pipe's exit status would be `tail`'s).
- Pick the stage by change: docs or tooling only → `static`; TypeScript or Python → `static`, `tests`, `build`; before a push to `master` or a tag → `all`.
- Never edit `scripts/ci/run-all-checks.sh` while a run is in flight: bash reads it by offset and the run dies with an unrelated error.
- `reports/` is git-ignored: `reports/pipeline/green-*.json`, `reports/coverage/ts/` (lcov, json-summary), `reports/coverage/scripts.xml`, `reports/junit/{vitest,pytest}.xml`, `reports/gitleaks.json`.

## Adding a gate

1. Pin the tool: an exact npm devDependency, an exact line in `scripts/ci/requirements.txt` (plus its transitive pins), or a digest-pinned binary copied in `docker/Dockerfile.quality`.
2. Add `Gate("<name>", (...))` to `GATES` in `scripts/ci/pipeline.py`. npm tools get a `package.json` script and run as `(*NPM_RUN, "<script>")`, so `package.json` stays the one place for their flags.
3. Add the name to the right tuple in `STAGES`: cheapest first, network-bound gates (`npm-audit`, `pip-audit`) last.
4. Run `python3 -m pytest` in the image: the registry tests reject unknown, duplicated or unstaged gates.
5. Update this file (*Stages*), `quality/ci_quality_gates_skill.md`, `docs/CI_PIPELINE.md` and the `quality-pipeline` skill and its mirror, in the same task.

## CI mapping (planned with `.github/workflows/ci.yml`)

`ci.yml` builds the image once (`docker/build-push-action` with the GitHub Actions cache), then calls `PIPELINE_STAGE=<stage> bash scripts/ci/run-all-checks.sh` per job: `static`, then `tests`, `e2e` (sharded), `build`, then the SonarCloud job, then the deploys on `master`. It never runs a tool directly. Every action is pinned by full SHA with a `# vX.Y.Z` comment, every job has `timeout-minutes`, least-privilege `permissions` and `persist-credentials: false`. The runner is `ubuntu-24.04`, pinned. Details: `docs/CI_PIPELINE.md`.

## Tool bootstrap and pins

- Node 24.21.0 and npm 11.19.0 come from `node:24-bookworm-slim` (digest in `docker/Dockerfile.quality`); `engines` requires Node 24.12 or later and `.npmrc` sets `engine-strict` and `save-exact`.
- Python 3.14.4 is the GDAL base image's interpreter. CI tools live in the plain venv `/opt/hcm/venv` from `scripts/ci/requirements.txt` (every transitive dependency pinned). The raster pipeline (M3) gets its own Poetry venv with `--system-site-packages` so `osgeo.gdal` is visible.
- Playwright browsers live in `/ms-playwright`, the Firebase emulator JARs in `/opt/hcm/firebase-emulators`; JDK 21 serves the emulators.
- Every version and digest is listed in `docs/research/M0-handoff.md` → *Toolchain and pins* and summarised in `docs/CI_PIPELINE.md` → *Tool versions*.

## Latest stable dependencies and holds

Every dependency stays on its latest stable release; a deliberate hold is a `HELD` entry with its reason (in `scripts/ci/check_dependency_updates.py` once the `deps` stage exists, and in `docs/CI_PIPELINE.md` → *Held dependencies* meanwhile). Current holds: `typescript@6.0.3` (`typescript-eslint@8.71.1` peers `typescript <6.1.0`; latest is 7.0.2) and `@types/node@24.19.2` (follows the Node 24 runtime, not the 26.x line). Advisories are fixed with `overrides` in the root `package.json`, never with an allowlist.

## Local tooling quirks

- Never run a gate with the host's Node 22 or Python: versions differ from the image and results do not count.
- The GDAL base preloads tcmalloc; the quality image sets `LD_PRELOAD=""` because Chromium aborts under it. Keep it.
- A browser crash in the container writes `core.<pid>` into the repository root; `.gitignore` covers `core.[0-9]*`.
- npm 11 warns that `protobufjs` and `re2` (from `firebase-tools`) run install scripts not yet covered by `allowScripts`; approve those two explicitly if a later npm blocks them.
- Adding a workspace needs its `COPY <dir>/package.json <dir>/` line in `docker/Dockerfile.quality` (and an allowlist line in `.dockerignore` outside `packages/*`), or `npm ci` fails in the image build.
