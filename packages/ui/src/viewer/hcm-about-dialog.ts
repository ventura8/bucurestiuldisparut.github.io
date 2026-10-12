/**
 * `<hcm-about-dialog>`: About, credits and the privacy notice of the city (scenario V13), the language and theme
 * choices (V11, V12), the engine version and the analytics consent with its withdrawal (V19), in the ui-kit's
 * `<hcm-dialog>` (full screen on compact). The About and privacy texts are the Markdown subset walked into DOM nodes;
 * empty credits hide their section (S-V13-BAD-EMPTY-CREDITS). The dialog sits in the browser's top layer, over the
 * map's own logo and attribution, so its foot shows them (`<hcm-map-attribution>`, V18) whenever the map is there.
 *
 * Events (viewer-internal): `hcm-locale-change` (`{locale}`), `hcm-theme-change` (`{theme}`), and `hcm-consent`
 * (`{decision: 'denied'}`, the kit banner's event) when the visitor withdraws consent.
 */
import { DEFAULT_LOCALE, LOCALES, resolveLocale, translate, type City, type Credit, type Locale } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import type { AttributionPart } from './attribution.js';
import { EMPTY } from './empty.js';
import { externalLink, renderMarkdown } from './markdown.js';
import { baseStyles, detailStyles } from './shared-styles.js';
import type { ConsentState, ThemeMode } from './store-port.js';

export const HCM_ABOUT_DIALOG_TAG = 'hcm-about-dialog';

const THEMES: readonly ThemeMode[] = ['system', 'light', 'dark'];

/** A credit line: a link when the credit names a page. */
function creditText(credit: Credit, locale: Locale): TemplateResult | string {
    return credit.url === undefined ? credit.label[locale] : externalLink(credit.url, credit.label[locale]);
}

const THEME_ICONS: Readonly<Record<ThemeMode, string>> = { system: 'brightness_auto', light: 'light_mode', dark: 'dark_mode' };

function isThemeMode(value: string): value is ThemeMode {
    return (THEMES as readonly string[]).includes(value);
}

/** The `{value}` of a kit `hcm-change` event, which stops here (the dialog re-fires it in its own words). */
function changedValue(event: Event): string {
    event.stopPropagation();
    return String((event as CustomEvent<{ readonly value: unknown }>).detail.value);
}

export class HcmAboutDialog extends LitElement {
    static override readonly properties = {
        open: { type: Boolean },
        city: { attribute: false },
        locale: { type: String },
        engineVersion: { type: String, attribute: 'engine-version' },
        consent: { type: String },
        analytics: { type: Boolean },
        fullscreen: { type: Boolean },
        theme: { type: String },
        attribution: { attribute: false },
        mapboxCssUrl: { attribute: false },
    };

    static override readonly styles = [
        baseStyles,
        detailStyles,
        css`
            :host {
                display: contents;
            }

            .details {
                max-inline-size: 60ch;
            }

            .engine {
                font-size: var(--md-sys-typescale-body-small-size, 0.75rem);
                color: var(--md-sys-color-on-surface-variant, GrayText);
            }

            hcm-map-attribution {
                flex: 1 1 100%;
            }
        `,
    ];

    declare open: boolean;
    declare city: City | null;
    declare locale: Locale;
    declare engineVersion: string;
    declare consent: ConsentState;
    /** True when the manifest configures analytics (a measurement id): only then is there a consent to show. */
    declare analytics: boolean;
    declare fullscreen: boolean;
    declare theme: ThemeMode;
    /** The map's attribution for the dialog's foot; null when there is no map to credit (or About is closed). */
    declare attribution: readonly AttributionPart[] | null;
    /** mapbox-gl.css, for the Mapbox logo at the foot. */
    declare mapboxCssUrl: string;

    constructor() {
        super();
        this.open = false;
        this.city = null;
        this.locale = DEFAULT_LOCALE;
        this.engineVersion = '';
        this.consent = 'unknown';
        this.analytics = false;
        this.fullscreen = false;
        this.theme = 'system';
        this.attribution = null;
        this.mapboxCssUrl = '';
    }

