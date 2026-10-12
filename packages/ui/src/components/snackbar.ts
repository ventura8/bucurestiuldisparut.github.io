import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';

import { defineHcmIconButton } from './icon-button.js';
import { defineOnce, emit } from './internal.js';
import { baseStyles, focusRing, stateLayer, typeStyles } from './styles.js';

export const HCM_SNACKBAR_TAG = 'hcm-snackbar';

export type SnackbarDismissReason = 'timeout' | 'close' | 'action';

/**
 * An M3 snackbar. It shows `message` (in a polite live region that is always present, so the message is announced)
 * until the visitor closes it or `timeoutMs` passes (6000 by default, 0 keeps it until closed); the timer pauses while
 * the pointer or the focus is on it. Fires `hcm-action` for the action button, then `hcm-dismiss` with `{reason}`
 * (`timeout`, `close` or `action`). A new `message` shows the snackbar again.
 */
export class HcmSnackbar extends LitElement {
    static override readonly properties = {
        message: { type: String },
        actionLabel: { type: String, attribute: 'action-label' },
        closeLabel: { type: String, attribute: 'close-label' },
        timeoutMs: { type: Number, attribute: 'timeout-ms' },
        dismissed: { state: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        stateLayer,
        typeStyles,
        css`
            :host {
                position: absolute;
                inset-inline: 0;
                bottom: 16px;
                z-index: var(--hcm-snackbar-z-index, 3);
                display: flex;
                justify-content: center;
                padding-inline: 16px;
                pointer-events: none;
            }

            .snackbar {
                display: flex;
                gap: 4px;
                align-items: center;
                box-sizing: border-box;
                width: min(100%, 560px);
                min-height: 48px;
                padding-inline: 16px 4px;
                border-radius: var(--md-sys-shape-corner-extra-small);
                background: var(--md-sys-color-inverse-surface);
                color: var(--md-sys-color-inverse-on-surface);
                box-shadow: var(--md-sys-elevation-level3);
                pointer-events: auto;

                --md-sys-color-on-surface-variant: var(--md-sys-color-inverse-on-surface);
            }

            .message {
                flex: 1 1 auto;
                padding-block: 14px;
            }

            .action {
                height: 40px;
                padding-inline: 12px;
                border: none;
                border-radius: var(--md-sys-shape-corner-full);
                background: none;
                color: var(--md-sys-color-inverse-primary);
            }

            @media (forced-colors: active) {
                .snackbar {
                    border: 1px solid CanvasText;
                }
            }
        `,
    ];

    declare message: string;
    declare actionLabel: string;
    declare closeLabel: string;
    declare timeoutMs: number;
    declare dismissed: boolean;

    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor() {
        super();
        this.message = '';
        this.actionLabel = '';
        this.closeLabel = '';
        this.timeoutMs = 6000;
        this.dismissed = false;
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.stopTimer();
    }

    protected override willUpdate(changed: PropertyValues<this>): void {
        if (changed.has('message')) {
            this.dismissed = false;
        }
    }

    protected override updated(changed: PropertyValues<this>): void {
        if (changed.has('message') || changed.has('timeoutMs')) {
            this.startTimer();
        }
    }

    override render(): TemplateResult {
        const visible = this.message !== '' && !this.dismissed;
        return html`<div role="status" aria-live="polite" aria-atomic="true">${visible ? this.renderSnackbar() : nothing}</div>`;
    }

    private renderSnackbar(): TemplateResult {
        return html`<div
            class="snackbar"
            part="snackbar"
            @pointerenter=${this.stopTimer}
            @pointerleave=${this.startTimer}
            @focusin=${this.stopTimer}
            @focusout=${this.startTimer}
        >
            <span class="message body-medium">${this.message}</span>
            ${
                this.actionLabel === ''
                    ? nothing
                    : html`<button class="action interactive label-large" @click=${this.onAction}>${this.actionLabel}</button>`
            }
            <hcm-icon-button icon="close" label=${this.closeLabel} @click=${this.onClose}></hcm-icon-button>
        </div>`;
    }

    private readonly startTimer = (): void => {
        this.stopTimer();
        if (this.message !== '' && !this.dismissed && this.timeoutMs > 0) {
            this.timer = setTimeout(() => {
                this.dismiss('timeout');
            }, this.timeoutMs);
        }
    };

    private readonly stopTimer = (): void => {
        clearTimeout(this.timer);
        this.timer = undefined;
    };

    private dismiss(reason: SnackbarDismissReason): void {
        this.stopTimer();
        this.dismissed = true;
        emit(this, 'hcm-dismiss', { reason });
    }

    private readonly onAction = (): void => {
        emit(this, 'hcm-action');
        this.dismiss('action');
    };

    private readonly onClose = (): void => {
        this.dismiss('close');
    };
}

export function defineHcmSnackbar(registry: CustomElementRegistry = customElements): void {
    defineHcmIconButton(registry);
    defineOnce(registry, HCM_SNACKBAR_TAG, HcmSnackbar);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-snackbar': HcmSnackbar;
    }
}
