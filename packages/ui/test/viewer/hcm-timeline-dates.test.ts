import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_TIMELINE_TAG, defineHcmTimeline, type HcmTimeline } from '../../src/viewer/hcm-timeline.js';
import { mountElement, recordEvents, shadowQuery, shadowQueryAll } from './doubles.js';

/** V13 (a badge on a year with several dates, Enter or the badge asks for the picker) and V12 (the collapsed pill). */
const STOPS = [1966, 1977, 1980, null];
const COUNTS = new Map([
    [1966, 3],
    [1980, 2],
]);

async function timeline(properties: Partial<HcmTimeline> = {}): Promise<HcmTimeline> {
    defineHcmTimeline();
    const element = await mountElement<HcmTimeline>(HCM_TIMELINE_TAG, { stops: STOPS, value: 1977, dateCounts: COUNTS, ...properties });
    if (properties.collapsed !== true) {
        element.style.inlineSize = properties.orientation === 'vertical' ? '68px' : '400px';
        element.style.blockSize = properties.orientation === 'vertical' ? '300px' : '';
    }
    await element.updateComplete;
    return element;
}

function press(element: HcmTimeline, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true });
    shadowQuery(element, '[role="slider"]').dispatchEvent(event);
    return event;
}

describe('<hcm-timeline> dates (V13)', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aYearWithSeveralDatesHasABadgeWithTheCount', async () => {
        const element = await timeline();

        expect(shadowQueryAll(element, '.stop .badge').map((badge) => badge.textContent.trim())).toEqual(['3', '2']);
        expect(element.shadowRoot?.querySelector('.thumb .badge')).toBeNull();
        await expect.element(page.getByRole('slider', { name: 'Cronologie' })).toHaveAttribute('aria-valuetext', 'Anul 1977');
    });

    it('happyPath_theSelectedYearsBadgeIsOnThePillAndTheSliderSaysIt', async () => {
        const element = await timeline({ value: 1966, locale: 'en' });

        expect(shadowQuery(element, '.thumb .badge').textContent.trim()).toBe('3');
        expect(shadowQueryAll(element, '.stop .badge')).toHaveLength(1);
        await expect
            .element(page.getByRole('slider', { name: 'Timeline' }))
            .toHaveAttribute('aria-valuetext', 'Year 1966, several dates (3), Enter lists them');
    });

    it('happyPath_aPressOnABadgeAsksForThatYearsDates', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-dates-open');

        shadowQueryAll(element, '.stop .badge')[1]?.click();

        expect(events).toHaveLength(1);
        const detail = events[0]?.detail as { year: number; anchor: { width: number } };
        expect(detail.year).toBe(1980);
        expect(detail.anchor.width).toBeGreaterThan(0);
    });

    it('happyPath_enterOnAYearWithSeveralDatesAsksForThem', async () => {
        const element = await timeline({ value: 1966 });
        const events = recordEvents(element, 'hcm-dates-open');

        const event = press(element, 'Enter');

        expect(event.defaultPrevented).toBe(true);
        expect(events.map((seen) => (seen.detail as { year: number }).year)).toEqual([1966]);
    });

    it('badPath_enterOnASingleDateOrTodayAsksForNothing', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-dates-open', 'hcm-year-change');

        expect(press(element, 'Enter').defaultPrevented).toBe(false);
        element.value = null;
        await element.updateComplete;
        press(element, 'Enter');

        expect(events).toEqual([]);
    });

    it('badPath_withoutCountsNoBadge', async () => {
        const element = await timeline({ dateCounts: new Map() });

        expect(element.shadowRoot?.querySelectorAll('.badge')).toHaveLength(0);
    });
});

describe('<hcm-timeline> collapsed (V12)', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_collapsedStandingItIsOnlyThePillA48PixelCard', async () => {
        const element = await timeline({ orientation: 'vertical', collapsed: true });
        const box = element.getBoundingClientRect();

        expect([Math.round(box.width), Math.round(box.height)]).toEqual([68, 48]);
        expect(getComputedStyle(shadowQuery(element, '.rail')).display).toBe('none');
        expect(getComputedStyle(shadowQuery(element, '.stops')).display).toBe('none');
        expect(element.hasAttribute('collapsed')).toBe(true);
    });

    it('badPath_collapsedTheSliderStillTakesTheKeys', async () => {
        const element = await timeline({ collapsed: true });
        const events = recordEvents(element, 'hcm-year-change');

        press(element, 'ArrowRight');

        expect(events).toEqual([{ type: 'hcm-year-change', detail: { year: 1980 } }]);
        expect(element.getBoundingClientRect().height).toBe(48);
    });
});
