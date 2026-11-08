import { defineConfig } from 'vite';

import { cssLiteralsPlugin } from '../../scripts/site/src/css-literals.js';

/**
 * The start page's build (`docs/research/M14-start-your-map.md`): one ES module, relative addresses so the tree works on any
 * static host, apart from the admin's folder and its budgets (row `start` of `scripts/ci/check_bundle_budget.py`). `e2e`
 * points the consent at the mock APIs' stand-in; the mode is a constant for the bundler, so production carries neither.
 */
export default defineConfig({
    base: './',
    plugins: [cssLiteralsPlugin()],
    build: {
        outDir: '../../dist/start-app',
        emptyOutDir: true,
        minify: true,
        sourcemap: false,
        lib: { entry: 'src/start/index.ts', formats: ['es'], fileName: () => 'start.mjs' },
    },
});
