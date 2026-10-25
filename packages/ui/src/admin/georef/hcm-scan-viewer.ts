/**
 * `<hcm-scan-viewer>`: the georeferencer's scan pane (`docs/research/M3-interfaces.md` §10.4): the scan preview on a
 * canvas, zoomed with the wheel or a pinch (up to 8×) and panned by dragging, with the pairs' numbered markers (filled
 * when used for the fit, hollow when kept as checkpoints, the selected one larger) and the half pair's cross. One Tab stop:
 * focused, a crosshair marks the centre; the arrow keys move the selected marker by one preview pixel (ten with Shift) or
 * pan, `+` and `-` zoom, Enter adds the pair's scan end at the crosshair while pairs are being added, Delete removes the
 * selected pair, Esc drops the half pair or lets the selected one go. Events: `hcm-pick` `{pixel}`, `hcm-select` `{id}`,
 * `hcm-move` `{id, pixel}`, `hcm-delete` `{id}`, `hcm-escape`; pixels are the full-resolution scan's. A pane hidden on a
 * compact window (the map showing) keeps the view it had (CR-M3-47): its crosshair is still where the admin left it,
 * never a division by a zero size.
 */
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';

import { defineOnce, emit } from '../../components/internal.js';
import { adminBase } from '../shell/admin-styles.js';
import { drawScan, type ScanMarker } from './scan-draw.js';
import { fitView, hitPair, panView, paneToScan, zoomView, type Point, type ScanView } from './scan-view.js';

const HCM_SCAN_VIEWER_TAG = 'hcm-scan-viewer';

/** A pointer that moves less than this is a click (CSS pixels). */
const CLICK_SLOP = 4;
const PAN_STEP = 40;
const KEY_ZOOM = 1.5;

interface Gesture {
    readonly start: Point;
    readonly view: ScanView;
    /** The marker being dragged, or null (the view pans). */
    readonly marker: ScanMarker | null;
    moved: boolean;
    last: Point;
}

/** The keys that act at once, and what they do (true: handled). */
const COMMANDS: Readonly<Record<string, ((viewer: HcmScanViewer) => boolean) | undefined>> = {
    Enter: (viewer) => viewer.pickCentre(),
    Delete: (viewer) => viewer.deleteSelected(),
    Backspace: (viewer) => viewer.deleteSelected(),
    Escape: (viewer) => {
        emit(viewer, 'hcm-escape', {});
        return true;
    },
};

const ARROWS: Readonly<Record<string, Point>> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
};

export class HcmScanViewer extends LitElement {
    static override readonly properties = {
        src: { type: String },
        scanWidth: { type: Number, attribute: 'scan-width' },
        scanHeight: { type: Number, attribute: 'scan-height' },
        previewScale: { type: Number, attribute: 'preview-scale' },
        markers: { attribute: false },
        selected: { attribute: false },
        suggestions: { attribute: false },
        selectedSuggestion: { attribute: false },
        half: { attribute: false },
        adding: { type: Boolean },
        label: { type: String },
        focused: { state: true },
    };

    static override readonly styles = [
        adminBase,
        css`
            :host {
                display: block;
                position: relative;
                min-block-size: 240px;
                background: var(--md-sys-color-surface-container-high, Canvas);
            }

            canvas {
                display: block;
                inline-size: 100%;
                block-size: 100%;
                touch-action: none;
                cursor: grab;
            }

            canvas:focus-visible {
                outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid var(--md-sys-color-secondary, Highlight);
                outline-offset: -3px;
            }

            :host([adding]) canvas {
                cursor: crosshair;
            }
        `,
    ];

    declare src: string;
    declare scanWidth: number;
    declare scanHeight: number;
    declare previewScale: number;
    declare markers: readonly ScanMarker[];
    declare selected: string | null;
    /** M4: the matcher's suggestions, drawn dashed under the pairs (they are not dragged or selected here). */
    declare suggestions: readonly ScanMarker[];
    declare selectedSuggestion: string | null;
    declare half: Point | null;
    declare adding: boolean;
    declare label: string;
    declare focused: boolean;
    #image: HTMLImageElement | null = null;
    #view: ScanView | null = null;
    #gesture: Gesture | null = null;
    #observer: ResizeObserver | null = null;
    /** The pane's size the last time it was shown (a hidden pane measures 0 × 0). */
    #pane: { readonly width: number; readonly height: number } = { width: 0, height: 0 };

