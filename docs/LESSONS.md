# Lessons

The defects that shaped the rules of this repository: what went wrong, which tier or report found it, and the rule it left behind. Each lesson is also a rule in `AGENTS.md` or a skill; this file is the *why*. Keeping the stories here keeps `AGENTS.md` within its byte budget.

Tooling quirks that are not product defects (an image setting, a linter's behaviour) belong in `.agent/skills/quality/pipeline_skill.md` → *Local tooling quirks* instead.

## How to add a lesson

Append a numbered entry to *Lessons from this repository* in the task that finds the defect:

1. **One-line title of what the user saw.**
   - Seen: what happened, on which surface (viewer, admin, function, pipeline), viewport, browser or data.
   - Found by: the tier, analyser or crash report that caught it, and why every tier below it was green.
   - Fix and pin: the fix, and the scenario id in `e2e/scenarios.json` (or the unit test) that now pins it.
   - **The lesson, in bold, general enough to outlive the code.**

## Lessons from this repository

1. **A legacy photo would have shown its source link twice.**
   - Seen: in the first run of the legacy migration (M1), a photo whose `source` was only an anchor (`<a href=…>Flickr</a>`) got the description "Flickr" next to the Flickr link.
   - Found by: reading `seed/bucharest/manifest.static.json` after the run; every unit test passed because none had a source made only of a link.
   - Fix and pin: `legacyHtmlToText` reports `linkOnly`, and such a source adds its link but no text (`happyPath_sourceAnchorBecomesALink`, `happyPath_htmlBecomesTextAndLinks`).
   - **Review the real output of a data migration, not only its unit tests, and pin each surprise with a test.**
2. **A missing enum field would have been reported as "value not allowed" instead of "required".**
   - Seen: the Firestore photo schema test expected `validation.required` for a photo without `processing`, and got `validation.value`.
   - Found by: `packages/shared/test/schemas/firestore.test.ts`; zod 4 reports a missing enum or literal as `invalid_value`, not `invalid_type`.
   - Fix and pin: `validate` asks zod for the input (`reportInput: true`) and maps any issue whose input is `undefined` to `validation.required` (`badPath_a photo without processing state`, `happyPath_missingVersusWrongType`).
   - **Decide "missing" from the input the validator saw, not from the name of its error code.**
3. **Text with a lone `<` would have lost words in migrated descriptions.**
   - Seen: `a < b and 3 <> 4` came out as `a 4`: the HTML scanner accepted `< b` as a `<b>` tag.
   - Found by: `badPath_unterminatedMarkupIsText` in `packages/shared/test/migration/html.test.ts`.
   - Fix and pin: as in HTML, a tag name must follow `<` or `</` directly; anything else is text.
   - **A hand-written parser follows the format's own tokenizing rule, not a forgiving guess.**
4. **A slider, a progress bar and a colour swatch broke the city page's Content Security Policy.**
   - Seen: the built Bucharest site logged "Applying inline style violates the following Content Security Policy directive" six times at 1440 px and eighteen at 360 px (M1 integration).
   - Found by: the viewer smoke S-V16-HAPPY, whose console guard fails on any console error; every kit unit test passed, because Vitest's page has no CSP. Engine-ui had already met the same problem in its own elements and written `cssProperties`, but the kit's slider, progress and overlay swatch still used Lit's `styleMap`, whose first render writes a `style` attribute.
   - Fix and pin: the directive moved into the kit (`packages/ui/src/components/css-properties.ts`, now also removing a property that a later render drops) and replaced every `styleMap`; `S-V16-HAPPY` and the new row `S-V16-BAD-INLINE-STYLE`; an ESLint ban is proposed (`docs/research/DECISIONS-for-review.md` §15a).
   - **A fix found in one workstream is a rule for all of them: write it into the skill the same day, and test the built page under its real CSP.**
5. **The engine shipped without its fonts.**
   - Seen: three 404s for `engine/fonts/*.woff2` on the built site; the text fell back to system fonts and the icons, drawn from a ligature font, would have shown as words without the `block` display.
   - Found by: the viewer smoke's console guard; the kit's font test loads the files from `packages/ui/fonts/`, where they exist.
   - Fix and pin: `npm run build --workspace @hcm/engine` copies them to `dist/fonts/` (`fonts:copy`), and the site build copies all of `dist/` (S-V16-HAPPY, S-V12-BAD-FONTS-BLOCKED).
   - **A package that loads files at run time ships them in its own build output; test the built artefact, not the source tree.**
6. **Every point of interest was drawn as a plain white dot.**
   - Seen: in the M1 review screenshots, POI markers showed a dot instead of their category glyph.
   - Found by: looking at the screenshots; the unit tests used a fake font loader that accepted any family name, and the adapter asked for `Material Symbols Rounded` while the kit registers `HCM Material Symbols Rounded`.
   - Fix and pin: the sprite uses `ICON_FONT_FAMILY` of `@hcm/ui` (`packages/engine/src/map/icons.ts`); `happyPath_aPoiIconIsItsMaterialSymbolGlyph` pins the name.
   - **A name two packages must agree on is imported from its owner, never typed twice.**
7. **The open menu lay under the consent banner, and a modal sheet under the floating timeline.**
   - Seen: engine-ui's viewer with the real kit: the FAB menu's items were covered by the consent banner; the kit's modal sheet (z-index 2) slid under the timeline dock.
   - Found by: `packages/ui/test/viewer/kit-integration.test.ts` (the first) and temporary screenshots (the second); the viewer's unit tests use kit doubles, which have no stacking.
   - Fix and pin: the menu dock sits above the banner and the snackbar, the viewer sets `--hcm-sheet-z-index` above its floating controls (`packages/ui/src/viewer/viewer-styles.ts`).
   - **Stacking is a property of the assembled page: test the viewer with the real kit, not only with doubles.**
8. **A Romanian label wrapped on a wide screen and pushed the About dialog sideways on a phone.**
   - Seen: in the second M1 review capture, About's theme choice showed "Ca / sistemul" on two lines inside a 40 px segment at 1440 px, and at 360 px the three segments with icons were wider than the full-screen dialog, which scrolled sideways.
   - Found by: looking at the screenshots of all four viewports; the kit's unit tests used short labels ("Sistem", "Luminos") and the viewer's tests use kit doubles, which have no layout.
   - Fix and pin: `hcm-segmented-button` segments take their content width (`flex: 1 1 auto` instead of an equal share of 0), stay inside their container and wrap a long label in a taller segment; the full-screen About drops the theme icons. `happyPath_aWideContainerKeepsEveryLabelOnOneLine` and `badPath_aNarrowContainerWrapsALongLabelInsteadOfScrollingSideways` measure it (both fail on the old styles); planned row `S-V15-BAD-LONG-LABELS`.
   - **Test layout with the real catalogue's longest strings, not short sample labels: Romanian is the long language here.**
9. **Accepting analytics sent nothing: Performance Monitoring took GA4 down with it.**
   - Seen: after "Accept" the viewer loaded the Firebase SDK, initialised GA4, then logged `analytics failed to load … performance/FB not default`; no event ever reached GA4 (M1 e2e).
   - Found by: `S-V19-HAPPY` against the GA4 stand-in of the mock APIs (`e2e/mock-apis/gtag.ts`); the unit tests used a fake SDK, whose `initializePerformance` accepts any app, and the viewer named its Firebase app (`hcm-viewer`), which the real Performance Monitoring refuses.
   - Fix and pin: the viewer's app is the default Firebase app unless the page already has one (then Performance Monitoring stays off, with a log line), and a Performance Monitoring failure never stops analytics (`badPath_aPerformanceMonitoringFailureNeverStopsAnalytics`, `badPath_aPageWithItsOwnDefaultAppKeepsItAndRunsAnalyticsWithoutPerformance`, `S-V19-*`).
   - **Run a third-party SDK for real at least once, behind a mock of its network; a fake SDK only proves your own calls.**
10. **An invalid manifest said "there are problems" but not which.**
    - Seen: an unclosed POI ring, a crossed brightness range or a bad theme seed showed only "Datele hărții sunt nevalide (1 probleme)." (with a plural that is wrong for one).
    - Found by: `S-V24-BAD-INVALID-POI`, `S-V25-BAD-OUT-OF-RANGE` and `S-V12-BAD-INVALID-SEED`, whose rows ask for the issue path and its localized message; the first issue only reached the non-localized `hcm-error` detail.
    - Fix and pin: the error carries `issuePath` and `issueCode`, the card shows `path: message` in the visitor's language, and the count reads "probleme găsite: N" (`badPath_anInvalidManifestNamesItsFirstIssueInTheVisitorsLanguage`, `badPath_anInvalidManifestCountsItsIssuesAndNamesTheFirst`).
    - **An error a city owner must fix names the field and the rule, in the page's language.**
11. **`#…&opacity=` from an old link faded the hidden layers too.**
    - Seen: `#…&layers=e2e-1966&opacity=-2.5` rewrote the hash with `op=e2e-1966:0,e2e-1980:0`; the 1980 layer, not shown, came back at 0 % when chosen later.
    - Found by: `S-V05-BAD-HASH-OUT-OF-RANGE`; the overlay model's unit test asserted the old behaviour ("every raster"), against `docs/ENGINE_API.md` ("the visible historical layers").
    - Fix and pin: `withHashOpacity` applies `opacity` to the visible rasters only (`badPath_opacityLeavesHiddenRastersAtTheirOwnOpacity`).
    - **When the code, its test and the public contract disagree, the contract wins: write the test from the contract.**
12. **Closing a sheet opened from the menu left the focus nowhere.**
    - Seen: after Esc or a drag that closed the Layers sheet, the keyboard focus was on `<body>`, not on the menu button.
    - Found by: `S-V15-BAD-SHEET-DRAG-CLOSE` and `S-V14-HAPPY`; the viewer remembered the focused element when the store changed, which was the menu item that vanished with the menu a moment later.
    - Fix and pin: the FAB menu closes and focuses its button before it announces the choice (`badPath_theFabHasTheFocusWhenTheChoiceIsAnnounced`).
    - **Move the focus before you announce an action: whoever reacts records where it is.**
13. **A configuration error card mixed Romanian and English.**
    - Seen: `?lang=en` with an invalid `config.js` showed "config.js este nevalid: colour: The field is not known.".
    - Found by: `S-V17-BAD-INVALID-CONFIG` in the English project; the card took the element's language (none, so Romanian) and the detail the configuration's.
    - Fix and pin: a boot error card speaks the address's language first, then the configuration's (`badPath_theAddressLanguageWinsForAConfigurationErrorCard`).
    - **Resolve the language once, by the documented order, and use that one result for every text of a screen.**
14. **Every city page reported a CSP violation on load.**
    - Seen: a `securitypolicyviolation` for `script-src` from `engine.mjs` on every page view, with nothing in the console.
    - Found by: `S-V16-BAD-INLINE-STYLE`, which records violation events and not only console errors: zod 4 probes `Function('')` to compile faster parsers.
    - Fix and pin: `z.config({ jitless: true })` in `packages/shared/src/schemas/primitives.ts` (`badPath_schemasNeverProbeEvalUnderACsp`).
    - **Listen for CSP violation events in the e2e tier: a caught violation never reaches the console, but it still reaches a report endpoint.**
15. **The tour found six layout and contrast defects no other tier could see.**
    - Seen: the snackbar was drawn above the top edge of the map; the "photos near this year" chip covered the menu button at 320 px; on a 915 × 412 landscape phone the top menu items were off screen; the timeline thumb (40 px) and the opacity slider handles (4 px) were under the 48 px touch target, as were the links of a POI's link list; the lightbox title, position and arrows were unreadable on its dark scrim in the dark theme (and the arrows in the light one); Mapbox's own labels ("Map", "Toggle attribution", "Mapbox homepage") were English on Romanian pages.
    - Found by: `e2e/tour/viewer.tour.ts` (`S-V15-HAPPY`, `S-V18-HAPPY`) on 11 viewports × 2 themes × 2 languages; the kit and viewer unit tests run in one box without the page's real layout, theme and Mapbox controls.
    - Fix and pin: the toast flows in its top dock; the chip sits one row above the menu on compact; a short window's menu continues in a second column (`--hcm-fab-menu-max-block-size`); the thumb and handles have 48 px touch targets and list links are 48 px tall; the lightbox header and error sit on a surface and its arrows are tonal; Mapbox gets the viewer's translations (`map.title`, `map.toggleAttribution`, `map.logo`). Unit tests: `badPath_theToastAndTheShortWindowMenuStayInsideTheViewer`, `badPath_theThumbTouchTargetIsAtLeast48Pixels`, `badPath_theThinHandleStillHasA48PixelTouchTarget`, `happyPath_everyFloatingControlIsNamedForTheLayoutCheck`.
    - **Check the assembled page at every viewport, theme and language: layout, contrast and translation defects live between components.**
16. **A link opened right after a change lost its photo.**
    - Seen: switching to English and then opening `#…&photo=strandul-opereta-1976` in the same tab within 300 ms showed no photo: the hash write the language change had scheduled replaced the new address before its `hashchange` reached the store.
    - Found by: a run of `S-V11-HAPPY` on c360 dark (the test meant to reload and only changed the hash); every unit test wrote the hash with nobody else touching the address.
    - Fix and pin: the hash writer remembers the hash it last wrote or adopted and never overwrites one the address gained since (the `hashchange` wins and is adopted before it is applied): `badPath_aHashTheVisitorChangedMeanwhileIsNotOverwritten`, `happyPath_syncAdoptsTheAddressBeforeItIsApplied`.
    - **A debounced write to shared state must check that nobody else wrote in between.**
17. **The tour's invariants passed while a photo was cropped and a button jumped.**
    - Seen: on a 915 × 412 landscape phone the lightbox cropped the photo top and bottom, and the viewer showed through its 92 % scrim (the photo sheet's own copy of the photo, the menu button); opening the menu there moved its button about 300 px, from the leading edge to the middle, because the wrapped two-column menu lined up on the inline end; with no historical layers, the "layers are coming" note sat under the photos and places like a footnote; the boot skeleton's linear progress bar had no width of its own in its centred grid, so only a static shimmer showed; without WebGL the last photo of the list stayed under the menu button.
    - Found by: the UX review's screenshots of every screen at the 11 viewports (M1); the tour checks overlap, overflow, clipping of text and touch targets, none of which a cropped image, a translucent scrim or a moved control breaks.
    - Fix and pin: the lightbox stage's track is `minmax(0, 1fr)` and its scrim opaque (`happyPath_aLandscapePhotoOnAShortWindowIsFittedOnAnOpaqueScrim`, `S-V08-BAD-SHORT-WINDOW`); the FAB menu lines up on the side `--hcm-fab-menu-align` names, `flex-start` in the leading-edge dock (`badPath_aWrappedMenuAlignedToTheStartKeepsItsFabInPlace`, `badPath_theShortWindowMenuOpensWithoutMovingItsButton`, `S-V15-BAD-COMPACT-LANDSCAPE`); the note leads the layers panel (`badPath_noHistoricalLayersSaysTheyAreComing`); the skeleton shows the kit's loading indicator (`badPath_whileLoadingAVisibleIndicatorTurns`, `S-V01-BAD-SLOW-STORAGE`); the fallback list ends with room for the button (`badPath_withoutWebGlTheLastPhotoScrollsClearOfTheMenuButton`, `S-V02-BAD-NO-WEBGL`).
    - **Look at the screenshots too: automated layout invariants catch collisions, not a cropped photo or a control that moves under the finger.**
18. **A layer's attribution could have put a link on the map.**
    - Seen: a manifest attribution `<a href="https://…">USGS</a>` became a live link in the map's attribution, and `<b>` or `Arhiva <Națională>` lost their characters; the Layers panel (Lit) showed the same text literally.
    - Found by: the a11y and security review of M1, reading Mapbox GL 3.32's attribution control: it parses every source `attribution` as HTML, keeps `<a href>` (http, https, mailto) and writes the result with `innerHTML`. The schema allows any plain text there, and no unit or e2e test fed it markup.
    - Fix and pin: the engine escapes `&`, `<` and `>` before handing the attribution to Mapbox (`attributionText` in `packages/engine/src/map/rasters.ts`; `badPath_markupInTheAttributionReachesMapboxAsEscapedText`, `S-V03-BAD-ATTRIBUTION-MARKUP-IS-TEXT`).
    - **A third-party API that takes "text" may render HTML: read what it does with the string before passing data to it.**
19. **Keyboard users lost the lightbox at its last photo, and Shift+Tab left the modals.**
    - Seen: pressing the lightbox's Next button (Enter) onto the last photo disabled it while it had the focus; Chromium moved the focus to `<body>`, so Esc and the arrow keys stopped working. Shift+Tab right after a modal sheet or the lightbox opened (they focus their container) left the modal for the page behind it, and the lightbox did not trap Tab at all.
    - Found by: the a11y and security review of M1; the e2e drove the arrows with the arrow keys (the focus stays on the dialog) and opened the sheets with Tab already inside them.
    - Fix and pin: the arrow about to be disabled hands the focus to the dialog first; the lightbox traps Tab; `trapTab` treats a focused container as the start of the trap (`badPath_theArrowThatGetsDisabledHandsTheFocusToTheDialog`, `badPath_shiftTabOnTheFocusedContainerWrapsToTheLastInsteadOfLeaving`, `S-V08-BAD-FOCUS-AT-LAST-PHOTO`, `S-V14-BAD-MODAL-TAB-WRAP`).
    - **Never disable or remove the control that has the focus without moving the focus first; test modals from the focus they really open with.**
20. **Toasts were shown but not announced.**
    - Seen: the snackbar's polite live region was created together with its text, one snackbar per toast, so screen readers had no change to announce ("Link copied", "Location unavailable", a tile outage); its announcement also included the Close button.
    - Found by: the a11y and security review of M1; the unit test checked the region in isolation, where the message arrives after the region exists.
    - Fix and pin: the snackbar's visually hidden live region is in the page empty and gets the message alone `ANNOUNCE_DELAY_MS` later (`happyPath_showsTheMessageInAPoliteLiveRegion`, `badPath_aSnackbarClosedBeforeItsAnnouncementIsNotAnnounced`; `S-V14-HAPPY-TOAST-ANNOUNCED` is planned). The tour's clipped-text check skips screen-reader-only text.
    - **A live region must exist, empty, before the text it announces: test the region as the app creates it, not as a component test mounts it.**
21. **Points of interest stayed plain discs until the visitor moved the map.**
    - Seen: in the M1 final-gate screenshots (1280 × 800, dark, no historical layers) two POIs showed their category disc without a glyph; the same screen in the other captures had them.
    - Found by: looking at the 216 final screenshots; the e2e and unit tiers were green, because the icon font always arrived before the map settled there, and `FakeMapboxMap.updateImage` stands for a map that redraws by itself. Mapbox GL 3.32's `updateImage` only swaps the image's pixels: an idle map draws them at its next frame, which nothing asks for.
    - Fix and pin: `ensureIcon` (`packages/engine/src/map/icons.ts`) calls `triggerRepaint()` after `updateImage` (`badPath_aDrawingThatLandsOnAnIdleMapAsksForAFrame`); `S-V24-BAD-ICON-FONT-LATE` holds the icon font until the map is idle, then sees the glyph appear without any interaction (it failed on the old build in two projects).
    - **A third-party update that arrives after the view settled must ask for a frame: test it by delaying the input until the view is idle, not only by running fast.**
22. **The second photo of a point of interest sat 4 px lower than the first.**
    - Seen: in the final screenshots at every viewport, the POI sheet's photo thumbnails did not share one top edge.
    - Found by: the screenshots; the thumbnails are a grid with an 8 px `gap`, and the shared `detailStyles` also gave every `li + li` of a detail sheet a 4 px top margin, which a grid adds on top of the gap. The POI detail's unit tests used kit doubles and checked the thumbnails' count, not their layout.
    - Fix and pin: `.details .thumbs li + li` resets the margin (`packages/ui/src/viewer/hcm-poi-detail.ts`; `badPath_photoThumbnailsShareOneTopEdgeInsteadOfTakingTheListGap`, which failed with 262 against 258 px).
    - **A shared spacing rule written for a stacked list does not belong in a grid: scope it, and measure edges where items must line up.**
23. **Opening a sheet, the lightbox or About covered the Mapbox logo and attribution.**
    - Seen: on phones the Layers, photo and POI bottom sheets, on medium screens the side sheets, and everywhere the lightbox and About lay over Mapbox's own logo and attribution in the map's bottom corners, which Mapbox's terms require to stay visible (`docs/research/design-review-security-cost.md` §5).
    - Found by: the M1 UX review's screenshots (`docs/research/M0-handoff.md` §10m); the tour checked the logo and the attribution on the home screen only, and its overlap check never looked under a modal surface. Building the fix, the unit harness found that a page's own `display` on `<hcm-map-viewer>` beats the element's `:host` rule, so a layout grid on the host fell apart.
    - Fix and pin: while a modal surface covers the map the viewer hides Mapbox's bottom controls and mirrors the logo and the attribution it reads from Mapbox's control (`attribution.ts`, `hcm-map-attribution.ts`, `viewer-legal.ts` in `packages/ui/src/viewer/`): in a legal bar, the last row of an inner grid (`.viewer`, not the host) below the modal layer, so sheets, scrims and the lightbox end above it; at the foot of About, which is in the top layer. The tour now checks every state: one visible logo and one attribution, nothing on top of them, and overlaps among the controls a visitor can use (`badPath_nothingCoversTheMapSoNoMirror`, `happyPath_aModalSheetEndsAboveTheLegalBarWhichMirrorsTheMapsAttribution`, `S-V18-HAPPY-MODAL-STATES`, `S-V18-BAD-FULL-SHEET`).
    - **A legal or safety control must be checked in every state, not on the home screen; and never put a layout on `:host` that a page's style on the element can undo.**
24. **After "My location", Performance Monitoring could send the visitor's position to Google.**
    - Seen: after consent, every Performance Monitoring batch carried `location.href` up to the first `?`, that is the viewer's whole hash, which holds the map view and, after *My location*, the visitor's position (`docs/research/DECISIONS-for-review.md` §18a); the SDK has no setting to leave the hash out.
    - Found by: the a11y and security review of M1, reading the Performance Monitoring module of the Firebase SDK; the GA4 stand-in of the e2e only echoed the page location the viewer configured, so a viewer that stopped setting it would still have passed.
    - Fix and pin: the public viewer loads only firebase/app and firebase/analytics on its own named app; GA4 gets `page_location` and `page_path` without the hash on its configuration and `page_location` on every event, with Google signals and ad personalisation off (`happyPath_consentLoadsTheSdkOnceInConsentModeAndSendsEventsWithoutTheHash`, `happyPath_theFirebaseChunkHasOnlyAppAndAnalytics`). The stand-in now falls back to `location.href` like gtag.js (`S-V19-BAD-HASH-NEVER-SENT`).
    - **A stand-in for a third-party script must fail the way the real one does when the app forgets a setting, or the test proves nothing.**
25. **Withdrawing consent left GA4's cookies in the browser.**
    - Seen: after *Accept*, gtag.js wrote `_ga` and `_ga_<container>` for two years; withdrawing in About switched collection off but kept them, while the privacy notice promises no cookies without consent (§18c).
    - Found by: the a11y and security review of M1; nothing in the e2e world wrote a cookie.
    - Fix and pin: a withdrawal (granted, then denied) expires every `_ga` and `_ga_*` cookie host-only, for each parent domain and every path prefix of the page, at once and again after the SDK stopped; GA4 starts with the consent as it is when its chunk arrives, so a withdrawal during the load never grants it; a first *Decline* touches no cookie, since an embedding page may run its own GA4 (`packages/engine/src/telemetry/cookies.ts`; `happyPath_everyGa4CookieIsExpiredHostOnlyForEachParentDomainAndEveryPathOfThePage`, `badPath_anEventQueuedBeforeAWithdrawalIsDroppedAndGa4NeverStartsGranted`, `S-V19-HAPPY-COOKIES-EXPIRED`, `S-V19-BAD-DECLINE-KEEPS-PAGE-COOKIES`).
    - **Turning collection off is not removing what was collected: a withdrawal undoes what consent allowed.**
26. **The error card spoke to developers and shouted its Retry.**
    - Seen: a visitor read "Harta nu a fost găsită: manifestul lipsește." or "WebGL indisponibil", and a filled primary Retry dominated the card.
    - Found by: the M1 UX review; the unit and e2e tests compared the card with the catalogue, whatever the catalogue said.
    - Fix and pin: visitor errors in plain Romanian and English (keys unchanged; `error.config.*` still speak to the city owner), Retry is a filled tonal button with the refresh icon on the error container (`badPath_noVisitorErrorSpeaksJargonInEitherLanguage`, `happyPath_anM3ErrorContainerWithAFilledTonalRetry`, `S-V01-HAPPY-ERROR-CARD`, `S-V01-BAD-PLAIN-WORDS`).
    - **A test that only compares the screen with the catalogue cannot catch bad copy: give visitor texts their own check.**
27. **On extra-large screens the focused skip link covered the Layers heading.**
    - Seen: at 1600 px and wider the first Tab showed "Sari la cronologie" at the viewer's top-left corner, over the heading of the docked Layers pane.
    - Found by: the M1 UX review; the skip-link test looked at the focus order, not at what the focused link covers, and only the tour's home state (no pane open) was measured.
    - Fix and pin: with a docked leading pane the link starts at the map pane (`happyPath_onExtraLargeItShowsOverTheMapNotOverTheLayersHeading`, `S-V14-HAPPY-SKIP-LINK-CLEAR`, `S-V14-BAD-SKIP-LINK-THREE-PANES`).
    - **A control that appears only on focus needs its own layout check while focused.**
28. **The photo list's dates were too small to read on a phone.**
    - Seen: the date under each photo title was body-small (12 px).
    - Found by: the M1 UX review; no test looked at type sizes.
    - Fix and pin: M3 list typography, the title body-large and the date body-medium (14 px) supporting text that wraps (`happyPath_theDateIsBodyMediumSupportingTextUnderABodyLargeTitle`, `S-V07-HAPPY-LIST-DATES`, `S-V07-BAD-LIST-NO-DATE`).
    - **Supporting text a visitor must read is body-medium at least.**
29. **Every photo an admin saved with all its fields was refused.**
    - Seen: the first M2 rules denied every photo create that filled every field, although each check passed on its own.
    - Found by: the rules tests (`firebase/rules-tests/test/photos.test.ts`); the emulator's `firestore-debug.log` named the cause: Firestore denies a request whose rules evaluate more than 1000 expressions, and every reference to a function argument evaluates the argument again, so a check costs about ten.
    - Fix and pin: cheap checks (a text is one bounded pattern such as `[\s\S]{1,200}`, an optional field is checked against a neutral default, the whole document once per write); the heaviest legitimate writes, a photo with every field and five links and every editable field of a city at once, stay near 650 of 1000 (`firebase/rules-tests/test/limits.test.ts` fails when one goes over).
    - **A rules file has a cost budget like a bundle: test the heaviest legitimate write against it, not only each rule.**
30. **The edit history could not be listed newest first.**
    - Seen: the contract listed a document's history by id, descending; the Firestore emulator refuses it (`FAILED_PRECONDITION: Firestore does not support descending key scans`), so the query could never be tested and the admin's panel would have failed under the emulators.
    - Found by: the documents adapter test on the emulator (`functions/test/adapters/documents.test.ts`); the in-memory fake answered the query happily.
    - Fix and pin: history is listed by `updatedAt` descending; the revert's echo is skipped by matching any listed `revert` entry with the same time stamp; the fake document store refuses `__name__` descending as the emulator does (CR-M2-9).
    - **A fake must refuse what the real service refuses, or it certifies queries production cannot run.**
31. **A crash report from the city site lost its line number.**
    - Seen: `redactText` removes a URL's query, and with it the `:line:col` that follows a script URL in a stack frame, so Cloud Error Reporting could not tell crashes in the same file apart.
    - Found by: the endpoint's event tests (`functions/test/telemetry/error-event.test.ts`).
    - Fix and pin: the report location is parsed from the frame before the text is redacted; the redacted stack is what is stored.
    - **Extract the structure you need before you scrub a text; scrubbing first destroys more than the secret.**
32. **HEIC photos could not be converted on the server as planned.**
    - Seen: the security review assumed sharp converts HEIC; its prebuilt libvips decodes AVIF only (`sharp.format.heif.input.fileSuffix` is `['.avif']`), so an iPhone photo would have failed as "unreadable".
    - Found by: fn-content's upload tests on real sharp with generated images (`functions/test/photos/upload.test.ts`).
    - Fix and pin: `photos.onUpload` recognises HEIC and HEIF by their magic numbers and fails the photo with `apiError.photo.heicUnsupported`, which tells the admin how to export a JPEG (`S-A08-BAD-HEIC`; `docs/research/DECISIONS-for-review.md` §20b).
    - **Check a codec claim against the binary you ship, not against the library's feature list.**
33. **A pending USGS approval would have turned into "USGS is not responding" overnight.**
    - Seen: `setup.saveUsgs` read a login refused with `AUTH_UNAUTHORIZED` (no M2M access yet) as `pending`, while `ops.tick`'s health check, a second implementation of the same record, fell back to `unavailable` with `apiError.usgs.unavailable`.
    - Found by: the integration review that wired both into one deploy; each family's tests were green against its own reading.
    - Fix and pin: both map it to `pending` with the new reason `apiError.usgs.accessPending` and check again six hours later (`badPath_aLoginRefusedForMissingM2mAccessStaysPending` in `functions/test/ops/services.test.ts`, `badPath_anAccountWithoutM2mAccessIsPendingToo` in `functions/test/setup/save-usgs.test.ts`, `S-A03-BAD-USGS-STILL-PENDING`).
    - **Two writers of one record need one table of what each upstream answer means, or a test that runs both.**
34. **The deploy artifact would have crashed at its first cold start.**
    - Seen: `functions/build.mjs` bundled the workspace packages but left their own npm dependencies external, so `functions/dist/index.js` imported `zod`, which `functions/dist/package.json` does not install.
    - Found by: the integrator, checking the bare imports of the built bundle against its manifest; every test ran from source, where the workspace's `node_modules` has zod.
    - Fix and pin: the build bundles everything except the functions' own pinned dependencies, then fails when a bare import is neither a Node built-in nor pinned, and loads the bundle to check every export's deploy manifest; the Functions emulator loads the same `functions/dist/` with all 32 functions.
    - **Test the artifact you deploy, not only the source it was built from.**
35. **The legacy import would have dropped Ferdinand without a word.**
    - Seen: the first end-to-end import (M2b) reported "All 45 photos are on the map." with 44 photo documents: the old site gave Bateriilor and Ferdinand the same id, and the import's "already imported under another id" check by `legacyId` counted Ferdinand as done.
    - Found by: the e2e journey counting the photo documents in the emulator; the import's unit tests used unique ids.
    - Fix and pin: a `legacyId` that more than one bundled record carries identifies nothing; those records match by document id only (`badPath_twoRecordsSharingALegacyIdAreBothImported`, `S-A28-HAPPY`).
    - **Never assume the legacy data's ids are unique: count what a migration wrote, not what it reported.**
36. **A quick click on the billing card asked Google for the wrong permission.**
    - Seen: in start-up mode the billing button was clickable while the card was still asking Service Usage whether the billing APIs were on; a click in that window asked Google for `cloud-billing`, and the step then tried to enable the APIs with a token that cannot.
    - Found by: the e2e journey, whose click came faster than a human's; the flow's unit tests awaited the detection first.
    - Fix and pin: the card is busy (its button disabled) while the detection runs (`happyPath_enabledApisKeepTheBillingScope`).
    - **A button whose meaning depends on a detection waits for that detection.**
37. **The open card jumped to another step while the admin was reading it.**
    - Seen: after a reload, the admin opened the analytics card; seconds later the page switched to the legacy import, because the Setup Assistant's start opened "the first incomplete step" once its slow checks (the import's detection reads 45 documents) finished.
    - Found by: the e2e journey, which opened the card before the checks ended.
    - Fix and pin: the start opens a step only when the admin has not opened one meanwhile (`badPath_aCardOpenedWhileTheFirstChecksRunStaysOpen`).
    - **An automatic navigation that ends after an await must not override what the user chose during it.**
38. **The analytics card hid the Google permission note before its last Google window.**
    - Seen: once the measurement id was found the card turned green and the note disappeared, but the GA4 stream setting still opened Google's window.
    - Found by: the e2e journey's check of the note before every popup (`S-A27-HAPPY-UNVERIFIED-NOTICE`).
    - Fix and pin: the note follows the card's next popup (`scope`), not the card's state; sign-in and the claim, whose popups belong to the shell's panels, name no scope (`happyPath_aDoneStepWhoseNextActionAsksGoogleKeepsItsNote`).
    - **Show a consent explanation next to every action that opens a consent, whatever the step's status.**
39. **The USGS username disappeared when the window changed size.**
    - Seen: a capture at another window size re-created the USGS card (one column versus list and detail), and the pasted token was refused with "Fill in the username first."; a rotated tablet would do the same.
    - Found by: the review-screenshot run of the e2e journey.
    - Fix and pin: the username and the expiry date live in the Setup Assistant's state (`draftUsgs`), never the token (`happyPath_theTypedFieldsSurviveTheCardBeingMadeAgain`).
    - **Form state that must survive a layout change lives in the state, not in the element.**
40. **A saved USGS token was "missing" a second later in the e2e world.**
    - Seen: `setup.saveUsgs` stored the token, then `setup.selfTest` found no secret: the Functions emulator runs every function in its own worker process, and the emulator's in-memory secret store is per process.
    - Found by: the e2e journey; every functions test ran one handler in one process.
    - Fix and pin: in the emulator with fakes the secrets live in the fake Secret Manager of the mock APIs (`happyPath_theEmulatorWithTheFakesKeepsSecretsInTheFakeSecretManager`).
    - **State the deployed system keeps in a shared service must not live in process memory in its local stand-in.**
41. **The emulator never rebuilt the manifest after the import.**
    - Seen: the manifest stayed at the version built before the 45 photos: the Cloud Tasks emulator dispatches a task at once, whatever its delay, and keeps refusing its id, so every later request of the same one-minute window was dropped.
    - Found by: the e2e journey polling `manifests/bucharest` for 45 photos.
    - Fix and pin: in the Functions emulator manifest tasks carry no id, so each request is a build of its own (`happyPath_unnamedTasksDropTheirIdButKeepTheDelay`); deployed, the named window stays.
    - **When an emulator ignores a timing guarantee a design relies on, adapt the composition for the emulator, not the design.**
42. **The admin's harness page could not reach the emulators.**
    - Seen: a page answered by a Playwright route has no address space, so Chromium's Local Network Access refused its requests to the loopback emulators.
    - Found by: the first admin harness specs (M2b).
    - Fix and pin: the harness page is served by the e2e admin server on the admin's own origin (`/__harness`, `S-A00-HAPPY-SIGNED-IN-PERSONA`).
    - **Serve a test page from the origin whose network rights it needs.**
43. **A fake made a phantom project of the real one.**
    - Seen: the fake Resource Manager knew a project first named by its number as a different project, so Service Usage refused billed APIs on a project whose billing was linked.
    - Found by: the provisioner's tests against the fakes (M2b).
    - Fix and pin: `demo-hcm` is known by id and number from the start (`packages/test-support/src/fakes/project.ts`).
    - **A fake keyed by two identifiers must make them one record.**
44. **Polling a long-running operation created the service account twice.**
    - Seen: the transport resent the start call's method, query and body to the operation's URL, so IAM's create was POSTed again.
    - Found by: the provisioner's write counts ("a second run writes nothing").
    - Fix and pin: an operation is polled with a bare GET of its name (`packages/admin/test/google/transport.test.ts`).
    - **Poll an operation by its name only; never replay the call that started it.**
45. **The Setup page logged "ResizeObserver loop completed with undelivered notifications".**
    - Seen: the page measured its own window class and changed its layout from the observer's callback, which resized the element it observed.
    - Found by: the console guard of the setup page's browser tests (M2b).
    - Fix and pin: the page follows only the width class and applies a change on the next animation frame (`packages/ui/test/admin/setup/hcm-setup-page.test.ts`).
    - **Never change an observed element's size from its own ResizeObserver callback.**
46. **The sign-in flow evaluated the same user twice.**
    - Seen: Firebase announced the popup's user to `onAuthStateChanged` before `signInWithPopup` resolved, so the listener and the click's own flow both decided for the same uid.
    - Found by: the auth controller's tests (M2b).
    - Fix and pin: the controller evaluates each uid once and lets the click's flow continue (`packages/admin/test/auth/controller.test.ts`).
    - **An auth listener and the flow that triggered it must agree on who decides.**
47. **The first real owner claim would have been refused.**
    - Seen: `admin.claim` accepted only tokens issued to an OAuth client listed in `HCM_OAUTH_CLIENT_IDS`, a deploy-time value nothing sets yet, so on the real project every claim would have answered `apiError.claim.tokenMismatch`; the e2e world set the variable and hid it.
    - Found by: the integration review of the M2b journey against the production composition (`DECISIONS-for-review.md` §22a, CR-M2b-2).
    - Fix and pin: without the variable the claim reads the project's Google sign-in client from Identity Toolkit (`happyPath_withoutConfiguredClientsTheGoogleSignInClientIsAsked`), and the e2e emulators no longer set it, so the journey's claim takes the production path (`S-A26-HAPPY`).
    - **Configure the test world like production; every value a test sets for convenience is a path production never takes.**
48. **One of the 45 legacy photos was sometimes refused as a duplicate.**
    - Seen: the old site placed one file (`Al Orascu vazuta din Mihai Voda, partea din dreapta.jpg`) at two spots; the import uploads it for both records, and `photos.onUpload` refused the second as a duplicate of the first, but only when the first had finished processing before the second was checked, so the journey failed now and then.
    - Found by: the full e2e stage, where load changed the order of the import's three parallel uploads.
    - Fix and pin: two photos that both carry a `legacyId` are never each other's duplicate (`happyPath_twoLegacyPhotosOfOneImageAreBothProcessed`); a new upload of a legacy image still is (`badPath_aNewPhotoOfALegacyImageIsStillADuplicate`).
    - **A check that depends on which of two parallel jobs finishes first is a race: decide by data, never by order.**
49. **An admin test failed before it started: the Firestore emulator refused to be emptied.**
    - Seen: `S-A00-BAD-SCOPE-UNTICKED` failed in its `adminWorld` fixture with `Firestore reset: 409 ... Transaction lock timeout` (ABORTED), once in three full e2e runs; the test itself never ran.
    - Found by: the `e2e` stage of `PIPELINE_STAGE=all` on 2026-10-12, with every tier in one run.
    - Fix and pin: a background function of the previous admin test (a trigger, a manifest task) can still hold a document lock when the next test starts, and the emulator's delete-all waits for it, then answers 409; `EmulatorWorld.reset` (`e2e/admin/support/emulators.ts`) tries the Firestore reset up to three times on a 409 and fails on anything else.
    - **A fixture that resets shared emulators must expect work the previous test started to still be finishing.**
50. **The tour's toast state failed on a busy machine: the toast had closed before the test looked.**
    - Seen: `A toast` (`S-V15-HAPPY`) at 3840 × 2160 found no `error.unknownPhoto` status in 15 s, once in four full e2e runs.
    - Found by: the `e2e` stage of `PIPELINE_STAGE=all` on 2026-10-12, in a run that took a third longer than the others.
    - Fix and pin: the toast shows when the manifest is applied and closes itself 6 s later, but the test first waited for `hcm-ready`, which needs the 4K map to settle; it now focuses the toast's close button at once (the M3 snackbar keeps itself open while it holds the focus, as for a keyboard visitor reading it), then waits for the map (`e2e/tour/viewer.tour.ts`). A first fix hovered the toast instead and failed under a load average above 40: a hover waits for two stable animation frames, which a 4K SwiftShader page did not produce before the 6 s ran out; a focus needs none.
    - **A test of anything that times itself out must hold it open before waiting for something slower.**
51. **Two functions test files failed when the machine was busy, while every other emulator test passed.**
    - Seen: `functions/test/deps.test.ts` (two `createDeps` tests at 5 s) and the `beforeAll` of `functions/test/adapters/firestore.test.ts` (10 s) timed out in a `tests` run at a load average of 69, with four agents' pipelines on the laptop, and the first test again in a fresh clone of the unchanged branch at a load average of 6 (cold caches); the same tests take 0.1 to 3.3 s on a warm, idle machine.
    - Found by: measuring the `vitest` gate for the pipeline optimisation (`docs/research/pipeline-baseline.md`, the tests addendum); every earlier run was on a quieter machine, where the first request of a fresh emulator connection (a secret read asks Firestore for `setup/status` first) stayed under Vitest's defaults.
    - Fix and pin: both functions Vitest projects now give every test and hook 60 s (`EMULATOR_TIMEOUTS` in `vitest.config.ts`), which also replaces the per-file `vi.setConfig` of `functions/test/admin/world.ts` and `functions/test/publish/on-write.test.ts` (in a module graph shared across files, a helper's `vi.setConfig` would apply to the first file of a worker only); the rule is in `.agent/skills/quality/testing_strategy_skill.md`.
    - **A test that waits on a shared emulator gets the emulator's timeout, not the default: a default that holds on an idle machine is a bet on the load.**
52. **A fresh copy of the tree failed `static` after one `tests` run: Hypothesis's cache files were not ignored.**
    - Seen: on 2026-10-17, `static` in a scratch copy of the working tree (a `git clone` plus an rsync of the uncommitted files, the way `scripts/ci/e2e-split.sh` and the session's NUC helper copy a tree) failed `editorconfig` on eleven `.hypothesis/constants/*` files that the `pipeline-pytest` gate of the `tests` run before had written; the same sequence in the original checkout passed.
    - Found by: the integrator's measurement of `static` on a 4-CPU container, the first run of `static` after `tests` in a copied tree (the Measure agent had run `static` first everywhere).
    - Fix and pin: Hypothesis writes `.hypothesis/.gitignore` (`*`) only when it creates the folder itself; rsync's `--filter=':- .gitignore'` reads that file and copies the folder empty, without it, so in the copy Hypothesis found the folder, wrote no `.gitignore`, and its cache files were untracked. The root `.gitignore` now names `.hypothesis/`, so the folder is ignored however it came to exist; the quirk is in `.agent/skills/quality/pipeline_skill.md` → *Local tooling quirks*.
    - **A tool's folder that ignores itself from inside needs a root ignore entry too: copies, clean-ups and other tools do not keep a self-written `.gitignore`.**
