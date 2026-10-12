/**
 * The manifest of one city from its documents (`docs/research/M2-interfaces.md` §3.5, security review §4.5), pure:
 * the builder reads, this assembles and validates, the builder uploads. Every listed document becomes its manifest
 * shape (`{lat, lng}` → `[lng, lat]`, bounds records → boxes, English falling back to Romanian where the manifest needs
 * both); a document the manifest schema refuses is left out and reported (entity, id, first issue), never failing the
 * build; only a problem of the city itself does.
 */
import {
    MANIFEST_VERSION,
    bboxCenter,
    bboxFromRecord,
    geometryFromDoc,
    validateManifest,
    type CityDoc,
    type LayerDoc,
    type Manifest,
    type ManifestStateDoc,
    type PhotoDoc,
    type PoiCategoryDoc,
    type PoiDoc,
    type ValidationIssue,
} from '@hcm/shared';

import type { InvalidDocument, QueryResult, StoredDocument } from '../ports/documents.js';

export type SkippedDocument = NonNullable<ManifestStateDoc['skipped']>[number];

type ManifestEntity = SkippedDocument['entity'];

/** Everything the builder read for one city: the city, and each collection's valid and refused documents. */
export interface CityContent {
    readonly cityId: string;
    readonly city: CityDoc;
    readonly layers: QueryResult<LayerDoc>;
    readonly photos: QueryResult<PhotoDoc>;
    readonly poiCategories: QueryResult<PoiCategoryDoc>;
    readonly pois: QueryResult<PoiDoc>;
}

/** How many of each the manifest lists (`manifests/{city}.counts`). */
type Counts = Readonly<Record<ListKey, number>>;

export type Assembly =
    | { readonly ok: true; readonly manifest: Manifest; readonly counts: Counts; readonly skipped: readonly SkippedDocument[] }
    | { readonly ok: false; readonly issues: readonly ValidationIssue[]; readonly skipped: readonly SkippedDocument[] };

/** The view of a city that sets none: a city-wide zoom, within its own limits when it sets those. */
const VIEW_DEFAULTS = { zoom: 13, minZoom: 10, maxZoom: 20 } as const;
const DEFAULT_BASEMAP = { style: 'mapbox://styles/mapbox/standard' } as const;
/** A document refused again after this many passes fails the build (each pass drops every refused document). */
const MAX_PASSES = 4;
const MAX_SKIPPED_PATH = 200;

type ListKey = 'layers' | 'photos' | 'poiCategories' | 'pois';

const ENTITY_OF: Readonly<Record<ListKey, ManifestEntity>> = {
    layers: 'layer',
    photos: 'photo',
    poiCategories: 'poiCategory',
    pois: 'poi',
};

const LIST_KEYS: readonly ListKey[] = ['layers', 'photos', 'poiCategories', 'pois'];

/** One listed document: its id and its manifest entry (a POI's photos are the ones the manifest still lists). */
interface Item {
    readonly id: string;
    readonly entry: (photoIds: ReadonlySet<string>) => unknown;
}

type Lists = Readonly<Record<ListKey, readonly Item[]>>;

/** A manifest issue inside one listed item: the item's list and index, the issue, the path inside the item. */
interface Located {
    readonly key: ListKey;
    readonly index: number;
    readonly issue: ValidationIssue;
    readonly path: string;
}

type Localized = Readonly<{ ro: string; en?: string | undefined }>;

/** Romanian and English: English falls back to Romanian (the viewer would show Romanian anyway). */
function both(text: Localized): { readonly ro: string; readonly en: string } {
    return { ro: text.ro, en: text.en ?? text.ro };
}

function maybeBoth(text: Localized | undefined): { readonly ro: string; readonly en: string } | undefined {
    return text === undefined ? undefined : both(text);
}

function cityView(city: CityDoc) {
    const bounds = bboxFromRecord(city.bounds);
    const minZoom = city.minZoom ?? VIEW_DEFAULTS.minZoom;
    const maxZoom = city.maxZoom ?? VIEW_DEFAULTS.maxZoom;
    const zoom = city.zoom ?? Math.min(Math.max(VIEW_DEFAULTS.zoom, minZoom), maxZoom);
    const center = city.center === undefined ? bboxCenter(bounds) : [city.center.lng, city.center.lat];
    return { center, zoom, minZoom, maxZoom, bounds };
}

