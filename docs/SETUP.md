# Developer Setup

Everything that checks, tests or builds this repository runs in Docker. The host needs only Docker, git and a shell; its own Node and Python are never used for a gate.

## Prerequisites

- Linux (the only supported developer platform).
- Docker Engine with BuildKit (Docker 23 or later); your user in the `docker` group.
- git; optionally the GitHub CLI `gh` for pull requests.
- About 6 GB of disk for the quality image.

## First run

```bash
git clone https://github.com/ventura8/bucurestiuldisparut.github.io.git
cd bucurestiuldisparut.github.io
git switch feat/engine-rewrite
PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh
```

The first run builds `docker/Dockerfile.quality` as `hcm-quality:local` (about 5 minutes cold, seconds afterwards), installs `node_modules` inside the container from the image's npm cache, then runs the static gates. Read the verdict: `[SUCCESS] stage 'static' passed`. Stages and when to run which: [CI_PIPELINE.md](CI_PIPELINE.md).

The image contains Node 24, npm 11, JDK 21, Python 3.14 with the CI tools, GDAL, the Playwright browsers, the Firebase emulator JARs and the linter binaries. The repository is mounted at the same absolute path, with `HOME=/tmp/hcm-home` inside the container and no host-home mount (a rule adopted after a home-directory wipe on 2026-10-10).

## npm in a container

The host's Node 22 and npm 9 are too old (`engines` requires Node 24.12 or later, `engine-strict` is on). Add or update a dependency with the digest-pinned Node image, after checking the version:

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/h -e npm_config_cache=/tmp/h/.npm \
  -v "$PWD:$PWD" -w "$PWD" \
  node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 \
  npm view <pkg> version

docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/h -e npm_config_cache=/tmp/h/.npm \
  -v "$PWD:$PWD" -w "$PWD" \
  node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 \
  npm install --save-exact <pkg>@<version> --workspace @hcm/<name>
```

- Versions are exact (`.npmrc` `save-exact=true`); the latest stable release, unless a hold is recorded in [CI_PIPELINE.md](CI_PIPELINE.md) → *Held dependencies*.
- A new workspace also needs its `COPY <dir>/package.json <dir>/` line in the `manifests` stage of `docker/Dockerfile.quality` (which drops the manifests' scripts, so an npm script edit does not rebuild the image's npm layer).
- Run `npm audit --audit-level=low` afterwards (the `static` stage does); fix advisories with `overrides`, never an allowlist.

## One tool inside the image

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx vitest run --project ui'
```

Use the same pattern for `npx eslint`, `npx prettier --write`, `npx markdownlint-cli2`, `ruff`, `mypy` or `python3 -m pytest`. More in [.agent/workflows/test.md](../.agent/workflows/test.md).

## Git hooks

```bash
git config core.hooksPath scripts/git-hooks
```

