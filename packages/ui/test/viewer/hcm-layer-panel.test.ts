import { overlaysFromManifest, withOverlayVisibility } from '@hcm/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import {
    HCM_LAYER_PANEL_TAG,
    HcmLayerPanel,
    attributionLines,
    defineHcmLayerPanel,
    overlayGroups,
    overlayItems,
} from '../../src/viewer/hcm-layer-panel.js';
import { defineKitDoubles, mountElement, recordEvents, shadowQuery, shadowText } from './doubles.js';
import { testManifest } from './fixtures.js';

interface OverlayListProps {
    readonly items: readonly { readonly id: string }[];
    readonly groups: readonly { readonly kind: string; readonly label: string }[];
    readonly toggleLabel: string;
    readonly opacityLabel: string;
    readonly valueText: string;
    readonly changedText: string;
}

async function panel(properties: Partial<HcmLayerPanel> = {}): Promise<HcmLayerPanel> {
    const manifest = testManifest();
    return mountElement<HcmLayerPanel>(HCM_LAYER_PANEL_TAG, {
        manifest,
        overlays: overlaysFromManifest(manifest),
        open: true,
        ...properties,
    });
}

describe('overlay list data', () => {
    const manifest = testManifest();
    const overlays = overlaysFromManifest(manifest);

    it('happyPath_everyOverlayWithLocalizedLabelsAndCategorySwatches', () => {
        expect(overlayItems(overlays, manifest, 'en')).toEqual([
            { id: 'kh4-1966', kind: 'raster', label: 'Corona 1966', visible: true, opacity: 0.9 },
            { id: 'kh9-1977', kind: 'raster', label: 'KH-9 1977', visible: false, opacity: 1 },
            { id: 'photos', kind: 'photos', label: 'Photos', visible: true, opacity: 1 },
            {
                id: 'cladiri',
                kind: 'poi',
                label: 'Vanished buildings',
                visible: true,
                opacity: 1,
                color: '#8B5E3C',
                icon: 'domain_disabled',
            },
            { id: 'evenimente', kind: 'poi', label: 'Events', visible: true, opacity: 0.8, color: '#386A20', icon: 'location_on' },
        ]);
    });

    it('happyPath_groupsAndAttributionOfVisibleLayers', () => {
        expect(overlayGroups(manifest, 'ro')).toEqual([
            { kind: 'raster', label: 'Straturi istorice' },
            { kind: 'poi', label: 'Locuri' },
        ]);
        expect(attributionLines(withOverlayVisibility(overlays, 'kh9-1977', true), manifest, 'ro')).toEqual([
            'Sursa: USGS Corona',
            'Sursa: USGS EROS',
        ]);
    });

    it('badPath_noCategoriesMeansNoPlacesGroup', () => {
        const plain = testManifest((raw) => {
            delete raw['poiCategories'];
            delete raw['pois'];
        });

        expect(overlayGroups(plain, 'en')).toEqual([{ kind: 'raster', label: 'Historical layers' }]);
        expect(overlayItems(overlaysFromManifest(plain), plain, 'en').map((item) => item.id)).toEqual(['kh4-1966', 'kh9-1977', 'photos']);
    });

    it('badPath_aRasterOverlayWithoutItsLayerHasNoAttribution', () => {
        const stray = {
            ...overlays[0],
            id: 'gone',
            kind: 'raster' as const,
            label: { ro: 'x', en: 'x' },
            visible: true,
            opacity: 1,
            defaultVisible: true,
            defaultOpacity: 1,
        };

        expect(attributionLines([stray], manifest, 'ro')).toEqual([]);
    });
});

describe('<hcm-layer-panel>', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmLayerPanel();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_modalSheetHostsTheOverlayList', async () => {
        const element = await panel({ mode: 'side', locale: 'en' });

        const sheet = shadowQuery(element, 'hcm-sheet') as HTMLElement & {
            open: boolean;
            variant: string;
            label: string;
            closeLabel: string;
        };
        expect(sheet.open).toBe(true);
        expect(sheet.variant).toBe('side');
        expect(sheet.label).toBe('Layers');
        expect(sheet.closeLabel).toBe('Close');
        const list = shadowQuery(element, 'hcm-overlay-list') as HTMLElement & OverlayListProps;
        expect(list.items).toHaveLength(5);
        expect(list.groups.map((group) => group.label)).toEqual(['Historical layers', 'Places']);
        expect([list.toggleLabel, list.opacityLabel, list.valueText, list.changedText]).toEqual([
            'Show {name}',
            'Opacity: {name}',
            '{percent}%',
            '{name}: opacity {percent} %',
        ]);
        await expect.element(page.getByText('Source: USGS Corona')).toBeVisible();
    });

    it('happyPath_dockedPanelHasItsOwnHeadingAndClose', async () => {
        const element = await panel({ mode: 'docked' });
        const events = recordEvents(element, 'hcm-close');

        await expect.element(page.getByRole('heading', { name: 'Straturi' })).toBeVisible();
        await page.getByRole('button', { name: 'Închide' }).click();

        expect(events).toHaveLength(1);
    });

    it('badPath_dockedAndClosedRendersNothing', async () => {
        const element = await panel({ mode: 'docked', open: false });

        expect(element.shadowRoot?.querySelector('section')).toBeNull();
    });

    it('badPath_noHistoricalLayersSaysTheyAreComing', async () => {
        const manifest = testManifest((raw) => {
            raw['layers'] = [];
        });
        const element = await panel({ manifest, overlays: overlaysFromManifest(manifest), mode: 'docked' });

        expect(shadowText(element)).toContain('Straturile istorice vor apărea aici în curând.');
    });

    it('badPath_withoutAManifestTheFrameIsEmpty', async () => {
        const element = await panel({ manifest: null, overlays: [], mode: 'docked' });

        expect(element.shadowRoot?.querySelector('hcm-overlay-list')).toBeNull();
        expect(shadowText(element)).toContain('Straturi');
    });

    it('badPath_definingTwiceKeepsTheFirstRegistration', () => {
        defineHcmLayerPanel();

        expect(customElements.get(HCM_LAYER_PANEL_TAG)).toBe(HcmLayerPanel);
    });
});
