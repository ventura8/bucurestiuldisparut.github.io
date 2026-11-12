import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { cataloguePackPlugin } from '../../scripts/site/src/catalogue-pack.js';
import { cssLiteralsPlugin } from '../../scripts/site/src/css-literals.js';
import { thirdPartyNoticesPlugin } from '../../scripts/site/src/notices.js';
import { sidePartPlugin } from '../../scripts/site/src/side-part.js';
import { zodStandInsPlugin } from '../../scripts/site/src/zod-stand-ins.js';
import { FONT_FILES } from '../ui/src/fonts/font-files.js';

/**
 * Library build of the public viewer engine:
 * - dist/engine.iife.js exposes window.HistoricCityMap for <script> embedding (city starter kit, jsDelivr);
 * - dist/engine.mjs is the ES module build;
 * - dist/engine.css holds every stylesheet the engine imports.
 * Mapbox GL is never bundled: `mapbox-gl` resolves to the global `mapboxgl` that the page loads
 * from https://api.mapbox.com/mapbox-gl-js/v3.34.1/ (Mapbox terms, CDN caching, bundle budget).
 * - dist/THIRD_PARTY_NOTICES.txt lists every bundled npm package and the fonts' packages (the `fonts:copy` script copies
 *   the fonts next to it) with their licences (scripts/site/src/notices.ts; checked by the `notices` gate).
 * - The CSS of the Lit `css` templates is minified by `cssLiteralsPlugin` (scripts/site/src/css-literals.ts), as the admin's
 *   has been since DECISIONS-for-review.md §36: the bundler's minifier leaves a template literal's comments and indentation,
 *   about 6 KB gzip of the engine; with it the IIFE carries the consented field chunk (web-vitals, §76) within its budget.
 * - zod's JSON Schema conversion, which the engine never calls, resolves to the admin's stand-in that refuses
 *   (scripts/site/src/zod-stand-ins.ts; DECISIONS-for-review.md §100): about 6 KB gzip of both builds. zod's English
 *   messages, which the engine never shows (an issue reaches the visitor as its `validation.*` code), resolve to the admin's
 *   empty stand-in (§120a): about 1 KB gzip of both builds.
 * - The viewer's message catalogues are packed by `cataloguePackPlugin` (scripts/site/src/catalogue-pack.ts,
 *   DECISIONS-for-review.md §127a): the same objects, built from one string of keys and an array of texts, about 270 bytes
 *   gzip of the IIFE.
 * - dist/engine.extras.js is the side-loaded full-size view (docs/ENGINE_API.md → *Side-loaded parts*), built first by
 *   `vite.part.config.ts` into .tsbuild/part/; `sidePartPlugin` (scripts/site/src/side-part.ts) writes its Subresource
 *   Integrity into src/extras-part.ts, which both builds load it with, and serves it here (the owner's "Load extras on
 *   demand", 2026-11-09: about 1.5 KB gzip out of the IIFE).
 */
export default defineConfig({
    plugins: [
        zodStandInsPlugin({
            jsonSchema: fileURLToPath(new URL('../admin/src/vendor/zod-json-schema-unsupported.ts', import.meta.url)),
            messages: fileURLToPath(new URL('../admin/src/vendor/zod-locale-none.ts', import.meta.url)),
        }),
        cssLiteralsPlugin(),
        cataloguePackPlugin(/[\\/]packages[\\/]shared[\\/]src[\\/]i18n[\\/]/),
        sidePartPlugin({
            built: fileURLToPath(new URL('.tsbuild/part/engine.extras.js', import.meta.url)),
            constantModule: fileURLToPath(new URL('src/extras-part.ts', import.meta.url)),
            fileName: 'engine.extras.js',
        }),
        thirdPartyNoticesPlugin({
            product: 'the Historic City Map Maker engine (engine.mjs, engine.iife.js, their chunks and fonts)',
            assets: FONT_FILES.map((font) => ({ package: font.source.package, file: `fonts/${font.file}` })),
        }),
    ],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: true,
        lib: {
            entry: 'src/index.ts',
            name: 'HistoricCityMap',
            formats: ['iife', 'es'],
            fileName: (format) => (format === 'es' ? 'engine.mjs' : `engine.${format}.js`),
            cssFileName: 'engine',
        },
        rolldownOptions: {
            external: ['mapbox-gl'],
            // engine.mjs stays the whole entry: what the lazy chunks (swipe compare's `compare-<hash>.js`, the consented
            // `firebase-sdk-<hash>.js`) share with it, they import from engine.mjs, which may export those bindings too.
            // Vite's library default ('strict') moved everything shared into a third chunk that engine.mjs imported at
            // once (`map-sync-<hash>.js`, 44.6 KB: M4 compare, docs/research/M4-interfaces.md §3.2). The IIFE has one chunk.
            preserveEntrySignatures: 'allow-extension',
            output: {
                globals: { 'mapbox-gl': 'mapboxgl' },
                // engine.mjs is a page script that nothing bundles again: minify it like the IIFE.
                minify: true,
            },
        },
    },
});
