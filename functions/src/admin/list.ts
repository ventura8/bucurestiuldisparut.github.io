import '../global-options.js';

import { FIRESTORE_PATHS, adminDocSchema, inviteDocSchema, type AdminDoc, type CallableResponse, type InviteDoc } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { isBefore, isoTime } from './records.js';

export type ListDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type AdminsList = CallableResponse<'admins.list'>;

/** `adminsListResponseSchema` lists at most this many admins and as many invitations. */
const MAX_ROWS = 100;

function adminRow(uid: string, admin: AdminDoc, caller: VerifiedCaller): AdminsList['admins'][number] {
    return {
        uid,
        role: admin.role,
        ...(admin.email === undefined ? {} : { email: admin.email }),
        ...(admin.displayName === undefined ? {} : { displayName: admin.displayName }),
        ...(admin.invitedBy === undefined ? {} : { invitedBy: admin.invitedBy }),
        createdAt: isoTime(admin.createdAt),
        self: uid === caller.uid,
    };
}

function inviteRow(inviteId: string, invite: InviteDoc): AdminsList['invites'][number] {
    return {
        inviteId,
        role: invite.role,
        invitedBy: invite.invitedBy,
        createdAt: isoTime(invite.createdAt),
        expiresAt: isoTime(invite.expiresAt),
    };
}

/**
 * `admins.list` (admins; S-A02-*): the admins, oldest first, and the pending invitations (only their hash: an
 * invitation never stores its address); expired invitations wait for `ops.tick` and are not shown. A document its
 * schema refuses is left out and logged by id.
 */
async function adminsList(deps: ListDeps, caller: VerifiedCaller): Promise<AdminsList> {
    const options = { orderBy: ['createdAt', 'asc'], limit: MAX_ROWS } as const;
    const admins = await deps.documents.query(FIRESTORE_PATHS.admins, adminDocSchema, options);
    const invites = await deps.documents.query(FIRESTORE_PATHS.invites, inviteDocSchema, options);
    const invalid = [...admins.invalid, ...invites.invalid].map((document) => document.path);
    if (invalid.length > 0) {
        deps.log.warn('admin documents left out of the list', { paths: invalid });
    }
    const now = deps.clock.now();
    return {
        admins: admins.documents.map((document) => adminRow(document.id, document.data, caller)),
        invites: invites.documents
            .filter((document) => isBefore(now, document.data.expiresAt))
            .map((document) => inviteRow(document.id, document.data)),
    };
}

/** The `admins-list` callable. */
export function listFunction(getDeps: () => ListDeps & CallableDeps) {
    return defineCallable('admins.list', adminsList, getDeps);
}
