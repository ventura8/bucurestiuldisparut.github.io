import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AdminAuthStatePort } from '../../../src/admin/admin-port.js';
import { ADMIN_TAGS, defineAdminElements } from '../../../src/admin/define.js';
import { HcmAdminNav } from '../../../src/admin/shell/hcm-admin-nav.js';
import { shellLayout, themeTokensOf, type HcmAdminShell } from '../../../src/admin/shell/hcm-admin-shell.js';
import { noticeOf, noticeText } from '../../../src/admin/shell/text.js';
import { BASELINE_THEME } from '../../../src/theme/baseline.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, DESTINATIONS, FakeAdminApp, mount, updated } from './fake-app.js';

async function shell(app: FakeAdminApp | null, width = 1300): Promise<HcmAdminShell> {
    const element = await mount<HcmAdminShell>(html`<hcm-admin-shell .app=${app}></hcm-admin-shell>`, width);
    await updated(element);
    return element;
}

describe('<hcm-admin-shell>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aLargeWindowGetsTheExpandedRailTheTopBarAndThePage', async () => {
        const app = new FakeAdminApp(adminState({ destinations: DESTINATIONS, route: { id: 'admins', params: [] } }));
        app.pages = { admins: 'hcm-admins-page' };
        const element = await shell(app);

        const nav = deep(element, 'hcm-admin-nav') as HcmAdminNav;
        expect(nav.variant).toBe('expanded');
        expect(deep(element, '.top-bar h1').textContent).toBe('Admins');
        expect(deepAll(element, 'hcm-admins-page')).toHaveLength(1);
        expect(app.calls).toContain('setWindowClass "large"');
        expect(document.documentElement.lang).toBe('en');
        expect(await axeViolations(element)).toEqual([]);
    });

    it.each([
        [360, 'bar'],
        [700, 'rail'],
    ] as const)('happyPath_aWindow_%ipxWide_gets_%s', async (width, variant) => {
        const app = new FakeAdminApp(adminState({ destinations: DESTINATIONS }));
        const element = await shell(app, width);

        expect((deep(element, 'hcm-admin-nav') as HcmAdminNav).variant).toBe(variant);
        expect(deep(element, '.frame').dataset['nav']).toBe(variant);
    });

    it('badPath_startUpModeShowsTheBannerAndSetupOnly', async () => {
        const app = new FakeAdminApp(adminState({ auth: 'bootstrap', mode: 'bootstrap', locale: 'ro' }));
        const element = await shell(app);

        expect(deep(element, '[role="note"]').textContent).toBe(
            'Mod de pornire: harta nu are încă server, așa că pașii vorbesc direct cu Google.',
        );
        expect(document.documentElement.lang).toBe('ro');
    });

    it.each([
        ['starting', 'Loading…'],
        ['probing', 'Loading…'],
        ['signingIn', 'Continue in the Google window…'],
        ['claiming', 'Checking with Google that you own the project…'],
    ] as const)('happyPath_%s_showsWhatItWaitsFor', async (auth, text) => {
        const element = await shell(new FakeAdminApp(adminState({ auth })));

        expect(deep(element, '.loading p').textContent).toBe(text);
    });

    it.each([
        ['signedOut', 'hcm-sign-in'],
        ['claimPending', 'hcm-claim-panel'],
        ['joinPending', 'hcm-join-panel'],
        ['configMissing', 'hcm-blocked-panel'],
        ['notOwner', 'hcm-blocked-panel'],
        ['notAdmin', 'hcm-blocked-panel'],
        ['backendDown', 'hcm-blocked-panel'],
    ] as const satisfies readonly (readonly [AdminAuthStatePort, string])[])(
        'badPath_%s_showsItsPanelAndNoNavigation',
        async (auth, tag) => {
            const element = await shell(new FakeAdminApp(adminState({ auth })));

            expect(deepAll(element, tag)).toHaveLength(1);
            expect(deepAll(element, 'hcm-admin-nav')).toEqual([]);
        },
    );

    it('happyPath_theAppsStateChangesAreFollowedAndMessagesShowInTheSnackbar', async () => {
        const app = new FakeAdminApp(adminState({ auth: 'signedOut' }));
        const element = await shell(app);

        app.set({ auth: 'admin', notice: { id: 1, key: 'adminShell.route.notFound' } });
        await updated(element);
        const snackbar = deep(element, 'hcm-snackbar');
        snackbar.dispatchEvent(new CustomEvent('hcm-dismiss', { detail: { reason: 'close' } }));

        expect((snackbar as unknown as { message: string }).message).toBe('That page does not exist, so you are on Setup.');
        expect(app.named('dismissNotice')).toHaveLength(1);
    });

    it('happyPath_theConsentBannerAsksOnceAndReportsTheAnswer', async () => {
        const app = new FakeAdminApp(adminState({ analytics: true, consent: 'unknown' }));
        const element = await shell(app);

        deep(element, 'hcm-consent-banner').dispatchEvent(new CustomEvent('hcm-consent', { detail: { decision: 'granted' } }));
        app.set({ consent: 'granted' });
        await updated(element);

        expect(app.calls).toContain('setConsent "granted"');
        expect(deepAll(element, 'hcm-consent-banner')).toEqual([]);
    });

    it('happyPath_aThemeChangeIsAppliedOnce', async () => {
        const app = new FakeAdminApp(adminState());
        const element = await shell(app);
        const background = (): string => getComputedStyle(element).getPropertyValue('--md-sys-color-surface').trim();
        const light = background();

        app.set({ theme: { mode: 'dark', city: null, preview: null } });
        await updated(element);
        app.set({ busy: true });
        await updated(element);

        expect(background()).not.toBe(light);
    });

    it('badPath_anotherAppReplacesTheSubscriptionAndDisconnectingStopsIt', async () => {
        const first = new FakeAdminApp(adminState());
        const second = new FakeAdminApp(adminState({ locale: 'ro' }));
        const element = await shell(first);

        element.app = second;
        await updated(element);
        expect(first.listening).toBe(0);
        expect(second.listening).toBe(1);
        element.remove();

        expect(second.listening).toBe(0);
    });

    it('badPath_withoutAnAppItWaits', async () => {
        const element = await shell(null);

        expect(deepText(element)).toContain('Se încarcă…');
    });
});

