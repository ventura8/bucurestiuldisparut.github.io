import { MAX_GEOMETRY_VERTICES, MAX_POLYGON_RINGS, type BBox } from '@hcm/shared';
import { FakeMap, FakeMapboxGl, type FakeMapboxMap } from '@hcm/test-support/fake-map';
import { describe, expect, it } from 'vitest';

import type { DrawChange, DrawnFeature, DrawOptions, DrawRefusal, MapDrawPort } from '../../../src/map/draw/draw-port.js';
import { createTerraDrawPort, geometryOf, positionsOf } from '../../../src/map/draw/terra-draw-adapter.js';
import { SELECT_FLAGS } from '../../../src/map/draw/terra-draw-modes.js';
import type { MapOptions, MapPort } from '../../../src/map/map-port.js';
import { createMapboxPort } from '../../../src/map/mapbox-adapter.js';
import { fakeAdapterEnv, settle } from '../support.js';
import { fakeTerraDrawModules, type FakeMode, type FakeTerraDraw, type FakeTerraDrawModules } from './fake-terra-draw.js';

/** A mutable `[lng, lat]`, the type of the manifest geometry's positions. */
type Position = [number, number];

const CITY: BBox = [
    [25.9, 44.3],
    [26.3, 44.55],
];

const OPTIONS: DrawOptions = { limits: CITY, color: '#8b5e3c', maxVertices: MAX_GEOMETRY_VERTICES, maxRings: MAX_POLYGON_RINGS };

const MAP_OPTIONS: MapOptions = {
    style: 'mapbox://styles/mapbox/standard',
    accessToken: 'pk.test',
    view: { center: [26.1, 44.43], zoom: 14, bearing: 0 },
    minZoom: 10,
    maxZoom: 20,
    locale: 'ro',
    reducedMotion: false,
};

const SQUARE: Position[] = [
    [26.0, 44.4],
    [26.1, 44.4],
    [26.1, 44.5],
    [26.0, 44.5],
    [26.0, 44.4],
];

const PLACE: DrawnFeature = { id: 'casa-capsa', geometry: { type: 'Polygon', coordinates: [SQUARE] } };

interface World {
    readonly port: MapDrawPort;
    readonly modules: FakeTerraDrawModules;
    readonly td: FakeTerraDraw;
    readonly map: MapPort;
    readonly mapbox: FakeMapboxMap;
    readonly changes: DrawChange[];
    readonly selections: (string | null)[];
    readonly refusals: DrawRefusal[];
}

async function mountedMap(): Promise<{ readonly map: MapPort; readonly mapbox: FakeMapboxMap }> {
    const gl = new FakeMapboxGl();
    const map = createMapboxPort(gl, fakeAdapterEnv());
    const mounting = map.mount({} as HTMLElement, MAP_OPTIONS);
    gl.map.fire('load');
    await mounting;
    await settle();
    return { map, mapbox: gl.map };
}

async function attached(options: DrawOptions = OPTIONS): Promise<World> {
    const { map, mapbox } = await mountedMap();
    const modules = fakeTerraDrawModules();
    const port = createTerraDrawPort(modules);
    const changes: DrawChange[] = [];
    const selections: (string | null)[] = [];
    const refusals: DrawRefusal[] = [];
    port.on('change', (change) => changes.push(change));
    port.on('select', (id) => selections.push(id));
    port.on('refused', (refusal) => refusals.push(refusal));
    port.attach(map, options);
    const td = modules.instances.at(-1);
    if (td === undefined) {
        throw new Error('no Terra Draw');
    }
    return { port, modules, td, map, mapbox, changes, selections, refusals };
}

function polygon(ring: Position[]): { readonly type: string; readonly coordinates: unknown } {
    return { type: 'Polygon', coordinates: [ring] };
}

