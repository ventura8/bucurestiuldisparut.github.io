import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { HcmAccountMenu } from '../../../src/admin/shell/hcm-account-menu.js';
import type { HcmAdminNav } from '../../../src/admin/shell/hcm-admin-nav.js';
import type { HcmSegmentedButton } from '../../../src/components/segmented-button.js';
import type { HcmSheet } from '../../../src/components/sheet.js';
import type { HcmSwitch } from '../../../src/components/switch.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, DESTINATIONS, FakeAdminApp, mount, updated } from './fake-app.js';

function links(nav: Element): HTMLAnchorElement[] {
    return deepAll(nav, 'a.item') as HTMLAnchorElement[];
}

describe('<hcm-admin-nav>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theCompactBarHoldsFourDestinationsAndMoreOpensTheRest', async () => {
        const nav = await mount<HcmAdminNav>(
            html`<hcm-admin-nav variant="bar" current="jobs" locale="en" .destinations=${DESTINATIONS}></hcm-admin-nav>`,
            360,
        );

        expect(links(nav).map((link) => link.getAttribute('href'))).toEqual([
            '#/setup',
            '#/photos',
            '#/pois',
            '#/layers',
            '#/jobs',
            '#/admins',
        ]);
        const more = deep(nav, 'button.item');
        expect(more.textContent).toContain('More');
        more.click();
        await updated(nav);
        const sheet = deep(nav, 'hcm-sheet') as HcmSheet;
        expect(sheet.open).toBe(true);
        expect(more.getAttribute('aria-expanded')).toBe('true');
        const jobs = links(nav).find((link) => link.getAttribute('href') === '#/jobs');
        expect(jobs?.getAttribute('aria-current')).toBe('page');

        jobs?.addEventListener('click', (event) => {
            event.preventDefault();
        });
        jobs?.click();
        await updated(nav);

        expect(sheet.open).toBe(false);
        expect(await axeViolations(nav)).toEqual([]);
    });

    it('badPath_aBarWithFewDestinationsHasNoMore', async () => {
        const nav = await mount<HcmAdminNav>(html`<hcm-admin-nav variant="bar" .destinations=${DESTINATIONS.slice(0, 2)}></hcm-admin-nav>`);

        expect(deepAll(nav, 'button.item')).toEqual([]);
        expect(links(nav)[0]?.getAttribute('aria-current')).toBe('page');
    });

    it('happyPath_theSheetsOwnCloseClosesIt', async () => {
        const nav = await mount<HcmAdminNav>(html`<hcm-admin-nav variant="bar" .destinations=${DESTINATIONS}></hcm-admin-nav>`);
        deep(nav, 'button.item').click();
        await updated(nav);

        deep(nav, 'hcm-sheet').dispatchEvent(new CustomEvent('hcm-close', { bubbles: true, composed: true }));
        await updated(nav);

        expect(nav.moreOpen).toBe(false);
    });

    it.each(['rail', 'expanded'] as const)('happyPath_the_%s_listsEveryDestinationInRomanianWithAFoot', async (variant) => {
        const nav = await mount<HcmAdminNav>(
            html`<hcm-admin-nav .variant=${variant} current="admins" locale="ro" .destinations=${DESTINATIONS}
                ><span slot="foot">foot</span></hcm-admin-nav
            >`,
        );

        expect(links(nav)).toHaveLength(6);
        expect(deepText(nav)).toContain('Administratori');
        expect(deep(nav, 'nav').getAttribute('aria-label')).toBe('Navigare');
        expect(deep(nav, 'slot[name="foot"]')).toBeTruthy();
        expect(await axeViolations(nav)).toEqual([]);
    });
});

describe('<hcm-account-menu>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    async function opened(app: FakeAdminApp): Promise<HcmAccountMenu> {
        const menu = await mount<HcmAccountMenu>(html`<hcm-account-menu .app=${app} .state=${app.state}></hcm-account-menu>`);
        deep(menu, 'hcm-icon-button').click();
        await updated(menu);
        return menu;
    }

    it('happyPath_languageThemeConsentAndSignOut', async () => {
        const app = new FakeAdminApp(adminState({ analytics: true, consent: 'unknown' }));
        const menu = await opened(app);
        const [language, theme] = deepAll(menu, 'hcm-segmented-button') as HcmSegmentedButton[];

        language?.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'ro' } }));
        language?.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'en' } }));
        theme?.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'dark' } }));
        theme?.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'sepia' } }));
        const consent = deep(menu, 'hcm-switch') as HcmSwitch;
        consent.dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: true } }));
        consent.dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: false } }));
        deepAll(menu, 'hcm-button').at(-1)?.click();

        expect(deepText(menu)).toContain('Signed in as owner@e2e.test');
        expect(app.calls).toEqual([
            'setLocale "ro"',
            'setLocale "en"',
            'setTheme "dark"',
            'setConsent "granted"',
            'setConsent "denied"',
            'signOut',
        ]);
        expect(menu.open).toBe(false);
    });

    it('badPath_withoutAUserOrAnalyticsTheMenuHoldsThePreferencesOnly', async () => {
        const app = new FakeAdminApp(adminState({ user: null, analytics: false, locale: 'ro' }));
        const menu = await opened(app);

        expect(deepAll(menu, 'hcm-switch')).toEqual([]);
        expect(deepAll(menu, 'hcm-button')).toEqual([]);
        expect(deepText(menu)).toContain('Automată');
        deep(menu, 'hcm-dialog').dispatchEvent(new CustomEvent('hcm-close', { detail: { returnValue: 'cancel' } }));
        await updated(menu);
        expect(menu.open).toBe(false);
    });

    it('badPath_withoutStateOrAppItDoesNothing', async () => {
        const empty = await mount<HcmAccountMenu>(html`<hcm-account-menu></hcm-account-menu>`);
        const orphan = await mount<HcmAccountMenu>(html`<hcm-account-menu .state=${adminState({ analytics: true })}></hcm-account-menu>`);
        deep(orphan, 'hcm-icon-button').click();
        await updated(orphan);

        deepAll(orphan, 'hcm-segmented-button')[0]?.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'ro' } }));
        deepAll(orphan, 'hcm-segmented-button')[1]?.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'dark' } }));
        deep(orphan, 'hcm-switch').dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: true } }));
        deepAll(orphan, 'hcm-button').at(-1)?.click();

        expect(deepText(empty)).toBe('');
        expect(orphan.open).toBe(false);
    });
});
