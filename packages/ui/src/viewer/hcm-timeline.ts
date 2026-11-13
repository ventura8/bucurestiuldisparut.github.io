/**
 * `<hcm-timeline>`: the year scrubber, the viewer's hero moment (scenario V04). Its stops are the layer years plus
 * "today"; any position snaps to a stop. One `role="slider"` thumb carries the keyboard and screen-reader path
 * (arrows, Page Up/Down, Home, End; `aria-valuetext` is the localized year); the track takes pointer drags and taps.
 * The thumb morphs from a pill into a rounded square while it is dragged (an expressive spring curve), with no
 * motion under `prefers-reduced-motion: reduce`. Standing on the leading edge of a phone held upright, lying at the bottom
 * of the map everywhere else; Left and Right follow the thumb on screen (a later year is to the left, right to left).
 * The track fits the card (the Pixel Tablet, 2026-11-12: at 30 px per gap twenty-two years overflowed it and clipped the
 * first): with less than 30 px between stops every other year is labelled (the ends always, the selected one on the
 * pill); below 14 px the track keeps 16 px per gap and scrolls, a finger can scroll it, the edge with more years beyond
 * fades, and the selected stop is centred whenever it changes, except while a drag is on (`timeline-model.ts`,
 * `timeline-styles.ts`). There a finger drags the thumb and taps a year; elsewhere it drags anywhere on the track.
 * A new stop fires `hcm-year-change` (`{year}`, null for today).
 */
