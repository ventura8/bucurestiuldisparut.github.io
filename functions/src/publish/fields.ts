/**
 * The diff gate of the `publish.on*Write` triggers (`docs/research/M2-interfaces.md` §3.5, security review §4.5): a
 * write requests a manifest build only when it can change the published manifest.
 */
import type { HistoryEntity } from '@hcm/shared';

/** A content document as a trigger sees it (`snapshot.data()`), or undefined before a create and after a delete. */
export type RawDocument = Readonly<Record<string, unknown>> | undefined;

/**
 * Per entity, the document fields the builder (`assemble.ts`) reads besides `published`: the ones it copies into the
 * manifest and the ones that decide whether a document is listed (`status` of a layer, `processing` and `image` of a
 * photo). A change to any other field (the stamp, `createdAt`, a suggestion, the EXIF summary) rebuilds nothing.
 */
export const MANIFEST_FIELDS: Readonly<Record<HistoryEntity, readonly string[]>> = {
    city: [
        'name',
        'bounds',
        'center',
        'zoom',
        'minZoom',
        'maxZoom',
        'about',
        'privacy',
        'credits',
        'theme',
        'basemap',
        'mapbox',
        'analytics',
        'engine',
        'photosOverlay',
    ],
    layer: [
        'year',
        'date',
        'label',
        'description',
        'kind',
        'sensor',
        'attribution',
        'source',
        'minzoom',
        'maxzoom',
        'bounds',
        'order',
        'defaultVisible',
        'opacity',
        'adjustments',
        'status',
    ],
    photo: [
        'title',
        'description',
        'year',
        'yearEnd',
        'dateText',
        'author',
        'license',
        'rightsHolder',
        'rightsReview',
        'links',
        'location',
        'bearing',
        'fov',
        'image',
        'processing',
    ],
    poi: ['category', 'geometry', 'title', 'description', 'yearStart', 'yearEnd', 'links', 'photoIds'],
    poiCategory: ['label', 'icon', 'color', 'defaultOpacity', 'order'],
};

/** POI categories have no `published` flag: every category is listed while it exists. */
function isListed(entity: HistoryEntity, document: RawDocument): boolean {
    return entity === 'poiCategory' ? document !== undefined : document?.['published'] === true;
}

/** The same value whatever the key order of its maps (Firestore does not promise one). */
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonical);
    }
    if (typeof value !== 'object' || value === null) {
        return value;
    }
    const record = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(
        Object.keys(record)
            .toSorted((a, b) => a.localeCompare(b))
            .map((key) => [key, canonical(record[key])]),
    );
}

function sameValue(a: unknown, b: unknown): boolean {
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/**
 * True when the write can change the manifest: the document enters or leaves it (published, created or deleted), or
 * it is listed and one of its `MANIFEST_FIELDS` changed.
 */
export function needsManifestBuild(entity: HistoryEntity, before: RawDocument, after: RawDocument): boolean {
    const listed = isListed(entity, after);
    if (isListed(entity, before) !== listed) {
        return true;
    }
    return listed && MANIFEST_FIELDS[entity].some((field) => !sameValue(before?.[field], after?.[field]));
}
