/**
 * Automatic ground-control-point suggestions (M4; `docs/research/M4-interfaces.md` §2). The pipeline's `georef` step
 * matches the scan, pre-warped with the corner guess, against Sentinel-2 (CLAHE, then SIFT, or ORB where SIFT finds too
 * little, RANSAC) and against OpenStreetMap's lines (a distance field, tile by tile). A pair at or above
 * `AUTO_GCP_MIN_CONFIDENCE` joins the fit on its own (`georef.gcps`, origin `auto`, its confidence as `score`); one below
 * it is only a **suggestion** (`layerVersion.suggestions`), which the georeferencer shows and the admin accepts, rejects
 * or accepts all, and which is never saved without that click and Save. `pipeline/tests/contracts/autogcp.json` holds
 * these constants for the Python side.
 */
import { z } from 'zod';

import { timestampSchema } from './firestore-common.js';
import { gcpSchema, MAX_GCPS, type Gcp } from './georef.js';
import { coded } from './primitives.js';

/** The feature matcher that produced the suggestions: SIFT, or ORB when SIFT found too few keypoints. */
export const AUTO_GCP_METHODS = ['sift', 'orb'] as const;

/** What the scan was matched against: Sentinel-2 L2A true colour, OpenStreetMap's lines as a distance field. */
export const MATCH_CHANNELS = ['s2', 'osm'] as const;

/** From this confidence (0 to 1) a pair joins the fit without a click; below it, it is a suggestion only. */
export const AUTO_GCP_MIN_CONFIDENCE = 0.6;

/** Below this confidence a candidate is dropped, not even suggested. */
export const AUTO_GCP_SUGGEST_MIN = 0.3;

/** The share of confident pairs held out as true checkpoints (disabled) once there are at least `CHECKPOINT_MIN_PAIRS`. */
export const AUTO_GCP_CHECKPOINT_SHARE = 0.2;
export const CHECKPOINT_MIN_PAIRS = 15;

/** The suggestions kept for the georeferencer, best first. */
export const MAX_SUGGESTIONS = 100;

/** The side of a matching tile of the pre-warped scan, in reference pixels (10 m): 2.56 km. */
export const AUTO_GCP_TILE_PX = 256;

function idsAreUnique(gcps: readonly Gcp[]): boolean {
    return new Set(gcps.map((gcp) => gcp.id)).size === gcps.length;
}

/** `cities/{city}/layerVersions/{version}.suggestions`: written by the pipeline's `georef` step only. */
export const gcpSuggestionsSchema = z.strictObject({
    method: z.enum(AUTO_GCP_METHODS),
    channels: z.array(z.enum(MATCH_CHANNELS)).min(1).max(MATCH_CHANNELS.length),
    generatedAt: timestampSchema,
    /** The confidence the fit took pairs from (`AUTO_GCP_MIN_CONFIDENCE` when the run used the default). */
    minConfidence: z.number().min(0).max(1),
    /** Matching tiles that gave a pair, of the tiles tried. */
    tiles: z.strictObject({ matched: z.number().int().min(0), total: z.number().int().min(0) }),
    /**
     * Pairs below the confidence, best first: origin `auto`, `score` = the confidence, `residualM` = how far the current
     * fit puts the pixel from its place (absent without a fit), `enabled` true (what an accepted one becomes).
     */
    pairs: z.array(gcpSchema).max(MAX_SUGGESTIONS).refine(idsAreUnique, coded('validation.duplicateId')),
});

export type GcpSuggestions = z.infer<typeof gcpSuggestionsSchema>;

/** The id a suggestion gets when it joins the pairs: its own, or with a suffix when a pair already has it. */
function freeId(id: string, taken: ReadonlySet<string>): string {
    let candidate = id;
    let index = 2;
    while (taken.has(candidate)) {
        candidate = `${id.slice(0, 36)}-${String(index)}`;
        index += 1;
    }
    return candidate;
}

/**
 * The georeferencer's Accept (`ids`) and Accept all (no `ids`): the pairs with the chosen suggestions added, enabled and
 * marked `auto`, at most `MAX_GCPS` in all. A suggestion already among the pairs (the same scan pixel) is not added
 * twice. Nothing is saved until the admin's Save sends the result to `imagery.saveGcps`.
 */
export function acceptSuggestions(gcps: readonly Gcp[], suggestions: readonly Gcp[], ids?: readonly string[]): Gcp[] {
    const chosen = ids === undefined ? suggestions : suggestions.filter((suggestion) => ids.includes(suggestion.id));
    const taken = new Set(gcps.map((gcp) => gcp.id));
    const result = [...gcps];
    for (const suggestion of chosen) {
        const duplicate = result.some((gcp) => gcp.pixel.x === suggestion.pixel.x && gcp.pixel.y === suggestion.pixel.y);
        if (!duplicate && result.length < MAX_GCPS) {
            const id = freeId(suggestion.id, taken);
            taken.add(id);
            result.push({ ...suggestion, id, enabled: true, origin: 'auto' });
        }
    }
    return result;
}

/** The suggestions still to decide: not rejected (`rejected`, the page's own list) and not already among the pairs. */
export function pendingSuggestions(suggestions: readonly Gcp[], gcps: readonly Gcp[], rejected: ReadonlySet<string>): Gcp[] {
    const placed = new Set(gcps.map((gcp) => `${String(gcp.pixel.x)},${String(gcp.pixel.y)}`));
    return suggestions.filter(
        (suggestion) => !rejected.has(suggestion.id) && !placed.has(`${String(suggestion.pixel.x)},${String(suggestion.pixel.y)}`),
    );
}