import { DEFAULT_LOCALE, translate, type ViewerLocale } from '@hcm/shared';
import { LitElement, html, type PropertyValues, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';

import { cssProperties } from '../components/css-properties.js';
import { labelShown, SCROLL_GAP_PX, stopIndex, timelineDensity, type TimelineDensity, type TimelineStop } from './timeline-model.js';
import { timelineStyles } from './timeline-styles.js';

export const HCM_TIMELINE_TAG = 'hcm-timeline';

export type TimelineOrientation = 'horizontal' | 'vertical';

/**
 * How many stops each key moves the thumb towards "today" (up, and right, or left right to left: Left and Right turn
 * with the direction); Home and End go to either end (the selection clamps).
 */
const KEY_STEPS: Readonly<Record<string, number>> = {
    ArrowRight: 1,
    ArrowUp: 1,
    PageUp: 1,
    ArrowLeft: -1,
    ArrowDown: -1,
    PageDown: -1,
    Home: -Infinity,
    End: Infinity,
};

/** The card's padding around the track: 44 px on either side lying, 24 px above and below standing (`timeline-styles.ts`). */
const LYING_PADDING_PX = 88;
const STANDING_PADDING_PX = 48;
/** Standing, a label in the pill's lane needs this far from the selected stop: half the 40 px pill and half a label. */
const PILL_REACH_PX = 28;
/** Px a finger may move on a scrolling track and still tap a year (beyond it the browser scrolls). */
const TAP_SLOP_PX = 8;
/** How wide the fade of an edge with more years beyond is. */
const FADE_PX = '24px';

/** The edges of a scroller with more content beyond them: its scroll's start and end (right to left the offset is negative). */
function edgesBeyond(scroller: HTMLElement, vertical: boolean): { readonly start: boolean; readonly end: boolean } {
    const along = vertical ? scroller.scrollTop : Math.abs(scroller.scrollLeft);
    const extent = vertical ? scroller.scrollHeight - scroller.clientHeight : scroller.scrollWidth - scroller.clientWidth;
    return { start: along > 1, end: along < extent - 1 };
}

function onThumb(event: Event): boolean {
    return event.target instanceof Element && event.target.closest('.thumb') !== null;
}

function percentText(percent: number): string {
    return `${String(percent)}%`;
}

/** The share of the track (0..1) under a pointer; vertical tracks grow upwards, horizontal ones leftwards right to left. */
export function trackRatio(
    rect: DOMRect,
    point: { readonly clientX: number; readonly clientY: number },
    vertical: boolean,
    rtl = false,
): number {
    const across = rtl ? rect.right - point.clientX : point.clientX - rect.left;
    const ratio = vertical ? (rect.bottom - point.clientY) / rect.height : across / rect.width;
    return Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
}

export class HcmTimeline extends LitElement {
    static override readonly properties = {
        stops: { attribute: false },
        value: { attribute: false },
        locale: { type: String },
        orientation: { type: String, reflect: true },
        dragging: { type: Boolean, reflect: true },
        density: { type: String, reflect: true },
        gapPx: { state: true },
        fade: { state: true },
    };

    static override readonly styles = timelineStyles;

    declare stops: readonly TimelineStop[];
    declare value: TimelineStop;
    declare locale: ViewerLocale;
    declare orientation: TimelineOrientation;
    declare dragging: boolean;
    /** How the years fit the card (reflected for the styles), from the card's size and the number of stops. */
    declare density: TimelineDensity;
    /** Px between two stops if the track fitted the card. */
    declare gapPx: number;
    /** The edges with more years beyond them: the scroll's start (left, right right to left, top standing) and end. */
    declare fade: { readonly start: boolean; readonly end: boolean };

    /** Removes the window listeners of the current drag (none between drags). */
    #stopDrag: () => void = () => undefined;
    readonly #resize = new ResizeObserver(() => {
        this.#measure();
    });

    constructor() {
        super();
        this.stops = [null];
        this.value = null;
        this.locale = DEFAULT_LOCALE;
        this.orientation = 'horizontal';
        this.dragging = false;
        this.density = 'roomy';
        this.gapPx = Number.POSITIVE_INFINITY;
        this.fade = { start: false, end: false };
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.#resize.observe(this);
    }

    override disconnectedCallback(): void {
        this.#resize.disconnect();
        this.#endDrag();
        super.disconnectedCallback();
    }

    protected override willUpdate(changed: PropertyValues<this>): void {
        if (changed.has('stops') || changed.has('orientation')) {
            this.#measure();
        }
    }

    protected override updated(changed: PropertyValues<this>): void {
        const moved = changed.has('value') || changed.has('density') || changed.has('dragging');
        if (moved && !this.dragging) {
            this.#reveal();
        }
        this.#fadeEdges();
    }

    /** The density for the card's size now: what the track would leave between two stops if it fitted the card. */
    #measure(): void {
        const vertical = this.orientation === 'vertical';
        const room = vertical ? this.clientHeight - STANDING_PADDING_PX : this.clientWidth - LYING_PADDING_PX;
        const gaps = this.stops.length - 1;
        this.gapPx = gaps > 0 && room > 0 ? room / gaps : Number.POSITIVE_INFINITY;
        this.density = timelineDensity(this.gapPx);
    }

    #scroller(): HTMLElement | null {
        return this.renderRoot.querySelector<HTMLElement>('.scroller');
    }

    /** Centres the selected stop in a scrolling card (the scroller only: the page never moves). */
    #reveal(): void {
        const scroller = this.#scroller();
        const stop = this.renderRoot.querySelector('.stop.selected');
        if (scroller === null || stop === null || this.density !== 'scroll') {
            return;
        }
        const view = scroller.getBoundingClientRect();
        const box = stop.getBoundingClientRect();
        if (this.orientation === 'vertical') {
            scroller.scrollBy({ top: box.top + box.height / 2 - (view.top + view.height / 2) });
        } else {
            scroller.scrollBy({ left: box.left + box.width / 2 - (view.left + view.width / 2) });
        }
    }

    /** Which edges have more years beyond them. */
    #fadeEdges(): void {
        const scroller = this.#scroller();
        if (scroller === null) {
            return;
        }
        const fade = edgesBeyond(scroller, this.orientation === 'vertical');
        if (fade.start !== this.fade.start || fade.end !== this.fade.end) {
            this.fade = fade;
        }
    }

    readonly #onScroll = (): void => {
        this.#fadeEdges();
    };

    /** Moves keyboard focus to the thumb (the viewer's "skip to timeline" link). */
    override focus(options?: FocusOptions): void {
        this.renderRoot.querySelector<HTMLElement>('[role="slider"]')?.focus(options);
    }

    override render(): TemplateResult {
        const index = stopIndex(this.stops, this.value);
        const position = { '--hcm-position': percentText(this.#percent(index)) };
        const fade = { '--hcm-fade-start': this.fade.start ? FADE_PX : '0px', '--hcm-fade-end': this.fade.end ? FADE_PX : '0px' };
        return html`<div class="scroller" ${cssProperties(fade)} @scroll=${this.#onScroll}>${this.#track(index, position)}</div>`;
    }

    #track(index: number, position: Readonly<Record<string, string>>): TemplateResult {
        return html`<div
            class="track"
            ${cssProperties({ '--hcm-gaps': String(this.stops.length - 1) })}
            @pointerdown=${this.#onPointerDown}
        >
            <div class="rail"></div>
            <div class="active" ${cssProperties(position)}></div>
            <ol class="stops" aria-hidden="true">
                ${this.stops.map((stop, stopAt) => this.#stop(stop, stopAt, index))}
            </ol>
            <div
                class="thumb touch-target"
                role="slider"
                tabindex="0"
                aria-label=${translate(this.locale, 'timeline.label')}
                aria-orientation=${this.orientation}
                aria-valuemin="0"
                aria-valuemax=${String(this.stops.length - 1)}
                aria-valuenow=${String(index)}
                aria-valuetext=${this.#valueText(this.stops[index] ?? null)}
                ${cssProperties(position)}
                @keydown=${this.#onKeyDown}
            >
                <span class="thumb-label" aria-hidden="true">${this.#shortLabel(this.stops[index] ?? null)}</span>
            </div>
        </div>`;
    }

    #stop(stop: TimelineStop, stopAt: number, selected: number): TemplateResult {
        const classes = { stop: true, selected: stopAt === selected, minor: !this.#labelled(stopAt, selected) };
        return html`<li class=${classMap(classes)} ${cssProperties({ '--hcm-stop': percentText(this.#percent(stopAt)) })}>
            <span class="tick"></span><span class="label">${this.#shortLabel(stop)}</span>
        </li>`;
    }

    /** Whether a stop shows its year: `labelShown`, and standing, not under the pill (the pill names the selected year). */
    #labelled(stopAt: number, selected: number): boolean {
        if (!labelShown(stopAt, this.stops.length, this.density)) {
            return false;
        }
        const gap = this.density === 'scroll' ? SCROLL_GAP_PX : this.gapPx;
        return this.orientation !== 'vertical' || stopAt === selected || Math.abs(stopAt - selected) * gap >= PILL_REACH_PX;
    }

    #percent(index: number): number {
        const last = this.stops.length - 1;
        return last > 0 ? (index / last) * 100 : 0;
    }

    #shortLabel(stop: TimelineStop): string {
        return stop === null ? translate(this.locale, 'timeline.present') : String(stop);
    }

    #valueText(stop: TimelineStop): string {
        return stop === null ? translate(this.locale, 'timeline.present') : translate(this.locale, 'timeline.year', { year: String(stop) });
    }

    readonly #onKeyDown = (event: KeyboardEvent): void => {
        const step = KEY_STEPS[event.key];
        if (step === undefined) {
            return;
        }
        event.preventDefault();
        const turned = /^Arrow[LR]/.test(event.key) && this.#rtl();
        this.#select(stopIndex(this.stops, this.value) + (turned ? -step : step));
    };

    /**
     * A press on the track selects the stop under it; the drag continues on the window until release. On a scrolling
     * track a finger elsewhere than on the thumb may scroll it: it selects only as a tap (`#tapLater`).
     */
    readonly #onPointerDown = (event: PointerEvent): void => {
        if (event.button !== 0) {
            return;
        }
        this.#endDrag();
        const track = event.currentTarget as HTMLElement;
        if (this.#mayScroll(event)) {
            this.#tapLater(track, event);
            return;
        }
        event.preventDefault();
        this.#startDrag(track, event);
    };

    /** A finger on a scrolling track, elsewhere than on the thumb: the browser may scroll the card with it. */
    #mayScroll(event: PointerEvent): boolean {
        return this.density === 'scroll' && event.pointerType === 'touch' && !onThumb(event);
    }

    /** A finger lifted within `TAP_SLOP_PX` of where it went down selects there; a scroll (the browser's cancel) does not. */
    #tapLater(track: HTMLElement, down: PointerEvent): void {
        const up = (event: PointerEvent): void => {
            this.#endDrag();
            if (Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) <= TAP_SLOP_PX) {
                this.#selectAt(track, event);
                this.focus();
            }
        };
        const cancel = (): void => {
            this.#endDrag();
        };
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        this.#stopDrag = () => {
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel);
        };
    }

    #startDrag(track: HTMLElement, event: PointerEvent): void {
        const move = (moveEvent: PointerEvent): void => {
            this.#selectAt(track, moveEvent);
        };
        const end = (): void => {
            this.#endDrag();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        this.#stopDrag = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
        };
        this.dragging = true;
        this.#selectAt(track, event);
        this.focus();
    }

    #endDrag(): void {
        this.dragging = false;
        this.#stopDrag();
        this.#stopDrag = () => undefined;
    }

    #selectAt(track: HTMLElement, event: PointerEvent): void {
        const ratio = trackRatio(track.getBoundingClientRect(), event, this.orientation === 'vertical', this.#rtl());
        this.#select(Math.round(ratio * (this.stops.length - 1)));
    }

    #rtl(): boolean {
        return this.matches(':dir(rtl)');
    }

    #select(index: number): void {
        const clamped = Math.min(this.stops.length - 1, Math.max(0, index));
        const stop = this.stops[clamped] ?? null;
        if (stop === this.value) {
            return;
        }
        this.value = stop;
        this.dispatchEvent(new CustomEvent('hcm-year-change', { bubbles: true, detail: { year: stop } }));
    }
}

/** Registers `<hcm-timeline>` once; calling it again is a no-op. */
export function defineHcmTimeline(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_TIMELINE_TAG) === undefined) {
        registry.define(HCM_TIMELINE_TAG, HcmTimeline);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-timeline': HcmTimeline;
    }
}
