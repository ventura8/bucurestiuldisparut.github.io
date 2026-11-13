/**
 * The clouds a USGS browse image shows over the city (the owner's report of 2026-11-13: a bought 1964 scan was useless, all
 * cloud). Declassified records rarely carry USGS's cloud cover, so the browse copy is measured once, when it is copied
 * (`browse.ts`, the harvest's prefetch included) or first read without a measure: a grey copy at most `GREY_EDGE` pixels long,
 * each pixel placed on the ground through the frame's four corners, and the share of those inside the city's bounds that are
 * bright and flat. An estimate, worded "probably": the browse image's orientation against the corners is **UNVERIFIED** for
 * frames without corner metadata (the footprint's north-western vertex is taken as the image's top left).
 */
import { CLOUD_ESTIMATE_VERSION, type BoundsRecord, type CloudEstimate, type UsgsSceneDoc } from '@hcm/shared';

import type { GreyImage } from '../ports/image-processor.js';

/** The grey copy's long edge: 128 px is about 16,000 samples, plenty for a share, and cheap in a function. */
export const GREY_EDGE = 128;
/** A pixel at least this bright (0 to 255) can be cloud; the film's ground sits far below it on a summer frame. */
const BRIGHT = 150;
/** …and at least this far above the frame's median, so an overexposed frame is not all cloud… */
const ABOVE_MEDIAN = 60;
/** …though never brighter than this: a frame all cloud has a white median. */
const BRIGHTEST = 210;
/** …and flat: its 3 × 3 neighbourhood varies less than this (a bright road, a river's glint or the frame's edge are not cloud). */
const FLAT = 45;
/** Fewer samples inside the city than this and the frame is said to be unmeasured (it barely reaches the city). */
const MIN_SAMPLES = 24;

interface Point {
    readonly lat: number;
    readonly lng: number;
}

/** The image's corners on the ground: top left, top right, bottom right, bottom left. */
type Quad = readonly [Point, Point, Point, Point];

/** Twice the signed area of a ring in (lng, lat): negative when it turns clockwise with north up. */
function signedArea(ring: readonly Point[]): number {
    return ring.reduce((sum, point, index) => {
        const next = ring[(index + 1) % ring.length] ?? point;
        return sum + (point.lng * next.lat - next.lng * point.lat);
    }, 0);
}

/** How far towards the north-west a vertex lies (the image's top left is the frame's north-western corner). */
function northWestness(point: Point): number {
    return point.lat - point.lng * Math.cos((point.lat * Math.PI) / 180);
}

/** Four vertices in clockwise order, starting from the north-western one. */
function clockwiseFromNorthWest(points: readonly Point[]): Quad | undefined {
    const ring = signedArea(points) > 0 ? [...points].reverse() : [...points];
    const start = ring.reduce((best, point, index) => (northWestness(point) > northWestness(ring[best] ?? point) ? index : best), 0);
    const [a, b, c, d] = [0, 1, 2, 3].flatMap((step) => ring.slice((start + step) % ring.length).slice(0, 1));
    return d === undefined ? undefined : [a ?? d, b ?? d, c ?? d, d];
}

/** The frame's corners from its metadata, else its four-vertex footprint, else its footprint's box. */
export function frameQuad(scene: Pick<UsgsSceneDoc, 'corners' | 'footprint'>): Quad | undefined {
    if (scene.corners !== undefined) {
        return [scene.corners.nw, scene.corners.ne, scene.corners.se, scene.corners.sw];
    }
    if (scene.footprint.length === 4) {
        return clockwiseFromNorthWest(scene.footprint);
    }
    const lats = scene.footprint.map((point) => point.lat);
    const lngs = scene.footprint.map((point) => point.lng);
    const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    return [
        { lat: north, lng: west },
        { lat: north, lng: east },
        { lat: south, lng: east },
        { lat: south, lng: west },
    ];
}

/** The ground point of the image's fraction (`u` across, `v` down), between the four corners. */
function groundOf([topLeft, topRight, bottomRight, bottomLeft]: Quad, u: number, v: number): Point {
    const mix = (a: number, b: number, c: number, d: number): number => (1 - v) * ((1 - u) * a + u * b) + v * ((1 - u) * d + u * c);
    return {
        lat: mix(topLeft.lat, topRight.lat, bottomRight.lat, bottomLeft.lat),
        lng: mix(topLeft.lng, topRight.lng, bottomRight.lng, bottomLeft.lng),
    };
}

function inBounds(point: Point, bounds: BoundsRecord): boolean {
    return point.lat >= bounds.south && point.lat <= bounds.north && point.lng >= bounds.west && point.lng <= bounds.east;
}

function medianOf(pixels: Uint8Array): number {
    const counts = new Array<number>(256).fill(0);
    pixels.forEach((value) => {
        counts[value] = (counts[value] ?? 0) + 1;
    });
    let seen = 0;
    return counts.findIndex((count) => {
        seen += count;
        return seen * 2 >= pixels.length;
    });
}

/** The widest spread of the pixel's 3 × 3 neighbourhood (the image's edge reads as its nearest pixels). */
function spreadAt(image: GreyImage, x: number, y: number): number {
    const values: number[] = [];
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            const column = Math.min(image.width - 1, Math.max(0, x + dx));
            const row = Math.min(image.height - 1, Math.max(0, y + dy));
            values.push(image.pixels[row * image.width + column] ?? 0);
        }
    }
    return Math.max(...values) - Math.min(...values);
}

/** The city's samples of the image and how many of them look like cloud. */
function countOver(image: GreyImage, quad: Quad, bounds: BoundsRecord): { readonly samples: number; readonly cloudy: number } {
    const bright = Math.max(BRIGHT, Math.min(BRIGHTEST, medianOf(image.pixels) + ABOVE_MEDIAN));
    let samples = 0;
    let cloudy = 0;
    for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
            if (inBounds(groundOf(quad, (x + 0.5) / image.width, (y + 0.5) / image.height), bounds)) {
                samples += 1;
                const value = image.pixels[y * image.width + x] ?? 0;
                cloudy += Number(value >= bright && spreadAt(image, x, y) < FLAT);
            }
        }
    }
    return { samples, cloudy };
}

/**
 * The share of the city the browse image shows clouded, 0 to 100, or undefined when the frame has no corners to place it by or
 * reaches the city with too few pixels to say.
 */
export function estimateClouds(
    image: GreyImage,
    scene: Pick<UsgsSceneDoc, 'corners' | 'footprint'>,
    bounds: BoundsRecord,
): CloudEstimate | undefined {
    const quad = frameQuad(scene);
    if (quad === undefined) {
        return undefined;
    }
    const { samples, cloudy } = countOver(image, quad, bounds);
    return samples < MIN_SAMPLES ? undefined : { percent: Math.round((cloudy / samples) * 100), version: CLOUD_ESTIMATE_VERSION };
}
