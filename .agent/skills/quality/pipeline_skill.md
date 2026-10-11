# Pipeline Skill

The single entry point for every quality check, locally and in CI, is `scripts/ci/run-all-checks.sh`. This file is the **only definition of the stages**; every other document links here instead of repeating the table. The gate registry itself is data in `scripts/ci/pipeline.py` (`GATES`, `STAGES`, `COMPOSITE_STAGES`), and `python3 scripts/ci/pipeline.py --list` prints it.

## How a run works

1. `scripts/ci/run-all-checks.sh` calls `scripts/ci/build-and-test.sh`, which builds `docker/Dockerfile.quality` as `hcm-quality:local` (override with `HCM_IMAGE`; extra `docker build` flags from `HCM_DOCKER_BUILD_FLAGS`). With unchanged manifests the build takes seconds.
2. It starts the image as the calling user (`--user $(id -u):$(id -g)`), with `HOME=/tmp/hcm-home`, the repository mounted at the **same absolute path** (so coverage paths match Sonar's) and nothing else from the host. It passes `PIPELINE_STAGE` (default `all`), `CI`, `GITLEAKS_LOG_OPTS` and `E2E_SHARD`.
3. Inside, `scripts/ci/in-container.sh` refuses to run unless `HCM_TEST_IMAGE=1` (set only by the image), then runs `python3 scripts/ci/pipeline.py --stage "$PIPELINE_STAGE"`.
4. `pipeline.py` first runs `npm ci --prefer-offline` from the npm cache baked into the image whenever `node_modules/.hcm-install-stamp` does not hold the SHA-256 of `package-lock.json` (delete the stamp to force it). Then it runs every gate of the stage in order, announced as `static 10/42 tsc`, and keeps going after a failure so one run lists every problem.
5. The run ends with `[SUCCESS] stage '<x>' passed (reports/pipeline/green-<x>.json)` (exit 0) or `[FAILURE] stage '<x>' failed: <stage>/<gate>, ...` (exit 1). The green marker records `{stage, head, status_sha256}`, the hash of `git status --porcelain=v1 --untracked-files=all`, which the pre-push hook checks.

## Stages

| Stage | Gates (in order) | Status |
| --- | --- | --- |
| `static` | `suppressions`, `skill-mirrors`, `agent-assets`, `data-files`, `firebase-schema`, `editorconfig`, `e2e-matrix`, `i18n`, `prettier`, `tsc`, `eslint`, `stylelint`, `htmlhint`, `html-validate`, `markdownlint`, `knip`, `dependency-cruiser`, `yamllint`, `taplo-fmt`, `taplo-lint`, `ruff-check`, `ruff-format`, `mypy`, `radon`, `bandit`, `pipeline-lock`, `pipeline-mypy`, `pipeline-radon`, `pipeline-bandit`, `shellcheck`, `shfmt`, `hadolint`, `actionlint`, `workflow-schema`, `workflow-timeouts`, `action-schema`, `issue-forms-schema`, `issue-config-schema`, `action-pins`, `workflow-policy`, `repo-policy`, `repo-budget`, `gitleaks`, `gitleaks-history` (CI only: the commit range in `GITLEAKS_LOG_OPTS`), `pytest` (the CI tooling's tests, so a tooling-only change is gated here too), `npm-audit`, `pip-audit`, `pipeline-pip-audit` | registered |
| `tests` | `vitest` (`npm test`: `firebase emulators:exec --project demo-hcm` around `scripts/ci/run-emulated-tests.sh`, which runs `vitest run --coverage` over the projects shared, ui in headless Chromium, engine, admin, functions and rules, then saves the Firestore rule-coverage report), `rules-coverage` (`scripts/ci/check_rules_coverage.py check`: every rule expression evaluated, every `allow` both allowing and denying), `pytest` (`scripts/ci/tests`), `pipeline-pytest` (`pipeline/tests` in the pipeline venv, `reports/coverage/pipeline.xml`), `coverage` (`scripts/ci/check_coverage.py --min 90`: scope from `sonar-project.properties`, Sonar scoring, summary in `reports/coverage/summary.md`, badges into `.github/badges/`) | registered |
| `e2e` | `e2e-matrix` (the registry check again, so the stage stands alone), `playwright` (`npm run test:e2e`: Playwright 1.64 with `e2e/playwright.config.ts`; today the harness smoke `e2e/specs/smoke.spec.ts` in headless Chromium with SwiftShader WebGL2, behind the firewall and console-guard fixtures of `e2e/support/test.ts`; `E2E_SHARD=index/total` shards it; M1 adds the Firebase emulators, the mock APIs and the full tier list) | registered |
| `build` | `vite-build` (`npm run build`: `packages/engine/dist/engine.{iife.js,mjs,css}` and the admin bundle), `bundle-budget` (`scripts/ci/check_bundle_budget.py`: gzip budgets) | registered |
| `sonar` | none yet; `scripts/ci/sonar_scan.sh` (pinned scanner image, then `scripts/ci/sonar_report.py`) exists and joins the stage once the SonarCloud token is set up | **fails on purpose** (empty) |
| `deps` | none yet; planned `scripts/ci/check_dependency_updates.py` (latest stable of every pin, `HELD` table) | **fails on purpose** (empty) |
| `release` | `release-check` (`scripts/ci/check_release.py`: one `vX.Y.Z` tag at HEAD, every `package.json` and `ENGINE_VERSION` at that version, both release-notes files), `vite-build`, `bundle-budget`; run by `.github/workflows/release.yml` on a tag | registered |
| `contract` | `contracts` (`scripts/ci/check_contracts.py`: the Setup Assistant deep links of `packages/admin/src/setup/links.json` and the USGS M2M, Mapbox CDN and Earth Search shapes; needs the network); run weekly by `.github/workflows/contract.yml` | registered |
| `quality` | `static` → `tests` → `e2e` → `build` (what CI runs) | registered |
| `all` | `quality` → `sonar` (the default; run before every push to `master` or a tag) | fails until `sonar` has gates |

`python3 scripts/ci/pipeline.py --list` prints the live registry; when it and this table disagree, the registry is right and this table is fixed in the same task. An empty stage fails ("no gates registered yet") so it can never report green for work that does not exist. `deps` and `contract` are never part of `quality` or `all`: currency and third-party drift depend on the calendar, not on the commit. Gates with a `files` pathspec (`firebase-schema`, `htmlhint`, `html-validate`, `shellcheck`, `shfmt`, `hadolint`, `actionlint`, `workflow-schema`, `workflow-timeouts`, `action-schema`, `issue-forms-schema`, `issue-config-schema`, `workflow-policy`) are skipped, and count as passed, while no file matches.

Planned gates, each added with the milestone that needs it (`docs/research/M0-handoff.md` → *TODO for the next agents*):

- `static`: jscpd (at most 2 % duplication), pylint and vulture.
- `e2e` (M1): the emulator topology, the mock APIs, the functional, tour, a11y, no-WebGL and cross-browser projects (`docs/TESTING.md`).
- `sonar`, `deps`: as in the table.

## Running it

```bash
mkdir -p reports/pipeline
PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh > reports/pipeline/run.log 2>&1; echo "EXIT=$?"
grep -E '^\[(SUCCESS|FAILURE)\]|FAILED' reports/pipeline/run.log
```

- Read the verdict from a log file; never pipe the run through `tail` (the pipe's exit status would be `tail`'s).
- Pick the stage by change: docs or tooling only → `static`; TypeScript or Python → `static`, `tests`, `build`; before a push to `master` or a tag → `all`.
- Never edit `scripts/ci/run-all-checks.sh` while a run is in flight: bash reads it by offset and the run dies with an unrelated error.
- `reports/` is git-ignored: `reports/pipeline/green-*.json`, `reports/coverage/ts/` (lcov, json-summary), `reports/coverage/{scripts,pipeline}.xml`, `reports/junit/{vitest,pytest,pipeline}.xml`, `reports/gitleaks.json`.

## Adding a gate

1. Pin the tool: an exact npm devDependency, an exact line in `scripts/ci/requirements.txt` (plus its transitive pins), or a digest-pinned binary copied in `docker/Dockerfile.quality`.
2. Add `Gate("<name>", (...))` to `GATES` in `scripts/ci/pipeline.py`. npm tools get a `package.json` script and run as `(*NPM_RUN, "<script>")`, so `package.json` stays the one place for their flags.
3. Add the name to the right tuple in `STAGES`: cheapest first, network-bound gates (`npm-audit`, `pip-audit`) last.
4. Run `python3 -m pytest` in the image: the registry tests reject unknown, duplicated or unstaged gates.
5. Update this file (*Stages*), `quality/ci_quality_gates_skill.md`, `docs/CI_PIPELINE.md` and the `quality-pipeline` skill and its mirror, in the same task.

## CI mapping (`.github/workflows/`)

- `ci.yml` (push to `master` and `v*` tags, pull requests to `master`, manual): `build-image` fills the GitHub Actions layer cache (`bash scripts/ci/build-and-test.sh` with `HCM_DOCKER_BUILD_FLAGS` set to the `type=gha` cache flags; the local composite action `.github/actions/quality-image` sets up Buildx and exposes the cache runtime). Every other job runs `PIPELINE_STAGE=<stage> bash scripts/ci/run-all-checks.sh`, whose own build loads the image from that cache: `static`, then `tests` (JUnit check, `coverage` artifact), `e2e` (matrix of `E2E_SHARD` values, `index/total`, forwarded into the container), `build` (`dist` artifact), then `sonarqube` (scan and quality-gate actions, then `scripts/ci/sonar_report.py` in the image; skipped with a notice without `SONAR_TOKEN` or `sonar-project.properties`). The deploy jobs (`deploy-pages`, `deploy-firebase`, `deploy-pipeline-image`) run only on `master` with the repository variable `DEPLOY_ENABLED` set to `true` (M2), through Workload Identity Federation (`GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_PROJECT_ID`, `GCP_REGION`).
- `release.yml` (`v*` tags): `PIPELINE_STAGE=release`, then the GitHub Release with `docs/releases/vX.Y.Z_github_description.md` as body and the engine and admin bundles attached.
- `deps.yml` and `contract.yml` (weekly, Monday): `PIPELINE_STAGE=deps` / `contract`; on failure the local action `.github/actions/upsert-issue` opens or updates one issue ("Dependency updates available", "Third-party contract drift").
- `codeql.yml`: CodeQL advanced setup, `security-extended`, languages `actions`, `javascript-typescript`, `python`.

No workflow runs a lint or test tool itself. Every action is pinned by full SHA with a `# vX.Y.Z` comment (`action-pins`), every job has `timeout-minutes` (`workflow-timeouts`); every workflow has top-level least-privilege `permissions`, every checkout `persist-credentials: false`, no `pull_request_target` and no `${{ }}` inside a `run:` script (`workflow-policy`). The runner is `ubuntu-24.04`, pinned. Details: `docs/CI_PIPELINE.md`.

## Tool bootstrap and pins

- Node 24.21.0 and npm 11.19.0 come from `node:24-bookworm-slim` (digest in `docker/Dockerfile.quality`); `engines` requires Node 24.12 or later and `.npmrc` sets `engine-strict` and `save-exact`.
- Python 3.14.4 is the GDAL base image's interpreter. CI tools live in the plain venv `/opt/hcm/venv` from `scripts/ci/requirements.txt` (every transitive dependency pinned). The raster pipeline has its own venv, `/opt/hcm/pipeline-venv` (`--system-site-packages` so `osgeo.gdal` is visible, `--without-pip`), filled from `pipeline/poetry.lock` by Poetry 2.5.1 in `/opt/hcm/poetry` (`pipeline/requirements-poetry.txt`); the pipeline's gates use it (`pipeline/README.md`).
- Playwright browsers live in `/ms-playwright`, the Firebase emulator JARs in `/opt/hcm/firebase-emulators`; JDK 21 serves the emulators.
- Every version and digest is listed in `docs/research/M0-handoff.md` → *Toolchain and pins* and summarised in `docs/CI_PIPELINE.md` → *Tool versions*.

## Latest stable dependencies and holds

Every dependency stays on its latest stable release; a deliberate hold is a `HELD` entry with its reason (in `scripts/ci/check_dependency_updates.py` once the `deps` stage exists, and in `docs/CI_PIPELINE.md` → *Held dependencies* meanwhile). Current holds: `typescript@6.0.3` (`typescript-eslint@8.71.1` peers `typescript <6.1.0`; latest is 7.0.2) and `@types/node@24.19.2` (follows the Node 24 runtime, not the 26.x line). Advisories are fixed with `overrides` in the root `package.json`, never with an allowlist.

## Local tooling quirks

- Never run a gate with the host's Node 22 or Python: versions differ from the image and results do not count.
- The GDAL base preloads tcmalloc; the quality image sets `LD_PRELOAD=""` because Chromium aborts under it. Keep it.
- A browser crash in the container writes `core.<pid>` into the repository root; `.gitignore` covers `core.[0-9]*`.
- npm 11 warns that `protobufjs` and `re2` (from `firebase-tools`) run install scripts not yet covered by `allowScripts`; approve those two explicitly if a later npm blocks them.
- pytest with `-c pipeline/pyproject.toml` makes `pipeline/` the rootdir and then ignores `testpaths`: the `pipeline-pytest` gate passes `--rootdir .`. `testpaths` is rootdir-relative, `pythonpath` relative to the config file.
- pytest 9's `caplog` captures records even from a logger with `propagate = False`; prove non-propagation with a handler on the root logger instead.
- `python3 -m venv` seeds pip 25.1.1 (12 advisories); a venv that Poetry fills is created `--without-pip`.
- ruff N802 also checks `.pyi` stubs: GDAL's CamelCase API is stubbed as typed callable attributes (`pipeline/typings/osgeo/`), and the fake M2M server is a `wsgiref` app (no `do_POST`).
- Adding a workspace needs its `COPY <dir>/package.json <dir>/` line in `docker/Dockerfile.quality` (and an allowlist line in `.dockerignore` outside `packages/*`), or `npm ci` fails in the image build.
- Prettier 3 prints `<!doctype html>` and self-closing void tags (`<meta ... />`), which html-validate's recommended `doctype-style` and `void-style` rules reject, so no committed `.html` file can pass both `prettier` and `html-validate` today. The fix is `"extends": ["html-validate:recommended", "html-validate:prettier"]` in `.htmlvalidate.json`, an ask-first config edit that M1 needs before the first page of `sites/bucharest`; the M0 smoke page is therefore fulfilled from `e2e/specs/smoke.spec.ts` instead of committed.
- Playwright answers a `page.route` before a `context.route`, and a later route before an earlier one: the firewall fixture is a context route registered first, so every mock wins over it.
