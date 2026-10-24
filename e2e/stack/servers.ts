import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { gunzipSync } from 'node:zlib';

import { createLogger, STORAGE_PATHS } from '@hcm/shared';

import { parseHostingConfig } from '../../scripts/site/src/admin/hosting.js';
import {
    ADMIN_CONNECT_ORIGINS,
    ADMIN_DIST_DIR,
    ADMIN_PORT,
    ADMIN_PROJECT,
    ADMIN_RUNTIME,
    ADMIN_WEB_CONFIG,
    E2E_PROJECT_ID,
    emulatorOrigin,
} from '../admin/world.js';
import { E2E_CITY_ID, E2E_SITE_DIR, MOCK_API_ORIGIN, SITE_PORT } from '../fixtures/world.js';
import { adminRequestHandler, type RequestHandler } from '../mock-apis/admin-server.js';
import { isUpstreamHost, mockedHostKind, refusedAddress } from '../mock-apis/hosts.js';
import { listen, siteRequestHandler } from '../mock-apis/server.js';
import { FORWARD_PREFIX, SHIM_PATH, shimScript, withShim } from './browser.js';

/**
 * The local stack's admin and site servers (docs/SETUP.md → *Local stack for manual testing*): the e2e admin server
 * (e2e/mock-apis/admin-server.ts) and site server (e2e/mock-apis/server.ts) with the stack's routes in front:
 *
 * - every HTML page they serve gets the shim first in its `<head>` (`/__stack/shim.js`) and its loading tags' https
 *   addresses pointed at the forward, and its CSP's `frame-src` lets the consent stand-in be framed (browser.ts);
 * - `/__stack/h/<host><path>`: what the shim forwards. Decided with the e2e firewall's host table
 *   (e2e/mock-apis/hosts.ts): a refused address (USGS, STAC, Overpass, OpenStreetMap tiles, Mapbox Satellite) and an
 *   unknown host answer 403 and are logged (host and path only); an object of the emulators' buckets on
 *   `storage.googleapis.com` is read from the Storage emulator; a mocked host or a fake upstream's host goes to the mock
 *   APIs, in the shared partition `''` that the Functions emulator also reaches, so the browser and the server see one
 *   fake Google, Mapbox and USGS;
 * - on the site: `/` redirects to the Bucharest site, and `/<site>/data/manifest.json` is the manifest the emulators'
 *   build published for the city (`cities/bucharest/manifest.json` of the public bucket, its storage addresses made
 *   same-origin under `data/stack-storage/`, which the site's CSP allows), else the built fixture manifest.
 */

const log = createLogger('dev-stack');

/** The emulators' buckets: the private one (the admin's uploads, the rasters) and the public one (photos, manifests). */
const PUBLIC_BUCKET = `${E2E_PROJECT_ID}-public`;
const BUCKETS: readonly string[] = [ADMIN_WEB_CONFIG.storageBucket, PUBLIC_BUCKET];
/** The Storage emulator's administrator credential (reads past the rules, as the public bucket's real IAM allows). */
const EMULATOR_ADMIN = { authorization: 'Bearer owner' } as const;
/** Where a site's manifest points the public bucket's objects, relative to `data/manifest.json`. */
const SITE_STORAGE = 'stack-storage';
/** The request headers a forward keeps (the fake upstreams read the bearer token). */
const FORWARDED_HEADERS = ['accept', 'content-type', 'authorization'];
/** Response headers that describe the connection or the encoding `fetch` already undid. */
const DROPPED_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

interface Answer {
    readonly status: number;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: Buffer | string;
}

/** The stack's routes of one server, before its own handler (undefined: the server's own answer). */
type StackRoute = (request: IncomingMessage, target: Target) => Promise<Answer | undefined>;

interface Target {
    readonly pathname: string;
    /** `?…` or empty. */
    readonly search: string;
}

function targetOf(request: IncomingMessage): Target {
    const raw = request.url ?? '/';
    const queryStart = raw.indexOf('?');
    return queryStart === -1 ? { pathname: raw, search: '' } : { pathname: raw.slice(0, queryStart), search: raw.slice(queryStart) };
}

function text(status: number, body: string): Answer {
    return { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, body };
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
}

function keptHeaders(headers: Headers): Record<string, string> {
    const kept: Record<string, string> = {};
    headers.forEach((value, name) => {
        if (!DROPPED_HEADERS.has(name)) {
            kept[name] = value;
        }
    });
    return kept;
}

