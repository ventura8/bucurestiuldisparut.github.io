import { describe, expect, it, vi } from 'vitest';

import { bootstrapRecordKey, readBootstrapRecord, writeBootstrapRecord, type BootstrapRecord } from '../../src/setup/bootstrap-record.js';
import { createSetupController } from '../../src/setup/controller.js';
import { PROJECT_ID, createHarness, flush, functionsError, provisionedItems, statusView, type Harness } from './harness.js';

const CHECKED = '2026-10-12T08:00:00.000Z';
const BUDGET = 'billingAccounts/AAAAAA-BBBBBB-CCCCCC/budgets/b-1';

const RECORD: BootstrapRecord = {
    version: 1,
    projectId: PROJECT_ID,
    updatedAt: CHECKED,
    steps: {
        signIn: { state: 'ok', checkedAt: CHECKED },
        billing: { state: 'ok', checkedAt: CHECKED },
        provision: { state: 'ok', checkedAt: CHECKED },
        deploy: { state: 'pending', checkedAt: CHECKED, detail: 'adminSetup.deploy.progress', params: { ready: '3', total: '32' } },
    },
    billing: { accountName: 'billingAccounts/AAAAAA-BBBBBB-CCCCCC', budgetId: BUDGET, budgetAmount: 5, currency: 'USD' },
    provision: { items: provisionedItems() },
    deploy: { ready: 3, total: 32 },
};

const READY_VIEW = statusView({
    billing: { state: 'ok', checkedAt: CHECKED, budgetId: BUDGET },
    provision: { state: 'ok', checkedAt: CHECKED, items: provisionedItems(true) },
});

function setup(prepare: (harness: Harness) => void = () => undefined) {
    const harness = createHarness();
    prepare(harness);
    return { harness, controller: createSetupController(harness.deps) };
}

describe('start', () => {
    it('happyPath_aNewOwnerStartsAtBillingWithSignInDone', async () => {
        const { harness, controller } = setup((h) => {
            h.google.grant('cloudReadOnly');
        });

        await controller.start('bootstrap', null);

        expect(controller.getState()).toMatchObject({ mode: 'bootstrap', openStep: 'billing', done: 1 });
        expect(controller.getState().steps.signIn.state).toBe('ok');
        expect(harness.cloud.disabledApis).toHaveBeenCalledTimes(1);
        expect(harness.backend.status).not.toHaveBeenCalled();
    });

    it('happyPath_aReloadResumesFromTheRecordAndWatchesTheDeployment', async () => {
        const { harness, controller } = setup((h) => {
            writeBootstrapRecord(h.session, RECORD);
            h.google.grant('cloudPlatform');
        });

        await controller.start('bootstrap', null);
        await flush();

        expect(controller.getState().openStep).toBe('deploy');
        expect(harness.cloud.deployment).toHaveBeenCalledTimes(1);
        expect(controller.getState().deploy.watching).toBe(true);
        controller.dispose();
        expect(harness.clock.pending()).toBe(0);
    });

    it('badPath_aReloadWithoutATokenOffersContinueOnTheDeployment', async () => {
        const { harness, controller } = setup((h) => {
            writeBootstrapRecord(h.session, RECORD);
        });

        await controller.start('bootstrap', null);
        await flush();

        expect(harness.cloud.deployment).not.toHaveBeenCalled();
        expect(controller.getState().steps.deploy.needsContinue).toBe(true);
    });

    it('happyPath_theAddressCanNameTheStepToOpen', async () => {
        const { controller } = setup();

        await controller.start('bootstrap', 'provision');

        expect(controller.getState().openStep).toBe('provision');
    });

    it('happyPath_normalModeLoadsTheServersRecordAndTheImport', async () => {
        const { harness, controller } = setup((h) => {
            h.backend.status.mockResolvedValue(READY_VIEW);
        });

        await controller.start('normal', null);

        expect(harness.backend.status).toHaveBeenCalledTimes(1);
        expect(harness.importer.detect).toHaveBeenCalledTimes(1);
        expect(controller.getState()).toMatchObject({ openStep: 'mapbox', error: null, done: 5 });
    });

    it('badPath_aCardOpenedWhileTheFirstChecksRunStaysOpen', async () => {
        const detection: { finish?: (progress: { done: number; total: number; failed: [] }) => void } = {};
        const { harness, controller } = setup((h) => {
            h.backend.status.mockResolvedValue(READY_VIEW);
            h.importer.detect.mockReturnValue(
                new Promise((resolve) => {
                    detection.finish = resolve;
                }),
            );
        });

        const starting = controller.start('normal', null);
        await vi.waitFor(() => {
            expect(harness.importer.detect).toHaveBeenCalledTimes(1);
        });
        controller.intents.open('analytics');
        detection.finish?.({ done: 0, total: 45, failed: [] });
        await starting;

        expect(controller.getState().openStep).toBe('analytics');
    });

    it('badPath_aServerThatDoesNotAnswerIsShownOnThePage', async () => {
        const { controller } = setup((h) => {
            h.backend.status.mockRejectedValue(functionsError('apiError.unavailable'));
        });

        await controller.start('normal', null);

        expect(controller.getState().error).toEqual({ key: 'apiError.unavailable' });
    });
});