    constructor() {
        super();
        this.src = '';
        this.scanWidth = 1;
        this.scanHeight = 1;
        this.previewScale = 1;
        this.markers = [];
        this.selected = null;
        this.suggestions = [];
        this.selectedSuggestion = null;
        this.half = null;
        this.adding = false;
        this.label = '';
        this.focused = false;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.#observer = new ResizeObserver(() => {
            this.#draw();
        });
        this.#observer.observe(this);
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#observer?.disconnect();
        this.#observer = null;
    }

    /**
     * The full-resolution scan pixel at the pane's centre (the crosshair): where the pane last showed it, or the scan's
     * middle when it was never shown.
     */
    get centre(): Point {
        const view = this.#currentView();
        const pane = this.#pane;
        if (pane.width === 0 || pane.height === 0) {
            return { x: this.scanWidth / 2, y: this.scanHeight / 2 };
        }
        return paneToScan(view, { x: pane.width / 2, y: pane.height / 2 }, this.previewScale);
    }

    /** Records the pane's size while it is shown; true when it changed. */
    #measure(): boolean {
        const [width, height] = [this.clientWidth, this.clientHeight];
        const changed = width > 0 && height > 0 && (width !== this.#pane.width || height !== this.#pane.height);
        if (changed) {
            this.#pane = { width, height };
        }
        return changed;
    }

    protected override willUpdate(changed: PropertyValues<this>): void {
        if (changed.has('src')) {
            this.#load();
        }
    }

    protected override updated(): void {
        this.#draw();
    }

    override render(): TemplateResult {
        return html`<canvas
            tabindex="0"
            role="application"
            aria-roledescription="scan"
            aria-label=${this.label}
            @pointerdown=${this.#down}
            @pointermove=${this.#moveTo}
            @pointerup=${this.#up}
            @pointercancel=${this.#cancel}
            @wheel=${this.#wheel}
            @keydown=${this.#key}
            @focus=${() => {
                this.focused = true;
            }}
            @blur=${() => {
                this.focused = false;
            }}
        ></canvas>`;
    }

    #load(): void {
        this.#image = null;
        this.#view = null;
        if (this.src === '') {
            this.#draw();
            return;
        }
        const image = new Image();
        image.addEventListener('load', () => {
            if (this.#image === image) {
                this.#view = null;
                this.#draw();
            }
        });
        image.src = this.src;
        this.#image = image;
    }

    /** The preview's size in its own pixels. */
    #previewSize(): { readonly width: number; readonly height: number } {
        return { width: this.scanWidth * this.previewScale, height: this.scanHeight * this.previewScale };
    }

    #fitted(): ScanView {
        return fitView(this.#pane, this.#previewSize());
    }

    /** The view, fitted again when the shown pane's size changed (a hidden pane keeps it). */
    #currentView(): ScanView {
        if (this.#measure()) {
            this.#view = null;
        }
        this.#view ??= this.#fitted();
        return this.#view;
    }

    #draw(): void {
        const canvas = this.renderRoot.querySelector('canvas');
        if (canvas !== null) {
            drawScan(canvas, {
                ...{ image: this.#image, view: this.#currentView(), previewScale: this.previewScale, markers: this.markers },
                ...{ selected: this.selected, half: this.half, crosshair: this.focused, dragged: this.#dragged() },
                ...{ suggestions: this.suggestions, selectedSuggestion: this.selectedSuggestion },
            });
        }
    }

    /** The marker being dragged at its pointer's place, while it moves. */
    #dragged(): ScanMarker | null {
        const gesture = this.#gesture;
        if (gesture === null || !gesture.moved || gesture.marker === null) {
            return null;
        }
        return { ...gesture.marker, pixel: paneToScan(this.#currentView(), gesture.last, this.previewScale) };
    }

    #pointOf(event: PointerEvent | WheelEvent): Point {
        const box = this.getBoundingClientRect();
        return { x: event.clientX - box.left, y: event.clientY - box.top };
    }

    readonly #down = (event: PointerEvent): void => {
        const at = this.#pointOf(event);
        const view = this.#currentView();
        const marker = this.adding ? null : hitPair(view, this.markers, at, this.previewScale);
        this.#gesture = { start: at, view, marker, moved: false, last: at };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    };

    readonly #moveTo = (event: PointerEvent): void => {
        const gesture = this.#gesture;
        if (gesture === null) {
            return;
        }
        const at = this.#pointOf(event);
        gesture.last = at;
        gesture.moved ||= Math.hypot(at.x - gesture.start.x, at.y - gesture.start.y) > CLICK_SLOP;
        if (gesture.moved && gesture.marker === null) {
            this.#view = panView(gesture.view, at.x - gesture.start.x, at.y - gesture.start.y);
        }
        this.#draw();
    };

    readonly #up = (event: PointerEvent): void => {
        const gesture = this.#gesture;
        this.#gesture = null;
        if (gesture === null) {
            return;
        }
        const pixel = paneToScan(this.#currentView(), this.#pointOf(event), this.previewScale);
        if (gesture.moved) {
            this.#dropped(gesture, pixel);
        } else {
            this.#clicked(pixel, gesture.marker);
        }
        this.#draw();
    };

    readonly #cancel = (): void => {
        this.#gesture = null;
        this.#draw();
    };

    #dropped(gesture: Gesture, pixel: Point): void {
        if (gesture.marker !== null) {
            emit(this, 'hcm-move', { id: gesture.marker.id, pixel });
        }
    }

    #clicked(pixel: Point, marker: ScanMarker | null): void {
        if (this.adding) {
            emit(this, 'hcm-pick', { pixel });
            return;
        }
        emit(this, 'hcm-select', { id: marker?.id ?? null });
    }

    readonly #wheel = (event: WheelEvent): void => {
        event.preventDefault();
        this.#view = zoomView(this.#currentView(), Math.exp(-event.deltaY * 0.002), this.#pointOf(event), this.#fitted());
        this.#draw();
    };

    readonly #key = (event: KeyboardEvent): void => {
        const handled = this.#arrow(event) || this.#zoomKey(event.key) || this.#command(event.key);
        if (handled) {
            event.preventDefault();
        }
    };

    /** An arrow moves the selected marker by one preview pixel (ten with Shift), or pans. */
    #arrow(event: KeyboardEvent): boolean {
        const step = ARROWS[event.key];
        if (step === undefined) {
            return false;
        }
        const marker = this.markers.find((candidate) => candidate.id === this.selected);
        if (marker === undefined) {
            this.#view = panView(this.#currentView(), -step.x * PAN_STEP, -step.y * PAN_STEP);
            this.#draw();
            return true;
        }
        const distance = (event.shiftKey ? 10 : 1) / this.previewScale;
        emit(this, 'hcm-move', { id: marker.id, pixel: { x: marker.pixel.x + step.x * distance, y: marker.pixel.y + step.y * distance } });
        return true;
    }

    #zoomKey(key: string): boolean {
        const factor = { '+': KEY_ZOOM, '=': KEY_ZOOM, '-': 1 / KEY_ZOOM }[key];
        if (factor === undefined) {
            return false;
        }
        this.#view = zoomView(this.#currentView(), factor, { x: this.#pane.width / 2, y: this.#pane.height / 2 }, this.#fitted());
        this.#draw();
        return true;
    }

    /** Enter adds at the crosshair (while adding), Delete removes the selected pair, Esc drops the half pair. */
    #command(key: string): boolean {
        return COMMANDS[key]?.(this) === true;
    }

    /** Enter: the pair's scan end at the crosshair, while pairs are being added. */
    pickCentre(): boolean {
        if (this.adding) {
            emit(this, 'hcm-pick', { pixel: this.centre });
        }
        return this.adding;
    }

    /** Delete: the selected pair goes. */
    deleteSelected(): boolean {
        const selected = this.selected;
        if (selected !== null) {
            emit(this, 'hcm-delete', { id: selected });
        }
        return selected !== null;
    }
}

export function defineHcmScanViewer(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_SCAN_VIEWER_TAG, HcmScanViewer);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-scan-viewer': HcmScanViewer;
    }
}
