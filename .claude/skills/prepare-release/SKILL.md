---
name: prepare-release
description: Prepare a Historic City Map release vX.Y.Z - pick the semantic version of the engine surface, align every package.json version and ENGINE_VERSION, write the two release-note files in docs/releases, sync docs, run the full pipeline to a green all, then ask before pushing and tagging; CI builds the GitHub Release and the jsDelivr engine. Use whenever the user asks for a release, a tag, release notes or a version bump.
---

# Prepare Release Skill

Working notes: `.agent/skills/quality/prepare_release_skill.md`; file rules: `docs/releases/README.md`.

## Steps

1. Version `X.Y.Z` (tag `vX.Y.Z`, must match `^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`); a breaking change of the manifest, `config.js` or the `HistoricCityMap` global is a major version.
2. Set the same version in the root `package.json`, every workspace `package.json` and `ENGINE_VERSION` in `packages/engine/src/index.ts`.
3. Write `docs/releases/vX.Y.Z.md` (full notes) and `docs/releases/vX.Y.Z_github_description.md` (the GitHub Release body; its single H1 is the release title).
4. Review the whole diff since the previous tag against `README.md`, `docs/*.md`, both admin guides and the agent assets.
5. Run the pipeline and read the verdict:

   ```bash
   mkdir -p reports/pipeline
   bash scripts/ci/run-all-checks.sh > reports/pipeline/run.log 2>&1; echo "EXIT=$?"
   grep -E '^\[(SUCCESS|FAILURE)\]' reports/pipeline/run.log
   ```

   It must print `[SUCCESS] stage 'all' passed`.
6. Ask before each of: pushing the release commit, creating the tag, pushing the tag. CI (`.github/workflows/release.yml`) runs `PIPELINE_STAGE=release` (tag, versions, notes, bundles) and creates the GitHub Release titled by the description's H1, with the engine and admin bundles attached; the Sonar check of the same commit and the jsDelivr purge come with M5.

No test counts in release notes; they live only in the generated `docs/E2E_SCENARIOS.md`.
