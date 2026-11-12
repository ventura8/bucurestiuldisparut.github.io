import { fitTransform, triangleTransform, type FittedTransform } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { triangleCanvasTransform, WARP_CELLS, WARP_MAX_SIDE, warpFrame, warpTriangles } from '../../src/georef/warp.js';
import { pair } from './fixtures.js';

function fitted(): FittedTransform {
    const result = fitTransform('affine', [pair('g1', 0, 0), pair('g2', 1000, 0), pair('g3', 1000, 500), pair('g4', 0, 500)]);
    if (!result.ok) {
        throw new Error(result.reason);
    }
    return result.transform;
}

describe('the warped preview', () => {
    it('happyPath_theFrameIsTheScansBoxAtMostItsLongSideAndTwoTrianglesACell', () => {
        const transform = fitted();
        const frame = warpFrame(transform, { width: 1000, height: 500 });
        const triangles = warpTriangles(transform, frame, { width: 1000, height: 500 }, { width: 100, height: 50 });

        expect(Math.max(frame.width, frame.height)).toBe(WARP_MAX_SIDE);
        expect(frame.width).toBeGreaterThan(frame.height);
        expect(triangles).toHaveLength(WARP_CELLS * WARP_CELLS * 2);
        const [a, , , d, e, f] = triangles[0]?.transform ?? [];
        expect(a).toBeCloseTo(frame.width / 100, 3);
        expect([d, e, f].map((value) => Math.round((value ?? 0) * 1000) / 1000)).toEqual([frame.height / 50, 0, 0]);
    });

    it('badPath_aFitThatPutsEverythingOnOnePixelDrawsNothing', () => {
        const transform = fitted();
        const flat: FittedTransform = { ...transform, toPixel: () => ({ x: 5, y: 5 }) };

        expect(
            warpTriangles(
                flat,
                warpFrame(transform, { width: 1000, height: 500 }),
                { width: 1000, height: 500 },
                { width: 100, height: 50 },
            ),
        ).toEqual([]);
    });

    it('happyPath_theClosedFormTriangleIsSharedsMatrixSolveAndAFlatOneIsNone', () => {
        const from = [
            { x: 3, y: 4 },
            { x: 120, y: 9 },
            { x: 15, y: 210 },
        ] as const;
        const to = [
            { x: 40, y: -2 },
            { x: 300, y: 50 },
            { x: -20, y: 400 },
        ] as const;
        const solved = triangleTransform(from, to) ?? [];
        const closed = triangleCanvasTransform(from, to) ?? [];

        expect(closed).toHaveLength(6);
        closed.forEach((value, index) => {
            expect(value).toBeCloseTo(solved[index] ?? Number.NaN, 9);
        });
        expect(triangleCanvasTransform([from[0], from[0], from[1]], to)).toBeNull();
    });
});
