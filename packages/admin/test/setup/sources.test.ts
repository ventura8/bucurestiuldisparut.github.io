// M28 (docs/research/M28-sources.md §4): the Sources step's flow, the USGS step it leaves out and the platform card's state.
import { DEFAULT_SOURCES } from '@hcm/shared/sources';
import { describe, expect, it } from 'vitest';

import { createSetupController } from '../../src/setup/controller.js';
import { withChoice } from '../../src/setup/sources.js';
import { initialSetupState, refreshDerived, withStep, type SetupState } from '../../src/setup/state.js';
import { createHarness, provisionedItems, statusView } from './harness.js';

const STEPS_AT = '2026-10-12T09:00:00.000Z';
const OK = { state: 'ok' as const, checkedAt: STEPS_AT };

/** A server record with everything before the sources done (billing, provisioning and Mapbox). */
const PLATFORM_DONE = statusView({ billing: OK, provision: { ...OK, items: provisionedItems(true) }, mapbox: OK });

function started(configure: (harness: ReturnType<typeof createHarness>) => void = () => undefined) {
    const harness = createHarness();
    harness.backend.status.mockResolvedValue(PLATFORM_DONE);
    configure(harness);
    const controller = createSetupController(harness.deps);
    return { harness, controller };
}

function withDone(state: SetupState, ...ids: Parameters<typeof withStep>[1][]): SetupState {
    return ids.reduce((next, id) => withStep(next, id, { state: 'ok', checkedAt: STEPS_AT }), state);
}

describe('the Sources step', () => {
    it('happyPath_aCityWithoutAChoiceOpensTheStepWithTheSuggestedSwitches @S-A171-HAPPY-SAVE-DEFAULTS', async () => {
        const { harness, controller } = started((h) => {
            h.sources.read.mockResolvedValue(undefined);
        });

        await controller.start('normal', null);
        expect(controller.getState().steps.sources.state).toBe('missing');
        expect(controller.getState().sources).toEqual({ choices: DEFAULT_SOURCES, saved: null });

        await controller.intents.saveSources();

        expect(harness.sources.save).toHaveBeenCalledWith(DEFAULT_SOURCES);
        expect(controller.getState().steps.sources).toMatchObject({ state: 'ok', busy: false, used: { inputs: 1, consents: 0 } });
        expect(controller.getState().sources.saved).toEqual(DEFAULT_SOURCES);
        expect(harness.backend.recordCloud).not.toHaveBeenCalled();
    });

    it('happyPath_aStoredChoiceIsReadAndTheStepIsDone', async () => {
        const { controller } = started((h) => {
            h.sources.read.mockResolvedValue({ cloudAi: true });
        });

        await controller.start('normal', null);

        expect(controller.getState().steps.sources.state).toBe('ok');
        expect(controller.getState().sources.choices).toMatchObject({ cloudAi: true, usgs: true });
    });

    it('happyPath_withoutUsgsAndLandsatTheUsgsStepLeavesAndIsRecordedForLater @S-A171-HAPPY-USGS-LEFT-OUT', async () => {
        const { harness, controller } = started((h) => {
            h.sources.read.mockResolvedValue(undefined);
            h.backend.recordCloud.mockResolvedValue({
                status: statusView({ ...PLATFORM_DONE, usgs: { state: 'missing', checkedAt: STEPS_AT, postponedAt: STEPS_AT } }),
            });
        });
        await controller.start('normal', null);
        expect(controller.getState().order).toContain('usgs');

        controller.intents.chooseSource('usgs', false);
        controller.intents.chooseSource('landsat', false);
        await controller.intents.saveSources();

        const state = controller.getState();
        expect(harness.backend.recordCloud).toHaveBeenCalledWith({ postponed: { usgs: true } });
        expect(state.order).not.toContain('usgs');
        expect(state.total).toBe(state.order.length);
        expect(state.steps.sources.used.inputs).toBe(3);
        expect(state.openStep).not.toBe('usgs');
    });

    it('badPath_aSaveTheStoreRefusesSaysWhatToDoAndKeepsTheSwitches @S-A171-BAD-SAVE-REFUSED', async () => {
        const { harness, controller } = started((h) => {
            h.sources.read.mockResolvedValue(undefined);
            h.sources.save.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
        });
        await controller.start('normal', null);
        controller.intents.chooseSource('cloudAi', true);

        await controller.intents.saveSources();

        expect(controller.getState().steps.sources).toMatchObject({ busy: false, error: { key: 'adminSetup.sources.saveFailed' } });
        expect(controller.getState().sources).toMatchObject({ saved: null, choices: { cloudAi: true } });
        expect(harness.logs.records.some((record) => record.message === 'setup.sources.saveFailed')).toBe(true);
    });

    it('badPath_aChoiceThatCannotBeReadSaysCheckAgain', async () => {
        const { controller } = started((h) => {
            h.sources.read.mockRejectedValue('offline');
        });

        await controller.start('normal', null);

        expect(controller.getState().steps.sources.error).toEqual({ key: 'adminSetup.sources.readFailed' });
        await controller.intents.recheck('sources');
    });

    it('badPath_whenTheServerCannotRecordUsgsForLaterTheChoiceStillSaves', async () => {
        const { harness, controller } = started((h) => {
            h.sources.read.mockResolvedValue(undefined);
            h.backend.recordCloud.mockRejectedValue(new Error('offline'));
        });
        await controller.start('normal', null);
        controller.intents.chooseSource('usgs', false);
        controller.intents.chooseSource('landsat', false);

        await controller.intents.saveSources();

        expect(controller.getState().steps.sources.state).toBe('ok');
        expect(harness.logs.records.some((record) => record.message === 'setup.sources.usgsNotRecorded')).toBe(true);
    });

    it('happyPath_paidScansGoOffWithTheDeclassifiedFrames', () => {
        const on = withChoice(DEFAULT_SOURCES, 'usgsOrders', true);

        expect(on.usgsOrders).toBe(true);
        expect(withChoice(on, 'usgs', false)).toMatchObject({ usgs: false, usgsOrders: false });
    });
});

describe('the platform card', () => {
    it('happyPath_itIsDoneOnceBillingProvisioningTheServerAndMapboxAre', () => {
        const state = initialSetupState(createHarness().host, 'normal');

        expect(refreshDerived(state).steps.platform.state).toBe('missing');
        const done = withDone(state, 'billing', 'provision', 'deploy', 'mapbox');
        expect(done.steps.platform.state).toBe('ok');
    });

    it('badPath_itReadsCheckingWhileOneOfItsStepsDoes', () => {
        const state = initialSetupState(createHarness().host, 'normal');

        expect(state.steps.platform.firstCheck).toBe(true);
        expect(state.loading).toBe(true);
    });
});

describe('ready without USGS', () => {
    it('happyPath_setupIsDoneWithoutUsgsWhenNoSourceNeedsIt', () => {
        const base = initialSetupState(createHarness().host, 'normal');
        const chosen = refreshDerived({
            ...base,
            sources: { choices: DEFAULT_SOURCES, saved: { ...DEFAULT_SOURCES, usgs: false, landsat: false } },
        });
        const done = withDone(chosen, 'billing', 'provision', 'mapbox');

        expect(done.ready).toBe(true);
        expect(done.doneNote).toBeNull();
    });

    it('badPath_withUsgsChosenSetupWaitsForIt', () => {
        const done = withDone(initialSetupState(createHarness().host, 'normal'), 'billing', 'provision', 'mapbox');

        expect(done.ready).toBe(false);
    });
});
