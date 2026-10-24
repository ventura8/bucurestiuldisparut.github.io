/**
 * `imagery.saveGcps` and `imagery.crop` (`functions/src/imagery/{save-gcps,crop,regeoref,geometry}.ts`,
 * `docs/research/M3-interfaces.md` §4.1, §6): the georeferencer's points are refitted server-side with the page's own
 * mathematics; a version waiting for points continues its own job, any other gets a new `regeoref` job and version on the
 * same layer, which keeps its tiles until the new one is published. Points off the scan or out of the city, a collinear
 * set, a crop that misses the layer or crosses itself are refused before anything is written.
 */
import { FIRESTORE_PATHS, type Gcp, type JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { cropFunction } from '../../src/imagery/crop.js';
import { onJobWrite } from '../../src/imagery/on-job-write.js';
import { saveGcpsFunction } from '../../src/imagery/save-gcps.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import {
    CITY,
    NOW,
    at,
    readJob,
    readLayer,
    readScene,
    readVersion,
    readyWorld,
    needsGcpsVersion,
    renderedVersion,
    seedGuard,
    seedJob,
    seedLayer,
    seedScene,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const PLAN = 'up-plan1911';
const CORONA = 'job-1966-0712';
const LAYER = 'kh-4a-corona-1966';

/** `count` pairs spread over a scan of `width` × `height` pixels, mapped by a plain affine onto central Bucharest. */
function pairs(count: number, width = 8192, height = 6144): Gcp[] {
    return Array.from({ length: count }, (_, index) => {
        const x = ((index * 37) % 11) * (width / 11) + 50;
        const y = ((index * 53) % 7) * (height / 7) + 50;
        return {
            id: `g${String(index + 1)}`,
            pixel: { x, y },
            geo: { lat: 44.5 - y * 0.00002 + (index % 3) * 0.000001, lng: 26 + x * 0.00002 },
            enabled: index < count - 2,
            origin: 'manual' as const,
        };
    });
}

function job(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'geotiff-import',
        status: 'awaiting_gcps',
        params: { uploadPath: 'uploads/rasters/bucharest/uid-owner/up-plan1911/Qx7mP2rT9w.tif', replaces: false },
        createdBy: 'uid-owner',
        createdAt: at(NOW),
        layerId: 'planul-bucurestilor-1911',
        versionId: PLAN,
        waitReason: 'gcps',
        steps: { inspect: { status: 'done' }, reference: { status: 'done' }, georef: { status: 'running' } },
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

function save(world: ImageryWorld, data: Record<string, unknown>) {
    return saveGcpsFunction(() => world.deps).run(adminCall({ cityId: CITY, transform: 'affine', ...data }));
}

async function waitingWorld(): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedVersion(world, PLAN, needsGcpsVersion());
    await seedJob(world, PLAN, job());
    return world;
}

async function publishedWorld(): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedVersion(
        world,
        CORONA,
        renderedVersion({ state: 'published', mapbox: { tilesetId: 'e2e-mapbox.hcm-bucharest-kh-4a-corona-1966', origin: 'mts' } }),
    );
    await seedJob(world, CORONA, job({ type: 'usgs-import', status: 'succeeded', layerId: LAYER, versionId: CORONA }));
    await seedLayer(world, LAYER, { currentVersion: CORONA, bounds: { west: 25.95, south: 44.33, east: 26.25, north: 44.55 } });
    return world;
}

