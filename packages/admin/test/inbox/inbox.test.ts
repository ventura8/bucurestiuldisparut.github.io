/**
 * The inbox area (`packages/admin/src/inbox/inbox.ts`; `docs/research/M4-interfaces.md` §5.5): the admin's notifications
 * newest first, marking read (one and all), the push settings saved with the Firestore SDK, and push on this browser
 * (`push.ts`) through a scripted registrar and callables. Every value is a generated test value.
 */
import { DEFAULT_PUSH_KINDS, FIRESTORE_PATHS, type NotificationKind } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { INBOX_MODULE, INBOX_PAGE_SIZE, kindsWith, settingsOf } from '../../src/inbox/inbox.js';
import { rememberPushDevice, storedPushDevice } from '../../src/inbox/push-device.js';
import type { PushPermission, PushRegistrar } from '../../src/inbox/push.js';
import { failure } from '../app/fakes.js';
import { at, contentWorld, type ContentWorld } from '../content/world.js';

const UID = 'admin-uid';

function item(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        kind: 'job.failed',
        severity: 'error',
        cityId: 'bucharest',
        params: { label: `Corona ${String(id)}` },
        link: `#/imagery/version/job-${String(id)}`,
        createdAt: at(`2026-10-${String(10 + id).padStart(2, '0')}T08:00:00.000Z`),
        read: false,
        updatedBy: 'system:notify',
        updatedAt: at('2026-10-24T08:00:00.000Z'),
        ...overrides,
    };
}

function itemPath(id: number): string {
    return FIRESTORE_PATHS.inboxItem(UID, `job.failed~bucharest~job-${String(id)}~0`);
}

/** A scripted browser: its permission, what its prompt answers and its token (or a failure). */
function registrar(options: { permission?: PushPermission; answer?: PushPermission; token?: string | null; supported?: boolean } = {}) {
    const asked: string[] = [];
    let permission = options.permission ?? 'default';
    const fake: PushRegistrar = {
        supported: () => options.supported ?? true,
        permission: () => permission,
        requestPermission: () => {
            asked.push('prompt');
            permission = options.answer ?? 'granted';
            return Promise.resolve(permission);
        },
        token: () =>
            options.token === null
                ? Promise.reject(new Error('no push service'))
                : Promise.resolve(options.token ?? 'e2e-fcm-token:inbox-browser-0001'),
    };
    return { fake, asked };
}

async function settled(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
        await Promise.resolve();
    }
}

function inbox(world: ContentWorld) {
    const store = INBOX_MODULE.create(world.services);
    store.open([]);
    return store;
}

describe('the list', () => {
    it('happyPath_theAdminsNotificationsNewestFirstWithMore', () => {
        const world = contentWorld();
        for (let id = 1; id <= INBOX_PAGE_SIZE + 1; id += 1) {
            world.store.put(itemPath(id), item(id % 15, { link: `#/jobs/${String(id)}` }));
        }
        world.store.put(FIRESTORE_PATHS.inboxItem('someone-else', 'job.failed~bucharest~x~0'), item(1));
        const store = inbox(world);
        store.open([]);

        expect(store.state.list).toMatchObject({ status: 'ready', hasMore: true });
        expect(store.state.list.items).toHaveLength(INBOX_PAGE_SIZE);
        expect(store.state.list.items[0]).toMatchObject({
            kind: 'job.failed',
            severity: 'error',
            read: false,
            createdAt: '2026-10-24T08:00:00.000Z',
        });
        const seen: number[] = [];
        const stop = store.subscribe((state) => seen.push(state.list.items.length));
        store.intents.more();
        stop();
        expect(store.state.list.items).toHaveLength(INBOX_PAGE_SIZE + 1);
        expect(seen.at(-1)).toBe(INBOX_PAGE_SIZE + 1);
        expect([INBOX_MODULE.area, store.hasUnsavedChanges()]).toEqual(['inbox', false]);
    });

    it('badPath_aRefusedListenerAsksWhoThisIsAndTryAgainReads', () => {
        const world = contentWorld();
        const store = inbox(world);

        world.store.fail(FIRESTORE_PATHS.inbox(UID), { kind: 'denied', code: 'permission-denied' });
        expect([store.state.list.status, world.denials.count]).toEqual(['error', 1]);

        world.store.put(itemPath(1), item(1));
        store.intents.retry();
        expect(store.state.list.items).toHaveLength(1);
        store.destroy();
        expect(world.store.listeners()).toBe(0);
    });
});

