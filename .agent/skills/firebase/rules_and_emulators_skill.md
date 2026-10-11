# Rules and Emulators Skill

Firestore and Storage security rules, their tests, and the Firebase emulators every test tier uses. Rules outline: `docs/research/design-review-security-cost.md` §1.4–§1.5; tests: `docs/research/design-review-testability.md` §3.5.

## Projects

- Production: Firebase project `bucurestiul-disparut` (created with the user's yes; Spark until the admin links billing in-app). Its web config is never committed.
- Tests: the **`demo-hcm`** project. The `demo-` prefix guarantees no real resource is touched and no credential is needed.

## Rules (`firebase/`, written in M0)

- **`firebase.json` and `.firebaserc` live at the repository root**: firebase-tools refuses any path outside the directory that holds `firebase.json`, so from `firebase/` it could deploy neither `functions/dist/` nor `packages/admin/dist/`. The rules, indexes and rules tests stay in `firebase/`.
- **Default deny**: `match /{d=**} { allow read, write: if false; }`.
- **Admin** = custom claim `admin == true` **and** `admins/{uid}` exists (immediate revocation; a claim alone stays valid for up to an hour), `email_verified`, provider `google.com`.
- **The public never reads Firestore**: every collection is admin-only; the public reads only the static manifest and photo files in the public bucket.
- Strict field validation: `hasOnly` keys, `{ro, en}` maps with length limits, coordinates within the city bounds, year 1800–2100, bearing 0–360, FOV 1–180, licence from the enum, at most 5 links; server-owned fields (`image`, `exif`, `processing`, `mapbox`, `createdAt`) cannot be written by clients; `setup/*` is read-only for admins and holds no secrets.
- Storage: the private bucket accepts admin uploads under `uploads/photos/...` (JPEG, PNG, WebP, TIFF, HEIC/HEIF; under 60 MB) and `uploads/rasters/...` (TIFF; under 8 GB); everything else is written by service accounts only. **No SVG, ever.** The public bucket is written only by service accounts.
- Storage counts **overwriting an existing object as `create`**: upload rules require `resource == null` (found by the rules tests).

## Rules tests (`firebase/rules-tests`, workspace `@hcm/rules-tests`)

- `@firebase/rules-unit-testing` (needs Node 24.12 or later, `firebase` 13) under the emulators: `npm test` = `firebase emulators:exec --project demo-hcm --only auth,firestore,storage 'bash scripts/ci/run-emulated-tests.sh'` (every Vitest project, one merged lcov).
- The emulators load the rules from `firebase.json` once: never pass `rules` to `initializeTestEnvironment` (a reload resets the coverage) and never clear data; test files run in parallel, so each owns a scope (persona uids and city ids prefixed with it). Personas and `verdict()`/`verdicts()` live in `firebase/rules-tests/test/support/world.ts`.
- For every `match`: allow **and** deny for anonymous, signed-in non-admin, admin by claim, admin by document, stale claim; field validation, boundary values, size and content-type limits, "rules are not filters" queries.
- **Rule coverage** (`scripts/ci/check_rules_coverage.py`, the `rules-coverage` gate of the tests stage): `save` fetches the emulator's rule-coverage report inside `emulators:exec`; `check` fails when an expression was never evaluated, an `allow` never allowed or never denied a request, or the report is stale. Storage has no coverage report, so each Storage `allow` gets its happy and bad row instead.

## Emulators

- firebase-tools 15.33.0 (root dev dependency) on JDK 21 (firebase-tools 15 refuses older Java). The Firestore, Storage and Pub/Sub emulator JARs are baked into the quality image at `/opt/hcm/firebase-emulators` (`FIREBASE_EMULATORS_PATH`), so tests need no download.
- Always inside the quality image (Docker-only rule): `firebase emulators:exec --project demo-hcm --only <list> "<command>"`.
- e2e topology (M1–M2): emulators for auth, firestore, storage, functions and hosting (the built admin, with the CSP headers); functions run from `functions/dist/`. Secrets for the emulator come from a test `.secret.local` copied from `e2e/env/` (the real one is git-ignored and refused by the pre-commit hook); base URLs point at the mock APIs.
- Isolation: each test namespaces data by city id `e2e-w{workerIndex}-{testId}` and unique Auth users; seeding goes through the Admin SDK pointed at the emulators (`@hcm/test-support`).
- The admin connects to the emulators only when built with the `e2e` mode; that branch is unit-tested too.

## Agent rules

- The user logs in to Firebase themselves (`npx -y firebase-tools@15.33.0 login` in their own terminal). Agents never run `login:ci`, create tokens or keys, or type credentials.
- `firebase deploy` and any `firebase` / MCP action that changes a project are **ask first**, per action.
- Firebase logs (`firebase-debug.log`, `firestore-debug.log`, `ui-debug.log`, `.firebase/`) are git-ignored.
