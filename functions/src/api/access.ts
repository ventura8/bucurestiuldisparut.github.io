import type { CallableAccess } from '@hcm/shared';

import type { AdminDirectory } from '../ports/admin-directory.js';
import { ApiError } from './api-error.js';

/** The claims of a verified Firebase ID token the access check reads (a subset of `DecodedIdToken`). */
export interface CallerToken {
    readonly email?: string;
    readonly email_verified?: boolean;
    readonly admin?: unknown;
    readonly firebase: { readonly sign_in_provider: string };
}

/** `request.auth` of a callable: undefined when the caller is not signed in. */
export interface Caller {
    readonly uid: string;
    readonly token: CallerToken;
}

/** Who a handler acts for, once the access rule admitted them. */
export interface VerifiedCaller {
    readonly uid: string;
    /** The verified Google address of the ID token (`admin.claim` compares it, `admin.join` hashes it); never logged. */
    readonly email: string | undefined;
    /** The ID token carries `admin: true` (for `signedIn` callables, which also serve non-admins). */
    readonly claim: boolean;
}

/** firestore.rules `authed()`: a verified Google account (admins only ever sign in with Google). */
function isVerifiedGoogle(token: CallerToken): boolean {
    return token.email_verified === true && token.firebase.sign_in_provider === 'google.com';
}

/** The claim AND the document; the document is read only when the token already qualifies. */
async function isAdmin(caller: Caller, admins: AdminDirectory): Promise<boolean> {
    return caller.token.admin === true && (await admins.isAdmin(caller.uid));
}

/**
 * The access rule of a callable (`CALLABLES[name].access`), the same as the security rules: `signedIn` admits a
 * verified Google account, `admin` also needs the `admin` claim AND an `admins/{uid}` document, so deleting the
 * document revokes access at once although the claim stays in an ID token for up to an hour (S-A20-BAD-ADMIN-REMOVED).
 */
export async function requireAccess(access: CallableAccess, caller: Caller | undefined, admins: AdminDirectory): Promise<VerifiedCaller> {
    if (caller === undefined) {
        throw new ApiError('apiError.unauthenticated');
    }
    if (!isVerifiedGoogle(caller.token)) {
        throw new ApiError('apiError.accountNotAllowed');
    }
    if (access === 'admin' && !(await isAdmin(caller, admins))) {
        throw new ApiError('apiError.notAdmin');
    }
    return { uid: caller.uid, email: caller.token.email, claim: caller.token.admin === true };
}
