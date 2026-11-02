import { CLOUD_RUN_FREE_TIER, PROVISION_ITEMS, PROVISION_SET_VERSION, usageMonth, WORKER_WAIT_MINUTES } from '@hcm/shared';
import { translateAdminWorker, type AdminWorkerKey } from '@hcm/shared/admin-worker';
import type { Locator, Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import type { ImageryWorld } from '../../support/imagery.js';
import { SetupPage } from '../../support/setup-page.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { E2E_PROJECT_ID } from '../../world.js';
import { readyImagery } from './world.js';

// One admin test at a time: the image's digest is in `setup/status`, the project's singleton.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * "Run on my computer" in the admin (docs/research/M7-local-worker.md §1.1, §3, §4, §7; behaviours A62, A63): the Jobs page
 * and the pipeline card show the city's computer, the docker command with the pipeline image's digest, the city's choice
 * and this month's Cloud Run use; a version whose job holds no run says where it runs and moves it (`imagery.runOn` in the
 * Functions emulator, with the dispatcher's place and free-tier wait behind it).
 *
 * The month's use is counted by the server's clock (the wall clock of the Functions emulator), so the spec names the
 * month and the worker's last sight from the same clock: `NOW`, read once.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const NOW = new Date();
const MONTH = usageMonth(NOW);
const DIGEST = `sha256:${'e7'.repeat(32)}`;
const WORKER = 'w-0123456789abcdef';
const SCENE = { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' } as const;
const LAYER = 'kh-4a-corona-1966';

function text(lang: 'ro' | 'en', key: AdminWorkerKey, params?: Readonly<Record<string, string>>): string {
    return translateAdminWorker(lang, key, params);
}

/** A whole number as the page writes it. */
function count(lang: 'ro' | 'en', value: number): string {
    return new Intl.NumberFormat(lang).format(value);
}

/**
 * `setup/status` as a project with its pipeline installed: billing and the project prepared (so the pipeline's card is
 * open to its body) and the pipeline's record, with the image's digest unless `image` is false.
 */
async function recordPipeline(imagery: ImageryWorld, image = true): Promise<void> {
    const ok = { state: 'ok', checkedAt: NOW };
    const pipeline = { state: 'installed', release: '1.0.0', checkedAt: NOW.toISOString(), ...(image ? { image: DIGEST } : {}) };
    await imagery.cityWorld.emulators.updateFields(
        'setup/status',
        {
            billing: { ...ok, budgetAmount: 5, currency: 'USD' },
            provision: { ...ok, items: PROVISION_ITEMS.map((id) => ({ id, ...ok })), setVersion: PROVISION_SET_VERSION },
            install: { pipeline },
        },
        ['billing', 'provision', 'install'],
    );
}

/** The city's worker, last seen `secondsAgo` before `NOW`, its last job done. */
async function seedWorker(imagery: ImageryWorld, uid: string, secondsAgo: number): Promise<void> {
    const seen = new Date(NOW.getTime() - secondsAgo * 1000);
    await imagery.cityWorld.emulators.setDocument(`cities/${imagery.city}/workers/${WORKER}`, {
        ...{ uid, version: '1.0.0', startedAt: seen, lastSeenAt: seen, state: 'idle' },
        lastJob: { id: 'done-1', outcome: 'done', at: seen },
        ...{ updatedBy: 'system:worker', updatedAt: seen },
    });
}

/** This month's Cloud Run use (the server's month). */
async function seedUsage(imagery: ImageryWorld, vcpuSeconds: number, gibSeconds: number): Promise<void> {
    await imagery.cityWorld.emulators.setDocument(`usage/cloudrun-${MONTH}`, {
        ...{ month: MONTH, vcpuSeconds, gibSeconds, runs: 3 },
        ...{ updatedBy: 'system:imagery', updatedAt: NOW },
    });
}

/** A queued import placed in the cloud, and its version (the dispatcher then decides its wait). */
async function seedQueued(imagery: ImageryWorld, id: string, owner: string): Promise<void> {
    await imagery.seedVersion(
        id,
        {
            ...{ layerId: LAYER, origin: 'usgs', state: 'processing', year: 1966, date: '1966-07-12', sensor: 'KH-4A' },
            source: { kind: 'usgs', ...SCENE, acquisitionDate: '1966-07-12' },
            label: { ro: 'KH-4A Corona, 12 iulie 1966', en: 'KH-4A Corona, 12 July 1966' },
        },
        NOW,
    );
    await imagery.seedJob(
        id,
        { type: 'usgs-import', status: 'queued', params: { ...SCENE }, layerId: LAYER, versionId: id, runOn: 'cloud', createdBy: owner },
        NOW,
    );
}

/**
 * The one-line command the panel shows on this (Linux) browser (finding 66): the old worker removed, the new one detached,
 * named and restarted with the computer, the named volume, the image by digest, and (finding 67) a fresh pairing code.
 */
function commandPattern(city: string): RegExp {
    const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fixed =
        'docker rm -f hcm-worker 2>&1 | true; docker run -d --name hcm-worker --restart unless-stopped ' +
        `-p 127.0.0.1:8765:8765 -v hcm-worker:/work us-central1-docker.pkg.dev/${E2E_PROJECT_ID}/hcm/pipeline@${DIGEST} ` +
        `worker --city ${city} --project ${E2E_PROJECT_ID} --pair `;
    return new RegExp(`^${escaped(fixed)}[a-z2-7]{26}$`);
}

function panel(page: Page): Locator {
    return page.locator('hcm-worker-panel');
}

function place(page: Page): Locator {
    return page.locator('hcm-run-place');
}

test(
    'The Jobs page and the pipeline card show the connected computer, the command, the choice and the month',
    { tag: ['@S-A62-HAPPY-PANEL', '@S-A63-HAPPY-METER'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery);
        await seedWorker(imagery, owner, 60);
        await seedUsage(imagery, 12_345, 45_678);
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

        await page.goto(adminPath(lang, 'jobs'));
        const shown = panel(page);
        await expect(shown.getByText(text(lang, 'adminWorker.connected', { when: '' }).split(':')[0] ?? '')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(shown.getByText(text(lang, 'adminWorker.lastDone', { when: '' }).split(':')[0] ?? '')).toBeVisible();
        await expect(shown.locator('pre')).toHaveText(commandPattern(imagery.city), { timeout: FUNCTIONS_TIMEOUT_MS });
        const command = (await shown.locator('pre').textContent()) ?? '';
        await expect(shown.getByRole('link', { name: text(lang, 'adminWorker.getDocker') })).toHaveAttribute(
            'href',
            'https://docs.docker.com/get-started/get-docker/',
        );
        await expect(shown.getByText(text(lang, 'adminWorker.notePair'))).toBeVisible();
        await expect(shown.getByRole('radio', { name: text(lang, 'adminWorker.choice.auto') })).toHaveAttribute('aria-checked', 'true');
        const use = text(lang, 'adminWorker.meterUse', {
            ...{ vcpu: count(lang, 12_345), vcpuFree: count(lang, CLOUD_RUN_FREE_TIER.vcpuSeconds) },
            ...{ gib: count(lang, 45_678), gibFree: count(lang, CLOUD_RUN_FREE_TIER.gibSeconds) },
        });
        await expect(shown.getByText(use)).toBeVisible();
        await expect(shown.getByText(text(lang, 'adminWorker.meter'))).toBeVisible();
        await expectStateSound(page, adminVisit('worker.panel-connected', lang));

        // Copy puts the command on the clipboard and says so in a polite region.
        await shown.getByRole('button', { name: text(lang, 'adminWorker.copy') }).click();
        await expect(shown.getByRole('status').filter({ hasText: text(lang, 'adminWorker.copied') })).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);

        // The pipeline card shows the same panel and the same month.
        const setup = new SetupPage(page, lang);
        await page.goto(adminPath(lang, 'setup/pipeline'));
        const card = await setup.show('pipeline');
        await expect(card.locator('hcm-worker-panel').getByText(use)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(card.locator('hcm-worker-panel pre')).toHaveText(commandPattern(imagery.city), { timeout: FUNCTIONS_TIMEOUT_MS });
        await expectStateSound(page, adminVisit('worker.setup-panel', lang));
        // Setup's analytics card asks for its stream's settings, which this world's project has none of (a 400 the browser logs).
        consoleErrors.takeMatching(/setup-analyticsConfig/);
    },
);

test(
    'Without a recorded image digest the panel asks to update the pipeline and shows no command',
    { tag: ['@S-A62-BAD-NO-IMAGE'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery, false);

        await page.goto(adminPath(lang, 'jobs'));
        const shown = panel(page);
        await expect(shown.getByText(text(lang, 'adminWorker.noImage'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(shown.getByRole('link', { name: text(lang, 'adminWorker.openSetup') })).toHaveAttribute('href', '#/setup/pipeline');
        await expect(shown.locator('pre')).toHaveCount(0);
        await expect(shown.getByRole('button', { name: text(lang, 'adminWorker.copy') })).toHaveCount(0);
        await expectStateSound(page, adminVisit('worker.panel-no-image', lang));
    },
);

test(
    'A run past the free tier waits for the OK; the computer instead sets the city choice and waits for it',
    { tag: ['@S-A63-BAD-OVER-FREE-TIER', '@S-A62-HAPPY-CHOICE', '@S-A62-BAD-NO-WORKER'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(180_000);
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery);
        // No computer seen for ten minutes; the month's use already near the free tier, so any cloud run would pass it.
        await seedWorker(imagery, owner, 600);
        const used = { vcpu: CLOUD_RUN_FREE_TIER.vcpuSeconds - 1000, gib: CLOUD_RUN_FREE_TIER.gibSeconds - 1000 };
        await seedUsage(imagery, used.vcpu, used.gib);
        await seedQueued(imagery, 'ok-1', owner);
        await seedQueued(imagery, 'local-1', owner);
        for (const id of ['ok-1', 'local-1']) {
            await expect.poll(async () => (await imagery.job(id))?.['waitReason'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('free-tier');
        }

        // The panel: no computer connected.
        await page.goto(adminPath(lang, 'jobs'));
        await expect(panel(page).getByText(text(lang, 'adminWorker.none'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expectStateSound(page, adminVisit('worker.panel-none', lang));

        // The version waiting for the OK: its estimate and the month's use; Run in Google Cloud anyway dispatches it.
        await page.goto(adminPath(lang, 'imagery/version/ok-1'));
        const waiting = place(page);
        const estimate = text(lang, 'adminWorker.estimate', { vcpu: count(lang, 12_600), gib: count(lang, 50_400) });
        await expect(waiting.getByText(estimate)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(waiting.getByText(text(lang, 'adminWorker.freeTier'))).toBeVisible();
        await expect(waiting.getByText(text(lang, 'adminWorker.meter'))).toBeVisible();
        await expectStateSound(page, adminVisit('worker.place-free-tier', lang));
        await waiting.getByRole('button', { name: text(lang, 'adminWorker.runCloudAnyway') }).click();
        await expect
            .poll(async () => (await imagery.job('ok-1'))?.['freeTierOk'], { timeout: FUNCTIONS_TIMEOUT_MS })
            .toMatchObject({ by: owner });
        await expect.poll(async () => (await imagery.runs()).length, { timeout: FUNCTIONS_TIMEOUT_MS }).toBeGreaterThan(0);

        // The other one goes to the computer: it waits for it, and the city's choice is the computer from now on.
        await page.goto(adminPath(lang, 'imagery/version/local-1'));
        await place(page)
            .getByRole('button', { name: text(lang, 'adminWorker.runLocal') })
            .click();
        await expect(place(page).getByText(text(lang, 'adminWorker.waitWorker'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        expect(await imagery.job('local-1')).toMatchObject({ runOn: 'local', waitReason: 'worker' });
        expect(await adminWorld.emulators.document(`cities/${imagery.city}/workers/choice`)).toMatchObject({ choice: 'local' });
        await expect(place(page).getByRole('link', { name: text(lang, 'adminWorker.startWorker') })).toHaveAttribute('href', '#/jobs');
        await expectStateSound(page, adminVisit('worker.place-worker', lang));

        // No computer comes: Run in Google Cloud moves it back to the cloud.
        await place(page)
            .getByRole('button', { name: text(lang, 'adminWorker.runCloud') })
            .click();
        await expect.poll(async () => (await imagery.job('local-1'))?.['runOn'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('cloud');
        // Past the free tier without the OK it waits again: no run of it was asked for.
        await expect.poll(async () => (await imagery.job('local-1'))?.['waitReason'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('free-tier');
        expect((await imagery.runs()).map((run) => run.jobId)).not.toContain('local-1');
    },
);

test(
    "A connected computer's job shows its step live, an outdated one is told to update, and Disconnect revokes it",
    { tag: ['@S-A62-HAPPY-DISCONNECT', '@S-A62-BAD-WORKER-OUTDATED', '@S-A62-HAPPY-PROGRESS'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery);
        await seedQueued(imagery, 'busy-1', owner);
        await imagery.cityWorld.emulators.updateFields(
            `cities/${imagery.city}/jobs/busy-1`,
            { status: 'running', runOn: 'local', step: 'georef', progress: 0.4 },
            ['status', 'runOn', 'step', 'progress'],
        );
        await seedWorker(imagery, owner, 10);
        const workerPath = `cities/${imagery.city}/workers/${WORKER}`;
        await imagery.cityWorld.emulators.updateFields(workerPath, { state: 'busy', jobId: 'busy-1' }, ['state', 'jobId']);

        // Finding 68: the job it works on, with its step and how far it got, live.
        await page.goto(adminPath(lang, 'jobs'));
        const said = text(lang, 'adminWorker.progress', { step: 'georef', percent: '40' });
        await expect(panel(page).locator('[data-progress]')).toHaveText(said, { timeout: FUNCTIONS_TIMEOUT_MS });
        await expectStateSound(page, adminVisit('worker.panel-progress', lang));
        await imagery.cityWorld.emulators.updateFields(`cities/${imagery.city}/jobs/busy-1`, { progress: 0.8 }, ['progress']);
        await expect(panel(page).locator('[data-progress]')).toHaveText(
            text(lang, 'adminWorker.progress', { step: 'georef', percent: '80' }),
        );

        // Finding 67: the pipeline was updated since the computer's command: it takes no job until the command runs again.
        await imagery.cityWorld.emulators.updateFields(workerPath, { state: 'idle', outdated: true }, ['state', 'jobId', 'outdated']);
        await expect(panel(page).locator('[data-outdated]')).toHaveText(text(lang, 'adminWorker.outdated'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expectStateSound(page, adminVisit('worker.panel-outdated', lang));

        // Disconnect this computer: its worker (and the pairing it signed in with) refused from now on.
        await panel(page)
            .getByRole('button', { name: text(lang, 'adminWorker.disconnect') })
            .click();
        await expect
            .poll(async () => (await adminWorld.emulators.document(workerPath))?.['revokedAt'], { timeout: FUNCTIONS_TIMEOUT_MS })
            .toBeDefined();
        await expect(panel(page).getByText(text(lang, 'adminWorker.disconnected'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(panel(page).getByText(text(lang, 'adminWorker.none'))).toBeVisible();
    },
);

test(
    'A job no computer came for offers Run in Google Cloud instead, which moves it there in one click',
    { tag: ['@S-A62-HAPPY-NO-WORKER-OFFER'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery);
        await seedQueued(imagery, 'late-1', owner);
        // What imagery.tick leaves on a local job that waited WORKER_WAIT_MINUTES with no computer seen (finding 68).
        await imagery.cityWorld.emulators.updateFields(
            `cities/${imagery.city}/jobs/late-1`,
            { runOn: 'local', waitReason: 'worker', workerOverdueAt: NOW },
            ['runOn', 'waitReason', 'workerOverdueAt'],
        );

        await page.goto(adminPath(lang, 'imagery/version/late-1'));
        const overdue = text(lang, 'adminWorker.waitOverdue', { minutes: String(WORKER_WAIT_MINUTES) });
        await expect(place(page).locator('[data-overdue]')).toHaveText(overdue, { timeout: FUNCTIONS_TIMEOUT_MS });
        await expectStateSound(page, adminVisit('worker.place-overdue', lang));
        await place(page)
            .getByRole('button', { name: text(lang, 'adminWorker.runCloudInstead') })
            .click();

        await expect.poll(async () => (await imagery.job('late-1'))?.['runOn'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('cloud');
        expect(await imagery.job('late-1')).not.toHaveProperty('workerOverdueAt');
    },
);