/**
 * The manifest's `city`: the public token, theme tokens and analytics ids from the city document, the crash endpoint
 * from the runtime configuration (crash reports work before analytics is set up). A city without About, privacy
 * notice, theme or public token fails the manifest schema: the build reports it.
 */
function cityEntry(content: CityContent, errorEndpoint: string): unknown {
    const { city } = content;
    return {
        id: content.cityId,
        name: both(city.name),
        ...cityView(city),
        about: maybeBoth(city.about),
        credits: city.credits ?? [],
        privacy: maybeBoth(city.privacy),
        theme: city.theme,
        basemap: city.basemap ?? DEFAULT_BASEMAP,
        mapbox: { publicToken: city.mapbox?.publicToken },
        analytics: { ...city.analytics, errorEndpoint },
        engine: city.engine,
    };
}

function layerEntry(layer: LayerDoc, id: string): unknown {
    return {
        id,
        year: layer.year,
        date: layer.date,
        label: both(layer.label),
        description: maybeBoth(layer.description),
        kind: layer.kind,
        sensor: layer.sensor,
        attribution: layer.attribution,
        source: layer.source,
        minzoom: layer.minzoom,
        maxzoom: layer.maxzoom,
        bounds: layer.bounds === undefined ? undefined : bboxFromRecord(layer.bounds),
        order: layer.order,
        defaultVisible: layer.defaultVisible,
        opacity: layer.opacity,
        adjustments: layer.adjustments,
    };
}

function photoEntry(photo: PhotoDoc & { readonly image: NonNullable<PhotoDoc['image']> }, id: string): unknown {
    return {
        id,
        title: photo.title,
        description: photo.description,
        year: photo.year,
        yearEnd: photo.yearEnd,
        dateText: photo.dateText,
        author: photo.author,
        license: photo.license,
        rightsHolder: photo.rightsHolder,
        rightsReview: photo.rightsReview,
        links: photo.links ?? [],
        location: photo.location,
        bearing: photo.bearing,
        fov: photo.fov,
        image: { web: photo.image.web, thumb: photo.image.thumb, w: photo.image.w, h: photo.image.h },
    };
}

function poiCategoryEntry(category: PoiCategoryDoc, id: string): unknown {
    return { id, label: both(category.label), icon: category.icon, color: category.color, defaultOpacity: category.defaultOpacity };
}

/** A POI names only photos the manifest lists: an unpublished photo leaves the POI, never the POI the manifest. */
function poiEntry(poi: PoiDoc, id: string, photoIds: ReadonlySet<string>): unknown {
    const photos = poi.photoIds?.filter((photoId) => photoIds.has(photoId));
    return {
        id,
        category: poi.category,
        geometry: geometryFromDoc(poi.geometry),
        title: poi.title,
        description: poi.description,
        yearStart: poi.yearStart,
        yearEnd: poi.yearEnd,
        links: poi.links ?? [],
        photoIds: photos?.length === 0 ? undefined : photos,
    };
}

const byId = (a: { readonly id: string }, b: { readonly id: string }): number => a.id.localeCompare(b.id);

function byOrder(a: StoredDocument<{ readonly order: number }>, b: StoredDocument<{ readonly order: number }>): number {
    return a.data.order - b.data.order || byId(a, b);
}

function hasImage(photo: PhotoDoc): photo is PhotoDoc & { readonly image: NonNullable<PhotoDoc['image']> } {
    return photo.published && photo.processing === 'done' && photo.image !== undefined;
}

/** The listed documents in a stable order: ready published layers, processed published photos, every category. */
function listsOf(content: CityContent): Lists {
    const photos = content.photos.documents.flatMap(({ id, data }) => (hasImage(data) ? [{ id, entry: () => photoEntry(data, id) }] : []));
    return {
        layers: content.layers.documents
            .filter(({ data }) => data.published && data.status === 'ready')
            .toSorted(byOrder)
            .map(({ id, data }) => ({ id, entry: () => layerEntry(data, id) })),
        photos: photos.toSorted(byId),
        poiCategories: content.poiCategories.documents
            .toSorted(byOrder)
            .map(({ id, data }) => ({ id, entry: () => poiCategoryEntry(data, id) })),
        pois: content.pois.documents
            .filter(({ data }) => data.published)
            .toSorted(byId)
            .map(({ id, data }) => ({ id, entry: (photoIds: ReadonlySet<string>) => poiEntry(data, id, photoIds) })),
    };
}

