# București dispărut · Historic City Map

[![Coverage](.github/badges/coverage.svg)](docs/TESTING.md)
[![Branches](.github/badges/branches.svg)](docs/TESTING.md)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=ventura8_bucurestiuldisparut.github.io&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=ventura8_bucurestiuldisparut.github.io)

## Română

**București dispărut** este o hartă istorică a Bucureștiului: fotografii vechi așezate pe hartă, cu direcția în care privea aparatul, și imagini istorice din satelit (fotografii declasificate USGS din anii 1960–1980), comparate cu orașul de azi.

Proiectul este și un **motor reutilizabil** (Historic City Map): orice oraș își poate face propria hartă istorică din trei fișiere și o aplicație de administrare care face aproape totul automat — configurarea conturilor Google Cloud, Mapbox și USGS, găsirea și importul imaginilor, georeferențierea și publicarea straturilor, gestionarea fotografiilor și a locurilor de interes, cu un cursor de transparență pentru fiecare strat, pentru fotografii și pentru fiecare categorie de locuri. Interfața este în română (implicit) și engleză, cu Material Design 3, adaptată oricărui ecran.

> Stare: rescrierea completă este în lucru pe ramura `feat/engine-rewrite`. M1 (motorul de vizualizare, kitul Material 3, fotografiile migrate și punctele de interes, cu consimțământ pentru statistici și rapoarte de erori) trece testele end-to-end pe 11 dimensiuni de ecran, în temă deschisă și întunecată, în română și engleză; M2 și M2b (serverul, aplicația de administrare și Asistentul de configurare) și M2c (editoarele pentru fotografii, locuri, straturi, setări, istoric, procesări și administratori, ale căror salvări ajung în harta publică prin manifestul construit de server) funcționează cap-coadă pe emulatoarele Firebase, iar M3 (straturile istorice: căutarea la USGS, importul unui cadru gratuit, georeferențierea automată și georeferențiatorul, aprobarea, paza costurilor Mapbox, publicarea, decuparea și înlocuirea) funcționează la fel, cu procesarea imaginilor rulată și ea pe serviciile simulate, iar M4 (automatizarea: cumpărarea unei scanări cu un singur clic după plată și importul ei automat la livrare, perechile de puncte sugerate, comparația cu cortină din harta publică, titlurile sugerate din OpenStreetMap, ciornele în română și engleză și notificările) funcționează la fel, iar M5 (mai multe orașe într-un proiect, fiecare închis administratorilor celorlalte, cu meniul orașelor, Oraș nou din trei acțiuni, publicarea, rolurile și bugetul fiecărui oraș; site-ul public al fiecărui oraș pe GitHub Pages; exportul static al unui oraș, care merge fără Firebase; trusa de pornire cu motorul de pe jsDelivr și `create-historic-city`; versiunea 1.0.0 a motorului pregătită, fără etichetă) funcționează la fel; pe cloudul real așteaptă instalarea serverului, aprobările USGS și Mapbox, pornirea Vertex AI și FCM, prima cumpărare reală a unei scanări și publicarea versiunii 1.0.0 (`docs/research/M3-status.md`, `docs/research/M4-status.md`, `docs/research/M5-status.md`). Site-ul vechi rămâne publicat până la înlocuire.

## English

**București dispărut** ("Vanished Bucharest") is a historical map of Bucharest: old photographs placed on the map with the direction the camera faced, and historical satellite imagery (declassified USGS photographs from the 1960s–1980s) to compare with today's city.

It is also a **reusable engine** (Historic City Map): any city can host its own historical map from a three-file starter kit and an admin app that does almost everything automatically — setting up the Google Cloud, Mapbox and USGS accounts, finding and importing imagery, georeferencing and publishing layers, managing photos and points of interest, with a live transparency slider for every layer, the photos and each category of places. The interface is in Romanian (default) and English, Material Design 3, adaptive to every screen.

