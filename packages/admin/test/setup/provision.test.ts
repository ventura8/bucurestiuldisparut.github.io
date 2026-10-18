import { PROVISION_ITEMS, type ProvisionItem } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { createSetupContext, createSetupStore } from '../../src/setup/context.js';
import type { ProvisionItemResult, SetupCloud } from '../../src/setup/ports.js';
import { createProvisionFlow } from '../../src/setup/provision.js';
import { initialSetupState, withStep } from '../../src/setup/state.js';
import { createHarness, functionsError, googleError, provisionedItems, statusView } from './harness.js';

function setup(mode: 'bootstrap' | 'normal' = 'bootstrap') {
    const harness = createHarness();
    const base = ['signIn', 'billing'].reduce(
        (state, id) => withStep(state, id as 'signIn', { state: 'ok' }),
        initialSetupState(harness.host, mode),
    );
    const ctx = createSetupContext(harness.deps, createSetupStore({ ...base, openStep: 'provision' }));
    return { harness, ctx, flow: createProvisionFlow(ctx) };
}

/** A provisioner that reports `results` one by one, then answers them all. */
function reporting(results: readonly ProvisionItemResult[]): SetupCloud['provision'] {
    return (_access, _only, onItem) => {
        for (const result of results) {
            onItem(result);
        }
        return Promise.resolve(results);
    };
}

const ALL_OK: readonly ProvisionItemResult[] = PROVISION_ITEMS.map((id) => ({ id, state: id === 'scheduler' ? 'pending' : 'ok' }));

describe('provision: run', () => {
    it('happyPath_oneClickOneConsentProvisionsEveryItem', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.provision.mockImplementation(reporting(ALL_OK));

        await flow.run();

        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(harness.cloud.provision).toHaveBeenCalledWith(harness.google.current, null, expect.any(Function));
        expect(ctx.state().steps.provision).toMatchObject({ state: 'ok', busy: false, used: { inputs: 1, consents: 1 } });
        expect(ctx.state().provision.items.find((item) => item.id === 'scheduler')?.state).toBe('pending');
        expect(ctx.state().openStep).toBe('deploy');
        expect(harness.backend.recordCloud).not.toHaveBeenCalled();
    });

    it('badPath_aFailedItemLeavesTheOthersAndRetryRunsOnlyWhatIsNotOk', async () => {
        const { harness, ctx, flow } = setup();
        const failed = ALL_OK.map((item) =>
            item.id === 'secrets' ? { id: item.id, state: 'unavailable' as const, detail: 'apiError.unavailable' as const } : item,
        );
        harness.cloud.provision.mockImplementationOnce(reporting(failed));

        await flow.run();
        expect(ctx.state().steps.provision.state).toBe('unavailable');
        expect(ctx.state().provision.items.find((item) => item.id === 'secrets')?.detail).toEqual({ key: 'apiError.unavailable' });

        harness.cloud.provision.mockImplementationOnce(
            reporting([
                { id: 'secrets', state: 'ok' },
                { id: 'scheduler', state: 'pending' },
            ]),
        );
        await flow.run();

        expect(harness.cloud.provision.mock.calls[1]?.[1]).toEqual<ProvisionItem[]>(['secrets', 'scheduler']);
        expect(ctx.state().steps.provision).toMatchObject({ state: 'ok', used: { inputs: 2, consents: 1 } });
    });

    it('badPath_aTokenThatExpiresMidRunStopsWithContinue', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.provision.mockImplementationOnce((_access, _only, onItem) => {
            onItem({ id: 'apis', state: 'ok' });
            return Promise.reject(googleError('unauthorized'));
        });

        await flow.run();

        expect(ctx.state().steps.provision).toMatchObject({
            busy: false,
            needsContinue: true,
            error: { key: 'adminShell.session.googleExpired' },
        });
        expect(harness.google.dropped).toBe(1);
        expect(ctx.state().provision.items[0]).toEqual({ id: 'apis', state: 'ok', detail: null });
    });

    it('badPath_aRunTheProvisionerStoppedAtA401OffersContinueAndDropsTheToken', async () => {
        const { harness, ctx, flow } = setup('normal');
        // The provisioner reports the refused item and the ones it did, then stops without throwing.
        harness.cloud.provision.mockImplementationOnce(
            reporting([
                { id: 'apis', state: 'ok' },
                { id: 'secrets', state: 'invalid', detail: 'adminShell.session.googleExpired' },
            ]),
        );

        await flow.run();

        expect(ctx.state().steps.provision).toMatchObject({
            busy: false,
            needsContinue: true,
            error: { key: 'adminShell.session.googleExpired' },
        });
        expect(harness.google.dropped).toBe(1);
        expect(harness.backend.recordCloud).toHaveBeenCalledTimes(1);
    });

    it('badPath_aClosedPopupRunsNothing', async () => {
        const { harness, flow } = setup();
        harness.google.answer = () => Promise.resolve(null);

        await flow.run();

        expect(harness.cloud.provision).not.toHaveBeenCalled();
    });
});

