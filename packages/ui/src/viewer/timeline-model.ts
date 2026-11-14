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

/**
 * How the timeline fits its years (the Pixel Tablet, 2026-11-12: twenty-two stops 30 px apart overflowed the card and
 * clipped 1847 to "7"; the owner, 2026-11-14: "too crowded", only the years, no dots): `roomy` fits the card with every
 * year at least `SCROLL_GAP_PX` apart, `scroll` keeps exactly that gap, scrolls (a finger, a mouse's drag or wheel) and
 * fades the edge it hides. Every year is labelled in both; the track has no dots or ticks.
 */
export type TimelineDensity = 'roomy' | 'scroll';

/** Px between two stops: a comfortable gap between two four-digit labels, the minimum the track keeps. */
export const SCROLL_GAP_PX = 56;

/** The density of a track `gapPx` apart between stops (`Infinity` with a single stop). */
export function timelineDensity(gapPx: number): TimelineDensity {
    return gapPx >= SCROLL_GAP_PX ? 'roomy' : 'scroll';
}
