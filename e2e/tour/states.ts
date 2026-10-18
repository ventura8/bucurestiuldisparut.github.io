import type { Locale } from '@hcm/shared';
import { expect, type BrowserContext, type Locator, type Page, type Route } from '@playwright/test';

import { POIS_STATES } from '../admin/specs/pois/states.js';
import { SITE_ORIGIN } from '../fixtures/world.js';
import { siteManifestData } from '../fixtures/manifest.js';
import { settleAnimations } from '../support/layout.js';
import { recordLiveRegions } from '../support/live-regions.js';
import { mapIdle } from '../support/map.js';
import { sitePath } from '../support/site.js';
import { expectStateSound, type StateVisit } from '../support/state-check.js';
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
 * The state inventory of the layout and accessibility tour (the user's request of 2026-10-12: "we should have tests
 * for overlapping elements!!! also for accessibility!!"): every screen and state of the viewer, each with how the tour
 * reaches it, and every state of the admin with the spec that reaches it. Every visit runs the generic layout checker
 * and the generic accessibility checker (e2e/support/state-check.ts → `expectStateSound`) at the project's viewport,
 * scheme and language: the viewer's on all 11 viewports (e2e/tour/viewer.tour.ts, tiers `tour` and `tour-matrix`), the
 * admin's at its four projects (e2e/admin/specs/). A state that does not exist at a window size (a bottom sheet's
 * heights on anything but a phone held upright, the Layers item of a menu whose panel is always docked) is left out
 * there by `exists`, never skipped. The landscape variants are the `c915l` projects; swipe compare (V06) joins in M4.
 */

/** What a state's steps drive and read. */
export interface TourContext {
    readonly page: Page;
    readonly context: BrowserContext;
    readonly lang: Locale;
}

interface ViewerState {
    readonly id: string;
    /** What the visitor sees, for the inventory's table (docs/TESTING.md → *The tour's states*). */
    readonly title: string;
    /** Drives the page into the state from the journey's previous one. */
    readonly enter: (tour: TourContext) => Promise<void>;
    /** Whether the state exists at this window size (all by default). */
    readonly exists?: (page: Page) => boolean;
    /** What a live region announces on the way in. */
    readonly announcements?: (lang: Locale) => readonly string[];
    /** Esc closes the state's popup (the focus goes back to the control of this name); only where it is a popup. */
    readonly escape?: (tour: TourContext) => { readonly opener: string | null } | null;
    /** The language the page shows (the language item of the menu switches to the other one). */
    readonly shows?: (lang: Locale) => Locale;
}

/** A phone held upright: sheets are bottom sheets with three heights (peek, half, full). */
function hasBottomSheets(page: Page): boolean {
    const size = page.viewportSize();
    return size !== null && size.width < 600 && size.height >= 480;
}

/** The open sheet (one at a time) and its box. */
function openSheet(page: Page): { sheet: Locator; box: Locator } {
    const sheet = viewer(page).locator('hcm-sheet[open]');
    return { sheet, box: sheet.locator('section.sheet') };
}

/** Moves the open bottom sheet to `detent` with its handle's arrow keys (one step per press), then waits for it to settle. */
async function toDetent(page: Page, lang: Locale, detent: 'peek' | 'half' | 'full'): Promise<void> {
    const { sheet, box } = openSheet(page);
    const order = ['peek', 'half', 'full'];
    const now = order.indexOf((await sheet.getAttribute('detent')) ?? 'half');
    const steps = order.indexOf(detent) - now;
    const handle = sheet.getByRole('button', { name: t(lang, 'sheet.resize'), exact: true });
    await handle.focus();
    for (let step = 0; step < Math.abs(steps); step += 1) {
        await handle.press(steps > 0 ? 'ArrowUp' : 'ArrowDown');
    }
    await expect(sheet).toHaveAttribute('detent', detent);
    await expect.poll(() => box.evaluate((element) => element.getAnimations().length), { message: 'the sheet has settled' }).toBe(0);
}

/**
 * Sheets are modal on compact and medium windows and on a phone held landscape (compact height: modal side sheets);
 * from expanded up they dock in a pane (packages/ui/src/viewer/layout.ts).
 */
function sheetsAreModal(page: Page): boolean {
    const size = page.viewportSize();
    return size === null || size.width < 840 || size.height < 480;
}

