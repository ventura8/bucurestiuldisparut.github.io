import { defineConfig } from 'vite';

import { cssLiteralsPlugin } from '../../scripts/site/src/css-literals.js';

/**
 * Library build of the admin app (dist/admin.iife.js exposing window.HistoricCityMapAdmin, dist/admin.mjs,
 * dist/admin.css). The page Hosting serves (scripts/site's admin target) holds `<hcm-admin-shell>` and loads the IIFE,
 * which starts itself (`src/index.ts`). Mapbox GL stays external exactly as in the engine build.
 *
 * Both builds are minified (DECISIONS-for-review.md §36): the IIFE by Vite's library mode as before, `admin.mjs` like the
 * engine's (`minify: true`, §17a), and the CSS of the Lit `css` templates by `cssLiteralsPlugin`
 * (scripts/site/src/css-literals.ts), since a template literal's text is beyond the bundler's minifier.
 *
 * Modes (`vite build --mode <mode>`, read in the code as `import.meta.env.MODE`):
 * - `production` (`npm run build`): Firebase's Google popup, App Check when `runtime.json` names a site key;
 * - `e2e` (`npm run build:e2e`): Auth, Firestore, Storage and Functions on the emulators of `firebase.json` and the OAuth
 *   stand-in of the mock APIs instead of Google's popup (docs/research/M2b-interfaces.md §2.6). The mode is a constant
 *   for the bundler, so the production build carries neither the emulator settings nor the stand-in's page logic.
 */
export default defineConfig({
    plugins: [cssLiteralsPlugin()],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: true,
        lib: {
            entry: 'src/index.ts',
            name: 'HistoricCityMapAdmin',
            formats: ['iife', 'es'],
            fileName: (format) => (format === 'es' ? 'admin.mjs' : `admin.${format}.js`),
            cssFileName: 'admin',
        },
        rolldownOptions: {
            external: ['mapbox-gl'],
            output: {
                globals: { 'mapbox-gl': 'mapboxgl' },
                // admin.mjs is a page script that nothing bundles again: minify it like the IIFE (the engine's §17a).
                minify: true,
            },
        },
    },
});
