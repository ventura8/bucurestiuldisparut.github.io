// Builds the Cloud Functions deploy artifact (firebase.json "functions.source"): dist/index.js, dist/package.json, the
// dist/package-lock.json of functions/deploy-lock/ and one dist/.env.<project> per project of deploy-env.json.
// `npm run build --workspace @hcm/functions`; firebase deploy runs it as predeploy.
//
// Bundler: Vite 8 (Rolldown) in SSR mode, the monorepo's bundler already, rather than a second one
// (esbuild). Everything is bundled in (the workspace packages, TypeScript source never published, and
// their own npm dependencies such as zod) except the npm dependencies of functions/package.json, which
// stay external: Cloud Build installs them from dist/package.json, which copies their exact pins. The
// artifact lives in dist/ because every tool (git, ESLint, Prettier, dependency-cruiser, Sonar) already
// ignores dist/ directories.
//
// The static export's kit (M5, docs/research/M5-interfaces.md §5.3, CR-M5-9) is copied beside the bundle into
// dist/export-kit/: the starter kit's index.html and README.md (templates/starter-kit/), the engine's files without
// source maps (packages/engine/dist: engine.iife.js, engine.css, fonts/, THIRD_PARTY_NOTICES.txt, so the engine is built
// first, as `npm run build` does) and kit.json, the engine's ENGINE_VERSION and every copied file with its size.
//
// Four checks run on the result, because a broken artifact would only show at deploy time:
// 1. every bare import left in dist/index.js, static or dynamic, is a Node built-in or a dependency dist/package.json
//    pins (a dependency of @hcm/shared left external would install nothing and crash at cold start);
// 2. functions/deploy-lock/ was made for exactly this package.json (DECISIONS-for-review.md §22b: Cloud Build then
//    installs the locked tree with `npm ci`); a stale lock names the command that refreshes it;
// 3. deploy-env.json holds only public `HCM_*` values (DECISIONS-for-review.md §22a; secrets live in Secret Manager);
// 4. dist/index.js loads the way firebase-tools loads it for discovery, and every export is a group of
//    functions that each carry a deploy manifest (`__endpoint`).
import { copyFile, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

import { build } from 'vite';

import { deployManifest, externalDependencies, manifestText } from './deploy-manifest.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const manifest = await readJson(here('package.json'));
const external = externalDependencies(manifest);

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

// The export kit: the page and README of the starter kit, and the engine the export carries beside its page.
const KIT_DIR = here('dist/export-kit/');
const ENGINE_DIST = here('../packages/engine/dist/');
const ENGINE_FILES = ['engine.iife.js', 'engine.css', 'THIRD_PARTY_NOTICES.txt'];
const ENGINE_VERSION = /^export const ENGINE_VERSION = '(\d{1,4}\.\d{1,4}\.\d{1,6})';$/m;
const engineVersion = ENGINE_VERSION.exec(await readFile(here('../packages/engine/src/index.ts'), 'utf8'))?.[1];
if (engineVersion === undefined) {
    throw new Error('packages/engine/src/index.ts declares no ENGINE_VERSION the export kit can record');
}
await mkdir(`${KIT_DIR}engine`, { recursive: true });
for (const file of ['index.html', 'README.md']) {
    await copyFile(here(`../templates/starter-kit/${file}`), `${KIT_DIR}${file}`);
}
try {
    for (const file of ENGINE_FILES) {
        await copyFile(`${ENGINE_DIST}${file}`, `${KIT_DIR}engine/${file}`);
    }
    await cp(`${ENGINE_DIST}fonts`, `${KIT_DIR}engine/fonts`, { recursive: true });
} catch (error) {
    throw new Error(`the export kit needs the engine's build (npm run build --workspace @hcm/engine first): ${String(error)}`, {
        cause: error,
    });
}
const fonts = (await readdir(`${KIT_DIR}engine/fonts`)).sort().map((file) => `fonts/${file}`);
const engine = await Promise.all(
    [...ENGINE_FILES, ...fonts].sort().map(async (path) => ({ path, bytes: (await stat(`${KIT_DIR}engine/${path}`)).size })),
);
await writeFile(`${KIT_DIR}kit.json`, `${JSON.stringify({ engineVersion, engine }, null, 4)}\n`);

const artifactManifest = manifestText(deployManifest(manifest, await readJson(here('../package.json'))));
await writeFile(here('dist/package.json'), artifactManifest);

// The locked dependency tree, made for exactly this package.json.
const REFRESH_LOCK = 'refresh it with `node functions/deploy-lock.mjs` in the pinned Node image (comment in that file)';
if ((await readFile(here('deploy-lock/package.json'), 'utf8')) !== artifactManifest) {
    throw new Error(`functions/deploy-lock/package.json differs from the artifact's package.json: ${REFRESH_LOCK}`);
}
const lockRoot = (await readJson(here('deploy-lock/package-lock.json'))).packages?.[''] ?? {};
if (JSON.stringify(lockRoot.dependencies) !== JSON.stringify(JSON.parse(artifactManifest).dependencies)) {
    throw new Error(`functions/deploy-lock/package-lock.json locks other dependencies than the artifact pins: ${REFRESH_LOCK}`);
}
await copyFile(here('deploy-lock/package-lock.json'), here('dist/package-lock.json'));

// The deploy-time configuration: firebase-tools loads dist/.env.<project> for that project only. Public values only.
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const PUBLIC_KEY = /^HCM_[A-Z0-9_]+$/;
for (const [project, values] of Object.entries(await readJson(here('deploy-env.json')))) {
    const lines = Object.entries(values).map(([key, value]) => {
        if (!PROJECT_ID.test(project) || !PUBLIC_KEY.test(key) || typeof value !== 'string' || /[\r\n]/.test(value)) {
            throw new Error(`deploy-env.json: ${project} ${key} must be a project id with HCM_* keys and one-line string values`);
        }
        return `${key}=${value}`;
    });
    await writeFile(here(`dist/.env.${project}`), `${lines.join('\n')}\n`);
}

/** The package a bare specifier names: `firebase-admin/app` → `firebase-admin`, `@scope/pkg/x` → `@scope/pkg`. */
function packageOf(specifier) {
    const parts = specifier.split('/');
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const bundle = await readFile(here('dist/index.js'), 'utf8');
// Static imports, and dynamic ones (sharp is loaded on the first photo): both must resolve at deploy time.
const specifiers = [
    ...[...bundle.matchAll(/^import\s[^'"]*?["']([^"'./][^"']*)["'];?$/gm)].map((match) => match[1]),
    ...[...bundle.matchAll(/\bimport\(\s*["']([^"'./][^"']*)["']\s*\)/g)].map((match) => match[1]),
];
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
