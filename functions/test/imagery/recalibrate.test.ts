/**
 * M16 (`functions/src/imagery/{recalibrate,recalibrate-replace,approval,approve}.ts`, `docs/research/M16-recalibrate.md`): Refine and Snap my
 * points start a `regeoref` version from a published layer or one waiting for approval; a version waiting is replaced only once the new one
 * is rendered, and a refine that declines leaves it as it was; a recalibration never publishes itself, and Approve of one not shown better
 * needs the owner's choice. A join is refined frame by frame.
 */
import { type JobDoc, type LayerVersionDoc, type Recalibration } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { applyApprovalPolicy } from '../../src/imagery/approval.js';
import { approveFunction } from '../../src/imagery/approve.js';
import { onJobWrite } from '../../src/imagery/on-job-write.js';
import { recalibrateFunction } from '../../src/imagery/recalibrate.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import {
    CITY,
    NOW,
    at,
    goldenGeoref,
    readJob,
    readLayer,
    readVersion,
    readyWorld,
    renderedVersion,
    seedJob,
    seedLayer,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const CURRENT = 'job-1966-0712';
const LAYER = 'kh-4a-corona-1966';
const MAPBOX = { tilesetId: 'e2e-mapbox.hcm-bucharest-kh-4a-corona-1966', origin: 'mts' } as const;
const ROUGH = [{ pixel: { x: 5000, y: 4000 }, geo: { lat: 44.43, lng: 26.1 } }];

