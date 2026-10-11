/**
 * Who counts as an admin, and the server-owned top-level collections (firebase/firestore.rules):
 * admins/{uid}, setup/{doc}, usage/{doc}, ops/{doc} and the default deny for everything else.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EVERYONE, createWorld, expected, verdict, verdicts, type World } from './support/world.js';

let world: World;

beforeAll(async () => {
    world = await createWorld('identity');
    await world.seed('setup/identity-status', { mapbox: { state: 'ok' }, secretsRev: 3 });
    await world.seed('usage/identity-mapbox-2026-10', { cu: 4 });
    await world.seed('ops/identity-guard', { state: 'green' });
    await world.seed('invites/identity-hash', { role: 'admin' });
});

afterAll(async () => {
    await world.env.cleanup();
});

describe('admin identity', () => {
    it('happyPath_onlyAVerifiedGoogleAdminWithClaimAndDocReadsSetup', async () => {
        const result = await verdicts(EVERYONE, (persona) => world.db(persona).doc('setup/identity-status').get());

        expect(result).toEqual(expected(EVERYONE, ['admin']));
    });

    it('badPath_nobodyWritesServerOwnedDocuments', async () => {
        const result = await verdicts(EVERYONE, (persona) => world.db(persona).doc('setup/identity-status').set({ secretsRev: 4 }));

        expect(result).toEqual(expected(EVERYONE, []));
    });
});

describe('admins/{uid}', () => {
    it('happyPath_anAdminReadsEveryAdminDocument', async () => {
        const db = world.db('admin');

        expect(await verdict(db.doc(`admins/${world.uid('docOnly')}`).get())).toBe('allow');
    });

    it('happyPath_aSignedInGoogleUserReadsOnlyTheirOwnDocument', async () => {
        const db = world.db('stranger');

        expect(await verdict(db.doc(`admins/${world.uid('stranger')}`).get())).toBe('allow');
        expect(await verdict(db.doc(`admins/${world.uid('admin')}`).get())).toBe('deny');
    });

    it('badPath_anonymousAndUnverifiedUsersCannotReadAdminDocuments', async () => {
        const result = await verdicts(['anonymous', 'unverified'], (persona) =>
            world
                .db(persona)
                .doc(`admins/${world.uid('admin')}`)
                .get(),
        );

        expect(result).toEqual({ anonymous: 'deny', unverified: 'deny' });
    });

    it('badPath_nobodyGrantsThemselvesAdmin', async () => {
        const result = await verdicts(EVERYONE, (persona) =>
            world
                .db(persona)
                .doc(`admins/${world.uid(persona)}`)
                .set({ addedBy: 'self' }),
        );

        expect(result).toEqual(expected(EVERYONE, []));
    });
});

describe('usage and ops', () => {
    it.each(['usage/identity-mapbox-2026-10', 'ops/identity-guard'])('happyPath_onlyAdminsRead_%s', async (path) => {
        const result = await verdicts(['stranger', 'admin'], (persona) => world.db(persona).doc(path).get());

        expect(result).toEqual({ stranger: 'deny', admin: 'allow' });
    });

    it.each(['usage/identity-mapbox-2026-10', 'ops/identity-guard'])('badPath_adminsNeverWrite_%s', async (path) => {
        expect(await verdict(world.db('admin').doc(path).set({ state: 'red' }))).toBe('deny');
    });
});

describe('default deny', () => {
    it('badPath_unknownCollectionsAreClosedEvenToAdmins', async () => {
        const db = world.db('admin');

        expect(await verdict(db.doc('invites/identity-hash').get())).toBe('deny');
        expect(await verdict(db.collection('invites').get())).toBe('deny');
    });
});
