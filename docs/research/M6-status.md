# M6 status: Setup with no terminal, the in-app installer and the public map on Firebase Hosting

Written on 2026-10-30 by the M6 integrator, after the four M6 workstreams (installer, hosting, server-bugs, setup-ux)
reported. It records the state of branch `feat/engine-rewrite` as the pipeline left it. Nothing in M6 was committed,
pushed, tagged or deployed, nothing was downloaded, and no test called a real Google, Mapbox, USGS, STAC, Nominatim or
Vertex AI endpoint: everything below that says "works" was proved against the Firebase emulators (project `demo-hcm`),
the shared fakes of `@hcm/test-support` (a fake Cloud Build among them, which plays each build without running a step)
and the e2e mock servers. The source of truth: the user's live manual test of 2026-10-25,
[manual-test-2026-10-25.md](manual-test-2026-10-25.md) (findings 1–24, the requests and the decision); the contract and
every change request: [M6-interfaces.md](M6-interfaces.md); the decisions: [DECISIONS-for-review.md](DECISIONS-for-review.md)
§67–§72; the lessons: `docs/LESSONS.md` 260–274.

The user's four requirements of 2026-10-25, as built:

1. **"The admin should be able to deploy from step d — a button"**: **Instalează serverul** (Install the server) on step
   (d), one click; **Actualizează harta** (Update the map) on the cards and Home's tile once the admin is newer than
   what is installed.
2. **"The admin does not need Claude or the terminal in the rest of the setup"**: the server and the public map are
   buttons, and the imagery pipeline's card and Update the map are ready for it; `docs/MANUAL_TEST_PLAN.md` lists no
   terminal command in Setup. Two exceptions remain: D1, the admin's first Hosting deploy (once per project, ask first),
   and the imagery pipeline, which the app cannot install in this release until the Docker builder's digest is pinned
   (`DECISIONS-for-review.md` §67e, the user's decision; D5 meanwhile; the pipeline is optional and the map works
   without it).
3. **The public map on Firebase Hosting at `https://bucurestiul-disparut.web.app/`**, the admin at `/admin/`, published
   from the admin (**Publică harta**, step i); old `/#/…` admin links forward to `/admin/`.
4. **USGS can be skipped and done later**: **Fă asta mai târziu** (Do it later) on step (f); Setup is done without it
   and Home reminds until it is set up.

## 1. The verdicts

After the reviews' fixes (§5), three full split runs of the default stage (`bash scripts/ci/e2e-split.sh`, stage `all`:
static → tests → e2e → tour-matrix → build → sonar, the Playwright runs split with the NUC), on the uncommitted tree of
`feat/engine-rewrite` (on `12ace20`), every gate in the quality image:

- The third run: `[local] [FAILURE] stage 'all' failed: static/npm-audit, static/pipeline-pip-audit` on this machine
  (every other gate passed: `tests` with 8165 Vitest tests,
  `[SUCCESS] rules coverage: every expression of firebase/firestore.rules evaluated, every condition allowed and denied`,
  `[coverage] OK: 1041 files measured at >= 90.00% per file (overall 99.31%, branches 98.32%), 11 report entries out of
  scope`; 926 Playwright tests passed here; `build` with the admin at 600.4 of its 620 KB gzip, `server.tgz` 762.4 KB,
  `pipeline.tgz` 213.5 KB, `hosting.tgz` 50,556.8 KB; `sonar` skipped without a token), and on the NUC
  `[nuc] [FAILURE] stage 'e2e' failed: e2e/playwright` with 1252 passed and one viewer test failed
  (S-V16-BAD-TILE-HOST-DOWN, the map not idle within 15 s on the loaded NUC; untouched by M6's fixes, passed in the two
  runs before).
- The audits: `npm-audit` fails on GHSA-gg6h-894w-4m9c (`re2js`, §72c), known and fixed by the orchestrator's approved
  dependency update after M6; `pipeline-pip-audit` on CVE-2026-119194 to -119197 in `pyasn1` 0.6.4, published during the
  third run, and a later `static` also on GHSA-3g3m-2fjr-6pw4 (`glob`, `npm-audit` and `deploy-lock-audit`): all need a
  download, so they are proposals for that update (§73m).
