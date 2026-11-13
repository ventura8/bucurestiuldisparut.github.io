/**
 * The timeline's dock of `<hcm-map-viewer>` and what it opens: V12 and V13 (the owner, 2026-11-13).
 *
 * V12: on a phone (a standing timeline, or a short window's lying one) the timeline rests collapsed to the pill of its
 * year, a 48 px card in the corner the whole card took (`timeline-dock-styles.ts`), so it covers no more of the map than it
 * must. A press on it opens the whole card (the press is not a drag: the year stays); the skip link opens it too. It
 * collapses again when the visitor goes back to the map, a press anywhere in the viewer outside it, or presses Esc in it.
 * No timer collapses it (WCAG 2.2.1: a visitor reading or tabbing is never hurried; DECISIONS-for-review.md §195). The
 * collapsed card is still the slider: the arrow keys change the year and the screen reader hears it.
 *
 * V13: a year with several dates carries a badge (`timeline-dates.ts`), a hint only; selecting that year (a tap, a click,
 * the end of a drag or a scrub, Enter, the gamepad's A) opens `<hcm-date-menu>` beside the thumb, and the date picked comes
 * to the front (the store's `pickLayer`, V15's mechanism); Esc, a press outside it or the gamepad's B close it.
 */
import { translate, type Layer, type ViewerLocale } from '@hcm/shared';
import { html, type ReactiveController, type ReactiveControllerHost, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import type { HcmTimeline, TimelineOrientation } from './hcm-timeline.js';
import { dateCounts, dateItems, datesOpenEvent, frontOfYear, type DatesOpenDetail } from './timeline-dates.js';
import type { TimelineStop } from './timeline-model.js';

/** What the dock needs from the viewer element. */
export type DockHost = ReactiveControllerHost & HTMLElement & { readonly renderRoot: HTMLElement | DocumentFragment };

/** The timeline's open state on a phone and the date picker's, kept by the viewer element across renders. */
export class TimelineDock implements ReactiveController {
    /** On a phone, the whole card shows (false: its pill). */
    expanded = false;
    /** The open date picker's year and anchor; null: closed. */
    dates: DatesOpenDetail | null = null;

    readonly #host: DockHost;

    constructor(host: DockHost) {
        this.#host = host;
        host.addController(this);
    }

    hostConnected(): void {
        this.#host.addEventListener('pointerdown', this.#outside, true);
    }

    hostDisconnected(): void {
        this.#host.removeEventListener('pointerdown', this.#outside, true);
    }

    /** Whether the card shows as its pill now: a phone's timeline (`phone`) that is not open. */
    collapsed(phone: boolean): boolean {
        return phone && !this.expanded;
    }

    /** Opens the whole card (the skip link, a press on the pill). */
    expand(): void {
        this.#set(true);
    }

    /** A press on the pill opens the card instead of moving the year (or opening its dates): caught on its way down to the timeline. */
    readonly pointerDown = {
        capture: true,
        handleEvent: (event: PointerEvent): void => {
            if (this.#timeline()?.collapsed === true) {
                event.preventDefault();
                event.stopPropagation();
                this.#set(true);
            }
        },
    };

    /** Esc in the open card of a phone collapses it to its pill; the slider keeps the focus. */
    readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && this.expanded) {
            this.#set(false);
        }
    };

    /**
     * The timeline asks for a year's dates. On a phone's pill (Enter or the gamepad's A on it) the card opens first and the
     * menu opens beside its thumb there, so it never sits over the pill's corner.
     */
    readonly onDatesOpen = (event: CustomEvent<DatesOpenDetail>): void => {
        event.stopPropagation();
        const timeline = this.#timeline();
        if (timeline?.collapsed !== true) {
            this.#openDates(event.detail);
            return;
        }
        this.#set(true);
        void this.#host.updateComplete
            .then(() => timeline.updateComplete)
            .then(() => {
                const thumb = timeline.renderRoot.querySelector('.thumb');
                this.#openDates(thumb === null ? event.detail : datesOpenEvent(event.detail.year, thumb).detail);
            });
    };

    #openDates(detail: DatesOpenDetail): void {
        this.dates = detail;
        this.#host.requestUpdate();
    }

    /** B (or the Xbox's emulated GamepadB: the input `close`) over the date menu closes it and keeps the date shown. */
    closedBy(command: string): boolean {
        if (command !== 'close' || this.dates === null) {
            return false;
        }
        this.closeDates();
        return true;
    }

    /** Closes the date picker; the focus goes back to the slider once the frame is no longer inert. */
    readonly closeDates = (): void => {
        this.dates = null;
        this.#host.requestUpdate();
        void this.#host.updateComplete.then(() => {
            this.#timeline()?.focus();
        });
    };

    /** A press in the viewer outside the dock and the date picker: the visitor went back to the map. */
    readonly #outside = (event: Event): void => {
        const path = event.composedPath();
        const dock = this.#host.renderRoot.querySelector('.dock.timeline');
        const inside = path.some((target) => target instanceof Element && (target === dock || target.localName === 'hcm-date-menu'));
        if (this.expanded && !inside) {
            this.#set(false);
        }
    };

    #timeline(): HcmTimeline | null {
        return this.#host.renderRoot.querySelector<HcmTimeline>('#timeline');
    }

    #set(expanded: boolean): void {
        if (this.expanded !== expanded) {
            this.expanded = expanded;
            this.#host.requestUpdate();
        }
    }
}

/** What the dock's template needs from one render of the viewer. */
export interface DockView {
    readonly stops: readonly TimelineStop[];
    readonly year: number | null;
    readonly locale: ViewerLocale;
    readonly orientation: TimelineOrientation;
    readonly layers: readonly Layer[];
    readonly collapsed: boolean;
}

/** The timeline in its dock: the whole card, or on an idle phone its pill (`collapsed`). */
export function timelineDock(view: DockView, dock: TimelineDock, onYearChange: (event: CustomEvent) => void): TemplateResult {
    return html`<div class="dock timeline" @pointerdown=${dock.pointerDown} @keydown=${dock.onKeyDown}>
        <hcm-timeline
            id="timeline"
            data-layout-check="timeline"
            .stops=${view.stops}
            .value=${view.year}
            .locale=${view.locale}
            .orientation=${view.orientation}
            .collapsed=${view.collapsed}
            .dateCounts=${dateCounts(view.layers)}
            @hcm-year-change=${onYearChange}
            @hcm-dates-open=${dock.onDatesOpen}
        ></hcm-timeline>
    </div>`;
}

/** The date picker of the year the dock asked for (none while closed). */
export function dateMenu(
    view: Pick<DockView, 'locale' | 'layers' | 'orientation'> & { readonly front: string | null },
    dock: TimelineDock,
    onPick: (event: CustomEvent<{ readonly layerId: string }>) => void,
): TemplateResult {
    const dates = dock.dates;
    if (dates === null) {
        return EMPTY;
    }
    return html`<hcm-date-menu
        .items=${dateItems(view.layers, dates.year, view.locale)}
        .selected=${frontOfYear(view.layers, dates.year, view.front)}
        .label=${translate(view.locale, 'timeline.dates', { year: String(dates.year) })}
        .anchor=${dates.anchor}
        .vertical=${view.orientation === 'vertical'}
        @hcm-date-pick=${onPick}
        @hcm-close=${dock.closeDates}
    ></hcm-date-menu>`;
}
