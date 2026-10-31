import { createHash } from 'node:crypto';

import {
    NEWER_SERVER_RELEASE,
    OLDER_SERVER_RELEASE,
    PLANTED_LOG_SECRETS,
    PRE_M6_LACKING,
    registryFunctions,
} from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { GoogleApiError } from '../../src/google/failure.js';
import { InstallBundleError } from '../../src/install/bundle.js';
import { ACCESS, installManifest, installWorld, RELEASE } from './world.js';

/**
 * The installer's Cloud Build adapter over the fake upstreams (`docs/research/M6-interfaces.md` §1.7, §1.10): what each
 * target has installed, its newest build, why it cannot install, the build it submits and the build's log.
 */

describe('observe', () => {
    it('happyPath_aProvisionedProjectHasNothingInstalledAndNothingInTheWay', async () => {
        const world = await installWorld();

        const server = await world.installer.observe('server', ACCESS);
        const pipeline = await world.installer.observe('pipeline', ACCESS);
        const site = await world.installer.observe('site', ACCESS);

        expect(server).toEqual({
            installed: { complete: false, release: null, partial: false, newest: null },
            build: null,
            progress: { ready: 0, total: registryFunctions().length, failed: [] },
            blocker: null,
        });
        expect(pipeline).toMatchObject({
            installed: { complete: false, release: null, partial: false, newest: null },
            progress: null,
            blocker: null,
        });
        expect(site).toMatchObject({ installed: { complete: false, release: null, partial: false, newest: null }, blocker: null });
    });

    it('happyPath_theServersReleaseIsTheOldestOfItsFunctions', async () => {
        const world = await installWorld();
        world.fakes.scenario('cloud-functions.deployedOlderRelease');

        const server = await world.installer.observe('server', ACCESS);

        expect(server.installed).toEqual({ complete: true, release: OLDER_SERVER_RELEASE, partial: false, newest: OLDER_SERVER_RELEASE });
        world.fakes.scenario('cloud-functions.deployedNewerRelease');
        expect((await world.installer.observe('server', ACCESS)).installed.release).toBe(NEWER_SERVER_RELEASE);
    });

    it('badPath_aServerDeployedWithoutAReleaseIsCompleteButUnnamed', async () => {
        const world = await installWorld();
        world.fakes.scenario('cloud-functions.deployed');

        expect((await world.installer.observe('server', ACCESS)).installed).toEqual({
            complete: true,
            release: null,
            partial: false,
            newest: null,
        });
    });

    it('happyPath_thePipelinesJobsAndTheSitesReleaseFile', async () => {
        const world = await installWorld();
        world.fakes.scenario('cloud-run.pipelineJobsOlderRelease');
        world.release = { release: RELEASE, variant: 'public' };

        expect((await world.installer.observe('pipeline', ACCESS)).installed).toEqual({
            complete: true,
            release: '0.9.0+e2e0000',
            partial: false,
            newest: '0.9.0+e2e0000',
        });
        expect((await world.installer.observe('site', ACCESS)).installed).toEqual({
            complete: true,
            release: RELEASE,
            partial: false,
            newest: RELEASE,
        });
    });

    it('badPath_jobsWithoutALabelAndAStartUpRootAreNotTheRelease', async () => {
        const world = await installWorld();
        world.fakes.scenario('cloud-run.pipelineJobsProvisioned');
        world.release = { release: RELEASE, variant: 'start-up' };

        expect((await world.installer.observe('pipeline', ACCESS)).installed).toEqual({
            complete: true,
            release: null,
            partial: false,
            newest: null,
        });
        expect((await world.installer.observe('site', ACCESS)).installed).toEqual({
            complete: false,
            release: null,
            partial: false,
            newest: null,
        });
        world.release = null;
        expect((await world.installer.observe('site', ACCESS)).installed.complete).toBe(false);
    });

    it('badPath_withoutTheInstallersAccountEveryTargetAsksForPrepareTheProject', async () => {
        const world = await installWorld({ provisioned: false });

        const blocker = (await world.installer.observe('server', ACCESS)).blocker;

        expect(blocker).toEqual({
            key: 'apiError.install.notProvisioned',
            params: { account: 'hcm-installer@demo-hcm.iam.gserviceaccount.com' },
        });
    });

    it('badPath_thePipelineWaitsForItsRepositoryAndItsBuilder', async () => {
        const world = await installWorld();
        world.fakes.state.artifactRegistry.repositories.clear();

        expect((await world.installer.observe('pipeline', ACCESS)).blocker).toEqual({
            key: 'apiError.install.noRepository',
            params: { repository: 'hcm' },
        });
        const unpinned = await installWorld();
        unpinned.manifest = installManifest({
            tools: { firebaseTools: '15.33.0', node: `node:24@sha256:${'d'.repeat(64)}`, docker: null },
        });
        expect((await unpinned.installer.observe('pipeline', ACCESS)).blocker).toEqual({ key: 'apiError.install.notAvailable' });
    });

    it('badPath_theSiteWaitsForSomethingToShow_andAMissingBundleStopsEveryTarget', async () => {
        const world = await installWorld();
        world.published = false;

        expect((await world.installer.observe('site', ACCESS)).blocker).toEqual({ key: 'apiError.install.nothingToShow' });
        // A bundle once found is read once a session: a missing one is a fresh admin's.
        const missing = await installWorld();
        missing.manifest = null;
        expect((await missing.installer.observe('server', ACCESS)).blocker).toEqual({ key: 'apiError.install.bundleMissing' });
    });

    it('badPath_aRefusedListIsAGoogleFailure', async () => {
        const world = await installWorld();
        world.fakes.fail('cloud-build', 'unavailable');

        await expect(world.installer.observe('server', ACCESS)).rejects.toBeInstanceOf(GoogleApiError);
    });
});