> Status: the full rewrite is in progress on the `feat/engine-rewrite` branch. M1 (the viewer engine, the Material 3 kit, the migrated photos and points of interest, consent-gated analytics and crash reports) passes the end-to-end tests on 11 screen sizes, light and dark, Romanian and English; M2 and M2b (the backend, the admin and its Setup Assistant) and M2c (the admin's editors for photos, places, layers, settings, history, jobs and admins, whose saves reach the viewer through the server-built manifest) run end to end on the Firebase emulators, and so does M3 (historical layers: the USGS search, importing a free frame, automatic georeferencing and the georeferencer, approval, the Mapbox cost guard, publishing, crop and replace), with the raster pipeline itself run against the same fakes, and so does M4 (automation: buying a scan with one click after paying and its automatic import on delivery, suggested point pairs, the public viewer's swipe compare, title suggestions from OpenStreetMap, Romanian and English drafts, and notifications), and so does M5 (many cities in one project, each closed to the others' admins, with the city menu, a three-input New city, publishing, per-city roles and budgets; each city's public site on GitHub Pages; a city's static export that runs without Firebase; the starter kit with the engine from jsDelivr and `create-historic-city`; engine v1.0.0 prepared, not tagged); on the real cloud it waits for the server's deploy, the USGS and Mapbox approvals, Vertex AI and FCM turned on, the first real scan purchase and the v1.0.0 release (`docs/research/M3-status.md`, `docs/research/M4-status.md`, `docs/research/M5-status.md`). The legacy site stays live until it is replaced.

## Orașul tău / Your city

Un oraș nou pornește din trusa de pornire (de la versiunea 1.0.0, după publicarea ei pe npm, `docs/research/M5-status.md` §3): `npx create-historic-city@1.0.0 orasul-meu` întreabă numele orașului și dreptunghiul lui pe hartă și scrie cele trei fișiere (pagina, `city.json`, README), gata de pus pe GitHub Pages. Cu propriul proiect Firebase și aplicația de administrare, `npx create-historic-city@1.0.0 self-host orasul-meu --project <id> --experimental` te conduce prin pași, cu un da/nu la fiecare; conectarea la Google, termenii și plata le faci doar în paginile Google. Este în lucru: Asistentul de configurare nu rulează încă într-un proiect al tău (CR-M5-7, [docs/SELF_HOST.md](docs/SELF_HOST.md)).

A new city starts from the starter kit (from v1.0.0, once it is published on npm, `docs/research/M5-status.md` §3): `npx create-historic-city@1.0.0 my-city` asks for the city's name and its rectangle on the map and writes the three files (the page, `city.json`, the README), ready for GitHub Pages. With a Firebase project of your own and the admin app, `npx create-historic-city@1.0.0 self-host my-city --project <id> --experimental` walks you through the steps, with a yes/no for each; signing in to Google, the terms and billing happen in Google's own pages only. It is in progress: the Setup Assistant cannot run in a project of your own yet (CR-M5-7, [docs/SELF_HOST.md](docs/SELF_HOST.md)).

## Repository

An npm-workspaces monorepo:

| Path | Contents |
| --- | --- |
| `packages/engine` | `@hcm/engine`, the public viewer (Lit + Mapbox GL JS 3.34.1, loaded from Mapbox's CDN, never bundled); exposes `window.HistoricCityMap` |
| `packages/admin` | `@hcm/admin`, the admin: its Setup Assistant and the editors (photos, places, layers, settings, history, jobs, admins, crash reports) |
| `packages/ui` | `@hcm/ui`, the Material 3 Expressive component kit, its self-hosted fonts and the viewer's elements ([packages/ui/README.md](packages/ui/README.md)) |
| `packages/shared` | `@hcm/shared`, schemas (City Manifest v1), the overlay model, the URL hash, i18n (RO/EN), logging |
| `packages/test-support` | `@hcm/test-support`, fakes and fixtures for tests |
| `sites/<city>/`, `starter-kit/` | each city's site for GitHub Pages (`sites/bucharest` at the root, every other city at `/<city>/`; `npm run site:add` writes a new one) and the M1 kit the site build makes (`config.js`, `site.json`, `site.css`; the page is generated by `scripts/site/`, see [starter-kit/README.md](starter-kit/README.md)) |
| `templates/starter-kit/` | the starter kit a new city copies (M5): `index.html` (the engine from jsDelivr at a pinned version, with Subresource Integrity), `city.json` and a Romanian and English [README](templates/starter-kit/README.md) |
| `packages/create-historic-city` | the `create-historic-city` CLI (`npm create historic-city@1.0.0`): a new city's three files with minimum input, and the guided steps for a Firebase project of the owner's own ([docs/SELF_HOST.md](docs/SELF_HOST.md)) |
| `functions/`, `firebase/`, `pipeline/`, `e2e/` | Cloud Functions, Firestore and Storage rules with their tests, the Python + GDAL raster pipeline, Playwright end-to-end tests behind mock APIs (`e2e/mock-apis/`) |
| `seed/bucharest` | the legacy photos and their metadata, migrated as they are |
| `docs/` | documentation; `docs/research/` holds the approved plan and the research behind it |

## Quick start

Everything runs in Docker; the host needs only Docker and git ([docs/SETUP.md](docs/SETUP.md)).

```bash
PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh   # lint, format, types, secrets, audits
PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh    # unit, component and rules tests, 90 % coverage per file
PIPELINE_STAGE=e2e bash scripts/ci/run-all-checks.sh      # Playwright end-to-end tests (E2E_TIER=smoke,fn for a subset)
PIPELINE_STAGE=e2e bash scripts/ci/e2e-split.sh           # the same, split with a second Docker machine over ssh (the NUC)
PIPELINE_STAGE=build bash scripts/ci/run-all-checks.sh    # engine and admin bundles (and the admin's Hosting folder), then the sites in dist/site/ and the Pages tree dist/pages/
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Engine API](docs/ENGINE_API.md) (config.js, the element, the JavaScript API, the URL hash, City Manifest v1)
- [CI pipeline](docs/CI_PIPELINE.md)
- [Testing](docs/TESTING.md)
- [Manual test plan and the local stack](docs/MANUAL_TEST_PLAN.md)
- [Developer setup](docs/SETUP.md)
- [Self-hosting a city (RO/EN)](docs/SELF_HOST.md): the starter kit and `create-historic-city`
- [Admin guide (RO)](docs/ADMIN_GUIDE.ro.md) · [Admin guide (EN)](docs/ADMIN_GUIDE.en.md)
- [Lessons](docs/LESSONS.md)
- [Release notes](docs/releases/README.md)
- [Approved plan](docs/research/PLAN.md), the [M0 hand-off](docs/research/M0-handoff.md), the [M1 interfaces](docs/research/M1-interfaces.md) and the latest milestone's [status](docs/research/M5-status.md)
- For AI agents: [AGENTS.md](AGENTS.md)

## Credits

Historical photographs: their authors and rights holders, credited on each photo. Satellite imagery: USGS EROS, declassified (public domain). Base map: © Mapbox, © OpenStreetMap contributors.

## Licences

The engine and the admin bundle third-party npm packages (Lit, zod, the Firebase JS SDK, Terra Draw and its Mapbox GL adapter, among others) and self-host two font families. Each build writes `THIRD_PARTY_NOTICES.txt` beside its entry script (`packages/engine/dist/`, `packages/admin/dist/`): every bundled package and every package a font comes from, with its exact version, its licence and the licence text, generated from the installed packages by `scripts/site/src/notices.ts`. The engine's file travels with the engine (the city sites, the GitHub Release and jsDelivr); Firebase Hosting serves the admin's next to the admin. The `notices` gate of the `build` stage checks each file against the build's source maps and allows only permissive licences (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, OFL-1.1, 0BSD, CC0-1.0); the fonts' licences are also in [packages/ui/fonts/LICENSES.md](packages/ui/fonts/LICENSES.md). Mapbox GL JS is not bundled: pages load it from Mapbox's CDN under Mapbox's own terms. The project's own code carries no open-source licence yet (`UNLICENSED` in every `package.json`).
