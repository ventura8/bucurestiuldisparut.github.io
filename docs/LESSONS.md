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
   - Fix and pin: the sprite uses `ICON_FONT_FAMILY` of `@hcm/ui` (`packages/ui/src/map/icons.ts`); `happyPath_aPoiIconIsItsMaterialSymbolGlyph` pins the name.
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
    - Fix and pin: the engine escapes `&`, `<` and `>` before handing the attribution to Mapbox (`attributionText` in `packages/ui/src/map/rasters.ts`; `badPath_markupInTheAttributionReachesMapboxAsEscapedText`, `S-V03-BAD-ATTRIBUTION-MARKUP-IS-TEXT`).
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
    - Fix and pin: `ensureIcon` (`packages/ui/src/map/icons.ts`) calls `triggerRepaint()` after `updateImage` (`badPath_aDrawingThatLandsOnAnIdleMapAsksForAFrame`); `S-V24-BAD-ICON-FONT-LATE` holds the icon font until the map is idle, then sees the glyph appear without any interaction (it failed on the old build in two projects).
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
53. **The tour passed while the FAB touched the timeline and an open menu blocked it on phones.**
    - Seen: the user, on 2026-10-12: "in the phone screens the menu button sometimes overlaps with other elements". The tour compared only the boxes an app marked `data-layout-check`, on the home state only, and treated the open menu as one box.
    - Found by: the generic checkers of 2026-10-17 (`assertLayoutSound` on every state): at 360 × 800 the FAB ends on the timeline's top edge (0 px apart), the open `hcm-fab-menu` host covers the timeline's thumb where no item is drawn, and the toasts' dock covers it too (`docs/research/layout-a11y-findings.md`).
    - Fix and pin: the checks run on every state of `e2e/tour/states.ts` (`S-V15-HAPPY`, `S-V14-HAPPY-EVERY-STATE`); the product fixes follow in their own task.
    - **A layout check that only looks at what the app marked, in the states the test happened to open, proves nothing about the others: probe every control of every state from the page itself.**
54. **The admin journey failed once on the USGS countdown: it showed 54 s where the test wanted 55.**
    - Seen: on 2026-10-17, `admin-m768-ro`'s journey read "Lipește tokenul în 54 s" after jumping the page's clock by 5 s from 60, in a split run where this half of the admin tier ran beside the laptop's functional tests.
    - Found by: the first split run with the admin tier divided between the machines (`DECISIONS-for-review.md` §33a); the busier machine took more than a second between the two reads.
    - Fix and pin: the journey keeps `page.clock` running (the Firebase SDK needs its timers), so the countdown also moves in real time; the spec now asserts the jump took at least five seconds off and the 60 s window is still open (`S-A07-HAPPY-COUNTDOWN`).
    - **On a clock that keeps running, assert a range: the exact second a spec reads depends on how busy the machine is.**
55. **The Tab walk saw only the first control of the viewer: the rest moved inside one shadow root.**
    - Seen: the first version of the tour's focus check recorded `focusin` on the document and reported every control after the skip link as never reached.
    - Found by: debugging the checker on `tour-c360-light-ro` (pressing Tab and reading the deep active element showed the focus did move).
    - Fix and pin: a focus event whose target and related target retarget to the same host stops at that host's shadow root, so a move between two controls of `hcm-map-viewer` never reaches the document; the walk now reads the deep active element after every press (`recordFocus`, `e2e/test/a11y-probe.test.ts`).
    - **Listen for focus where it moves, or read where it is: a document listener misses every move inside one shadow root.**
56. **A sheet on a phone held sideways was taken for a docked pane.**
    - Seen: in the tour's journeys the photos-near-the-year sheet at 915 × 412 was never closed with Esc, so the next state found the frame inert and its timeline unfocusable.
    - Found by: the tour on `tour-c915l-light-ro`.
    - Fix and pin: `isDocked` (`e2e/support/viewer.ts`) decides by width alone (840 px and up), but a compact height (under 480 px) makes the viewer's sheets modal side sheets at any width (`packages/ui/src/viewer/layout.ts`); the tour uses `sheetsAreModal` (`e2e/tour/states.ts`), which follows the layout's own rule. `isDocked` serves the functional projects, none of which is a landscape phone.
    - **A test helper that classifies the layout must follow the layout's own rule, every axis of it, not the one axis the first viewports needed.**
