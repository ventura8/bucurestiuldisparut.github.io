import { pmtilesArchive, rangeResponse, type ArchiveTile } from '@hcm/test-support/pmtiles';
import type { Page, Route } from '@playwright/test';
import sharp from 'sharp';

import type { Rgb } from '../fixtures/world.js';

/**
 * A historical layer's archive in the e2e world (docs/research/M12-own-tiles.md): real PMTiles v3 with real WebP tiles of one known colour,
 * read by the real Mapbox GL JS from a page route, as the map's other colour probes read the mock tile server. No cloud, no Mapbox server.
 */

export interface SolidArchive {
    readonly colour: Rgb;
    /** `[west, south, east, north]`: where tiles exist; anywhere else the archive has a hole. */
    readonly bounds: readonly [number, number, number, number];
    readonly minzoom: number;
    readonly maxzoom: number;
}

/** A zoom naming more tiles than this keeps the square around the middle: a test looks at one place, and the directory must stay in the first read. */
const MAX_TILES_PER_ZOOM = 400;
const TILE_SIDE = 256;

function tileX(lng: number, z: number): number {
    return Math.floor(((lng + 180) / 360) * 2 ** z);
}

function tileY(lat: number, z: number): number {
    const sin = Math.sin((lat * Math.PI) / 180);
    return Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 2 ** z);
}

function trimmed(from: number, to: number): readonly [number, number] {
    const side = Math.floor(Math.sqrt(MAX_TILES_PER_ZOOM));
    if (to - from < side) {
        return [from, to];
    }
    const start = Math.floor((from + to - side) / 2);
    return [start, start + side - 1];
}

function tilesOfZoom(z: number, [west, south, east, north]: SolidArchive['bounds'], data: Uint8Array): ArchiveTile[] {
    const [left, right] = trimmed(tileX(west, z), tileX(east, z));
    const [top, bottom] = trimmed(tileY(north, z), tileY(south, z));
    const tiles: ArchiveTile[] = [];
    for (let x = left; x <= right; x += 1) {
        for (let y = top; y <= bottom; y += 1) {
            tiles.push({ z, x, y, data });
        }
    }
    return tiles;
}

/** One real 256 px WebP, lossless so its colour reads back exact, with alpha like the pipeline's. */
export async function solidWebp(colour: Rgb): Promise<Buffer> {
    const [r, g, b] = colour;
    return sharp({ create: { width: TILE_SIDE, height: TILE_SIDE, channels: 4, background: { r, g, b, alpha: 1 } } })
        .webp({ lossless: true })
        .toBuffer();
}

/** The archive: the same picture at every tile of `bounds`, stored once. */
export async function solidArchive(spec: SolidArchive): Promise<Buffer> {
    const data = new Uint8Array(await solidWebp(spec.colour));
    const tiles: ArchiveTile[] = [];
    for (let z = spec.minzoom; z <= spec.maxzoom; z += 1) {
        tiles.push(...tilesOfZoom(z, spec.bounds, data));
    }
    return Buffer.from(await pmtilesArchive(tiles, spec));
}

/** What a page route of an archive saw. */
export interface ArchiveReads {
    /** Every `Range` header asked (null: none). */
    readonly ranges: (string | null)[];
}

/** Answers as Cloud Storage does: `206` and the range; the headers a cross-origin read needs. */
export async function fulfilRange(route: Route, archive: Uint8Array, reads: ArchiveReads): Promise<void> {
    const range = (await route.request().allHeaders())['range'] ?? null;
    reads.ranges.push(range);
    const answer = rangeResponse(archive, range);
    await route.fulfill({
        status: answer.status,
        headers: {
            'access-control-allow-origin': '*',
            'access-control-expose-headers': 'Content-Range',
            'accept-ranges': 'bytes',
            ...(answer.range === null ? {} : { 'content-range': answer.range }),
        },
        contentType: 'application/octet-stream',
        body: Buffer.from(answer.body),
    });
}

/** The page reads `url`'s archive; the reads it made are recorded. */
export async function serveArchive(page: Page, url: string | RegExp, archive: Uint8Array): Promise<ArchiveReads> {
    const reads: ArchiveReads = { ranges: [] };
    await page.route(url, (route) => fulfilRange(route, archive, reads));
    return reads;
}
