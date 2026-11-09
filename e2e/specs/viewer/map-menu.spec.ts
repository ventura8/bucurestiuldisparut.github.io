import type { Locale } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { siteManifestData } from '../../fixtures/manifest.js';
import { expect, test } from '../../support/test.js';
import { openViewer, t, viewer } from '../../support/viewer.js';

/**
 * The map's menu (behaviour V62; the owner on 2026-11-09): a right click, a long press on a touch screen or the ContextMenu
 * key opens a menu at that point of the map with "Open in Google Street View" (a plain link to Google Maps' panorama of the
 * place, in a new tab) and "Copy coordinates"; a right-drag rotates the map and opens nothing; Esc closes it; near an edge
 * it stays inside the map. A photo's sheet links to Street View at the photo's place, looking along its bearing.
 */

const CENTRE = { lat: 44.42704, lng: 26.0853 };
const HASH = `16/${String(CENTRE.lat)}/${String(CENTRE.lng)}`;

function map(page: Page): Locator {
    return viewer(page).locator('.map');
}

function menu(page: Page, lang: Locale): Locator {
    return page.getByRole('menu', { name: t(lang, 'mapMenu.label') });
}

async function mapBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await map(page).boundingBox();
    expect(box, 'the map is on screen').not.toBeNull();
    return box ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** The viewpoint a Street View link names, as numbers. */
function viewpointOf(href: string | null): { lat: number; lng: number } {
    const [lat = 'NaN', lng = 'NaN'] = new URL(href ?? 'https://x/').searchParams.get('viewpoint')?.split(',') ?? [];
    return { lat: Number(lat), lng: Number(lng) };
}

test(
    'A right click opens the menu at the place, whose Street View link names it',
    { tag: '@S-V62-HAPPY-RIGHT-CLICK' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: HASH });
        const box = await mapBox(page);

        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });

        const link = menu(page, lang).getByRole('menuitem', { name: t(lang, 'mapMenu.streetView') });
        await expect(link).toBeFocused();
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        const place = viewpointOf(await link.getAttribute('href'));
        expect(place.lat).toBeCloseTo(CENTRE.lat, 3);
        expect(place.lng).toBeCloseTo(CENTRE.lng, 3);
        await expect(menu(page, lang).getByRole('menuitem', { name: t(lang, 'mapMenu.copy') })).toBeVisible();
    },
);

test('A long press on a touch screen opens the menu', { tag: '@S-V62-HAPPY-LONG-PRESS' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: HASH });
    const box = await mapBox(page);
    const at = { clientX: box.x + 60, clientY: box.y + 80 };

    await map(page).dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true, ...at });

    await expect(menu(page, lang)).toBeVisible();
    await map(page).dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7, isPrimary: true, ...at });
    await expect(menu(page, lang)).toBeVisible();
});

test(
    "A photo's sheet links to Street View at its place, looking along its bearing",
    { tag: '@S-V62-HAPPY-PHOTO' },
    async ({ page, lang }) => {
        const photos = siteManifestData()['photos'] as { id: string; bearing?: number; location: { lat: number; lng: number } }[];
        const photo = photos.find((candidate) => candidate.bearing !== undefined);
        expect(photo, 'the fixture has a photo with a bearing').toBeDefined();
        await openViewer(page, { lang, hash: `18/${String(photo?.location.lat)}/${String(photo?.location.lng)}&photo=${photo?.id ?? ''}` });

        const link = page.getByRole('link', { name: t(lang, 'mapMenu.streetView') });

        await expect(link).toHaveAttribute('href', new RegExp(`&heading=${String(Math.round(photo?.bearing ?? 0) % 360)}$`));
        expect(viewpointOf(await link.getAttribute('href')).lat).toBeCloseTo(photo?.location.lat ?? 0, 5);
    },
);

test('A right-drag rotates the map and opens no menu', { tag: '@S-V62-BAD-DRAG' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: HASH });
    const box = await mapBox(page);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up({ button: 'right' });

    await expect(menu(page, lang)).toHaveCount(0);
});

test('Esc closes the menu; near the edge it stays inside the map', { tag: '@S-V62-BAD-ESC-EDGE' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: HASH });
    const box = await mapBox(page);

    await page.mouse.click(box.x + box.width - 4, box.y + box.height / 3, { button: 'right' });
    const opened = await menu(page, lang).boundingBox();
    expect(opened, 'the menu is open').not.toBeNull();
    expect((opened?.x ?? 0) + (opened?.width ?? 0)).toBeLessThanOrEqual(box.x + box.width);
    expect((opened?.y ?? 0) + (opened?.height ?? 0)).toBeLessThanOrEqual(box.y + box.height);
    await page.keyboard.press('Escape');

    await expect(menu(page, lang)).toHaveCount(0);
});
