import { MAPBOX_TOKENS, USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import type { Page } from '@playwright/test';

import { expectStateSound } from '../../support/state-check.js';
import { adminVisit } from '../../tour/states.js';
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

test(
    'A failing self-test check names what to fix and links its step; every other check shows its own state',
    { tag: ['@S-A03-BAD-SELFTEST-FAILURE'] },
    async ({ page, lang, adminWorld, upstream, consoleErrors }) => {
        await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
        // The functions' account may not read the secrets: Secret Manager refuses it.
        await upstream.fail('secret-manager', 'forbidden', 'server');
        const setup = new SetupPage(page, lang);
        await setup.visit('mapbox');
        const selfTest = page.waitForResponse(`${emulatorOrigin('functions')}/**/setup-selfTest`);
        await page
            .getByRole('button', { name: setupText(lang, 'adminSetup.recheck') })
            .first()
            .click();
        await selfTest;

        const list = page.getByRole('region', { name: setupText(lang, 'adminSetup.selfTest.title') });
        await expect(list.locator('[data-check]')).toHaveCount(9);
        const secrets = list.locator('[data-check="secrets"]');
        await expect(secrets).toHaveAttribute('data-state', 'invalid');
        await expect(secrets).toContainText(apiText(lang, 'apiError.secrets.unavailable'));
        await expect(list.locator('[data-check="firestore"]')).toHaveAttribute('data-state', 'ok');
        await expect(list.locator('[data-check="private-bucket"]')).toHaveAttribute('data-state', 'ok');
        await expectStateSound(page, adminVisit('setup-self-test', lang));

        // The fix: the step that grants the role.
        const fix = secrets.getByRole('link', {
            name: setupText(lang, 'adminSetup.selfTest.fix', { step: setupText(lang, 'adminSetup.step.provision') }),
        });
        await expect(fix).toHaveAttribute('href', '#/setup/provision');
        await fix.click();
        await expect(setup.open('provision')).toBeVisible();
        // A refused secret is a warning of the server's own, not an error the page logs; nothing else failed.
        consoleErrors.takeMatching(/status of 4\d\d/);
    },
);
