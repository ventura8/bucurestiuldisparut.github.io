/**
 * M20 (`docs/research/M20-import-local.md` §5, §7, §9): an archive series' version publishes on its own only within its scaled
 * threshold (1 mm of paper, capped at the city's `mapThresholdMaxM`), measured on its own extent, with its rights clear and both
 * switches on; a map of no known scale never publishes itself. Its rights gate the Approve click too, and its layer is a map at
 * 0.85, credited from its rights, which it keeps.
 */
import type { ArchiveReport, ImagerySettings, LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { applyApprovalPolicy } from '../../src/imagery/approval.js';
import { approveFunction } from '../../src/imagery/approve.js';
import { finalizeVersion } from '../../src/imagery/finalize.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { CLEAR, PLACED, UNCONFIRMED, archiveJob, archiveVersion } from './archive-world.js';
import { CITY, NOW, at, readLayer, readVersion, readyWorld, seedCity, seedJob, seedVersion } from './world.js';

const SERIES = 'ar-1';
const LAYER = 'planul-1895';

async function policyOn(version: LayerVersionDoc, imagery: Partial<Omit<ImagerySettings, 'targetYears'>> = {}) {
    const world = await readyWorld();
    await seedCity(world, { imagery: { autoPublish: true, rmseThresholdM: 15, ...imagery } });
    await seedVersion(world, SERIES, version);
    await seedJob(world, SERIES, archiveJob());
    return { world, auto: await applyApprovalPolicy(world.deps, CITY, SERIES) };
}

function report(overrides: Partial<ArchiveReport>): LayerVersionDoc {
    return archiveVersion({ archive: { ...PLACED, ...overrides } });
}

describe('the approval policy on an archive series', () => {
    it('happyPath_aGridWithinTheCityThresholdPublishesOnItsOwn @S-A120-HAPPY-AUTO-MAP', async () => {
        const { world, auto } = await policyOn(archiveVersion());

        expect(auto).toBe(true);
        expect(await readVersion(world, SERIES)).toMatchObject({
            state: 'approved',
            approval: { auto: true, checkpointRmseM: 4.2, thresholdM: 15 },
        });
    });

    it('happyPath_a1To40000MapIsHeldTo40mAndAMapAt100000ToTheCap', async () => {
        const hungarian = await policyOn(report({ scaleDenominator: 40_000, checkpointRmseM: 38 }));
        expect(hungarian.auto).toBe(true);
        expect((await readVersion(hungarian.world, SERIES))?.approval?.thresholdM).toBe(40);

        const regional = await policyOn(report({ scaleDenominator: 100_000, checkpointRmseM: 70 }), { mapThresholdMaxM: 100 });
        expect(regional.auto).toBe(true);
        expect((await readVersion(regional.world, SERIES))?.approval?.thresholdM).toBe(100);
    });

    it.each<[string, LayerVersionDoc, Partial<Omit<ImagerySettings, 'targetYears'>>]>([
        ['a map of no known scale', report({ scaleDenominator: undefined }), {}],
        ['over its scaled threshold', report({ scaleDenominator: 40_000, checkpointRmseM: 41 }), {}],
        ['past the 60 m cap', report({ scaleDenominator: 100_000, checkpointRmseM: 61 }), {}],
        ['no figure', report({ checkpointRmseM: undefined }), {}],
        ['too few checks', report({ checkpointCount: 2 }), {}],
        ['a dropped gross check', report({ checksDropped: 1 }), {}],
        ['a rival placement', report({ rivalClean: false }), {}],
        ['too little of its own extent', report({ measuredPct: 69 }), {}],
        ['placed by the owners points', report({ method: 'gcps' }), {}],
        ['rights not confirmed', archiveVersion({ rights: UNCONFIRMED }), {}],
        ['no rights', archiveVersion({ rights: undefined }), {}],
        ['no placement report', archiveVersion({ archive: undefined }), {}],
        ['maps auto-publish switched off', archiveVersion(), { mapAutoPublish: false }],
        ['auto-publish switched off', archiveVersion(), { autoPublish: false }],
    ])('badPath_%sWaitsForApprove @S-A120-BAD-NO-AUTO-MAP', async (_name, version, imagery) => {
        const { world, auto } = await policyOn(version, imagery);

        expect(auto).toBe(false);
        expect((await readVersion(world, SERIES))?.state).toBe('awaiting_approval');
    });
});

describe('imagery.approve on an archive series', () => {
    async function approve(version: LayerVersionDoc) {
        const world = await readyWorld();
        await seedVersion(world, SERIES, version);
        await seedJob(world, SERIES, archiveJob());
        return { world, call: approveFunction(() => world.deps).run(adminCall({ cityId: CITY, versionId: SERIES })) };
    }

    it('badPath_rightsNotConfirmedRefuseThePublish @S-A120-BAD-RIGHTS-UNCONFIRMED', async () => {
        const { world, call } = await approve(archiveVersion({ rights: UNCONFIRMED }));

        await expect(failureOf(call)).resolves.toMatchObject({
            code: 'failed-precondition',
            details: { code: 'apiError.imagery.rightsUnconfirmed' },
        });
        expect((await readVersion(world, SERIES))?.state).toBe('awaiting_approval');
    });

    it('happyPath_confirmedRightsPublish @S-A120-HAPPY-RIGHTS', async () => {
        const confirmed = {
            ...UNCONFIRMED,
            licence: 'permission',
            state: 'clear',
            confirmedBy: 'Idei Urbane – DocuBucurești',
            confirmedAt: at(NOW),
        } as const;
        const { world, call } = await approve(archiveVersion({ rights: confirmed }));

        await expect(call).resolves.toEqual({ state: 'approved', jobId: SERIES });
        expect((await readVersion(world, SERIES))?.approval).toMatchObject({ auto: false, by: 'u-admin' });
    });
});

describe('the layer of an archive series', () => {
    it('happyPath_itIsAMapAt085CreditedFromItsRightsWhichItKeeps @S-A120-HAPPY-CREDITS', async () => {
        const world = await readyWorld();
        const rights = {
            ...CLEAR,
            sourceUrl: 'https://ideiurbane.ro/docubucuresti-planuri-harti-si-alte-documente/',
            watermark: 'romaniaforum',
        };
        await seedVersion(
            world,
            SERIES,
            archiveVersion({ state: 'approved', approval: { auto: false, by: 'u-admin', at: at(NOW) }, rights }),
        );
        await seedJob(world, SERIES, archiveJob({ status: 'mts_processing', waitReason: 'mapbox' }));

        await finalizeVersion(world.deps, {
            cityId: CITY,
            jobId: SERIES,
            versionId: SERIES,
            origin: 'own',
            path: 'tiles/x.pmtiles',
            url: 'https://cdn.test/x.pmtiles',
            bytes: 10,
        });

        expect(await readLayer(world, LAYER)).toMatchObject({
            kind: 'map',
            opacity: 0.85,
            attribution: 'IGA, Planul IGA 1895, 1895 · PD · scan: Idei Urbane – DocuBucurești (romaniaforum)',
            rights: { licence: 'PD', author: 'IGA', source: { label: 'Idei Urbane – DocuBucurești', url: rights.sourceUrl } },
        });
    });
});
