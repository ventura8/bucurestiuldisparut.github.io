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
