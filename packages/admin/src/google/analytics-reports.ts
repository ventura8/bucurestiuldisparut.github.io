import { at, records, stringAt } from './json.js';
import { createGoogleTransport, type GoogleTransportOptions } from './transport.js';

/**
 * Step (g)'s Create the measurement reports (`DECISIONS-for-review.md` §76f, the user's decision of 2026-11-01): the
 * field measurements' parameters (`docs/ARCHITECTURE.md` → *Field measurements*, `docs/ADMIN_GUIDE.*.md`) registered
 * as custom dimensions and metrics of the project's GA4 property, so GA4's reports and explorations can use them. The
 * property is the one whose web stream has the project's measurement id, found through the Google Analytics Admin API
 * (`v1beta`: account summaries, then each property's data streams). Idempotent: a parameter already registered (as a
 * dimension or a metric) is skipped. A lazy chunk of its own (`analytics-reports`): fetched on the button's click only.
 */

const API = 'https://analyticsadmin.googleapis.com/v1beta';
const ROLE = 'roles/analytics.editor';

/** The event-scoped custom dimensions: the parameters reports group by. */
export const FIELD_DIMENSIONS: readonly string[] = [
    'metric_name',
    'metric_rating',
    'debug_target',
    'window_class',
    'release',
    'phase',
    'step',
    'outcome',
    'area',
    'target',
    'error_kind',
];

/** The event-scoped custom metrics and their units: the numbers reports add up or average. */
export const FIELD_METRICS: Readonly<Record<string, 'MILLISECONDS' | 'STANDARD'>> = {
    metric_value: 'MILLISECONDS',
    duration_ms: 'MILLISECONDS',
    error_count: 'STANDARD',
};

export interface MeasurementReports {
    readonly created: number;
    readonly skipped: number;
}

/** The property (`properties/<id>`) whose web stream sends `measurementId`, among those the owner can see. */
async function propertyOf(transport: ReturnType<typeof createGoogleTransport>, measurementId: string): Promise<string | undefined> {
    const summaries = await transport.pages(
        { operation: 'analytics-admin.accountSummaries.list', url: `${API}/accountSummaries`, role: ROLE },
        'accountSummaries',
    );
    const properties = summaries.flatMap((summary) => records(at(summary, 'propertySummaries'))).map((item) => String(item['property']));
    for (const property of properties) {
        const streams = await transport.pages(
            { operation: 'analytics-admin.dataStreams.list', url: `${API}/${property}/dataStreams`, role: ROLE },
            'dataStreams',
        );
        if (streams.some((stream) => stringAt(stream, 'webStreamData', 'measurementId') === measurementId)) {
            return property;
        }
    }
    return undefined;
}

/**
 * Registers every field parameter not registered yet on the property of `measurementId`; null when no property the
 * owner can see sends it.
 */
export async function createMeasurementReports(options: GoogleTransportOptions, measurementId: string): Promise<MeasurementReports | null> {
    const transport = createGoogleTransport(options);
    const property = await propertyOf(transport, measurementId);
    if (property === undefined) {
        return null;
    }
    const listed = async (kind: string): Promise<readonly unknown[]> =>
        transport.pages({ operation: `analytics-admin.${kind}.list`, url: `${API}/${property}/${kind}`, role: ROLE }, kind);
    const existing = new Set(
        [...(await listed('customDimensions')), ...(await listed('customMetrics'))].map((item) => stringAt(item, 'parameterName')),
    );
    const wanted = [
        ...FIELD_DIMENSIONS.map((name) => ['customDimensions', { parameterName: name, displayName: name, scope: 'EVENT' }] as const),
        ...Object.entries(FIELD_METRICS).map(
            ([name, measurementUnit]) =>
                ['customMetrics', { parameterName: name, displayName: name, scope: 'EVENT', measurementUnit }] as const,
        ),
    ];
    const missing = wanted.filter(([, body]) => !existing.has(body.parameterName));
    for (const [kind, body] of missing) {
        await transport.call({
            operation: `analytics-admin.${kind}.create`,
            method: 'POST',
            url: `${API}/${property}/${kind}`,
            body,
            role: ROLE,
        });
    }
    return { created: missing.length, skipped: wanted.length - missing.length };
}