function job(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'succeeded',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: LAYER,
        versionId: CURRENT,
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

const WAITING = { status: 'awaiting_approval', waitReason: 'approval' } as const;

async function world(state: 'published' | 'awaiting_approval' = 'published', version: Partial<LayerVersionDoc> = {}): Promise<ImageryWorld> {
    const found = await readyWorld();
    const published = state === 'published' ? { mapbox: MAPBOX } : {};
    await seedVersion(found, CURRENT, renderedVersion({ state, ...published, ...version }));
    await seedJob(found, CURRENT, job(state === 'published' ? {} : WAITING));
    await seedLayer(found, LAYER, state === 'published' ? { currentVersion: CURRENT } : { pendingVersion: CURRENT });
    return found;
}

function recalibrate(found: ImageryWorld, data: Record<string, unknown>) {
    return recalibrateFunction(() => found.deps).run(adminCall({ cityId: CITY, versionId: CURRENT, route: 'auto', ...data }));
}

function codeOf(promise: Promise<unknown>): Promise<unknown> {
    return failureOf(promise).then((failure) => (failure.details as { code?: unknown } | undefined)?.code);
}

/** The new version, rendered and waiting with its job, as the pipeline leaves it. */
async function rendered(found: ImageryWorld, id: string, recalibration: Recalibration): Promise<void> {
    const version = await readVersion(found, id);
    await seedVersion(found, id, renderedVersion({ ...version, layerId: LAYER, jobId: id, state: 'awaiting_approval', recalibration }));
    const started = await readJob(found, id);
    await seedJob(found, id, { ...(started as JobDoc), ...WAITING });
}

describe('imagery.recalibrate', () => {
    it('happyPath_refineOnAPublishedLayerStartsANewVersionThatHoldsTheLayer @S-A80-HAPPY-REFINE', async () => {
        const found = await world();

        const response = await recalibrate(found, {});

        expect(response.jobId).toMatch(/^rg-/);
        expect(await readVersion(found, response.jobId)).toMatchObject({
            origin: 'regeoref',
            basedOn: CURRENT,
            state: 'processing',
            georef: goldenGeoref(),
            recalibration: { route: 'auto' },
        });
        expect(await readJob(found, response.jobId)).toMatchObject({ type: 'regeoref', status: 'queued', params: { basedOn: CURRENT } });
        expect(await readLayer(found, LAYER)).toMatchObject({ currentVersion: CURRENT, pendingVersion: response.jobId });
    });

    it('badPath_aSecondRecalibrationWhileOneRunsIsBusy @S-A80-BAD-BUSY', async () => {
        const found = await world();
        await recalibrate(found, {});

        expect(await codeOf(recalibrate(found, {}))).toBe('apiError.layers.busy');
    });

    it('happyPath_roughPointsTravelWithTheNewVersion @S-A81-HAPPY-POINTS', async () => {
        const found = await world();

        const response = await recalibrate(found, { route: 'points', points: ROUGH });

        expect((await readVersion(found, response.jobId))?.recalibration).toEqual({ route: 'points', points: ROUGH });
    });

    it.each([
        ['a point off the scan', { route: 'points', points: [{ ...ROUGH[0], pixel: { x: 199_999, y: 10 } }] }, 'apiError.imagery.gcpOutside'],
        ['points without their route', { points: ROUGH }, 'apiError.invalidRequest'],
        ['the points route without points', { route: 'points' }, 'apiError.invalidRequest'],
    ])('badPath_refusedBeforeAnythingIsWritten_%s @S-A81-BAD-REFUSED', async (_case, data, code) => {
        const found = await world();

        expect(await codeOf(recalibrate(found, data))).toBe(code);
        expect((await readLayer(found, LAYER))?.pendingVersion).toBeUndefined();
    });

    const refused: readonly (readonly [string, Partial<LayerVersionDoc>, string])[] = [
        ['a join', { origin: 'join' }, 'apiError.imagery.joinRecalibrate'],
        ['an upload on its own georeference', { georef: { ...goldenGeoref(), method: 'embedded', gcps: [] } }, 'apiError.imagery.noScan'],
        ['a version without its scan', { scan: undefined }, 'apiError.imagery.noScan'],
    ];

    it.each(refused)('badPath_%sIsNotRecalibrated @S-A84-BAD-JOIN', async (_case, version, code) => {
        const found = await world('published', version);

        expect(await codeOf(recalibrate(found, {}))).toBe(code);
    });

    it('badPath_aVersionNoLongerWaitingIsRefused @S-A84-BAD-JOIN', async () => {
        const found = await world('published', { state: 'superseded', own: { path: 'tiles/x.pmtiles', url: 'https://x.test/a', bytes: 1, publishedAt: at(NOW) } });

        expect(await codeOf(recalibrate(found, {}))).toBe('apiError.imagery.versionState');
    });
});

describe('a version waiting for approval, recalibrated', () => {
    it('happyPath_itStaysUntilTheNewOneIsRenderedAndIsThenReplaced @S-A83-HAPPY-REPLACES-WAITING', async () => {
        const found = await world('awaiting_approval');

        const { jobId } = await recalibrate(found, {});

        expect((await readVersion(found, CURRENT))?.state).toBe('awaiting_approval');
        expect((await readVersion(found, jobId))?.recalibration).toEqual({ route: 'auto', replaces: CURRENT });
        expect((await readLayer(found, LAYER))?.pendingVersion).toBe(CURRENT);

        await rendered(found, jobId, { route: 'auto', replaces: CURRENT, before: { rmseM: 18, checks: 20 }, after: { rmseM: 12, checks: 20 } });
        expect(await applyApprovalPolicy(found.deps, CITY, jobId)).toBe(false);

        expect((await readVersion(found, CURRENT))?.state).toBe('cancelled');
        expect(await readJob(found, CURRENT)).toMatchObject({ status: 'cancelled', finishedAt: at(NOW) });
        expect((await readLayer(found, LAYER))?.pendingVersion).toBe(jobId);
        expect((await readVersion(found, jobId))?.state).toBe('awaiting_approval');
    });

    it('badPath_aRefineThatDeclinesLeavesItWaitingWithTheLayer @S-A83-BAD-DECLINE-KEEPS-WAITING', async () => {
        const found = await world('awaiting_approval');
        const { jobId } = await recalibrate(found, {});
        const before = await readJob(found, jobId);
        const after = { ...(before as JobDoc), status: 'cancelled', finishedAt: at(NOW), error: { code: 'apiError.imagery.notImproved', message: 'x' } } as const;
        await seedJob(found, jobId, after);

        expect(await onJobWrite(found.deps, CITY, jobId, { before, after })).toBe('release');

        expect((await readVersion(found, CURRENT))?.state).toBe('awaiting_approval');
        expect((await readLayer(found, LAYER))?.pendingVersion).toBe(CURRENT);
    });

    it('badPath_aCurrentVersionApprovedMeanwhileIsLeftAsItIs @S-A83-BAD-DECLINE-KEEPS-WAITING', async () => {
        const found = await world('awaiting_approval');
        const { jobId } = await recalibrate(found, {});
        await seedVersion(found, CURRENT, { ...(await readVersion(found, CURRENT)), state: 'published', mapbox: MAPBOX } as LayerVersionDoc);
        await seedLayer(found, LAYER, { currentVersion: CURRENT });
        await rendered(found, jobId, { route: 'auto', replaces: CURRENT });

        await applyApprovalPolicy(found.deps, CITY, jobId);

        expect((await readVersion(found, CURRENT))?.state).toBe('published');
        expect((await readLayer(found, LAYER))?.pendingVersion).toBe(jobId);
    });

    it('badPath_aRefineOfAPublishedLayerThatDeclinesReleasesTheLayer @S-A80-BAD-NOT-IMPROVED', async () => {
        const found = await world();
        const { jobId } = await recalibrate(found, {});
        const before = await readJob(found, jobId);
        const after = { ...(before as JobDoc), status: 'cancelled', finishedAt: at(NOW), error: { code: 'apiError.imagery.notImproved', message: 'x' } } as const;
        await seedJob(found, jobId, after);
        await seedVersion(found, jobId, { ...(await readVersion(found, jobId)), state: 'cancelled', error: { code: 'apiError.imagery.notImproved' } } as LayerVersionDoc);

        await onJobWrite(found.deps, CITY, jobId, { before, after });

        expect(await readLayer(found, LAYER)).toMatchObject({ currentVersion: CURRENT });
        expect((await readLayer(found, LAYER))?.pendingVersion).toBeUndefined();
        expect((await readVersion(found, CURRENT))?.state).toBe('published');
    });
});

describe('Approve of a recalibration', () => {
    async function recalibrated(recalibration: Recalibration): Promise<{ found: ImageryWorld; jobId: string }> {
        const found = await world();
        const { jobId } = await recalibrate(found, {});
        await rendered(found, jobId, recalibration);
        await applyApprovalPolicy(found.deps, CITY, jobId);
        return { found, jobId };
    }

    function approve(found: ImageryWorld, versionId: string, acceptWorse?: true) {
        const data = acceptWorse === undefined ? {} : { acceptWorse };
        return approveFunction(() => found.deps).run(adminCall({ cityId: CITY, versionId, ...data }));
    }

    it('happyPath_aBetterFitIsApprovedInOneClickButNeverPublishesItself @S-A82-HAPPY-APPROVE-BETTER', async () => {
        const { found, jobId } = await recalibrated({ route: 'auto', before: { rmseM: 18, checks: 20 }, after: { rmseM: 12, checks: 20 } });

        expect((await readVersion(found, jobId))?.state).toBe('awaiting_approval');
        await expect(approve(found, jobId)).resolves.toMatchObject({ state: 'approved' });
    });

    it.each([
        ['worse', { route: 'manual', before: { rmseM: 12, checks: 5 }, after: { rmseM: 12.5, checks: 5 } }],
        ['not compared', { route: 'manual' }],
    ] as const)('badPath_aFitThatIs_%s_needsTheOwnersChoice @S-A82-BAD-WORSE-NEEDS-CHOICE', async (_case, recalibration) => {
        const { found, jobId } = await recalibrated(recalibration);

        expect(await codeOf(approve(found, jobId))).toBe('apiError.imagery.notBetter');
        expect((await readVersion(found, jobId))?.state).toBe('awaiting_approval');
        await expect(approve(found, jobId, true)).resolves.toMatchObject({ state: 'approved' });
    });
});
