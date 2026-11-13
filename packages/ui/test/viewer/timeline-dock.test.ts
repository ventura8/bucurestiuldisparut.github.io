import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { deepActiveElement } from '../../src/components/focus.js';
import type { HcmTimeline } from '../../src/viewer/hcm-timeline.js';
import { shadowQuery } from './doubles.js';
import { readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';
import { COMPACT, EXPANDED, LANDSCAPE_PHONE, mountViewer, part, type Mounted } from './viewer-harness.js';

/**
 * V12: on a phone the timeline rests as its year's pill and opens on a press; a press back on the map or Esc collapses
 * it. V13: a year with several dates opens its date picker, and the date picked comes to the front.
 */

/** The test manifest with a second layer of 1966, dated, so 1966 has two dates. */
function twoDates() {
    return testManifest((raw) => {
        const layers = raw['layers'] as Record<string, unknown>[];
        const [, corona] = layers;
        layers.push({ ...corona, id: 'kh4-1966b', date: '1966-09-03', label: { ro: 'Corona 1966 B', en: 'Corona 1966 B' }, order: 3 });
    });
}

function timelineOf(mounted: Mounted): HcmTimeline {
    return part(mounted, 'hcm-timeline') as HcmTimeline;
}

function collapsed(mounted: Mounted): boolean {
    return part(mounted, '.frame').hasAttribute('data-timeline-collapsed') && timelineOf(mounted).collapsed;
}

function press(target: Element): void {
    target.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, cancelable: true, composed: true }));
}

describe('<hcm-map-viewer>: the timeline as a pill on a phone (V12)', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it.each([
        { name: 'upright', box: COMPACT },
        { name: 'on its side', box: LANDSCAPE_PHONE },
    ])('happyPath_$name: idleItIsThePillAPressOpensItThePressMovesNoYear', async ({ box }) => {
        const mounted = await mountViewer(readyState(testManifest(), { year: 1966 }), box);
        expect(collapsed(mounted)).toBe(true);

        press(shadowQuery(timelineOf(mounted), '.thumb'));
        await mounted.element.updateComplete;

        expect(collapsed(mounted)).toBe(false);
        expect(mounted.store.callsOf('setYear')).toEqual([]);
    });

    it('happyPath_aPressOnTheMapOrEscCollapsesItAgain', async () => {
        const mounted = await mountViewer(readyState(testManifest(), { year: 1966 }), COMPACT);
        press(timelineOf(mounted));
        await mounted.element.updateComplete;

        press(part(mounted, '.map'));
        await mounted.element.updateComplete;
        expect(collapsed(mounted)).toBe(true);

        press(timelineOf(mounted));
        await mounted.element.updateComplete;
        press(timelineOf(mounted));
        await mounted.element.updateComplete;
        expect(collapsed(mounted)).toBe(false);
        shadowQuery(timelineOf(mounted), '[role="slider"]').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
        );
        await mounted.element.updateComplete;
        expect(collapsed(mounted)).toBe(true);
    });

    it('happyPath_theSkipLinkOpensItWithTheFocusOnTheSlider', async () => {
        const mounted = await mountViewer(readyState(), COMPACT);

        part(mounted, '.skip').click();
        await mounted.element.updateComplete;

        expect(collapsed(mounted)).toBe(false);
        expect(deepActiveElement()?.getAttribute('role')).toBe('slider');
    });

    it('badPath_aLargerWindowNeverCollapsesIt', async () => {
        const mounted = await mountViewer(readyState(), EXPANDED);

        expect(collapsed(mounted)).toBe(false);
        expect(part(mounted, '.frame').hasAttribute('data-timeline-collapsed')).toBe(false);
        press(part(mounted, '.map'));
        shadowQuery(timelineOf(mounted), '[role="slider"]').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
        );
        await mounted.element.updateComplete;
        expect(collapsed(mounted)).toBe(false);
    });

    it('badPath_theCollapsedPillLeavesTheChipAndTheMenuButtonClear', async () => {
        const mounted = await mountViewer(readyState(testManifest(), { year: 1977 }), COMPACT);
        const pill = timelineOf(mounted).getBoundingClientRect();
        const chip = part(mounted, '.dock.chip').getBoundingClientRect();
        const fab = part(mounted, '.dock.menu').getBoundingClientRect();

        expect([Math.round(pill.width), Math.round(pill.height)]).toEqual([68, 48]);
        expect(chip.top - pill.bottom).toBeGreaterThanOrEqual(8);
        expect(fab.left - pill.right).toBeGreaterThanOrEqual(8);
    });
});

describe('<hcm-map-viewer>: the date picker of a year (V13)', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    async function opened(): Promise<Mounted> {
        const mounted = await mountViewer(readyState(twoDates(), { year: 1966 }), EXPANDED);
        expect(shadowQuery(timelineOf(mounted), '.thumb .badge').textContent.trim()).toBe('2');
        shadowQuery(timelineOf(mounted), '.thumb .badge').click();
        await mounted.element.updateComplete;
        return mounted;
    }

    it('happyPath_theBadgeOpensTheDatesTheFramesInertAPickComesToTheFront', async () => {
        const mounted = await opened();

        await expect.element(page.getByRole('menu', { name: 'Datele din 1966' })).toBeVisible();
        expect(part(mounted, '.frame').inert).toBe(true);
        const menu = part(mounted, 'hcm-date-menu');
        shadowQuery(menu, '[data-item="kh4-1966"]').click();
        await mounted.element.updateComplete;

        expect(mounted.store.callsOf('pickLayer')).toEqual([['kh4-1966']]);
        expect(mounted.element.shadowRoot?.querySelector('hcm-date-menu')).toBeNull();
        expect(part(mounted, '.frame').inert).toBe(false);
        await vi.waitFor(() => {
            expect(deepActiveElement()?.getAttribute('role')).toBe('slider');
        });
    });

    it('badPath_escClosesThePickerWithoutAPick', async () => {
        const mounted = await opened();
        const menu = part(mounted, 'hcm-date-menu');

        shadowQuery(menu, '[role="menu"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await mounted.element.updateComplete;

        expect(mounted.store.callsOf('pickLayer')).toEqual([]);
        expect(mounted.element.shadowRoot?.querySelector('hcm-date-menu')).toBeNull();
    });

    it('happyPath_theCheckedDateIsTheOneOnTop', async () => {
        const mounted = await opened();
        const menu = part(mounted, 'hcm-date-menu');

        expect(shadowQuery(menu, '[aria-checked="true"]').getAttribute('data-item')).toBe('kh4-1966b');
    });
});
