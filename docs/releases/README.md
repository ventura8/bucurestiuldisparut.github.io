# Release Notes

Every release tag `vX.Y.Z` has **two files** in this folder, written before the tag is pushed:

| File | Purpose |
| --- | --- |
| `vX.Y.Z.md` | The full release notes: highlights, features, fixes, security, breaking changes and migration steps for city owners, verification results. |
| `vX.Y.Z_github_description.md` | The body of the GitHub Release. Its single H1 becomes the release title (for example `# Release v1.2.0 - Swipe compare`). Between the lines `<!-- hcm:sri -->` and `<!-- /hcm:sri -->` it carries the pinned jsDelivr addresses with their integrity and the tags to paste, written by `npm run release:notes -- --write docs/releases/vX.Y.Z_github_description.md` from `cdn/engine/release.json`. |

## Rules

- The tag matches `^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`; the root and every workspace `package.json`, every dependency of a workspace on another workspace, the engine's `ENGINE_VERSION`, `cdn/engine/release.json` and the starter kit's pinned folder carry the same version (`npm run release:bump -- X.Y.Z` writes the versions).
- The release commit holds the built engine in `cdn/engine/` (every file of `packages/engine/dist` but the source maps) with `release.json`, the size and SHA-384 integrity of every file: jsDelivr serves the tag's folder at `https://cdn.jsdelivr.net/gh/ventura8/bucurestiuldisparut.github.io@vX.Y.Z/cdn/engine/`, and the starter kit (`templates/starter-kit/index.html`) pins it with Subresource Integrity (`npm run release:cdn`, then `npm run release:pin-kit`).
- Semantic versioning of the engine's public surface ([../ENGINE_API.md](../ENGINE_API.md) → *Versioning and compatibility*): the `HistoricCityMap` global and the module build's exports, `<hcm-map-viewer>` and its events, `config.js`, the URL hash and the City Manifest. A breaking change is a major version and documents the migration.
- Notes describe what shipped, checked against the code. No test counts: they live only in the generated scenario document.
- Both files pass markdownlint like every other document.
- The release workflow (`.github/workflows/release.yml`) refuses a tag whose versions, released engine, kit pins, notes files or description's pinned addresses disagree, or whose `cdn/engine/` is not byte for byte a fresh build of the tagged sources; it then creates the GitHub Release from the description file. The SonarQube gate of the same commit is a proposal waiting for the user ([../research/DECISIONS-for-review.md](../research/DECISIONS-for-review.md) §58c).

How to prepare a release: [.agent/skills/quality/prepare_release_skill.md](../../.agent/skills/quality/prepare_release_skill.md).

## Releases

- **v1.0.0** (prepared, not tagged): the first engine release, the v1 baseline of the engine's contract, with the starter kit, `create-historic-city`, many cities in one admin and the static export: [v1.0.0.md](v1.0.0.md), [v1.0.0_github_description.md](v1.0.0_github_description.md). Its versions are written (every one is 1.0.0); `cdn/engine/`, the kit's pins and the description's pinned addresses wait for the user's answer on the committed engine's EditorConfig exception, then the tag waits for the user ([../research/DECISIONS-for-review.md](../research/DECISIONS-for-review.md) §59, §63c, §63h).
