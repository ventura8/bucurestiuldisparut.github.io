/**
 * What the public viewer's map can do beyond `MapPort`: read and write the basemap's own boolean configuration, for the
 * visitor's map labels (docs/ENGINE_API.md → Map labels). Apart from the adapter because only the viewer uses it, so the
 * admin's bundle does not carry it.
 */
import type { AdapterEnv } from './env.js';
import type { MapPort } from './map-port.js';
import { createMapboxPort, nativeMap } from './mapbox-adapter.js';
import type { MapboxGl, MapboxMap } from './mapbox-types.js';

const IMPORT_ID = 'basemap';

export interface ViewerMapPort extends MapPort {
    /**
     * A boolean Standard configuration property of the `basemap` import (`showRoadLabels`, ...); null when the style has no
     * such property (a custom style, the base without the import) or there is no map. Ask once `mount` has resolved.
     */
    getBasemapFlag(name: string): boolean | null;
    /** Sets one live, with no new map load. Write only what `getBasemapFlag` found. */
    setBasemapFlag(name: string, value: boolean): void;
}

/** Mapbox answers null, or throws, for a style without the import or the property; any other type is no switch either. */
function readFlag(map: MapboxMap | null, name: string): boolean | null {
    try {
        const value = map?.getConfigProperty(IMPORT_ID, name);
        return typeof value === 'boolean' ? value : null;
    } catch {
        return null;
    }
}

/** `createMapboxPort` for the viewer and swipe compare's second map. */
export function createViewerMapPort(gl: MapboxGl, env?: AdapterEnv): ViewerMapPort {
    const port = createMapboxPort(gl, env);
    return Object.assign(port, {
        getBasemapFlag: (name: string) => readFlag(nativeMap(port), name),
        setBasemapFlag: (name: string, value: boolean) => {
            nativeMap(port)?.setConfigProperty(IMPORT_ID, name, value);
        },
    });
}
