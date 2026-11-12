/**
 * M22 (`docs/research/M22-help-calibrate.md`): what Help calibrate reads and writes on an archive series' version.
 *
 * - `help.stitched` (§4.1, the pipeline): the series' sheets, pages or pieces joined into one picture, the preview the wizard lays over
 *   the map, with the parts left out and why, and the joins' quality.
 */
import { z } from 'zod';

import { plainText } from './primitives.js';

/** How the parts were joined: a grid's names and frames, an atlas's edges or overlaps, pieces' overlaps, one map alone, or the parts laid on
 * the archive's complete overview map (harti.zip, 2026-11-12). */
export const STITCH_METHODS = ['grid', 'atlas', 'pieces', 'single', 'overview'] as const;

/** Why a part is not in the stitched picture: no frame on the sheet, or no edge or overlap shared with the others. */
export const LEFT_OUT_REASONS = ['no-frame', 'no-join'] as const;

/** The stitched picture's long side at most (the georeferencer's preview size). */
export const STITCHED_PREVIEW_MAX_PX = 4096;

export const stitchedSchema = z.strictObject({
    previewPath: z.string().min(1).max(500),
    /** Preview pixels per stitched pixel (at most 1): a point's preview position is `pixel × previewScale`. */
    previewScale: z.number().positive().max(1),
    width: z.number().int().min(1).max(100_000),
    height: z.number().int().min(1).max(100_000),
    method: z.enum(STITCH_METHODS),
    parts: z.number().int().min(1),
    joined: z.number().int().min(0),
    leftOut: z.array(z.strictObject({ name: plainText(200), reason: z.enum(LEFT_OUT_REASONS) })).max(200),
    leftOutCount: z.number().int().min(0),
    /** Ground metres per stitched pixel when known (a grid's mosaic). */
    metresPerPx: z.number().positive().optional(),
    joins: z.strictObject({ links: z.number().int().min(0), meanInliers: z.number().min(0), rmsPx: z.number().min(0) }).optional(),
});

export type Stitched = z.infer<typeof stitchedSchema>;
