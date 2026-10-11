import { defineConfig } from '@playwright/test';

/**
 * Playwright 1.64 end-to-end configuration (docs/research/design-review-testability.md §4.2-4.3).
 * Runs inside the quality image only: `PIPELINE_STAGE=e2e bash scripts/ci/run-all-checks.sh` (gate `playwright`,
 * `npm run test:e2e`). Paths are relative to this file (the e2e/ workspace); reports land in the repository's
 * reports/ folder, where the CI workflow collects them.
 *
 * Today one project runs the harness smoke (specs/smoke.spec.ts). M1 adds the functional matrix, the tour,
 * the a11y specials, no-WebGL and the cross-browser projects, and a `webServer` that serves the built viewer.
 */
/** Loopback origin of the pages under test. Nothing listens here yet: the smoke spec fulfils its page itself. */
const ORIGIN = 'http://127.0.0.1:4310';

/** Only loopback resolves in Chromium: defence in depth behind the firewall fixture (support/test.ts). */
const HOST_RULES = '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost';
/** WebGL without a GPU: ANGLE on SwiftShader, which the containers and CI runners always have. */
const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', HOST_RULES];

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

export default defineConfig({
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
    use: {
        baseURL: ORIGIN,
        trace: 'retain-on-failure',
        locale: 'ro-RO',
        timezoneId: 'Europe/Bucharest',
        serviceWorkers: 'block',
    },
    projects: [
        {
            name: 'smoke-chromium',
            use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, launchOptions: { args: GL_ARGS } },
        },
    ],
});
