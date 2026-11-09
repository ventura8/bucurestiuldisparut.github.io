import { LANGUAGE_NAMES, VIEWER_LOCALES, type ViewerLocale } from '@hcm/shared';
import type { Page, Route } from '@playwright/test';

import { i18nLeaks } from '../../support/i18n.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import {
    chooseLanguage,
    chooseMenuItem,
    holdToast,
    languageList,
    menuButton,
    openViewer,
    t,
    viewer,
    waitForEngineEvent,
} from '../../support/viewer.js';

/**
 * The viewer's sixteen languages (V11; docs/ENGINE_API.md → Language): each fetched from `i18n/<locale>.json` next to
 * the engine when first shown, Arabic right to left, the choice kept by the hash and across a reload; a language whose
 * file cannot be fetched leaves the page in the language it had, and says so.
 */

/** The engine's language files on the site server (the engine is next to the page, in `engine/`). */
const CATALOGUE_FILES = '**/engine/i18n/*.json';

/** Every language file request the page made, by language. */
function catalogueRequests(page: Page): string[] {
    const requested: string[] = [];
    page.on('request', (request) => {
        const match = /\/i18n\/([a-z]{2})\.json$/.exec(request.url());
        if (match?.[1] !== undefined) {
            requested.push(match[1]);
        }
    });
    return requested;
}

/** Answers the language files of `locales` with `answer` (a refused file, a file of another engine). */
async function breakCatalogues(page: Page, locales: readonly ViewerLocale[], answer: (route: Route) => Promise<void>): Promise<void> {
    await page.route(CATALOGUE_FILES, async (route) => {
        const locale = /\/([a-z]{2})\.json$/.exec(route.request().url())?.[1];
        await (locales.some((each) => each === locale) ? answer(route) : route.fallback());
    });
}

const notFound = (route: Route): Promise<void> => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });

test.describe('the viewer in any of its languages', () => {
    test(
        'German, Arabic and Japanese from the list: the whole viewer follows, the hash and a reload keep it',
        { tag: '@S-V11-HAPPY-ALL-LANGS' },
        async ({ page, lang }) => {
            const requested = catalogueRequests(page);
            await openViewer(page, { lang });

            await chooseMenuItem(page, lang, t(lang, 'language.label'));
            await expect(page.getByRole('dialog', { name: t(lang, 'about.title') })).toBeVisible();
            const names = languageList(page).getByRole('radio');
            // Each radio's label (the checked one also draws its check mark's ligature).
            expect(await names.evaluateAll((radios) => radios.map((radio) => radio.querySelector(':scope > span')?.textContent))).toEqual(
                Object.values(LANGUAGE_NAMES),
            );
            await expect(names.filter({ hasText: LANGUAGE_NAMES[lang] })).toHaveAttribute('aria-checked', 'true');
            expect(await names.evaluateAll((radios) => radios.map((radio) => radio.getAttribute('lang')))).toEqual(
                Object.keys(LANGUAGE_NAMES),
            );
            await page.keyboard.press('Escape');

            let from: ViewerLocale = lang;
            for (const to of ['de', 'ar', 'ja'] as const) {
                await chooseLanguage(page, from, to);
                await expect(menuButton(page, to)).toBeVisible();
                await expect(page.getByRole('slider', { name: t(to, 'timeline.label'), exact: true })).toBeVisible();
                await expect.poll(() => page.evaluate(() => location.hash)).toContain(`lang=${to}`);
                expect(await i18nLeaks(page, to), `no text of another language in ${to}`).toEqual([]);
                from = to;
            }
            // The engine bundles no language: even the first one came as a file, each once.
            expect(requested).toEqual([lang, 'de', 'ar', 'ja']);

            await page.reload();
            await waitForEngineEvent(page, 'hcm-ready');
            await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
            await expect(menuButton(page, 'ja')).toBeVisible();
        },
    );

    test('Arabic reads right to left: the page mirrors, the map does not', { tag: '@S-V11-HAPPY-RTL' }, async ({ page }) => {
        // A wide window: the timeline lies at the bottom (a phone held upright stands it on the leading edge).
        await page.setViewportSize({ width: 1280, height: 800 });
        await openViewer(page, { lang: 'ar' });

        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(viewer(page)).toHaveAttribute('dir', 'rtl');
        expect(
            await viewer(page)
                .locator('.map')
                .evaluate((map) => getComputedStyle(map).direction),
        ).toBe('ltr');
        // Today, the timeline's last stop, is on the left right to left.
        const slider = page.getByRole('slider', { name: t('ar', 'timeline.label'), exact: true });
        const track = await viewer(page).locator('hcm-timeline').boundingBox();
        const thumb = await slider.boundingBox();
        expect(thumb !== null && track !== null && thumb.x + thumb.width / 2 < track.x + track.width / 2).toBe(true);
        await expect(menuButton(page, 'ar')).toBeVisible();
        expect(await i18nLeaks(page, 'ar')).toEqual([]);
    });

    test(
        "A city text the language lacks shows the city's own, named by its language",
        { tag: '@S-V11-HAPPY-FALLBACK-TEXT' },
        async ({ page }) => {
            // The photo's title is only in Romanian (the fixture's), so a German page shows it with a note naming Română.
            await openViewer(page, { lang: 'de', hash: '17/44.42955/26.09560&photo=strandul-opereta-1976' });

            const sheet = viewer(page).locator('hcm-photo-sheet');
            await expect(sheet.getByRole('heading', { name: 'Ștrandul Operetă', exact: true })).toBeVisible();
            await expect(sheet.locator('.fallback-note')).toHaveText(t('de', 'content.fallback', { language: 'Română' }));
        },
    );

    test('Every viewer language boots from its code in the address', { tag: '@S-V11-HAPPY-ALL-LANGS' }, async ({ page }) => {
        // Eleven boots, each a page load with its map: a phone's SwiftShader frame takes about 5 s each.
        test.setTimeout(180_000);
        for (const locale of VIEWER_LOCALES.filter((each) => !['ro', 'en', 'de', 'ar', 'ja'].includes(each))) {
            await page.goto(sitePath('bucharest', { lang: locale }));
            await waitForEngineEvent(page, 'hcm-ready');
            await expect(page.locator('html')).toHaveAttribute('lang', locale);
            await expect(menuButton(page, locale)).toBeVisible();
        }
    });
});

