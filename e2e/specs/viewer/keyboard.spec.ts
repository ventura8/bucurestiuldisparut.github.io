import type { Page } from '@playwright/test';

import { focused, type FocusInfo } from '../../support/layout.js';
import { expect, test } from '../../support/test.js';
import { openViewer, t, viewer } from '../../support/viewer.js';

/**
 * Keyboard and screen reader (behaviour V14): the skip link leads to the timeline, the menu to the layers and the
 * photos, every stop shows a focus ring; the focused map opens the photo under its centre with Enter or Space. The
 * forced-colours and reduced-motion rows run in the a11y projects (e2e/a11y/).
 */

const LONE = 'strandul-opereta-1976';
const LONE_TITLE = 'Ștrandul Operetă';
const EMPTY_VIEW = '15/44.37000/25.97000';

async function expectFocus(page: Page, check: (info: FocusInfo) => boolean, what: string): Promise<FocusInfo> {
    await expect
        .poll(
            async () => {
                const info = await focused(page);
                return info !== null && check(info);
            },
            { message: `the focus is on ${what}` },
        )
        .toBe(true);
    const info = await focused(page);
    if (info === null) {
        throw new Error(`nothing has the focus instead of ${what}`);
    }
    expect(info.ringVisible, `${what} shows a focus ring`).toBe(true);
    return info;
}

/** Tabs (at most `limit` times) until `check` holds for the focused element. */
async function tabUntil(page: Page, check: (info: FocusInfo) => boolean, what: string, limit = 25): Promise<void> {
    for (let step = 0; step < limit; step += 1) {
        const info = await focused(page);
        if (info !== null && check(info)) {
            break;
        }
        await page.keyboard.press('Tab');
    }
    await expectFocus(page, check, what);
}

function isModal(page: Page): boolean {
    return (page.viewportSize()?.width ?? 0) < 840;
}

async function openFromMenu(page: Page, item: string): Promise<void> {
    await page.keyboard.press('Enter');
    await expectFocus(page, (info) => info.role === 'menuitem', 'the first menu item');
    for (let step = 0; step < 8; step += 1) {
        if ((await focused(page))?.name === item) {
            break;
        }
        await page.keyboard.press('ArrowDown');
    }
    await expectFocus(page, (info) => info.role === 'menuitem' && info.name === item, `the menu item ${item}`);
    await page.keyboard.press('Enter');
}

test('The skip link leads to the timeline, the menu to the layers and the photos', { tag: '@S-V14-HAPPY' }, async ({ page, lang }) => {
    await openViewer(page, { lang });
    const menu = t(lang, 'action.menu');

    await page.keyboard.press('Tab');
    await expectFocus(page, (info) => info.name === t(lang, 'viewer.skipToTimeline'), 'the skip link');
    await page.keyboard.press('Enter');
    await expectFocus(page, (info) => info.role === 'slider' && info.name === t(lang, 'timeline.label'), 'the timeline');

    await tabUntil(page, (info) => info.name === menu, 'the menu button');
    await openFromMenu(page, t(lang, 'layers.title'));
    await expect(page.getByRole('slider', { name: t(lang, 'layers.opacity', { name: t(lang, 'layers.photos') }) })).toBeVisible();
    if (isModal(page)) {
        await page.keyboard.press('Escape');
    }
    await expectFocus(page, (info) => info.name === menu, 'the menu button again');

    await openFromMenu(page, t(lang, 'photos.list'));
    await tabUntil(page, (info) => info.host === 'hcm-photo-list' && info.tag === 'button', 'a photo of the list');
    const photo = await focused(page);
    await page.keyboard.press('Enter');
    const title = (photo?.name ?? '').split(/\s{2,}|\n/)[0]?.trim() ?? '';
    await expect(page.getByRole('heading', { name: title }).first()).toBeVisible();
});

test('Enter or Space on the focused map opens the photo at its centre', { tag: '@S-V14-HAPPY-MAP-KEYBOARD' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: '18/44.429359/26.095447' });
    const canvas = viewer(page).locator('canvas.mapboxgl-canvas');

    await canvas.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: LONE_TITLE })).toBeVisible();
    await expect.poll(async () => (await page.evaluate(() => location.hash)).includes(`photo=${LONE}`)).toBe(true);

    await page
        .getByRole('button', { name: t(lang, 'action.close'), exact: true })
        .filter({ visible: true })
        .first()
        .click();
    await expect(page.getByRole('heading', { name: LONE_TITLE })).toHaveCount(0);
    await canvas.focus();
    await page.keyboard.press(' ');
    await expect(page.getByRole('heading', { name: LONE_TITLE })).toBeVisible();
});

test(
    'Enter on the focused map with nothing at its centre does nothing and keeps the focus',
    { tag: '@S-V14-BAD-NOTHING-UNDER-CENTRE' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: EMPTY_VIEW });
        const canvas = viewer(page).locator('canvas.mapboxgl-canvas');

        await canvas.focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press(' ');

        await expect(canvas).toBeFocused();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
        expect(await page.evaluate(() => location.hash)).not.toContain('photo=');
    },
);

test(
    'Shift+Tab right after a modal sheet takes the focus stays inside the sheet',
    { tag: '@S-V14-BAD-MODAL-TAB-WRAP' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: '18/44.429359/26.095447' });
        const canvas = viewer(page).locator('canvas.mapboxgl-canvas');
        await canvas.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('heading', { name: LONE_TITLE })).toBeVisible();
        // Below 840 px the photo opens in a modal sheet that focuses itself; wider, it is a docked pane beside the map.
        const sheet = viewer(page).locator('hcm-photo-sheet hcm-sheet[open]');

        await page.keyboard.press('Shift+Tab');
        if (isModal(page)) {
            await expect
                .poll(() => sheet.evaluate((element) => element.matches(':focus-within')), {
                    message: 'the focus stays in the modal sheet',
                })
                .toBe(true);
            await page.keyboard.press('Escape');
            await expect(page.getByRole('heading', { name: LONE_TITLE })).toHaveCount(0);
            await expect(canvas).toBeFocused();
        } else {
            await expect(sheet).toHaveCount(0);
            await expect(page.getByRole('heading', { name: LONE_TITLE })).toBeVisible();
        }
    },
);
