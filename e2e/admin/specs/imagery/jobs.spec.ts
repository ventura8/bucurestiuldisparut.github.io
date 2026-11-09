import { JOB_STEPS, translateAdminContent, type AdminContentKey } from '@hcm/shared';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/content-test.js';
import { seedCity, seedJob } from '../../support/ops.js';

/**
 * A raster job on the Jobs page (behaviour A18, docs/research/M3-interfaces.md §10.6), in a city of the admin's own (the
 * content world: Jobs reads the city only, so no lock): the pipeline's and the publisher's steps by their names in the
 * page's language, why a job waits in words (USGS, the admin's points, the approval, the month's compute units), the
 * georeferencer for a job waiting for points, and Run it again on a failed one. The jobs are written as the dispatcher,
 * the pipeline and the publisher leave them, every wait ending far in the future: a locked spec's `imagery.tick` serves
 * every city, and a USGS wait it found over would start a run here and take one of the server's two running slots.
 */

const AT = new Date('2026-10-20T09:00:00Z');
/** When the waits end: never during a run (`imagery.tick` resumes a USGS wait that is over, in any city). */
const RETRY_AT = new Date('2100-01-01T00:00:00Z');

/** A text of the admin's catalogues. */
function text(lang: 'ro' | 'en', key: string, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminContent(lang, key as AdminContentKey, params);
}

const IMPORT = {
    type: 'usgs-import',
    params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
    layerId: 'kh-4a-1966',
};

/** The waits a raster job can be in, with the status each comes with. */
const WAITS = [
    { id: 'usgs', status: 'waiting_usgs', waitReason: 'usgs-maintenance', key: 'adminContent.imagery.wait.usgsMaintenance' },
    { id: 'points', status: 'awaiting_gcps', waitReason: 'gcps', key: 'adminContent.imagery.wait.gcps' },
    { id: 'approval', status: 'awaiting_approval', waitReason: 'approval', key: 'adminContent.imagery.wait.approval' },
    { id: 'units', status: 'awaiting_approval', waitReason: 'compute-units', key: 'adminContent.imagery.wait.computeUnits' },
] as const;

/** The steps of an import that failed unpacking, as the pipeline leaves them (the job lists every step from its start). */
const STEPS_OF_FAILED = Object.fromEntries(
    JOB_STEPS['usgs-import'].map((step, index) => [step, { status: ['done', 'failed'][index] ?? 'pending' }]),
);

test(
    "A raster job reads in the admin's words",
    { tag: ['@S-A18-HAPPY-RASTER-STEPS', '@S-A18-HAPPY-STEP-ORDER'] },
    async ({ page, lang, content }) => {
        await seedCity(content, AT);
        for (const wait of WAITS) {
            await seedJob(
                content,
                wait.id,
                {
                    ...IMPORT,
                    status: wait.status,
                    waitReason: wait.waitReason,
                    versionId: wait.id,
                    retryAt: RETRY_AT,
                    createdBy: content.uid,
                    attempt: 1,
                },
                AT,
            );
        }
        await seedJob(
            content,
            'failed',
            {
                ...IMPORT,
                status: 'failed',
                versionId: 'failed',
                attempt: 1,
                createdBy: content.uid,
                steps: STEPS_OF_FAILED,
                error: { code: 'apiError.imagery.archiveCorrupt', message: 'the archive could not be read' },
            },
            AT,
        );

        // Every step of an import, the pipeline's and the publisher's, by its name.
        await page.goto(content.address(lang, 'jobs/failed', { map: false }));
        // Finding 80 of 2026-11-03: in the order the type runs them, not the stored map's.
        await expect(page.getByRole('term')).toHaveText(
            JOB_STEPS['usgs-import'].map((step) => text(lang, `adminContent.jobs.stepName.${step}`)),
        );
        for (const step of JOB_STEPS['usgs-import']) {
            await expect(page.getByText(text(lang, `adminContent.jobs.stepName.${step}`), { exact: true })).toBeVisible();
        }
        await expect(page.getByRole('button', { name: text(lang, 'adminContent.jobs.retry') })).toBeEnabled();
        await expectStateSound(page, adminVisit('imagery.job-failed', lang));

        // Why each waiting job waits, in words; the one waiting for points opens the georeferencer.
        for (const wait of WAITS) {
            await page.goto(content.address(lang, `jobs/${wait.id}`, { map: false }));
            await expect(page.locator(`[data-wait="${wait.waitReason}"]`)).toContainText(text(lang, wait.key));
        }
        await page.goto(content.address(lang, 'jobs/points', { map: false }));
        await expect(page.getByRole('link', { name: text(lang, 'adminContent.jobs.openGeoref') })).toHaveAttribute(
            'href',
            '#/georef/points',
        );
        await expectStateSound(page, adminVisit('imagery.job-points', lang));
        await expect(page.getByRole('button', { name: text(lang, 'adminContent.jobs.retry') })).toHaveCount(0);
    },
);

