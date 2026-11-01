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

## Live test 2026-10-31 (M6 admin)

The user's second live walk, on the same project: the admin `1.0.0+18977f0` deployed to `/admin/` in its start-up
variant (D1), the server still the 61 functions of `90b31be` (2026-10-25). The numbering continues the list above.
What each finding changed, its rows and its decisions: `docs/LESSONS.md` 296–298 and 300–305, `DECISIONS-for-review.md` §75 and
[M6-status.md](M6-status.md) §6. Findings 29, 32 and 34 and the live outcome of 2026-11-01 were recorded on 2026-11-01.

- **25.** \[bug, minor]\[hosting] On the start-up root (`/`, "the map is being set up"), an old admin address typed as a hash
  change only (`/#/setup` while already on `/`) did not forward to `/admin/#/setup`; a fresh load did. Cause:
  `scripts/site/src/hosting/admin-redirect.ts` read `location.hash` once, at load. FIXED: it also forwards on
  `hashchange` (S-A58-HAPPY-OLD-LINK-HASH-CHANGE, S-A58-BAD-VIEWER-HASH-CHANGE).
- **26.** \[DECISION for the user] The per-tab sign-in (`DECISIONS-for-review.md` §73a) is tiring live: every new tab, every
  notification link and Claude's own tab ask to sign in again. The alternative, the admin on its own Hosting site with
  the normal local persistence, is written up as a proposal in §75c; nothing changed. The user's decision (2026-11-01):
  §75c REJECTED, "we don't want the admin on its own hosting site"; the per-tab sign-in of §73a stays.
