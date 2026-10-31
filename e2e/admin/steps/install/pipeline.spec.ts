import { PIPELINE_DIGEST } from '@hcm/test-support/fakes';
import type { Locator } from '@playwright/test';

import { setupText } from '../../support/i18n.js';
import { INSTALL_SLUG, installState, preparedProject, submittedBuilds } from '../../support/install.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import type { UpstreamControl } from '../../support/upstream.js';
import { E2E_PROJECT_ID } from '../../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The imagery pipeline (step d3; docs/research/M6-interfaces.md §1.4.2, §4.1; behaviour A56; finding 13 of
 * 2026-10-25): Install the server's click also submits the pipeline's build, which pushes the image to the `hcm`
 * repository and makes the two Cloud Run jobs on its digest with the release's label; a failed pipeline build stops only
 * the pipeline, and Try again costs one input; without the repository nothing is submitted.
 */

async function pipelineBuilds(upstream: UpstreamControl) {
    return (await submittedBuilds(upstream)).filter((build) => build.target === 'pipeline');
}

/** What the fake Cloud Run holds of a job the pipeline build made. */
async function jobSpecs(upstream: UpstreamControl): Promise<Readonly<Record<string, { labels: Record<string, string>; image: string }>>> {
    const run = (await upstream.snapshot('browser'))['cloud-run'] as {
        readonly jobSpecs: Record<string, { labels: Record<string, string>; image: string }>;
    };
    return run.jobSpecs;
}

function installServer(deploy: Locator, lang: 'ro' | 'en'): Locator {
    return deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.server.action') });
}

test(
    'Install the server also installs the imagery pipeline: its image and its two jobs, no input of its own',
    { tag: ['@S-A56-HAPPY'] },
    async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment }) => {
        await serverDeployment.hide();
        const { setup, deploy } = await preparedProject({
            ...{ page, lang, consent, setupBudget, upstream, signInBudget: inputBudget.flow('signIn', 1) },
            signInConsent: inputBudget.flow('signInConsent', 1),
        });

        await setupBudget.inputs('deploy').click(installServer(deploy, lang));
        await expect.poll(async () => (await pipelineBuilds(upstream)).length).toBe(1);
        const [build] = await pipelineBuilds(upstream);
        expect(build?.request.steps.map((step) => step.id)).toEqual(['fetch', 'build', 'push', 'jobs']);
        expect(build?.tags).toEqual(['hcm-install', 'hcm-pipeline', `hcm-r-${INSTALL_SLUG}`]);

        await upstream.scenario('cloud-build.finish', 'browser');
        await page.clock.fastForward(60_000);
        const pipeline = await setup.show('pipeline');
        await expect(installState(pipeline)).toContainText(setupText(lang, 'adminSetup.install.state.installed'));
        await setup.expectState('pipeline', 'ok');
        const jobs = await jobSpecs(upstream);
        const image = `us-central1-docker.pkg.dev/${E2E_PROJECT_ID}/hcm/pipeline@${PIPELINE_DIGEST}`;
        expect(jobs[`${E2E_PROJECT_ID}/us-central1/raster-pipeline`]).toEqual({ labels: { 'hcm-release': INSTALL_SLUG }, image });
        expect(jobs[`${E2E_PROJECT_ID}/us-central1/raster-pipeline-xl`]).toEqual({ labels: { 'hcm-release': INSTALL_SLUG }, image });
        await expect(pipeline.getByRole('button', { name: setupText(lang, 'adminSetup.install.tryAgain') })).toHaveCount(0);
        serverDeployment.claimErrors();
    },
);

test(
    'A failed pipeline build stops only the pipeline; Try again costs one input',
    { tag: ['@S-A56-BAD-FAILED'] },
    async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment }) => {
        await serverDeployment.hide();
        const { setup, deploy } = await preparedProject({
            ...{ page, lang, consent, setupBudget, upstream, signInBudget: inputBudget.flow('signIn', 1) },
            signInConsent: inputBudget.flow('signInConsent', 1),
        });
        await upstream.scenario('cloud-build.pipelineFailsAtBuild', 'browser');

        await setupBudget.inputs('deploy').click(installServer(deploy, lang));
        await expect.poll(async () => (await pipelineBuilds(upstream)).length).toBe(1);
        await upstream.scenario('cloud-build.finish', 'browser');
        await page.clock.fastForward(60_000);

        await setup.expectState('pipeline', 'invalid');
        await expect(installState(setup.open('deploy'))).toContainText(setupText(lang, 'adminSetup.install.state.installed'));
        const pipeline = await setup.show('pipeline');
        const step = setupText(lang, 'adminSetup.install.step.build');
        await expect(pipeline.getByText(setupText(lang, 'adminSetup.install.failedAt', { step }))).toBeVisible();
        await expect(pipeline.locator('pre.log')).toContainText('build failed');
        await setupBudget
            .inputs('pipeline', 1)
            .click(pipeline.getByRole('button', { name: setupText(lang, 'adminSetup.install.tryAgain') }));
        await expect.poll(async () => (await pipelineBuilds(upstream)).length).toBe(2);
        serverDeployment.claimErrors();
    },
);
