// The Setup Assistant's install cards (docs/research/M6-interfaces.md §1.7, §1.8, §4.1): Install the server also starts
// the imagery pipeline, Publish the map, Update the map with one consent, Check again, the chips, the records.
import type { InstallState } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import type { CloudBuild } from '../../src/google/cloud-build.js';
import type { TargetObservation } from '../../src/install/ports.js';
import { createSetupContext, createSetupStore } from '../../src/setup/context.js';
import { createInstallCards } from '../../src/setup/install.js';
import { initialSetupState, withStep, type SetupMode } from '../../src/setup/state.js';
import { ADMIN_RELEASE, createHarness, flush, googleError } from './harness.js';

const SLUG = '1-0-0-abc1234';

function build(target: string, status: CloudBuild['status'], id = `b-${target}`): CloudBuild {
    return { id, status, steps: [], tags: ['hcm-install', `hcm-${target}`, `hcm-r-${SLUG}`], substitutions: {} };
}

function observed(changes: Partial<TargetObservation> = {}): TargetObservation {
    return { installed: { complete: false, release: null }, build: null, progress: null, blocker: null, ...changes };
}

function setup(mode: SetupMode = 'bootstrap') {
    const harness = createHarness();
    const base = (['signIn', 'billing', 'provision'] as const).reduce(
        (state, id) => withStep(state, id, { state: 'ok' }),
        initialSetupState(harness.host, mode),
    );
    const ctx = createSetupContext(harness.deps, createSetupStore(base));
    return { harness, ctx, cards: createInstallCards(ctx) };
}

describe('Install the server', () => {
    it('happyPath_oneClickWithTheLiveTokenInstallsTheServerAndThePipeline', async () => {
        const { harness, ctx, cards } = setup();
        harness.google.grant('cloudPlatform');

        await cards.installServer();

        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server', 'pipeline']);
        expect(ctx.state().install.server).toMatchObject({ state: 'queued', buildId: 'build-server-0001', busy: false });
        expect(ctx.state().steps.pipeline).toMatchObject({ state: 'pending' });
        expect(ctx.state().steps.deploy.used).toEqual({ inputs: 1, consents: 0 });
        expect(harness.google.requests).toEqual([]);
        cards.dispose();
    });

    it('badPath_withoutATokenTheSameClickAsksOneConsent_andABlockedPipelineWaits', async () => {
        const { harness, ctx, cards } = setup();
        harness.installer.observe.mockImplementation((target) =>
            Promise.resolve(
                observed(target === 'pipeline' ? { blocker: { key: 'apiError.install.noRepository', params: { repository: 'hcm' } } } : {}),
            ),
        );
        // The pipeline's blocker is known once the card looked (its watch).
        cards.watch(['pipeline']);

        await cards.installServer();
        await flush();

        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(ctx.state().steps.deploy.used).toEqual({ inputs: 1, consents: 1 });
        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server']);
        expect(ctx.state().install.pipeline.blocker).toEqual({ key: 'apiError.install.noRepository', params: { repository: 'hcm' } });
        cards.dispose();
    });

    it('badPath_anExpiredTokenOffersContinueOnTheCard', async () => {
        const { harness, ctx, cards } = setup();
        harness.google.grant('cloudPlatform');
        harness.installer.observe.mockRejectedValue(googleError('unauthorized'));

        cards.watch(['pipeline']);
        await flush();

        expect(ctx.state().steps.pipeline.needsContinue).toBe(true);
        expect(harness.google.dropped).toBe(1);
        cards.dispose();
    });
});

