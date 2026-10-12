/**
 * `<hcm-error-card>`: a boot or configuration error, localized, with Retry when retrying can help (scenarios V01,
 * V17). It is an alert, so screen readers announce it; Retry fires `hcm-retry`. No error ever leaves a blank map.
 */
import { DEFAULT_LOCALE, translate, type Locale } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import { baseStyles } from './shared-styles.js';
import type { ViewerError } from './store-port.js';

export const HCM_ERROR_CARD_TAG = 'hcm-error-card';

export class HcmErrorCard extends LitElement {
    static override readonly properties = {
        error: { attribute: false },
        locale: { type: String },
    };

    static override readonly styles = [
        baseStyles,
        css`
            :host {
                display: block;
                max-inline-size: 480px;
            }

            .card {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 16px;
                padding: 24px;
                border-radius: var(--md-sys-shape-corner-large, 16px);
                background: var(--md-sys-color-error-container, Canvas);
                color: var(--md-sys-color-on-error-container, CanvasText);
                overflow-wrap: anywhere;
            }
        `,
    ];

    declare error: ViewerError | null;
    declare locale: Locale;

    constructor() {
        super();
        this.error = null;
        this.locale = DEFAULT_LOCALE;
    }

    override render(): TemplateResult {
        const error = this.error;
        if (error === null) {
            return EMPTY;
        }
        const retry = (): void => {
            this.dispatchEvent(new CustomEvent('hcm-retry', { bubbles: true, detail: null }));
        };
        return html`<div class="card" role="alert">
            <hcm-icon name="error"></hcm-icon>
            <p>${translate(this.locale, error.code, error.params)}</p>
            ${
                error.retryable
                    ? html`<hcm-button variant="filled" @click=${retry}>${translate(this.locale, 'action.retry')}</hcm-button>`
                    : nothing
            }
        </div>`;
    }
}

/** Registers `<hcm-error-card>` once; calling it again is a no-op. */
export function defineHcmErrorCard(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_ERROR_CARD_TAG) === undefined) {
        registry.define(HCM_ERROR_CARD_TAG, HcmErrorCard);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-error-card': HcmErrorCard;
    }
}
