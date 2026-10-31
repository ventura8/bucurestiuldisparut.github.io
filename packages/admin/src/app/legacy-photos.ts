/**
 * The legacy import's store (google-clients' `LegacyPhotoStore`, `packages/admin/src/import/legacy-import.ts`; CR-M2b-15)
 * over the shell's Firestore and Storage ports: the photo documents of a city and the private bucket's upload path. Every
 * write carries the stamp the rules check (`updatedBy` = the signed-in admin, `updatedAt` = `serverTimestamp()`, and on a
 * create `createdBy` and `createdAt` too), so a write is never refused for a missing stamp.
 */
import { FIRESTORE_PATHS, isApiErrorCode } from '@hcm/shared';

import type { DocumentData, FirebasePorts } from '../firebase/ports.js';
import type { LegacyPhotoStore, PhotoState } from '../import/legacy-import.js';

const PROCESSING: ReadonlySet<string> = new Set(['pending', 'done', 'failed']);

function isProcessing(value: unknown): value is PhotoState['processing'] {
    return typeof value === 'string' && PROCESSING.has(value);
}

/** What the import reads of a photo document (an unknown processing state counts as pending). */
export function photoStateOf(data: DocumentData | null): PhotoState | null {
    if (data === null) {
        return null;
    }
    const raw = data['processing'];
    const processing = isProcessing(raw) ? raw : 'pending';
    const error = data['processingError'];
    return {
        processing,
        hasImage: 'image' in data,
        published: data['published'] === true,
        ...(isApiErrorCode(error) ? { processingError: error } : {}),
    };
}

export function legacyPhotoStore(firebase: Pick<FirebasePorts, 'documents' | 'storage'>, uid: () => string | null): LegacyPhotoStore {
    const { documents, storage } = firebase;
    const stamp = (): DocumentData => ({ updatedBy: uid() ?? '', updatedAt: documents.serverTimestamp() });
    return {
        read: async (cityId, photoId) => photoStateOf(await documents.get(FIRESTORE_PATHS.photo(cityId, photoId))),
        findByLegacyId: async (cityId, legacyId) => {
            const found = await documents.query(FIRESTORE_PATHS.photos(cityId), [['legacyId', legacyId]]);
            return found[0]?.id ?? null;
        },
        create: async (cityId, photoId, fields) => {
            const created = { ...stamp(), createdBy: uid() ?? '', createdAt: documents.serverTimestamp() };
            await documents.set(FIRESTORE_PATHS.photo(cityId, photoId), { ...fields, ...created });
        },
        upload: (path, file, metadata) =>
            storage.upload(path, file, { contentType: metadata.contentType, customMetadata: { originalName: metadata.originalName } }),
        watch: (cityId, photoId, listener) =>
            documents.watch(
                FIRESTORE_PATHS.photo(cityId, photoId),
                (data) => {
                    listener(photoStateOf(data));
                },
                () => {
                    listener(null);
                },
            ),
        publish: (cityId, photoId) =>
            documents.set(FIRESTORE_PATHS.photo(cityId, photoId), { published: true, ...stamp() }, { merge: true }),
    };
}

/**
 * M6 (finding 17 of `docs/research/manual-test-2026-10-25.md`): the import's `photos.reprocess`, for a photo whose upload
 * event never reached the server; the callable uploads the photo's upload again, which is a new event.
 */
export function legacyReprocess(firebase: Pick<FirebasePorts, 'callables'>): (cityId: string, photoId: string) => Promise<void> {
    return async (cityId, photoId) => {
        await firebase.callables.call('photos.reprocess', { cityId, photoId });
    };
}
