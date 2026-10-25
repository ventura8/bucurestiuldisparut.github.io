# create-historic-city

Harta istorică a orașului tău: fotografii vechi, locuri dispărute și hărți de odinioară pe harta de azi, cu motorul Historic City Map.

A historical map of your city: old photos, vanished places and maps of the past over today's map, with the Historic City Map engine.

## Română

```bash
npx create-historic-city@1.0.0 orasul-meu
```

Întreabă numele orașului (în română), dreptunghiul lui pe hartă (`vest,sud,est,nord`; pe openstreetmap.org, butonul Export le arată), culoarea temei și tokenul public Mapbox (Enter păstrează valoarea implicită), apoi scrie trei fișiere într-un folder nou: `index.html` (motorul de la jsDelivr, la o versiune fixă și cu verificare de integritate), `city.json` (orașul, locurile, fotografiile și straturile) și `README.md` (pașii: tokenul public Mapbox, editarea, GitHub Pages). Nu ai nevoie de server.

Cu propriul tău proiect Firebase și aplicația de administrare (Asistentul de configurare, editoarele, imaginile istorice USGS): **în lucru**. Asistentul de configurare nu rulează încă într-un proiect al tău (CR-M5-7), deci nici serverul nu se poate publica; `self-host` și `deploy` refuză fără `--experimental` și nu rulează nimic. Cu el, oprește-te după pasul 6:

```bash
npx create-historic-city@1.0.0 self-host orasul-meu --project <id> --experimental
```

Fiecare pas spune ce face și cât costă și întreabă `y/N`; rulează doar uneltele tale (`firebase`, opțional `gcloud`) și deschide paginile Google unde te conectezi, accepți termenii și legi plata. Comanda nu cere, nu scrie și nu afișează niciodată parole, tokenuri secrete sau date de plată și nu contactează singură niciun server. `--dry-run` arată totul fără să facă nimic. Alte comenzi: `theme` (culorile hărții dintr-o culoare), `deploy`, `upgrade`, `doctor`, `--help`.

## English

```bash
npx create-historic-city@1.0.0 my-city
```

It asks for the city's name (in Romanian), its rectangle on the map (`west,south,east,north`; on openstreetmap.org, the Export button shows them), the theme's colour and the Mapbox public token (Enter keeps the default), then writes three files into a new folder: `index.html` (the engine from jsDelivr, at a pinned version with an integrity check), `city.json` (the city, its places, photos and layers) and `README.md` (the steps: the Mapbox public token, editing, GitHub Pages). No server needed.

With a Firebase project of your own and the admin app (the Setup Assistant, the editors, the USGS historical imagery): **in progress**. The Setup Assistant cannot run in a project of your own yet (CR-M5-7), so the server cannot be deployed either; `self-host` and `deploy` refuse without `--experimental` and run nothing. With it, stop after step 6:

```bash
npx create-historic-city@1.0.0 self-host my-city --project <id> --experimental
```

Each step says what it does and what it costs and asks `y/N`; it runs only your own tools (`firebase`, optionally `gcloud`) and opens the Google pages where you sign in, accept the terms and link billing. It never asks for, writes or shows a password, a secret token or payment details, and it contacts no server by itself. `--dry-run` shows everything and does nothing. Other commands: `theme` (the map's colours from one colour), `deploy`, `upgrade`, `doctor`, `--help`.

The full guide: [docs/SELF_HOST.md](https://github.com/ventura8/bucurestiuldisparut.github.io/blob/master/docs/SELF_HOST.md). The engine's contract: [docs/ENGINE_API.md](https://github.com/ventura8/bucurestiuldisparut.github.io/blob/master/docs/ENGINE_API.md).