/** Esc closes a modal sheet; a docked pane is no popup. */
function sheetEscape(opener: (lang: Locale) => string | null): NonNullable<ViewerState['escape']> {
    return ({ page, lang }) => (sheetsAreModal(page) ? { opener: opener(lang) } : null);
}

const fromMenu = (lang: Locale): string => t(lang, 'action.menu');

/** The text of a catalogue entry up to the placeholder `varying` (an announcement whose number varies). */
function leadOf(lang: Locale, key: Parameters<typeof t>[1], params: Readonly<Record<string, string>>, varying: string): string {
    return t(lang, key, { ...params, [varying]: '\u0000' }).split('\u0000')[0] ?? '';
}

/** Scrolls the scrolling part of `host`'s dialog to its end (About is taller than a phone). */
async function scrollToEnd(host: Locator): Promise<void> {
    await host.evaluate((element) => {
        const visit = (root: Element | ShadowRoot): void => {
            for (const node of Array.from(root.querySelectorAll('*'))) {
                if (node.scrollHeight > node.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) {
                    node.scrollTop = node.scrollHeight;
                }
                if (node.shadowRoot !== null) {
                    visit(node.shadowRoot);
                }
            }
        };
        visit(element.shadowRoot ?? element);
    });
}

/** The photo the photo states open, and a view near it. */
const PHOTO = 'strandul-opereta-1976';
const PHOTO_TITLE = 'Ștrandul Operetă';
/** The fixture's point of interest. */
const POI = 'fixture-cladire';

