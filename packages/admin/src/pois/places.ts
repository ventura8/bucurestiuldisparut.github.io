/**
 * The places list's pure parts (docs/research/M2c-interfaces.md §7.1): its query (one indexed filter: a category, else
 * Unpublished), what the filter shows of a loaded page (Unpublished within a category, the title search), the map's
 * overlays of the shown places and of an import's preview, and the photos the picker offers.
 */
import { DEFAULT_POI_ICON, isHttpsUrl, type AdminContentKey, type PhotoDoc } from '@hcm/shared';
import type { VectorOverlaySpec } from '@hcm/ui/map';

import type { ContentQuery, Stored, WriteOutcome } from '../content/services.js';
import type { PlaceEditorState } from './editor.js';
import type { ImportState } from './importer.js';
import { overlayOf, UNCATEGORISED_COLOR } from './map-session.js';
import { textIn, textOf, type CategoryItem, type PoiItem } from './model.js';

export interface PoisFilter {
    /** One category, or every one. */
    readonly category: string | null;
    readonly unpublished: boolean;
    /** Filters the loaded page by title. */
    readonly search: string;
}

/** A photo the picker offers (its thumbnail only when it is an https address). */
export interface PhotoChoice {
    readonly id: string;
    readonly title: { readonly ro: string; readonly en?: string };
    readonly year: number | null;
    readonly thumb: string | null;
}

/** The list's query: newest first, one indexed filter (a category, else Unpublished). */
export function poisQuery(filter: PoisFilter): ContentQuery {
    if (filter.category !== null) {
        return { where: [['category', '==', filter.category]], orderBy: [['updatedAt', 'desc']] };
    }
    return { where: filter.unpublished ? [['published', '==', false]] : [], orderBy: [['updatedAt', 'desc']] };
}

function matches(item: PoiItem, search: string): boolean {
    return search === '' || `${item.title.ro} ${item.title.en ?? ''}`.toLocaleLowerCase('ro').includes(search);
}

/** The places of a page that the filter shows (Unpublished within a category, and the search, apply here). */
export function shownPlaces(items: readonly PoiItem[], filter: PoisFilter): readonly PoiItem[] {
    const search = filter.search.trim().toLocaleLowerCase('ro');
    return items.filter((item) => (!filter.unpublished || !item.published) && matches(item, search));
}

export function photoChoiceOf(doc: Stored<PhotoDoc>): PhotoChoice {
    const thumb = doc.data.image?.thumb ?? '';
    return { id: doc.id, title: textOf(doc.data.title), year: doc.data.year ?? null, thumb: isHttpsUrl(thumb) ? thumb : null };
}

/** One overlay per category with the places it shows, titles in the admin's language. */
export function placeOverlays(categories: readonly CategoryItem[], places: readonly PoiItem[], locale: 'ro' | 'en'): VectorOverlaySpec[] {
    return categories.map((category) =>
        overlayOf(
            category,
            places
                .filter((place) => place.category === category.id)
                .map((place) => ({ id: place.id, geometry: place.geometry, title: textIn(place.title, locale) })),
        ),
    );
}

/** The import's planned places on the map, in one neutral overlay that clicks pass through. */
export function importOverlays(importing: ImportState | null): VectorOverlaySpec[] {
    const plan = importing?.status === 'preview' ? importing.plan : null;
    if (plan === null) {
        return [];
    }
    const places = [...plan.created, ...plan.updated].flatMap((place) =>
        place.value.geometry === null
            ? []
            : [{ id: `hcm-import-${String(place.number)}`, geometry: place.value.geometry, title: place.value.title.ro }],
    );
    return [
        {
            ...overlayOf({ id: 'hcm-import', color: UNCATEGORISED_COLOR, icon: DEFAULT_POI_ICON, defaultOpacity: 1 }, places),
            clickable: false,
        },
    ];
}

export function notFound(id: string): PlaceEditorState {
    return {
        id,
        status: 'not-found',
        failure: null,
        reconnecting: false,
        draft: null,
        shape: 'point',
        sketch: [],
        vertex: null,
        refusal: null,
    };
}

export type WriteFailure = Exclude<WriteOutcome, { readonly ok: true }>['reason'];

/** The snackbar's text for a write the store refused. */
export const WRITE_FAILURES: Readonly<Record<WriteFailure, AdminContentKey>> = {
    conflict: 'adminContent.pois.conflict',
    gone: 'adminContent.pois.gone',
    denied: 'adminContent.pois.denied',
    offline: 'adminContent.pois.offline',
    invalid: 'adminContent.pois.invalid',
};
