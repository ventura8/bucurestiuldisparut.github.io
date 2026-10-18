/**
 * `<hcm-admin-map>`: the admin map's box (docs/research/M2c-interfaces.md §3.3): the element Mapbox draws into (handed to
 * the page's store with `hcm-map-host` once it exists), mapbox-gl.css linked inside the shadow root (the page's copy
 * cannot reach it), the kit's 48 px zoom buttons (never Mapbox's 29 px control), and a crosshair at the centre while the
 * map has the keyboard focus (the keyboard's placement point: the arrow keys pan, Add at centre puts a vertex there).
 * Mapbox's logo and attribution stay visible: the floating controls sit at the top, 8 px apart, and while a modal dialog
 * is open (its scrim would cover them) the map is hidden instead (`covered`, `modal-registry.ts`). The drawing toolbar is
 * slotted at the top left. Without a map (no token, no WebGL, a failure) the box says why, with the way to Mapbox's
 * setup when the token is missing; every field and the vertex list still work.
 */
import type { Locale } from '@hcm/shared';
import { LitElement, css, html, type TemplateResult } from 'lit';

import { defineHcmIconButton } from '../../components/icon-button.js';
import { defineOnce, emit } from '../../components/internal.js';
import { watchModals } from '../../components/modal-registry.js';
import { MAPBOX_GL_CSS_URL } from '../../map/mapbox-loader.js';
import { adminBase } from '../shell/admin-styles.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import type { MapStatusPort } from '../pois/pois-port.js';

/** The map's state as a page passes it: the pois' and layers' states, and `unavailable` (no map factory: the photos page). */
export type AdminMapStatus = MapStatusPort | 'unavailable';

export const HCM_ADMIN_MAP_TAG = 'hcm-admin-map';

const NOTES = {
    loading: 'adminContent.map.loading',
    unavailable: 'adminContent.map.unavailable',
    'no-token': 'adminContent.map.noToken',
    'no-webgl': 'adminContent.map.noWebgl',
    failed: 'adminContent.map.failed',
} as const;

/** States that keep the map's box on screen (the others say why there is no map). */
const SHOWN: ReadonlySet<AdminMapStatus> = new Set<AdminMapStatus>(['none', 'loading', 'ready']);

export class HcmAdminMap extends LitElement {
    static override readonly properties = {
        status: { type: String },
        locale: { type: String },
        cssUrl: { type: String, attribute: 'css-url' },
        focused: { state: true },
        covered: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        adminBase,
        css`
            :host {
                display: block;
                position: relative;
                min-block-size: 240px;
                background: var(--md-sys-color-surface-container, Canvas);
            }

            /* Without a map the box is its note: no empty block above the form (the visual audit of 2026-10-18). */
            :host([no-map]) {
                min-block-size: 0;
            }

            .canvas {
                position: absolute;
                inset: 0;
            }

            .note {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 8px;
                padding: 16px;
                color: var(--md-sys-color-on-surface-variant, CanvasText);
            }

            .note a {
                display: inline-flex;
                align-items: center;
                min-block-size: 48px;
            }

            /* Mapbox's box hides its overflow and the canvas fills it: the ring is drawn inside (the viewer's fix). */
            .mapboxgl-canvas:focus-visible {
                outline-offset: -3px;
            }

            .mapboxgl-ctrl-attrib :focus-visible {
                outline-color: light-dark(var(--md-sys-color-primary, Highlight), var(--md-sys-color-inverse-primary, Highlight));
            }

            .mapboxgl-ctrl-attrib:not(.mapboxgl-compact) {
                padding-block: 3px;
            }

            .mapboxgl-ctrl-attrib a:focus-visible {
                outline-offset: 0;
            }

            .controls {
                position: absolute;
                inset-block-start: 8px;
                inset-inline-end: 8px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .tools {
                position: absolute;
                inset-block-start: 8px;
                inset-inline-start: 8px;
                max-inline-size: calc(100% - 80px);
            }

            .crosshair {
                position: absolute;
                inset-block-start: 50%;
                inset-inline-start: 50%;
                inline-size: 24px;
                block-size: 24px;
                margin: -12px;
                border: 2px solid var(--md-sys-color-on-surface, CanvasText);
                border-radius: 50%;
                box-shadow: 0 0 0 2px var(--md-sys-color-surface, Canvas);
                pointer-events: none;
            }

            /* Under a modal dialog's scrim the map is not drawn: its logo and attribution would be covered (Mapbox's terms). */
            :host([covered]) .canvas,
            :host([covered]) .controls,
            :host([covered]) .crosshair {
                visibility: hidden;
            }
        `,
    ];

