import { defineConfig } from '@playwright/test';

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
 * 127.0.0.1:4310 and the mock APIs on 127.0.0.1:4311. The tiers and their projects are e2e/projects.ts; `E2E_TIER`
 * picks them (`smoke,fn`; unset is all) and `E2E_SHARD` = "index/total" splits a run across CI jobs.
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
/** Both servers run from the repository root, through Node's type stripping (scripts/site/register-ts.mjs). */
const SERVER = 'node --import ./scripts/site/register-ts.mjs e2e/mock-apis/main.ts';

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
    ],
    projects: e2eProjects(tiersFrom(process.env['E2E_TIER'])),
});