describe('imagery.saveGcps', () => {
    it('happyPath_aVersionWaitingForPointsContinuesItsOwnJob', async () => {
        const world = await waitingWorld();
        const crop = [
            { lat: 44.5, lng: 26 },
            { lat: 44.5, lng: 26.1 },
            { lat: 44.4, lng: 26.1 },
        ];

        const response = await save(world, { versionId: PLAN, gcps: pairs(8), crop });

        expect(response).toEqual({ jobId: PLAN, versionId: PLAN, resumed: true });
        const version = await readVersion(world, PLAN);
        expect(version).toMatchObject({ state: 'processing', crop, georef: { method: 'gcps', transform: 'affine', checkpointCount: 2 } });
        // A plain affine in degrees is not one in Web Mercator metres: a metre or two of error over the plan.
        expect(version?.georef?.fitRmseM).toBeLessThan(5);
        expect(version?.georef?.checkpointRmseM).toBeLessThan(5);
        expect(version?.georef?.gcps.every((gcp) => gcp.residualM !== undefined)).toBe(true);
        const resumed = await readJob(world, PLAN);
        expect(resumed).toMatchObject({
            status: 'queued',
            steps: { inspect: { status: 'done' }, georef: { status: 'pending' } },
            updatedBy: 'u-admin',
        });
        expect(resumed?.waitReason).toBeUndefined();
    });

    it('happyPath_threeEnabledPairsFixAnAffineFitAndKeepNoResidualOfTheirOwn', async () => {
        const world = await waitingWorld();
        const gcps = pairs(5).map((gcp, index) => ({ ...gcp, enabled: index < 3, residualM: 99 }));

        await expect(save(world, { versionId: PLAN, gcps })).resolves.toMatchObject({ resumed: true });

        const saved = (await readVersion(world, PLAN))?.georef?.gcps ?? [];
        expect(saved.filter((gcp) => gcp.enabled).map((gcp) => gcp.residualM)).toEqual([undefined, undefined, undefined]);
        expect(saved.filter((gcp) => !gcp.enabled).every((gcp) => gcp.residualM !== undefined && gcp.residualM < 99)).toBe(true);
        expect((await readVersion(world, PLAN))?.crop).toBeUndefined();
    });

    it('happyPath_aNewRenditionTakesTheCropItIsGiven', async () => {
        const world = await publishedWorld();
        const crop = [
            { lat: 44.5, lng: 26 },
            { lat: 44.5, lng: 26.1 },
            { lat: 44.4, lng: 26.1 },
        ];

        const response = await save(world, { versionId: CORONA, gcps: pairs(6, 20480, 16384), crop });

        expect((await readVersion(world, response.versionId))?.crop).toEqual(crop);
    });

    it('happyPath_theLayersCurrentVersionGetsANewRenditionAndKeepsItsTiles', async () => {
        const world = await publishedWorld();

        const response = await save(world, { versionId: CORONA, gcps: pairs(16, 20480, 16384), transform: 'poly2' });

        expect(response).toMatchObject({ versionId: response.jobId, resumed: false });
        expect(response.jobId).toMatch(/^rg-/);
        expect(await readVersion(world, response.jobId)).toMatchObject({
            layerId: LAYER,
            origin: 'regeoref',
            basedOn: CORONA,
            state: 'processing',
            label: { ro: 'KH-4A Corona, 12 iulie 1966' },
            year: 1966,
            sensor: 'KH-4A',
            scan: { width: 20480 },
            georef: { method: 'gcps', transform: 'poly2' },
        });
        expect(await readJob(world, response.jobId)).toMatchObject({
            type: 'regeoref',
            status: 'queued',
            params: { basedOn: CORONA },
            layerId: LAYER,
        });
        expect(await readLayer(world, LAYER)).toMatchObject({ currentVersion: CORONA, pendingVersion: response.jobId });
        expect((await readVersion(world, CORONA))?.state).toBe('published');
    });

    it('happyPath_aVersionAwaitingApprovalIsReplacedByTheNewPoints', async () => {
        const world = await readyWorld();
        await seedVersion(world, CORONA, renderedVersion());
        await seedJob(
            world,
            CORONA,
            job({ type: 'usgs-import', status: 'awaiting_approval', waitReason: 'approval', layerId: LAYER, versionId: CORONA }),
        );

        const response = await save(world, { versionId: CORONA, gcps: pairs(6, 20480, 16384) });

        expect((await readVersion(world, CORONA))?.state).toBe('cancelled');
        expect(await readJob(world, CORONA)).toMatchObject({ status: 'cancelled', finishedAt: at(NOW) });
        expect((await readVersion(world, response.jobId))?.layerId).toBe(LAYER);
        expect(await readLayer(world, LAYER)).toBeUndefined();
    });

    it('badPath_replacingAFirstImportKeepsItsSceneImported @S-A16-BAD-REGEOREF-KEEPS-SCENE', async () => {
        const world = await readyWorld();
        const awaiting = job({
            type: 'usgs-import',
            status: 'awaiting_approval',
            waitReason: 'approval',
            layerId: LAYER,
            versionId: CORONA,
        });
        await seedVersion(world, CORONA, renderedVersion());
        await seedJob(world, CORONA, awaiting);
        await seedScene(world, 'DS1035-1057DA023', { status: 'imported', layerId: LAYER });

        await save(world, { versionId: CORONA, gcps: pairs(6, 20480, 16384) });
        // The dispatcher's trigger sees the base job become cancelled and releases what it held, as in production.
        await onJobWrite(world.deps, CITY, CORONA, { before: awaiting, after: await readJob(world, CORONA) });

        expect(await readScene(world, 'DS1035-1057DA023')).toMatchObject({ status: 'imported', layerId: LAYER });
    });

    it('badPath_aBaseTheGuardSentToMapboxMeanwhileIsNotReplaced @S-A16-BAD-REGEOREF-KEEPS-SCENE', async () => {
        const world = await readyWorld();
        await seedVersion(world, CORONA, renderedVersion());
        await seedJob(world, CORONA, job({ type: 'usgs-import', status: 'awaiting_approval', layerId: LAYER, versionId: CORONA }));
        // Approved and passed to the publisher between the page's read and the save's transaction.
        const read = world.deps.documents.get.bind(world.deps.documents);
        let moved = false;
        world.deps.documents.get = async (path, schema) => {
            const found = await read(path, schema);
            if (!moved && path === FIRESTORE_PATHS.layerVersion(CITY, CORONA)) {
                moved = true;
                await seedJob(world, CORONA, job({ type: 'usgs-import', status: 'mts_processing', layerId: LAYER, versionId: CORONA }));
            }
            return found;
        };

        const failure = await failureOf(save(world, { versionId: CORONA, gcps: pairs(6, 20480, 16384) }));

        expect(failure).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        expect((await readJob(world, CORONA))?.status).toBe('mts_processing');
        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toEqual([FIRESTORE_PATHS.job(CITY, CORONA)]);
    });
});

