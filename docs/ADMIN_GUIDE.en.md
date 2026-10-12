# Admin Guide

Guide for the administrator of a city in **Historic City Map** (first city: **București dispărut**, Bucharest). This is the outline of the guide: sections are filled in together with the features, in milestones M2–M5. Romanian version: [ADMIN_GUIDE.ro.md](ADMIN_GUIDE.ro.md); both versions change together.

> Status: the admin app arrives in milestone M2. Until then, this guide describes what each screen will do.

## What you do and what the app does

The app does almost everything automatically. Only you can:

- create accounts and enter billing or card details (Google Cloud, Mapbox, USGS);
- accept terms and approve Google sign-in consents;
- paste the two secret keys, once: the Mapbox secret token and the USGS application token;
- pay for USGS scan orders, if you want frames that are not scanned yet.

The app opens the exact page (deep link), shows you the button, verifies the result and moves on by itself. Secret keys go straight to Secret Manager; they are not kept in the browser and never shown again after saving.

## First sign-in

- Sign in with Google. If the map has no owner yet, the app offers **I own this Google Cloud project**: Google asks you to allow read-only access to your Cloud projects, and the app checks with Google that your account owns the project. You become the map's owner; no e-mail address is configured anywhere.
- Anyone else needs an invitation: an admin enters the person's address, the app keeps only a fingerprint of it (not the address) and gives the link to send. The invited person signs in with Google at that link and chooses **Join**. An invitation expires after 14 days.
- A Google account without an invitation is told so and signed out.

## Setup Assistant

The first screen until every card is green; it can be re-checked at any time. Each step has: a status chip, the reason and the cost, a deep link, "Do it for me" where possible, a paste box with live verification, and automatic advance.

### Google Cloud: billing (Blaze) and budget

- Google sign-in with the extra billing permissions.
- Without a billing account: a deep link to Google's page where you enter the card; the app detects the new account.
- One click links the account to the project (the Blaze plan) and creates the $5 budget with alerts.
- To be completed (M2): screenshots, error messages and what each means.

### Provision cloud

- One click runs the idempotent provisioning: APIs, service accounts and permissions, buckets, identity federation for CI, secrets.
- "Doctor": the state of every item, re-checkable.
- To be completed (M2).

### Mapbox

- Leaving the demo plan: billing address and card, on Mapbox's page.
- Usage alerts in the Mapbox console.
- The secret token: you create it in the console with the scopes the app lists, and paste it once. The app checks the scopes and creates the public tokens automatically, restricted to the site's and the admin's addresses.
- To be completed (M2).

### USGS

- ERS registration and the M2M access request (the justification text is pre-written); approval takes 24–48 business hours.
- The application token: the paste box opens before you generate it, because USGS shows it for only about 60 seconds.
- Approval is detected automatically and the card turns green by itself; until then it says that USGS has not approved M2M access yet and checks again every 6 hours.
- If USGS is under maintenance or not answering when you paste the token, the token is kept and checked again later; you do not need to paste it again.
- To be completed (M2).

### Analytics and crash reporting

- Enable Google Analytics for the project (you accept the terms); the measurement id is detected automatically.
- The "Crash reports" panel with the latest error groups.
- Visitors are measured only after they consent. Google Analytics is told the page's address without its hash (which holds the visitor's view and, after *My location*, their position); withdrawing consent in About removes its cookies; the public map has no Performance Monitoring.
- In the Google Analytics web stream, keep "Page changes based on browser history events" (enhanced measurement) off: the map rewrites its address on every move. The assistant will set it for you (planned).
- To be completed (M2).

## Daily work

### Photos

- Drop the files on the page; place, year and direction are filled from EXIF and the file name.
- Pin the spot on the map and click what the camera looked at (that sets the direction); the default field of view is 60°.
- Author, source and licence stay the same for the whole batch; the photo is published on save.
- Accepted: JPEG, PNG, WebP and TIFF, up to 60 MB and 200 megapixels; SVG never. iPhone HEIC photos cannot be converted on the server yet: set the iPhone to Settings → Camera → Formats → Most Compatible, or export the photo as JPEG. A photo identical to one already uploaded is flagged as a duplicate.
- To be completed (M2): editing, unpublishing, the rights-review queue for legacy photos.

### Historical satellite layers

- "Find imagery": USGS scenes ranked by coverage, with previews.
- "Import (free)" for frames that are already scanned; "Buy scan" prepares the EarthExplorer order (you pay); "Upload GeoTIFF"; "Link a tileset or XYZ".
- The estimated cost (megabytes and Mapbox compute units) is shown before importing.
- To be completed (M3–M4).

### Georeferencing

- Control points on the scan and on the reference map (OpenStreetMap and Sentinel-2), a residual table, an overlay preview.
- A layer is published after your approval, or automatically when the error is under the threshold.
- To be completed (M3).

### Jobs, settings and admins

- Jobs: live progress, retry, cancel.
- Settings: the city's bounds, the About text (RO and EN), credits, the seed colour with a live preview.
- Admins: invite by e-mail address (only its fingerprint is stored; you send the link yourself), remove an admin or a pending invitation; the owner cannot be removed and nobody can remove themselves, so the map always keeps an admin.
- To be completed (M2–M3).

## Costs

- Google Cloud: about $0.5–2 per month; the $5 budget automatically pauses image processing (never the site).
- Mapbox: free up to 50,000 map loads per month; publishing layers uses only the free allowance, otherwise the app offers the free Studio upload, deferring, or paying.
- USGS: scanned frames are free; a new scan costs $30 per frame plus $5 per order.

## Troubleshooting

To be completed with each screen: the message shown, its cause and what to do.

### The public map (since M1)

When the city page cannot show the map, it shows a card with the message below in the visitor's language. The ones a city owner can fix:

| Message | Cause | What to do |
| --- | --- | --- |
| "The map could not be found. Please try again later." | the page found no `manifest.json` at the address in `config.js` | publish the city (M2) or correct `manifestUrl` in `config.js` |
| "The map data is invalid (problems found: N)." followed by `field: rule` | the manifest breaks a rule of City Manifest v1; the card names the first field and the rule | correct that field (in the admin from M2; in a starter-kit site, in `data/manifest.json`) |
| "config.js is missing" / "config.js is invalid: …" | the page has no `window.HistoricCityMapConfig`, or a field in it is unknown or wrong | compare `config.js` with the starter kit's (`starter-kit/README.md`) |
| "The cityId in config.js (…) does not match the map (…)." | `config.js` points at another city's manifest | make `cityId` and the manifest's city the same |
| "This map needs a newer version of this page (X). Please reload the page later." | the manifest asks for a newer engine than the page loads | load the engine version the message names |
| "Your browser cannot show the interactive map. The photo list is still available." | the visitor's browser has no WebGL | nothing: the visitor still gets the photo list |
