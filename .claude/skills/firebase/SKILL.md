---
name: firebase
description: Work with the Historic City Map Firebase side - project bucurestiul-disparut (web config never committed), the demo-hcm emulator project, Cloud Functions v2 as pure handlers with ports and REST adapters tested through run(), default-deny Firestore and Storage rules with the allow/deny matrix and rule coverage, App Check, secrets read at runtime from Secret Manager, consent-gated analytics and Cloud Error Reporting, and the ask-first rule for deploys and project-changing MCP actions. Use for any functions, rules, emulator, Hosting, analytics or crash-reporting task.
---

# Firebase Skill

Working notes: `.agent/skills/firebase/functions_skill.md`, `.agent/skills/firebase/rules_and_emulators_skill.md`, `.agent/skills/firebase/analytics_and_crash_skill.md`. Architecture: `docs/ARCHITECTURE.md`.

## Commands (inside the quality image)

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx firebase emulators:exec --project demo-hcm --only firestore,storage "npx vitest run --project rules"'
```

The emulator JARs are baked into the image (`FIREBASE_EMULATORS_PATH`), JDK 21 included; `demo-hcm` needs no credentials.

## Must know

- **The public viewer never reads Firestore** and loads no Firebase SDK for data; analytics and performance load only after consent and only with a `measurementId`.
- Functions: thin triggers call pure handlers through ports; Cloud Run Admin and Secret Manager over REST with `fetch` so msw covers them; secrets read at runtime with a cache, never `defineSecret`; every writer validates with the shared zod schemas. `firebase-functions-test` is not used: trigger tests call `.run(event)`.
- Rules: default deny; admin is claim plus `admins/{uid}`; strict field validation; no SVG; every `allow` tested allow and deny per role; rule coverage evaluated true and false.
- The Firebase web config, `.secret.local` and service-account files are never committed or opened by an agent.

## Ask first, every time

`firebase deploy`, any `firebase`, `gcloud` or Firebase MCP action that changes a project, enabling an API, changing IAM or an org policy, accepting terms. The user runs `npx -y firebase-tools@15.33.0 login` themselves; agents never run `login:ci`, create tokens or type credentials.
