import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { translateAdminWorker, type AdminWorkerKey } from '@hcm/shared/admin-worker';
import type { APIRequestContext, Page } from '@playwright/test';

import { FUNCTIONS_TIMEOUT_MS, type SignedInAccount } from '../../support/emulators.js';
import { REPO_ROOT } from '../../support/imagery-runner.js';
import { LocalWorker } from '../../support/imagery-worker.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { FRAME_CITY, generateScene, SYNTHETIC_SCENE } from './synthetic.js';
import { awaitHarvest, cardImport, closeImportNotice, IMAGERY_AT, readyImagery, stepRow, stepStateText, versionIdOf } from './world.js';

// One admin test at a time: the import runs in the server's upstream world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * "Run on my computer" for real (docs/research/M7-local-worker.md §1–§3, §5; S-A62-HAPPY-WORKER-RUN): the city's choice is
 * the computer, so the 1966 frame imported with Import on its card waits for a worker. The pipeline's own worker process
 * (`python -m hcm_pipeline worker --emulators`, the quality image's pipeline venv) is then started and signed in the way its
 * local page does it: the page's CSRF token read from `GET /`, and `POST /session` from the page's origin with the owner's
 * Firebase ID and refresh tokens of a Google sign-in made then (the Auth emulator's `signInWithIdp`). It claims the
 * job through `worker.claim`, runs every step of the import unchanged against the synthetic scene, writes the documents
 * through `worker.step` and the version's files through signed URLs to the Storage emulator, and reports the end. The
 * city's imagery settings do not publish on their own, so the version stops where a person approves it.
 *
 * The raw delivery stays on the computer: it is downloaded into the work folder and deleted there once `locate` has the
 * city crop (§5); neither it nor the scratch (`work/`) is ever an object of the bucket, and no Cloud Run execution is asked.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const STEPS = ['fetch', 'extract', 'stitch', 'locate', 'georef', 'warp', 'export'] as const;
const DIGEST = `sha256:${'e7'.repeat(32)}`;
/** The JSON settings the worker writes into its page (`worker/page.py`, `SETTINGS_ELEMENT`). */
const SETTINGS = /<script type="application\/json" id="hcm-worker-settings">([^<]+)<\/script>/;

function text(lang: 'ro' | 'en', key: AdminWorkerKey, params?: Readonly<Record<string, string>>): string {
    return translateAdminWorker(lang, key, params);
}

/** The first sentence of a text with a `{when}`, which the page fills with a relative time. */
function lead(lang: 'ro' | 'en', key: AdminWorkerKey): string {
    return text(lang, key, { when: '' }).split(':')[0] ?? '';
}

/** Signs the worker in as its page does: the CSRF token of `GET /`, then `POST /session` from the page's origin. */
async function signIn(request: APIRequestContext, origin: string, account: SignedInAccount): Promise<Record<string, unknown>> {
    const page = await request.get(`${origin}/`);
    expect(page.status()).toBe(200);
    const settings = JSON.parse(SETTINGS.exec(await page.text())?.[1] ?? '{}') as { readonly csrf?: string };
    expect(settings.csrf).toMatch(/^[0-9a-f]{64}$/);
    expect(await (await request.get(`${origin}/state`)).json()).toMatchObject({ signedIn: false, state: 'signed-out' });

    const session = await request.post(`${origin}/session`, {
        headers: { Origin: origin, 'X-HCM-Worker': settings.csrf ?? '', 'Content-Type': 'application/json' },
        data: JSON.stringify({ idToken: account.idToken, refreshToken: account.refreshToken }),
    });
    expect(session.status(), await session.text()).toBe(200);
    return (await session.json()) as Record<string, unknown>;
}

/** The files under `folder` (relative to it), or none when it does not exist. */
function filesUnder(folder: string): string[] {
    return existsSync(folder) ? readdirSync(folder, { recursive: true, encoding: 'utf8' }) : [];
}

/** The Jobs page's worker panel shows the computer connected, its last job done. */
async function expectPanelIdle(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await page.goto(adminPath(lang, 'jobs'));
    const panel = page.locator('hcm-worker-panel');
    await expect(panel.getByText(lead(lang, 'adminWorker.connected'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
    await expect(panel.getByText(lead(lang, 'adminWorker.lastDone'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
}

test(
    "The real worker on the owner's computer claims a local import, runs it and keeps the raw scan local",
    { tag: '@S-A62-HAPPY-WORKER-RUN' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, request }, testInfo) => {
        test.setTimeout(600_000);
        const owner = adminWorld.accounts.owner;
        const { emulators } = adminWorld;
        const imagery = await readyImagery({ emulators, api: mockApiRequest, upstream }, owner.uid, { autoPublish: false });
        const dir = testInfo.outputPath('synthetic');
        const corners = generateScene(dir);
        await imagery.useSyntheticScene(relative(REPO_ROOT, dir));
        // The pipeline is installed with its image (the panel's command), and the city's new jobs run on the computer.
        const pipeline = { state: 'installed', release: '1.0.0', checkedAt: IMAGERY_AT.toISOString(), image: DIGEST };
        await emulators.updateFields('setup/status', { install: { pipeline } }, ['install']);
        await emulators.setDocument(`cities/${imagery.city}/workers/choice`, {
            ...{ choice: 'local', updatedBy: owner.uid, updatedAt: IMAGERY_AT },
        });
        await page.goto(adminPath(lang, 'imagery'));
        await awaitHarvest(page, lang);
        await emulators.updateFields(`cities/${imagery.city}/usgsScenes/${SYNTHETIC_SCENE}`, { corners }, ['corners']);
        await emulators.updateFields(`cities/${imagery.city}`, { bounds: FRAME_CITY }, ['bounds']);

        // Import: the job is placed on the computer and waits for it; the version says so.
        await cardImport(page, lang, SYNTHETIC_SCENE).click();
        await expect(page).toHaveURL(/#\/imagery\/version\//, { timeout: FUNCTIONS_TIMEOUT_MS });
        await closeImportNotice(page, lang);
        const versionId = versionIdOf(page);
        await expect
            .poll(
                async () => {
                    const job = await imagery.job(versionId);
                    return [job?.['runOn'], job?.['waitReason'], job?.['status']];
                },
                { timeout: FUNCTIONS_TIMEOUT_MS },
            )
            .toEqual(['local', 'worker', 'queued']);
        await expect(page.locator('hcm-run-place').getByText(text(lang, 'adminWorker.waitWorker'))).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });

        // The worker starts, and is signed in with the owner's account as its page does it: a Google sign-in of now (the
        // Auth emulator's signInWithIdp), whose ID token carries the claims the world gave the owner.
        const signedInNow = await emulators.signIn('owner');
        const work = testInfo.outputPath('work');
        mkdirSync(work, { recursive: true });
        const worker = LocalWorker.start(imagery.city, work);
        try {
            const origin = await worker.origin();
            const signedIn = await signIn(request, origin, signedInNow);
            expect(signedIn).toMatchObject({ signedIn: true, email: owner.email, city: imagery.city, lastError: null });

            // It claims the job and runs every step of the import.
            for (const step of STEPS) {
                await expect(stepRow(page, lang, step)).toContainText(stepStateText(lang, 'done'), { timeout: FUNCTIONS_TIMEOUT_MS * 2 });
            }
            await expect
                .poll(async () => (await imagery.version(versionId))?.['state'], { timeout: FUNCTIONS_TIMEOUT_MS })
                .toBe('awaiting_approval');
            const job = (await imagery.job(versionId)) ?? {};
            expect(job).toMatchObject({ status: 'awaiting_approval', waitReason: 'approval', runOn: 'local' });
            expect((job['worker'] as { id?: string } | undefined)?.id).toMatch(/^w-[0-9a-f]{16}$/);
            // No Cloud Run execution was asked for: the job never named one, nor a machine.
            expect(job['executionName']).toBeUndefined();
            expect(job['machine']).toBeUndefined();

            // The version's files are in the bucket; the delivery and the scratch never were.
            const files = await emulators.objectNames(`rasters/${imagery.city}/`);
            for (const name of ['scan.tif', 'cog.tif', 'preview.png', 'studio.tif']) {
                expect(files).toContain(`rasters/${imagery.city}/${String(job['layerId'])}/${versionId}/${name}`);
            }
            expect(await emulators.objectNames('usgs-raw/')).toEqual([]);
            expect(await emulators.objectNames('work/')).toEqual([]);
            // On the computer: the delivery was downloaded there and deleted after locate; the reference cache stays.
            const fetched = String((job['steps'] as Record<string, { gcsPath?: string }>)['fetch']?.gcsPath);
            expect(fetched).toMatch(/^usgs-raw\//);
            expect(existsSync(join(work, fetched))).toBe(false);
            expect(filesUnder(join(work, 'usgs-raw')).filter((name) => name.endsWith('.tgz'))).toEqual([]);
            expect(filesUnder(join(work, 'reference')).some((name) => name.endsWith('.tif'))).toBe(true);

            // The worker is idle again, and the admin shows the computer connected with its last job done.
            await expect
                .poll(async () => ((await (await request.get(`${origin}/state`)).json()) as { state?: string }).state, {
                    timeout: FUNCTIONS_TIMEOUT_MS,
                })
                .toBe('idle');
            await expectPanelIdle(page, lang);
        } finally {
            // Ctrl-C, as the admin guide stops it. How it ended is recorded, not asserted: the first signal after a job was
            // sometimes lost in this world (DECISIONS-for-review.md §83j, open), and the stop then ends with SIGKILL.
            testInfo.annotations.push({ type: 'worker stop', description: await worker.stop() });
        }
    },
);
