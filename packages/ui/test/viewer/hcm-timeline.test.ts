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

    it('badPath_theThumbTouchTargetIsAtLeast48Pixels', async () => {
        // The e2e tour found the 40 px thumb under the 48 px target size of compact windows.
        const element = await timeline({ value: 1977 });
        const thumb = shadowQuery(element, '.thumb');
        const target = getComputedStyle(thumb, '::after');

        expect(thumb.classList.contains('touch-target')).toBe(true);
        expect(Number.parseFloat(target.width)).toBeGreaterThanOrEqual(48);
        expect(Number.parseFloat(target.height)).toBeGreaterThanOrEqual(48);
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

describe('<hcm-timeline> right to left', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_rightToLeftTheHorizontalArrowsFollowTheThumb', async () => {
        // In Arabic or Hebrew the value grows to the left: Left moves the thumb left, to a later year.
        const element = await timeline({ value: 1966 });
        element.dir = 'rtl';
        const events = recordEvents(element, 'hcm-year-change');

        press(element, 'ArrowLeft');
        press(element, 'ArrowRight');
        press(element, 'ArrowUp');

        expect(events.map((event) => event.detail)).toEqual([{ year: 1977 }, { year: 1966 }, { year: 1977 }]);
    });

    it('badPath_rightToLeftTheThumbAndAPressLandOnTheirStop', async () => {
        // The review shots at 768 px, right to left: the thumb and the stops sat a whole width beside their place.
        const element = await timeline({ value: 1977 });
        element.dir = 'rtl';
        await element.updateComplete;
        const thumb = shadowQuery(element, '.thumb');
        thumb.style.transition = 'none';
        const tick = shadowQueryAll(element, '.stop .tick')[1]?.getBoundingClientRect();
        const box = thumb.getBoundingClientRect();
        expect(Math.abs((tick?.left ?? 0) + (tick?.width ?? 0) / 2 - (box.left + box.width / 2))).toBeLessThanOrEqual(1);

        const events = recordEvents(element, 'hcm-year-change');
        const track = shadowQuery(element, '.track');
        const rect = track.getBoundingClientRect();
        pointer(track, 'pointerdown', rect.left + 1, rect.top + 10);
        pointer(window, 'pointerup', rect.left + 1, rect.top + 10);
        expect(events.map((event) => event.detail)).toEqual([{ year: null }]);
    });
});

describe('trackRatio', () => {
    it('happyPath_horizontalAndVerticalShares', () => {
        const rect = new DOMRect(100, 200, 200, 100);

        expect(trackRatio(rect, { clientX: 150, clientY: 0 }, false)).toBe(0.25);
        expect(trackRatio(rect, { clientX: 0, clientY: 225 }, true)).toBe(0.75);
        expect(trackRatio(rect, { clientX: 150, clientY: 0 }, false, true)).toBe(0.75);
    });

    it('badPath_outsideOrEmptyTracksClamp', () => {
        expect(trackRatio(new DOMRect(0, 0, 100, 10), { clientX: 500, clientY: 0 }, false)).toBe(1);
        expect(trackRatio(new DOMRect(0, 0, 100, 10), { clientX: -5, clientY: 0 }, false)).toBe(0);
        expect(trackRatio(new DOMRect(0, 0, 0, 0), { clientX: 0, clientY: 0 }, false)).toBe(0);
    });
});

describe('<hcm-timeline> size', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('badPath_itsHeightIsTheViewersWhateverThePageFontSize', async () => {
        // The viewer stacks the FAB 8 px above an 84 px timeline; the list's browser margin (1em) made it 100 px tall,
        // more on a page with larger text, and the FAB landed on it (the tour found 0 px between them on phones).
        const element = await timeline({ value: 1977 });
        element.style.fontSize = '24px';
        await element.updateComplete;

        expect(element.getBoundingClientRect().height).toBe(84);
        const track = shadowQuery(element, '.track').getBoundingClientRect();
        expect(track.top - element.getBoundingClientRect().top).toBe(8);
    });

    it('badPath_theVerticalThumbStaysInsideAtBothEnds', async () => {
        // With the list's margin the vertical track sat 16 px low and the thumb at the first year stuck out below it.
        const element = await timeline({ orientation: 'vertical', value: null });
        const box = element.getBoundingClientRect();
        const thumb = shadowQuery(element, '.thumb');

        await expect.poll(() => thumb.getBoundingClientRect().top).toBeGreaterThanOrEqual(box.top);
        element.value = 1966;
        await element.updateComplete;
        await expect.poll(() => thumb.getBoundingClientRect().bottom).toBeLessThanOrEqual(box.bottom);
    });
});