describe('imagery.saveGcps: refusals', () => {
    it.each([
        ['a pixel beyond the scan', (gcp: Gcp): Gcp => ({ ...gcp, pixel: { x: 9000, y: 10 } })],
        ['a place outside the city and its half degree', (gcp: Gcp): Gcp => ({ ...gcp, geo: { lat: 45.2, lng: 26 } })],
    ])('badPath_pointsOutsideTheScanOrTheCityAreRefused_%s @S-A16-BAD-GCP-OUTSIDE', async (_case, move) => {
        const world = await waitingWorld();

        const failure = await failureOf(
            save(world, { versionId: PLAN, gcps: pairs(6).map((gcp, index) => (index === 0 ? move(gcp) : gcp)) }),
        );

        expect(failure).toMatchObject({ code: 'invalid-argument', details: { code: 'apiError.imagery.gcpOutside' } });
        expect((await readJob(world, PLAN))?.status).toBe('awaiting_gcps');
        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toEqual([FIRESTORE_PATHS.job(CITY, PLAN)]);
    });

    it('badPath_pointsInALineAreDegenerate', async () => {
        const world = await waitingWorld();
        const line = pairs(5).map((gcp, index) => ({
            ...gcp,
            pixel: { x: 100 + index * 100, y: 100 + index * 100 },
            geo: { lat: 44.4 + index / 1000, lng: 26 + index / 1000 },
            enabled: true,
        }));

        const failure = await failureOf(save(world, { versionId: PLAN, gcps: line }));

        expect(failure).toMatchObject({ details: { code: 'apiError.imagery.degenerateGcps' } });
    });

    it('badPath_tooFewEnabledPairsAreRefusedByTheRequest', async () => {
        const world = await waitingWorld();

        const failure = await failureOf(save(world, { versionId: PLAN, gcps: pairs(4), transform: 'poly2' }));

        expect(failure).toMatchObject({ details: { code: 'apiError.invalidRequest' } });
    });

    it.each([
        ['a rejected version', renderedVersion({ state: 'rejected' }), 'apiError.imagery.versionState'],
        ['a linked layer without a scan', renderedVersion({ scan: undefined, state: 'processing' }), 'apiError.imagery.noScan'],
    ])('badPath_cannotBeGeoreferencedAgain_%s', async (_case, version, code) => {
        const world = await readyWorld();
        await seedVersion(world, CORONA, version);

        expect(await failureOf(save(world, { versionId: CORONA, gcps: pairs(6, 20480, 16384) }))).toMatchObject({ details: { code } });
    });

    it('badPath_aJobThatStoppedWaitingIsNotResumed', async () => {
        const world = await waitingWorld();
        await seedJob(world, PLAN, job({ status: 'cancelled' }));

        expect(await failureOf(save(world, { versionId: PLAN, gcps: pairs(6) }))).toMatchObject({
            details: { code: 'apiError.imagery.versionState' },
        });
    });

    it('badPath_aNewRenditionWaitsForTheGuardAndAFreeLayer', async () => {
        const world = await publishedWorld();
        await seedJob(world, 'busy', job({ type: 'regeoref', status: 'running', layerId: LAYER, params: { basedOn: CORONA } }));

        const busy = await failureOf(save(world, { versionId: CORONA, gcps: pairs(6, 20480, 16384) }));
        await seedGuard(world, 'red');
        const paused = await failureOf(save(world, { versionId: CORONA, gcps: pairs(6, 20480, 16384) }));

        expect(busy).toMatchObject({ details: { code: 'apiError.layers.busy' } });
        expect(paused).toMatchObject({ details: { code: 'apiError.guardPaused' } });
    });

    it('badPath_anUnknownVersionOrCityIsNotFound', async () => {
        const world = await readyWorld();

        expect(await failureOf(save(world, { versionId: 'nope', gcps: pairs(6) }))).toMatchObject({ code: 'not-found' });
        await world.deps.documents.delete(FIRESTORE_PATHS.city(CITY));
        expect(await failureOf(save(world, { versionId: PLAN, gcps: pairs(6) }))).toMatchObject({ code: 'not-found' });
    });
});

