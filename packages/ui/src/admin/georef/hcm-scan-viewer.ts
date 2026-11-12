/**
 * `<hcm-scan-viewer>`: the georeferencer's scan pane (`docs/research/M3-interfaces.md` §10.4): the scan preview on a
 * canvas, zoomed with the wheel or a pinch (up to 32×, or the + and − buttons) and panned by dragging, with the pairs' numbered markers (filled
 * when used for the fit, hollow when kept as checkpoints, the selected one larger) and the half pair's cross. One Tab stop:
 * focused, a crosshair marks the centre; the arrow keys move the selected marker by one preview pixel (ten with Shift) or
 * pan, `+` and `-` zoom, Enter adds the pair's scan end at the crosshair while pairs are being added, Delete removes the
 * selected pair, Esc drops the half pair or lets the selected one go. Events: `hcm-pick` `{pixel}`, `hcm-select` `{id}`,
 * `hcm-move` `{id, pixel}`, `hcm-delete` `{id}`, `hcm-escape`, and `hcm-view` `{centre, scale}` after the admin pans or zooms (the
 * linked views); pixels are the full-resolution scan's. `follow` (`{centre, scale}`, the linked map's place) centres the view there
 * without an `hcm-view` back, and is ignored while a pointer is down (a drag or a pinch). Only the main button
 * picks, drags or pans (a right-click is the page's context menu, which reads `targetAt` and, after a long press,
 * `cancelGesture`). A pane hidden on a
 * compact window (the map showing) keeps the view it had (CR-M3-47): its crosshair is still where the admin left it,
 * never a division by a zero size.
 */
import { LitElement, html, type PropertyValues, type TemplateResult } from 'lit';

import { defineOnce, emit } from '../../components/internal.js';
import { adminBase } from '../shell/admin-styles.js';
import { drawScan, type ScanMarker } from './scan-draw.js';
import { scanViewerStyles } from './scan-viewer-styles.js';
import { centredView, fitView, hitPair, panView, paneToScan, zoomView, type Point, type ScanView } from './scan-view.js';

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

