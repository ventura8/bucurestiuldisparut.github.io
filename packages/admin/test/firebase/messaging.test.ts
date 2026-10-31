/**
 * Web push on this browser (`packages/admin/src/firebase/messaging.ts`; `docs/research/M4-interfaces.md` §5.4): the
 * Notifications API's permission, the service worker beside the page and the installation id FCM registered for it
 * (`register`, `onRegistered`); the `e2e` build's stand-in with a fixed token; the lazily loaded messaging module. No
 * browser, no FCM: a scripted scope.
 */
import type { FirebaseApp } from 'firebase/app';
import type { Messaging } from 'firebase/messaging';
import { describe, expect, it } from 'vitest';

import {
    PUSH_SERVICE_WORKER,
    firebasePush,
    loadMessagingSdk,
    retireRootWorker,
    standInPush,
    standInToken,
    type MessagingSdk,
    type PushScope,
} from '../../src/firebase/messaging.js';

const APP = { name: 'e2e' } as unknown as FirebaseApp;
const REGISTRATION = { scope: 'https://demo-hcm.web.app/' } as unknown as ServiceWorkerRegistration;

function scope(options: { permission?: NotificationPermission; answer?: NotificationPermission; worker?: boolean; push?: boolean } = {}) {
    const registered: { readonly url: string; readonly scope: string }[] = [];
    const browser: PushScope = {
        Notification: {
            permission: options.permission ?? 'default',
            requestPermission: () => Promise.resolve(options.answer ?? 'granted'),
        },
        navigator:
            options.worker === false
                ? {}
                : {
                      serviceWorker: {
                          register: (url, registration) => {
                              registered.push({ url, scope: registration.scope });
                              return Promise.resolve(REGISTRATION);
                          },
                      },
                  },
        ...(options.push === false ? {} : { PushManager: {} }),
    };
    return { browser, registered };
}

/** The SDK's seam: `register` hands `fid` to the `onRegistered` listener before it settles ('' : it hands none). */
function sdk(fid = 'fcm-installation-id-of-this-browser'): MessagingSdk & { readonly asked: unknown[]; listeners: number } {
    const asked: unknown[] = [];
    const listeners = new Set<(fid: string) => void>();
    const fake = {
        asked,
        listeners: 0,
        getMessaging: (app: FirebaseApp): Messaging => ({ app }),
        onRegistered: (_messaging: Messaging, next: (id: string) => void) => {
            listeners.add(next);
            fake.listeners = listeners.size;
            return () => {
                listeners.delete(next);
                fake.listeners = listeners.size;
            };
        },
        register: (messaging: Messaging, options: { readonly serviceWorkerRegistration: ServiceWorkerRegistration }) => {
            asked.push({ messaging, registration: options.serviceWorkerRegistration });
            if (fid !== '') {
                listeners.forEach((next) => {
                    next(fid);
                });
            }
            return Promise.resolve();
        },
    };
    return fake;
}

describe('firebasePush', () => {
    it('happyPath_thePromptThenTheServiceWorkerThenItsInstallationId', async () => {
        const { browser, registered } = scope();
        const messaging = sdk();
        const push = firebasePush({ scope: browser, app: APP, load: () => Promise.resolve(messaging) });

        await expect(push.requestPermission()).resolves.toBe('granted');
        await expect(push.token()).resolves.toBe('fcm-installation-id-of-this-browser');

        expect([push.supported(), push.permission()]).toEqual([true, 'default']);
        expect(registered).toEqual([{ url: PUSH_SERVICE_WORKER, scope: './' }]);
        expect(messaging.asked).toEqual([{ messaging: { app: APP }, registration: REGISTRATION }]);
        expect(messaging.listeners).toBe(0);
    });

    it.each([
        ['no service worker', { worker: false }],
        ['no Push API', { push: false }],
    ])('badPath_aBrowserWith_%s_cannotPush', (_name, options) => {
        expect(firebasePush({ scope: scope(options).browser, app: APP, load: () => Promise.resolve(sdk()) }).supported()).toBe(false);
    });

    it('badPath_noServiceWorkerOrNoInstallationIdMeansNoToken', async () => {
        const push = firebasePush({ scope: scope({ worker: false }).browser, app: APP, load: () => Promise.resolve(sdk()) });
        await expect(push.token()).rejects.toThrow('no service worker');

        const silent = sdk('');
        const unanswered = firebasePush({ scope: scope().browser, app: APP, load: () => Promise.resolve(silent) });
        await expect(unanswered.token()).rejects.toThrow('no installation id');
        expect(silent.listeners).toBe(0);
    });

    it('badPath_noNotificationsApiIsAPermissionDenied', async () => {
        const push = firebasePush({ scope: { navigator: {} }, app: APP, load: () => Promise.resolve(sdk()) });

        await expect(push.requestPermission()).resolves.toBe('denied');
        expect([push.supported(), push.permission()]).toEqual([false, 'denied']);
    });
});

