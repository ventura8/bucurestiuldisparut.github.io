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
- A new workspace also needs its `COPY <dir>/package.json <dir>/` line in `docker/Dockerfile.quality`.
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
- `scripts/git-hooks/pre-push`: refuses a push to `master` or a `v*` tag unless `reports/pipeline/green-all.json` names the pushed commit and a clean tree.

Work branches are pushed without a marker (backups after each commit); the hooks run their tools inside the quality image. No husky, lefthook or pre-commit framework.

## Local environment file

Local, non-committed settings go into `.env.local` (git-ignored). The template `.env.example` (planned, added with the first setting the build reads) holds placeholders only. Nothing secret is needed for development: tests use the `demo-hcm` emulator project and generated test credentials, and `api.mapbox.com` is served from fixtures. The Mapbox public token for production builds comes from CI configuration; the Firebase web config is never committed (the admin reads `/__/firebase/init.json` on Hosting).

## Firebase emulators

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx firebase emulators:exec --project demo-hcm --only firestore,storage "npx vitest run --project rules"'
```

The emulator JARs are in the image (`FIREBASE_EMULATORS_PATH`); `demo-hcm` needs no login. Emulator logs (`firebase-debug.log`, `firestore-debug.log`) are git-ignored. Details: [TESTING.md](TESTING.md) → *Emulators*.

## SonarQube Cloud token (the user, once)

1. Sign in to SonarCloud (organisation `ventura8`) and create a token; make sure Automatic Analysis is off for the project.
2. Run `python3 scripts/ci/sonar_setup.py` (planned): a hidden prompt writes the git-ignored `.sonar-token` with mode 0600.
3. Run `gh secret set SONAR_TOKEN` and paste the token on stdin, for the CI job.

Agents never read, print or paste the token. Once the `sonar` stage has its gate (`docs/research/M0-handoff.md` → *TODO for the next agents*), a run without a token skips the scan instead of failing; until then the stage has no gate and fails on purpose, and so does `all`. The CI `sonarqube` job already skips with a notice when `SONAR_TOKEN` is missing.

## Cloud credentials (the user, once)

- `firebase login` (`npx -y firebase-tools@15.33.0 login`) and `gcloud auth login` are run by the user in their own terminal. Agents never run `login:ci`, create keys or type credentials.
- Deploys go through CI with Workload Identity Federation; a manual deploy is an explicit, one-time decision ([.agent/workflows/deploy.md](../.agent/workflows/deploy.md)).

## Housekeeping

- A browser crash in a container writes `core.<pid>` into the repository root; it is git-ignored, delete it.
- `reports/` holds every pipeline output and is git-ignored.
- `node_modules/.hcm-install-stamp` records the lockfile hash of the last in-container install; delete it to force `npm ci`.
