# Admin Guide

Guide for the administrator of a city in **Historic City Map** (first city: **București dispărut**, Bucharest). This is the outline of the guide: sections are filled in together with the features, in milestones M2–M5. Romanian version: [ADMIN_GUIDE.ro.md](ADMIN_GUIDE.ro.md); both versions change together.

> Status (M5): sign-in, the Setup Assistant, the daily editors below (Home, photos, places, layers, settings, history, jobs, admins and crash reports), the historical imagery (search USGS, import a free frame, the automatic georeferencing with its suggested pairs, Approve, the compute-unit guard, the free Studio upload, a GeoTIFF upload, the georeferencer, crop, replace), buying a scan (the order card, I ordered it, the daily watch, the reminders and the import on delivery), the notifications (the inbox, and push on a device you turn it on for) and the editors' assists (title suggestions from OpenStreetMap, Romanian and English drafts) work end to end against the Firebase emulators and the fake Google, Mapbox, USGS, OpenStreetMap and Vertex AI services of the tests, and what is published reaches the public viewer, whose swipe compare shows two layers side by side; the raster pipeline itself was run against the same fakes on a synthetic frame. Since M5 one project holds several cities (the city menu, New city, Publishing, roles per city, each city's budget and its static export), each closed to the admins of the others, and a city made in the admin gets its own public site; the tests take a new city from New city to its public site and to an export that runs with no Firebase. On the real cloud it waits for the server's deploy, Provision turning on the Vertex AI and FCM APIs, and your first real scan purchase (`docs/research/M4-status.md`, `docs/research/M5-status.md`). The first real project is set up with Claude, with your yes at each step.

## What you do and what the app does

The app does almost everything automatically. Only you can:

- create accounts and enter billing or card details (Google Cloud, Mapbox, USGS);
- accept terms and approve Google sign-in consents;
- paste the two secret keys, once: the Mapbox secret token and the USGS application token;
- pay for USGS scan orders, if you want frames that are not scanned yet: the app opens the scene's own EarthExplorer page, you buy the scan there, come back and click **I ordered it**; the rest is automatic.

The app opens the exact page (deep link), shows you the button, verifies the result and moves on by itself. Secret keys go straight to Secret Manager; they are not kept in the browser and never shown again after saving.

## First sign-in

- **A new map (no server yet)**: before billing is linked the map has no server, so the first steps talk to Google directly from your browser ("start-up mode"). Its first deploy (the admin alone, before the server) says so, so the page does not even try the server: `HCM_ADMIN_START_UP=1 npx firebase deploy --only hosting`, done by Claude with your yes. Sign in with Google: Google asks you to allow read-only access to your Cloud projects, and the app checks with Google that your account owns the project. Billing, preparing the project and installing the server follow (below); as soon as the server answers, you become the map's owner automatically, without another click.
- **A map that already has a server but no owner**, for example when you come back later: the app offers **Confirm with Google**: Google asks for the same read-only access, and the app checks that your account owns the project. You become the map's owner; no e-mail address is configured anywhere.
- **Google's permission screens**: each step asks only for the access it needs, at the moment it runs (read-only at sign-in, billing for the budget, Google Cloud for preparing the project, Google Analytics for one setting); daily work asks for none. The app says why before each one. Google may say that it has not verified the app: that is expected, the app belongs to your own project; open the advanced options and continue. The access stays in the browser tab only, for at most an hour, and is never saved; when it expires, the step asks you to continue.
- Anyone else needs an invitation: an admin enters the person's address, the app keeps only a fingerprint of it (not the address) and gives the link to send. The invited person signs in with Google at that link and chooses **Join**. An invitation expires after 14 days.
- A Google account without an invitation is told so and signed out.

## Setup Assistant

The first screen until every required card is green; **Check again** re-checks the whole page or one card at any time; on the whole page it also lists the **Server checks**, each with its state, and a failing one says why and links the step that fixes it. The page shows a progress ring ("6 of 9 steps done") and one card per step, lettered a to h. Each card has a status chip with an icon (**To do**, **Waiting**, **Done**, **Needs attention**, **Unavailable now**), why the step is needed and what it costs, the deep links to the provider's pages (each opens in a new tab), the Google permission note before any Google window, the step's own button and **Check again**. On a phone the cards form one column and the open card expands in place; from 840 px wide the list sits on the left and the open step beside it. When a step turns green the next one opens by itself (the analytics card stays open for its stream setting).

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

- The server (the Firebase functions) is installed by GitHub Actions on the next push to `master`, or by Claude after your yes. The card lists the GitHub repository variables the installation reads, each with a copy button, shows "Checking every 30 seconds…" and "N of 35 functions installed", and turns green by itself once every function is installed and answers.
- A function that failed to install is named; "The functions are installed but do not answer" points at an organisation policy that blocks public access.

### d2. Taking over the map

