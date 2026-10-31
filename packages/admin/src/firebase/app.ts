/**
 * The admin's Firebase app (`docs/research/M2b-interfaces.md` §1.4 step 3): `initializeApp` with the web configuration,
 * App Check (reCAPTCHA Enterprise) only when `runtime.json` names a site key (never in start-up mode, the e2e build or
 * the first deploys), and in the `e2e` build Auth, Firestore, Storage and Functions on the emulators. Firestore and
 * Storage are created on first use, so start-up mode touches neither.
 *
 * Auth keeps the signed-in owner in the tab's `sessionStorage` only (M6, finding 1 of the security review): since M6
 * the public map and the admin share one origin (`https://<project>.web.app/` and `/admin/`), and IndexedDB or
 * `localStorage` are the whole origin's, so a script on any viewer page could read the owner's refresh token there.
 * `sessionStorage` belongs to the one tab (a link opened with `noopener` gets none), so only the admin's own tab holds
 * it; the price is one sign-in per tab (`DECISIONS-for-review.md` §73a, for the user).
 */
import type { FirebaseApp, FirebaseOptions } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import type { FirebaseStorage } from 'firebase/storage';

import type { AdminRuntime, FirebaseWebConfig } from '../app/config.js';
import type { AnalyticsSdk } from './analytics.js';
import type { FirebaseSdk } from './sdk.js';

/** The emulators of `firebase.json` (project `demo-hcm`). */
const EMULATOR_HOST = '127.0.0.1';
export const EMULATOR_PORTS = { auth: 9099, firestore: 8080, functions: 5001, storage: 9199 } as const;

/** The functions' region (`functions/src/global-options.ts`). */
export const FUNCTIONS_REGION = 'us-central1';

export interface FirebaseHandles {
    readonly app: FirebaseApp;
    readonly auth: Auth;
    readonly functions: Functions;
    readonly firestore: () => Firestore;
    readonly storage: () => FirebaseStorage;
}

function once<T>(create: () => T): () => T {
    let value: { readonly made: T } | null = null;
    return () => {
        value ??= { made: create() };
        return value.made;
    };
}

/** `initializeApp`'s options: the web configuration without its absent keys. */
export function firebaseOptions(config: FirebaseWebConfig): FirebaseOptions {
    const { storageBucket, measurementId, ...required } = config;
    return {
        ...required,
        ...(storageBucket === undefined ? {} : { storageBucket }),
        ...(measurementId === undefined ? {} : { measurementId }),
    };
}

/** The app and its services; `emulators` is the `e2e` build mode. */
export function initFirebase(sdk: FirebaseSdk, config: FirebaseWebConfig, runtime: AdminRuntime, emulators: boolean): FirebaseHandles {
    const app = sdk.initializeApp(firebaseOptions(config));
    const siteKey = runtime.appCheckSiteKey;
    if (siteKey !== undefined && !emulators) {
        sdk.initializeAppCheck(app, { provider: new sdk.ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
    }
    // The popup's resolver goes with each popup (`adapters.ts` `firebasePopup`).
    const auth = sdk.initializeAuth(app, { persistence: sdk.browserSessionPersistence });
    const functions = sdk.getFunctions(app, FUNCTIONS_REGION);
    if (emulators) {
        sdk.connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${String(EMULATOR_PORTS.auth)}`, { disableWarnings: true });
        sdk.connectFunctionsEmulator(functions, EMULATOR_HOST, EMULATOR_PORTS.functions);
    }
    const firestore = once(() => {
        const created = sdk.getFirestore(app);
        if (emulators) {
            sdk.connectFirestoreEmulator(created, EMULATOR_HOST, EMULATOR_PORTS.firestore);
        }
        return created;
    });
    const storage = once(() => {
        const created = sdk.getStorage(app);
        if (emulators) {
            sdk.connectStorageEmulator(created, EMULATOR_HOST, EMULATOR_PORTS.storage);
        }
        return created;
    });
    return { app, auth, functions, firestore, storage };
}

/** The lazily imported analytics module. */
export async function loadAnalyticsSdk(): Promise<AnalyticsSdk<FirebaseApp>> {
    const module = await import('./analytics-sdk.js');
    return module.analyticsSdk as unknown as AnalyticsSdk<FirebaseApp>;
}
