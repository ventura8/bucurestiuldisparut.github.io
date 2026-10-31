import { OLDER_SERVER_RELEASE } from '@hcm/test-support/fakes';
import type { Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import type { EmulatorWorld } from '../../support/emulators.js';
import { apiText, setupText, shellText } from '../../support/i18n.js';
import {
    INSTALL_RELEASE,
    INSTALL_SLUG,
    installState,
    nextLook,
    recordsSettled,
    serveInstallBundle,
    submittedBuilds,
    trackRecords,
} from '../../support/install.js';
import { SetupPage } from '../../support/setup-page.js';
import { seedClaimedCity, seedSetupStatus, STEPS_AT, withConsent } from '../../support/steps.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import type { UpstreamControl } from '../../support/upstream.js';
import { E2E_PROJECT_ID } from '../../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Updates in daily use (docs/research/M6-interfaces.md §1.7; behaviours A55 and A56; findings 10 and 13 of 2026-10-25),
 * on a claimed map: a server or pipeline that Setup recorded older than the admin's own release shows Home's update tile,
 * whose link opens its Setup step; **Update the map** there (one click, and Google's consent, since daily use holds no
 * token) submits a build of the admin's release, after which the tile is gone. Without the pipeline's repository (a map
 * prepared before M6) the pipeline card asks for Prepare the project and submits nothing.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

const OK = { state: 'ok', checkedAt: STEPS_AT };
const RECORDED = STEPS_AT.toISOString();

/** `setup/status` of a map whose server and site were installed, with `install`'s other records as given. */
async function seedInstalled(page: Page, emulators: EmulatorWorld, ownerUid: string, install = {}): Promise<void> {
    await seedSetupStatus(emulators, ownerUid, {
        mapbox: { ...OK, user: 'e2e-mapbox' },
        usgs: OK,
        install: { server: { state: 'installed', checkedAt: RECORDED }, site: { state: 'installed', checkedAt: RECORDED }, ...install },
    });
    await serveInstallBundle(page);
}

/** Setup's "done" line. */
function doneLine(page: Page) {
    return page.locator('hcm-setup-page').locator('.ready');
}

async function buildsOf(upstream: UpstreamControl, target: string) {
    return (await submittedBuilds(upstream)).filter((build) => build.target === target);
}

test.beforeEach(async ({ page, adminWorld, upstream }) => {
    trackRecords(page);
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await upstream.scenario('google.provisioned', 'server');
    await upstream.scenario('google.provisioned', 'browser');
    await page.clock.install();
    await page.clock.resume();
});

// A record cut off by the page's end would hold `setup/status` in the emulator for the next test.
test.afterEach(async ({ page }) => {
    await recordsSettled(page);
});

test(
    "A server older than the admin's release: Home says an update is ready, and Update the map installs it",
    { tag: ['@S-A55-HAPPY-UPDATE'] },
    async ({ page, lang, consent, inputBudget, upstream, adminWorld }) => {
        await upstream.scenario('install.provisioned', 'browser');
        await upstream.scenario('cloud-functions.deployedOlderRelease', 'browser');
        await seedInstalled(page, adminWorld.emulators, adminWorld.accounts.owner.uid, {
            server: { state: 'updateAvailable', release: OLDER_SERVER_RELEASE, checkedAt: RECORDED },
        });
        await page.goto(adminPath(lang, 'home'));
        const tile = page.locator('li[data-reminder="installUpdate"]');
        await expect(tile).toContainText(setupText(lang, 'adminSetup.install.tileUpdate'));

        await tile.getByRole('link', { name: setupText(lang, 'adminSetup.install.tileOpen') }).click();
        const setup = new SetupPage(page, lang);
        // The tile's link opens step (d); Setup may still move on to the first step not done once `setup/status` arrives
        // (a done step that was open hands over), so the card is opened again until it shows the update.
        const update = setupText(lang, 'adminSetup.install.update', { release: INSTALL_RELEASE });
        await expect(async () => {
            await expect((await setup.show('deploy')).getByText(update)).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 30_000 });
        const deploy = setup.open('deploy');
        await withConsent(
            page,
            consent,
            deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.updateAction') }),
            inputBudget.flow('updateMap', contentFlowBudget('updateMap')),
            inputBudget.flow('updateMapConsent', 1),
        );
        await expect.poll(async () => (await buildsOf(upstream, 'server')).length).toBe(1);
        await upstream.scenario('cloud-build.finish', 'browser');
        await page.clock.fastForward(10_000);

        await expect(installState(deploy)).toContainText(setupText(lang, 'adminSetup.install.state.installed'));
        await expect
            .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['install'])
            .toMatchObject({ server: { state: 'installed', release: INSTALL_RELEASE } });
        await page
            .getByRole('link', { name: shellText(lang, 'adminShell.nav.home'), exact: true })
            .first()
            .click();
        await expect(page.locator('li[data-reminder="installUpdate"]')).toHaveCount(0);
    },
);