describe('Terra Draw adapter: attaching', () => {
    it('happyPath_attachStartsTerraDrawOnTheMapboxMapWithOurModes', async () => {
        const { td, modules, mapbox, port } = await attached();

        expect(td.started).toBe(true);
        expect(td.mode).toBe('static');
        expect(port.mode).toBe('static');
        expect(modules.adapters).toEqual([{ map: mapbox, coordinatePrecision: 7 }]);
        const modes = td.options.modes as FakeMode[];
        expect(modes.map((mode) => mode.kind)).toEqual(['static', 'point', 'linestring', 'polygon', 'rectangle', 'select']);
        expect(modes[0]?.options?.modeName).toBe('static');
        expect(modes[5]?.options?.flags).toBe(SELECT_FLAGS);
        expect(modes[3]?.options?.styles?.['fillColor']).toBe('#8b5e3c');
        expect(td.options.idStrategy.isValidId('casa-capsa')).toBe(true);
        expect(td.options.idStrategy.isValidId('')).toBe(false);
        expect(td.options.idStrategy.getId()).not.toBe(td.options.idStrategy.getId());
    });

    it('badPath_attachWithoutAMapboxMapThrows', () => {
        const port = createTerraDrawPort(fakeTerraDrawModules());

        expect(() => {
            port.attach(new FakeMap(), OPTIONS);
        }).toThrow('draw needs a mounted Mapbox map');
    });

    it('happyPath_featuresLoadedBeforeAttachAreDrawnOnAttach', async () => {
        const { map } = await mountedMap();
        const modules = fakeTerraDrawModules();
        const port = createTerraDrawPort(modules);

        port.load([PLACE]);
        port.attach(map, OPTIONS);

        expect(modules.instances[0]?.store.get('casa-capsa')?.properties).toEqual({ mode: 'polygon' });
        expect(port.snapshot()).toEqual([PLACE]);
    });

    it('happyPath_detachStopsTerraDrawAndForgetsTheMap', async () => {
        const { port, td, mapbox } = await attached();
        port.setMode('select');

        port.detach();

        expect(td.stopped).toBe(true);
        expect(port.mode).toBe('static');
        expect(mapbox.canvas.listenerCount('keydown')).toBe(1);
        await expect(port.pick()).resolves.toBeNull();
    });
});

describe('Terra Draw adapter: drawing', () => {
    it('happyPath_aFinishedShapeBecomesThePlaceAndIsSelected', async () => {
        const { port, td, changes, selections } = await attached();
        port.setMode('draw-polygon', 'casa-capsa');
        expect(td.mode).toBe('polygon');

        const tdId = td.finishDrawing(polygon(SQUARE.map(([lng, lat]) => [lng + 1e-9, lat])));

        expect(td.store.has(tdId)).toBe(false);
        expect(td.store.get('casa-capsa')?.properties).toEqual({ mode: 'polygon' });
        expect(port.mode).toBe('select');
        expect(td.mode).toBe('select');
        expect(td.selected).toBe('casa-capsa');
        expect(selections).toEqual(['casa-capsa']);
        expect(changes).toEqual([{ features: [{ ...PLACE, shape: 'polygon' }], final: true }]);
    });

    it('happyPath_aShapeDrawnWithoutAnIdGetsOneOfItsOwn', async () => {
        const { port, td } = await attached();
        port.setMode('draw-point');

        td.finishDrawing({ type: 'Point', coordinates: [26.1, 44.43] });

        expect(port.snapshot()).toEqual([{ id: 'hcm-draw-2', geometry: { type: 'Point', coordinates: [26.1, 44.43] }, shape: 'point' }]);
    });

    it('badPath_aShapeOutsideTheCityCrossedOrFlatIsRefusedAndDrawingGoesOn', async () => {
        const { port, td, changes, refusals } = await attached();
        port.setMode('draw-polygon', 'casa-capsa');

        td.finishDrawing(polygon(SQUARE.map(([lng, lat]) => [lng + 1, lat])));
        td.finishDrawing(
            polygon([
                [26.0, 44.4],
                [26.1, 44.5],
                [26.1, 44.4],
                [26.0, 44.45],
                [26.0, 44.4],
            ]),
        );
        td.finishDrawing(
            polygon([
                [26.0, 44.4],
                [26.1, 44.4],
                [26.0, 44.4],
            ]),
        );

        expect(refusals.map((refusal) => refusal.kind)).toEqual(['outside', 'self-intersection', 'zero-area']);
        expect(td.store.size).toBe(0);
        expect(port.mode).toBe('draw-polygon');
        expect(changes).toEqual([]);
    });

    it('badPath_aFinishOfAShapeThatIsGoneChangesNothing', async () => {
        const { port, td, changes } = await attached();
        port.setMode('draw-point', 'p');

        td.play('finish', 'missing', { mode: 'point', action: 'draw' });

        expect(changes).toEqual([]);
        expect(port.mode).toBe('draw-point');
    });

    it('happyPath_validationRefusesPositionsWhileDrawingAndTheWholeShapeAtTheEnd', async () => {
        const { td, refusals } = await attached();

        const inside = td.validate('polygon', polygon(SQUARE));
        const outside = td.validate('polygon', polygon(SQUARE.map(([lng, lat]) => [lng, lat + 1])), 'provisional');
        const again = td.validate(
            'linestring',
            {
                type: 'LineString',
                coordinates: [
                    [27, 44.4],
                    [26, 44.4],
                ],
            },
            'commit',
        );
        const crossed = td.validate(
            'polygon',
            polygon([
                [26.0, 44.4],
                [26.1, 44.5],
                [26.1, 44.4],
                [26.0, 44.45],
                [26.0, 44.4],
            ]),
            'finish',
        );
        const broken = td.validate('polygon', { type: 'Polygon', coordinates: [[[26.0, 44.4]]] }, 'finish');

        expect(inside).toEqual({ valid: true });
        expect(outside).toEqual({ valid: false, reason: 'outside' });
        expect(again).toEqual({ valid: false, reason: 'outside' });
        expect(crossed).toEqual({ valid: false, reason: 'self-intersection' });
        expect(broken).toEqual({ valid: false, reason: 'zero-area' });
        expect(refusals.map((refusal) => refusal.kind)).toEqual(['outside', 'self-intersection', 'zero-area']);
    });
});

