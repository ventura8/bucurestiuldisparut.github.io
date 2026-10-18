import { MAPBOX_TOKENS, USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import type { Page } from '@playwright/test';

import { apiText, setupText } from '../support/i18n.js';
import { followDeepLink, SetupPage, standInProviderPages } from '../support/setup-page.js';
import { seedClaimedCity, seedSetupStatus, STEPS_AT } from '../support/steps.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';
import { emulatorOrigin } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The Setup Assistant's page as a whole on a claimed map (docs/research/M2-interfaces.md §6, M2b-interfaces.md §3.2;
 * behaviour A03): `setup.status` gives every card its chip and its reason, the page opens at the first step not done,
 * and Check again runs `setup.selfTest`, whose findings the chips follow; the map is set up once billing, provisioning,
 * Mapbox and USGS are done.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

test.beforeEach(async ({ page, adminWorld, upstream }) => {
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await upstream.scenario('google.provisioned', 'server');
    await standInProviderPages(page.context(), ['https://ers.cr.usgs.gov']);
});

/** The chip of every step, by id. */
async function chips(page: Page): Promise<Record<string, string | null>> {
    const steps = page.locator('hcm-setup-step[mode="summary"], hcm-setup-step[mode="inline"]');
    const pairs = await steps.evaluateAll((elements) =>
        elements.map((element): [string, string | null] => [element.getAttribute('data-step') ?? '', element.getAttribute('data-state')]),
    );
    return Object.fromEntries(pairs);
}

test(
    'Every card shows its state and reason from setup.status; Check again runs the self-test, and the map is set up once the four required steps are done',
    { tag: ['@S-A03-HAPPY'] },
    async ({ page, lang, adminWorld, upstream, consoleErrors }) => {
        test.setTimeout(150_000);
        const owner = adminWorld.accounts.owner.uid;
        await seedSetupStatus(adminWorld.emulators, owner, {
            usgs: { state: 'invalid', checkedAt: STEPS_AT, detail: 'apiError.usgs.credentials' },
        });
        const setup = new SetupPage(page, lang);
        await setup.visit('mapbox');
        expect(await chips(page)).toMatchObject({
            billing: 'ok',
            provision: 'ok',
            mapbox: 'missing',
            usgs: 'invalid',
            analytics: 'missing',
        });
        await expect((await setup.show('usgs')).getByText(apiText(lang, 'apiError.usgs.credentials'))).toBeVisible();
        const ready = page.getByText(setupText(lang, 'adminSetup.ready'));
        await expect(ready).toHaveCount(0);

        // Mapbox, then USGS with an account whose M2M access waits for approval.
        const mapbox = await setup.show('mapbox');
        await mapbox.getByLabel(setupText(lang, 'adminSetup.mapbox.token')).fill(MAPBOX_TOKENS.bootstrap);
        await mapbox.getByRole('button', { name: setupText(lang, 'adminSetup.mapbox.save') }).click();
        await setup.expectState('mapbox', 'ok');
        const usgs = await setup.show('usgs');
        await usgs.getByLabel(setupText(lang, 'adminSetup.usgs.username')).fill(USGS_CREDENTIALS.pending.username);
        await followDeepLink(page, () =>
            usgs.getByRole('link', { name: new RegExp(`^${setupText(lang, 'adminSetup.usgs.openTokenPage')}`) }).click(),
        );
        await usgs.getByLabel(setupText(lang, 'adminSetup.usgs.token')).fill(USGS_CREDENTIALS.pending.applicationToken);
        await usgs.getByLabel(setupText(lang, 'adminSetup.usgs.token')).press('Enter');
        await setup.expectState('usgs', 'pending');
        await expect(ready).toHaveCount(0);

        // USGS approves; Check again runs the self-test, and the USGS chip follows what it found.
        await upstream.scenario('usgs.m2mApproved', 'server');
        const selfTest = page.waitForRequest(`${emulatorOrigin('functions')}/**/setup-selfTest`);
        const analyticsChecked = page.waitForResponse(`${emulatorOrigin('functions')}/**/setup-analyticsConfig`);
        await page
            .getByRole('button', { name: setupText(lang, 'adminSetup.recheck') })
            .first()
            .click();
        await selfTest;
        await setup.expectState('usgs', 'ok');
        await expect(ready).toBeVisible();
        expect(await chips(page)).toMatchObject({ billing: 'ok', provision: 'ok', mapbox: 'ok', usgs: 'ok' });

        // The page moves on to the optional analytics card, whose check says Google Analytics is not enabled yet: a
        // callable's 400, which the browser logs.
        expect((await analyticsChecked).status()).toBe(400);
        await expect.poll(() => consoleErrors.takeMatching(/setup-analyticsConfig/).length).toBeGreaterThan(0);
    },
);

test(
    'A partial setup opens at the first step that is not done',
    { tag: ['@S-A03-BAD-PARTIAL-STATE'] },
    async ({ page, lang, adminWorld }) => {
        await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid, {
            mapbox: { state: 'ok', checkedAt: STEPS_AT, user: 'e2e-mapbox' },
        });
        const setup = new SetupPage(page, lang);
        await setup.visit('usgs');

        await expect(setup.open('usgs')).toBeVisible();
        await expect(setup.open('billing')).toHaveCount(0);
        expect(await chips(page)).toMatchObject({ billing: 'ok', provision: 'ok', mapbox: 'ok', usgs: 'missing' });
    },
);