- `scripts/git-hooks/pre-commit`: refuses staged secrets (`.env*` except `.env.example`, `.sonar-token`, `.secret.local`, service-account JSON, `*.p12`), runs the inline-suppression scan on the staged index and gitleaks on the staged changes. Hooks are local and optional, so the same file list is also the `repo-policy` static gate, and CI scans every pushed commit with `gitleaks-history`.
- `scripts/git-hooks/commit-msg`: refuses a message that is not Conventional Commits, `type(scope): summary` (types `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `perf`, `chore`, `revert`; a lower-case scope is required, `chore(wip): ...` for work in progress; `!` before the colon for a breaking change; subject at most 100 characters; a blank line before the body). It runs `scripts/ci/check_commits.py --message-file -` in the quality image with the message on stdin. Comment lines and the scissors section are ignored, and git's own `Merge ...` and `fixup!`/`squash!`/`amend!` subjects pass (squash the latter before a pull request: the `commits` gate refuses them in CI).
- `scripts/git-hooks/pre-push`: refuses a push to `master` or a `v*` tag unless `reports/pipeline/green-all.json` names the pushed commit and a clean tree.

Work branches are pushed without a marker (backups after each commit); the hooks run their tools inside the quality image. No husky, lefthook or pre-commit framework. Hooks are local and optional, so CI repeats each check over the pushed commits: `repo-policy` (secret files), `gitleaks-history` and `commits`.

## Local environment file

Local, non-committed settings go into `.env.local` (git-ignored). The template `.env.example` (planned, added with the first setting the build reads) holds placeholders only. Nothing secret is needed for development: tests use the `demo-hcm` emulator project and generated test credentials, and `api.mapbox.com` is served from fixtures. The Mapbox public token for production builds comes from CI configuration; the Firebase web config is never committed (the admin reads `/__/firebase/init.json` on Hosting).

## Firebase emulators

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx firebase emulators:exec --project demo-hcm --only firestore,storage "npx vitest run --project rules"'
```

The emulator JARs are in the image (`FIREBASE_EMULATORS_PATH`); `demo-hcm` needs no login. **Always pass `--project demo-hcm`**: `.firebaserc`'s `default` is the real Firebase project `bucurestiul-disparut` (the deploy target), so a command without it would start the emulators for that project. Emulator logs (`firebase-debug.log`, `firestore-debug.log`, `pubsub-debug.log`) are git-ignored. Details: [TESTING.md](TESTING.md) → *Emulators*.

The Cloud Functions deploy artifact and the Functions emulator on it:

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npm run build --workspace @hcm/functions'   # functions/dist (checked, then loaded)
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx firebase emulators:exec --project demo-hcm \
  --only functions,firestore,auth,storage,pubsub,tasks "echo up"'      # loads all 35 functions
```

In the emulator the functions keep secrets in memory and reach Google, Mapbox and USGS only through the fake upstreams at `HCM_UPSTREAM_BASE` (unset: every such call fails like a network error), so a local run can never touch a real service.

## Local stack for manual testing

One command starts the whole product on this machine, seeded with a Bucharest city, without touching the cloud: the admin (its `e2e` build), the viewer (the e2e Bucharest site), the Firebase emulators of project `demo-hcm` (auth, firestore, storage, functions from `functions/dist`, pubsub, tasks) and the mock APIs of the e2e world (fake Google Cloud, Mapbox, USGS, STAC, Nominatim, Google's consent stand-in, the raster pipeline's stand-in runner). It runs inside the quality image like every gate (no host-home mount); the walk-through that uses it is [MANUAL_TEST_PLAN.md](MANUAL_TEST_PLAN.md).

```bash
npm run dev:stack                        # or: bash scripts/dev/dev-stack.sh; Ctrl+C stops it (the emulators shut down cleanly)
HCM_STACK_SEED=fresh npm run dev:stack   # a new map instead: start-up mode, Setup from the first sign-in
HCM_STACK_TICKS=0 npm run dev:stack      # without the scheduler clock (imagery.tick every 5 min, ops.tick every 15)
bash scripts/dev/dev-stack.sh tick       # run imagery.tick and ops.tick once, now (from another terminal)
bash scripts/dev/dev-stack.sh check      # the stack's own check (below)
bash scripts/dev/dev-stack.sh stop       # stop it from another terminal
```

The first start builds the e2e sites and the admin's e2e bundle (a few minutes; later starts skip the build when no input changed, `scripts/ci/e2e_build.py`), starts the emulators (a minute or two), seeds the world and prints the addresses. Always open them with `127.0.0.1`, never `localhost` (the functions' CORS and the consent stand-in name exactly these origins):

| What | Address |
| --- | --- |
| Admin | `http://127.0.0.1:4312` |
| Viewer | `http://127.0.0.1:4310/bucharest/` (`/` redirects there) |
| Mock APIs (control: `/__upstream/scenarios`, `/__calls`) | `http://127.0.0.1:4311` |
| Emulators (`firebase.json`) | auth 9099, firestore 8080, storage 9199, functions 5001, pubsub 8085, tasks 9499, hub 4400 |

- **Sign in**: Sign in with Google (Conectează-te cu Google) opens Google's consent stand-in in a frame over the page; `owner@e2e.test` is preselected, Allow. The other generated test accounts: `admin@e2e.test` (an admin who joined), `editor@e2e.test` (a pending invitation: the join panel), `stranger@e2e.test` (not an admin: the blocked panel). No password exists anywhere; the stand-in is the only "Google".
- **The seeded city** (`HCM_STACK_SEED=city`, the default; `e2e/stack/seed.ts`): Setup's required steps green (`setup/status`, and the fake upstreams in the same state: provisioned, deployed, M2M downloads approved, Analytics linked, two crash groups), the budget guard green; 13 photos (twelve legacy Bucharest photos with their real derivatives, two of them unpublished, and one upload whose processing failed), four place categories and seven places (points, a street, two areas, one draft), two linked layers (`plan-1911` on the e2e tile host, `corona-1968` on the e2e Mapbox account), an edited place (History has an update to revert), the USGS harvest of the fake catalogue, and four imports: a draft over the RMSE threshold waiting for Approve, one waiting for georeferencing points, one failed at warp (Retry), and the 1980 frame, published by the fake MTS about two minutes after the start. The viewer shows the manifest the emulators published (the e2e fixture manifest before the first build).
- **Nothing leaves the machine**: the admin and site servers put a shim first into every page (`e2e/stack/browser.ts`) that points every address of a host off this machine at the same origin's `/__stack/h/<host>/<path>`, where the server forwards it to the mock APIs, reads it from the Storage emulator or refuses it (403, logged) with the e2e firewall's own host table (`e2e/mock-apis/hosts.ts`). The map's basemap is the mock style (a plain background and tile labels), the historical layers are solid colours: the real Mapbox, Google and USGS answers are LIVE only.
- **Logs**: `reports/dev-stack/emulators.log` (every function's log) and `reports/dev-stack/mock-apis.log`.
- **The Claude browser pane** opens the stack through `.claude/launch.json`: `dev-stack` starts it (or follows one already running), `dev-stack-admin` and `dev-stack-viewer` open a running one. The pane cannot register a service worker (hence the shim, not a worker), opens a popup in place of its page (hence the consent frame) and, on this machine (2026-10-24), has no WebGL: its maps show their no-WebGL state, so the map items of the test plan run in Chrome (Claude in Chrome, or your own) at the same addresses.
- **The stack's check**, `bash scripts/dev/dev-stack.sh check` (`e2e/stack/check.ts`, headless Chromium like the pane, every request off the machine aborted and reported): the owner signs in with the stand-in and lands on the dashboard, Photos lists the seeded photos, Historical imagery lists the harvested scenes, a layer's editor draws its tiles through the mock Mapbox, the viewer shows the emulators' manifest, and no request reached the network for a host off this machine. It ends with `[SUCCESS] the local stack works`.
- **Limits**: the data start again at every start (the emulators keep nothing); the stack and a Playwright run of the pipeline coexist (the pipeline's container has its own network), but two stacks do not (the start refuses busy ports); the admin's start-up deploy differs from `fresh` only in that the stack's server exists from the start, so step (d) turns green once the fake lists the functions: `curl -X POST 'http://127.0.0.1:4311/__upstream/scenario?test=' -H 'content-type: application/json' -d '{"name":"google.deployed"}'`.

## SonarQube Cloud token (the user, once)

1. Sign in to SonarCloud (organisation `ventura8`) and create a token; make sure Automatic Analysis is off for the project.
2. Run `python3 scripts/ci/sonar_setup.py` (planned): a hidden prompt writes the git-ignored `.sonar-token` with mode 0600.
3. Run `gh secret set SONAR_TOKEN` and paste the token on stdin, for the CI job.

Agents never read, print or paste the token. The `sonar` stage (part of `all`) reads `SONAR_TOKEN` from the environment (`scripts/ci/run-all-checks.sh` forwards it by name) or `.sonar-token`; without either it prints `[sonar] [SKIP] ...` and passes, so `all` is green on a machine without a token. With a token it first checks that the `tests` stage's reports exist (run `all`, or `tests` before `sonar`), then scans with the SonarScanner in the quality image and applies the strict verdict. The CI `sonarqube` job skips with a notice when `SONAR_TOKEN` is missing.

## Cloud credentials (the user, once)

- `firebase login` (`npx -y firebase-tools@15.33.0 login`) and `gcloud auth login` are run by the user in their own terminal. Agents never run `login:ci`, create keys or type credentials.
- Deploys go through CI with Workload Identity Federation; a manual deploy is an explicit, one-time decision ([.agent/workflows/deploy.md](../.agent/workflows/deploy.md)).

## Housekeeping

- A browser crash in a container writes `core.<pid>` into the repository root; it is git-ignored, delete it.
- `reports/` holds every pipeline output and is git-ignored.
- `node_modules/.hcm-install-stamp` records the lockfile hash of the last in-container install; delete it to force `npm ci`.
