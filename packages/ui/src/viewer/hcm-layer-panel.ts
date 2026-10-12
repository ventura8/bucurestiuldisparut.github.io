/**
 * `<hcm-layer-panel>`: the Layers sheet or docked panel (docs/research/M1-interfaces.md §5.2, PLAN Addendum 3 → Live
 * transparency). It lists every overlay (historical layers, the photos, the POI categories) in the ui-kit's
 * `<hcm-overlay-list>`, with a switch and a 0–100 % slider each, and the attribution of every visible historical
 * layer. It is presentational: the list's `hcm-overlay-visibility` and `hcm-overlay-opacity` events bubble to
 * `<hcm-map-viewer>`, which updates the store (the map follows live, the hash on release).
 */
import { DEFAULT_LOCALE, overlayLabel, poiIcon, translate, type Locale, type Manifest, type Overlay } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import type { OverlayListGroup, OverlayListItem } from '../components/overlay-list.js';
import type { SheetMode } from './layout.js';
import { closeEvent, renderSheetFrame } from './sheet-frame.js';
import { baseStyles, sheetStyles } from './shared-styles.js';

export const HCM_LAYER_PANEL_TAG = 'hcm-layer-panel';

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

export class HcmLayerPanel extends LitElement {
    static override readonly properties = {
        overlays: { attribute: false },
        manifest: { attribute: false },
        locale: { type: String },
        mode: { type: String },
        open: { type: Boolean },
        closable: { type: Boolean },
    };

    static override readonly styles = [
        baseStyles,
        sheetStyles,
        css`
            :host {
                display: contents;
            }

            .content {
                display: flex;
                flex-direction: column;
                gap: 16px;
            }

            .attribution {
                font-size: var(--md-sys-typescale-body-small-size, 0.75rem);
                color: var(--md-sys-color-on-surface-variant, GrayText);
            }
        `,
    ];

    declare overlays: readonly Overlay[];
    declare manifest: Manifest | null;
    declare locale: Locale;
    declare mode: SheetMode;
    declare open: boolean;
    /** False when the panel is always docked (extra-large): it has no close button. */
    declare closable: boolean;

    constructor() {
        super();
        this.overlays = [];
        this.manifest = null;
        this.locale = DEFAULT_LOCALE;
        this.mode = 'bottom';
        this.open = false;
        this.closable = true;
    }

    override render(): TemplateResult {
        const label = translate(this.locale, 'layers.title');
        const closeLabel = translate(this.locale, 'action.close');
        const handleLabel = translate(this.locale, 'sheet.resize');
        const onClose = (): void => {
            this.dispatchEvent(closeEvent());
        };
        const frame = { mode: this.mode, open: this.open, label, closeLabel, handleLabel, onClose, closable: this.closable };
        return renderSheetFrame(frame, this.#content());
    }

    #content(): TemplateResult {
        const manifest = this.manifest;
        if (manifest === null) {
            return EMPTY;
        }
        const locale = this.locale;
        const hasHistorical = manifest.layers.length > 0;
        return html`<div class="content">
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
            ${hasHistorical ? nothing : html`<p class="empty">${translate(locale, 'layers.empty')}</p>`}
            <ul class="attribution">
                ${attributionLines(this.overlays, manifest, locale).map((line) => html`<li>${line}</li>`)}
            </ul>
        </div>`;
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
