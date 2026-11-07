/**
 * M9 (`docs/research/M9-calibration.md` §2, §7): what the pipeline measured when it looked for a frame with no landmark
 * (`layerVersionDocSchema.calibration`), and the last proved model of a pass (`cities/{city}/imageryPasses/{key}`), which
 * `imagery.onJobWrite` writes and only the pipeline reads, as the first place to look for that pass's next frame. The Python
 * twin is `hcm_pipeline/steps/locate.py`, `calibrate/prior.py`, held to these by the golden documents.
 */
import { z } from 'zod';

import { stamp } from './firestore-common.js';
import { idSchema, isoDateSchema, latLngSchema } from './primitives.js';

/** How the frame was found; `none` when nothing proved it. */
export const CALIBRATION_HOWS = ['votes', 'pass', 'points', 'matcher', 'local-ai', 'none'] as const;

export type CalibrationHow = (typeof CALIBRATION_HOWS)[number];

/** The first gate of the proof a frame failed. */
export const CALIBRATION_REFUSALS = [
    'no-votes',
    'few-inliers',
    'low-share',
    'narrow',
    'small',
    'cross-validation',
    'gross',
    'rival',
] as const;

/** At most this many vertices in a measured outline. */
export const CALIBRATION_OUTLINE_MAX = 32;

/** A frame's edge over the city, measured. */
export const measuredOutlineSchema = z.array(latLngSchema).min(3).max(CALIBRATION_OUTLINE_MAX);

const count = z.number().int().min(0);
const metres = z.number().min(0);
const percent = z.number().min(0).max(100);

/** The orientation, and the similarity from the first guess to where the frame lies, around the window's centre. */
export const calibrationModelSchema = z.strictObject({
    camera: z.enum(['panoramic', 'corners']),
    rotation: z.number().int(),
    mirrored: z.boolean(),
    scale: z.number(),
    rotationDeg: z.number(),
    dxM: z.number(),
    dyM: z.number(),
});

export const calibrationSchema = z.strictObject({
    how: z.enum(CALIBRATION_HOWS),
    model: calibrationModelSchema.optional(),
    votes: z.strictObject({ agreed: count, tiles: count }).optional(),
    /** The proof's tiles: `{agreed} of {tried}` agree. */
    tiles: z.strictObject({ agreed: count, tried: count }).optional(),
    /** Blocked 5-fold, in metres on the ground. */
    crossValidatedM: metres.optional(),
    /** The share of the city's bounds the frame reaches. */
    coveredPct: percent.optional(),
    /** How much of what the frame covers of the window the agreeing tiles span: the rest renders on the polynomial's word alone. */
    measuredPct: percent.optional(),
    /** The exposure's edge through the proved map, clipped to the city's bounds: `imagery/join.ts` prefers it to its estimate. */
    outline: measuredOutlineSchema.optional(),
    /** Checks over 100 m that were dropped from the checkpoints. */
    checksDropped: count.optional(),
    /** The admin's points that seeded the search. */
    seedPoints: count.optional(),
    /** Orientations the bounded crop lost to `MAX_SCAN_PIXELS`. */
    cutOrientations: count.optional(),
    refusal: z.enum(CALIBRATION_REFUSALS).optional(),
});

export type Calibration = z.infer<typeof calibrationSchema>;

/** `cities/{city}/imageryPasses/{key}`: server-written, read by the pipeline alone, no client rule. */
export const imageryPassDocSchema = z.strictObject({
    model: calibrationModelSchema,
    /** The frame it was proved on. */
    entityId: idSchema,
    date: isoDateSchema,
    ...stamp,
});

export type ImageryPassDoc = z.infer<typeof imageryPassDocSchema>;

/** Mission and camera letter of an entity id, its frame number left out (`D3C1203-300415F006`: `D3C1203-300415`, `F`). */
const ENTITY = /^(.+)([A-Z])\d+$/;

/** The pass's prefix of an entity id: what its frames share before their date, undefined for an id of another form. */
export function passPrefixOf(entityId: string): string | undefined {
    const found = ENTITY.exec(entityId);
    return found === null ? undefined : `${String(found[1])}-${String(found[2])}-`;
}

/** The key of a frame's pass: mission, camera letter and date, as the pipeline's `calibrate/prior.py` `pass_key` spells it. */
export function passKeyOf(entityId: string, date: string): string | undefined {
    const prefix = passPrefixOf(entityId);
    return prefix === undefined ? undefined : `${prefix}${date}`;
}