describe('Terra Draw adapter: editing', () => {
    it('happyPath_aDragPreviewsEveryFrameAndSettlesAtTheEnd', async () => {
        const { port, td, changes } = await attached();
        port.load([PLACE]);
        port.setMode('select');
        const moved: Position[] = [
            [26.01, 44.4],
            [26.11, 44.4],
            [26.11, 44.5],
            [26.01, 44.5],
            [26.01, 44.4],
        ];
        const dragged = { ...PLACE, geometry: { type: 'Polygon', coordinates: [moved] } };

        td.drag('casa-capsa', polygon(moved), false);
        td.drag('casa-capsa', polygon(moved), true);

        expect(changes).toEqual([
            { features: [dragged], final: false },
            { features: [dragged], final: false },
            { features: [dragged], final: true },
        ]);
        expect(port.snapshot()).toEqual([dragged]);
    });

    it('badPath_aDragOutsideTheCitySnapsBackOnRelease', async () => {
        const { port, td, changes, refusals } = await attached();
        port.load([PLACE]);
        port.setMode('select');

        td.drag('casa-capsa', polygon(SQUARE.map(([lng, lat]): Position => [lng + 1, lat])), true);

        expect(refusals).toEqual([{ kind: 'outside', bounds: CITY }]);
        expect(td.store.get('casa-capsa')?.geometry).toEqual(PLACE.geometry);
        expect(changes.at(-1)).toEqual({ features: [PLACE], final: true });
    });

    it('badPath_changesOfOtherFeaturesOrWhileDrawingAreNotReported', async () => {
        const { port, td, changes } = await attached();
        port.load([PLACE]);

        td.play('change', ['casa-capsa'], 'update');
        port.setMode('select');
        td.store.set('hcm-draw-9', {
            id: 'hcm-draw-9',
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [26.1, 44.4] },
            properties: {},
        });
        td.play('change', ['hcm-draw-9'], 'update');
        td.play('change', ['casa-capsa'], 'styling');
        td.store.set('casa-capsa', { id: 'casa-capsa', type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} });
        td.play('change', ['casa-capsa'], 'update');

        expect(changes).toEqual([{ features: [], final: false }]);
    });

    it('happyPath_loadReplacesTheShapesAndLeavesOutWhatBreaksALimit', async () => {
        const { port, td, refusals, selections } = await attached();
        port.load([PLACE]);
        port.select('casa-capsa');
        const line: DrawnFeature = {
            id: 'strada',
            geometry: {
                type: 'LineString',
                coordinates: [
                    [26.0, 44.4],
                    [26.0000000001, 44.5],
                ],
            },
        };

        port.load([line, { id: 'afar', geometry: { type: 'Point', coordinates: [30, 44] } }]);

        expect(refusals).toEqual([{ kind: 'outside', bounds: CITY }]);
        expect(port.snapshot()).toEqual([
            {
                ...line,
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [26.0, 44.4],
                        [26.0, 44.5],
                    ],
                },
            },
        ]);
        expect([...td.store.keys()]).toEqual(['strada']);
        expect(selections).toEqual(['casa-capsa', null]);
    });

    it('happyPath_selectSwitchesToSelectAndDeselects', async () => {
        const { port, td, selections } = await attached();
        port.load([PLACE]);

        port.select('casa-capsa');
        port.select(null);
        port.select(null);
        td.play('select', 'hcm-draw-1');

        expect(td.mode).toBe('select');
        expect(td.selected).toBeNull();
        expect(selections).toEqual(['casa-capsa', null]);
    });

    it('happyPath_deleteSelectedRemovesTheFeature', async () => {
        const { port, td, changes } = await attached();
        port.load([PLACE]);
        port.deleteSelected();
        port.select('casa-capsa');

        port.deleteSelected();

        expect(td.store.size).toBe(0);
        expect(port.snapshot()).toEqual([]);
        expect(changes).toEqual([{ features: [], final: true }]);
    });

    it('badPath_callsBeforeAttachOnlyKeepTheState', () => {
        const port = createTerraDrawPort(fakeTerraDrawModules());

        port.deleteSelected();
        port.select('casa-capsa');
        port.setMode('select');
        port.setColor('#000000');
        port.load([PLACE]);

        expect(port.mode).toBe('select');
        expect(port.snapshot()).toEqual([PLACE]);
    });
});

