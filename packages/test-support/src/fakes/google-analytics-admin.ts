import { FIXTURE_VALUES, fixtureBody } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi } from './google-common.js';
import type { FirebaseState } from './google-firebase.js';
import { applyMask, jsonResponse, requestObject, route, type Route, type RouteParams } from './routes.js';
import type { ServiceFake } from './service.js';

/**
 * The Google Analytics Admin API's enhanced-measurement settings of the GA4 web stream (CR-M2-37,
 * `docs/research/M2b-interfaces.md` §3.3 g; the `v1alpha` version is **UNVERIFIED**): the stream exists once Google
 * Analytics is linked to the e2e project (Firebase Management's `analyticsLinked`), with history-change page views on.
 */

export interface AnalyticsAdminState {
    /** `properties/<id>/dataStreams/<id>` → its settings as last written. */
    readonly settings: Map<string, Readonly<Record<string, unknown>>>;
}

const ANALYTICS_ADMIN: GoogleApi = {
    service: 'analyticsadmin.googleapis.com',
    title: 'Google Analytics Admin API',
    permission: 'analytics.properties.update',
};

/** The fake Analytics Admin API over the Firebase Management fake's analytics link. */
export function createAnalyticsAdminFake(state: AnalyticsAdminState, firebase: FirebaseState): ServiceFake {
    const linked = (): boolean => firebase.projects.get(String(FIXTURE_VALUES['projectId']))?.measurementId !== undefined;
    const keyOf = (params: RouteParams): string => `properties/${String(params['property'])}/dataStreams/${String(params['stream'])}`;
    const current = (params: RouteParams): Readonly<Record<string, unknown>> =>
        state.settings.get(keyOf(params)) ??
        (fixtureBody('analytics-admin/enhanced-measurement-settings.get', {
            analyticsPropertyId: String(params['property']),
            streamId: String(params['stream']),
        }) as Record<string, unknown>);
    const withStream = (answer: () => Response): Response => (linked() ? answer() : googleError('google/error.not-found', ANALYTICS_ADMIN));
    const patch: Route['answer'] = (request, params) =>
        withStream(() => {
            const updated = applyMask(current(params), requestObject(request), request.url.searchParams.get('updateMask'));
            state.settings.set(keyOf(params), updated);
            return jsonResponse(updated);
        });
    const url = 'https://analyticsadmin.googleapis.com/v1alpha/properties/{property}/dataStreams/{stream}/enhancedMeasurementSettings';
    return {
        name: 'analytics-admin',
        routes: [
            route(
                'GET',
                url,
                'analytics-admin.enhancedMeasurementSettings.get',
                authenticated(ANALYTICS_ADMIN, (_request, params) => withStream(() => jsonResponse(current(params)))),
            ),
            route('PATCH', url, 'analytics-admin.enhancedMeasurementSettings.patch', authenticated(ANALYTICS_ADMIN, patch)),
        ],
        failure: (mode) => googleFailure(ANALYTICS_ADMIN, mode),
        scenarios: {},
        snapshot: () => ({ settings: Object.fromEntries(state.settings) }),
    };
}
