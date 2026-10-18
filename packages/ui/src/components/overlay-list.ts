import { opacityPercent, type OverlayKind } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import { cssProperties } from './css-properties.js';
import { defineHcmIcon } from './icon.js';
import { defineOnce, emit, fillTemplate } from './internal.js';
import { defineHcmSlider } from './slider.js';
import { baseStyles, typeStyles, visuallyHidden } from './styles.js';
import { defineHcmSwitch } from './switch.js';

export const HCM_OVERLAY_LIST_TAG = 'hcm-overlay-list';

/** One overlay row: labels already localized, `opacity` 0..1, `color`/`icon` for a POI category's swatch. */
export interface OverlayListItem {
    readonly id: string;
    readonly kind: OverlayKind;
    readonly label: string;
    readonly visible: boolean;
    readonly opacity: number;
    /** `#rrggbb` (validated by the manifest schema). */
    readonly color?: string;
    /** A bundled Material Symbols name. */
    readonly icon?: string;
    /**
     * Whether the row has the visibility switch (default true). The admin's overlay defaults list the photos and the POI
     * categories without one: only a historical layer has a "shown at start" (CR-M2c-10).
     */
    readonly toggleable?: boolean;
}

/** A group heading (`layers.group.historical`, `layers.group.places`); a kind without one is listed without heading. */
export interface OverlayListGroup {
    readonly kind: OverlayKind;
    readonly label: string;
}

interface Segment {
    readonly heading: string | null;
    readonly items: readonly OverlayListItem[];
}

/** The `checked` of an inner switch's `hcm-change`, which stops here (the list fires its own events). */
function checkedOf(event: Event): boolean {
    event.stopPropagation();
    return (event as CustomEvent<{ checked: boolean }>).detail.checked;
}

/** The `value` of an inner slider's `hcm-input` / `hcm-change`, which stops here. */
function valueOf(event: Event): number {
    event.stopPropagation();
    return (event as CustomEvent<{ value: number }>).detail.value;
}

/**
 * The live-transparency list of PLAN Addendum 3, shared by the viewer's Layers panel and the admin's default-opacity
 * editor: per overlay a switch (`toggleLabel`, "Show {name}"; none on a row whose `toggleable` is false) and a 0–100 %
 * slider (`opacityLabel`; arrows ±1, PageUp/PageDown ±10, Home/End; `aria-valuetext` and the visible value from
 * `valueText`, "{percent} %"). A hidden
 * overlay keeps its slider enabled. Fires `hcm-overlay-visibility` with `{id, visible}` and `hcm-overlay-opacity` with
 * `{id, opacity, final}` (`final: false` per frame while dragging or per key press, `true` on release); once a change
 * settles, `changedText` (and `shownText` / `hiddenText` for the switch) is announced in a polite live region. The
 * list is controlled: it shows `items` as given, so the app feeds its new state back.
 */
export class HcmOverlayList extends LitElement {
    static override readonly properties = {
        items: { attribute: false },
        groups: { attribute: false },
        toggleLabel: { type: String, attribute: 'toggle-label' },
        opacityLabel: { type: String, attribute: 'opacity-label' },
        valueText: { type: String, attribute: 'value-text' },
        changedText: { type: String, attribute: 'changed-text' },
        shownText: { type: String, attribute: 'shown-text' },
        hiddenText: { type: String, attribute: 'hidden-text' },
        announcement: { state: true },
    };

    static override readonly styles = [
        baseStyles,
        typeStyles,
        visuallyHidden,
        css`
            :host {
                display: block;
                color: var(--md-sys-color-on-surface);
            }

            h3 {
                margin: 16px 0 4px;
                color: var(--md-sys-color-primary);
                font-size: var(--md-sys-typescale-title-small-size);
                font-weight: var(--md-sys-typescale-title-small-weight);
                line-height: var(--md-sys-typescale-title-small-line-height);
            }

            ul {
                display: flex;
                flex-direction: column;
                gap: 4px;
                padding: 0;
                margin: 0;
                list-style: none;
            }

            li {
                display: grid;
                grid-template-columns: auto 1fr auto;
                gap: 0 12px;
                align-items: center;
                padding-block: 4px;
            }

            .swatch {
                display: grid;
                place-items: center;
                width: 32px;
                height: 32px;
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--swatch, var(--md-sys-color-secondary-container));
                color: var(--md-sys-color-on-secondary-container);

                --hcm-icon-size: 20px;
            }

            .swatch.colored {
                color: var(--md-sys-color-surface);
            }

            .name {
                min-width: 0;
                overflow-wrap: anywhere;
            }

            .opacity {
                display: flex;
                grid-column: 2 / -1;
                gap: 12px;
                align-items: center;
            }

            hcm-slider {
                flex: 1 1 auto;
            }

            .value {
                min-width: 3.5em;
                color: var(--md-sys-color-on-surface-variant);
                text-align: end;
            }

            @media (forced-colors: active) {
                .swatch {
                    border: 1px solid CanvasText;
                }
            }
        `,
    ];

