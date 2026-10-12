/**
 * The viewer with the real ui-kit elements (no doubles in this file): the kit's documented properties and events
 * (docs/research/M1-interfaces.md §5.1) are what the viewer actually binds, end to end through a FakeStore.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineUiKit } from '../../src/components/define.js';
import { defineViewerElements } from '../../src/viewer/define.js';
import type { HcmMapViewer } from '../../src/viewer/hcm-map-viewer.js';
import { FakeStore, idleState, readyState } from './fake-store.js';
import { fakeServices, setBox, COMPACT, LANDSCAPE_PHONE } from './viewer-harness.js';

async function viewer(store: FakeStore): Promise<HcmMapViewer> {
    const element = document.createElement('hcm-map-viewer');
    element.services = fakeServices();
    setBox(element, COMPACT);
    element.attach(store, null);
    document.body.append(element);
    await element.updateComplete;
    return element;
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
