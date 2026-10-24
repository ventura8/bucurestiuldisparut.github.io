/**
 * What the georeferencer shows of a fitted transform (`docs/research/M3-interfaces.md` §6.2, §10.4): `fitTransform` of `@hcm/shared`
 * (the same module `imagery.saveGcps` refits with) on every change, its errors, each pair's residual, how many pairs each
 * transform still lacks (a transform without enough is disabled with the count: `S-A16-BAD-TOO-FEW-GCPS`), and whether
 * the checkpoint error is over the city's threshold (a warning naming both; Save stays allowed).
 */
import { enabledGcps, fitTransform, GEOREF_TRANSFORMS, MIN_GCPS, type FittedTransform, type Gcp, type GeorefTransform } from '@hcm/shared';

export interface FitView {
    /** Null when the fit is possible; else why not (too few enabled pairs, or a set that spans no area). */
    readonly refusal: 'too-few' | 'degenerate' | null;
    readonly fitRmseM: number | null;
    readonly checkpointRmseM: number | null;
    readonly checkpointCount: number;
    /** Ground metres by pair id. */
    readonly residuals: Readonly<Record<string, number>>;
    /** The enabled pairs each transform still needs (0: it can be chosen). */
    readonly missing: Readonly<Record<GeorefTransform, number>>;
    /** The checkpoint RMSE is over the city's threshold. */
    readonly overThreshold: boolean;
}

export interface Fitted {
    readonly view: FitView;
    /** The fitted transform (the warped preview), null when refused. */
    readonly transform: FittedTransform | null;
}

function missingOf(pairs: readonly Gcp[]): Record<GeorefTransform, number> {
    const enabled = enabledGcps(pairs);
    return Object.fromEntries(GEOREF_TRANSFORMS.map((kind) => [kind, Math.max(0, MIN_GCPS[kind] - enabled)])) as Record<
        GeorefTransform,
        number
    >;
}

export function fitOf(kind: GeorefTransform, pairs: readonly Gcp[], thresholdM: number): Fitted {
    const missing = missingOf(pairs);
    const result = fitTransform(kind, pairs);
    if (!result.ok) {
        const view = {
            refusal: result.reason,
            fitRmseM: null,
            checkpointRmseM: null,
            checkpointCount: 0,
            residuals: {},
            missing,
            overThreshold: false,
        };
        return { view, transform: null };
    }
    const { fitRmseM, checkpointRmseM, checkpointCount } = result;
    return {
        view: {
            ...{ refusal: null, fitRmseM, checkpointRmseM, checkpointCount, residuals: Object.fromEntries(result.residuals), missing },
            overThreshold: checkpointRmseM !== null && checkpointRmseM > thresholdM,
        },
        transform: result.transform,
    };
}