interface Pinch {
    readonly view: ScanView;
    readonly startDistance: number;
    readonly centre: Point;
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
        follow: { attribute: false },
        adding: { type: Boolean },
        label: { type: String },
        zoomInLabel: { attribute: false },
        zoomOutLabel: { attribute: false },
        focused: { state: true },
    };

    static override readonly styles = [adminBase, scanViewerStyles];

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
    /** The linked map's place for this pane: the full-resolution pixel to centre and CSS px per scan pixel (null: none). */
    declare follow: { readonly centre: Point; readonly scale: number } | null;
    declare adding: boolean;
    declare label: string;
    /** The on-screen zoom buttons' names (the page's locale); the wheel, a pinch and + / - zoom too. */
    declare zoomInLabel: string;
    declare zoomOutLabel: string;
    declare focused: boolean;
    #image: HTMLImageElement | null = null;
    #view: ScanView | null = null;
    #gesture: Gesture | null = null;
    #pinch: Pinch | null = null;
    readonly #pointers = new Map<number, Point>();
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
        this.follow = null;
        this.adding = false;
        this.label = '';
        this.zoomInLabel = '';
        this.zoomOutLabel = '';
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

    /** Where the preview sits in the pane now (its scale and offset): what the linked map last set or the admin last chose. */
    get view(): ScanView {
        return this.#currentView();
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
        if (changed.has('follow')) {
            this.#followMap();
        }
    }

    /** The linked map moved: its place centred here, unless a pointer is down or the pane was never shown. */
    #followMap(): void {
        const follow = this.follow;
        // Measured first: a pane resized since it last drew fits again before the place is centred in it.
        this.#currentView();
        if (follow === null || this.#pointers.size > 0 || this.#pane.width === 0) {
            return;
        }
        this.#view = centredView(this.#pane, follow, this.previewScale, this.#fitted());
    }

    /** The admin panned or zoomed: drawn, and said (the linked map follows). */
    #setView(view: ScanView): void {
        this.#view = view;
        this.#draw();
        emit(this, 'hcm-view', { centre: this.centre, scale: view.scale * this.previewScale });
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
            ></canvas>
            <div class="zoom">
                <hcm-icon-button icon="add" label=${this.zoomInLabel} @click=${() => this.#zoomKey('+')}></hcm-icon-button>
                <hcm-icon-button icon="remove" label=${this.zoomOutLabel} @click=${() => this.#zoomKey('-')}></hcm-icon-button>
            </div>`;
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

    #pointOf(event: { readonly clientX: number; readonly clientY: number }): Point {
        const box = this.getBoundingClientRect();
        return { x: event.clientX - box.left, y: event.clientY - box.top };
    }

    readonly #down = (event: PointerEvent): void => {
        // Only the main button picks, drags or pans: a right-click opens the page's context menu.
        if (event.button !== 0) {
            return;
        }
        const at = this.#pointOf(event);
        this.#pointers.set(event.pointerId, at);
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        if (this.#pointers.size >= 2) {
            this.#startPinch();
            return;
        }
        const view = this.#currentView();
        const marker = this.adding ? null : hitPair(view, this.markers, at, this.previewScale);
        this.#gesture = { start: at, view, marker, moved: false, last: at };
    };

    readonly #moveTo = (event: PointerEvent): void => {
        if (!this.#pointers.has(event.pointerId)) {
            return;
        }
        const at = this.#pointOf(event);
        this.#pointers.set(event.pointerId, at);
        const pinch = this.#pinch;
        if (pinch !== null && this.#pointers.size >= 2) {
            this.#movePinch(pinch);
            return;
        }
        this.#dragAt(at);
    };

    /** One-finger pan or marker drag after the pinch check has already returned. */
    #dragAt(at: Point): void {
        const gesture = this.#gesture;
        if (gesture === null) {
            return;
        }
        gesture.last = at;
        gesture.moved ||= Math.hypot(at.x - gesture.start.x, at.y - gesture.start.y) > CLICK_SLOP;
        if (gesture.moved && gesture.marker === null) {
            this.#setView(panView(gesture.view, at.x - gesture.start.x, at.y - gesture.start.y));
            return;
        }
        this.#draw();
    }

    readonly #up = (event: PointerEvent): void => {
        this.#pointers.delete(event.pointerId);
        if (this.#pointers.size < 2) {
            this.#pinch = null;
        }
        const gesture = this.#gesture;
        this.#gesture = null;
        if (gesture === null || this.#pointers.size > 0) {
            this.#draw();
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

    readonly #cancel = (event: PointerEvent): void => {
        this.#pointers.delete(event.pointerId);
        this.#gesture = null;
        this.#pinch = null;
        this.#draw();
    };

    /** The two fingers currently down (caller already checked size ≥ 2). */
    #fingers(): readonly [Point, Point] {
        return [...this.#pointers.values()] as [Point, Point];
    }

    /** Two fingers: zoom about their midpoint (M3 §10.4). Only called while two pointers are down. */
    #startPinch(): void {
        const [a, b] = this.#fingers();
        this.#gesture = null;
        this.#pinch = {
            view: this.#currentView(),
            startDistance: Math.hypot(b.x - a.x, b.y - a.y) || 1,
            centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
    }

    /** Continues a pinch; the caller has already checked `#pinch` and that two pointers are down. */
    #movePinch(pinch: Pinch): void {
        const [a, b] = this.#fingers();
        this.#setView(zoomView(pinch.view, (Math.hypot(b.x - a.x, b.y - a.y) || 1) / pinch.startDistance, pinch.centre, this.#fitted()));
    }

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
        this.#setView(zoomView(this.#currentView(), Math.exp(-event.deltaY * 0.002), this.#pointOf(event), this.#fitted()));
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
            this.#setView(panView(this.#currentView(), -step.x * PAN_STEP, -step.y * PAN_STEP));
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
        this.#setView(zoomView(this.#currentView(), factor, { x: this.#pane.width / 2, y: this.#pane.height / 2 }, this.#fitted()));
        return true;
    }

    /** Enter adds at the crosshair (while adding), Delete removes the selected pair, Esc drops the half pair. */
    #command(key: string): boolean {
        return COMMANDS[key]?.(this) === true;
    }

    /** The full-resolution pixel under a viewport point and the pair drawn within the hit radius there (the context menu). */
    targetAt(client: { readonly clientX: number; readonly clientY: number }): { readonly pixel: Point; readonly hit: string | null } {
        const [view, at] = [this.#currentView(), this.#pointOf(client)];
        return { pixel: paneToScan(view, at, this.previewScale), hit: hitPair(view, this.markers, at, this.previewScale)?.id ?? null };
    }

    /** A long press opened the context menu: its release is no click (a second finger had already ended the press). */
    cancelGesture(): void {
        this.#gesture = null;
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
