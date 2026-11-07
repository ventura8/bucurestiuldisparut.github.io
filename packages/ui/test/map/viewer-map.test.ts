import { FakeMapboxGl } from '@hcm/test-support/fake-map';
import { describe, expect, it } from 'vitest';

import type { MapOptions } from '../../src/map/map-port.js';
import { createViewerMapPort } from '../../src/map/viewer-map.js';
import { fakeAdapterEnv } from './support.js';

const OPTIONS: MapOptions = {
    style: 'mapbox://styles/mapbox/standard',
    config: { showRoadLabels: true },
    accessToken: 'pk.test',
    view: { center: [26.08, 44.42], zoom: 14, bearing: 0 },
    minZoom: 10,
    maxZoom: 20,
    locale: 'en',
    reducedMotion: false,
};

describe('the viewer map port', () => {
    it('happyPath_readsAndWritesTheBasemapsFlagsLiveWithNoNewMap', async () => {
        const gl = new FakeMapboxGl();
        const port = createViewerMapPort(gl, fakeAdapterEnv());
        const mounting = port.mount({} as HTMLElement, OPTIONS);
        gl.map.fire('load');
        await mounting;

        expect(port.getBasemapFlag('showRoadLabels')).toBe(true);
        port.setBasemapFlag('showRoadLabels', false);

        expect(gl.map.callsOf('setConfigProperty')).toContainEqual(['basemap', 'showRoadLabels', false]);
        expect(port.getBasemapFlag('showRoadLabels')).toBe(false);
        expect(port.mapLoadCount).toBe(1);
    });

    it('badPath_withoutAMapItReadsNullAndWritesNothing', () => {
        const port = createViewerMapPort(new FakeMapboxGl(), fakeAdapterEnv());

        port.setBasemapFlag('showRoadLabels', false);

        expect(port.getBasemapFlag('showRoadLabels')).toBeNull();
        expect(port.mapLoadCount).toBe(0);
    });

    it('badPath_noPropertyAnotherTypeOrAStyleWithoutTheImportReadsNull', async () => {
        const gl = new FakeMapboxGl();
        const port = createViewerMapPort(gl, fakeAdapterEnv());
        const mounting = port.mount({} as HTMLElement, { ...OPTIONS, config: { lightPreset: 'day' } });
        gl.map.fire('load');
        await mounting;

        expect(port.getBasemapFlag('showRoadLabels')).toBeNull();
        expect(port.getBasemapFlag('lightPreset')).toBeNull();
        gl.map.configError = new Error('no import');
        expect(port.getBasemapFlag('lightPreset')).toBeNull();
    });
});
