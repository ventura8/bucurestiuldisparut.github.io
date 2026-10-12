import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineHcmFabMenu, type FabMenuItem, type HcmFabMenu } from '../../src/components/fab-menu.js';
import { cleanup, deepFocus, fixture, part, press, recordEvents, shadowPart } from '../helpers.js';

defineHcmFabMenu();

const ITEMS: readonly FabMenuItem[] = [
    { value: 'layers', label: 'Straturi', icon: 'layers' },
    { value: 'share', label: 'Distribuie', icon: 'share' },
    { value: 'about', label: 'Despre', icon: 'info' },
];

async function menu(): Promise<HcmFabMenu> {
    const box = await fixture<HTMLElement>(
        html`<div>
            <hcm-fab-menu label="Meniu" close-label="Închide meniul" .items=${ITEMS}></hcm-fab-menu><button id="outside">Outside</button>
        </div>`,
    );
    const element = part(box, 'hcm-fab-menu') as HcmFabMenu;
    await element.updateComplete;
    return element;
}

function focusedText(): string {
    return (deepFocus()?.textContent ?? '').trim();
}

describe('<hcm-fab-menu>', () => {
    afterEach(cleanup);

    it('happyPath_theFabOpensTheMenuAndFocusesTheFirstItem', async () => {
        const element = await menu();
        const toggles = recordEvents(element, 'hcm-toggle');
        const fab = page.getByRole('button', { name: 'Meniu' });

        await expect.element(fab).toHaveAttribute('aria-expanded', 'false');
        await userEvent.click(fab);
        await element.updateComplete;

        await expect.element(page.getByRole('menu', { name: 'Meniu' })).toBeVisible();
        await expect.element(page.getByRole('button', { name: 'Închide meniul' })).toHaveAttribute('aria-expanded', 'true');
        expect(focusedText()).toBe('Straturi');
        expect(toggles).toEqual([{ open: true }]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_arrowsHomeEndAndChoosingAnItem', async () => {
        const element = await menu();
        const selections = recordEvents(element, 'hcm-select');
        shadowPart(element, '.fab').click();
        await element.updateComplete;
        const list = shadowPart(element, '[role="menu"]');

        press(list, 'ArrowDown');
        expect(focusedText()).toBe('Distribuie');
        press(list, 'ArrowUp');
        press(list, 'ArrowUp');
        expect(focusedText()).toBe('Despre');
        press(list, 'Home');
        expect(focusedText()).toBe('Straturi');
        press(list, 'End');
        await userEvent.keyboard('{Enter}');
        await element.updateComplete;

        expect(selections).toEqual([{ value: 'about' }]);
        expect(element.open).toBe(false);
        expect(deepFocus()).toBe(shadowPart(element, '.fab'));
    });

    it('happyPath_escapeClosesAndReturnsToTheFab', async () => {
        const element = await menu();
        shadowPart(element, '.fab').click();
        await element.updateComplete;

        press(shadowPart(element, '[role="menu"]'), 'Escape');
        await element.updateComplete;

        expect(element.open).toBe(false);
        expect(deepFocus()).toBe(shadowPart(element, '.fab'));
    });

    it('badPath_focusLeavingTheMenuClosesItButMovingInsideDoesNot', async () => {
        const element = await menu();
        const toggles = recordEvents(element, 'hcm-toggle');
        shadowPart(element, '.fab').click();
        await element.updateComplete;

        shadowPart(element, '.fab').focus();
        expect(element.open).toBe(true);
        shadowPart(element, '[role="menuitem"]').focus();
        part(document, '#outside').focus();
        await element.updateComplete;

        expect(toggles).toEqual([{ open: true }, { open: false }]);
        expect(element.shadowRoot?.querySelector('[role="menu"]')).toBeNull();
    });

    it('badPath_keysOnAClosedFabDoNothing', async () => {
        const element = await menu();
        const fab = shadowPart(element, '.fab');

        const escape = press(fab, 'Escape');
        const arrow = press(fab, 'ArrowDown');

        expect(escape.defaultPrevented).toBe(false);
        expect(arrow.defaultPrevented).toBe(false);
        expect(element.open).toBe(false);
    });
});
