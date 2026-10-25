/**
 * `<hcm-account-menu>`: the account button of the top app bar (or of the rail's foot on a landscape phone) and its
 * dialog (`docs/research/M2b-interfaces.md` §1.2): who is signed in, the language (Romanian, English: switching keeps
 * every form's state), the theme (automatic, light, dark), the analytics consent (withdrawable at any time, when GA4 is
 * configured) and Sign out. A rotation of a phone moves it between the top bar and the rail: the shell then gives the
 * new one's button the focus the old one held (`active`, `focusButton`).
 */
import { translate, type Locale } from '@hcm/shared';
import { LitElement, css, html, type TemplateResult } from 'lit';

import type { SegmentOption } from '../../components/segmented-button.js';
import type { ThemeMode } from '../../theme/apply.js';
import type { AdminAppPort, AdminStatePort } from '../admin-port.js';
import { adminBase } from './admin-styles.js';
import { EMPTY } from './empty.js';
import { showsCityMenu } from './hcm-city-menu.js';
import { shellText } from './text.js';

export const HCM_ACCOUNT_MENU_TAG = 'hcm-account-menu';

const THEMES: readonly ThemeMode[] = ['system', 'light', 'dark'];

function languageOptions(locale: Locale): SegmentOption[] {
    return [
        { value: 'ro', label: translate(locale, 'language.ro') },
        { value: 'en', label: translate(locale, 'language.en') },
    ];
}

function themeOptions(locale: Locale): SegmentOption[] {
    return THEMES.map((mode) => ({ value: mode, label: translate(locale, `theme.${mode}`) }));
}

function isThemeMode(value: string): value is ThemeMode {
    return (THEMES as readonly string[]).includes(value);
}

export class HcmAccountMenu extends LitElement {
    static override readonly properties = {
        app: { attribute: false },
        state: { attribute: false },
        /** M5: the city switcher sits here (a compact window, or a phone held sideways: no top bar to hold it). */
        cities: { type: Boolean },
        open: { state: true },
    };

    static override readonly styles = [
        adminBase,
        css`
            :host {
                display: inline-flex;
            }

            .content {
                display: flex;
                flex-direction: column;
                gap: 20px;
            }

            .group {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .group-label,
            .who {
                font-size: var(--md-sys-typescale-body-medium-size, 0.875rem);
                color: var(--md-sys-color-on-surface-variant, CanvasText);
            }

            .consent {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
            }
        `,
    ];

    declare app: AdminAppPort | null;
    declare state: AdminStatePort | null;
    declare cities: boolean;
    declare open: boolean;

    constructor() {
        super();
        this.app = null;
        this.state = null;
        this.cities = false;
        this.open = false;
        this.addEventListener('hcm-city-chosen', () => {
            this.open = false;
        });
    }

    /** The dialog is open, or the focus is on the button or in the dialog. */
    get active(): boolean {
        return this.open || (this.shadowRoot?.activeElement ?? null) !== null;
    }

    /** Gives the account button the focus once it is drawn. */
    async focusButton(): Promise<void> {
        await this.updateComplete;
        const button = this.renderRoot.querySelector<HTMLElement & { updateComplete?: Promise<unknown> }>('hcm-icon-button');
        await button?.updateComplete;
        button?.focus();
    }

    override render(): TemplateResult {
        const state = this.state;
        if (state === null) {
            return EMPTY;
        }
        const locale = state.locale;
        const label = shellText(locale, 'adminShell.account.label');
        const show = (): void => {
            this.open = true;
            // A phone's city list is here: opening asks for the admin's cities again, as the bar's menu does (S-A49-HAPPY).
            if (this.cities) {
                void this.app?.intents.refreshCities?.();
            }
        };
        const hide = (): void => {
            this.open = false;
        };
        return html`<hcm-icon-button icon="account_circle" .label=${label} aria-haspopup="dialog" @click=${show}></hcm-icon-button>
            <hcm-dialog
                .open=${this.open}
                .headline=${label}
                .closeLabel=${shellText(locale, 'adminShell.account.close')}
                @hcm-close=${hide}
            >
                <div class="content">
                    ${this.#who(state)} ${this.#city(state)} ${this.#language(state)} ${this.#theme(state)} ${this.#consent(state)}
                    ${this.#signOut(state)}
                </div>
            </hcm-dialog>`;
    }

    #who(state: AdminStatePort): TemplateResult {
        const email = state.user?.email ?? null;
        return email === null ? EMPTY : html`<p class="who">${shellText(state.locale, 'adminShell.auth.signedInAs', { email })}</p>`;
    }

    /** M5: the city switcher, when the shell puts it here (`cities`). */
    #city(state: AdminStatePort): TemplateResult {
        return this.cities && showsCityMenu(state) ? html`<hcm-city-menu inline .app=${this.app} .state=${state}></hcm-city-menu>` : EMPTY;
    }

    #language(state: AdminStatePort): TemplateResult {
        const label = translate(state.locale, 'language.label');
        const change = (event: CustomEvent<{ readonly value: string }>): void => {
            this.app?.intents.setLocale(event.detail.value === 'en' ? 'en' : 'ro');
        };
        return html`<div class="group">
            <span class="group-label">${label}</span>
            <hcm-segmented-button
                .label=${label}
                .options=${languageOptions(state.locale)}
                .value=${state.locale}
                @hcm-change=${change}
            ></hcm-segmented-button>
        </div>`;
    }

    #theme(state: AdminStatePort): TemplateResult {
        const label = translate(state.locale, 'theme.label');
        const change = (event: CustomEvent<{ readonly value: string }>): void => {
            const mode = event.detail.value;
            if (isThemeMode(mode)) {
                this.app?.intents.setTheme(mode);
            }
        };
        return html`<div class="group">
            <span class="group-label">${label}</span>
            <hcm-segmented-button
                .label=${label}
                .options=${themeOptions(state.locale)}
                .value=${state.theme.mode}
                @hcm-change=${change}
            ></hcm-segmented-button>
        </div>`;
    }

    /** The analytics consent, shown only when GA4 is configured. */
    #consent(state: AdminStatePort): TemplateResult {
        if (!state.analytics) {
            return EMPTY;
        }
        const label = shellText(state.locale, 'adminShell.account.analytics');
        const change = (event: CustomEvent<{ readonly checked: boolean }>): void => {
            this.app?.intents.setConsent(event.detail.checked ? 'granted' : 'denied');
        };
        return html`<div class="consent">
            <span>${label}</span>
            <hcm-switch .label=${label} .checked=${state.consent === 'granted'} @hcm-change=${change}></hcm-switch>
        </div>`;
    }

    #signOut(state: AdminStatePort): TemplateResult {
        if (state.user === null) {
            return EMPTY;
        }
        const signOut = (): void => {
            this.open = false;
            void this.app?.intents.signOut();
        };
        return html`<hcm-button variant="tonal" icon="logout" @click=${signOut}
            >${shellText(state.locale, 'adminShell.auth.signOut')}</hcm-button
        >`;
    }
}

/** Registers `<hcm-account-menu>` once; calling it again is a no-op. */
export function defineHcmAccountMenu(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_ACCOUNT_MENU_TAG) === undefined) {
        registry.define(HCM_ACCOUNT_MENU_TAG, HcmAccountMenu);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-account-menu': HcmAccountMenu;
    }
}
