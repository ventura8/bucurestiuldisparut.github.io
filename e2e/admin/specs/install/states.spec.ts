import { OLDER_SERVER_RELEASE } from '@hcm/test-support/fakes';
import type { Locator, Page } from '@playwright/test';

import type { InputFlow } from '../../../support/budget.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import type { GoogleConsent } from '../../support/consent.js';
import type { EmulatorWorld } from '../../support/emulators.js';
import { setupText } from '../../support/i18n.js';
import {
    installState,
    recordsSettled,
    seedPublishedMap,
    serveInstallBundle,
    submittedBuilds,
    trackRecords,
} from '../../support/install.js';
import { SetupPage } from '../../support/setup-page.js';
import { seedClaimedCity, seedSetupStatus, STEPS_AT } from '../../support/steps.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import type { UpstreamControl } from '../../support/upstream.js';
import { ADMIN_ORIGIN } from '../../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The M6 installer's states of the tour (docs/research/M6-interfaces.md §6.3; e2e/admin/specs/install/states.ts) at the
 * admin tier's five projects, each reached as the owner meets it on a claimed map (Google's consent from the card's own
 * button: daily use holds no token) and checked by the generic layout and accessibility checkers. The behaviours
 * themselves are e2e/admin/steps/install/*.spec.ts, in English at one window.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

const OK = { state: 'ok', checkedAt: STEPS_AT };

/** Every click and consent of a test: the states, not the budgets, are under test here (the steps' specs count them). */
interface Inputs {
    readonly clicks: InputFlow;
    readonly consents: InputFlow;
}

async function consentFrom(page: Page, consent: GoogleConsent, button: Locator, inputs: Inputs): Promise<void> {
    const popup = await consent.opened(page, () => inputs.clicks.click(button));
    await popup.allow(inputs.consents);
}

async function buildCount(upstream: UpstreamControl, target: string): Promise<number> {
    return (await submittedBuilds(upstream)).filter((build) => build.target === target).length;
}

/** The fake Cloud Build moves every build on, and the cards look again. */
async function play(page: Page, upstream: UpstreamControl, scenario: 'start' | 'finish'): Promise<void> {
    await upstream.scenario(`cloud-build.${scenario}`, 'browser');
    await page.clock.fastForward(10_000);
}

test.beforeEach(async ({ page, adminWorld, upstream }) => {
    trackRecords(page);
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid, { mapbox: { ...OK, user: 'e2e-mapbox' }, usgs: OK });
    await upstream.scenario('google.provisioned', 'server');
    await upstream.scenario('google.provisioned', 'browser');
    await upstream.scenario('install.provisioned', 'browser');
    await serveInstallBundle(page);
    await page.clock.install();
    await page.clock.resume();
});

// A record cut off by the page's end would hold `setup/status` in the emulator for the next test.
test.afterEach(async ({ page }) => {
    await recordsSettled(page);
});

/**
 * Waits until `setup/status.install` holds what the cards last saw (`setup.recordCloud`), so no write of this test is
 * still under way when the next test resets the emulators.
 */
async function recorded(emulators: EmulatorWorld, install: Readonly<Record<string, { readonly state: string }>>): Promise<void> {
    await expect.poll(async () => (await emulators.document('setup/status'))?.['install']).toMatchObject(install);
}

/** Setup with `step`'s card open, looked at with the owner's consent (its Check again). */
async function lookedAt(page: Page, lang: 'ro' | 'en', consent: GoogleConsent, step: 'deploy' | 'pipeline' | 'site', inputs: Inputs) {
    const setup = new SetupPage(page, lang);
    // The first step not done is the imagery pipeline (Mapbox and USGS are): the page opens it, then the test the card.
    await setup.visit('pipeline');
    const card = await setup.show(step);
    await consentFrom(page, consent, card.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }), inputs);
    return { setup, card };
}

