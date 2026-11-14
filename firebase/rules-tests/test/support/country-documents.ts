// M28 (docs/research/M28-sources.md §10): the country lists' test document, beside documents.ts (at its size limit).
import { past, type Data } from './world.js';

/** M28: a country's list of where old maps and images are, as ops.tick writes it. */
export function countrySourcesDoc(): Data {
    return {
        country: 'RO',
        language: 'ro',
        cities: ['matrix-city'],
        places: [],
        origin: 'curated',
        factsCheckedOn: '2026-11-14',
        refreshedAt: past(),
        updatedBy: 'system:ops',
        updatedAt: past(),
    };
}
