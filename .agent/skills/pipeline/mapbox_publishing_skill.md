# Mapbox Publishing Skill

Mapbox account `ventura86`. How tokens are handled, how historical layers reach Mapbox, and how cost is guarded. Sources: `docs/research/design-review-onboarding.md` §2B, `docs/research/design-review-security-cost.md` §1.3, §3.3, §4.4, §5.

## Hard constraints

- **No `fostulbucuresti` resources**: no tileset, style, token or streets dataset of that account, and nothing copied from it.
- **Mapbox Satellite is never used to align imagery** (Mapbox Product Terms). Georeferencing uses OSM data and open Sentinel-2.
- Historical layers come only from USGS imagery we acquire or originals the admin uploads.
- The service worker never caches Mapbox tiles or API responses.

## Tokens

- **Secret token** (created by the user in the Mapbox console, scopes `styles:read styles:tiles fonts:read tilesets:read tilesets:write tilesets:list tokens:read tokens:write`, no URL restriction; a token can only mint scopes it holds). Pasted once into the Setup Assistant; stored as `mapbox-sk-bootstrap` in Secret Manager; used only to mint and rotate.
- `setup.saveMapbox` validates it (`GET /tokens/v2` → `TokenValid`, `usage=sk`, the `user` field becomes the username), lists missing scopes by name, then mints `mapbox-sk-tiles` (`tilesets:*`, rotated quarterly) and the **public tokens**: viewer (`allowedUrls: ["https://ventura8.github.io"]`, origin only) and admin (`<proj>.web.app`, `<proj>.firebaseapp.com`), scopes `styles:read styles:tiles fonts:read`. A separate dev token is minted only if ever needed, with the port in its URL.
- `setup.rotatePublicToken` is the panic button: mint, rewrite the city doc and manifest, delete the old token after 10 minutes.
- URL restrictions are best effort (the Referer can be spoofed outside browsers): abuse is handled by usage monitoring and alerts.

## Publishing a layer

- Iteration, previews and the georeferencer run on our own COG and preview files in GCS; **nothing is published to Mapbox before approval** (or auto-approval below the RMSE threshold).
- **MTS** (automatic, billed): one deterministic tileset id per layer (`<user>.<city>-<layer>`), recipe from the layer's zoom range; the job is polled by `ops.tick`.
- **Compute-unit guard**: each MTS publish of a city crop at maxzoom 11 or more costs about 5–30 CU against 20 free CU per month. The guard estimates the CU against a month-to-date counter (`usage/mapbox-YYYY-MM`); over budget it offers the **free Studio upload** (tilesets uploaded in Studio are free: 20 uploads per month, 300 MB each; Claude uploads through the user's browser with consent), "defer to next month", or "pay about $X".
- At most 24 tilesets without the user's approval; frames of the same date are mosaicked into one tileset to save hosting.

## Cost model

- Map loads: 50,000 free per month for web; the viewer creates **one map per view**, swipe compare creates the second lazily (M4). Tests never hit Mapbox (`e2e` routes `api.mapbox.com` to fixtures).
- Usage alerts are set in the Mapbox console (no API); the Setup Assistant shows them as a manual checkbox.

## Tests

- msw handlers for `tokens/v2` (create, list, scopes, trial detection), `tilesets/v1` sources, recipe validate, publish, jobs, TileJSON and tiles, styles, fonts, sprites, `events` (204, counted).
- Test tokens: `sk.e2e-trial`, `sk.e2e-missing-scopes`, `pk.e2e-fake-token` (not JWT-shaped).
