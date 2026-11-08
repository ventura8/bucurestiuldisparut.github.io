/**
 * The map's zoom buttons (the owner, 2026-11-08; scenario V45): Zoom in and Zoom out, a vertical M3 button group on the
 * map's trailing edge (a row beside the vertical timeline on a phone held landscape; `viewer-styles.ts`). Our own icon
 * buttons, not Mapbox's NavigationControl: the kit's 48 px targets, theme and languages, no compass
 * (DECISIONS-for-review.md §115). A click asks the store for one level (`zoomBy`); at the city's zoom limit the button
 * is soft-disabled: it says so and keeps the focus. In swipe compare the second map follows the first, so one pair serves both.
 * Zoom out's limit is the higher of `city.minZoom` and the zoom at which the city's bounds just cover the map: Mapbox keeps
 * the view inside `maxBounds`, so on most screens it stops there first (Bucharest: about 10.8 on a phone, 11.6 at 1440 px).
 */
import { translate, type BBox, type Locale, type Manifest, type MapView } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

/**
 * One button: its name is also its tooltip; at the limit it is soft-disabled and its press never reaches the store (Zoom
 * out's limit comes from the map's box, which the store does not know: Mapbox would clamp the flight back, but only after
 * moving the map and rewriting the address).
 */
function zoomButton(label: string, icon: string, atLimit: boolean, onClick: () => void): TemplateResult {
    return html`<hcm-icon-button
        icon=${icon}
        .label=${label}
        title=${label}
        ?soft-disabled=${atLimit}
        @click=${atLimit ? nothing : onClick}
    ></hcm-icon-button>`;
}

/** The map's box in CSS px. */
export interface MapSize {
    readonly width: number;
    readonly height: number;
}

/** A latitude's Web Mercator y, in world widths. */
function mercatorY(lat: number): number {
    return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);
}

/** The lowest zoom at which `bounds` still cover a map of `size` (Mapbox's world is 512 px wide at zoom 0). */
export function coverZoom([[west, south], [east, north]]: BBox, size: MapSize): number {
    return Math.log2(Math.max((size.width * 360) / (east - west), size.height / (mercatorY(north) - mercatorY(south))) / 512);
}

/**
 * The two buttons for the camera's `view` in the city's zoom range and, once the map has a box (`size`), its bounds;
 * `onZoom` gets 1 or -1. A hundredth of a level covers the rounding of the camera Mapbox stopped.
 */
export function zoomButtons(
    { locale, mapSize }: { readonly locale: Locale; readonly mapSize: MapSize | null },
    view: MapView,
    manifest: Manifest,
    onZoom: (step: number) => void,
): TemplateResult {
    const { maxZoom, bounds } = manifest.city;
    const minZoom = Math.max(manifest.city.minZoom, mapSize === null ? 0 : coverZoom(bounds, mapSize) + 0.01);
    return html`<div class="dock zoom" data-layout-check="zoom">
        ${zoomButton(translate(locale, 'viewer.zoomIn'), 'add', view.zoom >= maxZoom, () => {
            onZoom(1);
        })}
        ${zoomButton(translate(locale, 'viewer.zoomOut'), 'remove', view.zoom <= minZoom, () => {
            onZoom(-1);
        })}
    </div>`;
}
