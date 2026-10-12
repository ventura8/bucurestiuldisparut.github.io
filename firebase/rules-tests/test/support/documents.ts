/**
 * The documents the rules tests seed and write, built from the shared contract (docs/research/M2-interfaces.md §2):
 *
 * - `*Doc` builders are complete server documents: every key their zod schema knows, each with a valid value
 *   (`documents.test.ts` checks both), so a rule that forgets a server-owned field refuses every edit of a real
 *   document and fails the tests;
 * - `new*` builders are what an admin's create sends: exactly the keys of `CLIENT_WRITES[entity].create`;
 * - `EDITS` holds one valid new value for every field `CLIENT_WRITES[entity].update` lists (the stamp aside).
 *
 * Every value is a generated test value; the one shaped like a Google API key is assembled at run time.
 */
import { CLIENT_WRITES, STORAGE_PATHS, publicObjectUrl, type ClientCollection, type PhotoVariant } from '@hcm/shared';

import { later, past, serverTime, stampedBy, systemStamp, type Data } from './world.js';

/** The bounds every test city gets: photo locations must fall within them (±0.5°). */
export const CITY_BOUNDS = { west: 25.9, south: 44.3, east: 26.3, north: 44.6 } as const;

const SHA = 'ab'.repeat(32);
const PUBLIC_BUCKET = 'demo-hcm-public';
const API_KEY = `${['AI', 'za'].join('')}${'RulesFakeKey'.padEnd(35, '0')}`;

function tokens(primary: string): Data {
    return { '--md-sys-color-primary': primary, '--md-sys-color-on-primary': '#ffffff' };
}

/** A generated theme: every scheme has tokens (the rules check the counts, the builder the values). */
export function theme(seedColor: string): Data {
    return {
        seedColor,
        tokens: {
            light: tokens(seedColor),
            dark: tokens(seedColor),
            highContrastLight: tokens(seedColor),
            highContrastDark: tokens(seedColor),
        },
    };
}

/** `count` valid links (at most five are allowed). */
export function links(count: number): Data[] {
    return Array.from({ length: count }, (_, index) => ({
        url: `https://example.org/sursa/${String(index)}`,
        label: `Sursa ${String(index + 1)}`,
    }));
}

/** A closed ring of `count` vertices (the last repeats the first) around Bucharest's centre. */
export function closedRing(count: number): Data[] {
    const open = Array.from({ length: count - 1 }, (_, index) => ({ lat: 44.43 + index / 1000, lng: 26.1 + (index % 2) / 1000 }));
    return [...open, open[0] ?? { lat: 44.43, lng: 26.1 }];
}

/** `count` vertices of an open line. */
export function line(count: number): Data[] {
    return Array.from({ length: count }, (_, index) => ({ lat: 44.43 + index / 10_000, lng: 26.1 }));
}

function derivative(cityId: string, photoId: string, variant: PhotoVariant): string {
    return publicObjectUrl(PUBLIC_BUCKET, STORAGE_PATHS.photoDerivative(cityId, photoId, SHA, variant));
}

export function cityDoc(cityId: string): Data {
    return {
        id: cityId,
        name: { ro: 'București', en: 'Bucharest' },
        bounds: CITY_BOUNDS,
        center: { lat: 44.43, lng: 26.1 },
        zoom: 12,
        minZoom: 10,
        maxZoom: 18,
        about: { ro: 'Despre hartă.', en: 'About the map.' },
        privacy: { ro: 'Confidențialitate.', en: 'Privacy.' },
        credits: [{ label: { ro: 'Arhiva', en: 'Archive' }, url: 'https://example.org/arhiva' }],
        theme: theme('#875329'),
        basemap: { style: 'mapbox://styles/mapbox/standard', config: { lightPreset: 'day', show3dObjects: false } },
        mapbox: {
            user: 'hcm-test',
            publicToken: 'pk.rules-test-viewer',
            publicTokenId: 'rulestestviewer',
            allowedUrls: ['https://ventura8.github.io'],
        },
        analytics: {
            measurementId: 'G-RULESTEST',
            errorEndpoint: 'https://us-central1-demo-hcm.cloudfunctions.net/telemetry-reportError',
            firebase: { apiKey: API_KEY, appId: '1:123456:web:abc123', projectId: 'demo-hcm' },
        },
        engine: { minVersion: '1.0.0' },
        photosOverlay: { defaultOpacity: 0.9 },
        published: true,
        createdAt: past(),
        ...systemStamp('setup'),
    };
}

