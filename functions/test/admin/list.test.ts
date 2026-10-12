/**
 * `admins.list` (`functions/src/admin/list.ts`, M2-interfaces §3.1) through its callable's `.run()` on the Firestore
 * emulator: the admins oldest first, the pending invitations by hash only.
 */
import { FIRESTORE_PATHS, adminDocSchema, adminsListResponseSchema, inviteDocSchema, timestampFromDate } from '@hcm/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { listFunction } from '../../src/admin/list.js';
import { callableRequest, googleToken, openEmulators, type World } from './world.js';

const emulators = openEmulators('fn-admin-list');

afterAll(async () => {
    await emulators.close();
});

const OWNER = 'u-list-owner';
const EARLY = timestampFromDate(new Date('2026-09-01T08:00:00.000Z'));
const LATE = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));
const PENDING = 'e'.repeat(64);
const EXPIRED = 'f'.repeat(64);

function list(world: World, uid = OWNER) {
    return listFunction(() => world).run(callableRequest({}, { uid, token: googleToken('owner@example.test', { admin: true }) }));
}

async function seed(world: World): Promise<void> {
    await world.documents.set(FIRESTORE_PATHS.admin('u-list-admin'), adminDocSchema, {
        role: 'admin',
        invitedBy: OWNER,
        createdAt: LATE,
        updatedBy: 'u-list-admin',
        updatedAt: LATE,
    });
    await world.documents.set(FIRESTORE_PATHS.admin(OWNER), adminDocSchema, {
        role: 'owner',
        email: 'owner@example.test',
        displayName: 'Owner Test',
        createdAt: EARLY,
        updatedBy: OWNER,
        updatedAt: EARLY,
    });
    const invite = { role: 'admin', invitedBy: OWNER, createdAt: LATE, updatedBy: OWNER, updatedAt: LATE } as const;
    await world.documents.set(FIRESTORE_PATHS.invite(PENDING), inviteDocSchema, {
        ...invite,
        expiresAt: timestampFromDate(new Date('2026-10-15T08:00:00Z')),
    });
    await world.documents.set(FIRESTORE_PATHS.invite(EXPIRED), inviteDocSchema, {
        ...invite,
        expiresAt: timestampFromDate(new Date('2026-10-11T08:00:00Z')),
    });
}

describe('admins.list', () => {
    it('happyPath_listsTheAdminsOldestFirstAndThePendingInvitations', async () => {
        const world = emulators.newWorld();
        await seed(world);

        const listed = await list(world);

        expect(adminsListResponseSchema.safeParse(listed).success).toBe(true);
        expect(listed).toEqual({
            admins: [
                {
                    uid: OWNER,
                    role: 'owner',
                    email: 'owner@example.test',
                    displayName: 'Owner Test',
                    createdAt: '2026-09-01T08:00:00.000Z',
                    self: true,
                },
                { uid: 'u-list-admin', role: 'admin', invitedBy: OWNER, createdAt: '2026-10-01T08:00:00.000Z', self: false },
            ],
            invites: [
                {
                    inviteId: PENDING,
                    role: 'admin',
                    invitedBy: OWNER,
                    createdAt: '2026-10-01T08:00:00.000Z',
                    expiresAt: '2026-10-15T08:00:00.000Z',
                },
            ],
        });
        expect(world.recording.records).toEqual([]);
    });

    it('badPath_aDocumentItsSchemaRefusesIsLeftOutAndLogged', async () => {
        const world = emulators.newWorld();
        await seed(world);
        await world.db.doc(FIRESTORE_PATHS.admin('u-broken')).set({ role: 'superuser', createdAt: LATE });

        const listed = await list(world);

        expect(listed.admins.map((admin) => admin.uid)).toEqual([OWNER, 'u-list-admin']);
        expect(world.recording.records).toMatchObject([
            { level: 'warn', message: 'admin documents left out of the list', data: { paths: ['admins/u-broken'] } },
        ]);
    });
});
