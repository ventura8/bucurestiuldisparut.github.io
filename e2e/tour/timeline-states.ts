import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { twoDatesOf1980 } from '../fixtures/manifest.js';
import { callController, openTimelineCard, openViewer, serveManifest, t, viewer } from '../support/viewer.js';

/**
 * The timeline's pill and date picker in the tour's inventory (V67 and V68, the owner's V12 and V13 of 2026-11-13), visited
 * by the journey `timeline-dates` of e2e/tour/states.ts at every viewer viewport, on a city whose 1980 has two dates: on
 * a phone (upright or on its side) the timeline resting as its pill, then the card a tap opened; everywhere the menu of
 * 1980's dates opened by Enter on the slider. Every other map state checks the pill against the chip, the menu button, the
 * zoom group, the compass and the legal line on a phone.
 */

export interface TimelineTour {
    readonly page: Page;
    readonly lang: Locale;
}

/** A phone: upright (under 600 px wide) or on its side (under 480 px tall), where the timeline rests as its pill. */
function phone(page: Page): boolean {
    const size = page.viewportSize();
    return size !== null && (size.width < 600 || size.height < 480);
}

function slider(page: Page, lang: Locale) {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

export const TIMELINE_STATES = {
    'timeline-pill': {
        title: 'A phone: the timeline resting as the pill of its year, with its dates badge',
        exists: phone,
        enter: async ({ page }: TimelineTour) => {
            await expect(viewer(page).locator('hcm-timeline')).toHaveAttribute('collapsed');
        },
    },
    'timeline-open': {
        title: 'A phone: the whole timeline card, opened by a tap on its pill',
        exists: phone,
        enter: async ({ page }: TimelineTour) => {
            await openTimelineCard(page);
        },
    },
    'timeline-dates': {
        title: "The menu of a year's dates, opened by Enter on the timeline, the date on top checked",
        enter: async ({ page, lang }: TimelineTour) => {
            await slider(page, lang).focus();
            await page.keyboard.press('Enter');
            await expect(page.getByRole('menuitemradio', { checked: true })).toBeFocused();
        },
        escape: ({ lang }: TimelineTour) => ({ opener: t(lang, 'timeline.label') }),
    },
} as const;

/** The journey of these states in e2e/tour/states.ts. */
export const TIMELINE_JOURNEY = {
    title: "The timeline's pill on a phone and the menu of a year's dates",
    id: 'timeline-dates',
    boot: async ({ page, lang }: TimelineTour) => {
        await serveManifest(page, twoDatesOf1980());
        await openViewer(page, { lang, hash: '15/44.37000/25.97000' });
        await callController(page, 'setYear', 1980);
        await expect(slider(page, lang)).toHaveAttribute(
            'aria-valuetext',
            new RegExp(`^${t(lang, 'timeline.year', { year: '1980' })}, `, 'u'),
        );
    },
    states: ['timeline-pill', 'timeline-open', 'timeline-dates'],
} as const;
