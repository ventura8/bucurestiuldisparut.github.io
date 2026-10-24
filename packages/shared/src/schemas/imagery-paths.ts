/**
 * Where the raster work lives in the private bucket (`docs/research/M3-interfaces.md` §4.6): uploads, USGS deliveries,
 * browse copies, a job's scratch files, each layer version's files and the reference cache, with the lifecycle that
 * cleans them. The raster pipeline spells the same paths (`hcm_pipeline.paths`), held equal by
 * `pipeline/tests/contracts/paths.json`. Nothing here is public: tiles live at Mapbox, previews are read by admins
 * through the Storage SDK.
 */
import { USGS_DATASETS } from './firestore.js';
import { CITY_ID_PATTERN } from './paths.js';
import { isId } from './primitives.js';

/** An uploaded raster's name: a client nonce and a TIFF extension (the bytes decide, `imagery.onRasterUpload` sniffs). */
export const RASTER_UPLOAD_FILE_PATTERN = /^[A-Za-z0-9_-]{8,64}\.tiff?$/;

/** The largest raster an admin may upload (`firebase/storage.rules`: under 8 GiB). */
export const RASTER_UPLOAD_MAX_BYTES = 8 * 1024 * 1024 * 1024;

/** A USGS delivery's file name as it arrives (`DS1105-1071DF075.tgz`): letters, digits, `_`, `.`, `-`, no `..`. */
const DELIVERY_FILE = /^\w[\w.-]{0,99}$/;

/** A scratch file of a job (`segments/a.tif`, `fetch.checkpoint.json`): one or two plain segments. */
const WORK_FILE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99})?$/;

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const REFERENCE_KEY = /^[a-f0-9]{8,64}$/;

/** The files of one layer version, by their fixed names. */
export const VERSION_FILES = [
    'scan.tif',
    'scan-preview.jpg',
    'reference-osm.png',
    'reference-s2.jpg',
    'cog.tif',
    'preview.png',
    'studio.tif',
] as const;

export type VersionFile = (typeof VERSION_FILES)[number];

/** The reference rasters the pipeline caches per city and window. */
export const REFERENCE_KINDS = ['s2', 'osm'] as const;

export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

function segment(value: string, valid: (candidate: string) => boolean): string {
    if (!valid(value) || value.includes('..')) {
        throw new RangeError(`not a valid path segment: ${JSON.stringify(value)}`);
    }
    return value;
}

const matching = (pattern: RegExp) => (value: string) => pattern.test(value);
const city = (cityId: string): string => segment(cityId, matching(CITY_ID_PATTERN));
const id = (value: string): string => segment(value, isId);
const dataset = (value: string): string => segment(value, (name) => (USGS_DATASETS as readonly string[]).includes(name));

/** Every raster object path of the private bucket. */
export const RASTER_PATHS = {
    /** Written by the admin client (Storage rules: own uid, under 8 GiB); `{upload}` is the job id the trigger creates. */
    upload: (cityId: string, uid: string, uploadId: string, fileName: string) =>
        [
            'uploads/rasters',
            city(cityId),
            segment(uid, matching(UID_PATTERN)),
            id(uploadId),
            segment(fileName, matching(RASTER_UPLOAD_FILE_PATTERN)),
        ].join('/'),
    /** A USGS delivery, shared by every city that imports the scene (lifecycle: 30 days; USGS keeps the archive). */
    usgsRaw: (datasetName: string, entityId: string, fileName: string) =>
        ['usgs-raw', dataset(datasetName), id(entityId), segment(fileName, matching(DELIVERY_FILE))].join('/'),
    /** The browse copy the admin previews (kept: a few hundred KB per scene). */
    browse: (datasetName: string, entityId: string) => `usgs-browse/${dataset(datasetName)}/${id(entityId)}.jpg`,
    /** A job's scratch files: segments, the stitched frame, checkpoints (lifecycle: 14 days). */
    work: (cityId: string, jobId: string, name: string) => ['work', city(cityId), id(jobId), segment(name, matching(WORK_FILE))].join('/'),
    /** One of a layer version's files (kept while the version is current or pending; ended versions are swept). */
    version: (cityId: string, layerId: string, versionId: string, file: VersionFile) =>
        ['rasters', city(cityId), id(layerId), id(versionId), file].join('/'),
    /** The reference cache: a Sentinel-2 window (GeoTIFF) or OSM features (GeoJSON) by window key (lifecycle: 90 days). */
    reference: (cityId: string, kind: ReferenceKind, key: string) =>
        `reference/${city(cityId)}/${kind}/${segment(key, matching(REFERENCE_KEY))}.${kind === 's2' ? 'tif' : 'geojson'}`,
} as const;

/**
 * The private bucket's lifecycle (the provisioner's `bucket-lifecycle` item applies it): age in days after which an
 * object under each prefix is deleted.
 */
export const PRIVATE_BUCKET_LIFECYCLE: readonly { readonly prefix: string; readonly days: number }[] = [
    { prefix: 'tmp/', days: 1 },
    { prefix: 'uploads/', days: 7 },
    { prefix: 'work/', days: 14 },
    { prefix: 'usgs-raw/', days: 30 },
    { prefix: 'reference/', days: 90 },
];

/** The parts of a raster upload's path (the `imagery.onRasterUpload` trigger reads them from the object's name). */
export interface RasterUpload {
    readonly cityId: string;
    readonly uid: string;
    readonly uploadId: string;
    readonly fileName: string;
}

function validRasterUpload(upload: RasterUpload): boolean {
    return [
        CITY_ID_PATTERN.test(upload.cityId),
        UID_PATTERN.test(upload.uid),
        isId(upload.uploadId),
        RASTER_UPLOAD_FILE_PATTERN.test(upload.fileName),
    ].every(Boolean);
}

type Sextet = readonly [string, string, string, string, string, string];

function isSextet(parts: readonly string[]): parts is Sextet {
    return parts.length === 6;
}

function uploadOf([uploads, rasters, cityId, uid, uploadId, fileName]: Sextet): RasterUpload | undefined {
    const upload = { cityId, uid, uploadId, fileName };
    return uploads === 'uploads' && rasters === 'rasters' && validRasterUpload(upload) ? upload : undefined;
}

/** The raster upload at `path`, or undefined for any other object. */
export function parseRasterUploadPath(path: string): RasterUpload | undefined {
    const parts = path.split('/');
    return isSextet(parts) ? uploadOf(parts) : undefined;
}
