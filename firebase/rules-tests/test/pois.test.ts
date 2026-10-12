/**
 * cities/{city}/pois/{poi} and cities/{city}/poiCategories/{category} (M1 CR-4, PLAN Addendum 3): admins create,
 * edit and delete them with exactly the fields of `CLIENT_WRITES.poi` / `.poiCategory`, validated like `poiDocSchema`
 * (geometries without nested arrays, `geometryDocSchema`) and `poiCategoryDocSchema`.
 */
import { FIRESTORE_PATHS, MAX_GEOMETRY_VERTICES, MAX_POI_PHOTOS, MAX_POLYGON_RINGS, PHOTOS_OVERLAY_ID } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closedRing, line, links, newPoi, newPoiCategory, poiCategoryDoc, poiDoc } from './support/documents.js';
import { createWorld, deleted, past, stampedBy, verdict, withChanges, type Data, type Verdict, type World } from './support/world.js';

const CITY_ID = 'rules-pois';

let world: World;
let sequence = 0;

function nextId(): string {
    sequence += 1;
    return `poi${String(sequence)}`;
}

function createPoi(changes: Data, id = nextId()): Promise<Verdict> {
    const poi = withChanges(newPoi(world.uid('admin')), changes);
    return verdict(
        world
            .db('admin')
            .doc(`${FIRESTORE_PATHS.pois(CITY_ID)}/${id}`)
            .set(poi),
    );
}

async function editPoi(changes: Data): Promise<Verdict> {
    const path = FIRESTORE_PATHS.poi(CITY_ID, nextId());
    await world.seed(path, poiDoc(world.uid('admin')));
    return verdict(
        world
            .db('admin')
            .doc(path)
            .update({ ...stampedBy(world.uid('admin')), ...changes }),
    );
}

function createCategory(changes: Data, id = nextId()): Promise<Verdict> {
    const category = withChanges(newPoiCategory(world.uid('admin')), changes);
    return verdict(
        world
            .db('admin')
            .doc(`${FIRESTORE_PATHS.poiCategories(CITY_ID)}/${id}`)
            .set(category),
    );
}

const polygon = (...rings: Data[][]): Data => ({ geometry: { type: 'Polygon', rings: rings.map((points) => ({ points })) } });

beforeAll(async () => {
    world = await createWorld('pois');
});

afterAll(async () => {
    await world.env.cleanup();
});

describe('POI geometry', () => {
    it.each([
        ['a point', { geometry: { type: 'Point', point: { lat: -90, lng: 180 } } }],
        ['a two-vertex line', { geometry: { type: 'LineString', points: line(2) } }],
        [`a ${String(MAX_GEOMETRY_VERTICES)}-vertex line`, { geometry: { type: 'LineString', points: line(MAX_GEOMETRY_VERTICES) } }],
        ['a polygon with a hole', polygon(closedRing(6), closedRing(4))],
        [`a polygon of ${String(MAX_POLYGON_RINGS)} rings`, polygon(...Array.from({ length: MAX_POLYGON_RINGS }, () => closedRing(4)))],
    ])('happyPath_adminDraws_%s', async (_label, changes) => {
        expect(await createPoi(changes)).toBe('allow');
    });

    it.each([
        ['no geometry', { geometry: deleted() }],
        ['a geometry that is a list', { geometry: [26.1, 44.43] }],
        ['an unknown type', { geometry: { type: 'MultiPoint', points: line(2) } }],
        ['GeoJSON coordinates', { geometry: { type: 'Point', coordinates: [26.1, 44.43] } }],
        ['a point with a bbox', { geometry: { type: 'Point', point: { lat: 44.43, lng: 26.1 }, bbox: [] } }],
        ['a point off the globe', { geometry: { type: 'Point', point: { lat: 44.43, lng: 181 } } }],
        ['a one-vertex line', { geometry: { type: 'LineString', points: line(1) } }],
        ['a line that is not a list', { geometry: { type: 'LineString', points: { lat: 44.43, lng: 26.1 } } }],
        [
            `a ${String(MAX_GEOMETRY_VERTICES + 1)}-vertex line`,
            { geometry: { type: 'LineString', points: line(MAX_GEOMETRY_VERTICES + 1) } },
        ],
        ['a line starting off the globe', { geometry: { type: 'LineString', points: [{ lat: 95, lng: 26.1 }, ...line(2)] } }],
        ['a line with points of a polygon', { geometry: { type: 'LineString', rings: [{ points: closedRing(4) }] } }],
        ['a polygon without rings', polygon()],
        ['rings that are not a list', { geometry: { type: 'Polygon', rings: { points: closedRing(4) } } }],
        [
            `a polygon of ${String(MAX_POLYGON_RINGS + 1)} rings`,
            polygon(...Array.from({ length: MAX_POLYGON_RINGS + 1 }, () => closedRing(4))),
        ],
        ['an open ring', polygon(line(5))],
        ['a three-vertex ring', polygon(closedRing(3))],
        ['an open last ring', polygon(closedRing(4), line(4))],
        ['a ring with an extra key', { geometry: { type: 'Polygon', rings: [{ points: closedRing(4), hole: true }] } }],
    ])('badPath_adminCannotDraw_%s', async (_label, changes) => {
        expect(await createPoi(changes)).toBe('deny');
    });
});

