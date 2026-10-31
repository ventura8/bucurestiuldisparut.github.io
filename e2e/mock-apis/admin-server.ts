import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

import {
    answerHeaders,
    e2eHeaders,
    isIgnored,
    resolveHostingPath,
    type HostingAnswer,
    type HostingConfig,
} from '../../scripts/site/src/admin/hosting.js';
import type { MockResponse } from './router.js';
import { failed, listen, SITE_TYPES } from './server.js';

/**
 * The e2e Hosting server (docs/research/M2b-interfaces.md §6.2, M6-interfaces.md §2, §7): the e2e build's Firebase Hosting
 * tree (`dist/e2e-hosting`: the public map at the root, the other cities at their paths, the generic city page, the
 * admin's `e2e` build under `/admin/`) served the way Firebase Hosting serves it, from `firebase.json`'s own `hosting`
 * block (`scripts/site/src/admin/hosting.ts` → `resolveHostingPath`: the redirects, the files with `cleanUrls` and
 * `trailingSlash`, the rewrites, `404.html`); ignored files (source maps, dot files) count as missing; every response
 * carries Hosting's headers for its path, the admin's CSP with `upgrade-insecure-requests` dropped and the emulators' and
 * mock APIs' origins added to `connect-src`. Hosting's reserved `/__/firebase/init.json` answers the `demo-hcm` web
 * configuration, `/admin/runtime.json` the e2e runtime (no App Check site key) and `/admin/project.json` the e2e world's
 * project (`E2E_PROJECT_CONFIG`, in place of the copy of `infra/project.json` the admin build writes; CR-M2b-26). The
 * Hosting emulator is not used: it would apply `upgrade-insecure-requests` to the http emulators.
 *
 * The start-up variant (`dist/e2e-hosting-start-up`, the first deploy of a new map, S-V30-BAD-START-UP) is served to a
 * browser that carries the cookie `hcm-e2e-variant=start-up` (`E2E_VARIANT_COOKIE`; per browser context, so parallel
 * tests never see each other's variant).
 *
 * e2e only: `/__harness` is a blank page on the admin's origin for the harness specs (e2e/admin/harness/): served from
 * 127.0.0.1 like the admin, so Chromium's Local Network Access lets it reach the emulators as the admin does (a document a
 * route fulfils has no address space and is refused the loopback); `/__old-push-sw.js` is a push worker at the site's root,
 * as an admin before M6 registered it there (S-A58-BAD-OLD-SERVICE-WORKER).
 */

export interface AdminServerOptions {
    /** Absolute path, or relative to the working directory, of the e2e Hosting tree (the public variant). */
    readonly hostingDir: string;
    /** The start-up variant's tree, served to a browser with the variant cookie. */
    readonly startUpDir?: string;
    readonly hosting: HostingConfig;
    /** Origins added to the CSP's `connect-src`. */
    readonly connect: readonly string[];
    /** `/__/firebase/init.json`. */
    readonly webConfig: Readonly<Record<string, string>>;
    /** `/admin/runtime.json`. */
    readonly runtime: Readonly<Record<string, unknown>>;
    /** `/admin/project.json`. */
    readonly project: Readonly<Record<string, unknown>>;
}

/** The cookie that picks the start-up variant of the tree, and its value. */
export const E2E_VARIANT_COOKIE = 'hcm-e2e-variant';
export const START_UP_VARIANT = 'start-up';

/** The legacy root push worker of the old-service-worker scenario (scope `/`). */
export const OLD_PUSH_WORKER_PATH = '/__old-push-sw.js';

const NOT_FOUND: MockResponse = { status: 404, type: 'text/plain', body: 'Not found' };

/** The harness page: no script, no style. */
const HARNESS_PAGE =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Admin harness</title><link rel="icon" href="data:,"></head>' +
    '<body><main><h1>Admin harness</h1></main></body></html>';

/** A push worker that does nothing, as the pre-M6 admin's worker did between pushes (no fetch handler). */
const OLD_PUSH_WORKER = "'use strict';\nself.addEventListener('push', () => undefined);\n";

interface Target {
    readonly pathname: string;
    readonly search: string;
}

function targetOf(request: IncomingMessage): Target {
    const raw = request.url ?? '/';
    const queryStart = raw.indexOf('?');
    return queryStart === -1 ? { pathname: raw, search: '' } : { pathname: raw.slice(0, queryStart), search: raw.slice(queryStart) };
}

