import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

import { ADMIN_EMULATORS, ADMIN_ORIGIN, E2E_PROJECT_ID, EMULATOR_ENV, emulatorOrigin } from './admin/world.js';
import { MOCK_API_ORIGIN, SITE_ORIGIN } from './fixtures/world.js';
import { e2eProjects, tiersFrom } from './projects.js';
import { adminPartFrom, shardRangeFrom, type ShardRange } from './split.js';
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
 * and their projects are e2e/projects.ts; `E2E_TIER` picks them (`smoke,fn`; unset is every push's tiers, `all` adds
 * `tour-matrix`), `E2E_SHARD` splits a run across CI jobs or machines and `E2E_ADMIN_PART` gives a machine its part of
 * the admin projects (scripts/ci/e2e-split.sh, e2e/split.ts).
 */

interface Shard {
    current: number;
    total: number;
}

/**
 * Playwright's shard for a range: one slice is Playwright's own `--shard`; several are one shard of unequal weights
 * (`PWTEST_SHARD_WEIGHTS`, which the runner reads after loading this file): the slices before the range, the range,
 * and the slices after it.
 */
function shardOf({ first, last, total }: ShardRange): Shard {
    if (first === last) {
        return { current: first, total };
    }
    const weights = [first - 1, last - first + 1, total - last].filter((weight) => weight > 0);
    process.env['PWTEST_SHARD_WEIGHTS'] = weights.join(':');
    return { current: first === 1 ? 1 : 2, total: weights.length };
}

const CI = process.env['CI'] === 'true';
/** The e2e servers run from the repository root, through Node's type stripping (scripts/site/register-ts.mjs). */
const SERVER = 'node --import ./scripts/site/register-ts.mjs e2e/mock-apis/main.ts';
const TIERS = tiersFrom(process.env['E2E_TIER']);
/**
 * `E2E_SHARD` (the CI matrix and scripts/ci/e2e-split.sh forward it through run-all-checks.sh; unset runs everything):
 * one contiguous part of the run's queue (e2e/split.ts).
 */
const SHARD_RANGE = shardRangeFrom(process.env['E2E_SHARD']);
const SHARD = SHARD_RANGE === null ? null : shardOf(SHARD_RANGE);
/**
 * `E2E_ADMIN_PART` (scripts/ci/e2e-split.sh gives each machine one): this run's part of the admin projects. With a shard
 * as well, `split-reporter.ts` slices the other tiers without counting the admin tests (DECISIONS-for-review.md §32f).
 */
const ADMIN_PART = adminPartFrom(process.env['E2E_ADMIN_PART']);
const SPLIT_REPORTER = SHARD !== null && ADMIN_PART !== null ? [['./split-reporter.ts'] as const] : [];
/**
 * A run of the `tour-matrix` tier alone (stage `tour-matrix`, in `all` after the `e2e` stage) keeps its reports next to
 * the e2e stage's instead of over them: `reports/junit/e2e-tour-matrix.xml`, `reports/playwright-tour-matrix/`.
 */
const REPORT_SUFFIX = TIERS.length === 1 && TIERS[0] === 'tour-matrix' ? '-tour-matrix' : '';

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
    shard: SHARD,
    outputDir: `../reports/test-results${REPORT_SUFFIX}`,
    reporter: [
        ['list'],
        ['html', { open: 'never', outputFolder: `../reports/playwright${REPORT_SUFFIX}` }],
        ['junit', { outputFile: `../reports/junit/e2e${REPORT_SUFFIX}.xml` }],
        // A shard's results, for `playwright merge-reports` (scripts/ci/e2e-split.sh merges a split run's two parts).
        ...(SHARD === null ? [] : [['blob', { outputDir: `../reports/blob/e2e${REPORT_SUFFIX}` }] as const]),
        ...SPLIT_REPORTER,
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
    projects: e2eProjects(TIERS, ADMIN_PART),
});
