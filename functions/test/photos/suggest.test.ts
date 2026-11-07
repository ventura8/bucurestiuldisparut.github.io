/** `suggestions.submit`, `suggestions.decide` and `contributors.setBlocked` (M13 §4), through their callables' `.run()`. */
import {
    FIRESTORE_PATHS,
    SUGGESTIONS_PER_DAY,
    contributorDocSchema,
    notificationEventDocSchema,
    notificationEventId,
    photoDocSchema,
    suggestionDocSchema,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { suggestionsFunctions, contributorsFunctions } from '../../src/photos/index.js';
import { suggestionGroupId } from '../../src/photos/suggest.js';
import { CITY_ID, as, communityWorld, refusal, seedPhoto, type CommunityWorld } from './community-world.js';

const PLACE = { location: { lat: 44.44, lng: 26.1 }, bearing: 45 };

function submit(world: CommunityWorld, uid: string | null, data: Record<string, unknown> = {}) {
    return suggestionsFunctions(() => world).submit.run(
        as(uid, { cityId: CITY_ID, photoId: 'lost', kind: 'place', proposal: PLACE, ...data }),
    );
}

function decide(world: CommunityWorld, uid: string, group: string, data: Record<string, unknown> = {}) {
    return suggestionsFunctions(() => world).decide.run(as(uid, { cityId: CITY_ID, suggestionId: group, decision: 'approve', ...data }));
}

const GROUP = suggestionGroupId({ photoId: 'lost', kind: 'place', proposal: PLACE });

const group = (world: CommunityWorld, id = GROUP) => world.documents.get(FIRESTORE_PATHS.suggestion(CITY_ID, id), suggestionDocSchema);
const photo = (world: CommunityWorld, id = 'lost') => world.documents.get(FIRESTORE_PATHS.photo(CITY_ID, id), photoDocSchema);

async function world() {
    const created = await communityWorld();
    await seedPhoto(created, 'lost', { location: undefined, bearing: undefined });
    await seedPhoto(created, 'placed');
    return created;
}

describe('suggestions.submit', () => {
    it('happyPath_anyoneSignedInSuggestsAPlaceAndThePublicPhotoStays @S-A63-HAPPY-PLACE', async () => {
        const w = await world();
        await expect(submit(w, 'u-stranger', { credit: 'Maria' })).resolves.toEqual({ received: true, remainingToday: SUGGESTIONS_PER_DAY - 1 });
        expect(await group(w)).toMatchObject({ photoId: 'lost', status: 'pending', count: 1, accounts: ['u-stranger'], proposal: PLACE });
        expect((await photo(w))?.location).toBeUndefined();
        const id = notificationEventId('suggestion.waiting', CITY_ID, GROUP);
        expect(await w.documents.get(FIRESTORE_PATHS.notificationEvent(id), notificationEventDocSchema)).toMatchObject({ cityId: CITY_ID });
    });

    it('happyPath_aPlacedPhotoIsContestedWithAReason @S-A63-HAPPY-CORRECTION', async () => {
        const w = await world();
        const correction = { photoId: 'placed', kind: 'correction', proposal: { year: 1950 }, reason: 'Pe verso scrie 1950.', sourceUrl: 'https://example.org/x' };
        await expect(submit(w, 'u-stranger', correction)).resolves.toMatchObject({ received: true });
        const id = suggestionGroupId({ photoId: 'placed', kind: 'correction', proposal: { year: 1950 } });
        expect((await group(w, id))?.voices[0]).toMatchObject({ reason: 'Pe verso scrie 1950.', sourceUrl: 'https://example.org/x' });
    });

    it('happyPath_repeatsGroupAndAnAccountCountsOnce @S-A63-HAPPY-GROUP', async () => {
        const w = await world();
        await submit(w, 'u-a');
        await submit(w, 'u-a');
        // A few metres away and a few degrees round: the same proposal.
        await submit(w, 'u-b', { proposal: { location: { lat: 44.44001, lng: 26.10001 }, bearing: 50 } });
        expect(await group(w)).toMatchObject({ count: 2, accounts: ['u-a', 'u-b'] });
        expect((await group(w))?.voices).toHaveLength(2);
    });

    it('badPath_aRepeatOfARefusedProposalReopensNothing', async () => {
        const w = await world();
        await submit(w, 'u-a');
        await decide(w, 'u-moderator', GROUP, { decision: 'reject' });
        await expect(submit(w, 'u-b')).resolves.toMatchObject({ received: true });
        expect(await group(w)).toMatchObject({ status: 'rejected', count: 2 });
        expect((await group(w))?.voices).toHaveLength(1);
    });

    it('badPath_theDailyLimitHolds @S-A63-BAD-DAILY-LIMIT', async () => {
        const w = await world();
        await w.documents.set(FIRESTORE_PATHS.contributor(CITY_ID, 'u-a'), contributorDocSchema, {
            day: w.clock.now().toISOString().slice(0, 10),
            count: SUGGESTIONS_PER_DAY,
            updatedBy: 'u-a',
            updatedAt: { seconds: 0, nanoseconds: 0 } as never,
        });
        expect(await refusal(submit(w, 'u-a'))).toBe('apiError.suggestion.dailyLimit');
        expect(await group(w)).toBeUndefined();
    });

    it('happyPath_theLimitIsADays', async () => {
        const w = await world();
        await w.documents.set(FIRESTORE_PATHS.contributor(CITY_ID, 'u-a'), contributorDocSchema, {
            day: '2020-01-01',
            count: SUGGESTIONS_PER_DAY,
            updatedBy: 'u-a',
            updatedAt: { seconds: 0, nanoseconds: 0 } as never,
        });
        await expect(submit(w, 'u-a')).resolves.toMatchObject({ remainingToday: SUGGESTIONS_PER_DAY - 1 });
    });

    it('badPath_aBlockedAccountIsRefused @S-A63-BAD-BLOCKED', async () => {
        const w = await world();
        await contributorsFunctions(() => w).setBlocked.run(as('u-moderator', { cityId: CITY_ID, uid: 'u-a', blocked: true }));
        expect(await refusal(submit(w, 'u-a'))).toBe('apiError.contribute.blocked');
        await contributorsFunctions(() => w).setBlocked.run(as('u-moderator', { cityId: CITY_ID, uid: 'u-a', blocked: false }));
        await expect(submit(w, 'u-a')).resolves.toMatchObject({ received: true });
    });

    it('badPath_anUploaderMayNotBlock', async () => {
        const w = await world();
        const run = contributorsFunctions(() => w).setBlocked.run(as('u-uploader', { cityId: CITY_ID, uid: 'u-a', blocked: true }));
        expect(await refusal(run)).toBe('apiError.city.notReviewer');
    });

    it('badPath_outsideTheCity @S-A63-BAD-OUTSIDE', async () => {
        const w = await world();
        expect(await refusal(submit(w, 'u-a', { proposal: { location: { lat: 10, lng: 10 } } }))).toBe('apiError.suggestion.outsideCity');
    });

    it.each([
        ['an unpublished photo', { published: false }],
        ['a photo waiting for review', { reviewStatus: 'pending', published: true }],
        ['a refused photo', { reviewStatus: 'refused', published: true }],
    ])('badPath_%s_isNotThere @S-A63-BAD-NOT-PUBLIC', async (_name, overrides) => {
        const w = await world();
        await seedPhoto(w, 'hidden', { location: undefined, bearing: undefined, ...(overrides as object) });
        expect(await refusal(submit(w, 'u-a', { photoId: 'hidden' }))).toBe('apiError.notFound');
    });

    it('badPath_thePlaceToolIsForUnplacedAndTheCorrectionForPlaced', async () => {
        const w = await world();
        expect(await refusal(submit(w, 'u-a', { photoId: 'placed' }))).toBe('apiError.suggestion.wrongKind');
        expect(await refusal(submit(w, 'u-a', { kind: 'correction', reason: 'x' }))).toBe('apiError.suggestion.wrongKind');
    });

    it('badPath_whatThePhotoAlreadySays', async () => {
        const w = await world();
        const same = { photoId: 'placed', kind: 'correction', proposal: { location: { lat: 44.43, lng: 26.09 }, bearing: 90 }, reason: 'x' };
        expect(await refusal(submit(w, 'u-a', same))).toBe('apiError.suggestion.noChange');
    });

    it.each([
        ['a correction with no reason', { photoId: 'placed', kind: 'correction', proposal: { year: 1950 } }],
        ['a place with no location', { proposal: { bearing: 10 } }],
        ['nothing at all', { proposal: {} }],
        ['a source that is not https', { sourceUrl: 'javascript:alert(1)' }],
        ['an end before its start', { photoId: 'placed', kind: 'correction', reason: 'x', proposal: { year: 1950, yearEnd: 1940 } }],
    ])('badPath_%s_isInvalid', async (_name, data) => {
        const w = await world();
        expect(await refusal(submit(w, 'u-a', data))).toBe('apiError.invalidRequest');
    });

    it('badPath_signedOut', async () => {
        const w = await world();
        expect(await refusal(submit(w, null))).toBe('apiError.unauthenticated');
    });
});

describe('suggestions.decide', () => {
    it('happyPath_approvingPlacesThePhotoAsTheReviewer @S-A63-HAPPY-APPROVE', async () => {
        const w = await world();
        await submit(w, 'u-a', { credit: 'Maria' });
        await expect(decide(w, 'u-moderator', GROUP)).resolves.toEqual({ status: 'approved' });
        expect(await photo(w)).toMatchObject({ ...PLACE, credit: 'Maria', updatedBy: 'u-moderator' });
        expect(await group(w)).toMatchObject({ status: 'approved', decidedBy: 'u-moderator' });
    });

    it('happyPath_adjustingAppliesTheReviewersValues @S-A63-HAPPY-ADJUST', async () => {
        const w = await world();
        await submit(w, 'u-a');
        const adjusted = { location: { lat: 44.45, lng: 26.11 }, bearing: 90 };
        await expect(decide(w, 'u-editor', GROUP, { decision: 'adjust', adjusted, note: 'Puțin mai la nord.' })).resolves.toEqual({ status: 'adjusted' });
        expect(await photo(w)).toMatchObject(adjusted);
        expect(await group(w)).toMatchObject({ status: 'adjusted', applied: adjusted, note: 'Puțin mai la nord.' });
    });

    it('happyPath_aDateTextIsApplied', async () => {
        const w = await world();
        const proposal = { dateText: 'Vara lui 1936' };
        await submit(w, 'u-a', { photoId: 'placed', kind: 'correction', proposal, reason: 'x' });
        await decide(w, 'u-owner', suggestionGroupId({ photoId: 'placed', kind: 'correction', proposal }));
        expect((await photo(w, 'placed'))?.dateText).toEqual({ ro: 'Vara lui 1936' });
    });

    it('happyPath_rejectingChangesNothingPublic @S-A63-HAPPY-REJECT', async () => {
        const w = await world();
        await submit(w, 'u-a');
        await expect(decide(w, 'u-owner', GROUP, { decision: 'reject' })).resolves.toEqual({ status: 'rejected' });
        expect((await photo(w))?.location).toBeUndefined();
    });

    it('badPath_decidedTwice @S-A63-BAD-DECIDED-TWICE', async () => {
        const w = await world();
        await submit(w, 'u-a');
        await decide(w, 'u-owner', GROUP);
        expect(await refusal(decide(w, 'u-owner', GROUP))).toBe('apiError.suggestion.alreadyDecided');
    });

    it('badPath_anAdjustmentOutsideTheCityOrWithNoValues', async () => {
        const w = await world();
        await submit(w, 'u-a');
        const far = { decision: 'adjust', adjusted: { location: { lat: 10, lng: 10 } } };
        expect(await refusal(decide(w, 'u-owner', GROUP, far))).toBe('apiError.suggestion.outsideCity');
        expect(await refusal(decide(w, 'u-owner', GROUP, { decision: 'adjust' }))).toBe('apiError.invalidRequest');
    });

    it('badPath_aGroupWhosePhotoIsGoneOrNoGroup', async () => {
        const w = await world();
        await submit(w, 'u-a');
        await w.documents.delete(FIRESTORE_PATHS.photo(CITY_ID, 'lost'));
        expect(await refusal(decide(w, 'u-owner', GROUP))).toBe('apiError.notFound');
        expect(await refusal(decide(w, 'u-owner', 'nosuch'))).toBe('apiError.notFound');
    });

    it.each([
        ['u-uploader', 'apiError.city.notReviewer'],
        ['u-other', 'apiError.city.notMember'],
        ['u-stranger', 'apiError.notAdmin'],
    ])('badPath_%s_mayNotDecide', async (uid, code) => {
        const w = await world();
        await submit(w, 'u-a');
        expect(await refusal(decide(w, uid, GROUP))).toBe(code);
        expect((await photo(w))?.location).toBeUndefined();
    });
});
