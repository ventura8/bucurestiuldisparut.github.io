import { element, renderDocument, type HtmlElement } from './html.js';
import type { SiteSpec } from './site-spec.js';

/**
 * The `index.html` of a static city site (docs/ENGINE_API.md → The three files of a city), generated at build time
 * instead of committed: html-validate's recommended rules and Prettier disagree on committed HTML until the
 * `.htmlvalidate.json` proposal is approved (docs/research/DECISIONS-for-review.md §1, change request CR-3).
 *
 * The page holds no inline script or style: the meta CSP comes first, then Mapbox GL JS from api.mapbox.com (pinned,
 * with Subresource Integrity), the site's `config.js`, and the engine from the same origin as an ES module, which
 * boots from `window.HistoricCityMapConfig` into `#historic-city-map`. Without JavaScript a bilingual note explains
 * that the map needs it. The body is one `main` landmark headed by the site's title (a level-one heading, visually
 * hidden: the map fills the window), so everything the viewer draws (the timeline, toasts, the menu, the legal bar)
 * is inside a landmark (axe's `landmark-one-main`, `page-has-heading-one` and `region`, the tour).
 */

/** The Mapbox GL JS release the engine is written against (packages/engine `MAPBOX_GL_VERSION`). */
export const MAPBOX_GL_VERSION = '3.32.0';

export const MAPBOX_GL_SCRIPT = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.js`;
export const MAPBOX_GL_STYLESHEET = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.css`;

/** Where the build copies the engine (`packages/engine/dist`), relative to the page, and the two files the page loads. */
export const ENGINE_FOLDER = 'engine';
export const ENGINE_MODULE_FILE = 'engine.mjs';
export const ENGINE_STYLESHEET_FILE = 'engine.css';

/** The engine's default mount point (`DEFAULT_CONTAINER_SELECTOR` of @hcm/shared). */
const CONTAINER_ID = 'historic-city-map';

/** engine.css: text for screen readers only (the page's heading over the full-window map). */
const VISUALLY_HIDDEN_CLASS = 'hcm-visually-hidden';

/**
 * Where the page finds its files: relative to the page by default (a city site served from any folder), absolute for
 * the Hosting site's generic city page, which every city's address is rewritten to (`/iasi/` serves
 * `/city/index.html`, so a relative `config.js` would be `/iasi/config.js`: docs/research/M6-interfaces.md §2.4).
 */
export interface PageAssets {
    /** The engine's folder, ending with `/` (`engine/`, `/engine/`). */
    readonly engineFolder: string;
    readonly config: string;
    readonly stylesheet: string;
    /**
     * M6: a script that runs first, before Mapbox GL and the engine load (`admin-redirect.js` of the Hosting site's root:
     * an old admin address `/#/<route>` goes to `/admin/`, §2.7). None by default.
     */
    readonly redirect?: string;
}

/** A city site's own files, next to its page. */
export const RELATIVE_ASSETS: PageAssets = { engineFolder: `${ENGINE_FOLDER}/`, config: 'config.js', stylesheet: 'site.css' };

export interface PageInputs {
    readonly spec: SiteSpec;
    /** The `content` of the meta CSP (`contentSecurityPolicy`). */
    readonly csp: string;
    /** `sha384-…` of the pinned mapbox-gl.js and mapbox-gl.css (`subresourceIntegrity`). */
    readonly mapboxGlIntegrity: { readonly script: string; readonly stylesheet: string };
    /** Where the page's files are; `RELATIVE_ASSETS` by default. */
    readonly assets?: PageAssets;
}

function crossOrigin(integrity: string): Readonly<Record<string, string>> {
    return { integrity, crossorigin: 'anonymous' };
}

/** The first script of the page, before anything else loads (a blocking classic script: it may leave the page). */
function redirectScript(assets: PageAssets): HtmlElement[] {
    return assets.redirect === undefined ? [] : [element('script', { src: assets.redirect })];
}

function head(inputs: PageInputs): HtmlElement {
    const { spec, csp, mapboxGlIntegrity } = inputs;
    const assets = inputs.assets ?? RELATIVE_ASSETS;
    return element('head', {}, [
        element('meta', { charset: 'utf-8' }),
        // First, so that it governs every resource below it.
        element('meta', { 'http-equiv': 'Content-Security-Policy', content: csp }),
        // The Mapbox public token is URL-restricted to the site's origin, so requests must carry it.
        element('meta', { name: 'referrer', content: 'strict-origin-when-cross-origin' }),
        element('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }),
        element('meta', { name: 'description', content: spec.description }),
        element('meta', { name: 'color-scheme', content: 'light dark' }),
        element('meta', { name: 'theme-color', content: spec.themeColor }),
        element('title', {}, [spec.title]),
        element('link', { rel: 'icon', href: 'data:,' }),
        ...redirectScript(assets),
        element('link', { rel: 'stylesheet', href: MAPBOX_GL_STYLESHEET, ...crossOrigin(mapboxGlIntegrity.stylesheet) }),
        element('link', { rel: 'stylesheet', href: `${assets.engineFolder}${ENGINE_STYLESHEET_FILE}` }),
        element('link', { rel: 'stylesheet', href: assets.stylesheet }),
        element('script', { src: MAPBOX_GL_SCRIPT, defer: true, ...crossOrigin(mapboxGlIntegrity.script) }),
        element('script', { src: assets.config, defer: true }),
        // Module scripts run after the deferred classic scripts above, in document order.
        element('script', { type: 'module', src: `${assets.engineFolder}${ENGINE_MODULE_FILE}` }),
    ]);
}

function body(spec: SiteSpec): HtmlElement {
    return element('body', {}, [
        element('main', {}, [
            // In the site's language, also once the visitor switches the viewer to the other one.
            element('h1', { class: VISUALLY_HIDDEN_CLASS, lang: spec.lang }, [spec.title]),
            element('div', { id: CONTAINER_ID }),
            element('noscript', {}, [
                element('p', { lang: 'ro', class: 'site-noscript' }, [spec.noscript.ro]),
                element('p', { lang: 'en', class: 'site-noscript' }, [spec.noscript.en]),
            ]),
        ]),
    ]);
}

/** The page's HTML. */
export function renderSitePage(inputs: PageInputs): string {
    return renderDocument(element('html', { lang: inputs.spec.lang }, [head(inputs), body(inputs.spec)]));
}
