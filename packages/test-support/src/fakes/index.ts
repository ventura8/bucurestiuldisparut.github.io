/**
 * The fake upstreams (`@hcm/test-support/fakes`, docs/research/M2-interfaces.md §7; how to use them: docs/TESTING.md →
 * *Fake upstreams*). Environment-neutral (`fetch`, `Request`, `Response`): node tests, browser-mode tests and the
 * HTTP server of `@hcm/test-support/fakes/http` share them.
 */
export {
    createFakeFetch,
    type FakeAnswer,
    type FakeFetch,
    type RecordedCall,
    type UpstreamHandler,
    type UpstreamRequest,
} from './fetch.js';
export { GOOGLE_TOKENS, type GoogleGrant, type ProjectAccess } from './google-identity.js';
export { BILLED_SERVICES, SPARK_SERVICES } from './google-services.js';
export { PROVISIONED_SECRETS } from './google-secrets.js';
export { MAPBOX_TOKENS } from './mapbox-state.js';
export { jsonResponse, route, routeTable, type Route, type RouteAnswer, type RouteParams } from './routes.js';
export { FAILURE_MODES, UPSTREAM_SERVICES, type FailureMode, type UpstreamServiceName } from './service.js';
export { createUpstreamFakes, upstreamHosts, type UpstreamFakes, type UpstreamState } from './upstream.js';
export { USGS_CREDENTIALS } from './usgs.js';
