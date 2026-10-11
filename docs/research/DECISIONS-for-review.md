# Decisions for review

Proposals for edits that `AGENTS.md` lists under *Ask first* (lint and tool configs, `.github/workflows/`,
`.gitleaks.toml`, `.claude/settings.json`), so no agent applied them. Each section is one decision: the exact
change, why, and how to verify it. Approve or reject them one by one; an approved section is applied in its own
change, followed by the stage named under *Verify*. Nothing here weakens a gate: every proposal either adds a
check or narrows a scope to exactly the false positive it names.

Opened on 2026-10-12 by the agent that closed the M0 review leftovers (`docs/research/M0-handoff.md` §10f), from
the findings of §10d and §10e.

## 1. `.htmlvalidate.json`: extend `html-validate:prettier`

Prettier 3 prints `<!doctype html>` and self-closing void tags (`<meta ... />`); html-validate's recommended
`doctype-style` and `void-style` rules reject both, so today no committed `.html` file can pass the `prettier` and
`html-validate` gates together. html-validate 11.16.2 ships the `html-validate:prettier` preset, which turns off
exactly the rules that contradict Prettier's output and nothing else. M1 needs it before the first page of
`sites/bucharest/`.

```diff
-    "extends": ["html-validate:recommended"],
+    "extends": ["html-validate:recommended", "html-validate:prettier"],
```

Verify: `PIPELINE_STAGE=static` with the first committed `.html` file.

## 2. `eslint.config.js`: Playwright rules for `e2e/`, why-comments for the test limits

Today `e2e/**` gets neither the test rules nor any size limit, and `eslint-plugin-playwright`
(`quality-conventions.md` §4.2, `design-review-testability.md` §2) is not installed, so nothing enforces "no
sleeps" (`playwright/no-wait-for-timeout`) or web-first assertions. The relaxed test limits (600 / 120 / 8) have no
why-comment, which the config's own header requires.

Install first (the latest release, checked with `npm view` on 2026-10-12; peer `eslint >=8.40.0`), in the pinned
Node image (`docs/SETUP.md` → *npm in a container*):

```bash
npm install --save-exact --save-dev eslint-plugin-playwright@2.12.1
```

```diff
 import nounsanitized from 'eslint-plugin-no-unsanitized';
+import playwright from 'eslint-plugin-playwright';
 import sonarjs from 'eslint-plugin-sonarjs';
@@
 const TESTS = ['packages/*/test/**/*.ts', 'packages/test-support/src/**/*.ts', 'functions/test/**/*.ts', 'firebase/rules-tests/**/*.ts'];
+/** Playwright specs, fixtures and config (the @hcm/e2e workspace). */
+const E2E = ['e2e/**/*.ts'];
 const NODE_TOOLING = ['*.config.ts', 'packages/*/vite.config.ts', 'eslint.config.js', '.dependency-cruiser.cjs'];
@@
+/**
+ * Tests may be longer than product code, never more complex: a test file holds one behaviour's happy and bad rows
+ * with their fixtures (600 lines), a test reads top to bottom as arrange / act / assert without helper indirection
+ * (120 lines per function), and the fixtures Vitest and Playwright inject arrive as parameters (8).
+ */
+const TEST_LIMITS = {
+    'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
+    'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
+    'max-params': ['error', 8],
+};
@@
         rules: {
             'vitest/no-focused-tests': 'error',
             'vitest/no-disabled-tests': 'error',
             'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expect.element'] }],
-            'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
-            'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
-            'max-params': ['error', 8],
+            ...TEST_LIMITS,
         },
     },
+    {
+        // The e2e suite must stay deterministic (design-review-testability.md §2): no sleeps, no focused or
+        // skipped tests, no networkidle waits, no forced clicks, web-first assertions only.
+        files: E2E,
+        extends: [playwright.configs['flat/recommended']],
+        languageOptions: { globals: globals.node },
+        rules: {
+            'playwright/no-wait-for-timeout': 'error',
+            'playwright/no-focused-test': 'error',
+            'playwright/no-skipped-test': ['error', { allowConditional: false }],
+            'playwright/no-networkidle': 'error',
+            'playwright/no-force-option': 'error',
+            'playwright/prefer-web-first-assertions': 'error',
+            ...TEST_LIMITS,
+        },
+    },
```

