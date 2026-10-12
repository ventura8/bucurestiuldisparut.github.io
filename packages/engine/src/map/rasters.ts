/**
 * Historical raster layers on the Mapbox map: one raster source and one raster layer per manifest layer, in the
 * Standard style's `middle` slot (above roads, below 3D buildings and labels), ordered by the manifest `order`.
 * Opacity and image adjustments come only from `overlayOpacityPaint` and `rasterAdjustmentPaint` (@hcm/shared).
 */
import { rasterAdjustmentPaint, type LayerSource } from '@hcm/shared';

import type { MapSlot, RasterLayerSpec } from './map-port.js';
import { layerOpacityPaint, visibilityValue, type MapLayerEntry, type OverlayEntry } from './overlay-registry.js';

export function overlaySourceId(id: string): string {
    return `hcm-source-${id}`;
}

export function rasterLayerId(id: string): string {
    return `hcm-raster-${id}`;
}

/** The manifest layer id of an adapter source id (`hcm-source-<id>`), or undefined for any other source. */
export function layerIdOfSource(sourceId: string | undefined): string | undefined {
    return sourceId?.startsWith('hcm-source-') === true ? sourceId.slice('hcm-source-'.length) : undefined;
}

/** The tile part of a raster source for each manifest source type. */
function tiles(source: LayerSource): Readonly<Record<string, unknown>> {
    switch (source.type) {
        case 'mapbox':
            return { url: `mapbox://${source.tilesetId}`, tileSize: 256 };
        case 'xyz':
            return { tiles: [...source.tiles], tileSize: source.tileSize, scheme: 'xyz' };
        case 'pmtiles':
            // Mapbox GL JS 3.x reads a PMTiles archive given as the source URL (platform research, M1 viewer).
            return { url: source.url, tileSize: 256 };
    }
}

const ATTRIBUTION_ENTITIES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

/**
 * A layer's attribution as Mapbox GL needs it to show plain text: its attribution control parses a source's
 * `attribution` as HTML (keeping `<a href>` links) and writes it with `innerHTML`. The manifest's attribution is plain
 * text (no HTML from data, security review §1.7), so `&`, `<` and `>` are escaped: markup in the data stays visible
 * text and can never become a link or an element.
 */
export function attributionText(attribution: string): string {
    return attribution.replace(/[&<>]/g, (character) => String(ATTRIBUTION_ENTITIES[character]));
}

/** The raster source: tiles exist from `minzoom` to `maxzoom` inside `bounds`; Mapbox overzooms beyond `maxzoom`. */
export function rasterSource(spec: RasterLayerSpec): Readonly<Record<string, unknown>> {
    const bounds = spec.bounds === undefined ? {} : { bounds: [...spec.bounds[0], ...spec.bounds[1]] };
    return {
        type: 'raster',
        ...tiles(spec.source),
        minzoom: spec.minzoom,
        maxzoom: spec.maxzoom,
        attribution: attributionText(spec.attribution),
        ...bounds,
    };
}

function rasterMapLayer(spec: RasterLayerSpec): MapLayerEntry {
    return { id: rasterLayerId(spec.id), type: 'raster', base: {} };
}

/** The Mapbox layer: visibility, opacity, adjustments; no fade (a scrubbed timeline must not flicker), lit like the day. */
export function rasterLayer(spec: RasterLayerSpec, slot: MapSlot): Readonly<Record<string, unknown>> {
    return {
        id: rasterLayerId(spec.id),
        type: 'raster',
        source: overlaySourceId(spec.id),
        slot,
        layout: { visibility: visibilityValue(spec.visible) },
        paint: {
            ...layerOpacityPaint('raster', rasterMapLayer(spec), spec.opacity),
            ...rasterAdjustmentPaint(spec.adjustments),
            'raster-fade-duration': 0,
            'raster-emissive-strength': 1,
        },
    };
}

export function rasterEntry(spec: RasterLayerSpec): OverlayEntry {
    return {
        kind: 'raster',
        layers: [rasterMapLayer(spec)],
        sources: [overlaySourceId(spec.id)],
        visible: spec.visible,
        opacity: spec.opacity,
    };
}

/**
 * The Mapbox layer to insert before so that a higher `order` draws on top: the raster with the lowest order above
 * `order` (ties: the one added first stays below). Undefined puts the layer on top of its slot.
 */
export function rasterBeforeId(orders: ReadonlyMap<string, number>, order: number): string | undefined {
    const above = [...orders].filter(([, other]) => other > order).sort((a, b) => a[1] - b[1]);
    const first = above[0];
    return first === undefined ? undefined : rasterLayerId(first[0]);
}
