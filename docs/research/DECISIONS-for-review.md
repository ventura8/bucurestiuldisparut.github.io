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

### 18b. Subresource Integrity for the swipe-compare plugin (M4) — SUPERSEDED 2026-10-24: the user decided on an own swipe compare, no plugin to load (§52a)

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

## 28. Pipeline optimisation: the CI workflows (ci agent, 2026-10-17) — APPLIED 2026-10-17 (pre-approved performance changes, logged); 28f APPLIED 2026-10-17 (user approved in chat)

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

### 28f. Proposal: skip `tests`, `e2e` and `build` for a docs-only pull request — APPLIED 2026-10-17 (user approved in chat)

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

**As applied (2026-10-17, the user approved in chat).** The `needs` and `if` lines above went on `tests`, `e2e` (all
four parts) and `build` as proposed; `sonarqube` and the deploy jobs are unchanged. Three changes to the `changes` job,
each so that only a pull request whose files are all Markdown skips anything:

- **It runs on every event but a draft** (`if: github.event.pull_request.draft != true`, like `build-image`) and
  answers `docs-only=false` at once outside a pull request. Skipped on a push, it would have skipped `sonarqube` and the
  three deploy jobs: a skipped job skips every later job in its chain whose `if` has no status function, even through
  a job that ran (`tests` runs on `!cancelled()`, `sonarqube` has none).
- **A failed listing fails the step.** In the proposal, `gh api ... | grep -cv ... || true` counted the empty output
  of a failed call as zero other files and answered `true`, skipping every test on an API error. The listing is now its
  own assignment, which fails the step under the runner's `bash -e`; the output stays unset and `tests`, `e2e` and
  `build` run (their `!cancelled()` keeps them going after a failed `changes`).
- **A rename counts its old path too** (`--jq '.[] | .filename, (.previous_filename // empty)'`), so moving `a.ts` to
  `a.md` is not docs-only.

Checked: the step script with a stand-in `gh` gave `false` on a push, `true` for Markdown files only and for a
Markdown-to-Markdown rename, `false` for a mixed list, a `.ts`-to-`.md` rename and an empty list, and failed with no
output on an API error. No Vitest, Playwright, pytest or build input reads a Markdown file (searched 2026-10-17; the
Markdown checks are all in `static`). `actionlint` (with shellcheck), `workflow-schema`, `workflow-timeouts`,
`workflow-policy`, `action-pins`, `yamllint --strict` and `prettier --check` pass in the quality image.

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

## 31. Pipeline optimisation: the `static` stage and the gate engine (static agent, 2026-10-17) — APPLIED 2026-10-17 (pre-approved performance changes, logged; 31e applied by the integrator, §32a); 31f APPLIED 2026-10-17 (user approved in chat)

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

### 31f. Proposal: two costly ESLint rules that cannot add a finding here — APPLIED 2026-10-17 (user approved in chat)

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

**As applied (2026-10-17, the user approved in chat).** The two lines and the comment are in the shared `rules` block
of `eslint.config.js`, after `sonarjs.configs.recommended`. `eslint --print-config` shows `@typescript-eslint/no-deprecated`
at `error` and both sonarjs rules `off` for product code, tests and `e2e/`; on plain JavaScript configs
`sonarjs/deprecation` never ran (it needs type information, which `disableTypeChecked` removes there). Checked in the
quality image: `npm run lint` exits 0 in 41.4 s with neither rule in the timing table; a throwaway
`packages/shared/src/zz-deprecation-probe.ts` calling a `@deprecated` function failed with
`` `probeOld` is deprecated. Use {@link probeNew}  @typescript-eslint/no-deprecated `` (exit 1) and was deleted. The full
`static` stage was not run here (another workflow was working in the same tree).

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

### 32f. Proposal: the admin tier split between the two machines — APPLIED 2026-10-17 (pre-approved performance change; §33a)

