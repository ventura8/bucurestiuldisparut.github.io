import { expect, type Page } from '@playwright/test';

import { assertAccessible, assertEscapeCloses } from './a11y.js';
import { i18nLeaks } from './i18n.js';
import { assertLayoutSound } from './layout.js';
import { saveStateShots } from './state-shots.js';

/**
 * One visit of a tour state (e2e/tour/states.ts): the generic layout checker, the generic accessibility checker and the
 * i18n leak check on the page as it is, then, for a popup or modal state, Esc (it closes, and the focus goes back to the
 * control that opened it). Every check is soft, so one run reports every state of the tour; the violations are recorded
 * in the test's output and attached with an outlined screenshot (e2e/support/report.ts). With `HCM_STATE_SCREENSHOTS`
 * the state is first saved for the visual audit (e2e/support/state-shots.ts).
 */
export interface StateVisit {
    /** The state's id in the inventory (`viewer.layers-full`, `admin.setup-billing`). */
    readonly id: string;
    /** What the visitor sees in it, as the inventory says (it names the state in the i18n check's message). */
    readonly title?: string;
    /** The language the page shows (a Romanian page must show no English-only text). */
    readonly lang: 'ro' | 'en';
    /** Texts a live region must have announced on the way into the state. */
    readonly announcements?: readonly string[];
    /** Axe rules that do not apply as emulated (the author-colour rules under forced colours). */
    readonly skipRules?: readonly string[];
    /** Esc closes the state's popup or modal surface; the focus returns to the control of this name (null: none opened it). */
    readonly escape?: { readonly opener: string | null };
}

/** Checks the state the page is in (see `StateVisit`); with `escape`, the page is left with its popup closed. */
export async function expectStateSound(page: Page, visit: StateVisit): Promise<void> {
    await saveStateShots(page, visit.id, visit.lang);
    const layout = await assertLayoutSound(page, visit.id, { report: false });
    await assertAccessible(page, visit.id, {
        layout,
        reportWith: layout.violations,
        announcements: visit.announcements ?? [],
        skipRules: visit.skipRules ?? [],
    });
    const name = visit.title === undefined ? visit.id : `${visit.id} (${visit.title})`;
    expect.soft(await i18nLeaks(page, visit.lang), `${name}: message keys, or English in a Romanian page`).toEqual([]);
    if (visit.escape !== undefined) {
        await assertEscapeCloses(page, visit.id, visit.escape.opener);
    }
}