    declare items: readonly OverlayListItem[];
    declare groups: readonly OverlayListGroup[];
    declare toggleLabel: string;
    declare opacityLabel: string;
    declare valueText: string;
    declare changedText: string;
    declare shownText: string;
    declare hiddenText: string;
    declare announcement: string;

    constructor() {
        super();
        this.items = [];
        this.groups = [];
        this.toggleLabel = '{name}';
        this.opacityLabel = '{name}';
        this.valueText = '{percent} %';
        this.changedText = '';
        this.shownText = '';
        this.hiddenText = '';
        this.announcement = '';
    }

    override render(): TemplateResult {
        return html`${this.segments().map((segment) => this.renderSegment(segment))}
            <div class="visually-hidden" role="status" aria-live="polite">${this.announcement}</div>`;
    }

    /** Consecutive items of one kind, each run under its group heading (if the kind has one). */
    private segments(): Segment[] {
        const segments: { heading: string | null; kind: OverlayKind; items: OverlayListItem[] }[] = [];
        for (const item of this.items) {
            const last = segments.at(-1);
            if (last?.kind === item.kind) {
                last.items.push(item);
            } else {
                segments.push({ heading: this.headingFor(item.kind), kind: item.kind, items: [item] });
            }
        }
        return segments;
    }

    private headingFor(kind: OverlayKind): string | null {
        return this.groups.find((group) => group.kind === kind)?.label ?? null;
    }

    private renderHeading(heading: string | null): TemplateResult | typeof nothing {
        return heading === null ? nothing : html`<h3>${heading}</h3>`;
    }

    private renderSegment(segment: Segment): TemplateResult {
        return html`${this.renderHeading(segment.heading)}
            <ul role="list">
                ${repeat(
                    segment.items,
                    (item) => item.id,
                    (item) => this.renderRow(item),
                )}
            </ul>`;
    }

    private renderRow(item: OverlayListItem): TemplateResult {
        const name = item.label;
        const percent = String(opacityPercent(item.opacity));
        const valueText = fillTemplate(this.valueText, { percent });
        return html`<li data-overlay=${item.id}>
            ${this.renderSwatch(item)}
            <span class="name body-large">${name}</span>
            ${this.renderSwitch(item)}
            <div class="opacity">
                <hcm-slider
                    min="0"
                    max="100"
                    step="1"
                    .value=${Number(percent)}
                    label=${fillTemplate(this.opacityLabel, { name })}
                    value-text=${valueText}
                    @hcm-input=${(event: Event) => {
                        this.onOpacity(item, valueOf(event), false);
                    }}
                    @hcm-change=${(event: Event) => {
                        this.onOpacity(item, valueOf(event), true);
                    }}
                ></hcm-slider>
                <span class="value body-medium" aria-hidden="true">${valueText}</span>
            </div>
        </li>`;
    }

    private renderSwitch(item: OverlayListItem): TemplateResult | typeof nothing {
        return item.toggleable === false
            ? nothing
            : html`<hcm-switch
                  .checked=${item.visible}
                  label=${fillTemplate(this.toggleLabel, { name: item.label })}
                  @hcm-change=${(event: Event) => {
                      this.onVisibility(item, checkedOf(event));
                  }}
              ></hcm-switch>`;
    }

    private renderSwatch(item: OverlayListItem): TemplateResult {
        const classes = item.color === undefined ? 'swatch' : 'swatch colored';
        return html`<span class=${classes} ${cssProperties({ '--swatch': item.color })} aria-hidden="true">
            <hcm-icon name=${item.icon ?? defaultIcon(item.kind)}></hcm-icon>
        </span>`;
    }

    private onVisibility(item: OverlayListItem, visible: boolean): void {
        emit(this, 'hcm-overlay-visibility', { id: item.id, visible });
        this.announcement = fillTemplate(visible ? this.shownText : this.hiddenText, { name: item.label });
    }

    private onOpacity(item: OverlayListItem, percent: number, final: boolean): void {
        emit(this, 'hcm-overlay-opacity', { id: item.id, opacity: percent / 100, final });
        if (final) {
            this.announcement = fillTemplate(this.changedText, { name: item.label, percent: String(percent) });
        }
    }
}

/** The swatch icon of an overlay without its own: a historical layer is a map, the photos a gallery, a POI a pin. */
function defaultIcon(kind: OverlayKind): string {
    const icons: Readonly<Record<OverlayKind, string>> = { raster: 'map', photos: 'photo_library', poi: 'location_on' };
    return icons[kind];
}

export function defineHcmOverlayList(registry: CustomElementRegistry = customElements): void {
    defineHcmIcon(registry);
    defineHcmSwitch(registry);
    defineHcmSlider(registry);
    defineOnce(registry, HCM_OVERLAY_LIST_TAG, HcmOverlayList);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-overlay-list': HcmOverlayList;
    }
}
