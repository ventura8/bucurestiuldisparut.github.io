import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_ABOUT_DIALOG_TAG, HcmAboutDialog, defineHcmAboutDialog } from '../../src/viewer/hcm-about-dialog.js';
import { defineKitDoubles, fireKitEvent, mountElement, recordEvents, shadowQuery, shadowQueryAll, shadowText } from './doubles.js';
import { testManifest } from './fixtures.js';

const CITY = testManifest().city;

/** The icons the theme choice passes to the kit's segmented button, per option. */
function themeIcons(element: HcmAboutDialog): (string | undefined)[] {
    const theme = shadowQueryAll(element, 'hcm-segmented-button').at(-1) as unknown as {
        readonly options: readonly { readonly icon?: string }[];
    };
    return theme.options.map((option) => option.icon);
}

async function about(properties: Partial<HcmAboutDialog> = {}): Promise<HcmAboutDialog> {
    return mountElement<HcmAboutDialog>(HCM_ABOUT_DIALOG_TAG, { open: true, city: CITY, engineVersion: '1.4.2', ...properties });
}

describe('<hcm-about-dialog>', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmAboutDialog();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aboutCreditsPrivacyAndEngineInRomanian', async () => {
        const element = await about();

        await expect.element(page.getByRole('dialog', { name: 'Despre' })).toBeVisible();
        const text = shadowText(element);
        expect(text).toContain('București dispărut');
        expect(text).toContain('Mulțumiri');
        expect(text).toContain('Fotografii: arhiva A');
        expect(text).toContain('Fără cookie-uri fără acord.');
        expect(text).toContain('Motor: Historic City Map 1.4.2');
        expect(element.shadowRoot?.querySelector('strong')?.textContent).toBe('Despre');
        await expect.element(page.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
        expect(themeIcons(element)).toEqual(['brightness_auto', 'light_mode', 'dark_mode']);
    });

    it('happyPath_englishAndFullScreen', async () => {
        const element = await about({ locale: 'en', fullscreen: true });

        expect(shadowText(element)).toContain('Lost Bucharest');
        expect(shadowText(element)).toContain('No cookies without consent.');
        expect(shadowQuery(element, 'hcm-dialog').hasAttribute('fullscreen')).toBe(true);
        // A compact screen has no room for an icon beside every theme label (the kit still shows the check mark).
        expect(themeIcons(element)).toEqual([undefined, undefined, undefined]);
    });

    it('badPath_emptyCreditsHideTheirSection', async () => {
        const element = await about({ city: { ...CITY, credits: [] } });

        expect(shadowText(element)).not.toContain('Mulțumiri');
    });

    it('happyPath_grantedConsentCanBeWithdrawn', async () => {
        const element = await about({ analytics: true, consent: 'granted' });
        const events = recordEvents(element, 'hcm-consent');

        expect(shadowText(element)).toContain('Statistici anonime: permise');
        await page.getByRole('button', { name: 'Retrage acordul pentru statistici' }).click();

        expect(events).toEqual([{ type: 'hcm-consent', detail: { decision: 'denied' } }]);
    });

    it('badPath_deniedUnknownOrNoAnalyticsShowNoWithdrawButton', async () => {
        const denied = await about({ analytics: true, consent: 'denied' });
        expect(shadowText(denied)).toContain('Statistici anonime: refuzate');
        expect(denied.shadowRoot?.querySelector('hcm-button')).toBeNull();

        const unknown = await about({ analytics: true, consent: 'unknown' });
        expect(shadowText(unknown)).not.toContain('Statistici anonime');

        const none = await about({ analytics: false, consent: 'granted' });
        expect(shadowText(none)).not.toContain('Statistici anonime');
    });

    it('happyPath_languageAndThemeChoices', async () => {
        const element = await about({ theme: 'dark' });
        const events = recordEvents(element, 'hcm-locale-change', 'hcm-theme-change', 'hcm-change');

        await expect.element(page.getByRole('radio', { name: 'Întunecată' })).toHaveAttribute('aria-checked', 'true');
        await expect.element(page.getByRole('radio', { name: 'Română' })).toHaveAttribute('aria-checked', 'true');
        await page.getByRole('radio', { name: 'English' }).click();
        await page.getByRole('radio', { name: 'Luminoasă' }).click();

        expect(events).toEqual([
            { type: 'hcm-locale-change', detail: { locale: 'en' } },
            { type: 'hcm-theme-change', detail: { theme: 'light' } },
        ]);
    });

    it('badPath_anUnknownThemeValueIsIgnored', async () => {
        const element = await about();
        const events = recordEvents(element, 'hcm-theme-change');

        fireKitEvent(shadowQuery(element, 'hcm-segmented-button:last-of-type'), 'hcm-change', { value: 'sepia' });

        expect(events).toEqual([]);
    });

    it('badPath_noCityLeavesTheDialogEmpty', async () => {
        const element = await about({ city: null });

        expect(element.shadowRoot?.querySelector('.details')).toBeNull();
        expect(customElements.get(HCM_ABOUT_DIALOG_TAG)).toBe(HcmAboutDialog);
    });
});