describe('Publish the map, Check again, Update the map', () => {
    it('happyPath_publishIsOneClickOnTheSiteCard', async () => {
        const { harness, ctx, cards } = setup('normal');
        harness.google.grant('cloudPlatform');

        await cards.install('site');

        expect(harness.installer.submit.mock.calls[0]?.[0]).toBe('site');
        expect(harness.installer.submit.mock.calls[0]?.[1].token).toBe(harness.google.current?.token);
        expect(ctx.state().steps.site).toMatchObject({ state: 'pending', used: { inputs: 1, consents: 0 } });
        cards.dispose();
    });

    it('happyPath_checkAgainLooksOnce_badPath_aRefusedConsentLooksAtNothing', async () => {
        const { harness, ctx, cards } = setup();
        harness.installer.observe.mockResolvedValue(observed({ installed: { complete: true, release: ADMIN_RELEASE } }));

        await cards.recheck('pipeline');
        expect(ctx.state().steps.pipeline).toMatchObject({ state: 'ok', used: { inputs: 1, consents: 1 } });

        harness.google.drop();
        harness.google.answer = () => Promise.resolve(null);
        const looks = harness.installer.observe.mock.calls.length;
        await cards.recheck('site');
        expect(harness.installer.observe.mock.calls).toHaveLength(looks);
        cards.dispose();
    });

    it('happyPath_updateTheMapAsksOnceForEveryTargetBehind_theSiteAfterTheServer', async () => {
        const { harness, ctx, cards } = setup('normal');
        const server = { state: 'updateAvailable' as InstallState };
        harness.installer.observe.mockImplementation((target) => {
            if (target === 'server' && server.state === 'installed') {
                return Promise.resolve(
                    observed({ installed: { complete: true, release: ADMIN_RELEASE }, build: build('server', 'SUCCESS') }),
                );
            }
            const older = target === 'pipeline' ? { complete: true, release: ADMIN_RELEASE } : { complete: true, release: '0.9.0' };
            return Promise.resolve(observed({ installed: older }));
        });
        harness.google.grant('cloudPlatform');
        cards.watch(['server', 'pipeline', 'site']);
        await flush();
        harness.google.drop();

        await cards.updateMap('site');

        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server']);
        server.state = 'installed';
        await harness.clock.advance(10_000);
        await flush();
        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server', 'site']);
        expect(ctx.state().steps.site.used).toEqual({ inputs: 1, consents: 1 });
        cards.dispose();
    });

    it('happyPath_aTargetRecordedBehindIsUpdatedBeforeItsCardLooked', async () => {
        const { harness, ctx, cards } = setup('normal');
        ctx.update((state) => ({
            ...state,
            install: { ...state.install, pipeline: { ...state.install.pipeline, state: 'updateAvailable' } },
        }));
        harness.installer.observe.mockResolvedValue(observed({ installed: { complete: true, release: '0.9.0' } }));

        await cards.updateMap('pipeline');

        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['pipeline']);
        cards.dispose();
    });

    it('happyPath_updateTheMapAlsoInstallsAMissingPipeline_andRetriesAStoppedTarget', async () => {
        // Finding 3 of the M6 review: a pipeline not installed (blocked at the server's click, or a server installed from
        // GitHub Actions) had no way in; finding 1: a stopped target had no Try again in an admin session.
        const { harness, ctx, cards } = setup('normal');
        ctx.update((state) => ({
            ...state,
            install: {
                ...state.install,
                server: { ...state.install.server, state: 'failed' },
                pipeline: { ...state.install.pipeline, state: 'notInstalled', checkedAt: '2026-10-30T09:00:00.000Z' },
                site: { ...state.install.site, state: 'notInstalled', checkedAt: '2026-10-30T09:00:00.000Z' },
            },
        }));
        harness.installer.observe.mockImplementation((target) =>
            Promise.resolve(
                target === 'server'
                    ? observed({ installed: { complete: true, release: '0.9.0' }, build: build('server', 'FAILURE') })
                    : observed(),
            ),
        );

        await cards.updateMap('deploy');

        expect(harness.installer.submit.mock.calls.map(([target]) => target).toSorted((left, right) => left.localeCompare(right))).toEqual([
            'pipeline',
            'server',
        ]);
        cards.dispose();
    });

    it('badPath_nothingBehindAsksNothing', async () => {
        const { harness, cards } = setup('normal');

        await cards.updateMap('deploy');

        expect(harness.google.requests).toEqual([]);
        expect(harness.installer.submit).not.toHaveBeenCalled();
    });
});

describe('records', () => {
    it('happyPath_inAnAdminSessionAChangedStateIsRecordedOnce', async () => {
        const { harness, cards } = setup('normal');
        harness.google.grant('cloudPlatform');
        harness.installer.observe.mockResolvedValue(observed({ installed: { complete: true, release: ADMIN_RELEASE } }));

        cards.watch(['pipeline']);
        await flush();
        await harness.clock.advance(60_000);
        await flush();

        expect(harness.backend.recordCloud).toHaveBeenCalledTimes(1);
        expect(harness.backend.recordCloud.mock.calls[0]?.[0]).toMatchObject({
            install: { pipeline: { state: 'installed', release: ADMIN_RELEASE } },
        });
        cards.dispose();
    });

    it('badPath_aRecordThatFailsIsLoggedAndTheCardGoesOn', async () => {
        const { harness, ctx, cards } = setup('normal');
        harness.google.grant('cloudPlatform');
        harness.backend.recordCloud.mockRejectedValue(new Error('offline'));

        cards.watch(['site']);
        await flush();

        expect(ctx.state().install.site.state).toBe('notInstalled');
        expect(harness.logs.records.some((record) => record.message === 'install state not recorded')).toBe(true);
        cards.dispose();
    });

    it('badPath_aPassingGoogleOutageIsNeverRecorded', async () => {
        // Finding 5 of the M6 review: a recorded `unavailable` made Setup look not done until the next look with a token.
        const { harness, ctx, cards } = setup('normal');
        harness.google.grant('cloudPlatform');
        harness.installer.observe.mockResolvedValueOnce(observed({ installed: { complete: true, release: ADMIN_RELEASE } }));
        harness.installer.observe.mockRejectedValue(googleError('unavailable'));

        cards.watch(['server']);
        await flush();
        await harness.clock.advance(60_000);
        await flush();

        expect(ctx.state().install.server.state).toBe('unavailable');
        expect(harness.backend.recordCloud).toHaveBeenCalledTimes(1);
        expect(harness.backend.recordCloud.mock.calls[0]?.[0]).toMatchObject({ install: { server: { state: 'installed' } } });
        cards.dispose();
    });

    it('badPath_inStartUpModeNothingIsSentToTheServer', async () => {
        const { harness, cards } = setup('bootstrap');
        harness.google.grant('cloudPlatform');

        cards.watch(['server']);
        await flush();

        expect(harness.backend.recordCloud).not.toHaveBeenCalled();
        cards.dispose();
    });
});
