/**
 * `<hcm-lightbox>`: the full photo (scenario V08). A modal dialog over the whole viewer with the 2048 px WebP, its
 * position in the photo list, previous and next buttons, pinch, wheel and key zoom (`+`, `-`, `0`), drag to pan while
 * zoomed, arrow keys and Esc. It takes focus when it opens and keeps Tab inside it (it is modal); `<hcm-map-viewer>`
 * returns focus to the opener when it closes. Stepping to the first or last photo disables the arrow that leads further:
 * if that arrow had the focus, the focus moves to the dialog, so Esc and the arrow keys keep working. A broken image shows
 * an error state and closing still works (S-V08-BAD-BROKEN-IMAGE).
 *
 * Events (viewer-internal): `hcm-close`, `hcm-photo-select` (`{photoId}`, the previous or next photo).
 */
import { DEFAULT_LOCALE, translate, type Locale, type Photo } from '@hcm/shared';
import { LitElement, html, type PropertyValues, type TemplateResult } from 'lit';

import { cssProperties } from '../components/css-properties.js';
import { trapTab } from '../components/focus.js';
import { EMPTY } from './empty.js';
import { photoSelectEvent } from './hcm-poi-detail.js';
import { lightboxStyles } from './lightbox-styles.js';
import { resolveAssetUrl } from './services.js';
import { closeEvent } from './sheet-frame.js';
import { localizedText } from './text.js';
import { distance, KEY_ZOOM_STEP, panBy, pinchScale, wheelScale, zoomTo, ZOOM_RESET, type Point, type ZoomState } from './zoom.js';

export const HCM_LIGHTBOX_TAG = 'hcm-lightbox';

interface Pinch {
    readonly startDistance: number;
    readonly startScale: number;
}

export class HcmLightbox extends LitElement {
    static override readonly properties = {
        open: { type: Boolean, reflect: true },
        photos: { attribute: false },
        photoId: { attribute: false },
        locale: { type: String },
        manifestUrl: { type: String, attribute: 'manifest-url' },
        zoom: { state: true },
        failed: { state: true },
    };

    static override readonly styles = lightboxStyles;

    declare open: boolean;
    /** The photos the arrows step through, in order. */
    declare photos: readonly Photo[];
    declare photoId: string | null;
    declare locale: Locale;
    declare manifestUrl: string;
    declare zoom: ZoomState;
    declare failed: boolean;

    /** Active pointers on the image (two make a pinch). */
    readonly #pointers = new Map<number, Point>();
    #pinch: Pinch | null = null;

    constructor() {
        super();
        this.open = false;
        this.photos = [];
        this.photoId = null;
        this.locale = DEFAULT_LOCALE;
        this.manifestUrl = '';
        this.zoom = ZOOM_RESET;
        this.failed = false;
    }

    protected override willUpdate(changed: PropertyValues<this>): void {
        if (changed.has('photoId') || changed.has('open')) {
            this.zoom = ZOOM_RESET;
            this.failed = false;
            this.#pointers.clear();
            this.#pinch = null;
        }
    }

    protected override updated(changed: PropertyValues<this>): void {
        if (changed.has('open') && this.open) {
            this.renderRoot.querySelector<HTMLElement>('[role="dialog"]')?.focus();
        }
    }

    override render(): TemplateResult {
        const index = this.photos.findIndex((photo) => photo.id === this.photoId);
        const photo = this.photos[index];
        if (!this.open || photo === undefined) {
            return EMPTY;
        }
        const title = localizedText(photo.title, this.locale);
        const position = translate(this.locale, 'lightbox.position', { index: String(index + 1), total: String(this.photos.length) });
        return html`<div
            class="lightbox"
            role="dialog"
            aria-modal="true"
            aria-label=${translate(this.locale, 'lightbox.label')}
            tabindex="-1"
            @keydown=${this.#onKeyDown}
        >
            <header>
                <p class="title">${title}</p>
                <p class="position" aria-live="polite">${position}</p>
                <hcm-icon-button icon="close" .label=${translate(this.locale, 'action.close')} @click=${this.#close}></hcm-icon-button>
            </header>
            <div
                class="stage"
                @wheel=${this.#onWheel}
                @pointerdown=${this.#onPointerDown}
                @pointermove=${this.#onPointerMove}
                @pointerup=${this.#onPointerUp}
                @pointercancel=${this.#onPointerUp}
            >
                ${this.failed ? this.#error() : this.#image(photo, title)}
            </div>
            <nav class="nav">
                <hcm-icon-button
                    data-arrow="previous"
                    icon="chevron_left"
                    variant="tonal"
                    .label=${translate(this.locale, 'action.previous')}
                    .disabled=${index === 0}
                    @click=${this.#previous}
                ></hcm-icon-button>
                <hcm-icon-button
                    data-arrow="next"
                    icon="chevron_right"
                    variant="tonal"
                    .label=${translate(this.locale, 'action.next')}
                    .disabled=${index === this.photos.length - 1}
                    @click=${this.#next}
                ></hcm-icon-button>
            </nav>
        </div>`;
    }

