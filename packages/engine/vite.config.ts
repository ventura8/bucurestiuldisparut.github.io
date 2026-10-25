import { defineConfig } from 'vite';

import { thirdPartyNoticesPlugin } from '../../scripts/site/src/notices.js';
import { FONT_FILES } from '../ui/src/fonts/font-files.js';

/**
 * Library build of the public viewer engine:
 * - dist/engine.iife.js exposes window.HistoricCityMap for <script> embedding (city starter kit, jsDelivr);
 * - dist/engine.mjs is the ES module build;
 * - dist/engine.css holds every stylesheet the engine imports.
 * Mapbox GL is never bundled: `mapbox-gl` resolves to the global `mapboxgl` that the page loads
 * from https://api.mapbox.com/mapbox-gl-js/v3.32.0/ (Mapbox terms, CDN caching, bundle budget).
 * - dist/THIRD_PARTY_NOTICES.txt lists every bundled npm package and the fonts' packages (the `fonts:copy` script copies
 *   the fonts next to it) with their licences (scripts/site/src/notices.ts; checked by the `notices` gate).
 */
export default defineConfig({
    plugins: [
        thirdPartyNoticesPlugin({
            product: 'the Historic City Map engine (engine.mjs, engine.iife.js, their chunks and fonts)',
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
