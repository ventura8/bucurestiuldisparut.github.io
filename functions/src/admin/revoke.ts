import '../global-options.js';

import { FIRESTORE_PATHS, adminDocSchema, inviteDocSchema, ownerDocSchema, type CallableRequest, type CallableResponse } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';

export type RevokeDeps = Pick<Ports, 'documents' | 'auth' | 'log'>;

type RevokeRequest = CallableRequest<'admins.revoke'>;

/** An account deleted from Firebase Auth has no claim and no session left: revoking it is done once its document goes. */
function ignoreMissingAccount(error: unknown): undefined {
    if (error instanceof UpstreamError && error.failure === 'notFound') {
        return undefined;
    }
    throw error;
}

async function revokeInvite(deps: RevokeDeps, inviteId: string): Promise<void> {
    const path = FIRESTORE_PATHS.invite(inviteId);
    if ((await deps.documents.get(path, inviteDocSchema)) === undefined) {
        throw new ApiError('apiError.notFound');
    }
    await deps.documents.delete(path);
}

/** The owner keeps the map: neither their role nor `setup/owner` can be taken away by another admin. */
async function isOwner(deps: RevokeDeps, uid: string, role: string): Promise<boolean> {
    return role === 'owner' || (await deps.documents.get(FIRESTORE_PATHS.setupOwner, ownerDocSchema))?.uid === uid;
}

/**
 * The document goes first: the access rule and the security rules require it, so the removed admin is denied at
 * once (S-A20-BAD-ADMIN-REMOVED); then the claim and the refresh tokens, so the next token refresh carries no claim.
 */
async function revokeAdmin(deps: RevokeDeps, caller: VerifiedCaller, uid: string): Promise<void> {
    if (uid === caller.uid) {
        throw new ApiError('apiError.revoke.self');
    }
    const path = FIRESTORE_PATHS.admin(uid);
    const admin = await deps.documents.get(path, adminDocSchema);
    if (admin === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (await isOwner(deps, uid, admin.role)) {
        throw new ApiError('apiError.revoke.owner');
    }
    await deps.documents.delete(path);
    await deps.auth.setAdminClaim(uid, false).catch(ignoreMissingAccount);
    await deps.auth.revokeSessions(uid).catch(ignoreMissingAccount);
}

/**
 * `admins.revoke` (admins; S-A02-BAD-REVOKE, S-A02-BAD-OWNER-NOT-REVOCABLE, S-A02-BAD-LAST-ADMIN): removes an admin
 * (never the owner: `revoke.owner`; never oneself: `revoke.self`, so a map always keeps an admin) or a pending
 * invitation.
 */
async function adminsRevoke(deps: RevokeDeps, caller: VerifiedCaller, data: RevokeRequest): Promise<CallableResponse<'admins.revoke'>> {
    if (data.kind === 'invite') {
        await revokeInvite(deps, data.inviteId);
    } else {
        await revokeAdmin(deps, caller, data.uid);
    }
    deps.log.info('admin access revoked', { by: caller.uid, kind: data.kind });
    return { revoked: true };
}

/** The `admins-revoke` callable. */
export function revokeFunction(getDeps: () => RevokeDeps & CallableDeps) {
    return defineCallable('admins.revoke', adminsRevoke, getDeps);
}
