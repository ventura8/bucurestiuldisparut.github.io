---
description: Deploy the public site (GitHub Pages), the admin, rules and functions (Firebase via Workload Identity Federation), the pipeline image and engine releases -- every step ask-first and only after a green local all
---

# Deploy Workflow

Nothing in this workflow runs without the user's explicit yes **for that action**. Every deploy follows a green local `bash scripts/ci/run-all-checks.sh` (`[SUCCESS] stage 'all' passed`) and a green CI on `master`. Status today: the deploy jobs exist in `.github/workflows/ci.yml` (`deploy-pages`, `deploy-firebase`, `deploy-pipeline-image`) but stay off until the repository variable `DEPLOY_ENABLED` is `true` (set in M2, ask first), and the old site on `master` stays live until the user approves the overwrite. `release.yml` publishes tags.

## Targets

| Target | What | How | Trigger |
| --- | --- | --- | --- |
| Public site | `dist/site/bucharest` (the `site-build` gate: `sites/bucharest/` plus the engine `dist` copied same-origin; the URL-restricted token from the repository variable `MAPBOX_PUBLIC_TOKEN`) | `actions/deploy-pages` in `ci.yml` (the `build` job uploads `dist/site/bucharest` as the Pages artifact) | push to `master` after every job is green |
| Admin | `packages/admin/dist` on Firebase Hosting (`<proj>.web.app`, own origin, CSP headers in `firebase.json`) | `firebase deploy --only hosting` in the `deploy-firebase` job of `ci.yml` through WIF | green CI on `master` |
| Rules and indexes | Firestore and Storage rules, Firestore indexes | `firebase deploy --only firestore,storage` through WIF | green CI on `master` |
| Functions | `functions/dist/` (the same artifact the e2e emulator ran, with the locked tree of `functions/deploy-lock/` and `.env.<project>` from `functions/deploy-env.json`) | `firebase deploy --only functions` through WIF (the job installs before it authenticates) | green CI on `master` |
| Raster pipeline | the `pipeline/Dockerfile` `runtime` image | the `deploy-pipeline-image` job pushes it to Artifact Registry; `gcloud run jobs update` joins with M3 | green CI on `master` |
| Engine release | GitHub Release for `vX.Y.Z`, jsDelivr `@1` | `release.yml` on the tag | a tag, after `all` (`.agent/skills/quality/prepare_release_skill.md`) |

After a deploy: `setup.selfTest` all green (IAM, secrets, Cloud Run, MTS); the live site loads with exactly one map load, photos render, the layer toggles work; the admin sign-in creates the owner claim.

## Identity and secrets

- CI authenticates to Google Cloud **keylessly** through Workload Identity Federation as `gh-deployer@`, restricted to `ventura8/bucurestiuldisparut.github.io` on `refs/heads/master`. No service-account key exists anywhere.
- `SONAR_TOKEN` is the only repository secret. Mapbox and USGS secrets live only in Secret Manager, written by the Setup Assistant.
- The Firebase web config is not committed: the admin reads `/__/firebase/init.json` on Hosting.

## Manual (first time only, each with an explicit yes)

- The first admin deploy before CI has WIF: `firebase deploy --only hosting --project bucurestiul-disparut` from the user's machine after the user ran `firebase login` themselves.
- Bootstrap of the owner admin claim (no email in the repository): a local script run with the user's own gcloud credentials.
- Org-policy fixes, IAM changes and API enablement are settings changes: ask first, one at a time.

## Never

- Deploy, push or tag without the user's yes; push before `all` is green; deploy from a dirty tree.
- Use `pull_request_target`, an unpinned action or a `:latest` image in a workflow.
- Run the raster pipeline in GitHub Actions (public logs would leak signed USGS URLs); it runs as a Cloud Run Job.
