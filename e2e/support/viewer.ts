import { expect, type Locator, type Page, type Route } from '@playwright/test';
import { translate, type Locale, type MessageKey, type ValidationIssue, type ValidationResult } from '@hcm/shared';

import { readInstrumentation } from './instrumentation.js';
import { mapIdle } from './map.js';
import { sitePath, type OpenOptions, type SiteName } from './site.js';

/**
 * Driving the built viewer from outside, as a visitor does (docs/research/design-review-testability.md §4.2): open
 * the page (with a hash or a language), serve a changed manifest for a bad path, and find its controls by role and
 * by their localized names. Expected texts come from the i18n catalogues of @hcm/shared, so the same spec runs in the
 * Romanian and the English projects.
 */

/** The data/manifest.json of the Bucharest site (a bad path serves its own copy). */
export const BUCHAREST_MANIFEST = '**/bucharest/data/manifest.json';

/** The catalogue text of `key` in `lang`. */
export function t(lang: Locale, key: MessageKey, params: Readonly<Record<string, string>> = {}): string {
    return translate(lang, key, params);
}

/** Serves `manifest` instead of the built fixture (a page route wins over the site server). */
export async function serveManifest(page: Page, manifest: unknown, url = BUCHAREST_MANIFEST): Promise<void> {
    await page.route(url, (route: Route) => route.fulfill({ json: manifest }));
}

/** The engine events the page fired so far, by type. */
export async function engineEvents(page: Page, type: string): Promise<unknown[]> {
    const { events } = await readInstrumentation(page);
    return events.filter((event) => event.type === type).map((event) => event.detail);
}

/**
 * Runs in the page: resolves once the engine event `type` reached `document`, at once when the instrumentation already
 * recorded one (false without the instrumentation, so the caller tries again).
 */
function engineEventInPage(type: string): Promise<boolean> {
    const state = (window as unknown as { __hcmE2e?: { events: { type: string }[] } }).__hcmE2e;
    if (state === undefined) {
        return Promise.resolve(false);
    }
    if (state.events.some((event) => event.type === type)) {
        return Promise.resolve(true);
    }
    return new Promise((resolve) => {
        document.addEventListener(
            type,
            () => {
                resolve(true);
            },
            { capture: true, once: true },
        );
    });
}

/** Waits for the engine event `type`, when it fires (it may have fired before the spec looked). */
export async function waitForEngineEvent(page: Page, type: string): Promise<void> {
    await expect.poll(() => page.evaluate(engineEventInPage, type), { message: `the page receives ${type}` }).toBe(true);
}

export interface ViewerOpenOptions extends OpenOptions {
    readonly site?: SiteName;
}

/** Opens a site, waits for `hcm-ready` and for the map to be idle. */
export async function openViewer(page: Page, options: ViewerOpenOptions = {}): Promise<void> {
    await page.goto(sitePath(options.site ?? 'bucharest', options));
    await waitForEngineEvent(page, 'hcm-ready');
    await mapIdle(page);
}

/** The `<hcm-map-viewer>` element (Playwright locators pierce its open shadow root). */
export function viewer(page: Page): Locator {
    return page.locator('hcm-map-viewer');
}

/** The floating menu button. */
export function menuButton(page: Page, lang: Locale): Locator {
    return page.getByRole('button', { name: t(lang, 'action.menu'), exact: true });
}

/** Opens the FAB menu and picks the item named `label`. */
export async function chooseMenuItem(page: Page, lang: Locale, label: string): Promise<void> {
    await menuButton(page, lang).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
}

/** Opens the Layers panel unless it is already shown. */
export async function openLayers(page: Page, lang: Locale): Promise<void> {
    const opacity = page.getByRole('slider', { name: t(lang, 'layers.opacity', { name: t(lang, 'layers.photos') }) });
    if (!(await opacity.isVisible())) {
        await chooseMenuItem(page, lang, t(lang, 'layers.title'));
    }
    await expect(opacity).toBeVisible();
}

/** The opacity slider of the overlay named `name` in the Layers panel. */
export function opacitySlider(page: Page, lang: Locale, name: string): Locator {
    return page.getByRole('slider', { name: t(lang, 'layers.opacity', { name }), exact: true });
}

/** The visibility switch of the overlay named `name` in the Layers panel. */
export function visibilitySwitch(page: Page, lang: Locale, name: string): Locator {
    return page.getByRole('switch', { name: t(lang, 'layers.toggle', { name }), exact: true });
}

/** Calls a method of the page viewer's controller (docs/ENGINE_API.md → JavaScript API), as an embedding page does. */
export async function callController(page: Page, method: string, ...args: unknown[]): Promise<void> {
    await page.evaluate(
        ({ name, values }) => {
            type Controller = Record<string, ((...parameters: unknown[]) => unknown) | undefined>;
            const element = document.querySelector<Element & { controller?: Controller | null }>('hcm-map-viewer');
            element?.controller?.[name]?.(...values);
        },
        { name: method, values: args },
    );
}

/** The page's current hash without `#`. */
export async function currentHash(page: Page): Promise<string> {
    return (await page.evaluate(() => location.hash)).replace(/^#/, '');
}

/** One parameter of the current hash (`op`, `layers`, `photo`), or null. */
export async function hashParam(page: Page, name: string): Promise<string | null> {
    const [, ...parameters] = (await currentHash(page)).split('&');
    const found = parameters.find((parameter) => parameter.startsWith(`${name}=`));
    return found === undefined ? null : decodeURIComponent(found.slice(name.length + 1));
}

/** The window class of a viewport width (M3: compact < 600 ≤ medium < 840 ≤ expanded < 1200 ≤ large < 1600). */
export function windowClassOf(width: number): 'compact' | 'medium' | 'expanded' | 'large' | 'extra-large' {
    if (width < 600) {
        return 'compact';
    }
    if (width < 840) {
        return 'medium';
    }
    if (width < 1200) {
        return 'expanded';
    }
    return width < 1600 ? 'large' : 'extra-large';
}

/** Expanded and wider windows dock the detail sheet in a pane; compact and medium ones open it as a modal sheet. */
export function isDocked(page: Page): boolean {
    return (page.viewportSize()?.width ?? 0) >= 840;
}

/**
 * Closes the modal sheet on top (a photo's, the Layers'), which makes the map and its menu inert in compact and medium
 * windows; a docked pane stays open. Window-class branches live in helpers like this one, so spec bodies stay linear
 * (`playwright/no-conditional-in-test`).
 */
export async function closeModalSheet(page: Page): Promise<void> {
    if (!isDocked(page)) {
        await page.keyboard.press('Escape');
    }
}

/** The issues `validateManifest` reports (none for a valid manifest). */
export function manifestIssues(result: ValidationResult<unknown>): readonly ValidationIssue[] {
    return result.ok ? [] : result.issues;
}
