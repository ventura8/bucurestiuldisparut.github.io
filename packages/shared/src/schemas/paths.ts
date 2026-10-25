/**
 * Where every document and object lives (`docs/research/M2-interfaces.md` §2.4): the one place that spells a Firestore
 * or Cloud Storage path, shared by the functions, the admin, the rules tests and the e2e seeding. Builders refuse an
 * id that could leave its segment (a `/`, `..`, an empty string): they throw a `RangeError`, which is a programming
 * error, because every caller validates its input with the API schemas first.
 */
import { z } from 'zod';

import { HISTORY_ENTITIES, type HistoryEntity, type PhotoContentType } from './firestore.js';
import { isId } from './primitives.js';

/** City ids are lowercase: they name Storage folders, which `firebase/storage.rules` matches with `[a-z0-9-]{2,32}`. */
export const CITY_ID_PATTERN = /^[a-z0-9-]{2,32}$/;

export const cityIdSchema = z.string().regex(CITY_ID_PATTERN);

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const HISTORY_ENTRY_PATTERN = /^\d{13}-[A-Za-z0-9_-]{1,64}$/;

/**
 * M4: a notification event's id (`notificationEventId`): its kind, then one to four id parts separated by `~`
 * (`order.reminder~bucharest~DS1105-1071DF076~7`), so the same event always gets the same id and is written once.
 */
export const NOTIFICATION_ID_PATTERN = /^[a-z][A-Za-z.]{2,30}(?:~[A-Za-z0-9_-]{1,64}){1,4}$/;

/** M4: a push device's id: the first 32 hex digits of the SHA-256 of its FCM registration token. */
export const PUSH_DEVICE_ID_PATTERN = /^[a-f0-9]{32}$/;

/** M4: a reverse-geocoding cache cell (`geocodeCellKey`: the place rounded to 4 decimals, about 11 m). */
export const GEOCODE_KEY_PATTERN = /^[ns]\d{1,6}_[ew]\d{1,7}$/;

function isCityId(value: string): boolean {
    return CITY_ID_PATTERN.test(value);
}

function segment(value: string, valid: (candidate: string) => boolean): string {
    if (!valid(value)) {
        throw new RangeError(`not a valid path segment: ${JSON.stringify(value)}`);
    }
    return value;
}

const matching = (pattern: RegExp) => (value: string) => pattern.test(value);

const cityPath = (cityId: string): string => `cities/${segment(cityId, isCityId)}`;
const adminPath = (uid: string): string => `admins/${segment(uid, matching(UID_PATTERN))}`;
const child = (cityId: string, collection: string, id: string): string => `${cityPath(cityId)}/${collection}/${segment(id, isId)}`;

/** The subcollection of each audited entity under its city (the city itself is the `cities/{city}` document). */
const COLLECTION_OF: Readonly<Record<Exclude<HistoryEntity, 'city'>, string>> = {
    layer: 'layers',
    photo: 'photos',
    poi: 'pois',
    poiCategory: 'poiCategories',
};

/** One audited document (PLAN Addendum 3): what a history entry and `history.revert` name. */
export interface AuditedDocument {
    readonly entity: HistoryEntity;
    readonly cityId: string;
    /** The city id again for the city itself. */
    readonly entityId: string;
}

/** The Firestore path of an audited document. */
export function auditedDocumentPath(document: AuditedDocument): string {
    if (document.entity === 'city') {
        return cityPath(segment(document.entityId, (id) => id === document.cityId));
    }
    return child(document.cityId, COLLECTION_OF[document.entity], document.entityId);
}

function entityOfCollection(collection: string): HistoryEntity | undefined {
    return HISTORY_ENTITIES.find((entity) => entity !== 'city' && COLLECTION_OF[entity] === collection);
}

type Pair = readonly [string, string];
type Quad = readonly [string, string, string, string];

function isPair(parts: readonly string[]): parts is Pair {
    return parts.length === 2;
}

function isQuad(parts: readonly string[]): parts is Quad {
    return parts.length === 4;
}

function cityDocument([root, cityId]: Pair): AuditedDocument | undefined {
    return root === 'cities' && isCityId(cityId) ? { entity: 'city', cityId, entityId: cityId } : undefined;
}

function childDocument([root, cityId, collection, entityId]: Quad): AuditedDocument | undefined {
    const entity = entityOfCollection(collection);
    return root === 'cities' && isCityId(cityId) && entity !== undefined && isId(entityId) ? { entity, cityId, entityId } : undefined;
}

