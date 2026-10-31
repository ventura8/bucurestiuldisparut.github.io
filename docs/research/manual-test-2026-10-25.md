# Manual test findings (2026-10-25, live admin 0.0.0+90b31be, start-up mode)

The record of the live manual test of 2026-10-25: the user walked `docs/MANUAL_TEST_PLAN.md` (the start-up page and
sign-in, the Setup Assistant's steps with the deploys D2 and D3, and the photos' daily flow) with Claude on the real
project `bucurestiul-disparut`, admin `https://bucurestiul-disparut.web.app` (the start-up Hosting deploy of `90b31be`,
release `0.0.0+90b31be`). The passes and findings below are kept as they were noted during the walk; only their
Markdown changed (the tags' brackets escaped, two addresses in angle brackets, blank lines around the lists, finding 8,
noted last, moved to its place in the numbered list). The user's requests and decision of the same day are findings 10, 13, 14 and 16. What M6 does about
each finding, its owner and its scenario rows: [M6-interfaces.md](M6-interfaces.md) §3.

## The live state after the test

- **Billing**: a new Google Cloud billing account, a free trial (300 USD for 90 days, finding 18), linked to the
  project (Blaze) with the 5 USD budget (B1).
- **Provision cloud**: 15 of 15 items after one Retry what failed (B2, finding 4).
- **The server**: the rules and indexes and the 61 functions of `90b31be` deployed from the developer machine with the
  user's yes (D2, D3; D3 needed `--force`, finding 9, and a second run once Eventarc's service agent had propagated,
  finding 12). The Cloud Scheduler jobs of `ops-tick` and `imagery-tick` do not exist (finding 11). The admin left
  start-up mode by itself, so D4 was not run (finding 14); the owner claim (d2) followed without a click.
- **Mapbox**: saved for the account `ventura86`; both public tokens minted; the viewer's token is still restricted to
  `https://ventura8.github.io` (finding 14 asks for the Hosting address).
- **USGS**: the token is saved; USGS has not approved M2M downloads yet (checked every 6 hours), so Setup reads 8 of 9
  (findings 21, 24).
- **Analytics**: the measurement id was found (G).
- **The old Bucharest photos**: 45 of 45 imported, processed and published; the public manifest
  `cities/bucharest/manifest.json` lists 45 photos, their rights confirmed (H, finding 23).
- **The server checks**: every check green but Translation drafts (Vertex AI), which fails (finding 20).
- **The public site**: unchanged, the legacy site on GitHub Pages; nothing is published at the root of Firebase
  Hosting, where the admin still is.

## The IAM grant applied by hand

With the user's approval (2026-10-25), Claude granted `roles/run.invoker` at the project level to
`fn-events@bucurestiul-disparut.iam.gserviceaccount.com` and `fn-admin@bucurestiul-disparut.iam.gserviceaccount.com`
in the Cloud Console (finding 17): Eventarc could not deliver the Storage events to `photos-onupload`, which runs as
`fn-events@`, and Cloud Scheduler's OIDC calls as `fn-admin@` would have met the same refusal. Eventarc redelivered the
stuck events within minutes and the import finished. Provision does not grant this role yet: its `iam` item merges the
bindings it wants into the project's policy and never removes one, so a Re-check keeps the grant. M6 adds it to
Provision (M6-interfaces.md §1.6, `DECISIONS-for-review.md` §67b).

## Passed

- A1 start-up page boots clean (console: boot + start-up lines only).
- A2 title follows an English Chrome ("Map administration").
- A3 owner sign-in + ownership check -> Setup, step a Done.

## Findings

1. \[minor]\[layout] The "Loading…" screen shows a vertical scrollbar.
2. \[minor]\[layout] The start-up sign-in card sits at the top of the page, not centred.
3. \[ux]\[setup b] With no billing account, the card says "You have no billing account yet. Create one on Google's page" but the
   only way there is a plain link "Google Cloud billing accounts" (console.cloud.google.com/billing, the list page). It should be
   a primary button straight to the create page (console.cloud.google.com/billing/create), and say plainly that the app waits and
   continues by itself (the poll every few seconds is invisible except a thin bar). The "Link billing and create the US$5 budget"
   button stays enabled while waiting, which reads as "click me" though there is nothing to link. User reported "stuck at step b".
   (B1 then PASSED once the user created the account: linked, Blaze, budget.)
4. \[bug]\[setup c] Provision: "Service accounts" failed right after "Google services enabled: Done" with "The iam.googleapis.com
   service is not enabled in the project" — API enablement propagation delay (a just-enabled API answers SERVICE_DISABLED for
   up to a few minutes). Permissions and Keyless installation then wait on it. The provisioner should retry SERVICE_DISABLED for
   an API it has just enabled (backoff ~10 s up to ~3 min) instead of costing the admin a click. Live run: 11/15 done.
