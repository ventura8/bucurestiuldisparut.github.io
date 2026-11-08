/**
 * What the public viewer's map can do beyond `MapPort`: read and write the basemap's own boolean configuration, for the
 * visitor's map labels (docs/ENGINE_API.md → Map labels). Apart from the adapter because only the viewer uses it, so the
 * admin's bundle does not carry it.
 */
import type { AdapterEnv } from './env.js';
import type { MapPort } from './map-port.js';
import { createMapboxPort, nativeMap } from './mapbox-adapter.js';
import type { MapboxGl, MapboxMap } from './mapbox-types.js';
import { drawMyLocation, type MyLocationFix } from './my-location.js';

const IMPORT_ID = 'basemap';

export interface ViewerMapPort extends MapPort {
    /**
     * A boolean Standard configuration property of the `basemap` import (`showRoadLabels`, ...); null when the style has no
     * such property (a custom style, the base without the import) or there is no map. Ask once `mount` has resolved.
     */
    getBasemapFlag(name: string): boolean | null;
    /** Sets one live, with no new map load. Write only what `getBasemapFlag` found. */
    setBasemapFlag(name: string, value: boolean): void;
    /** A text Standard configuration property (`lightPreset`, ...); null when the style has no such property. */
    getBasemapOption(name: string): string | null;
    /** Sets one live, with no new map load. Write only what `getBasemapOption` found. */
    setBasemapOption(name: string, value: string): void;
    /** The visitor's position as a blue dot (`my-location.ts`), null removes it; nothing before `mount` has resolved. */
    setMyLocation(fix: MyLocationFix | null): void;
}

/** Mapbox answers null, or throws, for a style without the import or the property. */
function readConfig(map: MapboxMap | null, name: string): unknown {
    try {
        return map?.getConfigProperty(IMPORT_ID, name);
    } catch {
        return null;
    }
}

function readFlag(map: MapboxMap | null, name: string): boolean | null {
    const value = readConfig(map, name);
    return typeof value === 'boolean' ? value : null;
}

function readOption(map: MapboxMap | null, name: string): string | null {
    const value = readConfig(map, name);
    return typeof value === 'string' ? value : null;
}

/** `createMapboxPort` for the viewer and swipe compare's second map. */
export function createViewerMapPort(gl: MapboxGl, env?: AdapterEnv): ViewerMapPort {
    const port = createMapboxPort(gl, env);
    const write = (name: string, value: boolean | string): void => {
        nativeMap(port)?.setConfigProperty(IMPORT_ID, name, value);
    };
    return Object.assign(port, {
        getBasemapFlag: (name: string) => readFlag(nativeMap(port), name),
        setBasemapFlag: write,
        getBasemapOption: (name: string) => readOption(nativeMap(port), name),
        setBasemapOption: write,
        setMyLocation: (fix: MyLocationFix | null) => {
            const map = nativeMap(port);
            if (map !== null) {
                drawMyLocation(map, fix);
            }
        },
    });
}
