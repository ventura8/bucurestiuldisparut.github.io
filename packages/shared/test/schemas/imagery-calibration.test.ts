/**
 * What `locate` measured and a pass's last proved model (`docs/research/M9-calibration.md` §2, §7): the schemas the pipeline's
 * documents must pass, and the pass's key as the pipeline's `calibrate/prior.py` spells it.
 */
import { describe, expect, it } from 'vitest';

import {
    CALIBRATION_OUTLINE_MAX,
    calibrationSchema,
    imageryPassDocSchema,
    passKeyOf,
    passPrefixOf,
} from '../../src/schemas/imagery-calibration.js';
import { FIRESTORE_PATHS } from '../../src/schemas/paths.js';
import { isId } from '../../src/schemas/primitives.js';

const MODEL = { camera: 'panoramic', rotation: 0, mirrored: false, scale: 0.946, rotationDeg: -0.17, dxM: -1765.2, dyM: 13931.4 };
const AT = { seconds: 1_792_000_000, nanoseconds: 0 };

describe('calibrationSchema', () => {
    it('happyPath_aProvedFrameAndAFrameNothingProved', () => {
        const proved = { how: 'votes', model: MODEL, votes: { agreed: 22, tiles: 196 }, tiles: { agreed: 712, tried: 946 } };
        const outline = [
            { lat: 44.3, lng: 25.9 },
            { lat: 44.3, lng: 26.3 },
            { lat: 44.6, lng: 26.3 },
        ];

        expect(calibrationSchema.safeParse({ ...proved, crossValidatedM: 16.3, coveredPct: 62, outline }).success).toBe(true);
        expect(calibrationSchema.safeParse({ how: 'none', refusal: 'no-votes', cutOrientations: 1 }).success).toBe(true);
        expect(calibrationSchema.safeParse({ how: 'points', seedPoints: 4, checksDropped: 2 }).success).toBe(true);
    });

    it.each([
        ['an unknown way', { how: 'guess' }],
        ['an unknown refusal', { how: 'none', refusal: 'tired' }],
        ['a share over the whole', { how: 'votes', coveredPct: 101 }],
        ['a negative error', { how: 'votes', crossValidatedM: -1 }],
        ['a broken count', { how: 'votes', tiles: { agreed: 1.5, tried: 2 } }],
        ['an unknown field', { how: 'votes', extra: true }],
        ['a model of another camera', { how: 'votes', model: { ...MODEL, camera: 'drone' } }],
        ['too short an outline', { how: 'votes', outline: [{ lat: 1, lng: 1 }] }],
        ['too long an outline', { how: 'votes', outline: Array.from({ length: CALIBRATION_OUTLINE_MAX + 1 }, () => ({ lat: 1, lng: 1 })) }],
    ])('badPath_%sIsRefused', (_name, value) => {
        expect(calibrationSchema.safeParse(value).success).toBe(false);
    });
});

describe('imageryPassDocSchema', () => {
    const pass = { model: MODEL, entityId: 'D3C1203-300415F006', date: '1975-08-20', updatedBy: 'system:imagery', updatedAt: AT };

    it('happyPath_aPassHoldsItsModelAndWhereItWasProved', () => {
        expect(imageryPassDocSchema.safeParse(pass).success).toBe(true);
    });

    it('badPath_aPassWithNoModelOrAnExtraField', () => {
        expect(imageryPassDocSchema.safeParse({ ...pass, model: undefined }).success).toBe(false);
        expect(imageryPassDocSchema.safeParse({ ...pass, proved: true }).success).toBe(false);
    });
});

describe('the pass of a frame', () => {
    it('happyPath_missionCameraAndDateAsThePipelineSpellsThem', () => {
        const key = passKeyOf('D3C1203-300415F006', '1975-08-20');

        expect(key).toBe('D3C1203-300415-F-1975-08-20');
        expect(isId(key)).toBe(true);
        expect(passPrefixOf('D3C1217-200510A001')).toBe('D3C1217-200510-A-');
        expect(FIRESTORE_PATHS.imageryPass('bucharest', String(key))).toBe('cities/bucharest/imageryPasses/D3C1203-300415-F-1975-08-20');
        expect(FIRESTORE_PATHS.imageryPasses('bucharest')).toBe('cities/bucharest/imageryPasses');
    });

    it('badPath_anIdOfAnotherFormHasNoPass', () => {
        expect(passKeyOf('d3c1203', '1975-08-20')).toBeUndefined();
        expect(passPrefixOf('')).toBeUndefined();
    });
});
