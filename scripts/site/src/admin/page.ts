import { element, renderDocument, type HtmlElement } from '../html.js';

/**
 * The admin's `index.html` (docs/research/M2b-interfaces.md §4, admin-e2e), generated like the city pages instead of
 * committed (`DECISIONS-for-review.md` §1, §12d). Firebase Hosting serves it from `packages/admin/dist` for every path
 * (the `**` rewrite) with the Content Security Policy as a header (`./csp.ts`), so the page holds no meta policy and
 * no inline code: the admin's stylesheet, then its bundle (`dist/admin.iife.js`, the build the bundle budget measures;
 * Mapbox GL stays the global `mapboxgl` when the georeferencer needs it, M3), which starts the admin in the page's
 * `<hcm-admin-shell>` and loads the kit's fonts from `fonts/` next to the page (`build.ts` copies them). Without
 * JavaScript a bilingual note explains that the admin needs it.
 */

/** The shell element the admin's entry starts in (`packages/admin/src/index.ts`, admin-shell). */
export const ADMIN_SHELL_ELEMENT = 'hcm-admin-shell';

/** The two files of the Vite build the page loads (packages/admin/vite.config.ts writes them into `dist/`). */
export const ADMIN_SCRIPT_FILE = 'admin.iife.js';
export const ADMIN_STYLESHEET_FILE = 'admin.css';

export interface AdminPageSpec {
    /** `<html lang>` until the admin resolves the language (`?lang=`, the stored choice, the browser). */
    readonly lang: 'ro' | 'en';
    readonly title: string;
    readonly description: string;
    /** The browser UI colour (`<meta name="theme-color">`). */
    readonly themeColor: string;
    /** Shown when JavaScript is off: one paragraph per language. */
    readonly noscript: { readonly ro: string; readonly en: string };
}

/** The admin page every city project deploys (Romanian is the default language). */
export const ADMIN_PAGE: AdminPageSpec = {
    lang: 'ro',
    title: 'Administrarea hărții',
    description: 'Administrarea hărții istorice: configurare, fotografii, straturi istorice.',
    themeColor: '#8B5E3C',
    noscript: {
        ro: 'Administrarea hărții are nevoie de JavaScript. Activează JavaScript în browser.',
        en: 'The map admin needs JavaScript. Turn JavaScript on in your browser.',
    },
};

function head(spec: AdminPageSpec): HtmlElement {
    return element('head', {}, [
        element('meta', { charset: 'utf-8' }),
        element('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }),
        // The admin is a tool, not content: search engines leave it out.
        element('meta', { name: 'robots', content: 'noindex, nofollow' }),
        element('meta', { name: 'description', content: spec.description }),
        element('meta', { name: 'color-scheme', content: 'light dark' }),
        element('meta', { name: 'theme-color', content: spec.themeColor }),
        element('title', {}, [spec.title]),
        element('link', { rel: 'icon', href: 'data:,' }),
        element('link', { rel: 'stylesheet', href: ADMIN_STYLESHEET_FILE }),
        element('script', { src: ADMIN_SCRIPT_FILE, defer: true }),
    ]);
}

function body(spec: AdminPageSpec): HtmlElement {
    return element('body', {}, [
        element(ADMIN_SHELL_ELEMENT),
        element('noscript', {}, [
            element('p', { lang: 'ro', class: 'admin-noscript' }, [spec.noscript.ro]),
            element('p', { lang: 'en', class: 'admin-noscript' }, [spec.noscript.en]),
        ]),
    ]);
}

/** The admin page's HTML. */
export function renderAdminPage(spec: AdminPageSpec = ADMIN_PAGE): string {
    return renderDocument(element('html', { lang: spec.lang }, [head(spec), body(spec)]));
}
