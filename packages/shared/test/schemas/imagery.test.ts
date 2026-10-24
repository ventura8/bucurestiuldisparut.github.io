import { describe, expect, it } from 'vitest';

import { cityDocSchema, layerDocSchema } from '../../src/schemas/firestore.js';
import { enabledGcps, gcpSchema, georefSchema, MIN_GCPS, type Gcp } from '../../src/schemas/georef.js';
import { cityImagerySchema, DEFAULT_RMSE_THRESHOLD_M, imagerySettingsOf } from '../../src/schemas/imagery-settings.js';
import {
    JOB_PARAMS_SCHEMAS,
    JOB_STEPS,
    PIPELINE_STEPS,
    PUBLISH_STEPS,
    layerVersionDocSchema,
    runsOnPipeline,
} from '../../src/schemas/imagery.js';
import { JOB_TYPES } from '../../src/schemas/firestore-ops.js';
import { SENSOR_SPECS, SENSORS } from '../../src/schemas/usgs-scene.js';
import { validate } from '../../src/schemas/validation.js';

const now = { seconds: 1_792_000_000, nanoseconds: 0 };
const stamp = { updatedBy: 'system:pipeline', updatedAt: now };

function pair(id: string, x: number, enabled = true): Gcp {
    return { id, pixel: { x, y: x / 2 }, geo: { lat: 44.4 + x / 100_000, lng: 26 + x / 100_000 }, enabled, origin: 'manual' };
}

const gcps = [pair('g1', 0), pair('g2', 1000), pair('g3', 2000), pair('g4', 3000, false)];
const output = {
    cogPath: 'rasters/bucharest/l1/v1/cog.tif',
    cogBytes: 10,
    cogSha256: 'c'.repeat(64),
    previewPath: 'rasters/bucharest/l1/v1/preview.png',
    bounds: { west: 25.95, south: 44.33, east: 26.25, north: 44.55 },
    minzoom: 10,
    maxzoom: 16,
    areaKm2: 600,
};
const version = {
    layerId: 'l1',
    jobId: 'v1',
    origin: 'usgs',
    state: 'processing',
    label: { ro: 'KH-4A Corona, 12 iulie 1966' },
    year: 1966,
    createdBy: 'uid-owner',
    createdAt: now,
    ...stamp,
};

describe('georeferencing as stored', () => {
    it('happyPath_aFitNeedsEnoughEnabledPairsForItsTransform', () => {
        expect(enabledGcps(gcps)).toBe(3);
        expect(validate(georefSchema, { method: 'gcps', transform: 'affine', gcps }).ok).toBe(true);
        expect(validate(georefSchema, { method: 'embedded', transform: 'affine', gcps: [] }).ok).toBe(true);
        expect(MIN_GCPS).toEqual({ affine: 3, poly2: 6, tps: 10 });
    });

    it.each([
        ['too few pairs for a polynomial', { method: 'auto', transform: 'poly2', gcps }, 'gcps', 'validation.tooSmall'],
        [
            'two pairs of one id',
            { method: 'gcps', transform: 'affine', gcps: [...gcps, pair('g1', 4000)] },
            'gcps',
            'validation.duplicateId',
        ],
        [
            'a pixel past the largest scan',
            { method: 'gcps', transform: 'affine', gcps: [{ ...pair('g9', 0), pixel: { x: 300_000, y: 1 } }] },
            'gcps[0].pixel.x',
            'validation.tooBig',
        ],
    ])('badPath_%s', (_name, georef, path, code) => {
        const result = validate(georefSchema, georef);

        expect(result.ok ? [] : result.issues).toContainEqual({ path, code });
    });

    it('badPath_aPairWithAnUnknownOriginIsRefused', () => {
        expect(gcpSchema.safeParse({ ...pair('g1', 0), origin: 'guess' }).success).toBe(false);
    });
});

