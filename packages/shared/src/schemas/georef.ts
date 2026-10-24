/**
 * Georeferencing as stored (`docs/research/M3-interfaces.md` §4.4, §6): ground control points (GCPs) that pair a pixel
 * of a scan with a place on the ground, the transform fitted through them and its errors. The georeferencer (admin),
 * `imagery.saveGcps` (functions) and the raster pipeline (`hcm_pipeline.georef`) read and write exactly this; the
 * transform mathematics live in `packages/shared/src/georef/` (TypeScript) and `hcm_pipeline` (numpy), held to the same
 * answers by the golden cases in `pipeline/tests/contracts/`.
 */
import { z } from 'zod';

import { GEOREF_METHODS } from './firestore.js';
import { coded, idSchema, latLngSchema } from './primitives.js';

/**
 * The transforms the georeferencer offers, as GDAL runs them (`gdalwarp -order 1`, `-order 2`, `-tps`): an affine fit,
 * a second-order polynomial and a thin-plate spline (exact at every enabled point).
 */
export const GEOREF_TRANSFORMS = ['affine', 'poly2', 'tps'] as const;

export type GeorefTransform = (typeof GEOREF_TRANSFORMS)[number];

/**
 * The fewest enabled pairs each transform takes: 3 fix the 6 unknowns of an affine fit, 6 the 12 of a second-order
 * polynomial; a thin-plate spline bends through every point, so it asks for 10 to be worth more than a polynomial. Below
 * the count the georeferencer disables the transform (`S-A16-BAD-TOO-FEW-GCPS`).
 */
export const MIN_GCPS: Readonly<Record<GeorefTransform, number>> = { affine: 3, poly2: 6, tps: 10 };

/** Where a pair came from: the scene's corner coordinates, the automatic matcher, or the admin. */
export const GCP_ORIGINS = ['corner', 'auto', 'manual'] as const;

export type GcpOrigin = (typeof GCP_ORIGINS)[number];

/** At most this many pairs per georeferencing (the automatic matcher keeps its best 200). */
export const MAX_GCPS = 300;

/** The largest scan side, in pixels, the pipeline keeps (a KH-9 panoramic strip cropped to a city fits). */
export const MAX_SCAN_PIXELS = 200_000;

/** A pixel of the full-resolution scan (`scan.tif`): origin at the top-left corner, x to the right, y down. */
export const pixelSchema = z.strictObject({
    x: z.number().min(0).max(MAX_SCAN_PIXELS),
    y: z.number().min(0).max(MAX_SCAN_PIXELS),
});

/** One ground control point. */
export const gcpSchema = z.strictObject({
    /** Stable across edits (`g1`, `g2`, ... or the matcher's `a017`): the residual table's row and the markers' label. */
    id: idSchema,
    pixel: pixelSchema,
    geo: latLngSchema,
    /** False: kept as a checkpoint only and left out of the fitting, so its residual is a true check. */
    enabled: z.boolean(),
    origin: z.enum(GCP_ORIGINS),
    /** The automatic matcher's confidence, 0 to 1 (absent for corner and manual pairs): the markers' colour. */
    score: z.number().min(0).max(1).optional(),
    /** Metres on the ground between `geo` and where the transform puts `pixel` (leave-one-out for an enabled pair). */
    residualM: z.number().min(0).optional(),
});

export type Gcp = z.infer<typeof gcpSchema>;

/** The pairs the fit uses. */
export function enabledGcps(gcps: readonly Gcp[]): number {
    return gcps.filter((gcp) => gcp.enabled).length;
}

function idsAreUnique(gcps: readonly Gcp[]): boolean {
    return new Set(gcps.map((gcp) => gcp.id)).size === gcps.length;
}

/**
 * A scan's georeferencing. `embedded` is an uploaded GeoTIFF's own georeference (no pairs, no measured error: it is never
 * published without a click); every other method needs at least `MIN_GCPS[transform]` enabled pairs.
 */
export const georefSchema = z
    .strictObject({
        method: z.enum(GEOREF_METHODS),
        transform: z.enum(GEOREF_TRANSFORMS),
        gcps: z.array(gcpSchema).max(MAX_GCPS).refine(idsAreUnique, coded('validation.duplicateId')),
        /** RMSE of the enabled pairs against the fitted transform (0 for a thin-plate spline). */
        fitRmseM: z.number().min(0).optional(),
        /** RMSE of the held-out checks: the disabled pairs, or leave-one-out over the enabled ones. The approval reads it. */
        checkpointRmseM: z.number().min(0).optional(),
        /** How many checks `checkpointRmseM` comes from. */
        checkpointCount: z.number().int().min(0).max(MAX_GCPS).optional(),
    })
    .refine(
        (georef) => georef.method === 'embedded' || enabledGcps(georef.gcps) >= MIN_GCPS[georef.transform],
        coded('validation.tooSmall', ['gcps']),
    );

export type Georef = z.infer<typeof georefSchema>;

/**
 * A crop polygon (a cutline) in `{lat, lng}` vertices, open (the first vertex is not repeated): what the pipeline gives
 * `gdalwarp -cutline` after closing it. At most 500 vertices (`MAX_GEOMETRY_VERTICES`).
 */
export const cropRingSchema = z.array(latLngSchema).min(3).max(500);

export type CropRing = z.infer<typeof cropRingSchema>;
