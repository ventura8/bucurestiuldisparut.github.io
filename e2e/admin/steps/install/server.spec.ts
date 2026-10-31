import { NEWER_SERVER_RELEASE, PLANTED_LOG_SECRETS, registryFunctions } from '@hcm/test-support/fakes';
import type { Locator } from '@playwright/test';

import { apiText, setupText, shellText, templatePattern } from '../../support/i18n.js';
import {
    INSTALL_RELEASE,
    INSTALL_SLUG,
    installState,
    nextLook,
    preparedProject,
    serveInstallBundle,
    submittedBuilds,
} from '../../support/install.js';
import { SetupPage } from '../../support/setup-page.js';
import { bootstrapRecord, rememberBootstrap, withConsent } from '../../support/steps.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import type { UpstreamControl } from '../../support/upstream.js';
import { E2E_PROJECT_ID, PERSONAS } from '../../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Install the server from step (d) (docs/research/M6-interfaces.md §1.4.1, §1.5, §1.7; behaviour A55; findings 9, 10
 * and 12 of 2026-10-25): one click submits a Cloud Build build as `hcm-installer@`, the card follows it through its
 * steps, a first-deploy race retries inside the build, a stopped build names its step and shows its redacted log, a
 * server newer than the admin is never replaced, a build already under way is followed. No step runs: the fake Cloud
 * Build plays each build (`cloud-build.start`, `cloud-build.finish`).
 */

function installButton(deploy: Locator, lang: 'ro' | 'en'): Locator {
    return deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.server.action') });
}

/** The server builds the fake received. */
async function serverBuilds(upstream: UpstreamControl) {
    return (await submittedBuilds(upstream)).filter((build) => build.target === 'server');
}

test.describe('Install the server', () => {
    test(
        'One click installs the server through Cloud Build, the card follows it and the claim follows',
        { tag: ['@S-A55-HAPPY'] },
        async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment, adminWorld }) => {
            await serverDeployment.hide();
            const signInBudget = inputBudget.flow('signIn', 1);
            const { setup, bundle, deploy } = await preparedProject({
                ...{ page, lang, consent, setupBudget, upstream, signInBudget },
                signInConsent: inputBudget.flow('signInConsent', 1),
            });

            // Within the hour of Prepare the project: one click, no consent.
            await setupBudget.inputs('deploy').click(installButton(deploy, lang));
            await expect(installState(deploy)).toContainText(setupText(lang, 'adminSetup.install.state.queued'));
            await expect.poll(async () => (await serverBuilds(upstream)).length).toBe(1);
            const [build] = await serverBuilds(upstream);
            expect(build?.request.serviceAccount).toBe(
                `projects/${E2E_PROJECT_ID}/serviceAccounts/hcm-installer@${E2E_PROJECT_ID}.iam.gserviceaccount.com`,
            );
            expect(build?.request.options).toEqual({ logging: 'CLOUD_LOGGING_ONLY' });
            expect(build?.tags).toEqual(['hcm-install', 'hcm-server', `hcm-r-${INSTALL_SLUG}`]);
            expect(build?.substitutions).toMatchObject({
                _MANIFEST_SHA256: bundle.manifestSha256,
                _RELEASE: INSTALL_RELEASE,
                _SLUG: INSTALL_SLUG,
            });
            expect(build?.request.steps.map((step) => step.id)).toEqual(['fetch', 'tools', 'rules', 'functions', 'verify']);
            expect(build?.request.steps.every((step) => /@sha256:[0-9a-f]{64}$/.test(step.name))).toBe(true);
            expect(build?.request.steps.find((step) => step.id === 'functions')?.args).toContain('--force');

            await upstream.scenario('cloud-build.start', 'browser');
            await page.clock.fastForward(10_000);
            await expect(installState(deploy)).toContainText(setupText(lang, 'adminSetup.install.state.working'));
            await expect(deploy.locator('[aria-current="step"]')).toContainText(setupText(lang, 'adminSetup.install.step.fetch'));

            await upstream.scenario('cloud-build.finish', 'browser');
            await upstream.scenario('secret-manager.provisioned', 'server');
            await nextLook(
                page,
                deploy.getByText(templatePattern(setupText(lang, 'adminSetup.install.installed', { release: '\u0000', date: '\u0000' }))),
            );
            await serverDeployment.show();
            await page.clock.fastForward(30_000);
            await setup.expectState('claim', 'ok', 60_000);
            await expect
                .poll(() => adminWorld.emulators.document(`admins/${adminWorld.accounts.owner.uid}`))
                .toEqual(expect.objectContaining({ role: 'owner' }));
            expect(await serverBuilds(upstream)).toHaveLength(1);
            serverDeployment.claimErrors();
        },
    );

    test(
        'A first-deploy race is retried inside the build: the card says Google is still preparing it',
        { tag: ['@S-A55-HAPPY-RETRIED'] },
        async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment }) => {
            await serverDeployment.hide();
            const { deploy } = await preparedProject({
                ...{ page, lang, consent, setupBudget, upstream, signInBudget: inputBudget.flow('signIn', 1) },
                signInConsent: inputBudget.flow('signInConsent', 1),
            });
            await upstream.scenario('cloud-build.serverRetries', 'browser');

            await setupBudget.inputs('deploy').click(installButton(deploy, lang));
            await expect.poll(async () => (await serverBuilds(upstream)).length).toBe(1);
            await upstream.scenario('cloud-build.start', 'browser');
            await page.clock.fastForward(10_000);

            const what = setupText(lang, 'adminSetup.install.retry.eventarcAgent');
            await expect(
                deploy.getByText(templatePattern(setupText(lang, 'adminSetup.install.retrying', { what, time: '\u0000' }))),
            ).toBeVisible();
            await expect(installState(deploy)).toContainText(setupText(lang, 'adminSetup.install.state.retrying'));
            await upstream.scenario('cloud-build.finish', 'browser');
            await page.clock.fastForward(10_000);
            await expect(installState(deploy)).toContainText(setupText(lang, 'adminSetup.install.state.installed'));
            expect(await serverBuilds(upstream)).toHaveLength(1);
            serverDeployment.claimErrors();
        },
    );
});

