/**
 * `<hcm-admin-shell>`: the admin's root element (`docs/research/M2b-interfaces.md` §1.2, §1.3). It renders the app it is
 * given (`app`, an `AdminAppPort`), one screen per auth state: a loading indicator, the sign-in, claim or join panel, a
 * blocked panel, or the shell itself: the navigation for the window class (bar on compact, collapsed rail from medium
 * and on a landscape phone, expanded rail from large), the top app bar with the page title and the account button, the
 * start-up banner, the page, the analytics consent banner. Messages show in the snackbar. Every screen's content is in
 * a landmark: a panel, the loading indicator, the start-up banner, the page and the snackbar are in `<main>`, beside the
 * navigation and the top app bar (`banner`); only the page scrolls, and the snackbar takes its own place below it
 * (shell-styles.ts). It applies the city's theme (or a live preview, or the kit's baseline) to itself and keeps
 * `<html lang>` on the admin's language. An editor page asks for its full-screen editor on a compact window or a
 * landscape phone (`hcm-chrome` `{chrome: 'editor'}`, `docs/research/M2c-interfaces.md` §1.3): the navigation bar (or
 * the landscape rail) hides while it shows, for that page only. A notice with an action (an editor's Undo) shows it in
 * the snackbar.
 */
import { DEFAULT_LOCALE, translate, type AdminShellKey, type Locale, type ThemeTokens } from '@hcm/shared';
import { LitElement, html, type TemplateResult } from 'lit';

import type { ConsentDecision } from '../../components/consent-banner.js';
import { WindowClassController, type WindowSize } from '../../layout/window-class.js';
import { applyTheme, type ThemeMode } from '../../theme/apply.js';
import { BASELINE_THEME } from '../../theme/baseline.js';
import type { WindowClass } from '../../theme/tokens.js';
import type { AdminAppPort, AdminAuthStatePort, AdminRouteIdPort, AdminStatePort } from '../admin-port.js';
import type { PageChrome } from '../editing/hcm-list-detail.js';
import { EMPTY } from './empty.js';
import type { HcmAccountMenu } from './hcm-account-menu.js';
import { contentText, noticeOf, shellText } from './text.js';
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

