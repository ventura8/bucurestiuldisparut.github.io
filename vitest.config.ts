import { existsSync } from 'node:fs';

import { playwright } from '@vitest/browser-playwright';
import { defineConfig, type TestProjectInlineConfiguration } from 'vitest/config';

/**
 * One Vitest run for every TypeScript test project, so coverage is merged into a single
 * report (reports/coverage/ts/lcov.info) with repo-relative paths for Sonar and the per-file gate.
 *
 * A suite is enabled only once its workspace exists (has a package.json): functions/ and
 * firebase/rules-tests/ are placeholders until M2. Adding a package = adding a row here
 * (docs/research/M0-handoff.md).
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

/** Lit components need real custom elements, shadow DOM and accessibility trees: headless Chromium. */
const chromium = {
    enabled: true,
    provider: playwright(),
    headless: true,
    screenshotFailures: false,
    instances: [{ browser: 'chromium' as const }],
};

const SUITES: readonly Suite[] = [
    {
        dir: 'packages/shared',
        project: { extends: true, test: { name: 'shared', environment: 'node', include: ['packages/shared/test/**/*.test.ts'] } },
        coverage: ['packages/shared/src/**/*.ts'],
    },
    {
        dir: 'packages/ui',
        project: { extends: true, test: { name: 'ui', include: ['packages/ui/test/**/*.test.ts'], browser: chromium } },
        coverage: ['packages/ui/src/**/*.ts'],
    },
    {
        dir: 'packages/engine',
        project: { extends: true, test: { name: 'engine', environment: 'node', include: ['packages/engine/test/**/*.test.ts'] } },
        coverage: ['packages/engine/src/**/*.ts'],
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
