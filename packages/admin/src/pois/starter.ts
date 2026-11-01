/**
 * The starter categories the place editor offers a city that has none (the live manual test of 2026-11-01, finding 35:
 * the migrated Bucharest had no category, so Add place showed an empty Category select and Save refused): one click
 * writes the five of `STARTER_POI_CATEGORIES` in one batch, each id the slug of its Romanian label kept clear of the
 * city's layers and categories (one overlay namespace), after the city's own categories in order. The layers' ids are
 * read once, at the click; a read that fails writes nothing.
 */
import { FIRESTORE_PATHS, MAX_LAYERS, starterCategoryDocs } from '@hcm/shared';
import { z } from 'zod';

import type { BatchWrite, ContentStore, WriteOutcome } from '../content/services.js';
import type { CategoryItem } from './model.js';

/** Any document: only the ids are read. */
const ANY_DOCUMENT = z.record(z.string(), z.unknown());

/** The ids of a collection's documents, read once (the listener stops at its first answer); null when the read failed. */
export function readIds(store: Pick<ContentStore, 'watchQuery'>, collection: string): Promise<readonly string[] | null> {
    return new Promise((resolve) => {
        const read: { answered: boolean; stop: (() => void) | null } = { answered: false, stop: null };
        const answer = (ids: readonly string[] | null): void => {
            if (!read.answered) {
                read.answered = true;
                resolve(ids);
                read.stop?.();
            }
        };
        const listened = (page: { readonly docs: readonly { readonly id: string }[] }): void => {
            answer(page.docs.map((doc) => doc.id));
        };
        read.stop = store.watchQuery(collection, ANY_DOCUMENT, { limit: MAX_LAYERS }, listened, () => {
            answer(null);
        });
        // An answer given while the listener was being attached could not stop it yet.
        if (read.answered) {
            read.stop();
        }
    });
}

/** The batch that adds the starter categories after `categories`, clear of `taken` (the layers' ids). */
export function starterWrites(cityId: string, categories: readonly CategoryItem[], taken: readonly string[]): BatchWrite[] {
    const first = categories.reduce((last, category) => Math.max(last, category.order + 1), 0);
    return starterCategoryDocs([...taken, ...categories.map((category) => category.id)], first).map(({ id, ...data }) => ({
        kind: 'create',
        path: FIRESTORE_PATHS.poiCategory(cityId, id),
        data: { ...data },
    }));
}

/** Writes the starter categories of `cityId` in one batch; nothing when the layers could not be read. */
export async function addStarterCategories(
    store: Pick<ContentStore, 'watchQuery' | 'batch'>,
    cityId: string,
    categories: readonly CategoryItem[],
): Promise<WriteOutcome> {
    const layers = await readIds(store, FIRESTORE_PATHS.layers(cityId));
    if (layers === null) {
        return { ok: false, reason: 'offline' };
    }
    return store.batch(starterWrites(cityId, categories, layers));
}