- **27.** \[bug]\[setup] After the redeploy Setup read 3 of 11: d2 "Take over the map", e Mapbox, f USGS, g Analytics and h old
  photos "To do", which the old admin against the same server showed Done (USGS "Waiting"). Causes, from the code:
  (1) the M6 admin's `admin.session` schema requires M5's `cities` and `projectOwner`, which the pre-M5 server does not
  return; the adapter turned the mismatch into `internal`, which the probe reads as "no server", so the admin stayed in
  start-up mode (or showed "the server is down" after a sign-in) and never asked `setup.status`; (2) in start-up mode
  step d waited for all 69 functions of the M6 registry, so the 61 of `90b31be` never led to the probe and the claim
  that had taken the old admin out of start-up mode by itself (finding 14); (3) a step nothing had checked read
  "To do". Stored state was not the cause: `localStorage` and `sessionStorage` belong to the origin, not the path.
  FIXED: the session schema reads a pre-M5 answer (no city, not the project's owner); an answer in a shape the admin
  cannot read is `apiError.serverOutdated` (a server that answered, never "no server"), so a browser that had seen the
  server (`hcm:admin:serverSeen`) leaves start-up mode by itself again; in a browser that had not, step d waits for the
  whole M6 registry and Update the map installs it; a step the older server cannot say reads **Update the server to check**
  (`adminSetup.state.unknown`), never "To do" (S-A03-HAPPY-OLDER-SERVER, S-A03-BAD-OLDER-SERVER-STATUS).
- **28.** \[BUG, blocks Setup d] The in-app server install (Cloud Build, `hcm-installer@`) stopped at step #3, `functions`:
  `firebase-tools` 15.34.2 runs `checkServiceAccountIam` (`lib/deploy/functions/checkIam.js`, from
  `lib/commands/deploy.js` for any functions target) before it deploys anything, and it requires
  `iam.serviceAccounts.actAs` on `<project>@appspot.gserviceaccount.com`, the App Engine default account:
  "Missing permissions required for functions deploy. You must have permission iam.serviceAccounts.ActAs on service
  account …". The user's decision (2026-10-31): "Code fix first, live later". FIXED: Provision's `iam` item grants
  `hcm-installer@` `roles/iam.serviceAccountUser` on that one account (its own policy, never project-wide) when the
  account exists (a GET; a 404 grants nothing and is no failure); the custom role `hcmInstaller` also gains
  `cloudfunctions.functions.setIamPolicy`, which `checkHttpIam` requires before a deploy creates an HTTPS function. A
  stopped build whose log names one of these checks offers step c's **Retry what failed** on the server's card (it
  reruns the `iam` item, whose row names the reason), then **Try again**. The fakes now enforce the check
  (S-A04-HAPPY-APPENGINE-ACTAS, S-A04-BAD-NO-APPENGINE-ACCOUNT, S-A55-BAD-NO-ACTAS). Live, after the next admin
  redeploy: Setup c **Retry what failed**, then d **Try again** (`docs/MANUAL_TEST_PLAN.md`).
- **29.** \[bug]\[setup d] An admin tab left open across a Hosting redeploy kept running the old admin's code (the hashed chunks of
  the old release), and its actions used the old release's install bundle, which the redeploy had removed: a server build
  then stopped at `fetch` with "manifest.json is not the one the admin read". FIXED (`DECISIONS-for-review.md` §75i, lesson
  303): the admin reads its `runtime.json` again (no-store, a few hundred bytes) when the tab becomes visible again (at most
  once a minute), every five minutes while it is visible, and before it submits any install build
  (`packages/admin/src/app/release-watch.ts`); once Hosting serves another release, a polite banner above the page says
  "A new version of the admin is ready" with **Reload** (the sign-in, kept in the tab's `sessionStorage`, survives it),
  and an install click refuses (`apiError.install.adminOutdated`, naming the newer release) instead of submitting a build
  (S-A61-HAPPY, S-A61-BAD-INSTALL-REFUSED; tour `shell.new-release`).
- **30.** \[BUG, blocks Setup d] With the actAs grant in place (admin `1.0.0+60fe650`), the server install passed
  `firebase-tools`' check and started `deploy --only functions --force` (step `functions`, `steps/deploy-with-retry.mjs`),
  which printed "⚠ functions: Couldn't find firebase-functions package in your source code. Have you run 'npm
  install'?", "Loading and analyzing source code for codebase default to determine what to deploy", then "Error: An
  unexpected error has occurred.". Cause: `firebase.json`'s functions source is `functions/dist`; `server.tgz` carries
  it with its `package.json` and deploy lock but no `node_modules`, and `firebase-tools` resolves `firebase-functions`
  from that folder and loads `index.js` to discover what to deploy. From a checkout Node finds the packages in the
  repository's `node_modules` above it, so no laptop deploy, and no fake, ever showed it. FIXED: the server build's step
  `packages` (**Install the server's packages**, after `tools`) runs `npm ci --omit=dev --ignore-scripts --no-audit
  --no-fund` in `server/functions/dist`; the fake Cloud Build stops a server definition without it at `functions` with
  those lines (S-A55-BAD-NO-FUNCTIONS-PACKAGES); every other step was audited for the same kind of gap
  (`M6-interfaces.md` §1.4.1, addendum). Live, after the next admin redeploy: the stopped build is of an older release,
  so (d) offers the install again (the update against the server of `90b31be`; Install the server on a fresh project),
  and its one click runs the build with `packages`.
- **31.** \[bug]\[setup] Step (d), Install the server, waited for the whole of step (c), so an item only the optional
  imagery pipeline needs (the Artifact Registry repository `hcm`) not done held the server back. FIXED
  (`DECISIONS-for-review.md` §75h, lesson 302): (d), the install cards' looks and the deployment's watch wait for every
  item the server needs (`serverPrepared`); the installer's writer role on `hcm` moved into the `artifact-registry`
  item, which the `iam` item no longer waits for; the pipeline's card names the missing repository
  (S-A55-HAPPY-PIPELINE-ITEM-FAILED, S-A55-BAD-SERVER-ITEM-FAILED).
- **32.** \[bug]\[setup] Right after a reload Setup showed every step as "To do" (0 of 11) for several seconds, until the
  server's record (`setup.status`) and the checks answered. FIXED (§75j, lesson 304): until a step's first check answers
  (the server's record, read or refused; the legacy import's own detection; the tab's record in start-up mode) its chip
  reads **Checking…** / **Se verifică…** with the loading indicator, and the header says "Checking every step…" over an
  indeterminate ring with no count, Check again off; a record that cannot be read ends it with the page's alert
  (S-A03-HAPPY-CHECKING-AFTER-RELOAD, S-A03-BAD-CHECKING-STATUS-FAILS; tour `setup.loading`).
- **33.** \[BUG, blocks Setup d] With findings 28 and 30 fixed, the server install (Cloud Build f92cec75) passed fetch,
  tools, packages, rules and indexes, the source upload and the Pub/Sub and Eventarc identities; then every function
  create and update failed: "HTTP Error: 403, Caller is missing permission 'iam.serviceaccounts.actAs' on service
  account `projects/-/serviceAccounts/<number>-compute@developer.gserviceaccount.com`. Grant the role
  'roles/iam.serviceAccountUser' to the caller on the service account …", then "failed to create/update function …".
  Cause: Cloud Functions gen 2 builds each function as the Compute Engine default account (`firebase-tools` names no
  build account), and the API requires the deployer to act as it. The user's decision (2026-10-31): "Act-as + narrow its
  role". FIXED (`DECISIONS-for-review.md` §75g, lesson 301): Provision's `iam` item grants `hcm-installer@` Service
  Account User on that one account (its own policy), gives the account `roles/cloudbuild.builds.builder` on the project,
  then removes its `roles/editor`; the server's card finds the 403 anywhere in the stopped step and offers **Retry what
  failed in step c**, then **Try again** (S-A04-HAPPY-COMPUTE-BUILD-ACCOUNT, S-A04-BAD-COMPUTE-EDITOR-REFUSED,
  S-A55-BAD-NO-COMPUTE-ACTAS). Live, after the next admin redeploy: reload the tab, (c) **Retry what failed**, (d) **Try
  again** (`docs/MANUAL_TEST_PLAN.md`).
- **34.** \[bug]\[setup c] After **Check again** on step (c) in a tab whose one-hour Google permission was gone (or never
  granted), "Prepare the Google Cloud project" turned to "To do" although its last provision run had finished every item
  (the server's record said done). Related, found by the §75b work: `provisionRequest` never recorded a doctor's `missing`
  result, so a re-check could not show an item that had gone back to missing (the record turned the chip back to Done).
  FIXED (§75k, lesson 305): without a Google token Re-check changes nothing (no doctor runs; an item Google refuses with
  401 mid-check is neither shown nor recorded) and the card says "Last checked {time}; sign in to Google Cloud to check
  again"; with a token a run records exactly what it reported, `missing` included, so the server's record follows the
  project both ways (S-A04-BAD-RECHECK-NO-TOKEN, S-A04-HAPPY-RECHECK-RECORDS-MISSING; tour
  `setup.provision-last-checked`).

Also checked: the sign-in card showed in English in an English Chrome with no saved choice. That is the admin's rule:
`?lang=`, then the stored choice (`hcm:admin:lang`), then the browser's first language (`resolveLocale`: English for
any `en*`), then Romanian (`packages/admin/src/state/locale.ts`; `M2b-interfaces.md` §1.6; the i18n skill). PLAN's
"default RO" holds only when the browser's first language is not English; nothing changed (the user decides).

### The live outcome of 2026-11-01

- **The server**: `1.0.0+9e2e6b5` installed from the app (Setup d, Cloud Build, no terminal), the admin the same release.
- **Setup**: steps a–i done.
- **The public map**: live at the root of `https://bucurestiul-disparut.web.app/` once step (e)'s **Replace the visitors'
  token** had minted the visitors' token again.
- **Translation drafts**: Vertex AI does not offer `gemini-2.5-flash-lite` to the project: the model is the user's
  decision of `DECISIONS-for-review.md` §67g.
- **Mapbox telemetry**: `events.mapbox.com` answers 503 to the map's usage events; harmless (the map draws), nothing changed.
- **The user's decision**: §75c (the admin on its own Hosting site) REJECTED; the per-tab sign-in stays (finding 26).

### The editors on the live map (2026-11-01, admin `1.0.0+9e2e6b5`)

The user's walk through the editors of the migrated Bucharest city, once Setup was done. The numbering continues the
list above; what each finding changed: `docs/LESSONS.md` 306–309 and `DECISIONS-for-review.md` §77.

- **35.** \[bug]\[places] Places → Add place on a city with no place categories (the migrated Bucharest had none: the
  legacy data has no categories, and neither `setup.createCity` nor `cities.create` made any): the Category select was
  empty and Save said only "The value does not have the required format." (the schema's word for the empty category
  id). FIXED (§77a): (a) a new city starts with five starter categories, Clădire/Building, Stradă/Street, Piață/Square,
  Biserică/Church and Monument/Monument (`STARTER_POI_CATEGORIES` of `@hcm/shared`: both labels, the icons the admin's
  icon guesser gives the labels, the default sepia and four companion tones the white glyph reads on), written in the
  transaction that creates the city (`functions/src/api/starter-categories.ts`, from `cities.create` and
  `setup.createCity`; an existing city gets none, `seed/bucharest/` unchanged); (b) the place editor of a city without
  categories shows, instead of the empty select, why a place cannot be saved yet, **Add the starter categories** (one
  batch, ids clear of the city's layers and categories, the new place then in the first) and **Add a category** (the
  settings' new category); (c) the field's problem reads "Choose a category" / "Alege o categorie", never the format
  text (S-A39-HAPPY-STARTER-CATEGORIES, S-A39-BAD-STARTER-CATEGORIES-EXISTING-CITY, S-A39-HAPPY-ADD-STARTER,
  S-A39-BAD-NO-CATEGORIES; tour `pois.no-categories`). Live: the next deploy of the server and the admin; then Places →
  Add place → **Add the starter categories** once in the migrated city.
- **36.** \[bug]\[public map] On the public map (Mapbox Standard Satellite) the lines and area outlines of places were
  thin strokes in the category colour and almost disappeared on the photo. FIXED (§77b): every category draws a white
  casing under its lines and area outlines (`hcm-poi-<id>-casing`, 90 % of the overlay's opacity), the stroke grows with
  the zoom (4 px at zoom 16, the casing 10 px), and the area fill is 35 % (was 30 %); every opacity still scales with the
  overlay's slider, so 0 % hides the casing too. The admin's map draws through the same layers
  (`packages/ui/src/map/pois.ts`; S-V24-HAPPY-LINE-CASING, S-V24-BAD-CASING-AT-ZERO-OPACITY, pixel probes over a dark
  satellite ground).
- **37.** \[bug]\[editors] A required field said the schema's generic words: an empty Romanian title read "The value is
  too small or too short." at the field and "Cannot save. The value is too small or too short." above Save. FIXED
  (§77c): the editing kit's `issue-text.ts` gives a required field the action it asks for ("Add a title in Romanian" /
  "Adaugă un titlu în română", "Add a name in Romanian" for a layer's or a category's label, "Add the city's name in
  Romanian", "Choose a category", "Draw the place on the map or add its positions", "Write the year as a number, such
  as 1966"), and Save's note names every field it waits for ("Cannot save: add a title in Romanian; choose a
  category."); the places, photos, layers and settings editors (categories and texts included) all say their problems
  through it, every other problem keeping the validation words after the field's name (S-A38-BAD-REQUIRED-FIELD-NAMED,
  S-A38-HAPPY-REQUIRED-FIELD-FIXED).
- **38.** \[bug]\[history] History listed created documents by their ids ("Place W1DLFHuhMZpHW6UzReWl") while their
  changes and deletions showed titles ("AreaOne", "Gresit"): a creation entry stores no version (`previous` is null).
  FIXED (§77d): a creation takes the title of the version it made, the `previous` of the next entry of the same document
  when the list holds one, else the document as it is now (read once per document,
  `packages/admin/src/history/names.ts`); only a creation whose document is gone with nothing newer listed keeps the
  kind and the id (S-A23-HAPPY-CREATED-NAMED, S-A23-BAD-CREATED-GONE-UNNAMED). The entries' schema is unchanged, so an
  older admin reads a newer server's entries as before.

### The update check and Settings (2026-11-01, admin `1.0.0+457201e`, server `1.0.0+9e2e6b5`)

After the Hosting redeploy of the admin `1.0.0+457201e` (the public variant). The numbering continues the list above;
what each finding changed: `docs/LESSONS.md` 310–311 and `DECISIONS-for-review.md` §78.

- **39.** \[bug]\[installer] Setup step (d) said "Installed: 1.0.0+9e2e6b5" and offered no **Update the map** for the
  admin `1.0.0+457201e`. Every release is version 1.0.0; the build metadata (`+commit`) has no precedence in semver,
  and the card showed the state the older admin had recorded of its own server (`installed`) without reading it against
  the newer admin (earlier updates were offered only because the old server had no release at all). FIXED (§78a):
  every release has a total order that follows the build: its **build time**, the commit's time in seconds since 1970
  (`SOURCE_DATE_EPOCH`, else `git show -s --format=%ct`), recorded beside the release wherever the release is recorded
  and compared (the admin's `runtime.json` `releaseTime`, the site's `/release.json`, the install manifest, the
  functions' `HCM_RELEASE_TIME`, the pipeline jobs' `hcm-release-time` label, the builds' `_RELEASE_TIME`,
  `setup/status.install.*.releaseTime`). Newer = a higher version, or the same version and a later build time; the
  same commit is installed; an installed build with a different commit and no time (every record and server before
  this change) is behind, never newer, unless its version is higher; a timed installed build is never replaced by an
  admin that knows no time of its own. A recorded state is read again against this admin's own release (Setup's cards
  and Home's tile), so the live server reads as an update without a look at Google; the downgrade guard (a server newer
  than the admin is never replaced) holds with the new order (S-A55-HAPPY-UPDATE-SAME-VERSION,
  S-A55-BAD-DOWNGRADE-SAME-VERSION, S-A55-HAPPY-SAME-BUILD; tour `setup.install-update-recorded`). Live: the next
  Hosting deploy of the admin; then Setup (d) **Update the map** once (one consent); the server it installs names its
  build time from then on.
- **40.** \[bug]\[setup] Card (d) (and any install card) showed Google's consent box ("Google asks for access to Google
  Cloud…") with no Continue button while there was nothing to do (installed, no update). FIXED (§78b): on an install
  card the note shows only with a button of the card that asks Google for the token (Install, Publish, Try again,
  Install the pipeline, Update the map), or beside Continue when a check needs the token again
  (`installCardAsks`, `packages/ui/src/admin/setup/install-status.ts`; S-A55-BAD-NOTE-NOTHING-TO-DO; tour
  `setup.install-nothing-to-do`).
- **41.** \[feature]\[settings] (the user approved) Settings → Place categories gets **Add the starter categories** for
  a city that already has categories. DONE (§78c): one click adds, in one batch, only the starters of finding 35 whose
  label is not there yet (a category's Romanian or English name equal to the starter's Romanian or English one, case,
  diacritics and spacing aside), ids clear of the city's categories and layers, after the city's own in order, as many
  as fit under the 50-category limit; the snackbar says how many; with all five present the action is off with "Every
  starter category is already here" (S-A39-HAPPY-ADD-MISSING-STARTERS, S-A39-BAD-STARTERS-PRESENT; tour
  `settings.categories-starters-added`, `settings.categories-starters-present`).

### The editors, Setup, Jobs, Crashes and push (2026-11-01, admin and server `1.0.0+e53d9ec`)

After the Hosting redeploy and the server update of `1.0.0+e53d9ec`. The numbering continues the list above; what each
finding changed: `docs/LESSONS.md` 312–316 and `DECISIONS-for-review.md` §79.

- **42.** \[bug]\[places] Places → **Add place**, then leaving it untouched (no title, no shape; the category select filled
  in by default) still asked "Discard your changes?". A new place counted as unsaved for being new, and the category
  filled in once the categories were listed was an edit. FIXED (§79a): a new place is unsaved only once it differs from
  its start (typed text, a drawn or placed position, a field moved from its default; `PoiDraft.unsaved`, positions of an
  unfinished shape in `PlaceEditor.unsaved`), and the category filled in later is a default (`PoiDraft.prefill`), not an
  edit (S-A38-HAPPY-NEW-UNTOUCHED, S-A38-BAD-NEW-TYPED-ASKS). UNVERIFIED: a line or an area being drawn on the map whose
  shape is not finished is held by the map's drawing tool, not by the editor, so it does not count until it is finished
  (the vertex list's positions do).
- **43.** \[bug]\[setup d3] Step d3 (the optional imagery pipeline) offered **Install the pipeline** although the install
  bundle's manifest says `tools.docker: null` (§67e undecided: no digest-pinned Docker builder), so a click could only be
  refused. The card read a record of the pipeline (looked at, not installed) without its reason. FIXED (§79b): the cards
  read once, without a token, whether this admin's bundle can install the pipeline (`InstallerPort.localBlocker`, the
  admin's own origin); when it cannot, the card says "Not available yet: …" with the existing copy and shows no button,
  no consent note and no "the same click also installs the pipeline" on the server's card, and neither Install the server
  nor Update the map submits it; with a Docker builder in the bundle the button stays (S-A56-BAD-NOT-AVAILABLE,
  S-A56-HAPPY-INSTALL-ALONE; tour `setup.pipeline-not-available`).
- **44.** \[ux]\[jobs] The Jobs page's empty state only said "No jobs yet.". DONE (§79c): a second line says where jobs
  come from, as Layers' empty state does: Historical imagery's imports (a USGS scene or a GeoTIFF), georeferencing or
  publishing a layer again, and deleting a layer's tiles (`adminContent.jobs.emptyHint`; S-A18-HAPPY-EMPTY-HINT,
  S-A18-BAD-EMPTY-HINT-GONE). Photo reprocessing and the static export do not make jobs (`JOB_TYPES`), so the line does
  not name them.
- **45.** \[ops]\[functions] Crashes showed a production group "The request was aborted because there was no available
  instance…" (Cloud Run's 429), three times from 2026-10-26 to 2026-10-29, application `ops-onbudget`. With one instance,
  a burst of budget notifications that came while it was starting was refused; Pub/Sub delivers a refused message again,
  so no alert was lost, but every refusal was an error. FIXED (§79d): `ops-onBudget` scales to three instances of 80
  concurrent requests (`BUDGET_SCALING`, `functions/src/ops/budget.ts`), no minimum instance (an idle month costs
  nothing), under the five-instance cap of every function; the guard's transaction keeps a repeated alert from turning
  it red or notifying twice (S-A43-HAPPY-BUDGET-BURST, S-A43-BAD-BUDGET-BURST-ONCE). Live: the next server update.
- **46.** \[bug]\[notifications] Notifications → **Notifications on this device**: after Chrome's prompt (granted) the
  admin said "Notifications did not start: This browser could not be registered for notifications. Try again, or use
  the inbox." Live facts: `Notification.permission` granted, the worker `/admin/firebase-messaging-sw.js` active with
  scope `/admin/`, a push subscription held, and a second click made no request to `fcmregistrations` or
  `firebaseinstallations`. That message is `apiError.notify.deviceInvalid`: the browser's side gave an installation id
  and the server's dry run at FCM (`messages:send`, `validate_only`, `fid`) refused it; with no request on the second
  click, `register()` answered from the SDK's own record of an earlier registration. FIXED (§79e):
  (a) a failure says why on a line of its own with its code, the SDK's (`messaging/fid-registration-failed`,
  `messaging/permission-blocked`, `installations/request-failed`, …) or FCM's (`fcm/UNREGISTERED`, passed on by the
  server as the refusal's `reason`), in Romanian and English for the known families, and the log keeps the code and the
  SDK's text with every id, token or key replaced (`packages/admin/src/inbox/push-failure.ts`; the server logs FCM's code,
  never the token); (b) a registration FCM refuses is made again once: the SDK's record is forgotten
  (`packages/admin/src/firebase/fcm-record.ts`) and the browser registers anew, also right after the root's worker of an
  admin before M6 is retired (S-A47-HAPPY-RENEWED, S-A47-BAD-FCM-REFUSED-REASON, S-A47-BAD-SDK-CODE,
  S-A47-BAD-FCM-REASON-NAMED; tour `notify.push-failed-reason`). What `register()` needs, read offline from
  `@firebase/messaging` 0.13.3 and `@firebase/installations` 0.6.24, against this project:
  - the Notifications permission granted: yes (live);
  - the worker's registration passed to `register()`, so the SDK never registers its own `/firebase-messaging-sw.js` at
    `/firebase-cloud-messaging-push-scope`: yes (`scope: './'`, `/admin/` live);
  - a push subscription of that worker, made with the SDK's default VAPID key when the worker has none (an existing one
    is reused whatever its key): present live;
  - Firebase Installations (`firebaseinstallations.googleapis.com`: `createInstallation`, `generateAuthToken`) with the
    web API key: the API is enabled by Provision, the CSP `connect-src` of `/admin/**` allows `https://*.googleapis.com`,
    and the key's referrers are `${origin}/*` of the admin's and the viewer's origins, which the page `/admin/` matches;
  - `CreateRegistration` at `fcmregistrations.googleapis.com` with the key and the installation's token: enabled by
    Provision, allowed by the same CSP;
  - IndexedDB for both SDKs' records (`firebase-installations-database`, `firebase-messaging-database`): a record says
    only the installation id and when it was registered, and is trusted for seven days, whatever worker or subscription
    it was made with: the cause fixed in (b);
  - the server's dry run with `fid` (firebase-admin 14's `FidMessage`) as the functions' account.
  VERIFIED offline: the CSP, the referrers, the enabled APIs, the scope, the record's seven days. UNVERIFIED until the
  next live try (the first attempt of 2026-11-01 was not captured): which of the record's registration (made with an
  earlier worker, or forgotten by FCM) and FCM's refusal of a fresh one it was; that a key auto-created by Firebase
  restricts its APIs to a list that includes the Installations and FCM Registration APIs; that the default VAPID key is
  accepted with `register()` (M4-interfaces §10). The reason line now names the code that settles it.
