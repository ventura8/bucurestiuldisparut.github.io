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

### 34b. The admin page loads the ES module build — PROPOSED (for the user: it changes what the bundle budget measures)

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

### 34g. Installing Terra Draw — PROPOSED (for the user: an npm install downloads files, which AGENTS.md puts under ask first)

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

### 34i. The dashboard as the admin's first screen — PROPOSED (for the user: what an admin sees first)

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

### 37e. Rows still planned: what the screens lack — for the user

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

### 39c. What would bring the split `quality` to about 8 minutes — for the user

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

## 40. M2 final gate (final-gate agent, 2026-10-18) — PROPOSED (for the user)

The state of M2 and the deploy steps are in `docs/research/M2-status.md`. Nothing was committed, pushed or deployed.

### 40a. The Firestore location — PROPOSED (for the user: permanent, a cloud setting)

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
