/**
 * `<hcm-poi-detail>`: the details of a point of interest inside the detail sheet (PLAN Addendum 3, scenario V24):
 * its category (icon and colour), years, the Markdown-subset description walked into DOM nodes (markup stays text),
 * its links and the thumbnails of its photos; a thumbnail fires `hcm-photo-select` to open that photo.
 */
import { DEFAULT_LOCALE, poiIcon, translate, type Locale, type Photo, type Poi, type PoiCategory } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { cssProperties } from '../components/css-properties.js';
import { EMPTY } from './empty.js';
import { externalLink, renderMarkdown } from './markdown.js';
import { resolveAssetUrl } from './services.js';
import { baseStyles, detailStyles } from './shared-styles.js';
import { localizedText, poiYearsText } from './text.js';

export const HCM_POI_DETAIL_TAG = 'hcm-poi-detail';

/** Category colours come from the manifest (`#rrggbb`, schema-checked); anything else is ignored. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** The viewer-internal event asking to open a photo. */
export function photoSelectEvent(photoId: string): CustomEvent<{ readonly photoId: string }> {
    return new CustomEvent('hcm-photo-select', { bubbles: true, composed: true, detail: { photoId } });
}

export class HcmPoiDetail extends LitElement {
    static override readonly properties = {
        poi: { attribute: false },
        category: { attribute: false },
        photos: { attribute: false },
        locale: { type: String },
        manifestUrl: { type: String, attribute: 'manifest-url' },
    };

    static override readonly styles = [
        baseStyles,
        detailStyles,
        css`
            :host {
                display: block;
            }

            .category {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .swatch {
                display: inline-grid;
                place-items: center;
                inline-size: 32px;
                block-size: 32px;
                border-radius: var(--md-sys-shape-corner-full, 50%);
                background: var(--hcm-poi-color, var(--md-sys-color-primary, Highlight));
                color: var(--md-sys-color-on-primary, Canvas);
            }

            .thumbs {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
                gap: 8px;
            }

            .thumbs button {
                display: block;
                inline-size: 100%;
                min-block-size: 48px;
                padding: 0;
                border: 0;
                border-radius: var(--md-sys-shape-corner-medium, 12px);
                overflow: hidden;
                background: var(--md-sys-color-surface-container-highest, Canvas);
                cursor: pointer;
            }

            .thumbs img {
                display: block;
                inline-size: 100%;
                aspect-ratio: 1;
                object-fit: cover;
            }
        `,
    ];

    declare poi: Poi | null;
    declare category: PoiCategory | null;
    /** The manifest's photos; the POI's `photoIds` are looked up here (unknown ids are skipped). */
    declare photos: readonly Photo[];
    declare locale: Locale;
    declare manifestUrl: string;

    constructor() {
        super();
        this.poi = null;
        this.category = null;
        this.photos = [];
        this.locale = DEFAULT_LOCALE;
        this.manifestUrl = '';
    }

    override render(): TemplateResult {
        const poi = this.poi;
        if (poi === null) {
            return EMPTY;
        }
        const years = poiYearsText(poi, this.locale);
        return html`<div class="details">
            ${this.#category()} ${years === null ? nothing : html`<p class="years">${years}</p>`}
            ${
                poi.description === undefined
                    ? nothing
                    : html`<div class="description">${renderMarkdown(localizedText(poi.description, this.locale))}</div>`
            }
            ${this.#links(poi)} ${this.#photos(poi)}
        </div>`;
    }

    #category(): TemplateResult {
        const category = this.category;
        if (category === null) {
            return EMPTY;
        }
        const color = HEX_COLOR.test(category.color) ? { '--hcm-poi-color': category.color } : {};
        return html`<p class="category">
            <span class="swatch" ${cssProperties(color)}><hcm-icon .name=${poiIcon(category.icon)}></hcm-icon></span>
            <span>${translate(this.locale, 'poi.category', { category: category.label[this.locale] })}</span>
        </p>`;
    }

    #links(poi: Poi): TemplateResult {
        if (poi.links.length === 0) {
            return EMPTY;
        }
        return html`<section>
            <h3>${translate(this.locale, 'poi.links')}</h3>
            <ul>
                ${poi.links.map((link) => html`<li>${externalLink(link.url, link.label)}</li>`)}
            </ul>
        </section>`;
    }

    #photos(poi: Poi): TemplateResult {
        const byId = new Map(this.photos.map((photo) => [photo.id, photo]));
        const linked = (poi.photoIds ?? []).flatMap((id) => byId.get(id) ?? []);
        if (linked.length === 0) {
            return EMPTY;
        }
        return html`<section>
            <h3>${translate(this.locale, 'poi.photos')}</h3>
            <ul class="thumbs">
                ${linked.map((photo) => this.#thumb(photo))}
            </ul>
        </section>`;
    }

    #thumb(photo: Photo): TemplateResult {
        const title = localizedText(photo.title, this.locale);
        const src = resolveAssetUrl(photo.image.thumb, this.manifestUrl, document.baseURI) ?? '';
        const select = (): void => {
            this.dispatchEvent(photoSelectEvent(photo.id));
        };
        return html`<li>
            <button type="button" aria-label=${translate(this.locale, 'poi.openPhoto', { title })} @click=${select}>
                <img src=${src} alt="" loading="lazy" decoding="async" />
            </button>
        </li>`;
    }
}

/** Registers `<hcm-poi-detail>` once; calling it again is a no-op. */
export function defineHcmPoiDetail(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_POI_DETAIL_TAG) === undefined) {
        registry.define(HCM_POI_DETAIL_TAG, HcmPoiDetail);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-poi-detail': HcmPoiDetail;
    }
}
