# Manual test plan: the whole product, from the top

The checklist the owner and Claude walk together before the go-live, fixing what they find on the way. It covers the live admin's start-up page and sign-in, the Setup Assistant step by step, the daily admin flows, the M3 historical imagery, M4's automation (buying a scan, the suggested pairs, the assists, the notifications), M5's many cities (New city, the city menu, publishing a city, its admins and budget), the static export, the starter kit and `create-historic-city`, and the public viewer with its swipe compare. Every item says **where** it runs and **when** it can run:

- **LIVE**: the real project `bucurestiul-disparut` (admin `https://bucurestiul-disparut.web.app`, today the start-up Hosting deploy of `8f4e43d`, 2026-10-23), the public site on GitHub Pages, jsDelivr and npm. Some items wait for a deploy (D1–D8) or a release step (R1–R9) below; each one is ask first.
- **LOCAL**: the local stack (`npm run dev:stack`, [SETUP.md](SETUP.md) → *Local stack for manual testing*): the same admin and viewer on the Firebase emulators and the fakes of the e2e world, seeded with a Bucharest city and a second city, Iași, nothing in the cloud. Every LOCAL item can run **now**: on 2026-10-25 the stack started with that seed, both apps answered and its check passed (`[SUCCESS] the local stack works`), and the export's download, Iași's publishing and its page, the e2e Pages tree, the kit's page and the CLI's commands of the items below were walked headless with no request off the machine.

The automated suites already prove each behaviour against the emulators ([E2E_SCENARIOS.md](E2E_SCENARIOS.md); each item names its rows); this walk is about what a person sees, the real providers' pages and what only the real cloud can show ([research/M2-status.md](research/M2-status.md) §3, [research/M3-status.md](research/M3-status.md) §3, [research/M4-status.md](research/M4-status.md) §3, [research/M5-status.md](research/M5-status.md) §3).

## How to use it

