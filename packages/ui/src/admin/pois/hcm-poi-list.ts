/**
 * `<hcm-poi-list>`: the places page's list pane (docs/research/M2c-interfaces.md §1.5, §7.1, §7.4): the title, Add place
 * (it asks which shape: Point, Line, Area), import and export of GeoJSON, the category chips and Unpublished, a search of
 * the loaded page, the bulk bar once a place is selected, and the rows (a check box, the category's swatch, the title,
 * the years, the shape, Unpublished). Fires `hcm-add` with `{shape}`, `hcm-import` with `{file}`, `hcm-export` with
 * `{selection}` and `hcm-bulk` with `{action}`; filters and the selection go to the area's intents.
 */
import type { Locale } from '@hcm/shared';
import { LitElement, html, nothing, type TemplateResult } from 'lit';

import { cssProperties } from '../../components/css-properties.js';
import { defineOnce, emit } from '../../components/internal.js';
import { current, listBody, reconnectingStatus } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { categoryName, localized, poiHref, poiText, ROW_SHAPES, SHAPE_KEYS, yearsText } from './poi-text.js';
import { poiStyles } from './poi-styles.js';
import type { BulkActionPort, CategoryItemPort, PoiItemPort, PoiShapePort, PoisIntentsPort, PoisViewState } from './pois-port.js';

export const HCM_POI_LIST_TAG = 'hcm-poi-list';

const SHAPES: readonly PoiShapePort[] = ['point', 'linestring', 'polygon'];

/** The places the filter shows of the loaded page (the store queries one filter; the search and the rest apply here). */
function visiblePlaces(view: PoisViewState): readonly PoiItemPort[] {
    const search = view.filter.search.trim().toLocaleLowerCase('ro');
    return view.list.items.filter(
        (item) =>
            (!view.filter.unpublished || !item.published) &&
            (search === '' || `${item.title.ro} ${item.title.en ?? ''}`.toLocaleLowerCase('ro').includes(search)),
    );
}

export class HcmPoiList extends LitElement {
    static override readonly properties = {
        view: { attribute: false },
        intents: { attribute: false },
        locale: { type: String },
        selected: { type: String },
        adding: { state: true },
    };

    static override readonly styles = poiStyles;

    declare view: PoisViewState | null;
    declare intents: PoisIntentsPort | null;
    declare locale: Locale;
    /** The open place's id (its row is the current one). */
    declare selected: string;
    /** Add place asks which shape. */
    declare adding: boolean;

    constructor() {
        super();
        this.view = null;
        this.intents = null;
        this.locale = 'en';
        this.selected = '';
        this.adding = false;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        return html`<div class="list-head">
                ${this.#head()} ${this.#filters(view)} ${view.selection.length > 0 ? this.#bulk(view) : nothing}
            </div>
            ${reconnectingStatus(this.locale, view.list.reconnecting)}
            ${listBody(
                this.locale,
                view.list,
                { empty: 'adminContent.pois.empty', icon: 'place' },
                {
                    retry: () => this.intents?.retry(),
                    more: () => this.intents?.more(),
                    items: () => this.#rows(view),
                },
            )}`;
    }

