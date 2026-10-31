import { describe, expect, it } from 'vitest';

import type { CloudBuild } from '../../src/google/cloud-build.js';
import {
    buildSlug,
    deriveInstallState,
    endedByGoogle,
    failedStepOf,
    hasEnded,
    initialInstallSlice,
    initialTargetView,
    isRunning,
    missingFunctions,
    pendingRetry,
    stepsOf,
    type StateInput,
} from '../../src/install/model.js';

const RELEASE = '1.0.0+abc1234';
const SLUG = '1-0-0-abc1234';

function build(changes: Partial<CloudBuild> = {}): CloudBuild {
    return { id: 'b-1', status: 'WORKING', steps: [], tags: ['hcm-install', 'hcm-server', `hcm-r-${SLUG}`], substitutions: {}, ...changes };
}

function input(changes: Partial<StateInput> = {}): StateInput {
    return {
        installed: { complete: false, release: null },
        build: null,
        bundleRelease: RELEASE,
        bundleSlug: SLUG,
        retrying: false,
        missing: [],
        ...changes,
    };
}

describe('deriveInstallState', () => {
    it('happyPath_nothingAndNoBuildIsNotInstalled_theAdminsReleaseIsInstalled', () => {
        expect(deriveInstallState(input())).toBe('notInstalled');
        expect(deriveInstallState(input({ installed: { complete: true, release: RELEASE } }))).toBe('installed');
    });

    it('happyPath_aBuildThatRunsDecidesFirst', () => {
        const installed = { complete: true, release: RELEASE };

        expect(deriveInstallState(input({ installed, build: build({ status: 'QUEUED' }) }))).toBe('queued');
        expect(deriveInstallState(input({ build: build({ status: 'PENDING' }) }))).toBe('queued');
        expect(deriveInstallState(input({ build: build() }))).toBe('working');
        expect(deriveInstallState(input({ build: build(), retrying: true }))).toBe('retrying');
    });

    it('happyPath_anOlderOrUnnamedReleaseOffersUpdate_aNewerOneIsNeverReplaced', () => {
        expect(deriveInstallState(input({ installed: { complete: true, release: '0.9.0+0000000' } }))).toBe('updateAvailable');
        expect(deriveInstallState(input({ installed: { complete: true, release: null } }))).toBe('updateAvailable');
        expect(deriveInstallState(input({ installed: { complete: true, release: '2.0.0+0000000' } }))).toBe('newerInstalled');
    });

    it('happyPath_aPartOfTheTargetInPlaceIsAnUpdate_notAFirstInstall', () => {
        // A server from before M6 that lacks M6's functions (finding 1 of the M6 review): Update the map, never Install.
        expect(deriveInstallState(input({ installed: { complete: false, release: null, partial: true, newest: null } }))).toBe(
            'updateAvailable',
        );
        expect(deriveInstallState(input({ installed: { complete: false, release: null, partial: false, newest: null } }))).toBe(
            'notInstalled',
        );
    });

    it('badPath_aNewerReleaseAnywhereIsNeverReplaced_evenWithAPartMissing', () => {
        // Finding 2 of the M6 security review: the deploy's --force would delete the newer release's functions.
        const incomplete = { complete: false, release: null, partial: true, newest: '2.0.0+0000000' };

        expect(deriveInstallState(input({ installed: incomplete }))).toBe('newerInstalled');
        expect(deriveInstallState(input({ installed: incomplete, build: build({ status: 'FAILURE' }) }))).toBe('newerInstalled');
        expect(deriveInstallState(input({ installed: { ...incomplete, newest: '0.9.0+0000000' } }))).toBe('updateAvailable');
        expect(deriveInstallState(input({ installed: { complete: true, release: RELEASE, newest: '2.0.0+0000000' } }))).toBe(
            'newerInstalled',
        );
    });

    it('badPath_aFailedBuildOfTheAdminsReleaseIsFailed_unlessTheReleaseIsInPlace', () => {
        const failed = build({ status: 'FAILURE' });

        expect(deriveInstallState(input({ build: failed }))).toBe('failed');
        expect(deriveInstallState(input({ build: build({ status: 'TIMEOUT' }), installed: { complete: true, release: '0.9.0' } }))).toBe(
            'failed',
        );
        expect(deriveInstallState(input({ build: failed, installed: { complete: true, release: RELEASE } }))).toBe('installed');
    });

    it('badPath_aFailedBuildOfAnotherReleaseIsHistory', () => {
        const other = build({ status: 'FAILURE', tags: ['hcm-install', 'hcm-server', 'hcm-r-0-9-0'] });

        expect(deriveInstallState(input({ build: other }))).toBe('notInstalled');
        expect(deriveInstallState(input({ build: build({ status: 'FAILURE', tags: [] }) }))).toBe('notInstalled');
    });

    it('badPath_aSucceededBuildWhoseVerifyNamedMissingFunctionsIsFailed', () => {
        expect(deriveInstallState(input({ build: build({ status: 'SUCCESS' }), missing: ['ops-tick'] }))).toBe('failed');
        expect(deriveInstallState(input({ build: build({ status: 'SUCCESS' }) }))).toBe('notInstalled');
    });
});

