import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_HELLO_TAG, HcmHello, defineHcmHello } from '../src/hcm-hello.js';

async function mount(attributes: Readonly<Record<string, string>> = {}): Promise<HcmHello> {
    defineHcmHello();
    const element = document.createElement(HCM_HELLO_TAG);
    for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, value);
    }
    document.body.append(element);
    await element.updateComplete;
    return element;
}

describe('<hcm-hello>', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_greetsInRomanianByDefault', async () => {
        await mount();

        await expect.element(page.getByRole('status')).toHaveTextContent('Salut, București!');
    });

    it('happyPath_followsLocaleAndNameAttributes', async () => {
        await mount({ locale: 'en-GB', name: 'Bucharest' });

        await expect.element(page.getByRole('status')).toHaveTextContent('Hello, Bucharest!');
    });

    it('happyPath_rerendersWhenAPropertyChanges', async () => {
        const element = await mount();

        element.name = 'Cotroceni';
        await element.updateComplete;

        await expect.element(page.getByRole('status')).toHaveTextContent('Salut, Cotroceni!');
    });

    it('badPath_unsupportedLocaleFallsBackToRomanian', async () => {
        await mount({ locale: 'fr' });

        await expect.element(page.getByRole('status')).toHaveTextContent('Salut, București!');
    });

    it('badPath_definingTwiceKeepsTheFirstRegistration', () => {
        defineHcmHello();
        defineHcmHello();

        expect(customElements.get(HCM_HELLO_TAG)).toBe(HcmHello);
    });
});
