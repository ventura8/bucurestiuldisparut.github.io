/**
 * Declassified USGS scenes over a city (`cities/{city}/usgsScenes/{entityId}`, `docs/research/M3-interfaces.md` §3): what
 * the harvest keeps of an M2M `scene-search` result, the camera it came from, whether it is already scanned (free) or
 * must be ordered, its footprint, its browse copy in our bucket, and its rank with the reasons the admin reads. Written
 * by the harvest (`imagery.search`, `imagery.tick`), triaged by admins (`status`, `note`).
 */
import { z } from 'zod';

import { apiErrorCodeSchema } from '../api/errors.js';
import { stamp, timestampSchema } from './firestore-common.js';
import { USGS_DATASETS } from './firestore.js';
import { coded, idSchema, isoDateSchema, latLngSchema, plainText } from './primitives.js';

export const USGS_SCENE_STATUSES = ['candidate', 'ordered', 'available', 'imported', 'rejected'] as const;

/**
 * The cameras of the three datasets: `corona2` (Declass 1: KH-4, KH-4A, KH-4B Corona), `declassii` (Declass 2: KH-7 Gambit
 * and the KH-9 Hexagon mapping camera), `declassiii` (Declass 3: the KH-9 Hexagon panoramic camera).
 */
export const SENSORS = ['KH-4', 'KH-4A', 'KH-4B', 'KH-7', 'KH-9-mapping', 'KH-9-pan'] as const;

export type Sensor = (typeof SENSORS)[number];

export type UsgsDataset = (typeof USGS_DATASETS)[number];

export interface SensorSpec {
    readonly dataset: UsgsDataset;
    /** The name every label and attribution uses. */
    readonly name: string;
    /** Nominal ground resolution in metres (the ranking's resolution part). */
    readonly resolutionM: number;
    /** The tiles' zoom range (PLAN → *Raster pipeline*: z16 KH-4A/B, z17 KH-9 panoramic and KH-7, z15 KH-9 mapping). */
    readonly minzoom: number;
    readonly maxzoom: number;
    /** The Cloud Run job a frame needs: a KH-9 panoramic strip does not fit in 16 GiB. */
    readonly machine: 'std' | 'xl';
}

export const SENSOR_SPECS: Readonly<Record<Sensor, SensorSpec>> = {
    'KH-4': { dataset: 'corona2', name: 'KH-4 Corona', resolutionM: 7.5, minzoom: 10, maxzoom: 15, machine: 'std' },
    'KH-4A': { dataset: 'corona2', name: 'KH-4A Corona', resolutionM: 2.75, minzoom: 10, maxzoom: 16, machine: 'std' },
    'KH-4B': { dataset: 'corona2', name: 'KH-4B Corona', resolutionM: 1.8, minzoom: 10, maxzoom: 16, machine: 'std' },
    'KH-7': { dataset: 'declassii', name: 'KH-7 Gambit', resolutionM: 1.2, minzoom: 10, maxzoom: 17, machine: 'std' },
    'KH-9-mapping': {
        dataset: 'declassii',
        name: 'KH-9 Hexagon (mapping camera)',
        resolutionM: 7.5,
        minzoom: 10,
        maxzoom: 15,
        machine: 'std',
    },
    'KH-9-pan': { dataset: 'declassiii', name: 'KH-9 Hexagon', resolutionM: 1, minzoom: 10, maxzoom: 17, machine: 'xl' },
};

/** The attribution every USGS layer carries (public domain; the credit is courtesy). */
export const USGS_ATTRIBUTION = 'USGS EROS, declassified imagery (public domain)';

/** Where a browse image stands: not copied yet, copied into our bucket, or the copy failed (shown as "preview unavailable"). */
export const BROWSE_STATES = ['none', 'copied', 'failed'] as const;

/**
 * The ranking's plain-word reasons (`adminContent.imagery.reason.<code>`), most important first in `rank.reasons`:
 * `free` / `needsOrder` (already scanned, or a scan must be bought: M4), `coverage` {percent}, `targetYear` {year} /
 * `nearTargetYear` {year}, `newYear` {years} (the nearest layer is that many years away) / `sameYear` {year} (a layer of
 * that year exists) / `noLayers` (the city has no layer yet: any year is new), `cloud` {percent} / `cloudUnknown`,
 * `resolution` {metres}.
 */
