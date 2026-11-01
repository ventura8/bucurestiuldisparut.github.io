// Where the install cards' states are kept (docs/research/M6-interfaces.md §1.7): the bootstrap record before the claim,
// `setup/status.install` after it; a record never holds a token, an address or a log line.
import { describe, expect, it } from 'vitest';

import { initialTargetView, type InstallTargetView } from '../../src/install/model.js';
import { isBootstrapRecord } from '../../src/setup/bootstrap-record.js';
import { installRecordOf, observedInstall, withRecordedInstall } from '../../src/setup/install-records.js';
import { applyBootstrapRecord, applyStatusView, bootstrapRecordOf, recordCloudRequestOf } from '../../src/setup/records.js';
import { initialSetupState, type SetupState } from '../../src/setup/state.js';
import { ADMIN_RELEASE, ADMIN_RELEASE_TIME, createHarness, START, statusView } from './harness.js';

const NOW = new Date(START).toISOString();
const LATER = new Date(START + 60_000).toISOString();
const EARLIER = new Date(START - 60_000).toISOString();

function view(changes: Partial<InstallTargetView>, target: InstallTargetView['target'] = 'server'): InstallTargetView {
    return { ...initialTargetView(target), ...changes };
}

function state(mode: 'bootstrap' | 'normal' = 'bootstrap'): SetupState {
    return initialSetupState(createHarness().host, mode);
}

describe('installRecordOf', () => {
    it('happyPath_aViewKeepsItsStateReleaseBuildAndAnApiReason', () => {
        const failed = view({
            state: 'failed',
            installedRelease: ADMIN_RELEASE,
            buildId: '0e2e0b1d-0001',
            checkedAt: NOW,
            log: ['Bearer ya29.secret'],
            error: { key: 'apiError.install.failed', params: { step: 'functions' } },
        });

        expect(installRecordOf(failed, LATER)).toEqual({
            state: 'failed',
            release: ADMIN_RELEASE,
            buildId: '0e2e0b1d-0001',
            checkedAt: NOW,
            detail: 'apiError.install.failed',
            params: { step: 'functions' },
        });
    });

    it('badPath_anAdminTextIsNoRecordedReason_andAViewNeverLookedAtTakesNow', () => {
        const blocked = view({ blocker: { key: 'apiError.install.noRepository' } });
        const expired = view({ error: { key: 'adminShell.session.googleExpired' } });

        expect(installRecordOf(blocked, LATER)).toEqual({
            state: 'notInstalled',
            checkedAt: LATER,
            detail: 'apiError.install.noRepository',
        });
        expect(installRecordOf(expired, LATER)).toEqual({ state: 'notInstalled', checkedAt: LATER });
    });
});

describe('installRecordOf: the build time (finding 39 of 2026-11-01)', () => {
    it('happyPath_aTimedReleaseKeepsItsBuildTime', () => {
        const installed = view({
            state: 'installed',
            installedRelease: ADMIN_RELEASE,
            installedReleaseTime: ADMIN_RELEASE_TIME,
            checkedAt: NOW,
        });

        expect(installRecordOf(installed, LATER)).toEqual({
            state: 'installed',
            release: ADMIN_RELEASE,
            releaseTime: ADMIN_RELEASE_TIME,
            checkedAt: NOW,
        });
    });

    it('badPath_aServerFromBeforeTheTimesIsSentNone_norIsAReleaseWithoutOne', () => {
        const installed = view({
            state: 'installed',
            installedRelease: ADMIN_RELEASE,
            installedReleaseTime: ADMIN_RELEASE_TIME,
            checkedAt: NOW,
        });

        expect(installRecordOf(installed, LATER, false)).toEqual({ state: 'installed', release: ADMIN_RELEASE, checkedAt: NOW });
        expect(installRecordOf({ ...installed, installedReleaseTime: null }, LATER)).toEqual({
            state: 'installed',
            release: ADMIN_RELEASE,
            checkedAt: NOW,
        });
    });
});

