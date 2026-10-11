# Release Notes

Every release tag `vX.Y.Z` has **two files** in this folder, written before the tag is pushed:

| File | Purpose |
| --- | --- |
| `vX.Y.Z.md` | The full release notes: highlights, features, fixes, security, breaking changes and migration steps for city owners, verification results. |
| `vX.Y.Z_github_description.md` | The body of the GitHub Release. Its single H1 becomes the release title (for example `# Release v1.2.0 - Swipe compare`). |

## Rules

- The tag matches `^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`; the root and every workspace `package.json`, and the engine's `ENGINE_VERSION`, carry the same version.
- Semantic versioning of the engine's public surface: the `HistoricCityMap` global, the manifest schema and `config.js`. A breaking change is a major version and documents the migration.
- Notes describe what shipped, checked against the code. No test counts: they live only in the generated scenario document.
- Both files pass markdownlint like every other document.
- The release workflow (planned in `.github/workflows/`) refuses a tag without both files, a version mismatch, a failing SonarQube gate on the same commit, or a `dist` that does not rebuild identically; it then creates the GitHub Release from the description file.

How to prepare a release: [.agent/skills/quality/prepare_release_skill.md](../../.agent/skills/quality/prepare_release_skill.md).

## Releases

None yet.
