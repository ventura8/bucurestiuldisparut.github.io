/**
 * The viewer with the real ui-kit elements (no doubles in this file): the kit's documented properties and events
 * (docs/research/M1-interfaces.md §5.1) are what the viewer actually binds, end to end through a FakeStore.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineUiKit } from '../../src/components/define.js';
import { defineViewerElements } from '../../src/viewer/define.js';
import type { WindowClass } from '../../src/theme/tokens.js';
import type { HcmMapViewer } from '../../src/viewer/hcm-map-viewer.js';
import { deepFocus, ringContrast } from '../helpers.js';
import { FakeStore, idleState, readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';
import { fakeServices, setBox, COMPACT, LANDSCAPE_PHONE, MEDIUM, type Box } from './viewer-harness.js';

/**
 * What floating controls keep free at the foot of the map: Mapbox's collapsed attribution (24 px, 10 px from the edge)
 * plus M3's 8 px between touch targets.
 */
const MAPBOX_STRIP_PX = 10 + 24 + 8;
const TARGET_GAP_PX = 8;

async function viewer(store: FakeStore): Promise<HcmMapViewer> {
    const element = document.createElement('hcm-map-viewer');
    element.services = fakeServices();
    setBox(element, COMPACT);
    element.attach(store, null);
    document.body.append(element);
    await element.updateComplete;
    return element;
}

/** Resizes the viewer and waits until its store has the new window class. */
async function resize(element: HcmMapViewer, store: FakeStore, box: Box, windowClass: WindowClass): Promise<void> {
    setBox(element, box);
    await vi.waitFor(() => {
        expect(store.getState().windowClass).toBe(windowClass);
    });
    await element.updateComplete;
}

/** The element of `selector` in the viewer's shadow root, or of `inner` in that element's own shadow root. */
function partOf(element: HcmMapViewer, selector: string, inner?: string): Element {
    const host = element.shadowRoot?.querySelector(selector) ?? null;
    const target = inner === undefined ? host : (host?.shadowRoot?.querySelector(inner) ?? null);
    if (target === null) {
        throw new Error(`no ${selector} ${inner ?? ''}`);
    }
    return target;
}

function boxOf(element: HcmMapViewer, selector: string, inner?: string): DOMRect {
    return partOf(element, selector, inner).getBoundingClientRect();
}

