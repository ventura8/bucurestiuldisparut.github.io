import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { deepActiveElement } from '../../src/components/focus.js';
import { defineViewerElements } from '../../src/viewer/define.js';
import { defineKitDoubles, fireKitEvent, shadowQuery, shadowQueryAll, shadowText } from './doubles.js';
import { readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';
import {
    COMPACT,
    EXPANDED,
    EXTRA_LARGE,
    LANDSCAPE_PHONE,
    MEDIUM,
    mountViewer,
    part,
    publicEvents,
    type Mounted,
} from './viewer-harness.js';

type Sheet = HTMLElement & { readonly mode: string; readonly open: boolean };

function chooseFromMenu(mounted: Mounted, value: string): void {
    fireKitEvent(part(mounted, 'hcm-fab-menu'), 'hcm-select', { value });
}

/** The kit list inside the layers panel (where its events start). */
function overlayList(mounted: Mounted): HTMLElement {
    return shadowQuery(part(mounted, 'hcm-layer-panel'), 'hcm-overlay-list');
}

beforeAll(() => {
    defineKitDoubles();
    defineViewerElements();
});

describe('<hcm-map-viewer>: layout per window class', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_compactUsesModalBottomSheetsAndMakesTheMapInert', async () => {
        const mounted = await mountViewer(readyState(), COMPACT);
        chooseFromMenu(mounted, 'layers');
        await mounted.element.updateComplete;

        const panel = part(mounted, 'hcm-layer-panel') as Sheet;
        expect([panel.mode, panel.open]).toEqual(['bottom', true]);
        expect(part(mounted, '.frame').hasAttribute('inert')).toBe(true);
        expect(part(mounted, '.frame').dataset['panes']).toBe('none');
    });

    it('happyPath_mediumUsesModalSideSheets', async () => {
        const mounted = await mountViewer(readyState(), MEDIUM);
        mounted.store.openPhoto('mihai-voda-1978');
        await mounted.element.updateComplete;

        const sheet = part(mounted, 'hcm-photo-sheet') as Sheet;
        expect([sheet.mode, sheet.open]).toEqual(['side', true]);
    });

    it('happyPath_expandedDocksTheDetailsNextToTheLiveMap', async () => {
        const mounted = await mountViewer(readyState(), EXPANDED);
        mounted.store.openPhoto('mihai-voda-1978');
        await mounted.element.updateComplete;

        const docked = part(mounted, '.pane.trailing hcm-photo-sheet') as Sheet;
        expect([docked.mode, docked.open]).toEqual(['docked', true]);
        expect(part(mounted, '.frame').dataset['panes']).toBe('trailing');
        expect(part(mounted, '.frame').hasAttribute('inert')).toBe(false);

        chooseFromMenu(mounted, 'layers');
        await mounted.element.updateComplete;
        expect((part(mounted, '.pane.trailing hcm-layer-panel') as Sheet).mode).toBe('docked');
    });

    it('happyPath_extraLargeKeepsTheLayersPanelDocked', async () => {
        const mounted = await mountViewer(readyState(), EXTRA_LARGE);

        const leading = part(mounted, '.pane.leading hcm-layer-panel') as Sheet & { closable: boolean };
        expect([leading.mode, leading.closable]).toEqual(['docked', false]);
        expect(part(mounted, '.frame').dataset['panes']).toBe('leading');
        const items = (part(mounted, 'hcm-fab-menu') as HTMLElement & { items: readonly { value: string }[] }).items;
        expect(items.map((item) => item.value)).not.toContain('layers');

        mounted.store.openPoi('casa-uranus');
        await mounted.element.updateComplete;
        expect(part(mounted, '.frame').dataset['panes']).toBe('both');
        mounted.store.openSheet('layers');
        await mounted.element.updateComplete;
        expect(part(mounted, '.frame').dataset['panes']).toBe('leading');
    });

    it('badPath_landscapePhonesGetAVerticalTimelineAndSideSheets', async () => {
        const mounted = await mountViewer(readyState(), LANDSCAPE_PHONE);

        expect(mounted.store.getState().compactHeight).toBe(true);
        expect(part(mounted, '.frame').hasAttribute('data-compact-height')).toBe(true);
        await expect.element(page.getByRole('slider')).toHaveAttribute('aria-orientation', 'vertical');
        chooseFromMenu(mounted, 'about');
        await mounted.element.updateComplete;
        expect(part(mounted, 'hcm-about-dialog').hasAttribute('fullscreen')).toBe(true);
    });

    it('badPath_aCityWithoutHistoricalLayersHasNoTimeline', async () => {
        const manifest = testManifest((raw) => {
            raw['layers'] = [];
        });
        const mounted = await mountViewer(readyState(manifest), COMPACT);

        expect(mounted.element.shadowRoot?.querySelector('hcm-timeline')).toBeNull();
        expect(mounted.element.shadowRoot?.querySelector('.skip')).toBeNull();
        expect(part(mounted, '.frame').hasAttribute('data-timeline')).toBe(false);
    });
});

