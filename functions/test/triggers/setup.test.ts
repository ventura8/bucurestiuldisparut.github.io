/**
 * The `setup-status` callable end to end through its v2 `.run()` entry point: the real composition
 * root (deps.ts) with firebase-admin on the Firestore emulator (`npm test` runs Vitest under
 * `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST and GCLOUD_PROJECT).
 */
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/https';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Caller } from '../../src/triggers/admin-guard.js';
import { status } from '../../src/triggers/setup.js';
import { adminToken, caller } from '../support/fakes.js';

const ADMIN = 'functions-setup-admin';
const REVOKED = 'functions-setup-revoked';

let seeder: App;

/** A callable request as firebase-functions hands it to the handler. */
function request(auth: Caller | undefined): CallableRequest<unknown> {
    const base = { data: null, rawRequest: {} as CallableRequest['rawRequest'], acceptsStreaming: false };
    return (auth === undefined ? base : { ...base, auth: { ...auth, rawToken: 'e2e-id-token' } }) as CallableRequest<unknown>;
}

beforeAll(async () => {
    if (!process.env['FIRESTORE_EMULATOR_HOST']) {
        throw new Error('FIRESTORE_EMULATOR_HOST is not set: run `npm test` (Vitest under firebase emulators:exec)');
    }
    seeder = initializeApp({ projectId: 'demo-hcm' }, 'functions-setup-seeder');
    const db = getFirestore(seeder);
    await db.collection('admins').doc(ADMIN).set({ addedBy: 'bootstrap' });
    await db
        .collection('setup')
        .doc('status')
        .set({
            mapbox: { state: 'ok', checkedAt: Timestamp.fromDate(new Date('2026-10-10T19:00:00.000Z')), token: 'sk.e2e-never-returned' },
            usgs: { state: 'invalid' },
            secretsRev: 2,
        });
});

afterAll(async () => {
    await deleteApp(seeder);
});

describe('setup-status callable', () => {
    it('happyPath_anAdminGetsTheNonSecretSetupStatus', async () => {
        const result = await status.run(request(caller(ADMIN)));

        expect(result).toMatchObject({
            mapbox: { state: 'ok', checkedAt: '2026-10-10T19:00:00.000Z' },
            usgs: { state: 'invalid', checkedAt: null },
            secretsRev: 2,
            ready: false,
        });
        expect(JSON.stringify(result)).not.toContain('sk.e2e');
    });

    it('badPath_anAnonymousCallIsUnauthenticated', async () => {
        await expect(status.run(request(undefined))).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it.each([
        ['a revoked admin (claim, no admins doc)', caller(REVOKED)],
        ['a signed-in user without the claim', caller(ADMIN, adminToken({ admin: undefined }))],
    ])('badPath_permissionDeniedFor_%s', async (_label, who) => {
        await expect(status.run(request(who))).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('happyPath_deploysInUsCentral1WithACapOfThreeInstances', () => {
        expect(status.__endpoint).toMatchObject({ platform: 'gcfv2', region: ['us-central1'], maxInstances: 3, callableTrigger: {} });
    });
});
