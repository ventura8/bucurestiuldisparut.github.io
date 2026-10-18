/**
 * Mapbox GL JS for a page that does not load it up front (the admin, docs/research/M2c-interfaces.md §3.4): the first map
 * of the session adds `mapbox-gl.js` of the pinned release from api.mapbox.com (never bundled; the admin's CSP allows
 * `https://api.mapbox.com/mapbox-gl-js/`) and resolves the global `mapboxgl` it defines. A failed load is tried again by
 * the next map. Its stylesheet is linked inside each map element's shadow root (`MAPBOX_GL_CSS_URL`), as the viewer does.
 */
import type { MapboxGl } from './mapbox-types.js';

/** The release the map code is written against (the engine's `MAPBOX_GL_VERSION`, the site's page). */
export const MAPBOX_GL_VERSION = '3.32.0';

const MAPBOX_GL_BASE = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}`;

export const MAPBOX_GL_SCRIPT_URL = `${MAPBOX_GL_BASE}/mapbox-gl.js`;
export const MAPBOX_GL_CSS_URL = `${MAPBOX_GL_BASE}/mapbox-gl.css`;

/** The parts of `window` the loader uses. */
export interface MapboxLoaderScope {
    readonly document: Pick<Document, 'createElement' | 'head'>;
    readonly mapboxgl?: MapboxGl;
}

const loads = new WeakMap<MapboxLoaderScope, Promise<MapboxGl>>();

function loadScript(scope: MapboxLoaderScope): Promise<MapboxGl> {
    return new Promise((resolve, reject) => {
        const script = scope.document.createElement('script');
        script.src = MAPBOX_GL_SCRIPT_URL;
        script.crossOrigin = 'anonymous';
        script.addEventListener('load', () => {
            const gl = scope.mapboxgl;
            if (gl === undefined) {
                reject(new Error('mapbox-gl.js did not define mapboxgl'));
            } else {
                resolve(gl);
            }
        });
        script.addEventListener('error', () => {
            reject(new Error('mapbox-gl.js failed to load'));
        });
        scope.document.head.append(script);
    });
}

/** The page's `mapboxgl`, loading Mapbox GL JS the first time (one script element however many maps ask). */
export function loadMapboxGl(scope: MapboxLoaderScope): Promise<MapboxGl> {
    const ready = scope.mapboxgl;
    if (ready !== undefined) {
        return Promise.resolve(ready);
    }
    let loading = loads.get(scope);
    if (loading === undefined) {
        loading = loadScript(scope);
        loads.set(scope, loading);
        loading.catch(() => {
            loads.delete(scope);
        });
    }
    return loading;
}