describe('<hcm-map-viewer>: overlays and timeline', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aSliderFadesLiveAndAnnouncesOnceOnRelease', async () => {
        const mounted = await mountViewer(readyState(), COMPACT);
        const events = publicEvents(mounted.element);
        const leaked: Event[] = [];
        document.addEventListener('hcm-overlay-opacity', (event) => leaked.push(event));
        chooseFromMenu(mounted, 'layers');
        await mounted.element.updateComplete;

        fireKitEvent(overlayList(mounted), 'hcm-overlay-opacity', { id: 'kh4-1966', opacity: 0.5, final: false });
        fireKitEvent(overlayList(mounted), 'hcm-overlay-opacity', { id: 'kh4-1966', opacity: 0.3, final: false });
        expect(events).toEqual([]);
        fireKitEvent(overlayList(mounted), 'hcm-overlay-opacity', { id: 'kh4-1966', opacity: 0.3, final: true });

        expect(mounted.store.callsOf('setOverlayOpacity')).toEqual([
            ['kh4-1966', 0.5, false],
            ['kh4-1966', 0.3, false],
            ['kh4-1966', 0.3, true],
        ]);
        expect(events).toEqual([
            { type: 'hcm-overlay-change', detail: { overlayId: 'kh4-1966', kind: 'raster', visible: true, opacity: 0.3 } },
            { type: 'hcm-layer-change', detail: { layerId: 'kh4-1966', visible: true, opacity: 0.3, year: 1966 } },
        ]);
        expect(leaked).toEqual([]);
    });

    it('happyPath_aSwitchShowsOrHidesAnOverlay', async () => {
        const mounted = await mountViewer(readyState(), EXTRA_LARGE);
        const events = publicEvents(mounted.element);

        fireKitEvent(overlayList(mounted), 'hcm-overlay-visibility', { id: 'cladiri', visible: false });

        expect(mounted.store.callsOf('toggleOverlay')).toEqual([['cladiri', false]]);
        expect(events).toEqual([{ type: 'hcm-overlay-change', detail: { overlayId: 'cladiri', kind: 'poi', visible: false, opacity: 1 } }]);
    });

    it('badPath_aSliderReleaseWithoutAChangeAnnouncesNothing', async () => {
        const mounted = await mountViewer(readyState(), EXTRA_LARGE);
        const events = publicEvents(mounted.element);

        fireKitEvent(overlayList(mounted), 'hcm-overlay-opacity', { id: 'photos', opacity: 1, final: true });

        expect(mounted.store.callsOf('setOverlayOpacity')).toEqual([['photos', 1, true]]);
        expect(events).toEqual([]);
    });

    it('happyPath_theTimelineAndThePhotosNearTheYear', async () => {
        const mounted = await mountViewer(readyState(), COMPACT);
        const slider = shadowQuery(part(mounted, 'hcm-timeline'), '[role="slider"]');

        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, composed: true }));
        await mounted.element.updateComplete;
        expect(mounted.store.callsOf('setYear')).toEqual([[1977]]);

        await page.getByRole('button', { name: 'Fotografii din jurul anului 1977' }).click();
        await mounted.element.updateComplete;
        expect(mounted.store.getState().sheet).toBe('photos');
        const photosSheet = part(mounted, '.photos-sheet hcm-sheet') as HTMLElement & { label: string };
        expect(photosSheet.label).toBe('Fotografii din jurul anului 1977');
    });

    it('badPath_noPhotosNearTheYearNoChip', async () => {
        const mounted = await mountViewer(readyState(testManifest(), { year: 1900 }), COMPACT);

        expect(mounted.element.shadowRoot?.querySelector('.dock.chip')).toBeNull();
        expect(shadowText(mounted.element)).toContain('Fotografii din jurul anului 1900');
    });

    it('happyPath_theSkipLinkFocusesTheTimeline', async () => {
        const mounted = await mountViewer(readyState(), COMPACT);

        part(mounted, '.skip').click();

        expect(deepActiveElement()?.getAttribute('role')).toBe('slider');
    });
});

