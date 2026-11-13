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
 * A new stop fires `hcm-year-change` (`{year}`, null for today). The year chip (`timeline-tip.ts`) names a stop without
 * its own label under the mouse and the stop under a finger, which scrubs along the track and selects on lift
 * (`timeline-scrub.ts`); never a year of several dates, whose date menu names them. V13: selecting a year with several dates (a tap, a click,
 * the end of a drag or a scrub, Enter, the gamepad's A) asks for its date menu (`hcm-dates-open`); its badge is a hint only.
 * A mouse resting on such a year, or a scrubbing finger resting on it, shows the menu without selecting the year
 * (`hcm-dates-peek`, `timeline-peek.ts`).
 */
import { DEFAULT_LOCALE, translate, type Locale } from '@hcm/shared';
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';

import { cssProperties } from '../components/css-properties.js';
import { countOf, dateBadge, datesOpenEvent, datesValueText } from './timeline-dates.js';
import { labelShown, SCROLL_GAP_PX, stopIndex, timelineDensity, type TimelineDensity, type TimelineStop } from './timeline-model.js';
import { TimelinePointer } from './timeline-pointer.js';
import { DatesPeek, datesPeekEvent, peekDates, peekPlace } from './timeline-peek.js';
import { YearSends } from './timeline-sends.js';
import { timelineStyles } from './timeline-styles.js';
import { placeTip, tipText, tipWanted, type TimelineTip } from './timeline-tip.js';

export const HCM_TIMELINE_TAG = 'hcm-timeline';

export type TimelineOrientation = 'horizontal' | 'vertical';

export { trackRatio } from './timeline-pointer.js';

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
/** How wide the fade of an edge with more years beyond is. */
const FADE_PX = '24px';

/** The edges of a scroller with more content beyond them: its scroll's start and end (right to left the offset is negative). */
function edgesBeyond(scroller: HTMLElement, vertical: boolean): { readonly start: boolean; readonly end: boolean } {
    const along = vertical ? scroller.scrollTop : Math.abs(scroller.scrollLeft);
    const extent = vertical ? scroller.scrollHeight - scroller.clientHeight : scroller.scrollWidth - scroller.clientWidth;
    return { start: along > 1, end: along < extent - 1 };
}

function percentText(percent: number): string {
    return `${String(percent)}%`;
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
        collapsed: { type: Boolean, reflect: true },
        dateCounts: { attribute: false },
        tip: { state: true },
        said: { state: true },
    };

    static override readonly styles = timelineStyles;

    declare stops: readonly TimelineStop[];
    declare value: TimelineStop;
    declare locale: Locale;
    declare orientation: TimelineOrientation;
    declare dragging: boolean;
    /** How the years fit the card (reflected for the styles), from the card's size and the number of stops. */
    declare density: TimelineDensity;
    /** Px between two stops if the track fitted the card. */
    declare gapPx: number;
    /** The edges with more years beyond them: the scroll's start (left, right right to left, top standing) and end. */
    declare fade: { readonly start: boolean; readonly end: boolean };
    /** V12: on a phone, idle, the card is only its year's pill (the viewer's `timeline-dock.ts` decides). */
    declare collapsed: boolean;
    /** V13: the years with several dates, and how many (`timeline-dates.ts`): their stops carry a badge. */
    declare dateCounts: ReadonlyMap<number, number>;
    /** The year chip, or null. */
    declare tip: TimelineTip | null;
    /** What the polite live region says: the year a drag or a scrub ended on (the slider's own value text while it moves). */
    declare said: string;

    /** Sends `hcm-year-change`: at once for a key, at most once per frame during a press (`timeline-sends.ts`). */
    readonly #sends = new YearSends((year) => {
        this.dispatchEvent(new CustomEvent('hcm-year-change', { bubbles: true, detail: { year } }));
    });

    /** The track's pointers: a mouse's drag and hover, a finger's scrub and tap (`timeline-pointer.ts`). */
    readonly #pointer = new TimelinePointer({
        vertical: () => this.orientation === 'vertical',
        rtl: () => this.#rtl(),
        scrolls: () => this.density === 'scroll',
        count: () => this.stops.length,
        select: (index) => {
            this.#select(index, true);
        },
        settle: (released) => {
            this.#settle(released);
        },
        focus: () => {
            this.focus();
        },
        dragging: (dragging) => {
            this.dragging = dragging;
            if (dragging) {
                this.#peek.stop(true);
            }
        },
        touchTip: (index) => {
            this.tip = index === null || this.#severalDates(index) ? null : { index, touch: true };
            if (index !== null) {
                this.#peek.rest(index, 'touch');
            }
        },
        hint: (index) => {
            this.#hintAt(index);
            if (!this.dragging) {
                this.#peek.rest(index, 'mouse');
            }
        },
        hideHint: () => {
            this.#hideHint();
            this.#peek.away();
        },
        peek: (event, lifted) => peekPlace(this, this.#peek.shown(), event, lifted),
    });
    /** V13's peek: the dates of the year a pointer rests on, the year not selected (`timeline-peek.ts`). */
    readonly #peek = new DatesPeek({
        datesAt: (index) => (this.#severalDates(index) ? peekDates(this, this.stops[index] ?? null, index) : null),
        send: (detail) => {
            this.dispatchEvent(datesPeekEvent(detail));
        },
    });
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
        this.collapsed = false;
        this.dateCounts = new Map();
        this.tip = null;
        this.said = '';
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.#resize.observe(this);
    }

    override disconnectedCallback(): void {
        this.#resize.disconnect();
        this.#sends.drop();
        this.#pointer.end();
        this.#peek.stop(false);
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
        this.#placeTip();
        this.#markTipping();
    }

    /**
     * `tipping` while the chip shows (none on the collapsed pill), `tipping="focus"` when it is the keyboard's: the
     * photos chip under it then stays in the Tab order (`dock-styles.ts`, lesson 648).
     */
    #markTipping(): void {
        this.removeAttribute('tipping');
        if (this.tip !== null && !this.collapsed) {
            this.setAttribute('tipping', this.#keyboardTip() ? 'focus' : '');
        }
    }

    /** The chip is the keyboard's: the thumb has a visible focus and no finger is down. */
    #keyboardTip(): boolean {
        return this.tip?.touch === false && this.renderRoot.querySelector('.thumb:focus-visible') !== null;
    }

    /** Puts the chip by its stop, clear of the card's ends and the viewport's edges (`placeTip`). */
    #placeTip(): void {
        const tip = this.renderRoot.querySelector<HTMLElement>('.tip');
        const stop = this.renderRoot.querySelectorAll('.stop')[this.tip?.index ?? -1];
        if (tip === null || stop === undefined) {
            return;
        }
        const card = this.getBoundingClientRect();
        const mark = stop.getBoundingClientRect();
        const anchor = { x: mark.left + mark.width / 2 - card.left, y: mark.top + mark.height / 2 - card.top };
        const viewport = { width: innerWidth, height: innerHeight, rtl: this.#rtl(), vertical: this.orientation === 'vertical' };
        const place = placeTip(anchor, { width: tip.offsetWidth, height: tip.offsetHeight }, card, viewport);
        tip.style.left = `${String(place.left)}px`;
        tip.style.top = `${String(place.top)}px`;
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
        return html`<div class="scroller" ${cssProperties(fade)} @scroll=${this.#onScroll}>${this.#track(index, position)}</div>
            ${this.tip === null || this.collapsed ? nothing : this.#tipChip(this.tip)}<span class="visually-hidden" aria-live="polite"
                >${this.said}</span
            >`;
    }

    /** The chip: decorative, the slider's `aria-valuetext` already names the year. */
    #tipChip(tip: TimelineTip): TemplateResult {
        const stop = this.stops[tip.index] ?? null;
        return html`<div class="tip" aria-hidden="true">${tipText(stop, this.locale)}</div>`;
    }

    /** A mouse or a key on stop `index`: the chip when it has no label of its own or several dates; never over a finger's. */
    #hintAt(index: number): void {
        if (this.tip?.touch === true) {
            return;
        }
        const wanted = tipWanted(this.#named(index), this.#severalDates(index));
        this.tip = wanted ? { index, touch: false } : null;
    }

    /** Whether stop `index` is a year of several dates: no chip there, its date menu names them (the owner, 2026-11-13). */
    #severalDates(index: number): boolean {
        return countOf(this.dateCounts, this.stops[index] ?? null) > 1;
    }

    /** Whether a stop's year is on the track: its label, or the pill for the selected one whatever the density. */
    #named(index: number): boolean {
        const selected = stopIndex(this.stops, this.value);
        return index === selected || this.#labelled(index, selected);
    }

    #hideHint(): void {
        if (this.tip?.touch !== true) {
            this.tip = null;
        }
    }

    readonly #onFocus = (): void => {
        if (this.renderRoot.querySelector('.thumb:focus-visible') !== null) {
            this.#hintAt(stopIndex(this.stops, this.value));
        }
    };

    readonly #onBlur = (): void => {
        this.#hideHint();
    };

    #track(index: number, position: Readonly<Record<string, string>>): TemplateResult {
        return html`<div
            class="track"
            ${cssProperties({ '--hcm-gaps': String(this.stops.length - 1) })}
            @pointerdown=${this.#pointer.onDown}
            @pointermove=${this.#pointer.onHover}
            @pointerleave=${this.#pointer.onLeave}
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
                @click=${this.#onActivate}
                @focus=${this.#onFocus}
                @blur=${this.#onBlur}
            >
                <span class="thumb-label" aria-hidden="true">${this.#shortLabel(this.stops[index] ?? null)}</span>
                ${this.#badge(this.stops[index] ?? null)}
            </div>
        </div>`;
    }

    #stop(stop: TimelineStop, stopAt: number, selected: number): TemplateResult {
        const classes = { stop: true, selected: stopAt === selected, minor: !this.#labelled(stopAt, selected) };
        return html`<li class=${classMap(classes)} ${cssProperties({ '--hcm-stop': percentText(this.#percent(stopAt)) })}>
            <span class="tick"></span><span class="label">${this.#shortLabel(stop)}</span>
            ${stopAt === selected ? '' : this.#badge(stop)}
        </li>`;
    }

    /** V13: the badge of a year with several dates, a hint for the eye only (the year's point and the slider are the targets). */
    #badge(stop: TimelineStop): TemplateResult {
        return dateBadge(stop, countOf(this.dateCounts, stop));
    }

    /**
     * V13 (the owner, 2026-11-13: "the date picker should show up when the user selects a year with multiple dates"): the
     * selected year, once rendered, asks for its date menu beside the thumb when it has several dates; nothing otherwise.
     */
    #offerDates(): void {
        const stop = this.value;
        if (stop === null || countOf(this.dateCounts, stop) < 2) {
            return;
        }
        void this.updateComplete.then(() => {
            const thumb = this.renderRoot.querySelector('.thumb');
            if (thumb !== null && this.value === stop) {
                this.dispatchEvent(datesOpenEvent(stop, thumb));
            }
        });
    }

    /** A click with no pointer behind it (`detail` 0: the gamepad's A, the D-pad's select) selects the year as Enter does. */
    readonly #onActivate = (event: MouseEvent): void => {
        if (event.detail === 0) {
            this.#offerDates();
        }
    };

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
        if (stop === null) {
            return translate(this.locale, 'timeline.present');
        }
        return datesValueText(this.locale, translate(this.locale, 'timeline.year', { year: String(stop) }), countOf(this.dateCounts, stop));
    }

    readonly #onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Enter') {
            this.#datesByKey(event);
            return;
        }
        // The arrows move the year live, as a drag does; the menu waits for Enter (WCAG 3.2.2: no change of context on input).
        const step = KEY_STEPS[event.key];
        if (step === undefined) {
            return;
        }
        event.preventDefault();
        const turned = /^Arrow[LR]/.test(event.key) && this.#rtl();
        this.#select(stopIndex(this.stops, this.value) + (turned ? -step : step));
        this.#hintAt(stopIndex(this.stops, this.value));
    };

    /** V13: Enter (the keyboard's and the remote's select) on a year with several dates opens its date menu, every time. */
    #datesByKey(event: KeyboardEvent): void {
        if (this.value !== null && countOf(this.dateCounts, this.value) > 1) {
            event.preventDefault();
            this.#offerDates();
        }
    }

    #rtl(): boolean {
        return this.matches(':dir(rtl)');
    }

    /** Selects a stop; a press's (`live`) years are sent at most once per frame (the owner, 2026-11-13). */
    #select(index: number, live = false): void {
        const clamped = Math.min(this.stops.length - 1, Math.max(0, index));
        const stop = this.stops[clamped] ?? null;
        if (stop !== this.value) {
            this.value = stop;
            this.#sends.changed(stop, live);
        }
    }

    /**
     * A press ended: its last year is sent now and, if it changed the year, said politely. A press the visitor lifted (a
     * tap, a click, the end of a drag or a scrub) on a year with several dates opens its date menu, once per press: the
     * years a drag passes never do.
     */
    #settle(released: boolean): void {
        this.#peek.stop(!released);
        if (this.#sends.settle()) {
            this.said = this.#valueText(this.value);
        }
        if (released) {
            this.#offerDates();
        }
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
