import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';

import { deepActiveElement } from './focus.js';
import { defineHcmIcon } from './icon.js';
import { defineOnce, emit } from './internal.js';
import { baseStyles, focusRing, stateLayer, typeStyles } from './styles.js';

export const HCM_FAB_MENU_TAG = 'hcm-fab-menu';

export interface FabMenuItem {
    readonly value: string;
    /** Already localized. */
    readonly label: string;
    readonly icon: string;
}

const MOVE_KEYS: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

/**
 * The M3 Expressive FAB menu: a FAB (`aria-haspopup="menu"`, `aria-expanded`, named `label`) that opens a short menu of
 * actions above it and turns into a close button (`closeLabel`). Opening focuses the first item; the arrow keys
 * (wrapping), Home and End move between items; Esc or a focus leaving the menu closes it, Esc returning the focus to
 * the FAB. Choosing an item fires `hcm-select` with `{value}` and closes the menu; every open or close fires
 * `hcm-toggle` with `{open}`.
 */
export class HcmFabMenu extends LitElement {
    static override readonly properties = {
        icon: { type: String },
        label: { type: String },
        closeLabel: { type: String, attribute: 'close-label' },
        items: { attribute: false },
        open: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        stateLayer,
        typeStyles,
        css`
            :host {
                display: inline-flex;
                flex-direction: column;
                gap: 8px;
                align-items: flex-end;
            }

            [role='menu'] {
                display: flex;
                flex-direction: column;
                gap: 4px;
                align-items: flex-end;
                padding: 0;
                margin: 0;
            }

            .item,
            .fab {
                display: inline-flex;
                align-items: center;
                box-sizing: border-box;
                height: 56px;
                margin: 0;
                border: none;
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--md-sys-color-primary-container);
                color: var(--md-sys-color-on-primary-container);
            }

            .item {
                gap: 8px;
                padding-inline: 24px;
            }

            .fab {
                justify-content: center;
                width: 56px;
                border-radius: var(--md-sys-shape-corner-large);
                box-shadow: var(--md-sys-elevation-level3);
                transition: border-radius var(--md-sys-motion-spring-fast-spatial-duration) var(--md-sys-motion-spring-fast-spatial-easing);
            }

            :host([open]) .fab {
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--md-sys-color-primary);
                color: var(--md-sys-color-on-primary);

                --hcm-icon-size: 20px;
            }

            @media (forced-colors: active) {
                .item,
                .fab {
                    border: 1px solid ButtonText;
                }
            }
        `,
    ];

    declare icon: string;
    declare label: string;
    declare closeLabel: string;
    declare items: readonly FabMenuItem[];
    declare open: boolean;

    private focusFirstItem = false;

    constructor() {
        super();
        this.icon = 'menu';
        this.label = '';
        this.closeLabel = '';
        this.items = [];
        this.open = false;
    }

    protected override updated(changed: PropertyValues<this>): void {
        if (changed.has('open') && this.open && this.focusFirstItem) {
            this.focusFirstItem = false;
            this.menuItems()[0]?.focus();
        }
    }

    override render(): TemplateResult {
        return html`${this.open ? this.renderMenu() : nothing}
            <button
                class="fab interactive"
                part="fab"
                aria-label=${this.open ? this.closeLabel : this.label}
                aria-haspopup="menu"
                aria-expanded=${String(this.open)}
                aria-controls="menu"
                @click=${this.onFabClick}
                @keydown=${this.onKeyDown}
            >
                <hcm-icon name=${this.open ? 'close' : this.icon}></hcm-icon>
            </button>`;
    }

    private renderMenu(): TemplateResult {
        return html`<div id="menu" role="menu" aria-label=${this.label} @keydown=${this.onKeyDown} @focusout=${this.onFocusOut}>
            ${this.items.map(
                (item) =>
                    html`<button
                        class="item interactive title-medium"
                        role="menuitem"
                        tabindex="-1"
                        @click=${() => {
                            this.choose(item.value);
                        }}
                    >
                        <hcm-icon name=${item.icon}></hcm-icon><span>${item.label}</span>
                    </button>`,
            )}
        </div>`;
    }

    private menuItems(): HTMLElement[] {
        return [...this.renderRoot.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    }

    private fab(): HTMLElement | null {
        return this.renderRoot.querySelector<HTMLElement>('.fab');
    }

    private setOpen(open: boolean): void {
        if (open !== this.open) {
            this.open = open;
            this.focusFirstItem = open;
            emit(this, 'hcm-toggle', { open });
        }
    }

    private choose(value: string): void {
        emit(this, 'hcm-select', { value });
        this.setOpen(false);
        this.fab()?.focus();
    }

    private readonly onFabClick = (): void => {
        this.setOpen(!this.open);
    };

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && this.open) {
            event.stopPropagation();
            this.setOpen(false);
            this.fab()?.focus();
            return;
        }
        this.moveFocus(event);
    };

    /** Arrow keys, Home and End inside the open menu. */
    private moveFocus(event: KeyboardEvent): void {
        const items = this.menuItems();
        const active = deepActiveElement(this.ownerDocument);
        const current = items.findIndex((item) => item === active);
        const step = MOVE_KEYS[event.key];
        const ends: Readonly<Record<string, number>> = { Home: 0, End: items.length - 1 };
        const target = step === undefined ? ends[event.key] : (current + step + items.length) % items.length;
        if (target !== undefined && items.length > 0) {
            event.preventDefault();
            items[target]?.focus();
        }
    }

    /** Focus leaving the whole element (not moving between its items or to the FAB) closes the menu. */
    private readonly onFocusOut = (event: FocusEvent): void => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !this.renderRoot.contains(next)) {
            this.setOpen(false);
        }
    };
}

export function defineHcmFabMenu(registry: CustomElementRegistry = customElements): void {
    defineHcmIcon(registry);
    defineOnce(registry, HCM_FAB_MENU_TAG, HcmFabMenu);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-fab-menu': HcmFabMenu;
    }
}