describe('city imagery settings', () => {
    it('happyPath_absentSettingsTakeTheirDefaults', () => {
        expect(imagerySettingsOf(undefined)).toEqual({ autoPublish: true, rmseThresholdM: DEFAULT_RMSE_THRESHOLD_M, targetYears: [] });
        expect(imagerySettingsOf({ autoPublish: false, rmseThresholdM: 8, targetYears: [1966] })).toEqual({
            autoPublish: false,
            rmseThresholdM: 8,
            targetYears: [1966],
        });
    });

    it('badPath_aRepeatedTargetYearOrAThresholdOutOfRangeIsRefused', () => {
        expect(validate(cityImagerySchema, { targetYears: [1966, 1966] })).toEqual({
            ok: false,
            issues: [{ path: 'targetYears', code: 'validation.duplicateId' }],
        });
        expect(validate(cityImagerySchema, { rmseThresholdM: 0.5 }).ok).toBe(false);
    });

    it('happyPath_theCityAndLayerDocumentsCarryTheM3Fields', () => {
        expect(cityDocSchema.shape.imagery.safeParse({ autoPublish: true }).success).toBe(true);
        expect(layerDocSchema.shape.pendingVersion.safeParse('v2').success).toBe(true);
        expect(layerDocSchema.shape.mapbox.safeParse({ tilesetId: 'u.t', origin: 'studio' }).success).toBe(true);
    });
});

describe('layer versions', () => {
    it('happyPath_eachStateCarriesWhatItNeeds', () => {
        expect(validate(layerVersionDocSchema, version).ok).toBe(true);
        expect(validate(layerVersionDocSchema, { ...version, state: 'awaiting_approval', output }).ok).toBe(true);
        expect(
            validate(layerVersionDocSchema, {
                ...version,
                state: 'failed',
                error: { code: 'apiError.imagery.noMatch', params: { pairs: '2' } },
            }).ok,
        ).toBe(true);
    });

    it.each([
        ['awaiting approval without an output', { ...version, state: 'awaiting_approval' }],
        ['published without its tileset', { ...version, state: 'published', output }],
        ['waiting for points without a scan', { ...version, state: 'needs_gcps' }],
        ['failed without a reason', { ...version, state: 'failed' }],
    ])('badPath_%s', (_name, doc) => {
        expect(validate(layerVersionDocSchema, doc)).toEqual({ ok: false, issues: [{ path: 'state', code: 'validation.required' }] });
    });

    it('badPath_anErrorThatIsNotAnApiCodeIsRefused', () => {
        expect(validate(layerVersionDocSchema, { ...version, state: 'failed', error: { code: 'it broke' } }).ok).toBe(false);
    });
});

describe('jobs', () => {
    it('happyPath_everyTypeHasItsParamsAndSteps', () => {
        const byName = (left: string, right: string): number => left.localeCompare(right);
        expect(Object.keys(JOB_PARAMS_SCHEMAS).toSorted(byName)).toEqual([...JOB_TYPES].toSorted(byName));
        expect(JOB_PARAMS_SCHEMAS['usgs-import'].safeParse({ entityId: 'DS1035', dataset: 'corona2', sensor: 'KH-4A' }).success).toBe(true);
        expect(JOB_PARAMS_SCHEMAS['geotiff-import'].safeParse({ uploadPath: 'uploads/rasters/x', replaces: false }).success).toBe(true);
        expect(JOB_PARAMS_SCHEMAS.regeoref.safeParse({ basedOn: 'v1' }).success).toBe(true);
        expect(JOB_PARAMS_SCHEMAS.republish.safeParse({ versionId: 'v1' }).success).toBe(true);
        expect(JOB_STEPS['usgs-import'].slice(-PUBLISH_STEPS.length)).toEqual(PUBLISH_STEPS);
        const known: readonly string[] = [...PIPELINE_STEPS, ...PUBLISH_STEPS];
        expect(JOB_STEPS.regeoref.every((step) => known.includes(step))).toBe(true);
    });

    it.each([
        ['usgs-import', true],
        ['geotiff-import', true],
        ['regeoref', true],
        ['republish', false],
        ['layer-delete', false],
    ] as const)('runsOnPipeline_%s', (type, expected) => {
        expect(runsOnPipeline(type)).toBe(expected);
    });

    it('badPath_paramsOfAnotherTypeAreRefused', () => {
        expect(JOB_PARAMS_SCHEMAS['usgs-import'].safeParse({ basedOn: 'v1' }).success).toBe(false);
    });
});

describe('sensors', () => {
    it('happyPath_eachSensorBelongsToADatasetWithItsZoomRange', () => {
        expect(SENSORS.map((sensor) => SENSOR_SPECS[sensor].dataset)).toEqual([
            'corona2',
            'corona2',
            'corona2',
            'declassii',
            'declassii',
            'declassiii',
        ]);
        expect(SENSOR_SPECS['KH-9-pan']).toMatchObject({ maxzoom: 17, machine: 'xl' });
        expect(SENSORS.every((sensor) => SENSOR_SPECS[sensor].minzoom < SENSOR_SPECS[sensor].maxzoom)).toBe(true);
    });
});
