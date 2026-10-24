import { FIRESTORE_PATHS } from '@hcm/shared';
import { FakeMap } from '@hcm/test-support/fake-map';
import { FakeMapDraw } from '@hcm/test-support/fake-map-draw';
import { describe, expect, it } from 'vitest';

import { GEOREF_MODULE } from '../../src/georef/georef.js';
import { createMapPreview } from '../../src/map/preview.js';
import { failure, settle } from '../app/fakes.js';
import { factoryOf, host } from '../imagery/maps.js';
import { answer, CITY, callsOf, cityDoc, golden, imageryWorld, VERSIONS } from '../imagery/world.js';
import { fakeFrames } from '../map/support.js';
import { pair } from './fixtures.js';

const UPLOAD = 'up-plan1911';
const RENDERED = 'job-1966-0712';

function mapWorld() {
    const draw = new FakeMapDraw();
    const map = new FakeMap();
    map.view = { center: [26.1, 44.45], zoom: 13, bearing: 0 };
    const handle = { port: map, preview: createMapPreview(map, fakeFrames()), draw: () => Promise.resolve(draw), destroy: () => undefined };
    return { draw, map, maps: factoryOf([{ ok: true, map: handle }]) };
}

function setup(overrides: Parameters<typeof imageryWorld>[0] = {}) {
    const world = imageryWorld(overrides);
    world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc({ imagery: { rmseThresholdM: 5 } }));
    world.store.docs.set(VERSIONS(UPLOAD), golden('version.needs-gcps.json'));
    world.store.docs.set(VERSIONS(RENDERED), golden('version.awaiting-approval.json'));
    const store = GEOREF_MODULE.create(world.services);
    return { ...world, georef: store };
}

describe('the georeferencer', () => {
    it('happyPath_aRenderedVersionOpensWithItsPairsItsFitAndItsReference', async () => {
        const { georef, files } = setup();
        files.put('rasters/bucharest/kh-4a-corona-1966/job-1966-0712/scan-preview.jpg');

        georef.open([RENDERED]);
        await settle();

        const state = georef.state;
        expect(state.version).toMatchObject({ id: RENDERED, state: 'awaiting_approval', editable: true });
        expect([state.transform, state.pairs.length, state.dirty, state.reference, state.thresholdM]).toEqual([
            'poly2',
            8,
            false,
            'osm',
            5,
        ]);
        expect(state.fit.refusal).toBeNull();
        expect(state.scan).toEqual({ status: 'ready', url: 'blob:rasters/bucharest/kh-4a-corona-1966/job-1966-0712/scan-preview.jpg' });
        expect([GEOREF_MODULE.area, georef.hasUnsavedChanges()]).toEqual(['georef', false]);
    });

    it('happyPath_aPairIsAClickOnTheScanThenOneOnTheMapOrTheOtherWayRound', async () => {
        const { draw, map, maps } = mapWorld();
        const { georef } = setup({ maps });
        georef.open([UPLOAD]);
        georef.intents.attachMap(host());
        await settle();

        georef.intents.pickScan({ x: 100, y: 100 });
        const ignored = georef.state.half;
        georef.intents.setAdding(true);
        georef.intents.pickScan({ x: 100.123, y: 200.456 });
        const half = georef.state.half;
        map.clickMap([26.1, 44.4]);
        map.clickMap([26.2, 44.5]);
        georef.intents.pickScan({ x: 900, y: 50 });
        georef.intents.cancelHalf();
        map.clickMap([26.3, 44.3]);
        georef.intents.pickScan({ x: 9000, y: 9000 });

        expect([ignored, half]).toEqual([null, { pixel: { x: 100.12, y: 200.46 } }]);
        expect(georef.state.pairs.map((pair) => [pair.id, pair.pixel, pair.geo])).toEqual([
            ['g1', { x: 100.12, y: 200.46 }, { lat: 44.4, lng: 26.1 }],
            ['g2', { x: 900, y: 50 }, { lat: 44.5, lng: 26.2 }],
            ['g3', { x: 8192, y: 6144 }, { lat: 44.3, lng: 26.3 }],
        ]);
        expect([georef.state.selected, georef.state.dirty, georef.hasUnsavedChanges()]).toEqual(['g3', true, true]);
        expect(draw.mode).toBe('static');
        expect(draw.features.map((feature) => feature.id)).toEqual(['g1', 'g2', 'g3']);
    });

    it('happyPath_aVersionWithoutAScanTakesPairsUnclampedAndAMapClickOutsideAddingIsNothing', async () => {
        const { draw, map, maps } = mapWorld();
        const { georef, store } = setup({ maps, files: null, pictures: null });
        const doc = golden('version.needs-gcps.json');
        store.docs.set(VERSIONS('bare'), { ...doc, state: 'processing', scan: undefined });
        georef.open([]);
        georef.open(['bare']);
        georef.intents.attachMap(host());
        await settle();

        map.clickMap([26.1, 44.4]);
        const ignored = georef.state.half;
        georef.intents.setAdding(true);
        georef.intents.pickScan({ x: 99_999, y: 5 });
        map.clickMap([26.1, 44.4]);

        expect(ignored).toBeNull();
        expect(georef.state.version).toMatchObject({ scan: null, editable: false });
        expect(georef.state.pairs.map((pair) => pair.pixel)).toEqual([{ x: 99_999, y: 5 }]);
        expect(draw.features).toHaveLength(1);
    });

    it('happyPath_theKeyboardAddsAtBothCentresAndMovesAndRemovesPairs', async () => {
        const { draw, maps } = mapWorld();
        const { georef } = setup({ maps });
        georef.open([UPLOAD]);
        georef.intents.addAtCentres({ x: 1, y: 1 });
        georef.intents.attachMap(host());
        await settle();

        georef.intents.addAtCentres({ x: 10, y: 20 });
        georef.intents.addAtCentres({ x: 30, y: 40 });
        georef.intents.movePixel('g1', { x: 11, y: 21 });
        georef.intents.moveGeo('g2', { lat: 44.5, lng: 26.2 });
        draw.emitChange([{ id: 'g1', geometry: { type: 'Point', coordinates: [26, 44.3] } }]);
        draw.emitSelect('g2');
        georef.intents.toggle('g1');
        georef.intents.select('g1');
        georef.intents.remove('g2');
        georef.intents.zoomBy(1);

        expect(georef.state.pairs).toEqual([
            { id: 'g1', pixel: { x: 11, y: 21 }, geo: { lat: 44.3, lng: 26 }, enabled: false, origin: 'manual' },
        ]);
        expect(georef.state.selected).toBe('g1');
        expect(georef.state.fit.refusal).toBe('too-few');
    });
});

