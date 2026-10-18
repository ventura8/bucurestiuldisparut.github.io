/**
 * The manifest as the map draws it: raster layer specs, photo points and cones, POI overlays per category and the map
 * options. Pure; titles are resolved to the current language (English falls back to Romanian) and relative asset
 * URLs to the manifest's address.
 */
import {
    conePolygon,
    DEFAULT_FOV,
    findOverlay,
    isHttpsUrl,
    poiIcon,
    poiInYear,
    type Layer,
    type LayerSource,
    type Locale,
    type Manifest,
    type MapView,
    type Overlay,
    type Photo,
    type Poi,
    type PoiCategory,
} from '@hcm/shared';
import type {
    MapOptions,
    PhotoConeFeature,
    PhotoFeatureCollection,
    PhotoPointFeature,
    PoiFeature,
    RasterLayerSpec,
    VectorOverlaySpec,
} from '@hcm/ui/map';

import { photosNearYear } from './timeline.js';

/** Length of a view cone's sides on the map, in metres (a drawing choice, `ViewCone.distanceM`). */
export const CONE_LENGTH_M = 60;

/** Text in the visitor's language; a missing English text falls back to Romanian. */
export function localized(text: { readonly ro: string; readonly en?: string | undefined }, locale: Locale): string {
    return text[locale] ?? text.ro;
}

/** `url` as the browser must load it: https stays, a relative path is resolved against the manifest's address. */
export function resolveAssetUrl(url: string, base: string | undefined): string {
    if (isHttpsUrl(url) || base === undefined || !URL.canParse(url, base)) {
        return url;
    }
    return new URL(url, base).href;
}

function resolvedSource(source: LayerSource, base: string | undefined): LayerSource {
    return source.type === 'pmtiles' ? { ...source, url: resolveAssetUrl(source.url, base) } : source;
}

/** The optional parts of a layer's spec, present only when the manifest has them. */
function rasterExtras(layer: Layer): Pick<RasterLayerSpec, 'bounds' | 'adjustments'> {
    const bounds = layer.bounds === undefined ? {} : { bounds: layer.bounds };
    return layer.adjustments === undefined ? bounds : { ...bounds, adjustments: layer.adjustments };
}

/** A layer as its overlay shows it now (the manifest defaults without one). */
export function rasterSpec(layer: Layer, overlay: Overlay | undefined, base: string | undefined): RasterLayerSpec {
    const state = overlay ?? { visible: layer.defaultVisible, opacity: layer.opacity };
    return {
        id: layer.id,
        source: resolvedSource(layer.source, base),
        minzoom: layer.minzoom,
        maxzoom: layer.maxzoom,
        visible: state.visible,
        opacity: state.opacity,
        order: layer.order,
        attribution: layer.attribution,
        ...rasterExtras(layer),
    };
}

function photoPoint(photo: Photo, locale: Locale): PhotoPointFeature {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [photo.location.lng, photo.location.lat] },
        properties: { id: photo.id, title: localized(photo.title, locale), year: photo.year ?? null, bearing: photo.bearing ?? null },
    };
}

function photoCone(photo: Photo): PhotoConeFeature[] {
    if (photo.bearing === undefined) {
        return [];
    }
    const cone = { bearing: photo.bearing, fov: photo.fov ?? DEFAULT_FOV, distanceM: CONE_LENGTH_M };
    const ring = conePolygon([photo.location.lng, photo.location.lat], cone);
    return [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { id: photo.id } }];
}

/** The photos the timeline shows at `year`, as markers plus a cone for each photo with a bearing. */
export function photoFeatures(photos: readonly Photo[], locale: Locale, year: number | null): PhotoFeatureCollection {
    const shown = photosNearYear(photos, year);
    return { type: 'FeatureCollection', features: [...shown.map((photo) => photoPoint(photo, locale)), ...shown.flatMap(photoCone)] };
}

function poiFeature(poi: Poi, locale: Locale): PoiFeature {
    return { type: 'Feature', geometry: poi.geometry, properties: { id: poi.id, title: localized(poi.title, locale) } };
}

function poiSpec(category: PoiCategory, pois: readonly Poi[], overlay: Overlay | undefined, locale: Locale): VectorOverlaySpec {
    return {
        id: category.id,
        kind: 'poi',
        features: pois.filter((poi) => poi.category === category.id).map((poi) => poiFeature(poi, locale)),
        color: category.color,
        icon: poiIcon(category.icon),
        visible: overlay?.visible ?? true,
        opacity: overlay?.opacity ?? category.defaultOpacity,
    };
}

/** One vector overlay per POI category, with the POIs the timeline shows at `year` (`poiInYear`). */
export function poiSpecs(
    manifest: Manifest,
    overlays: readonly Overlay[],
    locale: Locale,
    year: number | null,
): readonly VectorOverlaySpec[] {
    const shown = (manifest.pois ?? []).filter((poi) => poiInYear(poi, year));
    return (manifest.poiCategories ?? []).map((category) => poiSpec(category, shown, findOverlay(overlays, category.id), locale));
}

/** The map of a city: its basemap, token, zoom range and bounds. */
export function mapOptions(manifest: Manifest, view: MapView, locale: Locale, reducedMotion: boolean): MapOptions {
    const { city } = manifest;
    return {
        style: city.basemap.style,
        ...(city.basemap.config === undefined ? {} : { config: city.basemap.config }),
        accessToken: city.mapbox.publicToken,
        view,
        minZoom: city.minZoom,
        maxZoom: city.maxZoom,
        maxBounds: city.bounds,
        locale,
        reducedMotion,
    };
}
