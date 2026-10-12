/**
 * Creating a Mapbox map and waiting for its style: the constructor options (`performanceMetricsCollection: false`,
 * the attribution control on, the Standard configuration on the `basemap` import) and the reading of Mapbox `error`
 * events (a style error before `load` fails the mount; source and tile errors never do).
 */
import type { MapOptions, MapEventMap } from './map-port.js';
import type { MapboxEvent, MapboxMap, MapboxMapOptions } from './mapbox-types.js';
import { layerIdOfSource } from './rasters.js';

function rawMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return typeof error === 'string' ? error : 'unknown';
}

/** A Mapbox error message without URL queries (a tile URL carries the access token). */
function errorMessage(error: unknown): string {
    return rawMessage(error).replace(/\?\S*/g, '');
}

function errorKind(event: MapboxEvent, layerId: string | undefined, loaded: boolean): MapEventMap['error']['kind'] {
    if (event.tile !== undefined) {
        return 'tile';
    }
    if (layerId !== undefined) {
        return 'source';
    }
    return loaded ? 'unknown' : 'style';
}

/** A Mapbox `error` event as the port reports it. */
export function classifyError(event: MapboxEvent, loaded: boolean): MapEventMap['error'] {
    const layerId = layerIdOfSource(event.sourceId);
    const kind = errorKind(event, layerId, loaded);
    const message = errorMessage(event.error);
    return layerId === undefined ? { kind, message } : { kind, layerId, message };
}

export function mapboxOptions(container: HTMLElement, options: MapOptions): MapboxMapOptions {
    const config = options.config === undefined ? {} : { config: { basemap: options.config } };
    const maxBounds = options.maxBounds === undefined ? {} : { maxBounds: options.maxBounds };
    return {
        container,
        style: options.style,
        accessToken: options.accessToken,
        center: options.view.center,
        zoom: options.view.zoom,
        bearing: options.view.bearing,
        minZoom: options.minZoom,
        maxZoom: options.maxZoom,
        language: options.locale,
        attributionControl: true,
        performanceMetricsCollection: false,
        ...maxBounds,
        ...config,
    };
}

/**
 * Resolves on `load`; rejects with `Error('style')` on a style error before it. `setAbort` receives the function that
 * rejects it early (the port was destroyed or mounted again first).
 */
export function whenLoaded(map: MapboxMap, setAbort: (abort: (error: Error) => void) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const onLoad = (): void => {
            map.off('error', onError);
            resolve();
        };
        const onError = (event: MapboxEvent): void => {
            if (classifyError(event, false).kind === 'style') {
                map.off('load', onLoad);
                reject(new Error('style', { cause: event.error }));
            }
        };
        setAbort(reject);
        map.on('load', onLoad);
        map.on('error', onError);
    });
}