/** The open page's name: its navigation label (the top bar's title, or the hidden heading without a top bar). */
function pageName(state: AdminStatePort): string {
    const key: AdminShellKey = `adminShell.nav.${state.route.id}`;
    return shellText(state.locale, key);
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
    /** The chrome the current page asked for, and for which route (a page that is gone cannot ask back). */
    #chrome: { readonly chrome: PageChrome; readonly route: AdminRouteIdPort } | null = null;
    /**
     * The account menu was open or held the focus before this update. A phone's rotation moves the menu between the top
     * bar and the rail's foot: the old one goes with its dialog, and the focus would fall to the page's body, so the new
     * one's button takes it (the hardening review's follow-up; S-A29-BAD-ROTATE-MENU-OPEN).
     */
    #accountWasActive = false;

    constructor() {
        super();
        this.app = null;
        this.state = null;
        this.addEventListener('hcm-chrome', (event) => {
            this.#setChrome((event as CustomEvent<{ readonly chrome: PageChrome }>).detail.chrome);
        });
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
        this.#accountWasActive = this.#accountMenu()?.active ?? false;
    }

    protected override updated(): void {
        const state = this.state;
        if (state !== null) {
            this.#applyTheme(state);
            // The page's language and its tab's title follow the admin's (the static page is Romanian).
            this.ownerDocument.documentElement.lang = state.locale;
            this.ownerDocument.title = shellText(state.locale, 'adminShell.appName');
        }
        this.#keepAccountFocus();
    }

    #accountMenu(): HcmAccountMenu | null {
        return this.renderRoot.querySelector('hcm-account-menu');
    }

    /** The account menu moved (a rotation) while it was in use: its new button takes the focus. */
    #keepAccountFocus(): void {
        const menu = this.#accountMenu();
        if (this.#accountWasActive && menu !== null && !menu.active) {
            void menu.focusButton();
        }
        this.#accountWasActive = false;
    }

    override render(): TemplateResult {
        const state = this.state;
        if (state === null) {
            return html`<main class="screen">${this.#loading(shellText(DEFAULT_LOCALE, 'adminShell.loading'))}</main>`;
        }
        const screen = SCREENS[state.auth];
        return screen === 'shell'
            ? this.#frame(state)
            : html`<main class="screen">${this.#panel(screen, state)} ${this.#snackbar(state)}</main>`;
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

    #setChrome(chrome: PageChrome): void {
        const route = this.state?.route.id;
        if (route !== undefined) {
            this.#chrome = { chrome, route };
            this.requestUpdate();
        }
    }

    /** The full-screen editor hides the compact bar, or the landscape phone's rail. */
    #hidesNav(state: AdminStatePort, layout: ShellLayout): boolean {
        const editor = this.#chrome?.chrome === 'editor' && this.#chrome.route === state.route.id;
        return editor && (layout.nav === 'bar' || !layout.topBar);
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

    /** The navigation for the layout, or nothing while a compact full-screen editor shows. */
    #nav(state: AdminStatePort, layout: ShellLayout): TemplateResult {
        if (this.#hidesNav(state, layout)) {
            return EMPTY;
        }
        return html`<hcm-admin-nav
            .destinations=${state.destinations}
            .current=${state.route.id}
            .variant=${layout.nav}
            .locale=${state.locale}
            data-layout-check="nav"
        >
            ${layout.topBar ? EMPTY : html`<hcm-account-menu slot="foot" .app=${this.app} .state=${state}></hcm-account-menu>`}
        </hcm-admin-nav>`;
    }

    #frame(state: AdminStatePort): TemplateResult {
        const layout = shellLayout(this.#size.size);
        const shown = this.#nav(state, layout);
        return html`<div class="frame" data-nav=${this.#hidesNav(state, layout) ? 'none' : layout.nav}>
                ${layout.nav === 'bar' ? EMPTY : shown}
                <div class="column">
                    ${layout.topBar ? this.#topBar(state) : EMPTY}
                    <main class="content">
                        ${this.#pageTitle(state, layout)}
                        <div class="scroller">
                            ${this.#revoked(state)}${this.#banner(state)}<hcm-page-outlet
                                .app=${this.app}
                                .state=${state}
                            ></hcm-page-outlet>
                        </div>
                        ${this.#snackbar(state)}
                    </main>
                    ${this.#consent(state)}
                </div>
                ${layout.nav === 'bar' ? shown : EMPTY}
            </div>
            ${this.#leaving(state)}`;
    }

    #topBar(state: AdminStatePort): TemplateResult {
        return html`<header class="top-bar">
            <h1>${pageName(state)}</h1>
            <hcm-account-menu .app=${this.app} .state=${state}></hcm-account-menu>
        </header>`;
    }

    /**
     * A phone held sideways has no top bar (its height goes to the page): the page's title stays its one level-one heading
     * for assistive technology, out of sight, in `<main>` (axe's `page-has-heading-one` and `region`).
     */
    #pageTitle(state: AdminStatePort, layout: ShellLayout): TemplateResult {
        return layout.topBar ? EMPTY : html`<h1 class="visually-hidden">${pageName(state)}</h1>`;
    }

    /** The access was removed while editing: the page stays, read-only, under this until the admin signs out (§35e). */
    #revoked(state: AdminStatePort): TemplateResult {
        if (state.revoked !== true) {
            return EMPTY;
        }
        const signOut = (): void => {
            void this.app?.intents.signOut();
        };
        return html`<div class="banner revoked" role="alert">
            <p>${shellText(state.locale, 'adminShell.session.revoked')}</p>
            <hcm-button variant="tonal" icon="logout" @click=${signOut}>${shellText(state.locale, 'adminShell.auth.signOut')}</hcm-button>
        </div>`;
    }

    #banner(state: AdminStatePort): TemplateResult {
        return state.auth === 'bootstrap'
            ? html`<p class="banner" role="note">${shellText(state.locale, 'adminShell.bootstrap.banner')}</p>`
            : EMPTY;
    }

    /** "Discard your changes?" before leaving an edit that is not saved (Keep editing has the focus). */
    #leaving(state: AdminStatePort): TemplateResult {
        const keep = (): void => {
            this.app?.intents.stayOnPage();
        };
        const leave = (): void => {
            void this.app?.intents.leavePage();
        };
        return html`<hcm-confirm-dialog
            destructive
            .open=${(state.leaving ?? null) !== null}
            .headline=${contentText(state.locale, 'adminContent.common.unsavedTitle')}
            .body=${contentText(state.locale, 'adminContent.common.unsavedBody')}
            .confirmLabel=${contentText(state.locale, 'adminContent.common.discard')}
            .cancelLabel=${contentText(state.locale, 'adminContent.common.keepEditing')}
            .closeLabel=${contentText(state.locale, 'adminContent.common.close')}
            @hcm-confirm=${leave}
            @hcm-cancel=${keep}
        ></hcm-confirm-dialog>`;
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
        const action = state.notice?.action;
        const act = (): void => {
            action?.run();
        };
        return html`<hcm-snackbar
            data-layout-check="snackbar"
            .message=${noticeOf(state.locale, state.notice)}
            .actionLabel=${action === undefined ? '' : contentText(state.locale, action.key)}
            .closeLabel=${shellText(state.locale, 'adminShell.notice.close')}
            .timeoutMs=${action === undefined ? 8000 : 10_000}
            @hcm-action=${act}
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