/** Every state of the viewer the tour visits, by id. */
const VIEWER_STATES = {
    'skip-link': {
        title: 'The first Tab: the skip link shows over the map with a focus ring',
        enter: async ({ page, lang }) => {
            await page.keyboard.press('Tab');
            await expect(page.getByRole('button', { name: t(lang, 'viewer.skipToTimeline') })).toBeFocused();
        },
    },
    home: {
        title: 'Home: the map, the timeline, the menu button, the legal line',
        enter: async ({ page }) => {
            await page.evaluate(() => {
                (document.activeElement as HTMLElement | null)?.blur();
            });
        },
    },
    'menu-open': {
        title: 'The FAB menu open',
        enter: async ({ page, lang }) => {
            await menuButton(page, lang).click();
            await expect(page.getByRole('menu', { name: t(lang, 'action.menu') })).toBeVisible();
        },
        escape: ({ lang }) => ({ opener: t(lang, 'action.menu') }),
    },
    'share-toast': {
        title: 'Share: the "link copied" toast',
        enter: async ({ page, context, lang }) => {
            await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE_ORIGIN });
            await chooseMenuItem(page, lang, t(lang, 'action.share'));
            await holdToast(page, t(lang, 'share.copied'));
        },
        announcements: (lang) => [t(lang, 'share.copied')],
    },
    'locate-toast': {
        title: 'Show my location without permission: the "access refused" toast',
        enter: async ({ page, lang }) => {
            await chooseMenuItem(page, lang, t(lang, 'action.locate'));
            await holdToast(page, t(lang, 'error.geolocate.denied'));
        },
        announcements: (lang) => [t(lang, 'error.geolocate.denied')],
    },
    language: {
        title: 'The menu switched the language: the whole viewer in the other language',
        enter: async ({ page, lang }) => {
            const other = lang === 'ro' ? 'en' : 'ro';
            await chooseMenuItem(page, lang, t(lang, `language.${other}`));
            await expect(menuButton(page, other)).toBeVisible();
        },
        shows: (lang) => (lang === 'ro' ? 'en' : 'ro'),
    },
    year: {
        title: 'A historical year: its layer, the photos-near-this-year chip',
        enter: async ({ page, lang }) => {
            await expect(page.getByRole('button', { name: t(lang, 'photos.nearYear', { year: '1966' }) })).toBeVisible();
        },
    },
    'timeline-step': {
        title: 'The timeline moved by the keyboard: the slider says its new year',
        enter: async ({ page, lang }) => {
            const slider = page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
            const before = await slider.getAttribute('aria-valuetext');
            await slider.focus();
            await expect(slider).toBeFocused();
            await slider.press('ArrowRight');
            await expect(slider).not.toHaveAttribute('aria-valuetext', before ?? '');
            await mapIdle(page);
        },
    },
    'near-year-photos': {
        title: 'The photos near the year, from the chip',
        enter: async ({ page, lang }) => {
            await page.getByRole('button', { name: t(lang, 'photos.nearYear', { year: '1966' }) }).click();
            await expect(viewer(page).locator('.photos-sheet hcm-photo-list').getByRole('status')).toBeVisible();
        },
        escape: sheetEscape((lang) => t(lang, 'photos.nearYear', { year: '1966' })),
    },
    layers: {
        title: 'The Layers panel (a bottom sheet at half height, a side sheet or a pane)',
        enter: async ({ page, lang }) => {
            await openLayers(page, lang);
            await mapIdle(page);
        },
    },
    'layers-opacity': {
        title: 'An overlay made more transparent by the keyboard: its new opacity is announced',
        enter: async ({ page, lang }) => {
            const slider = page.getByRole('slider', { name: t(lang, 'layers.opacity', { name: t(lang, 'layers.photos') }), exact: true });
            await slider.focus();
            await slider.press('ArrowLeft');
        },
        announcements: (lang) => [leadOf(lang, 'layers.opacityChanged', { name: t(lang, 'layers.photos') }, 'percent')],
        escape: sheetEscape(fromMenu),
    },
    'layers-peek': {
        title: 'The Layers sheet at its lowest height',
        enter: ({ page, lang }) => toDetent(page, lang, 'peek'),
        exists: hasBottomSheets,
    },
    'layers-full': {
        title: 'The Layers sheet at full height, above the legal line',
        enter: ({ page, lang }) => toDetent(page, lang, 'full'),
        exists: hasBottomSheets,
    },
    photo: {
        title: "A photo's sheet",
        enter: async ({ page }) => {
            await expect(page.getByRole('heading', { name: PHOTO_TITLE })).toBeVisible();
        },
    },
    'photo-peek': {
        title: "A photo's sheet at its lowest height",
        enter: ({ page, lang }) => toDetent(page, lang, 'peek'),
        exists: hasBottomSheets,
    },
    'photo-full': {
        title: "A photo's sheet at full height",
        enter: ({ page, lang }) => toDetent(page, lang, 'full'),
        exists: hasBottomSheets,
    },
    lightbox: {
        title: 'The lightbox over everything but the legal line',
        enter: async ({ page, lang }) => {
            await page.getByRole('button', { name: t(lang, 'photo.openLightbox') }).click();
            await expect(page.getByRole('dialog', { name: t(lang, 'lightbox.label') })).toBeVisible();
        },
        escape: ({ lang }) => ({ opener: t(lang, 'photo.openLightbox') }),
    },
    'photo-list': {
        title: 'The list of every photo, from the menu',
        enter: async ({ page, lang }) => {
            await callController(page, 'openPhoto', null);
            await chooseMenuItem(page, lang, t(lang, 'photos.list'));
            await expect(viewer(page).locator('.photos-sheet hcm-photo-list').getByRole('status')).toBeVisible();
        },
        escape: sheetEscape(fromMenu),
    },
    poi: {
        title: "A point of interest's sheet",
        enter: async ({ page, lang }) => {
            await callController(page, 'openPoi', POI);
            const name = lang === 'ro' ? 'Clădire demolată (fixture)' : 'Demolished building (fixture)';
            await expect(page.getByRole('heading', { name })).toBeVisible();
        },
    },
    'poi-peek': {
        title: "A point of interest's sheet at its lowest height",
        enter: ({ page, lang }) => toDetent(page, lang, 'peek'),
        exists: hasBottomSheets,
    },
    'poi-full': {
        title: "A point of interest's sheet at full height",
        enter: ({ page, lang }) => toDetent(page, lang, 'full'),
        exists: hasBottomSheets,
    },
    about: {
        title: 'About, at its top (full screen on a phone)',
        enter: async ({ page, lang }) => {
            await callController(page, 'openPoi', null);
            await chooseMenuItem(page, lang, t(lang, 'about.title'));
            await expect(page.getByRole('dialog', { name: t(lang, 'about.title') })).toBeVisible();
        },
    },
    'about-end': {
        title: 'About scrolled to its end: privacy, the theme, the credits and the map attribution',
        enter: async ({ page }) => {
            await scrollToEnd(viewer(page).locator('hcm-about-dialog'));
        },
        escape: ({ lang }) => ({ opener: t(lang, 'action.menu') }),
    },
    consent: {
        title: 'A city with analytics before the visitor answers: the consent banner (and no layers: the timeline note)',
        enter: async ({ page, lang }) => {
            await expect(page.getByRole('button', { name: t(lang, 'consent.accept'), exact: true })).toBeVisible();
            await expect(page.getByText(t(lang, 'timeline.empty'), { exact: true })).toBeVisible();
        },
    },
    toast: {
        title: 'A link to a photo that does not exist: the toast',
        enter: async ({ page, lang }) => {
            await holdToast(page, t(lang, 'error.unknownPhoto'));
        },
        announcements: (lang) => [t(lang, 'error.unknownPhoto')],
    },
    loading: {
        title: 'Loading: the skeleton while the manifest is on its way',
        enter: async ({ page, lang }) => {
            await expect(page.getByRole('status').filter({ hasText: t(lang, 'viewer.loading') })).toBeVisible();
        },
    },
    'error-not-found': {
        title: 'The error card: the manifest is not found (404)',
        enter: ({ page, lang }) => expectErrorCard(page, t(lang, 'error.manifest.notFound')),
        announcements: (lang) => [t(lang, 'error.manifest.notFound')],
    },
    'error-network': {
        title: 'The error card: the network failed',
        enter: ({ page, lang }) => expectErrorCard(page, t(lang, 'error.manifest.network')),
        announcements: (lang) => [t(lang, 'error.manifest.network')],
    },
    'error-invalid': {
        title: 'The error card: the manifest is invalid',
        enter: ({ page, lang }) => expectErrorCard(page, leadOf(lang, 'error.manifest.invalid', {}, 'count')),
    },
    'no-webgl': {
        title: 'No WebGL: the error card and the photo list instead of the map',
        enter: async ({ page, lang }) => {
            await expect(page.getByText(t(lang, 'error.webgl'))).toBeVisible();
        },
    },
} as const satisfies Record<string, Omit<ViewerState, 'id'>>;

