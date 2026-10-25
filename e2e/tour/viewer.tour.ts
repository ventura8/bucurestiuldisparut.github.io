import { expect, test } from '../support/test.js';
import { expectJourneySound, journey } from './states.js';

/**
 * The layout and accessibility tour (docs/research/design-review-testability.md §4.3; behaviours V14, V15 and V18; the
 * user's request of 2026-10-12): every screen and state of the viewer (e2e/tour/states.ts) on all 11 viewports, light
 * and dark, Romanian and English (44 projects: the nine of tier `tour` on every push, the other 35 of tier
 * `tour-matrix` in `all` and nightly, e2e/projects.ts). Each state runs the generic layout checker (occlusion, overlap,
 * edges, Mapbox's logo and attribution, text) and the generic accessibility checker (axe with best practices, target
 * sizes, one full Tab round, focus rings, non-text contrast in the page's scheme and in high contrast, landmarks,
 * announcements, text spacing, reflow at 320 px), then the i18n leak check, and Esc for a popup
 * (e2e/support/state-check.ts). The checks are soft: a failing run lists every violation of every state, each naming
 * its elements, with an outlined screenshot attached (e2e/support/report.ts). Every test carries the rows of the
 * checks every state passes (S-V15-HAPPY, S-V15-BAD-TEXT-SPACING, S-V15-BAD-REFLOW-320, S-V14-HAPPY-EVERY-STATE).
 */

test(
    'Home, the keyboard, the menu and its toasts',
    {
        tag: [
            '@S-V15-HAPPY',
            '@S-V15-BAD-TEXT-SPACING',
            '@S-V15-BAD-REFLOW-320',
            '@S-V14-HAPPY-EVERY-STATE',
            '@S-V18-HAPPY',
            '@S-V14-HAPPY-TOAST-ANNOUNCED',
        ],
    },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('home'));
    },
);

test(
    'A historical year, the timeline and the Layers panel',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE', '@S-V18-HAPPY-MODAL-STATES'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('year-layers'));
    },
);

test(
    'A photo at every height, its lightbox, and the photo list',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE', '@S-V18-HAPPY-MODAL-STATES'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('photo'));
    },
);

test(
    'A point of interest at every height, and About from top to end',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE', '@S-V18-HAPPY-MODAL-STATES'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('poi-about'));
    },
);

test(
    'Swipe compare: the divider at 50 % and at both edges, from the keyboard; the toggle of a compact window; the chooser',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('compare'));
    },
);

test(
    'Bucharest today: no layers yet and the consent banner',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('today'));
    },
);

test(
    'A toast',
    {
        tag: [
            '@S-V15-HAPPY',
            '@S-V15-BAD-TEXT-SPACING',
            '@S-V15-BAD-REFLOW-320',
            '@S-V14-HAPPY-EVERY-STATE',
            '@S-V14-HAPPY-TOAST-ANNOUNCED',
        ],
    },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('toast'));
    },
);

test(
    'Loading',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('loading'));
    },
);

for (const id of ['error-not-found', 'error-network', 'error-invalid', 'no-webgl']) {
    test(
        journey(id).title,
        { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE'] },
        async ({ page, context, lang, consoleErrors }) => {
            const errors = journey(id);
            await expectJourneySound({ page, context, lang }, errors);
            expect(
                consoleErrors.take().filter((error) => errors.consoleError?.test(error) !== true),
                'only the console errors the journey causes',
            ).toEqual([]);
        },
    );
}
