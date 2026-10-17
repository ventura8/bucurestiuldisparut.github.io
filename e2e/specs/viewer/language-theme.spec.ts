import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { i18nLeaks, pageTexts } from '../../support/i18n.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import {
    BUCHAREST_MANIFEST,
    chooseMenuItem,
    closeModalSheet,
    menuButton,
    openViewer,
    t,
    viewer,
    waitForEngineEvent,
} from '../../support/viewer.js';

/**
 * Language (behaviour V11) and theme (V12): Romanian unless the URL, the visitor's stored choice or the embed asks for
 * English, `<html lang>` following it; the city's colour theme for light, dark and high contrast, the visitor's choice
 * kept across reloads; an invalid theme leaves the engine's own palette; blocked fonts leave every control named.
 */

const TOKENS = (siteManifestData()['city'] as { theme: { tokens: Record<string, Record<string, string>> } }).theme.tokens;
const PRIMARY = '--md-sys-color-primary';
const LONE = 'strandul-opereta-1976';
const LONE_TITLE_RO = 'Ștrandul Operetă';

/** The colour token the viewer's host resolves now (the theme is adopted on `<hcm-map-viewer>`). */
async function hostToken(page: Page, name: string): Promise<string> {
    return viewer(page).evaluate((host, token) => getComputedStyle(host).getPropertyValue(token).trim().toLowerCase(), name);
}

test('Romanian by default; English chosen in the menu persists after a reload', { tag: '@S-V11-HAPPY' }, async ({ page }) => {
    await openViewer(page, { hash: `17/44.42955/26.09560&photo=${LONE}` });
    await expect(page.locator('html')).toHaveAttribute('lang', 'ro');
    await expect(viewer(page).locator('hcm-photo-sheet .supporting')).toHaveText(t('ro', 'photo.year', { year: '1976' }));

    await closeModalSheet(page);
    await chooseMenuItem(page, 'ro', t('ro', 'language.en'));
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(menuButton(page, 'en')).toBeVisible();

    // A fresh load (another document first: the same path with another hash would only change the hash).
    await page.goto('about:blank');
    await page.goto(sitePath('bucharest', { hash: `17/44.42955/26.09560&photo=${LONE}` }));
    await waitForEngineEvent(page, 'hcm-ready');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(viewer(page).locator('hcm-photo-sheet .supporting')).toHaveText(t('en', 'photo.year', { year: '1976' }));
    await expect(page.getByRole('slider', { name: t('en', 'timeline.label'), exact: true })).toBeVisible();
});

test('An unsupported language in the URL falls back to Romanian', { tag: '@S-V11-BAD-UNSUPPORTED-LANG' }, async ({ page }) => {
    await page.goto('/bucharest/?lang=fr#14/44.42700/26.08530&lang=de');
    await waitForEngineEvent(page, 'hcm-ready');

    await expect(page.locator('html')).toHaveAttribute('lang', 'ro');
    await expect(menuButton(page, 'ro')).toBeVisible();
    await expect(page.getByRole('slider', { name: t('ro', 'timeline.label'), exact: true })).toHaveAttribute(
        'aria-valuetext',
        t('ro', 'timeline.present'),
    );
});

test('A text without its English version shows the Romanian one, never a key', { tag: '@S-V11-BAD-MISSING-KEY' }, async ({ page }) => {
    await openViewer(page, { lang: 'en', hash: `17/44.42955/26.09560&photo=${LONE}` });

    await expect(page.getByRole('heading', { name: LONE_TITLE_RO, exact: true })).toBeVisible();
    expect(await pageTexts(page)).toContain(t('en', 'license.permission-legacy'));
    expect(await i18nLeaks(page, 'en'), 'no raw message key is shown').toEqual([]);
});

test("A language switch also relabels the map's own controls", { tag: '@S-V11-BAD-MAPBOX-LABELS' }, async ({ page }) => {
    // The tour: Mapbox writes these names once, so a switch left "Map", "Mapbox homepage" and the toggle in English.
    await openViewer(page, { lang: 'en' });
    const map = viewer(page).locator('.map');
    await expect(map.locator('canvas.mapboxgl-canvas')).toHaveAttribute('aria-label', t('en', 'map.title'));

    await chooseMenuItem(page, 'en', t('en', 'language.ro'));

    await expect(page.locator('html')).toHaveAttribute('lang', 'ro');
    await expect(map.locator('canvas.mapboxgl-canvas')).toHaveAttribute('aria-label', t('ro', 'map.title'));
    await expect(map.locator('a.mapboxgl-ctrl-logo')).toHaveAttribute('aria-label', t('ro', 'map.logo'));
    await expect(map.locator('.mapboxgl-ctrl-attrib-button')).toHaveAttribute('aria-label', t('ro', 'map.toggleAttribution'));
    expect(await i18nLeaks(page, 'ro'), 'no English-only text is left').toEqual([]);
});