/** A city with many layer years: 1964 to 1984 and today, twenty-two stops (the review rendered such a city, 2026-11-08). */
const MANY = [...Array.from({ length: 21 }, (_, at) => 1964 + at), null];

function meets(a: DOMRect, b: DOMRect): boolean {
    return a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
}

/** The labels of the stops other than the selected one that meet the pill or another label. */
function crowdedLabels(element: HcmTimeline): string[] {
    const thumb = shadowQuery(element, '.thumb').getBoundingClientRect();
    const labels = shadowQueryAll(element, '.stop:not(.selected) .label').map((label) => ({
        text: label.textContent,
        box: label.getBoundingClientRect(),
    }));
    return labels
        .filter(({ box }, at) => meets(box, thumb) || labels.some((other, otherAt) => otherAt !== at && meets(box, other.box)))
        .map(({ text }) => text);
}

describe('<hcm-timeline> many years', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aFewYearsFitWithoutScrolling', async () => {
        const element = await timeline({ value: 1977 });

        expect(element.scrollWidth).toBe(element.clientWidth);
        expect(crowdedLabels(element)).toEqual([]);
    });

    it.each(['horizontal', 'vertical'] as const)(
        'badPath_%s_whenTheYearsDoNotFitTheCardScrollsAndKeepsTheSelectedYearInView',
        async (orientation) => {
            // The review, 2026-11-08: twenty-two stops squeezed 17 px apart; the pill hid its neighbours and the labels
            // ran into one illegible row, because the stops were shares of a card that never scrolled.
            const element = await timeline({ stops: MANY, value: 1964, orientation });
            const vertical = orientation === 'vertical';
            for (const part of shadowQueryAll(element, '.thumb, .active')) {
                part.style.transition = 'none';
            }

            expect(vertical ? element.scrollHeight > element.clientHeight : element.scrollWidth > element.clientWidth).toBe(true);
            for (const key of ['End', 'Home', 'End']) {
                press(element, key);
                await element.updateComplete;
                const view = element.getBoundingClientRect();
                const thumb = shadowQuery(element, '.thumb');
                await expect
                    .poll(() => {
                        const box = thumb.getBoundingClientRect();
                        return box.left >= view.left && box.right <= view.right && box.top >= view.top && box.bottom <= view.bottom;
                    })
                    .toBe(true);
                expect(crowdedLabels(element), `labels crowded after ${key}`).toEqual([]);
            }
        },
    );

    it('happyPath_aDragKeepsTheCardStillAndTheReleaseCentresTheYear', async () => {
        // Snapping while a drag is on would move the track under the finger, and the next move would select a later year.
        const element = await timeline({ stops: MANY, value: 1964 });
        const track = shadowQuery(element, '.track');
        const view = element.getBoundingClientRect();

        pointer(track, 'pointerdown', view.right - 60, view.top + 30);
        pointer(window, 'pointermove', view.right - 50, view.top + 30);
        await element.updateComplete;
        expect(element.hasAttribute('dragging')).toBe(true);
        expect(element.value).not.toBe(1964);
        await new Promise((resolve) => {
            requestAnimationFrame(resolve);
        });
        expect(element.scrollLeft, 'no snap while dragging').toBe(0);

        pointer(window, 'pointerup', view.right - 50, view.top + 30);
        await element.updateComplete;
        await expect.poll(() => element.scrollLeft).toBeGreaterThan(0);
    });
});
