# Analytics and Crash Reporting Skill

"Full Firebase support for crashes and analytics" (user request, `docs/research/PLAN.md` → *Addendum 2*), within the privacy and cost rules. Architecture summary: `docs/ARCHITECTURE.md` → *Analytics and crashes*.

## Analytics (GA4 for Firebase, Performance Monitoring)

- In both the public viewer and the admin, through the analytics and performance modules of the Firebase JS SDK (`firebase` package).
- **Loaded only after consent**: an M3 consent banner (RO/EN); Consent Mode v2 defaults denied; `analytics_storage` granted on accept. The decision is stored and can be withdrawn in About.
- The viewer still never reads Firestore: the Firebase app, analytics and performance are lazy-loaded only when the manifest has a `measurementId` **and** the visitor consented. Code: `packages/engine/src/telemetry/` (`consent.ts`: the choice per city under `hcm:<cityId>:consent`, Consent Mode v2 starting denied; `analytics.ts`; `errors.ts`; `telemetry.ts`; `firebase-sdk.ts`, the one lazy chunk with the Firebase app, analytics and performance modules).
- Firebase Analytics refuses to start without the web app's `apiKey`, `appId` and `projectId`; until the manifest carries them (`city.analytics.firebase`, change request CR-9) the engine logs `analytics off` and sends nothing, so the consent banner shows but no GA request follows.
- The ES module build loads the SDK as its own chunk only after consent; the IIFE build inlines it (Rolldown has no code splitting for IIFE), about 24 KB gzip downloaded but not run before consent (CR-10, `docs/research/DECISIONS-for-review.md` §13a). The city pages load `engine.mjs`.
- Events: `page_view`, `layer_toggle`, `year_change`, `photo_open`, `poi_open` (PLAN Addendum 3), `share` (the store's `logShare()` after a completed share or copy, never a cancelled one), `compare_open`; admin flow events for setup steps and imports. Opacity slider moves are not events (too chatty, no product question behind them). **No PII**: no email, no free text, no precise visitor location.
- The `measurementId` is detected by the Setup Assistant card "Analytics and crash reporting" through the Firebase Management API and written to the city doc and the manifest; the admin accepts the GA terms on Google's page.

## Crashes (web equivalent of Crashlytics)

- Global `error` and `unhandledrejection` handlers plus Lit and engine error boundaries.
- After consent: GA4 `exception` events with the fatal flag.
- The reporter never throws, redacts like `createLogger` plus URL queries (a tile URL carries the Mapbox token), sends at most 5 reports per page and one per message per 10 s.
- Always (no PII, rate-limited): `telemetry.reportError`, an HTTPS function (App Check on the admin, origin-checked on the viewer) that writes a redacted stack, release, viewport and window class as a structured log with `@type: type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent`, so **Cloud Error Reporting** groups crashes, alerts on first sight and emails.
- Source maps are uploaded as release artifacts for de-minification.
- Functions and the Cloud Run pipeline report through structured error logs.
- The Setup Assistant's "Crash reports" panel lists the latest Error Reporting groups through a callable.

## Tests

- Consent gating: no GA request before consent, proven by the e2e firewall (scenario V19); withdrawing consent stops further requests.
- Event payload unit tests; the error reporter's redaction and rate limit; an e2e for crash → `telemetry.reportError` with a mocked endpoint (V20).
- The CSP lists the googletagmanager, google-analytics, firebaseinstallations and firebaselogging hosts only for these SDKs (`web/web_security_skill.md`).