describe('provision: normal mode', () => {
    it('happyPath_reCheckRunsTheReadOnlyDoctorAndRecordsIt', async () => {
        const { harness, ctx, flow } = setup('normal');
        harness.cloud.doctor.mockImplementation((_access, _only, onItem) => {
            onItem({ id: 'apis', state: 'ok' });
            onItem({
                id: 'buckets',
                state: 'invalid',
                detail: 'adminSetup.provision.orgPolicy',
                params: { constraint: 'storage.publicAccessPrevention' },
            });
            onItem({ id: 'iam', state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/owner' } });
            onItem({ id: 'secrets', state: 'unavailable', detail: 'apiError.unavailable' });
            return Promise.resolve([]);
        });
        harness.backend.recordCloud.mockResolvedValue({
            status: statusView({ provision: { state: 'ok', checkedAt: null, items: provisionedItems() } }),
        });

        await flow.recheck();

        expect(harness.cloud.doctor).toHaveBeenCalledWith(harness.google.current, null, expect.any(Function));
        expect(harness.backend.recordCloud).toHaveBeenCalledWith({
            provision: {
                items: [
                    { id: 'apis', state: 'ok' },
                    { id: 'iam', state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/owner' } },
                    { id: 'buckets', state: 'invalid' },
                    { id: 'secrets', state: 'unavailable', detail: 'apiError.unavailable' },
                ],
            },
        });
        expect(ctx.state().steps.provision.state).toBe('ok');
    });

    it('badPath_aRecordThatFailsIsShown', async () => {
        const { harness, ctx, flow } = setup('normal');
        harness.cloud.provision.mockImplementation(reporting(ALL_OK));
        harness.backend.recordCloud.mockRejectedValue(functionsError('apiError.notAdmin'));

        await flow.run();

        expect(ctx.state().steps.provision.error).toEqual({ key: 'apiError.notAdmin' });
    });

    it('badPath_nothingReportedIsNotRecorded', async () => {
        const { harness, flow } = setup('normal');

        await flow.recheck();

        expect(harness.backend.recordCloud).not.toHaveBeenCalled();
    });
});

describe('provision: the scheduler after the deployment', () => {
    it('happyPath_theLiveTokenChecksTheSchedulerWithoutAClick', async () => {
        const { harness, ctx, flow } = setup();
        harness.google.grant('cloudPlatform');
        harness.cloud.doctor.mockImplementation((_access, _only, onItem) => {
            onItem({ id: 'scheduler', state: 'ok' });
            return Promise.resolve([]);
        });

        await flow.checkScheduler();

        expect(harness.cloud.doctor).toHaveBeenCalledWith(harness.google.current, ['scheduler'], expect.any(Function));
        expect(ctx.state().provision.items.find((item) => item.id === 'scheduler')?.state).toBe('ok');
        expect(harness.google.requests).toEqual([]);
    });

    it('badPath_withoutATokenTheSchedulerWaitsForTheNextCheck', async () => {
        const { harness, flow } = setup();

        await flow.checkScheduler();

        expect(harness.cloud.doctor).not.toHaveBeenCalled();
    });

    it('badPath_aFailedSchedulerCheckIsLoggedOnly', async () => {
        const { harness, ctx, flow } = setup();
        harness.google.grant('cloudPlatform');
        harness.cloud.doctor.mockRejectedValue(googleError('unavailable'));

        await flow.checkScheduler();

        expect(ctx.state().steps.provision.error).toBeNull();
        expect(harness.logs.records.at(-1)).toMatchObject({ level: 'warn', message: 'scheduler not checked' });
    });
});
