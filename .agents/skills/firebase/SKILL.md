---
name: firebase
description: Work with the Historic City Map Firebase side - project bucurestiul-disparut (web config never committed), the demo-hcm emulator project, Cloud Functions v2 as pure handlers with ports and REST adapters tested through run(), default-deny Firestore and Storage rules with the allow/deny matrix and rule coverage, App Check, secrets read at runtime from Secret Manager, consent-gated analytics and Cloud Error Reporting, and the ask-first rule for deploys and project-changing MCP actions. Use for any functions, rules, emulator, Hosting, analytics or crash-reporting task.
---

# Firebase Skill

Working notes: `.agent/skills/firebase/functions_skill.md`, `.agent/skills/firebase/rules_and_emulators_skill.md`, `.agent/skills/firebase/analytics_and_crash_skill.md`. Architecture: `docs/ARCHITECTURE.md`.

## Commands (inside the quality image)

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx firebase emulators:exec --project demo-hcm --only auth,firestore,storage \
  "METADATA_SERVER_DETECTION=none npx vitest run --project functions --project functions-deps --project rules"'
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npm run build --workspace @hcm/functions'   # functions/dist, checked and loaded
```

The emulator JARs are baked into the image (`FIREBASE_EMULATORS_PATH`), JDK 21 included; `demo-hcm` needs no credentials. `.firebaserc`'s `default` is the real `bucurestiul-disparut`, so always name `--project demo-hcm`.

## Must know

- **The public viewer never reads Firestore** and loads no Firebase SDK for data; GA4 loads only after consent and only with a `measurementId`, never sees the URL hash, and has its cookies expired on withdrawal; Performance Monitoring is not in the public viewer (it would send the hash).
- Functions: thin triggers call pure handlers through the ports of `functions/src/ports/`; Google APIs, Mapbox and USGS over REST with `fetch` so a fake `fetch` covers them; secrets read at runtime with a cache, never `defineSecret`; every writer validates with the shared zod schemas (`packages/shared/src/schemas/firestore.ts` for the content documents, `packages/shared/src/schemas/firestore-ops.ts` for the operational ones, paths in `packages/shared/src/schemas/paths.ts`). `firebase-functions-test` is not used: trigger tests call `.run(event)`.
- M2 contract (`docs/research/M2-interfaces.md`): every function is a row of the registry in `packages/shared/src/api/registry.ts` (access rule, App Check mode, instance cap, zod request and response); callables are built with `defineCallable` (`functions/src/api/callable.ts`) and fail with error codes (`ApiError` → `HttpsError(status, code, details)`, messages in `packages/shared/src/i18n/api/`). The fields a client may write are `CLIENT_WRITES` (`packages/shared/src/schemas/client-writes.ts`), mirrored by the rules.
- Wiring: `functions/src/index.ts` exports one group per namespace from its folder's factory; `functions/src/global-options.ts` sets `us-central1`, the caps and `runAs(name)`, the service account of every function (`fn-admin@` for callables and `ops.*`, `fn-events@` for triggers and the builder, `fn-crash@`, with no project role, for the public crash endpoint); `functions/src/deps.ts` builds `RuntimeConfig` and the adapters, and in the Functions emulator sends upstream calls only to the fakes at `HCM_UPSTREAM_BASE`, keeps secrets in their fake Secret Manager (each function runs in its own process; in memory without fakes), names the task queue's service account and enqueues manifest tasks without an id (the Cloud Tasks emulator dispatches at once). `functions/test/index.test.ts` checks the exports against the registry.
- Rules: default deny; admin is claim plus `admins/{uid}`; client writes exactly `CLIENT_WRITES` with the schemas' value checks and the stamp; no SVG; every `allow` tested allow and deny per persona; rule coverage evaluated true and false; a request may evaluate at most 1000 expressions, so checks stay cheap (bounded patterns, neutral defaults).
- A collection-group rule matches that collection name everywhere: narrow `get` by the path (a path condition cannot hold for the collection-group query itself), and give every new server-owned field a value in the rules tests' complete document (`docs/LESSONS.md` 77, 78). Keep a collection-group query to its owner on the server, by a field the documents carry (`cityId` on history entries, the indexes starting with it), never by filtering in the page (lesson 149).
- A transaction re-checks every precondition it acts on, and a cap lives in a document it reads and writes (`ops/dispatch`), never in a query before it; the in-memory store runs transactions as they come, so a race test serialises them as Firestore would (`docs/LESSONS.md` 176, 177).
- Deploy artifact: `functions/build.mjs` writes `functions/dist/` with the lockfile of `functions/deploy-lock/` (stale lock: the build fails; refresh with `npm run deploy-lock --workspace @hcm/functions` in the pinned Node image, with the network) and one `.env.<project>` per project of `functions/deploy-env.json` (public `HCM_*` values only; a committed `.env.*` file is refused as a secret file). sharp is imported on the first photo, never at cold start.
- The Firebase web config, `.secret.local` and service-account files are never committed or opened by an agent.

## Ask first, every time

`firebase deploy`, any `firebase`, `gcloud` or Firebase MCP action that changes a project, enabling an API, changing IAM or an org policy, accepting terms. The user runs `npx -y firebase-tools@15.33.0 login` themselves; agents never run `login:ci`, create tokens or type credentials.
