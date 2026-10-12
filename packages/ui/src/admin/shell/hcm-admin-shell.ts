/**
 * `<hcm-admin-shell>`: the admin's root element (`docs/research/M2b-interfaces.md` §1.2, §1.3). It renders the app it is
 * given (`app`, an `AdminAppPort`), one screen per auth state: a loading indicator, the sign-in, claim or join panel, a
 * blocked panel, or the shell itself: the navigation for the window class (bar on compact, collapsed rail from medium
 * and on a landscape phone, expanded rail from large), the top app bar with the page title and the account button, the
 * start-up banner, the page, the analytics consent banner. Messages show in the snackbar. It applies the city's theme
 * (or a live preview, or the kit's baseline) to itself and keeps `<html lang>` on the admin's language.
 */
import { DEFAULT_LOCALE, translate, type AdminShellKey, type Locale, type ThemeTokens } from '@hcm/shared';
import { LitElement, html, type TemplateResult } from 'lit';

import type { ConsentDecision } from '../../components/consent-banner.js';
import { WindowClassController, type WindowSize } from '../../layout/window-class.js';
import { applyTheme, type ThemeMode } from '../../theme/apply.js';
import { BASELINE_THEME } from '../../theme/baseline.js';
import type { WindowClass } from '../../theme/tokens.js';
import type { AdminAppPort, AdminAuthStatePort, AdminStatePort } from '../admin-port.js';
import { EMPTY } from './empty.js';
import { noticeOf, shellText } from './text.js';
import type { AdminNavVariant } from './hcm-admin-nav.js';
import { shellStyles } from './shell-styles.js';

export const HCM_ADMIN_SHELL_TAG = 'hcm-admin-shell';

/** How the shell lays out a window: its navigation, and whether it has a top app bar. */
export interface ShellLayout {
    readonly nav: AdminNavVariant;
    readonly topBar: boolean;
}

const NAV_BY_WIDTH: Readonly<Record<WindowClass, AdminNavVariant>> = {
    compact: 'bar',
    medium: 'rail',
    expanded: 'rail',
    large: 'expanded',
    'extra-large': 'expanded',
};

/** §1.2: a landscape phone (compact height) gets the rail and no top bar; otherwise the width decides. */
export function shellLayout(size: Pick<WindowSize, 'widthClass' | 'heightClass'>): ShellLayout {
    return size.heightClass === 'compact' ? { nav: 'rail', topBar: false } : { nav: NAV_BY_WIDTH[size.widthClass], topBar: true };
}

type Screen = 'loading' | 'signIn' | 'claim' | 'join' | 'blocked' | 'shell';

const SCREENS: Readonly<Record<AdminAuthStatePort, Screen>> = {
    starting: 'loading',
    probing: 'loading',
    signingIn: 'loading',
    claiming: 'loading',
    signedOut: 'signIn',
    claimPending: 'claim',
    joinPending: 'join',
    configMissing: 'blocked',
    notOwner: 'blocked',
    notAdmin: 'blocked',
    backendDown: 'blocked',
    bootstrap: 'shell',
    admin: 'shell',
};

/** What the loading indicator says the admin waits for (anything else: "Loading"). */
const LOADING_TEXTS: Readonly<Partial<Record<AdminAuthStatePort, AdminShellKey>>> = {
    signingIn: 'adminShell.auth.signingIn',
    claiming: 'adminShell.auth.claiming',
};

function loadingText(state: AdminStatePort): string {
    return shellText(state.locale, LOADING_TEXTS[state.auth] ?? 'adminShell.loading');
}

/** The theme shown: Settings' live preview, else the city's, else the kit's baseline. */
export function themeTokensOf(state: AdminStatePort): ThemeTokens {
    return state.theme.preview ?? state.theme.city ?? BASELINE_THEME;
}

export class HcmAdminShell extends LitElement {
    static override readonly properties = {
        app: { attribute: false },
        state: { state: true },
    };

    static override readonly styles = shellStyles;

