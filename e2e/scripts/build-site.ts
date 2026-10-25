// Builds the sites the e2e tiers serve (`npm run build:site:e2e`, which gate `e2e-build` runs through scripts/ci/e2e_build.py
// unless nothing changed since the last build) into dist/e2e-site:
// Bucharest with the e2e fixture manifest (e2e/fixtures/manifest.ts), so its meta CSP names the e2e tile and telemetry
// hosts exactly as a production build names its own; the same site reading the public bucket's manifest instead
// (`bucharest-bucket`, the build's `publicBucket`: DECISIONS-for-review.md §51e); and the starter kit as committed. All
// carry the e2e token. M5 (docs/research/M5-interfaces.md §1.10): the second public city `e2e-second` (its own fixture
// manifest) and `e2e-unpublished` (the public bucket only), then the GitHub Pages tree `pages/` the production build's
// `--pages` makes: Bucharest at its root, each other city in its folder (e2e/fixtures/second-city.ts).
// The same build code as production (scripts/site/src/build.ts); only the manifest and the token differ.
// When the admin tier or the tour runs (`E2E_TIER` unset, `all`, or naming `admin`, `tour` or `tour-matrix`), also the
// admin's Hosting folder: its page and the legacy import bundle next to the admin's e2e-mode Vite build in
// packages/admin/dist (scripts/site/src/admin/).
import process from 'node:process';

import { createLogger } from '@hcm/shared';

import { buildAdminSite } from '../../scripts/site/src/admin/build.js';
import { buildSite } from '../../scripts/site/src/build.js';
import { SiteBuildError } from '../../scripts/site/src/errors.js';
import { nodeFileSystem } from '../../scripts/site/src/files.js';
import { assemblePages } from '../../scripts/site/src/pages.js';
import { ADMIN_DIST_DIR } from '../admin/world.js';
import { buildFixtureManifest } from '../fixtures/manifest.js';
import { PAGES_FOLDER, SECOND_CITY, UNPUBLISHED_CITY, buildSecondCityManifest } from '../fixtures/second-city.js';
import { E2E_PUBLIC_BUCKET, E2E_SITE_DIR, E2E_TOKEN } from '../fixtures/world.js';
import { needsAdmin, tiersFrom } from '../projects.js';

const log = createLogger('e2e-site-build');
const files = nodeFileSystem(process.cwd());

try {
    for (const report of [
        buildSite(
            { siteDir: 'sites/bucharest', outDir: `${E2E_SITE_DIR}/bucharest`, token: E2E_TOKEN, manifest: buildFixtureManifest() },
            files,
        ),
        buildSite(
            {
                siteDir: 'sites/bucharest',
                outDir: `${E2E_SITE_DIR}/bucharest-bucket`,
                token: E2E_TOKEN,
                manifest: buildFixtureManifest(),
                publicBucket: E2E_PUBLIC_BUCKET,
            },
            files,
        ),
        buildSite({ siteDir: 'starter-kit', outDir: `${E2E_SITE_DIR}/starter-kit`, token: E2E_TOKEN }, files),
        buildSite(
            {
                siteDir: `e2e/fixtures/sites/${SECOND_CITY}`,
                outDir: `${E2E_SITE_DIR}/${SECOND_CITY}`,
                token: E2E_TOKEN,
                manifest: buildSecondCityManifest(),
            },
            files,
        ),
        buildSite(
            {
                siteDir: `e2e/fixtures/sites/${UNPUBLISHED_CITY}`,
                outDir: `${E2E_SITE_DIR}/${UNPUBLISHED_CITY}`,
                token: E2E_TOKEN,
                publicBucket: E2E_PUBLIC_BUCKET,
            },
            files,
        ),
    ]) {
        log.info('e2e site built', { ...report });
    }
    const pages = [
        { outDir: `${E2E_SITE_DIR}/bucharest`, pagesPath: '' },
        { outDir: `${E2E_SITE_DIR}/${SECOND_CITY}`, pagesPath: `${SECOND_CITY}/` },
        { outDir: `${E2E_SITE_DIR}/${UNPUBLISHED_CITY}`, pagesPath: `${UNPUBLISHED_CITY}/` },
    ];
    log.info('e2e pages assembled', { ...assemblePages(pages, `${E2E_SITE_DIR}/${PAGES_FOLDER}`, files) });
    if (needsAdmin(tiersFrom(process.env['E2E_TIER']))) {
        log.info('e2e admin built', { ...buildAdminSite({ outDir: ADMIN_DIST_DIR }, files) });
    }
} catch (error: unknown) {
    if (!(error instanceof SiteBuildError)) {
        throw error;
    }
    log.error(error.message);
    process.exitCode = 1;
}