/** A processed photo (`photos.onUpload` ran) with every field the schema knows. */
export function photoDoc(cityId: string, photoId: string, creator: string): Data {
    return {
        ...photoText(),
        license: 'CC-BY-4.0',
        links: links(1),
        location: { lat: 44.4462, lng: 26.0969 },
        bearing: 90,
        fov: 60,
        published: false,
        rightsReview: false,
        image: { web: derivative(cityId, photoId, 'web'), thumb: derivative(cityId, photoId, 'thumb'), sha256: SHA, w: 2048, h: 1536 },
        exif: { Make: 'Zeiss Ikon', ExposureTime: 0.004 },
        processing: 'done',
        processingError: 'apiError.photo.duplicate',
        duplicateOf: 'p-original',
        suggested: { location: { lat: 44.446, lng: 26.097 }, year: 1936, bearing: 85, title: 'Piata Romana 1936' },
        original: {
            path: STORAGE_PATHS.photoOriginal(cityId, photoId, SHA, 'image/jpeg'),
            contentType: 'image/jpeg',
            bytes: 1_048_576,
            sha256: SHA,
        },
        createdAt: past(),
        createdBy: creator,
        ...systemStamp('photos'),
    };
}

function photoText(): Data {
    return {
        title: { ro: 'Piața Romană', en: 'Roman Square' },
        description: { ro: 'Vedere spre nord.', en: 'Looking north.' },
        year: 1935,
        yearEnd: 1940,
        dateText: { ro: 'Iulie 1936', en: 'July 1936' },
        author: 'Ion Mureșan',
        rightsHolder: 'Ion Mureșan',
        sourceUrl: 'https://example.org/foto/1',
        sourceLabel: 'Arhiva familiei',
        permissionNote: 'Permisiune scrisă pentru proiect.',
        legacyId: 'ci9e9tn7b0356kzkuzlkncngf',
    };
}

/** What the admin sends to create a photo: every client field, unprocessed and unpublished. */
export function newPhoto(uid: string): Data {
    return {
        ...photoText(),
        license: 'permission-legacy',
        links: links(5),
        location: { lat: 44.4462, lng: 26.0969 },
        bearing: 360,
        fov: 180,
        published: false,
        rightsReview: true,
        processing: 'pending',
        createdAt: serverTime(),
        createdBy: uid,
        ...stampedBy(uid),
    };
}

export function layerDoc(): Data {
    return {
        year: 1966,
        date: '1966-08-20',
        label: { ro: 'Corona 1966', en: 'Corona 1966' },
        description: { ro: 'Fotografie declasificată.', en: 'Declassified photograph.' },
        kind: 'satellite',
        sensor: 'KH-4A',
        attribution: 'Courtesy of the U.S. Geological Survey',
        source: { type: 'mapbox', tilesetId: 'hcm-test.corona-1966' },
        minzoom: 8,
        maxzoom: 17,
        bounds: CITY_BOUNDS,
        order: 1,
        opacity: 0.8,
        defaultVisible: true,
        adjustments: { brightnessMin: 0.1, brightnessMax: 0.9, contrast: 0.2, saturation: -0.5 },
        status: 'ready',
        published: true,
        provenance: {
            usgsEntityId: 'DS1034-1057DA024',
            usgsDataset: 'corona2',
            georef: { method: 'gcps', gcpCount: 12, checkpointRmseM: 4.5 },
        },
        mapbox: { tilesetId: 'hcm-test.corona-1966', publishedSourceSha: SHA },
        createdAt: past(),
        ...systemStamp('pipeline'),
    };
}

function poiText(): Data {
    return {
        category: 'cladiri',
        title: { ro: 'Biserica Enei', en: 'Enei Church' },
        description: { ro: 'Demolată în **1977**.', en: 'Demolished in **1977**.' },
        yearStart: 1850,
        yearEnd: 1977,
        links: links(2),
        photoIds: ['p1', 'p2'],
    };
}

export function poiDoc(creator: string): Data {
    return {
        ...poiText(),
        geometry: { type: 'Polygon', rings: [{ points: closedRing(5) }] },
        published: true,
        createdAt: past(),
        createdBy: creator,
        updatedBy: creator,
        updatedAt: past(),
    };
}

