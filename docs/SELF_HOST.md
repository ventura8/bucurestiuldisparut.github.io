# Găzduirea proprie a unui oraș / Self-hosting a city

`create-historic-city` pornește harta istorică a unui oraș nou: trusa de pornire în trei fișiere și, dacă vrei aplicația de administrare în propriul tău proiect Firebase, pașii ghidați până la ea. Contractul este [research/M5-interfaces.md](research/M5-interfaces.md) §3–§4; pagina, `city.json` și motorul sunt descrise în [ENGINE_API.md](ENGINE_API.md).

`create-historic-city` starts a new city's historical map: the starter kit in three files and, if you want the admin app in a Firebase project of your own, the guided steps up to it. The contract is [research/M5-interfaces.md](research/M5-interfaces.md) §3–§4; the page, `city.json` and the engine are described in [ENGINE_API.md](ENGINE_API.md).

## Română

### Două drumuri

| Drum | Comandă | Ce obții |
| --- | --- | --- |
| Doar harta (static) | `npx create-historic-city@1.0.0 orasul-meu` | `index.html`, `city.json`, `README.md` într-un folder nou: harta pe GitHub Pages sau pe orice găzduire statică, fără Firebase. Editezi `city.json` de mână (README-ul trusei spune cum). |
| Harta cu administrarea (în lucru) | după prima comandă, `npx create-historic-city@1.0.0 self-host orasul-meu --project <id> --experimental` | Același folder (`self-host` îl cere: întâi creezi orașul), plus un proiect Firebase al tău cu aplicația de administrare, pe `https://<id>.web.app/`. Nu este gata încă: vezi limitarea de mai jos. |

`npm create historic-city@1.0.0 orasul-meu` este același lucru ca prima comandă. Comenzile numesc versiunea exactă: `@1` ar rula orice versiune poartă numele în ziua în care citești.

### Trusa (minimum de întrebări)

Comanda întreabă doar ce nu i-ai dat ca opțiune: numele orașului în română (id-ul urmează din el), dreptunghiul orașului (`vest,sud,est,nord`, în grade: pe openstreetmap.org, butonul Export le arată pentru zona de pe ecran; implicit, dreptunghiul Bucureștiului din exemplu), culoarea temei (Enter păstrează culoarea implicită) și tokenul tău **public** Mapbox (`pk.…`; Enter îl lasă pentru mai târziu). Un token secret (`sk.…`) este refuzat: nu este scris și nu este afișat. Cu `--yes`, fiecare întrebare primește răspunsul implicit; `--name-ro`, `--name-en`, `--id`, `--bbox` și `--seed` răspund dinainte. Scrie doar într-un folder nou sau gol; unul care are deja fișiere este lăsat neatins.

### Ce îți trebuie pentru self-host

- Node 24.12 sau mai nou;
- Firebase CLI: `npm install -g firebase-tools@15.33.0` (fără el, comanda se oprește înainte să ruleze ceva și îți arată această linie);
- opțional, Google Cloud CLI (`gcloud`): cu el, comanda verifică singură dacă plata este legată; fără el, te întreabă;
- un cont Google și, pentru server, un card pentru planul Blaze, introdus doar în paginile Google; conturile Mapbox și USGS le faci mai târziu, din Asistentul de configurare.

### Pașii

Fiecare pas spune ce face, de ce și cât costă, apoi întreabă `y/N`; `--yes` nu răspunde la aceste întrebări. Comanda rulează doar uneltele tale (`firebase`, `gcloud`), cu terminalul tău, și deschide paginile Google unde faci partea umană.

| # | Pas | Ce rulează | Partea ta | Cost |
| --- | --- | --- | --- | --- |
| 1 | Uneltele | `firebase --version`, `gcloud --version` | nimic | gratuit |
| 2 | Conectarea | `firebase login` (sărit dacă ești deja conectat) | conectarea Google în browser | gratuit |
| 3 | Proiectul | `firebase projects:create <id>` (sărit dacă există) | termenii Google la prima folosire | gratuit |
| 4 | Aplicația web și Hosting | `firebase apps:create WEB …`, site-ul de Hosting (fiecare doar dacă lipsește) | nimic | gratuit |
| 5 | Conectarea cu Google pentru admin | deschide consola: Authentication, Sign-in method | Google, Enable, Save | gratuit |
| 6 | Adminul, în modul de pornire | scrie `server/` în folderul orașului, apoi `firebase deploy --only hosting` | nimic | gratuit (Spark) |
| 7 | Setup în admin | deschide `https://<id>.web.app/admin/` (M6: administrarea în dosarul ei; rădăcina trimite acolo până la publicarea hărții) | conectarea, revendicarea hărții, plata și bugetul de 5 USD, Provision | gratuit până la Blaze |
| 8 | Serverul | verifică plata (`gcloud billing projects describe`), apoi `firebase deploy --only functions,firestore,storage,hosting` | legarea plății, dacă nu ai făcut-o | Blaze; bugetul oprește imaginile, nu site-ul |
| 9 | Restul Setup | deschide adminul din nou | Mapbox, USGS, statisticile, primul tău oraș (Oraș nou) | după cum alegi |

