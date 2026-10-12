/**
 * cities/{city}/photos/{photo}: strict field validation like `photoDocSchema` (CR-1: `dateText`, `title.ro` required),
 * locations within the city, the creation contract (`processing: 'pending'`, unpublished, the creator) and the publish
 * gate (processed derivatives and a known licence). Server-owned fields: client-writes.test.ts.
 */
import { FIRESTORE_PATHS } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CITY_BOUNDS, cityDoc, links, newPhoto, photoDoc } from './support/documents.js';
import {
    createWorld,
    deleted,
    past,
    serverTime,
    stampedBy,
    verdict,
    withChanges,
    type Data,
    type Verdict,
    type World,
} from './support/world.js';

const CITY_ID = 'rules-photos';

let world: World;
let sequence = 0;

function nextPath(city = CITY_ID): string {
    sequence += 1;
    return FIRESTORE_PATHS.photo(city, `p${String(sequence)}`);
}

function create(changes: Data, path = nextPath()): Promise<Verdict> {
    return verdict(
        world
            .db('admin')
            .doc(path)
            .set(withChanges(newPhoto(world.uid('admin')), changes)),
    );
}

/** The minimal photo an admin may create: the required fields only. */
function minimal(): Data {
    const uid = world.uid('admin');
    return {
        title: { ro: 'Fără titlu' },
        location: { lat: 44.43, lng: 26.1 },
        license: 'unknown',
        published: false,
        processing: 'pending',
        createdAt: serverTime(),
        createdBy: uid,
        ...stampedBy(uid),
    };
}

async function update(seed: Data, changes: Data): Promise<Verdict> {
    const path = nextPath();
    await world.seed(path, seed);
    return verdict(
        world
            .db('admin')
            .doc(path)
            .update({ ...stampedBy(world.uid('admin')), ...changes }),
    );
}

function processed(changes: Data = {}): Data {
    return { ...photoDoc(CITY_ID, 'p0', world.uid('admin')), ...changes };
}

beforeAll(async () => {
    world = await createWorld('photos');
    await world.seed(FIRESTORE_PATHS.city(CITY_ID), cityDoc(CITY_ID));
});

afterAll(async () => {
    await world.env.cleanup();
});

