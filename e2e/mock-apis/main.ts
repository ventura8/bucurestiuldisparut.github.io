// Starts one e2e server (Playwright's `webServer`, e2e/playwright.config.ts), from the repository root:
//
//     node --import ./scripts/site/register-ts.mjs e2e/mock-apis/main.ts mock   # the mock APIs on 127.0.0.1:4311
//     node --import ./scripts/site/register-ts.mjs e2e/mock-apis/main.ts site   # dist/e2e-site on 127.0.0.1:4310
//
// It runs until Playwright stops it. Exit status 2 on a usage error.
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createLogger } from '@hcm/shared';
import { createUpstreamExtension } from '@hcm/test-support/fakes/http';

import { E2E_SITE_DIR, MOCK_API_PORT, SITE_PORT } from '../fixtures/world.js';
import { startMockApis, startSiteServer } from './server.js';

const log = createLogger('e2e-servers');
const role = process.argv[2];

if (role === 'mock') {
    // The pinned devDependency of @hcm/e2e, byte for byte what api.mapbox.com serves for v3.32.0.
    const mapboxGlDist = dirname(fileURLToPath(import.meta.resolve('mapbox-gl/dist/mapbox-gl.js')));
    // The fake upstreams (Google Cloud, Mapbox's Tokens and Tilesets APIs, USGS M2M, Nominatim) answer first, one world per test.
    await startMockApis(MOCK_API_PORT, { mapboxGlDist, engineDist: resolve('packages/engine/dist') }, [createUpstreamExtension()]);
    log.info('mock APIs listening', { port: MOCK_API_PORT });
} else if (role === 'site') {
    await startSiteServer(SITE_PORT, E2E_SITE_DIR);
    log.info('site server listening', { port: SITE_PORT, dir: E2E_SITE_DIR });
} else {
    log.error('usage: main.ts mock|site', { role });
    process.exitCode = 2;
}
