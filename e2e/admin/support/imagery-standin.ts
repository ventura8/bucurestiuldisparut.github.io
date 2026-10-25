import { RASTER_PATHS, SENSOR_SPECS, type Gcp, type PipelineStep, type Sensor, type VersionFile } from '@hcm/shared';

import {
    areaKm2,
    boundsOf,
    landmarks,
    scanCorners,
    scanPixelOf,
    SCAN_PREVIEW_SCALE,
    SCAN_SIZE,
    type Bounds,
    type LatLng,
} from './imagery-geometry.js';
import { referenceOsmPng, referenceS2Jpeg, scanPreviewJpeg, smallTiff, warpedPreviewPng } from './imagery-images.js';
import type { Run } from './imagery-run.js';
import { uploadObject, type StoredObject } from './imagery-store.js';

/**
 * The stand-in's steps (docs/research/M3-interfaces.md §5.3, §13): what each pipeline step writes, played from the run's
 * script without GDAL, OpenCV, USGS or a reference service. The files are small generated images of the synthetic world
 * (imagery-images.ts) at the contract's paths; the automatic pairs are the world's landmarks through the scan's known
 * transform with a residual scaled to the scripted checkpoint RMSE, so the georeferencer opens on pairs that agree with
 * what both panes show. A step returns `stop` when the run ended there (a wait, a failure, an out-of-memory kill).
 */

export type StepResult = 'next' | 'stop';

const STUDIO_ITEM = { s2Item: 'S2B_35TMK_20250803_0_L2A', s2Date: '2025-08-03' } as const;

async function store(run: Run, file: VersionFile, bytes: Buffer, type: string): Promise<StoredObject> {
    return uploadObject(RASTER_PATHS.version(run.city, run.layerId, run.versionId, file), new Uint8Array(bytes), type);
}

function recorded(object: StoredObject): Record<string, unknown> {
    return { gcsPath: object.path, generation: object.generation, sha256: object.sha256, bytes: object.bytes };
}

/** The window the pipeline crops: the city's bounds plus 10 % (§5.4). */
function windowOf(bounds: Bounds): Bounds {
    const dx = (bounds.east - bounds.west) / 10;
    const dy = (bounds.north - bounds.south) / 10;
    return { west: bounds.west - dx, south: bounds.south - dy, east: bounds.east + dx, north: bounds.north + dy };
}

/** The reference step's images of the window (OSM lines, Sentinel-2), recorded on the version. */
async function writeReferences(run: Run): Promise<void> {
    const window = windowOf(run.bounds);
    const osm = await store(run, 'reference-osm.png', await referenceOsmPng(window), 'image/png');
    const s2 = await store(run, 'reference-s2.jpg', await referenceS2Jpeg(window), 'image/jpeg');
    await run.writeVersion({ reference: { bounds: window, osmPath: osm.path, s2Path: s2.path, ...STUDIO_ITEM } });
    await run.stepEnded('reference', 'done', recorded(s2));
}

/** `scan.tif` and its preview, recorded on the version (`locate`, `inspect`). */
async function writeScan(run: Run): Promise<StoredObject> {
    const scan = await store(run, 'scan.tif', await smallTiff(140), 'image/tiff');
    const preview = await store(run, 'scan-preview.jpg', await scanPreviewJpeg(run.bounds), 'image/jpeg');
    await run.writeVersion({
        scan: { path: scan.path, ...SCAN_SIZE, sha256: scan.sha256, previewPath: preview.path, previewScale: SCAN_PREVIEW_SCALE },
    });
    return scan;
}

function cornerGcps(run: Run): Gcp[] {
    const corners = [
        { x: 0, y: 0 },
        { x: SCAN_SIZE.width, y: 0 },
        { x: SCAN_SIZE.width, y: SCAN_SIZE.height },
        { x: 0, y: SCAN_SIZE.height },
    ];
    return scanCorners(run.bounds).map((geo, index) => ({
        id: `c${String(index + 1)}`,
        pixel: corners[index] ?? { x: 0, y: 0 },
        geo: { lat: round(geo.lat), lng: round(geo.lng) },
        enabled: true,
        origin: 'corner',
    }));
}

const round = (value: number): number => Math.round(value * 1e9) / 1e9;

/** The checkpoint RMSE the attempt measures. */
function checkpointRmse(run: Run): number {
    return run.attempt.checkpointRmseM ?? (run.attempt.outcome === 'over' ? 28.4 : 6.2);
}

/** Nine landmarks as automatic pairs: six fitted, three held out as checkpoints (the policy's minimum), offset by about the RMSE. */
function automaticGcps(run: Run): Gcp[] {
    const rmse = checkpointRmse(run);
    const picked = landmarks(run.bounds)
        .filter((_place, index) => index % 2 === 0)
        .slice(0, 9);
    return picked.map((geo: LatLng, index) => {
        const pixel = scanPixelOf(geo, run.bounds);
        const shift = ((index % 3) - 1) * (rmse / 30);
        return {
            id: `a${String(index + 1).padStart(3, '0')}`,
            pixel: {
                x: round(Math.min(SCAN_SIZE.width, Math.max(0, pixel.x + shift))),
                y: round(Math.min(SCAN_SIZE.height, Math.max(0, pixel.y - shift))),
            },
            geo: { lat: round(geo.lat), lng: round(geo.lng) },
            enabled: index < 6,
            origin: 'auto',
            score: Math.round((0.95 - index * 0.02) * 100) / 100,
            residualM: Math.round(rmse * (0.7 + (index % 4) * 0.15) * 10) / 10,
        };
    });
}