type ViewerStateId = keyof typeof VIEWER_STATES;

/** A state of the inventory with its id. */
function viewerState(id: ViewerStateId): ViewerState {
    return { id: `viewer.${id}`, ...(VIEWER_STATES[id] as Omit<ViewerState, 'id'>) };
}

/** Keeps a toast open while the tour checks it: the pointer rests on it, as a visitor's would (M3 pauses the timeout). */
async function holdToast(page: Page, message: string): Promise<void> {
    const toast = viewer(page).locator('hcm-snackbar .snackbar').filter({ hasText: message });
    await expect(toast).toBeVisible();
    await toast.dispatchEvent('pointerenter');
}

async function expectErrorCard(page: Page, message: string): Promise<void> {
    await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
}

/** What one tour test visits: how it boots, what it checks once booted, and its states in order. */
export interface Journey {
    /** The key of its scenario tags in e2e/tour/viewer.tour.ts (where the registry's gate reads them). */
    readonly id: string;
    readonly title: string;
    readonly boot: (tour: TourContext) => Promise<void>;
    /** Checks of the booted page beyond the states' (the landmarks, Mapbox's own controls). */
    readonly booted?: (tour: TourContext) => Promise<void>;
    readonly states: readonly ViewerStateId[];
}

/** One entry of an ARIA snapshot template, quoted as YAML (a name may hold `: `). */
function entry(role: string, name: string): string {
    return `- '${role} ${JSON.stringify(name).replaceAll("'", "''")}'`;
}

const CITY = (siteManifestData()['city'] as { name: Record<Locale, string> }).name;

/** The frame's landmarks and controls in order (a partial ARIA snapshot), with or without the timeline. */
async function expectFrame({ page, lang }: TourContext, withTimeline: boolean): Promise<void> {
    const entries = [
        entry('region', t(lang, 'viewer.mapLabel', { city: CITY[lang] })),
        ...(withTimeline ? [entry('slider', t(lang, 'timeline.label'))] : []),
        entry('button', t(lang, 'action.menu')),
    ];
    await expect(viewer(page)).toMatchAriaSnapshot(entries.join('\n'));
}

/** On the map itself, Mapbox's own logo and attribution (on a phone the collapsed attribution is its toggle button). */
async function expectMapboxControls({ page }: TourContext): Promise<void> {
    const compact = (page.viewportSize()?.width ?? 0) < 600;
    for (const selector of [
        '.mapboxgl-ctrl-bottom-left a.mapboxgl-ctrl-logo',
        compact ? '.mapboxgl-ctrl-attrib-button' : '.mapboxgl-ctrl-attrib-inner',
    ]) {
        await expect(viewer(page).locator(selector)).toBeVisible();
    }
}

