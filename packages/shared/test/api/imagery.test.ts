import { describe, expect, it } from 'vitest';

import {
    CLOUD_RUN_JOBS,
    JOB_MAX_ATTEMPTS,
    NOT_RETRYABLE_CODES,
    PUBLISH_MAX_ATTEMPTS,
    imageryChooseRequestSchema,
    imageryProbeRequestSchema,
    imagerySaveGcpsRequestSchema,
    imagerySearchRequestSchema,
    jobRetryable,
    publishTaskSchema,
    rasterUploadMetadataSchema,
    USGS_BACKOFF_MINUTES,
} from '../../src/api/imagery.js';
import { API_ERRORS } from '../../src/api/errors.js';
import { translateApiError } from '../../src/i18n/api/index.js';
import { validate } from '../../src/schemas/validation.js';

const pair = (id: string, x: number) => ({
    id,
    pixel: { x, y: x },
    geo: { lat: 44.4, lng: 26 + x / 1e5 },
    enabled: true,
    origin: 'manual',
});

describe('imagery requests', () => {
    it('happyPath_aSearchOfOneDatasetAndAWindow', () => {
        expect(
            validate(imagerySearchRequestSchema, { cityId: 'bucharest', datasets: ['corona2'], from: '1960-01-01', to: '1980-12-31' }).ok,
        ).toBe(true);
    });

    it('badPath_aWindowThatEndsBeforeItStarts', () => {
        expect(validate(imagerySearchRequestSchema, { cityId: 'bucharest', from: '1980-01-01', to: '1960-01-01' })).toEqual({
            ok: false,
            issues: [{ path: 'to', code: 'validation.value' }],
        });
    });

    it('happyPath_pointsEnoughForTheirTransform', () => {
        const gcps = [pair('g1', 0), pair('g2', 1000), pair('g3', 2000)];

        expect(validate(imagerySaveGcpsRequestSchema, { cityId: 'bucharest', versionId: 'v1', transform: 'affine', gcps }).ok).toBe(true);
        expect(validate(imagerySaveGcpsRequestSchema, { cityId: 'bucharest', versionId: 'v1', transform: 'tps', gcps })).toEqual({
            ok: false,
            issues: [{ path: 'gcps', code: 'validation.tooSmall' }],
        });
    });

    it('badPath_aChoiceOrAPhaseNobodyKnows', () => {
        expect(imageryChooseRequestSchema.safeParse({ cityId: 'bucharest', versionId: 'v1', choice: 'later' }).success).toBe(false);
        expect(publishTaskSchema.safeParse({ cityId: 'bucharest', jobId: 'j1', phase: 'finish', poll: 0 }).success).toBe(false);
    });

    it('happyPath_aProbeTakesALinkableSource', () => {
        const source = { type: 'xyz', tiles: ['https://tiles.example.org/{z}/{x}/{y}.png'], tileSize: 256 };

        expect(imageryProbeRequestSchema.safeParse({ cityId: 'bucharest', source }).success).toBe(true);
        expect(
            imageryProbeRequestSchema.safeParse({ cityId: 'bucharest', source: { type: 'pmtiles', url: 'https://x.org/a.pmtiles' } })
                .success,
        ).toBe(false);
    });

    it('badPath_uploadMetadataIsStrict', () => {
        expect(rasterUploadMetadataSchema.safeParse({ originalName: 'Plan 1911.tif', year: '1911', layerId: 'plan-1911' }).success).toBe(
            true,
        );
        expect(rasterUploadMetadataSchema.safeParse({ year: '911' }).success).toBe(false);
        expect(rasterUploadMetadataSchema.safeParse({ owner: 'someone' }).success).toBe(false);
    });

    it('happyPath_limitsAndErrorsTheContractNames', () => {
        expect(CLOUD_RUN_JOBS).toEqual({ std: 'raster-pipeline', xl: 'raster-pipeline-xl' });
        expect(USGS_BACKOFF_MINUTES.at(-1)).toBe(720);
        expect(API_ERRORS['apiError.imagery.dailyLimit']).toEqual({ status: 'resource-exhausted', httpStatus: 429, retryable: true });
        expect(translateApiError('en', 'apiError.imagery.overBudget', { estimate: '24.5', available: '3' })).toBe(
            'Publishing would use 24.5 Mapbox compute units; 3 are left this month.',
        );
    });
});

describe('what a retry can cure (CR-M3-47)', () => {
    const failed = { status: 'failed', type: 'usgs-import', layerId: 'corona-1966' } as const;

    it('happyPath_aRunOrAPublishWithAttemptsLeftIsRetried', () => {
        expect(jobRetryable(failed)).toBe(true);
        expect(jobRetryable({ ...failed, attempt: JOB_MAX_ATTEMPTS - 1, error: { code: 'apiError.internal', message: 'x' } })).toBe(true);
        expect(jobRetryable({ ...failed, type: 'republish' })).toBe(true);
        expect(jobRetryable({ ...failed, steps: { guard: { status: 'done' } }, publishAttempts: PUBLISH_MAX_ATTEMPTS - 1 })).toBe(true);
    });

    it.each([
        ['a job that did not fail', { ...failed, status: 'running' as const }],
        ['a tileset deletion', { ...failed, type: 'layer-delete' as const }],
        ['an upload refused before any version', { ...failed, layerId: undefined }],
        ['a revoked Mapbox token', { ...failed, error: { code: NOT_RETRYABLE_CODES[0], message: 'x' } }],
        ['runs used up', { ...failed, attempt: JOB_MAX_ATTEMPTS }],
        ['publish starts used up', { ...failed, steps: { guard: { status: 'done' as const } }, publishAttempts: PUBLISH_MAX_ATTEMPTS }],
    ])('badPath_noRetry_%s', (_case, job) => {
        expect(jobRetryable(job)).toBe(false);
    });
});
