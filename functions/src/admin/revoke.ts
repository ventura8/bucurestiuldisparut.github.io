import '../global-options.js';

import {
    FIRESTORE_PATHS,
    adminDocSchema,
    inboxItemDocSchema,
    inviteDocSchema,
    ownerDocSchema,
    pushDeviceDocSchema,
    type CallableRequest,
    type CallableResponse,
    type Schema,
} from '@hcm/shared';

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

/** How many documents one page of a removed admin's collection deletes. */
const FORGET_BATCH = 100;

/** Deletes every document of one of the removed admin's collections (the invalid ones too), a page at a time. */
async function deleteCollection<T>(deps: RevokeDeps, collection: string, schema: Schema<T>): Promise<void> {
    let deleted: number;
    do {
        const page = await deps.documents.query(collection, schema, { limit: FORGET_BATCH });
        const paths = [...page.documents, ...page.invalid].map((document) => document.path);
        for (const path of paths) {
            await deps.documents.delete(path);
        }
        deleted = paths.length;
    } while (deleted === FORGET_BATCH);
}

/**
 * M4: the removed admin's push devices, inbox and notification settings go with them, so their browsers get no more
 * notifications (layer names, scene names, a paused budget) and an account invited again starts with none.
 */
async function forgetNotifications(deps: RevokeDeps, uid: string): Promise<void> {
    await deleteCollection(deps, FIRESTORE_PATHS.pushDevices(uid), pushDeviceDocSchema);
    await deleteCollection(deps, FIRESTORE_PATHS.inbox(uid), inboxItemDocSchema);
    await deps.documents.delete(FIRESTORE_PATHS.notifySettings(uid));
}

/** The owner keeps the map: neither their role nor `setup/owner` can be taken away by another admin. */
async function isOwner(deps: RevokeDeps, uid: string, role: string): Promise<boolean> {
    return role === 'owner' || (await deps.documents.get(FIRESTORE_PATHS.setupOwner, ownerDocSchema))?.uid === uid;
}

/**
 * M4 first: the admin's push devices, inbox and notification settings, while the account is still an admin's, so its open
 * pages see their inbox emptied (the unread badge's listener) rather than a listener denied mid-edit, and a Save they
 * try next is refused by the rules as before (S-A20-BAD-REVOKED-WHILE-EDITING; `docs/LESSONS.md` 218). Then the
 * document: the access rule and the security rules require it, so the removed admin is denied from then on
 * (S-A20-BAD-ADMIN-REMOVED); then the claim and the refresh tokens, so the next token refresh carries no claim.
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
    await forgetNotifications(deps, uid);
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
