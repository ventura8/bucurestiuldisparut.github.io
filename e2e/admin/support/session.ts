import { ADMIN_ORIGIN, ADMIN_WEB_CONFIG, FIREBASE_APP_NAME, PERSONAS } from '../world.js';
import type { SignedInAccount } from './emulators.js';

/**
 * A signed-in admin as a Playwright storage state (docs/research/M2b-interfaces.md §6.2): Firebase Auth keeps its
 * current user in IndexedDB (`firebaseLocalStorageDb` → `firebaseLocalStorage`, key `firebase:authUser:<apiKey>:<app>`,
 * the shape of `UserImpl.toJSON()` in `@firebase/auth` 1.13), so a context created with this state opens the admin
 * already signed in, with tokens the Auth emulator issued for this test. Playwright restores IndexedDB from a storage
 * state file (`storageState({indexedDB: true})` writes the same shape).
 */

/** Firebase Auth's IndexedDB persistence (`@firebase/auth`: `DB_NAME`, `DB_OBJECTSTORE_NAME`, `DB_DATA_KEYPATH`). */
export const FIREBASE_AUTH_DB = {
    name: 'firebaseLocalStorageDb',
    version: 1,
    store: 'firebaseLocalStorage',
    keyPath: 'fbase_key',
} as const;

/** The key Firebase Auth stores the current user under, for the admin's web configuration. */
export const FIREBASE_USER_KEY = `firebase:authUser:${ADMIN_WEB_CONFIG.apiKey}:${FIREBASE_APP_NAME}`;

/** What `UserImpl._fromJSON` reads back. */
function persistedUser(account: SignedInAccount, now: number): Record<string, unknown> {
    const persona = PERSONAS[account.persona];
    return {
        uid: account.uid,
        email: account.email,
        emailVerified: true,
        displayName: persona.displayName,
        isAnonymous: false,
        providerData: [
            {
                providerId: 'google.com',
                uid: persona.sub,
                displayName: persona.displayName,
                email: account.email,
                phoneNumber: null,
                photoURL: null,
            },
        ],
        stsTokenManager: {
            refreshToken: account.refreshToken,
            accessToken: account.idToken,
            expirationTime: now + account.expiresIn * 1000,
        },
        apiKey: ADMIN_WEB_CONFIG.apiKey,
        appName: FIREBASE_APP_NAME,
    };
}

/** The storage state file's content: the admin origin's IndexedDB holding `account` as Firebase Auth's current user. */
export function signedInStorageState(account: SignedInAccount, now: number): Record<string, unknown> {
    return {
        cookies: [],
        origins: [
            {
                origin: ADMIN_ORIGIN,
                localStorage: [],
                indexedDB: [
                    {
                        name: FIREBASE_AUTH_DB.name,
                        version: FIREBASE_AUTH_DB.version,
                        stores: [
                            {
                                name: FIREBASE_AUTH_DB.store,
                                autoIncrement: false,
                                keyPath: FIREBASE_AUTH_DB.keyPath,
                                records: [{ value: { [FIREBASE_AUTH_DB.keyPath]: FIREBASE_USER_KEY, value: persistedUser(account, now) } }],
                                indexes: [],
                            },
                        ],
                    },
                ],
            },
        ],
    };
}