Verify: `PIPELINE_STAGE=static` (eslint and knip: the new devDependency is used by the config) and `e2e`.

## 3. `.dependency-cruiser.cjs`: keep the Firebase SDK out of the public viewer; scan `e2e/` and the rules tests

`AGENTS.md`: the public viewer never reads Firestore and loads no Firebase SDK for data; Addendum 2 of `PLAN.md`
allows only the consent-gated GA4 and Performance Monitoring. No rule enforces either today. With
`doNotFollow: node_modules`, only the first hop into `node_modules` is checked, which is exactly the import the
engine writes.

```diff
         {
             name: 'only-the-map-adapter-imports-mapbox',
@@
             to: { path: 'node_modules/mapbox-gl/' },
         },
+        {
+            name: 'engine-firebase-only-in-telemetry',
+            severity: 'error',
+            comment: 'The public viewer loads no Firebase SDK, except the consent-gated telemetry (PLAN.md Addendum 2).',
+            from: { path: '^packages/engine/', pathNot: '^packages/engine/src/telemetry/' },
+            to: { path: 'node_modules/(firebase|@firebase)/' },
+        },
+        {
+            name: 'engine-telemetry-only-app-analytics-performance',
+            severity: 'error',
+            comment: 'Telemetry may load firebase/app, firebase/analytics and firebase/performance, nothing else.',
+            from: { path: '^packages/engine/src/telemetry/' },
+            to: { path: 'node_modules/(firebase|@firebase)/', pathNot: 'node_modules/firebase/(app|analytics|performance)/' },
+        },
+        {
+            name: 'no-firebase-data-sdk-in-public-code',
+            severity: 'error',
+            comment: 'engine and shared (bundled into the viewer) never load Firestore, Auth, Storage or Realtime Database.',
+            from: { path: '^packages/(engine|shared)/' },
+            to: { path: 'node_modules/(firebase/(firestore|auth|storage|database)|@firebase/(firestore|auth|storage|database))' },
+        },
     ],
```

And in the root `package.json` (not ask-first itself, but it belongs with this decision), scan the e2e and
rules-test workspaces too, so cycles and unresolvable imports are caught there:

```diff
-        "lint:deps": "depcruise packages functions --config .dependency-cruiser.cjs",
+        "lint:deps": "depcruise packages functions e2e firebase/rules-tests --config .dependency-cruiser.cjs",
```

Checked on 2026-10-12 in the quality image: `npx depcruise packages functions e2e firebase/rules-tests --config
.dependency-cruiser.cjs` reports no violation (82 modules, 122 dependencies). Not applied yet because a root
`package.json` change invalidates the image's npm layer (Playwright browsers and emulator JARs are downloaded again):
batch it with the next dependency bump (`dependency-cruiser` 18.6.0 is already out, see §10f).

Verify: `PIPELINE_STAGE=static` (`dependency-cruiser`), plus a throwaway import of `firebase/firestore` in an engine
file, which must fail.

## 4. Workflow hardening (`.github/workflows/`)

### 4a. `ci.yml` `deploy-firebase`: install before authenticating

`npm ci` runs the install scripts of about 1,200 packages after the Workload Identity step has written a
short-lived credentials file into the mounted workspace and exported `GOOGLE_APPLICATION_CREDENTIALS`. Install
first, authenticate last:

```diff
             - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
               with:
                   persist-credentials: false

-            - name: Authenticate to Google Cloud (Workload Identity Federation)
-              uses: google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093 # v3.0.0
-              with:
-                  workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}
-                  service_account: ${{ vars.GCP_DEPLOY_SA }}
-
             - uses: ./.github/actions/quality-image

             - name: Load the quality image
               env:
                   HCM_DOCKER_BUILD_FLAGS: ${{ env.LOAD_IMAGE }}
               run: bash scripts/ci/build-and-test.sh

+            # Every install script runs BEFORE the credentials exist: none of them can read the token file.
+            - name: Install dependencies (no credentials yet)
+              run: >-
+                  docker run --rm --user "$(id -u):$(id -g)" --env HOME=/tmp
+                  --volume "$PWD:$PWD" --workdir "$PWD" "$HCM_IMAGE"
+                  npm ci --prefer-offline --no-audit --no-fund
+
+            - name: Authenticate to Google Cloud (Workload Identity Federation)
+              uses: google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093 # v3.0.0
+              with:
+                  workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}
+                  service_account: ${{ vars.GCP_DEPLOY_SA }}
+
             # firebase-tools is pinned in package.json and runs in the image; the short-lived
             # credentials file of the auth step lives in the workspace, mounted at the same path.
             - name: firebase deploy
@@
                   in_image=(docker run --rm --user "$(id -u):$(id -g)" --env HOME=/tmp --env GOOGLE_APPLICATION_CREDENTIALS
                       --volume "$PWD:$PWD" --workdir "$PWD" "$HCM_IMAGE")
-                  "${in_image[@]}" npm ci --prefer-offline --no-audit --no-fund
                   "${in_image[@]}" npx firebase deploy --non-interactive --project "$GCP_PROJECT_ID" \
```

### 4b. `ci.yml` `sonarqube`: check every report the scan reads

The job checks `lcov.info`, `scripts.xml` and `pytest.xml` but not the raster pipeline's `pipeline.xml` and
`junit/pipeline.xml`. `scripts/ci/sonar_report.py --check-reports` (added in §10f) reads the list from
`sonar-project.properties`, the single source, so load the image first and let it decide:

```diff
-            - name: Check the reports are present
-              id: reports
-              if: steps.sonar.outputs.enabled == 'true'
-              run: |
-                  for report in reports/coverage/ts/lcov.info reports/coverage/scripts.xml reports/junit/pytest.xml; do
-                      test -s "$report" || { echo "::error::missing or empty ${report}"; exit 1; }
-                  done
-                  echo "version=$(jq -r .version package.json)" >>"$GITHUB_OUTPUT"
+            - if: steps.sonar.outputs.enabled == 'true'
+              uses: ./.github/actions/quality-image
+
+            - name: Load the quality image
+              if: steps.sonar.outputs.enabled == 'true'
+              env:
+                  HCM_DOCKER_BUILD_FLAGS: ${{ env.LOAD_IMAGE }}
+              run: bash scripts/ci/build-and-test.sh
+
+            # Every coverage and test report named in sonar-project.properties exists and is not empty.
+            - name: Check the reports are present
+              id: reports
+              if: steps.sonar.outputs.enabled == 'true'
+              run: |
+                  docker run --rm --user "$(id -u):$(id -g)" --env HOME=/tmp --volume "$PWD:$PWD" --workdir "$PWD" \
+                      "$HCM_IMAGE" python3 scripts/ci/sonar_report.py --check-reports
+                  echo "version=$(jq -r .version package.json)" >>"$GITHUB_OUTPUT"
@@
-            - if: steps.sonar.outputs.enabled == 'true'
-              uses: ./.github/actions/quality-image
-
-            - name: Load the quality image
-              if: steps.sonar.outputs.enabled == 'true'
-              env:
-                  HCM_DOCKER_BUILD_FLAGS: ${{ env.LOAD_IMAGE }}
-              run: bash scripts/ci/build-and-test.sh
-
             # The repository's release bar on top of the gate: no open issue, no hotspot to review, no
```

Later option (not part of this decision): the job could run `PIPELINE_STAGE=sonar bash
scripts/ci/run-all-checks.sh` itself (pipeline parity) once the container receives the `GITHUB_*` variables the
scanner reads to detect pull-request analyses; today the scan action does that detection.

### 4c. `deps.yml`: open the issue only when something is behind

The `deps` stage now has its gate (`dependency-updates`), so the empty Monday issue is gone. What remains: a
registry outage (exit 2, "not checked" lines) would still open "Dependency updates available". Open or update the
issue only when the log names a pin that is behind (` -> `) or a stale hold (`HELD`); otherwise just fail the run:

```diff
                   echo "status=${status}" >>"$GITHUB_OUTPUT"

+            # Exit 1 (behind, stale hold) and exit 2 (a registry could not be read) both fail the stage;
+            # only real findings belong in the reminder issue.
+            - name: Updates found?
+              id: found
+              if: steps.check.outputs.status != '0'
+              run: |
+                  if grep -Eq '^  - (.* -> |HELD )' deps.log; then
+                      echo "updates=true" >>"$GITHUB_OUTPUT"
+                  else
+                      echo "updates=false" >>"$GITHUB_OUTPUT"
+                  fi
+
             - name: Open or update the reminder issue
-              if: steps.check.outputs.status != '0'
+              if: steps.found.outputs.updates == 'true'
               uses: ./.github/actions/upsert-issue
```

### 4d. `release.yml`: build without write access, publish without running repository code

Today the `release` stage (npm ci, every install script, the build) runs in the job that holds `contents: write`.
Split it: the build job reads, the publish job writes and runs no repository code.

```yaml
jobs:
    build:
        name: Release checks & bundles
        runs-on: ubuntu-24.04
        timeout-minutes: 45
        permissions:
            contents: read
        steps:
            - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
              with:
                  persist-credentials: false

            - uses: ./.github/actions/quality-image

            - name: Release stage
              env:
                  PIPELINE_STAGE: release
                  HCM_DOCKER_BUILD_FLAGS: --load --cache-from type=gha,scope=hcm-quality
              run: bash scripts/ci/run-all-checks.sh

            - name: Upload the release files
              uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
              with:
                  name: release
                  path: |
                      packages/engine/dist/
                      packages/admin/dist/
                      docs/releases/
                  if-no-files-found: error
                  retention-days: 7

    publish:
        name: Publish GitHub Release
        needs: build
        runs-on: ubuntu-24.04
        timeout-minutes: 10
        permissions:
            contents: write
        steps:
            - name: Download the release files
              uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
              with:
                  name: release
                  path: release

            # The single H1 of the description file is the release title (docs/releases/README.md).
            - name: Release title
              id: notes
              env:
                  TAG: ${{ github.ref_name }}
              run: |
                  title="$(sed -n 's/^# //p' "release/docs/releases/${TAG}_github_description.md" | head -n 1)"
                  echo "title=${title:-$TAG}" >>"$GITHUB_OUTPUT"

            - name: GitHub Release
              uses: softprops/action-gh-release@efb35369e0ad2afab669f228072c1b0d510eae64 # v3.0.3
              with:
                  name: ${{ steps.notes.outputs.title }}
                  body_path: release/docs/releases/${{ github.ref_name }}_github_description.md
                  fail_on_unmatched_files: true
                  files: |
                      release/packages/engine/dist/*
                      release/packages/admin/dist/*
```

(upload-artifact keeps the paths below their common ancestor, the repository root, hence the `release/` prefixes.)

### 4e. `ci.yml` `static`: name the commit range for the `commits` gate (optional)

The new `commits` gate reads `COMMIT_RANGE` and falls back to `GITLEAKS_LOG_OPTS`, which this job already exports,
so CI enforces Conventional Commits without this change. For clarity the same step can export both
(`scripts/ci/run-all-checks.sh` already forwards `COMMIT_RANGE`):

```diff
                   echo "GITLEAKS_LOG_OPTS=${range}" >>"$GITHUB_ENV"
+                  echo "COMMIT_RANGE=${range}" >>"$GITHUB_ENV"
```

Verify for all of §4: `PIPELINE_STAGE=static` (actionlint, workflow schemas, `workflow-policy`, `action-pins`),
then one run on GitHub.

## 5. `sonar-project.properties`: analyse `.github/actions` too

The composite actions (`quality-image`, `upsert-issue`) hold shell and GitHub Actions code like the workflows, which
are already in `sonar.sources`:

```diff
     docker,\
-    .github/workflows
+    .github/workflows,\
+    .github/actions
```

Verify: `PIPELINE_STAGE=tests` (the `coverage` gate reads the same scope; YAML has no coverage, so it stays green)
and the next Sonar analysis.

## 6. gitleaks: the pushed false positive in `14d4d7b`, and the header of `.gitleaks.toml`

### 6a. `.gitleaksignore` (new file) for exactly one finding

