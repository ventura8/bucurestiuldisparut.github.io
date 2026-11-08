import { OLDER_SERVER_RELEASE } from '@hcm/test-support/fakes';
import type { Locator } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { setupText } from '../../support/i18n.js';
import { INSTALL_RELEASE, installState, recordsSettled, serveInstallBundle, submittedBuilds, trackRecords } from '../../support/install.js';
import { SetupPage } from '../../support/setup-page.js';
import { seedClaimedCity, seedSetupStatus, STEPS_AT, withConsent } from '../../support/steps.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * A build recorded at work is not shown as running before a look (behaviour A55; the live finding of 2026-11-08): the
 * owner's last visit recorded the server's and the pipeline's builds at work (`setup/status.install`), and the builds
 * ended since. Right after Setup opened, steps d and d3 said "Installing" with every step "next" until Cloud Build's
 * answer turned them into "An update is ready", so a visitor could wait for an install that was not running. A recorded
 * build at work is now shown as being checked, with when it was last seen, until a look says where it is.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

const OK = { state: 'ok', checkedAt: STEPS_AT };
const RECORDED = STEPS_AT.toISOString();
/** What the owner's last visit recorded: both builds at work. */
const AT_WORK = { state: 'working', release: OLDER_SERVER_RELEASE, buildId: '0e2e0b1d-0001', checkedAt: RECORDED } as const;

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
        install: { server: AT_WORK, pipeline: { ...AT_WORK, buildId: '0e2e0b1d-0002' }, site: { state: 'installed', checkedAt: RECORDED } },
    });
    await serveInstallBundle(page);
    await page.clock.install();
    await page.clock.resume();
});

// A record cut off by the page's end would hold `setup/status` in the emulator for the next test.
test.afterEach(async ({ page }) => {
    await recordsSettled(page);
});

/** The card says it is checking, when the build was last seen, and neither "Installing" nor the build's steps. */
async function expectChecking(card: Locator, lang: 'ro' | 'en'): Promise<void> {
    await expect(installState(card)).toContainText(setupText(lang, 'adminSetup.install.state.checking'));
    await expect(installState(card)).toHaveAttribute('data-state', 'checking');
    await expect(card.getByText(setupText(lang, 'adminSetup.install.state.working'), { exact: true })).toHaveCount(0);
    await expect(card.locator('.build-steps')).toHaveCount(0);
}

test(
    'A build recorded at work is shown as being checked, and the look shows the update that is ready',
    { tag: ['@S-A55-HAPPY-RECORDED-BUILD-CHECKED'] },
    async ({ page, lang, consent, setupBudget }) => {
        const setup = new SetupPage(page, lang);
        await setup.visit('pipeline');
        const deploy = await setup.show('deploy');
        await expectChecking(deploy, lang);
        await expectStateSound(page, adminVisit('setup.install-checking', lang));

        await withConsent(
            page,
            consent,
            deploy.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }),
            setupBudget.inputs('deploy'),
            setupBudget.consents('deploy', 1),
        );
        await expect(installState(deploy)).toContainText(setupText(lang, 'adminSetup.install.state.updateAvailable'));
        await expect(deploy.getByText(setupText(lang, 'adminSetup.install.update', { release: INSTALL_RELEASE }))).toBeVisible();
        await expect(deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.updateAction') })).toBeVisible();
    },
);

test(
    'Without a look, a build recorded at work never reads as running, however long the page stays open',
    { tag: ['@S-A55-BAD-RECORDED-BUILD-NOT-RUNNING'] },
    async ({ page, lang, upstream }) => {
        const setup = new SetupPage(page, lang);
        await setup.visit('pipeline');
        const deploy = await setup.show('deploy');
        await expectChecking(deploy, lang);
        // When the build was last seen (the date as the page formats it), and how to see where it is now.
        const [seen = ''] = setupText(lang, 'adminSetup.install.lastSeenRunning', { date: '|' }).split('|');
        await expect(deploy.getByText(seen.trim())).toBeVisible();

        await page.clock.fastForward(120_000);
        await expectChecking(await setup.show('deploy'), lang);
        await expectChecking(await setup.show('pipeline'), lang);
        expect(await submittedBuilds(upstream)).toEqual([]);
    },
);
