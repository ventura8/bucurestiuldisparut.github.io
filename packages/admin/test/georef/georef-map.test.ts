import { createLogger } from '@hcm/shared';
import { FakeMap } from '@hcm/test-support/fake-map';
import { FakeMapDraw } from '@hcm/test-support/fake-map-draw';
import { describe, expect, it } from 'vitest';

import { GeorefMap, PAIR_COLOR } from '../../src/georef/georef-map.js';
import type { GeoPosition } from '../../src/georef/pairs.js';
import type { MapStatus } from '../../src/layers/map-session.js';
import type { AdminMapFactory, AdminMapHandle, AdminMapResult } from '../../src/map/factory.js';
import { createMapPreview } from '../../src/map/preview.js';
import { settle } from '../app/fakes.js';
import { factoryOf, host } from '../imagery/maps.js';
import { fakeFrames } from '../map/support.js';
import { pair } from './fixtures.js';

const FRAME = {
    bounds: [
        [25.9, 44.3],
        [26.3, 44.6],
    ] as const,
    view: { center: [26.1, 44.45] as const, zoom: 13, bearing: 0 },
};

function handle(draw: FakeMapDraw): { readonly handle: AdminMapHandle; readonly map: FakeMap; readonly destroyed: { count: number } } {
    const map = new FakeMap();
    map.view = { center: [26.1, 44.45], zoom: 13, bearing: 0 };
    const destroyed = { count: 0 };
    return {
        map,
        destroyed,
        handle: {
            port: map,
            preview: createMapPreview(map, fakeFrames()),
            draw: () => Promise.resolve(draw),
            destroy: () => {
                destroyed.count += 1;
            },
        },
    };
}

function session(maps: AdminMapFactory | null) {
    const statuses: MapStatus[] = [];
    const clicks: GeoPosition[] = [];
    const moves: string[] = [];
    const selections: (string | null)[] = [];
    const map = new GeorefMap({
        ...{ maps, locale: () => 'ro', log: createLogger('georef-map-test') },
        status: (status) => statuses.push(status),
        clicked: (geo) => clicks.push(geo),
        moved: (id, geo) => moves.push(`${id} ${String(geo.lat)} ${String(geo.lng)}`),
        selected: (id) => selections.push(id),
    });
    return { map, statuses, clicks, moves, selections };
}

describe('the georeferencer map', () => {
    it('happyPath_thePairsArePointsOfTheDrawingToolsMovedInSelectAndStillWhileAdding', async () => {
        const draw = new FakeMapDraw();
        const made = handle(draw);
        const { map, statuses, clicks, moves, selections } = session(factoryOf([{ ok: true, map: made.handle }]));
        map.showPairs([pair('g1', 0, 0)], 'g1');
        map.setAdding(false);

        const container = host();
        map.attach(container);
        map.attach(container);
        map.setFrame(FRAME);
        map.setFrame(FRAME);
        await settle();
        made.map.clickMap([26.15, 44.42]);
        draw.emitChange([{ id: 'g1', geometry: { type: 'Point', coordinates: [26.2, 44.4] } }], false);
        draw.emitChange([{ id: 'g1', geometry: { type: 'Point', coordinates: [26.2, 44.4] } }]);
        draw.emitSelect('g1');
        map.setAdding(false);
        map.setAdding(true);
        map.zoomBy(1);

        expect(statuses).toEqual(['none', 'loading', 'ready']);
        expect(draw.attached?.options).toMatchObject({ color: PAIR_COLOR, maxVertices: 500, maxRings: 20 });
        expect(draw.features).toEqual([{ id: 'g1', geometry: { type: 'Point', coordinates: [26.2, 44.4] } }]);
        expect(draw.callsOf('select')).toContainEqual(['g1']);
        expect(clicks).toEqual([{ lat: 44.42, lng: 26.15 }]);
        expect(moves).toEqual(['g1 44.4 26.2']);
        expect(selections).toContain('g1');
        expect(draw.mode).toBe('static');
        expect(map.centre).toEqual({ lat: 44.45, lng: 26.1 });
        expect(made.map.view.zoom).toBe(14);
        map.detach();
        expect([made.destroyed.count, statuses.at(-1), map.centre]).toEqual([1, 'none', null]);
    });

    it('badPath_noFactoryIsAFailedMapAndANoMapResultSaysWhy', async () => {
        const none = session(null);
        none.map.attach(host());
        none.map.setFrame(FRAME);
        const refused = session(factoryOf([{ ok: false, reason: 'no-token' }]));
        refused.map.attach(host());
        refused.map.setFrame(FRAME);
        await settle();
        refused.map.zoomBy(1);

        expect(none.statuses).toEqual(['none', 'failed']);
        expect(refused.statuses).toEqual(['none', 'loading', 'no-token']);
    });

    it('badPath_aMapThatArrivesAfterThePageLeftIsDestroyedAndItsToolsUnused', async () => {
        const draw = new FakeMapDraw();
        const made = handle(draw);
        const answers: ((result: AdminMapResult) => void)[] = [];
        const slow: AdminMapFactory = {
            create: () =>
                new Promise((resolve) => {
                    answers.push(resolve);
                }),
        };
        const { map } = session(slow);
        map.attach(host());
        map.setFrame(FRAME);

        map.detach();
        answers[0]?.({ ok: true, map: made.handle });
        await settle();

        expect(made.destroyed.count).toBe(1);
        expect(draw.attached).toBeNull();
    });

    it('badPath_aRefusedMapThatArrivesAfterThePageLeftIsDropped', async () => {
        const answers: ((result: AdminMapResult) => void)[] = [];
        const slow: AdminMapFactory = {
            create: () =>
                new Promise((resolve) => {
                    answers.push(resolve);
                }),
        };
        const { map, statuses } = session(slow);
        map.attach(host());
        map.setFrame(FRAME);

        map.detach();
        answers[0]?.({ ok: false, reason: 'failed' });
        await settle();

        expect(statuses).toEqual(['none', 'loading', 'none']);
    });

    it('happyPath_toolsThatLoadWhilePairsAreBeingAddedStandStill', async () => {
        const draw = new FakeMapDraw();
        const made = handle(draw);
        const { map } = session(factoryOf([{ ok: true, map: made.handle }]));
        map.setAdding(true);

        map.attach(host());
        map.setFrame(FRAME);
        await settle();

        expect(draw.mode).toBe('static');
    });

    it('badPath_toolsThatLoadAfterThePageLeftAreNotAttached', async () => {
        const draw = new FakeMapDraw();
        const made = handle(draw);
        const tools: ((draw: FakeMapDraw) => void)[] = [];
        const lateHandle = {
            ...made.handle,
            draw: () =>
                new Promise<FakeMapDraw>((resolve) => {
                    tools.push(resolve);
                }),
        };
        const { map } = session(factoryOf([{ ok: true, map: lateHandle }]));
        map.attach(host());
        map.setFrame(FRAME);
        await settle();

        map.detach();
        tools[0]?.(draw);
        await settle();

        expect(draw.attached).toBeNull();
    });
});
