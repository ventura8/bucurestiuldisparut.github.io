import { describe, expect, it } from 'vitest';

import { fitOf } from '../../src/georef/fit-view.js';
import { pair } from './fixtures.js';

const GRID = [pair('g1', 0, 0), pair('g2', 1000, 0), pair('g3', 1000, 800), pair('g4', 0, 800), pair('g5', 500, 400, 40)];

describe('the fit as the georeferencer shows it', () => {
    it('happyPath_theErrorsAndResidualsAndWhatEachTransformLacks', () => {
        const fitted = fitOf('affine', GRID, 100);

        expect(fitted.transform?.kind).toBe('affine');
        expect(fitted.view).toMatchObject({
            refusal: null,
            checkpointCount: 5,
            overThreshold: false,
            missing: { affine: 0, poly2: 1, tps: 5 },
        });
        expect(Object.keys(fitted.view.residuals)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5']);
        expect(fitOf('affine', GRID, 1).view.overThreshold).toBe(true);
    });

    it('badPath_tooFewPairsOrALineHaveNoFitAndNoWarning', () => {
        const few = fitOf('poly2', GRID, 15);
        const line = fitOf('affine', [pair('a', 0, 0), pair('b', 10, 10), pair('c', 20, 20)], 15);

        expect([few.view.refusal, few.transform, few.view.overThreshold]).toEqual(['too-few', null, false]);
        expect(line.view).toMatchObject({ refusal: 'degenerate', fitRmseM: null, checkpointRmseM: null, residuals: {} });
    });

    it('happyPath_exactlyThreePairsFitWithoutAnyCheckAndWarnNothing', () => {
        const fitted = fitOf('affine', GRID.slice(0, 3), 1);

        expect(fitted.view).toMatchObject({ refusal: null, checkpointRmseM: null, checkpointCount: 0, overThreshold: false });
    });
});
