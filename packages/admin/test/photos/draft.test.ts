// The photo draft: edits change only the draft; Save writes the changed fields guarded by the version read; a newer
// snapshot merges what the draft did not change and raises the conflict for what it did.
import type { PhotoDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { draftIssues, PhotoDraft, patched, sameValue, valueOf, type PhotoDraftState, type PhotoPatch } from '../../src/photos/draft.js';
import type { Stored } from '../../src/content/services.js';
import { at, CITY, photoDoc, photoPath, photosWorld, seedPhoto } from './world.js';

const BOUNDS = [
    [26, 44.3],
    [26.3, 44.55],
] as const;

function draftWorld(preset: PhotoPatch = {}) {
    const world = photosWorld();
    const states: PhotoDraftState[] = [];
    const draft = new PhotoDraft('p1', {
        store: world.store,
        cityId: CITY,
        bounds: () => BOUNDS,
        preset: () => preset,
        changed: (state) => {
            states.push(state);
        },
    });
    return { world, draft, states };
}

function stored(overrides: Partial<PhotoDoc> = {}, version = '2026-10-17T10:00:00.000Z'): Stored<PhotoDoc> {
    return { id: 'p1', path: photoPath('p1'), data: photoDoc(overrides), version, pending: false };
}

describe('PhotoDraft: editing', () => {
    it('happyPath_anEditChangesTheDraftAndMarksTheField', () => {
        const { draft } = draftWorld();
        draft.rebase(stored());

        draft.edit({ title: { ro: 'Piața Romană' }, author: 'Ion' });

        expect(draft.state).toMatchObject({ loaded: true, touched: true, dirty: ['title', 'author'], issues: [] });
        draft.edit({ author: undefined });
        expect(draft.state.dirty).toEqual(['title']);
    });

    it('badPath_editsBeforeTheFirstSnapshotAreIgnored', () => {
        const { draft } = draftWorld();

        draft.edit({ author: 'Ion' });

        expect(draft.state).toMatchObject({ loaded: false, value: null, touched: false });
    });

    it('badPath_aPlaceOutsideTheCityAndABlankTitleAreProblems', () => {
        const { draft } = draftWorld();
        draft.rebase(stored());

        draft.edit({ location: { lat: 46, lng: 26.1 }, title: { ro: ' ' } });

        expect(draft.state.issues.map((issue) => [issue.path, issue.code])).toEqual([
            ['title.ro', 'validation.tooSmall'],
            ['location', 'validation.outsideCity'],
        ]);
    });

    it('badPath_publishedWithAnUnknownLicenceIsAProblem', () => {
        const { draft } = draftWorld();
        draft.rebase(stored({ published: true }));

        draft.edit({ license: 'unknown' });

        expect(draft.state.issues).toEqual([{ path: 'published', code: 'validation.value' }]);
    });

    it('happyPath_discardGoesBackToTheStoredPhoto', () => {
        const { draft } = draftWorld();
        draft.rebase(stored());
        draft.edit({ author: 'Ion' });

        draft.discard();

        expect(draft.state).toMatchObject({ touched: false, dirty: [] });
    });

    it('happyPath_aPresetStartsTheDraftWithoutTouchingIt', () => {
        const { draft } = draftWorld({ published: true });

        draft.rebase(stored());

        expect(draft.state).toMatchObject({ touched: false, dirty: ['published'] });
        expect(draft.state.value?.published).toBe(true);
    });
});

describe('PhotoDraft: snapshots and conflicts', () => {
    it('happyPath_anUntouchedDraftFollowsTheStoredPhoto', () => {
        const { draft } = draftWorld();
        draft.rebase(stored());

        draft.rebase(stored({ author: 'Ana' }, 'v2'));

        expect(draft.state).toMatchObject({ dirty: [], value: { author: 'Ana' } });
    });

    it('happyPath_anotherAdminsChangeOfAnotherFieldMergesIn', () => {
        const { draft } = draftWorld();
        draft.rebase(stored());
        draft.edit({ author: 'Ion' });

        draft.rebase(stored({ year: 1936, updatedBy: 'other-uid' }, 'v2'));

        expect(draft.state).toMatchObject({ conflict: null, dirty: ['author'] });
        expect(draft.state.base?.data.year).toBe(1936);
    });

    it('badPath_aChangeOfTheSameFieldIsAConflictTheAdminResolves', () => {
        const { draft } = draftWorld();
        draft.rebase(stored());
        draft.edit({ author: 'Ion' });

        draft.rebase(stored({ author: 'Ana', updatedBy: 'other-uid' }, 'v2'));

        expect(draft.state.conflict).toEqual({ by: 'other-uid', at: 'v2', fields: ['author'] });
        draft.takeTheirs();
        expect(draft.state).toMatchObject({ conflict: null, dirty: [], value: { author: 'Ana' } });
    });

    it('happyPath_keepMineClearsTheConflictAndKeepsTheDraft', () => {
        const { draft } = draftWorld();
        draft.rebase(stored());
        draft.edit({ author: 'Ion' });
        draft.rebase(stored({ author: 'Ana', updatedBy: 'other-uid' }, 'v2'));

        draft.keepMine();

        expect(draft.state).toMatchObject({ conflict: null, value: { author: 'Ion' } });
        draft.takeTheirs();
        expect(draft.state.value?.author).toBe('Ion');
    });

    it('badPath_aPhotoDeletedWhileOpenIsGoneWithTheDraftKept', () => {
        const { draft } = draftWorld();
        draft.rebase(stored());
        draft.edit({ author: 'Ion' });

        draft.rebase(null);

        expect(draft.state).toMatchObject({ gone: true, base: null, value: { author: 'Ion' }, dirty: [] });
    });

    it('badPath_aPhotoThatNeverExistedIsNotFound', () => {
        const { draft } = draftWorld();

        draft.rebase(null);

        expect(draft.state).toMatchObject({ loaded: true, gone: false, base: null, value: null });
    });
});

describe('PhotoDraft: save', () => {
    it('happyPath_saveWritesTheChangedFieldsGuardedByTheVersion', async () => {
        const { world, draft } = draftWorld();
        seedPhoto(world, 'p1');
        const version = '2026-10-17T10:00:00.000Z';
        draft.rebase(stored({}, version));
        draft.edit({ author: 'Ion', bearing: undefined });

        await expect(draft.save()).resolves.toEqual({ ok: true });

        expect(world.store.writes).toEqual([{ kind: 'update', path: photoPath('p1'), fields: { author: 'Ion' }, expected: version }]);
        expect(draft.state).toMatchObject({ saving: false, touched: false });
    });

    it('badPath_aStoreConflictIsKeptOnTheDraft', async () => {
        const { world, draft } = draftWorld();
        seedPhoto(world, 'p1', { updatedAt: at('2026-10-17T11:00:00.000Z') });
        draft.rebase(stored());
        draft.edit({ author: 'Ion' });

        await expect(draft.save()).resolves.toEqual({ ok: false, reason: 'conflict' });

        expect(draft.state.conflict).toMatchObject({ fields: ['author'] });
        await expect(draft.save()).resolves.toEqual({ ok: false, reason: 'conflict' });
    });

    it('badPath_aDeletedPhotoIsGone', async () => {
        const { draft } = draftWorld();
        draft.rebase(stored());
        draft.edit({ author: 'Ion' });

        await expect(draft.save()).resolves.toEqual({ ok: false, reason: 'gone' });

        expect(draft.state.gone).toBe(true);
        await expect(draft.save()).resolves.toEqual({ ok: false, reason: 'gone' });
    });

    it('badPath_anInvalidDraftWritesNothing', async () => {
        const { world, draft } = draftWorld();
        draft.rebase(stored());
        draft.edit({ sourceUrl: 'http://insecure.example' });

        await expect(draft.save()).resolves.toMatchObject({ ok: false, reason: 'invalid' });

        expect(world.store.writes).toEqual([]);
    });

    it('badPath_anOfflineSaveKeepsTheDraft', async () => {
        const { world, draft } = draftWorld();
        seedPhoto(world, 'p1');
        world.store.setOffline(true);
        draft.rebase(stored());
        draft.edit({ author: 'Ion' });

        await expect(draft.save()).resolves.toEqual({ ok: false, reason: 'offline' });

        expect(draft.state).toMatchObject({ saving: false, touched: true, dirty: ['author'], conflict: null, gone: false });
    });

    it('badPath_issuesTheStoreReportsAreShown', async () => {
        const { world, draft } = draftWorld();
        world.store.outcomes.push({ ok: false, reason: 'invalid', issues: [{ path: 'author', code: 'validation.tooBig' }] });
        draft.rebase(stored());
        draft.edit({ author: 'Ion' });

        await draft.save();

        expect(draft.state.issues).toEqual([{ path: 'author', code: 'validation.tooBig' }]);
    });
});

describe('the draft helpers', () => {
    it('happyPath_valuesCompareWhateverTheirKeyOrder', () => {
        expect(sameValue({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1, d: undefined })).toBe(true);
        expect(sameValue([1], [2])).toBe(false);
        expect(sameValue(undefined, undefined)).toBe(true);
    });

    it('happyPath_valueOfAndPatched', () => {
        const value = valueOf(photoDoc({ author: 'Ion' }));
        expect(value).not.toHaveProperty('image');
        expect(patched(value, { author: undefined })).not.toHaveProperty('author');
    });

    it('happyPath_withoutBoundsThePlaceIsNotChecked', () => {
        const base = stored();
        expect(draftIssues(base, { ...valueOf(base.data), location: { lat: 10, lng: 10 } }, null)).toEqual([]);
    });
});
