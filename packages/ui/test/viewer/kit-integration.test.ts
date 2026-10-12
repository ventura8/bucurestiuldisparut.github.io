/**
 * The viewer with the real ui-kit elements (no doubles in this file): the kit's documented properties and events
 * (docs/research/M1-interfaces.md §5.1) are what the viewer actually binds, end to end through a FakeStore.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineUiKit } from '../../src/components/define.js';
import { defineViewerElements } from '../../src/viewer/define.js';
import type { HcmMapViewer } from '../../src/viewer/hcm-map-viewer.js';
import { FakeStore, readyState } from './fake-store.js';
import { fakeServices, setBox, COMPACT } from './viewer-harness.js';

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
});
