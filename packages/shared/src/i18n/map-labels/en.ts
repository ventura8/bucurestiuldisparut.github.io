import type { MapLabelsKey } from './ro.js';

/** English texts of the Layers panel's Map labels group. Typed against the Romanian source of truth (`ro.ts`): a missing or extra key is a type error. */
export const en: Readonly<Record<MapLabelsKey, string>> = {
    'mapLabels.group': 'Map labels',
    'mapLabels.streets': 'Street names',
    'mapLabels.pois': 'Points of interest',
    'mapLabels.note': "Text on today's map, such as shops and restaurants.",
    'mapLabels.notePlaces': "The Places above are this site's own and have their own switches.",
};
