# Agent Instructions

This file is the canonical pre-task entry point for the `.agent` assets of the **Historic City Map** repository (București dispărut). `AGENTS.md` at the root holds the commands, boundaries and global rules; this file is the reading order and the execution rules; `docs/LESSONS.md` holds the defects behind them.

## Mandatory Pre-Task Review

Before beginning any implementation task:

1. Read `AGENTS.md`.
2. Read `.agent/instructions.md` (this file).
3. Read `.agent/skills/SKILLS_CATALOG.md`.
4. Read every directly relevant skill and workflow file (for example `.agent/skills/quality/pipeline_skill.md`, `.agent/skills/quality/e2e_scenario_matrix_skill.md`, `.agent/skills/web/engine_viewer_skill.md`).
5. For milestone work, read the milestone's section of `docs/research/PLAN.md` and the TODO list in `docs/research/M0-handoff.md`.
6. Do not write or modify code until this review is complete.

---

## Fix Order and Gates

Work through failures in this order, and never lower a gate to get past one:

1. **Format**: Prettier (TS, JS, JSON, YAML, CSS), `ruff format`, `shfmt`, `taplo fmt`.
2. **Lint**: the suppression scan, `tsc -b`, ESLint, stylelint, HTML linters, markdownlint, knip, dependency-cruiser, yamllint, ruff, mypy, shellcheck, hadolint, actionlint, gitleaks, the audits.
3. **Tests**: Vitest (node projects and the Chromium browser project) and pytest.
4. **Coverage**: 90 % or more per file, lines and branches; add behaviour tests, never exclusions.
5. **E2E**: the Playwright tiers under the Firebase emulators and mock APIs (from M1).

The stages, their gates and the meaning of `quality` and `all` are defined once, in `quality/pipeline_skill.md` → *Stages*. Every gate and how to fix it: `quality/ci_quality_gates_skill.md`.

---

## Mandatory Markdown Update (Every Task, No Exceptions)

- Every change updates the documentation that describes it, in the same task: application code, UI, functions, rules, the pipeline, CI, dependency bumps, lint configuration and tooling alike.
- Sync every impacted file among `README.md`, `docs/*.md`, `.agent/**`, `.agents/skills/**` and `.claude/skills/**`.
- `docs/research/` is the verbatim record of the research and the approved plan: append dated addenda, never rewrite it, and keep it markdownlint-clean (blank lines around headings and lists).
- Treat documentation as a deliverable, not a chore. A task is not closed until its docs are.

---

## Cost, Push and Secrets Discipline (Hard Rules)

- **Never push before the local pipeline is green**: `bash scripts/ci/run-all-checks.sh` (default `all`) ends in `[SUCCESS] stage 'all' passed` before any push to `master` or a tag. Pushing is ask-first in every case. Until the e2e and sonar stages have gates (M1), `all` fails by design; say so instead of pushing.
- **Cloud cost**: Mapbox map loads and MTS compute units are billed beyond the free tier, so tests never hit Mapbox, the viewer creates one map per view, and MTS publishes only after approval within the compute-unit guard. The GCP budget ($5) alarm pauses the raster pipeline and MTS, never the public site.
- **Human-only steps**: account creation, billing and card entry, terms acceptance, passwords, Google sign-in consents and token pastes are done by the user. Claude opens the exact page, explains the step and verifies the result; it never types the credential. Every accept, submit, publish, purchase or settings change in a browser is confirmed by the user in chat first, one at a time.
- **Secrets never leave their place**: Mapbox and USGS secrets live only in Secret Manager (written by the `setup.*` callables); `SONAR_TOKEN` is the only repository secret; GCP access from CI is keyless (Workload Identity Federation). Local secrets (`.env.local`, `.sonar-token`, `.secret.local`) are git-ignored and never opened, printed or pasted.
- **Never use** a `fostulbucuresti` resource, or Mapbox Satellite as a georeferencing reference.