describe('<hcm-map-viewer> with the real kit', () => {
    beforeAll(() => {
        defineUiKit();
        defineViewerElements();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theFabMenuOpensTheLayersSheetWithLiveSliders', async () => {
        const store = new FakeStore(readyState());
        await viewer(store);

        await page.getByRole('button', { name: 'Meniu' }).click();
        await page.getByRole('menuitem', { name: 'Straturi' }).click();
        await expect.element(page.getByRole('heading', { name: 'Straturi' })).toBeVisible();

        const slider = page.getByRole('slider', { name: 'Opacitate: Fotografii' });
        await expect.element(slider).toBeVisible();
        await userEvent.click(slider);
        await userEvent.keyboard('{ArrowLeft}');

        expect(store.callsOf('openSheet')).toEqual([['layers']]);
        expect(store.callsOf('setOverlayOpacity').at(-1)?.slice(0, 2)).toEqual(['photos', 0.99]);
    });

    it('happyPath_theConsentBannerAndTheToastAreTheKits', async () => {
        const store = new FakeStore(readyState());
        await viewer(store);

        await page.getByRole('button', { name: 'Accept' }).click();
        expect(store.callsOf('setConsent')).toEqual([['granted']]);

        store.showToast('share.copied');
        await expect.element(page.getByText('Linkul a fost copiat.')).toBeVisible();
    });

    it('badPath_theToastAndTheShortWindowMenuStayInsideTheViewer', async () => {
        // The e2e tour found the snackbar above the viewer's top edge and the menu of a landscape phone off screen.
        const store = new FakeStore({ ...readyState(), compactHeight: true });
        const element = await viewer(store);
        setBox(element, LANDSCAPE_PHONE);
        store.showToast('share.copied');
        await element.updateComplete;
        const frame = element.getBoundingClientRect();

        const toast = element.shadowRoot?.querySelector('hcm-snackbar')?.shadowRoot?.querySelector('.snackbar');
        expect(toast?.getBoundingClientRect().top).toBeGreaterThanOrEqual(frame.top);
        await page.getByRole('button', { name: 'Meniu' }).click();
        const items = [...(element.shadowRoot?.querySelector('hcm-fab-menu')?.shadowRoot?.querySelectorAll('[role="menuitem"]') ?? [])];
        expect(items.length).toBeGreaterThan(4);
        for (const item of items) {
            expect(item.getBoundingClientRect().top).toBeGreaterThanOrEqual(frame.top);
        }
    });

    it('badPath_whileLoadingAVisibleIndicatorTurns', async () => {
        // UX review: the skeleton's linear progress bar had no width of its own and collapsed to nothing.
        await viewer(new FakeStore(idleState()));

        const indicator = page.getByRole('progressbar', { name: 'Se încarcă harta…' });
        await expect.element(indicator).toBeVisible();
        const box = indicator.element().getBoundingClientRect();
        expect(box.width).toBeGreaterThan(24);
        expect(box.height).toBeGreaterThan(24);
    });

    it('badPath_withoutWebGlTheLastPhotoScrollsClearOfTheMenuButton', async () => {
        const element = await viewer(new FakeStore(readyState(undefined, { webgl: false })));
        setBox(element, { width: 360, height: 400 });
        await element.updateComplete;
        const rows = (): HTMLElement[] => [
            ...(element.shadowRoot?.querySelector('hcm-photo-list')?.shadowRoot?.querySelectorAll('button') ?? []),
        ];
        await expect.poll(() => rows().length).toBeGreaterThan(0);
        const status = element.shadowRoot?.querySelector('.status');
        expect(status?.scrollHeight).toBeGreaterThan(status?.clientHeight ?? 0);

        status?.scrollTo({ top: status.scrollHeight });

        const fab = element.shadowRoot?.querySelector('hcm-fab-menu')?.shadowRoot?.querySelector('.fab');
        expect(rows().at(-1)?.getBoundingClientRect().bottom).toBeLessThanOrEqual(fab?.getBoundingClientRect().top ?? 0);
    });

    it('badPath_theShortWindowMenuOpensWithoutMovingItsButton', async () => {
        // UX review: the two-column menu of a landscape phone pushed the FAB from the leading edge to the middle.
        const store = new FakeStore({ ...readyState(), compactHeight: true });
        const element = await viewer(store);
        setBox(element, LANDSCAPE_PHONE);
        await element.updateComplete;
        const fab = element.shadowRoot?.querySelector('hcm-fab-menu')?.shadowRoot?.querySelector('.fab');
        const closed = fab?.getBoundingClientRect().left;

        await page.getByRole('button', { name: 'Meniu' }).click();

        await expect.element(page.getByRole('menu', { name: 'Meniu' })).toBeVisible();
        expect(fab?.getBoundingClientRect().left).toBe(closed);
    });
});

