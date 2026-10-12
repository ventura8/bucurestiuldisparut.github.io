import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineHcmSlider, fractionAt, type HcmSlider } from '../../src/components/slider.js';
import { cleanup, fixture, nextFrame, press, recordEvents, release, shadowPart } from '../helpers.js';

defineHcmSlider();

/** A 216 px track: the handle centre travels 200 px, from x + 8 to x + 208. */
function slider(attributes = ''): Promise<HcmSlider> {
    const template =
        attributes === 'disabled'
            ? html`<hcm-slider disabled label="Opacity" style="width: 216px"></hcm-slider>`
            : html`<hcm-slider label="Opacity" value="80" value-text="80 %" style="width: 216px"></hcm-slider>`;
    return fixture<HcmSlider>(template);
}

function pointer(target: EventTarget, type: string, clientX: number, button = 0): void {
    target.dispatchEvent(new PointerEvent(type, { clientX, button, bubbles: true, composed: true, cancelable: true }));
}

function trackX(element: HcmSlider, fraction: number): number {
    return shadowPart(element, '.track').getBoundingClientRect().left + 8 + fraction * 200;
}

describe('<hcm-slider>', () => {
    afterEach(cleanup);

    it('happyPath_exposesTheSliderRoleAndItsValues', async () => {
        const element = await slider();
        const handle = page.getByRole('slider', { name: 'Opacity' });

        await expect.element(handle).toHaveAttribute('aria-valuenow', '80');
        await expect.element(handle).toHaveAttribute('aria-valuetext', '80 %');
        await expect.element(handle).toHaveAttribute('aria-valuemin', '0');
        await expect.element(handle).toHaveAttribute('aria-valuemax', '100');
        expect(shadowPart(element, '.track').style.getPropertyValue('--fraction')).toBe('0.8');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_theThinHandleStillHasA48PixelTouchTarget', async () => {
        // The e2e tour measured the 4 px handle as a touch target on compact windows.
        const element = await slider();
        const target = getComputedStyle(shadowPart(element, '.handle'), '::after');

        expect(Number.parseFloat(target.width)).toBeGreaterThanOrEqual(48);
        expect(Number.parseFloat(target.height)).toBeGreaterThanOrEqual(48);
    });

    it('happyPath_keysMoveByStepPageAndToTheEnds', async () => {
        const element = await slider();
        const inputs = recordEvents<{ value: number }>(element, 'hcm-input');
        const changes = recordEvents<{ value: number }>(element, 'hcm-change');
        const handle = shadowPart(element, '.handle');

        for (const key of ['ArrowRight', 'ArrowUp', 'PageDown', 'ArrowLeft', 'ArrowDown', 'PageUp', 'Home', 'End']) {
            press(handle, key);
        }
        release(handle, 'End');

        expect(inputs.map((detail) => detail.value)).toEqual([81, 82, 72, 71, 70, 80, 0, 100]);
        expect(changes).toEqual([{ value: 100 }]);
    });

    it('happyPath_realKeyPressesFromTheFocusedHandle', async () => {
        const element = await slider();
        const changes = recordEvents<{ value: number }>(element, 'hcm-change');

        element.focus();
        await userEvent.keyboard('{ArrowLeft}');
        await element.updateComplete;

        expect(changes).toEqual([{ value: 79 }]);
        await expect.element(page.getByRole('slider', { name: 'Opacity' })).toHaveAttribute('aria-valuenow', '79');
    });

    it('badPath_keysPastEitherEndKeepTheValueAndFireNoChange', async () => {
        const element = await slider();
        element.value = 100;
        await element.updateComplete;
        const inputs = recordEvents(element, 'hcm-input');
        const changes = recordEvents(element, 'hcm-change');
        const handle = shadowPart(element, '.handle');

        press(handle, 'ArrowRight');
        press(handle, 'PageUp');
        release(handle, 'PageUp');
        const tab = press(handle, 'Tab');
        release(handle, 'Tab');

        expect(element.value).toBe(100);
        expect(inputs).toEqual([]);
        expect(changes).toEqual([]);
        expect(tab.defaultPrevented).toBe(false);
    });

    it('happyPath_dragFiresOneInputPerFrameAndAChangeOnRelease', async () => {
        const element = await slider();
        const inputs = recordEvents<{ value: number }>(element, 'hcm-input');
        const changes = recordEvents<{ value: number }>(element, 'hcm-change');

        pointer(shadowPart(element, '.track'), 'pointerdown', trackX(element, 0.4));
        pointer(document, 'pointermove', trackX(element, 0.45));
        pointer(document, 'pointermove', trackX(element, 0.5));
        await nextFrame();
        pointer(document, 'pointermove', trackX(element, 0.25));
        pointer(document, 'pointerup', trackX(element, 0.25));
        pointer(document, 'pointermove', trackX(element, 0.9));

        expect(inputs.map((detail) => detail.value)).toEqual([50, 25]);
        expect(changes).toEqual([{ value: 25 }]);
        expect(element.shadowRoot?.activeElement).toBe(shadowPart(element, '.handle'));
    });

    it('badPath_aPressOnTheCurrentValueFiresNothing', async () => {
        const element = await slider();
        const changes = recordEvents<{ value: number }>(element, 'hcm-change');

        pointer(shadowPart(element, '.track'), 'pointerdown', trackX(element, 0.8));
        pointer(document, 'pointercancel', trackX(element, 0.8));
        await nextFrame();

        expect(changes).toEqual([]);
        expect(element.value).toBe(80);
    });

    it('badPath_aDisabledSliderIgnoresKeysAndPointers', async () => {
        const element = await slider('disabled');
        const inputs = recordEvents(element, 'hcm-input');
        const handle = shadowPart(element, '.handle');

        press(handle, 'ArrowRight');
        pointer(shadowPart(element, '.track'), 'pointerdown', trackX(element, 0.5));

        expect(inputs).toEqual([]);
        expect(handle.getAttribute('tabindex')).toBe('-1');
        expect(handle.getAttribute('aria-disabled')).toBe('true');
        expect(handle.hasAttribute('aria-valuetext')).toBe(false);
    });

    it('badPath_aSecondaryButtonDoesNotDrag', async () => {
        const element = await slider();
        const inputs = recordEvents(element, 'hcm-input');

        pointer(shadowPart(element, '.track'), 'pointerdown', trackX(element, 0.1), 2);
        await nextFrame();

        expect(inputs).toEqual([]);
    });

    it('badPath_removingTheSliderMidDragStopsListening', async () => {
        const element = await slider();
        const inputs = recordEvents(element, 'hcm-input');

        pointer(shadowPart(element, '.track'), 'pointerdown', trackX(element, 0.3));
        element.remove();
        pointer(document, 'pointermove', trackX(element, 0.6));
        await nextFrame();

        expect(inputs).toEqual([]);
    });

    it('badPath_anEmptyRangeDrawsAnEmptyTrack', async () => {
        const element = await fixture<HcmSlider>(html`<hcm-slider min="5" max="5" value="5" label="Fixed"></hcm-slider>`);

        expect(shadowPart(element, '.track').style.getPropertyValue('--fraction')).toBe('0');
    });
});

describe('fractionAt', () => {
    it('happyPath_mapsTheHandleTravelToZeroToOne', () => {
        const rect = new DOMRect(100, 0, 216, 48);

        expect([fractionAt(108, rect), fractionAt(208, rect), fractionAt(308, rect)]).toEqual([0, 0.5, 1]);
    });

    it('badPath_clampsOutsideAndHandlesATinyTrack', () => {
        const rect = new DOMRect(100, 0, 216, 48);

        expect([fractionAt(0, rect), fractionAt(900, rect), fractionAt(5, new DOMRect(0, 0, 10, 48))]).toEqual([0, 1, 0]);
    });
});