/** The suggestions' confidences (best first): one at the fit's confidence, three below it (M4 §2.3's "fewer" case). */
const SUGGESTED_SCORES = [0.66, 0.58, 0.47, 0.35] as const;

/** The landmark nearest each quarter of the scan: four places spread over it, none of the georeferencer specs' own. */
function spreadLandmarks(run: Run): LatLng[] {
    const { width, height } = SCAN_SIZE;
    const targets = [
        { x: width / 4, y: height / 4 },
        { x: (3 * width) / 4, y: height / 4 },
        { x: (3 * width) / 4, y: (3 * height) / 4 },
        { x: width / 4, y: (3 * height) / 4 },
    ];
    const places = landmarks(run.bounds);
    return targets.map((target) => {
        const distance = (place: LatLng): number => {
            const pixel = scanPixelOf(place, run.bounds);
            return Math.hypot(pixel.x - target.x, pixel.y - target.y);
        };
        return places.reduce((best, place) => (distance(place) < distance(best) ? place : best));
    });
}

/**
 * The matcher's suggestions as the pipeline writes them when it found too few confident pairs (the golden shape of
 * `pipeline/tests/contracts/version.needs-gcps.suggestions.json`): four landmarks of the synthetic world on their exact
 * pixels, best first, without residuals (there is no fit to measure them against).
 */
function suggestedPairs(run: Run): Record<string, unknown> {
    const pairs = spreadLandmarks(run).map((geo, index) => {
        const pixel = scanPixelOf(geo, run.bounds);
        return {
            id: `a${String(index + 1).padStart(3, '0')}`,
            pixel: { x: Math.round(pixel.x * 100) / 100, y: Math.round(pixel.y * 100) / 100 },
            geo: { lat: round(geo.lat), lng: round(geo.lng) },
            enabled: true,
            origin: 'auto',
            score: SUGGESTED_SCORES[index] ?? 0.3,
        };
    });
    const generatedAt = { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 };
    return { method: 'orb', channels: ['s2', 'osm'], generatedAt, minConfidence: 0.6, tiles: { matched: 9, total: 64 }, pairs };
}

function hasManualPoints(run: Run): boolean {
    const georef = run.version['georef'] as { method?: string } | undefined;
    return georef?.method === 'gcps';
}

function isEmbedded(run: Run): boolean {
    const georef = run.version['georef'] as { method?: string } | undefined;
    return georef?.method === 'embedded';
}

const STEPS: Readonly<Record<PipelineStep, (run: Run) => Promise<StepResult>>> = {
    fetch: async (run) => {
        if (run.attempt.outcome === 'maintenance') {
            await run.waitForUsgs();
            return 'stop';
        }
        const params = run.job['params'] as { dataset?: string; entityId?: string };
        const path = RASTER_PATHS.usgsRaw(String(params.dataset), String(params.entityId), `${String(params.entityId)}.tgz`);
        await run.stepEnded('fetch', 'done', { gcsPath: path, bytes: 734_003_200 });
        return 'next';
    },
    extract: async (run) => {
        const segment = await uploadObject(
            RASTER_PATHS.work(run.city, run.jobId, 'segments/a.tif'),
            new Uint8Array(await smallTiff(120)),
            'image/tiff',
        );
        await run.stepEnded('extract', 'done', recorded(segment));
        return 'next';
    },
    stitch: async (run) => {
        const frame = await uploadObject(
            RASTER_PATHS.work(run.city, run.jobId, 'frame.tif'),
            new Uint8Array(await smallTiff(125)),
            'image/tiff',
        );
        await run.stepEnded('stitch', 'done', recorded(frame));
        return 'next';
    },
    inspect: async (run) => {
        const scan = await writeScan(run);
        if (run.attempt.outcome !== 'scan') {
            await run.writeVersion({ georef: { method: 'embedded', transform: 'affine', gcps: [] } });
        }
        await run.stepEnded('inspect', 'done', recorded(scan));
        return 'next';
    },
    locate: async (run) => {
        const scan = await writeScan(run);
        await run.writeVersion({ georef: { method: 'corners', transform: 'affine', gcps: cornerGcps(run) } });
        await run.stepEnded('locate', 'done', recorded(scan));
        return 'next';
    },
    reference: async (run) => {
        await (isEmbedded(run) ? run.stepEnded('reference', 'skipped') : writeReferences(run));
        return 'next';
    },
    georef: (run) => georeference(run),
    warp: async (run) => {
        const warped = await uploadObject(
            RASTER_PATHS.work(run.city, run.jobId, 'warped.tif'),
            new Uint8Array(await smallTiff(130)),
            'image/tiff',
        );
        await run.stepEnded('warp', 'done', recorded(warped));
        return 'next';
    },
    export: async (run) => {
        const cog = await store(run, 'cog.tif', await smallTiff(150), 'image/tiff');
        await store(run, 'preview.png', await warpedPreviewPng(outputBounds(run)), 'image/png');
        await store(run, 'studio.tif', await smallTiff(160), 'image/tiff');
        await run.stepEnded('export', 'done', recorded(cog));
        return 'next';
    },
    register: async (run) => {
        await run.register(await outputOf(run));
        return 'next';
    },
};

