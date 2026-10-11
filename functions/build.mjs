// Builds the Cloud Functions deploy artifact (firebase.json "functions.source"): dist/index.js plus
// dist/package.json. `npm run build --workspace @hcm/functions`; firebase deploy runs it as predeploy.
//
// Bundler: Vite 8 (Rolldown) in SSR mode, the monorepo's bundler already, rather than a second one
// (esbuild). The workspace packages (@hcm/*, TypeScript source, never published) are bundled in;
// every npm dependency stays external and Cloud Build installs it from dist/package.json, which
// copies the exact pins of functions/package.json. The artifact lives in dist/ because every tool
// (git, ESLint, Prettier, dependency-cruiser, Sonar) already ignores dist/ directories.
import { readFile, writeFile } from 'node:fs/promises';
import { URL, fileURLToPath } from 'node:url';

import { build } from 'vite';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const manifest = JSON.parse(await readFile(here('package.json'), 'utf8'));
const external = Object.keys(manifest.dependencies).filter((name) => !name.startsWith('@hcm/'));

await build({
    configFile: false,
    root: here('.'),
    logLevel: 'warn',
    build: {
        ssr: 'src/index.ts',
        outDir: 'dist',
        emptyOutDir: true,
        target: 'node24',
        minify: false,
        sourcemap: false,
        rolldownOptions: { output: { format: 'es', entryFileNames: 'index.js' } },
    },
    ssr: { target: 'node', noExternal: [/^@hcm\//], external },
});

const deployManifest = {
    name: 'hcm-functions',
    version: manifest.version,
    private: true,
    type: 'module',
    main: 'index.js',
    engines: manifest.engines,
    dependencies: Object.fromEntries(external.map((name) => [name, manifest.dependencies[name]])),
};
await writeFile(here('dist/package.json'), `${JSON.stringify(deployManifest, null, 4)}\n`);
