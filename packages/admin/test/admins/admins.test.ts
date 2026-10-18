import type { AdminsListResponse } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { ADMINS_MODULE, selectionOf } from '../../src/admins/admins.js';
import { failure } from '../app/fakes.js';
import { contentWorld } from '../content/world.js';

const LIST: AdminsListResponse = {
    admins: [
        { uid: 'owner-uid', role: 'owner', email: 'owner@e2e.test', createdAt: '2026-10-01T10:00:00.000Z', self: true },
        {
            uid: 'ana-uid',
            role: 'admin',
            email: 'ana@e2e.test',
            invitedBy: 'owner-uid',
            createdAt: '2026-10-02T10:00:00.000Z',
            self: false,
        },
    ],
    invites: [
        {
            inviteId: 'a'.repeat(64),
            role: 'admin',
            invitedBy: 'owner-uid',
            createdAt: '2026-10-10T10:00:00.000Z',
            expiresAt: '2026-10-24T10:00:00.000Z',
        },
    ],
};

const INVITED = { inviteId: 'b'.repeat(64), expiresAt: '2026-10-31T10:00:00.000Z', signInUrl: 'https://demo-hcm.web.app/' };

async function settled(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
        await Promise.resolve();
    }
}

describe('the admins area', () => {
    it('happyPath_listsTheAdminsAndInvitationsAndFollowsTheSelection', async () => {
        const { services, callables } = contentWorld();
        callables.answer('admins.list', () => LIST);
        const admins = ADMINS_MODULE.create(services);

        admins.open([]);
        await settled();
        admins.open(['ana-uid']);
        const admin = admins.state.selected;
        admins.open(['invite', 'a'.repeat(64)]);

        expect(admins.state).toMatchObject({ status: 'ready', list: LIST, failure: null });
        expect(admin).toEqual({ kind: 'admin', uid: 'ana-uid' });
        expect(admins.state.selected).toEqual({ kind: 'invite', inviteId: 'a'.repeat(64) });
        expect(callables.named('admins.list')).toBe(1);
        expect([selectionOf([]), selectionOf(['invite'])]).toEqual([null, { kind: 'admin', uid: 'invite' }]);
        expect([ADMINS_MODULE.area, admins.hasUnsavedChanges()]).toEqual(['admins', false]);
    });

    it('happyPath_anInvitationKeepsItsLinkAndTheListIsReadAgain', async () => {
        const { services, callables, notices } = contentWorld();
        callables.answer('admins.list', () => LIST);
        callables.answer('admins.invite', () => INVITED);
        const admins = ADMINS_MODULE.create(services);
        admins.open([]);

        const outcome = await admins.intents.invite('  New.Admin@e2e.test ');

        expect(outcome).toEqual({ ok: true, value: INVITED });
        expect(callables.calls.find((call) => call.name === 'admins.invite')?.request).toEqual({ email: 'New.Admin@e2e.test' });
        expect(admins.state.invited).toEqual(INVITED);
        expect(notices).toEqual([{ key: 'adminContent.admins.invitedNotice' }]);
        expect(callables.named('admins.list')).toBe(2);
        admins.intents.dismissInvited();
        expect(admins.state.invited).toBeNull();
    });

    it('badPath_anInvalidAddressIsRefusedWithoutACallAndARefusedInvitationKeepsThePreviousLink', async () => {
        const { services, callables } = contentWorld();
        callables.answer('admins.list', () => LIST);
        callables.fail('admins.invite', failure('already-exists', 'apiError.invite.alreadyAdmin'));
        const admins = ADMINS_MODULE.create(services);

        await expect(admins.intents.invite('not an address')).resolves.toEqual({
            ok: false,
            error: { key: 'adminShell.admins.invalidEmail' },
        });
        await expect(admins.intents.invite('ana@e2e.test')).resolves.toEqual({ ok: false, error: { key: 'apiError.invite.alreadyAdmin' } });

        expect(callables.named('admins.invite')).toBe(1);
        expect(admins.state).toMatchObject({ invited: null, busy: false });
    });

    it('happyPath_removingAnAdminOrCancellingAnInvitation', async () => {
        const { services, callables, notices } = contentWorld();
        callables.answer('admins.list', () => LIST);
        callables.answer('admins.revoke', () => ({ revoked: true }));
        const admins = ADMINS_MODULE.create(services);

        await admins.intents.revoke({ kind: 'admin', uid: 'ana-uid' });
        await admins.intents.revoke({ kind: 'invite', inviteId: 'a'.repeat(64) });

        expect(notices.map((notice) => notice.key)).toEqual(['adminShell.admins.removed', 'adminShell.admins.cancelled']);
        expect(callables.named('admins.list')).toBe(2);
    });

    it('badPath_theOwnerAndOneselfAreRefusedByTheServerAndNothingChanges', async () => {
        const { services, callables, notices } = contentWorld();
        callables.answer('admins.list', () => LIST);
        callables.fail('admins.revoke', failure('failed-precondition', 'apiError.revoke.owner'));
        const admins = ADMINS_MODULE.create(services);

        await expect(admins.intents.revoke({ kind: 'admin', uid: 'owner-uid' })).resolves.toEqual({
            ok: false,
            error: { key: 'apiError.revoke.owner' },
        });

        expect(notices).toEqual([]);
        expect(callables.named('admins.list')).toBe(0);
    });

    it('badPath_aFailedListIsAnErrorUntilItIsReadAgainAndALaterFailureKeepsTheList', async () => {
        const { services, callables } = contentWorld();
        callables.fail('admins.list', failure('internal', 'apiError.internal'));
        const admins = ADMINS_MODULE.create(services);
        admins.open([]);
        await settled();
        expect(admins.state).toMatchObject({ status: 'error', failure: { key: 'apiError.internal' } });

        callables.answer('admins.list', () => LIST);
        await admins.intents.refresh();
        callables.fail('admins.list', failure('unavailable', 'apiError.unavailable'));
        await admins.intents.refresh();

        expect(admins.state).toMatchObject({ status: 'ready', list: LIST, failure: { key: 'apiError.unavailable' } });
        admins.close();
        admins.open([]);
        await settled();
        expect(callables.named('admins.list')).toBe(4);
        admins.destroy();
        expect(admins.state.list).toBeNull();
        let heard = 0;
        admins.subscribe(() => {
            heard += 1;
        })();
        expect(heard).toBe(0);
    });
});
