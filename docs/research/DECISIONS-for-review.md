# Decisions for review

Proposals for edits that `AGENTS.md` lists under *Ask first* (lint and tool configs, `.github/workflows/`,
`.gitleaks.toml`, `.claude/settings.json`), so no agent applied them. Each section is one decision: the exact
change, why, and how to verify it. Approve or reject them one by one; an approved section is applied in its own
change, followed by the stage named under *Verify*. Nothing here weakens a gate: every proposal either adds a
check or narrows a scope to exactly the false positive it names.

Opened on 2026-10-12 by the agent that closed the M0 review leftovers (`docs/research/M0-handoff.md` §10f), from
the findings of §10d and §10e.

Addendum (2026-10-12, after the review): the user approved §1 to §25 as a whole, relayed to the applying agent by the
orchestrator. Each heading now says `APPLIED 2026-10-12 (user approved)` or `NOT APPLIED: <reason>`; §26 records how
they were applied, where a later section superseded an earlier one, where the stricter of two readings was taken, and
why seven were not applied. §27 is a new proposal that waits for the user's own answer.

## 1. `.htmlvalidate.json`: extend `html-validate:prettier` — APPLIED 2026-10-12 (user approved)

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

## 2. `eslint.config.js`: Playwright rules for `e2e/`, why-comments for the test limits — APPLIED 2026-10-12 (user approved; stricter variant, §26)

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

## 3. `.dependency-cruiser.cjs`: keep the Firebase SDK out of the public viewer; scan `e2e/` and the rules tests — APPLIED 2026-10-12 (user approved; stricter variant, §26)

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

## 4. Workflow hardening (`.github/workflows/`) — APPLIED 2026-10-12 (user approved): 4a to 4e

### 4a. `ci.yml` `deploy-firebase`: install before authenticating — APPLIED 2026-10-12 (user approved)

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

### 4b. `ci.yml` `sonarqube`: check every report the scan reads — APPLIED 2026-10-12 (user approved)

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

### 4c. `deps.yml`: open the issue only when something is behind — APPLIED 2026-10-12 (user approved)

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

### 4d. `release.yml`: build without write access, publish without running repository code — APPLIED 2026-10-12 (user approved)

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

### 4e. `ci.yml` `static`: name the commit range for the `commits` gate (optional) — APPLIED 2026-10-12 (user approved)

The new `commits` gate reads `COMMIT_RANGE` and falls back to `GITLEAKS_LOG_OPTS`, which this job already exports,
so CI enforces Conventional Commits without this change. For clarity the same step can export both
(`scripts/ci/run-all-checks.sh` already forwards `COMMIT_RANGE`):

```diff
                   echo "GITLEAKS_LOG_OPTS=${range}" >>"$GITHUB_ENV"
+                  echo "COMMIT_RANGE=${range}" >>"$GITHUB_ENV"
```

Verify for all of §4: `PIPELINE_STAGE=static` (actionlint, workflow schemas, `workflow-policy`, `action-pins`),
then one run on GitHub.

## 5. `sonar-project.properties`: analyse `.github/actions` too — APPLIED 2026-10-12 (user approved)

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

## 6. gitleaks: the pushed false positive in `14d4d7b`, and the header of `.gitleaks.toml` — APPLIED 2026-10-12 (user approved): 6a, 6b and its stricter option

### 6a. `.gitleaksignore` (new file) for exactly one finding — APPLIED 2026-10-12 (user approved)

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

### 6b. `.gitleaks.toml`: say what the path allowlist really does — APPLIED 2026-10-12 (user approved; stricter variant, §26)

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

## 7. `ruff.toml`: GDAL's CamelCase names in the stubs — APPLIED 2026-10-12 (user approved; stricter variant, §26)

`pipeline/typings/osgeo/*.pyi` declares GDAL's CamelCase API as typed callable attributes, because ruff N802/N803
reject a CamelCase `def` and `ruff.toml` is ask-first. A per-file ignore limited to the stubs allows ordinary `def`
stubs (a follow-up rewrites them):

```diff
 "**/tests/**/*.py" = ["S101", "S105", "S106", "S108", "S607", "PLR2004"]
+# GDAL's Python API is CamelCase (gdal.Open, Dataset.GetGeoTransform); its stubs must spell it as GDAL does.
+"pipeline/typings/**/*.pyi" = ["N802", "N803"]
```

Verify: `PIPELINE_STAGE=static` (`ruff-check`, `pipeline-mypy`).

## 8. `pytest.ini`: the `editorconfig` deprecation filter (keep) — APPLIED 2026-10-12 (user approved): kept, no change

The CI tooling's pytest turns every warning into an error, except one line that tolerates the `codecs.open()`
deprecation warning `editorconfig` 0.17.1 (the latest release) raises on Python 3.14. The filter names the message,
the category and the module, so no other warning slips through. Recommendation: keep it, and delete it when an
`editorconfig` release reads files with `open()` (the weekly `deps` stage reports the new version). The alternative,
replacing the library with an own `.editorconfig` parser in `scripts/ci/check_editorconfig.py`, is more code to
maintain for no gain.

## 9. `vitest.config.ts`: an `engine-browser` project and a `tools` project (M1 change request CR-2) — APPLIED 2026-10-12 (user approved)

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

## 10. The legacy migration writes new files under `seed/bucharest/` (for visibility) — APPLIED 2026-10-12 (user approved): committed (§11)

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

## 11. Orchestrator decisions taken overnight (2026-10-12), for review — APPLIED 2026-10-12 (user approved): confirmed

| Item | Decision | Why | Reverse how |
| --- | --- | --- | --- |
| `seed/bucharest/derived/` (90 WebP, 9.5 MB) | Committed | Deterministic migration output; the static site and the e2e fixtures need it; `check_repo_budget.py` excludes `seed/` | `git rm -r seed/bucharest/derived` and regenerate it at build time with `scripts/seed/migrate-legacy.mjs` |
| CR-2 (`vitest.config.ts` `engine-browser` project) pending | Workaround: every Lit component, viewer-specific ones included, lives in `packages/ui` (browser project); `packages/engine` stays DOM-free logic plus a dependency-injected `mount()` tested in Node | No ask-first edit while the user is away; no gate weakened | Once §9 is approved, viewer components may move to `packages/engine/src/ui/` |

## 12. M1 e2e infrastructure and the static sites (e2e-infra, 2026-10-12) — APPLIED 2026-10-12 (user approved) except where its subsections say otherwise

Added by the M1 e2e-infra workstream. The sites (`sites/bucharest/`, `starter-kit/`), their build (`scripts/site/`) and
the Playwright tiers with their mock APIs (`e2e/`) work without any of the edits below; each one folds a workaround back
into the repository-wide configuration. None weakens a gate.

### 12a. `vitest.config.ts` and `sonar-project.properties`: the site build's tests join the `tools` project — APPLIED 2026-10-12 (user approved)

The site build's unit tests run today from their own configuration, `scripts/site/vitest.config.ts` (gate `site-unit`,
`npm run test:site`, 90 % per file on all four metrics, reports `reports/junit/site.xml` and `reports/coverage/site/`),
because the root configuration is ask-first and has no project for the Node tooling under `scripts/`. Neither SonarQube
nor the `coverage` gate sees `scripts/site` yet. With §9 approved, the `tools` row measures it too:

```diff
     {
         // JavaScript CLIs, driven as child processes; their logic is TypeScript measured in its own package.
         dir: '.',
         project: { extends: true, test: { name: 'tools', environment: 'node', include: ['scripts/*/test/**/*.test.ts', 'packages/*/scripts/test/**/*.test.ts'] } },
-        coverage: [],
+        // The static site build (scripts/site/src) is product code: it writes the page, its CSP and the served manifest.
+        coverage: ['scripts/site/src/**/*.ts'],
     },
```

```diff
 sonar.sources=packages/shared/src,\
@@
     scripts/ci,\
+    scripts/site/src,\
     scripts/git-hooks,\
@@
 sonar.tests=packages/shared/test,\
@@
     scripts/ci/tests,\
+    scripts/site/test,\
     e2e
```

Follow-ups in the same change: delete `scripts/site/vitest.config.ts`, the `test:site` script and the `site-unit` gate
(with its row in `scripts/ci/tests/test_pipeline.py` and the stage tables), and add `scripts/site/test/**/*.ts` to `TESTS`
in `eslint.config.js` (§12b).

Verify: `PIPELINE_STAGE=tests` (`vitest` lists `tools`; `coverage` measures `scripts/site/src/*.ts` at 100 %).

### 12b. `eslint.config.js`: the product limits for the site build, the test rules for its tests, browser globals for `config.js` — APPLIED 2026-10-12 (user approved; stricter variant, §26)

`scripts/site/src/**` and the e2e servers are linted with the type-checked rule sets but none of `PRODUCT_LIMITS`
(complexity 5, 400 lines, 60 per function) or the Vitest rules; they were written within those limits by hand. A city's
`config.js` has no browser globals, so it writes `globalThis.HistoricCityMapConfig` (the same object as
`window.HistoricCityMapConfig` in a classic script) instead of the form `docs/ENGINE_API.md` shows.

```diff
-const PRODUCT = ['packages/*/src/**/*.ts', 'functions/src/**/*.ts'];
-const TESTS = ['packages/*/test/**/*.ts', 'packages/test-support/src/**/*.ts', 'functions/test/**/*.ts', 'firebase/rules-tests/**/*.ts'];
+const PRODUCT = ['packages/*/src/**/*.ts', 'functions/src/**/*.ts', 'scripts/site/src/**/*.ts', 'scripts/site/build-site.ts'];
+const TESTS = [
+    'packages/*/test/**/*.ts',
+    'packages/test-support/src/**/*.ts',
+    'functions/test/**/*.ts',
+    'firebase/rules-tests/**/*.ts',
+    'scripts/site/test/**/*.ts',
+];
@@
+    {
+        // A city's config.js is a classic script that assigns window.HistoricCityMapConfig (docs/ENGINE_API.md).
+        files: ['sites/*/config.js', 'starter-kit/config.js'],
+        languageOptions: { sourceType: 'script', globals: globals.browser },
+    },
```

`PRODUCT` also brings the browser globals to the site build, which is Node code; it only uses imported Node modules, so
nothing changes in practice. Then `sites/bucharest/config.js` and `starter-kit/config.js` may say `window.` again
(`scripts/site/src/config-js.ts` accepts both).

Verify: `PIPELINE_STAGE=static` (`eslint`).

### 12c. `.github/workflows/ci.yml`: deploy the built site, the public token, e2e tiers in the matrix — APPLIED 2026-10-12 (user approved; variant, §26)

- The Pages artifact path `sites/bucharest/dist` is a placeholder from M0; the site build writes `dist/site/bucharest`.
- The site build reads the URL-restricted public Mapbox token from `MAPBOX_PUBLIC_TOKEN` (forwarded by
  `run-all-checks.sh`). A `pk.` token restricted to `https://ventura8.github.io` is public by design (it is in the served
  manifest), so a repository variable fits; without it the build uses the e2e placeholder and says so.
- `E2E_TIER` is forwarded too: the tour tier (44 projects) is worth its own shards once its specs exist.

```diff
             - name: Build stage
               env:
                   PIPELINE_STAGE: build
+                  MAPBOX_PUBLIC_TOKEN: ${{ vars.MAPBOX_PUBLIC_TOKEN }}
                   HCM_DOCKER_BUILD_FLAGS: ${{ env.LOAD_IMAGE }}
               run: bash scripts/ci/run-all-checks.sh
@@
-            # The Bucharest site (M1/M2: sites/bucharest) is what GitHub Pages serves.
+            # The Bucharest site, built by the site-build gate (scripts/site), is what GitHub Pages serves.
             - name: Upload the GitHub Pages artifact
               if: github.event_name == 'push' && github.ref == 'refs/heads/master' && vars.DEPLOY_ENABLED == 'true'
               uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0
               with:
-                  path: sites/bucharest/dist
+                  path: dist/site/bucharest
@@
     e2e:
-        name: E2E (Playwright + Firebase Emulators) ${{ matrix.shard }}
+        name: E2E (Playwright, ${{ matrix.tier }}) ${{ matrix.shard }}
@@
             matrix:
-                # Shards as "index/total" (Playwright --shard). Grow the list and the total together.
-                shard: ['1/1']
+                # Tiers of e2e/projects.ts; shards as "index/total" (Playwright --shard) within a tier.
+                include:
+                    - { tier: 'smoke,fn,a11y,nogl', shard: '1/1' }
+                    - { tier: tour, shard: '1/2' }
+                    - { tier: tour, shard: '2/2' }
@@
                   PIPELINE_STAGE: e2e
+                  E2E_TIER: ${{ matrix.tier }}
                   E2E_SHARD: ${{ matrix.shard }}
@@
-                  check_name: E2E Test Report (${{ matrix.shard }})
+                  check_name: E2E Test Report (${{ matrix.tier }} ${{ matrix.shard }})
```

The comment in `.github/actions/quality-image/action.yml` that lists the forwarded variables then names `E2E_TIER` and
`MAPBOX_PUBLIC_TOKEN` too.

Verify: `PIPELINE_STAGE=static` (actionlint, workflow schemas, `workflow-policy`), then one run on GitHub.

### 12d. `.htmlvalidate.json` (§1, change request CR-3): still wanted, for other pages — APPLIED 2026-10-12 (user approved): the pages stay generated (§26)

The site pages stay generated after §1 is approved: their meta CSP comes from the site's manifest and configuration and
their Subresource Integrity from the pinned `mapbox-gl` package, so a committed copy would drift. §1 is still needed for
the admin's entry page (M2) and for the starter kit's committed `index.html` in the template repository (M5). The
generated pages are checked against `.htmlvalidate.json` itself (`scripts/site/test/page.test.ts`), so they keep passing
whatever the gate's configuration becomes.