describe('<hcm-map-viewer>: details, lightbox and menu', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aPhotoOpensThenTheLightboxAndFocusComesBack', async () => {
        const mounted = await mountViewer(readyState(), EXPANDED);
        const events = publicEvents(mounted.element);
        mounted.store.openPhoto('uranus-1984');
        await mounted.element.updateComplete;
        expect(events).toEqual([{ type: 'hcm-photo-open', detail: { photoId: 'uranus-1984' } }]);

        await page.getByRole('button', { name: 'Deschide fotografia mărită' }).click();
        await mounted.element.updateComplete;
        expect((part(mounted, 'hcm-lightbox') as HTMLElement & { open: boolean }).open).toBe(true);
        expect(part(mounted, '.frame').hasAttribute('inert')).toBe(true);

        const dialog = shadowQuery(part(mounted, 'hcm-lightbox'), '[role="dialog"]');
        dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }));
        await mounted.element.updateComplete;
        expect(mounted.store.getState()).toMatchObject({ selectedPhotoId: 'fara-an', lightbox: true });

        dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
        await mounted.element.updateComplete;
        await vi.waitFor(() => {
            expect(deepActiveElement()?.getAttribute('aria-label')).toBe('Deschide fotografia mărită');
        });
    });

    it('happyPath_closingASheetClosesItsSelection', async () => {
        const mounted = await mountViewer(readyState(), EXPANDED);
        mounted.store.openPhoto('uranus-1984');
        await mounted.element.updateComplete;
        await page.getByRole('button', { name: 'Închide' }).click();
        mounted.store.openPoi('casa-uranus');
        await mounted.element.updateComplete;
        await page.getByRole('button', { name: 'Închide' }).click();
        mounted.store.openSheet('photos');
        await mounted.element.updateComplete;
        await page.getByRole('button', { name: 'Închide' }).click();

        expect(mounted.store.calls.filter((call) => call.args[0] === null || call.args[0] === 'none').map((call) => call.method)).toEqual([
            'openPhoto',
            'openPoi',
            'openSheet',
        ]);
    });

    it('happyPath_aPoiOpensInTheSameSheetAndItsPhotosOpenToo', async () => {
        const mounted = await mountViewer(readyState(), COMPACT);
        const events = publicEvents(mounted.element);
        mounted.store.openPoi('casa-uranus');
        await mounted.element.updateComplete;

        const sheet = part(mounted, 'hcm-photo-sheet') as HTMLElement & { poi: { id: string } | null; mode: string };
        expect(sheet.poi?.id).toBe('casa-uranus');
        fireKitEvent(shadowQuery(sheet, 'hcm-poi-detail'), 'hcm-photo-select', { photoId: 'mihai-voda-1978' });

        expect(events.map((event) => event.type)).toEqual(['hcm-poi-open', 'hcm-photo-open']);
        expect(mounted.store.getState().sheet).toBe('photo');
    });

    it('badPath_anUnknownPoiOrAManifestWithoutPoisShowsNoDetails', async () => {
        const manifest = testManifest((raw) => {
            delete raw['pois'];
            delete raw['poiCategories'];
        });
        const mounted = await mountViewer(readyState(manifest, { sheet: 'poi', selectedPoiId: 'casa-uranus' }), COMPACT);

        expect((part(mounted, 'hcm-photo-sheet') as HTMLElement & { poi: unknown }).poi).toBeNull();
    });

    it('happyPath_menuShareLocateLanguageAndAbout', async () => {
        const mounted = await mountViewer(readyState(), COMPACT);

        chooseFromMenu(mounted, 'share');
        await vi.waitFor(() => {
            expect(mounted.store.getState().toast).toEqual({ key: 'share.copied' });
        });
        expect(mounted.store.callsOf('logShare')).toHaveLength(1);
        chooseFromMenu(mounted, 'locate');
        await vi.waitFor(() => {
            expect(mounted.store.callsOf('flyTo')).toHaveLength(1);
        });
        chooseFromMenu(mounted, 'photos');
        expect(mounted.store.getState().sheet).toBe('photos');
        chooseFromMenu(mounted, 'about');
        await mounted.element.updateComplete;
        await expect.element(page.getByRole('dialog', { name: 'Despre' })).toBeVisible();
        chooseFromMenu(mounted, 'language');

        expect(mounted.store.getState().locale).toBe('en');
        expect(mounted.element.getAttribute('lang')).toBe('en');
    });

    it('badPath_anUnknownMenuValueDoesNothing', async () => {
        const mounted = await mountViewer(readyState(), COMPACT);
        const before = mounted.store.calls.length;

        chooseFromMenu(mounted, 'compare');

        expect(mounted.store.calls).toHaveLength(before);
    });

    it('happyPath_aboutChangesPreferencesAndWithdrawsConsent', async () => {
        const mounted = await mountViewer(readyState(testManifest(), { consent: 'granted', sheet: 'about' }), MEDIUM);
        const about = part(mounted, 'hcm-about-dialog');

        await page.getByRole('radio', { name: 'Întunecată' }).click();
        await page.getByRole('radio', { name: 'English' }).click();
        fireKitEvent(about, 'hcm-consent', { decision: 'denied' });
        fireKitEvent(shadowQuery(about, 'hcm-dialog'), 'hcm-close', { returnValue: '' });

        expect(mounted.store.callsOf('setTheme')).toEqual([['dark']]);
        expect(mounted.store.callsOf('setLocale')).toEqual([['en']]);
        expect(mounted.store.callsOf('setConsent')).toEqual([['denied']]);
        expect(mounted.store.callsOf('openSheet')).toEqual([['none']]);
        expect(shadowQueryAll(mounted.element, 'hcm-about-dialog')).toHaveLength(1);
    });
});
