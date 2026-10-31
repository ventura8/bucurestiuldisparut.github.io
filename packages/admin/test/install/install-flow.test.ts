import { createLogger, type InstallTarget } from '@hcm/shared';
import { NEWER_SERVER_RELEASE, PLANTED_LOG_SECRETS, registryFunctions } from '@hcm/test-support/fakes';
import { describe, expect, it, vi } from 'vitest';

import { InstallBundleError } from '../../src/install/bundle.js';
import { createInstallFlow, IDLE_LOOK_MS, RUNNING_LOOK_MS, type InstallFlowDeps } from '../../src/install/install-flow.js';
import type { InstallTargetView } from '../../src/install/model.js';
import type { InstallAccess, InstallerPort } from '../../src/install/ports.js';
import { FakeClock, FakeVisibility, flush, googleError } from '../setup/harness.js';
import { ACCESS, installWorld, RELEASE, type InstallWorld } from './world.js';

/**
 * One install target as its card follows it (`docs/research/M6-interfaces.md` §1.5, §1.7): looks on the injected clock,
 * the build's log read when it matters, a click that installs once, a race retried inside the build, a build Google
 * ended submitted again once.
 */

interface FlowWorld {
    readonly clock: FakeClock;
    readonly views: InstallTargetView[];
    readonly expired: ReturnType<typeof vi.fn>;
    readonly flow: ReturnType<typeof createInstallFlow>;
    live: InstallAccess | null;
    click: InstallAccess | null;
    readonly latest: () => InstallTargetView;
}

function flowOver(installer: InstallerPort, target: InstallTarget = 'server'): FlowWorld {
    const clock = new FakeClock();
    const views: InstallTargetView[] = [];
    const expired = vi.fn();
    const state = { live: ACCESS as InstallAccess | null, click: ACCESS as InstallAccess | null };
    const deps: InstallFlowDeps = {
        target,
        installer,
        clock,
        visibility: new FakeVisibility(),
        log: createLogger('test', { sink: () => undefined }),
        release: RELEASE,
        liveAccess: () => state.live,
        clickAccess: () => Promise.resolve(state.click),
        report: (view) => {
            views.push(view);
        },
        expired,
    };
    const flow = createInstallFlow(deps);
    return Object.assign(state, {
        clock,
        views,
        expired,
        flow,
        latest: () => {
            const view = views.at(-1);
            if (view === undefined) {
                throw new Error('no view yet');
            }
            return view;
        },
    });
}

/** The flow over the fake upstreams (the returned object is the one the flow reads `live` and `click` from). */
async function world(target: InstallTarget = 'server'): Promise<{ readonly install: InstallWorld } & FlowWorld> {
    const install = await installWorld();
    return Object.assign(flowOver(install.installer, target), { install });
}

describe('watching', () => {
    it('happyPath_aTargetIsLookedAtNowThenEveryMinuteWhileNothingRuns', async () => {
        const { install, clock, flow } = await world();

        flow.watch();
        await vi.waitFor(() => {
            expect(flow.view().checkedAt).not.toBeNull();
        });
        expect(flow.view()).toMatchObject({ state: 'notInstalled', blocker: null, checkedAt: new Date(clock.now()).toISOString() });
        const looks = install.fakes.callsTo('cloud-build.builds.list').length;

        await clock.advance(RUNNING_LOOK_MS);
        expect(install.fakes.callsTo('cloud-build.builds.list')).toHaveLength(looks);
        await clock.advance(IDLE_LOOK_MS);
        expect(install.fakes.callsTo('cloud-build.builds.list')).toHaveLength(looks + 1);
        flow.dispose();
    });

    it('badPath_withoutALiveTokenNothingIsAsked', async () => {
        const w = await world();
        w.live = null;

        w.flow.watch();
        await flush();
        await w.flow.refresh();

        expect(w.install.fakes.callsTo('cloud-build.builds.list')).toHaveLength(0);
        expect(w.clock.pending()).toBe(0);
    });
});