- The first run failed the content specs' signed-out describe (lesson 284) and a reload privacy check (lesson 285); the
  second the stray emulator log in `gitleaks dir`'s scope (lesson 287, §73l) and one layout check of the account menu
  at `admin-c360-ro` (a 20 px overflow of "Întunecată", passed in the other two runs); each fixed before the next run.
  `tour-matrix` passed on the NUC in all three runs (`[nuc] [SUCCESS] stage 'tour-matrix' passed`).

## 2. What works end to end on the emulators

- **The whole Setup with no terminal** (`e2e/admin/specs/journey.spec.ts`, S-A30-HAPPY-NO-TERMINAL, at `admin-c360-ro`
  and `admin-l1440-ro` per push, three more projects in `tour-matrix`): a new project in start-up mode (the admin's
  release and its install bundle served beside it) → sign-in and the ownership check → billing with no account yet, the
  account created on Google's page and linked by itself → Prepare the project with Secret Manager down, then Retry what
  failed → **Install the server**: one click, no consent, the server's and the imagery pipeline's Cloud Build builds
  submitted as `hcm-installer@` → the claim without a click, normal mode → Mapbox from a demo account to a paid one →
  USGS **Do it later** → analytics and its stream setting → the 45 legacy photos imported, processed and published →
  the imagery pipeline installed → **Publish the map**: one click and one consent (the analytics consent left the tab
  no Google Cloud token) → the public map at the e2e Hosting root boots București with the 45 photos the emulated
  server published (read from the Storage emulator) on one map, the admin still at `/admin/` → Setup done with USGS
  later, Home's reminder → USGS after all, its approval found by `ops.tick`, the reminder gone. No Setup text names a
  command; 11 inputs and 5 consents for the whole assistant (9 inputs with USGS postponed): the fifth is Publish the
  map's, since the tab keeps one Google token and the analytics consent replaces Google Cloud's (§73h, §73j). Its bad row, S-A30-BAD-TOKEN-EXPIRED: Publish the map two hours
  after Prepare the project asks Google once from the same click; nothing detected is asked again.
- **The installer** (behaviours A55–A57, `e2e/admin/steps/install/`): the build's definition (the account, the tags,
  the bundle's SHA-256, steps by digest, `--force`), its steps on the card, a first-deploy race retried inside the build
  (finding 12), a stopped build's step and redacted log with the console link and Try again, retries exhausted, a server
  newer than the admin never replaced, a build under way followed instead of a second one, Update the map (the server
  first, then the site), the pipeline's jobs on the image's digest, Publish the map off while nothing is published;
  Home's update and "stopped" tiles. Twelve tour states at the five admin projects.
- **The public map on Hosting** (A58, V30, A06, A24): the viewer at `/`, other cities at `/<city>/` through the
  generic city page, the bilingual 404, the start-up root, the admin under `/admin/` with its CSP as a header there
  only, old admin links and the old root push worker, the viewer token re-minted for the Hosting origins, error reports
  checked against their page's origin.
- **The server bugs** (findings 4, 11, 12, 17, 20): the Scheduler jobs' full account address, Provision's 16 items with
  the installer's account and role, `roles/run.invoker` for the functions' accounts, the service identities, the API
  propagation wait, the `events` self-test check, a stuck photo processed again, the Vertex AI failures said with
  Google's reason.
- **The Setup UX** (findings 1–3, 5–7, 15, 16, 18, 19, 22, 24): the loading screen and sign-in fit, the billing wait
  with **Creează un cont de facturare**, the busy indicator in place of the chip, the consent note only where a click
  asks, one count per card, link labels, USGS later and pending, the likely free trial, the import's snackbar, the
  surface filling the page, the optional `ai` check said quietly.
