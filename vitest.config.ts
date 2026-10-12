import { existsSync } from 'node:fs';

import { playwright } from '@vitest/browser-playwright';
import { defineConfig, type TestProjectInlineConfiguration } from 'vitest/config';

/**
 * One Vitest run for every TypeScript test project, so coverage is merged into a single
 * report (reports/coverage/ts/lcov.info) with repo-relative paths for Sonar and the per-file gate.
 *
 * A suite is enabled only once its directory has a package.json (the repository root for the `tools` row). Adding a
 * package = adding a row here (docs/research/M0-handoff.md).
 */
interface Suite {
    /** Workspace directory; the suite runs only when `<dir>/package.json` exists. */
    readonly dir: string;
    readonly project: TestProjectInlineConfiguration;
    /**
     * Source files measured by coverage. Vitest 5 reports only files listed here, so every
     * product package must list its src/ explicitly or untested files silently vanish.
     */
    readonly coverage: readonly string[];
}

/**
 * Lit components need real custom elements, shadow DOM and accessibility trees: headless Chromium. A fresh object per
 * project: Vitest names each browser instance after its project, so two projects sharing one instance object clash.
 */
function chromium() {
    return {
        enabled: true,
        provider: playwright(),
        headless: true,
        screenshotFailures: false,
        instances: [{ browser: 'chromium' as const }],
    };
}

/**
 * What the browser projects import from node_modules, pre-bundled before the first test: on a cold Vite cache (every CI
 * run; `npm ci` deletes node_modules/.vite) a dependency discovered mid-run re-optimises and reloads the page, which
 * fails the test and can load Lit twice. A new Lit directive or browser-test dependency joins this list in the same change.
 * `@hcm/test-support > axe-core` is the test kit's own axe-core 4.14 (the root one is the 4.13 of @axe-core/playwright).
 */
const BROWSER_TEST_DEPS = [
    'lit',
    'lit/directive.js',
    'lit/directives/class-map.js',
    'lit/directives/keyed.js',
    'lit/directives/repeat.js',
    'zod',
    '@material/material-color-utilities',
    '@hcm/test-support > axe-core',
];

const SUITES: readonly Suite[] = [
    {
        dir: 'packages/shared',
        project: { extends: true, test: { name: 'shared', environment: 'node', include: ['packages/shared/test/**/*.test.ts'] } },
        coverage: ['packages/shared/src/**/*.ts'],
    },
    {
        dir: 'packages/ui',
        project: {
            extends: true,
            // Pre-bundle what the browser tests import, so a cold cache (every CI run) never re-optimises and reloads a test.
            optimizeDeps: { include: BROWSER_TEST_DEPS },
            test: { name: 'ui', include: ['packages/ui/test/**/*.test.ts'], browser: chromium() },
        },
        coverage: ['packages/ui/src/**/*.ts'],
    },
    {
        dir: 'packages/engine',
        project: {
            extends: true,
            test: {
                name: 'engine',
                environment: 'node',
                include: ['packages/engine/test/**/*.test.ts'],
                exclude: ['packages/engine/test/browser/**'],
            },
        },
        coverage: ['packages/engine/src/**/*.ts'],
    },
    {
        // What the engine needs from a real browser (animation frames, ResizeObserver, canvas, WebGL 2); same coverage scope as `engine`.
        dir: 'packages/engine',
        project: {
            extends: true,
            optimizeDeps: { include: BROWSER_TEST_DEPS },
            test: { name: 'engine-browser', include: ['packages/engine/test/browser/**/*.test.ts'], browser: chromium() },
        },
        coverage: [],
    },
    {
        dir: 'packages/admin',
        project: { extends: true, test: { name: 'admin', environment: 'node', include: ['packages/admin/test/**/*.test.ts'] } },
        coverage: ['packages/admin/src/**/*.ts'],
    },
    {
        dir: 'functions',
        project: { extends: true, test: { name: 'functions', environment: 'node', include: ['functions/test/**/*.test.ts'] } },
        coverage: ['functions/src/**/*.ts'],
    },
    {
        dir: 'firebase/rules-tests',
        // Rules are measured by the emulator's rule-coverage report (check_rules_coverage.py), not by v8.
        project: { extends: true, test: { name: 'rules', environment: 'node', include: ['firebase/rules-tests/test/**/*.test.ts'] } },
        coverage: [],
    },
    {
        // The Node tooling: JavaScript CLIs driven as child processes (their logic is TypeScript measured in its own package)
        // and the static site build, which is product code: it writes the page, its CSP and the served manifest.
        dir: '.',
        project: {
            extends: true,
            test: {
                name: 'tools',
                environment: 'node',
                include: ['scripts/*/test/**/*.test.ts', 'packages/*/scripts/test/**/*.test.ts'],
                // These tests start Node processes and copy the 46 MB of legacy originals, next to every other project of the
                // run: 5 s per test (Vitest's default) is a wall-clock bet, not a behaviour.
                testTimeout: 30_000,
            },
        },
        coverage: ['scripts/site/src/**/*.ts'],
    },
];

const present = SUITES.filter((suite) => existsSync(`${suite.dir}/package.json`));

export default defineConfig({
    test: {
        projects: present.map((suite) => suite.project),
        reporters: ['default', ['junit', { outputFile: 'reports/junit/vitest.xml' }]],
        coverage: {
            provider: 'v8',
            reportsDirectory: 'reports/coverage/ts',
            reporter: ['text', 'lcov', 'json-summary'],
            include: present.flatMap((suite) => suite.coverage),
            exclude: ['**/*.d.ts'],
            // >=90% for EVERY file, all four metrics. Never lowered, never auto-updated (AGENTS rules).
            thresholds: { perFile: true, lines: 90, branches: 90, functions: 90, statements: 90 },
        },
    },
});