/** Opens the viewer with its manifest request held until the test ends: the skeleton stays for the checks. */
async function openWithManifestHeld({ page, lang }: TourContext): Promise<void> {
    const held: Route[] = [];
    await page.route(BUCHAREST_MANIFEST, (route) => {
        held.push(route);
    });
    await page.goto(sitePath('bucharest', { lang }));
    await expect.poll(() => held.length).toBe(1);
}

/** The 404 answer of a missing manifest. */
function notFound(route: Route): Promise<void> {
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
}

/** WebGL refused, as a browser without it does (`getContext` answers null), before the engine probes it. */
function withoutWebGl(): void {
    const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')?.value as (
        this: HTMLCanvasElement,
        ...args: unknown[]
    ) => unknown;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value: function getContext(this: HTMLCanvasElement, kind: string, ...rest: unknown[]): unknown {
            return ['webgl', 'webgl2', 'experimental-webgl'].includes(kind) ? null : original.call(this, kind, ...rest);
        },
    });
}

/** The viewer's journeys: together they visit every state of `VIEWER_STATES`. */
const VIEWER_JOURNEYS: readonly Journey[] = [
    {
        title: 'Home, the keyboard, the menu and its toasts',
        id: 'home',
        boot: ({ page, lang }) => openViewer(page, { lang }),
        booted: async (tour) => {
            await expectFrame(tour, true);
            await expectMapboxControls(tour);
        },
        states: ['skip-link', 'home', 'menu-open', 'share-toast', 'locate-toast', 'language'],
    },
    {
        title: 'A historical year, the timeline and the Layers panel',
        id: 'year-layers',
        boot: ({ page, lang }) => openViewer(page, { lang, hash: '15/44.42700/26.08530&layers=e2e-1966' }),
        states: ['year', 'near-year-photos', 'timeline-step', 'layers', 'layers-peek', 'layers-full', 'layers-opacity'],
    },
    {
        title: 'A photo at every height, its lightbox, and the photo list',
        id: 'photo',
        boot: ({ page, lang }) => openViewer(page, { lang, hash: `18/44.42955/26.09560&photo=${PHOTO}` }),
        states: ['photo', 'photo-peek', 'photo-full', 'lightbox', 'photo-list'],
    },
    {
        title: 'A point of interest at every height, and About from top to end',
        id: 'poi-about',
        boot: ({ page, lang }) => openViewer(page, { lang, hash: '16/44.42680/26.08720' }),
        states: ['poi', 'poi-peek', 'poi-full', 'about', 'about-end'],
    },
    {
        title: 'Bucharest today: no layers yet and the consent banner',
        id: 'today',
        boot: async ({ page, lang }) => {
            await serveManifest(page, siteManifestData({ layers: false, analytics: true }));
            await openViewer(page, { lang });
        },
        booted: (tour) => expectFrame(tour, false),
        states: ['consent'],
    },
    {
        title: 'A toast',
        id: 'toast',
        boot: async ({ page, lang }) => {
            await page.goto(sitePath('bucharest', { lang, hash: '15/44.37000/25.97000&photo=no-such-photo' }));
            await waitForEngineEvent(page, 'hcm-ready');
        },
        states: ['toast'],
    },
    {
        title: 'Loading',
        id: 'loading',
        boot: openWithManifestHeld,
        states: ['loading'],
    },
];

/** The error journeys: each boots the viewer into one error (the console errors they cause are claimed by the test). */
const ERROR_JOURNEYS: readonly (Journey & { readonly consoleError: RegExp })[] = [
    {
        title: 'The error card: manifest not found',
        id: 'error-not-found',
        consoleError: /404/,
        boot: async ({ page, lang }) => {
            await page.route(BUCHAREST_MANIFEST, notFound);
            await page.goto(sitePath('bucharest', { lang }));
        },
        states: ['error-not-found'],
    },
    {
        title: 'The error card: the network failed',
        id: 'error-network',
        consoleError: /ERR_FAILED|net::/,
        boot: async ({ page, lang }) => {
            await page.route(BUCHAREST_MANIFEST, (route) => route.abort('failed'));
            await page.goto(sitePath('bucharest', { lang }));
        },
        states: ['error-network'],
    },
    {
        title: 'The error card: an invalid manifest',
        id: 'error-invalid',
        consoleError: /manifest|invalid/i,
        boot: async ({ page, lang }) => {
            const broken = siteManifestData();
            (broken['city'] as Record<string, unknown>)['zoom'] = 99;
            await serveManifest(page, broken);
            await page.goto(sitePath('bucharest', { lang }));
        },
        states: ['error-invalid'],
    },
    {
        title: 'No WebGL: the photo list instead of the map',
        id: 'no-webgl',
        consoleError: /WebGL|webgl/,
        boot: async ({ page, context, lang }) => {
            await context.addInitScript(withoutWebGl);
            await page.goto(sitePath('bucharest', { lang }));
        },
        states: ['no-webgl'],
    },
];

