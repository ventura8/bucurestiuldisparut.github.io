/**
 * The places area's states of the tour inventory (`ADMIN_STATES` of e2e/tour/states.ts spreads them inside its pois
 * section, which keeps that file within its line limit): ids `pois.<state>` (docs/research/M2c-interfaces.md §12.2),
 * each reached by the spec named in `visit` and checked there with `expectStateSound` at the admin projects.
 */
const VISIT = 'specs/pois/pois.spec.ts';

export const POIS_STATES = {
    'pois.empty': { title: 'Places: none yet, with Add place, Import and Export', visit: VISIT },
    'pois.add-shape': { title: 'Places: Add place open, its three shapes', visit: VISIT },
    'pois.new-place': {
        title: 'Places: a new line without the Mapbox token (the map box with its link to Setup, the tools, no position yet)',
        visit: VISIT,
    },
    'pois.editor': { title: 'Places: a saved line, its positions listed and its description previewed', visit: VISIT },
    'pois.delete-confirm': { title: 'Places: the delete confirmation (a dialog)', visit: VISIT },
    'pois.list': { title: 'Places: the list of two places in two categories, with the filters', visit: VISIT },
    'pois.import-refused': { title: 'Places: an import file that is not GeoJSON, refused (a dialog)', visit: VISIT },
    'pois.import-preview': {
        title: 'Places: the import preview, one new place and five refused with their reasons (a dialog)',
        visit: VISIT,
    },
} as const;
