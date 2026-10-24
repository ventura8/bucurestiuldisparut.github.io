/**
 * The footprint's share of the city (`docs/research/M3-interfaces.md` §3.2): the footprint clipped to the bounds, areas
 * with longitudes scaled by the cosine of the bounds' middle latitude; and M2M rings turned into stored footprints.
 */
import { describe, expect, it } from 'vitest';

import { MAX_FOOTPRINT_VERTICES, footprintCoverage, footprintOf } from '../../src/imagery/coverage.js';

const BOUNDS = { west: 26, south: 44, east: 27, north: 45 };

function box(west: number, south: number, east: number, north: number) {
    return [
        { lat: south, lng: west },
        { lat: south, lng: east },
        { lat: north, lng: east },
        { lat: north, lng: west },
    ];
}

describe('footprintCoverage', () => {
    it('happyPath_aFrameOverTheWholeCityCoversAllOfIt', () => {
        expect(footprintCoverage(box(25, 43, 28, 46), BOUNDS)).toBeCloseTo(1, 9);
    });

    it('happyPath_aFrameOverTheWestHalfCoversHalf', () => {
        expect(footprintCoverage(box(25, 43, 26.5, 46), BOUNDS)).toBeCloseTo(0.5, 9);
    });

    it('happyPath_aFrameInsideTheCityCoversItsOwnShare', () => {
        expect(footprintCoverage(box(26.25, 44.25, 26.75, 44.75), BOUNDS)).toBeCloseTo(0.25, 9);
    });

    it('happyPath_aTriangleAcrossTheCornerIsClippedOnEverySide', () => {
        const triangle = [
            { lat: 43.5, lng: 25.5 },
            { lat: 43.5, lng: 27.5 },
            { lat: 45.5, lng: 25.5 },
        ];

        expect(footprintCoverage(triangle, BOUNDS)).toBeCloseTo(0.5, 9);
    });

    it('happyPath_theWindingDoesNotMatter', () => {
        expect(footprintCoverage(box(25, 43, 26.5, 46).toReversed(), BOUNDS)).toBeCloseTo(0.5, 9);
    });

    it('badPath_aFrameElsewhereCoversNothing', () => {
        expect(footprintCoverage(box(10, 10, 11, 11), BOUNDS)).toBe(0);
    });
});

describe('footprintOf', () => {
    it('happyPath_aClosedM2mRingBecomesAnOpenFootprintOfLatLngVertices', () => {
        const ring: [number, number][] = [
            [25.95, 44.35],
            [26.25, 44.35],
            [26.25, 44.52],
            [25.95, 44.52],
            [25.95, 44.35],
        ];

        expect(footprintOf(ring)).toEqual([
            { lat: 44.35, lng: 25.95 },
            { lat: 44.35, lng: 26.25 },
            { lat: 44.52, lng: 26.25 },
            { lat: 44.52, lng: 25.95 },
        ]);
    });

    it('happyPath_anOpenRingIsKept', () => {
        expect(
            footprintOf([
                [1, 2],
                [3, 4],
                [5, 6],
            ]),
        ).toHaveLength(3);
    });

    it('happyPath_aLongRingIsThinnedToTheLimit', () => {
        const ring = Array.from({ length: 200 }, (_, index): [number, number] => [26 + Math.cos(index / 30), 44 + Math.sin(index / 30)]);

        const footprint = footprintOf(ring);

        expect(footprint?.length).toBeLessThanOrEqual(MAX_FOOTPRINT_VERTICES);
        expect(footprint?.[0]).toEqual({ lat: 44, lng: 27 });
    });

    it.each([
        ['an empty ring', []],
        ['a single point', [[1, 2]]],
        [
            'two points and the closing one',
            [
                [1, 2],
                [3, 4],
                [1, 2],
            ],
        ],
    ])('badPath_tooFewVerticesHaveNoFootprint_%s', (_case, ring) => {
        expect(footprintOf(ring as [number, number][])).toBeUndefined();
    });
});
