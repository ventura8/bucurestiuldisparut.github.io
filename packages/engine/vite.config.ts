import { defineConfig } from 'vite';

/**
 * Library build of the public viewer engine:
 * - dist/engine.iife.js exposes window.HistoricCityMap for <script> embedding (city starter kit, jsDelivr);
 * - dist/engine.mjs is the ES module build;
 * - dist/engine.css holds every stylesheet the engine imports.
 * Mapbox GL is never bundled: `mapbox-gl` resolves to the global `mapboxgl` that the page loads
 * from https://api.mapbox.com/mapbox-gl-js/v3.32.0/ (Mapbox terms, CDN caching, bundle budget).
 */
export default defineConfig({
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
            output: {
                globals: { 'mapbox-gl': 'mapboxgl' },
            },
        },
    },
});
