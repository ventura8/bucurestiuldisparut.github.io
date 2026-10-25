# Trusa de pornire / Starter kit — Historic City Map

O hartă istorică pentru orașul tău în trei fișiere și un motor: o pagină, `config.js` și un manifest (`data/manifest.json`), plus motorul Historic City Map. Nu ai nevoie de server, bază de date sau cont Firebase: totul este static și merge pe GitHub Pages.

A historical map of your city in three files and an engine: a page, `config.js` and a manifest (`data/manifest.json`), plus the Historic City Map engine. No server, database or Firebase account: everything is static and runs on GitHub Pages.

The public contract (every field of `config.js` and of the manifest) is [docs/ENGINE_API.md](../docs/ENGINE_API.md).

## Ce conține / What is in it

| Fișier / File | Rol / Role |
| --- | --- |
| `config.js` | `cityId` (egal cu `city.id` din manifest / equal to the manifest's `city.id`) și `manifestUrl` |
| `data/manifest.json` | Orașul, fotografiile, straturile și punctele de interes (City Manifest v1) / the city, photos, layers and places |
| `data/media/<id>/web.webp`, `thumb.webp` | Fotografiile (2048 px și 400 px, WebP fără metadate) / the photos (2048 px and 400 px, WebP without metadata) |
| `site.json` | Titlul, descrierea și textul fără JavaScript ale paginii / the page's title, description and no-JavaScript note |
| `site.css` | Cadrul paginii (harta umple fereastra) / the page frame (the map fills the window) |

Pagina `index.html` este generată, nu scrisă de mână: are o politică de securitate a conținutului (CSP) calculată din manifest și încarcă Mapbox GL JS 3.32.0 de la api.mapbox.com cu Subresource Integrity. În acest depozit, `npm run build:site` scrie trusa completă în `dist/site/starter-kit/`.

The `index.html` page is generated, not hand-written: its Content Security Policy is computed from the manifest and it loads Mapbox GL JS 3.32.0 from api.mapbox.com with Subresource Integrity. In this repository `npm run build:site` writes the complete kit to `dist/site/starter-kit/`.

## Pași (română)

1. **Copiază trusa.** Pentru un oraș nou folosește trusa din M5, `templates/starter-kit/` ([README](../templates/starter-kit/README.md)): trei fișiere, motorul de la jsDelivr la o versiune fixă, sau `npx create-historic-city@1.0.0 orasul-meu`. Această trusă (M1) rămâne varianta pe care o construiește site-ul din acest depozit (`npm run build:site`, în imaginea Docker a depozitului, scrie `dist/site/starter-kit/`).
2. **Tokenul Mapbox.** În contul tău Mapbox creează un token **public** (`pk.…`) cu permisiunile `styles:read`, `styles:tiles`, `fonts:read` și restricționează-l la adresa site-ului tău (`https://<utilizator>.github.io`). Pune-l în `data/manifest.json`, la `city.mapbox.publicToken`. Nu folosi niciodată un token secret (`sk.…`): manifestul îl refuză. Crearea contului și a tokenului le faci tu, în contul tău.
3. **Editează manifestul.** Schimbă `city` (id, nume RO/EN, centru, limite, zoom, Despre, confidențialitate, credite, culoarea temei), apoi lista `photos`: fiecare fotografie are un `id`, un titlu, licența, locul (`location`), opțional direcția (`bearing`) și imaginile din `data/media/<id>/`. Păstrează `cityId` din `config.js` egal cu `city.id`.
4. **Înlocuiește fotografiile de exemplu.** Cele două fotografii de exemplu vin din arhiva București dispărut, sunt publicate cu permisiune doar acolo și nu pot fi republicate pe alt site: pune fotografiile tale în locul lor.
5. **Pornește GitHub Pages.** În depozit: Settings → Pages → Source: „GitHub Actions” (sau publicare din ramura principală, cu fișierele în rădăcină). După primul push, harta este la `https://<utilizator>.github.io/<depozit>/`.
6. **Verifică.** Dacă ceva nu e în regulă, pagina arată o eroare care spune exact ce câmp trebuie corectat.

## Steps (English)

1. **Copy the kit.** For a new city use the M5 kit, `templates/starter-kit/` ([README](../templates/starter-kit/README.md)): three files, the engine from jsDelivr at a pinned version, or `npx create-historic-city@1.0.0 my-city`. This kit (M1) stays the variant this repository's site build makes (`npm run build:site`, in the repository's Docker image, writes `dist/site/starter-kit/`).
2. **The Mapbox token.** In your Mapbox account, create a **public** token (`pk.…`) with the scopes `styles:read`, `styles:tiles`, `fonts:read` and restrict it to your site's address (`https://<user>.github.io`). Put it in `data/manifest.json` at `city.mapbox.publicToken`. Never use a secret token (`sk.…`): the manifest refuses it. Creating the account and the token are your own steps, in your own account.
3. **Edit the manifest.** Change `city` (id, RO/EN name, centre, bounds, zoom, About, privacy, credits, theme colour), then the `photos` list: each photo has an `id`, a title, its licence, its place (`location`), optionally the direction it looks in (`bearing`) and its images in `data/media/<id>/`. Keep `cityId` in `config.js` equal to `city.id`.
4. **Replace the example photos.** The two example photos come from the Lost Bucharest archive, are published there with permission only and may not be republished on another site: put your own photos in their place.
5. **Turn on GitHub Pages.** In the repository: Settings → Pages → Source: "GitHub Actions" (or deploy from the main branch with the files at the root). After the first push the map is at `https://<user>.github.io/<repository>/`.
6. **Check it.** If something is wrong, the page shows an error that names the exact field to fix.

## Notes

- A manifest hosted elsewhere (`manifestUrl` set to an https address) needs its origin in the page's CSP: rebuild the page after the change, the build adds it.
- The engine is copied next to the page (`engine/`). The M5 template (`templates/starter-kit/`) loads it from jsDelivr instead, at a pinned version with `integrity`.
- No cookies and no analytics unless the manifest has a GA4 measurement id and the visitor accepts; Mapbox sees each visitor's IP address (say so in your privacy text).
