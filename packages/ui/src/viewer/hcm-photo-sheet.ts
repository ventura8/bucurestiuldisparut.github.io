/**
 * `<hcm-photo-sheet>`: the detail sheet for a photo or a POI (docs/research/M1-interfaces.md §5.2; scenarios V07,
 * V24): a modal bottom sheet on compact, a modal side sheet on medium and compact height, a docked standard side
 * sheet from expanded. A photo shows its lazy WebP thumbnail (a button that opens the lightbox), its date, author,
 * licence, rights note, description and links, all rendered as text and anchors; a POI renders `<hcm-poi-detail>`.
 * A missing image shows a placeholder that keeps the photo's title as its accessible name (S-V07-BAD-IMAGE404).
 */
import { DEFAULT_LOCALE, translate, type Locale, type Photo, type Poi, type PoiCategory } from '@hcm/shared';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import type { SheetMode } from './layout.js';
import { externalLink } from './markdown.js';
import { resolveAssetUrl } from './services.js';
import { closeEvent, renderSheetFrame } from './sheet-frame.js';
import { baseStyles, detailStyles, sheetStyles } from './shared-styles.js';
import { licenseText, localizedText, photoDateText } from './text.js';

export const HCM_PHOTO_SHEET_TAG = 'hcm-photo-sheet';

export class HcmPhotoSheet extends LitElement {
    static override readonly properties = {
        photo: { attribute: false },
        poi: { attribute: false },
        category: { attribute: false },
        photos: { attribute: false },
        locale: { type: String },
        mode: { type: String },
        open: { type: Boolean },
        manifestUrl: { type: String, attribute: 'manifest-url' },
        imageFailed: { state: true },
    };

    static override readonly styles = [
        baseStyles,
        sheetStyles,
        detailStyles,
        css`
            :host {
                display: contents;
            }

            .image {
                display: block;
                inline-size: 100%;
                padding: 0;
                border: 0;
                border-radius: var(--md-sys-shape-corner-large, 16px);
                overflow: hidden;
                background: var(--md-sys-color-surface-container-highest, Canvas);
                cursor: zoom-in;
            }

            .image img {
                display: block;
                inline-size: 100%;
                block-size: auto;
            }

            .placeholder {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 8px;
                min-block-size: 160px;
                border-radius: var(--md-sys-shape-corner-large, 16px);
                background: var(--md-sys-color-surface-container-highest, Canvas);
                color: var(--md-sys-color-on-surface-variant, GrayText);
            }
        `,
    ];

    declare photo: Photo | null;
    declare poi: Poi | null;
    declare category: PoiCategory | null;
    /** Every manifest photo (a POI's linked thumbnails are looked up here). */
    declare photos: readonly Photo[];
    declare locale: Locale;
    declare mode: SheetMode;
    declare open: boolean;
    declare manifestUrl: string;
    declare imageFailed: boolean;

    constructor() {
        super();
        this.photo = null;
        this.poi = null;
        this.category = null;
        this.photos = [];
        this.locale = DEFAULT_LOCALE;
        this.mode = 'bottom';
        this.open = false;
        this.manifestUrl = '';
        this.imageFailed = false;
    }

    protected override willUpdate(changed: PropertyValues<this>): void {
        if (changed.has('photo')) {
            this.imageFailed = false;
        }
    }

    override render(): TemplateResult {
        const onClose = (): void => {
            this.dispatchEvent(closeEvent());
        };
        const frame = {
            mode: this.mode,
            open: this.open,
            label: this.#title(),
            closeLabel: translate(this.locale, 'action.close'),
            handleLabel: translate(this.locale, 'sheet.resize'),
            onClose,
        };
        return renderSheetFrame(frame, this.#content());
    }

    #title(): string {
        const text = this.poi?.title ?? this.photo?.title;
        return text === undefined ? '' : localizedText(text, this.locale);
    }

    #content(): TemplateResult {
        if (this.poi !== null) {
            return html`<hcm-poi-detail
                .poi=${this.poi}
                .category=${this.category}
                .photos=${this.photos}
                .locale=${this.locale}
                .manifestUrl=${this.manifestUrl}
            ></hcm-poi-detail>`;
        }
        return this.photo === null ? EMPTY : this.#photoDetails(this.photo);
    }

    #photoDetails(photo: Photo): TemplateResult {
        const locale = this.locale;
        return html`<div class="details">
            ${this.#image(photo)}
            <p class="supporting">${photoDateText(photo, locale)}</p>
            ${photo.author === undefined ? nothing : html`<p>${translate(locale, 'photo.author', { author: photo.author })}</p>`}
            <p>${licenseText(photo.license, locale)}</p>
            ${photo.rightsHolder === undefined ? nothing : html`<p>${translate(locale, 'photo.rightsHolder', { holder: photo.rightsHolder })}</p>`}
            ${photo.rightsReview === true ? html`<p class="note">${translate(locale, 'photo.rightsReview')}</p>` : nothing}
            ${photo.description === undefined ? nothing : html`<p>${localizedText(photo.description, locale)}</p>`} ${this.#links(photo)}
        </div>`;
    }

    #image(photo: Photo): TemplateResult {
        const title = localizedText(photo.title, this.locale);
        const src = resolveAssetUrl(photo.image.thumb, this.manifestUrl, document.baseURI);
        if (this.imageFailed || src === null) {
            return html`<div class="placeholder" role="img" aria-label=${title}>
                <hcm-icon name="broken_image"></hcm-icon>
                <span aria-hidden="true">${translate(this.locale, 'error.photoImage')}</span>
            </div>`;
        }
        const onError = (): void => {
            this.imageFailed = true;
        };
        const openLightbox = (): void => {
            this.dispatchEvent(new CustomEvent('hcm-lightbox-open', { bubbles: true, detail: { photoId: photo.id } }));
        };
        return html`<button type="button" class="image" aria-label=${translate(this.locale, 'photo.openLightbox')} @click=${openLightbox}>
            <img src=${src} alt=${title} width=${photo.image.w} height=${photo.image.h} loading="lazy" decoding="async" @error=${onError} />
        </button>`;
    }

    #links(photo: Photo): TemplateResult {
        if (photo.links.length === 0) {
            return EMPTY;
        }
        return html`<section>
            <h3>${translate(this.locale, 'photo.links')}</h3>
            <ul>
                ${photo.links.map((link) => html`<li>${externalLink(link.url, link.label)}</li>`)}
            </ul>
        </section>`;
    }
}

/** Registers `<hcm-photo-sheet>` once; calling it again is a no-op. */
export function defineHcmPhotoSheet(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_PHOTO_SHEET_TAG) === undefined) {
        registry.define(HCM_PHOTO_SHEET_TAG, HcmPhotoSheet);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-photo-sheet': HcmPhotoSheet;
    }
}
