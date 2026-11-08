/**
 * Minimizing the extra-large Layers pane (the owner, 2026-11-08): the leading column shrinks to an 88 px rail, the map
 * takes the rest, the photo open beside it stays, and nothing reaches the store or the URL hash.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { defineViewerElements } from '../../src/viewer/define.js';
import { defineKitDoubles } from './doubles.js';
import { readyState } from './fake-store.js';
import { EXTRA_LARGE, mountViewer, part, type Mounted } from './viewer-harness.js';

function width(mounted: Mounted, selector: string): number {
    return part(mounted, selector).getBoundingClientRect().width;
}

beforeAll(() => {
    defineKitDoubles();
    defineViewerElements();
});

describe('<hcm-map-viewer>: the minimized Layers pane', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_minimizingGivesTheMapThePaneAndRestoringTakesItBack', async () => {
        const mounted = await mountViewer(readyState(), EXTRA_LARGE);
        mounted.store.openPhoto('mihai-voda-1978');
        await mounted.element.updateComplete;
        const map = width(mounted, '.map-pane');
        const calls = mounted.store.calls.length;

        await page.getByRole('button', { name: 'Închide' }).first().click();
        await expect.element(page.getByRole('button', { name: 'Straturi' })).toHaveAttribute('aria-expanded', 'false');

        expect(width(mounted, '.pane.leading')).toBe(88);
        expect(width(mounted, '.map-pane')).toBe(map + 272);
        expect(mounted.store.getState().sheet).toBe('photo');
        // No store action (the photo sheet's own thumbnail timing aside): the minimized pane is the panel's, not the hash's.
        expect(mounted.store.calls.slice(calls).filter((call) => call.method !== 'photoShown')).toEqual([]);

        await page.getByRole('button', { name: 'Straturi' }).click();
        await expect.element(page.getByRole('heading', { name: 'Straturi' })).toBeVisible();

        expect(width(mounted, '.pane.leading')).toBe(360);
        expect(width(mounted, '.map-pane')).toBe(map);
        expect(mounted.store.getState().sheet).toBe('photo');
    });
});