/** Every journey, by id: together they visit every state of `VIEWER_STATES` (checked as this module loads, below). */
const JOURNEYS: ReadonlyMap<string, Journey & { readonly consoleError?: RegExp }> = new Map(
    [...VIEWER_JOURNEYS, ...ERROR_JOURNEYS].map((entry) => [entry.id, entry]),
);

/** The states of the inventory that no journey visits: a tour that loads with one fails before it starts. */
function unvisitedStates(): ViewerStateId[] {
    const visited = new Set([...JOURNEYS.values()].flatMap((entry) => entry.states));
    return (Object.keys(VIEWER_STATES) as ViewerStateId[]).filter((id) => !visited.has(id));
}

const UNVISITED = unvisitedStates();
if (UNVISITED.length > 0) {
    throw new Error(`the tour's journeys never visit ${UNVISITED.join(', ')} (e2e/tour/states.ts)`);
}

/** The journey `id` (a tour test names it; an unknown id is a mistake in the tour file). */
export function journey(id: string): Journey & { readonly consoleError?: RegExp } {
    const found = JOURNEYS.get(id);
    if (found === undefined) {
        throw new Error(`no tour journey ${id}`);
    }
    return found;
}

/**
 * Boots the journey and visits its states in order, each through `expectStateSound` (the states that do not exist at
 * this window size are passed over); the checks are soft, so every state is reported.
 */
export async function expectJourneySound(tour: TourContext, journey: Journey): Promise<void> {
    await tour.context.addInitScript(recordLiveRegions);
    await journey.boot(tour);
    await journey.booted?.(tour);
    for (const id of journey.states) {
        const state = viewerState(id);
        if (state.exists?.(tour.page) !== false) {
            // The last state's Esc may still be closing a sheet (its frame stays inert until it is gone).
            await settleAnimations(tour.page);
            await state.enter(tour);
            await expectStateSound(tour.page, visitOf(state, tour));
        }
    }
}

/** The visit of `state` as e2e/support/state-check.ts runs it, for the page as the journey left it. */
function visitOf(state: ViewerState, tour: TourContext): StateVisit {
    const escape = state.escape?.(tour) ?? undefined;
    return {
        id: state.id,
        title: state.title,
        lang: state.shows?.(tour.lang) ?? tour.lang,
        announcements: state.announcements?.(tour.lang) ?? [],
        ...(escape === undefined ? {} : { escape }),
    };
}

