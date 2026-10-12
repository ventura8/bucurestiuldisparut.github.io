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

    it('happyPath_aWideContainerKeepsEveryLabelOnOneLine', async () => {
        const options: readonly SegmentOption[] = [
            { value: 'system', label: 'Ca sistemul', icon: 'brightness_auto' },
            { value: 'light', label: 'Luminoasă', icon: 'light_mode' },
            { value: 'dark', label: 'Întunecată', icon: 'dark_mode' },
        ];
        const element = await fixture<HcmSegmentedButton>(
            html`<hcm-segmented-button .options=${options} value="system" label="Temă"></hcm-segmented-button>`,
        );
        await document.fonts.ready;

        // One line of label-large is 20 px: a wrapped label would be 40 px tall inside its 40 px segment.
        const labels = radios(element).map((radio) => radio.querySelector('span')?.getBoundingClientRect().height);
        expect(labels).toEqual([20, 20, 20]);
        expect(radios(element).map((radio) => radio.getBoundingClientRect().height)).toEqual([40, 40, 40]);
    });

    it('badPath_aNarrowContainerWrapsALongLabelInsteadOfScrollingSideways', async () => {
        const options: readonly SegmentOption[] = [
            { value: 'system', label: 'Ca sistemul de operare al acestui telefon mobil' },
            { value: 'light', label: 'Da' },
            { value: 'dark', label: 'Nu' },
        ];
        const wrapper = await fixture<HTMLElement>(
            html`<div style="inline-size: 260px">
                <hcm-segmented-button .options=${options} value="light" label="Temă"></hcm-segmented-button>
            </div>`,
        );
        const element = wrapper.querySelector('hcm-segmented-button');
        await element?.updateComplete;
        await document.fonts.ready;

        const [long, short] = element === null ? [] : radios(element);
        expect(wrapper.scrollWidth).toBeLessThanOrEqual(260);
        expect(long?.getBoundingClientRect().height ?? 0).toBeGreaterThan(40);
        expect(short?.getBoundingClientRect().height).toBe(long?.getBoundingClientRect().height);
        for (const radio of element === null ? [] : radios(element)) {
            const box = radio.getBoundingClientRect();
            const label = radio.querySelector('span')?.getBoundingClientRect();
            expect(label?.left).toBeGreaterThanOrEqual(box.left);
            expect(label?.right).toBeLessThanOrEqual(box.right);
        }
    });

    it('badPath_noOptionsRendersAnEmptyGroup', async () => {
        const element = await fixture<HcmSegmentedButton>(html`<hcm-segmented-button label="Empty"></hcm-segmented-button>`);

        expect(radios(element)).toEqual([]);
    });
});