    declare app: AdminAppPort | null;
    declare state: AdminStatePort | null;
    readonly #size = new WindowClassController(this, {
        onChange: (size) => {
            this.app?.intents.setWindowClass(size.widthClass);
        },
    });
    #subscribed: { readonly app: AdminAppPort; readonly stop: () => void } | null = null;
    #theme: { readonly tokens: ThemeTokens; readonly mode: ThemeMode } | null = null;

    constructor() {
        super();
        this.app = null;
        this.state = null;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.#follow();
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#stop();
    }

    protected override willUpdate(): void {
        this.#follow();
    }

    protected override updated(): void {
        const state = this.state;
        if (state !== null) {
            this.#applyTheme(state);
            this.ownerDocument.documentElement.lang = state.locale;
        }
    }

    override render(): TemplateResult {
        const state = this.state;
        if (state === null) {
            return this.#loading(shellText(DEFAULT_LOCALE, 'adminShell.loading'));
        }
        const screen = SCREENS[state.auth];
        const content = screen === 'shell' ? this.#frame(state) : this.#panel(screen, state);
        return html`${content} ${screen === 'shell' ? EMPTY : this.#snackbar(state)}`;
    }

    /** Subscribes to the current app (once per app, while connected). */
    #follow(): void {
        const app = this.app;
        if (app === null || !this.isConnected || this.#subscribed?.app === app) {
            return;
        }
        this.#stop();
        const stop = app.subscribe((state) => {
            this.state = state;
        });
        this.#subscribed = { app, stop };
        this.state = app.state;
        app.intents.setWindowClass(this.#size.size.widthClass);
    }

    #stop(): void {
        this.#subscribed?.stop();
        this.#subscribed = null;
    }

    #applyTheme(state: AdminStatePort): void {
        const theme = { tokens: themeTokensOf(state), mode: state.theme.mode };
        const last = this.#theme;
        if (last?.tokens !== theme.tokens || last.mode !== theme.mode) {
            this.#theme = theme;
            applyTheme(this, theme.tokens, theme.mode, false);
        }
    }

    #loading(text: string): TemplateResult {
        return html`<div class="loading" role="status">
            <hcm-loading-indicator .label=${text}></hcm-loading-indicator>
            <p>${text}</p>
        </div>`;
    }

    #panel(screen: Exclude<Screen, 'shell'>, state: AdminStatePort): TemplateResult {
        const app = this.app;
        const panels: Readonly<Record<Exclude<Screen, 'shell'>, () => TemplateResult>> = {
            loading: () => this.#loading(loadingText(state)),
            signIn: () => html`<hcm-sign-in .app=${app} .state=${state}></hcm-sign-in>`,
            claim: () => html`<hcm-claim-panel .app=${app} .state=${state}></hcm-claim-panel>`,
            join: () => html`<hcm-join-panel .app=${app} .state=${state}></hcm-join-panel>`,
            blocked: () => html`<hcm-blocked-panel .app=${app} .state=${state}></hcm-blocked-panel>`,
        };
        return panels[screen]();
    }

    #frame(state: AdminStatePort): TemplateResult {
        const layout = shellLayout(this.#size.size);
        const nav = html`<hcm-admin-nav
            .destinations=${state.destinations}
            .current=${state.route.id}
            .variant=${layout.nav}
            .locale=${state.locale}
            data-layout-check="nav"
        >
            ${layout.topBar ? EMPTY : html`<hcm-account-menu slot="foot" .app=${this.app} .state=${state}></hcm-account-menu>`}
        </hcm-admin-nav>`;
        return html`<div class="frame" data-nav=${layout.nav}>
            ${layout.nav === 'bar' ? EMPTY : nav}
            <div class="column">
                ${layout.topBar ? this.#topBar(state) : EMPTY} ${this.#banner(state)}
                <main class="content"><hcm-page-outlet .app=${this.app} .state=${state}></hcm-page-outlet></main>
                ${this.#consent(state)}
            </div>
            ${layout.nav === 'bar' ? nav : EMPTY} ${this.#snackbar(state)}
        </div>`;
    }

    #topBar(state: AdminStatePort): TemplateResult {
        return html`<header class="top-bar">
            <h1>${shellText(state.locale, `adminShell.nav.${state.route.id}`)}</h1>
            <hcm-account-menu .app=${this.app} .state=${state}></hcm-account-menu>
        </header>`;
    }

    #banner(state: AdminStatePort): TemplateResult {
        return state.auth === 'bootstrap'
            ? html`<p class="banner" role="note">${shellText(state.locale, 'adminShell.bootstrap.banner')}</p>`
            : EMPTY;
    }

    /** The analytics consent banner, while GA4 is configured and the admin has not answered. */
    #consent(state: AdminStatePort): TemplateResult {
        if (!state.analytics || state.consent !== 'unknown') {
            return EMPTY;
        }
        const locale: Locale = state.locale;
        const decide = (event: CustomEvent<{ readonly decision: ConsentDecision }>): void => {
            this.app?.intents.setConsent(event.detail.decision);
        };
        return html`<hcm-consent-banner
            data-layout-check="consent"
            .headline=${translate(locale, 'consent.title')}
            .body=${translate(locale, 'consent.body')}
            .acceptLabel=${translate(locale, 'consent.accept')}
            .declineLabel=${translate(locale, 'consent.decline')}
            @hcm-consent=${decide}
        ></hcm-consent-banner>`;
    }

    #snackbar(state: AdminStatePort): TemplateResult {
        const dismiss = (): void => {
            this.app?.intents.dismissNotice();
        };
        return html`<hcm-snackbar
            data-layout-check="snackbar"
            .message=${noticeOf(state.locale, state.notice)}
            .closeLabel=${shellText(state.locale, 'adminShell.notice.close')}
            .timeoutMs=${8000}
            @hcm-dismiss=${dismiss}
        ></hcm-snackbar>`;
    }
}

/** Registers `<hcm-admin-shell>` once; calling it again is a no-op. */
export function defineHcmAdminShell(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_ADMIN_SHELL_TAG) === undefined) {
        registry.define(HCM_ADMIN_SHELL_TAG, HcmAdminShell);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-admin-shell': HcmAdminShell;
    }
}
