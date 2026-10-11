import { describe, expect, it } from 'vitest';

import { setupStatus, toSetupStatus } from '../../src/handlers/setup-status.js';
import { NOW, fakeSetup, fixedClock, recordingLogger } from '../support/fakes.js';

const CHECKED = new Date('2026-10-10T19:00:00.000Z');

/** Firestore returns Timestamp objects; only their toDate() matters. */
const timestamp = (date: Date): { toDate: () => Date } => ({ toDate: () => date });

describe('setupStatus', () => {
    it('happyPath_returnsTheVerifiedServicesAndLogsWhoAsked', async () => {
        const { log, recording } = recordingLogger();
        const setup = fakeSetup({
            mapbox: { state: 'ok', checkedAt: timestamp(CHECKED) },
            usgs: { state: 'ok', checkedAt: CHECKED },
            secretsRev: 7,
        });

        const status = await setupStatus({ setup, clock: fixedClock(), log }, { uid: 'ana' });

        expect(status).toEqual({
            mapbox: { state: 'ok', checkedAt: '2026-10-10T19:00:00.000Z' },
            usgs: { state: 'ok', checkedAt: '2026-10-10T19:00:00.000Z' },
            secretsRev: 7,
            ready: true,
            generatedAt: NOW,
        });
        expect(recording.records).toEqual([
            { level: 'info', scope: 'functions', message: 'setup status read', data: { uid: 'ana', ready: true } },
        ]);
    });

    it('badPath_aFreshProjectReportsEveryServiceMissing', async () => {
        const status = await setupStatus({ setup: fakeSetup(undefined), clock: fixedClock(), log: recordingLogger().log }, { uid: 'ana' });

        expect(status).toEqual({
            mapbox: { state: 'missing', checkedAt: null },
            usgs: { state: 'missing', checkedAt: null },
            secretsRev: 0,
            ready: false,
            generatedAt: NOW,
        });
    });
});

describe('toSetupStatus', () => {
    it('badPath_secretsWrittenIntoTheRecordByMistakeNeverLeave', () => {
        const record = { mapbox: { state: 'invalid', token: 'sk.e2e-leaked' }, usgsAppToken: 'e2e-leaked', secretsRev: 2 };

        const status = toSetupStatus(record, new Date(NOW));

        expect(JSON.stringify(status)).not.toContain('leaked');
        expect(status.mapbox).toEqual({ state: 'invalid', checkedAt: null });
        expect(status.ready).toBe(false);
    });

    it.each([
        ['an unknown state', { state: 'pending' }],
        ['a service that is not a map', 'ok'],
        ['a service that is a list', ['ok']],
        ['a null service', null],
    ])('badPath_%s_readsAsMissing', (_label, mapbox) => {
        expect(toSetupStatus({ mapbox }, new Date(NOW)).mapbox).toEqual({ state: 'missing', checkedAt: null });
    });

    it.each([
        ['a string', '2026-10-10'],
        ['a number', 1760122800000],
        ['an object without toDate', { seconds: 1 }],
        ['an invalid date', new Date(Number.NaN)],
        ['a timestamp whose toDate is not a date', { toDate: () => '2026-10-10' }],
    ])('badPath_aCheckedAtThatIs_%s_isNull', (_label, checkedAt) => {
        expect(toSetupStatus({ usgs: { state: 'ok', checkedAt } }, new Date(NOW)).usgs.checkedAt).toBeNull();
    });

    it.each([-1, 1.5, '3', Number.MAX_SAFE_INTEGER + 1])('badPath_revision_%s_readsAsZero', (secretsRev) => {
        expect(toSetupStatus({ secretsRev }, new Date(NOW)).secretsRev).toBe(0);
    });

    it('happyPath_readyNeedsEveryService', () => {
        expect(toSetupStatus({ mapbox: { state: 'ok' }, usgs: { state: 'invalid' } }, new Date(NOW)).ready).toBe(false);
    });
});
