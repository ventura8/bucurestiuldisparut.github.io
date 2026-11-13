/**
 * The public viewer's GA4 events (`docs/ARCHITECTURE.md` → *Field measurements*): what it sent before §76, unchanged,
 * then its field measurements. Only the viewer's field chunk imports this table, so the admin's chunk never carries it.
 */
import { z } from 'zod';

import { idSchema } from '../schemas/primitives.js';
import {
    COMMON_EVENT_PARAMS,
    CONTEXT_PARAMS,
    MAP_ERROR_KINDS,
    VIEWER_PHASES,
    countSchema,
    createFieldGuard,
    eventSchemas,
    msSchema,
    tokenSchema,
    type FieldGuard,
} from './field-events.js';

/** The time from the visitor's click to what they waited for, and whether it came (`ok`) or failed. */
const TIMING = { duration_ms: msSchema, outcome: z.enum(['ok', 'failed']), ...CONTEXT_PARAMS };

export const VIEWER_EVENT_PARAMS = {
    page_view: {},
    layer_toggle: { layer_id: idSchema, visible: z.boolean() },
    year_change: { year: z.union([z.number().int().min(-10_000).max(10_000), z.literal('today')]) },
    photo_open: { photo_id: idSchema },
    poi_open: { poi_id: idSchema },
    share: {},
    compare_open: {},
    /** A story opened (M17), by its id; the visitor's own choices of language and theme, by their value. */
    story_open: { story_id: idSchema },
    locale_change: { locale: z.enum(['ro', 'en']) },
    theme_change: { theme: z.enum(['system', 'light', 'dark']) },
    ...COMMON_EVENT_PARAMS,
    viewer_timing: { phase: z.enum(VIEWER_PHASES), duration_ms: msSchema, since_start_ms: msSchema, ...CONTEXT_PARAMS },
    manifest_error: { code: tokenSchema, retryable: z.boolean(), ...CONTEXT_PARAMS },
    /** No map: WebGL `unsupported` or `context_lost`, or the map failed to load (`webgl`, `style`, `container`). */
    map_unavailable: { reason: z.enum(['unsupported', 'context_lost', 'webgl', 'style', 'container']), ...CONTEXT_PARAMS },
    map_errors: { error_kind: z.enum(MAP_ERROR_KINDS), error_count: countSchema, ...CONTEXT_PARAMS },
    photo_timing: TIMING,
    compare_timing: TIMING,
};

export type ViewerEventName = keyof typeof VIEWER_EVENT_PARAMS;

/** One viewer page's guard. */
export function createViewerGuard(): FieldGuard {
    return createFieldGuard(eventSchemas(VIEWER_EVENT_PARAMS));
}