function draft(content: CityContent, city: unknown, lists: Lists): unknown {
    const photoIds = new Set(lists.photos.map((item) => item.id));
    const entries = (key: ListKey) => lists[key].map((item) => item.entry(photoIds));
    return {
        version: MANIFEST_VERSION,
        city,
        layers: entries('layers'),
        photos: entries('photos'),
        photosOverlay: content.city.photosOverlay,
        poiCategories: entries('poiCategories'),
        pois: entries('pois'),
    };
}

/** `photos[3].location.lat` → the fourth item of `photos`, and the path inside it (`location.lat`). */
function locate(issue: ValidationIssue): Located | undefined {
    const key = LIST_KEYS.find((candidate) => issue.path.startsWith(`${candidate}[`));
    if (key === undefined) {
        return undefined;
    }
    const close = issue.path.indexOf(']');
    return { key, index: Number(issue.path.slice(key.length + 1, close)), issue, path: issue.path.slice(close + 1).replace(/^\./, '') };
}

function skippedOf(located: Located, id: string): SkippedDocument {
    return { entity: ENTITY_OF[located.key], id, code: located.issue.code, path: located.path.slice(0, MAX_SKIPPED_PATH) };
}

/** Each refused item once (its first issue), and the lists without them. */
function drop(lists: Lists, located: readonly Located[]): { readonly lists: Lists; readonly skipped: readonly SkippedDocument[] } {
    const first = new Map<string, Located>();
    for (const item of located) {
        const at = `${item.key}/${String(item.index)}`;
        first.set(at, first.get(at) ?? item);
    }
    const skipped: SkippedDocument[] = [];
    const keep = (key: ListKey) =>
        lists[key].filter((item, index) => {
            const refusal = first.get(`${key}/${String(index)}`);
            if (refusal !== undefined) {
                skipped.push(skippedOf(refusal, item.id));
            }
            return refusal === undefined;
        });
    return { lists: { layers: keep('layers'), photos: keep('photos'), poiCategories: keep('poiCategories'), pois: keep('pois') }, skipped };
}

/** Validates, drops the refused documents and tries again, until the manifest passes or the city itself is the problem. */
function settle(
    content: CityContent,
    city: unknown,
    lists: Lists,
    state: { passes: number; skipped: readonly SkippedDocument[] },
): Assembly {
    const result = validateManifest(draft(content, city, lists));
    if (result.ok) {
        const counts = {
            layers: lists.layers.length,
            photos: lists.photos.length,
            poiCategories: lists.poiCategories.length,
            pois: lists.pois.length,
        };
        return { ok: true, manifest: result.value, counts, skipped: state.skipped };
    }
    const located = result.issues.map(locate);
    const items = located.filter((item) => item !== undefined);
    if (items.length < located.length || state.passes === 0) {
        return { ok: false, issues: result.issues.filter((_, index) => located[index] === undefined), skipped: state.skipped };
    }
    const next = drop(lists, items);
    return settle(content, city, next.lists, { passes: state.passes - 1, skipped: [...state.skipped, ...next.skipped] });
}

function refused(entity: ManifestEntity, documents: readonly InvalidDocument[]): SkippedDocument[] {
    return documents.map((document) => ({
        entity,
        id: document.id,
        code: document.issues[0]?.code ?? 'validation.invalid',
        path: (document.issues[0]?.path ?? '').slice(0, MAX_SKIPPED_PATH),
    }));
}

/** The city's manifest and the documents left out, or the issues of the city itself when it cannot be published. */
export function assembleManifest(content: CityContent, errorEndpoint: string): Assembly {
    const skipped = [
        ...refused('layer', content.layers.invalid),
        ...refused('photo', content.photos.invalid),
        ...refused('poiCategory', content.poiCategories.invalid),
        ...refused('poi', content.pois.invalid),
    ];
    return settle(content, cityEntry(content, errorEndpoint), listsOf(content), { passes: MAX_PASSES, skipped });
}
