import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineHcmSegmentedButton, type HcmSegmentedButton, type SegmentOption } from '../../src/components/segmented-button.js';
import { cleanup, fixture, press, recordEvents } from '../helpers.js';

defineHcmSegmentedButton();

const THEMES: readonly SegmentOption[] = [
    { value: 'system', label: 'Sistem', icon: 'brightness_auto' },
    { value: 'light', label: 'Luminos', icon: 'light_mode' },
    { value: 'dark', label: 'Întunecat' },
];

function group(value: string): Promise<HcmSegmentedButton> {
    return fixture<HcmSegmentedButton>(html`<hcm-segmented-button .options=${THEMES} value=${value} label="Temă"></hcm-segmented-button>`);
}

function radios(element: HcmSegmentedButton): HTMLElement[] {
    return [...(element.shadowRoot?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
}

describe('<hcm-segmented-button>', () => {
    afterEach(cleanup);

    it('happyPath_aRadioGroupWithOneTabStopOnTheSelection', async () => {
        const element = await group('light');

        await expect.element(page.getByRole('radiogroup', { name: 'Temă' })).toBeVisible();
        await expect.element(page.getByRole('radio', { name: 'Luminos' })).toBeChecked();
        expect(radios(element).map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
        expect(radios(element)[1]?.querySelector('hcm-icon')?.getAttribute('name')).toBe('check');
        expect(radios(element)[2]?.querySelector('hcm-icon')).toBeNull();
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aClickSelectsAndReports', async () => {
        const element = await group('system');
        const changes = recordEvents(element, 'hcm-change');

        await userEvent.click(page.getByRole('radio', { name: 'Întunecat' }));
        await userEvent.click(page.getByRole('radio', { name: 'Întunecat' }));

        expect(changes).toEqual([{ value: 'dark' }]);
    });

    it('happyPath_arrowsWrapAndHomeEndJump', async () => {
        const element = await group('system');
        const changes = recordEvents<{ value: string }>(element, 'hcm-change');
        const radioGroup = element.shadowRoot?.querySelector('[role="radiogroup"]') ?? element;

        for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'End', 'Home']) {
            press(radioGroup, key);
        }
        await element.updateComplete;
        await element.updateComplete;

        expect(changes.map((detail) => detail.value)).toEqual(['dark', 'system', 'light', 'system', 'dark', 'system']);
        expect(element.shadowRoot?.activeElement?.getAttribute('data-value')).toBe('system');
    });

    it('badPath_withoutASelectionTheFirstSegmentIsTheTabStop', async () => {
        const element = await group('none');
        const changes = recordEvents(element, 'hcm-change');
        const radioGroup = element.shadowRoot?.querySelector('[role="radiogroup"]') ?? element;

        expect(radios(element).map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
        const unhandled = press(radioGroup, 'Enter');
        press(radioGroup, 'ArrowRight');

        expect(unhandled.defaultPrevented).toBe(false);
        expect(changes).toEqual([{ value: 'light' }]);
    });

    it('badPath_noOptionsRendersAnEmptyGroup', async () => {
        const element = await fixture<HcmSegmentedButton>(html`<hcm-segmented-button label="Empty"></hcm-segmented-button>`);

        expect(radios(element)).toEqual([]);
    });
});
