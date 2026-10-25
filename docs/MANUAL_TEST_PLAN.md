# Manual test plan: the whole product, from the top

The checklist the owner and Claude walk together before the go-live, fixing what they find on the way. It covers the live admin's start-up page and sign-in, the Setup Assistant step by step, the daily admin flows, the M3 historical imagery and the public viewer. Every item says **where** it runs and **when** it can run:

- **LIVE**: the real project `bucurestiul-disparut` (admin `https://bucurestiul-disparut.web.app`, today the start-up Hosting deploy of `8f4e43d`, 2026-10-23). Some items wait for a deploy (D1–D7 below); each deploy is ask first.
- **LOCAL**: the local stack (`npm run dev:stack`, [SETUP.md](SETUP.md) → *Local stack for manual testing*): the same admin and viewer on the Firebase emulators and the fakes of the e2e world, seeded with a Bucharest city, nothing in the cloud. Every LOCAL item can run **now**.

The automated suites already prove each behaviour against the emulators ([E2E_SCENARIOS.md](E2E_SCENARIOS.md)); this walk is about what a person sees, the real providers' pages and what only the real cloud can show ([research/M2-status.md](research/M2-status.md) §3, [research/M3-status.md](research/M3-status.md) §3).

## How to use it

- Tick each box when its expected result holds. A failure: say it in the chat with the item's id (`B3`, `C5`, ...); Claude reproduces it (LOCAL first when it can), fixes it with a test and its happy and bad row in `e2e/scenarios.json`, and records it in [LESSONS.md](LESSONS.md).
- **Human steps** are yours alone: accounts, billing and card details, terms, passwords, Google's consents and every token paste. Claude opens the exact page and says which button; it never types a credential. **Ask first** marks a command Claude runs only after your yes for that command.
- Romanian is the admin's and the viewer's first language; the labels below are the Romanian ones you see, with the English in brackets. `?lang=en` on either address (or the language switch) shows the English ones.
- **Browsers**. LIVE: your own Chrome (the Google sign-in and the providers' consoles are yours). LOCAL: the Claude browser pane through `.claude/launch.json` (`dev-stack` starts the stack, `dev-stack-admin` and `dev-stack-viewer` open it), or Chrome at the same `127.0.0.1` addresses. On this machine the pane has **no WebGL** (checked 2026-10-24: the viewer shows its no-WebGL card, the admin maps their "cannot draw the map" state), so every item that looks at a map runs in Chrome (Claude in Chrome, or yours).
- LOCAL sign-in: **Conectează-te cu Google** (Sign in with Google) opens Google's consent stand-in in a frame over the page; `owner@e2e.test` is preselected; **Allow**. The other generated accounts: `admin@e2e.test` (an admin), `editor@e2e.test` (a pending invitation), `stranger@e2e.test` (nobody). The seeded world, the logs and the levers are in [SETUP.md](SETUP.md).

## Live and local at a glance

| Area | LIVE now | LIVE after | LOCAL now |
| --- | --- | --- | --- |
| Start-up page, sign-in, ownership check | yes (`8f4e43d`: before the title fix and M3) | D1: the current admin, start-up mode | `HCM_STACK_SEED=fresh` |
| Setup (b) billing, (c) Provision cloud | yes, after D1 (so the M3 items are provisioned) | | `fresh`, against the fakes |
| Setup (d) install the server, (d2) claim | no | D2 + D3 (then D4) | `fresh` + one `curl` (below) |
| Setup (e) Mapbox, (f) USGS, (g) Analytics and crashes, (h) old photos | no (need the server) | D3 | `fresh` (fake tokens) or seeded green |
| Daily admin flows (photos, places, layers, settings, history, admins, jobs, crashes, dashboard) | no | D3 + D4 + Setup (e) | yes (seeded city) |
| M3 imagery (search, import, georeferencer, approve, publish, guards) | no | D3 + D4 + D5 + Setup (e), (f), M2M approved | yes (stand-in pipeline, fake MTS) |
| M4 buying a scan (order card, I ordered it, the daily watch, reminders, the import on delivery) | no | as M3, then your first real purchase in EarthExplorer (30 USD a frame + 5 USD an order, yours to pay) | yes (a frame to buy, one ordered; the delivery by a `curl`) |
| M4 suggested pairs, title suggestions, Romanian and English drafts | no | as M3; the drafts after Provision turns on Vertex AI (the paid EEA tier, under 0.05 USD a month) | yes (fake Nominatim and Vertex AI) |
| M4 notifications (inbox, push on a device) | no | D3 + D4; push after Provision turns on FCM | yes (the inbox; push in Chrome with the fake FCM) |
| Public viewer's swipe compare | no | D7 | yes |
| Public viewer | old site on Pages | D7 (Pages go-live; see V0) | yes (emulators' manifest) |

## The deploys and their commands (each ask first)

Every deploy needs your yes for that deploy, a clean tree on a commit whose default stage is green (`bash scripts/ci/e2e-split.sh`; today it can say SUCCESS only after the audit bumps of [research/DECISIONS-for-review.md](research/DECISIONS-for-review.md) §48a and §49i, which wait for your yes), and your own `npx -y firebase-tools@15.33.0 login` in your terminal. Builds run in the quality image; the deploy itself runs on the host with your login, from a temporary copy of `firebase.json` without its `predeploy` steps (the host's Node 22 and npm 9 do not build this repository). Every command names the project.

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

Check: `https://bucurestiul-disparut.web.app/runtime.json` says `"release": "0.0.0+<short commit>"` and `"startUp": true`; the console shows no error before sign-in.

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

Check: Setup (d) shows **51 din 51 funcții instalate** (51 of 51 functions installed) and turns green by itself; the claim (d2) follows; **Verifică din nou** (Check again) lists every server check green.

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
gh pr create --base master --head feat/engine-rewrite   # then the review, the Copilot review, the merge (ask first)
```

The push to `master` runs CI; `deploy-pages` publishes `dist/site/bucharest`. If Pages is not yet set to GitHub Actions in the repository's settings, that setting is one more yes.

## A. The live admin: start-up page and Google sign-in

- [ ] **A1. The start-up page boots clean.** LIVE now (D1 first to test the current code). Open `https://bucurestiul-disparut.web.app` in a fresh profile. Expected: the sign-in panel with **Conectează-te cu Google**, the note that the map has no server yet; the console shows the boot line with `startUp: true` and no error (no CORS error, no request to a function).
- [ ] **A2. The tab's title follows the language.** LIVE after D1 (LOCAL now). An English Chrome: the tab says **Map administration** and the page is English; a Romanian or German one: **Administrarea hărții**, Romanian. The account menu's **Română** / **English** switches title and text at once.
- [ ] **A3. The owner signs in and Google checks the ownership.** LIVE now. Human: **Conectează-te cu Google**, choose the account that owns `bucurestiul-disparut`, allow the read-only Google Cloud access (one consent; if Google says the app is unverified: Advanced, then continue to the domain, as the panel explains). Expected: the start-up banner **Mod de pornire: harta nu are încă server...**, the Setup Assistant open at **Facturare Google Cloud și buget** (Google Cloud billing and budget). LOCAL: `HCM_STACK_SEED=fresh`, Allow as `owner@e2e.test`, the same screen.
- [ ] **A4. Another Google account is refused.** LIVE now (a second Google account of yours), LOCAL `fresh` as `stranger@e2e.test`. Expected: **Doar proprietarul proiectului Google Cloud bucurestiul-disparut poate configura harta.** and **Folosește alt cont Google** (Use another Google account); nothing is written.
- [ ] **A5. Cancelling the consent changes nothing.** LIVE and LOCAL. Close Google's window (LOCAL: **Cancel** in the stand-in). Expected: **Fereastra Google s-a închis înainte de final. Nu s-a schimbat nimic.**

## B. The Setup Assistant, in order

Each card says why, what it costs and what it needs from you. The whole assistant asks at most 9 inputs and 4 Google consents. LOCAL rehearsal of B1–B8: `HCM_STACK_SEED=fresh npm run dev:stack` (a new map against the fake Google, Mapbox and USGS; the fake test values are in `packages/test-support/src/fakes/mapbox-state.ts` → `MAPBOX_TOKENS.bootstrap` and `packages/test-support/src/fakes/usgs.ts` → `USGS_CREDENTIALS.approved`).

- [ ] **B1. (b) Billing and the 5 USD budget.** LIVE after D1. Human: if you have no billing account, create one on Google's page (your card); then **Leagă facturarea și creează bugetul de 5 USD** and allow the billing consent. The app links the account (Blaze) and creates the budget. Expected: **Planul Blaze este activ; bugetul este de 5 USD pe lună.**; no deploy needed.
- [ ] **B2. (c) Provision cloud.** LIVE after B1. **Pregătește proiectul** (Prepare the project), allow the Google Cloud consent. The app creates the 15 items one by one (APIs, service accounts, IAM, buckets with CORS and the lifecycle, secret slots, task queues, Workload Identity for GitHub, App Check, budget alerts, organisation policies, crash alerts, the browser key; the scheduler waits for the server). Expected: **{done} din 15 elemente gata**, every item green except the scheduler (**Se creează la prima instalare a serverului.**); an organisation policy or a missing role is named with its fix, and **Reia ce nu a reușit** (Retry what failed) retries only those.
- [ ] **B3. (d) Install the server.** LIVE: **ask first D2, then D3**. The card **Instalarea serverului hărții** watches every 30 seconds. Expected: **61 din 61 funcții instalate** (M4 added the orders', the assists' and the notifications' functions), green by itself. LOCAL `fresh`: the server already runs; make the fake list it installed with `curl -X POST 'http://127.0.0.1:4311/__upstream/scenario?test=' -H 'content-type: application/json' -d '{"name":"google.deployed"}'`.
- [ ] **B4. (d2) The claim, without a click.** LIVE after B3. Expected: **Preluarea hărții** green, you are the owner (Admins lists you as owner), the city `bucharest` exists; then **ask first D4** (normal mode).
- [ ] **B5. (e) Mapbox.** LIVE after B4. Human: create the Mapbox account, leave the demo plan (card, billing address), tick the usage alerts, create the secret token `historic-map-server` with the scopes the card lists (**Copiază permisiunile**), paste it into **Tokenul secret (sk.…)**. The app saves it on paste into Secret Manager, checks its scopes and mints the URL-restricted public tokens (the viewer's for `https://ventura8.github.io`, the admin's). Expected: **Salvat pentru contul Mapbox {user}.**; the admin maps draw (Settings, a layer). Bad paths: a `pk.` token or one without the scopes is refused with what to fix.
- [ ] **B6. (f) USGS.** LIVE after B4. Human: register on ERS, request M2M access with the card's text, wait for USGS (24–48 business hours); then type **Numele de utilizator ERS**, **Deschide pagina tokenului USGS**, paste the token within the countdown (**Lipește tokenul în {seconds} s**). The app checks the M2M role every 6 hours (ops.tick) and turns the card green when downloads are approved. Expected: green with the download role.
- [ ] **B7. (g) Analytics and crash reports** (optional). LIVE after B4. Human: enable Google Analytics in the Firebase console (Google's terms). Then **Nu mai număra schimbările de adresă ca vizualizări** (one click, the Analytics consent); **Trimite-mi un e-mail la erori noi**. Expected: the measurement id shown, the stream setting off; the Crashes page lists groups (LOCAL seeded: two).
- [ ] **B8. (h) The old Bucharest photos** (optional). LIVE after B5. **Importă fotografiile (45)**. Expected: **Fotografii importate: {done} din 45**, then **Toate fotografiile sunt pe hartă (45).**; each needs its rights checked in Photos (**Drepturi de verificat**). LOCAL seeded: 12 of the 45 are already in, so the import resumes with the other 33.
- [ ] **B9. Server checks.** LIVE after D3 (and D5 for Cloud Run). **Verifică din nou** (Check again). Expected: **Verificările serverului** all green (Firestore, Secret Manager, Mapbox tokens, the USGS account, Cloud Run); a failing check names its step (**Deschide pasul „{step}”**).
- [ ] **B10. Bucharest's target years** (CR-M3-28). LIVE after B4. Settings → **Imagini istorice**: add 1966, 1976, 1977, 1978, 1980, save. Expected: the Imagery area ranks those frames first.

## C. The daily admin flows

LOCAL now (seeded city; maps in Chrome); LIVE after D3, D4 and B5. Each save shows **Salvat de {who} la {date}.** and a publishing note (**Harta publică se actualizează în aproximativ un minut.**); the viewer (V) then shows the change.

- [ ] **C1. Dashboard (Acasă).** Expected: **Harta ta** (Your map) counts **Fotografii, Locuri, Categorii de locuri, Straturi istorice**; **Te așteaptă** (Waiting for you): **Fotografii de verificat pentru drepturi, Fotografii nepublicate, Procesări eșuate, Imagini istorice de aprobat, Scanări care așteaptă puncte de georeferențiere** (LOCAL: one failed job, one image to approve, one scan waiting for points); **Numără din nou** (Count again) counts again; each count opens its list.
- [ ] **C2. Photos: list, filters, bulk.** **Fotografii**: the filters **Toate, Publicate, Nepublicate, În procesare, Drepturi de verificat**; select several, **Publică** / **Retrage de pe hartă** / **Confirmă drepturile** / **Autor, sursă și licență** / **Șterge** (with Undo; restored from History's **Șterse**). Expected: the counts in each result line; the failed upload ("Scanare ilizibilă") shows its reason.
- [ ] **C3. Photos: upload and editor.** **Adaugă fotografii** with a JPEG with GPS EXIF, a HEIC, a PDF renamed `.jpg`. Expected: the JPEG goes **Se încarcă**, **Se procesează**, **Gata** with its place suggested from EXIF; the other two are refused with why; the editor (title RO/EN, year, author, license, place on the map, bearing) saves and **Publicată pe harta publică** publishes; Replace keeps the published image until the new one is processed.
- [ ] **C4. Places with drawing.** **Locuri** → **Adaugă loc** → **Ce formă are locul?** **Punct / Linie / Suprafață**; draw on the map (**Desenează**, **Selectează și mută**, **Adaugă în centru**, **Șterge ultimul punct**), drag a vertex, a midpoint; the Markdown preview of the description; **Importă GeoJSON** and **Exportă toate (GeoJSON)**. Bad paths: a point outside the city, a self-crossing area, more than 500 points are refused with the reason. LOCAL: "Cartierul Uranus" (an area), "Strada Mihai Vodă" (a line), "Ateneul Român" (a draft).
- [ ] **C5. Layers: order, opacity, adjustments, link.** **Straturi**: **Mută mai sus / mai jos**; open a layer: **Opacitate implicită**, **Afișat la deschiderea hărții**, **Nivel de negru, Nivel de alb, Contrast, Saturație** (keyboard and mouse; the levels never cross), the admin map previews each change live; **Salvează**. **Leagă un strat**: a tileset of another account is refused before anything is sent; an XYZ address with **Verifică** asks one tile and says what answered. Expected: the viewer shows the saved opacity and adjustments (V5).
- [ ] **C6. Settings.** **Setări**: **Zona orașului** (draw the rectangle, **Folosește vederea hărții**), **Texte** (About, privacy), **Temă și hartă de bază** (**Culoarea orașului** previews live), **Imagini istorice** (auto-publish, threshold, target years), **Categorii de locuri** (**Adaugă o categorie**, its icon guessed from the label, order), **Opacități implicite**. Expected: each saves and History records it.
- [ ] **C7. History and revert.** **Istoric**: the recent changes of this city, filtered by what (**Orice, Setările orașului, Straturi, Fotografii, Locuri, Categorii de locuri**); a document's **Versiuni**, compare, **Readu această versiune** (Bring this version back), a deleted one **Restaurează**. LOCAL: "Biserica Enei" has an update to revert.
- [ ] **C8. Admins.** **Administratori**: invite an address (**Invită**; the link is yours to send); the invited account signs in and sees **Ai o invitație să administrezi harta** → **Alătură-te**; **Retrage accesul** (asked first; **Păstrează accesul** keeps it). A removed admin with unsaved changes keeps the page read-only under the banner. LOCAL: sign in as `editor@e2e.test` to join, as `admin@e2e.test` to be revoked.
- [ ] **C9. Jobs (Procesări).** The list (running, failed, done), a job's steps by name, its log; **Anulează procesarea** (asked first), **Rulează din nou** on a failed job. LOCAL: the import failed at warp.
- [ ] **C10. Crashes (Erori).** The groups (**De câte ori**, last seen), a group's details, **Perioada**. LOCAL: two groups of the fake Error Reporting (the page may ask Google's consent first: the stand-in).
- [ ] **C11. Account menu.** **Contul și preferințele**: language, theme, the analytics consent of the admin, **Deconectează-te**. Expected: everything follows at once (title, `<html lang>`).
- [ ] **C12. Phone and tablet.** Repeat C2, C4 and C5 at 360 × 800 and 768 × 1024 (the browser's device toolbar, or `resize_window` in the Claude pane): the navigation bar or rail, the full-screen editor, Esc and Back.

## D. M3 historical imagery

LOCAL now (the stand-in pipeline and the fake MTS); LIVE after D3, D4, D5, B5, B6 with M2M downloads approved, and B10. The seeded LOCAL world has the harvest, a draft over the threshold, an import waiting for points, a failed import and the published 1980 frame.

- [ ] **M1. Search and ranking.** **Imagini istorice**: the first visit harvests (**Se caută scenele USGS de deasupra orașului…**, then **Am găsit {found} scene, dintre care {added} noi.**); the scenes **cele mai potrivite primele** with a 0–100 score and their reasons in words; the footprints on the map. **Filtre**: **Doar gratuite**, **Ascunde respinsele**, **Din anul / Până în anul**; **Caută din nou la USGS**. LIVE: the real catalogue over Bucharest (the five target frames first after B10).
- [ ] **M2. A scene and its preview.** Open a scene: the browse image (copied into our bucket by the server; the browser never asks USGS), the reasons, **Importă (gratuit)**; a paid frame says it must be ordered (M4).
- [ ] **M3. Import and live progress.** **Importă (gratuit)** (one click). Expected: the version page, its steps advancing live with the log, **Anulează procesarea**; under the threshold the policy publishes it with no other click; the new layer appears in Straturi and in the viewer. LIVE: the first real run (minutes to an hour); LOCAL: seconds, then the fake MTS (about two minutes).
- [ ] **M4. Approve a draft over the threshold.** The version **Gata de publicare** with both errors and the compute units (**Publicarea folosește circa {estimate} unități de calcul Mapbox; luna asta mai sunt {available}.**); **Aprobă și publică** / **Respinge**. LOCAL: the seeded 1966 draft.
- [ ] **M5. The georeferencer when matching fails.** The version waiting for points → **Georeferențiator**: the scan and the reference side by side, **Adaugă perechi** (scan, then map, or the reverse; the keyboard works too), the residual table, both errors, **Afină / Spline în plăci subțiri** with their minimum pairs, pairs on a line refused, **Salvează și georeferențiază**. Expected: **Punctele au fost salvate: procesarea continuă.** LOCAL: the seeded 1976 import. The OpenStreetMap reference image is LIVE only (LOCAL refuses OpenStreetMap tiles, the e2e firewall's rule).
- [ ] **M6. Retry a failed import.** **Rulează din nou**. Expected: it resumes from its failed step and publishes. LOCAL: the seeded 1977 import (its second attempt is scripted to succeed).
- [ ] **M7. The compute-unit guard.** A publish over the month's compute units waits with three ways out: **Gratuit: încarcă fișierul în Mapbox Studio** (1. Descarcă fișierul, 2. Deschide Mapbox Studio..., 3. L-am încărcat), **Așteaptă luna viitoare**, **Publică acum, cu un cost de circa {usd} USD**. LOCAL: make the next run warp 1000 km² with `curl -X POST 'http://127.0.0.1:4311/__imagery/script?city=bucharest' -H 'content-type: application/json' -d '{"attempts":[{"outcome":"under","areaKm2":1000}]}'`, import the free 1968 frame, then set it back with `-d '{"attempts":[{"outcome":"under"}]}'`. LIVE: only when a real month runs short (watch the estimate on M4).
- [ ] **M8. The budget pause.** When the month's Google Cloud cost reaches the budget, Imagery and Jobs say **Procesare oprită: Google Cloud a costat luna aceasta {cost} din {budget}. Harta publică merge.**, Import is refused with why, and **Reia procesarea** (asked first) resumes. LOCAL: write the alert's result with `curl -X PATCH 'http://127.0.0.1:8080/v1/projects/demo-hcm/databases/(default)/documents/ops/guard' -H 'authorization: Bearer owner' -H 'content-type: application/json' -d '{"fields":{"state":{"stringValue":"red"},"reason":{"stringValue":"budget"},"spend":{"mapValue":{"fields":{"costAmount":{"doubleValue":5.37},"budgetAmount":{"doubleValue":5},"currency":{"stringValue":"USD"},"interval":{"stringValue":"2026-10-01T07:00:00Z"}}}},"updatedBy":{"stringValue":"system:ops"},"updatedAt":{"timestampValue":"2026-10-24T09:00:00Z"}}}'`. LIVE: not to be provoked (it is a real cost); its rehearsal is LOCAL.
- [ ] **M9. Crop and Replace.** A published layer's editor: **Decupează** (draw the area to keep on the map, **Salvează decuparea**; a crop off the layer is refused), **Înlocuiește imaginea** (**Încarcă un GeoTIFF**: a TIFF with its own georeference goes to Approve, a plain scan to the georeferencer; not a TIFF is refused). Expected: the layer keeps its tiles until the new version is published; the viewer's tiles end at the crop. LOCAL: the published 1980 frame.
- [ ] **M10. Upload a GeoTIFF as a new layer.** **Încarcă un GeoTIFF**, **Anul imaginii** when the name does not say it, **Încarcă**; progress, **Oprește încărcarea**, resume after a dropped connection. Expected: its own job and version (M4 or M5).

## F. M4 automation: buying a scan, suggestions, assists, notifications

LOCAL now (the seeded city: the 1968 Corona frame `DS1105-1071DF076` to buy, the Declass 3 frame `D3C1209-100055F012` marked as ordered, the 1976 import waiting for points with the matcher's suggestions, and the inbox items of the failed import, the draft over the threshold and the version waiting for points); LIVE after D3, D4, D5, B5, B6 with M2M downloads approved, and B2 for the drafts and push (Provision turns on Vertex AI and FCM). Nothing here pays: the purchase itself is yours, in EarthExplorer.

- [ ] **O1. The order card.** **Imagini istorice** → **Doar gratuite** off → the 1968 frame. Expected: **Cumpără această scanare**, **Trebuie comandat de la USGS**, **Cost: 35 USD (1 × 30 USD pe cadru + 5 USD pe comandă), plătit direct la USGS**, the four EarthExplorer steps, **Comandă în EarthExplorer** opening `https://earthexplorer.usgs.gov/scene/metadata/full/5e839febdccb64b3/DS1105-1071DF076/` in a new tab, **Am comandat**. LIVE: the link opens the real scene page (no purchase unless you decide to buy). LOCAL: the link is blocked by the stack's firewall (no request leaves the machine); check the address.
- [ ] **O2. I ordered it, Undo and Take the mark back.** **Am comandat**. Expected: **Comandat: verificăm zilnic livrarea** with **Comandat la**, **Următoarea verificare**, **Verifică acum** and **Retrage marcajul** (also in the snackbar); **Retrage marcajul** brings the buy card back. A free frame cannot be marked: **Cadrul este deja scanat: importă-l gratuit, fără comandă.** LIVE: only after a real purchase (marking without buying makes the watch ask USGS daily for 90 days, harmlessly).
- [ ] **O3. Delivery, the watch and the automatic import.** LOCAL: make the fake USGS deliver with `curl -X POST 'http://127.0.0.1:4311/__upstream/scenario?test=' -H 'content-type: application/json' -d '{"name":"usgs.ordersDelivered"}'`, then **Verifică acum** on the ordered Declass 3 frame (the daily watch is `imagery.tick`; the stack's scheduler runs it every five minutes, due once a day). Expected: **Livrat: importul pornește**, then **Se importă** with **Deschide importul**; the import runs as M3 under the threshold and publishes with no click; **Notificări** gets **USGS a livrat scanarea …: importul a pornit.** and then **Scanarea … a fost importată.** LIVE: three to four weeks after you pay; nothing to click.
- [ ] **O4. Reminders and an order never delivered.** LIVE only by time (days 7 and 12; day 90). Expected: **Comandat: ai plătit? USGS șterge comenzile neplătite după 14 zile** and the inbox's reminder, with the note that if you paid there is nothing to do; after 90 days **Nelivrat** with **Comandă din nou** and **Retrage marcajul**. Before USGS approves your downloads both cards say the daily check waits for it (**Următoarea verificare: după ce USGS aprobă descărcările**). Its rehearsal is the e2e rows S-A13-BAD-NEVER-DELIVERED (seeded states).
- [ ] **O5. Work lists the orders.** **De lucru**: **Comenzi**, the one that needs you first (an order never delivered), counted in the tab; a reminder is listed but not counted.
- [ ] **G1. Suggested pairs.** The 1976 import waiting for points → **Georeferențiator**: **Perechi sugerate** with **Încredere …** as words and bars and the distance from the fit; **Acceptă** / **Respinge** each (Enter / Delete on a row), **Acceptă toate**; dashed rings on the scan, flags on the map; nothing saved until **Salvează și georeferențiază**. LIVE: the real matcher's suggestions on a real frame (D5).
- [ ] **A1. Title suggestions.** **Locuri** → a place → **Sugerează un titlu** (or draw a new point, or move the pin of a photo still titled after its file, such as `IMG 0412`: it asks by itself). Expected: **Se caută titluri în OpenStreetMap…**, then buttons **Folosește titlul „…”** and **Sugestii din OpenStreetMap (© contribuitorii OpenStreetMap, ODbL)**; the title changes only on a choice, Save writes it. Bad path: a second ask within the cool-down after OpenStreetMap's 429 says **Sugestiile OpenStreetMap nu sunt disponibile acum. …**. LIVE: the real Nominatim (1 request a second for the project, cached 90 days).
- [ ] **A2. Romanian and English drafts.** A photo, a place or a layer: **Ciornă în engleză** beside a Romanian text whose English side is empty (with both sides filled no draft is offered). Expected: **Se scrie ciorna…**, then the English field filled with **Ciornă propusă de …: verific-o înainte să salvezi.**; nothing is published until **Salvează**; HTML in the source comes back as plain text. LIVE after B2 (Vertex AI on, the paid tier; at most 500 drafts or 0.50 USD a month). LOCAL: the fake Vertex AI answers.
- [ ] **N1. The inbox.** **Notificări** (with the unread count in the navigation's name): the seeded items, newest first; a click opens its page and marks it read; **Marchează toate ca citite**. An empty inbox says **Nicio notificare deocamdată.**
- [ ] **N2. Push on this device.** **Notificări pe acest dispozitiv** → the browser's prompt → **Notificările sunt pornite pe acest dispozitiv.**; **Trimite o notificare de probă**; **Notificări pe dispozitive** chooses the kinds. A refused prompt: **Browserul a refuzat notificările …**, the inbox still works. LIVE after B2 and D4 (FCM's `message.fid` UNVERIFIED until this first test: DECISIONS §54c). LOCAL: Chrome, the fake FCM.
- [ ] **V11. Swipe compare** (the public viewer, E's sizes). **Straturi** → **Compară**: a second map beside the first (wide windows only), the divider (drag, or Tab to it and the arrow keys; Shift ×10, Home, End), **Compară cu** (another layer or **Azi**), each side's opacity; **Închide comparația** removes the second map. Under 600 px: **Partea afișată** toggles one map; a second map made on a wider window waits hidden for a minute (turning a phone back shows it again without a new map load). The chooser does not offer what the main side shows. A link copied while comparing reopens it (`cmp=`, `sw=`). LOCAL: the published 1980 frame against **Azi** or the 1911 plan.

## E. The public viewer

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

## After the walk

Whatever was found is fixed with its test and scenario row; the default stage runs again (`bash scripts/ci/e2e-split.sh`), and the deploys above follow, one yes each.
