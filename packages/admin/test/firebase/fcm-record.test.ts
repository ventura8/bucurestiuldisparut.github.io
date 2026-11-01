/**
 * The FCM SDK's record of this browser's registration (`packages/admin/src/firebase/fcm-record.ts`; finding 46 of
 * docs/research/manual-test-2026-10-25.md): forgetting it clears the SDK's store, creates no database the SDK never made,
 * and never throws. A scripted IndexedDB.
 */
import { describe, expect, it } from 'vitest';

import {
    FCM_DATABASE,
    FCM_REGISTRATION_STORE,
    forgetFcmRegistration,
    type RecordDatabase,
    type RecordFactory,
    type RecordRequest,
    type RecordTransaction,
} from '../../src/firebase/fcm-record.js';

type Ending = 'complete' | 'error' | 'abort';

interface Browser {
    readonly factory: RecordFactory;
    readonly opened: string[];
    readonly cleared: string[];
    readonly aborted: number;
    readonly closed: number;
}

/** `exists`: the SDK made its database; `store`: with its registrations' store; `ending`: how the clear ends. */
function browser(options: { exists?: boolean; store?: boolean; ending?: Ending; throws?: boolean } = {}): Browser {
    const world = { opened: [] as string[], cleared: [] as string[], aborted: 0, closed: 0 };
    const database: RecordDatabase = {
        objectStoreNames: { contains: (name) => (options.store ?? true) && name === FCM_REGISTRATION_STORE },
        transaction: (store) => {
            const transaction: RecordTransaction = {
                objectStore: () => ({
                    clear: () => {
                        world.cleared.push(store);
                        const ending = options.ending ?? 'complete';
                        queueMicrotask(() => {
                            const handlers = { complete: transaction.oncomplete, error: transaction.onerror, abort: transaction.onabort };
                            handlers[ending]?.();
                        });
                    },
                }),
                oncomplete: null,
                onerror: null,
                onabort: null,
            };
            return transaction;
        },
        close: () => {
            world.closed += 1;
        },
    };
    const factory: RecordFactory = {
        open: (name) => {
            if (options.throws === true) {
                throw new Error('IndexedDB is off in this window');
            }
            world.opened.push(name);
            const request: RecordRequest<RecordDatabase> = {
                result: database,
                transaction: {
                    abort: () => {
                        world.aborted += 1;
                        queueMicrotask(() => request.onerror?.());
                    },
                },
                onsuccess: null,
                onerror: null,
                onupgradeneeded: null,
            };
            queueMicrotask(() => (options.exists === false ? request.onupgradeneeded?.() : request.onsuccess?.()));
            return request;
        },
    };
    return {
        factory,
        get opened() {
            return world.opened;
        },
        get cleared() {
            return world.cleared;
        },
        get aborted() {
            return world.aborted;
        },
        get closed() {
            return world.closed;
        },
    };
}

describe('forgetFcmRegistration', () => {
    it('happyPath_theSdksRegistrationsAreClearedAndTheDatabaseClosed', async () => {
        const idb = browser();

        await expect(forgetFcmRegistration(idb.factory)).resolves.toBe(true);

        expect(idb.opened).toEqual([FCM_DATABASE]);
        expect(idb.cleared).toEqual([FCM_REGISTRATION_STORE]);
        expect(idb.closed).toBe(1);
    });

    it('badPath_aDatabaseTheSdkNeverMadeIsNotCreated', async () => {
        const idb = browser({ exists: false });

        await expect(forgetFcmRegistration(idb.factory)).resolves.toBe(false);

        expect(idb.aborted).toBe(1);
        expect(idb.cleared).toEqual([]);
    });

    it.each([
        ['no registrations store (an older SDK)', { store: false }, 0],
        ['a clear that fails', { ending: 'error' as const }, 1],
        ['a clear that is aborted', { ending: 'abort' as const }, 1],
    ])('badPath_%s_forgetsNothing', async (_name, options, clears) => {
        const idb = browser(options);

        await expect(forgetFcmRegistration(idb.factory)).resolves.toBe(false);

        expect(idb.cleared).toHaveLength(clears);
        expect(idb.closed).toBe(1);
    });

    it('badPath_noIndexedDbOrOneThatThrowsIsLeftAlone', async () => {
        await expect(forgetFcmRegistration(undefined)).resolves.toBe(false);
        await expect(forgetFcmRegistration(browser({ throws: true }).factory)).resolves.toBe(false);
    });
});