describe('the build steps', () => {
    it('happyPath_theFirstStepNotDoneIsUnderWayWhileTheBuildWorks', () => {
        const working = build({
            steps: [
                { id: 'fetch', status: 'SUCCESS' },
                { id: 'tools', status: 'SUCCESS' },
                { id: 'rules', status: 'WORKING' },
            ],
        });

        expect(stepsOf('server', working).map((step) => step.state)).toEqual(['done', 'done', 'now', 'waiting', 'waiting']);
        expect(stepsOf('site', null).every((step) => step.state === 'waiting')).toBe(true);
        expect(stepsOf('pipeline', build({ status: 'QUEUED' })).map((step) => step.state)).toEqual([
            'waiting',
            'waiting',
            'waiting',
            'waiting',
        ]);
    });

    it('badPath_aStoppedBuildNamesItsStep', () => {
        const failed = build({
            status: 'FAILURE',
            steps: [
                { id: 'fetch', status: 'SUCCESS' },
                { id: 'tools', status: 'SUCCESS' },
                { id: 'rules', status: 'SUCCESS' },
                { id: 'functions', status: 'FAILURE' },
            ],
        });

        expect(stepsOf('server', failed).map((step) => step.state)).toEqual(['done', 'done', 'done', 'failed', 'waiting']);
        expect(failedStepOf('server', failed)).toBe('functions');
        expect(failedStepOf('server', build({ status: 'TIMEOUT', steps: [{ id: 'fetch', status: 'SUCCESS' }] }))).toBe('tools');
        const allDone = build({
            status: 'FAILURE',
            steps: ['fetch', 'tools', 'hosting', 'config'].map((id) => ({ id, status: 'SUCCESS' })),
        });
        expect(failedStepOf('site', allDone)).toBeNull();
    });
});

describe('the log events', () => {
    it('happyPath_aRetryThatIsTheLastEventIsPending_aLaterEventMovedOn', () => {
        const retry = { event: 'retry', attempt: 1, waitSeconds: 60, reason: 'eventarcAgent' } as const;

        expect(pendingRetry([retry])).toEqual(retry);
        expect(pendingRetry([retry, { event: 'missing', name: 'ops-tick' }])).toBeNull();
        expect(pendingRetry([])).toBeNull();
    });

    it('happyPath_missingAndFailedFunctionsAreNamedOnce', () => {
        expect(
            missingFunctions([
                { event: 'missing', name: 'ops-tick' },
                { event: 'failed', name: 'admin-session' },
                { event: 'missing', name: 'ops-tick' },
                { event: 'image', digest: `sha256:${'a'.repeat(64)}` },
            ]),
        ).toEqual(['ops-tick', 'admin-session']);
    });
});

describe('the build helpers', () => {
    it('happyPath_theReleaseTagNamesTheSlug_badPath_noTagNoSlug', () => {
        expect(buildSlug(build())).toBe(SLUG);
        expect(buildSlug(build({ tags: ['hcm-install'] }))).toBeNull();
    });

    it('happyPath_googlesOwnEndingsAreToldApart', () => {
        expect(endedByGoogle(build({ status: 'INTERNAL_ERROR' }))).toBe(true);
        expect(endedByGoogle(build({ status: 'EXPIRED' }))).toBe(true);
        expect(endedByGoogle(build({ status: 'FAILURE' }))).toBe(false);
        expect(endedByGoogle(null)).toBe(false);
        expect([hasEnded(build({ status: 'SUCCESS' })), hasEnded(build()), hasEnded(null)]).toEqual([true, false, false]);
        expect([isRunning('queued'), isRunning('retrying'), isRunning('failed')]).toEqual([true, true, false]);
    });

    it('happyPath_aFreshSliceKnowsTheReleaseTheAddressAndTheCosts', () => {
        const slice = initialInstallSlice(RELEASE, 'https://demo-hcm.web.app/');

        expect(slice).toMatchObject({
            release: RELEASE,
            freeMinutes: 2500,
            estimates: { server: 85, pipeline: 20, site: 5 },
            siteTransferMegabytes: 52,
        });
        expect(slice.server).toEqual(initialTargetView('server'));
        expect(slice.pipeline.steps.map((step) => step.id)).toEqual(['fetch', 'build', 'push', 'jobs']);
    });
});
