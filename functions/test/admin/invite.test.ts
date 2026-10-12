/**
 * `admins.invite` (`functions/src/admin/invite.ts`, M2-interfaces §3.1) through its callable's `.run()` on the
 * Firestore emulator: the invitation is the hash of the address, never the address.
 */
import { FIRESTORE_PATHS, adminDocSchema, inviteDocSchema, inviteIdFor, timestampFromDate } from '@hcm/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { inviteFunction } from '../../src/admin/invite.js';
import { CONFIG, callableRequest, failureOf, googleToken, loggedText, openEmulators, sorted, type World } from './world.js';

const emulators = openEmulators('fn-admin-invite');

afterAll(async () => {
    await emulators.close();
});

const ADMIN = 'u-inviting-admin';
const AT = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));
const INVITEE = 'new.admin@example.test';

async function seedAdmin(world: World, uid: string, email: string): Promise<void> {
    await world.documents.set(FIRESTORE_PATHS.admin(uid), adminDocSchema, {
        role: 'admin',
        email,
        createdAt: AT,
        updatedBy: uid,
        updatedAt: AT,
    });
}

function invite(world: World, email: string, uid = ADMIN) {
    return inviteFunction(() => world).run(
        callableRequest({ email }, { uid, token: googleToken('inviter@example.test', { admin: true }) }),
    );
}

/** Every document of the collections an invitation touches, as JSON. */
async function storedText(world: World): Promise<string> {
    const admins = await world.db.collection(FIRESTORE_PATHS.admins).get();
    const invites = await world.db.collection(FIRESTORE_PATHS.invites).get();
    return JSON.stringify([...admins.docs, ...invites.docs].map((document) => [document.id, document.data()]));
}

describe('admins.invite', () => {
    it('happyPath_storesOnlyTheHashOfTheAddress @S-A02-BAD-NO-ADDRESS-STORED', async () => {
        const world = emulators.newWorld();
        await seedAdmin(world, ADMIN, 'inviter@example.test');
        const inviteId = await inviteIdFor(INVITEE);

        const response = await invite(world, INVITEE.toUpperCase());

        expect(response).toEqual({ inviteId, expiresAt: '2026-10-26T08:30:00.000Z', signInUrl: CONFIG.adminUrl });
        const stored = (await world.db.doc(FIRESTORE_PATHS.invite(inviteId)).get()).data();
        expect(sorted(Object.keys(stored ?? {}))).toEqual(['createdAt', 'expiresAt', 'invitedBy', 'role', 'updatedAt', 'updatedBy']);
        await expect(world.documents.get(FIRESTORE_PATHS.invite(inviteId), inviteDocSchema)).resolves.toMatchObject({
            role: 'admin',
            invitedBy: ADMIN,
            updatedBy: ADMIN,
        });
        expect((await storedText(world)).toLowerCase()).not.toContain(INVITEE);
        expect(JSON.stringify(response).toLowerCase()).not.toContain(INVITEE);
        expect(loggedText(world.recording).toLowerCase()).not.toContain(INVITEE);
    });

    it('happyPath_invitingAgainResetsTheExpiry', async () => {
        const world = emulators.newWorld();
        await seedAdmin(world, ADMIN, 'inviter@example.test');
        await invite(world, INVITEE);
        world.clock.set('2026-10-20T08:30:00.000Z');

        await expect(invite(world, INVITEE)).resolves.toMatchObject({ expiresAt: '2026-11-03T08:30:00.000Z' });
    });

    it('badPath_anAddressThatAlreadyAdministersTheMap', async () => {
        const world = emulators.newWorld();
        await seedAdmin(world, ADMIN, 'inviter@example.test');
        await seedAdmin(world, 'u-existing', INVITEE);

        const failure = await failureOf(invite(world, INVITEE.toUpperCase()));

        expect(failure).toMatchObject({ code: 'already-exists', details: { code: 'apiError.invite.alreadyAdmin' } });
        await expect(world.documents.get(FIRESTORE_PATHS.invite(await inviteIdFor(INVITEE)), inviteDocSchema)).resolves.toBeUndefined();
    });

    it('badPath_anInvalidAddressOrANonAdminIsRefused', async () => {
        const world = emulators.newWorld();
        await seedAdmin(world, ADMIN, 'inviter@example.test');

        const invalid = await failureOf(invite(world, 'not-an-address'));
        const stranger = await failureOf(invite(world, INVITEE, 'u-stranger'));

        expect(invalid).toMatchObject({
            code: 'invalid-argument',
            details: { code: 'apiError.invalidRequest', issues: [{ path: 'email' }] },
        });
        expect(stranger).toMatchObject({ code: 'permission-denied', details: { code: 'apiError.notAdmin' } });
    });
});