    declare status: AdminMapStatus;
    declare locale: Locale;
    /** mapbox-gl.css of the pinned release; empty in tests (no network). */
    declare cssUrl: string;
    /** The map has the keyboard focus: the crosshair shows. */
    declare focused: boolean;
    /** A modal dialog of the page is open: the map hides under its scrim. */
    declare covered: boolean;
    #announced = false;
    #unwatch: (() => void) | null = null;

    constructor() {
        super();
        this.status = 'none';
        this.locale = 'en';
        this.cssUrl = MAPBOX_GL_CSS_URL;
        this.focused = false;
        this.covered = false;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.#unwatch = watchModals(this.ownerDocument, (open) => {
            this.covered = open;
        });
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#unwatch?.();
        this.#unwatch = null;
    }

    /** `no-map` on the host while the box only says why there is no map, so a page sizes it to its note. */
    protected override willUpdate(): void {
        this.toggleAttribute('no-map', !SHOWN.has(this.status));
    }

    /** The element Mapbox draws into (null before the first render). */
    get container(): HTMLElement | null {
        return this.renderRoot.querySelector<HTMLElement>('.canvas');
    }

    protected override updated(): void {
        const container = this.container;
        if (container !== null && !this.#announced) {
            this.#announced = true;
            emit(this, 'hcm-map-host', { container });
        }
    }

    #stylesheet(): TemplateResult {
        return this.cssUrl === '' ? EMPTY : html`<link rel="stylesheet" href=${this.cssUrl} />`;
    }

    #crosshair(shown: boolean): TemplateResult {
        return shown && this.focused ? html`<div class="crosshair" aria-hidden="true"></div>` : EMPTY;
    }

    override render(): TemplateResult {
        const shown = SHOWN.has(this.status);
        return html`${this.#stylesheet()}
            <div
                class="canvas"
                ?hidden=${!shown}
                @focusin=${() => {
                    this.focused = true;
                }}
                @focusout=${() => {
                    this.focused = false;
                }}
            ></div>
            ${this.#crosshair(shown)} ${this.status === 'ready' ? this.#controls() : EMPTY} ${this.#note()}
            <div class="tools"><slot></slot></div>`;
    }

    #controls(): TemplateResult {
        const zoom = (delta: number) => (): void => {
            emit(this, 'hcm-zoom', { delta });
        };
        return html`<div class="controls" data-layout-check>
            <hcm-icon-button
                variant="filled"
                icon="add"
                .label=${contentText(this.locale, 'adminContent.map.zoomIn')}
                @click=${zoom(1)}
            ></hcm-icon-button>
            <hcm-icon-button
                variant="filled"
                icon="remove"
                .label=${contentText(this.locale, 'adminContent.map.zoomOut')}
                @click=${zoom(-1)}
            ></hcm-icon-button>
        </div>`;
    }

    #note(): TemplateResult {
        const status = this.status;
        if (status === 'none' || status === 'ready') {
            return html`<p class="note" role="status"></p>`;
        }
        const setup =
            status === 'no-token' ? html`<a href="#/setup/mapbox">${contentText(this.locale, 'adminContent.map.openSetup')}</a>` : EMPTY;
        return html`<p class="note" role="status">${contentText(this.locale, NOTES[status])} ${setup}</p>`;
    }
}

/** Registers `<hcm-admin-map>` and the kit element it renders. */
export function defineHcmAdminMap(registry: CustomElementRegistry = customElements): void {
    defineHcmIconButton(registry);
    defineOnce(registry, HCM_ADMIN_MAP_TAG, HcmAdminMap);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-admin-map': HcmAdminMap;
    }
}