describe('marking read', () => {
    it('happyPath_openingAnUnreadItemMarksItReadOnce', async () => {
        const world = contentWorld();
        world.store.put(itemPath(1), item(1));
        world.store.put(itemPath(2), item(2, { read: true }));
        const store = inbox(world);

        store.intents.markRead('job.failed~bucharest~job-1~0');
        store.intents.markRead('job.failed~bucharest~job-2~0');
        store.intents.markRead('not-listed');
        await settled();

        expect(world.store.writes).toEqual([{ kind: 'update', path: itemPath(1), fields: { read: true }, expected: null }]);
        expect(store.state.list.items.every((row) => row.read)).toBe(true);
        expect(world.notices).toEqual([]);
    });

    it('happyPath_markAllAsReadWritesTheUnreadInOneBatch', async () => {
        const world = contentWorld();
        world.store.put(itemPath(1), item(1));
        world.store.put(itemPath(2), item(2, { read: true }));
        world.store.put(itemPath(3), item(3));
        const store = inbox(world);

        await store.intents.markAllRead();
        await store.intents.markAllRead();

        expect(world.store.writes).toEqual([
            {
                kind: 'batch',
                writes: [
                    { kind: 'update', path: itemPath(3), fields: { read: true } },
                    { kind: 'update', path: itemPath(1), fields: { read: true } },
                ],
            },
        ]);
        expect(store.state.marking).toBe(false);
    });

    it.each([
        ['denied', 'adminContent.common.denied', 1],
        ['offline', 'adminContent.common.offline', 0],
        ['gone', null, 0],
    ] as const)('badPath_aWrite_%s_says_%s', async (reason, notice, denials) => {
        const world = contentWorld();
        world.store.put(itemPath(1), item(1));
        const store = inbox(world);
        world.store.outcomes.push({ ok: false, reason });

        store.intents.markRead('job.failed~bucharest~job-1~0');
        await settled();

        expect(world.notices).toEqual(notice === null ? [] : [{ key: notice }]);
        expect(world.denials.count).toBe(denials);
    });
});

describe('the push settings', () => {
    it('happyPath_theFirstSwitchCreatesTheSettingsAndTheNextUpdatesThem', async () => {
        const world = contentWorld();
        const store = inbox(world);
        expect(store.state.settings).toEqual({ status: 'ready', push: false, kinds: DEFAULT_PUSH_KINDS, saving: false });

        await store.intents.setKind('order.imported', true);
        await store.intents.setKind('job.failed', false);

        const path = FIRESTORE_PATHS.notifySettings(UID);
        expect(world.store.writes).toEqual([
            { kind: 'create', path, data: { push: false, pushKinds: [...DEFAULT_PUSH_KINDS, 'order.imported'] } },
            {
                kind: 'update',
                path,
                fields: { pushKinds: kindsWith([...DEFAULT_PUSH_KINDS, 'order.imported'], 'job.failed', false) },
                expected: null,
            },
        ]);
        expect(store.state.settings.kinds).not.toContain('job.failed');
        expect(world.notices).toEqual([{ key: 'adminContent.notify.settings.saved' }, { key: 'adminContent.notify.settings.saved' }]);
    });

    it('badPath_settingsStillLoadingShowTheDefaults', () => {
        expect(settingsOf({ status: 'loading', doc: null, reconnecting: false, failure: null })).toEqual({
            status: 'loading',
            push: false,
            kinds: DEFAULT_PUSH_KINDS,
            saving: false,
        });
        expect(kindsWith(['job.failed'] as NotificationKind[], 'job.failed', true)).toEqual(['job.failed']);
    });
});