export function newPoi(uid: string): Data {
    return {
        ...poiText(),
        geometry: { type: 'Point', point: { lat: 44.4355, lng: 26.1003 } },
        published: false,
        createdAt: serverTime(),
        createdBy: uid,
        ...stampedBy(uid),
    };
}

export function poiCategoryDoc(): Data {
    return {
        label: { ro: 'Clădiri', en: 'Buildings' },
        icon: 'church',
        color: '#875329',
        defaultOpacity: 0.8,
        order: 1,
        createdAt: past(),
        ...systemStamp('bootstrap'),
    };
}

export function newPoiCategory(uid: string): Data {
    return {
        label: { ro: 'Străzi dispărute' },
        icon: 'add_road',
        color: '#3366AA',
        defaultOpacity: 1,
        order: 2,
        createdAt: serverTime(),
        ...stampedBy(uid),
    };
}

/** A running job with every field the runner owns. */
export function jobDoc(creator: string, status = 'running'): Data {
    return {
        type: 'usgs-import',
        status,
        params: { entityId: 'DS1034-1057DA024' },
        createdBy: creator,
        createdAt: past(),
        cancelRequested: false,
        step: 'fetch',
        progress: 0.25,
        retryAt: later(),
        dispatchAt: past(),
        executionName: 'projects/demo-hcm/locations/us-central1/jobs/raster-std/executions/raster-std-abc',
        machine: 'std',
        attempt: 1,
        lease: { owner: 'raster-std-abc', until: later() },
        steps: { fetch: { status: 'running', gcsPath: 'usgs-raw/rules/frame.tgz', generation: '1700000000000000', sha256: SHA } },
        mapboxJobId: 'mts-job-1',
        error: { code: 'usgs.unavailable', message: 'USGS did not answer.' },
        ...systemStamp('pipeline'),
    };
}

export function newJob(uid: string): Data {
    return {
        type: 'usgs-import',
        status: 'queued',
        params: { entityId: 'DS1034-1057DA024' },
        createdBy: uid,
        createdAt: serverTime(),
        ...stampedBy(uid),
    };
}

export function jobLogDoc(): Data {
    return { seq: 1, level: 'info', step: 'fetch', message: 'fetch: 12% of 1.2 GB', ...systemStamp('pipeline') };
}

export function usgsSceneDoc(status = 'candidate'): Data {
    return {
        entityId: 'DS1034-1057DA024',
        dataset: 'corona2',
        acquisitionDate: '1966-08-20',
        status,
        note: 'Acoperire bună.',
        downloadAvailable: true,
        browseUrl: 'https://example.org/browse/DS1034-1057DA024.jpg',
        footprint: [
            { lat: 44.2, lng: 25.8 },
            { lat: 44.7, lng: 25.8 },
            { lat: 44.7, lng: 26.4 },
        ],
        rank: 0.92,
        createdAt: past(),
        ...systemStamp('pipeline'),
    };
}

export function historyEntryDoc(editor: string): Data {
    return {
        entity: 'photo',
        entityId: 'p1',
        action: 'update',
        previous: { title: { ro: 'Piața Romană' }, published: false },
        changedFields: ['title'],
        updatedBy: editor,
        updatedAt: past(),
    };
}

export function adminDoc(): Data {
    return {
        role: 'owner',
        email: 'owner@example.test',
        displayName: 'Proprietar',
        invitedBy: 'bootstrap',
        createdAt: past(),
        ...systemStamp('admins'),
    };
}

export function inviteDoc(inviter: string): Data {
    return { role: 'admin', invitedBy: inviter, createdAt: past(), expiresAt: later(), updatedBy: inviter, updatedAt: past() };
}

export function ownerDoc(uid: string): Data {
    return { uid, claimedAt: past(), updatedBy: uid, updatedAt: past() };
}

export function setupStatusDoc(): Data {
    return {
        billing: {
            state: 'ok',
            checkedAt: past(),
            budgetId: 'billingAccounts/0123-4567-89AB/budgets/hcm-budget',
            budgetAmount: 5,
            currency: 'USD',
        },
        provision: { state: 'pending', items: [{ id: 'apis', state: 'ok', checkedAt: past() }] },
        mapbox: {
            state: 'ok',
            user: 'hcm-test',
            scopes: ['styles:read', 'tokens:write'],
            tilesTokenId: 'tilestoken',
            adminToken: 'pk.rules-test-admin',
            adminTokenId: 'admintoken',
            adminAllowedUrls: ['https://demo-hcm.web.app'],
            retiring: [{ tokenId: 'oldtoken', retireAt: later() }],
        },
        usgs: { state: 'pending', role: 'search', nextCheckAt: later(), tokenExpiresAt: later() },
        analytics: { state: 'unavailable', detail: 'apiError.unavailable' },
        crash: { state: 'ok', lastReportAt: past() },
        secretsRev: 3,
        ...systemStamp('setup'),
    };
}