describe('the shell helpers', () => {
    it('happyPath_aLandscapePhoneGetsTheRailAndNoTopBar', () => {
        expect(shellLayout({ widthClass: 'medium', heightClass: 'compact' })).toEqual({ nav: 'rail', topBar: false });
        expect(shellLayout({ widthClass: 'extra-large', heightClass: 'expanded' })).toEqual({ nav: 'expanded', topBar: true });
    });

    it('happyPath_thePreviewWinsOverTheCityAndTheBaselineIsTheFallback', () => {
        const city = { ...BASELINE_THEME };
        const preview = { ...BASELINE_THEME };

        expect(themeTokensOf(adminState({ theme: { mode: 'system', city, preview } }))).toBe(preview);
        expect(themeTokensOf(adminState({ theme: { mode: 'system', city, preview: null } }))).toBe(city);
        expect(themeTokensOf(adminState())).toBe(BASELINE_THEME);
    });

    it('happyPath_everyNoticeFamilyIsTranslated', () => {
        expect(noticeText('en', 'apiError.unavailable')).not.toBe('apiError.unavailable');
        expect(noticeText('ro', 'adminSetup.import.done')).not.toBe('adminSetup.import.done');
        expect(noticeText('en', 'adminShell.auth.signIn')).toBe('Sign in with Google');
        expect(noticeOf('en', null)).toBe('');
    });

    it('happyPath_defineRegistersEveryAdminElementOnce', () => {
        const registry = new Map<string, CustomElementConstructor>();
        const fake = {
            get: (tag: string) => registry.get(tag),
            define: (tag: string, element: CustomElementConstructor) => registry.set(tag, element),
        } as unknown as CustomElementRegistry;

        defineAdminElements(fake);
        defineAdminElements(fake);

        expect(ADMIN_TAGS.every((tag) => registry.has(tag))).toBe(true);
        expect(registry.get('hcm-admin-nav')).toBe(HcmAdminNav);
    });
});
