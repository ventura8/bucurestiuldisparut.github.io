/**
 * `<hcm-layer-panel>`: the Layers sheet or docked panel (docs/research/M1-interfaces.md §5.2, PLAN Addendum 3 → Live
 * transparency). It lists every overlay (historical layers, the photos, the POI categories) in the ui-kit's
 * `<hcm-overlay-list>`, with a switch and a 0–100 % slider each, and the attribution of every visible historical
 * layer. It is presentational: the list's `hcm-overlay-visibility` and `hcm-overlay-opacity` events bubble to
 * `<hcm-map-viewer>`, which updates the store (the map follows live, the hash on release). A city without historical
 * layers yet gets a note at the top, where the layers will be (below the photos and places it read as a footnote).
 * With historical layers and a map, a Compare button below the list opens swipe compare (M4, V06), or closes it while
 * the visitor compares: it fires `hcm-compare-toggle`, which the viewer turns into the store's compare action. Below the
 * list, the Map labels group (V31) has a switch per label the city's basemap really has (none: no group, a custom style
 * has nothing to switch), each firing `hcm-map-label`; its note tells them from the city's own Places above.
 *
 * The extra-large pane that is always there is `minimizable` (the owner, 2026-11-08): its close button ("Restrânge
 * straturile", a chevron, `aria-expanded="true"`) turns it into one floating button on the map's leading edge ("Straturi",
 * `aria-expanded="false"`, the owner 2026-11-09: no rail, the map takes the full width) that brings it back. Each fires `hcm-layers-minimize` (`{minimized}`): the viewer keeps it in the
 * store (`layersHidden`, for the session only) and binds `minimized` (reflected for the viewer's grid) to it, so the pane
 * re-created when the window comes back to extra-large is still minimized. The switches and sliders are the store's, so
 * minimizing loses none of them. The focus follows: to the rail's button, then back to the panel's close button.
 */
import { DEFAULT_LOCALE, overlayLabel, poiIcon, translate, type Locale, type Manifest, type Overlay } from '@hcm/shared';
import { translateMapLabels, type MapLabelKind, type MapLabels, type MapLabelsKey } from '@hcm/shared/map-labels';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';

import { tabbableElements } from '../components/focus.js';
import { stateLayer } from '../components/styles.js';
import { EMPTY } from './empty.js';
import type { OverlayListGroup, OverlayListItem } from '../components/overlay-list.js';
import type { SheetMode } from './layout.js';
import { closeEvent, renderSheetFrame } from './sheet-frame.js';
import { baseStyles, sheetStyles } from './shared-styles.js';

export const HCM_LAYER_PANEL_TAG = 'hcm-layer-panel';

/** `hcm-map-label`: a Map labels switch moved. */
export interface MapLabelDetail {
    readonly kind: MapLabelKind;
    readonly visible: boolean;
}

/** What the Map labels group shows: what is drawn, and the kinds the basemap has (null until a map has answered). */
export interface LayerPanelLabels {
    readonly shown: MapLabels;
    readonly available: readonly MapLabelKind[] | null;
}

const LABEL_NAMES: Readonly<Record<MapLabelKind, MapLabelsKey>> = { streets: 'mapLabels.streets', pois: 'mapLabels.pois' };

/** The list rows: overlay labels in `locale`; a POI category also gets its colour and its bundled icon. */
export function overlayItems(overlays: readonly Overlay[], manifest: Manifest, locale: Locale): readonly OverlayListItem[] {
    const categories = new Map((manifest.poiCategories ?? []).map((category) => [category.id, category]));
    return overlays.map((overlay) => {
        const item = {
            id: overlay.id,
            kind: overlay.kind,
            label: overlayLabel(overlay, locale),
            visible: overlay.visible,
            opacity: overlay.opacity,
        };
        const category = overlay.kind === 'poi' ? categories.get(overlay.id) : undefined;
        return category === undefined ? item : { ...item, color: category.color, icon: poiIcon(category.icon) };
    });
}

/** The group headings: historical layers always, places only when the manifest has POI categories. */
export function overlayGroups(manifest: Manifest, locale: Locale): readonly OverlayListGroup[] {
    const historical: OverlayListGroup = { kind: 'raster', label: translate(locale, 'layers.group.historical') };
    const hasPlaces = (manifest.poiCategories ?? []).length > 0;
    return hasPlaces ? [historical, { kind: 'poi', label: translate(locale, 'layers.group.places') }] : [historical];
}