> Limitare cunoscută (v1.0.0): Asistentul de configurare al adminului citește din `project.json` și setările de publicare din GitHub pe care le are proiectul acestui depozit; fișierul scris de `self-host` nu le are, așa că Setup (pasul 7) nu rulează încă într-un proiect al tău (CR-M5-7, `docs/research/DECISIONS-for-review.md` §63f). Fără Provision din Setup nu există conturile de serviciu sub care rulează funcțiile, așa că nici serverul (pasul 8) nu se poate publica, iar planul Blaze ar rămâne fără bugetul de 5 USD. De aceea `self-host` și `deploy` refuză fără `--experimental` (nu rulează nimic); cu el, oprește-te după pasul 6. `--dry-run` merge oricând.

Un „nu” oprește comanda la acel pas și îți arată pașii rămași (cod de ieșire 0). Un pas eșuat îți arată motivul și comanda cu care continui (cod 1). Folderul `server/` ține fișierele de publicare și este trecut în `.gitignore`: nu face parte din site.

### Opțiuni

| Opțiune | Rol |
| --- | --- |
| `--project <id>` | proiectul Firebase (6–30 litere mici, cifre, cratime); fără el, comanda îl cere |
| `--viewer-origin https://<utilizator>.github.io` | adresa site-ului public al hărții, acceptată de funcții (implicit `https://<id>.web.app`) |
| `--billing-wait <minute>` | cât așteaptă pasul 8 legarea plății, verificând la 15 secunde (implicit 20; 0 verifică o singură dată după Enter) |
| `--dry-run` | arată fișierele, comenzile și paginile, fără să scrie, să ruleze sau să deschidă ceva |
| `--lang ro`, `--lang en` | limba mesajelor (altfel `LANG`, apoi româna) |

### Mai târziu

- `npx create-historic-city@1.0.0 deploy <folder> --project <id> --experimental`: doar serverul (pașii 1, 8 și 9), după ce ai legat plata (în lucru, ca `self-host`);
- `npx create-historic-city@1.0.0 doctor <folder>`: Node, uneltele, `city.json` (valid, cu tokenul tău) și versiunea motorului din `index.html`;
- `npx create-historic-city@1.0.0 theme <folder> --seed '#1b6c4a'`: culorile hărții dintr-o singură culoare (cele patru scheme din `city.json`, pe care le citește harta, și culoarea paginii);
- `npx create-historic-city@<versiune> upgrade <folder>`: rescrie doar blocul motorului din `index.html` la versiunea acelui CLI; politica de securitate a paginii își păstrează sursele pe care le-ai adăugat.

### Ce nu face niciodată

Nu cere, nu scrie și nu afișează parole, tokenuri secrete sau date de plată; nu creează conturi și nu plătește; nu rulează nimic fără „da”-ul tău la pasul respectiv; din uneltele tale citește doar liste (`--json`) și versiuni, iar conectarea o verifică din textul lui `firebase login:list`, niciodată din JSON-ul lui, care conține tokenurile contului tău; nu descarcă nimic și nu contactează singur niciun server. Dacă `firebase projects:create` eșuează (de obicei un id luat: id-urile sunt unice în tot Google), mesajul lui rămâne pe ecran și comanda îți propune alt id.

## English

### Two roads

| Road | Command | What you get |
| --- | --- | --- |
| The map only (static) | `npx create-historic-city@1.0.0 my-city` | `index.html`, `city.json`, `README.md` in a new folder: the map on GitHub Pages or any static host, no Firebase. You edit `city.json` by hand (the kit's README says how). |
| The map with the admin (in progress) | after the first command, `npx create-historic-city@1.0.0 self-host my-city --project <id> --experimental` | The same folder (`self-host` needs it: create the city first), plus a Firebase project of your own with the admin app, at `https://<id>.web.app/`. Not ready yet: see the limitation below. |

`npm create historic-city@1.0.0 my-city` is the same as the first command. The commands name the exact release: `@1` would run whatever release carries the name on the day you read this.

### The kit (minimum questions)

The command asks only what no option answered: the city's Romanian name (the id follows it), its rectangle (`west,south,east,north`, in degrees: on openstreetmap.org, the Export button shows them for the area on screen; the default is the example's Bucharest rectangle), the theme's colour (Enter keeps the default) and your **public** Mapbox token (`pk.…`; Enter leaves it for later). A secret token (`sk.…`) is refused: it is neither written nor shown. With `--yes` every question takes its default; `--name-ro`, `--name-en`, `--id`, `--bbox` and `--seed` answer ahead. It writes only into a new or empty folder; one that already holds files is left alone.

### What self-hosting needs

- Node 24.12 or newer;
- the Firebase CLI: `npm install -g firebase-tools@15.33.0` (without it the command stops before running anything and shows this line);
- optionally the Google Cloud CLI (`gcloud`): with it the command checks the billing link itself; without it, it asks you;
- a Google account and, for the server, a card for the Blaze plan, entered in Google's pages only; the Mapbox and USGS accounts come later, from the Setup Assistant.

