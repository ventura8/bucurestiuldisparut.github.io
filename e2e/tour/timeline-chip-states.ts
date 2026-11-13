import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { fingers, manyYearsManifest, stopCentre, touch, yearChip } from '../support/timeline.js';
import { openViewer, serveManifest, t } from '../support/viewer.js';

/**
 * The timeline's year chip in the tour's inventory (the owner, 2026-11-13), visited by the journey `timeline-chip` of
 * e2e/tour/states.ts at every viewer viewport: in a city of twenty-one years, a mouse over a year without its label, then
 * a finger held on the track mid-scrub (the chip clear of it: above a lying card, beside a standing one), each checked
 * against the compass, the zoom group, the menu button, the photos chip and the legal line.
 */

export interface TimelineChipTour {
    readonly page: Page;
    readonly lang: Locale;
}

const YEARS = Array.from({ length: 20 }, (_, at) => 1965 + at);

export const TIMELINE_CHIP_STATES = {
    'timeline-chip-hover': {
        title: 'A mouse over a year without its label: the year chip above the timeline (beside it standing)',
        enter: async ({ page }: TimelineChipTour) => {
            const stop = await stopCentre(page, 9);
            await page.mouse.move(stop.x, stop.y);
            await expect.poll(async () => (await yearChip(page))?.text).toBe('1973');
        },
    },
    'timeline-chip-finger': {
        title: 'A finger dragged along the timeline and held: the year under it selected, the chip clear of the finger',
        enter: async ({ page, lang }: TimelineChipTour) => {
            await page.mouse.move(0, 0);
            const cdp = await fingers(page);
            await touch(cdp, await stopCentre(page, 10), [await stopCentre(page, 11), await stopCentre(page, 12)], false);
            const slider = page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
            await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1976' }));
            await expect.poll(async () => (await yearChip(page))?.text).toBe('1976');
        },
    },
} as const;

/** The journey of these states in e2e/tour/states.ts. */
export const TIMELINE_CHIP_JOURNEY = {
    title: 'The year chip under a mouse and under a finger, in a city of many years',
    id: 'timeline-chip',
    boot: async ({ page, lang }: TimelineChipTour) => {
        await serveManifest(page, manyYearsManifest(YEARS));
        await openViewer(page, { lang, hash: '16/44.44763/26.13822' });
    },
    states: ['timeline-chip-hover', 'timeline-chip-finger'],
} as const;
