// The georeferencer shows the version's own map (M15 review, 2026-11-08): the figures and residuals the version page shows, the
// preview of the map that is published (a camera's lattice included), and, once the pairs change, that the result is a refit.
import { FIRESTORE_PATHS, fitTransform, geoToMercator, mercatorToGeo, scanBounds, type Gcp, type GeorefTransform } from '@hcm/shared';
import type { FakeMapboxMap } from '@hcm/test-support/fake-map';
import { FakeMapDraw } from '@hcm/test-support/fake-map-draw';
import { describe, expect, it } from 'vitest';

import { WARP_DELAY_MS } from '../../src/georef/georef-pictures.js';
import { GEOREF_MODULE } from '../../src/georef/georef.js';
import type { FakeClock } from '../app/fakes.js';
import { settle } from '../app/fakes.js';
import { factoryOf, host, mapboxHandle } from '../imagery/maps.js';
import { CITY, cityDoc, golden, imageryWorld, VERSIONS } from '../imagery/world.js';

const RENDERED = 'job-1966-0712';
const PREVIEW = 'rasters/bucharest/kh-4a-corona-1966/job-1966-0712/scan-preview.jpg';
const SCAN = { width: 20_480, height: 16_384 };
/** How far east the camera's map lies from the pairs' poly2, EPSG:3857 metres. */
const CAMERA_EAST_M = 300;
const SIDE = 17;

function goldenGeoref(): { readonly gcps: Gcp[]; readonly transform: GeorefTransform } {
    return golden('version.awaiting-approval.json')['georef'] as { gcps: Gcp[]; transform: GeorefTransform };
}

/** The pairs' own poly2, as the page refits it. */
function refitOf(gcps: readonly Gcp[]) {
    const result = fitTransform('poly2', gcps);
    if (!result.ok) {
        throw new Error(result.reason);
    }
    return result.transform;
}

/** 17 x 17 nodes of a map `CAMERA_EAST_M` east of the pairs' poly2: what a camera fitted on every tile stores. */
function lattice(gcps: readonly Gcp[]) {
    const refit = refitOf(gcps);
    const nodes = Array.from({ length: SIDE * SIDE }, (_node, index) => {
        const pixel = { x: ((index % SIDE) * SCAN.width) / (SIDE - 1), y: (Math.floor(index / SIDE) * SCAN.height) / (SIDE - 1) };
        const at = geoToMercator(refit.toGeo(pixel));
        return { pixel, geo: mercatorToGeo({ x: at.x + CAMERA_EAST_M, y: at.y }) };
    });
    return { model: 'panoramic', nodes };
}

async function setup(withLattice: boolean) {
    const { handle, native } = await mapboxHandle(new FakeMapDraw());
    const world = imageryWorld({ maps: factoryOf([{ ok: true, map: handle }]) });
    const doc = golden('version.awaiting-approval.json');
    const georef = goldenGeoref();
    world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc({ imagery: { rmseThresholdM: 5 } }));
    world.store.docs.set(VERSIONS(RENDERED), withLattice ? { ...doc, georef: { ...georef, lattice: lattice(georef.gcps) } } : doc);
    world.files.put(PREVIEW);
    const store = GEOREF_MODULE.create(world.services);
    return { ...world, map: native, georef: store, clock: world.services.clock as FakeClock };
}

/** The west edge of the warped preview on the map (longitude). */
function previewWest(map: FakeMapboxMap): number {
    const source = map.sources.get('hcm-picture-warped') as { coordinates?: [number, number][] } | undefined;
    return Math.min(...(source?.coordinates ?? []).map((corner) => corner[0]));
}

/** The west edge of the box the pairs' own refit puts the scan in, moved `east` metres. */
function refitWest(east: number): number {
    const west = scanBounds(refitOf(goldenGeoref().gcps), SCAN)[0][0];
    return mercatorToGeo({ x: geoToMercator({ lat: 44.45, lng: west }).x + east, y: 0 }).lng;
}

async function opened(withLattice: boolean) {
    const world = await setup(withLattice);
    world.georef.open([RENDERED]);
    world.georef.intents.attachMap(host());
    await settle();
    world.clock.advance(WARP_DELAY_MS);
    return world;
}

describe('the georeferencer shows the version as published', () => {
    it('happyPath_theVersionsOwnFiguresAndResidualsUntilAPairChanges', async () => {
        const { georef, clock } = await opened(false);
        const shown = georef.state.fit;

        georef.intents.toggle('g7');
        clock.advance(WARP_DELAY_MS);
        const edited = georef.state.fit;
        georef.intents.discard();

        expect(shown).toMatchObject({ fitRmseM: 6.1, checkpointRmseM: 8.9, checkpointCount: 2, overThreshold: true, refitted: false });
        expect(shown.residuals).toEqual({ g1: 5.1, g2: 6.8, g3: 7.2, g4: 4.4, g5: 3.9, g6: 8, g7: 9.6, g8: 8.1 });
        expect(edited.fitRmseM).not.toBeCloseTo(6.1, 2);
        expect([edited.checkpointCount, edited.refitted]).toEqual([1, true]);
        expect(georef.state.fit).toEqual(shown);
    });

    it('happyPath_aCameraMappedVersionPreviewsItsLatticeNotThePairsPolynomial', async () => {
        const { georef, map, clock } = await opened(true);
        const shown = previewWest(map);

        georef.intents.toggle('g7');
        clock.advance(WARP_DELAY_MS);
        const edited = previewWest(map);

        expect(shown).toBeCloseTo(refitWest(CAMERA_EAST_M), 4);
        expect(edited).not.toBeCloseTo(refitWest(CAMERA_EAST_M), 3);
        expect(georef.state.fit.refitted).toBe(true);
    });

    it('badPath_aVersionWithoutFiguresOfItsOwnShowsTheRefitAndNoRefitNotice', async () => {
        const world = await setup(false);
        const gcps = goldenGeoref().gcps.map(({ id, pixel, geo, enabled, origin }) => ({ id, pixel, geo, enabled, origin }));
        const georef = { method: 'corners', transform: 'poly2', gcps };
        world.store.docs.set(VERSIONS(RENDERED), { ...golden('version.awaiting-approval.json'), georef });
        world.georef.open([RENDERED]);
        await settle();
        const shown = world.georef.state.fit;
        world.georef.intents.toggle('g7');

        expect(shown.fitRmseM).not.toBeCloseTo(6.1, 2);
        expect([shown.checkpointCount, shown.refitted]).toEqual([2, false]);
        expect(world.georef.state.fit.refitted).toBe(false);
    });
});