/**
 * `georef`: an embedded georeference is kept; the admin's points (and a re-rendered version's, a crop's) are fitted;
 * else the matcher's pairs, or a wait for points when the script finds too few.
 */
async function georeference(run: Run): Promise<StepResult> {
    if (isEmbedded(run)) {
        await run.stepEnded('georef', 'skipped');
        return 'next';
    }
    const rmse = checkpointRmse(run);
    if (hasManualPoints(run) || (run.type === 'regeoref' && run.version['georef'] !== undefined)) {
        const georef = run.version['georef'] as Record<string, unknown> & { gcps: Gcp[] };
        const disabled = georef.gcps.filter((gcp) => !gcp.enabled).length;
        // The admin's points are fitted and the matcher's suggestions are done with (M4 §2.5), as the pipeline does.
        await run.writeVersion({
            georef: {
                ...georef,
                fitRmseM: Math.round(rmse * 7) / 10,
                checkpointRmseM: rmse,
                checkpointCount: disabled > 0 ? disabled : georef.gcps.length,
            },
            suggestions: undefined,
        });
    } else if (run.attempt.outcome === 'suggestions') {
        await run.writeVersion({ suggestions: suggestedPairs(run) });
        await run.waitForPoints({ pairs: '1' });
        return 'stop';
    } else if (run.attempt.outcome === 'no-match' || run.attempt.outcome === 'scan') {
        await run.waitForPoints(run.attempt.outcome === 'no-match' ? { pairs: '3' } : undefined);
        return 'stop';
    } else {
        await run.writeVersion({
            georef: {
                method: 'auto',
                transform: 'affine',
                gcps: automaticGcps(run),
                fitRmseM: Math.round(rmse * 7) / 10,
                checkpointRmseM: rmse,
                checkpointCount: 3,
            },
        });
    }
    await run.stepEnded('georef', 'done');
    return 'next';
}

function sensorOf(run: Run): Sensor | undefined {
    const sensor = run.version['sensor'] ?? (run.job['params'] as { sensor?: unknown } | undefined)?.sensor;
    return typeof sensor === 'string' && sensor in SENSOR_SPECS ? (sensor as Sensor) : undefined;
}

/** The warped layer's bounds: the crop's box, a GeoTIFF's own (the city), or the scan's corners on the ground. */
function outputBounds(run: Run): Bounds {
    const crop = run.version['crop'] as LatLng[] | undefined;
    if (crop !== undefined) {
        return boundsOf(crop);
    }
    return isEmbedded(run) ? run.bounds : boundsOf(scanCorners(run.bounds));
}

async function outputOf(run: Run): Promise<Record<string, unknown>> {
    const path = (file: VersionFile) => RASTER_PATHS.version(run.city, run.layerId, run.versionId, file);
    const sensor = sensorOf(run);
    const spec = sensor === undefined ? { minzoom: 10, maxzoom: 17 } : SENSOR_SPECS[sensor];
    const bounds = outputBounds(run);
    const cog = await smallTiff(150);
    const studio = await smallTiff(160);
    return {
        cogPath: path('cog.tif'),
        cogBytes: cog.length,
        cogSha256: (run.job['steps'] as Record<string, { sha256?: string }>)['export']?.sha256 ?? '0'.repeat(64),
        previewPath: path('preview.png'),
        bounds: { west: round(bounds.west), south: round(bounds.south), east: round(bounds.east), north: round(bounds.north) },
        minzoom: spec.minzoom,
        maxzoom: spec.maxzoom,
        areaKm2: run.attempt.areaKm2 ?? Math.min(40, Math.round(areaKm2(bounds))),
        studioPath: path('studio.tif'),
        studioBytes: studio.length,
    };
}

/** Plays one step: a scripted failure or kill first, then what the step writes. */
export async function playStep(run: Run, step: PipelineStep): Promise<StepResult> {
    const failAt = run.attempt.failAt ?? 'warp';
    if (run.attempt.outcome === 'oom' && step === failAt) {
        run.execution.finish('failed', 'oom');
        return 'stop';
    }
    if (step !== 'register') {
        await run.stepStarted(step);
    }
    if (run.attempt.outcome === 'fail' && step === failAt) {
        await run.fail(step, run.attempt.code ?? 'apiError.imagery.processingFailed');
        run.execution.finish('failed');
        return 'stop';
    }
    return STEPS[step](run);
}
