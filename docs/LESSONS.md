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
