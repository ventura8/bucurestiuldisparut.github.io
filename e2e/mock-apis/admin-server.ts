import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

import { e2eHostingHeaders, isIgnored, rewriteOf, type HostingConfig } from '../../scripts/site/src/admin/hosting.js';
import type { MockResponse } from './router.js';
import { failed, isFile, listen, SITE_TYPES } from './server.js';

/**
 * The e2e admin server (docs/research/M2b-interfaces.md §6.2): the `e2e` build of `packages/admin/dist` served the way
 * Firebase Hosting serves it, from `firebase.json`'s own `hosting` block (scripts/site/src/admin/hosting.ts): a file,
 * else `cleanUrls`' `.html`, else the `**` rewrite to `index.html`; ignored files (source maps, dot files) count as
 * missing; every response carries Hosting's headers with the CSP's `upgrade-insecure-requests` dropped and the
 * emulators' and mock APIs' origins added to `connect-src`. Hosting's reserved `/__/firebase/init.json` answers the
 * `demo-hcm` web configuration, `/runtime.json` the e2e runtime (no App Check site key) and `/project.json` the e2e
 * world's project (`E2E_PROJECT_CONFIG`, in place of the copy of `infra/project.json` the admin build writes; CR-M2b-26). The Hosting emulator is not
 * used: it would apply `upgrade-insecure-requests` to the http emulators.
 *
 * `/__harness` (e2e only) is a blank page on the admin's origin for the harness specs (e2e/admin/harness/): served
 * from 127.0.0.1 like the admin, so Chromium's Local Network Access lets it reach the emulators as the admin does (a
 * document a route fulfils has no address space and is refused the loopback).
 */

export interface AdminServerOptions {
    /** Absolute path of the admin's Hosting folder. */
    readonly distDir: string;
    readonly hosting: HostingConfig;
    /** Origins added to the CSP's `connect-src`. */
    readonly connect: readonly string[];
    /** `/__/firebase/init.json`. */
    readonly webConfig: Readonly<Record<string, string>>;
    /** `/runtime.json`. */
    readonly runtime: Readonly<Record<string, unknown>>;
    /** `/project.json`. */
    readonly project: Readonly<Record<string, unknown>>;
}

const NOT_FOUND: MockResponse = { status: 404, type: 'text/plain', body: 'Not found' };

/** The harness page: no script, no style. */
const HARNESS_PAGE =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Admin harness</title><link rel="icon" href="data:,"></head>' +
    '<body><main><h1>Admin harness</h1></main></body></html>';

function pathnameOf(request: IncomingMessage): string {
    const raw = request.url ?? '/';
    const queryStart = raw.indexOf('?');
    return queryStart === -1 ? raw : raw.slice(0, queryStart);
}

/** The file `pathname` names below `dir`, or null outside `dir`, missing, or never deployed (`ignore`). */
async function deployedFile(dir: string, hosting: HostingConfig, pathname: string): Promise<string | null> {
    const target = normalize(join(dir, decodeURIComponent(pathname)));
    const inside = target.startsWith(`${dir}${sep}`);
    return inside && !isIgnored(hosting, pathname) && (await isFile(target)) ? target : null;
}

/** What Hosting serves for `pathname`: the file, its clean-URL `.html`, or the rewrite's destination. */
async function servedFile(options: AdminServerOptions, pathname: string): Promise<string | null> {
    const { distDir, hosting } = options;
    const direct = await deployedFile(distDir, hosting, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    const clean = direct ?? (hosting.cleanUrls ? await deployedFile(distDir, hosting, `${pathname}.html`) : null);
    const destination = rewriteOf(hosting, pathname);
    return clean ?? (destination === undefined ? null : deployedFile(distDir, hosting, destination));
}

function reserved(options: AdminServerOptions, pathname: string): MockResponse | undefined {
    const json = (value: unknown): MockResponse => ({ status: 200, type: 'application/json', body: JSON.stringify(value) });
    switch (pathname) {
        case '/__health':
            return { status: 200, type: 'text/plain', body: 'ok' };
        case '/__/firebase/init.json':
            return json(options.webConfig);
        case '/runtime.json':
            return json(options.runtime);
        case '/project.json':
            return json(options.project);
        case '/__harness':
            return { status: 200, type: 'text/html; charset=utf-8', body: HARNESS_PAGE };
        default:
            return undefined;
    }
}

async function answer(options: AdminServerOptions, request: IncomingMessage): Promise<MockResponse> {
    const pathname = pathnameOf(request);
    const fixed = reserved(options, pathname);
    if (fixed !== undefined) {
        return fixed;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return { status: 405, type: 'text/plain', body: 'Method not allowed' };
    }
    const file = await servedFile(options, pathname);
    return file === null
        ? NOT_FOUND
        : { status: 200, type: SITE_TYPES[extname(file)] ?? 'application/octet-stream', body: await readFile(file) };
}

/** Hosting's own default for a file without a `Cache-Control` rule. */
const DEFAULT_CACHE_CONTROL = 'max-age=3600';

async function handle(options: AdminServerOptions, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const result = await answer(options, request);
    const headers = e2eHostingHeaders(options.hosting, pathnameOf(request), options.connect);
    response.writeHead(result.status, {
        'Cache-Control': DEFAULT_CACHE_CONTROL,
        ...headers,
        ...(result.type === undefined ? {} : { 'Content-Type': result.type }),
    });
    response.end(request.method === 'HEAD' ? undefined : result.body);
}

/** Serves the admin's Hosting folder on 127.0.0.1:`port`. */
export function startAdminServer(port: number, options: AdminServerOptions): Promise<Server> {
    const resolved: AdminServerOptions = { ...options, distDir: resolve(options.distDir) };
    const server = createServer((request, response) => {
        handle(resolved, request, response).catch((error: unknown) => {
            failed(response, error);
        });
    });
    return listen(server, port);
}
