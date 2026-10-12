import '../global-options.js';

import { FIRESTORE_PATHS, adminDocSchema, inviteDocSchema, inviteIdFor, ownerDocSchema, type CallableResponse } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { isBefore } from './records.js';

export type SessionDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

/** An invitation for the caller's verified address that has not expired (the app then offers "Join"). */
async function invitePending(deps: SessionDeps, email: string | undefined): Promise<boolean> {
    if (email === undefined) {
        return false;
    }
    const invite = await deps.documents.get(FIRESTORE_PATHS.invite(await inviteIdFor(email)), inviteDocSchema);
    return invite !== undefined && isBefore(deps.clock.now(), invite.expiresAt);
}

/**
 * `admin.session` (any verified Google account, S-A01-*, S-A20-*): whether the caller administers the map and with
 * which role, whether its ID token already carries the claim (`refreshToken` when the token and the document
 * disagree: a fresh claim or a revoked one), whether the map has an owner, and whether an invitation waits for the
 * caller's address. Reads only; the address is hashed, never stored or logged.
 */
async function adminSession(deps: SessionDeps, caller: VerifiedCaller): Promise<CallableResponse<'admin.session'>> {
    const admin = await deps.documents.get(FIRESTORE_PATHS.admin(caller.uid), adminDocSchema);
    const owner = await deps.documents.get(FIRESTORE_PATHS.setupOwner, ownerDocSchema);
    const isAdmin = admin !== undefined;
    return {
        admin: isAdmin,
        role: admin?.role ?? null,
        claim: caller.claim,
        refreshToken: isAdmin !== caller.claim,
        ownerClaimed: owner !== undefined,
        invitePending: !isAdmin && (await invitePending(deps, caller.email)),
    };
}

/** The `admin-session` callable. */
export function sessionFunction(getDeps: () => SessionDeps & CallableDeps) {
    return defineCallable('admin.session', adminSession, getDeps);
}