### 12e. `package.json` `lint:deps`: also cruise the site build — APPLIED 2026-10-12 (user approved)

Together with §3 (which adds `e2e` and `firebase/rules-tests`), add `scripts/site`, so the site build is checked for
cycles and imports that do not resolve:

```diff
-        "lint:deps": "depcruise packages functions --config .dependency-cruiser.cjs",
+        "lint:deps": "depcruise packages functions e2e firebase/rules-tests scripts/site --config .dependency-cruiser.cjs",
```

Verify: `PIPELINE_STAGE=static` (`dependency-cruiser`).

### 12f. `contract` stage: the CDN serves the bytes the page's integrity names — APPLIED 2026-10-12 (user approved)

The page pins `https://api.mapbox.com/mapbox-gl-js/v3.32.0/mapbox-gl.{js,css}` with a `sha384` digest computed from the
npm release `mapbox-gl@3.32.0` (`scripts/site/src/sri.ts`). Mapbox publishes both from one build, but that the CDN bytes
are identical is **unverified**: if they differed, browsers would refuse the script and the site would show nothing. The
first deploy shows it at once; a weekly check in `scripts/ci/check_contracts.py` would keep it true (fetch both files,
compare their digests with the npm files' digests). Not added here: the `contract` stage and its script belong to the CI
tooling, and the check needs the network.

## 13. M1 engine core (engine-core, 2026-10-12) — APPLIED 2026-10-12 (user approved) except 13b

Added by the engine-core workstream (`packages/engine/src/{core,map,telemetry,config}/`,
`packages/test-support/src/fake-map.ts`). Its change requests are CR-8 to CR-11 in `M1-interfaces.md`.

### 13a. `packages/engine/vite.config.ts`: the Firebase SDK in the IIFE build (CR-10) — APPLIED 2026-10-12 (user approved): option 1, no change

The analytics SDK (firebase/app, firebase/analytics, firebase/performance) is behind one dynamic import,
`packages/engine/src/telemetry/firebase-sdk.ts`. It runs only after consent and only with a `measurementId`. Measured in
the quality image on 2026-10-12 with a throwaway library build of `telemetry.ts`:

| Build | What the SDK costs |
| --- | --- |
| ES module (`engine.mjs`) | a separate chunk `firebase-sdk-<hash>.js`, 83.6 KB raw, 23.9 KB gzip, fetched only after consent; telemetry itself is 2.8 KB gzip |
| IIFE (`engine.iife.js`) | inlined: Vite builds IIFE output with `codeSplitting: false`, so the same 24 KB gzip is downloaded with the engine (not evaluated before consent, and served from the city's own origin, so no Google host is contacted) |

The bundle budgets are 125 KB gzip for `engine.iife.js` and 110 KB for `engine.mjs` (`scripts/ci/check_bundle_budget.py`;
the IIFE had 150 KB and the ES module build none when this section was written). Options:

1. **Keep the configuration** (recommended for M1). The city pages load `engine.mjs` (CR-6, which the generated Bucharest
   page already does), so visitors get the lazy chunk. The IIFE stays a fallback for third-party pages and carries the
   SDK. The site build and the release must ship every file of `packages/engine/dist/`, the chunk included.
2. **Drop the IIFE format in v1.** `docs/ENGINE_API.md` documents the IIFE and `window.HistoricCityMap`, so this is a
   contract change that contracts and the integrator decide.
3. **A second build pass for the IIFE** that loads the ES chunk at run time from `engineBase`. This needs a deterministic
   chunk name in the ES build and a format flag that the telemetry loader reads:

```diff
         rolldownOptions: {
             external: ['mapbox-gl'],
             output: {
                 globals: { 'mapbox-gl': 'mapboxgl' },
+                // The lazy analytics chunk keeps a fixed name, so the IIFE build can load it from `engineBase`.
+                chunkFileNames: '[name].mjs',
             },
         },
```

   The second half of option 3 (a `define` per format, which needs two `vite build` runs, and a loader that calls
   `import(new URL('firebase-sdk.mjs', engineBase).href)` in the IIFE) touches `vite.config.ts`, the build script and
   the CSP. Choose it only if the IIFE remains a first-class embed.

Verify: `PIPELINE_STAGE=build`. Both `vite-build` and `bundle-budget` must pass. `packages/engine/dist/` must list the
chunk next to `engine.mjs`.

### 13b. CR-2 follow-up: the adapter against the real `mapbox-gl@3.32.0` — NOT APPLIED: superseded by the e2e tier (§26)

The adapter does not import `mapbox-gl`. It takes the global through the structural type `MapboxGl`
(`packages/engine/src/map/mapbox-types.ts`), and its node tests drive `FakeMapboxGl` from `@hcm/test-support`. Once the
`engine-browser` project of §9 exists:

- add `mapbox-gl@3.32.0` as a devDependency of `@hcm/engine` (the e2e workspace already pins it);
- add a browser test that checks `mapboxgl satisfies MapboxGl` at the type level, and that mounts `createMapboxPort` on
  the real library with a local style that has a `basemap` import and slots. The test then checks `getSlot`,
  `getPaintProperty('raster-opacity')`, `getConfigProperty('basemap', 'show3dObjects')` and one canvas pixel probe.
  This is `design-review-testability.md` §3.2.

Until then, what has not been checked against the real library: the names of the paint, layout and configuration
properties, and the fact that Mapbox GL JS 3.32 reads a `.pmtiles` source URL natively.

Verify: `PIPELINE_STAGE=tests`.

### 13c. `.dependency-cruiser.cjs` §3: engine core already complies — APPLIED 2026-10-12 (user approved)

Only two engine files reach Firebase. `packages/engine/src/telemetry/analytics.ts` imports types from firebase/app,
firebase/analytics and firebase/performance. `packages/engine/src/telemetry/firebase-sdk.ts` imports the functions. No
data SDK is imported. With §3 applied, `engine-firebase-only-in-telemetry` and
`engine-telemetry-only-app-analytics-performance` pass as they are. Firebase 13.0.0 is now a runtime dependency of
`@hcm/engine`, at the version the rules tests already locked (`package-lock.json`: only the dev flags of the firebase tree
changed). This changes a workspace `package.json`, so the next image build reinstalls npm (M0-handoff §3).

### 13d. Information for the viewer page's CSP (e2e-infra, `scripts/site/`) — APPLIED 2026-10-12 (user approved): information

The consent-gated SDKs need these hosts. The meta CSP is static, so they are listed even though nothing is contacted
before consent (scenario V19 proves that with the firewall):

- `script-src https://www.googletagmanager.com`;
- `connect-src https://*.google-analytics.com https://*.analytics.google.com https://firebaseinstallations.googleapis.com
  https://firebaselogging-pa.googleapis.com https://firebaseremoteconfig.googleapis.com`;
- the origin of `analytics.errorEndpoint` (the M2 `telemetry.reportError` function).

The crash reports are POSTed as `text/plain` without credentials, so they need no CORS preflight.

The compare plugin loads from `https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-compare/v0.6.0/`, which the
existing `https://api.mapbox.com/mapbox-gl-js/` source already covers. Setting `script.src` is a Trusted Types sink, so
the report-only `require-trusted-types-for 'script'` policy will report it. A Trusted Types policy for that one constant
URL is the fix, once the policy is enforced.

## 14. `vitest.config.ts`: pre-bundle the browser tests' dependencies (ui-kit, 2026-10-12) — APPLIED 2026-10-12 (user approved; stricter variant, §26)

Added by the M1 ui-kit workstream (`docs/research/M1-interfaces.md` CR-16). On a cold Vite cache (`npm ci` deletes
`node_modules/.vite`, so every CI run is cold) the `ui` browser project discovers dependencies while the tests import
them (`lit/directives/style-map.js`, `lit/directives/repeat.js`, `lit/directives/keyed.js`, `axe-core`), re-optimises
and reloads the page mid-run. Seen locally on 2026-10-12: "Vite unexpectedly reloaded a test", "Failed to fetch
dynamically imported module", "The iframe … did not become ready within 60000ms" and "Multiple versions of Lit loaded"
(there is one Lit in `node_modules`; the reload created a second pre-bundle). A second run on the warm cache passed. Vite
suggests exactly this fix: list the dependencies so they are pre-bundled before the first test.

```diff
     {
         dir: 'packages/ui',
-        project: { extends: true, test: { name: 'ui', include: ['packages/ui/test/**/*.test.ts'], browser: chromium } },
+        project: {
+            extends: true,
+            // Pre-bundle what the browser tests import, so a cold cache (every CI run) never re-optimises and reloads a test.
+            optimizeDeps: {
+                include: [
+                    'lit',
+                    'lit/directives/keyed.js',
+                    'lit/directives/repeat.js',
+                    'lit/directives/style-map.js',
+                    'zod',
+                    '@material/material-color-utilities',
+                    '@hcm/test-support > axe-core',
+                ],
+            },
+            test: { name: 'ui', include: ['packages/ui/test/**/*.test.ts'], browser: chromium },
+        },
         coverage: ['packages/ui/src/**/*.ts'],
     },
```

`@hcm/test-support > axe-core` is Vite's nested-dependency syntax: `@hcm/test-support` pins `axe-core@4.14.0`, while the
root `axe-core` is the 4.13 line that `@axe-core/playwright` brings. A new Lit directive or browser-test dependency joins
the list in the same change. Verify: delete `node_modules/.vite`, then `PIPELINE_STAGE=tests` (no reload warning in
the `vitest` gate's output).

## 15. M1 integration (integrator, 2026-10-12) — APPLIED 2026-10-12 (user approved) except 15c

Added by the M1 integrator (`docs/research/M1-interfaces.md` §12). Each item is an ask-first file; the tree works and
every gate passes without it.

### 15a. `eslint.config.js`: ban Lit's `styleMap` in product code — APPLIED 2026-10-12 (user approved)

The viewer smoke found three kit elements (slider, progress, overlay swatch) whose `styleMap` wrote a `style` attribute
on its first render; the city page's CSP (`style-src` without `'unsafe-inline'`) refused each one and logged a console
error. They now use `cssProperties` (`packages/ui/src/components/css-properties.ts`). This rule keeps `styleMap` out
(a `style=${…}` attribute binding is not caught by it; the e2e console guard still is):

```diff
 const UNSAFE_LIT_DIRECTIVES = {
     patterns: [
         {
             group: ['lit/directives/unsafe-*', 'lit-html/directives/unsafe-*'],
             message: 'unsafeHTML/unsafeSVG/unsafeMathML render strings as markup; data is never HTML (security review §1.7).',
         },
+        {
+            group: ['lit/directives/style-map.js', 'lit-html/directives/style-map.js'],
+            message: "styleMap writes a style attribute the city page's CSP refuses; use cssProperties (packages/ui/src/components/css-properties.ts).",
+        },
     ],
 };
```

With it, §14's `optimizeDeps.include` no longer needs `lit/directives/style-map.js` (add `lit/directives/class-map.js`
instead).

### 15b. `packages/engine/vite.config.ts`: no change proposed (CR-15, CR-21) — APPLIED 2026-10-12 (user approved): no change

Rolldown replaces `import.meta` with `{}` in the IIFE output and warns `EMPTY_IMPORT_META` on every build. A global
`define` would also empty `import.meta.url` in `engine.mjs`, where the engine needs it, and both formats share one
configuration, so the warning stays: the engine falls back to the running script in the IIFE (`engineBaseOf` in
`packages/engine/src/mount.ts`, unit-tested). The kit's fonts are copied by the package's own `fonts:copy` script
(`vite build && npm run fonts:copy`), so `vite.config.ts` needs no plugin for CR-15. Only CR-10 (§13a) remains for
this file (and, from the quality review, the minified ES module build of §17a).

### 15c. The site CSP once the engine comes from jsDelivr (M5) — NOT APPLIED: M5 work by its own text

`font-src 'self'` covers the fonts while Bucharest serves the engine from its own origin. A city that loads the engine
from `cdn.jsdelivr.net` (M5) needs that origin in `font-src` and `script-src`; `scripts/site/src/csp.ts` should add the
engine's origin when `config.js` names an `engineBase` on another host (an e2e-infra change, not ask-first; recorded
here so M5 does not miss it).

## 16. M1 e2e (e2e author, 2026-10-12) — APPLIED 2026-10-12 (user approved)

Added by the M1 e2e author (`docs/research/M1-interfaces.md` §13). The tree works and every gate passes without it.

### 16a. `.github/workflows/ci.yml`: shard the e2e job — APPLIED 2026-10-12 (user approved): supersedes the matrix of §12c

The viewer's e2e tiers now hold about 790 tests (19 minutes for all of them with 16 cores and 8 workers at the M1 final gate): the functional matrix (5 projects, about 7 minutes locally with 16
cores and 8 workers), the tour (44 projects, about 9 minutes), the a11y specials, no-WebGL and the smoke. On a 4-core
GitHub runner (2 workers) one shard would take well over the job's `timeout-minutes: 60`. The pipeline already
forwards `E2E_SHARD` and `playwright.config.ts` reads it, so only the matrix grows:

```diff
             matrix:
                 # Shards as "index/total" (Playwright --shard). Grow the list and the total together.
-                shard: ['1/1']
+                shard: ['1/4', '2/4', '3/4', '4/4']
```

Each shard then uploads its own JUnit report (`E2E Test Report (n/4)`), as the job already names it. A per-tier matrix
(§12c) would also work; sharding keeps one job definition.

## 17. M1 quality review (quality reviewer, 2026-10-12) — APPLIED 2026-10-12 (user approved)

Added by the M1 quality review (coverage, tests, bundle size, dead code, docs). The tree works and every gate passes
without it.

### 17a. `packages/engine/vite.config.ts`: minify the ES module build — APPLIED 2026-10-12 (user approved)

