/**
 * `<hcm-date-menu>`: the date picker of a timeline year with several dates (V13, the owner 2026-11-13). An M3 menu beside
 * the badge or the slider that asked for it (`hcm-dates-open`, `timeline-dates.ts`): above a lying timeline, on the
 * trailing side of a standing one, kept inside the viewer and clear of the strip of Mapbox's legal line. Each date is a
 * `menuitemradio` (48 px tall), the one on top checked. It is modal: a transparent scrim takes a press anywhere else and
 * closes it, the viewer makes the frame under it inert and gives the focus back to the slider. The arrow keys, Home and End
 * move between the dates, Tab walks them as any button, Esc closes, Enter or a press picks one.
 *
 * Events (viewer-internal): `hcm-date-pick` (`{layerId}`), `hcm-close`.
 */
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import { closeEvent } from './sheet-frame.js';
import { baseStyles } from './shared-styles.js';
import type { DateItem, DatesOpenDetail } from './timeline-dates.js';

export const HCM_DATE_MENU_TAG = 'hcm-date-menu';

/** Px kept from the viewer's edges, and from the anchor. */
const EDGE = 8;
/** The strip at the foot of the map kept for Mapbox's logo and attribution (`--hcm-map-chrome`). */
const LEGAL_STRIP = 42;

type Box = DatesOpenDetail['anchor'];

/** Where the menu's corner goes in the viewer (px from its top-left): beside the anchor, moved back inside when it would leave. */
export function dateMenuOrigin(
    anchor: Box,
    menu: { readonly width: number; readonly height: number },
    room: { readonly width: number; readonly height: number },
    side: 'above' | 'end' | 'start',
): { readonly x: number; readonly y: number } {
    const centreX = anchor.x + anchor.width / 2 - menu.width / 2;
    const centreY = anchor.y + anchor.height / 2 - menu.height / 2;
    const wanted = {
        above: { x: centreX, y: anchor.y - EDGE - menu.height },
        end: { x: anchor.x + anchor.width + EDGE, y: centreY },
        start: { x: anchor.x - EDGE - menu.width, y: centreY },
    }[side];
    const within = (at: number, length: number, end: number): number => Math.max(EDGE, Math.min(at, end - length));
    return { x: within(wanted.x, menu.width, room.width - EDGE), y: within(wanted.y, menu.height, room.height - LEGAL_STRIP) };
}

const NEXT: Readonly<Record<string, (index: number, count: number) => number>> = {
    ArrowDown: (index, count) => (index + 1) % count,
    ArrowUp: (index, count) => (index - 1 + count) % count,
    Home: () => 0,
    End: (_index, count) => count - 1,
};

export class HcmDateMenu extends LitElement {
    static override readonly properties = {
        items: { attribute: false },
        selected: { attribute: false },
        label: { type: String },
        anchor: { attribute: false },
        vertical: { type: Boolean },
    };

    static override readonly styles = [
        baseStyles,
        css`
            /* Over the whole viewer; only the scrim and the menu take the pointer, and only while open. */
            :host {
                position: absolute;
                inset: 0;
                z-index: 40;
                pointer-events: none;
            }

            .scrim {
                position: absolute;
                inset: 0;
                pointer-events: auto;
            }

            .menu {
                position: absolute;
                display: flex;
                flex-direction: column;
                box-sizing: border-box;
                min-inline-size: 112px;
                max-inline-size: min(280px, calc(100% - 16px));
                max-block-size: calc(100% - 58px);
                padding-block: 8px;
                overflow: auto;
                border-radius: var(--md-sys-shape-corner-extra-small);
                background: var(--md-sys-color-surface-container);
                color: var(--md-sys-color-on-surface);
                box-shadow: var(--md-sys-elevation-level2);
                pointer-events: auto;
            }

            .item {
                display: flex;
                flex: none;
                gap: 12px;
                align-items: center;
                min-block-size: 48px;
                padding-inline: 12px 16px;
                border: 0;
                background: none;
                color: inherit;
                font: inherit;
                text-align: start;
                cursor: pointer;
            }

            .item:hover,
            .item:focus-visible {
                background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
                outline: 2px solid var(--md-sys-color-secondary);
                outline-offset: -2px;
            }

            .item hcm-icon {
                inline-size: 24px;
                color: var(--md-sys-color-primary);
            }

            .item[aria-checked='false'] hcm-icon {
                visibility: hidden;
            }

            .text {
                display: grid;
            }

            .date {
                font-size: var(--md-sys-typescale-label-large-size);
                font-weight: 600;
            }

            .label {
                font-size: var(--md-sys-typescale-body-small-size);
                color: var(--md-sys-color-on-surface-variant);
            }
        `,
    ];