describe('installing', () => {
    it('happyPath_oneClickQueuesOneBuildThatIsFollowedUntilTheServerIsInstalled', async () => {
        const { install, clock, flow, latest } = await world();

        await flow.install();
        expect(latest()).toMatchObject({ state: 'queued', busy: false, error: null });
        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(1);

        install.fakes.scenario('cloud-build.start');
        await clock.advance(RUNNING_LOOK_MS);
        expect(latest().state).toBe('working');
        expect(latest().steps[0]).toEqual({ id: 'fetch', state: 'now' });

        install.fakes.scenario('cloud-build.finish');
        await clock.advance(RUNNING_LOOK_MS);
        expect(latest()).toMatchObject({ state: 'installed', installedRelease: RELEASE });
        expect(latest().consoleUrl).toContain(latest().buildId ?? 'none');
        flow.dispose();
    });

    it('badPath_aBuildAlreadyQueuedIsFollowedNotDoubled', async () => {
        const { install, flow, latest } = await world();
        install.fakes.scenario('cloud-build.serverQueuedElsewhere');

        await flow.install();

        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
        expect(latest().state).toBe('queued');
        flow.dispose();
    });

    it('badPath_aNewerServerIsNeverReplaced', async () => {
        const { install, flow, latest } = await world();
        install.fakes.scenario('cloud-functions.deployedNewerRelease');

        await flow.install();

        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
        expect(latest().state).toBe('newerInstalled');
        flow.dispose();
    });

    it('badPath_aNewerServerMissingAFunctionIsNamedAndNeverReplaced', async () => {
        const { install, flow, latest } = await world();
        install.fakes.scenario('cloud-functions.partialNewerRelease');

        await flow.install();

        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
        expect(latest()).toMatchObject({ state: 'newerInstalled', installedRelease: NEWER_SERVER_RELEASE });
        flow.dispose();
    });

    it('badPath_aBlockedTargetSubmitsNothing', async () => {
        const { install, flow, latest } = await world('pipeline');
        install.fakes.state.artifactRegistry.repositories.clear();

        await flow.install();

        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
        expect(latest().blocker).toEqual({ key: 'apiError.install.noRepository', params: { repository: 'hcm' } });
        flow.dispose();
    });

    it('badPath_aConsentNotGivenLeavesTheCardAsItWas', async () => {
        const w = await world();
        w.click = null;

        await w.flow.install();

        expect(w.install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
        expect(w.latest()).toMatchObject({ state: 'notInstalled', busy: false });
    });

    it('happyPath_anOlderServerIsUpdatedWithTheHoldersToken', async () => {
        const { install, flow, latest } = await world();
        install.fakes.scenario('cloud-functions.deployedOlderRelease');

        await flow.installWith(ACCESS);

        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(1);
        expect(latest().state).toBe('queued');
        flow.dispose();
    });
});

describe('what the build says', () => {
    it('happyPath_aFirstDeployRaceIsShownAsARetryWithItsTime', async () => {
        const { install, clock, flow, latest } = await world();
        install.fakes.scenario('cloud-build.serverRetries');
        await flow.install();
        install.fakes.scenario('cloud-build.start');

        await clock.advance(RUNNING_LOOK_MS);

        expect(latest()).toMatchObject({ state: 'retrying', retryReason: 'eventarcAgent' });
        expect(latest().retryAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        install.fakes.scenario('cloud-build.finish');
        await clock.advance(RUNNING_LOOK_MS);
        expect(latest().state).toBe('installed');
        flow.dispose();
    });

    it('badPath_aStoppedBuildNamesItsStepAndShowsItsRedactedLog', async () => {
        const { install, clock, flow, latest } = await world();
        install.fakes.scenario('cloud-build.serverFailsAtFunctions');
        await flow.install();
        install.fakes.scenario('cloud-build.finish');

        await clock.advance(RUNNING_LOOK_MS);

        expect(latest()).toMatchObject({ state: 'failed', failedStep: 'functions' });
        expect(latest().log.length).toBeGreaterThan(0);
        expect(latest().log.join('\n')).not.toContain(PLANTED_LOG_SECRETS[0]);
        const reads = install.fakes.callsTo('logging.entries.list').length;
        await clock.advance(IDLE_LOOK_MS);
        expect(install.fakes.callsTo('logging.entries.list')).toHaveLength(reads);
        flow.dispose();
    });

    it('badPath_retriesExhaustedNameTheMissingFunctions', async () => {
        const { install, clock, flow, latest } = await world();
        install.fakes.scenario('cloud-build.serverRetriesExhausted');
        await flow.install();
        install.fakes.scenario('cloud-build.finish');

        await clock.advance(RUNNING_LOOK_MS);

        expect(latest()).toMatchObject({ state: 'failed', failedStep: 'verify', missing: registryFunctions().slice(0, 2) });
        flow.dispose();
    });

    it('happyPath_aBuildGoogleEndedIsSubmittedAgainOnce', async () => {
        const { install, clock, flow, latest } = await world();
        install.fakes.scenario('cloud-build.serverInternalError');
        await flow.install();
        install.fakes.scenario('cloud-build.finish');

        await clock.advance(RUNNING_LOOK_MS);
        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(2);
        expect(latest().state).toBe('queued');

        install.fakes.scenario('cloud-build.finish');
        await clock.advance(RUNNING_LOOK_MS);
        await clock.advance(IDLE_LOOK_MS);
        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(2);
        expect(latest().state).toBe('failed');
        flow.dispose();
    });
});

describe('failures', () => {
    function port(changes: Partial<InstallerPort>): InstallerPort {
        return {
            observe: () => Promise.resolve({ installed: { complete: false, release: null }, build: null, progress: null, blocker: null }),
            submit: () => Promise.reject(new InstallBundleError('apiError.install.bundleMissing')),
            buildLog: () => Promise.resolve([]),
            consoleUrl: (id) => id,
            localBlocker: () => Promise.resolve(null),
            ...changes,
        };
    }

    it('badPath_aBundleThatCannotBeUsedIsSaidOnTheCard', async () => {
        const { flow, latest } = flowOver(port({}));

        await flow.install();

        expect(latest()).toMatchObject({ error: { key: 'apiError.install.bundleMissing' }, busy: false });
        flow.dispose();
    });

    it('badPath_anUnavailableGoogleIsShownAndLookedAtAgainLater', async () => {
        const observe = vi.fn<InstallerPort['observe']>().mockRejectedValueOnce(googleError('unavailable'));
        const { clock, flow, latest } = flowOver(port({ observe }));

        flow.watch();
        await flush();
        expect(latest()).toMatchObject({ state: 'unavailable', error: { key: 'apiError.unavailable' } });

        observe.mockResolvedValue({ installed: { complete: false, release: null }, build: null, progress: null, blocker: null });
        await clock.advance(4 * RUNNING_LOOK_MS);
        expect(latest()).toMatchObject({ state: 'notInstalled', error: null });
        flow.dispose();
    });

    it('badPath_anExpiredTokenStopsTheWatchAndSaysSo', async () => {
        const observe = vi.fn<InstallerPort['observe']>().mockRejectedValue(googleError('unauthorized'));
        const { clock, flow, expired, latest } = flowOver(port({ observe }));

        flow.watch();
        await flush();

        expect(expired).toHaveBeenCalledTimes(1);
        expect(latest().error).toEqual({ key: 'adminShell.session.googleExpired' });
        expect(clock.pending()).toBe(0);
    });

    it('badPath_aRefusalThatIsNotUnavailableKeepsTheState', async () => {
        const observe = vi.fn<InstallerPort['observe']>().mockRejectedValue(googleError('forbidden', { api: 'cloudbuild.googleapis.com' }));
        const { flow, latest } = flowOver(port({ observe }));

        await flow.refresh();

        expect(latest()).toMatchObject({ state: 'notInstalled', error: { key: 'apiError.cloud.apiDisabled' } });
    });

    describe("a blocker of the admin's own data, with no Google token", () => {
        const NOTHING = { key: 'apiError.install.nothingToShow' } as const;

        function blockedSite(localBlocker: InstallerPort['localBlocker']): FlowWorld {
            const observe = vi
                .fn<InstallerPort['observe']>()
                .mockResolvedValue({ installed: { complete: false, release: null }, build: null, progress: null, blocker: NOTHING });
            return flowOver(port({ observe, localBlocker }), 'site');
        }

        it('happyPath_theFirstCityPublishedWhileTheTokenWasGoneLiftsTheSitesBlocker', async () => {
            const localBlocker = vi.fn<InstallerPort['localBlocker']>().mockResolvedValueOnce(NOTHING).mockResolvedValue(null);
            const w = blockedSite(localBlocker);
            w.flow.watch();
            await flush();
            expect(w.latest().blocker).toEqual(NOTHING);

            w.live = null;
            await w.clock.advance(IDLE_LOOK_MS);
            expect(w.latest().blocker).toEqual(NOTHING);
            await w.clock.advance(IDLE_LOOK_MS);

            expect(localBlocker).toHaveBeenCalledTimes(2);
            expect(localBlocker).toHaveBeenCalledWith('site');
            expect(w.latest().blocker).toBeNull();
            expect(w.clock.pending()).toBe(0);
        });

        it('badPath_aFailedReadKeepsTheBlockerAndAnotherBlockerStopsTheWatch', async () => {
            const w = blockedSite(() => Promise.reject(new Error('offline')));
            w.flow.watch();
            await flush();
            w.live = null;
            await w.clock.advance(IDLE_LOOK_MS);
            expect(w.latest().blocker).toEqual(NOTHING);
            w.flow.dispose();

            const other = flowOver(port({}), 'server');
            other.live = null;
            other.flow.watch();
            await flush();
            expect(other.clock.pending()).toBe(0);
        });
    });
});