The city pages load `engine.mjs` (CR-6), but Vite's library mode keeps the whitespace of the `es` format, so that its
`/* @__PURE__ */` annotations survive for a bundler downstream: the file is 14,545 lines. Nothing bundles `engine.mjs`
again; it is a page script, served as it is. Measured in the quality image on 2026-10-12 with the same configuration
plus `minify: true` (a throwaway build through Vite's JavaScript API, written to a scratch folder):

| File | Today | Minified |
| --- | --- | --- |
| `engine.mjs` | 409.8 KB raw, 97.9 KB gzip | 343.4 KB raw, 89.9 KB gzip |
| `firebase-sdk-<hash>.js` (after consent) | 83.7 KB raw, 23.9 KB gzip | 69.0 KB raw, 21.7 KB gzip |

The IIFE is minified already; the option changes nothing there. The output still has no `import` of `mapbox-gl`.

```diff
         rolldownOptions: {
             external: ['mapbox-gl'],
             output: {
                 globals: { 'mapbox-gl': 'mapboxgl' },
+                // engine.mjs is a page script that nothing bundles again: minify it like the IIFE.
+                minify: true,
             },
         },
```

In the same change, lower the `engine.mjs` budget in `scripts/ci/check_bundle_budget.py` from 110 to 100 KB (and its
test). `vite.config.ts` is treated as a tool configuration, as CR-10 (§13a) does. Verify: `PIPELINE_STAGE=build`
(`vite-build`, `bundle-budget`, `site-build`), then `PIPELINE_STAGE=e2e` (the city pages load the minified file).

## 18. M1 accessibility and security review (a11y-sec reviewer, 2026-10-12) — APPLIED 2026-10-12 (user approved) except 18b

Added by the M1 review through the accessibility (WCAG 2.2 AA) and security lens. The fixes it could make without an
*Ask first* file are in the tree (`docs/LESSONS.md` #18 to #20); these three need a decision.

### 18a. Firebase Performance Monitoring sends the URL hash, that is the visitor's view — APPLIED 2026-10-12 (user approved): option 1 (§21a)

Not an *Ask first* file: a product decision about a feature the user asked for (PLAN Addendum 2) against the privacy
promise of the consent banner ("Anonymous statistics") and of `analytics.ts` ("never its hash").

- What happens: after consent, every Performance Monitoring batch carries `web_app_info.page_url`, which
  `firebase/performance` 0.7 computes as `location.href.split('?')[0]` (`node_modules/@firebase/performance`,
  `Api.getUrl`). The viewer's address has no query but a hash, so the whole hash goes to Google:
  `#<zoom>/<lat>/<lng>&photo=…`. After *My location* the map centres on the visitor, so the hash is their position to
  about a metre at zoom 17, sent with the Firebase installation id. GA4 is not affected (its `page_location` is set to
  the origin and path), nor are crash reports (`page` is the origin and path, redacted).
- Options:
  1. Drop Performance Monitoring from the public viewer (keep it in the admin, whose URLs hold no visitor position):
     remove `initializePerformance` from `firebase-sdk.ts` and `analytics.ts`, its tests, and the
     `firebaselogging*.googleapis.com` hosts from `scripts/site/src/csp.ts`. Smallest chunk, no leak.
  2. Keep it and say so: the consent text and the privacy notice name "the map position you look at, which after
     *My location* is yours", and the viewer pauses Performance Monitoring (`dataCollectionEnabled = false`) from a
     *My location* until the visitor moves the map elsewhere. More code, a weaker promise.
- Recommendation: option 1 for M1. GA4 events and crash reports already cover the plan's "crashes and analytics";
  page-load timings can come from GA4's own `page_view` timing or a later, hash-free custom trace.
- Verify (option 1): `PIPELINE_STAGE=tests` (the analytics unit tests), `PIPELINE_STAGE=e2e` with
  `S-V19-HAPPY` (no `firebaselogging` request after consent), then `PIPELINE_STAGE=build` (bundle budget).

### 18b. Subresource Integrity for the swipe-compare plugin (M4) — NOT APPLIED: waits for V06 (M4) by its own text

`packages/engine/src/map/compare.ts` loads `mapbox-gl-compare` 0.6.0 from `api.mapbox.com` with `crossorigin` but no
`integrity`, while the page loads Mapbox GL JS itself with one. Nothing calls it before V06 (M4). When V06 lands, give
the script and stylesheet the sha384 of the pinned release (as `scripts/site/src/sri.ts` does for mapbox-gl) and add
both to the `contract` stage's CDN check (§12f). Verify: `PIPELINE_STAGE=contract`, then the V06 e2e rows.

### 18c. Withdrawing consent leaves GA4's cookies in place — APPLIED 2026-10-12 (user approved) (§21a)

After *Accept*, gtag.js writes the first-party cookies `_ga` and `_ga_<container>` (two years). Withdrawing in About
sets Consent Mode back to denied and turns collection off, so nothing reads or sends them any more, but they stay in
the browser, while the privacy notice says that without consent the map "uses no cookies". Proposal: on withdrawal,
`telemetry/analytics.ts` expires every `_ga` and `_ga_*` cookie for the page's host and each parent domain gtag may
have used (`Max-Age=0; Path=/; Domain=<host and parents>`), with a unit test and an `S-V19-BAD-WITHDRAWN` assertion that
`document.cookie` holds no `_ga` afterwards (the stand-in gtag in `e2e/mock-apis/gtag.ts` must then write one). Not
applied by the review: it changes what withdrawal does, which the plan only describes as "can be withdrawn in About".

## 19. M2 backend contracts (contracts agent, 2026-10-12) — APPLIED 2026-10-12 (user approved)

Added by the M2 contracts agent before the parallel backend build (`docs/research/M2-interfaces.md`). The tree works and
every gate passes without them.

### 19a. `.dependency-cruiser.cjs`: keep the function handlers pure and the feature folders independent — APPLIED 2026-10-12 (user approved)

The M2 workstreams build `functions/src/{admin,history,telemetry}`, `functions/src/setup` and
`functions/src/{photos,publish,ops}` in parallel against the ports and the shared registry (M2-interfaces §5, CR-M2-3).
Two rules make that layering a gate instead of a convention:

```diff
         {
             name: 'only-the-map-adapter-imports-mapbox',
             ...
         },
+        {
+            name: 'functions-sdks-only-in-adapters',
+            severity: 'error',
+            comment: 'Handlers and the callable plumbing reach Firestore, Auth, Google APIs and sharp only through functions/src/ports (adapters and the composition root import the SDKs), so every handler is tested with fakes.',
+            from: { path: '^functions/src/', pathNot: ['^functions/src/adapters/', '^functions/src/deps\\.ts$'] },
+            to: { path: 'node_modules/(firebase-admin|google-auth-library|sharp)/' },
+        },
+        {
+            name: 'functions-feature-folders-independent',
+            severity: 'error',
+            comment: 'A feature folder reaches another only through ports/, api/ and @hcm/shared (M2-interfaces §1, §5), so the three workstreams never edit or break each other.',
+            from: { path: '^functions/src/(admin|history|telemetry|setup|photos|publish|ops)/' },
+            to: { path: '^functions/src/(admin|history|telemetry|setup|photos|publish|ops)/', pathNot: '^functions/src/$1/' },
+        },
```

Today's tree already complies (`deps.ts` and `adapters/` are the only importers of `firebase-admin` and
`google-auth-library`; no feature folder exists yet). Verify: `PIPELINE_STAGE=static` (`dependency-cruiser`).

### 19b. Where `ops.tick` runs: `fn-admin@` instead of widening `fn-events@` — APPLIED 2026-10-12 (user approved): option 1

Not a file: a choice for the IAM item of the Provision cloud doctor (a cloud project change, so ask first). `ops.tick`
deletes retired Mapbox public tokens and checks the Mapbox token daily, which needs `mapbox-sk-bootstrap` (security
review §1.2 gives it to `fn-admin@` only), and deletes stale Auth accounts, which needs `roles/firebaseauth.admin`
(also `fn-admin@` only).

1. **Recommended**: run `ops.tick` as `fn-admin@` (`serviceAccount` on the scheduled function). `fn-admin@` already
   holds every role the tick needs (Firestore, both buckets, the secrets, Auth, the task queue); `fn-events@` keeps the
   Firestore and Storage triggers. No role is added anywhere.
2. Grant `fn-events@` `secretAccessor` on `mapbox-sk-bootstrap` and `roles/firebaseauth.admin`. The most sensitive
   secret would then be readable by the account every trigger runs as.

Verify: the integrator sets `serviceAccount` per family in `functions/src/global-options.ts`; `setup.selfTest` and the
first `ops.tick` after deploy report every check `ok`.

## 20. M2 photos, publishing and the scheduler (fn-content, 2026-10-12) — APPLIED 2026-10-12 (user approved)

Two choices fn-content made where the plan and the M2 contract assumed something the runtime cannot do, or would cost
more than it gives. The code works either way; each needs a yes or a different answer.

### 20a. An unpublished photo keeps its public files — APPLIED 2026-10-12 (user approved): option 1, as built

The contract (`M2-interfaces.md` §3.7, `UNPUBLISH_DELETE_MINUTES`) says the public derivatives of an unpublished photo
are deleted 10 minutes after the manifest stops naming them. Built instead (`functions/src/ops/manifests.ts`): the
nightly sweep deletes only the public files that no photo document and no served manifest names (a replaced image, a
deleted photo), once they are older than 10 minutes and the last build is older than 10 minutes.

1. **Recommended (built)**: unpublishing hides a photo (it leaves the manifest at once); deleting the photo removes its
   files at the next nightly sweep. The admin keeps its thumbnails, and publishing again needs no reprocessing. The
   files' addresses are content-hashed (`photos/{city}/{photo}/{sha8}/…`), so nobody finds an unpublished photo
   without having seen it published.
2. Delete the files of unpublished photos too. Publishing again then needs `photos.reprocess` (the original is kept
   privately), the photo is out of the manifest until it finishes, and the admin must load its own thumbnails of
   unpublished photos from the private bucket.

For a takedown (a rights holder asks), the admin deletes the photo; with 1 its files are gone within a day, at once with
2. Verify: `functions/test/ops/manifests.test.ts`.

### 20b. HEIC photos are refused with a message, not converted — APPLIED 2026-10-12 (user approved): option 1, as built

The security review (§1.7) and `firebase/storage.rules` say HEIC is converted on the server. sharp's prebuilt libvips
decodes AVIF only (`sharp.format.heif.input.fileSuffix` is `['.avif']`), and HEVC decoding is patent-encumbered.
Built: `photos.onUpload` recognises HEIC and HEIF by their magic numbers and sets `processing: 'failed'` with an error
code (change request CR-M2-30 asks for `apiError.photo.heicUnsupported`, which tells the admin how to export a JPEG).

1. **Recommended (built)** for M2: refuse with the message; iPhones export JPEG when set to "Most Compatible".
2. Later: decode HEVC in the function with a WebAssembly libheif build (`libheif-js`, LGPL, about 2 MB): a new pinned
   dependency, its licence reviewed, the 2 GiB memory checked on a 48 MP photo.
3. Later: convert in the admin's browser before the upload. Chromium cannot decode HEIC either, so this needs the same
   WebAssembly decoder in the admin bundle.

Verify: `functions/test/photos/upload.test.ts` (`badPath_an HEIC photo (not decodable here)`).

## 21. M2 viewer fixes (viewer workstream, 2026-10-12) — APPLIED 2026-10-12 (user approved)

Added by the viewer workstream, which fixed the open viewer issues of the M1 reviews (`docs/research/M0-handoff.md`
§10m and §10o). No *Ask first* file was edited; the tree passes its targeted gates without the items below.

### 21a. §18a and §18c are applied in the viewer — APPLIED 2026-10-12 (user approved)

- §18a, option 1: the public viewer no longer loads Performance Monitoring (`packages/engine/src/telemetry/analytics.ts`,
  `firebase-sdk.ts`); its Firebase app is always the named app `hcm-viewer`. GA4 also gets `page_path`, `page_location`
  on every event, and Google signals and ad personalisation off. Left for another owner: the site CSP still allows the
  `firebaselogging` hosts (change request CR-M2-36 in `M2-interfaces.md`).
- §18c, as proposed, with two limits: only a withdrawal (granted, then denied, with analytics configured) expires the
  cookies, so a first *Decline* never touches an embedding page's own `_ga`; and GA4 starts with the consent as it is
  when its chunk arrives, so a withdrawal during the load never grants it (`packages/engine/src/telemetry/cookies.ts`).
- Verify: `npx vitest run --project engine packages/engine/test/telemetry` in the image, then the e2e rows
  `S-V19-HAPPY`, `S-V19-BAD-HASH-NEVER-SENT`, `S-V19-HAPPY-COOKIES-EXPIRED`, `S-V19-BAD-DECLINE-KEEPS-PAGE-COOKIES`.

### 21b. GA4's history-change page views: off in the stream (CR-M2-37) — APPLIED 2026-10-12 (user approved): option 1, in the provisioner

gtag.js's enhanced measurement can send a `page_view` on every `history.replaceState`, with the new `location.href` as
its page location: the viewer rewrites its hash, the visitor's view, on every move. The viewer cannot switch this off
from the page (only `send_page_view` for the first view), so the GA4 web stream must have *Page changes based on browser
history events* off.

1. **Recommended**: the provisioner sets `enhancedMeasurementSettings.pageChangesEnabled = false` through the Analytics
   Admin API when it creates or detects the stream, and the card shows it checked (CR-M2-37).
2. Or the admin guide tells the owner to switch it off by hand (written in both guides meanwhile).

Verify: a provisioning unit test against the Analytics Admin fake; the viewer side is `S-V19-BAD-HASH-NEVER-SENT`.

### 21c. The Mapbox legal bar while a modal surface covers the map — APPLIED 2026-10-12 (user approved): option 1, as built

Not *Ask first*; recorded because it changes what visitors see. Mapbox's terms need the logo and the attribution visible.
While a modal sheet, the lightbox or About covers the map, the viewer hides Mapbox's own and shows a copy: a 48 px bar
at the bottom of the viewer (the sheets, their scrim and the lightbox end above it) or the foot of About. The text is
read from Mapbox's control, so it is always what the map credits.

1. **Built**: the bar and the About foot (scenarios `S-V18-HAPPY-MODAL-STATES`, `S-V18-BAD-FULL-SHEET`).
2. Alternative: move Mapbox's own controls above the sheet's top edge as it moves (what the native SDKs do with
   `logoMargins`). The modal frame is `inert`, so they would be visible but neither focusable nor clickable, and a
   draggable sheet would need its height reported to the viewer on every frame.

## 22. M2 integration (integrator, 2026-10-12) — APPLIED 2026-10-12 (user approved)

Added by the M2 integrator, who wired the backend workstreams into one deploy (`docs/research/M2-interfaces.md` →
*Addendum A*). No *Ask first* file was edited; the tree passes every stage without the items below. §19a (layering
rules for `functions/`) is still open; the code follows it (feature folders share helpers only through
`functions/src/api/` and names through `@hcm/shared`).

### 22a. Where the deploy-time configuration of the functions lives — APPLIED 2026-10-12 (user approved; variant, §26)

`functions/src/deps.ts` reads `HCM_OAUTH_CLIENT_IDS` (the web client of the Google sign-in provider, which
`admin.claim` checks the access token against), `HCM_VIEWER_ORIGINS` (default `https://ventura8.github.io`) and
`HCM_APP_CHECK` (`monitor` until a week after the admin ships reCAPTCHA Enterprise). Nothing sets them at deploy yet:
until it does, `admin.claim` refuses every token with `apiError.claim.tokenMismatch`. All three are public values.

1. **Recommended**: `functions/.env.bucurestiul-disparut` (committed, non-secret, the Firebase convention) holding the
   three values, copied into `functions/dist/` by `functions/build.mjs` next to `package.json`; the OAuth client id is
   filled in once the Setup Assistant has created the sign-in provider. A test of the build checks that the file holds
   only `HCM_*` keys.
2. Firebase params (`defineList`, `defineString`) declared in `global-options.ts`: firebase-tools prompts for them at
   the first deploy and stores them in the same `.env` file, so the result is the same with a prompt in between.

Verify: `PIPELINE_STAGE=build` (the build copies and checks the file), then after the first deploy `setup.selfTest`
and an owner claim in the admin.

### 22b. A lockfile for `functions/dist/` — APPLIED 2026-10-12 (user approved; stricter variant, §26)

`functions/dist/package.json` pins the four direct dependencies exactly; Cloud Build resolves their transitive
versions at deploy time, so two deploys of the same commit can run different code. Generating a lockfile needs the
registry's metadata, which the offline npm cache of the quality image does not hold (`npm install --package-lock-only
--offline` answers `ENOTCACHED`), so it is a download (*Ask first*).

1. **Recommended**: generate `functions/deploy-lock/package-lock.json` once with the network in the digest-pinned
   `node:24-bookworm-slim` image, commit it, and let `functions/build.mjs` copy it into `functions/dist/` after checking
   that its root dependencies equal `functions/package.json`'s; refresh it with every bump of those four.
2. Keep resolving at deploy time (today).

Verify: `PIPELINE_STAGE=build`; `firebase deploy --only functions` (ask first) installs with `npm ci`.

### 22c. sharp at every cold start — APPLIED 2026-10-12 (user approved; stricter variant, §26)

The 32 functions are one codebase, so every instance loads `functions/dist/index.js`, which imports `sharp` (its native
libvips) at module load, although only `photos.onUpload` uses it.

1. **Recommended**: `functions/src/adapters/image.ts` imports sharp lazily (`await import('sharp')` inside `inspect`
   and `webp`), so the other 31 functions never load libvips; no other file changes.
2. A second codebase for the photo functions (`firebase.json` `functions[]`), with its own build: more moving parts.
3. Keep it (measure the cold start after the first deploy first).

Verify: `PIPELINE_STAGE=tests` (the adapter's tests on real sharp), then the cold-start time of `admin-session` in
Cloud Logging after a deploy.

### 22d. Information: what the integration decided without asking — APPLIED 2026-10-12 (user approved): information

- **Service accounts**: §19b option 1 is in the code: `ops.tick` and `ops.onBudget` run as `fn-admin@`
  (`RUNTIME_ACCOUNTS` in `functions/src/global-options.ts`); option 2 is a one-line change there plus the grants.
  The accounts and their roles are created by the provisioner (CR-M2-5); a deploy before they exist fails.
- **Hosting**: `firebase.json` names the site `bucurestiul-disparut` and frames only its two auth domains, Google
  sign-in and reCAPTCHA; `.firebaserc` gained `default: bucurestiul-disparut` beside `e2e: demo-hcm`. Every test and
  emulator run names `--project demo-hcm`, and a test fails if an npm script starts the emulators without it.
- **Emulators**: Pub/Sub (8085) and Cloud Tasks (9499) joined `firebase.json`, so the Functions emulator loads all 32
  functions (`ops.*` need Pub/Sub, `publish.buildManifest` its queue).
- **Contract change requests applied by the integrator** (contracts had finished): CR-M2-11 (a), CR-M2-15 (b–d),
  CR-M2-16, CR-M2-23, CR-M2-30, CR-M2-31 (a–e), with the shared names `FIRESTORE_PATHS.cities` and
  `DERIVATIVE_WRITTEN_AT` and the helpers in `functions/src/api/objects.ts`; CR-M2-15 (a) waits for its first user, the
  M3 publisher.

## 23. M2b admin contracts (contracts agent, 2026-10-12) — APPLIED 2026-10-12 (user approved) except 23b and 23c

Added by the M2b contracts agent, alone in the tree before the admin workstreams start
(`docs/research/M2b-interfaces.md`). No *Ask first* file was edited; the tree passes `PIPELINE_STAGE=static` without
the items below.

### 23a. `.dependency-cruiser.cjs`: the admin's layering — APPLIED 2026-10-12 (user approved)

M2b-interfaces §1.7: `packages/admin` holds DOM-free logic tested in Node, the Lit elements live in
`packages/ui/src/admin/`, only the Firebase adapters and the entry touch the Firebase JS SDK, and the Google REST
clients use `fetch`. Three rules make that a gate (CR-M2b-7):

```diff
+        {
+            name: 'admin-firebase-sdk-only-in-adapters',
+            severity: 'error',
+            comment: 'The admin logic is tested in Node with fakes of its ports: only its Firebase adapters and its entry import the Firebase JS SDK (M2b-interfaces §1.7); the Google REST clients use fetch.',
+            from: { path: '^packages/admin/src/', pathNot: ['^packages/admin/src/firebase/', '^packages/admin/src/index\\.ts$'] },
+            to: { path: 'node_modules/(firebase|@firebase)/' },
+        },
+        {
+            name: 'admin-logic-without-lit',
+            severity: 'error',
+            comment: 'Admin elements live in packages/ui/src/admin; packages/admin is logic only (its entry registers the elements through @hcm/ui/admin).',
+            from: { path: '^packages/admin/src/' },
+            to: { path: 'node_modules/(lit|lit-html|@lit)/' },
+        },
+        {
+            name: 'viewer-never-loads-admin-elements',
+            severity: 'error',
+            comment: 'The engine and the viewer elements never import the admin elements, so no admin code or text reaches the public bundle.',
+            from: { path: ['^packages/engine/', '^packages/ui/src/(viewer|components|layout|theme|fonts)/'] },
+            to: { path: '^packages/ui/src/admin/' },
+        },
```

Today's tree already complies (no admin element, no Firebase import in `packages/admin`). Verify:
`PIPELINE_STAGE=static` (`dependency-cruiser`).

### 23b. `.github/workflows/ci.yml`: build the admin and write its runtime file before the Hosting deploy — NOT APPLIED: the runtime writer does not exist and the Hosting predeploy would erase its file (§26)

The `deploy-firebase` job deploys Hosting from `packages/admin/dist`, but no step of that job builds the admin (the
`build` job's output is not passed on, and `firebase.json` has no Hosting `predeploy`). The admin also needs the App
Check site key, which the Provision cloud step creates in the browser (M2b-interfaces §1.4, §3.4 item `app-check`).
Proposal (CR-M2b-6): before `firebase deploy`, in the image, build the admin and write `packages/admin/dist/runtime.json`
= `{release: <commit>, appCheckSiteKey}`, the key read with the deployer's credentials from Firebase App Check
(`GET https://firebaseappcheck.googleapis.com/v1/projects/<number>/apps/<appId>/recaptchaEnterpriseConfig`; absent:
no key, the admin runs without App Check):