- Tick each box when its expected result holds. A failure: say it in the chat with the item's id (`B3`, `T2`, ...); Claude reproduces it (LOCAL first when it can), fixes it with a test and its happy and bad row in `e2e/scenarios.json`, and records it in [LESSONS.md](LESSONS.md).
- **Ids** are unique across the plan, one letter per area: **A** start-up and sign-in, **B** the Setup Assistant, **C** the daily admin flows, **M** M3's historical imagery, **O** buying a scan, **S** the suggestions and assists, **N** the notifications, **T** many cities, **X** the export, **K** the starter kit and `create-historic-city`, **V** the public viewer; **D** a deploy and **R** a release or repository step (both ask first).
- **Human steps** are yours alone: accounts, billing and card details, terms, passwords, Google's consents and every token paste. Claude opens the exact page and says which button; it never types a credential. **Ask first** marks a command Claude runs only after your yes for that command.
- Romanian is the admin's and the viewer's first language; the labels below are the Romanian ones you see, with the English in brackets. `?lang=en` on either address (or the language switch) shows the English ones.
- **Browsers**. LIVE: your own Chrome (the Google sign-in and the providers' consoles are yours). LOCAL: the Claude browser pane through `.claude/launch.json` (`dev-stack` starts the stack, `dev-stack-admin` and `dev-stack-viewer` open it), or Chrome at the same `127.0.0.1` addresses. On this machine the pane has **no WebGL** (checked 2026-10-24: the viewer shows its no-WebGL card, the admin maps their "cannot draw the map" state), so every item that looks at a map runs in Chrome (Claude in Chrome, or yours).
- LOCAL sign-in: **Conectează-te cu Google** (Sign in with Google) opens Google's consent stand-in in a frame over the page; `owner@e2e.test` is preselected; **Allow**. The other generated accounts: `admin@e2e.test` (an editor of București only), `editor@e2e.test` (a pending invitation), `stranger@e2e.test` (nobody). The seeded world, the logs and the levers are in [SETUP.md](SETUP.md).
- **LOCAL links**: the stack forwards what a page loads by itself (its requests, its images, a file it saves), never a link you follow. A link to a real site (EarthExplorer, Mapbox Studio, Google's consoles, OpenStreetMap) opens that site if you click it; LOCAL, check its address instead (hover it, or copy it).

## Live and local at a glance

| Area | LIVE now | LIVE after | LOCAL now |
| --- | --- | --- | --- |
| Start-up page, sign-in, ownership check (A) | yes (`8f4e43d`: before the title fix and M3) | D1: the current admin, start-up mode | `HCM_STACK_SEED=fresh` |
| Setup (b) billing, (c) Provision cloud (B1, B2) | yes, after D1 (so the M3–M5 items are provisioned) | | `fresh`, against the fakes |
| Setup (d) install the server, (d2) claim (B3, B4) | no | D2 + D3 (then D4) | `fresh` + one `curl` (below) |
| Setup (e) Mapbox, (f) USGS, (g) Analytics and crashes, (h) old photos (B5–B8) | no (need the server) | D3 | `fresh` (fake tokens) or seeded green |
| Daily admin flows (C: photos, places, layers, settings, history, admins, jobs, crashes, dashboard) | no | D3 + D4 + Setup (e) | yes (seeded city) |
| M3 imagery (M: search, import, georeferencer, approve, publish, guards) | no | D3 + D4 + D5 + Setup (e), (f), M2M approved | yes (stand-in pipeline, fake MTS) |
| M4 buying a scan (O: order card, I ordered it, the daily watch, reminders, the import on delivery) | no | as M3, then your first real purchase in EarthExplorer (30 USD a frame + 5 USD an order, yours to pay) | yes (a frame to buy, one ordered; the delivery by a `curl`) |
| M4 suggested pairs, title suggestions, Romanian and English drafts (S) | no | as M3; the drafts after D8 turns on Vertex AI (the paid EEA tier, under 0.05 USD a month) | yes (fake Nominatim and Vertex AI) |
| M4 notifications (N: inbox, push on a device, per city) | no | D3 + D4; push after D8 turns on FCM | yes (the inbox; push in Chrome with the fake FCM) |
| M5 many cities (T: New city, the city menu, publishing, admins and roles, budgets, isolation) | no | D2 + D3 + D4 (M5's rules and functions); a city's public site after R9 and D7 | yes (Iași seeded; every city's page at `127.0.0.1:4310/<city>/`) |
| M5 the static export (X) | no | D3 + D4 + D8 (the export's lifecycle rule and signing binding, CR-M5-8) | yes, to the downloaded zip; booting it is LIVE |
| M5 the starter kit, `create-historic-city` (K) | no | R1 + R6 + R7 (the kit), R8 (npm) | the kit's page before the release; the CLI built in the image |
| Public viewer's swipe compare (V11), many cities on one Pages site (V12) | no | D7 (V12 also R3) | yes |
| Public viewer (V) | old site on Pages | D7 (Pages go-live; see V0) | yes (emulators' manifest) |

## Every ask-first command

Each row needs your yes for that row, one at a time; nothing here runs on another row's yes. The commands are exact; their blocks, checks and order follow below (D1–D8, then R1–R9), and [research/M5-status.md](research/M5-status.md) §3 says why each release step exists. Builds run in the quality image (`docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local bash -c 'mkdir -p $HOME && <command>'`); a deploy, a push and a publish run on the host with your own login.

| Id | What it changes | The command (or the place) | Who runs it | After |
| --- | --- | --- | --- | --- |
| D1 | the admin on Hosting, start-up mode | `npm run build:admin` (image, with `-e HCM_ADMIN_START_UP=1`), then `npx -y firebase-tools@15.33.0 deploy --only hosting --project bucurestiul-disparut --config firebase.deploy.json` | you, or Claude after your yes | nothing |
| D2 | Firestore rules and indexes, Storage rules (per city) | `npx -y firebase-tools@15.33.0 deploy --only firestore,storage --project bucurestiul-disparut` | as D1 | B1, B2 |
| D3 | the 68 functions | `npm run build --workspace @hcm/functions` (image), then `npx -y firebase-tools@15.33.0 deploy --only functions --project bucurestiul-disparut --config firebase.deploy.json` | as D1 | D2 |
| D4 | the admin on Hosting, normal mode | D1 without `HCM_ADMIN_START_UP=1` | as D1 | D3 |
| D5 | the raster pipeline's image and its two Cloud Run Jobs | the `gcloud` block of D5 | you (the Google Cloud CLI is yours to install) | D3, B2 |
| D6 | nothing in the cloud: one real USGS frame through the real pipeline, on this machine | the opt-in `real-data` run | Claude after your yes (it downloads a real frame) | B6 |
| D7 | the public site: GitHub Pages from `master` (the repository variables that turn the deploys on) | `gh variable set ...` (the seven of D7) | Claude after your yes for each (you paste the token) | R2; before R5's merge |
| D8 | Provision again: Vertex AI and FCM (M4), the export's lifecycle rule on `exports/` and `fn-admin@`'s signing binding (M5, CR-M5-8) | Setup → **Pregătește proiectul** (Prepare the project), with Google's consent | you, in the live admin | D3, D4 |
| R1 | `.editorconfig`'s exception for the committed engine (a relaxation), then the release's local files | append the block of R1; then `npm run build --workspace @hcm/engine && npm run release:cdn`, `npm run release:pin-kit`, `npm run release:notes -- --write docs/releases/v1.0.0_github_description.md` (image) | the edit yours; the rest Claude | nothing |
| R2 | the commit, then `all` | `git add -A && git commit`, then `bash scripts/ci/e2e-split.sh` | Claude after your yes for the commit | R1 |
| R3 | the Pages tree: every city's site (a workflow edit) | `.github/workflows/ci.yml`, step "Upload the GitHub Pages artifact": `path: dist/site/bucharest` → `path: dist/pages` | Claude after your yes | nothing |
| R4 | nothing: two probes before the merge | open `https://cdn.jsdelivr.net/gh/ventura8/bucurestiuldisparut.github.io@legacy-2022/README.md`; `npm view create-historic-city` | you (your browser, your terminal) | nothing |
| R5 | the branch on GitHub, then `master`: the go-live | `git push origin feat/engine-rewrite`, `gh pr create --base master --head feat/engine-rewrite --title "feat: M5 multi-city and engine v1.0.0"`, the Copilot review once, the merge | Claude after your yes for each | R2 green, R4, D7 |
| R6 | the first tag: CI's GitHub Release, jsDelivr's engine | `git tag -a v1.0.0 -m "v1.0.0"`, `git push origin v1.0.0` | Claude after your yes | R5, `all` green on `master` |
| R7 | the starter kit's template repository | `gh repo create ventura8/historic-city-map-starter --public`, its first commit (a copy of `templates/starter-kit/`), `gh api -X PATCH repos/ventura8/historic-city-map-starter -F is_template=true` | Claude after your yes for each | R6 |
| R8 | `create-historic-city` on npm | `npm login`, `npm publish reports/release/create-historic-city-1.0.0.tgz --access public` | you, in your terminal (your account and its two-factor code) | R6, the licence (§61e) |
| R9 | a city's public site (one per city made in the admin) | `npm run site:add -- --city <id> --name-ro "<name>" --theme "#rrggbb"` (image), `git add sites/<id> && git commit`, `git push` | Claude after your yes for the commit and the push | T3, then D7 with R3 |

## The deploys and their commands (each ask first)

Every deploy needs your yes for that deploy, a clean tree on a commit whose default stage is green (`bash scripts/ci/e2e-split.sh`; the audit bumps of [research/DECISIONS-for-review.md](research/DECISIONS-for-review.md) §48a and §49i were applied on 2026-10-25, §64), and your own `npx -y firebase-tools@15.33.0 login` in your terminal. Builds run in the quality image; the deploy itself runs on the host with your login, from a temporary copy of `firebase.json` without its `predeploy` steps (the host's Node 22 and npm 9 do not build this repository). Every command names the project.

The temporary configuration `firebase.deploy.json` (`firebase.json` without its two `predeploy` steps; same folder, so every path in it still resolves), written in the image after the build and deleted after the deploy:

```bash
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:$PWD" -w "$PWD" hcm-quality:local node -e "const f=require('fs');const c=JSON.parse(f.readFileSync('firebase.json','utf8'));delete c.hosting.predeploy;c.functions.forEach((x)=>delete x.predeploy);f.writeFileSync('firebase.deploy.json',JSON.stringify(c,null,4))"
```

### D1. The admin on Hosting, start-up mode (now, before billing)

Ships the current admin (the English title, the M3 provisioner items) while the map has no server; replaces the `8f4e43d` page.

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -e HCM_ADMIN_START_UP=1 -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npm run build:admin'      # packages/admin/dist with runtime.json {startUp: true}
# then the temporary configuration (above), and:
npx -y firebase-tools@15.33.0 deploy --only hosting --project bucurestiul-disparut --config firebase.deploy.json
rm firebase.deploy.json
```

Check: `https://bucurestiul-disparut.web.app/runtime.json` says `"release": "1.0.0+<short commit>"` and `"startUp": true`; the console shows no error before sign-in.

### D2. Firestore rules and indexes, Storage rules (after Setup b and c)

```bash
npx -y firebase-tools@15.33.0 deploy --only firestore,storage --project bucurestiul-disparut
```

Updates the rules and indexes of the existing `(default)` database in `nam5` (the city-scoped History indexes of §45 included); never creates a database.

### D3. The functions (after D2)

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npm run build --workspace @hcm/functions'   # functions/dist, its lock and .env.<project>
# then the temporary configuration (above), and:
npx -y firebase-tools@15.33.0 deploy --only functions --project bucurestiul-disparut --config firebase.deploy.json
rm firebase.deploy.json
```

Check: Setup (d) shows **68 din 68 funcții instalate** (68 of 68 functions installed, M5 included) and turns green by itself; the claim (d2) follows; **Verifică din nou** (Check again) lists every server check green.

### D4. The admin on Hosting, normal mode (after D3)

As D1 without `-e HCM_ADMIN_START_UP=1`. Check: `runtime.json` has no `startUp`; a fresh browser probes the server.

### D5. The raster pipeline's image and its two Cloud Run Jobs (after D3 and Provision cloud; before the first LIVE import)

Needs the Google Cloud CLI on your machine with your own `gcloud auth login` (installing it is a download: ask first), or the CI job `deploy-pipeline-image` once `DEPLOY_ENABLED` is set (D7), which pushes the image; the job definitions are these `gcloud run jobs deploy` either way.

```bash
P=bucurestiul-disparut; R=us-central1; IMAGE="$R-docker.pkg.dev/$P/hcm/pipeline:$(git rev-parse --short HEAD)"
gcloud artifacts repositories create hcm --repository-format=docker --location="$R" --project="$P"   # once, if missing
gcloud auth configure-docker "$R-docker.pkg.dev"                                                     # once: your Docker config
docker build -f pipeline/Dockerfile --target runtime -t "$IMAGE" pipeline
docker push "$IMAGE"
DIGEST="$(gcloud artifacts docker images describe "$IMAGE" --format='value(image_summary.digest)')"
for spec in "raster-pipeline 4 16Gi" "raster-pipeline-xl 8 32Gi"; do
  read -r job cpu memory <<<"$spec"
  gcloud run jobs deploy "$job" --project="$P" --region="$R" --image="$R-docker.pkg.dev/$P/hcm/pipeline@$DIGEST" \
    --service-account="job-raster@$P.iam.gserviceaccount.com" --cpu="$cpu" --memory="$memory" \
    --task-timeout=6h --max-retries=0 --tasks=1 --args=run \
    --set-env-vars="GOOGLE_CLOUD_PROJECT=$P,HCM_PRIVATE_BUCKET=$P.firebasestorage.app,HCM_PUBLIC_BUCKET=$P-public"
done
```

Check: **Verifică din nou** in Setup shows the Cloud Run check green; `gcloud run jobs list --project="$P" --region="$R"` lists both jobs on the image's digest.

### D6. Optional: the `real-data` run (ask first, local only)

One free Bucharest frame end to end with the real pipeline, to measure its checkpoint RMSE and settle what [research/M3-interfaces.md](research/M3-interfaces.md) §14 marks UNVERIFIED ([research/M3-status.md](research/M3-status.md) §3.6).

### D7. The public site on GitHub Pages (the go-live)

Replaces the old site on `master`. In order, each with your yes:

```bash
gh variable set MAPBOX_PUBLIC_TOKEN      # you paste the viewer's URL-restricted pk. token (Setup e minted it for https://ventura8.github.io)
gh variable set GCP_PROJECT_ID --body bucurestiul-disparut
gh variable set GCP_REGION --body us-central1
gh variable set GCP_WIF_PROVIDER         # the provider Provision cloud created (the card Instalarea serverului hărții lists the values)
gh variable set GCP_DEPLOY_SA            # gh-deployer@bucurestiul-disparut.iam.gserviceaccount.com
gh variable set DEPLOY_ENABLED --body true   # turns on deploy-pages, deploy-firebase and deploy-pipeline-image on master
gh variable set HCM_PUBLIC_BUCKET --body bucurestiul-disparut-public   # once the admin published the city's manifest; with DECISIONS §55e's ci.yml line (ask first)
gh pr create --base master --head feat/engine-rewrite   # R5: then the review, the Copilot review, the merge (ask first)
```

The push to `master` runs CI; `deploy-pages` publishes `dist/site/bucharest`, or, with DECISIONS §62g's one `ci.yml` line (ask first), the whole Pages tree `dist/pages` (Bucharest at the root, every other city committed under `sites/` at `/<city>/`). If Pages is not yet set to GitHub Actions in the repository's settings, that setting is one more yes.

### D8. Provision again (after D3 and D4; before S3, N2 and X1 LIVE)

Not a command: Setup → **Pregătește proiectul** (Prepare the project) in the live admin, with Google's consent for Google Cloud (yours). It adds what M4 and M5 need to a project provisioned before them: Vertex AI (`aiplatform.googleapis.com`, the custom role `hcmVertexDrafts` with `aiplatform.endpoints.predict` only) and FCM for the assists and push ([research/M4-status.md](research/M4-status.md) §3.1), and the private bucket's lifecycle rule on `exports/` and `fn-admin@`'s signing binding on itself, which `export.download` needs (CR-M5-8; UNVERIFIED until then). Check: every item green; **Verifică din nou** lists the `ai` check green (a free `countTokens`).

## The release, the kit's repository and npm (R1–R9, each ask first)

The M5 release v1.0.0 is prepared and not tagged ([research/M5-status.md](research/M5-status.md) §3; the rules: [releases/README.md](releases/README.md), `.agents/skills/prepare-release/SKILL.md`). In order:

- **R1.** The committed engine's EditorConfig exception (CR-M5-14, DECISIONS §59c: a relaxation, so yours), appended to `.editorconfig`:

  ```ini
  # The released engine (cdn/engine/, docs/research/M5-interfaces.md §2.3): minified third-party code committed byte for
  # byte as jsDelivr serves it, where a template literal of lit-html holds a space and a tab before a line break.
  [cdn/engine/*.{js,mjs}]
  trim_trailing_whitespace = false
  ```

  Then, in the image (no download, no network): `npm run build --workspace @hcm/engine && npm run release:cdn`, `npm run release:pin-kit` (the kit's engine block gets its real digests: K1 changes), `npm run release:notes -- --write docs/releases/v1.0.0_github_description.md`, and `python3 scripts/ci/check_release.py --tag v1.0.0` (all but the tag itself, which exists only after R6).
- **R2.** The commit (`git add -A && git commit`, a Conventional Commit with the `Co-Authored-By` trailer), then `bash scripts/ci/e2e-split.sh` (stage `all` split with the NUC, about 100 minutes with its tour matrix). The pre-push hook checks `reports/pipeline/green-all.json` on the commit itself.
- **R3.** The Pages tree (DECISIONS §62g, a workflow edit): in `.github/workflows/ci.yml`, step "Upload the GitHub Pages artifact", `path: dist/site/bucharest` becomes `path: dist/pages`. With only Bucharest's site both trees serve the same files.
- **R4.** Two probes, yours: open `https://cdn.jsdelivr.net/gh/ventura8/bucurestiuldisparut.github.io@legacy-2022/README.md` once in your browser (if jsDelivr refuses the repository, the release needs one of §58g's alternatives before the tag), and `npm view create-historic-city` in your terminal (a 404 means the name is free; DECISIONS §65e: publish 1.0.0 at R8, reserve the name, or move the guides to a scope you own before the merge).
- **R5.** The push, the pull request and the merge, after D7's repository variables:

  ```bash
  git push origin feat/engine-rewrite
  gh pr create --base master --head feat/engine-rewrite --title "feat: M5 multi-city and engine v1.0.0"
  # then its review (the Copilot review once, at Balanced effort), CI green, and the merge into master
  ```

- **R6.** The first tag, on the merged `master` commit once `all` is green there: `git tag -a v1.0.0 -m "v1.0.0"` and `git push origin v1.0.0`. CI's `release.yml` checks the tag, every version, `cdn/engine/` (rebuilt byte for byte), the kit's pins and both notes, then creates the GitHub Release.
- **R7.** The starter kit's template repository (§58e), after R6:

  ```bash
  gh repo create ventura8/historic-city-map-starter --public
  # push a copy of templates/starter-kit/ (index.html, city.json, README.md) as its first commit, then:
  gh api -X PATCH repos/ventura8/historic-city-map-starter -F is_template=true
  ```

- **R8.** `create-historic-city` on npm (§58f, §61e), after you choose its licence (today `UNLICENSED`), in your own terminal: `npm view create-historic-city`, `npm login` (your account and its two-factor code), `npm publish reports/release/create-historic-city-1.0.0.tgz --access public` (the tarball of `PIPELINE_STAGE=release`: its `self-host-bundle` gate, then `release-pack`).
- **R9.** A city's public site, for each city made in the admin and published (T3): in the image `npm run site:add -- --city <id> --name-ro "<name>" --theme "#rrggbb"`, then `git add sites/<id> && git commit` and `git push` with your yes ([SETUP.md](SETUP.md) → *A city's public site and the GitHub Pages tree*). With R3 and D7, `https://ventura8.github.io/<id>/` serves it.

## The live admin: start-up page and Google sign-in (A)

- [ ] **A1. The start-up page boots clean.** LIVE now (D1 first to test the current code). Open `https://bucurestiul-disparut.web.app` in a fresh profile. Expected: the sign-in panel with **Conectează-te cu Google**, the note that the map has no server yet; the console shows the boot line with `startUp: true` and no error (no CORS error, no request to a function).
- [ ] **A2. The tab's title follows the language.** LIVE after D1 (LOCAL now). An English Chrome: the tab says **Map administration** and the page is English; a Romanian or German one: **Administrarea hărții**, Romanian. The account menu's **Română** / **English** switches title and text at once.
- [ ] **A3. The owner signs in and Google checks the ownership.** LIVE now. Human: **Conectează-te cu Google**, choose the account that owns `bucurestiul-disparut`, allow the read-only Google Cloud access (one consent; if Google says the app is unverified: Advanced, then continue to the domain, as the panel explains). Expected: the start-up banner **Mod de pornire: harta nu are încă server...**, the Setup Assistant open at **Facturare Google Cloud și buget** (Google Cloud billing and budget). LOCAL: `HCM_STACK_SEED=fresh`, Allow as `owner@e2e.test`, the same screen.
- [ ] **A4. Another Google account is refused.** LIVE now (a second Google account of yours), LOCAL `fresh` as `stranger@e2e.test`. Expected: **Doar proprietarul proiectului Google Cloud bucurestiul-disparut poate configura harta.** and **Folosește alt cont Google** (Use another Google account); nothing is written.
- [ ] **A5. Cancelling the consent changes nothing.** LIVE and LOCAL. Close Google's window (LOCAL: **Cancel** in the stand-in). Expected: **Fereastra Google s-a închis înainte de final. Nu s-a schimbat nimic.**

## The Setup Assistant, in order (B)

Each card says why, what it costs and what it needs from you. The whole assistant asks at most 9 inputs and 4 Google consents. LOCAL rehearsal of B1–B8: `HCM_STACK_SEED=fresh npm run dev:stack` (a new map against the fake Google, Mapbox and USGS; the fake test values are in `packages/test-support/src/fakes/mapbox-state.ts` → `MAPBOX_TOKENS.bootstrap` and `packages/test-support/src/fakes/usgs.ts` → `USGS_CREDENTIALS.approved`).

- [ ] **B1. (b) Billing and the 5 USD budget.** LIVE after D1. Human: if you have no billing account, create one on Google's page (your card); then **Leagă facturarea și creează bugetul de 5 USD** and allow the billing consent. The app links the account (Blaze) and creates the budget. Expected: **Planul Blaze este activ; bugetul este de 5 USD pe lună.**; no deploy needed.
- [ ] **B2. (c) Provision cloud.** LIVE after B1. **Pregătește proiectul** (Prepare the project), allow the Google Cloud consent. The app creates the 15 items one by one (APIs, service accounts, IAM, buckets with CORS and the lifecycle, secret slots, task queues, Workload Identity for GitHub, App Check, budget alerts, organisation policies, crash alerts, the browser key; the scheduler waits for the server). Expected: **{done} din 15 elemente gata**, every item green except the scheduler (**Se creează la prima instalare a serverului.**); an organisation policy or a missing role is named with its fix, and **Reia ce nu a reușit** (Retry what failed) retries only those. A project provisioned before M4 and M5 runs it once more (D8).
- [ ] **B3. (d) Install the server.** LIVE: **ask first D2, then D3**. The card **Instalarea serverului hărții** watches every 30 seconds. Expected: **68 din 68 funcții instalate** (M4 added the orders', the assists' and the notifications' functions; M5 `cities-create`, `cities-locate`, `cities-setLimits`, `admins-setRole`, `export-start`, `export-download` and `export-build`), green by itself. LOCAL `fresh`: the server already runs; make the fake list it installed with `curl -X POST 'http://127.0.0.1:4311/__upstream/scenario?test=' -H 'content-type: application/json' -d '{"name":"google.deployed"}'`.
- [ ] **B4. (d2) The claim, without a click.** LIVE after B3. Expected: **Preluarea hărții** green, you are the owner (Admins lists you as owner), the city `bucharest` exists; then **ask first D4** (normal mode).
- [ ] **B5. (e) Mapbox.** LIVE after B4. Human: create the Mapbox account, leave the demo plan (card, billing address), tick the usage alerts, create the secret token `historic-map-server` with the scopes the card lists (**Copiază permisiunile**), paste it into **Tokenul secret (sk.…)**. The app saves it on paste into Secret Manager, checks its scopes and mints the URL-restricted public tokens (the viewer's for `https://ventura8.github.io`, the admin's). Expected: **Salvat pentru contul Mapbox {user}.**; the admin maps draw (Settings, a layer). Bad paths: a `pk.` token or one without the scopes is refused with what to fix.
- [ ] **B6. (f) USGS.** LIVE after B4. Human: register on ERS, request M2M access with the card's text, wait for USGS (24–48 business hours); then type **Numele de utilizator ERS**, **Deschide pagina tokenului USGS**, paste the token within the countdown (**Lipește tokenul în {seconds} s**). The app checks the M2M role every 6 hours (ops.tick) and turns the card green when downloads are approved. Expected: green with the download role.
- [ ] **B7. (g) Analytics and crash reports** (optional). LIVE after B4. Human: enable Google Analytics in the Firebase console (Google's terms). Then **Nu mai număra schimbările de adresă ca vizualizări** (one click, the Analytics consent); **Trimite-mi un e-mail la erori noi**. Expected: the measurement id shown, the stream setting off; the Crashes page lists groups (LOCAL seeded: two).
- [ ] **B8. (h) The old Bucharest photos** (optional). LIVE after B5. **Importă fotografiile (45)**. Expected: **Fotografii importate: {done} din 45**, then **Toate fotografiile sunt pe hartă (45).**; each needs its rights checked in Photos (**Drepturi de verificat**). LOCAL seeded: 12 of the 45 are already in, so the import resumes with the other 33.
- [ ] **B9. Server checks.** LIVE after D3 (and D5 for Cloud Run). **Verifică din nou** (Check again). Expected: **Verificările serverului** all green (Firestore, Secret Manager, Mapbox tokens, the USGS account, Cloud Run); a failing check names its step (**Deschide pasul „{step}”**).
- [ ] **B10. Bucharest's target years** (CR-M3-28). LIVE after B4. Settings → **Imagini istorice**: add 1966, 1976, 1977, 1978, 1980, save. Expected: the Imagery area ranks those frames first.

## The daily admin flows (C)

LOCAL now (seeded city; maps in Chrome); LIVE after D3, D4 and B5. Every page is the current city's (T2). Each save shows **Salvat de {who} la {date}.** and a publishing note (**Harta publică se actualizează în aproximativ un minut.**); the viewer (V) then shows the change.

- [ ] **C1. Dashboard (Acasă).** Expected: **Harta ta** (Your map) counts **Fotografii, Locuri, Categorii de locuri, Straturi istorice**; **Te așteaptă** (Waiting for you): **Fotografii de verificat pentru drepturi, Fotografii nepublicate, Procesări eșuate, Imagini istorice de aprobat, Scanări care așteaptă puncte de georeferențiere** (LOCAL: one failed job, one image to approve, one scan waiting for points); **Numără din nou** (Count again) counts again; each count opens its list.
- [ ] **C2. Photos: list, filters, bulk.** **Fotografii**: the filters **Toate, Publicate, Nepublicate, În procesare, Drepturi de verificat**; select several, **Publică** / **Retrage de pe hartă** / **Confirmă drepturile** / **Autor, sursă și licență** / **Șterge** (with Undo; restored from History's **Șterse**). Expected: the counts in each result line; the failed upload ("Scanare ilizibilă") shows its reason.
- [ ] **C3. Photos: upload and editor.** **Adaugă fotografii** with a JPEG with GPS EXIF, a HEIC, a PDF renamed `.jpg`. Expected: the JPEG goes **Se încarcă**, **Se procesează**, **Gata** with its place suggested from EXIF; the other two are refused with why; the editor (title RO/EN, year, author, license, place on the map, bearing) saves and **Publicată pe harta publică** publishes; Replace keeps the published image until the new one is processed.
- [ ] **C4. Places with drawing.** **Locuri** → **Adaugă loc** → **Ce formă are locul?** **Punct / Linie / Suprafață**; draw on the map (**Desenează**, **Selectează și mută**, **Adaugă în centru**, **Șterge ultimul punct**), drag a vertex, a midpoint; the Markdown preview of the description; **Importă GeoJSON** and **Exportă toate (GeoJSON)**. Bad paths: a point outside the city, a self-crossing area, more than 500 points are refused with the reason. LOCAL: "Cartierul Uranus" (an area), "Strada Mihai Vodă" (a line), "Ateneul Român" (a draft).
- [ ] **C5. Layers: order, opacity, adjustments, link.** **Straturi**: **Mută mai sus / mai jos**; open a layer: **Opacitate implicită**, **Afișat la deschiderea hărții**, **Nivel de negru, Nivel de alb, Contrast, Saturație** (keyboard and mouse; the levels never cross), the admin map previews each change live; **Salvează**. **Leagă un strat**: a tileset of another account is refused before anything is sent; an XYZ address with **Verifică** asks one tile and says what answered. Expected: the viewer shows the saved opacity and adjustments (V5).
- [ ] **C6. Settings.** **Setări**: **Zona orașului** (draw the rectangle, **Folosește vederea hărții**), **Texte** (About, privacy), **Temă și hartă de bază** (**Culoarea orașului** previews live), **Imagini istorice** (auto-publish, threshold, target years), **Categorii de locuri** (**Adaugă o categorie**, its icon guessed from the label, order), **Opacități implicite**. Expected: each saves and History records it.
- [ ] **C7. History and revert.** **Istoric**: the recent changes of this city, filtered by what (**Orice, Setările orașului, Straturi, Fotografii, Locuri, Categorii de locuri**); a document's **Versiuni**, compare, **Readu această versiune** (Bring this version back), a deleted one **Restaurează**. LOCAL: "Biserica Enei" has an update to revert.
- [ ] **C8. Admins.** **Administratori**: invite an address (**Invită**, the role **Editor** unless changed; the link is yours to send); the invited account signs in and sees **Ai o invitație să administrezi harta** → **Alătură-te**; **Retrage accesul** (asked first; **Păstrează accesul** keeps it). A removed admin with unsaved changes keeps the page read-only under the banner. LOCAL: sign in as `editor@e2e.test` to join, as `admin@e2e.test` to be revoked (an editor of București only; the roles per city are T4).
- [ ] **C9. Jobs (Procesări).** The list (running, failed, done), a job's steps by name, its log; **Anulează procesarea** (asked first), **Rulează din nou** on a failed job. LOCAL: the import failed at warp.
- [ ] **C10. Crashes (Erori).** The groups (**De câte ori**, last seen), a group's details, **Perioada**. LOCAL: two groups of the fake Error Reporting (the page may ask Google's consent first: the stand-in).
- [ ] **C11. Account menu.** **Contul și preferințele**: language, theme, the analytics consent of the admin, **Deconectează-te**. Expected: everything follows at once (title, `<html lang>`).
- [ ] **C12. Phone and tablet.** Repeat C2, C4 and C5 at 360 × 800 and 768 × 1024 (the browser's device toolbar, or `resize_window` in the Claude pane): the navigation bar or rail, the full-screen editor, Esc and Back.

## M3 historical imagery (M)

LOCAL now (the stand-in pipeline and the fake MTS); LIVE after D3, D4, D5, B5, B6 with M2M downloads approved, and B10. The seeded LOCAL world has the harvest, a draft over the threshold, an import waiting for points, a failed import and the published 1980 frame.

- [ ] **M1. Search and ranking.** **Imagini istorice**: the first visit harvests (**Se caută scenele USGS de deasupra orașului…**, then **Am găsit {found} scene, dintre care {added} noi.**); the scenes **cele mai potrivite primele** with a 0–100 score and their reasons in words; the footprints on the map. **Filtre**: **Doar gratuite**, **Ascunde respinsele**, **Din anul / Până în anul**; **Caută din nou la USGS**. LIVE: the real catalogue over Bucharest (the five target frames first after B10).
- [ ] **M2. A scene and its preview.** Open a scene: the browse image (copied into our bucket by the server; the browser never asks USGS), the reasons, **Importă (gratuit)**; a paid frame says it must be ordered (O1).
- [ ] **M3. Import and live progress.** **Importă (gratuit)** (one click). Expected: the version page, its steps advancing live with the log, **Anulează procesarea**; under the threshold the policy publishes it with no other click; the new layer appears in Straturi and in the viewer. LIVE: the first real run (minutes to an hour); LOCAL: seconds, then the fake MTS (about two minutes).
- [ ] **M4. Approve a draft over the threshold.** The version **Gata de publicare** with both errors and the compute units (**Publicarea folosește circa {estimate} unități de calcul Mapbox; luna asta mai sunt {available}.**); **Aprobă și publică** / **Respinge**. LOCAL: the seeded 1966 draft.
- [ ] **M5. The georeferencer when matching fails.** The version waiting for points → **Georeferențiator**: the scan and the reference side by side, **Adaugă perechi** (scan, then map, or the reverse; the keyboard works too), the residual table, both errors, **Afină / Spline în plăci subțiri** with their minimum pairs, pairs on a line refused, **Salvează și georeferențiază**. Expected: **Punctele au fost salvate: procesarea continuă.** LOCAL: the seeded 1976 import. The OpenStreetMap reference image is LIVE only (LOCAL refuses OpenStreetMap tiles, the e2e firewall's rule).
- [ ] **M6. Retry a failed import.** **Rulează din nou**. Expected: it resumes from its failed step and publishes. LOCAL: the seeded 1977 import (its second attempt is scripted to succeed).
- [ ] **M7. The compute-unit guard.** A publish over the month's compute units waits with three ways out: **Gratuit: încarcă fișierul în Mapbox Studio** (1. Descarcă fișierul, 2. Deschide Mapbox Studio..., 3. L-am încărcat), **Așteaptă luna viitoare**, **Publică acum, cu un cost de circa {usd} USD**. LOCAL: make the next run warp 1000 km² with `curl -X POST 'http://127.0.0.1:4311/__imagery/script?city=bucharest' -H 'content-type: application/json' -d '{"attempts":[{"outcome":"under","areaKm2":1000}]}'`, import the free 1968 frame, then set it back with `-d '{"attempts":[{"outcome":"under"}]}'`. LIVE: only when a real month runs short (watch the estimate on M4).
- [ ] **M8. The budget pause.** When the month's Google Cloud cost reaches the budget, Imagery and Jobs say **Procesare oprită: Google Cloud a costat luna aceasta {cost} din {budget}. Harta publică merge.**, Import is refused with why, and **Reia procesarea** (asked first) resumes. LOCAL: write the alert's result with `curl -X PATCH 'http://127.0.0.1:8080/v1/projects/demo-hcm/databases/(default)/documents/ops/guard' -H 'authorization: Bearer owner' -H 'content-type: application/json' -d '{"fields":{"state":{"stringValue":"red"},"reason":{"stringValue":"budget"},"spend":{"mapValue":{"fields":{"costAmount":{"doubleValue":5.37},"budgetAmount":{"doubleValue":5},"currency":{"stringValue":"USD"},"interval":{"stringValue":"2026-10-01T07:00:00Z"}}}},"updatedBy":{"stringValue":"system:ops"},"updatedAt":{"timestampValue":"2026-10-24T09:00:00Z"}}}'`. LIVE: not to be provoked (it is a real cost); its rehearsal is LOCAL.
- [ ] **M9. Crop and Replace.** A published layer's editor: **Decupează** (draw the area to keep on the map, **Salvează decuparea**; a crop off the layer is refused), **Înlocuiește imaginea** (**Încarcă un GeoTIFF**: a TIFF with its own georeference goes to Approve, a plain scan to the georeferencer; not a TIFF is refused). Expected: the layer keeps its tiles until the new version is published; the viewer's tiles end at the crop. LOCAL: the published 1980 frame.
- [ ] **M10. Upload a GeoTIFF as a new layer.** **Încarcă un GeoTIFF**, **Anul imaginii** when the name does not say it, **Încarcă**; progress, **Oprește încărcarea**, resume after a dropped connection. Expected: its own job and version (M4 or M5).

## M4 automation: buying a scan (O), suggestions and assists (S), notifications (N)

LOCAL now (the seeded city: the 1968 Corona frame `DS1105-1071DF076` to buy, the Declass 3 frame `D3C1209-100055F012` marked as ordered, the 1976 import waiting for points with the matcher's suggestions, and the inbox items of the failed import, the draft over the threshold and the version waiting for points); LIVE after D3, D4, D5, B5, B6 with M2M downloads approved, and D8 for the drafts and push (Provision turns on Vertex AI and FCM). Nothing here pays: the purchase itself is yours, in EarthExplorer. The e2e rows: `S-A13-*` (orders), `S-A44-*` (pairs), `S-A45-*` (assists), `S-A46-*`, `S-A47-*` (notifications), `S-A48-*` (the journey), S-A51-HAPPY-INBOX (per city).

- [ ] **O1. The order card.** **Imagini istorice** → **Doar gratuite** off → the 1968 frame. Expected: **Cumpără această scanare**, **Trebuie comandat de la USGS**, **Cost: 35 USD (1 × 30 USD pe cadru + 5 USD pe comandă), plătit direct la USGS**, the four EarthExplorer steps, **Comandă în EarthExplorer** opening `https://earthexplorer.usgs.gov/scene/metadata/full/5e839febdccb64b3/DS1105-1071DF076/` in a new tab, **Am comandat**. LIVE: the link opens the real scene page (no purchase unless you decide to buy). LOCAL: check the link's address without following it (a followed link leaves the stack: *How to use it*).
- [ ] **O2. I ordered it, Undo and Take the mark back.** **Am comandat**. Expected: **Comandat: verificăm zilnic livrarea** with **Comandat la**, **Următoarea verificare**, **Verifică acum** and **Retrage marcajul** (also in the snackbar); **Retrage marcajul** brings the buy card back. A free frame cannot be marked: **Cadrul este deja scanat: importă-l gratuit, fără comandă.** LIVE: only after a real purchase (marking without buying makes the watch ask USGS daily for 90 days, harmlessly).
- [ ] **O3. Delivery, the watch and the automatic import.** LOCAL: make the fake USGS deliver with `curl -X POST 'http://127.0.0.1:4311/__upstream/scenario?test=' -H 'content-type: application/json' -d '{"name":"usgs.ordersDelivered"}'`, then **Verifică acum** on the ordered Declass 3 frame (the daily watch is `imagery.tick`; the stack's scheduler runs it every five minutes, due once a day). Expected: **Livrat: importul pornește**, then **Se importă** with **Deschide importul**; the import runs as M3 under the threshold and publishes with no click; **Notificări** gets **USGS a livrat scanarea …: importul a pornit.** and then **Scanarea … a fost importată.** LIVE: three to four weeks after you pay; nothing to click.
- [ ] **O4. Reminders and an order never delivered.** LIVE only by time (days 7 and 12; day 90). Expected: **Comandat: ai plătit? USGS șterge comenzile neplătite după 14 zile** and the inbox's reminder, with the note that if you paid there is nothing to do; after 90 days **Nelivrat** with **Comandă din nou** and **Retrage marcajul**. Before USGS approves your downloads both cards say the daily check waits for it (**Următoarea verificare: după ce USGS aprobă descărcările**). Its rehearsal is the e2e rows S-A13-BAD-NEVER-DELIVERED, S-A13-BAD-EXPIRED and S-A13-BAD-WAITS-FOR-APPROVAL (seeded states).
- [ ] **O5. Work lists the orders.** **De lucru**: **Comenzi**, the one that needs you first (an order never delivered), counted in the tab; a reminder is listed but not counted.
- [ ] **S1. Suggested pairs (the georeferencing points).** The 1976 import waiting for points → **Georeferențiator**: **Perechi sugerate** with **Încredere …** as words and bars and the distance from the fit; **Acceptă** / **Respinge** each (Enter / Delete on a row), **Acceptă toate**; dashed rings on the scan, flags on the map; nothing saved until **Salvează și georeferențiază**. A scan the matcher could not place says so and keeps the manual way (M5). LIVE: the real matcher's suggestions on a real frame (D5).
- [ ] **S2. Title suggestions.** **Locuri** → a place → **Sugerează un titlu** (or draw a new point, or move the pin of a photo still titled after its file, such as `IMG 0412`: it asks by itself). Expected: **Se caută titluri în OpenStreetMap…**, then buttons **Folosește titlul „…”** and **Sugestii din OpenStreetMap (© contribuitorii OpenStreetMap, ODbL)**; the title changes only on a choice, Save writes it. Bad path: a second ask within the cool-down after OpenStreetMap's 429 says **Sugestiile OpenStreetMap nu sunt disponibile acum. …** (LOCAL: `curl -X POST 'http://127.0.0.1:4311/__upstream/fail?test=' -H 'content-type: application/json' -d '{"service":"nominatim","mode":"rateLimited"}'`, and `"mode":null` to clear it). LIVE: the real Nominatim (1 request a second for the project, cached 90 days; each city's own daily share, T5).
- [ ] **S3. Romanian and English drafts.** A photo, a place or a layer: **Ciornă în engleză** beside a Romanian text whose English side is empty (with both sides filled no draft is offered). Expected: **Se scrie ciorna…**, then the English field filled with **Ciornă propusă de …: verific-o înainte să salvezi.**; nothing is published until **Salvează**; HTML in the source comes back as plain text. LIVE after D8 (Vertex AI on, the paid tier; at most 500 drafts or 0.50 USD a month, and each city's share, T5). LOCAL: the fake Vertex AI answers.
- [ ] **N1. The inbox.** **Notificări** (with the unread count in the navigation's name): the seeded items, newest first; a click opens its city's page and marks it read; **Marchează toate ca citite**. An empty inbox (`editor@e2e.test` after joining) says **Nicio notificare deocamdată.**
- [ ] **N2. Push on this device.** **Notificări pe acest dispozitiv** → the browser's prompt → **Notificările sunt pornite pe acest dispozitiv.**; **Trimite o notificare de probă**; **Notificări pe dispozitive** chooses the kinds. A refused prompt: **Browserul a refuzat notificările …**, the inbox still works. LIVE after D8 and D4 (FCM's `message.fid` UNVERIFIED until this first test: DECISIONS §54c). LOCAL: Chrome, the fake FCM.
- [ ] **N3. A city's events reach only its admins** (M5). LOCAL: sign in as `admin@e2e.test` (an editor of București only): the inbox lists București's seeded items and nothing of Iași; then, as the owner, make an event in Iași (M10's GeoTIFF upload in Iași with the stand-in runner scripted over the threshold for it: `curl -X POST 'http://127.0.0.1:4311/__imagery/script?city=iasi' -H 'content-type: application/json' -d '{"attempts":[{"outcome":"over"}]}'`): the owner's inbox gets the draft waiting for Approve, linking `#/c/iasi/...`; `admin@e2e.test`'s does not until T4 makes them an admin of Iași. An event without a city (the budget pause, M8) reaches every admin. LIVE: the same once a second city has admins of its own.

## M5 many cities: New city, the city menu, publishing, admins and roles, budgets (T)

LOCAL now as the project's owner: the stack seeds a second city, **Iași** (`iasi`), made with the server's own `cities.create` and its viewer token, unpublished, with a category and two places (Palatul Culturii, Parcul Copou), the owner's alone; `admin@e2e.test` edits București only. The fake Nominatim finds only **Cluj-Napoca** (and **Cluj**); any other name finds nothing. LIVE after D2, D3 and D4 with M5's functions and rules deployed (ask first). The e2e rows `S-A49-*` to `S-A54-*` rehearse each step on the emulators.

- [ ] **T1. New city.** The city menu → **Oraș nou**: type the name, wait a second (**Găsit pe OpenStreetMap: …**, the rectangle drawn and the map moved there), **Creează orașul** (two inputs). Expected: **Orașul … a fost creat** (the heading takes the focus), **Orașul nu este public încă: îl publici din Setări când e gata.**, the imagery line, the public site's line (R9, or the export), the links to Fotografii, Locuri, Imagini istorice, and the city menu lists the new city at once; within five minutes the first USGS search of its rectangle runs by itself (`imagery.tick`). LOCAL: **Cluj-Napoca** (found: **Cluj-Napoca, Cluj, România**); the stack's clock runs the search within five minutes (`bash scripts/dev/dev-stack.sh tick` runs it now), and the fake catalogue, which has scenes over Bucharest only, finds none there. LIVE: any city, the real Nominatim once per name. Bad paths: **Turda** LOCAL (or any name OpenStreetMap does not know: nothing drawn; drag the rectangle, three inputs; the zoom buttons work); **Iași** LOCAL (the id `iasi` is taken: **Identificatorul iasi este deja folosit de alt oraș. Alege altul, de exemplu …**, with a free one in the field); the id **engine** (said at its field, Create off); edges typed in part (**Completează toate cele patru laturi …**); a rectangle too small or too large keeps **Creează orașul** off with the reason; signed in as `admin@e2e.test` (not the project's owner) there is no **Oraș nou**.
- [ ] **T2. The city menu.** The top bar's city button (the account menu on a phone) lists București and Iași with **Proprietar**; choosing Iași reloads into its Acasă, `#/c/iasi/home` in the address and **Administrarea hărții · Iași** in the tab; **Locuri** lists only Iași's two places, **Fotografii** none; a copied address opens the same city; with an unsaved edit the admin asks first. Signed in as `admin@e2e.test` (one city): no city button, the shell as before M5, and `http://127.0.0.1:4312/#/c/iasi/home` opens București with **Nu administrezi orașul iasi; s-a deschis București.** (LOCAL, checked 2026-10-25: the address became `#/home`, nothing of Iași read). LIVE: the same with București and the city of T1.
- [ ] **T3. Publishing and the city's site.** Iași → **Setări** → **Publicare** → **Orașul este public** → **Salvează** (two inputs). Expected: the note **Vizitatorii văd harta orașului. …**; within a minute the public bucket holds `cities/iasi/manifest.json`. LOCAL: the stack serves every city's page at `http://127.0.0.1:4310/<city>/` (what R9's `site:add` makes, with the Bucharest site's shell, so its tab still says București dispărut): before Save `http://127.0.0.1:4310/iasi/` says **Harta nu a fost găsită. Încearcă din nou mai târziu.**; after it, the map of Iași with its two places and one map (checked 2026-10-25); switched off and saved, not found again. A city made in T1 works the same way (`/cluj-napoca/`). LIVE: R9 for the city's own site, then R3 and D7: `https://ventura8.github.io/<city>/` boots the city with one map.
- [ ] **T4. Admins per city and their roles.** Iași → **Administratori**: **Invită** with `admin@e2e.test` (LIVE: an address of yours) and the role **Editor**; the link is copied. An admin of other cities needs no link: at their next sign-in `admin@e2e.test`'s city menu lists București and Iași, each **Editor**, and București's **Administratori** shows them the list only. As the owner: the role question (**Faci din … Proprietar pentru Iași?**, **Schimbă rolul**); the last owner cannot be made an editor (**Orașul trebuie să rămână cu cel puțin un proprietar.**); inviting an address that already administers the city is refused (**Această persoană administrează deja harta.**). Signed in as an editor of București only (`editor@e2e.test` after joining): Iași is not in their menu.
- [ ] **T5. The city's budget.** Iași → **Setări** → **Bugetul orașului**: the five limits a new city gets (a quarter of the free compute units, three raster jobs a day, 100 drafts a month, 100 title suggestions a day, three exports a day) with what was used; Save as the project's owner. București has no limits: it says the project's caps hold it, and the one limit typed is the only one set. Read-only for a city owner who is not the project's (`admin@e2e.test` after T4 made them **Proprietar** of Iași): **Doar proprietarul proiectului schimbă bugetele orașelor.**
- [ ] **T6. Each city closed to the others.** As `admin@e2e.test` before T4: nothing of Iași anywhere (T2's link, the inbox: N3, History lists București's changes only). The rules and the callables refuse another city's admin (S-A51-BAD-OTHER-CITY-RULES, S-A51-BAD-OTHER-CITY-CALLABLE, S-A54-BAD-OTHER-CITY: their documents, files, export and invitations); the public viewer never reads Firestore, whatever the city. LIVE: the same with a second Google account of yours made an editor of one city only.

## M5 the static export (X)

LOCAL now to the downloaded zip (the stack forwards the signed download to the Storage emulator: nothing leaves the machine); LIVE after D3, D4 and D8 (the export's lifecycle rule and signing binding, CR-M5-8). The e2e rows: `S-A53-*`, `S-V28-*`, S-A54-HAPPY.

- [ ] **X1. Export the city.** București → **Setări** → **Exportă orașul** → **Exportă**, then **Descarcă** (two inputs). Expected: **Se pregătește arhiva…**, then **Arhiva e gata: …; fotografii: …, straturi: ….**, the SHA-256, the line naming the photos licensed for this map only (**… fotografii au permisiune doar pentru această hartă: RIGHTS.md le numește.**), **Se poate descărca până la …**, and `bucharest-<date>.zip`. LOCAL (checked 2026-10-25): **Arhiva e gata: 2,5 MB; fotografii: 10, straturi: 3.** and the zip saved through the stack. LIVE: the 45 legacy photos after B8. Bad paths: Iași before T3 (**Publică orașul înainte să-l exporți.**); signed in as `admin@e2e.test`, an editor of București (**Doar proprietarii orașului îl pot exporta.**); a second **Exportă** while one runs is refused; **Include scanările USGS** adds the USGS layers' files only.
- [ ] **X2. The export on its own.** Unzip it: `index.html`, `engine/`, `city.json` (no analytics ids), the photos, `README.md` and `RIGHTS.md` (LOCAL: look at the files). LIVE: serve the folder with a static server that needs no download (`python3 -m http.server 8000 --bind 127.0.0.1` in it) and open `http://127.0.0.1:8000/`: the city boots with no request to Firebase or Google (DevTools → Network); the basemap needs a Mapbox token that allows that address (the README's step 2: the city's own token allows only `https://ventura8.github.io`; a `pk.` token of yours for the local address is yours to paste into `city.json`). Opened by a double-click (`file://`), the page says the map could not load, with **Reîncearcă**. Not LOCAL: the page loads Mapbox GL JS and the basemap from Mapbox itself, and the stack keeps every request on the machine (S-V28-HAPPY boots it against the mocks).

## M5 the starter kit and create-historic-city (K)

LOCAL now: the kit's page as committed and the CLI built in the quality image with no network ([SETUP.md](SETUP.md) → *The starter kit and create-historic-city*: `npm run build --workspace create-historic-city`); LIVE after R1, R6 and R7 (the kit) and R8 (npm). The e2e rows: `S-V27-*`, `S-V29-*`.

- [ ] **K1. The kit's page.** LOCAL: `http://127.0.0.1:4310/kit/` serves `templates/starter-kit/` as committed. Before R1's `release:pin-kit` its engine block carries placeholder digests, so the engine is refused: **Harta se încarcă.**, then after four seconds the note naming the README's check of the version and the integrity, in Romanian and English (checked 2026-10-25). LIVE after R6 and R7: GitHub's **Use this template** on `ventura8/historic-city-map-starter` gives the three files; with your own `pk.` token in `city.json` (yours to paste) and GitHub Pages on, the copy boots its city with Mapbox GL JS and the engine from jsDelivr at `v1.0.0`, each with its `integrity` (DevTools: no integrity error), one map. With the example's token still in `city.json`, the page says to add your own (S-V27-BAD-PLACEHOLDER-TOKEN).
- [ ] **K2. A new city in three files.** LOCAL, in the image (an interactive run in a throwaway folder of the container):

  ```bash
  docker run --rm -it --network=none -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w /tmp hcm-quality:local \
    bash -c 'mkdir -p $HOME && node '"$PWD"'/packages/create-historic-city/dist/cli.mjs my-city && ls my-city && node '"$PWD"'/packages/create-historic-city/dist/cli.mjs doctor my-city'
  ```

  Expected: it asks the name (Romanian), the rectangle (`vest,sud,est,nord`), the colour and the Mapbox public token (Enter keeps each default), writes `index.html`, `city.json` and `README.md`, and says what is next; `doctor` names the example token and the template's integrity still to replace. `my-city --yes --dry-run` lists the three files with their sizes and writes nothing (checked 2026-10-25). Bad paths: an `sk.` token is refused at the prompt; a folder that is not empty is left alone (**Folderul my-city nu este gol: n-am scris nimic.**). LIVE after R8: `npx create-historic-city@1.0.0 my-city` in your terminal (npm downloads it: yours to run).
- [ ] **K3. The other commands.** LOCAL, as K2: `--help` lists them; `theme my-city --seed "#3D6B8C"` rewrites the colours of `city.json` and `index.html`, and a colour that is no colour changes nothing (**O culoare este # urmat de șase cifre hexazecimale, …**); before R6, `upgrade my-city --dry-run` says this build has no released engine and names `npx create-historic-city@1.0.0 upgrade` (LIVE after R8: it rewrites the engine block, keeping the page's own policy sources). `self-host my-city --project demo-x` refuses without `--experimental` and runs nothing (**self-host și deploy nu sunt gata …**, checked 2026-10-25). LIVE only, in your own terminal and never from Claude: `self-host … --experimental` and `deploy … --experimental` run your own `firebase` and `gcloud` against a real project, a `y/N` per step; the self-hosted admin's Setup waits for CR-M5-7 (DECISIONS §63f), so stop after step 6 ([SELF_HOST.md](SELF_HOST.md)).

## The public viewer (V)

LOCAL now at `http://127.0.0.1:4310/bucharest/` (the manifest the emulators published; maps in Chrome); LIVE after D7. Run each at a phone (360 × 800), a tablet (768 × 1024) and a desktop (1440 × 900), in Romanian and English (`?lang=en` or **Limbă**), light and dark (**Temă: Automată / Luminoasă / Întunecată**).

- [ ] **V0. Which manifest the live site reads.** `sites/bucharest/site.json` says `publicManifest: true` (DECISIONS §55a): a build with `HCM_PUBLIC_BUCKET` set writes a `config.js` that reads `https://storage.googleapis.com/<bucket>/cities/bucharest/manifest.json` (and adds that host to the page's CSP), with no bundled snapshot; without it the site bundles the legacy snapshot as before. For the go-live: the admin publishes the city once, then the repository variable and §55e's one `ci.yml` line (D7, each ask first). LOCAL: the stack's viewer reads the emulators' manifest already.
- [ ] **V1. Boot and one map.** Expected: the map at the city's start view, exactly one map load, no console error; without WebGL the no-WebGL card and the photo list.
- [ ] **V2. Photos.** The photo markers with clusters and view cones; the list (**Lista fotografiilor**); a photo's sheet and the lightbox (**Fotografie mărită**, **{index} din {total}**); the 10 published photos (LOCAL), never the two drafts.
- [ ] **V3. Places.** The categories (**Locuri**), a place's detail sheet with its Markdown text and links, the area and the line drawn.
- [ ] **V4. Timeline.** **Cronologie**: a year shows its photos and layers; **Azi**.
- [ ] **V5. Layers with live opacity and adjustments.** **Straturi**: **Afișează {name}**, **Opacitate: {name}**, the plan of 1911 (green tiles LOCAL), Corona 1968, the 1980 frame; the admin's default opacity, start-up visibility and adjustments (C5) applied.
- [ ] **V6. Deep links and sharing.** The address keeps the view, the year, the open photo; a copied link opens the same view; **Linkul a fost copiat.**
- [ ] **V7. About, credits, privacy, analytics consent.** **Despre**, **Mulțumiri**, **Confidențialitate**; **Statistici anonime**: **Accept** / **Refuz**, **Retrage acordul pentru statistici**; nothing is sent before consent.
- [ ] **V8. Language and theme.** Every text follows **Limbă**; the theme follows the system or the choice; the city's brown theme.
- [ ] **V9. Phone, tablet, desktop.** Sheets, the FAB menu, the layer panel, landscape on a phone; nothing overlaps Mapbox's logo and attribution; Tab reaches every control.
- [ ] **V10. LIVE only: the real basemap and tokens.** After D7: the Mapbox Standard basemap with the URL-restricted token of `https://ventura8.github.io`, the published historical layers' real tiles, the photos from the public bucket.
- [ ] **V11. Swipe compare** (the sizes, languages and themes above). **Straturi** → **Compară**: a second map beside the first (wide windows only), the divider (drag, or Tab to it and the arrow keys; Shift ×10, Home, End), **Compară cu** (another layer or **Azi**), each side's opacity; **Închide comparația** removes the second map. Under 600 px: **Partea afișată** toggles one map; a second map made on a wider window waits hidden for a minute (turning a phone back shows it again without a new map load). The chooser does not offer what the main side shows. A link copied while comparing reopens it (`cmp=`, `sw=`). LOCAL: the published 1980 frame against **Azi** or the 1911 plan.
- [ ] **V12. Many cities on one GitHub Pages site.** LOCAL: the e2e build's Pages tree at `http://127.0.0.1:4310/pages/` (what R3's `dist/pages` holds): Bucharest at its root (its 2015–2022 links still open the same view, as `/pages/#15.5/44.4271/26.0853/90/!a3!p2`), `/pages/e2e-second/` a second city with its own title **Al doilea oraș (e2e)**, colour and three photos (checked 2026-10-25), and `/pages/e2e-unpublished/` a city added before its admin published it, which says **Harta nu a fost găsită. …**; each with one map, each reading only its own manifest. LIVE after R3, R9 and D7: `https://ventura8.github.io/` and `https://ventura8.github.io/<city>/` (`S-V26-*`).

## After the walk

Whatever was found is fixed with its test and scenario row; the default stage runs again (`bash scripts/ci/e2e-split.sh`), and the deploys and release steps above follow, one yes each.