describe('create', () => {
    it('happyPath_adminCreatesAPhotoWithOnlyTheRequiredFields', async () => {
        expect(await verdict(world.db('admin').doc(nextPath()).set(minimal()))).toBe('allow');
    });

    it.each([
        ['every client field', {}],
        ['the corners of the city plus half a degree', { location: { lat: CITY_BOUNDS.south - 0.5, lng: CITY_BOUNDS.west - 0.5 } }],
        ['a year without an end year', { yearEnd: deleted() }],
        ['the same start and end year', { year: 1900, yearEnd: 1900 }],
        ['the oldest and newest years', { year: 1800, yearEnd: 2100 }],
        ['no links', { links: [] }],
        ['a dating text in Romanian only', { dateText: { ro: 'Iarna 1940' } }],
        ['a source URL with a path, query and fragment', { sourceUrl: 'https://example.org/a/b?c=d#e' }],
    ])('happyPath_adminCreatesAPhotoWith_%s', async (_label, changes) => {
        expect(await create(changes)).toBe('allow');
    });

    it.each([
        ['published at once', { published: true }],
        ['processing claimed done', { processing: 'done' }],
        ['another creator', { createdBy: 'someone-else' }],
        ['a client createdAt', { createdAt: past() }],
        ['no creator', { createdBy: deleted() }],
        ['a title without Romanian', { title: { en: 'Roman Square' } }],
        ['a title in another language', { title: { ro: 'Piața Romană', fr: 'Place Romaine' } }],
        ['a title that is not a map', { title: 'Piața Romană' }],
        ['a title over 200 characters', { title: { ro: 'x'.repeat(201) } }],
        ['a blank title', { title: { ro: ' \n\t ' } }],
        ['an empty English title', { title: { ro: 'Piața Romană', en: '' } }],
        ['an English description over 5000 characters', { description: { ro: 'Vedere.', en: 'x'.repeat(5001) } }],
        ['a dating text over 100 characters', { dateText: { ro: 'x'.repeat(101) } }],
        ['a dating text without Romanian', { dateText: { en: 'July 1936' } }],
        ['a year before 1800', { year: 1799, yearEnd: 1800 }],
        ['a fractional year', { year: 1935.5 }],
        ['an end year before the year', { year: 1935, yearEnd: 1930 }],
        ['an end year after 2100', { yearEnd: 2101 }],
        ['an end year without a year', { year: deleted() }],
        ['a location north of the city', { location: { lat: CITY_BOUNDS.north + 0.51, lng: 26.1 } }],
        ['a location south of the city', { location: { lat: CITY_BOUNDS.south - 0.51, lng: 26.1 } }],
        ['a location east of the city', { location: { lat: 44.43, lng: CITY_BOUNDS.east + 0.51 } }],
        ['a location west of the city', { location: { lat: 44.43, lng: CITY_BOUNDS.west - 0.51 } }],
        ['a location without longitude', { location: { lat: 44.43 } }],
        ['a location with altitude', { location: { lat: 44.43, lng: 26.1, alt: 80 } }],
        ['a location that is a list', { location: [26.1, 44.43] }],
        ['a location off the globe', { location: { lat: 91, lng: 26.1 } }],
        ['a bearing over 360', { bearing: 361 }],
        ['a negative bearing', { bearing: -1 }],
        ['a field of view of 0', { fov: 0 }],
        ['a field of view over 180', { fov: 181 }],
        ['an unknown licence', { license: 'GPL-3.0' }],
        ['an author over 200 characters', { author: 'x'.repeat(201) }],
        ['a rights holder that is not text', { rightsHolder: 42 }],
        ['a source label over 200 characters', { sourceLabel: 'x'.repeat(201) }],
        ['an http source URL', { sourceUrl: 'http://example.org/foto' }],
        ['a javascript: source URL', { sourceUrl: 'javascript:alert(1)' }],
        ['a source URL with credentials', { sourceUrl: 'https://user:pass@example.org/foto' }],
        ['a source URL with a space', { sourceUrl: 'https://example.org/a b' }],
        ['a source URL over 2048 characters', { sourceUrl: `https://example.org/${'x'.repeat(2048)}` }],
        ['a permission note over 2000 characters', { permissionNote: 'x'.repeat(2001) }],
        ['a legacy id over 64 characters', { legacyId: 'x'.repeat(65) }],
        ['six links', { links: links(6) }],
        ['links that are not a list', { links: 'https://example.org' }],
        ['a link without a label', { links: [{ url: 'https://example.org' }] }],
        ['a link with an extra key', { links: [{ url: 'https://example.org', label: 'Sursa', target: '_blank' }] }],
        ['an http link', { links: [...links(1), { url: 'http://example.org', label: 'Sursa' }] }],
        ['a link label over 200 characters', { links: [...links(2), { url: 'https://example.org', label: 'x'.repeat(201) }] }],
        ['a fourth link that is text', { links: [...links(3), 'https://example.org'] }],
        ['a fifth link without a URL', { links: [...links(4), { label: 'Sursa' }] }],
        ['a published flag that is not a boolean', { published: 'no' }],
        ['a rights review flag that is not a boolean', { rightsReview: 'yes' }],
        ['another editor', { updatedBy: 'someone-else' }],
        ['an unknown field', { html: '<a href="x">x</a>' }],
    ])('badPath_adminCannotCreateWith_%s', async (_label, changes) => {
        expect(await create(changes)).toBe('deny');
    });

    it.each(['title', 'location', 'license', 'published', 'processing'])('badPath_requiredFieldsCannotBeLeftOut_%s', async (field) => {
        const photo = withChanges(minimal(), { [field]: deleted() });

        expect(await verdict(world.db('admin').doc(nextPath()).set(photo))).toBe('deny');
    });

    it.each(['p 1', 'x'.repeat(41), 'p.1'])('badPath_photoIdsFollowTheIdPattern_%s', async (id) => {
        expect(await create({}, `${FIRESTORE_PATHS.photos(CITY_ID)}/${id}`)).toBe('deny');
    });

    it('badPath_photosNeedAnExistingCity', async () => {
        expect(await create({}, nextPath('rules-photos-missing'))).toBe('deny');
    });
});

describe('update', () => {
    it('happyPath_adminEditsTextAndPlacement', async () => {
        expect(await update(processed(), { title: { ro: 'Calea Victoriei' }, bearing: 270, fov: 45 })).toBe('allow');
    });

    it.each([
        ['a processed photo with a licence', {}],
        ['a photo flagged for a rights review', { rightsReview: true }],
    ])('happyPath_adminPublishes_%s', async (_label, seed) => {
        expect(await update(processed(seed), { published: true })).toBe('allow');
    });

    it('happyPath_adminUnpublishesWhateverTheState', async () => {
        expect(await update(processed({ processing: 'pending', license: 'unknown', published: true }), { published: false })).toBe('allow');
    });

    it.each([
        ['an unprocessed photo', () => processed({ processing: 'pending' })],
        ['a photo whose processing failed', () => processed({ processing: 'failed' })],
        ['a photo without derivatives', () => withChanges(processed(), { image: deleted() })],
        ['a photo of unknown licence', () => processed({ license: 'unknown' })],
    ])('badPath_adminCannotPublish_%s', async (_label, seed) => {
        expect(await update(seed(), { published: true })).toBe('deny');
    });

    it('badPath_aPublishedPhotoCannotSwitchToAnUnknownLicence', async () => {
        expect(await update(processed({ published: true }), { license: 'unknown' })).toBe('deny');
    });

    it.each([
        ['a bearing of 400', { bearing: 400 }],
        ['a title without Romanian', { title: { en: 'Victory Avenue' } }],
        ['a removed title', { title: deleted() }],
        ['a location outside the city', { location: { lat: 47.16, lng: 27.58 } }],
    ])('badPath_editsAreValidatedLikeCreates_%s', async (_label, changes) => {
        expect(await update(processed(), changes)).toBe('deny');
    });
});