test.describe('Install the server: a build that stops', () => {
    test(
        'A failed install names its step, shows the end of its log redacted and Try again submits one new build',
        { tag: ['@S-A55-BAD-BUILD-FAILED'] },
        async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment }) => {
            await serverDeployment.hide();
            const { deploy } = await preparedProject({
                ...{ page, lang, consent, setupBudget, upstream, signInBudget: inputBudget.flow('signIn', 1) },
                signInConsent: inputBudget.flow('signInConsent', 1),
            });
            await upstream.scenario('cloud-build.serverFailsAtFunctions', 'browser');
            const inputs = setupBudget.inputs('deploy', 1);

            await inputs.click(installButton(deploy, lang));
            await expect.poll(async () => (await serverBuilds(upstream)).length).toBe(1);
            await upstream.scenario('cloud-build.finish', 'browser');
            await page.clock.fastForward(10_000);

            const step = setupText(lang, 'adminSetup.install.step.functions');
            await expect(deploy.getByText(setupText(lang, 'adminSetup.install.failedAt', { step }))).toBeVisible();
            const log = deploy.locator('pre.log');
            await expect(log).toContainText('functions failed');
            await expect(log).not.toContainText(PLANTED_LOG_SECRETS[0]);
            await expect(log).not.toContainText(PLANTED_LOG_SECRETS[1]);
            await expect(deploy.getByRole('link', { name: new RegExp(setupText(lang, 'adminSetup.install.openBuild')) })).toHaveAttribute(
                'href',
                /^https:\/\/console\.cloud\.google\.com\/cloud-build\/builds;region=us-central1\/[0-9a-f-]+\?project=demo-hcm$/,
            );
            await inputs.click(deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.tryAgain') }));
            await expect.poll(async () => (await serverBuilds(upstream)).length).toBe(2);
            serverDeployment.claimErrors();
        },
    );

    test(
        'A race that outlasts the retries fails with the functions it left, and the claim waits',
        { tag: ['@S-A55-BAD-RETRIES-EXHAUSTED'] },
        async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment, adminWorld }) => {
            await serverDeployment.hide();
            const { deploy } = await preparedProject({
                ...{ page, lang, consent, setupBudget, upstream, signInBudget: inputBudget.flow('signIn', 1) },
                signInConsent: inputBudget.flow('signInConsent', 1),
            });
            await upstream.scenario('cloud-build.serverRetriesExhausted', 'browser');

            await setupBudget.inputs('deploy', 1).click(installButton(deploy, lang));
            await expect.poll(async () => (await serverBuilds(upstream)).length).toBe(1);
            await upstream.scenario('cloud-build.finish', 'browser');
            await page.clock.fastForward(10_000);

            const names = registryFunctions().slice(0, 2).join(', ');
            await expect(deploy.getByText(setupText(lang, 'adminSetup.install.missing', { names }))).toBeVisible();
            const step = setupText(lang, 'adminSetup.install.step.verify');
            await expect(deploy.getByText(setupText(lang, 'adminSetup.install.failedAt', { step }))).toBeVisible();
            await expect(deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.tryAgain') })).toBeEnabled();
            expect(await adminWorld.emulators.document('setup/owner')).toBeUndefined();
            serverDeployment.claimErrors();
        },
    );

    test(
        'An admin older than the installed server never installs over it',
        { tag: ['@S-A55-BAD-DOWNGRADE'] },
        async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment }) => {
            await serverDeployment.hide();
            const { deploy } = await preparedProject({
                ...{ page, lang, consent, setupBudget, upstream, signInBudget: inputBudget.flow('signIn', 1) },
                signInConsent: inputBudget.flow('signInConsent', 1),
            });
            await upstream.scenario('cloud-functions.deployedNewerRelease', 'browser');

            await page.clock.fastForward(60_000);

            await expect(deploy.getByText(setupText(lang, 'adminSetup.install.newer', { release: NEWER_SERVER_RELEASE }))).toBeVisible();
            await expect(installButton(deploy, lang)).toHaveCount(0);
            expect(await serverBuilds(upstream)).toEqual([]);
            serverDeployment.claimErrors();
        },
    );

    test(
        'A newer server missing one of its functions is still never replaced by an older admin',
        { tag: ['@S-A55-BAD-DOWNGRADE-INCOMPLETE'] },
        async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment }) => {
            // Finding 2 of the M6 security review: an incomplete server read as "not installed", whose --force deploy of an
            // older release would delete the newer one's functions (an owner who rolled Hosting back, say).
            await serverDeployment.hide();
            const { deploy } = await preparedProject({
                ...{ page, lang, consent, setupBudget, upstream, signInBudget: inputBudget.flow('signIn', 1) },
                signInConsent: inputBudget.flow('signInConsent', 1),
            });
            await upstream.scenario('cloud-functions.partialNewerRelease', 'browser');

            await page.clock.fastForward(60_000);

            await expect(deploy.getByText(setupText(lang, 'adminSetup.install.newer', { release: NEWER_SERVER_RELEASE }))).toBeVisible();
            await expect(installButton(deploy, lang)).toHaveCount(0);
            await expect(deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.updateAction') })).toHaveCount(0);
            expect(await serverBuilds(upstream)).toEqual([]);
            serverDeployment.claimErrors();
        },
    );

    test(
        'A build already under way is followed, not doubled',
        { tag: ['@S-A55-BAD-SECOND-BUILD'] },
        async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment }) => {
            await serverDeployment.hide();
            const { deploy } = await preparedProject({
                ...{ page, lang, consent, setupBudget, upstream, signInBudget: inputBudget.flow('signIn', 1) },
                signInConsent: inputBudget.flow('signInConsent', 1),
            });
            await upstream.scenario('cloud-build.serverQueuedElsewhere', 'browser');

            await page.clock.fastForward(60_000);

            await expect(installState(deploy)).toContainText(setupText(lang, 'adminSetup.install.state.queued'));
            await expect(installButton(deploy, lang)).toHaveCount(0);
            expect(await serverBuilds(upstream)).toHaveLength(1);
            serverDeployment.claimErrors();
        },
    );
});

