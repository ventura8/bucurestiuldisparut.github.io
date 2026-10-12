import '../global-options.js';

import {
    FIRESTORE_PATHS,
    INVITE_TTL_DAYS,
    adminDocSchema,
    inviteDocSchema,
    inviteIdFor,
    normalizeEmail,
    timestampFromDate,
    type CallableRequest,
    type CallableResponse,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { callerStamp } from './records.js';

export type InviteDeps = Pick<Ports, 'documents' | 'config' | 'clock' | 'log'>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** An admin's document keeps its verified address normalized (`adminRecord`), so one equality query finds it. */
async function isAdmin(deps: InviteDeps, email: string): Promise<boolean> {
    const found = await deps.documents.query(FIRESTORE_PATHS.admins, adminDocSchema, { where: [['email', '==', email]], limit: 1 });
    return found.documents.length > 0;
}

/**
 * `admins.invite` (admins; S-A02-HAPPY, S-A02-BAD-INVALID-EMAIL, S-A02-BAD-NO-ADDRESS-STORED): stores
 * `invites/{sha256 of the normalized address}` with the role, the inviter and the expiry (`INVITE_TTL_DAYS`; inviting
 * again resets it) and answers the admin's address, which the inviter shares; no mail is sent in M2. The address
 * itself is in no document, response or log line; an address that already administers the map →
 * `invite.alreadyAdmin`.
 */
async function adminsInvite(
    deps: InviteDeps,
    caller: VerifiedCaller,
    data: CallableRequest<'admins.invite'>,
): Promise<CallableResponse<'admins.invite'>> {
    const email = normalizeEmail(data.email);
    if (await isAdmin(deps, email)) {
        throw new ApiError('apiError.invite.alreadyAdmin');
    }
    const inviteId = await inviteIdFor(email);
    const now = deps.clock.now();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS);
    await deps.documents.set(FIRESTORE_PATHS.invite(inviteId), inviteDocSchema, {
        role: 'admin',
        invitedBy: caller.uid,
        createdAt: timestampFromDate(now),
        expiresAt: timestampFromDate(expiresAt),
        ...callerStamp(caller.uid, now),
    });
    deps.log.info('invitation stored', { by: caller.uid, expiresAt: expiresAt.toISOString() });
    return { inviteId, expiresAt: expiresAt.toISOString(), signInUrl: deps.config.adminUrl };
}

/** The `admins-invite` callable. */
export function inviteFunction(getDeps: () => InviteDeps & CallableDeps) {
    return defineCallable('admins.invite', adminsInvite, getDeps);
}