57. **The menu button sat on the timeline on phones: its offset was computed from a height the timeline had by accident.**
    - Seen: the user's report of 2026-10-12; the generic checker measured the FAB 0 px from the timeline's top edge at 320, 360 and 412 px, the timeline 2 px from Mapbox's collapsed attribution, and the chip on the timeline at 768 px (`docs/research/layout-a11y-findings.md`).
    - Found by: the tour's gap check (8 px between floating touch targets on compact and medium).
    - Fix and pin: the viewer stacks its floating controls with named sizes and M3's 8 px gap (`--hcm-map-chrome` 42 px for Mapbox's collapsed attribution plus the gap, `--hcm-timeline-block`, `--hcm-fab-size`, `--hcm-dock-gap` in `packages/ui/src/viewer/viewer-styles.ts`). The timeline was 100 px tall only because the browser's 1em margin of its `ol` collapsed through the track (so a page with larger text made it taller still); the margin is gone and the timeline is the 84 px its padding says. With the FAB moved up first, the open menu's first item left a 568 px phone, which the designed height gives back. Pinned by `packages/ui/test/viewer/kit-integration.test.ts` (the distances on a phone and a tablet, the smallest phone's open menu) and `hcm-timeline.test.ts` (the height at a 24 px font).
    - **A stack of floating controls built on another component's height needs that height to be a contract: name it, make the component hold it whatever the page's font, and measure the gaps in a test.**
58. **The open FAB menu and the toast dock took taps where they drew nothing.**
    - Seen: the tour at 768 and 1024 px: the open menu's host, as wide as its widest item, covered the timeline's thumb beside the FAB; on a phone held sideways the toasts' full-width dock covered the vertical timeline.
    - Found by: the occlusion check (five sampled points per control, a deep `elementFromPoint`).
    - Fix and pin: `hcm-fab-menu`'s host takes no pointer, only the FAB and the items do; the viewer's menu and toast docks take none either (the snackbar's surface does), and on a short phone the top docks end before the vertical timeline. Pinned by `fab-menu.test.ts` and `kit-integration.test.ts` (hit tests beside the FAB and beside the toast).
    - **A popup or a dock is a box around what it draws: give the box `pointer-events: none` and the drawn parts `auto`, or it blocks whatever lies under its empty corners.**
59. **The docked photo list could not scroll: a wrapper without a height broke the sheet's `block-size: 100%`.**
    - Seen: the tour from 1024 px up: the photos below the fold were cut off by the trailing pane, which hides its overflow (and, focused by Tab, scrolled the pane so its title left the top).
    - Found by: the edge check (cut off by an ancestor that hides its overflow and does not scroll).
    - Fix and pin: the photo list's wrapper (`.photos-sheet`) is `display: contents`, as the other sheets' hosts, so the docked sheet is as tall as the pane and its body scrolls (`hcm-map-viewer-layout.test.ts`).
    - **A percentage height needs a definite height on every box above it: one auto-height wrapper passes `auto` down and the content simply grows.**
60. **A focus ring of one colour failed on three surfaces, and Mapbox's labels kept the first language.**
    - Seen: the tour: the secondary ring measured 1.62:1 on the snackbar's inverse surface, 2.38:1 on the error container and 1.71:1 on Mapbox's white attribution in the dark scheme; after a language switch the page kept "Map", "Mapbox homepage" and the attribution toggle's name in English.
    - Found by: the Tab round's ring contrast and the i18n leak check of the `language` state.
    - Fix and pin: `focusRing` reads `--hcm-focus-ring-color`, which the snackbar (inverse primary) and the error card (on-error-container) set; the viewer gives Mapbox's attribution a `light-dark()` ring of primary and inverse primary. `MapPort.setLocale` rewrites Mapbox's UI strings, which Mapbox writes only when its controls are created (`S-V11-BAD-MAPBOX-LABELS`; `snackbar.test.ts`, `kit-integration.test.ts`, `mapbox-adapter.test.ts`).
    - **A ring that contrasts with the page's surface is not enough: every coloured surface a control sits on needs its own ring colour, and a third-party control's text needs a way back in after a language switch.**
61. **The map's canvas was wider than its box after a pane opened, on big screens and busy machines.**
    - Seen: the tour at 2560 and 3840 px (and 1280 px at a load average of 75): with a POI's pane docked, the canvas kept the map's old width and was cut off by the map's box.
    - Found by: the edge check, which probed before the browser had rendered a frame since the pane opened.
    - Fix and pin: the Mapbox adapter resizes the map inside the container's ResizeObserver callback (after layout, before paint, at most once a frame) instead of scheduling it for the next frame (`mapbox-adapter.test.ts`); the tour's `settleAnimations` (`e2e/support/layout.ts`) also waits two rendered frames after the animations stop, so what a frame triggers has happened before the probe.
    - **A ResizeObserver already runs once a frame: do the work in its callback, and let a layout probe wait for a rendered frame, not only for the animations to end.**
62. **On a phone the admin's bottom bar and its snackbar hid what the keyboard had just focused.**
    - Seen: the tour's first admin run (`docs/research/layout-a11y-findings.md`): at 360 × 800 a focused Setup header, link, field, switch and **Check again** ended under the sticky navigation bar (WCAG 2.4.11), axe found two Setup headers half under it (`target-size`), at 1440 px the account button scrolled away with the top bar, and once the bar was fixed the "page not found" snackbar covered the focused header instead. The bar's More sheet covered only the bar: the kit's sheet fills its positioned container, and the sticky bar was it.
    - Found by: the generic checkers on every admin state (behaviour A31): the Tab round's *focus obscured*, axe's `target-size`, the occlusion samples.
    - Fix and pin: the shell is an app shell: the frame is as tall as the window, the bars and the rail keep their own grid rows, only the page scrolls (`.scroller` in `<main>`), and the snackbar is docked below it (no room while empty); `packages/ui/test/admin/shell/shell-layout.test.ts` focuses the last control of a tall page at 360 px and checks it lies above the bar and the snackbar and is hit at its centre, that the top bar and the rail stay put while the page scrolls, and that the More sheet is as tall as the frame (`DECISIONS-for-review.md` §33f).
    - **A bar pinned over a scrolling page hides whatever scrolls under it, the focused control included: give the bars their own rows and let only the content scroll, and dock a message where it takes its own room.**
63. **A date field lost its focus ring on its calendar button, and the Setup page checked in mid-change.**
    - Seen: the USGS expiry field showed no ring on one of the stops Tab makes inside it; the unknown address's Setup page (smoke, 360 px) had every card closed for seconds, then opened billing in the middle of the Tab round and moved Mapbox's header off screen; the snackbar's 8 s timer ended mid-round and Tab "never reached" its Close.
    - Found by: the Tab round on the admin's states; a pointed unit test (`hcm-setup-usgs.test.ts`) Tabs through the field: on the calendar button the input matches only `:focus-within`, never `:focus` or `:focus-visible`.
    - Fix and pin: the fields' ring is `:focus-visible, :focus-within`; the Setup controller opens the step to resume at as soon as `setup.status` answers, and the legacy import's detection (it reads every photo) decides only when the import is that step (`controller.test.ts`); the smoke waits for the open card and an enabled **Check again**, and points at the snackbar (its timer waits while it is pointed at) before the checkers run.
    - **A native control can hold the focus inside its own shadow, where only `:focus-within` reaches it; and a state check needs a settled state: wait for what opens on its own, and hold what closes on its own.**
64. **Every kit button took taps only on what it drew: its 48 px touch target was cut to the 40 px button.**
    - Seen: the admin agent measured in Chromium that a tap 2 px outside the 40 px icon button (and 3 px below `hcm-button`, the chip, a segment) missed it (LA-6 of `docs/research/layout-a11y-findings.md`): the state layer's `.interactive { overflow: hidden }` (0,1,0) beat the components' own `button { overflow: visible }` (0,0,1), so the `touch-target` `::after` was clipped. Once the ring was hit-tested, the tour also found the bottom sheet's 24 px drag handle cut to 36 px by the sheet (its ring rose past the sheet's top edge) on every phone, and a two-letter segment ("Nu") 46 px wide whose ring then stuck out of a narrow container.
    - Found by: a pointed measurement, not the tour: the target-size check read the pseudo-element's computed 48 px, which stays 48 px however much of it is clipped.
    - Fix and pin: `touchTarget` sets `overflow: visible` on `.interactive.touch-target` (`packages/ui/test/components/touch-target.test.ts` hit-tests the ring of the icon button, button, chip and segment, and fails on the old style); the handle is a 48 × 48 button at the sheet's top (`sheet.test.ts`), a segment at least 48 px wide (`segmented-button.test.ts`); the checker's `targetSizeOf` hit-tests each side of the ring and counts it as far as a pointer reaches the control, a side off screen or scrolled out of its list counting as computed (`e2e/test/layout-probe.test.ts`).
    - **A computed size is not a hit area: measure a touch target by where a pointer lands, and check that nothing clips the part of it that lies outside the control.**
65. **The open menu's last item lay on the timeline's thumb on a tablet, and the tour let it.**
    - Seen: the visual audit's screenshot of the open menu at 768 × 1024: the FAB sits beside the timeline there, the items (wider than the FAB) end 8 px above the FAB, so "Despre" covered the top of the "Azi" thumb; the thumb's hit-tested target came out 44 px.
    - Found by: looking at the contact sheets. The tour passed because the open menu was sanctioned to cover any chrome (`under: '*'`), the stacking the user's report of 2026-10-12 was about.
    - Fix and pin: at medium and up the viewer sets `--hcm-fab-menu-gap` so the items end 8 px above the timeline (`kit-integration.test.ts`); the sanction is narrowed to the map's content and the two top docks the menu is designed to grow over on a short phone (`SANCTIONED_STACKINGS`, `e2e/test/layout-rules.test.ts`).
    - **A sanction is a hole in the check: scope it to what the design needs, and look at the screenshots of every state the hole covers.**
66. **A theme choice ran past its dialog's edge on phones, and every check passed because the dialog could scroll sideways.**
    - Seen: the visual audit's screenshot of the admin's account menu at 360 × 800: "Întunecată", the third segment of the theme choice, was cut by the dialog's edge; the viewer's About did the same at 320 px (12 px, 54 px with WCAG 1.4.12's text spacing). Three single words cannot wrap, and the kit's dialog content is `overflow: auto`, so it scrolled sideways.
    - Found by: looking at the contact sheets. The edge check accepts content a scroll container brings into view, and the page-scroll check looked at the page only.
    - Fix and pin: `hcm-segmented-button` stacks its segments one 48 px row each while they do not fit side by side and goes back once its host is as wide as they need (`segmented-button.test.ts`, the rows' hit-tested targets included); the layout checker's new `sideways-scroll` check reports any box but the page that scrolls sideways, naming what sticks out (`e2e/test/layout-probe.test.ts`, `layout-rules.test.ts`).
    - **A box that scrolls on one axis scrolls on both: a reflow check must look inside every scroller, not only at the page.**
67. **The admin was never checked in the dark scheme.**
    - Seen: the visual audit captured every admin state in light and dark; the admin's projects (c360, m768, l1440 in Romanian, l1440 in English) all ran in light, so axe's contrast, the focus rings and the non-text contrast of the admin's dark scheme had never been measured.
    - Found by: the audit's list of what each tier covers, not by a failure: the dark project passed on its first run.
    - Fix and pin: the project `admin-l1440-dark` runs the admin's specs and every state check in the dark scheme (part 1 of the split, on the NUC).
    - **Every scheme the product ships is a project of the checkers: a colour that is never rendered in a test is never checked.**
68. **The map's keyboard focus was invisible: its ring was drawn outside a box that hides its overflow.**
    - Seen: after the visual audit showed the bottom sheet's drag handle with a ring cut by the sheet's top edge, the new ring check found the same on every tour project for the map canvas (the viewer's shared ring, 2 px outside the canvas, which fills Mapbox's `overflow: hidden` box, so none of it was drawn) and for the links of Mapbox's full attribution in the box's corner (their ring's lower edge).
    - Found by: the screenshots first, then the Tab round's ring check, which until then only asked whether an outline was set and how it contrasted, never whether it was drawn.
    - Fix and pin: the canvas's ring is inset (`outline-offset: -3px`), the attribution's links take an offset-free ring with 3 px of padding around them, the handle a round ring inside its box (`kit-integration.test.ts`, `sheet.test.ts`); the probe's `ringCutterOf` reports a ring cut by an ancestor (`e2e/test/a11y-probe.test.ts`).
    - **A style that is set is not a style that is drawn: check that nothing clips the focus indicator, the way a pointer check hit-tests a target.**
69. **Tab reached only the first drawing tool of the places editor.**
    - Seen: admin, `#/pois/<id>`, every admin project: the kit's one-stop toolbar (`hcm-toolbar`) sets `tabindex` on its slotted icon-button hosts (0 on the active one, -1 on the rest); a host with `tabindex=-1` hides its shadow button from Tab, so Select and Add at centre were reachable only with the arrow keys, and the active host, a focusable element without a name of its own, counted as a stop Tab never reached.
    - Found by: the Tab round of `expectStateSound` at the state `pois.new-place` (e2e admin tier); the ui tests clicked the tools and axe has no rule for a focusable host without a name inside a toolbar.
    - Fix and pin: the tools are a named group (`role="group"`), each its own Tab stop, 8 px apart so their 48 px rings do not overlap (`S-A32-BAD-NO-MAP-TOKEN`, `packages/ui/test/admin/map/map-elements.test.ts`).
    - **A roving tabindex on custom-element hosts governs the hosts, not the controls in their shadow trees: keep every control its own Tab stop unless the focus pattern sets the controls' own `tabindex`.**
70. **The places list repeated four target and contrast faults the photos page had already fixed.**
    - Seen: admin, `#/pois`, at 360 and 768 px: native check boxes (their drawing reaches 1:1 against the surface), Import GeoJSON as a label around a 1 x 1 visually hidden file input (no border, and its focus hidden under other content), filter chips whose wrapped rows were 8 px apart (their 48 px rings overlapping), a 43 px wide History link, and, with text spacing at 360 px, the import dialog's Import ring over the bottom of the category select at the edge of the scrolling content.
    - Found by: the generic checkers at the admin projects (non-text contrast, focus obscured, target size, occlusion); the ui tests and axe passed.
    - Fix and pin: M3 check boxes with a `touch-target` ring, a kit button opening a `hidden` input, chip rows 16 px apart, `min-inline-size: 48px` on the link, the refusals listed after the select (`pois.list`, `pois.import-preview`, `S-A34-BAD-INVALID-FEATURES`); the dialog's action ring and the link width are reported to the kit's owners (CR-M2c-23).
    - **A new area starts from the patterns of the areas the checkers already passed: a native control or a visually hidden input brings back a fault that was fixed elsewhere.**
71. **A draft that had been touched kept another admin's stale values in the fields it did not change.**
    - Seen: admin, the photo editor: after a remote save, a draft with one edited field still held the old values of every other field, so the next Save would have written them back and undone the other admin's change.
    - Found by: `packages/admin/test/photos/draft.test.ts` (the photos workstream, CR-M2c-19).
    - Fix and pin: the draft rebases on every snapshot: the fields it does not change take the remote values, the overlapping ones raise the conflict choice.
    - **A draft is a set of changed fields over the latest snapshot, never a copy of the document taken when the editor opened.**
72. **A recording `Proxy` handed to a Lit property binding broke the render.**
    - Seen: ui tests of the photos and places pages: `nextDirectiveConstructor is not a constructor` once a page passed its intents to a child element.
    - Found by: the browser tests of the photos and places pages (CR-M2c-21).
    - Fix and pin: the fakes answer only intent names: `undefined` for `_$`-prefixed names and `then` (`packages/ui/test/admin/editing/fake-area.ts`, `kit.test.ts`).
    - **Lit probes a bound value for `_$litDirective$`: a test double that answers every property is a directive to Lit.**
73. **The kit's slider stayed where the key put it after the store refused the value.**
    - Seen: admin, the layer editor: the black level pressed past the white level stopped in the store, but the slider showed the refused position.
    - Found by: a ui test and the keyboard spec `S-A35-BAD-KEYBOARD-LIMITS` (CR-M2c-30).
    - Fix and pin: the binding is `live()`, and the announcement says the kept value (`packages/ui/test/admin/layers/layers-page.test.ts`).
    - **A control that moves itself must be bound with `live()` when the store may refuse the move: Lit compares with what it last rendered, not with what the control shows.**
74. **Dependency-cruiser's `no-circular` counts type-only imports.**
    - Seen: the content port importing an area's port which imported the umbrella port back for its shared types.
    - Found by: the `dependency-cruiser` gate (CR-M2c-26).
    - Fix and pin: the shared types live in a base file (`packages/ui/src/admin/area-port.ts`) that both import.
    - **Shared types go below both of their users, never in the file that aggregates them.**
75. **A text field that commits on `change` left Save disabled until the admin left the field, and a disabled button takes no click.**
    - Seen: admin, `#/pois`, a new point: the Romanian title typed, then a click on Save did nothing: the draft still had an empty title (the field reported it on `change` only), so Save stayed disabled, and a click on a disabled button does not take the focus, so `change` never fired.
    - Found by: the admin-to-viewer journey `S-A41-HAPPY-PLACE` and the revoke journey (`e2e/admin/specs/flows/`); the places spec had pressed Tab after every field.
    - Fix and pin: the place editor's titles, descriptions and links commit on `input` (`packages/ui/test/admin/pois/poi-editor.test.ts` types with `input` events); years still commit on `change`, since half a number is not a year (`DECISIONS-for-review.md` §35d).
    - **A spec that presses Tab after every field hides the click a person makes straight after typing: type, then click Save, as a person does.**
76. **The built Bucharest site refuses every manifest the backend builds.**
    - Seen: the viewer served the manifest the admin's save published: "cityId din config.js (bucuresti) nu corespunde hărții (bucharest)". The site's `config.js` and the legacy manifest name `bucuresti`; the project's city (`infra/project.json`), the admin and every built manifest name `bucharest`.
    - Found by: the first admin-to-viewer journey (`e2e/admin/specs/flows/publish.spec.ts`); each side was tested only against its own fixtures.
    - Fix and pin: the journeys serve the site a `config.js` naming the project's city; aligning the site is the user's decision (`DECISIONS-for-review.md` §35b).
    - **Test the hand-over between two apps with the real output of one as the input of the other: two fixtures that each pass prove nothing about the join.**
77. **A collection-group rule opened every `history` folder in the database to admins.**
    - Seen: `match /{path=**}/history/{entry}` (History's recent changes) let an admin read `setup/status/history/h1`, a path the contract does not name.
    - Found by: the rules matrix's default-deny test (`firebase/rules-tests/test/identity.test.ts`) in the integration's `tests` run.
    - Fix and pin: `get` requires the path to start with `cities`; `list` stays open to admins, because a condition on the path cannot hold for a collection-group query (the emulator then denies the whole query; `history.test.ts`).
    - **A recursive wildcard matches everywhere: narrow what a rule can narrow, and write down what a query rule cannot.**
78. **A new server-owned field needs a value in the rules tests' complete document, or its deny tests prove nothing.**
    - Seen: `replacement` joined `photoDocSchema`; the generated tests "a client cannot change or remove it" read `removed: allow` (the fixture had no such field to remove) and the create test sent `undefined`.
    - Found by: `firebase/rules-tests/test/client-writes.test.ts` and `documents.test.ts` in the integration's `tests` run.
    - Fix and pin: `photoDoc` in `firebase/rules-tests/test/support/documents.ts` carries `replacement`.
    - **The schema and the rules tests' fixture change together: a field the fixture lacks is a field no rule test exercises.**
79. **A revoked admin's open draft disappears with the page.**
    - Seen: admin, two browsers: the owner removed an admin whose place editor held a change; the admin's Save was refused, then the shell asked `admin.session` again and replaced the page with "This Google account does not administer this map", the draft with it.
    - Found by: `S-A02-BAD-REVOKE` (`e2e/admin/specs/flows/revoke.spec.ts`), which raced it at first: on some projects the title was read before the panel came.
    - Fix and pin: the spec asserts the refusal, that nothing is written and the panel; keeping the draft visible is `S-A20-BAD-REVOKED-WHILE-EDITING` (planned, `DECISIONS-for-review.md` §35e).
    - **Assert the state a race ends in, never one it passes through.**
80. **Playwright's `--project` takes every following word as a project name.**
    - Seen: `npx playwright test --project admin-l1440-ro admin/specs/flows` answered `Project(s) "admin/specs/flows" not found`.
    - Found by: running one spec folder during the integration.
    - Fix and pin: the file filter goes first: `npx playwright test admin/specs/flows --project admin-l1440-ro` (`docs/TESTING.md`).
    - **Put positional filters before variadic options.**
81. **Without a map, every editor's map box stayed an empty block above the form.**
    - Seen: the review screenshots of 2026-10-18, every admin editor at 360 × 800 and 768 × 1024: the box kept its 45vh (or 240 px) with only "The map appears once Mapbox is set up." at its top, pushing the editor's heading half a screen down.
    - Found by: looking at the contact sheets (`reports/screenshots/m2c/sheets/`); no checker measures empty space.
    - Fix and pin: `hcm-admin-map` sets `no-map` on its host while it only says why there is no map, and the pages size `[no-map]` to its note (`packages/ui/test/admin/map/map-elements.test.ts`, `packages/ui/test/admin/photos/photos-page.test.ts` measure the box against its note).
    - **A box sized for its content in one state needs its size in every other state: look at the screenshot of each.**
82. **On a wide pane the layer editor put the Romanian description beside the two names.**
    - Seen: `#/layers/<id>` at 1600 and 2560 px: the texts' auto-fit grid made three columns, so the Romanian and English fields no longer faced each other.
    - Found by: the contact sheet of `layers.editor` at 2560 × 1440.
    - Fix and pin: the localized pairs take at least half the row each (`.fields.pairs`); `packages/ui/test/admin/layers/layers-page.test.ts` checks the columns at 800, 1600 and 2560 px.
    - **A grid of paired fields fixes its column count; `auto-fit` is for fields that do not belong together.**
83. **"Configurare" broke after its tenth letter on the phone's navigation bar.**
    - Seen: every admin page at 360 px once the bar held four destinations and More: 72 px per item minus 4 px of padding each side left 64 px for a 65 px word, and `overflow-wrap: anywhere` put its last "e" on a line of its own.
    - Found by: the contact sheets; the text check looks for cut and overlapping text, not a word broken across lines.
    - Fix and pin: the bar's items have no inline padding; `packages/ui/test/admin/shell/nav-and-menu.test.ts` loads the kit's font ("HCM Roboto Flex") and fails on any word of a bar label split over two lines (a range per word; Lit's comment marker means every text node is read, not the first child).
    - **Measure text in the font the product draws it with: a fallback font is narrower, and the test passes for nothing.**
84. **A chosen row filled with the secondary container left its own fields at 1.27:1 in high contrast.**
    - Seen: the places editor's list of positions, the chosen position, in the light high-contrast scheme: the fields' borders and the row's icons against `secondary-container` (#554f64).
    - Found by: the non-text contrast check, only once the map box stopped pushing the list below the window (lesson 81): a state's checks see what is in the window.
    - Fix and pin: the chosen row is ringed (an inset 2 px `secondary` ring), not filled (`pois.editor` in the tour inventory).
    - **Never fill the background of a container whose controls are measured against the surface; and remember that a state's checks cover only what is scrolled into view.**
85. **The deployed admin logged a CORS error before its server existed.**
    - Seen: the live admin of 2026-10-17, a Hosting-only deploy of a new map: before sign-in the console said the fetch of `…cloudfunctions.net/admin-session` was blocked by CORS, then `net::ERR_FAILED`.
    - Found by: the user, in the browser's console; the e2e journey hid the server and claimed that error as expected.
    - Fix and pin: a new map's first deploy says it has no server (`HCM_ADMIN_START_UP=1`, `runtime.json` → `startUp`), and the admin then calls nothing of the server until Google lists every function `ACTIVE` (step d). Tried first in Chromium: a `no-cors` fetch only trades the CORS error for "Failed to load resource: the server responded with a status of 404": every answer of 400 or more is logged, whatever the mode (`S-A25-HAPPY` asserts no request and no console error; `S-A25-BAD-NO-START-UP-DEPLOY` keeps the probe's path).
    - **A request whose expected answer is an error always shows in the console: ask something that knows instead of probing what is not there.**
86. **A start-up page reloaded after its server came kept the admin in start-up mode.**
    - Seen: the owner's journey, after the claim: the reload to see USGS's approval opened the start-up sign-in again (the routed `runtime.json` still said `startUp`), as a functions-only deploy would leave the start-up page in place.
    - Found by: `e2e/admin/specs/journey.spec.ts` at the five admin projects, the first run with the start-up runtime.
    - Fix and pin: a browser that has had the server's answer (`hcm:admin:serverSeen`) probes despite `startUp` (`packages/admin/test/auth/controller.test.ts`, the journey).
    - **A deploy-time flag goes stale the moment the world changes: let what the browser has seen since outrank it.**
87. **The admin's boot log and crash reports said `release: dev`.**
    - Seen: the live admin's console, 2026-10-17: `admin booting { release: 'dev' }`; every crash report of the admin would have been filed under `dev`.
    - Found by: reading the live console; the `runtime.json` writer of §23b had never been built, and the fallback hid it.
    - Fix and pin: the admin's site build writes `runtime.json` with `<version>+<short commit>` (`scripts/site/test/admin-runtime.test.ts`, `admin-build.test.ts`).
    - **A value a report needs is written by the build that ships the code, not left to a deploy step that does not exist yet.**
88. **Turning a phone with the account menu open dropped the focus on the page.**
    - Seen: the admin at 360 × 800 with the account dialog open, turned to 800 × 360: the menu moved from the top bar to the rail's foot, the old one went with its dialog, and the focus fell to the body.
    - Found by: the hardening review's follow-up; the tour checks each state at one viewport, so nothing turned a page mid-state.
    - Fix and pin: the shell gives the new menu's button the focus when the one in use was replaced (`S-A29-BAD-ROTATE-MENU-OPEN`; `packages/ui/test/admin/shell/shell-layout.test.ts`).
    - **When a layout change re-creates a component, the focus it held must be handed to its successor: turn the device with the focus inside the part that moves.**
89. **A toast left from the previous state went in the middle of the next state's checks.**
    - Seen: the tour at 3840 × 2160, dark, on the NUC: `viewer.language` reported "Tab never reaches Close" for the toast the `locate-toast` state had held open; switching the language re-worded it, its timer started again, and it went during the Tab round.
    - Found by: the tour's generic checkers in a split run on the slower machine (the state passed on the laptop).
    - Fix and pin: the `language` state closes a leftover toast before it switches (`dismissToast`, `e2e/support/viewer.ts`).
    - **A state's checks need a settled page: close or hold whatever times out, never let a timer race the checks.**
90. **With the admin's map on screen, a dialog's scrim covered Mapbox's logo and attribution.**
    - Seen: the photos page with its map at 1440 × 900, the Set fields, delete and publish report dialogs open: the legal line under the scrim.
    - Found by: the generic layout checker's legal rule, once the admin's e2e had its mocked Mapbox (CR-M2c-7) and the map drew.
    - Fix and pin: the kit's modal registry (`packages/ui/src/components/modal-registry.ts`): an open modal dialog marks the admin map `covered`, which hides its canvas and controls until the dialog closes (`modal-registry.test.ts`, `dialog.test.ts`, `map-elements.test.ts`).
    - **A third party's legal line must stay visible or go with what it labels: hide the map under a modal instead of dimming it.**
91. **Publishing a batch of photos took one input more than its budget.**
    - Seen: `S-A10-HAPPY`, "select all and publish": Select all showed only after a first row was ticked.
    - Found by: the input budget of the content flows (`CONTENT_INPUT_BUDGETS`), counted by `InputFlow`.
    - Fix and pin: Select all shows whenever the list has rows (`photos-page.test.ts`).
    - **Count the inputs of a flow from the first screen: a control that appears only after another input costs that input.**
92. **A photo's pin could not be placed with a pointer.**
    - Seen: the photo editor with its map: in Select mode a click did nothing, and the click tools have no drag (Terra Draw waits for §34g).
    - Found by: `S-A09-HAPPY` driving the map with clicks (WCAG 2.5.7, a single-pointer alternative to dragging).
    - Fix and pin: in Select mode a click moves the selected point; the photo's editor selects its pin (`click-draw-adapter.test.ts`, `photos/map.test.ts`).
    - **Every drag needs a click-only alternative; a selected point should go where the pointer says.**
93. **A photo dropped before the city was read was created at 0, 0 and refused as "not an admin".**
    - Seen: `S-A37` specs uploading right after the page opened, with no remembered pin: the photo document at (0, 0), refused by the rules, which the page showed as a missing admin right.
    - Found by: the replace and upload specs in a fresh city of the content world.
    - Fix and pin: the upload queue waits for a pin (the last one, else the city's centre) before it creates the document (`upload-queue.test.ts` badPath_aFileDroppedBeforeTheCityIsReadWaitsForItsCentre).
    - **A default that depends on loaded data must wait for that data, never fall back to zero.**
94. **The shell wore the project's city theme in another city.**
    - Seen: a content world's city (`?city=`) in the admin: the colours of `project.cities[0]`.
    - Found by: the content specs' review screenshots.
    - Fix and pin: the shell's theme follows the edited city (`mount.test.ts`).
    - **Derive the theme from the same city the editors edit.**
95. **An import file chosen right after the places page opened was planned against no categories.**
    - Seen: `S-A34-BAD-MARKUP-IS-TEXT`, flaky 3 of 4: every feature "unknown category", an existing id counted as new.
    - Found by: the import spec choosing its file at once.
    - Fix and pin: the importer plans its preview again when the places or the categories change (`importer.test.ts`).
    - **A preview computed from live lists must be recomputed when they arrive.**
96. **The list of positions kept a coordinate the map had refused.**
    - Seen: a position typed outside the city: the field kept the refused value while the shape kept its old position.
    - Found by: `S-A32-BAD-OUTSIDE-CITY`.
    - Fix and pin: a refused value puts the field back at the shape's position (`map-elements.test.ts`).
    - **A field must show what was stored, not what was refused.**
97. **A new place's toolbar said Select while the map was drawing.**
    - Seen: Add place, Area: the Select tool pressed (and its hint about dragging) while each click added a position.
    - Found by: the drawing spec reading the pressed tool.
    - Fix and pin: the tools follow the drawing session; a finished point selects (`poi-editor.test.ts`).
    - **A toolbar is a view of the mode, never its own state.**
98. **Importing over the limit did not say the numbers.**
    - Seen: "the file would pass 5000 places", without how many there are and how many the file adds; a failed count read as too many.
    - Found by: `S-A34-BAD-TOO-MANY` ("with the numbers").
    - Fix and pin: the refusal names the city's count, the file's and the limit; a count that failed is a failure (`importer.test.ts`, `pois-page.test.ts`).
    - **A limit refused should name the limit and both sides of the sum.**
99. **A place's address opened directly on a phone went Back to the previous site.**
    - Seen: `#/pois/gara` opened from a link: the browser's Back left the admin.
    - Found by: `S-A29-BAD-DEEP-LINK-COMPACT`.
    - Fix and pin: the navigation puts the list under an item opened directly (`navigation.test.ts`).
    - **An item reached by its address needs its list under it in the history.**
100. **A phone held sideways had no page heading.**
    - Seen: 915 × 412, the rail and no top bar: axe's `page-has-heading-one`.
    - Found by: `S-A29-BAD-LANDSCAPE-PHONE` through the generic checkers.
    - Fix and pin: a visually hidden h1 in the main region when the top bar is not shown (`shell-layout.test.ts`).
    - **Every layout of a page keeps its heading; hiding a bar must not hide the page's name.**
101. **The places list did not preview the open draft.**
    - Seen: a title changed in the editor, the list beside it still showed the old one.
    - Found by: `S-A38-HAPPY` (M2c-interfaces §5.2).
    - Fix and pin: the list shows the open draft (`pois-page.test.ts`).
    - **What the contract says is previewed must be checked where it is previewed.**
102. **A place added before the city's categories were listed lost its remembered category.**
    - Seen: Add place right after the page opened: the select showed the first category, the draft had none and was invalid.
    - Found by: `S-A30-BAD-STICKY-FIELDS`, flaky 1 of 3.
    - Fix and pin: a new place without a category gets the remembered one (else the first) once the categories arrive or when it opens (`pois.test.ts`).
    - **A remembered choice must be applied when its options arrive, not only when the form opens.**
103. **A refused Mapbox or USGS save left the chip as it was, although the server recorded why.**
    - Seen: a revoked Mapbox token: the alert said so, the chip stayed "To do".
    - Found by: `S-A06-BAD-REVOKED`.
    - Fix and pin: after a refused save the card reads `setup.status` again (`credentials.test.ts`).
    - **When the server records a failure, show its record, not a guess of it.**
104. **A provisioning item's own reason vanished once the run was recorded.**
    - Seen: an organisation policy blocking the public bucket: "Needs attention" and no reason in normal mode.
    - Found by: `S-A04-BAD-ORG-POLICY`.
    - Fix and pin: an item keeps the reason the page knows when the record has none for the same state (`records.test.ts`); `setup.recordCloud` keeps API error codes only.
    - **When a store keeps less than the page knows, merge rather than replace.**
105. **A Google token that expired mid-provisioning offered only a Retry that could not work.**
    - Seen: the item said "Continue to renew it", the card showed Retry, which ran again with the dead token.
    - Found by: `S-A04-BAD-TOKEN-EXPIRED-MID-RUN`; the unit test's fake provisioner threw, the real one stops and resolves.
    - Fix and pin: a run that stopped on a 401 drops the token and offers Continue (`provision.test.ts`).
    - **A fake must fail the way the real thing fails; read the real one's contract before writing the fake's.**
106. **The start-up steps' results were lost when the page reloaded before the server came.**
    - Seen: after the claim, billing and provisioning back to "To do": the bootstrap record in `sessionStorage` had been overwritten by the claim card's first change, before the Setup controller read it.
    - Found by: `S-A26-BAD-TOKEN-GONE`.
    - Fix and pin: the record is mirrored only once it was read (`context.test.ts`, `controller.test.ts`).
    - **A store mirrored on every change must be read before the first write.**
107. **On a landscape phone the editors flapped between one pane and two.**
    - Seen: 915 × 412: the full-screen editor hid the rail, which widened the page past 840 px, which split it and brought the rail back; the Tab round missed what the flap left inert.
    - Found by: the admin tour (§34c) at `tour-c915l`, its first run.
    - Fix and pin: the list and detail never split at a compact height (`splitsAt`, `kit.test.ts`).
    - **A layout decision that changes what it measures needs a rule that does not depend on its own result.**
108. **A map scrolled to a strip had its own attribution counted as covering it.**
    - Seen: the layer editor at 915 × 412, scrolled: a sample of the canvas hit Mapbox's attribution.
    - Found by: the admin tour's scroll sweep at `tour-c915l`.
    - Fix and pin: the layout probe counts a map's own controls over its canvas as the map (`ownMapControl`, `layout-probe.test.ts`); the legal rule still checks them.
    - **A checker's rule must know what a component draws over itself by design.**
109. **In WebKit the admin stayed at "Loading…" behind a gapi stand-in that never answered.**
    - Seen: the first `admin-webkit-l1440-ro` run: Firebase Auth fetches Google's gapi loader as soon as it starts on Safari; the firewall refused it, and a first stand-in (an empty script) left Firebase waiting for its callback, holding the admin's start.
    - Found by: the Firefox and WebKit projects of the editors' forms (CR-M2c-7's follow-up).
    - Fix and pin: the fake upstreams answer `apis.google.com/js/api.js` with a loader that calls its callback without `gapi.load`, which Firebase handles as an unreachable loader (`google-apis.ts`, `upstream-google.test.ts`). The CSP messages WebKit logs for Playwright's own inspector styles and for the report-only Trusted Types header are expected only in the WebKit projects, each with its reason (`engineConsoleErrors`); the header is for the user (`DECISIONS-for-review.md` §37g).
    - **A stand-in must fail the way the real service fails, quickly: one that never answers holds whatever waits for it.**
110. **A long-lived emulator turned green journeys red.**
    - Seen: the History and drawing journeys failed in every project of a per-push tour, even alone, after hours of runs against one Functions emulator: its trigger queue was minutes behind (about three trigger runs a second, 25,000 runs), so a history entry or a manifest build came after the test's wait.
    - Found by: the admin tour's runs in the long-lived dev container; a fresh emulator passed the same run (126 of 127).
    - Fix and pin: none in the product; the pipeline starts its emulators per run, and the waits on the Functions emulator share `FUNCTIONS_TIMEOUT_MS` (120 s) for a full parallel run.
    - **Before blaming the code, look at how far behind the shared service is; restart a long-lived emulator before believing a wave of timeouts.**
111. **"Add at centre" placed a new place nowhere when it was clicked before the city's view was read.**
    - Seen: `flows/publish.spec.ts` at `admin-c360-ro` on the NUC: the place's list of positions stayed empty after the click; the map had no centre yet to give.
    - Found by: the split quality run, under the load of every worker.
    - Fix and pin: the drawing toolbar's "Add at centre" is off until the places page knows the city's view (`canAddCentre`, `centreKnown`; `map-elements.test.ts`, `pois-page.test.ts`).
    - **A control that needs data must be off until the data is there; a busy machine clicks before a person would.**
112. **Every admin page checked Google Analytics while the Setup's analytics card was the next step.**
    - Seen: `photos/publish.spec.ts` on the Photos page logged `setup-analyticsConfig` 400 ("not enabled") at start: the Setup Assistant runs on every page of an admin session, and opening its next step, analytics, ran the card's check and listed the crash groups.
    - Found by: the console guard, when a locked Setup test had left the project's `setup/status` at that step.
    - Fix and pin: the analytics card checks only while the Setup page shows (`setPageShown`, `controller.test.ts`, `module.test.ts`).
    - **A step's check belongs to its card on screen, not to a state machine that runs behind every page.**
113. **Tests without the lock read what the locked tests reset.**
    - Seen: the Admins page of a locked test lacked its owner (the list is the oldest 100 by `createdAt`, and the content worlds' admins were older and never removed); a content test of a removed admin saw the claim screen, because a locked test's reset had emptied `setup/owner` for a moment.
    - Found by: the split quality run (five admin projects, sixteen workers).
    - Fix and pin: a content world's admin joins after the personas (`JOINED`) and leaves at teardown (`ContentWorld.retire`); the removed-admin test moved to the locked `flows/revoke.spec.ts`.
    - **A lock-free test may touch only its own world: any answer that depends on a project-wide document belongs under the lock.**
114. **The first click of a new line or area vanished when its category arrived.**
    - Seen: the drawing tour at `tour-x3840-dark-ro` and `tour-c360-light-en`: four clicks gave an area of the last three corners, two clicks no line; the first click's dot showed, then went.
    - Found by: the admin tour under the split run's load, read from the trace (the positions kept were clicks two to four).
    - Fix and pin: the places map sets the drawing tools again for a shape not drawn yet only when they are in another mode; applying the same place again (its colour, once the categories arrive) no longer empties a started sketch (`map-session.ts`, `map-session.test.ts`).
    - **Re-applying the same state must be a no-op: a setter that also resets loses whatever the user started meanwhile.**
115. **A state was checked before the map its editor had just opened existed.**
    - Seen: `admin.photos.editor` at `tour-c360-light-ro`: "0 visible map attributions"; the wait for loaded maps saw no map yet and passed at once.
    - Found by: the admin tour, opening a photo from the compact list.
    - Fix and pin: the state check also waits while an admin map box is still creating its map (`status` `loading`, `mapsLoadedInPage` in `e2e/support/state-check.ts`).
    - **A wait for "every map loaded" passes on no map at all: wait for what is about to exist, too.**
116. **A locked test's reset deleted every content world's public photo files.**
    - Seen: `photos/publish.spec.ts` (unpublish) at `admin-c360-ro`: no public file of a photo just processed; the Undo of a delete could not restore a photo whose files were gone.
    - Found by: the targeted rerun of the split run's failures, beside the locked specs.
    - Fix and pin: the reset reads a Storage path's city where `STORAGE_PATHS` puts it (second in `photos/<city>/…` and `cities/<city>/…`, third in `uploads/photos/<city>/…` and `originals/photos/<city>/…`); it took the photo's id for the city of a public derivative (`storageKeptByReset`, `e2e/admin/support/emulators.ts`).
    - **A rule that keeps other tests' data must be checked against every path family it meets, not the first one written.**
117. **A new photo was refused as "changed by someone else" by its own first write.**
    - Seen: `photos/interrupted.spec.ts` at `admin-c360-ro` and `photos/upload.spec.ts` at `admin-l1440-dark` on the NUC: the photo document's create was answered 409 `ALREADY_EXISTS` although the document holding its data dated from that very commit; Firestore's SDK ran the transaction again, which found the document and reported a conflict, so the upload never started.
    - Found by: the split quality run, read from the trace's commit bodies.
    - Fix and pin: a create that finds a document holding exactly its data, stamped by the same admin, takes it as its own landed attempt (`#ownCreate`, `packages/admin/src/firebase/content.ts`, `content.test.ts`); any other document stays a conflict. The 409 Chromium logs for such a commit is expected in the admin projects with its reason (`FIRESTORE_COMMIT_RETRIED`, `e2e/admin/support/test.ts`, which also expects the 400 of a commit refused because a trigger wrote the document since the transaction's read).
    - **A transaction may run again after a commit whose answer was lost: its check must accept its own earlier write.**
118. **Saving a photo opened as soon as it was processed said another admin had changed it.**
    - Seen: `photos/publish.spec.ts` (publish on the first Save) at `admin-c360-ro`: "Someone else changed: published"; the upload queue had just written its suggestions (the place, the title) in a transaction, which the editor's listener had not delivered yet, so the Save's version check found a newer version and every changed field was named.
    - Found by: the targeted rerun of the photo specs beside the locked chain, read from the trace's commits.
    - Fix and pin: a Save refused for a newer version waits for that version, still saving (at most `REFUSED_WAIT_MS`); once it is the base, a change of other fields has merged in and the Save goes again, so its outcome is the second write's and what follows a Save (the remembered fields, "Saved") follows it; a change of the same fields is the conflict (`#decideRefusal`, `packages/admin/src/photos/draft.ts`, `draft.test.ts`). A first version retried in the background was found by `editing/sticky.spec.ts`: the Save said the conflict and the fields were not remembered.
    - **A version check is about the document; a conflict is about fields: decide it with the newer version in hand.**
119. **A test failed before it began: the Auth emulator dropped the sign-in of its content world.**
    - Seen: `photos/upload.spec.ts` at `admin-c360-ro`, a repeat of the photo specs beside the locked chain: `signInWithIdp` failed with `socket hang up (ECONNRESET)` while the fixture prepared the world.
    - Found by: the targeted rerun with `--repeat-each=2`.
    - Fix and pin: the emulator helpers send a request again when the emulator drops the connection, at most twice (`resending`, `e2e/admin/support/resend.ts`); every request they send is idempotent.
    - **A shared local service under load drops connections: the test's own plumbing must survive a reset; the product's requests are still checked as they are.**
120. **An admin of a deployed map was shown the start-up mode when the server's first answer was slow.**
    - Seen: `editing/drafts.spec.ts` (two tests) and `editing/sticky.spec.ts` at `admin-l1440-ro` in a split run: the places editor never came; the page asked to "confirm again with Google" to continue the setup. The one anonymous probe of `admin-session` had timed out after 10 s on a busy Functions emulator, which the shell took for "no server" for the whole visit.
    - Found by: the split quality run, from the failures' page snapshots.
    - Fix and pin: a probe that timed out is sent again, up to three in all (`PROBE_ATTEMPTS`, `packages/admin/src/auth/controller.ts`, `controller.test.ts`); a missing or unreachable server is still decided by the first answer (M2b-interfaces §1.4).
    - **A timeout is not an answer: a decision that sends a person somewhere else needs one, or a second try.**
121. **Undo of a photo's delete said "use History" although the delete's entry was there.**
    - Seen: `photos/publish.spec.ts` (Undo) at `admin-c360-ro` on the NUC, twice: the photo's history held the delete stamped `09:57:03Z` and the publish before it stamped `09:57:03.215Z`; Undo takes the newest entry by its stamp and found the update.
    - Found by: the split quality runs, from the history entries the test's own reads recorded in its trace.
    - Fix and pin: a delete's entry is stamped at the event's time but never before the version it deleted (a millisecond after it), since the Firestore emulator's event times have whole seconds (`deletedAt`, `functions/src/history/record.ts`, `record.test.ts`; M2-interfaces §2.2).
    - **An order built from two clocks needs a rule for when they disagree: a delete cannot come before what it deleted.**
122. **Leaving a settings section right after Save asked about changes already stored.**
    - Seen: the tour's settings journey at `tour-x2560-light-ro` (`tour-matrix`) and `editing/sticky.spec.ts`: Save, then another section at once: the unsaved guard's question, because a section's draft counted its changes as unsaved until the snapshot of its own write came back.
    - Found by: the split `all` run's tour matrix.
    - Fix and pin: the editing kit's draft is not unsaved right after a successful Save until the next edit (`#written`, `packages/admin/src/layers/draft.ts`, `draft.test.ts`), as the places' draft already was; the specs wait for the page's own "Saved" before they leave.
    - **A guard must ask about what the person would lose, not about what the page has not heard back yet.**
123. **The settings' round colour presets counted as covered at 320 × 568.**
    - Seen: `admin.settings.theme` in every `tour-c320-*` project (`tour-matrix`): the detail pane cut the presets row to its top 8 px, and two of the five points the occlusion check sampled in that strip lay outside the round buttons, where the hit is their own row.
    - Found by: the split `all` run's tour matrix, the first with the admin's journeys at every viewport.
    - Fix and pin: the checker samples a control only inside its own shape, its box without the corners its rounded border cuts off (`withinShape`, `e2e/support/dom-walk.ts`; `layout-probe.test.ts`); a control another element covers still fails. Nothing was allowlisted.
    - **A probe that samples a box must know the shape it stands for: a circle is not its bounding square.**
124. **The admin's Romanian put a number before a noun: "Ștergi 1 locuri?", "Au revenit 1 câmpuri", "Importă cele 45 fotografii", "De 1 ori".**
    - Seen: the M2d review screenshots (`reports/screenshots/m2d/`, the history's revert snackbar and the jobs, crashes and import cards) and the unit tests that pinned the wrong text (`Point, 1 positions`, `1 items`); Romanian needs "un loc", "2 locuri" and "45 de fotografii", English "1 place".
    - Found by: reading the contact sheets; the i18n gate checks keys and placeholders, not grammar.
    - Fix and pin: every admin count says "Noun: {count}" or "the selected nouns ({count})" (`admin-pois`, `admin-ops`, `admin-setup`, `admin-shell` catalogues; `pois-page.test.ts`, `history-page.test.ts`, `hcm-setup-analytics.test.ts`, `crashes-home.test.ts`, `i18n-admin.test.ts`); the same pass made "(opțional)" agree with feminine labels ("Descriere (română, opțională)"), the who of "Modificat de {who}" "tine" and "server" (`editor-chrome.test.ts`), deletes say "restaura din Istoric" as the History button does, the three editors' conflict buttons the same words, a layer's tiles "dale" everywhere, and the photos' empty state names the button instead of a drop a phone cannot make.
    - **A count goes after a colon or in parentheses unless the catalogue has plural forms; a test that pins "1 positions" pins a bug.**
125. **History showed a year as "1,980" and a geometry as "Point" or "LineString".**
    - Seen: the history's "Ce s-a schimbat" values (`describeValue`), pinned so by `history-page.test.ts`.
    - Found by: the M2d UX review of the history screens.
    - Fix and pin: years (`year`, `yearStart`, `yearEnd`) are formatted without grouping and a geometry's type uses the place editor's shape names ("Linie, poziții: 3") (`packages/ui/src/admin/history/describe.ts`, `history-page.test.ts`).
    - **A number that names something (a year, an id) is not a quantity: format it without a thousands separator.**
126. **A category's swatch sat inside its name, which then broke over two lines on a phone with its opacity under the swatch.**
    - Seen: `admin.settings.categories` and `categories-limit` at every viewport in the M2d review screenshots ("Categoria" / "01" beside a 40 px circle at 360 × 800).
    - Found by: the contact sheets; the tour's checkers passed it (nothing overlapped or was cut).
    - Fix and pin: a reorder row's `lead` is the row's first grid column beside both lines (`.row[data-lead]`, `packages/ui/src/admin/layers/reorder.ts`, `layers-styles.ts`; `categories.test.ts` measures the swatch left of the name and centred on both lines).
    - **A leading icon is a column of the list item, never an inline glyph in its title.**
127. **The settings repeated one bounds problem under all four edges, and told the admin to draw a rectangle on a map the page does not have.**
    - Seen: `admin.settings.area-invalid` in the M2d review screenshots: the same sentence four times at 360 × 800; the help text above them said "Desenează un dreptunghi pe hartă" while the settings page has no map yet (§37e).
    - Found by: the contact sheets.
    - Fix and pin: a problem of the bounds as a whole is said once below the four edges, each edge `aria-invalid` and described by it, an edge's own problem still at that edge (`issueShownAt`, `packages/ui/src/admin/layers/form-parts.ts`, `settings/area-section.ts`; `settings-page.test.ts`); the help says to type the four edges.
    - **A rule that spans fields is said once, where the fields are, and every field it names points to it; help text describes the screen that exists.**
128. **The timeline spec read the 1966 markers before the year's filter was drawn.**
    - Seen: `S-V04-HAPPY` at `fn-m768-ro` on the NUC in the final split `all` run of 2026-10-18: at the 1966 stop the map still drew today's eleven markers, among them `gara-obor` and `parcul-ferdinand-1930`.
    - Found by: the split `all` run; every other project passed it. The spec polled until the markers contained the 1960 photo, which today's markers already did, then read them once.
    - Fix and pin: one poll for the whole filtered set, the 1960 photo present and nothing outside 1956–1976 (`e2e/specs/viewer/timeline.spec.ts`).
    - **Poll for the state you assert, never for a part of it that the previous state already had.**
129. **The Setup cards' copy buttons stood at a different place in every row.**
    - Seen: `admin.deploy-waiting` in the M2 final screenshots (`reports/screenshots/m2-final/`), every viewport: the four repository variables' copy buttons zigzagged, each midway between its value and the row's end; the Mapbox scopes and the USGS request rows the same.
    - Found by: reading the contact sheets; nothing overlapped, so no checker could see it.
    - Fix and pin: a copy row's text takes the free space and the button with its "Copied." status follows it (`.copy-row > :first-child`, `packages/ui/src/admin/setup/setup-styles.ts`; `badPath_theCopyButtonsLineUpWhateverTheValuesLength` in `hcm-setup-credentials.test.ts` measures values of different lengths at 1000 px, where the old rule fails).
    - **`justify-content: space-between` over three items puts the middle one midway: give the text the free space instead, and test with values of different lengths.**
130. **The places editor put Save before Discard changes, the other editors after it.**
    - Seen: the M2 final screenshots, `admin.pois.editor` beside `admin.layers.editor` and the settings: Save, then Discard in places; Discard, then Save in layers and settings.
    - Found by: the contact sheets; each editor's tests checked its own buttons, never the order across editors.
    - Fix and pin: the places editor's head reads Discard changes, then Save at the trailing end (`packages/ui/src/admin/pois/hcm-poi-editor.ts`; `poi-editor.test.ts` pins the order).
    - **The same two actions keep the same order in every editor; Material puts the confirming one last.**
131. **The silent-refresh spec left the place editor while its Save was still on its way.**
    - Seen: `S-A20-HAPPY` at `admin-c360-ro` on the NUC in the final split `all` run of 2026-10-18: the address of the places list was held back and the editor stayed, saved.
    - Found by: the split `all` run; the spec waited for the write in Firestore (the emulator's REST API), which can hold it before the page has its answer, and a draft still saving holds a new address back (lesson 122).
    - Fix and pin: the spec waits for the page's own "Saved" before it leaves (`e2e/admin/specs/shell/shell.spec.ts`), as `editing/sticky.spec.ts` does.
    - **What the server holds is not what the page knows: leave a page only once the page says so.**
132. **Terra Draw's selection marks moved the photo's pin back over a place typed in its fields.**
    - Seen: `S-A09-BAD-PIN-OUTSIDE-CITY` at `admin-c360-ro` and `-l1440-ro`, the first run with Terra Draw (DECISIONS-for-review.md §41b): a longitude typed beyond the city went back to `26.1` before the field could say why.
    - Found by: the admin tier; the click tools passed it. A debug log of Terra Draw's events showed a `change` of type `update` with `{target: 'properties'}` (the pin's selection mark, as the port removed it) and the port's own updates with `{origin: 'api'}`; the port reported both as drags, and the photo editor took the pin's old place as the admin's.
    - Fix and pin: the adapter reports only geometry changes that do not come from itself (`packages/ui/src/map/draw/terra-draw-adapter.ts`; `terra-draw-editing.test.ts`: a reload and a click-move emit no echo, a properties change none).
    - **A library's change events include its own bookkeeping and your own API calls: report only what the user did.**
133. **A vertex drag released over the map's zoom button never ended.**
    - Seen: `S-A32-HAPPY-VERTEX-EDIT` at `admin-c360-ro`: the corner moved on the map but the list of positions kept the old one; the release point, 30 px east of the north-east corner, lay on the zoom-out button in the map's corner.
    - Found by: the admin tier at the phone's size; Terra Draw ends a drag only on a `pointerup` whose target is the map's canvas.
    - Fix and pin: the spec drags the corner into the map (`e2e/admin/specs/pois/dragging.spec.ts`), and its comment says why.
    - **A drag on a map ends where the map is: aim a release at the map, never at the controls over it.**
134. **A spec polled for five saved positions, which the seeded area already had.**
    - Seen: `S-A32-HAPPY-VERTEX-EDIT` at `admin-l1440-ro`: the poll passed at once, before Save had written, and the next assertion read the seed.
    - Found by: the failure screenshot (the editor still said "Saving…").
    - Fix and pin: the spec polls for the moved corner itself (lesson 128's rule again).
    - **Poll for the change, not for a shape the old value shares.**
135. **The Deleted filter of History was checked while its list still offered "Show more".**
    - Seen: `admin.history.deleted` at `tour-x3840-light-ro` on the NUC in the split `e2e` run of 2026-10-18: "Tab never reaches „Arată mai multe”"; twelve runs on the laptop passed.
    - Found by: the split run under load; the state was checked as soon as its Restore button showed, while the list behind the new filter could still answer from the cache with a further page, whose button then went.
    - Fix and pin: the tour waits until the filtered list offers no further page before the check (`e2e/tour/admin-history.tour.ts`).
    - **Check a state once everything it shows has settled, not once the one thing you need appeared.**
136. **The settings page rendered the admin map its chunk never defined.**
    - Seen: `S-A19-HAPPY`, `S-A36-HAPPY` and `S-A36-BAD-DISCARD` at `admin-l1440-ro`: "the admin map is created" never held; the area and overlays sections showed an empty box above the form.
    - Found by: the failure screenshot (the box had its size, nothing inside); the unit tests had passed because the ui test bundle defines every element.
    - Fix and pin: `defineSettingsElements` defines `<hcm-admin-map>`; `packages/ui/test/admin/editing/areas.test.ts` checks every chunk that shows the map defines it (DECISIONS-for-review.md §42a).
    - **A lazy chunk defines every element it renders; a test that loads all elements at once cannot see a missing one.**
137. **A conflict spec rewrote the document it had read back from the emulator.**
    - Seen: `S-A38-BAD-CONFLICT` at `admin-l1440-ro`: no conflict banner; the places list said there was no place at all.
    - Found by: the failure screenshot; the emulator's read gives timestamps and nested values in its own form, which the place schema refuses, so the list dropped the document and the editor heard no remote change.
    - Fix and pin: the other admin's save goes through the spec's own seed helper (`e2e/admin/specs/pois/conflict.spec.ts`).
    - **Write a document in its schema's shape; never round-trip one through a reader that changes its types.**
138. **A spec looked for an overflow menu's actions inside its `dialog` role.**
    - Seen: `S-A33-HAPPY-BULK`, `S-A10-HAPPY-RIGHTS-REVIEW` and `S-A38-BAD-DELETED-WHILE-EDITING` at `admin-l1440-ro`: the action button was never found, the dialog was open and named.
    - Found by: a diagnostic run listing the dialog's buttons: only Close. The actions are slotted into `hcm-dialog`, so they are children of the host element, not of the native `<dialog>` in its shadow root, which a locator scopes to.
    - Fix and pin: `menuDialog` and `chooseInMenu` (`e2e/admin/support/menu.ts`) look inside the open `hcm-dialog` host; the photos and places tours use them.
    - **Scope a locator to the element that holds slotted content, not to the shadow element that renders it.**
139. **The places' conflict banner put its text beside its two buttons.**
    - Seen: `admin.editing.conflict` at `admin-c360-ro` in the split `quality` run: Keep mine 76 px wide, covered by Take theirs, its touch target 44 px.
    - Found by: the generic layout and accessibility checkers on the new state (until then no spec checked the banner at a phone's width).
    - Fix and pin: the banner stacks its text above the actions (`.alert-body` of the editing kit), as the layers' banner did; the state runs at every admin project.
    - **On a phone, a banner's actions go under its text, never beside it.**
140. **A spec clicked "the confirm button of the confirmation dialog" on a page with two.**
    - Seen: `S-A06-HAPPY-ROTATE` at `admin-steps-l1440-en`: strict mode found Discard changes (the unsaved guard's) and Replace.
    - Found by: the split run; the laptop's single run had passed by the order the elements happened to come in.
    - Fix and pin: the spec takes the confirm button of the dialog it opened, by its name (`e2e/admin/steps/mapbox.spec.ts`).
    - **Locate an action inside the dialog it belongs to, by its name, never by a class every dialog shares.**

141. **An opened photo or place stayed off its editor's map.**
    - Seen: the 2026-10-18 review screenshots of `admin.photos.editor` at 360×800 to 1440×900: the open photo's pin was below the map's box, because the map opened at the city's starting view (here the bounds' centre) and nothing moved it; the photos area had a `focusPhoto` intent no element called, and the places map had none.
    - Found by: the review screenshots (`HCM_STATE_SCREENSHOTS`, docs/TESTING.md → *Review screenshots*); no checker can see that the edited item is outside the map.
    - Fix and pin: the photos map session's `reveal` and the places map's `#reveal` centre the map on the opened item once (its zoom kept, no animation; a new place, with nothing drawn, and an edit of the open item move nothing) (`packages/admin/src/photos/map.ts`, `packages/admin/src/pois/map-session.ts`); `S-A09-HAPPY-OPEN-IN-VIEW` (`e2e/tour/admin-photos.tour.ts`), `S-A32-HAPPY-OPEN-IN-VIEW` and `S-A32-BAD-NEW-PLACE-KEEPS-VIEW` (`e2e/admin/specs/pois/in-view.spec.ts`), and unit tests in `packages/admin/test/photos/map.test.ts` and `packages/admin/test/pois/map-session.test.ts`.
    - **An editor with a map brings the item it opens into view; an intent no element calls is a missing behaviour, not a finished one.**

142. **The dashboard's tiles in one row had different heights.**
    - Seen: `admin.home.dashboard` at every size: in "Waiting for you", the tile whose label wraps to two lines was taller than its neighbours.
    - Found by: the review screenshots; the grid stretched each list item to the row's height, but the link inside it, the visible tile, kept its own height.
    - Fix and pin: the list item is a flex box and the tile grows to fill it (`packages/ui/src/admin/home/hcm-home-page.ts`); the M2e review's contact sheets of the dashboard show the rows even.
    - **In a grid of cards, stretch the visible card, not only the grid item that holds it.**

143. **A portrait phone laid the places editor over the "Set up Mapbox" note.**
    - Seen: `admin.pois.editor` without a map token at the `tour-c320-*` projects (320 × 568): "Configurează Mapbox" covered by Save and Discard changes.
    - Found by: the tour matrix in the split `all`; the per-push projects (360 px and up) never measured a compact height there.
    - Fix and pin: the box without a map no longer shrinks (`:host([no-map]) { flex: none }`, `packages/ui/src/admin/map/hcm-admin-map.ts`), and the map-beside-the-form layout of a compact height needs a medium width (`packages/ui/src/admin/editing/wide-layout.ts`); `S-A32-BAD-NO-MAP-TOKEN` at `tour-c320-*`.
    - **A height class measured on the page area is compact on a portrait phone too while its bar shows; a layout meant for a landscape phone also asks for its width.**

144. **The legal-line rule asked for a logo on a 4 px strip of map.**
    - Seen: `admin.settings.area-refused` at `tour-m768-*`, the settings pane scrolled to its end: "0 visible Mapbox logos instead of exactly one", the map's last 4.6 px at the pane's top and its controls 6 to 10 px above its foot.
    - Found by: the scroll sweep of the tour matrix.
    - Fix and pin: `showsItsFoot` also asks that the visible strip be taller than the band under the lowest legal control (`legalGap`, `e2e/support/layout-probe.ts`; `e2e/test/layout-probe.test.ts`); one pixel of a control on screen and the rule applies (`docs/research/DECISIONS-for-review.md` §43b).
    - **Make a checker exact where it is wrong, with a unit test of both sides of the edge; never quiet it with an allowlist.**

145. **History's Deleted filter offered "Show more" for good in the shared emulators.**
    - Seen: `S-A23-HAPPY-RESTORE-DELETED` at `tour-x3840-*-en` on the NUC: the spec of lesson 135 waited 15 s for "Show more" to go.
    - Found by: the tour matrix; the recent-changes query reads every city's `history` and the page leaves the others' entries out (CR-M2c-14), so a page full of other tests' deletions has more to show.
    - Fix and pin: the tour waits for the server's answer (no "Reconnecting…" status) and lets "Show more" be (`e2e/tour/admin-history.tour.ts`).
    - **In shared emulators, wait for the state's own signal of having settled, not for a value other tests can change.**

146. **Offline, the places editor turned Save off: the place's category read as unknown.**
    - Seen: `S-A38-BAD-OFFLINE` at `admin-l1440-dark`, then at `admin-l1440-en` with Save already on before going offline, on the NUC: "Reconnecting…", the place's row "Unknown category", "Cannot save: the value refers to an item that does not exist", and the click on Save waited out the test.
    - Found by: the split `all` on a loaded machine; a categories listener answered from the cache offline with no category (Firestore's memory cache keeps nothing for a listener attached again), and the draft's check took that list as the city's.
    - Fix and pin: the draft checks the category only against a list the server answered (`#context` in `packages/admin/src/pois/pois.ts`; `badPath_offlineAnEmptyCachedListOfCategoriesDoesNotTurnSaveOff` in `packages/admin/test/pois/pois.test.ts`); the spec also waits for Save to be on before `setOffline(true)` (`e2e/admin/specs/editing/drafts.spec.ts`).
    - **A list answered from the cache is not the truth about what exists: never refuse an edit on it.**

147. **"Configurare" broke over two lines on a 320 px navigation bar.**
    - Seen: the failure screenshots of the tour matrix at `tour-c320-*`: "Configurar" and "e" (lesson 83 fixed 360 px).
    - Found by: a person looking at the screenshots; the label test measured 360 px only.
    - Fix and pin: the bar's labels follow their item's width below about 70 px (`font-size: min(label-medium, 17cqi)`, `packages/ui/src/admin/shell/hcm-admin-nav.ts`); `packages/ui/test/admin/shell/nav-and-menu.test.ts` measures 360 and 320 px.
    - **Measure a label at the narrowest window the tour visits.**

148. **A spec changed the address while its category's save was still settling.**
    - Seen: `S-A39-BAD-LOW-CONTRAST-COLOUR` at `tour-x2560-light-ro` on the NUC: "Discard your changes?" stood over the next category's Delete for the rest of the test.
    - Found by: the second split `all`; the spec waited for the saved colour in the emulator, which the write reaches before the editor hears back, and the snackbar it also waited for was the first save's.
    - Fix and pin: the spec waits for the editor's own "Saved" status before it goes to another address (`e2e/tour/admin-settings.tour.ts`).
    - **A document in the database is not the page having saved it: wait for what the page says.**

149. **Other tests' cities pushed this city's own History rows off the page during the Tab round.**
    - Seen: `admin.history.recent` at `tour-x3840-dark-ro-admin` on the NUC: "Tab never reaches "Orașul w-… Creat de server …"": the test's own city's creation entry was among the targets, then gone from the list before the Tab round reached it, and "Show more" was offered.
    - Found by: the split `all`'s tour matrix; the recent-changes query read the newest 50 entries of every city's `history` and the page left the others' out (CR-M2c-14), so the shared emulators' other tests, writing entries at the same instants, decided which of this city's entries made the page, and changed it while the checkers ran.
    - Fix and pin: every history entry names its city (`cityId`, written by the history triggers and `history.revert`; `historyEntryDocSchema`), the query asks `cityId ==` the city first (`recentQuery`, `packages/admin/src/history/entries.ts`) with collection-group indexes that start with it (`firebase/firestore.indexes.json`, `firebase/rules-tests/test/indexes.test.ts`), and the rules test checks that only the city's entries answer (`firebase/rules-tests/test/history.test.ts`); the tour writes a newer deletion of another city and asserts it is never listed and that the city's few entries offer no "Show more" (`S-A23-BAD-OTHER-CITY`), and waits for the city's own creation entry before its checkers. Lesson 145's tolerance went.
    - **Filter a shared collection on the server by what the page owns; a page that drops other owners' rows still lets them decide its limit.**

150. **Every GeoTIFF upload was refused, whatever was in it.**
    - Seen: in the e2e admin tier (2026-10-23), each Upload ended as a failed `geotiff-import` job with `apiError.invalidRequest`, no version, and the file deleted.
    - Found by: the S-A14 specs of e2e-fakes; the functions tests built the object's metadata from what the upload dialog writes, while Storage (the emulator as production) adds the SDK's own `firebaseStorageDownloadTokens`, which the strict `rasterUploadMetadataSchema` refused (CR-M3-32).
    - Fix and pin: `imagery.onRasterUpload` validates only the dialog's three keys (`uploadMetadataOf`, `functions/src/imagery/on-raster-upload.ts`), with a functions test that carries the token; `S-A14-HAPPY`, `S-A14-BAD-NOT-GEOREFERENCED`, `S-A14-BAD-LARGE-RESUMABLE`.
    - **Validate what you own out of a map that others also write: a strict schema over a shared document refuses their keys, and the fakes that build it from your own writer never show it.**

151. **Leaving the georeferencer threw an uncaught error and reported a crash.**
    - Seen: Save in the georeferencer (or any navigation away) logged `Cannot read properties of undefined (reading 'removeEventListener')`, which the crash reporter then posted.
    - Found by: the e2e console guard (CR-M3-34); the factory's unit tests destroyed a handle whose fake map had nothing to remove, and every M2c editor that draws had left its tools before its page went.
    - Fix and pin: the admin map's handle detaches its drawing tools synchronously, while the map still has its canvas, then removes the map; tools still loading are detached when they arrive (`packages/admin/src/map/factory.ts`, `packages/admin/test/map/factory.test.ts`); `S-A16-HAPPY`, `S-A12-BAD-AUTOGCP-FAILS`.
    - **Tear down in the reverse order of setting up, and synchronously: a promise's `then` runs after the thing it needs is gone.**

152. **An import the policy approved, but this month's Mapbox budget stopped, offered no way out.**
    - Seen: the version said "Does not fit this month's Mapbox budget: choose how to go on" and showed no choice.
    - Found by: e2e-fakes' over-budget spec (CR-M3-33): the version page drew the approval card for `awaiting_approval` only, and a version the policy approved is `approved` with the guard's verdict `over`; the unit tests had only reached the card through a manual Approve.
    - Fix and pin: the page shows the card for an approved version whose guard stopped it (`awaitsDecision`, `packages/ui/src/admin/imagery/version-detail.ts`); `S-A42-BAD-OVER-BUDGET`, `S-A14-BAD-REPLACE-OVER-GUARD`.
    - **A state that says "choose" must draw its choices however it was reached: test every way into a waiting state, the automatic one too.**

153. **A refused upload's message read "problems found: {count}".**
    - Seen: the version page of an upload with a bad year.
    - Found by: the e2e placeholder guard (CR-M3-35 f); the trigger recorded the code `apiError.invalidRequest` without the parameter its text names.
    - Fix and pin: the trigger records a refusal's parameters on the job (`{ count }`, the schema's issues, or 1 for a missing year); `functions/test/imagery/upload.test.ts`.
    - **An error code whose text has a placeholder is incomplete without its parameters: store them where the code is written.**

154. **The georeferencer's radios and checkboxes could not be seen in high contrast, and its table scrolled sideways.**
    - Seen: at every admin project the native 20 px inputs' borders reached 1:1, a selected row's checkbox and Delete 2:1 in light high contrast, the targets were 20 px on phones and tablets, and the pairs' table scrolled sideways below 840 px.
    - Found by: the generic checkers at the georeferencer's states (CR-M3-35 i); the unit tests ran axe, which does not measure non-text contrast or targets.
    - Fix and pin: the inputs are drawn like the kit's (a 2 px border, a 48 px `::after` target, `class="touch-target"`); a selected row hands its own on-container colours to its controls; the table fits its box: the origin goes under the pair's name, and a container query drops the pixel and place columns under 560 px (`packages/ui/src/admin/georef/`); `S-A16-*`.
    - **In a selected row every control takes the row's on-container colours (high-contrast containers are dark), and a data table must fit the narrowest box it is shown in.**

155. **Importing a free scene took two clicks where the contract promised one.**
    - Seen: open the scene, then Import; the list's cards had no Import (`docs/research/M3-interfaces.md` §10.2).
    - Found by: the e2e input budget (CR-M3-35 d), which e2e-fakes had set to the screen's two clicks rather than the contract's one.
    - Fix and pin: each free scene's card has its own Import, named after the scene; `importScene` is one input again (`S-A12-HAPPY`, `S-A12-HAPPY-AUTO-PUBLISHED`).
    - **When a screen and its input budget disagree, fix the screen; a budget raised to match a screen measures nothing.**

156. **A 40 px button's touch target was 44 px wherever the page put something right under it.**
    - Seen: the detail pane's Close and Back to list on the Imagery area (its map starts the pane), each target year's Remove in Settings, the filter chips' wrapped rows.
    - Found by: the generic checkers' target sizes on compact and medium windows (CR-M3-35 e, j); the M2c areas had padding under their Back row by chance.
    - Fix and pin: `hcm-list-detail` keeps 4 px under its Back row, each target year's row is 48 px, the filters' rows are 16 px apart (lesson 83's chips).
    - **A 40 px control's 48 px target needs 4 px clear on every side from whatever a page puts next to it: make the container keep it, not each page.**

157. **The layer editor's map attribution read as one block of text.**
    - Seen: an imagery layer's attribution ("USGS EarthExplorer", then © Mapbox © OpenStreetMap) left Mapbox's links distinguishable by colour only (axe `link-in-text-block`, serious).
    - Found by: the generic checkers at the layer editor with an imagery layer (CR-M3-35 l); the M2c layers had no attribution of their own.
    - Fix and pin: the admin map underlines the attribution's links (`packages/ui/src/admin/map/hcm-admin-map.ts`); `S-A16-HAPPY-CROP`.
    - **Links that run into text need a cue besides colour, inside a third-party control too.**

158. **A layer could be deleted while its new image was being made.**
    - Seen: `layers.delete` looked for busy jobs by `params.layerId`, which M2's jobs carry and M3's raster jobs do not (they name the layer at the top level).
    - Found by: fn-imagery's review (CR-M3-24).
    - Fix and pin: the check asks both fields and refuses a layer with a `pendingVersion` (`functions/src/layers/delete.ts`, `functions/test/layers/delete.test.ts`).
    - **When a new kind of record names its subject in a new place, every query that guards that subject must learn the new place.**

159. **The admin's tab title stayed Romanian while its screens followed an English browser.**
    - Seen: on the deployed admin (2026-10-23), "Administrarea hărții" in the tab of an English page.
    - Found by: a person; the tour checks `lang` through axe but never the title, which the static page sets once.
    - Fix and pin: the shell sets `document.title` (the app's name in the admin's language) with `<html lang>` (`packages/ui/src/admin/shell/hcm-admin-shell.ts`); `S-A21-HAPPY-DOCUMENT-TITLE`, `S-A21-BAD-UNSUPPORTED-LANGUAGE`.
    - **What a language switch changes includes what the browser shows outside the page: the title and the `lang` attribute.**

160. **The stitch matched the wrong place, and a later step read a stale step record.**
    - Seen: on the synthetic frames, a 256 px template over a 300 px segment overlap matched off by a strip; `extract` read the `steps.fetch` of the job it was started with.
    - Found by: the pipeline's integration tests on the synthetic scenes with a known transform (CR-M3-20).
    - Fix and pin: the template is narrower than the overlap, and every step re-reads the job before it starts (`pipeline/src/hcm_pipeline/steps/`); `S-P01-HAPPY`, `S-P01-BAD-SIGTERM-RESUME`.
    - **A resumable step reads the state it resumes from at its own start, never from the run that launched it.**

161. **A city's imagery settings passed the rules' expression limit only at their largest.**
    - Seen: a city write with 20 target years, checked element by element inside the city validator, was refused while every smaller one passed.
    - Found by: `firebase/rules-tests/test/limits.test.ts` at the limits (CR-M3-25): the 1000-expression budget counts each use of a function argument again.
    - Fix and pin: the `imagery` settings are written alone, in a write that changes nothing else but the stamp (CR-M3-23), and validated there; the Settings section saves on its own.
    - **Test a security rule at its largest legal document: expression budgets fail only at the edge.**

162. **The e2e world's own runs leaked between tests.**
    - Seen: a run held and then cancelled stayed in the held set (the next Release counted two); a stand-in run without its version left its job `starting`, using one of the server's two running slots (`RUNNING_JOBS_MAX` counts every city); a content world's USGS wait set in the past let another spec's `imagery.tick` start runs in it.
    - Found by: e2e-fakes while building the imagery world (CR-M3-36).
    - Fix and pin: cancelled runs leave the held set, a run without its version fails its job as the pipeline does, seeded waits end in 2100 (`e2e/admin/support/imagery-runner.ts`, `imagery-run.ts`); `S-A00-*-IMAGERY-*`.
    - **A fake that counts shared capacity must release it on every way a run ends, as the real thing does.**

163. **A map scrolled to its last few pixels was said to hide its Mapbox logo.**
    - Seen: `admin.imagery.version-usgs-wait + text spacing` at the three large admin projects: "0 visible Mapbox logos instead of exactly one". The Tab round had left the version's pane scrolled to its end, with 1 to 10 px of the Imagery map's foot showing: Mapbox's attribution sits on the foot, its logo 10 px above it.
    - Found by: the generic checkers (CR-M3-35 k). Lesson 144's rule owed both controls as soon as the strip passed the band under the *lowest* one, which on the admin map (the attribution on the foot) is any strip at all.
    - Fix and pin: the probe asks about each control on its own (`legal.owes` in `e2e/support/layout-probe.ts`): a strip owes the controls it reaches, and two of a kind are still one too many; `e2e/test/layout-probe.test.ts`, `layout-rules.test.ts`; `S-A12-BAD-USGS-MAINTENANCE`.
    - **A rule about what must be visible owes each thing only where it could be seen: measure the reach per element, not per group.**

164. **The real pipeline's first run under the admin tier reached the real USGS delivery host.**
    - Seen: the first `S-P01-HAPPY-ADMIN` run (2026-10-24) logged in to the fake M2M but then fetched the signed address the fake had issued, `https://dds.cr.usgs.gov/e2e/download/…`, from inside the quality container, and the real host answered 404. (One GET of a made-up path with a fake signature: no credential, no data.)
    - Found by: the admin tier's real-pipeline spec; the pipeline's own tests serve their deliveries on loopback, and the e2e fakes signed theirs on the real host, which only the browser's firewall and the Functions emulator's forward had kept away from the internet so far. A Python process has neither.
    - Fix and pin: the fake signs its addresses on a configurable origin, the e2e mock APIs' loopback forward (`delivery.origin`, `e2e/mock-apis/main.ts`); and the pipeline is sealed under the emulators: every service root must be on loopback (`config_problems`) and every address from data must be this machine's by name, never resolved (`check_emulated_url`, the delivery client's hook, the STAC assets); `pipeline/tests/unit/test_urlguard.py`, `test_config.py`, `test_run_command.py`, `test_steps_edges.py`.
    - **A test process outside the browser has no firewall: seal it in its own code (loopback only under the emulators), and make every fake hand out addresses on the machine.**

165. **The real pipeline's documents and the shared fakes disagreed where only a real run meets them.**
    - Seen: under the admin tier the pipeline logged in as `e2e-user` with the token `e2e-ok`, which the shared USGS fake does not know (its users are `e2e-ok` with `e2e-usgs-app-token-ok`); then a version waiting for points carried `error.params.pairs` as a number, which the admin refused to read (`invalid-document`: error parameters are texts); then a published job kept its `tiles` step `running`.
    - Found by: `S-P01-HAPPY-ADMIN`; each side's tests used its own fakes (the pipeline's loopback M2M accepted `e2e-ok`; the golden version waiting for points has no error), and fn-imagery's publish test asserted the job's status, not its steps.
    - Fix and pin: `EmulatorSecrets` answers the shared fakes' user and token of the scenario; the pipeline writes `{ pairs: "<n>" }`; finalize marks a running `tiles` step done (`functions/test/imagery/publish.test.ts`).
    - **Run each side against the other's fakes once before calling a contract kept: golden documents prove the shapes you thought of, not the ones a real run writes.**

166. **The tick's monthly harvest searched USGS for every city that had never been harvested, every five minutes.**
    - Seen: `S-A12-BAD-USGS-MAINTENANCE` timed out on `imagery.tick` (the e2e helper's 60 s) late in the quality run of 2026-10-24: the emulators held 79 cities by then (the content worlds, kept by the reset), and the tick harvested each, three datasets and the browse copies apiece. In production the same rule would search every 5 minutes for a city whose area holds no frame, since "never harvested" is read off the newest scene.
    - Found by: the split quality run; the unit test `happyPath_aCityNeverHarvestedIsHarvested` had written the rule down as intended.
    - Fix and pin: the tick repeats only a harvest older than `HARVEST_EVERY_DAYS`; a city never harvested waits for its first visit (CR-M3-44, `tick.test.ts`); the e2e tick waits `FUNCTIONS_TIMEOUT_MS`.
    - **A periodic job keyed on "the newest record is old or missing" runs forever when the answer is legitimately empty: key it on something the job itself writes, or leave the empty case to the user's visit.**

167. **The content worlds' seeded running jobs filled the project's two pipeline places.**
    - Seen: at `admin-c360-ro` on the NUC every import after `S-A18-BAD-STREAM-DROP` and the jobs tour stayed "Waiting for other jobs to finish" (cancel, retry, maintenance, the georeferencer's degenerate pairs, crop, replace, the guard), each failing after two minutes; on this machine the same specs passed, the content specs having run in another order.
    - Found by: the split quality run; the dispatcher counted every city's `starting` and `running` jobs, and those specs seed a `running` job without a lease in a content world the reset keeps.
    - Fix and pin: the cap counts the jobs holding an execution, `starting` or `running` with its lease held; a lapsed lease is a lost run the tick recovers (CR-M3-45, `dispatch.test.ts` `happyPath_aRunWhoseLeaseLapsedHoldsNoCapacity`).
    - **Every project-wide counter is shared state between test worlds that never reset: count what really holds the resource (a live lease), so a world's seeded display state cannot take another's place.**

168. **A navigation label that is a prefix of another's matched both.**
    - Seen: `S-A35-BAD-DISCARD` failed at every project in 2 s: `getByRole('link', { name: 'Istoric' })` matched "Imagini istorice" too, once M3 added the Imagery entry; the crop's notice text matched the snackbar and its live region.
    - Found by: the quality run after the integration of the imagery area.
    - Fix and pin: `exact: true` on the History link; the notice asserted on `hcm-snackbar`.
    - **Name a navigation link with `exact: true`, and a notice by its component: a new entry or an announcer copy turns a substring match into two.**

169. **Retired content worlds still counted against the project's Mapbox tileset limit.**
    - Seen: run on this machine alone (2026-10-24), `S-A16-HAPPY-CROP`, `S-A14-HAPPY-REPLACE-SOURCE`, `S-A16-HAPPY-REGEOREF-LAYER` and `S-A42-BAD-OVER-BUDGET` at `admin-c360-ro` stopped at Approved with "Mapbox already holds 24 tilesets": the guard counts every city's layers carrying `mapbox.tilesetId`, and 72 of them were in the cities of content worlds whose tests had ended (the settings world seeds a published layer).
    - Found by: the quality stage without the NUC: one emulator held twice the worlds of a split run.
    - Fix and pin: a content world retires its city's document at teardown with its `admins` document (`ContentWorld.retire`), so every walk over `cities` (the tileset limit, the running cap, the tick) sees only the worlds still running; what lies below stays for the reports.
    - **A test world that outlives its test is still part of every aggregate the product computes: end it when the test ends, not when the run does.**

170. **The stand-in runner's own bookkeeping lagged behind what the page showed.**
    - Seen: `S-A16-HAPPY-REGEOREF-LAYER` at `admin-l1440-en-imagery` (the M3 screenshot run on the NUC): `imagery.release()` answered 0, the re-georeference run still dispatching while the spec had already checked the layer's pending version; `S-A12-BAD-RETRY` at `admin-l1440-dark` (the split run): `imagery.runs()` still listed the second run `running`, the page already showing Awaiting approval from the run's last write.
    - Found by: the screenshot run, whose resizing slowed the page side, and the split quality run.
    - Fix and pin: the specs poll `release()` until it lets one run go (`layer-geometry.spec.ts`, `published.spec.ts`) and poll `runs()` until both runs ended (`import.spec.ts`).
    - **A fake's record of its own work is one more eventually consistent view: poll it like the page, never read it once after the page moved.**

171. **A publish could reach Mapbox twice while the compute-unit guard counted it once.**
    - Seen: `imagery.publish`'s start task never asked whether its publish had already reached Mapbox: a job `mts_processing` with its version `publishing` passed the guard as "go on", so a redelivered start task, or the tick's recovery of an upload slower than 20 minutes, uploaded the COG again (replacing the source an MTS job was reading) and published again. The unit test `happyPath_aRetriedStartGoesOnFromWhereItIs` expected exactly that.
    - Found by: the M3 security and cost review (2026-10-24), reading the code against the contract (§7.3: "a retry with a matching source goes straight to finalize"); every test that made a second start had asserted the second publish.
    - Fix and pin: a start with an MTS job recorded polls it; the upload is skipped when this publish uploaded the same file (`steps.upload.sha256`); the publish call is marked (`steps.publish: running`) in a transaction before it, and a retry that finds the mark without a job id lists the tileset's jobs (`MapboxTilesets.listJobs`) and follows the one Mapbox started; the tick names its recovery after the job's last write (`stale-<ms>`), so a job that stays stale is queued once (CR-M3-47; `S-A42-BAD-DUPLICATE-PUBLISH`, `publish.test.ts`, `tick.test.ts`).
    - **Before a paid call, write down in a transaction that you are about to make it; after a retry, look for what the call left before calling again. "Already reserved" is not "not sent yet".**
172. **A publish that never got its Mapbox job looped for good, and nothing could stop it.**
    - Seen: a Mapbox timeout or a missing COG is retried by Cloud Tasks, and a failed attempt wrote nothing on the job, so its stamp stayed old and every tick queued another start (`retry-<now>`, five deliveries each): 12 an hour, each streaming the COG again, while Cancel on `mts_processing` only logged a line, Reject refused it, the budget guard did not reach the publisher and the reservation stayed held all month. `imagery.retry` after a publish failure was unlimited too (the publisher never counted).
    - Found by: the M3 security and cost review; no test made a start fail more than once.
    - Fix and pin: every start counts `publishAttempts` in a transaction and the job fails `apiError.imagery.attemptsExhausted` past `PUBLISH_MAX_ATTEMPTS` (6), freeing its reservation; `imagery.retry` refuses a publish out of attempts; a red budget guard holds the publish before anything reaches Mapbox and the tick queues it again once green; Cancel ends a publish that has not asked Mapbox yet (`S-A42-BAD-PUBLISH-ATTEMPTS`, `S-A12-BAD-CANCEL-BEFORE-MAPBOX`, `S-A12-BAD-GUARD-PAUSED`).
    - **Every retry loop needs a counter written on each attempt, and every recovery a task id that stays the same while nothing changed: an attempt that writes nothing looks new to every recovery, forever.**
173. **A layer's deletion job could destroy a newer version that took the deleted layer's id.**
    - Seen: `reserveLayerId` left out existing layers and unfinished versions but not queued `layer-delete` jobs, so during the 7-day grace an import of another frame of the same pass (same label, same id), a re-import of the scene or a re-upload of the same file name got the deleted layer's id; when the deletion fell due it deleted the deterministic tileset, its source and the whole `rasters/{city}/{layer}/` prefix, the newer version's scan and COG included.
    - Found by: the M3 security and cost review; the layer-delete tests never had a version of the same id.
    - Fix and pin: a queued deletion's layer id stays taken; a due deletion waits while an unfinished version holds the id, and deletes only the files of the versions made before the deletion (`S-A33-BAD-ID-REUSED`, `layer-delete.test.ts`, `import.test.ts`).
    - **A deferred clean-up keyed by a name keeps the name reserved until it runs, and checks again when it runs that nothing new answers to that name.**
174. **The tileset cap could be passed by two first publishes at once, and missed deleted layers' tilesets.**
    - Seen: the guard counted only layers with `mapbox.tilesetId`, read outside its transaction; a first version's layer is created at finalize, so publishes under way and the tilesets of deleted layers still in their grace were invisible, and two first publishes on the 1st of the month (every deferred publish at once) each saw 23 and both passed.
    - Found by: the M3 security and cost review.
    - Fix and pin: the count adds the queued deletions that name a tileset and the versions `publishing` for a layer without one, and, read in the guard's own transaction on the month's counter, the reservations marked `newTileset` (`S-A42-BAD-RACING-TILESETS`).
    - **A cap counts what will exist as well as what exists (work in flight, things waiting to be deleted), and reads the part that can race in the same transaction as the decision.**
175. **The monthly harvest still ran every five minutes for a city whose harvest wrote nothing.**
    - Seen: CR-M3-44 had stopped the tick for cities never harvested, but for a city harvested once, "due" was still read off the newest scene's `harvestedAt`: when every dataset failed (M2M access withdrawn, maintenance), every record was refused or the area moved, nothing got a new `harvestedAt` and each tick logged in and searched three datasets again, 288 times a day; revoked credentials meant a refused login every five minutes. The page said "USGS found no scene over the city's area" when no dataset had answered.
    - Found by: the M3 security and cost review and the minimum-input review, both from the code.
    - Fix and pin: every attempt is recorded in `ops/harvest-{city}` (outcome, failures, `nextAt`): a month after a harvest that answered, an hour after a failure, doubled after each further one; a search no dataset answered fails `apiError.usgs.unavailable` (or `maintenance`) with Try again; a refused login marks the USGS card, which stops the tick (`S-A11-BAD-HARVEST-BACKOFF`, `S-A11-BAD-USGS-UNAVAILABLE`).
    - **Key a periodic job on a record the job writes on every attempt, success or failure, and back off after a failure; lesson 166 fixed the case that never ran, not the one that ran and wrote nothing.**
176. **The two-runs cap could be passed by dispatchers racing for the last place.**
    - Seen: `busyExecutions` ran a query before the transaction that moves a job to `starting`, so up to five trigger instances and the tick could each see one place free and each start a Cloud Run execution (possibly on 8 vCPU machines).
    - Found by: the M3 security and cost review; the fake document store runs transactions as they come, so no unit test could see the race.
    - Fix and pin: the transaction reads and writes `ops/dispatch`, one slot per job holding an execution, each slot's job read again (a slot of a run that ended, or of a city that is gone, is dropped); the test queues the transactions as Firestore does (`S-A12-BAD-RACING-DISPATCH`, `dispatch.test.ts` `serialiseTransactions`).
    - **A count read outside the transaction that acts on it is advice, not a guard: keep a document both read and written in that transaction, and make a test fake serialise transactions where the real database would.**
177. **Cancel, Reject, re-georeference and Replace acted on what they had read before their transaction.**
    - Seen: a Reject or Cancel that read `awaiting_approval` could commit after the guard moved the job to `mts_processing`, releasing the reservation and marking the version rejected while Mapbox published it; `replaceBase` could cancel a base the guard had just taken, and two Replace uploads could both pass the busy check. Re-georeferencing a first import awaiting approval cancelled its job, and the dispatcher's release then freed its scene while the new version kept the layer id (Find offered Import again).
    - Found by: the two M3 reviews; `save-gcps.test.ts` never ran the trigger after the save.
    - Fix and pin: `endWork` takes the job and version it accepts (`accept`), checked in its transaction; the re-georeference reads the base and the layer again in its transaction; the upload reads the layer before writing its pending version; the release spares a scene whose layer id another unfinished version holds (`S-A12-BAD-CANCEL-BEFORE-MAPBOX`, `S-A14-BAD-REPLACE-RACE`, `S-A16-BAD-REGEOREF-KEEPS-SCENE`, which runs the trigger).
    - **Check every precondition again inside the transaction that acts on it, and run the triggers a write sets off in the test of that write.**
178. **"I uploaded it" found the layer's own MTS tileset and published its old tiles.**
    - Seen: `imagery.studioDone` matched a tileset by the layer's name or id, which is exactly what the layer's MTS tileset is called: a Replace, a re-georeference or a crop over budget that chose Studio was "published" with no upload at all, and the earlier version superseded.
    - Found by: the M3 security and cost review.
    - Fix and pin: the layer's current tileset is never the upload, and neither is one Mapbox says it created before the choice (`S-A42-BAD-STUDIO-NOT-UPLOADED`; the HTTP fake now reports when it created a tileset).
    - **When finding "the thing the user just made", leave out what existed before the request and what is already in use.**
179. **A budget pause had no way out, and the publish failures only offered Try again.**
    - Seen: once the 5 USD alert turned `ops/guard` red, Import, Retry, Save points and Crop were refused for good ("Processing is paused…") with no screen to turn it back on; a source too large for Mapbox, a revoked token or a missing scope failed the version with Retry forever (each retry streaming the COG again), the scope message showed a literal `{scopes}`, an upload the server refused offered a Retry that started a run for a deleted file, and a failed version stayed in "Waiting for you" for good.
    - Found by: the minimum-input review (2026-10-24), counting what an admin can do from each screen.
    - Fix and pin: `imagery.resumeGuard` and the Imagery and Jobs banner with the spend and Resume processing (behaviour A43, `S-A43-*`); a file too large goes back with the free Studio way (`S-A42-BAD-SOURCE-TOO-LARGE`); `jobRetryable` and `imagery.retry` agree on what a retry cannot cure, with Setup's Mapbox step, Upload another file or Dismiss instead (`S-A12-BAD-NOT-RETRYABLE`, `S-A12-BAD-FAILED-DISMISSED`).
    - **Every error the product shows names its way out, and a state an admin cannot leave from the screen is a defect, not an edge case.**
180. **The georeferencer by keyboard could not place a second pair.**
    - Seen: a pair added with Add at the centres became the selected one, the arrow keys then moved it instead of panning, and no key let it go (Esc only dropped a half pair, the table's pair button only selected): a keyboard user could not reach the next place. `S-A16-HAPPY-KEYBOARD` placed one pair. On a phone, Add at the centres with the Map pane showing read the hidden scan pane's zero size and made a pair at NaN.
    - Found by: the minimum-input review.
    - Fix and pin: a keyboard pair is not selected, Esc lets the selected pair go, the pair button toggles, a hidden scan pane keeps its last view and half a pair opens the other pane; the spec now places two pairs, chooses, moves, lets go and deletes by keyboard (`S-A16-HAPPY-KEYBOARD`).
    - **A keyboard path is proved only when it does the task twice in a row: the first pair works with any selection rule.**
181. **The georeferencer's pairs table scrolled sideways on a phone once six pairs were a kilometre off.**
    - Seen: at 320 px, and at 360 px and 768 px under a reader's text spacing, the residual table of six pairs in Romanian reached 12 to 68 px past its box in the unit test's measure (the e2e checker's `sideways-scroll` on `georef.pairs` at `admin-c360-ro` and `admin-m768-ro`). Every cell was kept on one line, and the narrow table's 4 px cell padding (CR-M3-35 i) sat in a container query written before the cells' own rule of the same specificity, so it never applied: only the hidden pixel and place columns had kept the phone's table in its box, with four pairs of small residuals.
    - Found by: the e2e tier at `admin-c360-ro` and `admin-m768-ro`, once `S-A16-HAPPY-KEYBOARD` placed two pairs by keyboard (CR-M3-47); the unit tests never measured the table, and the e2e had only ever drawn it with residuals of a few metres.
    - Fix and pin: the container query follows the cells' rule, and a cell wraps when the table would not fit otherwise (a place over two lines after its comma, "Perechea" over its number, "m" under a long residual) (`packages/ui/test/admin/georef/residual-fit.test.ts`, which measures the table at 320 px, and at 360 px and 672 px with the checker's text-spacing sheet; `S-A16-HAPPY-KEYBOARD`).
    - **A responsive rule placed before a base rule of the same specificity is dead code that looks applied: put overrides after what they override, and test a layout with the longest data it can hold, not the fixture's.**
182. **A layer's credit in the admin map's attribution read white on white in the dark scheme.**
    - Seen: Mapbox draws its attribution on a half-white box in every scheme and colours only its links (`mapbox-gl.css`); an imagery layer's credit is plain text, so it inherited the admin's text colour, light in the dark scheme (axe color-contrast on `.mapboxgl-ctrl-attrib-inner` in `admin.layers.crop-refused`, `crop-drawn` and `pending-version` at `admin-l1440-dark-imagery`).
    - Found by: the `tour-matrix` stage's first full run with the M3 imagery projects (CR-M3-47's `all`); the publishes that draw a credited layer run per push only at `admin-c360-ro` and `admin-l1440-ro`, both light (DECISIONS-for-review.md §49k), and the editors' own dark states draw layers without a credit.
    - Fix and pin: the admin map gives `.mapboxgl-ctrl-attrib-inner` the links' colour (`packages/ui/test/admin/map/attribution-colour.test.ts`; `S-A16-HAPPY-CROP`, `S-A14-HAPPY-REPLACE-SOURCE` at `admin-l1440-dark-imagery`).
    - **A third-party control that colours only part of its content leaves the rest to inherit the page's scheme: pin the whole control's colours, and when a tier moves to a nightly matrix, check which scheme still runs per push.**
183. **A footprints poll failed the Imagery filters test in under a second while the admin map was still opening.**
    - Seen: `S-A11-HAPPY-FILTERS` at `admin-m768-ro` failed at 0.8 s with Mapbox's "Style is not done loading": the e2e helper that reads a GeoJSON source of the admin map called `getStyle()`, which throws until the style has loaded, and `expect.poll` does not ask again after its callback throws.
    - Found by: the second full `all` of 2026-10-24 on the NUC (CR-M3-47); every earlier run had reached the poll after the style loaded.
    - Fix and pin: `sourceFeaturesInPage` (`e2e/admin/support/map.ts`) reads no features while the style is loading, so the poll reads "not yet" and asks again (`S-A11-HAPPY-FILTERS`, and every photo cone, marker and overlay probe that shares it).
    - **A probe that a poll calls answers "not yet" while the page is still getting there; one that throws turns a wait into a race.**
184. **A notification pushed while its admin opened it came back unread.**
    - Seen: the fan-out wrote the inbox item, pushed it, then wrote the item again as delivered with `pushedAt`; an admin who opened it while FCM was answering had their `read: true` replaced by the delivered copy.
    - Found by: writing the inbox's e2e (`S-A46-HAPPY`), which opens an item seconds after it arrives.
    - Fix and pin: the fan-out records `pushedAt` on the item as it is now, in a transaction, and leaves a pruned item alone (`functions/test/notify/fan-out.test.ts`, `badPath_anItemOpenedOrPrunedWhilePushingStaysAsTheAdminLeftIt`).
    - **A server write that adds a field to a document a person also writes must read it first: writing back the copy it started with undoes what they did meanwhile.**
185. **`getToken` was deprecated in the installed Firebase SDK, and with it the token the contract named.**
    - Seen: `firebase@13`'s messaging marks `getToken` deprecated in favour of `register` and `onRegistered` (the Firebase installation ID); ESLint's `no-deprecated` refused the registrar, and no suppression is allowed.
    - Found by: the lint gate on the first build of the push registrar.
    - Fix and pin: the admin registers the installation ID and the functions send to it as `message.fid`, as firebase-admin 14.5's `FidMessage` does; the fake FCM refuses a message without a `fid` (`packages/admin/test/firebase/messaging.test.ts`, `functions/test/adapters/fcm.test.ts`; DECISIONS-for-review.md §54c, CR-M4-24).
    - **Read the installed SDK's own types before following a contract written from older docs: a deprecation on the client usually changes what the server must send too.**
186. **A photo seeded without a title never opened in its editor.**
    - Seen: the first title-suggestion spec seeded a photo whose Romanian title was empty, to get suggestions on its own; the editor said "Could not read (invalid-document)", since a stored photo always has a title.
    - Found by: the first admin-tier run of `S-A09-HAPPY-TITLE-SUGGESTION`.
    - Fix and pin: the spec seeds the title a file name gives and clears it in the editor, as an admin does before choosing a suggestion (`e2e/admin/specs/assists/title.spec.ts`).
    - **Seed only what the product itself can store; a state the product reaches only while editing is reached by editing.**
187. **A history entry of the previous test appeared below a photo of the next one.**
    - Seen: two specs used the same photo id; the history trigger of the first test's Save ran after the admin tier's reset, so "nothing written" found an entry the refused test never made.
    - Found by: `S-A09-BAD-AI-UNAVAILABLE` at `admin-l1440-ro`.
    - Fix and pin: each test of `e2e/admin/specs/assists/drafts.spec.ts` has its own photo id, and "nothing written" is the document as seeded and the 503 the page logged.
    - **The emulators' triggers outlive the test that caused them: a locked test's reset does not stop a trigger already queued, so give each test ids of its own.**
188. **Headless Chromium refuses notifications before anyone asks, and reads a hidden count with a space before its comma.**
    - Seen: the inbox showed "The browser refused notifications" in every e2e test that did not grant them, and the Notifications item's name was `Notificări , 1 necitite` (a positioned, visually hidden span is a block, so Chromium joins it with a space).
    - Found by: the first admin-tier run of `S-A46-HAPPY`.
    - Fix and pin: the push specs grant the permission (Playwright) or deny it (`Browser.setPermission` with the page's `browserContextId`), and the badge's name is matched with an optional space (`e2e/admin/specs/notify/`).
    - **A browser's defaults and its accessible-name joins are part of what a spec observes: set the permission a test depends on, and match names the way the browser computes them.**
189. **OpenStreetMap's licence link under the title suggestions was a 24 px target on a tablet.**
    - Seen: at `admin-m768-ro` the generic checker's scroll sweep found `osm.org/copyright` 112 × 24 px, under M3's 48 × 48 on a medium window; the unit test had only asked for WCAG's 24 px.
    - Found by: `S-A09-HAPPY-TITLE-SUGGESTION`'s state `assist.suggestions` at the admin tier's five projects; the same spec at `admin-c360-ro` also showed that a place 1.3 km from the photo is off a phone's map at the editor's zoom.
    - Fix and pin: the link is 48 px tall (`packages/ui/src/admin/assist/assist-parts.ts`), and the title specs start their photo 500 m from the place they click (`e2e/admin/specs/assists/world.ts`).
    - **A link inside running text is still a touch target: size it for the smallest window the checker runs, and pick the points a spec clicks so they are on the smallest map.**
190. **M3's daily cap of raster jobs never counted a job outside the unit tests.**
    - Seen: `rasterJobsToday` asks for jobs with `createdAt >= <start of day>`; the Firestore adapter passed the `TimestampLike` operand to the Admin SDK as a plain `{seconds, nanoseconds}` map, and Firestore compares a range only within one type, so the emulator found 0 of 1 matching jobs. The unit tests used the in-memory fake, which compares timestamps.
    - Found by: the orders workstream's throwaway emulator probe while it built the daily order watch (CR-M4-11); every tier was green because no emulator test filtered on a timestamp.
    - Fix and pin: `buildQuery` converts every operand as it converts a stored value (`toFirestoreValue`); `functions/test/adapters/documents.test.ts` `happyPath_aTimestampOperandMatchesStoredTimestampsInARangeAndInAList` runs on the emulator.
    - **A fake that is more forgiving than the real store hides a whole class of query bugs: every adapter's filter needs one test against the emulator with each operand type it accepts.**
191. **The monthly USGS harvest erased every order an admin had marked.**
    - Seen: the harvest rebuilt each scene from a fixed list of fields to keep (status, note, layer id, creation); M4's `order` and `eeDatasetId` were not on it, so the next harvest dropped them.
    - Found by: the orders workstream's functions tests of a harvest after a mark (M4, CR-M4-12).
    - Fix and pin: `functions/src/imagery/harvest.ts` keeps the order and the dataset id (`functions/test/imagery/orders-edits.test.ts`).
    - **A rewrite that copies a keep-list of fields silently drops every field added later: merge into the stored document, or test the list against the schema's fields.**
192. **The engine's third-party notices lost `lit` once swipe compare shipped.**
    - Seen: the `notices` gate failed with "lit@3.3.3: bundled but not in THIRD_PARTY_NOTICES.txt": Vite's library build starts one build per format, the notices plugin cleared its list at each `buildStart`, and the file written last held only the ES build's packages, while the IIFE (which inlines the compare chunk) carried `lit/index.js`.
    - Found by: the `build` stage after the compare workstream's chunk (CR-M4-19).
    - Fix and pin: the plugin gathers across the formats of one `vite build` and never clears (`scripts/site/src/notices.ts`, `scripts/site/test/notices.test.ts`); `[notices] OK` lists 13 engine packages.
    - **A build plugin that keeps state must know how many builds one command runs: Vite's library mode calls `buildStart` once per format.**
193. **Swipe compare's lazy chunk made the engine load a 44.6 KB chunk at once.**
    - Seen: with Vite's library default (`preserveEntrySignatures: 'strict'`), what `compare-<hash>.js` shared with the entry moved into a third chunk, `map-sync-<hash>.js`, which `engine.mjs` imported on every page.
    - Found by: the compare workstream reading the build's output before the budget gate (DECISIONS-for-review.md §55c).
    - Fix and pin: `preserveEntrySignatures: 'allow-extension'` in `packages/engine/vite.config.ts`; `ENGINE_CHUNK_BUDGETS` fails any engine chunk without a budget.
    - **A lazy chunk is only lazy if the entry stays whole: read the build's chunk list whenever a dynamic import is added.**
194. **The automatic georeferencing's OpenStreetMap channel matched the ground, not the roads.**
    - Seen: Canny's edges of the synthetic scan followed the ground's texture as much as the roads; the OSM channel was 155 m off at the median.
    - Found by: the autogcp workstream's pipeline tests on the synthetic world drawn through an exact affine map (`pipeline/tests/integration/test_autogcp.py`, P03).
    - Fix and pin: the scan side is the white and black top-hat of the CLAHE'd pre-warped scan (lines up to 150 m wide) against OSM's proximity field: 13 m off (CR-M4-18).
    - **Pick a matcher's features for what the reference draws: a line map is matched with line features, never with every edge of the image.**
195. **The buy flow pushed the Imagery area's chunk over its budget by 0.2 KB.**
    - Seen: the `build` stage's `bundle-budget` failed on `imagery` (18.2 KB of 18) once the order card, Work's orders and the chips joined M3's screens.
    - Found by: the build stage of the M4 integrator.
    - Fix and pin: the order card, which only a scene to buy or with an order shows, is a chunk of its own fetched on first need (`packages/ui/src/admin/imagery/orders/lazy-card.ts`, `order-card` 2 KB; `imagery` 17.6 KB), with Loading, a failed fetch's Try again and the page's re-render pinned by `packages/ui/test/admin/imagery/lazy-card.test.ts` (DECISIONS-for-review.md §56b).
    - **When a feature spends a chunk's headroom, split off what only some visits need instead of raising the budget.**
196. **A journey spec that seeded the scenes never saw the ranking it waited for.**
    - Seen: the cross-app automation spec seeded the harvested scenes and then imported through `importFromList`, whose `awaitHarvest` waits for the page's own ranked search; seeded scenes are ranked otherwise, and the poll timed out.
    - Found by: the first run of `S-A48-HAPPY` at `admin-l1440-ro`.
    - Fix and pin: the happy journey lets the page harvest and seeds only the bought scene's preview afterwards; the bad path, which never imports from the list, seeds the scenes (`e2e/admin/specs/imagery/automation.spec.ts`).
    - **A helper that waits for a server flow needs that flow: seed what a spec skips, never what its helpers wait for.**
197. **A spec that opened the paid Corona frame failed at teardown on a 503.**
    - Seen: the fake browse host never serves `DS1105-1071DF076` (it is `S-A11-BAD-BROWSE-UNAVAILABLE`'s scene), so a spec opening that scene logged the 503 console error the fixtures fail on.
    - Found by: the orders workstream's first `orders.spec.ts` runs.
    - Fix and pin: every spec that opens that scene seeds its preview in our bucket first (`ImageryWorld.seedBrowse`; orders and automation specs, the local stack's seed).
    - **A fake's bad-path fixture is shared state: a new spec that reuses its id inherits its failure.**
198. **Swipe compare's chooser ran past the map's edge at 320 px.**
    - Seen: a native `<select>` keeps the width of its widest option unless it may shrink; with the tour's text spacing at 320 px the compare bar's chooser ended past the map's edge.
    - Found by: the tour's layout checker on `viewer.compare-menu` (V06).
    - Fix and pin: `min-inline-size: 0` on the chooser (`packages/ui/src/viewer/compare/compare-styles.ts`), the tour state at every viewer viewport.
    - **Native form controls size themselves from their content: give each one in a flexible row a minimum it may shrink to.**
199. **The divider's handle sat on the map's centre, which the occlusion check reads as the map's own.**
    - Seen: the generic checker samples a map canvas at its centre; a handle there made the map look covered in every compare state.
    - Found by: the tour's occlusion check on `viewer.compare-swipe` (CR-M4-16 (b)).
    - Fix and pin: the handle sits below the centre and, on a phone held landscape, ends before the vertical timeline (`packages/ui/src/viewer/compare/hcm-compare.ts`).
    - **No control may sit at a map's centre: that point is the map's, for the checker and for the visitor.**
200. **Focus was lost after Accept in the georeferencer's suggestions.**
    - Seen: accepting or rejecting a suggestion re-rendered the list; without keys Lit reused the rows in place, so the focus stayed on a row that now showed the next suggestion's buttons, or fell to the page.
    - Found by: the autogcp workstream's keyboard test (`S-A44-HAPPY-KEYBOARD`).
    - Fix and pin: the rows are a keyed `repeat` and the next row takes the focus (`packages/ui/src/admin/georef/suggestions-panel.ts`).
    - **A list whose rows leave on a keypress needs keyed rows, or the focus follows the position instead of the item.**
201. **The title-suggestion spec counted a Nominatim request it never made.**
    - Seen: in the split `quality` run `S-A09-HAPPY-TITLE-SUGGESTION` found two server requests to Nominatim where it expected one: its own cell and the city's centre, asked by a content spec drawing a place at the map's centre beside it (a point drawn asks for titles by itself, and every city's request lands in the server's one world).
    - Found by: the M4 integrator's split `quality` run, at `admin-c360-ro` and `admin-l1440-ro`; the assists specs had passed alone, with no content spec running beside them.
    - Fix and pin: the spec counts the requests of its own cell, and during the cool-down it checks that no request of anyone's reached Nominatim (`e2e/admin/specs/assists/title.spec.ts`).
    - **A locked spec owns the project's singletons, not the server's fakes: count only what names the test's own data, or what nobody can add while it runs.**
202. **The Setup steps' self-test spec still counted nine checks after M4 added the tenth.**
    - Seen: `S-A03-BAD-SELFTEST-FAILURE` found 10 `[data-check]` rows where it expected 9: assists-notify had added the `ai` check (Vertex AI's free `countTokens`) to `SELF_TEST_CHECKS`, and its own runs never included the `admin-steps-l1440-en` project.
    - Found by: the M4 integrator's split `quality` run, on the NUC's part of the admin tier.
    - Fix and pin: the spec counts `SELF_TEST_CHECKS.length` (`e2e/admin/steps/status.spec.ts`).
    - **Count a list from the constant that defines it; and a change to a shared list runs every project whose specs read it, the Setup steps' included.**
203. **A translation draft asked for one photo filled the next photo's title.**
    - Seen: English draft on photo A, then photo B opened before Vertex AI answered (up to 20 s): A's translation and the model's note landed in B's draft, and B's Save would have published it. The place and layer editors had the same gap.
    - Found by: both M4 reviews (2026-10-24); the unit tests reset only the title suggestions mid-flight, and every e2e draft waited for its answer on the same item.
    - Fix and pin: the assist session counts the open item and drops a draft answered for another (`badPath_aDraftAnsweredAfterAnotherItemOpenedIsDropped`, `badPath_aDraftThatArrivesAfterAnotherPhotoOpenedLandsNowhere`).
    - **An answer that lands in "whatever is open now" must carry what it was asked for: guard every await that writes into shared editor state, not only the first one written.**
204. **Every notification read up to 250 items of every admin's inbox.**
    - Seen: `notify.onEvent` pruned each inbox by reading its newest 250 items to delete those past 200: once inboxes were full, about 200 reads per admin per event, a quarter of Firestore's free reads at three admins and twenty events a day, while the contract promised "a few documents".
    - Found by: the M4 security and cost review; the fan-out test seeded a full inbox once and checked only what was left.
    - Fix and pin: `DocumentStore.count` (an aggregation) first, then only the oldest items over the limit are read (`happyPath_anInboxUnderItsLimitIsCountedAndNeverRead`, and the read query asserted in the full-inbox test).
    - **A cost claim in a contract is a test: assert the reads a handler makes, not only the documents it leaves.**
205. **A browser kept showing an admin's notifications after sign-out, after removal, and for the next admin.**
    - Seen: sign-out cleared only session keys; the push device id in `localStorage` named no admin, so another admin saw push on for someone else's registration, and their Off unregistered nothing; `admins.revoke` left the removed admin's devices, inbox and settings, so a re-invited account got its old browsers back; an Off that failed offline still said off.
    - Found by: both M4 reviews; every push test signed in one admin on one browser.
    - Fix and pin: the record is `{uid, deviceId}` (`push-device.ts`), sign-out unregisters and forgets it, `notify.registerDevice` takes the browser from every other admin, revoke deletes the three collections, a failed Off keeps push on and says why (`S-A47-BAD-SHARED-BROWSER`; `push-device.test.ts`, `inbox.test.ts`, `controller.test.ts`).
    - **Anything a browser remembers for an account names that account, and leaving the account (sign-out, removal) undoes what it registered elsewhere.**
206. **A model's draft could add a link the public viewer would render.**
    - Seen: a description's draft keeps Markdown links (the prompt asks the model to), and nothing compared them with the source's: text pasted into the source could ask for `[More](https://…)` and a 5,000-character draft saved without a careful read would publish it.
    - Found by: the M4 security review; the markup tests covered HTML and control characters, which the viewer never renders anyway, not the one markup it does.
    - Fix and pin: `draftKeepsLinks` refuses a draft with a link address the source lacks (`apiError.assist.linksChanged`; `S-A45-BAD-LINKS-CHANGED`, the fake Vertex AI's `injected` outcome).
    - **Sanitise model output against what the renderer turns into behaviour (links here), and check it against the input, not only for shape.**
207. **Title suggestions had no daily limit, and a lost task left the editor waiting for ever.**
    - Seen: any cell in the city's reach was queued on a cache miss, so a scripted session walking 11 m cells kept Nominatim at one request a second indefinitely (the bulk use its policy forbids); a cell claimed whose task was never queued answered `queued` and the editor's "Looking for titles…" never ended.
    - Found by: both M4 reviews; the queue tests covered the cache, the cool-down and the rate, never volume or a refused enqueue.
    - Fix and pin: `GEOCODE_DAILY_CAP` counted in `ops/assist` within the claim's transaction, a refused enqueue deletes its cell, and the editor stops listening after `GEOCODE_QUEUED_MINUTES` (`S-A45-BAD-DAILY-CAP`; `badPath_aQueuedCellNoAnswerReachesEndsTheWaitSoSuggestATitleWorksAgain`).
    - **A free third-party service's policy is a cap the code enforces, and every wait on a background job has an end the user sees.**
208. **Swipe compare paid a new map load each time the window crossed 600 px.**
    - Seen: a phone turned between portrait and landscape, or a window dragged across 600 px, destroyed the second map and created a new billed one at each crossing; the chooser also offered the main side's own layer.
    - Found by: the M4 cost review; the counter tests checked that no map leaked, not how many loads a session paid.
    - Fix and pin: a compact window hides the second map for `COMPARE_PARK_MS` and a wider one reuses it (`badPath_aCompactWindowHidesTheSecondMapAWiderOneReusesItAndAMinuteDestroysIt`, `S-V06-BAD-COMPACT-WIDTH`); `compareChoices` leaves out the main side's layers.
    - **For a billed resource, test the count of creations across a session's ordinary motions, not only that each creation is destroyed.**
209. **An uploaded photo never got its title suggestions by itself.**
    - Seen: suggestions came by themselves only for an empty Romanian title, but every upload starts titled after its file (`IMG 0412`), so a real upload always needed Suggest a title first; the e2e met the one-input budget only because it cleared the title, an input it did not count.
    - Found by: the M4 minimum-input review; the spec seeded its photo instead of uploading one.
    - Fix and pin: a title nobody chose (empty, a camera's naming, the file's title) asks by itself (`photoUntitled`); the spec starts from a real upload (`S-A09-HAPPY-TITLE-SUGGESTION`).
    - **Measure an input budget from the state a real user reaches (an upload, not a seed), and count every step the test takes to get there.**
210. **The orders' screens counted what the admin could not clear and promised checks that could not run.**
    - Seen: Work counted an expired order (no Take the mark back on its card) and a sent reminder (nothing to click to say "I paid"); before USGS approved downloads the card said "checked daily" while the watch skipped it; the refusal of a frame scanned meanwhile vanished with its card; the card's times were UTC, the inbox's local.
    - Found by: the M4 minimum-input review; the UI tests asserted each state alone, never which action leaves it.
    - Fix and pin: Take the mark back on the expired card, reminders out of the count, the approval note and its Setup link, the refusal outside the card, local times (`S-A13-BAD-SCANNED-WHILE-MARKING`, `S-A13-BAD-WAITS-FOR-APPROVAL`, `S-A13-BAD-NEVER-DELIVERED`).
    - **Every "needs you" count needs an action on screen that clears it, and every promise a card makes ("checked daily") needs the condition that keeps it.**
211. **The automatic georeference was measured in its middle only.**
    - Seen: the tests asserted the median distance from the truth (3.7, 2.8 and 9.9 m) while the largest, at a corner outside the matched pairs where `poly2` extrapolates, was 14.1, 11.7 and 23.4 m; enough confident pairs in a line were reported as "too few".
    - Found by: the M4 minimum-input review, recording the largest error the helper already computed and discarded.
    - Fix and pin: the tests assert the largest distance too (`EDGE_ERROR_M`); a degenerate fit waits with `apiError.imagery.noSpread` (`S-P03-BAD-NO-SPREAD`); the approval-policy guard is proposed (`DECISIONS-for-review.md` §57d).
    - **A tolerance claimed for a map is for its whole extent: assert the worst point, and keep the reason a fit failed apart from its count.**
212. **The suggestions' distances were stale, and Accept all dropped the keyboard.**
    - Seen: each suggestion showed the matcher's stored residual as "from the current fit", which never changed as pairs were accepted (and read "No fit" on a version waiting for points even with a live fit); after Accept all the focused button vanished with the list and the focus fell to the page.
    - Found by: the M4 minimum-input review; the panel tests passed fixed residuals, and the keyboard spec decided rows one by one.
    - Fix and pin: `offsetM` from `distanceFromFit` on every refit, and Accept all focuses the panel's heading (`S-A44-HAPPY`; `happyPath_eachSuggestionsDistanceIsFromThePagesCurrentFitAndFollowsIt`).
    - **A number labelled "current" is computed from the page's state, never read from a stored snapshot; and every action that removes its own control moves the focus somewhere named.**
213. **A translation draft could replace what the admin had typed.**
    - Seen: English draft was offered whenever the Romanian side had text, so with both filled it replaced the admin's English, and only Discard (which drops every other edit too) brought it back.
    - Found by: the M4 minimum-input review.
    - Fix and pin: a draft is offered only for an empty side, its note stays once it filled it (`draftTarget`, `badPath_textTheAdminTypedInBothLanguagesIsNeverOfferedADraft`, `S-A09-HAPPY-TRANSLATE-DRAFT`).
    - **An assist fills what is empty; replacing the user's own text needs their explicit say.**
214. **Small gaps in the notifications: points needed reached no device, "imported" said too much, and "1 devices".**
    - Seen: `layer.needsPoints` was not pushed by default, so a bought scan whose automatic points failed reached only the inbox; "The scan of X is imported" also went out for a version waiting for points; the test notification said "1 devices" and the Romanian badge "1 necitite".
    - Found by: the M4 minimum-input review.
    - Fix and pin: `layer.needsPoints` pushed by default, `order.imported` worded for a version published or waiting, `pluralOf` in `@hcm/shared` with one, few and other forms, the Romanian badge "necitite: 3" (`notifications.test.ts`, `inbox.test.ts`, `nav-badge.test.ts`).
    - **A text with a count has its plural forms in both languages from the start, and a default that hides a stalled automation is a bug, not a preference.**
215. **The functions' account could run any Vertex AI job to make a translation draft.**
    - Seen: Provision granted `fn-admin@` `roles/aiplatform.user`, which also allows billable custom jobs and endpoint deploys, while the drafts and the self-test only call `generateContent` and `countTokens`.
    - Found by: the M4 security review; the role table's test checked that the role was there, not what else it allowed.
    - Fix and pin: Provision's `iam` item makes the custom role `hcmVertexDrafts` (`aiplatform.endpoints.predict`) before binding it (`the custom role of the translation drafts (M4)` in `packages/admin/test/provision/items.test.ts`).
    - **Grant the permission a call needs, not the predefined role that contains it: a cost guard on one call is no guard on the others the role opens.**
216. **In the dark scheme the focus ring of Confirm the place could not be seen, and a refused I ordered it dropped the keyboard.**
    - Seen: the title-suggestion spec, rewritten to start from a real upload (lesson 209), reached the photo editor's "check the place" banner for the first time in a tour state: at `admin-l1440-dark` the Tab round's contrast check found the ring of **Confirmă locul** (the kit's secondary) under 3:1 against the banner's tertiary container. On the scene page, the order card of a frame scanned while it was being marked disappeared with the button just clicked and the focus fell to the page's body; the refusal then shown inline above Import made the page just tall enough that, scrolled to its end at `admin-m768-ro`, the map's attribution was a 6 px sliver under the app bar (a 14 px link 11 px from the account button).
    - Found by: the 2026-10-24 review fixes' split `all` run (`admin-l1440-dark`, `admin-m768-ro`, both in `tour-matrix`); every earlier state seeded its photos (no banner) and every per-push project passed.
    - Fix and pin: the photo editor's `.banner` sets `--hcm-focus-ring-color` to its container's own colour, as the alerts on the error container do; a refused mark moves the keyboard to the scene's heading (`ImageryContext.focusDetail`; `badPath_aRefusedMarkLeavesTheKeyboardOnTheScenesHeading`), and the frame scanned meanwhile says why in the snackbar, the reviewer's other option, so the page keeps its free-scene layout (`S-A13-BAD-SCANNED-WHILE-MARKING`).
    - **Every coloured container that holds a control sets the ring's colour for itself; and a state reached the way a user reaches it (a real upload, a real refusal) finds what seeded states hide.**
217. **The jobs tour's running and waiting jobs were run under it by another test's tick.**
    - Seen: `tour/admin-jobs.tour.ts` at `tour-c360-light-ro` and `tour-x1920-light-ro` lost its seeded running import mid-test: the progress bar vanished, then the Cancel dialog's button kept re-rendering until the test timed out; the job read "failed: the layer version does not exist (e2e stand-in)". A later run at `tour-x1920-dark-en` found its job "waiting for its date" done: the date, 2026-10-24 09:00, had passed on the wall clock the server uses.
    - Found by: the 2026-10-24 review fixes' split `all` run on the NUC, whose admin and tour projects ran beside the imagery specs; the same test passed at every other viewport.
    - Fix and pin: `imagery.tick` (which the orders and automation specs run, over every city) took the seeded job, which had no lease, for a lost execution, ran it again, and the stand-in runner failed it for its missing version; and it dispatched the waiting job once its date came. `seedJob` gives a seeded running job a lease held far ahead (`e2e/admin/support/ops.ts`), as a live pipeline's heartbeat would, and the waiting job's date is in 2100.
    - **A seeded record must be complete enough for every background process that may meet it (a lease, a heartbeat), not only for the page the test looks at; shared emulators run other tests' schedulers, on the wall clock, so a "later" date is far later.**
218. **The revoke-while-editing spec hung: removing the admin's inbox told its page before its Save.**
    - Seen: `S-A20-BAD-REVOKED-WHILE-EDITING` at `admin-c360-ro` timed out clicking Save: the page was already read-only under the "access removed" banner, so Save stayed disabled. `admins.revoke` (since the 2026-10-24 review, lesson 205) deleted the removed admin's inbox after their `admins/{uid}`; the unread badge listens to that inbox, so when the inbox held an item (another test's event fanned out to every admin), the deletion reached the open page as a denied listener before the Save the spec makes.
    - Found by: the review fixes' third split `all` run; two earlier runs passed, their admin's inbox empty at the time.
    - Fix and pin: the notifications go first, while the account is still an admin's (`functions/src/admin/revoke.ts`): the open page sees its inbox emptied, and the removed admin's next write is refused by the rules as the scenario says.
    - **A cleanup that writes under a revoked account reaches its open listeners: order it so they see what they are still allowed to see, and test the scenario with the shared world's background traffic, not only an idle one.**
219. **The built engine could not be committed as it was: two of its lines end in a space and a tab, and its stylesheet has no final newline.**
    - Seen: M5's release folder `cdn/engine/` (the engine build jsDelivr serves from a tag) failed `editorconfig` on a scratch copy: `engine.css` without a final newline, and line 58 of `engine.iife.js` and 114 of `engine.mjs` with trailing whitespace. The whitespace is lit-html's `[ \t\n\f\r]`, which the minifier writes as a template literal whose `\n` became a real line break; it belongs to the string. A first order of `release.json`'s files by `localeCompare` would also have put `THIRD_PARTY_NOTICES.txt` where the machine's locale says.
    - Found by: the release workstream's measurement of every static gate on a scratch copy of the folder before anything was committed (`docs/research/M5-interfaces.md` §2.3); no gate reads build output, which `dist/` keeps out of the tree.
    - Fix and pin: the release transform ends every text file with a newline and lists files in code-point order (`releasedBytes` and `releasedFiles` in `scripts/release/test/cdn.test.ts`); the trailing whitespace stays as it is, and the one-line EditorConfig exception for `cdn/engine/*.{js,mjs}` waits for the user (`docs/research/DECISIONS-for-review.md` §59c).
    - **Committed build output is data: measure every gate on it before the commit that adds it, never "fix" whitespace inside minified code, and keep locale out of anything compared byte for byte.**
220. **The admin's theme watched the city twice, then forever.**
    - Seen: in M5's multi-city shell, a synchronous store (the unit tests' fake, and the emulator's cached snapshot) answered inside `CityTheme`'s `watch` call; the answer found no watch started yet and started a second one, whose answer did the same.
    - Found by: the multi-city workstream's unit tests of the mount (`packages/admin/test/app/mount.test.ts`); every earlier store answered on a later turn.
    - Fix and pin: the watch is marked started before it is called (CR-M5-24 (1)).
    - **Mark a subscription as started before you subscribe: a source may answer inside the call.**
221. **A role dialog the user saw was "hidden" to the test.**
    - Seen: `hcm-dialog`'s host element has no box while its native `<dialog>` is open in the top layer, so `toBeVisible()` on the host failed with the dialog on screen (Admins → the role question).
    - Found by: `S-A51-HAPPY-ROLE` at the admin projects.
    - Fix and pin: the spec asserts the dialog through its role (`getByRole('dialog')`), as a user's assistive technology finds it.
    - **Assert a modal by its role, never by its custom element's host: the top layer has no layout box under the host.**
222. **"Discard" for another city's address asked a second time, and brought the old city back.**
    - Seen: an unsaved edit, then the city menu's other city, then Discard: the navigation guard restored the old address before the page load, and `beforeunload` asked again.
    - Found by: `S-A49-BAD-UNSAVED`.
    - Fix and pin: once the admin discards, the app stops counting the discarded edit while the other city opens (CR-M5-24 (3)).
    - **A guard that asked and was answered must stand down for the navigation it allowed.**
223. **The New city drag spanned a hundredth of the area the spec expected.**
    - Seen: a 240 px drag at zoom 13 was computed with 256 px tiles; Mapbox's zoom levels are 512 px tiles, so N px at zoom z span N·360/(512·2^z) degrees.
    - Found by: `S-A50-HAPPY`, whose rectangle came out too small for `CITY_SPAN_LIMITS`.
    - Fix and pin: the spec's comment and its sizes use 512 px tiles (CR-M5-24 (4)).
    - **Mapbox GL's zoom is in 512 px tiles: convert pixels to degrees with 512, not the 256 of raster tile schemes.**
224. **An overlay for the New city rectangle hid the map from the checkers and broke the admin's CSP.**
    - Seen: a transparent layer over the map to catch the drag made the map's zoom buttons "occluded" and its focus "obscured" for the layout checker; positioning it with an inline `style` was refused by the admin's Content Security Policy.
    - Found by: `S-A50-HAPPY`'s `expectStateSound` and the console guard.
    - Fix and pin: the gesture listens on the element Mapbox draws into, in the capture phase; nothing covers the map (CR-M5-24 (5)).
    - **Draw on a map through its own element's events, never through a layer on top of it.**
225. **The bundled city's owner could not invite anyone before Setup wrote the city.**
    - Seen: `admin.session` listed a member's cities from their documents, and the bundled city has none until Setup's `setup.createCity`, so its owner had no city to invite into.
    - Found by: `S-A02-HAPPY-INVITE-AND-CANCEL` after the memberships landed.
    - Fix and pin: the session lists a member's city by its id while it has no document (CR-M5-22 (2), CR-M5-24 (6)).
    - **A membership is the source of truth for access; a document's existence is not.**
226. **The city menu's buttons lost their 48 px targets.**
    - Seen: 40 px buttons in a scrolling list, packed edge to edge, failed the target-size check at the list's ends and between rows (`cities.switcher-menu`).
    - Found by: the tour's target-size checker at the admin projects.
    - Fix and pin: 8 px between them and 4 px inside the list's edges (CR-M5-24 (7)).
    - **A 40 px control keeps a 48 px target only with 8 px around it, including inside a scroller's padding.**
227. **A page opened from the disk could not be reached by the e2e at all.**
    - Seen: `S-V28-BAD-FILE-URL` (an export opened by double-click) was blocked by the e2e firewall, which refuses every address that is not a mocked host, `file://` included.
    - Found by: the export workstream's first run of the spec.
    - Fix and pin: the spec answers `file://` itself from the unpacked folder (`page.route(/^file:\/\//, …)`); Chromium's own refusal of a `file://` fetch, the point of the test, still happens before any route.
    - **A firewall in the test harness covers every scheme: a spec that needs one opens it explicitly, and says why.**
228. **The tour inventory could not take another section.**
    - Seen: `e2e/tour/states.ts` reached the 600-line limit of a test file, so any section's spread failed `max-lines`.
    - Found by: ESLint on the export workstream's first state.
    - Fix and pin: the M4 and M5 sections moved with their markers into `e2e/tour/admin-sections.ts` (CR-M5-15).
    - **An inventory that every workstream appends to is split by section before it fills, not by the one who hits the limit.**
229. **A click on a Material button reached nothing.**
    - Seen: `hcm-button` renders its inner `<button>` on its first update, after the element is in the page; the export card's spec clicked before it existed.
    - Found by: the export workstream's admin spec at `admin-c360-ro`.
    - Fix and pin: the spec waits for the button by its role before clicking (`e2e/admin/specs/export/export.spec.ts`).
    - **Wait for a custom element's control by its role: its host exists before its shadow content.**
230. **A locked test's reset deleted a content world's export while it downloaded.**
    - Seen: `S-A53-HAPPY` downloaded "No such object." when a locked spec reset the emulators during its build: the reset reads `exports/<city>/<id>.zip`'s second segment as the city only for the prefixes it knows, and `exports` was not one, so it read the zip's name as the city and deleted the object.
    - Found by: a whole admin-tier run at `admin-l1440-ro` (the multi-city workstream, 2026-10-25); alone the spec passed.
    - Fix and pin: `exports` joins `CITY_FIRST` in `e2e/admin/support/emulators.ts` (CR-M5-25).
    - **Every new storage prefix joins the reset's table in the change that adds it (lesson 116 again).**
231. **A city made in the admin could never become public.**
    - Seen: New city made the city unpublished and its done screen said "publish it from Settings when it is ready", but no screen wrote `cities/{city}.published`: the city could get no public manifest, so no public site and no export (`apiError.export.noManifest`). Each workstream's own specs seeded `published: true` and passed.
    - Found by: the M5 integrator's cross-app journey, the first test to take a city from New city to its public site.
    - Fix and pin: Settings → Publishing (one switch and Save; `S-A54-HAPPY`, `S-A54-BAD-UNPUBLISHED`; `docs/research/DECISIONS-for-review.md` §63a).
    - **A flow is done when a test walks it from its first screen to what the visitor sees, with nothing seeded in between.**
232. **A version bump would have downloaded every npm package, the browsers and the emulators again.**
    - Seen: the quality image's npm layer depended on the lockfile's and the manifests' bytes, so the CLI's workspace link and the release's version bump (versions only) re-ran `npm ci` from the registry, the Playwright browser install and the Firebase emulator download.
    - Found by: the kit-cli workstream, which left the lockfile unchanged for that reason (§61d), so a fresh `npm ci` stopped with `Missing: create-historic-city@0.0.0 from lock file`.
    - Fix and pin: the image's `manifests` stage writes the workspaces' versions as 0.0.0 and drops a workspace without registry dependencies; checked by building that stage alone and comparing its output byte for byte with the baked one (§63b).
    - **A cache layer should depend on what it caches: normalise the inputs that cannot change its output, and prove the cache hit before the build that would miss it.**
233. **A photo seeded for a new city vanished from its manifest.**
    - Seen: the journey's photo of Turda was skipped by the manifest build with `validation.outsideCity`: the seeding helper's default location is Bucharest's.
    - Found by: `S-A54-HAPPY`'s first run, whose manifest record named the skipped photo.
    - Fix and pin: the spec places the photo inside the rectangle it gave New city (`IN_TURDA`).
    - **A seeded world for a second city must put its content inside that city: defaults belong to the first one.**
234. **A count of one read as a plural, and a limit an owner sets can be one.**
    - Seen: the export card said "1 fotografii, 0 straturi" and "1 photos"; the daily limits of imagery jobs and exports, which M5 lets the project's owner set per city down to 1, said "deja 1 exporturi" and "1 exports … were already made"; the city's compute-unit message put `{estimate}` before its noun the same way.
    - Found by: the M5 integrator's visual audit of the review screenshots (`reports/screenshots/m5/`), which the checkers pass: the text is contrasted, in place and in the right language.
    - Fix and pin: each message puts the number after a label or in brackets ("fotografii: 1, straturi: 0", "au atins limita zilnică (1)"), in both languages; `packages/ui/test/admin/export/export-card.test.ts` asserts the Romanian and English summaries. The same review made Export tonal beside a ready export's Download, the card's one filled button.
    - **Lesson 124 again: a count before a noun needs plural forms, and "it is always more than one" stops holding once a person can set the number.**
235. **An offline build said nothing about the cache.**
    - Seen: to prove the NUC's quality image would build without downloads before a split run, `docker build --network=none` ran the apt layer again from its cache mounts and failed at the CI tools' venv, though the split's own build minutes later found every layer `CACHED`; on this machine, where a normal build was fully cached, the offline build re-ran the apt layer too.
    - Found by: the M5 integrator's check of the NUC before `PIPELINE_STAGE=quality bash scripts/ci/e2e-split.sh` (2026-10-25).
    - Fix and pin: the check is the split's own build log (`[nuc] #… CACHED` for the apt, venv and npm layers, the run stopped if one starts) and the NUC's cache records (`docker buildx du --builder default --verbose`, their last use); `.agent/skills/quality/pipeline_skill.md` → *Local tooling quirks*.
    - **BuildKit keys a `RUN` step on its network mode: a build with another network mode is another build, so it cannot tell whether the real one is cached.**
236. **A route did not drop the connection already open.**
    - Seen: `S-A18-BAD-STREAM-DROP` at `admin-l1440-en` on the NUC: "Reconnecting…" never showed within 60 s; the trace's first aborted listen request came 45 s after the route was installed, because Firestore's WebChannel long poll, opened before the route, stayed open, and a route reaches only the requests that start after it. It passed at the other four admin projects of the same run.
    - Found by: the M5 integrator's split `quality` run (2026-10-25), on the loaded NUC.
    - Fix and pin: the spec also takes the browser offline (`page.context().setOffline(true)`) until the page says it is reconnecting, which fails the open request too, then goes online with the route still cutting the channel, so the line written meanwhile arrives only after `unroute` (`e2e/admin/specs/ops/stream.spec.ts`; 15 of 15 at the five admin projects, 3 to 8 s each, against 9 to 14 s before).
    - **To cut a connection, cut the request already open too: a long poll or a stream outlives a route that starts after it.**
237. **The self-host CLI read the owner's Google tokens to learn whether they were signed in.**
    - Seen: `self-host`'s sign-in step ran `firebase login:list --json`, whose answer in firebase-tools 15.33.0 is every signed-in account with its OAuth refresh and access tokens (`auth.getAllAccounts()` printed by `--json`); the CLI kept them in memory, one log of a parse failure away from printing them, against its own rule of never reading a credential.
    - Found by: the M5 security review (finding 1), reading firebase-tools' `login-list.js` and `command.js`.
    - Fix and pin: the probe is `firebase login:list` as plain text (`Logged in as …`); the fakes answer `--json` with tokens, and the unit and e2e tests assert the CLI never runs it and nothing it captured holds them (`packages/create-historic-city/test/self-host.test.ts`, `S-V29-HAPPY-SELF-HOST`).
    - **Check what a `--json` flag really prints before reading it: a listing of accounts can be a listing of their secrets.**
238. **A guide's `npx create-historic-city@1` would run whatever owned the name that day.**
    - Seen: the READMEs, `docs/SELF_HOST.md` and the CLI's own messages told readers to run `npx create-historic-city@1` (a major line), and the npm publish came after the merge that makes those guides public; the name was not yet ours.
    - Found by: the M5 security review (finding 5).
    - Fix and pin: every guide names the exact release (`@1.0.0`), the CLI prints its own (`NPX_COMMAND`), `release:bump` rewrites `PINNED_DOCS` and `release-check` refuses a tag whose guides name another version (`scripts/release/test/versions.test.ts`, `scripts/ci/tests/test_check_release.py`); the release order now checks and publishes the name before the merge (`docs/research/M5-status.md` §3).
    - **A command a guide prints is code its readers run: pin it exactly, and own the name before the guide is public.**
239. **`self-host` walked an owner onto Blaze toward a setup that could not finish.**
    - Seen: the admin refuses the `project.json` `self-host` writes (no `github`, CR-M5-7), so Setup's Provision never runs; step 8 still opened billing, waited for Blaze and deployed functions whose service accounts only Provision creates, leaving the owner on Blaze without the 5 USD budget the step's own text promised; the scaffold advertised the command after every run.
    - Found by: the M5 UX review (finding 1).
    - Fix and pin: `self-host` and `deploy` refuse without `--experimental` (nothing runs; a dry run needs no flag), say what does not work yet when given it, the scaffold no longer advertises them and the guides say so (`S-V29-BAD-NOT-AVAILABLE`).
    - **A command that cannot finish should refuse at its first step, not after the payment step.**
240. **Every failure of `firebase projects:create` was taken for Google's terms.**
    - Seen: project ids are unique across Google, so a taken id is the usual failure; the CLI said to accept the terms, opened the console, retried the same id and stopped with only an exit status.
    - Found by: the M5 UX review (finding 14).
    - Fix and pin: firebase's own message stays on the owner's terminal, the CLI names another id (`otherProjectId`: `cluj-harta-2`) and opens the console for the terms only after a yes (`S-V29-BAD-PROJECT-TAKEN`).
    - **When a tool's failure has several causes, show its own message and offer the way out of the likeliest one.**
241. **A city editor's basemap address could add directives to the export's Content Security Policy.**
    - Seen: a WHATWG URL allows `;` and `'` in a host, so `new URL('https://a.com;connect-src/x').origin` is `https://a.com;connect-src`; the export page wrote that origin into `connect-src` (escaped as an attribute, but splitting the policy), and the rules' `httpsUrl()` and `isHttpsUrl` accept such a host.
    - Found by: the M5 security review (finding 7), checked in Node.
    - Fix and pin: `isCspOrigin` (CSP's host-source grammar) filters the export's origins and `contentSecurityPolicy` throws on any other; the manifest schema and the rules (`httpsHostUrl()`) refuse such a style; the export's policy names no telemetry host (`S-A53-BAD-STYLE-HOST`).
    - **An origin parsed from a URL is not a CSP source: check it against the grammar it is written into.**
242. **`create-historic-city upgrade` dropped the sources a page had added to its policy.**
    - Seen: `upgrade` refilled the page with the engine alone, so the tile and photo hosts the kit's README tells an owner to add (and an export's own origins) left `img-src` and `connect-src`; after the "easiest" upgrade the historical layers were blocked.
    - Found by: the M5 UX review (finding 4).
    - Fix and pin: `policyExtras(readKitPolicy(page))` carries every origin the page added and its telemetry's presence into the new policy (`packages/create-historic-city/test/upgrade-doctor.test.ts`; `theme` does the same).
    - **A rewrite that owns part of a file must read back what the rest of the file says.**
243. **Two owners could leave a city without one, and no account could repair it.**
    - Seen: the last-owner check counted owners outside any transaction; `admins.setRole` and `admins.revoke` read the target, then wrote the whole document; `revokeAdmin` had no last-owner check; the project's owner could be removed from a city, and nothing but the Firestore console could then reach it.
    - Found by: the M5 security review (finding 3).
    - Fix and pin: `changeCityRole` reads the caller, the target and every owner of the city through one transaction before it writes, and the project's owner stays an owner of every city they belong to (`apiError.city.projectOwnerStays`); the emulator tests run two owners against each other at once (`S-A51-BAD-ROLE-RACE`, `S-A51-BAD-PROJECT-OWNER-STAYS`).
    - **An invariant over several documents needs every one of them read in the transaction that could break it.**
244. **An editor of one city could publish another city's imagery.**
    - Seen: `layers.link` only compared a tileset's owner with the project's Mapbox account, which every city shares; the pipeline names tilesets `<user>.hcm-<city>-<layer>`, and the layer ids follow from public USGS metadata.
    - Found by: the M5 security review (finding 2).
    - Fix and pin: a pipeline tileset is linkable only by a layer of the same city that records it (`apiError.layers.otherCityTileset`, `S-A15-BAD-OTHER-CITY-TILESET`); the remaining limit, every city's public token reading every tileset of the account, is recorded in `docs/ARCHITECTURE.md`.
    - **When cities share an account, "the account owns it" is not "this city owns it".**
245. **A pending invitation from before M5 would grant every city, a later one too.**
    - Seen: an invitation without `cities` joined its account to every current city at its first session, a city made after the invitation included, and `admins.list` and `revokeInvite` could not see it.
    - Found by: the M5 security review (finding 4).
    - Fix and pin: the `memberships` tick step and `cities.create` (before it writes) give such an invitation the cities of now, as an editor of each (`S-A51-HAPPY-LEGACY-INVITE`).
    - **A migration of grants must convert the pending ones too, before anything can widen what they mean.**
246. **Anyone with an export's address could download it all day, on the project's egress.**
    - Seen: `export.download` signed a 15-minute address of a zip up to 2 GB on every call, even while the budget guard was red.
    - Found by: the M5 security review (finding 6).
    - Fix and pin: at most `EXPORT_LIMITS.downloadsPerDay` (10) signings per export a UTC day, counted in a transaction on its record, none while the guard is red, and the count logged (`S-A53-BAD-DOWNLOAD-LIMIT`).
    - **A signed address is a cost the project pays per use: count its signings and stop them when the budget says so.**
247. **The CLI's package could ship an e2e admin, or none.**
    - Seen: no gated stage built `dist/self-host/`, the CLI's own vite build empties `dist/`, and `buildSelfHostBundle` copied `packages/admin/dist`, which the e2e build (`vite --mode e2e`, with the OAuth stand-in) writes too.
    - Found by: the M5 security review (finding 8).
    - Fix and pin: `build:self-host` builds the admin and the functions for production first, the bundle refuses an admin carrying the stand-in's `/__oauth/authorize`, and the `release` stage's `self-host-bundle` gate assembles it between `vite-build` and `release-pack` (`packages/create-historic-city/test/bundle.test.ts`, `scripts/ci/tests/test_pipeline_stages.py`).
    - **A build that publishes must make its inputs itself, or check that they are the right build.**
248. **Every visitor read maintainer instructions while the map loaded.**
    - Seen: the kit's note ("check the version and the integrity in index.html") showed on every load until the engine ran, not only when it failed.
    - Found by: the M5 UX review (finding 16).
    - Fix and pin: the note first says only that the map is loading; the troubleshooting (`.hcm-note-late`) shows after 4 s through the engine's stylesheet, and the e2e finishes the animations from outside instead of waiting (`S-V27-BAD-INTEGRITY`, the tour state `kit.loading-note`).
    - **A fallback message shown on every load is read by everyone: say the neutral part first and the fix only when it is due.**
249. **ARIA set on a custom button's host named nothing.**
    - Seen: the city menu set `aria-haspopup` and `aria-current` on `hcm-button`'s host, but focus goes to its inner button; the tests asserted the host attribute, so a screen reader heard neither the popup nor the current city.
    - Found by: the M5 UX review (finding 10).
    - Fix and pin: `hcm-button` takes `popup`, `current` and `label` as properties for its inner button (as `pressed` already was); the switcher is named "City: …" and the tests read the inner button (`packages/ui/test/components/button.test.ts`, `S-A49-HAPPY`).
    - **Lesson 229 again: test the element that has the focus, never the host around it.**
250. **On a phone the open city was named nowhere.**
    - Seen: compact windows showed only the page's name; the city list sat inside the account menu, so an admin of two cities could edit the wrong one, and that list never refreshed.
    - Found by: the M5 UX review (finding 8), from the 360 px switcher screenshots.
    - Fix and pin: a phone's top bar, a sideways phone's heading and the tab's title end with a middle dot and the open city's name for an admin of two cities or more (`cityTitle`); opening the account menu asks for the cities again.
    - **What a layout drops at a small size must still be said somewhere the person looks.**
251. **A city just made could be missing from the city menu for a minute.**
    - Seen: opening the menu to reach New city refreshed the cities, and a second opening within 60 s was throttled.
    - Found by: the M5 UX review (finding 17).
    - Fix and pin: Create calls `refreshCities(true)`, which skips the minute (`S-A50-HAPPY`).
    - **A throttle must give way to the action that made its data stale.**
252. **New city took three inputs only for a city already on screen.**
    - Seen: the map opened on the current city (or Europe), drawing mode blocked panning, and the budget test dragged over the current city's own view; drawing Cluj from Bucharest took six to ten inputs.
    - Found by: the M5 UX review (finding 3).
    - Fix and pin: `cities.locate` (one Nominatim search under the title suggestions' cool-down) finds the named city once typing rests; its rectangle is drawn, named and the map flies there, never over one the admin drew; the budget is two inputs, measured from Bucharest's view (`S-A50-HAPPY`, `S-A50-HAPPY-DRAWN`, `S-A50-BAD-NOT-FOUND`).
    - **Measure an input budget from where a person really starts, not from where the test happens to be.**
253. **A pinch on the New city map drew a rectangle between two fingers.**
    - Seen: the gesture ignored `pointerId`, so the second finger overwrote the press and lifting the first drew from one finger to the other; `touchstart` was always stopped, so pinch-zoom was dead while drawing.
    - Found by: the M5 UX review (finding 5).
    - Fix and pin: only the primary pointer draws, a second one cancels the drag, two-finger touches reach the map, and a dashed band shows the rectangle under way and the first click's corner (`packages/ui/test/admin/cities/area-gesture.test.ts`).
    - **A pointer gesture must follow one pointer by its id; every other pointer is someone else's gesture.**
254. **Typing the rectangle's edges judged an impossible rectangle at each edge.**
    - Seen: each edge before the fourth made a rectangle with zeros, and an alert told a keyboard user to drag on the map, up to three times; clearing one edge cleared all four.
    - Found by: the M5 UX review (finding 12).
    - Fix and pin: the edges stay a draft until all four are numbers (`area-edges.ts`), clearing one keeps the others, and the keyboard path has its own messages (`S-A50-BAD-EDGES-PARTIAL`).
    - **A form built from several fields should be judged when it is whole.**
255. **The focus fell to the page when New city and Export replaced their buttons.**
    - Seen: Create the city replaced the form and Export removed both buttons while the export ran; each `role="status"` was inserted already filled, which screen readers often skip.
    - Found by: the M5 UX review (finding 11).
    - Fix and pin: one live region per page, there from the start, says what happened; the done screen's heading takes the focus, and Export moves it to the card's heading before its button goes (`S-A50-HAPPY`, `S-A53-HAPPY`).
    - **When an action removes the control that had the focus, decide where the focus goes, and announce from a region that was already there.**
256. **The city budget showed limits that did not apply, and saving one imposed five.**
    - Seen: a city without limits (Bucharest) showed the new-city defaults as its limits, "used X of Y" used them as Y, and saving one field saved all five defaults with it.
    - Found by: the M5 UX review (finding 7).
    - Fix and pin: such a city says the project's caps alone hold it and shows empty fields; a field left empty saves at its maximum (`MAX_CITY_LIMITS`), so the limit typed is the only one set (`S-A52-HAPPY`).
    - **A form for optional limits must not show defaults as if they were in force, nor save them as a side effect.**
257. **An admin of two cities never reached the dashboard from an empty address.**
    - Seen: the full split run's Setup journey at three `tour-matrix` projects reloaded an empty address after Setup was complete and stayed on Setup; the owner administered two cities there (lesson 258), and an empty address was rewritten to `#/setup` as soon as it opened, before Setup's readiness was known, so its answer no longer found an empty address to send to the dashboard.
    - Found by: `bash scripts/ci/e2e-split.sh` (stage `all`), the M5 fixer's first full run.
    - Fix and pin: an empty address stays empty unless the page it opens names a city (a city page of an admin of two cities or more); Setup keeps it empty until readiness decides (`S-A49-HAPPY-FIRST-SCREEN`, `S-A49-BAD-FIRST-SCREEN-INCOMPLETE`).
    - **A rule that waits for an asynchronous answer must not destroy the input it waits on: rewrite the address only once the page it names is final.**
258. **The project's new owner was given every city of the project, other tests' cities included.**
    - Seen: `admin.claim` wrote the owner's `admins/{uid}` without `cities`, the mark of a document from before M5, so the next `admin.session` migrated it with every city that existed; in the e2e, the cities of the content worlds running beside the Setup journey, which then administered two cities (lesson 257).
    - Found by: the same run, from the city menu of the failure's snapshot naming a content world's city.
    - Fix and pin: the claim writes `cities: {}` for a new document and keeps an existing admin's own; `setup.createCity` then makes the owner the bundled city's owner (`functions/test/admin/claim.test.ts`).
    - **A missing field that means "migrate me" must never be written by the new code: write the new shape explicitly, even when it is empty.**
259. **The local stack's export Download, and any link followed in it, would have reached the real Google and USGS.**
    - Seen: the stack's shim forwards a page's requests and what its elements load, and leaves every `<a href>` alone; the export's **Download** is an `<a download>` the page clicks itself, pointed at a signed address on `storage.googleapis.com`, so in a person's browser it would have left the machine (the e2e tiers answer it with a Playwright route, which the stack has not). The manual plan also said the stack's firewall blocks **Comandă în EarthExplorer**; no firewall stands between a person and a link they follow.
    - Found by: the M4/M5 walk of `docs/MANUAL_TEST_PLAN.md`, a headless probe of the export through the stack that printed the download's address.
    - Fix and pin: the shim forwards an anchor with `download` when the page clicks it (`e2e/stack/browser.ts`), never a link a person follows; the stack's check gained "a file the page saves itself stays on the machine" (`e2e/stack/check.ts`); the plan says LOCAL links open the real site, so check their address instead.
    - **A stand-in for a firewall covers what the page does by itself, and the docs say exactly where it stops: test the claim the way a person would use it before writing it down.**
260. **The Cloud Scheduler jobs of `ops.tick` and `imagery.tick` were never made: their account was firebase-tools' shorthand.**
    - Seen: on the real project the 61 functions deployed, but both scheduled functions had no Cloud Scheduler job: the job create answered 400 `INVALID_ARGUMENT`. `runAs` returned `fn-admin@`, which Cloud Functions expands, and firebase-tools 15.33.0 copied it unexpanded into the job's `oidcToken.serviceAccountEmail`.
    - Found by: the user's live manual test of 2026-10-25 (`docs/research/manual-test-2026-10-25.md`, finding 11); no test could see it, as every test only compared the option with what `runAs` returned.
    - Fix and pin: `runAs` and the global default name `<account>@<project>.iam.gserviceaccount.com`, the project read from `GCLOUD_PROJECT` (else `GOOGLE_CLOUD_PROJECT`; neither is a refusal); `functions/test/deploy-shape.test.ts` builds each scheduled function's job with firebase-tools' own `jobFromEndpoint` and pins the full address (`S-A55-HAPPY-SCHEDULER-ACCOUNT`, `S-A55-BAD-NO-PROJECT`).
    - **Test a deploy option where it is used, not where it is made: run the deploy tool's own code over the manifest.**
261. **The legacy import stopped at 0 of 45 photos: the events never reached the server.**
    - Seen: the uploads reached Storage, but `photos.onUpload` never ran: Eventarc delivers an event with the function's own account (`fn-events@`), which had no `roles/run.invoker` ("lacks run.routes.invoke"); Cloud Scheduler's OIDC calls as `fn-admin@` would have met the same refusal. Each stuck photo then waited ten minutes before it was listed.
    - Found by: the live manual test of 2026-10-25 (finding 17); the emulators skip IAM, so no e2e or rules test could see it. The role was granted by hand with the user's yes.
    - Fix and pin: Prepare the project grants `roles/run.invoker` to `fn-events@` and `fn-admin@` (`S-A04-HAPPY-INSTALLER-ACCOUNT`); the self-test's `events` check sends a nonce through `ops/probe` to `ops.onProbe` and back, the real-data probe on the owner's Check again (`S-A03-HAPPY-EVENTS-REACH`, `S-A03-BAD-EVENTS-REFUSED`); the import sends a photo still `pending` after two minutes to `photos.reprocess` once, then lists it as not received with the step that fixes it (`S-A28-HAPPY-STUCK-REPROCESSED`, `S-A28-BAD-STUCK-AGAIN`).
    - **What the emulators skip (IAM, service agents, propagation) needs a check that runs on the real project, and the flow that depends on it must not wait blindly for it.**
262. **Prepare the project failed right after Google said it had switched an API on.**
    - Seen: "Service accounts" failed with `SERVICE_DISABLED` for `iam.googleapis.com` seconds after "Google services enabled" was done: an API that `services:batchEnable` reports on keeps refusing for a few minutes, and its dependants waited for a click on Retry what failed.
    - Found by: the live manual test of 2026-10-25 (finding 4); the fakes enabled an API at once.
    - Fix and pin: the transport waits out a `SERVICE_DISABLED` of an API Service Usage reports on (10, 20, 40, 60 and 60 s on the injected clock), the item saying it waits, then names it `apiError.cloud.apiPropagation`; the fake's scenarios `service-usage.propagation` and `propagationSlow` play the delay (`S-A04-HAPPY-API-PROPAGATION`, `S-A04-BAD-API-STILL-DISABLED`).
    - **A fake that answers at once hides every delay of the real service: give it the delays the real one is known to have.**
263. **The Vertex AI check said only "Something went wrong on the server".**
    - Seen: Translation drafts (Vertex AI) failed on the real project with `apiError.internal`, and the log said `{check, code}` only; Vertex AI's metrics showed no request, so nothing told the cause. From the code: any answer the check did not map (a 404, 400, 401 or 409) became `apiError.internal`, and Google's status and reason were dropped.
    - Found by: the live manual test of 2026-10-25 (finding 20).
    - Fix and pin: `UpstreamError` keeps Google's `error.status` and the first `ErrorInfo` reason (names only, never the message), the self-test logs them with the service, failure and HTTP status, a 404 names the model (`apiError.assist.modelUnavailable`, the drafts button too) and any other refusal Google's reason (`apiError.cloud.refused`) (`S-A45-BAD-MODEL-UNAVAILABLE`, `S-A45-BAD-UPSTREAM-LOGGED`).
    - **A check exists to say why: an unmapped failure must name the upstream's own reason, never fall back to "internal".**
264. **The first functions deploy failed for the event triggers until Eventarc's service agent had its role.**
    - Seen: 14 Eventarc-triggered functions failed with "Permission denied while using the Eventarc Service Agent" on the first deploy and deployed on a second run: the deploy itself created the agent, minutes before the triggers needed its role.
    - Found by: the live manual test of 2026-10-25 (finding 12).
    - Fix and pin: Prepare the project generates the Eventarc and Pub/Sub service identities before its role table (`S-A04-HAPPY-INSTALLER-ACCOUNT`; a refusal is named on the permissions' row, `S-A04-BAD-IDENTITY-REFUSED`), so they have propagated before the server is installed; the in-app installer's build retries the known first-deploy races (`docs/research/M6-interfaces.md` §1.5).
    - **Create what a later step waits for as early as possible, so its propagation is over by the time it is needed.**
265. **Retry what failed on Prepare the project lost to the run it retried.**
    - Seen: in an admin session, Retry what failed provisioned every item, and the card then showed 13 of 16 again, "Service accounts" to do without a reason: the card re-enabled the button before the first run's `setup.recordCloud` had answered, the retry recorded first, and the older record, applied last, replaced the items.
    - Found by: the e2e `S-A04-BAD-API-STILL-DISABLED`, failing about one run in two once the Functions emulator's first `recordCloud` was slow (a cold worker); the unit tests answered the record at once.
    - Fix and pin: the card stays busy until the run is recorded (`packages/admin/test/setup/provision.test.ts`, `badPath_retryWaitsUntilTheRunIsRecorded`; `S-A04-BAD-API-STILL-DISABLED`).
    - **A step is done when what it writes has landed: enable the next click only after the last write of the previous one has answered.**
266. **A click on an install card waited minutes for its next look.**
    - Seen: after Install the server, the card stayed "Waiting for Google Cloud Build" while the fake build had started and stopped: the card's watch had been running before the click, in a back-off of up to four intervals after looks that failed before the project was prepared.
    - Found by: the e2e `S-A55-BAD-BUILD-FAILED` and `S-A55-HAPPY-RETRIED`; the unit tests started each flow fresh.
    - Fix and pin: a click restarts the card's watch (`installWith`, `packages/admin/src/install/install-flow.ts`); the specs also wait for the build the browser submitted before they move it on (a scenario applied before the POST finds no build).
    - **A user's action resets whatever back-off the background polling built up before it.**
267. **Update the map did nothing for a target Setup had recorded behind.**
    - Seen: on a claimed map whose pipeline `setup/status` recorded `updateAvailable`, the pipeline card offered Update the map and the click asked no consent and submitted nothing.
    - Found by: the e2e `S-A56-HAPPY-UPDATE`; the unit test reached the button through a look, never through a record.
    - Fix and pin: Update the map reads which targets are behind from what the cards show, recorded states included (`packages/admin/src/setup/install.ts`; `happyPath_aTargetRecordedBehindIsUpdatedBeforeItsCardLooked`).
    - **An action must decide from the same state its button was rendered from.**
268. **Two records of one card, sent a second apart, landed in the wrong order.**
    - Seen: `setup/status.install` kept `retrying` after the card had shown `failed`: each state change sends `setup.recordCloud` without waiting for the previous one, and the later call answered first.
    - Found by: the tour's settle check in `e2e/admin/specs/install/states.spec.ts` at `admin-m768-ro`.
    - Fix and pin: the server keeps a stored target record checked later than the reported one (`functions/src/setup/record-install.ts`; `badPath_aReportOlderThanTheStoredRecordOfItsTargetIsDropped`).
    - **A record of "the last known state" carries its own time and the writer refuses an older one.**
269. **"Installed: {release}, {date}." stopped matching the spec's pattern after Prettier wrapped the template.**
    - Seen: the paragraph's text gained the template's line break and indentation, so `getByText(/^Installed: .+, .+\.$/)` found nothing although the line was on screen.
    - Found by: the e2e `S-A55-HAPPY`.
    - Fix and pin: the text is computed before the template, which interpolates it alone (`installedLine`, `packages/ui/src/admin/setup/install-status.ts`).
    - **Interpolate a sentence as one value inside its element; a template long enough to wrap adds whitespace the page shows.**
270. **One install test broke the reset of every test after it.**
    - Seen: every test after `S-A57-HAPPY` failed in its fixture with `Firestore reset: 409 ... Transaction lock timeout`; a minute's wait made it pass. The test had written `manifests/bucharest` without its stamp while the publish trigger of the seeded city was still requesting a build: the trigger's transaction read a record its schema refuses, failed, and was retried, holding the document each time.
    - Found by: the e2e `admin/steps/install/site.spec.ts`, run alone (the full run's order had hidden it); bisected by ending the test earlier and earlier.
    - Fix and pin: `seedPublishedMap` (`e2e/admin/support/install.ts`) waits for the seeded city's own build to end, then writes the published record with the publisher's stamp; the install specs also end only when no `setup.recordCloud` of the page is under way (`trackRecords`, `recordsSettled`), and the cards send their records one after another (`packages/admin/src/setup/install.ts`).
    - **Seed a record exactly as its writer leaves it, and only once the writer is done: a half-valid record makes the system's own retries hold it.**

271. **The busy indicator covered the status chip's label, and no checker saw it (finding 6 of 2026-10-25).**
    - Seen: live, while Prepare the project worked, the M3 loading indicator was drawn over its step's chip ("To do") in the list and in the card's header, hiding the text.
    - Found by: the user's manual test; the tour had passed the busy state at every viewport, because the occlusion check samples a text's centre and the overlap check looks at floating chrome only, so an indicator spilling 10 px over a label's edge passed both.
    - Fix and pin: the indicator replaces the chip's icon and label while the step is busy (setup-ux, S-A31-HAPPY-BUSY-CHIP); the tour's new `graphic-overlap` check (`e2e/support/layout-rules.ts`) fails a visible graphic over a text by more than 1 px at every state, with unit tests of both sides. A page helper of the checkers may reference only browser globals and the other helpers: a module constant is undefined in the page.
    - **A checker that samples points proves what it samples: a defect between the points needs a check of its own shape.**

272. **The Setup page's fix links showed the browser's own focus ring, which only the phone's tour project failed.**
    - Seen: the tour state `setup.checks-optional-off` failed its focus-ring contrast at `admin-c360-ro` only (2.16:1): Android's default ring is orange; the desktop's near-black one passes, so the other projects could not see it.
    - Found by: the e2e tour at the compact project (setup-ux, `DECISIONS-for-review.md` §70k).
    - Fix and pin: `hcm-setup-page` takes the kit's `focusRing` in its styles; a unit test pins the ring's style and colour.
    - **An element that renders its own links needs the kit's focus ring in its styles; a browser default differs per platform, so a desktop pass proves nothing.**

273. **Publish the map stayed off after the photos were published, because the card could no longer look.**
    - Seen: in the whole-Setup journey the site card said "The map has nothing to show yet" for ten minutes after the 45 photos and the manifest were published; the button stayed off, so the owner had no way on but Check again (one more input and consent).
    - Found by: the e2e `admin/specs/journey.spec.ts` (S-A30-HAPPY-NO-TERMINAL), the first test that publishes the map in the same tab as the import. The site specs seed the published city before the page opens, so their first look already saw it.
    - Cause: the blocker was observed while Prepare the project's token lived; the analytics consent then replaced the tab's token (the newest one is kept), so the card's watch stopped (`liveAccess` null) with the stale blocker on screen.
    - Fix and pin: `InstallerPort.localBlocker` re-checks the one blocker of the admin's own data (the first city's manifest, from Firestore) once an idle interval with no Google token, until it lifts (`install-flow.ts`, unit tests both ways); the click then asks Google's consent once, as §4.2 allows.
    - **A watch that needs a token must not freeze a reason that needs none: re-check what the app can read itself.**

274. **Setup said it was done before the server and the public map were installed.**
    - Seen: the journey's header read "Setup is done; USGS is left for later…" while Publish the map was still to do.
    - Found by: the same journey (its error context); the contract asked for it (M6 §4.1, CR-M6-13 (1)), and the shared `setupDone` had it, but the admin's own `ready` still counted billing, Provision and Mapbox only.
    - Fix and pin: `refreshDerived` (`packages/admin/src/setup/state.ts`) adds the install part: the server and the site installed, a target nothing has looked at or recorded (a map from before M6) not holding it back, as `setupDone` reads a status without `install`; `state.test.ts` pins both.
    - **Two readers of one rule (the server's `setupDone`, the admin's `ready`) drift unless a test asks both the same question.**

275. **Home's trial reminder test saw an update tile it did not ask for, or no reminder at all.**
    - Seen: the split `quality` failed S-A60-HAPPY and S-A60-BAD-EXISTING-ACCOUNT on the NUC; locally the list read `["installUpdate", "trial"]` once and `[]` the next time.
    - Found by: the integrator's split run (the setup-ux workstream had run the spec before the installer's Home tile and its records landed).
    - Cause: the billing step's Google token let the server card look at the seeded functions, which name no release, so it recorded an update, which Home's tile showed beside the trial; and the helper read Home's list once, before the live `setup/status` and the cards' records had all arrived.
    - Fix and pin: the spec's `expectReminders` polls the list until it is the expected one and leaves out Home's installation tile (A55's behaviour); "It is a paid account" waits for the trial reminder alone to go.
    - **A list that follows live data is asserted with a poll, and a spec counts only the items of its own behaviour.**

276. **The public map could read the owner's sign-in, because M6 put both on one origin.**
    - Seen: the admin's `getAuth` kept the owner's Firebase refresh token in IndexedDB (`firebaseLocalStorageDb`), which belongs to the whole origin; since M6 the viewer's pages (`/`, `/<city>/`) share it with `/admin/`, so any script there could act as the owner.
    - Found by: the M6 security-cost review (finding 1); no test looked at where the sign-in is kept, and the per-path CSP covers `/admin/**` only.
    - Fix and pin: Auth is created with `browserSessionPersistence` (the tab's `sessionStorage`; `DECISIONS-for-review.md` §73a, one sign-in per tab); the e2e tier signs a persona in through an admin-path init script, and S-A58-BAD-VIEWER-READS-NO-SIGN-IN opens the viewer in the same context and finds no user in `localStorage`, `sessionStorage` or IndexedDB.
    - **Moving two apps onto one origin merges their storage: a path is no boundary for IndexedDB, `localStorage` or cookies, so decide what each keeps before the move.**

277. **A newer server missing one function looked "not installed", so an older admin would have replaced it.**
    - Seen: `serverInstalled` dropped the installed release whenever the deployed set was incomplete, the state became `notInstalled`, which allows a submit; the build's `--force` deletes the functions the older source lacks.
    - Found by: the M6 security-cost review (finding 2).
    - Fix and pin: the observation keeps the newest release any part names (`InstalledInfo.newest`) and `deriveInstallState` refuses on it before looking at completeness (S-A55-BAD-DOWNGRADE-INCOMPLETE, `model.test.ts`).
    - **A guard against a downgrade reads the newest thing deployed, whatever else is missing; "incomplete" must never mean "nothing there".**

278. **A token minted before its record could fail was never recorded, and each tick minted another.**
    - Seen: `ops.tick` minted the viewer token at Mapbox, then wrote it in a transaction the city's schema checks; an origin the schema refuses failed the write and left a live token behind, every 15 minutes.
    - Found by: the M6 security-cost review (finding 3).
    - Fix and pin: the origins are checked at build and at run time against the schema's own pattern, and a failed write deletes the minted token (S-A06-BAD-ORIGINS-REFUSED, S-A06-BAD-UNRECORDED-TOKEN-DELETED).
    - **An outside resource created before a local write needs its undo on that write's failure, and the input the write will check should be checked before the creation.**

279. **The public install bundle packed whatever was in `functions/dist`.**
    - Seen: `server.tgz` copied the whole folder, dotfiles included; firebase-tools leaves `*.local` out of a deploy, the bundle did not, and it is served to anyone.
    - Found by: the M6 security-cost review (finding 5); latent (nothing writes such a file there today).
    - Fix and pin: an allowlist of the functions' build files; anything else fails `build:install` (`install-bundle.test.ts`, `.secret.local` and `.env.local` among the cases).
    - **What is published is an allowlist; a tool's own exclusions protect only that tool's output.**

280. **The live map had no way to its update: the step's Done chip hid the button, and a partial server read as not installed.**
    - Seen: in an admin session step (d) is always done, and the server card offered Install or Try again only while it was not, so a stopped update had nothing to click; the live server (61 of 69 functions, no release) was `notInstalled`, so neither Update the map nor Home's tile appeared, and the owner steps of `M6-status.md` §3 could not be followed.
    - Found by: the M6 min-input review (finding 1); every spec started either from a fresh project or from a complete server.
    - Fix and pin: the card's button follows the install's state; a partial target is `updateAvailable` (S-A55-HAPPY-PRE-M6-UPGRADE, S-A55-BAD-UPDATE-FAILED-ADMIN, the fake's `cloud-functions.preM6`).
    - **Seed the world the live project is in, not only a fresh one and a finished one: an upgrade from the last release is a scenario of its own.**

281. **Retry what failed re-ran only the item a pre-M6 record lacked, so the installer's account was never made.**
    - Seen: the live record had 15 items ok and the 16th never reported; the rerun touched that one alone, step (c) turned green, and the install cards' blocker sent the owner back to a step with no button.
    - Found by: the M6 min-input review (finding 2).
    - Fix and pin: an item never reported (`missing` with no reason) makes the rerun take every item (`provision.ts`, S-A04-BAD-PRE-M6-RECORD).
    - **When a release adds an item that changes what the old items mean, a record from before it is stale as a whole.**

282. **A look on step (d) put the claim back to waiting in an admin session, and the tour's screenshot showed it.**
    - Seen: the deploy probe set d2 to `pending` after every successful look, closing steps (e) to (i) until a reload; `reports/screenshots/m6/admin.setup.install-update/` showed d2 "Waiting" on a claimed map, and every checker passed.
    - Found by: the M6 min-input review (finding 4), from the screenshot.
    - Fix and pin: the claim follows the server in start-up mode only (`deploy.ts`); the tour state checks the claim's chip (`specs/install/states.spec.ts`), and S-A55-HAPPY-PRE-M6-UPGRADE checks it through an update.
    - **The layout checkers judge how a state looks, not whether it is right: a state's spec asserts the facts the screenshot shows.**

283. **Every update, and one Cloud Build 503, made Setup look not done.**
    - Seen: the cards recorded every state change (`queued`, `working`, `unavailable`), while `setupDone` and the admin's `ready` accepted only the installed states, so the dashboard-first rule sent the owner to Setup for the length of an update.
    - Found by: the M6 min-input review (finding 5).
    - Fix and pin: a target is installed while a release of it is recorded, whatever its build does, in both readers of the rule; `unavailable` is never recorded (`setup-done.test.ts`, `state.test.ts`, `install.test.ts`, S-A55-HAPPY-DONE-WHILE-UPDATING).
    - **A state that says what is running is not a state that says what is installed: a "done" rule reads the latter.**

284. **A signed-out spec stayed signed in once the e2e sign-in moved from the storage state to an init script.**
    - Seen: S-A20-BAD-SIGNED-OUT-DEEP-LINK failed at every admin project of the split `all`: its `test.use({ storageState: { cookies: [], origins: [] } })` no longer cleared anything, since the persona's session now comes from `context.addInitScript` (lesson 276).
    - Found by: the fixer's split `all` run; the admin tier's own specs passed, the content specs' signed-out describe did not.
    - Fix and pin: the content fixtures take an option `signedIn` (default true), and the signed-out describe sets it to false; no spec overrides `storageState` any more.
    - **When a fixture changes how a state is made, every override of the old mechanism silently stops overriding: grep for them in the same change.**

285. **A privacy check of `sessionStorage` failed once Firebase Auth's session moved into it.**
    - Seen: S-A25-BAD-RELOAD-KEEPS-STEPS asserted that the tab's whole `sessionStorage` held no e-mail address; since §73a it also holds Firebase Auth's signed-in user (its e-mail and refresh token, kept in the tab on purpose).
    - Found by: the fixer's split `all` run (on the NUC).
    - Fix and pin: the check reads the app's own `hcm:` entries for the bootstrap record's promise, and pins that the only other entries are Firebase's (`firebase:*`, the user's key among them) and that no Google token (`ya29.`) is anywhere.
    - **A check over a whole storage asserts what the app writes, plus an explicit list of what libraries may write beside it.**

286. **Home's update tile opened step (d), and Setup then moved on to the next step under the spec.**
    - Seen: S-A55-HAPPY-UPDATE failed as the first test of a fresh run (twice), passed later in the same run: the card was open, then the pipeline's was.
    - Found by: the fixer's targeted reruns of `e2e/admin/steps/install/update.spec.ts`.
    - Cause: the link opens (d) before `setup/status` arrives; when it does, (d) turns done while open and hands over to the first step not done (`withStep`), as Setup does after any step.
    - Fix and pin: the spec opens the card again until it shows the update (`toPass` around `setup.show`), as `SetupPage.visit` already waits for Setup to settle.
    - **A card opened by a link may be handed over once the record arrives: a spec waits for what it needs on the card, re-opening it, never for the first open.**

287. **A split run's emulator logs failed the next run's secret scan.**
    - Seen: the fixer's second split `all` failed `static/gitleaks` with 3,200 findings, all in `firebase-debug.log` at the root: the Firebase CLI's log of the previous run's emulators, which Playwright stopped, so they never removed it; it holds the Auth emulator's test tokens.
    - Found by: the fixer's runs (the first run's `static` came before any emulator, the second after one).
    - Fix and pin: the stray gitignored logs were deleted before the next run; taking them out of `gitleaks dir`'s scope is `DECISIONS-for-review.md` §73l (ask first).
    - **A gitignored file is still in a directory scan's scope: whatever a run leaves behind, the next run's `static` reads.**
