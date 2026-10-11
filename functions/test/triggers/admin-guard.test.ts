import { describe, expect, it } from 'vitest';

import { requireAdmin } from '../../src/triggers/admin-guard.js';
import { adminToken, caller, fakeAdmins } from '../support/fakes.js';

describe('requireAdmin', () => {
    it('happyPath_admitsAVerifiedGoogleAdminWithClaimAndDocument', async () => {
        const admins = fakeAdmins(['ana']);

        await expect(requireAdmin(admins, caller('ana'))).resolves.toEqual({ uid: 'ana' });
        expect(admins.lookups).toEqual(['ana']);
    });

    it('badPath_rejectsAnonymousCallersAsUnauthenticated', async () => {
        await expect(requireAdmin(fakeAdmins(['ana']), undefined)).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it.each([
        ['an unverified email', adminToken({ email_verified: false })],
        ['no email_verified claim', { admin: true, firebase: { sign_in_provider: 'google.com' } }],
        ['a password sign-in', adminToken({ firebase: { sign_in_provider: 'password' } })],
        ['no admin claim', adminToken({ admin: undefined })],
        ['a non-boolean admin claim', adminToken({ admin: 'true' })],
    ])('badPath_rejectsATokenWith_%s_withoutReadingFirestore', async (_label, token) => {
        const admins = fakeAdmins(['ana']);

        await expect(requireAdmin(admins, caller('ana', token))).rejects.toMatchObject({ code: 'permission-denied' });
        expect(admins.lookups).toEqual([]);
    });

    it('badPath_rejectsARevokedAdminWhoseClaimIsStillValid', async () => {
        const admins = fakeAdmins([]);

        await expect(requireAdmin(admins, caller('ana'))).rejects.toMatchObject({
            code: 'permission-denied',
            message: 'Only admins can do this.',
        });
        expect(admins.lookups).toEqual(['ana']);
    });
});
