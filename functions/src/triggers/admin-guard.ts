import { HttpsError } from 'firebase-functions/https';

import type { AdminDirectory } from '../ports/admin-directory.js';

/** The claims of a verified Firebase ID token that the admin check reads (a subset of DecodedIdToken). */
export interface CallerToken {
    readonly email_verified?: boolean;
    readonly admin?: unknown;
    readonly firebase: { readonly sign_in_provider: string };
}

/** `request.auth` of a callable: undefined when the caller is not signed in. */
export interface Caller {
    readonly uid: string;
    readonly token: CallerToken;
}

export interface AdminCaller {
    readonly uid: string;
}

/** The same identity rule as firestore.rules `isAdmin()`, minus the document lookup. */
function hasAdminToken(token: CallerToken): boolean {
    return token.email_verified === true && token.firebase.sign_in_provider === 'google.com' && token.admin === true;
}

/**
 * Admits a verified Google account that holds the `admin` claim AND still has its admins/{uid}
 * document, exactly like the security rules: deleting the document revokes access at once, even
 * though the claim stays in an ID token for up to an hour. The document is read only when the token
 * already qualifies. Triggers call it before the handler (handlers never see an unchecked caller
 * and never import firebase-functions); the HttpsError codes reach the client as they are.
 */
export async function requireAdmin(admins: AdminDirectory, caller: Caller | undefined): Promise<AdminCaller> {
    if (caller === undefined) {
        throw new HttpsError('unauthenticated', 'Sign in with Google to use the admin.');
    }
    if (!hasAdminToken(caller.token) || !(await admins.isAdmin(caller.uid))) {
        throw new HttpsError('permission-denied', 'Only admins can do this.');
    }
    return { uid: caller.uid };
}