test('The city theme follows the system, and the visitor choice persists', { tag: '@S-V12-HAPPY' }, async ({ page, lang }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openViewer(page, { lang });
    await expect.poll(() => hostToken(page, PRIMARY)).toBe(TOKENS['dark']?.[PRIMARY]?.toLowerCase());

    await chooseMenuItem(page, lang, t(lang, 'about.title'));
    await viewer(page)
        .locator('hcm-about-dialog')
        .getByRole('radio', { name: t(lang, 'theme.light') })
        .click();
    await expect.poll(() => hostToken(page, PRIMARY)).toBe(TOKENS['light']?.[PRIMARY]?.toLowerCase());
    const axe = await new AxeBuilder({ page }).withTags(['wcag2aa']).withRules(['color-contrast']).include('hcm-map-viewer').analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);

    await page.reload();
    await waitForEngineEvent(page, 'hcm-ready');
    await expect.poll(() => hostToken(page, PRIMARY)).toBe(TOKENS['light']?.[PRIMARY]?.toLowerCase());
});

test(
    'An invalid theme seed is refused and the card keeps the engine palette',
    { tag: '@S-V12-BAD-INVALID-SEED' },
    async ({ page, lang }) => {
        const manifest = siteManifestData();
        ((manifest['city'] as Json)['theme'] as Json)['seedColor'] = 'brown-ish';
        const held: Route[] = [];
        await page.route(BUCHAREST_MANIFEST, (route) => {
            held.push(route);
        });
        await page.goto(sitePath('bucharest', { lang }));
        await expect.poll(() => held.length).toBe(1);
        const engineDefault = await hostToken(page, PRIMARY);

        await held[0]?.fulfill({ json: manifest });
        const card = page.getByRole('alert');
        await expect(card).toContainText(t(lang, 'error.manifest.invalid', { count: '1' }));
        await expect(card).toContainText(`city.theme.seedColor: ${t(lang, 'validation.format')}`);
        expect(await hostToken(page, PRIMARY)).toBe(engineDefault);
        expect(engineDefault).not.toBe(TOKENS['light']?.[PRIMARY]?.toLowerCase());
        const axe = await new AxeBuilder({ page }).withTags(['wcag2aa']).withRules(['color-contrast']).include('hcm-map-viewer').analyze();
        expect(axe.violations.map((violation) => violation.id)).toEqual([]);
    },
);

test('More contrast switches to the high-contrast scheme with 7:1 text', { tag: '@S-V12-HAPPY-HIGH-CONTRAST' }, async ({ page, lang }) => {
    await page.emulateMedia({ colorScheme: 'light', contrast: 'more' });
    await openViewer(page, { lang });

    await expect.poll(() => hostToken(page, PRIMARY)).toBe(TOKENS['highContrastLight']?.[PRIMARY]?.toLowerCase());
    await chooseMenuItem(page, lang, t(lang, 'about.title'));
    await expect(page.getByRole('dialog', { name: t(lang, 'about.title') })).toBeVisible();
    const axe = await new AxeBuilder({ page }).withRules(['color-contrast-enhanced']).include('hcm-map-viewer').exclude('canvas').analyze();
    expect(axe.violations.flatMap((violation) => violation.nodes.map((node) => node.target.join(' ')))).toEqual([]);
});

test(
    'With the fonts blocked, icons stay in their box and every control keeps its name',
    { tag: '@S-V12-BAD-FONTS-BLOCKED' },
    async ({ page, lang, consoleErrors }) => {
        await page.route('**/engine/fonts/**', (route) => route.abort('blockedbyclient'));
        await openViewer(page, { lang });

        await expect(menuButton(page, lang)).toBeVisible();
        await chooseMenuItem(page, lang, t(lang, 'about.title'));
        await expect(page.getByRole('dialog', { name: t(lang, 'about.title') })).toBeVisible();
        await expect(
            page
                .getByRole('button', { name: t(lang, 'action.close'), exact: true })
                .filter({ visible: true })
                .first(),
        ).toBeVisible();
        const icons = await page.evaluate(() => {
            const sizes: { width: number; height: number; overflow: string }[] = [];
            const visit = (root: Document | ShadowRoot): void => {
                for (const element of Array.from(root.querySelectorAll('*'))) {
                    if (element.tagName === 'HCM-ICON' && element.checkVisibility()) {
                        const box = element.getBoundingClientRect();
                        const span = element.shadowRoot?.querySelector('span');
                        sizes.push({
                            width: box.width,
                            height: box.height,
                            overflow: span === null || span === undefined ? '' : getComputedStyle(span).overflow,
                        });
                    }
                    if (element.shadowRoot !== null) {
                        visit(element.shadowRoot);
                    }
                }
            };
            visit(document);
            return sizes;
        });
        expect(icons.length).toBeGreaterThan(0);
        expect(icons.filter((icon) => icon.width > 48 || icon.height > 48 || icon.overflow !== 'hidden')).toEqual([]);
        expect(consoleErrors.take().filter((error) => !error.includes('ERR_BLOCKED_BY_CLIENT'))).toEqual([]);
    },
);