The admin tier's 22 tests run one at a time (the emulators' owner and setup records are per Firebase project, §29b)
and sit at the head of the queue, so a split puts all of them into the NUC's part, where they ran 238 to 259 s of
test time under full load and finished last in every split run. That chain is now the floor of a split `e2e`. Each
machine starts its own emulators, so each could run half of the chain (two of the four admin viewport projects, each
with its own owner's journey): about 130 s each, and an `e2e` stage of about 230 s instead of 306 s. It needs a
selection that is not one contiguous queue slice (for example `E2E_ADMIN_PART=1/2` read by `e2e/projects.ts`, beside the
count shard of the other tiers) and a split script that passes both; not worth the extra moving part until the e2e
stage grows again.

### 32g. Information: what stays open

- §31f (two costly ESLint rules) and §28f (a docs-only path filter): applied on 2026-10-17 after the user approved them in chat.
- CR-TESTS-2: the e2e emulators run without the two-JIT-thread flag of `npm test`; it was measured only for the
  one-minute `vitest` gate and is left until measured in a ten-minute run.
- No GitHub Actions run of the new workflows exists yet; `docs/CI_PIPELINE.md` → *Expected wall time* holds
  estimates, now with `static` and `tests` measured on a 4-CPU container.

## 33. Layout and accessibility invariants (the invariants agent, 2026-10-17) — APPLIED 2026-10-17 (pre-approved gate-tightening and performance changes, logged)

The user's request of 2026-10-12: "in the phone screens the menu button sometimes overlaps with other elements. we
should have tests for overlapping elements!!! also for accessibility!!". The tour checked the overlap of a few
`[data-layout-check]` boxes on some states only, and missed the FAB's collisions elsewhere. What changed, the config
edits among it logged here (each tightens a gate or keeps a tool working; none relaxes one); nothing was committed,
pushed or deployed, and no product code changed: the violations the new checks find are listed in
`docs/research/layout-a11y-findings.md` for the next task to fix.

### 33a. The admin tier split between the machines (§32f) — APPLIED (performance)

- `e2e/split.ts` (pure, unit-tested in `e2e/test/split.test.ts`): `E2E_ADMIN_PART=i/n` (or `first-last/n`) keeps
  those parts of the admin test projects, dealt round robin in the order `admin-c360-ro`, `admin-m768-ro`,
  `admin-l1440-ro`, `admin-l1440-en`, `admin-harness` (`e2e/projects.ts`). `admin-setup` runs wherever an admin
  project does.
- With `E2E_SHARD` set as well, `e2e/split-reporter.ts` (registered by `e2e/playwright.config.ts` only then) uses
  Playwright 1.64's `Reporter.preprocess`: `testRun.skipSharding()`, then `testRun.exclude()` of the tests of every
  tier but the admin tier and the dependency projects that lie outside the `E2E_SHARD` range of that queue. Playwright's
  own shard counts every test, so each machine's admin projects would move the other tiers' boundaries; without the
  admin tests in the count both machines see the same queue and their slices meet exactly. Without `E2E_ADMIN_PART`
  nothing changes (CI's matrix, a single machine).
- `scripts/ci/e2e-split.sh` runs `E2E_ADMIN_PART=1-2/3` on the NUC (`admin-c360-ro`, `admin-l1440-en`,
  `admin-m768-ro`, `admin-harness`) and `3/3` here (`admin-l1440-ro`), also for the fallback that reruns a dropped
  NUC's part here. Halves (`1/2`, `2/2`) were measured first: with the state checks of §33b this machine's two
  journeys (about 2.5 minutes each beside the functional tests) ended the stage at 560 s while the NUC was done at
  379 s, so the NUC, about twice as fast, takes three of the four journeys; `scripts/ci/run-all-checks.sh` forwards `E2E_ADMIN_PART` by name. Pinned by
  `scripts/ci/tests/test_e2e_split.py`.
- Measured before the checkers of §33b: a split `e2e` in 275 s (the NUC's part done at 220 s, this machine's at
  272 s) against 306 s with the whole admin chain on the NUC. With the checkers: 560 s with halves, 453 s with
  `1-2/3` : `3/3` (this machine done at 386 s, the NUC at 413 s).

### 33b. The generic checkers and the state inventory — APPLIED (gate-tightening)

- `assertLayoutSound` (`e2e/support/layout.ts`) and `assertAccessible` (`e2e/support/a11y.ts`) run on every state of
  `e2e/tour/states.ts` (the viewer's 30 states at every tour project; the admin's 15 states in the journey and the
  smoke at its four projects) and in the a11y specials; `docs/TESTING.md` → *The tour's checkers* lists every check.
  The checks are soft assertions: a test still fails on any violation, and one run reports them all.
- Axe in `assertAccessible` adds `wcag21a` and `best-practice` to the fixture's tags (the functional specs keep the
  fixture's set).
- Scenario rows: `S-V15-HAPPY` refined; new `S-V14-HAPPY-EVERY-STATE`, `S-V15-BAD-TEXT-SPACING`, `S-V15-BAD-REFLOW-320`;
  `S-V14-HAPPY-TOAST-ANNOUNCED` now exists (the live-region recorder `e2e/support/live-regions.ts`); behaviour A31
  (admin layout and accessibility) with `S-A31-HAPPY` and `S-A31-BAD-ALERTS`; `S-A29-BAD-UNKNOWN-ROUTE` now exists.
- One sanctioned stacking: the open FAB menu may cover what lies beneath it (`SANCTIONED_STACKINGS`).

### 33c. Config edits — APPLIED (they add a gate or keep the tools working)

- `vitest.config.ts`: a new project `e2e-support` (Chromium) runs `e2e/test/**/*.test.ts`, and its `coverage` lists
  the checkers' modules and `e2e/split.ts`, so the 90 % per-file thresholds hold them (Sonar counts `e2e/` as tests,
  so `scripts/ci/check_coverage.py` skips them; Vitest's own per-file thresholds are the gate).
- `eslint.config.js`: `e2e/test/**/*.ts` joins the Vitest file set (`TESTS`, the Vitest rules) and leaves the
  Playwright block (`ignores`), whose rules would read Vitest's `test` as a Playwright test.
- `e2e/tsconfig.json`: includes `split.ts`, `split-reporter.ts` and `test/`.
- `e2e/projects.ts`: the tour's test timeout from 120 s to 240 s (up to seven states per test, each through both
  checkers; a 3840 × 2160 journey took about 90 to 130 s on a loaded laptop). A longer timeout lowers no bar.

### 33d. Test fixes — APPLIED (a flaky race, not a product change)

- `e2e/admin/specs/journey.spec.ts`: the USGS countdown assertion read one exact second (`60`, then `55` after a 5 s
  jump) of a clock the spec keeps running for the Firebase SDK; under load it saw 54 and failed. It now asserts the
  jump took at least five seconds off and the 60 s window is still open (`docs/LESSONS.md` #54).
- `e2e/admin/specs/smoke.spec.ts`: a heading lookup that matched the list and the detail pane of the l1440 Setup
  page takes the first.

### 33e. `.github/workflows/ci.yml` and `nightly.yml`: the e2e matrices rebalanced — APPLIED (keeps the jobs within their timeouts)

Every tour state now runs both generic checkers: in the full run of 2026-10-17 the per-push tour took 1,192 s and the
tour matrix 4,038 s of the NUC's test time (about twice that on the laptop), against about 600 and 2,360 s of laptop
time before; the admin tier took 755 s with its state checks. The job that carried the admin, smoke, a11y, no-WebGL
and tour tiers (about 860 s before, 40-minute timeout) would carry about 3,200 s of laptop time, and each of the
nightly's two `tour-matrix` jobs about 4,000 s (45-minute timeout), both past their timeouts on a 4-vCPU runner with
Playwright's two workers. No tier, test or row moves:

```diff
-                    - part: admin, smoke, a11y, no-WebGL, tour
-                      tier: admin,smoke,a11y,nogl,tour
-                      shard: ''
+                    - part: tour 1/2
+                      tier: tour
+                      shard: 1/2
+                    - part: tour 2/2
+                      tier: tour
+                      shard: 2/2
+                    - part: admin, smoke, a11y, no-WebGL
+                      tier: admin,smoke,a11y,nogl
+                      shard: ''
```

The same in `nightly.yml`'s `e2e` jobs, and its `tour-matrix` stage in six count shards (`1/6` to `6/6`) instead of
`1-2/5` and `3-5/5`; the first shard (the 2560 and 3840 px frames) is the heaviest, at about 2,400 s of laptop time.
Verified with the workflow gates of `static` (`actionlint`, `workflow-schema`, `workflow-timeouts`,
`workflow-policy`, `action-pins`, `yamllint`, `prettier`). Retime from the first GitHub Actions runs.

### 33f. The admin's shell becomes an app shell — APPLIED (a product fix of the findings, for the user to see)

The admin agent's fixes of the admin's rows of `layout-a11y-findings.md` (its addendum lists them all). One changes how
the admin feels, so it is set out here: on every window the shell is now as tall as the window and only the page
scrolls (`.scroller` inside `<main>`), so the navigation bar, the rail and the top app bar keep their own places and no
content ever scrolls under them. Before, the document scrolled under the sticky bar at 360 px: a focused Setup header,
link, field or switch ended hidden under it (WCAG 2.4.11), axe found headers half covered (`target-size`), and at
1440 px the account button scrolled away with the top bar. The snackbar is docked below the page (it takes no room while
empty) instead of floating over it, where it hid the focused control too. The bar's More sheet now covers the window
(it covered only the bar, whose sticky host was its containing block).

The alternative was to keep the page scrolling and add `scroll-padding` for the bar: the focused control would clear it,
but whatever the page is scrolled to still lies under the bar (axe flags a target half under it), and the snackbar
would still cover the page. The cost of the app shell: a phone's address bar no longer hides as the page scrolls, and
Space or Page Down scroll the page only once it was clicked or something in it has the focus (as in the Google Cloud
console). Verified by
the admin tier at its four projects and `packages/ui/test/admin/shell/shell-layout.test.ts`.

### 33g. The verify pass: stricter checkers and a dark admin project — APPLIED (gate-tightening, logged)

The verify agent of 2026-10-17 resolved the open change request LA-6 and ran the visual audit the checks could not
replace (`docs/research/layout-a11y-findings.md` → *Addendum 2026-10-17: verify and visual audit*). No lint or tool
configuration changed; these make the existing gates stricter:

- **Touch targets are hit-tested** (`targetSizeOf`, `e2e/support/layout-probe.ts`): the kit's 48 px `touch-target`
  ring counts only as far as a pointer reaches the control (each side hit-tested at its middle; a side off screen or
  scrolled out of its list counts as computed). It read the pseudo-element's computed 48 px, which stays 48 px when an
  `overflow: hidden` cuts it (LA-6).
- **The open FAB menu's sanction is narrowed** (`SANCTIONED_STACKINGS`, `e2e/support/layout.ts`): it may cover the
  map's content and the two top docks it is designed to grow over (the consent banner, the toast), no longer any chrome
  (`under: '*'`). The audit found its last item on the timeline's thumb at 768 px.
- **No box scrolls sideways** (`sideways-scroll`, `e2e/support/layout-rules.ts`): every scroller of the page, not only
  the page, is checked for content wider than it (WCAG 1.4.10). The audit found a dialog's theme choice past its edge.
- **A focus ring must not be cut off** (`ringCutBy`, `e2e/support/a11y-probe.ts`): the Tab round reports a ring whose
  outline box leaves an ancestor that hides its overflow without scrolling. It found the map's ring cut away whole.
- **The admin runs in the dark scheme too**: the project `admin-l1440-dark` (`e2e/projects.ts`), dealt to part 1 of a
  split run (the NUC). It adds one admin journey and smoke, about 150 s of laptop test time, to the chain of CI's job
  "admin, smoke, a11y, no-WebGL" (40-minute timeout; about 760 s of admin test time before). Retime that job from its
  first GitHub Actions run.

The state screenshots behind the audit are `HCM_STATE_SCREENSHOTS` (`e2e/support/state-shots.ts`), off by default.

## 34. M2c admin editors (contracts agent, 2026-10-17) — PROPOSED

What the M2c contract (`docs/research/M2c-interfaces.md`) needs from files the workstreams may not change on their own,
and three product decisions for the user to see. Nothing here is applied yet: 34a is of the pre-approved kind (stricter or
equal) and is applied, verified and logged by the pois workstream in the change that moves the map; 34b and 34c change
what a gate measures or how long CI runs, so they wait for the user's answer.

### 34a. `.dependency-cruiser.cjs`: the map's new home and the draw library — APPLIED (2026-10-17, pois workstream; pre-approved kind: stricter or equal); its proposal (drop the empty `engine-browser` project) APPLIED 2026-10-18 (orchestrator decision)

The admin may not import the engine (`engine-and-admin-independent`), so `packages/engine/src/map/` moves to
`packages/ui/src/map/` (M2c-interfaces CR-M2c-1). The rule that guards Mapbox GL follows the file, and two new rules keep
Terra Draw out of the viewer and in one module:

```diff
         {
             name: 'only-the-map-adapter-imports-mapbox',
             severity: 'error',
-            comment: 'Mapbox GL is reached only through engine/src/map/mapbox-adapter.ts (MapPort), so the core is testable with FakeMap.',
-            from: { pathNot: '^packages/engine/src/map/mapbox-adapter\\.ts$' },
+            comment: 'Mapbox GL is reached only through ui/src/map/mapbox-adapter.ts (MapPort), so the core is testable with FakeMap.',
+            from: { pathNot: '^packages/ui/src/map/mapbox-adapter\\.ts$' },
             to: { path: 'node_modules/mapbox-gl/' },
         },
+        {
+            name: 'only-the-draw-adapter-imports-terra-draw',
+            severity: 'error',
+            comment: 'Terra Draw is reached only through ui/src/map/draw/terra-draw-adapter.ts (MapDrawPort, M2c-interfaces §4).',
+            from: { pathNot: '^packages/ui/src/map/draw/terra-draw-adapter\\.ts$' },
+            to: { path: 'node_modules/terra-draw' },
+        },
+        {
+            name: 'viewer-never-loads-the-draw-tools',
+            severity: 'error',
+            comment: 'The public viewer never ships the admin drawing tools.',
+            from: { path: ['^packages/engine/', '^packages/ui/src/(viewer|components|layout|theme|fonts)/'] },
+            to: { path: ['^packages/ui/src/map/draw/', 'node_modules/terra-draw'] },
+        },
```

Verify: `PIPELINE_STAGE=static` (the `dependency-cruiser` gate) after the move.

Applied by the pois workstream with the move (CR-M2c-1, 2026-10-17), exactly as the diff above: `npm run lint:deps` in the
quality image reports no violation (1060 modules). The move left the `engine-browser` project of `vitest.config.ts` without
a file (its one test, `adapter-env.test.ts`, now runs in the `ui` project, which is Chromium too); Vitest runs an empty
project without failing, so the config stays as it is. **Proposal** (ask-first file, not applied): drop that project and
the `engine` project's `exclude` of `packages/engine/test/browser/**` in the next change to `vitest.config.ts`.

### 34b. The admin page loads the ES module build — APPLIED 2026-10-18 (user approved 2026-10-18; §41a)

The admin page loads `admin.iife.js`, and an IIFE build inlines every dynamic import (§13a's finding for the engine), so
each M2c page and Terra Draw would sit in the one file the budget measures (311 KB gzip of 450 on 2026-10-17, before
M2c). Proposal: the admin page (`scripts/site/src/admin/page.ts`) loads `admin.mjs` as a module script, which already
splits lazy chunks (the analytics SDK is one today); each area's page and the draw library become chunks loaded when
their route opens; the build is minified like the engine's (§17a). `scripts/ci/check_bundle_budget.py` then measures
`admin.mjs` (the entry, 450 KB) and the largest lazy chunk (a new budget), instead of `admin.iife.js`. The alternative is
to keep the IIFE and minify it, which keeps everything in one file and the same budget. Verify: `PIPELINE_STAGE=build`
(`bundle-budget`) and the admin tier.

### 34c. The admin's journeys at the tour projects — APPLIED 2026-10-18 (orchestrator decision; §37b)

Every new admin screen and state must pass the generic checkers at every tour viewport, light and dark (the task's rule;
M2c-interfaces §12.2), while today the admin's states run at its six admin projects only. Proposal: one tour file per
area (`e2e/tour/admin-<area>.tour.ts`) at the tour projects, as the viewer's: the per-push `tour` tier's nine projects
and the `tour-matrix` stage's other 35 (nightly and in `all`); each journey in its own city of the content world
(M2c-interfaces §12.3), so they need no lock. Cost: about 70 states, so roughly as many admin tour tests as the viewer's
per project; the `tour` jobs of `ci.yml` and the `tour-matrix` shards of `nightly.yml` need rebalancing from the first
measured run (a workflow edit that keeps the jobs within their timeouts: the pre-approved kind once measured).

### 34d. Information: Terra Draw, not Mapbox GL Draw — PROPOSED (a decision for the user to see)

`terra-draw` 1.37.0 and `terra-draw-mapbox-gl-adapter` 1.5.0 (MIT, no runtime dependencies, the adapter's peer
`mapbox-gl ^3.9.2`) behind our own `MapDrawPort`, bundled into the admin only. Mapbox GL Draw 1.5.2 (ISC) states no
Mapbox GL v3 support, brings a control and a stylesheet we would have to hide (its buttons are under 48 px) and has no
validation hook. The comparison is M2c-interfaces §4.1.

### 34e. Information: a deleted layer's tileset goes after seven days — PROPOSED (a decision for the user to see)

Deleting a layer removes its document at once (it leaves the public map within a minute) and queues the deletion of its
Mapbox tileset and source for seven days later, so History can restore it without reprocessing (which would cost
compute units). Mapbox bills the tileset's hosting meanwhile (within the free tier for a few layers). M2c-interfaces §8.4.

### 34f. Information: an English title is not required to publish — PROPOSED (a decision for the user to see)

The M2 row `S-A10-BAD-MISSING-EN-TITLE` ("A photo without an English title cannot be published") contradicts CR-1 of
`M1-interfaces.md` (Romanian required, English optional, the viewer falls back to Romanian). It is replaced by
`S-A10-BAD-NOT-PUBLISHABLE` (processing not done, failed, or the licence unknown: the rules' publish gate).

### 34g. Installing Terra Draw — APPLIED 2026-10-18 (user approved 2026-10-18; §41b)

The pois workstream (2026-10-17) built `MapDrawPort` with two implementations: the Terra Draw adapter
(`packages/ui/src/map/draw/terra-draw-adapter.ts`, written and unit-tested against the structural types of
`terra-draw-types.ts`) and click-only drawing on `MapPort` (`click-draw-adapter.ts`: a point is one click, a line and an
area grow with every click, vertices are moved and removed in the vertex list). The admin uses the click-only tools until
the packages are installed, because installing `terra-draw@1.37.0` and `terra-draw-mapbox-gl-adapter@1.5.0` downloads
them from the npm registry. With a yes: install both, exact, as dependencies of `@hcm/ui` in the pinned Node container
(`docs/SETUP.md` → *npm in a container*), check `npm audit --audit-level=low`, add the loader and pass it as `terraDraw` in
the pois section of `packages/admin/src/app/content-wiring.ts` (M2c-interfaces CR-M2c-20). Dragging a whole shape, a
vertex or a midpoint on the map comes with it. Verify: `PIPELINE_STAGE=tests` (a browser test with the real Terra Draw),
then `build` (the bundle budget, §34b).

### 34h. The admin's Mapbox GL JS without Subresource Integrity — APPLIED 2026-10-18 (orchestrator decision): the stricter option

The admin adds `mapbox-gl.js` of the pinned release from `api.mapbox.com` when its first map opens (`loadMapboxGl`,
`packages/ui/src/map/mapbox-loader.ts`), so the Setup pages never load it. The viewer's page names the script with an
`integrity` hash the site build computes; the lazily added script has none (the CSP still limits scripts to
`https://api.mapbox.com/mapbox-gl-js/`, as for the compare plugin). Stricter option: the admin page's build writes the
hash into the page (a `data-mapbox-integrity` attribute the entry reads) and the loader sets `integrity` and
`crossOrigin` with it. Verify: `PIPELINE_STAGE=build` and the admin tier.

### 34i. The dashboard as the admin's first screen — APPLIED 2026-10-18 (user approved 2026-10-18; §41c)

The M2c brief's "dashboard home" is built as `#/home` (behaviour A40, `M2c-interfaces.md` CR-M2c-24): what the city
holds, what waits for an admin (photos in rights review, unpublished photos, running and failed jobs), each a link to its
page, one chip per Setup area from `setup/status` and the public map's state. It is the first destination of the rail
and the drawer, and under More on the compact bar, whose four places stay Setup, Photos, Places and Layers. An empty
address still opens Setup (M2b's rule, `packages/admin/src/routing/router.ts`). Proposal: once Setup is complete, an
empty address opens the dashboard, and the dashboard takes Setup's place on the compact bar (Setup moves under More).
With a yes: the target of `isBlank` (`resolveAdminRoute`) and `ADMIN_ROUTE_SPECS` in `packages/admin/src/routing/`, their tests, and the
`S-A40-*` rows. Verify: `PIPELINE_STAGE=tests`, then the admin tier.

## 35. M2c integration (integrator, 2026-10-18)

The integrator wired the four workstreams' editors into the shell, ran the cross-app journeys on the emulators and resolved
the change requests that fell to it (`M2c-interfaces.md` §13). Nothing was committed, pushed or deployed; no real Google,
Mapbox or USGS endpoint was called. Applied items are of the pre-approved kinds (stricter, or a product fix the checks
found); the rest wait for the user.

### 35a. The editors' catalogue split per area (CR-M2c-25) — APPLIED (structure, no gate changed)

`packages/shared/src/i18n/admin-content/{ro,en}.ts` had reached about 800 lines each, past ESLint's `max-lines` (400), so
`static` failed on them. They are now one catalogue folder per area at the depth the `i18n` gate already reads
(`packages/*/src/i18n/*`): `admin-content/` keeps the kit's and the map's sections, `admin-photos/`, `admin-pois/`,
`admin-layers/`, `admin-settings/` and `admin-ops/` (admins, history, jobs, crash reports) hold the rest, and
`admin-content/index.ts` merges them into `translateAdminContent` and `ADMIN_CONTENT_CATALOGUES`. The split moved the 769
keys unchanged; `packages/shared/test/i18n-admin.test.ts` checks each folder's sections and prefixes, that no key is in two
folders and that the merge holds them all. No configuration changed (the `i18n` gate counts 10 catalogue folders now).

### 35b. The Bucharest site names another city than the project — APPLIED 2026-10-18 (orchestrator decision): option 1

The built site (`sites/bucharest/config.js`) and the legacy manifest (`seed/bucharest/manifest.static.json`) name the city
`bucuresti`; the project (`infra/project.json`), the admin and therefore every manifest the backend builds name it
`bucharest`. The viewer refuses a manifest of another city ("cityId din config.js (bucuresti) nu corespunde hărții
(bucharest)"), so the site cannot switch to the backend's manifest as it is. The admin-to-viewer journeys serve the site a
`config.js` naming `bucharest` meanwhile (`e2e/admin/support/flows.ts`). Options: (1) the site's `config.js` names
`bucharest` when its `manifestUrl` moves to the public bucket (visitors' stored language and theme, kept per city id, are
read once under the old id and written under the new one), the recommended one; (2) rename the project's city to
`bucuresti` (`infra/project.json`, the e2e worlds), which also changes the Firestore paths. `seed/bucharest/` stays as
migrated either way (ask first). Verify: the A41 journeys without the routed `config.js`.

### 35c. The history collection-group read narrowed — APPLIED (stricter; logged)

CR-M2c-6's `match /{path=**}/history/{entry} { allow read: if isAdmin(); }` let an admin read a `history` document
anywhere, `setup/status/history/h1` included, which the rules matrix's default-deny test refused. Now:

```diff
         match /{path=**}/history/{entry} {
-            allow read: if isAdmin();
+            allow list: if isAdmin();
+            allow get: if isAdmin() && path[0] == 'cities';
         }
```

A condition on the path cannot hold for a collection-group query (the emulator then denies the whole query), so `list`
stays open to admins: an admin could still list a `history` collection outside `cities/`, where nothing writes one.
Verified by `firebase/rules-tests` (203 tests, the `rules-coverage` gate) in `PIPELINE_STAGE=tests`.

### 35d. The place editor's texts commit on each key — APPLIED (a product fix the A41 journey found); its alternative for numbers APPLIED 2026-10-18 (orchestrator decision)

The place editor's titles, descriptions and links committed on `change`; a new place's Romanian title typed and then a
click on Save did nothing, because Save was still disabled (the draft had no title yet) and a disabled button takes no
click, so the field was never left. They commit on `input` now, as the photo editor's texts already did
(`packages/ui/src/admin/pois/poi-fields.ts`). Years (and the photo editor's numbers) still commit on `change`: half a
number is not a year and would flash an error. A year-only edit therefore still needs the field left (Tab) before Save:
for the user to see; the alternative is to commit numbers on `input` and show their errors only once the field is left.

### 35e. A revoked admin's open draft is lost — APPLIED 2026-10-18 (orchestrator decision)

When the owner removes an admin who is editing, the admin's next Save is refused (the rules need `admins/{uid}`), the shell
asks `admin.session` again and replaces the page with "This Google account does not administer this map": the draft goes
with it. `S-A20-BAD-REVOKED-WHILE-EDITING` (planned) wants the draft to stay visible until sign-out. Proposal: on that
transition the shell keeps the open page read-only under a banner ("Your access was removed: copy what you need, then sign
out") while an area holds unsaved changes; the stores stop their listeners but keep their drafts. `S-A02-BAD-REVOKE` now
proves the refusal, that nothing is written and the panel (`e2e/admin/specs/flows/revoke.spec.ts`).

### 35f. The admin bundle is at its budget — APPLIED 2026-10-18 (orchestrator decision): minified like the engine's (§36d); §34b still waits for the user

`admin.iife.js` measures 448.1 KB gzip of its 450 KB budget with every editor wired (`PIPELINE_STAGE=build`,
2026-10-18). Terra Draw (§34g) or the next area will not fit. §34b (the admin page loads the ES module build, each area
and the draw library a lazy chunk, minified as the engine's) or its alternative (minify the IIFE) needs the user's answer
before M3.

### 35g. The editors' states at every tour viewport (§34c) — APPLIED 2026-10-18 (orchestrator decision; §37b)

The M2c states pass the generic checkers at the five admin projects (c360, m768, l1440 in light, dark and English). The
review screenshots of every state at 360 × 800, 768 × 1024, 1440 × 900 and 2560 × 1440, light and dark
(`reports/screenshots/m2c/`, `docs/TESTING.md` → *Review screenshots*) were looked at instead; running the checkers there
is §34c's CI time, which waits for the user.

### 35h. What the review screenshots showed — APPLIED (product fixes, each with a check)

The contact sheets of every editor state at 360 × 800, 768 × 1024, 1440 × 900 and 2560 × 1440, light and dark
(`reports/screenshots/m2c/sheets/`), showed four defects the checkers had passed, each now fixed and pinned by a test
(`docs/LESSONS.md` 81–84): the map box an empty block without a map (`hcm-admin-map[no-map]`), the layer editor's Romanian
and English texts out of their columns on wide panes, "Configurare" broken across two lines on the phone's bar (the bar's
items lost their 4 px inline padding), and the chosen position of the list of positions filled with a colour that left its
fields at 1.27:1 in high contrast (now ringed). One gap of the checkers is recorded for their owner: a state's checks
measure only what is scrolled into the window, so a fault below the fold waits for a layout change to be seen (lesson 84).

## 36. M2c follow-ups (follow-ups agent, 2026-10-18) — APPLIED 2026-10-18 (orchestrator decisions and pre-approved kinds, logged)

The orchestrator's decisions of 2026-10-18 (the headings of §34a, §34h, §35b, §35d, §35e and §35f say so), the M2c change
requests that needed no answer from the user (CR-M2c-15, -27, -28, -29), the state checker's scroll sweep (lesson 84),
the account menu after a rotation and the two polish items the deployed admin showed on 2026-10-17. Nothing was
committed, pushed or deployed; no real Google, Mapbox or USGS endpoint was called. The admin's tour at every viewport
(§34c, §35g) is the E2E agent's.

### 36a. The decisions as applied

- **§35b option 1**: `sites/bucharest/config.js` names `bucharest`; `sites/bucharest/site.json` names the seed's city
  (`legacyCityId: "bucuresti"`), and the site build serves that manifest under `config.js`'s id (any other mismatch still
  fails the build, `scripts/site/src/build.ts`). `seed/bucharest/` is untouched. The e2e fixture manifest names
  `E2E_CITY_ID` (`bucharest`) and `e2e/admin/support/flows.ts` serves the built site as it is (no routed `config.js`). No
  one-time read of the old `hcm:bucuresti:*` preferences: the new site is not live, so no visitor has any.
- **§34h stricter option**: the admin's site build writes the digest of the pinned `mapbox-gl.js` into
  `<html data-mapbox-integrity>`; `loadMapboxGl` sets it as the script's `integrity` with `crossOrigin` (a value that is not
  a SHA-384 digest is ignored, `pageIntegrity`).
- **§35d alternative**: the photo editor's numbers and the place editor's years commit on `input`; `numberValue` keeps the
  admin's own spelling of the same number (`44.40`, an unfinished `44.`), and `LeftFields` shows a number's problem only
  once the field has been left (`packages/ui/src/admin/editing/number-fields.ts`). A year typed and then a click on Save
  saves.
- **§35e**: a denial makes the shell ask `admin.session`; not an admin while an editor holds unsaved changes, the shell
  sets `revoked` instead of the `notAdmin` panel: the page and its draft stay under an alert banner with Sign out, every
  editor write is refused at once (`writesRefusedWhen`) and no further denial asks again; Sign out asks to discard first
  (`S-A20-BAD-REVOKED-WHILE-EDITING`, `exists`; the state `admin.session-revoked` joins the inventory).
- **§34a proposal**: `vitest.config.ts` drops the empty `engine-browser` project and the `engine` project's `exclude`.
- **Bundle (§35f)**: §36d.

### 36b. A start-up deploy says so (the live CORS error) — APPLIED; for the user to see

Before the server exists, the anonymous probe of `admin-session` meets a 404 without CORS headers, which the browser
logs as a CORS error. Tried in Chromium first: a `no-cors` request only trades it for "Failed to load resource: 404";
every answer of 400 or more is logged whatever the mode. So a new map's Hosting-only deploy now says it has no server:
`HCM_ADMIN_START_UP=1 npx firebase deploy --only hosting` (the predeploy's `build:admin` writes `runtime.json` with
`startUp: true`), and the admin calls nothing of the server until step (d) sees every function `ACTIVE` on Google. A
browser that has had the server's answer probes anyway (`hcm:admin:serverSeen`), so a functions-only deploy that leaves
the start-up page in place still works. Without the variable the probe runs as before (`S-A25-BAD-NO-START-UP-DEPLOY`).
**For the user**: the live admin keeps logging the error until it is deployed again that way (ask first).

### 36c. The release — APPLIED (a fix)

`scripts/site/build-admin.ts` writes `runtime.json` itself (§23b's redesign, its first half): `release` is
`<root package.json version>+<short commit>` (`HCM_COMMIT`, else `GITHUB_SHA`, else the checkout's `HEAD`; the version
alone outside a checkout). The boot log and the crash reports name it instead of `dev`. The App Check site key joins it
with the deploy milestone.

### 36d. The admin bundle minified — APPLIED (the orchestrator's decision; no budget changed)

Vite's library mode already minified the IIFE (its JavaScript); what was left was the text of the Lit `css` templates,
about 77 KB of indentation and comments. `packages/admin/vite.config.ts` now runs `cssLiteralsPlugin`
(`scripts/site/src/css-literals.ts`: outside strings, comments and indentation go, and the spaces around `{ } ; ,` and
after `:`; every line break stays, so the source maps hold) and minifies `admin.mjs` like the engine's (§17a). Measured
in the quality image, production build, 2026-10-18:

| File | Before | After |
| --- | --- | --- |
| `admin.iife.js` (the budget, 450 KB) | 1,665,267 B, 448.1 KB gzip | 1,622,593 B, 443.6 KB gzip |
| `admin.mjs` | 1,841,325 B, 450.2 KB gzip | 1,496,221 B, 408.8 KB gzip |

§34b (the module build with lazy chunks) still waits for the user; it is what makes room for Terra Draw (§34g).

### 36e. Configuration edits — APPLIED (pre-approved kinds: stricter, or keeping the tools working)

- `vitest.config.ts`: `e2e/support/scroll-probe.ts` joins the `e2e-support` coverage list (stricter: one more file at 90 %);
  the `engine-browser` project went (§34a).
- `tsconfig.tools.json`: `references` the `scripts/site` project, as the admin's Vite config now imports its minifier
  (keeps `tsc -b` working).

### 36f. The state checker sees the whole state — APPLIED (gate-tightening; one narrowing it makes safe)

`expectStateSound` ends with the scroll sweep (`e2e/support/scroll-sweep.ts`, `docs/TESTING.md` → *The tour's
checkers*): every box a visitor scrolls is scrolled through its content and the position-dependent checks (layout, target
sizes, non-text contrast in both schemes, axe's colour contrast) run at each position; only new violations are reported.
With it, CR-M2c-29 (c) narrows the occlusion check: a sliver of at most 5 px of a control at the edge of what scrolls is
not counted (Chromium hit-tests the clip's last fraction of a pixel as the element beyond it), since the sweep checks the
control whole at another position. The admin base ring (CR-M2c-29 a) and the dialog's 4 px above its actions (b) are kit
fixes; the layers area's two workarounds went with them. Its first runs (the `e2e` and `tour-matrix` stages, 2026-10-18) found no new fault: the
viewer's 44 viewports and the admin's five projects passed with the sweep (1044 extra positions in `tour-matrix`
alone; `docs/research/layout-a11y-findings.md`, its addendum).

### 36g. Information: the error group link (CR-M2c-15)

`gcp.errorGroup` (`https://console.cloud.google.com/errors/detail/{groupId}?project={projectId}`) joined
`packages/admin/src/setup/links.json` in the console's documented form; the weekly contract run checks it and opens an
issue if it does not resolve (not dispatched: a workflow run is ask first).

## 37. M2c end-to-end (E2E agent, 2026-10-18) — APPLIED (test infrastructure, product fixes with their tests, orchestrator decisions §34c and §35g); §37e, §37g and §37i for the user

Every admin and cross-app row of `e2e/scenarios.json` that the screens support became a Playwright spec (108 rows from
`planned` to `exists`; `docs/E2E_SCENARIOS.md` regenerated). Nothing was committed, pushed or deployed; no real Google,
Mapbox or USGS endpoint was called; no package was installed (Terra Draw waits for §34g).

### 37a. The content world (CR-M2c-7) — APPLIED (test infrastructure)

A content spec gets a city (`w-<10 hex>`) and a Google account (`editor-<hash>@content.e2e.test`) of its own, an admin
of the map, and takes no lock: `EmulatorWorld.reset` of a locked test now deletes everything but the content worlds
(Firestore, Auth and Storage alike), so the editors' specs run on every worker beside the locked chain (Setup, the
session, admins, crash reports, Home). The `e2e` build's kit reads `?city=` (already there) and a new `?mapToken=`
(`e2eMapToken`, `packages/admin/src/index.ts`: a `pk.` token for the admin map, `none` for no map), so a content spec
never reads the singleton `setup/status`. The admin map draws in e2e on the mock Mapbox CDN, style and tiles; the e2e
admin server's CSP adds the e2e tile host to `connect-src` (as an XYZ server's host is added by hand in production).

### 37b. The admin editors in the tour (§34c, §35g) — APPLIED (orchestrator decision)

The editors' states run at every tour project, like the viewer's: `e2e/tour/admin-{photos,places,drawing,layers,
settings,jobs,history}.tour.ts` (15 tests, each in a city of its own) at the nine per-push `tour` projects and the 35 of
`tour-matrix`; the run starts the admin server and the emulators for the tour tiers too (`needsAdmin`,
`e2e/projects.ts`). The singleton screens (Setup, the sign-in, the claim, Admins, Crash reports, Home, a revoked
session) stay in their locked specs at the five admin projects: a tour of them would hold the lock across 44 projects.
A part that waits on the viewer (the area the viewer draws) stays in `e2e/admin/specs/`. Measured on the laptop,
2026-10-18, against fresh emulators: the per-push admin tour, 127 tests, 10.3 minutes of wall time, 126 green at the
first full run (the one red, the layer editor's map checked before its attribution: fixed, §37d). Its first runs found
lesson 107 (the editors flapped at 915 × 412). The CI tour jobs are rebalanced from the measured run (§37h).

### 37c. New admin projects — APPLIED (they add checks)

- `admin-steps-l1440-en` (`e2e/admin/steps/`): the Setup Assistant's steps one by one, each from a seeded state
  (`e2e/admin/support/steps.ts`): billing, provisioning, the server's installation and the claim, Mapbox, USGS,
  analytics, the page as a whole, sign-in and invitations, start-up mode, Google's consents and the legacy import. One
  project, in English: they check the server's answers and the cards' words, which do not depend on the window; the
  layout is the journey's (five projects) and the tour's.
- `admin-firefox-l1440-ro` and `admin-webkit-l1440-ro` (`e2e/admin/specs/editing/`): the editors' forms in Firefox and
  WebKit. `E2E_ADMIN_PART` deals them like the others (part 1 gets the steps, part 2 Firefox, part 3 WebKit).
- The fake upstreams gained `service-usage.billingApisEnabled`, `billing-budgets.appBudget` and `.staleBudget`,
  `monitoring.crashAlertsProvisioned`, and a gapi loader for Firebase Auth on Safari (`google-apis`, lesson 109).

### 37d. The checkers — APPLIED (refinements; nothing allowlisted)

- The legal rule applies to a map whose foot is in view (a map scrolled past its bottom shows its legal line no more
  than the rest of what is cut; the scroll sweep checks the positions that show it).
- A map's own controls over its canvas are the map (`ownMapControl`): a canvas scrolled to a strip had a sample on its
  own attribution (lesson 108).
- A state waits up to 60 s for its maps to load and fill their attribution (`MAPS_LOADED_MS`, was 15 s); the layers
  journey waits for its editor's map before the check.
- A console error "Failed to load resource" names its address; the waits on the Functions emulator share
  `FUNCTIONS_TIMEOUT_MS` (120 s).
- A state also waits while an admin map box is still creating its map (lesson 115).
- The occlusion check samples a control only inside its own shape, the corners of a rounded border left out (lesson
  123: the round colour presets of Settings, scrolled to a strip at 320 × 568).
- Tests without the lock touch only their own world: a content world's admin joins after the personas and leaves at
  teardown, and a test whose answer depends on `setup/owner` holds the lock (lesson 113); a locked test's reset keeps
  the content worlds' public photo files, which it deleted by reading a derivative's photo id as its city (lesson 116);
  the emulator helpers send a request again when the emulator drops the connection (lesson 119); the console guard of
  the admin projects expects the 400 or 409 of a transaction commit Firestore's SDK runs again, with its reason
  (lesson 117); Setup's `show` opens a card again when Setup moved on meanwhile.

### 37e. Rows still planned: what the screens lack — APPLIED 2026-10-18 (§42a–§42c: the screens exist, their rows too; Terra Draw's drags §41b)

Each row's `notes` says why: the self-test's per-check list (`S-A03-BAD-SELFTEST-FAILURE`: Re-check applies the status
but no screen lists the checks, so a failing check's reason and its link to Provision have nowhere to show); a control
for `setup.rotatePublicToken` (`S-A06-HAPPY-ROTATE`); the settings page's map (`S-A19-HAPPY`, `S-A36-HAPPY`,
`S-A36-BAD-DISCARD`); the conflict banner's name and time (`S-A38-BAD-CONFLICT`: the draft keeps `updatedBy`, nothing
names it); Home's list of the documents the build skipped (`S-A38-BAD-SKIPPED-SHOWN`); Terra Draw's drags
(`S-A32-HAPPY-VERTEX-EDIT`, §34g). Two cannot be reached in e2e: `S-A19-BAD-LOW-CONTRAST-SEED` (no seed colour makes the
tone algorithm adjust; unit-tested) and `S-A20-BAD-NO-APP-CHECK` (the emulator enforces no App Check). The M3 and M4
rows (A09's assists, A11 to A17, V06) and the pipeline's wait for their milestones.

### 37f. Product fixes — APPLIED (each with its unit test; `docs/LESSONS.md` 90 to 122)

The admin map hidden under a modal dialog (its legal line); Select all before any row is ticked; a click moves the
selected pin; an upload waits for the city's centre; the shell's theme follows the edited city; the import preview
planned again when its lists arrive; the list of positions put back after a refusal; the toolbar follows the drawing
session; the import's limit named with its numbers; the outside-the-city refusal names its limit (RO and EN); Back from
an item opened by its address stays in the admin; a landscape phone keeps its page heading; the places list previews
the open draft; a new place gets its remembered category once the categories arrive; a refused Mapbox or USGS save
shows the chip the server recorded; a provisioning item keeps its reason once recorded; a token expired mid-run offers
Continue; the start-up record survives a reload before the claim; the list and detail never split at a compact height;
"Add at centre" waits for the city's view (lesson 111); the Setup's analytics card checks Google Analytics only while the
Setup page shows, not on every page of a session (lesson 112); a line or an area keeps its first clicks when its place
is applied again (lesson 114); a create that finds its own landed attempt is no conflict (lesson 117); a photo's Save refused for a newer version of
other fields goes again once that version is here (lesson 118); a server probe that timed out is sent again before the
shell decides there is no server (lesson 120); a delete's history entry is never stamped before the version it deleted
(lesson 121); right after a Save, a settings or layer draft is not unsaved until the next edit (lesson 122).

### 37g. WebKit's report-only Trusted Types header — for the user

Safari applies `Content-Security-Policy-Report-Only: require-trusted-types-for 'script'` (firebase.json) and logs that
the policy "will have no effect" without `report-to`, then reports Firebase Auth's gapi loader (a script URL set as a
string), on every page load. Chromium reports the same loader once a Google popup opens. Options: give the header a
`report-to` endpoint (the crash endpoint could take it), or drop it until Trusted Types are enforced. The WebKit project
expects these two messages (and the CSP refusals of Playwright's own inspector styles) with their reasons.

### 37h. CI and the split — APPLIED (pre-approved kind: keeps the jobs within their timeouts)

The tour tiers now start the admin server and the emulators. Measured in the split quality run of 2026-10-18 (test
seconds on the NUC beside every other tier): the per-push tour about 4,150 s (the admin's editor journeys about 2,900 s
of it, 200 to 480 s a project), the admin tier about 3,100 s. `.github/workflows/ci.yml`: the tour in three count shards
(was two) and the admin, smoke, a11y and no-WebGL tiers in two (was one): eight e2e jobs, the heaviest about 1,400 to
1,600 s, within the 40-minute timeout. `nightly.yml`: the same eight, and `tour-matrix` (35 projects, now with the 14
editor journeys each, about 17,500 s) in ten count shards (was six). `docs/CI_PIPELINE.md` says the same. Pre-approved
kind (keeps the jobs within their timeouts); nothing else in the workflows changed.

### 37i. Two sliders named "Opacity: Photos" in English — for the user

The viewer's Layers panel names each overlay's slider after its title. A category named "Photos" (its own id,
`photos-<suffix>`, `S-A39-BAD-ID-CLASH`) gives the English panel two sliders of the same name, the photos' own and the
category's: a screen reader cannot tell them apart. Options: name the photos' slider by its kind ("Opacity: all
photos"), or add the overlay's kind to every slider's name. The e2e helper takes the photos' own slider (the first one).

## 38. Minimum admin input (adversarial reviewer, 2026-10-18) — APPLIED (§38a–§38c, each with its tests); §38d for the user

Every Setup step and daily flow was walked and its inputs counted against `SETUP_STEP_SPECS` and
`CONTENT_INPUT_BUDGETS`. Three inputs went away; the budgets were lowered with them and the flows that had a budget but
no counted test now have one.

### 38a. A pasted Mapbox secret token saves itself — APPLIED

Step (e) took two inputs (paste, Save) where the USGS paste already took one. A paste (`insertFromPaste`) of a value that
classifies as a secret (`classifyMapboxToken`) now goes to `setup.saveMapbox` at once and the box clears; a public `pk.`
or malformed paste is explained and only counted, nothing sent; a typed token goes with Enter or Save. `SETUP_STEP_SPECS`
mapbox 2 → 1, so `setupInputBudget()` is 9 inputs and 4 consents (was 10). Tests: `hcm-setup-credentials.test.ts`,
`e2e/admin/steps/mapbox.spec.ts` (`S-A05-HAPPY`: `flow.used` is 1), the journey (one retry paste, allowance 1).

### 38b. A new category's icon follows its label — APPLIED

Adding a category took four inputs (Add, the label, an icon, Save) although the label usually names the icon. Until the
admin picks one, a new category's icon is `guessCategoryIcon(label)` (`packages/admin/src/settings/icon-guess.ts`:
Romanian and English word starts, without diacritics, the specific kinds before the generic ones; else the pin). An icon
picked by hand is never replaced. `CONTENT_INPUT_BUDGETS.category` 4 → 3. Rows: `S-A39-HAPPY` (reworded),
`S-A39-BAD-ICON-NOT-GUESSED` (new, `exists`).

### 38c. A new invitation's link is copied at once — APPLIED

Inviting an admin took four inputs (Invite, the address, Invite, Copy). The link now goes to the clipboard from the click
that made the invitation, with "The link was copied." said; a browser that refuses leaves Copy as before.
`CONTENT_INPUT_BUDGETS.inviteAdmin` 4 → 3, counted in `e2e/admin/specs/ops/ops.spec.ts` (the clipboard holds the link).
`revertChange` and `revokeAdmin`, declared but not counted, are now counted in `e2e/admin/specs/flows/publish.spec.ts` and
`revoke.spec.ts`.

### 38d. Not done: what would cut more, and why it waits — for the user

- **Add place in one click per shape** (Add point, Add line, Add area in the list's head instead of Add place, then the
  shape): a point 5 → 4 inputs, an area 4 + n → 3 + n. It changes the places list's head at every window class (the
  tour state `pois.add-shape` goes away) and about 30 test call sites the places workstream owns; a reviewer's small fix
  it is not.
- **The photos of a batch selected after their upload**, so Publish is one click (3 → 2): the bulk bar then shows on
  the photos tour states after every upload, and the selection has to survive the list's reloads while the photos are
  processed. Worth a decision on whether a fresh batch should be the selection.
- **USGS stays three inputs**: the ERS username cannot be read from anywhere the app may look; the token page and the
  paste are already one click and one paste.
- **A place's title from its position** (reverse geocoding) is behaviour A09 with Nominatim, M3.
- **Billing, provision, analytics and the import** are one input each, consents apart; a single billing account is
  already chosen without a click.

## 39. Quality review: e2e time, docs (adversarial reviewer — quality, 2026-10-18) — APPLIED (39a, 39b: no check, gate or scenario dropped); 39c for the user

Measured in `docs/research/pipeline-baseline.md` → *Addendum: the quality review*. The split `quality` had grown from
324 s to 1,002 s with the admin's journeys in the per-push tour and the generic checkers on every state.

### 39a. axe runs in place on a page of one frame — APPLIED (performance; same rules, same results)

`axeViolations` (`e2e/support/a11y.ts`) ran `AxeBuilder`'s default mode for every check: axe-core injected into the
page and every frame, a per-frame partial run, then a blank page with axe injected again to merge the results; about a
second per state and half a second per scroll-sweep position on an admin page whose own `axe.run` takes a sixth of
that. A page of one frame now runs in legacy mode on the first check of a document and through the injected `axe.run`
afterwards, reporting violations only; a page with frames keeps the default mode (which also tests cross-origin
frames). A differential run of both ways on every call over 134 tests and a page with planted violations found no
difference.

### 39b. A failed test's trace without DOM snapshots and screencast — APPLIED (performance; diagnostics, not a gate)

`trace: 'retain-on-failure'` recorded a DOM snapshot and a screenshot at every action of every test, passed or failed,
and the checkers' probes and Tab presses are hundreds of actions per state: 40 % of a tour project's test time, 20 % of
a functional one's. `e2e/playwright.config.ts` now keeps the trace of a failed test without them (actions and timings,
console, network, the error) and adds its screenshot (`screenshot: 'only-on-failure'`) beside Playwright's error
context; the full trace is one rerun away (`--trace retain-on-failure`). With 39a: −45 % test time on the tour and
admin projects measured, −20 % on a functional one.

**For the user**: if a failing CI run should carry the full trace anyway, `trace: 'on-first-retry'` in CI (where a
test is retried once and a pass on the retry still fails the run) would add it at the cost of the retry's time only.

### 39c. What would bring the split `quality` to about 8 minutes — APPLIED 2026-10-18 (§42g)

After 39a and 39b the estimate is 600 to 650 s before the split's shares are retuned (the next split run measures
it; `default_parts` of `scripts/ci/e2e-split.sh` follows). What remains, each a coverage choice rather than waste:

- **The Setup journey at five admin projects** (`admin-{c360,m768,l1440}-ro`, `admin-l1440-dark`, `admin-l1440-en`): about
  580 s of test time behind `ADMIN_LOCK`, so it runs one at a time on each machine; at two projects per push (the
  others nightly) the locked chain would shrink by about 350 s.
- **The fifty-category state** (`admin-settings.tour.ts`) at all nine per-push tour projects: about 50 s each under
  load, 26 s idle; the per-push tour could check it at the four viewports and the other five in `tour-matrix`.
- **The functional tier** runs the same 105 specs at five projects (2,650 s); specs that do not depend on the window
  class (deep links, consent, language) could run at one.
- **The admin's per-push tour** could take the viewer's four viewports in light only, the dark and English variants
  moving to `tour-matrix` (about 1,450 s of the per-push tour's 2,640 s of admin journeys before 39a and 39b).

## 40. M2 final gate (final-gate agent, 2026-10-18) — RESOLVED 2026-10-18 (§40a: the database exists in nam5)

The state of M2 and the deploy steps are in `docs/research/M2-status.md`. Nothing was committed, pushed or deployed.

### 40a. The Firestore location — RESOLVED: the database exists in nam5

`firebase.json` names the `(default)` database but no `location`. The first `firebase deploy --only firestore` on a
project without a database creates one, and firebase-tools 15.33.0 then uses `nam5` (US multi-region;
`node_modules/firebase-tools/lib/deploy/firestore/prepare.js`, `createDatabase`). A database's location can never be
changed, and the provisioner does not create the database. The functions, the queue and the buckets are in
`us-central1` (`infra/project.json`).

Options, before the first rules deploy:

1. Add `"location": "us-central1"` to `firebase.json`'s `firestore` (one region, next to the functions: the cheapest and
   fastest for the server; the public viewer never reads Firestore, so the visitors' distance does not matter).
2. Leave it out: `nam5`, the console's default for a US project (multi-region, the same free quota).
3. A European region (`eur3`, `europe-west1`): nearer the admins in Romania, farther from the functions.

Recommended: option 1. If the project already has a database (check with
`gcloud firestore databases list --project bucurestiul-disparut`, read-only), its location stays and `firebase.json` names it.

**Resolved 2026-10-18**: the project's `(default)` database already exists in `nam5`: it was created with the project on
2026-10-11, and the orchestrator deployed the rules and indexes to it on 2026-10-12. Options 1 and 3 are moot (a location
never changes). `firebase.json`'s `firestore` now names `"location": "nam5"`, so a deploy to a project that lost its
database could never create one elsewhere, and `firebase/rules-tests/test/firebase-config.test.ts` pins it.

## 41. The user's decisions §34b, §34g and §34i, and the review polish (M2c follow-ups, 2026-10-18) — APPLIED 2026-10-18 (user approved 2026-10-18; configuration edits of the pre-approved kinds, logged)

The user answered §34b, §34g and §34i in chat on 2026-10-18 (relayed by the orchestrator), and the orchestrator's review
of the M2c screenshots asked for three polish items. Applied in that order. Nothing was committed, pushed or deployed; no
real Google, Mapbox or USGS endpoint was called.

### 41a. §34b: the admin page loads `admin.mjs`, each area a lazy chunk

- The admin's Vite build is ES only (`packages/admin/vite.config.ts`): no `admin.iife.js` any more, since an IIFE
  inlines every dynamic import and no document promises the admin on jsDelivr (only the engine's IIFE is distributed
  there, and keeps its own budget). The page loads `<script type="module" src="admin.mjs">`
  (`scripts/site/src/admin/page.ts`); Hosting's `**/*.@(html|js|mjs|css|json)` rule already serves every chunk
  `no-cache`, and its `**` rewrite answers a chunk a new deploy replaced with the page, which fails the import.
- Each area (`photos`, `pois`, `layers`, `settings`, `admins`, `history`, `jobs`, `crashes`, `home`) is one chunk:
  `packages/admin/src/pages/<area>.ts` holds the page's elements (`@hcm/ui/admin/areas/<area>`, a new subpath export
  of `@hcm/ui`) and the area's store module; `packages/admin/src/routing/area-pages.ts` imports it when the route first
  opens, adds the store module to the editors' modules (the content registry creates a store the first time its page
  reads it, so the module is always there by then) and registers the elements. `defineAdminElements` registers the
  shell, the kit and the editing kit only. Terra Draw is a chunk too (§41b); the colour library and the analytics SDK
  already were.
- Rolldown's `codeSplitting` groups name the chunks, so each can have a budget: `admin-core` (everything the entry imports
  statically; `admin.mjs` is a stub that imports it), `editor-shared` (what two or more areas share and the entry does
  not), `terra-draw`. Without them Rolldown split the code the entry shares with an area into about thirty small chunks
  named after one module each, which a refactor renames.
- A chunk that does not load (the network, or a deploy that replaced it) makes the page registry's loader reject;
  `<hcm-page-outlet>` then says "The page did not load. Check the internet connection and try again." with **Try again**,
  which imports it again (Chromium, Firefox and WebKit all fetch a failed dynamic import again: probed 2026-10-18 with
  Playwright 1.64 in the quality image). Row `S-A29-BAD-CHUNK-LOAD`, state `admin.page-failed` at every tour viewport
  (`e2e/tour/admin-jobs.tour.ts`).
- **Budget configuration** (`scripts/ci/check_bundle_budget.py`, the change to what the gate measures that §34b asked
  the user for): the entry (`admin.mjs` and every chunk it imports statically, read from the files' static imports)
  keeps the IIFE's 450 KB; every other chunk is measured against its own budget by name (the measurement plus about
  20 %, rounded up), a chunk without a budget fails, and everything together has a cap of 620 KB. Measured on the
  production build, quality image, 2026-10-18 (gzip level 9):

| Chunk | gzip KB | Budget KB |
| --- | --- | --- |
| `admin.mjs` + `admin-core` (the entry) | 349.8 | 450 |
| `terra-draw` | 47.4 | 58 |
| `photos` | 20.3 | 25 |
| `pois` | 19.6 | 25 |
| `dynamic-color` | 19.3 | 24 |
| `settings` | 15.3 | 20 |
| `editor-shared` | 10.1 | 13 |
| `layers` | 7.4 | 10 |
| `analytics-sdk` | 6.3 | 8 |
| `history` | 5.4 | 8 |
| `admins` | 3.6 | 6 |
| `home` | 2.7 | 5 |
| `jobs` | 2.4 | 5 |
| `crashes` | 2.4 | 5 |
| everything | 512.0 | 620 |

  Before: `admin.iife.js` 446.9 KB of 450 (M2-status §1). The entry is 97 KB lighter, Terra Draw included in the whole.
  Most of the entry is the Firebase SDK, Lit, the kit, Setup and the catalogues: the editors' texts are one module of
  `@hcm/shared` today, so they load with the shell (a split per area is a later change).

### 41b. §34g: Terra Draw installed and wired

- `terra-draw@1.37.0` and `terra-draw-mapbox-gl-adapter@1.5.0`, exact, dependencies of `@hcm/ui`, installed in the
  digest-pinned `node:24-bookworm-slim` (`docs/SETUP.md` → *npm in a container*); `npm audit --audit-level=low`: 0
  vulnerabilities. The published adapter imports nothing of `mapbox-gl` (only `terra-draw`), as §4.2 of M2c-interfaces
  expected. `terra-draw` 1.38.0 was published on 2026-10-18, after the evaluation: 1.37.0 is a `HELD` entry
  (`scripts/ci/check_dependency_updates.py`, `docs/CI_PIPELINE.md`) until it is evaluated.
- Their declarations name `geojson` (a dev dependency of Terra Draw's) and the global `mapboxgl` namespace;
  `skipLibCheck` stays off, so `packages/ui/src/map/draw/terra-draw-env.d.ts` declares the five GeoJSON types they use
  (as `@types/geojson` does) and an opaque `mapboxgl.Map`, instead of downloading another package.
- `loadTerraDraw` (in `terra-draw-adapter.ts`, the only importer, dependency-cruiser) imports both on the first drawing
  tools; `content-wiring.ts` passes it as `terraDraw` (CR-M2c-20). The real constructors take wider options than the
  structural `TerraDrawModules` (Mapbox's own map type), so the loader hands them over as those types; the browser test
  `packages/ui/test/map/draw/terra-draw-real.test.ts` drives the real Terra Draw and its Mapbox adapter through the port
  on a structural map with a real canvas: a vertex, a midpoint and the whole shape dragged with real pointer events, a
  drag past the limits refused, a pin dragged and moved by a click, an area drawn by clicks then dragged.
- **The click tools stay**, as the user asked: a new shape is still drawn by clicks (a point is one click, a line and
  an area grow with every click, Save works at any time: the input budgets hold), now shown by Terra Draw's own layers
  (`click-growth.ts`, shared by both ports); `select` is Terra Draw's select mode (drag a feature, a vertex, a midpoint
  to insert one; a right click on a vertex removes it), which keeps its selection on a click elsewhere, so a click still
  moves a selected point (WCAG 2.5.7), and leaves the keys to the editor's tools; the vertex list stays the keyboard's
  way. A polygon with holes, which Terra Draw's modes cannot hold, is shown by its outer ring and edited in the list.
  The click-only port stays the fallback when Terra Draw does not load.
- What the e2e found (`docs/LESSONS.md`): Terra Draw reports a selection's marks as an `update` of the feature's
  properties and the port's own updates as `api` changes; reported as drags, they moved the photo's pin back over a
  place typed in its fields. Only geometry changes that do not come from the port are reported now.
- Rows: `S-A32-HAPPY-VERTEX-EDIT` (`planned` → `exists`), `S-A32-HAPPY-DRAG-SHAPE`, `S-A32-BAD-DRAG-CROSSING`
  (`e2e/admin/specs/pois/dragging.spec.ts`, green at `admin-c360-ro`, `-m768-ro`, `-l1440-ro`, twice each).
- **Configuration** (pre-approved kind: keeps a tool working): `vitest.config.ts` pre-bundles `terra-draw` and
  `terra-draw-mapbox-gl-adapter` for the browser projects (`BROWSER_TEST_DEPS`), as every browser-test dependency.
- **For the user**: the admin bundles MIT code (Terra Draw, Lit) with no third-party notices file; M2c-interfaces §4.2
  said Terra Draw's licence text joins "the admin's third-party notices", which do not exist yet. Proposal: the admin's
  site build writes `THIRD-PARTY-NOTICES.txt` next to the page from the bundled packages' licences.

### 41c. §34i: the dashboard is the first screen once Setup is complete

- `packages/admin/src/app/setup-readiness.ts` watches `setup/status` while an admin is signed in with the server and
  sets `setupReady` once billing, provisioning, Mapbox and USGS are `ok` (the Setup Assistant's required steps); this
  browser remembers it per project (`localStorage` `hcm:admin:setupReady`), so the next visit's empty address opens the
  dashboard at once. `resolveAdminRoute` opens `#/home` for an empty address when Setup is complete;
  `ADMIN_ROUTE_SPECS.inCompactBarOnceSetUp` puts Home on the compact bar in Setup's place (Setup under More).
- An empty address opened before the readiness is known follows its first answer; a later change moves nobody: finishing
  Setup's last required step leaves the owner on Setup, where the optional steps (analytics, the legacy import) wait,
  and only the bar follows.
- A city of the `e2e` build's own (`?city=`) does not watch the singleton `setup/status`, which the locked Setup specs
  rewrite meanwhile (as its map token, CR-M2c-7): its first screen is Setup whatever another spec left there.
- Rows `S-A40-HAPPY-FIRST-SCREEN`, `S-A40-BAD-SETUP-INCOMPLETE` (`e2e/admin/specs/ops/ops.spec.ts`).
- The owner's journey (`e2e/admin/specs/journey.spec.ts`) reloads its empty address once USGS approves: the dashboard
  opens there now, and the journey goes back to Setup for the optional steps (its first split run of 2026-10-18 failed on
  that reload at the five admin projects, as the decision means it to).

### 41d. The review polish

1. **Dates in the admin's language**: the two native `<input type="date">` (the layer's exact date, the USGS token's
   expiry) showed the browser's pattern (`mm/dd/yyyy` in an American browser, inside a Romanian page). They are M3 date
   input fields now: a text field with the pattern as its hint, `zz.ll.aaaa` in Romanian and `dd/mm/yyyy` in English
   (the admin's English dates are British, `setup-text.ts`); a typed date is stored as the ISO date, one that does not
   exist is marked at its field (`packages/ui/src/admin/editing/date-text.ts`). Rows `S-A21-HAPPY-DATES-IN-LANGUAGE`
   and `S-A21-BAD-DATE-UNREAD`, under an `en-US` browser with the `America/New_York` time zone
   (`e2e/admin/specs/layers/dates.spec.ts`).
2. **Large and extra-large windows**: on an extra-large page (M3, from 1600 px, measured by `hcm-list-detail`) the
   map-centric editors put the map beside the form as a supporting pane (`packages/ui/src/admin/editing/wide-layout.ts`):
   photos and places, list 412 px | map | form 480 px, each scrolling on its own; the layer editor, groups 560 px | the
   map kept in view beside them. A map that does not show keeps the stacked layout. The other editors (texts, theme,
   categories, admins, history, jobs, crash reports) keep at most 840 px, centred in the detail pane: M3's readable
   width for forms and text; their wide margins are the cost of not stretching a form across 1,900 px. Below 1600 px
   the layouts are unchanged (at 1440 the detail pane is about 890 px: a 400 px form beside the map would leave the map
   under 500 px). Checked by the admin tour at `tour-x3840-light-ro`, `-l1440-`, `-c915l-`, `-c360-` (61 tests green)
   and the review screenshots at 2560 × 1440 (`reports/screenshots/m2c-review/`).
3. **The city's theme**: the admin wears its city's colours already (`packages/admin/src/app/city-theme.ts`: while an
   admin is signed in the shell watches `cities/{city}` and applies its `theme.tokens`; Settings previews a new seed live;
   M2b-interfaces §1.2 and the PLAN's "seed colour with live M3 preview"). The purple of the reviewed screenshots is the
   M3 baseline the shell falls back to while the city document holds no `theme.tokens`: the shots were taken at 02:22 on
   2026-10-18, before the E2E agent's fix "the shell's theme follows the edited city" (§37f; until then a content
   world's shell watched the project's city, not the test's own), and some tour worlds seed a city without a theme. The
   e2e journeys whose city carries the Bucharest site's theme (`seedPublicCity`) show the brown city colours.

## 42. The screens §37e asked for, read-only revoked editors, UX leftovers, security, and the §39c tiering (M2 follow-ups, 2026-10-18) — APPLIED 2026-10-18 (orchestrator task; configuration edits of the pre-approved kinds, logged); §42f's two cloud steps and one download for the user

Applied on `feat/engine-rewrite`; nothing committed, pushed or deployed, no real Google, Mapbox or USGS endpoint called.
The rows §37e listed as planned now exist, each with its e2e test and its states in the tour's inventory.

### 42a. The settings page's map — APPLIED

- The area and overlays sections show the city's map above the section (`packages/admin/src/settings/settings-map.ts`,
  one map per page visit through `AreaMap`): the saved layers, the published photos and places as the visitors see
  them, and the area's bounds as a rectangle (overlay `_bounds`, not clickable). **Draw the area on the map** takes two
  clicks, two opposite corners (the status line says which; the same button stops drawing); **Use this view** takes the
  map's centre and zoom. The number fields stay the keyboard's way (WCAG 2.1.1). The overlay defaults preview on the
  same map through the settings' `PreviewLayer`; Discard returns the stored opacities.
- Found by the new e2e: the settings chunk rendered `<hcm-admin-map>` without defining it (only the layers, places and
  photos chunks did), so the box stayed empty; `defineSettingsElements` defines it now, and
  `packages/ui/test/admin/editing/areas.test.ts` checks every map-showing chunk defines it (`docs/LESSONS.md`).
- Rows `S-A19-HAPPY`, `S-A36-HAPPY`, `S-A36-BAD-DISCARD` (`e2e/admin/specs/settings/map.spec.ts`); state
  `settings.area-drawing` in the settings tour.
- **A new named chunk** (the bundle budget's rule for a new chunk): the settings map imports the places' and photos'
  map modules, which made them shared and pushed `editor-shared` to 13.7 KB gzip, over its 13 KB. Rather than raise that
  budget, the admin map's box and the content modules it draws are a chunk of their own, `admin-map`
  (`packages/admin/vite.config.ts`), loaded by the four areas that show the map: 7.4 KB measured, budget 9 KB (plus
  about 20 %, as `scripts/ci/check_bundle_budget.py` asks); `editor-shared` is 8.8 KB again, every other budget
  unchanged, the total 620 KB unchanged.

### 42b. The self-test's checks, Rotate the visitors' token, and Home's skipped documents — APPLIED

- **Check again** keeps what `setup.selfTest` found and the Setup page lists every check with its state; a failing
  check shows its reason in the admin's language and a link to the step that fixes it (cloud checks to Prepare the
  project, Mapbox and USGS to their cards, Error Reporting to analytics): `packages/ui/src/admin/setup/self-test.ts`,
  row `S-A03-BAD-SELFTEST-FAILURE`, state `setup-self-test`.
- The Mapbox card has **Replace the visitors' token** and **Replace the admin's token** (`setup.rotatePublicToken`), each
  behind a confirmation dialog, saying when the old token goes (ops.tick deletes it ten minutes later, a clock test of
  the functions): row `S-A06-HAPPY-ROTATE`, state `mapbox-rotate-confirm`.
- Home's **Not on the public map** lists each document the manifest build skipped with its first issue (the field's
  human name) and a link to its editor: row `S-A38-BAD-SKIPPED-SHOWN`, state `home.skipped`.

### 42c. The conflict banner names who and when — APPLIED

The editors' banner reads "Saved by {who} on {date}." (who from `admins.list`, loaded once per session as the shell's
`people`, falling back to the address and then to "another admin"; the date in the admin's language, or the sentence
without it when the version is not a date) and lists the fields both sides changed by their human names. Row
`S-A38-BAD-CONFLICT` saves as a second content world's admin; state `editing.conflict`.

### 42d. A revoked admin's editors are read-only — APPLIED

Under the revoked banner every editor (photos, places, layers, every settings section, history, jobs, admins) shows
its fields read-only, Save and every action disabled, a "Read only" state line; the stores ignore an edit while
`ContentServices.readOnly()` holds (the drafts' `locked`), so no keyboard path writes either. `S-A20-*` asserts it in
`e2e/admin/specs/flows/revoke.spec.ts`.

### 42e. UX leftovers — APPLIED

- The places editor: Delete visible, History and the redraw tools in an overflow menu (`<hcm-overflow-menu>`); in a
  landscape phone window the detail pane stacks map and form in two scrolling rows (`wide-layout.ts`).
- One bulk bar for photos and places (`bulk-bar.ts`): count, Select all, Clear, the two main actions as buttons, the
  rest in its overflow menu.
- History and the jobs page show human field names (`adminContent.field.*`) and step names
  (`adminContent.jobs.stepName.*`) in RO and EN; History is a button like every other action (no link-styled one).

### 42f. Security — APPLIED in code; three steps for the user

- **The compare plugin's integrity**: `openCompare` refuses to load mapbox-gl-compare 0.6.0 without SHA-384 digests of
  both files and sets them with `crossOrigin`. The digests themselves come from the pinned npm package, the way
  mapbox-gl's do; installing `mapbox-gl-compare@0.6.0` is a download, so it waits for the user's yes (the viewer does
  not use the plugin yet: V06 is a later milestone).
- **The crash endpoint's account**: `telemetry.reportError` runs as `fn-crash@`, a new service account with no project
  role (the provisioner creates it and grants only the deployer `actAs` on it). A log entry needs no role, so a flaw in
  the one public endpoint reaches neither Firestore nor Storage.
- **Its worst-case logging cost**: 15 reports per instance a minute (was 120), 10 per client, two instances: about 30
  entries a minute project-wide; each entry cut to 16 KiB (`REPORTED_EVENT_MAX_BYTES`, the message shortened first),
  about 17 KiB with its envelope: 30 × 17 KiB × 60 × 24 × 31 ≈ 22 GiB in a 31-day month, under Cloud Logging's 50 GiB
  free tier. Not capped by the handler: Cloud Run's own request log (one short entry per request, refused ones too);
  **for the user**: a `_Default` sink exclusion for that function's request log (a cloud change, ask first).
- **App Check enforcement** (`HCM_APP_CHECK=enforce`) stays a later step for the user, after the deploy shows the
  tokens arriving in monitor mode (ask first).

### 42g. §39c: what each push repeats, and the split retuned — APPLIED (orchestrator decision; no scenario row dropped)

Every scenario row still runs on every push; only repetitions moved to `tour-matrix` (in `all` and nightly):

- the Setup journey at `admin-c360-ro` and `admin-l1440-ro` per push; at `admin-m768-ro`, `admin-l1440-dark` and
  `admin-l1440-en` in `tour-matrix` (`adminJourneyMatrixProjects`);
- the window-class-independent functional specs (about, boot, consent, CSP, crash reporting, deep links, embed API,
  geolocate, language and theme, no JavaScript, starter kit) at `fn-l1440-ro` per push, the other functional projects
  in `tour-matrix` (`fn-<viewport>-matrix`);
- the admin's tour journeys (the fifty-category state among them) per push at the viewer's four light RO projects
  only; their dark and English variants run in `tour-matrix` (`tour-<…>-admin`).

Measured (`docs/research/pipeline-baseline.md`, last addendum): the split `quality` stage in 460 s (482 s in a first run
whose failures were fixed), 968 tests and about 4,720 s of per-push test time (about 9,860 s before); this machine's part
ended about 20 s before the NUC's, so `default_parts` keeps `1:2` (its comment records the run). The nightly
`tour-matrix` gains about 1,700 s of test time over its ten shards, inside the 45-minute job; `ci.yml`'s per-push shards
only got lighter, so no workflow changed.

## 43. The M2e gate: the full `all` with the tour matrix, and what it found (2026-10-18) — APPLIED 2026-10-18 (orchestrator task; no gate relaxed, no allowlist entry)

The split `all` (`scripts/ci/e2e-split.sh`) ran the tour matrix for the first time since the M2c editors' follow-ups; the
per-push `quality` runs of §41 and §42 never reach it. What it and the M2e review screenshots found, and the fixes:

### 43a. Product fixes — APPLIED

- An opened photo or place is brought into view on its editor's map (centre, zoom kept, no animation); a new place and
  an edit of the open item move nothing (`S-A09-HAPPY-OPEN-IN-VIEW`, `S-A32-HAPPY-OPEN-IN-VIEW`,
  `S-A32-BAD-NEW-PLACE-KEEPS-VIEW`; `docs/LESSONS.md` 141).
- The dashboard's tiles in one row are as tall as each other (lesson 142).
- The admin map's box without a map never shrinks below its note (`flex: none`), and the map-beside-the-form layout of a
  compact height applies only from a medium width: a portrait phone of 320 × 568 measured a compact height and laid the
  places editor over the "Set up Mapbox" note (lesson 143).
- The navigation bar's labels follow their item's width below about 70 px (`17cqi`, 10.9 px at 64 px): "Configurare"
  broke over two lines at 320 px (lesson 147).

### 43b. A checker made exact, not relaxed — APPLIED

The legal-line rule asked for the Mapbox logo and attribution whenever a canvas showed its foot, also when only the last
4 px of a map scrolled to its end showed, below the band where Mapbox draws them (`admin.settings.area-refused` at 768 ×
1024). `showsItsFoot` now also asks that the visible strip be taller than the band under the map's lowest legal
control (`legalGap`, `e2e/support/layout-probe.ts`): one pixel of either control on screen and the rule applies as
before (`e2e/test/layout-probe.test.ts`; lesson 144). No allowlist entry was added.

### 43c. Three specs synchronised — APPLIED

- History's Deleted filter: the tour waits for the server's answer (no "Reconnecting…") instead of asserting no
  "Show more", which a full page of other cities' entries in the shared emulators legitimately offers until history
  entries carry their city (CR-M2c-14; lesson 145).
- Saving offline: the spec waits for Save to be on before it goes offline. The run after that showed a product bug
  behind it, fixed in §43a's spirit: offline, a categories listener answered from the cache with no category and the
  draft read the place's category as unknown, turning Save off; the draft now checks the category only against a list
  the server answered (lesson 146).
- A category's colour saved: the settings tour waits for the editor's own "Saved" before it opens another category; the
  emulator held the new colour before the page heard back, and the new address asked "Discard your changes?" (lesson
  148).

## 44. Security patch bumps for new advisories (2026-10-23) — APPLIED 2026-10-23 (user approved the downloads, `virtualenv` in a second approval)

New advisories failed the `static` stage's audit gates. The user approved downloading exactly these patch versions; no
allowlist entry, no new `overrides` entry and no other package was added.

| Package | From | To | Advisory | Gate |
| --- | --- | --- | --- | --- |
| `vitest`, `@vitest/browser-playwright`, `@vitest/coverage-v8` (root `devDependencies`); `@vitest/browser`, `@vitest/ui`, `@vitest/mocker`, `@vitest/spy`, `@vitest/utils`, `@vitest/pretty-format` (transitive) | 5.0.3 | 5.0.5 | GHSA-p458-7748-mcp3 | `npm-audit` |
| `markdownlint-cli2` (brings `markdown-it` 15.0.1 → 15.0.3 and `markdownlint` 0.41.1 → 0.42.0) | 0.23.3 | 0.24.0 | GHSA-r7fv-28h4-cvq7, GHSA-vfgh-jcmw-g37q, GHSA-gfr2-rv44-r23c (`markdown-it` 15.0.0 to 15.0.2) | `npm-audit` |
| `ip-address` (transitive: `firebase-tools` → `express-rate-limit`, `socks`; both ranges `^10`) | 10.7.3 | 10.7.4 | GHSA-rxp7-6hxx-x8q5 | `npm-audit` |
| `certifi` (`scripts/ci/requirements.txt`, `pipeline/requirements-poetry.txt`, `pipeline/poetry.lock`) | 2026.7.22 | 2026.10.19 | PYSEC-2026-4320 | `pip-audit`, `pipeline-pip-audit` |
| `virtualenv` (`pipeline/requirements-poetry.txt`, Poetry's own venv) | 21.14.6 | 21.14.13 | CVE-2026-113722, CVE-2026-113725 | `pipeline-pip-audit` |

- **npm.** `npm install --save-exact` of the three root packages stopped on `ERESOLVE`: the lockfile's `vitest@5.0.3`
  peers each `@vitest/*` at exactly 5.0.3, so no single package could move first. The fix was a lockfile refresh of
  only the affected entries: the 5.0.3 `vitest` and `@vitest/*` entries, `markdownlint-cli2`, `markdown-it` and
  `ip-address` were removed from `package-lock.json` and `npm install` re-resolved them in the digest-pinned Node
  image (`docs/SETUP.md` → *npm in a container*). The rest of the tree is unchanged apart from the dependencies of
  the new versions (`obug` 3.0.0 under Vitest; `micromark` and its extensions, `js-yaml` 5.4.3 and `string-width`
  8.3.0 under markdownlint, and one new transitive package, `micromark-util-edit-map` 1.0.0). `ip-address` needed no
  override: both of its dependants accept 10.7.4. `npm audit --audit-level=low` and the `deploy-lock-audit` gate
  (`functions/deploy-lock`, which holds neither package) report 0 vulnerabilities.
- **Python.** `certifi` is pinned to the approved 2026.10.19 in both requirements files. `poetry update certifi
  --lock` (Poetry 2.5.1 from the quality image) picked 2026.10.23, published the same day; the lock entry was set to
  2026.10.19 with PyPI's two sha256 hashes, so all three files name one version. `pyproject.toml` is unchanged, so
  the lock's `content-hash` stays valid (`pipeline-lock` gate).
- **`virtualenv`, approved and applied the same day.** The same `static` run found a further advisory outside the
  first approval: `virtualenv` 21.14.6 (Poetry's own dependency, `pipeline/requirements-poetry.txt`), CVE-2026-113722
  and CVE-2026-113725, fixed in 21.14.7 and 21.14.9. The user approved the latest, 21.14.13 (2026-10-23), which is
  now pinned; its dependencies (`distlib`, `filelock`, `packaging`, `platformdirs`, `python-discovery`) were already
  pinned at versions it accepts, so no package was added (`pipeline-pip-audit`).

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` and `PIPELINE_STAGE=tests bash
scripts/ci/run-all-checks.sh`.

## 45. History's recent changes ask one city (CR-M2c-14, 2026-10-23) — APPLIED 2026-10-23 (orchestrator task; no gate relaxed, no config of the ask-first kinds changed)

The split `all` failed once in the tour matrix: `admin.history.recent` at `tour-x3840-dark-ro-admin`, "Tab never
reaches" the test's own city's creation entry. The recent changes read the newest 50 entries of every city's
`history` and the page left the others' entries out (§9.2 as built, CR-M2c-14 open for M5). In the shared emulators
the other tests' cities write entries at the same instants, so they decided which of this city's entries made the
page, pushed one off it during the Tab round, and kept "Show more" on (the tolerance of §43c; `docs/LESSONS.md` 149).

- **Contract**: `historyEntryDocSchema` gains `cityId` (an id, optional so an entry written before it still parses);
  `history.on*Write` (`functions/src/history/record.ts`) and `history.revert` (`revert.ts`) write it from the audited
  document's path. `docs/research/M2-interfaces.md` §2.2 and `M2c-interfaces.md` §9.2 say so; CR-M2c-14 is done.
- **Query**: `recentQuery(cityId, filter)` asks `cityId ==` the city, then the entity and action filters, ordered by
  `updatedAt` descending (`packages/admin/src/history/entries.ts`); the page-side `inCity` filter went.
- **Indexes** (`firebase/firestore.indexes.json`): the three collection-group composites became four that start with
  `cityId` (alone, with `action`, with `entity`, with both); the `history.updatedAt` override, which only added the
  collection-group descending order for the unfiltered query, went, so `history` keeps Firestore's default
  single-field indexes. `firebase/rules-tests/test/indexes.test.ts` asks for the four and refuses a collection-group
  index that does not start with `cityId`. If an earlier deploy created the old collection-group indexes, `firebase
  deploy --only firestore` lists them as not in the file; deleting them is part of that ask-first step.
- **Rules**: unchanged (admins, who edit every city, list the collection group; `get` stays under `cities/`).
  `firebase/rules-tests/test/history.test.ts` queries one city with and without the filters (admins only) and checks
  that another city's entry never answers it.
- **Migration**: none. The live project never had a history trigger deployed (`M2-status.md` §5, step 4 not run), so
  its Firestore holds no history entry; an entry without `cityId` still validates and shows among its document's
  versions (the tour's year-2000 entry is one).
- **Tests**: `S-A23-BAD-OTHER-CITY` (the tour writes a newer deletion of another city: never listed, and the city's
  few entries offer no "Show more", in the recent changes and the Deleted filter; the tour also waits for the city's
  own creation entry before its checkers), the admin store's test with a full page of another city's entries, the
  shared schema's, functions' and rules' tests.

Verify: `PIPELINE_STAGE=static`, `tests` and `build` of `bash scripts/ci/run-all-checks.sh`; the history tour and the
specs that use History at several projects with `--repeat-each`.

## 46. The M3 contracts (2026-10-23) — 46c APPLIED (a stricter configuration, the pre-approved kind); 46a, 46b, 46d–46f, 46h–46j recorded for the user; 46g PROPOSED, NOT APPLIED (new dependencies)

The M3 contracts agent wrote `docs/research/M3-interfaces.md` alone before the four M3 workstreams. What it decided that
the user may want to see, and what it did not do:

- **46a Publishing runs in functions, not in the pipeline.** After approval, `imagery.publish` (a task queue, one at a
  time, 30 minutes) streams the COG from the private bucket to an MTS tileset source, writes the recipe, publishes and
  polls (§7.3). The pipeline never holds a Mapbox secret (`job-raster@` loses `mapbox-sk-tiles`, §9.4), an approval does
  not start a second Cloud Run execution, and the compute-unit guard runs in the same TypeScript as the approval policy.
  The cost: a 30-minute ceiling per upload, which a city crop (a few hundred MB, in-region read) is far from.
- **46b Automatic GCPs are part of M3** (PLAN had them in M4): the minimum-input path of the M3 brief is search → Import
  → automatic georeferencing → auto-publish; the georeferencer is the fallback (§5.6).
- **46c APPLIED: `.dependency-cruiser.cjs`'s `functions-feature-folders-independent` lists `layers` and `imagery`.**
  `functions/src/layers/` (M2c) was missing from the rule; `functions/src/imagery/` (M3) joins it, so the new folder can
  only reach the others through `ports/`, `api/` and `@hcm/shared`. Stricter; verified with `PIPELINE_STAGE=static`.
- **46d Layer versions; a layer exists only with tiles.** `cities/{city}/layerVersions/{version}` carries the work in
  progress (§2.2); a replacement keeps the old tiles until the new version is published. **UNVERIFIED**: that Mapbox
  serves a tileset's previous tiles while it processes a new publish of the same tileset. If not, the fallback is two
  alternating tilesets per layer (`-a`, `-b`), the inactive one deleted after the switch, which doubles a layer's
  tileset only while it is republished (the 24-tileset guard counts both).
- **46e A job status `awaiting_gcps`**, applied with its consumers (the Jobs page's text and active statuses, the rules
  tests iterate the statuses): an upload without georeference and a scene the matcher could not place wait for the
  admin's points instead of failing.
- **46f Jobs are created by callables and triggers only** (CR-M3-2, the rules: stricter): each creator checks the
  parameters, the budget guard, the daily cap and writes the version in one transaction; the client keeps Cancel.
- **46g PROPOSED, NOT APPLIED (each a new download, ask first):**
  - `openseadragon` for the georeferencer's scan pane (deep zoom over DZI tiles of the full scan). M3 instead shows a
    4,096 px preview in a canvas viewer of its own (`scan-preview.jpg`); a deep-zoom port can take OpenSeadragon later.
  - `@allmaps/transform` for the transforms (PLAN named it). M3 instead implements affine, second-order polynomial and
    thin-plate spline in `packages/shared/src/georef/`, held to the pipeline's numpy by golden cases; the module's
    interface (§6.2) lets the library replace the implementation later.
  - `google-cloud-secret-manager` and `pystac-client` for the pipeline: not needed; both are a few REST calls through
    the pinned `httpx`.
- **46h The compute-unit numbers are UNVERIFIED** (Mapbox's raster MTS precisions and price per km²):
  `KM2_PER_COMPUTE_UNIT`, `USD_PER_COMPUTE_UNIT` and `MAPBOX_FREE_COMPUTE_UNITS` are conservative constants; each publish
  records the MTS job's `tileset_precisions` so a later change can calibrate them against the first invoice.
- **46i A second scheduled function**, `imagery.tick` every 5 minutes (dispatch, lost executions, Mapbox polling,
  deferred publishes, layer deletions, the monthly harvest): a second Cloud Scheduler job (three are free per billing
  account) and about 8,600 invocations a month (free tier). `ops.tick`'s `jobs` and `mts` steps stay no-ops.
- **46j The references' public endpoints**: Sentinel-2 L2A from Element 84's Earth Search STAC (`HCM_STAC_URL`) and OSM
  features from the Overpass API (`HCM_OVERPASS_URL`), called only by the Cloud Run job, cached 90 days in the private
  bucket; never Mapbox Satellite. **UNVERIFIED**: their availability and limits for our volume (a few calls per import);
  both addresses are configuration, so a mirror or a paid endpoint is a deploy-time change.
- **46k Bundle budgets**: the new chunks `imagery` and `georef` (at most 30 KB each) and `layer-geometry` (at most 8 KB)
  get their rows in `ADMIN_CHUNK_BUDGETS` from admin-imagery with the measurement (the pre-approved kind, logged then);
  together they stay within `ADMIN_TOTAL_KB` (521 KB measured on 2026-10-23).

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`; the shared, rules (`documents.test.ts`), functions
(`support/`, `layers/`), admin (`jobs`) and ui (`admin/jobs`, `admin/ops`) Vitest projects for the edited files.

## 47. admin-imagery: the M3 chunks' budgets and what the screens decided (2026-10-23) — 47a APPLIED (the pre-approved kind §46k names); 47b–47e recorded for the user

- **47a APPLIED: `ADMIN_CHUNK_BUDGETS` gains `imagery` 18 KB, `georef` 17 KB and `layer-geometry` 3 KB**
  (`scripts/ci/check_bundle_budget.py`): 15.2, 14.0 and 1.9 KB gzip measured on 2026-10-23 plus about 20 %, under the
  contract's ceilings of 30, 30 and 8 KB. No existing budget changed: `editor-shared` 11.0 of 13, `layers` 7.8 of 10,
  `settings` 17.8 of 20, `admin-core` 367 of 450, the admin in all 569.8 of 620. New chunks only, each with its own
  budget, as §46k planned.
- **47b Replace image is the Imagery area's upload for the layer** (`#/imagery/replace/<layerId>`), not a second upload
  inside the layer editor: the same resumable upload, checks and progress, and none of its code in the `layers` or
  `layer-geometry` chunks (it would have moved the upload into `editor-shared`, over its budget).
- **47c Crop's keyboard way**: pan the map with the arrow keys and add a corner at its centre, three or more; the
  drawing tools' clicks are the pointer's way. Save sends the outer ring to `imagery.crop`.
- **47d `fn-events@` runs the raster job's executions with project-level roles** (`roles/run.jobsExecutorWithOverrides`,
  `roles/run.viewer`): §9.4 asks for them on the two job definitions, which the provisioner cannot bind yet (no Cloud Run
  resource policy, and the definitions are deployed after it runs). Narrowing them to the two jobs is a follow-up;
  `job-raster@` lost `mapbox-sk-tiles` as §9.4 says.
- **47e Not applied, for the owners**: the Bucharest import's target years (CR-M3-28); `mapbox.studioTilesets` in
  `links.json` waits for the weekly probe (CR-M3-9).

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`, `PIPELINE_STAGE=build bash scripts/ci/run-all-checks.sh`;
the admin, ui and shared Vitest projects.

## 48. e2e-fakes: advisories published during the M3 run, and one CI-time question (2026-10-24) — 48a APPLIED 2026-10-25 (user approved the downloads; §64); 48b recorded for the user

- **48a APPLIED 2026-10-25 (user approved the downloads; the versions in §64): two security bumps.**
  The `static` stage of 2026-10-24 fails on advisories that appeared
  after §44, in packages no M3 change touched; this phase may download nothing, so they wait for the user's approval:

  | Package | From | To | Advisory | Gate |
  | --- | --- | --- | --- | --- |
  | `body-parser` (transitive: the root's through `@modelcontextprotocol/sdk` and `firebase-functions`; `functions/deploy-lock`'s 2.x) | 2.0.0 to 2.3.0, and below 1.20.9 | 2.4.0 or later (1.20.9 for a 1.x range) | GHSA-27r3-jxmh-p828 | `npm-audit`, `deploy-lock-audit` |
  | `filelock` (`scripts/ci/requirements.txt`, and the pipeline's tool chain) | 4.1.1 | 4.2.1 | CVE-2026-112906, CVE-2026-112914, CVE-2026-112940 | `pip-audit`, `pipeline-pip-audit` |

  The way §44 took: refresh only the affected lockfile entries in the digest-pinned Node image (an `overrides` entry
  only if a dependant's range refuses the fixed version), and pin `filelock==4.2.1` in every requirements file that
  names it.
- **48b The imagery specs' time behind the admin lock.** The publish flows wait for fn-imagery's first MTS poll (60 s)
  and the manifest build, so `S-A12-HAPPY`, `S-A12-HAPPY-AUTO-PUBLISHED` and `S-A16-HAPPY-CROP` take two to four
  minutes each at each of the five admin projects (the imagery specs: about 40 minutes in one run). Like the Setup
  journey (§39c) they could run per push at `admin-c360-ro` and `admin-l1440-ro` only and at the other three in
  `tour-matrix` (`e2e/projects.ts`, not changed). For the user and the integrator (CR-M3-36).

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`.

## 49. The M3 integrator: the change requests closed, and what stays for the user (2026-10-24) — 49a–49h, 49k and 49m APPLIED (product and test changes, the e2e tiering of the kind §39c and §42g applied; no configuration of the ask-first kinds); 49i APPLIED 2026-10-25 (user approved the downloads; §58); 49j and 49l recorded for the user

No lint, tool, workflow or gitleaks configuration changed, no gate was relaxed and no checker allowlist entry was added.

- **49a The Imagery area's happy path is one input again.** Each free scene's card has its own **Import** (named after
  its scene), as §10.2 of the contract says; `CONTENT_INPUT_BUDGETS.importScene` stays 1 and the e2e counts 1
  (CR-M3-35 d; the e2e had been set to the screen's 2).
- **49b The kit keeps targets clear** (CR-M3-35 e, j, h, i, l): `hcm-list-detail` keeps 4 px under its Back row (every
  area's detail on compact and medium windows moves down 4 px); the Imagery filters' rows are 16 px apart; each target
  year's row in Settings is 48 px; the Jobs page's georeferencer link is a 48 px `a.external`; the georeferencer's radios
  and checkboxes are drawn like the kit's (2 px border, 48 px ring); the admin map underlines its attribution's links.
- **49c The georeferencer's table fits its box.** Below a 560 px table the pixel and place columns give way (the panes
  show where every pair is) and a pair's origin goes under its name; a selected row hands its on-container colours to its
  controls. No horizontal scroller (WCAG 1.4.10, the `sideways-scroll` check).
- **49d `imagery.search` may run 300 s** (CR-M3-22): a functions-side table `CALLABLE_TIMEOUT_SECONDS` sets the deploy
  option; the admin calls it with a 310 s timeout (the SDK's default is 70 s). The shared registry is unchanged.
- **49e A layer is busy while any job of it runs** (CR-M3-24): `layers.delete` also asks the top-level `layerId` of M3's
  jobs and refuses a layer with a `pendingVersion`.
- **49f A replacement upload asks no year**: the layer keeps its own, so `imagery.onRasterUpload` reads none; the upload
  starts as soon as the file is chosen. Link a layer gains **Check** (`imagery.probeTiles`), optional: Link is off only
  after a Check found no tiles, until the address changes.
- **49g The admin's tab title and `<html lang>` follow its language** (the live polish of 2026-10-23;
  `S-A21-HAPPY-DOCUMENT-TITLE`, `S-A21-BAD-UNSUPPORTED-LANGUAGE`).
- **49h The legal-line check owes each control only where the map's strip reaches it** (`e2e/support/layout-probe.ts`,
  `legal.owes`; `docs/LESSONS.md` 163). Lesson 144's rule owed the logo and the attribution together once the strip
  passed the band under the lowest of them; on the admin map the attribution sits on the foot, so a strip of 1 to 10 px
  (a pane the Tab round left at its end) asked for a logo drawn 10 px above it, which no visitor could see. Two of a kind
  are still one too many, and a control the strip reaches must be there and uncovered. This makes the check exact, not
  looser: every case the old rule could see the logo in is still checked. For the user's review all the same, as a
  change to a checker.
- **49i APPLIED 2026-10-25 (user approved the downloads; the versions in §64): §48a's security bumps.**
  The `static` stage fails only on `npm-audit`,
  `deploy-lock-audit`, `pip-audit` and `pipeline-pip-audit` (body-parser GHSA-27r3-jxmh-p828, filelock 4.1.1 →
  4.2.1). This task may download nothing. The two body-parser tarballs (2.4.0 and 1.20.9) are already in the host's npm
  cache since 2026-10-23, so after your yes the lockfile refresh needs no new body-parser download (its packument may
  still be fetched); filelock 4.2.1 is in no local cache, and pinning it rebuilds the quality image. The final `static`
  run of 2026-10-24 also reports advisories published that day, in `firebase-tools`' tree only (the emulators and the
  deploy CLI, nothing shipped): `fast-uri` 3.1.8 (moderate: GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h,
  GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp; through `ajv` 8.20.0) and `undici` 6.29.0 and 8.11.2 (high:
  GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c; the second through `node-gyp`). PROPOSED, NOT APPLIED:
  the patched releases `npm audit` names, as exact `overrides` in the same lockfile refresh (downloads, for your yes).
- **49j CR-M3-28 (Bucharest's target years) stays open**: the bundled seed (`seed/bucharest/`, ask first) or
  `createCityRequestSchema` would have to carry `imagery`. The admin guides tell the owner to add the five years once in
  Settings → Historical imagery (five inputs).
- **49k APPLIED: §48b, the imagery publishes per push at a phone and a laptop** (`e2e/projects.ts`, the kind of §39c and
  §42g). The imagery specs took 20 minutes at one admin project (34 tests behind the admin lock, 2026-10-24), most of it
  in the publishes that wait for the fake MTS and the manifest build; at the five admin projects that is about 100
  minutes a machine. So `published.spec.ts` (the imports that reach the viewer, split out of `import.spec.ts`) and
  `layer-geometry.spec.ts` (crop, replace, re-georeference) run per push at `admin-c360-ro` and `admin-l1440-ro`, and at
  `admin-{m768-ro,l1440-dark,l1440-en}-imagery` in `tour-matrix` (`all`, nightly); the real pipeline's spec, which does not
  depend on the window class, at `admin-l1440-ro` only. Every scenario row still runs on every push. To revert: drop
  `IMAGERY_PUBLISH_SPECS` and `PIPELINE_SPEC` from `noJourney` and the `-imagery` projects.
- **49l The Link dialog's preview of a Mapbox tileset on the admin map (`S-A15-HAPPY-PROBED`'s first wording) is not
  built**: Check answers with the tile's type, and the layer's editor previews the tiles once linked (S-A15-HAPPY). The
  row now says so.
- **49m Two dispatcher rules the quality run corrected** (CR-M3-44, CR-M3-45; `docs/LESSONS.md` 166, 167): the tick's
  monthly harvest repeats only a harvest older than 30 days (a city never harvested, or with no frame over it, is searched
  when its Imagery area opens, not every 5 minutes), and `RUNNING_JOBS_MAX` counts the jobs holding an execution
  (`starting`, or `running` with the lease held; a lapsed lease is a lost run the tick recovers). For review: both read
  the contract tighter than §3.5 and §4.2 first did.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`, `PIPELINE_STAGE=tests …`, `PIPELINE_STAGE=build …`,
`PIPELINE_STAGE=quality bash scripts/ci/e2e-split.sh`.

## 50. The M3 reviews' fixes: what the product now decides for the admin (2026-10-24) — 50a–50g and 50i APPLIED (product and test changes; no configuration of the ask-first kinds, no gate relaxed, no checker allowlist entry); 50h APPLIED 2026-10-25 (user approved the downloads; §58)

The fixer of the two M3 reviews (ten security and cost findings, fifteen minimum-input ones; CR-M3-47,
`docs/LESSONS.md` 171–180) applied every finding. These are the choices in it the user may want to change:

- **50a The admin may resume a budget pause** (behaviour A43, `imagery.resumeGuard`, admin, App Check consume). Before,
  the 5 USD alert turned `ops/guard` red for good and no screen could turn it back. Now the Imagery and Jobs pages show
  the spend and **Resume processing**: the guard turns green for the rest of that budget period (`resumedFor`; Google's
  repeated alerts for the same period leave it green, the next period's first alert pauses it again). The public map
  never paused. To make it stricter: refuse the resume above a second threshold, or let it hold one day only.
- **50b A publish starts at most 6 times** (`PUBLISH_MAX_ATTEMPTS`), the admin's Try again included, then fails
  `apiError.imagery.attemptsExhausted` with its reservation freed; `JOB_MAX_ATTEMPTS` (3 executions) is unchanged.
- **50c A failed harvest waits an hour, then twice as long after each further failure** (`HARVEST_RETRY_HOURS`, at most
  the 30 days of a harvest that answered), recorded in `ops/harvest-{city}` (a new ops document, written by the
  functions only; the rules deny every client, as for every `ops/` document).
- **50d What Try again never offers** (`NOT_RETRYABLE_CODES`, shared by `imagery.retry`, the Jobs page and the version
  page): a Mapbox token that is invalid, lacks a scope or is missing (the way out is Setup's Mapbox step), out of memory
  on the large machine, and attempts exhausted; a refused upload offers Upload another file; any failed version may be
  dismissed. A file too large for MTS is no longer a failure: it goes back with the verdict `too-large`, only the free
  Studio way left.
- **50e Two more ops documents read and written in transactions**: `ops/dispatch` (one slot per job holding a Cloud Run
  execution, the two-runs cap) and the month's `usage/mapbox-YYYY-MM` reservations marked `newTileset` (the 24-tileset
  cap). Both replace counts read outside the transaction that acted on them.
- **50f The ranking explains a low rank first** (`RANKING_VERSION` 2, `reason.noLayers` for a city with no layers): the
  stored scenes keep their version 1 ranks until the next harvest or the next `notScanned` ranks them again.
- **50g The Mapbox "list a tileset's jobs" answer is a recorded fixture, UNVERIFIED** (`mapbox/tilesets.jobs.list`): only
  a lost publish answer uses it (`MapboxTilesets.listJobs`); the weekly contract probe should cover it once it runs
  (ask first, as CR-M3-9).
- **50h APPLIED 2026-10-25 (user approved the downloads; §64): §48a and §49i's security bumps.** The four audit
  gates still fail the `static`
  stage, and so `all`; this task could download nothing.
- **50i Two screen defects the first full `all` found** (`docs/LESSONS.md` 181, 182): the georeferencer's pairs table on
  a phone now applies its narrow rules (they sat before the cells' own rule and never applied), and a cell wraps when the
  table would not fit otherwise; the
  admin map's attribution gives a layer's plain-text credit Mapbox's link colour (it read white on white in the dark
  scheme). The second is a style on Mapbox's own control, for your review as such; it makes the credit legible, it hides
  nothing.

No bundle budget changed: every admin chunk and the entry stayed within their budgets (`check_bundle_budget.py`, §47a's
tables).

Verify: `PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh`, `PIPELINE_STAGE=build …`, `bash scripts/ci/e2e-split.sh`.

## 51. The local stack for manual testing and the manual test plan (2026-10-24) — 51a–51d APPLIED (tooling and test-world changes; no configuration of the ask-first kinds, no gate relaxed); 51e APPLIED 2026-10-24 as a PLAN alignment (§55a)

Before the owner and Claude test the product by hand "from the top", one command now starts the e2e world for a
person's browser (`npm run dev:stack`, `docs/SETUP.md` → *Local stack for manual testing*), and
`docs/MANUAL_TEST_PLAN.md` lists what to check, where (LIVE or LOCAL) and after which deploy, with the ask-first
commands. These are the choices in it the user may want to change:

- **51a An in-page shim, not a service worker.** In the specs Playwright's routes keep every request on the machine; a
  person's browser has none. A service worker was the first design (it worked in Chromium), but the Claude browser pane
  refuses to register one ("An unknown error occurred when fetching the script"), so the stack's admin and site servers
  put `e2e/stack/browser.ts` first into every page: it rewrites every address of a host off the machine to
  `/__stack/h/<host>/<path>` (in the page and in Mapbox GL's blob worker), and the server decides with the e2e firewall's
  own host table (`e2e/mock-apis/hosts.ts`): the mock APIs, the Storage emulator, or 403. `e2e/stack/check.ts` proves no
  request of the main screens reaches the network for a host off the machine. The rewrite exists only in the stack's
  servers; the admin's and the viewer's builds are the e2e ones, unchanged.
- **51b Google's consent stand-in opens in a frame over the page** in the stack (the pane opens a popup in place of its
  page, losing the opener the answer goes to); `e2e/mock-apis/oauth-page.ts` posts to its parent when it has no opener,
  which leaves every e2e spec's popup path as it was (the harness's consent specs pass), and the stack adds the mock APIs'
  origin to the served CSP's `frame-src`.
- **51c The container shares the host's network** (`--network host`), so the stack's ports are the e2e ports on the
  host's loopback, and the stack is seeded through the real flows where they exist: the owner's `imagery.search` and four
  `imagery.import` runs played by the stand-in runner (a draft over the threshold, a scan waiting for points, a run failed
  at warp, a frame the fake MTS publishes), and the legacy photos' real derivatives. `scripts/ci/e2e_build.py` counts
  `e2e/stack/` and `scripts/dev/` as not read by the e2e build (no rebuild for a stack change).
- **51d The admin's tab title follows its language**: already applied in `921088f` (A21's `S-A21-HAPPY-DOCUMENT-TITLE`
  and `S-A21-BAD-UNSUPPORTED-LANGUAGE`, `packages/ui/test/admin/shell/shell.test.ts`); run again on 2026-10-24 at
  `admin-l1440-ro` and `admin-c360-ro` (8 passed with the harness's consent specs). The live admin shows it after the
  next Hosting deploy (the plan's D1, ask first).
- **51e APPLIED 2026-10-24 (a PLAN alignment, §55a)**: the public site's `config.js` read the manifest the site build
  bundled from `seed/bucharest/manifest.static.json`, not the public bucket's `cities/bucharest/manifest.json` the admin
  publishes; a build that names the bucket (`HCM_PUBLIC_BUCKET`) now serves the bucket's, with the page's CSP, and the
  seed snapshot stays only for a build without one. The Claude browser pane on this machine has no WebGL: the plan runs
  its map items in Chrome.

Verify: `bash scripts/dev/dev-stack.sh` then `bash scripts/dev/dev-stack.sh check` (`[SUCCESS] the local stack works`),
`PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`, `PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh`.

## 52. The M4 contracts and the user's decisions of 2026-10-23 (2026-10-24) — 52a–52d APPLIED (the user's decisions: 52a in this change, 52b in the contract, 52c and 52d by the tooling workstream); 52e recorded for the user; 52f and 52g PROPOSED, NOT APPLIED

The M4 contracts agent wrote `docs/research/M4-interfaces.md` alone before the five M4 workstreams (orders, autogcp,
compare, assists-notify, tooling). No lint, tool, workflow or gitleaks configuration changed, no gate was relaxed, no
checker allowlist entry was added, and nothing was downloaded.

- **52a APPLIED: swipe compare is our own implementation, not `mapbox-gl-compare`** (the user, 2026-10-23). Removed in
  this change: `packages/ui/src/map/compare.ts` (the plugin loader with its integrity check), its test, its five exports
  from `@hcm/ui/map`, the `MapboxCompare` types and `mapboxgl.Compare` (`packages/ui/src/map/mapbox-types.ts`, the
  `FakeMapboxGl` of `@hcm/test-support`). Superseded with it: §18b (Subresource Integrity for the plugin), the plugin
  part of §42f and of §13d's CSP note, and the open item of `docs/research/M2-status.md` (installing
  `mapbox-gl-compare@0.6.0` to compute its digests: no download is needed any more). The contract: M4-interfaces §3 (a
  lazy chunk of the engine with its own budget, the second map created on demand and destroyed on exit, a MapPort `move`
  event for the camera sync, a keyboard and screen-reader divider, each side's overlay opacity, a toggle on compact
  windows, `cmp=` and `sw=` in the hash, which this change built in `packages/shared/src/url/hash.ts`).
- **52b APPLIED: Romanian ↔ English drafts through Vertex AI Gemini, server-side, as PLAN says** (the user, 2026-10-23:
  the paid EEA tier, under 0.05 USD a month; the API turned on by the app's Provision step; drafts never published
  automatically). The contract: M4-interfaces §4.3 and §4.4: `assist.translateDraft` (admin, App Check `enforce`) calls
  `generateContent` on the pinned `VERTEX_MODEL_ID` (`gemini-2.5-flash-lite`, **UNVERIFIED** that Google still serves it
  until the setup self-test's free `countTokens` check runs) with the pinned prompt (`TRANSLATION_PROMPT_VERSION` 1), the
  answer is plain text (`sanitizeDraft`) within the field's limit, a monthly cap (`AI_MONTHLY_CAP`: 500 requests or
  0.50 USD) in a transaction, paused by a red budget guard; Provision enables `aiplatform.googleapis.com` and grants
  `fn-admin@` `roles/aiplatform.user`; a draft fills the editor's draft only, and only the admin's Save writes.
- **52c APPLIED (the decision; the bump is the tooling workstream's): `terra-draw` 1.37.0 → 1.38.0** (the user,
  2026-10-23; the one download M4 may make). The `HELD` entry (`scripts/ci/check_dependency_updates.py`,
  `docs/CI_PIPELINE.md` → *Held dependencies*) goes in the same change as the bump, because the `deps` gate fails a hold
  that no longer matches its pin; `terra-draw-mapbox-gl-adapter` moves only if 1.38.0 requires it, else that is a NOT
  APPLIED proposal here. Verify: the drawing tests (`packages/ui/test/map/draw/`, the admin's drawing specs), `static`,
  `tests`, `build`.
- **52d APPLIED (the decision; built by the tooling workstream): a third-party notices file generated at build** for the
  engine and the admin from the installed packages' licences, with a gate that checks it is complete (the user,
  2026-10-23; §41b's open proposal). The contract: M4-interfaces §6.4 (`THIRD_PARTY_NOTICES.txt` beside `engine.mjs` and
  `admin.mjs`, every bundled package with its licence text, a permissive-licence allowlist in the gate's own config; a
  new gate of the pre-approved kind, logged by tooling).
- **52e Recorded: what the contract decided that the user may want to see.**
  - The order watch is a step of the five-minute `imagery.tick`, each order asked once a day: no third Cloud Scheduler
    job (two of the three free ones are used).
  - An order is a record on its scene (`usgsScenes/{entityId}.order`), written by the functions only; from M4 the rules
    refuse a client's `status: 'ordered'` (an admin could set it with the Firestore SDK in M3), because
    `usgs.markOrdered` checks USGS first and refuses a scene already downloadable.
  - Reminders on days 7 and 12 (USGS deletes an unpaid order after two weeks); an order not delivered in 90 days is
    `expired` (USGS quotes three to four weeks after payment); Order again restarts it.
  - Automatic GCPs: a pair joins the fit on its own from a confidence of 0.6; between 0.3 and 0.6 it is only a
    suggestion the admin accepts and saves. From 15 confident pairs a fifth is held out as true checkpoints, which
    measures the checkpoint RMSE more strictly than M3's leave-one-out, so a borderline frame may now wait for Approve
    instead of publishing on its own.
  - Notifications: an in-app inbox per admin with a badge, and FCM web push only after the admin turns it on and the
    browser's own prompt is allowed; **UNVERIFIED** that FCM accepts tokens made with the SDK's default VAPID key (else
    Setup gains one console click). `fn-admin@` and `fn-events@` gain `roles/firebasecloudmessaging.admin`
    (**UNVERIFIED** as the narrowest role); Provision enables `fcm.googleapis.com` and `fcmregistrations.googleapis.com`.
  - Swipe compare makes a second Mapbox map load only on a window 600 px or wider; a phone gets a toggle on its one map.
  - New budgets, each logged by its owner when measured: the engine's `compare` chunk (a new `ENGINE_CHUNK_BUDGETS`
    table, at most 12 KB gzip) and the admin's `inbox` chunk.
- **52f PROPOSED, NOT APPLIED: e-mail notifications without a new provider.** A log-based alert policy per notification
  kind on the fan-out's structured log entry, sending through the Cloud Monitoring e-mail channel the `crash-alerts`
  provision item already creates for the owner. Not applied: alert conditions may be billed (**UNVERIFIED** at the time
  of the decision), one policy per kind is ten more cloud resources, and the in-app inbox and push cover the need. For
  the user's yes or no.
- **52g PROPOSED, NOT APPLIED: detect an order without the I ordered it click** through M2M `tram-order-search` and
  `tram-order-status` (`docs/research/design-review-onboarding.md` §0.4, **UNVERIFIED** for on-demand scans). Needs the
  first real order to see what they answer; until then the click is the one input after the purchase.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`; the shared, admin and ui (`map`) Vitest projects for
the edited files.

## 53. The M4 tooling workstream: Terra Draw 1.38.0 and the third-party notices (2026-10-24) — 53a and 53b APPLIED (the user's decisions §52c and §52d; a new gate and a stricter `release` stage, the pre-approved kind); 53c recorded for the user; 53d PROPOSED, NOT APPLIED

No gate was relaxed, no checker allowlist entry was added, and the only download was the approved `terra-draw@1.38.0`.
Configuration edits, each of the pre-approved kind (a stricter gate, or keeping a tool working): the `notices` gate in
`scripts/ci/pipeline.py` (stages `build` and `release`), and a project reference to `packages/ui` in
`tsconfig.tools.json` (the Vite configs read the kit's font table).

- **53a APPLIED: `terra-draw` 1.37.0 → 1.38.0** (§52c). `npm view terra-draw@1.38.0` (MIT, no dependencies, no peer
  dependencies, published 2026-10-18), then `npm install --save-exact terra-draw@1.38.0 --workspace @hcm/ui` in the
  digest-pinned `node:24-bookworm-slim` (`docs/SETUP.md` → *npm in a container*): one package changed
  (`packages/ui/package.json` and its two lockfile lines; the lockfile's integrity is the registry's). The `HELD` entry
  went in the same change (`scripts/ci/check_dependency_updates.py`, `docs/CI_PIPELINE.md` → *Held dependencies*).
  `terra-draw-mapbox-gl-adapter` stays at 1.5.0: it is the adapter's latest release and peers `terra-draw ^1.0.0`, so
  1.38.0 needs nothing of it and there is nothing to propose. Verified: the drawing unit tests
  (`packages/ui/test/map/draw/`, 67 tests, the real Terra Draw on a canvas among them), the admin's drawing and dragging
  specs (`e2e/admin/specs/pois/drawing.spec.ts`, `dragging.spec.ts` at `admin-c360-ro` and `admin-l1440-ro` with the
  tier's setup: 17 passed), and `tsc -b` of `packages/ui` (the declarations of 1.38.0 still need only what
  `terra-draw-env.d.ts` declares). The `terra-draw` chunk measures 47.7 KB gzip (47.4 KB with 1.37.0), under its 58 KB
  budget, which stays. With the other M4 workstreams running gates in the same tree, the new lockfile's digest was
  written to `node_modules/.hcm-install-stamp` (`npm install` had already brought `node_modules` to it), so the next
  pipeline run does not `npm ci` under their tests; the quality image still rebuilds its npm layer on the next
  `run-all-checks.sh`, as after §44 (the lockfile is one of its inputs).
- **53b APPLIED: the third-party notices** (§52d; contract M4-interfaces §6.4).
  - **The generator** is the Vite plugin `thirdPartyNoticesPlugin` (`scripts/site/src/notices.ts`) in both Vite
    configs, not the contract's `scripts/build/notices.mjs` (CR-M4-10): it reads Rolldown's own module list of each
    output, and `scripts/site` is the build tooling with its own Vitest project, measured at 90 % per file (this file
    and `licence-texts.ts` at 100 %). A package is bundled when one of its modules renders code into a chunk
    (`renderedLength` above zero); it is the folder under the last `node_modules/` of the module's path, named by its own
    `package.json`. The fonts' two packages join through the kit's font table (`FONT_FILES`), each with the files copied
    from it (`File:` lines). It writes `THIRD_PARTY_NOTICES.txt` beside `engine.mjs` and `admin.mjs`, sorted, without a
    date: on 2026-10-24 the engine's lists 14 packages (98 KB), the admin's 25 (178 KB).
  - **Packages without a licence file.** The npm packages of the Firebase JS SDK (`firebase` and every `@firebase/*`
    bundled, 13 in the admin), `terra-draw` and `terra-draw-mapbox-gl-adapter` ship no `LICENSE`. Their entry carries
    the copyright lines of their bundled files (`Copyright 2019 Google LLC`, `Copyright The Closure Library Authors`,
    …), or, when there is none, their `author` (Terra Draw and its adapter: James Milner), then the standard text of
    the licence they declare, from `scripts/site/src/licence-texts.ts`: the Apache License 2.0's terms as
    `material-symbols` 0.48.0 ships them (the appendix on applying the licence left out), and the MIT License as `zod`
    4.6.6 ships it, without its copyright line. A package without a licence file whose licence has no text there stops
    the build.
  - **The gate** `notices` (`scripts/ci/check_notices.py`, 100 % of its lines and branches in `scripts/ci/tests`), in
    `build` after `vite-build` and in `release` (so the bundles a release attaches carry complete notices), checks each
    file against evidence the plugin does not write: the build's source maps (`sourcemap: true` in both configs) and
    the installed packages. Every package a source map names has its entry with the same version, the licence id its
    `package.json` declares and a licence text; an entry naming copied files names files the build ships, from the
    installed package at that version; no other entry; every font file shipped is named; every licence is on
    `ALLOWED_LICENCES`, the contract's list (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, OFL-1.1, 0BSD, CC0-1.0).
    The source maps and the plugin agree on both builds today (no entry missing, none extra).
  - **Where the files go**: the site build copies every file of the engine build, the notices with them; the release
    attaches `packages/engine/dist/*` and `packages/admin/dist/*`; Hosting serves `packages/admin/dist` (it ignores only
    dotfiles and source maps), so the admin's notices are at `/THIRD_PARTY_NOTICES.txt`.
- **53c Recorded: what the notices leave out, for the user's review.** The bundler's own helpers (Rolldown's runtime,
  Vite's preload helper: generated code, not a package's files) and Mapbox GL JS (external, loaded from Mapbox's CDN
  under Mapbox's terms). For the packages that ship no licence file, the entry is the best the installed package gives:
  Terra Draw and its adapter name their author but ship no copyright line; comparing those two entries once with the
  `LICENSE` of their upstream repository (`JamesLMilner/terra-draw`) is a reading the user may want (nothing was
  downloaded for it).
- **53d PROPOSED, NOT APPLIED: a visible link to the notices.** The viewer's attribution control and the admin's menu
  could link `THIRD_PARTY_NOTICES.txt` ("Licențe" / "Licences"). Not applied here: it is a user-visible behaviour (two
  strings in both languages, a scenario row per surface, tour states), outside the tooling workstream's files, and the
  file is reachable without it (beside the engine, on Hosting, in the release).

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`; the `tools` Vitest project
(`scripts/site/test/notices.test.ts`), the ui project's `packages/ui/test/map/draw/`, `scripts/ci/tests` in the image,
`npm run build` then `python3 scripts/ci/check_notices.py`.

## 54. The M4 assists-notify workstream: title suggestions, translation drafts, the inbox and push (2026-10-24) — 54a and 54b APPLIED (a stricter configuration and stricter budgets, the pre-approved kinds); 54c–54h decided within the contract and recorded for the user; 54i PROPOSED, NOT APPLIED

Written by the assists-notify workstream (`docs/research/M4-interfaces.md` §4, §5, §6.1). Nothing was deployed, no
download was made and no real Nominatim, Vertex AI or FCM endpoint was called: the functions run against the shared fake
upstreams (`@hcm/test-support/fakes`: `nominatim`, `vertex-ai`, `fcm`) and the Firebase emulators.

- **54a APPLIED: the M4 feature folders join `functions-feature-folders-independent`** (`.dependency-cruiser.cjs`): `assist`
  and `notify` reach the rest of the backend only through `ports/`, `api/` and `@hcm/shared`, as the M2 and M3 folders do
  (a stricter rule, the pre-approved kind §46c names).
- **54b APPLIED (stricter budgets and a build group, the pre-approved kinds): the inbox's chunks have budgets.**
  `scripts/ci/check_bundle_budget.py` `ADMIN_CHUNK_BUDGETS` gains `inbox` 5 KB, `messaging-sdk` 7 KB and
  `firebase-installations` 4 KB, `assist` 3 KB and `firebase-messaging-sw.js` 1 KB (the push service worker the admin
  page build writes beside the chunks, which the gate counts); `packages/admin/vite.config.ts` gains the code-splitting
  groups `firebase-installations` (`@firebase/installations`, priority 2), without which Rolldown put it into
  `editor-shared` (14.3 KB of 13; at priority 4 it pulled modules of the first load with it), and `assist` (the editors'
  assists, which the photo, place and layer editors share: in `editor-shared` they made it 13.2 KB of 13). Measured on
  2026-10-24: `inbox` 3.4 KB, `messaging-sdk` 5.7 KB, `firebase-installations` 2.9 KB, `assist` 2.2 KB, the worker
  0.7 KB, `editor-shared` 11.6 KB. The remaining over-budget chunk of that build, `imagery` (18.2 KB of 18), is the
  orders workstream's.
- **54c DECIDED: FCM over its REST API, and the browser's registration is its Firebase installation ID.** The functions
  send with FCM HTTP v1 over REST (`functions/src/adapters/fcm.ts`, the functions' own token, one `messages:send` per
  device, a `validate_only` dry run before a device is stored), not firebase-admin's `getMessaging()`, so the Functions
  emulator reaches the fake FCM through `createEmulatorFetch` like every other Google API and no local run can push to a
  real browser. The installed `firebase@13` deprecates `getToken` (ESLint's `no-deprecated` refuses it, and no suppression
  is allowed): the admin registers with `register` and reads the installation ID (FID) from `onRegistered`
  (`packages/admin/src/firebase/messaging.ts`), and the functions target it as `message.fid`, exactly as firebase-admin
  14.5's `FidMessage` sends it. The shared schemas keep the field's name `token` (`notify.registerDevice {token}`,
  `pushDeviceDocSchema.token`): an FID matches its pattern. UNVERIFIED (CR-M4-24 asks §10 of the contract to list it): that FCM's REST API
  accepts `fid` from our REST call as it does from firebase-admin; proof: the first `notify.sendTest` after Provision. An
  FID that rotates later (the SDK registers it again only while an `onRegistered` handler is set, and ours is removed once
  the registration is read) makes FCM answer `UNREGISTERED`: the device is forgotten and the admin turns push on again.
- **54d DECIDED: an admin's settings document records its creation, and a read item's time is its stamp.** The settings
  (`admins/{uid}/notify/settings`) are created by the admin's first Settings change through the content store, which
  stamps `createdAt`: `notifySettingsDocSchema` gains `createdAt` (optional, create only), as do `CLIENT_WRITES` and the
  rules (`createdAt == request.time` on create, never changed by an update), and `notify.registerDevice` keeps it. Marking
  an item read writes `read: true` with the stamp (`updatedAt` is when); the rules still allow `readAt` only as
  `request.time` for a client that sends it.
- **54e DECIDED: the admin's push service worker is plain JavaScript, and the `e2e` build has a stand-in registrar.**
  The site build writes `firebase-messaging-sw.js` next to the admin's page (`scripts/site/src/admin/service-worker.ts`):
  no Firebase SDK and no `importScripts` from a CDN (the CSP, and no third-party code in the worker); it shows a push's
  `notification` (title, text, tag) as text and opens its `fcm_options.link` on the admin's own origin only. UNVERIFIED:
  the payload's field names on a real push (proof: the first `notify.sendTest`). The `e2e` build's registrar keeps the
  browser's real permission (Playwright grants it, or the Chrome DevTools Protocol denies it) and hands out a fixed
  registration per `?test=` (`e2e-fcm-token:<test>-browser-0001`), since no browser test may reach FCM; the server side
  is the fake FCM.
- **54f DECIDED: what Provision adds.** `REQUIRED_APIS` gains `aiplatform`, `fcm` and `fcmregistrations`; `fn-admin@`
  gains `roles/aiplatform.user` (the drafts and the self-test's `countTokens`) and `roles/firebasecloudmessaging.admin`
  (the test push and the device's dry run); `fn-events@` gains `roles/firebasecloudmessaging.admin` (the fan-out's pushes).
  The narrowest FCM role stays UNVERIFIED (contract §10).
- **54g DECIDED: shared pieces the producers use.** One emit helper for every producer
  (`functions/src/api/notification-event.ts`: the event's id from its parts, `create` so a redelivery writes nothing, a
  failure logged and never thrown into the producer); the admin shell's watchers (the session, the unread badge) moved out
  of `packages/admin/src/app/mount.ts` into `app/shell-watches.ts` to keep `mount.ts` within its size. The fan-out records
  a push on the item as it is now (a transaction), so an item the admin opened while FCM was sending stays read.
- **54h DECIDED: the notification and assist specs hold the admin tier's lock.** The geocoding queue's cool-down
  (`ops/assist`) and cache (`assistGeocodes/*`), the month's AI counters (`usage/ai-*`), the inboxes, the events and the
  server's fake upstreams are one per project, so `e2e/admin/specs/{assists,notify}/` run as the owner on the project's
  city under `ADMIN_LOCK`, whose reset empties them. An event fans out to every admin, and an unlocked content spec may
  fail a job of its own city meanwhile (`specs/imagery/jobs.spec.ts`): the specs look for their own items and never count
  an inbox exactly.
- **54i PROPOSED, NOT APPLIED: e-mail.** No e-mail is sent: the stack has no mail provider and adding one is a new
  account. The path without a new provider (a log-based alert policy on the fan-out's structured log, through the
  Cloud Monitoring e-mail channel the `crash-alerts` item creates) stays the contract's proposal (§52f, contract §5.7),
  for the user to decide.

## 55. The M4 compare workstream: our own swipe compare, and the public site reading the bucket's manifest (2026-10-24) — 55a–55d APPLIED (product and test changes; 55b a stricter gate and 55c a build setting, the pre-approved kinds; no gate relaxed, no checker allowlist entry); 55e PROPOSED, NOT APPLIED (a workflow line, ask first)

The compare workstream built swipe compare as the user decided (§52a; `docs/research/M4-interfaces.md` §3) and aligned
the public site with the PLAN (§51e). Nothing was downloaded and no real endpoint was called.

- **55a APPLIED: the public site reads the manifest the admin publishes** (§51e; PLAN → *Architecture*: the public viewer
  GETs `gs://<project>-public/cities/{city}/manifest.json`). `sites/bucharest/site.json` says `publicManifest: true`; a
  site build that names the public bucket (`HCM_PUBLIC_BUCKET`, forwarded by `scripts/ci/run-all-checks.sh` by name like
  `MAPBOX_PUBLIC_TOKEN`) writes a generated `config.js` whose `manifestUrl` is
  `https://storage.googleapis.com/<bucket>/cities/bucharest/manifest.json`, bundles no `data/` snapshot, and adds the
  bucket's origin and the project's crash-report endpoint (`https://<region>-<projectId>.cloudfunctions.net`, from
  `infra/project.json`, the functions' own formula) to the page's CSP (`scripts/site/src/public-manifest.ts`). Without a
  bucket every site bundles its manifest as before (the starter kit always does). The viewer never reads Firestore. Rows
  `S-V01-HAPPY-PUBLIC-BUCKET` and `S-V01-BAD-PUBLIC-BUCKET-404` (`e2e/specs/viewer/public-manifest.spec.ts`, the e2e site
  `bucharest-bucket`; a bucket without the manifest shows the not-found card, never a stale snapshot). For the go-live
  the user sets the repository variable and approves 55e; until then Pages keeps the seed snapshot.
- **55b APPLIED (a stricter gate, the pre-approved kind): the engine's lazy chunks have budgets.**
  `scripts/ci/check_bundle_budget.py` gains `ENGINE_CHUNK_BUDGETS`: `compare` 5 KB (4.2 KB measured, the contract's
  ceiling 12 KB) and `firebase-sdk` 16 KB (13.3 KB measured, unbudgeted until now); a chunk of the engine without a
  budget fails, as the admin's do. Measured on 2026-10-24: `engine.mjs` 97.5 KB of 100 (96.0 before compare),
  `engine.iife.js` 116.6 KB of 125.
- **55c APPLIED (a build setting that keeps the entry whole): `preserveEntrySignatures: 'allow-extension'`** in
  `packages/engine/vite.config.ts`. Vite's library default (`strict`) moved everything the compare chunk shares with the
  entry into a third chunk, `map-sync-<hash>.js` (44.6 KB), which `engine.mjs` imported at once; now the chunks import what
  they share from `engine.mjs`, which may carry those internal exports besides the documented ones (only the names of
  `docs/ENGINE_API.md` are the API). The IIFE is one file as before.
- **55d APPLIED: what the build decided within the contract** (`docs/research/M4-interfaces.md` → *Change requests*,
  CR-M4-10):
  - The legal line is the viewer map's: its Mapbox logo and attribution (z-index 2 in mapbox-gl.css) stay above the
    second map at every divider position, the second map's own are hidden, and the compare bar credits the compared
    layer's source ("Sursa: …"); the contract had the second map's attribution on the right, which a divider at 100 %
    clips away. The legal mirror of a modal sheet keeps reading the viewer map, as before.
  - The second map is inert and lets every pointer through: the viewer's map takes every gesture and the second follows
    its camera, so either side drags, zooms and clicks alike, and no second canvas is a keyboard stop. The divider's
    handle is the only drag target; it sits below the map's centre (the centre stays the map's) and, on a phone held
    landscape, ends before the vertical timeline.
  - MapPort's `move` is forwarded at once (Mapbox fires it once per rendered frame), not a frame later as the contract
    said, so the followed map draws the same camera in the same frame.
  - The chunk's entry is `packages/engine/src/compare/compare.ts` (Rolldown names a chunk after its entry file:
    `compare-<hash>.js`), reached through `import('./compare/compare.js')` in `mount.ts`'s browser environment.
  - The chooser of the compared side is a native `<select>` (the browser's own list on every device, no popup to keep
    clear of the controls); the tour's `viewer.compare-menu` is the state after choosing. The edge states are
    `viewer.compare-swipe-edge` (0 %) and `viewer.compare-swipe-edge-end` (100 %).
  - A drag settles the divider on the whole percent, as the keys and the hash do.
- **55e PROPOSED, NOT APPLIED (a workflow edit, ask first): the CI build reads the bucket.** One line in
  `.github/workflows/ci.yml`, job `build`, step `Build stage`, `env:` beside `MAPBOX_PUBLIC_TOKEN`:
  `HCM_PUBLIC_BUCKET: ${{ vars.HCM_PUBLIC_BUCKET }}`, and the repository variable itself
  (`gh variable set HCM_PUBLIC_BUCKET --body bucurestiul-disparut-public`, a settings change: ask first) once the admin has
  published the city's manifest. Unset, the Pages site keeps bundling the seed snapshot.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`; the engine, ui and tools Vitest projects; the build
and `scripts/ci/check_bundle_budget.py`; `E2E_TIER=fn npx playwright test specs/viewer/compare.spec.ts
specs/viewer/public-manifest.spec.ts --project fn-l1440-ro` and the tour's compare journey at every viewer viewport.

## 56. The M4 integrator: the change requests closed, the cross-app journey, and what waits for the user (2026-10-24) — 56a–56e APPLIED (product, test and documentation changes; 56b a new lazy chunk with its own budget, the pre-approved kind; no gate relaxed, no budget raised, no checker allowlist entry); 56f recorded for the user

The M4 integrator worked alone after the five workstreams (orders, autogcp, compare, assists-notify, tooling), resolved
their open change requests and checked the flows across the apps against the emulators and the fakes. Nothing was
downloaded, committed, pushed or deployed, and no real Google, Mapbox, USGS, STAC, Nominatim, Vertex AI or OpenStreetMap
endpoint was called. The user's decisions of 2026-10-23 stand as §52a–§52d record them, all four APPLIED: swipe compare
is the engine's own (the plugin loader, its Subresource Integrity plan §18b and the M2 open item are superseded; no
source names `mapbox-gl-compare` any more), the Romanian and English drafts go through Vertex AI Gemini on the server
(turned on by Provision, never published by themselves), `terra-draw` is 1.38.0 with its hold removed, and both builds
write a complete `THIRD_PARTY_NOTICES.txt` that the `notices` gate checks (complete for the engine since 56a).

- **56a APPLIED: the open change requests.**
  - CR-M4-11: the Firestore adapter's `buildQuery` converts every filter operand as it converts a stored value
    (`toFirestoreValue`), so a timestamp range matches; M3's daily cap of raster jobs (`JOBS_PER_DAY`) now counts the day's
    jobs in production. Pinned on the emulator (`functions/test/adapters/documents.test.ts`).
  - CR-M4-19: the notices plugin no longer clears what it gathered at each `buildStart`; one plugin instance lives for
    one `vite build`, whose library mode starts one build per format, so the file written last lists both formats'
    packages (`lit` from the IIFE's inlined compare chunk). `[notices] OK`, 13 engine packages.
  - CR-M4-14: the obsolete `adminContent.imagery.needsOrderNote` is gone from both catalogues.
  - CR-M4-24: `docs/research/M4-interfaces.md` §5.4 and §10 describe the push registration as built (the installation
    ID, `message.fid`), with its proof by the first `notify.sendTest`.
  - CR-M4-25: the public bucket's address in `S-V01-HAPPY-PUBLIC-BUCKET` is in backticks; `docs/E2E_SCENARIOS.md`
    regenerated, `markdownlint` passes.
  - CR-M4-9: the docs, the skills and their mirrors, `docs/LESSONS.md` 190–202, `docs/research/M4-status.md`.
  - Two specs the split `quality` run found (test changes only): the title-suggestion spec counts the Nominatim
    requests of its own cell, since a content spec drawing a place beside it asks for the city's centre in the same
    server world (`docs/LESSONS.md` 201); the Setup steps' self-test spec counts `SELF_TEST_CHECKS.length`, which M4's
    `ai` check made ten (`docs/LESSONS.md` 202).
- **56b APPLIED (a new chunk with its own budget, the pre-approved kind): the order card is a lazy chunk.** With M4's buy
  flow the Imagery area's chunk measured 18.2 KB against its 18 KB budget (§47a). The budget was not raised: the order
  card, which only a scene to buy or with an order shows, is fetched the first time such a scene opens
  (`packages/ui/src/admin/imagery/orders/lazy-card.ts`: Loading until it is in, a failed fetch says so with Try again,
  `ImageryContext.refresh` re-renders the page once it is in). `ADMIN_CHUNK_BUDGETS` gains `order-card` 2 KB (1.7 KB
  measured on 2026-10-24 plus about 20 %); `imagery` measures 17.6 KB. A codeSplitting group was tried first and
  dropped: Rolldown's groups take what their modules import along, and every area then imported the group
  (`.agent/skills/quality/pipeline_skill.md` → *Local tooling quirks*).
- **56c APPLIED: behaviour A48, the cross-app journey** (`e2e/admin/specs/imagery/automation.spec.ts`; rows
  `S-A48-HAPPY`, `S-A48-BAD-OVER-THRESHOLD`). Happy: the free 1966 frame imported with one click and published; the
  1968 frame to buy through its order card (EarthExplorer, then I ordered it: the `buyScan` budget); the fake USGS
  delivers and a day passes (`order.nextCheckAt` written in the past); `imagery.tick`'s watch imports it (the job created
  by the admin who ordered); the stand-in pipeline's automatic points under the threshold; approved by `system:imagery`
  and published by the fake MTS with no click; the next tick marks the order imported; the inbox lists
  `order.delivered` and `order.imported`, whose item opens the published version; the manifest lists both layers, and
  the public viewer at a wide window compares the bought scan with the 1966 layer on two maps (the divider names both
  sides, each side's tiles in its colour; Close leaves one map: created 2, removed 1). Bad: over the threshold the
  version waits for Approve, the inbox's `layer.readyToApprove` item opens it, nothing reaches Mapbox. The spec is tiered
  with M3's publish specs (`IMAGERY_PUBLISH_SPECS` in `e2e/projects.ts`: per push at `admin-c360-ro` and
  `admin-l1440-ro`, at the other three admin projects in `tour-matrix`).
- **56d APPLIED: the local stack's M4 world** (`npm run dev:stack`): the 1968 Corona frame stays one to buy (its preview
  seeded), the Declass 3 frame is marked as ordered through `usgs.markOrdered`, the 1976 import waits for points with the
  matcher's suggestions (the stand-in's `suggestions` outcome instead of `no-match`), and the failed import, the draft
  over the threshold and the version waiting for points reach every admin's inbox through the server's own events. The
  stack's check gains the order card and the inbox (`e2e/stack/check.ts`). `docs/MANUAL_TEST_PLAN.md` gains section F
  (O1–O5, G1, A1, A2, N1, N2), V11 (compare) and the go-live's bucket variable (V0, D7).
- **56e APPLIED: the documentation** of M4: both admin guides (buying a scan, suggested pairs, title suggestions, drafts,
  notifications, the visitors' compare, costs, troubleshooting), `docs/ARCHITECTURE.md` (the M4 functions, 61 in all),
  `docs/TESTING.md`, `docs/CI_PIPELINE.md`, the build and deploy workflows (`HCM_PUBLIC_BUCKET`), the quality skills
  (`ENGINE_CHUNK_BUDGETS`, `order-card`, the M4 tooling quirks) and the e2e skills with their mirror.
- **56f Recorded: what waits for the user** (each ask first; `docs/research/M4-status.md` §3): the deploys (functions,
  rules and indexes, the admin, the pipeline image with the new matcher), Provision turning on Vertex AI (the paid EEA
  tier, under 0.05 USD a month, capped at 0.50 USD), FCM and FCM registrations, the first real scan purchase in
  EarthExplorer (35 USD for one frame; Claude never pays), the CI line of §55e with the `HCM_PUBLIC_BUCKET` variable,
  the proposals §52f (e-mail through a log-based alert), §52g (detecting an order without the click), §53d (a visible
  licences link) and §54i (e-mail), and the advisories of §48a and §49i that keep the four audit gates red (bumps
  applied 2026-10-25, §64).

Verify: `PIPELINE_STAGE=static`, `tests`, `build` (`bash scripts/ci/run-all-checks.sh`) and `PIPELINE_STAGE=quality bash
scripts/ci/e2e-split.sh`; `E2E_TIER=admin npx playwright test specs/imagery/automation.spec.ts --project admin-l1440-ro`.

## 57. The M4 reviews' fixes: security, cost and minimum input (2026-10-24) — 57a–57i and 57k–57o APPLIED (product, test and documentation changes; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry); 57d's approval-policy guard, 57h's probe, 57i's import map and 57j PROPOSED, NOT APPLIED

Two reviews of the M4 working tree (security and cost; minimum input and UX) found 24 problems, two of them the same.
Every one was applied as below or is proposed for the user's decision; none was wrong. Rows:
`S-A13-BAD-SCANNED-WHILE-MARKING`, `S-A13-BAD-WAITS-FOR-APPROVAL`, `S-A45-BAD-DAILY-CAP`, `S-A45-BAD-LINKS-CHANGED`,
`S-A47-BAD-SHARED-BROWSER`, `S-P03-BAD-NO-SPREAD` (new) and the asserts of `S-V06-BAD-COMPACT-WIDTH`, `S-A09-HAPPY-TITLE-SUGGESTION`,
`S-A09-HAPPY-TRANSLATE-DRAFT`, `S-A13-BAD-NEVER-DELIVERED`, `S-A44-HAPPY`, `S-A46-HAPPY-FAN-OUT`; the defects in
`docs/LESSONS.md` 203–218.

- **57a APPLIED: the editors' assists.** A translation draft answered after another item opened is dropped (the session
  counts the open item; it filled the next photo's title before). A queued title cell no answer reaches within
  `GEOCODE_QUEUED_MINUTES` ends the wait with `apiError.assist.unavailable`, so Suggest a title works again. A photo's
  pin asks for suggestions by itself while nobody chose its title: empty, a camera's naming (`isCameraName`, shared with
  `photos.onUpload`) or the title its file gave it (`suggested.title`); every upload starts titled after its file, so a
  real upload never asked before. A draft is offered only for an empty side (it replaced typed text), its note stays
  once it filled the field.
- **57b APPLIED: the inbox's pruning costs a few reads.** `notify.onEvent` read the newest 250 items of every admin's
  inbox on every event (about 200 reads each once full). `DocumentStore` gains `count` (an aggregation: one read per
  thousand documents); the inbox is counted and only its items over `INBOX_MAX_ITEMS`, oldest first, are read and
  deleted.
- **57c APPLIED: compare reuses its second map across window changes.** A compact window hides the second map (its
  container stays, `visibility: hidden`, so Mapbox is never sized to nothing) for `COMPARE_PARK_MS` (60 s) and destroys
  it then; a wider window within the minute shows the same map (a phone turned back and forth, a window dragged across
  600 px paid a map load each time). Close, Esc, a lost map and `destroy()` destroy it at once. The chooser leaves out
  what the main side shows, unless it is the side compared now (both sides could show the same layer).
- **57d APPLIED in part: the automatic georeference's edges are measured.** The integration tests asserted the median
  distance from the truth only; the largest (a corner, outside the matched pairs' hull, where `poly2` extrapolates) was
  14.1, 11.7 and 23.4 m. They now assert both: the median within `EXPECTED_RMSE_M` (15 m) and the largest within
  `EDGE_ERROR_M` (30 m); `M4-status.md` says so instead of "within 15 m". **PROPOSED, NOT APPLIED:** an edge guard in the
  approval policy (checkpoints chosen near the hull, or `poly2` refused when it bends more than the threshold outside
  the hull) would hold such a version for Approve; it changes when bought scans publish by themselves, so it waits for
  the `real-data` measurement on a real Corona frame and your decision.
- **57e APPLIED: a daily cap on title suggestions.** `ops/assist` counts the cells queued on the UTC day
  (`queuedDay`, `queuedToday`); past `GEOCODE_DAILY_CAP` (300, far above an admin's real use) the answer is
  `apiError.assist.dailyCap` and nothing is queued, so no scripted session can keep Nominatim busy (its policy forbids
  bulk use). The cool-down's write keeps the count (a transaction). A task the queue refuses takes its cell back.
- **57f APPLIED: a browser stops getting an admin's notifications when it should.** The push record in `localStorage`
  names its admin (`{uid, deviceId}`, `packages/admin/src/inbox/push-device.ts`): another admin signed in sees push off;
  sign-out unregisters this browser for the admin (best effort) and forgets it; `notify.registerDevice` removes the same
  browser from every other admin (one browser, one admin); `admins.revoke` deletes the removed admin's push devices,
  inbox and notification settings first, while the account is still an admin's (its open page then sees its inbox
  emptied, not a listener denied mid-edit, LESSONS 218), then the access document; turning push off when the server
  cannot be reached leaves it on and says why.
- **57g APPLIED (a cloud change on the next Provision, ask first as always): a custom role for Vertex AI.**
  `roles/aiplatform.user` also lets `fn-admin@` start billable custom jobs and deploy endpoints. The `iam` item now
  makes the project's custom role `hcmVertexDrafts` (`aiplatform.endpoints.predict` only) before the role table binds
  it to `fn-admin@`, undeletes and corrects a deleted or changed one, and leaves a right one alone; the permission
  messages name it. UNVERIFIED until the first real call (M4-interfaces §10): that `aiplatform.endpoints.predict` is all
  `generateContent` and `countTokens` of a publisher model need; the setup self-test's `ai` check proves it for free,
  and if it does not, adding the missing permission to `VERTEX_DRAFTS_PERMISSIONS` and running Provision again repairs
  the role.
- **57h APPLIED: the EarthExplorer guide no longer claims an unverified button.** Only the scene's page was verified
  (`design-review-onboarding.md` §0.6); step one now says to add the scene to the basket from the search results.
  **PROPOSED, NOT APPLIED:** checking the basket control in `check_contracts.py`'s weekly probe: EarthExplorer draws its
  controls with JavaScript, so a plain HTTP probe cannot see them; the first real order confirms the steps.
- **57i APPLIED (documentation): SRI and the lazy chunks.** `docs/ENGINE_API.md` says that `integrity` covers only the
  file it is on, that `engine.mjs` fetches `compare-<hash>.js` and `firebase-sdk-<hash>.js` without one, and that a page
  relying on SRI loads `engine.iife.js`, which carries both. **PROPOSED, NOT APPLIED:** publishing an import map with
  `integrity` entries for the module build's chunks with each release.
- **57j PROPOSED, NOT APPLIED: how a shared compare link opens.** A `cmp=` link opens the second map (a map load) for
  everyone it is shared with and on every reload; opening it as the one-map toggle, or with a prompt, would spare that
  load but changes behaviour V06's deep link (`S-V06-HAPPY-DEEP-LINK`), which the plan asked for.
- **57k APPLIED: the orders' screens.** The expired card offers Take the mark back (`usgs.cancelOrder` accepted it, but
  nothing offered it, so Work's count could never go down); a reminder already sent no longer counts in Work and wears
  the waiting tone, and its note tells an admin who paid there is nothing to do; before USGS approves downloads both
  cards say the daily check waits for it, with the link to Setup's USGS step, and the next check reads "after USGS
  approves downloads"; the refusal of I ordered it on a frame scanned meanwhile is also the snackbar's (the card it was
  shown in disappears with the order; an inline alert on the page left the map's attribution a sliver under the app bar
  at 768 px, LESSONS 216), and a refused mark moves the keyboard to the scene's heading
  (`ImageryContext.focusDetail`: the clicked button may go with its card); the checks' times are in the admin's own time
  zone, as the inbox's. The photo editor's banner (the place to check) sets its ring's colour, which fell under 3:1 in
  the dark scheme (LESSONS 216).
- **57l APPLIED: the georeferencer's suggestions.** Each pending suggestion's distance is computed from the page's live
  fit (`distanceFromFit`), not the matcher's stored residual; Accept all leaves the keyboard on the panel's heading; a
  version whose confident pairs lie in a line waits with `apiError.imagery.noSpread {pairs}` (the pipeline's
  `Decision.degenerate`), not `noMatch`'s "too few".
- **57m APPLIED: the notifications.** `layer.needsPoints` is pushed by default (a bought scan whose automatic points
  failed reached only the inbox); `order.imported` says the scan is imported into a layer version that is published or
  waits; "1 devices" and "1 necitite" are gone (`pluralOf` in `@hcm/shared`; the Romanian badge reads "necitite: 3").
- **57n APPLIED: a draft keeps the source's links.** A description's draft may carry Markdown links, and the viewer
  renders them; text pasted into the source could tell the model to add one. A draft with a link address the source
  lacks (added, changed, or kept as text) is no draft: `apiError.assist.linksChanged` (`draftKeepsLinks`).
- **57o APPLIED (the test world): a seeded running job holds a lease.** The fixes' first split `all` run lost the jobs
  tour's running import at two viewports: another spec's `imagery.tick` (over every city) took it, lease-less, for a lost
  execution and ran it again, and the stand-in runner failed it; a third run found its waiting job dispatched once its
  date (2026-10-24) had passed on the server's wall clock. `seedJob` (`e2e/admin/support/ops.ts`) gives a seeded running
  job a lease held far ahead, as a live pipeline's heartbeat would, and the waiting job's date is in 2100
  (`docs/LESSONS.md` 217).

Verify: `bash scripts/ci/e2e-split.sh` (stage `all`; the four audit gates stayed red on §48a and §49i until their bumps of
2026-10-25, §64).

## 58. The M5 contracts (2026-10-25) — 58a recorded for the user; 58b–58f PROPOSED, NOT APPLIED (workflow edits, possible gate exclusions, the template repository, the npm publish); 58g and 58h for the user's decision; 58i recorded

The M5 contracts agent wrote `docs/research/M5-interfaces.md` alone before the four M5 workstreams (multi-city, release,
kit-cli, export), with the shared schemas, API schemas, error codes, catalogues, input budgets, tour sections and the
56 planned scenario rows it names (CR-M5-1). No lint, tool, workflow or gitleaks configuration changed, no gate was
relaxed, no checker allowlist entry was added, and nothing was downloaded, pushed, tagged, published or deployed.

- **58a Recorded: what the contract decided that the user may want to see.**
  - Membership lives on the admin's own document (`admins/{uid}.cities`: city id to `owner` or `editor`), written by the
    functions only; the custom claim stays `admin: true`. The project's owner creates cities and sets their budgets; a
    city's owner invites and removes that city's admins and exports it; an editor edits its content. Admins from before
    M5 keep every city (the project owner as owner, every other admin as editor), migrated at their first session and by
    `ops.tick`. Resuming the project's budget guard (`imagery.resumeGuard`) becomes the project owner's, since it
    resumes every city's imagery.
  - Switching city reloads the admin page (one city per page load, so no listener of another city survives); an admin of
    one city sees no switcher and no address change. New city takes three inputs (the name, one rectangle, Create); the
    city starts unpublished, with no legacy import, and its first USGS harvest runs at the next five-minute tick.
  - Per-city budgets: a new city gets a quarter of the free Mapbox compute units a month, three raster jobs a day, 100 AI
    drafts a month, 100 title suggestions a day and three exports a day; Bucharest, with no limits, is held by the
    project's caps only, as today. At most 20 cities a project.
  - GitHub Pages: Bucharest stays at the root (its old links keep working), every other city at `/<city>/`; a city's
    site is a committed `sites/<city>/` folder, because the admin holds no GitHub credential.
  - The first engine release is v1.0.0; the release commit holds the built engine in `cdn/engine/` (about 1 MB, no
    source maps) with `release.json` (the SRI of every file), because jsDelivr's GitHub route serves only what a tag
    holds and `dist/` is ignored.
  - The starter kit's template ships no photos (the M1 kit's examples are licensed for București dispărut only) and no
    `config.js`: `<hcm-map-viewer manifest-url="city.json">` is the configuration; its page frame moves into
    `engine.css` (`.hcm-fullpage`, `.hcm-note`), so the kit stays three files.
  - `create-historic-city` has no runtime dependency (one bundled file, the template and the self-host files inside the
    package), runs only the owner's own `firebase` and `gcloud` after a `y/N` per step, and fetches nothing.
  - The export's download is a V4 signed address that lives 15 minutes; the zip stays seven days.
- **58b PROPOSED, NOT APPLIED: GitHub Pages serves the assembled tree** (`.github/workflows/ci.yml`, a workflow edit that
  changes what is deployed: ask first). Once the site build's `--pages` lands (multi-city), the `Upload the GitHub Pages
  artifact` step's `path: dist/site/bucharest` becomes `path: dist/pages`. With only Bucharest's site both trees are
  identical. Verify: `PIPELINE_STAGE=build` (the site build writes `dist/pages`), the V26 rows.
- **58c PROPOSED, NOT APPLIED: the release workflow publishes the engine's release file, its source maps and the CLI's
  package, and purges the `@1` alias** (`.github/workflows/release.yml`; ask first: it publishes more). The `build`
  job's upload adds `cdn/engine/release.json` and `reports/release/create-historic-city-*.tgz`; the `publish` job's
  `files` add them beside the bundles (the maps are already in `packages/engine/dist/*`); a last step, with no
  repository code, requests `https://purge.jsdelivr.net/gh/ventura8/bucurestiuldisparut.github.io@1/cdn/engine/<file>`
  for each file `release.json` lists (best effort; the exact tag needs no purge). The SonarQube gate of the same commit,
  planned since M2, is the pre-approved kind (a stricter check) only if it reuses the SHA-pinned actions `ci.yml`
  already pins; the release workstream applies it then and logs it, else it joins this proposal. Verify:
  `PIPELINE_STAGE=static` (actionlint, the workflow policy and the action pins), then the first tag.
- **58d PROPOSED, NOT APPLIED (only if measured): static gates and the committed `cdn/engine/`.** Minified third-party
  code may trip the suppression scan (a bundled library's comment), EditorConfig (no final newline) or gitleaks (a
  false positive). The release workstream first measures; ignoring the generated folder in Prettier's or ESLint's own
  ignore file keeps a tool working (pre-approved, logged); any exclusion from the suppression scan, EditorConfig or
  gitleaks is a relaxation and waits here with its exact line and the finding that needs it. The preferred way out is
  the `cdn` transform itself (it already removes the source-map line), where a finding allows it.
- **58e PROPOSED, NOT APPLIED (ask first): the starter kit's GitHub template repository**, after v1.0.0 is tagged:
  `gh repo create ventura8/historic-city-map-starter --public`, push the three files of `templates/starter-kit/`, then
  `gh api -X PATCH repos/ventura8/historic-city-map-starter -F is_template=true` (the name is the user's choice).
- **58f PROPOSED, NOT APPLIED (the user's own steps): publishing `create-historic-city` to npm**, after the tag:
  `npm view create-historic-city` (is the name free), `npm login` (the user's account and 2FA), then
  `npm publish reports/release/create-historic-city-1.0.0.tgz --access public`. Claude never types the password or the
  one-time code.
- **58g For the user: whether jsDelivr serves this repository at a tag.** The release skill records jsDelivr's limits as
  150 MB a package and 20 MB a file; the tree is about 76 MB, but this was not probed (no request leaves the machine).
  The probe: open `https://cdn.jsdelivr.net/gh/ventura8/bucurestiuldisparut.github.io@legacy-2022/README.md` once. If
  it is refused, the alternatives are (1) a small repository holding only `cdn/engine/` per tag, which the release
  pushes to (a new secret: ask first), or (2) the engine on npm and `cdn.jsdelivr.net/npm/...` pins (an npm account
  step). Either changes only `engineCdnBase` and the release scripts.
- **58h For the user's decision: the photos licensed for this map only in an export.** The contract includes them (an
  export is the owner's archive, and Bucharest's 45 photos are all `permission-legacy`) and names them in `RIGHTS.md`
  and on the export card. The alternative leaves them out by default, with a box to include them (one more input).
- **58i Recorded: configuration edits the workstreams will make, each of the pre-approved kind and logged by its
  owner**: the CLI's Vitest project in `vitest.config.ts`, its dependency-cruiser rule and the `cities` and `export`
  feature folders in the `functions-feature-folders-independent` rule (`.dependency-cruiser.cjs`), the CLI's entry in
  `knip.json`, its scope in `sonar-project.properties`, the `templates/` root of the agent-asset checker, new
  `ADMIN_CHUNK_BUDGETS` rows (`cities`, `city-budget`, `export-card`), the `notices` gate over the CLI's bundle, and the
  `release` stage's `kit-pins` and `release-cdn` gates.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`; the shared and admin Vitest projects for the edited
files.

## 59. The M5 release workstream: the release scripts and gates, what committing `cdn/engine/` trips, the first release prepared (2026-10-25) — 59a, 59b and 59d APPLIED (stricter gates and configurations, and ignore entries that keep two tools working: the pre-approved kinds); 59c and 59j PROPOSED, NOT APPLIED (an EditorConfig relaxation; the exact publishing lines of §58c); 59e–59g and 59i recorded; 59h for the user, ask first

The release workstream of `docs/research/M5-interfaces.md` (§2, §6.1) built the scripts that write one version
everywhere, the released engine's folder, the starter kit's pins and the notes' pinned addresses, the gates that hold them
together, and measured which static gates read a committed `cdn/engine/`. Nothing was bumped, tagged, pushed, published
or downloaded, and no request left the machine: the bump, `cdn/engine/`, the kit's pins and the notes' block are the last
steps of M5 (§2.6), after the other workstreams' engine changes (kit-cli's `engine.css` frame, CR-M5-5) have landed.

- **59a APPLIED (stricter gates): `kit-pins`, `release-cdn`, `release-pack`, and `release-check` extended.**
  - `kit-pins` (`scripts/ci/check_kit_pins.py`, `static` and `release`): `cdn/engine/release.json` has the shape of
    `engineReleaseSchema` and lists every committed file of `cdn/engine/` with its size and SHA-384; the kit page
    (`templates/starter-kit/index.html`) pins Mapbox GL JS and, in its engine block, `engine.css` and a deferred
    `engine.iife.js` from one pinned jsDelivr folder, each with `integrity` and `crossorigin="anonymous"`, its CSP's
    `script-src`, `style-src` and `font-src` name that folder, and nothing loads from jsDelivr outside the block; with a
    release, every pinned address and integrity is `release.json`'s. Before the first release only the page's shape is
    checked (kit-cli's template passes today, with its placeholder integrity).
  - `release-check` (`scripts/ci/check_release.py`) also requires every dependency of a workspace on another workspace,
    `cdn/engine/release.json` and the kit's pinned folder at the tag's version, and the description's pinned addresses
    (and every `sha384-` value it names) to be `release.json`'s.
  - `release-cdn` (`npm run release:cdn -- --check`, after `vite-build`): `cdn/engine/` is byte for byte the release
    folder of the fresh engine build; it writes `reports/release/engine-addresses.md` for the job summary.
  - `release-pack`: `npm pack --workspace create-historic-city` into `reports/release/` (nothing is published).
  - The `release` stage is now `release-check`, `kit-pins`, `vite-build`, `release-cdn`, `bundle-budget`, `notices`,
    `release-pack`; `static` gains `kit-pins` (69 gates in all). The shared readers are `scripts/ci/release_pins.py`.
- **59b APPLIED (configurations of the pre-approved kinds).**
  - Stricter: `vitest.config.ts` (the `tools` project's coverage scope gains `scripts/release/src/**/*.ts`, so the
    release scripts are held to 90 % per file); `eslint.config.js` (`scripts/release` joins `PRODUCT` and its limits);
    `knip.json` (the root workspace's `project` gains `scripts/release/**/*.ts`); `npm run lint:deps` (over
    `scripts/release` too); `sonar-project.properties` (`scripts/release/src` a source, `scripts/release/test` tests,
    their two tsconfig projects); the root `tsconfig.json` references both projects.
  - Keeping two tools working (measured on a scratch copy of the folder, never in the tree): ESLint reports 7,716
    errors on the minified engine and Prettier 5 unformatted files, so `eslint.config.js` ignores `cdn/engine/**` and
    `.prettierignore` lists `cdn/engine/`, each with its why-comment. The engine's sources stay linted in `packages/`.
- **59c PROPOSED, NOT APPLIED (a relaxation, ask first): EditorConfig on the committed engine.** Measured on the
  release folder `npm run release:cdn` writes from the current build: `cdn/engine/engine.iife.js: line 58: trailing
  whitespace` and `cdn/engine/engine.mjs: line 114: trailing whitespace`. Both are lit-html's
  `` `[ \t\n\f\r]` `` written by the minifier as a template literal whose `\n` became a real line break, so the line
  ends with a space and a tab that belong to the string: stripping them would change lit-html's whitespace pattern, and
  Rolldown's minifier has no option to keep the escape. (The other finding, `engine.css` without a final newline, the
  transform already fixes: every text file of the release ends in a newline.) The narrowest exception, verified on the
  scratch copy (`[editorconfig] OK: 13 files follow .editorconfig`), appended to `.editorconfig`:

  ```ini
  # The released engine (cdn/engine/, docs/research/M5-interfaces.md §2.3): minified third-party code committed byte for
  # byte as jsDelivr serves it, where a template literal of lit-html holds a space and a tab before a line break.
  [cdn/engine/*.{js,mjs}]
  trim_trailing_whitespace = false
  ```

  Alternatives: excluding `cdn` from `cirepo.EXCLUDED_DIRS` (it would also hide the folder from the suppression scan,
  `data-files` and `repo-policy`, which pass on it as it is), or not committing the engine (the npm route of §58g). Without
  one of them the release commit's `static` stage fails on `editorconfig`, so the answer is needed before v1.0.0.
  Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` on the release commit.
- **59d APPLIED: `release.yml` shows the pinned addresses and their integrity.** The `build` job gains one step after the
  release stage, `cat reports/release/engine-addresses.md >>"$GITHUB_STEP_SUMMARY"` (the `release-cdn` gate wrote it
  from `cdn/engine/release.json`: the table of the four pinned addresses with their SHA-384, the `release.json` and `@1`
  addresses, the tags to paste), and its header comment names the new gates. It runs no repository code, needs no
  permission and publishes nothing the tag does not already hold; the stricter checks themselves come from the `release`
  stage (59a). Checked: `actionlint`, `workflow-schema`, `workflow-timeouts`, `workflow-policy`, `action-pins`, yamllint
  and Prettier on the workflow. The artifact upload and the `publish` job are unchanged (§58c stays a proposal).
- **59e Recorded: the rest of the measurement of §2.3.** On the same scratch copy, the suppression scan, gitleaks with
  `.gitleaks.toml` and with `.gitleaks-history.toml` (which has no path allowlist), `data-files`, `repo-policy` (no banned
  account, no secret file) and markdownlint (`fonts/LICENSES.md` is byte for byte `packages/ui/fonts/LICENSES.md`) pass;
  `repo-budget` stays far inside its 60 MB (16.7 MB without `seed/` today, plus about 1.04 MB). No other static gate
  reads the folder (`knip`, `dependency-cruiser`, stylelint, the i18n and scenario checks, Sonar's sources).
- **59f Recorded: what the release scripts decided (`scripts/release/`, `npm run release:{bump,cdn,pin-kit,notes}`).**
  - The bump rewrites the lockfile's workspace entries itself (versions only, four-space JSON as npm writes it), so no
    `npm install` and no download is needed; it also rewrites `functions/deploy-lock/` (`package.json` and its lock),
    whose version `functions/build.mjs` compares with the functions'. A Vitest test runs the bump over the real tree
    read-only and requires no change: every version is aligned today and every file round-trips byte for byte.
  - The release folder keeps every built file but the maps, removes the last source-map line, ends every text file
    with a newline, lists the files in code-point order (no locale in the bytes), takes Mapbox GL JS's integrity from the
    installed npm release and refuses another installed version.
  - The kit is pinned through `fillKitPage` (kit-cli's `packages/shared/src/kit/page.ts`), which rewrites the engine
    block and the CSP; the template's Mapbox GL JS tags must already be the release's, or the pinning stops.
  - The description's block lies between `<!-- hcm:sri -->` and `<!-- /hcm:sri -->` (plain HTML comments, invisible on
    GitHub); `check_release.py` compares its table rows and every `sha384-` value with `release.json`.
  - The About dialog's spec (`e2e/specs/viewer/about.spec.ts`, S-V13-HAPPY) read `'0.0.0'`; it now reads the root
    `package.json`'s version, so the bump changes no test.
- **59g Recorded: v1.0.0 prepared, not tagged.** `docs/releases/v1.0.0.md` and `docs/releases/v1.0.0_github_description.md`
  are written (between the description's markers a sentence says the block comes with `cdn/engine/`), and `docs/ENGINE_API.md` → *Versioning and compatibility* says
  what a release holds and how a page pins it. `python3 scripts/ci/check_release.py --tag v1.0.0` lists what remains,
  the integrator's last steps of M5 (§2.6): `npm run release:bump -- 1.0.0`; `npm run build --workspace @hcm/engine &&
  npm run release:cdn`; `npm run release:pin-kit`; `npm run release:notes -- --write
  docs/releases/v1.0.0_github_description.md`; the notes re-read against what M5 shipped; `all` split with the NUC.
- **59h For the user, ask first, one at a time (after 59c is answered and `all` is green on the release commit):**
  1. the jsDelivr probe of §58g (open its address once in a browser), since the pinned addresses depend on it;
  2. `git push origin feat/engine-rewrite`
  3. `gh pr create --base master --head feat/engine-rewrite --title "feat: M5 multi-city and engine v1.0.0"`, its
     review, then the merge;
  4. on the merged `master` commit, once `all` is green there: `git tag -a v1.0.0 -m "v1.0.0"`;
  5. `git push origin v1.0.0` (CI's `release.yml` then checks, rebuilds and publishes the GitHub Release);
  6. then the template repository (§58e) and the npm publish (§58f).

- **59i Recorded: the SonarQube gate of the tagged commit stays in §58c's proposal.** Reusing `ci.yml`'s pinned scan and
  quality-gate actions in `release.yml` needs the commit's coverage reports there: either the whole `tests` stage again
  on the tag (about 20 minutes more) or the CI run's `coverage` artifact (a cross-workflow download with `actions: read`
  and the run's id). Neither is a stricter check of what the release job already has, so it waits with the publishing
  additions; the lighter design for the user's yes is a step that asks SonarCloud's API for the quality gate of the
  `master` analysis whose revision is the tagged commit (`api/project_analyses/search`, then
  `api/qualitygates/project_status`), with `SONAR_TOKEN` passed by name.

- **59j PROPOSED, NOT APPLIED (ask first: it publishes more): the exact lines of §58c's publishing additions.** The
  `build` job uploads `cdn/engine/release.json` and the CLI's package with the release files; the `publish` job (still
  no checkout, no repository code) names the release file `engine-release.json`, attaches it and the package beside the
  bundles (the engine's source maps already are), then asks jsDelivr to refresh the major alias, best effort. Checked on
  a scratch copy of the workflow: `actionlint`, the GitHub workflow schema, `workflow-policy`, yamllint and Prettier pass.

  ```diff
  --- a/.github/workflows/release.yml
  +++ b/.github/workflows/release.yml
  @@ -59,6 +59,8 @@ jobs:
                         packages/engine/dist/
                         packages/admin/dist/
                         docs/releases/
  +                      cdn/engine/release.json
  +                      reports/release/create-historic-city-*.tgz
                     if-no-files-found: error
                     retention-days: 7
   
  @@ -86,6 +88,10 @@ jobs:
                     title="$(sed -n 's/^# //p' "release/docs/releases/${TAG}_github_description.md" | head -n 1)"
                     echo "title=${title:-$TAG}" >>"$GITHUB_OUTPUT"
   
  +            # The engine's release file under a name that says what it is, beside the bundles on the GitHub Release.
  +            - name: Name the engine's release file
  +              run: cp release/cdn/engine/release.json release/engine-release.json
  +
               - name: GitHub Release
                 uses: softprops/action-gh-release@efb35369e0ad2afab669f228072c1b0d510eae64 # v3.0.3
                 with:
  @@ -95,3 +101,20 @@ jobs:
                     files: |
                         release/packages/engine/dist/*
                         release/packages/admin/dist/*
  +                      release/engine-release.json
  +                      release/reports/release/create-historic-city-*.tgz
  +
  +            # jsDelivr keeps a tag's files for good, but caches what the floating major alias (@1) resolves to: ask it to
  +            # look again for each file of the release (best effort; the exact tag needs no purge).
  +            - name: Purge the major alias on jsDelivr
  +              continue-on-error: true
  +              env:
  +                  TAG: ${{ github.ref_name }}
  +                  REPOSITORY: ${{ github.repository }}
  +              run: |
  +                  major="${TAG#v}"
  +                  major="${major%%.*}"
  +                  jq -r '.files[].path' release/engine-release.json | while read -r file; do
  +                      curl -fsS --max-time 30 "https://purge.jsdelivr.net/gh/${REPOSITORY}@${major}/cdn/engine/${file}" >/dev/null ||
  +                          echo "::warning title=jsDelivr purge::${file} was not purged"
  +                  done
  ```

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` (the four audit gates stay red on §48a and §49i);
the `tools` Vitest project (`scripts/release/test`, 100 % lines and branches per file) and `pytest`
(`test_check_kit_pins.py`, `test_check_release.py`, 100 % per file).

## 60. The M5 export workstream: the static export of a city (2026-10-25) — 60a–60e APPLIED (product, test and documentation changes within the contract, its change requests CR-M5-9, CR-M5-10 and CR-M5-15 to CR-M5-18; 60e a new lazy chunk with its own budget, the pre-approved kind; no gate relaxed, no budget raised, no checker allowlist entry); 60f recorded for the user; 60g waits on multi-city (CR-M5-8, CR-M5-11)

The export workstream built behaviour A53 (a city owner exports the city from Settings) and V28 (the viewer boots from
the export) as `docs/research/M5-interfaces.md` §5 says. Nothing was downloaded, committed, pushed or deployed, and no
real Google, Mapbox, USGS, STAC, Nominatim, Vertex AI or OpenStreetMap endpoint was called: the functions run against
the fakes and the Storage emulator, the admin against the emulators, the V28 page against the mock APIs.

- **60a APPLIED: the server side** (`functions/src/export/`, deployed as `export-start`, `export-download`,
  `export-build`; the group is exported as `export { exportGroup as export }` since `export` is a reserved word).
  `export.start` (a city's owners: the registry's `cityOwner`) refuses a city never published, a red guard, an export
  under way and the day's exports used up (the city's `limits.exportsPerDay`, else three), records the export and queues
  its task. The export id is `x-<YYYYMMDD>-<n>`, the day's `n`-th, so two owners racing compute the same id and the second
  create is `apiError.export.busy`; the task id is `<city>--<export>` (CR-M5-17). `export.build` (`fn-events@`, one
  attempt, two at a time, 1 GiB, 30 minutes) reads the published manifest from the public bucket, plans the files, sums
  their sizes first and streams the zip into `exports/<city>/<export>.zip` through a writer of its own over Node's `zlib`
  (data descriptors, DEFLATE for text, STORE for WebP, GeoTIFF and WOFF2, entries in name order, the export's day as their
  time, no ZIP64), counting and hashing as it streams; anything that fails leaves `failed` with its code and the
  message's parameters (`errorParams`, a schema field the export owns) and no object. `export.download` answers a V4
  signed address of fifteen minutes with the file name as its disposition; the address is never logged. `ops.tick`'s
  new step `exports` expires ready exports past their seven days (deleting the zip) and fails one stuck queued or
  building 40 minutes after it began, which `export.start` no longer counts as busy (CR-M5-17).
- **60b APPLIED: what travels** (§5.1, §5.2). The zip holds the starter kit's page filled by `fillKitPage` (the city's
  name and colour, Romanian first, the engine from `engine/`, a CSP that names only the outside origins the manifest still
  points at), `city.json` (the photos' files beside it, `analytics` empty: no GA4 or Firebase id and no crash endpoint,
  the viewer token kept), a README in both languages before the kit's own, `RIGHTS.md` naming the photos licensed for this
  map only, the engine (`engine.iife.js`, `engine.css`, `fonts/`, `THIRD_PARTY_NOTICES.txt`, copied into
  `functions/dist/export-kit/` by `functions/build.mjs` with `kit.json`, CR-M5-9) and, when asked, the COG of each USGS
  layer's current version. Only what the city publishes travels: a photo without a licence or not published is not in
  the manifest, so its files are never read (row `S-A53-BAD-UNLICENSED`, added). The photos licensed for this map only
  travel and are named (§58g, the contract's default, stays the user's decision).
- **60c APPLIED: the card** (Settings → Export the city, CR-M5-10): the intro, Include the USGS scans with their size
  (only when the city has USGS scans), Export; the latest export live (waiting, being prepared, ready with its size,
  counts, SHA-256 and expiry, failed with its reason, expired), Download, which saves the signed address through a link
  the page follows once and drops; an editor sees it read-only, a city never published says to publish it first. A ready
  export whose time is up reads expired before the tick marks it. Inputs: `exportCity` 2, `exportWithRasters` 3.
- **60d APPLIED: the tests.** Functions (fakes and the Storage emulator): `functions/test/export/*` and the adapters'
  (`url-signer`, `storage-writer`, `export-kit`), `functions/test/ops/exports.test.ts`; rows `S-A53-HAPPY-RASTERS`,
  `-HAPPY-RIGHTS`, `-BAD-TOO-LARGE`, `-BAD-EDITOR`, `-BAD-DAILY-LIMIT`, `-BAD-UNLICENSED`. Admin (`e2e/admin/specs/export/`,
  content worlds): `S-A53-HAPPY` (two inputs, the downloaded zip is the object the task wrote, unpacked by
  `e2e/support/unzip.ts`), `-BAD-BUSY`, `-BAD-EXPIRED`, `-BAD-NEVER-PUBLISHED`, and the tour states `export.card`,
  `export.building`, `export.ready`, `export.failed`, `export.expired`, `export.readonly`. Starter kit
  (`e2e/specs/starter-kit/export.spec.ts`): `S-V28-HAPPY`, `-HAPPY-CONSENT-SENDS-NOTHING` (a city published with a GA4 id
  exports none: no banner asks, nothing loads), `-BAD-FILE-URL`. V28 builds its own export with the export's planner and
  writer over the fixture city (CR-M5-18): the starter-kit tier runs without the emulators, and on the other machine in a
  split run. `e2e/tour/states.ts` had reached its 600-line limit: the M4 and M5 sections moved to
  `e2e/tour/admin-sections.ts` (CR-M5-15).
- **60e APPLIED (a new chunk with its own budget, the pre-approved kind): the card is the lazy chunk `export-card`**
  (`packages/ui/src/admin/export/export-card.ts`, fetched the first time the section opens; `lazy-card.ts` shows Loading,
  or the failure with Try again). `ADMIN_CHUNK_BUDGETS` gains `export-card` 2 KB (1.7 KB measured by the gate on
  2026-10-25 plus about 20 %). Measured with it: `editor-shared` 12.8 KB of 13 (the order card's `chunkLoader`, which the
  export card reuses, is now shared by two areas), `settings` 19.5 KB of 20 with both M5 sections' stores and chunk loaders (18.6 KB with the export's alone): the
  next Settings section needs a chunk of its own.
  No budget was raised; `PIPELINE_STAGE=build` passes.
- **60f recorded for the user: the signing permission and the lifecycle rule are provisioner items** (CR-M5-8, the
  multi-city workstream's provisioner): until Provision runs again with them, `export.download` fails on the real
  project (V4 signing needs `roles/iam.serviceAccountTokenCreator` of `fn-admin@` on itself; **UNVERIFIED** until then),
  and exports past seven days are removed by the tick only.
- **60g waits on multi-city:** the Firestore match `cities/{city}/exports/{id}` (read by the city's members, no client
  write; CR-M5-11) and its rules row `S-A53-BAD-CLIENT-EXPORTS` (planned); without the match the card's listener is
  refused and `e2e/admin/specs/export/export.spec.ts` cannot pass.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` (the four audit gates stay red on §48a and §49i);
the functions, admin and ui Vitest projects for the files above (100 % lines per file but `build.ts`, `start.ts` and
`zip.ts`, each above 98 %); `E2E_TIER=fn npx playwright test specs/starter-kit/export.spec.ts`; the admin tier's
`specs/export/export.spec.ts` once CR-M5-11 is in.

## 61. The M5 kit-cli workstream: the starter kit's template, `create-historic-city` and the kit's e2e (2026-10-25) — 61a–61c APPLIED (product, test and documentation changes within the contract; configuration edits that make a gate stricter or keep a tool working, the pre-approved kinds; no gate relaxed, no checker allowlist entry); 61d PROPOSED, NOT APPLIED (the lockfile's workspace link and the quality image's manifest line: rebuilding the image downloads); 61e–61g recorded for the user

The kit-cli workstream of `docs/research/M5-interfaces.md` (§3, §4, §6.1) built the shared kit helpers, the starter
kit's template, the `create-historic-city` CLI and behaviours V27 and V29 with the kit's tour state. Nothing was
committed, pushed, tagged, published or deployed, nothing was downloaded, and no request left the machine: the CLI's
tests run over fakes of its ports, its e2e rows run the built CLI with fake `firebase`, `gcloud` and `xdg-open` as the
only commands on its `PATH`, and the kit's page boots against the mock CDN and the mock Mapbox.

- **61a APPLIED: what landed.**
  - `packages/shared/src/kit/csp.ts` (the one CSP table of every engine page: the site's policy unchanged with the
    engine at `'self'`, the kit's with the pinned jsDelivr folder in `script-src`, `style-src` and `font-src`) and
    `packages/shared/src/kit/page.ts` (`fillKitPage`, `readKitEngine`, `kitContentSecurityPolicy`, `kitResult`,
    `isUnpinned`), exported from `@hcm/shared` (one export line in its index and a `KIT_EXPORTS` list in the exports
    fixture: CR-M5-19).
  - `templates/starter-kit/` (`index.html` committed Prettier-clean and a fixed point of `fillKitPage`, `city.json`, a
    Romanian and English `README.md`); `engine.css` gains `.hcm-fullpage` and `.hcm-note` (CR-M5-5, done); the M1 kit's
    README points to the template.
  - `packages/create-historic-city/` (the scaffold, `self-host`, `deploy`, `upgrade`, `doctor`, `--dry-run`, its own
    Romanian and English catalogue, the ports and their Node implementations, the self-host bundle's builder, 100 %
    lines per file and at least 96 % branches).
  - The e2e: the site server's `/kit/` route, the mock CDN's release folder (`@v<version>` and `@1`, from `cdn/engine/`
    once a release made it, else `packages/engine/dist`), the mock Mapbox's 401 for the template's placeholder token,
    `e2e/support/kit.ts`, `e2e/support/cli.ts`, `e2e/specs/starter-kit/{template,create-city}.spec.ts` (rows V27 and
    V29, now `exists`) and the tour state `kit.loading-note` (`e2e/tour/kit-states.ts`, its journey in
    `e2e/tour/viewer.tour.ts`, so it runs at every tour project).
  - Docs: `docs/SELF_HOST.md` (Romanian and English), `docs/ENGINE_API.md` → *The starter kit*, `docs/SETUP.md` → *The
    starter kit and create-historic-city*, `README.md`.
- **61b APPLIED (the pre-approved kinds): configuration edits.**
  - `vitest.config.ts`: the `create-historic-city` project (Node; the colour library inlined by Vite, as its ES modules
    import without file extensions, which Node refuses) and its coverage scope; `sonar-project.properties`: its `src`
    as sources, its `test` as tests (stricter).
  - `.dependency-cruiser.cjs`: the new rule `create-historic-city-bundles-only-what-it-needs` (the CLI's source imports
    Node's built-ins, `@hcm/shared` and `@hcm/ui/dynamic-color` only; stricter). The workspace links `@hcm/shared` and
    `@hcm/ui` are the CLI's `devDependencies` (its build bundles them, so the published package has no `dependencies`):
    dependency-cruiser resolves them to the packages' own sources, so `src-not-to-dev-dependencies` is untouched.
  - `knip.json`: the CLI's entries (`cli.ts`, `build-self-host.ts`, its tests); `tsconfig.json` and `e2e/tsconfig.json`:
    the CLI's projects as references (keeps `tsc -b` and the e2e's import of the CLI's catalogue working).
  - `scripts/ci/check_agent_assets.py`: `templates/` joins `PATH_ROOTS` (stricter); `scripts/ci/check_notices.py`: the
    CLI's `dist` joins `BUILDS` (stricter; its tests gained the CLI's build); `scripts/ci/e2e_build.py`: the CLI's `dist`
    joins `OUTPUTS` (the stamp sees a rebuilt CLI).
  - The root `package.json`: `build:self-host`, and the CLI's build in `build:site:e2e` (the V29 rows run `cli.mjs`).
- **61c APPLIED: what the workstream decided within the contract** (each in CR-M5-19 to CR-M5-21).
  - `fillKitPage`'s text values are optional (a slot left out keeps the template's value, but every slot must still be
    there once): the release's pinning passes the engine alone. The `lang` value sets the viewer element's `lang` with
    `<html lang>`. `kitResult` turns a `KitPageError` into a value, so the CLI names a page an owner broke instead of
    failing.
  - Until a release pins it, the template's engine block names `@v1.0.0` with the integrity `sha384-` and 64 zeros
    (`KIT_UNPINNED_INTEGRITY`, valid in form, the digest of no file); `upgrade` and `doctor` treat it as "no release
    yet", and the e2e serves the page with the digests of what the mock CDN serves, said in the annotation `kit-pins`.
  - The CLI: the deploy files go to `server/` inside the city folder (added to its `.gitignore`: they are no part of the
    site); `--bundle` deploys another self-host bundle, `--viewer-origin` names the city's public site for the
    functions (default the project's `web.app`), `--billing-wait` bounds step 8's wait (default 20 minutes, 0 checks
    once more); when billing is not linked, step 8 opens the billing page and waits for Enter before it polls, so the
    owner's own link needs no clock; step 1 (the versions) runs without a question, as it changes nothing; a new city's
    example places move with its rectangle, so the scaffolded `city.json` still validates and still shows them.
- **61d PROPOSED, NOT APPLIED: the lockfile's workspace link and the quality image's manifest line.** A workspace needs
  its link in `package-lock.json` (made offline in the pinned Node image, no network: `npm install --package-lock-only
  --offline --ignore-scripts` in a scratch copy of the manifests) and its `package.json` in the image's `manifests` stage:

  ```text
  package-lock.json, beside the other node_modules/<workspace> links:
      "node_modules/create-historic-city": { "resolved": "packages/create-historic-city", "link": true },
  and beside the other packages/<workspace> entries:
      "packages/create-historic-city": { "version": "0.0.0", "license": "UNLICENSED",
          "bin": { "create-historic-city": "dist/cli.mjs" },
          "devDependencies": { "@hcm/shared": "0.0.0", "@hcm/ui": "0.0.0" },
          "engines": { "node": ">=24.12.0" } },
  docker/Dockerfile.quality, stage manifests, after packages/admin:
      COPY packages/create-historic-city/package.json packages/create-historic-city/
  ```

  Not applied tonight: a changed lockfile rebuilds the quality image's npm layer at the next `run-all-checks.sh` (every
  npm package from the registry, the Playwright browsers and the Firebase emulator JARs: downloads), and the pipeline's
  `npm ci` would replace the shared `node_modules` under the other workstreams' running checks. Until it lands, every
  gate passes (nothing runs `npm ci` while the lockfile is unchanged), but a fresh `npm ci` (CI, a new clone, a lockfile
  change) stops with `Missing: create-historic-city@0.0.0 from lock file`: the release's bump (CR-M5-12, which rewrites
  the lockfile's workspace versions) must add these lines in the same change, at the release's version (CR-M5-20).
  Verify: `npm ci --dry-run --offline` in the pinned Node image, then `PIPELINE_STAGE=static`.
- **61e For the user: the licence of `create-historic-city` and of the template.** Both say `UNLICENSED`, like every
  package of the repository. A CLI that others run with `npx`, and a template they copy, usually carry a licence (MIT
  is common); choosing one is the user's decision before `npm publish` (§58f) and the template repository (§58e).
- **61f Recorded: what only a real run proves (also in `docs/research/M5-interfaces.md` §10).** The JSON the Firebase CLI
  15.33.0 prints for `login:list`, `projects:list`, `apps:list WEB` and `hosting:sites:list` (the CLI reads `result`, an
  account's presence, a project's `projectNumber`, a web app's presence, a site whose `name` ends with
  `/sites/<project>`; a listing it cannot read counts as "not there", so the step offers to create it and the owner's
  tool says what is wrong); `firebase projects:create` failing until Google's terms are accepted (the CLI opens the
  console and tries once more). A self-hosted admin's provisioner needs CR-M5-7 (`project.json` without `github`) before
  its Provision step works; the functions of a self-hosted project run without `HCM_OAUTH_CLIENT_IDS` (the claim's
  fallback of `functions/src/admin/claim.ts`).
- **61g Recorded: sizes.** `cli.mjs` is about 550 KB (zod, `@hcm/shared` and the colour library bundled; its source map
  stays out of the npm package's `files`); the template's page is 4 KB, its `city.json` 18 KB (the theme's four token
  sets).

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` (the four audit gates stay red on §48a and §49i), the
`create-historic-city` and `shared` Vitest projects, `E2E_TIER=fn npx playwright test specs/starter-kit/template.spec.ts
specs/starter-kit/create-city.spec.ts --project=fn-l1440-ro`, and the tour's kit state
(`E2E_TIER=tour npx playwright test tour/viewer.tour.ts -g "starter kit"`).

## 62. The M5 multi-city workstream: memberships, rules isolation, the switcher, New city, per-city admins and budgets, the Pages tree (2026-10-25) — 62a–62f APPLIED (product, test and documentation changes within the contract and its change requests CR-M5-2 to CR-M5-4, CR-M5-6, CR-M5-8, CR-M5-11, CR-M5-22 to CR-M5-24; 62c new lazy chunks with their own budgets and 62d configuration edits that make a gate stricter or keep a tool working, the pre-approved kinds; no gate relaxed, no budget raised, no checker allowlist entry); 62g PROPOSED, NOT APPLIED (a workflow line, ask first); 62h recorded for the user

The multi-city workstream of `docs/research/M5-interfaces.md` (§1, §6.1, §7, §8) made the map one of many cities. Nothing
was committed, pushed, tagged, deployed or downloaded, and no request left the machine: the functions ran against the
Firebase emulators (`demo-hcm`), the rules against the Firestore and Storage emulators, the admin and the viewer against
the e2e mock servers.

- **62a APPLIED: memberships and access** (§1.2, §1.3; CR-M5-2, CR-M5-4).
  - `admins/{uid}.cities` names each city and the role in it (`owner` or `editor`); the project's owner is the admin
    whose `role` is `owner`. A document from before M5 gets every existing city at its first `admin.session` (the
    project's owner as owner, every other admin as editor) or at `ops.tick`'s new `memberships` step; until then the
    rules and the callables treat it as no membership (fail closed). `admin.session` also accepts an invitation to more
    cities for an admin who already joined (no second "Join"), lists a member's city by its id while the city has no
    document (the bundled city before Setup writes it, so its owner can still invite), and answers `projectOwner`.
  - `CallableAccess` gains `cityEditor`, `cityOwner` and `projectOwner`; every city callable checks the role in the
    request's `cityId` after the request is validated and before any read (`requireCityRole`). `AdminDirectory.membership`
    replaces the contract's two lookups (one read).
  - New callables: `cities.create`, `cities.setLimits` (`fn-cities`), `admins.setRole`; `admins.invite`, `.revoke` and
    `.list` work on one city (an admin removed from their last city stops being an admin; the project's owner keeps
    their document; a city keeps at least one owner: `apiError.city.lastOwner` on a demotion).
  - `notify.onEvent` fans a city's events out to that city's members only, with a link into the city.
- **62b APPLIED: every city closed to the others** (§1.4; CR-M5-3, CR-M5-11).
  - `firebase/firestore.rules`: a city's subtree, its manifest state, its harvest state, its usage and exports are its
    members' only; History's collection-group list is allowed only with `where('cityId', '==', <a city of the admin>)`
    (proved on the emulator); `admins/*` is its own reader's or the project owner's; invitations the project owner's;
    the ops documents are read by name only (no list). `firebase/storage.rules`: a city's originals, uploads, photos,
    rasters, work and reference files are its members'; the USGS browse copies any admin's (shared by every city);
    everything else server-only (the catch-all read is gone). The allow/deny matrix tests a member of city A against
    city B (`firebase/rules-tests/test/{cities,identity,storage,matrix}.test.ts`), and the rule coverage gate holds.
  - The e2e worlds seed memberships: the personas are members of the bundled city, each content world's account the
    owner of its own city.
- **62c APPLIED (the pre-approved kind): two new lazy chunks with their budgets.** `cities` (the New city page: its store,
  its map and `<hcm-new-city-page>`, 4.6 KB measured) gets 6 KB and `city-budget` (Settings → the city's budget, 1.0 KB)
  2 KB, the measurement plus about 20 % (`scripts/ci/check_bundle_budget.py`). The admin in all now measures 619.6 KB of
  its 620 KB (the build stage of 2026-10-25, with the other M5 workstreams' chunks) and `settings` 19.5 KB of 20 KB: the
  next workstream that adds to the admin needs a reviewed raise.
- **62d APPLIED (the pre-approved kinds): configuration edits.** `.dependency-cruiser.cjs`'s
  `functions-feature-folders-independent` gains `cities` (stricter); `scripts/site/tsconfig.json` includes the new entry
  `add-site.ts` (keeps `tsc -b` and ESLint working); `eslint.config.js`'s block for a city's `config.js` (a classic
  script with the browser's globals) names the e2e fixture cities' too (`e2e/fixtures/sites/*/config.js`, keeps ESLint
  working); the root `package.json` gains `site:add`, and `build:site` assembles the Pages tree (`--pages dist/pages`).
- **62e APPLIED: what the workstream decided within the contract** (each in CR-M5-22 to CR-M5-24).
  - The city switcher (§1.5): the top bar's button from the medium window class, the account menu's list on a phone,
    shown to an admin of two cities or more, or to the project's owner (New city). Switching is a page load into
    `#/c/<city>/home`, remembered per account in `localStorage` (`hcm:admin:city:<uid>`); an unsaved edit is asked about
    first, and once the admin discards it nothing holds the page load back (the navigation guard and `beforeunload`
    ask the app, which stops counting a discarded edit while another city opens).
  - New city (§1.6): the rectangle is dragged on the map itself (a capture-phase gesture on the element Mapbox draws
    into, so nothing covers the map or its zoom buttons and the admin's CSP needs no inline style), or clicked corner to
    corner, or typed edge by edge. `cities.create` writes the new city's harvest state due at once: the contract's "a
    city without a harvest state is due" would undo CR-M3-44 (the e2e content worlds' cities would all be harvested), so
    only a created city is harvested by the next tick. The viewer's token is minted by the flow's follow-up
    `setup.rotatePublicToken` (best effort: a project without Mapbox yet answers 400 and Setup's Mapbox card mints it);
    the project's analytics ids are copied from another city.
  - Per-city budgets (§1.8): a city's compute units count its publishes under way as reserved until the month ends (a
    failed publish keeps its share until then: conservative, never over); a city without `limits` (Bucharest) is held
    by the project's caps only; the approval card's `city-over` offers Studio or next month, never paying (paying the
    project's overage would not raise the city's share).
  - The admins page shows each admin's role in the city; its owners change roles after a question and invite with a
    role (editor unless changed); oneself is never removable (the project's owner: the map always keeps its owner).
- **62f APPLIED: the GitHub Pages layout** (§1.10; CR-M5-6). `site.json` gains `pagesPath` (`""` for Bucharest at the
  root, so the old links keep working); a city without a seed manifest reads the public bucket only and is built only
  when the build names it; `npm run build:site` assembles `dist/pages` (two sites on one path, or a city folder the root
  site uses, refuse the tree); `npm run site:add -- --city <id> --name-ro <name> --theme <#rrggbb>` writes `sites/<id>/`
  (a repository step: the admin holds no GitHub credential). `scripts/site/src/csp.ts` re-exports the shared table of
  `packages/shared/src/kit/csp.ts`. The e2e build assembles the same tree under `dist/e2e-site/pages/` with the fixture
  cities of `e2e/fixtures/sites/` (never `sites/`, which a production build would publish).
- **62g PROPOSED, NOT APPLIED (a workflow edit, ask first): the Pages deploy uploads the tree.** In
  `.github/workflows/ci.yml`, the step "Upload the GitHub Pages artifact" changes `path: dist/site/bucharest` to
  `path: dist/pages` (and its comment to "Every city's site, built and assembled by the site-build gate"). Until a second
  city's site is committed both trees serve the same files.
- **62h recorded for the user.** CR-M5-7 (a `project.json` without `github`: the provisioner without the Workload
  Identity pool and `gh-deployer`) is not applied: it changes the Setup's repository variables and the provisioner's
  service accounts, bindings and items, and no M5 flow needs it yet (`create-historic-city` deploys from the owner's
  terminal). Deploying the new functions (`cities-create`, `cities-setLimits`, `admins-setRole`) and the rules is the
  user's (ask first). The integrator's lessons for `docs/LESSONS.md` are in CR-M5-24.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` (the four audit gates stay red on §48a and §49i),
`PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh`, and the admin and viewer rows
(`E2E_TIER=admin npx playwright test admin/specs/cities/ --project=admin-l1440-ro`,
`E2E_TIER=fn npx playwright test specs/viewer/multi-city.spec.ts --project=fn-l1440-ro`).

## 63. The M5 integrator: the change requests closed, Settings → Publishing, the image blind to versions, the cross-app journey, v1.0.0's versions, and what waits for the user (2026-10-25) — 63a–63f APPLIED (product, test, tooling and documentation changes; 63b a Dockerfile edit that keeps the quality image's npm layer cached, the "keeps a tool working" kind; no gate relaxed, no budget raised, no checker allowlist entry); 63g recorded (downloads on the NUC; since §64 the NUC's image is current); 63h–63i for the user, ask first; 63j APPLIED (the integrator's second run: the visual audit's fixes, the review screenshots and every stage green, the split `quality` included)

The release workstream's integrator role (`docs/research/M5-interfaces.md` §6.3 step 4), after the other three
workstreams reported. Nothing was committed, pushed, tagged, published or deployed; no request went to a real Google,
Mapbox, USGS, STAC, Nominatim, Vertex AI, OpenStreetMap, npm or jsDelivr endpoint from a test; the targeted runs ran in
the quality image with `--network=none`. One split run started rebuilding the NUC's image (63g).

- **63a APPLIED: Settings → Publishing (a gap between the contract and the screens).** New city makes a city
  unpublished (§58a, §1.6) and its done screen says "publish it from Settings when it is ready", but no screen wrote
  `cities/{city}.published` (`CLIENT_WRITES.city.update` and the rules allowed it): a city made in the admin could never
  get a public manifest, so never a public site nor an export (`apiError.export.noManifest`). The integrator's cross-app
  journey found it. Settings gains the city section `publish` (`packages/admin/src/settings/city-sections.ts`,
  `packages/ui/src/admin/settings/publish-section.ts`): one switch, **The city is public**, what switching it does, and
  the section's Save, with the draft, the conflict banner and the read-only state every city section has; the input
  budget `publishCity` (2: the switch, Save); the tour state `cities.publish`; five texts in both languages. Who may
  switch it: a member of the city, as the rules already allow for the city's settings (63i asks whether owners only).
  Measured by the `build` stage: `settings` 19.6 KB of its 20 KB, the admin in all 619.9 KB of its 620 KB (no budget
  raised; the next addition to the admin needs one, 63i).
- **63b APPLIED (keeps a tool working): the quality image's npm layer ignores the workspaces' own versions and a
  workspace without registry dependencies (CR-M5-20).** A changed lockfile or workspace version re-ran the image's npm
  layer (`npm ci` from the registry, the Playwright browsers, the Firebase emulator JARs: downloads), so the CLI's
  lockfile entries (§61d) and the release's bump could not land. The `manifests` stage of `docker/Dockerfile.quality`
  now also writes every workspace's `version`, and every dependency of a workspace on another, as `0.0.0`, and drops
  the lockfile's entries of a workspace it does not copy: `create-historic-city`, whose only dependencies are
  workspaces, needs no `COPY` line (the comment says when one does). Verified: `docker build --target manifests` gives
  `/m/` byte for byte equal to the files baked into the current image, before and after the bump; the full build then
  reports the npm layer `CACHED`; `npm ci --offline` with `--network=none` in the image installs the new lockfile in 7 s.
  The lockfile's two entries were generated offline (`npm install --package-lock-only --offline --ignore-scripts` in a
  scratch copy, pinned Node image, `--network=none`).
- **63c APPLIED: v1.0.0's versions (§2.6 step 1, first half).** `npm run release:bump -- 1.0.0` (offline, in the image)
  rewrote the ten `package.json`, every workspace dependency, the lockfile, `functions/deploy-lock/` and
  `ENGINE_VERSION`; the bump's read-only test over the real tree passes at 1.0.0. Not run: `release:cdn`,
  `release:pin-kit` and `release:notes`, because the committed `cdn/engine/` fails EditorConfig until §59c (CR-M5-14) is
  answered; the kit keeps its placeholder digests until then and `kit-pins` checks its shape only (63h, step 1).
- **63d APPLIED: the cross-app journey (behaviour A54).** `e2e/admin/specs/cities/city-journey.spec.ts`:
  `S-A54-HAPPY` (New city, Publishing, the server's manifest, the site `site:add` and `build:site` make for the city with
  the public bucket named, booted with one map; Export and Download, the zip booted on a plain static server with no
  Firebase, Google or jsDelivr request), `S-A54-BAD-UNPUBLISHED` (switched off, the manifest leaves the bucket and the
  site says `error.manifest.notFound`) and `S-A54-BAD-OTHER-CITY` (another city's owner, with their own ID token on the
  emulators' REST: 403 on the city's documents, its export's zip and an upload into it, `apiError.city.notMember` from
  `export.start`, `export.download` and `admins.invite`). Helpers: `e2e/support/city-site.ts` (the repository's own
  `addSite` and `buildSite` into `dist/e2e-city-sites/<test>/`, served at `/city-sites/`),
  `e2e/admin/specs/cities/journey-world.ts` (the public bucket answered from the Storage emulator, the outsider), and
  `unpackExport` in `e2e/support/export-site.ts`. Content specs: parallel, no lock; 16 of 16 at the five admin projects
  in 59 s.
- **63e APPLIED: the change requests left open.** CR-M5-11's rules row `S-A53-BAD-CLIENT-EXPORTS`
  (`firebase/rules-tests/test/cities.test.ts`: members read and list, nobody writes, another city's admin reads
  nothing); CR-M5-25 (`exports` in the reset's city-first prefixes, `e2e/admin/support/emulators.ts`); the per-file
  coverage of `functions/src/adapters/storage-writer.ts` (a source failing with something other than an Error, now
  tested: 100 % branches); CR-M5-20 (63b); CR-M5-24 (the lessons 220–233 of `docs/LESSONS.md`, the guides, ARCHITECTURE,
  TESTING, CI_PIPELINE, SETUP, MANUAL_TEST_PLAN, README, the skills and their mirrors, `M5-status.md`).
- **63f Recorded: CR-M5-7 stays accepted, not applied.** A `project.json` without `github` (what `create-historic-city
  self-host` writes) is refused by the admin's `parseProjectConfig`, and without a project file the admin's Setup is
  unavailable: a self-hosted admin cannot run its Setup Assistant at all yet (step 7 of `docs/SELF_HOST.md`).
  Applying it changes the provisioner's service accounts and IAM bindings (no `gh-deployer` and no Workload Identity
  pool without GitHub), the `workload-identity` item, the deploy card's repository variables and its texts (a deploy
  from the owner's terminal instead), and would need bytes the admin's budget no longer has (63a): a reviewed change of
  its own, with the work list in CR-M5-7.
- **63g Recorded: the NUC rebuilt the quality image from scratch, with downloads, and the run was stopped.** The first
  split `quality` run found the NUC's BuildKit cache evicted (the machine builds other projects; its cache records of
  this image were gone, though the tagged image remained): it pulled the pinned base images (Docker Hub, GHCR), the
  apt packages (Ubuntu's mirrors), the CI venv (PyPI) and `npm ci` (the npm registry), and was stopped while apt fetched
  the browsers' system libraries, before the Playwright browsers' CDN and before the emulator JARs (Google's storage);
  nothing it fetched reached the tree. Every later run used this machine only (`PIPELINE_STAGE=quality bash
  scripts/ci/run-all-checks.sh`, the split's own fallback). A split run needs that rebuild on the NUC once: ask first
  (63h).
- **63h For the user, ask first, one at a time** (exact commands in `docs/research/M5-status.md` §3):
  1. §59c / CR-M5-14: the `.editorconfig` exception for `cdn/engine/*.{js,mjs}`; then, in the image, `npm run build
     --workspace @hcm/engine && npm run release:cdn`, `npm run release:pin-kit`, `npm run release:notes -- --write
     docs/releases/v1.0.0_github_description.md`, `python3 scripts/ci/check_release.py --tag v1.0.0`;
  2. ~~the NUC's image rebuild (downloads) for the split runs~~: done by §64's approved run (the NUC's image of 09:10
     on 2026-10-25); the second run's split `quality` built there with every layer `CACHED` (63j);
  3. §62g / §58b: `ci.yml`'s Pages artifact `dist/pages`;
  4. §58g: the jsDelivr probe;
  5. the push of `feat/engine-rewrite`, the pull request, its review and the merge into `master` (the overwrite of the
     legacy site and the Pages go-live);
  6. `git tag -a v1.0.0 -m "v1.0.0"` on the merged commit and `git push origin v1.0.0`; then §59j's publishing lines;
  7. §58e: the template repository; §58f: `npm publish` of `create-historic-city` (after §61e's licence);
  8. the deploys: functions (67), Firestore and Storage rules and indexes, the admin's Hosting; then Provision again
     (CR-M5-8's lifecycle rule and signing binding).
- **63i For the user's decision.** Whether only a city's owners may publish it (today any member may, as for the city's
  settings: a rules change and the section's read-only state for editors); a raise of the admin's budget in all (620 KB,
  0.1 KB left) before the next admin feature; §58h, §61e and §61f stay open.

- **63j APPLIED: the integrator's second run (a tooling outage cut the first one after 63i).** The four audit gates pass
  since §64, so every gate of every stage is green (the verdicts below). The visual audit of the M5 review screenshots
  (`reports/screenshots/m5/`: the 19 admin states at 360 × 800, 768 × 1024, 1440 × 900 and 2560 × 1440, light and dark
  in Romanian and light in English, and the kit's `kit.loading-note`; 235 files, one contact sheet per state in
  `reports/screenshots/m5/sheets/`) found what the checkers pass, fixed as CR-M5-29: the ready export said "1
  fotografii" / "1 photos" (now "fotografii: 1, straturi: 0"), its Export was a second filled button beside Download
  (now tonal), and the per-city daily limits of imagery jobs and exports and the city's compute-unit message put a
  number an owner can set to 1 before a plural noun (now in brackets or after a label; the guides' tables follow;
  `docs/LESSONS.md` 234). The admin in all is now 619,971 bytes of its 620,000 (the budget passes with 29 bytes left;
  63i's raise is due before any addition). The NUC: its BuildKit cache held §64's build, and the split's own build log
  showed every layer `CACHED`, so nothing was downloaded; an offline `docker build --network=none` is no probe (the
  network mode keys every `RUN` step; `docs/LESSONS.md` 235). The first split `quality` failed one test on the NUC,
  M2c's `S-A18-BAD-STREAM-DROP` at `admin-l1440-en`: a route reaches only new requests, and Firestore's long poll opened
  before it stayed open 45 s on the loaded machine; the spec now also takes the browser offline until the page says it is
  reconnecting (CR-M5-30, `docs/LESSONS.md` 236). No change of the ask-first kinds, no gate relaxed, no budget raised, no
  checker allowlist entry; CR-M5-7 and CR-M5-14 stay as 63f and 63h say.

Verify: `PIPELINE_STAGE=static`, `tests`, `build` and `quality` (`PIPELINE_STAGE=quality bash scripts/ci/e2e-split.sh`, split
with the NUC); the journey alone:
`E2E_TIER=admin npx playwright test specs/cities/city-journey.spec.ts --project=admin-l1440-ro` in the image.

## 64. Security bumps for §48a and §49i (2026-10-25) — APPLIED 2026-10-25 (user approved the downloads: "yes, install the security bumps")

The four audit gates of the `static` stage (`npm-audit`, `deploy-lock-audit`, `pip-audit`, `pipeline-pip-audit`) failed
on the advisories §48a and §49i name; the `static` run of 2026-10-25 listed the same packages, with three more filelock
CVEs than §48a's (all fixed in the same release). The user approved the security patch and minor bumps of packages
already in the tree; no package was added or removed, no major version changed, and no allowlist or `overrides` entry
was added (every dependant's range already accepts the fixed version).

| Package | From | To | Advisory | Gate |
| --- | --- | --- | --- | --- |
| `body-parser` 2.x (transitive: `firebase-functions` → `express` 5.3.0, `@modelcontextprotocol/sdk` → `express` 5.3.0; `functions/deploy-lock`) | 2.3.0 | 2.4.0 | GHSA-27r3-jxmh-p828 | `npm-audit`, `deploy-lock-audit` |
| `body-parser` 1.x (transitive: `firebase-tools`, `express` 4.22.3, `exegesis`) | 1.20.8 | 1.20.9 | GHSA-27r3-jxmh-p828 | `npm-audit` |
| `qs` (transitive; `body-parser` 2.4.0 requires `^6.16.1`; root and `functions/deploy-lock`) | 6.16.0 | 6.16.1 | none (a dependency of the fix) | `npm-audit`, `deploy-lock-audit` |
| `fast-uri` (transitive: `ajv` 8.20.0 under `firebase-tools`, `html-validate`, `table` and others) | 3.1.8 | 3.1.9 | GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp | `npm-audit` |
| `undici` 6.x (transitive: `firebase-tools`, `^6.19.0`) | 6.29.0 | 6.29.1 | GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c | `npm-audit` |
| `undici` 8.x (transitive: `firebase-tools` → `re2` → `node-gyp` 13.1.0, `^8.4.1`) | 8.11.2 | 8.12.3 | the same three (affected: 8.0.0 to 8.12.1) | `npm-audit` |
| `filelock` (`scripts/ci/requirements.txt`, `pipeline/requirements-poetry.txt`) | 4.1.1 | 4.2.1 | CVE-2026-112906, CVE-2026-112907, CVE-2026-112913, CVE-2026-112914, CVE-2026-112937, CVE-2026-112940 | `pip-audit`, `pipeline-pip-audit` |

- **npm.** The way §44 took: the affected entries (the three `body-parser` entries with their nested dependencies,
  `qs`, `fast-uri` and both `undici` entries) were removed from `package-lock.json` and `npm install
  --package-lock-only --ignore-scripts` re-resolved them in the digest-pinned Node image (`docs/SETUP.md` → *npm in a
  container*); npm takes the newest release a range accepts, so `undici` 8.x went to 8.12.3, not the first fixed 8.12.2.
  The nested dependencies came back at the versions they had. `functions/deploy-lock/package-lock.json` lost its
  `body-parser` and `qs` entries and was refreshed with `node functions/deploy-lock.mjs` in the same image; its
  `package.json` is unchanged (the root `overrides` did not change). Nothing that ships changes: the viewer and the
  admin bundle none of these, and the functions artifact gets `body-parser` 2.4.0 and `qs` 6.16.1 at its next deploy.
- **Python.** `filelock==4.2.1` in both requirements files, the release the advisories name as fixed (4.2.4 is the
  latest). `pipeline/poetry.lock` does not hold `filelock`, so it is unchanged. Both venvs of the quality image are
  rebuilt by the next `run-all-checks.sh`.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` and `PIPELINE_STAGE=tests bash
scripts/ci/run-all-checks.sh`.

## 65. The M5 reviews' fixes: security, supply chain, minimum input and accessibility (2026-10-25) — 65a–65j and 65l APPLIED (product, test, tooling and documentation changes; 65l a stricter `release` stage, the pre-approved kind); 65k APPLIED for review (a build change that shrinks the admin, reversible in one line); 65e's publishing step PROPOSED, NOT APPLIED (a workflow edit); 65m–65o recorded for the user

The fixer's pass over the two M5 reviews (security and supply chain: nine findings; minimum input, UX and correctness:
seventeen). Nothing was committed, pushed, tagged, published or deployed, nothing was downloaded, and no test called a
real Google, Mapbox, USGS, Nominatim or npm endpoint (the new Nominatim search is answered by the shared fake and the
mock APIs). Every finding is applied, or answered below with why not; each fix has its tests and a lesson
(`docs/LESSONS.md` 237–256).

- **65a APPLIED (security 1): the CLI never reads the owner's tokens.** `firebase login:list` is read as plain text
  (`Logged in as …`); its `--json` answer lists the accounts with their OAuth tokens. The fakes answer `--json` with
  tokens and the tests prove it is never run (lesson 237).
- **65b APPLIED (security 2): `layers.link` keeps each city's pipeline tilesets to that city.** A tileset named
  `<user>.hcm-*` (`tilesetName`) is linkable only when a layer of the request's city records it
  (`apiError.layers.otherCityTileset`; `S-A15-BAD-OTHER-CITY-TILESET`). Recorded limit (`docs/ARCHITECTURE.md`): every
  city's public token belongs to the project's one Mapbox account and reads all of its tilesets.
- **65c APPLIED (security 3): a role change is one transaction, and the project's owner stays.** `changeCityRole`
  (`functions/src/admin/memberships.ts`) reads the caller (still an owner), the target and every owner a query found
  before it, then writes; `admins.setRole` and `admins.revoke` go through it. Of the review's two recovery options, the
  project's owner is never removed from or demoted in a city they own (`apiError.city.projectOwnerStays`; the Admins
  page offers neither on their row), which with `legacyCityRoles` and `cities.create` keeps every city an owner who can
  always reach it. Tested on the Firestore emulator with two owners at once (`S-A51-BAD-ROLE-RACE`,
  `S-A51-BAD-PROJECT-OWNER-STAYS`; lesson 243). `packages/shared/src/api/cities.ts`'s comment now says what the code does.
- **65d APPLIED (security 4): pre-M5 invitations get the cities of now.** `migrateLegacyInvites` (the `memberships`
  tick step, and `cities.create` before it writes) gives each pending invitation without `cities` every existing city
  as an editor, in a transaction per invitation; `admins.list` then shows it and `revokeInvite` finds it
  (`S-A51-HAPPY-LEGACY-INVITE`; lesson 245).
- **65e APPLIED (security 5) in the tree; the publishing step PROPOSED, NOT APPLIED.** Every guide and every command the
  CLI prints names the exact release (`npx create-historic-city@1.0.0`, `NPX_COMMAND`); `release:bump` rewrites the
  guides of `PINNED_DOCS` and `release-check` refuses a tag whose guides name another version. `docs/research/M5-status.md`
  §3 now checks and publishes (or reserves) the npm name before the merge. Proposed for the user (a workflow edit, ask
  first): after the release job, publish `reports/release/create-historic-city-X.Y.Z.tgz` from `release.yml` with
  `npm publish --provenance --access public` in a job with `id-token: write` and the `NPM_TOKEN` secret the user sets,
  so the published tarball is the one CI built and checked.
- **65f APPLIED (security 6): `export.download` has a daily cap and obeys the guard.** At most
  `EXPORT_LIMITS.downloadsPerDay` (10) signings per export a UTC day, counted in `cities/{city}/exports/{id}.downloads`
  in a transaction, none while the guard is red, the day's count logged (`S-A53-BAD-DOWNLOAD-LIMIT`; lesson 246).
- **65g APPLIED (security 7): a CSP source is an origin of CSP's grammar.** `isCspOrigin` (`text/urls.ts`) filters the
  export's origins and `contentSecurityPolicy` throws on anything else; the basemap style's schema and rule
  (`httpsHostUrl()`) refuse a host with `;` or `'`; the export's policy names no telemetry host
  (`S-A53-BAD-STYLE-HOST`; lesson 241). `isHttpsUrl` itself is unchanged: links and photo sources never reach a policy.
- **65h APPLIED (security 8): the self-host bundle is built and checked.** `npm run build:self-host` builds the admin and
  the functions for production first; the bundle refuses an admin that carries the OAuth stand-in; see 65l.
- **65i Recorded (security 9, §58h): still the user's.** Exports still carry the photos licensed for this map only and
  name them in `RIGHTS.md`. The review suggests leaving them out by default behind an opt-in switch, as for the scans;
  it is a rights policy, so it waits for the user's answer (no change made).
- **65j APPLIED (UX 1–17).** 1: `self-host` and `deploy` refuse without `--experimental` (no tool runs; a dry run needs
  no flag), the scaffold no longer advertises them, and `SELF_HOST.md` and the npm README say why (CR-M5-7). 2: New
  city's map answers its zoom buttons. 3: `cities.locate` (new callable, `projectOwner`, as `fn-admin@`: one Nominatim
  `/search` at the mirror beside `HCM_NOMINATIM_URL`, under the title suggestions' cool-down, a refusal starting it)
  draws the named city's rectangle and flies the map there once typing rests; New city is two inputs from any view
  (`newCity` 2, `newCityDrawn` 3; the functions now number 68). 4: `upgrade` keeps the page's own policy sources. 5:
  the gesture follows the primary pointer only, lets a pinch through, and shows a band. 6: an id no city may take is
  said at its field and keeps Create off; an emptied field takes the suggestion again. 7: a city without limits says the
  project's caps alone hold it, its fields empty; a field left empty saves at its maximum (`MAX_CITY_LIMITS`), so
  setting one limit never imposes five (65o). 8: a phone's top bar, a sideways phone's heading and the tab's title name
  the open city (two cities or more); the account menu asks for the cities again when it opens. 9: the done screen and
  Publishing say how a new city gets a public site (`npm run site:add`, or Export), and the imagery line depends on
  USGS being set up. 10: `hcm-button`'s `popup`, `current` and `label` reach its inner button; the switcher is named
  "City: …". 11: one live region per page (New city, the export card), the focus to the heading. 12: the typed edges
  are a draft until all four are there. 13: `theme` recolours a kit from one colour; the kit README gives a photo
  example in both languages (validated by a test), the bbox question says where to find the numbers and labels its
  default, step 1 names every question. 14: a failed `projects:create` names another id. 15: `SELF_HOST.md` says to
  create the city first. 16: the kit's note says only "loading" for 4 s. 17: Create refreshes the city menu at once.
- **65k APPLIED for review (the admin's bundle): `re2js` resolves to a stand-in in the admin's build.** The fixes above
  took the admin from 619,971 to 622,563 bytes gzip, over its 620 KB, and §63i left a raise to the user. Instead of a
  raise: the Firestore SDK imports `re2js` (144 KB minified in `admin-core`) only to evaluate the `like`,
  `regex_contains` and `regex_match` functions of Firestore Pipelines in the browser, which the admin never runs; its
  three call sites catch what `compile` throws and answer an error value. `packages/admin/vite.config.ts` aliases
  `re2js` to `packages/admin/src/vendor/re2js-unsupported.ts` (its `compile` throws, unit-tested). The admin is now
  579.3 KB of 620 (−43 KB); every admin unit and e2e test passes on it; the notices gate no longer lists `re2js` for the
  admin. To revert: delete the `resolve.alias` line (the budget then needs §63i's raise). No gate, threshold or budget
  changed.
- **65l APPLIED (pre-approved kind: a stricter `release` stage): the `self-host-bundle` gate.** `scripts/ci/pipeline.py`
  runs `build-self-host.ts` after `vite-build` and before `release-pack`, which now needs it; the stage's test
  (`scripts/ci/tests/test_pipeline_stages.py`) pins the order. The skills, `docs/CI_PIPELINE.md` and `docs/SETUP.md`
  follow.
- **65m Recorded (UX 5, last item): drawing on a phone stays on by default.** The review suggests drawing only after
  **Draw the area** on compact windows. With 65j's located rectangle a phone rarely needs to draw at all, and switching
  the default would add an input to the drawn path on every touch window (the c360 and m768 projects); the swipe that
  scrolls past the map is the trade-off, left for the user.
- **65n Recorded (UX 3): the located rectangle is the place's own box.** Nominatim's box of a city's administrative area
  (fitted to 0.02°–2°) can be larger than the built-up city; the admin adjusts it, and the done screen's Settings change
  it later. A different default (a fixed size around the centre) is the user's call.
- **65o Recorded (UX 7, last item): no question before a city's first limits.** The review suggests confirming before
  setting limits on a city that had none; since a field left empty now saves at its maximum, saving one limit sets only
  that one, so no question is needed.

Verify: `bash scripts/ci/e2e-split.sh` (the stage `all`, split with the NUC); the release stage's new gate alone:
`node --import ./scripts/site/register-ts.mjs packages/create-historic-city/build-self-host.ts` after `npm run build` in
the image.

## 66. The manual test plan for M4 and M5, and the local stack's second city (2026-10-25) — 66a–66d APPLIED (test-world and documentation changes; no configuration of the ask-first kinds, no gate relaxed, no download)

`docs/MANUAL_TEST_PLAN.md` now walks every M4 and M5 behaviour, each LIVE or LOCAL, and lists every ask-first command
in one table (D1–D8 deploys, R1–R9 release and repository steps). The local stack seeds what those screens need. Choices
the user may want to change:

- **66a A second city, Iași, in the `city` seed** (`e2e/stack/seed-cities.ts`): made through the server's own
  `cities.create` and `setup.rotatePublicToken`, unpublished, with a category and two places, the project owner's alone
  (`admin@e2e.test` stays an editor of București only). Not Cluj-Napoca: the fake Nominatim finds only that name, which
  New city's LOCAL walk uses.
- **66b Mapbox connected through `setup.saveMapbox`** with the fake's generated bootstrap token (`MAPBOX_TOKENS.bootstrap`
  of `@hcm/test-support`), replacing the seeded `setup/status.mapbox` record with the server's own: the Functions
  emulator keeps secrets in memory, so without it no city made in the stack had a viewer token and its manifest was
  refused when published.
- **66c Every city's page on the stack's site server**: `http://127.0.0.1:4310/<city>/` serves the Bucharest site's page
  and engine with a `config.js` naming the city and the manifest the emulators published (404 before), standing in for
  `site:add` and `build:site` (the tab's title stays Bucharest's).
- **66d The shim forwards an `<a download>` the page clicks itself** (the export's Download), never a link a person
  follows (`docs/LESSONS.md` 259); the stack's check gained that step and the second city's.
- The plan's item ids are now unique (the M5 items were `M1`–`M7` beside M3's `M1`–`M10`, and M4's title suggestions
  `A1` beside the start-up page's): M4 is `O`, `S`, `N`; M5 `T`, `X`, `K`; the swipe compare `V11`.

Verify: `bash scripts/dev/dev-stack.sh` then `bash scripts/dev/dev-stack.sh check` (`[SUCCESS] the local stack works`);
`PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`.

## 67. The M6 contract: Setup with no terminal, the in-app installer on Cloud Build, the public map on Firebase Hosting (2026-10-25) — 67a, 67b, 67h, 67i and 67k DECIDED by the contract (`docs/research/M6-interfaces.md`), each applied by its workstream; 67c, 67e and 67j PROPOSED, NOT APPLIED (two workflow lines and a registry read: ask first); 67d, 67f, 67g and 67l for the user

The contract answers the user's live manual test of 2026-10-25 (`docs/research/manual-test-2026-10-25.md`, findings
1–24) and the user's four requirements of that day: install the server from step (d) with a button; no Claude and no
terminal in the rest of Setup; the public map on Firebase Hosting at `https://bucurestiul-disparut.web.app/` with the
admin under `/admin/`; USGS can be done later. Nothing was built, deployed, pushed or downloaded by the contract; only
the IAM grant of finding 17 was applied live, by hand and with the user's approval, before it (67b).

- **67a DECIDED: the installer runs in Google Cloud Build as its own account, `hcm-installer@`.** The admin submits
  regional builds from the browser with the owner's `cloud-platform` token (the pattern of Provision; the token stays in
  the tab and never enters a build); the builds run `firebase-tools` 15.33.0 (from a lockfile in the bundle), Docker and
  small Node step scripts, authenticated through the metadata server. The account gets, least privilege: on the project
  `roles/cloudfunctions.developer`, `roles/firebaserules.admin`, `roles/datastore.indexAdmin`,
  `roles/cloudscheduler.admin`, `roles/cloudtasks.queueAdmin`, `roles/serviceusage.serviceUsageConsumer`,
  `roles/firebase.viewer`, `roles/firebasehosting.admin`, `roles/logging.logWriter` and a custom role `hcmInstaller`
  (Cloud Run services' get and IAM policy, Cloud Run jobs' create, get and update and their operations,
  `resourcemanager.projects.getIamPolicy`, Artifact Registry repositories' get and update); `roles/iam.serviceAccountUser`
  on `fn-admin@`, `fn-events@`, `fn-crash@` and `job-raster@` only; `roles/artifactregistry.writer` on the repository
  `hcm` only. Rejected: `roles/run.admin` or `roles/run.developer` (would let it replace any Cloud Run service),
  `roles/resourcemanager.projectIamAdmin` (would let it grant anything), `roles/artifactregistry.repoAdmin` at the
  project, `roles/editor`; reusing `gh-deployer@` (it is GitHub's, through Workload Identity, which stays optional). The
  set is UNVERIFIED as complete: the first real install's 403s name what is missing, and each addition is logged here.
  Why Cloud Build and not REST calls from the browser per function (finding 10's first sketch): the same
  `firebase-tools` that CI and the terminal use, so one deploy logic, and its first-deploy behaviour is what the live
  test already exercised.
- **67b DECIDED (applied by hand on 2026-10-25 with the user's approval; Provision adds it in M6): `roles/run.invoker`
  for `fn-events@` and `fn-admin@` on the project.** Eventarc delivers the Firestore, Storage and Pub/Sub events with
  the function's own account, Cloud Scheduler's OIDC calls as `fn-admin@`, a task queue's tasks as the enqueuer; without
  the role the import stopped at 0 of 45. Project-wide because both accounts only ever call this project's functions and
  the grant must exist before the functions do. The narrower alternative, the role on each function's Cloud Run service
  after every install (the installer's `verify` step would grant it), is the user's to choose; it adds a step to every
  install and leaves a window after a new function appears.
- **67c PROPOSED, NOT APPLIED (two workflow edits, ask first): GitHub Pages becomes optional.** The public map's home is
  Hosting. To retire the Pages site without breaking the 2015–2022 links, `ci.yml`'s "Upload the GitHub Pages
  artifact" would upload `dist/pages-redirect` (each page sends its visitor to the Hosting address with the same hash)
  instead of `dist/site/bucharest`; to keep Pages as a second public address, nothing changes. Either way a push to
  `master` publishes it (ask first).
- **67d For the user: the viewer's origins.** `infra/project.json` `viewerOrigins` and `HCM_VIEWER_ORIGINS` become the
  two Hosting origins; the contract keeps `https://ventura8.github.io` beside them while the Pages site exists (its
  token keeps working there). Dropping it once 67c's redirect is live tightens the token.
- **67e PROPOSED, NOT APPLIED (a network read, ask first): the digest of `gcr.io/cloud-builders/docker`.** The pipeline
  build's Docker steps must name their image by digest (the repository's rule). Reading the current digest is a request
  to Google's registry (no image is pulled), so it waits for the user's yes; until then the pipeline target is complete
  and tested against the fakes, and the live card says it is not available in this release. The command, for the yes:
  `docker buildx imagetools inspect gcr.io/cloud-builders/docker:<version>` for the builder's current version tag (its
  digest written into the build definition, the version in a comment, never a moving tag).
- **67f For the user: a likely free trial is guessed, not read.** The Cloud Billing API v1 says nothing of a free trial
  (UNVERIFIED at the time of writing; checked again by setup-ux). An account that appeared while Setup's billing card
  waited (a new account, which Google opens as a trial for a new customer) is recorded as a likely trial, and Home
  reminds 14 days before its 90th day, with the link to upgrade and "It is a paid account" to dismiss it for good. An
  account that existed before is never flagged.
- **67g For the user, after the probe: the Vertex AI model.** The `ai` check's `apiError.internal` means Vertex AI
  answered with a failure the check did not map (a 404, a 400 or 422, a 401, or no `totalTokens`); the leading
  hypothesis is a 404 for `gemini-2.5-flash-lite` in `us-central1` (retired, or not offered to this project), UNVERIFIED.
  M6 logs the status and Google's reason and names them on the card; if the probe shows a retired model, changing
  `VERTEX_MODEL_ID` (and its price constant) is a reviewed change for the user's yes. The `ai` check becomes optional: it
  never keeps Setup from "done".
- **67h DECIDED: a 69th function, `ops.onProbe`.** The self-test's new `events` check needs a real event to travel
  through Eventarc to a function running as `fn-events@`; no existing trigger is harmless to provoke (each publishes,
  processes or records history). It costs one more function to build and deploy and nothing at rest.
- **67i DECIDED: the Setup input budget grows from 9 inputs to 11** (4 consents unchanged): Install the server and
  Publish the map are a button each, as the user asked; the imagery pipeline's install rides on the server's click.
  With USGS postponed the whole assistant takes 9 inputs, the required steps alone 7. In exchange D2–D5 and D7 leave the
  terminal.
- **67j PROPOSED, NOT APPLIED (a workflow edit, ask first): `--force` in `ci.yml`'s `deploy-firebase`.** `firebase-tools`
  refuses, non-interactively, to deploy a function with a failure policy (`notify.onEvent`) and to set the image cleanup
  policy without it (finding 9). It also deletes functions missing from the source, which is right for a deploy of
  `master`. The in-app installer passes it and refuses to install a bundle older than the installed server.
- **67k DECIDED: Cloud Build downloads at install time, in the owner's project.** The builds install `firebase-tools`
  from npm (each package checked against the bundle's lockfile integrity) and pull the step images by digest, and Google's
  own function builds install the functions' locked dependencies, as every deploy already did. None of this runs on the
  developer machine or the NUC, and nothing is downloaded by the gates.
- **67l For the user, later: an update channel for owners without CI.** The admin installs its own bundle; a newer
  admin reaches Hosting by a CI deploy, a terminal deploy, or a future "a new release exists" check (for example the
  release workflow attaching the bundle to the GitHub Release and the admin reading the latest release). Not in M6.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` (the registry's 69 new planned rows, the regenerated
`docs/E2E_SCENARIOS.md`, the Markdown).

## 68. The M6 hosting workstream: the public map on Firebase Hosting, the admin under `/admin/` (2026-10-25) — 68a–68h APPLIED (product, test, tooling and documentation changes within `docs/research/M6-interfaces.md` §2 and its change requests CR-M6-15 to CR-M6-19; 68g a new gate of the build stage, the pre-approved kind; no gate relaxed, no budget raised, no checker allowlist entry, no download); 68i UNVERIFIED until the first deploy; 68j for the user, ask first

- **68a APPLIED: the Hosting tree and `firebase.json`'s Hosting block.** `npm run build:hosting`
  (`scripts/site/build-hosting.ts`, `scripts/site/src/hosting/`) builds every committed city site for Hosting (each
  reading the public bucket `<projectId>-public` or `HCM_PUBLIC_BUCKET`; the root one, `pagesPath` `""`, with
  `admin-redirect.js` first), the generic city page (`/city/`: its `config.js` takes the city id from the address and
  reads `cities/<id>/manifest.json` of the bucket, so a city made in the admin needs no repository step), and assembles
  two trees: `dist/hosting-public/`, always the public variant (the installer's `hosting.tgz`, CR-M6-5), and
  `dist/hosting/` (`hosting.public`), the variant this deploy publishes: start-up with `HCM_ADMIN_START_UP=1` (a
  bilingual "being set up" page, no engine, the admin's `runtime.json` `startUp: true`), else public. The release is the
  admin build's own (`runtime.json`), written to `/release.json` with the variant; `admin/install/` is never copied from
  the admin's build. `firebase.json`: `public` `dist/hosting`, `predeploy` `build:hosting`, `cleanUrls`,
  `trailingSlash: true`, `/admin` → `/admin/` (301), rewrites `/admin/**` → the admin's page and
  `^/[a-z0-9-]{2,32}/?$` → `/city/index.html`, the admin's CSP, Trusted Types report-only and COOP on `/admin/**` only,
  `Referrer-Policy`, `nosniff` and the Permissions-Policy everywhere, no CSP outside the admin (every viewer page keeps
  its meta policy: a probe-path test pins one policy per page), pages `no-cache`, `/admin/legacy/**` a day,
  `/admin/install/**` a year and immutable with its `manifest.json` `no-cache`. `scripts/site/src/admin/hosting.ts`
  now reads redirects, regex rules and `trailingSlash` in superstatic's order (the Hosting emulator's engine), with
  superstatic's trailing-slash and clean-URL moves as tables (complexity 5). The Hosting build is a CLI of its own,
  not the `--hosting` flag of `build:site` that §2.1 sketched: it needs the admin's build and the bucket for every site,
  which the Pages build does not, and Hosting's `predeploy` runs it alone.
- **68b APPLIED: the e2e Hosting server.** `e2e/mock-apis/admin-server.ts` serves the e2e build's Hosting tree
  (`dist/e2e-hosting`, built by `e2e/scripts/build-site.ts` with the production assembler) through
  `resolveHostingPath`; the admin's reserved files moved to `/admin/runtime.json` and `/admin/project.json`; the
  start-up tree (`dist/e2e-hosting-start-up`) answers a browser with the cookie `hcm-e2e-variant=start-up` (per browser
  context, so parallel tests never see each other's variant); `/__old-push-sw.js` is a root push worker for the
  old-worker scenario. It starts for every e2e run (`e2e/playwright.config.ts`: the viewer tier's V30 opens it; the
  emulators stay the admin tiers' only), and every e2e build now builds the admin's Hosting folder (a few seconds:
  the tree holds it; `scripts/ci/e2e_build.py` counts the two trees among its outputs). Every admin spec's address
  moved under `/admin/` in one change (`adminPath`, `ADMIN_URL`, the helpers of the specs' worlds); the local stack's
  root sends to `/admin/` so `.claude/launch.json` keeps opening the admin. `create-historic-city`'s self-host bundle
  follows the base too: its Hosting folder is `hosting/` with the admin in `hosting/admin/`, its template redirects the
  root to `/admin/` (302) until the map is published, and the CLI opens `https://<id>.web.app/admin/`.
- **68c APPLIED: the admin under `/admin/`.** `packages/admin/vite.config.ts` `base: '/admin/'`; the admin fetches
  `runtime.json` and `project.json` at `import.meta.env.BASE_URL` (`/admin/` in the builds, `/` under the unit tests);
  everything else it loads is relative to its page (chunks, fonts, `legacy/`, `install/`) or Hosting's reserved
  `/__/` paths (unchanged, same origin, same authorised domains). The push worker's start page is its own scope
  (`/admin/`), and both registrars (FCM and the `e2e` stand-in) unregister a registration of the site's root scope
  (`retireRootWorker`) before registering their own, so no worker of a pre-M6 admin controls the public map; the
  stand-in registers the real worker where the browser lets it (the e2e projects block service workers unless a spec
  allows them). The functions' `adminUrl` is `https://<project>.web.app/admin/` (invitations, the inbox's and push's
  links); with no `HCM_VIEWER_ORIGINS` the viewer's origins default to the project's Hosting origins.
- **68d APPLIED: one origin, two apps' traces kept apart.** The admin's GA4 runs with `cookie_prefix: 'hcm_admin'`
  and its withdrawal expires only `hcm_admin_ga*`, never the viewer's `_ga` (cookies a pre-M6 admin wrote as `_ga` stay:
  nothing tells them from the viewer's). `telemetry.reportError` decides the Error Reporting service by the report's
  page (under `/admin/` on an admin origin the admin's, else on a viewer origin the viewer's, else on an admin origin
  the admin's: a pre-M6 admin at the root) and refuses, 403 `apiError.telemetry.origin`, a report whose page is not on
  its request's `Origin` (S-A24-HAPPY-SAME-ORIGIN, S-A24-BAD-PAGE-ORIGIN-MISMATCH).
- **68e APPLIED: the viewer's token follows the server's origins** (`functions/src/ops/viewer-tokens.ts`, run by
  `ops.tick`'s `tokens` step after the retirement). A city whose recorded `mapbox.allowedUrls` differ from
  `viewerOrigins` gets a token minted for them as `setup.rotatePublicToken` mints one, written to the city (its manifest
  republishes when the city is published) and the old one queued for retirement after `TOKEN_RETIRE_MINUTES`; at most
  the retirement queue's room per tick. A refused mint keeps the old token and records `setup/status.mapbox.detail`
  (`apiError.mapbox.mintRefused`, the area's state unchanged) and fails the step with that code; the next successful
  re-mint clears it. Deviation from §2.6 (CR-M6-19): the contract's `viewerAllowedUrls` is the existing
  `cities/{city}.mapbox.allowedUrls`, which `setup.saveMapbox` and `setup.rotatePublicToken` already write; a token
  without recorded addresses is left alone (what it allows is not known). The feature folders reach each other only
  through `api/` (dependency-cruiser's `functions-feature-folders-independent`), so the re-mint has its own small mint
  and transaction instead of `setup/`'s, and `tokenNote` moved to `functions/src/api/mapbox-token-note.ts` (re-exported
  by `functions/src/setup/mapbox-tokens.ts`), so a token's note stays one formula.
- **68f APPLIED: the viewer's origins** (§67d's default, the user's to change): `infra/project.json` `viewerOrigins`
  and `functions/deploy-env.json` `HCM_VIEWER_ORIGINS` are `https://bucurestiul-disparut.web.app`,
  `https://bucurestiul-disparut.firebaseapp.com` and `https://ventura8.github.io` (kept while the Pages site exists).
  `city` joins `RESERVED_CITY_IDS` (the generic city page's folder); the New city flow's suggestion for a name with no
  letter or digit becomes `my-city`.
- **68g APPLIED (the pre-approved kind: a stricter gate): `hosting-build`** in the build stage
  (`scripts/ci/pipeline.py`, after `vite-build`; `node --import ./scripts/site/register-ts.mjs
  scripts/site/build-hosting.ts`, so the stage's own builds are reused), with its line in `test_pipeline.py`.
- **68h APPLIED: the GitHub Pages redirect tree** (`npm run build:site -- --pages-redirect <dir>`,
  `scripts/site/src/hosting/pages-redirect.ts`): a page for the root and each city's Pages path, each sending the
  visitor to the same page on `https://<projectId>.web.app/` with the same query and hash (the target is a build value
  in `<html data-target>`, never the address's), the root's `404.html` to Hosting's root; without script each says the
  map moved, in Romanian and English. `npm run build:site` builds it beside the Pages tree (`dist/pages-redirect`, so
  the build stage's `site-build` proves it), which makes §67c, when the user says yes, the one workflow line
  `path: dist/site/bucharest` → `path: dist/pages-redirect` of `ci.yml`'s "Upload the GitHub Pages artifact" step.
  Publishing it stays §67c (ask first).
- **68i UNVERIFIED until the first deploy:** that the live Hosting CDN applies `trailingSlash` and `cleanUrls` as
  superstatic does (the e2e resolver and the probe-path tests implement superstatic's moves); that GA4's `cookie_prefix`
  names the cookies `hcm_admin_ga` and `hcm_admin_ga_<container>` (the withdrawal matches one or more underscores).
- **68j For the user, ask first: D1 with the M6 tree** (`docs/MANUAL_TEST_PLAN.md` → D1): `npm run build:hosting` in
  the image (with `HCM_ADMIN_START_UP=1` for the start-up page, or without it for the public map directly: this
  project's server and published manifest exist), then `firebase deploy --only hosting`. After it the admin is at
  `https://bucurestiul-disparut.web.app/admin/` and every old `/#/…` address forwards there.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`; the `tools`, `admin`, `shared` and `functions`
Vitest projects; Playwright `specs/viewer/hosting.spec.ts` at `fn-l1440-ro`, the site states at the 44 tour projects,
`admin/specs/shell/admin-path.spec.ts` and the admin specs whose addresses moved at `admin-l1440-ro`.

## 69. The M6 server-bugs workstream: the Scheduler's account, the events probe, the API propagation wait, Provision's M6 rows and the Vertex AI failures (2026-10-25) — 69a–69f, 69h and 69i APPLIED (product, test and documentation changes within `docs/research/M6-interfaces.md` §1.2, §1.5, §1.6 and §3.2 and CR-M6-2, with CR-M6-6 to CR-M6-8, CR-M6-14 and CR-M6-20; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download); 69g for the user

Findings 4, 11, 12, 17 and 20 of the user's live manual test (`docs/research/manual-test-2026-10-25.md`). Every change is
tested against the emulators, the fakes and the e2e mock servers; nothing reached a real Google, Vertex AI or Mapbox
endpoint, and nothing was deployed. The lessons are `docs/LESSONS.md` 260–265.

- **69a APPLIED: every function names its runtime account in full (finding 11).** `runAs` and the global default
  return `<account>@<project>.iam.gserviceaccount.com`, the project read from `GCLOUD_PROJECT` (firebase-tools sets it
  for discovery; the emulators set `demo-hcm`), else `GOOGLE_CLOUD_PROJECT`; neither set is a refusal naming both, never
  the shorthand. `functions/test/deploy-shape.test.ts` loads `src/index.ts` with firebase-tools' discovery environment
  (as `index.test.ts` does: the `tests` stage runs before any build, and the bundle is the same code; a deviation from
  §3.2's "the built `functions/dist/index.js`", CR-M6-8) and builds each scheduled function's Cloud Scheduler job with
  firebase-tools 15.33.0's own `jobFromEndpoint`, which reproduces the bug with the shorthand and passes with the full
  address. On the live project the next server install creates both jobs.
- **69b APPLIED: the self-test's `events` check and `ops.onProbe`, the registry's 69th function (finding 17, §67h).**
  The check writes `ops/probe` with a fresh nonce (system writer `ops`) and polls it once a second for at most 20 s
  (`EVENTS_PROBE_WAIT_MS`); `ops.onProbe` (`fn-events@`, one instance, no retry) copies the nonce back in a transaction,
  so it never overwrites a newer probe and its own write answers nothing. No answer is `apiError.setup.eventsUnreached`
  naming `roles/run.invoker`. The `Clock` port gains an optional `sleep` for the poll (the system clock's is Node's
  timers; a test clock without it polls its rounds at once). The probe's document needs no rule: no client reads it,
  and `ops/{doc}` stays closed for ids the rules do not name.
- **69c APPLIED: an API Google is still switching on is waited for (finding 4, §1.5).** The admin's transport, given
  `withApiPropagation`, waits out a 403 `SERVICE_DISABLED` of an API that Service Usage reports enabled (asked once, at the
  first refusal) after 10, 20, 40, 60 and 60 s on the injected clock, the running item reading "Waiting for Google to
  switch on {api}…"; still refused, the item is `missing` with `apiError.cloud.apiPropagation`. An API Service Usage
  reports off fails at once, as before. Every client of the Setup Assistant's Cloud port has it, so the installer's
  submit can share it.
- **69d APPLIED: Provision's M6 rows (findings 12 and 17, CR-M6-2).** `hcm-installer@` with exactly §1.2's roles and the
  custom role `hcmInstaller`; `roles/iam.serviceAccountUser` for it on the four runtime accounts only;
  `roles/artifactregistry.writer` on the repository `hcm` only; the item `artifact-registry` (the Docker repository with
  its cleanup policy keeping two images; 16 items); `roles/run.invoker` for `fn-events@` and `fn-admin@` on the project
  (§67b, as granted by hand); the Eventarc and Pub/Sub service identities generated before the role table; the APIs
  `firebasehosting`, `firebaserules`, `firestore`. Beyond §1.2, recorded for review (CR-M6-8): firebase-tools'
  `ensureServiceAgentRoles` wants, on a project with no event function yet, the Pub/Sub agent's
  `roles/iam.serviceAccountTokenCreator` and the Compute Engine default account's `roles/run.invoker` and
  `roles/eventarc.eventReceiver`, and writes the project's policy when they are missing, which `hcm-installer@` may only
  read; Provision binds them so the first install only reads them, the compute account's only when the project has that
  account (a binding naming a missing account would make Google refuse the whole policy).
- **69e APPLIED: the Vertex AI failures are named and logged (finding 20).** `UpstreamError` keeps Google's
  `error.status` and the first `ErrorInfo` reason (`[A-Z_]{1,64}` or dropped, never the message); the self-test logs
  `{check, code, service, failure, status, googleStatus, reason}`; a 404 is `apiError.assist.modelUnavailable {model}`
  in the check and on the drafts button; any other refusal is `apiError.cloud.refused {api, reason}`, never
  `apiError.internal`. On the live project the owner's Check again after the next server install names the cause
  (§67g).
- **69f APPLIED: the import re-sends a photo whose upload event was lost (finding 17).** A photo still `pending` two
  minutes after its upload (`STUCK_PHOTO_MS`, the injected clock) goes to `photos.reprocess` once; still `pending` two
  minutes later it is listed as `apiError.photo.notReceived` (a new code: the import's line takes no parameter) with a
  link to Prepare the project, and the import goes on. The e2e loses the first event by sending the upload, with the
  Storage emulator's admin token, to a name in the same folder that `photos.onUpload` ignores (`photos.reprocess` still
  finds it, and runs for real in S-A28-HAPPY-STUCK-REPROCESSED); for the second loss (S-A28-BAD-STUCK-AGAIN) the test
  answers the page's `photos.reprocess` call as the callable does, without the copy, because the emulators always
  deliver the event of a copy the server makes. That one answered callable is a judgement for review: the alternative
  is a test-only switch in the functions, which the repository's rules forbid.
- **69g For the user (UNVERIFIED until the first in-app install, ask first): the Compute Engine API.** firebase-tools
  reads the Compute Engine default account on a first functions deploy (`gce.getDefaultServiceAccount`). Provision does
  not enable `compute.googleapis.com` (enabling it creates that account, with Editor on the project unless the
  organisation withholds the default grants); the live project already has it from D3. If a fresh project's first install
  fails there, adding `compute` to `REQUIRED_APIS` is the user's decision.
- **69h APPLIED: CR-M6-14 (setup-ux's request, 2026-10-30).** A Check again keeps `setup/status.usgs.pendingSince`
  (S-A59-HAPPY-APPROVAL-PENDING's date survives the self-test), and `apiError.cloud.apiPropagation` ends "Wait a
  minute, then retry what failed" instead of "Try again in a minute", so it names the provisioning card's button
  (finding 5) without a mapping on the card.
- **69i APPLIED: Retry what failed waits for the run's record (CR-M6-20).** In normal mode the Provision card recorded a
  run with `setup.recordCloud` after it had already re-enabled Retry what failed; a Retry clicked meanwhile ran and
  recorded first, and the older record, applied last, put the items back (13 of 16, `service-accounts` missing). The
  card now stays busy until the record is back; S-A04-BAD-API-STILL-DISABLED failed about one run in two before.

Verify: `PIPELINE_STAGE=static` and the workstream's targeted Vitest projects and Playwright specs inside the image (the
workstream's report quotes them); the split stage is the integrator's.

## 70. The M6 setup-ux workstream: the frame's rules, the billing wait, USGS later, the likely free trial and the shell's fit (2026-10-25) — 70a–70i and 70k APPLIED (product, test and documentation changes within `docs/research/M6-interfaces.md` §3.1 and §4.1, CR-M6-3, CR-M6-4 and the self-applied CR-M6-12; 70h a stricter tour check, the pre-approved kind; no gate relaxed, no budget raised, no checker allowlist entry, no download); 70j for the user; 70l APPLIED 2026-10-31 (§74)

The workstream answers findings 1, 2, 3, 5, 6, 7, 15, 16, 18, 19, 22 and 24 of the live test of 2026-10-25
(`docs/research/manual-test-2026-10-25.md`) and the quiet part of finding 20.

- **70a APPLIED: when Setup is done is one rule, `setupDone` (`packages/shared/src/api/setup-done.ts`).** Billing, the
  project's preparation and Mapbox `ok`; USGS `ok`, postponed (`usgs.postponedAt`) or waiting for USGS's approval of a
  saved token (`pending` with `apiError.usgs.accessPending`, which takes days); and, once Setup records the installer's
  targets (`setup/status.install`), the server and the site installed (`installed`, `updateAvailable`, `newerInstalled`).
  A `setup/status` without `install` is a map set up before M6, whose server answers: it is not held back. The Setup
  page's header ("Setup done", "— USGS later", "— approval pending"), the dashboard-first rule (`setup-readiness.ts`) and
  Home's reminders read it; the server's own `setupReady` (the view's `ready`) is unchanged. The admin state's `ready`
  reads the areas and USGS; the install part there is the installer's (CR-M6-13).
- **70b APPLIED: Do it later is a record, not a state.** `setup.recordCloud`'s `postponed: {usgs}` sets or clears
  `usgs.postponedAt` and keeps the area's own state and reason (a refused token stays `invalid` with its reason, later);
  a saved token replaces the record whole, which ends the postponement. The chip reads Later (`step.postponed`), the
  progress counts it apart, the next step to open treats it as settled (CR-M6-4). One input (`skipUsgs`).
- **70c APPLIED: since when the approval is awaited is the server's (`usgs.pendingSince`).** Set by the first `pending`
  check (`usgsRecord`), kept while USGS does not answer and by a re-saved token, gone once approved. `ops.tick` keeps it
  (it rewrites the record field by field); the self-test's `usgsAfter` does not pass it on yet, so a Check again restarts
  the date (CR-M6-14 to server-bugs, one line).
- **70d APPLIED (implements 67f): a likely free trial.** An account the billing card's wait finds (never one listed at the
  first look) records `billing.trialSince` (the day it appeared, through the bootstrap record before the claim, kept by
  later billing reports, never moved, never in the future); Home reminds from 14 days before its 90th day with the
  billing page (`gcp.billingAccounts`, verified) until "It is a paid account" records `billing.trialPaidAt` (one input,
  `dismissTrial`). Whether the Cloud Billing API can tell a trial apart is still UNVERIFIED: checking Google's reference
  is a network read this workstream does not make.
- **70e APPLIED: the billing card's wait (finding 3).** A primary **Create a billing account** opens
  `https://console.cloud.google.com/billing/create` (`gcp.billingCreate`, added to `links.json` in the console's
  documented form and checked by the next weekly contract run, as `gcp.errorGroup` was); while the card waits it offers
  no Link button, says what it does by itself, and when it last looked (outside the status region, which announces the
  wait once).
- **70f APPLIED: the frame's rules (findings 6, 7, 15).** A busy chip shows the loading indicator in place of its icon,
  its shape sized to the 18 px box through `::part(indicator)`, and says Working… (a still icon with reduced motion); the
  consent note shows only while no live token holds the card's scope (`liveScopes`, read on every change), and beside
  Continue when that is the button; a `*.progress` reason is the body's count and is not repeated; a deep link's advice
  is a hint beside it (`LINK_HINTS`). `apiError.cloud.apiDisabled` names the Setup step (the server checks link it); the
  provisioning card says Retry what failed instead (`adminSetup.provision.apiDisabled`).
- **70g APPLIED: the shell fits (findings 1, 2, 22).** The loading screen's padding is inside its `100dvh`; it has a
  visually hidden page heading (axe's `page-has-heading-one` on the new tour state); the sign-in, claim, join and blocked
  panels are centred from 600 × 480 and start at the top below; the page's root wears the shell's theme and surface (a
  constructed sheet, `root-surface.ts`: no inline style), so the canvas under a scroll past the end or an overscroll is
  the surface. The self-test list's focus ring is its container's on colour (the tour measured secondary at 2.16:1 there).
- **70h APPLIED (the pre-approved kind: a stricter check): `graphic-overlap` in the tour's layout checker.** A loading
  indicator's shape (`[part="indicator"][role="progressbar"]`) must not cover any text but its own; the occlusion check
  samples a text's centre only and the overlap check floating chrome only, so finding 6 passed both. Limited to the
  indicators (their shapes turn and morph past their box); icons are next.
- **70i APPLIED: the import's end in the snackbar (finding 19).** All on the map, or how many with Open (ten seconds),
  which opens the card's list; a notice's action may now be a Setup text (`NoticeInput.action.key`).
- **70j For the user: the Vertex AI check stays listed, apart.** The translation drafts' check is under Optional
  features, off with its reason and a neutral icon, never holding Setup back (finding 20's quiet part); the model choice
  is still 67g.

- **70k APPLIED (the workstream's second run, 2026-10-30): what the first run's verification left.** The Setup page wears
  the kit's focus ring (`focusRing` in `hcm-setup-page`'s styles): its server checks' fix links had the browser's own
  ring, which the tour measured at 2.16:1 on the list's container at `admin-c360-ro` only (Android's orange ring; the
  desktop's near-black one passes the contrast check, so the other projects could not see it); a unit test pins the
  ring's style and colour. S-A03-HAPPY opens the analytics card itself: since the installer's imagery pipeline step
  (d3, optional) the next step not done after USGS is the pipeline's, not analytics. Four test files' types fixed for
  `tsc -b` (`renderRoot` on an `HTMLElement`, a status view in the reminders' fake answer, the bootstrap record's type,
  `apiError.photo.unreadable`).

- **70l APPLIED 2026-10-31 (§74e; the user approved the dependency update and the `re2js` fix): the `npm-audit` gate's new advisory.** On 2026-10-30 the static
  stage's `npm-audit` fails on GHSA-gg6h-894w-4m9c (high: quadratic-time lookbehind matching in `re2js` 2.2.0–2.8.6),
  reached through `markdownlint-cli2@0.24.0` → `markdownlint@0.42.0`, which pins `re2js` 2.8.6 exactly (the Firebase
  SDK's `^2.8.3` resolves to the same copy; the admin's build already replaces it, §65k). No M6 change brought it: the
  advisory is new. The fix is an `overrides` entry for `re2js` at its first patched release (or, if none is out yet,
  `markdownlint-cli2` held at 0.23.3, the downgrade `npm audit` offers, as a `HELD` entry with this reason), applied
  with `npm install` in the digest-pinned `node:24-bookworm-slim` image (`docs/SETUP.md` → *npm in a container*): a
  download, so it waits for the user's yes; never an allowlist. Until then `PIPELINE_STAGE=static` stops at
  `npm-audit` for every workstream.

Verify: `PIPELINE_STAGE=static`; Vitest `shared`, `admin`, `ui`, `e2e-support` and the setup tests of `functions`;
Playwright `admin/steps` at `admin-steps-l1440-en` and `admin/specs/shell/setup-*.spec.ts` at the five admin projects,
inside the image (the workstream's report quotes them); the split stage is the integrator's.

## 71. The M6 installer workstream: Cloud Build from the browser, the install bundle, the three cards and Home's tile (2026-10-30) — 71a–71g APPLIED (product, test, tooling and documentation changes within `docs/research/M6-interfaces.md` §1, §4.1, §6 and the accepted CR-M6-3, CR-M6-4, CR-M6-5 and CR-M6-16, with the self-applied CR-M6-21; 71e two new gates of the build stage and new rows of `check_bundle_budget.py`, the pre-approved kind; no gate relaxed, no budget raised, no checker allowlist entry, no download); 71h for the user; 71i APPLIED 2026-10-31 (§74)

The workstream answers the user's requests (1) "a button" in step d, (2) no terminal in the rest of Setup, and the
installer's part of (3), the public map published from the admin (findings 9, 10, 12, 13 and 14 of
`docs/research/manual-test-2026-10-25.md`).

- **71a APPLIED: the installer's port and its Cloud Build adapter** (`packages/admin/src/install/`, the REST clients
  `packages/admin/src/google/{cloud-build,logging,run-jobs,artifact-registry}.ts`). The admin submits each target's
  build of its own bundle with the owner's `cloud-platform` token (memory only, as Provision), as `hcm-installer@`, and
  reads the builds by tag, each step's state, the failing step's last 20 log lines (Cloud Logging, redacted, shown as
  text) and what is installed (the functions' `HCM_RELEASE`, the jobs' `hcm-release` label, the site's `/release.json`).
  The build definitions are data (`build-spec.ts`) checked against golden JSON; the first step (`fetch`) is an inline
  Node program that refuses any file whose SHA-256 is not the one the admin read.
- **71b APPLIED: the install bundle** (`npm run build:install`, `scripts/site/src/install/`): `server.tgz`,
  `pipeline.tgz`, `hosting.tgz` and `manifest.json` at `admin/install/<slug>/` of the deployed Hosting tree,
  deterministic (sorted ustar entries, fixed modes and owner, `SOURCE_DATE_EPOCH`, gzip without name or time: two builds
  of one commit give the same bytes), `firebase-tools` cut from the root lockfile offline, the step scripts bundled from
  `scripts/site/src/install/steps/` (the contract's `scripts/install/` lives there, CR-M6-21). `HCM_RELEASE` joins the
  functions' `.env.<project>` (`functions/build.mjs`).
- **71c APPLIED: the cards.** Install the server (d, one click, which also starts the imagery pipeline), the imagery
  pipeline (d3, no input of its own; Try again on a failure) and Publish the map (i, one click; off with the reason while
  the first city has no published manifest), each with its steps, the server's functions' count once, the retry Google
  is waiting on, a stopped build's step, log and console link, the build minutes against the free tier, and **Update the
  map** when what is installed is older than the admin. A click restarts the card's watch (its next look one running
  interval later, whatever wait an earlier failed look had set), and Update the map counts what the cards show,
  recorded states included, so a target Setup recorded behind is updated before its card looked (both found by the
  e2e). A release recorded or installed elsewhere is shown undated ("Installed: {release}."). The cards send their
  records one after another, and `setup.recordCloud` keeps a stored target record checked later than the reported one
  (two records of one card had landed out of order; `functions/src/setup/record-install.ts`, the installer's marked
  part). The cards' links and the GitHub disclosure are 48 px targets (the tour's checker at the compact and medium
  windows).
- **71d APPLIED: Home's installation tile** (`home.update-tile`): a target recorded `failed` first, else one recorded
  `updateAvailable`, with the link to its Setup step (`adminSetup.install.tileOpen`). The tile names no release: Home
  has no token and no bundle to compare with; the card does.
- **71e APPLIED (the pre-approved kind: stricter): two gates of the build stage.** `install-build` (after
  `hosting-build`: the bundle from the stage's own builds) and `install-budget` (`check_bundle_budget.py --install`:
  each tarball as served against the contract's ceilings, `server.tgz` 8,000 KB, `pipeline.tgz` 1,000 KB, `hosting.tgz`
  80,000 KB).
- **71f APPLIED: the e2e world.** The fake Cloud Build plays each build by scenario (no step runs) and changes the world
  as a real build would; new scenarios `cloud-build.installerAccount` (the installer's account of a map prepared in an
  earlier session), `cloud-build.siteOlderRelease`, and the preset `install.provisioned`. The specs wait for the
  submitted build before they move it on (a scenario applied before the browser's POST found no build), reopen a card
  after its step turns done (the page moves on), write the published manifest only once the seeded city's own build
  has ended and with the publisher's stamp (`seedPublishedMap`: an unstamped record made the publish trigger's
  retries hold `manifests/{city}`, and every later reset failed), and end only when no `setup.recordCloud` is under way
  (`recordsSettled`). Lessons 266–270.
- **71g APPLIED: the input budget.** `updateMap` (1 input; one consent in daily use) joins `CONTENT_INPUT_BUDGETS`; the
  steps' budgets are those of §6.2.
- **71h For the user (UNVERIFIED until the first real install, §9 of the contract):** that Cloud Build and Cloud
  Logging answer a browser's bearer request (CORS), the installer's role set, the build minutes, and the docker
  builder's digest (§67e: until then the live pipeline card says it is not available in this release). `setup.status`
  does not answer `serverRelease` (contract §1.7): Home reads the records, and Setup reads the functions' release from
  Cloud Functions; adding it needs no new input.

- **71i APPLIED 2026-10-31 (§74e; the user approved the dependency update and the `re2js` fix): the `npm-audit` gate fails on a new advisory.** GHSA-gg6h-894w-4m9c
  (high: quadratic-time matching in `re2js` 2.2.0–2.8.6, which `markdownlint` ≥ 0.42 and so `markdownlint-cli2` ≥ 0.24
  pull in) appeared after the M6 contract's run; the image's npm cache holds only `re2js` 2.8.6. The fix is an `overrides`
  entry pinning the first patched `re2js` release (exact version from the advisory at the time), installed with the
  digest-pinned `node:24-bookworm-slim` as `docs/SETUP.md` → *npm in a container* says, then `npm audit --audit-level=low`
  clean; `npm audit fix --force` would instead downgrade `markdownlint-cli2` (a breaking change) and is not the fix. No
  workstream code is involved; every stage's other gates were green on the installer's tree.

Verify: Vitest `shared`, `admin`, `ui` and `tools` for the installer's files; pytest `scripts/ci/tests`; Playwright
`admin/steps/install` at `admin-steps-l1440-en` and `admin/specs/install` at the admin projects, inside the image; the
split stage is the integrator's.

## 72. The M6 integrator: the change requests closed, the whole Setup with no terminal, the local stack's bundle, and what waits for the user (2026-10-30) — 72a and 72b APPLIED (product, test, tooling and documentation changes within `docs/research/M6-interfaces.md`, closing CR-M6-11, CR-M6-13, CR-M6-17, CR-M6-18 and CR-M6-22; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download); 72c APPLIED 2026-10-31 (§74); 72d for the user, ask first

- **72a APPLIED: the whole Setup with no terminal** (`e2e/admin/specs/journey.spec.ts`, S-A30-HAPPY-NO-TERMINAL and S-A30-BAD-TOKEN-EXPIRED, rows `exists`; S-A30-HAPPY's count is 11 inputs since M6). From sign-in in start-up mode to the public map at the e2e Hosting root showing the 45 photos the emulated server published (`servePublishedMap`), against the fakes, with USGS done later. It found two product bugs, fixed with their unit tests (and the split run a spec of A60 that read Home's live list once, lesson 275): Publish the map stayed off once the tab's Google token no longer granted Google Cloud (`InstallerPort.localBlocker`, lesson 273), and the admin's `ready` ignored the install part `setupDone` has (lesson 274). The bad row publishes two hours after Prepare the project: one consent from the same click, nothing asked again. The first split `quality` also failed A60's two specs (`e2e/admin/steps/billing-trial.spec.ts`: Home's list read once, with the installer's update tile of another behaviour in it); the spec now polls the list and counts its own kinds (lesson 275).
- **72b APPLIED: the change requests the integrator held.** CR-M6-17's second part: New city's done screen and Settings → Publishing show the city's public address, `https://<origin>/<id>/` from the admin's own origin (the same Hosting site; `packages/ui/src/admin/cities/public-address.ts`), and their texts no longer name `npm run site:add`. CR-M6-22: `firebase/rules-tests/test/firebase-config.test.ts` reads the admin's headers from `**` and `/admin/**`, pins `public: dist/hosting` and that no CSP goes to every path. The local stack serves its admin's install manifest for the e2e tree's release (`e2e/stack/servers.ts`, the manifest from `e2e/fixtures/install-bundle.ts`), so `HCM_STACK_SEED=fresh` rehearses Install the server and Publish the map, a build ending on the fake's `cloud-build.finish`. The documents and agent assets of CR-M6-11, CR-M6-13 and CR-M6-18: `docs/MANUAL_TEST_PLAN.md` (Setup lists no terminal command; D1 is the one terminal deploy, with `build:install`; D2, D3, D5, D7 the terminal fallback; how the Bucharest project moves the admin to `/admin/`), the admin guides, ARCHITECTURE (the installer), TESTING, CI_PIPELINE, the skills and their mirrors, lessons 271–274, `docs/research/M6-status.md`.
- **72c APPLIED 2026-10-31 (§74e: `"re2js": "2.9.1"` in the root `overrides`; the user approved the dependency update and the `re2js` fix): the `npm-audit` advisory of §70l and §71i.** GHSA-gg6h-894w-4m9c (`re2js` 2.2.0–2.8.6 through `markdownlint-cli2@0.24.0` → `markdownlint@0.42.0`). The image's npm cache holds only `re2js` 2.8.6 (checked offline, 2026-10-30), so neither an override nor the hold of `markdownlint-cli2` at 0.23.3 is possible without a download. The fix: an `overrides` entry `"re2js": "<first patched version>"` in the root `package.json`, installed with `npm install` in the digest-pinned `node:24-bookworm-slim` image (`docs/SETUP.md` → *npm in a container*), then the quality image rebuilt and `PIPELINE_STAGE=static` green; never an allowlist. It is the only failing gate of `static`, `quality` and `all`.
- **72d For the user, ask first, one at a time** (`docs/research/M6-status.md` §3): D1 with the M6 tree (the one terminal deploy: the admin at `/admin/` with its install bundle), then in the app Prepare the project again, Update the map, Replace the visitors' token (or the next tick), Publish the map and Check again.

Verify: `PIPELINE_STAGE=static`, `tests`, `build`, then `PIPELINE_STAGE=quality bash scripts/ci/e2e-split.sh` (quoted in `docs/research/M6-status.md` §1).

## 73. The M6 reviews' fixes: the admin's sign-in kept in its tab, the installer's guards, the live map's upgrade path and minimum input (2026-10-30) — 73a APPLIED for review (a product choice, reversible in one line: the user decides); 73b–73i APPLIED (product, test and documentation changes; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download); 73j PROPOSED, NOT APPLIED (a product decision); 73k recorded; 73m APPLIED 2026-10-31 (§74)

- **73a APPLIED for review: the admin's Firebase sign-in lives in its tab's `sessionStorage`** (security-cost finding 1). Since M6 the public map and the admin share one origin, and `getAuth` kept the owner's refresh token in the origin's IndexedDB (`firebaseLocalStorageDb`), which any script on a viewer page could read and use to call the owner-only callables. `packages/admin/src/firebase/app.ts` now creates Auth with `initializeAuth(app, { persistence: browserSessionPersistence })`, the popup's resolver passed with each popup (`adapters.ts`; Node's build of `firebase/auth`, which the entry's tests load, has none). The trade-off, for the user: one sign-in per tab (a reload keeps it; a new tab, or a notification's link, asks once more: one click on an already signed-in Google account). Reverting is one line (`browserLocalPersistence`), with the risk above. The admin's `hcm:admin:*` `localStorage` keys hold no secret and no authority: each is a preference read through a fixed parser (the language, the theme, the analytics consent, the city last chosen), so a same-origin script forging one gains nothing it could not do itself. The e2e tier signs a persona in through an init script that fills the admin tab's `sessionStorage` (`e2e/admin/support/session.ts`), only under `/admin/` and the harness page, so a viewer page of the same context starts with nothing (S-A58-HAPPY-SIGN-IN-IN-TAB, S-A58-BAD-VIEWER-READS-NO-SIGN-IN); the content specs take an option `signedIn` for a signed-out tab, and S-A25-BAD-RELOAD-KEEPS-STEPS checks the app's own `sessionStorage` record apart from Firebase's session (lessons 284, 285). A header CSP with enforced Trusted Types on the viewer's paths stays a possible next step (the viewer's meta CSP and Mapbox's SRI already apply).
- **73b APPLIED: an older admin never replaces a newer server, complete or not** (security-cost finding 2). `InstalledInfo` carries the newest release any deployed function or job names (`newest`) and whether part of the target is there (`partial`); `deriveInstallState` says `newerInstalled` whenever `newest` is newer than the bundle, before completeness, so the `--force` deploy of an older release can no longer delete a newer one's functions (S-A55-BAD-DOWNGRADE-INCOMPLETE, unit tests in `model.test.ts` and `cloud-build-installer.test.ts`).
- **73c APPLIED: viewer origins checked before a token is minted, and a minted token the city cannot hold deleted** (security-cost finding 3). `runtimeConfig` refuses `HCM_VIEWER_ORIGINS` that are not at most 10 https origins without a path (`viewerOriginsOf`), `functions/build.mjs` refuses to build them (the same pattern as `httpsOriginSchema`, pinned by `functions/test/deploy-env.test.ts`), and `ops.tick`'s re-mint deletes the new token at Mapbox when the city's write fails (S-A06-BAD-ORIGINS-REFUSED, S-A06-BAD-UNRECORDED-TOKEN-DELETED).
- **73d APPLIED: the Hosting transfer of a publish is shown, and `server.tgz` is an allowlist** (security-cost findings 4 and 5). Publish the map's cost line says each publish moves about 52 MB of Hosting's free 360 MB a day (`SITE_PUBLISH_TRANSFER_MB`, UNVERIFIED like the build minutes; `M6-interfaces.md` §1.9's table counts it). The server's tarball carries only `index.js`, `package.json`, `package-lock.json`, `.env.<project>` and `export-kit/**` of `functions/dist`; anything else (a `.secret.local`, a `.env.local`) fails `build:install` (`scripts/site/test/install-bundle.test.ts`).
- **73e APPLIED: the live map's upgrade path** (min-input findings 1–5). The server card decides its button from the install's state, not from step (d)'s chip: Try again after a stopped update in an admin session; a server with functions present but incomplete (the live map's 61 of 69, no release) is `updateAvailable`, so Update the map and Home's tile appear after one look. A look on step (d) in an admin session leaves the claim (d2) done. Retry what failed runs every item when one was never reported (a record from before M6), so it makes `hcm-installer@` and its roles. The pipeline card has its own **Install the pipeline** once the server is there, and Update the map includes a pipeline not installed with nothing in its way. `setupDone` and the admin's `ready` count a target as installed while a release of it is recorded, whatever its build does; a passing `unavailable` is never recorded. Rows S-A55-HAPPY-PRE-M6-UPGRADE, S-A55-BAD-UPDATE-FAILED-ADMIN, S-A55-HAPPY-DONE-WHILE-UPDATING, S-A04-BAD-PRE-M6-RECORD, S-A56-HAPPY-INSTALL-ALONE; the tour's `setup.install-update` checks the claim, and `setup.pipeline-install` is a new state.
- **73f APPLIED: "This account is a free trial"** (min-input finding 6, finding 18 of 2026-10-25 for the live map). One click on the linked billing card, no consent: `setup.recordCloud` records the trial from today (in start-up mode the bootstrap record carries it to the claim), and a trial said after "It is a paid account" starts again from that day. It is an optional input outside the happy path's budget (S-A60-HAPPY-SAID-TRIAL; tour state `setup.billing-mark-trial`).
- **73g APPLIED: the copy and the cards' clutter** (min-input findings 7–10). The Mapbox console's link reads **Open the Mapbox console** with the payment advice in its hint; Do it later is not offered while a USGS token waits for approval (S-A59-BAD-NO-LATER-WHILE-PENDING); step (d) shows no function count before its first look nor beside a Done chip; "The button is off:" reads **Not available yet:** / **Încă indisponibil:**; the unused `adminSetup.install.site.needsServer` is gone; each install card has one cost line (the frame leaves an available install step's cost to its body); the not-available pipeline says the map works without it meanwhile; the not-provisioned blocker names Check again, then Retry what failed.
- **73h APPLIED (documentation): the consents the whole assistant asks** (min-input finding 11). The tab keeps one Google token, so Analytics' consent replaces Google Cloud's and Publish the map asks Google once more: `docs/MANUAL_TEST_PLAN.md` and `docs/research/M6-status.md` now say at most 11 inputs and 5 consents. Keeping one token per scope would save that consent; it is 73j.
- **73i APPLIED (documentation): the imagery pipeline is not installable from the app in this release** (min-input finding 3). The install bundle names no Docker builder digest (§67e, the user's decision), so requirement 2 holds for the server and the public map and waits on §67e for the pipeline; the plan and the status say so, with D5 as the pipeline's way in meanwhile.
- **73j PROPOSED, NOT APPLIED (a product decision): one Google token per scope in the tab**, so the analytics consent no longer costs Publish the map a consent within the hour. It changes `packages/admin/src/auth/google-access.ts`'s single-token rule (memory only either way) and the journey's counts; for the user.
- **73l PROPOSED, NOT APPLIED (a `.gitleaks.toml` edit; the fixer's session could not make it): the emulators' logs out of `gitleaks dir`'s scope.** The fixer's second split `all` failed `static/gitleaks` on 3,200 findings in `firebase-debug.log`, the gitignored log the Firebase CLI writes at the root when an e2e run's emulators are stopped by Playwright rather than exiting by themselves; it holds the Auth emulator's generated test tokens, and the next run's `static` scans it. The fixer deleted the stray logs (`firebase-debug.log`, `firestore-debug.log`, `pubsub-debug.log`, all gitignored) before the third run. The proposed diff adds, to the scope allowlist of gitignored pipeline output that already lists `reports/` and `dist/`: `'''^(firebase|firestore|database|pubsub|storage|ui)-debug(\.[^/]*)?\.log$'''` (the names `.gitignore` ignores); `gitleaks-history` keeps no path allowlist. Ask first (it changes a gate's scope). Lesson 287.
- **73m APPLIED 2026-10-31 (§74e: `pyasn1` 0.6.5 in `pipeline/poetry.lock`, `"glob": "14.0.3"` in the root `overrides` and `functions/deploy-lock` refreshed; the user approved the dependency update): `pyasn1` 0.6.5 for the pipeline.** Published during the fixer's third run: CVE-2026-119194 to CVE-2026-119197 in `pyasn1` 0.6.4 (a transitive dependency of the raster pipeline, `pipeline/poetry.lock`), fixed in 0.6.5; `static/pipeline-pip-audit` fails on it. The fix is `poetry update pyasn1` in the image (a download), then the quality image rebuilt and `PIPELINE_STAGE=static` green; never an allowlist. Like §72c, for the orchestrator's approved dependency update. A later `static` run (2026-10-31) also found GHSA-3g3m-2fjr-6pw4 (`glob` 3.0.0–14.0.1, through `rimraf` and `gaxios`), which fails `npm-audit` beside §72c and now `deploy-lock-audit` (`functions/deploy-lock`): the same kind of fix, `overrides` and a lock refresh, a download.
- **73k Recorded: the legacy originals in every Hosting release.** `hosting.tgz` is mostly `/admin/legacy/` (45 MB of the old photos' originals, which step (h) imports). Keeping them out of the published site once the import is done would shrink each publish's transfer to a few MB; it changes what a later import can read, so it waits for the user.

Verify: `bash scripts/ci/e2e-split.sh` (stage `all`), quoted in `docs/research/M6-status.md` §1.

## 74. Dependency update 2026-10-31 — 74a–74e APPLIED 2026-10-31 (the user asked to update every dependency to its latest stable release, approved the downloads, the workflow pin edits and the `re2js` fix); 74f PROPOSED, NOT APPLIED (a new advisory without a compatible fix: the user decides)

Every pin the `deps` stage reported behind, bumped in the pinned images (`docs/SETUP.md` → *npm in a container*; Python in the quality image), each exact.

- **74a APPLIED: npm.** `@axe-core/playwright` 4.13.0 → 4.14.0, `@playwright/test` and `playwright` 1.64.0 → 1.64.1 (the image installs the matching browsers), `@vitest/eslint-plugin` 1.6.27 → 1.6.28, `dependency-cruiser` 18.6.0 → 18.7.0, `eslint` 10.12.0 → 10.14.0, `firebase` 13.0.0 → 13.1.0 (admin, engine, rules-tests), `firebase-tools` 15.33.0 → 15.34.2 (also `FIREBASE_TOOLS_VERSION` in `@hcm/shared` and `create-historic-city`, so the install bundle's `tools/` lock and the self-host check follow, the tests, fixtures and every current command in the docs and skills; research records keep the version they observed), `google-auth-library` 11.2.0 → 11.3.2, `harfbuzzjs` 1.6.3 → 1.6.4, `html-validate` 11.16.2 → 11.17.0, `knip` 6.41.0 → 6.44.0 (and `knip.json`'s `$schema` URL, the "keeps a tool working" kind), `material-symbols` 0.48.0 → 0.48.2 (the icon subset rebuilt with `fonts:build`), `terra-draw` 1.38.0 → 1.39.0, `typescript-eslint` 8.71.1 → 8.72.1, `vite` 8.3.4 → 8.3.5, `zod` 4.6.6 → 4.6.7. The overrides moved with their packages: `@firebase/firestore@4.19.0` (the firestore of `firebase` 13.1.0, still `@grpc/grpc-js ~1.9.0`) → `@grpc/grpc-js` 1.14.7, `basic-ftp` 6.2.4, `katex` 0.19.1; `@opentelemetry/core` stays 2.12.0 (3.0.0 is a major its dependants do not accept). Two stale hoisted peers were deduped with `npm update` (`playwright-core`, `@firebase/app`; lesson 288).
- **74b APPLIED: Mapbox GL JS 3.32.0 → 3.34.1.** The e2e devDependency, `MAPBOX_GL_VERSION` (engine, ui, site build), the starter kit's `integrity` values (`sha384-bRGpP2/…` for the script, `sha384-QWCpuitI…` for the stylesheet: computed from the files api.mapbox.com serves for v3.34.1, downloaded for that alone, and equal to the npm release's), the tests' URLs and every current doc, skill and comment. 3.33.0's breaking changes (the RTL text plugin API removed, icon sizes in `text-field` measured at the tile zoom) touch nothing the engine calls; the attribution rules `attribution-colour.test.ts` copies are unchanged in 3.34.1's `mapbox-gl.css`. The e2e tier (the orchestrator's split run) is the check of the real library.
- **74c APPLIED: Python.** `scripts/ci/requirements.txt` (regenerated in a fresh venv of the image): ruff 0.17.3, mypy 2.4.1, pytest 9.2.0, coverage 7.17.0, check-jsonschema 0.39.0, and transitively ast_serialize 0.13.1, certifi 2026.10.23, filelock 4.2.5, msgpack 1.2.4, platformdirs 4.14.0, pluggy 1.7.0. `pipeline/requirements-poetry.txt` (Poetry 2.5.1 in a fresh venv): certifi, distlib 0.4.4, dulwich 1.2.20, filelock 4.2.5, installer 1.1.0, more-itertools 11.2.1, msgpack 1.2.4, pbs-installer 2026.10.25 (which now takes `httpx2` and `httpcore2` 2.16.0, Pydantic's maintained fork, and `truststore` 0.10.5, replacing `httpx` 0.28.1 and `httpcore` 1.0.9 in that set), pkginfo 1.13.3, platformdirs 4.14.0, pycparser 3.12, python-discovery 1.9.0, tomlkit 0.15.2, virtualenv 21.15.2. `pipeline/pyproject.toml`: google-cloud-storage 3.17.1; dev pytest 9.2.0, coverage 7.17.0, hypothesis 6.170.14; `poetry lock --regenerate` in the image, which also took `pyasn1` 0.6.5 (§73m) and google-api-core 2.43.2, google-auth 2.62.0, grpcio and grpcio-status 1.85.1, googleapis-common-protos 1.76.0, opentelemetry-api 1.45.2. New holds: `findpython` 0.8.0 and `pkginfo` 1.13.3 (Poetry 2.5.1, the latest, requires `findpython <0.9.0` and `pkginfo <2.0`), in `HELD` and `docs/CI_PIPELINE.md`.
- **74d APPLIED: images and actions.** `docker/dockerfile` 1.27.1 → 1.28.0 (`@sha256:bb22d981…`, both Dockerfiles), `sonarsource/sonar-scanner-cli` 12.2.0.4256_8.1.0 → 12.3.0.4285_8.1.0 (`@sha256:47956b66…`, Dockerfile.quality and `scripts/ci/sonar_scan.sh`; still SonarScanner CLI 8.1.0.6389), digests read from Docker Hub's index manifests. Actions by the tag's commit (`gh api`, annotated tags dereferenced): `SonarSource/sonarqube-scan-action` v8.4.0 `4d1dc0c9…`, `docker/login-action` v4.7.0 `81c6f93d…`, `github/codeql-action` v4.39.1 `9b325408…`, each with its `# vX.Y.Z` comment.
- **74e APPLIED: the advisories.** `"re2js": "2.9.1"` (GHSA-gg6h-894w-4m9c, fixed in 2.8.7; §70l, §71i, §72c) and `"glob": "14.0.3"` (GHSA-3g3m-2fjr-6pw4, fixed in 14.0.2; §73m) in the root `overrides`. Every `glob` dependant calls `glob`, `sync` or `globSync`, which 14 keeps; `firebase-tools`' `listFiles`, `archiver`'s glob and `exegesis` were run against it offline before the gates. `functions/deploy-lock` refreshed with `node functions/deploy-lock.mjs` (0 vulnerabilities). `pyasn1` 0.6.5 (§73m) in 74c. `deploy-lock-audit`, `pip-audit` and `pipeline-pip-audit` pass.
- **74f PROPOSED, NOT APPLIED (the user decides): GHSA-g3hv-75wg-m249, `minimatch` below 11.0.1** (published 2026-10-30 23:09 UTC, moderate; after this task's list was made). The vulnerable `firstPhasePreProcess` is only in the 10.2.6 copy (`@eslint/config-array`, `@typescript-eslint/typescript-estree`, `eslint-plugin-sonarjs`: dev tooling); `firebase-tools`' 3.1.5, `readdir-glob`'s 5.1.9 and `superstatic`'s 6.2.3 do not contain it but are in the range. 11 is a rewrite (no `makeRe`, no `regexp`, a new parser) and its CommonJS entry is not callable, while `firebase-tools` (`fsAsync`) and `superstatic` call `minimatch(...)`: an `overrides` to 11 would break `firebase deploy` and the emulators. Options: wait for upstream releases on the old lines or for the dependants to move to 11; or a vendored compatibility copy (`vendor/npm/minimatch`, as `vendor/npm/braces`) that exports 11 as a callable CommonJS function, which needs the user's review. Never an allowlist. Until then `static/npm-audit` is the only failing gate of `static` (and so of `quality` and `all`).

Breakages fixed (lessons 288–290): an order-dependent `functions/test/index.test.ts` (since M6 three other files load `src/index.ts` with another bucket; now all agree); the duplicate `playwright-core` and `@firebase/app`; typescript-eslint 8.72's `no-deprecated` on `MountEnvironment.document` (now a two-method port, `packages/engine/src/mount.ts`) and on `dns.lookup`'s `verbatim` (`order: 'verbatim'`, `functions/src/adapters/remote-files.ts`); `scripts/site/test/notices.test.ts` expects the installed `material-symbols` 0.48.2. Holds kept: `typescript` 6.0.3 (`typescript-eslint` 8.72.1 still peers `<6.1.0`), `@types/node` 24.x, `mando` 0.7.1, `node:24-bookworm-slim`.

Verify: `PIPELINE_STAGE=deps` (holds only), `static` (all but 74f), `tests`, `build`; the split `all` is the orchestrator's.