/** The audited document at `path`, or undefined for any other path (a history trigger's document, a revert's target). */
export function parseAuditedDocumentPath(path: string): AuditedDocument | undefined {
    const parts = path.split('/');
    if (isPair(parts)) {
        return cityDocument(parts);
    }
    return isQuad(parts) ? childDocument(parts) : undefined;
}

/** Every Firestore path of the project. */
export const FIRESTORE_PATHS = {
    /** The collection of the city documents (CR-M2-15). */
    cities: 'cities',
    city: cityPath,
    photos: (cityId: string) => `${cityPath(cityId)}/photos`,
    photo: (cityId: string, photoId: string) => child(cityId, 'photos', photoId),
    layers: (cityId: string) => `${cityPath(cityId)}/layers`,
    layer: (cityId: string, layerId: string) => child(cityId, 'layers', layerId),
    pois: (cityId: string) => `${cityPath(cityId)}/pois`,
    poi: (cityId: string, poiId: string) => child(cityId, 'pois', poiId),
    poiCategories: (cityId: string) => `${cityPath(cityId)}/poiCategories`,
    poiCategory: (cityId: string, categoryId: string) => child(cityId, 'poiCategories', categoryId),
    jobs: (cityId: string) => `${cityPath(cityId)}/jobs`,
    job: (cityId: string, jobId: string) => child(cityId, 'jobs', jobId),
    jobLogs: (cityId: string, jobId: string) => `${child(cityId, 'jobs', jobId)}/logs`,
    usgsScenes: (cityId: string) => `${cityPath(cityId)}/usgsScenes`,
    usgsScene: (cityId: string, entityId: string) => child(cityId, 'usgsScenes', entityId),
    /** M3: the layer versions (drafts on their way to a layer; `docs/research/M3-interfaces.md` §4.4). */
    layerVersions: (cityId: string) => `${cityPath(cityId)}/layerVersions`,
    layerVersion: (cityId: string, versionId: string) => child(cityId, 'layerVersions', versionId),
    /** The `history` subcollection of an audited document (`auditedDocumentPath`). */
    history: (document: AuditedDocument) => `${auditedDocumentPath(document)}/history`,
    historyEntry: (document: AuditedDocument, entryId: string) =>
        `${auditedDocumentPath(document)}/history/${segment(entryId, matching(HISTORY_ENTRY_PATTERN))}`,
    admins: 'admins',
    admin: adminPath,
    /** M4 (docs/research/M4-interfaces.md §5): each admin's inbox, one item per notification event. */
    inbox: (uid: string) => `${adminPath(uid)}/inbox`,
    inboxItem: (uid: string, eventId: string) => `${adminPath(uid)}/inbox/${segment(eventId, matching(NOTIFICATION_ID_PATTERN))}`,
    /** M4: what each admin wants pushed to their devices. */
    notifySettings: (uid: string) => `${adminPath(uid)}/notify/settings`,
    /** M4: the browsers an admin allowed to show notifications (their FCM registration tokens). */
    pushDevices: (uid: string) => `${adminPath(uid)}/pushDevices`,
    pushDevice: (uid: string, deviceId: string) => `${adminPath(uid)}/pushDevices/${segment(deviceId, matching(PUSH_DEVICE_ID_PATTERN))}`,
    /** M4: the notification events the producers write once each, fanned out to every admin's inbox. */
    notificationEvents: 'notificationEvents',
    notificationEvent: (eventId: string) => `notificationEvents/${segment(eventId, matching(NOTIFICATION_ID_PATTERN))}`,
    /** M4 (§4): the reverse-geocoding cache of `assist.suggestTitle`, one cell of about 11 m each. */
    geocodeCells: 'assistGeocodes',
    geocodeCell: (key: string) => `assistGeocodes/${segment(key, matching(GEOCODE_KEY_PATTERN))}`,
    /** M4: the Nominatim cool-down after a refusal (`ops/assist`). */
    assistState: 'ops/assist',
    invites: 'invites',
    invite: (inviteId: string) => `invites/${segment(inviteId, matching(SHA256_PATTERN))}`,
    setupStatus: 'setup/status',
    setupOwner: 'setup/owner',
    usage: (month: string) => `usage/mapbox-${segment(month, matching(MONTH_PATTERN))}`,
    /** M4: the month's Vertex AI requests, tokens and cost (`assist.translateDraft`'s monthly cap). */
    aiUsage: (month: string) => `usage/ai-${segment(month, matching(MONTH_PATTERN))}`,
    opsGuard: 'ops/guard',
    /** M3: the dispatcher's execution slots (CR-M3-47). */
    opsDispatch: 'ops/dispatch',
    /** M3: a city's last USGS harvest attempt (CR-M3-47). */
    harvestState: (cityId: string) => `ops/harvest-${segment(cityId, isCityId)}`,
    manifestStates: 'manifests',
    manifestState: (cityId: string) => `manifests/${segment(cityId, isCityId)}`,
} as const;

