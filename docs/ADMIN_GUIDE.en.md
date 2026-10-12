# Admin Guide

Guide for the administrator of a city in **Historic City Map** (first city: **București dispărut**, Bucharest). This is the outline of the guide: sections are filled in together with the features, in milestones M2–M5. Romanian version: [ADMIN_GUIDE.ro.md](ADMIN_GUIDE.ro.md); both versions change together.

> Status (M2b): sign-in, the admins page and the whole Setup Assistant below work end to end against the Firebase emulators and the fake Google, Mapbox and USGS services of the tests; the first real project is set up with Claude, with your yes at each step. The photo, layer and settings screens follow in M2c–M4.

## What you do and what the app does

The app does almost everything automatically. Only you can:

- create accounts and enter billing or card details (Google Cloud, Mapbox, USGS);
- accept terms and approve Google sign-in consents;
- paste the two secret keys, once: the Mapbox secret token and the USGS application token;
- pay for USGS scan orders, if you want frames that are not scanned yet.

The app opens the exact page (deep link), shows you the button, verifies the result and moves on by itself. Secret keys go straight to Secret Manager; they are not kept in the browser and never shown again after saving.

## First sign-in

- **A new map (no server yet)**: before billing is linked the map has no server, so the first steps talk to Google directly from your browser ("start-up mode"). Sign in with Google: Google asks you to allow read-only access to your Cloud projects, and the app checks with Google that your account owns the project. Billing, preparing the project and installing the server follow (below); as soon as the server answers, you become the map's owner automatically, without another click.
- **A map that already has a server but no owner**, for example when you come back later: the app offers **Confirm with Google**: Google asks for the same read-only access, and the app checks that your account owns the project. You become the map's owner; no e-mail address is configured anywhere.
- **Google's permission screens**: each step asks only for the access it needs, at the moment it runs (read-only at sign-in, billing for the budget, Google Cloud for preparing the project, Google Analytics for one setting); daily work asks for none. The app says why before each one. Google may say that it has not verified the app: that is expected, the app belongs to your own project; open the advanced options and continue. The access stays in the browser tab only, for at most an hour, and is never saved; when it expires, the step asks you to continue.
- Anyone else needs an invitation: an admin enters the person's address, the app keeps only a fingerprint of it (not the address) and gives the link to send. The invited person signs in with Google at that link and chooses **Join**. An invitation expires after 14 days.
- A Google account without an invitation is told so and signed out.

## Setup Assistant

The first screen until every required card is green; **Check again** re-checks the whole page or one card at any time. The page shows a progress ring ("6 of 9 steps done") and one card per step, lettered a to h. Each card has a status chip with an icon (**To do**, **Waiting**, **Done**, **Needs attention**, **Unavailable now**), why the step is needed and what it costs, the deep links to the provider's pages (each opens in a new tab), the Google permission note before any Google window, the step's own button and **Check again**. On a phone the cards form one column and the open card expands in place; from 840 px wide the list sits on the left and the open step beside it. When a step turns green the next one opens by itself (the analytics card stays open for its stream setting).

The whole assistant takes about ten clicks or fields and four Google permissions; what you do on Google's, Mapbox's and USGS's own pages is extra and only yours. Screenshots of every step, at phone, tablet, laptop and large-screen widths in light and dark, come from the end-to-end tests ([TESTING.md](TESTING.md) → *Review screenshots*).

**Start-up mode.** Until the map's server is installed, a banner says "Start-up mode: the map has no server yet, so these steps talk to Google directly." and the navigation offers Setup only. What the steps find is kept in this browser tab (never a token, an address or a card detail) and survives a reload; the server records it once it is installed.

### a. Sign-in and ownership

- **Sign in with Google** opens Google's window with read-only access to Google Cloud; Google then confirms that your account owns the project. Done.
- If the Resource Manager service is off in a brand-new project, the sign-in panel offers to enable it (one click, the Google Cloud permission).

### b. Google Cloud billing and budget

- **Link billing and create the 5 USD budget**: one click and one Google permission (billing; Google Cloud instead when the billing services must be switched on first, and then step c asks for nothing more). The app links your billing account to the project (the Blaze plan) and creates the monthly budget in the account's currency (5 USD, 5 EUR, 4 GBP, 25 RON) with alerts at 50%, 90% and 100% of the spending. The card states the cost before the click: about USD 0.5–2 a month.
- **No billing account yet**: the card says so and links **Google Cloud billing accounts**, where you create one and enter the card. It then shows "Waiting for the new billing account…" and checks every 10 seconds (for 30 minutes, while the tab is visible); the new account is linked by itself.
- **Several accounts**: choose one (the first is preselected) and **Link this account**.

### c. Prepare the Google Cloud project

- **Prepare the project**: one click (and the Google Cloud permission, unless billing asked for it already). The app prepares, in order, the 15 items listed on the card, each with its state: the Google services, the service accounts, the permissions, the storage buckets and their browser access and clean-up, the places for the secret keys, the publishing queue, keyless installation from GitHub, App Check, the budget alerts, the organisation's policies, e-mail on new crashes and the browser key's restriction. Running it again changes nothing that is in place.
- An item that fails says why and the items that need it wait ("Waiting: …"); the others go on. **Retry what failed** repeats only those (one click each time).
- "The periodic check" waits with "Created by the first server installation."; that does not hold the step back.

### d. Installing the map's server

