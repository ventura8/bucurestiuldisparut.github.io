import { defineConfig } from 'vite';

import { cssLiteralsPlugin } from '../../scripts/site/src/css-literals.js';

/**
 * Library build of the admin app: the ES module entry `dist/admin.mjs`, its lazy chunks next to it and `dist/admin.css`.
 * The page Hosting serves (scripts/site's admin target) holds `<hcm-admin-shell>` and loads `admin.mjs` as a module
 * script, which starts itself (`src/index.ts`). Each editor area's page and store (`src/pages/<area>.ts`), Terra Draw
 * (`@hcm/ui/map/draw`'s loader), the colour library and the analytics SDK are chunks fetched when first needed
 * (DECISIONS-for-review.md §34b); `scripts/ci/check_bundle_budget.py` measures the entry and every chunk. There is no IIFE:
 * an IIFE inlines every dynamic import, and the admin is not distributed for embedding (the engine's IIFE is, on jsDelivr).
 * Mapbox GL stays external exactly as in the engine build.
 *
 * The build is minified (DECISIONS-for-review.md §36): its JavaScript like the engine's (`minify: true`, §17a), and the
 * CSS of the Lit `css` templates by `cssLiteralsPlugin` (scripts/site/src/css-literals.ts), since a template literal's
 * text is beyond the bundler's minifier.
 *
 * Modes (`vite build --mode <mode>`, read in the code as `import.meta.env.MODE`):
 * - `production` (`npm run build`): Firebase's Google popup, App Check when `runtime.json` names a site key;
 * - `e2e` (`npm run build:e2e`): Auth, Firestore, Storage and Functions on the emulators of `firebase.json` and the OAuth
 *   stand-in of the mock APIs instead of Google's popup (docs/research/M2b-interfaces.md §2.6). The mode is a constant
 *   for the bundler, so the production build carries neither the emulator settings nor the stand-in's page logic.
 */
/** The admin map's modules: its box and elements, and the content it draws for every area that shows it. */
const ADMIN_MAP_MODULES =
    /packages[\\/](?:ui[\\/]src[\\/]admin[\\/]map[\\/]|admin[\\/]src[\\/](?:photos[\\/]map|pois[\\/](?:map-session|model)|layers[\\/](?:map-session|preview))\.ts)/;

export default defineConfig({
    plugins: [cssLiteralsPlugin()],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: true,
        lib: {
            entry: 'src/index.ts',
            formats: ['es'],
            fileName: () => 'admin.mjs',
            cssFileName: 'admin',
        },
        rolldownOptions: {
            external: ['mapbox-gl'],
            output: {
                // admin.mjs and its chunks are page scripts that nothing bundles again: minified (the engine's §17a).
                minify: true,
                // Named chunks, so the bundle budget can give each its own: without groups Rolldown splits the code the
                // entry shares with an area into a dozen small chunks named after a module each, which a refactor renames.
                // `admin-core`: everything the entry imports statically (admin.mjs is then a two-line stub that imports it);
                // `editor-shared`: what two or more areas share and the entry does not; `terra-draw`: both Terra Draw packages;
                // `admin-map`: the admin map's box and what it draws (the city's layers, photos and places), which the
                // layers, places, photos and settings areas show (DECISIONS-for-review.md §42a).
                codeSplitting: {
                    groups: [
                        { name: 'terra-draw', test: /node_modules[\\/]terra-draw/, priority: 4 },
                        { name: 'admin-core', tags: ['$initial'], priority: 3 },
                        { name: 'admin-map', test: ADMIN_MAP_MODULES, priority: 2 },
                        { name: 'editor-shared', minShareCount: 2, priority: 1 },
                    ],
                },
            },
        },
    },
});
