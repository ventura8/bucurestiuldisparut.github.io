/**
 * The tile layout of an archive series (`docs/research/M20-import-local.md` §16, `docs/research/M22-help-calibrate.md` §13.3): where the
 * pipeline put each sheet, page or piece, how well the seams between neighbours agree, and the owner's answer from the tile-import
 * wizard (`#/help/{versionId}/tiles`).
 *
 * - `help.stitched.layout` (Firestore, small): the grid's size, the layout's revision, the series' quality and its weakest seams.
 * - `layout.json` (a version file, `VERSION_FILES`): every sheet and every seam (`layoutFileSchema`).
 * - `thumbs.jpg`: each sheet's thumbnail, as stored (no turn, no flip), in a sprite of `THUMB_CELL_PX` cells, `THUMB_SPRITE_COLS` a row;
 *   cell `i` is `sheets[i]`.
 * - `seams.jpg`: each strip of a weak seam, one sprite row per seam (`strip.row`), sheet `a`'s strip in the left `SEAM_CELL_PX` square
 *   and sheet `b`'s in the right one, each scaled uniformly into its square from the top left (`strip.a`, `strip.b`: the rectangles in
 *   the oriented sheet's pixels).
 * - `help.layoutAnswer` (Firestore, `imagery.saveLayout`): the owner's sheets and seams, which `placing/owner_layout.py` fixes.
 */
import { z } from 'zod';

import { timestampSchema, uidSchema } from './firestore-common.js';
import { plainText } from './primitives.js';

/**
 * Why a part is not in the stitched picture: no frame on the sheet, no edge or overlap shared with the others, a blank page, marked
 * "not part of this map" by the owner, or no seam found to its neighbours.
 */
export const LEFT_OUT_REASONS = ['no-frame', 'no-join', 'blank', 'not-part', 'no-seam'] as const;

/** How a seam between two neighbours stands: measured and agreeing, measured but doubtful, not found, or given by the owner. */
export const SEAM_STATES = ['strong', 'weak', 'missing', 'owner'] as const;

/** Where a sheet's cell came from: its file or folder name, the overview map, its seams, the files' order, or the owner. */
export const SHEET_SOURCES = ['name', 'overview', 'seam', 'order', 'owner'] as const;

/** A sheet's clockwise quarter turns, in degrees. */
export const SHEET_TURNS = [0, 90, 180, 270] as const;

/** The series' verdict (`placing/quality.py`): mosaicked on `good`; `check` and `poor` wait with `layout-check`. */
export const STITCH_VERDICTS = ['good', 'check', 'poor'] as const;

/** Where sheet `b` lies from sheet `a`: one cell to the right, or one cell below. */
export const SEAM_SIDES = ['right', 'below'] as const;

/** The verdict's thresholds (`good` when all hold; `placing/quality.py` reads the same figures). */
export const STITCH_GOOD_PLACED_PCT = 90;
export const STITCH_GOOD_SEAM_NCC = 0.5;
export const STITCH_GOOD_RMS_PX = 3;
/** A sheet the bundle moved more than this share of a cell from its prior makes the series `check`. */
export const STITCH_MAX_MOVE_CELL = 0.25;

/** At most this many weak seams are named in Firestore; at most this many sheets and seams in `layout.json` and in an answer. */
export const LAYOUT_WEAK_SEAMS_MAX = 200;
export const LAYOUT_SHEETS_MAX = 2000;
export const LAYOUT_SEAMS_MAX = 8000;

/** `thumbs.jpg`: square cells of this many pixels (a sheet's long side), this many a row. */
export const THUMB_CELL_PX = 128;
export const THUMB_SPRITE_COLS = 32;
/** `seams.jpg`: each strip's square, two a row (`a`, then `b`). */
export const SEAM_CELL_PX = 256;

const cellSchema = z.number().int().min(0).max(LAYOUT_SHEETS_MAX);
const sheetIndexSchema = z
    .number()
    .int()
    .min(0)
    .max(LAYOUT_SHEETS_MAX - 1);
const turnSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
const pixelSchema = z.number().min(-1_000_000).max(1_000_000);
/** A point in an oriented sheet's pixels. */
const pointSchema = z.tuple([pixelSchema, pixelSchema]);
/** A rectangle in an oriented sheet's pixels: x, y, width, height. */
const rectSchema = z.tuple([pixelSchema, pixelSchema, z.number().positive(), z.number().positive()]);

/** One matching point on each side of a seam: the pipeline's suggestion, or the owner's two clicks. */
export const seamPointsSchema = z.strictObject({ a: pointSchema, b: pointSchema });

export type SeamPoints = z.infer<typeof seamPointsSchema>;

/** The series' quality (`placing/quality.py`). */
export const stitchQualitySchema = z.strictObject({
    /** The share of the series' sheets that are placed, 0 to 100. */
    placedPct: z.number().min(0).max(100),
    /** The median normalised cross-correlation of the seams after alignment, -1 to 1. */
    seamMedian: z.number().min(-1).max(1),
    /** The seams' residual, 95th percentile, in canvas pixels. */
    seamRmsPx: z.number().min(0),
    verdict: z.enum(STITCH_VERDICTS),
});

export type StitchQuality = z.infer<typeof stitchQualitySchema>;

