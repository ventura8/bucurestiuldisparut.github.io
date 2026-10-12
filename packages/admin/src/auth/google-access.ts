/**
 * The Google access tokens of the session (`docs/research/M2b-interfaces.md` §2.3): at most one per Firebase user, in
 * memory only. Never in Firestore, web storage, IndexedDB, a cookie, a URL, a log line or an error report. Google's
 * incremental authorization (`include_granted_scopes`) makes every newer token carry the earlier grants, so the newest
 * one replaces the last. It is dropped on sign-out, on a user change and on any Google 401.
 */
import { unsatisfiedScopes, type GoogleScope } from '../google/scopes.js';
import type { GoogleAccess } from './google-auth.js';

/** A step starts a batch of Google calls only with at least this much of its token left (§1.5). */
export const MIN_TOKEN_REMAINING_MS = 5 * 60 * 1000;

export class GoogleAccessStore {
    readonly #now: () => number;
    #uid: string | null = null;
    #access: GoogleAccess | null = null;

    constructor(now: () => number) {
        this.#now = now;
    }

    /** Keeps `access` for the user `uid` (replacing what another user held). */
    keep(uid: string, access: GoogleAccess): void {
        this.#uid = uid;
        this.#access = access;
    }

    /** The user's token when it grants `scope` and has more than `minRemainingMs` left; otherwise null. */
    live(uid: string, scope: GoogleScope, minRemainingMs: number): GoogleAccess | null {
        const access = this.#of(uid);
        if (access === null || access.expiresAt - this.#now() <= minRemainingMs) {
            return null;
        }
        return unsatisfiedScopes(access.scopes, [scope]).length === 0 ? access : null;
    }

    #of(uid: string): GoogleAccess | null {
        return this.#uid === uid ? this.#access : null;
    }

    drop(): void {
        this.#uid = null;
        this.#access = null;
    }
}
