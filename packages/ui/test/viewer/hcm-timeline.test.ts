import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_TIMELINE_TAG, HcmTimeline, defineHcmTimeline, trackRatio } from '../../src/viewer/hcm-timeline.js';
import { mountElement, recordEvents, shadowQuery, shadowQueryAll } from './doubles.js';

const STOPS = [1966, 1977, null];

async function timeline(properties: Partial<HcmTimeline> = {}): Promise<HcmTimeline> {
    defineHcmTimeline();
    const element = await mountElement<HcmTimeline>(HCM_TIMELINE_TAG, { stops: STOPS, value: null, ...properties });
    element.style.inlineSize = '400px';
    element.style.blockSize = properties.orientation === 'vertical' ? '300px' : '';
    await element.updateComplete;
    return element;
}

function press(element: HcmTimeline, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true });
    shadowQuery(element, '[role="slider"]').dispatchEvent(event);
    return event;
}

function pointer(target: EventTarget, type: string, x: number, y: number, button = 0): void {
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true, composed: true }));
}

describe('<hcm-timeline>', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aSliderWithTheLocalizedYear', async () => {
        await timeline({ value: 1977 });

        const slider = page.getByRole('slider', { name: 'Cronologie' });
        await expect.element(slider).toHaveAttribute('aria-valuenow', '1');
        await expect.element(slider).toHaveAttribute('aria-valuemax', '2');
        await expect.element(slider).toHaveAttribute('aria-valuetext', 'Anul 1977');
        await expect.element(slider).toHaveAttribute('aria-orientation', 'horizontal');
    });

    it('happyPath_todayInEnglish', async () => {
        const element = await timeline({ locale: 'en' });

        await expect.element(page.getByRole('slider', { name: 'Timeline' })).toHaveAttribute('aria-valuetext', 'Today');
        expect(shadowQueryAll(element, '.stop .label').map((label) => label.textContent)).toEqual(['1966', '1977', 'Today']);
    });

    it('happyPath_keysMoveBetweenStops', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-year-change');

        press(element, 'ArrowLeft');
        press(element, 'Home');
        press(element, 'ArrowRight');
        press(element, 'End');
        press(element, 'PageDown');
        press(element, 'ArrowDown');
        press(element, 'PageUp');
        press(element, 'ArrowUp');

        expect(events.map((event) => event.detail)).toEqual([
            { year: 1977 },
            { year: 1966 },
            { year: 1977 },
            { year: null },
            { year: 1977 },
            { year: 1966 },
            { year: 1977 },
            { year: null },
        ]);
    });

    it('badPath_keysPastTheEndsAndOtherKeysChangeNothing', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-year-change');

        expect(press(element, 'End').defaultPrevented).toBe(true);
        press(element, 'ArrowRight');
        expect(press(element, 'a').defaultPrevented).toBe(false);

        expect(events).toEqual([]);
    });

    it('happyPath_dragAlongTheTrackSnapsToStops', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-year-change');
        const track = shadowQuery(element, '.track');
        const rect = track.getBoundingClientRect();

        pointer(track, 'pointerdown', rect.left + 1, rect.top + 10);
        await element.updateComplete;
        expect(element.dragging).toBe(true);
        expect(element.hasAttribute('dragging')).toBe(true);
        pointer(window, 'pointermove', rect.left + rect.width / 2, rect.top + 10);
        pointer(window, 'pointerup', rect.left + rect.width / 2, rect.top + 10);
        pointer(window, 'pointermove', rect.right, rect.top + 10);

        expect(events.map((event) => event.detail)).toEqual([{ year: 1966 }, { year: 1977 }]);
        expect(element.dragging).toBe(false);
        expect(element.shadowRoot?.activeElement?.getAttribute('role')).toBe('slider');
    });

    it('happyPath_verticalTrackGrowsUpwards', async () => {
        const element = await timeline({ orientation: 'vertical' });
        const events = recordEvents(element, 'hcm-year-change');
        const track = shadowQuery(element, '.track');
        const rect = track.getBoundingClientRect();

        pointer(track, 'pointerdown', rect.left + 10, rect.bottom - 1);
        pointer(window, 'pointercancel', rect.left + 10, rect.bottom - 1);

        expect(events.map((event) => event.detail)).toEqual([{ year: 1966 }]);
        await expect.element(page.getByRole('slider')).toHaveAttribute('aria-orientation', 'vertical');
    });

    it('badPath_secondaryButtonAndDisconnectEndTheDrag', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-year-change');
        const track = shadowQuery(element, '.track');
        const rect = track.getBoundingClientRect();

        pointer(track, 'pointerdown', rect.left + 1, rect.top + 10, 2);
        expect(element.dragging).toBe(false);

        pointer(track, 'pointerdown', rect.right - 1, rect.top + 10);
        element.remove();
        pointer(window, 'pointermove', rect.left + 1, rect.top + 10);

        expect(events).toEqual([]);
        expect(element.dragging).toBe(false);
    });

    it('badPath_noStopsRendersAnEmptySliderThatIgnoresKeys', async () => {
        const element = await timeline({ stops: [] });
        const events = recordEvents(element, 'hcm-year-change');

        press(element, 'End');

        expect(events).toEqual([]);
        await expect.element(page.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Azi');
    });

    it('badPath_definingTwiceKeepsTheFirstRegistration', () => {
        defineHcmTimeline();
        defineHcmTimeline();

        expect(customElements.get(HCM_TIMELINE_TAG)).toBe(HcmTimeline);
    });
});

describe('trackRatio', () => {
    it('happyPath_horizontalAndVerticalShares', () => {
        const rect = new DOMRect(100, 200, 200, 100);

        expect(trackRatio(rect, { clientX: 150, clientY: 0 }, false)).toBe(0.25);
        expect(trackRatio(rect, { clientX: 0, clientY: 225 }, true)).toBe(0.75);
    });

    it('badPath_outsideOrEmptyTracksClamp', () => {
        expect(trackRatio(new DOMRect(0, 0, 100, 10), { clientX: 500, clientY: 0 }, false)).toBe(1);
        expect(trackRatio(new DOMRect(0, 0, 100, 10), { clientX: -5, clientY: 0 }, false)).toBe(0);
        expect(trackRatio(new DOMRect(0, 0, 0, 0), { clientX: 0, clientY: 0 }, false)).toBe(0);
    });
});
