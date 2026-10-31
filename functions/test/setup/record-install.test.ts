/**
 * `setup.recordCloud`'s M6 installer part (`docs/research/M6-interfaces.md` §1.7): each install target's last known
 * state in `setup/status.install`, which `setup.status` answers so Home can show an update or a stopped install without a
 * Google token. A report replaces only the targets it names; nothing but the state, release, build and reason travels.
 */
import { FIRESTORE_PATHS, recordCloudRequestSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { recordCloud } from '../../src/setup/record-cloud.js';
import { toSetupStatusView } from '../../src/setup/view.js';
import { ADMIN, NOW, createWorld } from './world.js';

const CHECKED = { seconds: Date.parse(NOW) / 1000, nanoseconds: 0 };
const SERVER = { state: 'installed', release: '1.0.0+abc1234', buildId: '0e2e0000-0000-4000-8000-000000000001', checkedAt: NOW } as const;

describe('setup.recordCloud: the install targets', () => {
    it('happyPath_aTargetsStateIsRecordedAndAnswered', async () => {
        const world = createWorld();

        const response = await recordCloud(world.deps, ADMIN, { install: { server: SERVER } });

        expect(response.status.install).toEqual({ server: SERVER });
        expect(world.status()?.install).toEqual({ server: SERVER });
    });

    it('happyPath_aReportKeepsTheTargetsItDoesNotName', async () => {
        const world = createWorld();
        world.documents.seed(FIRESTORE_PATHS.setupStatus, { install: { server: SERVER }, updatedBy: ADMIN.uid, updatedAt: CHECKED });
        const site = { state: 'failed', checkedAt: NOW, detail: 'apiError.install.failed', params: { step: 'hosting' } } as const;

        const response = await recordCloud(world.deps, ADMIN, { install: { site } });

        expect(response.status.install).toEqual({ server: SERVER, site });
    });

    it('badPath_aReportOlderThanTheStoredRecordOfItsTargetIsDropped', async () => {
        const world = createWorld();
        const later = { state: 'failed', checkedAt: '2026-10-12T09:00:30.000Z', detail: 'apiError.install.failed' } as const;
        world.documents.seed(FIRESTORE_PATHS.setupStatus, { install: { server: later }, updatedBy: ADMIN.uid, updatedAt: CHECKED });
        const earlier = { state: 'retrying', checkedAt: '2026-10-12T09:00:20.000Z' } as const;
        const site = { state: 'installed', checkedAt: '2026-10-12T09:00:20.000Z' } as const;

        const response = await recordCloud(world.deps, ADMIN, { install: { server: earlier, site } });

        expect(response.status.install).toEqual({ server: later, site });
    });

    it('badPath_aRequestWithALogLineOrATokenIsRefused', () => {
        expect(recordCloudRequestSchema.safeParse({ install: { server: { ...SERVER, log: 'ya29.token' } } }).success).toBe(false);
        expect(recordCloudRequestSchema.safeParse({ install: { server: { ...SERVER, detail: 'free text' } } }).success).toBe(false);
        expect(recordCloudRequestSchema.safeParse({ install: {} }).success).toBe(true);
    });

    it('badPath_aStoredTargetThatNoLongerValidatesIsDroppedFromTheView', () => {
        const view = toSetupStatusView({ install: { server: SERVER, pipeline: { state: 'exploded', checkedAt: NOW } } }, new Date(NOW));

        expect(view.install).toEqual({ server: SERVER });
        expect(toSetupStatusView({ install: 'nothing' }, new Date(NOW))).not.toHaveProperty('install');
    });
});
