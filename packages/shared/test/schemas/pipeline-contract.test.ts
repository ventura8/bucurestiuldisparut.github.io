/**
 * The golden documents of `pipeline/tests/contracts/` (docs/research/M3-interfaces.md §6.5): what the Python pipeline
 * writes must pass the same zod schemas every TypeScript reader validates with, and both languages must spell the same
 * object paths. The pipeline's own tests read the same files (`hcm_pipeline` serialises to exactly these).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HEARTBEAT_SECONDS, LEASE_SECONDS, USGS_BACKOFF_MINUTES } from '../../src/api/imagery.js';
import { JOB_STATUSES, JOB_STEP_STATES, JOB_WAIT_REASONS, jobDocSchema } from '../../src/schemas/firestore-ops.js';
import { enabledGcps, GCP_ORIGINS, gcpSchema, GEOREF_TRANSFORMS, MIN_GCPS, type GeorefTransform } from '../../src/schemas/georef.js';
import { RASTER_PATHS, VERSION_FILES } from '../../src/schemas/imagery-paths.js';
import { STUDIO_MAX_BYTES } from '../../src/schemas/imagery-publish.js';
import {
    JOB_PARAMS_SCHEMAS,
    JOB_STEPS,
    LAYER_VERSION_STATES,
    layerVersionDocSchema,
    PIPELINE_STEPS,
    SCAN_PREVIEW_MAX_PX,
} from '../../src/schemas/imagery.js';
import { SENSOR_SPECS } from '../../src/schemas/usgs-scene.js';
import { validate } from '../../src/schemas/validation.js';

const CONTRACTS = resolve(import.meta.dirname, '../../../../pipeline/tests/contracts');

function golden(name: string): unknown {
    return JSON.parse(readFileSync(resolve(CONTRACTS, name), 'utf8'));
}

type Builder = keyof typeof RASTER_PATHS;

interface PathCase {
    readonly builder: Builder;
    readonly args: readonly string[];
    readonly path?: string;
}

const paths = golden('paths.json') as { readonly built: readonly PathCase[]; readonly refused: readonly PathCase[] };

function build({ builder, args }: PathCase): string {
    const make = RASTER_PATHS[builder] as (...parts: readonly string[]) => string;
    return make(...args);
}

interface GeorefCase {
    readonly name: string;
    readonly transform: GeorefTransform;
    readonly gcps: readonly unknown[];
    readonly expect: { readonly ok: boolean; readonly reason?: string };
}

const georefCases = (golden('georef-cases.json') as { readonly cases: readonly GeorefCase[] }).cases;

describe('the pipeline contract', () => {
    it('happyPath_theSharedConstantsEqualThePipelinesCopy', () => {
        const { comment, ...constants } = golden('enums.json') as Readonly<Record<string, unknown>>;

        expect(typeof comment).toBe('string');
        expect(constants).toEqual({
            JOB_STATUSES,
            JOB_WAIT_REASONS,
            JOB_STEP_STATES,
            PIPELINE_STEPS,
            JOB_STEPS,
            LAYER_VERSION_STATES,
            GEOREF_TRANSFORMS,
            MIN_GCPS,
            GCP_ORIGINS,
            VERSION_FILES,
            LEASE_SECONDS,
            HEARTBEAT_SECONDS,
            USGS_BACKOFF_MINUTES,
            SCAN_PREVIEW_MAX_PX,
            STUDIO_MAX_BYTES,
            SENSOR_SPECS,
        });
    });

    it('happyPath_aRunningImportJobPassesTheJobSchemaAndItsParams', () => {
        const job = golden('job.usgs-import.running.json') as { readonly params: unknown; readonly steps: object };

        expect(validate(jobDocSchema, job).ok).toBe(true);
        expect(validate(JOB_PARAMS_SCHEMAS['usgs-import'], job.params).ok).toBe(true);
        expect(Object.keys(job.steps).every((step) => (JOB_STEPS['usgs-import'] as readonly string[]).includes(step))).toBe(true);
    });

    it.each(['version.awaiting-approval.json', 'version.needs-gcps.json'])('happyPath_%s passes the version schema', (name) => {
        const result = validate(layerVersionDocSchema, golden(name));

        expect(result.ok ? [] : result.issues).toEqual([]);
    });

    it.each(paths.built)('happyPath_$builder builds $path', (pathCase) => {
        expect(build(pathCase)).toBe(pathCase.path);
    });

    it.each(paths.refused)('badPath_$builder refuses $args', (pathCase) => {
        expect(() => build(pathCase)).toThrow(RangeError);
    });

    it.each(georefCases)('happyPath_the $name case is well-formed and counts its enabled pairs', (georefCase) => {
        const gcps = georefCase.gcps.map((gcp) => gcpSchema.parse(gcp));
        const enough = enabledGcps(gcps) >= MIN_GCPS[georefCase.transform];

        expect(enough).toBe(georefCase.expect.reason !== 'too-few');
    });
});
