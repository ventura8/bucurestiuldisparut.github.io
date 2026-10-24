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
export { DEPLOYMENTS, registryFunctions, type Deployment } from './google-functions.js';
export { E2E_ORGANIZATION, GOOGLE_TOKENS, type GoogleGrant, type ProjectAccess } from './google-identity.js';
export { type CloudRunRunner, type PipelineExecution } from './google-run.js';
export { BILLED_SERVICES, SPARK_SERVICES } from './google-services.js';
export { IMAGERY_SECRET_VALUES, PROVISIONED_SECRETS } from './google-secrets.js';
export { E2E_PROJECT_CONFIG } from './project.js';
export { MAPBOX_TOKENS, type MapboxJobOutcome } from './mapbox-state.js';
export { publishedTileColour } from './mapbox-tiles.js';
export { solidPng, type Bytes, type Rgb } from './png.js';
export { jsonResponse, route, routeTable, type Route, type RouteAnswer, type RouteParams } from './routes.js';
export { FAILURE_MODES, UPSTREAM_SERVICES, type FailureMode, type UpstreamServiceName } from './service.js';
export { STAC_VISUAL_PATH } from './stac.js';
export { createUpstreamFakes, SERVER_ONLY_HOSTS, upstreamHosts, type UpstreamFakes, type UpstreamState } from './upstream.js';
export { USGS_CREDENTIALS } from './usgs.js';
export { browseJpeg, UNAVAILABLE_BROWSE_SCENE } from './usgs-browse.js';
export { acquisitionDate, catalogueScene, catalogueScenes, type CatalogueScene, type SceneResult } from './usgs-catalogue.js';
export { type DeliverySource } from './usgs-downloads.js';
