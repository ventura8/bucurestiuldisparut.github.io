// The install cards' bodies (docs/research/M6-interfaces.md §1.7, §1.8): Install the server (d), the imagery pipeline
// (d3) and Publish the map (i), each with the install's status, its cost, its button or why it is off.
import { axeViolations } from '@hcm/test-support/axe';
import { html, type LitElement } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { defineHcmSetupDeploy } from '../../../src/admin/setup/hcm-setup-deploy.js';
import { defineHcmSetupPipeline } from '../../../src/admin/setup/hcm-setup-pipeline.js';
import { defineHcmSetupSite } from '../../../src/admin/setup/hcm-setup-site.js';
import { cleanup, fixture, shadowPart } from '../../helpers.js';
import { FakeSetupPort, setupView, stepView, type ViewChanges } from './fixtures.js';
import { installSliceView, type InstallChanges } from './install-fixtures.js';

defineHcmSetupDeploy();
defineHcmSetupPipeline();
defineHcmSetupSite();

const RUNNING_STEPS = [
    { id: 'fetch', state: 'done' },
    { id: 'tools', state: 'done' },
    { id: 'rules', state: 'now' },
    { id: 'functions', state: 'waiting' },
    { id: 'verify', state: 'waiting' },
] as const;

/** A normal-mode state with the install slice and the two install steps (the shared fixture lists the nine of M2b). */
function view(install: InstallChanges, changes: ViewChanges = {}) {
    const base = setupView({ ...changes, install: installSliceView(install) });
    const added = { pipeline: stepView('pipeline', changes.steps?.pipeline), site: stepView('site', changes.steps?.site) };
    return { ...base, steps: { ...base.steps, ...added } };
}

async function card(tag: 'deploy' | 'pipeline' | 'site', install: InstallChanges, changes: ViewChanges = {}, locale = 'en') {
    const port = new FakeSetupPort(view(install, changes));
    const templates = {
        deploy: html`<hcm-setup-deploy .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-deploy>`,
        pipeline: html`<hcm-setup-pipeline .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-pipeline>`,
        site: html`<hcm-setup-site .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-site>`,
    };
    const element = await fixture<LitElement>(templates[tag]);
    return { port, element };
}