5. \[copy]\[setup c] The failure says 'Run "Prepare the project" again' but the button is "Retry what failed".
6. \[layout]\[setup] While a step is busy, the M3 loading indicator (morphing shape) is drawn ON TOP of the step's status chip
   ("To do") in the list and in the card header, covering its text. The indicator should replace the chip's icon/label, not
   overlap it (the overlap checker evidently does not see the busy state with a live loading indicator).
   (B2 PASSED after one "Retry what failed": 15/15, periodic check waits for the server as designed.)
7. \[copy]\[setup d] The "Install the map's server" card repeats step c's consent note ("Google asks for access to Google Cloud:
   we prepare the map's services and storage") although nothing on that card asks for a consent; and it says "0 of 61 functions
   installed" twice (above the note and under the progress bar).
8. \[docs] MANUAL_TEST_PLAN D3 says "51 din 51" while the card says 61 (and M5 will make it 68): keep the count out of the plan or
   derive it.
9. \[docs]\[deploy] D3 non-interactive fails: "Pass the --force option to deploy functions with a failure policy"
   (notify-onEvent has retry: true). The D3 command in MANUAL_TEST_PLAN / M2-status and the CI deploy job need --force (or the
   retry policy reconsidered); note that --force also deletes functions missing from the source.
10. \[FEATURE, user request 2026-10-25] Step d must let the admin install the server from the app: a button "Install the
   server" (and later "Update the server" when the admin's release is newer than the installed server). Design: in-browser
   deployer with the owner's Google consent (cloud-platform, like Provision), from a server bundle published with the admin
   (same commit: functions/dist zipped + a deployment manifest of the 61+ endpoints precomputed at build from the
   firebase-functions discovery: entry points, triggers, schedules, task queues, retry, service accounts, memory, env), uploaded
   to the project's bucket, then Cloud Functions v2 API create/patch per function + Eventarc/Scheduler/Tasks wiring, live
   progress per function, retry of failed ones only. Also firestore rules/indexes + storage rules from the same bundle (D2), so
   Setup needs no CLI at all. GitHub Actions deploy stays as the CI path. Needs: contract, fake GCP APIs in e2e, rows.
11. \[BUG]\[functions] Scheduled functions (ops-tick, imagery-tick): the Cloud Scheduler job create fails with 400
   INVALID_ARGUMENT because runAs() returns the shorthand "fn-admin@" and firebase-tools 15.33.0 passes it unexpanded as the
   job's oidcToken.serviceAccountEmail (the function itself accepts the shorthand). Fix: runAs() returns the full email
   `<name>@<project>.iam.gserviceaccount.com` (project from GCLOUD_PROJECT at discovery), with a unit test, and a deploy-shape
   test that every onSchedule's serviceAccount is a full email. The functions exist; their scheduler jobs do not.
12. \[ops]\[deploy] First functions deploy on a fresh project: 14 Eventarc-triggered functions fail with "Permission denied while
   using the Eventarc Service Agent ... may take a few minutes" (service agent IAM propagation). Any in-app deployer (#10) must
   retry these after a delay automatically; the Provision step could also pre-create the Eventarc/Pub/Sub service identities
   (it did not: the CLI generated them during the deploy).
