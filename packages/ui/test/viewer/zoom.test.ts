import { describe, expect, it } from 'vitest';

import {
    MAX_SCALE,
    MIN_SCALE,
    ZOOM_RESET,
    clampOffset,
    clampScale,
    distance,
    panBy,
    pinchScale,
    wheelScale,
    zoomTo,
} from '../../src/viewer/zoom.js';

const BOX = { x: 400, y: 300 };

describe('clampScale', () => {
    it('happyPath_keepsScalesInRange', () => {
        expect(clampScale(2)).toBe(2);
        expect(clampScale(10)).toBe(MAX_SCALE);
        expect(clampScale(0.2)).toBe(MIN_SCALE);
    });

    it('badPath_nonFiniteScaleResets', () => {
        expect(clampScale(Number.NaN)).toBe(MIN_SCALE);
        expect(clampScale(Number.POSITIVE_INFINITY)).toBe(MIN_SCALE);
    });
});

describe('clampOffset', () => {
    it('happyPath_atScaleOneTheImageCannotMove', () => {
        expect(clampOffset({ x: 50, y: -50 }, 1, BOX)).toEqual({ x: 0, y: 0 });
    });

    it('badPath_offsetBeyondTheEdgeIsClamped', () => {
        expect(clampOffset({ x: 500, y: -500 }, 2, BOX)).toEqual({ x: 100, y: -75 });
    });
});

describe('zoomTo and panBy', () => {
    it('happyPath_zoomThenPanWithinTheImage', () => {
        const zoomed = zoomTo(ZOOM_RESET, 2, BOX);
        expect(zoomed.scale).toBe(2);

        const panned = panBy(zoomed, { x: 40, y: 20 }, BOX);
        expect(panned.offset).toEqual({ x: 20, y: 10 });
    });

    it('badPath_zoomingOutPullsTheOffsetBack', () => {
        const panned = panBy(zoomTo(ZOOM_RESET, 4, BOX), { x: 4000, y: 0 }, BOX);
        expect(zoomTo(panned, 1, BOX)).toEqual({ scale: 1, offset: { x: 0, y: 0 } });
    });
});

describe('gestures', () => {
    it('happyPath_wheelUpZoomsInAndDownZoomsOut', () => {
        expect(wheelScale(1, -100)).toBeGreaterThan(1);
        expect(wheelScale(2, 100)).toBeLessThan(2);
    });

    it('happyPath_pinchFollowsTheFingerSpread', () => {
        expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
        expect(pinchScale(1, 100, 250)).toBe(2.5);
    });

    it('badPath_pinchFromAZeroDistanceKeepsTheScale', () => {
        expect(pinchScale(1.5, 0, 200)).toBe(1.5);
    });
});
