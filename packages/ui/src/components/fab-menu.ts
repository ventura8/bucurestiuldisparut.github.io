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
 * actions above it and turns into a close button (`closeLabel`). The menu is at most `--hcm-fab-menu-max-block-size`
 * tall; beyond it the items continue in a second column (a landscape phone). The FAB and the items line up on the
 * inline end, or on the side `--hcm-fab-menu-align` names (`flex-start` for a menu docked on the leading edge, so a
 * wrapped, wider menu never moves the FAB from under the finger). Opening focuses the first item; the arrow keys
 * (wrapping), Home and End move between items; Esc or a focus leaving the menu closes it, Esc returning the focus to
 * the FAB. The items end `--hcm-fab-menu-gap` (8 px) above the FAB; an app whose FAB sits beside a taller control sets
 * more, so the menu clears it. Choosing an item fires `hcm-select` with `{value}` and closes the menu; every open or close fires
 * `hcm-toggle` with `{open}`. Only the FAB and the items take the pointer: the rest of the element's box (beside the
 * FAB under a wide menu, the gaps between items) lets taps through to what is beneath it.
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
            /*
             * Only the FAB and the items take the pointer: the open menu's box is as wide as its widest item and reaches
             * down beside the FAB, where nothing of it is drawn (the tour found it blocking the timeline there).
             */
            :host {
                display: inline-flex;
                flex-direction: column;
                gap: var(--hcm-fab-menu-gap, 8px);
                align-items: var(--hcm-fab-menu-align, flex-end);
                pointer-events: none;
            }

            /*
             * At most --hcm-fab-menu-max-block-size tall (the app sets it where the window is short): the items then
             * continue in a second column instead of leaving the screen (no scrolling, which a keyboard could not reach).
             */
            [role='menu'] {
                display: flex;
                flex-flow: column wrap;
                gap: 4px;
                align-items: var(--hcm-fab-menu-align, flex-end);
                align-content: flex-start;
                max-block-size: var(--hcm-fab-menu-max-block-size, none);
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
                pointer-events: auto;
            }

            .item {
                flex: none;
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

    /**
     * Closes the menu and focuses the FAB before announcing the choice: whatever the app opens in reply (a sheet, a
     * dialog) then remembers the FAB as its opener and gives the focus back to it on close. The item that had the focus
     * is gone with the menu (S-V15-BAD-SHEET-DRAG-CLOSE).
     */
    private choose(value: string): void {
        this.setOpen(false);
        this.fab()?.focus();
        emit(this, 'hcm-select', { value });
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