13. \[FEATURE, user request 2026-10-25] "The admin must not need Claude or the terminal in the rest of the setup." Everything after
   Provision must be in-app: (a) install/update the server: functions + Firestore rules/indexes + Storage rules (#10);
   (b) leave start-up mode by itself once the server answers (no D4 Hosting redeploy; runtime.json startUp only a hint);
   (c) install the imagery pipeline: Cloud Build from the bundled pipeline source into Artifact Registry + the two Cloud Run
   Jobs via the Run API (replaces D5); (d) the public site publish without GitHub/terminal (decision: Firebase Hosting second
   site deployed from the admin via the Hosting REST API, or keep Pages via a GitHub step) (D7); (e) Vertex AI / FCM APIs via
   re-Provision (already in-app); (f) the optional GitHub keyless deploy variables stay optional. MANUAL_TEST_PLAN must then
   list no terminal command in Setup.
14. \[DECISION, user 2026-10-25] The PUBLIC map lives on Firebase Hosting at the SAME <https://bucurestiul-disparut.web.app/>
   (the viewer at the root; the admin moves to a path, e.g. /admin/), published from the admin ("Publish the site" in Setup,
   via the Hosting REST API from the owner's consent); no GitHub Pages step. Consequences: per-path CSP headers (viewer vs
   admin), the viewer's URL-restricted Mapbox public token minted for <https://bucurestiul-disparut.web.app>, M5's multi-city
   paths (/<city>/) under the same site, the admin's auth handler unchanged (same origin), old Pages links (redirect notice).
   OBSERVED: after D3 the admin LEFT start-up mode by itself (full navigation, the city's brown theme): 13(b) already works,
   so D4 (Hosting normal-mode redeploy) is not needed; drop it from the plan.
   D3 PASSED after the Eventarc retry: d Done, d2 (claim) Done automatically, 5/9.
15. \[copy]\[setup e] The link "Add the payment method (choose Rotate token)" — the parenthesis reads like a stray hint from
   another link; check the deep links' labels against their targets.
16. \[FEATURE, user request 2026-10-25] Step f (USGS) can be skipped and done later: a "Do it later" action on the card
   (state "Later", not "To do"/"Done"); Setup readiness and the dashboard-first rule (§34i) no longer wait for USGS; the
   progress counts it as postponed; Home shows a persistent reminder tile "USGS is not set up yet: historical imagery search is
   off" with "Set up USGS"; the Imagery area keeps its "set up USGS first" state (S-A11-BAD-USGS-NOT-SET-UP); an M2M request
   already sent shows "waiting for USGS approval" with its date. Same pattern worth offering for the other optional/slow steps.
   Rows: happy (skip -> Home opens, reminder shown, later completion clears it) and bad (Imagery search while skipped).
   E PASSED: "Saved for the Mapbox account ventura86", both public tokens minted (viewer token still restricted to
   ventura8.github.io: re-mint for bucurestiul-disparut.web.app per #14).
17. \[BUG]\[provision IAM] Step h import stuck at 0/45: the uploads reach Storage, but Eventarc cannot deliver the events:
   photos-onupload logs "The request was not authenticated ... The IAM principal lacks run.routes.invoke". Event-triggered
   functions run as fn-events@ and Eventarc invokes them with that account, which has no roles/run.invoker; the same will hit
   the scheduler jobs (OIDC as fn-admin@) and possibly the task-queue functions. Fix: Provision's "Permissions" grants
   roles/run.invoker to fn-events@ and fn-admin@ (project level, or per service after install), a self-test check
   "events reach the server", and the e2e/rules cannot catch it (emulators skip IAM) -> add a contract/real-data probe and a
   LESSONS entry. Also: events delivered while the invoker was missing are lost (no retry on Storage-finalized?) -> the
   import must re-trigger processing for photos stuck in "pending" (photos.reprocess) instead of waiting 10 min per photo.
   WORKAROUND APPLIED LIVE (user approved, 2026-10-25): roles/run.invoker granted at project level to fn-events@ and fn-admin@
   in the Cloud Console; Eventarc redelivered the stuck events within minutes. H PASSED: 45/45 imported, processed and
   published; public manifest cities/bucharest/manifest.json (45 photos, max-age=60, CORS *), web/thumb WebP 200.
18. \[info] The new billing account is a Google Cloud FREE TRIAL ($300, 90 days). The app should detect a trial billing account
   in step b and remind the owner (Home tile, ~2 weeks before the end) to upgrade, or the server stops when the trial ends.
19. \[ux]\[setup] After step h finished, the card jumped to the next unfinished step (f) by itself: fine, but no confirmation of
   what just finished ("45 photos imported") stays visible; a snackbar "All 45 photos are on the map" would close the loop.
20. \[BUG]\[self-test ai] Server checks: "Translation drafts (Vertex AI): Unavailable now — Something went wrong on the server."
   The function logs only {"check":"ai","code":"apiError.internal"}; the Agent Platform (aiplatform) API IS enabled and its
   metrics show NO request/error, so the call fails before reaching Vertex (request building, endpoint/region, model id
   gemini-2.5-flash-lite, the fn-admin token, or the custom role). Fix: (a) log the upstream status/api/reason (never secrets)
   and map it to an actionable message instead of "Something went wrong"; (b) find the real cause with a real-data probe;
   (c) a free-trial billing account may not have Gemini access — check and say so.
21. F: the owner saved the USGS token; step f shows "Waiting": "USGS has not approved M2M access for this account yet. We
   check again every 6 hours." (correct). G: "Google Analytics is not enabled for the project" -> the owner must enable it in
   the Firebase console (Project settings > Integrations > Google Analytics) — a human step by design (Google's terms).
22. \[layout]\[setup] Scrolled to the bottom, the page shows a band of a different background below the content (the shell's
   surface does not fill the viewport height when the content is shorter than the scrolled viewport).
23. C (photos) PASSED so far: list 45 with thumbnails, map draws (clusters/markers), editor opens with in-view, bulk "Confirm
   rights" on all 45 -> manifest republished 16:34 with rightsReview false x45. G PASSED (measurement id found).
24. \[ux]\[setup] "Setup 8 of 9, not done" only because f waits on USGS's M2M approval (days): the user read it as "Setup is
   broken". With #16 the header should say "Setup done — USGS approval pending" and the dashboard-first rule should open Home.
   The Vertex AI check failing is not a step but sits in the same card with an alarming icon (#20).