describe('POI fields', () => {
    it.each([
        [
            'only the required fields',
            { description: deleted(), yearStart: deleted(), yearEnd: deleted(), links: deleted(), photoIds: deleted() },
        ],
        ['a start year only', { yearEnd: deleted() }],
        ['an end year only (built before records began)', { yearStart: deleted() }],
        [`${String(MAX_POI_PHOTOS)} photos`, { photoIds: Array.from({ length: MAX_POI_PHOTOS }, (_, index) => `p${String(index)}`) }],
        ['five links', { links: links(5) }],
    ])('happyPath_adminCreatesAPoiWith_%s', async (_label, changes) => {
        expect(await createPoi(changes)).toBe('allow');
    });

    it.each([
        ['no category', { category: deleted() }],
        ['a category id with a slash', { category: 'a/b' }],
        ['a category that is not text', { category: 7 }],
        ['a title without Romanian', { title: { en: 'Enei Church' } }],
        ['a description over 5000 characters', { description: { ro: 'x'.repeat(5001) } }],
        ['a start year after the end year', { yearStart: 1990, yearEnd: 1977 }],
        ['a start year before 1800', { yearStart: 1611 }],
        ['an end year after 2100', { yearEnd: 2101 }],
        ['six links', { links: links(6) }],
        [
            `${String(MAX_POI_PHOTOS + 1)} photos`,
            { photoIds: Array.from({ length: MAX_POI_PHOTOS + 1 }, (_, index) => `p${String(index)}`) },
        ],
        ['photo ids that are not a list', { photoIds: 'p1' }],
        ['a published flag that is not a boolean', { published: 'true' }],
        ['another creator', { createdBy: 'someone-else' }],
        ['a client createdAt', { createdAt: past() }],
        ['another editor', { updatedBy: 'someone-else' }],
        ['an unknown field', { style: 'color:red' }],
    ])('badPath_adminCannotCreateAPoiWith_%s', async (_label, changes) => {
        expect(await createPoi(changes)).toBe('deny');
    });

    it('badPath_poiIdsFollowTheIdPattern', async () => {
        expect(await createPoi({}, 'poi 1')).toBe('deny');
    });

    it('happyPath_adminRedrawsAndRecategorisesAPoi', async () => {
        expect(await editPoi({ category: 'strazi', geometry: { type: 'LineString', points: line(3) } })).toBe('allow');
    });

    it.each([
        ['an open polygon', polygon(line(4))],
        ['a removed title', { title: deleted() }],
        ['a removed creator', { createdBy: deleted() }],
    ])('badPath_editsAreValidatedLikeCreates_%s', async (_label, changes) => {
        expect(await editPoi(changes)).toBe('deny');
    });
});

describe('POI categories', () => {
    it.each([
        ['every field', {}],
        ['an English label', { label: { ro: 'Străzi dispărute', en: 'Vanished streets' } }],
        ['a transparent default', { defaultOpacity: 0 }],
    ])('happyPath_adminCreatesACategoryWith_%s', async (_label, changes) => {
        expect(await createCategory(changes)).toBe('allow');
    });

    it.each([
        ['an icon with capitals', { icon: 'Church' }],
        ['an icon with a dash', { icon: 'add-road' }],
        ['an icon over 64 characters', { icon: 'x'.repeat(65) }],
        ['an icon that is not text', { icon: 1 }],
        ['a colour without #', { color: '875329' }],
        ['a short colour', { color: '#fff' }],
        ['a named colour', { color: 'red' }],
        ['an opacity over 1', { defaultOpacity: 1.5 }],
        ['a fractional order', { order: 0.5 }],
        ['a label over 100 characters', { label: { ro: 'x'.repeat(101) } }],
        ['a missing label', { label: deleted() }],
        ['a creator, which categories do not record', { createdBy: 'categories-admin' }],
        ['a client createdAt', { createdAt: past() }],
        ['another editor', { updatedBy: 'someone-else' }],
    ])('badPath_adminCannotCreateACategoryWith_%s', async (_label, changes) => {
        expect(await createCategory(changes)).toBe('deny');
    });

    it.each([PHOTOS_OVERLAY_ID, 'a.b', 'x'.repeat(41)])('badPath_categoryIdsAreOverlayIdsAndNeverPhotos_%s', async (id) => {
        expect(await createCategory({}, id)).toBe('deny');
    });

    it('happyPath_adminRecoloursACategoryAndBadPathKeepsItValid', async () => {
        const path = FIRESTORE_PATHS.poiCategory(CITY_ID, nextId());
        await world.seed(path, poiCategoryDoc());
        const db = world.db('admin');
        const stamp = stampedBy(world.uid('admin'));

        expect(await verdict(db.doc(path).update({ ...stamp, color: '#000000', icon: 'museum' }))).toBe('allow');
        expect(await verdict(db.doc(path).update({ ...stamp, color: 'black' }))).toBe('deny');
    });
});