export function usageDoc(): Data {
    return {
        month: '2026-10',
        computeUnits: 12.5,
        computeUnitBudget: 100,
        uploadedMb: 300,
        publishes: 2,
        studioUploads: 0,
        ...systemStamp('pipeline'),
    };
}

export function opsGuardDoc(): Data {
    return {
        state: 'green',
        since: past(),
        lastTick: { ranAt: past(), steps: [{ step: 'guard', ok: true }] },
        lastNightlyAt: past(),
        ...systemStamp('ops'),
    };
}

export function manifestStateDoc(cityId: string): Data {
    return {
        requestedVersion: 3,
        builtVersion: 3,
        status: 'idle',
        builtAt: past(),
        url: publicObjectUrl(PUBLIC_BUCKET, STORAGE_PATHS.manifest(cityId)),
        sha256: SHA,
        bytes: 1234,
        counts: { layers: 1, photos: 2, pois: 1, poiCategories: 1 },
        skipped: [],
        ...systemStamp('publish'),
    };
}

/** One valid new value for every field an admin may update (the stamp aside), per collection. */
export const EDITS: Readonly<Record<ClientCollection, Readonly<Data>>> = {
    city: {
        name: { ro: 'Bucureștiul dispărut' },
        bounds: { west: 25.8, south: 44.2, east: 26.4, north: 44.7 },
        center: { lat: 44.44, lng: 26.11 },
        zoom: 13,
        minZoom: 9,
        maxZoom: 19,
        about: { ro: 'Despre.' },
        privacy: { ro: 'Date personale.', en: 'Personal data.' },
        credits: [],
        theme: theme('#336699'),
        basemap: { style: 'https://example.org/styles/historic.json' },
        photosOverlay: { defaultOpacity: 0.5 },
        published: false,
    },
    photo: {
        title: { ro: 'Calea Victoriei' },
        description: { ro: 'Vedere spre sud.' },
        year: 1936,
        yearEnd: 1941,
        dateText: { ro: 'Vara lui 1936' },
        author: 'Necunoscut',
        license: 'CC0',
        rightsHolder: 'Arhiva Națională',
        sourceUrl: 'https://example.org/foto/2',
        sourceLabel: 'Arhiva Națională',
        permissionNote: 'Domeniu public.',
        legacyId: 'legacy-2',
        links: links(5),
        location: { lat: 44.3 - 0.5, lng: 26.3 + 0.5 },
        bearing: 0,
        fov: 1,
        published: true,
        rightsReview: true,
    },
    layer: {
        label: { ro: 'București, 1966' },
        description: { ro: 'Corona KH-4A.' },
        attribution: 'USGS',
        year: 1967,
        date: '1967-05-31',
        order: 2,
        opacity: 0,
        defaultVisible: false,
        adjustments: { brightnessMin: 0, brightnessMax: 1, contrast: -1, saturation: 1 },
        published: false,
    },
    poi: {
        category: 'strazi',
        geometry: { type: 'LineString', points: line(500) },
        title: { ro: 'Strada Sfinților' },
        description: { ro: 'O [sursă](https://example.org).' },
        yearStart: 1900,
        yearEnd: 1980,
        links: links(5),
        photoIds: Array.from({ length: 20 }, (_, index) => `p${String(index)}`),
        published: false,
    },
    poiCategory: { label: { ro: 'Biserici', en: 'Churches' }, icon: 'mosque', color: '#aa00ff', defaultOpacity: 0, order: -1 },
    job: { cancelRequested: true },
    usgsScene: { status: 'rejected', note: 'Nori peste oraș.' },
};

/** The fields of a collection's client update other than the stamp (what `EDITS` must cover). */
export function editableFields(collection: ClientCollection): string[] {
    return CLIENT_WRITES[collection].update.filter((field) => field !== 'updatedBy' && field !== 'updatedAt');
}