    declare items: readonly DateItem[];
    /** The layer on top: its date is checked. */
    declare selected: string | null;
    declare label: string;
    /** The box (client px) the menu opens beside; null: closed. */
    declare anchor: Box | null;
    /** The timeline stands (a phone held upright): the menu opens on its trailing side, else above it. */
    declare vertical: boolean;

    constructor() {
        super();
        this.items = [];
        this.selected = null;
        this.label = '';
        this.anchor = null;
        this.vertical = false;
    }

    override render(): TemplateResult {
        if (this.anchor === null) {
            return EMPTY;
        }
        return html`<div class="scrim" @pointerdown=${this.#close}></div>
            <div class="menu" role="menu" aria-label=${this.label} data-layout-check="date-menu" @keydown=${this.#onKey}>
                ${this.items.map((item) => this.#item(item))}
            </div>`;
    }

    protected override updated(changed: PropertyValues<this>): void {
        const menu = this.renderRoot.querySelector<HTMLElement>('.menu');
        if (menu !== null && this.anchor !== null && changed.has('anchor')) {
            this.#place(menu, this.anchor);
        }
    }

    /** Beside `at` (client px), inside the viewer; the checked date, else the first, takes the focus. */
    #place(menu: HTMLElement, at: Box): void {
        const host = this.getBoundingClientRect();
        const anchor = { ...at, x: at.x - host.x, y: at.y - host.y };
        const origin = dateMenuOrigin(anchor, { width: menu.offsetWidth, height: menu.offsetHeight }, host, this.#side());
        menu.style.setProperty('left', `${String(origin.x)}px`);
        menu.style.setProperty('top', `${String(origin.y)}px`);
        (this.#items().find((item) => item.getAttribute('aria-checked') === 'true') ?? this.#items()[0])?.focus();
    }

    #side(): 'above' | 'end' | 'start' {
        if (!this.vertical) {
            return 'above';
        }
        return this.matches(':dir(rtl)') ? 'start' : 'end';
    }

    #item(item: DateItem): TemplateResult {
        const pick = (): void => {
            this.dispatchEvent(new CustomEvent('hcm-date-pick', { bubbles: true, composed: false, detail: { layerId: item.id } }));
        };
        return html`<button
            type="button"
            class="item"
            role="menuitemradio"
            aria-checked=${String(item.id === this.selected)}
            data-item=${item.id}
            @click=${pick}
        >
            <hcm-icon name="check"></hcm-icon>
            <span class="text"><span class="date">${item.date}</span><span class="label">${item.label}</span></span>
        </button>`;
    }

    #items(): HTMLElement[] {
        return [...this.renderRoot.querySelectorAll<HTMLElement>('.item')];
    }

    readonly #close = (): void => {
        this.dispatchEvent(closeEvent());
    };

    readonly #onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.#close();
            return;
        }
        const next = NEXT[event.key];
        const items = this.#items();
        if (next !== undefined) {
            event.preventDefault();
            items[next(items.indexOf(this.shadowRoot?.activeElement as HTMLElement), items.length)]?.focus();
        }
    };
}

/** Registers `<hcm-date-menu>` once; calling it again is a no-op. */
export function defineHcmDateMenu(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_DATE_MENU_TAG) === undefined) {
        registry.define(HCM_DATE_MENU_TAG, HcmDateMenu);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-date-menu': HcmDateMenu;
    }
}
