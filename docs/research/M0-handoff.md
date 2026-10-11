# M0 hand-off: monorepo scaffolding and quality pipeline

Written by the M0 foundation agent on 2026-10-11 for the agents that build M1+ on top of it.
Read this together with `PLAN.md`, `quality-conventions.md`, `design-review-testability.md` and
`design-review-security-cost.md`. Where this file and those disagree, this file records what was
actually built and why.

## 1. Status

| Item | State |
| --- | --- |
| `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` | `[SUCCESS] stage 'static' passed` (48 gates; §10e added six) |
| `PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh` | `[SUCCESS] stage 'tests' passed` (5 gates): Vitest over 6 projects (shared, ui in Chromium, engine, admin, functions, rules) under the emulators, rule coverage, pytest, the pipeline's pytest, and the per-file `coverage` gate at 100% overall |
| `PIPELINE_STAGE=e2e bash scripts/ci/run-all-checks.sh` | `[SUCCESS] stage 'e2e' passed` (2 gates: `e2e-matrix`, `playwright` with the V00 harness smoke) |
| `PIPELINE_STAGE=build bash scripts/ci/run-all-checks.sh` | `[SUCCESS] stage 'build' passed` (2 gates: `vite-build`, `bundle-budget`) |
| `quality` | passes (static, tests, e2e, build) |
| `sonar`, `deps` | **no gates yet: these stages FAIL on purpose** (so does `all`); `release` and `contract` are registered (§10) |
| Quality image | `docker/Dockerfile.quality` builds as `hcm-quality:local` (5.3 GB unpacked; about 5 min cold, seconds when cached) |
| Lockfile | `package-lock.json` (lockfileVersion 3), `npm ci` works in the image |

Nothing was committed or pushed (the orchestrator commits).

## 2. Toolchain and pins

All npm versions were checked with `npm view` on 2026-10-11 and are pinned exactly (`.npmrc`
`save-exact=true`). Node `>=24.12.0` is enforced (`engines` + `engine-strict=true`).

