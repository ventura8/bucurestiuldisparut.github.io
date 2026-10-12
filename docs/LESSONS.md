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