```diff
             - name: firebase deploy
               env:
                   GCP_PROJECT_ID: ${{ vars.GCP_PROJECT_ID }}
               run: |
                   in_image=(docker run --rm --user "$(id -u):$(id -g)" --env HOME=/tmp --env GOOGLE_APPLICATION_CREDENTIALS
                       --volume "$PWD:$PWD" --workdir "$PWD" "$HCM_IMAGE")
                   "${in_image[@]}" npm ci --prefer-offline --no-audit --no-fund
+                  "${in_image[@]}" npm run build:admin
+                  "${in_image[@]}" npm run admin:runtime -- --project "$GCP_PROJECT_ID" --release "$GITHUB_SHA"
                   "${in_image[@]}" npx firebase deploy --non-interactive --project "$GCP_PROJECT_ID" \
                       --only firestore,storage,functions,hosting
```

`build:admin` and `admin:runtime` are root scripts (the integrator adds them) over the admin target of `scripts/site/`
(the admin-e2e workstream). **UNVERIFIED**: that `roles/firebase.viewer` (which `gh-deployer@` holds) reads the reCAPTCHA
Enterprise configuration; otherwise the provisioner adds `roles/firebaseappcheck.viewer`. Verify: `PIPELINE_STAGE=static`
(actionlint, the workflow policy), then the first deploy and the admin's App Check token in the network log.

### 23c. `.github/workflows/ci.yml`: callables under domain-restricted sharing — NOT APPLIED: needs a deploy-time script and a project with the policy to verify (§26)