    #head(): TemplateResult {
        const text = (key: Parameters<typeof poiText>[1]): string => poiText(this.locale, key);
        return html`<div class="head">
                <h2>${text('adminContent.pois.title')}</h2>
                <hcm-button
                    class="add"
                    variant="filled"
                    icon="add"
                    aria-expanded=${this.adding ? 'true' : 'false'}
                    @click=${() => {
                        this.adding = !this.adding;
                    }}
                    >${text('adminContent.pois.add')}</hcm-button
                >
            </div>
            ${this.adding ? this.#shapes() : nothing}
            <div class="actions">${this.#fileActions()}</div>`;
    }

    #shapes(): TemplateResult {
        const add = (shape: PoiShapePort) => (): void => {
            this.adding = false;
            emit(this, 'hcm-add', { shape });
        };
        return html`<div class="shapes" role="group" aria-label=${poiText(this.locale, 'adminContent.pois.addAs')}>
            ${SHAPES.map(
                (shape) =>
                    html`<hcm-button variant="tonal" class=${['add', shape].join('-')} @click=${add(shape)}
                        >${poiText(this.locale, SHAPE_KEYS[shape])}</hcm-button
                    >`,
            )}
        </div>`;
    }

    #fileActions(): TemplateResult {
        const chosen = (event: Event): void => {
            const input = event.target as HTMLInputElement;
            const file = input.files?.[0];
            input.value = '';
            if (file !== undefined) {
                emit(this, 'hcm-import', { file });
            }
        };
        const selection = (this.view?.selection.length ?? 0) > 0;
        // The chooser is hidden (no Tab stop of its own): the kit button opens it, as the photos page's Add photos does.
        return html`<input
                class="file-input"
                type="file"
                accept=".geojson,.json,application/geo+json,application/json"
                hidden
                @change=${chosen}
            />
            <hcm-button
                class="import"
                variant="outlined"
                icon="upload"
                @click=${() => {
                    this.renderRoot.querySelector<HTMLInputElement>('.file-input')?.click();
                }}
                >${poiText(this.locale, 'adminContent.pois.import')}</hcm-button
            >
            <hcm-button
                class="export"
                variant="outlined"
                icon="download"
                @click=${() => {
                    emit(this, 'hcm-export', { selection });
                }}
                >${poiText(this.locale, selection ? 'adminContent.pois.exportSelection' : 'adminContent.pois.export')}</hcm-button
            >`;
    }

    #filters(view: PoisViewState): TemplateResult {
        const setCategory = (category: string | null) => (): void => this.intents?.setFilter({ category });
        const categories = view.categories.items;
        return html`<div class="chips" role="group" aria-label=${poiText(this.locale, 'adminContent.pois.filters')}>
                <hcm-chip
                    .label=${poiText(this.locale, 'adminContent.pois.filter.all')}
                    ?selected=${view.filter.category === null}
                    @click=${setCategory(null)}
                ></hcm-chip>
                ${categories.map(
                    (category) =>
                        html`<hcm-chip
                            .label=${localized(this.locale, category.label)}
                            ?selected=${view.filter.category === category.id}
                            @click=${setCategory(category.id)}
                        ></hcm-chip>`,
                )}
                <hcm-chip
                    class="unpublished"
                    .label=${poiText(this.locale, 'adminContent.pois.filter.unpublished')}
                    ?selected=${view.filter.unpublished}
                    @click=${() => this.intents?.setFilter({ unpublished: !view.filter.unpublished })}
                ></hcm-chip>
            </div>
            <div class="field">
                <label for="search">${poiText(this.locale, 'adminContent.pois.search')}</label>
                <input
                    id="search"
                    type="search"
                    autocomplete="off"
                    .value=${view.filter.search}
                    @input=${(event: Event) => this.intents?.setFilter({ search: (event.target as HTMLInputElement).value })}
                />
            </div>`;
    }

    #bulk(view: PoisViewState): TemplateResult {
        const run = (action: BulkActionPort) => (): void => {
            emit(this, 'hcm-bulk', { action });
        };
        const text = (key: Parameters<typeof poiText>[1]): string => poiText(this.locale, key);
        return html`<div class="bulk" role="group" aria-label=${text('adminContent.pois.bulk.actions')}>
            <p class="count" role="status">
                ${poiText(this.locale, 'adminContent.pois.bulk.selected', { count: String(view.selection.length) })}
            </p>
            <hcm-button variant="text" @click=${() => this.intents?.selectAll()}>${text('adminContent.pois.bulk.selectAll')}</hcm-button>
            <hcm-button variant="text" @click=${() => this.intents?.clearSelection()}>${text('adminContent.pois.bulk.clear')}</hcm-button>
            <hcm-button variant="tonal" icon="publish" ?disabled=${view.busy} @click=${run({ kind: 'publish', published: true })}
                >${text('adminContent.pois.bulk.publish')}</hcm-button
            >
            <hcm-button variant="tonal" icon="unpublished" ?disabled=${view.busy} @click=${run({ kind: 'publish', published: false })}
                >${text('adminContent.pois.bulk.unpublish')}</hcm-button
            >
            <hcm-button variant="tonal" class="move" ?disabled=${view.busy} @click=${run({ kind: 'move', category: '' })}
                >${text('adminContent.pois.bulk.move')}</hcm-button
            >
            <hcm-button variant="tonal" icon="delete" class="delete" ?disabled=${view.busy} @click=${run({ kind: 'delete' })}
                >${text('adminContent.pois.bulk.delete')}</hcm-button
            >
        </div>`;
    }

    #rows(view: PoisViewState): TemplateResult {
        const places = visiblePlaces(view);
        if (places.length === 0) {
            return html`<p class="note pane">${poiText(this.locale, 'adminContent.pois.noMatch')}</p>`;
        }
        return html`<ul class="rows" aria-label=${poiText(this.locale, 'adminContent.pois.list')}>
            ${places.map((place) => this.#row(place, view.categories.items, view.selection.includes(place.id)))}
        </ul>`;
    }

    #row(place: PoiItemPort, categories: readonly CategoryItemPort[], checked: boolean): TemplateResult {
        const title = localized(this.locale, place.title);
        const color = categories.find((category) => category.id === place.category)?.color ?? 'transparent';
        return html`<li class="item">
            <label class="check">
                <input
                    class="touch-target"
                    type="checkbox"
                    .checked=${checked}
                    aria-label=${poiText(this.locale, 'adminContent.pois.select', { title })}
                    @change=${() => this.intents?.toggleSelected(place.id)}
                />
            </label>
            <a class="row" href=${poiHref(place.id)} aria-current=${current(place.id === this.selected)}>
                <span class="row-title"><span class="swatch" ${cssProperties({ background: color })}></span>${title}</span>
                <span class="row-detail">${this.#detail(place, categories)}</span>
            </a>
        </li>`;
    }

    #detail(place: PoiItemPort, categories: readonly CategoryItemPort[]): string {
        const parts = [
            categoryName(this.locale, categories, place.category),
            yearsText(this.locale, place.yearStart, place.yearEnd),
            poiText(this.locale, SHAPE_KEYS[ROW_SHAPES[place.shape]]),
        ];
        return (place.published ? parts : [...parts, poiText(this.locale, 'adminContent.pois.chip.unpublished')]).join(' · ');
    }
}

/** Registers `<hcm-poi-list>` once. */
export function defineHcmPoiList(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_POI_LIST_TAG, HcmPoiList);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-poi-list': HcmPoiList;
    }
}