/** The file extension each accepted photo type is stored with. */
export const PHOTO_EXTENSIONS: Readonly<Record<PhotoContentType, string>> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/tiff': 'tif',
    'image/heic': 'heic',
    'image/heif': 'heif',
};

/** An upload's file name: a client nonce (a new one per upload: Storage never overwrites) and an image extension. */
export const UPLOAD_FILE_PATTERN = /^[A-Za-z0-9_-]{8,64}\.(?:jpe?g|png|webp|tiff?|heic|heif)$/;

export const PHOTO_VARIANTS = ['web', 'thumb'] as const;
export type PhotoVariant = (typeof PHOTO_VARIANTS)[number];

const citySegment = (cityId: string): string => segment(cityId, isCityId);
const idSegment = (id: string): string => segment(id, isId);
const shaSegment = (sha256: string): string => segment(sha256, matching(SHA256_PATTERN));

/** Every Cloud Storage object path; the comment names the bucket (`private`: `<project>.firebasestorage.app`). */
export const STORAGE_PATHS = {
    /** private, written by the admin client: `{photo}` is the id of the photo document created just before. */
    photoUpload: (cityId: string, uid: string, photoId: string, fileName: string) =>
        [
            'uploads/photos',
            citySegment(cityId),
            segment(uid, matching(UID_PATTERN)),
            idSegment(photoId),
            segment(fileName, matching(UPLOAD_FILE_PATTERN)),
        ].join('/'),
    /** private, written by `photos.onUpload`: the original, kept after the upload expires (lifecycle: 7 days). */
    photoOriginal: (cityId: string, photoId: string, sha256: string, contentType: PhotoContentType) =>
        ['originals/photos', citySegment(cityId), idSegment(photoId), `${shaSegment(sha256)}.${PHOTO_EXTENSIONS[contentType]}`].join('/'),
    /** public, immutable: content-hashed by the first 8 hex digits of the original's SHA-256. */
    photoDerivative: (cityId: string, photoId: string, sha256: string, variant: PhotoVariant) =>
        ['photos', citySegment(cityId), idSegment(photoId), shaSegment(sha256).slice(0, 8), `${variant}.webp`].join('/'),
    /** public, `Cache-Control: public, max-age=60`. */
    manifest: (cityId: string) => `cities/${citySegment(cityId)}/manifest.json`,
} as const;

/** The parts of a photo upload's path (the `photos.onUpload` trigger reads them from the finalized object's name). */
export interface PhotoUpload {
    readonly cityId: string;
    readonly uid: string;
    readonly photoId: string;
    readonly fileName: string;
}

type Sextet = readonly [string, string, string, string, string, string];

function isSextet(parts: readonly string[]): parts is Sextet {
    return parts.length === 6;
}

function validUpload(upload: PhotoUpload): boolean {
    return [isCityId(upload.cityId), UID_PATTERN.test(upload.uid), isId(upload.photoId), UPLOAD_FILE_PATTERN.test(upload.fileName)].every(
        Boolean,
    );
}

function uploadOf([uploads, photos, cityId, uid, photoId, fileName]: Sextet): PhotoUpload | undefined {
    const upload = { cityId, uid, photoId, fileName };
    return uploads === 'uploads' && photos === 'photos' && validUpload(upload) ? upload : undefined;
}

/** The photo upload at `path`, or undefined for any other object (the trigger ignores those). */
export function parsePhotoUploadPath(path: string): PhotoUpload | undefined {
    const parts = path.split('/');
    return isSextet(parts) ? uploadOf(parts) : undefined;
}

const BUCKET_PATTERN = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

/** The public https URL of an object in a public bucket (what the manifest and `image.web` carry). */
export function publicObjectUrl(bucket: string, path: string): string {
    return `https://storage.googleapis.com/${segment(bucket, matching(BUCKET_PATTERN))}/${path}`;
}
