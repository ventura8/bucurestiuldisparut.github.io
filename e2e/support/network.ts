import type { APIRequestContext, BrowserContext, Route, WebSocketRoute } from '@playwright/test';

import { MOCK_API_ORIGIN, TEST_HEADER } from '../fixtures/world.js';
import { isLoopback, mockedHostKind } from '../mock-apis/hosts.js';

/**
 * The browser context's network, decided per request (docs/research/design-review-testability.md §4.2):
 *
 * - loopback (the site server): passes through;
 * - a mocked host (Mapbox, analytics, the CDN, the e2e tile and telemetry hosts): forwarded to the mock APIs as
 *   `/h/<host><path>`, tagged with the test's id, and answered from there; nothing reaches the real host;
 * - anything else: aborted (`blockedbyclient`) and recorded, and the test fails at teardown (the firewall).
 *
 * WebSockets get the same rule through `routeWebSocket` (route handlers never see them). A page-level `page.route`
 * a spec registers wins over these context routes, which is how a bad path scripts one response.
 */

/** Recorded entries that the test either claims with `take()` or that fail the test at teardown. */
export class Recorder {
    readonly #entries: string[] = [];

    record(entry: string): void {
        this.#entries.push(entry);
    }

    /** The entries recorded so far, which the test now owns; the recorder is empty afterwards. */
    take(): string[] {
        return this.#entries.splice(0);
    }
}

/** Playwright's message when the page, context or browser went away during a route. */
const CLOSED = /has been closed|Target closed/;

/** Request headers the mock needs; the browser's own (cookies, host, origin) stay out of the forwarded copy. */
const FORWARDED_HEADERS = ['accept', 'content-type'];

function forwardedHeaders(headers: Readonly<Record<string, string>>, testId: string): Record<string, string> {
    const kept = Object.entries(headers).filter(([name]) => FORWARDED_HEADERS.includes(name));
    return { ...Object.fromEntries(kept), [TEST_HEADER]: testId };
}

async function forward(route: Route, api: APIRequestContext, testId: string): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataBuffer();
    const response = await api.fetch(`${MOCK_API_ORIGIN}/h/${url.hostname}${url.pathname}${url.search}`, {
        method: request.method(),
        headers: forwardedHeaders(await request.allHeaders(), testId),
        maxRedirects: 0,
        failOnStatusCode: false,
        ...(body === null ? {} : { data: body }),
    });
    await route.fulfill({ response });
}

async function decide(route: Route, api: APIRequestContext, testId: string, blocked: Recorder): Promise<void> {
    const url = route.request().url();
    const host = new URL(url).hostname;
    if (isLoopback(host)) {
        await route.fallback();
    } else if (mockedHostKind(host) === null) {
        blocked.record(url);
        await route.abort('blockedbyclient');
    } else {
        await forward(route, api, testId).catch(async (error: unknown) => {
            if (CLOSED.test(String(error))) {
                return; // the page or context closed while the answer was on its way: nothing is waiting for it
            }
            // The mock APIs are down or failed: say so through the firewall instead of leaving the request pending.
            blocked.record(`mock APIs unavailable for ${url}: ${String(error)}`);
            await route.abort('failed');
        });
    }
}

function guardWebSocket(socket: WebSocketRoute, blocked: Recorder): void {
    const url = socket.url();
    if (isLoopback(new URL(url).hostname)) {
        socket.connectToServer();
        return;
    }
    blocked.record(url);
    void socket.close({ code: 1008, reason: 'blocked by the e2e firewall' });
}

/** Installs the routes on `context`; `api` reaches the mock APIs from Node, `testId` tags every forwarded call. */
export async function installNetwork(context: BrowserContext, api: APIRequestContext, testId: string, blocked: Recorder): Promise<void> {
    await context.route('**/*', (route) => decide(route, api, testId, blocked));
    await context.routeWebSocket(/.*/, (socket) => {
        guardWebSocket(socket, blocked);
    });
}
