/**
 * The self-host bundle the package carries (`dist/self-host/`, `npm run build:self-host` at a release, which builds the
 * admin and the functions for production first; the `release` stage's `self-host-bundle` gate assembles it before
 * `release-pack`: `docs/research/M5-interfaces.md` §4.4), assembled from the repository's own builds:
 *
 * ```text
 * hosting/admin/              packages/admin/dist (a production build) without Bucharest's legacy import bundle,
 *                             the source maps and the files a project writes itself (project.json, runtime.json):
 *                             since M6 the admin's base is `/admin/` (docs/research/M6-interfaces.md §2.3), so the
 *                             project's Hosting folder is `hosting/` with the admin in its `admin/` folder
 * functions/                  functions/dist: index.js, package.json, package-lock.json and export-kit/ (no .env.*)
 * rules/                      firebase/firestore.rules, firestore.indexes.json, storage.rules
 * firebase.template.json      firebase.json for any project: the paths above, no build steps, no emulators, and
 *                             the repository's project id replaced by __PROJECT_ID__ (its Hosting site and CSP); the
 *                             site's root redirects to `/admin/` until the map is published (no viewer page yet)
 * bundle.json                 the release the admin was built from (its runtime.json's)
 * ```
 *
 * Nothing secret is copied: the admin build and the rules are public, and the functions' `.env.<project>` files (public
 * values of the repository's own project) stay behind.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BUNDLE, PROJECT_TOKEN } from './server-files.js';

/** Where the inputs and the output are, from the repository's root. */
export interface BundleLayout {
    readonly root: string;
    readonly adminDist: string;
    readonly functionsDist: string;
    readonly firebaseConfig: string;
    readonly rules: readonly string[];
    readonly projectFile: string;
    readonly out: string;
}

export const DEFAULT_LAYOUT: Omit<BundleLayout, 'root'> = {
    adminDist: 'packages/admin/dist',
    functionsDist: 'functions/dist',
    firebaseConfig: 'firebase.json',
    rules: ['firebase/firestore.rules', 'firebase/firestore.indexes.json', 'firebase/storage.rules'],
    projectFile: 'infra/project.json',
    out: 'packages/create-historic-city/dist/self-host',
};

/**
 * Only the admin's `e2e` build (`vite build --mode e2e`, which writes the same `packages/admin/dist`) carries the OAuth
 * stand-in's page (`packages/admin/src/auth/stand-in.ts`); a bundle made from it would sign owners in against a mock.
 */
export const E2E_BUILD_MARKER = '/__oauth/authorize';

/** Admin files a self-hosted project does not take: the legacy import, the maps, what the project writes itself. */
const ADMIN_LEFT_OUT = /^(?:legacy|project\.json|runtime\.json|.*\.map)$/;
/** The functions' artifact, without its per-project `.env.*`. */
const FUNCTIONS_TAKEN = /^(?:index\.js|package\.json|package-lock\.json|export-kit)$/;

const json = (value: unknown): string => `${JSON.stringify(value, null, 4)}\n`;

function readJson(path: string): Record<string, unknown> {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function copyEntries(from: string, to: string, keep: (name: string) => boolean): number {
    if (!existsSync(from)) {
        throw new Error(`${from} is missing: build it first (npm run build)`);
    }
    const names = readdirSync(from).filter(keep);
    for (const name of names) {
        cpSync(join(from, name), join(to, name), { recursive: true });
    }
    return names.length;
}

type Config = Record<string, unknown>;

function only(value: unknown): Config {
    return { ...(Array.isArray(value) ? (value[0] as Config) : (value as Config)) };
}

/** A self-hosted project's site before its map is published: its root is the admin (M6: the admin under `/admin/`). */
const ROOT_TO_ADMIN = { source: '/', destination: '/admin/', type: 302 } as const;

function redirectsOf(hosting: Config): unknown[] {
    const redirects = hosting['redirects'];
    return Array.isArray(redirects) ? redirects : [];
}

/** firebase.json for any project: the bundle's paths, no `predeploy`, no emulators or schema, the project tokenised. */
export function selfHostFirebaseConfig(config: Config, projectId: string): string {
    const kept: Config = Object.fromEntries(Object.entries(config).filter(([key]) => key !== '$schema' && key !== 'emulators'));
    const functions = only(kept['functions']);
    const hosting = only(kept['hosting']);
    delete functions['predeploy'];
    delete hosting['predeploy'];
    const rewritten = {
        ...kept,
        firestore: { ...only(kept['firestore']), rules: 'rules/firestore.rules', indexes: 'rules/firestore.indexes.json' },
        storage: { rules: 'rules/storage.rules' },
        functions: [{ ...functions, source: 'functions' }],
        hosting: { ...hosting, public: 'hosting', redirects: [...redirectsOf(hosting), ROOT_TO_ADMIN] },
    };
    return json(rewritten).replaceAll(projectId, PROJECT_TOKEN);
}

/** Throws unless `adminDist` is a production build: no script of it carries the e2e build's marker (`docs/LESSONS.md` 247). */
function requireProductionAdmin(adminDist: string): void {
    const scripts = existsSync(adminDist) ? readdirSync(adminDist).filter((name) => /\.m?js$/.test(name)) : [];
    const e2e = scripts.find((name) => readFileSync(join(adminDist, name), 'utf8').includes(E2E_BUILD_MARKER));
    if (e2e !== undefined) {
        throw new Error(`${adminDist}/${e2e} is the admin's e2e build: run npm run build:admin first`);
    }
}

/** Assembles the bundle into `layout.out` (replaced); throws when an input build is missing or the admin's is not production. */
export function buildSelfHostBundle(layout: BundleLayout): { readonly admin: number; readonly functions: number } {
    const at = (path: string): string => join(layout.root, path);
    requireProductionAdmin(at(layout.adminDist));
    const out = at(layout.out);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(join(out, 'rules'), { recursive: true });
    const admin = copyEntries(at(layout.adminDist), join(out, 'hosting', 'admin'), (name) => !ADMIN_LEFT_OUT.test(name));
    const functions = copyEntries(at(layout.functionsDist), join(out, 'functions'), (name) => FUNCTIONS_TAKEN.test(name));
    for (const rule of layout.rules) {
        cpSync(at(rule), join(out, 'rules', rule.slice(rule.lastIndexOf('/') + 1)));
    }
    const projectId = String(readJson(at(layout.projectFile))['projectId']);
    writeFileSync(join(out, BUNDLE.firebaseTemplate), selfHostFirebaseConfig(readJson(at(layout.firebaseConfig)), projectId));
    const runtime = readJson(join(at(layout.adminDist), 'runtime.json'));
    writeFileSync(join(out, BUNDLE.release), json({ release: runtime['release'] }));
    return { admin, functions };
}
