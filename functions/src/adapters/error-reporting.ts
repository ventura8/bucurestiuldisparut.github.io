import { ERROR_GROUP_RESOLUTIONS, type ListGroupsRequest, type ListGroupsResponse } from '@hcm/shared';
import type { LogEntry } from 'firebase-functions/logger';

import type { ErrorReporter } from '../ports/error-reporter.js';
import { UpstreamError, type UpstreamFailure } from '../ports/errors.js';
import type { TokenProvider } from '../ports/token-provider.js';
import { googleError } from './google-call.js';

export const ERROR_REPORTING_API = 'https://clouderrorreporting.googleapis.com/v1beta1';

/** The `groupStats` time range of each period the "Crash reports" panel offers. */
const PERIODS: Readonly<Record<ListGroupsRequest['hours'], string>> = { 24: 'PERIOD_1_DAY', 168: 'PERIOD_1_WEEK', 720: 'PERIOD_30_DAYS' };

/** The limits of `listGroupsResponseSchema`: longer upstream values are cut, never refused. */
const LIMITS = { groupId: 200, message: 500, service: 100, version: 64 } as const;

const FAILURES: Readonly<Partial<Record<number, UpstreamFailure>>> = {
    401: 'unauthorized',
    403: 'forbidden',
    404: 'notFound',
    429: 'rateLimited',
};

type Group = ListGroupsResponse['groups'][number];
type Fields = Readonly<Record<string, unknown>>;

export interface ErrorReportingOptions {
    readonly projectId: string;
    /** The runtime service account's tokens (`roles/errorreporting.viewer` for `groupStats`). */
    readonly tokens: TokenProvider;
    readonly fetch: typeof fetch;
    /** `write` of `firebase-functions/logger`: one structured entry on stdout, parsed by Cloud Logging. */
    readonly write: (entry: LogEntry) => void;
}

function fields(value: unknown): Fields {
    return typeof value === 'object' && value !== null ? (value as Fields) : {};
}

function text(value: unknown): string | undefined {
    return typeof value === 'string' && value !== '' ? value : undefined;
}

/** An RFC 3339 time with any precision, as the ISO 8601 milliseconds a response carries; undefined when unreadable. */
function isoTime(value: unknown): string | undefined {
    const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
    return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** `count` is an int64, which JSON carries as a string. */
function countOf(value: unknown): number {
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function resolutionOf(value: unknown): Group['resolution'] {
    return ERROR_GROUP_RESOLUTIONS.find((resolution) => resolution === value) ?? 'OPEN';
}

/** The first line of the representative message (the error, not its stack). */
function firstLine(message: string): string {
    const end = message.indexOf('\n');
    return (end < 0 ? message : message.slice(0, end)).slice(0, LIMITS.message);
}

function serviceFields(representative: Fields): Pick<Group, 'service' | 'version'> {
    const context = fields(representative['serviceContext']);
    const version = text(context['version']);
    return {
        service: (text(context['service']) ?? 'unknown').slice(0, LIMITS.service),
        ...(version === undefined ? {} : { version: version.slice(0, LIMITS.version) }),
    };
}

/** One `ErrorGroupStats`; a group without an id or its times is left out rather than failing the whole page. */
function toGroups(value: unknown): Group[] {
    const stats = fields(value);
    const group = fields(stats['group']);
    const representative = fields(stats['representative']);
    const groupId = text(group['groupId']);
    const [firstSeen, lastSeen] = [isoTime(stats['firstSeenTime']), isoTime(stats['lastSeenTime'])];
    if (groupId === undefined || firstSeen === undefined || lastSeen === undefined) {
        return [];
    }
    return [
        {
            groupId: groupId.slice(0, LIMITS.groupId),
            message: firstLine(text(representative['message']) ?? ''),
            ...serviceFields(representative),
            count: countOf(stats['count']),
            firstSeen,
            lastSeen,
            resolution: resolutionOf(group['resolutionStatus']),
        },
    ];
}

function toResponse(body: unknown): ListGroupsResponse {
    const page = fields(body);
    const stats: unknown = page['errorGroupStats'];
    const nextPageToken = text(page['nextPageToken']);
    return {
        groups: (Array.isArray(stats) ? (stats as readonly unknown[]) : []).flatMap(toGroups),
        ...(nextPageToken === undefined ? {} : { nextPageToken }),
    };
}

function groupStatsUrl(projectId: string, request: ListGroupsRequest): string {
    const query = new URLSearchParams({
        'timeRange.period': PERIODS[request.hours],
        pageSize: String(request.pageSize),
        order: 'LAST_SEEN_DESC',
    });
    if (request.pageToken !== undefined) {
        query.set('pageToken', request.pageToken);
    }
    return `${ERROR_REPORTING_API}/projects/${encodeURIComponent(projectId)}/groupStats?${query.toString()}`;
}

/** A refused answer; a 403 that says the API is disabled names it (`UpstreamError.api`, CR-M2-11). */
function failureOf(response: Response): Promise<UpstreamError> {
    return googleError('error-reporting', response, FAILURES[response.status] ?? (response.status >= 500 ? 'unavailable' : 'invalid'));
}

async function getJson(options: ErrorReportingOptions, url: string): Promise<unknown> {
    const token = await options.tokens.accessToken();
    const response = await options.fetch(url, { method: 'GET', headers: { authorization: `Bearer ${token}` } }).catch(() => {
        throw new UpstreamError('error-reporting', 'unavailable');
    });
    if (!response.ok) {
        throw await failureOf(response);
    }
    return response.json().catch(() => {
        throw new UpstreamError('error-reporting', 'invalid', { status: response.status });
    });
}

/**
 * The `ErrorReporter` port (PLAN Addendum 2): `report` writes one structured log entry, severity ERROR, whose
 * `jsonPayload` is the `ReportedErrorEvent` (Cloud Error Reporting groups it; no API call and no quota per report);
 * `listGroups` reads `projects/{p}/groupStats` of the Error Reporting API v1beta1 over REST, newest first. Failures
 * are `UpstreamError`s of the service `error-reporting` (401 `unauthorized`, 403 `forbidden` (a missing
 * `roles/errorreporting.viewer` or a disabled API), 429 `rateLimited`, 5xx and network `unavailable`, an unreadable
 * body `invalid`).
 */
export function createErrorReporter(options: ErrorReportingOptions): ErrorReporter {
    return {
        report: (event) => {
            options.write({ severity: 'ERROR', ...event });
        },
        listGroups: async (request) => toResponse(await getJson(options, groupStatsUrl(options.projectId, request))),
    };
}