describe('the bootstrap record', () => {
    it('happyPath_theObservedTargetsGoIntoTheRecordAndBackAfterAReload', () => {
        const before = state();
        const looked = { ...before, install: { ...before.install, pipeline: view({ state: 'working', checkedAt: NOW }, 'pipeline') } };

        const record = bootstrapRecordOf(looked, NOW);
        expect(record.install).toEqual({ pipeline: { state: 'working', checkedAt: NOW } });
        expect(isBootstrapRecord(record)).toBe(true);
        expect(observedInstall(before, NOW)).toBeUndefined();

        const restored = applyBootstrapRecord(state(), record);
        expect(restored.install.pipeline.state).toBe('working');
        expect(restored.steps.pipeline.state).toBe('pending');
        expect(recordCloudRequestOf(record)).toMatchObject({ install: { pipeline: { state: 'working' } } });
    });

    it('badPath_aRecordWhoseInstallHoldsALogLineIsDropped', () => {
        const record = { ...bootstrapRecordOf(state(), NOW), install: { server: { state: 'failed', checkedAt: NOW, log: 'ya29.x' } } };

        expect(isBootstrapRecord(record)).toBe(false);
    });
});

describe('withRecordedInstall', () => {
    it('happyPath_theServersRecordInAnAdminSessionLandsOnItsCard', () => {
        const recorded = {
            server: { state: 'updateAvailable', release: '0.9.0', checkedAt: NOW },
            site: { state: 'installed', checkedAt: NOW },
        } as const;

        const applied = applyStatusView(state('normal'), statusView({ install: recorded }), START);

        expect(applied.install.server).toMatchObject({ state: 'updateAvailable', installedRelease: '0.9.0' });
        expect(applied.install.site.state).toBe('installed');
        expect(applied.steps.site.state).toBe('ok');
        expect(applied.steps.deploy.state).toBe('ok');
    });

    it('badPath_aRecordOlderThanWhatTheCardSawIsIgnored_aStoppedOneKeepsItsReason', () => {
        const seen = { ...state('normal') };
        const fresh = { ...seen, install: { ...seen.install, site: view({ state: 'installed', checkedAt: NOW }, 'site') } };

        const kept = withRecordedInstall(fresh, { site: { state: 'failed', checkedAt: EARLIER } });
        const stopped = withRecordedInstall(fresh, {
            site: { state: 'failed', checkedAt: LATER, detail: 'apiError.install.failed', params: { step: 'hosting' } },
        });
        const unknownReason = withRecordedInstall(fresh, { site: { state: 'failed', checkedAt: LATER, detail: 'apiError.not.a.code' } });

        expect(kept.install.site.state).toBe('installed');
        expect(stopped.install.site.error).toEqual({ key: 'apiError.install.failed', params: { step: 'hosting' } });
        expect(stopped.steps.site.state).toBe('invalid');
        expect(unknownReason.install.site.error).toBeNull();
        expect(withRecordedInstall(fresh, undefined)).toBe(fresh);
        expect(
            withRecordedInstall(fresh, { site: { state: 'failed', checkedAt: LATER, detail: 'apiError.install.failed' } }).install.site
                .error,
        ).toEqual({
            key: 'apiError.install.failed',
        });
    });
});

describe('withRecordedInstall: a record read against this admin (finding 39 of 2026-11-01)', () => {
    it('happyPath_anInstalledRecordOfAnOlderBuildOfTheVersionIsAnUpdateForThisAdmin', () => {
        // The live case: the admin 1.0.0+9e2e6b5 recorded its server installed; Hosting now serves a newer build of 1.0.0.
        const recorded = { server: { state: 'installed', release: '1.0.0+9e2e6b5', checkedAt: NOW } } as const;

        const applied = applyStatusView(state('normal'), statusView({ install: recorded }), START);

        expect(applied.install.server).toMatchObject({
            state: 'updateAvailable',
            installedRelease: '1.0.0+9e2e6b5',
            installedReleaseTime: null,
        });
        expect(applied.steps.deploy.state).toBe('ok');
    });

    it('badPath_aRecordOfANewerBuildIsNewerThanThisAdmin_andOneOfThisVeryReleaseStaysInstalled', () => {
        const newer = { state: 'installed', release: '1.0.0+fffffff', releaseTime: ADMIN_RELEASE_TIME + 60, checkedAt: NOW } as const;
        const same = { state: 'updateAvailable', release: ADMIN_RELEASE, checkedAt: NOW } as const;

        const applied = withRecordedInstall(state('normal'), { server: newer, site: same });

        expect(applied.install.server).toMatchObject({ state: 'newerInstalled', installedReleaseTime: ADMIN_RELEASE_TIME + 60 });
        expect(applied.install.site.state).toBe('installed');
    });
});
