/**
 * One read of a query through the content store's listener (`ContentStore` has no one-shot read): the first answer,
 * then the listener goes. The settings read the city's photos and places this way before saving smaller bounds, and the
 * places of a category before deleting it.
 */
import type { Schema } from '@hcm/shared';

import type { Unsubscribe } from '../app/ports.js';
import type { ContentQuery, ContentStore, StoredPage } from '../content/services.js';

/** The query's first answer, or null when the listener failed. */
export function readOnce<T>(
    store: ContentStore,
    collection: string,
    schema: Schema<T>,
    query: ContentQuery,
): Promise<StoredPage<T> | null> {
    return new Promise((resolve) => {
        const read: { settled: boolean; stop: Unsubscribe | null } = { settled: false, stop: null };
        const settle = (page: StoredPage<T> | null): void => {
            if (!read.settled) {
                read.settled = true;
                resolve(page);
                read.stop?.();
            }
        };
        const stop = store.watchQuery(collection, schema, query, settle, () => {
            settle(null);
        });
        read.stop = stop;
        if (read.settled) {
            stop();
        }
    });
}
