/**
 * `<hcm-page-outlet>`: where the shell shows the current route's page (`docs/research/M2b-interfaces.md` §1.1). The page
 * registry of the app names the page's element once its module is loaded (`app.loadPage`); the outlet creates it and
 * sets `app` and `state` on it at every change. A route without a page (Setup before setup-ui's page is wired, a page
 * whose module failed to load) shows a short note instead of an empty screen.
 */
import { LitElement, css, html, type TemplateResult } from 'lit';

import type { AdminAppPort, AdminPageElement, AdminRouteIdPort, AdminStatePort } from '../admin-port.js';
import { adminBase } from './admin-styles.js';
import { shellText } from './text.js';

export const HCM_PAGE_OUTLET_TAG = 'hcm-page-outlet';

type Loaded = { readonly route: AdminRouteIdPort; readonly page: AdminPageElement | null } | null;

export class HcmPageOutlet extends LitElement {
    static override readonly properties = {
        app: { attribute: false },
        state: { attribute: false },
        loaded: { state: true },
    };

    static override readonly styles = [
        adminBase,
        css`
            :host {
                display: block;
            }

            .note {
                padding: 24px;
                color: var(--md-sys-color-on-surface-variant, CanvasText);
            }
        `,
    ];

    declare app: AdminAppPort | null;
    declare state: AdminStatePort | null;
    declare loaded: Loaded;
    /** The route being loaded, so a slower earlier load never replaces a later one. */
    #loading: AdminRouteIdPort | null = null;

    constructor() {
        super();
        this.app = null;
        this.state = null;
        this.loaded = null;
    }

    protected override willUpdate(): void {
        const route = this.state === null ? null : this.state.route.id;
        if (route !== null && route !== this.#loading) {
            void this.#load(route);
        }
        const page = this.#page();
        if (page !== null) {
            page.app = this.app;
            page.state = this.state;
        }
    }

    override render(): TemplateResult {
        const page = this.#page();
        if (page !== null) {
            return html`${page}`;
        }
        const key = this.loaded === null ? 'adminShell.loading' : 'adminShell.page.unavailable';
        return html`<p class="note" role="status">${this.state === null ? '' : shellText(this.state.locale, key)}</p>`;
    }

    /** The loaded page of the current route, or null. */
    #page(): AdminPageElement | null {
        const loaded = this.loaded;
        return loaded !== null && loaded.route === this.state?.route.id ? loaded.page : null;
    }

    async #load(route: AdminRouteIdPort): Promise<void> {
        const app = this.app;
        if (app === null) {
            return;
        }
        this.#loading = route;
        this.loaded = null;
        const tag = await app.loadPage(route);
        if (this.#loading !== route) {
            return;
        }
        const page = tag === null ? null : (this.ownerDocument.createElement(tag) as AdminPageElement);
        if (page !== null) {
            page.app = app;
            page.state = this.state;
        }
        this.loaded = { route, page };
    }
}

/** Registers `<hcm-page-outlet>` once; calling it again is a no-op. */
export function defineHcmPageOutlet(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_PAGE_OUTLET_TAG) === undefined) {
        registry.define(HCM_PAGE_OUTLET_TAG, HcmPageOutlet);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-page-outlet': HcmPageOutlet;
    }
}
