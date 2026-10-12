# Prepare Release Skill

How a release of **Historic City Map** is prepared. Releases are git tags `vX.Y.Z` on `master`; the engine is served to other cities from this repository's tags through jsDelivr (`@1` major range for third-party cities, an exact version with SRI when pinned). Bucharest serves the engine same-origin from GitHub Pages. Status today: the `release` stage and `.github/workflows/release.yml` exist; the Sonar check of the tagged commit and the jsDelivr purge come with M5.

## Procedure

1. **Version.** Pick `X.Y.Z` by semantic versioning of the engine's public surface (the `HistoricCityMap` global, the manifest schema, `config.js`). The tag must match `^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`. The root `package.json` and every workspace `package.json` carry the same version; `ENGINE_VERSION` in `@hcm/engine` follows it.
2. **Release notes**, two files (`docs/releases/README.md`):
   - `docs/releases/vX.Y.Z.md`: the full notes (features, fixes, security, breaking changes, migration, verification results).
   - `docs/releases/vX.Y.Z_github_description.md`: the GitHub Release body; its single H1 becomes the release title.
3. **Docs drift.** Review the full diff since the previous tag against `README.md`, `docs/*.md`, the admin guides (RO and EN) and the agent assets; update what drifted (`governance/doc_update_skill.md`).
4. **Pipeline.** `bash scripts/ci/run-all-checks.sh` (default `all`) must end in `[SUCCESS] stage 'all' passed`; then, once the tag exists locally, `PIPELINE_STAGE=release` (`scripts/ci/check_release.py`: tag format, version equality including `ENGINE_VERSION`, both notes files present and non-empty; then the bundles are built). Before tagging, `python3 scripts/ci/check_release.py --tag vX.Y.Z` in the image checks the same.
5. **Ask first**, one action at a time: the commit push, then `git tag vX.Y.Z` and its push. Never a tag before `all` is green locally (`scripts/git-hooks/pre-push` enforces it).

## What CI does on a tag (`release.yml`)

- Job `build` (`contents: read`) runs `PIPELINE_STAGE=release` in the quality image: the tag and the version equality, both notes files, then the engine and admin bundles; it uploads the bundles and `docs/releases/` as the `release` artifact.
- Job `publish`, the only one with `contents: write`, checks nothing out and runs no repository code: it downloads that artifact and creates the GitHub Release titled by the H1 of the description file (the tag when there is none), with the description file as body and `packages/engine/dist/*` and `packages/admin/dist/*` attached.
- Planned (M5): confirm the SonarQube quality gate of the default-branch analysis of the same commit, then purge the jsDelivr cache for the major range (best effort). `dist` is git-ignored, so there is no committed bundle to compare.

## Rules

- Release notes describe what shipped, verified against the code; no test counts (they live only in `docs/E2E_SCENARIOS.md`).
- A breaking change of the manifest or `config.js` is a major version and documents the migration for city owners.
- jsDelivr limits (150 MB per package, 20 MB per file) are why photos live in Storage, not in the tree at a tag; the `repo-budget` gate (`scripts/ci/check_repo_budget.py`) keeps the tree small.