test("Install the server: ready, then at work with its steps and the functions' count; the pipeline at work", async ({
    page,
    lang,
    consent,
    inputBudget,
    upstream,
    adminWorld,
}) => {
    const inputs = { clicks: inputBudget.flow('tour', 3), consents: inputBudget.flow('tourConsents', 1) };
    const { setup, card } = await lookedAt(page, lang, consent, 'deploy', inputs);
    const install = card.getByRole('button', { name: setupText(lang, 'adminSetup.install.server.action') });
    await expect(install).toBeEnabled();
    await expectStateSound(page, adminVisit('setup.install-ready', lang));

    await inputs.clicks.click(install);
    await expect.poll(() => buildCount(upstream, 'pipeline')).toBe(1);
    await play(page, upstream, 'start');
    await expect(installState(card)).toContainText(setupText(lang, 'adminSetup.install.state.working'));
    await expectStateSound(page, adminVisit('setup.install-working', lang));

    const pipeline = await setup.show('pipeline');
    await expect(installState(pipeline)).toContainText(setupText(lang, 'adminSetup.install.state.working'));
    await expectStateSound(page, adminVisit('setup.pipeline-working', lang));
    await recorded(adminWorld.emulators, { server: { state: 'working' }, pipeline: { state: 'working' } });
});

test('Install the server waiting for Google, then stopped with its log; the pipeline stopped', async ({
    page,
    lang,
    consent,
    inputBudget,
    upstream,
    adminWorld,
}) => {
    await upstream.scenario('cloud-build.serverRetriesExhausted', 'browser');
    await upstream.scenario('cloud-build.pipelineFailsAtBuild', 'browser');
    const inputs = { clicks: inputBudget.flow('tour', 3), consents: inputBudget.flow('tourConsents', 1) };
    const { setup, card } = await lookedAt(page, lang, consent, 'deploy', inputs);
    await inputs.clicks.click(card.getByRole('button', { name: setupText(lang, 'adminSetup.install.server.action') }));
    await expect.poll(() => buildCount(upstream, 'pipeline')).toBe(1);

    await play(page, upstream, 'start');
    await expect(installState(card)).toContainText(setupText(lang, 'adminSetup.install.state.retrying'));
    await expectStateSound(page, adminVisit('setup.install-retrying', lang));

    await play(page, upstream, 'finish');
    await expect(card.locator('pre.log')).toBeVisible();
    await expectStateSound(page, adminVisit('setup.install-failed', lang));

    const pipeline = await setup.show('pipeline');
    await expect(pipeline.locator('pre.log')).toContainText('build failed');
    await expectStateSound(page, adminVisit('setup.pipeline-failed', lang));
    await recorded(adminWorld.emulators, { server: { state: 'failed' }, pipeline: { state: 'failed' } });
});

test("A server older than the admin's release offers Update the map", async ({
    page,
    lang,
    consent,
    inputBudget,
    upstream,
    adminWorld,
}) => {
    await upstream.scenario('cloud-functions.deployedOlderRelease', 'browser');
    const inputs = { clicks: inputBudget.flow('tour', 1), consents: inputBudget.flow('tourConsents', 1) };
    const { setup, card } = await lookedAt(page, lang, consent, 'deploy', inputs);

    await expect(card.getByRole('button', { name: setupText(lang, 'adminSetup.install.updateAction') })).toBeVisible();
    // A look on step (d) leaves the claim done (finding 4 of the M6 review: it read Waiting here, and (e) to (i) closed).
    await setup.expectState('claim', 'ok');
    await expectStateSound(page, adminVisit('setup.install-update', lang));
    await recorded(adminWorld.emulators, { server: { state: 'updateAvailable' } });
});