describe("<hcm-map-viewer> floating controls with the real kit (the user's report of 2026-10-12)", () => {
    beforeAll(async () => {
        defineUiKit();
        defineViewerElements();
        // Hit tests need the whole viewer inside the test frame's viewport.
        await page.viewport(1280, 900);
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('badPath_onAPhoneTheChipTheFabAndTheTimelineKeepApartAndClearOfMapbox', async () => {
        // The tour: on phones the menu button sat on the timeline's top edge (0 px) and the timeline 2 px from Mapbox's
        // collapsed attribution.
        const element = await viewer(new FakeStore(readyState(undefined, { year: 1977 })));
        const frame = element.getBoundingClientRect();
        const timeline = boxOf(element, 'hcm-timeline');
        const fab = boxOf(element, 'hcm-fab-menu', '.fab');
        const chip = boxOf(element, '.dock.chip hcm-button');

        expect(timeline.height).toBe(84);
        expect(frame.bottom - timeline.bottom).toBeGreaterThanOrEqual(MAPBOX_STRIP_PX);
        expect(timeline.top - fab.bottom).toBeGreaterThanOrEqual(TARGET_GAP_PX);
        expect(fab.top - chip.bottom).toBeGreaterThanOrEqual(TARGET_GAP_PX);
    });

    it('badPath_onTheSmallestPhoneTheOpenMenuStaysOnScreen', async () => {
        // The tour at 320 × 568: with the FAB 8 px above a 100 px timeline the open menu's first item left the screen.
        const element = await viewer(new FakeStore(readyState()));
        setBox(element, { width: 320, height: 568 });
        await element.updateComplete;

        await page.getByRole('button', { name: 'Meniu' }).click();
        await expect.element(page.getByRole('menu', { name: 'Meniu' })).toBeVisible();

        const frame = element.getBoundingClientRect();
        const items = [...(element.shadowRoot?.querySelector('hcm-fab-menu')?.shadowRoot?.querySelectorAll('[role="menuitem"]') ?? [])];
        expect(items).toHaveLength(6);
        for (const item of items) {
            expect(item.getBoundingClientRect().top).toBeGreaterThanOrEqual(frame.top);
        }
    });

    it('badPath_withoutATimelineTheFabStillClearsMapbox', async () => {
        // The tour: Bucharest today (no layers) had the menu button 2 px from the collapsed attribution.
        const manifest = testManifest((raw) => {
            raw['layers'] = [];
        });
        const element = await viewer(new FakeStore(readyState(manifest)));

        expect(element.getBoundingClientRect().bottom - boxOf(element, 'hcm-fab-menu', '.fab').bottom).toBeGreaterThanOrEqual(
            MAPBOX_STRIP_PX,
        );
    });

    it('badPath_onATabletTheChipClearsTheTimelineAndTheOpenMenuLetsTapsReachIt', async () => {
        // The tour at 768 px: the chip touched the timeline, and the open menu took the taps on the timeline beside the FAB.
        const store = new FakeStore(readyState(undefined, { year: 1977 }));
        const element = await viewer(store);
        await resize(element, store, MEDIUM, 'medium');
        const timeline = boxOf(element, 'hcm-timeline');
        const chip = boxOf(element, '.dock.chip hcm-button');
        const fab = boxOf(element, 'hcm-fab-menu', '.fab');
        expect(element.getBoundingClientRect().bottom - timeline.bottom).toBeGreaterThanOrEqual(MAPBOX_STRIP_PX);
        expect(timeline.top - chip.bottom).toBeGreaterThanOrEqual(TARGET_GAP_PX);
        expect(fab.left - timeline.right).toBeGreaterThanOrEqual(TARGET_GAP_PX);

        await page.getByRole('button', { name: 'Meniu' }).click();
        await expect.element(page.getByRole('menu', { name: 'Meniu' })).toBeVisible();

        const menu = boxOf(element, 'hcm-fab-menu');
        const x = timeline.right - 4;
        const y = fab.top + fab.height / 2;
        expect(menu.left).toBeLessThan(x);
        expect(element.shadowRoot?.elementFromPoint(x, y)?.localName).toBe('hcm-timeline');
        // The visual audit at 768 px: the last item, wider than the FAB, lay over the timeline's thumb; it ends above it.
        const items = [...(partOf(element, 'hcm-fab-menu').shadowRoot?.querySelectorAll('[role="menuitem"]') ?? [])];
        const lowest = Math.max(...items.map((item) => item.getBoundingClientRect().bottom));
        expect(items.length).toBeGreaterThan(0);
        expect(timeline.top - lowest).toBeGreaterThanOrEqual(TARGET_GAP_PX);
    });

    it('badPath_onAShortPhoneTheToastEndsBeforeTheVerticalTimelineAndLetsTapsThrough', async () => {
        // The tour on a phone held sideways: the toasts' dock lay over the vertical timeline's thumb.
        const store = new FakeStore({ ...readyState(), compactHeight: true, consent: 'granted' });
        const element = await viewer(store);
        setBox(element, LANDSCAPE_PHONE);
        store.showToast('share.copied');
        await element.updateComplete;

        const dock = boxOf(element, '.dock.toast');
        const toast = boxOf(element, 'hcm-snackbar', '.snackbar');
        const timeline = boxOf(element, 'hcm-timeline');
        expect(timeline.left - dock.right).toBeGreaterThanOrEqual(TARGET_GAP_PX);
        expect(toast.left - dock.left).toBeGreaterThan(4);
        expect(element.shadowRoot?.elementFromPoint(dock.left + 2, toast.top + toast.height / 2)?.closest('.dock')).toBeNull();
    });
});

describe('<hcm-map-viewer> focus rings with the real kit', () => {
    beforeAll(() => {
        defineUiKit();
        defineViewerElements();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('badPath_retryOnTheErrorCardShowsARingThatStandsOut', async () => {
        // The tour measured Retry's secondary ring at 2.38:1 against the error container (3:1 needed).
        const element = await viewer(
            new FakeStore({ ...idleState(), status: 'error', error: { code: 'error.manifest.network', retryable: true } }),
        );

        await userEvent.tab();

        const focused = deepFocus();
        const button = (focused?.getRootNode() as ShadowRoot | undefined)?.host;
        expect([button?.localName, button?.textContent.trim()]).toEqual(['hcm-button', 'Reîncearcă']);
        const card = partOf(element, 'hcm-error-card', '.card');
        expect(ringContrast(focused, getComputedStyle(card).backgroundColor)).toBeGreaterThanOrEqual(3);
    });

    it.each(['light', 'dark'] as const)('badPath_mapboxsWhiteAttributionGetsADarkRingIn_%s', async (theme) => {
        // The tour, dark theme: the secondary ring of the collapsed attribution's toggle measured 1.71:1 on its white.
        const element = await viewer(new FakeStore(readyState(undefined, { theme })));
        const attribution = document.createElement('div');
        attribution.className = 'mapboxgl-ctrl mapboxgl-ctrl-attrib mapboxgl-compact';
        const toggle = document.createElement('button');
        toggle.className = 'mapboxgl-ctrl-attrib-button';
        toggle.setAttribute('aria-label', 'Arată sau ascunde sursele hărții');
        attribution.append(toggle);
        element.mapContainer?.append(attribution);

        await userEvent.tab();
        toggle.focus();

        expect(toggle.matches(':focus-visible')).toBe(true);
        expect(ringContrast(toggle, '#ffffff')).toBeGreaterThanOrEqual(3);
    });

    it('badPath_theMapsAndTheFullAttributionsRingsAreDrawnInsideMapboxsBox', async () => {
        // The tour's ring check: Mapbox's box hides its overflow, so the canvas's outer ring was cut away whole, and the
        // links of the full attribution in its corner lost the ring's lower edge.
        const element = await viewer(new FakeStore(readyState()));
        const canvas = document.createElement('canvas');
        canvas.className = 'mapboxgl-canvas';
        canvas.tabIndex = 0;
        const attribution = document.createElement('div');
        attribution.className = 'mapboxgl-ctrl mapboxgl-ctrl-attrib';
        const link = document.createElement('a');
        link.href = '#credits';
        link.textContent = '© OpenStreetMap';
        attribution.append(link);
        element.mapContainer?.append(canvas, attribution);
        const grow = (target: Element): number => {
            const style = getComputedStyle(target);
            return Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth);
        };

        await userEvent.tab();
        canvas.focus();
        expect(canvas.matches(':focus-visible')).toBe(true);
        expect(grow(canvas)).toBeLessThanOrEqual(0);
        link.focus();
        expect(link.matches(':focus-visible')).toBe(true);
        const bottom = attribution.getBoundingClientRect().bottom - Number.parseFloat(getComputedStyle(attribution).paddingBottom);
        expect(Number.parseFloat(getComputedStyle(attribution).paddingBottom)).toBeGreaterThanOrEqual(grow(link));
        expect(link.getBoundingClientRect().bottom).toBeLessThanOrEqual(bottom + 1);
    });
});
