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

test("A raster job reads in the admin's words", { tag: '@S-A18-HAPPY-RASTER-STEPS' }, async ({ page, lang, content }) => {
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
    await expect(page.getByRole('link', { name: text(lang, 'adminContent.jobs.openGeoref') })).toHaveAttribute('href', '#/georef/points');
    await expectStateSound(page, adminVisit('imagery.job-points', lang));
    await expect(page.getByRole('button', { name: text(lang, 'adminContent.jobs.retry') })).toHaveCount(0);
});
