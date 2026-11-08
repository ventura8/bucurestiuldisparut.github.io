/**
 * The golden documents of `pipeline/tests/contracts/` (docs/research/M3-interfaces.md §6.5): what the Python pipeline
 * writes must pass the same zod schemas every TypeScript reader validates with, and both languages must spell the same
 * object paths. The pipeline's own tests read the same files (`hcm_pipeline` serialises to exactly these).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { HEARTBEAT_SECONDS, LEASE_SECONDS, USGS_BACKOFF_MINUTES } from '../../src/api/imagery.js';
import { isApiErrorCode } from '../../src/i18n/api/index.js';
import {
    AUTO_GCP_CHECKPOINT_SHARE,
    AUTO_GCP_METHODS,
    AUTO_GCP_MIN_CONFIDENCE,
    AUTO_GCP_SUGGEST_MIN,
    AUTO_GCP_TILE_PX,
    CHECKPOINT_MIN_PAIRS,
    MATCH_CHANNELS,
    MAX_SUGGESTIONS,
} from '../../src/schemas/autogcp.js';
import {
    JOB_MACHINES,
    JOB_STATUSES,
    JOB_STEP_STATES,
    JOB_WAIT_REASONS,
    jobDocSchema,
    jobLogDocSchema,
} from '../../src/schemas/firestore-ops.js';
import {
    enabledGcps,
    GCP_ORIGINS,
    gcpSchema,
    GEOREF_TRANSFORMS,
    MAX_GCPS,
    MAX_SCAN_PIXELS,
    MIN_GCPS,
    type GeorefTransform,
} from '../../src/schemas/georef.js';
import { ALIGNMENT_MAX_PARTNERS, ALIGNMENT_STATUSES } from '../../src/schemas/imagery-calibration.js';
import { RASTER_PATHS, VERSION_FILES } from '../../src/schemas/imagery-paths.js';
import { STUDIO_MAX_BYTES } from '../../src/schemas/imagery-publish.js';
import { RECALIBRATE_MIN_CHECKS, RECALIBRATE_MIN_GAIN_M } from '../../src/schemas/imagery-recalibration.js';
import { JOIN_MAX_PARTS } from '../../src/schemas/imagery-settings.js';
import {
    DOWNLOAD_STEPS,
    JOB_PARAMS_SCHEMAS,
    JOB_STEPS,
    LAYER_VERSION_STATES,
    layerVersionDocSchema,
    PIPELINE_STEPS,
    S2_CHECK_STATUSES,
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

/**
 * Finding 62 of 2026-11-02: one document of each shape the pipeline's real writers left along every path of an import
 * (`pipeline/tests/integration/test_written_documents.py` writes the file and holds the pipeline to its shapes).
 */
const written = golden('written-documents.json') as Readonly<Record<'job' | 'version' | 'log', readonly unknown[]>>;
const WRITTEN_SCHEMAS: Readonly<Record<'job' | 'version' | 'log', z.ZodType>> = {
    job: jobDocSchema,
    version: layerVersionDocSchema,
    log: jobLogDocSchema,
};
const writtenCases = (['job', 'version', 'log'] as const).flatMap((kind) =>
    written[kind].map((document, index) => ({ kind, index, document })),
);

describe('the pipeline contract', () => {
    it('happyPath_theSharedConstantsEqualThePipelinesCopy', () => {
        const { comment, PIPELINE_ERROR_CODES: codes, ...constants } = golden('enums.json') as Readonly<Record<string, unknown>>;

        expect(typeof comment).toBe('string');
        // Every code a pipeline step fails or waits with is one the admin reads (finding 62 of 2026-11-02).
        expect((codes as readonly string[]).filter((code) => !isApiErrorCode(code))).toEqual([]);
        expect(constants).toEqual({
            JOB_STATUSES,
            JOB_WAIT_REASONS,
            JOB_STEP_STATES,
            PIPELINE_STEPS,
            DOWNLOAD_STEPS,
            JOB_MACHINES,
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
            MAX_GCPS,
            MAX_SCAN_PIXELS,
            JOIN_MAX_PARTS,
            RECALIBRATE_MIN_GAIN_M,
            RECALIBRATE_MIN_CHECKS,
            S2_CHECK_STATUSES,
            ALIGNMENT_STATUSES,
            ALIGNMENT_MAX_PARTNERS,
        });
    });

    it('happyPath_aRunningImportJobPassesTheJobSchemaAndItsParams', () => {
        const job = golden('job.usgs-import.running.json') as { readonly params: unknown; readonly steps: object };

        expect(validate(jobDocSchema, job).ok).toBe(true);
        expect(validate(JOB_PARAMS_SCHEMAS['usgs-import'], job.params).ok).toBe(true);
        expect(Object.keys(job.steps).every((step) => (JOB_STEPS['usgs-import'] as readonly string[]).includes(step))).toBe(true);
    });

    it('happyPath_aDownloadReportsItsBytesOfTheTotalOnItsStep', () => {
        const job = golden('job.usgs-import.running.json') as Readonly<Record<string, unknown>>;
        const fetching = {
            status: 'running',
            startedAt: { seconds: 1792000030, nanoseconds: 0 },
            bytes: 1_200_000_000,
            totalBytes: 3_400_000_000,
        };

        expect(validate(jobDocSchema, { ...job, step: 'fetch', progress: 0.09, steps: { fetch: fetching } }).ok).toBe(true);
        expect(validate(jobDocSchema, { ...job, steps: { fetch: { ...fetching, totalBytes: -1 } } }).ok).toBe(false);
    });

    it('happyPath_theAutomaticGcpConstantsEqualThePipelinesCopy', () => {
        const { comment, ...constants } = golden('autogcp.json') as Readonly<Record<string, unknown>>;

        expect(typeof comment).toBe('string');
        expect(constants).toEqual({
            AUTO_GCP_METHODS,
            MATCH_CHANNELS,
            AUTO_GCP_MIN_CONFIDENCE,
            AUTO_GCP_SUGGEST_MIN,
            AUTO_GCP_CHECKPOINT_SHARE,
            CHECKPOINT_MIN_PAIRS,
            MAX_SUGGESTIONS,
            AUTO_GCP_TILE_PX,
        });
    });

    it.each(['version.awaiting-approval.json', 'version.needs-gcps.json', 'version.needs-gcps.suggestions.json', 'version.join.json'])(
        'happyPath_%s passes the version schema',
        (name) => {
            const result = validate(layerVersionDocSchema, golden(name));

            expect(result.ok ? [] : result.issues).toEqual([]);
        },
    );

    it('happyPath_suggestionsStayBelowTheConfidenceTheFitTakes', () => {
        const version = golden('version.needs-gcps.suggestions.json') as {
            readonly suggestions: { readonly pairs: readonly { readonly score: number }[] };
        };

        expect(version.suggestions.pairs.every((pair) => pair.score >= AUTO_GCP_SUGGEST_MIN && pair.score < AUTO_GCP_MIN_CONFIDENCE)).toBe(
            true,
        );
    });

    it('happyPath_thePipelineWroteEveryKindOfDocument', () => {
        expect(writtenCases.filter(({ kind }) => kind === 'version').length).toBeGreaterThan(5);
        expect(new Set(writtenCases.map(({ kind }) => kind))).toEqual(new Set(['job', 'version', 'log']));
    });

    it.each(writtenCases)('happyPath_the written $kind document $index passes its schema', ({ kind, document }) => {
        const result = validate(WRITTEN_SCHEMAS[kind], document);

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
