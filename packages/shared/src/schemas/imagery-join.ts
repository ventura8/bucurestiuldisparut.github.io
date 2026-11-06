/**
 * M8 (`docs/research/M8-join-interfaces.md` §2): one date's frames joined into one layer. What a join version stores: its
 * source (the frames it was made from), the parameters of its `layer-join` job, and the report of what the join measured.
 * A join version has no `scan` and no `georef`, so a crop and `imagery.saveGcps` refuse it with `noScan`.
 */
import { z } from 'zod';

import { USGS_DATASETS } from './firestore.js';
import { JOIN_MAX_PARTS } from './imagery-settings.js';
import { idSchema, isoDateSchema } from './primitives.js';
import { SENSORS } from './usgs-scene.js';

/** One frame of a join: its own version and layer (its files live under them) and the scene it came from. */
export const joinPartSchema = z.strictObject({
    versionId: idSchema,
    layerId: idSchema,
    entityId: idSchema,
    dataset: z.enum(USGS_DATASETS),
    sensor: z.enum(SENSORS),
    acquisitionDate: isoDateSchema,
});

/** A join version's `source`: its frames in the order the job takes them; the first is the layer's `usgsEntityId`. */
export const joinSourceSchema = z.strictObject({
    kind: z.literal('join'),
    parts: z.array(joinPartSchema).min(2).max(JOIN_MAX_PARTS),
});

/** `layer-join`: the frames to read, and the camera (`sensorMachine` picks `xl` for KH-9). */
export const layerJoinParamsSchema = z.strictObject({
    parts: z
        .array(z.strictObject({ versionId: idSchema, layerId: idSchema }))
        .min(2)
        .max(JOIN_MAX_PARTS),
    sensor: z.enum(SENSORS),
});

/**
 * One owner boundary between two frames (`a`, `b`: entity ids). `measured`: enough samples matched to fit a correction;
 * `applied`: the held-out samples say it helped, otherwise no frame moved. The RMSEs are absent on an unmeasured seam.
 */
export const joinSeamSchema = z.strictObject({
    a: idSchema,
    b: idSchema,
    measured: z.boolean(),
    applied: z.boolean(),
    samples: z.number().int().nonnegative(),
    heldOut: z.number().int().nonnegative(),
    beforeRmseM: z.number().nonnegative().optional(),
    afterRmseM: z.number().nonnegative().optional(),
    maxShiftM: z.number().nonnegative(),
});

/** `layerVersions/{version}.join`: what the `align` and `merge` steps measured. A join closes gaps, not absolute error. */
export const joinReportSchema = z.strictObject({
    seams: z.array(joinSeamSchema),
    /** Entity ids of the frames that added under 1 % of the window. */
    omitted: z.array(idSchema),
    /** Measured on the merged alpha over the city's bounds. */
    coveragePct: z.number().min(0).max(100),
    /** The WORST frame's own checkpoint error, never pooled; absent when a frame has none. */
    checkpointRmseM: z.number().nonnegative().optional(),
    /** The LOWEST checkpoint count among the frames. */
    checkpointCount: z.number().int().nonnegative(),
    /** How far anything moved, in metres. */
    maxShiftM: z.number().nonnegative(),
});

export type JoinPart = z.infer<typeof joinPartSchema>;
export type LayerJoinParams = z.infer<typeof layerJoinParamsSchema>;
export type JoinSeam = z.infer<typeof joinSeamSchema>;
export type JoinReport = z.infer<typeof joinReportSchema>;
