import { runAs } from '../global-options.js';

import { randomBytes } from 'node:crypto';

import {
    API_ERRORS,
    ERROR_REPORT_MAX_BYTES,
    HTTP_ENDPOINTS,
    apiErrorDetails,
    errorReportSchema,
    validate,
    type ApiErrorCode,
    type ApiErrorDetails,
    type ErrorReport,
    type ReportedErrorEvent,
    type ValidationIssue,
    type ValidationResult,
} from '@hcm/shared';
import { onRequest } from 'firebase-functions/https';

import type { Ports } from '../ports/index.js';
import { toReportedErrorEvent } from './error-event.js';
import { createRateLimiter, type RateLimiter } from './rate-limit.js';

export type ReportErrorDeps = Pick<Ports, 'errors' | 'config' | 'clock' | 'log'>;

type ErrorService = ReportedErrorEvent['serviceContext']['service'];
type Headers = Readonly<Record<string, string>>;

/** One request to `telemetry.reportError`, as far as the handler reads it. */
export interface ReportRequest {
    readonly method: string;
    /** The `Origin` header (browsers always send it on a cross-origin POST). */
    readonly origin: string | undefined;
    /** Who is asking, for the per-client limit (the trigger takes the address Google's front end saw). */
    readonly client: string;
    /** The raw body: JSON, whether sent as `text/plain` (the engine: no preflight) or `application/json`. */
    readonly body: Uint8Array | undefined;
}

/** The answer: a status, its headers and, for a refusal, the JSON `ApiErrorDetails`. */
export interface ReportResponse {
    readonly status: number;
    readonly headers: Headers;
    readonly body?: ApiErrorDetails;
}

/** Browsers may cache the preflight for an hour. */
const PREFLIGHT_MAX_AGE_SECONDS = '3600';

/** `Retry-After` of a 429: the limits count per minute. */
const RETRY_AFTER_SECONDS = '60';

/** An allowed origin and the Error Reporting service it decides: a city site is the viewer, the admin's hosting the admin. */
interface AllowedOrigin {
    readonly origin: string;
    readonly service: ErrorService;
}

function allowedOrigin(deps: ReportErrorDeps, origin: string | undefined): AllowedOrigin | undefined {
    if (origin === undefined) {
        return undefined;
    }
    if (deps.config.viewerOrigins.includes(origin)) {
        return { origin, service: 'viewer' };
    }
    return deps.config.adminOrigins.includes(origin) ? { origin, service: 'admin' } : undefined;
}

function refusal(code: ApiErrorCode, headers: Headers, issues?: readonly ValidationIssue[]): ReportResponse {
    return { status: API_ERRORS[code].httpStatus, headers, body: apiErrorDetails(code, undefined, issues) };
}

function parseReport(body: Uint8Array): ValidationResult<ErrorReport> {
    let input: unknown;
    try {
        input = JSON.parse(new TextDecoder().decode(body));
    } catch {
        return { ok: false, issues: [{ path: '', code: 'validation.json' }] };
    }
    return validate(errorReportSchema, input);
}

/** A POST from an allowed origin: size, then rate, then shape; one structured log entry when all three pass. */
function accept(deps: ReportErrorDeps, limiter: RateLimiter, request: ReportRequest, allowed: AllowedOrigin): ReportResponse {
    const cors: Headers = { 'access-control-allow-origin': allowed.origin, vary: 'Origin' };
    const body = request.body ?? new Uint8Array();
    if (body.byteLength > ERROR_REPORT_MAX_BYTES) {
        return refusal('apiError.telemetry.tooLarge', cors);
    }
    if (!limiter.allow(request.client, deps.clock.now())) {
        return refusal('apiError.rateLimited', { ...cors, 'retry-after': RETRY_AFTER_SECONDS });
    }
    const report = parseReport(body);
    if (!report.ok) {
        return refusal('apiError.invalidRequest', cors, report.issues);
    }
    deps.errors.report(toReportedErrorEvent(report.value, allowed.service));
    return { status: 204, headers: cors };
}

/**
 * `telemetry.reportError` (public HTTPS; `docs/research/M2-interfaces.md` §3.4; S-A24-*): the crash endpoint of the
 * viewer and the admin. A preflight from an allowed origin → 204 with the CORS headers; any other method but POST →
 * 405; an origin outside `viewerOrigins` and `adminOrigins` → 403 `telemetry.origin` without CORS headers; a body over
 * 16 KiB → 413 before parsing; over the rate limits → 429 with `Retry-After`; a body `errorReportSchema` refuses →
 * 400 with the issues; otherwise the redacted `ReportedErrorEvent` is logged for Cloud Error Reporting → 204. Nothing
 * is written to Firestore and nothing but the accepted report is logged.
 */
export function handleErrorReport(deps: ReportErrorDeps, limiter: RateLimiter, request: ReportRequest): ReportResponse {
    const allowed = allowedOrigin(deps, request.origin);
    if (request.method === 'OPTIONS' && allowed !== undefined) {
        return {
            status: 204,
            headers: {
                'access-control-allow-origin': allowed.origin,
                'access-control-allow-methods': 'POST',
                'access-control-allow-headers': 'content-type',
                'access-control-max-age': PREFLIGHT_MAX_AGE_SECONDS,
                vary: 'Origin',
            },
        };
    }
    if (request.method !== 'POST') {
        return { status: 405, headers: { allow: 'POST, OPTIONS' } };
    }
    return allowed === undefined ? refusal('apiError.telemetry.origin', {}) : accept(deps, limiter, request, allowed);
}

/** The parts of the express request and response the endpoint uses (firebase-functions passes express objects). */
export interface HttpRequest {
    readonly method: string;
    readonly ip?: string | undefined;
    readonly rawBody?: Uint8Array;
    get(name: string): string | undefined;
}

export interface HttpResponse {
    status(code: number): this;
    set(headers: Headers): this;
    json(body: unknown): unknown;
    end(): unknown;
}

/** The last hop of `X-Forwarded-For`: the one Google's front end appends (a client may forge the earlier ones). */
function lastHop(forwardedFor: string | undefined): string {
    return forwardedFor?.split(',').at(-1)?.trim() ?? '';
}

/** The client of the per-client limit, else the socket address. It only ever lives in the limiter, salted and hashed. */
function clientOf(request: HttpRequest): string {
    const forwarded = lastHop(request.get('x-forwarded-for'));
    return forwarded === '' ? (request.ip ?? 'unknown') : forwarded;
}

/** The express handler: the request in, {@link handleErrorReport}'s answer out. */
export function serveErrorReports(getDeps: () => ReportErrorDeps, limiter: RateLimiter) {
    return (request: HttpRequest, response: HttpResponse): void => {
        const answer = handleErrorReport(getDeps(), limiter, {
            method: request.method,
            origin: request.get('origin'),
            client: clientOf(request),
            body: request.rawBody,
        });
        response.status(answer.status).set(answer.headers);
        if (answer.body === undefined) {
            response.end();
        } else {
            response.json(answer.body);
        }
    };
}

/** The `telemetry-reportError` HTTPS function: public, no CORS middleware (the handler answers CORS itself). */
export function reportErrorFunction(getDeps: () => ReportErrorDeps) {
    const limiter = createRateLimiter(randomBytes(16).toString('hex'));
    const { maxInstances } = HTTP_ENDPOINTS['telemetry.reportError'];
    return onRequest({ maxInstances, invoker: 'public', ...runAs('telemetry.reportError') }, serveErrorReports(getDeps, limiter));
}
