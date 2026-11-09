/**
 * `<hcm-about-dialog>`: About, credits and the privacy notice of the city (scenario V13), the language and theme
 * choices (V11, V12), the engine version and the analytics consent with its withdrawal (V19), in the ui-kit's
 * `<hcm-dialog>` (full screen on compact). The About and privacy texts are the Markdown subset walked into DOM nodes;
 * empty credits hide their section (S-V13-BAD-EMPTY-CREDITS). The dialog sits in the browser's top layer, over the
 * map's own logo and attribution, so its foot shows them (`<hcm-map-attribution>`, V18) whenever the map is there.
 *
 * Its second mode is the help panel of the keyboard and the gamepad (`help`, docs/research/viewer-input.md §2). About also
 * holds the accessibility statement (§5).
 *
 * Events (viewer-internal): `hcm-locale-change` (`{locale}`), `hcm-theme-change` (`{theme}`), `hcm-consent`
 * (`{decision: 'denied'}`, the kit banner's event) when the visitor withdraws consent, `hcm-help-open` and
 * `hcm-shortcuts-change` (`{enabled}`).
 */
import {
    DEFAULT_LOCALE,
    LANGUAGE_NAMES,
    localized,
    resolveViewerLocale,
    shownLanguage,
    translate,
    type City,
    type Credit,
    type ViewerLocale,
} from '@hcm/shared';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';

import { tabbableElements } from '../components/focus.js';
import type { AttributionPart } from './attribution.js';
import { EMPTY } from './empty.js';
import { fallbackNote } from './fallback-note.js';
import { externalLink, renderMarkdown } from './markdown.js';
import { baseStyles, detailStyles } from './shared-styles.js';
import { renderShortcutsHelp } from './shortcuts-help.js';
import type { ConsentState, ThemeMode } from './store-port.js';

export const HCM_ABOUT_DIALOG_TAG = 'hcm-about-dialog';

/** Where anyone reports a problem of the viewer, on every city: the manifest has no contact field (docs/research/viewer-input.md §5). */
const REPORT_URL = 'https://github.com/ventura8/bucurestiuldisparut.github.io/issues';

const THEMES: readonly ThemeMode[] = ['system', 'light', 'dark'];

/** A credit line: a link when the credit names a page. */
function creditText(credit: Credit, locale: ViewerLocale): TemplateResult | string {
    const label = localized(credit.label, locale);
    return credit.url === undefined ? label : externalLink(credit.url, label);
}

/** The language list: every viewer language by its own name, in its own language, in `LANGUAGE_NAMES`' fixed order. */
const LANGUAGE_OPTIONS = Object.entries(LANGUAGE_NAMES).map(([value, label]) => ({ value, label, lang: value }));

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
        help: { type: Boolean },
        shortcuts: { type: Boolean },
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

            hcm-switch {
                margin-block: 8px;
            }

            kbd {
                border: 1px solid;
            }
        `,
    ];

    declare open: boolean;
    /** The dialog shows the help panel instead of About. */
    declare help: boolean;
    /** The single-key shortcuts are on (the help panel's switch). */
    declare shortcuts: boolean;
    declare city: City | null;
    declare locale: ViewerLocale;
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
        this.help = false;
        this.shortcuts = true;
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
            .headline=${translate(locale, this.help ? 'input.help' : 'about.title')}
            .closeLabel=${translate(locale, 'action.close')}
            ?fullscreen=${this.fullscreen}
        >
            ${this.#body()} ${this.#legal()}
        </hcm-dialog>`;
    }

    /** About's button to the help panel removes the focused button: the focus goes on to the dialog's first control. */
    protected override updated(changed: PropertyValues<this>): void {
        if (changed.get('help') === false && this.open) {
            tabbableElements(this.renderRoot as ShadowRoot)[0]?.focus();
        }
    }

    #body(): TemplateResult {
        if (this.help) {
            return renderShortcutsHelp(this.locale, this.shortcuts, (event) => {
                event.stopPropagation();
                this.#emit('hcm-shortcuts-change', { enabled: event.detail.checked });
            });
        }
        return this.city === null ? EMPTY : this.#content(this.city);
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
                <h3 lang=${shownLanguage(city.name, locale)}>${localized(city.name, locale)}</h3>
                <div lang=${shownLanguage(city.about, locale)}>${renderMarkdown(localized(city.about, locale))}</div>
                ${fallbackNote(city.about, locale)}
            </section>
            ${this.#credits(city.credits)} ${this.#preferences()} ${this.#inputAndAccessibility()}
            <section>
                <h3>${translate(locale, 'about.privacy')}</h3>
                <div lang=${shownLanguage(city.privacy, locale)}>${renderMarkdown(localized(city.privacy, locale))}</div>
                ${this.#consent()}
            </section>
            <p class="engine">${translate(locale, 'about.engine', { version: this.engineVersion })}</p>
        </div>`;
    }

    /** The keyboard and the gamepad, and the accessibility statement (docs/research/viewer-input.md §5). */
    #inputAndAccessibility(): TemplateResult {
        const locale = this.locale;
        const onHelp = (): void => {
            this.#emit('hcm-help-open', {});
        };
        return html`<section>
            <h3>${translate(locale, 'about.accessibility')}</h3>
            <p>${translate(locale, 'about.a11yWorks')}</p>
            <p>${translate(locale, 'about.a11yMissing')}</p>
            <p>${externalLink(REPORT_URL, translate(locale, 'about.a11yReport'))}</p>
            <hcm-button variant="outlined" @click=${onHelp}>${translate(locale, 'input.help')}</hcm-button>
        </section>`;
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
        // Full screen (compact width) leaves no room for an icon beside every Romanian theme label: only the
        // selected segment keeps its check mark there.
        const icons = (choice: ThemeMode): { readonly icon?: string } => (this.fullscreen ? {} : { icon: THEME_ICONS[choice] });
        const themes = THEMES.map((choice) => ({ value: choice, label: translate(locale, `theme.${choice}`), ...icons(choice) }));
        // The list shows the page's language until the store has switched (`live`): a language whose texts cannot be
        // fetched leaves it where it was, and its new value comes back with the page's.
        const onLanguage = (event: Event): void => {
            const chosen = resolveViewerLocale(changedValue(event));
            (event.currentTarget as { value: string }).value = locale;
            this.#emit('hcm-locale-change', { locale: chosen });
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
                .options=${LANGUAGE_OPTIONS}
                .value=${live(locale)}
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