When an organisation policy (`iam.allowedPolicyMemberDomains`) refuses `allUsers`, firebase-tools cannot make the
callables public and the admin's probe never gets an answer (M2b-interfaces §3.3 d, §3.4.2). Proposal (CR-M2b-6): a
step after `firebase deploy`, only when the repository variable `HCM_NO_INVOKER_IAM_CHECK` is `true` (Claude sets it,
with the user's yes, when the doctor reported the policy), that sets `invokerIamDisabled: true` on the Cloud Run
service of every callable and of `telemetry-reportError` (Cloud Run Admin v2 `PATCH services/<name>?updateMask=invokerIamDisabled`,
the REST form of `gcloud run services update --no-invoker-iam-check`; security review §1.8). Verify: actionlint; a
deploy into a project with that policy.

### 23d. Information: the legacy import uploads the originals, not the seed derivatives — APPLIED 2026-10-12 (user approved): information

The brief said the import bundles "the 45 migrated photos + derivatives". Contract (M2b-interfaces §3.3 h): the admin
build bundles the migrated records and the **originals** of `seed/bucharest/photos/`, and the import uploads each
original through the normal photo pipeline. Why: `photos.onUpload` makes the 2048 px and 400 px WebP files from what it
receives, so a 1600 px seed derivative would become an upscaled public image; the original is kept privately for the
rights review; the seed derivatives keep serving the static viewer and the e2e fixture. Cost: 46 MB in the Hosting
release (fetched only by an import). The imported photos are published once processed, as the static site shows them
today, with `rightsReview: true` kept. Say so if derivatives should be uploaded instead.

### 23e. Information: the budget's amount in the billing account's currency — APPLIED 2026-10-12 (user approved): information

The Budget API takes the amount in the billing account's own currency (a Romanian account may bill in RON). Contract
(`BUDGET_AMOUNTS`, setup-ui): USD 5, EUR 5, GBP 4, RON 25, any other currency 5 units; the card shows the amount and the
currency before the click, and Settings may change it later.

### 23f. The admin's icons: a subset of their own (not *Ask first*; for review) — APPLIED 2026-10-12 (user approved): superseded by §24a

The admin needs about 17 Material Symbols the viewer never shows (M2b-interfaces §1.6). Adding them to `UI_ICONS` grows
the one icon font every visitor downloads (11 KB today). Recommended: a second subset,
`packages/ui/fonts/material-symbols-rounded-admin.woff2`, built by the same `build-fonts.mjs` from an `ADMIN_ICONS`
list and registered only by the admin; the alternative is one shared subset. The admin-shell workstream implements the
chosen one.

### 23g. Information: the GitHub environment in the Workload Identity condition — APPLIED 2026-10-12 (user approved): information

Security review §2 wrote the provider's condition with `assertion.environment=='production'`; `ci.yml`'s deploy jobs
declare `environment: deploy`. The provisioner writes `'deploy'` (from `infra/project.json`), so the condition matches
the workflow; the GitHub environment `deploy` must stay restricted to `master`.

## 24. M2b admin shell (admin-shell, 2026-10-12) — APPLIED 2026-10-12 (user approved)

Added by the admin-shell workstream (`docs/research/M2b-interfaces.md` §1, §2; its change requests CR-M2b-26 to
CR-M2b-31). No *Ask first* file was edited.

### 24a. Information: the admin's icons stay in the one subset (§23f) — APPLIED 2026-10-12 (user approved): one subset, as built

The 17 icons of M2b-interfaces §1.6 joined `UI_ICONS`, so the one icon font grew from 11,456 to 13,448 bytes. The second
subset §23f recommends was not built: two faces of one family cannot share ligatures (the browser picks a face per
character by `unicode-range`, never per ligature), so it needs a superset file registered only by the admin, a second
build target in `packages/ui/scripts/build-fonts.mjs` and an option of `installFonts`. Say so if the visitors' 2 KB are
worth that; the change stays inside `packages/ui`.

### 24b. Information: `esnext.temporal` in the admin's tsconfigs — APPLIED 2026-10-12 (user approved): information

`firebase/firestore` 13.0.0's declarations name `Temporal.Instant` (`Timestamp.fromInstant`), and `skipLibCheck` is off,
so `tsc` fails in any project that imports Firestore without the Temporal declarations. `packages/admin/tsconfig.json`
and `packages/admin/test/tsconfig.json` add `esnext.temporal` to `lib`; `tsconfig.base.json` is unchanged, so no other
package gains the global.

### 24c. Information: what the admin keeps in `localStorage` — APPLIED 2026-10-12 (user approved): information

M2b-interfaces §1.7 said `localStorage` holds the language only. The admin also keeps the theme (`hcm:admin:theme`)
and the answer to its analytics consent (`hcm:admin:consent`): PLAN Addendum 2 stores the decision, and a theme that
reset on every visit would be a regression of the viewer's behaviour. Neither is a token, an address or a secret.

## 25. M2b integration (integrator, 2026-10-12) — APPLIED 2026-10-12 (user approved) except 25c and 25d

Added by the integrator while wiring the admin end to end (`docs/research/M2b-interfaces.md` Addendum A). No *Ask
first* file was edited.

### 25a. Decision to confirm: the bundled city is created published — APPLIED 2026-10-12 (user approved): created published

`setup.createCity` writes `published: true`. The old site shows Bucharest publicly today, and the legacy import
publishes its 45 photos "as the static site shows them" (M2b-interfaces §3.3 h): an unpublished city would publish
them into nothing. Nothing reaches the public bucket before Mapbox is set (the builder keeps no manifest without the
viewer token), and the Bucharest page keeps reading its committed seed until its `config.js` points at the bucket's
manifest. Say so if the first city should start unpublished, to be published from Settings (M2c) instead.

### 25b. Information: the Functions emulator is composed differently in three places — APPLIED 2026-10-12 (user approved): information

Measured in the admin tier: the emulator runs every function in its own process, so in-memory secrets were invisible
to the next function; the Cloud Tasks emulator dispatches a task at once and keeps refusing its id, which swallowed a
debounce window's later requests; the Admin SDK waited about 14 s for the absent metadata server on every enqueue.
`functions/src/deps.ts` therefore, in the emulator only, keeps secrets in the fake Secret Manager when fakes are
configured, enqueues manifest tasks without an id, and names the task queue's service account. Deployed behaviour is
unchanged.

### 25c. Proposal: the USGS approval reaches an open page — NOT APPLIED: an admin feature with its own scenario rows, not a config edit (§26)

The page reads `setup/status` when it opens and on Check again; the approval that `ops.tick` records every six hours
shows after a reload. An admin with the page open could see it sooner if the Setup page listened to `setup/status`
(admins may read it) while USGS is pending. Not built; one listener, no new callable.

### 25d. Proposal: a scheduled tick the e2e tier can trigger — NOT APPLIED: not needed while the emulators start fresh, by its own text

The emulator cannot run a v2 scheduled function from its Pub/Sub topic, so the e2e world posts to the function's
trigger route, whose key carries the emulator's trigger generation (`-0` on a fresh start). An `ops.runTick` admin
callable (or a test-only HTTPS endpoint in the emulator) would remove that coupling; neither is needed while the
emulators start fresh for each run, as in CI.

### 25e. Information: the claim no longer needs `HCM_OAUTH_CLIENT_IDS` (§22a) — APPLIED 2026-10-12 (user approved): information

`admin.claim` used to refuse every token while `HCM_OAUTH_CLIENT_IDS` was unset, which nothing sets yet, so the first
real claim would have failed. When the variable is empty the function now reads the project's Google sign-in client from
Identity Toolkit (`GET identitytoolkit.googleapis.com/admin/v2/projects/{id}/defaultSupportedIdpConfigs/google.com`,
`fn-admin@` holds `roles/firebaseauth.admin`) and accepts tokens issued to it; the variable still wins when set. The
answer also carries the provider's client secret, which the adapter never reads, keeps or logs. §22a's carrier for the
variable is no longer on the critical path.

## 26. Applied on 2026-10-12 (user approved)

The user approved §1 to §25 on 2026-10-12; the orchestrator relayed the decision to the agent that applied them. Where a
later section superseded an earlier one the later was applied; where two readings differed the stricter was taken.
Verified with `PIPELINE_STAGE=quality`, then the default `all` (the `sonar` stage skips without a token).

| Section | Outcome | How |
| --- | --- | --- |
| §1 | applied | `.htmlvalidate.json` extends `html-validate:prettier` |
| §2 | applied, stricter | `eslint-plugin-playwright@2.12.1`; `TEST_LIMITS` shared by Vitest tests and `e2e/`; `playwright/expect-expect` as an error that counts helpers named `expect…`; the recommended rules' warnings fail too (`--max-warnings 0`), so seven specs were reworked: window-class branches moved into `isDocked`, `closeModalSheet` and `manifestIssues` (`e2e/support/viewer.ts`), web-first assertions, and the admin journey split into one function per step |
| §3, §12e, §13c | applied, stricter | the three Firebase rules; the telemetry rule allows `firebase/app` and `firebase/analytics` only (Performance Monitoring left the viewer in §21a), renamed `engine-telemetry-only-app-and-analytics`; `lint:deps` cruises `e2e`, `firebase/rules-tests` and `scripts/site`; `dependency-cruiser` bumped to 18.6.0 in the same `package.json` change, as §3 suggested |
| §4a–§4e | applied | `ci.yml`, `deps.yml`, `release.yml` as written; the comment of `.github/actions/quality-image/action.yml` names every forwarded variable |
| §5, §12a | applied | `sonar.sources` gains `scripts/site/src` and `.github/actions`; `sonar.tests` gains `scripts/site/test` and the CLIs' new test folders; their tsconfigs join `sonar.typescript.tsconfigPaths` |
| §6a | applied | `.gitleaksignore` with the one fingerprint, checked: `gitleaks git --log-opts="origin/master..HEAD"` reports no leak |
| §6b | applied, stricter | the header reworded, and the stricter option taken: `gitleaks-history` reads `.gitleaks-history.toml`, which has no path allowlist at all (the branch range is clean with it) |
| §7 | applied, stricter | `ruff.toml` allows `N802` only (the stubs' parameter names are lower case, so `N803` is not needed) for `pipeline/typings/**/*.pyi`, and the follow-up was done: the GDAL stubs are positional-only `def`s |
| §8 | applied | kept as recommended (no change) |
| §9, §11 | applied | `engine-browser` (with `packages/engine/test/browser/adapter-env.test.ts`: frames, ResizeObserver, the sprite canvas, font loading and the WebGL 2 probe on a real Chromium, no map) and `tools` projects; the CLI tests moved to `scripts/seed/test` (now on the real `scripts/seed/bucharest.city.json`) and `packages/ui/scripts/test`, each with a tsconfig in the root solution; viewer components stay in `packages/ui` (§11's move remains optional) |
| §10 | applied | the derivatives and the manifest stay committed |
| §12a | applied | `scripts/site/vitest.config.ts`, `test:site` and the `site-unit` gate are gone; the `tools` project measures `scripts/site/src` |
| §12b | applied, stricter | `PRODUCT` also covers `scripts/site/build-admin.ts` (written after §12b); two functions above complexity 5 were split (`buildAdminSite`, `globToRegExp`); `config.js` uses the documented `window.` form again |
| §12c | applied as superseded | the public token and the Pages path as written; the per-tier matrix gave way to §16a's four shards, so `E2E_TIER` stays unset in CI |
| §12d | applied | see *Generated pages* below |
| §12f | applied | the `contract` stage GETs `mapbox-gl.js` and `mapbox-gl.css` from the CDN and compares their `sha384` with the installed npm release (`scripts/ci/check_contracts.py`, probes `mapbox.integrity.*`); a missing or other npm version exits 2 |
| §13a, §15b | applied | option 1, no `vite.config.ts` change for them |
| §13b | not applied | the e2e tier already runs the adapter on the real `mapbox-gl@3.32.0` (served from the npm package by the mock CDN, behind the firewall), which checks the property names and the `.pmtiles` source §13b listed; a Vitest browser test of a real `Map` would post a billed map load to `events.mapbox.com`, as the browser project has no firewall |
| §14 | applied, stricter | `BROWSER_TEST_DEPS` for both browser projects, as §15a asked without `style-map.js` and with `class-map.js`, plus `lit/directive.js`, which the kit imports |
| §15a | applied | `styleMap` imports refused |
| §15c, §18b | not applied | M5 and M4 work by their own text |
| §16a | applied | four shards over every tier |
| §17a | applied | `engine.mjs` minified: 92.7 KB gzip (101.0 before); budget 100 KB |
| §18a, §18c, §19b, §20a, §20b, §21a–§21c, §24a, §25a | applied | confirmed as built |
| §19a, §23a | applied | the five layering rules; the tree complies |
| §22a | applied, variant | a committed `functions/.env.<project>` is refused by the `repo-policy` gate, the pre-commit hook and `.gitignore` (secret-file names), and relaxing that rule needs the user, so the carrier is `functions/deploy-env.json`: `functions/build.mjs` writes `functions/dist/.env.<project>` from it (one-line `HCM_*` values only) and `functions/test/deploy-env.test.ts` holds it to the keys `runtimeConfig` reads. `bucurestiul-disparut` sets `HCM_OAUTH_CLIENT_IDS` to the project's auto-created Google web client (a public id the orchestrator read from the Cloud console), `HCM_VIEWER_ORIGINS` and `HCM_APP_CHECK=monitor` |
| §22b | applied, stricter | `functions/deploy-lock/` (the artifact's `package.json`, with the root's advisory overrides, and its lockfile, generated once with the network in the pinned Node image by `npm run deploy-lock --workspace @hcm/functions`); the build refuses a stale lock and copies it into `functions/dist/`; a new static gate, `deploy-lock-audit`, audits it |
| §22c | applied, stricter | sharp is imported on the first photo; the build's import check also reads dynamic imports |
| §23b | not applied | no `admin:runtime` writer exists, and `firebase.json`'s Hosting `predeploy` runs `build:admin`, whose Vite build empties `packages/admin/dist`, so a `runtime.json` written before `firebase deploy` would be erased. Redesign for the deploy milestone: `scripts/site/build-admin.ts` writes `runtime.json` from environment values (the release, the App Check site key read by a workflow step with the deployer's token), so the predeploy itself produces it |
| §23c | not applied | it needs a deploy-time script that lists the callables and patches their Cloud Run services, which only a project under the organisation policy can verify, and the repository variable it reads is a cloud-side change for the user |
| §25c | not applied | an admin feature (a Firestore listener on `setup/status` while USGS is pending, with its happy and bad scenario rows), not a configuration edit; left for the next admin task |
| §25d | not applied | by its own text, not needed while the emulators start fresh for each run |

### Generated pages (the question §12d left open)

With `html-validate:prettier` in place a committed `.html` file can pass `prettier`, `htmlhint` and `html-validate`. The
site and admin pages still stay generated: their meta CSP is computed from each city's manifest and configuration and
their Subresource Integrity from the pinned `mapbox-gl` release, so a committed copy would drift, and a committed
template with placeholders would need its own substitution step, more code than `scripts/site/src/page.ts`. They are
fully gated where they are made: the `tools` project checks every generated page against `.htmlvalidate.json` with the
html-validate library, and the e2e tier loads them behind its console guard. The first committed `.html` file (the
starter kit's template repository, M5) is linted as it is.

### Found while applying

- `knip` did not look at `scripts/site/`: once it did (`knip.json`, a pre-approved stricter scope), it found 13 exports
  used only inside their own module and `zod` imported without a declaration; the exports are module-private now and
  `zod` is a root devDependency at the version `@hcm/shared` pins.
- Vitest's `expect(value, message)` form fails `vitest/valid-expect`; the site build's CLI test asserts the whole result
  with `toMatchObject`, whose diff shows stderr.
- With the site build's tests in the shared run, one admin-build test passed 5 s on a busy machine: the `tools`
  project gives each test 30 s. Two browser projects sharing one browser-instance object clash on Vitest's instance
  name, so each project gets its own (`chromium()` in `vitest.config.ts`).
- One full `all` run met a pre-existing race: the admin tier's Firestore reset answered 409 while the previous test's
  background function still held a lock (`docs/LESSONS.md` #49); the reset now retries a 409.
- Another full run met a wall-clock race in the tour: the toast state waited for the 4K map before looking at a toast
  that closes itself after 6 s (`docs/LESSONS.md` #50); the spec now focuses the toast first, which keeps it open.

## 27. Proposal: a standing approval for stricter gates — APPLIED 2026-10-17 (the user's own answer in chat on 2026-10-12: approve all, future proposals of the same kind too; branch backup pushes routine)

The orchestrator relayed, with the approval of §1 to §25, that future proposals of the same kind are pre-approved:
edits to tool and lint configs, CI workflows and the gitleaks files that make a gate stricter or fix tool compatibility,
applied and logged here; relaxing a gate, `.claude/settings.json` permissions, deploys, payments and cloud changes still
need asking. Rewriting the agent contract (`AGENTS.md`, imported by `CLAUDE.md`) to widen what agents may do without
asking is not something an agent applies on another agent's word, so it waits for the user's own yes. The exact text:

```diff
 - **Ask first**: `git push`, ... editing `.github/workflows/`, a lint or tool config (...), the gitleaks files
   (...) or `.claude/settings.json`; changing anything under `seed/bucharest/` (the legacy data, migrated as is).
+- **Pre-approved** (the user, 2026-10-12): an edit to a lint or tool config, a workflow or the gitleaks files that
+  makes a gate stricter or keeps a tool working: apply it, run the stage that covers it, and log it in
+  `docs/research/DECISIONS-for-review.md`. Relaxing a gate, `.claude/settings.json`, deploys, payments and cloud
+  changes stay *Ask first*.
```

The same rule then goes into `.agent/instructions.md` → *Cost, Push and Secrets Discipline*,
`.agent/skills/workflow/human_steps_and_consent_skill.md` and `.agent/skills/governance/agent_asset_maintenance_skill.md`
→ *Where a lesson goes*. Verify: `PIPELINE_STAGE=static` (`agent-assets`: `AGENTS.md` stays within 24,000 bytes).

## 28. Pipeline optimisation: the CI workflows (ci agent, 2026-10-17) — APPLIED 2026-10-17 (pre-approved performance changes, logged) except 28f

Added by the CI agent of the pipeline optimisation (the user's goal of 2026-10-12: "optimize the pipelines, it has to
not take too much time"; the user's terms: every gate and every scenario still run on every push, no threshold lowered,
no gate skipped). The measurements behind it are in `docs/research/pipeline-baseline.md`. No GitHub Actions run exists
yet (`gh run list` is empty), so the CI times below are estimates from the laptop's measured test time, to be replaced
by the first runs (`docs/CI_PIPELINE.md` → *Expected wall time*). Verified with the workflow gates (`actionlint`,
`workflow-schema`, `workflow-timeouts`, `workflow-policy`, `action-pins`, `yamllint`, `prettier`) and
`PIPELINE_STAGE=static`. Nothing was committed or pushed.

### 28a. `ci.yml`: `tests`, `e2e` and `build` beside `static` — APPLIED (performance; nothing skipped)

`tests`, `e2e` and `build` waited for `static` (two to three minutes of gates plus the image) although they read
nothing it writes. They now need only `build-image`. The three deploy jobs, which needed `static` only through them,
name it directly (`needs: [static, tests, e2e, build, sonarqube]`), so nothing deploys unless every stage passed. The
e2e jobs, the long pole, start about four to seven minutes earlier. The cost: when `static` fails, the other stages
still run to their end (free minutes on a public repository; a pull request's next push cancels them).

### 28b. `ci.yml`: the e2e jobs split by tier and measured time — APPLIED (performance; supersedes §16a's four count shards over every tier)

§16a's four Playwright shards cut the whole run by test count: shard 4 got the tour's largest viewports and the whole
serial admin chain, 1.6 to 1.9 times the work of shards 1 and 2 (`pipeline-baseline.md` → *The four CI shards*), and
every shard started the admin server and the Firebase emulators. Still four jobs, but each now names its tiers in
`E2E_TIER` and, inside them, a count shard in `E2E_SHARD`:

| Job | `E2E_TIER` | `E2E_SHARD` | Laptop test time |
| --- | --- | --- | ---: |
| functional 1/3 | `fn` | `1/3` | about 1,010 s |
| functional 2/3 | `fn` | `2/3` | about 1,130 s |
| functional 3/3 | `fn` | `3/3` | about 1,110 s |
| admin, smoke, a11y, no-WebGL, tour | `admin,smoke,a11y,nogl,tour` | (none) | about 860 s |

Only the last job starts the emulators. The split of the tour into the per-push `tour` tier and the `tour-matrix` tier
(the rest of the full tour, run nightly and by `all`) is the e2e agent's change, logged in its own section; the four
jobs together run every tier but `tour-matrix`. The longest job drops from 2,289 s of laptop test time (shard 4) to
about 1,130 s.

### 28c. `ci.yml` `static`: carry the type-checker caches between runs — APPLIED (performance; new action `actions/cache` v6.1.0)

```yaml
            - name: Type-checker caches (restored here, saved after a green stage)
              uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
              with:
                  path: |
                      .tsbuild
                      */.tsbuild
                      */*/.tsbuild
                      */*/*/.tsbuild
                      */*/*/*/.tsbuild
                      !node_modules/**
                      reports/.cache/mypy
                      reports/.cache/mypy-pipeline
                  key: static-typecheck-${{ runner.os }}-${{ github.sha }}
                  restore-keys: static-typecheck-${{ runner.os }}-
```

Every CI job starts from a fresh checkout, so `tsc -b` type-checks everything (37.5 to 39.8 s measured, 77 s on a busy
laptop) and both mypys start cold (5 to 6 s). Measured in scratch clones on 2026-10-17: with the `.tsbuild/` folders of
an earlier build restored and every source newer than them, as after a checkout, `tsc -b` took 3.1 s, and 0.8 s after
an appended comment. It still fails where it must: a type error appended to `packages/shared/src/log.ts` was reported
(exit 2, 13.5 s), and a changed signature of `createLogger` failed every dependent project that calls it (16 errors in
10 files across `packages/shared`, `packages/engine`, `packages/admin`, `functions`, `e2e` and `scripts/site`, exit 2,
21.7 s). mypy's cache is keyed on file contents too. ESLint's cache is deliberately not carried: it keeps a file's
verdict while that file and the config are unchanged, so with the type-aware rules a file whose imported types changed
could keep a stale pass (`pipeline-baseline.md`, CR-CI-2). A pull request's caches stay in its own scope; `master`
never reads them.

### 28d. Job timeouts sized from the measurements — APPLIED (tighter: a hung job fails sooner)

`static` 30 → 20, `tests` 30 → 20, `build` 30 → 15, `e2e` 60 → 40 minutes, each about two to three times the
estimated run (the reasons are comments in `ci.yml`); `build-image` keeps 45 (a cold image build) and `sonarqube` 20.

### 28e. `.github/workflows/nightly.yml`: the full e2e matrix every night — APPLIED (new workflow; a decision for the user to see)

The counterpart of the e2e agent's per-push tour: every night at 02:37 UTC, and on demand, on `master`: the four `e2e`
jobs of `ci.yml` plus the `tour-matrix` stage that `all` adds (about 2,360 s of laptop test time) in two jobs of about
1,180 s (`E2E_SHARD` `1-2/5` and `3-5/5`), so the full tour (11 viewports × light and dark × Romanian and English) runs
at least once a day, besides before every push to `master` or a tag
(`all`). It has its own `build-image` job, which also keeps the layer cache from expiring after seven idle days, uploads
each part's Playwright report and log, and when anything fails a last job opens or updates the issue "Nightly e2e
failed" through `.github/actions/upsert-issue`, as `deps.yml` and `contract.yml` do. Permissions: `contents: read` at
the top, `checks: write` for the JUnit reports, `issues: write` only in the report job, which runs nothing but the local `upsert-issue` action.

### 28f. Proposal: skip `tests`, `e2e` and `build` for a docs-only pull request — NOT APPLIED: it would skip gates on a push, which the user's terms rule out

The optimisation brief asked for path filters, and the user's terms for the same work say every gate runs on every push.
A docs-only pull request would still run `static` (markdownlint, agent assets, skill mirrors, EditorConfig, gitleaks),
and its tests could not change outcome while no test reads Markdown, but they would not run. Pushes to `master` and
tags would always run everything, and a skipped required check counts as passed. If you want it, this is the change:

```diff
+    changes:
+        name: Docs-only pull request?
+        if: github.event_name == 'pull_request' && github.event.pull_request.draft != true
+        runs-on: ubuntu-24.04
+        timeout-minutes: 5
+        permissions:
+            contents: read
+            pull-requests: read
+        outputs:
+            docs-only: ${{ steps.files.outputs.docs-only }}
+        steps:
+            - name: List the changed files
+              id: files
+              env:
+                  GH_TOKEN: ${{ github.token }}
+                  PR: ${{ github.event.pull_request.number }}
+              run: |
+                  others="$(gh api --paginate "repos/${GITHUB_REPOSITORY}/pulls/${PR}/files" --jq '.[].filename' | grep -cvE '\.md$' || true)"
+                  if [[ "$others" == "0" ]]; then echo "docs-only=true"; else echo "docs-only=false"; fi >>"$GITHUB_OUTPUT"
+
     tests:
-        needs: build-image
+        needs: [build-image, changes]
+        if: ${{ !cancelled() && needs.build-image.result == 'success' && needs.changes.outputs.docs-only != 'true' }}
```

The same two lines go on `e2e` and `build`; `sonarqube` and the deploy jobs follow through their `needs`. On such a pull
request it saves the runner time of `tests`, `e2e` and `build` (about an hour of free runner minutes) and nothing of the
wall time, which `static` then sets.

### 28g. Information: what stays as it is, and why

- **The image transport** stays the `type=gha` layer cache that `build-image` fills and every job loads (about a minute
  by the workflow's own comment; not timed in CI yet). A `docker save` archive in `actions/cache` is the alternative to
  measure once real job timings exist.
- **`node_modules` is not cached**: the image bakes the npm cache, and `npm ci --prefer-offline` took 7 s on a fresh
  tree, less than restoring an archive of `node_modules` would take. The Playwright browsers and the Firebase emulator
  JARs are in the image.
- **Concurrency** is unchanged: superseded pull-request runs are cancelled; every push to `master` runs to its end.
- **The free-disk step** of `.github/actions/quality-image` runs in every job; its cost is unknown until a run is timed.

## 29. Pipeline optimisation: the e2e stage (e2e agent, 2026-10-17) — APPLIED 2026-10-17 (pre-approved performance changes, logged; 29a is a decision for the user to see)

Added by the e2e agent of the pipeline optimisation (the user's goal of 2026-10-12: "optimize the pipelines, it has to
not take too much time"; the user's terms: every gate and every scenario row on every push, no threshold lowered, no
gate skipped). Before: the `e2e` stage took 1052 s on the laptop and 592 s on the NUC, 861 tests
(`docs/research/pipeline-baseline.md`). After, measured on 2026-10-17 with other agents' runs loading the laptop: 283 s
split between the laptop and the NUC, 335 s on the NUC alone (`pipeline-baseline.md` → *After the e2e optimisation*).
Nothing was committed or pushed; no scenario row, spec, threshold or timeout changed.

### 29a. The per-push tour and the `tour-matrix` stage — APPLIED (a decision for the user to see)

The tour ran its seven tests in 44 projects (11 viewports × light and dark × Romanian and English) on every run, 46 to
47 % of the e2e test time, although every project carries the same three scenario tags (`S-V15-HAPPY`,
`S-V18-HAPPY`, `S-V18-HAPPY-MODAL-STATES`). Now:

| Where | Tour projects | Tests |
| --- | --- | ---: |
| tier `tour`, in `quality` and so on every push and in CI's per-push jobs | `tour-{c360,c915l,l1440,x3840}-{light,dark}-ro`, `tour-c360-light-en` (9) | 63 |
| tier `tour-matrix`, stage `tour-matrix`: in `all` (before a push to `master` or a tag) and nightly (§28e) | the other 35 | 245 |

Every scenario row still runs on every push (all seven tour tests run in the nine projects, and every other tier is
unchanged); the full matrix runs before every push to `master` or a tag and every night. The per-push tour keeps a
phone, a phone held landscape (compact height), a laptop and a 4K screen in both themes, and the phone in English, so
the English catalogue's layout is checked on every push at the narrowest of those sizes. What a push
no longer sees until `all` or the night: a layout defect that only 320, 412, 768, 1024, 1280, 1920 or 2560 px wide, or
only English at other sizes, would show. `E2E_TIER` unset now means the push tiers, `E2E_TIER=all` every tier.

`all` is `static` → `tests` → `e2e` → `tour-matrix` → `build` → `sonar`: the matrix comes before `build`, so its e2e build
is still current and `build`'s production `packages/admin/dist` is what the run leaves. To undo: drop `tour-matrix`
from `PUSH_TIERS`' exclusion in `e2e/projects.ts` (or set `E2E_TIER=all`).

### 29b. The admin tier beside the others: a Playwright lock instead of one worker per project — APPLIED (performance)

The admin projects ran with `workers: 1` and a blocking lease, last in the queue: 21 tests alone on one worker for the
last 107 s (NUC) to 122 s (laptop) of every run. They now come first in `e2e/projects.ts` and every admin spec file
declares `test.describe.configure({ lock: ADMIN_LOCK })` (Playwright 1.64's test locks): the dispatcher never starts
two admin tests at once and gives the free workers other tests meanwhile, so the chain runs on one worker from the
first minute (on the NUC it ended at test 386 of 616). The lease stays behind the lock, for two runs sharing one set of
servers. Under full load the admin tests take about twice their idle time (198 s of test time against 100 s); their
timeouts are unchanged and hold (90 s, the journey 300 s; the slowest took 28 s).

Per-worker namespacing in the emulators, as first proposed, is not possible without changing the product: the owner
(`setup/owner`), the admins and `setup/status` are singletons of the Firebase project, and the Functions emulator
serves one project, so parallel admin tests would need one emulator suite (three JVMs and 32 functions) per worker.

### 29c. Run order and `E2E_SHARD` ranges — APPLIED (performance)

The tiers run in the order `admin`, `smoke`, `a11y`, `nogl`, `tour` (largest frames first), `tour-matrix`, `fn`: long
tests first, the many short functional ones last to fill the workers (the NUC's packing went from 73 % to 89 %).
`E2E_SHARD` keeps `index/total` and adds `first-last/total`, one contiguous part of several slices, for a faster machine
that takes more: Playwright 1.64 reads shard weights only from the undocumented variable `PWTEST_SHARD_WEIGHTS`,
which `e2e/playwright.config.ts` sets from the range before the runner reads it. If a Playwright release drops it, a
range silently becomes equal slices (the two machines then finish less evenly; no test is lost or run twice, because
both sides would split alike); the pipeline skill says how to check after a bump.

### 29d. A stamped e2e build — APPLIED (performance; the gate's command changed)

`e2e-build` runs `python3 scripts/ci/e2e_build.py`, which runs the same `npm run build:site:e2e` unless its stamp
(`node_modules/.cache/hcm/e2e-build.json`) shows that no input file changed (git's blob ids of the working tree,
untracked files included, minus documentation, CI, agent assets, tests and specs) and no output was touched (names,
sizes, modification times, so the `build` stage's production admin forces a rebuild). It saves the 2.5 to 7 s build
when only specs or docs changed, and in `all`'s `tour-matrix` stage. Tested by `scripts/ci/tests/test_e2e_build.py`.

### 29e. `scripts/ci/e2e-split.sh`: the Playwright runs on two machines — APPLIED (new script; a decision for the user to see)

`PIPELINE_STAGE=<stage> bash scripts/ci/e2e-split.sh` runs the stage here as `run-all-checks.sh` does, with the tail
of every Playwright run (`E2E_SHARD=3/3`), while the NUC (`HCM_SPLIT_HOST`, default `nuc`; `HCM_SPLIT_DIR`, default
`hcm-ci`) runs the head (`1-2/3`: the admin tier and the tour) of the stage's Playwright stages from the same tree in
its own image, then merges both parts' reports and prints one verdict; the green marker stays only when both passed.
What it sends: an rsync of the working tree as git sees it (no git-ignored file, so no `.env.local`, `.sonar-token`
or `.secret.local`; no `.git`, no `node_modules`), exactly what the session helper `nuc-run.sh` sent during the
measurements. It takes a lock folder next to `HCM_SPLIT_DIR` on the NUC, and runs the stage here only when the NUC
does not answer in 5 s, lacks docker or rsync, or is busy; a connection lost mid-run has its part rerun here. It is a
local convenience: CI and the pre-push hook are unchanged (the hook still wants the green marker of `all`). Tested by
`scripts/ci/tests/test_e2e_split.py` with fake `ssh`, `rsync` and `docker`.

### 29f. Information: shorter polls tried, measured, and reverted

`expect.poll` waits 100, 250, 500 and then 1000 ms between tries; polling every 20 to 250 ms looked like a cheap win.
On the NUC's functional tier (520 tests, two runs each) it was 1749 and 1649 s of test time against 1664 and 1738 s
with Playwright's intervals: no difference, because with eight SwiftShader workers at 96 to 100 % CPU another worker
uses what a waiting one leaves. The only wait changed is `waitForEngineEvent`, now an in-page promise like `mapIdle`
(no polling, resolved by the event). The suite has no fixed sleep to remove (ESLint's Playwright rules forbid them).

### 29g. Left for the integrator — DONE 2026-10-17 (the comment by the static agent, §31d; the shares by the integrator, §32b)

- `scripts/ci/run-all-checks.sh` line 7 still says `all (quality+sonar, the default)`: edit it when no run is in
  flight anywhere (bash reads the script by offset while it runs).
- `HCM_SPLIT_PARTS`' defaults (`1:2` for `e2e` and `tour-matrix`, `1:4` for `quality` and `all`) were measured with the
  other agents' runs on the laptop; after the faster `static` and `tests` land, time `quality` once and adjust.

## 30. Pipeline optimisation: the tests stage (tests agent, 2026-10-17) — APPLIED 2026-10-17 (pre-approved performance changes, logged)

Added by the tests agent of the pipeline optimisation (the user's goal of 2026-10-12: "optimize the pipelines, it has
to not take too much time"; the user's terms: every gate and every scenario still run on every push, no threshold
lowered, no gate skipped). Every Vitest project, test file and 90 % per-file threshold, `rules-coverage`, both pytest
suites and the `coverage` gate run as before. The measurements are in `docs/research/pipeline-baseline.md` → *Addendum:
the tests stage*. Verified with `PIPELINE_STAGE=tests` and `PIPELINE_STAGE=static`. Nothing was committed or pushed.

### 30a. `package.json` `test`: two JIT compiler threads for the emulators' JVMs — APPLIED (performance)

`"test": "JAVA_TOOL_OPTIONS=-XX:CICompilerCount=2 firebase emulators:exec ..."`. On 16 hardware threads the JVM starts
12 compiler threads (3 on a 4-vCPU runner); in a run this short their C2 work was about two thirds of the Firestore
emulator's CPU (rules tests alone: 63 to 78 CPU seconds by default, 44 with two threads, 20 to 23 with C1 only). The
whole `vitest` gate, interleaved runs on the same machine: 61.9 to 65.4 s by default, 59.6 to 60.2 s with two threads,
64.0 to 64.2 s with C1 only (`-XX:TieredStopAtLevel=1`), whose slower code made the two 250 MB rule-coverage reports
take 10 s to build instead of 7 to 8. The Storage emulator relays the JVM's `Picked up JAVA_TOOL_OPTIONS` line as an
"Unexpected rules runtime error" warning at start-up (recorded in `.agent/skills/quality/pipeline_skill.md`).

### 30b. `vitest.config.ts`: four Node projects share one module graph per worker — APPLIED (performance)

`isolate: false` (`SHARED_MODULE_GRAPH`) for `shared`, `engine`, `admin` and `functions`: a worker runs file after file
without a new process and new imports (firebase-admin's among them). The one functions test file with `vi.mock`, the
composition root's (`functions/test/deps.test.ts`), runs alone in a new isolated project, `functions-deps`, whose
coverage joins the `functions` scope; a mock would otherwise leak into the next file of the worker. Worker CPU, each
project run alone with coverage: `admin` 36 to 15 s, `shared` and `engine` 19 to 13 s, `functions` 69 to 46 s. On a
4-CPU container (a GitHub-hosted runner's size) the `vitest` gate went from 101 to 112 s to 64 to 70 s with
`shared`, `engine` and `admin` shared (with 30a) and to 54 to 60 s with `functions` too: `admin`'s 56 files took 20 s
instead of 2. Checked: every file of a project in one worker in shuffled orders (functions with fresh emulators each
time), with three and with fifteen workers; all pass. `rules` and `tools` stay isolated (their time is in the
emulators and in child processes). Not a weaker gate: the same tests, coverage scope and thresholds.

### 30c. `scripts/ci/check_rules_coverage.py save`: the JSON and HTML reports fetched at once — APPLIED (performance)

Each answer is about 250 MB that the emulator builds from every evaluation of the run (2.8 to 4.9 s each); asked at
once, the save lasts as long as the slower one (in isolation 7.1 to 8.7 s one after the other, 4.0 to 5.9 s at once).
Same files, same `check`. Pinned by `test_happy_path_save_asks_for_both_reports_at_once` (a fetch that answers only
when both requests are in flight) and `test_bad_path_a_failed_report_fails_the_save`.

### 30d. `pytest.ini`, `scripts/ci/requirements.txt`: the CI tooling tests on at most four workers — APPLIED (performance; new pinned tool)

`pytest-xdist==3.8.0` (and its `execnet==2.1.2`), `--numprocesses=auto --maxprocesses=4` in `pytest.ini`: 12.4 s to
5.9 s on the laptop; one worker per core (16) took 7.8 s, each worker importing and collecting the suite. It costs about
6 CPU seconds more (10.0 against 15.9), so where the gate runs beside others (`scripts/ci/gate_runner.py`) and is not
the last to finish it saves nothing; it shortens a standalone run and any stage it ends. The pipeline's tests
(`pipeline-pytest`) stay in one process: with workers each importing GDAL they took 9.2 s against 5.4 s. Adding the pin
rebuilt the quality image once (the venv layer and everything after it). Also in
`scripts/ci/tests/test_check_rules_coverage.py`: the stand-in emulator's `serve_forever` polls every 10 ms instead of
500, so each shutdown no longer waits half a second (the two slowest steps of the suite).

### 30e. Both functions projects give every test and hook 60 s — APPLIED (robustness, not a gate change)

`EMULATOR_TIMEOUTS = { testTimeout: 60_000, hookTimeout: 60_000 }` on `functions` and `functions-deps`, replacing the
`vi.setConfig` of `functions/test/admin/world.ts` and `functions/test/publish/on-write.test.ts`: in a shared module graph
a helper's `vi.setConfig` would apply to the first file of a worker only (Vitest resets it after each file). It also
covers the three emulator-backed files that had relied on Vitest's 5 s and 10 s defaults: two `createDeps` tests and a
`beforeAll` timed out under load, the first of them again in a fresh clone of the unchanged branch (lesson 51 of
`docs/LESSONS.md`). A test's own wait budget, like the `tools` project's 30 s, not a threshold: the assertions are
unchanged; a fake that hangs fails after 60 s instead of 5.

### 30f. The rules tests seed through one rules-disabled context per file — APPLIED (performance)

`firebase/rules-tests/test/support/world.ts`: `withSecurityRulesDisabled` starts a Firebase app, and a new connection to
the emulators, for every call, and `client-writes.test.ts` alone seeds about 200 documents. The world now holds one
such call open (`holdOwner`) and seeds through its context; `world.close()` ends it and cleans up the environment (the
eleven files' `afterAll`, which called `world.env.cleanup()`). Seeding bypasses the rules either way, so the rule
coverage is the same (`rules-coverage` passes). The `rules` project alone: 10.6 to 10.8 s before, 8.6 to 9.0 s after;
in the whole run its three longest files went from 25 to 26 s to 15 to 18 s, and they are the run's last to finish.

### 30g. Information: tried and not kept

- A sequencer that starts the slowest Node projects first (`rules`, then `functions`): the Vitest run took 52.3 s
  instead of 45 to 47 s, because the `rules` files then ran beside the Chromium projects and took twice as long in sum
  (235 s against 118 s); Vitest's alphabetical project order stays.
- `pool: 'threads'` instead of child processes: more CPU (331 against 229 CPU seconds), slower.
- The browser and the Node projects as two Vitest runs side by side (merged afterwards): alone they take 8.8 s and
  25.4 s, one after the other in one run about their sum, but side by side the Node run took 36.2 s: the run is
  CPU-bound, so the browser projects' share cannot be hidden, only made smaller.
- Overlapping the emulators' start-up (about 6 s) with Vitest's own (about 3 s): it needs `emulators:start` with its own
  readiness wait and teardown instead of `emulators:exec`; left for later.
- Not saving the HTML rule-coverage report (250 MB that no gate reads): kept, it is a documented report, and fetched
  beside the JSON it adds little time.

## 31. Pipeline optimisation: the `static` stage and the gate engine (static agent, 2026-10-17) — APPLIED 2026-10-17 (pre-approved performance changes, logged) except 31f (31e applied by the integrator, §32a)

Added by the static agent of the pipeline optimisation (the user's goal of 2026-10-12: "optimize the pipelines, it has
to not take too much time"; the user's terms: every gate and every scenario still run on every push, no threshold
lowered, no gate skipped). Every gate of every stage still runs with the same tool, rules and files; only when and how
many at once changed. The measurements are in `docs/research/pipeline-baseline.md` → *Addendum: the `static` stage and
the gate engine*. Nothing was committed or pushed.

### 31a. The gates of a stage run at the same time — APPLIED (performance; a decision for the user to see)

`scripts/ci/pipeline.py` hands each stage to the new `scripts/ci/gate_runner.py`, which runs up to `PIPELINE_JOBS`
gates at once (default: the CPUs the container may use; `PIPELINE_JOBS=1` is the old one-at-a-time run). A gate that
reads another gate's output waits for it (`Gate.needs`: `rules-coverage` and `coverage` after the test runners,
`bundle-budget` and `site-build` after `vite-build`, both Playwright gates after `e2e-build`), and a gate that saturates
the machine or binds fixed ports runs alone (`Gate.exclusive`: `playwright`, `playwright-tour-matrix`). The log still
reads like a serial run: each gate's output is one block in registry order, announced and closed as before
(`static 12/51 eslint` … `eslint passed in 48.2s`, the gate's own run time), the earliest unfinished gate shown live,
then a line such as `static finished in 48.2s (gate time 141.5s, 51 gates, up to 16 at once)`. Every gate runs after a
failure, and failures are listed in registry order whichever finished first; a gate whose own code raises is reported
as failed (exit 70, with its traceback) instead of hanging the run. `validate_registry()` refuses a need that names no
gate or comes after its gate in a stage. Gates of a stage write only git-ignored paths that `.gitleaks.toml` allowlists,
so `gitleaks dir .` can walk the tree meanwhile. Pinned by `scripts/ci/tests/test_gate_runner.py` (concurrency, the
job limit, needs, exclusive gates, ordered blocks, a raising task) and `test_pipeline_stages.py`; 100 % branch
coverage.

### 31b. A gate runs once per run — APPLIED (performance; a decision for the user to see)

`pytest` is listed in `static` (a tooling-only change is gated by `static` alone) and in `tests` (its report feeds the
`coverage` gate); `e2e-matrix` in `static`, `e2e` and `tour-matrix`; `e2e-build` in `e2e` and `tour-matrix`. In one run
of `quality` or `all`, a later stage reuses the outcome of the same gate on the same tree and says so:
`pytest passed in stage 'static' of this run (8.2s); not run again`. A reused failure is a failure again, listed under
both stages (`static/pytest, tests/pytest`). Each stage run on its own still runs all its gates, so CI's separate
`tests` job still runs `pytest`.

### 31c. `package.json`: ESLint's worker threads, Prettier's and stylelint's caches — APPLIED (performance)

```diff
-        "format:check": "prettier --check .",
-        "lint": "eslint --max-warnings 0 --no-inline-config --report-unused-disable-directives-severity error .",
-        "lint:css": "stylelint --max-warnings 0 --report-needless-disables ...",
+        "format:check": "prettier --check --cache --cache-location reports/.cache/prettier/cache.json .",
+        "lint": "eslint --concurrency=$(( $(nproc) / 4 > 2 ? $(nproc) / 4 : 2 )) --max-warnings 0 --no-inline-config --report-unused-disable-directives-severity error .",
+        "lint:css": "stylelint --cache --cache-location reports/.cache/stylelint/ --cache-strategy content --max-warnings 0 --report-needless-disables ...",
```

- **ESLint's worker threads**: a quarter of the CPUs, at least two (4 on the laptop and the NUC, 2 on a 4-vCPU runner).
  Each worker builds its own typed program, so the CPU cost grows fast; measured on the laptop with the same exit
  status every time: one thread 86.8 s (136 CPU seconds), two 59.7 s (174), four 45.0 s (256), eight 69.2 s (721).
  ESLint's own `auto` would take half the CPUs (eight here), the slowest of the four beside the other gates.
- **Prettier's cache** (content strategy): a file is cached only after Prettier found it formatted, keyed on its
  content, the resolved options and Prettier's version; 11 to 12 CPU seconds instead of 45 on a busy laptop.
- **stylelint's cache** (content strategy): stylelint 17 caches a file only when its result has no problem at all, the
  disable-comment reports (`--report-needless-disables` and the others) included, since it computes them while it lints
  the file (`lib/lintSource.mjs`); keyed on the content, the resolved config and stylelint's version.
- **Not ESLint's `--cache`**: it keys a file on its own content and config while the type-aware rules read the types of
  other files, so a file whose imported types changed would keep a stale pass (CI carries none either, §28c).
- **Already incremental, unchanged**: `tsc -b` (`.tsbuild/`), mypy and the pipeline's mypy (`reports/.cache/mypy*`),
  ruff (`.ruff_cache/`, 0.1 s), and `npm ci` (only when `node_modules/.hcm-install-stamp` is stale).

### 31d. `scripts/ci/run-all-checks.sh`: `PIPELINE_JOBS` forwarded, the stage comment updated — APPLIED

`--env PIPELINE_JOBS` (by name, like every other variable), and the header comment lists `tour-matrix` and what `all`
now runs (CR-E2E-1). Replaced atomically (a new file moved over the old one), so a run in flight kept its copy.

### 31e. Proposal: the image's npm layer keyed on the dependencies only — APPLIED 2026-10-17 by the integrator, once no agent was mid-run (§32a)

`docker/Dockerfile.quality` copies every `package.json` before the `npm ci` layer, so any npm script edit (§30a, §31c)
rebuilds the npm, Playwright and emulator layers: 245 to 297 s on the laptop, and a cold layer in CI. A manifests stage
that drops the `scripts` (keeping `emulators:setup`, which the layer runs) keys the layer on the dependency fields:

```diff
+FROM node AS manifests
+WORKDIR /m
+COPY package.json package-lock.json .npmrc ./
+COPY packages/shared/package.json packages/shared/
+COPY packages/ui/package.json packages/ui/
+COPY packages/engine/package.json packages/engine/
+COPY packages/admin/package.json packages/admin/
+COPY packages/test-support/package.json packages/test-support/
+COPY functions/package.json functions/
+COPY firebase/rules-tests/package.json firebase/rules-tests/
+COPY e2e/package.json e2e/
+RUN node -e "const fs = require('node:fs'); for (const f of process.argv.slice(1)) { const p = JSON.parse(fs.readFileSync(f, 'utf8')); const keep = p.scripts?.['emulators:setup']; delete p.scripts; if (keep) p.scripts = { 'emulators:setup': keep }; fs.writeFileSync(f, JSON.stringify(p, null, 4) + '\n'); }" \
+    package.json packages/*/package.json functions/package.json firebase/rules-tests/package.json e2e/package.json
 ...
 WORKDIR /opt/hcm/workspace
-COPY package.json package-lock.json .npmrc ./
+COPY --from=manifests /m/ ./
 COPY vendor/npm/braces vendor/npm/braces
-COPY packages/shared/package.json packages/shared/
-... (the other workspace manifests)
```

The pipeline's own `npm ci` still installs from the real manifests at run time; the layer only fills the npm cache, the
browsers and the emulator JARs. Verify: `bash scripts/ci/build-and-test.sh` twice with only an npm script changed in
between (the second build reuses the npm layer), then `PIPELINE_STAGE=all`.

### 31f. Proposal: two costly ESLint rules that cannot add a finding here — NOT APPLIED: it changes which rules run; for the user to decide

ESLint is the longest gate of `static`. The Measure agent's rule timings (`TIMING=25`, NUC) put
`sonarjs/deprecation` first (11.9 s, 18.7 % of the rule time), although `@typescript-eslint/no-deprecated` (1.4 s,
also on) reports the same deprecated APIs from the same type information, and `sonarjs/aws-restricted-ip-admin-access`
third (5.7 s, 9 %), a rule for AWS CDK security groups in a repository without AWS code. Turning both off in
`eslint.config.js` would take about a quarter of ESLint's rule time:

```diff
+            // Covered by @typescript-eslint/no-deprecated; AWS CDK rules have nothing to inspect here.
+            'sonarjs/deprecation': 'off',
+            'sonarjs/aws-restricted-ip-admin-access': 'off',
```

Verify: `PIPELINE_STAGE=static`, and a deliberate call of a `@deprecated` function still fails `eslint`.

## 32. Pipeline optimisation: the integration (integrator, 2026-10-17) — APPLIED 2026-10-17 (pre-approved performance changes and fixes, logged) except 32f; 32d is a decision for the user to see

Added by the integrator of the pipeline optimisation (the user's goal of 2026-10-12: "optimize the pipelines, it has
to not take too much time"; the user's terms: every gate and every scenario row on every push, no threshold lowered, no
gate skipped). §28 to §31 touched different files except `scripts/ci/pipeline.py`, `package.json`, the pipeline skill
and the shared docs; the static agent had already merged the e2e agent's `tour-matrix` stage into the gate engine's
registry, and no area's edit undid another's, so combining them took no code change. The measurements are in
`docs/research/pipeline-baseline.md` → *Addendum: the integrated pipeline*. Nothing was committed, pushed or deployed.

### 32a. `docker/Dockerfile.quality`: the npm layer keyed on the dependencies only (§31e) — APPLIED (performance)

As §31e proposed, with the JavaScript spread over continuation lines (140 columns) and without a final newline in the
rewritten manifests (only their content keys the cache):

```dockerfile
FROM node AS manifests
WORKDIR /m
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
# ... every other workspace manifest, as the npm layer copied them before
RUN node -e "const fs = require('node:fs'); \
        for (const file of process.argv.slice(1)) { \
            const manifest = JSON.parse(fs.readFileSync(file, 'utf8')); \
            const setup = manifest.scripts?.['emulators:setup']; \
            delete manifest.scripts; \
            if (setup) { manifest.scripts = { 'emulators:setup': setup }; } \
            fs.writeFileSync(file, JSON.stringify(manifest, null, 4)); \
        }" \
        package.json packages/*/package.json functions/package.json firebase/rules-tests/package.json e2e/package.json

# in the quality stage, instead of the ten COPY lines of the manifests:
COPY --from=manifests /m/ ./
COPY vendor/npm/braces vendor/npm/braces
```

Verified on 2026-10-17: applying it rebuilt the image once, 205 s on the laptop and 216 s on the NUC (both at once);
then a build context whose `package.json` differed only in a script (`lint:md` with one more flag) built in 2 s with
the `npm ci` layer `CACHED`, where any script edit had cost 245 to 297 s (§30a and §31c each paid it, on every
machine). The pipeline's own `npm ci` still installs from the real manifests at run time. No manifest has an install
lifecycle script (`preinstall`, `install`, `postinstall`, `prepare`); one added later must be kept in that stage like
`emulators:setup`. A new workspace's `COPY` line goes into the `manifests` stage. `hadolint` and `repo-policy` (a
`FROM` of an earlier stage needs no digest) pass in `static`.

### 32b. `scripts/ci/e2e-split.sh`: default shares from measurements — APPLIED (performance)

`default_parts` is now `2:3` for `e2e` and `tour-matrix` and `1:2` for `quality` and `all` (before: `1:2`, and `1:4`
for `quality` and `all`, chosen while the other agents' stages loaded the laptop). Measured with the laptop otherwise idle
and the NUC running the user's own containers:

| Stage | Shares | The laptop's part | The NUC's part | Stage wall clock |
| --- | --- | --- | --- | ---: |
| `e2e` | `1:2` | 205 tests, done at 187 s | 412 tests, done at 315 s | 317 s |
| `e2e` | `2:3` | 246 tests, done at 209 s | 371 tests, done at 304 s | 306 s |
| `quality` | `1:2` | `static` 46 s, `tests` 46 s, its e2e part 174 s, `build` 3 s: done at 273 s | 412 tests, done at 321 s | 324 s |
| `tour-matrix`, inside `all` | `1:2` | 82 tests in 1.5 min | 165 tests in 2.3 min | (about 145 s of `all`) |
| `tour-matrix` | `2:3` | 99 tests, done at 116 s | 148 tests, done at 130 s | 133 s |
| `all` | `1:2` | `static`, `tests`, its two Playwright parts, `build`: done at 357 s | `e2e` 1-2/3, then `tour-matrix` 1-2/3: done at 393 s | 398 s |

Both e2e splits end with the NUC's part, which ends with the admin chain (§32f): giving the laptop 41 more functional
tests cut the NUC's part by only 11 s. In `quality` the laptop runs `static` and `tests` first (92 s), so it takes a
third of the e2e tests, not a fifth: `1:4` would have moved about 80 tests onto the NUC's part, already the longer one.
Pinned by `test_happy_path_each_stage_splits_by_its_measured_default` and the updated cases of
`scripts/ci/tests/test_e2e_split.py`. `HCM_SPLIT_PARTS` still overrides it, for a busier or idler NUC.

### 32c. `.github/workflows/nightly.yml`: upload the `tour-matrix` parts' reports — APPLIED (a fix: they were never uploaded)

The two `tour-matrix` jobs write `reports/playwright-tour-matrix/` and `reports/test-results-tour-matrix/`
(`e2e/playwright.config.ts`), but the upload step named only `reports/playwright/` and `reports/test-results/`, so a
failed night of the tour matrix would have left no report and no trace to download:

```diff
                   path: |
-                      reports/playwright/
-                      reports/test-results/
+                      reports/playwright*/
+                      reports/test-results*/
```

Verified with the workflow gates of `static` (`actionlint`, `workflow-schema`, `workflow-timeouts`, `workflow-policy`,
`action-pins`, `yamllint`, `prettier`).

### 32d. The tour tiering, for the user to see — APPLIED (as §29a and §28e decided)

The one change of the optimisation that moves work out of the per-push run, gathered here so it can be judged in one
place:

| Run | e2e tiers | Tour projects | Every scenario row |
| --- | --- | ---: | --- |
| every push and pull request (`ci.yml`), the local `quality` | `admin`, `smoke`, `a11y`, `nogl`, `tour`, `fn` | 9 of 44 | yes |
| the local `all`, before every push to `master` or a tag (the pre-push hook wants its green marker) | the same plus `tour-matrix` | 44 | yes |
| `nightly.yml`, every day on `master` | the same plus `tour-matrix` | 44 | yes |

- **What moved**: 35 tour projects (245 tests, about 2,360 s of laptop test time) that repeat the tour's seven tests at
  other viewport, theme and language combinations. Their scenario rows (`S-V15-HAPPY`, `S-V18-HAPPY`,
  `S-V18-HAPPY-MODAL-STATES`) still run on every push in the nine kept projects (`tour-{c360,c915l,l1440,x3840}` in
  light and dark, Romanian, and `tour-c360-light-en`); no gate, threshold, test or row was dropped.
- **What a push no longer catches before `all` or the night**: a layout defect that only 320, 412, 768, 1024, 1280,
  1920 or 2560 px, or English at a size other than 360 px, would show.
- **What it saves**: the per-push e2e run went from 861 to 616 tests; split with the NUC the `tour-matrix` stage takes
  133 s on its own and about 145 s inside `all`, and nothing in CI's per-push run.
- **To undo**: remove `tour-matrix` from the exclusion that defines `PUSH_TIERS` in `e2e/projects.ts` (every run then
  takes every tier), or set `E2E_TIER=all` where one run should.

### 32e. `.gitignore`: `.hypothesis/` — APPLIED (a fix: `static` failed in a copied tree)

Hypothesis writes `.hypothesis/.gitignore` (`*`) only when it creates the folder itself. rsync with
`--filter=':- .gitignore'` (`scripts/ci/e2e-split.sh`, the session's NUC helper, and the integrator's scratch copy)
copies that folder empty, without the file; in the copy, `pipeline-pytest` then wrote its constants cache into a folder
nothing ignored, and the next `static` failed `editorconfig` on eleven of its files (`docs/LESSONS.md` #52). The root
`.gitignore` now names `.hypothesis/` under *Python*; the original checkout, whose folder kept Hypothesis's own file,
never showed it.

### 32f. Proposal: the admin tier split between the two machines — NOT APPLIED: it needs a second way to split, for later

The admin tier's 22 tests run one at a time (the emulators' owner and setup records are per Firebase project, §29b)
and sit at the head of the queue, so a split puts all of them into the NUC's part, where they ran 238 to 259 s of
test time under full load and finished last in every split run. That chain is now the floor of a split `e2e`. Each
machine starts its own emulators, so each could run half of the chain (two of the four admin viewport projects, each
with its own owner's journey): about 130 s each, and an `e2e` stage of about 230 s instead of 306 s. It needs a
selection that is not one contiguous queue slice (for example `E2E_ADMIN_PART=1/2` read by `e2e/projects.ts`, beside the
count shard of the other tiers) and a split script that passes both; not worth the extra moving part until the e2e
stage grows again.

### 32g. Information: what stays open

- §31f (two costly ESLint rules) and §28f (a docs-only path filter) wait for the user.
- CR-TESTS-2: the e2e emulators run without the two-JIT-thread flag of `npm test`; it was measured only for the
  one-minute `vitest` gate and is left until measured in a ten-minute run.
- No GitHub Actions run of the new workflows exists yet; `docs/CI_PIPELINE.md` → *Expected wall time* holds
  estimates, now with `static` and `tests` measured on a 4-CPU container.
