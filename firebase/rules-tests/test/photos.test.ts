/**
 * cities/{city}/photos/{photo}: strict field validation, server-owned processing fields and the
 * publish gate (processed derivatives + a known licence).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    EVERYONE,
    NON_ADMINS,
    createWorld,
    expected,
    past,
    serverTime,
    verdict,
    verdicts,
    type Data,
    type World,
} from './support/world.js';

const CITY_ID = 'rules-photos';
const PHOTOS = `cities/${CITY_ID}/photos`;

let world: World;
let sequence = 0;

function nextPath(): string {
    sequence += 1;
    return `${PHOTOS}/p${String(sequence)}`;
}

/** Every optional field present, so each validation branch is evaluated. */
function fullPhoto(uid: string): Data {
    return {
        title: { ro: 'Piața Romană', en: 'Roman Square' },
        description: { ro: 'Vedere spre nord.', en: 'Looking north.' },
        year: 1935,
        yearEnd: 1940,
        author: 'Ion Mureșan',
        rightsHolder: 'Ion Mureșan',
        sourceLabel: 'Arhiva familiei',
        sourceUrl: 'https://example.org/foto/1',
        permissionNote: 'Permisiune scrisă pentru proiect.',
        legacyId: 'ci9e9tn7b0356kzkuzlkncngf',
        links: [{ url: 'https://example.org/sursa', label: 'Sursa' }],
        location: { lat: 44.4462, lng: 26.0969 },
        bearing: 90,
        fov: 60,
        license: 'permission-legacy',
        published: false,
        rightsReview: true,
        processing: 'pending',
        createdBy: uid,
        createdAt: serverTime(),
        updatedBy: uid,
        updatedAt: serverTime(),
    };
}

/** Only the required fields. */
function minimalPhoto(uid: string): Data {
    return {
        title: { ro: 'Fără titlu' },
        location: { lat: 44.43, lng: 26.1 },
        license: 'unknown',
        published: false,
        processing: 'pending',
        createdBy: uid,
        createdAt: serverTime(),
        updatedBy: uid,
        updatedAt: serverTime(),
    };
}

/** A photo as photos.onUpload leaves it: processed, with derivatives. */
function processedPhoto(license: string): Data {
    return {
        ...minimalPhoto('pipeline'),
        license,
        processing: 'done',
        image: { web: 'photos/rules-photos/x/web.webp', thumb: 'photos/rules-photos/x/thumb.webp', sha256: 'ab12', w: 2048, h: 1536 },
        exif: { artist: 'Unknown' },
        createdAt: past(),
        updatedAt: past(),
    };
}

async function seeded(data: Data): Promise<string> {
    const path = nextPath();
    await world.seed(path, data);
    return path;
}

beforeAll(async () => {
    world = await createWorld('photos');
    await world.seed(`cities/${CITY_ID}`, { id: CITY_ID, bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 } });
});

afterAll(async () => {
    await world.env.cleanup();
});

describe('read', () => {
    it('happyPath_onlyAdminsReadPhotos', async () => {
        const path = await seeded(processedPhoto('CC0'));

        const result = await verdicts(EVERYONE, (persona) => world.db(persona).doc(path).get());

        expect(result).toEqual(expected(EVERYONE, ['admin']));
    });

    it('badPath_rulesAreNotFiltersSoOnlyAdminsList', async () => {
        const result = await verdicts(['stranger', 'admin'], (persona) => world.db(persona).collection(PHOTOS).get());

        expect(result).toEqual({ stranger: 'deny', admin: 'allow' });
    });
});