export const RANK_REASONS = [
    'free',
    'needsOrder',
    'coverage',
    'targetYear',
    'nearTargetYear',
    'newYear',
    'sameYear',
    'noLayers',
    'cloud',
    'cloudUnknown',
    'resolution',
] as const;

export type RankReason = (typeof RANK_REASONS)[number];

/**
 * Bumped when the weights, the parts or the reasons change: the harvest re-ranks every scene of an older version. 2: the
 * reasons that explain a low rank come first, and a city without layers says so (CR-M3-47).
 */
export const RANKING_VERSION = 2;

/**
 * The weight of each part of the score (they add up to 100; each part is 0 to 1): free first, then how much of the city
 * the frame covers, then the city's target years, the gap to the layers it has, clouds and resolution.
 */
export const RANKING_WEIGHTS = { free: 30, coverage: 25, targetYear: 15, newYear: 10, cloud: 10, resolution: 10 } as const;

/**
 * A browse image's address at USGS (public, never signed): only `ims.cr.usgs.gov`, a browse or thumbnail path, a JPEG
 * or PNG name, no query and no `..`. The harvest fetches nothing else (no server-side request to an address from data).
 */
export const usgsBrowseUrlSchema = z
    .string()
    .max(400)
    .regex(/^https:\/\/ims\.cr\.usgs\.gov\/(?:browse|thumbnail)\/[\w./-]{1,300}\.(?:jpe?g|png|JPE?G|PNG)$/)
    .refine((url) => !url.includes('..'), coded('validation.format'));

const reasonParamsSchema = z.record(z.string().regex(/^[a-z][A-Za-z]{0,19}$/), z.string().max(40));

export const rankReasonSchema = z.strictObject({ code: z.enum(RANK_REASONS), params: reasonParamsSchema.optional() });

export type RankReasonEntry = z.infer<typeof rankReasonSchema>;

const cornersSchema = z.strictObject({ nw: latLngSchema, ne: latLngSchema, se: latLngSchema, sw: latLngSchema });

/** `cities/{city}/usgsScenes/{entityId}` (the M2M entity id is the document id). */
export const usgsSceneDocSchema = z.strictObject({
    entityId: idSchema,
    /** The frame's display id when it differs from the entity id. */
    displayId: plainText(64).optional(),
    dataset: z.enum(USGS_DATASETS),
    sensor: z.enum(SENSORS),
    acquisitionDate: isoDateSchema,
    status: z.enum(USGS_SCENE_STATUSES),
    note: plainText(1000).optional(),
    /** Already scanned: `scene-search` offers the download (free); false: it must be ordered first (M4). */
    downloadAvailable: z.boolean(),
    /** The frame's outline (`spatialCoverage`), at most 64 vertices, open. */
    footprint: z.array(latLngSchema).min(3).max(64),
    /** The four corners from the scene's metadata when M2M lists them; the corner guess falls back to the footprint. */
    corners: cornersSchema.optional(),
    /** Percent; absent when USGS records none (`-1`). */
    cloudCover: z.number().min(0).max(100).optional(),
    resolutionM: z.number().positive().max(100),
    /** The share of the city's bounds the footprint covers, 0 to 1. */
    coverage: z.number().min(0).max(1),
    browse: z.strictObject({
        state: z.enum(BROWSE_STATES),
        /** Where the harvest fetches it from (USGS's public browse address). */
        sourceUrl: usgsBrowseUrlSchema.optional(),
        /** The copy in the private bucket (`RASTER_PATHS.browse`), read by the admin with the Storage SDK. */
        path: z.string().max(300).optional(),
        error: apiErrorCodeSchema.optional(),
        checkedAt: timestampSchema.optional(),
    }),
    rank: z.strictObject({
        score: z.number().int().min(0).max(100),
        reasons: z.array(rankReasonSchema).max(RANK_REASONS.length),
        version: z.number().int().min(1),
    }),
    /** The layer its import created (reserved at Import, kept after). */
    layerId: idSchema.optional(),
    harvestedAt: timestampSchema,
    createdAt: timestampSchema.optional(),
    ...stamp,
});

export type UsgsSceneDoc = z.infer<typeof usgsSceneDocSchema>;
