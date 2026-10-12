/**
 * `admins.revoke` (`functions/src/admin/revoke.ts`, M2-interfaces §3.1) through its callable's `.run()` on the
 * Firestore and Auth emulators: an admin loses access at once; the owner and oneself are never revocable.
 */
import { FIRESTORE_PATHS, adminDocSchema, inviteDocSchema, ownerDocSchema, timestampFromDate, type AdminRole } from '@hcm/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { revokeFunction } from '../../src/admin/revoke.js';
import { requireAccess } from '../../src/api/access.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { callableRequest, failureOf, googleToken, openEmulators, type World } from './world.js';

const emulators = openEmulators('fn-admin-revoke');

afterAll(async () => {
    await emulators.close();
});

const AT = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));
const INVITE_ID = 'd'.repeat(64);

let accounts = 0;

/** An admin of this file: its Auth account with the claim, and its `admins/{uid}` document. */
async function seedAdmin(world: World, role: AdminRole = 'admin'): Promise<string> {
    accounts += 1;
    const uid = `fn-admin-revoke-${String(accounts)}`;
    await world.sdkAuth.createUser({ uid, email: `${uid}@example.test`, emailVerified: true });
    await world.sdkAuth.setCustomUserClaims(uid, { admin: true, beta: true });
    await world.documents.set(FIRESTORE_PATHS.admin(uid), adminDocSchema, { role, createdAt: AT, updatedBy: uid, updatedAt: AT });
    return uid;
}

function revoke(world: World, caller: string, data: unknown) {
    return revokeFunction(() => world).run(
        callableRequest(data, { uid: caller, token: googleToken(`${caller}@example.test`, { admin: true }) }),
    );
}

describe('admins.revoke', () => {
    it('happyPath_aRevokedAdminLosesAccessAtOnce', async () => {
        const world = emulators.newWorld();
        const owner = await seedAdmin(world, 'owner');
        const admin = await seedAdmin(world);

        await expect(revoke(world, owner, { kind: 'admin', uid: admin })).resolves.toEqual({ revoked: true });

        await expect(world.documents.get(FIRESTORE_PATHS.admin(admin), adminDocSchema)).resolves.toBeUndefined();
        const account = await world.sdkAuth.getUser(admin);
        expect(account.customClaims).toEqual({ beta: true });
        expect(account.tokensValidAfterTime).toBeDefined();
        const staleToken = { uid: admin, token: googleToken(`${admin}@example.test`, { admin: true }) };
        await expect(requireAccess('admin', staleToken, world.admins)).rejects.toMatchObject({ code: 'apiError.notAdmin' });
    });

    it('badPath_theOwnerCannotBeRevoked', async () => {
        const world = emulators.newWorld();
        const owner = await seedAdmin(world, 'owner');
        const admin = await seedAdmin(world);
        const recordedOwner = await seedAdmin(world);
        await world.documents.set(FIRESTORE_PATHS.setupOwner, ownerDocSchema, {
            uid: recordedOwner,
            claimedAt: AT,
            updatedBy: recordedOwner,
            updatedAt: AT,
        });

        const byRole = await failureOf(revoke(world, admin, { kind: 'admin', uid: owner }));
        const byRecord = await failureOf(revoke(world, admin, { kind: 'admin', uid: recordedOwner }));

        expect([byRole, byRecord]).toMatchObject([
            { code: 'failed-precondition', details: { code: 'apiError.revoke.owner' } },
            { code: 'failed-precondition', details: { code: 'apiError.revoke.owner' } },
        ]);
        await expect(world.documents.get(FIRESTORE_PATHS.admin(owner), adminDocSchema)).resolves.toMatchObject({ role: 'owner' });
    });

    it('badPath_anAdminCannotRemoveThemselves', async () => {
        const world = emulators.newWorld();
        const admin = await seedAdmin(world);

        await expect(failureOf(revoke(world, admin, { kind: 'admin', uid: admin }))).resolves.toMatchObject({
            details: { code: 'apiError.revoke.self' },
        });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(admin), adminDocSchema)).resolves.toBeDefined();
    });

    it('badPath_anUnknownAdminOrInvitationIsNotFound', async () => {
        const world = emulators.newWorld();
        const admin = await seedAdmin(world);

        const unknownAdmin = await failureOf(revoke(world, admin, { kind: 'admin', uid: 'fn-admin-revoke-nobody' }));
        const unknownInvite = await failureOf(revoke(world, admin, { kind: 'invite', inviteId: INVITE_ID }));

        expect([unknownAdmin, unknownInvite]).toMatchObject([
            { code: 'not-found', details: { code: 'apiError.notFound' } },
            { code: 'not-found', details: { code: 'apiError.notFound' } },
        ]);
    });

    it('happyPath_aPendingInvitationIsWithdrawn', async () => {
        const world = emulators.newWorld();
        const admin = await seedAdmin(world);
        const invite = { role: 'admin', invitedBy: admin, createdAt: AT, expiresAt: AT, updatedBy: admin, updatedAt: AT } as const;
        await world.documents.set(FIRESTORE_PATHS.invite(INVITE_ID), inviteDocSchema, invite);

        await expect(revoke(world, admin, { kind: 'invite', inviteId: INVITE_ID })).resolves.toEqual({ revoked: true });
        await expect(world.documents.get(FIRESTORE_PATHS.invite(INVITE_ID), inviteDocSchema)).resolves.toBeUndefined();
    });

    it('happyPath_anAdminWhoseAccountIsGoneIsStillRemoved', async () => {
        const world = emulators.newWorld();
        const owner = await seedAdmin(world, 'owner');
        const admin = await seedAdmin(world);
        await world.sdkAuth.deleteUser(admin);

        await expect(revoke(world, owner, { kind: 'admin', uid: admin })).resolves.toEqual({ revoked: true });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(admin), adminDocSchema)).resolves.toBeUndefined();
    });

    it('badPath_authUnavailableFailsRetryablyAfterTheDocumentIsGone', async () => {
        const world = emulators.newWorld();
        const owner = await seedAdmin(world, 'owner');
        const admin = await seedAdmin(world);
        const down = new UpstreamError('firebase-auth', 'unavailable', { status: 503 });
        const auth = { ...world.auth, setAdminClaim: () => Promise.reject(down) };

        const failure = await failureOf(
            revokeFunction(() => ({ ...world, auth })).run(
                callableRequest(
                    { kind: 'admin', uid: admin },
                    { uid: owner, token: googleToken(`${owner}@example.test`, { admin: true }) },
                ),
            ),
        );

        expect(failure).toMatchObject({ code: 'unavailable', details: { code: 'apiError.unavailable' } });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(admin), adminDocSchema)).resolves.toBeUndefined();
    });
});
