# București dispărut · Historic City Map

[![Coverage](.github/badges/coverage.svg)](docs/TESTING.md)
[![Branches](.github/badges/branches.svg)](docs/TESTING.md)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=ventura8_bucurestiuldisparut.github.io&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=ventura8_bucurestiuldisparut.github.io)

## Română

**București dispărut** este o hartă istorică a Bucureștiului: fotografii vechi așezate pe hartă, cu direcția în care privea aparatul, și imagini istorice din satelit (fotografii declasificate USGS din anii 1960–1980), comparate cu orașul de azi.

Proiectul este și un **motor reutilizabil** (Historic City Map): orice oraș își poate face propria hartă istorică din trei fișiere și o aplicație de administrare care face aproape totul automat — configurarea conturilor Google Cloud, Mapbox și USGS, găsirea și importul imaginilor, georeferențierea și publicarea straturilor, gestionarea fotografiilor. Interfața este în română (implicit) și engleză, cu Material Design 3, adaptată oricărui ecran.

> Stare: rescrierea completă este în lucru pe ramura `feat/engine-rewrite` (etapa M0: structura proiectului și sistemul de calitate). Site-ul vechi rămâne publicat până la înlocuire.

## English

**București dispărut** ("Vanished Bucharest") is a historical map of Bucharest: old photographs placed on the map with the direction the camera faced, and historical satellite imagery (declassified USGS photographs from the 1960s–1980s) to compare with today's city.

It is also a **reusable engine** (Historic City Map): any city can host its own historical map from a three-file starter kit and an admin app that does almost everything automatically — setting up the Google Cloud, Mapbox and USGS accounts, finding and importing imagery, georeferencing and publishing layers, managing photos. The interface is in Romanian (default) and English, Material Design 3, adaptive to every screen.

> Status: the full rewrite is in progress on the `feat/engine-rewrite` branch (milestone M0: repository structure and quality system). The legacy site stays live until it is replaced.

## Repository

An npm-workspaces monorepo:

| Path | Contents |
| --- | --- |
| `packages/engine` | `@hcm/engine`, the public viewer (Lit + Mapbox GL JS 3.32.0, loaded from Mapbox's CDN, never bundled); exposes `window.HistoricCityMap` |
| `packages/admin` | `@hcm/admin`, the admin and its Setup Assistant |
| `packages/ui` | `@hcm/ui`, the Material 3 Expressive component kit |
| `packages/shared` | `@hcm/shared`, schemas, i18n (RO/EN), logging |
| `packages/test-support` | `@hcm/test-support`, fakes and fixtures for tests |
| `functions/`, `firebase/`, `pipeline/`, `e2e/` | Cloud Functions, Firestore and Storage rules with their tests, the Python + GDAL raster pipeline, Playwright end-to-end tests (scaffolded; features from M1) |
| `seed/bucharest` | the legacy photos and their metadata, migrated as they are |
| `docs/` | documentation; `docs/research/` holds the approved plan and the research behind it |

## Quick start

Everything runs in Docker; the host needs only Docker and git ([docs/SETUP.md](docs/SETUP.md)).

```bash
PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh   # lint, format, types, secrets, audits
PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh    # unit, component and rules tests, 90 % coverage per file
PIPELINE_STAGE=e2e bash scripts/ci/run-all-checks.sh      # Playwright end-to-end tests
PIPELINE_STAGE=build bash scripts/ci/run-all-checks.sh    # engine and admin bundles
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Engine API](docs/ENGINE_API.md) (config.js, the element, the JavaScript API, the URL hash, City Manifest v1)
- [CI pipeline](docs/CI_PIPELINE.md)
- [Testing](docs/TESTING.md)
- [Developer setup](docs/SETUP.md)
- [Admin guide (RO)](docs/ADMIN_GUIDE.ro.md) · [Admin guide (EN)](docs/ADMIN_GUIDE.en.md)
- [Lessons](docs/LESSONS.md)
- [Release notes](docs/releases/README.md)
- [Approved plan](docs/research/PLAN.md), the [M0 hand-off](docs/research/M0-handoff.md) and the [M1 interfaces](docs/research/M1-interfaces.md)
- For AI agents: [AGENTS.md](AGENTS.md)

## Credits

Historical photographs: their authors and rights holders, credited on each photo. Satellite imagery: USGS EROS, declassified (public domain). Base map: © Mapbox, © OpenStreetMap contributors.