describe('the switch to normal mode', () => {
    it('happyPath_theClaimCreatesTheCityRecordsTheBootstrapAndOpensMapbox', async () => {
        const { harness, controller } = setup((h) => {
            writeBootstrapRecord(h.session, RECORD);
            h.backend.status.mockResolvedValue(READY_VIEW);
        });
        await controller.start('bootstrap', null);

        await controller.setMode('normal');

        expect(harness.backend.createCity).toHaveBeenCalledTimes(1);
        expect(harness.backend.recordCloud).toHaveBeenCalledWith(
            expect.objectContaining({ billing: { state: 'ok', budgetId: BUDGET, budgetAmount: 5, currency: 'USD' } }),
        );
        expect(harness.session.get(bootstrapRecordKey(PROJECT_ID))).toBeNull();
        expect(controller.getState()).toMatchObject({ mode: 'normal', openStep: 'mapbox' });
        expect(controller.getState().steps.claim.state).toBe('ok');
    });

    it('badPath_aCityThatCannotBeCreatedKeepsTheRecordForTheNextTry', async () => {
        const { harness, controller } = setup((h) => {
            writeBootstrapRecord(h.session, RECORD);
            h.backend.createCity.mockRejectedValueOnce(functionsError('apiError.internal'));
        });
        await controller.start('bootstrap', null);

        await controller.setMode('normal');
        expect(controller.getState().steps.claim.error).toEqual({ key: 'apiError.internal' });
        expect(readBootstrapRecord(harness.session, PROJECT_ID)).not.toBeNull();

        await controller.intents.recheck('claim');
        await flush();
        expect(harness.backend.createCity).toHaveBeenCalledTimes(2);
        expect(readBootstrapRecord(harness.session, PROJECT_ID)).toBeNull();
    });

    it('badPath_aRecordWithNothingToRecordOnlyCreatesTheCity', async () => {
        const { harness, controller } = setup((h) => {
            writeBootstrapRecord(h.session, {
                version: 1,
                projectId: PROJECT_ID,
                updatedAt: CHECKED,
                steps: { signIn: { state: 'ok', checkedAt: CHECKED } },
            });
        });

        await controller.start('normal', null);

        expect(harness.backend.createCity).toHaveBeenCalledTimes(1);
        expect(harness.backend.recordCloud).not.toHaveBeenCalled();
    });

    it('badPath_theSameModeOrBackToBootstrapLoadsNothing', async () => {
        const { harness, controller } = setup();
        await controller.start('bootstrap', null);

        await controller.setMode('bootstrap');
        await controller.setMode('normal');
        await controller.setMode('bootstrap');

        expect(harness.backend.status).toHaveBeenCalledTimes(1);
        expect(controller.getState().mode).toBe('bootstrap');
    });

    it('happyPath_theShellReportsTheClaim', async () => {
        const { controller } = setup();
        await controller.start('bootstrap', null);

        controller.setClaim('invalid', { key: 'apiError.claim.tokenMismatch' });

        expect(controller.getState().steps.claim).toMatchObject({ state: 'invalid', detail: { key: 'apiError.claim.tokenMismatch' } });
    });
});

describe('check again', () => {
    it('happyPath_theWholePageRunsTheSelfTestInNormalMode', async () => {
        const { harness, controller } = setup((h) => {
            h.backend.selfTest.mockResolvedValue({ checks: [], status: READY_VIEW });
        });
        await controller.start('normal', null);
        const checking: boolean[] = [];
        controller.subscribe((state) => checking.push(state.checking));

        await controller.intents.recheck();
        await flush();

        expect(harness.backend.selfTest).toHaveBeenCalledTimes(1);
        expect(checking[0]).toBe(true);
        expect(controller.getState()).toMatchObject({ checking: false, error: null });
        expect(controller.getState().steps.billing.state).toBe('ok');
    });

    it('badPath_aFailedSelfTestIsShownOnThePage', async () => {
        const { controller } = setup((h) => {
            h.backend.selfTest.mockRejectedValue(functionsError('apiError.notAdmin'));
        });
        await controller.start('normal', null);

        await controller.intents.recheck();
        await flush();

        expect(controller.getState()).toMatchObject({ checking: false, error: { key: 'apiError.notAdmin' } });
    });

    it('happyPath_inBootstrapModeThePageReadsTheRecordAgain', async () => {
        const { harness, controller } = setup();
        await controller.start('bootstrap', null);
        writeBootstrapRecord(harness.session, RECORD);

        await controller.intents.recheck();
        await flush();

        expect(controller.getState().steps.provision.state).toBe('ok');
    });

    it('happyPath_eachCardRunsItsOwnCheck', async () => {
        const { harness, controller } = setup();
        await controller.start('normal', null);

        for (const step of ['billing', 'provision', 'deploy', 'mapbox', 'analytics', 'legacyImport'] as const) {
            await controller.intents.recheck(step);
            await flush();
        }

        expect(harness.cloud.observeBilling).toHaveBeenCalledTimes(1);
        expect(harness.cloud.doctor).toHaveBeenCalledTimes(1);
        expect(harness.cloud.deployment).toHaveBeenCalledTimes(1);
        expect(harness.backend.selfTest).toHaveBeenCalledTimes(1);
        expect(harness.backend.analyticsConfig).toHaveBeenCalledTimes(1);
        expect(harness.importer.detect).toHaveBeenCalledTimes(3);
        expect(controller.getState().steps.mapbox.used.inputs).toBe(1);
        controller.dispose();
    });

    it('badPath_inBootstrapModeAServerCardChecksNothing', async () => {
        const { harness, controller } = setup();
        await controller.start('bootstrap', null);

        await controller.intents.recheck('mapbox');
        await controller.intents.recheck('provision');
        await flush();

        expect(harness.backend.selfTest).not.toHaveBeenCalled();
        expect(harness.cloud.provision).toHaveBeenCalledTimes(1);
    });
});