test('A server newer than this admin offers nothing', async ({ page, lang, consent, inputBudget, upstream, adminWorld }) => {
    await upstream.scenario('cloud-functions.deployedNewerRelease', 'browser');
    const inputs = { clicks: inputBudget.flow('tour', 1), consents: inputBudget.flow('tourConsents', 1) };
    const { card } = await lookedAt(page, lang, consent, 'deploy', inputs);

    await expect(installState(card)).toContainText(setupText(lang, 'adminSetup.install.state.newerInstalled'));
    await expectStateSound(page, adminVisit('setup.install-newer', lang));
    await recorded(adminWorld.emulators, { server: { state: 'newerInstalled' } });
});

test('The imagery pipeline missing beside an installed server offers its own Install the pipeline', async ({
    page,
    lang,
    consent,
    inputBudget,
    upstream,
    adminWorld,
}) => {
    // The server is there (installed before this admin's release); the pipeline is not.
    await upstream.scenario('cloud-functions.deployedOlderRelease', 'browser');
    await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid, {
        mapbox: { ...OK, user: 'e2e-mapbox' },
        usgs: OK,
        install: { server: { state: 'installed', checkedAt: STEPS_AT.toISOString() } },
    });
    const inputs = { clicks: inputBudget.flow('tour', 1), consents: inputBudget.flow('tourConsents', 1) };
    const { card } = await lookedAt(page, lang, consent, 'pipeline', inputs);

    await expect(card.getByRole('button', { name: setupText(lang, 'adminSetup.install.pipeline.action') })).toBeEnabled();
    await expectStateSound(page, adminVisit('setup.pipeline-install', lang));
});

test('Publish the map: off while nothing is published, ready once the city is, then published', async ({
    page,
    lang,
    consent,
    inputBudget,
    upstream,
    adminWorld,
}) => {
    await upstream.scenario('google.deployed', 'browser');
    await page.route(`${ADMIN_ORIGIN}/release.json`, async (route) => {
        const { hosting } = (await upstream.snapshot('browser'))['cloud-build'] as { readonly hosting: unknown };
        await route.fulfill({ json: hosting ?? { release: 'dev', variant: 'start-up' } });
    });
    const inputs = { clicks: inputBudget.flow('tour', 3), consents: inputBudget.flow('tourConsents', 1) };
    const { setup, card } = await lookedAt(page, lang, consent, 'site', inputs);
    const publish = card.getByRole('button', { name: setupText(lang, 'adminSetup.install.site.action') });
    await expect(card.getByText(setupText(lang, 'adminSetup.install.offReason'))).toBeVisible();
    await expectStateSound(page, adminVisit('setup.site-blocked', lang));

    await seedPublishedMap(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await inputs.clicks.click(card.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }));
    await expect(publish).toBeEnabled();
    await expectStateSound(page, adminVisit('setup.site-ready', lang));

    await inputs.clicks.click(publish);
    await expect.poll(() => buildCount(upstream, 'site')).toBe(1);
    await play(page, upstream, 'finish');
    await setup.expectState('site', 'ok');
    const published = await setup.show('site');
    await expect(published.getByRole('link', { name: new RegExp(setupText(lang, 'adminSetup.install.site.open')) })).toBeVisible();
    await expectStateSound(page, adminVisit('setup.site-published', lang));
    await recorded(adminWorld.emulators, { site: { state: 'installed' } });
});

test('Home: an update of the map is ready, with the link to its step', async ({ page, lang, adminWorld }) => {
    await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid, {
        mapbox: { ...OK, user: 'e2e-mapbox' },
        usgs: OK,
        install: {
            server: { state: 'updateAvailable', release: OLDER_SERVER_RELEASE, checkedAt: STEPS_AT.toISOString() },
            site: { state: 'installed', checkedAt: STEPS_AT.toISOString() },
        },
    });
    await page.goto(adminPath(lang, 'home'));

    const tile = page.locator('li[data-reminder="installUpdate"]');
    await expect(tile.getByRole('link', { name: setupText(lang, 'adminSetup.install.tileOpen') })).toHaveAttribute(
        'href',
        '#/setup/deploy',
    );
    await expectStateSound(page, adminVisit('home.update-tile', lang));
});