---

## Global Execution Rules

- **Run the pipeline, not a subset**: `scripts/ci/run-all-checks.sh` is what CI runs. Ad-hoc tool runs are for iterating only and happen inside `hcm-quality:local` (`.agent/workflows/test.md`).
- **Architecture constraints** (`docs/ARCHITECTURE.md`):
  - The public viewer reads only the static manifest and photo files from the public bucket; it never reads Firestore and loads no Firebase SDK for data.
  - Only the engine's Mapbox adapter touches `mapbox-gl`; the core talks to a `MapPort` interface and is tested against a fake map. `mapbox-gl` stays external (global `mapboxgl`, v3.32.0).
  - Cloud Functions are pure handlers with injected ports plus thin triggers; Cloud Run Admin and Secret Manager are called over REST so tests can mock them.
  - Every Firestore writer validates with the shared zod schemas from `@hcm/shared`; rules are default-deny.
- **Lit without decorators**: `static override readonly properties`, `declare` fields, defaults in the constructor, an idempotent `define…()` function, the `hcm-` element prefix (`web/ui_m3_adaptive_skill.md`).
- **No HTML from data**: Lit templates and `textContent` only (`web/web_security_skill.md`).
- **Quality and coverage**: every new file, function and branch has tests; per-file coverage of 90 % or more, lines and branches. A new failure branch is covered by a test that causes the failure from outside (a 404 manifest, a revoked token, a 503 from USGS), not by calling a private path.
- **Scenario matrix discipline**: every behaviour has a happy and a bad row in `e2e/scenarios.json`. Change the behaviour, change the row and the test; a row without its test says `planned`.
- **Zero inline suppressions**: relax a rule only in the tool's repository-wide configuration file, with the reason next to it.
- **Logging standard**: TypeScript logs only through `createLogger(scope, …)` from `@hcm/shared` (secret-looking keys are redacted); Python CI scripts through `scripts/ci/cilog.py`; the raster pipeline through its own logger with the same redaction. Never `console.*` or `print`.
- **i18n**: Romanian is the default and the key source of truth; English is typed against it, so a missing key is a compile error (`web/i18n_skill.md`).

---

## Agent Asset Maintenance (Every Task, No Exceptions)

Every task ends with the agent assets brought up to date, in the same task:

- Update the affected skills in `.agent/skills/` and workflows in `.agent/workflows/`.
- Update `.agent/skills/SKILLS_CATALOG.md` whenever a skill is added, renamed or its scope grows.
- Keep `.agents/skills/` and `.claude/skills/` byte-identical: edit the `.agents/skills/` copy, then `cp` it over the mirror.
- Write down what was learned (a tool quirk, a decision and its reason, a bug a test caught, a rule the user gave) in the file that owns the subject: `governance/agent_asset_maintenance_skill.md` → *Where a lesson goes*. Chat and commit messages are not project memory.
- Every repository path written in back-ticks must exist or be listed under *Planned paths* in `docs/research/M0-handoff.md`; remove a planned entry in the task that creates the file.

---

## Working on the Developer Machine

- Linux; Docker is the only runtime for gates. The host has Node 22 and npm 9, which are too old (`engines` requires Node 24.12 or later) and are never used.
- `npm install` of a new dependency runs in `node:24-bookworm-slim` pinned by digest (`docs/SETUP.md` → *npm in a container*); pin the exact version after checking it with `npm view`. A new workspace also needs a `COPY` line in `docker/Dockerfile.quality`.
- The quality image clears `LD_PRELOAD` (the GDAL base preloads tcmalloc, which crashes Chromium). A crashed browser leaves `core.<pid>` in the repository root; it is git-ignored, delete it.

---

## Documentation Completion Rule

Do not close a task until all impacted documentation, the coverage badges (once `scripts/ci/check_coverage.py` writes them), the scenario registry and the agent assets are synchronized with the work just completed.
