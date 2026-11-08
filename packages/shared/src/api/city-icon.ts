/**
 * `cities.setIcon` (a city's editors; `docs/research/M2-interfaces.md` → *The city's tab icon*): the city's browser tab
 * icon. The request carries a PNG or a WebP as base64 (`kind: 'upload'`, at most `CITY_ICON_LIMITS.maxBase64Chars`), or
 * asks for the default (`kind: 'reset'`: the Layers panel's map glyph in the city's seed colour). The server reads the type
 * from the bytes' magic numbers (never a file name or a content type), so an SVG, a JPEG, a PDF or a renamed file is refused
 * (`apiError.cityIcon.badType`), as is one too big, too small, not square or animated; nothing changes then.
 */
import { z } from 'zod';

import { CITY_ICON_LIMITS } from '../kit/map-icon.js';
import { sha256Schema } from '../schemas/firestore-common.js';
import { cityIdSchema } from '../schemas/paths.js';
import { httpsUrlSchema } from '../schemas/primitives.js';

/** Standard base64, padded: the browser's `btoa` of the file's bytes. */
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const cityIconRequestSchema = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('upload'),
        cityId: cityIdSchema,
        image: z.string().min(4).max(CITY_ICON_LIMITS.maxBase64Chars).regex(BASE64_PATTERN),
    }),
    z.strictObject({ kind: z.literal('reset'), cityId: cityIdSchema }),
]);

export const cityIconResponseSchema = z.strictObject({
    source: z.enum(['default', 'custom']),
    /** The 180 px icon's public address (the admin's preview). */
    url: httpsUrlSchema,
    sha256: sha256Schema,
});

export type CityIconRequest = z.infer<typeof cityIconRequestSchema>;
export type CityIconResponse = z.infer<typeof cityIconResponseSchema>;
