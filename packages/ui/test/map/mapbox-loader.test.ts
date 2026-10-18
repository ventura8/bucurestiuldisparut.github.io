import { FakeMapboxGl } from '@hcm/test-support/fake-map';
import { describe, expect, it } from 'vitest';

import { loadMapboxGl, MAPBOX_GL_CSS_URL, MAPBOX_GL_SCRIPT_URL, type MapboxLoaderScope } from '../../src/map/mapbox-loader.js';
import type { MapboxGl } from '../../src/map/mapbox-types.js';

class FakeScript {
    src = '';
    crossOrigin: string | null = null;
    readonly #listeners = new Map<string, () => void>();

    addEventListener(type: string, listener: () => void): void {
        this.#listeners.set(type, listener);
    }

    dispatch(type: string): void {
        this.#listeners.get(type)?.();
    }
}

/** A page whose `mapbox-gl.js` defines `mapboxgl` on load (or never does). */
class FakePage implements MapboxLoaderScope {
    mapboxgl?: MapboxGl;
    readonly scripts: FakeScript[] = [];
    readonly document = {
        createElement: (): FakeScript => new FakeScript(),
        head: {
            append: (script: FakeScript): void => {
                this.scripts.push(script);
            },
        },
    } as unknown as Pick<Document, 'createElement' | 'head'>;

    /** The script loads; `defines` says whether it set the global. */
    load(index: number, defines: boolean): void {
        if (defines) {
            this.mapboxgl = new FakeMapboxGl();
        }
        this.scripts[index]?.dispatch('load');
    }
}

describe('loading Mapbox GL JS', () => {
    it('happyPath_theFirstMapAddsThePinnedScriptOnce', async () => {
        const page = new FakePage();

        const first = loadMapboxGl(page);
        const second = loadMapboxGl(page);
        page.load(0, true);

        await expect(first).resolves.toBe(page.mapboxgl);
        await expect(second).resolves.toBe(page.mapboxgl);
        await expect(loadMapboxGl(page)).resolves.toBe(page.mapboxgl);
        expect(page.scripts).toHaveLength(1);
        expect(page.scripts[0]).toMatchObject({ src: MAPBOX_GL_SCRIPT_URL, crossOrigin: 'anonymous' });
        expect(MAPBOX_GL_SCRIPT_URL).toBe('https://api.mapbox.com/mapbox-gl-js/v3.32.0/mapbox-gl.js');
        expect(MAPBOX_GL_CSS_URL).toBe('https://api.mapbox.com/mapbox-gl-js/v3.32.0/mapbox-gl.css');
    });

    it('badPath_aFailedOrEmptyLoadRejectsAndTheNextMapTriesAgain', async () => {
        const page = new FakePage();

        const failed = loadMapboxGl(page);
        page.scripts[0]?.dispatch('error');
        await expect(failed).rejects.toThrow('mapbox-gl.js failed to load');
        const empty = loadMapboxGl(page);
        page.load(1, false);
        await expect(empty).rejects.toThrow('mapbox-gl.js did not define mapboxgl');
        const retried = loadMapboxGl(page);
        page.load(2, true);

        await expect(retried).resolves.toBe(page.mapboxgl);
        expect(page.scripts).toHaveLength(3);
    });
});
