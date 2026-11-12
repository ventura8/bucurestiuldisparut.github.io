import type { Page } from '@playwright/test';

import { E2E_CITY_ID } from '../../fixtures/world.js';
import { compareBar, expectMapCounts } from '../../support/compare.js';
import { expect, test } from '../../support/test.js';
import { t, viewer } from '../../support/viewer.js';

/**
 * The IIFE's extras on demand (behaviour V54, docs/ENGINE_API.md → *Extras on demand*, DECISIONS-for-review.md §159): a
 * page that loads `engine.iife.js` fetches no extra for its first paint; the first Compare adds swipe compare's
 * `extra-compare-<hash>.js` beside the engine as a script with its integrity, once, and compare works. An extra that does
 * not arrive closes compare with a message that says to try again, and the next Compare fetches it afresh.
 */

/** A page of its own beside the site, as a third party embeds the engine (the embed API's page, V21). */
const EXTRAS_PAGE = '/bucharest/extras-e2e.html';
const EXTRAS_HTML = `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="utf-8"><title>Extras e2e</title><link rel="icon" href="data:,">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js"></script>
<script src="engine/engine.iife.js"></script>
<style>html, body, #embed { margin: 0; width: 100%; height: 100%; }</style>
</head>
<body><div id="embed"></div></body>
</html>`;

const WIDE = { width: 1280, height: 800 };
const EXTRA_COMPARE = /\/engine\/extra-compare-[\w-]{8}\.js$/;

interface ExtrasWindow {
    HistoricCityMap: {
        mount(element: Element, config: unknown): Record<string, (...args: unknown[]) => unknown> & { ready: Promise<unknown> };
    };
    hcmE2eController?: Record<string, (...args: unknown[]) => unknown>;
}

/** Opens the page and mounts the viewer; returns every extra the page asked for, as it asks. */
async function openPage(page: Page): Promise<string[]> {
    const requested: string[] = [];
    page.on('request', (request) => {
        if (/\/extra-[\w-]+\.js$/.test(request.url())) {
            requested.push(new URL(request.url()).pathname);
        }
    });
    await page.setViewportSize(WIDE);
    await page.route(`**${EXTRAS_PAGE}`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: EXTRAS_HTML }));
    await page.goto(EXTRAS_PAGE);
    const ready = await page.evaluate(async () => {
        const scope = window as unknown as ExtrasWindow;
        const controller = scope.HistoricCityMap.mount(document.getElementById('embed') as Element, {
            cityId: 'bucharest',
            manifestUrl: './data/manifest.json',
        });
        scope.hcmE2eController = controller;
        return controller.ready;
    });
    expect(ready).toEqual({ ok: true, cityId: E2E_CITY_ID });
    await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toBeVisible();
    return requested;
}

async function openCompare(page: Page): Promise<void> {
    await page.evaluate(() => {
        (window as unknown as ExtrasWindow).hcmE2eController?.['openCompare']?.(null);
    });
}

test(
    'The IIFE fetches swipe compare only at the first Compare, once, as a script with its integrity',
    { tag: '@S-V54-HAPPY-EXTRAS-ON-DEMAND' },
    async ({ page }) => {
        const requested = await openPage(page);
        expect(requested).toEqual([]);
        await expect(page.locator('script[src*="extra-"]')).toHaveCount(0);

        await openCompare(page);

        await expect(compareBar(page, 'ro')).toBeVisible();
        await expectMapCounts(page, 2, 0);
        expect(requested).toHaveLength(1);
        expect(requested[0]).toMatch(EXTRA_COMPARE);
        const script = page.locator('head script[src*="extra-compare-"]');
        await expect(script).toHaveAttribute('integrity', /^sha384-[\w+/]{64}$/);
        await expect(script).toHaveAttribute('crossorigin', 'anonymous');

        await page.evaluate(() => {
            (window as unknown as ExtrasWindow).hcmE2eController?.['closeCompare']?.();
        });
        await expect(compareBar(page, 'ro')).toHaveCount(0);
        await openCompare(page);
        await expect(compareBar(page, 'ro')).toBeVisible();
        expect(requested).toHaveLength(1);
        await expect(page.locator('head script[src*="extra-compare-"]')).toHaveCount(1);
    },
);

test(
    'An extra that does not arrive closes compare with a message to try again, and the next Compare fetches it afresh',
    { tag: '@S-V54-BAD-EXTRAS-CHUNK-FAILS' },
    async ({ page, consoleErrors }) => {
        await page.route(EXTRA_COMPARE, (route) => route.abort('connectionrefused'));
        const requested = await openPage(page);

        await openCompare(page);

        const toast = page.getByRole('status').filter({ hasText: t('ro', 'error.extraLoad') });
        await expect(toast).toBeVisible();
        await expect(compareBar(page, 'ro')).toHaveCount(0);
        await expect(page.locator('head script[src*="extra-compare-"]')).toHaveCount(0);
        await expectMapCounts(page, 1, 0);
        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toBeVisible();
        expect(requested).toHaveLength(1);
        expect(consoleErrors.take()).toEqual([expect.stringContaining('ERR_CONNECTION_REFUSED')]);

        await page.unroute(EXTRA_COMPARE);
        await openCompare(page);

        await expect(compareBar(page, 'ro')).toBeVisible();
        await expectMapCounts(page, 2, 0);
        expect(requested).toHaveLength(2);
    },
);
