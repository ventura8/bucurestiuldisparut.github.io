// Builds the Cloud Functions deploy artifact (firebase.json "functions.source"): dist/index.js plus
// dist/package.json. `npm run build --workspace @hcm/functions`; firebase deploy runs it as predeploy.
//
// Bundler: Vite 8 (Rolldown) in SSR mode, the monorepo's bundler already, rather than a second one
// (esbuild). Everything is bundled in (the workspace packages, TypeScript source never published, and
// their own npm dependencies such as zod) except the npm dependencies of functions/package.json, which
// stay external: Cloud Build installs them from dist/package.json, which copies their exact pins. The
// artifact lives in dist/ because every tool (git, ESLint, Prettier, dependency-cruiser, Sonar) already
// ignores dist/ directories.
//
// Two checks run on the result, because a broken artifact would only show at deploy time:
// 1. every bare import left in dist/index.js is a Node built-in or a dependency dist/package.json pins
//    (a dependency of @hcm/shared left external would install nothing and crash at cold start);
// 2. dist/index.js loads the way firebase-tools loads it for discovery, and every export is a group of
//    functions that each carry a deploy manifest (`__endpoint`).
import { readFile, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import process from 'node:process';
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
    ssr: { target: 'node', noExternal: true, external },
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

/** The package a bare specifier names: `firebase-admin/app` → `firebase-admin`, `@scope/pkg/x` → `@scope/pkg`. */
function packageOf(specifier) {
    const parts = specifier.split('/');
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const bundle = await readFile(here('dist/index.js'), 'utf8');
const specifiers = [...bundle.matchAll(/^import\s[^'"]*?["']([^"'./][^"']*)["'];?$/gm)].map((match) => match[1]);
const builtins = new Set(builtinModules);
const undeclared = [...new Set(specifiers)].filter(
    (specifier) => !specifier.startsWith('node:') && !builtins.has(specifier) && !external.includes(packageOf(specifier)),
);
if (undeclared.length > 0) {
    throw new Error(`dist/index.js imports packages dist/package.json does not pin: ${undeclared.join(', ')}`);
}

// Discovery loads the module with the project in the environment; nothing may run before a function is called.
process.env.GCLOUD_PROJECT ??= 'demo-hcm';
const groups = await import('./dist/index.js');
const functions = Object.entries(groups).flatMap(([group, members]) =>
    Object.entries(members).map(([key, fn]) => ({ name: `${group}-${key}`, endpoint: fn?.__endpoint })),
);
const broken = functions.filter((fn) => fn.endpoint === undefined).map((fn) => fn.name);
if (functions.length === 0 || broken.length > 0) {
    throw new Error(`dist/index.js exports no deployable functions or exports without a manifest: ${broken.join(', ')}`);
}
process.stdout.write(`functions/dist: ${String(functions.length)} functions, dependencies ${external.join(', ')}\n`);