describe('<hcm-setup-deploy>: Install the server', () => {
    afterEach(cleanup);

    it('happyPath_oneButtonInstallsTheServerAndSaysWhatItCostsAndCountsOnce', async () => {
        const { port, element } = await card(
            'deploy',
            {},
            { steps: { deploy: { state: 'missing', checkedAt: '2026-10-20T10:00:00.000Z' } } },
        );

        // One cost line per card (finding 10 of the M6 review): the step's own, then the build minutes.
        expect(shadowPart(element, '.cost').textContent).toBe(
            "Within the Blaze plan's estimate above. Uses about 85 build minutes; Google Cloud gives 2,500 free each month.",
        );
        expect(element.renderRoot.querySelectorAll('.cost')).toHaveLength(1);
        const counts = [...element.renderRoot.querySelectorAll('p')].filter((p) => p.textContent === '0 of 32 functions installed');
        expect(counts).toHaveLength(1);
        await page.getByRole('button', { name: 'Install the server' }).click();
        expect(port.calls).toEqual([['installServer']]);
        expect(shadowPart(element, '.body').textContent).toContain('The same click also installs the historical imagery pipeline.');
        expect(shadowPart(element, '.body').textContent).not.toMatch(/\b(npm|npx|firebase deploy|gcloud)\b/);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_withoutTheInstallersAccountTheButtonIsOffAndStepCIsOneClickAway', async () => {
        const blocker = {
            key: 'apiError.install.notProvisioned',
            params: { account: 'hcm-installer@demo-hcm.iam.gserviceaccount.com' },
        } as const;
        const { port, element } = await card('deploy', { server: { blocker } }, { steps: { deploy: { state: 'missing' } } });

        await expect.element(page.getByRole('button', { name: 'Install the server' })).toBeDisabled();
        expect(shadowPart(element, '.blocker').textContent).toContain('hcm-installer@demo-hcm.iam.gserviceaccount.com');
        await page.getByRole('button', { name: 'Open step c' }).click();
        expect(port.calls).toEqual([['open', 'provision']]);
    });

    it('happyPath_aBuildAtWorkShowsItsStepsAndHowLongItRan', async () => {
        const server = {
            state: 'working',
            buildId: 'b-1',
            steps: RUNNING_STEPS,
            startedAt: '2026-10-25T10:00:00.000Z',
            checkedAt: '2026-10-25T10:07:30.000Z',
        } as const;
        const { element } = await card('deploy', { server }, { steps: { deploy: { state: 'pending' } } });

        expect(shadowPart(element, '.install-state').textContent.trim()).toBe('Installing');
        expect(shadowPart(element, '[aria-current="step"]').textContent).toContain('The database and storage rules');
        expect(shadowPart(element, '.body').textContent).toContain('Running for 7 min.');
        expect(element.renderRoot.querySelector('hcm-button')).toBeNull();
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aRetrySaysWhatGoogleIsPreparingAndWhen', async () => {
        const server = {
            state: 'retrying',
            steps: RUNNING_STEPS,
            retryReason: 'eventarcAgent',
            retryAt: '2026-10-20T10:10:00.000Z',
        } as const;
        const { element } = await card('deploy', { server }, {}, 'ro');

        expect(shadowPart(element, '.retrying').textContent).toBe(
            'Google încă pregătește serviciul de evenimente; încercăm din nou la 20 oct. 2026, 13:10.',
        );
    });

    it('badPath_aStoppedBuildNamesItsStepShowsItsLogAndOffersTryAgain', async () => {
        const server = {
            state: 'failed',
            buildId: 'b-1',
            consoleUrl: 'https://console.cloud.google.com/cloud-build/builds;region=us-central1/b-1?project=demo-hcm',
            failedStep: 'functions',
            log: ['Error: functions failed', 'Authorization: Bearer [redacted]'],
            missing: ['ops-tick'],
        } as const;
        const { port, element } = await card('deploy', { server }, { steps: { deploy: { state: 'pending' } } });

        expect(shadowPart(element, '.failed-at').textContent).toBe("Stopped at the step: The server's functions.");
        expect(shadowPart(element, '.log').textContent).toBe('Error: functions failed\nAuthorization: Bearer [redacted]');
        expect(shadowPart(element, '.missing').textContent).toBe('Missing functions: ops-tick.');
        await expect
            .element(page.getByRole('link', { name: /Open the installation in the Google Cloud console/ }))
            .toHaveAttribute('href', server.consoleUrl);
        await page.getByRole('button', { name: 'Try again' }).click();
        expect(port.calls).toEqual([['installServer']]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_anOlderServerOffersUpdateTheMap_aNewerOneAsksForAReload', async () => {
        const older = await card('deploy', { server: { state: 'updateAvailable', installedRelease: '0.9.0' } });

        expect(shadowPart(older.element, '.body').textContent).toContain('An update is ready: 1.0.0+abc1234.');
        await page.getByRole('button', { name: 'Update the map' }).click();
        expect(older.port.calls).toEqual([['updateMap', 'deploy']]);
        cleanup();

        const newer = await card('deploy', { server: { state: 'newerInstalled', installedRelease: '9.0.0' } });
        expect(shadowPart(newer.element, '.body').textContent).toContain('Installed 9.0.0, newer than this admin: reload the page.');
        expect(newer.element.renderRoot.querySelector('hcm-button')).toBeNull();
    });

    it('happyPath_anInstalledServerNamesItsReleaseAndTheGithubPathStaysCollapsed', async () => {
        const server = { state: 'installed', installedRelease: '1.0.0+abc1234', finishedAt: '2026-10-20T10:20:00.000Z' } as const;
        const { element } = await card('deploy', { server }, { steps: { deploy: { state: 'ok' } } });

        expect(shadowPart(element, '.body').textContent).toContain('Installed: 1.0.0+abc1234, 20 Oct 2026, 13:20.');
        expect(element.renderRoot.querySelector('details')?.open).toBe(false);
        expect(element.renderRoot.querySelector('hcm-button')).toBeNull();
    });

    it('badPath_inAnAdminSessionAStoppedUpdateOffersTryAgainThoughTheStepIsDone', async () => {
        // Finding 1 of the M6 review: the step's Done chip hid the button; the install's own state decides.
        const server = { state: 'failed', failedStep: 'verify', checkedAt: '2026-10-20T10:00:00.000Z' } as const;
        const { port } = await card('deploy', { server }, { steps: { deploy: { state: 'ok' } } });

        await page.getByRole('button', { name: 'Try again' }).click();
        expect(port.calls).toEqual([['installServer']]);
    });

    it('badPath_aDoneStepOrOneNotLookedAtShowsNoFunctionCount', async () => {
        // Finding 9 of the M6 review: "0 of 69 functions installed" beside a Done chip, before any look.
        const done = await card('deploy', {}, { steps: { deploy: { state: 'ok' } } });
        expect(shadowPart(done.element, '.body').textContent).not.toContain('functions installed');
        expect(done.element.renderRoot.querySelector('hcm-progress')).toBeNull();
        expect(done.element.renderRoot.querySelector('hcm-button')).toBeNull();
        cleanup();

        const unseen = await card('deploy', {}, { steps: { deploy: { state: 'missing' } } });
        expect(shadowPart(unseen.element, '.body').textContent).not.toContain('functions installed');
    });

    it('badPath_aCheckThatFailedIsAnAlert', async () => {
        const { element } = await card('deploy', {
            server: { state: 'unavailable', error: { key: 'apiError.unavailable' } },
        });

        expect(shadowPart(element, '[role="alert"]').textContent).toContain('unavailable');
    });
});

describe('<hcm-setup-pipeline>', () => {
    afterEach(cleanup);

    it('happyPath_beforeTheServersClickItSaysWhenItStarts', async () => {
        const { element } = await card('pipeline', {});

        expect(shadowPart(element, '.body').textContent).toContain('It starts when you choose “Install the server” in step d.');
        expect(element.renderRoot.querySelector('hcm-button')).toBeNull();
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aStoppedBuildOffersTryAgain_andNoRepositoryIsSaid', async () => {
        const pipeline = { state: 'failed', failedStep: 'build', log: ['docker: build failed'] } as const;
        const { port, element } = await card('pipeline', { pipeline, server: { buildId: 'b-0' } });

        expect(shadowPart(element, '.body').textContent).not.toContain('It starts when');
        await page.getByRole('button', { name: 'Try again' }).click();
        expect(port.calls).toEqual([['install', 'pipeline']]);
        cleanup();

        const blocked = await card('pipeline', {
            pipeline: { blocker: { key: 'apiError.install.noRepository', params: { repository: 'hcm' } } },
        });
        expect(shadowPart(blocked.element, '.blocker').textContent).toContain('The image repository hcm is missing');
    });

    it('happyPath_aPipelineMissingBesideAnInstalledServerHasItsOwnButton', async () => {
        // Finding 3 of the M6 review: a server installed some other way, or a pipeline blocked at the server's click.
        const looked = { checkedAt: '2026-10-20T10:00:00.000Z' };
        const { port, element } = await card('pipeline', { pipeline: looked, server: { state: 'installed' } });

        expect(shadowPart(element, '.body').textContent).not.toContain('It starts when');
        await page.getByRole('button', { name: 'Install the pipeline' }).click();
        expect(port.calls).toEqual([['install', 'pipeline']]);
        cleanup();

        const blocked = await card('pipeline', {
            pipeline: { ...looked, blocker: { key: 'apiError.install.notAvailable' } },
            server: { state: 'installed' },
        });
        await expect.element(page.getByRole('button', { name: 'Install the pipeline' })).toBeDisabled();
        expect(shadowPart(blocked.element, '.blocker').textContent).toContain('Not available yet:');
    });
});

describe('<hcm-setup-site>: Publish the map', () => {
    afterEach(cleanup);

    it('happyPath_publishIsOneClickToTheProjectsAddress', async () => {
        const { port, element } = await card('site', {}, { steps: { site: { state: 'missing' } } });

        expect(shadowPart(element, '.body').textContent).toContain("The map's address: https://demo-hcm.web.app/");
        // Finding 4 of the M6 security review: what one publish moves out of Hosting's free daily transfer.
        expect(shadowPart(element, '.cost').textContent).toContain('Each publish also moves about 52 MB of Hosting’s free daily transfer.');
        expect(shadowPart(element, '.body').textContent).toContain('Tip: import the old photos first');
        await page.getByRole('button', { name: 'Publish the map' }).click();
        expect(port.calls).toEqual([['install', 'site']]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_nothingToShowKeepsTheButtonOffAndSaysWhy', async () => {
        const { element } = await card(
            'site',
            { site: { blocker: { key: 'apiError.install.nothingToShow' } } },
            { steps: { legacyImport: { state: 'ok' } } },
        );

        await expect.element(page.getByRole('button', { name: 'Publish the map' })).toBeDisabled();
        expect(shadowPart(element, '.blocker').textContent).toContain('The map has nothing to show yet');
        expect(shadowPart(element, '.body').textContent).not.toContain('Tip:');
    });

    it('happyPath_aPublishedMapIsALink', async () => {
        const { element } = await card('site', { site: { state: 'installed', installedRelease: '1.0.0+abc1234' } });

        await expect.element(page.getByRole('link', { name: /Open the public map/ })).toHaveAttribute('href', 'https://demo-hcm.web.app/');
        expect(shadowPart(element, '.success').textContent).toBe('The map is public.');
        expect(element.renderRoot.querySelector('hcm-button')).toBeNull();
    });

    it('badPath_aStoppedPublishOffersTryAgain', async () => {
        const { port } = await card('site', { site: { state: 'failed', failedStep: 'hosting' } });

        await page.getByRole('button', { name: 'Try again' }).click();
        expect(port.calls).toEqual([['install', 'site']]);
    });
});

describe('the installed line', () => {
    afterEach(cleanup);

    it('happyPath_aReleaseWithoutABuildOfThisAdminIsShownUndated', async () => {
        const recorded = { state: 'updateAvailable', installedRelease: '0.9.0+abc0000' } as const;
        const { element } = await card('deploy', { server: recorded }, { steps: { deploy: { state: 'ok' } } });

        const notes = [...element.renderRoot.querySelectorAll('p.note')].map((note) => note.textContent);
        expect(notes).toContain('Installed: 0.9.0+abc0000.');
    });

    it('badPath_aServerNewerThanTheAdminShowsNoInstalledLine', async () => {
        const newer = { state: 'newerInstalled', installedRelease: '99.0.0+abc9999' } as const;
        const { element } = await card('deploy', { server: newer }, { steps: { deploy: { state: 'ok' } } });

        const notes = [...element.renderRoot.querySelectorAll('p.note')].map((note) => note.textContent);
        expect(notes.some((note) => note.startsWith('Installed:'))).toBe(false);
    });
});