- As soon as the server answers, the app makes you the map's owner with the Google permission it still holds (no click), creates the city from the old site's data, records what start-up mode found and leaves start-up mode: the banner goes and the navigation shows Setup, Admins and Crashes. The Mapbox card opens.
- If the Google permission has expired (more than an hour, or the page was reloaded), the claim panel asks for one click: **Confirm with Google**.

### e. Mapbox

- Create the account and leave the demo plan on Mapbox's pages (card and billing address; the card's link says to choose *Rotate token*), tick the usage alerts, then create the secret token `historic-map-server` with the scopes the card lists (**Copy the scopes**).
- Paste the token into **Secret token (sk.…)**: a secret token is saved at once, with no other click (a public `pk.` token is explained instead and nothing is sent; a token typed by hand goes with Enter or **Save**, after the card says "This looks like a secret token."). The token goes to Secret Manager once, and the app creates the public tokens of the site and the admin, restricted to their addresses.
- **Replace the visitors' token** and **Replace the admin's token** (once Mapbox is saved) make a new public token after a confirmation; the card says when the old one is deleted (ten minutes later, so open pages keep working). Use it when a token leaked.
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
| "USGS is under maintenance. Try again later." | USGS maintenance | nothing: the token is kept and checked again later |
| "Google Analytics is not enabled for the project. …" | Analytics is off | enable it in the Firebase console (the card's link) |
| "Photos not processed: N. The reason is shown next to each." | a photo of the bundle could not be processed | **Check again**, or open the photo on the Photos page |

## Daily work

The navigation holds Home, Setup, Photos, Places, Layers, Historical imagery, Jobs, Notifications, Settings, Admins, History and Crashes (on a phone the bar keeps Setup, Photos, Places and Layers, the rest is under **More**; Notifications, or More when it holds it, carries the number of unread notifications). Every editor works the same way:

- **Lists and editors.** From 840 px wide the list sits on the left and the open item beside it; on a tablet the item replaces the list, with **Back**; on a phone it fills the page, with **Close**. An item's address (`#/photos/<id>`) can be bookmarked or sent to another admin.
- **Drafts.** What you change is a draft: the page's map previews it at once and nothing is written until **Save**. Save writes one change, stamped with your account; the public map follows within about a minute. **Discard changes** puts the saved version back. Leaving the page, signing out or reloading with unsaved changes asks first (**Keep editing** or **Discard**); switching the language keeps the draft. A field with a problem says so under it, and Save stays off until it is corrected (and says why); a number (a year, a latitude) counts as you type it and says its problem once you leave the field, so a half-typed year does not flash an error.
- **Another admin saved the same item meanwhile**: the editor names them and the time; the fields only they changed are merged in, and for the fields you both changed you choose to keep yours or take theirs. An item deleted meanwhile cannot be saved; History restores it.
- **Every change is kept in History** (below) and can be reverted with one click.
- **Before the Mapbox card is done** (no admin token yet), the editors' map box says so and links the card; every field and the list of positions still work.

### Home

What the city holds and what waits for you (photos whose rights are to be checked, unpublished photos, running or failed jobs), each a link to its page, one chip per Setup area and the public map's state. Once Setup is complete the admin opens here (`docs/research/DECISIONS-for-review.md` §41c). **Not on the public map** lists every published item the public map left out, with what to correct and a link to its editor.

### Photos

- **Add photos**, or drop the files on the list: JPEG, PNG, WebP and TIFF up to 60 MB. A bigger file, or a file of another kind, is refused in the page before anything is uploaded. Three files upload at a time, each with its progress; an interrupted upload resumes, and **Retry** starts it again.
- **Filled for you**: the title from the file name; the place, year and direction from EXIF for the photos you have not touched yet (a place outside the city is ignored); the author, source, licence and rights holder of your previous batch ("New photos get: …"). A photo without a place goes to your last pin (or the city's centre) and is marked **Check the place** until you move its pin or choose **Confirm place**; bulk Publish skips it meanwhile. After a reload, EXIF values not applied yet show as suggestions with **Apply**.
- **Filters**: All, Unpublished, Processing, Refused, Rights to check; **Search by title or author**.
- **The editor**: the title and description (Romanian required, English optional: visitors then read the Romanian), the date and the years, author, licence, rights holder, source, permission note, up to 5 https links, rights to check, **Published on the public map**. When a photo opens, the map centres on it (its zoom kept). The place: drag the pin, click on the map, or type the latitude and longitude; **Set direction on the map**, then click on what the camera looked at (with the keyboard: **Point at map centre**); the **Field of view** slider widens the view cone live. A photo uploaded in this session starts with Published on (it is published on save); a photo still processing, refused, or with the licence unknown cannot be published, and the switch says why.
- **Several photos at once**: tick them (or **Select all**), then **Publish**, **Unpublish**, **Author, source and licence**, confirm the rights, or **Delete**. A photo the action cannot change is left as it is and named with its reason (**See why**).
- **Replace image** (in the editor): the new file is processed while the old image stays on the public map, then takes its place in one step. A refused file leaves the old image published and says why; the same file again changes nothing; **Cancel the replacement** stops the upload.
- **Delete photo** asks first; the message after it offers **Undo** for ten seconds, and History restores the photo later (one whose public files were already cleaned up is processed again from its kept original).
- iPhone HEIC photos cannot be converted on the server yet: set the iPhone to Settings → Camera → Formats → Most Compatible, or export the photo as JPEG. A photo identical to one already uploaded is marked as a duplicate, with a link to the first one.

### Places

- **Add place**, then **Point**, **Line** or **Area**. Draw on the map (Enter or a click on the first vertex finishes a line or an area, Esc removes the last vertex), or use **the list of positions**: **Add at centre** puts a position at the map's centre (the city's starting view when there is no map), the latitude and longitude can be typed, and positions can be moved up, down or removed. A position outside the city, crossing edges, more than 500 positions or a shape without area are refused at once, each with its reason.
- **A saved place** opens with its shape selected, and the map centres on it (its zoom kept), so a place outside the city's starting view is on the map at once. Drag the shape by its inside to move it, a corner to move that position, or the dot in the middle of an edge to add a position there; the list of positions follows each drag, and Save writes it. A drag that would make the edges cross stops before they do.
- The category (for a new place, the last one you used), the titles, the description in the Markdown subset with a preview (bold, italics, https links; HTML stays plain text), the years (either may stay empty), up to 5 links, up to 20 linked photos, **Published**. A new place is published on save; **Redraw as …** changes the shape (after asking).
- The category chips, Unpublished and a title search filter the list. Several places at once: **Publish**, **Unpublish**, **Move to category…**, **Delete**.
- **Export all (GeoJSON)** saves every place (or the selection) as a `.geojson` file. **Import GeoJSON** reads such a file (up to 5 MB) in the page: a preview counts the new, changed, unchanged and refused places, each refusal with its reason (an unsupported shape, an altitude, an open ring, a position outside the city, an unknown category, too many positions); places without a known category take the one you choose; **Import** writes them (at most 5,000 places in all). A file exported and imported again changes nothing.
- **Delete place** asks first; History restores it.

### Historical layers

- Layers are made by the raster pipeline (M3); until then the page says so. The list shows them in drawing order (the first is drawn on top), with their state and Published; drag one, or use **Move up** and **Move down**.
- **The layer editor**: the label and description (Romanian, English optional), the attribution, year and date, **Shown when the map opens**, **Default opacity**, and four image adjustments, **Black level**, **White level**, **Contrast** and **Saturation**, each read as a signed percentage, with **Reset the adjustments**. Every slider changes the page's map at once; Save publishes the values, and visitors see exactly what you saw. The black level never passes the white level.
- **Link a layer**: a tileset of the city's own Mapbox account, or the https address of a tile server. Another account's tileset (Mapbox's own included) and an address with a key in it are refused before anything is sent. **Check** asks the server for one tile of the city's centre and says what answered ("Tiles answer (image/png)."), or why nothing did (no tiles at this address, not an image, the server not responding); after a failed Check, Link stays off until the address changes. A linked layer starts unpublished and hidden at start. A tile server's address must also be allowed in the site's and the admin's content security policy: the dialog names it.
- **Delete the layer** asks first: the layer leaves the public map within a minute, and its Mapbox tileset is deleted seven days later unless you restore the layer from History meanwhile (the waiting job is on the Jobs page).
- **Image and geometry** (a layer made from imagery): **Replace the image** opens the Imagery upload for this layer (choose a GeoTIFF; nothing else is asked, the layer keeps its year); **Georeference again** opens the georeferencer on the layer's current image; **Crop** draws the area to keep on the layer's map, a click per corner (from the keyboard: **Add a corner at the map's centre**), then **Save the crop**; an area off the layer is refused. Each makes a new version: the layer keeps its tiles until that version is published, and the editor shows **A new version is under way: open it** meanwhile. A layer something is being made for cannot be deleted until it is done.

### Settings

Each section has its own Save.

- **City area**: the map above shows the city and its bounds; the bounds are typed, or drawn: **Draw the area on the map**, then click two opposite corners. The starting view: move the map, then **Use this view**; the minimum and maximum zoom. Bounds that would leave photos or places outside are refused, and the page lists them.
- **Texts**: the name, About and the privacy text in Romanian and English (the Markdown subset, previewed as visitors will see it; a link that is not https is refused at its line), and the credits (up to 50, in the order you choose).
- **Theme and basemap**: the seed colour (a hex value, the colour picker or one of eight presets), previewed live on the whole admin until you save or discard it (or leave Settings); a colour that would leave text unreadable is moved to the nearest readable tone, with a note. The basemap the visitors see (Standard or Standard Satellite); the admin's own map is always Standard.
- **Place categories**: add one (the Romanian label; its icon follows the label's words, "Fântâni" water, "Biserici" a church, until you pick one; the colour, the opacity and the English label have defaults), edit, reorder, delete. The icon picker offers 30 icons, and the arrow keys move through them; a colour on which the white icon would be hard to see is moved to a readable tone. Deleting a category that places still use asks where they go first. The page says when the limit is reached.
- **Historical imagery**: whether a georeferenced frame is published without a click when its checkpoint error is under the threshold (on by default), that threshold in metres (1–200, 15 by default), and the years the search ranks first (at most 20, each with **Remove**; Bucharest's are 1966, 1976, 1977, 1978 and 1980: add them here once). Saved on its own.
- **Default opacities**: the opacity every overlay starts with (each layer, the photos, each place category) and, for layers, whether they show at start, each change previewed on the map above; one Save writes them all, Discard brings the stored ones back. A visitor's own link that sets an opacity still wins.

### History

- **History** lists the city's changes, newest first, with who made them and when; filter by what changed (photos, places, layers, place categories, city settings) and by the kind of change (changed, created, deleted, reverted). The History link of a photo or a place opens that item's versions, each with the fields it changed, before and after.
- **Revert to this version** (asked first) brings that version's fields back; the current version stays in History, so a revert can be undone too. With the change filter on **Deleted**, each deleted item offers **Restore**. A version that today's rules refuse is not brought back, and the page says why.

### Jobs

The live list of jobs (Running, Failed, Finished) with their progress; a job's steps and log as they arrive; **Cancel job** (asked first) while it runs. A layer deletion waits with its date ("Runs after …, with the raster pipeline"). An imagery job names each of its steps, says why it waits and until when (USGS preparing the download or under maintenance, this month's Mapbox budget, your points), offers **Run it again** when it failed (three tries at most; the steps already done are not done again) and **Open the georeferencer** when it waits for your points.

### Admins

- **Invite** an admin with their Google account's address: only its fingerprint is stored; the link is copied for you as the invitation is made (**Copy the link** copies it again), and you send it yourself. The invitation expires after 14 days and can be cancelled. The invited person opens the link, signs in with that Google account and chooses **Join**.
- **Remove access** asks first and names the admin. From then on that admin can save nothing: their next save is refused. If they were editing, their page stays as it was, with their changes, read only (Save and every action off), under the message "Your access was removed: nothing more can be saved. Copy what you need, then sign out." and **Sign out** (nothing more is sent); otherwise they are told the account is no longer an admin. The owner cannot be removed and nobody can remove themselves, so the map always keeps an admin.

### Crash reports

The errors visitors and admins ran into, grouped, over 24 hours, 7 days or 30 days, with their count and releases (the admin's release names its version and the commit it was built from, such as `1.0.0+5d02329`); a group shows when it was first and last seen, and its message and stack as plain text, with personal data removed, and **Open in Error Reporting** opens that group in the Google Cloud console. When Error Reporting is off in the project, the page says so and links the analytics card of Setup.

### From your Save to the visitors' map

Every Save of something published asks the server to rebuild the public map's data (the manifest), at most once a minute; visitors see the change on their next visit. The end-to-end tests check the whole chain on the emulators: a photo published, renamed, reverted and unpublished; a place added from the keyboard; a layer's default opacity, shown-at-start switch and adjustments; each reaches the built viewer exactly as saved (scenarios S-A41-*).

### Historical imagery (M3)

Declassified USGS satellite frames (Corona, Gambit, Hexagon; 1960–1984) become historical layers of the map. The usual way is one click: **Import (free)**, and the server does the rest.

- **Find**: the first time you open **Historical imagery** (and once a month after that), the app searches USGS's three declassified collections over the city's area and ranks the scenes from 0 to 100, the free ones (already scanned) first; each says why in plain words (how much of the city it covers, free or to order, a year the city wants, clouds, detail, a year that already has a layer). Filters: **Free only** (on), **Hide rejected**, the three collections, from and to a year; the map draws every listed scene's outline. **Search USGS again** searches again. When nothing is found, the page suggests every year, all three collections, the scenes to order too, and the city's area in Settings (the search covers only that area).
- **Import (free)** on a scene's card, or on its page (its USGS preview, its facts and every reason of its rank). The server downloads the frame, unpacks and stitches it, finds the city on it, prepares the reference (OpenStreetMap and Sentinel-2, never Mapbox Satellite), matches control points on its own, warps and exports it. The version's page shows each step as it runs, the log, and **Cancel** (asked first; Mapbox's own processing cannot be stopped). USGS under maintenance makes it wait, not fail.
- **Publishing**: when the checkpoint error (control points left out of the fit) is under the city's threshold, 15 m by default, it is published without another click. Otherwise the approval card shows the fit and checkpoint errors, the pairs, the Mapbox compute units it costs and those left this month, with **Approve and publish** and **Reject** (asked first). An uploaded GeoTIFF that carries its own georeference always waits for Approve: its error cannot be measured.
- **Over the month's free compute units** (20 a month; a publish costs by area and zoom): the card offers three ways out, each saying what it means: **Free: upload the file in Mapbox Studio** (1. **Download the file**, 2. open Mapbox Studio and upload it as a tileset, 3. **I uploaded it**: the app finds the tileset by its name), **Wait for next month**, or **Publish now, at a cost of about X USD** (asked first; never past Mapbox's 24 tilesets).
- **Too few matching points**: the import waits for yours ("Reliable points the automatic georeferencing found: N, too few"): **Open the georeferencer**.
- **A file too large for Mapbox**: the approval card says so and offers the one way that works, the free Studio upload of the smaller copy. **At Mapbox's 24 tilesets**: neither paying nor waiting frees a place; delete a layer you no longer need (**Open Layers**) or use Studio.
- **When something fails**, the version's page offers what cures it: **Try again** when another run can help (three runs and six publish starts at most), **Open the Mapbox step of Setup** when Mapbox refused the token or its scopes, **Upload another file** when the server refused your upload, and **Dismiss** (asked first) to take a failed version out of **Waiting for you**. **Cancel** works until Mapbox is asked to publish.
- **The georeferencer**: the scan and the reference map side by side (on a phone one at a time, with **Scan** and **Map**; half a pair shows the other pane by itself). Click a place on the scan, then the same place on the map, or by keyboard: move the scan with the arrow keys and the map to the same place, then **Add at the centres**, and again for the next pair; a pair chosen in the table moves with the arrow keys (Shift: ten times further), **Esc** lets it go and **Delete** removes it; every pair refits at once: the table of pairs (each with where it came from, **in the fit** or kept as a checkpoint, and its error in metres; sorted by pair or by error), the fit and checkpoint errors with a warning over the threshold, the transforms the pairs allow (affine from 3, second-order polynomial from 6, thin-plate spline), and the warped preview on the map. Pairs that lie on one line are refused. **Save and georeference** continues the waiting import, or makes a new version of a published layer.
- **Upload**: **Upload a GeoTIFF** (up to 8 GB; the page reads its first bytes and refuses anything that is not a TIFF before sending it). A name with a year ("Plan 1911.tif") starts the upload at once, otherwise the page asks for the year. A large upload goes on after the connection drops. A GeoTIFF with its own georeference goes to the approval card; a scan without one waits for points in the georeferencer.
- **Before USGS approves your downloads** (24–48 business hours after the M2M request): the ranked results show, Import is off, and the page says why with the way to Setup's USGS step. A token USGS refuses links to the same step.
- Limits: 10 imports a day and 2 running at once, per project.
- **Paused by the budget guard**: when the month's Google Cloud cost reaches the budget, imports, retries, the georeferencer's saves, crops and publishes stop (the public map never does). **Historical imagery** and **Jobs** say so with the cost and the budget, and **Resume processing** (asked first) starts them again for the rest of the month; next month's alert pauses them again.

### Buying a scan, suggestions, assists and notifications (M4)

- **A frame USGS has not scanned yet** (Free only off, chip **Must be ordered from USGS**) has the **Buy this scan** card on its page: the cost (35 USD for one frame: 30 USD a frame and 5 USD an order, paid to USGS directly, never through this app), the four steps in EarthExplorer and **Order in EarthExplorer**, which opens the scene's own page there in a new tab. Buy it there (USGS asks for payment by card or by phone), come back and click **I ordered it**: that is the flow's second and last input (the message after it offers **Take the mark back**). A frame USGS already offers cannot be marked ("This frame is already scanned: import it for free, no order needed."); one USGS scanned while you were buying turns free on its page, and a message says so. Until USGS approves your account's downloads, both cards say the daily check waits for that approval, with a link to Setup's USGS step.
- **After I ordered it, nothing is asked of you**: the server asks USGS once a day (**Check now** asks at once, at most once a minute), reminds you on days 7 and 12 to pay if you have not (USGS deletes unpaid orders after 14 days), imports the scan the moment USGS delivers it (delivery takes three to four weeks after payment), georeferences it and publishes it under the city's threshold, exactly like a free import. An order not delivered within 90 days becomes **Never delivered**, with **Order it again** and **Take the mark back** (if you no longer want it). **Take the mark back** also undoes a mark made by mistake. The times of the checks are in your own time zone. The scene's card shows a short chip (Ordered, Ordered: paid?, Delivered, Importing, Never delivered), and **Work** lists the open orders, the one that needs you first: only an order never delivered counts there (a reminder to pay, once sent, asks nothing more of you if you have paid).
- **Suggested pairs in the georeferencer**: when the automatic georeferencing finds too few pairs it trusts, the less sure ones it found wait in **Suggested pairs**, each with its confidence in words and as a bar, and how far it is from the current fit. **Accept** or **Reject** each (on a suggestion, Enter accepts and Delete rejects, and the next one takes the focus), or **Accept all**; accepted pairs join the table and refit at once. Nothing is saved without **Save and georeference**. On the scan the suggestions are dashed rings; on the map they are flags in their own colour.
- **Title suggestions** (places and photos): under the title, **Suggest a title** asks OpenStreetMap what is at the point (a point you draw on the map, or a photo's pin while its title is still the file's name, such as `IMG 0412`, asks by itself), and each answer is a button **Use the title "…"**. At most 300 places a day are asked for the whole project (OpenStreetMap's rules forbid bulk use). OpenStreetMap is asked at most once a second for the whole project, and every answer is kept for 90 days; the suggestions name their source (© OpenStreetMap contributors, ODbL). The title stays as you typed it until you choose one, and Save writes it.
- **Romanian and English drafts** (the titles, descriptions and labels of photos, places and layers): **English draft** beside a Romanian text while the English one is empty (or **Romanian draft** beside an English one while the Romanian one is empty; a draft never replaces what you typed) asks Google's Gemini model, on the server, for a translation into the other field, marked "Draft proposed by …: check it before you save." The draft is plain text, cut to the field's length (the page says so), and is never published by itself: only your Save writes it. At most 500 drafts or 0.50 USD a month for the whole project; past that, the page says so until next month. A draft that adds a link the text did not have, or changes an address, is not used (the page says so).
- **Notifications**: what the server did that concerns you (a scan delivered, imported, an order to pay or never delivered, a failed processing, a layer waiting for approval or for points, the budget pausing the processing, a burst of crash reports, USGS approving downloads) reaches every admin's **Notifications** page, newest first, unread ones marked; a click opens the page it is about and marks it read; **Mark all as read** marks the rest. **Notifications on this device** turns on push notifications for this browser (the browser asks you first; refused, the inbox still works); on a computer you share, it belongs to whoever turned it on last, and signing out turns it off for you (so does being removed as an admin). Turning it off when the server cannot be reached leaves it on and says why. **Send a test notification** tries it, and **Notifications on devices** chooses which kinds also show on your devices. No e-mail is sent (it would need a new provider: `docs/research/DECISIONS-for-review.md` §54i).
- **The visitors' swipe compare** (on the public map): the Layers panel's **Compare** opens a second map beside the first, with a divider to drag (or move with the arrow keys); **Compare with** chooses the other side (another historical layer or today's map), and each side keeps its layer's opacity. On a window narrower than 600 px a toggle switches between the two sides of one map. A link copied while comparing reopens the comparison.

### Several cities: the city menu, New city, publishing, roles, budgets and the export (M5)

One project can hold up to 20 cities, each with its own photos, places, layers, settings, admins, budget and public map. An admin of one city sees and changes nothing of another, whatever they try: the rules and every function check the city.

- **The city menu**: an admin of two cities or more, and the project's owner, sees the open city's name in the top bar (on a phone, in the account menu). The menu lists your cities, each with your role in it (**Owner**, **Editor**), the open one marked; choosing another opens it (the page loads again, into its Home). The address names the city (`#/c/<city>/...`), so a copied link opens the same city; an admin of one city sees no menu and no city in the address. A link to a city you do not administer opens your own, with a message saying so. With unsaved changes, the admin asks first.
- **New city** (the project's owner: **New city** at the end of the city menu): the name in Romanian (the id follows it: lower-case letters, digits and hyphens, the city's address on the public site), then **Create the city**: two inputs. Once you stop typing, the app finds the city on OpenStreetMap, draws its rectangle and moves the map there ("Found on OpenStreetMap: …"); adjust it if the city is larger or smaller. A name OpenStreetMap does not know leaves the rectangle to you: drag it over the city on the map (or **Draw the area** and click two corners, or type the four edges: the rectangle appears once all four are there), then **Create the city**. The map's **Zoom in** and **Zoom out** buttons and two fingers on a phone move the map. The rest fills itself in and changes any time in Settings: the start view, a theme colour, the city's budget, the viewer's token (once Mapbox is set up), and once USGS is set up the first search for historical imagery of the area runs within minutes. An id no city may take (a reserved word such as engine) is said at its field, and an id another city has is refused with a free one in it; an area under 0.01° or over 2° on a side keeps Create off, with the reason beside the map. The done screen links Photos, Places and Historical imagery, and says how the city gets a public site: a developer adds it to the repository (`npm run site:add`); without one, **Export the city** gives a copy that runs on any static host.
- **Publishing** (Settings → **Publishing**): a new city is not public yet. Switch **The city is public** on and **Save**: within about a minute the server builds the city's public map data; switched off and saved, it takes it down. The city's public site is a step of the repository, not of the admin (which holds no GitHub credential): `npm run site:add -- --city <id> --name-ro "<name>" --theme <#rrggbb>`, committed and pushed by the repository's owner; it then serves the city at `https://<owner>.github.io/<id>/`, beside Bucharest at the root.
- **Admins per city**: Admins lists the open city's admins and invitations, each with its role. A city's owner invites (the address, then the role: **Editor** unless changed; the link is copied at once), removes access, and changes a role (**Make … owner of …?**, then **Change the role**); an editor sees the list only, and why. The project's owner is named as such. A city always keeps at least one owner.
- **The city's budget** (Settings → **The city's budget**): the city's share of the project's budgets, each with what was used so far in its period: Mapbox compute units a month, imagery processing jobs a day, automatic translations a month, title suggestions a day, exports a day. Only the project's owner changes them (one Save for the fields moved); the project's own limits still hold for every city. A new city gets a quarter of the free compute units, three imagery jobs a day, 100 translations a month, 100 title suggestions a day and three exports a day. Bucharest, from before M5, has only the project's limits: the card says so and shows its fields empty, and a field you leave empty saves at its maximum, so the one limit you set is the only one.
- **Export the city** (Settings → **Export the city**, a city's owners): **Export**, then **Download** once the archive is ready (two inputs): a `.zip` with everything the city needs to run on any static host, without Firebase: the page, the engine, `city.json` (the published map, without the project's analytics ids), the photos, a README and `RIGHTS.md`. **Include the USGS scans** adds the scans of the USGS layers (public domain); other layers keep their tile references. The card names how many photos are licensed for this map only (`RIGHTS.md` lists them: ask their rights holders before you publish the copy elsewhere), the archive's size and SHA-256, and until when it can be downloaded (seven days). Publish the city first; an editor sees the card read-only.

## Costs

- Google Cloud: about $0.5–2 per month; the $5 budget automatically pauses image processing (never the site), and **Resume processing** in Historical imagery or Jobs starts it again for the rest of the month.
- Mapbox: free up to 50,000 map loads per month; publishing a historical layer costs compute units by its area and zoom, and the app keeps to the month's free 20, otherwise it offers the free Studio upload, waiting for next month, or paying about the amount it names.
- USGS: scanned frames are free; a new scan costs $30 per frame plus $5 per order, paid by you to USGS in EarthExplorer.
- Vertex AI (the Romanian and English drafts): under $0.05 a month at the expected use, and never more than 0.50 USD a month (the app's cap); the budget guard pauses it with the image processing.
- OpenStreetMap's Nominatim (title suggestions) and the notifications: free.
- Another city (M5): its own Firestore documents and photos, its visitors' Mapbox map loads, and one USGS search a month, within its share of the project's budgets; jsDelivr, which serves the engine to a city's own site, and GitHub Pages are free. An export: the task's few minutes of server time and seven days of its archive in the private bucket.

## Troubleshooting

The message shown, its cause and what to do, screen by screen.

### The editors (since M2c)

| Message | Cause | What to do |
| --- | --- | --- |
| a message under a field, and Save off | the field breaks a rule (an empty Romanian title, an end year before the start, a link that is not https, a place outside the city) | correct the named field; Save comes back once nothing is wrong |
| the editor names another admin and the time | they saved the same item meanwhile | keep your fields or take theirs, then Save |
| "You are offline: nothing was saved. …" | the connection was lost | Save again once it is back; the draft stays |
| "Access was refused. …", then "This Google account does not administer this map. …" | your access was removed | ask another admin for a new invitation |
| "The map appears once Mapbox is set up." | the Mapbox card is not done (no admin token) | finish the Mapbox card; meanwhile type places in the fields |
| "The new image was refused; the old one stays published." | the replacement file failed the server's checks | choose another file (the reason is shown with the message) |
| the tileset belongs to another Mapbox account | **Link a layer** with another account's tileset | link a tileset of the city's own Mapbox account |
| a category cannot be deleted | places still use it | choose the category its places move to, then Delete |

### Historical imagery (since M3)

| Message | Cause | What to do |
| --- | --- | --- |
| "USGS is under maintenance. Try again later." | USGS's scheduled maintenance | an import waits and goes on by itself; for a search, **Try again** later |
| "USGS is not responding. Try again later." | USGS did not answer the search | **Try again** |
| "USGS refused the username or the token. …" | the USGS application token expired or was replaced | **Open the USGS step of Setup** and paste a new token within 60 seconds |
| "USGS has not approved M2M access for this account yet. …" | the M2M download role is still being reviewed | wait; the app checks every 6 hours, and Import comes back by itself |
| "USGS found no scene over the city's area." | the filters or the area leave nothing | try every year, all three collections, the scenes to order too, or check the city's area in Settings |
| "Reliable points the automatic georeferencing found: N, too few. …" | the frame has too few features the matcher trusts | **Open the georeferencer** and pair a few landmarks |
| "Processing is paused: this month's Google Cloud cost reached … of the … budget." | the budget alert paused the raster work | **Resume processing** (it may cost more this month), or wait for next month |
| "The image could not be processed. …" | a processing step failed on the server's own files | **Try again**; if it fails again, open the job's log |
| "Mapbox refused the token: it is invalid or has been revoked." / "The token lacks these scopes: …" | the Mapbox secret token changed | **Open the Mapbox step of Setup** and paste a token with the named scopes |
| "Does not fit this month's Mapbox budget: choose how to go on" | the publish costs more compute units than are left | the free Studio upload, next month, or pay |
| "The file is not a GeoTIFF. Upload a .tif file." | the chosen file is another kind of image | export it as a GeoTIFF first |
| "The source has no tiles at this address (404)." / "The address does not answer with an image." / "The tile server is not responding." | **Check** of a tile address in **Link a layer** | correct the address (it must hold `{z}`, `{x}`, `{y}`) or try again later |

### Orders, assists and notifications (since M4)

| Message | Cause | What to do |
| --- | --- | --- |
| "This frame is already scanned: import it for free, no order needed." | **I ordered it** on a frame USGS already offers | **Import (free)** |
| "The order is no longer in the right state for this step. Reload the page." | another admin or the daily watch moved the order meanwhile | reload the page |
| "Ordered: have you paid? USGS deletes unpaid orders after 14 days" | the order is 7 or 12 days old and not delivered | pay the order (reply to USGS's e-mail), or **Take the mark back** if you did not order |
| "Never delivered" | USGS delivered nothing within 90 days | **Order it again** if you still want it |
| "The last check of USGS failed:" and the reason | USGS was in maintenance or refused the token at the last check | nothing for maintenance (the next check retries); for the token, **Open the USGS step of Setup** |
| "OpenStreetMap suggestions are not available right now. …" | OpenStreetMap asked us to slow down; the project waits 10 minutes | type the title, or try **Suggest a title** later |
| "Today's title suggestions are used up; …" | the project asked 300 places today | type the title; suggestions return tomorrow |
| "The proposed translation changed the text's links, …" | the draft added a link or changed an address | type the text, or ask for a draft again |
| "The assistant is not answering right now. …" | Vertex AI is not reachable or its API is off in the project | type the text; Setup's self-test checks the AI and says what is missing |
| "This month's limit for automatic translations is reached; …" | 500 drafts or 0.50 USD this month | type the text; the drafts return next month |
| "The browser refused notifications (the site settings can allow them). …" | the browser's own prompt was refused | allow notifications for the admin's site in the browser's settings, or use the inbox |
| "This browser could not be registered for notifications. …" | the browser's push registration failed | try again, or use the inbox |

### Cities, publishing and the export (since M5)

| Message | Cause | What to do |
| --- | --- | --- |
| "You do not administer the city X; Y was opened instead." | a link to a city your account does not administer | ask that city's owner for an invitation |
| "Your account does not administer any city yet. …" | your last city's owner removed your access | ask a city's owner for an invitation |
| "The id X is already used by another city. Choose another, for example X-2." | another city has this id | keep the suggestion, or type another id |
| "The area is too small: …" / "The area is too large: …" | the rectangle is under 0.01° or over 2° on a side | drag the rectangle again |
| "The project already has 20 cities, the most it allows." | the project's limit | none: a project holds at most 20 cities |
| "Only the owners of X can do this." / "Only the project's owner can do this." | an editor inviting, exporting or changing roles; a city owner setting budgets or creating a city | ask the city's owner, or the project's |
| "The city must keep at least one owner." | the last owner made an editor | make another admin owner first |
| "Compute units this publish needs: N; the city has M left this month." | the city's share of Mapbox's compute units | the free Studio upload, next month, or ask the project's owner to raise the city's budget |
| "An export of this city is already under way. …" | another export is being prepared | wait for it, then download it |
| "Today's exports of this city reached the daily limit (N). …" | the city's daily exports | export tomorrow |
| "The export would be X, over the Y limit. Try without the scans." | the archive would pass 2 GB | untick **Include the USGS scans** |
| "The export has expired and was deleted. Make a new one." | seven days passed | **Export again** |
| "Publish the city before you export it." / "The city has not been published yet: …" | the city is not public | Settings → **Publishing**, then Save |
| the city's public site says "The map could not be found. …" | the city is not published, or was switched off | Settings → **Publishing** |

### The public map (since M1)

When the city page cannot show the map, it shows a card with the message below in the visitor's language. The ones a city owner can fix:

| Message | Cause | What to do |
| --- | --- | --- |
| "The map could not be found. Please try again later." | the page found no `manifest.json` at the address in `config.js` | publish the city (M2) or correct `manifestUrl` in `config.js` |
| "The map data is invalid (problems found: N)." followed by `field: rule` | the manifest breaks a rule of City Manifest v1; the card names the first field and the rule | correct that field (in the admin from M2; in a starter-kit site, in `data/manifest.json`) |
| "config.js is missing" / "config.js is invalid: …" | the page has no `window.HistoricCityMapConfig`, or a field in it is unknown or wrong | compare `config.js` with the starter kit's (`starter-kit/README.md`) |
| "The cityId in config.js (…) does not match the map (…)." | `config.js` points at another city's manifest | make `cityId` and the manifest's city the same; the Bucharest site names the project's city `bucharest`, as every manifest the server builds does (the old seed's `bucuresti` is renamed by the site build, `docs/research/DECISIONS-for-review.md` §35b) |
| "This map needs a newer version of this page (X). Please reload the page later." | the manifest asks for a newer engine than the page loads | load the engine version the message names |
| "Your browser cannot show the interactive map. The photo list is still available." | the visitor's browser has no WebGL | nothing: the visitor still gets the photo list |
