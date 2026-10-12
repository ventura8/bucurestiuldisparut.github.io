import { BASEMAP_BACKGROUND } from '../fixtures/world.js';

/**
 * The basemap every `mapbox://styles/<owner>/<id>` resolves to in e2e: a local minimal style shaped like Mapbox
 * Standard where the engine depends on it. It is a fragment with a configuration schema, so Mapbox GL imports it as
 * `basemap` exactly as it does Standard (`setConfigProperty('basemap', 'show3dObjects', false)` applies), and it
 * defines Standard's three slots (`bottom`, `middle`, `top`) for the historical rasters and the vector overlays. A
 * solid background makes every pixel the engine does not draw a known colour.
 */

function rgb([red, green, blue]: readonly number[]): string {
    return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
}

/** The Standard configuration options the engine may set (docs/ENGINE_API.md → basemap.config). */
const SCHEMA = {
    show3dObjects: { default: true, type: 'boolean' },
    showPlaceLabels: { default: true, type: 'boolean' },
    showPointOfInterestLabels: { default: true, type: 'boolean' },
    showRoadLabels: { default: true, type: 'boolean' },
    showTransitLabels: { default: true, type: 'boolean' },
    lightPreset: { default: 'day', type: 'string', values: ['dawn', 'day', 'dusk', 'night'] },
    theme: { default: 'default', type: 'string', values: ['default', 'faded', 'monochrome'] },
} as const;

export function basemapStyle(owner: string, styleId: string): Record<string, unknown> {
    return {
        version: 8,
        name: `HCM e2e basemap (${owner}/${styleId})`,
        fragment: true,
        schema: SCHEMA,
        sources: {},
        sprite: `mapbox://sprites/${owner}/${styleId}`,
        glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
        layers: [
            { id: 'background', type: 'background', paint: { 'background-color': rgb(BASEMAP_BACKGROUND) } },
            { id: 'bottom', type: 'slot' },
            { id: 'middle', type: 'slot' },
            { id: 'top', type: 'slot' },
        ],
    };
}
