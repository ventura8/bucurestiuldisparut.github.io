import { defineConfig } from 'vite';

/**
 * Library build of the admin app (dist/admin.iife.js exposing window.HistoricCityMapAdmin,
 * dist/admin.mjs, dist/admin.css). Mapbox GL stays external exactly as in the engine build.
 */
export default defineConfig({
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
            },
        },
    },
});
