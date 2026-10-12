/**
 * `<hcm-photo-list>`: photos as a list of buttons (thumbnail, title, date). It is the viewer without a map (no WebGL,
 * scenario S-V02-BAD-NO-WEBGL) and the "photos near this year" sheet (V04). A choice fires `hcm-photo-select`. M3 list
 * items: the title in body-large, the date as supporting text in body-medium (14 px; the M1 UX review found the
 * 12 px body-small too small to read on a phone).
 */
import { DEFAULT_LOCALE, translate, type Locale, type Photo } from '@hcm/shared';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import { photoSelectEvent } from './hcm-poi-detail.js';
import { resolveAssetUrl } from './services.js';
import { baseStyles } from './shared-styles.js';
import { localizedText, photoCountText, photoDateText } from './text.js';

export const HCM_PHOTO_LIST_TAG = 'hcm-photo-list';

export class HcmPhotoList extends LitElement {
    static override readonly properties = {
        photos: { attribute: false },
        locale: { type: String },
        manifestUrl: { type: String, attribute: 'manifest-url' },
    };

    static override readonly styles = [
        baseStyles,
        css`
            :host {
                display: block;
            }

            .count {
                margin-block-end: 8px;
                color: var(--md-sys-color-on-surface-variant, GrayText);
            }

            button {
                display: grid;
                grid-template-columns: 56px 1fr;
                align-items: center;
                column-gap: 16px;
                inline-size: 100%;
                min-block-size: 72px;
                padding-block: 8px;
                padding-inline: 8px 16px;
                border: 0;
                border-radius: var(--md-sys-shape-corner-medium, 12px);
                background: transparent;
                color: inherit;
                font: inherit;
                text-align: start;
                cursor: pointer;
            }

            button:hover {
                background: var(--md-sys-color-surface-container-high, Canvas);
            }

            img {
                grid-row: span 2;
                inline-size: 56px;
                block-size: 56px;
                border-radius: var(--md-sys-shape-corner-small, 8px);
                object-fit: cover;
                background: var(--md-sys-color-surface-container-highest, Canvas);
            }

            .title {
                overflow-wrap: anywhere;
                font-size: var(--md-sys-typescale-body-large-size, 1rem);
                line-height: var(--md-sys-typescale-body-large-line-height, 1.5rem);
            }

            .date {
                font-size: var(--md-sys-typescale-body-medium-size, 0.875rem);
                line-height: var(--md-sys-typescale-body-medium-line-height, 1.25rem);
                letter-spacing: var(--md-sys-typescale-body-medium-tracking, 0.016rem);
                color: var(--md-sys-color-on-surface-variant, GrayText);
                overflow-wrap: anywhere;
            }
        `,
    ];

    declare photos: readonly Photo[];
    declare locale: Locale;
    declare manifestUrl: string;

    constructor() {
        super();
        this.photos = [];
        this.locale = DEFAULT_LOCALE;
        this.manifestUrl = '';
    }

    override render(): TemplateResult {
        return html`<p class="count" role="status">${photoCountText(this.photos.length, this.locale)}</p>
            <ul aria-label=${translate(this.locale, 'photos.list')}>
                ${repeat(
                    this.photos,
                    (photo) => photo.id,
                    (photo) => this.#item(photo),
                )}
            </ul>`;
    }

    #item(photo: Photo): TemplateResult {
        const select = (): void => {
            this.dispatchEvent(photoSelectEvent(photo.id));
        };
        const src = resolveAssetUrl(photo.image.thumb, this.manifestUrl, document.baseURI) ?? '';
        return html`<li>
            <button type="button" @click=${select}>
                <img src=${src} alt="" loading="lazy" decoding="async" />
                <span class="title">${localizedText(photo.title, this.locale)}</span>
                <span class="date">${photoDateText(photo, this.locale)}</span>
            </button>
        </li>`;
    }
}

/** Registers `<hcm-photo-list>` once; calling it again is a no-op. */
export function defineHcmPhotoList(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_PHOTO_LIST_TAG) === undefined) {
        registry.define(HCM_PHOTO_LIST_TAG, HcmPhotoList);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-photo-list': HcmPhotoList;
    }
}