async function answerOf(response: Response): Promise<Answer> {
    return { status: response.status, headers: keptHeaders(response.headers), body: Buffer.from(await response.arrayBuffer()) };
}

/** An object of the Storage emulator, read past the rules (404 when it does not exist). */
async function storageObject(bucket: string, path: string): Promise<Answer> {
    const url = `${emulatorOrigin('storage')}/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}?alt=media`;
    return answerOf(await fetch(url, { headers: EMULATOR_ADMIN }));
}

/** `storage.googleapis.com/<bucket>/<path>` of one of the emulators' buckets, or null. */
function emulatorObjectOf(url: URL): { readonly bucket: string; readonly path: string } | null {
    if (url.hostname !== 'storage.googleapis.com') {
        return null;
    }
    const [, bucket = '', ...rest] = url.pathname.split('/');
    return BUCKETS.includes(bucket) && rest.length > 0 ? { bucket, path: decodeURIComponent(rest.join('/')) } : null;
}

/** A forwarded request the stack does not answer: 403, logged without its query (a token may be in it). */
function refused(url: URL, why: string): Answer {
    log.warn('request refused (it would leave the machine)', { host: url.host, path: url.pathname, why });
    return text(403, `refused by the local stack (${why}): https://${url.host}${url.pathname}`);
}

/** Sends a forwarded request to the mock APIs (the shared partition: no `x-hcm-test`). */
async function toMockApis(request: IncomingMessage, url: URL): Promise<Answer> {
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_HEADERS) {
        const value = request.headers[name];
        if (typeof value === 'string') {
            headers[name] = value;
        }
    }
    const method = request.method ?? 'GET';
    const body = method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(await readBody(request));
    const response = await fetch(`${MOCK_API_ORIGIN}/h/${url.host}${url.pathname}${url.search}`, {
        method,
        headers,
        redirect: 'manual',
        ...(body === undefined ? {} : { body }),
    });
    return answerOf(response);
}

/** `/__stack/h/<host><path>`: what the service worker forwarded for `https://<host><path>`. */
async function forwarded(request: IncomingMessage, target: Target): Promise<Answer> {
    const rest = target.pathname.slice(FORWARD_PREFIX.length);
    const slash = rest.indexOf('/');
    const host = slash === -1 ? rest : rest.slice(0, slash);
    const url = new URL(`https://${host}${slash === -1 ? '/' : rest.slice(slash)}${target.search}`);
    const refusal = refusedAddress(url);
    if (refusal !== null) {
        return refused(url, refusal);
    }
    const object = emulatorObjectOf(url);
    if (object !== null && (request.method === 'GET' || request.method === 'HEAD')) {
        return storageObject(object.bucket, object.path);
    }
    if (mockedHostKind(url.hostname) !== null || isUpstreamHost(url.hostname)) {
        return toMockApis(request, url);
    }
    return refused(url, 'no fake answers this host');
}

/** The routes both origins share: the shim and the forwards. */
async function commonRoute(request: IncomingMessage, target: Target): Promise<Answer | undefined> {
    if (target.pathname === SHIM_PATH) {
        return {
            status: 200,
            headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
            body: shimScript(),
        };
    }
    return target.pathname.startsWith(FORWARD_PREFIX) ? forwarded(request, target) : undefined;
}

/** Every https address of the public bucket in `value`, made relative to the site's `data/` folder. */
function siteAddresses(value: unknown): unknown {
    const prefix = `https://storage.googleapis.com/${PUBLIC_BUCKET}/`;
    if (typeof value === 'string') {
        return value.startsWith(prefix) ? `${SITE_STORAGE}/${PUBLIC_BUCKET}/${value.slice(prefix.length)}` : value;
    }
    if (Array.isArray(value)) {
        return value.map(siteAddresses);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, siteAddresses(item)]));
    }
    return value;
}