describe('imagery.crop', () => {
    const RING = [
        { lat: 44.5, lng: 26.0 },
        { lat: 44.5, lng: 26.2 },
        { lat: 44.38, lng: 26.2 },
        { lat: 44.38, lng: 26.0 },
    ];

    function crop(world: ImageryWorld, ring: readonly { lat: number; lng: number }[] = RING, layerId = LAYER) {
        return cropFunction(() => world.deps).run(adminCall({ cityId: CITY, layerId, ring }));
    }

    it('happyPath_theCurrentVersionIsRenderedAgainInsideThePolygon', async () => {
        const world = await publishedWorld();

        const response = await crop(world);

        expect(response.jobId).toMatch(/^cr-/);
        expect(await readVersion(world, response.versionId)).toMatchObject({
            origin: 'crop',
            basedOn: CORONA,
            crop: RING,
            georef: { method: 'auto', transform: 'poly2' },
            state: 'processing',
        });
        expect((await readLayer(world, LAYER))?.pendingVersion).toBe(response.jobId);
    });

    it.each([
        ['misses the layer', RING.map((vertex) => ({ ...vertex, lng: vertex.lng + 1 })), 'apiError.imagery.cropOutsideLayer'],
        [
            'crosses itself',
            [
                { lat: 44.5, lng: 26.0 },
                { lat: 44.38, lng: 26.2 },
                { lat: 44.5, lng: 26.2 },
                { lat: 44.38, lng: 26.0 },
            ],
            'apiError.invalidRequest',
        ],
    ])('badPath_aPolygonThat_%s_isRefused', async (_case, ring, code) => {
        const world = await publishedWorld();

        expect(await failureOf(crop(world, ring))).toMatchObject({ details: { code } });
        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toHaveLength(1);
    });

    it('badPath_aLinkedLayerHasNoScanToCrop', async () => {
        const world = await publishedWorld();
        await seedLayer(world, 'linked', { currentVersion: undefined });
        await seedLayer(world, 'no-scan', { currentVersion: 'v-linked' });
        await seedVersion(world, 'v-linked', renderedVersion({ jobId: 'v-linked', scan: undefined, state: 'processing' }));

        expect(await failureOf(crop(world, RING, 'linked'))).toMatchObject({ details: { code: 'apiError.imagery.noScan' } });
        expect(await failureOf(crop(world, RING, 'no-scan'))).toMatchObject({ details: { code: 'apiError.imagery.noScan' } });
        expect(await failureOf(crop(world, RING, 'gone'))).toMatchObject({ code: 'not-found' });
    });

    it('happyPath_aLayerWithoutBoundsTakesAnyRing', async () => {
        const world = await publishedWorld();
        await seedLayer(world, LAYER, { currentVersion: CORONA, bounds: undefined });

        await expect(
            crop(
                world,
                RING.map((vertex) => ({ ...vertex, lng: vertex.lng + 1 })),
            ),
        ).resolves.toMatchObject({ versionId: expect.stringMatching(/^cr-/) as unknown });
    });
});
