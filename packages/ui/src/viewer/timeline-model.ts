/**
 * The timeline's stops and the "photos near this year" filter. A stop is a year that has at least one historical
 * layer, plus `null` for "today" (no historical layer) at the end; a year without a layer snaps to the nearest stop
 * (scenario S-V04-BAD-YEAR-WITHOUT-LAYER).
 */
import { isPhotoNearYear, PHOTO_YEAR_WINDOW, type Layer, type Photo } from '@hcm/shared';

export type TimelineStop = number | null;

/** The layer years in ascending order without duplicates, then `null` ("today"). */
export function timelineStops(layers: readonly Pick<Layer, 'year'>[]): readonly TimelineStop[] {
    const years = [...new Set(layers.map((layer) => layer.year))].sort((a, b) => a - b);
    return [...years, null];
}

/** The index of the stop that shows `year`: itself, else the nearest year (the earlier one on a tie); "today" is last. */
export function stopIndex(stops: readonly TimelineStop[], year: TimelineStop): number {
    if (year === null) {
        return stops.length - 1;
    }
    let best = stops.length - 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    stops.forEach((stop, index) => {
        const distance = stop === null ? Number.POSITIVE_INFINITY : Math.abs(stop - year);
        if (distance < bestDistance) {
            best = index;
            bestDistance = distance;
        }
    });
    return best;
}

/** The photos dated within `window` years of `year`, in manifest order; none at "today" or for undated photos. */
export function photosNearYear<T extends Pick<Photo, 'year' | 'yearEnd'>>(
    photos: readonly T[],
    year: TimelineStop,
    window: number = PHOTO_YEAR_WINDOW,
): readonly T[] {
    return year === null ? [] : photos.filter((photo) => isPhotoNearYear(photo, year, window));
}