/** The manifest the emulators' build published for the Bucharest site's city, or undefined before the first build. */
async function publishedManifest(): Promise<Answer | undefined> {
    const stored = await storageObject(PUBLIC_BUCKET, STORAGE_PATHS.manifest(E2E_CITY_ID));
    if (stored.status !== 200 || stored.body === undefined) {
        return undefined;
    }
    const bytes = Buffer.from(stored.body);
    const json = (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString('utf8');
    const body = JSON.stringify(siteAddresses(JSON.parse(json) as unknown));
    return {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-hcm-stack-manifest': 'emulators' },
        body,
    };
}

/** The site's own routes: `/` to the Bucharest site, the published manifest and the public bucket's objects. */
async function siteRoute(request: IncomingMessage, target: Target): Promise<Answer | undefined> {
    if (target.pathname === '/') {
        return { status: 302, headers: { location: `/${E2E_CITY_ID}/`, 'cache-control': 'no-store' } };
    }
    if (target.pathname === `/${E2E_CITY_ID}/data/manifest.json`) {
        return publishedManifest();
    }
    const storagePrefix = `/${E2E_CITY_ID}/data/${SITE_STORAGE}/`;
    if (target.pathname.startsWith(storagePrefix) && (request.method === 'GET' || request.method === 'HEAD')) {
        const [bucket = '', ...rest] = target.pathname.slice(storagePrefix.length).split('/');
        return BUCKETS.includes(bucket) ? storageObject(bucket, decodeURIComponent(rest.join('/'))) : text(404, 'Not found');
    }
    return undefined;
}

function write(response: ServerResponse, request: IncomingMessage, answer: Answer): void {
    response.writeHead(answer.status, answer.headers);
    response.end(request.method === 'HEAD' ? undefined : answer.body);
}

/** A page's policy letting the consent stand-in of the mock APIs be framed (the shim opens it in a frame, browser.ts). */
function withConsentFrame(policy: string): string {
    return policy.replace(/\bframe-src\b/, `frame-src ${MOCK_API_ORIGIN}`);
}

/**
 * `response` with every HTML page the fallback writes shimmed (`withShim`): its head and body are held until `end`, then
 * written with the new length.
 */
function shimmingHtml(response: ServerResponse): ServerResponse {
    const writeHead = response.writeHead.bind(response);
    const end = response.end.bind(response);
    let head: { status: number; headers: Record<string, string | number> } = { status: 200, headers: {} };
    const held = response as unknown as {
        writeHead: (status: number, headers?: Record<string, string | number>) => ServerResponse;
        end: (body?: unknown) => ServerResponse;
    };
    held.writeHead = (status, headers = {}) => {
        head = { status, headers: { ...headers } };
        return response;
    };
    held.end = (body?: unknown) => {
        const type = Object.entries(head.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
        const html = typeof type === 'string' && type.startsWith('text/html') && body !== undefined;
        const sent = html ? withShim(Buffer.from(body as Buffer | string).toString('utf8')) : body;
        const headers = Object.fromEntries(
            Object.entries(head.headers)
                .filter(([name]) => name.toLowerCase() !== 'content-length')
                .map(([name, value]) => [name, name.toLowerCase() === 'content-security-policy' ? withConsentFrame(String(value)) : value]),
        );
        writeHead(head.status, headers);
        return end(sent as Buffer | string | undefined);
    };
    return response;
}

/** A server whose stack routes answer first, then `fallback` (its HTML pages shimmed). */
function stackServer(routes: readonly StackRoute[], fallback: RequestHandler): Server {
    return createServer((request, response) => {
        const handle = async (): Promise<void> => {
            const target = targetOf(request);
            for (const route of routes) {
                const answer = await route(request, target);
                if (answer !== undefined) {
                    write(response, request, answer);
                    return;
                }
            }
            fallback(request, shimmingHtml(response));
        };
        handle().catch((error: unknown) => {
            log.error('stack route failed', { path: targetOf(request).pathname, error: String(error) });
            if (!response.headersSent) {
                write(response, request, text(502, `local stack: ${String(error)}`));
            }
        });
    });
}

export interface StackServerOptions {
    /** `/runtime.json` says start-up mode (a new map's Hosting-only deploy, the `fresh` seed). */
    readonly startUp: boolean;
}

/** The admin server of the stack on 127.0.0.1:4312: the admin's e2e build as Hosting serves it, behind the stack's routes. */
export function startStackAdmin(options: StackServerOptions): Promise<Server> {
    const admin = adminRequestHandler({
        distDir: ADMIN_DIST_DIR,
        hosting: parseHostingConfig(readFileSync('firebase.json', 'utf8')),
        connect: ADMIN_CONNECT_ORIGINS,
        webConfig: ADMIN_WEB_CONFIG,
        runtime: options.startUp ? { ...ADMIN_RUNTIME, startUp: true } : ADMIN_RUNTIME,
        project: ADMIN_PROJECT,
    });
    return listen(stackServer([commonRoute], admin), ADMIN_PORT);
}

/** The site server of the stack on 127.0.0.1:4310: the e2e sites, behind the stack's routes. */
export function startStackSite(): Promise<Server> {
    return listen(stackServer([commonRoute, siteRoute], siteRequestHandler(E2E_SITE_DIR)), SITE_PORT);
}