/** `Sursa: USGS EROS` for every visible historical layer, in list order. */
export function attributionLines(overlays: readonly Overlay[], manifest: Manifest, locale: Locale): readonly string[] {
    const layers = new Map(manifest.layers.map((layer) => [layer.id, layer]));
    return overlays
        .filter((overlay) => overlay.kind === 'raster' && overlay.visible)
        .flatMap((overlay) => {
            const layer = layers.get(overlay.id);
            return layer === undefined ? [] : [translate(locale, 'layers.attribution', { attribution: layer.attribution })];
        });
}

/** The note below the switches: what they are, and how they differ from the city's own places when it has some. */
function labelsNote(manifest: Manifest, locale: Locale): string {
    const note = translateMapLabels(locale, 'mapLabels.note');
    return (manifest.poiCategories ?? []).length > 0 ? `${note} ${translateMapLabels(locale, 'mapLabels.notePlaces')}` : note;
}

export class HcmLayerPanel extends LitElement {
    static override readonly properties = {
        overlays: { attribute: false },
        manifest: { attribute: false },
        locale: { type: String },
        mode: { type: String },
        open: { type: Boolean },
        minimizable: { type: Boolean },
        minimized: { type: Boolean, reflect: true },
        canCompare: { type: Boolean, attribute: 'can-compare' },
        comparing: { type: Boolean },
        labels: { attribute: false },
    };

    static override readonly styles = [
        baseStyles,
        sheetStyles,
        stateLayer,
        css`
            :host {
                display: contents;
            }

            .rail {
                position: absolute;
                inset-block-start: var(--hcm-gutter);
                inset-inline-start: var(--hcm-gutter);
                z-index: 20;
                display: flex;
                align-items: center;
                gap: 8px;
                min-block-size: 48px;
                padding-inline: 16px 20px;
                border: 0;
                border-radius: var(--md-sys-shape-corner-large);
                background: var(--md-sys-color-secondary-container);
                color: var(--md-sys-color-on-secondary-container);
                box-shadow: var(--md-sys-elevation-level2);
                font: inherit;
                font-size: var(--md-sys-typescale-label-large-size);
            }

            .content {
                display: flex;
                flex-direction: column;
                gap: 16px;
            }

            .empty {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                border-radius: var(--md-sys-shape-corner-medium);
                background: var(--md-sys-color-surface-container-high);
                color: var(--md-sys-color-on-surface-variant);
                font-size: var(--md-sys-typescale-body-medium-size);
                line-height: var(--md-sys-typescale-body-medium-line-height);
            }

            .attribution {
                font-size: var(--md-sys-typescale-body-small-size);
                color: var(--md-sys-color-on-surface-variant);
            }

            .compare {
                align-self: flex-start;
            }

            /* The size and weight are baseStyles' h3 (title small). */
            .labels h3 {
                margin-block-end: 4px;
                color: var(--md-sys-color-primary);
                line-height: var(--md-sys-typescale-title-small-line-height);
            }

            .labels ul {
                padding: 0;
                margin: 0;
                list-style: none;
            }

            .labels li {
                display: flex;
                gap: 12px;
                align-items: center;
                justify-content: space-between;

                /* 48 px rows: each switch's touch target stays its own, none reaches over its neighbour (the tour's target-size check). */
                padding-block: 8px;
            }

            .labels p {
                margin: 4px 0 0;
                color: var(--md-sys-color-on-surface-variant);
                font-size: var(--md-sys-typescale-body-small-size);
                line-height: var(--md-sys-typescale-body-small-line-height);
            }
        `,
    ];

    declare overlays: readonly Overlay[];
    declare manifest: Manifest | null;
    declare locale: Locale;
    declare mode: SheetMode;
    declare open: boolean;
    /** The pane is always docked (extra-large): its close button minimizes it to one floating button. */
    declare minimizable: boolean;
    /** The minimizable pane shows as its floating button. */
    declare minimized: boolean;
    /** The city has historical layers and the map is drawn: the Compare button shows (M4). */
    declare canCompare: boolean;
    /** The visitor compares: the button closes compare. */
    declare comparing: boolean;
    /** The basemap's own labels; null: no map (no WebGL), no group. */
    declare labels: LayerPanelLabels | null;

    constructor() {
        super();
        this.overlays = [];
        this.manifest = null;
        this.locale = DEFAULT_LOCALE;
        this.mode = 'bottom';
        this.open = false;
        this.minimizable = false;
        this.minimized = false;
        this.canCompare = false;
        this.comparing = false;
        this.labels = null;
    }

