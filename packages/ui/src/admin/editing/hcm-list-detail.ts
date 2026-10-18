/**
 * `<hcm-list-detail>`: M3's list-detail canonical layout for the editors (`docs/research/M2c-interfaces.md` §1.2, §1.3),
 * measured on itself (never the viewport). From 840 px the list (360 px; 412 px from 1600) and the detail sit side by
 * side; below, one pane shows: the list, or the detail with a Back button (Close on a compact window) at its top. It
 * fills the page area it is given and only its panes scroll (fill mode: the page class declares `fillsPage`).
 *
 * `detail` says an item is open. While the detail replaces the list on a phone (a compact width, or a landscape phone's
 * compact height), it asks the shell to hide the navigation (`hcm-chrome` `{chrome: 'editor'}`: the full-screen editor;
 * `default` otherwise). When the open item
 * changes (`detailKey`), the focus moves to the detail's heading (the slotted `[data-detail-heading]`); when the detail
 * closes, it returns to the element that had it. Back, Close and Esc (outside a dialog) fire `hcm-back`; the page
 * navigates to its list.
 */
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { deepActiveElement, restoreFocus } from '../../components/focus.js';
import { defineOnce, emit } from '../../components/internal.js';
import { observeWindowSize, windowSizeFor, type WindowSize } from '../../layout/window-class.js';
import type { WindowClass } from '../../theme/tokens.js';
import { adminBase } from '../shell/admin-styles.js';

export const HCM_LIST_DETAIL_TAG = 'hcm-list-detail';

/** What the shell shows around a page: everything, or the full-screen editor of a compact window. */
export type PageChrome = 'default' | 'editor';

/** Window classes that show the list and the detail side by side. */
const SPLIT: ReadonlySet<WindowClass> = new Set<WindowClass>(['expanded', 'large', 'extra-large']);

/** The detail's heading: the slotted element itself, or the first `[data-detail-heading]` inside it. */
function headingIn(element: Element): HTMLElement | null {
    const heading = element.matches('[data-detail-heading]') ? element : element.querySelector('[data-detail-heading]');
    return heading instanceof HTMLElement ? heading : null;
}

export class HcmListDetail extends LitElement {
    static override readonly properties = {
        detail: { type: Boolean, reflect: true },
        detailKey: { type: String, attribute: 'detail-key' },
        listLabel: { type: String, attribute: 'list-label' },
        detailLabel: { type: String, attribute: 'detail-label' },
        backLabel: { type: String, attribute: 'back-label' },
        closeLabel: { type: String, attribute: 'close-label' },
    };

    static override readonly styles = [
        adminBase,
        css`
            :host {
                display: grid;
                grid-template-columns: minmax(0, 1fr);
                block-size: 100%;
                min-block-size: 0;
            }

            :host([split]) {
                grid-template-columns: 360px minmax(0, 1fr);
            }

            :host([split][window-class='extra-large']) {
                grid-template-columns: 412px minmax(0, 1fr);
            }

            .pane {
                min-inline-size: 0;
                min-block-size: 0;
                overflow-y: auto;
            }

            :host([split]) .list {
                border-inline-end: 1px solid var(--md-sys-color-outline-variant, CanvasText);
            }

            .back {
                display: flex;
                padding: 8px 8px 0;
            }
        `,
    ];

    declare detail: boolean;
    declare detailKey: string;
    declare listLabel: string;
    declare detailLabel: string;
    declare backLabel: string;
    declare closeLabel: string;
    /** The last measured size (0 × 0 until the first measurement); a class change applies on the next frame. */
    #measured: WindowSize = windowSizeFor(0, 0);
    #stopObserving: (() => void) | null = null;
    #chrome: PageChrome = 'default';
    /** The element that had the focus when the detail opened. */
    #opener: Element | null = null;
    /** Waits for the open item's heading while the item loads. */
    #waiting: MutationObserver | null = null;

    constructor() {
        super();
        this.detail = false;
        this.detailKey = '';
        this.listLabel = '';
        this.detailLabel = '';
        this.backLabel = '';
        this.closeLabel = '';
        this.addEventListener('keydown', this.#onKeyDown);
    }

    /** True while both panes show (none of the chrome is asked for before the first measurement). */
    get split(): boolean {
        return SPLIT.has(this.#measured.widthClass);
    }

    override connectedCallback(): void {
        super.connectedCallback();
        // As the Setup page: the new layout applies on the next frame, never inside the observer's own callback (a layout
        // change there leaves the observers of the elements inside undelivered: "ResizeObserver loop").
        this.#stopObserving = observeWindowSize(this, (size) => {
            requestAnimationFrame(() => {
                this.#resized(size);
            });
        });
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#stopWaiting();
        this.#stopObserving?.();
        this.#stopObserving = null;
        this.#setChrome('default');
    }

