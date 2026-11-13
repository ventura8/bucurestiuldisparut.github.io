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
 * clipped 1847 to "7"): `roomy` fits the card with every label (30 px or more between stops), `dense` fits it with every
 * other label (14 px or more), `scroll` keeps 16 px between stops, scrolls (a finger can) and fades the edge it hides.
 */
export type TimelineDensity = 'roomy' | 'dense' | 'scroll';

/** Px between two stops that leaves room for every label lying, and for half the pill and half a label standing. */
const ROOMY_GAP_PX = 30;
/** Px between two stops below which every other label would touch the next one: the track then scrolls. */
const DENSE_GAP_PX = 14;
/** Px between two stops of a scrolling track. */
export const SCROLL_GAP_PX = 16;

/** The density of a track `gapPx` apart between stops (`Infinity` with a single stop). */
export function timelineDensity(gapPx: number): TimelineDensity {
    if (gapPx >= ROOMY_GAP_PX) {
        return 'roomy';
    }
    return gapPx >= DENSE_GAP_PX ? 'dense' : 'scroll';
}

/**
 * Whether stop `at` of `count` shows its year: every one when roomy; else the first and the last always and every other
 * one between them, but not the one just before the last (it would meet the last label).
 */
export function labelShown(at: number, count: number, density: TimelineDensity): boolean {
    const last = count - 1;
    if (density === 'roomy' || at === 0 || at === last) {
        return true;
    }
    return at % 2 === 0 && at < last - 1;
}
