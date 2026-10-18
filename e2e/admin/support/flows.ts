import { gunzipSync } from 'node:zlib';

import { STORAGE_PATHS, translateAdminContent, validateManifest, type AdminContentKey } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { E2E_TOKEN, SITE_ORIGIN } from '../../fixtures/world.js';
import { mapIdle } from '../../support/map.js';
import { sitePath } from '../../support/site.js';
import { serveManifest, waitForEngineEvent } from '../../support/viewer.js';
import { E2E_PROJECT_ID } from '../world.js';
import type { EmulatorWorld } from './emulators.js';

/**
 * From the admin to the public viewer (behaviour A41, docs/research/M2c-interfaces.md §12.3 "Admin to viewer"): the
 * admin saves in the editors against the emulators; the publish trigger, the manifest build (the Cloud Tasks emulator
 * dispatches it at once) and the history triggers run in the Functions emulator; the spec then reads the manifest the
 * build wrote into the Storage emulator's public bucket, serves exactly that manifest to the built viewer of the site
 * server, and asserts what a visitor sees. Every value is a generated test value.
 */

/** The city of `infra/project.json` the admin edits. */
export const FLOWS_CITY = 'bucharest';

/** The public bucket the manifest build writes (`functions/src/deps.ts`: `<project>-public`). */
const PUBLIC_BUCKET = `${E2E_PROJECT_ID}-public`;

/** How long a manifest build may take: the trigger, the task and the build in the Functions emulator. */
const BUILD_TIMEOUT_MS = 60_000;

/** An editor text (`adminContent.*`) in the project's language. */
export function flowText(lang: 'ro' | 'en', key: AdminContentKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminContent(lang, key, params);
}

/**
 * The city as Setup leaves it once Mapbox is connected: bounds around Bucharest, its start view, About, the privacy text
 * and the theme of the built site (a manifest needs all three), the viewer's public token (the e2e token the mock Mapbox
 * accepts: without one the build refuses to publish), the photos overlay, published.
 */
export async function seedPublicCity(emulators: EmulatorWorld, at: Date): Promise<void> {
    const site = siteManifestData()['city'] as Json;
    await emulators.setDocument(`cities/${FLOWS_CITY}`, {
        about: site['about'],
        privacy: site['privacy'],
        theme: site['theme'],
        name: { ro: 'București', en: 'Bucharest' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        center: { lat: 44.43, lng: 26.1 },
        zoom: 13,
        mapbox: { user: 'e2e-user', publicToken: E2E_TOKEN },
        photosOverlay: { defaultOpacity: 1 },
        published: true,
        updatedBy: 'system:setup',
        updatedAt: at,
    });
}

/** The manifest the last build published (gzip JSON in the public bucket), or undefined before the first build. */
async function publicManifest(emulators: EmulatorWorld): Promise<Json | undefined> {
    const stored = await emulators.storageObject(PUBLIC_BUCKET, STORAGE_PATHS.manifest(FLOWS_CITY));
    if (stored === undefined) {
        return undefined;
    }
    const gzip = stored[0] === 0x1f && stored[1] === 0x8b;
    return JSON.parse((gzip ? gunzipSync(stored) : stored).toString('utf8')) as Json;
}

/** Waits until a build published a manifest for which `check` holds, and returns it. */
export async function awaitManifest(emulators: EmulatorWorld, what: string, check: (manifest: Json) => boolean): Promise<Json> {
    let found: Json | undefined;
    await expect
        .poll(
            async () => {
                found = await publicManifest(emulators);
                return found !== undefined && check(found);
            },
            { message: `the public manifest ${what}`, timeout: BUILD_TIMEOUT_MS },
        )
        .toBe(true);
    return found ?? {};
}

/** The entries of a manifest list (`photos`, `pois`, `layers`) as plain objects. */
export function entries(manifest: Json, list: 'photos' | 'pois' | 'layers'): Json[] {
    const value = manifest[list];
    return Array.isArray(value) ? (value as Json[]) : [];
}

/** The entry `id` of a manifest list, if the manifest has it. */
export function entry(manifest: Json, list: 'photos' | 'pois' | 'layers', id: string): Json | undefined {
    return entries(manifest, list).find((item) => item['id'] === id);
}

/**
 * The built manifest with every photo's derivatives pointed at a picture the site already serves: the public bucket is
 * the Storage emulator's, which the built viewer's Content Security Policy does not list (it lists the real bucket's
 * host). Nothing else changes.
 */
function withSiteImages(manifest: Json): Json {
    const [first] = entries(siteManifestData(), 'photos');
    const image = (first?.['image'] ?? {}) as Json;
    const photos = entries(manifest, 'photos').map((photo) => ({
        ...photo,
        image: { ...(photo['image'] as Json), web: image['web'], thumb: image['thumb'] },
    }));
    return { ...manifest, photos };
}

/**
 * The site's `config.js` for the project's city. The built Bucharest site names the legacy manifest's city
 * (`bucuresti`, `sites/bucharest/config.js`), while the project's city, and so every manifest the backend builds, is
 * `bucharest` (`infra/project.json`): the viewer refuses a manifest of another city, so the site must name the project's
 * city once it reads the backend's manifest (docs/research/DECISIONS-for-review.md §35b).
 */
const PROJECT_CITY_CONFIG = `window.HistoricCityMapConfig = { cityId: '${FLOWS_CITY}', manifestUrl: './data/manifest.json' };\n`;

/**
 * Opens the built Bucharest viewer as a visitor, configured for the project's city and served `manifest` (the one the
 * admin's save published), in `lang` at `hash`, and waits for `hcm-ready` and an idle map. The manifest must pass the
 * viewer's own validation first.
 */
export async function openPublicViewer(
    page: Page,
    manifest: Json,
    options: { readonly lang: 'ro' | 'en'; readonly hash: string },
): Promise<void> {
    const served = withSiteImages(manifest);
    const validation = validateManifest(served);
    expect(validation.ok ? [] : validation.issues, 'the published manifest passes the viewer validation').toEqual([]);
    await page.route('**/bucharest/config.js', (route) =>
        route.fulfill({ status: 200, contentType: 'text/javascript', body: PROJECT_CITY_CONFIG }),
    );
    await serveManifest(page, served);
    await page.goto(`${SITE_ORIGIN}${sitePath('bucharest', options)}`);
    await waitForEngineEvent(page, 'hcm-ready');
    await mapIdle(page);
}
