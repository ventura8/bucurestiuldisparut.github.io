/**
 * What the harvest keeps of an M2M `scene-search` record (`docs/research/M3-interfaces.md` §3.2): the frame's dates, its
 * footprint and corners, its camera, its coverage of the city, whether it is already scanned and its browse address on
 * USGS's own host. The metadata field names of the camera and the corners are **UNVERIFIED** (the fixtures define them;
 * the first real search over Bucharest proves them, §14).
 */
import {
    SENSOR_SPECS,
    footprintCoverage,
    footprintOf,
    isId,
    usgsBrowseUrlSchema,
    validate,
    type BoundsRecord,
    type Sensor,
    type UsgsDataset,
    type UsgsSceneDoc,
} from '@hcm/shared';

import type { UsgsScenes } from '../ports/usgs-scenes.js';

export type SceneRecord = Awaited<ReturnType<UsgsScenes['search']>>['records'][number];

/** The fields of a scene document that come from its record (the harvest adds the status, rank, browse and stamp). */
export type SceneFields = Pick<
    UsgsSceneDoc,
    'entityId' | 'dataset' | 'sensor' | 'acquisitionDate' | 'downloadAvailable' | 'footprint' | 'resolutionM' | 'coverage'
> &
    Partial<Pick<UsgsSceneDoc, 'displayId' | 'corners' | 'cloudCover'>>;

/** The camera field of the full metadata (UNVERIFIED name). */
const CAMERA_FIELD = 'Camera Type';

/** Each dataset's cameras by how the metadata spells them, and the camera when it says none. */
const CAMERAS: Readonly<Record<UsgsDataset, { readonly patterns: readonly (readonly [RegExp, Sensor])[]; readonly fallback: Sensor }>> = {
    corona2: {
        patterns: [
            [/KH-?4B/i, 'KH-4B'],
            [/KH-?4A/i, 'KH-4A'],
            [/KH-?4(?![A-Z])/i, 'KH-4'],
        ],
        fallback: 'KH-4A',
    },
    declassii: {
        patterns: [
            [/KH-?7/i, 'KH-7'],
            [/KH-?9/i, 'KH-9-mapping'],
        ],
        fallback: 'KH-9-mapping',
    },
    declassiii: { patterns: [], fallback: 'KH-9-pan' },
};

const CORNERS = ['nw', 'ne', 'se', 'sw'] as const;

function sensorOf(dataset: UsgsDataset, metadata: Readonly<Record<string, string>>): Sensor {
    const camera = metadata[CAMERA_FIELD] ?? '';
    const cameras = CAMERAS[dataset];
    return cameras.patterns.find(([pattern]) => pattern.test(camera))?.[1] ?? cameras.fallback;
}

/** A metadata number, or undefined when the field is missing or not a number in range. */
function coordinate(metadata: Readonly<Record<string, string>>, field: string, limit: number): number | undefined {
    const value = Number.parseFloat(metadata[field] ?? '');
    return Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined;
}

/** `NW Corner Lat dec` and `NW Corner Long dec` (UNVERIFIED names) as a vertex, or undefined. */
function corner(metadata: Readonly<Record<string, string>>, name: (typeof CORNERS)[number]) {
    const prefix = `${name.toUpperCase()} Corner`;
    const lat = coordinate(metadata, `${prefix} Lat dec`, 90);
    const lng = coordinate(metadata, `${prefix} Long dec`, 180);
    return lat === undefined || lng === undefined ? undefined : { lat, lng };
}

/** The four corners when the metadata lists every one of them. */
function cornersOf(metadata: Readonly<Record<string, string>>): UsgsSceneDoc['corners'] {
    const [nw, ne, se, sw] = CORNERS.map((name) => corner(metadata, name));
    return nw === undefined || ne === undefined || se === undefined || sw === undefined ? undefined : { nw, ne, se, sw };
}

/** USGS's `-1` (none recorded) is absent; anything else is kept within 0–100. */
function cloudOf(cloudCover: number | null): number | undefined {
    return cloudCover === null || cloudCover < 0 ? undefined : Math.min(100, cloudCover);
}

/** The browse address when it is a browse image on `ims.cr.usgs.gov` (never anything else: no fetch of data's addresses). */
export function browseSourceOf(record: Pick<SceneRecord, 'browseUrl'>): string | undefined {
    return record.browseUrl !== undefined && validate(usgsBrowseUrlSchema, record.browseUrl).ok ? record.browseUrl : undefined;
}

function displayIdOf(record: SceneRecord): string | undefined {
    return record.displayId === record.entityId || record.displayId === '' ? undefined : record.displayId.slice(0, 64);
}

/** The scene fields of `record` over a city of `bounds`, or undefined for a record the harvest skips (logged). */
export function sceneFields(record: SceneRecord, dataset: UsgsDataset, bounds: BoundsRecord): SceneFields | undefined {
    const footprint = footprintOf(record.footprint);
    if (!isId(record.entityId) || footprint === undefined) {
        return undefined;
    }
    const sensor = sensorOf(dataset, record.metadata);
    const optional = { displayId: displayIdOf(record), corners: cornersOf(record.metadata), cloudCover: cloudOf(record.cloudCover) };
    return {
        entityId: record.entityId,
        dataset,
        sensor,
        acquisitionDate: record.acquisitionDate,
        downloadAvailable: record.downloadAvailable,
        footprint,
        resolutionM: SENSOR_SPECS[sensor].resolutionM,
        coverage: footprintCoverage(footprint, bounds),
        ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
    };
}
