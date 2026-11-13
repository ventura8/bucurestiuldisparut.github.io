import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { siteManifestData, type Json } from '../fixtures/manifest.js';
import { mapIdle, screenPointOf } from '../support/map.js';
import { openLayers, openViewer, serveManifest, viewer, visibilitySwitch } from '../support/viewer.js';

/** The tour's states of M27's Disappeared streets (V71; docs/research/M27-lost-streets.md), from e2e/tour/states.ts. */

interface LostStreetsState {
    readonly title: string;
    readonly enter: (tour: { readonly page: Page; readonly lang: Locale }) => Promise<void>;
}

const LABEL = { ro: 'Străzi dispărute', en: 'Disappeared streets' } as const;

export const LOST_STREETS_STATES = {
    'layers-lost-streets': {
        title: 'The Layers panel with Disappeared streets pinned below Compare and Map labels, switched on',
        enter: async ({ page, lang }) => {
            await openLayers(page, lang);
            const streets = visibilitySwitch(page, lang, LABEL[lang]);
            await streets.click();
            await expect(streets).toHaveAttribute('aria-checked', 'true');
            await mapIdle(page);
        },
    },
    'lost-street': {
        title: 'A disappeared street open in the sheet: its name, years and sources',
        enter: async ({ page }) => {
            const point = await screenPointOf(page, [26.0882, 44.42598]);
            await page.mouse.click(point.x, point.y);
            await expect(viewer(page).locator('hcm-poi-detail .sources')).toBeVisible();
        },
    },
} as const satisfies Record<string, LostStreetsState>;

/** The fixture with a pinned, hidden-at-start Disappeared streets category and one street traced on its first layer. */
export function lostStreetsManifest(): Json {
    const manifest = siteManifestData();
    const [layer] = manifest['layers'] as [Json];
    (manifest['poiCategories'] as Json[]).push({
        ...{ id: 'strazi-disparute', label: LABEL, icon: 'add_road', color: '#B3261E', defaultOpacity: 1 },
        ...{ defaultVisible: false, pinned: true, attribution: 'OpenHistoricalMap (CC0)' },
    });
    (manifest['pois'] as Json[]).push({
        id: 'ls-ohm-1',
        category: 'strazi-disparute',
        geometry: {
            type: 'LineString',
            coordinates: [
                [26.085, 44.4256],
                [26.087, 44.4258],
                [26.089, 44.4261],
            ],
        },
        title: { ro: 'Strada Mămulari', en: 'Strada Mămulari' },
        yearStart: 1900,
        yearEnd: 1983,
        links: [{ url: 'https://www.openhistoricalmap.org/way/1', label: 'OpenHistoricalMap' }],
        sourceLayer: layer['id'],
    });
    return manifest;
}

export const LOST_STREETS_JOURNEY = {
    title: 'Disappeared streets: pinned in Layers, switched on, one street open',
    id: 'lost-streets',
    boot: async ({ page, lang }: { readonly page: Page; readonly lang: Locale }): Promise<void> => {
        await serveManifest(page, lostStreetsManifest());
        await openViewer(page, { lang, hash: '16/44.42590/26.08720' });
    },
    states: ['layers-lost-streets', 'lost-street'] as const,
};