/** The admin's states: each is visited by the spec named, which calls `expectStateSound` with the id `admin.<key>`. */
const ADMIN_STATES = {
    'sign-in': { title: 'Signed out: the sign-in panel and its consent note (start-up mode)', visit: 'journey.spec.ts, step 1' },
    'billing-no-account': { title: 'Setup, billing: no billing account yet, with the deep link', visit: 'journey.spec.ts, step 2' },
    'provision-partial': { title: 'Setup, provisioning: the doctor with a failed item and Retry', visit: 'journey.spec.ts, step 3' },
    'deploy-waiting': { title: "Setup, the server's installation: watching", visit: 'journey.spec.ts, step 4' },
    'mapbox-open': { title: 'Setup, Mapbox: the token box (normal mode, every destination)', visit: 'journey.spec.ts, step 4' },
    'mapbox-trial': { title: 'Setup, Mapbox: a demo account refused, with the alert', visit: 'journey.spec.ts, step 5' },
    'usgs-countdown': { title: 'Setup, USGS: the paste box and the 60 s countdown', visit: 'journey.spec.ts, step 6' },
    'usgs-pending': { title: "Setup, USGS: waiting for USGS's approval", visit: 'journey.spec.ts, step 6' },
    analytics: { title: 'Setup, analytics: detected, the stream setting and the crash reports', visit: 'journey.spec.ts, step 7' },
    'import-done': { title: 'Setup, the legacy import: done', visit: 'journey.spec.ts, step 8' },
    claim: { title: 'The claim panel: the map has no owner yet', visit: 'smoke.spec.ts, the owner' },
    'setup-billing': { title: 'Setup after the claim, open at billing (normal mode)', visit: 'smoke.spec.ts, the owner' },
    'account-menu': { title: 'The account menu (a dialog): language, theme, analytics, sign out', visit: 'smoke.spec.ts, the owner' },
    'unknown-route': { title: 'An unknown address: Setup with the "page not found" snackbar', visit: 'smoke.spec.ts, the owner' },
    blocked: { title: 'A stranger: the "not an admin" panel', visit: 'smoke.spec.ts, the stranger' },
    // The M2c editors (docs/research/M2c-interfaces.md §11.2, §12.2): one marked section per area, ids '<area>.<state>';
    // a workstream appends inside its own section only and never moves the markers.
    // [section common] owner: ops-screens (the editing kit: the unsaved guard, the conflict banner, offline, the map's states)
    // [end common]
    // [section photos] owner: photos
    'photos.empty': { title: 'Photos: none yet, with Add photos and the drop zone', visit: 'specs/photos/photos.spec.ts' },
    'photos.upload-refused': { title: 'Photos: a file refused before upload, with its reason', visit: 'specs/photos/photos.spec.ts' },
    'photos.list': {
        title: 'Photos: the list with its filters, search and rows (processing, refused, rights to check)',
        visit: 'specs/photos/photos.spec.ts',
    },
    'photos.bulk': { title: 'Photos: four selected, the bulk actions', visit: 'specs/photos/photos.spec.ts' },
    'photos.report': {
        title: 'Photos: the photos a bulk Publish skipped, each with its reason (a dialog)',
        visit: 'specs/photos/photos.spec.ts',
    },
    'photos.editor': {
        title: "Photos: a photo's editor (beside the list from 840 px, full screen on a phone)",
        visit: 'specs/photos/photos.spec.ts',
    },
    'photos.set-fields': { title: 'Photos: author, source and licence for the selection (a dialog)', visit: 'specs/photos/photos.spec.ts' },
    'photos.editor-invalid': {
        title: 'Photos: the editor with a field to correct, Save off and its reason',
        visit: 'specs/photos/photos.spec.ts',
    },
    'photos.delete-confirm': { title: 'Photos: the delete confirmation (a dialog)', visit: 'specs/photos/photos.spec.ts' },
    'photos.deleted-undo': { title: 'Photos: the photo deleted, the snackbar offering Undo', visit: 'specs/photos/photos.spec.ts' },
    // [end photos]
    // [section pois] owner: pois
    ...POIS_STATES,
    // [end pois]
    // [section layers] owner: layers-settings
    'layers.empty': { title: 'Layers: none yet, with Link a layer', visit: 'specs/layers/layers.spec.ts' },
    'layers.list': { title: 'Layers: the list, top first, with Move up/down', visit: 'specs/layers/layers.spec.ts' },
    'layers.link': { title: 'Layers: link an existing layer (a dialog)', visit: 'specs/layers/layers.spec.ts' },
    'layers.link-refused': { title: "Layers: another account's tileset refused", visit: 'specs/layers/layers.spec.ts' },
    'layers.editor': { title: "Layers: a layer's editor with its map", visit: 'specs/layers/layers.spec.ts' },
    'layers.adjusting': { title: 'Layers: image adjustments moved, levels met', visit: 'specs/layers/layers.spec.ts' },
    'layers.delete-confirm': { title: 'Layers: "Delete the layer?" (a dialog)', visit: 'specs/layers/layers.spec.ts' },
    // [end layers]
    // [section settings] owner: layers-settings
    'settings.sections': { title: 'Settings: the sections, none open', visit: 'specs/settings/settings.spec.ts' },
    'settings.area': { title: "Settings: the city's bounds and start view", visit: 'specs/settings/settings.spec.ts' },
    'settings.area-invalid': { title: 'Settings: bounds of no width, Save off', visit: 'specs/settings/settings.spec.ts' },
    'settings.area-refused': { title: 'Settings: bounds refused, what they leave out', visit: 'specs/settings/settings.spec.ts' },
    'settings.texts-link-refused': { title: 'Settings: a non-https link in About', visit: 'specs/settings/settings.spec.ts' },
    'settings.theme': { title: 'Settings: seed colour, presets, basemap', visit: 'specs/settings/settings.spec.ts' },
    'settings.theme-preview': { title: 'Settings: a seed colour previewed', visit: 'specs/settings/settings.spec.ts' },
    'settings.categories': { title: 'Settings: the place categories', visit: 'specs/settings/settings.spec.ts' },
    'settings.category-editor': { title: 'Settings: a category, its icon not bundled', visit: 'specs/settings/settings.spec.ts' },
    'settings.category-low-contrast': { title: 'Settings: an unreadable colour, a tone offered', visit: 'specs/settings/settings.spec.ts' },
    'settings.category-delete-move': { title: 'Settings: delete a category in use (a dialog)', visit: 'specs/settings/settings.spec.ts' },
    'settings.categories-limit': { title: 'Settings: fifty categories, Add off', visit: 'specs/settings/settings.spec.ts' },
    'settings.overlays': { title: 'Settings: the default opacities', visit: 'specs/settings/settings.spec.ts' },
    // [end settings]
    // [section ops] owner: ops-screens (admins, history, jobs, crash reports)
    'home.dashboard': {
        title: "Home: the city's counts, what waits, the services' chips and the public map",
        visit: 'specs/ops/ops.spec.ts, the dashboard',
    },
    'jobs.empty': { title: 'Jobs: none yet', visit: 'specs/ops/ops.spec.ts, jobs' },
    'jobs.list': { title: 'Jobs: the live list with its status chips', visit: 'specs/ops/ops.spec.ts, jobs' },
    'jobs.detail': {
        title: "Jobs: a running job's progress, steps and log (full screen on a phone)",
        visit: 'specs/ops/ops.spec.ts, jobs',
    },
    'jobs.cancel-confirm': { title: 'Jobs: "Cancel this job?" (a dialog)', visit: 'specs/ops/ops.spec.ts, jobs' },
    'history.recent': { title: "History: the city's recent changes with their filters", visit: 'specs/ops/ops.spec.ts, history' },
    'history.deleted': { title: 'History: the Deleted filter, each with Restore', visit: 'specs/ops/ops.spec.ts, history' },
    'history.revert-confirm': { title: 'History: "Restore what was deleted?" (a dialog)', visit: 'specs/ops/ops.spec.ts, history' },
    'history.document': {
        title: "History: a place's versions and the selected one's fields before and after",
        visit: 'specs/ops/ops.spec.ts, history',
    },
    'history.revert-refused': { title: 'History: a refused revert, with its reason as an alert', visit: 'specs/ops/ops.spec.ts, history' },
    'admins.list': { title: 'Admins: the admins and the pending invitations', visit: 'specs/ops/ops.spec.ts, admins' },
    'admins.detail': { title: "Admins: an admin's detail with Remove access", visit: 'specs/ops/ops.spec.ts, admins' },
    'admins.revoke-confirm': { title: 'Admins: "Remove access for …?" (a dialog)', visit: 'specs/ops/ops.spec.ts, admins' },
    'admins.invite': { title: 'Admins: the Invite dialog with an address refused at the field', visit: 'specs/ops/ops.spec.ts, admins' },
    'admins.invite-link': { title: 'Admins: the new invitation with its sign-in link and Copy', visit: 'specs/ops/ops.spec.ts, admins' },
    'crashes.empty': { title: 'Crash reports: none in the period', visit: 'specs/ops/ops.spec.ts, crash reports' },
    'crashes.list': { title: "Crash reports: a period's error groups", visit: 'specs/ops/ops.spec.ts, crash reports' },
    'crashes.detail': {
        title: "Crash reports: a group's counts, first and last seen, and the console link",
        visit: 'specs/ops/ops.spec.ts, crash reports',
    },
    'crashes.error': {
        title: 'Crash reports: Error Reporting disabled, with the way to Setup',
        visit: 'specs/ops/ops.spec.ts, crash reports',
    },
    // [end ops]
} as const;

export type AdminStateId = keyof typeof ADMIN_STATES;

/** The visit of an admin state, in the project's language. */
export function adminVisit(id: AdminStateId, lang: Locale, extra: Partial<StateVisit> = {}): StateVisit {
    return { id: `admin.${id}`, title: ADMIN_STATES[id].title, lang, ...extra };
}