| Area | Pin |
| --- | --- |
| Node / npm | Node 24.21.0, npm 11.19.0 (from `node:24-bookworm-slim`) |
| TypeScript | `typescript@6.0.3` **HELD**: `typescript-eslint@8.71.1` peers `typescript <6.1.0` (latest is 7.0.2) |
| Build / test | `vite@8.3.4`, `vitest@5.0.3`, `@vitest/coverage-v8@5.0.3`, `@vitest/browser-playwright@5.0.3`, `playwright@1.64.0`, `@playwright/test@1.64.0` (`@hcm/e2e`) |
| Lint | `eslint@10.12.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.71.1`, `eslint-plugin-sonarjs@4.2.2`, `eslint-plugin-no-unsanitized@4.1.5`, `eslint-plugin-lit@2.3.1`, `eslint-plugin-wc@3.1.0`, `@vitest/eslint-plugin@1.6.27`, `eslint-config-prettier@10.1.8`, `globals@17.13.0` |
| Format / style | `prettier@3.9.10`, `stylelint@17.16.0`, `stylelint-config-standard@40.0.0`, `postcss-lit@1.4.1` |
| HTML / Markdown | `htmlhint@1.9.2`, `html-validate@11.16.2`, `markdownlint-cli2@0.23.3` |
| Architecture | `knip@6.41.0`, `dependency-cruiser@18.5.0` |
| Runtime | `lit@3.3.3` (in `@hcm/ui`) |
| Firebase CLI | `firebase-tools@15.33.0` (root devDependency; emulator JARs baked into the image) |
| Types | `@types/node@24.19.2` (Node 24 line, not the 26.x latest) |
| Python CI tools | `scripts/ci/requirements.txt`: ruff 0.17.0, mypy 2.4.0, pytest 9.1.1, pytest-cov 7.1.0, coverage 7.16.2, yamllint 1.38.0, check-jsonschema 0.38.2, bandit 1.9.4, pip-audit 2.10.1, radon 6.0.1, defusedxml 0.7.1, editorconfig 0.17.1, requests-mock 1.12.1, taplo 0.9.3, plus every transitive dependency pinned; pip 26.2.1 |
| Python | 3.14.4 (the GDAL image's interpreter). The raster pipeline uses `requires-python = ">=3.14,<3.15"` (§10c) |

Not added yet (add with the milestone that first imports them, so knip stays clean):
`mapbox-gl@3.32.0` (dev dependency of `@hcm/engine` for types and browser tests; never bundled),
`zod`, `@material/material-color-utilities`, `@m3e/web`, `@material/web`, `@axe-core/playwright`,
`msw`, `jsdom`. (`firebase`, `@firebase/rules-unit-testing` and `@playwright/test` joined in M0: §10b, §10d.)

### npm audit fixes (no allowlist)

`npm audit --audit-level=low` reports 0 vulnerabilities thanks to `overrides` in the root `package.json`:

| Override | Why |
| --- | --- |
| `@opentelemetry/core` → 2.12.0 | GHSA-8988-4f7v-96qf; pulled by `@google-cloud/pubsub@5` in firebase-tools (pubsub 6 itself moved to 2.x; only `W3CTraceContextPropagator` is used) |
| `basic-ftp` → 6.2.3 | GHSA-c475-qrg2-pj4r; firebase-tools → proxy-agent → get-uri (only `Client` is used) |
| `gaxios@6.7.1` → `uuid` 11.1.1 | GHSA-w5hq-g745-h8pq; gaxios only calls `v4()`; uuid 11 is the last CJS-compatible line |
| `katex` → 0.19.0 | GHSA-238p-pmpm-9mq7 (markdownlint math extension) |
| `smol-toml` → 1.9.1 | GHSA-r4xh-jqrq-34v2 (markdownlint-cli2, knip) |
| `braces` → `$braces` = `file:vendor/npm/braces` | GHSA-vfj7-8cjw-p6xm has **no** fixed release; `vendor/npm/braces` is 3.0.3 with the depth-limit patch the sibling Whisper-Pro-ASR repo carries (see its README). Delete it when upstream ships a fix |

`vendor/` is third-party code: it is excluded from ESLint, Prettier, markdownlint, yamllint,
taplo, ruff and the suppression scan, and knip ignores the `braces` dependency.

## 3. Docker images and digests

| Image | Pin |
| --- | --- |
| Dockerfile frontend | `docker/dockerfile:1.27.1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e` |
| Base | `ghcr.io/osgeo/gdal:ubuntu-small-3.13.3@sha256:64250faf833c06d4b21afce4c27190039ba7ab58d70f0eebc87cf77d929c0b40` (Ubuntu 26.04, Python 3.14.4, GDAL 3.13.3, `osgeo` in `/usr/lib/python3/dist-packages`) |
| Node | `node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20` (same digest as `node:24-slim`) |
| actionlint | `rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667` |
| hadolint | `hadolint/hadolint:v2.15.1-debian@sha256:9a3944b7fddcb947d1ffd90829ac1a6e5c30479223358f249d8b96c7d0019e27` |
| shellcheck | `koalaman/shellcheck:v0.11.0@sha256:61862eba1fcf09a484ebcc6feea46f1782532571a34ed51fedf90dd25f925a8d` |
| shfmt | `mvdan/shfmt:v3.14.1@sha256:8c06884a35683d8763fba6c0d9484d11a61a96da65f8d497d6f625825a6043f2` (newer than the 3.13.1 in the conventions doc) |
| gitleaks | `zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` |

apt pins (Ubuntu 26.04): `openjdk-21-jre-headless=21.0.12*`, `git=1:2.53.0*`, `curl=8.18.0*`,
`python3.14-venv=3.14.4*`. Playwright's `install --with-deps chromium firefox webkit` works on
26.04 as is.

What the image contains, and where:

- `/opt/hcm/venv`: Python CI tools (first on `PATH`). It is a plain venv without system site
  packages; the GDAL pipeline has its own venv (next bullets).
- `/opt/hcm/poetry`: Poetry 2.5.1 in its own venv (`pipeline/requirements-poetry.txt`), and
  `/opt/hcm/pipeline-venv`: the pipeline's locked runtime and dev dependencies, created with
  `--system-site-packages` (so `osgeo` is importable) and `--without-pip` (§10c).
- `/opt/hcm/npm-cache` (`npm_config_cache`): the npm cache filled by a build-time `npm ci`. The
  build-time `node_modules` is deleted; the runtime installs from this cache.
- `/ms-playwright` (`PLAYWRIGHT_BROWSERS_PATH`): Chromium, Firefox, WebKit for Playwright 1.64.0.
- `/opt/hcm/firebase-emulators` (`FIREBASE_EMULATORS_PATH`): Firestore, Storage and Pub/Sub
  emulator JARs (`npm run emulators:setup`). World-writable so any uid can use them.
- `ENV HCM_TEST_IMAGE=1`, `USER 10001:10001`, `git config --system safe.directory '*'`.
- `ENV LD_PRELOAD=""`: the GDAL base image preloads `libtcmalloc_minimal.so.4` into every
  process, and Chromium aborts under it (`tcmalloc: Attempt to free invalid pointer`, SIGILL).
  Keep this in the quality image; the pipeline's `runtime` image keeps tcmalloc for GDAL.
- BuildKit cache mounts: `hcm-apt-cache`, `hcm-apt-lists`, `hcm-pip`, `hcm-poetry`.

`.dockerignore` is an allowlist (root manifests, `packages/*/package.json`, `functions/package.json`,
`firebase/rules-tests/package.json`, `e2e/package.json`, `vendor/npm/braces`, `scripts/ci/requirements.txt`
and the three pipeline dependency files), so the image only rebuilds when a manifest changes.
**When you add a workspace, add its `COPY <dir>/package.json <dir>/` line to the Dockerfile**
(and a `!<dir>/package.json` line to `.dockerignore` if it is outside `packages/*`); `npm ci`
fails in the build otherwise.

## 4. Running things

Everything that is a gate runs in the image. Never trust the host Node (22) or host Python.

```bash
PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh   # or tests, build, quality, all (default)
```

`run-all-checks.sh` builds the image (`scripts/ci/build-and-test.sh`, seconds when cached), then
runs `scripts/ci/in-container.sh` with `--user $(id -u):$(id -g)`, `HOME=/tmp/hcm-home`, the repo
at the same absolute path, and nothing else from the host. `in-container.sh` refuses to run without
`HCM_TEST_IMAGE=1`, then execs `python3 scripts/ci/pipeline.py --stage "$PIPELINE_STAGE"`.

Before the first gate, `pipeline.py` runs `npm ci --prefer-offline` into the bind-mounted
`node_modules` whenever `node_modules/.hcm-install-stamp` does not hold the SHA-256 of
`package-lock.json` (offline from the baked cache: about 1165 packages in about 10 s; free afterwards). Delete the
stamp to force it. The static gates then take about 35-55 s in total, the tests stage about 55 s (the
emulators start in about 8 s), e2e and build a few seconds each.

Ad-hoc npm commands (install a dependency, regenerate the lockfile), always in a container:

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/h -e npm_config_cache=/tmp/h/.npm \
  -v "$PWD:$PWD" -w "$PWD" \
  node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 \
  npm install --save-exact <pkg>@<version> --workspace @hcm/<name>
```

Ad-hoc commands with the full toolchain (ruff, vitest browser mode, tsc, ...):

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx vitest run --project ui'
```

## 5. Workspace conventions

- Root package `historic-city-map` (private, `type: module`). Workspaces: `packages/*`, `functions`,
  `firebase/rules-tests`, `e2e`. Packages: `@hcm/shared`, `@hcm/ui`, `@hcm/engine`, `@hcm/admin`,
  `@hcm/test-support`, `@hcm/functions` (§10b), `@hcm/rules-tests` (§10b), `@hcm/e2e` (§10d). Add a new
  workspace to `workspaces` only together with its `package.json` (npm fails on a path without one).
- Internal packages are **source-first**: `exports` points at `./src/index.ts`, there is no
  per-package build for consumers, and workspace dependencies are pinned to `"0.0.0"`.
- Relative imports use the **`.js` extension** (`import { ro } from './ro.js'`). It resolves under
  Vite, Vitest, `moduleResolution: bundler` and `nodenext` (functions), so shared code works everywhere.
- **Two TypeScript projects per package**: `<pkg>/tsconfig.json` (src only, no Node or Vitest
  types leak into product code) and `<pkg>/test/tsconfig.json` (`types: ["node"]`, plus
  `vite/client` where src imports CSS). Both are referenced from the root `tsconfig.json` solution;
  `tsc -b` type-checks everything (declaration-only output in `.tsbuild/`, gitignored).
  `tsconfig.tools.json` covers `vitest.config.ts` and `packages/*/vite.config.ts`.
  TypeScript 6 defaults to `types: []` and checks side-effect imports, hence the explicit `types`.
- Tests live in `<pkg>/test/**/*.test.ts`, never next to sources (Sonar `sources`/`tests` stay
  disjoint). Names: `happyPath_…` / `badPath_…` (TS), `test_happy_path_…` / `test_bad_path_…` (Python).
- `@hcm/test-support` is test-only (outside coverage, Sonar tests). Today it has
  `createRecordingSink()`; FakeMap, msw handlers and API fixtures go there in M1.
- Engine library build (`packages/engine/vite.config.ts`): formats `iife` + `es`, global
  `HistoricCityMap` (`window.HistoricCityMap`), files `dist/engine.iife.js`, `dist/engine.mjs`,
  `dist/engine.css` (`cssFileName`), `mapbox-gl` external mapped to the global `mapboxgl`
  (`build.rolldownOptions`, Vite 8). Admin is the same with `HistoricCityMapAdmin` / `admin.*`.
  `ENGINE_VERSION` and `MAPBOX_GL_VERSION = '3.32.0'` are exported by the engine.
- Lit: **no decorators** (ESLint bans the `Decorator` node). Declare reactive properties with
  `static override readonly properties = {...}`, `declare name: string;` fields and defaults in the
  constructor (required with `useDefineForClassFields: true`). Register with an idempotent
  `define…()` function. Custom element prefix `hcm-`. `hcm-hello` is the scaffolding sample.
- Logging: product TS logs only through `createLogger(scope, { sink, minLevel })` from
  `@hcm/shared` (`no-console` everywhere except `packages/shared/src/log.ts`). Data keys that look
  like secrets (`token`, `secret`, `password`, `authorization`, `signature`, `apiKey`) are redacted.
  Python CI scripts log through `scripts/ci/cilog.py` (`print` is banned by ruff T20).
- i18n: catalogues in `packages/shared/src/i18n/{ro,en}.ts`; `ro` is the key source of truth and
  the default locale; `en` is typed `Messages`, so a missing or extra key is a compile error.
  `resolveLocale(tag)` maps anything that is not English to `ro`.
- Lit tests run in **Vitest browser mode** (Chromium, headless, `@vitest/browser-playwright`), the
  other projects in `node`. Lit's Node build shims `customElements`, so engine/admin modules that
  register elements also load in `node` tests. `vitest.config.ts` has one row per suite
  (`SUITES`); a suite is enabled when `<dir>/package.json` exists, and its `coverage` globs are the
  only files measured (Vitest 5 never adds unlisted files). `functions` and `rules` rows already exist.

## 6. The quality pipeline (`scripts/ci/pipeline.py`)

The registry is data:

- `GATES`: `Gate(name, command, files=())`. `command` runs from the repo root and passes on exit 0.
  With `files` (git pathspecs), the matching tracked + untracked-not-ignored files are appended;
  no match means "skipped" (a pass). Node tools are invoked through `npm run --silent <script>`, so
  `package.json` scripts stay the single definition of their flags.
- `STAGES`: simple stage → ordered gate names. `COMPOSITE_STAGES`: `quality` = static, tests, e2e,
  build; `all` = quality, sonar.
- `validate_registry()` rejects unknown or duplicated names; it runs before every stage and in the tests.

Output: `static 10/48 tsc` before each gate, a `passed`/`FAILED (exit N)` line with the duration,
then `[SUCCESS] stage 'static' passed (reports/pipeline/green-static.json)` or
`[FAILURE] stage 'static' failed: static/eslint, ...` (exit 1). All gates run even after a failure.
The green marker is `{stage, head, status_sha256}`, the hash of
`git status --porcelain=v1 --untracked-files=all`. An empty stage fails ("no gates registered yet").

**How to add a gate** (example: radon grade A):

1. Pin the tool (npm devDependency, `scripts/ci/requirements.txt`, or a digest-pinned binary in the Dockerfile).
2. Add `Gate("radon", ("python3", "scripts/ci/check_radon.py"))` to `GATES` (for npm tools, add a
   `package.json` script and use `(*NPM_RUN, "<script>")`).
3. Add `"radon"` to the right tuple in `STAGES` (cheapest first; network-bound gates last).
4. Run `python3 -m pytest` in the image: `test_happy_path_every_gate_belongs_to_a_stage` and the
   registry test fail on typos. Update this file and the gate table in `docs/CI_PIPELINE.md` (when it exists).

The registry holds 57 gates (`python3 scripts/ci/pipeline.py --list`; the table with each gate's
command is `.agent/skills/quality/pipeline_skill.md` → *Stages*): static 48, tests 5 (`vitest`,
`rules-coverage`, `pytest` (also in static), `pipeline-pytest`, `coverage`), e2e 2 (`e2e-matrix`, `playwright`), build 2
(`vite-build`, `bundle-budget`), release 3 (`release-check` plus the two build gates), contract 1
(`contracts`); `sonar` and `deps` are empty.

`scripts/ci/check_no_inline_suppressions.py` is the suppression gate (ported from Watch-GPS and
extended with TS/Vitest/Playwright/CSS/HTML/Dockerfile patterns). It skips itself; its tests
assemble the directive strings from fragments so the test file stays clean. Use the same trick
whenever a test needs a banned directive as data.

Python coverage: `.coveragerc` (`branch = True`, `source = scripts/ci`, only `scripts/ci/tests/*`
omitted, `fail_under = 90`, no exclusion pragmas; `if __name__ == "__main__":` is covered by
running the scripts with `runpy`). Reports: `reports/coverage/scripts.xml`, `reports/junit/pytest.xml`.
TS coverage: `reports/coverage/ts/{lcov.info,coverage-summary.json}`, `reports/junit/vitest.xml`,
per-file thresholds 90/90/90/90. The tests' `conftest.py` blocks every non-loopback socket.

## 7. Config relaxations (each one has a why-comment in its file)

| File | Relaxation |
| --- | --- |
| `eslint.config.js` | `no-console` off for `packages/shared/src/log.ts` only; test files get Vitest rules and larger size limits (600 lines, 120 per function, 8 params); `disableTypeChecked` for the plain-JS tool configs; CommonJS for `.dependency-cruiser.cjs` |
| `ruff.toml` | `S603` off everywhere (subprocess audit marker); tests: `S101 S105 S106 S108 S607 PLR2004`; `*.md` excluded (ruff 0.17 formats Python blocks inside Markdown; Markdown belongs to markdownlint) |
| `.coveragerc` | `omit = scripts/ci/tests/*` (tests are not product code) |
| `.markdownlint-cli2.jsonc` | `MD013`, `MD033`, `MD041` off; `MD024` siblings only (sibling-repo config) |
| `.prettierignore` | `*.md` (markdownlint owns Markdown), `package-lock.json`, `seed/`, `docs/research/*.json` (verbatim research artifacts), `vendor/` |
| `.gitleaks.toml` | path allowlist for gitignored caches and outputs only (scope, not tolerance) |
| `knip.json` | `ignoreDependencies: ["braces"]` (it is used through `overrides` only) |
| `.editorconfig` | `*.sh` and `scripts/git-hooks/*` use tabs, in two sections (shfmt does not match a mixed brace list) |

To get `markdownlint` green, the research Markdown under `docs/research/` was reformatted
(blank lines around headings and lists, `| --- |` table separators, `text` on bare code fences,
bold pseudo-headings turned into headings). In `quality-conventions.md` one sentence was
reworded: "Never `curl -u`" sat within five lines of `--user uid:gid`, which gitleaks' multi-line
`curl-auth-user` rule reports. The content was not changed otherwise. New addenda to `PLAN.md`
must follow the same rules, or the static stage fails.

## 8. TODO for the next agents

- **M1 (engine, shared, ui):** add `mapbox-gl@3.32.0` (dev, `@hcm/engine`), zod schemas, the
  `MapPort` + `mapbox-adapter.ts` (the only file allowed to import `mapbox-gl`; dependency-cruiser
  rule `only-the-map-adapter-imports-mapbox`), FakeMap in test-support, M3 tokens. Replace
  `hcm-hello` and `boot()` when the real viewer exists. Split engine tests into node and browser
  projects when the adapter arrives (one more `SUITES` row).
- **functions/ and firebase/ (M2; scaffolded and tested in M0, see §10b):** the remaining
  functions behind their ports, a `functions/dist` lockfile, per-function service accounts, App Check,
  dependency-cruiser rules for `functions/` (ask first: `.dependency-cruiser.cjs`) and the first deploy.
- **pipeline/ (M3; skeleton done in M0, see §10c):** the processing steps, the fake M2M server's
  download endpoints, Firestore and Storage fakes, `devtools/poller.py`, the compose tier.
- **e2e/ (M1; harness done in M0, see §10d):** `@axe-core/playwright`, the emulator topology
  (`firebase emulators:exec` around Playwright, the functions emulator on `functions/dist`), the mock
  APIs, a `webServer` for the built site, and the functional, tour, a11y, no-WebGL and cross-browser
  projects of `design-review-testability.md` §4.3.
- **Gates still to add:** jscpd, pylint and vulture (radon and bandit for `scripts/ci` landed in §10e); the `sonar` stage (copy `/opt/sonar-scanner` from the pinned scanner image
  into `docker/Dockerfile.quality`, then `Gate("sonar", ("bash", "scripts/ci/sonar_scan.sh"))`) and the
  `deps` stage (`scripts/ci/check_dependency_updates.py`).
- The default `PIPELINE_STAGE` is `all`, which fails until the `sonar` stage has a gate.

## 9. Caveats noticed

- npm 11.19 prints "install scripts not yet covered by allowScripts" for `protobufjs` and `re2`
  (firebase-tools). The scripts still run today; if a future npm blocks them, approve those two
  explicitly.
- `firebase-tools` pulls ~800 packages. Overrides cover today's advisories; expect new ones.
- Lit logs "Lit is in dev mode" in Node tests (Vite resolves the `development` condition). Harmless.
- Re-export-only files (`packages/*/src/index.ts`) have no executable statements: v8 reports
  them as 0 of 0 and Vitest's thresholds pass. The future `check_coverage.py` must treat 0/0 as covered.
- typescript-eslint's `no-unused-vars` does not exempt `_`-prefixed parameters; omit unused
  parameters instead.
- A browser crash in a container writes `core.<pid>` into the repository root; `.gitignore`
  covers `core.[0-9]*`.
- The research Markdown is a moving target if the orchestrator appends to it: keep blank lines
  around headings and lists.

## 10. CI workflows, git hooks and repository meta

Added by the M0 CI agent on 2026-10-11. The stage table stays in
`.agent/skills/quality/pipeline_skill.md`; the workflow overview is in `docs/CI_PIPELINE.md`.

- **Workflows** (`.github/workflows/`): `ci.yml`, `release.yml`, `deps.yml`, `contract.yml`,
  `codeql.yml`. Every job calls `scripts/ci/run-all-checks.sh` per stage (or
  `scripts/ci/build-and-test.sh` for the image); no tool is called directly. The image is shared
  through the GitHub Actions layer cache: `build-image` writes it (`HCM_DOCKER_BUILD_FLAGS` with
  `--cache-to type=gha,mode=max,scope=hcm-quality --output type=cacheonly`), every stage job
  rebuilds from it with `--load --cache-from type=gha,scope=hcm-quality`. The local composite
  action `.github/actions/quality-image` frees disk, sets up Buildx and exposes the cache runtime
  (`crazy-max/ghaction-github-runtime`, required for `type=gha` in a `run` step);
  `.github/actions/upsert-issue` opens or updates the weekly deps/contract issue.
- **Action pins** (resolved with `gh api repos/<o>/<r>/git/ref/tags/<tag>`, annotated tags
  dereferenced, 2026-10-11): checkout v7.0.1, upload-artifact v7.0.2, download-artifact v8.0.2,
  setup-buildx v4.4.1, build-push v7.4.0, login v4.6.0, ghaction-github-runtime v4.0.0,
  action-junit-report v6.6.1, sonarqube-scan v8.3.0, sonarqube-quality-gate v1.2.1,
  configure-pages v6.0.0, upload-pages-artifact v5.0.0, deploy-pages v5.0.1, google auth v3.0.0,
  codeql-action v4.38.3, action-gh-release v3.0.3. The SHAs are in the workflows.
- **Deploys are off** until M2: the jobs exist in `ci.yml` but need the repository variable
  `DEPLOY_ENABLED=true`, the `deploy` environment and the WIF variables `GCP_WIF_PROVIDER`,
  `GCP_DEPLOY_SA`, `GCP_PROJECT_ID`, `GCP_REGION` (none exist yet). GitHub Pages is still the
  legacy branch build from `master`; switching it to "GitHub Actions" is an M2 settings change
  (ask first). The Pages artifact path `sites/bucharest/dist` is a placeholder for the M1/M2 site build.
- **New stages and gates:** `release` (`release-check` = `scripts/ci/check_release.py`, then
  `vite-build`, `bundle-budget`) and `contract` (`contracts` = `scripts/ci/check_contracts.py`,
  reading `packages/admin/src/setup/links.json`, the verified Setup Assistant deep links). Static:
  `workflow-timeouts`, `action-schema`, `issue-forms-schema`, `issue-config-schema`
  (check-jsonschema built-in schemas, no network). `run-all-checks.sh` forwards `E2E_SHARD`.
- **Git hooks** (`scripts/git-hooks/`, `git config core.hooksPath scripts/git-hooks`): pre-commit
  refuses secret-bearing files, then runs the suppression scan on the staged index and gitleaks on
  the staged changes **in the quality image** (`docker run --network none`; directly when
  `HCM_TEST_IMAGE=1`). pre-push requires `reports/pipeline/green-all.json` (HEAD = the pushed
  commit, clean tree) only for `refs/heads/master` and `refs/tags/v*`; work branches pass.
  `scripts/ci/tests/test_git_hooks.py` drives both with real git commits and pushes in throwaway
  repositories (real scanner and gitleaks; a fake `docker` for the image path).
- **Repository meta:** `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/` (bug and
  feature forms, blank issues off; a private-advisory contact link waits for the user to enable
  private vulnerability reporting), `.coderabbit.yaml`,
  `.github/badges/{coverage,branches}.svg` (`unknown` until the `coverage` gate rewrites them).
- **Lesson:** git sends a pre-commit hook's stdout to stderr, but not a pre-push hook's; hook tests
  assert on both streams together.

## 10b. Firebase, security rules and functions

Added by the M0 firebase agent on 2026-10-11. Status: `npm test` (every Vitest project under the
emulators) passes, 27 files; the `rules-coverage` gate passes (587 Firestore rule expressions
evaluated, all 20 `allow` conditions both allowed and denied); every `functions/src` file is at 100%
lines (one 95% branch file); `scripts/ci/check_rules_coverage.py` is at 100%.

### Layout (deviation from PLAN: `firebase.json` at the root)

- `firebase.json` and `.firebaserc` live at the **repository root**, not in `firebase/`:
  firebase-tools resolves every path through `Config.path()`, which refuses anything outside the
  directory that holds `firebase.json` ("is outside of project directory"). From `firebase/` the
  deploy could reach neither `functions/` nor `packages/admin/dist`. The emulators are also found
  from any subdirectory this way.
- `firebase/firestore.rules`, `firebase/storage.rules`, `firebase/firestore.indexes.json` (no
  composite index yet; `photos.description` and `photos.exif` are exempt from indexing) and the
  `firebase/rules-tests` workspace (`@hcm/rules-tests`).
- `.firebaserc` maps only `e2e` → `demo-hcm`; the real project is added with the first deploy (M2).
- Emulators on `127.0.0.1`: auth 9099, firestore 8080 (websocket 9150), storage 9199, functions
  5001, hosting 5000, hub 4400, logging 4500; `singleProjectMode`, UI off.
  `firebase/rules-tests/test/firebase-config.test.ts` pins this layout and the admin headers.
- `firebase.json` validates against `node_modules/firebase-tools/schema/firebase-config.json`
  (the `firebase-schema` static gate).

### How the tests run

- `npm test` = `firebase emulators:exec --project demo-hcm --only auth,firestore,storage 'bash
  scripts/ci/run-emulated-tests.sh'`. That script runs `npm run test:unit` (= `vitest run
  --coverage`, all projects, ONE merged `reports/coverage/ts/lcov.info`), then
  `check_rules_coverage.py save` (the coverage report is only reachable while the emulators run),
  keeping Vitest's exit status. The `vitest` gate calls `npm test` unchanged; startup adds about 8 s.
- `npm run test:unit` runs Vitest without emulators: fine for one project (`npx vitest run
  --project ui`), but the `rules` project and `functions/test/adapters/firestore.test.ts` need the
  emulators and fail fast without them.
- Gate `rules-coverage` (tests stage, after `vitest`): `check_rules_coverage.py check` reads
  `reports/rules/firestore-coverage.json` and fails when an expression was never evaluated (a
  short-circuited operand, `{}` in the report, does not count), when an `allow` condition never
  allowed or never denied (a constant such as `if false` is exempt), or when the report was made
  from other rules. The HTML report sits next to it. The Storage emulator has no coverage report:
  `storage.test.ts` covers each condition explicitly.
- The emulator's report format (firebase-tools 15.33.0): `{rules: {files: [{name, content}]},
  report: [node]}`, node = `{sourcePosition: {line, column, currentOffset, endOffset (inclusive,
  character offsets)}, values?: [{value, count}], children?}`; missing `values` = never evaluated,
  `value: {}` = short-circuited, `value: {undefined: {causeMessage}}` = error.

### Rules-test conventions (`firebase/rules-tests/test/support/world.ts`)

- The emulators load the rules from `firebase.json` once; tests never pass `rules` to
  `initializeTestEnvironment` (reloading rules resets the coverage) and never clear data. Test
  files run in parallel, so each owns a scope: persona uids `<scope>-<persona>` and its own city ids.
- Personas: `anonymous`, `stranger` (verified Google, no claim), `unverified`, `otherProvider`
  (password sign-in), `claimOnly` (revoked admin: claim, no `admins` doc), `docOnly`, `admin`.
- `verdict(request)` returns `'allow' | 'deny'` (anything but PERMISSION_DENIED is rethrown) and
  `verdicts(personas, fn)` a whole row, so a failure shows the full matrix. `vi.setConfig` raises
  the timeouts to 30 s from the support module (the shared `vitest.config.ts` is ask-first).
- firebase@13's compat types reference `Temporal.Instant`: the rules-tests tsconfig adds
  `lib: esnext.temporal` (types only).

### Data shapes the rules fix (M1 zod schemas must match)

- `cities/{c}`: `name{ro,en}` (≤100), `bounds{west,south,east,north}` (degrees, west ≤ east,
  south ≤ north), `published`; `id`, `mapbox`, `createdAt` are server-owned.
- `photos/{p}`: required `title`, `location{lat,lng}` (inside the city bounds ±0.5°), `license`
  (`CC0`, `CC-BY-4.0`, `CC-BY-SA-4.0`, `PD`, `permission`, `permission-legacy`, `unknown`),
  `published`, `updatedBy`, `updatedAt`; optional `description{ro,en}` (≤5000), `year`/`yearEnd`
  (ints 1800–2100), `author`, `rightsHolder`, `sourceLabel` (≤200), `sourceUrl` (https only),
  `permissionNote` (≤2000), `legacyId` (≤64), `links` (list ≤5), `bearing` 0–360, `fov` 1–180,
  `rightsReview`; server-owned `image`, `exif`, `processing` (`pending` on create; publishing
  needs `done` and a licence other than `unknown`), `createdAt`, `createdBy`. Any other key is denied.
- Every client write stamps `updatedBy = uid` and `updatedAt = serverTimestamp()`
  (`== request.time`); jobs carry `createdBy`/`createdAt` instead.
- `layers`: admins change only `label`, `description`, `order` (int), `opacity` 0–1,
  `defaultVisible`, `published`, `attribution` (≤500) plus the stamp. `jobs`: create
  `{type ∈ usgs-import|geotiff-import|regeoref|republish, status: queued, params: map, createdBy,
  createdAt}`; update only `cancelRequested: true`. `gcps/{layer}`: `{points: list ≤300}` + stamp.
  `usgsScenes`: only `status ∈ candidate|ordered|rejected` and `note` (≤1000).
- Read-only for admins, never client-written: `admins`, `setup`, `usage`, `ops`, `jobs/*/logs`.
- Storage: `create` also covers overwriting an existing object, so uploads require
  `resource == null` (found by the rules tests; each upload has its own `{upload}` id).

### Functions (`functions/`, `@hcm/functions`)

- `src/index.ts` (exports only: `export * as setup`, deployed as `setup-status`),
  `src/global-options.ts` (`setGlobalOptions({region: 'us-central1', maxInstances: 5})`, imported
  first by every trigger because firebase-functions reads it at declaration time),
  `src/triggers/` (thin `onCall`), `src/handlers/` (pure: `requireAdmin` = claim, verified Google
  and `admins/{uid}`; `setupStatus` projects `setup/status` field by field so nothing unlisted,
  secrets included, ever leaves), `src/ports/` (interfaces; `Ports` aggregate, handlers take
  `Pick<Ports, ...>`), `src/adapters/` (Firestore via the Admin SDK, Secret Manager over REST with
  `fetch` + a google-auth-library `TokenProvider`, an in-memory secret store for the Functions
  emulator, the Cloud Logging sink for `createLogger`), `src/deps.ts` (composition root, created on
  first use). `CloudRunJobs`, `MapboxApi` and `UsgsApi` are ports only until M2/M3.
- Callable `setup-status` keeps `enforceAppCheck: false` until the admin ships App Check (M2).
- Tests: handlers with fakes (`functions/test/support/fakes.ts`), triggers through v2 `.run()` with
  `vi.mock('../../src/deps.js')`, adapters with a fake `fetch` or the Firestore emulator. No
  firebase-functions-test (F2).
- Build: `functions/build.mjs` uses Vite 8 SSR (Rolldown), the monorepo's bundler, instead of
  adding esbuild: `@hcm/*` is bundled, npm dependencies stay external. It writes
  **`functions/dist/`** (`index.js`, `package.json` with the exact pins), not `functions/deploy/`:
  every tool already ignores `dist/` (git, ESLint, Prettier, dependency-cruiser, Sonar), while a
  `deploy/` directory would need an ESLint ignore (ask-first config). `firebase.json` deploys
  `functions/dist` with `predeploy` building it. Verified: Node imports it, and the Functions
  emulator loads it and answers an anonymous call with `UNAUTHENTICATED`. The docs, the workflows
  in `.agent/workflows/`, `sonar-project.properties` and §11 now say `functions/dist` (integration pass).
- `dependency-cruiser` now also scans `functions` (`lint:deps`), with the generic rules only.

### Admin Hosting headers (`firebase.json`)

- CSP from security review §1.8 with these changes: no project id at all (the admin sets
  `authDomain` to its own host, so `frame-src 'self'` covers the auth handler on both
  `web.app` and `firebaseapp.com`); `https://apis.google.com` in `script-src` (signInWithPopup loads
  gapi); `https://api.mapbox.com/mapbox-gl-js/` in `script-src`/`style-src` and `'wasm-unsafe-eval'`
  (mapbox-gl is never bundled, the Standard style needs WebAssembly); the GA4 hosts of Addendum 2.
- UNVERIFIED until the first deploy: whether Hosting applies these headers to the reserved
  `/__/auth/handler` page. e2e must route the emulator hosts (CSP blocks `http://127.0.0.1`).

### npm

- New pins: `firebase-functions@7.4.0`, `firebase-admin@14.5.0`, `google-auth-library@11.2.0`
  (functions), `@firebase/rules-unit-testing@6.0.0`, `firebase@13.0.0` (rules-tests).
- Override `@firebase/firestore@4.18.0` → `@grpc/grpc-js` 1.14.6 (GHSA-m9gg-hp2v-232j,
  GHSA-f596-whhp-79r4; firestore pins `~1.9.0`). npm applied it only after the stale nested
  `node_modules/@firebase/firestore/node_modules/@grpc/*` lock entries were deleted.

### Left for M2

- A `functions/dist/package-lock.json` (Cloud Build otherwise resolves transitive versions);
  generating it needs registry metadata the offline image cache does not hold.
- dependency-cruiser rules for `functions/` (no browser or UI packages) need
  `.dependency-cruiser.cjs` (ask-first).
- Runtime service accounts per function, App Check enforcement, the `functions` emulator in the
  e2e topology, and the rule for the public bucket fallback (§1.5) if `allUsers` is blocked.

## 10c. Raster pipeline (`pipeline/`)

Added by the M0 pipeline agent on 2026-10-11. Status: 135 pytest tests (unit, integration against a
fake M2M server over real loopback HTTP, synthetic GeoTIFFs written with the image's GDAL), every
one of the 10 files in `pipeline/src` at 100% lines and branches; ruff, mypy strict, radon (all
grade A), bandit (every severity) and pip-audit clean; `poetry check --lock --strict` passes;
`pipeline/Dockerfile` builds both targets (`test` runs the suite, `runtime` runs `doctor`).

### Where the pipeline runs its gates: the quality image

The quality image is the GDAL image, so the pipeline's tests and type checks run there like every
other gate. `docker/Dockerfile.quality` installs Poetry in `/opt/hcm/poetry` and the lock (main and
dev groups, `--no-root`) into `/opt/hcm/pipeline-venv`; the source is bind-mounted. That layer sits
**after** the npm layer, so a change to `pipeline/pyproject.toml`, `poetry.lock` or
`requirements-poetry.txt` (all three are in the `.dockerignore` allowlist) rebuilds only it (~30 s).
`pipeline/Dockerfile` (stages `base` → `deps` → `test` | `runtime`, build context `pipeline/`) is
the shipped image; its `test` target runs the same suite on the same base digest and is not a gate.

| Gate | Stage | Command (from the repository root) |
| --- | --- | --- |
| `ruff-check`, `ruff-format` | static | the existing global gates; `ruff.toml` needed no change |
| `pipeline-lock` | static | `poetry --directory pipeline check --lock --strict` (with `VIRTUAL_ENV` set, so Poetry creates no venv) |
| `pipeline-mypy` | static | `mypy --config-file pipeline/pyproject.toml --python-executable /opt/hcm/pipeline-venv/bin/python` |
| `pipeline-radon` | static | `radon cc --min B` and `radon mi --min B` over `pipeline/src`; any output fails |
| `pipeline-bandit` | static | `bandit -q -r pipeline/src` (every severity) |
| `pipeline-pip-audit` | static | `pip-audit --path` the venv's site-packages, then `-r pipeline/requirements-poetry.txt` |
| `pipeline-pytest` | tests | `/opt/hcm/pipeline-venv/bin/python -m pytest -c pipeline/pyproject.toml --rootdir .`, before `coverage` |

### Decisions

- **Own config, root configs untouched.** `pipeline/pyproject.toml` holds the pytest, coverage and
  mypy settings; `mypy.ini`, `pytest.ini` and `.coveragerc` stay the CI tooling's. Every command
  runs from the repository root. pytest quirk: with `-c` the rootdir becomes `pipeline/` and
  `testpaths` is ignored, hence `--rootdir .`; `testpaths` is then rootdir-relative, while
  `pythonpath` (an ini "paths" value) is relative to the config file (`src`).
- **Separate reports, one gate.** `reports/coverage/pipeline.xml` (Cobertura, `relative_files`, so
  filenames are `pipeline/src/...` with an empty `<source>`) and `reports/junit/pipeline.xml`, next
  to `scripts.xml`; `sonar-project.properties` lists both, so `check_coverage.py` merges them (no
  `coverage combine`). Data file `reports/.coverage-pipeline`, mypy cache `reports/.cache/mypy-pipeline`.
- **Pins** (latest stable, checked on PyPI 2026-10-11): numpy 2.5.4, opencv-python-headless
  5.0.0.93 (abi3 wheel), httpx 0.28.1, google-cloud-firestore 2.34.1, google-cloud-storage 3.17.0;
  dev: pytest 9.1.1, pytest-cov 7.1.0, coverage 7.16.2, respx 0.23.1, hypothesis 6.169.0; build
  backend poetry-core 2.5.0; Poetry 2.5.1. The venv's numpy shadows the image's numpy 2.3.5;
  `osgeo.gdal_array` works with it (same 2.x ABI line).
- **No pip in the pipeline venvs.** `python3 -m venv` seeds pip 25.1.1, which has 12 advisories
  (`pipeline-pip-audit` found them): both the quality image and `pipeline/Dockerfile` create the
  venv `--without-pip`; Poetry installs into it.
- **GDAL stubs without a ruff relaxation.** `pipeline/typings/osgeo/*.pyi` declares GDAL's CamelCase
  functions and methods as typed callable attributes, because ruff N802 rejects a CamelCase `def` and
  `ruff.toml` is ask-first. The idiomatic alternative is `def` stubs plus a `ruff.toml` per-file
  ignore of `N802`/`N803` for `pipeline/typings/**`, if the user approves that edit.
- **Exception names end in `Error`** (ruff N818): `AuthError`, `MaintenanceError`,
  `RateLimitError` (HTTP 429 or `RATE_LIMIT*`, with `retry_after`), `ProtocolError`,
  `UnreachableError`, all subclasses of `M2MError`.
- **Logging.** `hcm_pipeline.log.configure()` writes Cloud Logging JSON lines; the `hcm_pipeline`
  logger never propagates (another library's handler would print unredacted text). pytest 9's
  `caplog` still sees such records, so the test proves non-propagation with a root handler.
- **Tests.** The firewall (`pipeline/tests/fakes/network.py`) also blocks DNS lookups of
  non-loopback names. The hypothesis `ci` profile is derandomized with no example database (no
  `.hypothesis/` in the tree). The fake M2M server is `wsgiref` (an `http.server`), because a
  `BaseHTTPRequestHandler` needs a `do_POST` method that ruff N802 rejects.
- **Exit codes** (`hcm_pipeline.exit_codes.ExitCode`): 0 done or WAITING (`ops.tick` resumes),
  1 failed (Cloud Run retries), 2 usage, 3 configuration.

### Left for M3

The steps (fetch, locate/crop, georef, warp, export, publish), the job lease and heartbeat, the
fake server's `download-*` endpoints and scripted corrupt payloads, Firestore and Storage fakes,
`hcm_pipeline.devtools.poller` and the compose tier (P01, P02), the `deploy-pipeline-image` build
(`--target runtime`, context `pipeline`). pylint and vulture from the conventions list are not
wired for any Python yet.

## 10d. Integration pass and the e2e harness

Added by the M0 integrator on 2026-10-12, after the parallel agents of §10, §10b and §10c finished.
Status: `static`, `tests`, `e2e` and `build` each end with `[SUCCESS]` (§1), so `quality` passes;
`all` still fails on the empty `sonar` stage.

### What the pass did

- `npm install` in the pinned `node:24` image confirmed the lockfile matched every workspace the
  agents added; `@hcm/e2e` then joined (`@playwright/test@1.64.0`, the same version as the root
  `playwright`, deduplicated). The image was rebuilt with `COPY e2e/package.json e2e/` and the
  matching `.dockerignore` line (§3).
- Stale `functions/deploy` references now say `functions/dist` (`docs/TESTING.md`,
  `.agent/workflows/{build,deploy}.md`, §11); `sonar-project.properties` drops its
  `functions/deploy/**` exclusion (`**/dist/**` covers the artifact) and reads `e2e/tsconfig.json`.
- The Sonar skill (both copies) now lists the real scope, the CI job, `--check-token` and the 0600
  rule for `.sonar-token`; the stage table, the gates skill, the e2e skills, `docs/ARCHITECTURE.md`,
  `README.md` and `AGENTS.md` describe the workspaces and stages that exist.

### The e2e workspace (`e2e/`, `@hcm/e2e`)

- `e2e/package.json` (`test:e2e` = `playwright test`), `e2e/tsconfig.json` (in the root `tsc -b`
  solution; Node types plus the DOM for callbacks that run in the page), `e2e/playwright.config.ts`,
  `e2e/support/test.ts`, `e2e/specs/smoke.spec.ts`.
- Config: `testDir: specs`, one project `smoke-chromium` (1440×900, `ro-RO`, `Europe/Bucharest`) with
  `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` and host-resolver rules
  that resolve only loopback; `baseURL` `http://127.0.0.1:4310`; `forbidOnly`; in CI one retry with
  `failOnFlakyTests`; `E2E_SHARD=index/total` becomes `shard` (anything else throws); reports in
  `reports/junit/e2e.xml`, `reports/playwright/`, `reports/test-results/` (the paths `ci.yml` uploads).
- Fixtures (automatic in every spec that imports `../support/test.js`): the firewall, a context route
  on `**/*` that lets `127.0.0.1` and `localhost` through and aborts (`blockedbyclient`) and records
  everything else, and the console guard (console errors and uncaught page errors). Both fail the test
  at teardown unless the test claimed the entries with `take()`. Throwaway probe specs confirmed it: an
  unclaimed blocked fetch and an uncaught page error each failed their test.
- Gate `playwright` = `npm run --silent test:e2e`; stage `e2e` = `e2e-matrix`, `playwright`.
  `scripts/ci/tests/test_pipeline.py` now uses `sonar` as the empty stage.

### Decisions

- **A harness behaviour, `V00`, instead of tagging `S-V02-HAPPY`.** The smoke proves the e2e
  preconditions (a WebGL2 clear reads back `rgba(0, 128, 255, 255)` under SwiftShader; a fetch of
  `api.mapbox.com` is aborted, recorded and reported) but renders no map, so marking V02 `exists`
  would claim a viewer behaviour that does not exist yet. `S-V00-HAPPY` and `S-V00-BAD-BLOCKED-HOST`
  are `exists`; every product row stays `planned`.
- **No committed `.html` page (decision for the user).** Prettier 3 prints `<!doctype html>` and
  `<meta ... />`, which html-validate's recommended `doctype-style` and `void-style` rules reject, so
  no committed HTML file can pass both gates. The fix is to extend `html-validate:prettier` in
  `.htmlvalidate.json`, an ask-first config edit that M1 needs before `sites/bucharest/index.html`.
  Until then the smoke page is fulfilled by the spec at the loopback origin, and there is no
  `webServer` (M1 adds one for the built site).

### Waiting for the user (ask first, one by one)

- `.htmlvalidate.json`: `"extends": ["html-validate:recommended", "html-validate:prettier"]` (above).
- `pytest.ini`: the ci-checks agent added one `filterwarnings` line that tolerates the
  `codecs.open()` deprecation warning of `editorconfig` 0.17.1 on Python 3.14 (tool config; keep or
  replace).
- `ruff.toml`: a per-file ignore of `N802`/`N803` for `pipeline/typings/**` would allow ordinary GDAL
  stubs (§10c); `.dependency-cruiser.cjs`: rules for `functions/` (§10b).
- `.claude/settings.json`: the agent-assets agent proposed an allowlist without push or deploy
  commands; it is not in the tree (§11).
- `.github/workflows/` are new files that have never run on GitHub; review them before the first push.
  Repository settings for later: `git config core.hooksPath scripts/git-hooks`, private vulnerability
  reporting, Pages from Actions, `DEPLOY_ENABLED` and the WIF variables (§10).

## 10e. Adversarial review of the scaffold

Added by the M0 review agent on 2026-10-12. It audited the scaffold against `quality-conventions.md`,
`design-review-testability.md` and `PLAN.md`; `static`, `tests`, `e2e` and `build` pass again afterwards.

### Fixed

- **Suppression scan gaps** (`scripts/ci/check_no_inline_suppressions.py`): `.pyi` stubs were not scanned;
  Playwright's `test.fail(`, chained modifiers (`it.concurrent.only`, `test.describe.serial.skip`,
  `test.step.skip`) and `testInfo.skip()`/`fixme()`/`fail()` passed; so did shellcheck directives inside
  workflow `run:` scripts, YAML `# prettier-ignore`, `# fmt: off`/`# fmt: skip`/`# isort: skip`, unittest
  skips, `# pyright:` and BuildKit's `# check=skip=`.
- **Missing gates from the conventions list**: `radon` (grade A, `--no-assert`, `scripts/ci` with its
  tests) and `bandit` (`scripts/ci`, medium severity and up; the why-comment is next to `BANDIT` in
  `pipeline.py`) for the CI scripts (§4 gates 14 and 15); three grade-B functions were split. The CI
  tooling's tests now also run in `static` (§4 gate 24), which is what `AGENTS.md` promises when it says
  `static` covers tooling changes.
- **`AGENTS.md` rules no gate enforced**: `workflow-policy` (`scripts/ci/workflow-policy.schema.json`
  through check-jsonschema: no `pull_request_target`, top-level `permissions`, no `write-all`/`read-all`,
  `persist-credentials: false` on every checkout, no `${{ }}` inside a `run:` script, composite actions
  included) and `repo-policy` (`scripts/ci/check_repo_policy.py`: no secret-bearing file in git's view,
  exact npm/pip/Poetry pins, `@sha256:` digests on every Dockerfile `FROM`/`# syntax=` and YAML `image:`,
  no `:latest`, no reference to the banned legacy Mapbox account outside the docs that state the ban).
  Before, a force-added `.env.local` or `.sonar-token` passed every gate: the pre-commit hook is not
  installed in this clone and `.gitleaks.toml` allowlists both paths.
- **A dead CI input**: `ci.yml` computed `GITLEAKS_LOG_OPTS` and `run-all-checks.sh` forwarded it, but no
  gate read it, while `ci.yml` and the docs described a history-mode scan. Gate `gitleaks-history` now
  scans that range in CI and passes with a notice when the variable is unset (local runs).
- **Docs that contradicted the code**: `docs/SETUP.md` said the `sonar` stage is skipped without a token
  (it has no gate and fails); the `pipeline-runner` subagent quoted `static 3/23`; gate counts.
- `pipeline/tests/unit/test_log.py`: the fake Mapbox token encoded the real account name; it now encodes
  the scenario (`redaction-test`).

### Waiting for the user (ask first, one by one)

- **`gitleaks-history` and commit `14d4d7b`** (already on `origin/feat/engine-rewrite`): it still holds the
  `curl-auth-user` false positive of §7, so a pull request whose range includes it fails `static` until the
  user either squashes the branch before the PR (a force-push) or approves a `.gitleaks.toml` allowlist
  entry for that one commit.
- **`.gitleaks.toml`**: the path allowlist for `.sonar-token` and `.env.local` (needed by the dir scan,
  which walks git-ignored files) also hides those files in history mode, and the header's "nothing
  tracked is exempted" is not true for them. Option: a separate config for `gitleaks git`.
- **`eslint.config.js`**: `e2e/**` gets neither the test rules nor any size limit, and
  `eslint-plugin-playwright` (conventions §4.2, testability §2) is not installed, so
  `playwright/no-wait-for-timeout` (sleeps) is unenforced; the relaxed test limits (600 / 120 / 8) have no
  why-comment.
- **`.dependency-cruiser.cjs`**: no rule keeps `firebase`/`@firebase/*` out of `packages/engine` (the
  public viewer never loads the Firebase SDK); `lint:deps` scans neither `e2e/` nor `firebase/rules-tests/`.
- **Workflows**: `deploy-firebase` runs `npm ci` (every install script) after the Workload Identity step,
  with `GOOGLE_APPLICATION_CREDENTIALS` and the credentials file in the mounted workspace: install before
  authenticating; the `sonarqube` job checks `scripts.xml` and `pytest.xml` but not the pipeline's reports;
  `deps.yml` will open an empty "Dependency updates available" issue every Monday while the `deps` stage
  has no gate; `release.yml` builds inside the job that holds `contents: write` (split build and publish);
  zizmor (testability §2) is not wired; `sonar.sources` leaves out `.github/actions`.
- **Research docs**: `design-review-*.md` (pushed in `14d4d7b`) list absolute paths under the local home
  directory, which name the user; the history already has them.
- **Not enforced anywhere yet**: Conventional Commits (no `commit-msg` hook), the hooks themselves
  (`core.hooksPath` is unset in this clone), WebSockets in the e2e firewall (`context.route` does not see
  them and the host-resolver rules do not stop an IP literal: `context.routeWebSocket` in M1).

## 11. Planned paths

Appended by the M0 agent-assets agent on 2026-10-11. The `agent-assets` static gate
(`scripts/ci/check_agent_assets.py`) requires every repository path written in back-ticks (or as
a relative link) in `AGENTS.md`, `CLAUDE.md`, `README.md`, `.agent/`, `.agents/`, `.claude/` and
`docs/` (outside `docs/research/`) to exist, be git-ignored, or be listed here. Each entry is a
deliberate future path with the milestone or reason that creates it. **Remove an entry in the task
that creates the file**; keep the list short (a plan that never lands is a stale doc). Append new
entries here; do not rewrite the rest of this file.

- `.claude/settings.json`: the Claude Code permission allowlist (pipeline and read-only commands). Editing it is ask first (`AGENTS.md` → *Boundaries*), so it waits for the user's explicit approval of its contents.
- `e2e/env`: M1–M2, the emulator environment for e2e (`.env.demo-hcm`, the test `.secret.local`).
- `sites`: M1, the city sites served by GitHub Pages.
- `sites/bucharest`: M1, the Bucharest site (`index.html`, `config.js`).
- `starter-kit`: M1 (template) and M5 (template repository), the three-file kit for other cities.
- `packages/engine/src/map/map-port.ts`: M1, the `MapPort` interface the engine core talks to.
- `packages/engine/src/map/mapbox-adapter.ts`: M1, the only module allowed to import `mapbox-gl`.
- `scripts/ci/check_dependency_updates.py`: the `deps` stage (latest stable of every pin, `HELD` table).
- `scripts/ci/sonar_setup.py`: the user's one-time SonarCloud token helper (hidden prompt, writes `.sonar-token`).
