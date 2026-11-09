import { translate } from '@hcm/shared';
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
    });

    it('badPath_aboutHoldsNoLanguageOrThemeChoice', async () => {
        // The owner (2026-11-08): Limba and Tema do not belong in About; they are the menu's Settings.
        const element = await about({ locale: 'en' });

        expect(shadowQueryAll(element, 'hcm-segmented-button')).toEqual([]);
        expect(shadowText(element)).not.toContain('Language');
        expect(shadowText(element)).not.toContain('Theme');
    });

    it('happyPath_englishAndFullScreen', async () => {
        const element = await about({ locale: 'en', fullscreen: true });

        expect(shadowText(element)).toContain('Lost Bucharest');
        expect(shadowText(element)).toContain('No cookies without consent.');
        expect(shadowQuery(element, 'hcm-dialog').hasAttribute('fullscreen')).toBe(true);
    });

    it('happyPath_itsFootShowsTheMapboxLogoAndTheMapsAttribution', async () => {
        const parts = [{ text: '© Mapbox', href: 'https://www.mapbox.com/about/maps/' }];
        const element = await about({ attribution: parts, mapboxCssUrl: 'data:text/css,' });

        const legal = shadowQuery(element, 'hcm-map-attribution') as HTMLElement & { parts: unknown; cssUrl: string; locale: string };
        expect(legal.slot).toBe('actions');
        expect([legal.parts, legal.cssUrl, legal.locale]).toEqual([parts, 'data:text/css,', 'ro']);
    });

    it('badPath_withoutAMapToCreditTheFootIsEmpty', async () => {
        const element = await about();

        expect(element.shadowRoot?.querySelector('hcm-map-attribution')).toBeNull();
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
        expect(shadowText(denied)).not.toContain('Retrage');

        const unknown = await about({ analytics: true, consent: 'unknown' });
        expect(shadowText(unknown)).not.toContain('Statistici anonime');

        const none = await about({ analytics: false, consent: 'granted' });
        expect(shadowText(none)).not.toContain('Statistici anonime');
    });

    it('happyPath_settingsHoldTheLanguageAndThemeChoices', async () => {
        const element = await about({ mode: 'settings', theme: 'dark' });
        const events = recordEvents(element, 'hcm-locale-change', 'hcm-theme-change', 'hcm-change');

        await expect.element(page.getByRole('dialog', { name: 'Setări' })).toBeVisible();
        expect(shadowText(element)).not.toContain('Mulțumiri');
        expect(themeIcons(element)).toEqual(['brightness_auto', 'light_mode', 'dark_mode']);
        await expect.element(page.getByRole('radio', { name: 'Întunecată' })).toHaveAttribute('aria-checked', 'true');
        await expect.element(page.getByRole('radio', { name: 'Română' })).toHaveAttribute('aria-checked', 'true');
        await page.getByRole('radio', { name: 'English' }).click();
        await page.getByRole('radio', { name: 'Luminoasă' }).click();

        expect(events).toEqual([
            { type: 'hcm-locale-change', detail: { locale: 'en' } },
            { type: 'hcm-theme-change', detail: { theme: 'light' } },
        ]);
    });

    it('happyPath_settingsInEnglishAndFullScreenDropTheThemeIcons', async () => {
        const element = await about({ mode: 'settings', locale: 'en', fullscreen: true });

        await expect.element(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
        // A compact screen has no room for an icon beside every theme label (the kit still shows the check mark).
        expect(themeIcons(element)).toEqual([undefined, undefined, undefined]);
    });

    it('badPath_anUnknownThemeValueIsIgnored', async () => {
        const element = await about({ mode: 'settings' });
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

describe('<hcm-about-dialog>: the statement and the help panel', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmAboutDialog();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('badPath_aCityWithNoCreditsStillHasAWayToReportAProblem', async () => {
        const element = await about({ city: { ...CITY, credits: [] } });

        const label = translate(element.locale, 'about.a11yReport');
        const link = shadowQueryAll(element, 'a').find((anchor) => anchor.textContent === label) as HTMLAnchorElement | undefined;

        expect(link?.href).toBe('https://github.com/ventura8/bucurestiuldisparut.github.io/issues');
    });

    it('happyPath_theStatementSaysWhatWorksWhatIsMissingAndHowToReport', async () => {
        const text = shadowText(await about());
        expect(text).toContain('Accesibilitate');
        expect(text).toContain('Lipsesc: o alternativă text');
        expect(text).toContain('Raportați o problemă pe GitHub');

        expect(shadowText(await about({ locale: 'en' }))).toContain('Report problems');
    });

    it('happyPath_aboutOpensTheHelpPanelWhichListsTheKeysAndThePad', async () => {
        const element = await about();
        const events = recordEvents(element, 'hcm-help-open');
        const buttons = shadowQueryAll(element, 'hcm-button');
        buttons.at(-1)?.click();
        expect(events.map((event) => event.type)).toEqual(['hcm-help-open']);

        element.mode = 'help';
        await element.updateComplete;

        await expect.element(page.getByRole('dialog', { name: 'Tastatură și gamepad' })).toBeVisible();
        expect(shadowText(element)).toContain('Anul următor și anterior');
        expect(shadowText(element)).toContain('Gamepad standard');
        expect(shadowText(element)).not.toContain('Accesibilitate');
        expect([...(element.shadowRoot?.querySelectorAll('kbd') ?? [])].map((kbd) => kbd.textContent)).toEqual([
            '.',
            ',',
            'o',
            'i',
            'n',
            'p',
            'l',
            '?',
        ]);
    });

    it('happyPath_theHelpPanelsSwitchSaysItsChoice', async () => {
        const element = await about({ mode: 'help' });
        const events = recordEvents(element, 'hcm-shortcuts-change');

        fireKitEvent(shadowQuery(element, 'hcm-switch'), 'hcm-change', { checked: false });

        expect(events.map((event) => (event as CustomEvent<unknown>).detail)).toEqual([{ enabled: false }]);
    });

    it('edge_openingHelpInAClosedDialogMovesNoFocus', async () => {
        const element = await about({ open: false });

        element.mode = 'help';
        await element.updateComplete;

        expect(element.mode).toBe('help');
    });

    it('edge_goingFromSettingsToAboutMovesNoFocus', async () => {
        const element = await about({ mode: 'settings' });
        const before = document.activeElement;

        element.mode = 'about';
        await element.updateComplete;

        expect(document.activeElement).toBe(before);
    });
});
