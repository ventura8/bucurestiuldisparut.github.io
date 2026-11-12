/**
 * `<hcm-timeline>`: the year scrubber, the viewer's hero moment (scenario V04). Its stops are the layer years plus
 * "today"; any position snaps to a stop. One `role="slider"` thumb carries the keyboard and screen-reader path
 * (arrows, Page Up/Down, Home, End; `aria-valuetext` is the localized year); the track takes pointer drags and taps.
 * The thumb morphs from a pill into a rounded square while it is dragged (an expressive spring curve), with no
 * motion under `prefers-reduced-motion: reduce`. Standing on the leading edge of a phone held upright, lying at the bottom
 * of the map everywhere else; Left and Right follow the thumb on screen (a later year is to the left, right to left).
 * More years than the card holds scroll: the track is at least 30 px per gap (`--hcm-gaps`) and the selected stop snaps
 * into view, except while a drag is on (`timeline-styles.ts`). A new stop fires `hcm-year-change` (`{year}`, null for today).
 */
import { DEFAULT_LOCALE, translate, type Locale } from '@hcm/shared';
import { LitElement, html, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';

import { cssProperties } from '../components/css-properties.js';
import { stopIndex, type TimelineStop } from './timeline-model.js';
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
    };

    static override readonly styles = timelineStyles;

    declare stops: readonly TimelineStop[];
    declare value: TimelineStop;
    declare locale: Locale;
    declare orientation: TimelineOrientation;
    declare dragging: boolean;

    /** Removes the window listeners of the current drag (none between drags). */
    #stopDrag: () => void = () => undefined;

    constructor() {
        super();
        this.stops = [null];
        this.value = null;
        this.locale = DEFAULT_LOCALE;
        this.orientation = 'horizontal';
        this.dragging = false;
    }

    override disconnectedCallback(): void {
        this.#endDrag();
        super.disconnectedCallback();
    }

    /** Moves keyboard focus to the thumb (the viewer's "skip to timeline" link). */
    override focus(options?: FocusOptions): void {
        this.renderRoot.querySelector<HTMLElement>('[role="slider"]')?.focus(options);
    }

    override render(): TemplateResult {
        const index = stopIndex(this.stops, this.value);
        const position = { '--hcm-position': percentText(this.#percent(index)) };
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
        const classes = { stop: true, selected: stopAt === selected };
        return html`<li class=${classMap(classes)} ${cssProperties({ '--hcm-stop': percentText(this.#percent(stopAt)) })}>
            <span class="tick"></span><span class="label">${this.#shortLabel(stop)}</span>
        </li>`;
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

    /** A press on the track selects the stop under it; the drag continues on the window until release. */
    readonly #onPointerDown = (event: PointerEvent): void => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        this.#endDrag();
        const track = event.currentTarget as HTMLElement;
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
    };

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