function reserved(options: AdminServerOptions, pathname: string): MockResponse | undefined {
    const json = (value: unknown): MockResponse => ({ status: 200, type: 'application/json', body: JSON.stringify(value) });
    switch (pathname) {
        case '/__health':
            return { status: 200, type: 'text/plain', body: 'ok' };
        case '/__/firebase/init.json':
            return json(options.webConfig);
        case '/admin/runtime.json':
            return json(options.runtime);
        case '/admin/project.json':
            return json(options.project);
        case '/__harness':
            return { status: 200, type: 'text/html; charset=utf-8', body: HARNESS_PAGE };
        case OLD_PUSH_WORKER_PATH:
            return { status: 200, type: 'text/javascript; charset=utf-8', body: OLD_PUSH_WORKER };
        default:
            return undefined;
    }
}

/** The tree a request is served from: the start-up variant's for a browser with its cookie, else the public one. */
function treeOf(options: AdminServerOptions, request: IncomingMessage): string {
    const cookies = (request.headers.cookie ?? '').split(';').map((pair) => pair.trim());
    const startUp = options.startUpDir;
    return startUp !== undefined && cookies.includes(`${E2E_VARIANT_COOKIE}=${START_UP_VARIANT}`) ? startUp : options.hostingDir;
}

/** Whether the tree deployed a file at the site path `path` (inside the tree, not ignored). */
function deployed(dir: string, hosting: HostingConfig, path: string): boolean {
    const target = normalize(join(dir, path));
    return target.startsWith(`${dir}${sep}`) && !isIgnored(hosting, path) && statSync(target, { throwIfNoEntry: false })?.isFile() === true;
}

interface Answered {
    readonly result: MockResponse;
    readonly answer: HostingAnswer | null;
}

async function served(dir: string, answer: HostingAnswer): Promise<MockResponse> {
    if (answer.kind === 'redirect') {
        return { status: answer.status, headers: { location: answer.location } };
    }
    if (answer.kind === 'missing') {
        return NOT_FOUND;
    }
    const file = join(dir, answer.file);
    return { status: answer.status, type: SITE_TYPES[extname(file)] ?? 'application/octet-stream', body: await readFile(file) };
}

async function answer(options: AdminServerOptions, request: IncomingMessage, target: Target): Promise<Answered> {
    const fixed = reserved(options, target.pathname);
    if (fixed !== undefined) {
        return { result: fixed, answer: null };
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return { result: { status: 405, type: 'text/plain', body: 'Method not allowed' }, answer: null };
    }
    const dir = treeOf(options, request);
    const path = decodeURIComponent(target.pathname);
    const resolved = resolveHostingPath(options.hosting, path, target.search, (file) => deployed(dir, options.hosting, file));
    return { result: await served(dir, resolved), answer: resolved };
}

/** Hosting's own default for a file without a `Cache-Control` rule. */
const DEFAULT_CACHE_CONTROL = 'max-age=3600';

async function handle(options: AdminServerOptions, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const target = targetOf(request);
    const { result, answer: hosted } = await answer(options, request, target);
    const path = decodeURIComponent(target.pathname);
    const headers = hosted === null ? {} : answerHeaders(options.hosting, path, hosted);
    response.writeHead(result.status, {
        'Cache-Control': DEFAULT_CACHE_CONTROL,
        ...e2eHeaders(headers, options.connect),
        ...result.headers,
        ...(result.type === undefined ? {} : { 'Content-Type': result.type }),
    });
    response.end(request.method === 'HEAD' ? undefined : result.body);
}

/** A request handler of a loopback server (the local stack, e2e/stack/servers.ts, puts its own routes in front). */
export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

/** The e2e Hosting server's handler: the e2e Hosting tree as Hosting serves it. */
export function adminRequestHandler(options: AdminServerOptions): RequestHandler {
    const resolved: AdminServerOptions = {
        ...options,
        hostingDir: resolve(options.hostingDir),
        ...(options.startUpDir === undefined ? {} : { startUpDir: resolve(options.startUpDir) }),
    };
    return (request, response) => {
        handle(resolved, request, response).catch((error: unknown) => {
            failed(response, error);
        });
    };
}

/** Serves the e2e Hosting tree on 127.0.0.1:`port`. */
export function startAdminServer(port: number, options: AdminServerOptions): Promise<Server> {
    return listen(createServer(adminRequestHandler(options)), port);
}