Commit `14d4d7b` (already on `origin/feat/engine-rewrite`) holds the multi-line `curl-auth-user` false positive of
`docs/research/quality-conventions.md` that a later commit reworded (§7 of the hand-off). A pull request whose range
includes it fails `gitleaks-history`. The fingerprint, computed with gitleaks 8.30.1 in `hcm-quality:local`
(`gitleaks git --log-opts="origin/master..HEAD"`, the only finding of the branch), names that commit, file, rule and
line only, so nothing else is tolerated:

```text
# Commit 14d4d7b (already pushed): the multi-line curl-auth-user false positive in
# docs/research/quality-conventions.md, reworded later (docs/research/M0-handoff.md §7, §10e).
14d4d7b4a397704bc4488f09f29f1811a9983b77:docs/research/quality-conventions.md:curl-auth-user:520
```

gitleaks reads `.gitleaksignore` from the scanned directory by itself (no flag needed). Checked on 2026-10-12: with
this file, `gitleaks git --log-opts="origin/master..HEAD"` reports no leak, and `gitleaks dir` (the `gitleaks` gate,
whose fingerprints have no commit part) is unaffected. The alternative is squashing the branch before the pull request
(a force-push of `feat/engine-rewrite`, also ask first).

### 6b. `.gitleaks.toml`: say what the path allowlist really does

The header says "nothing tracked by git is exempted", but the allowlist also hides `.sonar-token` and `.env.local`
in history mode, tracked or not. The `repo-policy` gate and the pre-commit hook refuse those files in git's view, so
nothing is lost today; the wording should still be true:

```diff
-# and the pipeline's own reports/. This allowlist is about scan SCOPE, not about tolerating a finding:
-# nothing tracked by git is exempted, and a real secret committed to this repository is still reported.
+# and the pipeline's own reports/. This allowlist is about scan SCOPE, not about tolerating a finding.
+# Two entries name the developer's local secret files (.sonar-token, .env.local) so the directory scan does
+# not report them; they would be hidden in history mode too, which is why the repo-policy gate and the
+# pre-commit hook refuse both files in git's view. Every other tracked path is scanned.
```

Stricter option: give `gitleaks-history` its own config without the two secret-file entries (a second
`.gitleaks-history.toml`, `--config` changed in `GITLEAKS_HISTORY` in `scripts/ci/pipeline.py`).

Verify: `PIPELINE_STAGE=static` (`gitleaks`, `gitleaks-history` with `GITLEAKS_LOG_OPTS=origin/master..HEAD`).

## 7. `ruff.toml`: GDAL's CamelCase names in the stubs

`pipeline/typings/osgeo/*.pyi` declares GDAL's CamelCase API as typed callable attributes, because ruff N802/N803
reject a CamelCase `def` and `ruff.toml` is ask-first. A per-file ignore limited to the stubs allows ordinary `def`
stubs (a follow-up rewrites them):

```diff
 "**/tests/**/*.py" = ["S101", "S105", "S106", "S108", "S607", "PLR2004"]
+# GDAL's Python API is CamelCase (gdal.Open, Dataset.GetGeoTransform); its stubs must spell it as GDAL does.
+"pipeline/typings/**/*.pyi" = ["N802", "N803"]
```

Verify: `PIPELINE_STAGE=static` (`ruff-check`, `pipeline-mypy`).

## 8. `pytest.ini`: the `editorconfig` deprecation filter (keep)

The CI tooling's pytest turns every warning into an error, except one line that tolerates the `codecs.open()`
deprecation warning `editorconfig` 0.17.1 (the latest release) raises on Python 3.14. The filter names the message,
the category and the module, so no other warning slips through. Recommendation: keep it, and delete it when an
`editorconfig` release reads files with `open()` (the weekly `deps` stage reports the new version). The alternative,
replacing the library with an own `.editorconfig` parser in `scripts/ci/check_editorconfig.py`, is more code to
maintain for no gain.

## 9. `vitest.config.ts`: an `engine-browser` project and a `tools` project (M1 change request CR-2)

Added on 2026-10-12 by the M1 contracts agent (`docs/research/M1-interfaces.md` → *Change requests*). Two test
environments M1 needs do not exist yet:

- **`engine-browser`**: the Mapbox adapter runs against the real `mapbox-gl@3.32.0` under SwiftShader and the viewer's
  Lit elements need a real DOM (`design-review-testability.md` §3.2, §3.3); today the engine project is node-only.
