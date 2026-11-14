import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { mapIdle } from '../support/map.js';
import { fingers, manyYearsManifest, stopCentre, touch, yearChip } from '../support/timeline.js';
import { openTimelineCard, openViewer, serveManifest, t } from '../support/viewer.js';

/**
 * The timeline's states in the tour's inventory: a historical year and a keyboard step (visited by the journey `year`
 * of e2e/tour/states.ts), and the year chip (the owner, 2026-11-13), visited by the journey `timeline-chip` of
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
    year: {
        title: 'A historical year: its layer, the photos-near-this-year chip (an icon button under a standing timeline)',
        enter: async ({ page, lang }: TimelineChipTour) => {
            await expect(page.getByRole('button', { name: t(lang, 'photos.nearYear', { year: '1966' }) })).toBeVisible();
        },
    },
    'timeline-step': {
        title: 'The timeline moved by the keyboard: the slider says its new year',
        enter: async ({ page, lang }: TimelineChipTour) => {
            const slider = page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
            const before = await slider.getAttribute('aria-valuetext');
            await slider.focus();
            await expect(slider).toBeFocused();
            await slider.press('ArrowRight');
            await expect(slider).not.toHaveAttribute('aria-valuetext', before ?? '');
            await mapIdle(page);
        },
    },
    'timeline-chip-hover': {
        title: 'A mouse over a year without its label: the year chip above the timeline (beside it standing)',
        enter: async ({ page }: TimelineChipTour) => {
            const stop = await stopCentre(page, 9);
            await page.mouse.move(stop.x, stop.y);
            await expect.poll(async () => (await yearChip(page))?.text).toBe('1974');
        },
    },
    'timeline-chip-finger': {
        title: 'A finger dragged along the timeline and held: the year under it selected, the chip clear of the finger',
        enter: async ({ page, lang }: TimelineChipTour) => {
            await page.mouse.move(0, 0);
            const cdp = await fingers(page);
            await touch(cdp, await stopCentre(page, 10), [await stopCentre(page, 11), await stopCentre(page, 12)], false);
            const slider = page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
            await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1977' }));
            await expect.poll(async () => (await yearChip(page))?.text).toBe('1977');
        },
    },
    'timeline-scroll-hint': {
        title: 'A timeline of ninety-eight years opened on 1954: centred there, a button at each edge with years hidden beyond, naming the furthest',
        enter: async ({ page, lang }: TimelineChipTour) => {
            // 1886 is always hidden; today too unless the card is wide enough (a 4K screen) for 1954 to sit near its end.
            await expect(page.getByRole('button', { name: t(lang, 'timeline.earlier', { year: '1886' }), exact: true })).toBeVisible();
            await mapIdle(page);
        },
    },
} as const;

/** The scroll hint's journey in e2e/tour/states.ts: ninety-eight years (more than a 4K screen's card holds, within the manifest's hundred layers), opened on 1954. */
export const TIMELINE_SCROLL_JOURNEY = {
    title: 'The scroll hint of a timeline longer than its card, opened on the selected year',
    id: 'timeline-scroll',
    boot: async ({ page, lang }: TimelineChipTour) => {
        await serveManifest(page, manyYearsManifest(Array.from({ length: 98 }, (_, at) => 1886 + at)));
        await openViewer(page, { lang, hash: '16/44.44763/26.13822&layers=e2e-1954' });
        await openTimelineCard(page);
    },
    states: ['timeline-scroll-hint'],
} as const;

/** The journey of these states in e2e/tour/states.ts. */
export const TIMELINE_CHIP_JOURNEY = {
    title: 'The year chip under a mouse and under a finger, in a city of many years',
    id: 'timeline-chip',
    boot: async ({ page, lang }: TimelineChipTour) => {
        await serveManifest(page, manyYearsManifest(YEARS));
        await openViewer(page, { lang, hash: '16/44.44763/26.13822' });
        // On a phone the timeline rests as its pill (V67): a tap opens the card the chip's states need.
        await openTimelineCard(page);
    },
    states: ['timeline-chip-hover', 'timeline-chip-finger'],
} as const;
