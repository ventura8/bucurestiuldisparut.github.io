/**
 * A city's imagery settings (`cities/{city}.imagery`, `docs/research/M3-interfaces.md` §5): whether a georeferenced
 * scene goes to the public map on its own when its checkpoint error is small enough, that threshold, and the years the
 * city most wants historical layers of (the ranking's "target years"). A leaf module: `firestore.ts` imports it for the
 * city document, so it imports nothing of the document schemas.
 */
import { z } from 'zod';

import { coded, yearSchema } from './primitives.js';

/**
 * The checkpoint RMSE, in metres on the ground, under which a georeferenced scene is published without anyone's click
 * (about a street's width: KH-4A frames resolve about 2.75 m, KH-9 mapping frames 6 to 9 m).
 */
export const DEFAULT_RMSE_THRESHOLD_M = 15;

/** The bounds an admin may set the threshold to. */
export const RMSE_THRESHOLD_RANGE = { min: 1, max: 200 } as const;

/** At most this many target years per city. */
export const MAX_TARGET_YEARS = 20;

/**
 * `cities/{city}.imagery`. Every field is optional in the document: an absent field takes its default
 * ({@link imagerySettingsOf}), so a city created before M3 needs no migration.
 */
export const cityImagerySchema = z.strictObject({
    /** True (the default): a version under the threshold is approved and published without a click. */
    autoPublish: z.boolean().optional(),
    rmseThresholdM: z.number().min(RMSE_THRESHOLD_RANGE.min).max(RMSE_THRESHOLD_RANGE.max).optional(),
    /** The years the city wants first (București: 1966, 1976, 1977, 1978, 1980); distinct, any order. */
    targetYears: z
        .array(yearSchema)
        .max(MAX_TARGET_YEARS)
        .refine((years) => new Set(years).size === years.length, coded('validation.duplicateId'))
        .optional(),
});

export type CityImagery = z.infer<typeof cityImagerySchema>;

/** The settings with every default applied. */
export interface ImagerySettings {
    readonly autoPublish: boolean;
    readonly rmseThresholdM: number;
    readonly targetYears: readonly number[];
}

/** A city's settings with the defaults filled in (`autoPublish` true, {@link DEFAULT_RMSE_THRESHOLD_M}, no target years). */
export function imagerySettingsOf(imagery: CityImagery | undefined): ImagerySettings {
    const set: CityImagery = imagery ?? {};
    return {
        autoPublish: set.autoPublish ?? true,
        rmseThresholdM: set.rmseThresholdM ?? DEFAULT_RMSE_THRESHOLD_M,
        targetYears: set.targetYears ?? [],
    };
}