    override render(): TemplateResult {
        const locale = this.locale;
        return html`<hcm-dialog
            .open=${this.open}
            .headline=${translate(locale, 'about.title')}
            .closeLabel=${translate(locale, 'action.close')}
            ?fullscreen=${this.fullscreen}
        >
            ${this.city === null ? nothing : this.#content(this.city)} ${this.#legal()}
        </hcm-dialog>`;
    }

    #legal(): TemplateResult {
        return this.attribution === null
            ? EMPTY
            : html`<hcm-map-attribution
                  slot="actions"
                  .parts=${this.attribution}
                  .locale=${this.locale}
                  .cssUrl=${this.mapboxCssUrl}
              ></hcm-map-attribution>`;
    }

    #content(city: City): TemplateResult {
        const locale = this.locale;
        return html`<div class="details">
            <section>
                <h3>${city.name[locale]}</h3>
                ${renderMarkdown(city.about[locale])}
            </section>
            ${this.#credits(city.credits)} ${this.#preferences()}
            <section>
                <h3>${translate(locale, 'about.privacy')}</h3>
                ${renderMarkdown(city.privacy[locale])} ${this.#consent()}
            </section>
            <p class="engine">${translate(locale, 'about.engine', { version: this.engineVersion })}</p>
        </div>`;
    }

    #credits(credits: readonly Credit[]): TemplateResult {
        if (credits.length === 0) {
            return EMPTY;
        }
        const locale = this.locale;
        return html`<section>
            <h3>${translate(locale, 'about.credits')}</h3>
            <ul>
                ${credits.map((credit) => html`<li>${creditText(credit, locale)}</li>`)}
            </ul>
        </section>`;
    }

    #preferences(): TemplateResult {
        const locale = this.locale;
        const languages = LOCALES.map((choice) => ({ value: choice, label: translate(locale, `language.${choice}`) }));
        // Full screen (compact width) leaves no room for an icon beside every Romanian theme label: only the
        // selected segment keeps its check mark there.
        const icons = (choice: ThemeMode): { readonly icon?: string } => (this.fullscreen ? {} : { icon: THEME_ICONS[choice] });
        const themes = THEMES.map((choice) => ({ value: choice, label: translate(locale, `theme.${choice}`), ...icons(choice) }));
        const onLanguage = (event: Event): void => {
            this.#emit('hcm-locale-change', { locale: resolveLocale(changedValue(event)) });
        };
        const onTheme = (event: Event): void => {
            const value = changedValue(event);
            if (isThemeMode(value)) {
                this.#emit('hcm-theme-change', { theme: value });
            }
        };
        return html`<section class="preferences">
            <h3>${translate(locale, 'language.label')}</h3>
            <hcm-segmented-button
                .options=${languages}
                .value=${locale}
                .label=${translate(locale, 'language.label')}
                @hcm-change=${onLanguage}
            ></hcm-segmented-button>
            <h3>${translate(locale, 'theme.label')}</h3>
            <hcm-segmented-button
                .options=${themes}
                .value=${this.theme}
                .label=${translate(locale, 'theme.label')}
                @hcm-change=${onTheme}
            ></hcm-segmented-button>
        </section>`;
    }

    #emit(type: string, detail: object): void {
        this.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
    }

    #consent(): TemplateResult {
        if (!this.analytics || this.consent === 'unknown') {
            return EMPTY;
        }
        if (this.consent === 'denied') {
            return html`<p class="supporting">${translate(this.locale, 'consent.denied')}</p>`;
        }
        const withdraw = (): void => {
            this.#emit('hcm-consent', { decision: 'denied' });
        };
        return html`<p class="supporting">${translate(this.locale, 'consent.granted')}</p>
            <hcm-button variant="outlined" @click=${withdraw}>${translate(this.locale, 'consent.withdraw')}</hcm-button>`;
    }
}

/** Registers `<hcm-about-dialog>` once; calling it again is a no-op. */
export function defineHcmAboutDialog(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_ABOUT_DIALOG_TAG) === undefined) {
        registry.define(HCM_ABOUT_DIALOG_TAG, HcmAboutDialog);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-about-dialog': HcmAboutDialog;
    }
}
