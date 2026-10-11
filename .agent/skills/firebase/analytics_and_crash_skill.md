# Analytics and Crash Reporting Skill

"Full Firebase support for crashes and analytics" (user request, `docs/research/PLAN.md` → *Addendum 2*), within the privacy and cost rules. Architecture summary: `docs/ARCHITECTURE.md` → *Analytics and crashes*.

## Analytics (GA4 for Firebase, Performance Monitoring)

- In both the public viewer and the admin, through the analytics and performance modules of the Firebase JS SDK (`firebase` package).
- **Loaded only after consent**: an M3 consent banner (RO/EN); Consent Mode v2 defaults denied; `analytics_storage` granted on accept. The decision is stored and can be withdrawn in About.
- The viewer still never reads Firestore: the Firebase app, analytics and performance are lazy-loaded only when the manifest has a `measurementId` **and** the visitor consented.
- Events: `page_view`, `layer_toggle`, `year_change`, `photo_open`, `share`, `compare_open`; admin flow events for setup steps and imports. **No PII**: no email, no free text, no precise visitor location.
- The `measurementId` is detected by the Setup Assistant card "Analytics and crash reporting" through the Firebase Management API and written to the city doc and the manifest; the admin accepts the GA terms on Google's page.

## Crashes (web equivalent of Crashlytics)

- Global `error` and `unhandledrejection` handlers plus Lit and engine error boundaries.
- After consent: GA4 `exception` events with the fatal flag.
- Always (no PII, rate-limited): `telemetry.reportError`, an HTTPS function (App Check on the admin, origin-checked on the viewer) that writes a redacted stack, release, viewport and window class as a structured log with `@type: type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent`, so **Cloud Error Reporting** groups crashes, alerts on first sight and emails.
- Source maps are uploaded as release artifacts for de-minification.
- Functions and the Cloud Run pipeline report through structured error logs.
- The Setup Assistant's "Crash reports" panel lists the latest Error Reporting groups through a callable.

## Tests

- Consent gating: no GA request before consent, proven by the e2e firewall (scenario V19); withdrawing consent stops further requests.
- Event payload unit tests; the error reporter's redaction and rate limit; an e2e for crash → `telemetry.reportError` with a mocked endpoint (V20).
- The CSP lists the googletagmanager, google-analytics, firebaseinstallations and firebaselogging hosts only for these SDKs (`web/web_security_skill.md`).
