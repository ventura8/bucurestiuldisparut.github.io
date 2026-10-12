import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

import { ADMIN_EMULATORS, ADMIN_ORIGIN, E2E_PROJECT_ID, EMULATOR_ENV, emulatorOrigin } from './admin/world.js';
import { MOCK_API_ORIGIN, SITE_ORIGIN } from './fixtures/world.js';
import { e2eProjects, tiersFrom } from './projects.js';
import type { WorkerOptions } from './support/test.js';

/**
 * Playwright 1.64 end-to-end configuration (docs/research/design-review-testability.md §4.2-4.3).
 * Runs inside the quality image only: `PIPELINE_STAGE=e2e bash scripts/ci/run-all-checks.sh` (gates `e2e-build`,
 * which builds the engine and the e2e sites into dist/e2e-site, then `playwright`). Paths are relative to this file
 * (the e2e/ workspace); reports land in the repository's reports/ folder, where the CI workflow collects them.
 *
 * Two loopback servers start before the tests (`webServer`, e2e/mock-apis/main.ts): the built sites on
 * 127.0.0.1:4310 and the mock APIs on 127.0.0.1:4311. When the admin tier runs, two more (docs/research/M2b-interfaces.md
 * §6.2): the admin server on 127.0.0.1:4312 (the e2e build of packages/admin/dist as Hosting serves it) and the Firebase
 * emulators of project demo-hcm (auth, firestore, storage, functions from functions/dist, pubsub, tasks) with the
 * Functions emulator's environment of e2e/admin/world.ts; they count as up once `admin-session` is loaded. The tiers
 * and their projects are e2e/projects.ts; `E2E_TIER` picks them (`smoke,fn`; unset is all) and `E2E_SHARD` =
 * "index/total" splits a run across CI jobs.
 */

interface Shard {
    current: number;
    total: number;
}

/** `E2E_SHARD` = "index/total" (the CI matrix forwards it through run-all-checks.sh); unset runs everything. */
function shardFrom(value: string | undefined): Shard | null {
    if (value === undefined || value === '') {
        return null;
    }
    const match = /^(\d+)\/(\d+)$/.exec(value);
    const current = Number(match?.[1]);
    const total = Number(match?.[2]);
    if (!(current >= 1 && current <= total)) {
        throw new Error(`E2E_SHARD must be "index/total" with 1 <= index <= total, got "${value}"`);
    }
    return { current, total };
}

const CI = process.env['CI'] === 'true';
/** The e2e servers run from the repository root, through Node's type stripping (scripts/site/register-ts.mjs). */
const SERVER = 'node --import ./scripts/site/register-ts.mjs e2e/mock-apis/main.ts';
const TIERS = tiersFrom(process.env['E2E_TIER']);

type WebServer = Extract<NonNullable<PlaywrightTestConfig['webServer']>, unknown[]>[number];

/** The admin server and the emulators, only for a run that includes the admin tier. */
function adminServers(): WebServer[] {
    const emulators = `npx firebase emulators:start --project ${E2E_PROJECT_ID} --only ${ADMIN_EMULATORS.join(',')}`;
    return [
        { command: `${SERVER} admin`, cwd: '..', url: `${ADMIN_ORIGIN}/__health`, reuseExistingServer: !CI, timeout: 60_000 },
        {
            command: emulators,
            cwd: '..',
            env: { ...EMULATOR_ENV },
            // A GET of a loaded callable answers 400; before the functions are loaded the emulator answers 404.
            url: `${emulatorOrigin('functions')}/${E2E_PROJECT_ID}/us-central1/admin-session`,
            reuseExistingServer: !CI,
            // Java emulators and 32 functions loaded from functions/dist: slow on a cold container.
            timeout: 240_000,
            gracefulShutdown: { signal: 'SIGINT', timeout: 30_000 },
        },
    ];
}

export default defineConfig<object, WorkerOptions>({
    testDir: 'specs',
    forbidOnly: true,
    // In CI a test that passes only on its retry still fails the run: flakiness is a bug, the retry only adds a trace.
    retries: CI ? 1 : 0,
    failOnFlakyTests: CI,
    fullyParallel: true,
    shard: shardFrom(process.env['E2E_SHARD']),
    outputDir: '../reports/test-results',
    reporter: [
        ['list'],
        ['html', { open: 'never', outputFolder: '../reports/playwright' }],
        ['junit', { outputFile: '../reports/junit/e2e.xml' }],
    ],
    // SwiftShader renders the map on the CPU: a first frame can take seconds in a busy container.
    expect: {
        timeout: 15_000,
        toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.002 },
    },
    use: {
        baseURL: SITE_ORIGIN,
        trace: 'retain-on-failure',
        locale: 'ro-RO',
        timezoneId: 'Europe/Bucharest',
        serviceWorkers: 'block',
    },
    webServer: [
        { command: `${SERVER} mock`, cwd: '..', url: `${MOCK_API_ORIGIN}/__health`, reuseExistingServer: !CI, timeout: 60_000 },
        { command: `${SERVER} site`, cwd: '..', url: `${SITE_ORIGIN}/__health`, reuseExistingServer: !CI, timeout: 60_000 },
        ...(TIERS.includes('admin') ? adminServers() : []),
    ],
    projects: e2eProjects(TIERS),
});