describe('observe: a target only partly there (the M6 reviews)', () => {
    it('happyPath_aServerFromBeforeM6LackingFunctionsIsPartial', async () => {
        const world = await installWorld();
        world.fakes.scenario('cloud-functions.preM6');

        const server = await world.installer.observe('server', ACCESS);

        expect(server.installed).toEqual({ complete: false, release: null, partial: true, newest: null });
        expect(server.progress).toEqual({
            ready: registryFunctions().length - PRE_M6_LACKING,
            total: registryFunctions().length,
            failed: [],
        });
    });

    it('badPath_aNewerServerMissingAFunctionStillNamesItsNewestRelease', async () => {
        const world = await installWorld();
        world.fakes.scenario('cloud-functions.partialNewerRelease');

        expect((await world.installer.observe('server', ACCESS)).installed).toEqual({
            complete: false,
            release: null,
            partial: true,
            newest: NEWER_SERVER_RELEASE,
        });
    });
});

describe('submit', () => {
    it('happyPath_theServerBuildRunsAsTheInstallerWithTheBundlesDigests', async () => {
        const world = await installWorld();

        const build = await world.installer.submit('server', ACCESS);

        expect(build).toMatchObject({ status: 'QUEUED', tags: ['hcm-install', 'hcm-server', 'hcm-r-1-0-0-abc1234'] });
        const [call] = world.fakes.callsTo('cloud-build.builds.create');
        const body = JSON.parse(call?.body ?? '{}') as { serviceAccount: string; substitutions: Record<string, string> };
        expect(body.serviceAccount).toBe('projects/demo-hcm/serviceAccounts/hcm-installer@demo-hcm.iam.gserviceaccount.com');
        expect(body.substitutions['_MANIFEST_SHA256']).toBe(createHash('sha256').update(JSON.stringify(world.manifest)).digest('hex'));
        expect(body.substitutions).toMatchObject({ _ORIGIN: 'https://demo-hcm.web.app', _BASE: '/admin/', _FILE_SHA256: 'a'.repeat(64) });
        expect(call?.headers['authorization']).toBe(`Bearer ${ACCESS.token}`);
    });

    it('happyPath_theNewestBuildIsFoundByItsTargetsTag', async () => {
        const world = await installWorld();
        await world.installer.submit('server', ACCESS);
        const site = await world.installer.submit('site', ACCESS);

        expect((await world.installer.observe('site', ACCESS)).build?.id).toBe(site.id);
        expect((await world.installer.observe('pipeline', ACCESS)).build).toBeNull();
    });

    it('badPath_thePipelineIsNotSubmittedWithoutItsBuilder', async () => {
        const world = await installWorld();
        world.manifest = installManifest({ tools: { firebaseTools: '15.33.0', node: `node:24@sha256:${'d'.repeat(64)}`, docker: null } });

        await expect(world.installer.submit('pipeline', ACCESS)).rejects.toBeInstanceOf(InstallBundleError);
        expect(world.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
    });
});

describe('buildLog and consoleUrl', () => {
    it('happyPath_aStoppedBuildsLinesAreRedactedAndLabelledWithTheirStep', async () => {
        const world = await installWorld();
        world.fakes.scenario('cloud-build.serverFailsAtFunctions');
        const build = await world.installer.submit('server', ACCESS);
        world.fakes.scenario('cloud-build.finish');

        const lines = await world.installer.buildLog(build.id, ACCESS);

        const functions = lines.filter((line) => line.step === 'functions').map((line) => line.text);
        expect(functions.length).toBeGreaterThan(0);
        expect(functions.join('\n')).not.toContain(PLANTED_LOG_SECRETS[0]);
        expect(functions.join('\n')).not.toContain(PLANTED_LOG_SECRETS[1]);
        expect(world.installer.consoleUrl(build.id)).toBe(
            `https://console.cloud.google.com/cloud-build/builds;region=us-central1/${build.id}?project=demo-hcm`,
        );
    });
});
