import { catalogueTranslator } from '../catalogue.js';
import { en } from './en.js';
import { ro, type MapLabelsKey } from './ro.js';

export { basemapLabels, MAP_LABEL_CONFIG, MAP_LABEL_KINDS, TRANSIT_LABELS, transitLabels } from '../../overlays/map-labels.js';
export type { MapLabelKind, MapLabels } from '../../overlays/map-labels.js';
export type { MapLabelsKey } from './ro.js';

/** `@hcm/shared/map-labels`: the basemap's labels and the panel's words for them, for the viewer only (docs/ENGINE_API.md → Map labels). */
export const translateMapLabels = catalogueTranslator<MapLabelsKey>({ ro, en });
