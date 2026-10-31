/**
 * The install bundle (`docs/research/M6-interfaces.md` §1.3), made by the site build from the same checkout as the admin
 * (`npm run build:install`, after `build:hosting` and the functions' build: CR-M6-5) into each Hosting tree it is given,
 * at `admin/install/<slug>/`:
 *
 * - `server.tgz`: `functions/dist/` (the bundle, its `package.json`, its deploy lock, `.env.<project>` with `HCM_RELEASE`,
 *   the export kit; an allowlist, so nothing else, a local secret file least of all, is ever published),
 *   a `firebase.json` of the server's parts (no `predeploy`), the Firestore and Storage rules and indexes, `.firebaserc`,
 *   `tools/` (the locked `firebase-tools`, with the vendored copies its lock links to) and `steps/`;
 * - `pipeline.tgz`: the raster pipeline's Docker context (no tests) and `steps/`;
 * - `hosting.tgz`: the public Hosting tree under `public/` without `admin/install/**`, a `firebase.json` of Hosting
 *   only, `.firebaserc`, `tools/` and `steps/`;
 * - `manifest.json` (`installManifestSchema`): the release, the slug, the project, each tarball's size and SHA-256,
 *   the server's functions, the tools by digest and the build estimates.
 *
 * Deterministic: the same commit gives the same bytes (`tar.ts`; the entries' time is `SOURCE_DATE_EPOCH`, else 0).
 */
import { createHash } from 'node:crypto';

import {
    BACKGROUND_FUNCTIONS,
    CALLABLES,
    deployedName,
    FIREBASE_TOOLS_VERSION,
    HTTP_ENDPOINTS,
    INSTALL_BUNDLE_FILES,
    INSTALL_ESTIMATES,
    INSTALL_FOLDER,
    INSTALL_FORMAT,
    INSTALL_MANIFEST_FILE,
    installManifestSchema,
    installReleaseSlug,
    type InstallManifest,
    type InstallTarget,
} from '@hcm/shared';

import { adminRelease, type BuildEnvironment } from '../admin/runtime.js';
import { SiteBuildError } from '../errors.js';
import type { SiteFileSystem } from '../files.js';
import { tgz, type TarEntry } from './tar.js';
import { toolsFolder, type Lockfile, type RootManifest } from './tools-lock.js';

/** The Node image of every Node step, by digest: the quality image's own pin (`docker/Dockerfile.quality`, a test keeps them equal). */
export const NODE_STEP_IMAGE = 'node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20';

/**
 * The Docker builder of the pipeline's steps, by digest: none until its digest is read (`DECISIONS-for-review.md` §67e,
 * NOT APPLIED: reading it is a network request); until then the admin's pipeline card says the in-app install is not
 * available in this release.
 */
const DOCKER_STEP_IMAGE: string | null = null;

/** The raster pipeline's Docker context in the bundle (its tests stay out). */
const PIPELINE_FILES = ['Dockerfile', 'pyproject.toml', 'poetry.lock', 'requirements-poetry.txt', 'README.md'] as const;
const PIPELINE_SOURCE = 'pipeline/src/hcm_pipeline';
const RULE_FILES = ['firebase/firestore.rules', 'firebase/firestore.indexes.json', 'firebase/storage.rules'] as const;

/**
 * The files of the functions' build the server's tarball may carry, and nothing else (finding 5 of the M6 security
 * review): the bundle is served to anyone, and firebase-tools' own `*.local` exclusion does not apply to it, so a
 * `.secret.local` or `.env.local` left in `functions/dist` must fail the build rather than be published.
 */
