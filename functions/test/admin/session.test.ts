/**
 * `admin.session` (`functions/src/admin/session.ts`, M2-interfaces §3.1) through its callable's `.run()` on the
 * Firestore emulator: what the admin app shows after a Google sign-in.
 */
import { FIRESTORE_PATHS, adminDocSchema, inviteDocSchema, inviteIdFor, ownerDocSchema, timestampFromDate } from '@hcm/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { sessionFunction } from '../../src/admin/session.js';
import { callableRequest, failureOf, googleToken, openEmulators, type World } from './world.js';

const emulators = openEmulators('fn-admin-session');

afterAll(async () => {
    await emulators.close();
});

const EMAIL = 'session-user@example.test';
const AT = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));

function session(world: World, uid: string, token = googleToken(EMAIL)) {
    return sessionFunction(() => world).run(callableRequest({}, { uid, token }));
}

async function seedOwner(world: World, uid: string): Promise<void> {
    await world.documents.set(FIRESTORE_PATHS.setupOwner, ownerDocSchema, { uid, claimedAt: AT, updatedBy: uid, updatedAt: AT });
    await world.documents.set(FIRESTORE_PATHS.admin(uid), adminDocSchema, { role: 'owner', createdAt: AT, updatedBy: uid, updatedAt: AT });
}

async function seedInvite(world: World, expiresAt: Date): Promise<void> {
    const invite = {
        role: 'admin',
        invitedBy: 'u-owner',
        createdAt: AT,
        expiresAt: timestampFromDate(expiresAt),
        updatedBy: 'u-owner',
        updatedAt: AT,
    } as const;
    await world.documents.set(FIRESTORE_PATHS.invite(await inviteIdFor(EMAIL)), inviteDocSchema, invite);
}

describe('admin.session', () => {
    it('happyPath_aNewProjectOffersTheOwnerClaim', async () => {
        const world = emulators.newWorld();

        await expect(session(world, 'u-first')).resolves.toEqual({
            admin: false,
            role: null,
            claim: false,
            refreshToken: false,
            ownerClaimed: false,
            invitePending: false,
        });
    });

    it('happyPath_theOwnerWithTheClaimNeedsNothing', async () => {
        const world = emulators.newWorld();
        await seedOwner(world, 'u-owner');

        await expect(session(world, 'u-owner', googleToken(EMAIL, { admin: true }))).resolves.toEqual({
            admin: true,
            role: 'owner',
            claim: true,
            refreshToken: false,
            ownerClaimed: true,
            invitePending: false,
        });
    });

    it('badPath_aDocumentWithoutTheClaimOrAClaimWithoutTheDocumentAsksForARefresh', async () => {
        const world = emulators.newWorld();
        await seedOwner(world, 'u-owner');

        await expect(session(world, 'u-owner')).resolves.toMatchObject({ admin: true, claim: false, refreshToken: true });
        await expect(session(world, 'u-revoked', googleToken(EMAIL, { admin: true }))).resolves.toMatchObject({
            admin: false,
            claim: true,
            refreshToken: true,
        });
    });

    it('happyPath_aPendingInvitationIsOfferedUntilItExpires', async () => {
        const world = emulators.newWorld();
        await seedOwner(world, 'u-owner');
        await seedInvite(world, new Date('2026-10-20T08:00:00.000Z'));

        await expect(session(world, 'u-invited')).resolves.toMatchObject({ ownerClaimed: true, invitePending: true });
        await expect(session(world, 'u-invited', googleToken(EMAIL.toUpperCase()))).resolves.toMatchObject({ invitePending: true });

        world.clock.set('2026-10-20T08:00:00.000Z');
        await expect(session(world, 'u-invited')).resolves.toMatchObject({ invitePending: false });
    });

    it('badPath_anIdTokenWithoutAnAddressHasNoInvitation', async () => {
        const world = emulators.newWorld();
        await seedInvite(world, new Date('2026-10-20T08:00:00.000Z'));
        const token = googleToken(EMAIL);

        await expect(session(world, 'u-invited', { email_verified: true, firebase: token.firebase })).resolves.toMatchObject({
            invitePending: false,
        });
    });

    it('badPath_anUnverifiedOrNonGoogleAccountIsRefused @S-A20-BAD-UNVERIFIED-ACCOUNT', async () => {
        const world = emulators.newWorld();

        const unverified = await failureOf(session(world, 'u-first', googleToken(EMAIL, { email_verified: false })));
        const anonymous = await failureOf(session(world, 'u-first', googleToken(EMAIL, { firebase: { sign_in_provider: 'anonymous' } })));

        expect([unverified, anonymous]).toMatchObject([
            { code: 'permission-denied', details: { code: 'apiError.accountNotAllowed' } },
            { code: 'permission-denied', details: { code: 'apiError.accountNotAllowed' } },
        ]);
    });
});