test(
    'The Jobs page: the computer in a card above, the list and an open job side by side from 1200 px, stacked below',
    { tag: ['@S-A62-HAPPY-JOBS-LAYOUT', '@S-A62-BAD-JOBS-LAYOUT'] },
    async ({ page, lang, content }) => {
        await seedCity(content, AT);
        await seedJob(
            content,
            'failed',
            { ...IMPORT, status: 'failed', versionId: 'failed', attempt: 1, createdBy: content.uid, steps: STEPS_OF_FAILED },
            AT,
        );

        await page.setViewportSize({ width: 1680, height: 900 });
        await page.goto(content.address(lang, 'jobs/failed', { map: false }));
        const split = page.locator('hcm-jobs-page hcm-list-detail');
        await expect(split).toHaveAttribute('split', '');
        const card = page.locator('hcm-jobs-page details[data-computer]');
        await expect(card).toHaveAttribute('open', '');
        const [cardBox, listBox] = [await card.boundingBox(), await split.locator('.pane.list').boundingBox()];
        expect(listBox?.width ?? 0).toBeGreaterThanOrEqual(360);
        expect((cardBox?.y ?? Number.NaN) + (cardBox?.height ?? 0)).toBeLessThanOrEqual(listBox?.y ?? Number.NaN);

        // Below 1200 px the open job replaces the list, with Back to it.
        await page.setViewportSize({ width: 1100, height: 900 });
        await expect(split).not.toHaveAttribute('split', '');
        await expect(split.locator('.pane.list')).toBeHidden();
        await expect(page.getByRole('button', { name: text(lang, 'adminContent.common.back') })).toBeVisible();
    },
);

/** A series of a local archive (M20), as `imagery.archiveImport` queues it for the owner's computer. */
const ARCHIVE_SERIES = {
    type: 'archive-series',
    params: {
        archiveId: 'ar-0123456789abcdef',
        seriesId: 's-0123456789ab',
        class: 'grid',
        sheets: 4,
        encoding: 'lineart',
        order: 0,
        referenceLayerIds: [],
    },
    layerId: 'plan-1911',
    runOn: 'local',
    localOnly: true,
};

/** The failure an older worker image left (2026-11-09): the type it did not run, its attempts used up. */
const OUTDATED_FAILURE = {
    status: 'failed',
    attempt: 3,
    error: { code: 'apiError.invalidRequest', message: 'the pipeline does not run archive-series jobs' },
};

test(
    'A job an outdated computer could not run offers Run it again past its attempts; an ordinary exhausted one does not',
    { tag: ['@S-A12-HAPPY-RETRY-OUTDATED', '@S-A12-BAD-RETRY-EXHAUSTED'] },
    async ({ page, lang, content }) => {
        await seedCity(content, AT);
        await content.emulators.setDocument(`cities/${content.city}/layerVersions/outdated`, {
            ...{ layerId: 'plan-1911', origin: 'archive', state: 'failed', year: 1911, label: { ro: 'Plan 1911' } },
            source: { kind: 'archive', archiveId: 'ar-0123456789abcdef', seriesId: 's-0123456789ab', sheetCount: 4 },
            error: { code: 'apiError.invalidRequest' },
            ...{ jobId: 'outdated', createdBy: 'system:imagery', createdAt: AT, updatedBy: 'system:imagery', updatedAt: AT },
        });
        await seedJob(content, 'outdated', { ...ARCHIVE_SERIES, ...OUTDATED_FAILURE, versionId: 'outdated', createdBy: content.uid }, AT);
        await seedJob(
            content,
            'exhausted',
            {
                ...IMPORT,
                status: 'failed',
                versionId: 'exhausted',
                attempt: 3,
                createdBy: content.uid,
                steps: STEPS_OF_FAILED,
                error: { code: 'apiError.imagery.archiveCorrupt', message: 'the archive could not be read' },
            },
            AT,
        );

        // The archive's job by its own title, its error without a placeholder left in it, and Run it again.
        await page.goto(content.address(lang, 'jobs/outdated', { map: false }));
        await expect(page.getByRole('heading', { name: text(lang, 'adminContent.jobs.type.archiveSeries') })).toBeVisible();
        await expect(page.locator('hcm-jobs-page')).not.toContainText('{count}');
        const retry = page.getByRole('button', { name: text(lang, 'adminContent.jobs.retry') });
        await expect(retry).toBeEnabled();
        await retry.click();
        await expect(page.locator('hcm-jobs-page .chips')).toContainText(text(lang, 'adminContent.jobs.status.queued'));
        await expect.poll(async () => (await content.emulators.document(`cities/${content.city}/jobs/outdated`))?.['attempt']).toBe(0);

        // An import that failed on its own three times stays failed, with no Run it again.
        await page.goto(content.address(lang, 'jobs/exhausted', { map: false }));
        await expect(page.getByRole('heading', { name: text(lang, 'adminContent.jobs.type.usgsImport') })).toBeVisible();
        await expect(page.getByRole('button', { name: text(lang, 'adminContent.jobs.retry') })).toHaveCount(0);
    },
);
