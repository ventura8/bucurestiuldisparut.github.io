import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import {
    detail,
    errorText,
    importFromList,
    imageryText,
    readyImagery,
    stepRow,
    stepStateText,
    versionIdOf,
    versionState,
} from './world.js';

// One admin test at a time: the import runs in the server's upstream world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * An import on its way (behaviour A12, docs/research/M3-interfaces.md §4.5): Import on its card -> `imagery.import` (the
 * Functions emulator) -> the dispatcher -> the fake Cloud Run -> the stand-in runner, scripted per test
 * (e2e/admin/support/imagery-runner.ts): a run held and cancelled, a failed run retried from its failed step, USGS
 * maintenance waiting for the tick. The imports that reach the public map are published.spec.ts.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const SCENE = 'DS1035-1057DA023';

test('An import can be cancelled', { tag: '@S-A12-BAD-CANCEL' }, async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
    const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid);
    await imagery.script({ attempts: [{ outcome: 'under', holdAt: 'warp' }] });
    await importFromList(page, lang, SCENE);
    await expect(stepRow(page, lang, 'georef')).toContainText(stepStateText(lang, 'done'), { timeout: FUNCTIONS_TIMEOUT_MS });
    const versionId = versionIdOf(page);

    // Cancel asks first; confirmed, the execution gets its SIGTERM and the job and its version end cancelled.
    await detail(page)
        .getByRole('button', { name: imageryText(lang, 'adminContent.jobs.cancel') })
        .click();
    await page
        .locator('hcm-dialog[open]')
        .getByRole('button', { name: imageryText(lang, 'adminContent.jobs.cancel') })
        .click();
    await expect(versionState(page, lang, 'adminContent.imagery.version.cancelled')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
    await expectStateSound(page, adminVisit('imagery.version-cancelled', lang));
    await expect.poll(async () => (await imagery.job(versionId))?.['status'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('cancelled');
    expect(await imagery.objects(`work/${imagery.city}/${versionId}/`)).toEqual([]);

    // The reserved layer id is free again: the scene can be imported once more.
    await expect
        .poll(async () => (await imagery.cityWorld.emulators.document(`cities/${imagery.city}/usgsScenes/${SCENE}`))?.['status'], {
            timeout: FUNCTIONS_TIMEOUT_MS,
        })
        .toBe('candidate');
    await page.goto(adminPath(lang, `imagery/scene/${SCENE}`));
    await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.import') })).toBeEnabled();
});

test(
    'A failed import can be retried successfully',
    { tag: '@S-A12-BAD-RETRY' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // The georeference done before the failure measured 28.4 m: the retried job keeps it and waits for Approve.
        await imagery.script({
            attempts: [
                { outcome: 'fail', failAt: 'warp', code: 'apiError.imagery.processingFailed', checkpointRmseM: 28.4 },
                { outcome: 'over' },
            ],
        });
        await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.failed')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).getByText(errorText(lang, 'apiError.imagery.processingFailed'))).toBeVisible();
        await expect(stepRow(page, lang, 'warp')).toContainText(stepStateText(lang, 'failed'));
        await expectStateSound(page, adminVisit('imagery.version-failed', lang));

        // Retry: the job resumes at its failed step, the steps done before skipped, and renders the version.
        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.common.retry') })
            .click();
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(stepRow(page, lang, 'warp')).toContainText(stepStateText(lang, 'done'));
        // The second run ends just after its last write, which the page may show first.
        await expect
            .poll(async () => (await imagery.runs()).map((run) => [run.attempt, run.outcome, run.state]))
            .toEqual([
                [1, 'fail', 'ended'],
                [2, 'over', 'ended'],
            ]);
        const lines = Object.values(await imagery.logs(versionIdOf(page))).map((line) => String(line['message']));
        expect(lines.filter((line) => line === 'fetch started')).toHaveLength(1);
    },
);

test(
    'A failure no retry cures offers no Try again, and the failed version is dismissed',
    { tag: ['@S-A12-BAD-NOT-RETRYABLE', '@S-A12-BAD-FAILED-DISMISSED'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'fail', failAt: 'warp', code: 'apiError.imagery.outOfMemory' }] });
        const versionId = await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.failed')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).getByText(errorText(lang, 'apiError.imagery.outOfMemory'))).toBeVisible();
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.common.retry') })).toHaveCount(0);

        // Dismiss asks first; confirmed, the version leaves "Waiting for you" (its job stays failed).
        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.imagery.dismiss') })
            .click();
        const question = page.locator('hcm-dialog[open]');
        await expect(question).toContainText(imageryText(lang, 'adminContent.imagery.confirm.dismissBody'));
        await expectStateSound(page, adminVisit('imagery.version-dismiss', lang));
        await question.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.dismiss') }).click();
        await expect(versionState(page, lang, 'adminContent.imagery.version.rejected')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect.poll(async () => (await imagery.version(versionId))?.['state'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('rejected');
        expect((await imagery.job(versionId))?.['status']).toBe('failed');
    },
);

test(
    'USGS maintenance makes the import wait, not fail',
    { tag: '@S-A12-BAD-USGS-MAINTENANCE' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // USGS answers its maintenance page while the download is prepared; retried at once by the next tick.
        await imagery.script({ attempts: [{ outcome: 'maintenance', retryInMinutes: 0 }, { outcome: 'over' }] });
        await importFromList(page, lang, SCENE);

        await expect(detail(page).getByText(imageryText(lang, 'adminContent.imagery.wait.usgsMaintenance'))).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(versionState(page, lang, 'adminContent.imagery.version.processing')).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.version-usgs-wait', lang));

        await imagery.tick();
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        expect((await imagery.runs()).map((run) => run.outcome)).toEqual(['maintenance', 'over']);
    },
);