describe('the e2e stand-in', () => {
    it('happyPath_theBrowsersOwnPermissionAndAFixedTokenPerTest', async () => {
        const { browser, registered } = scope({ permission: 'granted' });
        const push = standInPush(browser, 'S-A47 happy/1');

        await expect(push.token()).resolves.toBe('e2e-fcm-token:S-A47happy1-browser-0001');
        expect(push.permission()).toBe('granted');
        expect(standInToken('')).toBe('e2e-fcm-token:local-browser-0001');
        // The admin's own worker, as in production, beside its page.
        expect(registered).toEqual([{ url: PUSH_SERVICE_WORKER, scope: './' }]);
    });

    it('badPath_aBrowserThatRefusesServiceWorkersStillGetsItsToken', async () => {
        // The e2e projects block service workers unless a spec allows them.
        const refusing: PushScope = {
            navigator: { serviceWorker: { register: () => Promise.reject(new Error('blocked')) } },
            Notification: { permission: 'granted', requestPermission: () => Promise.resolve('granted') },
        };

        await expect(standInPush(refusing, 'x').token()).resolves.toBe('e2e-fcm-token:x-browser-0001');
        await expect(standInPush({ navigator: {} }, 'x').token()).resolves.toBe('e2e-fcm-token:x-browser-0001');
    });
});

describe('retireRootWorker (M6: the admin moved to /admin/)', () => {
    /** Registrations of a browser at the Hosting origin, each recording whether it was unregistered. */
    function withRegistrations(scopes: readonly string[], refuse = false) {
        const unregistered: string[] = [];
        const registrations = scopes.map((registrationScope) => ({
            scope: registrationScope,
            unregister: () => {
                unregistered.push(registrationScope);
                return refuse ? Promise.reject(new Error('refused')) : Promise.resolve(true);
            },
        }));
        const { browser, registered } = scope();
        const worker = browser.navigator.serviceWorker;
        const withRoot: PushScope = {
            ...browser,
            navigator: {
                serviceWorker: {
                    register: (url, options) => worker?.register(url, options) ?? Promise.resolve(REGISTRATION),
                    getRegistrations: () => Promise.resolve(registrations),
                },
            },
            location: { origin: 'https://demo-hcm.web.app' },
        };
        return { browser: withRoot, unregistered, registered };
    }

    it('happyPath_theRootScopesWorkerIsUnregisteredBeforeTheAdminRegistersItsOwn', async () => {
        const { browser, unregistered, registered } = withRegistrations(['https://demo-hcm.web.app/', 'https://demo-hcm.web.app/admin/']);
        const push = firebasePush({ scope: browser, app: APP, load: () => Promise.resolve(sdk()) });

        await push.token();

        expect(unregistered).toEqual(['https://demo-hcm.web.app/']);
        expect(registered).toEqual([{ url: PUSH_SERVICE_WORKER, scope: './' }]);
    });

    it('badPath_aRefusalOrABrowserWithoutTheApiLeavesThingsAsTheyAre', async () => {
        const refusing = withRegistrations(['https://demo-hcm.web.app/'], true);

        await expect(retireRootWorker(refusing.browser)).resolves.toBe(0);
        await expect(retireRootWorker(scope().browser)).resolves.toBe(0);
        await expect(retireRootWorker({ navigator: {} })).resolves.toBe(0);
        const failing: PushScope = {
            navigator: {
                serviceWorker: { register: () => Promise.resolve(REGISTRATION), getRegistrations: () => Promise.reject(new Error('x')) },
            },
            location: { origin: 'https://demo-hcm.web.app' },
        };
        await expect(retireRootWorker(failing)).resolves.toBe(0);
        await expect(retireRootWorker(withRegistrations(['https://demo-hcm.web.app/admin/']).browser)).resolves.toBe(0);
    });
});

describe('loadMessagingSdk', () => {
    it('happyPath_theLazyModuleHoldsTheSdksFunctions', async () => {
        const messaging = await loadMessagingSdk();

        expect([typeof messaging.getMessaging, typeof messaging.register, typeof messaging.onRegistered]).toEqual([
            'function',
            'function',
            'function',
        ]);
    });
});
