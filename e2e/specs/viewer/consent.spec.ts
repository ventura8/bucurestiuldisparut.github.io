import type { Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { E2E_FIREBASE_APP, E2E_MEASUREMENT_ID, E2E_TILESET_LAYER, SITE_ORIGIN } from '../../fixtures/world.js';
import { mockedHostKind } from '../../mock-apis/hosts.js';
import type { RecordedCall } from '../../mock-apis/server.js';
import type { MockApis } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { chooseMenuItem, openLayers, openViewer, serveManifest, t, viewer, visibilitySwitch } from '../../support/viewer.js';

/**
 * Analytics consent (behaviour V19, PLAN Addendum 2): with a GA4 measurement id and the Firebase app ids in the
 * manifest the viewer asks first; before an answer, and after "Decline", no Google or Firebase host is contacted (the
 * firewall fixture would also fail the test on any other host). "Accept" loads the real Firebase Analytics SDK, whose
 * events reach the GA4 mock (mock-apis/gtag.ts) without personal data; withdrawing in About stops them.
 */

const LAYER_LABEL = 'Corona 1966 (e2e)';

/** The fixture with analytics configured: the measurement id and the Firebase web app ids (CR-9). */
function analyticsManifest(): Json {
    const manifest = siteManifestData({ analytics: true });
    const city = manifest['city'] as Json;
    city['analytics'] = { ...(city['analytics'] as Json), firebase: { ...E2E_FIREBASE_APP } };
    return manifest;
}

async function analyticsCalls(mockApis: MockApis): Promise<RecordedCall[]> {
    return (await mockApis.calls()).filter((call) => mockedHostKind(call.host) === 'analytics');
}

/** The GA4 events the mock received, by name, with their parameters. */
async function gaEvents(mockApis: MockApis): Promise<{ name: string; params: URLSearchParams }[]> {
    return (await analyticsCalls(mockApis))
        .filter((call) => call.path === '/g/collect')
        .map((call) => {
            const params = new URLSearchParams(call.query);
            return { name: params.get('en') ?? '', params };
        });
}

function banner(page: Page) {
    return viewer(page).locator('hcm-consent-banner');
}

async function openWithAnalytics(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await serveManifest(page, analyticsManifest());
    await openViewer(page, { lang, hash: '15/44.37000/25.97000' });
}

async function toggleLayer(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await openLayers(page, lang);
    await visibilitySwitch(page, lang, LAYER_LABEL).click();
    const close = page.getByRole('button', { name: t(lang, 'action.close'), exact: true }).filter({ visible: true });
    if ((await close.count()) > 0) {
        await close.first().click();
    }
}

test(
    'Before an answer and after Decline nothing reaches Google or Firebase',
    { tag: '@S-V19-BAD-NO-REQUEST-BEFORE-CONSENT' },
    async ({ page, lang, mockApis }) => {
        await openWithAnalytics(page, lang);
        await expect(banner(page).getByRole('heading', { name: t(lang, 'consent.title') })).toBeVisible();
        await expect(banner(page)).toContainText(t(lang, 'consent.body'));
        await toggleLayer(page, lang);
        await expect.poll(() => page.evaluate(() => location.hash)).toContain(`layers=${E2E_TILESET_LAYER.id}`);
        expect(await analyticsCalls(mockApis), 'no analytics request before consent').toEqual([]);

        await page.getByRole('button', { name: t(lang, 'consent.decline'), exact: true }).click();
        await expect(banner(page)).toHaveCount(0);
        await toggleLayer(page, lang);
        await page.reload();
        await expect(page.getByRole('button', { name: t(lang, 'action.menu'), exact: true })).toBeVisible();
        await expect(banner(page)).toHaveCount(0);
        expect(await analyticsCalls(mockApis), 'no analytics request after Decline').toEqual([]);
        expect(await page.evaluate(() => Object.keys(window).filter((key) => key === 'dataLayer' || key === 'gtag'))).toEqual([]);
    },
);

test(
    'Accept loads GA4, which receives the page view and a layer toggle without personal data',
    { tag: '@S-V19-HAPPY' },
    async ({ page, lang, mockApis }) => {
        await openWithAnalytics(page, lang);
        await page.getByRole('button', { name: t(lang, 'consent.accept'), exact: true }).click();
        await expect(banner(page)).toHaveCount(0);

        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('page_view');
        const loads = (await analyticsCalls(mockApis)).map((call) => `${call.host}${call.path}`);
        expect(loads).toContain('www.googletagmanager.com/gtag/js');
        await toggleLayer(page, lang);
        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('layer_toggle');

        const events = await gaEvents(mockApis);
        const toggle = events.find((event) => event.name === 'layer_toggle');
        expect(toggle?.params.get('ep.layer_id')).toBe(E2E_TILESET_LAYER.id);
        expect(toggle?.params.get('ep.visible')).toBe('true');
        for (const event of events) {
            expect(event.params.get('tid')).toBe(E2E_MEASUREMENT_ID);
            expect(event.params.get('dl'), 'the page location without its hash or query').toBe(`${SITE_ORIGIN}/bucharest/`);
        }
        const sent = (await analyticsCalls(mockApis)).map((call) => `${call.path}${call.query} ${call.body}`).join('\n');
        // The hash holds the visitor's view (15/44.37000/25.97000) and the visible layers: none of it is sent.
        expect(sent).not.toContain('44.37');
        expect(sent).not.toContain('layers=');
    },
);

test(
    'Withdrawing consent in About stops every later analytics request',
    { tag: '@S-V19-BAD-WITHDRAWN' },
    async ({ page, lang, mockApis }) => {
        await openWithAnalytics(page, lang);
        await page.getByRole('button', { name: t(lang, 'consent.accept'), exact: true }).click();
        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('page_view');

        await chooseMenuItem(page, lang, t(lang, 'about.title'));
        const about = viewer(page).locator('hcm-about-dialog');
        await expect(about).toContainText(t(lang, 'consent.granted'));
        await about.getByRole('button', { name: t(lang, 'consent.withdraw') }).click();
        await expect(about).toContainText(t(lang, 'consent.denied'));
        await page.keyboard.press('Escape');
        const before = (await gaEvents(mockApis)).length;

        await toggleLayer(page, lang);
        await expect.poll(() => page.evaluate(() => location.hash)).toContain(`layers=${E2E_TILESET_LAYER.id}`);
        await page.reload();
        await expect(page.getByRole('button', { name: t(lang, 'action.menu'), exact: true })).toBeVisible();
        await expect(banner(page)).toHaveCount(0);
        expect(await gaEvents(mockApis)).toHaveLength(before);
    },
);

test(
    'A completed share is one GA4 share event; a cancelled share is none',
    { tag: '@S-V19-HAPPY-SHARE-EVENT' },
    async ({ page, lang, mockApis }) => {
        await page.addInitScript(() => {
            Navigator.prototype.share = function share(): Promise<void> {
                const outcome = (window as unknown as Record<string, unknown>)['hcmE2eShare'];
                return outcome === 'cancel' ? Promise.reject(new DOMException('Share canceled', 'AbortError')) : Promise.resolve();
            };
        });
        await openWithAnalytics(page, lang);
        await page.getByRole('button', { name: t(lang, 'consent.accept'), exact: true }).click();
        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('page_view');

        await page.evaluate(() => {
            (window as unknown as Record<string, unknown>)['hcmE2eShare'] = 'cancel';
        });
        await chooseMenuItem(page, lang, t(lang, 'action.share'));
        await page.evaluate(() => {
            (window as unknown as Record<string, unknown>)['hcmE2eShare'] = 'ok';
        });
        await chooseMenuItem(page, lang, t(lang, 'action.share'));

        await expect.poll(async () => (await gaEvents(mockApis)).filter((event) => event.name === 'share').length).toBe(1);
        await toggleLayer(page, lang);
        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('layer_toggle');
        expect((await gaEvents(mockApis)).filter((event) => event.name === 'share')).toHaveLength(1);
    },
);