- The server (the Firebase functions) is installed by GitHub Actions on the next push to `master`, or by Claude after your yes. The card lists the GitHub repository variables the installation reads, each with a copy button, shows "Checking every 30 seconds…" and "N of 33 functions installed", and turns green by itself once every function is installed and answers.
- A function that failed to install is named; "The functions are installed but do not answer" points at an organisation policy that blocks public access.

### d2. Taking over the map

- As soon as the server answers, the app makes you the map's owner with the Google permission it still holds (no click), creates the city from the old site's data, records what start-up mode found and leaves start-up mode: the banner goes and the navigation shows Setup, Admins and Crashes. The Mapbox card opens.
- If the Google permission has expired (more than an hour, or the page was reloaded), the claim panel asks for one click: **Confirm with Google**.

### e. Mapbox

- Create the account and leave the demo plan on Mapbox's pages (card and billing address; the card's link says to choose *Rotate token*), tick the usage alerts, then create the secret token `historic-map-server` with the scopes the card lists (**Copy the scopes**).
- Paste the token into **Secret token (sk.…)**: the card says "This looks like a secret token." before anything is sent (a public `pk.` token is explained instead). **Save**: the token goes to Secret Manager once, and the app creates the public tokens of the site and the admin, restricted to their addresses.
- A demo account cannot create tokens: the card says "Mapbox did not create the public token. Check the billing details of the Mapbox account." with the link to add the payment method; add it on Mapbox's page and paste the token again.

### f. USGS

- Register on ERS and request M2M access with the pre-written answers and request text (**Copy the request text**); approval takes 24–48 business hours.
- Type the **ERS username** (and, optionally, the token's expiry date), then **Open the USGS token page**: the paste box opens first and a 60-second countdown starts ("Paste the token within 60 s"), because USGS shows a new token for about a minute. Paste it: it is checked and saved at once, without a Save click. If the time runs out, the card says so and the box stays open: create a new token.
- Before approval the card is **Waiting** with "USGS has not approved M2M access for this account yet. We check again every 6 hours." and the next check's time. The server notices the approval on its own; the card is green the next time you open the admin.

### g. Analytics and crash reports (optional)

- Follow the link to the Firebase console and enable Google Analytics for the project (you accept Google's terms there). The card then checks every 15 seconds for 15 minutes and shows the measurement id.
- **Stop counting address changes as page views**: one click and the Google Analytics permission; the map rewrites its address on every move, so the stream's history page views must stay off. The card then says "Address changes are no longer counted as page views."
- **E-mail me about new crashes** is on by default; switching it asks for the Google Cloud permission.
- The **Crash reports** panel (also the **Crashes** page) lists the error groups of the last seven days.
- Visitors are measured only after they consent; Google Analytics never receives the address's hash, which holds the visitor's view and position.

### h. The old Bucharest photos (optional)

- **Import the 45 photos**: one click. The photos go through the normal processing three at a time ("N of 45 photos imported"), are published once processed and stay in the rights-review queue; the card ends with "All 45 photos are on the map." and the city's public data lists them. Importing again, or after a closed tab, adds nothing twice and finishes only what is missing.
- A photo that could not be processed is listed with its reason; the others are imported.

### When a step says something else

| Message | Cause | What to do |
| --- | --- | --- |
| "Only the owner of Google Cloud project … can set up this map." | the account is not the project's owner, and the map has no server yet | sign in with the owner's Google account |
| "The map's server is not answering right now. Try again in a minute." | the map was set up but its server is down | **Try again**; if it lasts, check the installation (step d) |
| "This step needs the permission "…", which was not ticked at Google. Nothing changed." | a permission was unticked in Google's window | click the step's button again and leave it ticked |
| "The browser blocked the Google window. Allow pop-ups for this site." | pop-ups are blocked | allow pop-ups for the admin's address |
| "You chose another Google account than the one signed in. Choose the same account." | another account was chosen in Google's window | choose the signed-in account |
| "This step's Google permission expired after an hour. Continue to renew it." | the permission is kept for at most an hour | **Continue** (one click, one permission); the step resumes where it stopped |
| "This billing account already has the most projects it may have. …" | Google's limit of projects per billing account | choose another account, or ask Google for more |
| "No new billing account in 30 minutes. …" | the account was not created yet | create it, then **Check again** |
| "The organisation's policy … blocks this item." | a rule of your Google organisation | the guide of that rule; changing it is your decision |
| "The server account lacks the role … in the project." | a role is missing for the account that made the call | grant the named role, then **Retry what failed** or **Check again** |
| "The function … was not installed. Run the installation again." | a function failed to deploy | run the installation again |
| "Still not installed after two hours. …" | the installation did not run | run it (GitHub Actions or Claude), then **Check again** |
| "Mapbox refused the token: it is invalid or has been revoked." | a wrong, deleted or revoked token | create the token again and paste it |
| "The token lacks these scopes: …" | scopes were not ticked | create the token again with every scope the card lists |
| "USGS refused the username or the token. …" | a wrong username or an expired token | create a new token and paste it within 60 seconds |
| "USGS is under maintenance. We will retry automatically." | USGS maintenance | nothing: the token is kept |
| "Google Analytics is not enabled for the project. …" | Analytics is off | enable it in the Firebase console (the card's link) |
| "Photos not processed: N. The reason is shown next to each." | a photo of the bundle could not be processed | **Check again**, or edit the photo once the photo screens exist (M2c) |

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
