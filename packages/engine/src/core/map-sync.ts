/**
 * The map follows the store (docs/research/M1-interfaces.md §6): `render` draws a freshly mounted map from the state,
 * `update` applies what changed between two states. Raster layers in the `middle` slot with their adjustments, the
 * photos (filtered by the timeline), one vector overlay per POI category in the `top` slot; visibility and opacity
 * whenever an overlay changes (the adapter coalesces opacity to one paint per animation frame).
 */
import { findOverlay, PHOTOS_OVERLAY_ID, rasterAdjustmentPaint, type Manifest, type Overlay } from '@hcm/shared';

import type { MapPort } from '../map/map-port.js';
import { photoFeatures, poiSpecs, rasterSpec } from './map-specs.js';
import type { ViewerState } from './state.js';

export class MapSync {
    readonly #map: MapPort;
    readonly #assetBase: string | undefined;

    /** `assetBase`: the manifest's absolute address, for relative asset URLs (undefined: relative to the page). */
    constructor(map: MapPort, assetBase: string | undefined) {
        this.#map = map;
        this.#assetBase = assetBase;
    }

    /** Draws everything for `state` on a map that was just mounted. */
    render(state: ViewerState): void {
        const manifest = state.manifest;
        if (manifest === null) {
            return;
        }
        for (const layer of manifest.layers) {
            this.#map.addRasterLayer(rasterSpec(layer, findOverlay(state.overlays, layer.id), this.#assetBase), 'middle');
            this.#map.setLayerPaint(layer.id, rasterAdjustmentPaint(layer.adjustments));
        }
        const photos = findOverlay(state.overlays, PHOTOS_OVERLAY_ID);
        if (photos !== undefined) {
            this.#map.setOverlayVisibility(photos.id, photos.visible);
            this.#map.setOverlayOpacity(photos.id, photos.opacity);
        }
        this.#features(manifest, state);
    }

    /** Applies the difference between `previous` and `next` (same manifest). */
    update(previous: ViewerState, next: ViewerState): void {
        const manifest = next.manifest;
        if (manifest === null || manifest !== previous.manifest) {
            return;
        }
        this.#overlays(previous.overlays, next.overlays);
        if (next.year !== previous.year || next.locale !== previous.locale) {
            this.#features(manifest, next);
        }
    }

    #overlays(previous: readonly Overlay[], next: readonly Overlay[]): void {
        if (previous === next) {
            return;
        }
        for (const overlay of next) {
            this.#overlay(findOverlay(previous, overlay.id), overlay);
        }
    }

    #overlay(before: Overlay | undefined, overlay: Overlay): void {
        if (before?.visible !== overlay.visible) {
            this.#map.setOverlayVisibility(overlay.id, overlay.visible);
        }
        if (before?.opacity !== overlay.opacity) {
            this.#map.setOverlayOpacity(overlay.id, overlay.opacity);
        }
    }

    /** The photo markers and the POIs of the current stop, titles in the current language. */
    #features(manifest: Manifest, state: ViewerState): void {
        this.#map.setPhotosData(photoFeatures(manifest.photos, state.locale, state.year));
        for (const spec of poiSpecs(manifest, state.overlays, state.locale, state.year)) {
            this.#map.addVectorOverlay(spec, 'top');
        }
    }
}
