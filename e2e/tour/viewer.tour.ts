import type { Locale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { siteManifestData } from '../fixtures/manifest.js';
import { i18nLeaks } from '../support/i18n.js';
import {
    clippedTexts,
    focused,
    horizontalOverflow,
    isOnTop,
    outsideViewport,
    overlaps,
    smallTouchTargets,
    visibleBoxes,
} from '../support/layout.js';
import { mapIdle } from '../support/map.js';
import { sitePath } from '../support/site.js';
import { expect, test } from '../support/test.js';
import {
    BUCHAREST_MANIFEST,
    callController,
    chooseMenuItem,
    menuButton,
    openLayers,
    openViewer,
    serveManifest,
    t,
    viewer,
    waitForEngineEvent,
} from '../support/viewer.js';

/**
 * The layout and accessibility tour (docs/research/design-review-testability.md §4.3; behaviours V15 and V18): every
 * screen and state of the viewer on all 11 viewports, light and dark, Romanian and English (44 projects). Each state
 * must pass axe (WCAG 2.2 AA), scroll nothing sideways, keep its usable floating controls (`[data-layout-check]`, the
 * Mapbox logo and attribution) apart and on screen, clip no text, give every touch target 48 × 48 px on compact, leak
 * no message key (nor English into a Romanian page), and keep its landmarks (a partial ARIA snapshot). Whenever the map
 * is shown, exactly one Mapbox logo and one attribution are visible and nothing covers them (Mapbox terms): Mapbox's
 * own on the map, or the viewer's copy in its legal bar or at the foot of About while a modal surface covers the map.
 */

/**
 * The floating controls that must never overlap: the viewer's own (named in the markup) and Mapbox's legal controls.
 * The menu counts by its button: its open list is a transient popup above the other controls, whose items must only
 * stay on screen (checked apart).
 */
const FLOATING = ['[data-layout-check]:not([data-layout-check="menu"])', 'button.fab', 'a.mapboxgl-ctrl-logo', '.mapboxgl-ctrl-attrib'];

const PHOTO = 'strandul-opereta-1976';
const PHOTO_VIEW = '18/44.42955/26.09560';

function isCompact(page: Page): boolean {
    return (page.viewportSize()?.width ?? 0) < 600;
}

/** The Mapbox logo, and the attribution: Mapbox's own control on the map, or the viewer's copy (`map-attribution`). */
const LEGAL = ['a.mapboxgl-ctrl-logo', '.mapboxgl-ctrl-attrib, [data-layout-check="map-attribution"]'] as const;

/** Mapbox terms (V18): with a map on screen, one logo and one attribution are visible and nothing covers them. */
async function checkLegal(page: Page, state: string): Promise<void> {
    for (const selector of LEGAL) {
        const shown = viewer(page).locator(selector).filter({ visible: true });
        await expect(shown, `${state}: one visible ${selector}`).toHaveCount(1);
        await expect(isOnTop(shown), `${state}: nothing covers ${selector}`).resolves.toBe(true);
    }
}

/**
 * Every invariant of the tour for the state the page is in now; `state` names it in the failure messages. Without a
 * map (the error card) there is no Mapbox logo or attribution to check.
 */
async function checkState(page: Page, lang: Locale, state: string, axe: { violations(): Promise<unknown[]> }, map = true): Promise<void> {
    const viewport = page.viewportSize() ?? { width: 0, height: 0 };
    expect(await axe.violations(), `${state}: axe (WCAG 2.2 AA)`).toEqual([]);
    expect(await horizontalOverflow(page), `${state}: no horizontal scroll`).toBeLessThanOrEqual(0);
    if (map) {
        await checkLegal(page, state);
    }
    const boxes = await visibleBoxes(page, FLOATING, { usable: true });
    expect(overlaps(boxes), `${state}: floating controls overlap`).toEqual([]);
    expect(outsideViewport(boxes, viewport), `${state}: floating controls off screen`).toEqual([]);
    expect(outsideViewport(await visibleBoxes(page, ['[role="menuitem"]']), viewport), `${state}: menu items off screen`).toEqual([]);
    expect(await clippedTexts(page), `${state}: clipped text`).toEqual([]);
    if (isCompact(page)) {
        expect(await smallTouchTargets(page), `${state}: touch targets under 48 px`).toEqual([]);
    }
    expect(await i18nLeaks(page, lang), `${state}: message keys or English in a Romanian page`).toEqual([]);
}

/** One entry of an ARIA snapshot template, quoted as YAML (a name may hold `: `). */
function entry(role: string, name: string): string {
    return `- '${role} ${JSON.stringify(name).replaceAll("'", "''")}'`;
}

/** The partial ARIA snapshot of the viewer's frame: its landmarks and controls in order. */
function frameSnapshot(lang: Locale, city: string, withTimeline: boolean): string {
    const entries = [
        entry('region', t(lang, 'viewer.mapLabel', { city })),
        ...(withTimeline ? [entry('slider', t(lang, 'timeline.label'))] : []),
        entry('button', t(lang, 'action.menu')),
    ];
    return entries.join('\n');
}

const CITY = (siteManifestData()['city'] as { name: Record<Locale, string> }).name;

test('Home, the keyboard focus and the open menu', { tag: ['@S-V15-HAPPY', '@S-V18-HAPPY'] }, async ({ page, lang, axe }) => {
    await openViewer(page, { lang });
    await expect(viewer(page)).toMatchAriaSnapshot(frameSnapshot(lang, CITY[lang], true));
    await checkState(page, lang, 'home', axe);

    // On the map itself, Mapbox's own controls: the compact attribution is its toggle button.
    const logo = viewer(page).locator('.mapboxgl-ctrl-bottom-left a.mapboxgl-ctrl-logo');
    await expect(logo).toBeVisible();
    await expect(isOnTop(logo)).resolves.toBe(true);
    const attribution = viewer(page).locator(isCompact(page) ? '.mapboxgl-ctrl-attrib-button' : '.mapboxgl-ctrl-attrib-inner');
    await expect(attribution).toBeVisible();
    await expect(isOnTop(attribution)).resolves.toBe(true);

    await page.keyboard.press('Tab');
    const first = await focused(page);
    expect(first?.name, 'the skip link takes the first Tab').toBe(t(lang, 'viewer.skipToTimeline'));
    expect(first?.ringVisible, 'the focus ring shows').toBe(true);

    await menuButton(page, lang).click();
    await expect(page.getByRole('menu', { name: t(lang, 'action.menu') })).toBeVisible();
    await checkState(page, lang, 'menu open', axe);
});

test('A historical year and the Layers panel', { tag: ['@S-V15-HAPPY', '@S-V18-HAPPY-MODAL-STATES'] }, async ({ page, lang, axe }) => {
    await openViewer(page, { lang, hash: '15/44.42700/26.08530&layers=e2e-1966' });
    await expect(page.getByRole('button', { name: t(lang, 'photos.nearYear', { year: '1966' }) })).toBeVisible();
    await checkState(page, lang, 'year 1966', axe);

    await openLayers(page, lang);
    await mapIdle(page);
    await checkState(page, lang, 'layers panel', axe);
});

test('A photo, its lightbox, and the photo list', { tag: ['@S-V15-HAPPY', '@S-V18-HAPPY-MODAL-STATES'] }, async ({ page, lang, axe }) => {
    await openViewer(page, { lang, hash: `${PHOTO_VIEW}&photo=${PHOTO}` });
    await expect(page.getByRole('heading', { name: 'Ștrandul Operetă' })).toBeVisible();
    await checkState(page, lang, 'photo sheet', axe);

    await page.getByRole('button', { name: t(lang, 'photo.openLightbox') }).click();
    await expect(page.getByRole('dialog', { name: t(lang, 'lightbox.label') })).toBeVisible();
    await checkState(page, lang, 'lightbox', axe);
    await page.keyboard.press('Escape');

    await callController(page, 'openPhoto', null);
    await chooseMenuItem(page, lang, t(lang, 'photos.list'));
    await expect(viewer(page).locator('.photos-sheet hcm-photo-list').getByRole('status')).toBeVisible();
    await checkState(page, lang, 'photo list', axe);
});

test('A point of interest and About', { tag: ['@S-V15-HAPPY', '@S-V18-HAPPY-MODAL-STATES'] }, async ({ page, lang, axe }) => {
    await openViewer(page, { lang, hash: '16/44.42680/26.08720' });
    await callController(page, 'openPoi', 'fixture-cladire');
    await expect(
        page.getByRole('heading', { name: lang === 'ro' ? 'Clădire demolată (fixture)' : 'Demolished building (fixture)' }),
    ).toBeVisible();
    await checkState(page, lang, 'POI details', axe);

    await callController(page, 'openPoi', null);
    await chooseMenuItem(page, lang, t(lang, 'about.title'));
    await expect(page.getByRole('dialog', { name: t(lang, 'about.title') })).toBeVisible();
    await checkState(page, lang, 'About', axe);
});

test('Bucharest today: no layers yet and the consent banner', { tag: '@S-V15-HAPPY' }, async ({ page, lang, axe }) => {
    await serveManifest(page, siteManifestData({ layers: false, analytics: true }));
    await openViewer(page, { lang });
    await expect(page.getByText(t(lang, 'timeline.empty'), { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: t(lang, 'consent.accept'), exact: true })).toBeVisible();
    await expect(viewer(page)).toMatchAriaSnapshot(frameSnapshot(lang, CITY[lang], false));
    await checkState(page, lang, 'no layers, consent', axe);
});

test('The error card', { tag: '@S-V15-HAPPY' }, async ({ page, lang, axe, consoleErrors }) => {
    await page.route(BUCHAREST_MANIFEST, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }));
    await page.goto(sitePath('bucharest', { lang }));
    await expect(page.getByRole('alert')).toContainText(t(lang, 'error.manifest.notFound'));
    expect(consoleErrors.take()).toEqual([expect.stringContaining('404')]);
    await checkState(page, lang, 'error card', axe, false);
});

test('A toast', { tag: '@S-V15-HAPPY' }, async ({ page, lang, axe }) => {
    await page.goto(sitePath('bucharest', { lang, hash: '15/44.37000/25.97000&photo=no-such-photo' }));
    // The toast shows as the manifest is applied and closes itself 6 s later, while a 4K map on a busy machine may take
    // longer than that to settle. Focus inside it keeps it open (M3), as for a keyboard visitor reading it; focusing
    // needs no stable frame, which a hover waits for and a loaded 4K page may not give within those 6 s.
    await viewer(page).locator('hcm-snackbar .snackbar hcm-icon-button button').focus();
    await waitForEngineEvent(page, 'hcm-ready');
    await expect(page.getByRole('status').filter({ hasText: t(lang, 'error.unknownPhoto') })).toBeVisible();
    await checkState(page, lang, 'toast', axe);
});