    protected override willUpdate(changed: PropertyValues<this>): void {
        this.toggleAttribute('split', this.split);
        if (changed.has('detailKey') && this.detailKey !== '' && changed.get('detailKey') === '') {
            this.#opener = deepActiveElement(this.ownerDocument);
        }
    }

    protected override updated(changed: PropertyValues<this>): void {
        this.#askChrome();
        if (changed.has('detailKey')) {
            this.#moveFocus(changed.get('detailKey') ?? '');
        }
    }

    override render(): TemplateResult {
        const split = this.split;
        return html`<section class="pane list" aria-label=${this.listLabel} ?hidden=${!split && this.detail}>
                <slot name="list"></slot>
            </section>
            <section class="pane detail" aria-label=${this.detailLabel} ?hidden=${!split && !this.detail}>
                ${split || !this.detail ? nothing : this.#backButton()}
                <slot name="detail"></slot>
            </section>`;
    }

    #resized(size: WindowSize): void {
        const before = this.#measured;
        if (before.width === 0 || size.widthClass !== before.widthClass || size.heightClass !== before.heightClass) {
            this.#measured = size;
            this.setAttribute('window-class', size.widthClass);
            this.requestUpdate();
        }
    }

    /** A phone: compact width, or a landscape phone's compact height (its single pane is a full-screen editor). */
    #phone(): boolean {
        const size = this.#measured;
        return !this.split && (size.widthClass === 'compact' || size.heightClass === 'compact');
    }

    #backButton(): TemplateResult {
        const compact = this.#measured.widthClass === 'compact';
        const back = (): void => {
            emit(this, 'hcm-back');
        };
        return html`<div class="back">
            <hcm-button variant="text" icon=${compact ? 'close' : 'arrow_back'} @click=${back}
                >${compact ? this.closeLabel : this.backLabel}</hcm-button
            >
        </div>`;
    }

    /** The full-screen editor while an item is open on a phone; nothing is asked before the first measurement. */
    #askChrome(): void {
        if (this.#measured.width > 0) {
            this.#setChrome(this.detail && this.#phone() ? 'editor' : 'default');
        }
    }

    #setChrome(chrome: PageChrome): void {
        if (chrome !== this.#chrome) {
            this.#chrome = chrome;
            emit(this, 'hcm-chrome', { chrome });
        }
    }

    /** A new item: its heading takes the focus; no item any more: the opener gets it back. */
    #moveFocus(previous: string): void {
        if (this.detailKey !== '') {
            this.#headingFocus();
            return;
        }
        this.#stopWaiting();
        if (previous !== '') {
            restoreFocus(this.#opener);
            this.#opener = null;
        }
    }

    /**
     * Focuses the open item's heading; while the item is still loading (no heading yet), it waits for the heading to be
     * rendered, then focuses it once.
     */
    #headingFocus(): void {
        this.#stopWaiting();
        if (this.#focusHeading()) {
            return;
        }
        const waiting = new MutationObserver(() => {
            if (this.#focusHeading()) {
                this.#stopWaiting();
            }
        });
        waiting.observe(this, { childList: true, subtree: true });
        this.#waiting = waiting;
    }

    #focusHeading(): boolean {
        const slot = this.renderRoot.querySelector<HTMLSlotElement>('slot[name="detail"]');
        const heading = (slot?.assignedElements({ flatten: true }) ?? []).map(headingIn).find((found) => found !== null);
        heading?.focus();
        return heading !== undefined;
    }

    #stopWaiting(): void {
        this.#waiting?.disconnect();
        this.#waiting = null;
    }

    readonly #onKeyDown = (event: KeyboardEvent): void => {
        const inDialog = event.composedPath().some((target) => target instanceof HTMLDialogElement);
        if (event.key === 'Escape' && this.detail && !inDialog && !event.defaultPrevented) {
            emit(this, 'hcm-back');
        }
    };
}

/** Registers `<hcm-list-detail>` and the button it renders. */
export function defineHcmListDetail(registry: CustomElementRegistry = customElements): void {
    defineHcmButton(registry);
    defineOnce(registry, HCM_LIST_DETAIL_TAG, HcmListDetail);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-list-detail': HcmListDetail;
    }
}
