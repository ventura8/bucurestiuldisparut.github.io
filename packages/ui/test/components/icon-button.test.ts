import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineHcmIconButton, type HcmIconButton } from '../../src/components/icon-button.js';
import { cleanup, fixture, recordEvents, shadowPart } from '../helpers.js';

defineHcmIconButton();

describe('<hcm-icon-button>', () => {
    afterEach(cleanup);

    it('happyPath_theLabelIsTheAccessibleName', async () => {
        const button = await fixture<HcmIconButton>(html`<hcm-icon-button icon="close" label="Închide"></hcm-icon-button>`);
        const clicks = recordEvents(button, 'click');
        const changes = recordEvents(button, 'hcm-change');

        await userEvent.click(page.getByRole('button', { name: 'Închide' }));

        expect(clicks).toHaveLength(1);
        expect(changes).toEqual([]);
        expect(shadowPart(button, 'button').hasAttribute('aria-pressed')).toBe(false);
        expect(shadowPart(button, 'button').hasAttribute('aria-expanded')).toBe(false);
        expect(await axeViolations(button)).toEqual([]);
    });

    it('happyPath_expandedSaysWhatTheButtonCollapses', async () => {
        const button = await fixture<HcmIconButton>(html`<hcm-icon-button icon="chevron_left" label="Collapse layers"></hcm-icon-button>`);
        button.expanded = true;
        await button.updateComplete;

        await expect.element(page.getByRole('button', { name: 'Collapse layers' })).toHaveAttribute('aria-expanded', 'true');
        button.expanded = false;
        await expect.element(page.getByRole('button', { name: 'Collapse layers' })).toHaveAttribute('aria-expanded', 'false');
        expect(await axeViolations(button)).toEqual([]);
    });

    it('happyPath_aToggleFlipsSelectedAndFillsItsIcon', async () => {
        const button = await fixture<HcmIconButton>(
            html`<hcm-icon-button toggle icon="layers" label="Layers" variant="tonal"></hcm-icon-button>`,
        );
        const changes = recordEvents(button, 'hcm-change');
        const control = page.getByRole('button', { name: 'Layers' });

        await userEvent.click(control);
        await expect.element(control).toHaveAttribute('aria-pressed', 'true');
        expect(shadowPart(button, 'hcm-icon').hasAttribute('filled')).toBe(true);
        button.focus();
        await userEvent.keyboard(' ');

        expect(changes).toEqual([{ selected: true }, { selected: false }]);
        expect(button.selected).toBe(false);
    });

    it('badPath_aDisabledToggleNeverChanges', async () => {
        const button = await fixture<HcmIconButton>(html`<hcm-icon-button toggle disabled icon="layers" label="Layers"></hcm-icon-button>`);
        const changes = recordEvents(button, 'hcm-change');

        (shadowPart(button, 'button') as HTMLButtonElement).click();

        expect(changes).toEqual([]);
        await expect.element(page.getByRole('button', { name: 'Layers' })).toBeDisabled();
    });
});