### The steps

Each step says what it does, why and what it costs, then asks `y/N`; `--yes` never answers these. The command runs only your own tools (`firebase`, `gcloud`), in your terminal, and opens the Google pages where the human part happens.

| # | Step | What runs | Your part | Cost |
| --- | --- | --- | --- | --- |
| 1 | The tools | `firebase --version`, `gcloud --version` | nothing | free |
| 2 | Signing in | `firebase login` (skipped when you are signed in) | Google's sign-in in the browser | free |
| 3 | The project | `firebase projects:create <id>` (skipped when it exists) | Google's terms on first use | free |
| 4 | The web app and Hosting | `firebase apps:create WEB …`, the Hosting site (each only when missing) | nothing | free |
| 5 | Google sign-in for the admin | opens the console: Authentication, Sign-in method | Google, Enable, Save | free |
| 6 | The admin, in start-up mode | writes `server/` into the city folder, then `firebase deploy --only hosting` | nothing | free (Spark) |
| 7 | Setup in the admin | opens `https://<id>.web.app/admin/` (M6: the admin in its folder; the root sends there until the map is published) | signing in, claiming the map, billing and the 5 USD budget, Provision | free until Blaze |
| 8 | The server | checks billing (`gcloud billing projects describe`), then `firebase deploy --only functions,firestore,storage,hosting` | linking billing, if you have not | Blaze; the budget pauses the imagery, never the site |
| 9 | The rest of Setup | opens the admin again | Mapbox, USGS, analytics, your first city (New city) | as you choose |

> Known limitation (v1.0.0): the admin's Setup Assistant reads from `project.json` the GitHub deploy settings this repository's own project has; the file `self-host` writes has none, so Setup (step 7) cannot run in a project of your own yet (CR-M5-7, `docs/research/DECISIONS-for-review.md` §63f). Without Setup's Provision the service accounts the functions run as do not exist, so the server (step 8) cannot be deployed either, and the Blaze plan would be left without its 5 USD budget. That is why `self-host` and `deploy` refuse without `--experimental` (nothing runs); with it, stop after step 6. `--dry-run` works any time.

A "no" stops the command at that step and lists the steps left (exit status 0). A failed step shows its reason and the command to continue with (exit status 1). The `server/` folder holds the deploy files and goes into `.gitignore`: it is no part of the site.

### Options

| Option | Role |
| --- | --- |
| `--project <id>` | the Firebase project (6–30 lowercase letters, digits, dashes); without it the command asks |
| `--viewer-origin https://<user>.github.io` | the map's public site, which the functions accept (default `https://<id>.web.app`) |
| `--billing-wait <minutes>` | how long step 8 waits for billing, checking every 15 seconds (default 20; 0 checks once after Enter) |
| `--dry-run` | shows the files, commands and pages without writing, running or opening anything |
| `--lang ro`, `--lang en` | the messages' language (else `LANG`, then Romanian) |

### Later

- `npx create-historic-city@1.0.0 deploy <folder> --project <id> --experimental`: the server alone (steps 1, 8 and 9), once billing is linked (in progress, like `self-host`);
- `npx create-historic-city@1.0.0 doctor <folder>`: Node, the tools, `city.json` (valid, with your token) and the engine release in `index.html`;
- `npx create-historic-city@1.0.0 theme <folder> --seed '#1b6c4a'`: the map's colours from one colour (the four schemes of `city.json`, which the map reads, and the page's colour);
- `npx create-historic-city@<version> upgrade <folder>`: rewrites only the engine block of `index.html` at that CLI's release; the page's security policy keeps the sources you added.

### What it never does

It never asks for, writes or shows a password, a secret token or payment details; it creates no account and pays nothing; it runs nothing without your "yes" to that step; from your tools it reads only listings (`--json`) and versions, and it checks the sign-in from the text of `firebase login:list`, never from its JSON, which holds your account's tokens; it downloads nothing and contacts no server by itself. When `firebase projects:create` fails (usually a taken id: project ids are unique across Google), its message stays on screen and the command suggests another id.

## For maintainers

The package is `packages/create-historic-city/` (TypeScript under the repository's rules; its ports in `packages/create-historic-city/src/ports.ts`, the real ones in `packages/create-historic-city/src/node-ports.ts`). `npm run build --workspace create-historic-city` bundles it into one ES module with the kit's three files beside it; `npm run build:self-host` builds the admin and the functions for production, then adds the self-host bundle (the admin's production build without the legacy import, the functions' artifact, the rules and a `firebase.json` template; it refuses the admin's e2e build); the `release` stage's `self-host-bundle` gate assembles it before `release-pack`. Its unit tests are Vitest's `create-historic-city` project; behaviour V29 runs the built CLI with fake tools (`e2e/specs/starter-kit/create-city.spec.ts`). Publishing it to npm is the user's step after a release ([research/M5-interfaces.md](research/M5-interfaces.md) §4.6). Facts only a real run proves (how `firebase projects:create` and the Hosting site listing answer for a new account) are listed there under §10.