    #image(photo: Photo, title: string): TemplateResult {
        const { scale, offset } = this.zoom;
        const transform = { transform: `scale(${String(scale)}) translate(${String(offset.x)}px, ${String(offset.y)}px)` };
        const onError = (): void => {
            this.failed = true;
        };
        return html`<img
            src=${resolveAssetUrl(photo.image.web, this.manifestUrl, document.baseURI) ?? ''}
            alt=${title}
            width=${photo.image.w}
            height=${photo.image.h}
            draggable="false"
            decoding="async"
            ${cssProperties(transform)}
            @error=${onError}
        />`;
    }

    #error(): TemplateResult {
        return html`<p class="error" role="alert">
            <hcm-icon name="broken_image"></hcm-icon>${translate(this.locale, 'error.photoImage')}
        </p>`;
    }

    get #box(): Point {
        return { x: this.clientWidth, y: this.clientHeight };
    }

    readonly #close = (): void => {
        this.dispatchEvent(closeEvent());
    };

    #step(delta: number): void {
        const index = this.photos.findIndex((photo) => photo.id === this.photoId);
        const target = this.photos[index + delta];
        if (target !== undefined) {
            this.#keepFocus(index + delta);
            this.dispatchEvent(photoSelectEvent(target.id));
        }
    }

    /** The arrow that photo `index` disables: `previous` on the first photo, `next` on the last, `none` in between. */
    #disabledArrow(index: number): string {
        if (index === 0) {
            return 'previous';
        }
        return index === this.photos.length - 1 ? 'next' : 'none';
    }

    /** The `data-arrow` of the focused arrow button; empty when no arrow has the focus. */
    #focusedArrow(): string {
        const active = this.shadowRoot?.activeElement;
        return active instanceof HTMLElement ? (active.dataset['arrow'] ?? '') : '';
    }

    /** A disabled button drops the focus: before stepping to photo `index`, the arrow it disables hands it to the dialog. */
    #keepFocus(index: number): void {
        if (this.#focusedArrow() === this.#disabledArrow(index)) {
            this.renderRoot.querySelector<HTMLElement>('[role="dialog"]')?.focus();
        }
    }

    readonly #previous = (): void => {
        this.#step(-1);
    };

    readonly #next = (): void => {
        this.#step(1);
    };

    #zoomBy(factor: number): void {
        this.zoom = zoomTo(this.zoom, this.zoom.scale * factor, this.#box);
    }

    readonly #onKeyDown = (event: KeyboardEvent): void => {
        if (trapTab(event, event.currentTarget as HTMLElement)) {
            return;
        }
        const actions: Readonly<Record<string, () => void>> = {
            Escape: this.#close,
            ArrowLeft: this.#previous,
            ArrowRight: this.#next,
            '+': () => {
                this.#zoomBy(KEY_ZOOM_STEP);
            },
            '=': () => {
                this.#zoomBy(KEY_ZOOM_STEP);
            },
            '-': () => {
                this.#zoomBy(1 / KEY_ZOOM_STEP);
            },
            '0': () => {
                this.zoom = ZOOM_RESET;
            },
        };
        const action = actions[event.key];
        if (action !== undefined) {
            event.preventDefault();
            action();
        }
    };

    readonly #onWheel = (event: WheelEvent): void => {
        event.preventDefault();
        this.zoom = zoomTo(this.zoom, wheelScale(this.zoom.scale, event.deltaY), this.#box);
    };

    readonly #onPointerDown = (event: PointerEvent): void => {
        this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const [first, second] = [...this.#pointers.values()];
        this.#pinch =
            first !== undefined && second !== undefined ? { startDistance: distance(first, second), startScale: this.zoom.scale } : null;
    };

    readonly #onPointerMove = (event: PointerEvent): void => {
        const last = this.#pointers.get(event.pointerId);
        if (last === undefined) {
            return;
        }
        const point = { x: event.clientX, y: event.clientY };
        this.#pointers.set(event.pointerId, point);
        if (this.#pinch === null) {
            this.zoom = panBy(this.zoom, { x: point.x - last.x, y: point.y - last.y }, this.#box);
            return;
        }
        this.#pinchTo(this.#pinch);
    };

    #pinchTo(pinch: Pinch): void {
        const [first, second] = [...this.#pointers.values()];
        if (first !== undefined && second !== undefined) {
            this.zoom = zoomTo(this.zoom, pinchScale(pinch.startScale, pinch.startDistance, distance(first, second)), this.#box);
        }
    }

    readonly #onPointerUp = (event: PointerEvent): void => {
        this.#pointers.delete(event.pointerId);
        this.#pinch = null;
    };
}

/** Registers `<hcm-lightbox>` once; calling it again is a no-op. */
export function defineHcmLightbox(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_LIGHTBOX_TAG) === undefined) {
        registry.define(HCM_LIGHTBOX_TAG, HcmLightbox);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-lightbox': HcmLightbox;
    }
}