test.describe('a language that cannot be fetched', () => {
    test.use({
        expectedConsoleErrors: [
            {
                text: /404|Failed to load resource/i,
                url: /\/i18n\/[a-z]{2}\.json$/,
                why: "the test refuses a language's file: the page must stay in its language and say so",
            },
        ],
    });

    test('A missing file keeps the page in its language, with a message', { tag: '@S-V11-BAD-CATALOGUE-404' }, async ({ page, lang }) => {
        await breakCatalogues(page, ['ko'], notFound);
        await openViewer(page, { lang });

        await chooseMenuItem(page, lang, t(lang, 'language.label'));
        await languageList(page).getByRole('radio', { name: LANGUAGE_NAMES.ko, exact: true }).click();

        await holdToast(page, t(lang, 'language.unavailable'));
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await expect(languageList(page).getByRole('radio', { name: LANGUAGE_NAMES[lang], exact: true })).toHaveAttribute(
            'aria-checked',
            'true',
        );
        expect(await page.evaluate(() => location.hash)).not.toContain('lang=ko');
    });

    test("A file of another engine's version is refused", { tag: '@S-V11-BAD-CATALOGUE-STALE' }, async ({ page, lang }) => {
        await breakCatalogues(page, ['fr'], async (route) => {
            const response = await route.fetch();
            const file = (await response.json()) as Record<string, unknown>;
            await route.fulfill({ response, json: { ...file, engine: '0.0.1' } });
        });
        await openViewer(page, { lang });

        await chooseMenuItem(page, lang, t(lang, 'language.label'));
        await languageList(page).getByRole('radio', { name: LANGUAGE_NAMES.fr, exact: true }).click();

        await holdToast(page, t(lang, 'language.unavailable'));
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
    });

    test('A boot language that cannot load leaves Romanian, saying so', { tag: '@S-V11-BAD-BOOT-CATALOGUE' }, async ({ page }) => {
        await breakCatalogues(page, ['hi'], notFound);
        await page.goto(sitePath('bucharest', { lang: 'hi' }));
        await waitForEngineEvent(page, 'hcm-ready');

        await expect(page.locator('html')).toHaveAttribute('lang', 'ro');
        await holdToast(page, t('ro', 'language.unavailable'));
    });

    test('No language at all: the engine says so in Romanian and English', { tag: '@S-V11-BAD-BOOT-CATALOGUE' }, async ({ page }) => {
        await breakCatalogues(page, VIEWER_LOCALES, notFound);
        await page.goto(sitePath('bucharest', { lang: 'tr' }));

        const card = page.getByRole('alert');
        await expect(card.locator('p[lang="ro"]')).toHaveText('Harta nu s-a putut încărca.');
        await expect(card.locator('p[lang="en"]')).toHaveText('The map could not be loaded.');
        await expect(card.getByRole('button')).toHaveAccessibleName('Reîncearcă · Retry');
    });
});

test('An unknown language in the hash is ignored', { tag: '@S-V11-BAD-UNKNOWN-HASH-LANG' }, async ({ page }) => {
    await page.goto(sitePath('bucharest', { hash: '14/44.42700/26.08530&lang=xx' }));
    await waitForEngineEvent(page, 'hcm-ready');

    await expect(page.locator('html')).toHaveAttribute('lang', 'ro');
    await expect(menuButton(page, 'ro')).toBeVisible();
});
