import { PHOTO_YEAR_WINDOW } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { labelShown, photosNearYear, stopIndex, timelineDensity, timelineStops } from '../../src/viewer/timeline-model.js';

describe('timelineStops', () => {
    it('happyPath_layerYearsAscendingWithoutDuplicatesThenToday', () => {
        expect(timelineStops([{ year: 1977 }, { year: 1966 }, { year: 1977 }])).toEqual([1966, 1977, null]);
    });

    it('badPath_noLayersLeavesOnlyToday', () => {
        expect(timelineStops([])).toEqual([null]);
    });
});

describe('stopIndex', () => {
    const stops = [1966, 1977, 1980, null];

    it('happyPath_exactYearAndToday', () => {
        expect(stopIndex(stops, 1977)).toBe(1);
        expect(stopIndex(stops, null)).toBe(3);
    });

    it('badPath_yearWithoutALayerSnapsToTheNearestStop', () => {
        expect(stopIndex(stops, 1970)).toBe(0);
        expect(stopIndex(stops, 1979)).toBe(2);
        expect(stopIndex(stops, 2050)).toBe(2);
        expect(stopIndex(stops, 1800)).toBe(0);
    });

    it('badPath_aTieKeepsTheEarlierStop', () => {
        expect(stopIndex([1960, 1970, null], 1965)).toBe(0);
    });

    it('badPath_onlyTodayOrNoStops', () => {
        expect(stopIndex([null], 1950)).toBe(0);
        expect(stopIndex([], null)).toBe(-1);
    });
});

describe('photosNearYear', () => {
    const photos = [{ id: 'a', year: 1960 }, { id: 'b', year: 1975, yearEnd: 1990 }, { id: 'c', year: 2000 }, { id: 'd' }];

    it('happyPath_yearsAndRangesWithinTheWindow', () => {
        expect(photosNearYear(photos, 1966).map((photo) => photo.id)).toEqual(['a', 'b']);
        expect(photosNearYear(photos, 1995).map((photo) => photo.id)).toEqual(['b', 'c']);
        expect(PHOTO_YEAR_WINDOW).toBe(10);
    });

    it('badPath_todayAndUndatedPhotosAreNeverNear', () => {
        expect(photosNearYear(photos, null)).toEqual([]);
        expect(photosNearYear(photos.slice(3), 1966)).toEqual([]);
    });

    it('happyPath_customWindow', () => {
        expect(photosNearYear(photos, 1966, 0)).toEqual([]);
    });
});

describe('timelineDensity and labelShown', () => {
    it('happyPath_theGapBetweenStopsPicksHowTheYearsFit', () => {
        expect(timelineDensity(Number.POSITIVE_INFINITY)).toBe('roomy');
        expect(timelineDensity(30)).toBe('roomy');
        expect(timelineDensity(29.9)).toBe('dense');
        expect(timelineDensity(14)).toBe('dense');
        expect(timelineDensity(13.9)).toBe('scroll');
    });

    it('happyPath_roomyNamesEveryYearDenseEveryOtherAndTheEnds', () => {
        const named = (count: number, density: 'roomy' | 'dense') =>
            Array.from({ length: count }, (_, at) => at).filter((at) => labelShown(at, count, density));

        expect(named(5, 'roomy')).toEqual([0, 1, 2, 3, 4]);
        expect(named(5, 'dense')).toEqual([0, 2, 4]);
    });

    it('badPath_theYearJustBeforeTheLastIsNotNamedBesideIt', () => {
        // Twenty-two stops: 20 is even, but one gap from today's label.
        const named = Array.from({ length: 22 }, (_, at) => at).filter((at) => labelShown(at, 22, 'dense'));

        expect(named.slice(-3)).toEqual([16, 18, 21]);
        expect(labelShown(1, 2, 'scroll')).toBe(true);
    });
});