- **The integrator's fixes** (found by the whole-Setup journey): Publish the map stayed off once the token was gone
  (`InstallerPort.localBlocker`, lesson 273); the admin's "Setup done" ignored the install part (lesson 274). New city's
  done screen and Settings → Publishing name the city's public address `https://<project>.web.app/<id>/` with no
  repository step (CR-M6-17). The local stack serves its admin's install manifest, so `HCM_STACK_SEED=fresh` rehearses
  the install cards (a build ends on the fake's `cloud-build.finish`).
- **Screenshots**: every new or changed Setup state at 360×800, 768×1024, 1440×900 and 2560×1440, light and dark, in
  Romanian and English: `reports/screenshots/m6/<state>/`, contact sheets in `reports/screenshots/m6/sheets/`
  (git-ignored).

## 3. What waits for you (ask first, one at a time)

Everything after step 1 happens in the admin; Claude only points at the buttons.

1. **D1: the one terminal deploy, the M6 admin with its install bundle** (`docs/MANUAL_TEST_PLAN.md` → D1). After the
   commit and `all` green, in the quality image:
   `HCM_ADMIN_START_UP=1 npm run build:hosting && npm run build:install`, then on the host with your login
   `npx -y firebase-tools@15.33.0 deploy --only hosting --project bucurestiul-disparut --config firebase.deploy.json`.
   The root then says the map is being set up; the admin is at `https://bucurestiul-disparut.web.app/admin/` and an
   old `/#/setup` forwards there. (The start-up variant keeps visitors off a map whose Mapbox token the old server
   cannot re-mint yet.)
2. Sign in at `/admin/` (once per tab since §73a). Setup (c) shows **Reia ce nu a reușit** (Retry what failed): the
   project's record predates the 16th item, so the click runs every item, with Google's consent: the repository, the
   installer's account and role, `roles/run.invoker`, the service identities (D8; §5 below, finding 2).
3. Setup (d) → **Verifică din nou** (Check again): the card finds the 61 functions of `90b31be` and says **O actualizare
   este gata**; **Actualizează harta** (Update the map) there, or on Home's tile from then on: the M6 server (Scheduler
   jobs, the events probe, the viewer-token refresh) by Cloud Build in the project; the claim stays done, Setup stays
   done while it runs, and a stopped build offers **Încearcă din nou** on the card. The first real install proves what
   §9 of the contract leaves UNVERIFIED: Cloud Build's and Cloud Logging's answers to a browser (CORS), the installer's
   roles, the build minutes. The pipeline card says it comes with a later release until the Docker builder's digest is
   pinned (§67e, your decision).
4. Setup (b): **Contul este o probă gratuită** (This account is a free trial), one click: the live account is Google's
   90-day trial (finding 18), which Setup could not infer; Home then reminds two weeks before its end.
