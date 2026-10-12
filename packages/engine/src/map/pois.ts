/**
 * A POI category on the Mapbox map (PLAN Addendum 3): one GeoJSON source and six layers in the category colour,
 * bottom first: polygon fills, line and outline strokes, point discs, point icons (labelled from zoom 16), and the
 * labels of lines and areas from zoom 16. The POIs are the ones the timeline shows; titles are already localized.
 */
import type { MapLayerType, OpacityBase } from '@hcm/shared';

import type { MapSlot, VectorOverlaySpec } from './map-port.js';
import { poiIconId } from './icons.js';
import { layerOpacityPaint, visibilityValue, type MapLayerEntry, type OverlayEntry } from './overlay-registry.js';
import { overlaySourceId } from './rasters.js';

/** Labels appear from this zoom (docs/ENGINE_API.md → pois). */
export const POI_LABEL_MIN_ZOOM = 16;

const POI_LAYER_PREFIX = 'hcm-poi-';

type Style = Readonly<Record<string, unknown>>;

interface PoiStyle {
    readonly filter: unknown;
    readonly layout: Style;
    readonly paint: Style;
}

interface PoiLayerKind {
    readonly suffix: string;
    readonly type: MapLayerType;
    readonly base: OpacityBase;
    readonly style: (spec: VectorOverlaySpec) => PoiStyle;
}

function geometryIs(...types: readonly string[]): unknown {
    return ['in', ['geometry-type'], ['literal', types]];
}

/** The title from zoom 16, nothing below. */
const LABEL = ['step', ['zoom'], '', POI_LABEL_MIN_ZOOM, ['get', 'title']];

const LABEL_LAYOUT: Style = { 'text-field': LABEL, 'text-size': 13, 'text-max-width': 12, 'text-optional': true };
const LABEL_PAINT: Style = { 'text-color': '#ffffff', 'text-halo-color': '#1d1b1a', 'text-halo-width': 1.5 };

const POI_LAYER_KINDS: readonly PoiLayerKind[] = [
    {
        suffix: 'fill',
        type: 'fill',
        base: { 'fill-opacity': 0.3 },
        style: (spec) => ({ filter: geometryIs('Polygon'), layout: {}, paint: { 'fill-color': spec.color } }),
    },
    {
        suffix: 'line',
        type: 'line',
        base: {},
        style: (spec) => ({
            filter: geometryIs('LineString', 'Polygon'),
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': spec.color, 'line-width': 3 },
        }),
    },
    {
        suffix: 'circle',
        type: 'circle',
        base: {},
        style: (spec) => ({
            filter: geometryIs('Point'),
            layout: {},
            paint: { 'circle-color': spec.color, 'circle-radius': 13, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
        }),
    },
    {
        suffix: 'symbol',
        type: 'symbol',
        base: {},
        style: (spec) => ({
            filter: geometryIs('Point'),
            layout: {
                ...LABEL_LAYOUT,
                'icon-image': poiIconId(spec.icon),
                'icon-allow-overlap': true,
                'text-offset': [0, 1.6],
                'text-anchor': 'top',
            },
            paint: LABEL_PAINT,
        }),
    },
    {
        suffix: 'label-line',
        type: 'symbol',
        base: {},
        style: () => ({
            filter: geometryIs('LineString'),
            layout: { ...LABEL_LAYOUT, 'symbol-placement': 'line-center' },
            paint: LABEL_PAINT,
        }),
    },
    {
        suffix: 'label-area',
        type: 'symbol',
        base: {},
        style: () => ({ filter: geometryIs('Polygon'), layout: LABEL_LAYOUT, paint: LABEL_PAINT }),
    },
];

function layerId(id: string, kind: PoiLayerKind): string {
    return `${POI_LAYER_PREFIX}${id}-${kind.suffix}`;
}

function mapLayer(id: string, kind: PoiLayerKind): MapLayerEntry {
    return { id: layerId(id, kind), type: kind.type, base: kind.base };
}

/** True for a layer id of any POI category (click and keyboard selection). */
export function isPoiLayer(id: string): boolean {
    return id.startsWith(POI_LAYER_PREFIX);
}

/** The source of a category: its POIs as GeoJSON. */
export function poiSource(spec: VectorOverlaySpec): Style {
    return { type: 'geojson', data: poiData(spec) };
}

export function poiData(spec: VectorOverlaySpec): unknown {
    return { type: 'FeatureCollection', features: spec.features };
}

/** The six Mapbox layers of a category, bottom first, at its visibility and opacity. */
export function poiLayers(spec: VectorOverlaySpec, slot: MapSlot): readonly Style[] {
    return POI_LAYER_KINDS.map((kind) => {
        const style = kind.style(spec);
        return {
            id: layerId(spec.id, kind),
            type: kind.type,
            source: overlaySourceId(spec.id),
            slot,
            filter: style.filter,
            layout: { ...style.layout, visibility: visibilityValue(spec.visible) },
            paint: { ...style.paint, ...layerOpacityPaint('poi', mapLayer(spec.id, kind), spec.opacity) },
        };
    });
}

export function poiEntry(spec: VectorOverlaySpec): OverlayEntry {
    return {
        kind: 'poi',
        layers: POI_LAYER_KINDS.map((kind) => mapLayer(spec.id, kind)),
        sources: [overlaySourceId(spec.id)],
        visible: spec.visible,
        opacity: spec.opacity,
    };
}