describe('push on this browser', () => {
    it('happyPath_theBrowsersPromptGrantedRegistersTheDeviceAndATestIsSent', async () => {
        const browser = registrar();
        const world = contentWorld({ push: browser.fake });
        world.callables.answer('notify.registerDevice', () => ({ deviceId: 'a'.repeat(32) }));
        world.callables.answer('notify.sendTest', () => ({ sent: 2, removed: 0 }));
        const store = inbox(world);
        expect(store.state.push.device).toBe('off');

        await store.intents.turnOnPush();
        await store.intents.sendTest();

        expect(browser.asked).toEqual(['prompt']);
        expect(world.callables.calls.map((call) => [call.name, call.request])).toEqual([
            ['notify.registerDevice', { token: 'e2e-fcm-token:inbox-browser-0001', lang: 'ro' }],
            ['notify.sendTest', {}],
        ]);
        expect(store.state.push).toEqual({ device: 'on', failure: null, testing: false });
        expect(storedPushDevice(world.services.local)).toEqual({ uid: UID, deviceId: 'a'.repeat(32) });
        expect(world.notices).toEqual([{ key: 'adminContent.notify.push.testSent.few', params: { count: '2' } }]);
    });

    it('badPath_aRefusedPromptKeepsTheInboxAndRegistersNothing', async () => {
        const browser = registrar({ answer: 'denied' });
        const world = contentWorld({ push: browser.fake });
        const store = inbox(world);

        await store.intents.turnOnPush();

        expect(store.state.push.device).toBe('denied');
        expect(world.callables.calls).toEqual([]);
    });

    it('badPath_aPromptDismissedLeavesPushOff', async () => {
        const world = contentWorld({ push: registrar({ answer: 'default' }).fake });
        const store = inbox(world);

        await store.intents.turnOnPush();

        expect(store.state.push.device).toBe('off');
    });

    it.each([
        ['no token from the browser', null, null, 'apiError.unavailable'],
        [
            'a token FCM refuses',
            'e2e-fcm-token:stale-browser-0001',
            failure('invalid-argument', 'apiError.notify.deviceInvalid'),
            'apiError.notify.deviceInvalid',
        ],
    ] as const)('badPath_%s_failsWithItsReason', async (_name, token, refusal, key) => {
        const world = contentWorld({ push: registrar({ token }).fake });
        if (refusal !== null) {
            world.callables.fail('notify.registerDevice', refusal);
        }
        const store = inbox(world);

        await store.intents.turnOnPush();

        expect(store.state.push).toMatchObject({ device: 'failed', failure: { key } });
        expect(storedPushDevice(world.services.local)).toBeNull();
    });

    it('happyPath_aRegisteredBrowserShowsOnAndTurningItOffUnregistersIt', async () => {
        const world = contentWorld({ push: registrar({ permission: 'granted' }).fake });
        rememberPushDevice(world.services.local, UID, 'b'.repeat(32));
        world.callables.answer('notify.unregisterDevice', () => ({ removed: true }));
        const store = inbox(world);
        expect(store.state.push.device).toBe('on');

        await store.intents.turnOffPush();
        await store.intents.turnOffPush();

        expect(world.callables.calls.map((call) => call.request)).toEqual([{ deviceId: 'b'.repeat(32) }]);
        expect(store.state.push.device).toBe('off');
        expect(storedPushDevice(world.services.local)).toBeNull();
    });

    it('badPath_anUnregisterThatFailsKeepsPushOnAndSaysWhy', async () => {
        const world = contentWorld({ push: registrar({ permission: 'granted' }).fake });
        rememberPushDevice(world.services.local, UID, 'b'.repeat(32));
        world.callables.fail('notify.unregisterDevice', failure('unavailable', 'apiError.unavailable'));
        const store = inbox(world);

        await store.intents.turnOffPush();

        expect(store.state.push).toEqual({ device: 'on', failure: null, testing: false });
        expect(storedPushDevice(world.services.local)).toEqual({ uid: UID, deviceId: 'b'.repeat(32) });
        expect(world.notices).toEqual([{ key: 'apiError.unavailable' }]);
    });

    it('badPath_anotherAdminsRegistrationOnThisBrowserShowsPushOffAndIsKept', async () => {
        const world = contentWorld({ push: registrar({ permission: 'granted' }).fake });
        rememberPushDevice(world.services.local, 'other-admin', 'c'.repeat(32));
        const store = inbox(world);
        expect(store.state.push.device).toBe('off');

        await store.intents.turnOffPush();

        expect(world.callables.calls).toEqual([]);
        expect(storedPushDevice(world.services.local)).toEqual({ uid: 'other-admin', deviceId: 'c'.repeat(32) });
    });

    it.each([
        ['no registrar', null, 'unsupported'],
        ['a browser without push', registrar({ supported: false }).fake, 'unsupported'],
        ['a browser that refused before', registrar({ permission: 'denied' }).fake, 'denied'],
        ['a granted browser never registered here', registrar({ permission: 'granted' }).fake, 'off'],
    ] as const)('happyPath_%s_shows_%s', (_name, push, device) => {
        const store = inbox(contentWorld({ push }));

        expect(store.state.push.device).toBe(device);
    });

    it('badPath_aBrowserWithoutPushIsNeverPrompted', async () => {
        const browser = registrar({ supported: false });
        const store = inbox(contentWorld({ push: browser.fake }));

        await store.intents.turnOnPush();

        expect([store.state.push.device, browser.asked]).toEqual(['unsupported', []]);
    });

    it('badPath_aFailedTestSaysWhy', async () => {
        const world = contentWorld({ push: registrar({ permission: 'granted' }).fake });
        world.callables.fail(
            'notify.sendTest',
            failure('failed-precondition', 'apiError.cloud.permission', { role: 'roles/firebasecloudmessaging.admin' }),
        );
        const store = inbox(world);

        await store.intents.sendTest();

        expect(world.notices).toEqual([{ key: 'apiError.cloud.permission', params: { role: 'roles/firebasecloudmessaging.admin' } }]);
    });
});
