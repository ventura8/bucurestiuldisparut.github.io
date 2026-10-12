import { describe, expect, it, vi } from 'vitest';

import { legacyPhotoStore, photoStateOf } from '../../src/app/legacy-photos.js';
import type { LegacyPhotoFields } from '../../src/import/bundle.js';
import { FakeDocuments } from './fakes.js';

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