5. Setup (e) → **Înlocuiește tokenul vizitatorilor** (Replace the visitors' token), or wait for the next `ops.tick`:
   the viewer's token for the Hosting origins.
6. Setup (i) → **Publică harta** (Publish the map): the public map at `https://bucurestiul-disparut.web.app/`. Then
   **Verifică din nou** (Check again): the `events` and `ai` checks (finding 20's real cause shows there).
7. The decisions of §67 and §73: the old Pages site's future (§67c, §67d), the Docker builder's digest (§67e), the `ci.yml`
   lines (§67c, §67j), a Vertex model if the probe shows a 404 (§67g), the update channel for owners without CI (§67l);
   the sign-in per tab (§73a), one Google token per scope (§73j), the legacy originals in each publish (§73k).

## 4. Open items

- The decisions of §73: the sign-in per tab (§73a, reversible in one line), one Google token per scope (§73j), the
  legacy originals in every Hosting release (§73k).
- §9 of the contract stays UNVERIFIED until the first real install (step 3 above).
- `setup.status` does not answer `serverRelease` (CR-M6-21 (4)): Home reads the recorded install states.
- S-A19-BAD-LOW-CONTRAST-SEED and S-A20-BAD-NO-APP-CHECK stay `planned` (M2c and M2, unchanged by M6).

## 5. The reviews' fixes (2026-10-30)

Two adversarial reviews of the M6 tree (security and cost; minimum input, UX and the manual-test findings) found 16
problems; every one is fixed or, where it needs the user, recorded (`DECISIONS-for-review.md` §73, lessons 276–286):

| Review finding | Outcome | Rows |
| --- | --- | --- |
| Security 1: the viewer could read the owner's sign-in (one origin) | fixed: Auth in the tab's `sessionStorage` (§73a, for review: one sign-in per tab) | S-A58-HAPPY-SIGN-IN-IN-TAB, S-A58-BAD-VIEWER-READS-NO-SIGN-IN |
| Security 2: an incomplete newer server could be replaced with `--force` | fixed: the newest release any part names decides | S-A55-BAD-DOWNGRADE-INCOMPLETE |
| Security 3: a malformed viewer origin minted a token per tick | fixed: origins checked at build and run time; an unrecorded token deleted | S-A06-BAD-ORIGINS-REFUSED, S-A06-BAD-UNRECORDED-TOKEN-DELETED |
| Security 4: 50 MB public tarball in every release, transfer uncounted | fixed in the cost line and table (about 52 MB a publish); shrinking it is §73k | unit tests |
| Security 5: `server.tgz` packed `functions/dist` without an allowlist | fixed: an allowlist, anything else fails the build | `install-bundle.test.ts` |
| Min-input 1: no Install, Update or Try again in an admin session; the live server read as not installed | fixed: the button follows the install's state; a partial server is an update | S-A55-HAPPY-PRE-M6-UPGRADE, S-A55-BAD-UPDATE-FAILED-ADMIN |
| Min-input 2: Retry what failed never made the installer on a pre-M6 record | fixed: a never-reported item reruns every item | S-A04-BAD-PRE-M6-RECORD |
| Min-input 3: the pipeline had dead ends and is not installable in this release | fixed: its own Install the pipeline and Update the map include it; the docs say it waits on §67e | S-A56-HAPPY-INSTALL-ALONE |
| Min-input 4: a look on (d) put the claim back to waiting | fixed: the claim follows the server in start-up mode only; the tour checks it | S-A55-HAPPY-PRE-M6-UPGRADE, tour `setup.install-update` |
| Min-input 5: an update or a 503 made Setup look not done | fixed: a recorded release counts; `unavailable` is never recorded | S-A55-HAPPY-DONE-WHILE-UPDATING |
| Min-input 6: the live trial account is never flagged | fixed: This account is a free trial (one optional input) | S-A60-HAPPY-SAID-TRIAL, tour `setup.billing-mark-trial` |
| Min-input 7: "Add the payment method" opened the console's home | fixed: Open the Mapbox console, the advice in the hint | S-A05-HAPPY-LINK-LABELS |
| Min-input 8: Do it later offered while approval is pending | fixed | S-A59-BAD-NO-LATER-WHILE-PENDING |
| Min-input 9: "0 of 69 functions" beside a Done chip | fixed: no count before a look or once done | unit tests |
| Min-input 10: copy, an unused key, two cost lines per card | fixed (Not available yet:, one cost line) | unit tests |
| Min-input 11: "4 consents" was 5 on the happy path | fixed in the docs; one token per scope is §73j | — |

The 24 findings of the live test of 2026-10-25, after these fixes:

| Findings | Status |
| --- | --- |
| 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 16, 17, 19, 20, 22, 24 | fixed in code with their rows (16 now with no Do it later while pending) |
| 7 | fixed: the count once, and not before a look nor beside a Done chip |
| 10, 13 | fixed for the server and the public map, the live map's upgrade path included (Check again, Update the map, Try again; Retry what failed runs every item); the imagery pipeline waits on §67e (13 (c)) |
| 15 | fixed: every label checked against its target, the console's reads Open the Mapbox console |
| 18 | fixed: inferred for a new account, said in one click for an existing one |
| 21 | no change needed (G is Google's own step; the USGS wait was right) |
| 23 | a pass |
| 4 | fixed with its rows (trusted to them, not re-verified by the reviews) |
