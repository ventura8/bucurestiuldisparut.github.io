import { authenticated, googleError, googleFailure, type GoogleApi } from './google-common.js';
import type { AnalyticsAdminState } from './google-analytics-admin.js';
import { jsonResponse, requestObject, route, type RouteParams } from './routes.js';
import type { ServiceFake } from './service.js';
import type { UpstreamRequest } from './fetch.js';

/**
 * The GA4 Data API's `batchRunReports` (`v1beta`; the Statistics view, `DECISIONS-for-review.md` §203; the answer's shape
 * as Google documents it, UNVERIFIED against the live API). A request that names a custom dimension or metric
 * (`customEvent:<name>`, `averageCustomEvent:<name>`) the property has not registered (the Analytics Admin fake's custom
 * definitions) answers 400 `INVALID_ARGUMENT`, as GA4 does. Without the `sample` scenario every report is empty (a
 * property with no data yet); with it each report gets fixed rows by its dimensions, scaled by the period's days.
 */

export interface AnalyticsDataState {
    /** The scenario `analytics-data.sample`: the reports have rows. */
    sample: boolean;
    /** The scenario `analytics-data.registered`: every custom name counts as registered (Setup's reports were made earlier). */
    registered: boolean;
    /** Each request's period in days, in order (the Statistics view asks once per period). */
    readonly periods: number[];
}

export function defaultAnalyticsDataState(): AnalyticsDataState {
    return { sample: false, registered: false, periods: [] };
}

const ANALYTICS_DATA: GoogleApi = {
    service: 'analyticsdata.googleapis.com',
    title: 'Google Analytics Data API',
    permission: 'analytics.properties.runReport',
};

type SampleRow = readonly [readonly string[], readonly number[]];

/** Fixed rows per report, keyed by its dimensions and the event it filters on (28 days' worth). */
const SAMPLES: Readonly<Record<string, readonly SampleRow[]>> = {
    '': [[[], [120, 180]]],
    'customEvent:wizard_id,customEvent:step_id|step_view': [
        [['new_city', 'names'], [10]],
        [['new_city', 'area'], [7]],
        [['new_city', 'create'], [5]],
    ],
    'customEvent:wizard_id,customEvent:step_id,customEvent:error_code|step_error': [
        [['new_city', 'area', 'apiError.invalidRequest'], [2]],
        [['new_city', 'area', 'e2e_unknown_code'], [1]],
    ],
    'customEvent:wizard_id,customEvent:step_id|step_complete': [
        [['new_city', 'names'], [30_000]],
        [['new_city', 'area'], [150_000]],
    ],
    'customEvent:app_surface|': [
        [['viewer'], [100, 150]],
        [['admin_owner'], [1, 9]],
        [['(not set)'], [19, 21]],
    ],
    'customEvent:app_surface,date|': [
        [
            ['viewer', '20261111'],
            [30, 40],
        ],
        [
            ['viewer', '20261112'],
            [50, 70],
        ],
        [
            ['admin_owner', '20261112'],
            [1, 9],
        ],
    ],
    'pagePath|': [
        [['/'], [300]],
        [['/admin/'], [40]],
    ],
    'customEvent:route|page_view': [
        [['home'], [12]],
        [['crashes'], [4]],
    ],
    'eventName|': [
        [['year_change'], [50]],
        [['photo_open'], [20]],
    ],
    'deviceCategory|': [
        [['desktop'], [80]],
        [['mobile'], [40]],
    ],
    'country|': [
        [['Romania'], [90]],
        [['Germany'], [10]],
    ],
};

type Json = Readonly<Record<string, unknown>>;

function names(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => String((item as Json)['name'])) : [];
}

/** The `eventName` a report filters on with one value (`stringFilter`), else empty. */
function filteredEvent(request: Json): string {
    const filter = (request['dimensionFilter'] as Json | undefined)?.['filter'] as Json | undefined;
    const value = (filter?.['stringFilter'] as Json | undefined)?.['value'];
    return typeof value === 'string' ? value : '';
}

/** A custom field (`customEvent:x`, `averageCustomEvent:x`) the property has not registered, or undefined. */
function unregistered(admin: AnalyticsAdminState, property: string, fields: readonly string[]): string | undefined {
    const registered = new Set(
        ['customDimensions', 'customMetrics'].flatMap((kind) =>
            (admin.definitions.get(`properties/${property}/${kind}`) ?? []).map((item) => item.parameterName),
        ),
    );
    return fields
        .map((field) => /^(?:average)?[cC]ustomEvent:(\w+)$/.exec(field)?.[1])
        .find((name) => name !== undefined && !registered.has(name));
}

function daysOf(request: Json): number {
    const range = Array.isArray(request['dateRanges']) ? (request['dateRanges'][0] as Json | undefined) : undefined;
    return Number(/^(\d+)daysAgo$/.exec(String(range?.['startDate']))?.[1] ?? '28');
}

function reportOf(state: AnalyticsDataState, request: Json): Json {
    const dimensions = names(request['dimensions']);
    const metrics = names(request['metrics']);
    const key = dimensions.length === 0 ? '' : `${dimensions.join(',')}|${filteredEvent(request)}`;
    const scale = daysOf(request) / 28;
    const rows = state.sample ? (SAMPLES[key] ?? []) : [];
    return {
        dimensionHeaders: dimensions.map((name) => ({ name })),
        metricHeaders: metrics.map((name) => ({ name, type: 'TYPE_INTEGER' })),
        ...(rows.length === 0
            ? {}
            : {
                  rows: rows.map(([values, numbers]) => ({
                      dimensionValues: values.map((value) => ({ value })),
                      metricValues: numbers.map((number) => ({ value: String(Math.round(number * scale)) })),
                  })),
              }),
        rowCount: rows.length,
        kind: 'analyticsData#runReport',
    };
}

function batch(state: AnalyticsDataState, admin: AnalyticsAdminState, request: UpstreamRequest, params: RouteParams): Response {
    const requests = (requestObject(request)['requests'] as Json[] | undefined) ?? [];
    const property = String(params['property']);
    const missing = state.registered
        ? undefined
        : requests
              .map((item) => unregistered(admin, property, [...names(item['dimensions']), ...names(item['metrics'])]))
              .find((name) => name !== undefined);
    if (missing !== undefined) {
        return googleError('google/error.invalid-argument', ANALYTICS_DATA);
    }
    state.periods.push(...requests.map(daysOf));
    return jsonResponse({ reports: requests.map((item) => reportOf(state, item)), kind: 'analyticsData#batchRunReports' });
}

/** The fake GA4 Data API over the Analytics Admin fake's custom definitions. */
export function createAnalyticsDataFake(state: AnalyticsDataState, admin: AnalyticsAdminState): ServiceFake {
    return {
        name: 'analytics-data',
        routes: [
            route(
                'POST',
                'https://analyticsdata.googleapis.com/v1beta/properties/{property}:batchRunReports',
                'analytics-data.batchRunReports',
                authenticated(ANALYTICS_DATA, (request, params) => batch(state, admin, request, params)),
            ),
        ],
        failure: (mode) => googleFailure(ANALYTICS_DATA, mode),
        scenarios: {
            sample: () => {
                state.sample = true;
            },
            registered: () => {
                state.registered = true;
            },
        },
        snapshot: () => ({ sample: state.sample, registered: state.registered, periods: [...state.periods] }),
    };
}