const SERVER_FILES: readonly RegExp[] = [
    /^index\.js$/,
    /^package\.json$/,
    /^package-lock\.json$/,
    /^\.env\.[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
    /^export-kit\/[^/].*$/,
];

/** `functions/dist`'s files, refusing any the allowlist does not name. */
function serverFiles(files: SiteFileSystem, dir: string): TarEntry[] {
    const unexpected = files.listFiles(dir).filter((path) => !SERVER_FILES.some((pattern) => pattern.test(path)));
    if (unexpected.length > 0) {
        throw new SiteBuildError(`the install bundle carries only the functions' build; ${dir} also holds ${unexpected.join(', ')}`);
    }
    return folderEntries(files, dir, 'functions/dist/');
}

export interface InstallBundleOptions {
    /** The public Hosting tree (`build:hosting`'s `--public-out`): `hosting.tgz`. */
    readonly publicTree: string;
    /** The Hosting trees the bundle folder is written into (the deployed one). */
    readonly out: readonly string[];
    /** The functions' deploy artifact (`npm run build --workspace @hcm/functions`). */
    readonly functionsDir: string;
    readonly env: BuildEnvironment;
}

export interface InstallBundleReport {
    readonly release: string;
    readonly slug: string;
    readonly bytes: Readonly<Record<InstallTarget, number>>;
}

/** The step scripts as the bundle carries them (`steps-bundle.ts`): path → bytes. */
export type StepFiles = ReadonlyMap<string, Uint8Array>;

const encoder = new TextEncoder();

function json(value: unknown): Uint8Array {
    return encoder.encode(`${JSON.stringify(value, null, 4)}\n`);
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/** The registry's deployed function names, sorted: the server's expected set. */
export function expectedFunctionNames(): string[] {
    return [...Object.keys(CALLABLES), ...Object.keys(HTTP_ENDPOINTS), ...Object.keys(BACKGROUND_FUNCTIONS)]
        .map(deployedName)
        .sort((left, right) => (left < right ? -1 : 1));
}

/** The entries' time: `SOURCE_DATE_EPOCH` when it is a whole number of seconds, else 0. */
export function entryTime(env: BuildEnvironment): number {
    const value = env['SOURCE_DATE_EPOCH'] ?? '';
    return /^\d{1,12}$/.test(value) ? Number(value) : 0;
}

/** Every file below `dir` as entries under `prefix`, but those `skip` refuses. */
function folderEntries(files: SiteFileSystem, dir: string, prefix: string, skip: (path: string) => boolean = () => false): TarEntry[] {
    return files
        .listFiles(dir)
        .filter((path) => !skip(path))
        .map((path) => ({ path: `${prefix}${path}`, content: files.readBytes(`${dir}/${path}`) }));
}

function fileEntry(files: SiteFileSystem, path: string, to: string = path): TarEntry {
    if (!files.isFile(path)) {
        throw new SiteBuildError(`the install bundle needs ${path}`);
    }
    return { path: to, content: files.readBytes(path) };
}

/** A `firebase.json` part without its `predeploy` (the bundle's parts are built already), arrays item by item. */
function withoutPredeploy(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(withoutPredeploy);
    }
    return Object.fromEntries(Object.entries((value ?? {}) as Record<string, unknown>).filter(([key]) => key !== 'predeploy'));
}

/** The repository's `firebase.json` reduced to `keep` (no `predeploy`, the Hosting tree under `public/`). */
function firebaseConfig(files: SiteFileSystem, keep: readonly string[]): Uint8Array {
    const config = JSON.parse(files.readText('firebase.json')) as Record<string, unknown>;
    const kept = Object.fromEntries(keep.filter((key) => config[key] !== undefined).map((key) => [key, withoutPredeploy(config[key])]));
    const hosting = kept['hosting'];
    return json(hosting === undefined ? kept : { ...kept, hosting: { ...(hosting as Record<string, unknown>), public: 'public' } });
}

/** What every tarball that runs `firebase-tools` or a step carries. */
function sharedEntries(files: SiteFileSystem, projectId: string, steps: StepFiles, tools: boolean): TarEntry[] {
    const step = [...steps].map(([path, content]) => ({ path, content }));
    if (!tools) {
        return step;
    }
    const folder = toolsFolder(
        JSON.parse(files.readText('package-lock.json')) as Lockfile,
        JSON.parse(files.readText('package.json')) as RootManifest,
    );
    // A vendored copy's own install folder, if npm ever made one, is not part of the copy.
    const nested = (path: string): boolean => path.split('/').includes('node_modules');
    return [
        ...step,
        { path: '.firebaserc', content: json({ projects: { default: projectId } }) },
        { path: 'tools/package.json', content: encoder.encode(folder.packageJson) },
        { path: 'tools/package-lock.json', content: encoder.encode(folder.packageLock) },
        ...folder.vendored.flatMap((dir) => folderEntries(files, dir, `tools/${dir}/`, nested)),
    ];
}

function serverEntries(files: SiteFileSystem, options: InstallBundleOptions, shared: readonly TarEntry[]): TarEntry[] {
    if (!files.isFile(`${options.functionsDir}/index.js`)) {
        throw new SiteBuildError(
            `the install bundle needs the functions' build in ${options.functionsDir} (npm run build --workspace @hcm/functions)`,
        );
    }
    return [
        ...serverFiles(files, options.functionsDir),
        { path: 'firebase.json', content: firebaseConfig(files, ['firestore', 'storage', 'functions']) },
        ...RULE_FILES.map((path) => fileEntry(files, path)),
        ...shared,
    ];
}

function pipelineEntries(files: SiteFileSystem, steps: readonly TarEntry[]): TarEntry[] {
    const notCache = (path: string): boolean => path.includes('__pycache__/') || path.endsWith('.pyc');
    return [
        ...PIPELINE_FILES.map((name) => fileEntry(files, `pipeline/${name}`, name)),
        ...folderEntries(files, PIPELINE_SOURCE, 'src/hcm_pipeline/', notCache),
        ...steps,
    ];
}

function hostingEntries(files: SiteFileSystem, options: InstallBundleOptions, shared: readonly TarEntry[]): TarEntry[] {
    if (!files.isFile(`${options.publicTree}/index.html`)) {
        throw new SiteBuildError(`the install bundle needs the public Hosting tree in ${options.publicTree} (npm run build:hosting)`);
    }
    const bundleFolder = (path: string): boolean => path.startsWith(`admin/${INSTALL_FOLDER}/`);
    return [
        ...folderEntries(files, options.publicTree, 'public/', bundleFolder),
        { path: 'firebase.json', content: firebaseConfig(files, ['hosting']) },
        ...shared,
    ];
}

function projectIdOf(files: SiteFileSystem): string {
    const projectId = (JSON.parse(files.readText('infra/project.json')) as { projectId?: unknown }).projectId;
    if (typeof projectId !== 'string') {
        throw new SiteBuildError('infra/project.json names no projectId');
    }
    return projectId;
}

function manifestOf(release: string, projectId: string, tarballs: Readonly<Record<InstallTarget, Uint8Array>>): InstallManifest {
    const file = (target: InstallTarget) => ({
        name: INSTALL_BUNDLE_FILES[target],
        bytes: tarballs[target].length,
        sha256: sha256(tarballs[target]),
    });
    const manifest = {
        format: INSTALL_FORMAT,
        release,
        slug: installReleaseSlug(release),
        projectId,
        files: { server: file('server'), pipeline: file('pipeline'), site: file('site') },
        functions: expectedFunctionNames(),
        tools: { firebaseTools: FIREBASE_TOOLS_VERSION, node: NODE_STEP_IMAGE, docker: DOCKER_STEP_IMAGE },
        estimates: INSTALL_ESTIMATES,
    };
    const parsed = installManifestSchema.safeParse(manifest);
    if (!parsed.success) {
        throw new SiteBuildError(`the install manifest is not valid: ${parsed.error.message}`);
    }
    return parsed.data;
}

/** Builds the bundle into every `out` tree; `steps` is `bundleSteps`' result. */
export function buildInstallBundle(options: InstallBundleOptions, files: SiteFileSystem, steps: StepFiles): InstallBundleReport {
    const release = adminRelease(files, options.env);
    const projectId = projectIdOf(files);
    const mtime = entryTime(options.env);
    const stepEntries = sharedEntries(files, projectId, steps, false);
    const withTools = sharedEntries(files, projectId, steps, true);
    const tarballs: Record<InstallTarget, Uint8Array> = {
        server: tgz(serverEntries(files, options, withTools), mtime),
        pipeline: tgz(pipelineEntries(files, stepEntries), mtime),
        site: tgz(hostingEntries(files, options, withTools), mtime),
    };
    const manifest = manifestOf(release, projectId, tarballs);
    for (const out of options.out) {
        const folder = `${out}/admin/${INSTALL_FOLDER}/${manifest.slug}`;
        (Object.keys(tarballs) as InstallTarget[]).forEach((target) => {
            files.write(`${folder}/${INSTALL_BUNDLE_FILES[target]}`, tarballs[target]);
        });
        files.write(`${folder}/${INSTALL_MANIFEST_FILE}`, json(manifest));
    }
    return {
        release,
        slug: manifest.slug,
        bytes: { server: tarballs.server.length, pipeline: tarballs.pipeline.length, site: tarballs.site.length },
    };
}
