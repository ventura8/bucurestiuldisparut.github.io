import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

import { TEST_HEADER } from '../fixtures/world.js';
import { answer, type MockFiles, type MockResponse } from './router.js';

/**
 * The two loopback servers of the e2e topology (docs/research/design-review-testability.md §4.1), plain `node:http`:
 *
 * - **mock APIs**: `/h/<host><path>` answers a forwarded request for a mocked host (router.ts) and records it;
 *   `GET /__calls[?test=<id>&host=<host>]` lists the records (oldest first), `POST /__reset[?test=<id>]` forgets them,
 *   `GET /__health` says the server is up.
 * - **site**: the built sites (`dist/e2e-site`) as GitHub Pages serves them: `index.html` for a folder, a redirect to
 *   the folder with its trailing slash, `cache-control: max-age=600` and `access-control-allow-origin: *`.
 */

/** One forwarded request as the mock saw it. */
export interface RecordedCall {
    readonly seq: number;
    readonly test: string;
    readonly method: string;
    readonly host: string;
    readonly path: string;
    readonly query: string;
    readonly status: number;
    /** The request body as text, at most 64 KiB (beacons, error reports). */
    readonly body: string;
}

const MAX_BODY = 64 * 1024;
const CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
    'access-control-allow-headers': '*',
} as const;

const SITE_TYPES: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.map': 'application/json',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
};

interface RequestTarget {
    readonly pathname: string;
    /** `?…` or empty. */
    readonly search: string;
    readonly searchParams: URLSearchParams;
}

/** The path and query of a request target (`/h/api.mapbox.com/v4/x.json?secure`), parsed without inventing an origin. */
function requestTarget(request: IncomingMessage): RequestTarget {
    const raw = request.url ?? '/';
    const queryStart = raw.indexOf('?');
    const pathname = queryStart === -1 ? raw : raw.slice(0, queryStart);
    const search = queryStart === -1 ? '' : raw.slice(queryStart);
    return { pathname, search, searchParams: new URLSearchParams(search) };
}

async function readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).subarray(0, MAX_BODY).toString('utf8');
}

function send(response: ServerResponse, result: MockResponse, extra: Readonly<Record<string, string>> = {}): void {
    const headers: Record<string, string> = { 'cache-control': 'no-store', ...CORS_HEADERS, ...extra };
    if (result.type !== undefined) {
        headers['content-type'] = result.type;
    }
    response.writeHead(result.status, headers);
    response.end(result.body);
}

/** In-memory record of every forwarded call. */
class CallLog {
    readonly #calls: RecordedCall[] = [];
    #seq = 0;

    record(call: Omit<RecordedCall, 'seq'>): void {
        this.#seq += 1;
        this.#calls.push({ seq: this.#seq, ...call });
    }

    list(test: string | null, host: string | null): RecordedCall[] {
        return this.#calls.filter((call) => (test === null || call.test === test) && (host === null || call.host === host));
    }

    clear(test: string | null): void {
        const kept = this.#calls.filter((call) => test !== null && call.test !== test);
        this.#calls.splice(0, this.#calls.length, ...kept);
    }
}

async function forwarded(request: IncomingMessage, url: RequestTarget, log: CallLog, files: MockFiles): Promise<MockResponse> {
    const [, , host = '', ...rest] = url.pathname.split('/');
    const path = `/${rest.join('/')}`;
    const method = request.method ?? 'GET';
    const body = await readBody(request);
    const result = method === 'OPTIONS' ? { status: 204 } : await answer({ method, host, path, query: url.searchParams, body }, files);
    const test = request.headers[TEST_HEADER];
    log.record({ test: typeof test === 'string' ? test : '', method, host, path, query: url.search, status: result.status, body });
    return result;
}

async function handleMock(request: IncomingMessage, response: ServerResponse, log: CallLog, files: MockFiles): Promise<void> {
    const url = requestTarget(request);
    if (url.pathname.startsWith('/h/')) {
        send(response, await forwarded(request, url, log, files));
    } else if (url.pathname === '/__calls') {
        send(response, {
            status: 200,
            type: 'application/json',
            body: JSON.stringify(log.list(url.searchParams.get('test'), url.searchParams.get('host'))),
        });
    } else if (url.pathname === '/__reset' && request.method === 'POST') {
        log.clear(url.searchParams.get('test'));
        send(response, { status: 204 });
    } else if (url.pathname === '/__health') {
        send(response, { status: 200, type: 'text/plain', body: 'ok' });
    } else {
        send(response, { status: 404, type: 'text/plain', body: 'unknown mock endpoint' });
    }
}

function listen(server: Server, port: number): Promise<Server> {
    return new Promise((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            resolvePromise(server);
        });
    });
}

function failed(response: ServerResponse, error: unknown): void {
    if (!response.headersSent) {
        send(response, { status: 500, type: 'text/plain', body: `mock failure: ${String(error)}` });
    }
}

/** Starts the mock APIs on 127.0.0.1:`port`. */
export function startMockApis(port: number, files: MockFiles, log = new CallLog()): Promise<Server> {
    const server = createServer((request, response) => {
        handleMock(request, response, log, files).catch((error: unknown) => {
            failed(response, error);
        });
    });
    return listen(server, port);
}

async function isFile(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isFile();
    } catch {
        return false;
    }
}

/** The file a site URL names below `dir`, or null outside `dir` or when missing; a folder means its index.html. */
async function siteFile(dir: string, pathname: string): Promise<{ file: string } | { redirect: string } | null> {
    const target = normalize(join(dir, decodeURIComponent(pathname)));
    if (target !== dir && !target.startsWith(`${dir}${sep}`)) {
        return null;
    }
    if (await isFile(target)) {
        return { file: target };
    }
    if (!(await isFile(join(target, 'index.html')))) {
        return null;
    }
    return pathname.endsWith('/') ? { file: join(target, 'index.html') } : { redirect: `${pathname}/` };
}

async function handleSite(request: IncomingMessage, response: ServerResponse, dir: string): Promise<void> {
    const url = requestTarget(request);
    if (url.pathname === '/__health') {
        send(response, { status: 200, type: 'text/plain', body: 'ok' });
        return;
    }
    const found = await siteFile(dir, url.pathname);
    if (found === null) {
        send(response, { status: 404, type: 'text/plain', body: 'Not found' }, { 'cache-control': 'max-age=600' });
    } else if ('redirect' in found) {
        send(response, { status: 301 }, { location: `${found.redirect}${url.search}` });
    } else {
        const type = SITE_TYPES[extname(found.file)] ?? 'application/octet-stream';
        send(response, { status: 200, type, body: await readFile(found.file) }, { 'cache-control': 'max-age=600' });
    }
}

/** Serves the built sites in `dir` on 127.0.0.1:`port`. */
export function startSiteServer(port: number, dir: string): Promise<Server> {
    const root = resolve(dir);
    const server = createServer((request, response) => {
        handleSite(request, response, root).catch((error: unknown) => {
            failed(response, error);
        });
    });
    return listen(server, port);
}