test(
    "A server from before M6, lacking M6's functions, offers Update the map; the claim stays done throughout",
    { tag: ['@S-A55-HAPPY-PRE-M6-UPGRADE'] },
    async ({ page, lang, consent, inputBudget, setupBudget, upstream, adminWorld }) => {
        // The live map (findings 1 and 4 of the M6 review): 61 functions of 90b31be, no release, nothing recorded yet.
        await upstream.scenario('install.provisioned', 'browser');
        await upstream.scenario('cloud-functions.preM6', 'browser');
        await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid, {
            mapbox: { ...OK, user: 'e2e-mapbox' },
            usgs: OK,
        });
        await serveInstallBundle(page);
        const setup = new SetupPage(page, lang);
        await setup.visit('pipeline');
        const deploy = await setup.show('deploy');
        await withConsent(
            page,
            consent,
            deploy.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }),
            setupBudget.inputs('deploy'),
            // Daily use holds no Google token: the look asks for one (the allowance of a click once the token is gone).
            setupBudget.consents('deploy', 1),
        );

        await expect(installState(deploy)).toContainText(setupText(lang, 'adminSetup.install.state.updateAvailable'));
        await expect(deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.server.action') })).toHaveCount(0);
        await setup.expectState('claim', 'ok');
        const update = inputBudget.flow('updateMap', contentFlowBudget('updateMap'));
        await update.click(deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.updateAction') }));
        await expect.poll(async () => (await buildsOf(upstream, 'server')).length).toBe(1);
        await upstream.scenario('cloud-build.finish', 'browser');

        await nextLook(page, installState(deploy).filter({ hasText: setupText(lang, 'adminSetup.install.state.installed') }));
        await setup.expectState('claim', 'ok');
        await expect
            .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['install'])
            .toMatchObject({ server: { state: 'installed', release: INSTALL_RELEASE } });
    },
);

test(
    'An update that stopped in an admin session offers Try again on its card, and Setup stays done meanwhile',
    { tag: ['@S-A55-BAD-UPDATE-FAILED-ADMIN', '@S-A55-HAPPY-DONE-WHILE-UPDATING'] },
    async ({ page, lang, consent, inputBudget, setupBudget, upstream, adminWorld }) => {
        await upstream.scenario('install.provisioned', 'browser');
        await upstream.scenario('cloud-functions.deployedOlderRelease', 'browser');
        await upstream.scenario('cloud-build.serverFailsAtFunctions', 'browser');
        await seedInstalled(page, adminWorld.emulators, adminWorld.accounts.owner.uid, {
            server: { state: 'updateAvailable', release: OLDER_SERVER_RELEASE, checkedAt: RECORDED },
        });
        const setup = new SetupPage(page, lang);
        await setup.visit('pipeline');
        await expect(doneLine(page)).toBeVisible();
        const deploy = await setup.show('deploy');
        await withConsent(
            page,
            consent,
            deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.updateAction') }),
            inputBudget.flow('updateMap', contentFlowBudget('updateMap')),
            inputBudget.flow('updateMapConsent', 1),
        );
        await expect.poll(async () => (await buildsOf(upstream, 'server')).length).toBe(1);

        // Under way (15 to 85 minutes in real life) and then stopped: the installed release serves, so Setup stays done.
        await upstream.scenario('cloud-build.start', 'browser');
        await nextLook(page, installState(deploy).filter({ hasText: setupText(lang, 'adminSetup.install.state.working') }));
        await expect(doneLine(page)).toBeVisible();
        await upstream.scenario('cloud-build.finish', 'browser');
        await nextLook(page, installState(deploy).filter({ hasText: setupText(lang, 'adminSetup.install.state.failed') }));
        await expect(doneLine(page)).toBeVisible();
        await setup.expectState('deploy', 'ok');
        await setup.expectState('claim', 'ok');

        // The step is done, yet the card offers Try again (finding 1 of the M6 review): one click with the live token.
        await setupBudget.inputs('deploy').click(deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.tryAgain') }));
        await expect.poll(async () => (await buildsOf(upstream, 'server')).length).toBe(2);
    },
);

test(
    'Pipeline jobs on an older release are moved to the new image and label by Update the map',
    { tag: ['@S-A56-HAPPY-UPDATE'] },
    async ({ page, lang, consent, inputBudget, upstream, adminWorld, consoleErrors }) => {
        await upstream.scenario('install.provisioned', 'browser');
        await upstream.scenario('cloud-run.pipelineJobsOlderRelease', 'browser');
        await seedInstalled(page, adminWorld.emulators, adminWorld.accounts.owner.uid, {
            pipeline: { state: 'updateAvailable', release: OLDER_SERVER_RELEASE, checkedAt: RECORDED },
        });
        const setup = new SetupPage(page, lang);
        // The recorded pipeline is done, so the page opens the next optional step first.
        await setup.visit('analytics');
        const pipeline = await setup.show('pipeline');

        await withConsent(
            page,
            consent,
            pipeline.getByRole('button', { name: setupText(lang, 'adminSetup.install.updateAction') }),
            inputBudget.flow('updateMap', contentFlowBudget('updateMap')),
            inputBudget.flow('updateMapConsent', 1),
        );
        await expect.poll(async () => (await buildsOf(upstream, 'pipeline')).length).toBe(1);
        await upstream.scenario('cloud-build.finish', 'browser');
        await page.clock.fastForward(10_000);

        await setup.expectState('pipeline', 'ok');
        await expect
            .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['install'])
            .toMatchObject({ pipeline: { state: 'installed' } });
        await expect(installState(await setup.show('pipeline'))).toContainText(setupText(lang, 'adminSetup.install.state.installed'));
        const run = (await upstream.snapshot('browser'))['cloud-run'] as {
            readonly jobSpecs: Record<string, { labels: Record<string, string> }>;
        };
        expect(run.jobSpecs[`${E2E_PROJECT_ID}/us-central1/raster-pipeline`]?.labels).toEqual({ 'hcm-release': INSTALL_SLUG });
        expect(run.jobSpecs[`${E2E_PROJECT_ID}/us-central1/raster-pipeline-xl`]?.labels).toEqual({ 'hcm-release': INSTALL_SLUG });
        // The page opened Analytics on its way (the first optional step not done): Google Analytics is not enabled yet,
        // which setup.analyticsConfig answers with a 400 when the card asks.
        consoleErrors.takeMatching(/setup-analyticsConfig/);
    },
);