    override render(): TemplateResult {
        const label = translate(this.locale, 'layers.title');
        const minimize = this.minimizable;
        const closeLabel = translate(this.locale, minimize ? 'layers.minimize' : 'action.close');
        const handleLabel = translate(this.locale, 'sheet.resize');
        if (minimize && this.minimized) {
            return this.#rail(label);
        }
        const onClose = (): void => {
            if (minimize) {
                this.#minimize(true);
            } else {
                this.dispatchEvent(closeEvent());
            }
        };
        return renderSheetFrame({ mode: this.mode, open: this.open, label, closeLabel, handleLabel, onClose, minimize }, this.#content());
    }

    /**
     * Minimizing or restoring moves the focus to the rail's button or the panel's close button: it is never lost. The
     * close button renders its own button after this update, hence the wait.
     */
    protected override updated(changed: PropertyValues<this>): void {
        if (changed.get('minimized') !== undefined) {
            void this.updateComplete.then(() => tabbableElements(this.renderRoot as ShadowRoot)[0]?.focus());
        }
    }

    /** Minimizes or restores at once, and tells the viewer, which keeps it in the store. */
    #minimize(minimized: boolean): void {
        this.minimized = minimized;
        this.dispatchEvent(new CustomEvent('hcm-layers-minimize', { bubbles: true, detail: { minimized } }));
    }

    #rail(label: string): TemplateResult {
        const onRestore = (): void => {
            this.#minimize(false);
        };
        return html`<button type="button" class="rail interactive" aria-expanded="false" @click=${onRestore}>
            <hcm-icon name="layers"></hcm-icon>${label}
        </button>`;
    }

    #content(): TemplateResult {
        const manifest = this.manifest;
        if (manifest === null) {
            return EMPTY;
        }
        const locale = this.locale;
        const hasHistorical = manifest.layers.length > 0;
        return html`<div class="content">
            ${hasHistorical ? nothing : html`<p class="empty"><hcm-icon name="timeline"></hcm-icon>${translate(locale, 'layers.empty')}</p>`}
            <hcm-overlay-list
                .items=${overlayItems(this.overlays, manifest, locale)}
                .groups=${overlayGroups(manifest, locale)}
                .toggleLabel=${translate(locale, 'layers.toggle')}
                .opacityLabel=${translate(locale, 'layers.opacity')}
                .valueText=${translate(locale, 'layers.opacityValue')}
                .changedText=${translate(locale, 'layers.opacityChanged')}
                .shownText=${translate(locale, 'layers.shown')}
                .hiddenText=${translate(locale, 'layers.hidden')}
            ></hcm-overlay-list>
            ${this.#mapLabels(manifest, locale)} ${this.#compareButton(locale)}
            <ul class="attribution">
                ${attributionLines(this.overlays, manifest, locale).map((line) => html`<li>${line}</li>`)}
            </ul>
        </div>`;
    }

    #mapLabels(manifest: Manifest, locale: Locale): TemplateResult {
        const kinds = this.labels?.available ?? [];
        if (kinds.length === 0) {
            return EMPTY;
        }
        return html`<div class="labels" role="group" aria-labelledby="map-labels">
            <h3 id="map-labels">${translateMapLabels(locale, 'mapLabels.group')}</h3>
            <ul>
                ${kinds.map((kind) => this.#mapLabel(kind, locale))}
            </ul>
            <p>${labelsNote(manifest, locale)}</p>
        </div>`;
    }

    #mapLabel(kind: MapLabelKind, locale: Locale): TemplateResult {
        const name = translateMapLabels(locale, LABEL_NAMES[kind]);
        const onChange = (event: CustomEvent<{ readonly checked: boolean }>): void => {
            event.stopPropagation();
            const detail: MapLabelDetail = { kind, visible: event.detail.checked };
            this.dispatchEvent(new CustomEvent('hcm-map-label', { bubbles: true, composed: true, detail }));
        };
        return html`<li>
            <span>${name}</span>
            <hcm-switch .checked=${this.labels?.shown[kind] === true} .label=${name} @hcm-change=${onChange}></hcm-switch>
        </li>`;
    }

    #compareButton(locale: Locale): TemplateResult {
        if (!this.canCompare) {
            return EMPTY;
        }
        const onClick = (): void => {
            this.dispatchEvent(new CustomEvent('hcm-compare-toggle', { bubbles: true, composed: true }));
        };
        return html`<hcm-button class="compare" variant="tonal" icon=${this.comparing ? 'close' : 'compare'} @click=${onClick}
            >${translate(locale, this.comparing ? 'compare.close' : 'compare.open')}</hcm-button
        >`;
    }
}

/** Registers `<hcm-layer-panel>` once; calling it again is a no-op. */
export function defineHcmLayerPanel(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_LAYER_PANEL_TAG) === undefined) {
        registry.define(HCM_LAYER_PANEL_TAG, HcmLayerPanel);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-layer-panel': HcmLayerPanel;
    }
}
