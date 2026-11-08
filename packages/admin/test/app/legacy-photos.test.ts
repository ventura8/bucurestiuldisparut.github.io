import { describe, expect, it, vi } from 'vitest';

import { legacyPhotoStore, legacyReprocess, photoHistoryOf, photoStateOf } from '../../src/app/legacy-photos.js';
import type { LegacyPhotoFields } from '../../src/import/bundle.js';
import { FakeCallables, FakeDocuments } from './fakes.js';

const FIELDS = { title: { ro: 'Gara de Nord' }, published: false, processing: 'pending' } as unknown as LegacyPhotoFields;

function store(uid: string | null = 'owner-uid') {
    const documents = new FakeDocuments();
    const upload = vi.fn(() => Promise.resolve());
    const subject = legacyPhotoStore({ documents, storage: { upload } }, () => uid);
    return { documents, upload, subject };
}

describe('legacyPhotoStore', () => {
    it('happyPath_createsWithTheFullStampAndPublishesWithTheUpdateStamp', async () => {
        const s = store();

        await s.subject.create('bucharest', 'gara-de-nord', FIELDS);
        await s.subject.publish('bucharest', 'gara-de-nord');

        expect(s.documents.data.get('cities/bucharest/photos/gara-de-nord')).toEqual({
            published: true,
            updatedBy: 'owner-uid',
            updatedAt: { sentinel: 'serverTimestamp' },
        });
    });

    it('happyPath_readsWatchesFindsAndUploads', async () => {
        const s = store();
        s.documents.data.set('cities/bucharest/photos/p1', { processing: 'done', image: {}, published: true });
        const seen: unknown[] = [];

        await expect(s.subject.read('bucharest', 'p1')).resolves.toEqual({ processing: 'done', hasImage: true, published: true });
        await expect(s.subject.read('bucharest', 'p2')).resolves.toBeNull();
        await expect(s.subject.findByLegacyId('bucharest', 'legacy-1')).resolves.toBeNull();
        const stop = s.subject.watch('bucharest', 'p1', (state) => seen.push(state));
        s.documents.watchers.get('cities/bucharest/photos/p1')?.onError('permission-denied');
        stop();
        await s.subject.upload('uploads/photos/bucharest/owner-uid/p1/n.jpg', new Blob(['x']), {
            contentType: 'image/jpeg',
            originalName: 'Gara.jpg',
        });

        expect(seen).toEqual([{ processing: 'done', hasImage: true, published: true }, null]);
        expect(s.upload).toHaveBeenCalledWith('uploads/photos/bucharest/owner-uid/p1/n.jpg', expect.any(Blob), {
            contentType: 'image/jpeg',
            customMetadata: { originalName: 'Gara.jpg' },
        });
    });

    it('badPath_aMatchingLegacyIdIsFoundAndNobodySignedInStampsEmpty', async () => {
        const s = store(null);
        vi.spyOn(s.documents, 'query').mockResolvedValue([{ id: 'older', data: {} }]);

        await s.subject.create('bucharest', 'x', FIELDS);

        await expect(s.subject.findByLegacyId('bucharest', 'legacy-1')).resolves.toBe('older');
        expect(s.documents.data.get('cities/bucharest/photos/x')).toMatchObject({ updatedBy: '', createdBy: '' });
    });
});

describe('history (the 2023 additions)', () => {
    it('happyPath_readsThePhotosHistoryEntriesAndSeesAPublishedPreviousVersion', async () => {
        const s = store();
        const query = vi.spyOn(s.documents, 'query').mockResolvedValue([
            { id: 'e1', data: { action: 'create', previous: null, updatedBy: 'owner-uid' } },
            { id: 'e2', data: { action: 'update', previous: { published: true }, updatedBy: 'owner-uid' } },
            { id: 'e3', data: { action: 'delete', previous: { published: false }, updatedBy: 'owner-uid' } },
        ]);

        await expect(s.subject.history('bucharest', 'la-leu')).resolves.toEqual({ deleted: true, everPublished: true });
        expect(query).toHaveBeenCalledWith('cities/bucharest/photos/la-leu/history', []);
    });

    it('badPath_theServersWritesAndNeverPublishedVersionsSayNoPersonDeletedOrUnpublishedIt', () => {
        expect(photoHistoryOf([])).toEqual({ deleted: false, everPublished: false });
        expect(
            photoHistoryOf([
                { data: { action: 'create', previous: null, updatedBy: 'owner-uid' } },
                { data: { action: 'update', previous: { published: false }, updatedBy: 'owner-uid' } },
                { data: { action: 'update', previous: 'odd', updatedBy: 'owner-uid' } },
                // A delete by the server (a function, or the e2e world's reset) is not a person's.
                { data: { action: 'delete', previous: { published: true }, updatedBy: 'system:unknown' } },
                { data: { action: 'delete', previous: { published: true }, updatedBy: 'fn-photos@demo-hcm.iam.gserviceaccount.com' } },
                { data: { action: 'delete', previous: { published: true } } },
                { data: { action: 'delete', updatedBy: '' } },
            ]),
        ).toEqual({ deleted: false, everPublished: false });
    });
});

describe('photoStateOf', () => {
    it('badPath_anUnknownStateIsPendingAndOnlyAKnownErrorCodeIsKept', () => {
        expect(photoStateOf({ processing: 'odd', processingError: 'apiError.photo.unreadable' })).toEqual({
            processing: 'pending',
            hasImage: false,
            published: false,
            processingError: 'apiError.photo.unreadable',
        });
        expect(photoStateOf({ processing: 'failed', processingError: 'boom' })).toEqual({
            processing: 'failed',
            hasImage: false,
            published: false,
        });
    });
});

describe('legacyReprocess (M6, finding 17)', () => {
    it('happyPath_aStuckPhotoIsSentToPhotosReprocess', async () => {
        const callables = new FakeCallables();
        callables.answer('photos.reprocess', () => ({ processing: 'pending' }));

        await legacyReprocess({ callables })('bucharest', 'gara-de-nord');

        expect(callables.calls).toEqual([{ name: 'photos.reprocess', request: { cityId: 'bucharest', photoId: 'gara-de-nord' } }]);
    });
});
