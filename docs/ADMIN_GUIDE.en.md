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
- Approval is detected automatically and the card turns green by itself.
- To be completed (M2).

### Analytics and crash reporting

- Enable Google Analytics for the project (you accept the terms); the measurement id is detected automatically.
- The "Crash reports" panel with the latest error groups.
- Visitors are measured only after they consent.
- To be completed (M2).

## Daily work

### Photos

- Drop the files on the page; place, year and direction are filled from EXIF and the file name.
- Pin the spot on the map and click what the camera looked at (that sets the direction); the default field of view is 60°.
- Author, source and licence stay the same for the whole batch; the photo is published on save.
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
- Admins: invite by email, revoke; the owner cannot be revoked, and the last admin is protected.
- To be completed (M2–M3).

## Costs

- Google Cloud: about $0.5–2 per month; the $5 budget automatically pauses image processing (never the site).
- Mapbox: free up to 50,000 map loads per month; publishing layers uses only the free allowance, otherwise the app offers the free Studio upload, deferring, or paying.
- USGS: scanned frames are free; a new scan costs $30 per frame plus $5 per order.

## Troubleshooting

To be completed with each screen: the message shown, its cause and what to do.
