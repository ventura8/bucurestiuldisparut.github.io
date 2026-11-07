/**
 * The labels Mapbox Standard and Standard Satellite draw themselves, which the visitor may hide (docs/ENGINE_API.md → Map
 * labels). They are not overlays: they belong to the basemap, and the city's own places stay POI categories. Only these
 * two kinds are the visitor's choice: `showPlaceLabels` and `showTransitLabels` stay as the city's `basemap.config` sets them.
 */
import type { Basemap } from '../schemas/manifest.js';

export const MAP_LABEL_KINDS = ['streets', 'pois'] as const;

export type MapLabelKind = (typeof MAP_LABEL_KINDS)[number];

/** Which of the basemap's labels are drawn. */
export type MapLabels = Readonly<Record<MapLabelKind, boolean>>;

/** The basemap's configuration property of each kind (on its `basemap` import). */
export const MAP_LABEL_CONFIG: Readonly<Record<MapLabelKind, string>> = {
    streets: 'showRoadLabels',
    pois: 'showPointOfInterestLabels',
};

/** What the city's `basemap.config` asks for; a kind it does not set is drawn, as Standard does by default. */
export function basemapLabels(basemap: Pick<Basemap, 'config'>): MapLabels {
    return {
        streets: basemap.config?.[MAP_LABEL_CONFIG.streets] !== false,
        pois: basemap.config?.[MAP_LABEL_CONFIG.pois] !== false,
    };
}
