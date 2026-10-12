---
name: quality-pipeline
description: Run the Historic City Map quality pipeline (scripts/ci/run-all-checks.sh inside the pinned hcm-quality image - suppression scan, skill mirrors, agent assets, data files, EditorConfig, scenario registry, i18n parity, font subset, Prettier, tsc, ESLint, stylelint, HTML and Markdown linters, knip, dependency-cruiser, YAML, TOML, ruff, mypy, radon, bandit, shell, Docker, workflow-policy and action-pin checks, repo policy (secret files, exact pins, image digests) and budget, gitleaks over the tree and the CI commit range, Conventional Commits over the CI commit range, npm and pip audits, Vitest with Chromium and pytest plus the per-file 90 percent coverage gate, the site build tests, Playwright e2e, vite build and bundle budget, the SonarQube scan and verdict, the weekly latest-stable dependency check) exactly as CI runs it, pick the right stage, add a gate, and fix a failing gate without an inline suppression. Use before claiming any change is done, when a CI job fails, or when adding or bumping a tool.
---

# Quality Pipeline Skill

`scripts/ci/run-all-checks.sh` builds `docker/Dockerfile.quality` as `hcm-quality:local` and runs `scripts/ci/pipeline.py --stage "$PIPELINE_STAGE"` inside it, with the repository mounted at the same absolute path and no host-home mount. CI calls the same script per stage. The host's Node 22 and Python never run a gate.

Canonical stage table (and what `quality` and `all` contain): `.agent/skills/quality/pipeline_skill.md` → *Stages*. Every gate and its fix: `.agent/skills/quality/ci_quality_gates_skill.md`.

## Commands

```bash
PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh    # docs and tooling changes
PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh     # Vitest (node + Chromium) + pytest, 90 % per file
PIPELINE_STAGE=build bash scripts/ci/run-all-checks.sh     # vite build of engine and admin
PIPELINE_STAGE=quality bash scripts/ci/run-all-checks.sh   # what CI runs
bash scripts/ci/run-all-checks.sh                          # default all: before a push to master or a tag
PIPELINE_STAGE=release bash scripts/ci/run-all-checks.sh   # at a vX.Y.Z tag: versions, release notes, bundles
PIPELINE_STAGE=contract bash scripts/ci/run-all-checks.sh  # deep links and third-party API shapes (network)
PIPELINE_STAGE=sonar bash scripts/ci/run-all-checks.sh     # SonarQube scan and verdict (skips without SONAR_TOKEN or .sonar-token)
PIPELINE_STAGE=deps bash scripts/ci/run-all-checks.sh      # every pin on its latest stable release (network; HELD entries aside)
python3 scripts/ci/pipeline.py --list                      # the registry (safe on the host)
bash scripts/ci/build-and-test.sh                          # rebuild the image only
```

Read the verdict from a log, never through `tail`:

```bash
mkdir -p reports/pipeline
PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh > reports/pipeline/run.log 2>&1; echo "EXIT=$?"
grep -E '^\[(SUCCESS|FAILURE)\]|FAILED' reports/pipeline/run.log
```

One tool while iterating (inside the image):

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx vitest run --project ui'
```

## Which stage

- Docs or tooling only: `static`.
- TypeScript or Python: `static`, `tests`, `build`.
- A user-visible change, `e2e/`, `e2e/scenarios.json`, `sites/`, `starter-kit/` or `scripts/site/`: also `e2e` (`E2E_TIER=smoke,fn` for a quick run; unset runs every tier). The site build's unit tests are the `site-unit` gate of `tests`; the Pages sites are built by `site-build` in `build`.
- A Setup Assistant deep link (`packages/admin/src/setup/links.json`) or a third-party probe: `contract`.
- Before a push to `master` or a tag: `all` (the default: `quality`, then `sonar`, which skips with a notice without a token).
- A dependency bump: `static`, `tests`, `build`, then `deps` to see what else is behind; a deliberate hold is a `HELD` entry with its reason in `scripts/ci/check_dependency_updates.py`.

## Adding a gate

1. Pin the tool: exact npm devDependency, an exact line in `scripts/ci/requirements.txt`, or a digest-pinned binary in `docker/Dockerfile.quality`.
2. Add `Gate("<name>", (...))` to `GATES` in `scripts/ci/pipeline.py`; npm tools get a `package.json` script and run as `(*NPM_RUN, "<script>")`.
3. Add the name to its stage in `STAGES` (cheapest first, network-bound last).
4. Run the pytest suite in the image: the registry tests reject unknown, duplicated or unstaged gates.
5. Update `pipeline_skill.md`, `ci_quality_gates_skill.md`, `docs/CI_PIPELINE.md` and this skill (then `cp` it to `.claude/skills/quality-pipeline/SKILL.md`).

## Fixing a gate

Never suppress: no inline directive of any tool, no `.skip`/`.only`/`xfail`, no lowered threshold, no exclusion to pass. Split the function, type the value, render with Lit or `textContent`, log through `createLogger` or `scripts/ci/cilog.py`, drive the uncovered branch from outside. A genuine relaxation goes into the tool's single config with a why-comment, and editing a lint config is ask first. An advisory is fixed with `overrides` (or a vendored patch such as `vendor/npm/braces`), never an allowlist.

## Hard-won rules

- Never edit `scripts/ci/run-all-checks.sh` while it runs (bash reads it by offset). When another run may be in flight, replace it atomically: write a temporary file next to it and `mv` it over (the running bash keeps the old inode).
- The quality image sets `LD_PRELOAD=""`: the GDAL base preloads tcmalloc and Chromium aborts under it.
- A new workspace needs a `COPY <dir>/package.json <dir>/` line in the Dockerfile, or `npm ci` fails in the image build.
- `npm install` of a dependency runs in the digest-pinned `node:24-bookworm-slim` image, after `npm view` (`docs/SETUP.md` → *npm in a container*).
- A browser crash leaves `core.<pid>` in the repository root (git-ignored); delete it.
- Commit subjects are `type(scope): summary` (`scripts/git-hooks/commit-msg` locally, the `commits` gate over the CI range); squash `fixup!` commits before a pull request.
- The image has a real `sonar-scanner` on `PATH`: a test that hides its fake tool must also drop the image's directories from `PATH`.