describe('the georeferencer: the keyboard and the panes', () => {
    it('happyPath_aKeyboardPairIsLeftUnselectedAndEscLetsTheSelectedPairGo', async () => {
        const { maps } = mapWorld();
        const { georef } = setup({ maps });
        georef.open([UPLOAD]);
        georef.intents.attachMap(host());
        await settle();

        // The arrow keys must go on panning to the next place: the pair just placed is not the one they would move.
        georef.intents.addAtCentres({ x: 10, y: 20 });
        const afterAdd = georef.state.selected;
        georef.intents.select('g1');
        georef.intents.setAdding(true);
        georef.intents.pickScan({ x: 50, y: 60 });
        georef.intents.cancelHalf();
        const halfDropped = [georef.state.half, georef.state.selected];
        georef.intents.cancelHalf();

        expect(afterAdd).toBeNull();
        expect(halfDropped).toEqual([null, 'g1']);
        expect(georef.state.selected).toBeNull();
    });

    it('happyPath_halfAPairShowsThePaneOfItsOtherEnd', async () => {
        const { map, maps } = mapWorld();
        const { georef } = setup({ maps });
        georef.open([UPLOAD]);
        georef.intents.attachMap(host());
        await settle();
        georef.intents.setAdding(true);

        georef.intents.pickScan({ x: 100, y: 100 });
        const afterScan = georef.state.pane;
        map.clickMap([26.1, 44.4]);
        const completed = georef.state.pane;
        map.clickMap([26.2, 44.5]);

        expect([afterScan, completed, georef.state.pane]).toEqual(['map', 'map', 'scan']);
        expect(georef.state.pairs).toHaveLength(1);
    });
});

