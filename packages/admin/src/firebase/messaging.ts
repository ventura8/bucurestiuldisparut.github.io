/**
 * Web push on this browser (`docs/research/M4-interfaces.md` §5.4) behind the `PushRegistrar` port: the Notifications
 * API's permission (the browser's own prompt, only from the admin's click) and the FCM registration of the admin's
 * service worker (`firebase-messaging-sw.js` beside the page, written by the admin's site build: it shows a pushed
 * notification as text and opens its admin page). The registration is the browser's Firebase installation ID (FID),
 * which `register` hands to `onRegistered` (firebase 13 deprecates `getToken`); the server sends to it as `fid`, and the
 * shared schemas keep calling it the device's token (DECISIONS-for-review.md §54). The FCM SDK is a chunk of its own,
 * loaded on the first registration. UNVERIFIED (§10): that FCM accepts registrations made with the SDK's default VAPID
 * key, so none is configured here.
 *
 * The `e2e` build's stand-in (`standInPush`) keeps the browser's real permission (Playwright grants or denies it) and
 * hands out a fixed token per test, since no browser test may reach FCM: the server side is the fake FCM.
 */
import type { FirebaseApp } from 'firebase/app';
import type { Messaging } from 'firebase/messaging';

import type { PushPermission, PushRegistrar } from '../inbox/push.js';

/** The service worker's file, next to the admin's page; its scope is the page's folder. */
export const PUSH_SERVICE_WORKER = 'firebase-messaging-sw.js';

/** What the registrar needs of the browser (the node tests pass a plain object). */
export interface PushScope {
    readonly Notification?: {
        readonly permission: NotificationPermission;
        requestPermission(): Promise<NotificationPermission>;
    };
    readonly navigator: {
        readonly serviceWorker?: { register(url: string, options: { readonly scope: string }): Promise<ServiceWorkerRegistration> };
    };
    readonly PushManager?: unknown;
}

/** What the registration needs of `firebase/messaging`. */
export interface MessagingSdk {
    getMessaging(app: FirebaseApp): Messaging;
    register(messaging: Messaging, options: { readonly serviceWorkerRegistration: ServiceWorkerRegistration }): Promise<void>;
    onRegistered(messaging: Messaging, next: (fid: string) => void): () => void;
}

/** The lazily imported messaging module. */
export async function loadMessagingSdk(): Promise<MessagingSdk> {
    const module = await import('./messaging-sdk.js');
    return module.messagingSdk;
}

function permissionOf(scope: PushScope): PushPermission {
    return scope.Notification?.permission ?? 'denied';
}

/** The browser's permission part, shared by the real registrar and the stand-in. */
function browserPermission(scope: PushScope): Pick<PushRegistrar, 'supported' | 'permission' | 'requestPermission'> {
    return {
        supported: () => scope.Notification !== undefined && scope.navigator.serviceWorker !== undefined && scope.PushManager !== undefined,
        permission: () => permissionOf(scope),
        requestPermission: async () => (await scope.Notification?.requestPermission()) ?? 'denied',
    };
}

export interface FirebasePushDeps {
    readonly scope: PushScope;
    readonly app: FirebaseApp;
    readonly load: () => Promise<MessagingSdk>;
}

/** The installation id `register` hands to `onRegistered` (it calls it before its promise settles). */
async function registeredFid(sdk: MessagingSdk, app: FirebaseApp, registration: ServiceWorkerRegistration): Promise<string> {
    const messaging = sdk.getMessaging(app);
    const answer = { fid: '' };
    const stop = sdk.onRegistered(messaging, (fid) => {
        answer.fid = fid;
    });
    try {
        await sdk.register(messaging, { serviceWorkerRegistration: registration });
    } finally {
        stop();
    }
    if (answer.fid === '') {
        throw new Error('FCM registered no installation id');
    }
    return answer.fid;
}

/** Push through FCM: the service worker registered, then this browser's FCM registration (its installation id). */
export function firebasePush(deps: FirebasePushDeps): PushRegistrar {
    return {
        ...browserPermission(deps.scope),
        token: async () => {
            const worker = deps.scope.navigator.serviceWorker;
            if (worker === undefined) {
                throw new Error('no service worker in this browser');
            }
            const [sdk, registration] = await Promise.all([deps.load(), worker.register(PUSH_SERVICE_WORKER, { scope: './' })]);
            return registeredFid(sdk, deps.app, registration);
        },
    };
}

/** The `e2e` build's token of the test `testId` (the address's `?test=`): what the fake FCM takes as a registration token. */
export function standInToken(testId: string): string {
    const name = testId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    return `e2e-fcm-token:${name === '' ? 'local' : name}-browser-0001`;
}

/** The `e2e` build's registrar: the browser's real permission, a fixed token, no FCM. */
export function standInPush(scope: PushScope, testId: string): PushRegistrar {
    return { ...browserPermission(scope), token: () => Promise.resolve(standInToken(testId)) };
}
