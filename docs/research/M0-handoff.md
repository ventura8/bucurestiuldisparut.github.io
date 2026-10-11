# M0 hand-off: monorepo scaffolding and quality pipeline

Written by the M0 foundation agent on 2026-10-11 for the agents that build M1+ on top of it.
Read this together with `PLAN.md`, `quality-conventions.md`, `design-review-testability.md` and
`design-review-security-cost.md`. Where this file and those disagree, this file records what was
actually built and why.

## 1. Status

| Item | State |
| --- | --- |
| `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` | `[SUCCESS] stage 'static' passed` (23 gates) |
| `PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh` | `[SUCCESS] stage 'tests' passed`: Vitest 66 tests in 8 files over 4 projects (shared, ui in Chromium, engine, admin), pytest 101 tests; every measured file at 100% |
| `PIPELINE_STAGE=build` | passes (`vite build` of engine and admin) |
| `e2e`, `sonar`, `deps`, `release` | **no gates yet: these stages FAIL on purpose** (so do `quality` and `all`) |
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
| Build / test | `vite@8.3.4`, `vitest@5.0.3`, `@vitest/coverage-v8@5.0.3`, `@vitest/browser-playwright@5.0.3`, `playwright@1.64.0` |
| Lint | `eslint@10.12.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.71.1`, `eslint-plugin-sonarjs@4.2.2`, `eslint-plugin-no-unsanitized@4.1.5`, `eslint-plugin-lit@2.3.1`, `eslint-plugin-wc@3.1.0`, `@vitest/eslint-plugin@1.6.27`, `eslint-config-prettier@10.1.8`, `globals@17.13.0` |
| Format / style | `prettier@3.9.10`, `stylelint@17.16.0`, `stylelint-config-standard@40.0.0`, `postcss-lit@1.4.1` |
| HTML / Markdown | `htmlhint@1.9.2`, `html-validate@11.16.2`, `markdownlint-cli2@0.23.3` |
| Architecture | `knip@6.41.0`, `dependency-cruiser@18.5.0` |
| Runtime | `lit@3.3.3` (in `@hcm/ui`) |
| Firebase CLI | `firebase-tools@15.33.0` (root devDependency; emulator JARs baked into the image) |
| Types | `@types/node@24.19.2` (Node 24 line, not the 26.x latest) |
| Python CI tools | `scripts/ci/requirements.txt`: ruff 0.17.0, mypy 2.4.0, pytest 9.1.1, pytest-cov 7.1.0, coverage 7.16.2, yamllint 1.38.0, check-jsonschema 0.38.2, bandit 1.9.4, pip-audit 2.10.1, radon 6.0.1, defusedxml 0.7.1, editorconfig 0.17.1, requests-mock 1.12.1, taplo 0.9.3, plus every transitive dependency pinned; pip 26.2.1 |
| Python | 3.14.4 (the GDAL image's interpreter). The pipeline (M3) must use `requires-python = ">=3.14,<3.15"` |

Not added yet (add with the milestone that first imports them, so knip stays clean):
`mapbox-gl@3.32.0` (dev dependency of `@hcm/engine` for types and browser tests; never bundled),
`zod`, `@material/material-color-utilities`, `@m3e/web`, `@material/web`, `firebase`,
`@firebase/rules-unit-testing`, `@playwright/test`, `@axe-core/playwright`, `msw`, `jsdom`.

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
  packages; the GDAL pipeline gets its own Poetry venv (`--system-site-packages`) in M3.
- `/opt/hcm/npm-cache` (`npm_config_cache`): the npm cache filled by a build-time `npm ci`. The
  build-time `node_modules` is deleted; the runtime installs from this cache.
- `/ms-playwright` (`PLAYWRIGHT_BROWSERS_PATH`): Chromium, Firefox, WebKit for Playwright 1.64.0.
- `/opt/hcm/firebase-emulators` (`FIREBASE_EMULATORS_PATH`): Firestore, Storage and Pub/Sub
  emulator JARs (`npm run emulators:setup`). World-writable so any uid can use them.
- `ENV HCM_TEST_IMAGE=1`, `USER 10001:10001`, `git config --system safe.directory '*'`.
- `ENV LD_PRELOAD=""`: the GDAL base image preloads `libtcmalloc_minimal.so.4` into every
  process, and Chromium aborts under it (`tcmalloc: Attempt to free invalid pointer`, SIGILL).
  Keep this in the quality image; the pipeline runtime image (M3) may keep tcmalloc for GDAL.
- BuildKit cache mounts: `hcm-apt-cache`, `hcm-apt-lists`, `hcm-pip`.

`.dockerignore` is an allowlist (root manifests, `packages/*/package.json`, `vendor/npm/braces`,
`scripts/ci/requirements.txt`), so the image only rebuilds when a manifest changes.
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
`package-lock.json` (offline from the baked cache: 1031 packages in about 6 s; free afterwards). Delete the
stamp to force it. The static gates then take about 20 s in total, the tests stage about 5 s.

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

- Root package `historic-city-map` (private, `type: module`). Workspaces today: `packages/*`.
  Packages: `@hcm/shared`, `@hcm/ui`, `@hcm/engine`, `@hcm/admin`, `@hcm/test-support`. Planned:
  `functions/` (`@hcm/functions`), `firebase/rules-tests/` (`@hcm/rules-tests`), `e2e/` (`@hcm/e2e`);
  they are empty placeholders with a `.gitkeep`. Add each to `workspaces` only together with its
  `package.json` (npm fails on a workspace path without one).
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

Output: `static 3/23 tsc` before each gate, a `passed`/`FAILED (exit N)` line with the duration,
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

Static gates today, in order: suppressions, prettier, tsc, eslint, stylelint, htmlhint,
html-validate, markdownlint, knip, dependency-cruiser, yamllint, taplo-fmt, taplo-lint,
ruff-check, ruff-format, mypy, shellcheck, shfmt, hadolint, actionlint, gitleaks, npm-audit,
pip-audit. Tests: vitest (`vitest run --coverage`), pytest. Build: vite-build.

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
- **functions/ (M2):** create `functions/package.json` (`@hcm/functions`), add `"functions"` to
  `workspaces`, `{ "path": "functions" }` (+ test project) to `tsconfig.json`, a `COPY` line to the
  Dockerfile; the `functions` Vitest row then activates. Its tsconfig overrides
  `module`/`moduleResolution` to `nodenext`, `lib: ["es2023"]`, `types: ["node"]`.
- **firebase/ (M2):** `firebase.json`, `.firebaserc` (`demo-hcm` for emulators), rules, and
  `firebase/rules-tests/package.json` (`@hcm/rules-tests`); add the workspace as above. Run tests
  under `firebase emulators:exec --project demo-hcm` (JARs already in the image; set nothing,
  `FIREBASE_EMULATORS_PATH` is preset). Then add `check_rules_coverage.py` as a tests-stage gate.
- **pipeline/ (M3):** Poetry project `pipeline/pyproject.toml`, package `pipeline/src/hcm_pipeline`,
  `requires-python = ">=3.14,<3.15"`, venv with `--system-site-packages` for `osgeo`; extend
  `ruff.toml` (already global), `mypy.ini` (add `pipeline/src`, `typings/`), `.coveragerc` `source`,
  `pytest.ini` `testpaths`.
- **e2e/ (M1):** `e2e/package.json` (`@hcm/e2e`, `@playwright/test@1.64.0`,
  `@axe-core/playwright`), `playwright.config.ts`; register an `e2e` gate (`npm run test:e2e`),
  which makes the `e2e` stage pass.
- **Gates still to add** (PLAN static list): skill mirrors, agent-asset budgets, data files
  (`check_data_files.py` + `check-jsonschema`), editorconfig check, radon grade A, bandit,
  `check_coverage.py` (per-file, Sonar-scoped; tests stage), i18n key parity, action pins,
  repo and bundle budgets, jscpd. The `sonar`, `deps` and `release` stages need their gates.
- **CI and agent assets:** `.github/workflows/*` (actionlint and hadolint gates already wired:
  they activate as soon as files exist), `AGENTS.md`, `CLAUDE.md`, `.agent/`, `.agents/skills`,
  `.claude/`, `scripts/git-hooks/*`, `sonar-project.properties`, `docs/CI_PIPELINE.md` and friends.
- The default `PIPELINE_STAGE` is `all`, which fails until the e2e and sonar stages have gates.

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