- **`tools`**: the JavaScript CLIs (`scripts/seed/migrate-legacy.mjs`, `packages/ui/scripts/gen-theme.mjs`) are tested
  as child processes. The ui project runs in Chromium (it cannot start a process), so both CLI test files sit in the
  shared node project today (`packages/shared/test/cli/`), which works but is the wrong home.

```diff
     {
         dir: 'packages/engine',
-        project: { extends: true, test: { name: 'engine', environment: 'node', include: ['packages/engine/test/**/*.test.ts'] } },
+        project: {
+            extends: true,
+            test: { name: 'engine', environment: 'node', include: ['packages/engine/test/**/*.test.ts'], exclude: ['packages/engine/test/browser/**'] },
+        },
         coverage: ['packages/engine/src/**/*.ts'],
     },
+    {
+        // The Mapbox adapter (real mapbox-gl under SwiftShader) and the Lit viewer elements need a browser; same coverage scope.
+        dir: 'packages/engine',
+        project: { extends: true, test: { name: 'engine-browser', include: ['packages/engine/test/browser/**/*.test.ts'], browser: chromium } },
+        coverage: [],
+    },
+    {
+        // JavaScript CLIs, driven as child processes; their logic is TypeScript measured in its own package.
+        dir: '.',
+        project: { extends: true, test: { name: 'tools', environment: 'node', include: ['scripts/*/test/**/*.test.ts', 'packages/*/scripts/test/**/*.test.ts'] } },
+        coverage: [],
+    },
```

Follow-ups in the same change: move `packages/shared/test/cli/migrate-legacy.test.ts` to `scripts/seed/test/` and
`packages/shared/test/cli/gen-theme.test.ts` to `packages/ui/scripts/test/`, give both folders a `tsconfig.json` in the
root solution, and add their globs to `TESTS` in `eslint.config.js` (also ask-first). Nothing is excluded from coverage.

Verify: `PIPELINE_STAGE=tests` (the `vitest` gate lists the new project names) and `static` (`tsc`, `eslint`, `knip`).

## 10. The legacy migration writes new files under `seed/bucharest/` (for visibility)

Added on 2026-10-12 by the M1 contracts agent. `seed/bucharest/` is ask-first for changes to the legacy originals,
and none were changed: `photos.legacy.geojson`, `photos/` and `thumbnails/` are only read. The planned M1 migration
step (`PLAN.md` → M1, "migrated photos/cones via a static manifest") wrote two new outputs next to them with
`scripts/seed/migrate-legacy.mjs`:

- `seed/bucharest/manifest.static.json` (50 KB): the City Manifest v1 of Bucharest, schema-validated, 45 photos;
- `seed/bucharest/derived/<id>/{web,thumb}.webp`: 90 WebP files, 9.52 MB in total, EXIF and ICC stripped.

Decision for the user: commit the derivatives (the M1 static site and the e2e tier read them; `seed/` is outside the
repository budget, and M2 moves the photos to Cloud Storage), or keep them out of git and let the site build run the
migration (it needs sharp and about 20 s in the quality image). The manifest is small and should be committed either
way. Re-running the migration rewrites both outputs from the originals.

Verify: `npm run seed:migrate` in the quality image ends with `manifest written { photos: 45, cones: 34, ... }`.

## 11. Orchestrator decisions taken overnight (2026-10-12), for review

| Item | Decision | Why | Reverse how |
| --- | --- | --- | --- |
| `seed/bucharest/derived/` (90 WebP, 9.5 MB) | Committed | Deterministic migration output; the static site and the e2e fixtures need it; `check_repo_budget.py` excludes `seed/` | `git rm -r seed/bucharest/derived` and regenerate it at build time with `scripts/seed/migrate-legacy.mjs` |
| CR-2 (`vitest.config.ts` `engine-browser` project) pending | Workaround: every Lit component, viewer-specific ones included, lives in `packages/ui` (browser project); `packages/engine` stays DOM-free logic plus a dependency-injected `mount()` tested in Node | No ask-first edit while the user is away; no gate weakened | Once §9 is approved, viewer components may move to `packages/engine/src/ui/` |
