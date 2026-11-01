/**
 * The FCM SDK's record of this browser's registration (finding 46 of `docs/research/manual-test-2026-10-25.md`). firebase
 * 13's `register()` keeps, per app, the installation id it registered and when (IndexedDB `firebase-messaging-database`,
 * store `firebase-messaging-fid-registration-store`, `@firebase/messaging` 0.13.3), and for seven days answers from that
 * record without asking FCM again (`CreateRegistration` at `fcmregistrations.googleapis.com`): the record says nothing of
 * the push subscription or the service worker it was made with. A registration FCM no longer accepts (made with the
 * root-scoped worker of an admin before M6, whose subscription went with that worker; or forgotten by FCM) is then handed
 * out again unchanged, and every dry run refuses it. Forgetting the record makes the next `register()` create the
 * registration again with this worker's current subscription. Best effort: a browser without IndexedDB, or a database the
 * SDK never made, is left alone (opening the database by name creates none: its creation is aborted).
 */

/** The SDK's database and the store of its installation-id registrations (`@firebase/messaging` 0.13.3). */
export const FCM_DATABASE = 'firebase-messaging-database';
export const FCM_REGISTRATION_STORE = 'firebase-messaging-fid-registration-store';

/** What the forgetting needs of IndexedDB (the node tests pass a fake). */
export interface RecordRequest<T> {
    readonly result: T;
    readonly transaction: { abort(): void } | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
    onupgradeneeded: (() => void) | null;
}

export interface RecordTransaction {
    objectStore(name: string): { clear(): unknown };
    oncomplete: (() => void) | null;
    onerror: (() => void) | null;
    onabort: (() => void) | null;
}

export interface RecordDatabase {
    readonly objectStoreNames: { contains(name: string): boolean };
    transaction(store: string, mode: 'readwrite'): RecordTransaction;
    close(): void;
}

export interface RecordFactory {
    open(name: string): RecordRequest<RecordDatabase>;
}

/** Clears the registrations' store of an open database; true once the clear is committed. */
function clearStore(database: RecordDatabase): Promise<boolean> {
    if (!database.objectStoreNames.contains(FCM_REGISTRATION_STORE)) {
        database.close();
        return Promise.resolve(false);
    }
    return new Promise((resolve) => {
        const transaction = database.transaction(FCM_REGISTRATION_STORE, 'readwrite');
        const settle = (done: boolean): void => {
            database.close();
            resolve(done);
        };
        transaction.oncomplete = () => {
            settle(true);
        };
        transaction.onerror = () => {
            settle(false);
        };
        transaction.onabort = () => {
            settle(false);
        };
        transaction.objectStore(FCM_REGISTRATION_STORE).clear();
    });
}

/** Opens the SDK's database if it exists (a new one's creation is aborted), or null. */
function openExisting(factory: RecordFactory): Promise<RecordDatabase | null> {
    return new Promise((resolve) => {
        const request = factory.open(FCM_DATABASE);
        request.onupgradeneeded = () => {
            request.transaction?.abort();
        };
        request.onerror = () => {
            resolve(null);
        };
        request.onsuccess = () => {
            resolve(request.result);
        };
    });
}

/** Forgets the SDK's record of this browser's FCM registration; true when one could be cleared. Never throws. */
export async function forgetFcmRegistration(factory: RecordFactory | undefined): Promise<boolean> {
    if (factory === undefined) {
        return false;
    }
    try {
        const database = await openExisting(factory);
        return database === null ? false : await clearStore(database);
    } catch {
        return false;
    }
}