test(
    'A pipeline missing beside an installed server installs from its own card once nothing is in its way',
    { tag: ['@S-A56-HAPPY-INSTALL-ALONE'] },
    async ({ page, lang, consent, setupBudget, upstream, adminWorld, consoleErrors }) => {
        // Finding 3 of the M6 review: blocked at the server's click (no repository), then fixed; nothing offered it after.
        await upstream.scenario('cloud-build.installerAccount', 'browser');
        // The server is there (installed before this admin's release, from GitHub Actions say); the pipeline is not.
        await upstream.scenario('cloud-functions.deployedOlderRelease', 'browser');
        await seedInstalled(page, adminWorld.emulators, adminWorld.accounts.owner.uid);
        const setup = new SetupPage(page, lang);
        await setup.visit('pipeline');
        const pipeline = await setup.show('pipeline');
        const recheck = pipeline.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') });
        const inputs = setupBudget.inputs('pipeline', 3);
        await withConsent(page, consent, recheck, inputs, setupBudget.consents('pipeline', 1));
        const install = pipeline.getByRole('button', { name: setupText(lang, 'adminSetup.install.pipeline.action') });
        await expect(install).toBeDisabled();

        await upstream.scenario('artifact-registry.provisioned', 'browser');
        await inputs.click(recheck);
        await expect(install).toBeEnabled();
        await inputs.click(install);

        await expect.poll(async () => (await buildsOf(upstream, 'pipeline')).length).toBe(1);
        await upstream.scenario('cloud-build.finish', 'browser');
        await page.clock.fastForward(10_000);
        await setup.expectState('pipeline', 'ok');
        // Done, the page moves on to Analytics: Google Analytics is not enabled yet, which setup.analyticsConfig answers
        // with a 400 when the card asks (after the chip turned green: the claim waits for it).
        await expect.poll(() => consoleErrors.takeMatching(/setup-analyticsConfig/).length).toBeGreaterThan(0);
    },
);

test(
    "Without the pipeline's repository the pipeline card asks for Prepare the project and submits nothing",
    { tag: ['@S-A56-BAD-NO-REPOSITORY'] },
    async ({ page, lang, consent, setupBudget, upstream, adminWorld }) => {
        // Prepare the project ran before M6: the installer's account exists, the repository `hcm` does not.
        await upstream.scenario('cloud-build.installerAccount', 'browser');
        await seedInstalled(page, adminWorld.emulators, adminWorld.accounts.owner.uid);
        const setup = new SetupPage(page, lang);
        await setup.visit('pipeline');
        const pipeline = await setup.show('pipeline');

        await withConsent(
            page,
            consent,
            pipeline.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }),
            setupBudget.inputs('pipeline', 1),
            setupBudget.consents('pipeline', 1),
        );

        await expect(pipeline.getByText(apiText(lang, 'apiError.install.noRepository', { repository: 'hcm' }))).toBeVisible();
        await expect(pipeline.getByRole('button', { name: setupText(lang, 'adminSetup.install.openProvision') })).toBeVisible();
        expect(await buildsOf(upstream, 'pipeline')).toEqual([]);
    },
);
