import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Unit tests of the static site build (`npm run test:site`, gate `site-unit` of the tests stage).
 *
 * A separate configuration because the repository's `vitest.config.ts` is ask-first and has no project for the Node
 * tooling under scripts/ yet (change request CR-2, docs/research/DECISIONS-for-review.md §9 and §12). Same bar as every
 * other suite: at least 90 % per file on all four metrics, never lowered. When the root configuration gains its
 * `tools` project, these tests move there (its glob for scripts/<tool>/test already matches them) and this file goes.
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
    root: ROOT,
    test: {
        name: 'site',
        environment: 'node',
        include: ['scripts/site/test/**/*.test.ts'],
        reporters: ['default', ['junit', { outputFile: 'reports/junit/site.xml' }]],
        coverage: {
            enabled: true,
            provider: 'v8',
            reportsDirectory: 'reports/coverage/site',
            reporter: ['text', 'lcov', 'json-summary'],
            include: ['scripts/site/src/**/*.ts'],
            thresholds: { perFile: true, lines: 90, branches: 90, functions: 90, statements: 90 },
        },
    },
});
