import { translateStart, type Locale } from '@hcm/shared';
import { LitElement, html, type TemplateResult } from 'lit';

import { defineOnce } from '../components/internal.js';
import { startStyles } from './start-styles.js';

const HCM_START_LANGUAGE_TAG = 'hcm-start-language';

const LOCALES: readonly Locale[] = ['ro', 'en'];

/** The start page's language switch, an element of its own: the header is a component beside the page's content. */
class HcmStartLanguage extends LitElement {
    static override readonly properties = { locale: { attribute: false }, choose: { attribute: false } };
    static override readonly styles = startStyles;

    declare locale: Locale;
    declare choose: ((locale: Locale) => void) | undefined;

    override render(): TemplateResult {
        return html`<nav aria-label=${translateStart(this.locale, 'start.language')}>
            ${LOCALES.map(
                (locale) =>
                    html`<button
                        type="button"
                        class="text"
                        lang=${locale}
                        aria-pressed=${locale === this.locale ? 'true' : 'false'}
                        @click=${() => {
                            this.choose?.(locale);
                        }}
                    >
                        ${locale.toUpperCase()}
                    </button>`,
            )}
        </nav>`;
    }
}

export function defineHcmStartLanguage(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_START_LANGUAGE_TAG, HcmStartLanguage);
}