test.describe('the owner, back after a Provision from before M6', () => {
    test(
        'Without the installers account Install the server is off with the reason and a way to Prepare the project',
        { tag: ['@S-A55-BAD-NOT-PROVISIONED'] },
        async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment }) => {
            await upstream.scenario('google.provisioned', 'browser');
            await upstream.scenario('service-usage.allEnabled', 'browser');
            await serverDeployment.hide();
            await serveInstallBundle(page, { startUp: true });
            await rememberBootstrap(page, E2E_PROJECT_ID, bootstrapRecord(E2E_PROJECT_ID, false));
            await page.clock.install();
            await page.clock.resume();
            await page.goto(adminPath(lang));
            const signIn = await consent.opened(page, () =>
                inputBudget.flow('signIn', 1).click(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') })),
            );
            await signIn.chooseAccount(PERSONAS.owner.email);
            await signIn.allow(inputBudget.flow('signInConsent', 1));
            const setup = new SetupPage(page, lang);
            const deploy = await setup.show('deploy');
            await withConsent(
                page,
                consent,
                deploy.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }),
                setupBudget.inputs('deploy', 1),
                setupBudget.consents('deploy', 1),
            );

            const account = `hcm-installer@${E2E_PROJECT_ID}.iam.gserviceaccount.com`;
            await expect(deploy.getByText(apiText(lang, 'apiError.install.notProvisioned', { account }))).toBeVisible();
            await expect(installButton(deploy, lang)).toBeDisabled();
            await deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.openProvision') }).click();
            await expect(setup.open('provision')).toBeVisible();
            expect(await serverBuilds(upstream)).toEqual([]);
            serverDeployment.claimErrors();
        },
    );
});