describe('the georeferencer: the fit and saving', () => {
    it('happyPath_theTransformChangesTheFitAndDiscardReturnsToTheSavedOnes', () => {
        const { georef } = setup();
        georef.open([RENDERED]);

        georef.intents.setTransform('affine');
        const changed = [georef.state.transform, georef.state.dirty];
        georef.intents.setTransform('tps');
        const tps = georef.state.fit.refusal;
        georef.intents.discard();

        expect(changed).toEqual(['affine', true]);
        expect(tps).toBe('too-few');
        expect([georef.state.transform, georef.state.dirty]).toEqual(['poly2', false]);
    });

    it('happyPath_aScanWaitingForPointsSavesThemAndItsJobGoesOn', async () => {
        const { georef, callables, notices, store } = setup();
        const corners = [pair('g1', 0, 0), pair('g2', 8000, 0), pair('g3', 8000, 6000)].map((corner) => ({ ...corner, origin: 'corner' }));
        store.docs.set(VERSIONS(UPLOAD), {
            ...golden('version.needs-gcps.json'),
            georef: { method: 'corners', transform: 'affine', gcps: corners },
        });
        answer(callables, 'imagery.saveGcps', (request) => ({ jobId: request.versionId, versionId: request.versionId, resumed: true }));
        georef.open([UPLOAD]);
        georef.intents.addAtCentres({ x: 0, y: 6000 });
        georef.intents.movePixel('g1', { x: 1, y: 1 });

        const saved = await georef.intents.save();

        expect(saved).toBe(true);
        expect(callsOf(callables, 'imagery.saveGcps')).toEqual([
            expect.objectContaining({ cityId: 'bucharest', versionId: UPLOAD, transform: 'affine' }),
        ]);
        expect(georef.state.saved).toBe(UPLOAD);
        expect(notices).toEqual([{ key: 'adminContent.georef.savedResumed' }]);
    });

    it('happyPath_saveSendsThePairsTheTransformAndTheCrop', async () => {
        const { georef, callables, notices, store } = setup();
        const doc = golden('version.awaiting-approval.json');
        store.docs.set(VERSIONS(RENDERED), {
            ...doc,
            crop: [
                { lat: 44.4, lng: 26 },
                { lat: 44.5, lng: 26.1 },
                { lat: 44.4, lng: 26.2 },
            ],
        });
        answer(callables, 'imagery.saveGcps', () => ({ jobId: 'new-job', versionId: 'new-job', resumed: false }));
        georef.open([RENDERED]);
        georef.intents.toggle('g7');

        const saved = await georef.intents.save();

        const request = callsOf(callables, 'imagery.saveGcps')[0] as {
            gcps: { enabled: boolean; residualM?: number }[];
            crop: unknown[];
            transform: string;
        };
        expect(saved).toBe(true);
        expect([request.transform, request.crop.length, request.gcps.filter((gcp) => gcp.enabled).length]).toEqual(['poly2', 3, 7]);
        expect(request.gcps.some((gcp) => gcp.residualM !== undefined)).toBe(false);
        expect([georef.state.saved, georef.state.dirty]).toEqual(['new-job', false]);
        expect(notices).toEqual([{ key: 'adminContent.georef.savedNew' }]);
    });

    it('badPath_aRefusedSaveSaysWhyAndAResumedOneSaysItGoesOn', async () => {
        const { georef, callables, notices } = setup();
        callables.fail('imagery.saveGcps', failure('invalid-argument', 'apiError.imagery.gcpOutside'));
        georef.open([RENDERED]);
        georef.intents.toggle('g7');

        const refused = await georef.intents.save();
        answer(callables, 'imagery.saveGcps', () => ({ jobId: RENDERED, versionId: RENDERED, resumed: true }));
        const resumed = await georef.intents.save();

        expect([refused, resumed]).toEqual([false, true]);
        expect(notices).toEqual([{ key: 'adminContent.georef.savedResumed' }]);
    });

    it('badPath_aVersionThatTakesNoPointsSavesNothingAndARevokedAdminEditsNothing', async () => {
        const world = setup({ readOnly: () => true });
        world.store.docs.set(VERSIONS('gone'), { ...golden('version.awaiting-approval.json'), state: 'rejected' });
        world.georef.open(['gone']);
        world.georef.intents.toggle('g1');

        expect(world.georef.state.version?.editable).toBe(false);
        expect(world.georef.state.pairs.every((pair) => pair.enabled || pair.id === 'g7' || pair.id === 'g8')).toBe(true);
        expect(await world.georef.intents.save()).toBe(false);
    });
});

describe('the georeferencer: the version read', () => {
    it('badPath_anUnknownOrMalformedVersionIsNotFoundAndAFailedReadComesBack', () => {
        const { georef, store } = setup();
        georef.open(['missing']);
        const missing = georef.state.notFound;
        georef.open(['not an id']);
        const malformed = georef.state.notFound;
        georef.open([RENDERED]);
        store.fail(VERSIONS(RENDERED), { kind: 'failed', code: 'internal' });
        const failed = georef.state.doc.status;

        georef.intents.retry();

        expect([missing, malformed, failed, georef.state.doc.status]).toEqual([true, true, 'error', 'ready']);
    });

    it('badPath_aDeniedReadMakesTheShellAskAndAVersionWithoutAReferenceShowsNone', () => {
        const { georef, store, denials } = setup();
        const doc = golden('version.needs-gcps.json');
        delete doc['reference'];
        store.docs.set(VERSIONS('bare'), doc);
        const heard: (string | null)[] = [];
        const stop = georef.subscribe((state) => heard.push(state.versionId));
        georef.open(['bare']);
        georef.intents.setReference('osm');
        georef.open(['nothing']);
        georef.intents.setReference('s2');
        georef.open([RENDERED]);

        store.fail(VERSIONS(RENDERED), { kind: 'denied', code: 'permission-denied' });
        stop();

        expect(heard).toContain('bare');
        expect(denials.count).toBe(1);
    });

    it('happyPath_theReferenceThePreviewAndThePane', async () => {
        const { georef, files, pictures } = setup();
        files.put('rasters/bucharest/kh-4a-corona-1966/job-1966-0712/scan-preview.jpg');
        georef.open([RENDERED]);
        await settle();

        georef.intents.setReference('s2');
        georef.intents.setPreviewOpacity(140);
        georef.intents.togglePreview(false);
        georef.intents.setPane('map');

        expect([georef.state.reference, georef.state.previewOpacity, georef.state.showPreview, georef.state.pane]).toEqual([
            's2',
            1,
            false,
            'map',
        ]);
        expect(pictures.decoded.length).toBeGreaterThan(0);
        georef.open([RENDERED]);
        georef.destroy();
        expect(georef.state.version).toBeNull();
    });
});