/** A seam as Firestore names it: its two sheets (indexes into `layout.json`'s `sheets`), the side and its score. */
export const weakSeamSchema = z.strictObject({
    a: sheetIndexSchema,
    b: sheetIndexSchema,
    side: z.enum(SEAM_SIDES),
    score: z.number().min(-1).max(1),
});

export type WeakSeam = z.infer<typeof weakSeamSchema>;

/** `help.stitched.layout`: what the wizard needs before it reads `layout.json`. */
export const stitchLayoutSchema = z.strictObject({
    rows: z.number().int().min(1).max(LAYOUT_SHEETS_MAX),
    cols: z.number().int().min(1).max(LAYOUT_SHEETS_MAX),
    /** Grows by one each time the pipeline writes a layout; an answer names the revision it was made on. */
    revision: z.number().int().min(0),
    quality: stitchQualitySchema,
    weakSeams: z.array(weakSeamSchema).max(LAYOUT_WEAK_SEAMS_MAX),
});

export type StitchLayout = z.infer<typeof stitchLayoutSchema>;

/** One sheet of `layout.json`. */
export const layoutSheetSchema = z.strictObject({
    /** The file's path inside the series (its folder and name). */
    name: plainText(500),
    row: cellSchema,
    col: cellSchema,
    turn: turnSchema,
    /** Mirrored left to right, after the turn. */
    flip: z.boolean(),
    /** Why the sheet is not in the picture; absent when it is. */
    out: z.enum(LEFT_OUT_REASONS).optional(),
    source: z.enum(SHEET_SOURCES),
    /** The oriented sheet's pixels into the canvas: a similarity `[a, b, c, d, e, f]`, `x' = a·x + b·y + c`, `y' = d·x + e·y + f`. */
    matrix: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
    /** The oriented sheet's size in pixels. */
    width: z.number().int().min(1).max(200_000),
    height: z.number().int().min(1).max(200_000),
});

export type LayoutSheet = z.infer<typeof layoutSheetSchema>;

/** One seam of `layout.json`. */
export const layoutSeamSchema = z.strictObject({
    a: sheetIndexSchema,
    b: sheetIndexSchema,
    side: z.enum(SEAM_SIDES),
    /** Where `b`'s origin lies in `a`'s oriented pixels, as measured. */
    dx: pixelSchema,
    dy: pixelSchema,
    score: z.number().min(-1).max(1),
    rmsPx: z.number().min(0),
    overlapPx: z.number().int().min(0),
    state: z.enum(SEAM_STATES),
    /** For a weak seam: one point on each side that the pipeline believes match. */
    suggestion: seamPointsSchema.optional(),
    /** For a weak seam: its row of `seams.jpg` and the two strips' rectangles. */
    strip: z
        .strictObject({
            row: z
                .number()
                .int()
                .min(0)
                .max(LAYOUT_WEAK_SEAMS_MAX - 1),
            a: rectSchema,
            b: rectSchema,
        })
        .optional(),
});

export type LayoutSeam = z.infer<typeof layoutSeamSchema>;

/** `layout.json`. */
export const layoutFileSchema = z.strictObject({
    revision: z.number().int().min(0),
    rows: z.number().int().min(1).max(LAYOUT_SHEETS_MAX),
    cols: z.number().int().min(1).max(LAYOUT_SHEETS_MAX),
    /** The canvas the matrices draw into, in pixels. */
    width: z.number().int().min(1).max(1_000_000),
    height: z.number().int().min(1).max(1_000_000),
    sheets: z.array(layoutSheetSchema).min(1).max(LAYOUT_SHEETS_MAX),
    seams: z.array(layoutSeamSchema).max(LAYOUT_SEAMS_MAX),
    quality: stitchQualitySchema,
});

export type LayoutFile = z.infer<typeof layoutFileSchema>;

/** One sheet as the owner leaves it: its cell, turn and flip, or `not-part` (the X key). */
export const ownerSheetSchema = z.strictObject({
    index: sheetIndexSchema,
    row: cellSchema,
    col: cellSchema,
    turn: turnSchema,
    flip: z.boolean(),
    out: z.literal('not-part').optional(),
});

export type OwnerSheet = z.infer<typeof ownerSheetSchema>;

/** One seam the owner answered: the suggestion accepted, or one point clicked on each side. */
export const ownerSeamSchema = z.strictObject({
    a: sheetIndexSchema,
    b: sheetIndexSchema,
    side: z.enum(SEAM_SIDES),
    points: seamPointsSchema,
});

export type OwnerSeam = z.infer<typeof ownerSeamSchema>;

/** The answer's body, as `imagery.saveLayout` takes it. */
export const layoutAnswerFields = {
    revision: z.number().int().min(0),
    sheets: z.array(ownerSheetSchema).max(LAYOUT_SHEETS_MAX),
    seams: z.array(ownerSeamSchema).max(LAYOUT_SHEETS_MAX * 2),
    /** True: make the real preview and wait again; false: go on to the stitched picture and points. */
    preview: z.boolean(),
};

/** `help.layoutAnswer`: the owner's answer, written by `imagery.saveLayout`, accepted by `imagery.acceptLayout`. */
export const layoutAnswerSchema = z.strictObject({
    ...layoutAnswerFields,
    /** The owner accepted the layout: the series goes on to points with it. */
    accepted: z.literal(true).optional(),
    by: uidSchema,
    at: timestampSchema,
});

export type LayoutAnswer = z.infer<typeof layoutAnswerSchema>;
