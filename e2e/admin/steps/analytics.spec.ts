import type { Locator, Page } from '@playwright/test';

import { GOOGLE_SCOPES } from '../../../packages/admin/src/google/scopes.js';
import { projectCity } from '../support/content.js';
import { apiText, setupText } from '../support/i18n.js';
import { seedPhotosCity } from '../support/photos.js';
import { followDeepLink, SetupPage, standInProviderPages } from '../support/setup-page.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The Setup Assistant's analytics and crash reports step (docs/research/M2b-interfaces.md §3.3 g; behaviour A22) on a
 * claimed, provisioned map, its owner signed in: `setup.analyticsConfig` detects Google Analytics through Firebase
 * Management (the server's world of the fake upstreams); the GA4 stream setting and the crash e-mail switch are the
 * owner's own Google calls (the browser's world), each after its consent; the crash panel lists `telemetry.listGroups`.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

/** When the claim created the city (a fixed time). */
const AT = new Date('2026-10-01T09:00:00.000Z');

test.beforeEach(async ({ page, adminWorld, upstream }) => {
    await seedPhotosCity(projectCity(adminWorld.emulators, adminWorld.accounts.owner.uid), AT);
    await upstream.scenario('google.provisioned', 'both');
    await standInProviderPages(page.context(), ['https://console.firebase.google.com']);
});

async function analyticsCard(page: Page, lang: 'ro' | 'en'): Promise<Locator> {
    const setup = new SetupPage(page, lang);
    await setup.visit();
    return setup.show('analytics');
}

test(
    'Google Analytics not enabled: the card says so with the Firebase console link, which starts the 15 s watch',
    { tag: ['@S-A22-BAD-ANALYTICS-NOT-ENABLED'] },
    async ({ page, lang, consoleErrors }) => {
        await page.clock.install();
        await page.clock.resume();
        const card = await analyticsCard(page, lang);

        await expect(card.getByText(apiText(lang, 'apiError.analytics.notEnabled'))).toBeVisible();
        await expect(card.getByText(setupText(lang, 'adminSetup.analytics.enableHow'))).toBeVisible();
        const link = card.getByRole('link', { name: new RegExp(`^${setupText(lang, 'adminSetup.link.gcp.firebaseConsole')}`) });
        await expect(link).toHaveAttribute('href', /^https:\/\/console\.firebase\.google\.com\//);
        await followDeepLink(page, () => link.click());
        await expect(card.getByRole('status').filter({ hasText: setupText(lang, 'adminSetup.analytics.watching') })).toBeVisible();
        expect(consoleErrors.takeMatching(/status of 400/).length).toBeGreaterThan(0);
    },
);

test(
    'A server account without the Firebase viewer role: the card names the role and nothing is written',
    { tag: ['@S-A22-BAD-MISSING-ROLE'] },
    async ({ page, lang, adminWorld, upstream, consoleErrors }) => {
        await upstream.fail('firebase-management', 'forbidden', 'server');
        const card = await analyticsCard(page, lang);

        await expect(
            card.getByRole('alert').filter({ hasText: apiText(lang, 'apiError.cloud.permission', { role: 'roles/firebase.viewer' }) }),
        ).toBeVisible();
        expect(await adminWorld.emulators.document('cities/bucharest')).not.toHaveProperty('analytics');
        expect(consoleErrors.takeMatching(/status of 400/).length).toBeGreaterThan(0);
    },
);

test(
    'Error Reporting down: the crash panel says so with Retry while the rest of the card works; Retry lists the reports',
    { tag: ['@S-A22-BAD-ERROR-REPORTING-UNAVAILABLE'] },
    async ({ page, lang, upstream, consoleErrors }) => {
        await upstream.scenario('firebase-management.analyticsLinked', 'server');
        await upstream.fail('error-reporting', 'unavailable', 'server');
        const card = await analyticsCard(page, lang);

        await expect(card.getByText(setupText(lang, 'adminSetup.analytics.measurementId', { id: 'G-E2E0000000' }))).toBeVisible();
        const panel = card.locator('hcm-crash-groups');
        await expect(panel.getByRole('alert')).toContainText(apiText(lang, 'apiError.errorReporting.unavailable'));
        await expect(card.getByRole('button', { name: setupText(lang, 'adminSetup.analytics.streamSetting') })).toBeEnabled();
        expect(consoleErrors.takeMatching(/status of 503/).length).toBeGreaterThan(0);

        await upstream.fail('error-reporting', null, 'server');
        await panel.getByRole('button', { name: setupText(lang, 'adminSetup.retry') }).click();
        await expect(panel.getByText(setupText(lang, 'adminSetup.crashes.none'))).toBeVisible();
        await expect(panel.getByRole('alert')).toHaveText('');
    },
);

test(
    'Without a GA4 stream the stream setting asks to enable Google Analytics first and patches nothing',
    { tag: ['@S-A22-BAD-NO-STREAM'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        // The server sees Analytics linked; the owner's own Google calls find no stream yet.
        await upstream.scenario('firebase-management.analyticsLinked', 'server');
        const card = await analyticsCard(page, lang);
        const stream = card.getByRole('button', { name: setupText(lang, 'adminSetup.analytics.streamSetting') });
        const streamConsent = await consent.opened(page, () => setupBudget.inputs('analytics').click(stream));
        expect(await streamConsent.requestedScopes()).toEqual([GOOGLE_SCOPES.analyticsEdit]);
        await streamConsent.allow(setupBudget.consents('analytics'));

        await expect(card.getByRole('alert').filter({ hasText: setupText(lang, 'adminSetup.analytics.noStream') })).toBeVisible();
        const patches = (await upstream.calls('browser')).filter((call) => call.method === 'PATCH');
        expect(patches).toEqual([]);
        consoleErrors.takeMatching(/status of 404/);
    },
);

test(
    'The crash e-mail switch turns the alert policy off and on, one click each and one consent in all',
    { tag: ['@S-A22-HAPPY-CRASH-ALERTS'] },
    async ({ page, lang, consent, setupBudget, upstream }) => {
        await upstream.scenario('firebase-management.analyticsLinked', 'both');
        await upstream.scenario('monitoring.crashAlertsProvisioned', 'browser');
        const card = await analyticsCard(page, lang);
        const emails = card.getByRole('switch', { name: setupText(lang, 'adminSetup.analytics.crashEmails') });
        await expect(emails).toBeChecked();
        const inputs = setupBudget.inputs('analytics', 1);

        const switchConsent = await consent.opened(page, () => inputs.click(emails));
        expect(await switchConsent.requestedScopes()).toEqual([GOOGLE_SCOPES.cloudPlatform]);
        await switchConsent.allow(setupBudget.consents('analytics'));
        await expect(emails).not.toBeChecked();
        await inputs.click(emails);
        await expect(emails).toBeChecked();

        const patched = (await upstream.calls('browser', 'monitoring')).filter((call) => call.method === 'PATCH');
        expect(patched.map((call) => (JSON.parse(call.body) as { enabled: boolean }).enabled)).toEqual([false, true]);
    },
);
