/**
 * Manifest ↔ engine compatibility (docs/ENGINE_API.md → Versioning). Checked on the raw JSON before
 * the strict schema runs, so a manifest that uses fields of a newer engine gets the clear message
 * "this map needs engine X" instead of "unknown field".
 */
import { MANIFEST_VERSION } from './manifest.js';

const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,6})$/;

/** The three numbers of `major.minor.patch`, or null for anything else. */
export function parseVersion(version: string): readonly [number, number, number] | null {
    const match = VERSION.exec(version);
    return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative when `a` is older than `b`, 0 when equal, positive when newer; null if either is not `x.y.z`. */
export function compareVersions(a: string, b: string): number | null {
    const left = parseVersion(a);
    const right = parseVersion(b);
    if (left === null || right === null) {
        return null;
    }
    return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

export type ManifestCompat =
    | { readonly ok: true }
    | { readonly ok: false; readonly code: 'error.manifest.version' }
    | { readonly ok: false; readonly code: 'error.manifest.engineTooOld'; readonly minVersion: string };

function field(value: unknown, key: string): unknown {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, key)
        ? (value as Readonly<Record<string, unknown>>)[key]
        : undefined;
}

/**
 * Whether an engine of `engineVersion` may read `input`: its `version` must be `MANIFEST_VERSION`, and
 * `city.engine.minVersion`, when it is a valid version, must not be newer than the engine. Anything
 * else malformed is left to the schema.
 */
export function checkManifestCompat(input: unknown, engineVersion: string): ManifestCompat {
    if (field(input, 'version') !== MANIFEST_VERSION) {
        return { ok: false, code: 'error.manifest.version' };
    }
    const minVersion = field(field(field(input, 'city'), 'engine'), 'minVersion');
    if (typeof minVersion !== 'string') {
        return { ok: true };
    }
    const order = compareVersions(minVersion, engineVersion);
    return order !== null && order > 0 ? { ok: false, code: 'error.manifest.engineTooOld', minVersion } : { ok: true };
}
