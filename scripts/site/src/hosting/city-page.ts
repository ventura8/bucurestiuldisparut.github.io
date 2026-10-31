import { STORAGE_PATHS, publicObjectUrl, type EngineConfig } from '@hcm/shared';

import { contentSecurityPolicy } from '../csp.js';
import type { SiteFileSystem } from '../files.js';
import { bucketOrigins } from '../origins.js';
import { ENGINE_FOLDER, renderSitePage } from '../page.js';
import { publicManifest } from '../public-manifest.js';
import type { SiteSpec } from '../site-spec.js';

/**
 * The Hosting site's generic city page (docs/research/M6-interfaces.md §2.4, behaviour V30): a city made in the admin
 * needs no repository step. Hosting rewrites every address that names a city id (`/iasi/`, `CITY_PATH_REGEX`) to
 * `/city/index.html` when no committed site has that folder; the page's `config.js` takes the city id from the address's
 * first segment, checks it with `CITY_ID_PATTERN` (inline: the script is self-contained; a test pins it to the shared one) and reads `cities/<id>/manifest.json` of the public bucket, which the
 * admin publishes. A city never published answers 404 there, and the viewer says its map was not found. The page's files
 * are absolute (`/engine/…`, `/city/config.js`, `/site.css`: the root site's engine and styles), since the browser's
 * address is the city's folder, not `/city/`.
 *
 * `configureCityPage` is the configuration's script, written like the admin's push service worker: typed and tested, its
 * source text the file, with the bucket's address parts as arguments (values of the build, never of the address).
 */

/** The page's folder on the Hosting site (a reserved city id: `RESERVED_CITY_IDS`). */
export const CITY_PAGE_FOLDER = 'city';

/** The addresses Hosting rewrites to the page: a city id, with or without its slash (`firebase.json` → `rewrites`). */
export const CITY_PATH_REGEX = '^/[a-z0-9-]{2,32}/?$';

/** What the script uses of the page's `window`. */
export interface CityConfigScope {
    readonly location: { readonly pathname: string };
    HistoricCityMapConfig?: unknown;
}

/**
 * Sets the engine's configuration from the address: the city id of its first segment (else `fallback`) and its
 * manifest in the public bucket, `before + id + after`. Self-contained: its source text is the page's `config.js`.
 */
export function configureCityPage(scope: CityConfigScope, before: string, after: string, fallback: string): void {
    const segment = scope.location.pathname.split('/')[1] ?? '';
    const cityId = /^[a-z0-9-]{2,32}$/.test(segment) ? segment : fallback;
    scope.HistoricCityMapConfig = { cityId, manifestUrl: `${before}${cityId}${after}` };
}

/** The page's spec: generic, since it serves every city made in the admin (each manifest names its city). */
function cityPageSpec(themeColor: string): SiteSpec {
    return {
        lang: 'ro',
        title: 'Hartă istorică',
        description: 'Fotografii vechi și straturi istorice ale orașului, așezate pe harta de azi.',
        themeColor,
        noscript: {
            ro: 'Harta are nevoie de JavaScript. Activează JavaScript în browser ca să vezi fotografiile și straturile istorice ale orașului.',
            en: 'The map needs JavaScript. Turn JavaScript on in your browser to see the historical photos and layers of the city.',
        },
        publicManifest: true,
    };
}

export interface CityPageInputs {
    readonly bucket: string;
    /** `sha384-…` of the pinned mapbox-gl.js and mapbox-gl.css. */
    readonly mapboxGlIntegrity: { readonly script: string; readonly stylesheet: string };
    /** The root site's theme colour. */
    readonly themeColor: string;
}

/** The page's two files, relative to the Hosting tree's root. */
export interface CityPageFiles {
    readonly page: { readonly to: string; readonly content: string };
    readonly config: { readonly to: string; readonly content: string };
}

/** The bucket's address of a city's manifest, split around the city id (the same address every site build names). */
function manifestAddressParts(bucket: string): { readonly before: string; readonly after: string } {
    const marker = 'hcm-city-id';
    const [before = '', after = ''] = publicObjectUrl(bucket, STORAGE_PATHS.manifest(marker)).split(marker);
    return { before, after };
}

/** The `config.js` of the page. */
function configSource(bucket: string): string {
    const { before, after } = manifestAddressParts(bucket);
    const args = [before, after, CITY_PAGE_FOLDER].map((value) => JSON.stringify(value)).join(', ');
    return [
        '// Historic City Map: the generic city page of the Hosting site (docs/research/M6-interfaces.md §2.4),',
        '// from scripts/site/src/hosting/city-page.ts.',
        "'use strict';",
        `(${configureCityPage.toString()})(window, ${args});`,
        '',
    ].join('\n');
}

/**
 * The page and its configuration; its meta policy names the public bucket and the project's crash endpoint
 * (`publicManifest`, as a city site reading the bucket names them). Throws SiteBuildError on a bucket name that is no
 * bucket's or a missing project file.
 */
export function planCityPage(inputs: CityPageInputs, files: SiteFileSystem): CityPageFiles {
    const sample: EngineConfig = { cityId: CITY_PAGE_FOLDER };
    const remote = publicManifest(inputs.bucket, sample, CITY_PAGE_FOLDER, files);
    const csp = contentSecurityPolicy(bucketOrigins(remote.config, remote.connect));
    const page = renderSitePage({
        spec: cityPageSpec(inputs.themeColor),
        csp,
        mapboxGlIntegrity: inputs.mapboxGlIntegrity,
        assets: { engineFolder: `/${ENGINE_FOLDER}/`, config: `/${CITY_PAGE_FOLDER}/config.js`, stylesheet: '/site.css' },
    });
    return {
        page: { to: `${CITY_PAGE_FOLDER}/index.html`, content: page },
        config: { to: `${CITY_PAGE_FOLDER}/config.js`, content: configSource(inputs.bucket) },
    };
}