describe('create', () => {
    it.each([
        ['every field', fullPhoto],
        ['only the required fields', minimalPhoto],
    ])('happyPath_adminCreatesAPhotoWith_%s', async (_label, photo) => {
        const uid = world.uid('admin');

        expect(await verdict(world.db('admin').doc(nextPath()).set(photo(uid)))).toBe('allow');
    });

    it('happyPath_locationsJustOutsideTheBoundsAreAccepted', async () => {
        const uid = world.uid('admin');
        const photo = { ...minimalPhoto(uid), location: { lat: 44.3 - 0.49, lng: 26.3 + 0.49 } };

        expect(await verdict(world.db('admin').doc(nextPath()).set(photo))).toBe('allow');
    });

    it('badPath_nonAdminsCannotCreate', async () => {
        const result = await verdicts(NON_ADMINS, (persona) =>
            world
                .db(persona)
                .doc(nextPath())
                .set(minimalPhoto(world.uid(persona))),
        );

        expect(result).toEqual(expected(NON_ADMINS, []));
    });

    it.each([
        ['published at once', { published: true }],
        ['processing claimed done', { processing: 'done' }],
        ['server-owned image', { image: { web: 'https://evil.example/x.webp' } }],
        ['server-owned exif', { exif: {} }],
        ['another creator', { createdBy: 'someone-else' }],
        ['a client createdAt', { createdAt: past() }],
        ['an unknown field', { html: '<a href="x">x</a>' }],
        ['a title in another language', { title: { fr: 'Place Romaine' } }],
        ['a title that is not a map', { title: 'Piața Romană' }],
        ['a title over 200 characters', { title: { ro: 'x'.repeat(201) } }],
        ['an English description over 5000 characters', { description: { en: 'x'.repeat(5001) } }],
        ['a year before 1800', { year: 1799 }],
        ['a fractional year', { year: 1935.5 }],
        ['an end year before the year', { year: 1935, yearEnd: 1930 }],
        ['an end year after 2100', { yearEnd: 2101 }],
        ['a location outside the city', { location: { lat: 45.2, lng: 26.1 } }],
        ['a location without longitude', { location: { lat: 44.43 } }],
        ['a location with altitude', { location: { lat: 44.43, lng: 26.1, alt: 80 } }],
        ['a location that is not a map', { location: [26.1, 44.43] }],
        ['a bearing over 360', { bearing: 361 }],
        ['a field of view of 0', { fov: 0 }],
        ['an unknown licence', { license: 'GPL-3.0' }],
        ['an author over 200 characters', { author: 'x'.repeat(201) }],
        ['a rights holder that is not text', { rightsHolder: 42 }],
        ['a source label over 200 characters', { sourceLabel: 'x'.repeat(201) }],
        ['an http source URL', { sourceUrl: 'http://example.org/foto' }],
        ['a javascript: source URL', { sourceUrl: 'javascript:alert(1)' }],
        ['a permission note over 2000 characters', { permissionNote: 'x'.repeat(2001) }],
        ['a legacy id over 64 characters', { legacyId: 'x'.repeat(65) }],
        ['six links', { links: Array.from({ length: 6 }, () => ({ url: 'https://example.org' })) }],
        ['links that are not a list', { links: 'https://example.org' }],
        ['a published flag that is not a boolean', { published: 'no' }],
        ['a rights review flag that is not a boolean', { rightsReview: 'yes' }],
        ['another editor', { updatedBy: 'someone-else' }],
    ])('badPath_adminCannotCreateWith_%s', async (_label, changes) => {
        const photo = { ...fullPhoto(world.uid('admin')), ...changes };

        expect(await verdict(world.db('admin').doc(nextPath()).set(photo))).toBe('deny');
    });

    it('badPath_requiredFieldsCannotBeLeftOut', async () => {
        const untitled = minimalPhoto(world.uid('admin'));
        delete untitled['title'];

        expect(await verdict(world.db('admin').doc(nextPath()).set(untitled))).toBe('deny');
    });

    it('badPath_photosNeedAnExistingCity', async () => {
        const photo = minimalPhoto(world.uid('admin'));

        expect(await verdict(world.db('admin').doc('cities/rules-photos-missing/photos/p1').set(photo))).toBe('deny');
    });
});

describe('update', () => {
    const stamp = (): Data => ({ updatedBy: world.uid('admin'), updatedAt: serverTime() });

    it('happyPath_adminEditsTextAndPlacement', async () => {
        const path = await seeded(processedPhoto('CC0'));

        const changes = { ...stamp(), title: { ro: 'Calea Victoriei' }, bearing: 270, fov: 45 };

        expect(await verdict(world.db('admin').doc(path).update(changes))).toBe('allow');
    });

    it('happyPath_adminPublishesAProcessedLicensedPhoto', async () => {
        const path = await seeded(processedPhoto('CC-BY-4.0'));

        expect(
            await verdict(
                world
                    .db('admin')
                    .doc(path)
                    .update({ ...stamp(), published: true }),
            ),
        ).toBe('allow');
    });

    it('badPath_unprocessedPhotosCannotBePublished', async () => {
        const path = await seeded({ ...processedPhoto('CC0'), processing: 'pending' });

        expect(
            await verdict(
                world
                    .db('admin')
                    .doc(path)
                    .update({ ...stamp(), published: true }),
            ),
        ).toBe('deny');
    });

    it('badPath_photosOfUnknownLicenceCannotBePublished', async () => {
        const path = await seeded(processedPhoto('unknown'));

        expect(
            await verdict(
                world
                    .db('admin')
                    .doc(path)
                    .update({ ...stamp(), published: true }),
            ),
        ).toBe('deny');
    });

    it.each([
        ['image', { image: { web: 'https://evil.example/x.webp' } }],
        ['exif', { exif: { artist: 'Forged' } }],
        ['processing', { processing: 'failed' }],
        ['createdAt', { createdAt: past().toMillis() }],
        ['createdBy', { createdBy: 'someone-else' }],
    ])('badPath_adminCannotChangeServerOwned_%s', async (_label, changes) => {
        const path = await seeded(processedPhoto('CC0'));

        expect(
            await verdict(
                world
                    .db('admin')
                    .doc(path)
                    .update({ ...stamp(), ...changes }),
            ),
        ).toBe('deny');
    });

    it('badPath_editsAreValidatedLikeCreates', async () => {
        const path = await seeded(processedPhoto('CC0'));

        expect(
            await verdict(
                world
                    .db('admin')
                    .doc(path)
                    .update({ ...stamp(), bearing: 400 }),
            ),
        ).toBe('deny');
    });

    it('badPath_nonAdminsCannotEdit', async () => {
        const path = await seeded(processedPhoto('CC0'));

        const result = await verdicts(['stranger', 'claimOnly'], (persona) =>
            world
                .db(persona)
                .doc(path)
                .update({ updatedBy: world.uid(persona), updatedAt: serverTime(), bearing: 10 }),
        );

        expect(result).toEqual({ stranger: 'deny', claimOnly: 'deny' });
    });
});

describe('delete', () => {
    it('happyPath_onlyAdminsDelete', async () => {
        const path = await seeded(processedPhoto('CC0'));

        const result = await verdicts(['stranger', 'docOnly', 'admin'], (persona) => world.db(persona).doc(path).delete());

        expect(result).toEqual({ stranger: 'deny', docOnly: 'deny', admin: 'allow' });
    });
});
