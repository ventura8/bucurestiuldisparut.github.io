# Cloud Functions Skill

Firebase Functions v2 in TypeScript, workspace `@hcm/functions` (`functions/`, scaffolded in M0, the families in M2+), Node 24 runtime, region `us-central1` (Firestore `nam5`). Plan: `docs/research/PLAN.md` → *Cloud Functions*; testability: `docs/research/design-review-testability.md` §3.4; security: `docs/research/design-review-security-cost.md` §1.1–§1.2.

## Shape

```text
functions/src/index.ts          exports only (`export * as setup` deploys `setup-status`)
functions/src/global-options.ts setGlobalOptions({region: 'us-central1', maxInstances: 5}); imported first by every trigger
functions/src/triggers/*.ts     thin: onCall / onDocumentWritten / onObjectFinalized / onSchedule -> handler(getDeps(), ...)
functions/src/triggers/admin-guard.ts  requireAdmin: verified Google + `admin` claim + admins/{uid} (HttpsError codes)
functions/src/handlers/*.ts     pure business logic, all I/O through ports; never imports firebase-functions
functions/src/ports/*.ts        SecretStore, CloudRunJobs, MapboxApi, UsgsApi, Clock, TokenProvider, AdminDirectory, SetupRecords;
                                index.ts aggregates them as `Ports` (+ Logger from @hcm/shared); handlers take Pick<Ports, ...>
functions/src/adapters/*.ts     REST over fetch: Secret Manager (+ in-memory store for the emulator), Firestore (Admin SDK),
                                Cloud Logging sink, ADC token provider; later Cloud Run Admin v2, USGS M2M, Mapbox, GCS, Nominatim
functions/src/deps.ts           composition root: picks adapters by environment, created on first use
```

- **Pure handlers + thin triggers**: business logic never imports `firebase-functions`; triggers only authenticate, validate with the shared zod schemas and call the handler.
- **REST, not gRPC**: Cloud Run Admin and Secret Manager are called with `fetch`, so msw can test every adapter; tokens come from `TokenProvider` (google-auth-library). It also keeps cold starts small.
- **Secrets are read at runtime** (`versions/latest:access`) with a 5-minute cache busted by `setup/status.secretsRev` — never `defineSecret`, which would need a redeploy after every paste in the Setup Assistant.
- **Every writer validates** with `@hcm/shared` zod schemas: rules do not apply to the Admin SDK.
- **Per-function service accounts** (`fn-admin`, `fn-events`) and `maxInstances`; never the compute default account at runtime.

## Function families

- `setup.*`: `saveMapbox` (validate the `sk`, derive the user, verify scopes, mint the scoped tiles token and the URL-restricted public tokens), `saveUsgs` (`login-token` + `permissions`, poll for M2M approval every 6 h), `status`, `selfTest` (IAM and permissions smoke), `rotatePublicToken`.
- `usgs.*`: harvest on city creation and monthly; ranking; `markOrdered`; the daily order watch, also exposed as the "Check now" callable (the e2e seam); reminders on days 7 and 12.
- `jobs.onCreate` (transactional Cloud Run Job dispatch), `ops.tick` (every 15 min: resume jobs, poll MTS, nightly manifest rebuild, health checks), `ops.onBudget` (pause the pipeline and MTS on the budget alarm, never the site).
- `photos.onUpload` (magic-byte sniff, sharp → WebP 2048 and 400, EXIF stripped from public files, sha256 dedupe, suggestions), `publish.*` (diff-gated, serialized, debounced manifest builds through Cloud Tasks), `admins.invite`, `telemetry.reportError` (rate-limited, origin-checked), `assist.*` (M4).
- Callables check the admin claim, `email_verified` and `sign_in_provider == 'google.com'`; App Check is enforced, sensitive callables consume the token.

## Tests

- Handlers with fake ports (no `vi.mock` of owned modules); adapters with msw against the shared fixtures, including faithful failure shapes (USGS HTTP 500 JSON `errorCode`, HTML 403, 503 maintenance; Mapbox 401, 422).
- Triggers through the v2 `.run(request)` API with the real `deps.ts` and `firebase-admin` on the emulators (`npm test` runs Vitest under `firebase emulators:exec`); a test that writes a fixed document (`setup/status`) owns it, or uses its own named database (`getFirestore(app, '<name>')`), because test files run in parallel. **`firebase-functions-test` is not used** (it needs a `jest` peer and `firebase-admin` 13 or older).
- `deps.ts` branches covered with `vi.stubEnv` (`FUNCTIONS_EMULATOR === 'true'` picks the in-memory `SecretStore` and the queue-only `JobRunner`).
- Emulator integration (`firebase emulators:exec --project demo-hcm --only auth,firestore,storage,functions`) for real triggers, the claim flow, indexes and rules interaction.

## Build and deploy

- `functions/build.mjs` (Vite 8 SSR, no second bundler) bundles `@hcm/shared` and keeps npm dependencies external; it writes **`functions/dist/`** (`index.js` plus `package.json` with the exact pins), which `firebase.json` deploys (`predeploy` builds it). `dist/` because every tool already ignores it; a `deploy/` directory would need an ESLint ignore. The lockfile for it and a gate refusing `workspace:` or `file:` dependencies come in M2. e2e runs the emulator on `functions/dist/`, the same artifact production gets.
- Adding the workspace: `functions/package.json`, `"functions"` in root `workspaces`, the TS project references, a `COPY` line in `docker/Dockerfile.quality`; the `functions` Vitest row then activates (`docs/research/M0-handoff.md` → *TODO for the next agents*).
- `firebase deploy` is **ask first**; CI deploys through Workload Identity Federation (no keys) after a green CI on `master`.
