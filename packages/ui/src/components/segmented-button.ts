import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { defineHcmIcon } from './icon.js';
import { defineOnce, emit } from './internal.js';
import { baseStyles, focusRing, stateLayer, touchTarget, typeStyles } from './styles.js';

export const HCM_SEGMENTED_BUTTON_TAG = 'hcm-segmented-button';

export interface SegmentOption {
    readonly value: string;
    /** Already localized. */
    readonly label: string;
    readonly icon?: string;
}

const NEXT_KEYS: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * An M3 single-select segmented button, with radio-group semantics: one Tab stop on the selected segment, arrow keys
 * (wrapping), Home and End move and select, a click selects. Every selection fires `hcm-change` with `{value}`; the
 * selected segment shows a check mark. `label` names the group.
 */
export class HcmSegmentedButton extends LitElement {
    static override readonly properties = {
        options: { attribute: false },
        value: { type: String },
        label: { type: String },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        stateLayer,
        touchTarget,
        typeStyles,
        css`
            :host {
                display: inline-flex;
            }

            .group {
                display: inline-flex;
            }

            button {
                display: inline-flex;
                flex: 1 1 0;
                gap: 8px;
                align-items: center;
                justify-content: center;
                box-sizing: border-box;
                min-width: 48px;
                height: 40px;
                padding-inline: 12px;
                margin: 0;
                margin-inline-start: -1px;
                border: 1px solid var(--md-sys-color-outline);
                background: none;
                color: var(--md-sys-color-on-surface);
                overflow: visible;

                --hcm-icon-size: 18px;
            }

            button:first-child {
                margin-inline-start: 0;
                border-start-start-radius: var(--md-sys-shape-corner-full);
                border-end-start-radius: var(--md-sys-shape-corner-full);
            }

            button:last-child {
                border-start-end-radius: var(--md-sys-shape-corner-full);
                border-end-end-radius: var(--md-sys-shape-corner-full);
            }

            button[aria-checked='true'] {
                background: var(--md-sys-color-secondary-container);
                color: var(--md-sys-color-on-secondary-container);
            }

            @media (forced-colors: active) {
                button[aria-checked='true'] {
                    outline: 2px solid Highlight;
                    outline-offset: -3px;
                }
            }
        `,
    ];

    declare options: readonly SegmentOption[];
    declare value: string;
    declare label: string;

    constructor() {
        super();
        this.options = [];
        this.value = '';
        this.label = '';
    }

    override render(): TemplateResult {
        const tabStop = this.options.some((option) => option.value === this.value) ? this.value : this.options[0]?.value;
        return html`<div class="group" role="radiogroup" aria-label=${this.label} @keydown=${this.onKeyDown}>
            ${this.options.map((option) => this.renderOption(option, option.value === tabStop))}
        </div>`;
    }

    private renderOption(option: SegmentOption, tabStop: boolean): TemplateResult {
        const checked = option.value === this.value;
        const icon = checked ? 'check' : (option.icon ?? '');
        return html`<button
            class="interactive touch-target label-large"
            role="radio"
            aria-checked=${String(checked)}
            tabindex=${tabStop ? '0' : '-1'}
            data-value=${option.value}
            @click=${() => {
                this.select(option.value);
            }}
        >
            ${icon === '' ? nothing : html`<hcm-icon name=${icon}></hcm-icon>`}<span>${option.label}</span>
        </button>`;
    }

    private select(value: string): void {
        if (value !== this.value) {
            this.value = value;
            emit(this, 'hcm-change', { value });
        }
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        const index = this.options.findIndex((option) => option.value === this.value);
        const target = this.options[this.keyIndex(event.key, index)];
        if (target === undefined) {
            return;
        }
        event.preventDefault();
        this.select(target.value);
        void this.updateComplete.then(() => {
            this.renderRoot.querySelector<HTMLElement>(`[aria-checked='true']`)?.focus();
        });
    };

    /** The option index a key moves to (wrapping), or -1 for a key the group does not handle. */
    private keyIndex(key: string, index: number): number {
        const count = this.options.length;
        const step = NEXT_KEYS[key];
        if (step !== undefined) {
            return (Math.max(index, 0) + step + count) % count;
        }
        const ends: Readonly<Record<string, number>> = { Home: 0, End: count - 1 };
        return ends[key] ?? -1;
    }
}

export function defineHcmSegmentedButton(registry: CustomElementRegistry = customElements): void {
    defineHcmIcon(registry);
    defineOnce(registry, HCM_SEGMENTED_BUTTON_TAG, HcmSegmentedButton);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-segmented-button': HcmSegmentedButton;
    }
}
