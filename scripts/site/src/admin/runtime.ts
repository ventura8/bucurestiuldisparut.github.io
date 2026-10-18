import type { SiteFileSystem } from '../files.js';
import type { AdminFile } from './legacy.js';

/**
 * The admin's `runtime.json` (docs/research/M2b-interfaces.md §1.4 step 2), written by its site build next to
 * `index.html`, so Hosting's `predeploy` produces it and nothing a workflow writes before `firebase deploy` is erased
 * (`DECISIONS-for-review.md` §23b's redesign):
 *
 * - `release`: the repository's version and the short commit the admin was built from (`0.0.0+5d02329`): the boot log
 *   and every crash report name it (a build outside a git checkout names the version only);
 * - `startUp: true` when the deploy says the map's server is not installed yet (`HCM_ADMIN_START_UP=1`, the Hosting-only
 *   deploy of a new map's start-up mode): the admin then skips its anonymous probe of `admin-session`, whose missing
 *   function would make the browser log a CORS error, and learns from Google that the server is installed (step d).
 *
 * The App Check site key joins it with the deploy milestone (§23b). The e2e admin server answers its own runtime file.
 */

/** Where the page reads it. */
export const RUNTIME_FILE = 'runtime.json';

/** The environment variable a start-up deploy sets (`HCM_ADMIN_START_UP=1 npx firebase deploy --only hosting`). */
export const START_UP_VARIABLE = 'HCM_ADMIN_START_UP';

/** The environment variables that may name the commit (CI's checkout, or a deploy that passes it in). */
const COMMIT_VARIABLES = ['HCM_COMMIT', 'GITHUB_SHA'] as const;

/** A full commit id, SHA-1 or SHA-256. */
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** How many characters of the commit the release names (git's short form). */
const SHORT_COMMIT = 7;

export type BuildEnvironment = Readonly<Record<string, string | undefined>>;

/** `text` when it is a full commit id, else null. */
function commitOrNull(text: string): string | null {
    return COMMIT.test(text) ? text : null;
}

/** The commit the checkout's `.git` folder names for `ref`: its own file, else its line of `packed-refs`, else null. */
function refCommit(files: SiteFileSystem, ref: string): string | null {
    if (files.isFile(`.git/${ref}`)) {
        return commitOrNull(files.readText(`.git/${ref}`).trim());
    }
    const packed = files.isFile('.git/packed-refs') ? files.readText('.git/packed-refs').split('\n') : [];
    const line = packed.find((entry) => entry.endsWith(` ${ref}`)) ?? '';
    return commitOrNull(line.slice(0, line.indexOf(' ')));
}

/** The commit `HEAD` points at in the checkout's `.git` folder (a branch, a packed branch or a detached head), or null. */
export function headCommit(files: SiteFileSystem): string | null {
    if (!files.isFile('.git/HEAD')) {
        return null;
    }
    const head = files.readText('.git/HEAD').trim();
    const ref = /^ref: (refs\/[\w./-]+)$/.exec(head)?.[1];
    return ref === undefined ? commitOrNull(head) : refCommit(files, ref);
}

/** The commit the build names: an environment variable's, else the checkout's `HEAD`, else null. */
export function buildCommit(files: SiteFileSystem, env: BuildEnvironment): string | null {
    const named = COMMIT_VARIABLES.map((name) => env[name] ?? '').find((value) => COMMIT.test(value));
    return named ?? headCommit(files);
}

/** The repository's version (the root `package.json`, which every package's version follows). */
function repositoryVersion(files: SiteFileSystem): string {
    const parsed = JSON.parse(files.readText('package.json')) as { readonly version?: unknown };
    return typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : '0.0.0';
}

/** `<version>+<short commit>`, or the version alone without a commit. */
export function adminRelease(files: SiteFileSystem, env: BuildEnvironment): string {
    const version = repositoryVersion(files);
    const commit = buildCommit(files, env);
    return commit === null ? version : `${version}+${commit.slice(0, SHORT_COMMIT)}`;
}

/** Whether the deploy declares start-up mode (`HCM_ADMIN_START_UP=1` or `true`). */
export function startUpDeploy(env: BuildEnvironment): boolean {
    return ['1', 'true'].includes(env[START_UP_VARIABLE] ?? '');
}

/** The page's `runtime.json`. */
export function planRuntimeFile(files: SiteFileSystem, env: BuildEnvironment): { readonly file: AdminFile; readonly release: string } {
    const release = adminRelease(files, env);
    const runtime = startUpDeploy(env) ? { release, startUp: true } : { release };
    return { file: { to: RUNTIME_FILE, content: `${JSON.stringify(runtime, null, 4)}\n` }, release };
}