describe('Terra Draw adapter: picks and colour', () => {
    it('happyPath_aPickResolvesWithTheNextMapClickRounded', async () => {
        const { port, mapbox } = await attached();

        const picked = port.pick();
        mapbox.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 26.123456789, lat: 44.4 } });

        await expect(picked).resolves.toEqual([26.1234568, 44.4]);
    });

    it('badPath_escapeAModeChangeOrANewPickCancelThePick', async () => {
        const { port, mapbox } = await attached();

        const escaped = port.pick();
        mapbox.canvas.pressKey('a');
        mapbox.canvas.pressKey('Escape');
        const replaced = port.pick();
        const changed = port.pick();
        port.setMode('select');
        mapbox.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 26.1, lat: 44.4 } });

        await expect(escaped).resolves.toBeNull();
        await expect(replaced).resolves.toBeNull();
        await expect(changed).resolves.toBeNull();
    });

    it('happyPath_aNewColourRedrawsTheShapesInTheSameMode', async () => {
        const { port, modules } = await attached();
        port.load([PLACE]);
        port.setMode('draw-linestring', 'strada');

        port.setColor('#8b5e3c');
        port.setColor('#1f6f43');

        expect(modules.instances).toHaveLength(2);
        const redrawn = modules.instances[1];
        expect(modules.instances[0]?.stopped).toBe(true);
        expect((redrawn?.options.modes[3] as FakeMode).options?.styles?.['outlineColor']).toBe('#1f6f43');
        expect(redrawn?.mode).toBe('linestring');
        expect(redrawn?.store.has('casa-capsa')).toBe(true);
        redrawn?.finishDrawing({
            type: 'LineString',
            coordinates: [
                [26.0, 44.4],
                [26.1, 44.5],
            ],
        });
        expect(port.snapshot().map((feature) => feature.id)).toEqual(['casa-capsa', 'strada']);
    });

    it('happyPath_aNewColourInSelectModeKeepsSelectMode', async () => {
        const { port, modules } = await attached();
        port.setMode('select');

        port.setColor('#1f6f43');

        expect(modules.instances[1]?.mode).toBe('select');
        expect(port.mode).toBe('select');
    });

    it('badPath_aThrowingSubscriberDoesNotStopTheOthers', async () => {
        const { port, td, refusals } = await attached();
        port.on('refused', () => {
            throw new Error('broken subscriber');
        });

        td.validate('point', { type: 'Point', coordinates: [27, 44] });

        expect(refusals).toEqual([{ kind: 'outside', bounds: CITY }]);
    });

    it('happyPath_unsubscribingStopsTheEvents', async () => {
        const { port, td } = await attached();
        const seen: string[] = [];
        const stop = port.on('refused', (refusal) => seen.push(refusal.kind));

        td.validate('point', { type: 'Point', coordinates: [27, 44] });
        stop();
        port.setMode('draw-point');
        td.validate('point', { type: 'Point', coordinates: [27, 44] });

        expect(seen).toEqual(['outside']);
    });
});

describe('Terra Draw adapter: reading geometry', () => {
    it('happyPath_positionsAreFoundAtAnyDepth', () => {
        expect(
            positionsOf([
                [
                    [26, 44],
                    [26.1, 44.1],
                ],
                [[26.2, 44.2]],
            ]),
        ).toEqual([
            [26, 44],
            [26.1, 44.1],
            [26.2, 44.2],
        ]);
        expect(geometryOf({ type: 'Feature', geometry: { type: 'Point', coordinates: [26.1, 44.4] }, properties: {} })).toEqual({
            type: 'Point',
            coordinates: [26.1, 44.4],
        });
    });

    it('badPath_whatIsNotAPositionIsSkippedAndABrokenShapeHasNoGeometry', () => {
        expect(positionsOf('26,44')).toEqual([]);
        expect(positionsOf([['26', 44]])).toEqual([]);
        expect(geometryOf({ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: [] }, properties: {} })).toBeNull();
    });
});
