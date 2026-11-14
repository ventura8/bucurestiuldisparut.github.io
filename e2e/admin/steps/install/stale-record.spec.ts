import { OLDER_SERVER_RELEASE } from '@hcm/test-support/fakes';

import { setupText } from '../../support/i18n.js';
import { recordsSettled, serveInstallBundle, submittedBuilds, trackRecords } from '../../support/install.js';
import { SetupPage } from '../../support/setup-page.js';
import { seedClaimedCity, seedSetupStatus, STEPS_AT, withConsent } from '../../support/steps.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Update the map beside a build only a record says is at work (behaviour A55; the live admin of 2026-11-13, 23:45): the
 * server was behind and the pipeline was recorded at work at 23:20, with no Google token on the page to look. Step d showed
 * no Update the map and no word why; the owner had to find Check again on step d3. Now the button shows, and its click looks
 * at the recorded build with its one consent first: an ended build lets the server's update go, one still at work holds it
 * (finding 71: Provision's record waits for the server's build).
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

const OK = { state: 'ok', checkedAt: STEPS_AT };
const RECORDED = STEPS_AT.toISOString();

test.beforeEach(async ({ page, adminWorld, upstream }) => {
    trackRecords(page);
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await upstream.scenario('google.provisioned', 'server');
    await upstream.scenario('google.provisioned', 'browser');
    await upstream.scenario('install.provisioned', 'browser');
    await upstream.scenario('cloud-functions.deployedOlderRelease', 'browser');
    await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid, {
        mapbox: { ...OK, user: 'e2e-mapbox' },
        usgs: OK,
        install: {
            server: { state: 'installed', release: OLDER_SERVER_RELEASE, checkedAt: RECORDED },
            pipeline: { state: 'working', release: OLDER_SERVER_RELEASE, buildId: '0e2e0b1d-0002', checkedAt: RECORDED },
            site: { state: 'installed', checkedAt: RECORDED },
        },
    });
    await serveInstallBundle(page);
});

// A record cut off by the page's end would hold `setup/status` in the emulator for the next test.
test.afterEach(async ({ page }) => {
    await recordsSettled(page);
});

async function serverBuilds(upstream: Parameters<typeof submittedBuilds>[0]): Promise<number> {
    return (await submittedBuilds(upstream)).filter((build) => build.target === 'server').length;
}

test(
    'Update the map shows beside a build only a record says is at work; its click looks at it first, then updates the server',
    { tag: ['@S-A55-HAPPY-UPDATE-STALE-RECORD'] },
    async ({ page, lang, consent, setupBudget, upstream }) => {
        const setup = new SetupPage(page, lang);
        await page.goto(adminPath(lang, 'setup'));
        const deploy = await setup.show('deploy');
        const update = deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.updateAction') });
        await expect(update).toBeVisible();

        await withConsent(page, consent, update, setupBudget.inputs('deploy'), setupBudget.consents('deploy', 1));

        await expect.poll(() => serverBuilds(upstream)).toBe(1);
    },
);

test(
    'A recorded build the click finds still at work holds the update: nothing is submitted',
    { tag: ['@S-A55-BAD-UPDATE-STALE-RECORD'] },
    async ({ page, lang, consent, setupBudget, upstream }) => {
        await upstream.scenario('cloud-build.pipelineQueuedElsewhere', 'browser');
        const setup = new SetupPage(page, lang);
        await page.goto(adminPath(lang, 'setup'));
        const deploy = await setup.show('deploy');
        const update = deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.updateAction') });
        await expect(update).toBeVisible();

        await withConsent(page, consent, update, setupBudget.inputs('deploy'), setupBudget.consents('deploy', 1));

        await expect(update).toHaveCount(0);
        expect(await serverBuilds(upstream)).toBe(0);
    },
);
