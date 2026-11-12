import { catalogueText, type ViewerLocale } from '../index.js';
import { en } from './en.js';
import { ro, type MapLabelsKey } from './ro.js';

export { basemapLabels, MAP_LABEL_CONFIG, MAP_LABEL_KINDS } from '../../overlays/map-labels.js';
export type { MapLabelKind, MapLabels } from '../../overlays/map-labels.js';
export type { MapLabelsKey } from './ro.js';

const LABELS: Partial<Record<ViewerLocale, Readonly<Record<MapLabelsKey, string>>>> = { ro, en };

/**
 * `@hcm/shared/map-labels`: the basemap's labels and the panel's words for them, for the viewer only (docs/ENGINE_API.md →
 * Map labels). Romanian and English are imported (the engine's build empties both); a fetched catalogue holds the family
 * too (`i18n/<locale>.json`). A language not here yet gives an empty text.
 */
export function translateMapLabels(locale: ViewerLocale, key: MapLabelsKey): string {
    return LABELS[locale]?.[key] ?? catalogueText(locale, key) ?? '';
}
